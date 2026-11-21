// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Façades des équipements dans l'élévation d'une baie (vue Baies) : dessin SVG à l'échelle (unité : le millimètre), ports
// placés comme sur un vrai appareil (rangées, cages SFP à droite), voyants d'après la simulation. Dessins faits ici,
// sans reprendre l'aspect d'aucun fabricant.
import { portsOf, specOf } from '../devices.js';
import { MOUNT, U_MM, PANEL_MM } from '../rack.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Oreilles de fixation (largeur d'une oreille, mm) : la façade utile fait 482,6 − 2 × EAR. */
export const EAR = 16;
const ledCls = l => (!l ? 'off' : !l.up ? 'down' : l.errors ? 'err' : l.speed >= 1000 ? 'g' : l.speed >= 100 ? 'f' : 'e');
const n = v => Math.round(v * 10) / 10;
/** Hauteur dessinée d'un équipement (mm) : ses U, moins un jeu de 0,8 mm (façade réelle un peu plus basse que ses U). */
export const faceH = u => u * U_MM - 0.8;

/**
 * Place des ports sur la façade : Map(port → { x, y, w, h }) en mm, repère de la façade (coin haut gauche). Ports RJ45 en
 * une ou deux rangées (switch : impairs en haut, pairs en bas ; panneau : première moitié en haut), cages SFP à droite.
 */
export function portSlots(d, hmm) {
  const out = new Map(), s = specOf(d); if (!s) return out;
  const ports = portsOf(d), passive = s.role === 'passive';
  const rj = ports.filter(p => !p.punch && !p.sfp && !(passive && p.fibre && /^b/.test(p.id))), cages = ports.filter(p => p.sfp);
  if (!rj.length && !cages.length) return out;
  const two = hmm > 80 || rj.length > 24 || (!passive && rj.length >= 16);
  const rows = two ? 2 : 1, ph = two ? Math.min(9.5, (hmm - 14) / 2.2) : Math.min(11.5, hmm - 14), pw = d.type === 'fibrepanel' ? 9 : 11;
  const cageCols = cages.length > 8 ? Math.ceil(cages.length / 2) : cages.length, cageRows = cages.length > 8 ? 2 : (cages.length > 2 && two ? 2 : 1);
  const cageW = cages.length ? Math.ceil(cages.length / cageRows) * 15.5 + 8 : 0;
  const x0 = EAR + 46, x1 = PANEL_MM - EAR - 8 - cageW;
  const perRow = Math.ceil(rj.length / rows), blocks = Math.max(0, Math.ceil(perRow / 6) - 1);
  const pitch = perRow ? Math.min(16.5, (x1 - x0 - blocks * 5) / perRow) : 0;
  const top = (hmm - (rows * ph + (rows - 1) * 3)) / 2;
  rj.forEach((p, k) => {
    const row = !two ? 0 : passive ? Math.floor(k / perRow) : k % 2, col = !two ? k : passive ? k % perRow : Math.floor(k / 2);
    out.set(p.id, { x: n(x0 + col * pitch + Math.floor(col / 6) * 5), y: n(top + row * (ph + 3)), w: n(Math.min(pw, pitch - 1.5)), h: n(ph) });
  });
  if (cages.length) {
    const per = Math.ceil(cages.length / cageRows), ch = Math.min(8.5, (hmm - 14) / (cageRows === 2 ? 2.3 : 1.2)), ctop = (hmm - (cageRows * ch + (cageRows - 1) * 3)) / 2;
    cages.forEach((p, k) => {
      const row = cageRows === 2 ? Math.floor(k / per) : 0, col = cageRows === 2 ? k % per : k;
      out.set(p.id, { x: n(x1 + 8 + col * 15.5), y: n(ctop + row * (ch + 3)), w: 13.5, h: n(ch), cage: true });
    });
  }
  void cageCols;
  return out;
}

