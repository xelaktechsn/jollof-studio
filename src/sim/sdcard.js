// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module carte microSD en SPI (modèle Catalex : régulateur 3,3 V et adaptateur de niveau 74LVC125A, sûr sur 5 V).
// Les fichiers de la carte sont gardés avec le projet (hw.compMem(comp).sd) et partagés par tous les moteurs :
//   - l'interpréteur (src/prog/runtime.js) : bibliothèque SD simulée (SD.begin, SD.open, File…) directement sur les
//     fichiers (createSdLib, plus bas) ;
//   - les processeurs émulés (src/emu/devices/sdcard.js) : la vraie bibliothèque SD (Arduino SD 1.x sur AVR, SdFat 2
//     sous le SD d'arduino-pico) parle à une vraie carte : protocole SPI des cartes SD (commandes, jetons, blocs de
//     512 octets) sur une image FAT16 construite à partir des fichiers au démarrage, relue après les écritures.
// Ce qui est pris en charge : FAT16 seulement (MBR, partition 1 de type 0x06, 512 entrées à la racine, un secteur par
// grappe), noms courts 8.3 en majuscules (pas de noms longs : une entrée LFN écrite par SdFat est ignorée à la relecture,
// le fichier garde son nom court, par exemple TEMPER~1.CSV), dossiers, 512 Ko de fichiers au plus (les grappes au-delà
// sont marquées défectueuses dans la FAT : la carte se dit pleine, comme une vraie). Carte SDHC (adressage par bloc).
// CRC des commandes ignoré, sauf CMD0 et CMD8 dont la bibliothèque envoie le bon.

/** Taille totale des fichiers de la carte (octets). */
export const SD_CAP = 512 * 1024;
const SEC = 512;

/* ---------- Fichiers gardés avec le projet ---------- */
// Format enregistré : mem.sd = { '/LOG.TXT': base64, '/DATA/': '' } (dossier : clé finie par « / »). En mémoire, le
// même contenu décodé, attaché à l'objet sans être énuméré : mem._sd = { files: Map(chemin → { data, len }), dirs: Set }.
const b64enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = s => { try { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } catch { return new Uint8Array(0); } };

