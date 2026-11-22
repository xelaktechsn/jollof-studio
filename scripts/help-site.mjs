// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//
// Site d'aide : docs/GUIDE.md découpé en pages statiques dans site/aide/ (une page par section « ## », barre
// latérale, recherche côté navigateur). Aucune dépendance, aucun service extérieur : le Markdown du guide est
// converti ici (titres, listes imbriquées, tableaux, blocs de code, gras, italique, code, liens).
// Feuille et script : scripts/help/aide.css et aide.js, copiés tels quels ; polices et jetons : site/style.css.
// site/aide/ n'est pas versionné : le flux Pages (.github/workflows/pages.yml) le construit avant de publier.
//
//   node scripts/help-site.mjs            écrit site/aide/
//   node scripts/help-site.mjs --out DIR  écrit ailleurs (essais)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/xelaktechsn/jollof-studio';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Identifiant d'ancre ou nom de fichier : minuscules sans accents, tirets. */
export function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’'`«»"]/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'section';
}
/** Texte nu d'un fragment Markdown en ligne (index de recherche, titres). */
export function plain(s) {
  return String(s).replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[\s(«])\*([^*\s][^*]*)\*/g, '$1$2').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
/** Lien du guide → lien du site : un fichier du dépôt s'ouvre sur GitHub, le reste est gardé. */
function href(u) {
  if (/^(https?:|mailto:|#)/i.test(u)) return u;
  const p = path.posix.normalize(path.posix.join('docs', u));
  if (p.startsWith('..')) return REPO;
  let dir = /\/$/.test(u);
  try { dir = dir || fs.statSync(path.join(ROOT, p)).isDirectory(); } catch (e) { /* fichier absent : lien de fichier */ }
  return `${REPO}/${dir ? 'tree' : 'blob'}/main/${p.replace(/\/$/, '')}`;
}
/** Markdown en ligne → HTML. Le code est mis de côté d'abord : rien n'y est interprété. */
export function inline(src) {
  const keep = [];
  const hold = h => `\u0000${keep.push(h) - 1}\u0000`;
  let s = String(src).replace(/`([^`]+)`/g, (m, c) => hold(`<code>${esc(c)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const h = href(u.replace(/&amp;/g, '&')); return hold(`<a href="${esc(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ''}>`) + t + hold('</a>'); });
  s = s.replace(/(^|[\s(*])(https?:\/\/[^\s<)*]+[^\s<)*.,;:])/g, (m, a, u) => a + hold(`<a href="${u}" rel="noopener">${u}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(«])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
}

/**
 * Markdown (blocs) → { html, heads: [{ level, id, text }], chunks: [{ id, title, text }] }.
 * chunks : un morceau par sous-titre et par élément de liste de premier niveau, pour la recherche.
 */
export function render(md, ids = new Set()) {
  const lines = md.replace(/\r/g, '').split('\n'), out = [], heads = [], chunks = [];
  const uid = base => { let id = base, n = 2; while (ids.has(id)) id = `${base}-${n++}`; ids.add(id); return id; };
  let anchor = '', anchorTitle = '';
  const note = (text, id = anchor, title = anchorTitle) => { const t = plain(text); if (t) chunks.push({ id, title, text: t }); };
  let i = 0;
  const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  function list(indent) {
    const ordered = /^\s*\d+\.\s/.test(lines[i]);
    let h = ordered ? '<ol>' : '<ul>';
    const re = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/;
    while (i < lines.length) {
      const m = re.exec(lines[i]);
      if (!m || m[1].length < indent) break;
      if (m[1].length > indent) { h = h.replace(/<\/li>$/, '') + list(m[1].length) + '</li>'; continue; }
      let text = m[2]; i++;
      while (i < lines.length && lines[i].trim() && !re.test(lines[i]) && /^\s+/.test(lines[i]) && !/^\s*```/.test(lines[i])) text += ' ' + lines[i++].trim();
      let attr = '';
      if (indent === 0) {
        const lead = /^\*\*([^*]+)\*\*/.exec(text), title = lead ? plain(lead[1]).replace(/\s*:$/, '') : '';
        if (title) { const id = uid(slug(title)); attr = ` id="${id}"`; note(text, id, title); } else note(text);
      } else if (chunks.length) chunks[chunks.length - 1].text += ' ' + plain(text);
      h += `<li${attr}>${inline(text)}</li>`;
    }
    return h + (ordered ? '</ol>' : '</ul>');
  }
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^```\s*(\S*)/.exec(l))) {
      const body = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre tabindex="0"${m[1] ? ` data-lang="${esc(m[1])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = /^(#{2,6})\s+(.*)$/.exec(l))) {
      const level = m[1].length, text = plain(m[2]), id = uid(slug(text));
      heads.push({ level, id, text }); anchor = id; anchorTitle = text;
      out.push(`<h${level} id="${id}">${inline(m[2])}<a class="anchor" href="#${id}" aria-label="Lien vers « ${esc(text)} »">#</a></h${level}>`);
      i++; continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      for (const r of rows) note(r.join(' — '));
      out.push(`<div class="tableWrap" tabindex="0" role="region" aria-label="Tableau"><table><thead><tr>${head.map(c => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) { out.push(list(/^(\s*)/.exec(l)[1].length)); continue; }
    if (/^>\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      note(q.join(' ')); out.push(`<blockquote><p>${inline(q.join(' '))}</p></blockquote>`); continue;
    }
    if (/^<\w/.test(l)) { i++; continue; } // HTML brut (logo du dépôt) : pas dans l'aide
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*(?:[-*]|\d+\.)\s+|>\s?|\s*\|)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { para.push(lines[i++].trim()); }
    note(para.join(' ')); out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { html: out.join('\n'), heads, chunks };
}

/** Guide → pages : l'introduction (avant le premier « ## ») puis une page par « ## ». */
export function split(md) {
  const lines = md.replace(/\r/g, '').split('\n'), pages = [];
  let cur = { title: '', body: [] }, fence = false, docTitle = 'Aide';
  for (const l of lines) {
    if (/^```/.test(l)) fence = !fence;
    const h1 = !fence && /^#\s+(.*)$/.exec(l), h2 = !fence && /^##\s+(.*)$/.exec(l);
    if (h1) { docTitle = plain(h1[1]); continue; }
    if (h2) { pages.push(cur); cur = { title: plain(h2[1]), body: [] }; continue; }
    cur.body.push(l);
  }
  pages.push(cur);
  pages[0].title = 'Présentation';
  const used = new Set(['index']);
  for (const [n, p] of pages.entries()) {
    let s = n === 0 ? 'index' : slug(p.title), k = 2;
    while (n > 0 && used.has(s)) s = `${slug(p.title)}-${k++}`;
    used.add(s); p.slug = s; p.file = `${s}.html`;
  }
  return { docTitle, pages: pages.filter(p => p.body.join('').trim()) };
}

