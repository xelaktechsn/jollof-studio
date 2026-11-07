// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { returningRows } from '../common/json';
import { AuditAction, AuditEntry } from '../database/entities';

export const AUDIT_RETENTION_DAYS = 180;

export interface AuditEvent {
  schoolId: string | null;
  actorId: string | null;
  action: AuditAction;
  targetType?: 'user' | 'school' | 'classroom' | 'assignment' | 'project' | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  action: AuditAction;
  actor_id: string | null;
  actor_name: string | null;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: Date;
}

/** Début du jour UTC (le Sénégal vit à UTC+0 toute l'année). */
const startOfDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Journal d'audit de l'école. Une écriture qui échoue ne fait pas échouer l'action (elle est
// déjà faite) : elle est seulement signalée dans les journaux du serveur.
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async record(e: AuditEvent, manager?: EntityManager) {
    try {
      await (manager ?? this.db).query(
        `INSERT INTO audit_log (school_id, actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.schoolId, e.actorId, e.action, e.targetType ?? null, e.targetId ?? null, JSON.stringify(e.details ?? {})],
      );
    } catch (err) {
      this.logger.warn(`${e.action}: ${(err as Error).message}`);
    }
  }

  /** Connexions résumées : une ligne `auth.login` par compte et par jour, compteurs ok / failed. */
  async login(user: { id: string; schoolId: string; displayName: string }, ok: boolean) {
    const inc = [ok ? 1 : 0, ok ? 0 : 1];
    try {
      const updated = returningRows<{ id: string }>(
        await this.db.query(
          `UPDATE audit_log SET details = details || jsonb_build_object(
             'ok', COALESCE((details->>'ok')::int, 0) + $4, 'failed', COALESCE((details->>'failed')::int, 0) + $5, 'lastAt', now())
           WHERE school_id = $1 AND target_id = $2 AND action = 'auth.login' AND created_at >= $3 RETURNING id`,
          [user.schoolId, user.id, startOfDay(), ...inc],
        ),
      );
      if (updated.length) return;
      await this.record({
        schoolId: user.schoolId,
        actorId: null,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        details: { name: user.displayName, ok: inc[0], failed: inc[1], lastAt: new Date().toISOString() },
      });
    } catch (err) {
      this.logger.warn(`auth.login: ${(err as Error).message}`);
    }
  }

  /** Entrées de l'école, récentes d'abord ; `before` : identifiant de la dernière entrée déjà lue. */
  async list(schoolId: string, limit: number, before?: string) {
    const params: unknown[] = [schoolId, limit];
    let cond = '';
    if (before) {
      params.push(before);
      // Curseur cohérent avec le tri (date, puis identifiant).
      cond = 'AND (a.created_at, a.id) < (SELECT b.created_at, b.id FROM audit_log b WHERE b.id = $3)';
    }
    const rows: AuditRow[] = await this.db.query(
      `SELECT a.id, a.action, a.actor_id, u.display_name AS actor_name, a.target_type, a.target_id, a.details, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.school_id = $1 ${cond} ORDER BY a.created_at DESC, a.id DESC LIMIT $2`,
      params,
    );
    return rows.map((r) => ({
      id: String(r.id),
      action: r.action,
      actor: r.actor_id ? { id: r.actor_id, displayName: r.actor_name ?? '' } : null,
      targetType: r.target_type,
      targetId: r.target_id,
      details: r.details,
      createdAt: r.created_at,
    }));
  }

  /** Purge : entrées de plus de 180 jours. */
  async purge(): Promise<number> {
    const r = await this.db
      .createQueryBuilder()
      .delete()
      .from(AuditEntry)
      .where('created_at < now() - make_interval(days => :days)', { days: AUDIT_RETENTION_DAYS })
      .execute();
    return r.affected ?? 0;
  }
}
