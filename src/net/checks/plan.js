// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau (partie plan), fusionnées par src/net/issues.js (codes J12xx) et contrôles de TP
// fusionnés par src/net/labcheck.js.
//   J1250 cheminement trop rempli · J1251 conduit trop long ou trop coudé entre deux boîtes de tirage · J1252 coude
//   de conduit trop serré · J1253 cheminement de données trop près d'un cheminement d'énergie (même étage, ou colonnes montantes côte à côte) · J1254 équipement hors
//   de toute pièce · J1255 câble sans cheminement (longueur estimée) · J1256 câble entre étages sans colonne montante ·
//   J1257 étage avec des prises mais sans local technique · J1258 prise à plus de 90 m de câble du local technique ·
//   J1259 local technique qui dessert plus de 929 m² · J1260 plus de 20 câbles sur des crochets · J1261 plus de 150 mm
//   de câbles dans un chemin de câbles · J1262 câble qui court sans support entre l'équipement et le cheminement (plus
//   que l'accès réglé du site, 6 m par défaut : réglage de conception).
import { tl, isEn } from '../../i18n/index.js';
import { PLAN_LIM as L } from '../lim/plan.js';
import { allFloors, floorOf, roomAt, isTechRoom, isShaft, roomArea, roomPoint, polyLen, project, inPoly, ACCESS_M } from '../site.js';
import { cablesByPath, fillOf, bendsOf, separationMm, isConduitKind, isTrayKind, locate, pathDistance, graphOf, cableOd, PATH_KINDS } from '../route.js';

/** Niveau de chaque code : 'error' | 'warning'. */
export const CODES = {
  J1250: 'error', J1251: 'warning', J1252: 'warning', J1253: 'error', J1254: 'warning', J1255: 'warning', J1256: 'warning',
  J1257: 'warning', J1258: 'warning', J1259: 'warning', J1260: 'warning', J1261: 'warning', J1262: 'warning'
};
/** Sources de chaque code (clés de src/check/sources.js). */
export const SRC = {
  J1250: [...L.CONDUIT_FILL.src, ...L.TRAY_FILL.src, ...L.CABLE_OD_MM.src].filter((k, i, a) => a.indexOf(k) === i),
  J1251: [...L.CONDUIT_RUN_M.src, ...L.CONDUIT_BEND_DEG.src].filter((k, i, a) => a.indexOf(k) === i),
  J1252: [...L.CONDUIT_RADIUS.src, ...L.CABLE_RADIUS.src],
  J1253: L.SEGREGATION_MM.src, J1254: ['umichDG54'], J1255: ['ufgs271000', 'beldenCopperDesignGuide'], J1256: ['umichDG54', 'ufc358001'],
  J1257: ['umichDG54'], J1258: L.TR_REACH_M.src, J1259: L.TR_AREA_M2.src, J1260: L.JHOOK_CABLES.src, J1261: L.TRAY_DEPTH_MM.src, J1262: ['ufgs271000', 'umichDG272000']
};
const pct = v => Math.round(v * 100);
const dec = v => (isEn ? String(v) : String(v).replace('.', ','));
const OUTLETS = new Set(['outlet', 'outlet2']);
/** Nom d'un cheminement pour les messages. */
export const pathName = p => (p.name ? `${p.name}` : `${PATH_KINDS[p.kind].name()} ${p.id}`);
const floorName = (b, f) => (b.name ? `${b.name} · ${f.name}` : f.name);
/** Points de départ du câblage d'un étage : baies, locaux techniques, panneaux de brassage placés. */
function trPoints(data, f) {
  const out = [];
  for (const r of data.racks || []) if (r.floor === f.id && Number.isFinite(+r.x)) out.push({ floor: f.id, x: +r.x, y: +r.y, h: 2 });
  for (const r of f.rooms) if (isTechRoom(r)) { const [x, y] = roomPoint(r); out.push({ floor: f.id, x, y, h: 2 }); }
  for (const d of data.devices || []) if (d.loc && d.loc.floor === f.id && /^(patch|fibrepanel)/.test(d.type)) out.push({ floor: f.id, x: d.loc.x, y: d.loc.y, h: d.loc.h });
  return out;
}

