// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écran d'ouverture : le logo se monte comme un circuit qui se met sous tension. Des pistes arrivent des bords,
// l'icône apparaît et sa piste « J » se trace depuis sa pastille, une impulsion de courant la parcourt et la LED
// s'allume (avec le petit scintillement d'une vraie LED) ; puis les pistes du nom « Jollof Studio » se tracent et
// sa LED s'allume en dernier. Environ 1,2 s.
//
// Il ne retarde pas le démarrage : il s'affiche dès le premier module (boot.js), pendant que l'application se charge
// en parallèle, et disparaît quand l'animation est finie et que l'application a dessiné sa première image
// (événement « jollof:ready »). Un clic ou une touche abrège l'animation ; « réduire les animations » montre le logo
// fixe ; si l'application ne démarre pas, il s'efface de lui-même. Logo et couleurs : src/ui/brand.js (scripts/brand.mjs).
import './splash.css';
import { LOGO, WORDMARK } from './brand.js';

const NS = 'http://www.w3.org/2000/svg';
/** Vitesse de toute l'animation : elle finit à peu près quand l'application est prête (premier affichage ≈ 1,1 s). */
const K = 0.75;
/** Pistes décoratives du fond (repère 0 à 1000 × 0 à 600) : chacune arrive d'un bord en équerre et finit sur une pastille. */
const TRACES = [
  'M0 90H180L240 150H330', 'M0 300H120L170 250H290', 'M0 470H210L260 420H340', 'M1000 110H830L770 170H690',
  'M1000 300H880L840 340H720', 'M1000 500H800L750 450H660', 'M300 0V60L350 110V150', 'M700 600V540L650 490V450',
  'M520 0V40L560 80V120', 'M450 600V560L410 520V470'
];

