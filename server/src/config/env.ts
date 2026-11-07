// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Variables d'environnement lues une fois au démarrage : une valeur absente ou invalide
// arrête le serveur tout de suite plutôt qu'au premier appel.
import { availableParallelism } from 'node:os';

export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

/** Secret d'exemple de .env.example : refusé en production. */
export const EXAMPLE_JWT_SECRET = 'change-me-to-a-long-random-secret-of-at-least-32-chars';
// Mots de passe de base par défaut ou d'exemple (docker-compose, documentation) : refusés en production.
const WEAK_DB_PASSWORDS = new Set(['jollof', 'postgres', 'password', 'motdepasse', 'changeme', 'change-me', 'secret', 'admin', 'root', 'example']);

export interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_SSL: 'false' | 'true' | 'no-verify';
  DB_POOL_SIZE: number;
  JWT_SECRET: string;
  CORS_ORIGINS: string[];
  PLATFORM_KEY: string;
  TRIAL_DAYS: number;
  BCRYPT_COST: number;
  BCRYPT_WORKERS: number;
  LOGIN_RATE_LIMIT: number;
  TRUST_PROXY: boolean | number | string;
}

function int(raw: unknown, name: string, def: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max}`);
  }
  return n;
}

/** Mot de passe contenu dans DATABASE_URL ('' s'il n'y en a pas). */
export function databasePassword(url: string): string {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    throw new Error('DATABASE_URL invalide (attendu : postgres://utilisateur:mot-de-passe@hôte:port/base)');
  }
}

/**
 * Production : refuse les secrets d'exemple et les mots de passe par défaut, qui ouvriraient
 * l'école à quiconque a lu la documentation. Renvoie la liste des problèmes (vide si tout va bien).
 */
export function productionProblems(c: Pick<EnvConfig, 'JWT_SECRET' | 'DATABASE_URL' | 'PLATFORM_KEY'>): string[] {
  const problems: string[] = [];
  const secret = c.JWT_SECRET;
  if (secret === EXAMPLE_JWT_SECRET || /change-?me/i.test(secret) || new Set(secret).size < 12) {
    problems.push('JWT_SECRET est le secret d’exemple ou trop peu varié : openssl rand -base64 48');
  }
  const dbPassword = databasePassword(c.DATABASE_URL);
  if (!dbPassword || WEAK_DB_PASSWORDS.has(dbPassword.toLowerCase()) || dbPassword.length < 12) {
    problems.push('le mot de passe de DATABASE_URL (POSTGRES_PASSWORD) est absent, celui par défaut ou trop court (12 caractères au moins) : openssl rand -hex 24');
  }
  if (c.PLATFORM_KEY && (c.PLATFORM_KEY.length < 24 || /change-?me/i.test(c.PLATFORM_KEY))) {
    problems.push('PLATFORM_KEY doit compter au moins 24 caractères aléatoires (ou rester vide)');
  }
  return problems;
}

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');
  const databaseUrl = str('DATABASE_URL');
  if (!databaseUrl) throw new Error('DATABASE_URL manquant');
  const jwtSecret = str('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET doit compter au moins 32 caractères');
  const ssl = str('DATABASE_SSL') || 'false';
  if (!['false', 'true', 'no-verify'].includes(ssl)) throw new Error('DATABASE_SSL : false, true ou no-verify');
  const origins = str('CORS_ORIGINS');
  const trust = str('TRUST_PROXY') || 'false';
  const config: EnvConfig = {
    NODE_ENV: str('NODE_ENV') || 'development',
    PORT: int(raw.PORT, 'PORT', 3100, 1, 65535),
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: ssl as EnvConfig['DATABASE_SSL'],
    // 10 connexions suffisent à une école ; 5 sur un petit boîtier (chaque connexion coûte ~5-10 Mo à PostgreSQL).
    DB_POOL_SIZE: int(raw.DB_POOL_SIZE, 'DB_POOL_SIZE', 10, 1, 100),
    JWT_SECRET: jwtSecret,
    CORS_ORIGINS: origins
      ? origins.split(',').map((o) => o.trim()).filter(Boolean)
      : DEFAULT_CORS_ORIGINS,
    PLATFORM_KEY: str('PLATFORM_KEY'),
    TRIAL_DAYS: int(raw.TRIAL_DAYS, 'TRIAL_DAYS', 30, 1, 3650),
    // 12 en production ; les tests descendent à 4 pour rester rapides.
    BCRYPT_COST: int(raw.BCRYPT_COST, 'BCRYPT_COST', 12, 4, 15),
    // Workers bcrypt (~10 Mo chacun, créés à la demande) : un cœur reste libre pour l'API.
    BCRYPT_WORKERS: int(raw.BCRYPT_WORKERS, 'BCRYPT_WORKERS', Math.max(1, Math.min(4, availableParallelism() - 1)), 1, 16),
    LOGIN_RATE_LIMIT: int(raw.LOGIN_RATE_LIMIT, 'LOGIN_RATE_LIMIT', 10, 1, 100000),
    // Derrière un proxy inverse, l'IP réelle (limite par IP) vient de X-Forwarded-For.
    // false (défaut) : X-Forwarded-For est ignoré ; 1 : un proxy (recommandé) ; liste d'IP ou de sous-réseaux.
    TRUST_PROXY: trust === 'true' ? true : trust === 'false' ? false : /^\d+$/.test(trust) ? Number(trust) : trust,
  };
  databasePassword(databaseUrl);
  if (config.NODE_ENV === 'production') {
    const problems = productionProblems(config);
    if (problems.length) throw new Error(`Configuration refusée en production :\n- ${problems.join('\n- ')}`);
  }
  return config;
}
