// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique pure de la trousse réseau (sans page, testée sous Node) : arbre (index, filtre, aplatissement des lignes
// visibles, plages de sélection), tableau (filtre, tri stable, valeurs comparables) et grille de propriétés (valeurs
// fusionnées d'une sélection multiple, lecture et contrôle d'une saisie, chemins « a.b.c »).

/** Texte sans accents ni casse (recherches). */
export const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');

/* ---------- Arbre ----------
 * Nœud : { key (unique), label, sub?, icon?, kind?, id?, badge?, children?: [nœud], open?: ouvert par défaut, terms?: texte
 * cherché en plus du libellé }. */

/** Index de l'arbre : key → { node, parent (key | null), depth }. */
export function indexTree(roots) {
  const idx = new Map();
  const walk = (list, parent, depth) => { for (const n of list || []) { idx.set(n.key, { node: n, parent, depth }); if (n.children && n.children.length) walk(n.children, n.key, depth + 1); } };
  walk(roots, null, 0);
  return idx;
}
/** Clés des ancêtres d'un nœud (du parent à la racine). */
export function ancestors(idx, key) { const out = []; let e = idx.get(key); while (e && e.parent != null) { out.push(e.parent); e = idx.get(e.parent); } return out; }

/**
 * Filtre : rend { match: Set des nœuds qui correspondent, keep: Set des nœuds à montrer (correspondances, leurs ancêtres
 * et, pour un groupe qui correspond, tout son contenu n'est pas forcé) } ; q vide → null (pas de filtre).
 * Chaque mot de q doit se trouver dans le libellé, le sous-titre ou terms (mots dans n'importe quel ordre).
 */
export function filterTree(roots, q) {
  const words = norm(q).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const match = new Set(), keep = new Set();
  const test = n => { const t = norm(`${n.label ?? ''} ${n.sub ?? ''} ${n.terms ?? ''}`); return words.every(w => t.includes(w)); };
  const walk = n => {
    let any = false;
    for (const c of n.children || []) if (walk(c)) any = true;
    if (test(n)) { match.add(n.key); any = true; }
    if (any) keep.add(n.key);
    return any;
  };
  for (const r of roots || []) walk(r);
  return { match, keep };
}

/**
 * Lignes visibles, dans l'ordre : [{ node, depth, kids (a des enfants montrables), open }]. expanded : Set des clés
 * ouvertes ; filter (filterTree) : seuls les nœuds gardés, et leurs ancêtres sont ouverts d'office.
 */
