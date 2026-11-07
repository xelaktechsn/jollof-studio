// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Limiteur en mémoire à fenêtre fixe (une seule instance du serveur, comme la présence) :
// au plus `limit` actions par clé et par fenêtre de `windowMs`. Une entrée par clé active,
// effacée quand sa fenêtre est passée : la mémoire reste bornée par le nombre d'utilisateurs actifs.
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Compte une action ; renvoie 0 si elle est permise, sinon l'attente en secondes (≥ 1). */
  hit(key: string): number {
    const now = this.now();
    this.sweep(now);
    let e = this.hits.get(key);
    if (!e || now >= e.resetAt) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    return e.count > this.limit ? Math.max(1, Math.ceil((e.resetAt - now) / 1000)) : 0;
  }

  get size() {
    return this.hits.size;
  }

  // Ménage paresseux, au plus une fois par fenêtre : pas de minuterie à arrêter.
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, e] of this.hits) if (now >= e.resetAt) this.hits.delete(k);
  }
}
