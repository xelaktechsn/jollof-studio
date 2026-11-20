// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module Ethernet W5500 vu par un vrai programme (mode fidèle, bibliothèque Ethernet d'Arduino ou autre pilote),
// d'après la fiche du W5500 (v1.1.0) : la puce porte elle-même TCP, UDP et IP, et le réseau est celui du projet
// (src/net/lan.js, io.hw.lan()), où le module est l'appareil 'e:' + id du composant, port 'eth'.
//
// Trame SPI (§ 2.2) : adresse sur 16 bits, octet de contrôle (BSB[4:0] : bloc, RWB : écriture, OM[1:0] : longueur),
// puis les données, l'adresse avançant d'un octet à chaque fois. OM = 00 : longueur libre jusqu'à ce que CS remonte ;
// 01, 10, 11 : 1, 2 ou 4 octets, puis une nouvelle trame commence sans relever CS. Blocs : registres communs (0),
// registres du socket n (4n + 1), sa mémoire d'émission (4n + 2) et de réception (4n + 3), où l'adresse se lit modulo
// la taille de la mémoire du socket (Sn_TXBUF_SIZE, Sn_RXBUF_SIZE : 2 Ko chacun au départ).
//
// Registres communs : MR (bit 7 : remise à zéro), GAR, SUBR, SHAR, SIPR, IR, IMR, SIR, SIMR, RTR, RCR, PHYCFGR (lien,
// vitesse, duplex lus sur le port du plan réseau), VERSIONR = 0x04 à 0x0039. Huit sockets : Sn_MR (protocole), Sn_CR
// (commande, exécutée aussitôt, se relit à 0), Sn_IR (CON, DISCON, RECV, TIMEOUT, SEND_OK ; 1 écrit l'efface), Sn_SR,
// Sn_PORT, Sn_DHAR, Sn_DIPR, Sn_DPORT, Sn_MSSR, Sn_TTL, tailles des mémoires, Sn_TX_FSR / TX_RD / TX_WR, Sn_RX_RSR /
// RX_RD / RX_WR, mémoires circulaires. Ce que font les commandes, sur le réseau simulé :
//   TCP : CONNECT → lan.connect ; LISTEN → lan.listen (une seule connexion acceptée par socket, comme la puce ; la
//     bibliothèque rouvre un socket en écoute pour la suivante) ; SEND → octets envoyés ; ce qui arrive remplit la
//     mémoire de réception (le surplus attend qu'elle se vide, comme la fenêtre TCP) ; le correspondant ferme → CLOSE_WAIT.
//   UDP : OPEN → lan.udpBind, SEND → lan.udpSend (255.255.255.255 : diffusion, même sans adresse : DHCP), chaque
//     datagramme reçu est précédé de l'en-tête de 8 octets de la puce (adresse, port, longueur) : le DHCP (Dhcp.cpp) et
//     le DNS (Dns.cpp) de la bibliothèque Ethernet parlent ainsi à la box.
// Ce que le plan réseau voit du module, comp.periph.eth = { mac, ip, prefix, gw, dhcp }, suit SHAR, SIPR, SUBR et GAR ;
// dhcp vaut true quand l'adresse vient d'un DHCPACK reçu sur le port 68. Sans plan réseau (io.hw.lan absent ou null),
// la puce répond quand même (la bibliothèque la reconnaît), mais sans lien.
import { periph } from '../../sim/models.js';
import { parseDhcp, DHCP } from '../../net/dhcp.js';
import { prefixOf, ipFromBytes, macStr, ipBytes } from '../../net/ip.js';
import { bytesOf } from '../../net/bytes.js';

// Registres communs (§ 3.1).
const MR = 0x00, GAR = 0x01, SUBR = 0x05, SHAR = 0x09, SIPR = 0x0f, IR = 0x15, IMR = 0x16, SIR = 0x17, SIMR = 0x18,
  RTR = 0x19, RCR = 0x1b, PTIMER = 0x1c, PMRU = 0x26, PHYCFGR = 0x2e, VERSIONR = 0x39;
