// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fond de plan vectoriel (DXF/DWG importé) de la vue Plans, chargé à la demande quand l'étage montré en a un : un
// canevas 2D sous le dessin SVG (pas de contexte WebGL), rendu par tuiles (plan-underlay-render.js), calques visibles,
// atténués, verrouillés ou recolorés, monochrome, opacité, couleurs adaptées au thème (la couleur 7 du DXF suit le texte
// de l'interface). Le fond se manipule : choisir des entités (clic, cadre, calque entier ; fiche : calque, genre,
// longueur, contours, poignées DXF), les convertir en murs, pièces ou cheminements, le placer sur l'étage (poignées de
// déplacement, rotation et échelle, valeurs, alignement sur deux points), l'aimantation des outils de dessin sur ses bouts
// et croisements, et le mettre à jour depuis une nouvelle version du fichier (plan-underlay-rev.js). Les données binaires
// (data.blobs) ne sont décodées qu'au premier affichage de l'étage. Modèle : voir src/net/cad/store.js.
import './plan-underlay.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { createSegRenderer, query, themeColor, ulMatrix, alignTwo, parseCss, lum, mix, css } from './plan-underlay-render.js';
import { dataUrlToBytes, blobBytes, rememberBlob, cadSession } from '../cad/store.js';
import { groupLayers, nodeLayers, searchLayers, guessKind } from './cadimport-logic.js';
import { entities, entSegs, pick, boxSelect, layerEnts, chainsOf, selInfo } from './underlay-edit.js';
import { uid, siteIds } from '../site.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r3 = v => Math.round(v * 1000) / 1000;
const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(isEn ? 'en' : 'fr-FR', { maximumFractionDigits: d });
// Modules d'autres équipes : chargés seulement s'ils existent.
const MODS = import.meta.glob(['../cad/underlay.js', '../cad/convert.js', '../route.js']);
const mod = p => (MODS[p] ? MODS[p]() : Promise.reject(new Error(p)));
const KIND_NAMES = () => ({ walls: tl('Murs'), partitions: tl('Cloisons'), doors: tl('Portes'), windows: tl('Fenêtres'), structure: tl('Structure'), elec: tl('Électricité'), cfo: tl('Courants forts'), cfa: tl('Courants faibles'), furniture: tl('Mobilier'), text: tl('Textes'), dims: tl('Cotes'), hatch: tl('Hachures'), other: tl('Autres') });

/**
 * host : { el (racine de la vue), stage, svg, view() → { x, y, k }, floor() → étage montré, repaint() (redessine la
 * vue), hidden(), cardChanged(on) }. Rend { paint(), snap(w, r), bounds(f), has(f), toggleCard(), key(e), … }.
 */