/** Nom 8.3 valable (sans chemin) : 1 à 8 caractères, un point, 0 à 3 caractères, jeu des noms courts FAT. */
export const valid83 = n => /^[A-Z0-9_~!#$%&'()@^`{}-]{1,8}(\.[A-Z0-9_~!#$%&'()@^`{}-]{1,3})?$/.test(n);
/** Chemin normalisé : « /DATA/LOG.TXT » (majuscules, « / » au début, sans « / » à la fin), ou null s'il n'est pas 8.3. */
export function normPath(p) {
  const parts = String(p == null ? '' : p).replace(/\\/g, '/').split('/').filter(x => x && x !== '.');
  if (parts.some(x => x === '..')) return null;
  const up = parts.map(x => x.toUpperCase());
  if (!up.every(valid83)) return null;
  return '/' + up.join('/');
}
const parentOf = p => p.slice(0, p.lastIndexOf('/')) || '/';

/** Fichiers de la carte (décodés une fois, puis vivants) : { files, dirs, ver }. */
export function sdStore(mem) {
  if (mem && mem._sd) return mem._sd;
  const st = { files: new Map(), dirs: new Set(), ver: 0, b64: new Map() };
  const raw = mem && mem.sd && typeof mem.sd === 'object' ? mem.sd : {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.endsWith('/')) { const d = normPath(k); if (d && d !== '/') st.dirs.add(d); continue; }
    const p = normPath(k); if (!p || typeof v !== 'string') continue;
    const data = b64dec(v); st.files.set(p, { data, len: data.length }); st.b64.set(p, v);
  }
  // Dossiers parents implicites.
  for (const p of [...st.files.keys(), ...st.dirs]) for (let d = parentOf(p); d !== '/'; d = parentOf(d)) st.dirs.add(d);
  if (mem) Object.defineProperty(mem, '_sd', { value: st, configurable: true, writable: true, enumerable: false });
  return st;
}
/** Total des octets des fichiers. */
export const sdUsed = st => { let n = 0; for (const f of st.files.values()) n += f.len; return n; };
/** Recopie les fichiers dans mem.sd (seuls ceux qui ont changé sont réencodés). */
export function saveStore(mem, st = sdStore(mem)) {
  if (!mem) return;
  const out = {};
  for (const d of [...st.dirs].sort()) out[d + '/'] = '';
  for (const [p, f] of st.files) {
    const old = st.b64.get(p), u = f.data.subarray(0, f.len);
    let enc = f.enc === f.ver && old != null ? old : null;
    if (enc == null) { enc = b64enc(u); st.b64.set(p, enc); f.enc = f.ver; }
    out[p] = enc;
  }
  for (const p of [...st.b64.keys()]) if (!st.files.has(p)) st.b64.delete(p);
  mem.sd = out;
  st.ver++;
}
/** Remplace le contenu de la carte (fichiers relus de l'image) ; rend true s'il a changé. */
export function replaceStore(mem, st, files, dirs) {
  let changed = files.size !== st.files.size || dirs.size !== st.dirs.size || [...dirs].some(d => !st.dirs.has(d));
  const next = new Map();
  for (const [p, data] of files) {
    const old = st.files.get(p);
    if (old && old.len === data.length && old.data.subarray(0, old.len).every((b, i) => b === data[i])) { next.set(p, old); continue; }
    changed = true; next.set(p, { data, len: data.length, ver: (old && old.ver || 0) + 1 });
  }
  if (!changed) return false;
  st.files = next; st.dirs = new Set(dirs);
  saveStore(mem, st);
  return true;
}
/** Contenu d'un fichier (Uint8Array) pour le panneau (téléchargement). */
export const fileBytes = (st, p) => { const f = st.files.get(p); return f ? f.data.slice(0, f.len) : null; };

/* ---------- Image FAT16 ---------- */
const PART = 128;             // premier secteur de la partition 1
const CLUSTERS = 4200;        // ≥ 4085 : FAT16
const ROOT_ENTRIES = 512;
const FAT_SECS = Math.ceil((CLUSTERS + 2) * 2 / SEC);
const ROOT_SECS = ROOT_ENTRIES * 32 / SEC;
const FAT0 = PART + 1, ROOT0 = FAT0 + 2 * FAT_SECS, DATA0 = ROOT0 + ROOT_SECS, PART_SECS = 1 + 2 * FAT_SECS + ROOT_SECS + CLUSTERS;
/** Grappes utilisables (512 Ko + quelques dossiers) ; les autres sont marquées défectueuses (0xFFF7). */
const USABLE = SD_CAP / SEC + 64;
/** Secteurs annoncés par la carte (CSD) : 32 Mo, l'image est creuse. */
export const CARD_SECTORS = 65536;

const le16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
const le32 = (b, o, v) => { le16(b, o, v & 0xffff); le16(b, o + 2, v >>> 16); };
const rd16 = (b, o) => b[o] | (b[o + 1] << 8);
const rd32 = (b, o) => (rd16(b, o) | (rd16(b, o + 2) << 16)) >>> 0;
const name11 = n => { const [b, e = ''] = n.split('.'); return (b.padEnd(8, ' ') + e.padEnd(3, ' ')).split('').map(c => c.charCodeAt(0)); };
// Date et heure FAT fixes (1er janvier 2026, 12:00) : le contenu de l'image ne dépend que des fichiers.
const FDATE = ((2026 - 1980) << 9) | (1 << 5) | 1, FTIME = 12 << 11;

