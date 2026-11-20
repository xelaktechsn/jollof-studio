// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Accueil : ce que montre l'application à son ouverture, à la place d'un projet choisi d'avance. On y crée un projet
// (un type par carte), on reprend le dernier projet, on en ouvre un, ou l'on part d'un exemple, d'un TP ou du
// tutoriel. Au tout premier lancement, une courte présentation en quatre étapes passe d'abord. Le menu du projet
// (« Accueil ») y ramène. Rien n'est chargé derrière tant qu'on n'a pas choisi.
import './home.css';
import { tl } from '../i18n/index.js';
import { icon } from './icons.js';
import { LOGO, WORDMARK } from './brand.js';
import { KINDS, KIND_IDS, inferKind } from './kind.js';

const SEEN = 'jollof-onboarded';
/** Présentation déjà vue (pas le premier lancement). */
export const onboarded = () => { try { return localStorage.getItem(SEEN) === '1'; } catch (e) { return true; } };
const seen = onboarded;
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch (e) { /* stockage indisponible : on la reverra */ } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Étapes de la présentation : icône, titre, texte, et trois points concrets. */
const STEPS = () => [
  { icon: 'flask', title: tl('Un labo d’électronique. Sans labo.'), text: tl('Jollof Studio est une paillasse complète sur votre ordinateur : on câble, on programme, on simule et on mesure, sans matériel et sans rien casser.'),
    points: [['cpu', tl('Arduino, ESP32, Pico')], ['zap', tl('Simulation en direct')], ['graduation', tl('73 TP guidés')]] },
  { icon: 'cable', title: tl('Câblez et programmez en 3D'), text: tl('Posez les composants, tirez les fils broche à broche ou laissez le câblage automatique le faire. Programmez par règles, par blocs ou en vrai code Arduino.'),
    points: [['wand', tl('Câblage automatique')], ['puzzle', tl('Règles, blocs, code')], ['schematic', tl('Schéma en direct')]] },
  { icon: 'check', title: tl('Le vérificateur prouve que rien ne grille'), text: tl('Avant de toucher une vraie carte, il essaie chaque état du montage et de son programme, et explique chaque faute avec sa correction en un clic.'),
    points: [['check', tl('Tous les états essayés')], ['alert', tl('Fautes expliquées')], ['usb', tl('Puis la vraie carte')]] },
  { icon: 'pneu', title: tl('Pneumatique, GRAFCET et logique'), text: tl('Vérins, distributeurs et GRAFCET, commandés par une carte dans un projet électropneumatique, avec la machine en 3D. Et un plan de travail pour la logique numérique.'),
    points: [['split', tl('Électropneumatique')], ['workflow', tl('GRAFCET')], ['logic', tl('Logique numérique')]] },
  { icon: 'network', title: tl('Réseaux et objets connectés'), text: tl('Sertissez des câbles RJ45 et testez-les, câblez switchs, box et Wi-Fi, réglez les adresses IP et faites des ping. Puis reliez une carte au réseau : page web, MQTT, Modbus TCP.'),
    points: [['rj45', tl('Sertir et tester')], ['network', tl('Adresses, DHCP, ping')], ['iot', tl('Page web, MQTT')]] }
];

/**
 * h : { resume() → { name, kind, parts } | null (dernier projet à reprendre), onResume(), onKind(kind), onOpen(),
 * onExamples(), onLabs(), onTutorial(), onClose() (Échap : plan de travail vide) }. Rend { show({ intro }), hide(), isOpen() }.
 */