// Registres d'un socket (§ 3.2).
const Sn_MR = 0x00, Sn_CR = 0x01, Sn_IR = 0x02, Sn_SR = 0x03, Sn_PORT = 0x04, Sn_DHAR = 0x06, Sn_DIPR = 0x0c, Sn_DPORT = 0x10,
  Sn_TTL = 0x16, Sn_RXBUF = 0x1e, Sn_TXBUF = 0x1f, Sn_TX_FSR = 0x20, Sn_TX_RD = 0x22, Sn_TX_WR = 0x24, Sn_RX_RSR = 0x26,
  Sn_RX_RD = 0x28, Sn_RX_WR = 0x2a, Sn_IMR = 0x2c, Sn_FRAG = 0x2d;
/** Commandes de Sn_CR. */
export const CMD = { OPEN: 0x01, LISTEN: 0x02, CONNECT: 0x04, DISCON: 0x08, CLOSE: 0x10, SEND: 0x20, SEND_MAC: 0x21, SEND_KEEP: 0x22, RECV: 0x40 };
/** États de Sn_SR. */
export const SR = { CLOSED: 0x00, INIT: 0x13, LISTEN: 0x14, ESTABLISHED: 0x17, CLOSE_WAIT: 0x1c, UDP: 0x22, IPRAW: 0x32, MACRAW: 0x42 };
/** Bits de Sn_IR. */
export const SNIR = { CON: 0x01, DISCON: 0x02, RECV: 0x04, TIMEOUT: 0x08, SEND_OK: 0x10 };
const SIZES = new Set([0, 1, 2, 4, 8, 16]); // tailles de mémoire admises (Ko)
/** Registres en lecture seule d'un socket (et l'octet suivant des registres de 16 bits). */
const SOCK_RO = new Set([Sn_SR, Sn_TX_FSR, Sn_TX_FSR + 1, Sn_TX_RD, Sn_TX_RD + 1, Sn_RX_RSR, Sn_RX_RSR + 1, Sn_RX_WR, Sn_RX_WR + 1]);

