// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Type de projet, côté interface : le choix à la création d'un projet et le bouton de la barre d'application, à
// gauche du sélecteur de plan de travail, qui rappelle le type et permet d'en changer. Données : kind.js.
import './kind.css';
import { tl } from '../i18n/index.js';
import { icon } from './icons.js';
import { menu as popMenu, dialog } from '../school/ui.js';
import { KINDS, KIND_IDS, spacesOf } from './kind.js';

/**
 * Choix du type d'un nouveau projet : une carte par type. Rend l'identifiant choisi, 'tutorial' (lien du tutoriel
 * électropneumatique) ou null (annulé).
 */
export function chooseKind(current) {
  const body = document.createElement('div'); body.className = 'kdGrid';
  body.innerHTML = KIND_IDS.map(k => `<button type="button" class="kdCard${k === current ? ' cur' : ''}" data-kind="${k}"><span class="kdIc">${icon(KINDS[k].icon)}</span><b>${KINDS[k].name()}</b><small>${KINDS[k].text()}</small><span class="kdSpaces">${spacesOf(k).length > 1 ? tl('Deux plans de travail') : tl('Un plan de travail')}</span></button>`).join('')
    + `<p class="kdNote">${icon('graduation')}<span>${tl('Première fois en électropneumatique ?')}</span><button type="button" class="link" data-kind="tutorial">${tl('Suivre le tutoriel pas à pas')}</button></p>`;
  return dialog({
    title: tl('{0}Nouveau projet : que voulez-vous construire ?', icon('filePlus')), width: 860, cls: 'kdDialog', body,
    actions: [{ label: tl('Annuler'), value: null }],
    onOpen: (el, close) => { el.addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (b) close(b.dataset.kind); }); const f = el.querySelector('.kdCard.cur') || el.querySelector('.kdCard'); if (f) f.focus(); }
  });
}

/**
 * Bouton du type de projet (à gauche du sélecteur de plan de travail). host : { get(), set(k), anchor }.
 * Rend { paint() }.
 */
export function installKind(host) {
  host.anchor.insertAdjacentHTML('afterend', `<button type="button" class="tb label kindBtn" id="kindBtn" aria-haspopup="menu"></button>`);
  const btn = host.anchor.nextElementSibling;
  btn.onclick = async () => {
    const cur = host.get();
    const v = await popMenu(btn, KIND_IDS.map(k => ({ label: `${KINDS[k].name()}${k === cur ? ' ✓' : ''}`, icon: KINDS[k].icon, value: k })));
    if (v && v !== cur) host.set(v);
  };
  function paint() {
    const k = host.get(), K = KINDS[k] || KINDS.elec;
    btn.innerHTML = `${icon(K.icon)}<span>${K.name()}</span>${icon('chevDown')}`;
    btn.dataset.tip = tl('Type de projet : {0}. Cliquer pour en changer.', K.name());
    btn.setAttribute('aria-label', tl('Type de projet : {0}. Cliquer pour en changer.', K.name()));
  }
  paint();
  return { paint };
}
