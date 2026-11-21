// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Calque Wi-Fi du plan d'étage : carte de couverture (signal, rapport signal/bruit, chevauchement des canaux, cellules
// des points d'accès), légende, réglages Wi-Fi du projet, réglages radio d'un point d'accès et plan de canaux
// automatique. La vue Plans (ui/plan.js) possède le canevas et le bouton du calque ; elle appelle paint() à chaque rendu.
// Le calcul (src/net/wifi.js, modèle simplifié) tourne dans un Web Worker quand il y en a, sinon ici ; le résultat est
// gardé tant que l'étage, ses points d'accès et les réglages ne changent pas : déplacer ou zoomer ne recalcule rien.
import { tl, dec } from '../../i18n/index.js';
import * as WF from '../wifi.js';
import './wifilayer.css';

const MODES = ['signal', 'snr', 'sinr', 'overlap', 'cells'];
const MODE_NAME = { signal: () => tl('Puissance du signal'), snr: () => tl('Rapport signal/bruit'), sinr: () => tl('Signal sur bruit et brouillage (SINR)'), overlap: () => tl('Chevauchement des canaux'), cells: () => tl('Cellules des points d’accès') };
const BAND_LABEL = { b24: () => dec('2,4') + ' GHz', b5: () => '5 GHz', b6: () => '6 GHz', any: () => tl('Meilleure bande') };
const ENV_NAME = { walls: () => tl('Murs du plan'), office: () => tl('Bureaux (P.1238)'), residential: () => tl('Logement (P.1238)') };
const ENV_NOTE = { walls: () => tl('N = 20 et chaque mur dessiné compté (UIT-R P.2040).'), office: () => tl('N de l’UIT-R P.1238 pour des bureaux, murs déjà compris : les murs dessinés ne sont pas recomptés.'), residential: () => tl('N de l’UIT-R P.1238 pour un logement, murs déjà compris : les murs dessinés ne sont pas recomptés.') };
// Rampes de couleur (données, pas thème) : du meilleur au moins bon ; en dessous du dernier seuil, rien n'est peint.
// Signal, SNR, SINR : rampe continue (interpolée entre les seuils) dont le haut (objectif + 15 dB, bleu-vert) montre la
// marge au-dessus de l'objectif, au lieu d'un aplat vert dès que tout dépasse l'objectif.
const RAMP = ['#16a34a', '#84cc16', '#eab308', '#f97316', '#dc2626'];
const TOP = '#0e7490', MARGIN = 15;
/** Seuil le plus haut de la rampe continue : objectif + MARGIN. */
const contStops = (t, unit) => [[t + MARGIN, TOP, `${t + MARGIN}`], [t, RAMP[0], `${t}`], [t - 3, RAMP[1], `${t - 3}`], [t - 8, RAMP[2], `${t - 8}`], [t - 13, RAMP[3], `${t - 13}`], [t - 18, RAMP[4], `${t - 18}`]].map(([v, color, label]) => ({ v, color, label, unit }));
/** Couleur d'une valeur sur une rampe continue (seuils décroissants) : [r, g, b] ou null sous le dernier seuil. */
function rampColor(st, v) {
  if (!(v >= st[st.length - 1].v)) return null;
  if (v >= st[0].v) return st[0].rgb;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    if (v >= b.v) { const f = (v - b.v) / (a.v - b.v); return [0, 1, 2].map(k => Math.round(b.rgb[k] + (a.rgb[k] - b.rgb[k]) * f)); }
  }
  return st[st.length - 1].rgb;
}
const HUES = [210, 25, 130, 280, 50, 330, 170, 0, 90, 250, 300, 190];
const isLight = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
const css = (name, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || d; } catch { return d; } };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const fmt = v => dec(String(Math.round(v * 10) / 10));
/** Zoom (px par mètre) à partir duquel les étiquettes de canaux de tous les points d'accès tiennent sur le plan. */
const TAG_K = 22;
const BN = { b24: () => dec('2,4') + ' GHz', b5: () => '5 GHz', b6: () => '6 GHz' };

