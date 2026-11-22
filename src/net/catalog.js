// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Catalogue de matériel réel (src/net/catalog/products.json, chargé à la demande : rien au démarrage). Chaque produit vient
// d'une fiche du fabricant réellement lue (url, src : clé de src/check/sources.js) ; un champ absent de la fiche est absent
// du produit (jamais inventé). Pas de prix (ils changent : le projet garde son propre tarif), pas de logo ni d'image.
// Un produit choisi laisse sur l'équipement un extrait autonome (d.model) : les baies, la nomenclature et les exports
// marchent sans recharger le catalogue. Pour un switch, la disposition des ports (d.p.lay) et le PoE suivent le modèle.
//   produit : { id, kind, type? (type d'équipement du plan), vendor, model, pn, lay? { rj, speed, poe, up, cage },
//     poe? { budget, std, portW }, w? (W sans PoE), wMax? (W au maximum), btu?, u?, width?, depth? (mm), kg?, shelf?,
//     gain? (dBi par bande), eth?, notes? [codes], url, src }
import { tl } from '../i18n/index.js';
import { DEVICES, specOf } from './devices.js';

const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const numOr = (v, lo, hi) => (v != null && v !== '' && Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : null);

let cache = null;
/** Charge le catalogue (une fois). */
export async function loadCatalog() {
  if (!cache) cache = import('./catalog/products.json').then(m => m.default || m);
  return cache;
}

export const KINDS = ['switch', 'router', 'ap', 'patch', 'fibrepanel', 'server', 'mediaconv', 'pdu', 'ups', 'rack', 'sfp', 'cable'];
export const kindName = k => ({
  switch: () => tl('Switchs'), router: () => tl('Routeurs et pare-feu'), ap: () => tl('Points d’accès Wi-Fi'), patch: () => tl('Panneaux de brassage'),
  fibrepanel: () => tl('Panneaux fibre'), server: () => tl('Serveurs'), mediaconv: () => tl('Convertisseurs de média'), pdu: () => tl('PDU'),
  ups: () => tl('Onduleurs'), rack: () => tl('Baies et coffrets'), sfp: () => tl('Modules SFP'), cable: () => tl('Câbles')
}[k] || (() => k))();
/** Remarques d'un produit (écarts entre la fiche et notre modèle), en clair. */
const NOTES = {
  budget375: () => tl('Budget PoE : 375 W dans le tableau technique de la fiche, 370 W dans son tableau de commande.'),
  kgdoubt: () => tl('Poids non repris : la fiche donne des valeurs incohérentes entre deux modèles voisins.'),
  mgig8: () => tl('8 des ports sont multigigabit 2,5 Gb/s sur le vrai : modélisés à 1 Gb/s.'),
  mgig16: () => tl('16 des ports sont multigigabit 2,5 Gb/s sur le vrai : modélisés à 1 Gb/s.'),
  combo4: () => tl('Sur le vrai, les 4 ports cuivre partagent leur place avec 4 cages : modèle simplifié.'),
  combo2: () => tl('Sur le vrai, 2 ports sont mixtes cuivre / SFP : modèle simplifié.'),
  compact: () => tl('Format compact, moins large qu’une baie 19 pouces : posé sur une tablette.'),
  rackkit: () => tl('Se monte en baie avec le kit du fabricant (à commander à part).'),
  portsfixed: () => tl('Les ports du plan restent ceux du type générique : seuls la référence, la puissance et l’encombrement suivent le modèle.'),
  poepp8: () => tl('8 ports PoE++ (60 W) sur le vrai : modélisés en PoE+ (30 W).'),
  sfp28x4: () => tl('4 cages SFP28 (25 Gb/s) sur le vrai : modélisées en SFP+ (10 Gb/s).'),
  qsfp2: () => tl('2 cages QSFP+ (40 Gb/s) sur le vrai : non modélisées.'),
  wifi7: () => tl('Wi-Fi 7 sur le vrai : modélisé comme un point d’accès Wi-Fi 6E (trois bandes).'),
  psu: () => tl('Puissance maximale : celle de l’alimentation (majorant).')
};
export const notesOf = p => (p.notes || []).map(n => (NOTES[n] ? NOTES[n]() : n));
export const NOTE_CODES = Object.keys(NOTES);