export function createUnderlayLayer(ctx, host) {
  const cv = document.createElement('canvas'); cv.className = 'ntUlCv'; cv.setAttribute('aria-hidden', 'true');
  host.stage.insertBefore(cv, host.stage.firstChild);
  const sc = document.createElement('canvas'); sc.className = 'ntUlCv ntUlSel'; sc.setAttribute('aria-hidden', 'true');
  host.stage.insertBefore(sc, cv.nextSibling);
  const marks = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); marks.setAttribute('class', 'ntUlMarks');
  host.stage.appendChild(marks);
  const card = document.createElement('div'); card.className = 'glass ntUlCard'; card.hidden = true;
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', tl('Fond de plan DXF'));
  host.el.appendChild(card);
  const coach = document.createElement('div'); coach.className = 'glass ntUlCoach'; coach.hidden = true; coach.setAttribute('role', 'status');
  host.el.appendChild(coach);
  const revInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.dxf,.dwg', hidden: true }); card.after(revInput);
  const cache = new Map(); // id du paquet → { st: 'load'|'ok'|'err', R, un, E (entités), H, diff, err, ms }
  const st = { mode: null, pts: [], keep: true, drag: null, q: '', open: new Set(), tree: null, sel: null, box: null, posOpen: false };
  let raf = 0, pending = false, lastMs = [];

  const data = () => ctx.data();
  const ulOf = f => (f && data().underlays ? data().underlays[f.id] : null) || null;
  const cur = () => { const f = host.floor(), u = ulOf(f), e = u && cache.get(u.id); return { f, u, e: e && e.st === 'ok' ? e : null }; };

  /* ---------- Chargement paresseux ---------- */
  /** Prépare une entrée à partir d'un paquet déballé (aussi utilisé par la mise à jour, sans redécoder). */
  function install(id, un, ms = 0) {
    // Paquet : mètres, y vers le haut depuis le coin bas-gauche de la zone ; le fond sur l'étage : y vers le bas depuis
    // le coin haut-gauche. Repère des tuiles (yUp) : y' = -y, donc fond = (x, y' + H).
    const texts = (un.texts || []).map(t => (typeof t.layer === 'number' ? t : { ...t, layer: 0 }));
    const e = { st: 'ok', un, H: un.bbox ? un.bbox[3] : 0, ms, ver: '', E: null };
    e.R = createSegRenderer({ segs: un.segs, segLayer: un.segLayer, segColor: un.segColor, texts }, { yUp: true, font: getComputedStyle(document.body).fontFamily });
    cache.set(id, e);
    return e;
  }
  function entry(u) {
    let e = cache.get(u.id); if (e) return e;
    e = { st: 'load' }; cache.set(u.id, e);
    const url = (data().blobs || {})[u.id];
    if (!url) { e.st = 'err'; e.err = 'nodata'; return e; }
    const t0 = performance.now();
    Promise.all([mod('../cad/underlay.js'), dataUrlToBytes(url)]).then(([m, bytes]) => {
      install(u.id, m.unpackUnderlay(u.pack || {}, bytes), performance.now() - t0);
      paint(); if (!card.hidden) paintCard();
    }).catch(err => { console.error(err); e.st = 'err'; e.err = String(err && err.message || err); if (!card.hidden) paintCard(); });
    return e;
  }
  const ents = e => e.E || (e.E = entities(e.un));

  /* ---------- Style ---------- */
  function themeKey() { const s = getComputedStyle(host.el); return s.getPropertyValue('--fg').trim() + '|' + s.getPropertyValue('--stage').trim(); }
  function styleFor(e, u) {
    const key = themeKey() + '|' + JSON.stringify([u.layers, u.mono]);
    if (e.ver === key) return;
    e.ver = key;
    const s = getComputedStyle(host.el), fg = parseCss(s.getPropertyValue('--fg')), bg = parseCss(s.getPropertyValue('--stage'));
    const by = new Map(u.layers.map(l => [l.id, l])), mono = css(mix(fg, bg, 0.25));
    // Contraste avec le fond de la scène : 3:1 pour les traits, 4,5:1 pour les calques de textes (seuils WCAG 2).
    const col = new Map(); for (const l of u.layers) col.set(l.id, l.on ? (u.mono ? mono : themeColor(l.color, fg, bg, guessKind(l.name) === 'text' ? 4.5 : 3)) : null);
    const pal = ((u.pack && u.pack.colors) || []).map(c => (u.mono ? mono : themeColor(String(c), fg, bg)));
    // Couleur choisie par l'utilisateur : elle l'emporte sur les couleurs propres des entités.
    e.R.setStyle({ color: (id, c) => (col.get(id) ? (c && !(by.get(id) || {}).recolor && pal[c - 1]) || col.get(id) : null), alpha: id => (by.get(id) && by.get(id).dim ? 0.32 : 1), width: Math.min(2, window.devicePixelRatio || 1) > 1.5 ? 1.25 : 1 });
  }
  const hiddenL = u => { const m = new Map(u.layers.map(l => [l.id, l])); return l => { const x = m.get(l); return !x || !x.on || x.lock; }; };

  /* ---------- Dessin ---------- */
  function matrixOf(u, V, dpr, H) {
    const T = ulMatrix(u.transform), K = V.k * dpr, m = T.m;
    return [m[0] * K, m[1] * K, m[2] * K, m[3] * K, (m[4] + m[2] * H - V.x) * K, (m[5] + m[3] * H - V.y) * K];
  }
  function paintNow() {
    raf = 0;
    const f = host.floor(), u = ulOf(f), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = host.stage.clientWidth, h = host.stage.clientHeight, W = Math.round(w * dpr), H = Math.round(h * dpr);
    for (const c of [cv, sc]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = cv.getContext('2d'), gs = sc.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); gs.setTransform(1, 0, 0, 1, 0, 0); gs.clearRect(0, 0, W, H);
    paintMarks();
    if (cadSession.coach && f && cadSession.coach.floor === f.id && !host.hidden()) showCoach(cadSession.coach);
    if (!u || !u.on || host.hidden()) { cv.hidden = true; sc.hidden = true; return; }
    cv.hidden = false; sc.hidden = false; cv.style.opacity = String(u.opacity);
    const e = entry(u); if (e.st !== 'ok') return;
    styleFor(e, u);
    const M = matrixOf(u, host.view(), dpr, e.H);
    const t0 = performance.now(), done = e.R.draw(g, M, W, H, 10);
    lastMs.push(performance.now() - t0); if (lastMs.length > 240) lastMs.shift();
    paintSel(gs, e, M, dpr);
    if (!done) { pending = true; raf = requestAnimationFrame(paintNow); } else pending = false;
  }
  function paint() { if (!raf) raf = requestAnimationFrame(paintNow); }
  /** Sélection et changements d'une nouvelle version, au-dessus du fond (traits épais, directs, bornés). */
  function paintSel(g, e, M, dpr) {
    const s = getComputedStyle(host.el), un = e.un, P = (x, y) => [M[0] * x - M[2] * y + M[4], M[1] * x - M[3] * y + M[5]];
    const stroke = (segs, idx, color, w, dash) => {
      g.beginPath(); let n = 0;
      const each = i => { const p = i * 4, a = P(segs[p], segs[p + 1]), b = P(segs[p + 2], segs[p + 3]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); n++; };
      if (idx) { for (const i of idx) { each(i); if (n > 300000) break; } } else for (let i = 0, m = Math.min(segs.length / 4, 300000); i < m; i++) each(i);
      g.strokeStyle = color; g.lineWidth = w * dpr; g.lineCap = 'round'; g.setLineDash(dash ? dash.map(v => v * dpr) : []); g.stroke();
    };
    if (e.diff && e.diff.show) {
      stroke(e.diff.removed, null, s.getPropertyValue('--nt-ul-del').trim() || '#ef4444', 2.2, [5, 4]);
      stroke(e.diff.added, null, s.getPropertyValue('--nt-ul-add').trim() || '#22c55e', 2.4);
    }
    if (st.sel && st.sel.id === e.un && st.sel.ents.size) {
      const E = ents(e), idx = []; for (const k of st.sel.ents) for (const i of entSegs(E, k)) idx.push(i);
      stroke(un.segs, idx, s.getPropertyValue('--accent').trim() || '#3b82f6', 2.6);
    }
  }

  /* ---------- Repères : fond ↔ étage ---------- */
  /** Étage (m) → repère du paquet (m, y vers le haut). */
  const toUn = (u, e, w) => { const p = ulMatrix(u.transform).from(w[0], w[1]); return [p[0], e.H - p[1]]; };
  /** Repère du paquet → étage. */
  const fromUn = (u, e, x, y) => ulMatrix(u.transform).to(x, e.H - y);

  /* ---------- Aimantation ---------- */
  /** Point du fond le plus proche de w (m, étage) dans le rayon r (m) : bout ou croisement visible. */
  function snap(w, r) {
    const { u, e } = cur(); if (!u || !u.on || !e) return null;
    // (aimant du moteur de rendu : il ignore les calques masqués, à la différence de snapPoints du paquet ; un calque
    // verrouillé reste aimanté, comme dans les logiciels de DAO)
    const T = ulMatrix(u.transform), p = toUn(u, e, w), q = e.R.snap(p[0], p[1], r / T.s);
    return q ? fromUn(u, e, q.x, q.y).map(r3) : null;
  }
  /** Emprise du fond sur l'étage (m). */
  function quad(u, e) {
    let b = e ? e.R.bounds() : null;
    if (b) b = [b[0], b[1] + e.H, b[2], b[3] + e.H];
    if (!b) { const R = u.region, m = u.toMetre; b = [0, 0, (R[2] - R[0]) * m, (R[3] - R[1]) * m]; }
    const T = ulMatrix(u.transform);
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(p => T.to(p[0], p[1]));
  }
  function bounds(f) {
    const u = ulOf(f); if (!u || !u.on) return null;
    const e = cache.get(u.id), P = quad(u, e && e.st === 'ok' ? e : null);
    return [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))];
  }

  /* ---------- Repères à l'écran (alignement, poignées, cadre) ---------- */
  const toS = p => { const V = host.view(); return [(p[0] - V.x) * V.k, (p[1] - V.y) * V.k]; };
  /** Poignées du mode « placer » : cadre du fond, rotation (au-dessus du milieu du haut), échelle (coin bas droit). */
  function handlesOf(u, e) {
    const Q = quad(u, e).map(toS), c = [(Q[0][0] + Q[2][0]) / 2, (Q[0][1] + Q[2][1]) / 2];
    const top = [(Q[0][0] + Q[1][0]) / 2, (Q[0][1] + Q[1][1]) / 2], dx = top[0] - c[0], dy = top[1] - c[1], L = Math.hypot(dx, dy) || 1;
    return { Q, c, rot: [top[0] + dx / L * 26, top[1] + dy / L * 26], top, scale: Q[2] };
  }
  function paintMarks() {
    let h = '';
    const { u, e } = cur();
    if (st.mode === 'move' && u) {
      const H = handlesOf(u, e);
      h += `<polygon class="frm" points="${H.Q.map(p => p.join(',')).join(' ')}"/><line class="frm" x1="${H.top[0]}" y1="${H.top[1]}" x2="${H.rot[0]}" y2="${H.rot[1]}"/>`;
      h += `<circle class="hdl" cx="${H.rot[0]}" cy="${H.rot[1]}" r="7"/><rect class="hdl" x="${H.scale[0] - 6}" y="${H.scale[1] - 6}" width="12" height="12"/><circle class="ctr" cx="${H.c[0]}" cy="${H.c[1]}" r="3"/>`;
    }
    if (st.mode === 'align') {
      st.pts.forEach((p, i) => { const [x, y] = toS(p); const src = i < 2; h += `<g class="${src ? 'src' : 'dst'}"><circle cx="${x}" cy="${y}" r="6"/><text x="${x + 9}" y="${y - 8}">${src ? 'A' : 'B'}${(i % 2) + 1}</text></g>`; });
      for (const [a, b] of [[0, 2], [1, 3]]) if (st.pts[a] && st.pts[b]) { const p = toS(st.pts[a]), q = toS(st.pts[b]); h += `<line class="lnk" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`; }
    }
    if (st.box) { const [a, b] = st.box, x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]); h += `<rect class="box ${b[0] < a[0] ? 'cross' : 'win'}" x="${x}" y="${y}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}"/>`; }
    marks.innerHTML = h;
  }
  /** Sommets des murs et pièces de l'étage (cibles de l'alignement). */
  function floorSnap(w, r) {
    const f = host.floor(); if (!f) return null; let best = null, bd = r;
    const see = q => { const d = Math.hypot(q[0] - w[0], q[1] - w[1]); if (d < bd) { bd = d; best = q; } };
    for (const x of f.walls) { see(x.a); see(x.b); } for (const x of f.rooms) x.poly.forEach(see);
    return best ? [best[0], best[1]] : null;
  }
  const svgRect = () => host.svg.getBoundingClientRect();
  const toW = (cx, cy) => { const r = svgRect(), V = host.view(); return [V.x + (cx - r.left) / V.k, V.y + (cy - r.top) / V.k]; };
  function setMode(m) {
    st.mode = m; st.pts = []; st.drag = null; st.box = null;
    host.stage.classList.toggle('ntUlMoving', m === 'move'); host.stage.classList.toggle('ntUlAligning', m === 'align'); host.stage.classList.toggle('ntUlPicking', m === 'pick');
    paintMarks(); paintCard();
    if (m === 'align') ctx.status(tl('Alignement : cliquez deux points du fond (A1, A2), puis les deux points de l’étage où ils doivent aller (B1, B2).'));
    else if (m === 'move') ctx.status(tl('Placer le fond : glisser pour déplacer, la poignée ronde pour tourner (Maj : par 15°), la carrée pour l’échelle ; Échap pour finir.'));
    else if (m === 'pick') ctx.status(tl('Choisir dans le fond : clic (Maj : ajouter), cadre de gauche à droite : entités entières, de droite à gauche : entités touchées ; Échap pour finir.'));
  }

  /* ---------- Gestes (écoute en capture sur la scène : les outils du plan ne les reçoivent pas) ---------- */
  host.stage.addEventListener('pointerdown', ev => {
    if (!st.mode || ev.button !== 0 || host.hidden()) return;
    const { u, e } = cur(); if (!u) { setMode(null); return; }
    ev.stopPropagation(); ev.preventDefault();
    const w = toW(ev.clientX, ev.clientY), V = host.view(), r = svgRect(), sp = [ev.clientX - r.left, ev.clientY - r.top];
    if (st.mode === 'move') {
      const H = handlesOf(u, e), near = p => Math.hypot(p[0] - sp[0], p[1] - sp[1]) < 11;
      const c = toW(H.c[0] + r.left, H.c[1] + r.top), local = toUn(u, e || { H: 0 }, c);
      st.drag = { kind: near(H.rot) ? 'rot' : near(H.scale) ? 'scale' : 'move', w, c, local, t: { ...u.transform } };
      host.stage.setPointerCapture(ev.pointerId); return;
    }
    if (st.mode === 'pick') { st.drag = { kind: 'pick', s0: sp, w, add: ev.shiftKey }; host.stage.setPointerCapture(ev.pointerId); return; }
    const src = st.pts.length < 2, q = (src ? snap(w, 10 / V.k) : floorSnap(w, 10 / V.k)) || w;
    st.pts.push(q); paintMarks();
    if (st.pts.length === 4) {
      const T = ulMatrix(u.transform), p1 = T.from(...st.pts[0]), p2 = T.from(...st.pts[1]);
      const t = alignTwo(p1, p2, st.pts[2], st.pts[3], u.transform.scale, st.keep);
      if (!t) { ctx.status(tl('Points trop proches : recommencez.'), 'warn'); st.pts = []; paintMarks(); return; }
      const k = t.scale / u.transform.scale;
      u.transform = { dx: r3(t.dx), dy: r3(t.dy), rot: Math.round(t.rot * 1000) / 1000, scale: t.scale };
      setMode(null); ctx.commit(); paint();
      ctx.status(st.keep ? tl('Fond aligné (rotation {0}°).', fmt(t.rot, 2)) : tl('Fond aligné (rotation {0}°, échelle × {1}).', fmt(t.rot, 2), fmt(k, 4)), 'ok');
    } else ctx.status(st.pts.length < 2 ? tl('Point A{0} du fond.', st.pts.length + 1) : tl('Point B{0} de l’étage (sommet d’un mur ou d’une pièce).', st.pts.length - 1));
  }, true);
  host.stage.addEventListener('pointermove', ev => {
    const d = st.drag; if (!d || host.hidden()) return;
    ev.stopPropagation();
    const { u, e } = cur(); if (!u) return;
    const w = toW(ev.clientX, ev.clientY), r = svgRect();
    if (d.kind === 'pick') { const sp = [ev.clientX - r.left, ev.clientY - r.top]; if (st.box || Math.hypot(sp[0] - d.s0[0], sp[1] - d.s0[1]) > 4) { st.box = [d.s0, sp]; paintMarks(); } return; }
    const t = u.transform;
    if (d.kind === 'move') { t.dx = r3(d.t.dx + w[0] - d.w[0]); t.dy = r3(d.t.dy + w[1] - d.w[1]); }
    else {
      if (d.kind === 'rot') {
        let a = d.t.rot + (Math.atan2(w[1] - d.c[1], w[0] - d.c[0]) - Math.atan2(d.w[1] - d.c[1], d.w[0] - d.c[0])) * 180 / Math.PI;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        t.rot = Math.round((((a % 360) + 360) % 360) * 1000) / 1000;
        ctx.status(tl('Rotation {0}°', fmt(t.rot, 2)));
      } else {
        const k = Math.hypot(w[0] - d.c[0], w[1] - d.c[1]) / Math.max(1e-9, Math.hypot(d.w[0] - d.c[0], d.w[1] - d.c[1]));
        t.scale = Math.max(1e-4, Math.min(1e4, d.t.scale * k));
        ctx.status(tl('Échelle × {0} (les unités du fichier étaient-elles fausses ?)', fmt(t.scale, 4)));
      }
      // Le centre reste en place : on recale le décalage.
      t.dx = d.t.dx; t.dy = d.t.dy; const q = ulMatrix(t).to(d.local[0], (e ? e.H : 0) - d.local[1]);
      t.dx = r3(t.dx + d.c[0] - q[0]); t.dy = r3(t.dy + d.c[1] - q[1]);
    }
    paint();
  }, true);
  host.stage.addEventListener('pointerup', ev => {
    const d = st.drag; if (!d) return; ev.stopPropagation(); st.drag = null;
    if (d.kind === 'pick') { finishPick(d, ev); return; }
    ctx.commit(); paintCard(); paintMarks();
  }, true);

  /* ---------- Choix d'entités ---------- */
  function finishPick(d, ev) {
    const { u, e } = cur(); const box = st.box; st.box = null; paintMarks();
    if (!u || !e) return;
    const E = ents(e), skip = hiddenL(u), T = ulMatrix(u.transform), V = host.view(), r = svgRect();
    let got = [];
    if (box) {
      const P = [box[0], [box[1][0], box[0][1]], box[1], [box[0][0], box[1][1]]].map(p => toUn(u, e, toW(p[0] + r.left, p[1] + r.top)));
      const b = [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))];
      const cand = []; query(e.R.index(), b[0], b[1], b[2], b[3], i => cand.push(i));
      got = boxSelect(e.un, E, cand, b, box[1][0] < box[0][0], skip);
    } else {
      const p = toUn(u, e, d.w), rr = 6 / V.k / T.s, cand = [];
      query(e.R.index(), p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr, i => cand.push(i));
      const k = pick(e.un, E, cand, p[0], p[1], rr, skip); if (k >= 0) got = [k];
    }
    select(got, d.add || ev.shiftKey, !box && d.add);
  }
  /** Change la sélection : add (ajouter), toggle (un clic Maj sur une entité déjà choisie la retire). */
  function select(list, add = false, toggle = false) {
    const { e } = cur(); if (!e) return;
    if (!st.sel || st.sel.id !== e.un || !add) st.sel = { id: e.un, ents: new Set() };
    for (const k of list) { if (toggle && st.sel.ents.has(k)) st.sel.ents.delete(k); else st.sel.ents.add(k); }
    paint(); paintCard();
    if (list.length || st.sel.ents.size) ctx.status(tl('{0} entité(s) choisie(s) dans le fond.', st.sel.ents.size));
  }
  const selList = () => { const { e } = cur(); return e && st.sel && st.sel.id === e.un ? [...st.sel.ents] : []; };
  /** Segments choisis, en mètres de l'étage : [[x0, y0, x1, y1], …], et chaînes (contours fermés, lignes). */
  function selGeometry() {
    const { u, e } = cur(); if (!u || !e) return null;
    const E = ents(e), idx = []; for (const k of selList()) for (const i of entSegs(E, k)) idx.push(i);
    const s = e.un.segs, segs = idx.map(i => { const p = i * 4, a = fromUn(u, e, s[p], s[p + 1]), b = fromUn(u, e, s[p + 2], s[p + 3]); return [r3(a[0]), r3(a[1]), r3(b[0]), r3(b[1])]; });
    const chains = chainsOf(e.un, idx, (e.un.step || 0.001) * 2).map(c => { const pts = []; for (let j = 0; j < c.pts.length; j += 2) pts.push(fromUn(u, e, c.pts[j], c.pts[j + 1]).map(r3)); return { pts, closed: c.closed }; });
    return { segs, chains, idx };
  }

  /* ---------- Conversion de la sélection ---------- */
  async function convertSel(kind) {
    const f = host.floor(), g = selGeometry(); if (!f || !g || !g.segs.length) return;
    let m = null; try { m = await mod('../cad/convert.js'); } catch (err) { /* conversion de secours ci-dessous */ }
    // Conversion du module des plans quand elle existe ; sinon la nôtre (modèle simplifié, dit dans le message).
    if (m && typeof m.convertSelection === 'function') {
      // (genres du module des plans : walls, partitions, rooms, data, power ; un cheminement de réseau = data)
      try {
        const r = await m.convertSelection(ctx, f, g.segs, kind === 'paths' ? 'data' : kind) || {}; ctx.commit(); select([]); host.repaint();
        const any = (r.walls || 0) + (r.rooms || 0) + (r.paths || 0);
        ctx.status(any ? tl('Depuis la sélection : {0} mur(s), {1} pièce(s), {2} cheminement(s) (modèle simplifié, à vérifier).', r.walls || 0, r.rooms || 0, r.paths || 0) : tl('Rien de reconnu dans la sélection pour ce genre d’objet.'), any ? 'ok' : 'warn');
      } catch (err) { console.error(err); ctx.status(tl('La conversion de la sélection a échoué.'), 'err'); }
      return;
    }
    const d = data(), ids = siteIds(d.site), tag = 'cad:' + f.id + ':sel'; let n = 0;
    if (kind === 'walls' || kind === 'partitions') {
      let walls = [];
      if (m && m.pairWalls && m.mergeWalls) { const tol = m.CONVERT_TOL; walls = m.mergeWalls(m.pairWalls(g.segs, tol, 0.1), [], tol); if (m.cleanCorners) walls = m.cleanCorners(walls); }
      else walls = g.segs.filter(s => Math.hypot(s[2] - s[0], s[3] - s[1]) > 0.3).map(s => ({ a: [s[0], s[1]], b: [s[2], s[3]], t: 0.1 }));
      for (const w of walls) { if (Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 0.05) continue; f.walls.push({ id: uid('', 'w', ids), a: w.a.map(r3), b: w.b.map(r3), t: r3(Math.max(0.01, Math.min(2, w.t || 0.1))), mat: w.mat || 'block', src: tag }); n++; }
      ctx.status(n ? tl('{0} mur(s) créé(s) depuis la sélection (modèle simplifié : traits doubles → mur d’axe médian).', n) : tl('Aucun mur reconnu dans la sélection (il faut des traits de plus de 30 cm).'), n ? 'ok' : 'warn');
    } else if (kind === 'rooms') {
      for (const c of g.chains.filter(c => c.closed && c.pts.length >= 3)) { f.rooms.push({ id: uid('', 'rm', ids), name: '', usage: 'office', poly: c.pts, src: tag }); n++; }
      ctx.status(n ? tl('{0} pièce(s) créée(s) depuis les contours fermés choisis : nommez-les dans l’inspecteur.', n) : tl('Aucun contour fermé dans la sélection.'), n ? 'ok' : 'warn');
    } else if (kind === 'paths') {
      const route = await mod('../route.js'), pids = new Set((d.paths || []).map(p => p.id)); let i = 1;
      for (const c of g.chains.filter(c => c.pts.length >= 2)) {
        while (pids.has('pa' + i)) i++; pids.add('pa' + i);
        const p = route.cleanPaths([{ id: 'pa' + i, floor: f.id, kind: 'tray', pts: (c.closed ? [...c.pts, c.pts[0]] : c.pts).slice(0, 400) }])[0];
        if (p) { p.src = tag; (d.paths = d.paths || []).push(p); n++; }
      }
      ctx.status(n ? tl('{0} cheminement(s) créé(s) depuis la sélection (genre : chemin de câbles, à changer dans l’inspecteur).', n) : tl('Aucun tracé dans la sélection.'), n ? 'ok' : 'warn');
    }
    if (n) { ctx.commit(); select([]); host.repaint(); }
  }

  /* ---------- Carte du fond ---------- */
  function selHtml(u, e) {
    const list = selList(); if (!list.length) return '';
    const info = selInfo(e.un, ents(e), list, e.un.step || 0.001), s = ulMatrix(u.transform).s, K = KIND_NAMES();
    const names = new Map(u.layers.map(l => [l.id, l.name]));
    const lay = [...info.layers].map(([l, n]) => `${esc(names.get(l) || '?')} (${n})`).join(', ');
    const kinds = [...new Set([...info.layers.keys()].map(l => K[guessKind(names.get(l) || '')]))].join(', ');
    const types = (u.pack && u.pack.entTypes) ? [...info.types].map(([t, n]) => `${esc(u.pack.entTypes[t] || '?')} ×${n}`).join(', ') : '';
    const b = info.box;
    return `<section class="ntUlSelBox" aria-live="polite"><div class="ntUlSelHd"><b>${icon('pointer')}${esc(tl('Sélection · {0} entité(s)', info.ents))}</b>
        <button type="button" class="ntUlIc on" data-ul="selLayer" data-tip="${esc(tl('Tout le calque'))}" aria-label="${esc(tl('Tout le calque'))}">${icon('layers')}</button>
        <button type="button" class="ntUlIc on" data-ul="selHide" data-tip="${esc(tl('Masquer ce(s) calque(s)'))}" aria-label="${esc(tl('Masquer ce(s) calque(s)'))}">${icon('eyeOff')}</button>
        <button type="button" class="ntUlIc on" data-ul="selLock" data-tip="${esc(tl('Verrouiller ce(s) calque(s)'))}" aria-label="${esc(tl('Verrouiller ce(s) calque(s)'))}">${icon('lock')}</button>
        <button type="button" class="ntUlIc on" data-ul="selClear" data-tip="${esc(tl('Désélectionner'))}" aria-label="${esc(tl('Désélectionner'))}">${icon('x')}</button></div>
      <dl class="ntUlDl"><dt>${esc(tl('Calques'))}</dt><dd title="${lay}">${lay}</dd><dt>${esc(tl('Genre'))}</dt><dd>${esc(kinds)}</dd>
        <dt>${esc(tl('Longueur'))}</dt><dd>${esc(tl('{0} m · {1} segments', fmt(info.length * s, 2), info.segs))}</dd>
        ${info.closed ? `<dt>${esc(tl('Contours fermés'))}</dt><dd>${esc(tl('{0} · {1} m²', info.closed, fmt(info.area * s * s, 2)))}</dd>` : ''}
        ${b ? `<dt>${esc(tl('Emprise'))}</dt><dd>${esc(tl('{0} × {1} m', fmt((b[2] - b[0]) * s, 2), fmt((b[3] - b[1]) * s, 2)))}</dd>` : ''}
        ${info.handles.length ? `<dt>${esc(tl('Poignées DXF'))}</dt><dd class="mono" title="${esc(info.handles.join(' '))}">${esc(info.handles.slice(0, 6).join(' '))}${info.handles.length > 6 || info.ents > info.handles.length ? ' …' : ''}</dd>` : ''}
        ${types ? `<dt>${esc(tl('Entités DXF'))}</dt><dd>${types}</dd>` : ''}</dl>
      <div class="ntUlSelAct" role="group" aria-label="${esc(tl('Convertir en'))}"><span class="mut">${esc(tl('Convertir en'))}</span>
        <button type="button" class="btn small" data-ulconv="walls" data-tip="${esc(tl('Murs'))}">${icon('wall')}<span>${esc(tl('Murs'))}</span></button>
        <button type="button" class="btn small" data-ulconv="partitions">${esc(tl('Cloisons'))}</button>
        <button type="button" class="btn small" data-ulconv="rooms">${icon('room')}<span>${esc(tl('Salles'))}</span></button>
        <button type="button" class="btn small" data-ulconv="paths" data-tip="${esc(tl('Cheminements'))}" aria-label="${esc(tl('Cheminements'))}">${icon('cableTray')}</button></div></section>`;
  }
  function paintCard() {
    if (card.hidden) return;
    const f = host.floor(), u = ulOf(f);
    if (!u) { card.innerHTML = `<div class="ntUlHd">${icon('layers')}<b>${tl('Fond de plan DXF')}</b><button type="button" class="tb" data-ul="close" aria-label="${tl('Fermer')}">${icon('x')}</button></div><p class="mut">${tl('Pas de fond sur cet étage.')}</p><button type="button" class="btn small primary" data-ul="import">${icon('upload')}<span>${tl('Importer un plan DXF/DWG…')}</span></button>`; return; }
    const raw = cache.get(u.id), e = raw && raw.st === 'ok' ? raw : null, q = st.q.trim();
    const nOn = u.layers.filter(l => l.on).length, bytes = blobBytes((data().blobs || {})[u.id]);
    const t = u.transform, rev = u.rev;
    card.innerHTML = `<div class="ntUlHd">${icon('layers')}<b title="${esc(u.source.file)}">${esc(u.name || u.source.file || tl('Fond de plan DXF'))}</b>
      <label class="ntUlSw" data-tip="${esc(tl('Afficher le fond'))}"><input type="checkbox" data-ul="on"${u.on ? ' checked' : ''} aria-label="${esc(tl('Afficher le fond'))}"><span></span></label>
      <button type="button" class="tb" data-ul="close" aria-label="${tl('Fermer')}">${icon('x')}</button></div>
      <div class="ntUlMeta mut">${esc(tl('{0} segments · {1} textes · {2}', fmtK(u.stats.segs), fmtK(u.stats.texts), fmtBytes(bytes)))}${raw && raw.st === 'load' ? ' · ' + tl('chargement…') : ''}${raw && raw.st === 'err' ? ` · <span class="bad">${tl('données illisibles')}</span>` : ''}</div>
      ${rev ? `<div class="ntUlRev">${icon('history')}<span>${esc(tl('Version {0} · {1} : +{2} −{3} ~{4}', rev.n + 1, rev.file, rev.added, rev.removed, rev.changed))}</span>${e && e.diff ? `<button type="button" class="btn small subtle" data-ul="diffShow" aria-pressed="${!!e.diff.show}">${esc(e.diff.show ? tl('Masquer les changements') : tl('Surligner les changements'))}</button>` : ''}</div>` : ''}
      <div class="ntUlTools" role="group" aria-label="${esc(tl('Outils du fond'))}">
        <button type="button" class="btn small" data-ul="pick" aria-pressed="${st.mode === 'pick'}" data-tip="${esc(tl('Choisir des entités du fond (clic, cadre)'))}">${icon('pointer')}<span>${tl('Choisir')}</span></button>
        <button type="button" class="btn small" data-ul="move" aria-pressed="${st.mode === 'move'}" data-tip="${esc(tl('Déplacer, tourner, mettre à l’échelle avec les poignées'))}">${icon('hand')}<span>${tl('Placer')}</span></button>
        <button type="button" class="btn small" data-ul="align" aria-pressed="${st.mode === 'align'}" data-tip="${esc(tl('Aligner sur 2 points'))}">${icon('target')}<span>${tl('Aligner')}</span></button>
        <span class="grow"></span><button type="button" class="ntUlIc${st.compact ? ' on' : ''}" data-ul="compact" aria-pressed="${!!st.compact}" data-tip="${esc(tl('Carte réduite : sans la liste des calques'))}" aria-label="${esc(tl('Carte réduite : sans la liste des calques'))}">${icon(st.compact ? 'chevDown' : 'chevUp')}</button></div>
      ${e ? selHtml(u, e) : ''}
      ${st.compact ? '' : `<div class="ntUlRow"><label class="ntUlOp"><span>${tl('Opacité')}</span><input type="range" min="5" max="100" step="5" value="${Math.round(u.opacity * 100)}" data-ul="opacity"><output>${Math.round(u.opacity * 100)} %</output></label>
        <label class="ntChk"><input type="checkbox" data-ul="mono"${u.mono ? ' checked' : ''}><span>${tl('Monochrome')}</span></label></div>
      <div class="ntUlLayHd"><input class="inp" type="search" placeholder="${esc(tl('Chercher un calque'))}" value="${esc(st.q)}" data-ul="q" aria-label="${esc(tl('Chercher un calque'))}">
        <button type="button" class="btn small subtle" data-ul="allOn" data-tip="${esc(tl('Afficher les calques trouvés'))}">${icon('eye')}</button>
        <button type="button" class="btn small subtle" data-ul="allOff" data-tip="${esc(tl('Masquer les calques trouvés'))}">${icon('x')}</button>
        <span class="mut">${nOn}/${u.layers.length}</span></div>
      <div class="ntUlLayers" role="tree" aria-label="${esc(tl('Calques'))}">${layerRows(u, q)}</div>
      <details class="ntUlPos"${st.mode === 'move' || st.mode === 'align' || st.posOpen ? ' open' : ''}><summary>${tl('Position sur l’étage')}</summary>
        <div class="ntUlGrid">
          <label>${tl('Décalage X (m)')}<input class="inp" type="number" step="0.01" data-ult="dx" value="${r3(t.dx)}"></label>
          <label>${tl('Décalage Y (m)')}<input class="inp" type="number" step="0.01" data-ult="dy" value="${r3(t.dy)}"></label>
          <label>${tl('Rotation (°)')}<input class="inp" type="number" step="0.1" data-ult="rot" value="${Math.round(t.rot * 1000) / 1000}"></label>
          <label>${tl('Échelle')}<input class="inp" type="number" step="0.0001" min="0.0001" data-ult="scale" value="${Math.round(t.scale * 1e6) / 1e6}"></label>
        </div>
        <div class="row"><button type="button" class="btn small subtle" data-ul="rot90" data-tip="${esc(tl('Tourner de 90°'))}">${icon('rotate')}<span>90°</span></button><button type="button" class="btn small subtle" data-ul="resetT">${esc(tl('Remettre à zéro'))}</button></div>
        <label class="ntChk"><input type="checkbox" data-ul="keep"${st.keep ? ' checked' : ''}><span>${tl('Garder l’échelle à l’alignement (unités sûres)')}</span></label>
      </details>`}
      <div class="row ntUlFoot"><button type="button" class="btn small subtle" data-ul="rev" data-tip="${esc(tl('Mettre à jour depuis une nouvelle version du même fichier : position gardée, changements listés'))}">${icon('history')}<span>${tl('Nouvelle version…')}</span></button><button type="button" class="btn small subtle" data-ul="import" data-tip="${esc(tl('Importer un autre plan à la place'))}">${icon('upload')}<span>${tl('Remplacer…')}</span></button><span class="grow"></span><button type="button" class="btn small subtle danger" data-ul="remove" data-tip="${esc(tl('Retirer le fond'))}" aria-label="${esc(tl('Retirer le fond'))}">${icon('trash')}</button></div>`;
    for (const c of card.querySelectorAll('[data-mixed]')) c.indeterminate = true;
  }
  /** Calques du fond : groupés par préfixe comme dans l'assistant (repliés), liste à plat pendant une recherche. */
  function layerRows(u, q) {
    const row = (l, depth, label) => `<div class="ntUlRowL${l.lock ? ' locked' : ''}" style="--d:${depth}"><label class="ntUlLay${l.on ? '' : ' off'}"><input type="checkbox" data-ullay="${l.id}"${l.on ? ' checked' : ''} aria-label="${esc(l.name)}"></label><label class="ntUlCol" data-tip="${esc(tl('Changer la couleur du calque'))}"><i style="background:${esc(l.color)}"></i><input type="color" value="${esc(l.color)}" data-ulcol="${l.id}" aria-label="${esc(tl('Changer la couleur du calque'))}"></label><span class="ntUlNm${l.on ? '' : ' off'}" title="${esc(l.name)}">${esc(label)}</span>
      <button type="button" class="ntUlIc" data-ulselL="${l.id}" data-tip="${esc(tl('Choisir tout le calque'))}" aria-label="${esc(tl('Choisir tout le calque'))}">${icon('pointer')}</button>
      <button type="button" class="ntUlIc${l.lock ? ' on' : ''}" data-ullock="${l.id}" aria-pressed="${!!l.lock}" data-tip="${esc(tl('Verrouiller (ni choix, ni conversion)'))}" aria-label="${esc(tl('Verrouiller (ni choix, ni conversion)'))}">${icon('lock')}</button>
      <button type="button" class="ntUlIc${l.dim ? ' on' : ''}" data-uldim="${l.id}" aria-pressed="${l.dim}" data-tip="${esc(tl('Atténuer ce calque'))}" aria-label="${esc(tl('Atténuer ce calque'))}">${icon('dimLayer')}</button></div>`;
    if (q) { const hit = searchLayers(u.layers, q); const list = u.layers.filter(l => hit.has(l.id)); return list.map(l => row(l, 0, l.name)).join('') || `<p class="mut">${tl('Aucun calque trouvé.')}</p>`; }
    if (!st.tree || st.tree.u !== u.id || st.tree.n !== u.layers.length) st.tree = { u: u.id, n: u.layers.length, t: groupLayers(u.layers.map(l => ({ id: l.id, name: l.name, count: 1 }))) };
    const by = new Map(u.layers.map(l => [l.id, l]));
    const walk = (node, depth, key) => {
      let h = '';
      for (const g of node.groups) {
        const ids = nodeLayers(g), on = ids.filter(id => by.get(id) && by.get(id).on).length, open = st.open.has(g.key);
        h += `<div class="ntUlRowG" style="--d:${depth}"><button type="button" class="ntUlCar" data-ulgrp="${esc(g.key)}" aria-expanded="${open}" aria-label="${esc(open ? tl('Replier') : tl('Déplier'))}">${icon(open ? 'chevDown' : 'chevRight')}</button><label class="ntUlLay"><input type="checkbox" data-ulgrpchk="${esc(g.key)}"${on === ids.length ? ' checked' : ''}${on && on < ids.length ? ' data-mixed="1"' : ''}><span><b>${esc(g.label)}</b></span></label><span class="mut">${on}/${ids.length}</span></div>`;
        if (open) h += walk(g, depth + 1, g.key);
      }
      for (const id of node.layers) { const l = by.get(id); if (l) h += row(l, depth, key && l.name.startsWith(key) ? l.name.slice(key.length) : l.name); }
      return h;
    };
    return walk(st.tree.t, 0, '');
  }
  const findGroup = (n, key) => { for (const g of n.groups) { if (g.key === key) return g; const r = findGroup(g, key); if (r) return r; } return null; };
  const fmtK = n => (n >= 1e6 ? fmt(n / 1e6, 2) + ' M' : n >= 1e4 ? fmt(n / 1e3, 1) + ' k' : String(n));
  const fmtBytes = b => (b >= 1 << 20 ? tl('{0} Mo', fmt(b / (1 << 20), 1)) : tl('{0} ko', fmt(b / 1024, 0)));
  function change(fn) { const u = ulOf(host.floor()); if (!u) return; fn(u); ctx.commit(); paint(); paintCard(); }
  const selLayers = () => { const { e } = cur(); if (!e) return new Set(); const E = ents(e), out = new Set(); for (const k of selList()) out.add(e.un.segLayer[entSegs(E, k)[0]]); return out; };
  card.addEventListener('click', ev => {
    const b = ev.target.closest('[data-ul],[data-uldim],[data-ulgrp],[data-ullock],[data-ulsell],[data-ulconv]'); if (!b) return;
    if (b.dataset.ulgrp != null) { const k = b.dataset.ulgrp; st.open.has(k) ? st.open.delete(k) : st.open.add(k); paintCard(); return; }
    if (b.dataset.uldim != null) { const id = +b.dataset.uldim; change(u => { const l = u.layers.find(x => x.id === id); if (l) l.dim = !l.dim; }); return; }
    if (b.dataset.ullock != null) { const id = +b.dataset.ullock; change(u => { const l = u.layers.find(x => x.id === id); if (l) l.lock = !l.lock; }); dropLocked(); return; }
    if (b.dataset.ulsell != null) { const { e } = cur(); if (e) { const id = +b.dataset.ulsell, u = ulOf(host.floor()), l = u.layers.find(x => x.id === id); if (l && (l.lock || !l.on)) { ctx.status(tl('Calque masqué ou verrouillé : affichez-le ou déverrouillez-le d’abord.'), 'warn'); return; } select(layerEnts(e.un, ents(e), id)); } return; }
    if (b.dataset.ulconv) { convertSel(b.dataset.ulconv); return; }
    const a = b.dataset.ul;
    if (a === 'close') toggleCard(false);
    else if (a === 'import') import('./cadimport.js').then(m => m.openCadImport(ctx, null, { floor: host.floor() && host.floor().id })).catch(err => { console.error(err); ctx.status(tl('L’import DXF n’a pas pu se charger.'), 'err'); });
    else if (a === 'rev') revInput.click();
    else if (a === 'allOn' || a === 'allOff') { const q = st.q.trim(); change(u => { const hit = q ? searchLayers(u.layers, q) : null; for (const l of u.layers) if (!hit || hit.has(l.id)) l.on = a === 'allOn'; }); }
    else if (a === 'move' || a === 'align' || a === 'pick') setMode(st.mode === a ? null : a);
    else if (a === 'rot90') change(u => { const b0 = bounds(host.floor()), c = b0 ? [(b0[0] + b0[2]) / 2, (b0[1] + b0[3]) / 2] : [0, 0], T = ulMatrix(u.transform), p = T.from(...c); u.transform.rot = (u.transform.rot + 90) % 360; const q = ulMatrix(u.transform).to(...p); u.transform.dx = r3(u.transform.dx + c[0] - q[0]); u.transform.dy = r3(u.transform.dy + c[1] - q[1]); });
    else if (a === 'resetT') change(u => { u.transform = { dx: 0, dy: 0, rot: 0, scale: 1 }; });
    else if (a === 'remove') remove();
    else if (a === 'selClear') select([]);
    else if (a === 'compact') { st.compact = !st.compact; paintCard(); }
    else if (a === 'selLayer') { const { e } = cur(); if (e) { const out = []; for (const l of selLayers()) out.push(...layerEnts(e.un, ents(e), l)); select(out); } }
    else if (a === 'selHide' || a === 'selLock') { const ls = selLayers(); change(u => { for (const l of u.layers) if (ls.has(l.id)) { if (a === 'selHide') l.on = false; else l.lock = true; } }); select([]); }
    else if (a === 'diffShow') { const { e } = cur(); if (e && e.diff) { e.diff.show = !e.diff.show; paint(); paintCard(); } }
  });
  /** Un calque masqué ou verrouillé ne garde pas d'entités choisies. */
  function dropLocked() { const { u, e } = cur(); if (!u || !e || !st.sel) return; const skip = hiddenL(u), E = ents(e); for (const k of [...st.sel.ents]) if (skip(e.un.segLayer[entSegs(E, k)[0]])) st.sel.ents.delete(k); paint(); paintCard(); }
  card.addEventListener('toggle', ev => { if (ev.target.classList && ev.target.classList.contains('ntUlPos')) st.posOpen = ev.target.open; }, true);
  card.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.ul === 'q') { st.q = t.value; const pos = t.selectionStart; paintCard(); const n = card.querySelector('[data-ul="q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
    else if (t.dataset.ul === 'opacity') { const u = ulOf(host.floor()); if (u) { u.opacity = +t.value / 100; cv.style.opacity = String(u.opacity); t.nextElementSibling.textContent = t.value + ' %'; } }
  });
  card.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.ulgrpchk != null) { const g = st.tree && findGroup(st.tree.t, t.dataset.ulgrpchk); if (g) { const ids = new Set(nodeLayers(g)); change(u => { for (const l of u.layers) if (ids.has(l.id)) l.on = t.checked; }); dropLocked(); } return; }
    if (t.dataset.ullay != null) { const id = +t.dataset.ullay; change(u => { const l = u.layers.find(x => x.id === id); if (l) l.on = t.checked; }); dropLocked(); }
    else if (t.dataset.ulcol != null) { const id = +t.dataset.ulcol; if (/^#[0-9a-f]{6}$/i.test(t.value)) change(u => { const l = u.layers.find(x => x.id === id); if (l) { l.color = t.value.toLowerCase(); l.recolor = true; } }); }
    else if (t.dataset.ul === 'on') change(u => { u.on = t.checked; });
    else if (t.dataset.ul === 'mono') change(u => { u.mono = t.checked; });
    else if (t.dataset.ul === 'opacity') change(() => {});
    else if (t.dataset.ul === 'keep') st.keep = t.checked;
    else if (t.dataset.ult) { const v = +String(t.value).replace(',', '.'); if (!Number.isFinite(v) || (t.dataset.ult === 'scale' && !(v > 0))) { paintCard(); return; } change(u => { u.transform[t.dataset.ult] = t.dataset.ult === 'rot' ? ((v % 360) + 360) % 360 : v; }); }
  });
  revInput.addEventListener('change', () => {
    const file = revInput.files && revInput.files[0]; revInput.value = ''; if (!file) return;
    const { f, u, e } = cur(); if (!u) return;
    import('./plan-underlay-rev.js').then(m => m.openRevision(ctx, file, {
      floor: f, underlay: u, old: e && e.un,
      /** Après « appliquer » (commit fait) : le nouveau paquet déjà déballé, ses changements surlignés. */
      done(id, un, diff) { const n = install(id, un); n.diff = diff ? { added: diff.added, removed: diff.removed, show: true } : null; st.sel = null; paint(); paintCard(); host.repaint(); }
    })).catch(err => { console.error(err); ctx.status(tl('La mise à jour du fond n’a pas pu se charger.'), 'err'); });
  });
  /* ---------- « Et maintenant ? » : une fois, après un import ---------- */
  function showCoach(c) {
    cadSession.coach = null;
    const conv = c.mode === 'convert', n = c.counts || {};
    const item = (act, ic, label, hint) => `<li><button type="button" class="ntUlCoAct" data-co="${act}">${icon(ic)}<span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button></li>`;
    coach.innerHTML = `<div class="ntUlCoHd"><b>${icon('check')}${esc(conv ? tl('Plan importé et converti : {0} murs, {1} pièces.', n.walls || 0, n.rooms || 0) : tl('Fond de plan importé.'))}</b><button type="button" class="tb" data-co="close" aria-label="${esc(tl('Fermer'))}">${icon('x')}</button></div>
      <p class="mut">${esc(tl('Et maintenant ?'))}</p><ol>
      ${conv ? item('rooms', 'room', tl('Vérifier les pièces'), tl('noms et usages dans l’inspecteur')) : item('pick', 'pointer', tl('Convertir des traits du fond'), tl('choisir des murs ou des contours, puis Murs, Salles…'))}
      ${conv ? '' : item('wall', 'wall', tl('Dessiner les murs (W)'), tl('aimantés sur les traits du fond'))}
      ${item('rack', 'rack', tl('Poser la baie'), tl('choisir le local technique, puis « Baie » dans l’inspecteur'))}
      ${item('outlet', 'outlet', tl('Placer prises et points d’accès'), tl('glisser depuis la bibliothèque à gauche'))}
      ${item('path', 'cableTray', tl('Tracer les cheminements (K)'), tl('chemins de câbles, faux plafond, colonnes'))}
      ${item('design', 'clipboard', tl('Dimensionner le réseau'), tl('vue Conception : baies, switchs, nomenclature'))}</ol>
      ${c.hid && c.hid.length ? `<p class="ntUlCoNote">${icon('eyeOff')}<span>${esc(tl('Calques de textes masqués : les pièces portent déjà les noms.'))}</span><button type="button" class="btn small subtle" data-co="showText">${esc(tl('Réafficher'))}</button></p>` : ''}`;
    coach.hidden = false; coach.dataset.hid = JSON.stringify(c.hid || []);
  }
  coach.addEventListener('click', ev => {
    const b = ev.target.closest('[data-co]'); if (!b) return;
    const a = b.dataset.co;
    if (a === 'showText') { const ids = new Set(JSON.parse(coach.dataset.hid || '[]')); change(u => { for (const l of u.layers) if (ids.has(l.id)) l.on = true; }); b.closest('p').remove(); return; }
    coach.hidden = true;
    if (a === 'pick') { toggleCard(true); setMode('pick'); }
    else if (a === 'design') ctx.openView('design');
    else if (a === 'outlet') ctx.status(tl('Glissez une prise ou un point d’accès depuis la bibliothèque (à gauche) sur le plan.'));
    else if (a === 'rack') ctx.status(tl('Cliquez le local technique, puis « Baie » dans l’inspecteur (à droite).'));
    else if (a === 'rooms') ctx.status(tl('Cliquez une pièce pour vérifier son nom et son usage dans l’inspecteur.'));
    else if (a !== 'close' && host.act) host.act(a);
  });
  function remove() {
    const f = host.floor(), d = data(), u = ulOf(f); if (!u) return;
    rememberBlob(u.id, d.blobs[u.id]); delete d.underlays[f.id]; delete d.blobs[u.id]; // la réserve de session le rend à « annuler »
    setMode(null); st.sel = null; ctx.commit(); paint(); paintCard(); host.repaint();
    ctx.status(tl('Fond retiré (Ctrl+Z pour annuler).'), 'ok');
  }
  function toggleCard(on = card.hidden) {
    card.hidden = !on; if (on) paintCard(); else if (st.mode) setMode(null);
    if (host.cardChanged) host.cardChanged(on);
    return on;
  }
  window.addEventListener('jollof:theme', () => { for (const e of cache.values()) e.ver = ''; paint(); });

  const api = {
    paint, snap, bounds, toggleCard, paintCard,
    has: f => !!ulOf(f),
    cardOpen: () => !card.hidden,
    /** Échap : quitte le mode en cours, puis vide la sélection du fond ; Suppr : rien (le fond ne s'efface pas par entité). */
    key(ev) {
      if (ev.key !== 'Escape') return false;
      if (st.mode) { setMode(null); return true; }
      if (selList().length) { select([]); return true; }
      return false;
    },
    /** Choix et conversion par programme (essais, IA) : entités sous un point de l'étage, cadre, calque. */
    select: { list: selList, set: select, convert: convertSel, info: () => { const { e } = cur(); return e ? selInfo(e.un, ents(e), selList(), e.un.step || 0.001) : null; } },
    mode: m => setMode(m),
    /** Temps de dessin des dernières images (ms) et état du chargement (mesures). */
    resetStats() { lastMs = []; },
    stats() { const u = ulOf(host.floor()), e = u && cache.get(u.id); return { frames: lastMs.slice(), pending, load: e ? { st: e.st, ms: e.ms, tiles: e.R ? e.R.tiles() : 0 } : null }; },
    /** Oublie les fonds décodés (projet rechargé). */
    reset() { cache.clear(); st.sel = null; setMode(null); paint(); }
  };
  if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.cadLayer = api; // (mesures automatiques)
  return api;
}