export function createHome(h) {
  const root = document.createElement('div');
  root.className = 'homeScr'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', tl('Accueil'));
  document.body.appendChild(root);
  let step = -1; // -1 : l'accueil ; 0… : étape de la présentation

  function paint() {
    root.replaceChildren();
    if (step >= 0) { paintIntro(); return; }
    const r = h.resume();
    const wrap = document.createElement('div'); wrap.className = 'hmWrap';
    wrap.innerHTML = `
      <header class="hmHead"><span class="hmLogo">${LOGO}</span><span class="hmMark">${WORDMARK}</span>
        <p>${tl('Un labo d’électronique. Sans labo.')}</p></header>
      ${r ? `<section class="hmSec"><h2>${tl('Reprendre le travail')}</h2>
        <button type="button" class="hmResume" data-a="resume"><span class="hmIc">${icon((KINDS[r.kind] || KINDS.elec).icon)}</span>
          <span class="hmTxt"><b>${esc(r.name)}</b><small>${esc((KINDS[r.kind] || KINDS.elec).name())}${r.parts ? ' · ' + esc(r.parts > 1 ? tl('{0} composants', r.parts) : tl('{0} composant', r.parts)) : ''}</small></span>
          <span class="hmGo">${tl('Continuer')}${icon('chevRight')}</span></button></section>` : ''}
      <section class="hmSec"><h2>${tl('Nouveau projet')}</h2>
        <div class="hmKinds">${KIND_IDS.map(k => `<button type="button" class="hmKind" data-kind="${k}"><span class="hmIc">${icon(KINDS[k].icon)}</span><b>${KINDS[k].name()}</b><small>${KINDS[k].text()}</small></button>`).join('')}</div></section>
      <section class="hmSec"><h2>${tl('Ouvrir ou découvrir')}</h2>
        <div class="hmRow">
          <button type="button" class="hmLink" data-a="open">${icon('folder')}<span><b>${tl('Ouvrir un projet…')}</b><small>${tl('Un fichier .jollof enregistré')}</small></span></button>
          <button type="button" class="hmLink" data-a="examples">${icon('layers')}<span><b>${tl('Exemples')}</b><small>${tl('Des montages prêts à simuler')}</small></span></button>
          <button type="button" class="hmLink" data-a="labs">${icon('checklist')}<span><b>${tl('TP guidés')}</b><small>${tl('Vérifiés pas à pas')}</small></span></button>
          <button type="button" class="hmLink" data-a="tutorial">${icon('graduation')}<span><b>${tl('Tutoriel')}</b><small>${tl('Mon premier projet électropneumatique')}</small></span></button>
        </div></section>
      <footer class="hmFoot"><button type="button" class="hmText" data-a="intro">${icon('play')}${tl('Revoir la présentation')}</button></footer>`;
    root.appendChild(wrap);
    const first = root.querySelector('.hmResume') || root.querySelector('.hmKind'); if (first) first.focus({ preventScroll: true });
  }

  function paintIntro() {
    const S = STEPS(), s = S[step], last = step === S.length - 1;
    const card = document.createElement('div'); card.className = 'hmIntro';
    card.innerHTML = `
      <div class="hmArt"><span class="hmBig">${icon(s.icon)}</span><span class="hmStep">${tl('{0} sur {1}', step + 1, S.length)}</span></div>
      <h1>${s.title}</h1><p>${s.text}</p>
      <ul class="hmPoints">${s.points.map(([i, t]) => `<li>${icon(i)}<span>${t}</span></li>`).join('')}</ul>
      <div class="hmDots" role="tablist">${S.map((x, i) => `<button type="button" role="tab" aria-selected="${i === step}" aria-label="${esc(tl('Étape {0}', i + 1))}" data-step="${i}"></button>`).join('')}</div>
      <div class="hmNav">
        <button type="button" class="btn" data-a="skip">${tl('Passer')}</button><span class="grow"></span>
        ${step > 0 ? `<button type="button" class="btn" data-a="prev">${icon('chevLeft')}${tl('Précédent')}</button>` : ''}
        <button type="button" class="btn primary" data-a="${last ? 'done' : 'next'}">${last ? tl('Commencer') : tl('Suivant')}${icon('chevRight')}</button>
      </div>`;
    root.appendChild(card);
    card.querySelector('.btn.primary').focus({ preventScroll: true });
  }

  function go(i) { step = i; paint(); }
  function endIntro() { markSeen(); go(-1); }

  root.addEventListener('click', e => {
    const d = e.target.closest('[data-step]'); if (d) { go(+d.dataset.step); return; }
    const k = e.target.closest('[data-kind]'); if (k) { h.onKind(k.dataset.kind); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'next') go(step + 1);
    else if (a === 'prev') go(Math.max(0, step - 1));
    else if (a === 'skip' || a === 'done') endIntro();
    else if (a === 'intro') go(0);
    else if (a === 'resume') h.onResume();
    else if (a === 'open') h.onOpen();
    else if (a === 'examples') { hide(); h.onExamples(); }
    else if (a === 'labs') { hide(); h.onLabs(); }
    else if (a === 'tutorial') { hide(); h.onTutorial(); }
  });
  root.addEventListener('keydown', e => {
    if (step < 0) { if (e.key === 'Escape' && h.onClose) { e.preventDefault(); h.onClose(); } return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (step < STEPS().length - 1) go(step + 1); else endIntro(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (step > 0) go(step - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); endIntro(); }
  });

  function show(o = {}) { step = o.intro || (o.firstRun && !seen()) ? 0 : -1; root.hidden = false; document.documentElement.classList.add('homeOn'); paint(); }
  function hide() { if (root.hidden) return; root.hidden = true; document.documentElement.classList.remove('homeOn'); root.replaceChildren(); }
  return { show, hide, isOpen: () => !root.hidden };
}

/** Résumé d'un projet enregistré pour la carte « Reprendre », ou null s'il est vide. */
export function resumeInfo(data) {
  if (!data || !Array.isArray(data.comps)) return null;
  const mods = (data.settings && data.settings.modules) || {}, n = m => (m && m.circuit && Array.isArray(m.circuit.elements) ? m.circuit.elements.length : 0);
  if (!data.comps.length && !n(mods.pneu) && !n(mods.logic)) return null;
  return { name: data.name || tl('Sans titre'), kind: inferKind(data), parts: data.comps.length };
}
