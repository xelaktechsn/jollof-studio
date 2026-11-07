// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { TokensService } from '../auth/tokens.service';

const FIRST_RUN_MS = 60_000;
const EVERY_MS = 3600_000;

// Ménage périodique (toutes les heures) : la base d'un petit boîtier ne doit pas grossir sans
// fin. Journal d'audit au-delà de 180 jours, compteurs d'échecs oubliés, jetons de
// rafraîchissement expirés ou révoqués depuis plus de 7 jours.
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly audit: AuditService,
    private readonly attempts: LoginAttemptsService,
    private readonly tokens: TokensService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.run().catch((e) => this.logger.warn(`purge: ${(e as Error).message}`));
    this.timers = [setTimeout(run, FIRST_RUN_MS), setInterval(run, EVERY_MS)];
    this.timers.forEach((t) => t.unref());
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async run() {
    const [audit, attempts, tokens] = [await this.audit.purge(), await this.attempts.purge(), await this.tokens.purge()];
    if (audit + attempts + tokens) this.logger.log(`purge : ${audit} entrées d'audit, ${attempts} compteurs, ${tokens} jetons`);
    return { audit, attempts, tokens };
  }
}