/** Image creuse : secteurs écrits seulement ({ get(n) → 512 octets, set(n, octets), dirty }). */
export function blankImage() {
  const secs = new Map();
  return {
    secs, dirty: false,
    get(n) { return secs.get(n) || new Uint8Array(SEC); },
    set(n, data) { secs.set(n, Uint8Array.from(data.subarray ? data.subarray(0, SEC) : data.slice(0, SEC))); this.dirty = true; }
  };
}
/**
 * Image FAT16 d'une carte d'après ses fichiers : MBR, secteur de démarrage, deux FAT, racine de 512 entrées, données.
 * files : Map(chemin → Uint8Array), dirs : Set(chemin).
 */
export function buildImage(files, dirs = new Set()) {
  const img = blankImage(), sec = n => { let s = img.secs.get(n); if (!s) img.secs.set(n, (s = new Uint8Array(SEC))); return s; };
  // MBR : partition 1, FAT16 (type 0x06), non amorçable.
  const mbr = sec(0);
  mbr[446] = 0x00; mbr[447] = 1; mbr[448] = 1; mbr[449] = 0; mbr[450] = 0x06; mbr[451] = 0xfe; mbr[452] = 0xff; mbr[453] = 0xff;
  le32(mbr, 454, PART); le32(mbr, 458, PART_SECS); mbr[510] = 0x55; mbr[511] = 0xaa;
  // Secteur de démarrage et BPB.
  const bs = sec(PART);
  bs.set([0xeb, 0x3c, 0x90], 0); bs.set([...'MSDOS5.0'].map(c => c.charCodeAt(0)), 3);
  le16(bs, 11, SEC); bs[13] = 1; le16(bs, 14, 1); bs[16] = 2; le16(bs, 17, ROOT_ENTRIES); le16(bs, 19, PART_SECS); bs[21] = 0xf8;
  le16(bs, 22, FAT_SECS); le16(bs, 24, 63); le16(bs, 26, 255); le32(bs, 28, PART); le32(bs, 32, 0);
  bs[36] = 0x80; bs[38] = 0x29; le32(bs, 39, 0x4a4f4c46); bs.set([...'JOLLOF SD  '].map(c => c.charCodeAt(0)), 43);
  bs.set([...'FAT16   '].map(c => c.charCodeAt(0)), 54); bs[510] = 0x55; bs[511] = 0xaa;
  // FAT : grappes 0 et 1 réservées, grappes au-delà de la capacité utile marquées défectueuses.
  const fat = new Uint16Array(CLUSTERS + 2);
  fat[0] = 0xfff8; fat[1] = 0xffff;
  for (let c = USABLE + 2; c < CLUSTERS + 2; c++) fat[c] = 0xfff7;
  let next = 2;
  const alloc = n => { const first = n ? next : 0; for (let i = 0; i < n; i++) { fat[next] = i === n - 1 ? 0xffff : next + 1; next++; } return first; };
  const clusterSec = c => DATA0 + c - 2;
  // Dossiers : chacun reçoit ses entrées ; on écrit d'abord les dossiers (grappe connue), puis leur contenu.
  const all = new Set(['/', ...dirs]);
  for (const p of files.keys()) for (let d = parentOf(p); d !== '/'; d = parentOf(d)) all.add(d);
  const kids = new Map([...all].map(d => [d, []]));
  for (const d of all) if (d !== '/') kids.get(parentOf(d)).push({ name: d.slice(d.lastIndexOf('/') + 1), dir: d });
  for (const [p, data] of files) kids.get(parentOf(p)).push({ name: p.slice(p.lastIndexOf('/') + 1), data });
  const firstOf = new Map([['/', 0]]);
  // Grappes des dossiers (16 entrées par grappe, plus « . » et « .. »).
  for (const d of [...all].filter(x => x !== '/').sort()) firstOf.set(d, alloc(Math.ceil((kids.get(d).length + 2) / 16)));
  const entry = (buf, o, name, attr, clus, size, raw) => { buf.set(raw || name11(name), o); buf[o + 11] = attr; le16(buf, o + 14, FTIME); le16(buf, o + 16, FDATE); le16(buf, o + 18, FDATE); le16(buf, o + 22, FTIME); le16(buf, o + 24, FDATE); le16(buf, o + 26, clus); le32(buf, o + 28, size); };
  for (const d of all) {
    const list = [];
    if (d === '/') list.push({ raw: [...'JOLLOF SD  '].map(c => c.charCodeAt(0)), attr: 0x08, clus: 0, size: 0 });
    else { list.push({ raw: [...'.          '].map(c => c.charCodeAt(0)), attr: 0x10, clus: firstOf.get(d), size: 0 }); list.push({ raw: [...'..         '].map(c => c.charCodeAt(0)), attr: 0x10, clus: firstOf.get(parentOf(d)), size: 0 }); }
    for (const k of kids.get(d)) {
      if (k.dir) list.push({ name: k.name, attr: 0x10, clus: firstOf.get(k.dir), size: 0 });
      else { const n = Math.ceil(k.data.length / SEC), c = alloc(n); list.push({ name: k.name, attr: 0x20, clus: c, size: k.data.length });
        for (let i = 0; i < n; i++) sec(clusterSec(c + i)).set(k.data.subarray(i * SEC, (i + 1) * SEC)); }
    }
    const base = d === '/' ? ROOT0 : clusterSec(firstOf.get(d));
    if (d === '/' && list.length > ROOT_ENTRIES) list.length = ROOT_ENTRIES;
    list.forEach((e, i) => entry(sec(base + (i >> 4)), (i & 15) * 32, e.name, e.attr, e.clus, e.size, e.raw));
  }
  // Les deux copies de la FAT.
  const fb = new Uint8Array(fat.buffer);
  for (let s = 0; s < FAT_SECS; s++) {
    const chunk = fb.subarray(s * SEC, (s + 1) * SEC);
    if (!chunk.some(Boolean)) continue;
    for (const f of [FAT0, FAT0 + FAT_SECS]) sec(f + s).set(chunk);
  }
  img.dirty = false;
  return img;
}
/**
 * Fichiers d'une image FAT16 (relue après les écritures du programme) : { files: Map(chemin → Uint8Array), dirs: Set }.
 * Les entrées effacées (0xE5), de nom long (attribut 0x0F) et le nom du volume sont ignorés. Lit la géométrie du BPB.
 */
