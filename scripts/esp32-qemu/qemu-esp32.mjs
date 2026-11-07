// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Essai 4.4 : un vrai programme ESP32 tourne dans QEMU (fork d'Espressif, GPL-2), lancé comme un programme à
// part — jamais lié à l'application. Ce module ne fait que le piloter de l'extérieur :
//   UART0 → stdin/stdout du processus (moniteur série) ;
//   QMP (JSON sur une socket TCP locale) → pause, reprise, propriétés des modèles (température du TMP105…) ;
//   trace « memory_region_ops_write » (sur stderr) → écritures du programme dans les registres GPIO et LEDC,
//     d'où l'on déduit les sorties et le PWM, sans modifier QEMU ;
//   UART1 (socket TCP locale) → canal de la cale jollof_qemu_shim.cpp : niveaux d'entrée vers la carte,
//     pinMode/digitalWrite horodatés en temps virtuel vers l'hôte.
// Aucun code de QEMU ni d'un autre simulateur n'est repris ici : seulement les adresses publiques des registres
// (manuel de référence technique de l'ESP32) et le protocole QMP documenté.
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const GPIO = 0x3ff44000, LEDC = 0x3ff59000, APB_HZ = 80e6, REF_HZ = 1e6;
const TRACE_RE = /memory_region_ops_write cpu \d+ mr \S+ addr 0x([0-9a-f]+) value 0x([0-9a-f]+) size \d+ name '([^']+)'/;

/** Serveur TCP local à usage unique : QEMU s'y connecte en client, ce qui évite toute course sur le port. */
function oneShotServer() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const conn = new Promise(r => srv.once('connection', s => { srv.close(); r(s); }));
      resolve({ port: srv.address().port, conn });
    });
  });
}

/** Client QMP minimal : une commande JSON par ligne, réponses rangées par identifiant. */
function qmpClient(sock) {
  let buf = '', seq = 0;
  const wait = new Map(), events = [];
  let greet;
  const greeted = new Promise(r => { greet = r; });
  sock.setEncoding('utf8');
  sock.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      if (m.QMP) greet(m);
      else if (m.event) events.push(m);
      else if (m.id != null && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.reject(new Error(m.error.desc)) : w.resolve(m.return); }
    }
  });
  const execute = (cmd, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    wait.set(id, { resolve, reject });
    sock.write(JSON.stringify(args ? { execute: cmd, arguments: args, id } : { execute: cmd, id }) + '\n');
  });
  return { greeted, execute, events };
}

/** Temps processeur consommé par un processus (s), d'après ps (« M:SS.cc » ou « H:MM:SS.cc »). */
export function cpuSeconds(pid) {
  try {
    const t = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return t.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
  } catch { return NaN; }
}

/**
 * Décodeur des écritures de registres vues par la trace : niveaux et sens des GPIO, fonction de sortie de
 * chaque broche (GPIO simple ou canal LEDC), rapport cyclique et fréquence du PWM.
 */
