// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import des résultats d'un vrai certificateur (chargé à la demande) : choix du fichier exporté (CSV, texte, XML), compte
// rendu de lecture (colonnes reconnues, colonnes ignorées), rattachement des enregistrements aux liens du plan (automatique
// par l'identifiant du câble, à la main pour le reste), puis rangement dans data.measured — à part des résultats simulés.
// Points d'entrée : openMeasuredImport(ctx, { file? }), clearMeasured(ctx).
import './xlsxui.css';
import './measured.css';
import { tl, CANCEL } from '../../i18n/index.js';
import { parseTesterExport, matchResults } from '../interop/linkware.js';
import { linkCandidates } from '../measuredmap.js';
import { storeMeasured } from '../measured.js';
import { verdictText } from '../certify.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ui = () => import('../../school/ui.js');
function pick() {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.txt,.xml,.tsv,text/csv,text/plain,text/xml';
    inp.onchange = () => resolve(inp.files && inp.files[0] || null); inp.click();
  });
}
export const errorText = e => ({
  flw: () => tl('Ce fichier est le format natif du logiciel du testeur (binaire, propriétaire) : il n’est pas lu. Dans ce logiciel, exportez les résultats en CSV, en texte ou en XML, puis importez ce fichier-là.'),
  header: () => tl('Ligne d’en-tête introuvable : le fichier doit avoir une colonne d’identifiant de câble (« Cable ID »).'),
  verdict: () => tl('Aucune colonne de résultat (« Summary », « Result », PASS/FAIL) dans ce fichier.'),
  xml: () => tl('Fichier XML illisible.'), empty: () => tl('Fichier vide.')
}[e] || (() => String(e)))();

/** Ouvre l'import. Rend le nombre de résultats rangés (0 : annulé ou rien de lisible). */
export async function openMeasuredImport(ctx, o = {}) {
  const file = o.file || await pick(); if (!file) return 0;
  const bytes = new Uint8Array(await file.arrayBuffer()), { results, report } = parseTesterExport(bytes, file.name);
  const { dialog } = await ui();
  if (report.error || !results.length) {
    await dialog({ title: tl('Importer des résultats de testeur'), head: { icon: 'upload', sub: file.name }, width: 520, body: `<div class="ntXl"><p class="ntXlWarn">${esc(report.error ? errorText(report.error) : tl('Aucun enregistrement lisible ({0} lignes sans identifiant ou sans résultat).', report.skipped))}</p></div>`, actions: [{ label: tl('Fermer'), value: null, kind: 'primary' }] });
    return 0;
  }
  const data = ctx.data(), cands = linkCandidates(data), m0 = matchResults(results, cands);
  const todo = new Set([...m0.unmatched, ...m0.ambiguous]);
  const opts = `<option value="">${esc(tl('— ne pas rattacher —'))}</option>` + cands.map(c => `<option value="${esc(c.link)}">${esc(c.label)}${c.kind === 'ch' ? ' · ' + esc(tl('canal')) : ''}</option>`).join('');
  const rowsHtml = m0.results.filter(r => todo.has(r.cableId)).slice(0, 400).map(r => `<tr><td></td><td><b>${esc(r.cableId)}</b><small>${esc(r.limit || '')}</small></td><td>${verdictText(r.verdict)}</td><td>${r.len ?? ''}</td><td><select class="sel" data-map="${esc(r.cableId)}">${opts}</select></td></tr>`).join('');
  const body = `<div class="ntXl ntMs">
    <p class="ntXlNote">${esc(tl('{0} enregistrements lus ({1}), {2} rattachés d’eux-mêmes à un lien du plan par leur identifiant de câble, {3} à rattacher.', results.length, report.format.toUpperCase(), results.length - todo.size, todo.size))}${report.skipped ? ' ' + esc(tl('{0} lignes ignorées (sans identifiant ou sans résultat).', report.skipped)) : ''}</p>
    <p class="ntXlWarn">${esc(tl('Lecteur à valider avec un export réel : la liste des colonnes n’est pas publiée par le fabricant. Vérifiez quelques lignes contre le rapport du testeur.'))}</p>
    ${report.unknown.length ? `<details class="ntMsUnk"><summary>${esc(tl('{0:# colonne ignorée|# colonnes ignorées}', report.unknown.length))}</summary><p>${report.unknown.map(esc).join(' · ')}</p></details>` : ''}
    ${todo.size ? `<div class="ntXlTbl"><table><thead><tr><th></th><th>${esc(tl('Identifiant du testeur'))}</th><th>${esc(tl('Résultat'))}</th><th>${esc(tl('Longueur (m)'))}</th><th>${esc(tl('Lien du plan'))}</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` : ''}
    <p class="ntXlNote">${esc(tl('Les résultats mesurés sont rangés à part des résultats simulés et toujours nommés « mesuré ». Un enregistrement non rattaché est gardé avec son identifiant.'))}</p></div>`;
  const map = await dialog({ title: tl('Importer des résultats de testeur'), head: { icon: 'upload', sub: file.name }, body, width: 680, cls: 'ntXlDlg', actions: [{ label: CANCEL, value: null }, { label: tl('Importer {0:# résultat|# résultats}', results.length), value: 'ok', kind: 'primary' }],
    onAction: (v, root) => { if (v !== 'ok') return undefined; const mp = {}; for (const s of root.querySelectorAll('[data-map]')) mp[s.dataset.map] = s.value; return mp; } });
  if (!map) return 0;
  const done = matchResults(results, cands, map);
  storeMeasured(ctx.data(), done.results, { file: file.name });
  ctx.commit();
  ctx.status(tl('{0:# résultat mesuré importé|# résultats mesurés importés} ({1} rattachés à un lien). Ctrl+Z pour annuler.', done.results.length, done.results.filter(r => r.link).length), 'ok');
  return done.results.length;
}
/** Retire tous les résultats mesurés du projet (une étape d'annulation). */
export function clearMeasured(ctx) {
  if (!ctx.data().measured) return false;
  delete ctx.data().measured; ctx.commit(); ctx.status(tl('Résultats mesurés retirés (Ctrl+Z pour annuler).'), 'ok');
  return true;
}
