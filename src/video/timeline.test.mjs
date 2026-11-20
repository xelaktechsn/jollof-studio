// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la timeline vidéo (timeline.js), sous Node : node --test src/video/timeline.test.mjs
// La timeline automatique doit redonner exactement l'animation d'avant (formules recopiées ici).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuto, fitCam, evalAt, end, doneAt, sync, normalize, appendWires, clone, together, planCam, LEAD } from './timeline.js';

/* ---------- Ancienne animation (main.js avant la timeline), recopiée telle quelle ---------- */
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = t => Math.max(0, Math.min(1, t));
function oldRun(mode, n, D, tau) {
  const t = tau - 0.6, prog = [];
  let end, cur = -1, cap;
  if (mode === 'all') { const len = D * 1.8, p = ease(clamp(t / len)); for (let i = 0; i < n; i++) prog.push(p); end = len; cap = t < len ? 'many' : 'done'; }
  else {
    const gap = D * 1.25; for (let i = 0; i < n; i++) prog.push(ease(clamp((t - i * gap) / D)));
    end = n * gap; cur = Math.max(0, Math.min(n - 1, Math.floor(t / gap)));
    cap = t < end ? `wire${cur}` : 'done';
  }
  const hl = mode === 'seq' && t >= 0 && t < end ? cur : -1;
  const on = cur >= 0 && t < end ? cur : -1;
  return { prog, cap, hl, on, end };
}
const oldTotal = (mode, n, D) => 0.6 + (mode === 'all' ? D * 1.8 : n * D * 1.25) + 1.6;
function oldCamAt(shots, f) {
  const n = shots.length; if (!n) return null;
  if (n === 1) return shots[0];
  const x = clamp(f) * (n - 1), i = Math.min(n - 2, Math.floor(x)), k = ease(x - i), A = shots[i], B = shots[i + 1];
  const mix = (a, b) => a.map((v, j) => v + (b[j] - v) * k);
  return { p: mix(A.p, B.p), t: mix(A.t, B.t) };
}

