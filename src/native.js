// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pont entre l'interface et le cœur Rust. Dans l'application Tauri, tout passe
// par les commandes natives et les boîtes de dialogue du système. Lancé dans un
// simple navigateur (`npm run dev`), chaque fonction a un repli web.
import { invoke, Channel, convertFileSrc } from '@tauri-apps/api/core';
import { tl } from './i18n/index.js';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const baseName = p => p.split(/[\\/]/).pop();
// Boîtes de dialogue affichées par Rust : seuls les chemins choisis là peuvent ensuite être lus ou écrits.
const pickSave = (name, label, extensions) => invoke('pick_save', { name, label, extensions });
const pickOpen = (label, extensions) => invoke('pick_open', { label, extensions });

/*
 * Fichiers choisis par l'utilisateur, lus et écrits par Rust (src-tauri/src/files.rs) : jusqu'à BIG octets en un
 * appel (écriture atomique) ; au-delà (projet avec fonds de plan, export DXF de plusieurs dizaines de Mo) par
 * morceaux de CHUNK octets, dans un fichier temporaire du même dossier renommé sur la cible à la fin : un échec
 * laisse l'ancien fichier intact.
 */
const BIG = 4 << 20, CHUNK = 8 << 20;
async function writeBlob(path, blob) {
  if (blob.size <= BIG) { await invoke('save_bytes', new Uint8Array(await blob.arrayBuffer()), { headers: { 'x-path': encodeURIComponent(path) } }); return; }
  const id = await invoke('file_write_begin', { path });
  try {
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const part = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + CHUNK)).arrayBuffer());
      await invoke('file_write_chunk', part, { headers: { 'x-id': String(id), 'x-pos': String(pos) } });
    }
    await invoke('file_write_commit', { id, size: blob.size });
  } catch (e) { invoke('file_write_abort', { id }).catch(() => {}); throw e; }
}
/** Texte UTF-8 d'un fichier autorisé ; un gros fichier arrive par morceaux (pas de limite de taille d'un seul appel). */
async function readTextFile(path) {
  const size = await invoke('file_size', { path });
  if (size <= BIG) return invoke('read_text', { path });
  const dec = new TextDecoder('utf-8'), parts = [];
  for (let off = 0; off < size;) {
    const r = await invoke('file_read_chunk', { path, offset: off, len: CHUNK });
    const b = r instanceof ArrayBuffer ? new Uint8Array(r) : ArrayBuffer.isView(r) ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : Uint8Array.from(r || []);
    if (!b.length) break;
    parts.push(dec.decode(b, { stream: true })); off += b.length;
  }
  parts.push(dec.decode());
  return parts.join('');
}
const notAllowed = e => /non autorisé/.test(String((e && e.message) || e));

function browserDownload(data, name) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function browserPick(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => {
      const f = input.files[0]; if (!f) return resolve(null);
      f.text().then(text => resolve({ path: null, name: f.name, text }));
    };
    input.click();
  });
}

/** Enregistre un projet. Renvoie le chemin choisi, ou null si l'utilisateur annule. */
export async function saveProject(json, currentPath, suggested) {
  if (!isTauri()) { browserDownload(new Blob([json], { type: 'application/json' }), suggested); return { path: null, name: suggested }; }
  const blob = new Blob([json], { type: 'application/json' });
  let path = currentPath;
  if (path) { try { await writeBlob(path, blob); return { path, name: baseName(path) }; } catch (e) { if (!notAllowed(e)) throw e; path = null; } } // emplacement plus autorisé : on redemande
  path = await pickSave(suggested, tl('Projet Jollof Studio'), ['jollof']);
  if (!path) return null;
  await writeBlob(path, blob);
  return { path, name: baseName(path) };
}
export async function openProject() {
  if (!isTauri()) return browserPick('.jollof,.json');
  const path = await pickOpen(tl('Projet Jollof Studio'), ['jollof', 'json']);
  if (!path) return null;
  return { path, name: baseName(path), text: await readTextFile(path) };
}

/**
 * Enregistre la vidéo exportée : `video.blob` (rendu en mémoire, octets bruts vers Rust) ou `video.file` (rendu déjà
 * écrit dans le cache par renderSink, que Rust copie).
 */
export async function saveVideo(video, suggested) {
  if (!isTauri()) { browserDownload(video.blob, suggested); return suggested; }
  const ext = suggested.split('.').pop();
  const path = await pickSave(suggested, tl('Vidéo'), [ext]);
  if (!path) return null;
  if (video.file) { await invoke('render_save', { path }); return path; }
  await writeBlob(path, video.blob);
  return path;
}

