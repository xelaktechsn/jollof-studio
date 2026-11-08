// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Lecteur XML minimal pour les fichiers reçus d'ailleurs (pièces Fritzing .fzp, dessins SVG) : il tourne aussi sous
// Node (tests), n'interprète aucune DTD ni entité déclarée (seulement &lt; &gt; &amp; &quot; &apos; et &#…;), borne
// la taille, la profondeur et le nombre de nœuds. Et un nettoyeur de SVG qui ne garde que le dessin.

const MAX_TEXT = 8 * 1024 * 1024, MAX_DEPTH = 96, MAX_NODES = 60000;
const NAME = /[A-Za-z_][-\w.:]*/y;
const ATTR = /\s*([A-Za-z_][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/** Entités de base et références numériques ; les autres restent telles quelles. */
export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
  });
}

/**
 * Arbre d'un document XML : { tag, attrs (objet sans prototype), children: [nœuds], text (texte direct) }.
 * Lève une erreur (en français) sur un document mal formé ou trop gros.
 */
export function parseXml(text) {
  if (typeof text !== 'string') throw new Error('XML : texte attendu');
  if (text.length > MAX_TEXT) throw new Error('XML : fichier trop lourd');
  const root = { tag: '#document', attrs: Object.create(null), children: [], text: '' };
  const stack = [root];
  let i = 0, nodes = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += decodeEntities(text.slice(i)); break; }
    if (lt > i) top.text += decodeEntities(text.slice(i, lt));
    i = lt;
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) throw new Error('XML : commentaire non fermé'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i + 9); if (e < 0) throw new Error('XML : CDATA non fermé'); top.text += text.slice(i + 9, e); i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e < 0) throw new Error('XML : instruction non fermée'); i = e + 2; continue; }
    if (text.startsWith('<!', i)) {
      // DOCTYPE (et son éventuel sous-ensemble interne) : ignoré, jamais interprété.
      let depth = 0, j = i + 2;
      for (; j < n; j++) { const ch = text[j]; if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) break; }
      if (j >= n) throw new Error('XML : déclaration non fermée');
      i = j + 1; continue;
    }
    if (text[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text); if (!m) throw new Error('XML : balise fermante invalide');
      const gt = text.indexOf('>', NAME.lastIndex); if (gt < 0) throw new Error('XML : balise non fermée');
      if (stack.length < 2 || top.tag !== m[0]) throw new Error(`XML : </${m[0]}> inattendue`);
      stack.pop(); i = gt + 1; continue;
    }
    NAME.lastIndex = i + 1;
    const m = NAME.exec(text); if (!m) throw new Error('XML : balise invalide');
    const el = { tag: m[0], attrs: Object.create(null), children: [], text: '' };
    let j = NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = j;
      const a = ATTR.exec(text);
      if (!a) break;
      el.attrs[a[1]] = decodeEntities(a[3] ?? a[4]);
      j = ATTR.lastIndex;
    }
    while (j < n && /\s/.test(text[j])) j++;
    let self = false;
    if (text[j] === '/') { self = true; j++; }
    if (text[j] !== '>') throw new Error(`XML : balise <${el.tag}> mal formée`);
    i = j + 1;
    if (++nodes > MAX_NODES) throw new Error('XML : trop d’éléments');
    top.children.push(el);
    if (!self) { stack.push(el); if (stack.length > MAX_DEPTH) throw new Error('XML : imbrication trop profonde'); }
  }
  if (stack.length > 1) throw new Error(`XML : <${stack[stack.length - 1].tag}> non fermée`);
  const els = root.children;
  if (els.length !== 1) throw new Error('XML : un seul élément racine attendu');
  return els[0];
}

/** Nom local d'une balise (« svg:rect » → « rect »). */
export const localName = tag => tag.slice(tag.lastIndexOf(':') + 1);
/** Parcours en profondeur : fn(nœud, ancêtres). */
export function walk(node, fn, anc = []) {
  fn(node, anc);
  const next = [...anc, node];
  for (const ch of node.children) walk(ch, fn, next);
}
/** Premier descendant (ou le nœud lui-même) de balise locale `name`. */
export function find(node, name) {
  if (localName(node.tag) === name) return node;
  for (const ch of node.children) { const f = find(ch, name); if (f) return f; }
  return null;
}
export const findAll = (node, name) => { const out = []; walk(node, x => { if (localName(x.tag) === name) out.push(x); }); return out; };
/** Texte d'un nœud et de ses descendants. */
export const textOf = node => node.text + node.children.map(textOf).join('');

/* ---------- Nettoyage d'un SVG ---------- */
// Seul le dessin passe : formes, textes, dégradés, groupes. Ni script, ni objet étranger, ni image, ni lien, ni
// animation, ni référence externe (url(…) et href vers autre chose qu'une ancre locale #…). Le document est réécrit
// à partir de l'arbre lu : une balise mal formée ne peut pas survivre au nettoyage.
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient',
  'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'use', 'symbol', 'title', 'desc']);
const BAD_VALUE = /javascript:|vbscript:|data:(?!image\/(png|jpe?g|gif|webp);base64,)|expression\s*\(|@import|behavior\s*:|-moz-binding/i;
const escAttr = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** url(…) qui ne vise pas une ancre locale : remplacé par none. */
const cleanUrls = v => v.replace(/url\s*\(\s*(['"]?)\s*(?!#)[^)]*\)/gi, 'none');

function cleanAttr(name, value) {
  const ln = name.toLowerCase();
  if (ln.startsWith('on')) return null;
  if (ln === 'xmlns' || ln === 'xmlns:xlink') return value;
  if (ln.startsWith('xmlns:')) return null;
  if (ln === 'href' || ln === 'xlink:href') return /^#[\w.:-]{1,120}$/.test(value.trim()) ? value.trim() : null;
  if (BAD_VALUE.test(value)) return null;
  return cleanUrls(value).slice(0, 200000);
}

/** SVG nettoyé (texte), ou une erreur si ce n'est pas un SVG. */
export function sanitizeSvg(text) {
  const root = parseXml(text);
  if (localName(root.tag) !== 'svg') throw new Error('SVG : la racine doit être <svg>');
  const out = [];
  const emit = node => {
    const tag = localName(node.tag);
    if (!SVG_TAGS.has(tag)) return;
    let a = '';
    for (const [k, v] of Object.entries(node.attrs)) {
      if (!/^[A-Za-z_][-\w.:]*$/.test(k)) continue;
      const c = cleanAttr(k, v); if (c == null) continue;
      a += ` ${k}="${escAttr(c)}"`;
    }
    if (tag === 'svg' && node === root && !('xmlns' in node.attrs)) a += ' xmlns="http://www.w3.org/2000/svg"';
    const kids = node.children.filter(ch => SVG_TAGS.has(localName(ch.tag)));
    const txt = node.text.trim() && (tag === 'text' || tag === 'tspan' || tag === 'title' || tag === 'desc') ? escText(node.text) : '';
    if (!kids.length && !txt) { out.push(`<${tag}${a}/>`); return; }
    out.push(`<${tag}${a}>${txt}`);
    kids.forEach(emit);
    out.push(`</${tag}>`);
  };
  emit(root);
  return out.join('');
}