/** data : plan propre (clean.js) ; lan : réseau simulé ; h : { name(id) }. Rend [{ code, id, text }]. */
export function issues(data, lan, h) {
  const out = [], name = id => (h && h.name ? h.name(id) : id), add = (code, id, text) => out.push({ code, id, text });
  const paths = data.paths || [], byPath = cablesByPath(data), floors = allFloors(data.site);
  // Remplissage, coudes, longueur des conduits.
  for (const p of paths) {
    const cs = byPath.get(p.id) || [], f = fillOf(p, cs), nm = pathName(p);
    if (f.ratio > f.max + 1e-9) add('J1250', p.id, isConduitKind(p.kind)
      ? tl('{0} : rempli à {1} % par {2:# câble|# câbles}, au plus {3} % pour ce nombre de câbles.', nm, pct(f.ratio), f.n, pct(f.max))
      : tl('{0} : rempli à {1} % par {2:# câble|# câbles}, au plus {3} % de sa section.', nm, pct(f.ratio), f.n, pct(f.max)));
    if (isTrayKind(p.kind) && f.depth > L.TRAY_DEPTH_MM.v) add('J1261', p.id, tl('{0} : {1} mm de câbles empilés, au plus {2} mm.', nm, Math.round(f.depth), L.TRAY_DEPTH_MM.v));
    if (p.kind === 'ceiling' && f.n > L.JHOOK_CABLES.v) add('J1260', p.id, tl('{0} : {1} câbles sur les crochets, au plus {2} par support.', nm, f.n, L.JHOOK_CABLES.v));
    if (p.kind === 'conduit') {
      const len = polyLen(p.pts), deg = bendsOf(p);
      if (len > L.CONDUIT_RUN_M.v + 1e-9) add('J1251', p.id, tl('{0} : {1} m sans boîte de tirage, au plus {2} m.', nm, dec(Math.round(len * 10) / 10), L.CONDUIT_RUN_M.v));
      else if (deg > L.CONDUIT_BEND_DEG.v + 1) add('J1251', p.id, tl('{0} : {1}° de coudes sans boîte de tirage, au plus {2}° (deux coudes à 90°).', nm, deg, L.CONDUIT_BEND_DEG.v));
      if (p.rad > 0 && p.dia) {
        const R = L.CONDUIT_RADIUS.v, need = (p.dia < R.limMm ? R.small : R.large) * p.dia;
        const cab = Math.max(0, ...cs.map(c => cableOd(c) * (c.media === 'fibre' ? L.CABLE_RADIUS.v.fibre : L.CABLE_RADIUS.v.copper)));
        if (p.rad < need) add('J1252', p.id, tl('{0} : coudes de rayon {1} mm, il en faut {2} mm ({3} × le diamètre intérieur).', nm, p.rad, Math.round(need), p.dia < R.limMm ? R.small : R.large));
        else if (p.rad < cab) add('J1252', p.id, tl('{0} : coudes de rayon {1} mm, sous le rayon de courbure de ses câbles ({2} mm).', nm, p.rad, Math.round(cab)));
      }
    }
  }
  // Séparation des cheminements de données et d'énergie (courses parallèles sur le même étage).
  const cls = (data.site && data.site.seg) || 'b', seen = new Set();
  const byFloor = new Map(); for (const p of paths) if (p.kind !== 'riser' && p.kind !== 'outdoor') { let l = byFloor.get(p.floor); if (!l) byFloor.set(p.floor, (l = [])); l.push(p); }
  for (const list of byFloor.values()) {
    const pw = list.filter(p => p.power), dt = list.filter(p => !p.power); if (!pw.length || !dt.length) continue;
    for (const d of dt) for (const e of pw) {
      const k = d.id + '|' + e.id; if (seen.has(k)) continue;
      const need = separationMm(cls, d, e); if (need <= 0) continue;
      const gap = parallelGap(d, e, 1);
      if (gap != null && gap < need) { seen.add(k); add('J1253', d.id, tl('{0} longe {1} à {2} mm (bord à bord), il faut {3} mm (EN 50174-2, classe {4}, {5:# circuit|# circuits}).', pathName(d), pathName(e), Math.max(0, Math.round(gap)), Math.round(need), cls, e.circuits || 1)); }
    }
  }
  // Colonnes montantes (courses verticales) : une colonne de données et une colonne d'énergie du même bâtiment qui
  // montent côte à côte sur au moins 1 m de hauteur commune (même gaine ou gaines voisines) ; même règle A = S × P, écart
  // horizontal bord à bord. Modèle simplifié : la dalle d'un étage sépare entièrement les cheminements horizontaux de deux
  // étages (cloison pleine), et une colonne qui croise un chemin horizontal à angle droit n'est pas une course parallèle.
  const rs = paths.filter(p => p.kind === 'riser').map(p => ({ p, v: verticalSpan(data, p) })).filter(x => x.v);
  for (const d of rs) for (const e of rs) {
    if (d.p.power || !e.p.power || d.v.b !== e.v.b) continue;
    const run = Math.min(d.v.hi, e.v.hi) - Math.max(d.v.lo, e.v.lo); if (run < 1) continue;
    const need = separationMm(cls, d.p, e.p); if (need <= 0) continue;
    const gap = Math.hypot(d.p.pts[0][0] - e.p.pts[0][0], d.p.pts[0][1] - e.p.pts[0][1]) * 1000 - ((d.p.w || 0) + (e.p.w || 0)) / 2;
    if (gap < need) add('J1253', d.p.id, tl('{0} monte à côté de {1} sur {2} m, à {3} mm (bord à bord) : il faut {4} mm (EN 50174-2, classe {5}, {6:# circuit|# circuits}).', pathName(d.p), pathName(e.p), dec(Math.round(run * 10) / 10), Math.max(0, Math.round(gap)), Math.round(need), cls, e.p.circuits || 1));
  }
  // Deux étages voisins : la dalle sépare leurs cheminements (hypothèse de modélisation : aucune source publique lue ne
  // dit qu'une dalle de béton vaut une séparation ; la seule séparation nulle de l'EN 50174-2 citée par DTECH est le
  // cheminement métallique plein). Sauf à travers une ouverture : gaine technique ou trémie (pièce d'usage « shaft ») de
  // l'un des deux étages, ou colonne montante qui les relie. Là, un cheminement de données d'un étage et un cheminement
  // d'énergie de l'autre qui passent tous deux à moins de A de l'ouverture sont comparés en 3D (écart horizontal entre les
  // tronçons, écart vertical d'après les altitudes des étages et les hauteurs des cheminements, bord à bord).
  for (const x of crossFloor(data, cls)) add('J1253', x.d.id, tl('{0} (étage {1}) passe à {2} mm de {3} (étage {4}) par {5} : il faut {6} mm (EN 50174-2, classe {7}, {8:# circuit|# circuits}).', pathName(x.d), x.fd.name, Math.max(0, Math.round(x.gap)), pathName(x.e), x.fe.name, x.via, Math.round(x.need), cls, x.e.circuits || 1));
  // Équipements hors des pièces ; étages avec prises sans local technique ; surface desservie ; prises trop loin.
  const routed = new Set(); for (const c of data.cables || []) if (c.route && c.route.mode === 'auto' && c.route.calc && !c.route.calc.fallback) { routed.add(c.a[0]); routed.add(c.b[0]); }
  for (const { b, f } of floors) {
    const devs = (data.devices || []).filter(d => d.loc && d.loc.floor === f.id), outs = devs.filter(d => OUTLETS.has(d.type));
    if (f.rooms.length) for (const d of devs) if (!roomAt(f, d.loc.x, d.loc.y)) add('J1254', d.id, tl('{0} est posé hors de toute pièce ({1}).', name(d.id), floorName(b, f)));
    const trs = trPoints(data, f), nTr = f.rooms.filter(isTechRoom).length || (trs.length ? 1 : 0);
    if (outs.length && !trs.length) add('J1257', f.id, tl('{0} : {1:# prise|# prises} mais aucun local technique ni baie à cet étage.', floorName(b, f), outs.length));
    const area = f.rooms.filter(r => !isTechRoom(r) && !isShaft(r)).reduce((s, r) => s + roomArea(r), 0);
    if (nTr && area / nTr > L.TR_AREA_M2.v) add('J1259', f.id, tl('{0} : {1} m² desservis par {2:# local technique|# locaux techniques}, au plus {3} m² chacun.', floorName(b, f), Math.round(area), nTr, L.TR_AREA_M2.v));
    // Prises pas encore câblées (ou au tracé manuel) : distance le long des cheminements jusqu'au départ le plus proche.
    const tb = trs.length ? trs : floors.filter(x => x.b === b && x.f !== f).flatMap(x => trPoints(data, x.f));
    const g = tb.length && outs.length && (data.paths || []).length ? graphOf(data) : null;
    if (g) for (const d of outs) {
      if (routed.has(d.id)) continue;
      const P = locate(data, d.id); if (!P) continue;
      let best = Infinity; for (const t of tb) best = Math.min(best, pathDistance(data, { floor: t.floor, x: t.x, y: t.y, h: t.h }, P, g).len);
      if (Number.isFinite(best) && best > L.TR_REACH_M.v) add('J1258', d.id, tl('{0} : {1} m de câble le long des cheminements jusqu’au local technique le plus proche, au plus {2} m.', name(d.id), Math.round(best), L.TR_REACH_M.v));
    }
  }
  // Câbles sans cheminement, entre étages sans colonne montante, ou trop loin d'un cheminement.
  const acc = (data.site && data.site.access) || ACCESS_M;
  for (const c of data.cables || []) {
    const k = c.route && c.route.mode === 'auto' && c.route.calc; if (!k) continue;
    const fb = k.fallback, who = tl('{0} ↔ {1}', name(c.a[0]), name(c.b[0]));
    if (!fb && k.access > acc + 1e-9) add('J1262', c.id, tl('Câble {0} : {1} m sans support entre l’équipement et le cheminement le plus proche (au plus {2} m, réglage du site).', who, dec(Math.round(k.access * 10) / 10), dec(acc)));
    if (!fb || fb === 'noloc') continue;
    if (fb === 'noriser') add('J1256', c.id, tl('Câble {0} : ses deux bouts sont sur des étages que ne relie aucune colonne montante (longueur estimée {1} m).', who, Math.round(c.len)));
    else add('J1255', c.id, tl('Câble {0} : aucun cheminement continu ne relie ses deux bouts, longueur estimée en équerre ({1} m).', who, Math.round(c.len)));
  }
  return out;
}
/** Distance entre deux segments du plan (0 s'ils se croisent). */
function segDist(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return 0;
  return Math.min(project(a, c, d).d, project(b, c, d).d, project(c, a, b).d, project(d, a, b).d);
}
/** Distance d'un segment à un polygone (0 s'il y entre). */
const segPoly = (a, b, poly) => (inPoly(a, poly) || inPoly(b, poly) ? 0 : Math.min(...poly.map((p, i) => segDist(a, b, p, poly[(i + 1) % poly.length]))));
/**
 * Couplages entre étages voisins à travers une ouverture (voir issues) : [{ d, e, fd, fe, gap, need, via }]. Modèle
 * simplifié : les tronçons qui passent à moins de A de l'ouverture comptent, sans exiger qu'ils soient parallèles.
 */
