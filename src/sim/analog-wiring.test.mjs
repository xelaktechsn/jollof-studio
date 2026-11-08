// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Câblage automatique des composants analogiques : montage d'application posé avec le composant (NE555 en astable,
// LM358 en non inverseur de gain 2, IRLZ44N avec résistance de grille et rappel, générateur sur une entrée
// analogique), puis le montage obtenu calculé par le solveur. node --test src/sim/analog-wiring.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const THREE = await import('three');
const { BY_ID } = await import('../library/catalog.js');
const { pinKeys } = await import('../check/load.js');
const { analyze, inspect } = await import('./circuit.js');
const { planWiring } = await import('./autowire.js');
const { partOf } = await import('./parts.js');
const { boardOf } = await import('./boards.js');
const { INPUTS } = await import('./models.js');
const { solveDC, resetDynamic } = await import('./dc.js');
const { checkProject } = await import('../check/check.js');

const V3 = THREE.Vector3;
const same = (x, y) => !!x && !!y && x.comp === y.comp && x.key === y.key;

/** Projet minimal qui reproduit applyPlan / wireComp de main.js. */
function project() {
  const S = { comps: [], wires: [], n: 0, log: { helpers: [], warns: [], errors: [], skipped: [] } };
  const nextName = type => { const p = BY_ID[type].pre; let n = 1; while (S.comps.some(c => c.name === p + n)) n++; return p + n; };
  S.create = type => {
    const group = new THREE.Group(), att = {};
    BY_ID[type].build({ g: group, pin: (name, mesh, at) => { let k = name, n = 2; while (att[k]) k = `${name} (${n++})`; att[k] = at ? at.clone() : new V3(); } });
    const keys = Object.keys(att).length ? Object.keys(att) : pinKeys(type);
    const c = { id: `${type}_${S.n++}`, type, name: nextName(type), group, pins: {}, inp: { ...(INPUTS[type] || {}) } };
    for (const k of keys) c.pins[k] = { attach: att[k] || new V3() };
    group.updateMatrixWorld(true); S.comps.push(c); return c;
  };
  S.placeFree = (comp, ox = 0, oz = 0, r0 = 20, dr = 4) => {
    const others = S.comps.filter(c => c !== comp).map(c => new THREE.Box3().setFromObject(c.group).expandByScalar(4));
    const size = new THREE.Box3().setFromObject(comp.group).getSize(new V3());
    for (let i = 0; i < 400; i++) {
      const a = i * 0.7, r = i === 0 ? 0 : r0 + i * dr, x = Math.round(ox + Math.cos(a) * r), z = Math.round(oz + Math.sin(a) * r);
      const b = new THREE.Box3(new V3(x - size.x / 2, 0, z - size.z / 2), new V3(x + size.x / 2, size.y, z + size.z / 2));
      if (!others.some(o => o.intersectsBox(b))) { comp.group.position.set(x, 0, z); comp.group.updateMatrixWorld(true); return; }
    }
  };
  const pinWorld = r => { r.comp.group.updateMatrixWorld(true); return r.comp.group.localToWorld(r.comp.pins[r.key].attach.clone()); };
  const busy = r => S.wires.some(w => same(w.a, r) || same(w.b, r));
  const cx = board => ({ board, A: analyze(S.comps, S.wires), wires: S.wires, comps: S.comps, dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)) });
  const addBreadboard = board => { const c = S.create('breadboard'), q = board.group.position, d = new THREE.Box3().setFromObject(board.group).getSize(new V3()).z; S.placeFree(c, q.x, q.z + d / 2 + 48, 8, 1.5); };
  const apply = (plan, comp, board) => {
    plan.remove.forEach(w => { const i = S.wires.indexOf(w); if (i >= 0) S.wires.splice(i, 1); });
    const made = {}, p = comp.group.position, q = board.group.position;
    plan.create.forEach(h => { const c = S.create(h.type); S.placeFree(c, p.x + (q.x - p.x) * 0.35, p.z + (q.z - p.z) * 0.35, 8, 1.5); made[h.id] = c; S.log.helpers.push(h.type); });
    const R = r => (r.h ? { comp: made[r.h], key: r.key } : r);
    plan.wires.forEach(s => {
      const a = R(s.a), b = R(s.b);
      if (!a.comp || !b.comp || !a.comp.pins[a.key] || !b.comp.pins[b.key] || busy(a) || busy(b)) { S.log.skipped.push(`${a.comp && a.comp.name} ${a.key} ~ ${b.comp && b.comp.name} ${b.key}`); return; }
      S.wires.push({ a, b, color: s.color, role: s.role, progress: 1 });
    });
    return made;
  };
  S.wire = (comp, board, depth = 0) => {
    if (depth > 4) { S.log.errors.push('récursion'); return; }
    let plan = planWiring(comp, cx(board));
    if (plan.needBreadboard) { addBreadboard(board); plan = planWiring(comp, cx(board)); }
    if (plan.error || plan.needBreadboard) { S.log.errors.push(plan.error || `${comp.name} : câblage impossible`); return; }
    S.log.warns.push(...plan.warns);
    const made = apply(plan, comp, board);
    plan.then.forEach(t => S.wire(t.h ? made[t.h] : t.comp, board, depth + 1));
  };
  return S;
}


