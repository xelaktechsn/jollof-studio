// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests des paquets de composants .jpart (library/jpart.js, library/packages.js) : node --test src/library/packages.test.mjs
// Manifestes refusés (code, taille, broches incohérentes, sources manquantes), aller-retour de l'archive, et preuve
// d'équivalence : la LED rouge, la résistance de 220 Ω et le module photorésistance en paquet (src/library/packs)
// donnent exactement les mêmes diagnostics du vérificateur et les mêmes tensions et courants que ceux de la
// bibliothèque, sur les mêmes montages. Enfin, chaque paquet se câble seul sur chaque carte sans aucune faute.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

// Les modèles 3D dessinent sur des canvas : un document factice suffit sous Node (comme autowire.test.mjs).
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const THREE = await import('three');
const J = await import('./jpart.js');
const P = await import('./packages.js');
const { LIBRARY, BY_ID } = await import('./catalog.js');
const { loadProject, pinKeys } = await import('../check/load.js');
const { checkProject } = await import('../check/check.js');
const { analyze, inspect } = await import('../sim/circuit.js');
const { solveDC } = await import('../sim/dc.js');
const { collectFaults } = await import('../sim/faults.js');
const { partOf, PARTS } = await import('../sim/parts.js');
const { MODELS, INPUTS } = await import('../sim/models.js');
const { DOCS } = await import('./docs.js');
const { SOURCES } = await import('../check/sources.js');
const { PKG_SYMBOLS, layoutSchematic } = await import('../schematic/sheet.js');
const { planWiring } = await import('../sim/autowire.js');
const { boardOf } = await import('../sim/boards.js');
const { generate } = await import('../prog/rules.js');

const ROOT = new URL('../../', import.meta.url);
const pack = id => JSON.parse(fs.readFileSync(new URL(`src/library/packs/${id}.json`, ROOT), 'utf8'));
const PACKS = ['pk-led-red', 'pk-res-220', 'pk-ldr'];
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- Validation ---------- */
const bad = (mutate, re) => {
  const m = clone(pack('pk-ldr')); mutate(m);
  const v = J.validateManifest(m);
  assert.equal(v.ok, false, `devait être refusé : ${re}`);
  assert.match(v.errors.join('\n'), re);
};

test('Manifeste : les trois paquets de preuve sont valides et le manifeste lu est stable', () => {
  for (const id of PACKS) {
    const v = J.validateManifest(pack(id));
    assert.ok(v.ok, `${id} : ${(v.errors || []).join(' ; ')}`);
    assert.deepEqual(J.validateManifest(v.manifest).manifest, v.manifest, `${id} : relire le manifeste propre le laisse inchangé`);
  }
});

test('Manifeste : aucun code, aucun champ inconnu, aucune clé dangereuse', () => {
  bad(m => { m.behaviour.read = 'return 1'; }, /behaviour\.read : champ inconnu/);
  bad(m => { m.behaviour.analogOut.formula = 'x * 2'; }, /formula : champ inconnu/);
  bad(m => { m.script = '<script>alert(1)</script>'; }, /script : champ inconnu/);
  bad(m => { m.onload = 'x'; }, /onload : champ inconnu/);
  bad(m => { m.pins[0].code = 'digitalWrite(1)'; }, /code : champ inconnu/);
  const poison = JSON.parse('{"__proto__": {"polluted": true}}');
  bad(m => { m.docs = poison; }, /clé interdite/);
  bad(m => { m.behaviour = JSON.parse('{"constructor": {"prototype": {"x": 1}}}'); }, /clé interdite/);
  assert.equal(({}).polluted, undefined, 'aucune pollution de prototype');
  bad(m => { m.behaviour.analogOut.quantity = 'process.exit'; }, /quantity : valeur invalide/);
  bad(m => { m.format = 2; }, /format 1 attendu/);
  bad(m => { m.id = 'ldr'; }, /id : valeur invalide/); // un paquet ne peut pas remplacer un composant de la bibliothèque
  bad(m => { m.id = 'pk-../../x'; }, /id : valeur invalide/);
  bad(m => { m.category = 'Cartes'; }, /category : valeur invalide/);
  // Les textes sont nettoyés : ni balise, ni guillemet droit, ni caractère de contrôle.
  const m = clone(pack('pk-ldr')); m.name = 'Capteur <img src=x onerror=alert(1)>\u0000'; m.description = "l'anode \"5 V\"";
  const v = J.validateManifest(m);
  assert.ok(v.ok); assert.equal(v.manifest.name, 'Capteur img src=x onerror=alert(1)'); assert.equal(v.manifest.description, 'l’anode ”5 V”');
});

