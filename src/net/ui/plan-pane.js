// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vue Plans : inspecteur des objets du plan (étage, bâtiment, pièce, mur, porte, cheminement, baie, sélection multiple).
// Les équipements et les câbles gardent l'inspecteur de la vue logique (pane rend null pour eux).
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { cleanText } from '../../sanitize.js';
import { MATERIALS, USAGES, SEG_CLASSES, findSiteObj, roomArea, inRoom, polyPerimeter, polyLen, dist, floorOf, isTechRoom } from '../site.js';
import { PATH_KINDS, SHIELDS, isTrayKind, isConduitKind, cablesByPath, fillOf, bendsOf, cleanPaths } from '../route.js';
import { PLAN_LIM } from '../lim/plan.js';
import { fmtNum } from './plan-draw.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n1 = (v, d = 2) => fmtNum(v, d, isEn);
const field = (label, html, tip = '') => `<label class="ntF"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${label}</span>${html}</label>`;
const inp = (k, v, o = '') => `<input class="inp" data-pl="${k}" value="${esc(v ?? '')}" ${o}>`;
const numIn = (k, v, min, max, step) => inp(k, v, `type="number" min="${min}" max="${max}" step="${step}"`);
const sel = (k, cur, opts) => `<select class="sel" data-pl="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const chk = (k, v, label) => `<label class="ntChk"><input type="checkbox" data-pl="${k}"${v ? ' checked' : ''}><span>${label}</span></label>`;
const btn = (a, ic, label, cls = 'subtle') => `<button type="button" class="btn small ${cls}" data-pla="${a}">${icon(ic)}<span>${label}</span></button>`;
const head = (ic, title, sub, del = true) => `<div class="ntHead">${icon(ic)}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>${del ? `<button type="button" class="tb" data-pla="del" data-tip="${tl('Retirer')}" aria-label="${tl('Retirer')}">${icon('trash')}</button>` : ''}</div>`;
const issList = (ctx, ids) => {
  const iss = ctx.issues().filter(i => ids.includes(i.id)); if (!iss.length) return '';
  return `<section class="ntSec"><h4>${tl('À corriger')}</h4><ul class="ntIss">${iss.slice(0, 8).map(i => `<li class="${i.kind}"><code>${i.code}</code> ${esc(i.text)}</li>`).join('')}</ul></section>`;
};
const floorOpts = data => (data.site.buildings || []).flatMap(b => b.floors.map(f => [f.id, `${b.name} · ${f.name}`]));

/** Inspecteur : html, ou null (équipement, câble : celui de la vue logique). V : l'état de la vue (plan.js). */
export function paneHtml(ctx, V, s) {
  const data = ctx.data(), multi = V.multi();
  if (multi.length > 1) {
    return `${head('layers', tl('{0} objets choisis', multi.length), tl('Plans'), true)}<p class="ntDoc">${tl('Glisser l’un d’eux les déplace tous ; flèches : 10 cm (Maj : 1 m) ; Suppr : les retirer.')}</p>`;
  }
  if (!s || s.kind === 'dev' || s.kind === 'cable') return s ? null : floorPane(ctx, V, V.floor());
  if (s.kind === 'path') { const p = (data.paths || []).find(x => x.id === s.id); return p ? pathPane(ctx, V, p) : null; }
  if (s.kind === 'rack') { const r = (data.racks || []).find(x => x.id === s.id); return r ? rackPane(ctx, r) : null; }
  const o = findSiteObj(data.site, s.id); if (!o) return null;
  if (o.kind === 'floor') return floorPane(ctx, V, o.f);
  if (o.kind === 'building') return buildingPane(o.b);
  if (o.kind === 'room') return roomPane(ctx, o);
  if (o.kind === 'wall') return wallPane(o.o);
  if (o.kind === 'door') return doorPane(o);
  return null;
}

function floorPane(ctx, V, f) {
  const data = ctx.data();
  if (!f) return `${head('floorPlan', tl('Plans'), tl('Aucun étage'), false)}<p class="ntDoc">${tl('Créez un bâtiment et son premier étage, puis dessinez les murs, les pièces et les cheminements. Les prises, points d’accès et caméras se posent depuis la bibliothèque.')}</p><section class="ntSec"><div class="row">${btn('newBuilding', 'plus', tl('Nouveau bâtiment'), 'primary')}${btn('demo', 'floorPlan', tl('Étage d’exemple'))}</div></section>`;
  const F = floorOf(data.site, f.id), b = F.b, devs = data.devices.filter(d => d.loc && d.loc.floor === f.id);
  const area = f.rooms.reduce((s, r) => s + roomArea(r), 0), im = f.image;
  const S = (data.design && data.design.slack) || {};
  let h = head('floorPlan', f.name, `${b.name} · ${tl('niveau {0}', f.level)}`);
  h += `<section class="ntSec">${field(tl('Nom'), inp('f.name', f.name, 'maxlength="40"'))}${field(tl('Niveau'), numIn('f.level', f.level, -20, 200, 1))}${field(tl('Altitude du sol (m)'), numIn('f.elev', f.elev, -100, 1000, 0.05))}${field(tl('Hauteur d’étage (m)'), numIn('f.height', f.height, 2, 30, 0.05), tl('De sol à sol : sert aux colonnes montantes'))}${field(tl('Sous plafond (m)'), numIn('f.ceil', f.ceil, 2, 30, 0.05))}${field(tl('Faux plafond (m)'), numIn('f.plenum', f.plenum, 0, 5, 0.05))}${field(tl('Faux plancher (m)'), numIn('f.raised', f.raised, 0, 2, 0.05))}</section>`;
  h += `<section class="ntSec"><h4>${tl('Contenu')}</h4><p class="mut">${tl('{0:# pièce|# pièces} · {1} m² · {2:# mur|# murs} · {3:# équipement|# équipements} · {4:# cheminement|# cheminements}', f.rooms.length, n1(area, 1), f.walls.length, devs.length, (data.paths || []).filter(p => p.floor === f.id).length)}</p><div class="row">${btn('addFloor', 'plus', tl('Étage au-dessus'))}${btn('copyFloor', 'copy', tl('Dupliquer l’étage'))}${f.walls.length > 2 ? btn('detect', 'wand', tl('Détecter les pièces')) : ''}</div></section>`;
  // Fond DXF/DWG de l'étage (plan-underlay.js) : visible, opacité, réglages, remplacement par une nouvelle révision.
  const ul = data.underlays && data.underlays[f.id];
  if (ul) {
    const nOn = (ul.layers || []).filter(l => l.on !== false).length;
    h += `<section class="ntSec"><h4>${tl('Fond DXF/DWG')}</h4><p><b>${esc(ul.name || (ul.source && ul.source.file) || '')}</b></p><p class="mut">${tl('{0:# calque affiché|# calques affichés} sur {1} · {2} traits', nOn, (ul.layers || []).length, ((ul.stats && ul.stats.segs) || 0).toLocaleString(isEn ? 'en' : 'fr'))}</p>${chk('ul.on', ul.on !== false, tl('Fond affiché'))}${field(tl('Opacité'), `<input type="range" data-pl="ul.opacity" min="0.1" max="1" step="0.05" value="${ul.opacity ?? 0.85}">`)}<div class="row">${btn('cadcard', 'layers', tl('Calques et position…'), 'primary')}${btn('cad', 'upload', tl('Nouvelle révision…'))}</div></section>`;
  }
  h += `<section class="ntSec"><h4>${tl('Image du plan')}</h4>`;
  if (im) h += `${field(tl('Opacité'), `<input type="range" data-pl="im.opacity" min="0.05" max="1" step="0.05" value="${im.opacity}">`)}${chk('im.lock', im.lock, tl('Verrouillé (ne bouge plus)'))}<p class="mut">${tl('Échelle : {0} cm par pixel · {1} × {2} m', n1(im.scale * 100, 3), n1(im.iw * im.scale, 1), n1(im.ih * im.scale, 1))}</p><div class="row">${btn('calib', 'calibrate', tl('Étalonner'), 'primary')}${btn('image', 'image', tl('Remplacer'))}${btn('rmImage', 'trash', tl('Retirer'))}</div>`;
  else h += `<p class="mut">${tl('Un plan scanné (PNG, JPG) sous le dessin : importez-le, puis étalonnez-le en cliquant deux points dont vous connaissez la distance.')}</p><div class="row">${ul ? '' : btn('cad', 'upload', tl('Importer un plan DXF ou DWG…'), 'primary')}${btn('image', 'image', tl('Importer une image'))}</div>`;
  h += '</section>';
  h += `<section class="ntSec"><h4>${tl('Site')}</h4>${field(tl('Nom du site'), inp('s.name', data.site.name, 'maxlength="60"'))}${field(tl('Classe de ségrégation'), sel('s.seg', data.site.seg, SEG_CLASSES.map(c => [c, tl('classe {0}', c) + (c === 'b' ? ' · ' + tl('U/UTP courant') : c === 'c' ? ' · ' + tl('câble écranté') : '')])), tl('EN 50174-2 : distance aux câbles d’énergie selon le câble de données'))}${field(tl('Nord (°)'), numIn('s.north', data.site.north, -360, 360, 1))}${field(tl('Accès sans cheminement (m)'), numIn('s.access', data.site.access, 0.5, 100, 0.5), tl('Réglage de conception : au-delà, le câble doit être porté (crochets, goulotte)'))}<p class="mut">${tl('Mou de service compté dans les longueurs : {0} m au local technique, {1} m à la prise (réglages par défaut de la conception, modifiables).', n1(S.tr ?? PLAN_LIM.SLACK_TR_M.v), n1(S.wa ?? PLAN_LIM.SLACK_WA_M.v))}</p></section>`;
  h += issList(ctx, [f.id, ...devs.map(d => d.id), ...f.rooms.map(r => r.id)]);
  void V;
  return h;
}
function buildingPane(b) {
  let h = head('building', b.name, tl('{0:# étage|# étages}', b.floors.length));
  h += `<section class="ntSec">${field(tl('Nom'), inp('b.name', b.name, 'maxlength="40"'))}${field(tl('Position X (m)'), numIn('b.x', b.x, -10000, 10000, 1), tl('Place sur le plan de masse : sert aux longueurs entre bâtiments'))}${field(tl('Position Y (m)'), numIn('b.y', b.y, -10000, 10000, 1))}</section>`;
  h += `<section class="ntSec"><div class="row">${btn('addFloor', 'plus', tl('Ajouter un étage'))}${btn('newBuilding', 'plus', tl('Nouveau bâtiment'))}</div></section>`;
  return h;
}
function roomPane(ctx, o) {
  const r = o.o, A = roomArea(r), devs = ctx.data().devices.filter(d => d.loc && d.loc.floor === o.f.id && inside(d.loc, r));
  let h = head('room', r.name || USAGES[r.usage].name(), `${USAGES[r.usage].name()} · ${n1(A, 1)} m²`);
  h += `<section class="ntSec">${field(tl('Nom'), inp('r.name', r.name, 'maxlength="40" placeholder="' + esc(tl('ex. Bureau 101')) + '"'))}${field(tl('Usage'), sel('r.usage', r.usage, Object.entries(USAGES).map(([k, u]) => [k, u.name()])))}<p class="mut">${tl('Surface {0} m² · périmètre {1} m · {2} sommets', n1(A, 2), n1(polyPerimeter(r.poly), 2), r.poly.length)}${r.holes ? ' · ' + tl('{0:# trou|# trous} (cour, patio)', r.holes.length) : ''}</p></section>`;
  const racks = (ctx.data().racks || []).filter(k => k.floor === o.f.id && inside({ x: k.x, y: k.y }, r));
  h += `<section class="ntSec"><h4>${tl('Équipements de la pièce')}</h4>${devs.length ? `<p>${devs.map(d => esc(d.name)).join(', ')}</p>` : racks.length ? '' : `<p class="mut">${tl('Aucun : glissez une prise ou un point d’accès depuis la bibliothèque.')}</p>`}${racks.length ? `<p>${icon('rack')} ${racks.map(k => esc(k.name)).join(', ')}</p>` : ''}${isTechRoom(r) ? `<div class="row">${btn('rack', 'rack', tl('Poser une baie ici'), 'primary')}${btn('wrack', 'rack', tl('Coffret mural'))}</div>` : ''}</section>`;
  return h + issList(ctx, [r.id]);
}
const inside = (loc, r) => inRoom([loc.x, loc.y], r);
function wallPane(w) {
  let h = head('wall', tl('Mur'), `${MATERIALS[w.mat].name()} · ${n1(dist(w.a, w.b))} m`);
  h += `<section class="ntSec">${field(tl('Matériau'), sel('w.mat', w.mat, Object.entries(MATERIALS).map(([k, m]) => [k, m.name()])), tl('Sert aussi au calcul de la couverture Wi-Fi'))}${field(tl('Épaisseur (cm)'), numIn('w.t', Math.round(w.t * 1000) / 10, 1, 200, 0.5))}${field(tl('Longueur (m)'), numIn('w.len', Math.round(dist(w.a, w.b) * 1000) / 1000, 0.05, 1000, 0.01), tl('Allonge ou raccourcit le mur depuis son extrémité de départ'))}<div class="row">${btn('door', 'plus', tl('Ajouter une porte'))}</div></section>`;
  return h;
}
function doorPane(o) {
  const d = o.o, w = o.f.walls.find(x => x.id === d.wall);
  let h = head('door', tl('Porte'), `${n1(d.w)} m`);
  h += `<section class="ntSec">${field(tl('Largeur (m)'), numIn('d.w', d.w, 0.5, 5, 0.05))}${field(tl('Position sur le mur (m)'), numIn('d.at', d.at, 0, w ? Math.round(dist(w.a, w.b) * 100) / 100 : 100, 0.05))}</section>`;
  return h;
}
function rackPane(ctx, r) {
  const data = ctx.data();
  let h = head('rack', r.name, tl('Baie {0} U · {1} × {2} mm', r.u, r.w, r.d));
  h += `<p class="ntDoc">${tl('Sa place sur le plan d’étage ; son contenu et ses réglages sont dans la vue Baies. La retirer (Suppr) garde ses équipements, hors baie.')}</p>`;
  h += `<section class="ntSec">${field(tl('Étage'), sel('k.floor', r.floor, floorOpts(data)))}${field(tl('Position X (m)'), numIn('k.x', r.x, -10000, 10000, 0.05))}${field(tl('Position Y (m)'), numIn('k.y', r.y, -10000, 10000, 0.05))}${field(tl('Orientation (°)'), numIn('k.rot', r.rot || 0, 0, 359, 90))}<div class="row">${btn('rot', 'rotate', tl('Tourner de 90°'))}${btn('openRack', 'rack', tl('Ouvrir dans la vue Baies'), 'primary')}</div></section>`;
  return h + issList(ctx, [r.id]);
}
function pathPane(ctx, V, p) {
  const data = ctx.data(), K = PATH_KINDS[p.kind], cs = cablesByPath(data).get(p.id) || [], fl = fillOf(p, cs);
  const len = p.kind === 'outdoor' ? p.len : p.kind === 'riser' ? 0 : polyLen(p.pts);
  let h = head('cableTray', p.name || K.name(), `${K.name()}${len ? ' · ' + n1(len, 1) + ' m' : ''}`);
  h += `<section class="ntSec">${field(tl('Nom'), inp('p.name', p.name, 'maxlength="40" placeholder="' + esc(tl('ex. CdC couloir nord')) + '"'))}${field(tl('Genre'), sel('p.kind', p.kind, Object.entries(PATH_KINDS).map(([k, x]) => [k, x.name()])))}`;
  if (p.kind !== 'riser') h += field(tl('Hauteur (m)'), numIn('p.z', p.z, -5, 30, 0.05), tl('Au-dessus du sol fini de l’étage (négatif : sous le faux plancher ou enterré)'));
  if (p.w) h += field(tl('Largeur utile (mm)'), numIn('p.w', p.w, 10, 2000, 5)) + field(tl('Hauteur utile (mm)'), numIn('p.h', p.h, 10, 1000, 5));
  if (p.dia) h += field(tl('Diamètre intérieur (mm)'), numIn('p.dia', p.dia, 5, 500, 0.5));
  if (p.kind === 'conduit') h += field(tl('Rayon des coudes (mm)'), numIn('p.rad', p.rad || 0, 0, 5000, 5), tl('0 : inconnu (pas vérifié)'));
  if (p.kind === 'riser') h += field(tl('Jusqu’à l’étage'), sel('p.top', p.top, floorOpts(data).filter(([id]) => { const A = floorOf(data.site, p.floor), B = floorOf(data.site, id); return A && B && A.b === B.b; })));
  if (p.kind === 'outdoor') h += field(tl('Arrivée'), sel('p.to', p.to, floorOpts(data))) + field(tl('Longueur (m)'), numIn('p.len', p.len, 1, 100000, 1));
  if (p.kind !== 'ceiling') h += field(tl('Cheminement métallique'), sel('p.shield', p.shield, Object.entries(SHIELDS).map(([k, f]) => [k, f()])), tl('EN 50174-2 : un cheminement métallique réduit la distance aux câbles d’énergie'));
  h += chk('p.power', p.power, tl('Cheminement d’énergie (câbles électriques)'));
  if (p.power) h += field(tl('Circuits 230 V 20 A'), numIn('p.circuits', p.circuits || 1, 1, 500, 1)) + `<p class="mut">${tl('Séparation vérifiée sur cet étage, entre colonnes montantes, et vers l’étage voisin à travers une gaine technique ou une colonne. Hypothèse de modélisation : ailleurs, la dalle sépare les étages.')}</p>`;
  h += '</section>';
  if (!p.power) {
    h += `<section class="ntSec"><h4>${tl('Remplissage')}</h4>`;
    if (p.kind === 'ceiling') h += `<p>${tl('{0:# câble|# câbles} sur les crochets (au plus {1} par support).', fl.n, PLAN_LIM.JHOOK_CABLES.v)}</p>`;
    else {
      const over = fl.ratio > fl.max;
      h += `<div class="ntGauge ntPlGauge${over ? ' over' : ''}"><i style="width:${Math.min(100, fl.ratio * 100).toFixed(1)}%"></i><b style="left:${(fl.max * 100).toFixed(1)}%"></b></div><p>${tl('{0:# câble|# câbles} · {1} % de la section (au plus {2} %)', fl.n, Math.round(fl.ratio * 100), Math.round(fl.max * 100))}</p>`;
      if (isTrayKind(p.kind)) h += `<p class="mut">${tl('Hauteur de câbles : {0} mm (au plus {1} mm).', Math.round(fl.depth), PLAN_LIM.TRAY_DEPTH_MM.v)}</p>`;
      if (isConduitKind(p.kind) && p.kind === 'conduit') h += `<p class="mut">${tl('Coudes : {0}° (au plus {1}° entre deux boîtes de tirage) · {2} m (au plus {3} m).', bendsOf(p), PLAN_LIM.CONDUIT_BEND_DEG.v, n1(len, 1), PLAN_LIM.CONDUIT_RUN_M.v)}</p>`;
    }
    h += `<p class="mut">${tl('Diamètres des câbles d’après les fiches des fabricants ; seuls les câbles au tracé automatique sont comptés.')}</p></section>`;
  }
  if (p.pts.length > 1 && p.kind !== 'outdoor') h += `<p class="mut">${tl('Double-clic sur un sommet : le retirer ; double-clic sur un tronçon : y ajouter un sommet.')}</p>`;
  void V;
  return h + issList(ctx, [p.id]);
}

/* ---------- Événements de l'inspecteur ---------- */
const num = (v, lo, hi) => { const x = +String(v).replace(',', '.'); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null; };
/** Champ ou bouton de l'inspecteur du plan ; rend true s'il est traité. */
export function paneEvent(ctx, V, e, s) {
  const t = e.target, k = t.dataset && t.dataset.pl, a = t.closest && t.closest('[data-pla]') && t.closest('[data-pla]').dataset.pla;
  if (!k && !a) return false;
  if (a) { if (e.type === 'click') V.action(a, s); return true; }
  if (e.type === 'input' && t.type !== 'range') return true; // les champs s'appliquent à la validation (change)
  const data = ctx.data(), v = t.type === 'checkbox' ? t.checked : t.value, f = V.floor();
  const [o, key] = k.split('.');
  const set = (obj, field, val) => { if (val == null || !obj) { ctx.renderPane(); return; } obj[field] = val; ctx.commit(); };
  if (o === 's') {
    if (key === 'name') set(data.site, 'name', cleanText(v, 60));
    else if (key === 'seg') set(data.site, 'seg', SEG_CLASSES.includes(v) ? v : null);
    else if (key === 'north') set(data.site, 'north', num(v, -360, 360));
    else if (key === 'access') set(data.site, 'access', num(v, 0.5, 100));
    return true;
  }
  if (o === 'f') {
    const F = s && s.kind === 'floor' ? findSiteObj(data.site, s.id)?.f : f; if (!F) return true;
    const lim = { level: [-20, 200], elev: [-100, 1000], height: [2, 30], ceil: [2, 30], plenum: [0, 5], raised: [0, 2] }[key];
    if (key === 'name') set(F, 'name', cleanText(v, 40).trim() || F.name);
    else if (lim) { const x = num(v, ...lim); set(F, key, key === 'level' && x != null ? Math.round(x) : x); }
    return true;
  }
  if (o === 'ul') {
    const u = data.underlays && f && data.underlays[f.id]; if (!u) return true;
    if (key === 'on') { u.on = !!v; ctx.commit(); }
    if (key === 'opacity') { u.opacity = num(v, 0.1, 1) ?? u.opacity; if (e.type === 'input') { V.paint(); return true; } ctx.commit(); }
    return true;
  }
  if (o === 'im') {
    if (!f || !f.image) return true;
    if (key === 'opacity') { f.image.opacity = num(v, 0.05, 1) ?? f.image.opacity; if (e.type === 'input') { V.paint(); return true; } ctx.commit(); }
    if (key === 'lock') set(f.image, 'lock', !!v);
    return true;
  }
  const so = s && findSiteObj(data.site, s.id);
  if (o === 'b' && so && so.kind === 'building') { if (key === 'name') set(so.b, 'name', cleanText(v, 40).trim() || so.b.name); else set(so.b, key, num(v, -10000, 10000)); return true; }
  if (o === 'r' && so && so.kind === 'room') { if (key === 'name') set(so.o, 'name', cleanText(v, 40).trim()); else if (key === 'usage') set(so.o, 'usage', USAGES[v] ? v : null); return true; }
  if (o === 'w' && so && so.kind === 'wall') {
    const w = so.o;
    if (key === 'mat') { if (MATERIALS[v]) { w.mat = v; ctx.commit(); } }
    else if (key === 't') set(w, 't', num(v, 1, 200) == null ? null : num(v, 1, 200) / 100);
    else if (key === 'len') { const L = num(v, 0.05, 1000), L0 = dist(w.a, w.b); if (L != null && L0 > 0) { w.b = [w.a[0] + (w.b[0] - w.a[0]) * L / L0, w.a[1] + (w.b[1] - w.a[1]) * L / L0].map(x => Math.round(x * 1000) / 1000); ctx.commit(); } }
    return true;
  }
  if (o === 'd' && so && so.kind === 'door') { set(so.o, key, num(v, 0, 1000)); return true; }
  if (o === 'k' && s && s.kind === 'rack') {
    const r = (data.racks || []).find(x => x.id === s.id); if (!r) return true;
    if (key === 'floor') { if (floorOf(data.site, v)) { r.floor = v; ctx.commit(); V.setFloor(v); } } else set(r, key, key === 'rot' ? (((num(v, -3600, 3600) ?? 0) % 360) + 360) % 360 : num(v, -10000, 10000));
    return true;
  }
  if (o === 'p' && s && s.kind === 'path') {
    const i = (data.paths || []).findIndex(x => x.id === s.id); if (i < 0) return true;
    const p = { ...data.paths[i] };
    if (key === 'name') p.name = cleanText(v, 40).trim();
    else if (key === 'kind') { if (!PATH_KINDS[v]) return true; const K = PATH_KINDS[v]; p.kind = v; delete p.w; delete p.h; delete p.dia; p.z = K.z; if (v === 'riser') { p.pts = p.pts.slice(0, 1); p.top = p.floor; } if (v === 'outdoor') { p.pts = [p.pts[0], p.pts[p.pts.length - 1]]; p.to = p.floor; } }
    else if (key === 'power') { p.power = !!v; if (v) p.circuits = p.circuits || 1; }
    else if (['top', 'to', 'shield'].includes(key)) p[key] = v;
    else { const x = num(v, -100000, 100000); if (x == null) { ctx.renderPane(); return true; } p[key] = x; }
    // Le nettoyeur des cheminements borne et complète (tailles du nouveau genre).
    const c = cleanPaths([p])[0]; if (c) { c.id = p.id; data.paths[i] = c; }
    ctx.commit(); return true;
  }
  return true;
}
