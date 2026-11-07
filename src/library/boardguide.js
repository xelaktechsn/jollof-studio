// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// « Quelle carte choisir ? » : page de la documentation qui compare les cartes que Jollof Studio
// simule, pour un élève ou un enseignant qui doit en acheter ou en choisir une. Les données
// techniques (tension logique, convertisseur, broches) sont lues dans les profils des cartes
// (sim/boards.js) : la page dit toujours la même chose que le simulateur. Les prix sont des
// ordres de grandeur pour des clones achetés localement, à vérifier.
import { tl } from '../i18n/index.js';
import { BOARDS, volts } from '../sim/boards.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yes = on => (on ? `<span class="bgYes">✓</span>` : `<span class="bgNo">—</span>`);

/** Ce que le profil d'une carte permet de compter : broches d'entrée/sortie, entrées analogiques, PWM. */
function counts(prof) {
  const alias = new Set((prof.alias || []).map(a => a[0]));
  const pins = Object.entries(prof.gpio).filter(([k, g]) => !alias.has(k) && !g.caps.has('flash'));
  return {
    io: pins.filter(([, g]) => g.caps.has('in') || g.caps.has('out')).length,
    adc: pins.filter(([, g]) => g.caps.has('adc')).length,
    pwm: pins.filter(([, g]) => g.caps.has('pwm')).length
  };
}

/** Cartes simulées, dans l'ordre conseillé pour une école. */
const CARDS = () => [
  { id: 'uno', wifi: false, level: tl('Débutant'), price: tl('≈ 4 000 – 8 000 FCFA (clone)'), use: tl('Apprendre : LED, boutons, capteurs, moteurs. Le premier choix d’un club ou d’une salle de TP.') },
  { id: 'nano', wifi: false, level: tl('Débutant'), price: tl('≈ 3 000 – 6 000 FCFA (clone)'), use: tl('La même carte que l’Uno, en petit : se pique directement sur la breadboard, idéale pour un montage définitif.') },
  { id: 'esp32', wifi: true, bt: true, level: tl('Intermédiaire'), price: tl('≈ 5 000 – 9 000 FCFA'), use: tl('Objets connectés : station météo en ligne, arrosage commandé par téléphone, serveur web. Plus rapide, mais logique 3,3 V.') },
  { id: 'nodemcu', wifi: true, level: tl('Intermédiaire'), price: tl('≈ 3 500 – 6 000 FCFA'), use: tl('Le Wi-Fi le moins cher : un capteur qui envoie ses mesures. Une seule entrée analogique.') },
  { id: 'pico', wifi: false, level: tl('Intermédiaire'), price: tl('≈ 4 000 – 7 000 FCFA'), use: tl('Apprendre MicroPython ; signaux très précis (rubans de LED) grâce à ses blocs PIO. Version « W » avec Wi-Fi.') }
];

