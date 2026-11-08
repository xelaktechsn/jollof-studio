// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Éditeur de composant : prolonge l'assistant d'import (« Ce modèle est… un composant à décrire ») pour créer ou
// modifier un paquet .jpart sans écrire de code. Les broches se posent sur le modèle 3D importé ou sur une
// plaquette générique (ou en rangée au pas de 2,54 mm) ; chaque broche reçoit sa nature, ce qu'elle attend et sa
// plage de tension ; une fiche « Détails » réunit consommation, limites et leurs sources, documentation et
// comportement déclaratif. Le composant s'enregistre dans la bibliothèque personnelle, s'exporte et s'importe
// (.jpart), et les pièces Fritzing (.fzpz) et symboles KiCad (.kicad_sym) deviennent des brouillons à compléter.
import * as THREE from 'three';
import * as J from './jpart.js';
import * as P from './packages.js';
import { roleOf, pinFromRole } from '../import/fritzing.js';
import { sanitizeSvg } from '../import/xml.js';
import { QUANT } from '../sim/models.js';
import { tl } from '../i18n/index.js';

let A = null; // interface de l'application (main.js)
const PART_KEYS = ['id', 'version', 'category', 'prefix', 'description', 'author', 'license', 'ma', 'ds', 'limits', 'sources', 'docs', 'behaviour', 'look'];
const KIND_LABEL = () => ({ pwr: tl('Alimentation'), gnd: tl('Masse'), io: tl('Signal (GPIO)'), nc: tl('Libre'), passive: tl('Patte passive'), drv: tl('Borne de moteur'), contact: tl('Contact de puissance') });
const NEED_LABEL = () => ({ io: tl('Données (entrée/sortie)'), in: tl('Sortie du module → carte'), out: tl('Commande carte → module'), pullup: tl('Entrée avec tirage (INPUT_PULLUP)'), pwm: tl('Commande PWM'), adc: tl('Sortie analogique'), sda: 'I2C SDA', scl: 'I2C SCL', sck: 'SPI SCK', mosi: 'SPI MOSI', miso: 'SPI MISO', ss: 'SPI CS', rx: tl('Série RX du module'), tx: tl('Série TX du module') });
const LOOK_LABEL = () => ({ module: tl('Plaquette (module)'), block: tl('Bloc'), led: 'LED', resistor: tl('Résistance'), svg: tl('Dessin SVG sur plaquette'), glb: tl('Modèle 3D importé') });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const opts = (map, cur) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${String(cur ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) || 'composant';

/* ---------- Brouillon (composant importé de nature « part ») ↔ manifeste ---------- */
/** Nature proposée d'une broche d'après son nom (ou son rôle de module, si le modèle était décrit comme module). */
function defaults(q) {
  if (q.role && /^(pwr|pwr33|pwr5|gnd|nc|io|in|out|pwm|adc|sda|scl|sck|mosi|miso|ss|tx|rx)$/.test(q.role)) return pinFromRole(q.role);
  return pinFromRole(roleOf(q.name));
}
/** Broche du brouillon → broche du manifeste (nature par défaut si elle n'a pas encore été choisie). */
function pinOut(q) {
  const dft = defaults(q), kind = q.kind || dft.kind, o = { name: q.name, x: +(+q.x).toFixed(3), y: +(+q.y).toFixed(3), z: +(+q.z).toFixed(3), kind };
  if (kind === 'io') o.need = q.need || dft.need || 'io';
  if (kind === 'pwr') o.v = q.v || 'logic';
  if (q.label) o.role = q.label;
  if (q.why) o.why = q.why;
  if (kind === 'pwr' && Array.isArray(o.v) && q.ds) o.ds = q.ds;
  if ((kind === 'io' || kind === 'gnd') && q.via) o.via = q.via;
  if (kind === 'io') { for (const k of ['opt', 'lv5', 'lv3']) if (q[k]) o[k] = true; if (q.idle === 0 || q.idle === 1) o.idle = q.idle; if (q.pull) o.pull = q.pull; }
  return o;
}
const prune = o => { for (const k of Object.keys(o)) if (o[k] == null || o[k] === '' || (typeof o[k] === 'object' && !Array.isArray(o[k]) && !Object.keys(prune(o[k])).length)) delete o[k]; return o; };
/** Manifeste d'un brouillon (d = c.custom). L'identifiant est donné au premier enregistrement, puis gardé. */
export function manifestOf(d) {
  const p = JSON.parse(JSON.stringify(Object.fromEntries(PART_KEYS.filter(k => d.part && d.part[k] != null).map(k => [k, d.part[k]]))));
  const m = { format: J.FORMAT, ...p, name: d.name, id: p.id || `pk-${slug(d.name)}-${Date.now().toString(36).slice(-5)}`, pins: (d.pins || []).map(pinOut) };
  m.category = m.category || J.PKG_CATEGORIES[0]; m.prefix = m.prefix || 'U';
  for (const k of ['limits', 'behaviour', 'docs', 'sources']) if (m[k]) prune(m[k]);
  if (m.behaviour) { if (m.behaviour.analogOut && !m.behaviour.analogOut.length) delete m.behaviour.analogOut; if (m.behaviour.digitalOut && !m.behaviour.digitalOut.length) delete m.behaviour.digitalOut; }
  if (!m.look || !m.look.kind) m.look = { kind: d.glb ? 'glb' : d.part && d.part.svg ? 'svg' : 'module' };
  if (d.glb) m.look = { kind: 'glb' };
  return m;
}
/** Fiche de câblage du brouillon, pour l'inspection et le vérificateur pendant l'édition. */
export function specOf(d) {
  const m = manifestOf(d), v = J.validateManifest(m);
  if (v.ok) return J.specOf(v.manifest);
  // Brouillon incomplet (source manquante…) : la fiche suit quand même les broches, textes nettoyés.
  return J.specOf({ ...m, description: J.cleanStr(m.description || m.name, 400), pins: m.pins.map(q => ({ ...q, role: q.role && J.cleanStr(q.role, 40), why: q.why && J.cleanStr(q.why, 400), ds: undefined })), ma: undefined });
}
/** Erreurs du brouillon (manifeste et symbole), [] s'il est prêt à être enregistré. */
function problems(d) {
  const m = manifestOf(d), v = J.validateManifest(m), out = v.ok ? [] : v.errors;
  if (d.part && d.part.symbol) { const s = J.validateSymbol(d.part.symbol, m.pins.map(q => q.name)); if (!s.ok) out.push(...s.errors); }
  if (!(d.pins || []).length) out.unshift(tl('Posez au moins une broche.'));
  return out;
}
/** Modèle 3D d'un brouillon sans modèle importé : plaquette, bloc, LED, résistance ou dessin SVG. */
export function blockModel(data) {
  const p = data.part || {};
  let svg = null;
  try { svg = p.svg ? sanitizeSvg(String(p.svg)) : null; } catch (e) { svg = null; } // brouillon reçu avec un projet : dessin nettoyé
  return P.lookModel({ prefix: p.prefix, look: p.look, behaviour: p.behaviour, pins: (data.pins || []).map(pinOut) }, svg);
}
/** Brouillon (données d'un composant importé) d'un paquet : pour le modifier, ou après un import Fritzing / KiCad. */
function draftOf(m, extra = {}) {
  const part = Object.fromEntries(PART_KEYS.filter(k => m[k] != null && k !== 'name').map(k => [k, JSON.parse(JSON.stringify(m[k]))]));
  if (extra.svg) part.svg = extra.svg;
  if (extra.symbol) part.symbol = extra.symbol;
  const pins = m.pins.map(q => { const { role, ...r } = q; return { ...r, ...(role ? { label: role } : {}) }; });
  return { v: 2, name: m.name, kind: 'part', part, pins, ...(extra.glb ? { glb: J.toB64(extra.glb) } : {}) };
}

/* ---------- Bibliothèque personnelle et projets ---------- */
/** Installe les paquets de la bibliothèque personnelle ; rend les autres éléments (modèles importés). */
export async function loadLibrary(items) {
  const rest = [];
  for (const it of items || []) {
    if (it && it.kind === 'package' && typeof it.jpart === 'string') {
      try { await P.installBytes(J.fromB64(it.jpart), { saved: true }); } catch (e) { console.warn(tl('Composant ignoré'), it.id, e); }
    } else rest.push(it);
  }
  return rest;
}
export const embed = comps => P.embedFor(comps);
/** Paquets enregistrés dans un projet ouvert (avant ses composants). */
export async function restoreEmbedded(list) {
  const r = await P.installEmbedded(list);
  if (A && (r.added.length || r.errors.length)) {
    A.renderLibrary();
    if (r.errors.length) A.status(tl('Composant en paquet ignoré : {0}', r.errors[0]), 'warn');
  }
  return r;
}
async function saveToLibrary(type) {
  const p = P.packageOf(type); if (!p) return;
  await A.native.librarySave({ id: type, kind: 'package', name: p.manifest.name, jpart: J.toB64(p.bytes) });
  P.markSaved(type);
}

/* ---------- Assistant (main.js renderWizard) ---------- */
/** Prolonge l'assistant d'un composant importé : rien à faire si sa nature n'est pas « part ». */
export function wizard(c) {
  const d = c && c.custom, box = A && A.$('#partEd');
  if (!box) return;
  if (!d || d.kind !== 'part') { box.hidden = true; resetSaveLabel(c); return; }
  d.part = d.part || { category: J.PKG_CATEGORIES[0], prefix: 'U', look: { kind: d.glb ? 'glb' : 'module' } };
  A.$('#pinHint').textContent = tl('Cliquez sur le modèle à l’endroit de chaque broche (ou ajoutez une rangée au pas de 2,54 mm), puis choisissez sa nature. La fiche « Détails » complète le composant.');
  const K = KIND_LABEL(), N = NEED_LABEL();
  A.$('#cPins').innerHTML = (d.pins || []).map((q, i) => {
    const o = pinOut(q);
    return `<li class="pk"><input value="${esc(q.name)}" data-i="${i}" aria-label="${esc(tl('Nom de la broche'))}"><select data-pk="${i}" aria-label="${esc(tl('Nature de {0}', q.name))}">${opts(K, o.kind)}</select>${o.kind === 'io' ? `<select data-pn="${i}" aria-label="${esc(tl('Ce qu’attend {0}', q.name))}">${opts(N, o.need)}</select>` : ''}<button type="button" data-del="${i}" aria-label="${esc(tl('Retirer la broche {0}', q.name))}">${A.icon('x')}</button></li>`;
  }).join('') || `<li class="note">${tl('Aucune broche posée.')}</li>`;
  const errs = problems(d);
  box.hidden = false;
  box.innerHTML = `<div class="row"><input id="peRow" class="peRow" placeholder="${esc(tl('VCC, GND, OUT…'))}" aria-label="${esc(tl('Noms des broches de la rangée'))}"><button type="button" class="btn small" data-pe="row">${A.icon('plus')}<span>${tl('Rangée')}</span></button></div>
    <div class="wstep"><span class="wn">3</span><b>${tl('Décrire')}</b></div>
    <button type="button" class="btn wide" data-pe="details">${A.icon('edit')}<span>${tl('Détails du composant…')}</span></button>
    ${errs.length ? `<ul class="peErr">${errs.slice(0, 3).map(e => `<li>${esc(e)}</li>`).join('')}${errs.length > 3 ? `<li>${esc(tl('… et {0} autre(s) point(s), voir les détails', errs.length - 3))}</li>` : ''}</ul>` : `<p class="note ok">${tl('Prêt : le composant peut être enregistré.')}</p>`}
    <button type="button" class="btn wide" data-pe="export">${A.icon('upload')}<span>${tl('Exporter (.jpart)')}</span></button>`;
  A.$('#saveLibBtn').disabled = !d.pins.length;
  A.$('#saveLibBtn').querySelector('span').textContent = tl('Enregistrer dans ma bibliothèque');
}
/** Remet le libellé d'origine du bouton d'ajout (assistant d'un modèle qui n'est pas un composant à décrire). */
function resetSaveLabel(c) {
  const b = A && A.$('#saveLibBtn'); if (!b) return;
  if (!c || !c.custom || c.custom.kind !== 'part') b.querySelector('span').textContent = tl('Ajouter à ma bibliothèque');
}
/** Après une modification du brouillon : fiche de câblage, explications, historique, assistant. */
function touched(c, rebuild = false) {
  if (rebuild) return A.rebuildCustom(c).then(n => { wizard(n); return n; });
  c.spec = specOf(c.custom);
  A.renderExplain(); A.changed(); wizard(c);
  return Promise.resolve(c);
}
/** Ajoute une rangée de broches au pas de 2,54 mm sur le bord avant du modèle (au-dessus pour une plaquette). */
function addRow(c, names) {
  const d = c.custom, list = names.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 40);
  if (!list.length) { A.status(tl('Écrivez les noms des broches, séparés par des virgules.'), 'warn'); return; }
  const used = new Set(d.pins.map(q => q.name)), clean = list.map(n => { let k = n.replace(/[^A-Za-z0-9+\-_./~]/g, '').slice(0, 16) || 'P'; let i = 2; while (used.has(k)) k = `${k.slice(0, 13)}${i++}`; used.add(k); return k; });
  c.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c.model).applyMatrix4(c.group.matrixWorld.clone().invert());
  const look = (d.part && d.part.look) || {}, board = !d.glb && (look.kind || 'module') === 'module';
  if (!d.glb && (look.kind === 'module' || look.kind === 'block' || !look.kind) && look.size) { delete look.size; } // la plaquette suit ses broches
  const y = board ? 8.1 : +(box.max.y).toFixed(3), cx = (box.min.x + box.max.x) / 2;
  let z = +(box.max.z - 2.2).toFixed(3);
  while (d.pins.some(q => Math.abs(q.z - z) < 1)) z = +(z - 2.54).toFixed(3);
  clean.forEach((name, i) => { const q = { name, x: +(cx + (i - (clean.length - 1) / 2) * 2.54).toFixed(3), y, z }; Object.assign(q, defaults(q)); d.pins.push(q); });
  touched(c, true);
  A.status(tl('{0} broche(s) ajoutée(s) : choisissez leur nature.', clean.length), 'ok');
}

