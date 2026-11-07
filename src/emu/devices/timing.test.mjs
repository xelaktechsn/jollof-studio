// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modèles temporisés (DHT, DS18B20, HC-SR04) sans processeur émulé : un faux banc joue la carte (sortie forcée ou
// relâchée, résistance de tirage vers HIGH) et vérifie les durées de la fiche technique, à la microseconde.
// node --test src/emu/devices/timing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import dht, { dhtFrame } from './dht.js';
import ds18b20, { romOf, crc8 } from './ds18b20.js';
import hcsr04 from './hcsr04.js';

const MHZ = 16e6, US = MHZ / 1e6;
/** Banc : lignes (sortie de la carte, sinon module, sinon tirage à HIGH), échéancier en cycles. */
function bench() {
  let cycles = 0;
  const q = [], lines = new Map(), cpu = {};
  const L = k => { if (!lines.has(k)) lines.set(k, { out: null, dev: null, level: 1, subs: [] }); return lines.get(k); };
  const update = k => {
    const l = L(k), lv = l.out != null ? l.out : l.dev != null ? +l.dev : 1;
    if (lv !== l.level) { l.level = lv; for (const f of l.subs.slice()) f(lv, cycles); }
  };
  return {
    io: (comp, pins, data) => ({
      cpu, MHZ, comp, pin: k => pins[k] || null, level: k => L(k).level, now: () => cycles, us: n => n * US,
      onEdge: (k, fn) => { L(k).subs.push(fn); return () => L(k).subs.splice(L(k).subs.indexOf(fn), 1); },
      drive: (k, lv) => { L(k).dev = lv == null ? null : !!lv; update(k); },
      after: (c, fn) => { q.push({ at: cycles + Math.max(1, Math.round(c)), fn }); q.sort((a, b) => a.at - b.at); },
      data: () => (typeof data === 'function' ? data() : data)
    }),
    host(k, v) { L(k).out = v; update(k); },
    level: k => L(k).level,
    wait(us) { const end = cycles + us * US; while (q.length && q[0].at <= end) { const e = q.shift(); cycles = e.at; e.fn(); } cycles = end; },
    t: () => cycles / US,
    trace(k) { const ev = []; L(k).subs.push((lv, c) => ev.push([lv, c / US])); return ev; }
  };
}
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