/** Familles de types interchangeables : choisir un modèle peut changer le type dans sa famille. */
const FAMILY = [['switch24', 'switch48', 'l3switch'], ['ap', 'ap6', 'ap6e'], ['patch24', 'patch48']];
export const familyOf = type => FAMILY.find(f => f.includes(type)) || [type];
/** Types d'équipement pour lesquels le catalogue a des modèles réels (le bouton « Modèle réel » de l'inspecteur). */
export const MODEL_TYPES = new Set(['switch24', 'switch48', 'l3switch', 'poeswitch', 'routerpro', 'ap', 'ap6', 'ap6e', 'patch24', 'patch48', 'fibrepanel', 'server', 'nas', 'mediaconv', 'pdu', 'pdu1u', 'ups', 'ups3k']);
/** Produits qu'on peut donner à un équipement de ce type. */
export const productsFor = (list, type) => { const f = familyOf(type); return list.filter(p => p.type && f.includes(p.type)); };

/** Recherche plein texte (fabricant, modèle, référence), tous les mots doivent y être. */
export function searchProducts(list, q, kind) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(p => (!kind || p.kind === kind) && words.every(w => `${p.vendor} ${p.model} ${p.pn}`.toLowerCase().includes(w)));
}

/** Disposition de ports propre : { rj, speed, poe, up, cage } ou null. */
export function cleanLay(l) {
  if (!l || typeof l !== 'object') return null;
  const rj = Math.round(numOr(l.rj, 0, 96) ?? 0), up = Math.round(numOr(l.up, 0, 48) ?? 0);
  if (!rj && !up) return null;
  return { rj, speed: [100, 1000, 2500, 10000].includes(+l.speed) ? +l.speed : 1000, poe: Math.min(rj, Math.round(numOr(l.poe, 0, 96) ?? 0)), up, cage: l.cage === 'sfp' ? 'sfp' : 'sfp+' };
}
/** Extrait autonome d'un produit, gardé sur l'équipement (d.model) ou sur une ligne (data.refs) ; null si invalide. */
export function cleanModel(m) {
  if (!m || typeof m !== 'object') return null;
  const id = typeof m.id === 'string' && /^[\w.+-]{1,40}$/.test(m.id) ? m.id : '', vendor = txt(m.vendor, 40), model = txt(m.model, 80), pn = txt(m.pn, 60);
  if (!id || !vendor || !pn) return null;
  const o = { id, vendor, model: model || pn, pn };
  for (const [k, lo, hi] of [['u', 0, 60], ['depth', 1, 1500], ['width', 1, 1500], ['kg', 0, 2000], ['w', 0, 20000], ['wMax', 0, 20000], ['btu', 0, 100000]]) { const v = numOr(m[k], lo, hi); if (v != null) o[k] = v; }
  if (o.u != null) o.u = Math.round(o.u);
  if (m.shelf === true) o.shelf = true;
  const b = m.poe && numOr(m.poe.budget, 0, 5000); if (b) o.poeBudget = b; else if (numOr(m.poeBudget, 1, 5000)) o.poeBudget = +m.poeBudget;
  const url = txt(m.url, 300); if (/^https:\/\//.test(url)) o.url = url;
  const src = txt(m.src, 60); if (/^\w+$/.test(src)) o.src = src;
  return o;
}
/** Références choisies pour des lignes de nomenclature (data.refs : { [clé de ligne]: extrait }). */
export function cleanRefs(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw).slice(0, 60)) { const m = cleanModel(v); if (m && /^[\w-]{1,30}$/.test(k)) out[k] = m; }
  return out;
}
/** Lignes de nomenclature qui acceptent une référence du catalogue : clé → genre de produit (et filtre). */
export function refKindOf(key) {
  if (key === 'sfp') return { kind: 'sfp' };
  if (key === 'rack') return { kind: 'rack' };
  const m = /^box_(cat5e|cat6|cat6a)$/.exec(key); if (m) return { kind: 'cable', cat: m[1] };
  return null;
}

