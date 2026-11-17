// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Modules série du montage, partagés par l'interpréteur (HardwareSerial, SoftwareSerial de src/prog/runtime.js) et par
// les processeurs émulés (src/emu/devices/uart.js) : GPS u-blox NEO-6M, radio HC-12 (433 MHz), émetteur-récepteur
// RS-485 MAX485. Chacun a la même forme que les modules série de models.js (serialDevice) :
//   write(texte, bauds de la carte, t) : ce que la carte envoie au module ; drain(bauds, t) : ce que le module a envoyé
//   à la carte depuis la dernière lecture ; baud : vitesse du module (null : celle de l'émetteur, RS-485) ;
//   bind(ctx) : le moteur de la carte donne { peers(types) → [{ comp, ok }], level(broche du module) → 1 | 0 | null,
//   linked(broche) → [{ comp, key }] } (autres modules du montage, niveau de SET, DE, RE, nœuds A et B).
// t : heure de la carte (ms de temps virtuel). Les réglages gardés par le module (canal, vitesse du HC-12 ; position et
// démarrage à froid du GPS) vivent dans c.inp, enregistrés avec le projet.
// Chiffres : NMEA 0183 et protocole u-blox 6 (trames par défaut, 9600 bauds, 1 Hz), notice du HC-12 (commandes AT),
// fiche du MAX485 ; voir check/sources.js (neo6mUblox, hc12Manual, maximMax485).

/** Broches série de chaque module, côté module : in reçoit la sortie TX de la carte, out va sur son entrée RX. */
export const SERIAL_PINS = {
  hc05: { in: 'RXD', out: 'TXD' }, sim800: { in: 'RXD', out: 'TXD' },
  neo6m: { in: 'RX', out: 'TX', oneWay: true }, hc12: { in: 'RXD', out: 'TXD' }, max485: { in: 'DI', out: 'RO' }
};
export const SERIAL_TYPES = Object.keys(SERIAL_PINS);

