// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Namespace, Socket } from 'socket.io';
import { DataSource, Repository } from 'typeorm';
import { TokensService } from '../auth/tokens.service';
import { AppError } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { User } from '../database/entities';
import { ConversationsService } from '../messaging/conversations.service';
import { RealtimeService, rooms } from './realtime.service';

interface SocketUser {
  id: string;
  schoolId: string;
  displayName: string;
  /** Session (famille de jetons) : un changement de mot de passe garde la socket de son auteur. */
  fam?: string;
}

// Indicateurs de frappe : 10 par 10 s et par utilisateur ; au-delà, ignorés sans erreur.
export const TYPING_LIMIT = 10;
export const TYPING_WINDOW_MS = 10_000;

// Espace /rt : jeton d'accès à la poignée de main, puis la socket rejoint ses salles
// (utilisateur, classes, groupes, conversations) avant d'être déclarée connectée.
@WebSocketGateway({ namespace: '/rt' })
export class RealtimeGateway implements OnGatewayInit<Namespace>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket>, BeforeApplicationShutdown {
  private readonly logger = new Logger('Realtime');
  private ns!: Namespace;
  private closing = false;
  private readonly pending = new Set<Promise<void>>();
  private readonly typingLimiter = new RateLimiter(TYPING_LIMIT, TYPING_WINDOW_MS);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly tokens: TokensService,
    private readonly convs: ConversationsService,
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  afterInit(ns: Namespace) {
    this.ns = ns;
    this.realtime.attach(ns);
    ns.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (e) => {
          const code = e instanceof AppError ? e.code : 'AUTH_TOKEN_INVALID';
          const error = new Error(code) as Error & { data?: unknown };
          error.data = { code };
          next(error);
        },
      );
    });
  }

  private async authenticate(socket: Socket) {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Missing token');
    const payload = await this.tokens.verifyAccess(token);
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Unknown user');
    if (user.disabled) throw new AppError(403, 'AUTH_DISABLED', 'Account disabled');
    if (!TokensService.matches(payload, user)) throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Token revoked');
    socket.data.user = { id: user.id, schoolId: user.schoolId, displayName: user.displayName, fam: payload.fam } satisfies SocketUser;
    socket.join(await this.roomsFor(user));
  }

  async roomsFor(user: Pick<User, 'id' | 'schoolId'>): Promise<string[]> {
    const [classes, groups, convIds] = await Promise.all([
      this.db.query('SELECT classroom_id FROM classroom_members WHERE user_id = $1', [user.id]) as Promise<{ classroom_id: string }[]>,
      this.db.query(
        `SELECT group_id AS id FROM group_members WHERE user_id = $1
         UNION SELECT g.id FROM groups g JOIN classroom_members m ON m.classroom_id = g.classroom_id AND m.user_id = $1 AND m.role = 'teacher'`,
        [user.id],
      ) as Promise<{ id: string }[]>,
      this.convs.idsFor(user.id, user.schoolId),
    ]);
    return [
      rooms.user(user.id),
      ...classes.map((c) => rooms.class(c.classroom_id)),
      ...groups.map((g) => rooms.group(g.id)),
      ...convIds.map(rooms.conv),
    ];
  }

  async handleConnection(socket: Socket) {
    const user = socket.data.user as SocketUser | undefined;
    if (!user) return;
    if (this.realtime.connected(user.id)) {
      await this.users.update({ id: user.id }, { lastSeenAt: new Date() }).catch(() => undefined);
      const classRooms = [...socket.rooms].filter((r) => r.startsWith('class:'));
      if (classRooms.length) socket.to(classRooms).emit('presence', { userId: user.id, online: true });
    }
  }

  // Arrêt du serveur : on attend les écritures de présence en cours, on note « vu pour la
  // dernière fois » de tous les connectés tant que la base répond, puis plus aucune écriture.
  async beforeApplicationShutdown() {
    this.closing = true;
    await Promise.allSettled([...this.pending]);
    const ids = this.realtime.onlineIds();
    if (ids.length) await this.db.query('UPDATE users SET last_seen_at = now() WHERE id = ANY($1)', [ids]).catch(() => undefined);
  }

  handleDisconnect(socket: Socket) {
    const user = socket.data.user as SocketUser | undefined;
    if (!user || !this.realtime.disconnected(user.id) || this.closing) return;
    const work = this.wentOffline(user.id).finally(() => this.pending.delete(work));
    this.pending.add(work);
    return work;
  }

  private async wentOffline(userId: string) {
    try {
      await this.users.update({ id: userId }, { lastSeenAt: new Date() });
      const classes: { classroom_id: string }[] = await this.db.query('SELECT classroom_id FROM classroom_members WHERE user_id = $1', [userId]);
      if (classes.length) this.ns.to(classes.map((c) => rooms.class(c.classroom_id))).emit('presence', { userId, online: false });
    } catch (e) {
      this.logger.debug(`presence: ${(e as Error).message}`);
    }
  }

  /** Indicateur de frappe : relayé aux autres membres, seulement dans ses propres conversations. */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const user = socket.data.user as SocketUser | undefined;
    const id = (body as { conversationId?: unknown } | null)?.conversationId;
    if (!user || typeof id !== 'string' || !socket.rooms.has(rooms.conv(id))) return;
    if (this.typingLimiter.hit(user.id)) return;
    socket.to(rooms.conv(id)).emit('typing', { conversationId: id, userId: user.id, displayName: user.displayName });
  }
}
