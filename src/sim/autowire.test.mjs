// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Câblage automatique « zéro faute » : chaque composant de la bibliothèque, câblé seul sur chaque carte (comme le fait
// main.js : breadboard ajoutée au besoin, composants auxiliaires créés et câblés à leur tour), puis des montages à
// plusieurs modules, doivent passer le vérificateur sans erreur ni avertissement : sans programme, avec un programme
// qui utilise chaque broche, avec le programme automatique des règles. node --test src/sim/autowire.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// Les modèles 3D dessinent leurs étiquettes sur des canvas : un document factice suffit sous Node.
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const THREE = await import('three');
const { LIBRARY, BY_ID } = await import('../library/catalog.js');
const { pinKeys } = await import('../check/load.js');
const { analyze, inspect } = await import('./circuit.js');
const { planWiring } = await import('./autowire.js');
const { partOf } = await import('./parts.js');
const { boardOf, codePin } = await import('./boards.js');
const { INPUTS } = await import('./models.js');
const { solveDC } = await import('./dc.js');
const { checkProject } = await import('../check/check.js');
const { generate } = await import('../prog/rules.js');
// Composants en paquet (.jpart, src/library/packs) : installés dans la bibliothèque, ils passent le même audit.
{
  const fs = await import('node:fs'), J = await import('../library/jpart.js'), P = await import('../library/packages.js');
  const dir = new URL('../library/packs/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) await P.installBytes(J.packJpart({ manifest: JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')) }));
}
const { isResistor } = await import('./pkgparts.js');

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

/** Programme qui utilise chaque broche reliée à la carte selon ce que la fiche demande. */
function nominal(S, board) {
  const A = analyze(S.comps, S.wires), glob = new Set(), setup = [], loop = [];
  let i = 0;
  for (const c of S.comps) {
    if (boardOf(c) || /^breadboard/.test(c.type)) continue;
    const spec = partOf(c); if (!spec || !spec.pins) continue;
    const ins = inspect(c, A, spec);
    for (const p of spec.pins) {
      const g = p.kind === 'io' && ins.io[p.pin]; if (!g || g.comp !== board) continue;
      const N = codePin({ comp: g.comp, key: g.key });
      switch (p.need) {
        case 'out': setup.push(`pinMode(${N}, OUTPUT);`); loop.push(`digitalWrite(${N}, HIGH);`); break;
        case 'pwm': setup.push(`pinMode(${N}, OUTPUT);`); loop.push(`analogWrite(${N}, 128);`); break;
        case 'in': setup.push(`pinMode(${N}, INPUT);`); loop.push(`v = v + digitalRead(${N});`); break;
        case 'adc': loop.push(`v = v + analogRead(${N});`); break;
        case 'pullup': setup.push(`pinMode(${N}, INPUT_PULLUP);`); loop.push(`v = v + digitalRead(${N});`); break;
        case 'io':
          if (/^dht/.test(c.type)) { glob.add('#include <DHT.h>'); glob.add(`DHT d${i}(${N}, ${c.type.toUpperCase()});`); setup.push(`d${i}.begin();`); i++; }
          else if (c.type === 'ds18b20') { glob.add('#include <OneWire.h>'); glob.add(`OneWire o${i++}(${N});`); }
          break;
        default: break;
      }
    }
  }
  return `${[...glob].join('\n')}\nint v = 0;\nvoid setup() {\n  ${setup.join('\n  ')}\n}\nvoid loop() {\n  ${loop.join('\n  ')}\n}\n`;
}

const diagText = r => r.diags.map(d => `${d.level} ${d.code} ${d.title}${d.state ? ` [${d.state}]` : ''}`).join('\n');
function verify(S, board, what) {
  const A = analyze(S.comps, S.wires), cache = new Map(), insp = c => cache.get(c) || (cache.set(c, inspect(c, A, partOf(c))), cache.get(c));
  const auto = generate(board, { comps: S.comps, A, inspect: insp, rules: [], states: {} });
  for (const [label, code, isAuto] of [['sans programme', null], ['programme nominal', nominal(S, board)], ['programme automatique (règles)', auto, true]]) {
    const r = checkProject({ comps: S.comps, wires: S.wires, programs: code ? new Map([[board.id, code]]) : new Map(), auto: new Set(isAuto ? [board.id] : []), allow: [] });
    assert.equal(r.errors + r.warnings, 0, `${what}, ${label} :\n${diagText(r)}`);
  }
}

const BOARD_TYPES = ['uno', 'nano', 'esp32', 'nodemcu', 'pico'];
const PARTS_TO_WIRE = LIBRARY.filter(e => !['Cartes', 'Prototypage'].includes(e.cat) && !/^(res-|diode$|mb102$|lm7805$|cap-)/.test(e.id) && !isResistor(e.id)).map(e => e.id);
assert.ok(PARTS_TO_WIRE.includes('pk-led-red') && PARTS_TO_WIRE.includes('pk-ldr'), 'les paquets sont audités');
// Combinaisons physiquement impossibles : le câblage est refusé avec une explication (rien n'est câblé à moitié).
const REFUSED = new Set(['joystick@nodemcu', 'bat9v@pico', 'bat18650@uno', 'bat18650@nano', 'bat18650@esp32', 'bat18650@nodemcu']);