test('Manifeste : broches incohérentes et tailles refusées', () => {
  bad(m => { m.pins[1].name = 'VCC'; }, /broche en double : VCC/);
  bad(m => { m.pins[0].kind = 'laser'; }, /kind : valeur invalide/);
  bad(m => { m.pins[2].need = undefined; }, /need : obligatoire/);
  bad(m => { m.pins[1].need = 'out'; }, /seulement pour une broche io/);
  bad(m => { m.pins[0].v = [5, 3]; }, /« logic » ou \[min, max\]/);
  bad(m => { delete m.pins[0].v; }, /obligatoire pour une alimentation/);
  bad(m => { m.pins[0].x = 1e9; }, /nombre entre -300 et 300/);
  bad(m => { m.pins[2].name = 'D O<'; }, /name : valeur invalide/);
  bad(m => { m.pins = []; }, /au moins une broche/);
  bad(m => { m.pins = Array.from({ length: 65 }, (_, i) => ({ name: `P${i}`, x: 0, y: 0, z: 0, kind: 'nc' })); }, /64 éléments au plus/);
  bad(m => { m.behaviour.analogOut.pin = 'NOPE'; }, /broche inconnue : NOPE/);
  bad(m => { m.behaviour.digitalOut.pin = 'VCC'; }, /doit être une broche io/);
  bad(m => { m.behaviour.analogOut.curve = [[10, 0.5], [5, 0.4]]; }, /strictement croissantes/);
  bad(m => { m.description = 'x'.repeat(5000); }, /texte trop long/);
  bad(m => { m.behaviour.led = { anode: 'AO', cathode: 'AO', vf: 2 }; }, /deux broches différentes/);
});

test('Manifeste : toute tension, consommation et limite cite une source complète', () => {
  bad(m => { delete m.ds; }, /consommation ma : citez la fiche technique/);
  bad(m => { m.ds = 'inconnue'; }, /source inconnue : inconnue/);
  bad(m => { m.pins[0].v = [3, 5.5]; }, /pins\[0\]\.ds : tension v : citez la fiche technique/);
  bad(m => { delete m.sources.tiLm393.section; }, /section : obligatoire/);
  bad(m => { m.sources.tiLm393.url = 'javascript:alert(1)'; }, /adresse http\(s\) attendue/);
  bad(m => { m.limits = { current: { warn: 20, max: 30 } }; }, /limites : citez la fiche technique/);
  bad(m => { m.limits = { current: { warn: 40, max: 30 }, src: 'tiLm393' }; }, /warn doit rester sous max/);
  const ok = clone(pack('pk-ldr')); ok.pins[0].v = [3, 5.5]; ok.pins[0].ds = 'tiLm393';
  assert.ok(J.validateManifest(ok).ok, 'une tension chiffrée avec sa source est acceptée');
});

