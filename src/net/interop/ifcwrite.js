// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export IFC du projet réseau (fichier STEP .ifc, schéma IFC4) : site, bâtiments, étages, pièces (IfcSpace), murs et
// portes (au choix), et le réseau : cheminements (IfcCableCarrierSegment), câbles (IfcCableSegment), équipements actifs
// et panneaux (IfcCommunicationsAppliance), prises (IfcOutlet), baies (IfcFurniture), système de données
// (IfcDistributionSystem), ports et connexions (IfcDistributionPort, IfcRelNests, IfcRelConnectsPorts), jeux de
// propriétés (Pset_ normalisés + « JOLLOF_Network »). Module pur : writeIfc(data, opts) → { text, stats }.
//
// Pourquoi IFC4 (ADD2 TC1) et pas IFC2X3 ni IFC4X3 :
//  - IFC2X3 n'a ni IfcCableCarrierSegment, ni IfcCableSegment, ni IfcCommunicationsAppliance, ni IfcOutlet, ni
//    IfcDistributionSystem (absents de IFC2X3_TC1.exp, lu) et son IfcOutletTypeEnum n'a pas DATAOUTLET (« DATAOUTLET
//    ADDED » au journal des modifications de la page IfcOutletTypeEnum d'IFC4) : un câblage n'y serait que des
//    IfcFlowSegment génériques.
//  - IFC4X3 (ISO 16739-1:2024) prolonge IFC4 vers les infrastructures (routes, rail, ports) sans rien changer d'utile
//    pour un câblage de bâtiment, et les visionneuses courantes ne le lisent pas encore toutes en entier ; IFC4 est
//    la version que les outils BIM du bâtiment échangent (vue « Reference View » d'IFC4 Add2 citée par les notes de
//    version de buildingSMART). Choix de conception : le fichier écrit IFC4 et le lecteur (ifc.js) lit IFC4 et IFC2X3.
// Sources lues (documentation IFC4 ADD2 TC1 de buildingSMART, dépôt public buildingSMART/Standards-builds, le site
// standards.buildingsmart.org refusant les lectures automatiques) : pages des entités IfcCableCarrierSegment,
// IfcCableSegment, IfcCommunicationsAppliance, IfcOutlet, IfcDistributionSystem, IfcDistributionPort,
// IfcRelConnectsPorts, IfcOwnerHistory, des énumérations IfcCommunicationsApplianceTypeEnum,
// IfcCableCarrierSegmentTypeEnum, IfcCableSegmentTypeEnum, IfcOutletTypeEnum, IfcDistributionSystemEnum, des jeux
// Pset_CableCarrierSegmentType*, Pset_CableSegmentTypeCableSegment, Pset_DistributionPortCommon, le schéma EXPRESS
// IFC4.exp (ordre des attributs), IfcGloballyUniqueId et la page « IFC GUID » (codage en base 64 sur 22 caractères),
// « String Encoding & Decoding » (step.js). Clés : src/check/sources-net.js, bloc « @interop ».
//
// Correspondances (vérifiées dans IFC4.exp : toute valeur absente de l'énumération passe en USERDEFINED + ObjectType) :
//   switch*, poeswitch → NETWORKBRIDGE (« the term layer 2 switch is very often used interchangeably with bridge ») ;
//   router, routerpro → ROUTER ; pc, laptop → COMPUTER ; printer → PRINTER ; l3switch, ap*, server, nas, patch*,
//   fibrepanel, mediaconv, camera, phone, broker, plc… → USERDEFINED (L3SWITCH, WIRELESSACCESSPOINT, SERVER,
//   PATCHPANEL…) ; outlet, outlet2 → IfcOutlet DATAOUTLET ; cheminements : tray, basket → CABLETRAYSEGMENT,
//   trunking → CABLETRUNKINGSEGMENT, conduit, outdoor → CONDUITSEGMENT, riser → CABLELADDERSEGMENT, ceiling et floor
//   → USERDEFINED ; câbles → CABLESEGMENT ; système → IfcDistributionSystem DATA (« A network having general-purpose
//   usage »). Équipements de baie sans port (cablemgr, shelf, blank, pdu, ups, fan) : non exportés.
// Géométrie simple (modèle simplifié, dit dans l'interface) : boîtes pour les équipements (taille de rack.js MOUNT
// pour ceux qui se montent en baie, sinon une boîte symbolique), pièces extrudées sur la hauteur d'étage, murs en
// rectangles extrudés, portes de 2,1 m (hauteur symbolique), cheminements en profils extrudés le long de chaque
// tronçon, câbles en tubes (IfcSweptDiskSolid) le long de leur tracé (route.js routeCable). Repère : x du plan → X,
// y du plan (vers le bas) → −Y, hauteur → Z ; mètres.
// Identifiants : IfcGloballyUniqueId tirés de nos identifiants (hachage 128 bits, sel du projet) : réexporter le même
// projet redonne les mêmes GlobalId (idempotent), deux objets différents en ont deux différents.
import { polyArea } from '../site.js';
import { locate, routeCable, PATH_KINDS, cableOd } from '../route.js';
import { MOUNT } from '../rack.js';
import { labeler, makerOf } from '../docs.js';
import { specOf } from '../devices.js';
import { CATS } from '../cable.js';
import { stepWriter, INT, E, ref, T, BOOL, DERIVED } from './step.js';
import { IFC_LIM } from '../lim/ifc.js';

export const IFC_SCHEMA = IFC_LIM.IFC_SCHEMAS.v.write;
const U_M = 0.04445; // une unité de baie (rack.js)
const DOOR_H = 2.1; // hauteur de porte symbolique (m) : modèle simplifié
const r6 = v => Math.round(v * 1e6) / 1e6;

/* ---------- Identifiants (IfcGloballyUniqueId) ---------- */
const B64 = IFC_LIM.IFC_GUID.v.alphabet;
/**
 * 16 octets → 22 caractères : le premier octet en 2 chiffres de base 64, puis cinq groupes de 3 octets en 4 chiffres
 * (24 bits = 4 × 6), alphabet de la page IfcGloballyUniqueId (« 0-9 A-Z a-z _ $ »).
 */
