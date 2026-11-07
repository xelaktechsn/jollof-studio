// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppError } from '../common/errors';

// Protection de chaque compte contre la devinette de mot de passe (en plus de la limite par IP) :
// les échecs sont comptés par identifiant saisi, que le compte existe ou non (même réponse).
export const FREE_FAILURES = 5;
export const LOCK_FAILURES = 10;
export const LOCK_SECONDS = 15 * 60;
export const BASE_DELAY_SECONDS = 15;
// Les échecs sont oubliés 24 h après le dernier ; une connexion réussie les efface aussitôt.
export const FAILURE_WINDOW_MS = 24 * 3600_000;

/** Attente imposée après `failures` échecs consécutifs : 0, puis 15 s, 30 s, 1, 2, 4 min, puis 15 min. */
export function delayAfter(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  if (failures >= LOCK_FAILURES) return LOCK_SECONDS;
  return BASE_DELAY_SECONDS * 2 ** (failures - FREE_FAILURES);
}

export const rateLimited = (retryAfter: number, message = 'Too many failed login attempts, try again later') =>
  new AppError(429, 'RATE_LIMITED', message, { retryAfter: Math.max(1, Math.ceil(retryAfter)) });

// Nombre d'échecs après cette tentative : remis à 1 si le dernier date de plus de 24 h.
const NEXT = `(CASE WHEN a.last_failure_at < $3 THEN 1 ELSE a.failures + 1 END)`;

@Injectable()
export class LoginAttemptsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Avant de vérifier le mot de passe : la tentative est comptée d'avance comme un échec, en une
   * seule requête atomique (des essais simultanés ne passent pas entre les mailles). Pendant
   * l'attente imposée, rien n'est vérifié : 429 RATE_LIMITED avec `retryAfter` (secondes).
   * Renvoie le nombre d'échecs en comptant celle-ci.
   */
  async begin(login: string, now = new Date()): Promise<number> {
    const rows: { failures: number }[] = await this.db.query(
      `INSERT INTO login_attempts AS a (login, failures, last_failure_at, blocked_until) VALUES ($1, 1, $2, NULL)
       ON CONFLICT (login) DO UPDATE SET
         failures = ${NEXT},
         last_failure_at = $2,
         blocked_until = CASE
           WHEN ${NEXT} >= $5 THEN $2::timestamptz + make_interval(secs => $6)
           WHEN ${NEXT} >= $4 THEN $2::timestamptz + make_interval(secs => $7 * power(2, ${NEXT} - $4))
           ELSE NULL END
       WHERE a.blocked_until IS NULL OR a.blocked_until <= $2
       RETURNING failures`,
      [login, now, new Date(now.getTime() - FAILURE_WINDOW_MS), FREE_FAILURES, LOCK_FAILURES, LOCK_SECONDS, BASE_DELAY_SECONDS],
    );
    if (rows.length) return rows[0].failures;
    const [row]: { blocked_until: Date | null }[] = await this.db.query('SELECT blocked_until FROM login_attempts WHERE login = $1', [login]);
    throw rateLimited(row?.blocked_until ? (row.blocked_until.getTime() - now.getTime()) / 1000 : BASE_DELAY_SECONDS);
  }

  /** Connexion réussie : le compteur repart de zéro. */
  async succeeded(login: string) {
    await this.db.query('DELETE FROM login_attempts WHERE login = $1', [login]);
  }

  /** Mot de passe changé ou réinitialisé : les identifiants du compte sont débloqués. */
  async clear(logins: (string | null | undefined)[]) {
    const list = logins.filter((l): l is string => !!l).map((l) => l.toLowerCase());
    if (list.length) await this.db.query('DELETE FROM login_attempts WHERE login = ANY($1)', [list]);
  }

  /** Purge : compteurs oubliés (plus de 24 h) et plus bloqués. */
  async purge(now = new Date()): Promise<number> {
    const r = await this.db
      .createQueryBuilder()
      .delete()
      .from('login_attempts')
      .where('last_failure_at < :cutoff AND (blocked_until IS NULL OR blocked_until < :now)', { cutoff: new Date(now.getTime() - FAILURE_WINDOW_MS), now })
      .execute();
    return r.affected ?? 0;
  }
}