export function readImage(img) {
  const mbr = img.get(0), part = mbr[510] === 0x55 && mbr[450] ? rd32(mbr, 454) : 0, bs = img.get(part);
  const spc = bs[13] || 1, fat0 = part + rd16(bs, 14), fatSecs = rd16(bs, 22), rootN = rd16(bs, 17);
  const root0 = fat0 + bs[16] * fatSecs, data0 = root0 + Math.ceil(rootN * 32 / SEC);
  const fatAt = c => rd16(img.get(fat0 + ((c * 2) >> 9)), (c * 2) & 511);
  const chain = c => { const out = []; const seen = new Set(); while (c >= 2 && c < 0xfff7 && !seen.has(c) && out.length < 70000) { seen.add(c); out.push(c); c = fatAt(c); } return out; };
  const clusSecs = c => Array.from({ length: spc }, (_, i) => data0 + (c - 2) * spc + i);
  const files = new Map(), dirs = new Set();
  const nameOf = (b, o) => { const raw = String.fromCharCode(...b.subarray(o, o + 11)); const base = raw.slice(0, 8).trimEnd(), ext = raw.slice(8).trimEnd(); return (base + (ext ? '.' + ext : '')).toUpperCase(); };
  const walk = (secs, path, depth) => {
    for (const s of secs) {
      const b = img.get(s);
      for (let o = 0; o < SEC; o += 32) {
        if (b[o] === 0) return;
        if (b[o] === 0xe5 || b[o] === 0x2e) continue;
        const attr = b[o + 11];
        if ((attr & 0x0f) === 0x0f || attr & 0x08) continue;
        const name = nameOf(b, o), p = (path === '/' ? '' : path) + '/' + name, clus = rd16(b, o + 26) | (rd16(b, o + 20) << 16);
        if (!normPath(p)) continue;
        if (attr & 0x10) { if (depth < 8) { dirs.add(p); walk(chain(clus).flatMap(clusSecs), p, depth + 1); } continue; }
        const size = rd32(b, o + 28), data = new Uint8Array(size);
        let at = 0;
        for (const c of chain(clus)) for (const s2 of clusSecs(c)) { if (at >= size) break; const chunk = img.get(s2); data.set(chunk.subarray(0, Math.min(SEC, size - at)), at); at += SEC; }
        files.set(p, data);
      }
    }
  };
  walk(Array.from({ length: Math.ceil(rootN * 32 / SEC) }, (_, i) => root0 + i), '/', 0);
  return { files, dirs };
}

