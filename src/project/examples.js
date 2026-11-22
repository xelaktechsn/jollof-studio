// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Exemples livrés avec l'application (dossier exemples/) : liste, version anglaise, grands exemples chargés à
// l'ouverture. Sorti de main.js tel quel (même ordre, mêmes objets) : { file, data, load? }.
import { tl, isEn } from '../i18n/index.js';

/** Projets du dossier exemples/, intégrés à l'application. */
export const EXAMPLES = Object.entries(import.meta.glob('../../exemples/*.jollof', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => ({ file: path.split('/').pop(), data: localizeExample(JSON.parse(text)) }))
  .concat(lazyExamples());

/**
 * Grands exemples (exemples/pro : un bâtiment entier, plusieurs centaines de kilo-octets) : seule leur fiche (.meta.json,
 * nom et description) est lue au démarrage ; le projet se charge à l'ouverture (load), pour garder le démarrage rapide.
 */
function lazyExamples() {
  const meta = import.meta.glob('../../exemples/pro/*.meta.json', { import: 'default', eager: true });
  const files = import.meta.glob('../../exemples/pro/*.jollof', { query: '?raw', import: 'default' });
  return Object.keys(files).sort().map(path => {
    const m = meta[path.replace(/\.jollof$/, '.meta.json')] || {};
    return { file: path.split('/').pop(), load: files[path], data: localizeExample({ name: m.name || path.split('/').pop(), description: m.description || '', en: m.en, comps: [], wires: [], settings: { kind: m.kind || 'net' } }) };
  });
}

/** Exemple dans la langue de l'interface : le fichier peut porter sa version anglaise (champ « en »). */
export function localizeExample(d) {
  const en = d.en; delete d.en;
  if (!isEn) return d;
  const out = { ...d, name: (en && en.name) || tl(d.name), description: (en && en.description) || tl(d.description || ''), wires: (d.wires || []).map(w => (w.role ? { ...w, role: tl(w.role) } : w)) };
  if (en && en.code && d.settings && d.settings.prog) {
    const prog = JSON.parse(JSON.stringify(d.settings.prog));
    for (const [id, code] of Object.entries(en.code)) if (prog.boards && prog.boards[id]) prog.boards[id].code = Array.isArray(code) ? code.join('\n') : code;
    out.settings = { ...d.settings, prog };
  }
  return out;
}
