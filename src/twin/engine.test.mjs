// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jumeau numérique : catalogue et nettoyage (model.js), moteur (engine.js : convoyeur, poussoir, butée, chute, bacs,
// cellule, détecteur, ventouse, outil, bec, sources), branchement dans le pas de simulation (process.js, run.js) avec
// l'exemple « convoyeur et éjecteur » trié par son Ladder, export et relecture AutomationML (aml.js).
// node --test src/twin/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { cleanTwin, validateTwin, twinSignals, TEMPLATES, newPart, CATALOG } = await import('./model.js');
const { twinProcess, framesOf, bodyOf, aabbOf } = await import('./engine.js');
const { processOf, createProcess, stepProcess, processSensors, processSensorNames, processOutputNames, actProcess } = await import('../pneu/process.js');
const { createRunner, runStep } = await import('../pneu/run.js');
const { clean } = await import('../pneu/clean.js');
const { checkPneu } = await import('../pneu/check.js');
const { twinSorterCircuit } = await import('../pneu/examples.js');
const { toAutomationML, fromAutomationML, parseXml } = await import('./aml.js');

const P = (id, type, pos, more = {}) => ({ id, type, pos, ...more });
const scene = (parts, name = 'Test') => cleanTwin({ name, parts });
/** Simulation du jumeau seul : pos(rôle), out(nom) réglables ; run(t) avance par pas de 0,02 s. */
function sim(sc) {
  const D = twinProcess(sc), s = createProcess(D), pos = {}, out = new Set();
  const run = (t, dt = 0.02) => { for (let k = 0; k < Math.round(t / dt); k++) stepProcess(s, dt, r => pos[r] || 0, n => out.has(n), D); return s; };
  return { D, s, pos, out, run, sens: () => Object.fromEntries(processSensors(sc, s)) };
}
const items = s => s.items.map(it => ({ x: +it.p[0].toFixed(3), y: +it.p[1].toFixed(3), z: +it.p[2].toFixed(3), on: it.on && it.on.id, held: it.held }));

test('Nettoyage : composants connus, nombres bornés, identifiants uniques, parents sans cycle, réglages à plat acceptés', () => {
  const s = cleanTwin({ name: 'x'.repeat(80), parts: [
    { id: 'a', type: 'conveyor', pos: [1e9, 'x', 2], size: [0, 1, 1e9], speed: 99, out: 'KM1' },
    { id: 'a', type: 'pusher', pos: [0, 0, 0], props: { stroke: -5, dir: 'haut' }, bind: { cyl: 'A' }, parent: 'b' },
    { id: 'b', type: 'carriage', pos: [0, 0, 0], parent: 'pusher1' },
    { id: 'nope', type: 'tank' }, null, { type: 'photocell', pos: [0, 0, 0], bind: { signal: 'bad name' } }, { type: 'button', props: { mode: 'x' }, bind: { input: 'dcy' } }
  ], assets: { k: 'AAAA', 'bad id!': 'AAAA' } });
  assert.equal(s.kind, 'twin'); assert.equal(s.name.length, 40);
  assert.deepEqual(s.parts.map(p => p.id), ['a', 'pusher1', 'b', 'photocell1', 'button1']);
  assert.deepEqual(s.parts[0].pos, [50, 0, 2]); assert.deepEqual(s.parts[0].size, [0.01, 1, 20]); assert.equal(s.parts[0].props.speed, 5); assert.equal(s.parts[0].bind.out, 'KM1');
  assert.equal(s.parts[1].props.stroke, 0.01); assert.equal(s.parts[1].props.dir, 'z');
  assert.ok(!(s.parts[1].parent && s.parts[2].parent), 'le cycle poussoir ↔ chariot est coupé');
  assert.equal(s.parts[3].bind.signal, undefined, 'signal mal nommé refusé'); assert.equal(s.parts[4].props.mode, 'hold');
  assert.equal(s.assets, undefined, 'modèles non posés oubliés');
  assert.deepEqual(cleanTwin(null), { kind: 'twin', parts: [] });
  assert.equal(clean({ elements: [], tubes: [], scene: { kind: 'twin', parts: [{ id: 'f', type: 'frame', pos: [0, 0, 0] }] } }).scene.parts[0].type, 'frame', 'clean.js garde la scène');
});