/** Façade d'un équipement : chaîne SVG dans le repère de la façade (largeur PANEL_MM, hauteur hmm). */
export function faceSvg(d, hmm, o = {}) {
  const m = MOUNT[d.type] || {}, s = specOf(d) || {}, W = PANEL_MM, kind = d.type;
  const lan = o.lan, used = o.used || new Set();
  let g = `<rect class="ntRkEar" x="0" y="0" width="${W}" height="${n(hmm)}" rx="1.5"/>`;
  g += `<rect class="ntRkBody ${o.back ? 'back' : ''}" x="${EAR}" y="0" width="${W - 2 * EAR}" height="${n(hmm)}" rx="1"/>`;
  for (const yy of hmm > 50 ? [7, hmm - 7] : [hmm / 2]) for (const xx of [EAR / 2, W - EAR / 2]) g += `<circle class="ntRkScrew" cx="${xx}" cy="${n(yy)}" r="2.6"/>`;
  const label = (x, y, size = 7.5) => `<text class="ntRkLbl" x="${x}" y="${n(y)}" font-size="${size}">${esc(d.name)}</text>`;
  if (o.back) return g + backSvg(d, hmm, o);
  if (kind === 'blank') return g;
  if (kind === 'cablemgr') {
    // Anneaux (vus de face) : boucles ouvertes vers le haut où passent les cordons.
    for (let k = 0; k < 5; k++) { const x = EAR + 40 + k * ((W - 2 * EAR - 80) / 4); g += `<path class="ntRkRing" d="M${n(x - 22)} ${n(hmm * 0.3)}v${n(hmm * 0.3)}q0 ${n(hmm * 0.22)} 10 ${n(hmm * 0.22)}h24q10 0 10 -${n(hmm * 0.22)}v-${n(hmm * 0.3)}"/>`; }
    g += `<rect class="ntRkVent" x="${EAR + 6}" y="${n(hmm * 0.18)}" width="${W - 2 * EAR - 12}" height="2" rx="1"/>`;
    return g;
  }
  if (kind === 'fan') {
    for (let k = 0; k < 4; k++) { const cx = EAR + 70 + k * 100, r = Math.min(17, hmm / 2 - 3); g += `<circle class="ntRkFanC" cx="${cx}" cy="${n(hmm / 2)}" r="${r}"/><path class="ntRkFanB" d="M${cx - r * 0.7} ${n(hmm / 2)}h${n(r * 1.4)}M${cx} ${n(hmm / 2 - r * 0.7)}v${n(r * 1.4)}"/>`; }
    return g;
  }
  if (kind === 'shelf') return `<rect class="ntRkShelf" x="${EAR}" y="${n(hmm - 6)}" width="${W - 2 * EAR}" height="6"/>` + `<rect class="ntRkEar" x="0" y="${n(hmm - 9)}" width="${EAR}" height="9"/><rect class="ntRkEar" x="${W - EAR}" y="${n(hmm - 9)}" width="${EAR}" height="9"/>`;
  if (m.ups || m.ebmOf) {
    for (let k = 0; k < 9; k++) g += `<rect class="ntRkVent" x="${EAR + 14 + k * 9}" y="10" width="5" height="${n(hmm - 20)}" rx="1"/>`;
    for (let k = 0; k < 9; k++) g += `<rect class="ntRkVent" x="${W - EAR - 95 + k * 9}" y="10" width="5" height="${n(hmm - 20)}" rx="1"/>`;
    if (m.ups) g += `<rect class="ntRkScreen" x="${W / 2 - 45}" y="14" width="90" height="${n(hmm - 44)}" rx="2"/><rect class="ntRkStatus" x="${W / 2 - 60}" y="${n(hmm - 22)}" width="120" height="4" rx="2"/><circle class="ntRkBtn" cx="${W / 2 + 62}" cy="${n(hmm / 2 - 6)}" r="4"/>`;
    return g + label(W / 2 - 44, hmm - 9, 7);
  }
  if (m.pdu) {
    for (let k = 0; k < 16; k++) g += `<rect class="ntRkOutlet" x="${EAR + 80 + k * 21}" y="${n(hmm / 2 - 6)}" width="14" height="12" rx="2"/>`;
    return g + label(EAR + 6, hmm / 2, 7);
  }
  if (kind === 'server' || kind === 'nas') {
    const bays = kind === 'nas' ? 7 : 8, bw = kind === 'nas' ? 44 : 34, bh = kind === 'nas' ? hmm - 16 : hmm - 14;
    for (let k = 0; k < bays; k++) g += `<rect class="ntRkBay" x="${EAR + 70 + k * (bw + 4)}" y="${n((hmm - bh) / 2)}" width="${bw}" height="${n(bh)}" rx="1.5"/><circle class="ntRkLed g" cx="${EAR + 70 + k * (bw + 4) + bw - 5}" cy="${n((hmm - bh) / 2 + 4)}" r="1.4"/>`;
    return g + label(EAR + 6, hmm / 2, 7.5);
  }
  if (m.shelf) {
    // Appareil de bureau posé sur une tablette : un petit boîtier, pas une façade 19 pouces.
    const bw = kind === 'mediaconv' ? 94.5 : 171, bh = Math.min(27, hmm - 2), x = EAR + 30, y = hmm - bh;
    let b = `<rect class="ntRkBox" x="${x}" y="${n(y)}" width="${bw}" height="${n(bh)}" rx="2.5"/>`;
    const slots = portSlots(d, bh);
    const sc = (bw - 20) / (W - 2 * EAR - 60), list = [...slots];
    list.forEach(([pid, p], k) => { const px = x + 8 + k * Math.min(15, (bw - 16) / list.length), l = lan ? lan.port(d.id, pid) : null; b += `<rect class="ntRkPort ${used.has(pid) ? 'used' : ''}" data-port="${esc(pid)}" x="${n(px)}" y="${n(y + bh / 2 - 4)}" width="${n(Math.min(11, (bw - 16) / list.length - 2))}" height="8" rx="1"/><circle class="ntRkLed ${ledCls(l)}" cx="${n(px + 2)}" cy="${n(y + bh / 2 - 6)}" r="1.1"/>`; void p; });
    void sc;
    return b + `<text class="ntRkLbl" x="${n(x + bw + 6)}" y="${n(y + bh / 2)}" font-size="7">${esc(d.name)}</text>`;
  }
  // Appareils à ports : switchs, routeurs, panneaux de brassage cuivre et fibre.
  const slots = portSlots(d, hmm);
  for (const [pid, p] of slots) {
    const l = lan && s.role !== 'passive' ? lan.port(d.id, pid) : null;
    if (p.cage) g += `<rect class="ntRkCage ${used.has(pid) ? 'used' : ''}" data-port="${esc(pid)}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="0.8"/>`;
    else if (d.type === 'fibrepanel') g += `<rect class="ntRkPort lc ${used.has(pid) ? 'used' : ''}" data-port="${esc(pid)}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="1.2"/><path class="ntRkLcSplit" d="M${n(p.x + p.w / 2)} ${p.y}v${p.h}"/>`;
    else g += `<rect class="ntRkPort ${used.has(pid) ? 'used' : ''}" data-port="${esc(pid)}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="0.8"/>`;
    if (l) g += `<circle class="ntRkLed ${ledCls(l)}" cx="${n(p.x + 2.2)}" cy="${n(p.y - 1.6)}" r="1.05"/>`;
    if (s.role === 'passive' && slots.size <= 48) g += `<text class="ntRkNum" x="${n(p.x + p.w / 2)}" y="${n(p.y + p.h + 4.6)}" font-size="3.6">${esc(String(pid).replace(/^f/, ''))}</text>`;
  }
  return g + label(EAR + 5, hmm / 2, hmm > 50 ? 8 : 7);
}