const POE_CLASS = { af: 3, at: 4, bt3: 6, bt4: 8 };
/**
 * Équipement d avec le produit p appliqué (copie ; d intact) : type (dans la famille), d.model, disposition des ports et
 * PoE d'un switch, classe PoE et gains d'antenne d'un point d'accès. Rend null si le produit ne va pas à ce type.
 */
export function applyModel(d, p) {
  if (!d || !p || !p.type || !DEVICES[p.type] || !familyOf(d.type).includes(p.type)) return null;
  const model = cleanModel(p); if (!model) return null;
  const P = { ...(d.p || {}) };
  if (p.kind === 'switch') {
    const lay = p.type === 'poeswitch' ? null : cleanLay(p.lay);
    if (lay) P.lay = lay; else delete P.lay;
    if (p.type !== 'l3switch') { P.budget = p.poe ? p.poe.budget : 0; P.pseType = (p.poe && p.poe.std) || 'at'; P.portW = (p.poe && p.poe.portW) || 0; }
  }
  if (p.kind === 'ap') {
    if (p.poe && POE_CLASS[p.poe.std]) P.poeClass = POE_CLASS[p.poe.std];
    if (p.gain && P.radios) { P.radios = { ...P.radios }; for (const [b, g] of Object.entries(p.gain)) if (P.radios[b]) P.radios[b] = { ...P.radios[b], gain: g }; }
  }
  const o = { ...d, type: p.type, model, p: P };
  if (p.type !== d.type) { const def = DEVICES[p.type].props(); o.p = { ...def, ...P }; }
  return o;
}
/** Retire le modèle : l'équipement retrouve la disposition et le PoE de son type générique. */
export function clearModel(d) {
  const o = { ...d, p: { ...(d.p || {}) } }; delete o.model; delete o.p.lay;
  const def = DEVICES[d.type] ? DEVICES[d.type].props() : {};
  for (const k of ['budget', 'pseType', 'portW']) if (k in def) o.p[k] = def[k];
  return o;
}
/** Câbles branchés sur des ports que l'équipement n'aurait plus avec next (équipement modifié) : [ids de câbles]. */
export function lostCables(data, d, next) {
  const s = specOf(next); if (!s) return [];
  const keep = new Set(s.ports(next.p || {}).map(x => x.id)), out = [];
  for (const c of (data && data.cables) || []) for (const e of [c.a, c.b]) if (e && e[0] === d.id && !keep.has(e[1])) out.push(c.id);
  return [...new Set(out)];
}
/** Fabricant et référence d'un extrait : { maker, part }. */
export const makerOfModel = m => (m ? { maker: m.vendor, part: m.pn } : { maker: '', part: '' });
/** Une ligne lisible : « Cisco Catalyst C1300-24P-4G (C1300-24P-4G) ». */
export const modelLabel = m => (m ? `${m.vendor} ${m.model}${m.model.includes(m.pn) ? '' : ' (' + m.pn + ')'}` : '');
/** Résumé technique d'un produit du catalogue (liste du sélecteur). */
export function specLine(p, fmt = v => String(v)) {
  const out = [];
  if (p.lay) out.push(tl('{0} RJ45 + {1} {2}', p.lay.rj, p.lay.up, p.lay.cage === 'sfp' ? 'SFP' : 'SFP+'));
  if (p.poe && p.poe.budget) out.push(tl('PoE {0} W', fmt(p.poe.budget)));
  if (p.wifi) out.push(p.wifi);
  if (p.std) out.push(p.std);
  if (p.cat) out.push(p.cat.replace('cat', 'Cat ').replace('6a', '6A'));
  if (p.ports) out.push(tl('{0} ports', p.ports));
  if (p.va) out.push(p.va + ' VA');
  if (p.rack) out.push(`${p.rack.u} U · ${p.rack.w} × ${p.rack.d} mm`);
  if (p.u != null && !p.shelf && p.kind !== 'rack') out.push(p.u ? p.u + ' U' : '0U');
  if (p.depth) out.push(tl('prof. {0} mm', fmt(p.depth)));
  if (p.wMax || p.w) out.push(fmt(p.wMax || p.w) + ' W');
  if (p.kg) out.push(fmt(p.kg) + ' kg');
  return out.join(' · ');
}