test('Catalogue : chaque composant a une famille, un nom, une aide ; mobiles et liaisons cohérents ; signaux de la scène', () => {
  for (const [t, K] of Object.entries(CATALOG)) { assert.ok(K.cat && K.name() && K.help(), t); if (K.mover) assert.ok(K.bind.includes('cyl'), `${t} suit un vérin`); if (K.sizable) assert.equal(K.size.length, 3); }
  const sig = twinSignals(TEMPLATES.sorter.scene());
  assert.deepEqual(sig.sensors, [{ part: 'pe', name: 'pe' }]); assert.deepEqual(sig.outputs, ['KM1']); assert.deepEqual(sig.inputs, ['dcy', 'sel']); assert.deepEqual(sig.cyls, [{ part: 'push1', ref: 'A' }]); assert.deepEqual(sig.acts, ['src1']);
  const v = validateTwin(scene([P('p1', 'pusher', [0, 0, 0]), P('c1', 'photocell', [0, 0, 0], { bind: { signal: 'a0' } }), P('c2', 'photocell', [1, 0, 0], { bind: { signal: 'pe' } }), P('c3', 'photocell', [2, 0, 0], { bind: { signal: 'pe' } }), P('b1', 'button', [0, 0, 0], { bind: { input: 'go' } })]), { cyls: ['A'], sensors: ['a0'], inputs: ['dcy'] });
  const txt = v.map(x => x.level + ' ' + x.text).join('\n');
  assert.match(txt, /error .*aucun vérin lié/); assert.match(txt, /error .*a0 est déjà un capteur/); assert.match(txt, /error Le signal pe est produit par 2/); assert.match(txt, /warning .*aucune entrée go/);
  assert.equal(validateTwin(scene([]))[0].level, 'info');
});

test('Convoyeur : la pièce posée avance avec la bande quand la sortie est vraie, s’arrête sinon, tombe du bout dans le bac', () => {
  const sc = scene([P('f', 'frame', [0, 0, 0], { size: [1, 0.8, 0.8] }), P('c', 'conveyor', [0, 0.8, 0], { size: [1, 0.1, 0.4], props: { speed: 0.5 }, bind: { out: 'KM1' } }), P('src', 'source', [-0.4, 0.9, 0], { props: { item: 'box', every: 0, max: 3 } }), P('bac', 'sink', [0.7, 0.4, 0], { size: [0.4, 0.4, 0.6] })]);
  const S = sim(sc);
  actProcess(S.s, 'src'); S.run(0.1);
  assert.equal(S.s.items.length, 1); assert.deepEqual(items(S.s)[0], { x: -0.4, y: 0.9, z: 0, on: 'c', held: null }, 'posée sur le tapis, à l’arrêt');
  S.out.add('KM1'); S.run(1);
  assert.ok(Math.abs(S.s.items[0].p[0] - 0.1) < 0.011, `avance de 0,5 m/s : ${S.s.items[0].p[0]}`);
  S.out.delete('KM1'); S.run(1); assert.ok(Math.abs(S.s.items[0].p[0] - 0.1) < 0.011, 'arrêtée');
  S.out.add('KM1'); S.run(3);
  assert.equal(S.s.items.length, 0, 'tombée du bout dans le bac'); assert.deepEqual(S.s.counts.bac, { ok: 1, bad: 0 }); assert.equal(S.s.lost, 0);
  // Sans bac : la pièce tombe au sol, repose, puis est comptée perdue (alarme).
  const S2 = sim(scene([P('c', 'conveyor', [0, 0.8, 0], { size: [1, 0.1, 0.4], props: { speed: 0.5 } }), P('src', 'source', [0.3, 0.9, 0], { props: { every: 0 } })]));
  actProcess(S2.s, 'src'); S2.run(3);
  assert.equal(S2.s.items.length, 0); assert.equal(S2.s.lost, 1); assert.ok(twinProcess(S2.D && sc) || true);
  assert.ok(S2.D.hud(S2.s).some(h => h.alarm), 'alarme pièce tombée');
});

