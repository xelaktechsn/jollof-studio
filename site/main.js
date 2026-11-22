// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Langue (français dans la page, anglais dans i18n.js), téléchargements (système du visiteur, dernière version),
// menu sur petit écran, bouton « Copier ». Rien d'autre : la page se lit sans script.
(() => {
  const EN = window.JOLLOF_EN || {};
  const REPO = 'xelaktechsn/jollof-studio';
  const $$ = s => [...document.querySelectorAll(s)];

  // ---------- Langue ----------
  // data-i18n : texte ; data-i18n-alt : texte de remplacement d'une image ; data-i18n-label : aria-label.
  const nodes = $$('[data-i18n]'), alts = $$('[data-i18n-alt]'), labels = $$('[data-i18n-label]');
  const FR = {};
  for (const n of nodes) if (!(n.dataset.i18n in FR)) FR[n.dataset.i18n] = n.textContent;
  for (const n of alts) FR[n.dataset.i18nAlt] = n.alt;
  for (const n of labels) if (!(n.dataset.i18nLabel in FR)) FR[n.dataset.i18nLabel] = n.getAttribute('aria-label');
  FR.title = document.title;
  const meta = document.querySelector('meta[name="description"]');
  FR.description = meta.content;
  let lang = 'fr';

  const store = {
    get() { try { return localStorage.getItem('jollof-site-lang'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('jollof-site-lang', v); } catch (e) { /* stockage indisponible */ } }
  };
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const initial = ['fr', 'en'].includes(fromUrl) ? fromUrl : store.get() || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');

  function setLang(l, save) {
    lang = l;
    const d = l === 'en' ? EN : FR, t = k => (d[k] != null ? d[k] : FR[k]);
    document.documentElement.lang = l;
    for (const n of nodes) n.textContent = t(n.dataset.i18n);
    for (const n of alts) n.alt = t(n.dataset.i18nAlt);
    for (const n of labels) n.setAttribute('aria-label', t(n.dataset.i18nLabel));
    document.title = t('title'); meta.content = t('description');
    // Captures d'écran : une par langue (assets/img/<nom>-fr.webp, <nom>-en.webp).
    for (const img of $$('[data-img]')) { const src = `assets/img/${img.dataset.img}-${l}.webp`; if (!img.src.endsWith(src)) img.src = src; }
    for (const a of $$('[data-zoom]')) a.href = `assets/img/${a.dataset.zoom}-${l}.webp`;
    for (const b of $$('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
    showSizes();
    if (save) {
      store.set(l);
      const u = new URL(location.href); u.searchParams.set('lang', l); history.replaceState(null, '', u);
    }
  }

  // ---------- Téléchargements ----------
  // Système du visiteur : sa rangée est marquée (« votre système »).
  const ua = navigator.userAgent || '', plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const os = /android|iphone|ipad/i.test(ua) ? null
    : /win/i.test(plat) || /Windows/.test(ua) ? 'windows'
      : /mac/i.test(plat) || /Mac OS X/.test(ua) ? 'mac'
        : /linux|x11|cros/i.test(plat + ' ' + ua) ? 'linux' : null;
  if (os) document.querySelector(`.osCard[data-os="${os}"]`)?.classList.add('is-mine');

  // Dernière version publiée : numéro et taille des fichiers. Sans réponse (hors ligne, limite de l'API), les liens
  // « latest/download » restent valables ; s'il n'y a encore aucune version, ils mènent à la page des versions.
  const sizes = {};
  function showSizes() {
    for (const a of $$('[data-asset]')) {
      const s = a.querySelector('[data-size]'), b = sizes[a.dataset.asset];
      if (s) s.textContent = b ? `${Math.round(b / 1e6)} ${lang === 'en' ? 'MB' : 'Mo'}` : '';
    }
  }
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => (r.status === 404 ? { none: true } : r.ok ? r.json() : null))
    .then(rel => {
      if (!rel) return;
      if (rel.none) {
        for (const a of $$('[data-asset]')) a.href = `https://github.com/${REPO}/releases`;
        return;
      }
      const names = new Set();
      for (const x of rel.assets || []) { sizes[x.name] = x.size; names.add(x.name); }
      for (const a of $$('.alt [data-asset]')) a.hidden = !names.has(a.dataset.asset);
      const v = document.querySelector('[data-ver]');
      v.querySelector('[data-ver-tag]').textContent = rel.tag_name;
      v.hidden = false;
      showSizes();
    })
    .catch(() => { /* hors ligne : liens directs */ });

  // ---------- Démarrage ----------
  if (initial !== 'fr') setLang(initial, false); else showSizes();
  for (const b of $$('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang, true));

  // Menu sur petit écran.
  const menu = document.querySelector('.menu'), links = document.getElementById('links');
  const closeMenu = () => { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
  menu.addEventListener('click', () => { const open = links.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  links.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && links.classList.contains('open')) { closeMenu(); menu.focus(); } });

  // Copier les commandes du terminal.
  for (const b of $$('[data-copy]')) {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch (e) { return; }
      const key = b.dataset.i18n;
      b.textContent = lang === 'en' ? EN.copied : 'Copié';
      setTimeout(() => { b.textContent = lang === 'en' ? EN[key] : FR[key]; }, 1500);
    });
  }
})();