const garble = s => s.replace(/[\s\S]/g, ch => String.fromCharCode(0x80 + ((ch.charCodeAt(0) * 37 + 11) & 0x7f)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const p2 = n => String(n).padStart(2, '0');

/* ---------- GPS NEO-6M ---------- */
/**
 * Réglages du GPS simulé (c.inp) : position de départ (degrés décimaux, nord et est positifs), altitude (m), vitesse
 * (km/h), cap (degrés, 0 = nord, 90 = est), démarrage à froid (s). Par défaut : Dakar, place de l'Indépendance.
 * Un vrai NEO-6M met environ 27 s à trouver sa position à froid (fiche u-blox) ; 5 s ici, pour ne pas faire attendre la classe.
 */
export const GPS_DEFAULT = { gpsLat: 14.6928, gpsLon: -17.4467, gpsAlt: 22, gpsSpeed: 0, gpsCourse: 0, gpsCold: 5 };
export const GPS_BAUD = 9600;
export function gpsSettings(c) {
  const i = (c && c.inp) || {};
  return {
    lat: clamp(num(i.gpsLat, GPS_DEFAULT.gpsLat), -89.9, 89.9), lon: clamp(num(i.gpsLon, GPS_DEFAULT.gpsLon), -180, 180),
    alt: clamp(num(i.gpsAlt, GPS_DEFAULT.gpsAlt), -400, 9000), speed: clamp(num(i.gpsSpeed, GPS_DEFAULT.gpsSpeed), 0, 500),
    course: ((num(i.gpsCourse, GPS_DEFAULT.gpsCourse) % 360) + 360) % 360, cold: clamp(num(i.gpsCold, GPS_DEFAULT.gpsCold), 0, 600)
  };
}
/** Somme de contrôle NMEA : OU exclusif des caractères entre « $ » et « * », en deux chiffres hexadécimaux. */
export function nmeaChecksum(body) { let x = 0; for (const ch of body) x ^= ch.charCodeAt(0) & 255; return x.toString(16).toUpperCase().padStart(2, '0'); }
/** Trame complète : $corps*XX\r\n. */
export const nmea = body => `$${body}*${nmeaChecksum(body)}\r\n`;
/** Latitude ddmm.mmmmm,N|S ou longitude dddmm.mmmmm,E|W (5 décimales des minutes, comme le NEO-6M). */
export function nmeaCoord(v, lon) {
  const a = Math.abs(v); let d = Math.floor(a), m = Math.round((a - d) * 60 * 1e5) / 1e5;
  if (m >= 60) { d++; m = 0; }
  return `${String(d).padStart(lon ? 3 : 2, '0')}${m.toFixed(5).padStart(8, '0')},${lon ? (v < 0 ? 'W' : 'E') : (v < 0 ? 'S' : 'N')}`;
}
const KNOT = 1.852; // km/h par nœud
const R_EARTH = 6371000;
/** Satellites visibles (numéro PRN, élévation, azimut, rapport signal/bruit) : un ciel plausible, toujours le même. */
const SKY = [[2, 63, 248, 44], [5, 41, 61, 41], [6, 15, 318, 31], [12, 71, 131, 46], [13, 28, 97, 38], [15, 10, 205, 27], [17, 36, 280, 40], [19, 22, 171, 35], [24, 55, 12, 45], [25, 8, 33, 22]];
const USED = SKY.filter(s => s[1] >= 15).map(s => s[0]).slice(0, 8);

/** Trames d'une seconde, dans l'ordre du NEO-6M : RMC, VTG, GGA, GSA, GSV, GLL. f : état (fix, position, heure). */
export function gpsBurst(f) {
  if (!f.fix) {
    return [nmea('GPRMC,,V,,,,,,,,,,N'), nmea('GPVTG,,,,,,,,,N'), nmea('GPGGA,,,,,,0,00,99.99,,,,,,'), nmea('GPGSA,A,1,,,,,,,,,,,,,99.99,99.99,99.99'), nmea('GPGSV,1,1,00'), nmea('GPGLL,,,,,,V,N')].join('');
  }
  const d = new Date(f.utc), hms = `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}.00`;
  const dmy = `${p2(d.getUTCDate())}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCFullYear() % 100)}`;
  const lat = nmeaCoord(f.lat, false), lon = nmeaCoord(f.lon, true), kn = f.speed / KNOT, moving = f.speed > 0.05;
  const cog = moving ? f.course.toFixed(2) : '';
  const used = USED.concat(new Array(12 - USED.length).fill('')).join(',');
  const gsv = [];
  for (let i = 0; i < SKY.length; i += 4) gsv.push(nmea(`GPGSV,${Math.ceil(SKY.length / 4)},${i / 4 + 1},${p2(SKY.length)},${SKY.slice(i, i + 4).map(s => `${p2(s[0])},${p2(s[1])},${String(s[2]).padStart(3, '0')},${p2(s[3] + ((f.sec + s[0]) % 3) - 1)}`).join(',')}`));
  return [
    nmea(`GPRMC,${hms},A,${lat},${lon},${kn.toFixed(3)},${cog},${dmy},,,A`),
    nmea(`GPVTG,${cog},T,,M,${kn.toFixed(3)},N,${f.speed.toFixed(3)},K,A`),
    nmea(`GPGGA,${hms},${lat},${lon},1,${p2(USED.length)},0.92,${f.alt.toFixed(1)},M,27.6,M,,`),
    nmea(`GPGSA,A,3,${used},1.65,0.92,1.37`),
    ...gsv,
    nmea(`GPGLL,${lat},${lon},${hms},A,A`)
  ].join('');
}

/**
 * NEO-6M : une salve de trames par seconde du temps de la carte (sortie à 1 Hz, 9600 bauds, réglages d'usine), sans
 * position pendant le démarrage à froid, puis avec la position réglée ; la position avance selon la vitesse et le cap.
 * Ce que la carte envoie sur RX (commandes UBX, PMTK…) est ignoré : la configuration reste celle d'usine.
 */
function gps(st, c) {
  const g = st.gps || (st.gps = { t0: null, next: 0, utc0: 0, n: 0, e: 0, base: '', last: null, view: null });
  function burst(tm) {
    const s = gpsSettings(c), key = `${s.lat},${s.lon}`;
    if (g.base !== key) { g.base = key; g.n = 0; g.e = 0; }
    // Déplacement depuis la salve précédente (le véhicule roule même sans position calculée).
    if (g.last != null && s.speed > 0) {
      const dist = s.speed / 3.6 * (tm - g.last) / 1000, a = s.course * Math.PI / 180;
      g.n += dist * Math.cos(a); g.e += dist * Math.sin(a);
    }
    g.last = tm;
    const lat = s.lat + g.n / R_EARTH * 180 / Math.PI, lon = ((s.lon + g.e / (R_EARTH * Math.cos(s.lat * Math.PI / 180)) * 180 / Math.PI + 540) % 360) - 180;
    const elapsed = (tm - g.t0) / 1000, fix = elapsed >= s.cold, utc = Math.floor((g.utc0 + tm - g.t0) / 1000) * 1000;
    g.view = { fix, lat, lon, alt: s.alt, speed: s.speed, course: s.course, utc, sats: fix ? USED.length : 0, left: Math.max(0, Math.ceil(s.cold - elapsed)) };
    st.ver = (st.ver || 0) + 1;
    return gpsBurst({ ...g.view, sec: Math.floor(utc / 1000) });
  }
  return {
    baud: GPS_BAUD,
    write() {},
    drain(baud, t = 0) {
      if (g.t0 == null) { g.t0 = t; g.next = t + 1000; g.utc0 = Date.now(); }
      if (t - g.next > 3000) g.next = t - ((t - g.next) % 1000); // carte arrêtée longtemps (débogueur) : pas de rattrapage
      let out = '';
      while (t >= g.next) { out += burst(g.next); g.next += 1000; }
      return out && baud && baud !== GPS_BAUD ? garble(out) : out;
    }
  };
}
/** État du GPS pour l'affichage (onglet Simulation) : { fix, lat, lon, alt, speed, course, utc, sats, left } ou null. */
export const gpsView = st => (st && st.gps && st.gps.view) || null;

/* ---------- Radio HC-12 ---------- */
export const HC12_BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
export const HC12_DEFAULT = { hc12Ch: 1, hc12Baud: 9600 };
/** Débit dans l'air du mode FU3 (bits/s) selon la vitesse série : deux modules ne s'entendent qu'au même débit. */
export const hc12Air = baud => (baud <= 2400 ? 5000 : baud <= 9600 ? 15000 : baud <= 38400 ? 58000 : 236000);
export const hc12Freq = ch => Math.round((433.4 + (ch - 1) * 0.4) * 10) / 10;
export function hc12Settings(c) {
  const i = (c && c.inp) || {}, ch = Math.trunc(num(i.hc12Ch, 1)), b = Math.trunc(num(i.hc12Baud, 9600));
  return { ch: clamp(ch, 1, 127), baud: HC12_BAUDS.includes(b) ? b : 9600 };
}
/** Délai sans octet qui termine une commande AT envoyée sans fin de ligne (ms). */
const AT_GAP = 20;
/**
 * HC-12 : liaison série transparente entre modules du même canal et du même débit dans l'air. SET à LOW : mode
 * commandes AT, toujours à 9600 bauds (AT, AT+Bxxxx, AT+Cxxx, AT+RX, AT+V, AT+DEFAULT, AT+FU3, AT+Px, AT+RB, AT+RC).
 * devOf(comp) : module série d'un autre composant (pour lui remettre ce qui arrive par l'air).
 */
function hc12(st, c, devOf) {
  const cfg = () => { if (!c.inp) c.inp = {}; return c.inp; };
  st.toBoard = st.toBoard || ''; st.cmd = st.cmd || ''; st.ctx = st.ctx || null; st.sent = st.sent || 0; st.got = st.got || 0;
  const cmdMode = () => !!st.ctx && st.ctx.level && st.ctx.level('SET') === 0;
  const out = s => { st.toBoard = (st.toBoard + s).slice(-4096); };
  const reply = s => out(s + '\r\n');
  function exec(cmd) {
    const C = cmd.toUpperCase().replace(/\s+$/, ''), s = hc12Settings(c), k = cfg();
    let m;
    if (C === 'AT') reply('OK');
    else if ((m = /^AT\+B(\d+)$/.exec(C))) { if (HC12_BAUDS.includes(+m[1])) { k.hc12Baud = +m[1]; st.ver = (st.ver || 0) + 1; reply(`OK+B${m[1]}`); } else reply('ERROR'); }
    else if ((m = /^AT\+C(\d{1,3})$/.exec(C))) { const ch = +m[1]; if (ch >= 1 && ch <= 127) { k.hc12Ch = ch; st.ver = (st.ver || 0) + 1; reply(`OK+C${String(ch).padStart(3, '0')}`); } else reply('ERROR'); }
    else if (C === 'AT+RB') reply(`OK+B${s.baud}`);
    else if (C === 'AT+RC') reply(`OK+RC${String(s.ch).padStart(3, '0')}`);
    else if (C === 'AT+RP') reply('OK+RP:+20dBm');
    else if (C === 'AT+RF') reply('OK+FU3');
    else if (C === 'AT+RX') reply(`OK+B${s.baud}\r\nOK+RC${String(s.ch).padStart(3, '0')}\r\nOK+RP:+20dBm\r\nOK+FU3`);
    else if (C === 'AT+V') reply('www.hc01.com  HC-12_V2.4');
    else if (C === 'AT+DEFAULT') { Object.assign(k, HC12_DEFAULT); st.ver = (st.ver || 0) + 1; reply('OK+DEFAULT'); }
    else if (/^AT\+FU[1-4]$/.test(C)) reply(`OK+${C.slice(3)}`); // seul FU3 (réglage d'usine) est simulé
    else if ((m = /^AT\+P([1-8])$/.exec(C))) reply(`OK+P${m[1]}`);
    else if (C === 'AT+SLEEP') reply('OK+SLEEP');
    else if (C) reply('ERROR');
  }
  function flushCmd() { const s = st.cmd; st.cmd = ''; if (s.trim()) exec(s.trim()); }
  return {
    get baud() { return cmdMode() ? 9600 : hc12Settings(c).baud; },
    bind(ctx) { st.ctx = ctx; },
    get mode() { return cmdMode() ? 'at' : 'data'; },
    write(s, baud, t = 0) {
      if (baud && baud !== this.baud) s = garble(s);
      if (cmdMode()) {
        if (st.cmd && t - (st.cmdT || 0) >= AT_GAP) flushCmd(); // la pause a terminé la commande précédente
        for (const ch of s) { if (ch === '\r' || ch === '\n') flushCmd(); else st.cmd = (st.cmd + ch).slice(-40); }
        st.cmdT = t; return;
      }
      st.cmd = '';
      // Par l'air : aux autres HC-12 alimentés, en mode transparent, sur le même canal et au même débit.
      const me = hc12Settings(c), air = hc12Air(me.baud), peers = st.ctx && st.ctx.peers ? st.ctx.peers(['hc12']) : [];
      st.sent += s.length; st.ver = (st.ver || 0) + 1;
      for (const p of peers) {
        if (p.comp === c || !p.ok) continue;
        const d = devOf(p.comp), o = hc12Settings(p.comp);
        if (d.mode === 'at' || o.ch !== me.ch || hc12Air(o.baud) !== air) continue;
        d.receive(s);
      }
    },
    /** Ce qui arrive par l'air, vers la broche TXD du module. */
    receive(s) { out(s); st.got += s.length; st.ver = (st.ver || 0) + 1; },
    drain(baud, t = 0) {
      if (cmdMode() && st.cmd && t - (st.cmdT || 0) >= AT_GAP) flushCmd(); // commande sans fin de ligne : terminée par la pause
      const s = st.toBoard; st.toBoard = '';
      return s && baud && baud !== this.baud ? garble(s) : s;
    }
  };
}

/* ---------- RS-485 MAX485 ---------- */
/**
 * MAX485 : DE à HIGH, la puce pilote la paire A/B avec ce qui arrive sur DI ; /RE à LOW, ce qui passe sur la paire
 * sort sur RO (même ce que la puce émet elle-même : semi-duplex). Les modules dont A et B sont sur les mêmes nœuds
 * forment un bus ; A et B croisés inversent les bits (charabia). Les octets voyagent à la vitesse de l'émetteur : un
 * récepteur réglé à une autre vitesse lit du charabia. DE ou /RE en l'air : considérés inactifs.
 */
function rs485(st, c, devOf) {
  st.chunks = st.chunks || []; st.ctx = st.ctx || null; st.sent = st.sent || 0; st.got = st.got || 0;
  const lv = k => (st.ctx && st.ctx.level ? st.ctx.level(k) : null);
  const listening = () => lv('RE') === 0;
  /** Autres MAX485 du bus : { comp, inv } (inv : A relié à B, polarité inversée). */
  function bus() {
    const out = new Map(), L = st.ctx && st.ctx.linked ? st.ctx.linked : () => [];
    for (const m of L('A')) if (m.comp.type === 'max485' && m.comp !== c && (m.key === 'A' || m.key === 'B')) out.set(m.comp, { comp: m.comp, inv: m.key === 'B' });
    return [...out.values()];
  }
  const dev = {
    baud: null,
    bind(ctx) { st.ctx = ctx; },
    get driving() { return lv('DE') === 1; },
    get listening() { return listening(); },
    /** de : niveau de DE pendant l'octet, quand il est déjà connu (mode fidèle : octets décodés après la salve). */
    write(s, baud, t, de) {
      if ((de ?? (lv('DE') === 1)) !== true) return; // pilote coupé : rien ne part sur la paire
      st.sent += s.length; st.ver = (st.ver || 0) + 1;
      if (listening()) dev.receive(s, baud, false);
      for (const m of bus()) devOf(m.comp).receive(s, baud, m.inv);
    },
    /** Octets passés sur la paire (bauds de l'émetteur) : vers RO si le récepteur est actif. */
    receive(s, baud, inv) {
      if (!listening()) return;
      if (inv) s = s.replace(/[\s\S]/g, ch => String.fromCharCode(~ch.charCodeAt(0) & 0xff));
      st.chunks.push({ s, baud }); st.got += s.length; st.ver = (st.ver || 0) + 1;
      if (st.chunks.length > 256) st.chunks.splice(0, st.chunks.length - 256);
    },
    /** Morceaux reçus avec leur vitesse : [{ s, baud }] (mode fidèle : RO porte chaque octet à la vitesse de l'émetteur). */
    take() { const c2 = st.chunks; st.chunks = []; return c2; },
    drain(baud) { return dev.take().map(x => (baud && x.baud && x.baud !== baud ? garble(x.s) : x.s)).join(''); }
  };
  return dev;
}

/** Module série de ces types sur l'état partagé st (periph) ; devOf(comp) rend celui d'un autre composant. */
export function serialMod(st, c, devOf) {
  if (c.type === 'neo6m') return gps(st, c);
  if (c.type === 'hc12') return hc12(st, c, devOf);
  if (c.type === 'max485') return rs485(st, c, devOf);
  return null;
}