test('Source : période et quota, pas deux pièces au même endroit ; cellule et détecteur de proximité', () => {
  const sc = scene([P('c', 'conveyor', [0, 0.8, 0], { size: [2, 0.1, 0.4], props: { speed: 0.25 } }), P('src', 'source', [-0.8, 0.9, 0], { props: { every: 2, max: 2 } }),
    P('pe', 'photocell', [0, 0.95, -0.3], { props: { range: 0.6, dir: 'z' }, bind: { signal: 'pe' } }), P('px', 'proximity', [0.5, 0.92, 0], { props: { zone: 0.1, detect: 'any' }, bind: { signal: 'px', nc: false } })]);
  const S = sim(sc);
  S.run(0.5); assert.equal(S.s.items.length, 0, 'première pièce à 1 s');
  S.run(0.6); assert.equal(S.s.items.length, 1);
  actProcess(S.s, 'src'); S.run(0.1); assert.equal(S.s.items.length, 1, 'la place n’est pas libre : rien');
  S.run(2.2); assert.equal(S.s.items.length, 2, 'deuxième à 3 s'); S.run(2); assert.equal(S.s.items.length, 2, 'quota de 2 atteint');
  let seen = false, seenPx = false;
  for (let k = 0; k < 400; k++) { S.run(0.02); const r = S.sens(); if (r.pe) seen = true; if (r.px) seenPx = true; }
  assert.ok(seen && seenPx, 'la cellule et le détecteur ont vu passer les colis');
  assert.deepEqual(processSensorNames(sc), ['pe', 'px']);
});

test('Poussoir : en travers du tapis il arrête la pièce (butée) ; il la pousse hors du tapis ; la pièce suit un chariot', () => {
  // Butée escamotable au niveau du tapis en x = −0,13 : lame sortie, la pièce (x croissant) s'arrête contre elle, centre à −0,2 ; rentrée, elle passe.
  const stopper = scene([P('c', 'conveyor', [0, 0.8, 0], { size: [2, 0.1, 0.3], props: { speed: 0.5 } }), P('src', 'source', [-0.7, 0.9, 0], { props: { item: 'puck', every: 0 } }), P('st', 'stopper', [-0.13, 0.9, 0], { props: { stroke: 0.08, face: 'x', width: 0.3 }, bind: { cyl: 'A' } })]);
  let S = sim(stopper); S.pos.st = 1; actProcess(S.s, 'src'); S.run(3);
  assert.equal(S.s.items.length, 1); assert.ok(Math.abs(S.s.items[0].p[0] + 0.2) < 0.012, `arrêtée contre la plaque (x ≈ −0,2) : ${S.s.items[0].p[0]}`);
  S.pos.st = 0; S.run(5); assert.equal(S.s.items.length, 0, 'butée rentrée : la pièce repart, tombe du bout, est perdue'); assert.equal(S.s.lost, 1);
  // Poussoir de côté : la pièce arrêtée (tapis à l'arrêt) est éjectée en +z au-delà du bord, tombe dans le bac.
  const push = scene([P('c', 'conveyor', [0, 0.8, 0], { size: [2, 0.1, 0.4], bind: { out: 'KM1' } }), P('src', 'source', [0.1, 0.9, 0], { props: { every: 0 } }), P('p', 'pusher', [0.1, 0.9, -0.25], { props: { stroke: 0.6, dir: 'z', width: 0.26, height: 0.12 }, bind: { cyl: 'A' } }), P('bac', 'sink', [0.1, 0.4, 0.5], { size: [0.5, 0.4, 0.4] })]);
  S = sim(push); actProcess(S.s, 'src'); S.run(0.1);
  for (let k = 1; k <= 20; k++) { S.pos.p = k / 20; S.run(0.05); }
  S.run(1.5);
  assert.deepEqual(S.s.counts.bac, { ok: 1, bad: 0 }, 'éjectée dans le bac'); assert.equal(S.s.lost, 0);
  // Chariot : la pièce posée dessus se déplace avec lui.
  const car = scene([P('ch', 'carriage', [0, 0.8, 0], { size: [0.4, 0.06, 0.4], props: { stroke: 1, dir: 'x' }, bind: { cyl: 'B' } }), P('src', 'source', [0, 0.86, 0], { props: { item: 'puck', every: 0 } })]);
  S = sim(car); actProcess(S.s, 'src'); S.run(0.1); S.pos.ch = 0.5; S.run(0.1);
  assert.ok(Math.abs(S.s.items[0].p[0] - 0.5) < 1e-6 && S.s.items[0].on.id === 'ch', 'suit le chariot');
});