export function showSplash() {
  if (typeof document === 'undefined' || !document.body || document.querySelector('.jsSplash')) return null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'jsSplash'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Jollof Studio');
  el.innerHTML = `<svg class="jsBg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${TRACES.map(d => `<path class="jsTr" d="${d}"/>`).join('')}</svg>
    <div class="jsGlow" aria-hidden="true"></div><div class="jsMark"><div class="jsIcon">${LOGO}</div><div class="jsWord">${WORDMARK}</div></div>`;
  document.body.appendChild(el);

  const anims = [], at = (node, frames, o) => { if (!node || !node.animate) return null; const a = node.animate(frames, { fill: 'both', easing: 'cubic-bezier(.3,.7,.2,1)', ...o, delay: (o.delay || 0) * K, duration: o.duration * K }); anims.push(a); return a; };
  /** Tracé progressif d'une piste (longueur réelle du chemin). */
  const draw = (path, delay, duration) => { const L = path.getTotalLength(); path.style.strokeDasharray = `${L} ${L}`; return at(path, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { delay, duration }); };
  /** Une LED : éteinte d'abord (cabochon sombre, sans halo), puis allumée à « delay » avec un scintillement. */
  function led(svg, delay) {
    const cs = svg.querySelectorAll('circle'), [halo, bulb, shine] = [cs[0], cs[1], cs[2]];
    if (!halo || !bulb) return;
    const off = document.createElementNS(NS, 'circle');
    for (const k of ['cx', 'cy', 'r']) off.setAttribute(k, bulb.getAttribute(k));
    off.setAttribute('class', 'jsOff'); bulb.after(off);
    const flash = document.createElementNS(NS, 'circle');
    for (const k of ['cx', 'cy']) flash.setAttribute(k, bulb.getAttribute(k));
    flash.setAttribute('r', String(+bulb.getAttribute('r') * 1.6)); flash.setAttribute('class', 'jsFlash'); halo.after(flash);
    if (reduce) { off.remove(); flash.remove(); return; }
    at(off, [{ opacity: 1 }, { opacity: 0.35, offset: 0.25 }, { opacity: 0.8, offset: 0.4 }, { opacity: 0 }], { delay, duration: 260, easing: 'linear' });
    at(halo, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.5)', offset: 0.45 }, { opacity: 1, transform: 'scale(1.1)' }], { delay, duration: 700 });
    at(flash, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 0.95, offset: 0.25 }, { opacity: 0, transform: 'scale(2.4)' }], { delay, duration: 620 });
    at(bulb, [{ filter: 'none' }, { filter: 'drop-shadow(0 0 10px #22d3ee)' }], { delay, duration: 300 });
    if (shine) at(shine, [{ opacity: 0 }, { opacity: 0.9 }], { delay: delay + 120, duration: 220 });
    for (const n of [halo, flash, off]) n.style.transformOrigin = `${bulb.getAttribute('cx')}px ${bulb.getAttribute('cy')}px`;
    for (const n of [halo, flash]) n.style.transformBox = 'view-box';
  }
  /** Impulsion de courant : un point lumineux qui court le long d'une piste. */
  function pulse(svg, path, delay, duration, r) {
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', String(r)); dot.setAttribute('class', 'jsPulse');
    path.after(dot);
    const L = path.getTotalLength(), frames = [];
    for (let k = 0; k <= 24; k++) { const p = path.getPointAtLength((L * k) / 24); frames.push({ transform: `translate(${p.x}px, ${p.y}px)`, opacity: k === 0 || k === 24 ? 0 : 1 }); }
    at(dot, frames, { delay, duration, easing: 'cubic-bezier(.5,0,.6,1)' });
  }

  const icon = el.querySelector('.jsIcon svg'), word = el.querySelector('.jsWord svg');
  try {
    const iconTrace = icon.querySelector('path[fill="none"]'), iconPad = icon.querySelector('path[fill-rule="evenodd"]');
    const wordTraces = [...word.querySelectorAll('path[fill="none"]')], wordPads = [...word.querySelectorAll('path[fill-rule="evenodd"]')];
    const wordLead = wordTraces.find(p => /^M626/.test(p.getAttribute('d'))) || wordTraces[wordTraces.length - 1];
    led(icon, 1000); led(word, 1420);
    if (!reduce) {
      // Pistes du fond : tracées depuis les bords, une pastille au bout, puis du courant qui y circule.
      el.querySelectorAll('.jsTr').forEach((p, i) => {
        draw(p, 60 * i, 700);
        const e = p.getPointAtLength(p.getTotalLength()), pad = document.createElementNS(NS, 'circle');
        pad.setAttribute('cx', e.x); pad.setAttribute('cy', e.y); pad.setAttribute('r', '5'); pad.setAttribute('class', 'jsPad'); p.after(pad);
        at(pad, [{ opacity: 0 }, { opacity: 1 }], { delay: 60 * i + 600, duration: 200 });
        if (i % 3 === 0) pulse(null, p, 650 + 90 * i, 650, 3.2);
      });
      // Lumière de mise sous tension derrière le logo, quand la première LED s'allume.
      at(el.querySelector('.jsGlow'), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.4 }, { opacity: 0.55, transform: 'scale(1.1)' }], { delay: 1000, duration: 900 });
      at(el.querySelector('.jsIcon'), [{ opacity: 0, transform: 'translateY(10px) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 380 });
      at(iconPad, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { delay: 160, duration: 260 });
      iconPad.style.transformOrigin = '468px 268.8px'; iconPad.style.transformBox = 'view-box';
      draw(iconTrace, 260, 560);
      pulse(icon, iconTrace, 760, 300, 26);
      at(el.querySelector('.jsWord'), [{ opacity: 0 }, { opacity: 1 }], { delay: 420, duration: 200 });
      wordTraces.forEach((p, i) => { if (p !== wordLead) draw(p, 480 + 220 * i, 700); });
      wordPads.forEach((p, i) => at(p, [{ opacity: 0 }, { opacity: 1 }], { delay: 700 + 300 * i, duration: 200 }));
      draw(wordLead, 1180, 200);
      pulse(word, wordLead, 1180, 240, 6);
    }
  } catch (e) { console.error(e); } // un logo qui ne s'anime pas ne doit jamais bloquer l'application

  let animDone = reduce, appReady = false, gone = false;
  const ANIM_MS = reduce ? 0 : Math.round(1650 * K);
  const end = () => {
    if (gone || !animDone || !appReady) return;
    gone = true; el.classList.add('out');
    const remove = () => el.remove();
    el.addEventListener('transitionend', remove, { once: true }); setTimeout(remove, 600); // repli sans transition
  };
  setTimeout(() => { animDone = true; end(); }, ANIM_MS);
  addEventListener('jollof:ready', () => { appReady = true; end(); }, { once: true });
  // Clic ou touche : l'animation s'achève tout de suite.
  const skip = () => { anims.forEach(a => { try { a.finish(); } catch (e) { /* déjà finie */ } }); animDone = true; end(); };
  el.addEventListener('pointerdown', skip);
  addEventListener('keydown', skip, { once: true, capture: true });
  // L'application ne démarre pas (erreur) : on la laisse voir au bout de 10 s.
  setTimeout(() => { animDone = appReady = true; end(); }, 10000);
  return el;
}
