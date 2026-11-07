// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Actor } from '../auth/actor';
import { err } from '../common/errors';
import { publicRole } from '../common/views';
import { Conversation, FileRef, Role } from '../database/entities';
import { RealtimeService, rooms } from '../realtime/realtime.service';

interface ConvRow {
  id: string;
  kind: 'class' | 'group' | 'direct';
  classroom_id: string | null;
  group_id: string | null;
  user_a_id: string | null;
  user_b_id: string | null;
  settings: { studentsCanPost: boolean };
  updated_at: Date;
  classroom_name: string | null;
  group_name: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachments: FileRef[];
  created_at: Date;
  edited_at: Date | null;
  deleted: boolean;
  seq: string;
  display_name: string;
  avatar_color: string;
  role: Role;
}

export function messageView(m: MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    sender: { id: m.sender_id, displayName: m.display_name, avatarColor: m.avatar_color, role: publicRole(m.role) },
    body: m.deleted ? null : m.body,
    attachments: m.deleted ? [] : m.attachments,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    deleted: m.deleted,
  };
}

export const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.attachments, m.created_at, m.edited_at,
  m.deleted, m.seq, u.display_name, u.avatar_color, u.role FROM messages m JOIN users u ON u.id = m.sender_id`;

// Appartenance à une conversation : classe = inscrits ; groupe = membres + enseignants de
// la classe ; direct = les deux personnes. Une seule requête sert la liste et le contrôle.
const MEMBER_FILTER = `(
  (c.kind = 'class' AND EXISTS (SELECT 1 FROM classroom_members m WHERE m.classroom_id = c.classroom_id AND m.user_id = $1))
  OR (c.kind = 'group' AND (
    EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = c.group_id AND gm.user_id = $1)
    OR EXISTS (SELECT 1 FROM classroom_members m WHERE m.classroom_id = c.classroom_id AND m.user_id = $1 AND m.role = 'teacher')))
  OR (c.kind = 'direct' AND (c.user_a_id = $1 OR c.user_b_id = $1)))`;

@Injectable()
export class ConversationsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly realtime: RealtimeService,
  ) {}

  createForClassroom(manager: EntityManager, schoolId: string, classroomId: string) {
    return manager.save(manager.create(Conversation, { schoolId, kind: 'class', classroomId, settings: { studentsCanPost: true } }));
  }

  createForGroup(manager: EntityManager, schoolId: string, classroomId: string, groupId: string) {
    return manager.save(manager.create(Conversation, { schoolId, kind: 'group', classroomId, groupId, settings: { studentsCanPost: true } }));
  }

  /** Conversations du membre (toutes, ou celles de `ids`), activité récente d'abord. */
  async listFor(userId: string, schoolId: string, ids?: string[]) {
    const params: unknown[] = [userId, schoolId];
    let filter = '';
    if (ids) {
      params.push(ids);
      filter = 'AND c.id = ANY($3)';
    }
    const rows: ConvRow[] = await this.db.query(
      `SELECT c.id, c.kind, c.classroom_id, c.group_id, c.user_a_id, c.user_b_id, c.settings, c.updated_at,
              cl.name AS classroom_name, g.name AS group_name
       FROM conversations c
       LEFT JOIN classrooms cl ON cl.id = c.classroom_id
       LEFT JOIN groups g ON g.id = c.group_id
       WHERE c.school_id = $2 AND ${MEMBER_FILTER} ${filter}
       ORDER BY c.updated_at DESC, c.id`,
      params,
    );
    return this.views(userId, rows);
  }

  /** Identifiants des conversations du membre (salles temps réel). */
  async idsFor(userId: string, schoolId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.db.query(`SELECT c.id FROM conversations c WHERE c.school_id = $2 AND ${MEMBER_FILTER}`, [userId, schoolId]);
    return rows.map((r) => r.id);
  }

  /** Conversation dont l'utilisateur est membre, sinon NOT_FOUND (autre école) ou FORBIDDEN. */
  async requireMember(actor: Actor, id: string) {
    const [view] = await this.listFor(actor.id, actor.schoolId, [id]);
    if (view) return view;
    const exists: { school_id: string }[] = await this.db.query('SELECT school_id FROM conversations WHERE id = $1', [id]);
    if (!exists.length || exists[0].school_id !== actor.schoolId) throw err.notFound('Conversation');
    throw err.forbidden('Not a member of this conversation');
  }

  private async views(userId: string, rows: ConvRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const otherIds = rows.filter((r) => r.kind === 'direct').map((r) => (r.user_a_id === userId ? r.user_b_id! : r.user_a_id!));
    const [last, unread, others] = await Promise.all([
      this.db.query(`SELECT DISTINCT ON (m.conversation_id) * FROM (${MESSAGE_SELECT} WHERE m.conversation_id = ANY($1)) m ORDER BY m.conversation_id, m.seq DESC`, [ids]) as Promise<MessageRow[]>,
      this.db.query(
        `SELECT m.conversation_id, count(*)::int AS n FROM messages m
         LEFT JOIN conversation_reads r ON r.conversation_id = m.conversation_id AND r.user_id = $2
         WHERE m.conversation_id = ANY($1) AND m.sender_id <> $2 AND NOT m.deleted AND m.seq > COALESCE(r.last_read_seq, 0)
         GROUP BY m.conversation_id`,
        [ids, userId],
      ) as Promise<{ conversation_id: string; n: number }[]>,
      otherIds.length
        ? (this.db.query('SELECT id, display_name, avatar_color, role FROM users WHERE id = ANY($1)', [otherIds]) as Promise<
            { id: string; display_name: string; avatar_color: string; role: Role }[]
          >)
        : Promise.resolve([]),
    ]);
    const lastBy = new Map(last.map((m) => [m.conversation_id, m]));
    const unreadBy = new Map(unread.map((u) => [u.conversation_id, u.n]));
    const otherBy = new Map(others.map((o) => [o.id, o]));
    return rows.map((r) => {
      let other: { id: string; displayName: string; avatarColor: string; role: 'teacher' | 'student' } | null = null;
      let title = r.kind === 'class' ? r.classroom_name : r.group_name;
      if (r.kind === 'direct') {
        const o = otherBy.get(r.user_a_id === userId ? r.user_b_id! : r.user_a_id!);
        if (o) other = { id: o.id, displayName: o.display_name, avatarColor: o.avatar_color, role: publicRole(o.role) };
        title = o?.display_name ?? '';
      }
      const lm = lastBy.get(r.id);
      return {
        id: r.id,
        kind: r.kind,
        classroomId: r.classroom_id,
        groupId: r.group_id,
        title: title ?? '',
        other,
        settings: { studentsCanPost: r.settings?.studentsCanPost !== false },
        lastMessage: lm ? messageView(lm) : null,
        unreadCount: unreadBy.get(r.id) ?? 0,
        updatedAt: r.updated_at,
      };
    });
  }

  /** Nouvelle conversation pour ces utilisateurs : salle rejointe et `conversation:new` (vue propre à chacun). */
  async announce(conversationId: string, schoolId: string, userIds: string[]) {
    const ids = [...new Set(userIds)];
    this.realtime.join(ids, [rooms.conv(conversationId)]);
    await Promise.all(
      ids.map(async (uid) => {
        const [view] = await this.listFor(uid, schoolId, [conversationId]);
        if (view) this.realtime.toUsers(uid, 'conversation:new', { conversation: view });
      }),
    );
  }

  /** Conversation retirée à ces utilisateurs : salle quittée et `conversation:removed`. */
  withdraw(conversationId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    this.realtime.leave(userIds, [rooms.conv(conversationId)]);
    this.realtime.toUsers(userIds, 'conversation:removed', { id: conversationId });
  }
}