function gpioDecoder(onPin, onPwm) {
  let out = 0n, en = 0n;
  const sel = new Array(40).fill(256), ch = Array.from({ length: 16 }, () => ({ timer: 0, duty: 0 }));
  const timers = Array.from({ length: 8 }, () => ({ res: 0, div: 0, apb: true }));
  const last = new Array(40).fill(null);
  const mask40 = (1n << 40n) - 1n;
  function pwmOf(pin) {
    const s = sel[pin];
    if (s < 71 || s > 86) return null;
    const c = s - 71, hs = c < 8, C = ch[c], T = timers[(hs ? 0 : 4) + C.timer];
    if (!T.res || !T.div) return null;
    const full = 2 ** T.res;
    return { duty: Math.min(1, (C.duty / 16) / full), freq: (T.apb ? APB_HZ : REF_HZ) / (T.div / 256) / full, channel: c };
  }
  function publish(t) {
    for (let p = 0; p < 40; p++) {
      const b = 1n << BigInt(p), mode = en & b ? 1 : 0, d = out & b ? 1 : 0, pwm = mode ? pwmOf(p) : null;
      const key = `${mode}${d}${pwm ? pwm.duty.toFixed(4) + '@' + pwm.freq.toFixed(1) : ''}`;
      if (last[p] === key) continue;
      const first = last[p] === null;
      last[p] = key;
      if (first && !mode) continue; // broche jamais touchée : rien à dire
      if (pwm) onPwm({ pin: p, ...pwm, t }); else onPin({ pin: p, mode, d, t });
    }
  }
  return function write(addr, value, t) {
    const o = addr - GPIO;
    if (o >= 0 && o < 0x1000) {
      const v = BigInt(value);
      switch (o) {
        case 0x04: out = (out & ~0xffffffffn) | v; break;
        case 0x08: out |= v; break;
        case 0x0c: out &= ~v; break;
        case 0x10: out = (out & 0xffffffffn) | ((v & 0xffn) << 32n); break;
        case 0x14: out |= (v & 0xffn) << 32n; break;
        case 0x18: out &= ~((v & 0xffn) << 32n); break;
        case 0x20: en = (en & ~0xffffffffn) | v; break;
        case 0x24: en |= v; break;
        case 0x28: en &= ~v; break;
        case 0x2c: en = (en & 0xffffffffn) | ((v & 0xffn) << 32n); break;
        case 0x30: en |= (v & 0xffn) << 32n; break;
        case 0x34: en &= ~((v & 0xffn) << 32n); break;
        default:
          if (o >= 0x530 && o < 0x530 + 40 * 4) sel[(o - 0x530) >> 2] = value & 0x1ff; else return;
      }
      out &= mask40; en &= mask40;
      publish(t);
      return;
    }
    const l = addr - LEDC;
    if (l < 0 || l >= 0x200) return;
    if (l < 0x140) {
      const hs = l < 0xa0, base = hs ? l : l - 0xa0, c = (hs ? 0 : 8) + Math.floor(base / 0x14), reg = base % 0x14;
      if (reg === 0x00) ch[c].timer = value & 3; else if (reg === 0x08) ch[c].duty = value & 0x1ffffff; else return;
    } else if (l < 0x180 && (l & 7) === 0) {
      const T = timers[(l - 0x140) >> 3];
      T.res = value & 0x1f; T.div = (value >> 5) & 0x3ffff; T.apb = !!(value & (1 << 25));
    } else return;
    publish(t);
  };
}

/**
 * Lance l'ESP32 émulé. opts : { qemu (chemin de qemu-system-xtensa), flash (image fusionnée de 4 Mo),
 * workDir, trace (sorties vues par la trace), side (canal UART1 de la cale), icount (ex. 'shift=2'),
 * env (variables d'environnement, ex. DYLD_FALLBACK_LIBRARY_PATH), extra (arguments en plus) }.
 */
