// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export DWG de la conception (chargé à la demande) : le plan est écrit en DXF par dxfexport.js (mêmes calques, blocs,
// attributs et coordonnées que l'export DXF), puis converti en DWG par le convertisseur installé sur l'ordinateur
// (ODA File Converter, ou dxf2dwg de LibreDWG s'il est déjà là ; src-tauri/src/cad.rs) et écrit à l'emplacement choisi.
// Rien de GPL n'est livré : sans convertisseur, la marche à suivre s'affiche (dwg.js showDwgHelp). Version web : non
// disponible, expliqué.
//
// exportDwg(ctx, { version: '2018'|'2013'|…|'2000', floor }) → { path, dwg, converter, … } | null
import { tl, CANCEL } from '../../i18n/index.js';
import { fileBase } from './design-util.js';

const KEY = 'jollof-dwg-version';
const slug = s => String(s || '').replace(/[\\/:*?"<>|\s·]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const remembered = () => { try { return localStorage.getItem(KEY) || '2018'; } catch (e) { return '2018'; } };
const remember = v => { try { localStorage.setItem(KEY, v); } catch (e) { /* stockage indisponible */ } };

/** Boîte du choix de la version DWG ; rend l'année, ou null si annulée. */
async function askVersion(D, writer) {
  const { dialog } = await import('../../school/ui.js');
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const cur = remembered(), lib = writer.id === 'libredwg';
  const opts = D.DWG_VERSIONS.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${esc(tl('DWG {0}', y))}${y === '2018' ? ' — ' + esc(tl('AutoCAD 2018 et suivants')) : y === '2013' ? ' — ' + esc(tl('AutoCAD 2013 à 2017')) : y === '2000' ? ' — ' + esc(tl('lu par tous les logiciels')) : ''}</option>`).join('');
  const body = `<label class="sField"><span>${esc(tl('Version du fichier DWG'))}</span><select class="sInput" data-v>${opts}</select></label>
    <p class="dlgText mut">${esc(tl('Convertisseur : {0}', writer.name + (writer.version ? ' ' + writer.version : '')))}</p>
    ${lib ? `<p class="dlgText mut">${esc(tl('dxf2dwg (LibreDWG) n’écrit que les DWG 2000 et 2004 : une version plus récente donne un DWG 2000.'))}</p>` : ''}`;
  return dialog({
    title: tl('Exporter en DWG'), head: { icon: 'download', sub: tl('Le plan en DXF, converti par le convertisseur installé') }, width: 460, body,
    actions: [{ label: CANCEL, value: null }, { label: tl('Exporter…'), value: 'ok', kind: 'primary' }],
    onAction: (v, root) => (v === 'ok' ? root.querySelector('[data-v]').value : undefined)
  });
}

export async function exportDwg(ctx, o = {}) {
  const D = await import('../cad/dwg.js');
  if (!D.isDesktop()) { await D.showDwgHelp({ web: true, export: true }); return null; }
  let writers = await D.dwgWriters();
  if (!writers.length) {
    if (!(await D.showDwgHelp({ export: true }))) return null;
    writers = await D.dwgWriters(); if (!writers.length) return null;
  }
  const { designDxf } = await import('../dxfexport.js');
  const data = ctx.data();
  const r = designDxf(data, { floors: o.floor ? [o.floor] : undefined });
  if (!r.floors) { ctx.status(tl('Aucun étage à exporter : dessinez-les dans la vue Plans.'), 'warn'); return null; }
  let version = o.version ? String(o.version) : await askVersion(D, writers[0]);
  if (!version) return null;
  if (!D.DWG_VERSIONS.includes(version)) version = '2018';
  remember(version);
  let floorName = '';
  if (o.floor) for (const b of (data.site && data.site.buildings) || []) for (const f of b.floors || []) if (f.id === o.floor) floorName = f.name || f.id;
  const path = await D.pickDwgSave(`${fileBase(ctx)}${floorName ? '-' + slug(floorName) : ''}.dwg`);
  if (!path) return null;
  const { task } = await import('./kit/index.js');
  const label = tl('Export DWG');
  let res;
  try {
    res = await task(label, t => D.saveDwg(r.text, {
      path, version, signal: t.signal,
      onProgress: p => t.progress(p.stage === 'upload' ? p.f : null, p.stage === 'convert' ? tl('Conversion : {0} s', Math.round(p.ms / 1000)) : p.stage === 'save' ? tl('Enregistrement…') : null)
    }), { cancel: true, quiet: true });
  } catch (e) {
    if (e && e.name === 'AbortError') { ctx.status(tl('Export DWG annulé.'), 'warn'); return null; }
    if (e && e.code === 'noconverter') { await D.showDwgHelp({ export: true }); return null; }
    ctx.status(tl('Export DWG impossible : {0}', (e && e.message) || e), 'err');
    return null;
  }
  const older = res.dwg !== version;
  ctx.status(older
    ? tl('DWG {0} enregistré (au lieu de {1} : limite du convertisseur) : {2}', res.dwg, version, res.path)
    : tl('DWG {0} enregistré : {1}', res.dwg, res.path), older ? 'warn' : 'ok');
  return { ...res, floors: r.floors, under: r.under, units: r.units };
}