/* ---------- Même lecture, via la timeline ---------- */
function newRun(tl, T, wireIds, shotMap) {
  const r = evalAt(tl, T, shotMap), prog = wireIds.map(w => r.prog.get(w) ?? 1);
  const clip = r.cur >= 0 ? tl.wires[r.cur] : null, single = clip && !together(clip);
  const cap = r.done ? 'done' : clip ? (single ? `wire${r.cur}` : 'many') : 'done';
  const hl = single && r.started && !r.done ? r.cur : -1;
  const on = single && !r.done ? r.cur : -1;
  return { prog, cap, hl, on, cam: r.cam };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const shotsOf = k => Array.from({ length: k }, (_, i) => ({ id: 's' + (i + 1), p: [i * 10, 50 + i, -i * 7], t: [i, 0, i * 2] }));

for (const mode of ['seq', 'all']) {
  for (const n of [1, 5, 40]) {
    for (const D of [0.4, 1.2, 3]) {
      for (const k of [0, 1, 3]) {
        test(`automatique ${mode}, ${n} fils, D=${D}, ${k} plans : identique à l'ancienne animation`, () => {
          const wireIds = Array.from({ length: n }, (_, i) => 'w' + (i + 1)), shots = shotsOf(k);
          const tl = fitCam(buildAuto(mode, wireIds, D), shots.map(s => s.id));
          const total = oldTotal(mode, n, D);
          near(end(tl), total, 'durée totale');
          for (const fps of [30, 60]) assert.equal(Math.ceil(end(tl) * fps), Math.ceil(total * fps), `images à ${fps} i/s`);
          const map = new Map(shots.map(s => [s.id, s]));
          for (let j = 0; j <= 50; j++) {
            const tau = (j / 50) * (total + 0.5);
            const o = oldRun(mode, n, D, tau), m = newRun(tl, tau, wireIds, map);
            o.prog.forEach((p, i) => near(m.prog[i], p, `fil ${i} à ${tau}`));
            assert.equal(m.cap, o.cap, `légende à ${tau}`);
            assert.equal(m.hl, o.hl, `broches allumées à ${tau}`);
            assert.equal(m.on, o.on, `ligne active à ${tau}`);
            const oc = oldCamAt(shots, clamp(tau / total)), nc = m.cam;
            if (!oc) assert.equal(nc, null);
            else { oc.p.forEach((v, i) => near(nc.p[i], v, `caméra p${i} à ${tau}`)); oc.t.forEach((v, i) => near(nc.t[i], v, `caméra t${i} à ${tau}`)); }
          }
        });
      }
    }
  }
}

test('extraits faits à la main : groupe, trou, légende, coupe nette', () => {
  const tl = {
    v: 1, auto: null, camAuto: false, pad: 0, hold: 1.6,
    wires: [{ id: 'c1', ws: ['w1', 'w2'], t: 1, d: 2 }, { id: 'c2', ws: ['w3'], t: 6, d: 1 }],
    cam: [{ id: 'k1', shot: 's1', t: 0, ease: 'smooth' }, { id: 'k2', shot: 's2', t: 4, ease: 'cut' }],
    caps: [{ id: 't1', t: 3.5, d: 1, text: 'Alimentation' }]
  };
  const shots = new Map([['s1', { p: [0, 0, 0], t: [0, 0, 0] }], ['s2', { p: [10, 10, 10], t: [1, 1, 1] }]]);
  let r = evalAt(tl, 0.5, shots);
  assert.equal(r.prog.get('w1'), 0); assert.equal(r.started, false); assert.equal(r.cur, 0);
  r = evalAt(tl, 2, shots);
  near(r.prog.get('w1'), 0.5, 'milieu du groupe'); assert.equal(r.prog.get('w1'), r.prog.get('w2'));
  assert.equal(r.prog.get('w3'), 0); assert.equal(r.cur, 0);
  assert.deepEqual(r.cam.p, [0, 0, 0], 'coupe nette : la caméra attend');
  r = evalAt(tl, 4, shots);
  assert.equal(r.cap.text, 'Alimentation'); assert.deepEqual(r.cam.p, [10, 10, 10], 'coupe nette à 4 s');
  r = evalAt(tl, 5, shots);
  assert.equal(r.cap, null); assert.equal(r.cur, 0, 'trou : l’extrait précédent reste en cours');
  r = evalAt(tl, 6.5, shots);
  assert.equal(r.cur, 1); assert.equal(r.done, false);
  near(doneAt(tl), 7, 'fin des fils'); near(end(tl), 8.6, 'fin de la vidéo');
  assert.equal(evalAt(tl, 7, shots).done, true);
  assert.equal(evalAt(tl, 9, shots).prog.get('w4'), undefined, 'fil hors timeline : main.js le laisse tracé');
});

test('sync : automatique refaite, manuelle élaguée puis complétée', () => {
  const auto = fitCam(buildAuto('seq', ['w1', 'w2'], 1), ['s1', 's2']);
  auto.caps.push({ id: 't1', t: 1, d: 1, text: 'Garde' });
  assert.equal(sync(auto, ['w1', 'w2', 'w3'], ['s1', 's2'], 1), 0);
  assert.equal(auto.wires.length, 3); assert.equal(auto.caps.length, 1, 'légendes gardées');
  near(auto.cam[1].t, end(auto), 'dernier plan à la fin');

  const man = clone(auto); man.auto = null; man.camAuto = false;
  man.wires[0].t = 5; // déplacé à la main
  const added = sync(man, ['w2', 'w3', 'w9'], ['s2', 's3'], 1);
  assert.equal(added, 1, 'w9 ajouté');
  assert.ok(!man.wires.some(c => c.ws.includes('w1')), 'w1 retiré');
  const last = man.wires.find(c => c.ws.includes('w9'));
  const before = Math.max(...man.wires.filter(c => c !== last).map(c => c.t + c.d));
  near(last.t, before + 0.25, 'w9 à la suite');
  assert.deepEqual(man.cam.map(k => k.shot), ['s2', 's3'], 's1 retiré, s3 ajouté en fin');
  assert.ok(man.wires.every((c, i, a) => !i || a[i - 1].t <= c.t), 'extraits triés');
});

test('appendWires : timeline vide, départ à l’amorce', () => {
  const tl = buildAuto('seq', [], 1); tl.auto = null;
  appendWires(tl, ['w1', 'w2'], 2);
  assert.deepEqual(tl.wires.map(c => c.t), [LEAD, LEAD + 2.5]);
});

test('normalize : rejette ce qui n’est pas une timeline et borne le reste', () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize({ wires: 'x' }), null);
  const junk = {
    auto: 'evil', camAuto: false, pad: -5, hold: 1e9,
    wires: [
      { id: 'c1', ws: ['w1', 'w1', '<img>', 'w2'], t: -3, d: 0 },
      { id: 'c1', ws: ['w2', 'w3'], t: 'NaN', d: 1 },
      { id: 'c1', ws: ['w3'], t: 1e12, d: 1e12 },
      null, 'x'
    ],
    cam: [{ id: 'k1', shot: 's1', t: 2, ease: 'boom' }, { shot: '../etc', t: 1 }],
    caps: [{ id: 't1', t: 1, d: 1, text: '<script>alert(1)</script>' }, { t: 1, d: 1, text: '' }]
  };
  const tl = normalize(junk, (s, max) => String(s ?? '').replace(/[<>"'`]/g, '').slice(0, max));
  assert.equal(tl.auto, null); assert.equal(tl.camAuto, false);
  assert.equal(tl.pad, 0); assert.equal(tl.hold, 60);
  assert.deepEqual(tl.wires[0].ws, ['w1', 'w2'], 'doublons et identifiants douteux retirés');
  assert.equal(tl.wires[0].t, 0); assert.equal(tl.wires[0].d, 0.05);
  assert.equal(tl.wires.length, 2, 'extrait sans instant valable retiré');
  assert.deepEqual(tl.wires[1], { id: 'c2', ws: ['w3'], t: 3600, d: 600 }, 'bornes et identifiant refait');
  assert.equal(tl.cam.length, 1); assert.equal(tl.cam[0].ease, 'smooth');
  assert.equal(tl.caps.length, 1); assert.ok(!/[<>]/.test(tl.caps[0].text));
  const ids = [...tl.wires, ...tl.cam, ...tl.caps].map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
});

/* ---------- Caméra calculée et démonstration ---------- */
test('planCam : vue d’ensemble, puis chaque plan tenu pendant ses fils, retour à la vue d’ensemble', () => {
  const tl = buildAuto('seq', ['w1', 'w2', 'w3'], 1);
  tl.camPlan = true;
  const shots = [{ id: 's1', auto: 'all', p: [0, 9, 9], t: [0, 0, 0] }, { id: 's2', auto: 'wire', ws: ['w1', 'w2'], p: [1, 5, 5], t: [1, 0, 0] }, { id: 's3', auto: 'wire', ws: ['w3'], p: [9, 5, 5], t: [9, 0, 0] }];
  sync(tl, ['w1', 'w2', 'w3'], shots.map(s => s.id), 1, shots);
  assert.equal(tl.camAuto, false);
  assert.deepEqual(tl.cam.map(k => k.shot), ['s1', 's2', 's2', 's3', 's3', 's1']);
  for (let i = 1; i < tl.cam.length; i++) assert.ok(tl.cam[i].t >= tl.cam[i - 1].t);
  assert.ok(tl.cam[tl.cam.length - 1].t <= end(tl));
  const map = new Map(shots.map(s => [s.id, s]));
  // Pendant le tracé du fil 2 (même plan que le fil 1), la caméra ne bouge pas.
  const c2 = tl.wires[1];
  assert.deepEqual(evalAt(tl, c2.t + 0.3, map).cam, evalAt(tl, c2.t + 0.6, map).cam);
  assert.deepEqual(evalAt(tl, c2.t + 0.5, map).cam.p, [1, 5, 5]);
  // Pendant le fil 3, elle est sur son plan ; à la fin, sur la vue d'ensemble.
  assert.deepEqual(evalAt(tl, tl.wires[2].t + 0.5, map).cam.p, [9, 5, 5]);
  assert.deepEqual(evalAt(tl, end(tl), map).cam.p, [0, 9, 9]);
  // Fils tracés ensemble : la vue d'ensemble tout du long.
  const all = buildAuto('all', ['w1', 'w2', 'w3'], 1, tl);
  assert.equal(all.camPlan, true);
  planCam(all, shots);
  assert.ok(all.cam.every(k => k.shot === 's1'));
  // Sans vue d'ensemble, rien ne change.
  const none = buildAuto('seq', ['w1'], 1); none.cam = [{ id: 'k1', shot: 's9', t: 0, ease: 'cut' }];
  assert.deepEqual(planCam(none, []).cam, [{ id: 'k1', shot: 's9', t: 0, ease: 'cut' }]);
});

test('démonstration : allonge la vidéo, commence après le câblage, survit à normalize', () => {
  const tl = buildAuto('seq', ['w1', 'w2'], 1), base = end(tl);
  tl.demo = 5;
  assert.equal(end(tl), base + 5);
  assert.equal(evalAt(tl, doneAt(tl) - 0.1, new Map()).demo, false);
  assert.equal(evalAt(tl, doneAt(tl) + 0.7, new Map()).demo, true);
  assert.equal(evalAt(buildAuto('seq', ['w1'], 1), 99, new Map()).demo, false);
  assert.equal(buildAuto('seq', ['w1'], 1, tl).demo, 5);
  const n = normalize(JSON.parse(JSON.stringify({ ...tl, camPlan: true })));
  assert.equal(n.demo, 5); assert.equal(n.camPlan, true); assert.equal(n.camAuto, false);
  assert.equal(normalize({ wires: [], demo: 1e9 }).demo, 120);
  assert.equal('demo' in normalize({ wires: [], demo: -4 }), false);
});
