// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Chargement de Blockly à la demande : seulement quand le mode « Blocs de code » est ouvert.
// Les import() littéraux laissent Vite en faire des morceaux séparés du programme principal.
import { isEn } from '../../i18n/index.js';

let ready = null;
/** Blockly (cœur, blocs intégrés, textes dans la langue de l'interface), chargé une seule fois. */
export function loadBlockly() {
  if (!ready) {
    ready = Promise.all([import('blockly/core'), import('blockly/blocks'), isEn ? import('blockly/msg/en') : import('blockly/msg/fr')])
      .then(([Blockly, , msg]) => { Blockly.setLocale(msg.default || msg); return Blockly; })
      .catch(e => { ready = null; throw e; }); // nouvel essai possible à la prochaine ouverture
  }
  return ready;
}