/* ---------- Fiche « Détails du composant » ---------- */
let sheet = null, cur = null;
function getPath(o, path) { return path.split('.').reduce((x, k) => (x == null ? x : x[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.'); let x = o;
  for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (x[k] == null || typeof x[k] !== 'object') x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; x = x[k]; }
  const last = ks[ks.length - 1];
  if (v === undefined) { if (Array.isArray(x)) x[last] = undefined; else delete x[last]; } else x[last] = v;
}
const field = (label, html, wide = false) => `<label class="field${wide ? ' wide' : ''}"><span class="fh">${esc(label)}</span>${html}</label>`;
const inp = (f, v, t = 'str', extra = '') => `<input data-f="${f}" data-t="${t}" value="${esc(v ?? '')}"${t === 'num' ? ' inputmode="decimal"' : ''} ${extra}>`;
const area = (f, v, t = 'str', rows = 3) => `<textarea data-f="${f}" data-t="${t}" rows="${rows}">${esc(v ?? '')}</textarea>`;
const sel = (f, map, v, t = 'str') => `<select data-f="${f}" data-t="${t}">${opts(map, v)}</select>`;
const chk = (f, v, label) => `<label class="pchk"><input type="checkbox" data-f="${f}" data-t="bool"${v ? ' checked' : ''}><span>${esc(label)}</span></label>`;

function renderSheet() {
  const c = cur, d = c && c.custom; if (!d || !sheet) return;
  const p = d.part, m = manifestOf(d), pins = m.pins.map(q => q.name), none = { '': '—' };
  const pinMap = { ...none, ...Object.fromEntries(pins.map(n => [n, n])) };
  const srcMap = { ...none, ...Object.fromEntries(Object.keys(p.sources || {}).map(k => [k, `${k} · ${(p.sources[k].title || '').slice(0, 40)}`])) };
  const cats = Object.fromEntries(J.PKG_CATEGORIES.map(k => [k, tl(k)]));
  const looks = Object.fromEntries(Object.entries(LOOK_LABEL()).filter(([k]) => (k === 'glb' ? !!d.glb : k === 'svg' ? !!p.svg : !d.glb)));
  const qs = Object.fromEntries(Object.entries(QUANT).filter(([, q]) => !q.bool).map(([k, q]) => [k, q.label])), qAll = Object.fromEntries(Object.entries(QUANT).map(([k, q]) => [k, q.label]));
  const res = { ...none, ...Object.fromEntries(J.RESISTORS.map(r => [r, r.replace('res-', '') + ' Ω'])) };
  const B = p.behaviour || {}, bk = B.led ? 'led' : B.load ? 'load' : '';
  const K = KIND_LABEL(), N = NEED_LABEL();
  const pinRows = m.pins.map((q, i) => {
    const src = d.pins[i] || {}, f = k => `pins.${i}.${k}`, range = Array.isArray(q.v);
    return `<tr><th>${esc(q.name)}</th><td>${sel(f('kind'), K, q.kind)}</td><td>${q.kind === 'io' ? sel(f('need'), N, q.need) : ''}</td>
      <td>${q.kind === 'pwr' ? `${sel(f('v'), { logic: tl('logique de la carte'), range: tl('plage (V)') }, range ? 'range' : 'logic', 'vmode')}${range ? `<span class="pv">${inp(f('v.0'), q.v[0], 'num', 'aria-label="min"')}–${inp(f('v.1'), q.v[1], 'num', 'aria-label="max"')}</span>${sel(f('ds'), srcMap, src.ds)}` : ''}` : ''}</td>
      <td>${q.kind === 'io' || q.kind === 'gnd' ? sel(f('via'), res, src.via) : ''}</td>
      <td>${q.kind === 'io' ? `${chk(f('opt'), src.opt, tl('facultative'))}${chk(f('lv5'), src.lv5, tl('sort du 5 V'))}${chk(f('lv3'), src.lv3, tl('logique 3,3 V'))}` : ''}</td>
      <td>${inp(f('label'), src.label, 'str', `placeholder="${esc(tl('Rôle'))}"`)}${inp(f('why'), src.why, 'str', `placeholder="${esc(tl('Pourquoi (affiché à l’élève)'))}"`)}</td></tr>`;
  }).join('');
  const srcRows = Object.entries(p.sources || {}).map(([k, s]) => `<div class="psrc"><b>${esc(k)}</b>${inp(`part.sources.${k}.title`, s.title, 'str', `placeholder="${esc(tl('Titre du document'))}"`)}${inp(`part.sources.${k}.publisher`, s.publisher, 'str', `placeholder="${esc(tl('Éditeur'))}"`)}${inp(`part.sources.${k}.url`, s.url, 'str', 'placeholder="https://…"')}${inp(`part.sources.${k}.section`, s.section, 'str', `placeholder="${esc(tl('Section, page, citation'))}"`)}<button type="button" class="btn small" data-act="delsrc" data-k="${esc(k)}">${A.icon('trash')}</button></div>`).join('');
  const aRows = (B.analogOut || []).map((o, i) => { const f = k => `part.behaviour.analogOut.${i}.${k}`; return `<div class="pout">${sel(f('pin'), pinMap, o.pin)}${sel(f('quantity'), qs, o.quantity)}<span>${tl('de')}</span>${inp(f('from.0'), o.from && o.from[0], 'num')}<span>${tl('à')}</span>${inp(f('from.1'), o.from && o.from[1], 'num')}<span>→</span>${inp(f('to.0'), o.to && o.to[0], 'num')}<span>${tl('à')}</span>${inp(f('to.1'), o.to && o.to[1], 'num')}${chk(f('ratio'), o.ratio, tl('fraction de l’alimentation'))}<button type="button" class="btn small" data-act="delout" data-l="analogOut" data-i="${i}">${A.icon('trash')}</button></div>`; }).join('');
  const dRows = (B.digitalOut || []).map((o, i) => { const f = k => `part.behaviour.digitalOut.${i}.${k}`; return `<div class="pout">${sel(f('pin'), pinMap, o.pin)}${sel(f('quantity'), qAll, o.quantity)}<span>${tl('seuil')}</span>${inp(f('threshold'), o.threshold, 'num')}${chk(f('activeLow'), o.activeLow, tl('active à l’état bas'))}<button type="button" class="btn small" data-act="delout" data-l="digitalOut" data-i="${i}">${A.icon('trash')}</button></div>`; }).join('');
  const docs = p.docs || {}, L = p.limits || {}, errs = problems(d);
  sheet.querySelector('[data-c="body"]').innerHTML = `
    <section><h3>${tl('Composant')}</h3><div class="pgrid">
      ${field(tl('Nom'), inp('name', d.name))}${field(tl('Catégorie'), sel('part.category', cats, p.category))}${field(tl('Préfixe des repères'), inp('part.prefix', p.prefix, 'str', 'placeholder="U"'))}
      ${field(tl('Apparence'), sel('part.look.kind', looks, (p.look && p.look.kind) || (d.glb ? 'glb' : 'module'), 'look'))}${field(tl('Couleur'), inp('part.look.color', (p.look && p.look.color) || '#1b4f8c', 'color', 'type="color"'))}${field(tl('Étiquette'), inp('part.look.label', p.look && p.look.label, 'look'))}
      ${field(tl('Description (affichée à l’élève)'), area('part.description', p.description), true)}
      ${field(tl('Auteur'), inp('part.author', p.author))}${field(tl('Licence'), inp('part.license', p.license))}</div></section>
    <section><h3>${tl('Broches')}</h3><div class="ptable"><table><thead><tr><th>${tl('Broche')}</th><th>${tl('Nature')}</th><th>${tl('Attend')}</th><th>${tl('Tension')}</th><th>${tl('En série')}</th><th>${tl('Options')}</th><th>${tl('Texte')}</th></tr></thead><tbody>${pinRows || `<tr><td colspan="7">${tl('Aucune broche posée.')}</td></tr>`}</tbody></table></div></section>
    <section><h3>${tl('Consommation et limites')}</h3><p class="note">${tl('Chaque chiffre (plage de tension, consommation, limite) cite la fiche technique d’où il vient : ajoutez-la dans « Sources ».')}</p><div class="pgrid">
      ${field(tl('Consommation (mA)'), inp('part.ma', p.ma, 'num'))}${field(tl('Source de la consommation'), sel('part.ds', srcMap, p.ds))}<span></span>
      ${field(tl('Courant d’une LED : conseillé (mA)'), inp('part.limits.current.warn', L.current && L.current.warn, 'num'))}${field(tl('maximum (mA)'), inp('part.limits.current.max', L.current && L.current.max, 'num'))}${field(tl('Source des limites'), sel('part.limits.src', srcMap, L.src))}
      ${field(tl('Puissance d’une résistance : conseillée (W)'), inp('part.limits.power.warn', L.power && L.power.warn, 'num'))}${field(tl('maximum (W)'), inp('part.limits.power.max', L.power && L.power.max, 'num'))}</div></section>
    <section><h3>${tl('Sources')}</h3>${srcRows}<button type="button" class="btn small" data-act="addsrc">${A.icon('plus')}<span>${tl('Ajouter une fiche technique')}</span></button></section>
    <section><h3>${tl('Comportement (sans code)')}</h3><div class="pgrid">
      ${field(tl('Le composant est électriquement…'), `<select data-act="bk">${opts({ '': tl('un module (selon ses broches)'), led: tl('une LED'), load: tl('une charge résistive') }, bk)}</select>`)}
      ${bk === 'led' ? `${field(tl('Anode'), sel('part.behaviour.led.anode', pinMap, B.led.anode))}${field(tl('Cathode'), sel('part.behaviour.led.cathode', pinMap, B.led.cathode))}${field(tl('Couleur'), sel('part.behaviour.led.color', { red: tl('rouge'), green: tl('verte'), blue: tl('bleue'), yellow: tl('jaune'), white: tl('blanche'), orange: tl('orange') }, B.led.color))}${field(tl('Tension de seuil (V)'), inp('part.behaviour.led.vf', B.led.vf, 'num'))}` : ''}
      ${bk === 'load' ? `${field(tl('Entre'), sel('part.behaviour.load.pin', pinMap, B.load.pin))}${field(tl('et'), sel('part.behaviour.load.to', pinMap, B.load.to))}${field(tl('Résistance (Ω)'), inp('part.behaviour.load.ohms', B.load.ohms, 'num'))}` : ''}</div>
      <h4>${tl('Sorties analogiques (capteur)')}</h4>${aRows}<button type="button" class="btn small" data-act="addout" data-l="analogOut">${A.icon('plus')}<span>${tl('Ajouter')}</span></button>
      <h4>${tl('Sorties tout-ou-rien (capteur)')}</h4>${dRows}<button type="button" class="btn small" data-act="addout" data-l="digitalOut">${A.icon('plus')}<span>${tl('Ajouter')}</span></button></section>
    <section><h3>${tl('Documentation')}</h3><div class="pgrid">
      ${field(tl('Fonctionnement'), area('part.docs.text', docs.text, 'str', 4), true)}
      ${field(tl('Caractéristiques (une par ligne : libellé : valeur)'), area('part.docs.specs', (docs.specs || []).map(r => r.join(' : ')).join('\n'), 'specs', 4), true)}
      ${field(tl('Utilisations (une par ligne)'), area('part.docs.uses', (docs.uses || []).join('\n'), 'lines'), true)}
      ${field(tl('Erreurs fréquentes (une par ligne)'), area('part.docs.mistakes', (docs.mistakes || []).join('\n'), 'lines'), true)}</div></section>`;
  sheet.querySelector('[data-c="errs"]').innerHTML = errs.length ? `<ul class="peErr">${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : `<p class="note ok">${tl('Prêt : le composant peut être enregistré.')}</p>`;
}
function readValue(el) {
  const t = el.dataset.t, raw = el.type === 'checkbox' ? el.checked : el.value;
  if (t === 'bool') return raw || undefined;
  if (t === 'num') { const s = String(raw).trim().replace(',', '.'); return s === '' ? undefined : Number.isFinite(+s) ? +s : undefined; }
  if (t === 'lines') return String(raw).split('\n').map(s => s.trim()).filter(Boolean);
  if (t === 'specs') return String(raw).split('\n').map(s => s.split(/\s*:\s*/)).filter(r => r[0] && r.length > 1).map(r => [r[0].trim(), r.slice(1).join(' : ').trim()]);
  return String(raw).trim() || undefined;
}
async function onSheetChange(e) {
  const el = e.target, c = cur, d = c && c.custom; if (!d) return;
  if (el.dataset.act === 'bk') {
    const b = d.part.behaviour = d.part.behaviour || {}; delete b.led; delete b.load;
    const names = d.pins.map(q => q.name), g = d.pins.find(q => pinOut(q).kind === 'gnd');
    if (el.value === 'led') b.led = { anode: names.find(n => /^A/i.test(n)) || names[0], cathode: names.find(n => /^K|^C/i.test(n)) || names[1], color: 'red', vf: 2 };
    if (el.value === 'load') b.load = { pin: names[0], to: (g && g.name) || names[1], ohms: 220 };
    await touched(c); renderSheet(); return;
  }
  const f = el.dataset.f; if (!f) return;
  let v = readValue(el);
  if (el.dataset.t === 'vmode') { v = v === 'range' ? [3, 5.5] : 'logic'; }
  if (f === 'name') { if (!v) { renderSheet(); return; } d.name = J.cleanStr(v, 60); }
  else setPath(d, f, v);
  if (f.startsWith('pins.') && /\.kind$/.test(f)) { const q = d.pins[+f.split('.')[1]]; if (q.kind !== 'io') delete q.need; if (q.kind !== 'pwr') { delete q.v; delete q.ds; } }
  const structural = /\.kind$|\.v$|vmode|look|^part\.behaviour\.(analog|digital)Out\.\d+\.quantity/.test(f) || el.dataset.t === 'vmode' || el.dataset.t === 'look';
  if (/^part\.look\./.test(f) || el.dataset.t === 'look') { cur = await touched(c, true); renderSheet(); return; }
  await touched(c);
  if (structural) renderSheet(); else sheet.querySelector('[data-c="errs"]').innerHTML = problems(d).length ? `<ul class="peErr">${problems(d).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="note ok">${tl('Prêt : le composant peut être enregistré.')}</p>`;
}
async function onSheetClick(e) {
  const b = e.target.closest('[data-act]'), c = cur, d = c && c.custom; if (!b || !d || b.tagName === 'SELECT') return;
  const B = d.part.behaviour = d.part.behaviour || {};
  if (b.dataset.act === 'addsrc') { d.part.sources = d.part.sources || {}; let i = 1; while (d.part.sources['s' + i]) i++; d.part.sources['s' + i] = { title: '', publisher: '', url: 'https://', section: '' }; if (!d.part.limits || !d.part.limits.src) setPath(d, 'part.limits.src', 's' + i); }
  if (b.dataset.act === 'delsrc') delete d.part.sources[b.dataset.k];
  if (b.dataset.act === 'addout') {
    const io = d.pins.map(pinOut).filter(q => q.kind === 'io'), l = b.dataset.l;
    const pin = (io.find(q => (l === 'analogOut' ? q.need === 'adc' : q.need === 'in')) || io[0] || d.pins[0] || {}).name;
    (B[l] = B[l] || []).push(l === 'analogOut' ? { pin, quantity: 'lux', from: [0, 2000], to: [0.9, 0.1], ratio: true } : { pin, quantity: 'lux', threshold: 100, activeLow: false });
  }
  if (b.dataset.act === 'delout') B[b.dataset.l].splice(+b.dataset.i, 1);
  await touched(c); renderSheet();
}
function openSheet(c) {
  cur = c;
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'modal'; sheet.id = 'partModal'; sheet.hidden = true;
    sheet.innerHTML = `<div class="sheet partSheet" role="dialog" aria-modal="true" aria-labelledby="partTitle">
      <div class="sheetHead"><h2 id="partTitle">${A.icon('edit')}${tl('Détails du composant')}</h2><span class="row"><button type="button" class="btn small" data-c="export">${A.icon('upload')}<span>${tl('Exporter (.jpart)')}</span></button><button type="button" class="btn small primary" data-c="save">${A.icon('save')}<span>${tl('Enregistrer')}</span></button><button type="button" class="btn small" data-c="close">${tl('Fermer')}</button></span></div>
      <div class="partBody" data-c="body"></div><div data-c="errs"></div></div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('change', e => { onSheetChange(e).catch(err => A.status(String(err.message || err), 'err')); });
    sheet.addEventListener('click', e => {
      if (e.target === sheet || e.target.closest('[data-c="close"]')) { sheet.hidden = true; return; }
      if (e.target.closest('[data-c="save"]')) { sheet.hidden = true; save(cur); return; }
      if (e.target.closest('[data-c="export"]')) { exportDraft(cur); return; }
      onSheetClick(e).catch(err => A.status(String(err.message || err), 'err'));
    });
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') sheet.hidden = true; });
  }
  renderSheet(); sheet.hidden = false;
  const first = sheet.querySelector('input,select'); if (first) first.focus();
}

/* ---------- Enregistrer, exporter, importer ---------- */
/** Archive .jpart du brouillon, après vérification (erreur lisible sinon). */
function packDraft(d) {
  const errs = problems(d);
  if (errs.length) throw new Error(errs[0]);
  const m = manifestOf(d);
  return { m, bytes: J.packJpart({ manifest: m, glb: d.glb ? J.fromB64(d.glb) : null, symbol: d.part.symbol || null, svg: d.part.svg || null }) };
}
async function download(bytes, m) {
  const path = await A.saveFile(new Blob([bytes], { type: 'application/zip' }), `${slug(m.name)}.jpart`, tl('Composant Jollof Studio'), 'jpart');
  if (path) A.status(A.isDesktop() ? tl('Composant exporté : {0}', path) : tl('Composant exporté.'), 'ok');
}
async function exportDraft(c) {
  try { const d = c.custom; d.part.id = d.part.id || manifestOf(d).id; const { m, bytes } = packDraft(d); await download(bytes, m); }
  catch (e) { A.status(tl('Export impossible : {0}', String(e.message || e).split('\n')[0]), 'warn'); }
}
/**
 * Enregistre le brouillon : paquet vérifié, installé, rangé dans la bibliothèque personnelle ; le composant du
 * plan de travail devient le composant en paquet (ses fils restent branchés, broche par broche).
 */
export async function save(c) {
  const d = c && c.custom; if (!d) return;
  try {
    const old = d.part.id && P.packageOf(d.part.id);
    d.part.id = d.part.id || manifestOf(d).id;
    if (old) d.part.version = Math.max(old.manifest.version + 1, d.part.version || 1);
    const { m, bytes } = packDraft(d);
    await P.installBytes(bytes, { saved: true });
    await saveToLibrary(m.id);
    const data = A.projectData(), e = data.comps.find(x => x.id === c.id);
    if (e) { e.type = m.id; delete e.custom; e.name = c.name; }
    await A.refresh(data);
    const n = A.comps().find(x => x.id === c.id); if (n) A.select(n);
    A.renderLibrary();
    A.status(tl('{0} enregistré dans votre bibliothèque (paquet .jpart).', m.name), 'ok');
  } catch (e) { A.status(tl('Enregistrement impossible : {0}', String(e.message || e).split('\n')[0]), 'warn'); wizard(c); }
}
/** Composant en paquet posé sur le plan de travail → brouillon modifiable à la même place, fils gardés. */
async function edit(c) {
  const p = P.packageOf(c.type); if (!p) return;
  const data = A.projectData(), e = data.comps.find(x => x.id === c.id); if (!e) return;
  e.type = 'custom'; e.custom = draftOf(p.manifest, { glb: p.glb, svg: p.svg, symbol: p.symbol });
  await A.refresh(data);
  const n = A.comps().find(x => x.id === c.id); if (n) A.select(n);
  A.status(tl('{0} est en cours de modification : enregistrez-le pour mettre à jour la bibliothèque.', p.manifest.name), 'ok');
}
/** Nouveau brouillon sur le plan de travail. */
async function addDraft(custom, msg) {
  const c = await A.addDraft(custom);
  if (c) A.status(msg || tl('{0} : posez ses broches, puis décrivez-le.', c.name), 'ok');
  return c;
}
async function importFile(f) {
  const name = f.name || '', ext = (name.match(/\.([a-z_]+)$/i) || [])[1] || '';
  try {
    if (/^jpart$/i.test(ext)) {
      const m = await P.installBytes(new Uint8Array(await f.arrayBuffer()), { saved: true });
      await saveToLibrary(m.id); A.renderLibrary();
      A.status(tl('{0} ajouté à votre bibliothèque.', m.name), 'ok');
    } else if (/^fzpz$/i.test(ext)) {
      const F = await import('../import/fritzing.js');
      const r = F.importFritzing(F.readFzpz(new Uint8Array(await f.arrayBuffer())));
      await addDraft(draftOf(r.manifest, { svg: r.svg }), tl('Pièce Fritzing « {0} » importée : {1} broche(s) placée(s) d’après le dessin, {2} estimée(s). Vérifiez la nature de chaque broche.', r.report.title, r.report.placed.length, r.report.estimated.length));
    } else if (/^kicad_sym$/i.test(ext)) {
      const K = await import('../import/kicadsym.js');
      const syms = K.importKicadSymbols(await f.text()).filter(s => s.pins.length);
      if (!syms.length) throw new Error(tl('aucun symbole avec des broches'));
      const s = syms.length === 1 ? syms[0] : await pickSymbol(syms);
      if (!s) return;
      const dr = K.symbolDraft(s, name);
      await addDraft(draftOf(dr.manifest, { symbol: dr.symbol }), tl('Symbole KiCad « {0} » importé ({1} broches) : son dessin servira au schéma. Vérifiez la nature de chaque broche.', s.name, s.pins.length) + (s.multi ? ' ' + tl('Symbole à plusieurs unités : seule la première est reprise.') : ''));
    } else throw new Error(tl('format non pris en charge : utilisez .jpart, .fzpz ou .kicad_sym'));
  } catch (e) { A.status(tl('Import impossible : ') + String(e.message || e).split('\n')[0], 'err'); }
}
/** Choix d'un symbole dans une bibliothèque KiCad qui en contient plusieurs. */
function pickSymbol(syms) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal'; box.innerHTML = `<div class="sheet pickSheet" role="dialog" aria-modal="true" aria-labelledby="pickTitle"><div class="sheetHead"><h2 id="pickTitle">${A.icon('schematic')}${tl('Choisir un symbole ({0})', syms.length)}</h2><button type="button" class="btn small" data-x>${tl('Fermer')}</button></div>
      <input class="pickQ" placeholder="${esc(tl('Rechercher…'))}" aria-label="${esc(tl('Rechercher un symbole'))}"><ul class="pickList"></ul></div>`;
    document.body.appendChild(box);
    const list = box.querySelector('.pickList'), q = box.querySelector('.pickQ');
    const draw = () => { const t = q.value.trim().toLowerCase(); list.innerHTML = syms.map((s, i) => [s, i]).filter(([s]) => !t || `${s.name} ${s.description}`.toLowerCase().includes(t)).slice(0, 300).map(([s, i]) => `<li><button type="button" data-i="${i}"><b>${esc(s.name)}</b><small>${esc(tl('{0} broches', s.pins.length))}${s.description ? ' · ' + esc(s.description.slice(0, 90)) : ''}</small></button></li>`).join(''); };
    const done = v => { box.remove(); resolve(v); };
    q.oninput = draw; draw(); q.focus();
    box.addEventListener('click', e => { if (e.target === box || e.target.closest('[data-x]')) done(null); const b = e.target.closest('[data-i]'); if (b) done(syms[+b.dataset.i]); });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
  });
}

/* ---------- Composant en paquet sélectionné (main.js select) ---------- */
export function selected(c) {
  resetSaveLabel(c);
  const box = A && A.$('#pkgTools'); if (!box) return;
  const p = c && P.packageOf(c.type);
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<p class="note">${esc(tl('Composant en paquet (.jpart), version {0}{1}.', p.manifest.version, p.saved ? '' : tl(', apporté par ce projet')))}</p>
    <div class="row"><button type="button" class="btn small" data-pk="edit">${A.icon('edit')}<span>${tl('Modifier')}</span></button><button type="button" class="btn small" data-pk="export">${A.icon('upload')}<span>${tl('Exporter')}</span></button>
    ${p.saved ? `<button type="button" class="btn small" data-pk="remove">${A.icon('trash')}<span>${tl('Retirer de ma bibliothèque')}</span></button>` : `<button type="button" class="btn small" data-pk="keep">${A.icon('save')}<span>${tl('Ajouter à ma bibliothèque')}</span></button>`}</div>`;
  box.onclick = async e => {
    const b = e.target.closest('[data-pk]'); if (!b) return;
    try {
      if (b.dataset.pk === 'edit') await edit(c);
      if (b.dataset.pk === 'export') await download(p.bytes, p.manifest);
      if (b.dataset.pk === 'keep') { await saveToLibrary(c.type); A.renderLibrary(); selected(c); A.status(tl('{0} ajouté à votre bibliothèque.', p.manifest.name), 'ok'); }
      if (b.dataset.pk === 'remove') {
        await A.native.libraryDelete(c.type);
        P.uninstall(c.type, true); // les composants posés restent utilisables pendant la session
        A.renderLibrary(); selected(c); A.status(tl('{0} retiré de votre bibliothèque (il reste enregistré dans ce projet).', p.manifest.name), 'ok');
      }
    } catch (err) { A.status(String(err.message || err), 'err'); }
  };
}

/* ---------- Installation dans l'application ---------- */
/**
 * api : { $, icon, status, select, selected(), comps, projectData, refresh(data), rebuildCustom(c), addDraft(custom),
 *         renderLibrary, renderExplain, changed, native, saveFile, isDesktop }.
 */
export function install(api) {
  A = api;
  const $ = api.$;
  const file = $('#partFile'), news = $('#partNew');
  if (file) file.onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  if (news) news.onclick = () => addDraft({ v: 2, name: tl('Nouveau composant'), kind: 'part', part: { category: J.PKG_CATEGORIES[0], prefix: 'U', look: { kind: 'module', color: '#1b4f8c', size: [24, 1.6, 16] } }, pins: [] });
  const box = $('#partEd');
  if (box) box.addEventListener('click', e => {
    const b = e.target.closest('[data-pe]');
    if (!b) return;
    const sel = selectedDraft(); if (!sel) return;
    if (b.dataset.pe === 'row') addRow(sel, $('#peRow').value);
    if (b.dataset.pe === 'details') openSheet(sel);
    if (b.dataset.pe === 'export') exportDraft(sel);
  });
  if (box) box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'peRow') { const sel = selectedDraft(); if (sel) addRow(sel, e.target.value); } });
  // Nature et attente d'une broche dans la liste de l'assistant (le renommage et le retrait restent ceux de main.js).
  const list = $('#cPins');
  if (list) list.addEventListener('change', e => {
    const c = selectedDraft(), el = e.target; if (!c) return;
    const q = el.dataset.pk != null ? c.custom.pins[+el.dataset.pk] : el.dataset.pn != null ? c.custom.pins[+el.dataset.pn] : null;
    if (!q) return;
    if (el.dataset.pk != null) { q.kind = el.value; if (q.kind === 'io') q.need = q.need || defaults(q).need || 'io'; else delete q.need; if (q.kind === 'pwr') q.v = q.v || 'logic'; else { delete q.v; delete q.ds; } }
    else q.need = el.value;
    touched(c);
  });
}
/** Brouillon sélectionné (composant importé de nature « part »), ou null. */
function selectedDraft() {
  const c = A.selected ? A.selected() : null;
  return c && c.custom && c.custom.kind === 'part' ? c : null;
}
