// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue « Schéma » du plan de travail : le montage redessiné en schéma électrique (symboles CEI,
// mêmes repères que le schéma imprimé), où l'on voit le courant pendant la simulation : fils colorés
// selon leur tension, points qui avancent dans le sens conventionnel (du + vers le −) à une vitesse
// liée à l'intensité, jusque dans les composants, LED qui s'allument, intensités et tensions écrites.
// Le dessin fixe (symboles, textes) est un SVG refait seulement quand le montage change ; une toile
// par-dessus porte ce qui bouge. Rien n'est calculé tant que la vue est cachée.
// On y câble aussi : glisser d'une broche à une autre ajoute le fil au montage (visible en 3D),
// clic droit ou Suppr sur une broche ou un fil le retire.
import { layoutSchematic, paintCircuit, drawSymbol, liveState, liveActive } from './sheet.js';
import { Draw, textWidth } from './draw.js';
import { tl } from '../i18n/index.js';
import { linkFlows, closedSwitches, voltRgb, dotSpeed, track, pointAt } from './flows.js';

const escX = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n3 = v => +v.toFixed(3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lighten = (c, f) => c.map(x => Math.round(x + (255 - x) * f));
/** Rectangle arrondi (repli en rectangle sur les moteurs web qui n'ont pas roundRect). */
const rrect = (ctx, x, y, w, h, r) => (ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h));
const G = 2.54, DIRS = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
/** Distance d'un point à un segment. */
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