export function crossFloor(data, cls = 'b') {
  const out = [], paths = (data.paths || []).filter(p => p.kind !== 'riser' && p.kind !== 'outdoor' && p.pts.length > 1);
  const pw = paths.filter(p => p.power), dt = paths.filter(p => !p.power); if (!pw.length || !dt.length) return out;
  const risers = (data.paths || []).filter(p => p.kind === 'riser');
  for (const d of dt) for (const e of pw) {
    const A = floorOf(data.site, d.floor), B = floorOf(data.site, e.floor);
    if (!A || !B || A.b !== B.b || Math.abs(A.f.level - B.f.level) !== 1) continue;
    const need = separationMm(cls, d, e); if (need <= 0) continue;
    // Ouvertures communes aux deux étages : gaines des deux étages, colonnes qui montent de l'un à l'autre.
    const holes = [...A.f.rooms, ...B.f.rooms].filter(isShaft).map(r => ({ poly: r.poly, via: r.name || tl('une gaine technique') }));
    for (const r of risers) { const s = verticalSpan(data, r); if (s && s.b === A.b.id && s.lo <= Math.min(A.f.elev, B.f.elev) + 1e-6 && s.hi >= Math.max(A.f.elev, B.f.elev) - 1e-6) { const q = r.pts[0], h = Math.max(0.15, (r.w || 300) / 2000); holes.push({ poly: [[q[0] - h, q[1] - h], [q[0] + h, q[1] - h], [q[0] + h, q[1] + h], [q[0] - h, q[1] + h]], via: pathName(r) }); } }
    if (!holes.length) continue;
    const dz = Math.abs(A.f.elev + d.z - (B.f.elev + e.z)), reach = need / 1000;
    let best = null;
    for (const o of holes) for (let i = 1; i < d.pts.length; i++) {
      const a = d.pts[i - 1], b = d.pts[i]; if (segPoly(a, b, o.poly) > reach) continue;
      for (let j = 1; j < e.pts.length; j++) {
        const c = e.pts[j - 1], f = e.pts[j]; if (segPoly(c, f, o.poly) > reach) continue;
        const gap = Math.hypot(segDist(a, b, c, f), dz) * 1000 - ((d.w || d.dia || 0) + (e.w || e.dia || 0)) / 2;
        if (gap < need && (!best || gap < best.gap)) best = { d, e, fd: A.f, fe: B.f, gap, need, via: o.via };
      }
    }
    if (best) out.push(best);
  }
  return out;
}
/** Étendue verticale d'une colonne montante : { b (bâtiment), lo, hi (altitudes des étages extrêmes, m) } ou null. */
export function verticalSpan(data, p) {
  const A = floorOf(data.site, p.floor), B = floorOf(data.site, p.top || p.floor); if (!A || !B || A.b !== B.b) return null;
  return { b: A.b.id, lo: Math.min(A.f.elev, B.f.elev), hi: Math.max(A.f.elev, B.f.elev) };
}
/**
 * Écart (mm, bord à bord, en tenant compte des hauteurs) entre deux cheminements qui courent en parallèle (moins de 15°)
 * sur au moins minRun mètres, ou null s'ils ne se longent nulle part.
 */
