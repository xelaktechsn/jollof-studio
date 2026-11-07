// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { BASE_DELAY_SECONDS, delayAfter, FREE_FAILURES, LOCK_FAILURES, LOCK_SECONDS, rateLimited } from './login-attempts.service';

describe('délai après des échecs de connexion', () => {
  it('5 échecs libres, puis 15 s doublées à chaque échec, 15 min à partir de 10', () => {
    expect(FREE_FAILURES).toBe(5);
    expect(LOCK_FAILURES).toBe(10);
    expect([0, 1, 4].map(delayAfter)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8, 9].map(delayAfter)).toEqual([15, 30, 60, 120, 240]);
    expect([10, 11, 50].map(delayAfter)).toEqual([LOCK_SECONDS, LOCK_SECONDS, LOCK_SECONDS]);
    expect(LOCK_SECONDS).toBe(900);
    expect(delayAfter(LOCK_FAILURES - 1)).toBeLessThan(LOCK_SECONDS);
    expect(BASE_DELAY_SECONDS).toBe(15);
  });

  it('429 RATE_LIMITED avec retryAfter entier, au moins 1 s', () => {
    const e = rateLimited(0.2);
    expect(e.getStatus()).toBe(429);
    expect(e.getResponse()).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 1 });
    expect(rateLimited(14.01).getResponse()).toMatchObject({ retryAfter: 15 });
  });
});
