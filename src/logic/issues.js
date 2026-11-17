// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérifications du circuit logique : entrées en l'air, fils ou étiquettes de largeurs différentes, sorties en conflit,
// oscillation, repères en double. La même liste sert à l'onglet Circuit (panel.js, section « Vérifications ») et au
// vérificateur du projet (src/check, panneau Problèmes et rapport) par index.js, sous les codes J08xx :
//   J0801 (erreur) le circuit ne peut pas fonctionner tel quel ; J0802 entrée non reliée ; J0803 repère en double.
import { tl } from '../i18n/index.js';
import { DEFS, propsOf, layoutOf, pinKeys } from './elements.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Nom d'un élément : son repère, sinon la broche qu'il représente dans un bloc, sinon le nom de son type. */
export const elementName = e => String(propsOf(e).label || '') || (e.type === 'block' && e.p && e.p.io ? e.p.io.t : DEFS[e.type].name());

/**
 * C : circuit affiché (racine ou bloc ouvert) ; sim : LogicSim de ce circuit.
 * Rend [{ code, kind: 'err' | 'warn', id (élément en cause, ou null), text (brut), html (noms en gras) }].
 */
export function logicIssues(C, sim) {
  const out = [];
  // bold : rangs des arguments mis en gras dans la version HTML (les nombres restent tels quels).
  const item = (code, kind, id, key, args = [], bold = []) => out.push({
    code, kind, id,
    text: tl(key, ...args.map(String)),
    html: tl(key, ...args.map((a, i) => (bold.includes(i) ? `<b>${esc(a)}</b>` : esc(String(a)))))
  });
  const seen = new Set();
  for (const f of sim.floating()) {
    const e = C.elements.find(x => x.id === f.id); if (!e) continue;
    // Bit d'une broche de bus : la broche entière (D pour D0…D3 en bus, A pour A#2 d'un bloc).
    const q = layoutOf(e).pins.find(p => pinKeys(p).includes(f.pin)), pn = q ? q.name : f.pin;
    if (seen.has(f.id + pn)) continue; seen.add(f.id + pn);
    item('J0802', 'warn', e.id, '{0} : l’entrée {1} n’est reliée à rien (niveau inconnu).', [elementName(e), pn], [0, 1]);
  }
  if (sim.badTunnels.size) item('J0801', 'err', null, 'Étiquettes de même nom mais de largeurs différentes : {0}. Seuls les premiers bits sont reliés.', [[...sim.badTunnels].join(', ')], [0]);
  if (sim.truncated) item('J0801', 'err', null, 'Circuit trop grand une fois les blocs dépliés : certains blocs ne sont pas simulés.');
  if (sim.bad.size) item('J0801', 'err', null, '{0} fil(s) entre des broches de largeurs différentes (un bus et un fil simple, ou deux bus) : ils ne transmettent rien.', [sim.bad.size]);
  if (sim.conflicts.size) item('J0801', 'err', null, '{0} fil(s) reliant des sorties qui se contredisent (X, en rouge).', [sim.conflicts.size]);
  if (sim.osc) item('J0801', 'err', null, 'Le circuit oscille : une boucle ne trouve pas d’état stable.');
  const labels = new Map();
  for (const e of C.elements) { const l = String((e.p && e.p.label) || '').trim(); if (l && e.type !== 'tunnel') labels.set(l, (labels.get(l) || 0) + 1); }
  for (const [l, n] of labels) if (n > 1) item('J0803', 'warn', null, 'Le repère {0} est utilisé {1} fois : chaque entrée et sortie doit avoir un nom différent.', [l, n], [0]);
  return out;
}
