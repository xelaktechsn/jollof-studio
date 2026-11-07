// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { EnvConfig } from '../config/env';
import { WORDS } from './words';

// bcrypt (coût 12) prend ~350 ms par mot de passe : hors du fil principal, sinon une
// classe de 30 comptes figerait le serveur une dizaine de secondes. Petit pool de workers
// (BCRYPT_WORKERS), créés à la première demande.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const bcrypt = require(workerData.bcryptPath);
parentPort.on('message', (m) => {
  try {
    const result = m.op === 'hash' ? bcrypt.hashSync(m.password, m.cost) : bcrypt.compareSync(m.password, m.hash);
    parentPort.postMessage({ id: m.id, result });
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: String((e && e.message) || e) });
  }
});`;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

class BcryptPool {
  private workers: Worker[] = [];
  private next = 0;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor(private readonly size: number) {}

  private worker(): Worker {
    if (this.workers.length < this.size) {
      const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath: require.resolve('bcryptjs') } });
      w.on('message', (m: { id: number; result?: unknown; error?: string }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
      });
      w.on('error', (e) => this.pending.forEach((p) => p.reject(e)));
      w.unref();
      this.workers.push(w);
      return w;
    }
    this.next = (this.next + 1) % this.workers.length;
    return this.workers[this.next];
  }

  run<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker().postMessage({ ...msg, id });
    });
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}

@Injectable()
export class PasswordService implements OnModuleDestroy {
  private readonly cost: number;
  private readonly pool: BcryptPool;
  // Empreinte factice au même coût : la vérification prend le même temps que le compte
  // existe ou non (pas de découverte des identifiants par chronométrage).
  private dummy?: Promise<string>;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.cost = config.get('BCRYPT_COST', { infer: true });
    this.pool = new BcryptPool(config.get('BCRYPT_WORKERS', { infer: true }));
  }

  hash(password: string): Promise<string> {
    return this.pool.run<string>({ op: 'hash', password, cost: this.cost });
  }

  async verify(password: string, hash: string | null): Promise<boolean> {
    if (!hash) {
      this.dummy ??= this.hash('jollof-dummy-password');
      await this.pool.run<boolean>({ op: 'compare', password, hash: await this.dummy });
      return false;
    }
    return this.pool.run<boolean>({ op: 'compare', password, hash });
  }

  /** Deux mots simples + 3 chiffres, ex. « lune-sable-482 ». */
  temporary(): string {
    const a = WORDS[randomInt(WORDS.length)];
    let b = WORDS[randomInt(WORDS.length)];
    while (b === a) b = WORDS[randomInt(WORDS.length)];
    return `${a}-${b}-${String(randomInt(1000)).padStart(3, '0')}`;
  }

  async onModuleDestroy() {
    await this.pool.close();
  }
}