/** PDU verticale (0U) vue de face : une barre de longueur len (mm) avec ses prises. */
export function pduStripSvg(d, len, outlets = 38) {
  const w = 52, k = Math.min(outlets, Math.floor((len - 120) / 30));
  let g = `<rect class="ntRkPdu" x="0" y="0" width="${w}" height="${n(len)}" rx="4"/><rect class="ntRkScreen" x="10" y="16" width="32" height="18" rx="2"/>`;
  for (let i = 0; i < k; i++) g += `<rect class="ntRkOutlet" x="15" y="${n(56 + i * ((len - 80) / k))}" width="22" height="16" rx="3"/>`;
  // Nom : le long du bord gauche de la barre, vertical, dans son cadre (sans déborder sur le rail).
  return g + `<text class="ntRkLbl ntRkPduLbl" x="0" y="0" font-size="8" text-anchor="middle" transform="translate(8 ${n(len / 2)}) rotate(-90)">${esc(d.name)}</text>`;
}

/* ---------- Arrière des équipements, vu de derrière ----------
 * Les éléments de l'arrière sont placés dans le repère de la façade AVANT de l'appareil (x depuis son bord gauche vu de
 * devant), puis retournés gauche-droite pour le dessin vu de derrière : X = largeur − x − w. Ce qui est à gauche vu de
 * devant (port 1 d'un panneau, alimentation d'un serveur) apparaît donc à droite vu de derrière. Le texte n'est pas
 * retourné (seule sa place l'est). */
