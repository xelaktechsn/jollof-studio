// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Atelier de sertissage (crimp.js) dans un DOM jsdom : le verdict (« Conforme à T568B », broches fausses) ne paraît que
// si la carte des normes est montrée. Mode examen (showStandard: false) ou carte repliée : texte neutre, sans verdict.
// Testeur (tester.js) en mode examen : voyants et carte de câblage bruts, ni verdict ni nom de défaut.
// node --test src/net/ui/crimp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

// Les feuilles de style importées par les modules de l'interface : modules vides pour Node.
register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, ctx, next) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return next(url, ctx);
}`));

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
const g = globalThis;
for (const k of ['window', 'document', 'getComputedStyle', 'HTMLElement', 'Element', 'Node', 'DOMParser']) if (!(k in g)) g[k] = k === 'window' ? dom.window : dom.window[k];
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); // mouvement réduit : sertissage en 200 ms
g.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } };
const { openCrimp } = await import('./crimp.js');
const { T568A, T568B } = await import('../cable.js');

const host = () => { const h = document.getElementById('host'); h.innerHTML = ''; return h; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Ouvre l'atelier avec une fiche déjà garnie, sertit, rend le texte du verdict et l'atelier. */
async function crimped(order, opts) {
  const h = host(), ui = openCrimp({ host: h, end: { order, crimped: false, shorts: [] }, ...opts });
  h.querySelector('[data-act="crimp"]').click();
  await sleep(250);
  const v = h.querySelector('.nt-verdict');
  return { h, ui, v, text: () => v.textContent.trim(), cls: () => v.className };
}

test('carte des normes montrée : verdict complet (conforme, broches fausses)', async () => {
  let r = await crimped(T568B.slice());
  assert.match(r.text(), /Conforme à T568B/); assert.match(r.cls(), /nt-ok/);
  assert.equal(r.h.querySelector('.nt-ref').hidden, false);
  r.ui.close();
  const wrong = T568B.slice(); [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
  r = await crimped(wrong);
  assert.match(r.text(), /Ordre non normalisé : 2 broches différentes de T568B/);
  assert.match(r.text(), /Broche 1 : orange \(T568B attend blanc-orange\)/);
  r.ui.close();
});

test('mode examen (showStandard: false) : ni carte ni verdict, même pour une fiche fausse', async () => {
  for (const order of [T568A.slice(), [...T568B.slice(0, 7), null]]) {
    const r = await crimped(order, { showStandard: false });
    assert.equal(r.h.querySelector('.nt-ref'), null, 'pas de carte des normes');
    assert.equal(r.h.querySelector('[data-act="ref"]'), null, 'pas de bouton pour la montrer');
    assert.equal(r.text(), 'Fiche sertie : pas de verdict en mode examen.');
    assert.doesNotMatch(r.cls(), /nt-ok|nt-bad/);
    assert.doesNotMatch(r.h.querySelector('.nt-side').textContent, /T568|Conforme|non normalisé|Ouvert/);
    r.ui.close();
  }
});

test('carte repliée par l’élève : verdict caché ; dépliée : il revient', async () => {
  const wrong = T568A.slice(); [wrong[2], wrong[5]] = [wrong[5], wrong[2]];
  const r = await crimped(wrong);
  assert.match(r.text(), /non normalisé/);
  r.h.querySelector('[data-act="ref"]').click();
  assert.equal(r.h.querySelector('.nt-ref').hidden, true);
  assert.equal(r.text(), 'Fiche sertie : affichez les normes pour voir le verdict.');
  assert.doesNotMatch(r.cls(), /nt-bad/);
  r.h.querySelector('[data-act="ref"]').click();
  assert.match(r.text(), /Ordre non normalisé/);
  // Résultat rendu à « Terminé » : la fiche telle quelle, sertie.
  let got = null; r.ui.close();
  const h = host(), ui = openCrimp({ host: h, end: { order: wrong, crimped: true }, showStandard: false, onDone: e => { got = e; } });
  assert.equal(h.querySelector('.nt-verdict').textContent.trim(), 'Fiche sertie : pas de verdict en mode examen.');
  h.querySelector('[data-act="done"]').click();
  assert.deepEqual(got, { order: wrong, crimped: true, shorts: [] });
  void ui;
});

/* ---------- Testeur en mode examen ---------- */
const { openTester } = await import('./tester.js');
const { makeCable } = await import('../cable.js');

test('testeur, mode examen : ni « Test réussi / échoué » ni défaut nommé ; voyants et carte de câblage restent', () => {
  const bad = makeCable('straight'); bad.cut = ['o']; // conducteur 2 coupé : « Ouvert : broche 2 » hors examen
  let h = host(), t = openTester({ host: h, segments: [bad], names: { a: 'PC1', b: 'SW1' }, mode: 'qualification' });
  assert.match(h.querySelector('.nt-res').textContent, /Test échoué[\s\S]*Ouvert : broche 2/);
  assert.ok(h.querySelector('.nt-map .nt-mbad'), 'hors examen : broche en faute marquée');
  t.close();
  h = host(); t = openTester({ host: h, segments: [bad], names: { a: 'PC1', b: 'SW1' }, mode: 'qualification', exam: true });
  const res = h.querySelector('.nt-res').textContent;
  assert.equal(res.trim(), 'Mode examen : pas de verdict. Lisez les voyants et la carte de câblage, puis concluez.');
  assert.doesNotMatch(h.querySelector('.nt-tbody').textContent, /réussi|échoué|Ouvert :|T568|paire séparée/);
  assert.ok(h.querySelector('.nt-devwrap svg'), 'les boîtiers et leurs voyants');
  assert.ok(h.querySelector('.nt-map svg'), 'la carte de câblage');
  assert.equal(h.querySelector('.nt-map .nt-mbad'), null, 'sans broche signalée en faute');
  assert.match(h.querySelector('.nt-step').textContent, /Le maître envoie sur la broche 1/, 'lecture pas à pas des voyants');
  // Paire séparée : ni accolade rouge ni légende en examen.
  const split = makeCable('straight'); for (const e of [split.a, split.b]) [e.order[2], e.order[3]] = [e.order[3], e.order[2]];
  t.update([split]);
  assert.equal(h.querySelector('.nt-msplit'), null);
  t.close();
});

test('miniature du câble (inspecteur), mode examen : « sertie » au lieu de la norme, conducteur coupé non montré', async () => {
  const { cableSvg } = await import('./crimp.js');
  const w = makeCable('straight'); w.cut = ['br'];
  assert.match(cableSvg(w), /coupés : marron[\s\S]*A · T568B/);
  const ex = cableSvg(w, true);
  assert.match(ex, /A · sertie<\/text>[\s\S]*B · sertie<\/text>/);
  assert.doesNotMatch(ex, /T568|coupés|nt-th-cut/);
});
