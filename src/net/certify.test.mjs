// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la certification simulée des liens (src/net/certify.js, src/net/checks/cert.js) : node --test src/net/certify.test.mjs
// Les limites redonnent les valeurs publiques citées (tableaux TIA recopiés par DiMinico, CommScope, TSB-155, Fluke) ; les
// liens sont trouvés dans le plan ; les défauts donnent les bons verdicts ; le rapport se nettoie, se périme et s'exporte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limitAt, limitInfo, scalarLimits, LIMIT_IDS, certLinks, certify, certifyCached, defaultLimit, linkLabel, sigOf, cleanTests,
  storeResults, testState, resultRow, testsCsv, chartSvg, reportHtml, seriesOf, paramsTable, freqGrid, N_POINTS
} from './certify.js';
import { issues, LAB, CODES, SRC, modelSig } from './checks/cert.js';
import { cleanNet } from './clean.js';
import { makeCable, endOf } from './cable.js';
import { NET } from './limits.js';
/** Seuils de temps : stricts avec JOLLOF_PERF_STRICT=1 (mesure seule) ; × 8 sinon (suite complète en parallèle, machine chargée). */
const PERF = process.env.JOLLOF_PERF_STRICT ? 1 : 8;

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what} : ${a.toFixed(2)} au lieu de ${b} (±${tol})`);
const SPLIT = () => { const e = { order: ['wo', 'o', 'wg', 'g', 'wbl', 'bl', 'wbr', 'br'], crimped: true, shorts: [] }; return { a: e, b: { ...e, order: e.order.slice() }, cut: [] }; };
const AB = () => ({ a: endOf('A'), b: endOf('B'), cut: [] });

/** Étage : un switch, un panneau, n prises et leurs liens permanents ; cordons de brassage et poste sur la prise 1. */
function floor(spec = [], o = {}) {
  const devices = [{ id: 'sw', type: 'switch', name: 'SW1' }, { id: 'pb', type: 'patch', name: 'PB1' }, { id: 'pc', type: 'pc', name: 'PC1' }];
  const cables = [];
  spec.forEach((s, i) => {
    devices.push({ id: 'pr' + (i + 1), type: 'outlet', name: 'PR' + (i + 1) });
    cables.push({ id: 'h' + (i + 1), a: ['pb', 'b' + (i + 1)], b: ['pr' + (i + 1), 'back'], cat: s.cat || 'cat6', len: s.len ?? 40, wire: s.wire || makeCable() });
  });
  if (o.cords !== false && spec.length) {
    cables.push({ id: 'k1', a: ['sw', 'p1'], b: ['pb', 'f1'], cat: 'cat6', len: 2, wire: makeCable() });
    cables.push({ id: 'k2', a: ['pc', 'eth0'], b: ['pr1', 'front'], cat: 'cat6', len: 3, wire: makeCable() });
  }
  return cleanNet({ devices, cables, view: 'net', site: o.site, tests: o.tests });
}
const plOf = (data, cid) => certLinks(data).find(l => l.id === 'pl:' + cid);

/* ---------- Limites ---------- */
test('les limites du canal redonnent les tableaux TIA publics (DiMinico 2003)', () => {
  // f : [IL, NEXT, PSNEXT, ACR-F, PSACR-F, RL]
  const T5 = { 4: [4.5, 53.5, 50.5, 45.4, 42.4, 17], 10: [7.1, 47, 44, 37.4, 34.4, 17], 31.25: [12.9, 38.7, 35.7, 27.5, 24.5, 15.1], 62.5: [18.6, 33.6, 30.6, 21.5, 18.5, 12.1], 100: [24, 30.1, 27.1, 17.4, 14.4, 10] };
  const T6 = { 1: [2.1, 65, 62, 63.3, 60.3, 19], 10: [6.3, 56.6, 54, 43.3, 40.3, 19], 100: [21.3, 39.9, 37.1, 23.3, 20.3, 12], 200: [31.5, 34.8, 31.9, 17.2, 14.2, 9], 250: [35.9, 33.1, 30.2, 15.3, 12.3, 8] };
  for (const [id, T] of [['cat5e-ch', T5], ['cat6-ch', T6]]) for (const [f, r] of Object.entries(T)) {
    near(limitAt('il', id, +f), r[0], 0.45, `${id} IL ${f}`);
    ['next', 'psnext', 'acrf', 'psacrf', 'rl'].forEach((p, k) => near(limitAt(p, id, +f), r[k + 1], 0.15, `${id} ${p} ${f}`));
  }
  // Plafonds : « > 60 » / « > 57 » dB en Cat 5e à 1 MHz.
  assert.equal(limitAt('next', 'cat5e-ch', 1), 60); assert.equal(limitAt('psnext', 'cat5e-ch', 1), 57);
});

test('Cat 6A : affaiblissement du canal (CommScope), NEXT TIA à 500 MHz ; interpolation proche des formules entre deux points', () => {
  near(limitAt('il', 'cat6a-ch', 100), 20.9, 0.001, 'IL 100'); near(limitAt('il', 'cat6a-ch', 250), 33.9, 0.001, 'IL 250'); near(limitAt('il', 'cat6a-ch', 500), 49.3, 0.001, 'IL 500');
  near(limitAt('next', 'cat6a-ch', 500), 26.1, 0.001, 'NEXT 500'); near(limitAt('psnext', 'cat6a-pl', 500), 23.8, 0.001, 'PSNEXT lien 500');
  assert.equal(limitAt('rl', 'cat6a-ch', 450), 6);
  // Entre deux fréquences du tableau : formules publiques du canal classe E (IEEE 802.3an), écart ≤ 0,35 dB (1 dB sous 4 MHz,
  // où le tableau saute de 65 à 63 dB : interpolation alors un peu plus indulgente).
  const lg = Math.log10, s = Math.sqrt;
  for (const f of [2, 6, 13, 45, 80, 150, 225]) {
    near(limitAt('il', 'cat6-ch', f), 1.05 * (1.82 * s(f) + 0.0169 * f + 0.25 / s(f)) + 4 * 0.02 * s(f), 0.45, `IL Cat 6 ${f}`); // ISO : jusqu'à 0,4 dB de plus que la TIA
    near(limitAt('next', 'cat6-ch', f), Math.min(65, -20 * lg(10 ** (-(74.3 - 15 * lg(f)) / 20) + 2 * 10 ** (-(94 - 20 * lg(f)) / 20))), f < 4 ? 1 : 0.35, `NEXT Cat 6 ${f}`);
  }
});

test('lien permanent : tableaux TIA-568-C.2, recoupés par Fluke (31,1 dB) et TSB-155 (réflexion, délais)', () => {
  near(limitAt('il', 'cat6-pl', 250), 31.1, 0.001, 'IL lien permanent Cat 6 à 250 MHz (Fluke)');
  // Réflexion du lien permanent Cat 6 : formules du projet TSB-155 D1.3 (table 2), jusqu'à 250 MHz ; la norme publiée
  // (tableau 17) s'en écarte de 0,5 dB à 20–25 MHz.
  const rl = f => (f < 3 ? 21 + 4 * Math.log10(f / 3) : f < 10 ? 21 : f < 40 ? 26 - 5 * Math.log10(f) : 34 - 10 * Math.log10(f));
  for (const f of [1, 4, 8, 10, 16, 20, 25, 31.25, 62.5, 100, 200, 250]) near(limitAt('rl', 'cat6-pl', f), rl(f), 0.55, `RL lien ${f}`);
  near(limitAt('next', 'cat5e-pl', 100), 32.3, 0.001, 'NEXT lien Cat 5e'); near(limitAt('next', 'cat6a-pl', 500), 26.7, 0.001, 'NEXT lien Cat 6A');
  near(limitAt('rl', 'cat5e-pl', 100), 12, 0.001, 'RL lien Cat 5e'); near(limitAt('acrf', 'cat6a-pl', 500), 10.2, 0.001, 'ACR-F lien Cat 6A');
  assert.ok(limitAt('next', 'cat6-pl', 100) > limitAt('next', 'cat6-ch', 100) + 1);
  assert.deepEqual(scalarLimits('cat6-pl'), { length: 90, delay: 498, skew: 44 });
  assert.deepEqual(scalarLimits('cat5e-ch'), { length: 100, delay: 555, skew: 50 });
  assert.equal(limitInfo('cat6a-pl').fmax, 500); assert.equal(limitInfo('cat5e-ch').fmax, 100); assert.equal(limitInfo('nope'), null);
  assert.equal(LIMIT_IDS.length, 6);
  for (const id of LIMIT_IDS) for (const f of freqGrid(limitInfo(id).fmax, N_POINTS).f) for (const p of ['il', 'next', 'psnext', 'acrf', 'psacrf', 'rl']) assert.ok(Number.isFinite(limitAt(p, id, f)), `${id} ${p} ${f}`);
  // Chaque tableau couvre la bande de sa catégorie (10, 12, 15 fréquences).
  for (const k of ['CERT_CH', 'CERT_PL']) for (const p of Object.keys(NET[k].v)) assert.deepEqual(['cat5e', 'cat6', 'cat6a'].map(c => NET[k].v[p][c].length), [10, 12, 15], `${k}.${p}`);
});

/* ---------- Liens du plan ---------- */
test('liens permanents et canaux trouvés dans le plan', () => {
  const data = floor([{}, {}, {}]);
  const links = certLinks(data);
  assert.deepEqual(links.filter(l => l.kind === 'pl').map(l => l.id), ['pl:h1', 'pl:h2', 'pl:h3']);
  const ch = links.filter(l => l.kind === 'ch');
  assert.equal(ch.length, 1, 'un seul canal (dédoublonné), PC1 ↔ SW1');
  assert.equal(ch[0].cables.length, 3); assert.equal(ch[0].conns, 2); assert.equal(ch[0].len, 45);
  assert.deepEqual(ch[0].cords, [true, false, true]);
  assert.deepEqual(ch[0].near, [1, 1]);
  assert.match(linkLabel(data, links[0]), /PB1 \(1\) ↔ PR1 \(/);
  assert.equal(defaultLimit(links[0]), 'cat6-pl'); assert.equal(defaultLimit(ch[0]), 'cat6-ch');
  // Fibre : ignorée.
  const f = cleanNet({ devices: [{ id: 'pb', type: 'patch' }, { id: 'o', type: 'outlet' }], cables: [{ id: 'x', a: ['pb', 'b1'], b: ['o', 'back'], media: 'fibre', fibre: 'om3', len: 10 }] });
  assert.ok(!certLinks(f).some(l => l.cables.some(c => c.media === 'fibre')));
});

/* ---------- Autotest simulé ---------- */
test('un lien bien posé réussit, de façon déterministe', () => {
  const data = floor([{ len: 45 }]);
  const l = plOf(data, 'h1'), r = certify(l);
  assert.equal(r.verdict, 'pass'); assert.ok(r.ok); assert.equal(r.limit, 'cat6-pl'); assert.ok(r.margin > 0.5 && r.margin < 5, `marge ${r.margin}`);
  assert.equal(r.simulated, true); assert.equal(r.wiremap.ok, true); assert.equal(r.params.length.v, 43.4);
  assert.deepEqual(certify(l), r, 'même lien, même résultat');
  const c = certify(l, 'cat6-pl', { curves: true });
  assert.equal(c.curves.f.length, N_POINTS); assert.equal(c.curves.meas.next.length, 6); assert.equal(c.verdict, r.verdict, 'courbes : même verdict');
  assert.equal(seriesOf(c, 'next').length, 6); assert.equal(seriesOf(c, 'il').length, 4);
  // Le délai et le décalage restent sous les limites.
  assert.ok(Math.max(...r.params.delay.v) < 498 && r.params.skew.v < 44);
  // Canal à travers panneau et prise.
  const ch = certLinks(data).find(x => x.kind === 'ch');
  assert.ok(certify(ch).ok);
});

test('paire séparée : carte de câblage et diaphonie en échec', () => {
  const r = certify(plOf(floor([{ wire: SPLIT() }]), 'h1'));
  assert.equal(r.verdict, 'fail'); assert.equal(r.param, 'wiremap'); assert.ok(r.wiremap.faults.some(f => f.type === 'split'));
  assert.equal(r.params.next.st, 'fail'); assert.equal(r.params.next.pair, '36-45');
  assert.ok(r.params.next.margin < -10);
});

test('T568A d’un côté, T568B de l’autre : carte de câblage en échec (paires croisées)', () => {
  const r = certify(plOf(floor([{ wire: AB() }]), 'h1'));
  assert.equal(r.verdict, 'fail'); assert.equal(r.param, 'wiremap'); assert.ok(r.wiremap.faults.some(f => f.type === 'crossed'));
});

test('longueur : au-delà de 90 m marginal (incertitude de NVP), au-delà de 99 m échec', () => {
  const tol = NET.CERT_NVP_TOL.v;
  const r95 = certify(plOf(floor([{ len: 95 }]), 'h1'));
  assert.equal(r95.params.length.st, 'pass*'); assert.ok(95 * 0.964 <= 90 * (1 + tol));
  const r104 = certify(plOf(floor([{ len: 104 }]), 'h1'));
  assert.equal(r104.params.length.st, 'fail'); assert.equal(r104.verdict, 'fail'); assert.ok(!r104.ok);
  assert.equal(r104.params.il.st === 'fail' || r104.params.il.st === 'fail*', true, 'l’affaiblissement dépasse aussi');
});

test('catégorie trop basse pour la limite : Cat 5e testé en Cat 6A échoue (NEXT), Cat 6 de 90 m en Cat 6A (IL)', () => {
  const d = floor([{ cat: 'cat5e', len: 40 }, { cat: 'cat6', len: 90 }]);
  assert.ok(certify(plOf(d, 'h1')).ok, 'Cat 5e à sa propre limite');
  const r = certify(plOf(d, 'h1'), 'cat6a-pl'); assert.equal(r.verdict, 'fail'); assert.equal(r.params.next.st, 'fail');
  const r2 = certify(plOf(d, 'h2'), 'cat6a-pl'); assert.ok(!r2.ok); assert.ok(['fail', 'fail*'].includes(r2.params.il.st));
});

test('verdicts : bande de précision nulle = pas d’astérisque, FAIL* compte comme un échec', () => {
  const l = plOf(floor([{ len: 89 }]), 'h1');
  const r0 = certify(l, 'cat6-pl', { band: 0 });
  assert.ok(['pass', 'fail'].includes(r0.verdict));
  for (const p of ['il', 'next', 'psnext', 'acrf', 'psacrf', 'rl']) assert.ok(!r0.params[p].st.includes('*'));
  const big = certify(l, 'cat6-pl', { band: 5 });
  assert.ok(big.verdict.includes('*'));
  const sev = certify(plOf(floor([{ cat: 'cat6', len: 62 }]), 'h1'), 'cat6a-pl', { band: 5 });
  if (sev.verdict === 'fail*') assert.equal(sev.ok, false);
});

/* ---------- Rapport ---------- */
test('cleanTests : déchets refusés, bornes, doublons, idempotent', () => {
  assert.equal(cleanTests(null), null); assert.equal(cleanTests('x'), null); assert.equal(cleanTests([1]), null);
  const t = cleanTests({ at: '2026-11-20', band: 99, results: [null, { link: 'pl:a', verdict: 'nope', limit: 'cat9', margin: 1e9, param: 'x', pair: '<b>', len: -4 }, { link: 'pl:a' }, { link: 'pl:b', verdict: 'pass*', limit: 'cat6a-ch', ends: [['a', 'b'], ['c', 'd']], cables: ['h1', 5] }] });
  assert.equal(t.band, 5); assert.equal(t.results.length, 2);
  assert.deepEqual([t.results[0].verdict, t.results[0].limit, t.results[0].margin, t.results[0].param, t.results[0].pair, t.results[0].len], ['fail', 'cat6-pl', 99, 'wiremap', null, 0]);
  assert.equal(t.results[1].kind, 'pl'); assert.deepEqual(t.results[1].ends, [['a', 'b'], ['c', 'd']]); assert.deepEqual(t.results[1].cables, ['h1', '5']);
  assert.deepEqual(cleanTests(t), t);
  const many = cleanTests({ results: Array.from({ length: 7000 }, (_, i) => ({ link: 'l' + i })) }); assert.equal(many.results.length, 6000);
  // Dans le plan complet : cleanNet(cleanNet(x)) stable.
  const d = floor([{}], { tests: t }); assert.deepEqual(cleanNet(d).tests, d.tests); assert.deepEqual(cleanNet(cleanNet(d)), cleanNet(d));
});

test('résultats enregistrés, périmés quand le plan change, liens disparus', () => {
  const data = floor([{}, {}]);
  const links = certLinks(data).filter(l => l.kind === 'pl');
  const rows = links.map(l => resultRow(certify(l), l, linkLabel(data, l), '2026-11-20T10:00:00Z'));
  storeResults(data, rows, '2026-11-20T10:00:00Z');
  assert.equal(data.tests.results.length, 2); assert.equal(data.tests.at, '2026-11-20T10:00:00Z');
  assert.ok(testState(data).rows.every(r => !r.stale));
  data.cables.find(c => c.id === 'h2').len = 70;
  const st = testState(data);
  assert.deepEqual(st.rows.filter(r => r.stale).map(r => r.link.id), ['pl:h2']);
  data.cables = data.cables.filter(c => c.id !== 'h1');
  assert.deepEqual(testState(data).orphans.map(r => r.link), ['pl:h1']);
  assert.notEqual(sigOf(links[0], 'cat6-pl'), sigOf(links[0], 'cat6a-pl'));
});

test('export : CSV, tableau, graphique SVG et rapport imprimable', () => {
  const data = floor([{}, { wire: SPLIT() }]);
  const ls = certLinks(data).filter(l => l.kind === 'pl');
  const res = ls.map(l => certify(l, undefined, { curves: true }));
  const rows = res.map((r, i) => ({ ...resultRow(r, ls[i], linkLabel(data, ls[i]), '2026-11-20T10:00:00Z'), stale: i === 1 }));
  const csv = testsCsv(rows);
  assert.equal(csv.trim().split('\r\n').length, 3); assert.match(csv, /PASS/); assert.match(csv, /FAIL/); assert.match(csv, /PB1 \(2\) ↔ PR2 \(/);
  const svg = chartSvg(res[0], 'next'); assert.match(svg, /^<svg class="ntCeChart"/); assert.equal((svg.match(/class="ntCeS /g) || []).length, 6); assert.match(svg, /ntCeLim/);
  assert.match(chartSvg(res[0], 'il', { print: true }), /stroke="#dc2626"/);
  assert.equal(chartSvg({}, 'il'), '');
  assert.match(paramsTable(res[1]), /split/);
  const html = reportHtml({ title: 'Rapport', project: 'Étage 1', at: '2026-11-20T10:00:00Z', rows, details: res.map((r, i) => ({ label: rows[i].label, res: r })) });
  assert.match(html, /^<!doctype html>/); assert.equal((html.match(/class="page"/g) || []).length, 2); assert.match(html, /simulées|simulated/);
});

/* ---------- Vérificateur ---------- */
test('vérificateur : J1286 échec calculé, pas de doublon avec la carte de câblage, J1288 périmé, J1289 sans test', () => {
  assert.deepEqual(Object.keys(CODES).sort(), Object.keys(SRC).sort());
  const site = { name: 'Bât', buildings: [{ id: 'b1', name: 'A', floors: [{ id: 'f1', name: 'RDC' }] }] };
  const data = floor([{ len: 40 }, { len: 104 }, { wire: SPLIT() }], { site });
  let iss = issues(data, null, { name: x => x });
  assert.deepEqual(iss.filter(i => i.code === 'J1286').map(i => i.id), ['h2'], 'le lien trop long, pas la paire séparée (J1202)');
  assert.match(iss.find(i => i.code === 'J1286').text, /PB1 \(2\) ↔ PR2/);
  const hasSite = !!(data.site && data.site.buildings && data.site.buildings.length && data.site.buildings[0].floors && data.site.buildings[0].floors.length);
  assert.equal(iss.some(i => i.code === 'J1289'), hasSite, 'J1289 seulement avec un plan de bâtiment (cleanSite de la partie plan)');
  // Test enregistré à la limite Cat 6A pour le lien 1 : il échoue à cette limite ? non (Cat 6 de 40 m en Cat 6A : IL ok, NEXT ok).
  const l1 = plOf(data, 'h1');
  storeResults(data, [resultRow(certify(l1, 'cat5e-pl'), l1, 'x', 'now')]);
  iss = issues(data, null, {});
  assert.ok(!iss.some(i => i.code === 'J1288'));
  data.cables.find(c => c.id === 'h1').len = 50;
  iss = issues(data, null, {});
  assert.equal(iss.filter(i => i.code === 'J1288').length, 1, 'un seul message groupé');
  // Sans aucun lien : rien.
  assert.deepEqual(issues(cleanNet({ devices: [{ id: 'p', type: 'pc' }] }), null, {}), []);
});

test('vérificateur : J1287 réussite marginale en diaphonie, pas pour l’affaiblissement seul', () => {
  const data = floor([{ len: 40 }], { tests: { band: 5, results: [] } });
  const iss = issues(data, null, {});
  const r = certifyCached(plOf(data, 'h1'), 'cat6-pl', { band: 5 });
  assert.equal(iss.some(i => i.code === 'J1287'), ['next', 'psnext', 'acrf', 'psacrf', 'rl'].some(p => r.params[p].st === 'pass*'));
  assert.ok(iss.every(i => i.code !== 'J1286'));
});

test('contrôle de TP net-cert : tous les liens, un appareil, une limite imposée', () => {
  const data = floor([{ len: 40 }, { cat: 'cat5e', len: 30 }]);
  const env = { netData: () => data };
  const C = LAB['net-cert'];
  assert.equal(C.check({ type: 'net-cert' }, env).ok, true);
  const r = C.check({ type: 'net-cert', limit: 'cat6a-pl' }, env);
  assert.equal(r.ok, false); assert.equal(r.bad.length, 1); assert.match(C.text({}, r), /PR2/);
  assert.equal(C.check({ type: 'net-cert', limit: 'cat6a-pl', of: 'PR1' }, env).ok, true);
  const none = C.check({ type: 'net-cert', of: 'PR9' }, env); assert.equal(none.ok, false); assert.equal(none.why, 'nolink'); assert.match(C.text({ of: 'PR9' }, none), /PR9/);
  assert.equal(C.check({ type: 'net-cert', links: 'ch' }, env).ok, true);
});

test('taille réelle : 600 liens permanents vérifiés vite (mémoire des résultats)', () => {
  const spec = Array.from({ length: 600 }, (_, i) => ({ len: 10 + (i % 80), cat: i % 3 ? 'cat6' : 'cat6a' }));
  const devices = [{ id: 'sw', type: 'switch', name: 'SW1' }], cables = [];
  for (let p = 0; p < 50; p++) devices.push({ id: 'pb' + p, type: 'patch', name: 'PB' + p });
  spec.forEach((s, i) => { devices.push({ id: 'o' + i, type: 'outlet', name: 'PR' + i }); cables.push({ id: 'h' + i, a: ['pb' + Math.floor(i / 12), 'b' + (i % 12 + 1)], b: ['o' + i, 'back'], cat: s.cat, len: s.len, wire: makeCable() }); });
  const data = cleanNet({ devices, cables, view: 'net' });
  let t = performance.now(); const first = issues(data, null, {}); const t1 = performance.now() - t;
  // Plan inchangé : empreinte seulement (pas de parcours des liens).
  let t2 = Infinity; for (let k = 0; k < 5; k++) { t = performance.now(); issues(data, null, {}); t2 = Math.min(t2, performance.now() - t); }
  assert.deepEqual(issues(data, null, {}), first);
  // Un câble change : seuls ses liens sont recalculés (résultats mémorisés par empreinte de lien).
  data.cables[5].len = 104;
  t = performance.now(); const changed = issues(data, null, {}); const t3 = performance.now() - t;
  assert.ok(changed.some(i => i.code === 'J1286' && i.id === 'h5'), 'le changement est vu');
  assert.ok(t1 < 1500 * PERF, `premier calcul ${t1.toFixed(0)} ms`); assert.ok(t2 < 3 * PERF, `plan inchangé ${t2.toFixed(1)} ms`); assert.ok(t3 < 50 * PERF, `après un changement ${t3.toFixed(0)} ms`);
  console.log(`    600 liens permanents : premier calcul ${t1.toFixed(0)} ms, plan inchangé ${t2.toFixed(1)} ms, après un changement ${t3.toFixed(0)} ms`);
});

test('vérificateur : la mémoire se périme à chaque changement du plan', () => {
  const data = floor([{ len: 40 }, { len: 50 }]);
  const codes = () => issues(data, null, {}).map(i => i.code + ':' + i.id).sort().join(' ');
  assert.equal(codes(), ''); assert.equal(codes(), '');
  data.cables.find(c => c.id === 'h2').len = 104; assert.equal(codes(), 'J1286:h2', 'longueur modifiée sur place');
  data.cables.find(c => c.id === 'h2').len = 50; assert.equal(codes(), '');
  data.cables.find(c => c.id === 'h1').cat = 'cat5e';
  storeResults(data, [resultRow(certify(plOf(data, 'h1'), 'cat6a-pl'), plOf(data, 'h1'), 'x', 'a')]);
  assert.equal(codes(), 'J1286:h1', 'nouveau rapport (limite Cat 6A) vu');
  data.cables.find(c => c.id === 'h1').wire.a = endOf('A'); // fiche refaite (objet remplacé, comme l'application)
  assert.match(codes(), /J1288:h1/, 'rapport périmé'); assert.ok(!/J1286:h1/.test(codes()), 'carte de câblage fausse : J1201, pas J1286');
  data.cables.push({ id: 'h9', a: ['pb', 'b9'], b: ['pr1', 'front'], cat: 'cat6', len: 3, wire: makeCable() });
  assert.notEqual(modelSig(data), modelSig(floor([{ len: 40 }, { len: 50 }])));
  data.devices.find(d => d.id === 'pr2').name = 'BUREAU2'; data.cables.find(c => c.id === 'h2').len = 104;
  assert.match(issues(data, null, {}).find(i => i.code === 'J1286' && i.id === 'h2').text, /BUREAU2/, 'nom changé sur place');
  // Avec le réseau simulé : sa version (recalcul à chaque ctx.commit()) suffit tant qu'elle ne change pas.
  const lan = { version: 1 };
  const a = issues(data, lan, {}); data.cables.find(c => c.id === 'h2').len = 50;
  assert.deepEqual(issues(data, lan, {}), a, 'même version : pas relu (l’application recalcule toujours après un changement)');
  lan.version = 2; assert.ok(!issues(data, lan, {}).some(i => i.code === 'J1286' && i.id === 'h2'), 'nouvelle version : relu');
});
