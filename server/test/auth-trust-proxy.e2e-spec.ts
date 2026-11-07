// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { anon, createApp, TestApp } from './helpers';

// Fichier à part : la configuration est lue une fois par fichier de test.
describe('TRUST_PROXY=1 : IP réelle donnée par le proxy inverse', () => {
  let t: TestApp;

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT = '3';
    process.env.TRUST_PROXY = '1';
    t = await createApp();
  });
  afterAll(async () => {
    process.env.LOGIN_RATE_LIMIT = '1000';
    process.env.TRUST_PROXY = 'false';
    await t.close();
  });

  it('la limite suit X-Forwarded-For (dernier saut ajouté par le proxy), pas la falsification du client', async () => {
    const attempt = (xff: string, i: number) => anon(t).post('/auth/login', { login: `x${xff}${i}`, password: 'mauvais-mot' }).set('X-Forwarded-For', xff);
    for (let i = 0; i < 3; i++) expect((await attempt('203.0.113.10', i)).status).toBe(401);
    expect((await attempt('203.0.113.10', 9)).status).toBe(429);
    // Un autre client derrière le même proxy a son propre compteur.
    expect((await attempt('203.0.113.20', 0)).status).toBe(401);
    // Le client qui préfixe une fausse adresse reste identifié par celle que le proxy a ajoutée.
    expect((await attempt('1.2.3.4, 203.0.113.10', 0)).status).toBe(429);
  });
});