export default {
  types: ['w5500'],
  bus: 'spi',
  create(comp, io) {
    const node = 'e:' + comp.id, rst = io.pin('RST'), intPin = io.pin('INT');
    const lan = () => { try { return io.hw && io.hw.lan ? io.hw.lan() || null : null; } catch (e) { return null; } };
    const c = new Uint8Array(0x40); // registres communs
    // wr : Sn_TX_WR tel que le programme l'écrit ; la puce ne le prend (et ne le relit) qu'à SEND, comme le vrai W5500 :
    // la bibliothèque Ethernet ajoute son décalage à la valeur relue pendant qu'elle remplit un datagramme.
    const socks = Array.from({ length: 8 }, (_, n) => ({ n, r: new Uint8Array(0x30), wr: 0, tx: null, rx: null, sock: null, unbind: null, port: 0, pending: [], rxAck: 0, timer: 0 }));
    const listening = new Map(); // port → { sockets: Set, off: fin d'écoute, lan }
    let ph = 0, off = 0, ctl = 0, left = 0, dead = false, held = false, sig = '', ackIp = null;

    const r16 = (S, a) => (S.r[a] << 8) | S.r[a + 1];
    const w16 = (S, a, v) => { S.r[a] = (v >> 8) & 255; S.r[a + 1] = v & 255; };
    const ipAt = (arr, a) => ipFromBytes(arr.subarray(a, a + 4));
    const txSize = S => (SIZES.has(S.r[Sn_TXBUF]) ? S.r[Sn_TXBUF] : 0) * 1024;
    const rxSize = S => (SIZES.has(S.r[Sn_RXBUF]) ? S.r[Sn_RXBUF] : 0) * 1024;
    const txBuf = S => S.tx || (S.tx = new Uint8Array(16384));
    const rxBuf = S => S.rx || (S.rx = new Uint8Array(16384));
    /** Octets déjà rangés en réception et pas encore rendus par RECV. */
    const rxUsed = S => (r16(S, Sn_RX_WR) - S.rxAck) & 0xffff;
    const txPend = S => (S.wr - r16(S, Sn_TX_RD)) & 0xffff;

    /* ---------- Remise à zéro (mise sous tension, broche RST, MR bit 7) ---------- */
    function resetSock(S) {
      unlink(S);
      S.r.fill(0);
      S.r.fill(0xff, Sn_DHAR, Sn_DHAR + 6);
      S.r[Sn_TTL] = 0x80; S.r[Sn_RXBUF] = 2; S.r[Sn_TXBUF] = 2; S.r[Sn_IMR] = 0xff;
      w16(S, Sn_FRAG, 0x4000);
      S.pending = []; S.rxAck = 0; S.wr = 0; S.timer++;
      refreshFsr(S);
    }
    function reset() {
      c.fill(0);
      c[RTR] = 0x07; c[RTR + 1] = 0xd0; c[RCR] = 0x08; c[PTIMER] = 0x28; c[PMRU] = 0xff; c[PMRU + 1] = 0xff;
      c[PHYCFGR] = 0xb8; c[VERSIONR] = 0x04;
      socks.forEach(resetSock);
      ackIp = null;
      updateInt();
    }

    /* ---------- Lien : port 'eth' du module dans le plan réseau ---------- */
    function phy() {
      const L = lan(), p = L && !held ? L.port(node, 'eth') : null, up = !!(p && p.up);
      const cfg = c[PHYCFGR] & 0x78, forced = cfg & 0x40 ? (cfg >> 3) & 7 : 7; // OPMD : mode imposé par OPMDC
      const spd = up && p.speed >= 100 && ![0, 1].includes(forced) ? 2 : 0, dpx = up && ![0, 2, 4].includes(forced) ? 4 : 0;
      return (c[PHYCFGR] & 0xf8) | dpx | spd | (up ? 1 : 0);
    }

    /* ---------- Broche INT (active à LOW) ---------- */
    function updateInt() {
      let sir = 0;
      socks.forEach((S, i) => { if (S.r[Sn_IR] & S.r[Sn_IMR] & 0x1f) sir |= 1 << i; });
      c[SIR] = sir;
      if (intPin && !dead) io.drive(intPin, !((c[IR] & c[IMR] & 0xf0) || (sir & c[SIMR])));
    }
    const irq = (S, bits) => { S.r[Sn_IR] |= bits; updateInt(); };
    const setSr = (S, v) => { S.r[Sn_SR] = v; };
    function refreshFsr(S) { w16(S, Sn_TX_FSR, Math.max(0, txSize(S) - ((r16(S, Sn_TX_WR) - r16(S, Sn_TX_RD)) & 0xffff))); w16(S, Sn_RX_RSR, rxUsed(S)); }

    /* ---------- Réception : mémoire circulaire, en-tête UDP, surplus en attente ---------- */
    function fill(S) {
      const size = rxSize(S); if (!size) return;
      const buf = rxBuf(S);
      let wr = r16(S, Sn_RX_WR), got = false;
      while (S.pending.length) {
        const ch = S.pending[0], free = size - ((wr - S.rxAck) & 0xffff);
        if (free <= 0) break;
        const n = ch.udp ? (ch.b.length <= free ? ch.b.length : 0) : Math.min(free, ch.b.length);
        if (!n) break; // datagramme entier ou rien
        for (let i = 0; i < n; i++) buf[(wr + i) & (size - 1)] = ch.b[i];
        wr = (wr + n) & 0xffff; got = true;
        if (n < ch.b.length) { ch.b = ch.b.subarray(n); break; }
        S.pending.shift();
      }
      w16(S, Sn_RX_WR, wr); refreshFsr(S);
      if (got) irq(S, SNIR.RECV);
    }
    function tcpIn(S, k, data) {
      if (dead || S.sock !== k) return;
      S.pending.push({ b: bytesOf(data), udp: false }); fill(S);
    }
    function peerClosed(S, k) {
      if (S.sock !== k) return;
      S.sock = null;
      if (S.r[Sn_SR] === SR.ESTABLISHED) { setSr(S, SR.CLOSE_WAIT); irq(S, SNIR.DISCON); }
    }
    function udpIn(S, dg) {
      if (dead || S.r[Sn_SR] !== SR.UDP) return;
      const b = dg.bytes, len = b.length, h = [...ipBytes(dg.from), dg.sport >> 8, dg.sport & 255, len >> 8, len & 255];
      const all = new Uint8Array(8 + len); all.set(h); all.set(b, 8);
      // Bail DHCP accordé à ce module (DHCPACK pour son adresse MAC) : son adresse vient du DHCP.
      if (S.port === 68) { const m = parseDhcp(b); if (m && m.type === DHCP.ACK && m.mac === macStr(c.subarray(SHAR, SHAR + 6))) ackIp = m.yiaddr; }
      S.pending.push({ b: all, udp: true }); fill(S);
    }

    /* ---------- Liens avec le réseau simulé ---------- */
    function attach(S, k) {
      S.sock = k;
      k.onData(d => tcpIn(S, k, d));
      k.onClose(() => peerClosed(S, k));
    }
    function unlink(S) {
      const k = S.sock; S.sock = null;
      if (k) { try { k.close(); } catch (e) { /* déjà fermée */ } }
      if (S.unbind) { S.unbind(); S.unbind = null; }
      for (const [port, l] of listening) if (l.sockets.delete(S) && !l.sockets.size) { l.off(); listening.delete(port); }
    }
    /** Écoute TCP : un seul abonnement au réseau par port, partagé par les sockets qui y écoutent. */
    function listenOn(S, port) {
      const L = lan(); if (!L) return;
      let l = listening.get(port);
      if (l && l.lan !== L) { l.off(); listening.delete(port); l = null; }
      if (!l) {
        l = { sockets: new Set(), lan: L, off: null };
        l.off = L.listen(node, port, k => accept(port, k));
        listening.set(port, l);
      }
      l.sockets.add(S);
    }
    function accept(port, k) {
      const l = listening.get(port);
      const S = l && [...l.sockets].sort((a, b) => a.n - b.n).find(x => x.r[Sn_SR] === SR.LISTEN);
      if (dead || !S) { k.close(); return; } // plus de socket en écoute : connexion refusée
      l.sockets.delete(S); if (!l.sockets.size) { l.off(); listening.delete(port); }
      attach(S, k);
      const rip = (k.remote && k.remote.ip) || '0.0.0.0', rport = (k.remote && k.remote.port) || 0;
      ipBytes(rip).forEach((x, i) => { S.r[Sn_DIPR + i] = x; }); w16(S, Sn_DPORT, rport);
      setSr(S, SR.ESTABLISHED); irq(S, SNIR.CON);
    }
    /** Échec de connexion ou d'envoi après les essais de la puce : RTR × (RCR + 1) (200 ms × 9 au départ). */
    function later(S, fn) {
      const g = ++S.timer, ms = Math.min(5000, ((c[RTR] << 8) | c[RTR + 1]) / 10 * (c[RCR] + 1));
      io.after(io.us(ms * 1000), () => { if (!dead && g === S.timer) fn(); });
    }
    function connect(S) {
      const L = lan(), ip = ipAt(S.r, Sn_DIPR), port = r16(S, Sn_DPORT);
      const r = L ? L.connect(node, ip, port) : { ok: false, why: 'nolink' };
      if (r.ok) { attach(S, r.sock); setSr(S, SR.ESTABLISHED); irq(S, SNIR.CON); return; }
      // Refusée (RST du correspondant) : tout de suite ; sans réponse (ARP, pas de route) : après les essais.
      if (r.why === 'refused') { setSr(S, SR.CLOSED); irq(S, SNIR.TIMEOUT); return; }
      setSr(S, 0x15); // SOCK_SYNSENT pendant les essais
      later(S, () => { if (S.r[Sn_SR] === 0x15) { setSr(S, SR.CLOSED); irq(S, SNIR.TIMEOUT); } });
    }
    function send(S) {
      const size = txSize(S), n = txPend(S), rd = r16(S, Sn_TX_RD), buf = txBuf(S), data = new Uint8Array(n);
      for (let i = 0; i < n; i++) data[i] = size ? buf[(rd + i) & (size - 1)] : 0;
      w16(S, Sn_TX_WR, S.wr); w16(S, Sn_TX_RD, S.wr); refreshFsr(S);
      const sr = S.r[Sn_SR];
      if (sr === SR.ESTABLISHED || sr === SR.CLOSE_WAIT) {
        if (S.sock && S.sock.open) { S.sock.write(data); irq(S, SNIR.SEND_OK); }
        else { unlink(S); setSr(S, SR.CLOSED); irq(S, SNIR.TIMEOUT); }
      } else if (sr === SR.UDP) {
        const L = lan(), ip = ipAt(S.r, Sn_DIPR), dport = r16(S, Sn_DPORT);
        const ok = L ? L.udpSend(node, S.port, ip, dport, data) : false;
        if (ok || ip === '255.255.255.255') irq(S, SNIR.SEND_OK);
        else later(S, () => irq(S, SNIR.TIMEOUT)); // pas de réponse ARP
      } else if (sr === SR.IPRAW || sr === SR.MACRAW) irq(S, SNIR.SEND_OK); // trames brutes : pas reliées au réseau simulé
    }
    function command(S, cmd) {
      const proto = S.r[Sn_MR] & 0x0f, sr = S.r[Sn_SR];
      switch (cmd) {
        case CMD.OPEN: {
          unlink(S); S.timer++;
          S.pending = []; S.rxAck = 0; S.wr = 0;
          for (const a of [Sn_TX_RD, Sn_TX_WR, Sn_RX_RD, Sn_RX_WR]) w16(S, a, 0);
          S.port = r16(S, Sn_PORT);
          if (proto === 1) setSr(S, SR.INIT);
          else if (proto === 2) {
            setSr(S, SR.UDP);
            const L = lan(); if (L) S.unbind = L.udpBind(node, S.port, dg => udpIn(S, dg));
          } else if (proto === 3) setSr(S, SR.IPRAW);
          else if (proto === 4 && S.n === 0) setSr(S, SR.MACRAW);
          else setSr(S, SR.CLOSED);
          break;
        }
        case CMD.LISTEN: if (sr === SR.INIT) { setSr(S, SR.LISTEN); listenOn(S, S.port); } break;
        case CMD.CONNECT: if (sr === SR.INIT) connect(S); break;
        case CMD.DISCON:
          if (sr === SR.ESTABLISHED || sr === SR.CLOSE_WAIT || sr === SR.LISTEN || sr === 0x15) { unlink(S); setSr(S, SR.CLOSED); irq(S, SNIR.DISCON); }
          break;
        case CMD.CLOSE: unlink(S); S.timer++; setSr(S, SR.CLOSED); break;
        case CMD.SEND: case CMD.SEND_MAC: send(S); break;
        case CMD.SEND_KEEP: // sonde de maintien : sans réponse du correspondant, la connexion tombe
          if (sr === SR.ESTABLISHED && !(S.sock && S.sock.open)) { unlink(S); setSr(S, SR.CLOSED); irq(S, SNIR.TIMEOUT); }
          break;
        case CMD.RECV: S.rxAck = r16(S, Sn_RX_RD); refreshFsr(S); fill(S); break;
        default: break;
      }
      refreshFsr(S);
    }

    /* ---------- Accès aux blocs ---------- */
    function readCommon(a) { return a === PHYCFGR ? phy() : a < c.length ? c[a] : 0; }
    function writeCommon(a, v) {
      if (a === MR) { if (v & 0x80) reset(); else c[MR] = v & 0x3a; return; }
      if (a === IR) { c[IR] &= ~(v & 0xf0); updateInt(); return; }
      if (a === SIR || a === VERSIONR || a >= c.length) return;
      if (a === PHYCFGR) { c[PHYCFGR] = (v & 0x78) | 0x80; return; } // bit 7 à 0 : remise à zéro du PHY, aussitôt finie
      c[a] = v;
      if (a === IMR || a === SIMR) updateInt();
    }
    function readSock(S, a) {
      if (a === Sn_CR) return 0; // commande déjà exécutée
      return a < S.r.length ? S.r[a] : 0;
    }
    function writeSock(S, a, v) {
      if (a >= S.r.length || SOCK_RO.has(a)) return;
      if (a === Sn_CR) { command(S, v); return; }
      if (a === Sn_IR) { S.r[Sn_IR] &= ~v; updateInt(); return; }
      if (a === Sn_TX_WR) { S.wr = (v << 8) | (S.wr & 255); return; }
      if (a === Sn_TX_WR + 1) { S.wr = (S.wr & 0xff00) | v; return; }
      S.r[a] = v;
      if (a === Sn_IMR) updateInt();
      if (a === Sn_TXBUF || a === Sn_RXBUF) refreshFsr(S);
    }
    /** Un octet de la phase de données : bloc bsb, adresse a ; w : octet écrit, ou null pour une lecture. */
    function access(bsb, a, w) {
      if (bsb === 0) { if (w == null) return readCommon(a); writeCommon(a, w); return 0; }
      const S = socks[bsb >> 2], kind = bsb & 3;
      if (kind === 1) { if (w == null) return readSock(S, a); writeSock(S, a, w); return 0; }
      if (kind === 0) return 0; // bloc réservé
      const size = kind === 2 ? txSize(S) : rxSize(S); if (!size) return 0;
      const buf = kind === 2 ? txBuf(S) : rxBuf(S), i = a & (size - 1);
      if (w == null) return buf[i];
      buf[i] = w; return 0;
    }

    /* ---------- Ce que voit le plan réseau ---------- */
    function publish() {
      const mac = macStr(c.subarray(SHAR, SHAR + 6)), ip = ipAt(c, SIPR), gw = ipAt(c, GAR), prefix = prefixOf(ipAt(c, SUBR)) ?? 0;
      const s = [mac, ip, prefix, gw, ackIp === ip].join('|');
      if (s === sig) return;
      sig = s;
      const st = periph(comp);
      st.eth = { mac, ip, prefix, gw, dhcp: !!ackIp && ackIp === ip && ip !== '0.0.0.0' };
      st.ver = (st.ver || 0) + 1;
      const L = lan(); if (L) L.refresh(); // l'adresse du module a changé : le réseau se recalcule
    }

    const isHeld = lv => !!rst && lv === 0 && (io.rec(rst) || {}).mode === 1;
    const offRst = rst ? io.onEdge(rst, lv => { const h = isHeld(lv); if (h && !held) { held = true; reset(); } else if (!h && held) { held = false; reset(); } }) : null;
    if (rst) io.drive(rst, true); // tirage interne de RSTn (fiche : RPU 50 à 112 kΩ)
    held = rst ? isHeld(io.level(rst)) : false;
    reset();
    publish();

    return {
      cs: 'CS',
      select() { ph = 0; left = 0; },
      transfer(b) {
        if (held) return 0xff; // puce en reset : MISO en haute impédance
        switch (ph) {
          case 0: off = b << 8; ph = 1; return 0x00;
          case 1: off |= b; ph = 2; return 0x01;
          case 2: ctl = b; ph = 3; left = [0, 1, 2, 4][b & 3]; return 0x02;
          default: {
            const v = access(ctl >> 3, off, ctl & 4 ? b : null);
            off = (off + 1) & 0xffff;
            if (left && --left === 0) ph = 0; // longueur fixe : la trame suivante commence sans relever CS
            return v & 0xff;
          }
        }
      },
      deselect() { ph = 0; publish(); },
      frame() { if (!dead) publish(); },
      dispose() {
        if (dead) return;
        socks.forEach(unlink);
        dead = true;
        if (offRst) offRst();
        const st = periph(comp); st.eth = null; st.ver = (st.ver || 0) + 1;
        const L = lan(); if (L) L.refresh();
      },
      /** Pour les tests : état d'un socket. */
      sock: n => ({ sr: socks[n].r[Sn_SR], ir: socks[n].r[Sn_IR], port: socks[n].port, pending: socks[n].pending.length })
    };
  }
};
