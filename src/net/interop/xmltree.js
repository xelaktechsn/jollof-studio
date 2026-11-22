// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// XML des échanges de schémas (Visio .vsdx, draw.io) : échappement à l'écriture et petit lecteur en arbre pour relire nos
// fichiers et ceux reçus d'ailleurs. Lecteur volontairement strict sur la forme (balises équilibrées, attributs entre
// guillemets, un seul élément racine : c'est aussi le contrôle « XML bien formé » des tests) et prudent : aucune DTD ni
// entité déclarée n'est interprétée (seulement &lt; &gt; &amp; &quot; &apos; et &#…;), taille et nombre de nœuds bornés.
// Les préfixes d'espaces de noms sont gardés dans le nom (« r:id ») : les formats lus ici n'en ont pas besoin de plus.
//
// parseTree(texte) → { tag, attrs, children, text } ; kids(n, tag) ; kid(n, tag) ; xmlEsc(s).

const LIMIT = { chars: 96 * 1024 * 1024, nodes: 4e6, depth: 128 };
const NAME = /[A-Za-z_][-\w.:]*/y;
const ATTR = /\s+([A-Za-z_][-\w.:]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;

/** Caractères interdits en XML 1.0 retirés, puis échappement (texte et attributs). */
export const xmlEsc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function unescape(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|lt|gt|amp|quot|apos|[^;\s]{0,12});?/g, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n); throw new Error('XML : référence de caractère invalide'); }
    const v = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
    if (v == null || !m.endsWith(';')) throw new Error(`XML : entité inconnue « ${m} »`);
    return v;
  });
}

/** Arbre d'un document XML ; lève une erreur (en français) s'il est mal formé. */
export function parseTree(text) {
  if (typeof text !== 'string') throw new Error('XML : texte attendu');
  if (text.length > LIMIT.chars) throw new Error('XML : partie trop lourde');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const root = { tag: '#doc', attrs: {}, children: [], text: '' }, stack = [root], n = text.length;
  let i = 0, nodes = 0;
  while (i < n) {
    const lt = text.indexOf('<', i), top = stack[stack.length - 1];
    if (lt < 0) { const t = text.slice(i); if (stack.length > 1) top.text += unescape(t); else if (t.trim()) throw new Error('XML : texte hors de l’élément racine'); break; }
    if (lt > i) { const t = text.slice(i, lt); if (stack.length > 1) top.text += unescape(t); else if (t.trim()) throw new Error('XML : texte hors de l’élément racine'); }
    i = lt;
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) throw new Error('XML : commentaire non fermé'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i + 9); if (e < 0) throw new Error('XML : CDATA non fermé'); top.text += text.slice(i + 9, e); i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e < 0) throw new Error('XML : instruction non fermée'); i = e + 2; continue; }
    if (text.startsWith('<!', i)) throw new Error('XML : déclaration DOCTYPE refusée');
    if (text[i + 1] === '/') {
      NAME.lastIndex = i + 2; const m = NAME.exec(text); if (!m) throw new Error('XML : balise fermante invalide');
      let j = NAME.lastIndex; while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== '>') throw new Error('XML : balise fermante mal formée');
      if (stack.length < 2 || top.tag !== m[0]) throw new Error(`XML : </${m[0]}> inattendue`);
      stack.pop(); i = j + 1; continue;
    }
    NAME.lastIndex = i + 1; const m = NAME.exec(text); if (!m) throw new Error('XML : balise invalide');
    if (stack.length === 1 && root.children.length) throw new Error('XML : un seul élément racine attendu');
    const el = { tag: m[0], attrs: {}, children: [], text: '' };
    let j = NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = j; const a = ATTR.exec(text); if (!a) break;
      if (Object.prototype.hasOwnProperty.call(el.attrs, a[1])) throw new Error(`XML : attribut « ${a[1]} » en double`);
      el.attrs[a[1]] = unescape(a[2] ?? a[3]); j = ATTR.lastIndex;
    }
    while (j < n && /\s/.test(text[j])) j++;
    let self = false; if (text[j] === '/') { self = true; j++; }
    if (text[j] !== '>') throw new Error(`XML : balise <${el.tag}> mal formée`);
    i = j + 1;
    if (++nodes > LIMIT.nodes) throw new Error('XML : trop d’éléments');
    top.children.push(el);
    if (!self) { stack.push(el); if (stack.length > LIMIT.depth) throw new Error('XML : imbrication trop profonde'); }
  }
  if (stack.length > 1) throw new Error(`XML : <${stack[stack.length - 1].tag}> non fermée`);
  if (root.children.length !== 1) throw new Error('XML : un seul élément racine attendu');
  return root.children[0];
}
export const kids = (n, tag) => (n ? n.children.filter(c => c.tag === tag) : []);
export const kid = (n, tag) => (n ? n.children.find(c => c.tag === tag) || null : null);
