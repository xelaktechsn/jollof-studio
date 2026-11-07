// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { EXAMPLE_JWT_SECRET, productionProblems, validateEnv } from './env';

const STRONG_SECRET = 'q8Vx2LmN0pR7sT4uW1yZ3aB6cD9eF5gH8jK2nP4rS7tV0wX3';
const base = {
  DATABASE_URL: 'postgres://jollof:9f3c1a7e5b2d8f4a6c0e1b3d@db:5432/jollof',
  JWT_SECRET: STRONG_SECRET,
};

describe('validateEnv', () => {
  it('valeurs par défaut et conversions', () => {
    const c = validateEnv({ ...base });
    expect(c).toMatchObject({ NODE_ENV: 'development', PORT: 3100, DB_POOL_SIZE: 10, BCRYPT_COST: 12, LOGIN_RATE_LIMIT: 10, TRUST_PROXY: false });
    expect(c.BCRYPT_WORKERS).toBeGreaterThanOrEqual(1);
    expect(validateEnv({ ...base, DB_POOL_SIZE: '5', BCRYPT_WORKERS: '2' })).toMatchObject({ DB_POOL_SIZE: 5, BCRYPT_WORKERS: 2 });
    expect(() => validateEnv({ ...base, DB_POOL_SIZE: '0' })).toThrow(/DB_POOL_SIZE/);
    expect(validateEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(validateEnv({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(validateEnv({ ...base, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).TRUST_PROXY).toBe('loopback, 10.0.0.0/8');
    expect(() => validateEnv({ ...base, JWT_SECRET: 'court' })).toThrow(/32/);
    expect(() => validateEnv({ ...base, DATABASE_URL: 'pas une url' })).toThrow(/DATABASE_URL/);
  });

  it('hors production, les valeurs d’exemple passent (développement, tests)', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgres://jollof:jollof@localhost:5433/jollof', JWT_SECRET: EXAMPLE_JWT_SECRET })).not.toThrow();
  });

  it('production : refuse le secret d’exemple, le mot de passe de base par défaut et une clé faible', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => validateEnv(prod)).not.toThrow();
    expect(() => validateEnv({ ...prod, JWT_SECRET: EXAMPLE_JWT_SECRET })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...prod, JWT_SECRET: 'a'.repeat(40) })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...prod, JWT_SECRET: `change-me-${STRONG_SECRET}` })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...prod, DATABASE_URL: 'postgres://jollof:jollof@db:5432/jollof' })).toThrow(/POSTGRES_PASSWORD/);
    expect(() => validateEnv({ ...prod, DATABASE_URL: 'postgres://jollof:Postgres@db:5432/jollof' })).toThrow(/POSTGRES_PASSWORD/);
    expect(() => validateEnv({ ...prod, DATABASE_URL: 'postgres://jollof@db:5432/jollof' })).toThrow(/POSTGRES_PASSWORD/);
    expect(() => validateEnv({ ...prod, DATABASE_URL: 'postgres://jollof:court@db:5432/jollof' })).toThrow(/POSTGRES_PASSWORD/);
    expect(() => validateEnv({ ...prod, PLATFORM_KEY: 'petite-cle' })).toThrow(/PLATFORM_KEY/);
    expect(() => validateEnv({ ...prod, PLATFORM_KEY: 'a604cd5a8d38067795f9229e7786423dc8cde5d0' })).not.toThrow();
  });

  it('liste tous les problèmes d’un coup', () => {
    const problems = productionProblems({ JWT_SECRET: EXAMPLE_JWT_SECRET, DATABASE_URL: 'postgres://jollof:jollof@db/jollof', PLATFORM_KEY: 'x' });
    expect(problems).toHaveLength(3);
  });
});
