// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Comportement des capteurs simulés. Chaque modèle transforme l'environnement
// (température, lumière, distance...) en ce que la carte lit réellement : valeur
// numérique, tension et valeur brute de l'ADC, niveau logique. Il reprend la plage,
// la résolution, l'inertie et la période d'échantillonnage du composant réel.
// `data` porte les grandeurs que lisent les bibliothèques (DHT, BMP280…), `out` la tension
// ou le niveau que chaque broche de sortie du capteur présente à la carte.
import { volts } from './boards.js';
import { tl, DEC } from '../i18n/index.js';
import { GEN_DEFAULT } from './analog-parts.js';

/** Grandeurs de l'environnement simulé, réglables par curseur. */
export const QUANT = {
  temp: { label: tl('Température'), unit: '°C', min: -30, max: 90, step: 0.5, def: 24, dec: 1 },
  hum: { label: tl('Humidité de l’air'), unit: '%', min: 0, max: 100, step: 1, def: 55 },
  press: { label: tl('Pression'), unit: 'hPa', min: 870, max: 1085, step: 1, def: 1013 },
  lux: { label: tl('Lumière'), unit: 'lx', min: 0, max: 2000, step: 10, def: 300 },
  dist: { label: tl('Distance de l’obstacle'), unit: 'cm', min: 1, max: 450, step: 1, def: 50 },
  motion: { label: tl('Quelqu’un bouge devant le capteur'), bool: true, def: 0 },
  soil: { label: tl('Humidité du sol'), unit: '%', min: 0, max: 100, step: 1, def: 40 },
  gas: { label: tl('Gaz / fumée'), unit: 'ppm', min: 0, max: 10000, step: 50, def: 0 },
  sound: { label: tl('Niveau sonore'), unit: 'dB', min: 30, max: 110, step: 1, def: 45 },
  tilt: { label: tl('Inclinaison (axe X)'), unit: '°', min: -90, max: 90, step: 1, def: 0 },
  tiltY: { label: tl('Inclinaison (axe Y)'), unit: '°', min: -90, max: 90, step: 1, def: 0 },
  rotZ: { label: tl('Rotation (axe Z)'), unit: '°/s', min: -250, max: 250, step: 5, def: 0 }
};
export const ENV = Object.fromEntries(Object.entries(QUANT).map(([k, q]) => [k, q.def]));
/** Commandes propres à certains composants d'entrée. */
// Générateur de fonctions : forme, fréquence (Hz), amplitude crête et décalage (V), réglés dans l'onglet Simulation.
export const INPUTS = { button: { pressed: false }, pot: { pos: 50 }, joystick: { x: 0, y: 0, sw: false }, siggen: { ...GEN_DEFAULT } };