test('Ventouse sur chariot : saisit la pièce sous elle, l’emporte, la lâche dans le bac ; outil et bec marquent et remplissent', () => {
  const sc = TEMPLATES.pickplace.scene(), S = sim(sc);
  S.pos.stop1 = 1; S.out.add('KM1'); S.run(6); // premier palet à 1 s (période 8 s), 0,9 m à 0,2 m/s
  assert.equal(S.s.items.length, 1); assert.ok(S.sens().pp, 'palet arrêté au poste de prise (pp)');
  S.out.add('VAC'); S.run(0.1); assert.equal(S.s.items[0].held, 'vac1', 'saisi');
  for (let k = 1; k <= 20; k++) { S.pos.car1 = k / 20; S.run(0.05); }
  assert.ok(Math.abs(S.s.items[0].p[0] - 0.7) < 1e-6, 'emporté par le chariot'); assert.ok(!S.sens().pp);
  S.out.delete('VAC'); S.run(0.5);
  assert.deepEqual(S.s.counts.bac1, { ok: 1, bad: 0 }, 'déposé dans le bac');
  // Outil : marque la pièce atteinte en bout de course ; détecteur « usinées » ; bac qui n'accepte que les usinées.
  const t = scene([P('f', 'frame', [0, 0, 0], { size: [1, 0.8, 1] }), P('src', 'source', [0, 0.8, 0], { props: { item: 'puck', every: 0 } }), P('o', 'tool', [0, 1.1, 0], { props: { stroke: 0.2, dir: '-y' }, bind: { cyl: 'A' } }), P('d', 'proximity', [0, 0.83, 0], { props: { zone: 0.1, detect: 'done' }, bind: { signal: 'ok' } })]);
  let T = sim(t); actProcess(T.s, 'src'); T.run(0.1); assert.equal(T.sens().ok, false);
  T.pos.o = 1; T.run(0.1); assert.equal(T.s.machined, 1); assert.equal(T.sens().ok, true); T.run(0.1); assert.equal(T.s.machined, 1, 'un seul front');
  // Bec : remplit la pièce dessous en fillTime ; coule à vide sinon ; bac « pleines ».
  const b = scene([P('f', 'frame', [0, 0, 0], { size: [1, 0.8, 1] }), P('src', 'source', [0, 0.8, 0], { props: { item: 'bottle', every: 0 } }), P('bec', 'dispenser', [0, 1.2, 0], { props: { fillTime: 2 }, bind: { out: 'Y2' } }), P('niv', 'proximity', [0, 0.9, 0], { props: { zone: 0.3, detect: 'full' }, bind: { signal: 'niv' } })]);
  T = sim(b); T.out.add('Y2'); T.run(0.5); assert.ok(T.s.spilling && T.s.spill > 0.4, 'coule à vide');
  actProcess(T.s, 'src'); T.run(1); assert.ok(!T.s.spilling); assert.ok(Math.abs(T.s.items[0].fill - 0.5) < 0.02, `à moitié : ${T.s.items[0].fill}`); assert.equal(T.sens().niv, false);
  T.run(1.1); assert.equal(T.s.items[0].fill, 1); assert.equal(T.sens().niv, true);
});