/**
 * Rendu vidéo écrit au fil de l'eau dans le cache de l'application (Tauri) : un WritableStream qui reçoit les
 * morceaux { type: 'write', data, position } du multiplexeur. Rend { path, url (lecture par le protocole asset:),
 * writable, end(), discard() }, ou null hors de l'application (le rendu reste en mémoire).
 */
export async function renderSink() {
  if (!isTauri()) return null;
  const path = await invoke('render_begin');
  const writable = new WritableStream({
    write: chunk => invoke('render_write', chunk.data, { headers: { 'x-pos': String(chunk.position) } })
  });
  return {
    path, writable,
    url: () => convertFileSrc(path),
    end: () => invoke('render_end'),
    discard: () => invoke('render_discard').catch(() => {})
  };
}

/** Enregistre un fichier (PDF, DXF, CSV, SVG, HTML…) par la boîte « Enregistrer sous » du système (nom proposé, filtre
 * de l'extension) ; téléchargement dans un navigateur. Rend le chemin, ou null si l'utilisateur annule. */
export async function saveFile(blob, suggested, label, ext) {
  if (!isTauri()) { browserDownload(blob, suggested); return suggested; }
  const path = await pickSave(suggested, label, [ext]);
  if (!path) return null;
  await writeBlob(path, blob);
  return path;
}

/* Bibliothèque personnelle : composants importés (.glb + broches). */
const LS_KEY = 'jollof-studio-user-library';
const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } };
export async function libraryList() {
  if (!isTauri()) return lsRead();
  const items = await invoke('library_list');
  return items.map(t => { try { return JSON.parse(t); } catch { return null; } }).filter(Boolean);
}
export async function librarySave(item) {
  if (!isTauri()) {
    const all = lsRead().filter(i => i.id !== item.id); all.push(item);
    localStorage.setItem(LS_KEY, JSON.stringify(all)); return;
  }
  await invoke('library_save', { id: item.id, json: JSON.stringify(item) });
}
export async function libraryDelete(id) {
  if (!isTauri()) { localStorage.setItem(LS_KEY, JSON.stringify(lsRead().filter(i => i.id !== id))); return; }
  await invoke('library_delete', { id });
}

/* Sauvegarde automatique du projet en cours. Dans l'application : un fichier du dossier de données,
   écrit de façon atomique par Rust, sans limite de taille. Dans un navigateur : le stockage local
   (quelques Mo au plus ; au-delà, la sauvegarde est sautée, signalée une fois dans la console). */
const AUTOSAVE_KEY = 'jollof-studio-autosave';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsDrop = k => { try { localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } };
const utf8 = s => new TextEncoder().encode(s);
// Réponse binaire de Rust : ArrayBuffer, ou tableau d'octets quand l'IPC passe par son repli.
const fromUtf8 = b => (b == null ? '' : new TextDecoder().decode(b instanceof ArrayBuffer || ArrayBuffer.isView(b) ? b : Uint8Array.from(b)));
let autosaveWarned = false;
function autosaveFailed(e) {
  if (autosaveWarned) return;
  autosaveWarned = true;
  console.warn(tl('Sauvegarde automatique impossible'), e);
}
let awNext = null, awRun = null;
/**
 * Écrit la sauvegarde automatique (texte JSON), sans jamais bloquer l'interface. Les écritures ne se
 * chevauchent pas : pendant qu'une écriture est en cours, seule la demande la plus récente attend son
 * tour. La promesse est tenue (jamais rompue) quand ce contenu, ou un plus récent, est écrit.
 */
export function autosaveWrite(json) {
  if (!isTauri()) {
    try { localStorage.setItem(AUTOSAVE_KEY, json); } catch (e) { autosaveFailed(e); } // projet trop lourd pour le stockage local
    return Promise.resolve();
  }
  awNext = json;
  if (!awRun) awRun = (async () => {
    while (awNext != null) {
      const data = awNext; awNext = null;
      // Corps binaire brut : pas de second encodage JSON de plusieurs mégaoctets.
      try { await invoke('autosave_write', utf8(data)); autosaveWarned = false; } catch (e) { autosaveFailed(e); }
    }
    awRun = null;
  })();
  return awRun;
}
/**
 * Contenu de la sauvegarde automatique, ou null. Dans l'application, une sauvegarde laissée dans le
 * stockage local par une version précédente est reprise (écrite dans le fichier natif, puis effacée).
 */