/** Composant câblé seul sur une carte ; ins : son inspection ; by(type) : le composant d'appoint de ce type. */
function wired(type, bt, inp) {
  const S = project(), board = S.create(bt), comp = S.create(type);
  if (inp) Object.assign(comp.inp, inp);
  S.placeFree(comp); S.wire(comp, board);
  assert.deepEqual([...S.log.warns, ...S.log.skipped, ...S.log.errors], [], `${type} sur ${bt}`);
  const A = analyze(S.comps, S.wires);
  return { S, board, comp, A, ins: inspect(comp, A, partOf(comp)), by: t => S.comps.filter(c => c.type === t) };
}
const linked = (A, a, b) => A.members(a).some(m => same(m, b));

test('NE555 : astable 1 kΩ / 10 kΩ / 100 µF posé avec la minuterie, qui oscille et que la carte lit', () => {
  for (const bt of ['uno', 'esp32', 'pico']) {
    const m = wired('ne555', bt), t = m.comp, [ra] = m.by('res-1k'), rb = m.by('res-10k').find(r => linked(m.A, { comp: r, key: '1' }, { comp: t, key: 'DIS' })), [c] = m.by('cap-100u');
    assert.ok(ra && rb && c, `${bt} : composants d'appoint`);
    assert.ok(linked(m.A, { comp: t, key: 'THR' }, { comp: t, key: 'TRIG' }) && linked(m.A, { comp: t, key: 'THR' }, { comp: c, key: '+' }), `${bt} : THR, TRIG et C+`);
    assert.ok(linked(m.A, { comp: t, key: 'RESET' }, { comp: t, key: 'VCC' }), `${bt} : RESET à VCC`);
    const g = m.ins.io.OUT;
    assert.ok(g && g.comp === m.board, `${bt} : sortie lue par la carte`);
    // 4 s de simulation en direct : la broche de la carte voit la sortie basculer.
    const seen = new Set();
    for (let k = 0; k < 80; k++) { const s = solveDC(m.S.comps, m.A, { prof: boardOf, dt: 0.05, commit: true }); const v = s.volts({ comp: g.comp, key: g.key }); seen.add(v > boardOf(m.board).logic * 0.6 ? 1 : v < 0.8 ? 0 : -1); }
    assert.deepEqual([...seen].sort(), [0, 1], `${bt} : niveaux lus ${[...seen]}`);
    resetDynamic(m.S.comps);
  }
});

test('LM358 : non inverseur de gain 2 vers une entrée analogique ; IN+ reste libre pour le signal', () => {
  for (const bt of ['uno', 'pico']) {
    const m = wired('lm358', bt), op = m.comp, rs = m.by('res-10k');
    assert.equal(rs.length, 2, bt);
    assert.equal(m.ins.io['1OUT'] && m.ins.io['1OUT'].comp, m.board, `${bt} : sortie vers la carte`);
    assert.equal(m.A.deg({ comp: op, key: '1IN+' }), 0, `${bt} : 1IN+ libre`);
    // Un signal de 0,6 V sur IN+ : 1,2 V en sortie.
    const S = m.S, g = S.create('siggen'); g.inp = { wave: 'dc', off: 0.6 };
    S.wires.push({ a: { comp: g, key: 'OUT' }, b: { comp: op, key: '1IN+' }, progress: 1 }, { a: { comp: g, key: 'GND' }, b: { comp: m.board, key: Object.keys(m.board.pins).find(k => /^GND/.test(k) && !S.wires.some(w => same(w.a, { comp: m.board, key: k }) || same(w.b, { comp: m.board, key: k }))) }, progress: 1 });
    const s = solveDC(S.comps, analyze(S.comps, S.wires), { prof: boardOf });
    assert.ok(Math.abs(s.volts({ comp: op, key: '1OUT' }) - 1.2) < 0.01, `${bt} : ${s.volts({ comp: op, key: '1OUT' })} V`);
  }
});

test('IRLZ44N : grille par 220 Ω, rappel de 10 kΩ, source à la masse ; HIGH le rend passant', () => {
  for (const bt of ['uno', 'esp32']) {
    const m = wired('irlz44n', bt), q = m.comp, [rg] = m.by('res-220'), [rp] = m.by('res-10k');
    assert.ok(rg && rp, bt);
    const g = m.ins.link.G ? m.ins.link.G.g : null;
    assert.ok(g && g.comp === m.board, `${bt} : grille commandée par la carte`);
    const on = solveDC(m.S.comps, m.A, { prof: boardOf, pinState: (c, k) => (c === m.board && k === g.key ? { mode: 1, d: 1, pwm: null } : null) }).across(q);
    assert.equal(on.extra.state, 'on', bt);
    assert.ok(Math.abs(on.extra.vgs - boardOf(m.board).logic) < 0.05, `${bt} : VGS ${on.extra.vgs}`); // rappel côté carte : presque toute la tension logique
  }
});

test('Générateur : sortie sur une entrée analogique, masse commune ; le vérificateur prouve sa plage', () => {
  for (const bt of ['uno', 'esp32']) {
    const m = wired('siggen', bt);
    assert.equal(m.ins.io.OUT && m.ins.io.OUT.comp, m.board, bt);
    const ok = checkProject({ comps: m.S.comps, wires: m.S.wires, programs: new Map(), allow: [] });
    assert.equal(ok.errors + ok.warnings, 0, `${bt} : ${ok.diags.map(d => d.code).join(' ')}`);
    // Amplitude trop grande pour la broche : J0303 dans l'état où la sortie est au plus haut.
    m.comp.inp = { wave: 'sine', freq: 50, amp: 3, off: 3 };
    const bad = checkProject({ comps: m.S.comps, wires: m.S.wires, programs: new Map(), allow: [] });
    assert.ok(bad.diags.some(d => d.code === 'J0303'), `${bt} : ${bad.diags.map(d => d.code).join(' ')}`);
  }
});