/** Types dont les ports réseau sont à l'arrière (cartes réseau d'un serveur, d'un NAS). */
export const BACK_PORTS = new Set(['server', 'nas']);
const mirror = p => ({ ...p, x: n(PANEL_MM - p.x - p.w) });
/** Éléments de l'arrière (repère de la façade avant ; rien sous x = 90 mm, place du nom vu de derrière) : [{ kind: 'psu' | 'fan' | 'port' | 'punch' | 'outlet' | 'inlet' | 'conn', x, y, w, h, id? }]. */
function backParts(d, hmm) {
  const m = MOUNT[d.type] || {}, s = specOf(d) || {}, W = PANEL_MM, out = [], mid = hmm / 2;
  const psu = x => out.push({ kind: 'psu', x, y: 5, w: 64, h: n(hmm - 10) }), fan = x => out.push({ kind: 'fan', x, y: 5, w: 70, h: n(hmm - 10) });
  if (BACK_PORTS.has(d.type)) {
    psu(W - EAR - 74); if (d.type === 'server') psu(W - EAR - 144);
    portsOf(d).filter(p => !p.punch).forEach((p, k) => out.push({ kind: 'port', id: p.id, x: n(EAR + 110 + k * 17), y: n(mid - 5.5), w: 12.5, h: 11 }));
    fan(W / 2 - 20);
  } else if (s.role === 'passive') {
    // Panneau : les blocs à perforer sont derrière les ports avant de même numéro.
    for (const [pid, sl] of portSlots(d, hmm)) out.push({ kind: 'punch', id: pid.replace(/^f/, 'b'), x: sl.x, y: sl.y, w: sl.w, h: sl.h });
  } else if (m.ups) {
    out.push({ kind: 'inlet', x: W - EAR - 40, y: n(mid - 9), w: 22, h: 18 });
    for (let k = 0; k < m.ups.outlets; k++) out.push({ kind: 'outlet', x: EAR + 150 + k * 24, y: n(mid - 8), w: 16, h: 16 });
    out.push({ kind: 'conn', x: EAR + 95, y: n(mid - 10), w: 44, h: 20 });
  } else if (m.ebmOf) {
    out.push({ kind: 'conn', x: EAR + 95, y: n(mid - 10), w: 44, h: 20 });
    fan(W / 2);
  } else if (m.typ || m.max || s.role) {
    psu(W - EAR - 80); fan(EAR + 100);
  }
  return out;
}
/** Ports de l'arrière vus de derrière (repère du dessin) : Map(port → { x, y, w, h }). */
export function backPortSlots(d, hmm) {
  const out = new Map();
  for (const p of backParts(d, hmm)) if (p.id) out.set(p.id, mirror(p));
  return out;
}
/** Arrière d'un appareil vu de derrière (chaîne SVG, même repère que faceSvg). */
function backSvg(d, hmm, o) {
  const lan = o.lan, used = o.used || new Set(), parts = backParts(d, hmm).map(mirror);
  let g = '';
  for (const p of parts) {
    if (p.kind === 'psu') g += `<rect class="ntRkPsu" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="1.5"/><rect class="ntRkPort" x="${n(p.x + p.w - 16)}" y="${n(p.y + p.h / 2 - 5)}" width="11" height="10" rx="1.5"/>`;
    else if (p.kind === 'fan') { const r = Math.min(p.h / 2 - 1, 15); g += `<circle class="ntRkFanC" cx="${n(p.x + p.w / 2)}" cy="${n(p.y + p.h / 2)}" r="${n(r)}"/>`; }
    else if (p.kind === 'port' || p.kind === 'punch') {
      g += `<rect class="ntRkPort ${p.kind === 'punch' ? 'punch' : ''} ${used.has(p.id) ? 'used' : ''}" data-port="${esc(p.id)}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="0.8"/>`;
      if (p.kind === 'port' && lan) { const l = lan.port(d.id, p.id); g += `<circle class="ntRkLed ${ledCls(l)}" cx="${n(p.x + 2.2)}" cy="${n(p.y - 1.6)}" r="1.05"/>`; }
      if (p.kind === 'punch' && hmm > 30) g += `<text class="ntRkNum" x="${n(p.x + p.w / 2)}" y="${n(p.y + p.h + 4.6)}" font-size="3.6">${esc(p.id.replace(/^b/, ''))}</text>`;
    } else if (p.kind === 'outlet' || p.kind === 'inlet') g += `<rect class="ntRkOutlet" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="2.5"/>`;
    else if (p.kind === 'conn') g += `<rect class="ntRkScreen" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="2"/>`;
  }
  // Nom : à droite vu de derrière (il est à gauche vu de devant), texte lisible.
  return g + `<text class="ntRkLbl" x="${n(PANEL_MM - EAR - 6)}" y="${n(hmm / 2)}" font-size="7" text-anchor="end">${esc(d.name)}</text>`;
}
