// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Controller, Get, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../auth/actor';

@Public()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  @Get()
  async health(@Res({ passthrough: true }) res: Response) {
    try {
      await this.db.query('SELECT 1');
      return { ok: true, db: true };
    } catch {
      res.status(503);
      return { ok: false, db: false };
    }
  }
}
