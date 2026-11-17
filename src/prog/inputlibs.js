// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Encodeur rotatif KY-040 vu par l'interpréteur (runtime.js) : niveaux de CLK, DT et SW lus par digitalRead(),
// interruptions sur leurs fronts, et la bibliothèque Encoder (Paul Stoffregen).
// Les fronts de chaque cran viennent de sim/encoder.js, à l'heure virtuelle du programme. Une boucle sans delay() ne
// fait pas avancer l'heure pendant une tranche : un front n'y devient visible qu'au tour de loop() suivant celui qui a
// vu le précédent. Deux lectures du même tour (CLK puis DT) voient donc le même état, et aucun front ne se perd.
// Une interruption attachée à CLK ou DT, elle, voit chaque front à son heure exacte (fronts déroulés un par un dans
// irqs()). La bibliothèque Encoder applique sa machine à états à chaque front, comme son interruption sur la vraie carte.
import { createEncTrack, stoffregen } from '../sim/encoder.js';

/**
 * ctx : { at(clé) → [{ comp, pin }], keyOf(n), warn(msg), tl, stat(comp) → { ok }, clock() → ms virtuelles,
 * pass() → numéro du tour de loop(), digitalRead(n), pinMode(n, mode) }.
 * Rend { level(clé) → 0 | 1 | null, irqs(liste, run) → false si une interruption a planté, Encoder }.
 */
export function createInputLibs(ctx) {
  const { at, keyOf, warn, tl, stat, clock } = ctx;
  const encs = new Map(); // id du KY-040 → { tr, q (fronts à venir), cur, lastPass, subs }
  const onEnc = k => (k ? at(k).find(x => x.comp.type === 'ky040' && (x.pin === 'CLK' || x.pin === 'DT' || x.pin === 'SW')) : null);
  function encOf(c) {
    let e = encs.get(c.id);
    if (!e) encs.set(c.id, (e = { tr: createEncTrack(c), q: [], cur: { CLK: 1, DT: 1 }, lastPass: -1, subs: [] }));
    return e;
  }
  const pump = e => { const n = e.tr.pull(clock()); if (n.length) e.q.push(...n); };
  function apply(e) {
    const x = e.q.shift();
    e.cur = { CLK: x.clk, DT: x.dt }; e.lastPass = ctx.pass();
    for (const f of e.subs) f(e.cur);
    return x;
  }
  const due = e => e.q.length && e.q[0].t <= clock();

  /** Niveau d'une broche de la carte reliée à CLK, DT ou SW d'un KY-040 alimenté ; null : lecture ordinaire. */
  function level(k) {
    const h = onEnc(k); if (!h || !stat(h.comp).ok) return null;
    if (h.pin === 'SW') return h.comp.inp && h.comp.inp.sw ? 0 : null; // relâché : la broche n'est tirée que par INPUT_PULLUP
    const e = encOf(h.comp); pump(e);
    if (due(e) && ctx.pass() !== e.lastPass) apply(e);
    return e.cur[h.pin];
  }
  /**
   * Interruptions attachées à CLK ou DT : chaque front dû est appliqué à son heure, run(q, niveau, heure) lance la
   * fonction si le mode le demande. Marque q.enc pour que runtime.js ne les relise pas.
   */
  function irqs(list, run) {
    const by = new Map();
    for (const q of list) {
      const h = onEnc(q.k);
      q.enc = !!h && h.pin !== 'SW' && stat(h.comp).ok;
      if (!q.enc) continue;
      const e = encOf(h.comp);
      if (!by.has(e)) by.set(e, []);
      by.get(e).push({ q, pin: h.pin });
    }
    for (const [e, list2] of by) {
      pump(e);
      while (due(e)) {
        const x = apply(e);
        for (const { q, pin } of list2) {
          const v = e.cur[pin];
          if (v === q.last) continue;
          q.last = v;
          if (!run(q, v, x.t)) return false;
        }
      }
    }
    return true;
  }

  /**
   * Encoder (Paul Stoffregen) : Encoder molette(broche1, broche2) ; read() rend la position en fronts (4 par cran),
   * write(v), readAndReset(). Le signe dépend de l'ordre des broches, comme avec la vraie bibliothèque.
   */
  class Encoder {
    constructor(p1, p2) {
      this.pos = 0; this.p = [p1, p2];
      ctx.pinMode(p1, 2); ctx.pinMode(p2, 2); // la bibliothèque met les deux broches en entrée avec tirage
      const h1 = onEnc(keyOf(p1)), h2 = onEnc(keyOf(p2));
      if (h1 && h2 && h1.comp === h2.comp && h1.pin !== 'SW' && h2.pin !== 'SW' && h1.pin !== h2.pin) {
        this.e = encOf(h1.comp); this.pins = [h1.pin, h2.pin];
        this.state = (this.e.cur[h1.pin] ? 1 : 0) | (this.e.cur[h2.pin] ? 2 : 0);
        this.e.subs.push(cur => this.step(cur[h1.pin], cur[h2.pin]));
      } else {
        this.e = null;
        warn(tl('Encoder({0}, {1}) : ces broches ne sont pas reliées à CLK et DT d’un même encodeur KY-040', p1, p2));
        this.state = (ctx.digitalRead(p1) ? 1 : 0) | (ctx.digitalRead(p2) ? 2 : 0);
      }
    }
    step(a, b) { const r = stoffregen(this.state, a, b); this.state = r.state; this.pos = (this.pos + r.delta) | 0; }
    sync() {
      if (this.e) { pump(this.e); while (due(this.e)) apply(this.e); }
      else this.step(ctx.digitalRead(this.p[0]), ctx.digitalRead(this.p[1]));
    }
    read() { this.sync(); return this.pos; }
    write(v) { this.sync(); this.pos = (+v || 0) | 0; }
    readAndReset() { this.sync(); const p = this.pos; this.pos = 0; return p; }
  }
  return { level, irqs, Encoder };
}
