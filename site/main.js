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

  // ---------- Thème : celui du système, sauf choix du visiteur (gardé) ----------
  const root = document.documentElement, themeBtn = document.getElementById('themeBtn'), mq = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : mq.matches);
  const paintTheme = () => { themeBtn.setAttribute('aria-pressed', String(isDark())); const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = isDark() ? '#0f1114' : '#ffffff'; };
  themeBtn.addEventListener('click', () => { const t = isDark() ? 'light' : 'dark'; root.dataset.theme = t; try { localStorage.setItem('jollof-site-theme', t); } catch (e) { /* stockage indisponible */ } paintTheme(); });
  mq.addEventListener('change', paintTheme); paintTheme();

  // ---------- Retour en haut, ombre de la barre ----------
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const toTop = document.getElementById('toTop'), nav = document.querySelector('.nav');
  const goTop = e => { e.preventDefault(); scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' }); history.replaceState(null, '', location.pathname + location.search); };
  toTop.hidden = false; toTop.addEventListener('click', goTop);
  for (const a of $$('a[href="#top"]')) a.addEventListener('click', goTop);
  let tick = false;
  const onScroll = () => { tick = false; const y = scrollY; toTop.classList.toggle('on', y > 700); toTop.tabIndex = y > 700 ? 0 : -1; nav.classList.toggle('scrolled', y > 8); };
  addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll();

  // ---------- Apparition des figures (une fois), illustration qui suit le pointeur ----------
  root.classList.add('js');
  const rv = $$('main figure:not(.heroFig), main table');
  for (const f of rv) { f.classList.add('rv'); [...f.querySelectorAll('.pin')].forEach((p, i) => p.style.setProperty('--i', i)); }
  if ('IntersectionObserver' in window && !calm.matches) {
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (const f of rv) io.observe(f);
  } else for (const f of rv) f.classList.add('in');
  const art = document.getElementById('heroArt'), hero = document.querySelector('.hero');
  if (art && matchMedia('(hover: hover) and (pointer: fine)').matches && !calm.matches) {
    const img = art.querySelector('img'); let raf = 0, mx = 0, my = 0;
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; img.style.setProperty('--px', (mx * -14).toFixed(1) + 'px'); img.style.setProperty('--py', (my * -10).toFixed(1) + 'px'); img.style.setProperty('--rz', (mx * 1.2).toFixed(2) + 'deg'); });
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { img.style.setProperty('--px', '0px'); img.style.setProperty('--py', '0px'); img.style.setProperty('--rz', '0deg'); });
  }

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