export async function startEsp32(opts) {
  fs.mkdirSync(opts.workDir, { recursive: true });
  // QEMU écrit dans la flash (NVS, partitions) : on travaille sur une copie.
  const flash = path.join(opts.workDir, 'flash.bin');
  fs.copyFileSync(opts.flash, flash);
  const qmpSrv = await oneShotServer(), sideSrv = opts.side ? await oneShotServer() : null;
  const args = ['-machine', 'esp32', '-display', 'none', '-monitor', 'none',
    '-drive', `file=${flash},if=mtd,format=raw`,
    '-serial', 'stdio',
    ...(sideSrv ? ['-chardev', `socket,id=side,host=127.0.0.1,port=${sideSrv.port}`, '-serial', 'chardev:side'] : []),
    '-chardev', `socket,id=qmp,host=127.0.0.1,port=${qmpSrv.port}`, '-mon', 'chardev=qmp,mode=control',
    ...(opts.trace ? ['-trace', 'memory_region_ops_write'] : []),
    ...(opts.icount ? ['-icount', opts.icount] : []),
    ...(opts.extra || [])];
  const t0 = performance.now();
  const proc = spawn(opts.qemu, args, { env: { ...process.env, ...(opts.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const handlers = { line: [], pin: [], pwm: [], side: [], exit: [] };
  const emit = (k, x) => { for (const fn of handlers[k]) fn(x); };
  let uartText = '', uartLine = '', firstByte = null, stderrTail = '', traceLines = 0;

  proc.stdout.on('data', d => {
    const now = performance.now();
    if (firstByte === null) firstByte = now - t0;
    const s = d.toString('latin1');
    uartText += s;
    for (const ch of s) {
      if (ch === '\n') { emit('line', { text: uartLine.replace(/\r$/, ''), t: now - t0 }); uartLine = ''; } else uartLine += ch;
    }
  });
  const decode = gpioDecoder(e => emit('pin', e), e => emit('pwm', e));
  let errBuf = '';
  proc.stderr.on('data', d => {
    const now = performance.now() - t0;
    errBuf += d.toString('latin1');
    let i;
    while ((i = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1);
      const m = TRACE_RE.exec(line);
      if (m) {
        traceLines++;
        if (m[3] === 'esp32.gpio' || m[3] === 'misc.esp32.ledc') decode(parseInt(m[1], 16), parseInt(m[2], 16), now);
      } else stderrTail = (stderrTail + line + '\n').slice(-4000);
    }
  });
  proc.on('exit', code => emit('exit', code));

  const qmpSock = await qmpSrv.conn;
  const qmp = qmpClient(qmpSock);
  await qmp.greeted;
  await qmp.execute('qmp_capabilities');

  let side = null;
  if (sideSrv) {
    const sock = await sideSrv.conn;
    let acc = Buffer.alloc(0);
    sock.on('data', d => {
      const now = performance.now() - t0;
      acc = Buffer.concat([acc, d]);
      while (acc.length >= 10) {
        const f = acc.subarray(0, 10); acc = acc.subarray(10);
        emit('side', { type: String.fromCharCode(f[0]), pin: f[1], value: f.readUInt32LE(2), us: f.readUInt32LE(6), t: now });
      }
    });
    side = {
      /** Niveaux d'entrée des GPIO 0 à 39 (BigInt, bit n = GPIO n). */
      setInputs(mask) { const b = Buffer.alloc(6); b[0] = 0x49; for (let i = 0; i < 5; i++) b[1 + i] = Number((mask >> BigInt(8 * i)) & 0xffn); sock.write(b); },
      /** Valeur brute de l'ADC (0..4095) lue par analogRead(broche). */
      setAdc(pin, raw) { sock.write(Buffer.from([0x41, pin, raw & 0xff, (raw >> 8) & 0xff])); }
    };
  }

  return {
    proc, qmp, side, t0,
    on(kind, fn) { handlers[kind].push(fn); return () => { const a = handlers[kind]; a.splice(a.indexOf(fn), 1); }; },
    /** Octets reçus par la carte sur son port série (Serial.read). */
    send(s) { proc.stdin.write(s); },
    get uartText() { return uartText; }, get firstByte() { return firstByte; },
    get traceLines() { return traceLines; }, get stderrTail() { return stderrTail; },
    cpu: () => cpuSeconds(proc.pid),
    stop() { try { qmpSock.destroy(); } catch { /* déjà fermée */ } proc.kill('SIGTERM'); }
  };
}

/** Chemin QOM du capteur TMP105 que la machine « esp32 » d'Espressif câble d'office à 0x48 sur I2C0. */
export async function findTmp105(qmp) {
  for (const dir of ['/machine/unattached', '/machine/peripheral-anon', '/machine/peripheral']) {
    let list = [];
    try { list = await qmp.execute('qom-list', { path: dir }); } catch { continue; }
    const hit = list.find(p => p.type === 'child<tmp105>');
    if (hit) return `${dir}/${hit.name}`;
  }
  return null;
}
