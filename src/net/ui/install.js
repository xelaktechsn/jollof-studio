// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan réseau : ce qui est chargé au démarrage, et rien de plus (le démarrage doit rester rapide). Ce module garde les
// données du projet (module « net »), ajoute le bouton « Réseau » au sélecteur de plan de travail et charge le plan
// lui-même (workspace.js : éditeur, simulation, panneaux) seulement quand le projet en a besoin : type Réseau ou Objets
// connectés, projet qui contient un plan réseau, ou bouton pressé.
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { spacesOf } from '../../ui/kind.js';

const hasContent = d => !!d && typeof d === 'object' && ((Array.isArray(d.devices) && d.devices.length) || (Array.isArray(d.cables) && d.cables.length));

export function installNet(app) {
  const $ = s => document.querySelector(s);
  let raw = null, ws = null, loading = null, wantOn = false;
  const ui = { tester: false, crimp: false, browser: false, ping: false };
  const sw = $('.wsSwitch');
  sw.insertAdjacentHTML('beforeend', `<button type="button" class="segBtn" data-ws="net" aria-pressed="false" data-tip="${tl('Réseau : PC, switchs, box, câbles RJ45, adresses IP')}">${icon('network')}<span>${tl('Réseau')}</span></button>`);
  // Un autre plan choisi : le plan réseau se ferme d'abord (avant les gestionnaires des autres plans).
  sw.addEventListener('click', e => { const b = e.target.closest('[data-ws]'); if (b && b.dataset.ws !== 'net' && api.isOn()) api.setMode(false); }, true);
  sw.querySelector('[data-ws="net"]').onclick = () => {
    if (app.logic && app.logic.isOn()) app.logic.setMode(false);
    if (app.pneu && app.pneu.isOn()) app.pneu.setMode(false);
    api.setMode(true);
  };
  /** Charge le plan de travail (une fois) ; rend une promesse. */
  function ready() {
    if (ws) return Promise.resolve(ws);
    if (!loading) {
      loading = import('./workspace.js').then(m => {
        ws = m.createNetWorkspace(app, ui, raw);
        if (wantOn) ws.setMode(true);
        return ws;
      }).catch(e => { console.error(e); loading = null; throw e; });
    }
    return loading;
  }
  app.register('net', {
    load(d) {
      raw = d && typeof d === 'object' ? d : null;
      if (ws) ws.load(raw);
      else if (hasContent(raw) || spacesOf(app.kind ? app.kind() : 'elec').includes('net')) { wantOn = !!raw && raw.view === 'net'; ready(); }
    },
    save() { return ws ? ws.save() : raw || undefined; }
  });
  const api = {
    loaded: () => !!ws, ready,
    isOn: () => (ws ? ws.isOn() : false),
    /** Montre (ou cache) le plan réseau ; il se charge la première fois. */
    setMode(v) {
      wantOn = !!v;
      if (ws) { ws.setMode(v); return; }
      if (v) ready();
    },
    /** Le type du projet a changé : un projet Réseau ou Objets connectés charge son plan d'avance. */
    kindChanged() { if (spacesOf(app.kind()).includes('net')) ready(); },
    /** Plan du projet ({ devices, cables, ext }) et réseau simulé (null tant que le plan n'est pas chargé). */
    data: () => (ws ? ws.data() : raw),
    lan: () => (ws ? ws.lan() : null),
    hasContent: () => hasContent(ws ? ws.data() : raw),
    diags: () => (ws ? ws.diags() : []),
    reveal: id => ready().then(w => w.reveal(id)),
    /** État de l'interface lu par les TP : testeur, atelier de sertissage, navigateur ouverts ; un ping fait. */
    uiState: () => ({ ...ui }),
    /** Projet (format .jollof) qui ouvre ce plan réseau : pour les TP et les exemples. */
    project: (net, name, kind = 'net') => ({ app: 'jollof-studio', version: 1, name, comps: [], wires: [], settings: { kind, modules: { net: { view: 'net', ...JSON.parse(JSON.stringify(net || {})) } } } }),
    drawPdf: (d, area) => (ws && ws.drawPdf ? ws.drawPdf(d, area) : null)
  };
  return api;
}
