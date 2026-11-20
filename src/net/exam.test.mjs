// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode examen du plan réseau (exam.js) : drapeau gardé par cleanNet, verrou pendant une séance, champ « exam » des TP, code
// enseignant (PBKDF2, essais limités) ; certification en examen (certify.js, outils de l'IA cert_*) : mesures et limites,
// ni verdict, ni marge, ni défaut nommé.
// node --test src/net/exam.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isExam, examLocked, examTpError, makeLock, checkLock, cleanLock, attempts, CODE_MIN } from './exam.js';
import { cleanNet } from './clean.js';

test('drapeau exam : gardé seulement s’il vaut true, stable au nettoyage', () => {
  const a = cleanNet({ exam: true, devices: [], cables: [] });
  assert.equal(a.exam, true); assert.ok(isExam(a));
  assert.deepEqual(cleanNet(a), a, 'idempotent');
  for (const bad of ['true', 1, {}, null, false]) assert.equal('exam' in cleanNet({ exam: bad }), false, JSON.stringify(bad));
  assert.equal(isExam(null), false); assert.equal(isExam({}), false);
});

test('verrou : pas de changement pendant une séance (TP, devoir, copie)', () => {
  assert.equal(examLocked(null), false);
  assert.equal(examLocked({ current: null }), false);
  assert.equal(examLocked({ current: { kind: 'assignment' } }), true);
});

test('champ exam d’un TP : booléen, et le plan réseau du départ (et de la solution) le porte', () => {
  const net = exam => ({ settings: { modules: { net: { devices: [], cables: [], ...(exam ? { exam: true } : {}) } } } });
  assert.equal(examTpError({ start: net(false) }), null, 'pas de champ : rien à vérifier');
  assert.equal(examTpError({ exam: true, start: net(true), solution: { project: net(true) } }), null);
  assert.equal(examTpError({ exam: false, start: net(false) }), null);
  assert.match(examTpError({ exam: 'oui', start: net(true) }), /true ou false/);
  assert.match(examTpError({ exam: true, start: net(false) }), /départ/);
  assert.match(examTpError({ exam: true, start: net(true), solution: { project: net(false) } }), /solution/);
  assert.match(examTpError({ exam: false, start: net(true) }), /départ a exam: true/);
  assert.match(examTpError({ exam: true, start: {} }), /départ/);
});

test('code enseignant : haché avec un sel (PBKDF2), jamais en clair ; le bon code seul ouvre ; 6 caractères au moins', async () => {
  const lock = await makeLock('Prof-2026', 20000);
  assert.match(lock.salt, /^[0-9a-f]{32}$/); assert.match(lock.hash, /^[0-9a-f]{64}$/); assert.equal(lock.it, 20000);
  assert.ok(!JSON.stringify(lock).includes('Prof'), 'pas de code en clair');
  assert.equal(await checkLock(lock, 'Prof-2026'), true);
  for (const bad of ['prof-2026', 'Prof-2025', '', null]) assert.equal(await checkLock(lock, bad), false, String(bad));
  const other = await makeLock('Prof-2026', 20000);
  assert.notEqual(other.hash, lock.hash, 'sel différent : empreinte différente');
  await assert.rejects(makeLock('x'.repeat(CODE_MIN - 1)), /court/);
  // Le verrou voyage avec le plan (cleanNet), seulement en mode examen et bien formé.
  const d = cleanNet({ exam: true, examLock: lock });
  assert.deepEqual(d.examLock, lock); assert.deepEqual(cleanNet(d), d);
  assert.equal('examLock' in cleanNet({ examLock: lock }), false, 'sans exam : pas de verrou');
  assert.equal('examLock' in cleanNet({ exam: true, examLock: { salt: 'zz', hash: lock.hash } }), false);
  assert.equal(cleanLock({ ...lock, it: 5 }).it, 200000, 'nombre de tours borné');
  assert.equal(await checkLock({ salt: 'x' }, 'Prof-2026'), false);
});

test('essais du code : après 3 erreurs, 30 s d’attente, puis le double, 15 min au plus ; un bon code remet à zéro', () => {
  let t = 0; const a = attempts(() => t);
  a.fail(); a.fail(); assert.equal(a.wait(), 0);
  a.fail(); assert.equal(a.wait(), 30000);
  t = 30000; assert.equal(a.wait(), 0); a.fail(); assert.equal(a.wait(), 60000);
  for (let i = 0; i < 10; i++) a.fail(); assert.equal(a.wait(), 900000);
  a.ok(); assert.equal(a.wait(), 0);
});