export const num = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', DEC).replace('-', '−');
export const fmtQ = q => (QUANT[q].bool ? (ENV[q] ? 'oui' : 'non') : `${num(ENV[q], QUANT[q].dec || 0)} ${QUANT[q].unit}`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const jitter = a => (Math.random() * 2 - 1) * a;
const v2 = v => `${num(v, 2)} V`;
// Valeur brute que rend analogRead() par défaut (10 bits sur le Pico, dont l'ADC en fait 12 : prof.adcRead).
const adcMax = prof => 2 ** (prof.adcRead || prof.adcBits) - 1;
const adc = (v, prof) => { const max = adcMax(prof); return clamp(Math.round(v / prof.vref * max + jitter(1.2)), 0, max); };
const over = (v, prof) => (v > prof.vref + 0.05 ? tl('{0} dépasse la plage de l’ADC ({1}) : valeur saturée, et la broche souffre', v2(v), volts(prof.vref)) : null);

const dht = (name, lo, hi, hlo, hhi, dec, period, tau) => ({
  q: ['temp', 'hum'], period, tau,
  read({ temp, hum }) {
    const n = dec ? 0.1 : 0, T = clamp(temp + jitter(n), lo, hi), H = clamp(hum + jitter(n * 2), hlo, hhi);
    const warn = temp < lo || temp > hi ? tl('température hors de la plage de mesure ({0} à {1} °C)', lo, hi)
      : hum < hlo || hum > hhi ? tl('humidité hors de la plage de mesure ({0} à {1} %)', hlo, hhi) : null;
    const q = v => (dec ? Math.round(v * 10) / 10 : Math.round(v));
    return { value: `${num(T, dec)} °C · ${num(H, dec)} %`, detail: tl('{0} : une trame de 40 bits toutes les {1} s', name, period), short: `${num(T, dec)}°C ${num(H)}%`, warn, data: { temp: q(T), hum: q(H) } };
  }
});

export const MODELS = {
  dht11: dht('DHT11', 0, 50, 20, 90, 0, 1, 4),
  dht22: dht('DHT22', -40, 80, 0, 100, 1, 2, 2.5),
  ds18b20: {
    q: ['temp'], period: 0.75, tau: 1.5,
    read({ temp }, cx) {
      if (cx.flags.nopull) return { value: `${num(-127, 2)} °C`, detail: tl('aucune réponse sur le bus 1-Wire'), warn: tl('sans résistance de tirage, la sonde ne peut pas répondre : la bibliothèque renvoie −127 °C'), level: 'err', short: tl('Err 1-Wire'), data: { temp: -127 } };
      const T = Math.round(clamp(temp, -55, 125) * 16) / 16;
      return { value: `${num(T, 2)} °C`, detail: tl('conversion 12 bits en 750 ms'), short: `${num(T, 1)}°C`, warn: temp < -55 || temp > 125 ? tl('hors de la plage de mesure (−55 à 125 °C)') : null, data: { temp: T } };
    }
  },
  bmp280: {
    q: ['press', 'temp'], period: 0.5, tau: 1,
    read({ press, temp }) {
      const P = press + jitter(0.03), alt = 44330 * (1 - Math.pow(P / 1013.25, 1 / 5.255));
      return { value: `${num(P, 1)} hPa · ${num(temp, 1)} °C`, detail: tl('altitude estimée {0} m', num(alt)), short: `${num(P)} hPa`, data: { press: P, temp: temp + jitter(0.02) } };
    }
  },
  hcsr04: {
    q: ['dist'], period: 0.1, tau: 0.08,
    read({ dist }) {
      if (dist > 400) return { value: tl('hors de portée'), detail: tl('pas d’écho : pulseIn() expire et renvoie 0'), short: tl('--- cm'), data: { dist: 0, us: 0 } };
      if (dist < 2) return { value: tl('trop près'), detail: tl('sous 2 cm, l’écho revient avant la fin de la salve'), short: '< 2 cm', data: { dist: 2, us: 116 } };
      const d = dist + jitter(0.3);
      return { value: `${num(d, 1)} cm`, detail: tl('écho de {0} µs', num(d * 58)), short: `${num(d)} cm`, data: { dist: d, us: d * 58 } };
    }
  },
  pir: {
    q: ['motion'], period: 0.1, tau: 0,
    read({ motion }, cx) {
      if (motion) cx.st.until = cx.t + 3;
      const on = cx.t < (cx.st.until || 0);
      return { value: on ? tl('Mouvement détecté') : tl('Aucun mouvement'), detail: `OUT = ${on ? 'HIGH' : 'LOW'}${on && !motion ? tl(' (temporisation de 3 s)') : ''}`, short: on ? tl('Mouvement !') : tl('Calme'), out: { OUT: { d: on ? 1 : 0, v: on ? 3.3 : 0 } } };
    }
  },
  ldr: {
    q: ['lux'], period: 0.2, tau: 0.3,
    read({ lux }, cx) {
      const R = 15000 * Math.pow(Math.max(lux, 0.05) / 10, -0.7), v = cx.v * R / (R + 10000), raw = adc(v, cx.prof);
      const dout = cx.io.DO ? ` · DO ${v > cx.v / 2 ? tl('HIGH (sombre)') : tl('LOW (éclairé)')}` : '';
      return { value: `AO ${raw} · ${v2(v)}`, detail: tl('{0} lx : plus de lumière, valeur plus basse{1}', num(lux), dout), short: tl('Lum {0}', raw), warn: over(v, cx.prof), out: { AO: { v }, DO: { d: v > cx.v / 2 ? 1 : 0 } } };
    }
  },
  soil: {
    q: ['soil'], period: 0.5, tau: 2,
    read({ soil }, cx) {
      const v = cx.v * (0.8 - 0.47 * soil / 100), raw = adc(v, cx.prof);
      return { value: `AOUT ${raw} · ${v2(v)}`, detail: tl('sol à {0} % : plus humide, valeur plus basse', num(soil)), short: tl('Sol {0}', raw), warn: over(v, cx.prof), out: { AOUT: { v } } };
    }
  },
  mq2: {
    q: ['gas'], period: 0.2, tau: 3,
    read({ gas }, cx) {
      const ratio = gas < 1 ? 9.8 : Math.min(9.8, 26 * Math.pow(gas, -0.48)), v = cx.v * 1000 / (1000 + 2000 * ratio), raw = adc(v, cx.prof);
      const dout = cx.io.DO ? ` · DO ${v > 1.5 ? tl('LOW (alarme)') : 'HIGH'}` : '';
      return { value: `AO ${raw} · ${v2(v)}`, detail: `${num(gas)} ppm · Rs/R0 = ${num(ratio, 2)}${dout}`, short: tl('Gaz {0}', raw), warn: over(v, cx.prof), out: { AO: { v }, DO: { d: v > 1.5 ? 0 : 1 } } };
    }
  },
  sound: {
    q: ['sound'], period: 0.1, tau: 0.1,
    read({ sound }, cx) {
      const amp = Math.min(cx.v / 2, 0.003 * Math.pow(10, (sound - 30) / 20)), mid = adc(cx.v / 2, cx.prof), d = Math.round(amp / cx.prof.vref * adcMax(cx.prof));
      const dout = cx.io.DO ? ` · DO ${sound > 70 ? 'HIGH' : 'LOW'}` : '';
      return { value: `AO ${mid} ± ${d}`, detail: tl('{0} dB : l’amplitude suit le volume{1}', num(sound), dout), short: tl('Son ±{0}', d), out: { AO: { v: cx.v / 2 + amp * Math.sin(cx.t * 2 * Math.PI * 7.3) }, DO: { d: sound > 70 ? 1 : 0 } } };
    }
  },
  mpu6050: {
    q: ['tilt', 'tiltY', 'rotZ', 'temp'], period: 0.05, tau: 0.1,
    read({ tilt, tiltY = 0, rotZ = 0, temp }, cx) {
      // Gravité vue par la puce : tilt penche l'axe X, tiltY l'axe Y. Le gyroscope mesure la vitesse de rotation
      // (rad/s, comme la bibliothèque Adafruit) : la variation des inclinaisons depuis la lecture précédente.
      const r = tilt * Math.PI / 180, ry = tiltY * Math.PI / 180, st = cx.st, dt = st.gt != null ? cx.t - st.gt : 0;
      const ax = Math.sin(r) + jitter(0.01), ay = Math.sin(ry) * Math.cos(r) + jitter(0.01), az = Math.cos(r) * Math.cos(ry) + jitter(0.01);
      const rate = (now, was) => (dt > 0 && was != null ? (now - was) / dt * Math.PI / 180 : 0);
      // Rotation autour de Z (cap) : réglée directement en °/s. Additionner gz pour connaître le cap dérive avec le
      // temps, sur la vraie puce aussi (petite erreur du gyroscope qui s'accumule) : il faut un magnétomètre pour un cap absolu.
      const gx = rate(tiltY, st.gy0) + jitter(0.002), gy = rate(tilt, st.gx0) + jitter(0.002), gz = rotZ * Math.PI / 180 + jitter(0.002);
      st.gt = cx.t; st.gx0 = tilt; st.gy0 = tiltY;
      const detail = tl('inclinaison X {0}° · Y {1}° · rotation Z {2} °/s · puce à {3} °C', num(tilt), num(tiltY), num(rotZ), num(temp, 1)) + (rotZ ? tl(' · le cap calculé en additionnant gz dérive, comme sur la vraie puce') : '');
      return { value: tl('ax {0} g · ay {1} g · az {2} g', num(ax, 2), num(ay, 2), num(az, 2)), detail, short: `${num(tilt)}° ${num(tiltY)}°`, data: { ax, ay, az, gx, gy, gz, temp, tilt, tiltY, rotZ } };
    }
  },
  button: {
    q: [], period: 0.05,
    read(p, cx) {
      // Patte reliée à la carte : la 1 d'habitude, la 2 si le bouton est monté dans l'autre sens.
      const key = cx.io['1'] ? '1' : '2', pin = cx.io[key];
      const value = cx.inp.pressed ? tl('Appuyé') : tl('Relâché'), short = `BTN ${cx.inp.pressed ? 'ON' : 'OFF'}`;
      if (!pin) return { value, detail: cx.inp.pressed ? tl('interrupteur fermé : le courant passe') : tl('interrupteur ouvert : le courant ne passe pas'), short };
      const n = cx.A.net({ comp: cx.comp, key }), w = cx.A.wnet({ comp: cx.comp, key });
      let lvl;
      if (n.gnd.length) lvl = 'LOW';
      else if (n.src.length) lvl = 'HIGH';
      else if (w.src.length) lvl = tl('HIGH (tirage externe)');
      else if (w.gnd.length) lvl = tl('LOW (rappel externe)');
      else if (pin.g.caps.has('pu')) lvl = 'HIGH (INPUT_PULLUP)';
      else return { value, detail: `${pin.key} flottante`, short, warn: tl('{0} n’a pas de tirage interne : l’entrée flotte au repos', pin.key) };
      return { value, detail: `${pin.key} = ${lvl}`, short };
    }
  },
  pot: {
    q: [], period: 0.1,
    read(p, cx) {
      const V = k => { const n = cx.A.net({ comp: cx.comp, key: k }); return n.src.length ? Math.max(...n.src.map(s => s.v)) : n.gnd.length ? 0 : null; };
      const a = V('1'), b = V('3'), pos = (cx.inp.pos ?? 50) / 100;
      if (a == null || b == null) return { value: tl('extrémité non reliée'), detail: tl('reliez 1 à la masse et 3 à l’alimentation'), warn: tl('la tension du curseur flotte') };
      const v = a + (b - a) * pos, raw = adc(v, cx.prof);
      return { value: `W ${raw} · ${v2(v)}`, detail: tl('curseur à {0} %', num(pos * 100)), short: tl('Pot {0}', raw), warn: over(v, cx.prof), out: { W: { v } } };
    }
  },
  joystick: {
    q: [], period: 0.05,
    read(p, cx) {
      const rx = adc(cx.v * (0.5 + (cx.inp.x || 0) / 200), cx.prof), ry = adc(cx.v * (0.5 + (cx.inp.y || 0) / 200), cx.prof);
      return { value: `X ${rx} · Y ${ry}`, detail: `SW ${cx.inp.sw ? tl('appuyé (LOW)') : tl('relâché (HIGH)')}`, short: `X${rx} Y${ry}`, warn: over(cx.v, cx.prof),
        out: { VRx: { v: cx.v * (0.5 + (cx.inp.x || 0) / 200) }, VRy: { v: cx.v * (0.5 + (cx.inp.y || 0) / 200) }, ...(cx.inp.sw ? { SW: { d: 0, v: 0 } } : {}) } };
    }
  },
  oled: { display: true, q: [] },
  lcd1602: { display: true, q: [] }
};

/** Fait évoluer la grandeur physique vue par le capteur vers la consigne, avec son inertie. */
export function advance(comp, m, dt) {
  const st = comp.simS || (comp.simS = { phy: {}, next: 0, out: null, pulse: 0 });
  for (const q of m.q) {
    const target = +ENV[q];
    if (st.phy[q] == null || !m.tau) st.phy[q] = target;
    else st.phy[q] += (target - st.phy[q]) * (1 - Math.exp(-dt / m.tau));
  }
  return st;
}
/** Lit le capteur à sa propre cadence ; entre deux lectures, la carte garde l'ancienne valeur. */
export function sample(comp, m, cx, t) {
  const st = comp.simS;
  if (st.out && t < st.next) return { ...st.out, sampled: false };
  st.next = t + m.period;
  const out = m.read(st.phy, { ...cx, st, t, comp, inp: comp.inp || {} });
  const q = m.q[0], Q = q && QUANT[q];
  out.trend = Q && !Q.bool ? Math.sign(Math.round((ENV[q] - st.phy[q]) / Q.step)) : 0;
  st.out = out;
  return { ...out, sampled: true };
}

/* ---------- Périphériques commandés depuis l'onglet Simulation ---------- */
// Télécommande infrarouge, badges RFID, clavier matriciel, téléphone Bluetooth (HC-05), téléphone GSM (SIM800),
// radio nRF24 : l'élève agit dans le panneau « Périphériques » (sim/peripherals.js) et le programme de la carte le
// lit par sa bibliothèque (prog/runtime.js). L'état partagé vit sur le composant (c.periph), comme l'image d'un
// écran (c.progScreen) ; ver augmente à chaque changement visible, seq à chaque évènement (appui, badge posé…).

/** Télécommande « Car MP3 » à 21 touches, protocole NEC, adresse 0x00 : libellé, commande, nom de la touche. */
export const IR_KEYS = [
  ['CH−', 0x45, 'CH-'], ['CH', 0x46], ['CH+', 0x47],
  ['⏮', 0x44, 'PREV'], ['⏭', 0x40, 'NEXT'], ['⏯', 0x43, 'PLAY/PAUSE'],
  ['−', 0x07, 'VOL-'], ['+', 0x15, 'VOL+'], ['EQ', 0x09],
  ['0', 0x16], ['100+', 0x19], ['200+', 0x0d],
  ['1', 0x0c], ['2', 0x18], ['3', 0x5e], ['4', 0x08], ['5', 0x1c], ['6', 0x5a], ['7', 0x42], ['8', 0x52], ['9', 0x4a]
].map(([label, cmd, name]) => ({ label, cmd, name: name || label }));
/** Badges RFID (MIFARE Classic 1K) : UID de 4 octets. */
export const BADGES = [
  { uid: [0xde, 0xad, 0xbe, 0xef], label: tl('Badge bleu'), color: '#3d7be0' },
  { uid: [0x12, 0x34, 0x56, 0x78], label: tl('Carte blanche'), color: '#e6eaee' },
  { uid: [0xa1, 0xb2, 0xc3, 0xd4], label: tl('Porte-clés rouge'), color: '#d9453b' }
];
/** Touches imprimées sur le clavier 4×4, ligne par ligne (R1 à R4, colonnes C1 à C4). */
export const KEYPAD_KEYS = ['123A', '456B', '789C', '*0#D'];
export const hex2 = b => (b & 255).toString(16).toUpperCase().padStart(2, '0');
/** Numéro du téléphone simulé (SMS reçus et envoyés au module GSM). */
export const PHONE = '+221770000000';

const PERIPH = {
  ir: () => ({ frames: [] }),
  rc522: () => ({ card: null }),
  keypad: () => ({ down: null, last: null }),
  nrf24: () => ({ on: false, listening: false, channel: 76, rate: 0, pipes: [], tx: null, rx: [], payload: 32, dyn: false, ack: true, sent: 0, got: 0 }),
  hc05: () => ({ toBoard: '', log: [], line: '', mode: 'data' }),
  sim800: () => ({ toBoard: '', echo: true, text: false, buf: '', sms: null, lf: false, inbox: [], sent: [], call: null, incoming: null, clip: false, cnmi: 0, mr: 0, hint: null })
};
/** État partagé d'un périphérique (créé au premier usage). */
export function periph(c) {
  if (!c.periph) c.periph = { ver: 0, seq: 0, ...(PERIPH[c.type] ? PERIPH[c.type]() : {}) };
  return c.periph;
}
/** Télécommande : une trame NEC (repeat : trame de répétition envoyée tant que la touche reste enfoncée). */
export function irPress(c, cmd, repeat = false) {
  const st = periph(c);
  st.frames.push({ seq: ++st.seq, cmd, addr: 0, repeat });
  if (st.frames.length > 16) st.frames.shift();
  st.ver++;
}
/** Pose un badge sur le lecteur (ou le retire s'il y est déjà) : chaque pose est une nouvelle présentation. */
export function presentBadge(c, i) {
  const st = periph(c);
  st.card = st.card === i ? null : i;
  if (st.card != null) st.seq++;
  st.ver++;
}
/** Clavier : touche (ligne r, colonne col) enfoncée, puis relâchée. */
export function keypadDown(c, r, col) { const st = periph(c); st.down = { r, c: col }; st.last = st.down; st.seq++; st.ver++; }
export function keypadUp(c) { const st = periph(c); st.down = null; st.ver++; }

/** Octets reçus à une vitesse différente de celle du module : du charabia. */
const garble = s => s.replace(/[\s\S]/g, ch => String.fromCharCode(0x80 + ((ch.charCodeAt(0) * 37 + 11) & 0x7f)));
const smsDate = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${p(d.getFullYear() % 100)}/${p(d.getMonth() + 1)}/${p(d.getDate())},${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+00`; };

/**
 * Module série (HC-05, SIM800) relié à une liaison série de la carte : write(texte, bauds, t) reçoit ce que la carte
 * envoie, drain(bauds, t) rend ce que le module a envoyé à la carte depuis la dernière lecture (t : heure de la carte, ms).
 */
export function serialDevice(c) {
  const st = periph(c);
  if (!st.dev) st.dev = c.type === 'sim800' ? sim800(st) : hc05(st, c);
  return st.dev;
}
/**
 * Conversation texte avec un téléphone (HC-05, BluetoothSerial de l'ESP32) sur l'état o : { log, line, toBoard, ver }.
 * La carte écrit ligne par ligne dans la conversation ; ce que le téléphone envoie attend dans toBoard.
 */
function chat(o) {
  const log = (who, text) => { o.log.push({ who, text }); if (o.log.length > 120) o.log.shift(); o.ver++; };
  return {
    fromBoard(s) {
      o.line += s;
      const parts = o.line.split('\n'); o.line = parts.pop();
      if (o.line.length > 200) { parts.push(o.line); o.line = ''; }
      for (const p of parts) log('board', p.replace(/\r$/, ''));
      o.ver++;
    },
    take() { const s = o.toBoard; o.toBoard = ''; return s; },
    phone(text, eol = '\n') { o.toBoard = (o.toBoard + text + eol).slice(-4096); log('phone', text); }
  };
}
/** Réglages d'usine du HC-05 (gardés dans le module, donc avec le projet : c.inp). */
const BT_DEFAULT = { btName: 'HC-05', btPswd: '1234', btUart: 9600, btRole: 0 };
const BAUDS = [4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1382400];
/** Adresse Bluetooth ou MAC tirée de l'identifiant du composant (toujours la même pour un projet). */
export function hashBytes(id, n) {
  let h = 2166136261 >>> 0;
  for (const ch of String(id || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) { out.push(h & 255); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; }
  return out;
}
/** Adresse MAC Wi-Fi d'une carte : préfixe du fabricant (Espressif), puis trois octets propres à la carte. */
export function macOf(b) {
  const pre = b.type === 'nodemcu' ? [0x5c, 0xcf, 0x7f] : [0x24, 0x0a, 0xc4];
  return [...pre, ...hashBytes(b.id, 3)].map(hex2).join(':');
}
/**
 * HC-05 : liaison série sans fil vers un téléphone. Mode données à 9600 bauds (réglage d'usine) ; si EN (KEY) est au
 * niveau haut à la mise sous tension, mode commandes AT à 38400 bauds, téléphone déconnecté.
 */
function hc05(st, c) {
  const cfg = () => { if (!c.inp) c.inp = {}; for (const [k, v] of Object.entries(BT_DEFAULT)) if (c.inp[k] == null) c.inp[k] = v; return c.inp; };
  const talk = chat(st);
  st.mode = st.mode || 'data'; st.atBuf = '';
  const reply = s => { st.toBoard = (st.toBoard + s + '\r\n').slice(-4096); };
  function exec(cmd) {
    const C = cmd.toUpperCase(), q = v => String(v).replace(/^"|"$/g, '');
    let m;
    const k = cfg();
    if (C === 'AT') reply('OK');
    else if (C === 'AT+NAME?') reply(`+NAME:${k.btName}\r\nOK`);
    else if ((m = /^AT\+NAME=(.{1,32})$/i.exec(cmd))) { k.btName = q(m[1]); st.ver++; reply('OK'); }
    else if (C === 'AT+PSWD?' || C === 'AT+PIN?') reply(`+PSWD:${k.btPswd}\r\nOK`);
    else if ((m = /^AT\+(?:PSWD|PIN)=("?\w{1,16}"?)$/i.exec(cmd))) { k.btPswd = q(m[1]); reply('OK'); }
    else if (C === 'AT+UART?') reply(`+UART:${k.btUart},0,0\r\nOK`);
    else if ((m = /^AT\+UART=(\d+),\d,\d$/.exec(C))) { if (BAUDS.includes(+m[1])) { k.btUart = +m[1]; reply('OK'); } else reply('ERROR:(1D)'); }
    else if (C === 'AT+ROLE?') reply(`+ROLE:${k.btRole}\r\nOK`);
    else if ((m = /^AT\+ROLE=([012])$/.exec(C))) { k.btRole = +m[1]; reply('OK'); }
    else if (C === 'AT+VERSION?') reply('+VERSION:2.0-20100601\r\nOK');
    else if (C === 'AT+ADDR?') { const a = hashBytes(c.id, 6).map(hex2).join('').toLowerCase(); reply(`+ADDR:${a.slice(0, 4)}:${a.slice(4, 6)}:${a.slice(6)}\r\nOK`); }
    else if (C === 'AT+STATE?') reply('+STATE:INITIALIZED\r\nOK');
    else if (C === 'AT+ORGL') { Object.assign(k, BT_DEFAULT); st.ver++; reply('OK'); }
    else if (C === 'AT+RESET') reply('OK');
    else if (/^AT\+\w+(\?|=.*)?$/.test(C)) reply('OK');
    else reply('ERROR:(0)');
  }
  return {
    /** Vitesse attendue : 38400 bauds en mode AT, celle réglée par AT+UART (9600 d'usine) en mode données. */
    get baud() { return st.mode === 'at' ? 38400 : cfg().btUart; },
    get name() { return cfg().btName; },
    /** Mise sous tension (liaison ouverte par la carte) : EN au niveau haut → mode AT. */
    power(at) { if (st.mode !== (at ? 'at' : 'data')) { st.mode = at ? 'at' : 'data'; st.atBuf = ''; st.ver++; } },
    write(s, baud) {
      if (baud && baud !== this.baud) s = garble(s);
      if (st.mode !== 'at') { talk.fromBoard(s); return; }
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') { const cmd = st.atBuf.trim(); st.atBuf = ''; if (cmd) exec(cmd); continue; }
        st.atBuf = (st.atBuf + ch).slice(-80);
      }
    },
    drain(baud) { const s = talk.take(); return s && baud && baud !== this.baud ? garble(s) : s; },
    // Téléphone → carte : ce qu'on écrit dans la conversation arrive sur la broche RX de la carte (pas en mode AT).
    phone(text, eol = '\n') { if (st.mode === 'at') return false; talk.phone(text, eol); return true; }
  };
}
/** Port Bluetooth de l'ESP32 (BluetoothSerial) : nom annoncé et conversation avec le téléphone, sur l'état de la carte. */
export function btSerial(b) {
  const st = periph(b);
  if (!st.bt) { st.bt = { name: '', on: false, log: [], line: '', toBoard: '', ver: 0 }; st.btDev = chat(st.bt); }
  return { st: st.bt, ...st.btDev };
}
/**
 * SIM800L : répond aux commandes AT comme le vrai module (écho, puis réponse encadrée de \r\n). SMS en mode texte
 * (AT+CMGF=1, AT+CMGS="numéro", texte terminé par le caractère 26), lecture des SMS reçus (AT+CMGR), appels (ATD, ATH).
 */
function sim800(st) {
  const out = s => { st.toBoard += s; if (st.toBoard.length > 4096) st.toBoard = st.toBoard.slice(-4096); };
  const ok = (pre = '') => out(`${pre ? `\r\n${pre}\r\n` : ''}\r\nOK\r\n`);
  const error = () => out('\r\nERROR\r\n');
  const smsLine = m => `+CMGR: "${m.read ? 'REC READ' : 'REC UNREAD'}","${m.from}","","${m.date}"\r\n${m.text}`;
  function exec(cmd) {
    const C = cmd.toUpperCase();
    if (!C.startsWith('AT')) { error(); return; }
    const r = cmd.slice(2), R = C.slice(2);
    let m;
    if (!r) ok();
    else if ((m = /^E([01])$/.exec(R))) { st.echo = m[1] === '1'; ok(); }
    else if (R === 'I') ok('SIM800 R14.18');
    else if (R === '+CSQ') ok('+CSQ: 20,0');
    else if (R === '+CREG?') ok('+CREG: 0,1');
    else if (R === '+CPIN?') ok('+CPIN: READY');
    else if (R === '+COPS?') ok('+COPS: 0,0,"SIMUL GSM"');
    else if (R === '+CCID') ok('8922100000000000000');
    else if (R === '+CBC') ok('+CBC: 0,85,4000');
    else if ((m = /^\+CMGF=([01])$/.exec(R))) { st.text = m[1] === '1'; ok(); }
    else if (R === '+CMGF?') ok(`+CMGF: ${st.text ? 1 : 0}`);
    else if ((m = /^\+CNMI=\d,(\d)/.exec(R))) { st.cnmi = +m[1]; ok(); }
    else if ((m = /^\+CMGS="([^"]*)"/i.exec(r))) {
      // Sans AT+CMGF=1, le module attend un SMS codé en PDU : le texte est refusé.
      if (!st.text) { st.hint = 'cmgf'; st.ver++; error(); return; }
      st.sms = { to: m[1], text: '' }; st.lf = true; out('\r\n> ');
    }
    else if ((m = /^\+CMGR=(\d+)/.exec(R))) {
      const msg = st.inbox.find(x => x.idx === +m[1]);
      if (msg) { ok(smsLine(msg)); msg.read = true; st.ver++; } else ok();
    }
    else if (/^\+CMGL/.test(R)) { const list = st.inbox.map(x => `+CMGL: ${x.idx},${smsLine(x).slice(7)}`).join('\r\n'); st.inbox.forEach(x => { x.read = true; }); ok(list); }
    else if ((m = /^\+CMGD=(\d+)/.exec(R))) { st.inbox = st.inbox.filter(x => x.idx !== +m[1]); st.ver++; ok(); }
    else if (/^\+CMGDA=/.test(R)) { st.inbox = []; st.ver++; ok(); }
    else if ((m = /^D\s*([+\d*#]+);?$/.exec(R))) { st.call = { number: m[1], voice: R.endsWith(';'), dir: 'out' }; st.ver++; ok(); }
    else if (R === 'H' || R === 'H0') { st.call = null; st.incoming = null; st.ver++; ok(); }
    // ATA : décroche l'appel qui sonne.
    else if (R === 'A') { if (st.incoming) { st.call = { number: st.incoming.number, dir: 'in' }; st.incoming = null; st.ver++; ok(); } else if (st.call) ok(); else out('\r\nNO CARRIER\r\n'); }
    else if ((m = /^\+CLIP=([01])$/.exec(R))) { st.clip = m[1] === '1'; ok(); }
    else if (/^(\+\w+(=.*|\?)?|&W|Z)$/.test(R)) ok(); // réglages acceptés sans effet (AT+CMEE=2, AT+CSCS="GSM"…)
    else error();
  }
  return {
    // Carte → module : commandes AT, puis texte du SMS après l'invite « > ».
    write(s) {
      for (const ch of s) {
        if (st.sms) {
          if (st.lf && ch === '\n') { st.lf = false; continue; } // fin de la ligne AT+CMGS envoyée par println
          st.lf = false;
          if (ch === '\x1a') {
            st.sent.push({ to: st.sms.to, text: st.sms.text.replace(/[\r\n]+$/, ''), date: smsDate() }); st.sms = null;
            if (st.sent.length > 50) st.sent.shift();
            st.ver++; ok(`+CMGS: ${++st.mr}`);
          } else if (ch === '\x1b') { st.sms = null; ok(); }
          else { st.sms.text += ch; if (st.echo) out(ch); }
          continue;
        }
        if (ch === '\r' || ch === '\n') {
          const cmd = st.buf.trim(); st.buf = '';
          if (cmd) { if (st.echo) out(cmd + '\r'); exec(cmd); }
          continue;
        }
        st.buf += ch;
        if (st.buf.length > 560) st.buf = st.buf.slice(-560);
      }
    },
    // Appel entrant : RING toutes les 3 s (et le numéro avec AT+CLIP=1) tant que la carte n'a pas décroché (ATA).
    drain(baud, t = 0) {
      const inc = st.incoming;
      if (inc && (inc.next == null || t >= inc.next)) {
        out(`\r\nRING\r\n${st.clip ? `\r\n+CLIP: "${inc.number}",145,"",0,"",0\r\n` : ''}`);
        inc.next = (inc.next == null ? t : inc.next) + 3000;
      }
      const s = st.toBoard; st.toBoard = ''; return s;
    },
    /** Le téléphone appelle la carte. */
    ring(from = PHONE) { if (st.call || st.incoming) return; st.incoming = { number: from, next: null }; st.ver++; },
    /** SMS envoyé par le téléphone simulé au module : notifié à la carte (+CMTI, ou +CMT avec AT+CNMI=2,2). */
    receive(text, from = PHONE) {
      const date = smsDate();
      if (st.cnmi === 2) { out(`\r\n+CMT: "${from}","","${date}"\r\n${text}\r\n`); st.ver++; return; }
      const idx = st.inbox.reduce((a, x) => Math.max(a, x.idx), 0) + 1;
      st.inbox.push({ idx, from, text, date, read: false }); st.ver++;
      out(`\r\n+CMTI: "SM",${idx}\r\n`);
    },
    /** Le téléphone raccroche : la carte reçoit NO CARRIER. */
    hangUp() { if (!st.call && !st.incoming) return; st.call = null; st.incoming = null; st.ver++; out('\r\nNO CARRIER\r\n'); }
  };
}

/* ---------- Bac à sable réseau (Wi-Fi, web, HTTP) ---------- */
// Aucun accès au vrai réseau : les cartes voient les réseaux Wi-Fi de la carte « Réseau Wi-Fi », se parlent entre elles
// (serveurs web, ESP-NOW) et n'atteignent que trois sites fictifs : meteo.jollof, journal.jollof et heure.jollof.

/** Réseaux Wi-Fi simulés (enregistrés avec le projet) : celui de l'école, modifiable, et deux voisins. */
export const NET_DEFAULT = () => ({
  networks: [
    { ssid: 'Ecole-WiFi', pass: 'jollof2024', rssi: -52 },
    { ssid: 'Voisin-4G', pass: 'mangue-sucree', rssi: -74 },
    { ssid: 'Biblio-Publique', pass: '', rssi: -83 }
  ],
  journal: []
});
export const FAKE_HOSTS = ['meteo.jollof', 'journal.jollof', 'heure.jollof'];

/** Découpe une adresse http://hôte:port/chemin?a=1 ; null si elle n'en est pas une. */
export function parseUrl(url) {
  const m = /^(https?):\/\/([^/:?#\s]+)(?::(\d+))?([^?#\s]*)(?:\?([^#\s]*))?/i.exec(String(url || '').trim());
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] ? +m[3] : m[1].toLowerCase() === 'https' ? 443 : 80, path: m[4] || '/', query: m[5] || '' };
}
/** Champs d'une requête : a=1&b=deux+mots → [['a', '1'], ['b', 'deux mots']]. */
export function parseQuery(q) {
  const out = [];
  for (const part of String(q || '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('='), dec = x => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } };
    out.push(i < 0 ? [dec(part), ''] : [dec(part.slice(0, i)), dec(part.slice(i + 1))]);
  }
  return out;
}
const VILLES = { dakar: ['Dakar', 0, 0, 16], thies: ['Thiès', 2, -10, 11], 'saint-louis': ['Saint-Louis', -1.5, 6, 21] };
const villeKey = v => String(v || 'dakar').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^st[ -]?/, 'saint-').replace(/\s+/g, '-').replace(/^saintlouis$/, 'saint-louis');
const r1 = v => Math.round(v * 10) / 10;
/**
 * Réponse d'un site fictif, ou null pour un autre hôte. net : réseau du projet (journal) ; body : corps d'un POST.
 * Rend { code, type, body }.
 */
export function fakeHttp(method, u, body, net) {
  const json = (code, o) => ({ code, type: 'application/json', body: JSON.stringify(o) });
  const args = new Map(parseQuery(u.query).concat(method === 'POST' ? parseQuery(body) : []));
  if (u.host === 'meteo.jollof') {
    // Météo cohérente avec l'environnement simulé : Dakar a la température et l'humidité réglées par les curseurs.
    const k = villeKey(args.get('ville') || args.get('city') || args.get('q') || u.path.replace(/^\/(texte\/?)?|\/$|\.txt$/g, '') || 'dakar'), v = VILLES[k];
    if (!v) return json(404, { erreur: 'ville inconnue', villes: Object.values(VILLES).map(x => x[0]) });
    const t = r1(ENV.temp + v[1]), h = Math.max(0, Math.min(100, Math.round(ENV.hum + v[2]))), ciel = h > 85 ? 'pluie' : h > 65 ? 'nuageux' : 'ensoleillé';
    if (/^\/texte/.test(u.path) || args.get('format') === 'texte') return { code: 200, type: 'text/plain', body: `${t};${h}` };
    return json(200, { ville: v[0], temperature: t, humidite: h, pression: Math.round(ENV.press), vent_kmh: v[3], ciel });
  }
  if (u.host === 'heure.jollof') {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    return json(200, { datetime: `${date}T${time}`, date, heure: d.getUTCHours(), minute: d.getUTCMinutes(), seconde: d.getUTCSeconds(), jour: d.getUTCDay(), unixtime: Math.floor(d.getTime() / 1000), fuseau: 'Africa/Dakar' });
  }
  if (u.host === 'journal.jollof') {
    // Comme ThingSpeak : /update?field1=…&field2=… range une mesure et rend son numéro (0 si rien à ranger).
    const list = net.journal || (net.journal = []);
    if (/^\/update/.test(u.path)) {
      const f = {};
      for (let i = 1; i <= 8; i++) { const v = args.get('field' + i); if (v != null && v !== '' && Number.isFinite(+v)) f['field' + i] = +v; }
      if (!Object.keys(f).length) return { code: 200, type: 'text/plain', body: '0' };
      const id = (list.length ? list[list.length - 1].id : 0) + 1;
      list.push({ id, t: Date.now(), f });
      if (list.length > 200) list.splice(0, list.length - 200);
      net.ver = (net.ver || 0) + 1;
      return { code: 200, type: 'text/plain', body: String(id) };
    }
    if (/feeds\.json$|^\/(last)?$/.test(u.path)) {
      const n = Math.max(1, Math.min(100, +args.get('results') || 20)), feeds = list.slice(-n).map(e => ({ entry_id: e.id, created_at: new Date(e.t).toISOString().replace(/\.\d+Z$/, 'Z'), ...e.f }));
      return json(200, /last/.test(u.path) ? feeds[feeds.length - 1] || {} : { channel: { name: 'Journal Jollof', last_entry_id: list.length ? list[list.length - 1].id : 0 }, feeds });
    }
    return json(404, { erreur: 'adresse inconnue' });
  }
  return null;
}

/**
 * Page servie par un programme, avant de l'afficher dans le « Navigateur » (cadre sans scripts, sandbox). Frontière de
 * sécurité : le HTML écrit par un élève ne doit jamais exécuter de script dans l'application ni charger quoi que ce soit
 * d'extérieur. On retire donc les éléments actifs (<script>, <iframe>, <object>, <embed>, <svg>, <link>, <base>, <meta>,
 * dont <meta refresh>…), les attributs on…="…", les adresses javascript:/data: (sauf images data:) et toute adresse
 * extérieure (src, href, action vers un autre hôte que le réseau local), ainsi que url(…) et @import dans les styles.
 * Chaque balise gardée est réécrite à partir de ses seuls attributs permis : une balise mal formée ne passe pas.
 */
const DROP_ALL = 'script|style\\b(?=[^>]*\\bnonce)|iframe|frame|frameset|object|embed|applet|noscript|template|svg|math|xmp|plaintext|noembed|noframes';
const KEEP = new Set(['html', 'head', 'body', 'title', 'style', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'big',
  'sub', 'sup', 'mark', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'form', 'input', 'button', 'label',
  'select', 'option', 'optgroup', 'textarea', 'fieldset', 'legend', 'img', 'pre', 'code', 'kbd', 'blockquote', 'center', 'font', 'section', 'header', 'footer', 'nav', 'main',
  'article', 'aside', 'figure', 'figcaption', 'meter', 'progress', 'details', 'summary', 'abbr', 'time', 'output']);
const ATTRS = new Set(['href', 'src', 'alt', 'title', 'class', 'id', 'style', 'name', 'value', 'type', 'action', 'method', 'placeholder', 'checked', 'selected', 'disabled',
  'min', 'max', 'step', 'size', 'maxlength', 'width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'color', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'for',
  'rows', 'cols', 'readonly', 'required', 'label', 'multiple', 'face', 'low', 'high', 'optimum', 'open', 'lang', 'dir']);
const LOCAL_HOST = /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|[\w-]+\.local)(:\d+)?$/i;
const cleanCss = css => String(css).replace(/\\/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;?/gi, '').replace(/url\s*\([^)]*\)?/gi, 'none').replace(/expression\s*\(|behavior\s*:|-moz-binding|javascript:/gi, 'x');
function cleanUrl(v, img) {
  // Entités décodées d'abord : « javascript&#58;… » ne doit pas passer pour un chemin relatif.
  const t = String(v).replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCharCode(parseInt(h, 16) & 0xffff)).replace(/&#(\d+);?/g, (m, d) => String.fromCharCode(+d & 0xffff))
    .replace(/&colon;/gi, ':').replace(/&(tab|newline);/gi, '').replace(/[\x00-\x20\x7f\\]+/g, '');
  if (img) return /^data:image\/(png|gif|jpe?g|webp|bmp);base64,[a-z0-9+/=]+$/i.test(t) ? t : null;
  if (/^#/.test(t) || (/^[^:]*$/.test(t) && !/^\/\//.test(t))) return t; // ancre ou chemin relatif (/on, page.html, ?a=1)
  const m = /^https?:\/\/([^/?#]+)/i.exec(t);
  return m && LOCAL_HOST.test(m[1]) ? t : null;
}
export function cleanHtml(html) {
  let s = String(html || '').slice(0, 200000).replace(/\x00/g, '');
  const styles = [];
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/gi, '').replace(/<![^>]*>/g, '').replace(/<\?[\s\S]*?(\?>|$)/g, '');
  // Éléments actifs, avec leur contenu (et jusqu'à la fin s'ils ne sont jamais fermés).
  s = s.replace(new RegExp(`<(${DROP_ALL})\\b[\\s\\S]*?(<\\/\\1\\s*>|$)`, 'gi'), '');
  // Feuilles de style mises de côté pendant la réécriture des balises (leurs « > » restent des sélecteurs).
  s = s.replace(/<style\b([^>]*)>([\s\S]*?)(<\/style\s*>|$)/gi, (m, a, css) => `\x00${styles.push(cleanCss(css).replace(/</g, '')) - 1}\x00`);
  s = s.replace(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|<|>/g, (m, close, name, attrs, self) => {
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    const tag = name.toLowerCase();
    if (!KEEP.has(tag)) return '';
    if (close) return `</${tag}>`;
    if (tag === 'style') return '<style>';
    let out = '';
    const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = re.exec(attrs))) {
      const an = a[1].toLowerCase(); let v = a[2] ?? a[3] ?? a[4] ?? '';
      if (!ATTRS.has(an)) continue;
      if (an === 'href' || an === 'action') { v = cleanUrl(v, false); if (v == null) v = '#bloque'; }
      if (an === 'src') { v = cleanUrl(v, true); if (v == null) continue; }
      if (an === 'style') v = cleanCss(v);
      out += ` ${an}="${v.replace(/&(?!#?\w+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
    }
    return `<${tag}${out}${self ? ' /' : ''}>`;
  });
  return s.replace(/\x00(\d+)\x00/g, (m, i) => `<style>${styles[+i]}</style>`);
}