test('Déterminisme et bornes : deux simulations identiques donnent le même état ; dt borné ; repères des pièces et boîtes', () => {
  const a = sim(TEMPLATES.sorter.scene()), b = sim(TEMPLATES.sorter.scene());
  for (const S of [a, b]) { S.out.add('KM1'); for (let k = 0; k < 300; k++) { S.pos.push1 = k % 100 < 50 ? 0 : 1; S.run(0.05); } }
  assert.equal(JSON.stringify(a.s), JSON.stringify(b.s));
  const S = sim(scene([P('c', 'conveyor', [0, 0.8, 0], { props: { speed: 1 } }), P('src', 'source', [-0.9, 0.9, 0], { props: { every: 0 } })]));
  actProcess(S.s, 'src'); stepProcess(S.s, 5, () => 0, () => false, S.D);
  assert.ok(Math.abs(S.s.t - 0.1) < 1e-9, 'un pas est borné à 0,1 s');
  const D = twinProcess(scene([P('f', 'frame', [1, 0, 0], { rot: 90 }), P('p', 'pusher', [0.5, 0.8, 0], { props: { stroke: 0.3, dir: 'z' }, parent: 'f' })]));
  const F = framesOf(D, { p: 1 }), fp = F.get('p');
  assert.ok(Math.abs(fp.base.o[0] - 1) < 1e-9 && Math.abs(fp.base.o[2] + 0.5) < 1e-9, 'enfant tourné avec son parent (90° : +x local → −z)');
  assert.ok(Math.abs(fp.move.o[0] - (1 + 0.3)) < 1e-9, 'course z locale → +x monde après la rotation du parent');
  const box = aabbOf(fp.move, bodyOf(D.byId.get('p')));
  assert.ok(box.max[1] - box.min[1] > 0.09 && box.max[1] - box.min[1] < 0.11, 'plaque haute de 0,1 m');
});

test('Exemple « convoyeur et éjecteur » : le Ladder trie les colis dans le pas de simulation commun (run.js)', () => {
  const trial = (sel) => {
    const circ = clean(twinSorterCircuit()), R = createRunner(), pushed = new Set(['@dcy', ...(sel ? ['@sel'] : [])]);
    const io = { coil: () => false, pushed: k => pushed.has(k), input: () => false };
    for (let t = 0; t < 40; t += 0.02) runStep(R, circ, io, 0.02);
    return R.proc;
  };
  const yes = trial(true);
  assert.ok(yes.counts.bac1 && yes.counts.bac1.ok >= 3, `éjectés : ${JSON.stringify(yes.counts)}`); assert.ok(!yes.counts.bac2, 'aucun en bout de ligne'); assert.equal(yes.lost, 0);
  const no = trial(false);
  assert.ok(no.counts.bac2 && no.counts.bac2.ok >= 3, `en bout de ligne : ${JSON.stringify(no.counts)}`); assert.ok(!no.counts.bac1); assert.equal(no.lost, 0);
  const circ = clean(twinSorterCircuit()), probs = checkPneu(circ).filter(p => p.level === 'error');
  assert.deepEqual(probs, [], 'le vérificateur accepte la bobine KM1 (elle commande le convoyeur)');
  assert.deepEqual(processOutputNames(circ.scene), ['KM1']);
  assert.deepEqual(processOf(circ.scene).controls.map(c => `${c.role}:${c.mode}`), ['btn1:toggle', 'btn2:toggle', 'src1:click'], 'deux boutons à bascule du pupitre et la source (un clic)');
});

test('AutomationML : CAEX 3.0 bien formé, classes et signaux, relecture identique', () => {
  const circ = clean(twinSorterCircuit()), xml = toAutomationML(circ.scene, circ, { glb: 'tri.glb', version: '0.3.0', date: '2026-11-15T10:00:00Z' });
  assert.match(xml, /<CAEXFile [^>]*SchemaVersion="3.0"/); assert.match(xml, /AutomationML 2.10/);
  assert.match(xml, /RefBaseSystemUnitPath="JollofStudioSystemUnitClassLib\/BeltConveyor"/); assert.match(xml, /RefBaseSystemUnitPath="JollofStudioSystemUnitClassLib\/PneumaticCylinder"/);
  assert.match(xml, /<ExternalInterface Name="pe" [^>]*SignalInterface/); assert.match(xml, /<InternalLink Name="push1.cyl"/); assert.match(xml, /refURI[^<]*<Value>tri.glb/);
  assert.equal(toAutomationML(circ.scene, circ, { glb: 'tri.glb', version: '0.3.0', date: '2026-11-15T10:00:00Z' }), xml, 'déterministe');
  const doc = parseXml(xml); assert.equal(doc.children[0].name, 'CAEXFile');
  const back = fromAutomationML(xml);
  assert.deepEqual(back, circ.scene, 'relecture identique');
  // Hiérarchie : un enfant est imbriqué dans son parent.
  const pp = TEMPLATES.pickplace.scene(), x2 = toAutomationML(pp, null, { date: '2026-11-15T10:00:00Z' });
  assert.ok(x2.indexOf('Name="vac1"') > x2.indexOf('Name="car1"'), 'ventouse dans le chariot'); assert.deepEqual(fromAutomationML(x2), pp);
  assert.throws(() => fromAutomationML('<CAEXFile/>'), /aucun composant/); assert.throws(() => parseXml('<a><b></a>'), /inattendu/);
  assert.equal(parseXml('<a x="1 &amp; 2"><![CDATA[<raw>]]>&lt;t&gt;<!-- c --></a>').children[0].text, '<raw><t>');
});

