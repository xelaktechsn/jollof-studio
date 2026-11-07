// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Source de données de la CLI TypeORM (migration:run, migration:generate…).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { typeOrmOptions } from './options';

const envFile = join(__dirname, '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');

export default new DataSource({
  ...typeOrmOptions(process.env.DATABASE_URL, (process.env.DATABASE_SSL as 'false' | 'true' | 'no-verify') || 'false'),
  migrationsRun: false,
});
