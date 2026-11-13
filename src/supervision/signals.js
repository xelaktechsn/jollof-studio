// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Supervision : l'instantané des signaux d'un pas de simulation terminé. Lecture seule : rien n'est modifié dans le
// circuit. Un signal sans valeur connue est rendu avec `value: null` (mesure absente), jamais zéro.
//   NOM.pressed, NOM.pos…   entrées d'un composant (bouton, capteur de vérin, potentiomètre) ; vrai = 1
//   NOM.on                   effecteur actif (bobine excitée, relais collé, LED allumée, moteur en marche)
//   CARTE.BROCHE             tension (V) d'une broche câblée de la carte
//   VÉRIN.x                  position d'un vérin du plan pneumatique, de 0 (rentré) à 1 (sorti)
import { BOARDS } from '../sim/boards.js';
import { tl } from '../i18n/index.js';

const num = v => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && Number.isFinite(v) ? v : null);

/** app : { comps(), wires(), dcPin(idCarte, broche), pneu? }. Rend [{ id, value }], identifiants uniques. */
export function collectSignals(app) {
  const out = [], seen = new Set();
  const add = (id, value) => { if (!seen.has(id)) { seen.add(id); out.push({ id, value }); } };
  for (const c of app.comps()) {
    for (const [k, v] of Object.entries(c.inp || {})) if (typeof v === 'boolean' || typeof v === 'number') add(`${c.name}.${k}`, num(v));
    if (c.type === 'coil24') add(`${c.name}.on`, c.coilOn ? 1 : 0);
    else if (c.type === 'relay') add(`${c.name}.on`, c.relayOn ? 1 : 0);
    else if (c.led && c.led.mat) add(`${c.name}.on`, c.led.mat.emissiveIntensity > 0.25 ? 1 : 0);
    else if (c.actR && c.actR.live != null) add(`${c.name}.on`, c.actR.live ? 1 : 0);
  }
  for (const w of app.wires()) for (const e of [w.a, w.b]) {
    if (!e || !e.comp || !BOARDS[e.comp.type] || /^GND/.test(e.key)) continue; // la masse vaut 0 V par définition
    add(`${e.comp.name}.${e.key}`, num(app.dcPin(e.comp.id, e.key)));
  }
  // Vérins du plan pneumatique : dans un projet pneumatique ou électropneumatique (les deux plans y sont simulés).
  const P = app.pneu, linked = !app.kind || ['epneu', 'pneu'].includes(app.kind());
  if (P && linked) {
    const st = P.state() || {};
    for (const e of P.circuit().elements) if (e.type === 'cyl1' || e.type === 'cyl2') add(`${(e.p && e.p.label) || e.id}.x`, num((st.x || {})[e.id] ?? 0));
  }
  return out;
}

/** Nom lisible d'un signal pour les listes et les phrases : « BTN1 appuyé », « Vérin 1A : position », « UNO D7 (V) ». */
export function labelOf(id) {
  const i = String(id).lastIndexOf('.'); if (i < 0) return String(id);
  const who = id.slice(0, i), what = id.slice(i + 1);
  if (what === 'pressed') return tl('{0} (appuyé)', who);
  if (what === 'on') return tl('{0} (actif)', who);
  if (what === 'x') return tl('Vérin {0} (position)', who);
  if (what === 'pos') return tl('{0} (position)', who);
  if (/^[A-Z]{1,4}\d*\w*$/.test(what) || /^(GND|5V|3V3|VIN)/.test(what)) return tl('{0} {1} (V)', who, what);
  return `${who} ${what}`;
}
/** Unité d'un signal, pour les champs : volts pour une broche, rien sinon. */
export const unitOf = id => (/\.(pressed|on|x|pos)$/.test(id) ? '' : 'V');
/** Signal tout ou rien (0 ou 1) : bouton, effecteur. */
export const isBinary = id => /\.(pressed|on)$/.test(id);
/** Nom court d'un signal tout ou rien dans une phrase : « Y1 » pour « Y1.on », « BTN1 » pour « BTN1.pressed ». */
export const whoOf = id => (isBinary(id) ? String(id).replace(/\.(pressed|on)$/, '') : labelOf(id));

/**
 * Ce que l'on peut surveiller, vu comme des objets du circuit (pas des signaux) : un vérin, une électrovanne, un
 * capteur, une tension. kind : 'cyl' (position 0 à 1), 'act' (effecteur commandé, 0/1), 'sensor' (contact, 0/1),
 * 'pin' (tension d'une broche de carte), 'analog' (autre grandeur).
 */
export function thingsOf(app) {
  const list = collectSignals(app), out = [], byName = new Map(app.comps().map(c => [c.name, c]));
  const ACT = { coil24: () => tl('Électrovanne {0}'), relay: () => tl('Relais {0}'), dcmotor: () => tl('Moteur {0}'), pump: () => tl('Pompe {0}'), fan: () => tl('Ventilateur {0}'), buzzer: () => tl('Buzzer {0}'), servo: () => tl('Servomoteur {0}') };
  const SENS = { button: () => tl('Bouton {0}'), cylsensor: () => tl('Capteur de vérin {0}'), pressostat: () => tl('Pressostat {0}') };
  for (const s of list) {
    const i = s.id.lastIndexOf('.'), who = s.id.slice(0, i), what = s.id.slice(i + 1), c = byName.get(who);
    if (what === 'x') out.push({ key: s.id, kind: 'cyl', icon: 'pneu', name: tl('Vérin {0}', who), signal: s.id, value: s.value });
    else if (what === 'on') out.push({ key: s.id, kind: 'act', icon: c && c.type === 'coil24' ? 'pneu' : 'zap', name: (c && ACT[c.type] ? ACT[c.type]() : c && /^led/.test(c.type) ? tl('LED {0}') : tl('Sortie {0}')).replace('{0}', who), signal: s.id, value: s.value });
    else if (what === 'pressed') out.push({ key: s.id, kind: 'sensor', icon: 'toggle', name: (c && SENS[c.type] ? SENS[c.type]() : tl('Contact {0}')).replace('{0}', who), signal: s.id, value: s.value });
    else if (c && BOARDS[c.type]) {
      // Ce qui est câblé à la broche : une broche d'entrée ou de commande change de tension en fonctionnement normal.
      const peers = app.wires().flatMap(w => [[w.a, w.b], [w.b, w.a]]).filter(([x]) => x.comp === c && x.key === what).map(([, y]) => y.comp).filter(o => !/^breadboard/.test(o.type));
      const switching = peers.find(o => ['button', 'cylsensor', 'pressostat'].includes(o.type) || /^(res-|npn|pn2222|led)/.test(o.type));
      out.push({ key: s.id, kind: 'pin', icon: 'cpu', name: tl('Tension {0} {1}', who, what) + (peers.length ? ` (${peers.map(o => o.name).join(', ')})` : ''), signal: s.id, value: s.value, switching: switching ? switching.name : null });
    }
    else out.push({ key: s.id, kind: 'analog', icon: 'gauge', name: labelOf(s.id), signal: s.id, value: s.value });
  }
  const order = { cyl: 0, act: 1, sensor: 2, pin: 3, analog: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