/** Seuils d'une carte : [{ v, color, label }] du meilleur au moins bon. */
function stops(mode, set) {
  const t = set.target;
  if (mode === 'signal') return contStops(t, 'dBm');
  if (mode === 'snr') return contStops(set.snr, 'dB');
  if (mode === 'sinr') return contStops(set.sinr, 'dB');
  if (mode === 'overlap') return [{ v: 0, color: RAMP[0], label: tl('aucun autre') }, { v: 1, color: RAMP[2], label: tl('1 autre') }, { v: 2, color: RAMP[3], label: tl('2 autres') }, { v: 3, color: RAMP[4], label: tl('3 ou plus') }];
  return [];
}

/** Image d'une carte (un pixel par case), couleurs selon le mode. */
function imageOf(res, mode) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = res.nx; cv.height = res.ny;
  const g = cv.getContext('2d'), img = g.createImageData(res.nx, res.ny), px = img.data, set = res.set;
  const st = stops(mode, set).map(s => ({ ...s, rgb: hex(s.color) })), a = isLight() ? 125 : 115;
  const heard = set.noise + 4;
  for (let c = 0; c < res.best.length; c++) {
    const b = res.best[c]; let rgb = null, al = a;
    if (mode === 'signal') rgb = rampColor(st, b);
    else if (mode === 'snr') rgb = rampColor(st, b - set.noise);
    else if (mode === 'sinr') rgb = rampColor(st, res.sinr ? res.sinr[c] : -Infinity);
    else if (mode === 'overlap') { if (b >= heard) { const n = res.cci[c]; rgb = st[Math.min(3, n)].rgb; } }
    else if (mode === 'cells' && res.srv[c] >= 0 && b >= set.target - 13) {
      const h = HUES[res.srv[c] % HUES.length], l = isLight() ? 45 : 55; rgb = hsl(h, 70, l); al = b >= set.target ? a : a * 0.45;
    }
    if (!rgb) continue;
    const j = c * 4; px[j] = rgb[0]; px[j + 1] = rgb[1]; px[j + 2] = rgb[2]; px[j + 3] = al;
  }
  // Bords des cellules (mode cellules) : un pixel plus sombre où le serveur change.
  if (mode === 'cells') for (let y = 0; y < res.ny; y++) for (let x = 0; x < res.nx; x++) {
    const c = y * res.nx + x, s = res.srv[c]; if (s < 0 || px[c * 4 + 3] === 0) continue;
    if ((x + 1 < res.nx && res.srv[c + 1] !== s) || (y + 1 < res.ny && res.srv[c + res.nx] !== s)) { px[c * 4 + 3] = 230; }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function hsl(h, s, l) {
  s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
/** Données réduites pour le calcul d'un étage : points d'accès, bâtiment de l'étage, réglages (copiables vers un worker). */
function reduced(data, floorId, lan) {
  const at = WF.findFloor(data, floorId); if (!at) return null;
  const ids = new Set(at.building.floors.map(f => f.id));
  // Un point d'accès sans courant (PoE absent ou budget épuisé) n'émet rien.
  const devices = WF.apsOf(WF.powered(data, lan)).filter(a => a.loc && ids.has(a.loc.floor)).map(a => ({ id: a.d.id, type: a.d.type, name: a.d.name, p: { radios: a.r }, loc: a.loc, ...(a.d.unpowered ? { unpowered: true } : {}) }));
  const b = at.building;
  return { devices, site: { buildings: [{ id: b.id, name: b.name, floors: b.floors.map(f => ({ id: f.id, name: f.name, level: f.level, elev: f.elev, height: f.height, ceil: f.ceil, walls: f.walls || [], doors: f.doors || [], rooms: f.rooms || [] })) }] }, wifi: WF.wifiSettings(data) };
}

/** Rend { paint(canvas, { floor, view, data }), legend() → html, toolbar() → html, handle(e) → bool, … }. */
export function createWifiLayer(ctx) {
  // Bande affichée : celle des statistiques du projet (par défaut la meilleure des deux, comme le vérificateur).
  let mode = 'signal', tagsAll = false, band = (() => { try { return WF.wifiSettings(ctx && ctx.data ? ctx.data() : null).band; } catch { return 'any'; } })(), last = null, worker = null, seq = 0, waiting = null, workerOk = typeof Worker !== 'undefined';
  const cache = new Map(), imgs = new Map(), ready = new Set();
  const esc = ctx && ctx.esc ? ctx.esc : s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const notify = () => {
    for (const f of ready) { try { f(); } catch (e) { console.error(e); } }
    // Sans abonné, la vue Plans est redessinée si elle est à l'écran.
    if (!ready.size && ctx && ctx.view && ctx.view() === 'plan') ctx.openView('plan').then(v => v && v.render('wifi')).catch(() => {});
  };
  function startWorker() {
    try {
      worker = new Worker(new URL('../wifi.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        const { id, res, error } = e.data || {}; if (!waiting || waiting.id !== id) return;
        const w = waiting; waiting = null;
        if (error || !res) { if (error) console.error(error); cache.set(w.key, res || null); }
        else cache.set(w.key, res);
        trim(); notify();
      };
      worker.onerror = e => { console.error(e); workerOk = false; worker = null; if (waiting) { const w = waiting; waiting = null; cache.set(w.key, WF.coverageOf(w.msg.data, w.msg.floor, w.msg.band)); notify(); } };
    } catch (e) { console.error(e); workerOk = false; worker = null; }
  }
  const trim = () => { while (cache.size > 16) cache.delete(cache.keys().next().value); while (imgs.size > 16) imgs.delete(imgs.keys().next().value); };
  /** Carte de l'étage (null le temps du calcul : l'ancienne reste affichée). */
  function resultOf(data, floorId) {
    let lan = null; try { lan = ctx && ctx.lan ? ctx.lan() : null; } catch { lan = null; }
    const red = reduced(data, floorId, lan); if (!red) return null;
    const key = JSON.stringify([floorId, band, red]);
    if (cache.has(key)) { last = cache.get(key); return last; }
    if (workerOk && !worker) startWorker();
    if (worker) {
      if (!waiting || waiting.key !== key) { const msg = { id: ++seq, data: red, floor: floorId, band }; waiting = { id: msg.id, key, msg }; worker.postMessage(msg); }
      return last && last.floor === floorId ? last : null;
    }
    const r = WF.coverageOf(red, floorId, band); cache.set(key, r); trim(); last = r; return r;
  }
  /** Dessine le calque : canevas de la vue, étage (objet ou id), vue { x, y, k } (écran = (monde − x) × k), plan. */
  function paint(canvas, o = {}) {
    const data = o.data || (ctx && ctx.data && ctx.data()), floorId = o.floor && typeof o.floor === 'object' ? o.floor.id : o.floor;
    if (!canvas || !data || !floorId) return;
    const res = resultOf(data, floorId); if (!res) return;
    const g = canvas.getContext('2d'), v = o.view || { x: 0, y: 0, k: 1 };
    const ik = res.band + '|' + mode + '|' + (isLight() ? 'l' : 'd') + '|' + res.x0 + '|' + res.nx + '|' + res.ny;
    let entry = imgs.get(res);
    if (!entry || entry.ik !== ik) { entry = { ik, cv: imageOf(res, mode) }; imgs.set(res, entry); trim(); }
    if (!entry.cv) return;
    g.save();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(entry.cv, (res.x0 - v.x) * v.k, (res.y0 - v.y) * v.k, res.nx * res.step * v.k, res.ny * res.step * v.k);
    // Étiquettes de canaux : celles du point d'accès choisi, et toutes dès que le zoom laisse la place (ou sur demande).
    const sel = ctx && ctx.selection ? ctx.selection() : null, selId = o.sel || (sel && sel.kind === 'dev' ? sel.id : null);
    const showAll = tagsAll || mode === 'cells' || v.k >= TAG_K;
    if (res.aps.some(a => a.same && (showAll || a.id === selId))) drawTags(g, res, v, data, floorId, selId, showAll, Array.isArray(o.avoid) ? o.avoid : null);
    g.restore();
  }
  /**
   * Étiquettes de canaux près des points d'accès, placées sans recouvrir les noms des pièces, les symboles des
   * équipements, les autres étiquettes ni (autant que possible) les murs : 8 positions essayées autour du point
   * d'accès, la moins gênante gagne ; un trait la relie au point d'accès quand elle s'en écarte.
   */
  function drawTags(g, res, v, data, floorId, selId, showAll, avoid) {
    const fg = css('--fg', '#e6edf3'), bg = css('--panel', '#1b222b'), line = css('--line-3', css('--line-2', '#3a4552')), acc = css('--accent', '#3b82f6');
    const fs = Math.max(11, Math.min(13, 11 * Math.sqrt(v.k / 20))), h = fs + 8;
    g.font = `600 ${fs}px system-ui, sans-serif`; g.textBaseline = 'middle';
    const at = WF.findFloor(data, floorId), floor = at ? at.floor : { rooms: [], walls: [] };
    const X = wx => (wx - v.x) * v.k, Y = wy => (wy - v.y) * v.k;
    // Obstacles à l'écran : boîtes déjà posées par la vue Plans (symboles, noms des pièces, étiquettes : [x0, y0, x1, y1]),
    // sinon une estimation (noms centrés sur les pièces, symboles des équipements de l'étage).
    const boxes = avoid ? avoid.filter(b => Array.isArray(b) && b.length >= 4).map(b => [b[0], b[1], b[2] - b[0], b[3] - b[1], 6]) : [];
    if (!avoid) for (const r of floor.rooms || []) {
      if (!r || !Array.isArray(r.poly) || r.poly.length < 3) continue;
      const cx = r.poly.reduce((t, q) => t + q[0], 0) / r.poly.length, cy = r.poly.reduce((t, q) => t + q[1], 0) / r.poly.length, w = g.measureText(r.name || '').width + 12;
      boxes.push([X(cx) - w / 2, Y(cy) - 16, w, 32, 6]);
    }
    if (!avoid) for (const d of data.devices || []) if (d.loc && d.loc.floor === floorId) boxes.push([X(+d.loc.x) - 12, Y(+d.loc.y) - 12, 24, 24, 6]);
    const walls = (floor.walls || []).filter(w => w && w.a && w.b).map(w => [X(+w.a[0]), Y(+w.a[1]), X(+w.b[0]), Y(+w.b[1])]);
    const hit = (r, q, m = 0) => r[0] - m < q[0] + q[2] && q[0] < r[0] + r[2] + m && r[1] - m < q[1] + q[3] && q[1] < r[1] + r[3] + m;
    const cuts = (r, [x1, y1, x2, y2]) => {
      if (Math.max(x1, x2) < r[0] || Math.min(x1, x2) > r[0] + r[2] || Math.max(y1, y2) < r[1] || Math.min(y1, y2) > r[1] + r[3]) return false;
      const side = (x, y) => Math.sign((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1));
      const s4 = [side(r[0], r[1]), side(r[0] + r[2], r[1]), side(r[0], r[1] + r[3]), side(r[0] + r[2], r[1] + r[3])];
      return !(s4.every(z => z > 0) || s4.every(z => z < 0));
    };
    const placed = [];
    res.aps.forEach((a, i) => {
      if (!a.same || !(showAll || a.id === selId)) return;
      const parts = [];
      for (const b of WF.BANDS) {
        const x = WF.radio(a.r, b); if (!x.on || (res.band !== 'any' && res.band !== b)) continue;
        parts.push(`${b === 'b24' ? dec('2,4') : b === 'b5' ? '5' : '6'} GHz ${x.ch}${b !== 'b24' && x.w > 20 ? '/' + x.w : ''}`);
      }
      const t = a.off ? tl('éteint (sans courant)') : parts.join(' · ') || tl('radio coupée'), w = g.measureText(t).width + 12;
      const sx = X(a.x), sy = Y(a.y), gap = 16;
      const cand = [[gap, -h - 4], [gap, 4], [-w - gap, -h - 4], [-w - gap, 4], [-w / 2, -h - gap - 6], [-w / 2, gap + 6], [gap, -h / 2], [-w - gap, -h / 2],
        [gap, -2 * h - 10], [gap, h + 10], [-w - gap, -2 * h - 10], [-w - gap, h + 10], [-w / 2, -2 * h - gap - 8], [-w / 2, h + gap + 8]];
      let best = null;
      for (const [dx, dy] of cand) {
        const r = [sx + dx, sy + dy, w, h];
        let cost = 0;
        for (const q of placed) if (hit(r, q, 4)) cost += 100;
        for (const q of boxes) if (hit(r, q)) cost += q[4] * 8;
        for (const wl of walls) if (cuts(r, wl)) cost += 1;
        cost += Math.hypot(dx + w / 2, dy + h / 2) / 12; // à gêne égale, la plus proche du point d'accès
        if (!best || cost < best.cost) best = { r, cost };
      }
      const r = best.r; placed.push(r);
      // Trait vers le point d'accès (du bord le plus proche de l'étiquette).
      const ex = Math.max(r[0], Math.min(sx, r[0] + r[2])), ey = Math.max(r[1], Math.min(sy, r[1] + r[3]));
      if (Math.hypot(ex - sx, ey - sy) > 13) { g.strokeStyle = fg; g.globalAlpha = 0.7; g.lineWidth = 1.2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke(); g.globalAlpha = 1; }
      g.fillStyle = bg; g.globalAlpha = 0.95; g.fillRect(r[0], r[1], r[2], r[3]); g.globalAlpha = 1;
      g.strokeStyle = mode === 'cells' ? `rgb(${hsl(HUES[i % HUES.length], 70, isLight() ? 45 : 55).join(',')})` : a.id === selId ? acc : line;
      g.lineWidth = mode === 'cells' || a.id === selId ? 2 : 1; g.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1);
      g.fillStyle = fg; g.fillText(t, r[0] + 6, r[1] + h / 2 + 0.5);
    });
  }
  /** Légende (HTML) : rampe du mode, réglages, couverture de l'étage affiché, mention « modèle simplifié ». */
  function legend() {
    const res = last, set = res ? res.set : WF.wifiSettings(ctx && ctx.data ? ctx.data() : null);
    const st = stops(mode, set);
    let h = `<div class="ntWfLeg"><div class="ntWfLegT">${esc(MODE_NAME[mode]())} · ${esc(BAND_LABEL[band]())}</div>`;
    if (mode === 'cells') h += `<p class="ntWfMut">${esc(tl('Une couleur par point d’accès (le plus fort reçu) ; teinte pâle : sous {0} dBm.', set.target))}</p>`;
    else if (mode === 'overlap') h += `<ul class="ntWfRamp">${st.map(s => `<li><i style="background:${s.color}"></i>${esc(s.label)}</li>`).join('')}<li><i class="ntWfNone"></i>${esc(tl('rien'))}</li></ul>`;
    else {
      // Barre continue, du moins bon (à gauche) au meilleur ; repères aux seuils, objectif souligné ; « rien » à part.
      const lo = st[st.length - 1].v, hi = st[0].v, pos = v => ((v - lo) / (hi - lo)) * 100, goal = st[1].v;
      h += `<div class="ntWfGradBox"><div class="ntWfGrad" style="background:linear-gradient(to right, ${[...st].reverse().map(x => `${x.color} ${pos(x.v).toFixed(1)}%`).join(', ')})"></div>`
        + `<div class="ntWfTicks">${[...st].reverse().filter(x => x.v === goal || Math.abs(pos(x.v) - pos(goal)) >= 12).map(x => `<span class="${x.v === goal ? 'ntWfGoal' : ''}" style="left:${pos(x.v).toFixed(1)}%">${esc(x.label)}</span>`).join('')}</div>`
        + `<p class="ntWfMut">${esc(tl('En {0} ; objectif {1} (souligné), au-delà : marge.', st[0].unit, goal))}</p><div class="ntWfGradCap"><span><i class="ntWfNone"></i>${esc(tl('rien'))}</span></div></div>`;
    }
    if (mode === 'sinr') h += `<p class="ntWfMut">${esc(tl('SINR : signal du plus fort contre bruit + autres points d’accès de la bande, comptés au prorata du spectre commun ; tous émettent en même temps (pire cas). Objectif {0} dB (modifiable).', set.sinr))}</p>`;
    if (mode === 'overlap') h += `<p class="ntWfMut">${esc(tl('Points d’accès entendus sur un canal qui chevauche celui du plus fort (au-dessus de {0} dBm).', set.noise + 4))}</p>`;
    if (res) {
      const at = ctx && ctx.data ? WF.findFloor(ctx.data(), res.floor) : null;
      h += mode === 'sinr' && res.sinr ? `<p><b>${Math.round(WF.floorPct(res, at && at.floor, set.sinr, 'sinr'))} %</b> ${esc(tl('de l’étage à un SINR de {0} dB ou plus', set.sinr))}</p>`
        : mode === 'snr' ? `<p><b>${Math.round(WF.floorPct(res, at && at.floor, set.noise + set.snr))} %</b> ${esc(tl('de l’étage à un SNR de {0} dB ou plus', set.snr))}</p>`
        : `<p><b>${Math.round(WF.floorPct(res, at && at.floor, set.target))} %</b> ${esc(tl('de l’étage à {0} dBm ou plus', set.target))}</p>`;
      const rows = at ? (at.floor.rooms || []).filter(WF.needsWifi).map(r => { const cells = WF.cellsIn(res, r.poly, r.holes); return { r, pct: cells.length ? WF.pctAbove(res, set.target, cells) : 0 }; }).sort((a, b) => a.pct - b.pct).slice(0, 8) : [];
      // Pièces les moins bien couvertes : repliées (la carte ne doit pas cacher l'étage), dépliées d'office s'il y a un trou.
      if (rows.length) h += `<details class="ntWfMore"${rows.some(x => x.pct < set.cover) ? ' open' : ''}><summary>${esc(tl('Couverture par pièce ({0})', rows.length))}</summary><table class="ntWfRooms">${rows.map(x => `<tr class="${x.pct < set.cover ? 'ntWfBad' : ''}"><td>${esc(x.r.name || x.r.id)}</td><td>${Math.round(x.pct)} %</td></tr>`).join('')}</table></details>`;
    } else h += `<p class="ntWfMut">${esc(tl('Calcul de la couverture…'))}</p>`;
    h += `<p class="ntWfMut">${esc(tl('Modèle simplifié : affaiblissement UIT-R P.1238, murs UIT-R P.2040 (incidence normale), bruit supposé {0} dBm. Une mesure sur place reste nécessaire.', set.noise))}</p>`;
    if (band === 'b6' || (band === 'any' && res && res.parts && res.parts.b6)) h += `<p class="ntWfMut">${esc(tl('6 GHz : N du modèle général de l’UIT-R P.1238-13 (bureaux, 0,3 à 255 GHz) ; perte d’un plancher extrapolée de 5,8 GHz (aucune valeur à 6 GHz).'))}</p>`;
    h += '</div>';
    return h;
  }
  /** Barre du calque (HTML) : mode, bande, plan de canaux automatique, réglages. */
  function toolbar() {
    const opt = (list, cur, name) => list.map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(name[k]())}</option>`).join('');
    const ic = ctx && ctx.icon ? ctx.icon('wifi') : '';
    return `<div class="ntWfBar"><select data-ntwf="mode" aria-label="${esc(tl('Carte Wi-Fi'))}">${opt(MODES, mode, MODE_NAME)}</select>`
      + `<select data-ntwf="band" aria-label="${esc(tl('Bande'))}">${opt(['b5', 'b24', ...(hasB6() ? ['b6'] : []), 'any'], band, BAND_LABEL)}</select>`
      + `<label class="ntWfChk"><input type="checkbox" data-ntwf="tags"${tagsAll ? ' checked' : ''}> ${esc(tl('Canaux de tous les points d’accès'))}</label>`
      + `<button type="button" data-ntwf="auto" title="${esc(tl('Donne aux points d’accès voisins des canaux qui ne se chevauchent pas (annulable).'))}">${ic}<span>${esc(tl('Plan de canaux auto'))}</span></button></div>`;
  }
  /** Réglages Wi-Fi du projet (valeurs par défaut modifiables). */
  function settingsHtml() {
    const d = ctx.data(), s = WF.wifiSettings(d), field = (label, html) => `<label class="ntWfF"><span>${esc(label)}</span>${html}</label>`;
    const numIn = (k, v, lo, hi, st = 1) => `<input type="number" data-ntwf-set="${k}" value="${v}" min="${lo}" max="${hi}" step="${st}">`;
    return `<section class="ntWfSet"><h4>${esc(tl('Réglages Wi-Fi du projet'))}</h4>`
      + field(tl('Domaine réglementaire'), `<select data-ntwf-set="reg"><option value="eu"${s.reg === 'eu' ? ' selected' : ''}>${esc(tl('Europe (CE)'))}</option><option value="us"${s.reg === 'us' ? ' selected' : ''}>${esc(tl('États-Unis (FCC)'))}</option><option value="us-sp"${s.reg === 'us-sp' ? ' selected' : ''}>${esc(tl('États-Unis, puissance standard (AFC)'))}</option></select>`)
      + (s.reg === 'us-sp' ? `<p class="ntWfMut">${esc(tl('6 GHz de puissance standard : l’AFC, qui accorde canaux et puissance, n’est pas simulée ; elle est supposée accorder tout ce que la règle permet (36 dBm, 23 dBm/MHz, 5925–6425 et 6525–6875 MHz).'))}</p>` : '')
      + field(tl('Modèle de propagation'), `<select data-ntwf-set="env">${WF.ENVS.map(k => `<option value="${k}"${k === s.env ? ' selected' : ''}>${esc(ENV_NAME[k]())}</option>`).join('')}</select>`)
      + `<p class="ntWfMut">${esc(ENV_NOTE[s.env]())}</p>`
      + field(tl('Signal visé (dBm)'), numIn('target', s.target, -90, -40)) + field(tl('Bruit supposé (dBm)'), numIn('noise', s.noise, -110, -70))
      + field(tl('Surface couverte voulue (%)'), numIn('cover', s.cover, 0, 100)) + field(tl('Recouvrement co-canal admis (%)'), numIn('cci', s.cci, 0, 100))
      + field(tl('Hauteur des terminaux (m)'), numIn('rxH', s.rxH, 0, 3, 0.1)) + field(tl('SINR visé (dB)'), numIn('sinr', s.sinr, -10, 60))
      + `<p class="ntWfMut">${esc(tl('Valeurs par défaut modifiables : -67 dBm et 25 dB de rapport signal/bruit (guides Cisco), bruit -92 dBm au plus.'))}</p></section>`;
  }
  /** Réglages radio d'un point d'accès (inspecteur) : HTML. */
  function apPane(dev) {
    if (!dev || !WF.AP_TYPES.includes(dev.type)) return '';
    const r = WF.radiosOf(dev), spec = WF.radioSpec(dev.type), s = WF.wifiSettings(ctx.data());
    let h = `<section class="ntWfSet"><h4>${esc(tl('Radios Wi-Fi'))}</h4>`;
    for (const b of WF.bandsOf(dev.type)) {
      // 6 GHz : tous les canaux autorisés du domaine (PSC marqués) ; ailleurs, les canaux primaires de la largeur.
      const x = r[b], chs = b === 'b6' ? WF.allowed(b, s.reg).filter(c => WF.ok6(c, x.w, s.reg)) : WF.channels(b, s.reg, x.w), all = chs.includes(x.ch) ? chs : [x.ch, ...chs];
      const pf = WF.powerFault(dev.type, b, x, s.reg), rf = WF.radioFault(dev.type, b, x, s.reg);
      h += `<fieldset class="ntWfRadio"><legend><label><input type="checkbox" data-ntwf-ap="${b}.on"${x.on ? ' checked' : ''}> ${BN[b]()}</label></legend>`
        + `<label class="ntWfF"><span>${esc(tl('Canal'))}</span><select data-ntwf-ap="${b}.ch">${all.map(c => `<option value="${c}"${c === x.ch ? ' selected' : ''}>${c}${b === 'b6' && WF.isPsc(c) ? ' (PSC)' : ''}</option>`).join('')}</select></label>`
        + `<label class="ntWfF"><span>${esc(tl('Largeur'))}</span><select data-ntwf-ap="${b}.w">${spec[b].widths.map(w => `<option value="${w}"${w === x.w ? ' selected' : ''}>${w} MHz</option>`).join('')}</select></label>`
        + `<label class="ntWfF"><span>${esc(tl('Puissance (dBm)'))}</span><input type="number" data-ntwf-ap="${b}.tx" value="${x.tx}" min="0" max="36" step="1"></label>`
        + `<label class="ntWfF"><span>${esc(tl('Gain d’antenne (dBi)'))}</span><input type="number" data-ntwf-ap="${b}.gain" value="${x.gain}" min="0" max="20" step="0.5"></label>`
        + `<p class="ntWfMut">${esc(b === 'b6' ? (s.reg === 'us-sp' ? tl('Fiche : {0} dBm au plus (conduite) ; puissance standard : PIRE {1} dBm au plus sur {2} MHz.', spec[b].tx, WF.lpiMax(s.reg, x.w), x.w) : tl('Fiche : {0} dBm au plus (conduite) ; point d’accès d’intérieur (LPI) : PIRE {1} dBm au plus sur {2} MHz.', spec[b].tx, WF.lpiMax(s.reg, x.w), x.w))
          : tl('Fiche : {0} dBm au plus (conduite), PIRE {1} dBm en Europe.', spec[b].tx, (b === 'b24' ? spec[b].eirp : spec[b].eirp && spec[b].eirp[WF.subband(x.ch)]) || '—'))}</p>`
        + (pf || rf ? `<p class="ntWfWarn">${esc(rf ? tl('Canal ou largeur non utilisable ici.') : pf.kind === 'lpi' ? tl('PIRE au-delà de la limite réglementaire à 6 GHz ({0} dBm au plus).', pf.max) : tl('Puissance au-delà de la fiche ({0} dBm au plus).', pf.max))}</p>` : '')
        + '</fieldset>';
    }
    return h + `<p class="ntWfMut">${esc(tl('Hauteur de pose : {0} m (plafond par défaut).', dev.loc && dev.loc.h > 0 ? fmt(dev.loc.h) : '—'))}</p></section>`;
  }
  /** Le projet a-t-il un point d'accès Wi-Fi 6E (bande de 6 GHz) ? */
  function hasB6() { try { return WF.apsOf(ctx.data()).some(a => WF.radio(a.r, 'b6').on || a.d.type === 'ap6e'); } catch { return false; } }
  /** Plan de canaux automatique de toutes les bandes, appliqué au plan (une seule étape d'annulation). */
  function autoPlan() {
    const d = ctx.data(), set = WF.wifiSettings(d);
    const ch = WF.BANDS.flatMap(b => WF.autoChannels(d, b, set));
    if (!ch.length) { ctx.status(tl('Plan de canaux : rien à changer.')); return 0; }
    WF.applyChannels(d, ch); ctx.commit();
    ctx.status(tl('Plan de canaux : {0} réglage(s) changé(s) (Ctrl+Z pour annuler).', ch.length), 'ok');
    return ch.length;
  }
  /** Événements de la barre, des réglages et de l'inspecteur du calque ; dev : point d'accès inspecté. Rend true si traité. */
  function handle(e, dev) {
    const t = e.target && e.target.closest ? e.target.closest('[data-ntwf],[data-ntwf-set],[data-ntwf-ap]') : null; if (!t) return false;
    if (t.dataset.ntwf === 'auto') { if (e.type === 'click') autoPlan(); return true; }
    if (e.type !== 'change') return t.dataset.ntwf !== undefined;
    if (t.dataset.ntwf === 'mode' && MODES.includes(t.value)) { mode = t.value; notify(); return true; }
    if (t.dataset.ntwf === 'tags') { tagsAll = !!t.checked; notify(); return true; }
    if (t.dataset.ntwf === 'band' && WF.VIEW_BANDS.includes(t.value)) { band = t.value; notify(); return true; }
    const d = ctx.data();
    if (t.dataset.ntwfSet) { d.wifi = WF.cleanWifi({ ...WF.wifiSettings(d), [t.dataset.ntwfSet]: t.type === 'number' ? +t.value : t.value }); ctx.commit(); return true; }
    if (t.dataset.ntwfAp && dev) {
      const [b, k] = t.dataset.ntwfAp.split('.'), r = WF.radiosOf(dev);
      r[b][k] = k === 'on' ? t.checked : +t.value;
      // Nouvelle largeur : le canal suit le premier canal possible si l'ancien ne forme pas de canal de cette largeur.
      if (k === 'w') { const reg = WF.wifiSettings(d).reg, chs = WF.channels(b, reg, r[b].w); if (chs.length && WF.radioFault(dev.type, b, r[b], reg)) r[b].ch = chs[0]; }
      dev.p.radios = WF.cleanRadios(r, dev.type); ctx.commit(); return true;
    }
    return false;
  }
  if (ctx && ctx.app && ctx.app.commands) {
    try {
      ctx.app.commands.register({ id: 'net.wifi.autochannel', cat: tl('Réseau'), icon: 'wifi', label: tl('Wi-Fi : plan de canaux automatique'), when: () => !!(ctx.isOn && ctx.isOn()) && WF.apsOf(ctx.data()).some(a => a.loc), run: () => autoPlan() });
    } catch (e) { console.error(e); }
  }
  return {
    paint, legend, toolbar, settingsHtml, apPane, handle, autoPlan,
    setMode(m) { if (MODES.includes(m)) { mode = m; notify(); } }, mode: () => mode,
    setBand(b) { if (WF.VIEW_BANDS.includes(b)) { band = b; notify(); } }, band: () => band,
    /** fn appelée quand un calcul en arrière-plan se termine (redessiner) ; rend de quoi l'enlever. */
    onReady(fn) { ready.add(fn); return () => ready.delete(fn); },
    /** Résultat affiché (tests, IA) : grille et statistiques, ou null. */
    result: () => last,
    destroy() { if (worker) worker.terminate(); worker = null; cache.clear(); imgs.clear(); ready.clear(); }
  };
}
