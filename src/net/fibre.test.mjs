// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests de la fibre optique (src/net/fibre.js, src/net/checks/fibre.js) : node --test src/net/fibre.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIBRE_TYPES, FIBRE_IDS, MODULES, MODULE_IDS, attOf, cleanMedia, fibreChannel, channelLoss, fibreLink, budgetRows, cageFits, modulesFor, moduleOf } from './fibre.js';
import { CODES, SRC, issues, fibreLinks, LAB } from './checks/fibre.js';
import { NET } from './limits.js';
import { NET_SRC } from './issues.js';
import { cleanNet } from './clean.js';
import { DEVICES } from './devices.js';
import { SOURCES } from '../check/sources.js';
import '../check/sources-net.js';
import { CODES as ALL_CODES } from '../check/codes.js';
import { EXPLAIN } from '../check/explain.js';
import '../check/explain-net.js';
// Temps : temps CPU du processus (src/net/perf.mjs), seuils tenus même dans la suite complète.
import { once, best, note } from './perf.mjs';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} ≠ ${b}`);
const fc = (len, fibre, o = {}) => ({ id: o.id || 'c' + Math.random().toString(36).slice(2, 7), len, media: 'fibre', fibre, splices: o.splices || 0, ...(o.attn ? { attn: o.attn } : {}), ...(o.mcp ? { mcp: true } : {}) });

/* ---------- Catalogue ---------- */
test('types de fibre : mode, affaiblissement aux bonnes longueurs d’onde', () => {
  assert.deepEqual(FIBRE_IDS, ['om1', 'om2', 'om3', 'om4', 'om5', 'os1', 'os2']);
  for (const [id, t] of Object.entries(FIBRE_TYPES)) {
    assert.ok(['mmf', 'smf'].includes(t.mode), id);
    const w = t.mode === 'mmf' ? [850, 1300] : [1310, 1550];
    for (const nm of w) assert.ok(t.att[nm] > 0 && t.att[nm] <= 3.5, `${id} ${nm}`);
    if (t.mode === 'mmf') assert.ok(t.att[850] > t.att[1300], `${id} : 850 nm plus atténué que 1300 nm`);
  }
  near(attOf('om3', 850), 3.0, 'OM3 850'); near(attOf('om1', 850), 3.5, 'OM1 850');
  near(attOf('om4', 1310), 1.5, 'module 1310 nm sur multimode : fenêtre 1300 nm');
  near(attOf('os2', 1310), 0.4, 'OS2 1310'); near(attOf('os2', 1550), 0.3, 'OS2 1550'); near(attOf('os1', 1550), 1.0, 'OS1 1550');
  assert.equal(attOf('xx', 850), null);
});

test('modules : champs complets, portées cohérentes, bilans tirés des fiches', () => {
  for (const id of ['1000BASE-SX', '1000BASE-LX', '1000BASE-T', '10GBASE-SR', '10GBASE-LR', '10GBASE-ER', '10GBASE-T', '25GBASE-SR', '25GBASE-LR']) assert.ok(MODULES[id], id);
  for (const id of MODULE_IDS) {
    const m = MODULES[id];
    assert.equal(m.name, id);
    assert.ok([1000, 10000, 25000].includes(m.speed), id + ' vitesse');
    assert.ok(['mmf', 'smf', 'copper'].includes(m.media), id + ' support');
    assert.ok(['sfp', 'sfp+', 'sfp28'].includes(m.form), id + ' format');
    assert.ok(Object.keys(m.reach).length, id + ' portée');
    assert.ok(m.src.length && m.src.every(k => SOURCES[k]), id + ' sources');
    if (m.media === 'copper') { assert.ok(m.reach.copper > 0); continue; }
    assert.ok(m.nm >= 840 && m.nm <= 1560, id + ' longueur d’onde');
    for (const t of Object.keys(m.reach)) assert.equal(FIBRE_TYPES[t].mode === 'mmf' ? 'mmf' : 'smf', m.mcp && FIBRE_TYPES[t].mode === 'mmf' ? 'mmf' : m.media, `${id} sur ${t}`);
    assert.ok(m.tx[0] < m.tx[1] && m.rx[0] < m.rx[1], id + ' plages dBm');
    near(m.budget, Math.round((m.tx[0] - m.rx[0]) * 100) / 100, id + ' bilan = émission min - sensibilité');
    for (const [t, db] of Object.entries(m.chan || {})) assert.ok(m.reach[t] && db > 0 && db <= 12, `${id} canal ${t}`);
  }
  // Chiffres lus dans les sources (FOA, Fluke, Cisco).
  assert.equal(MODULES['10GBASE-SR'].reach.om3, 300); assert.equal(MODULES['10GBASE-SR'].reach.om4, 400); assert.equal(MODULES['10GBASE-SR'].reach.om1, 33);
  near(MODULES['10GBASE-SR'].chan.om3, 2.6, 'SR OM3'); near(MODULES['10GBASE-SR'].chan.om4, 2.9, 'SR OM4');
  near(MODULES['10GBASE-LR'].chan.os2, 6.2, 'LR'); near(MODULES['10GBASE-ER'].chan.os2, 11.0, 'ER'); assert.equal(MODULES['10GBASE-ER'].reach.os2, 40000);
  near(MODULES['1000BASE-LX'].budget, 10.5, 'LX/LH'); assert.equal(MODULES['1000BASE-SX'].reach.om2, 550);
  assert.equal(MODULES['10GBASE-T'].reach.copper, 30); assert.equal(MODULES['1000BASE-T'].reach.copper, 100);
  assert.equal(moduleOf('10GBASE-SR'), MODULES['10GBASE-SR']); assert.equal(moduleOf('nope'), null); assert.equal(moduleOf(null), null);
});

test('cages : un module 1G entre dans une cage SFP+, un 10G pas dans une cage SFP', () => {
  assert.ok(cageFits('sfp+', '1000BASE-SX')); assert.ok(cageFits('sfp+', '10GBASE-LR')); assert.ok(cageFits('sfp', '1000BASE-T'));
  assert.ok(!cageFits('sfp', '10GBASE-SR')); assert.ok(!cageFits('sfp+', '25GBASE-SR')); assert.ok(!cageFits('qsfp', '10GBASE-SR')); assert.ok(!cageFits('sfp+', 'x'));
  assert.ok(modulesFor('sfp').every(id => MODULES[id].speed === 1000));
  assert.ok(modulesFor('sfp+').length > modulesFor('sfp').length);
});

/* ---------- Câble ---------- */
test('cleanMedia : fibre bornée, cuivre vide, idempotent', () => {
  assert.deepEqual(cleanMedia({ cat: 'cat6', len: 3 }), {});
  assert.deepEqual(cleanMedia(null), {}); assert.deepEqual(cleanMedia('x'), {}); assert.deepEqual(cleanMedia({ media: 'copper', fibre: 'om3' }), {});
  assert.deepEqual(cleanMedia({ media: 'fibre' }), { media: 'fibre', fibre: 'om4', splices: 0 });
  assert.deepEqual(cleanMedia({ fibre: 'os2' }), { media: 'fibre', fibre: 'os2', splices: 0 }, 'fibre seule : câble fibre');
  const g = cleanMedia({ media: 'fibre', fibre: 'zz', splices: 1e9, attn: 99, mcp: 'yes' });
  assert.deepEqual(g, { media: 'fibre', fibre: 'om4', splices: 200, attn: 30 });
  const x = cleanMedia({ media: 'fibre', fibre: 'om3', splices: 2.7, attn: 5.04, mcp: true });
  assert.deepEqual(x, { media: 'fibre', fibre: 'om3', splices: 2, attn: 5, mcp: true });
  assert.deepEqual(cleanMedia({ ...x }), x, 'idempotent');
  assert.deepEqual(cleanMedia({ media: 'fibre', fibre: 'os2', splices: -3, attn: -1 }), { media: 'fibre', fibre: 'os2', splices: 0 });
});

test('cleanNet garde les champs fibre et reste stable', () => {
  const raw = { devices: [{ id: 'a', type: 'pc' }, { id: 'b', type: 'pc' }], cables: [{ id: 'f', a: ['a', 'eth0'], b: ['b', 'eth0'], len: 25000, media: 'fibre', fibre: 'os2', splices: 4, attn: 5 }] };
  const n1 = cleanNet(raw), n2 = cleanNet(n1);
  assert.equal(n1.cables[0].media, 'fibre'); assert.equal(n1.cables[0].len, 25000); assert.equal(n1.cables[0].splices, 4); assert.equal(n1.cables[0].attn, 5);
  assert.deepEqual(n2.cables, n1.cables);
});

/* ---------- Canal et bilan ---------- */
test('fibreChannel : longueurs par type, connexions = traversées, épissures, mélange', () => {
  const ch = fibreChannel([fc(2, 'om4'), fc(280, 'om4', { splices: 2 }), fc(3, 'om4')], 2);
  assert.equal(ch.media, 'fibre'); assert.equal(ch.len, 285); assert.equal(ch.connectors, 2); assert.equal(ch.ends, 2); assert.equal(ch.splices, 2);
  assert.deepEqual(ch.types, ['om4']); assert.equal(ch.mixed, false); assert.equal(ch.fibre, 'om4');
  const mx = fibreChannel([fc(2, 'om3'), fc(100, 'om4')], 1);
  assert.ok(mx.mixed); assert.equal(mx.fibre, 'om4'); assert.deepEqual(mx.modes, ['mmf']);
  const sm = fibreChannel([fc(2, 'om3'), fc(100, 'os2')], 1); assert.deepEqual(sm.modes.sort(), ['mmf', 'smf']);
  assert.equal(fibreChannel([{ len: 5, cat: 'cat6' }], 0).media, 'copper');
  assert.equal(fibreChannel([{ len: 5, cat: 'cat6' }, fc(10, 'om3')], 1).media, 'mixed');
  assert.equal(fibreChannel([], 0).media, 'copper'); assert.equal(fibreChannel(null).len, 0);
});

test('perte : longueur × affaiblissement + connexions × 0,75 + épissures × 0,3 + atténuateur', () => {
  const ch = fibreChannel([fc(1200, 'os2', { splices: 2 })], 2);
  const l = channelLoss(ch, 1310);
  near(l.fibre, 0.48, 'fibre'); near(l.conn, 1.5, 'connexions'); near(l.splice, 0.6, 'épissures'); near(l.total, 2.58, 'total');
  near(channelLoss(ch, 1550).fibre, 0.36, '1550 nm');
  near(channelLoss(fibreChannel([fc(300, 'om3', { attn: 5 })], 0), 850).total, 5.9, 'atténuateur compté');
  assert.equal(NET.FIBRE_CONN_DB.v, 0.75); assert.equal(NET.FIBRE_SPLICE_DB.v, 0.3);
});

test('fibreLink : liaison 10GBASE-LR sur OS2, marge et portée', () => {
  const ch = fibreChannel([fc(3, 'os2'), fc(1200, 'os2', { splices: 2 }), fc(3, 'os2')], 2);
  const r = fibreLink(ch, '10GBASE-LR', '10GBASE-LR');
  assert.equal(r.up, true); assert.equal(r.why, null); assert.equal(r.speed, 10000);
  near(r.loss, 2.58, 'perte'); near(r.budget, 6.2, 'IEEE'); near(r.margin, 3.62, 'marge'); assert.equal(r.reach, 10000); assert.equal(r.basis, 'ieee'); assert.equal(r.overload, 0);
});

test('fibreLink : mauvais appariements', () => {
  const os2 = fibreChannel([fc(500, 'os2')], 2), om3 = fibreChannel([fc(200, 'om3')], 2), cu = fibreChannel([{ len: 20, cat: 'cat6a' }], 0);
  assert.equal(fibreLink(os2, '10GBASE-SR', '10GBASE-SR').why, 'fibretype', 'SR sur OS2');
  assert.equal(fibreLink(om3, '10GBASE-LR', '10GBASE-LR').why, 'fibretype', 'LR sur OM3');
  assert.equal(fibreLink(om3, '10GBASE-SR', '10GBASE-LR').why, 'mismatch', 'modules différents');
  assert.equal(fibreLink(om3, '10GBASE-SR', null).why, 'nomodule'); assert.equal(fibreLink(om3, 'zz', 'zz').why, 'nomodule');
  assert.equal(fibreLink(om3, '1000BASE-T', '1000BASE-T').why, 'media', 'module cuivre sur fibre');
  assert.equal(fibreLink(cu, '10GBASE-SR', '10GBASE-SR').why, 'media', 'module optique sur cuivre');
  assert.equal(fibreLink(fibreChannel([{ len: 2, cat: 'cat6' }, fc(10, 'om3')], 1), '10GBASE-SR', '10GBASE-SR').why, 'media', 'cuivre et fibre bout à bout');
  assert.equal(fibreLink(fibreChannel([fc(2, 'om3'), fc(100, 'os2')], 1), '10GBASE-LR', '10GBASE-LR').why, 'fibretype', 'monomode et multimode');
  assert.equal(fibreLink(fibreChannel([fc(100, 'om1')], 0), '25GBASE-SR', '25GBASE-SR').why, 'fibretype', '25G-SR non défini sur OM1');
  // 1000BASE-LX sur multimode : seulement avec le cordon de conditionnement de mode.
  const lx = fibreLink(om3, '1000BASE-LX', '1000BASE-LX'); assert.equal(lx.why, 'fibretype'); assert.equal(lx.need, 'mcp');
  const lxm = fibreLink(fibreChannel([fc(200, 'om3', { mcp: true })], 2), '1000BASE-LX', '1000BASE-LX');
  assert.equal(lxm.up, true); near(lxm.budget, 2.3, 'LX multimode : canal IEEE'); near(lxm.loss, 0.3 + 1.5, 'perte à 1300 nm');
  assert.equal(fibreLink(os2, '1000BASE-LX', '1000BASE-LX').basis, 'power', 'LX/LH monomode : bilan de puissance Cisco');
});

test('fibreLink : portée et bilan', () => {
  // 10GBASE-SR : 300 m sur OM3, 400 m sur OM4.
  assert.equal(fibreLink(fibreChannel([fc(350, 'om3')], 0), '10GBASE-SR', '10GBASE-SR').why, 'reach');
  const om4 = fibreLink(fibreChannel([fc(350, 'om4')], 0), '10GBASE-SR', '10GBASE-SR'); assert.equal(om4.up, true); near(om4.loss, 1.05, 'OM4 350 m');
  // Portée tenue mais trop de connexions : 4 traversées (3 dB) sur 100 m d'OM4 > 2,9 dB.
  const b = fibreLink(fibreChannel([fc(100, 'om4')], 4), '10GBASE-SR', '10GBASE-SR'); assert.equal(b.why, 'budget'); near(b.loss, 3.3, 'perte'); assert.ok(b.margin < 0);
  // Exactement au bilan : passe.
  assert.equal(fibreLink(fibreChannel([fc(200, 'om3')], 2), '10GBASE-SR', '10GBASE-SR').up, true, '0,6 + 1,5 = 2,1 ≤ 2,6');
  // Plusieurs types : la plus faible portée et la plus faible perte tolérée.
  const mix = fibreLink(fibreChannel([fc(50, 'om3'), fc(280, 'om4')], 1), '10GBASE-SR', '10GBASE-SR'); assert.equal(mix.why, 'reach'); assert.equal(mix.reach, 300);
  // 10GBASE-ER à 40 km sur G.652.D (0,3 dB/km) : 12 dB > 11 dB (lien « travaillé » de l'IEEE : fibre moins atténuée).
  assert.equal(fibreLink(fibreChannel([fc(40000, 'os2')], 0), '10GBASE-ER', '10GBASE-ER').why, 'budget');
  assert.equal(fibreLink(fibreChannel([fc(30000, 'os2')], 2), '10GBASE-ER', '10GBASE-ER').up, true);
  // Cuivre en SFP : 10GBASE-T jusqu'à 30 m.
  assert.equal(fibreLink(fibreChannel([{ len: 25, cat: 'cat6a' }], 0), '10GBASE-T', null).up, true);
  const t = fibreLink(fibreChannel([{ len: 45, cat: 'cat6a' }], 0), '10GBASE-T', null); assert.equal(t.why, 'reach'); assert.equal(t.reach, 30);
  assert.equal(fibreLink(fibreChannel([{ len: 80, cat: 'cat6' }], 0), '1000BASE-T', '1000BASE-T').speed, 1000);
});

test('fibreLink : récepteur saturé sur une liaison courte (ER, ZX)', () => {
  const er = fibreLink(fibreChannel([fc(1200, 'os2', { splices: 2 })], 2), '10GBASE-ER', '10GBASE-ER');
  assert.equal(er.up, true); near(er.overload, 5 - er.loss, 'il manque 5 dB - perte'); assert.equal(er.errors, true);
  const fixed = fibreLink(fibreChannel([fc(1200, 'os2', { splices: 2, attn: 5 })], 2), '10GBASE-ER', '10GBASE-ER');
  assert.equal(fixed.overload, 0, 'atténuateur de 5 dB'); assert.equal(fixed.up, true);
  assert.equal(fibreLink(fibreChannel([fc(20000, 'os2')], 2), '10GBASE-ER', '10GBASE-ER').overload, 0, 'ER sur 20 km : pas de saturation');
  assert.ok(fibreLink(fibreChannel([fc(10000, 'os2')], 2), '1000BASE-ZX', '1000BASE-ZX').overload > 0, 'ZX sur 10 km');
  assert.equal(fibreLink(fibreChannel([fc(100, 'om3')], 0), '10GBASE-SR', '10GBASE-SR').overload, 0, 'SR ne sature pas');
});

test('budgetRows : lignes de la calculette', () => {
  const ch = fibreChannel([fc(1200, 'os2', { splices: 2 })], 2), lk = fibreLink(ch, '10GBASE-LR', '10GBASE-LR');
  const rows = budgetRows(ch, lk), by = k => rows.find(r => r.key === k);
  assert.deepEqual(rows.map(r => r.key), ['fibre', 'conn', 'splice', 'total', 'budget', 'margin']);
  near(by('fibre').db, 0.48, 'fibre'); near(by('conn').db, 1.5, 'connexions'); near(by('splice').db, 0.6, 'épissures'); near(by('total').db, 2.58, 'total');
  near(by('budget').db, 6.2, 'tolérée'); near(by('margin').db, 3.62, 'marge');
  const sum = rows.filter(r => ['fibre', 'conn', 'splice', 'attn'].includes(r.key)).reduce((s, r) => s + r.db, 0); near(sum, by('total').db, 'somme');
  const r2 = budgetRows(fibreChannel([fc(300, 'om3'), fc(10, 'om4', { attn: 3 })], 1), { module: '10GBASE-SR' });
  assert.equal(r2.filter(r => r.key === 'fibre').length, 2); assert.ok(r2.find(r => r.key === 'attn')); assert.ok(!r2.find(r => r.key === 'budget'));
});

/* ---------- Vérificateur ---------- */
// Équipements d'essai (les vrais, switch24 / l3switch / fibrepanel, viennent de devices.js) : cages x1…x4, panneau f/b.
const SPEC = {
  sw: pid => (/^x\d$/.test(pid) ? { id: pid, sfp: 'sfp+' } : /^g\d$/.test(pid) ? { id: pid, sfp: 'sfp' } : /^p\d+$/.test(pid) ? { id: pid } : null),
  fp: pid => (/^f\d+$/.test(pid) ? { id: pid, fibre: true, passive: 'b' + pid.slice(1) } : /^b\d+$/.test(pid) ? { id: pid, fibre: true, passive: 'f' + pid.slice(1) } : null)
};
const ports = (d, pid) => SPEC[d.type](pid);
const dev = (id, type, sfp) => ({ id, type, name: id.toUpperCase(), p: sfp ? { sfp } : {} });
/** Deux bâtiments : SW1.x1 — cordon — FP1 — dorsale — FP2 — cordon — SW2.x1. */
function campus({ modA = '10GBASE-LR', modB = modA, fibre = 'os2', len = 1200, splices = 2, attn = 0, mcp = false, cordFibre = fibre, portA = 'x1' } = {}) {
  return {
    devices: [dev('sw1', 'sw', modA ? { [portA]: modA } : {}), dev('fp1', 'fp'), dev('fp2', 'fp'), dev('sw2', 'sw', modB ? { x1: modB } : {})],
    cables: [
      { id: 'k1', a: ['sw1', portA], b: ['fp1', 'f1'], len: 3, media: 'fibre', fibre: cordFibre, splices: 0, ...(mcp ? { mcp: true } : {}) },
      { id: 'bb', a: ['fp1', 'b1'], b: ['fp2', 'b1'], len, media: 'fibre', fibre, splices, ...(attn ? { attn } : {}) },
      { id: 'k2', a: ['fp2', 'f1'], b: ['sw2', 'x1'], len: 3, media: 'fibre', fibre: cordFibre, splices: 0 }
    ]
  };
}
const H = { name: id => id.toUpperCase() };
const codes = data => issues(data, null, H, ports).map(i => i.code);

test('codes J1240–J1249 : niveaux, sources, explications', () => {
  assert.deepEqual(Object.keys(CODES).sort(), ['J1240', 'J1241', 'J1242', 'J1243', 'J1244', 'J1245', 'J1246', 'J1247', 'J1248', 'J1249']);
  for (const [c, lvl] of Object.entries(CODES)) {
    assert.equal(ALL_CODES[c] && ALL_CODES[c].level, lvl, c + ' dans codes.js');
    assert.ok(EXPLAIN[c] && EXPLAIN[c].what && EXPLAIN[c].why && EXPLAIN[c].fix, c + ' expliqué');
    assert.ok(SRC[c].length && SRC[c].every(k => SOURCES[k]), c + ' sourcé');
    assert.deepEqual(NET_SRC[c], SRC[c], c + ' fusionné dans NET_SRC');
  }
  for (const [k, e] of Object.entries(NET)) if (k.startsWith('FIBRE_')) assert.ok([].concat(e.src).every(s => SOURCES[s]), k);
});

test('vérificateur : liaison correcte, aucun défaut', () => {
  const L = fibreLinks(campus(), null, ports);
  assert.equal(L.length, 1); assert.equal(L[0].passes, 2); assert.equal(L[0].cables.length, 3); assert.equal(L[0].link.up, true);
  near(L[0].link.loss, 2.58, 'perte avec les cordons (arrondie au centième)');
  assert.deepEqual(codes(campus()), []);
});

test('vérificateur : chaque défaut a son code', () => {
  assert.deepEqual(codes(campus({ modA: '10GBASE-SR', modB: '10GBASE-LR' })), ['J1244'], 'modules différents');
  assert.deepEqual(codes(campus({ modA: '10GBASE-SR', modB: '10GBASE-SR' })), ['J1242'], 'SR sur OS2');
  assert.deepEqual(codes(campus({ fibre: 'om3', len: 200 })), ['J1242'], 'LR sur OM3');
  assert.deepEqual(codes(campus({ modA: '1000BASE-LX', fibre: 'om3', len: 200 })), ['J1242'], 'LX sans cordon');
  assert.deepEqual(codes(campus({ modA: '1000BASE-LX', fibre: 'om3', len: 200, splices: 0, mcp: true })), [], 'LX avec cordon');
  assert.deepEqual(codes(campus({ modA: '10GBASE-SR', fibre: 'om3', len: 500 })), ['J1241'], 'SR trop long');
  assert.deepEqual(codes(campus({ len: 9000, splices: 6 })), ['J1240'], 'LR : 3,6 + 1,5 + 1,8 > 6,2');
  assert.deepEqual(codes(campus({ modA: '10GBASE-ER' })), ['J1249'], 'ER sur 1,2 km : saturé');
  assert.deepEqual(codes(campus({ modA: '10GBASE-ER', attn: 5 })), [], 'ER avec atténuateur');
  assert.deepEqual(codes(campus({ modA: '1000BASE-T' })), ['J1243'], 'module cuivre sur fibre');
  assert.deepEqual(codes(campus({ modA: null, modB: '10GBASE-LR' })), ['J1245'], 'cage vide');
  assert.deepEqual(codes(campus({ modA: 'XYZ', modB: '10GBASE-LR' })), ['J1245'], 'module inconnu');
  assert.deepEqual(codes(campus({ modA: '10GBASE-LR', portA: 'g1' })), ['J1248'], 'SFP+ dans une cage SFP');
  assert.deepEqual(codes(campus({ fibre: 'om4', cordFibre: 'om3', modA: '10GBASE-SR', len: 150 })), ['J1247'], 'OM3 + OM4');
  assert.deepEqual(codes(campus({ cordFibre: 'om3', fibre: 'os2' })).sort(), ['J1242'], 'monomode + multimode');
  // Marge faible sur un bilan de puissance (1000BASE-LX/LH monomode, 10,5 dB) : avertissement.
  const lh = codes(campus({ modA: '1000BASE-LX', len: 8000, splices: 10 })); assert.deepEqual(lh, ['J1246'], '3,2 + 1,5 + 3 = 7,7 : marge 2,8 dB');
});

test('vérificateur : fibre sur un port RJ45, module optique sur câble cuivre, cuivre en SFP trop long', () => {
  const d = campus(); d.cables[2].b = ['sw2', 'p1'];
  assert.deepEqual(codes(d), ['J1243']);
  const cu = { devices: [dev('a', 'sw', { x1: '10GBASE-SR' }), dev('b', 'sw', { x1: '10GBASE-SR' })], cables: [{ id: 'c', a: ['a', 'x1'], b: ['b', 'x1'], len: 5, cat: 'cat6a' }] };
  assert.deepEqual(codes(cu), ['J1243']);
  const t = { devices: [dev('a', 'sw', { x1: '10GBASE-T' }), dev('b', 'sw', { x1: '10GBASE-T' })], cables: [{ id: 'c', a: ['a', 'x1'], b: ['b', 'x1'], len: 50, cat: 'cat6a' }] };
  assert.deepEqual(codes(t), ['J1241']);
  t.cables[0].len = 20; assert.deepEqual(codes(t), []);
  const plain = { devices: [dev('a', 'sw'), dev('b', 'sw')], cables: [{ id: 'c', a: ['a', 'p1'], b: ['b', 'p1'], len: 5, cat: 'cat6' }] };
  assert.equal(fibreLinks(plain, null, ports).length, 0, 'liaison cuivre ordinaire : ignorée');
  const empty = { devices: [dev('a', 'sw'), dev('b', 'sw')], cables: [{ id: 'c', a: ['a', 'x1'], b: ['b', 'p1'], len: 5, cat: 'cat6' }] };
  assert.deepEqual(codes(empty), ['J1245'], 'cage vide câblée en cuivre');
});

test('vérificateur : lit le lien de la simulation quand elle le donne', () => {
  const lan = { port: () => ({ up: false, fibre: { up: false, why: 'budget', loss: 9, budget: 6.2, reach: 10000 } }), channel: () => null };
  assert.deepEqual(issues(campus(), lan, H, ports).map(i => i.code), ['J1240']);
  assert.ok(issues(campus(), lan, H, ports)[0].text.includes('SW1'), 'nomme les équipements');
  assert.equal(issues(campus(), lan, H, ports)[0].id, 'k1', 'révèle un câble');
});

test('vérificateur : rapide sur un grand plan (600 liaisons fibre)', () => {
  const devices = [], cables = [];
  for (let i = 0; i < 600; i++) {
    devices.push(dev('a' + i, 'sw', { x1: '10GBASE-SR' }), dev('p' + i, 'fp'), dev('b' + i, 'sw', { x1: '10GBASE-SR' }));
    cables.push({ id: 'c' + i, a: ['a' + i, 'x1'], b: ['p' + i, 'f1'], len: 3, media: 'fibre', fibre: 'om4', splices: 0 }, { id: 'd' + i, a: ['p' + i, 'b1'], b: ['b' + i, 'x1'], len: 120, media: 'fibre', fibre: 'om4', splices: 0 });
  }
  const r = once(() => issues({ devices, cables }, null, H, ports)); // premier calcul : rien en cache
  assert.equal(r.value.length, 0); assert.ok(r.ms < 50, note('fibre, 600 liaisons, premier calcul', r.ms, 50));
});

/** Campus réel (devices.js, lan.js) : n liaisons CORE.xk ou SWk.x1 — panneau — dorsale — panneau — SWk.x1 en fibre. */
function realCampus(n) {
  const devices = [], cables = [];
  for (let i = 0; i < n; i++) {
    devices.push({ id: 'a' + i, type: 'switch24', name: 'A' + i, p: { sfp: { x1: '10GBASE-LR' } } }, { id: 'pa' + i, type: 'fibrepanel', name: 'PA' + i },
      { id: 'pb' + i, type: 'fibrepanel', name: 'PB' + i }, { id: 'b' + i, type: 'switch24', name: 'B' + i, p: { sfp: { x1: '10GBASE-LR' } } });
    cables.push({ id: 'k' + i, a: ['a' + i, 'x1'], b: ['pa' + i, 'f1'], len: 3, media: 'fibre', fibre: 'os2' },
      { id: 'bb' + i, a: ['pa' + i, 'b1'], b: ['pb' + i, 'b1'], len: 1200, media: 'fibre', fibre: 'os2', splices: 2 },
      { id: 'm' + i, a: ['pb' + i, 'f1'], b: ['b' + i, 'x1'], len: 3, media: 'fibre', fibre: 'os2' });
  }
  return cleanNet({ devices, cables });
}
const REAL = !!(DEVICES.switch24 && DEVICES.fibrepanel);
test('vérificateur avec la simulation : 600 liaisons fibre, régime établi en quelques millisecondes', { skip: !REAL && 'équipements fibre absents' }, async () => {
  const { createLan } = await import('./lan.js');
  const data = realCampus(600), lan = createLan({ data: () => data }), h = { name: id => id };
  lan.refresh();
  assert.equal(fibreLinks(data, lan).length, 600);
  issues(data, lan, h); // premier passage : tout se calcule
  // Meilleur de 15 passages, chacun après un recalcul du réseau (hors mesure).
  const t = best(() => issues(data, lan, h), 15, 0, () => { lan.refresh(); lan.state(); });
  console.log(`    fibre : 600 liaisons, vérificateur en régime établi ${t.toFixed(2)} ms CPU`);
  assert.ok(t < 2, note('fibre, 600 liaisons, régime établi', t, 2));
  // Le même résultat avec et sans la simulation.
  assert.deepEqual(issues(data, lan, h), issues(data, null, h));
});
test('vérificateur : le cache suit chaque changement (module, câble, nom, atténuateur)', { skip: !REAL && 'équipements fibre absents' }, async () => {
  const { createLan } = await import('./lan.js');
  const data = realCampus(3), lan = createLan({ data: () => data }), h = { name: id => (data.devices.find(d => d.id === id) || {}).name || id };
  const run = () => { lan.refresh(); return issues(data, lan, h).map(i => i.code + ':' + i.id); };
  assert.deepEqual(run(), []);
  data.devices[0].p.sfp.x1 = '10GBASE-SR'; assert.deepEqual(run(), ['J1244:k0'], 'module changé');
  data.devices[0].p.sfp.x1 = '10GBASE-LR'; assert.deepEqual(run(), []);
  data.cables[1].fibre = 'om3'; assert.deepEqual(run().map(x => x.split(':')[0]), ['J1242'], 'fibre changée');
  data.cables[1].fibre = 'os2'; data.cables[1].len = 9000; data.cables[1].splices = 6; assert.deepEqual(run(), ['J1240:k0'], 'longueur et épissures');
  data.cables[1].len = 1200; data.cables[1].splices = 2; assert.deepEqual(run(), []);
  data.devices[0].p.sfp.x1 = '10GBASE-ER'; data.devices[3].p.sfp.x1 = '10GBASE-ER'; assert.deepEqual(run(), ['J1249:k0'], 'ER saturé');
  data.cables[1].attn = 5; assert.deepEqual(run(), [], 'atténuateur');
  data.devices[0].p.sfp.x1 = '10GBASE-SR'; lan.refresh(); const a = issues(data, lan, h)[0].text;
  data.devices[0].name = 'RENOMME'; lan.refresh(); assert.ok(issues(data, lan, h)[0].text.includes('RENOMME') && !a.includes('RENOMME'), 'nom changé');
  data.cables.splice(0, 3); assert.deepEqual(run(), [], 'liaison retirée');
});

/* ---------- Contrôle de TP ---------- */
test('contrôle net-fibre (avec les vrais équipements, quand devices.js les a)', { skip: !(DEVICES.l3switch && DEVICES.fibrepanel && DEVICES.switch24) && 'switch24 / l3switch / fibrepanel pas encore dans devices.js' }, () => {
  const mk = mod => cleanNet({
    devices: [{ id: 'c', type: 'l3switch', name: 'CORE', p: { sfp: { x1: mod } } }, { id: 'p1', type: 'fibrepanel', name: 'FP1' }, { id: 'p2', type: 'fibrepanel', name: 'FP2' }, { id: 's', type: 'switch24', name: 'SWB', p: { sfp: { x1: '10GBASE-LR' } } }],
    cables: [
      { id: 'k1', a: ['c', 'x1'], b: ['p1', 'f1'], len: 3, media: 'fibre', fibre: 'os2' },
      { id: 'bb', a: ['p1', 'b1'], b: ['p2', 'b1'], len: 1200, media: 'fibre', fibre: 'os2', splices: 2 },
      { id: 'k2', a: ['p2', 'f1'], b: ['s', 'x1'], len: 3, media: 'fibre', fibre: 'os2' }
    ]
  });
  const ok = LAB['net-fibre'].check({ type: 'net-fibre', speed: 10000 }, { netData: () => mk('10GBASE-LR') });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const ko = LAB['net-fibre'].check({ type: 'net-fibre' }, { netData: () => mk('10GBASE-SR') });
  assert.equal(ko.ok, false); assert.ok(LAB['net-fibre'].text({ type: 'net-fibre' }, ko).length > 5);
});
test('contrôle net-fibre : aucun lien → message', () => {
  const r = LAB['net-fibre'].check({ type: 'net-fibre' }, { netData: () => ({ devices: [], cables: [] }) });
  assert.equal(r.ok, false); assert.equal(r.why, 'none'); assert.ok(LAB['net-fibre'].text({ type: 'net-fibre' }, r));
});
