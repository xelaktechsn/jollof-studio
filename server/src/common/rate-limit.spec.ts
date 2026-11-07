// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('limit actions par fenêtre et par clé, puis attente en secondes', () => {
    let now = 1_000_000;
    const rl = new RateLimiter(3, 10_000, () => now);
    expect([rl.hit('a'), rl.hit('a'), rl.hit('a')]).toEqual([0, 0, 0]);
    expect(rl.hit('a')).toBe(10);
    expect(rl.hit('b')).toBe(0);
    now += 4_500;
    expect(rl.hit('a')).toBe(6);
    now += 5_500;
    expect(rl.hit('a')).toBe(0);
  });

  it('les clés inactives sont effacées (mémoire bornée)', () => {
    let now = 0;
    const rl = new RateLimiter(1, 1_000, () => now);
    for (let i = 0; i < 100; i++) rl.hit(`k${i}`);
    expect(rl.size).toBe(100);
    now += 1_000;
    rl.hit('nouveau');
    expect(rl.size).toBe(1);
  });
});
