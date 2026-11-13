// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Langue (français dans la page, anglais dans i18n.js), menu mobile, bouton « Copier », apparition des sections.
(() => {
  const EN = window.JOLLOF_EN || {};
  const nodes = [...document.querySelectorAll('[data-i18n]')];
  const FR = {};
  for (const n of nodes) FR[n.dataset.i18n] = n.textContent;
  FR.title = document.title;
  const meta = document.querySelector('meta[name="description"]');
  FR.description = meta.content;
  const video = document.querySelector('[data-video]');
  FR.videoLabel = video.getAttribute('aria-label');

  const store = {
    get() { try { return localStorage.getItem('jollof-site-lang'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('jollof-site-lang', v); } catch (e) { /* stockage indisponible */ } }
  };
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const initial = ['fr', 'en'].includes(fromUrl) ? fromUrl : store.get() || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');

  function setLang(lang, save) {
    const d = lang === 'en' ? EN : FR;
    document.documentElement.lang = lang;
    for (const n of nodes) { const v = d[n.dataset.i18n]; if (v != null) n.textContent = v; }
    document.title = d.title; meta.content = d.description;
    for (const img of document.querySelectorAll('[data-img]')) img.src = `assets/img/${img.dataset.img}-${lang}.jpg`;
    const src = `assets/video/jollof-${lang}.mp4`;
    if (!video.currentSrc.endsWith(src)) {
      video.poster = `assets/img/poster-${lang}.jpg`;
      video.querySelector('source').src = src;
      video.setAttribute('aria-label', d.videoLabel);
      video.load();
    }
    for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    if (save) {
      store.set(lang);
      const u = new URL(location.href); u.searchParams.set('lang', lang); history.replaceState(null, '', u);
    }
  }
  if (initial !== 'fr') setLang(initial, false);
  for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang, true));

  // Menu sur petit écran.
  const menu = document.querySelector('.menu'), links = document.getElementById('links');
  menu.addEventListener('click', () => { const open = links.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  links.addEventListener('click', e => { if (e.target.closest('a')) { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });

  // Copier les commandes du terminal.
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch (e) { return; }
      const lang = document.documentElement.lang, key = b.dataset.i18n;
      b.textContent = lang === 'en' ? EN.copied : 'Copié';
      setTimeout(() => { b.textContent = lang === 'en' ? EN[key] : FR[key]; }, 1500);
    });
  }

  // Barre de navigation opaque après défilement.
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('solid', scrollY > 12);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Apparition douce des rangées (désactivée si l'on réduit les animations).
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const els = document.querySelectorAll('.card, .row, .stats > div, .labs .two > *, .start .cols > *');
    els.forEach(el => el.classList.add('rise'));
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => io.observe(el));
  }
})();