export function compressGuid(bytes) {
  const b = bytes, enc = (v, n) => { let s = ''; for (let i = 0; i < n; i++) { s = B64[v % 64] + s; v = Math.floor(v / 64); } return s; };
  let out = enc(b[0], 2);
  for (let i = 1; i < 16; i += 3) out += enc((b[i] << 16) | (b[i + 1] << 8) | b[i + 2], 4);
  return out;
}
/** 22 caractères → 16 octets (inverse de compressGuid) ; null si la chaîne n'est pas un GlobalId valable. */
export function expandGuid(s) {
  if (typeof s !== 'string' || s.length !== 22) return null;
  const v = [...s].map(c => B64.indexOf(c)); if (v.some(x => x < 0) || v[0] > 3) return null;
  const out = new Uint8Array(16); out[0] = v[0] * 64 + v[1];
  for (let k = 0; k < 5; k++) { const n = ((v[2 + k * 4] * 64 + v[3 + k * 4]) * 64 + v[4 + k * 4]) * 64 + v[5 + k * 4]; out[1 + k * 3] = (n >> 16) & 255; out[2 + k * 3] = (n >> 8) & 255; out[3 + k * 3] = n & 255; }
  return out;
}
/** Hachage 128 bits d'une chaîne (quatre voies FNV-1a mêlées par le mélangeur final de MurmurHash3) : 16 octets. */
export function hash128(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9, h3 = 0x85ebca6b, h4 = 0xc2b2ae35;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x01000193 + 2); h3 = Math.imul(h3 ^ c, 0x01000193 + 6); h4 = Math.imul(h4 ^ c, 0x01000193 + 10);
    h2 ^= h1 >>> 7; h3 ^= h2 >>> 11; h4 ^= h3 >>> 13;
  }
  const fmix = h => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
  h1 = fmix(h1 ^ str.length); h2 = fmix(h2 + h1); h3 = fmix(h3 + h2); h4 = fmix(h4 + h3); h1 = fmix(h1 + h4);
  const out = new Uint8Array(16);
  [h1, h2, h3, h4].forEach((h, k) => { out[k * 4] = h >>> 24; out[k * 4 + 1] = (h >>> 16) & 255; out[k * 4 + 2] = (h >>> 8) & 255; out[k * 4 + 3] = h & 255; });
  return out;
}
/** GlobalId stable d'un objet : sel du projet + clé de l'objet. */
export const ifcGuid = (salt, key) => compressGuid(hash128(salt + '\u0001' + key));
/** Sel d'un projet : son nom, celui du site et les identifiants de ses bâtiments (stables d'un export à l'autre). */
export function projectSalt(data) {
  const p = (data.design && data.design.project) || {}, site = data.site || {};
  return ['jollof', p.client || '', p.site || '', site.name || '', ...((site.buildings || []).map(b => b.id))].join('|');
}