export function parallelGap(p, q, minRun = 1) {
  let best = null;
  const cos15 = Math.cos(15 * Math.PI / 180);
  for (let i = 1; i < p.pts.length; i++) for (let j = 1; j < q.pts.length; j++) {
    const a = p.pts[i - 1], b = p.pts[i], c = q.pts[j - 1], d = q.pts[j];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = d[0] - c[0], vy = d[1] - c[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6 || Math.abs(ux * vx + uy * vy) / (lu * lv) < cos15) continue;
    // Recouvrement : projection de cd sur ab.
    const t0 = ((c[0] - a[0]) * ux + (c[1] - a[1]) * uy) / lu, t1 = ((d[0] - a[0]) * ux + (d[1] - a[1]) * uy) / lu;
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(lu, Math.max(t0, t1));
    if (hi - lo < minRun) continue;
    const m = (lo + hi) / 2, M = [a[0] + ux / lu * m, a[1] + uy / lu * m], dh = project(M, c, d).d, dz = Math.abs((p.z || 0) - (q.z || 0));
    const g = Math.hypot(dh, dz) * 1000 - ((p.w || p.dia || 0) + (q.w || q.dia || 0)) / 2;
    if (best == null || g < best) best = g;
  }
  return best;
}

/** Contrôles de TP : { 'net-…': { check(c, env) → { ok, … }, text(c, r) → texte de l'échec } } ; env : voir labcheck.js. */
export const LAB = {
  // { type: 'net-plan', floors?: n, rooms?: n, tr?: true, inRoom?: true } : site dessiné, sans J1254 / J1257 / J1259.
  'net-plan': {
    check(c, env) {
      const d = env.netData(), fl = allFloors(d.site);
      if (fl.length < (c.floors || 1)) return { ok: false, why: 'floors', n: fl.length };
      const nr = fl.reduce((s, x) => s + x.f.rooms.length, 0); if (nr < (c.rooms || 1)) return { ok: false, why: 'rooms', n: nr };
      const want = new Set(['J1259', ...(c.tr !== false ? ['J1257'] : []), ...(c.inRoom !== false ? ['J1254'] : [])]);
      const iss = issues(d, null, { name: id => (d.devices.find(x => x.id === id) || {}).name || id }).filter(i => want.has(i.code));
      return iss.length ? { ok: false, why: 'issues', issues: iss } : { ok: true };
    },
    text(c, r) {
      if (r.why === 'floors') return tl('Il faut au moins {0:# étage|# étages} dans la vue Plans (ici {1}).', c.floors || 1, r.n);
      if (r.why === 'rooms') return tl('Dessinez au moins {0:# pièce|# pièces} sur les plans (ici {1}).', c.rooms || 1, r.n);
      return tl('Le plan d’étage n’est pas encore correct : {0}', r.issues.slice(0, 2).map(i => `${i.code} ${i.text}`).join(' ; '));
    }
  },
  // { type: 'net-path', max?: 90, min?: 1 } : câbles au tracé automatique portés par les cheminements, chacun d'au plus max
  // mètres, sans cheminement trop rempli, trop coudé ni trop près de l'énergie.
  'net-path': {
    check(c, env) {
      const d = env.netData(), auto = d.cables.filter(k => k.route && k.route.mode === 'auto');
      if (auto.length < (c.min ?? 1)) return { ok: false, why: 'auto', n: auto.length };
      const nm = id => (d.devices.find(x => x.id === id) || {}).name || id;
      const far = auto.find(k => k.len > (c.max ?? L.TR_REACH_M.v)); if (far) return { ok: false, why: 'long', who: `${nm(far.a[0])} ↔ ${nm(far.b[0])}`, len: far.len };
      const bad = new Set(['J1250', 'J1251', 'J1252', 'J1253', 'J1255', 'J1256', 'J1260', 'J1261', 'J1262']);
      const iss = issues(d, null, { name: nm }).filter(i => bad.has(i.code));
      return iss.length ? { ok: false, why: 'issues', issues: iss } : { ok: true, n: auto.length };
    },
    text(c, r) {
      if (r.why === 'auto') return tl('Aucun câble au tracé automatique : posez les liens permanents depuis la vue Plans (outil Lien).');
      if (r.why === 'long') return tl('Le câble {0} mesure {1} m le long des cheminements, au plus {2} m.', r.who, r.len, c.max ?? L.TR_REACH_M.v);
      return tl('Les cheminements ne sont pas encore corrects : {0}', r.issues.slice(0, 2).map(i => `${i.code} ${i.text}`).join(' ; '));
    }
  }
};
