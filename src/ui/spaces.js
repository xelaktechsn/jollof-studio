// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plans de travail chargés à la demande. Le démarrage ne charge que ce que montre le premier écran : le plan logique
// (src/logic) et le plan pneumatique (src/pneu, avec le GRAFCET, l'automate et la machine 3D) n'arrivent que pour un
// projet qui s'en sert. D'ici là, l'application parle à une façade : mêmes fonctions de lecture (plan fermé, circuit
// vide, aucun problème), et setMode(true) charge le plan avant de l'ouvrir. main.js charge le plan AVANT de donner
// ses données à un projet (needSpaces), si bien qu'un projet ouvert trouve toujours son plan réel.
import { tl, isEn } from '../i18n/index.js';
import { icon } from './icons.js';

/**
 * Façade d'un plan de travail : `load()` rend la promesse de son interface réelle (installée une seule fois), `stub`
 * répond tant qu'il n'est pas chargé. loaded() et ready() s'ajoutent à l'interface.
 */
export function lazySpace(load, stub) {
  let real = null, loading = null;
  const base = {
    loaded: () => !!real,
    ready() {
      if (real) return Promise.resolve(real);
      if (!loading) loading = Promise.resolve().then(load).then(r => (real = r), e => { loading = null; throw e; });
      return loading;
    }
  };
  const pick = k => (k in base ? base[k] : real ? real[k] : stub[k]);
  return new Proxy(base, {
    get: (_, k) => pick(k),
    has: (_, k) => k in base || k in (real || stub),
    set() { return false; }
  });
}

const EMPTY_PNEU = Object.freeze({ elements: Object.freeze([]), tubes: Object.freeze([]) });
const EMPTY_LOGIC = Object.freeze({ elements: Object.freeze([]), wires: Object.freeze([]) });
const no = () => false, none = () => null, list = () => [];

/** Plan pneumatique pas encore chargé : fermé, vide, sans problème. */
export const pneuStub = api => ({
  isOn: no, isSplit: no, grafcetOpen: no, plcOpen: no, is3dOpen: no, isBuilding: no, isPushed: no, isGrafcetInput: no,
  circuit: () => EMPTY_PNEU, state: none, grafcet: none, plc: none, scene: none, machine: none, grafcetState: none, plcState: none, actLabel: none,
  diags: list, check: list, moves: list, links: list, sceneProblems: list, bench: () => ({ coils: [], sensors: [] }), simTime: () => 0,
  setMode(v) { if (v) api().ready().then(r => r.setMode(true)).catch(e => console.error(e)); },
  setSplit(v) { if (v) api().ready().then(r => r.setSplit(true)).catch(e => console.error(e)); },
  refresh() {}, resetState() {}, press() {}, act() {}
});
/** Plan logique pas encore chargé. */
export const logicStub = api => ({
  isOn: no, circuit: () => EMPTY_LOGIC, style: () => 'ansi', diags: list,
  setMode(v) { if (v) api().ready().then(r => r.setMode(true)).catch(e => console.error(e)); },
  reveal(id) { api().ready().then(r => r.reveal(id)).catch(e => console.error(e)); },
  onChange(fn) { let off = null, gone = false; api().ready().then(r => { if (!gone) off = r.onChange(fn); }).catch(() => {}); return () => { gone = true; if (off) off(); }; }
});

/** Données enregistrées d'un plan : ce plan a-t-il quelque chose à montrer ? (mêmes règles que leur save()). */
export const spaceHasData = {
  pneu: d => !!(d && typeof d === 'object' && d.circuit),
  logic: d => !!(d && typeof d === 'object')
};

const SLOTS = new Map();
/**
 * Pose `what` (élément, ou HTML) à la place gardée pour un plan (« stage:pneu », « tabs:logic »…) ; sans place gardée,
 * à la fin de `parent`.
 */
export function placeInSlot(key, what, parent) {
  const m = SLOTS.get(key); SLOTS.delete(key);
  const node = typeof what === 'string' ? document.createRange().createContextualFragment(what) : what;
  if (m && m.isConnected) m.replaceWith(node); else parent.appendChild(node);
}

/**
 * Sélecteur de plan de travail (Électronique, Logique, Pneumatique ; le réseau y ajoute le sien), à droite de la
 * marque. Les boutons parlent aux façades : un plan pas encore chargé se charge au clic.
 */
export function createWsSwitch(app) {
  document.querySelector('.brand').insertAdjacentHTML('afterend', `<div class="seg wsSwitch" role="group" aria-label="${tl('Plan de travail')}">
    <button type="button" class="segBtn" data-ws="elec" aria-pressed="true" data-tip="${tl('Montage électronique : cartes, capteurs, câblage en 3D')}">${icon('cpu')}<span>${tl('Électronique')}</span></button>
    <button type="button" class="segBtn" data-ws="logic" aria-pressed="false" data-tip="${tl('Logique : portes, bascules, compteurs, tables de vérité')}">${icon('logic')}<span>${isEn ? 'Logic' : 'Logique'}</span></button>
    <button type="button" class="segBtn" data-ws="pneu" aria-pressed="false" data-tip="${tl('Pneumatique : distributeurs, vérins, électrovannes commandées par la carte')}">${icon('pneu')}<span>${tl('Pneumatique')}</span></button></div>`);
  const sw = document.querySelector('.wsSwitch');
  // Places gardées dans la page : un plan chargé plus tard pose son plan de travail et ses onglets là où il les posait
  // quand tout était chargé au démarrage (même ordre des onglets de l'inspecteur, même empilement dans #stage).
  const stage = document.querySelector('#stage'), tabs = document.querySelector('.panel.right .tabs');
  for (const k of ['logic', 'pneu']) {
    if (stage) SLOTS.set('stage:' + k, stage.appendChild(document.createComment(k)));
    if (tabs) SLOTS.set('tabs:' + k, tabs.appendChild(document.createComment(k)));
  }
  sw.querySelectorAll('[data-ws="elec"], [data-ws="logic"]').forEach(b => (b.onclick = () => app.logic.setMode(b.dataset.ws === 'logic')));
  sw.querySelector('[data-ws="pneu"]').onclick = () => { if (app.logic.isOn()) app.logic.setMode(false); app.pneu.setMode(true); };
  return sw;
}
