// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Site d'aide : recherche dans l'index (search-index.js, window.AIDE_INDEX : { u: adresse, p: page, t: titre, x: texte }),
// sans accents ni majuscules, tous les mots demandés ; sommaire repliable sur petit écran. Aucun service extérieur.
(() => {
  const $ = s => document.querySelector(s);
  const q = $('#q'), results = $('#results'), toc = $('#toc'), side = $('#side'), sideBtn = $('#sideBtn');
  const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let idx = null;
  const index = () => idx || (idx = (window.AIDE_INDEX || []).map(e => ({ e, t: fold(e.t), x: fold(e.x) })));
  // fold() garde la longueur (NFD puis retrait des diacritiques sur des caractères précomposés) sauf ligatures : on
  // surligne donc dans le texte d'origine aux mêmes positions quand les longueurs concordent.
  function mark(text, words) {
    const f = fold(text); if (f.length !== text.length) return esc(text);
    const spans = [];
    for (const w of words) { let i = -1; while ((i = f.indexOf(w, i + 1)) >= 0) spans.push([i, i + w.length]); }
    spans.sort((a, b) => a[0] - b[0]);
    let out = '', at = 0;
    for (const [a, b] of spans) { if (a < at) continue; out += esc(text.slice(at, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; at = b; }
    return out + esc(text.slice(at));
  }
  function excerpt(text, words) {
    const f = fold(text); let at = -1;
    for (const w of words) { const i = f.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) at = 0;
    const a = Math.max(0, at - 50), b = Math.min(text.length, at + 130);
    return (a ? '… ' : '') + text.slice(a, b).trim() + (b < text.length ? ' …' : '');
  }
  function search(raw) {
    const words = fold(raw).split(/[^a-z0-9]+/).filter(w => w.length > 1);
    if (!words.length) { results.hidden = true; results.innerHTML = ''; toc.hidden = false; return; }
    const hits = [];
    for (const it of index()) {
      let score = 0;
      for (const w of words) {
        const inT = it.t.indexOf(w), inX = it.x.indexOf(w);
        if (inT < 0 && inX < 0) { score = 0; break; }
        score += (inT >= 0 ? (inT === 0 ? 12 : 8) : 0) + (inX >= 0 ? 2 : 0) + (new RegExp('\\b' + w + '\\b').test(it.x) ? 1 : 0);
      }
      if (score) hits.push([score, it.e]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    const top = hits.slice(0, 30);
    results.hidden = false; toc.hidden = true;
    results.innerHTML = `<p>${hits.length ? (hits.length === 1 ? '1 résultat' : `${hits.length} résultats`) + (hits.length > top.length ? `, les ${top.length} premiers affichés` : '') : 'Aucun résultat. Essayez un autre mot.'}</p>`
      + (top.length ? `<ol>${top.map(([, e]) => `<li><a href="${esc(e.u)}"><small>${esc(e.p)}</small><b>${mark(e.t, words)}</b>${e.x ? `<span>${mark(excerpt(e.x, words), words)}</span>` : ''}</a></li>`).join('')}</ol>` : '');
  }
  if (q) {
    let t = 0;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(q.value), 80); });
    $('#search').addEventListener('submit', e => { e.preventDefault(); search(q.value); const a = results.querySelector('a'); if (a) a.focus(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; search(''); }
      else if (e.key === 'ArrowDown') { const a = results.querySelector('a'); if (a) { e.preventDefault(); a.focus(); } }
    });
    results.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
      const as = [...results.querySelectorAll('a')], i = as.indexOf(document.activeElement);
      e.preventDefault();
      if (e.key === 'Escape' || (e.key === 'ArrowUp' && i <= 0)) q.focus(); else (as[i + (e.key === 'ArrowDown' ? 1 : -1)] || as[i]).focus();
    });
    // Un résultat de la page courante : l'ancre change sans rechargement, on rend le sommaire.
    results.addEventListener('click', e => { if (e.target.closest('a') && side) { side.classList.remove('open'); if (sideBtn) sideBtn.setAttribute('aria-expanded', 'false'); } });
    addEventListener('keydown', e => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); q.select(); }
    });
    const start = new URLSearchParams(location.search).get('q');
    if (start) { q.value = start; search(start); }
  }
  if (sideBtn && side) sideBtn.addEventListener('click', () => { const on = side.classList.toggle('open'); sideBtn.setAttribute('aria-expanded', String(on)); });
})();