/** La carte envoie l'impulsion de départ ; rend les octets reçus (durées vérifiées) ou null sans réponse. */
function dhtRead(b, startUs) {
  const ev = b.trace('D2');
  b.host('D2', 0); b.wait(startUs); b.host('D2', null);
  const t0 = b.t();
  b.wait(6000);
  const e = ev.filter(([, t]) => t > t0);
  if (!e.length) return null;
  assert.deepEqual(e[0][0], 0); near(e[0][1] - t0, 30);           // réponse 30 µs après le relâchement
  near(e[1][1] - e[0][1], 80); near(e[2][1] - e[1][1], 80);       // 80 µs bas, 80 µs haut
  const bits = [];
  for (let i = 2; i < 82; i += 2) { near(e[i + 1][1] - e[i][1], 50); bits.push(e[i + 2][1] - e[i + 1][1] > 48 ? 1 : 0); }
  near(e[83][1] - e[82][1], 50); assert.equal(e.length, 84); assert.equal(b.level('D2'), 1);
  return Array.from({ length: 5 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((v, x) => (v << 1) | x, 0));
}

test('DHT22 : trame de 40 bits aux durées de la fiche, signe, départ trop court, période de mesure', () => {
  const b = bench(), comp = { id: 'h', type: 'dht22' };
  let d = { temp: -12.4, hum: 87.3 };
  dht.create(comp, b.io(comp, { DATA: 'D2' }, () => d));
  assert.deepEqual(dhtFrame('dht22', d), [0x03, 0x69, 0x80, 0x7c, 0x68]);
  assert.equal(dhtRead(b, 500), null);                              // 0,5 ms : le capteur dort
  assert.deepEqual(dhtRead(b, 1100), dhtFrame('dht22', d));
  d = { temp: 30, hum: 50 };
  b.wait(500000);
  assert.deepEqual(dhtRead(b, 1100), dhtFrame('dht22', { temp: -12.4, hum: 87.3 })); // < 2 s : ancienne mesure
  b.wait(2000000);
  assert.deepEqual(dhtRead(b, 1100), dhtFrame('dht22', d));
});

test('DHT11 : il faut 18 ms de départ ; octets entier puis dixièmes', () => {
  const b = bench(), comp = { id: 'h', type: 'dht11' };
  dht.create(comp, b.io(comp, { DATA: 'D2' }, { temp: 23, hum: 40 }));
  assert.equal(dhtRead(b, 1100), null);
  assert.deepEqual(dhtRead(b, 18000), [40, 0, 23, 0, 63]);
});

/** Maître 1-Wire du banc (créneaux de la fiche : 480 µs, 6/60 µs, lecture à 13 µs). */
function master(b, k) {
  const m = {
    reset() { b.host(k, 0); b.wait(480); b.host(k, null); b.wait(70); const p = !b.level(k); b.wait(410); return p; },
    bit(v) { b.host(k, 0); b.wait(v ? 6 : 60); b.host(k, null); b.wait(v ? 64 : 10); },
    read() { b.host(k, 0); b.wait(3); b.host(k, null); b.wait(10); const r = b.level(k); b.wait(53); return r; },
    write(...bytes) { for (const v of bytes) for (let i = 0; i < 8; i++) m.bit((v >> i) & 1); },
    bytes(n) { return Array.from({ length: n }, () => { let v = 0; for (let i = 0; i < 8; i++) v |= m.read() << i; return v; }); },
    /** Recherche ROM : toutes les adresses du bus (algorithme de la note d'application, dernière divergence). */
    search() {
      const roms = []; let last = -1, prev = [];
      do {
        if (!m.reset()) break;
        m.write(0xf0);
        const bits = []; let disc = -1;
        for (let i = 0; i < 64; i++) {
          const a = m.read(), c = m.read();
          if (a && c) return roms;
          let d = a;
          if (!a && !c) { d = i < last ? prev[i] : i === last ? 1 : 0; if (!d) disc = i; }
          bits.push(d); m.bit(d);
        }
        roms.push(Array.from({ length: 8 }, (_, j) => bits.slice(j * 8, j * 8 + 8).reduce((v, x, n) => v | (x << n), 0)));
        prev = bits; last = disc;
      } while (last >= 0);
      return roms;
    }
  };
  return m;
}

test('DS18B20 : présence, recherche de deux sondes, MATCH ROM, conversion, bloc-notes et CRC', () => {
  const b = bench(), m = master(b, 'D2');
  const temps = { a: 21.3, b: -3.7 }, comps = ['a', 'b'].map(id => ({ id, type: 'ds18b20' }));
  const devs = comps.map(c => ds18b20.create(c, b.io(c, { DQ: 'D2' }, { temp: temps[c.id] })));
  const ev = b.trace('D2');
  b.host('D2', 0); b.wait(480); b.host('D2', null);
  const t0 = b.t();
  b.wait(480);
  const p = ev.filter(([, t]) => t > t0);                          // présence : 30 µs après, 120 µs à LOW
  assert.equal(p.length, 2); near(p[0][1] - t0, 30); near(p[1][1] - t0, 150);
  const roms = m.search();
  assert.equal(roms.length, 2);
  assert.deepEqual(roms.map(r => r.join()).sort(), comps.map(c => romOf(c).join()).sort());
  for (const r of roms) assert.equal(crc8(r, 7), r[7]);
  // 9 bits pour toutes (SKIP ROM + WRITE SCRATCHPAD), conversion : 0 tant qu'elle dure.
  m.reset(); m.write(0xcc, 0x4e, 0x4b, 0x46, 0x1f);
  m.reset(); m.write(0xcc, 0x44);
  assert.equal(m.read(), 0);
  b.wait(80000);
  assert.equal(m.read(), 1);
  for (const c of comps) {
    m.reset(); m.write(0x55, ...romOf(c), 0xbe);
    const sp = m.bytes(9), raw = (sp[1] << 8 | sp[0]) << 16 >> 16;
    assert.equal(crc8(sp, 8), sp[8]);
    assert.equal(sp[4], 0x1f);
    assert.equal(raw / 16, Math.round(temps[c.id] * 2) / 2); // 9 bits : pas de 0,5 °C
  }
  // Recherche d'alarme : TL = 70 °C (réglage d'usine) dépasse 21,5 et -3,5 °C : les deux sondes y participent.
  assert.equal(m.reset(), true); m.write(0xec);
  assert.deepEqual([m.read(), m.read()], [0, 1]);
  // Remise à zéro trop courte : pas de présence.
  b.host('D2', 0); b.wait(100); b.host('D2', null); b.wait(70); assert.equal(b.level('D2'), 1); b.wait(400);
  devs.forEach(d => d.dispose());
  assert.equal(m.reset(), false);
});

test('HC-SR04 : écho 250 µs après TRIG, largeur data.us, 38 ms sans écho, impulsion trop courte ignorée', () => {
  const b = bench(), comp = { id: 's', type: 'hcsr04' };
  let d = { dist: 20, us: 1160 };
  hcsr04.create(comp, b.io(comp, { TRIG: 'D9', ECHO: 'D10' }, () => d));
  b.host('D9', 0);                                                  // TRIG : sortie de la carte, LOW au repos
  assert.equal(b.level('D10'), 0);
  const ev = b.trace('D10');
  const ping = w => { b.host('D9', 1); b.wait(w); b.host('D9', 0); const t = b.t(); b.wait(50000); return ev.splice(0).map(([lv, x]) => [lv, x - t]); };
  const e = ping(10);
  assert.equal(e.length, 2); near(e[0][1], 250); near(e[1][1] - e[0][1], 1160);
  assert.deepEqual(ping(5), []);
  d = { dist: 0, us: 0 };
  const n = ping(10);
  near(n[1][1] - n[0][1], 38000);
});
