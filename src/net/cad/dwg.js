// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pont DWG → DXF (chargé à la demande) : l'application de bureau fait convertir le DWG par un convertisseur installé
// sur l'ordinateur (ODA File Converter de préférence, sinon dwg2dxf de LibreDWG s'il est déjà là ; voir
// src-tauri/src/cad.rs), puis lit le DXF par morceaux : un flux d'octets, jamais une chaîne entière (un DXF fait
// facilement plusieurs centaines de Mo). La version web n'ouvre que le DXF : showDwgHelp() l'explique.
//
// API (stable, utilisée par l'assistant d'import) :
//   canConvertDwg() → bool ; dwgConverters() → [{ id: 'oda'|'libredwg', name, path, version }]
//   pickDwg() → { path, name } | null (boîte « Ouvrir » du système ; le chemin devient lisible par Rust)
//   convertDwg(src, { onProgress, signal, converter, timeoutS }) → { dxf: ReadableStream<Uint8Array>, size, name,
//     converter, version, ms, warning, cleanup() }
//     src : chemin (rendu par pickDwg) ou File/Blob (glissé dans la fenêtre : envoyé par morceaux).
//     onProgress({ stage: 'upload'|'copy'|'convert'|'done', f: 0..1 | null (indéterminé), ms, bytes, total })
//     Erreurs : err.code 'web' (navigateur), 'noconverter', 'aborted' (err.name 'AbortError'), 'failed'.
//     Le dossier temporaire s'efface quand le flux est lu jusqu'au bout ou annulé ; cleanup() le fait aussi (sans
//     risque si déjà fait).
//   showDwgHelp({ web }) → Promise<bool> : marche à suivre quand rien ne convertit ; true si un convertisseur est
//     trouvé en cherchant à nouveau.
import { tl } from '../../i18n/index.js';

const CHUNK = 8 << 20; // octets lus ou envoyés par appel
export const ODA_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/* Pont Tauri (invoke, Channel), importé à la demande ; remplaçable dans les tests. */
let bridge = null;
async function api() {
  if (!bridge) {
    const core = await import('@tauri-apps/api/core');
    bridge = { invoke: core.invoke, Channel: core.Channel, desktop: isDesktop };
  }
  return bridge;
}
/** Tests : { invoke(cmd, args, opts), Channel (classe avec onmessage), desktop() }. null rétablit le vrai pont. */
export function _setBridge(b) { bridge = b; convCache = null; }

const fail = (code, msg) => Object.assign(new Error(msg), { code });
const aborted = () => { const e = fail('aborted', tl('Conversion annulée')); e.name = 'AbortError'; return e; };
const u8 = r => (r instanceof Uint8Array ? r : r instanceof ArrayBuffer ? new Uint8Array(r) : ArrayBuffer.isView(r) ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : Uint8Array.from(r || []));
const baseName = p => String(p).split(/[\\/]/).pop();

/** Nom de fichier DWG ? */
export const isDwgName = name => /\.dwg$/i.test(String(name || ''));

let convCache = null;
/** Convertisseurs installés (mis en cache ; refresh pour chercher à nouveau). [] dans le navigateur. */
export async function dwgConverters({ refresh = false } = {}) {
  const b = await bridgeIfDesktop();
  if (!b) return [];
  if (!convCache || refresh) convCache = b.invoke('cad_converters').then(l => (Array.isArray(l) ? l : []), () => []);
  return convCache;
}
async function bridgeIfDesktop() {
  if (bridge) return bridge.desktop() ? bridge : null;
  return isDesktop() ? api() : null;
}
/** Un DWG peut-il être converti ici ? */
export async function canConvertDwg() { return (await dwgConverters()).length > 0; }

/** Boîte « Ouvrir » du système, filtrée sur .dwg. { path, name } ou null si annulée. */
export async function pickDwg() {
  const b = await bridgeIfDesktop();
  if (!b) throw fail('web', tl('La version web n’ouvre que les fichiers DXF'));
  const path = await b.invoke('pick_open', { label: tl('Dessin DWG'), extensions: ['dwg'] });
  return path ? { path, name: baseName(path) } : null;
}

/**
 * Convertit un DWG en DXF. Voir l'API en tête du fichier.
 */
