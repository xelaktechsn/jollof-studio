// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { SnakeNamingStrategy } from './naming';

export function typeOrmOptions(url: string, ssl: 'false' | 'true' | 'no-verify' = 'false', poolSize = 10): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    ssl: ssl === 'false' ? false : { rejectUnauthorized: ssl === 'true' },
    entities: ENTITIES,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    migrationsTableName: 'migrations',
    // Le schéma ne bouge que par migrations ; celles en attente passent au démarrage.
    synchronize: false,
    migrationsRun: true,
    namingStrategy: new SnakeNamingStrategy(),
    uuidExtension: 'pgcrypto',
    // Pas de journal des requêtes en échec : il contiendrait leurs paramètres (empreintes…).
    logging: ['migration'],
    // Pool de connexions (DB_POOL_SIZE) ; pg ferme celles restées inactives 10 s.
    extra: { max: poolSize },
  };
}