export function renderBoardGuide() {
  const cards = CARDS().filter(c => BOARDS[c.id]);
  const rows = cards.map(c => {
    const p = BOARDS[c.id], n = counts(p), five = p.logic >= 5;
    return `<tr><th><b>${esc(p.label)}</b><small>${esc(c.level)}</small><span class="bgAct"><button type="button" class="btn small" data-id="${c.id}">${tl('Fiche')}</button><button type="button" class="btn small primary" data-add="${c.id}">${tl('Ajouter')}</button></span></th>
      <td><span class="bgLogic ${five ? 'v5' : 'v3'}">${esc(volts(p.logic))}</span></td>
      <td>${yes(five)}</td><td>${n.io}</td><td>${n.adc} · ${tl('{0} bits', p.adcBits)}</td><td class="bgNw">${yes(c.wifi)}${c.bt ? ` <small>+ BT</small>` : ''}</td>
      <td class="bgUse">${esc(c.use)}<small>${esc(c.price)}</small></td></tr>`;
  }).join('');
  const head = `<small>${tl('Guide')}</small><h1>${tl('Quelle carte choisir ?')}</h1>
    <p class="lead">${tl('Les cartes simulées par Jollof Studio, comparées pour un club, une salle de TP ou un projet : ce qu’elles savent faire, leurs pièges, par laquelle commencer.')}</p>`;
  const body = `
    <section><h3>${tl('Microcontrôleur ou ordinateur monocarte ?')}</h3>
      <p>${tl('Un **microcontrôleur** (Arduino, ESP32, Pico) exécute un seul programme, celui que vous téléversez, dès qu’il est alimenté : il réagit vite et toujours de la même façon. C’est lui qui allume une LED, lit un capteur, commande un moteur. Jollof Studio simule les microcontrôleurs.').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
      <p>${tl('Un **ordinateur monocarte** (Raspberry Pi 4 ou 5…) est un petit ordinateur complet sous Linux : écran, clavier, Internet, fichiers, caméra. Il sert quand il faut traiter des images ou héberger un serveur, et confie souvent les signaux précis à un microcontrôleur.').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
      <p class="bgWarn">${tl('Attention aux noms : le Raspberry Pi (ordinateur) et le Raspberry Pi Pico (microcontrôleur) n’ont presque rien en commun.')}</p></section>
    <section class="bgWide"><h3>${tl('Les cartes du simulateur')}</h3>
      <div class="bgScroll"><table class="boardTable"><thead><tr><th>${tl('Carte')}</th><th>${tl('Logique')}</th><th>${tl('Accepte 5 V')}</th><th>${tl('E/S')}</th><th>${tl('Entrées analogiques')}</th><th>${tl('Wi-Fi')}</th><th>${tl('Pour quoi faire')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hintline">${tl('Nombres de broches : celles que le simulateur laisse utiliser (sans les broches réservées). Prix : ordres de grandeur pour des clones achetés au Sénégal, très variables selon le vendeur.')}</p></section>
    <section><h3>${tl('5 V ou 3,3 V : la règle d’or')}</h3><ul>
      <li>${tl('L’Uno et la Nano travaillent en 5 V : elles supportent les modules 5 V et pardonnent beaucoup d’erreurs de débutant.')}</li>
      <li>${tl('L’ESP32, le NodeMCU et le Pico travaillent en 3,3 V et aucune de leurs broches n’accepte 5 V : un signal 5 V (écho d’un HC-SR04, sortie d’un module 5 V) peut les détruire. Passez par un pont diviseur (1 kΩ / 2 kΩ) ou un adaptateur de niveau.')}</li>
      <li>${tl('À l’inverse, un module 3,3 V (BMP280, RC522…) alimenté en 5 V grille : regardez toujours sa tension avant de le brancher.')}</li>
      <li>${tl('Le simulateur signale ces erreurs en rouge dans l’onglet Simulation : essayez avant d’acheter.')}</li></ul></section>
    <section><h3>${tl('Par où commencer ?')}</h3><ol class="bgPath">
      <li><b>${tl('Apprendre')}</b> — ${tl('Uno, ou Nano pour un montage compact. Des milliers de tutoriels en français ; tous les TP de base de Jollof Studio l’utilisent.')}</li>
      <li><b>${tl('Connecter')}</b> — ${tl('ESP32 dès qu’il faut le Wi-Fi ou le Bluetooth (mêmes programmes Arduino, quelques broches à éviter) ; NodeMCU si le budget est très serré.')}</li>
      <li><b>${tl('Explorer')}</b> — ${tl('Pico pour MicroPython et les signaux très précis.')}</li></ol></section>
    <section><h3>${tl('Pour aller plus loin')}</h3><ul>
      <li>${tl('Arduino Uno R4 : même forme et même 5 V que l’Uno, processeur 48 MHz et 32 Ko de mémoire vive ; version WiFi.')}</li>
      <li>${tl('ESP32-S3 et ESP32-C3 : variantes de l’ESP32 (USB intégré, prix plus bas pour la C3). Importables dans Jollof Studio comme cartes personnelles.')}</li>
      <li>${tl('Raspberry Pi Pico 2 (RP2350) : 150 MHz, 520 Ko de mémoire vive et 3 blocs PIO, au lieu de 133 MHz, 264 Ko et 2 PIO pour le Pico.')}</li>
      <li>${tl('micro:bit : carte d’initiation avec écran de LED, boutons et capteurs intégrés, programmée par blocs ou en Python.')}</li>
      <li>${tl('Raspberry Pi 4 ou 5 : quand le projet a besoin d’une caméra, de vision par ordinateur ou d’un serveur, associé à une carte ci-dessus pour les capteurs et les moteurs.')}</li></ul></section>`;
  return { head, body };
}
