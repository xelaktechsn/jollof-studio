// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fermeture du projet en cours avant d'en créer ou d'en ouvrir un autre (nouveau projet, fichier, exemple, fichier reçu
// du système, import Wokwi) : il ne reste rien de l'ancien, quel que soit son type. Ordre :
//   1. modifications non enregistrées : Enregistrer / Ne pas enregistrer / Annuler (annuler, ou un enregistrement
//      refusé, garde le projet tel quel : rien n'est fermé) ;
//   2. animation de caméra terminée, simulation arrêtée (programmes, plans pneumatique et logique, réseau) ;
//   3. fenêtres des plans de travail fermées (sertissage, testeurs, certification, navigateur, boîtes de dialogue
//      ouvertes par un plan) : chaque module le fait dans son close() ;
//   4. une ligne dans la Sortie : ce qui suit concerne le nouveau projet.
// Module chargé à la demande (import() dans main.js) : rien au démarrage.

/** Étapes à faire, d'après l'état du projet en cours : liste ordonnée de noms. */
export function closeSteps({ dirty = false, homeGuard = false, anim = false, simOn = false } = {}) {
  const out = [];
  if (dirty && !homeGuard) out.push('ask'); // accueil du démarrage : la session d'avant n'est pas « le projet en cours »
  if (anim) out.push('anim');
  if (simOn) out.push('sim');
  out.push('modules');
  if (!homeGuard) out.push('log'); // accueil : aucun projet à fermer, rien à écrire dans la Sortie
  return out;
}

/**
 * Ferme le projet. st : état (closeSteps) ; h : { ask() → 'save' | 'discard' | null, save() → bool, finishAnim(),
 * stopSim(), closeModules(), log() }. Rend true si l'on peut continuer (nouveau projet, ouverture), false si annulé.
 */
export async function closeProject(st, h) {
  for (const s of closeSteps(st)) {
    if (s === 'ask') {
      const v = await h.ask();
      if (v !== 'save' && v !== 'discard') return false;
      if (v === 'save' && !(await h.save())) return false;
    } else if (s === 'anim') h.finishAnim();
    else if (s === 'sim') h.stopSim();
    else if (s === 'modules') h.closeModules();
    else if (s === 'log') h.log();
  }
  return true;
}