export async function convertDwg(src, { onProgress, signal, converter = 'auto', timeoutS } = {}) {
  const b = await bridgeIfDesktop();
  if (!b) throw fail('web', tl('La version web n’ouvre que les fichiers DXF'));
  if (signal && signal.aborted) throw aborted();
  const list = await dwgConverters();
  if (!list.length) throw fail('noconverter', tl('Aucun convertisseur DWG installé'));
  if (converter !== 'auto' && !list.some(c => c.id === converter)) converter = 'auto';
  const isPath = typeof src === 'string';
  if (!isPath && !(src && typeof src.slice === 'function' && typeof src.size === 'number')) throw fail('failed', tl('Fichier DWG introuvable ou illisible'));
  const name = isPath ? baseName(src) : src.name || 'plan.dwg';
  const t0 = Date.now();
  const report = p => { if (onProgress) try { onProgress({ ms: Date.now() - t0, ...p }); } catch (e) { /* rappel de l'appelant */ } };
  const job = await b.invoke('cad_begin');
  let done = false;
  const cleanup = async () => { if (done) return; done = true; try { await b.invoke('cad_cleanup', { job }); } catch (e) { /* déjà effacé */ } };
  const onAbort = () => { b.invoke('cad_cancel', { job }).catch(() => {}); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (!isPath) {
      // Fichier glissé dans la fenêtre : pas de chemin, les octets vont dans le dossier du travail.
      const total = src.size;
      for (let pos = 0; pos < total; pos += CHUNK) {
        if (signal && signal.aborted) throw aborted();
        const part = new Uint8Array(await src.slice(pos, Math.min(total, pos + CHUNK)).arrayBuffer());
        await b.invoke('cad_upload_write', part, { headers: { 'x-job': String(job), 'x-pos': String(pos) } });
        report({ stage: 'upload', f: Math.min(1, (pos + part.length) / total), bytes: pos + part.length, total });
      }
    }
    const ch = new b.Channel();
    ch.onmessage = m => report({ stage: m && m.stage || 'convert', f: m && m.stage === 'done' ? 1 : null, bytes: (m && m.bytes) || 0 });
    let r;
    try {
      r = await b.invoke('cad_convert_dwg', { job, path: isPath ? src : null, converter, timeoutS: timeoutS ?? null, onProgress: ch });
    } catch (e) {
      if (signal && signal.aborted) throw aborted();
      throw fail('failed', String(e && e.message || e));
    }
    if (signal && signal.aborted) throw aborted();
    const size = r.size;
    let pos = 0;
    const dxf = new ReadableStream({
      async pull(ctrl) {
        if (signal && signal.aborted) { ctrl.error(aborted()); await cleanup(); return; }
        let part;
        try { part = u8(await b.invoke('cad_read', { job, offset: pos, len: CHUNK })); } catch (e) { ctrl.error(fail('failed', String(e && e.message || e))); await cleanup(); return; }
        if (!part.length) { ctrl.close(); await cleanup(); return; }
        pos += part.length;
        ctrl.enqueue(part);
        if (pos >= size) { ctrl.close(); await cleanup(); }
      },
      cancel() { return cleanup(); }
    }, { highWaterMark: 1 });
    return { dxf, size, name: name.replace(/\.dwg$/i, '.dxf'), converter: r.converter, version: r.version || null, ms: r.ms, warning: r.warning || null, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/* ---------- Marche à suivre quand le DWG ne peut pas être converti ---------- */
/** Boîte d'aide. web : version navigateur (DXF seulement). Rend true si « Chercher à nouveau » trouve un convertisseur. */
export async function showDwgHelp({ web = !isDesktop() } = {}) {
  const [{ dialog, toast }] = await Promise.all([import('../../school/ui.js'), import('./dwg.css')]);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const p = t => `<p class="dlgText">${t}</p>`;
  if (web) {
    await dialog({
      title: tl('Ouvrir un fichier DWG'), width: 520,
      body: `<div class="ntDwgHelp">${p(tl('Dans la version web, seuls les fichiers DXF s’ouvrent : le format DWG est fermé et doit d’abord être converti.'))}<ol>
        <li>${tl('Dans votre logiciel de DAO (AutoCAD, BricsCAD, DraftSight, LibreCAD…), ouvrez le dessin puis choisissez « Enregistrer sous » au format DXF.')}</li>
        <li>${tl('Importez ensuite ce fichier DXF ici.')}</li></ol>
        ${p(tl('L’application de bureau convertit elle-même les DWG avec ODA File Converter (gratuit) installé sur l’ordinateur.'))}</div>`
    });
    return false;
  }
  const body = `<div class="ntDwgHelp">${p(tl('Le format DWG est fermé : Jollof Studio le fait convertir en DXF par un convertisseur installé sur votre ordinateur. Aucun n’a été trouvé.'))}
    <h4>${tl('Solution 1 : installer ODA File Converter')}</h4>
    <ol><li>${tl('Téléchargez ODA File Converter (gratuit, Open Design Alliance) pour votre système :')} <a href="#" data-oda class="ntDwgLink">${esc(ODA_URL.replace(/^https:\/\//, ''))}</a></li>
      <li>${tl('Installez-le à l’emplacement proposé (Applications sur macOS, Program Files sur Windows).')}</li>
      <li>${tl('Revenez ici et cliquez sur « Chercher à nouveau ».')}</li></ol>
    <h4>${tl('Solution 2 : enregistrer le dessin en DXF')}</h4>
    ${p(tl('Dans AutoCAD, BricsCAD, DraftSight ou LibreCAD, ouvrez le dessin, choisissez « Enregistrer sous » au format DXF, puis importez le fichier DXF.'))}
    ${p(`<span class="ntDwgNote">${tl('Si dwg2dxf (LibreDWG) est déjà installé sur cet ordinateur, Jollof Studio l’utilise aussi.')}</span>`)}</div>`;
  const v = await dialog({
    title: tl('Ouvrir un fichier DWG'), width: 560, body,
    actions: [{ label: tl('Fermer'), value: null }, { label: tl('Chercher à nouveau'), value: 'again', kind: 'primary' }],
    onOpen: root => root.querySelector('[data-oda]').addEventListener('click', async e => {
      e.preventDefault();
      const { openExternal } = await import('../../native.js');
      openExternal(ODA_URL);
    }),
    onAction: async v2 => {
      if (v2 !== 'again') return undefined;
      const list = await dwgConverters({ refresh: true });
      if (list.length) { toast(tl('Convertisseur trouvé : {0}', list[0].name)); return 'found'; }
      toast(tl('Toujours aucun convertisseur DWG'), 'warn');
      return false;
    }
  });
  return v === 'found';
}