export function flatten(roots, expanded, filter = null) {
  const rows = [];
  const walk = (list, depth) => {
    for (const n of list || []) {
      if (filter && !filter.keep.has(n.key)) continue;
      const kids = !!(n.children && n.children.length && (!filter || n.children.some(c => filter.keep.has(c.key))));
      const open = kids && (filter ? true : expanded.has(n.key));
      rows.push({ node: n, depth, kids, open });
      if (open) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}
/** Clés des ouverts par défaut (node.open) : état de départ d'un arbre. */
export function defaultOpen(roots) { const s = new Set(); const walk = l => { for (const n of l || []) { if (n.open) s.add(n.key); if (n.children) walk(n.children); } }; walk(roots); return s; }
/** Clés entre deux lignes (bornes comprises), dans l'ordre des lignes : sélection Maj+clic. */
export function rangeKeys(rows, a, b) {
  const i = rows.findIndex(r => r.node.key === a), j = rows.findIndex(r => r.node.key === b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return rows.slice(lo, hi + 1).map(r => r.node.key);
}
/** Morceaux du libellé avec les mots cherchés repérés : [[texte, trouvé], …] (pour <mark>). */
export function highlightParts(label, q) {
  const s = String(label ?? ''), words = norm(q).trim().split(/\s+/).filter(Boolean);
  if (!words.length || !s) return [[s, false]];
  const n = norm(s); if (n.length !== s.length) return [[s, false]]; // lettres composées : pas de repérage
  const hit = new Array(s.length).fill(false);
  for (const w of words) { let i = n.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length; k++) hit[k] = true; i = n.indexOf(w, i + w.length); } }
  const out = []; let cur = '', on = hit[0];
  for (let i = 0; i < s.length; i++) { if (hit[i] !== on) { out.push([cur, on]); cur = ''; on = hit[i]; } cur += s[i]; }
  out.push([cur, on]);
  return out.filter(p => p[0]);
}

/* ---------- Tableau ---------- */
/** Valeur comparable d'une cellule : nombre si la colonne est numérique (vides en dernier), sinon texte normalisé. */
const cellOf = (col, row) => (col.value ? col.value(row) : row[col.key]);
/** Comparaison « naturelle » (PB1-2 avant PB1-10). */
const coll = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
export function compareCells(a, b, num) {
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1; // vides en dernier
  if (num) { const x = +a, y = +b; if (Number.isFinite(x) && Number.isFinite(y)) return x - y; }
  return coll ? coll.compare(String(a), String(b)) : String(a).localeCompare(String(b));
}
/** Lignes triées (tri stable) par colonne ; dir 1 ou -1 ; les vides restent en dernier dans les deux sens. */
export function sortRows(rows, col, dir = 1) {
  if (!col) return rows.slice();
  const keyed = rows.map((r, i) => [cellOf(col, r), i, r]);
  keyed.sort((p, q) => {
    const ep = p[0] == null || p[0] === '', eq = q[0] == null || q[0] === '';
    if (ep || eq) return ep && eq ? p[1] - q[1] : ep ? 1 : -1;
    return compareCells(p[0], q[0], col.num) * dir || p[1] - q[1];
  });
  return keyed.map(k => k[2]);
}
/**
 * Lignes filtrées : chaque mot de q doit se trouver dans une des colonnes (texte affiché). Un mot « col:valeur » ne
 * cherche que dans la colonne dont la clé ou le titre commence par col (« vlan:20 », « rack:b1 »).
 */
export function filterRows(rows, cols, q) {
  const words = norm(q).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return rows.slice();
  const text = (c, r) => { const v = c.text ? c.text(r) : cellOf(c, r); return norm(v == null ? '' : v); };
  const tests = words.map(w => {
    const m = /^([a-z0-9_]+):(.+)$/.exec(w);
    if (m) { const c = cols.find(x => norm(x.key).startsWith(m[1]) || norm(x.label).startsWith(m[1])); if (c) return r => text(c, r).includes(m[2]); }
    return r => cols.some(c => text(c, r).includes(w));
  });
  return rows.filter(r => tests.every(t => t(r)));
}

/* ---------- Grille de propriétés ---------- */
/** Lit obj[a][b]… pour « a.b » ; field.get(obj) l'emporte. */
export function getPath(obj, path) { let o = obj; for (const k of String(path).split('.')) { if (o == null) return undefined; o = o[k]; } return o; }
/** Écrit obj[a][b] = v (crée les objets intermédiaires). */
export function setPath(obj, path, v) {
  const ks = String(path).split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = v;
}
const getF = (f, o) => (f.get ? f.get(o) : getPath(o, f.key));
const same = (a, b) => a === b || (a !== a && b !== b) || (a != null && b != null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
/**
 * Valeurs fusionnées pour une sélection : list = [objet] ; rend { [key]: { value, mixed, n } } où mixed indique des
 * valeurs différentes (value est alors celle du premier) et n le nombre d'objets qui ont ce champ (field.applies(o)).
 */
export function mergeValues(list, fields) {
  const out = {};
  for (const f of fields) {
    if (!f.key) continue;
    let first, has = false, mixed = false, n = 0;
    for (const o of list || []) {
      if (f.applies && !f.applies(o)) continue;
      const v = getF(f, o); n++;
      if (!has) { first = v; has = true; } else if (!same(first, v)) mixed = true;
    }
    out[f.key] = { value: first, mixed, n };
  }
  return out;
}
/**
 * Lit une saisie selon le champ : { ok, value, error }. number : virgule ou point, min, max, entier (step entier), vide
 * permis si !required (value null) ; text : maxlength, pattern ; select : valeur parmi options ; bool : booléen.
 * field.validate(value) → message d'erreur ou null, en dernier.
 */
export function parseValue(f, raw, tl = s => s) {
  const fail = error => ({ ok: false, value: undefined, error });
  let v = raw;
  if (f.type === 'number') {
    const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') { if (f.required) return fail(tl('Valeur requise')); v = null; }
    else {
      if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return fail(tl('Nombre attendu'));
      v = +s;
      if (f.min != null && v < f.min) return fail(tl('Au moins {0}', f.min));
      if (f.max != null && v > f.max) return fail(tl('Au plus {0}', f.max));
      if (f.int && !Number.isInteger(v)) return fail(tl('Nombre entier attendu'));
    }
  } else if (f.type === 'bool') v = !!raw;
  else if (f.type === 'select') {
    const opts = (typeof f.options === 'function' ? f.options() : f.options) || [];
    const hit = opts.find(o => String(Array.isArray(o) ? o[0] : o) === String(raw));
    if (!hit) return fail(tl('Choix inconnu'));
    v = Array.isArray(hit) ? hit[0] : hit;
  } else {
    v = String(raw ?? '');
    if (f.trim !== false) v = v.trim();
    if (!v && f.required) return fail(tl('Valeur requise'));
    if (f.maxlength && v.length > f.maxlength) return fail(tl('{0} caractères au plus', f.maxlength));
    if (f.pattern && v && !new RegExp(f.pattern).test(v)) return fail(f.patternText || tl('Format incorrect'));
  }
  if (f.validate) { const e = f.validate(v); if (e) return fail(e); }
  return { ok: true, value: v, error: null };
}
/** Texte affiché d'une valeur (nombres à la virgule en français). */
export function fmtValue(f, v, en = false) {
  if (v == null) return '';
  if (f.type === 'number') { const d = f.digits ?? 3, t = String(Math.round(+v * 10 ** d) / 10 ** d); return en ? t : t.replace('.', ','); }
  return String(v);
}