/* ---------- Protocole SPI des cartes SD ---------- */
// CSD version 2.0 (carte SDHC) : C_SIZE = 63, soit (63 + 1) × 512 Ko = 32 Mo ; CID d'une carte fictive « JOLLF ».
const CSD = [0x40, 0x0e, 0x00, 0x32, 0x5b, 0x59, 0x00, 0x00, 0x00, 0x3f, 0x7f, 0x80, 0x0a, 0x40, 0x00, 0x01];
const CID = [0x4a, 0x4a, 0x53, 0x4a, 0x4f, 0x4c, 0x46, 0x10, 0x00, 0x00, 0x00, 0x01, 0x01, 0x6a, 0x00, 0x01];
/** CRC16-CCITT des blocs de données (rendu exact, même si la bibliothèque ne le vérifie pas). */
function crc16(d) { let c = 0; for (const b of d) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }
const block = (token, data) => { const c = crc16(data); return [0xff, token, ...data, c >> 8, c & 255]; };

/**
 * Carte SD vue du bus SPI. img : image (get, set). Rend { transfer(octet) → octet, select(), deselect(), stats }.
 * Réponses : un octet de remplissage (0xFF) puis R1, comme une carte réelle (SdFat jette le premier octet reçu).
 */
export function createSdCard(img) {
  let mode = 'off', polls = 0, app = false;           // off : pas encore en SPI (CMD0 attendu)
  let cmd = [], resp = [], busy = 0, stream = -1, wstate = null, wbuf = null, wsec = 0;
  const stats = { reads: 0, writes: 0, cmds: 0 };
  const r1 = () => (mode === 'ready' ? 0x00 : 0x01);
  function exec(c) {
    const n = c[0] & 0x3f, arg = ((c[1] << 24) | (c[2] << 16) | (c[3] << 8) | c[4]) >>> 0, isApp = app;
    app = false; stats.cmds++;
    if (n === 0) { mode = 'idle'; polls = 0; stream = -1; wstate = null; resp = [0xff, 0x01]; return; }
    if (mode === 'off') return; // la carte n'écoute pas encore en SPI
    if (isApp && n === 41) { if (++polls >= 2) mode = 'ready'; resp = [0xff, r1()]; return; }
    if (isApp && n === 13) { resp = [0xff, r1(), 0x00, ...block(0xfe, new Array(64).fill(0))]; return; }
    if (isApp && n === 51) { resp = [0xff, r1(), ...block(0xfe, [0x02, 0x35, 0x80, 0x00, 0, 0, 0, 0])]; return; }
    if (isApp && (n === 23 || n === 22)) { resp = [0xff, r1()]; return; }
    if (isApp && n === 42) { resp = [0xff, r1()]; return; } // SET_CLR_CARD_DETECT (bibliothèque SD de l'ESP32) : sans effet
    switch (n) {
      case 8: resp = [0xff, r1(), 0x00, 0x00, (arg >> 8) & 0x0f, arg & 0xff]; return;
      case 55: app = true; resp = [0xff, r1()]; return;
      case 58: resp = [0xff, r1(), mode === 'ready' ? 0xc0 : 0x40, 0xff, 0x80, 0x00]; return;
      case 59: case 16: resp = [0xff, r1()]; return;
      case 9: resp = [0xff, r1(), ...block(0xfe, CSD)]; return;
      case 10: resp = [0xff, r1(), ...block(0xfe, CID)]; return;
      case 13: resp = [0xff, r1(), 0x00]; return;
      case 12: stream = -1; resp = [0xff, 0xff, 0x00]; busy = 2; return;
    }
    if (mode !== 'ready') { resp = [0xff, 0x05]; return; } // commande illégale tant que l'initialisation n'est pas finie
    if (arg >= CARD_SECTORS && [17, 18, 24, 25].includes(n)) { resp = [0xff, 0x40]; return; } // erreur d'adresse
    switch (n) {
      case 17: stats.reads++; resp = [0xff, 0x00, ...block(0xfe, img.get(arg))]; return;
      case 18: stream = arg; resp = [0xff, 0x00]; return;
      case 24: wstate = 'single'; wsec = arg; resp = [0xff, 0x00]; return;
      case 25: wstate = 'multi'; wsec = arg; resp = [0xff, 0x00]; return;
      case 32: case 33: case 38: resp = [0xff, 0x00]; busy = 4; return; // effacement : accepté, sans effet sur l'image
      case 6: resp = [0xff, 0x00, ...block(0xfe, new Array(64).fill(0))]; return;
    }
    resp = [0xff, 0x04]; // commande inconnue
  }
  return {
    stats,
    select() {},
    deselect() { cmd = []; },
    transfer(b) {
      let out = 0xff;
      if (resp.length) out = resp.shift();
      else if (stream >= 0 && !cmd.length && b === 0xff) { stats.reads++; resp = block(0xfe, img.get(stream)); stream = Math.min(stream + 1, CARD_SECTORS - 1); out = resp.shift(); }
      else if (busy > 0) { busy--; out = 0x00; }
      // Ce que la carte reçoit.
      if (wbuf) {
        wbuf.push(b);
        if (wbuf.length === SEC + 2) {
          img.set(wsec, Uint8Array.from(wbuf.slice(0, SEC))); stats.writes++;
          wbuf = null; resp = [0x05]; busy = 3; // jeton « données acceptées », puis la carte programme (0x00)
          if (wstate === 'multi') wsec++; else wstate = null;
        }
      } else if (cmd.length) { cmd.push(b); if (cmd.length === 6) { const c = cmd; cmd = []; exec(c); } }
      else if ((b & 0xc0) === 0x40) { cmd = [b]; if ((b & 0x3f) === 12 || stream >= 0) { resp = []; } }
      else if (wstate === 'single' && b === 0xfe) wbuf = [];
      else if (wstate === 'multi' && b === 0xfc) wbuf = [];
      else if (wstate === 'multi' && b === 0xfd) { wstate = null; busy = 3; }
      return out;
    }
  };
}