/** Dessin fixe en SVG, aux couleurs du thème (currentColor), à partir des ordres de dessin du schéma. */
function svgOps(ops) {
  const out = [];
  let inAct = false;
  for (const o of ops) {
    // Parties actives d'un symbole (contact fermé, flèche de rotation…) : groupées, en couleur.
    if (!!o.act !== inAct) { out.push(inAct ? '</g>' : '<g class="act">'); inAct = !inAct; }
    if (o.t === 'path') {
      const d = 'M' + o.pts.map(p => `${n3(p[0])} ${n3(p[1])}`).join('L') + (o.close ? 'Z' : '');
      const fill = !o.fill ? 'none' : o.fill === '#fff' ? 'var(--schBg)' : 'currentColor';
      out.push(`<path d="${d}" fill="${fill}"${o.stroke ? ` stroke="currentColor" stroke-width="${n3(o.w)}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`);
    } else if (o.t === 'circle') out.push(`<circle cx="${n3(o.x)}" cy="${n3(o.y)}" r="${n3(o.r)}" fill="${o.fill ? 'currentColor' : 'none'}"${o.stroke ? ` stroke="currentColor" stroke-width="${n3(o.w)}"` : ''}/>`);
    else if (o.t === 'text') {
      const anchor = o.a === 'm' ? 'middle' : o.a === 'r' ? 'end' : 'start';
      out.push(`<text x="${n3(o.x)}" y="${n3(o.y)}" font-size="${n3(o.s)}" text-anchor="${anchor}"${o.color && o.color !== '#000' ? ' class="mut"' : ''}${o.b ? ' font-weight="bold"' : ''}${o.rot ? ` transform="rotate(${o.rot} ${n3(o.x)} ${n3(o.y)})"` : ''}>${escX(o.str)}</text>`);
    }
  }
  if (inAct) out.push('</g>');
  return out.join('');
}

/**
 * app : { light, comps(), wires(), netNames(), describe(c), blocks(), dc() (résultat du solveur pendant la
 * simulation, sinon null), simOn(), flowOn(), faults(), fmtV(v), fmtI(mA), dec, tip(html, x, y),
 * tipHtml(target), press(c, on), setInput(c, k, v), startSim(), locate(c),
 * connect(a, b) (relie deux broches, rend vrai si un fil est ajouté), cut(pids) (retire les fils d'une broche
 * ou d'une liaison), wired(ref) (la broche a-t-elle un fil) }
 */
export function createSchView(stage, app) {
  const el = document.createElement('div');
  el.className = 'schView'; el.hidden = true;
  const tick = v => `${String(v).replace('.', app.dec)} V`;
  const at = v => `${(v / 9 * 100).toFixed(1)}%`;
  el.innerHTML = `<svg class="schSvg" xmlns="http://www.w3.org/2000/svg" stroke-linejoin="round" stroke-linecap="round" role="img" aria-label="${tl('Schéma électrique du montage')}"></svg><canvas class="schCv" aria-hidden="true"></canvas>
    <div class="schEmpty" hidden>${tl('Ajoutez une carte et des composants : leur schéma s’affiche ici.')}</div>
    <div class="schInfo">
      <div class="schOff"><span>${tl('Lancez la simulation pour voir le courant circuler.')}<small>${tl('Câbler : glissez d’une broche à une autre.')}</small></span><button type="button" class="btn small primary" data-sim>${tl('Simuler')}</button></div>
      <div class="schLegend"><div class="schRow"><b>${tl('Tension')}</b><div class="schScale"><div class="schGrad"></div><div class="schTicks">${[0, 3.3, 5, 9].map(v => `<i style="left:${at(v)}">${tick(v)}</i>`).join('')}</div></div></div>
        <small>${tl('Points : sens du courant, du + vers le −, plus rapides quand il est plus fort.')}</small></div>
    </div>`;
  const cv3d = stage.querySelector('canvas');
  if (cv3d) cv3d.after(el); else stage.prepend(el);
  const svg = el.querySelector('svg'), cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  el.querySelector('[data-sim]').onclick = () => app.startSim();

  const CAP = app.light ? 350 : 1200, BASE_GAP = app.light ? 4 : 3;
  let L = null, sigLast = null, box = null, geo = [], hits = [], anchors = new Map(), leds = [], stateful = [], pinHits = [], anims = [];
  const turns = new WeakMap(); // angle de chaque rotor animé, gardé d'un dessin à l'autre
  // Fil en cours de tracé : { from, x0, y0, dir, cur, over, down (bouton encore enfoncé), moved }.
  let wiring = null, hoverPin = null, hoverSym = null;
  // Édition : symbole déplacé à la souris ({ c, sx, sy, dx, dy, moved }), places de la dernière disposition, groupes SVG.
  let move = null, placedPrev = null, symEls = new Map();
  let view = { s: 4, x: 0, y: 0 }, userMoved = false, W = 0, H = 0, dpr = 1;
  let lanes = [], lanesDc = null, lanesAt = 0, lastT = 0, raf = 0, dirty = true, dirtyT = 0;
  const phases = new Map();
  let values = true;
  try { values = localStorage.getItem('jollof-sch-values') !== '0'; } catch (e) { /* stockage indisponible */ }

  /* ---------- Disposition ---------- */
  // Chaque objet composant a son numéro : un montage recréé à l'identique (annulation) est quand même redessiné,
  // sinon le schéma garderait des composants qui n'existent plus.
  const uids = new WeakMap(); let uidNext = 1;
  const uid = c => { if (!uids.has(c)) uids.set(c, uidNext++); return uids.get(c); };
  // Un composant qu'on est en train de poser depuis la bibliothèque n'est dessiné qu'une fois lâché.
  const shown = () => app.comps().filter(c => !c.dragging);
  const sigOf = () => {
    const ws = app.wires().filter(w => w.a && w.b && w.a.comp && w.b.comp && !w.a.comp.dragging && !w.b.comp.dragging);
    return shown().map(c => `${uid(c)}:${c.id}:${c.type}:${c.name}:${Math.round(c.group.position.x)}:${Math.round(c.group.position.z)}`).join(';')
      + '|' + ws.map(w => `${w.a.comp.id}.${w.a.key}-${w.b.comp.id}.${w.b.key}`).join(';')
      + '|' + JSON.stringify(app.netNames() || {}) + '|' + app.blocks().map(b => b.name + ':' + b.comps.map(c => c.id).join(',')).join(';');
  };
  function build() {
    L = null;
    try {
      L = layoutSchematic({ comps: shown(), wires: app.wires().filter(w => w.a && w.b && w.a.comp && w.b.comp && !w.a.comp.dragging && !w.b.comp.dragging), netNames: app.netNames() || {}, describe: app.describe, blocks: app.blocks(), live: true, prev: placedPrev });
      // Places de cette disposition : la prochaine les reprend pour tout ce qui n'a pas bougé.
      placedPrev = new Map([...L.syms].map(([c, s]) => [c, { ox: s.ox, oy: s.oy, x: c.group.position.x, z: c.group.position.z }]));
    } catch (e) { console.error(e); }
    // Fils et extrémités d'un côté ; chaque symbole dans son groupe, redessiné quand son état change (bouton appuyé…).
    const d = new Draw(), groups = [];
    if (L) {
      paintCircuit(d, L, { symbols: false });
      for (const [c] of L.syms) { const st = liveState(c); groups.push({ c, st, key: JSON.stringify(st) }); }
    }
    svg.innerHTML = svgOps(d.ops) + groups.map(g => `<g class="sym${liveActive(g.st) ? ' on' : ''}">${svgOps(drawSymbol(L, g.c, g.st))}</g>`).join('');
    const gs = svg.querySelectorAll('g.sym');
    symEls = new Map(groups.map((g, i) => [g.c, gs[i]]));
    stateful = groups.map((g, i) => ({ ...g, el: gs[i] })).filter(g => g.st);
    geo = []; hits = []; anchors = new Map(); leds = []; pinHits = []; anims = [];
    box = null;
    if (L) {
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      const grow = (x, y) => { lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; };
      L.placed.forEach(b => { grow(b[0], b[1]); grow(b[2], b[3]); });
      L.wires.forEach(w => w.forEach(p => grow(p[0], p[1])));
      L.frames.forEach(f => { grow(f.r[0], f.r[1]); grow(f.r[2], f.r[3]); });
      if (L.placed.length) box = [lo[0], lo[1], hi[0], hi[1]];
      L.links.forEach((l, i) => geo.push({ key: `l${i}:${l.u}>${l.v}`, kind: 'link', ref: l, net: l.net, pts: l.pts, t: track(l.pts) }));
      L.stubs.forEach(s => geo.push({ key: 's' + s.id, kind: 'stub', id: s.id, net: s.net, pts: s.pts, t: track(s.pts) }));
      for (const [c, s] of L.syms) {
        const R = (b, m = 0) => [b[0] + s.ox - m, b[1] + s.oy - m, b[2] + s.ox + m, b[3] + s.oy + m];
        const body = R(s.body, 0.6), all = R(s.box, 0.4);
        hits.push({ c, body, all, area: (all[2] - all[0]) * (all[3] - all[1]) });
        if (c.led || c.rgb) leds.push({ c, x: (body[0] + body[2]) / 2, y: (body[1] + body[3]) / 2 });
        if (s.anim) anims.push({ c, kind: s.anim.kind, x: s.ox + s.anim.x, y: s.oy + s.anim.y, r: s.anim.r });
        geo.push(...spokeGeo(c, s, liveState(c)));
        // Zone d'une broche : son bout, toute sa patte et, sur un bloc (carte, module), son nom écrit à l'intérieur.
        for (const k of Object.keys(s.pins)) {
          const q = L.abs(c, k), [dx, dy] = DIRS[q.dir] || [0, 0], len = G + (s.spokes ? 0 : 0.8 + textWidth(k.replace(/ \(\d+\)$/, ''), 1.55));
          pinHits.push({ r: { comp: c, key: k }, x: q.x, y: q.y, dir: q.dir, ix: q.x - dx * len, iy: q.y - dy * len });
        }
      }
      // Bout d'un fil d'alimentation ou de masse (étiquette, symbole de masse) : y relâcher relie à son nœud.
      L.stubs.forEach(st => pinHits.push({ r: st.pin, x: st.pts[1][0], y: st.pts[1][1], dir: st.pts[0][0] === st.pts[1][0] ? 'u' : 'l', stub: true }));
      // Où écrire la tension de chaque nœud de signal : au milieu de son plus long bout de fil.
      for (const n of L.nets) {
        if (n.kind !== 'sig' || n.pins.length < 2) continue;
        let best = null, bl = -1;
        for (const g of geo) {
          if (g.net !== n || g.kind === 'spoke') continue;
          for (let i = 1; i < g.pts.length; i++) {
            const p = g.pts[i - 1], q = g.pts[i], len = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
            if (len > bl) { bl = len; best = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, Math.abs(p[1] - q[1]) < 1e-6]; }
          }
        }
        if (best) anchors.set(n, best);
      }
    }
    el.querySelector('.schEmpty').hidden = !!(L && L.syms.size);
    lanes = []; lanesDc = null; phases.clear(); hoverPin = null; hoverSym = null;
    if (wiring && !L) wiring = null;
    if (!userMoved) fit(true);
  }
  /** Chemins du courant dans un symbole (ceux du potentiomètre suivent son curseur). */
  function spokeGeo(c, s, st) {
    const sp = s.spokesFor && st ? s.spokesFor(st) : s.spokes, out = [];
    if (!sp) return out;
    for (const [k, list] of Object.entries(sp)) {
      if (!(k in s.pins)) continue;
      const pts = list.map(p => [p[0] + s.ox, p[1] + s.oy]);
      out.push({ key: `p${c.id}|${k}`, kind: 'spoke', id: `${c.id}|${k}`, net: L.of({ comp: c, key: k }), pts, t: track(pts) });
    }
    return out;
  }
  /** Symboles dont l'état a changé (bouton, curseur, relais, son, moteur…) : redessinés, courants internes suivis. */
  function syncStates() {
    if (!L) return;
    for (const g of stateful) {
      const st = liveState(g.c), key = JSON.stringify(st);
      if (key === g.key) continue;
      g.key = key; g.st = st;
      g.el.innerHTML = svgOps(drawSymbol(L, g.c, st));
      g.el.classList.toggle('on', liveActive(st));
      const s = L.syms.get(g.c);
      if (s && s.spokesFor) {
        const fresh = spokeGeo(g.c, s, st), keys = new Set(fresh.map(x => x.key));
        geo = geo.filter(x => !keys.has(x.key)).concat(fresh);
        lanesDc = null; // courants à recalculer sur les nouveaux chemins
      }
    }
  }
  function ensure() {
    if (!dirty) return;
    dirty = false;
    const sg = sigOf();
    if (sg !== sigLast) { sigLast = sg; build(); }
  }

  /* ---------- Vue : déplacement et zoom ---------- */
  function measure() {
    const r = el.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); dpr = Math.min(2, window.devicePixelRatio || 1);
    if (app.light) dpr = Math.min(dpr, 1.25);
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  }
  function apply() {
    svg.setAttribute('viewBox', `${n3(view.x)} ${n3(view.y)} ${n3(W / view.s)} ${n3(H / view.s)}`);
    request();
    if (app.view) app.view(); // barre de navigation : zoom, mini-carte
  }
  /** Cadre une zone du schéma (mm) : [x0, y0, x1, y1]. */
  function frameMm(b, maxS = 14) {
    if (!W) return;
    const bw = Math.max(10, b[2] - b[0]), bh = Math.max(10, b[3] - b[1]), mx = 28, top = 84, bottom = 64, right = 56;
    view.s = clamp(Math.min((W - 2 * mx - right) / bw, (H - top - bottom) / bh), 0.8, maxS);
    view.x = b[0] - ((W - right) / view.s - bw) / 2;
    view.y = b[1] - (top + (H - top - bottom - bh * view.s) / 2) / view.s;
    userMoved = true; apply();
  }
  /** Cadre tout le schéma (marges pour les barres d'outils du haut et du bas). */
  function fit(auto) {
    if (!auto) userMoved = false;
    if (!box || !W) { apply(); return; }
    const bw = Math.max(10, box[2] - box[0]), bh = Math.max(10, box[3] - box[1]), mx = 28, top = 84, bottom = 64, right = 56; // right : barre de navigation
    view.s = clamp(Math.min((W - 2 * mx - right) / bw, (H - top - bottom) / bh), 0.8, 14);
    view.x = box[0] - ((W - right) / view.s - bw) / 2;
    view.y = box[1] - (top + (H - top - bottom - bh * view.s) / 2) / view.s;
    apply();
  }
  const toMm = e => { const r = el.getBoundingClientRect(); return [view.x + (e.clientX - r.left) / view.s, view.y + (e.clientY - r.top) / view.s]; };
  function zoomAt(px, py, f) {
    const mx = view.x + px / view.s, my = view.y + py / view.s, s2 = clamp(view.s * f, 0.8, 40);
    view.s = s2; view.x = mx - px / s2; view.y = my - py / s2; userMoved = true; apply();
  }
  function panBy(dx, dy) { view.x += dx / view.s; view.y += dy / view.s; userMoved = true; apply(); }

  /* ---------- Courants ---------- */
  function computeLanes(dc) {
    const inj = closedSwitches(L.nets, dc.injections()), fl = linkFlows(L.links, inj), vs = new Map();
    const vOf = net => { if (!net) return null; if (!vs.has(net)) vs.set(net, dc.volts(net.pins[0])); return vs.get(net); };
    lanes = geo.map(g => {
      const mA = g.kind === 'link' ? fl.get(g.ref) || 0 : g.kind === 'stub' ? inj.get(g.id) || 0 : -(inj.get(g.id) || 0);
      const v = vOf(g.net), c = voltRgb(v);
      return { g, mA, v, c, dot: rgb(lighten(c, 0.45)) };
    });
    // Trop de points : on les espace partout plutôt que d'en oublier.
    let gap = BASE_GAP;
    const need = () => lanes.reduce((t, l) => t + (Math.abs(l.mA) >= 0.01 ? Math.max(1, Math.round(l.g.t.len / gap)) : 0), 0);
    while (need() > CAP && gap < 40) gap *= 1.25;
    lanes.forEach(l => { l.n = Math.max(1, Math.round(l.g.t.len / gap)); l.sp = l.g.t.len / l.n; });
    lanes.vOf = vOf; lanes.inj = inj;
  }


  /* ---------- Dessin ---------- */
  function request() { if (!raf && !el.hidden) raf = requestAnimationFrame(t => { raf = 0; draw(t); }); }
  function draw(now = performance.now()) {
    if (el.hidden) return;
    syncStates();
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0; lastT = now;
    const sim = app.simOn(), dc = sim ? app.dc() : null;
    el.classList.toggle('live', !!sim);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (!L) return;
    const k = view.s * dpr;
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (sim && lanes.length) {
      // Fils colorés selon leur tension.
      ctx.lineWidth = Math.max(0.45, 1.8 / view.s);
      for (const l of lanes) {
        if (l.g.kind === 'spoke' || l.v == null) continue;
        ctx.strokeStyle = rgb(l.c); ctx.beginPath();
        l.g.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      // LED allumées.
      for (const d of leds) {
        let col = null, b = 0;
        if (d.c.led && d.c.led.mat) { b = (d.c.led.mat.emissiveIntensity || 0) / 1.3; col = [(d.c.led.glow >> 16) & 255, (d.c.led.glow >> 8) & 255, d.c.led.glow & 255]; }
        else if (d.c.rgb && d.c.rgb.mat) { const e = d.c.rgb.mat.emissive; b = Math.max(e.r, e.g, e.b) * (d.c.rgb.mat.emissiveIntensity ? 1 : 0); col = [e.r, e.g, e.b].map(x => Math.round(255 * x / (b || 1))); }
        if (!col || b < 0.02) continue;
        const R = 7, g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, R);
        g.addColorStop(0, rgb(lighten(col, 0.5), 0.95 * Math.min(1, b + 0.15))); g.addColorStop(0.3, rgb(col, 0.5 * b)); g.addColorStop(1, rgb(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, R, 0, 6.2832); ctx.fill();
      }
      // Points qui suivent le courant.
      if (app.flowOn()) {
        const r = Math.max(0.36, 1.6 / view.s);
        for (const l of lanes) {
          if (Math.abs(l.mA) < 0.01) continue;
          let ph = phases.has(l.g.key) ? phases.get(l.g.key) : Math.random() * l.sp;
          ph += Math.sign(l.mA) * dotSpeed(l.mA) * dt; ph = ((ph % l.sp) + l.sp) % l.sp; phases.set(l.g.key, ph);
          ctx.fillStyle = l.dot; ctx.beginPath();
          for (let j = 0; j < l.n; j++) { const p = pointAt(l.g.t, ph + j * l.sp); ctx.moveTo(p[0] + r, p[1]); ctx.arc(p[0], p[1], r, 0, 6.2832); }
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // Erreurs de la simulation : composant et broches entourés.
    const faults = sim ? app.faults() : [];
    if (faults.length) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 220);
      ctx.lineWidth = Math.max(0.35, 1.5 / view.s);
      for (const f of faults) {
        ctx.strokeStyle = f.level === 'err' ? `rgba(240,82,82,${pulse})` : `rgba(242,180,60,${pulse})`;
        const h = f.comp && hits.find(x => x.c === f.comp);
        if (h) { ctx.beginPath(); rrect(ctx, h.body[0] - 1, h.body[1] - 1, h.body[2] - h.body[0] + 2, h.body[3] - h.body[1] + 2, 1.2); ctx.stroke(); }
        for (const p of f.pins || []) {
          const s = L.syms.get(p.comp); if (!s || !s.pins[p.key]) continue;
          const q = L.abs(p.comp, p.key); ctx.beginPath(); ctx.arc(q.x, q.y, 1.3, 0, 6.2832); ctx.stroke();
        }
      }
    }
    if (anims.length) drawAnims(dt, now, sim);
    drawSelection();
    if (values && dc && lanes.vOf) drawValues(dc);
    if (wiring || hoverPin || hoverSym) drawWiring();
  }
  /** Composant sélectionné (panneau de gauche) : cadre pointillé, qui suit le symbole qu'on déplace. */
  function drawSelection() {
    const c = app.selected ? app.selected() : null, h = c && hits.find(x => x.c === c);
    if (!h) return;
    const k = view.s * dpr, ox = move && move.c === c && move.moved ? move.dx : 0, oy = move && move.c === c && move.moved ? move.dy : 0;
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    ctx.strokeStyle = '#4cc2ff'; ctx.lineWidth = Math.max(0.25, 1.2 / view.s); ctx.setLineDash([1.2, 0.8]);
    ctx.beginPath(); rrect(ctx, h.all[0] + ox - 0.8, h.all[1] + oy - 0.8, h.all[2] - h.all[0] + 1.6, h.all[3] - h.all[1] + 1.6, 1); ctx.stroke();
    ctx.setLineDash([]);
  }
  /**
   * Parties mobiles des effecteurs, image par image, à la vitesse que donne la simulation : rotor du moteur, pales du
   * ventilateur, turbine de la pompe, vibreur qui tremble, palonnier du servo (et son angle), repère du pas à pas, sons.
   */
  function drawAnims(dt, now, sim) {
    const k = view.s * dpr;
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    const ACC = '#60a5fa', REST = 'rgba(138,150,163,0.75)', lw = Math.max(0.3, 1.4 / view.s);
    ctx.lineCap = 'round';
    for (const m of anims) {
      const c = m.c, sp = sim ? c.motorV || 0 : 0, moving = Math.abs(sp) >= 0.02;
      let a = turns.get(c) || 0;
      if (m.kind === 'rotor' || m.kind === 'fan' || m.kind === 'pump') { a += sp * dt * Math.PI * 2 * (m.kind === 'fan' ? 2.2 : 1.4); turns.set(c, a); }
      const { x, y, r } = m;
      if (m.kind === 'rotor') {
        if (!moving) continue;
        ctx.fillStyle = ACC;
        for (const d of [0, Math.PI]) { ctx.beginPath(); ctx.arc(x + Math.cos(a + d) * r * 0.78, y + Math.sin(a + d) * r * 0.78, Math.max(0.35, r * 0.13), 0, 6.2832); ctx.fill(); }
      } else if (m.kind === 'fan') {
        ctx.fillStyle = moving ? ACC : REST;
        for (let i = 0; i < 3; i++) { const b = a + i * 2 * Math.PI / 3; ctx.beginPath(); ctx.ellipse(x + Math.cos(b) * r * 0.48, y + Math.sin(b) * r * 0.48, r * 0.44, r * 0.17, b, 0, 6.2832); ctx.fill(); }
        ctx.beginPath(); ctx.arc(x, y, r * 0.16, 0, 6.2832); ctx.fill();
      } else if (m.kind === 'pump') {
        ctx.strokeStyle = moving ? ACC : REST; ctx.lineWidth = lw;
        ctx.beginPath(); for (const d of [0, Math.PI / 2]) { ctx.moveTo(x + Math.cos(a + d) * r * 0.55, y + Math.sin(a + d) * r * 0.55); ctx.lineTo(x - Math.cos(a + d) * r * 0.55, y - Math.sin(a + d) * r * 0.55); } ctx.stroke();
        if (moving) {
          // Eau qui sort : gouttes qui montent à droite, plus nombreuses quand la pompe va vite.
          ctx.fillStyle = 'rgba(74,168,255,0.9)';
          const n = 3, ph = (now / 900 * (0.5 + Math.abs(sp))) % 1;
          for (let i = 0; i < n; i++) { const t = (ph + i / n) % 1; ctx.beginPath(); ctx.arc(x + r * 0.7 + t * r * 0.9, y - r * 0.9 - t * r * 1.2, r * 0.12 * (1 - t * 0.5), 0, 6.2832); ctx.fill(); }
        }
      } else if (m.kind === 'vibro') {
        const j = moving ? Math.min(1, Math.abs(sp)) * 0.35 : 0;
        ctx.strokeStyle = moving ? ACC : REST; ctx.lineWidth = lw;
        for (const dx of [-1, 1]) {
          const ox = x + dx * r * 0.36 + (Math.random() - 0.5) * j, oy = y - r * 1.25 + (Math.random() - 0.5) * j;
          ctx.beginPath(); ctx.moveTo(ox - 0.5, oy + 0.4); ctx.lineTo(ox - 0.17, oy - 0.4); ctx.lineTo(ox + 0.17, oy + 0.4); ctx.lineTo(ox + 0.5, oy - 0.4); ctx.stroke();
        }
        if (moving) { ctx.beginPath(); ctx.arc(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, r, 0, 6.2832); ctx.stroke(); }
      } else if (m.kind === 'servo') {
        // Palonnier : 0° à gauche, 90° en haut, 180° à droite, comme sur le servo en 3D vu de dessus.
        const deg = c.servoA == null ? 90 : c.servoA, b = Math.PI + deg * Math.PI / 180, L = r * 1.75;
        ctx.strokeStyle = ACC; ctx.lineWidth = Math.max(0.55, 3 / view.s);
        ctx.beginPath(); ctx.moveTo(x - Math.cos(b) * r * 0.35, y - Math.sin(b) * r * 0.35); ctx.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L); ctx.stroke();
        ctx.fillStyle = ACC; ctx.beginPath(); ctx.arc(x, y, Math.max(0.45, r * 0.22), 0, 6.2832); ctx.fill();
        if (view.s > 2) { ctx.font = `600 ${2.1}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(`${Math.round(deg)}°`, x, y + r + 0.9); }
      } else if (m.kind === 'stepper') {
        const b = (c.stepPos || 0) * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = sim && c.stepBusy ? ACC : REST; ctx.beginPath(); ctx.arc(x + Math.cos(b) * r, y + Math.sin(b) * r, Math.max(0.4, r * 0.2), 0, 6.2832); ctx.fill();
      } else if (m.kind === 'sound') {
        if (!sim || !(c.actR && c.actR.live)) continue;
        ctx.lineWidth = lw;
        for (let i = 0; i < 2; i++) {
          const t = ((now / 650) + i / 2) % 1;
          ctx.strokeStyle = `rgba(240,138,60,${(1 - t).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, r + 0.6 + t * 3, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.stroke();
        }
      }
    }
  }
  /** Câblage : broche survolée, fil en cours de tracé (en équerre) et broches où le relâcher. */
  function drawWiring() {
    const k = view.s * dpr;
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    const lw = Math.max(0.3, 1.6 / view.s), ring = (x, y, col, r = 1.05) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke(); };
    if (!wiring) {
      // Composant survolé : ses broches marquées, d'où l'on peut tirer un fil.
      if (hoverSym) { ctx.fillStyle = 'rgba(76,194,255,0.55)'; ctx.beginPath(); for (const p of pinHits) if (!p.stub && p.r.comp === hoverSym) { ctx.moveTo(p.x + 0.55, p.y); ctx.arc(p.x, p.y, 0.55, 0, 6.2832); } ctx.fill(); }
      if (hoverPin) {
        // Patte survolée surlignée, bout entouré.
        const [dx, dy] = DIRS[hoverPin.dir] || [0, 0];
        if (!hoverPin.stub) { ctx.strokeStyle = 'rgba(76,194,255,0.9)'; ctx.lineWidth = Math.max(0.5, 3 / view.s); ctx.beginPath(); ctx.moveTo(hoverPin.x, hoverPin.y); ctx.lineTo(hoverPin.x - dx * G, hoverPin.y - dy * G); ctx.stroke(); }
        ring(hoverPin.x, hoverPin.y, '#4cc2ff');
      }
      return;
    }
    ctx.fillStyle = 'rgba(76,194,255,0.4)'; ctx.beginPath();
    for (const p of pinHits) if (!p.stub) { ctx.moveTo(p.x + 0.5, p.y); ctx.arc(p.x, p.y, 0.5, 0, 6.2832); }
    ctx.fill();
    const o = wiring.over, col = o ? (o.joined ? '#f2b43c' : '#3fb27f') : '#4cc2ff';
    const a = [wiring.x0, wiring.y0], t = o ? [o.x, o.y] : wiring.cur, flat = wiring.dir === 'l' || wiring.dir === 'r';
    const mid = flat ? [t[0], a[1]] : [a[0], t[1]];
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash([2.2, 1.3]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(mid[0], mid[1]); ctx.lineTo(t[0], t[1]); ctx.stroke();
    ctx.setLineDash([]);
    ring(a[0], a[1], col); if (o) ring(o.x, o.y, col, 1.3);
  }
  /** Intensité dans chaque composant, tension de chaque nœud de signal (en pixels : lisibles à tout zoom). */
  function drawValues(dc) {
    if (view.s < 2.2) return; // trop petit : on lit les valeurs au survol
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fs = Math.round(clamp(view.s * 1.7, 10, 12.5));
    ctx.font = `600 ${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const px = (x, y) => [(x - view.x) * view.s, (y - view.y) * view.s];
    // Chaque étiquette prend la première place libre parmi ses candidates (sans chevaucher les autres ni les symboles).
    const taken = [], h = fs + 5;
    const free = r => !taken.some(t => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);
    const pill = (cands, str, col) => {
      const w = ctx.measureText(str).width + 8;
      let pick = null;
      for (const [x, y] of cands) {
        const r = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        if (free(r)) { pick = r; break; }
      }
      if (!pick) { const [x, y] = cands[0]; pick = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]; }
      taken.push(pick);
      if (pick[2] < 0 || pick[3] < 0 || pick[0] > W || pick[1] > H) return;
      ctx.fillStyle = 'rgba(13,17,21,0.86)'; ctx.beginPath(); rrect(ctx, pick[0], pick[1], w, h, 4); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(str, (pick[0] + pick[2]) / 2, (pick[1] + pick[3]) / 2 + 0.5);
    };
    // Les symboles (avec leurs textes) sont déjà occupés.
    for (const hb of hits) { const a = px(hb.all[0], hb.all[1]), b = px(hb.all[2], hb.all[3]); taken.push([a[0], a[1], b[0], b[1]]); }
    const own = new Map(hits.map((hb, i) => [hb.c, i]));
    for (const [c, s] of L.syms) {
      if (!s.spokes) continue;
      const a = c.type === 'button' || c.type === 'cylsensor' || c.type === 'pressostat' ? { kind: 'sw', mA: c.inp && c.inp.pressed ? lanes.inj.get(`${c.id}|1`) ?? null : null } : dc.across(c); if (!a) continue;
      const mA = a.kind === 'npn' && a.extra ? a.extra.ic : a.mA;
      if (mA == null || Math.abs(mA) < 0.001) continue;
      const [x0, y0] = px(s.ox + s.box[0], s.oy + s.box[1]), [x1, y1] = px(s.ox + s.box[2], s.oy + s.box[3]), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const spd = a.kind === 'motor' ? `${Math.round(Math.min(1, Math.abs(c.motorV || 0)) * 100)} % · ` : '';
      const str = (a.kind === 'npn' ? 'Ic ' : '') + spd + app.fmtI(Math.abs(mA)), w = ctx.measureText(str).width + 8;
      // Le symbole lui-même n'est pas un obstacle pour sa propre étiquette.
      const i = own.get(c), mine = taken[i]; taken[i] = [0, 0, 0, 0];
      pill([[cx, y1 + h / 2 + 1], [cx, y0 - h / 2 - 1], [x1 + w / 2 + 2, cy], [x0 - w / 2 - 2, cy], [cx, y1 + h * 1.6]], str, '#ffd76a');
      taken[i] = mine;
    }
    for (const [n, p] of anchors) {
      const v = lanes.vOf(n); if (v == null) continue;
      const [x, y] = px(p[0], p[1]), str = app.fmtV(v), w = ctx.measureText(str).width + 8;
      const cands = p[2]
        ? [[x, y - h / 2 - 3], [x, y + h / 2 + 3], [x - w, y - h / 2 - 3], [x + w, y - h / 2 - 3]]
        : [[x + w / 2 + 4, y], [x - w / 2 - 4, y], [x + w / 2 + 4, y - h * 1.5], [x - w / 2 - 4, y + h * 1.5]];
      pill(cands, str, rgb(lighten(voltRgb(v), 0.25)));
    }
  }

  /* ---------- Survol, boutons, potentiomètres ---------- */
  function hitComp(x, y, wide) {
    let best = null;
    for (const h of hits) {
      const r = wide ? h.all : h.body;
      if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3] && (!best || h.area < best.area)) best = h;
    }
    return best ? best.c : null;
  }
  function hitWire(x, y) {
    const tol = Math.max(0.9, 7 / view.s);
    let best = null, bd = tol;
    for (const g of geo) {
      if (g.kind === 'spoke') continue;
      for (let i = 1; i < g.pts.length; i++) {
        const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1), d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
        if (d < bd) { bd = d; best = g; }
      }
    }
    return best;
  }
  const same = (a, b) => !!a && !!b && a.comp === b.comp && a.key === b.key;
  const pidOf = r => `${r.comp.id}|${r.key}`;
  /** Broche la plus proche : son bout, sa patte ou son nom (bloc), ou le bout d'une étiquette d'alimentation, à quelques pixels près. */
  function hitPin(x, y) {
    const tol = Math.max(1.1, 9 / view.s);
    let best = null, bd = tol;
    for (const p of pinHits) {
      const d = p.stub ? Math.hypot(p.x - x, p.y - y) + 0.2 : Math.min(Math.hypot(p.x - x, p.y - y), segDist(x, y, p.x, p.y, p.ix, p.iy) + 0.1);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** Pendant un tracé : broche visée, sinon fil visé (on relie à son nœud, par l'une de ses broches). */
  function dropAt(x, y) {
    const p = hitPin(x, y);
    if (p) return p.r && !same(p.r, wiring.from) ? p : null;
    const g = hitWire(x, y);
    if (!g) return null;
    const end = g.kind === 'stub' ? pinHits.find(h => h.stub && h.r && pidOf(h.r) === g.id) : null;
    const ids = g.kind === 'stub' ? [g.id] : [g.ref.u, g.ref.v].filter(v => typeof v === 'string' && v.includes('|'));
    const h = pinHits.find(q => !q.stub && ids.includes(pidOf(q.r)) && !same(q.r, wiring.from));
    return h ? { ...h, x, y, onWire: true } : end && !same(end.r, wiring.from) ? end : null;
  }
  const pinName = r => `${escX(r.comp.name)} · ${escX(r.key)}`;
  /** Ce que retire un clic droit ou Suppr : les fils d'une broche, ou le fil d'une liaison dessinée. */
  function cutTarget(x, y) {
    const p = hitPin(x, y);
    if (p) return [pidOf(p.r)];
    const g = hitWire(x, y);
    if (!g) return null;
    if (g.kind === 'stub') return [g.id];
    return [g.ref.u, g.ref.v].filter(v => typeof v === 'string' && v.includes('|'));
  }
  function cut(ids) { if (ids && ids.length && app.cut(ids)) { userMoved = true; hoverPin = null; } }
  function cancelWire() { if (!wiring) return; wiring = null; app.tip(null); request(); }
  function finishWire(r) {
    const from = wiring.from; wiring = null; app.tip(null);
    if (app.connect(from, r)) userMoved = true; // le schéma se redessine sans recadrer
    request();
  }
  /** Infobulle pendant le tracé : broche visée, ou comment finir. */
  function wireTip(e) {
    const o = wiring.over;
    app.tip(o ? `→ <b>${pinName(o.r)}</b>${o.joined ? `<br><small>${tl('déjà reliées')}</small>` : ''}` : `<small>${tl('Relâchez ou cliquez sur une autre broche · Échap : annuler')}</small>`, e.clientX, e.clientY);
  }
  let hoverAt = 0, hoverEv = null;
  function hover(e) {
    hoverEv = e;
    const now = performance.now(); if (now - hoverAt < 60) return; hoverAt = now;
    paintHover();
  }
  function paintHover() {
    if (wiring) return;
    const e = hoverEv; if (!e || !L) { app.tip(null); return; }
    const [x, y] = toMm(e), sim = app.simOn();
    const pin = hitPin(x, y), sym = pin ? null : hitComp(x, y, true);
    if (pin !== hoverPin || sym !== hoverSym) { hoverPin = pin; hoverSym = sym; request(); }
    if (pin) {
      const net = L.of(pin.r), linked = net && net.pins.length > 1;
      el.style.cursor = 'crosshair';
      app.tip(`<b>${pinName(pin.r)}</b>${linked ? ` · ${escX(net.name)}` : ''}<br><small>${tl('Glissez vers une autre broche pour les relier')}${app.wired(pin.r) ? ' · ' + tl('clic droit : débrancher') : ''}</small>`, e.clientX, e.clientY);
      return;
    }
    const c = hitComp(x, y, false) || (hitWire(x, y) ? null : hitComp(x, y, true)), g = c ? null : hitWire(x, y);
    let html = '';
    if (c) {
      html = sim ? app.tipHtml({ comp: c }) : '';
      if (sim && c.type === 'button') {
        const on = !!(c.inp && c.inp.pressed), i = on && lanes.inj ? lanes.inj.get(`${c.id}|1`) : null;
        html = `<b>${escX(c.name)}</b> · ${on ? tl('appuyé') : tl('relâché')}${i != null ? `<br>I <b>${app.fmtI(Math.abs(i))}</b>` : ''}`;
      }
      if (!html) html = `<b>${escX(c.name)}</b> · ${escX((app.describe(c) || {}).title || '')}`;
      if (sim && (c.type === 'button' || c.type === 'joystick')) html += `<br><small>${tl('Cliquez et maintenez pour appuyer')}</small>`;
      if (sim && c.type === 'pot') html += `<br><small>${tl('Molette : tourner le curseur ({0} %)', Math.round(c.inp.pos ?? 50))}</small>`;
      if (!sim) html += `<br><small>${tl('Glisser pour déplacer · double-clic : le retrouver en 3D')}</small>`;
    } else if (g) {
      const lane = sim ? lanes.find(l => l.g === g) : null;
      html = sim ? app.tipHtml({ net: g.net, mA: lane ? lane.mA : null }) : `${tl('Nœud')} <b>${escX(g.net.name)}</b>`;
      // Fil de commande d'un servo : la largeur de l'impulsion fixe l'angle.
      const sv = sim && g.net && g.net.pins.find(p => p.comp.type === 'servo' && p.key === 'SIG');
      if (sv && sv.comp.servoA != null) html += `<br>${tl('Impulsions de servo : {0} ms toutes les 20 ms ({1}°)', String(Math.round((0.544 + sv.comp.servoA / 180 * 1.856) * 100) / 100).replace('.', app.dec), Math.round(sv.comp.servoA))}`;
      html += `<br><small>${tl('Clic droit ou Suppr : retirer le fil')}</small>`;
    }
    el.style.cursor = c && sim && (c.type === 'button' || c.type === 'joystick') ? 'pointer' : c && sim && c.type === 'pot' ? 'ns-resize' : c ? 'move' : pan ? 'grabbing' : 'grab';
    app.tip(html || null, e.clientX, e.clientY);
  }

  const ptrs = new Map();
  let pan = null, pinch = null, pressing = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.schInfo') || e.button > 0) return;
    el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], r = el.getBoundingClientRect();
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, cx: (a[0] + b[0]) / 2 - r.left, cy: (a[1] + b[1]) / 2 - r.top };
      pan = null; if (wiring && wiring.down) wiring = null; return;
    }
    const [x0, y0] = toMm(e);
    // Fil commencé par un clic : ce clic le termine sur une broche, ou l'annule ailleurs.
    if (wiring) { const p = dropAt(x0, y0); if (p) finishWire(p.r); else cancelWire(); return; }
    const pin = hitPin(x0, y0);
    if (pin) {
      wiring = { from: pin.r, x0: pin.x, y0: pin.y, dir: pin.dir, cur: [x0, y0], over: null, down: true, sx: e.clientX, sy: e.clientY, moved: false };
      hoverPin = null; hoverSym = null; wireTip(e); request(); return;
    }
    const [x, y] = [x0, y0], c = app.simOn() ? hitComp(x, y, true) : null;
    if (c && (c.type === 'button' || c.type === 'joystick')) { pressing = c; app.press(c, true); request(); return; }
    // Un symbole : clic = le sélectionner, glisser = le déplacer (le composant suit en 3D).
    const cs = hitComp(x, y, false) || (hitWire(x, y) ? null : hitComp(x, y, true));
    if (cs) { move = { c: cs, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false }; return; }
    pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(pinch.cx, pinch.cy, (pinch.s * d / pinch.d) / view.s); return;
    }
    if (move) {
      const dx = e.clientX - move.sx, dy = e.clientY - move.sy;
      if (!move.moved && Math.hypot(dx, dy) > 4) { move.moved = true; app.tip(null); el.style.cursor = 'grabbing'; }
      if (move.moved) {
        move.dx = dx / view.s; move.dy = dy / view.s;
        const g = symEls.get(move.c); if (g) g.setAttribute('transform', `translate(${n3(move.dx)} ${n3(move.dy)})`);
        request();
      }
      return;
    }
    if (pan) {
      if (Math.hypot(e.clientX - pan.x, e.clientY - pan.y) > 3) pan.moved = true;
      view.x = pan.vx - (e.clientX - pan.x) / view.s; view.y = pan.vy - (e.clientY - pan.y) / view.s; userMoved = true; apply(); return;
    }
    if (wiring) {
      hoverEv = e; wiring.cur = toMm(e);
      if (wiring.down && Math.hypot(e.clientX - wiring.sx, e.clientY - wiring.sy) > 5) wiring.moved = true;
      const p = dropAt(wiring.cur[0], wiring.cur[1]);
      if (p) { const a = L.of(wiring.from), b = L.of(p.r); wiring.over = { ...p, joined: !!a && a === b && a.pins.length > 1 }; }
      else wiring.over = null;
      el.style.cursor = 'crosshair'; wireTip(e); request(); return;
    }
    if (!pressing) hover(e);
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    // Glissé jusqu'à une broche : on relie. Simple clic sur la broche : le fil suit la souris jusqu'au clic suivant.
    if (wiring && wiring.down) {
      wiring.down = false;
      if (wiring.over) finishWire(wiring.over.r);
      else if (wiring.moved || e.type === 'pointercancel') cancelWire();
    }
    if (pressing) { app.press(pressing, false); pressing = null; request(); }
    if (move) {
      const m = move; move = null;
      if (m.moved && e.type !== 'pointercancel') { userMoved = true; app.moveBy(m.c, m.dx, m.dy); } // le schéma se redessine
      else { const g = symEls.get(m.c); if (g) g.removeAttribute('transform'); if (!m.moved) app.select(m.c); }
      request();
    }
    if (pan && !pan.moved && e.type === 'pointerup' && ptrs.size === 0 && app.selected && app.selected()) { app.select(null); request(); } // clic dans le vide
    if (ptrs.size < 2) pinch = null;
    pan = null; el.style.cursor = 'grab';
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', () => { hoverEv = null; if (hoverPin || hoverSym) { hoverPin = null; hoverSym = null; request(); } if (!wiring) app.tip(null); });
  el.addEventListener('contextmenu', e => {
    if (e.target.closest('.schInfo')) return;
    e.preventDefault();
    if (wiring) { cancelWire(); return; }
    const [x, y] = toMm(e); cut(cutTarget(x, y));
  });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || el.hidden) return;
    if (wiring) cancelWire();
    else if (move) { const g = symEls.get(move.c); if (g) g.removeAttribute('transform'); move = null; request(); }
  });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const r = el.getBoundingClientRect(), [x, y] = toMm(e);
    const c = app.simOn() && !e.ctrlKey ? hitComp(x, y, true) : null;
    if (c && c.type === 'pot') {
      const v = clamp(Math.round((c.inp.pos ?? 50) + (e.deltaY < 0 ? 5 : -5)), 0, 100);
      if (v !== c.inp.pos) app.setInput(c, 'pos', v);
      hoverAt = 0; hover(e); return;
    }
    const trackpad = !e.ctrlKey && (Math.abs(e.deltaX) > 0.5 || (e.deltaMode === 0 && !Number.isInteger(e.deltaY)));
    if (trackpad || e.shiftKey) { panBy(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, e.shiftKey && !e.deltaX ? 0 : e.deltaY); return; }
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });
  el.addEventListener('dblclick', e => {
    if (e.target.closest('.schInfo')) return;
    const [x, y] = toMm(e), c = hitComp(x, y, true);
    if (c && !app.simOn()) app.locate(c); else if (!c) fit();
  });

  new ResizeObserver(() => { if (el.hidden) return; measure(); if (!userMoved) fit(true); else apply(); }).observe(el);
  // Toute modification du montage (projet ouvert, annulation…) : la signature est revérifiée chaque seconde.
  setInterval(() => { if (!el.hidden && !document.hidden) { dirty = true; ensure(); } }, 1000);
  // L'infobulle ouverte suit les valeurs.
  setInterval(() => { if (!el.hidden && hoverEv && app.simOn() && !document.hidden) paintHover(); }, 300);

  return {
    el,
    get visible() { return !el.hidden; },
    show() { el.hidden = false; dirty = true; measure(); ensure(); if (!userMoved) fit(true); else apply(); },
    hide() { el.hidden = true; hoverEv = null; wiring = null; hoverPin = null; hoverSym = null; move = null; app.tip(null); if (pressing) { app.press(pressing, false); pressing = null; } },
    /** Suppr sur le schéma : retire les fils de la broche ou de la liaison survolée. */
    cutHover() { if (!hoverEv || el.hidden || !L) return false; const [x, y] = toMm(hoverEv), t = cutTarget(x, y); cut(t); return !!t; },
    cancelWire,
    get wiring() { return !!wiring; },
    /** Le montage a peut-être changé : vérifié à la prochaine image (sans rien refaire s'il est identique). */
    dirty() { dirty = true; if (!el.hidden) { clearTimeout(dirtyT); dirtyT = setTimeout(() => { ensure(); request(); }, 120); } },
    /** Image de simulation (appelée par la boucle de rendu tant que la vue est visible). */
    frame(now) {
      if (el.hidden) return;
      ensure();
      const dc = app.simOn() ? app.dc() : null;
      if (!dc) { if (lanes.length) { lanes = []; } }
      else if (L && dc !== lanesDc && now - lanesAt >= (app.light ? 200 : 100)) { lanesDc = dc; lanesAt = now; try { computeLanes(dc); } catch (e) { console.error(e); lanes = []; } }
      draw(now);
    },
    clear() { lanes = []; lanesDc = null; phases.clear(); lastT = 0; request(); },
    fit: () => fit(false),
    panBy,
    /* Navigation (src/ui/navdock.js). 100 % : le schéma à sa taille réelle d'impression (1 mm = 96/25,4 pixels). */
    zoomAt: (f, x, y) => zoomAt(x == null ? W / 2 : x, y == null ? H / 2 : y, f),
    zoomPct: () => view.s / (96 / 25.4) * 100,
    setZoomPct: p => zoomAt(W / 2, H / 2, (p / 100) * (96 / 25.4) / view.s),
    /** Cadre le composant choisi ; faux s'il n'y en a pas (ou s'il n'est pas dessiné). */
    fitSel() {
      const c = app.selected ? app.selected() : null, h = c && hits.find(x => x.c === c); if (!h) return false;
      const m = 14; frameMm([h.all[0] - m, h.all[1] - m, h.all[2] + m, h.all[3] + m], 10); return true;
    },
    /** Mini-carte : emprise du schéma, symboles, partie visible (mm). */
    mini() {
      if (!box || el.hidden) return null;
      const c = app.selected ? app.selected() : null;
      return { bounds: box, boxes: hits.map(h => [h.body[0], h.body[1], h.body[2] - h.body[0], h.body[3] - h.body[1], h.c === c]), view: [view.x, view.y, view.x + W / view.s, view.y + H / view.s] };
    },
    centerOn(x, y) { view.x = x - W / 2 / view.s; view.y = y - H / 2 / view.s; userMoved = true; apply(); },
    get values() { return values; },
    set values(v) { values = !!v; try { localStorage.setItem('jollof-sch-values', values ? '1' : '0'); } catch (e) { /* stockage indisponible */ } request(); },
    /** Centre d'un composant à l'écran (coordonnées de la fenêtre), ou null s'il n'est pas dessiné. */
    screenOf(c) {
      const h = hits.find(x => x.c === c); if (!h) return null;
      const r = el.getBoundingClientRect();
      return [r.left + ((h.body[0] + h.body[2]) / 2 - view.x) * view.s, r.top + ((h.body[1] + h.body[3]) / 2 - view.y) * view.s];
    },
    /** Point du schéma (mm) sous un point de la fenêtre, ou null hors de la vue. */
    mmAt(cx, cy) {
      if (el.hidden) return null;
      const r = el.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
      return [view.x + (cx - r.left) / view.s, view.y + (cy - r.top) / view.s];
    },
    /** Centre de la vue (mm). */
    centerMm: () => [view.x + W / 2 / view.s, view.y + H / 2 / view.s],
    /** Redessin demandé (sélection changée ailleurs…). */
    redraw: () => request(),
    /** Position à l'écran (fenêtre) d'une broche dessinée, ou null. */
    pinScreen(c, key) {
      const p = pinHits.find(h => !h.stub && h.r.comp === c && h.r.key === key); if (!p) return null;
      const r = el.getBoundingClientRect();
      return [r.left + (p.x - view.x) * view.s, r.top + (p.y - view.y) * view.s];
    },
    /** Pour les tests : liaisons, bouts de fil et points dessinés. */
    stats: () => ({ active: stateful.filter(g => liveActive(g.st)).map(g => g.c.name), states: Object.fromEntries(stateful.map(g => [g.c.name, g.st])), links: L ? L.links.length : 0, stubs: L ? L.stubs.length : 0, junctions: L ? L.junctions.length : 0, routed: L ? L.routed.size : 0, nets: L ? L.nets.length : 0, lanes: lanes.length, moving: lanes.filter(l => Math.abs(l.mA) >= 0.01).length, dots: lanes.reduce((t, l) => t + (Math.abs(l.mA) >= 0.01 ? l.n : 0), 0), scale: view.s })
  };
}