export async function autosaveRead() {
  if (!isTauri()) return lsGet(AUTOSAVE_KEY);
  const old = lsGet(AUTOSAVE_KEY);
  let text;
  try { text = fromUtf8(await invoke('autosave_read')); } catch (e) { console.error(e); return old; } // fichier illisible : on n'écrase rien
  if (text) { if (old != null) lsDrop(AUTOSAVE_KEY); return text; }
  if (!old) return null;
  if (!awRun) { // migration (sauf si une écriture plus récente est déjà en cours)
    try { await invoke('autosave_write', utf8(old)); lsDrop(AUTOSAVE_KEY); } catch (e) { autosaveFailed(e); }
  }
  return old;
}
/** Efface la sauvegarde automatique (et celle d'une version précédente, dans le stockage local). */
export async function autosaveClear() {
  lsDrop(AUTOSAVE_KEY);
  if (!isTauri()) return;
  awNext = null;
  if (awRun) await awRun;
  await invoke('autosave_clear');
}

/* arduino-cli, lancé par Rust : téléversement sur une carte réelle (édition Pro) et compilation pour l'émulateur. */
export async function arduinoCli(args) {
  if (!isTauri()) throw new Error('desktop-only');
  return invoke('arduino_cli', { args });
}
/** Écrit le croquis ; opts.shim : avec la cale de l'ESP32 émulé (src/emu/esp32-shim), sinon elle est retirée. */
export async function writeSketch(code, opts = {}) {
  if (!isTauri()) throw new Error('desktop-only');
  return invoke('write_sketch', { code, shim: !!opts.shim });
}
/** Dossiers du croquis et de sa compilation : [sketch, build]. */
export async function buildPaths() {
  if (!isTauri()) throw new Error('desktop-only');
  return invoke('build_paths');
}
/** Programme machine de la dernière compilation (ext : hex, uf2, bin), en octets. */
export async function readBuild(ext) {
  if (!isTauri()) throw new Error('desktop-only');
  const r = await invoke('read_build', { ext });
  return r instanceof ArrayBuffer ? new Uint8Array(r) : new Uint8Array(r);
}
/* Émulateur de l'ESP32 (QEMU d'Espressif, programme à part) : installé à la première utilisation, lancé par Rust. */
const u8 = m => (m instanceof ArrayBuffer ? new Uint8Array(m) : ArrayBuffer.isView(m) ? new Uint8Array(m.buffer, m.byteOffset, m.byteLength) : Uint8Array.from(m));
/** { installed, available (paquet publié pour cette plateforme), dev, version, platform, chips (puces que l'émulateur installé fait tourner), desktop }. */
export async function qemuStatus() {
  if (!isTauri()) return { installed: false, available: false, desktop: false };
  try { return { ...(await invoke('qemu_status')), desktop: true }; } catch (e) { return { installed: false, available: false, desktop: true, error: String(e) }; }
}
/** Télécharge et installe l'émulateur ; onProgress(octets reçus, total ou 0). Rend le nouvel état. */
export async function qemuInstall(onProgress) {
  const ch = new Channel();
  ch.onmessage = p => { if (onProgress) onProgress(p[0], p[1]); };
  return { ...(await invoke('qemu_install', { onProgress: ch })), desktop: true };
}
/**
 * Transport du moteur ESP32 (src/emu/esp32.js) vers l'émulateur de la carte board, lancé par Rust : image de la
 * flash, puis messages horodatés (en ms depuis le lancement) du port série, de la cale et de la trace des registres.
 */
export function qemuTransport(id) {
  // Clé de la carte côté Rust : lettres, chiffres, - et _ (un projet importé peut avoir d'autres identifiants).
  const board = String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'carte';
  const ch = fn => { const c = new Channel(); c.onmessage = fn; return c; };
  const stamped = fn => m => { const b = u8(m); if (b.length < 4) return; fn(((b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0) / 100, b.subarray(4)); };
  return {
    async start({ image, chip = 'esp32', onUart, onSide, onTrace, onExit }) {
      await invoke('qemu_flash', image, { headers: { 'x-board': board, 'x-chip': chip } });
      await invoke('qemu_start', {
        board, chip, onUart: ch(stamped(onUart)), onSide: ch(stamped(onSide)),
        onTrace: ch(m => {
          const b = u8(m), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), recs = [];
          for (let o = 0; o + 12 <= b.length; o += 12) recs.push([dv.getUint32(o, true), dv.getUint32(o + 4, true), dv.getUint32(o + 8, true) / 100]);
          onTrace(recs);
        }),
        onExit: ch(e => onExit(e.code, e.log))
      });
    },
    uart: bytes => { invoke('qemu_input', { board, port: 0, bytes: Array.from(bytes) }).catch(() => {}); },
    side: bytes => { invoke('qemu_input', { board, port: 1, bytes: Array.from(bytes) }).catch(() => {}); },
    stop: () => { invoke('qemu_stop', { board }).catch(() => {}); }
  };
}
/** Langue choisie à l'installation (Windows), sinon null. */
export async function installLanguage() {
  if (!isTauri()) return null;
  try { return await invoke('install_language'); } catch (e) { return null; }
}
/** Ouvre un lien http(s) dans le navigateur du système (dans l'application installée) ou un nouvel onglet. */
export async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) return;
  if (!isTauri()) { window.open(url, '_blank', 'noopener'); return; }
  try { await invoke('open_external', { url }); } catch (e) { console.error(e); }
}