test('Chaque composant, câblé seul sur chaque carte, passe le vérificateur sans erreur ni avertissement', () => {
  for (const type of PARTS_TO_WIRE) for (const bt of BOARD_TYPES) {
    const S = project(), board = S.create(bt), comp = S.create(type), what = `${type} sur ${bt}`;
    S.placeFree(comp);
    S.wire(comp, board);
    assert.deepEqual(S.log.warns, [], `${what} : avertissements du câblage`);
    assert.deepEqual(S.log.skipped, [], `${what} : fils non posés`);
    if (REFUSED.has(`${type}@${bt}`)) { assert.equal(S.log.errors.length, 1, `${what} : doit être refusé`); assert.equal(S.wires.length, 0, `${what} : rien ne doit être câblé`); continue; }
    assert.deepEqual(S.log.errors, [], `${what} : refusé`);
    verify(S, board, what);
  }
});

const COMBOS = [
  ['uno', ['lcd1602', 'bmp280', 'button', 'led-red', 'fan', 'buzzer']],
  ['esp32', ['lcd1602', 'bmp280', 'oled', 'hcsr04', 'servo', 'relay']],
  ['uno', ['rc522', 'nrf24']],
  ['nodemcu', ['oled', 'dht22', 'button', 'led-red', 'buzzer']],
  ['pico', ['lcd1602', 'mq2', 'hcsr04', 'pump', 'speaker']],
  ['nano', ['hc05', 'ds18b20', 'vibro', 'pot', 'led-green']],
  ['uno', ['button', 'button', 'lcd1602', 'mpu6050', 'bmp280']],
  ['esp32', ['dcmotor', 'fan', 'pump', 'ir', 'ldr']],
  ['uno', ['sim800', 'hc05', 'led-rgb']],
  ['pico', ['rc522', 'oled', 'buzzer', 'button']]
];
test('Montages à plusieurs modules (bus partagés, adaptateurs, étages de puissance) : zéro faute', () => {
  for (const [bt, list] of COMBOS) {
    const S = project(), board = S.create(bt), what = `${list.join(' + ')} sur ${bt}`;
    for (const type of list) { const c = S.create(type); S.placeFree(c); S.wire(c, board); }
    assert.deepEqual([...S.log.warns, ...S.log.skipped, ...S.log.errors], [], what);
    verify(S, board, what);
  }
});

/** Montage câblé automatiquement et calcul du circuit, sorties de la carte à HIGH. */
function solved(type, bt, sensor = () => null, inputs = []) {
  const S = project(), board = S.create(bt), comp = S.create(type);
  S.placeFree(comp); S.wire(comp, board);
  const A = analyze(S.comps, S.wires), ins = inspect(comp, A, partOf(comp)), inKeys = new Set(inputs.map(k => ins.io[k] && ins.io[k].key));
  const dc = solveDC(S.comps, A, { pinState: (c, k) => (c === board && !inKeys.has(k) ? { mode: 1, d: 1, pwm: null } : null), sensorVolts: (c, k) => sensor(c, k) });
  return { S, board, comp, A, ins, dc, by: t => S.comps.find(c => c.type === t) };
}

test('Ventilateur, pompe, vibreur : PN2222A saturé, diode de roue libre, tension nominale', () => {
  for (const [type, lo, hi] of [['fan', 4.5, 5.1], ['pump', 4.5, 5.1], ['vibro', 2.7, 3.3]]) for (const bt of ['uno', 'esp32', 'pico']) {
    const m = solved(type, bt), q = m.dc.across(m.by('pn2222')), load = m.dc.across(m.comp), d = m.by('diode');
    assert.equal(q.extra.state, 'sat', `${type} sur ${bt} : transistor saturé`);
    assert.ok(load.v >= lo && load.v <= hi, `${type} sur ${bt} : ${load.v} V`);
    // Diode en inverse aux bornes de la charge : cathode au +, anode au −.
    assert.ok(m.A.members({ comp: d, key: 'K' }).some(x => x.comp === m.comp && x.key === '+') || m.dc.volts({ comp: d, key: 'K' }) > 4, `${type} sur ${bt} : cathode au +`);
    assert.ok(m.A.members({ comp: d, key: 'A' }).some(x => x.comp === m.comp && x.key === '-'), `${type} sur ${bt} : anode au −`);
  }
});

test('Buzzer derrière un BC547 : la broche ne fournit que le courant de base', () => {
  for (const bt of BOARD_TYPES) {
    const m = solved('buzzer', bt), q = m.dc.across(m.by('npn'));
    assert.equal(q.extra.state, 'sat', bt);
    assert.ok(q.extra.ib < 5, `${bt} : courant de base ${q.extra.ib} mA`);
    assert.ok(m.dc.across(m.comp).v > 4.5, `${bt} : buzzer sous ${m.dc.across(m.comp).v} V`);
  }
});