/* ---------- Correspondance des types d'équipements ---------- */
const APPLIANCE = {
  switch: 'NETWORKBRIDGE', poeswitch: 'NETWORKBRIDGE', switch24: 'NETWORKBRIDGE', switch48: 'NETWORKBRIDGE',
  router: 'ROUTER', routerpro: 'ROUTER', pc: 'COMPUTER', laptop: 'COMPUTER', printer: 'PRINTER'
};
const USERDEF = {
  l3switch: 'L3SWITCH', ap: 'WIRELESSACCESSPOINT', ap6: 'WIRELESSACCESSPOINT', ap6e: 'WIRELESSACCESSPOINT', server: 'SERVER', nas: 'NAS',
  patch: 'PATCHPANEL', patch24: 'PATCHPANEL', patch48: 'PATCHPANEL', fibrepanel: 'FIBREPATCHPANEL', mediaconv: 'MEDIACONVERTER',
  camera: 'IPCAMERA', phone: 'IPPHONE', broker: 'MQTTBROKER', plc: 'PLC', w5500: 'ETHERNETMODULE', enc28j60: 'ETHERNETMODULE', wifi: 'WIFIMODULE'
};
const MECH = new Set(['cablemgr', 'shelf', 'blank', 'pdu', 'ups', 'fan']);
/** Classe IFC d'un type d'équipement : { cls, pt (PredefinedType), ot (ObjectType si USERDEFINED) } ou null (non exporté). */
export function devClass(type) {
  if (MECH.has(type)) return null;
  if (type === 'outlet' || type === 'outlet2') return { cls: 'IFCOUTLET', pt: 'DATAOUTLET', ot: null };
  if (APPLIANCE[type]) return { cls: 'IFCCOMMUNICATIONSAPPLIANCE', pt: APPLIANCE[type], ot: null };
  return { cls: 'IFCCOMMUNICATIONSAPPLIANCE', pt: 'USERDEFINED', ot: USERDEF[type] || String(type).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DEVICE' };
}
/** Cheminement → IfcCableCarrierSegmentTypeEnum. */
export const CARRIER = { tray: 'CABLETRAYSEGMENT', basket: 'CABLETRAYSEGMENT', trunking: 'CABLETRUNKINGSEGMENT', conduit: 'CONDUITSEGMENT', outdoor: 'CONDUITSEGMENT', riser: 'CABLELADDERSEGMENT', ceiling: 'USERDEFINED', floor: 'USERDEFINED' };
const CARRIER_OT = { ceiling: 'JHOOKROUTE', floor: 'RAISEDFLOORROUTE' };
const CARRIER_PSET = { CABLETRAYSEGMENT: 'Pset_CableCarrierSegmentTypeCableTraySegment', CABLETRUNKINGSEGMENT: 'Pset_CableCarrierSegmentTypeCableTrunkingSegment', CONDUITSEGMENT: 'Pset_CableCarrierSegmentTypeConduitSegment', CABLELADDERSEGMENT: 'Pset_CableCarrierSegmentTypeCableLadderSegment' };
/** Boîtes symboliques (largeur, profondeur, hauteur en m) des équipements qui ne se montent pas en baie : modèle simplifié. */
const BOX = { outlet: [0.08, 0.03, 0.08], outlet2: [0.08, 0.03, 0.08], ap: [0.2, 0.2, 0.045], ap6: [0.2, 0.2, 0.045], ap6e: [0.2, 0.2, 0.045], camera: [0.12, 0.12, 0.12], phone: [0.2, 0.2, 0.1], pc: [0.18, 0.4, 0.38], laptop: [0.33, 0.23, 0.02], printer: [0.42, 0.4, 0.3] };
function boxOf(d) {
  const m = MOUNT[d.type];
  if (d.rack && m) return [0.44, (m.depth || 300) / 1000, Math.max(1, m.u || 1) * U_M];
  return BOX[d.type] || (m ? [0.44, (m.depth || 300) / 1000, Math.max(1, m.u || 1) * U_M] : [0.2, 0.2, 0.2]);
}

/* ---------- VLAN et IP (pour le jeu JOLLOF_Network) ---------- */
const ipText = d => { const P = (d && d.p) || {}, x = P.ip || P.lan; if (x && x.ip) return x.prefix != null ? `${x.ip}/${x.prefix}` : x.ip; if (x && x.mode === 'dhcp') return 'DHCP'; return ''; };
/** Port d'en face d'un équipement passif (panneau f1 ↔ b1, prise front1 ↔ back1, front ↔ back). */
const passThrough = p => (/^f(\d+)$/.test(p) ? 'b' + p.slice(1) : /^b(\d+)$/.test(p) ? 'f' + p.slice(1) : /^front/.test(p) ? p.replace('front', 'back') : /^back/.test(p) ? p.replace('back', 'front') : null);

/**
 * Vues de définition (MVD) déclarées dans FILE_DESCRIPTION :
 * - 'rv' (par défaut) : « ViewDefinition [ReferenceView_V1.2] ». Le fichier n'emploie alors que des concepts de la
 *   Reference View 1.2 d'IFC4 ADD2 TC1 (documentation publiée dans buildingSMART/Standards-builds, MVD/RELEASE/IFC4/
 *   ADD2_TC1/RV1_2) : corps « Body SweptSolid PolyCurve Geometry » (IfcExtrudedAreaSolid d'un
 *   IfcArbitraryClosedProfileDef / …WithVoids dont la courbe est une IfcIndexedPolyCurve ; ni IfcRectangleProfileDef,
 *   ni IfcPolyline, ni IfcAxis2Placement2D, absents de cette vue), matériau « Material Single » (IfcMaterial seul ; pas
 *   d'IfcMaterialLayerSetUsage, absent de la vue), ouvertures (« Element Voiding »), ports, groupes. Pas de
 *   représentation « Axis » (aucun concept de la vue) ; les câbles sont des prismes extrudés tronçon par tronçon (le
 *   tube IfcSweptDiskSolid n'y est prévu que pour les armatures, IfcReinforcingElement).
 * - 'design' : « ViewDefinition [NotAssigned] » : on ajoute les axes des murs, cheminements et câbles, les couches de
 *   matériau (IfcMaterialLayerSetUsage) et les câbles en tubes (IfcSweptDiskSolid) ; ce contenu ne relève d'aucune vue
 *   publiée pour IFC4 (la Design Transfer View n'a pas de version finale dans ce dépôt) : aucune vue n'est déclarée.
 * Les deux restent valides au schéma IFC4 (vérifié par IfcOpenShell en test).
 */
export const IFC_VIEWS = { rv: `ViewDefinition [${IFC_LIM.IFC_MVD.v.rv}]`, design: `ViewDefinition [${IFC_LIM.IFC_MVD.v.design}]` };
/**
 * Écrit le fichier IFC. opts : { view ('rv' | 'design'), floors (ids d'étages à exporter, sinon tous), walls (true),
 * doors (true), network (true), cables (true : géométrie des câbles), ports (true), name (nom du fichier), time
 * (horodatage ISO, sinon maintenant), author, org, app ('Jollof Studio'), version, names: { system, project } (textes de
 * l'interface), salt } → { text, stats }.
 */
export function writeIfc(data, opts = {}) {
  const o = { view: 'rv', walls: true, doors: true, network: true, cables: true, ports: true, ...opts };
  const DESIGN = o.view === 'design', only = Array.isArray(o.floors) && o.floors.length ? new Set(o.floors) : null;
  const W = stepWriter(), salt = o.salt || projectSalt(data), G = k => ifcGuid(salt, k);
  const st = { entities: 0, buildings: 0, storeys: 0, spaces: 0, walls: 0, doors: 0, appliances: 0, outlets: 0, racks: 0, cables: 0, carriers: 0, ports: 0, connections: 0, psets: 0, unplaced: 0 };
  const site = data.site || { buildings: [] };
  const time = o.time || new Date().toISOString().replace(/\.\d+Z$/, '');
  const epoch = Math.floor(Date.parse(time.endsWith('Z') || /[+-]\d\d:\d\d$/.test(time) ? time : time + 'Z') / 1000) || 0;

  /* En-tête du modèle : auteur, application, historique, unités, contextes. */
  // IfcPerson : un des trois champs Identification, FamilyName, GivenName est exigé (règle de l'entité).
  const person = W.add('IFCPERSON', [o.author ? null : 'jollof-user', o.author || null, null, null, null, null, null, null]);
  const org = W.add('IFCORGANIZATION', [null, o.org || 'Jollof Studio', null, null, null]);
  const po = W.add('IFCPERSONANDORGANIZATION', [ref(person), ref(org), null]);
  const appOrg = W.add('IFCORGANIZATION', [null, 'Xelaktech', null, null, null]);
  const app = W.add('IFCAPPLICATION', [ref(appOrg), o.version || '1.0', o.app || 'Jollof Studio', 'JollofStudio']);
  const OH = ref(W.add('IFCOWNERHISTORY', [ref(po), ref(app), null, E('NOTDEFINED'), null, null, null, INT(epoch)]));
  const units = [
    W.add('IFCSIUNIT', [DERIVEDV(), E('LENGTHUNIT'), null, E('METRE')]),
    W.add('IFCSIUNIT', [DERIVEDV(), E('AREAUNIT'), null, E('SQUARE_METRE')]),
    W.add('IFCSIUNIT', [DERIVEDV(), E('VOLUMEUNIT'), null, E('CUBIC_METRE')]),
    W.add('IFCSIUNIT', [DERIVEDV(), E('PLANEANGLEUNIT'), null, E('RADIAN')]),
    W.add('IFCSIUNIT', [DERIVEDV(), E('MASSUNIT'), E('KILO'), E('GRAM')]),
    W.add('IFCSIUNIT', [DERIVEDV(), E('POWERUNIT'), null, E('WATT')])
  ];
  const ua = W.add('IFCUNITASSIGNMENT', [units.map(ref)]);
  // Points et directions communs, gardés une fois.
  const pts = new Map(), dirs = new Map();
  const P3 = (x, y, z) => { const k = `${r6(x)},${r6(y)},${r6(z)}`; let id = pts.get(k); if (!id) pts.set(k, id = W.add('IFCCARTESIANPOINT', [[r6(x), r6(y), r6(z)]])); return ref(id); };
  const D3 = (x, y, z) => { const n = Math.hypot(x, y, z) || 1, k = `${r6(x / n)},${r6(y / n)},${r6(z / n)}`; let id = dirs.get(k); if (!id) dirs.set(k, id = W.add('IFCDIRECTION', [[r6(x / n), r6(y / n), r6(z / n)]])); return ref(id); };
  const D2 = (x, y) => { const n = Math.hypot(x, y) || 1, k = `${r6(x / n)},${r6(y / n)}`; let id = dirs.get(k); if (!id) dirs.set(k, id = W.add('IFCDIRECTION', [[r6(x / n), r6(y / n)]])); return ref(id); };
  const A3 = (x = 0, y = 0, z = 0, ax = null, rx = null) => ref(W.add('IFCAXIS2PLACEMENT3D', [P3(x, y, z), ax ? D3(...ax) : null, rx ? D3(...rx) : null]));
  const LP = (rel, x = 0, y = 0, z = 0, ax = null, rx = null) => ref(W.add('IFCLOCALPLACEMENT', [rel || null, A3(x, y, z, ax, rx)]));
  const ctx = W.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [null, 'Model', INT(3), 1e-5, A3(), D2(0, 1)]);
  const body = ref(W.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', ['Body', 'Model', DERIVEDV(), DERIVEDV(), DERIVEDV(), DERIVEDV(), ref(ctx), null, E('MODEL_VIEW'), null]));
  const axisCtx = DESIGN ? ref(W.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', ['Axis', 'Model', DERIVEDV(), DERIVEDV(), DERIVEDV(), DERIVEDV(), ref(ctx), null, E('GRAPH_VIEW'), null])) : null;
  const shape = reps => ref(W.add('IFCPRODUCTDEFINITIONSHAPE', [null, null, reps.map(ref)]));
  const rep = (c, ident, type, items) => W.add('IFCSHAPEREPRESENTATION', [c, ident, type, items.map(x => (typeof x === 'object' ? x : ref(x)))]);
  // Courbes : IfcIndexedPolyCurve (fermée : dernier index = premier), sur une liste de points 2D ou 3D.
  const curve2 = (ring, close = true) => { const l = W.add('IFCCARTESIANPOINTLIST2D', [ring.map(q => [r6(q[0]), r6(q[1])])]); const ix = ring.map((_, i) => INT(i + 1)); return ref(W.add('IFCINDEXEDPOLYCURVE', [ref(l), close ? [T('IFCLINEINDEX', [...ix, INT(1)])] : null, E('F')])); };
  const curve3 = pts3 => ref(W.add('IFCINDEXEDPOLYCURVE', [ref(W.add('IFCCARTESIANPOINTLIST3D', [pts3.map(q => q.map(r6))])), null, E('F')]));
  /** Profil quelconque : contour (et trous), en coordonnées du profil. */
  const profile = (ring, holes = []) => (holes.length ? ref(W.add('IFCARBITRARYPROFILEDEFWITHVOIDS', [E('AREA'), null, curve2(ring), holes.map(h => curve2(h))])) : ref(W.add('IFCARBITRARYCLOSEDPROFILEDEF', [E('AREA'), null, curve2(ring)])));
  /** Rectangle w × d centré sur (cx, cy), écrit comme un profil quelconque (la Reference View n'a pas IfcRectangleProfileDef). */
  const rect = (w, d, cx = 0, cy = 0) => { const a = Math.max(1e-3, w) / 2, b = Math.max(1e-3, d) / 2; return profile([[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy + b], [cx - a, cy + b]]); };
  /** Polygone régulier de rayon r (conduits, câbles) : modèle simplifié du cercle. */
  const ngon = (r, n = 12) => profile(Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]));
  const extrude = (profile, pos, depth, dir = [0, 0, 1]) => W.add('IFCEXTRUDEDAREASOLID', [profile, pos || A3(), D3(...dir), Math.max(1e-3, depth)]);
  /** Boîte (largeur w en X, profondeur d en Y, hauteur h), centrée en X et Y sur l'origine, posée sur z0. */
  const boxShape = (w, d, h, z0 = 0) => shape([rep(body, 'Body', 'SweptSolid', [extrude(rect(w, d), A3(0, 0, z0), h)])]);

  const project = W.add('IFCPROJECT', [G('project'), OH, (o.names && o.names.project) || site.name || 'Jollof Studio', null, null, null, null, [ref(ctx)], ref(ua)]);
  const sitePl = LP(null);
  const siteId = W.add('IFCSITE', [G('site'), OH, site.name || 'Site', null, null, sitePl, null, null, E('ELEMENT'), null, null, null, null, null]);
  rel('IFCRELAGGREGATES', 'agg:project', [ref(project), [ref(siteId)]]);
  function rel(type, key, args) { return W.add(type, [G(key), OH, null, null, ...args]); }

  /* Bâtiments et étages. */
  const floorInfo = new Map(); // id d'étage → { pl, storey, elev, height, b, contained: [] }
  const bIds = [], bInfo = new Map();
  for (const b of site.buildings || []) {
    if (only && !(b.floors || []).some(f => only.has(f.id))) continue;
    const pl = LP(sitePl, +b.x || 0, -(+b.y || 0), 0);
    const bid = W.add('IFCBUILDING', [G('b:' + b.id), OH, b.name || b.id, null, null, pl, null, null, E('ELEMENT'), null, null, null]);
    bIds.push(bid); bInfo.set(b.id, { pl, bid, contained: [] }); st.buildings++;
    const sids = [];
    for (const f of b.floors || []) {
      if (only && !only.has(f.id)) continue;
      const fpl = LP(pl, 0, 0, +f.elev || 0);
      const sid = W.add('IFCBUILDINGSTOREY', [G('f:' + f.id), OH, f.name || f.id, null, null, fpl, null, null, E('ELEMENT'), +f.elev || 0]);
      sids.push(sid); st.storeys++;
      floorInfo.set(f.id, { pl: fpl, sid, elev: +f.elev || 0, height: +f.height || 3, b, f, contained: [], spaces: [] });
    }
    if (sids.length) rel('IFCRELAGGREGATES', 'agg:b:' + b.id, [ref(bid), sids.map(ref)]);
  }
  if (bIds.length) rel('IFCRELAGGREGATES', 'agg:site', [ref(siteId), bIds.map(ref)]);

  /* Jeux de propriétés : un IfcPropertySet par objet et par jeu, relié par IfcRelDefinesByProperties. */
  function pset(objKey, objId, name, props) {
    const list = props.filter(([, v]) => v != null && v !== '' && !(typeof v.v === 'number' && !Number.isFinite(v.v)) && !(v.v === '' || v.v == null));
    if (!list.length) return;
    const ps = W.add('IFCPROPERTYSET', [G('ps:' + objKey + ':' + name), OH, name, null, list.map(([k, v]) => ref(W.add('IFCPROPERTYSINGLEVALUE', [k, null, v, null])))]);
    rel('IFCRELDEFINESBYPROPERTIES', 'dp:' + objKey + ':' + name, [[ref(objId)], ref(ps)]);
    st.psets++;
  }
  const LBL = v => (v == null || v === '' ? null : T('IFCLABEL', String(v).slice(0, 255)));
  const LEN = v => (Number.isFinite(+v) && +v > 0 ? T('IFCPOSITIVELENGTHMEASURE', r6(+v)) : null);

  /* Pièces : contour extrudé sur la hauteur d'étage (trous : IfcArbitraryProfileDefWithVoids). */
  const flip = poly => poly.map(q => [q[0], -q[1]]);
  for (const [fid, F] of floorInfo) {
    for (const r of F.f.rooms || []) {
      if (!r.poly || r.poly.length < 3 || polyArea(r.poly) < 0.05) continue;
      const prof = profile(flip(r.poly), (r.holes || []).map(flip));
      const sp = W.add('IFCSPACE', [G('r:' + r.id), OH, r.name || r.id, null, null, LP(F.pl), shape([rep(body, 'Body', 'SweptSolid', [extrude(prof, A3(), F.height)])]), r.name || r.id, E('ELEMENT'), E('INTERNAL'), null]);
      F.spaces.push(sp); st.spaces++;
      pset('r:' + r.id, sp, 'JOLLOF_Network', [['Usage', LBL(r.usage)], ['Id', T('IFCIDENTIFIER', r.id)]]);
    }
    if (F.spaces.length) rel('IFCRELAGGREGATES', 'agg:f:' + fid, [ref(F.sid), F.spaces.map(ref)]);
  }

  /* Murs (et portes) : axe, corps, couche de matériau. */
  if (o.walls) {
    const MAT = { concrete: 'Concrete', brick: 'Brick', block: 'Concrete block', stone: 'Stone', drywall: 'Gypsum board partition', plaster: 'Plaster tile', glass: 'Glass', wood: 'Wood', metal: 'Metal', elevator: 'Reinforced concrete' };
    const usage = new Map(), mats = new Map(); // (matériau | épaisseur en conception) → { lsu, walls: [] }
    for (const [, F] of floorInfo) {
      for (const w of F.f.walls || []) {
        const dx = w.b[0] - w.a[0], dy = -(w.b[1] - w.a[1]), L = Math.hypot(dx, dy); if (L < 1e-3) continue;
        const t = +w.t || 0.2, pl = LP(F.pl, w.a[0], -w.a[1], 0, [0, 0, 1], [dx, dy, 0]);
        const bd = rep(body, 'Body', 'SweptSolid', [extrude(rect(L, t, L / 2, 0), A3(), F.height)]);
        const reps = DESIGN ? [rep(axisCtx, 'Axis', 'Curve2D', [curve2([[0, 0], [L, 0]], false)]), bd] : [bd];
        const wid = W.add('IFCWALL', [G('w:' + w.id), OH, w.name || w.id, null, null, pl, shape(reps), null, E('STANDARD')]);
        F.contained.push(wid); st.walls++;
        const k = (w.mat || 'block') + (DESIGN ? '|' + t : '');
        let u = usage.get(k);
        if (!u) {
          // Reference View : le matériau seul (« Material Single ») ; conception : sa couche (épaisseur, côté de l'axe).
          let m = mats.get(w.mat || 'block'); if (!m) mats.set(w.mat || 'block', m = W.add('IFCMATERIAL', [MAT[w.mat] || 'Concrete block', null, null]));
          if (DESIGN) {
            const ly = W.add('IFCMATERIALLAYER', [ref(m), t, null, null, null, null, null]);
            const ls = W.add('IFCMATERIALLAYERSET', [[ref(ly)], `${MAT[w.mat] || 'Wall'} ${Math.round(t * 1000)} mm`, null]);
            u = { lsu: W.add('IFCMATERIALLAYERSETUSAGE', [ref(ls), E('AXIS2'), E('POSITIVE'), -t / 2, null]), walls: [] };
          } else u = { lsu: m, walls: [] };
          usage.set(k, u);
        }
        u.walls.push(wid);
        pset('w:' + w.id, wid, 'JOLLOF_Network', [['Material', LBL(w.mat)]]);
        if (o.doors) for (const d of (F.f.doors || []).filter(x => x.wall === w.id)) {
          const dw = +d.w || 0.9, x0 = Math.max(0, (+d.at || 0) - dw / 2);
          const opl = LP(pl, x0, 0, 0);
          const op = W.add('IFCOPENINGELEMENT', [G('op:' + d.id), OH, 'Opening ' + (d.name || d.id), null, null, opl, shape([rep(body, 'Body', 'SweptSolid', [extrude(rect(dw, t + 0.02, dw / 2, 0), A3(), DOOR_H)])]), null, E('OPENING')]);
          rel('IFCRELVOIDSELEMENT', 'void:' + d.id, [ref(wid), ref(op)]);
          const door = W.add('IFCDOOR', [G('d:' + d.id), OH, d.name || d.id, null, null, LP(opl), shape([rep(body, 'Body', 'SweptSolid', [extrude(rect(dw, 0.05, dw / 2, 0), A3(), DOOR_H)])]), null, DOOR_H, dw, E('DOOR'), null, null]);
          rel('IFCRELFILLSELEMENT', 'fill:' + d.id, [ref(op), ref(door)]);
          F.contained.push(door); st.doors++;
        }
      }
    }
    let i = 0;
    for (const [k, u] of usage) rel('IFCRELASSOCIATESMATERIAL', 'mat:' + k + ':' + i++, [u.walls.map(ref), ref(u.lsu)]);
  }

  /* Réseau. */
  if (o.network) {
    const L = labeler(data), devs = new Map((data.devices || []).map(d => [d.id, d])), sys = [];
    const unplaced = [];
    const devEnt = new Map(), portEnt = new Map(); // devId → entité ; devId|port → port
    // VLAN d'un équipement : celui du port de switch atteint par ses câbles (en traversant prises et panneaux).
    const byEnd = new Map(); for (const c of data.cables || []) { byEnd.set(c.a.join('|'), c); byEnd.set(c.b.join('|'), c); }
    const vlanAt = (dev, port, depth = 0) => {
      const c = byEnd.get(dev + '|' + port); if (!c || depth > 6) return null;
      const [n, p] = c.a[0] === dev && c.a[1] === port ? c.b : c.a, D = devs.get(n); if (!D) return null;
      const pp = D.p && D.p.ports && D.p.ports[p]; if (pp && typeof pp === 'object' && (pp.vlan ?? pp.pvid ?? pp.access) != null) return pp.vlan ?? pp.pvid ?? pp.access;
      const s = specOf(D); if (s && s.role === 'passive') { const q = passThrough(p); return q ? vlanAt(n, q, depth + 1) : null; }
      return null;
    };
    const vlansOf = d => {
      const out = new Set(), P = d.p || {};
      if (P.ports && typeof P.ports === 'object') for (const v of Object.values(P.ports)) if (v && typeof v === 'object') { const x = v.vlan ?? v.pvid ?? v.access; if (x != null && x !== '') out.add(String(x)); }
      if (!out.size) for (const c of data.cables || []) for (const e of [c.a, c.b]) if (e[0] === d.id) { const v = vlanAt(d.id, e[1]); if (v != null) out.add(String(v)); }
      return [...out].sort((a, b) => +a - +b);
    };
    const rackName = id => { const r = (data.racks || []).find(x => x.id === id); return r ? r.name || r.id : id; };
    const rackRot = id => { const r = (data.racks || []).find(x => x.id === id); return r ? +r.rot || 0 : 0; };
    for (const d of data.devices || []) {
      const k = devClass(d.type); if (!k) continue;
      const at = locate(data, d.id), F = at ? floorInfo.get(at.floor) : null;
      if (only && at && !F) continue; // sur un étage non exporté
      let pl = null, sh = null;
      if (F) {
        const a = -(at.rack ? rackRot(at.rack) : 0) * Math.PI / 180, [w, dd, h] = boxOf(d);
        pl = LP(F.pl, at.x, -at.y, at.h, [0, 0, 1], [Math.cos(a), Math.sin(a), 0]);
        sh = boxShape(w, dd, h, d.rack ? -U_M / 2 : -h / 2);
      }
      const name = L.of(d.id) || d.name || d.id;
      const id = W.add(k.cls, [G('dev:' + d.id), OH, d.name || d.id, null, k.ot, pl, sh, name, E(k.pt)]);
      devEnt.set(d.id, id); sys.push(id);
      if (k.cls === 'IFCOUTLET') st.outlets++; else st.appliances++;
      if (F) F.contained.push(id); else unplaced.push(id);
      const mk = makerOf(d.type), m = MOUNT[d.type];
      pset('dev:' + d.id, id, 'JOLLOF_Network', [
        ['Label', LBL(name)], ['Type', LBL(d.type)], ['VLAN', LBL(vlansOf(d).join(','))], ['IP', LBL(ipText(d))],
        ['Rack', LBL(d.rack ? rackName(d.rack.id) : '')], ['U', d.rack ? T('IFCINTEGER', INT(d.rack.u)) : null], ['Id', T('IFCIDENTIFIER', d.id)]
      ]);
      if (mk.maker || mk.part) pset('dev:' + d.id, id, 'Pset_ManufacturerTypeInformation', [['Manufacturer', LBL(mk.maker)], ['ModelLabel', LBL(mk.part)]]);
      if (m && m.typ) pset('dev:' + d.id, id, 'JOLLOF_Power', [['TypicalPower', T('IFCPOWERMEASURE', m.typ)], ['MaximumPower', m.max ? T('IFCPOWERMEASURE', m.max) : null]]);
    }
    // Baies : meuble USERDEFINED « NETWORKRACK », boîte de la taille de la baie.
    for (const r of data.racks || []) {
      const F = floorInfo.get(r.floor);
      if (only && !F) continue;
      let pl = null, sh = null;
      if (F) {
        const a = -(+r.rot || 0) * Math.PI / 180, base = r.kind === 'wall' ? (Number.isFinite(+r.z) ? +r.z : 1.2) : 0;
        pl = LP(F.pl, +r.x || 0, -(+r.y || 0), base, [0, 0, 1], [Math.cos(a), Math.sin(a), 0]);
        sh = boxShape((+r.w || 600) / 1000, (+r.d || 600) / 1000, (+r.u || 42) * U_M + (r.kind === 'wall' ? 0.1 : 0.2));
      }
      const id = W.add('IFCFURNITURE', [G('rk:' + r.id), OH, r.name || r.id, null, 'NETWORKRACK', pl, sh, L.rack ? L.rack(r.id) || null : null, E('USERDEFINED')]);
      st.racks++;
      if (F) F.contained.push(id); else unplaced.push(id);
      pset('rk:' + r.id, id, 'JOLLOF_Network', [['Kind', LBL(r.kind)], ['RackUnits', T('IFCINTEGER', INT(r.u || 42))], ['Id', T('IFCIDENTIFIER', r.id)]]);
    }
    // Ports des équipements câblés (IfcDistributionPort, imbriqués par IfcRelNests).
    const devPorts = new Map(); // devId → [ports]
    if (o.ports) {
      for (const c of data.cables || []) for (const e of [c.a, c.b]) {
        if (!devEnt.has(e[0]) || portEnt.has(e.join('|'))) continue;
        const pid = W.add('IFCDISTRIBUTIONPORT', [G('port:' + e[0] + ':' + e[1]), OH, e[1], null, null, null, null, E('SOURCEANDSINK'), E('CABLE'), E('DATA')]);
        portEnt.set(e.join('|'), pid); st.ports++;
        let l = devPorts.get(e[0]); if (!l) devPorts.set(e[0], l = []); l.push([e[1], pid]);
      }
      for (const [dev, l] of devPorts) {
        const D = devs.get(dev), order = specOf(D) ? specOf(D).ports(D.p || {}).map(p => p.id) : [];
        l.sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
        rel('IFCRELNESTS', 'nest:' + dev, [ref(devEnt.get(dev)), l.map(x => ref(x[1]))]);
        l.forEach(([p, pid]) => { const n = order.indexOf(p); if (n >= 0) pset('port:' + dev + ':' + p, pid, 'Pset_DistributionPortCommon', [['PortNumber', T('IFCINTEGER', INT(n + 1))]]); });
      }
    }
    // Cheminements.
    const pathZ = new Map((data.paths || []).map(p => [p.id, Number.isFinite(+p.z) ? +p.z : (PATH_KINDS[p.kind] || {}).z || 2.7]));
    for (const p of data.paths || []) {
      const F = floorInfo.get(p.floor); if (!F) continue;
      const K = PATH_KINDS[p.kind] || {}, pt = CARRIER[p.kind] || 'NOTDEFINED', z = pathZ.get(p.id);
      const dia = (+p.dia || K.dia || 0) / 1000, w = (+p.w || K.w || (dia ? 0 : 100)) / 1000, h = (+p.h || K.h || (dia ? 0 : 50)) / 1000;
      const prof = dia ? ngon(dia / 2) : rect(h || 0.05, w || 0.1);
      const items = [], reps = [];
      let axisPts = null;
      if (p.kind === 'riser') {
        const top = floorInfo.get(p.top), H = top ? Math.max(0.1, top.elev + top.height - F.elev) : F.height;
        const q = p.pts[0]; items.push(extrude(dia ? prof : rect(w || 0.3, h || 0.1), A3(q[0], -q[1], 0), H));
        axisPts = [[q[0], -q[1], 0], [q[0], -q[1], H]];
      } else {
        const pp = p.kind === 'outdoor' && p.to && floorInfo.get(p.to) && floorInfo.get(p.to).b !== F.b ? [] : p.pts;
        const zc = dia ? z : z + h / 2;
        for (let i = 1; i < pp.length; i++) {
          const a = pp[i - 1], b = pp[i], dx = b[0] - a[0], dy = -(b[1] - a[1]), Lg = Math.hypot(dx, dy); if (Lg < 1e-3) continue;
          items.push(extrude(prof, A3(a[0], -a[1], zc, [dx, dy, 0], [0, 0, 1]), Lg));
        }
        if (pp.length >= 2) axisPts = pp.map(q => [q[0], -q[1], zc]);
      }
      if (axisPts && DESIGN) reps.push(rep(axisCtx, 'Axis', 'Curve3D', [curve3(axisPts)]));
      if (items.length) reps.push(rep(body, 'Body', 'SweptSolid', items));
      const id = W.add('IFCCABLECARRIERSEGMENT', [G('pa:' + p.id), OH, p.name || p.id, null, CARRIER_OT[p.kind] || null, LP(F.pl), reps.length ? shape(reps) : null, null, E(pt)]);
      F.contained.push(id); st.carriers++;
      if (CARRIER_PSET[pt]) pset('pa:' + p.id, id, CARRIER_PSET[pt], [['NominalWidth', LEN(dia || w)], ['NominalHeight', LEN(dia || h)]]);
      pset('pa:' + p.id, id, 'JOLLOF_Network', [['Kind', LBL(p.kind)], ['Power', p.power ? T('IFCBOOLEAN', BOOL(true)) : null], ['Id', T('IFCIDENTIFIER', p.id)]]);
    }
    // Câbles : tube le long du tracé (cheminements à leur hauteur, descentes aux deux bouts).
    for (const c of data.cables || []) {
      const A = locate(data, c.a[0]), FA = A ? floorInfo.get(A.floor) : null;
      if (only && !(devEnt.has(c.a[0]) && devEnt.has(c.b[0])) && !FA) continue; // aucun bout exporté
      let pl = null, sh = null;
      if (FA) {
        let r = null; try { r = routeCable(data, c, true); } catch (e) { r = null; }
        const B = locate(data, c.b[0]);
        const usedZ = r && r.calc && r.calc.paths && r.calc.paths.length ? r.calc.paths.map(id => pathZ.get(id)).filter(Number.isFinite) : [];
        const zr = usedZ.length ? usedZ.reduce((s, v) => s + v, 0) / usedZ.length : 2.7;
        const seq = [];
        const add = (floor, x, y, z) => { const F = floorInfo.get(floor); if (!F) return; const ox = (+F.b.x || 0) - (+FA.b.x || 0), oy = (+F.b.y || 0) - (+FA.b.y || 0); seq.push([x + ox, -(y + oy), F.elev - FA.elev + z]); };
        if (r && r.legs && r.legs.length) {
          const legs = r.legs, first = legs[0].pts[0], lastLeg = legs[legs.length - 1], last = lastLeg.pts[lastLeg.pts.length - 1];
          const startH = A.floor === legs[0].floor && Math.hypot(first[0] - A.x, first[1] - A.y) < 1e-6 ? A.h : zr;
          for (const [li, l] of legs.entries()) l.pts.forEach((q, qi) => {
            const isStart = li === 0 && qi === 0, isEnd = li === legs.length - 1 && qi === l.pts.length - 1;
            if (isStart) { add(l.floor, q[0], q[1], startH); if (l.pts.length > 1 || legs.length > 1) add(l.floor, q[0], q[1], zr); return; }
            if (isEnd) { add(l.floor, q[0], q[1], zr); add(l.floor, q[0], q[1], B && Math.hypot(last[0] - B.x, last[1] - B.y) < 1e-6 ? B.h : zr); return; }
            add(l.floor, q[0], q[1], zr);
          });
        } else if (B) { add(A.floor, A.x, A.y, A.h); add(B.floor, B.x, B.y, B.h); }
        const clean = simplify3(seq);
        if (clean.length >= 2) {
          pl = LP(FA.pl);
          const rad = Math.max(0.001, cableOd(c) / 2000), reps = [];
          if (DESIGN) {
            const line = curve3(clean);
            reps.push(rep(axisCtx, 'Axis', 'Curve3D', [line]));
            if (o.cables) reps.push(rep(body, 'Body', 'AdvancedSweptSolid', [W.add('IFCSWEPTDISKSOLID', [line, rad, null, null, null])]));
          } else if (o.cables) {
            // Reference View : un prisme octogonal extrudé le long de chaque tronçon (modèle simplifié du câble).
            const oct = ngon(rad, 8), items = [];
            for (let i = 1; i < clean.length; i++) {
              const a = clean[i - 1], b = clean[i], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], Lg = Math.hypot(...d); if (Lg < 1e-4) continue;
              items.push(extrude(oct, A3(a[0], a[1], a[2], d, Math.abs(d[2]) / Lg > 0.9 ? [1, 0, 0] : [0, 0, 1]), Lg));
            }
            if (items.length) reps.push(rep(body, 'Body', 'SweptSolid', items));
          }
          sh = reps.length ? shape(reps) : null;
        }
      }
      const label = L.cable(c);
      const id = W.add('IFCCABLESEGMENT', [G('c:' + c.id), OH, label || c.id, null, null, pl, sh, label || null, E('CABLESEGMENT')]);
      st.cables++; sys.push(id);
      if (FA) FA.contained.push(id); else unplaced.push(id);
      const fib = c.media === 'fibre', cat = fib ? String(c.fibre || '').toUpperCase() : (CATS[c.cat] || {}).name || c.cat;
      const ends = [c.a, c.b].map(e => { const D = devs.get(e[0]); return (D ? L.of(D.id) || D.name : e[0]) + ':' + e[1]; });
      pset('c:' + c.id, id, 'JOLLOF_Network', [['Label', LBL(label)], ['Category', LBL(cat)], ['Media', LBL(fib ? 'fibre' : 'copper')], ['Length', T('IFCLENGTHMEASURE', r6(+c.len || 0))], ['From', LBL(ends[0])], ['To', LBL(ends[1])], ['Id', T('IFCIDENTIFIER', c.id)]]);
      pset('c:' + c.id, id, 'Pset_CableSegmentTypeCableSegment', [['OverallDiameter', LEN(cableOd(c) / 1000)]]);
      // Ports du câble (Input, Output, d'après la page IfcCableSegment) reliés à ceux des équipements.
      if (o.ports && devEnt.has(c.a[0]) && devEnt.has(c.b[0])) {
        const pin = W.add('IFCDISTRIBUTIONPORT', [G('cport:' + c.id + ':a'), OH, 'Input', null, null, null, null, E('SINK'), E('CABLE'), E('DATA')]);
        const pout = W.add('IFCDISTRIBUTIONPORT', [G('cport:' + c.id + ':b'), OH, 'Output', null, null, null, null, E('SOURCE'), E('CABLE'), E('DATA')]);
        st.ports += 2;
        rel('IFCRELNESTS', 'nest:c:' + c.id, [ref(id), [ref(pin), ref(pout)]]);
        rel('IFCRELCONNECTSPORTS', 'conn:' + c.id + ':a', [ref(pin), ref(portEnt.get(c.a.join('|'))), null]);
        rel('IFCRELCONNECTSPORTS', 'conn:' + c.id + ':b', [ref(pout), ref(portEnt.get(c.b.join('|'))), null]);
        st.connections += 2;
      }
    }
    // Système de données : équipements, prises et câbles ; il dessert les bâtiments.
    if (sys.length) {
      const sid = W.add('IFCDISTRIBUTIONSYSTEM', [G('system:data'), OH, (o.names && o.names.system) || 'Data network', null, null, null, E('DATA')]);
      rel('IFCRELASSIGNSTOGROUP', 'grp:data', [sys.map(ref), null, ref(sid)]);
      if (bIds.length) rel('IFCRELSERVICESBUILDINGS', 'serv:data', [ref(sid), bIds.map(ref)]);
    }
    // Objets sans place : rangés dans le premier bâtiment (sans géométrie).
    st.unplaced = unplaced.length;
    if (unplaced.length) {
      const b0 = [...bInfo.values()][0];
      if (b0) b0.contained.push(...unplaced);
      else rel('IFCRELCONTAINEDINSPATIALSTRUCTURE', 'in:site', [unplaced.map(ref), ref(siteId)]);
    }
  }

  /* Contenu de chaque étage et bâtiment. */
  for (const [fid, F] of floorInfo) if (F.contained.length) rel('IFCRELCONTAINEDINSPATIALSTRUCTURE', 'in:f:' + fid, [F.contained.map(ref), ref(F.sid)]);
  for (const [bid, B] of bInfo) if (B.contained.length) rel('IFCRELCONTAINEDINSPATIALSTRUCTURE', 'in:b:' + bid, [B.contained.map(ref), ref(B.bid)]);

  st.entities = W.count;
  const text = W.text({
    description: [IFC_VIEWS[DESIGN ? 'design' : 'rv'], 'Jollof Studio network design export'], name: o.name || 'reseau.ifc', time,
    author: o.author || '', org: o.org || '', preprocessor: 'Jollof Studio IFC writer', system: o.app || 'Jollof Studio', authorization: '', schema: IFC_SCHEMA
  });
  return { text, stats: st };
}
/**
 * Polyligne 3D sans points doubles, ni points alignés, ni pointes en demi-tour (au-delà d'environ 154°) (un aller-retour sur la même droite, artefact du tracé le long du
 * graphe des cheminements, empêcherait de construire le tube d'un IfcSweptDiskSolid).
 */
export function simplify3(seq) {
  const out = [];
  for (const q of seq) {
    if (out.length && Math.hypot(q[0] - out[out.length - 1][0], q[1] - out[out.length - 1][1], q[2] - out[out.length - 1][2]) <= 1e-4) continue;
    out.push(q);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const cr = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      const nn = Math.max(1e-9, Math.hypot(...u) * Math.hypot(...v)), dt = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      if (cr > 1e-6 * nn && dt > -0.9 * nn) break; // ni aligné, ni demi-tour en pointe
      out.splice(out.length - 2, 1);
      if (out.length >= 2 && Math.hypot(...[0, 1, 2].map(k => out[out.length - 1][k] - out[out.length - 2][k])) <= 1e-4) out.pop();
    }
  }
  return out;
}
/** « * » : attribut dérivé redéclaré (IfcSIUnit.Dimensions, attributs hérités d'un sous-contexte). */
function DERIVEDV() { return DERIVED; }