/* ---------- Certification en mode examen ---------- */
const { certLinks, certify, paramsTable, testsCsv, reportHtml, resultRow, rawWireMap } = await import('./certify.js');
const { makeCable } = await import('./cable.js');
/** Panneau, prise, lien permanent dont la fiche B a ses paires 3-6 et 4-5 séparées (échec de la carte de câblage). */
function plan(exam) {
  const w = makeCable(); [w.b.order[2], w.b.order[3]] = [w.b.order[3], w.b.order[2]];
  return cleanNet({ exam, devices: [{ id: 'pb', type: 'patch', name: 'PB1' }, { id: 'pr', type: 'outlet', name: 'PR1' }], cables: [{ id: 'h1', a: ['pb', 'b1'], b: ['pr', 'back'], cat: 'cat6', len: 40, wire: w }] });
}
const VERDICT = /PASS|FAIL|Marge|marge|margin|split|crossed|miswire|reversed|open \(|short/;

test('certification, mode examen : tableau, CSV et rapport sans verdict ni marge ni défaut nommé ; mesures et limites restent', () => {
  const data = plan(true), l = certLinks(data)[0], r = certify(l, 'cat6-pl', { curves: true });
  assert.equal(r.ok, false, 'le lien échoue vraiment (hors examen : FAIL)');
  assert.match(paramsTable(r), /FAIL/);
  const t = paramsTable(r, { exam: true });
  assert.doesNotMatch(t, VERDICT);
  assert.match(t, new RegExp(rawWireMap(r).replace(/[→×]/g, '.')));
  assert.match(rawWireMap(r), /^1→1 2→2 3→\d 4→\d 5→\d 6→\d 7→7 8→8$/);
  assert.match(t, /<td>\d+,\d m<\/td><td>90 m<\/td>/, 'longueur mesurée et sa limite');
  const row = resultRow(r, l, 'PR1', '2026-11-20T10:00:00Z');
  assert.match(testsCsv([row]), /FAIL/);
  const csv = testsCsv([row], { exam: true });
  assert.doesNotMatch(csv, VERDICT); assert.match(csv, /PR1,lien permanent,[^,]+,[\d.]+,2026-11-20/);
  const html = reportHtml({ rows: [row], details: [{ label: 'PR1', res: r }], exam: true });
  const seen = html.replace(/<svg[\s\S]*?<\/svg>|<style>[\s\S]*?<\/style>/g, '').match(new RegExp(VERDICT.source, 'g'));
  assert.equal(seen, null, JSON.stringify(seen));
  assert.match(html, /Mode examen : mesures et limites, sans verdict\./);
  assert.ok((html.match(/<svg/g) || []).length >= 4, 'les courbes face à la limite');
});

test('outils de l’IA cert_link, cert_all, cert_report : en examen, ni verdict ni marge ni défaut, consigne de ne pas donner la réponse', async () => {
  const { tools } = await import('../ai/tools-net-cert.js');
  for (const exam of [false, true]) {
    const data = plan(exam), W = { data: () => data, commit() {} };
    const T = Object.fromEntries(tools({ netWs: async () => W, netPort: () => null, fail: m => { throw new Error(m); } }).map(t => [t.name, t]));
    const one = await T.cert_link.run({ cable: 'h1', save: true }), all = await T.cert_all.run({}), rep = await T.cert_report.run({});
    const text = JSON.stringify([one, all, rep].map(({ note, ...x }) => x));
    if (!exam) { assert.match(text, /FAIL/); assert.equal(one.passes, false); continue; }
    assert.doesNotMatch(text, /PASS|FAIL|margin|weakest|passes|split|faults/);
    assert.equal(one.exam_mode, true); assert.match(one.wire_map_raw, /^1→1 2→2/);
    assert.equal(one.length.limit_m, 90); assert.ok(one.length.value_m > 30 && one.length.value_m < 45);
    assert.equal(all.tested, 1); assert.deepEqual(rep.links[0].result.tested, true);
    for (const x of [one, all, rep]) assert.match(x.note, /^EXAM MODE[\s\S]*Do not tell the student/);
  }
});
