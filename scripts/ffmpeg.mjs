#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Prépare le programme ffmpeg livré à côté de l'application (Tauri « externalBin ») :
//   src-tauri/binaries/ffmpeg-<cible>[.exe]
// Toujours une version LGPL (sans x264/x265 ni rien de GPL ou « nonfree ») : elle peut accompagner l'édition
// commerciale, et l'application ne fait que la lancer comme un programme à part (aucun lien de code).
//
//   Windows, Linux : build statique LGPL de BtbN/FFmpeg-Builds, version et empreinte SHA-256 épinglées.
//   macOS : compilé ici depuis les sources officielles (ffmpeg.org, empreinte épinglée), LGPL, avec VideoToolbox et
//           AudioToolbox du système, sans aucune bibliothèque de Homebrew (binaire autonome).
//
// node scripts/ffmpeg.mjs [--target <triple>]   (par défaut : la machine courante, d'après rustc)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath : sous Windows, le chemin de l'URL (« /D:/… ») donnerait « D:\\D:\\… ».
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'src-tauri', 'binaries');
const VERSION = '8.1.3';
const SOURCE = { url: `https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz` };
// Empreinte de l'archive officielle (relevée le 2026-11-15 ; signature GPG : ffmpeg-8.1.3.tar.xz.asc sur ffmpeg.org).
const SOURCE_SHA256 = '7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3';
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-15-12-40';
const PREBUILT = {
  'x86_64-pc-windows-msvc': { file: 'ffmpeg-n8.1.3-35-gf1acb0a266-win64-lgpl-8.1.zip', sha256: '272140baa96cbb9553eb57c03590e0b8d2c93ce352aa7f876c34fbc657536836' },
  'x86_64-unknown-linux-gnu': { file: 'ffmpeg-n8.1.3-35-gf1acb0a266-linux64-lgpl-8.1.tar.xz', sha256: '6172ad240ea8bf7b7a9078e76e7fcf7143ddf1782eb75b5d12a162c4b9d84c71' },
  'aarch64-unknown-linux-gnu': { file: 'ffmpeg-n8.1.3-35-gf1acb0a266-linuxarm64-lgpl-8.1.tar.xz', sha256: '6a6b9c439de40b6a4a890c3a0a7ecb9ec0386712c4498e500be9e023acff7a88' }
};

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const host = () => /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))[1];
const target = arg('--target') || host();
const exe = target.includes('windows') ? '.exe' : '';
const out = path.join(BIN, `ffmpeg-${target}${exe}`);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

async function download(url, file, want) {
  if (!fs.existsSync(file)) {
    console.log('téléchargement', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} : ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const got = sha(file);
  if (want && got !== want) { fs.rmSync(file); throw new Error(`empreinte inattendue pour ${path.basename(file)} : ${got}`); }
  return got;
}

/** Refuse un binaire qui serait GPL ou nonfree. */
function checkLicense(bin) {
  const v = execFileSync(bin, ['-hide_banner', '-L'], { encoding: 'utf8' });
  const conf = execFileSync(bin, ['-hide_banner', '-buildconf'], { encoding: 'utf8' });
  // Options activées seulement : les builds LGPL écrivent « --disable-libx264 » dans leur configuration.
  if (/--enable-(gpl|nonfree|libx264|libx265)\b/.test(conf) || !/Lesser General Public License/.test(v)) throw new Error(`${bin} n'est pas une version LGPL`);
}

async function prebuilt() {
  const p = PREBUILT[target];
  if (!p) throw new Error(`pas de build épinglé pour ${target}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jollof-ffmpeg-'));
  const archive = path.join(work, p.file);
  await download(`${BTBN}/${p.file}`, archive, p.sha256);
  if (p.file.endsWith('.zip')) run(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32' ? ['-xf', archive, '-C', work] : ['-q', archive, '-d', work]);
  else run('tar', ['-xJf', archive, '-C', work]);
  const dir = p.file.replace(/\.(zip|tar\.xz)$/, '');
  fs.copyFileSync(path.join(work, dir, 'bin', `ffmpeg${exe}`), out);
  fs.copyFileSync(path.join(work, dir, 'LICENSE.txt'), path.join(BIN, 'FFMPEG-LICENSE.txt'));
}

async function buildMac() {
  const work = path.join(os.tmpdir(), `jollof-ffmpeg-src-${VERSION}`);
  fs.mkdirSync(work, { recursive: true });
  const tarball = path.join(work, `ffmpeg-${VERSION}.tar.xz`);
  await download(SOURCE.url, tarball, SOURCE_SHA256);
  const src = path.join(work, `ffmpeg-${VERSION}`);
  if (!fs.existsSync(src)) run('tar', ['-xJf', tarball, '-C', work]);
  const arch = target.startsWith('aarch64') ? 'arm64' : 'x86_64';
  const flags = [
    `--arch=${arch}`, '--cc=clang', `--extra-cflags=-arch ${arch} -mmacosx-version-min=11.0`, `--extra-ldflags=-arch ${arch} -mmacosx-version-min=11.0`,
    '--disable-autodetect', '--enable-videotoolbox', '--enable-audiotoolbox', '--enable-zlib',
    '--enable-static', '--disable-shared', '--disable-doc', '--disable-ffplay', '--disable-ffprobe',
    '--disable-network', '--disable-debug', '--disable-devices', '--disable-x86asm'
  ];
  run('./configure', flags, { cwd: src });
  run('make', [`-j${os.cpus().length}`, 'ffmpeg'], { cwd: src });
  fs.copyFileSync(path.join(src, 'ffmpeg'), out);
  fs.copyFileSync(path.join(src, 'COPYING.LGPLv2.1'), path.join(BIN, 'FFMPEG-LICENSE.txt'));
}

fs.mkdirSync(BIN, { recursive: true });
if (fs.existsSync(out) && !process.argv.includes('--force')) { console.log('déjà là :', path.relative(ROOT, out)); process.exit(0); }
if (target.includes('apple-darwin')) await buildMac(); else await prebuilt();
fs.chmodSync(out, 0o755);
if (target === host()) checkLicense(out);
console.log('ffmpeg prêt :', path.relative(ROOT, out), `${(fs.statSync(out).size / 1048576).toFixed(1)} Mo`);
