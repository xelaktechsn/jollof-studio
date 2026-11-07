// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { Actor } from '../auth/actor';
import { AccessService } from '../common/access.service';
import { AppError, err } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { Conversation, FileRef, Message, StoredFile, User } from '../database/entities';
import { fileRef } from '../files/files.service';
import { RealtimeService, rooms } from '../realtime/realtime.service';
import { ConversationsService, MESSAGE_SELECT, MessageRow, messageView } from './conversations.service';
import { PostMessageDto } from './dto';

const EDIT_WINDOW_MS = 15 * 60_000;
// Envoi de messages : 20 par 10 s et par utilisateur (une classe entière qui « spamme » ne
// noie ni la discussion ni le serveur) ; au-delà, 429 RATE_LIMITED avec retryAfter.
export const POST_LIMIT = 20;
export const POST_WINDOW_MS = 10_000;

@Injectable()
export class MessagingService {
  private readonly postLimiter = new RateLimiter(POST_LIMIT, POST_WINDOW_MS);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(StoredFile) private readonly files: Repository<StoredFile>,
    private readonly access: AccessService,
    private readonly convs: ConversationsService,
    private readonly realtime: RealtimeService,
  ) {}

  list(actor: Actor) {
    return this.convs.listFor(actor.id, actor.schoolId);
  }

  /**
   * Messages directs permis : enseignant↔élève d'une classe commune, enseignant↔enseignant
   * de l'école, élève↔élève d'une classe commune qui l'autorise.
   */
  async canDirect(a: User, b: User): Promise<boolean> {
    if (a.schoolId !== b.schoolId || a.id === b.id) return false;
    const staffA = a.role !== 'student';
    const staffB = b.role !== 'student';
    if (staffA && staffB) return true;
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM classroom_members ma JOIN classroom_members mb ON mb.classroom_id = ma.classroom_id
       JOIN classrooms c ON c.id = ma.classroom_id
       WHERE ma.user_id = $1 AND mb.user_id = $2 AND ma.role = $3 AND mb.role = $4
       ${!staffA && !staffB ? `AND c.settings->>'allowStudentDirectMessages' = 'true'` : ''} LIMIT 1`,
      [a.id, b.id, staffA ? 'teacher' : 'student', staffB ? 'teacher' : 'student'],
    );
    return rows.length > 0;
  }

  async direct(actor: Actor, userId: string) {
    if (userId === actor.id) throw err.validation('Cannot start a conversation with yourself');
    const other = await this.users.findOneBy({ id: userId });
    if (!other || other.schoolId !== actor.schoolId) throw err.notFound('User');
    if (!(await this.canDirect(actor, other))) throw err.forbidden('Direct messages are not allowed with this user');
    const [userAId, userBId] = [actor.id, other.id].sort();
    let conv = await this.conversations.findOneBy({ kind: 'direct', userAId, userBId });
    if (!conv) {
      try {
        conv = await this.conversations.save(this.conversations.create({ schoolId: actor.schoolId, kind: 'direct', userAId, userBId, settings: { studentsCanPost: true } }));
        await this.convs.announce(conv.id, actor.schoolId, [actor.id, other.id]);
      } catch (e) {
        // Création simultanée par l'autre personne : on reprend la sienne.
        if ((e as { code?: string }).code !== '23505') throw e;
        conv = await this.conversations.findOneByOrFail({ kind: 'direct', userAId, userBId });
      }
    }
    return this.convs.requireMember(actor, conv.id);
  }

  private async row(id: string): Promise<MessageRow | undefined> {
    const [m]: MessageRow[] = await this.db.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
    return m;
  }

  async history(actor: Actor, conversationId: string, before: string | undefined, limit = 50) {
    await this.convs.requireMember(actor, conversationId);
    const params: unknown[] = [conversationId, limit];
    let cond = '';
    if (before) {
      const b = await this.messages.findOneBy({ id: before, conversationId });
      if (!b) throw err.validation('before must be a message of this conversation');
      params.push(b.seq);
      cond = 'AND m.seq < $3';
    }
    const rows: MessageRow[] = await this.db.query(`${MESSAGE_SELECT} WHERE m.conversation_id = $1 ${cond} ORDER BY m.seq DESC LIMIT $2`, params);
    return rows.reverse().map(messageView);
  }

  async post(actor: Actor, conversationId: string, dto: PostMessageDto) {
    const wait = this.postLimiter.hit(actor.id);
    if (wait) throw new AppError(429, 'RATE_LIMITED', 'Too many messages, slow down', { retryAfter: wait });
    const conv = await this.convs.requireMember(actor, conversationId);
    if (actor.role === 'student' && !conv.settings.studentsCanPost) throw new AppError(403, 'POSTING_DISABLED', 'Students cannot post in this conversation');
    if (conv.kind === 'direct') {
      // Les règles s'appliquent encore après coup (élève sorti de la classe, option retirée…).
      const other = conv.other ? await this.users.findOneBy({ id: conv.other.id }) : null;
      if (!other || !(await this.canDirect(actor, other))) throw err.forbidden('Direct messages are no longer allowed with this user');
    }
    let attachments: FileRef[] = [];
    const ids = [...new Set(dto.attachmentIds ?? [])];
    if (ids.length) {
      const files = await this.files.findBy({ id: In(ids), ownerId: actor.id });
      if (files.length !== ids.length) throw err.validation('Unknown attachment');
      attachments = ids.map((id) => fileRef(files.find((f) => f.id === id)!));
    }
    const saved = await this.db.transaction(async (m) => {
      const msg = await m.save(m.create(Message, { conversationId, senderId: actor.id, body: dto.body, attachments }));
      await m.query('UPDATE conversations SET updated_at = $2 WHERE id = $1', [conversationId, msg.createdAt]);
      await m.query(
        `INSERT INTO conversation_reads (conversation_id, user_id, last_read_seq) VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_seq = GREATEST(conversation_reads.last_read_seq, EXCLUDED.last_read_seq)`,
        [conversationId, actor.id, msg.seq],
      );
      return msg;
    });
    const view = messageView((await this.row(saved.id))!);
    this.realtime.toRooms(rooms.conv(conversationId), 'message:new', { message: view });
    return view;
  }

  private async ownMessage(actor: Actor, id: string) {
    const msg = await this.messages.findOneBy({ id });
    if (!msg) throw err.notFound('Message');
    const conv = await this.convs.requireMember(actor, msg.conversationId);
    return { msg, conv };
  }

  async edit(actor: Actor, id: string, body: string) {
    const { msg } = await this.ownMessage(actor, id);
    if (msg.senderId !== actor.id) throw err.forbidden('Only the author can edit a message');
    if (msg.deleted) throw err.notFound('Message');
    if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) throw new AppError(403, 'EDIT_WINDOW_PASSED', 'Messages can be edited for 15 minutes');
    await this.messages.update({ id }, { body, editedAt: new Date() });
    const view = messageView((await this.row(id))!);
    this.realtime.toRooms(rooms.conv(msg.conversationId), 'message:updated', { message: view });
    return view;
  }

  async remove(actor: Actor, id: string) {
    const { msg, conv } = await this.ownMessage(actor, id);
    let allowed = msg.senderId === actor.id;
    if (!allowed && conv.kind !== 'direct' && conv.classroomId) {
      allowed = (await this.access.classRole(conv.classroomId, actor.id)) === 'teacher';
    }
    if (!allowed) throw err.forbidden('Only the author or a teacher of the classroom can delete this message');
    if (msg.deleted) return;
    await this.messages.update({ id }, { body: null, attachments: [], deleted: true });
    this.realtime.toRooms(rooms.conv(msg.conversationId), 'message:deleted', { id, conversationId: msg.conversationId });
  }

  async read(actor: Actor, conversationId: string, messageId: string) {
    await this.convs.requireMember(actor, conversationId);
    const msg = await this.messages.findOneBy({ id: messageId, conversationId });
    if (!msg) throw err.validation('messageId must be a message of this conversation');
    await this.db.query(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_seq) VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_seq = GREATEST(conversation_reads.last_read_seq, EXCLUDED.last_read_seq)`,
      [conversationId, actor.id, msg.seq],
    );
  }

  async settings(actor: Actor, conversationId: string, studentsCanPost: boolean) {
    const conv = await this.convs.requireMember(actor, conversationId);
    if (conv.kind !== 'class' || !conv.classroomId) throw err.forbidden('Only class conversations have settings');
    if ((await this.access.classRole(conv.classroomId, actor.id)) !== 'teacher') throw err.forbidden('Only teachers of the classroom can change this');
    await this.conversations.update({ id: conversationId }, { settings: { studentsCanPost } });
    return this.convs.requireMember(actor, conversationId);
  }
}
