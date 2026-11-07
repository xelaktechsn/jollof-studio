// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AppError } from '../common/errors';
import { RefreshToken, User } from '../database/entities';
import { RealtimeService } from '../realtime/realtime.service';

export const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
// Seul algorithme accepté : un jeton « alg: none » ou signé autrement est refusé.
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'jollof';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const invalid = () => new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid or expired token');

export interface AccessPayload {
  sub: string;
  sch: string;
  typ: 'access';
  /** Version des jetons du compte (users.token_version) au moment de l'émission. */
  ver?: number;
  /** Famille du jeton de rafraîchissement (la session) qui a produit ce jeton d'accès. */
  fam?: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(RefreshToken) private readonly refresh: Repository<RefreshToken>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly realtime: RealtimeService,
  ) {}

  /** Paire de jetons ; `familyId` relie les jetons successifs d'une même connexion. */
  async issue(user: User, familyId: string = randomUUID(), manager?: EntityManager) {
    const payload: AccessPayload = { sub: user.id, sch: user.schoolId, typ: 'access', ver: user.tokenVersion ?? 0, fam: familyId };
    const accessToken = await this.jwt.signAsync(payload, { algorithm: JWT_ALGORITHM, issuer: JWT_ISSUER, expiresIn: ACCESS_TTL_SECONDS });
    const refreshToken = randomBytes(32).toString('base64url');
    const repo = manager ? manager.getRepository(RefreshToken) : this.refresh;
    await repo.insert({ userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) });
    return { accessToken, refreshToken };
  }

  /** Signature et forme ; la version est comparée par l'appelant, qui relit le compte. */
  async verifyAccess(token: string): Promise<AccessPayload> {
    try {
      const p = await this.jwt.verifyAsync<AccessPayload>(token, { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER });
      if (p.typ !== 'access' || typeof p.sub !== 'string' || typeof p.sch !== 'string') throw invalid();
      return p;
    } catch {
      throw invalid();
    }
  }

  /** Jeton encore valable pour ce compte : même école, même version (pas de révocation depuis). */
  static matches(p: AccessPayload, user: Pick<User, 'schoolId' | 'tokenVersion'>): boolean {
    return p.sch === user.schoolId && (p.ver ?? 0) === (user.tokenVersion ?? 0);
  }

  /** Rotation : le jeton présenté est révoqué ; un jeton déjà révoqué trahit un vol, toute la famille tombe. */
  async rotate(raw: string): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const row = await this.refresh.findOneBy({ tokenHash: sha256(raw) });
    if (!row) throw invalid();
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw invalid();
    }
    if (row.expiresAt.getTime() <= Date.now()) throw invalid();
    // Révocation conditionnelle : de deux requêtes simultanées, une seule gagne, l'autre est une réutilisation.
    const claimed = await this.refresh.update({ id: row.id, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!claimed.affected) {
      await this.revokeFamily(row.familyId);
      throw invalid();
    }
    const user = await this.users.findOneBy({ id: row.userId });
    if (!user) throw invalid();
    if (user.disabled) {
      await this.revokeFamily(row.familyId);
      throw new AppError(403, 'AUTH_DISABLED', 'This account is disabled');
    }
    return { user, ...(await this.issue(user, row.familyId)) };
  }

  async revoke(raw: string) {
    const row = await this.refresh.findOneBy({ tokenHash: sha256(raw) });
    if (row) await this.revokeFamily(row.familyId);
  }

  revokeFamily(familyId: string) {
    return this.refresh.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  revokeAllFor(userId: string, exceptFamily?: string) {
    const where = exceptFamily ? { userId, revokedAt: IsNull(), familyId: Not(exceptFamily) } : { userId, revokedAt: IsNull() };
    return this.refresh.update(where, { revokedAt: new Date() });
  }

  /**
   * Coupe les sessions d'un compte (mot de passe changé ou réinitialisé, compte désactivé) :
   * jetons d'accès déjà émis invalidés (version + 1), jetons de rafraîchissement révoqués,
   * sockets fermées. `keepFamily` : la session à l'origine du changement reste ouverte (son
   * jeton d'accès se renouvelle par le rafraîchissement, de façon transparente pour le client).
   */
  async endSessions(userId: string, keepFamily?: string) {
    await this.users.increment({ id: userId }, 'tokenVersion', 1);
    await this.revokeAllFor(userId, keepFamily);
    await this.realtime.disconnectUser(userId, keepFamily);
  }

  /** Purge : jetons expirés, et jetons révoqués depuis plus de 7 jours (la détection de réutilisation s'arrête là). */
  async purge(now = new Date()): Promise<number> {
    const r = await this.refresh
      .createQueryBuilder()
      .delete()
      .where('expires_at < :now OR revoked_at < :cutoff', { now, cutoff: new Date(now.getTime() - 7 * 24 * 3600_000) })
      .execute();
    return r.affected ?? 0;
  }
}
