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
const RAMP = ['#16a34a', '#84cc16', '#eab308', '#f97316', '#dc2626'];
const HUES = [210, 25, 130, 280, 50, 330, 170, 0, 90, 250, 300, 190];
const isLight = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
const css = (name, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || d; } catch { return d; } };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const fmt = v => dec(String(Math.round(v * 10) / 10));
const BN = { b24: () => dec('2,4') + ' GHz', b5: () => '5 GHz', b6: () => '6 GHz' };

/** Seuils d'une carte : [{ v, color, label }] du meilleur au moins bon. */
function stops(mode, set) {
  const t = set.target;
  if (mode === 'signal') return [[t, `≥ ${t} dBm`], [t - 3, `${t - 3} dBm`], [t - 8, `${t - 8} dBm`], [t - 13, `${t - 13} dBm`], [t - 18, `${t - 18} dBm`]].map(([v, label], i) => ({ v, color: RAMP[i], label }));
  if (mode === 'snr') return [[set.snr, `≥ ${set.snr} dB`], [set.snr - 5, `${set.snr - 5} dB`], [set.snr - 10, `${set.snr - 10} dB`], [set.snr - 15, `${set.snr - 15} dB`], [set.snr - 20, `${set.snr - 20} dB`]].map(([v, label], i) => ({ v, color: RAMP[i], label }));
  if (mode === 'sinr') return [[set.sinr, `≥ ${set.sinr} dB`], [set.sinr - 5, `${set.sinr - 5} dB`], [set.sinr - 10, `${set.sinr - 10} dB`], [set.sinr - 15, `${set.sinr - 15} dB`], [set.sinr - 20, `${set.sinr - 20} dB`]].map(([v, label], i) => ({ v, color: RAMP[i], label }));
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
    if (mode === 'signal') { for (const s of st) if (b >= s.v) { rgb = s.rgb; break; } }
    else if (mode === 'snr') { const v = b - set.noise; for (const s of st) if (v >= s.v) { rgb = s.rgb; break; } }
    else if (mode === 'sinr') { const v = res.sinr ? res.sinr[c] : -Infinity; for (const s of st) if (v >= s.v) { rgb = s.rgb; break; } }
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
  let mode = 'signal', band = (() => { try { return WF.wifiSettings(ctx && ctx.data ? ctx.data() : null).band; } catch { return 'any'; } })(), last = null, worker = null, seq = 0, waiting = null, workerOk = typeof Worker !== 'undefined';
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
    // Canaux des points d'accès de l'étage, près de chacun.
    const fg = css('--fg', '#e6edf3'), bg = css('--panel', '#1b222b'), line = css('--line-2', '#3a4552');
    g.font = `600 ${Math.max(10, Math.min(13, 11 * Math.sqrt(v.k / 20)))}px system-ui, sans-serif`; g.textBaseline = 'middle';
    const placed = [];
    res.aps.forEach((a, i) => {
      if (!a.same) return;
      const sx = (a.x - v.x) * v.k, sy = (a.y - v.y) * v.k, parts = [];
      for (const b of WF.BANDS) {
        const x = WF.radio(a.r, b); if (!x.on || (res.band !== 'any' && res.band !== b)) continue;
        parts.push(`${b === 'b24' ? dec('2,4') : b === 'b5' ? '5' : '6'} : ${x.ch}${b !== 'b24' && x.w > 20 ? '/' + x.w : ''}`);
      }
      const t = a.off ? tl('éteint (sans courant)') : parts.join(' · ') || tl('radio coupée'), w = g.measureText(t).width + 10, h = 18, x = sx + 13;
      // Étiquettes qui se chevauchent (points d'accès proches) : décalées vers le bas.
      let y = sy - h - 8; for (let k = 0; k < 12 && placed.some(q => x < q[0] + q[2] && q[0] < x + w && y < q[1] + h + 2 && q[1] < y + h + 2); k++) y += h + 3;
      placed.push([x, y, w]);
      g.fillStyle = bg; g.globalAlpha = 0.92; g.fillRect(x, y, w, h); g.globalAlpha = 1;
      g.strokeStyle = mode === 'cells' ? `rgb(${hsl(HUES[i % HUES.length], 70, isLight() ? 45 : 55).join(',')})` : line; g.lineWidth = mode === 'cells' ? 2 : 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.fillStyle = fg; g.fillText(t, x + 5, y + h / 2 + 0.5);
    });
    g.restore();
  }
  /** Légende (HTML) : rampe du mode, réglages, couverture de l'étage affiché, mention « modèle simplifié ». */
  function legend() {
    const res = last, set = res ? res.set : WF.wifiSettings(ctx && ctx.data ? ctx.data() : null);
    const st = stops(mode, set);
    let h = `<div class="ntWfLeg"><div class="ntWfLegT">${esc(MODE_NAME[mode]())} · ${esc(BAND_LABEL[band]())}</div>`;
    if (mode === 'cells') h += `<p class="ntWfMut">${esc(tl('Une couleur par point d’accès (le plus fort reçu) ; teinte pâle : sous {0} dBm.', set.target))}</p>`;
    else h += `<ul class="ntWfRamp">${st.map(s => `<li><i style="background:${s.color}"></i>${esc(s.label)}</li>`).join('')}<li><i class="ntWfNone"></i>${esc(tl('rien'))}</li></ul>`;
    if (mode === 'sinr') h += `<p class="ntWfMut">${esc(tl('SINR : signal du plus fort contre bruit + autres points d’accès de la bande, comptés au prorata du spectre commun ; tous émettent en même temps (pire cas). Objectif {0} dB (modifiable).', set.sinr))}</p>`;
    if (mode === 'overlap') h += `<p class="ntWfMut">${esc(tl('Points d’accès entendus sur un canal qui chevauche celui du plus fort (au-dessus de {0} dBm).', set.noise + 4))}</p>`;
    if (res) {
      const at = ctx && ctx.data ? WF.findFloor(ctx.data(), res.floor) : null;
      h += mode === 'sinr' && res.sinr ? `<p><b>${Math.round(WF.floorPct(res, at && at.floor, set.sinr, 'sinr'))} %</b> ${esc(tl('de l’étage à un SINR de {0} dB ou plus', set.sinr))}</p>`
        : `<p><b>${Math.round(WF.floorPct(res, at && at.floor, set.target))} %</b> ${esc(tl('de l’étage à {0} dBm ou plus', set.target))}</p>`;
      const rows = at ? (at.floor.rooms || []).filter(WF.needsWifi).map(r => { const cells = WF.cellsIn(res, r.poly); return { r, pct: cells.length ? WF.pctAbove(res, set.target, cells) : 0 }; }).sort((a, b) => a.pct - b.pct).slice(0, 8) : [];
      // Pièces les moins bien couvertes : repliées (la carte ne doit pas cacher l'étage), dépliées d'office s'il y a un trou.
      if (rows.length) h += `<details class="ntWfMore"${rows.some(x => x.pct < set.cover) ? ' open' : ''}><summary>${esc(tl('Couverture par pièce ({0})', rows.length))}</summary><table class="ntWfRooms">${rows.map(x => `<tr class="${x.pct < set.cover ? 'ntWfBad' : ''}"><td>${esc(x.r.name || x.r.id)}</td><td>${Math.round(x.pct)} %</td></tr>`).join('')}</table></details>`;
    } else h += `<p class="ntWfMut">${esc(tl('Calcul de la couverture…'))}</p>`;
    h += `<p class="ntWfMut">${esc(tl('Modèle simplifié : affaiblissement UIT-R P.1238, murs UIT-R P.2040 (incidence normale), bruit supposé {0} dBm. Une mesure sur place reste nécessaire.', set.noise))}</p>`;
    if (band === 'b6' || (band === 'any' && res && res.parts && res.parts.b6)) h += `<p class="ntWfMut">${esc(tl('6 GHz : coefficients de l’UIT-R P.1238 extrapolés de 5,8 GHz (aucune valeur à 6 GHz).'))}</p>`;
    h += '</div>';
    return h;
  }
  /** Barre du calque (HTML) : mode, bande, plan de canaux automatique, réglages. */
  function toolbar() {
    const opt = (list, cur, name) => list.map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(name[k]())}</option>`).join('');
    const ic = ctx && ctx.icon ? ctx.icon('wifi') : '';
    return `<div class="ntWfBar"><select data-ntwf="mode" aria-label="${esc(tl('Carte Wi-Fi'))}">${opt(MODES, mode, MODE_NAME)}</select>`
      + `<select data-ntwf="band" aria-label="${esc(tl('Bande'))}">${opt(['b5', 'b24', ...(hasB6() ? ['b6'] : []), 'any'], band, BAND_LABEL)}</select>`
      + `<button type="button" data-ntwf="auto" title="${esc(tl('Donne aux points d’accès voisins des canaux qui ne se chevauchent pas (annulable).'))}">${ic}<span>${esc(tl('Plan de canaux auto'))}</span></button></div>`;
  }
  /** Réglages Wi-Fi du projet (valeurs par défaut modifiables). */
  function settingsHtml() {
    const d = ctx.data(), s = WF.wifiSettings(d), field = (label, html) => `<label class="ntWfF"><span>${esc(label)}</span>${html}</label>`;
    const numIn = (k, v, lo, hi, st = 1) => `<input type="number" data-ntwf-set="${k}" value="${v}" min="${lo}" max="${hi}" step="${st}">`;
    return `<section class="ntWfSet"><h4>${esc(tl('Réglages Wi-Fi du projet'))}</h4>`
      + field(tl('Domaine réglementaire'), `<select data-ntwf-set="reg"><option value="eu"${s.reg === 'eu' ? ' selected' : ''}>${esc(tl('Europe (CE)'))}</option><option value="us"${s.reg === 'us' ? ' selected' : ''}>${esc(tl('États-Unis (FCC)'))}</option></select>`)
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
      const x = r[b], chs = b === 'b6' ? WF.allowed(b, s.reg).filter(c => WF.block6(c, x.w) && WF.allowed(b, s.reg).includes(WF.block6(c, x.w)[1])) : WF.channels(b, s.reg, x.w), all = chs.includes(x.ch) ? chs : [x.ch, ...chs];
      const pf = WF.powerFault(dev.type, b, x, s.reg), rf = WF.radioFault(dev.type, b, x, s.reg);
      h += `<fieldset class="ntWfRadio"><legend><label><input type="checkbox" data-ntwf-ap="${b}.on"${x.on ? ' checked' : ''}> ${BN[b]()}</label></legend>`
        + `<label class="ntWfF"><span>${esc(tl('Canal'))}</span><select data-ntwf-ap="${b}.ch">${all.map(c => `<option value="${c}"${c === x.ch ? ' selected' : ''}>${c}${b === 'b6' && WF.isPsc(c) ? ' (PSC)' : ''}</option>`).join('')}</select></label>`
        + `<label class="ntWfF"><span>${esc(tl('Largeur'))}</span><select data-ntwf-ap="${b}.w">${spec[b].widths.map(w => `<option value="${w}"${w === x.w ? ' selected' : ''}>${w} MHz</option>`).join('')}</select></label>`
        + `<label class="ntWfF"><span>${esc(tl('Puissance (dBm)'))}</span><input type="number" data-ntwf-ap="${b}.tx" value="${x.tx}" min="0" max="36" step="1"></label>`
        + `<label class="ntWfF"><span>${esc(tl('Gain d’antenne (dBi)'))}</span><input type="number" data-ntwf-ap="${b}.gain" value="${x.gain}" min="0" max="20" step="0.5"></label>`
        + `<p class="ntWfMut">${esc(b === 'b6' ? tl('Fiche : {0} dBm au plus (conduite) ; point d’accès d’intérieur (LPI) : PIRE {1} dBm au plus sur {2} MHz.', spec[b].tx, WF.lpiMax(s.reg, x.w), x.w)
          : tl('Fiche : {0} dBm au plus (conduite), PIRE {1} dBm en Europe.', spec[b].tx, (b === 'b24' ? spec[b].eirp : spec[b].eirp && spec[b].eirp[WF.subband(x.ch)]) || '—'))}</p>`
        + (pf || rf ? `<p class="ntWfWarn">${esc(rf ? tl('Canal ou largeur non utilisable ici.') : pf.kind === 'lpi' ? tl('PIRE au-delà de la limite LPI ({0} dBm au plus).', pf.max) : tl('Puissance au-delà de la fiche ({0} dBm au plus).', pf.max))}</p>` : '')
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