/* ---------- Bibliothèque SD de l'interpréteur ---------- */
/** Valeurs des modes d'ouverture de la bibliothèque SD d'Arduino (SdFat d'origine). */
export const SD_CONSTS = { O_READ: 0x01, O_RDONLY: 0x01, O_WRITE: 0x02, O_WRONLY: 0x02, O_RDWR: 0x03, O_APPEND: 0x04, O_SYNC: 0x08, O_CREAT: 0x10, O_EXCL: 0x20, O_TRUNC: 0x40, FILE_READ: 0x01, FILE_WRITE: 0x17 };

/**
 * Classes SDClass et File de l'interpréteur, sur les fichiers gardés avec le projet. ctx : { hw, keyOf(broche) → clé,
 * warn(message), fmt(valeur, format, étiquette) → texte, tl, ss (broche SS par défaut, ou null) }.
 */
export function createSdLib({ hw, keyOf, warn, fmt, tl, ss }) {
  let card = null; // composant carte SD choisi par SD.begin()
  const mem = () => (card && hw.compMem ? hw.compMem(card) : null);
  const store = () => sdStore(mem());
  const persist = () => { const m = mem(); if (!m) return; saveStore(m, store()); if (hw.memChanged) hw.memChanged(); };
  const need = () => { if (!card) warn(tl('Carte SD : SD.begin() n’a pas réussi (ou n’a pas été appelé), aucun fichier n’est accessible')); return !!card; };
  const enc = s => Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
  class File {
    constructor(path = null, mode = 0, dir = false) { this.p = path; this.mode = mode; this.dir = dir; this.pos = 0; this.it = 0; this.open = !!path; }
    __bool() { return this.open; }
    f() { if (!this.open || this.dir) return null; const st = store(), x = st.files.get(this.p); if (!x) { this.open = false; return null; } return x; }
    name() { return this.p == null ? '' : this.p === '/' ? '/' : this.p.slice(this.p.lastIndexOf('/') + 1); }
    isDirectory() { return this.open && this.dir; }
    size() { const x = this.f(); return x ? x.len : 0; }
    position() { return this.pos; }
    available() { const x = this.f(); return x ? Math.max(0, x.len - this.pos) : 0; }
    read() { const x = this.f(); if (!x || this.pos >= x.len) return -1; return x.data[this.pos++]; }
    peek() { const x = this.f(); return x && this.pos < x.len ? x.data[this.pos] : -1; }
    seek(n) { const x = this.f(); if (!x || n < 0 || n > x.len) return false; this.pos = n | 0; return true; }
    readStringUntil(t) { const ch = typeof t === 'number' ? t : String(t).charCodeAt(0); let s = ''; for (;;) { const c = this.read(); if (c < 0 || c === ch) break; s += String.fromCharCode(c); } return s; }
    readString() { let s = ''; for (let c = this.read(); c >= 0; c = this.read()) s += String.fromCharCode(c); return s; }
    parseInt() { let c = this.peek(); while (c >= 0 && !(c === 45 || (c >= 48 && c <= 57))) { this.read(); c = this.peek(); } let s = ''; while (c >= 0 && (c === 45 ? !s : c >= 48 && c <= 57)) { s += String.fromCharCode(this.read()); c = this.peek(); } return parseInt(s, 10) || 0; }
    bytes(arr) {
      const x = this.f();
      if (!x || !(this.mode & 0x02)) { if (this.open) warn(tl('Carte SD : le fichier {0} est ouvert en lecture (FILE_READ) : ouvrez-le avec FILE_WRITE pour écrire', this.name())); return 0; }
      const st = store(), room = SD_CAP - sdUsed(st);
      if (arr.length > room) { warn(tl('Carte SD pleine : {0} Ko au plus dans le simulateur', SD_CAP / 1024)); arr = arr.slice(0, Math.max(0, room)); }
      if (this.mode & 0x04) this.pos = x.len;
      const end = this.pos + arr.length;
      if (end > x.data.length) { const nd = new Uint8Array(Math.max(end, x.data.length * 2, 64)); nd.set(x.data.subarray(0, x.len)); x.data = nd; }
      x.data.set(arr, this.pos); this.pos = end; x.len = Math.max(x.len, end); x.ver = (x.ver || 0) + 1; this.dirty = true;
      return arr.length;
    }
    write(v, n) {
      if (typeof v === 'string') return this.bytes(enc(v));
      if (Array.isArray(v)) return this.bytes(v.slice(0, n == null ? v.length : n).map(b => b & 255));
      return this.bytes([v & 255]);
    }
    print(x, f, tag) { return this.bytes(enc(fmt(x, f, tag))); }
    println(x, f, tag) { return this.bytes(enc((x === undefined ? '' : fmt(x, f, tag)) + '\r\n')); }
    flush() { if (this.dirty) { this.dirty = false; persist(); } }
    close() { this.flush(); this.open = false; }
    /** Dossier : entrée suivante (fichier ou dossier), ou un File fermé à la fin. */
    openNextFile(mode = 0x01) {
      if (!this.open || !this.dir) return new File();
      const st = store();
      const list = [...[...st.dirs].filter(d => parentOf(d) === this.p).map(d => [d, true]), ...[...st.files.keys()].filter(p => parentOf(p) === this.p).map(p => [p, false])];
      const e = list[this.it++];
      return e ? new File(e[0], e[1] ? 0x01 : mode, e[1]) : new File();
    }
    rewindDirectory() { this.it = 0; }
  }
  class SDClass {
    begin(cs, a2) {
      const pin = typeof cs === 'number' && cs > 100 && typeof a2 === 'number' ? a2 : cs; // SD.begin(horloge, cs)
      const k = pin == null ? (ss != null ? keyOf(ss) : null) : keyOf(pin);
      let hit = k && hw.at ? hw.at(k).find(x => x.comp.type === 'sdcard' && x.pin === 'CS') : null;
      if (!hit && pin == null && hw.comps) { const c = hw.comps(['sdcard'])[0]; if (c) hit = { comp: c }; }
      if (!hit) { warn(tl('Carte SD : aucun module microSD n’a sa broche CS reliée à la broche {0}', pin == null ? 'SS' : pin)); card = null; return false; }
      const s = hw.status ? hw.status(hit.comp) : { ok: true };
      if (!s.ok) { warn(tl('Carte SD : le module {0} est mal câblé ({1})', hit.comp.name, s.msg)); card = null; return false; }
      card = hit.comp; store();
      return true;
    }
    end() { card = null; }
    exists(p) { if (!need()) return false; const q = normPath(p), st = store(); return !!q && (q === '/' || st.files.has(q) || st.dirs.has(q)); }
    mkdir(p) {
      if (!need()) return false; const q = normPath(p), st = store(); if (!q || q === '/' || st.files.has(q)) return false;
      for (let d = q; d !== '/'; d = parentOf(d)) { if (st.files.has(d)) return false; st.dirs.add(d); }
      persist(); return true;
    }
    rmdir(p) { if (!need()) return false; const q = normPath(p), st = store(); if (!q || !st.dirs.has(q)) return false; if ([...st.files.keys(), ...st.dirs].some(x => parentOf(x) === q)) return false; st.dirs.delete(q); persist(); return true; }
    remove(p) { if (!need()) return false; const q = normPath(p), st = store(); if (!q || !st.files.has(q)) return false; st.files.delete(q); persist(); return true; }
    open(p, mode = 0x01) {
      // ESP32 : modes en texte comme fopen (« r », « w » : vide le fichier, « a » : ajoute à la fin).
      if (typeof mode === 'string') mode = mode[0] === 'a' ? 0x17 : mode[0] === 'w' ? 0x13 | 0x40 : 0x01;
      if (!need()) return new File();
      const q = normPath(p), st = store();
      if (!q) { warn(tl('Carte SD : « {0} » n’est pas un nom de fichier court (8 caractères, un point, 3 caractères, par exemple DONNEES.TXT)', String(p))); return new File(); }
      if (q === '/' || st.dirs.has(q)) return new File(q, 0x01, true);
      if (!st.dirs.has(parentOf(q)) && parentOf(q) !== '/') return new File();
      if (!st.files.has(q)) {
        if (!(mode & 0x10) || !(mode & 0x02)) return new File();
        st.files.set(q, { data: new Uint8Array(64), len: 0, ver: 1 }); persist();
      } else if ((mode & 0x40) && (mode & 0x02)) { const x = st.files.get(q); x.len = 0; x.ver = (x.ver || 0) + 1; }
      const f = new File(q, mode, false);
      if (mode & 0x04) f.pos = st.files.get(q).len;
      return f;
    }
  }
  return { SDClass, File };
}