/* ---------- Projet ouvert par le système (double-clic sur un .jollof) ---------- */
/** Projet reçu du système et pas encore ouvert : { path, name, text }, ou null. */
export async function takeLaunchFile() {
  if (!isTauri()) return null;
  try {
    const path = await invoke('take_launch_file'); if (!path) return null;
    return { path, name: baseName(path), text: await readTextFile(path) };
  } catch (e) { console.warn(e); return null; }
}
/** fn() à chaque projet reçu pendant que l'application tourne (deuxième lancement, Finder) ; il se prend par takeLaunchFile. */
export async function onLaunchFile(fn) {
  if (!isTauri()) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen('open-file', () => fn());
}

/* ---------- Journal (fichier tournant écrit par Rust) ---------- */
/** Message de la fenêtre vers le journal : level error | warn | info. */
export function logToFile(level, message) {
  if (!isTauri()) return;
  invoke('log_js', { level, message: String(message).slice(0, 4000) }).catch(() => {});
}
export async function openLogDir() {
  if (!isTauri()) return;
  await invoke('open_log_dir');
}

/* ---------- Automate : export PLCopen XML, serveur Modbus TCP ---------- */
/** Programme Ladder + table des variables → { xml, notes } (application seulement). */
export async function plcExportXml(program, vars) {
  if (!isTauri()) throw new Error('desktop-only');
  return invoke('plc_export_xml', { program, vars });
}
/** Démarre le serveur Modbus TCP ; onWrite({ addr, value }) pour chaque bobine écrite par un client. */
export async function modbusStart(port, lan, onWrite) {
  if (!isTauri()) throw new Error('desktop-only');
  const ch = new Channel(); ch.onmessage = m => onWrite(m);
  return invoke('modbus_start', { port, lan, onWrite: ch });
}
export async function modbusStop() { if (isTauri()) await invoke('modbus_stop'); }
export function modbusImage(img) { return invoke('modbus_image', img); }

/* ---------- ESP32 : téléversement par espflash (sans esptool) ---------- */
/** Puce branchée sur le port : { chip, revision, flash, mac, features }. */
export async function espDetect(port) {
  if (!isTauri()) throw new Error('desktop-only');
  return invoke('esp_detect', { port });
}
/** Écrit la dernière image compilée ; onProgress({ stage, done, total, skipped }). */
export async function espFlash(port, fqbn, onProgress) {
  if (!isTauri()) throw new Error('desktop-only');
  const ch = new Channel(); ch.onmessage = p => { if (onProgress) onProgress(p); };
  return invoke('esp_flash', { port, fqbn, onProgress: ch });
}

/* ffmpeg à côté de l'application (src-tauri/src/ffmpeg.rs) : masters ProRes/DNxHR, repli du rendu web. */
let ffInfo;
/** { version, lgpl, encoders[] } ou null (navigateur, ou ffmpeg absent). Mis en cache. */
export function ffmpegInfo() {
  if (!isTauri()) return Promise.resolve(null);
  if (!ffInfo) ffInfo = invoke('ffmpeg_info').catch(() => null);
  return ffInfo;
}
/** Son (WAV) ou sous-titres (SRT) du prochain master. */
export const masterAux = (kind, bytes) => invoke('master_aux', bytes, { headers: { 'x-kind': kind } });
/** opts : { width, height, fpsNum, fpsDen, codec: 'prores'|'dnxhr'|'web', audio, subs, title, lang }. Rend l'extension. */
export const masterBegin = opts => invoke('master_begin', { opts });
export const masterFrame = bytes => invoke('master_frame', bytes);
export const masterEnd = () => invoke('master_end');
export const masterAbort = () => invoke('master_abort').catch(() => {});
/** Adresse de lecture d'un rendu du cache (protocole asset:). */
export const fileUrl = path => convertFileSrc(path);
