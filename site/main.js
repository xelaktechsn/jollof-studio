// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Langue (français dans la page, anglais dans i18n.js), téléchargements (système du visiteur, dernière version),
// animations électriques au défilement (portes logiques, courant), menu mobile, bouton « Copier ».
(() => {
  const EN = window.JOLLOF_EN || {};
  const REPO = 'xelaktechsn/jollof-studio';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = v => Math.max(0, Math.min(1, v));
  const NS = 'http://www.w3.org/2000/svg';

  // ---------- Langue ----------
  const nodes = [...document.querySelectorAll('[data-i18n]')];
  const FR = {};
  for (const n of nodes) FR[n.dataset.i18n] = n.textContent;
  FR.title = document.title;
  const meta = document.querySelector('meta[name="description"]');
  FR.description = meta.content;
  const video = document.querySelector('[data-video]');
  FR.videoLabel = video.getAttribute('aria-label');
  let lang = 'fr';

  const store = {
    get() { try { return localStorage.getItem('jollof-site-lang'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem('jollof-site-lang', v); } catch (e) { /* stockage indisponible */ } }
  };
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const initial = ['fr', 'en'].includes(fromUrl) ? fromUrl : store.get() || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');

  function setLang(l, save) {
    lang = l;
    const d = l === 'en' ? EN : FR;
    document.documentElement.lang = l;
    for (const n of nodes) { const v = d[n.dataset.i18n]; if (v != null) n.textContent = v; }
    document.title = d.title; meta.content = d.description;
    for (const img of document.querySelectorAll('[data-img]')) img.src = `assets/img/${img.dataset.img}-${l}.jpg`;
    const src = `assets/video/jollof-${l}.mp4`;
    if (!video.currentSrc.endsWith(src)) {
      video.poster = `assets/img/poster-${l}.jpg`;
      video.querySelector('source').src = src;
      video.setAttribute('aria-label', d.videoLabel);
      video.load();
    }
    for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
    showSizes();
    if (save) {
      store.set(l);
      const u = new URL(location.href); u.searchParams.set('lang', l); history.replaceState(null, '', u);
    }
  }

  // ---------- Téléchargements ----------
  // Système du visiteur : sa carte est mise en avant (« Votre système »).
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
    for (const a of document.querySelectorAll('[data-asset]')) {
      const s = a.querySelector('[data-size]'), b = sizes[a.dataset.asset];
      if (s) s.textContent = b ? `${Math.round(b / 1e6)} ${lang === 'en' ? 'MB' : 'Mo'}` : '';
    }
  }
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => (r.status === 404 ? { none: true } : r.ok ? r.json() : null))
    .then(rel => {
      if (!rel) return;
      if (rel.none) {
        for (const a of document.querySelectorAll('[data-asset]')) a.href = `https://github.com/${REPO}/releases`;
        return;
      }
      const names = new Set();
      for (const x of rel.assets || []) { sizes[x.name] = x.size; names.add(x.name); }
      for (const a of document.querySelectorAll('.alt [data-asset]')) a.hidden = !names.has(a.dataset.asset);
      const v = document.querySelector('[data-ver]');
      v.querySelector('[data-ver-tag]').textContent = rel.tag_name;
      v.hidden = false;
      showSizes();
    })
    .catch(() => { /* hors ligne : liens directs */ });

  // ---------- Portes logiques au défilement ----------
  // Chaque séparateur est une vraie porte : les entrées à 1 s'allument (à 0 elles restent éteintes), puis la porte,
  // puis la sortie, et la LED s'allume quand le courant y arrive. Tout suit la position de défilement.
  const GATES = {
    and: { ins: [1, 1], f: (a, b) => a & b, body: 'M0 40H40A30 30 0 0 1 40 100H0Z', inX: 0, outX: 70, eq: 'S = A · B' },
    or: { ins: [0, 1], f: (a, b) => a | b, body: 'M-8 40Q58 40 92 70Q58 100 -8 100Q12 70 -8 40Z', inX: 1, outX: 92, eq: 'S = A + B' },
    xor: { ins: [1, 0], f: (a, b) => a ^ b, body: 'M0 40Q66 40 100 70Q66 100 0 100Q20 70 0 40Z', extra: 'M-12 40Q8 70 -12 100', inX: 9, outX: 100, eq: 'S = A ⊕ B' },
    nand: { ins: [0, 1], f: (a, b) => 1 - (a & b), body: 'M0 40H36A30 30 0 0 1 36 100H0Z', bub: 72, inX: 0, outX: 78, eq: 'S = ¬(A · B)' },
    not: { ins: [0], f: a => 1 - a, body: 'M5 44L63 70L5 96Z', bub: 69, inX: 5, outX: 75, eq: 'S = ¬A' }
  };
  const gateEls = [...document.querySelectorAll('.gates[data-gate]')];
  const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  let gateW = 0;
  function wire(svg, d, on) {
    svgEl('path', { d, class: 'w' }, svg);
    if (!on) return null;
    const lit = svgEl('path', { d, class: 'lit', pathLength: '1' }, svg);
    const spark = svgEl('circle', { r: '5', class: 'spark' }, svg);
    return { lit, spark, len: lit.getTotalLength() };
  }
  function buildGates() {
    const W = innerWidth < 640 ? 640 : 1200;
    if (W === gateW) return;
    gateW = W;
    gateEls.forEach((host, n) => {
      const g = GATES[host.dataset.gate]; if (!g) return;
      host.innerHTML = '';
      const svg = svgEl('svg', { viewBox: `0 0 ${W} 150`, preserveAspectRatio: 'xMidYMid meet' }, host);
      const defs = svgEl('defs', {}, svg), rg = svgEl('radialGradient', { id: `gHalo${n}` }, defs);
      svgEl('stop', { offset: '0', 'stop-color': '#22d3ee', 'stop-opacity': '.7' }, rg);
      svgEl('stop', { offset: '.4', 'stop-color': '#22d3ee', 'stop-opacity': '.22' }, rg);
      svgEl('stop', { offset: '1', 'stop-color': '#22d3ee', 'stop-opacity': '0' }, rg);
      const P = W < 1200 ? 60 : 70, gx = W / 2 - 50, ledX = W - P;
      const ys = g.ins.length === 1 ? [70] : [60, 80], padY = g.ins.length === 1 ? [70] : [26, 114];
      const out = g.f(...g.ins);
      const ins = g.ins.map((bit, i) => {
        const y = ys[i], py = padY[i];
        const d = py === y ? `M${P} ${y}H${gx + g.inX}` : `M${P} ${py}H${gx - 120}L${gx - 120 + Math.abs(py - y)} ${y}H${gx + g.inX}`;
        const w = wire(svg, d, bit === 1);
        const pad = svgEl('circle', { cx: P, cy: py, r: '9', class: 'pad' }, svg);
        svgEl('text', { x: P - 40, y: py + 7, class: 'lbl' }, svg).textContent = 'AB'[i];
        const t = svgEl('text', { x: P + 18, y: py - 12, class: 'bit' }, svg); t.textContent = String(bit);
        return { w, pad, t, bit };
      });
      const gate = svgEl('g', { transform: `translate(${gx} 0)` }, svg);
      if (g.extra) svgEl('path', { d: g.extra, class: 'extra' }, gate);
      svgEl('path', { d: g.body, class: 'body' }, gate);
      if (g.bub) svgEl('circle', { cx: g.bub, cy: 70, r: '6', class: 'bub' }, gate);
      svgEl('text', { x: 50, y: 140, class: 'eq' }, gate).textContent = g.eq;
      const ox = gx + g.outX, mid = Math.round((ox + ledX) / 2);
      const o = wire(svg, `M${ox} 70H${mid}L${mid + 30} 40H${ledX - 13}`, out === 1);
      svgEl('circle', { cx: ledX, cy: 40, r: '34', class: 'halo', fill: `url(#gHalo${n})` }, svg);
      svgEl('circle', { cx: ledX, cy: 40, r: '11', class: 'led' }, svg);
      svgEl('text', { x: ledX - 44, y: 26, class: 'bit' }, svg).textContent = `S=${out}`;
      host._g = { ins, o, out, p: -1 };
    });
    updateGates(true);
  }
  function draw(w, a) {
    if (!w) return;
    w.lit.style.strokeDashoffset = String(1 - a);
    const live = a > 0.01 && a < 0.99;
    w.spark.style.opacity = live ? '1' : '0';
    if (live) { const pt = w.lit.getPointAtLength(w.len * a); w.spark.setAttribute('cx', pt.x); w.spark.setAttribute('cy', pt.y); }
  }
  function updateGates(force) {
    const H = innerHeight;
    for (const host of gateEls) {
      const s = host._g; if (!s) continue;
      const r = host.getBoundingClientRect();
      if (!force && (r.bottom < -200 || r.top > H + 200)) continue;
      // Début quand la porte entre en bas de l'écran, fin quand elle passe aux deux cinquièmes.
      const p = reduce ? 1 : clamp((H * 0.98 - r.top) / (H * 0.58));
      if (!force && Math.abs(p - s.p) < 0.002) continue;
      s.p = p;
      const a = clamp(p / 0.4), o = clamp((p - 0.5) / 0.36);
      for (const i of s.ins) { draw(i.w, a); i.pad.classList.toggle('on', i.bit === 1 && p > 0.02); i.t.classList.toggle('on', i.bit === 1 && p > 0.02); }
      host.classList.toggle('g-on', p >= 0.42 && s.out === 1);
      draw(s.o, o);
      host.classList.toggle('l-on', p >= 0.88 && s.out === 1);
    }
  }

  // ---------- Courant sous la barre de navigation ----------
  const flow = document.querySelector('.flow i');
  const nav = document.querySelector('.nav');
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (flow) flow.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max) : 0})`;
      nav.classList.toggle('solid', scrollY > 12);
      updateGates(false);
    });
  }

  // ---------- Courant dans les pistes de l'accroche ----------
  if (!reduce) {
    document.querySelectorAll('.traces path').forEach((p, i) => {
      if (i % 2) return;
      const s = p.cloneNode(); s.setAttribute('class', 'spark'); s.setAttribute('pathLength', '1000');
      s.style.setProperty('--d', `${1.8 + i * 0.55}s`); s.style.animationDuration = `${2.6 + (i % 3) * 0.7}s`;
      p.after(s);
    });
  }

  // ---------- Démarrage ----------
  buildGates();
  if (initial !== 'fr') setLang(initial, false); else showSizes();
  for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang, true));
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { buildGates(); onScroll(); }, { passive: true });
  onScroll();

  // Menu sur petit écran.
  const menu = document.querySelector('.menu'), links = document.getElementById('links');
  menu.addEventListener('click', () => { const open = links.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  links.addEventListener('click', e => { if (e.target.closest('a')) { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });

  // Copier les commandes du terminal.
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch (e) { return; }
      const key = b.dataset.i18n;
      b.textContent = lang === 'en' ? EN.copied : 'Copié';
      setTimeout(() => { b.textContent = lang === 'en' ? EN[key] : FR[key]; }, 1500);
    });
  }

  // Apparition douce des rangées (désactivée si l'on réduit les animations).
  if ('IntersectionObserver' in window && !reduce) {
    const els = document.querySelectorAll('.card, .row, .stats > div, .labs .two > *, .start .cols > *, .osCard');
    els.forEach(el => el.classList.add('rise'));
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => io.observe(el));
  }
})();
