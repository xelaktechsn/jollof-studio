// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Noms sous lesquels un lien du plan peut apparaître dans le fichier d'un testeur (interop/linkware.js, matchResults) :
// étiquette et identifiant de ses câbles, étiquette imposée, étiquette du port de prise ou de panneau à ses extrémités,
// nom de la prise, libellé du lien. Les liens permanents passent avant les canaux (c'est eux que l'on certifie).
import { certLinks, linkLabel } from './certify.js';
import { labeler } from './docs.js';

export function linkCandidates(data, links = certLinks(data)) {
  const L = labeler(data), devs = new Map((data.devices || []).map(d => [d.id, d])), out = [];
  const safe = f => { try { return f() || ''; } catch (e) { return ''; } };
  for (const l of [...links].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pl' ? -1 : 1))) {
    const names = [linkLabel(data, l)];
    for (const c of l.cables) names.push(c.id, c.tag || '', safe(() => L.cable(c)));
    for (const [n, p] of l.ends || []) { const d = devs.get(n); names.push(safe(() => L.of(n, p))); if (d && l.kind === 'pl') names.push(d.tag || ''); }
    // Le nom d'une prise simple désigne son unique lien permanent.
    if (l.kind === 'pl') for (const [n] of l.ends || []) { const d = devs.get(n); if (d && d.type === 'outlet') names.push(d.name); }
    out.push({ link: l.id, kind: l.kind, label: names[0], names: names.filter(Boolean) });
  }
  // Un nom déjà pris par un lien permanent n'est pas redonné à un canal (le canal contient ce lien : ce n'est pas une ambiguïté).
  const taken = new Set(); const k = s => String(s).toLowerCase().replace(/[\s_.\-/\\:()↔]+/g, '');
  for (const c of out) if (c.kind === 'pl') for (const n of c.names) taken.add(k(n));
  for (const c of out) if (c.kind === 'ch') c.names = c.names.filter(n => !taken.has(k(n)));
  return out;
}
