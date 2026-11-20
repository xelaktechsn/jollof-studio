// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du plan réseau (partie cert), fusionnées par src/net/issues.js (codes J12xx) et contrôles de TP
// fusionnés par src/net/labcheck.js.
//   J1286 lien qui échoue à la certification simulée (calculée en direct depuis le plan : chaque lien permanent à la limite
//         de sa catégorie, ou à celle de son dernier test ; un canal seulement s'il a été testé) · J1287 réussite marginale
//         (PASS*) en diaphonie ou en réflexion · J1288 rapport de tests périmé (le plan a changé depuis le test) · J1289
//         liens permanents jamais certifiés alors que le projet a un plan de bâtiment.
// Pas de doublon : un lien dont la carte de câblage est fausse est déjà signalé (J1201, J1202) ; une réussite marginale de
// l'affaiblissement ne fait que redire « longueur proche du maximum » (J1204). J1288 et J1289 sont groupés (un seul
// message pour tout le plan) pour ne pas noyer le panneau Problèmes.
import { tl } from '../../i18n/index.js';
import { certLinks, certify, certifyCached, defaultLimit, linkLabel, testState, paramName, verdictText, limitInfo, fmtNum } from '../certify.js';

/** Niveau de chaque code : 'error' | 'warning'. */
export const CODES = { J1286: 'error', J1287: 'warning', J1288: 'warning', J1289: 'warning' };
const MODEL = ['anixterTia568c2', 'ieee8023anD22', 'diminico10gbtTables', 'tsb155D13', 'adriaenssensChannelIL', 'commscopeCat6aWp'];
/** Sources de chaque code (clés de src/check/sources.js). */
export const SRC = {
  J1286: [...MODEL, 'flukeMarginalPasses', 'flukePropDelayCase8'],
  J1287: ['flukeMarginalBand', 'flukeMarginalPasses', 'flukeTop10Mistakes'],
  J1288: ['flukeTop10Mistakes', 'flukeMarginalPasses'],
  J1289: ['flukeTop10Mistakes']
};
const UNIT = { length: 'm', delay: 'ns', skew: 'ns' };
const num = v => fmtNum(v, 1);
const XT = new Set(['next', 'psnext', 'acrf', 'psacrf', 'rl']);
/** Le projet a-t-il un plan de bâtiment (au moins un étage) ? */
const hasSite = data => !!(data && data.site && Array.isArray(data.site.buildings) && data.site.buildings.some(b => b && Array.isArray(b.floors) && b.floors.length));
/** Texte du point faible d'un résultat : « NEXT 36-45, marge −8,2 dB ». */
export function weakText(r) {
  const p = r.params && r.params[r.param];
  if (r.param === 'wiremap') return paramName('wiremap');
  const m = r.param === 'length' || r.param === 'delay' || r.param === 'skew' ? (p ? p.margin : r.margin) : r.margin;
  return tl('{0}{1}, marge {2} {3}', paramName(r.param), r.pair ? ' ' + r.pair : '', num(m), UNIT[r.param] || 'dB');
}

/**
 * Empreinte bon marché de tout ce dont dépendent ces vérifications : équipements (id, type, nom, réglages), câbles
 * (extrémités, catégorie, longueur, support, fiches), rapport de tests, étages. Nombres seulement : chaque texte et chaque
 * objet reçoit un numéro (les objets par identité : l'application remplace une fiche, un câble neuf ou des réglages au lieu
 * de les modifier sur place ; une valeur simple modifiée sur place, longueur ou catégorie, est lue telle quelle).
 */
const objIds = new WeakMap(), strIds = new Map();
let nextObj = 1;
const oid = o => { if (!o || typeof o !== 'object') return 0; let v = objIds.get(o); if (!v) { v = nextObj++; objIds.set(o, v); } return v; };
const sid = s => { let v = strIds.get(s); if (v === undefined) { if (strIds.size > 100000) strIds.clear(); v = strIds.size + 1; strIds.set(s, v); } return v; };
export function modelSig(data) {
  let h = 0x811c9dc5, h2 = 7;
  const mix = x => { h = Math.imul(h ^ (x | 0), 16777619); h2 = (Math.imul(h2, 31) + (x | 0)) | 0; };
  const devs = (data && data.devices) || [], cables = (data && data.cables) || [];
  mix(devs.length); mix(cables.length);
  for (const d of devs) { mix(sid(d.id)); mix(sid(d.type)); mix(sid(d.name || '')); mix(oid(d.p)); if (d.p && d.p.sfp) mix(sid(JSON.stringify(d.p.sfp))); }
  for (const c of cables) {
    const a = c.a || [], b = c.b || [], w = c.wire || {};
    mix(sid(c.id)); mix(sid(a[0])); mix(sid(a[1])); mix(sid(b[0])); mix(sid(b[1])); mix(sid(c.cat || '')); mix(Math.round((+c.len || 0) * 1000)); mix(sid(c.media || ''));
    mix(oid(w)); mix(oid(w.a)); mix(oid(w.b)); mix(oid(w.cut));
  }
  const t = data && data.tests;
  mix(oid(t)); if (t) { mix(sid(String(t.at))); mix(Math.round((+t.band || 0) * 100)); mix(oid(t.results)); mix((t.results || []).length); }
  const site = data && data.site;
  mix(oid(site)); if (site && Array.isArray(site.buildings)) for (const bd of site.buildings) mix(bd && bd.floors ? bd.floors.length : 0);
  return (h >>> 0).toString(36) + ':' + (h2 >>> 0).toString(36);
}
/** Derniers messages par plan (le même objet d'un appel à l'autre dans l'application). */
const memo = new WeakMap();

