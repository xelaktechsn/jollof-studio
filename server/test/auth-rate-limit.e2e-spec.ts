// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, TestApp } from './helpers';

describe('Limite de connexion par IP', () => {
  let t: TestApp;

  beforeAll(async () => {
    // Valeur de production pour cette suite seulement (les autres en ont besoin de beaucoup plus).
    process.env.LOGIN_RATE_LIMIT = '10';
    t = await createApp();
  });
  afterAll(async () => {
    process.env.LOGIN_RATE_LIMIT = '1000';
    await t.close();
  });

  it('10 essais par minute et par IP, puis 429 RATE_LIMITED (retryAfter) ; X-Forwarded-For ignoré sans TRUST_PROXY', async () => {
    // Identifiants tous différents : seule la limite par IP joue (pas celle de chaque compte).
    for (let i = 0; i < 10; i++) {
      const r = await anon(t)
        .post('/auth/login', { login: `quelqu.un${i}`, password: 'mauvais-mot' })
        .set('X-Forwarded-For', `203.0.113.${i}`);
      expect(r.status).toBe(401);
    }
    // Changer d'X-Forwarded-For ne contourne pas la limite (proxy non déclaré).
    const blocked = await anon(t).post('/auth/login', { login: 'encore.un', password: 'mauvais-mot' }).set('X-Forwarded-For', '198.51.100.7');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBe(blocked.body.retryAfter);
    // Les autres routes ne sont pas concernées.
    await anon(t).get('/health').expect(200);
  });
});
