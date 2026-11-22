// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Format des projets .jollof : numéro de version du schéma (champ « version ») et migrations ordonnées.
//
// - Un fichier sans champ « version » (ou avec une valeur qui n'est pas un entier positif) est un fichier v0.
// - À l'ouverture, les migrations s'appliquent dans l'ordre, une version à la fois (0 → 1 → 2 …), jusqu'à FORMAT.
// - Un fichier d'une version plus récente que l'application n'est PAS ouvert : message clair, rien n'est modifié ni
//   perdu (l'ouvrir quand même, puis l'enregistrer, effacerait ce que cette version ne connaît pas).
// - Une migration ne retire jamais un champ qu'elle ne connaît pas : les données des modules (settings.modules) et
//   les champs ajoutés par d'autres éditions passent tels quels.
//
// Ajouter une version : incrémenter FORMAT, ajouter { to, note, run } à la fin de MIGRATIONS, ajouter un test dans
// format.test.mjs avec un fichier de la version d'avant. Module pur (ni page ni stockage) : il se teste sous Node.
import { KINDS, inferKind } from '../ui/kind.js';

/** Version du schéma écrite par cette application. */
export const FORMAT = 2;
export const APP_ID = 'jollof-studio';

const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);

/**
 * Migrations, dans l'ordre : `run(d)` reçoit un projet de la version `to - 1` (copie de travail : il peut la
 * modifier) et rend le projet à la version `to`.
 */
export const MIGRATIONS = [
  {
    to: 1,
    note: 'fichiers d’avant le numéro de version : identité de l’application, listes de composants et de fils',
    run(d) {
      d.app = APP_ID;
      if (!Array.isArray(d.comps)) d.comps = [];
      if (!Array.isArray(d.wires)) d.wires = [];
      if (d.settings != null && !isObj(d.settings)) delete d.settings; // réglages illisibles : ceux par défaut
      return d;
    }
  },
  {
    to: 2,
    note: 'type de projet écrit dans le fichier (avant : déduit du contenu à chaque ouverture)',
    run(d) {
      if (isObj(d.settings) && !KINDS[d.settings.kind]) d.settings = { ...d.settings, kind: inferKind(d) };
      return d;
    }
  }
];

/** Erreur d'ouverture d'un projet : code « not-project » ou « too-new » (avec version et supported). */
export class ProjectFormatError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'ProjectFormatError'; this.code = code; Object.assign(this, extra); }
}

/** Version du schéma d'un projet lu : entier ≥ 0 ; absente ou illisible : 0. */
export function versionOf(data) {
  const v = data && data.version;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * Projet amené à la version courante. Rend { data, from, to, applied } : `data` est une copie (l'objet reçu n'est
 * jamais modifié), `applied` la liste des versions franchies. Lève ProjectFormatError :
 *  - « not-project » : ce n'est pas un objet de projet ;
 *  - « too-new » : enregistré par une version plus récente de l'application (rien n'est ouvert).
 * msg : textes des erreurs (traduits par l'appelant) ; migrations, format : pour les tests.
 */
export function migrateProject(raw, { migrations = MIGRATIONS, format = FORMAT, msg = {} } = {}) {
  if (!isObj(raw)) throw new ProjectFormatError('not-project', msg.notProject || 'ce fichier n’est pas un projet Jollof Studio');
  const from = versionOf(raw);
  if (from > format) {
    throw new ProjectFormatError('too-new', (msg.tooNew || 'ce projet a été enregistré avec une version plus récente de Jollof Studio (format {0}, cette version lit jusqu’au format {1}). Mettez l’application à jour pour l’ouvrir : rien n’a été modifié.').replace('{0}', from).replace('{1}', format), { version: from, supported: format });
  }
  let data = { ...raw };
  if (isObj(raw.settings)) data.settings = { ...raw.settings };
  const applied = [];
  for (const m of migrations) {
    if (m.to <= from || m.to > format) continue;
    if (m.to !== (applied.length ? applied[applied.length - 1] : from) + 1) throw new Error(`migrations désordonnées : ${m.to} après ${applied.length ? applied[applied.length - 1] : from}`);
    data = m.run(data) || data;
    data.version = m.to;
    applied.push(m.to);
  }
  if ((applied.length ? applied[applied.length - 1] : from) !== format) throw new Error(`aucune migration vers le format ${format}`);
  data.version = format;
  return { data, from, to: format, applied };
}

/** Le projet peut-il être ouvert par cette application ? (sans rien migrer) */
export const canOpen = (data, format = FORMAT) => isObj(data) && versionOf(data) <= format;
