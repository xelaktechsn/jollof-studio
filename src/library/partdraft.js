// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Brouillon d'un composant en paquet (.jpart) : les données qu'éditent l'assistant du plan de travail et l'atelier
// de composants (studio.js). Un brouillon a la forme d'un composant importé (c.custom) : { v: 2, name, kind: 'part',
// part (champs du manifeste), pins: [{ name, x, y, z, kind?, need?, … }], glb? }. Ce module le convertit en
// manifeste, en fiche de câblage et en archive, et dit ce qui l'empêche d'être enregistré.
import * as J from './jpart.js';
import * as P from './packages.js';
import { roleOf, pinFromRole } from '../import/fritzing.js';
import { sanitizeSvg } from '../import/xml.js';
import { tl } from '../i18n/index.js';

export const PART_KEYS = ['id', 'version', 'category', 'prefix', 'description', 'author', 'license', 'ma', 'ds', 'limits', 'sources', 'docs', 'behaviour', 'look'];
export const KIND_LABEL = () => ({ pwr: tl('Alimentation'), gnd: tl('Masse'), io: tl('Signal (GPIO)'), nc: tl('Libre'), passive: tl('Patte passive'), drv: tl('Borne de moteur'), contact: tl('Contact de puissance') });
export const NEED_LABEL = () => ({ io: tl('Données (entrée/sortie)'), in: tl('Sortie du module → carte'), out: tl('Commande carte → module'), pullup: tl('Entrée avec tirage (INPUT_PULLUP)'), pwm: tl('Commande PWM'), adc: tl('Sortie analogique'), sda: 'I2C SDA', scl: 'I2C SCL', sck: 'SPI SCK', mosi: 'SPI MOSI', miso: 'SPI MISO', ss: 'SPI CS', rx: tl('Série RX du module'), tx: tl('Série TX du module') });
export const LOOK_LABEL = () => ({ module: tl('Plaquette (module)'), block: tl('Bloc'), led: 'LED', resistor: tl('Résistance'), svg: tl('Dessin SVG sur plaquette'), glb: tl('Modèle 3D importé') });
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const opts = (map, cur) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${String(cur ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
export const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) || 'composant';
/** Nom de broche accepté par le format (lettres, chiffres, + - _ . / ~ ; 16 caractères au plus). */
export const cleanPinName = s => String(s || '').replace(/[^A-Za-z0-9+\-_./~]/g, '').slice(0, 16);

/** Nature proposée d'une broche d'après son nom (ou son rôle de module, si le modèle était décrit comme module). */
export function defaults(q) {
  if (q.role && /^(pwr|pwr33|pwr5|gnd|nc|io|in|out|pwm|adc|sda|scl|sck|mosi|miso|ss|tx|rx)$/.test(q.role)) return pinFromRole(q.role);
  return pinFromRole(roleOf(q.name));
}
/** Broche du brouillon → broche du manifeste (nature par défaut si elle n'a pas encore été choisie). */
export function pinOut(q) {
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
/** Erreurs du brouillon (manifeste et symbole), [] s'il est prêt à être enregistré. Forme : « chemin : message ». */
export function problems(d) {
  const m = manifestOf(d), v = J.validateManifest(m), out = v.ok ? [] : v.errors;
  if (d.part && d.part.symbol) { const s = J.validateSymbol(d.part.symbol, m.pins.map(q => q.name)); if (!s.ok) out.push(...s.errors); }
  if (!(d.pins || []).length) out.unshift(tl('Posez au moins une broche.'));
  return out;
}
/** Archive .jpart du brouillon, après vérification (erreur lisible sinon) : { m, bytes }. */
export function packDraft(d) {
  const errs = problems(d);
  if (errs.length) throw new Error(errs[0]);
  const m = manifestOf(d);
  return { m, bytes: J.packJpart({ manifest: m, glb: d.glb ? J.fromB64(d.glb) : null, symbol: (d.part && d.part.symbol) || null, svg: (d.part && d.part.svg) || null }) };
}
/** Modèle 3D d'un brouillon sans modèle importé : plaquette, bloc, LED, résistance ou dessin SVG. */
export function blockModel(data) {
  const p = data.part || {};
  let svg = null;
  try { svg = p.svg ? sanitizeSvg(String(p.svg)) : null; } catch (e) { svg = null; } // brouillon reçu avec un projet : dessin nettoyé
  return P.lookModel({ prefix: p.prefix, look: p.look, behaviour: p.behaviour, pins: (data.pins || []).map(pinOut) }, svg);
}
/** Brouillon (données d'un composant importé) d'un paquet : pour le modifier, ou après un import Fritzing / KiCad. */
export function draftOf(m, extra = {}) {
  const part = Object.fromEntries(PART_KEYS.filter(k => m[k] != null && k !== 'name').map(k => [k, JSON.parse(JSON.stringify(m[k]))]));
  if (extra.svg) part.svg = extra.svg;
  if (extra.symbol) part.symbol = extra.symbol;
  const pins = m.pins.map(q => { const { role, ...r } = q; return { ...r, ...(role ? { label: role } : {}) }; });
  return { v: 2, name: m.name, kind: 'part', part, pins, ...(extra.glb ? { glb: J.toB64(extra.glb) } : {}) };
}