test('HC-SR04 sur une carte 3,3 V : pont diviseur 4,7 kΩ / 10 kΩ, ECHO lu entre 2,3 et 3,6 V', () => {
  for (const bt of ['esp32', 'nodemcu', 'pico']) {
    const m = solved('hcsr04', bt, (c, k) => (c.type === 'hcsr04' && k === 'ECHO' ? 5 : null), ['ECHO']);
    const g = m.ins.io.ECHO, v = m.dc.volts({ comp: g.comp, key: g.key });
    assert.equal(m.ins.link.ECHO.kind, 'div', bt);
    assert.ok(v > 2.3 && v < 3.6, `${bt} : ECHO à ${v} V sur ${g.key}`);
  }
});

test('RC522 sur une carte 5 V : adaptateur de niveau, ses entrées restent sous 3,6 V', () => {
  for (const bt of ['uno', 'nano']) {
    const m = solved('rc522', bt, () => null, ['MISO']);
    for (const k of ['SDA', 'SCK', 'MOSI', 'RST']) {
      const v = m.dc.volts({ comp: m.comp, key: k });
      assert.equal(m.ins.link[k].kind, 'shift', `${bt} ${k}`);
      assert.ok(v > 2.3 && v < 3.6, `${bt} : ${k} à ${v} V`);
    }
  }
});

test('Accu 18650 sur le VSYS du Pico : diode anti-retour, pas de court-circuit avec l’USB', () => {
  const S = project(), board = S.create('pico'), bat = S.create('bat18650');
  S.placeFree(bat); S.wire(bat, board);
  assert.deepEqual(S.log.helpers, ['diode']);
  const A = analyze(S.comps, S.wires);
  assert.equal(A.issues.length, 0, A.issues.map(i => i.text).join('\n'));
});

/** Montage écrit à la main : [type, id], liens [id, broche, id, broche]. */
function manual(parts, links) {
  const comps = parts.map(([type, id]) => ({ id, type, name: id, pins: Object.fromEntries(pinKeys(type).map(k => [k, {}])), inp: { ...(INPUTS[type] || {}) } }));
  const by = Object.fromEntries(comps.map(c => [c.id, c]));
  const wires = links.map(([a, ka, b, kb]) => ({ a: { comp: by[a], key: ka }, b: { comp: by[b], key: kb }, progress: 1 }));
  const A = analyze(comps, wires);
  return { comps, wires, by, A, codes: id => Object.values(inspect(by[id], A, partOf(by[id])).pins).flatMap(p => p.msgs.map(x => x.code)) };
}
const HCSR = (top, bot) => manual([['esp32', 'U'], ['hcsr04', 'US'], [top, 'RT'], [bot, 'RB']],
  [['US', 'VCC', 'U', 'VIN'], ['US', 'GND', 'U', 'GND'], ['US', 'TRIG', 'U', 'D4'], ['US', 'ECHO', 'RT', '1'], ['RT', '2', 'U', 'D27'], ['RB', '1', 'U', 'D27'], ['RB', '2', 'U', 'GND (2)']]);

test('Vérificateur : un pont diviseur se vérifie à son rapport', () => {
  assert.deepEqual(HCSR('res-4k7', 'res-10k').codes('US'), [], '4,7 kΩ / 10 kΩ : 3,4 V');
  assert.deepEqual(HCSR('res-1k', 'res-10k').codes('US'), ['lv5'], '1 kΩ / 10 kΩ : 4,5 V, trop');
  assert.deepEqual(HCSR('res-10k', 'res-1k').codes('US'), ['lv5'], '10 kΩ / 1 kΩ : 0,45 V, la carte lit LOW');
});

test('Vérificateur : adaptateur de niveau, chaque côté à sa tension', () => {
  const lcd = (lvSide) => manual([['esp32', 'U'], ['lcd1602', 'L'], ['lvlshift', 'S']], [
    ['L', 'VCC', 'U', 'VIN'], ['L', 'GND', 'U', 'GND'], ['S', 'LV', 'U', '3V3'], ['S', 'HV', 'U', 'VIN'], ['S', 'GND', 'U', 'GND (2)'],
    ['L', 'SDA', 'S', lvSide ? 'LV1' : 'HV1'], ['S', lvSide ? 'HV1' : 'LV1', 'U', 'D21'], ['L', 'SCL', 'S', lvSide ? 'LV2' : 'HV2'], ['S', lvSide ? 'HV2' : 'LV2', 'U', 'D22']]);
  const ok = lcd(false);
  assert.deepEqual(ok.codes('L'), [], 'écran 5 V côté HV, carte côté LV');
  assert.deepEqual(ok.codes('S'), []);
  assert.equal(inspect(ok.by.L, ok.A, partOf(ok.by.L)).board, ok.by.U, 'la carte est trouvée à travers l’adaptateur');
  assert.deepEqual(lcd(true).codes('L'), ['lv5', 'lv5'], 'branché à l’envers');
});