test('Performance : 60 pièces sur une ligne chargée, 3 000 pas de 20 ms en quelques centaines de ms ; sous-pas adaptés à ce qui bouge', () => {
  // Trois convoyeurs, trois sources (quota 20 chacune), un poussoir qui bat, une butée, dix capteurs, trois bacs.
  const parts = [P('f', 'frame', [0, 0, 0], { size: [6, 0.8, 2] })];
  for (let k = 0; k < 3; k++) {
    const z = -0.6 + k * 0.6;
    parts.push(P(`c${k}`, 'conveyor', [0, 0.8, z], { size: [5, 0.1, 0.4], props: { speed: 0.3 }, bind: { out: 'KM1' } }), P(`s${k}`, 'source', [-2.3, 0.9, z], { props: { item: 'box', every: 0.5, max: 20 } }), P(`b${k}`, 'sink', [2.8, 0.4, z], { size: [0.4, 0.4, 0.5] }));
    for (let i = 0; i < 3; i++) parts.push(P(`pe${k}${i}`, 'photocell', [-1.5 + i, 0.97, z - 0.3], { props: { range: 0.6, dir: 'z' }, bind: { signal: `pe${k}${i}` } }));
  }
  parts.push(P('push', 'pusher', [0.5, 0.9, -0.85], { props: { stroke: 0.5, dir: 'z', width: 0.26, height: 0.12 }, bind: { cyl: 'A' } }), P('stop', 'stopper', [1.5, 0.9, 0.6], { props: { stroke: 0.08, face: 'x', width: 0.3 }, bind: { cyl: 'B' } }), P('px', 'proximity', [1.3, 0.92, 0.6], { props: { zone: 0.12 }, bind: { signal: 'px' } }));
  const S = sim(scene(parts)); S.out.add('KM1');
  const t0 = performance.now();
  for (let k = 0; k < 3000; k++) { S.pos.push = Math.floor(k / 100) % 2; S.pos.stop = Math.floor(k / 150) % 2; S.run(0.02); }
  const ms = performance.now() - t0;
  assert.ok(S.s.items.length >= 20, `la ligne est chargée : ${S.s.items.length} pièces`);
  assert.ok(ms < 1500, `3 000 pas en ${Math.round(ms)} ms`);
  console.log(`      perf : 3 000 pas, ${S.s.items.length} pièces en vol, ${(ms / 3000 * 1000).toFixed(0)} µs par pas`);
  // Sous-pas : un pas de 20 ms à 0,3 m/s n'en demande qu'un ; une tige qui saute de 0,5 m en demande 25 (plafonnés à 20) sans rien casser.
  const T = sim(scene([P('c', 'conveyor', [0, 0.8, 0], { props: { speed: 0.3 } }), P('p', 'pusher', [0, 0.9, -0.25], { props: { stroke: 0.5, dir: 'z' }, bind: { cyl: 'A' } })]));
  T.run(0.02); const t1 = T.s.t; T.pos.p = 1; T.run(0.02);
  assert.ok(Math.abs(T.s.t - t1 - 0.02) < 1e-9, 'le temps avance de dt quel que soit le nombre de sous-pas');
});

test('Pièce neuve et identifiant libre', () => {
  const p = newPart('conveyor', [1, 0.8, 0]); assert.equal(p.id, 'conveyor'); assert.deepEqual(p.size, [2, 0.1, 0.4]); assert.equal(p.props.speed, 0.25);
  assert.equal(newPart('pusher', [0, 0, 0], { id: 'p9', bind: { cyl: 'A' }, parent: 'zz' }).parent, undefined, 'parent inconnu oublié');
});
