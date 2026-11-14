// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : les éléments du plan de travail (symboles dessinés d'après les conventions de la norme ISO 1219, à
// notre façon), leurs orifices et leurs réglages. Coordonnées en pas de grille (G pixels) ; un élément a son origine
// en haut à gauche. Les orifices portent leur numéro ISO : 1 alimentation, 2 et 4 utilisation, 3 et 5 échappement,
// 12 et 14 pilotage. Le comportement (positions, pression, vérins) est dans sim.js.
import { tl } from '../i18n/index.js';

export const G = 10;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const line = (x1, y1, x2, y2, cls = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${cls ? ` class="${cls}"` : ''}/>`;
const txt = (x, y, t, cls = 'pnTxt', anchor = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(t)}</text>`;
/** Flèche de passage dans une case de distributeur, de (x1, y1) vers (x2, y2). */
function arrow(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 5, w = 3;
  const bx = x2 - h * Math.cos(a), by = y2 - h * Math.sin(a), px = -Math.sin(a) * w, py = Math.cos(a) * w;
  return `${line(x1, y1, bx, by)}<path class="pnFill" d="M${x2} ${y2} L${bx + px} ${by + py} L${bx - px} ${by - py} Z"/>`;
}
/** Orifice obturé dans une case : un trait et sa barre. */
const blocked = (x, y, up) => line(x, y, x, y + (up ? -7 : 7)) + line(x - 4, y + (up ? -7 : 7), x + 4, y + (up ? -7 : 7));
/** Ressort de rappel (zigzag) entre x0 et x1, à la hauteur y. */
function spring(x0, x1, y) {
  const n = 5, d = (x1 - x0) / n; let p = `M${x0} ${y}`;
  for (let i = 0; i < n; i++) p += ` L${x0 + d * (i + 0.5)} ${y + (i % 2 ? 6 : -6)}`;
  return `<path class="pnStroke" d="${p} L${x1} ${y}"/>`;
}
/** Commande d'un distributeur, dessinée dans une zone de 2 pas (x0 : bord collé aux cases ; side : -1 à gauche, 1 à droite). */
function actuator(kind, x0, side, h, label, on) {
  const x = side < 0 ? x0 - 2 * G : x0, w = 2 * G, mid = h / 2;
  if (kind === 'spring') return spring(x, x + w, mid);
  if (kind === 'sol') {
    // Électroaimant : un rectangle barré d'une oblique ; son repère (Y1…) au-dessus.
    const rx = side < 0 ? x + 4 : x + 4;
    return `<rect class="pnBox${on ? ' on' : ''}" x="${rx}" y="${mid - 7}" width="12" height="14"/>${line(rx, mid + 7, rx + 12, mid - 7)}${line(side < 0 ? x + 16 : x0, mid, side < 0 ? x0 : x + 4, mid)}${label ? txt(rx + 6, mid - 10, label, 'pnTag' + (on ? ' on' : '')) : ''}`;
  }
  if (kind === 'push') {
    // Bouton poussoir : une tige et un champignon.
    const bx = side < 0 ? x + 4 : x + w - 4;
    return `${line(bx, mid, side < 0 ? x0 : x0 + 0, mid)}<path class="pnStroke${on ? ' on' : ''}" d="M${bx} ${mid - 8} Q${bx + side * -6} ${mid} ${bx} ${mid + 8}"/>${line(bx, mid - 8, bx, mid + 8)}`;
  }
  if (kind === 'pilot' || kind === 'tempo') {
    // Pilotage pneumatique : un triangle et la ligne de pilotage (en tirets) vers l'orifice 12 ou 14. Temporisateur : le
    // pilotage passe par un réducteur (flèche oblique) qui remplit lentement un petit réservoir, d'où le retard.
    if (kind === 'tempo') {
      const tx = side < 0 ? x + 12 : x + 8;
      const jx = side < 0 ? x + 4 : x + w - 4, rx = side < 0 ? x + 8 : x + w - 8; // jonction du réservoir, réducteur
      return `<path class="pnStroke${on ? ' on' : ''}" d="M${tx} ${mid - 5} L${tx + side * -6} ${mid} L${tx} ${mid + 5} Z"/>${line(side < 0 ? x : x + w, mid, tx, mid, 'pnDash')}`
        + `${line(jx, mid, jx, mid + 9, 'pnDash')}<rect class="pnBox" x="${jx - 5}" y="${mid + 9}" width="10" height="7" rx="3"/>` // réservoir
        + `<path class="pnStroke" d="M${rx - 1} ${mid - 3.5} Q${rx + 1.5} ${mid} ${rx - 1} ${mid + 3.5} M${rx + 3} ${mid - 3.5} Q${rx + 0.5} ${mid} ${rx + 3} ${mid + 3.5}"/>`; // étranglement (réducteur)
    }
    const tx = side < 0 ? x + 12 : x + 8;
    return `<path class="pnStroke${on ? ' on' : ''}" d="M${tx} ${mid - 5} L${tx + side * -6} ${mid} L${tx} ${mid + 5} Z"/>${line(side < 0 ? x : x + w, mid, tx, mid, 'pnDash')}`;
  }
  if (kind === 'roller') {
    // Galet de fin de course : une tige et sa roulette, poussées par la came de la tige d'un vérin ; repère (a1…) au-dessus.
    const rx = side < 0 ? x + 6 : x + w - 6;
    return `${line(side < 0 ? rx + 5 : x0, mid, side < 0 ? x0 : rx - 5, mid)}<circle class="pnStroke${on ? ' on' : ''}" cx="${rx}" cy="${mid}" r="5"/>${label ? txt(rx, mid - 9, label, 'pnTag' + (on ? ' on' : '')) : ''}`;
  }
  return '';
}
/**
 * Cadran d'un temporisateur, au-dessus de sa commande : le retard réglé ; pendant la simulation, le temps écoulé
 * remplit le cadran et le texte donne le temps restant (« fini » une fois le distributeur basculé).
 */
function timerBadge(P, s) {
  const d = delayOf(P), t = s ? Math.min(d, s.tm || 0) : 0, k = t / d, cx = 10, cy = -14, r = 8;
  const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const a = k * 2 * Math.PI, ex = cx + r * Math.sin(a), ey = cy - r * Math.cos(a);
  const pie = k >= 0.999 ? `<circle class="pnTimerFill" cx="${cx}" cy="${cy}" r="${r}"/>` : k > 0 ? `<path class="pnTimerFill" d="M${cx} ${cy} L${cx} ${cy - r} A${r} ${r} 0 ${k > 0.5 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)} Z"/>` : '';
  const label = !s || !t ? `${fmt(d)} s` : k >= 0.999 ? tl('{0} s · fini', fmt(d)) : tl('{0} s / {1} s', fmt(t), fmt(d));
  return `<g class="pnTimer${s && t > 0 ? (k >= 0.999 ? ' done' : ' run') : ''}"><circle class="pnTimerFace" cx="${cx}" cy="${cy}" r="${r}"/>${pie}${line(cx, cy, cx, cy - r + 2.5)}${line(cx, cy, cx + 4, cy)}${txt(cx + 12, cy + 4, label, 'pnSub pnTimerTxt', 'start')}</g>`;
}
/** Retard d'un temporisateur (s), borné. */
export const delayOf = P => Math.max(0.1, Math.min(600, +P.delay || 3));
/** Repère d'un galet : vérin et fin de course (a0 tige rentrée, a1 tige sortie), d'après la came choisie. */
export const camText = P => (P.cam ? `${String(P.cam).toLowerCase()}${P.end === '0' ? '0' : '1'}` : '');
/** Vérin qui actionne un galet : par identifiant, sinon par repère (sans tenir compte de la casse). */
export function camTarget(els, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase(), cyl = e => e.type === 'cyl1' || e.type === 'cyl2';
  return els.find(e => cyl(e) && e.id.toLowerCase() === r) || els.find(e => cyl(e) && String((e.p && e.p.label) || '').toLowerCase() === r) || null;
}

/* ---------- Éléments ---------- */
// label : repère de l'élément sur le schéma (1V1, 1S1… selon l'usage de la norme ISO 1219), affiché par tagOf sous le
// symbole, à droite des échappements : les orifices sont fixes, le tiroir glisse au-dessus du repère sans le quitter.
// cam, end : galet (act « roller ») actionné par le vérin cam en fin de course end ('1' tige sortie, '0' tige rentrée).
// delay : retard d'un temporisateur (act « tempo »), en secondes.
const V32 = { act: 'push', normal: 'nc', coil: '', cam: '', end: '1', label: '', delay: 3 };
const V52 = { left: 'sol', right: 'spring', coilL: '', coilR: '', label: '' };
const V53 = { left: 'sol', right: 'sol', coilL: '', coilR: '', center: 'closed', label: '' };
const CYL = { time: 1, s0: '', s1: '', label: '', bore: 25, rod: 10, stroke: 100, mass: 1, load: 0 };

/**
 * type → { name(), cat, size(el) → [w, h] (pas), ports(el) → [{ id, x, y, dir, exhaust? }], props, draw(el, s) → SVG }.
 * s : état de simulation de l'élément ({ pos, x, press(port), on(port) }) ou null hors simulation.
 */
export const DEFS = {
  supply: {
    name: () => tl('Source d’air comprimé'), cat: 'src', props: { bar: 6 },
    size: () => [4, 4], ports: () => [{ id: '1', x: 2, y: 0, dir: 'up' }],
    draw: (el) => `<circle class="pnBox" cx="20" cy="26" r="11"/><path class="pnStroke" d="M14 30 L20 20 L26 30 Z"/>${line(20, 0, 20, 15)}${txt(20, 50, tl('{0} bar', (el.p && el.p.bar) || 6), 'pnSub')}`
  },
  frl: {
    name: () => tl('Unité de conditionnement (FRL)'), cat: 'src', props: {},
    size: () => [6, 4], ports: () => [{ id: '1', x: 0, y: 2, dir: 'left' }, { id: '2', x: 6, y: 2, dir: 'right' }],
    draw: () => `<rect class="pnBox pnDashBox" x="4" y="4" width="52" height="32"/>${line(0, 20, 12, 20)}${line(48, 20, 60, 20)}<path class="pnStroke" d="M12 20 L19 13 L26 20 L19 27 Z"/>${line(13, 20, 25, 20, 'pnDash')}${line(26, 20, 34, 20)}<rect class="pnBox" x="34" y="12" width="10" height="16"/>${line(36, 26, 42, 14)}<circle class="pnBox" cx="52" cy="11" r="4"/>${line(48, 20, 44, 20)}${txt(30, 46, 'FRL', 'pnSub')}`
  },
  v32: {
    name: () => tl('Distributeur 3/2'), cat: 'valve', props: V32, tag: [98, 52],
    size: () => [12, 4],
    ports(el) {
      const p = [{ id: '2', x: 8, y: 0, dir: 'up' }, { id: '1', x: 7, y: 4, dir: 'down' }, { id: '3', x: 9, y: 4, dir: 'down', exhaust: true }];
      if (props(el).act === 'pilot' || props(el).act === 'tempo') p.push({ id: '12', x: 0, y: 2, dir: 'left' });
      return p;
    },
    draw(el, s) {
      const P = props(el), pos = s ? s.pos : 0, no = P.normal === 'no';
      // Case de gauche (commandée) puis case de droite (repos, au contact du ressort) ; orifices sur la case de repos.
      const caseOf = (x0, act) => {
        const pass = no ? !act : act; // 1 → 2 ouvert ?
        return `<rect class="pnBox" x="${x0}" y="0" width="40" height="40"/>` + (pass
          ? arrow(x0 + 10, 40, x0 + 20, 0) + blocked(x0 + 30, 40, true)
          : arrow(x0 + 20, 0, x0 + 30, 40) + blocked(x0 + 10, 40, true));
      };
      const body = caseOf(20, true) + caseOf(60, false) + actuator(P.act, 20, -1, 40, P.act === 'sol' ? P.coil : P.act === 'roller' ? camText(P) : '', s && pos === 1) + actuator('spring', 100, 1, 40, '', false);
      return `<g class="pnShift" transform="translate(${pos ? 40 : 0} 0)">${body}</g>${exhaustMark(90, 40)}${P.act === 'tempo' ? timerBadge(P, s) : ''}`;
    }
  },
  v52: {
    name: () => tl('Distributeur 5/2'), cat: 'valve', props: V52, tag: [140, 52],
    size: () => [16, 4],
    ports(el) {
      const P = props(el), p = [{ id: '4', x: 9, y: 0, dir: 'up' }, { id: '2', x: 13, y: 0, dir: 'up' }, { id: '5', x: 9, y: 4, dir: 'down', exhaust: true }, { id: '1', x: 11, y: 4, dir: 'down' }, { id: '3', x: 13, y: 4, dir: 'down', exhaust: true }];
      if (P.left === 'pilot') p.push({ id: '14', x: 0, y: 2, dir: 'left' });
      if (P.right === 'pilot') p.push({ id: '12', x: 16, y: 2, dir: 'right' });
      return p;
    },
    draw(el, s) {
      const P = props(el), pos = s ? s.pos : 0;
      const box = x0 => `<rect class="pnBox" x="${x0}" y="0" width="60" height="40"/>`;
      // Case commandée (1 → 4, 2 → 3, 5 obturé) et case de repos (1 → 2, 4 → 5, 3 obturé).
      const act = box(20) + arrow(50, 40, 30, 0) + arrow(70, 0, 70, 40) + blocked(30, 40, true);
      const rest = box(80) + arrow(110, 40, 130, 0) + arrow(90, 0, 90, 40) + blocked(130, 40, true);
      const left = actuator(P.left, 20, -1, 40, P.left === 'sol' ? P.coilL : '', s && pos === 1);
      const right = actuator(P.right, 140, 1, 40, P.right === 'sol' ? P.coilR : '', s && pos === 0 && P.right !== 'spring' && s.rightOn);
      return `<g class="pnShift" transform="translate(${pos ? 60 : 0} 0)">${act}${rest}${left}${right}</g>${exhaustMark(90, 40)}${exhaustMark(130, 40)}`;
    }
  },
  v53: {
    name: () => tl('Distributeur 5/3'), cat: 'valve', props: V53, tag: [140, 52],
    size: () => [22, 4],
    ports(el) {
      const P = props(el), p = [{ id: '4', x: 9, y: 0, dir: 'up' }, { id: '2', x: 13, y: 0, dir: 'up' }, { id: '5', x: 9, y: 4, dir: 'down', exhaust: true }, { id: '1', x: 11, y: 4, dir: 'down' }, { id: '3', x: 13, y: 4, dir: 'down', exhaust: true }];
      if (P.left === 'pilot') p.push({ id: '14', x: 0, y: 2, dir: 'left' });
      if (P.right === 'pilot') p.push({ id: '12', x: 22, y: 2, dir: 'right' });
      return p;
    },
    draw(el, s) {
      const P = props(el), pos = s ? s.pos : 0;
      const box = x0 => `<rect class="pnBox" x="${x0}" y="0" width="60" height="40"/>`;
      // Trois cases : commandée à gauche (1 → 4, 2 → 3), centre (selon la version), commandée à droite (1 → 2, 4 → 5).
      const left = box(20) + arrow(50, 40, 30, 0) + arrow(70, 0, 70, 40) + blocked(30, 40, true);
      const mid = box(80) + (P.center === 'exhaust' ? arrow(90, 0, 90, 40) + arrow(130, 0, 130, 40) + blocked(110, 40, true)
        : P.center === 'pressure' ? arrow(110, 40, 90, 0) + arrow(110, 40, 130, 0) + blocked(90, 40, true) + blocked(130, 40, true)
          : blocked(90, 0, false) + blocked(130, 0, false) + blocked(90, 40, true) + blocked(110, 40, true) + blocked(130, 40, true));
      const right = box(140) + arrow(170, 40, 190, 0) + arrow(150, 0, 150, 40) + blocked(190, 40, true);
      // Ressorts de centrage sous chaque commande.
      const acts = actuator(P.left, 20, -1, 26, P.left === 'sol' ? P.coilL : '', s && pos === 1) + actuator(P.right, 200, 1, 26, P.right === 'sol' ? P.coilR : '', s && pos === -1) + spring(3, 17, 34) + spring(203, 217, 34);
      return `<g class="pnShift" transform="translate(${pos === 1 ? 60 : pos === -1 ? -60 : 0} 0)">${left}${mid}${right}${acts}</g>${exhaustMark(90, 40)}${exhaustMark(130, 40)}`;
    }
  },
  pswitch: {
    name: () => tl('Pressostat'), cat: 'flow', props: { sensor: '', bar: 3 },
    size: () => [4, 4], ports: () => [{ id: '1', x: 2, y: 4, dir: 'down' }],
    draw(el, s) {
      const P = props(el), on = s && s.closed;
      // Capteur de pression à contact : la membrane pousse le contact quand la pression atteint le seuil.
      return `<rect class="pnBox${on ? ' on' : ''}" x="6" y="6" width="28" height="22"/>${line(20, 28, 20, 40)}${line(10, 20, 18, 20)}${line(22, 20, 30, 20)}${line(18, 20, on ? 22 : 23, on ? 20 : 13, on ? 'pnStroke on' : '')}<path class="pnStroke" d="M14 24 L26 24"/>`
        + `${P.sensor ? txt(20, 2, P.sensor, 'pnTag' + (on ? ' on' : '')) : ''}${txt(38, 26, `≥ ${String(P.bar).replace('.', ',')} bar`, 'pnSub', 'start')}`;
    }
  },
  cyl1: {
    name: () => tl('Vérin simple effet'), cat: 'cyl', props: CYL,
    size: () => [17, 4], ports: () => [{ id: '1', x: 1, y: 4, dir: 'down' }],
    draw: (el, s) => cylinder(el, s, false)
  },
  cyl2: {
    name: () => tl('Vérin double effet'), cat: 'cyl', props: CYL,
    size: () => [17, 4], ports: () => [{ id: '1', x: 1, y: 4, dir: 'down' }, { id: '2', x: 8, y: 4, dir: 'down' }],
    draw: (el, s) => cylinder(el, s, true)
  },
  flowctl: {
    name: () => tl('Réducteur de débit unidirectionnel'), cat: 'flow', props: { open: 50, label: '' }, tag: [-2, 14, 'end'],
    size: () => [4, 6], ports: () => [{ id: '1', x: 2, y: 6, dir: 'down' }, { id: '2', x: 2, y: 0, dir: 'up' }],
    draw(el) {
      const o = Math.round(props(el).open);
      // Étrangleur réglable sur la voie principale, clapet antiretour en parallèle (passage libre de 1 vers 2).
      return `${line(20, 0, 20, 60)}<path class="pnStroke" d="M14 22 Q20 30 14 38 M26 22 Q20 30 26 38"/>${line(10, 40, 30, 20)}<path class="pnFill" d="M30 20 L24 21 L29 26 Z"/>`
        + `${line(20, 12, 34, 12)}${line(34, 12, 34, 48)}${line(20, 48, 34, 48)}<circle class="pnBox" cx="34" cy="33" r="3.5"/><path class="pnStroke" d="M29 26 L34 29.5 L39 26"/>${txt(-2, 33, `${o} %`, 'pnSub', 'end')}`;
    }
  },
  shuttle: {
    name: () => tl('Sélecteur de circuit (OU)'), cat: 'logic', props: { label: '' }, tag: [2, 8],
    size: () => [6, 3], ports: () => [{ id: '1', x: 0, y: 2, dir: 'left' }, { id: '3', x: 6, y: 2, dir: 'right' }, { id: '2', x: 3, y: 0, dir: 'up' }],
    draw: (el, s) => {
      const bx = s ? (s.on('1') && !s.on('3') ? 38 : s.on('3') && !s.on('1') ? 22 : 30) : 30;
      return `<rect class="pnBox" x="8" y="12" width="44" height="16"/>${line(0, 20, 8, 20)}${line(52, 20, 60, 20)}${line(30, 0, 30, 12)}<path class="pnStroke" d="M14 14 L14 26 M46 14 L46 26"/><circle class="pnFill" cx="${bx}" cy="20" r="5"/>${txt(30, 40, tl('OU'), 'pnSub')}`;
    }
  },
  twopress: {
    name: () => tl('Clapet de double pression (ET)'), cat: 'logic', props: { label: '' }, tag: [2, 8],
    size: () => [6, 3], ports: () => [{ id: '1', x: 0, y: 2, dir: 'left' }, { id: '3', x: 6, y: 2, dir: 'right' }, { id: '2', x: 3, y: 0, dir: 'up' }],
    draw: () => `<rect class="pnBox" x="8" y="12" width="44" height="16"/>${line(0, 20, 8, 20)}${line(52, 20, 60, 20)}${line(30, 0, 30, 12)}<rect class="pnBox" x="22" y="15" width="16" height="10"/>${line(14, 14, 14, 26)}${line(46, 14, 46, 26)}${txt(30, 40, tl('ET'), 'pnSub')}`
  },
  gauge: {
    name: () => tl('Manomètre'), cat: 'flow', props: {},
    size: () => [4, 4], ports: () => [{ id: '1', x: 2, y: 4, dir: 'down' }],
    draw: (el, s) => {
      // Modèle physique : la pression lue ; tout ou rien : 6 ou 0 bar. Aiguille de 0 (à gauche) à 10 bar (à droite).
      const b = s ? (s.bar('1') ?? (s.on('1') ? 6 : 0)) : 0, a = -2.4 + Math.max(0, Math.min(10, b)) / 10 * 2.1;
      return `<circle class="pnBox" cx="20" cy="18" r="12"/>${line(20, 30, 20, 40)}${line(20, 18, 20 + 9 * Math.cos(a), 18 + 9 * Math.sin(a), 'pnNeedle')}<circle class="pnFill" cx="20" cy="18" r="1.8"/>${s ? txt(36, 22, tl('{0} bar', String(Math.round(b * 10) / 10).replace('.', ',')), 'pnSub', 'start') : ''}`;
    }
  }
};
/**
 * Cames sur la tige d'un vérin : une marque au-dessus de chaque fin de course qui actionne un galet du circuit c, avec
 * le repère du galet ; allumée quand la tige est à cette fin de course. v : état du vérin (viewOf) ou null.
 */
export function camMarks(c, cyl, v) {
  let out = '';
  for (const e of c.elements) {
    if (e.type !== 'v32') continue;
    const P = props(e); if (P.act !== 'roller' || camTarget(c.elements, P.cam) !== cyl) continue;
    const out1 = P.end !== '0', x = out1 ? 172 : 114, on = !!v && (out1 ? v.x >= 0.98 : v.x <= 0.02);
    out += `<path class="pnCam${on ? ' on' : ''}" d="M${x - 4} 3 L${x + 4} 3 L${x} 10 Z"/>${txt(x, 0, P.label || camText(P), 'pnTag pnId' + (on ? ' on' : ''))}`;
  }
  return out;
}
/** Repère d'un distributeur, d'un réducteur ou d'une cellule logique (les vérins dessinent le leur). */
export function tagOf(el) {
  const D = DEFS[el.type], l = el.p && el.p.label;
  return D && D.tag && l ? txt(D.tag[0], D.tag[1], l, 'pnTag pnId', D.tag[2] || 'start') : '';
}
/** Réglages d'un élément : ceux du type, complétés par les siens. */
export const props = el => ({ ...((DEFS[el.type] && DEFS[el.type].props) || {}), ...(el.p || {}) });
/** Taille en pas de grille et orifices (position absolue en pas). */
export const sizeOf = el => DEFS[el.type].size(el);
export const portsOf = el => DEFS[el.type].ports(el).map(p => ({ ...p, ax: el.x + p.x, ay: el.y + p.y }));
/** Échappement (silencieux) dessiné sous un orifice d'échappement. */
const exhaustMark = (x, y) => `<path class="pnStroke pnExh" d="M${x - 4} ${y + 4} L${x + 4} ${y + 4} L${x} ${y + 10} Z"/>`;

/** Vérin : tube, piston, tige ; ressort de rappel (simple effet) ; capteurs de fin de course et leurs repères. */
function cylinder(el, s, dbl) {
  const P = props(el), x = s ? s.x : 0, px = 12 + x * 58;
  let out = `<rect class="pnBox" x="0" y="4" width="90" height="32"/><rect class="pnPiston" x="${px - 3}" y="5" width="6" height="30"/>`;
  out += `<rect class="pnRod" x="${px + 3}" y="17" width="${100 - 3}" height="6"/><rect class="pnRodEnd" x="${px + 100}" y="13" width="4" height="14"/>`;
  out += line(10, 36, 10, 40) + (dbl ? line(80, 36, 80, 40) : `<path class="pnStroke pnSpring" d="M${px + 6} 11 L${px + 6 + (84 - px - 6) * 0.2} 29 L${px + 6 + (84 - px - 6) * 0.4} 11 L${px + 6 + (84 - px - 6) * 0.6} 29 L${px + 6 + (84 - px - 6) * 0.8} 11 L88 29"/>`);
  if (!dbl) out += `<circle class="pnFill" cx="80" cy="38" r="1.6"/>`; // évent de la chambre avant
  // Capteurs : marque au-dessus du tube, allumée quand le piston est devant.
  const sens = [[P.s0, 14, s && x <= 0.02], [P.s1, 70, s && x >= 0.98]];
  for (const [n, sx, on] of sens) if (n) out += `<rect class="pnSensor${on ? ' on' : ''}" x="${sx - 5}" y="-4" width="10" height="6" rx="1"/>${txt(sx, -8, n, 'pnTag' + (on ? ' on' : ''))}`;
  if (P.label) out += txt(45, 52, P.label, 'pnSub');
  return out;
}
