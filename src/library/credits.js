// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Écran « Crédits et licences » : les mentions légales de Jollof Studio (exigées par l'AGPL, section 5 et 7) et
// l'inventaire des composants tiers, produit par scripts/licenses.mjs (src/library/third-party.json).
import { tl } from '../i18n/index.js';
import THIRD from './third-party.json';

/** Dépôt du code source (AGPL, section 13 : le code doit être proposé aux utilisateurs). */
export const SOURCE_URL = 'https://github.com/xelaktechsn/jollof-studio';
export const COPYRIGHT = 'Copyright (C) 2026 Mamadou Sarr';

/** HTML de la page ; models : manifeste des modèles 3D (cadManifest), esc : échappement HTML. */
export function creditsHtml(models, esc) {
  const lic = Object.entries(THIRD.licenses).map(([l, n]) => `<li>${esc(l)} — ${n}</li>`).join('');
  const notable = THIRD.notable.map(x => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name)} (${esc(x.license)})</li>`).join('');
  return `<section><h3>${tl('Licence de Jollof Studio')}</h3>
    <p><b>${COPYRIGHT}</b></p>
    <p>${tl('Jollof Studio est un logiciel libre : vous pouvez le redistribuer et le modifier selon les termes de la licence publique générale GNU Affero (AGPL), version 3 ou ultérieure, avec les conditions supplémentaires ci-dessous.')}</p>
    <ul>
      <li>${tl('Toute copie, version modifiée ou œuvre fondée sur Jollof Studio garde la mention « {0} » et affiche « Basé sur Jollof Studio par Mamadou Sarr », avec un lien vers le projet d’origine (AGPL, section 7 b).', COPYRIGHT)}</li>
      <li>${tl('Une version modifiée se présente comme différente de l’original et porte un autre nom ; la licence ne donne aucun droit sur le nom « Jollof Studio », son logo ou ses icônes (section 7 c et e).')}</li>
      <li>${tl('Une version modifiée utilisée par d’autres, même seulement à travers un réseau (serveur d’école, site web), doit leur proposer son code source complet (section 13).')}</li>
    </ul>
    <p>${tl('Ce programme est distribué dans l’espoir qu’il sera utile, mais SANS AUCUNE GARANTIE, ni explicite ni implicite, y compris de qualité marchande ou d’adéquation à un usage particulier.')}</p>
    <p>${tl('Code source : {0}. Texte de la licence : fichiers LICENSE et NOTICE.md du dépôt.', `<a href="${SOURCE_URL}" target="_blank" rel="noopener">${SOURCE_URL}</a>`)}</p>
    <p>${tl('Une licence commerciale est proposée à qui ne peut pas respecter l’AGPL (garder ses modifications privées, intégrer Jollof Studio à un produit fermé) : voir COMMERCIAL.md.')}</p></section>
    <section><h3>${tl('Modèles 3D réels ({0})', models.length)}</h3><p>${tl('Convertis de STEP en GLB (axes, unités et matières adaptés). Ils sont redistribuables, y compris dans un logiciel commercial.')}</p>
    <table class="pinout"><thead><tr><th>${tl('Modèle')}</th><th>${tl('Auteur — source · licence')}</th></tr></thead><tbody>${models.map(x => `<tr><th>${esc(x.title)}</th><td>${esc(x.author)} — ${esc(x.source)}<p>${esc(x.license)}</p></td></tr>`).join('')}</tbody></table>
    <p>${tl('CC-BY-SA-4.0 (bibliothèque 3D KiCad, avec l’exception KiCad) : https://creativecommons.org/licenses/by-sa/4.0/ — les fichiers convertis restent sous cette licence. MIT : Adafruit_CAD_Parts, © Adafruit Industries. Textes complets dans le dossier cad/ de l’application (LICENSES.md, LICENSE-KiCad.md, LICENSE-Adafruit.txt).')}</p></section>
    <section><h3>${tl('Bibliothèques')}</h3>
    <p>${tl('{0} paquets JavaScript et {1} bibliothèques Rust, tous compatibles avec l’AGPL et avec la licence commerciale. Principaux :', THIRD.counts.npm, THIRD.counts.crates ?? '?')}</p>
    <ul>${notable}</ul>
    <p>${tl('Répartition par licence :')}</p><ul>${lic}</ul>
    <p>${tl('Liste complète : fichier THIRD_PARTY.md du dépôt (inventaire du {0}). Textes des licences dans le dossier licenses/ de l’application.', THIRD.generated)}</p></section>`;
}
