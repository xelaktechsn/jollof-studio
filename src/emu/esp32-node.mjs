// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Transport du moteur ESP32 (src/emu/esp32.js) pour Node : lance QEMU comme le fait l'application
// (src-tauri/src/qemu.rs, mêmes arguments à garder identiques), pour les tests et les bancs d'essai. Jamais importé
// par l'interface (child_process, sockets).
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const QEMU_VERSION = '9.2.2-20250817-j1';
const EXE = process.platform === 'win32' ? 'qemu-system-xtensa.exe' : 'qemu-system-xtensa';
const TRACE = /memory_region_ops_write .*? addr 0x([0-9a-f]+) value 0x([0-9a-f]+) size \d+ name '(esp32\.gpio|misc\.esp32\.ledc)'/;

/** QEMU de l'ESP32 : JOLLOF_QEMU, sinon celui que l'application a installé (dossier de données local), sinon null. */
export function qemuPath() {
  if (process.env.JOLLOF_QEMU && fs.existsSync(process.env.JOLLOF_QEMU)) return process.env.JOLLOF_QEMU;
  const id = 'sn.jollof.studio', home = os.homedir();
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', id)
    : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), id)
      : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), id);
  const p = path.join(base, 'qemu-esp32', QEMU_VERSION, 'qemu', 'bin', EXE);
  return fs.existsSync(p) ? p : null;
}

/** Arguments de QEMU (les mêmes que qemu_args de src-tauri/src/qemu.rs). */
export function qemuArgs(share, flash, uartPort, sidePort) {
  return ['-machine', 'esp32', '-display', 'none', '-monitor', 'none', '-nodefaults',
    '-global', 'driver=timer.esp32.timg,property=wdt_disable,value=true',
    ...(share ? ['-L', share] : []),
    '-drive', `file=${flash.replace(/,/g, ',,')},if=mtd,format=raw`,
    '-chardev', `socket,id=uart0,host=127.0.0.1,port=${uartPort}`, '-serial', 'chardev:uart0',
    '-chardev', `socket,id=uart1,host=127.0.0.1,port=${sidePort}`, '-serial', 'chardev:uart1',
    '-trace', 'memory_region_ops_write'];
}

const listen = () => new Promise((resolve, reject) => {
  const srv = net.createServer(); srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, conn: new Promise(r => srv.once('connection', s => { srv.close(); s.setNoDelay(true); r(s); })) }));
});

/** Transport { start, uart, side, stop } vers un QEMU lancé par Node (dossier de travail temporaire, retiré à l'arrêt). */
export function nodeTransport({ qemu = qemuPath(), workDir = null } = {}) {
  const own = !workDir, dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'jollof-esp32-'));
  let proc = null, uart = null, side = null, stopped = false;
  const clean = () => { if (own) try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows : fichier encore ouvert */ } };
  return {
    async start({ image, onUart, onSide, onTrace, onExit }) {
      if (!qemu) throw new Error('QEMU introuvable (JOLLOF_QEMU)');
      const flash = path.join(dir, 'flash.bin');
      fs.writeFileSync(flash, image);
      const share = path.join(path.dirname(path.dirname(qemu)), 'share', 'qemu');
      const [u, s] = [await listen(), await listen()];
      const t0 = performance.now(), now = () => performance.now() - t0;
      proc = spawn(qemu, qemuArgs(fs.existsSync(share) ? share : null, flash, u.port, s.port), { stdio: ['ignore', 'ignore', 'pipe'] });
      let buf = '', tail = '', batch = [], timer = null;
      const flush = () => { timer = null; if (batch.length) { const b = batch; batch = []; onTrace(b); } };
      proc.stderr.setEncoding('latin1');
      proc.stderr.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          const m = TRACE.exec(line);
          if (m) { batch.push([parseInt(m[1], 16) >>> 0, parseInt(m[2], 16) >>> 0, now()]); if (!timer) timer = setTimeout(flush, 5); }
          else if (!line.startsWith('memory_region_ops_write')) tail = (tail + line + '\n').slice(-3000);
        }
      });
      proc.on('exit', code => { flush(); clean(); if (!stopped) onExit(code, tail); });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('QEMU ne répond pas')), 20000));
      [uart, side] = await Promise.race([Promise.all([u.conn, s.conn]), timeout]);
      uart.on('data', d => onUart(now(), d)); uart.on('error', () => {});
      side.on('data', d => onSide(now(), d)); side.on('error', () => {});
    },
    uart(bytes) { if (uart && !uart.destroyed) uart.write(Buffer.from(bytes)); },
    side(bytes) { if (side && !side.destroyed) side.write(Buffer.from(bytes)); },
    stop() {
      stopped = true;
      for (const s of [uart, side]) if (s) s.destroy();
      if (proc && proc.exitCode == null) proc.kill('SIGKILL'); else clean();
    }
  };
}