/* ---------- Archive ---------- */
test('Archive .jpart : aller-retour, symbole et dessin, fichiers refusés', () => {
  for (const id of PACKS) {
    const m = pack(id), bytes = J.packJpart({ manifest: m });
    assert.ok(bytes.length < 8000, `${id} : ${bytes.length} octets`);
    const back = J.unpackJpart(bytes);
    assert.deepEqual(back.manifest, J.validateManifest(m).manifest, id);
    assert.equal(back.glb, null); assert.equal(back.symbol, null);
  }
  const symbol = { lines: [{ pts: [[-5.08, 0], [-2, 0]] }], rects: [{ x: -2, y: -1, w: 4, h: 2 }], circles: [], arcs: [], texts: [{ x: 0, y: 3, t: 'LDR' }],
    pins: { VCC: { x: -5.08, y: 0, dir: 'l' }, GND: { x: 5.08, y: 0, dir: 'r' }, DO: { x: 0, y: -5.08, dir: 'u' }, AO: { x: 0, y: 5.08, dir: 'd' } } };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" fill="url(http://evil/x)"/><foreignObject/><a href="javascript:alert(1)"><circle r="2"/></a></svg>';
  const back = J.unpackJpart(J.packJpart({ manifest: pack('pk-ldr'), symbol, svg }));
  assert.equal(back.symbol.pins.AO.dir, 'd');
  assert.doesNotMatch(back.svg, /script|onload|foreignObject|javascript|http:\/\/evil|<a /);
  assert.match(back.svg, /<rect width="10" height="10" fill="none"\/>/);
  // Symbole qui vise une broche absente du manifeste.
  assert.throws(() => J.packJpart({ manifest: pack('pk-ldr'), symbol: { ...symbol, pins: { ...symbol.pins, X: { x: 0, y: 0, dir: 'l' } } } }), /broche inconnue : X/);
  // Archives refusées : fichier inattendu, manifeste absent, bombe de compression, pas un zip, glb invalide.
  const zip = files => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
  const good = JSON.stringify(pack('pk-ldr'));
  assert.throws(() => J.unpackJpart(zip({ 'part.json': good, 'evil.js': 'alert(1)' })), /fichier inattendu : evil\.js/);
  assert.throws(() => J.unpackJpart(zip({ 'model.glb': new Uint8Array(30) })), /part\.json manquant/);
  assert.throws(() => J.unpackJpart(zip({ 'part.json': good, 'look.svg': 'a'.repeat(3 * 1024 * 1024) })), /look\.svg trop lourd/);
  assert.throws(() => J.unpackJpart(zip({ 'part.json': ' '.repeat(300 * 1024) + good })), /part\.json trop lourd/);
  assert.throws(() => J.unpackJpart(strToU8('ceci n’est pas un zip, mais un texte assez long')), /n’est pas un paquet/);
  assert.throws(() => J.unpackJpart(zip({ 'part.json': good, 'model.glb': new Uint8Array(64) })), /glTF binaire attendu/);
  assert.throws(() => J.unpackJpart(zip({ 'part.json': '{"format":1,' })), /part\.json illisible/);
  assert.throws(() => J.unpackJpart(new Uint8Array(J.LIMITS.zip + 1)), /trop lourd/);
});

/* ---------- Installation ---------- */
for (const id of PACKS) await P.installBytes(J.packJpart({ manifest: pack(id) }), { saved: true });

test('Installation : bibliothèque, fiche de câblage, modèle, documentation, sources, symbole', () => {
  for (const id of PACKS) {
    assert.ok(BY_ID[id] && LIBRARY.includes(BY_ID[id]), `${id} dans la bibliothèque`);
    assert.ok(PARTS[id] && DOCS[id], id);
    const pins = [];
    BY_ID[id].build({ g: new THREE.Group(), pin: n => pins.push(n) });
    assert.deepEqual(pins, pack(id).pins.map(p => p.name), `${id} : broches du modèle 3D`);
  }
  assert.ok(MODELS['pk-ldr'] && !MODELS['pk-led-red']);
  assert.ok(SOURCES['pk-ldr:tiLm393'] && PARTS['pk-ldr'].ds === 'pk-ldr:tiLm393');
  assert.deepEqual(pinKeys('pk-res-220'), ['1', '2'], 'pattes passives connues du chargeur');
  assert.equal(PARTS['pk-res-220'].pins, undefined, 'une résistance n’a pas de câblage type');
  assert.deepEqual(PKG_SYMBOLS['pk-led-red'], { kind: 'led', value: 'LED rouge' });
  assert.equal(PKG_SYMBOLS['pk-res-220'].kind, 'resistor');
  assert.ok(BY_ID['pk-led-red'].custom, 'vignette calculée (pas de vignette livrée)');
});

/* ---------- Équivalence avec la bibliothèque ---------- */
const prog = (setup, loop = '') => `void setup() { ${setup} }\nvoid loop() { ${loop} }\n`;
/** Projet [[type, id]] + fils, avec types remplacés par leur version en paquet (swap : { type: type en paquet }). */
const project = (parts, links, code, swap = {}) => loadProject({ comps: parts.map(([type, id]) => ({ id, type: swap[type] || type, name: id })), wires: links.map(([a, ka, b, kb]) => ({ a: [a, ka], b: [b, kb] })) }, code ? { U: code } : null);
const diags = r => r.diags.map(d => `${d.level} ${d.code} ${d.title} @${d.loc.comp ? d.loc.comp.name : ''}:${d.loc.key || ''} ${d.state || ''}`).sort();
const round = v => (v == null ? v : Math.round(v * 1e9) / 1e9);
/** Tout ce que le calcul rend pour un montage : tension de chaque broche, courant et tension de chaque composant, LED. */
function dcOf(p, pinState = () => null, sensorVolts = () => null) {
  const A = analyze(p.comps, p.wires), dc = solveDC(p.comps, A, { pinState, sensorVolts });
  const out = {};
  for (const c of p.comps) {
    for (const k of Object.keys(c.pins)) out[`${c.name}.${k}`] = round(dc.volts({ comp: c, key: k }));
    const a = dc.across(c); if (a) out[`${c.name}~`] = [round(a.v), round(a.mA), a.kind];
    const l = dc.leds.get(c); if (l) out[`${c.name}*`] = [l.on, round(l.mA)];
  }
  return out;
}
const inspectOf = p => { const A = analyze(p.comps, p.wires); return Object.fromEntries(p.comps.map(c => [c.name, Object.entries(inspect(c, A, partOf(c)).pins).map(([k, s]) => `${k}:${s.level}:${s.msgs.map(m => m.code).join(',')}`)])); };
const faultsOf = p => { const A = analyze(p.comps, p.wires); return collectFaults(p.comps, p.wires, A, { dist: () => 1, boardFor: () => null }).map(f => `${f.level} ${f.code} ${f.title} ${f.where}`).sort(); };
const HIGH = board => (c, k) => (c.id === board ? { mode: 1, d: 1, pwm: null } : null);

/** Même montage avec les composants de la bibliothèque, puis en paquet : mêmes résultats partout. */
function same(what, parts, links, code, swap, pinState, sensorVolts) {
  const a = project(parts, links, code), b = project(parts, links, code, swap);
  assert.ok(b.comps.some(c => c.type.startsWith('pk-')), `${what} : le montage utilise bien un paquet`);
  const ra = checkProject(a), rb = checkProject(b);
  assert.deepEqual(diags(rb), diags(ra), `${what} : diagnostics du vérificateur`);
  assert.equal(rb.proven, ra.proven, `${what} : preuve`);
  assert.deepEqual(inspectOf(b), inspectOf(a), `${what} : inspection des broches`);
  assert.deepEqual(faultsOf(b), faultsOf(a), `${what} : fautes de câblage`);
  assert.deepEqual(dcOf(b, pinState, sensorVolts), dcOf(a, pinState, sensorVolts), `${what} : tensions et courants`);
  return { ra, rb };
}
const LED = { 'led-red': 'pk-led-red' }, RES = { 'res-220': 'pk-res-220' }, BOTH = { ...LED, ...RES }, LDR = { ldr: 'pk-ldr' };
const BLINK = prog('pinMode(7, OUTPUT);', 'digitalWrite(7, HIGH); delay(500); digitalWrite(7, LOW); delay(500);');

test('Équivalence : LED et résistance en paquet sur les montages typiques', () => {
  const good = [['U', 'D7', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']];
  for (const swap of [LED, RES, BOTH]) {
    const tag = Object.values(swap).join(' + ');
    let r = same(`${tag}, montage correct`, [['uno', 'U'], ['res-220', 'R'], ['led-red', 'L']], good, BLINK, swap, HIGH('U'));
    assert.equal(r.rb.errors + r.rb.warnings, 0, diags(r.rb).join('\n'));
    same(`${tag}, sur un ESP32`, [['esp32', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'D4', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND']], prog('pinMode(4, OUTPUT);', 'digitalWrite(4, HIGH);'), swap, HIGH('U'));
    // LED à l'envers : faute « reversed » (et rien ne s'allume).
    same(`${tag}, LED à l'envers`, [['uno', 'U'], ['res-220', 'R'], ['led-red', 'L']], [['U', 'D7', 'R', '1'], ['R', '2', 'L', 'K'], ['L', 'A', 'U', 'GND']], BLINK, swap, HIGH('U'));
    // Pile 9 V, 220 Ω, LED : ≈ 29 mA, au-delà des 20 mA conseillés (J0301 avertissement).
    r = same(`${tag}, pile 9 V`, [['bat9v', 'B'], ['res-220', 'R'], ['led-red', 'L']], [['B', '+', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'B', '-']], null, swap);
    assert.ok(r.rb.diags.some(d => d.code === 'J0301'), `${tag} : courant de la LED signalé`);
    // Résistance seule sur la pile : 0,37 W pour 1/4 W (J0304).
    if (swap['res-220']) { r = same(`${tag}, résistance seule sur 9 V`, [['bat9v', 'B'], ['res-220', 'R']], [['B', '+', 'R', '1'], ['R', '2', 'B', '-']], null, swap); assert.ok(r.rb.diags.some(d => d.code === 'J0304' && d.level === 'error'), diags(r.rb).join('\n')); }
  }
  // LED sans résistance : J0301 erreur (broche à HIGH) et avertissement « nores » de l'inspection.
  const r = same('LED en paquet sans résistance', [['uno', 'U'], ['led-red', 'L']], [['U', 'D7', 'L', 'A'], ['L', 'K', 'U', 'GND']], BLINK, LED, HIGH('U'));
  assert.ok(r.rb.diags.some(d => d.code === 'J0301' && d.level === 'error'), diags(r.rb).join('\n'));
  // La résistance en paquet compte dans un pont diviseur comme celle de la bibliothèque (HC-SR04 sur ESP32).
  same('pont diviseur avec la résistance en paquet', [['esp32', 'U'], ['hcsr04', 'US'], ['res-220', 'RT'], ['res-10k', 'RB']],
    [['US', 'VCC', 'U', 'VIN'], ['US', 'GND', 'U', 'GND'], ['US', 'TRIG', 'U', 'D4'], ['US', 'ECHO', 'RT', '1'], ['RT', '2', 'U', 'D27'], ['RB', '1', 'U', 'D27'], ['RB', '2', 'U', 'GND (2)']], null, RES);
});

test('Équivalence : module photorésistance en paquet (sorties AO et DO, états du capteur)', () => {
  const parts = [['uno', 'U'], ['ldr', 'S']];
  const wired = [['S', 'VCC', 'U', '5V'], ['S', 'GND', 'U', 'GND'], ['S', 'AO', 'U', 'A0'], ['S', 'DO', 'U', 'D2']];
  const code = prog('pinMode(2, INPUT); Serial.begin(9600);', 'Serial.println(analogRead(A0) + digitalRead(2));');
  const sv = v => (c, k) => (c.id === 'S' ? { AO: v, DO: v > 2.5 ? 5 : 0 }[k] ?? null : null);
  for (const v of [0.2, 2.4, 4.9]) {
    const r = same(`LDR, AO à ${v} V`, parts, wired, code, LDR, null, sv(v));
    assert.equal(r.rb.errors + r.rb.warnings, 0, diags(r.rb).join('\n'));
  }
  same('LDR sur ESP32 (3,3 V)', [['esp32', 'U'], ['ldr', 'S']], [['S', 'VCC', 'U', '3V3'], ['S', 'GND', 'U', 'GND'], ['S', 'AO', 'U', 'D34']], prog('', 'int v = analogRead(34);'), LDR);
  // Fautes : AO sur une broche sans ADC, masse oubliée, alimentation sur la sortie d'une broche commandée.
  same('LDR, AO sur une broche numérique', parts, [['S', 'VCC', 'U', '5V'], ['S', 'GND', 'U', 'GND'], ['S', 'AO', 'U', 'D3']], prog('', 'int v = analogRead(3);'), LDR);
  same('LDR, masse oubliée', parts, [['S', 'VCC', 'U', '5V'], ['S', 'AO', 'U', 'A0']], null, LDR);
  same('LDR, sortie DO contre une sortie de la carte', parts, [['S', 'VCC', 'U', '5V'], ['S', 'GND', 'U', 'GND'], ['S', 'DO', 'U', 'D2']], prog('pinMode(2, OUTPUT);', 'digitalWrite(2, HIGH);'), LDR);
  // Le modèle déclaratif suit la courbe de la photorésistance de la bibliothèque (pont 15 kΩ·(lux/10)^−0,7 / 10 kΩ).
  const prof = { vref: 5, adcBits: 10, logic: 5 }, builtin = MODELS.ldr, packed = MODELS['pk-ldr'];
  for (const lux of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) {
    const cx = { v: 5, prof, io: { DO: {} }, st: {}, t: 0 }, a = builtin.read({ lux }, cx), b = packed.read({ lux }, cx);
    assert.ok(Math.abs(a.out.AO.v - b.out.AO.v) < 0.002, `${lux} lx : ${a.out.AO.v} V / ${b.out.AO.v} V`);
    assert.equal(b.out.DO.d, a.out.DO.d, `${lux} lx : DO`);
  }
  assert.deepEqual(packed.q, builtin.q);
});

/* ---------- Câblage automatique des paquets ---------- */
/** Projet minimal qui reproduit le câblage automatique de main.js (comme autowire.test.mjs). */
function harness() {
  const V3 = THREE.Vector3, S = { comps: [], wires: [], n: 0, log: [] };
  const same2 = (x, y) => x.comp === y.comp && x.key === y.key;
  S.create = type => {
    const group = new THREE.Group(), att = {};
    BY_ID[type].build({ g: group, pin: (name, mesh, at) => { let k = name, n = 2; while (att[k]) k = `${name} (${n++})`; att[k] = at ? at.clone() : new V3(); } });
    const keys = Object.keys(att).length ? Object.keys(att) : pinKeys(type), pre = BY_ID[type].pre;
    let n = 1; while (S.comps.some(c => c.name === pre + n)) n++;
    const c = { id: `${type}_${S.n++}`, type, name: pre + n, group, pins: {}, inp: { ...(INPUTS[type] || {}) } };
    for (const k of keys) c.pins[k] = { attach: att[k] || new V3() };
    group.position.set(S.comps.length * 70, 0, 0); group.updateMatrixWorld(true); S.comps.push(c); return c;
  };
  const pinWorld = r => r.comp.group.localToWorld(r.comp.pins[r.key].attach.clone());
  const cx = board => ({ board, A: analyze(S.comps, S.wires), wires: S.wires, comps: S.comps, dist: (a, b) => pinWorld(a).distanceTo(pinWorld(b)) });
  S.wire = (comp, board, depth = 0) => {
    let plan = planWiring(comp, cx(board));
    if (plan.needBreadboard) { S.create('breadboard'); plan = planWiring(comp, cx(board)); }
    if (plan.error || plan.needBreadboard) { S.log.push(plan.error || 'breadboard'); return; }
    S.log.push(...plan.warns);
    plan.remove.forEach(w => S.wires.splice(S.wires.indexOf(w), 1));
    const made = {};
    plan.create.forEach(h => { made[h.id] = S.create(h.type); });
    const R = r => (r.h ? { comp: made[r.h], key: r.key } : r);
    plan.wires.forEach(s => { const a = R(s.a), b = R(s.b); if (S.wires.some(w => same2(w.a, a) || same2(w.b, a) || same2(w.a, b) || same2(w.b, b))) S.log.push('fil non posé'); else S.wires.push({ a, b, progress: 1 }); });
    if (depth < 4) plan.then.forEach(t => S.wire(t.h ? made[t.h] : t.comp, board, depth + 1));
  };
  return S;
}

test('Câblage automatique : chaque paquet se câble seul sur chaque carte, sans aucune faute, comme son modèle', () => {
  for (const [builtin, packed] of [['led-red', 'pk-led-red'], ['ldr', 'pk-ldr']]) for (const bt of ['uno', 'nano', 'esp32', 'nodemcu', 'pico']) {
    const run = type => {
      const S = harness(), board = S.create(bt), comp = S.create(type);
      S.wire(comp, board);
      assert.deepEqual(S.log, [], `${type} sur ${bt}`);
      const A = analyze(S.comps, S.wires), cache = new Map(), insp = c => cache.get(c) || (cache.set(c, inspect(c, A, partOf(c))), cache.get(c));
      const auto = generate(board, { comps: S.comps, A, inspect: insp, rules: [], states: {} });
      for (const [label, code, isAuto] of [['sans programme', null], ['programme automatique', auto, true]]) {
        const r = checkProject({ comps: S.comps, wires: S.wires, programs: code ? new Map([[board.id, code]]) : new Map(), auto: new Set(isAuto ? [board.id] : []), allow: [] });
        assert.equal(r.errors + r.warnings, 0, `${type} sur ${bt}, ${label} :\n${diags(r).join('\n')}`);
      }
      return { helpers: S.comps.slice(2).map(c => c.type).sort(), wires: S.wires.map(w => [w.a.key, w.b.key].sort().join('~')).sort() };
    };
    assert.deepEqual(run(packed), run(builtin), `${packed} sur ${bt} : même câblage que ${builtin}`);
  }
});

/* ---------- Projets et schéma ---------- */
test('Projet : les paquets utilisés voyagent dans le .jollof et se réinstallent ailleurs', async () => {
  const comps = [{ type: 'pk-ldr' }, { type: 'uno' }, { type: 'pk-ldr' }, { type: 'pk-led-red' }];
  const emb = P.embedFor(comps);
  assert.deepEqual(emb.map(e => e.id).sort(), ['pk-ldr', 'pk-led-red']);
  P.uninstall('pk-ldr');
  assert.ok(!BY_ID['pk-ldr'] && !PARTS['pk-ldr'] && !MODELS['pk-ldr'] && !SOURCES['pk-ldr:tiLm393'], 'désinstallé partout');
  const r = await P.installEmbedded([...emb, { id: 'pk-x', jpart: 'pas du base64 valide !!' }, null]);
  assert.deepEqual(r.added, ['pk-ldr'], 'seul le paquet manquant est installé');
  assert.equal(r.errors.length, 2);
  assert.ok(BY_ID['pk-ldr'] && PARTS['pk-ldr']);
  // Une version plus récente remplace celle de la bibliothèque, une plus ancienne est ignorée.
  const newer = { ...pack('pk-ldr'), version: 2, name: 'Module photorésistance v2' };
  const r2 = await P.installEmbedded([{ id: 'pk-ldr', version: 2, jpart: J.toB64(J.packJpart({ manifest: newer })) }, { id: 'pk-led-red', version: 1, jpart: emb.find(e => e.id === 'pk-led-red').jpart }]);
  assert.deepEqual(r2.added, ['pk-ldr']); assert.equal(BY_ID['pk-ldr'].name, 'Module photorésistance v2');
});

test('Schéma : symbole de LED et de résistance pour les paquets, symbole dessiné par le paquet sinon', async () => {
  const symbol = { lines: [{ pts: [[-5.08, 0], [-2.54, 0]] }, { pts: [[2.54, 0], [5.08, 0]] }], rects: [{ x: -2.54, y: -2, w: 5.08, h: 4 }], texts: [{ x: 0, y: 0.6, t: 'S' }],
    pins: { VCC: { x: -5.08, y: 0, dir: 'l' }, GND: { x: 5.08, y: 0, dir: 'r' }, DO: { x: 0, y: -5.08, dir: 'u' }, AO: { x: 0, y: 5.08, dir: 'd' } } };
  await P.installBytes(J.packJpart({ manifest: { ...pack('pk-ldr'), version: 3 }, symbol }));
  const p = project([['uno', 'U'], ['res-220', 'R'], ['led-red', 'L'], ['ldr', 'S']], [['U', 'D7', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND'], ['S', 'AO', 'U', 'A0']], null, { ...BOTH, ...LDR });
  p.comps.forEach((c, i) => { c.group = { position: { x: i * 30, z: 0 } }; for (const k in c.pins) c.pins[k].attach = { x: 0, z: 0 }; });
  const L = layoutSchematic({ comps: p.comps, wires: p.wires, describe: c => ({ title: c.type }) });
  const sym = name => L.syms.get(p.comps.find(c => c.name === name));
  assert.deepEqual(Object.keys(sym('L').pins), ['A', 'K'], 'symbole de LED');
  assert.deepEqual(Object.keys(sym('R').pins), ['1', '2'], 'symbole de résistance');
  assert.deepEqual(sym('S').pins.AO, { x: 0, y: 5.08, dir: 'd' }, 'ancre du symbole dessiné');
  assert.ok(boardOf(p.comps[0]));
});

test('Règles : la LED en paquet a les actions d’une LED, le capteur en paquet une mesure par sortie ; programme équivalent', () => {
  const code = (led, ldr, sig) => {
    const p = project([['uno', 'U'], ['res-220', 'R'], ['led-red', 'L'], ['ldr', 'S']], [['U', 'D7', 'R', '1'], ['R', '2', 'L', 'A'], ['L', 'K', 'U', 'GND'], ['S', 'VCC', 'U', '5V'], ['S', 'GND', 'U', 'GND (2)'], ['S', 'AO', 'U', 'A0']], null, { 'led-red': led, ldr });
    const A = analyze(p.comps, p.wires), cache = new Map(), insp = c => cache.get(c) || (cache.set(c, inspect(c, A, partOf(c))), cache.get(c));
    const rules = [{ kind: 'rule', id: 'r1', src: { comp: 'S', sig }, op: '>', v: 600, from: [0, 100], then: [{ kind: 'act', id: 'a1', comp: 'L', act: 'on', arg: null }], else: [{ kind: 'act', id: 'a2', comp: 'L', act: 'off', arg: null }] }];
    const src = generate(p.comps[0], { comps: p.comps, A, inspect: insp, rules, states: {} });
    const r = checkProject({ comps: p.comps, wires: p.wires, programs: new Map([['U', src]]), auto: new Set(['U']), allow: [] });
    return { src, r };
  };
  const a = code('led-red', 'ldr', 'light'), b = code('pk-led-red', 'pk-ldr', 'AO');
  for (const x of [a, b]) for (const re of [/const int S_AO = A0;/, /const int L = 7;/, /= analogRead\(S_AO\);/, /digitalWrite\(L, HIGH\);/, /digitalWrite\(L, LOW\);/, /pinMode\(L, OUTPUT\);/]) assert.match(x.src, re);
  // Même programme, au nom de la mesure près (s_lumiere / s_ao) et à son commentaire.
  const norm = t => t.replace(/s_(lumiere|ao)\b/g, 'X').replace(/ \/\/ plus de lumière.*$/m, '').replace(/S · [^:]+ dépasse/g, 'S dépasse').replace(/"S [^"]+ : "/g, '"S"');
  assert.equal(norm(b.src), norm(a.src));
  assert.deepEqual(diags(b.r), diags(a.r), 'mêmes diagnostics pour le programme des règles');
  assert.equal(a.r.errors + a.r.warnings, 0, diags(a.r).join('\n'));
});

/* ---------- Composants standard et « Mes composants » ---------- */
const STD_DIR = new URL('src/library/standard/', ROOT);
const STD = fs.readdirSync(STD_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(new URL(f, STD_DIR), 'utf8')));
const stdOf = id => clone(STD.find(m => m.id === id));

test('Composants standard : valides, documentés et sourcés, rangés dans leur catégorie, jamais embarqués dans un projet', async () => {
  const r = P.installStandard(STD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ids.length, STD.length);
  assert.ok(STD.length >= 16);
  for (const m of STD) {
    const e = BY_ID[m.id];
    assert.ok(e && LIBRARY.includes(e), `${m.id} dans la bibliothèque`);
    assert.equal(e.cat, m.category, `${m.id} : catégorie du manifeste`);
    assert.ok(e.std && !e.custom && P.isStandard(m.id), m.id);
    assert.ok(m.description && m.docs && m.docs.text && m.docs.specs.length && m.docs.uses.length && m.docs.mistakes.length, `${m.id} documenté`);
    assert.ok(Object.keys(m.sources || {}).length, `${m.id} : fiche technique citée`);
    assert.ok(PARTS[m.id] && DOCS[m.id] && DOCS[m.id].how, m.id);
    assert.ok(!/\(paquet\)/.test(m.name), `${m.id} : nom de bibliothèque`);
  }
  assert.deepEqual(P.embedFor([{ type: 'pk-tmp36' }, { type: 'pk-sht31' }, { type: 'pk-ldr' }]).map(x => x.id), ['pk-ldr'], 'seul le paquet personnel part avec le projet');
  // Copie identique gardée dans la bibliothèque personnelle (composant créé avant d'être livré) : le standard reste.
  await P.installBytes(J.packJpart({ manifest: stdOf('pk-tmp36') }), { saved: true });
  assert.ok(P.isStandard('pk-tmp36'));
  assert.equal(BY_ID['pk-tmp36'].cat, 'Capteurs');
  const before = await P.installEmbedded([{ id: 'pk-tmp36', version: stdOf('pk-tmp36').version, jpart: J.toB64(J.packJpart({ manifest: stdOf('pk-tmp36') })) }]);
  assert.deepEqual(before.added, [], 'projet qui embarquait la même version : rien à installer');
  P.uninstall('pk-tmp36');
  assert.ok(BY_ID['pk-tmp36'] && P.isStandard('pk-tmp36'), 'un composant standard ne se retire pas');
});

test('Mes composants : créés, importés ou apportés par un projet, rangés à part avec leur propre catégorie', async () => {
  for (const id of PACKS) {
    assert.equal(BY_ID[id].cat, 'Mes composants', id);
    assert.ok(BY_ID[id].custom && !BY_ID[id].std && !P.isStandard(id), id);
  }
  assert.equal(BY_ID['pk-ldr'].group, 'Capteurs');
  assert.equal(BY_ID['pk-led-red'].group, 'Sorties');
  // Version personnelle plus récente d'un composant standard : elle le remplace, dans Mes composants.
  await P.installBytes(J.packJpart({ manifest: { ...stdOf('pk-sht31'), version: 5, name: 'SHT31 de mon club' } }), { saved: true });
  assert.ok(!P.isStandard('pk-sht31'));
  assert.equal(BY_ID['pk-sht31'].cat, 'Mes composants');
  assert.equal(BY_ID['pk-sht31'].name, 'SHT31 de mon club');
  P.installStandard([stdOf('pk-sht31')]);
  assert.ok(P.isStandard('pk-sht31') && BY_ID['pk-sht31'].cat === 'Capteurs');
});