/** data : plan propre (clean.js) ; lan : réseau simulé ; h : { name(id) }. Rend [{ code, id, text }]. */
export function issues(data, lan, h) {
  void lan; void h;
  if (!data || typeof data !== 'object') return [];
  // Dans l'application, chaque changement passe par ctx.commit(), qui recalcule le réseau (lan.version change) : même
  // version, mêmes tableaux, même rapport → rien n'a bougé, pas même besoin de l'empreinte.
  const t = data.tests, quick = lan && Number.isFinite(lan.version) ? `${lan.version}|${oid(data.cables)}|${(data.cables || []).length}|${oid(data.devices)}|${oid(t)}|${t ? t.at + '|' + t.band : ''}` : null;
  const m = memo.get(data);
  if (m && quick && m.quick === quick) return m.out.map(x => ({ ...x }));
  const sig = modelSig(data);
  if (m && m.sig === sig) { m.quick = quick; return m.out.map(x => ({ ...x })); }
  const out = compute(data);
  memo.set(data, { sig, quick, out: out.map(x => ({ ...x })) });
  return out;
}
function compute(data) {
  const links = certLinks(data); if (!links.length) return [];
  const st = testState(data, links), out = [], band = data.tests ? data.tests.band : undefined;
  let stale = 0, staleId = null, never = 0, neverId = null;
  for (const row of st.rows) {
    const l = row.link, s = row.stored;
    if (row.stale) { stale++; staleId = staleId || l.cables[0].id; }
    if (l.kind === 'pl' && !s) { never++; neverId = neverId || l.cables[0].id; }
    if (l.kind === 'ch' && !s) continue;
    const limit = s ? s.limit : defaultLimit(l);
    const r = certifyCached(l, limit, { band });
    if (!r.wiremap.ok) continue;
    if (r.verdict === 'pass') continue;
    const label = linkLabel(data, l), id = l.cables[0].id, lim = limitInfo(limit).name;
    if (!r.ok) out.push({ code: 'J1286', id, text: tl('Lien {0} : la certification simulée échoue en {1} ({2} : {3}).', label, lim, verdictText(r.verdict), weakText(r)) });
    else if (r.verdict === 'pass*') {
      const p = Object.keys(r.params).find(k => XT.has(k) && r.params[k].st === 'pass*');
      if (p) out.push({ code: 'J1287', id, text: tl('Lien {0} : réussite marginale en {1} ({2} {3}, marge {4} dB, dans la précision du testeur).', label, lim, paramName(p), r.params[p].pair || '', num(r.params[p].margin)) });
    }
  }
  stale += st.orphans.length;
  if (stale) out.push({ code: 'J1288', id: staleId, text: tl('Rapport de certification périmé : {0} résultat(s) ne correspondent plus au plan (câble, longueur, catégorie ou limite changés, ou lien supprimé). Relancez les tests.', stale) });
  if (never && hasSite(data)) out.push({ code: 'J1289', id: neverId, text: tl('{0} lien(s) permanent(s) jamais certifié(s) : lancez « Tester tout » (vue Conception, onglet Tests).', never) });
  return out;
}

/** Liens d'un contrôle de TP : genre (c.links : 'pl' par défaut, 'ch', 'all') et appareil (c.of : nom d'une extrémité). */
function labLinks(c, data) {
  let links = certLinks(data); const kind = c.links || 'pl';
  if (kind !== 'all') links = links.filter(l => l.kind === kind);
  if (c.of) {
    const want = String(c.of).toLowerCase(), names = new Map(((data && data.devices) || []).map(d => [d.id, String(d.name || '').toLowerCase()]));
    links = links.filter(l => l.ends.some(([n]) => names.get(n) === want));
  }
  return links;
}
/** Contrôles de TP : { 'net-…': { check(c, env) → { ok, … }, text(c, r) → texte de l'échec } } ; env : voir labcheck.js. */
export const LAB = {
  // { type: 'net-cert', limit?: 'cat6a-pl' (sinon la catégorie de chaque lien), links?: 'pl'|'ch'|'all', of?: 'PR3',
  //   min?: 1, strict?: true (PASS* refusé) }  chaque lien choisi réussit la certification simulée.
  'net-cert': {
    check(c, env) {
      const data = env && env.netData ? env.netData() : null;
      if (!data) return { ok: false, why: 'nolink', n: 0, bad: [] };
      const links = labLinks(c, data);
      if (links.length < (c.min || 1)) return { ok: false, why: 'nolink', n: links.length, bad: [] };
      const bad = [];
      for (const l of links) {
        const r = certify(l, limitInfo(c.limit) ? c.limit : defaultLimit(l), { band: c.band });
        if (!r.ok || (c.strict && r.verdict !== 'pass')) bad.push({ label: linkLabel(data, l), verdict: r.verdict, weak: weakText(r) });
      }
      return { ok: !bad.length, n: links.length, bad };
    },
    text(c, r) {
      if (r.why === 'nolink') return c.of ? tl('Aucun lien à certifier ne touche {0}.', c.of) : tl('Aucun lien à certifier dans le plan (un lien permanent relie le dos d’un panneau de brassage au dos d’une prise).');
      return tl('{0} lien(s) sur {1} ne réussissent pas la certification : {2}.', r.bad.length, r.n, r.bad.slice(0, 3).map(b => `${b.label} (${verdictText(b.verdict)}, ${b.weak})`).join(' ; '));
    }
  }
};