function page({ docTitle, pages, p, n, body, heads }) {
  const prev = pages[n - 1], next = pages[n + 1];
  const nav = pages.map(q => {
    const here = q === p, subs = here ? heads.filter(h => h.level === 3) : [];
    return `<li><a href="${q.file}"${here ? ' aria-current="page"' : ''}>${esc(q.title)}</a>${subs.length ? `<ul>${subs.map(h => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul>` : ''}</li>`;
  }).join('');
  const title = n === 0 ? `Aide — ${docTitle}` : `${p.title} — Aide Jollof Studio`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`Aide de Jollof Studio : ${p.title}.`)}">
<meta name="theme-color" content="#0b0e11">
<link rel="icon" href="../assets/img/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../style.css">
<link rel="stylesheet" href="aide.css">
</head>
<body class="aide">
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="nav solid" id="top">
  <div class="wrap navIn">
    <a class="brand" href="../" aria-label="Jollof Studio, accueil du site">
      <img src="../assets/img/icon.svg" alt="" width="34" height="34">
      <img class="wm" src="../assets/img/logo-dark.svg" alt="Jollof Studio" width="150" height="25">
    </a>
    <nav class="links" aria-label="Site" id="links">
      <a href="../">Accueil</a>
      <a href="index.html" aria-current="true">Aide</a>
      <a href="../#download">Télécharger</a>
      <a href="${REPO}">Code source</a>
    </nav>
    <div class="navEnd">
      <button type="button" class="menu" id="sideBtn" aria-controls="side" aria-expanded="false" aria-label="Sommaire et recherche"><span></span><span></span></button>
    </div>
  </div>
</header>
<div class="wrap aideIn">
  <aside class="side" id="side">
    <form class="search" role="search" id="search" action="index.html">
      <label for="q">Rechercher dans l’aide</label>
      <input type="search" id="q" name="q" placeholder="Rechercher…" autocomplete="off" spellcheck="false" aria-controls="results" aria-describedby="qHint">
      <span class="qHint" id="qHint">Touche / pour chercher, Échap pour effacer</span>
    </form>
    <div class="results" id="results" role="region" aria-live="polite" aria-label="Résultats de la recherche" hidden></div>
    <nav class="toc" id="toc" aria-label="Sommaire de l’aide"><ul>${nav}</ul></nav>
  </aside>
  <main class="doc" id="contenu" tabindex="-1">
    <p class="crumb"><a href="index.html">Aide</a>${n === 0 ? '' : ` <span aria-hidden="true">›</span> ${esc(p.title)}`}</p>
    <h1>${esc(n === 0 ? docTitle : p.title)}</h1>
${body}
    <nav class="pager" aria-label="Pages voisines">
      ${prev ? `<a class="prev" href="${prev.file}"><small>Précédent</small><span>${esc(prev.title)}</span></a>` : '<span></span>'}
      ${next ? `<a class="next" href="${next.file}"><small>Suivant</small><span>${esc(next.title)}</span></a>` : '<span></span>'}
    </nav>
    <p class="src">Cette aide est produite à partir de <a href="${REPO}/blob/main/docs/GUIDE.md" rel="noopener">docs/GUIDE.md</a>. © 2026 Mamadou Sarr · Xelaktech</p>
  </main>
</div>
<script src="search-index.js" defer></script>
<script src="aide.js" defer></script>
</body>
</html>
`;
}

/** Construit le site dans outDir ; rend { pages, entries } (nombre de pages et d'entrées de recherche). */
export function build(outDir = path.join(ROOT, 'site', 'aide'), guide = path.join(ROOT, 'docs', 'GUIDE.md')) {
  const { docTitle, pages } = split(fs.readFileSync(guide, 'utf8'));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const index = [];
  pages.forEach((p, n) => {
    const r = render(p.body.join('\n'));
    // Une entrée de recherche par ancre (sous-titre, élément de liste titré) ; le texte sans ancre va à la page.
    const by = new Map([['', { u: p.file, p: p.title, t: p.title, x: '' }]]);
    for (const c of r.chunks) {
      const k = c.id || '';
      if (!by.has(k)) by.set(k, { u: `${p.file}#${k}`, p: p.title, t: c.title || p.title, x: '' });
      const e = by.get(k); e.x += (e.x ? ' ' : '') + c.text;
    }
    index.push(...by.values());
    fs.writeFileSync(path.join(outDir, p.file), page({ docTitle, pages, p, n, body: r.html, heads: r.heads }));
  });
  fs.writeFileSync(path.join(outDir, 'search-index.js'), `window.AIDE_INDEX=${JSON.stringify(index).replace(/</g, '\\u003c')};\n`);
  for (const f of ['aide.css', 'aide.js']) fs.copyFileSync(path.join(ROOT, 'scripts', 'help', f), path.join(outDir, f));
  return { pages: pages.length, entries: index.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = process.argv.indexOf('--out'), out = o > 0 ? path.resolve(process.argv[o + 1]) : undefined;
  const r = build(out);
  console.log(`Aide : ${r.pages} pages, ${r.entries} entrées de recherche → ${path.relative(ROOT, out || path.join(ROOT, 'site', 'aide'))}/`);
}
