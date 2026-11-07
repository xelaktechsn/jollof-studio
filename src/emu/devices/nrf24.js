// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Module radio nRF24L01+ vu par un vrai programme. Chaque échange SPI (CSN à LOW) commence par un octet de commande,
// pendant lequel la puce renvoie son registre STATUS ; suivent les octets de la commande : lecture ou écriture d'un
// registre (adresses sur 5 octets, poids faible d'abord), charge utile à émettre (FIFO TX, 3 places) ou reçue
// (FIFO RX, 3 places). En émission (PRIM_RX = 0), CE à HIGH envoie le paquet en tête de la FIFO TX ; avec l'accusé de
// réception automatique (EN_AA), la puce attend l'ACK du récepteur et réessaie (SETUP_RETR) : TX_DS s'il arrive,
// MAX_RT sinon (le paquet reste alors dans la FIFO). En réception (PRIM_RX = 1 et CE à HIGH), un paquet adressé à un
// tube ouvert (EN_RXADDR ; les tubes 2 à 5 n'ont que l'octet de poids faible, le reste vient du tube 1) arrive dans la
// FIFO RX et lève RX_DR, sur le même canal et au même débit seulement. La broche IRQ passe à LOW tant qu'un de ces
// trois drapeaux non masqué (CONFIG) est levé ; on les efface en écrivant 1 dans STATUS.
// L'air est l'état partagé des modules, periph(c) (marche, écoute, canal, débit, tubes, file rx), le même que celui de
// la bibliothèque RF24 simulée de l'interpréteur : une carte en mode fidèle parle à une carte interprétée, et deux
// cartes en mode fidèle se parlent. La file rx du composant est la FIFO RX de la puce.
import { periph, hex2 } from '../../sim/models.js';

const CONFIG = 0x00, EN_AA = 0x01, EN_RXADDR = 0x02, SETUP_AW = 0x03, SETUP_RETR = 0x04, RF_CH = 0x05, RF_SETUP = 0x06, STATUS = 0x07,
  OBSERVE_TX = 0x08, RPD = 0x09, RX_ADDR_P0 = 0x0a, RX_ADDR_P1 = 0x0b, TX_ADDR = 0x10, RX_PW_P0 = 0x11, FIFO_STATUS = 0x17, DYNPD = 0x1c, FEATURE = 0x1d;
const RX_DR = 0x40, TX_DS = 0x20, MAX_RT = 0x10;
/** Bits utilisables de chaque registre d'un octet (les autres se relisent à 0). */
const MASK = { [CONFIG]: 0x7f, [EN_AA]: 0x3f, [EN_RXADDR]: 0x3f, [SETUP_AW]: 0x03, [RF_CH]: 0x7f, [DYNPD]: 0x3f, [FEATURE]: 0x07 };
const RATE_MBPS = [1, 2, 0.25]; // indices de la bibliothèque : RF24_1MBPS, RF24_2MBPS, RF24_250KBPS

export default {
  types: ['nrf24'],
  bus: 'spi',
  create(comp, io) {
    const reg = new Uint8Array(0x20), ce = io.pin('CE'), irqPin = io.pin('IRQ');
    const addr = { [RX_ADDR_P0]: [0xe7, 0xe7, 0xe7, 0xe7, 0xe7], [RX_ADDR_P1]: [0xc2, 0xc2, 0xc2, 0xc2, 0xc2], [TX_ADDR]: [0xe7, 0xe7, 0xe7, 0xe7, 0xe7] };
    Object.assign(reg, { [CONFIG]: 0x08, [EN_AA]: 0x3f, [EN_RXADDR]: 0x03, [SETUP_AW]: 0x03, [SETUP_RETR]: 0x03, [RF_CH]: 0x02, [RF_SETUP]: 0x0e, 0x0c: 0xc3, 0x0d: 0xc4, 0x0e: 0xc5, 0x0f: 0xc6 });
    const txq = [], acks = []; // FIFO TX : paquets à émettre, et charges utiles d'accusé de réception (W_ACK_PAYLOAD)
    let flags = 0, busy = false, tgen = 0, reuse = false, dead = false, sig = '', cmd = -1, n = 0, data = [], cur = null;
    let seenGot = periph(comp).got || 0, seenAck = periph(comp).ackSent || 0;
    const rxq = () => periph(comp).rx;
    const aw = () => Math.max(3, (reg[SETUP_AW] & 3) + 2);
    const key = bytes => bytes.slice(0, aw()).map(hex2).join(''); // même écriture que pipeKey de l'interpréteur
    const pipeAddr = p => key(p < 2 ? addr[RX_ADDR_P0 + p] : [reg[RX_ADDR_P0 + p], ...addr[RX_ADDR_P1].slice(1)]);
    const rate = () => (reg[RF_SETUP] & 0x20 ? 2 : reg[RF_SETUP] & 0x08 ? 1 : 0);
    const ceHigh = () => !!ce && io.level(ce) === 1;
    const status = () => { const q = rxq(); return flags | ((q.length ? q[0].pipe : 7) << 1) | (txq.length + acks.length >= 3 ? 1 : 0); };
    /** Broche IRQ, active à LOW : RX_DR, TX_DS, MAX_RT, sauf ceux que CONFIG masque (mêmes positions de bits). */
    const pin = () => { if (irqPin) io.drive(irqPin, !(flags & ~reg[CONFIG] & 0x70)); };
    /** Ce que les autres cartes voient de cette puce (et le panneau) : publié à chaque changement. */
    function publish() {
      const st = periph(comp), on = !!(reg[CONFIG] & 2), dyn = !!(reg[FEATURE] & 4);
      Object.assign(st, {
        on, listening: on && !!(reg[CONFIG] & 1) && ceHigh(), channel: reg[RF_CH], rate: rate(),
        pipes: [0, 1, 2, 3, 4, 5].map(p => ((reg[EN_RXADDR] >> p) & 1 ? pipeAddr(p) : null)), tx: key(addr[TX_ADDR]),
        payload: reg[RX_PW_P0 + 1] || 32, dyn, ack: !!(reg[EN_AA] & 1),
        fw: true, aa: reg[EN_AA], pw: Array.from(reg.subarray(RX_PW_P0, RX_PW_P0 + 6)), dpl: dyn ? reg[DYNPD] : 0, acks
      });
      // L'émetteur prévient la puce dès qu'un paquet arrive : IRQ au cycle près plutôt qu'à la fin de la tranche.
      if (st.wake !== wake) Object.defineProperty(st, 'wake', { value: wake, enumerable: false, configurable: true, writable: true });
      const s = JSON.stringify([st.on, st.listening, st.channel, st.rate, st.pipes, st.tx]);
      if (s !== sig) { sig = s; st.ver++; }
    }
    const wake = () => { if (!dead) sync(); };
    /** Paquets arrivés entre-temps (déposés par l'émetteur dans la file rx) et charges d'ACK parties : drapeaux. */
    function sync() {
      const st = periph(comp), got = st.got || 0, sent = st.ackSent || 0;
      if (got > seenGot) flags |= RX_DR;
      if (sent > seenAck) flags |= TX_DS; // en réception, TX_DS dit qu'une charge utile d'ACK est partie
      seenGot = got; seenAck = sent;
      pin();
    }
    /** Émission : CE à HIGH en mode PTX, la puce allumée, un paquet en attente et MAX_RT effacé. */
    function kick() {
      if (busy || dead || !(reg[CONFIG] & 2) || (reg[CONFIG] & 1) || !ceHigh() || !txq.length || (flags & MAX_RT)) return;
      busy = true;
      const pkt = txq[0], g = tgen, bits = 8 * (1 + aw() + pkt.bytes.length + 2) + 9; // préambule, adresse, charge, CRC, champ de contrôle
      pkt.to = pkt.to || [];
      const air = bits / RATE_MBPS[rate()];
      io.after(io.us(130 + air), () => attempt(pkt, 0, g, air)); // 130 µs : la synthèse de fréquence se cale
    }
    /** Un essai d'émission : les modules à l'écoute sur ce canal, ce débit et cette adresse reçoivent le paquet. */
    function attempt(pkt, tries, g, air) {
      if (dead || g !== tgen) return;
      const tx = key(addr[TX_ADDR]), ch = reg[RF_CH], r = rate(), needAck = (reg[EN_AA] & 1) && !pkt.noack;
      let acked = false, ackPl = null;
      for (const p of io.hw.peers ? io.hw.peers(['nrf24']) : []) {
        const o = p.comp.periph;
        if (p.comp === comp || !p.ok || !o || !o.on || !o.listening || o.channel !== ch || o.rate !== r) continue;
        const pipe = o.pipes.findIndex(a => a === tx);
        if (pipe < 0) continue;
        // Longueur différente de celle qu'attend le récepteur (RX_PW, ou charge dynamique d'un seul côté) : CRC faux, perdu.
        if (o.fw && (((o.dpl >> pipe) & 1) !== +pkt.dyn || (!pkt.dyn && o.pw[pipe] !== pkt.bytes.length))) continue;
        const fresh = !pkt.to.includes(p.comp); // un nouvel essai du même paquet (même PID) n'est pas reçu deux fois
        if (fresh) {
          if (o.rx.length >= 3) continue; // FIFO RX pleine : pas d'ACK, l'émetteur réessaiera
          o.rx.push({ pipe, bytes: pkt.bytes.slice(), len: pkt.bytes.length }); o.got = (o.got || 0) + 1; o.ver++;
          pkt.to.push(p.comp);
          if (o.wake) o.wake();
        }
        if (o.fw && !((o.aa >> pipe) & 1)) continue; // ce tube n'envoie pas d'accusé de réception
        acked = true;
        const i = fresh && o.acks ? o.acks.findIndex(a => a.pipe === pipe) : -1;
        if (i >= 0) { ackPl = o.acks.splice(i, 1)[0]; o.ackSent = (o.ackSent || 0) + 1; if (o.wake) o.wake(); }
      }
      // L'ACK revient sur le tube 0 de l'émetteur : il doit avoir l'adresse d'émission.
      if (acked && key(addr[RX_ADDR_P0]) !== tx) acked = false;
      const done = !needAck || acked || tries >= (reg[SETUP_RETR] & 15);
      if (done) { const st = periph(comp); st.sent = (st.sent || 0) + 1; st.ver++; }
      if (!needAck || acked) {
        if (reuse) pkt.sent = true; else if (txq.includes(pkt)) txq.splice(txq.indexOf(pkt), 1);
        flags |= TX_DS; reg[OBSERVE_TX] = (reg[OBSERVE_TX] & 0xf0) | tries;
        const q = rxq();
        if (ackPl && (reg[FEATURE] & 2) && q.length < 3) { // la charge utile de l'ACK arrive dans la FIFO RX, tube 0
          const st = periph(comp);
          q.push({ pipe: 0, bytes: ackPl.bytes, len: ackPl.bytes.length }); st.got = (st.got || 0) + 1; seenGot = st.got; flags |= RX_DR;
        }
        busy = false; pin(); kick(); // CE toujours à HIGH : paquet suivant
        return;
      }
      if (!done) { io.after(io.us(((reg[SETUP_RETR] >> 4) + 1) * 250 + air), () => attempt(pkt, tries + 1, g, air)); return; }
      flags |= MAX_RT; reg[OBSERVE_TX] = (Math.min(15, (reg[OBSERVE_TX] >> 4) + 1) << 4) | (reg[SETUP_RETR] & 15);
      busy = false; pin();
    }
    function readReg(r, i) {
      if (addr[r]) return i < 5 ? addr[r][i] : 0;
      if (i) return 0;
      if (r === STATUS) return status();
      if (r === FIFO_STATUS) { const q = rxq(), t = txq.length + acks.length; return (reuse ? 0x40 : 0) | (t >= 3 ? 0x20 : 0) | (t ? 0 : 0x10) | (q.length >= 3 ? 2 : 0) | (q.length ? 0 : 1); }
      return r < 0x1e ? reg[r] : 0;
    }
    function writeReg(r, i, v) {
      if (addr[r]) { if (i < 5) { addr[r][i] = v; publish(); } return; }
      if (i || r === OBSERVE_TX || r === RPD || r === FIFO_STATUS || r > FEATURE) return; // registres en lecture seule
      if (r === STATUS) { flags &= ~(v & 0x70); pin(); if (v & MAX_RT) kick(); return; } // 1 efface le drapeau
      if (r === RF_CH) reg[OBSERVE_TX] &= 0x0f; // PLOS_CNT repart de zéro avec un nouveau canal
      reg[r] = r >= RX_PW_P0 && r < RX_PW_P0 + 6 ? v & 0x3f : v & (MASK[r] ?? 0xff);
      if (r === CONFIG) { if (!(v & 2)) { tgen++; busy = false; } pin(); } // mise en veille : l'émission en cours est perdue
      publish(); kick();
    }
    /** Fin d'une commande d'écriture de charge utile (CSN remonte). */
    function commit() {
      const bytes = data.slice(0, 32), full = txq.length + acks.length >= 3;
      if (!bytes.length || full) return;
      if ((cmd & 0xf8) === 0xa8) { if ((reg[FEATURE] & 2) && (cmd & 7) < 6) acks.push({ pipe: cmd & 7, bytes }); return; } // W_ACK_PAYLOAD
      if (cmd === 0xb0 && !(reg[FEATURE] & 1)) return; // W_TX_PAYLOAD_NOACK demande EN_DYN_ACK
      if (reuse) { reuse = false; if (txq[0] && txq[0].sent) txq.shift(); }
      txq.push({ bytes, noack: cmd === 0xb0, dyn: !!(reg[FEATURE] & 4) && !!(reg[DYNPD] & 1) });
      kick();
    }
    const offs = ce ? [io.onEdge(ce, lv => { publish(); if (lv) kick(); })] : [];
    publish(); pin();
    return {
      cs: 'CSN',
      select() { cmd = -1; },
      transfer(v) {
        if (dead) return 0xff;
        if (cmd < 0) { // octet de commande : la puce renvoie STATUS en même temps
          sync();
          const s = status();
          cmd = v; n = 0; data = []; cur = null;
          if (v === 0x61) { const q = rxq(); cur = q.shift() || null; if (cur) periph(comp).ver++; } // R_RX_PAYLOAD : retiré de la FIFO
          else if (v === 0xe1) { txq.length = 0; acks.length = 0; reuse = false; } // FLUSH_TX
          else if (v === 0xe2) rxq().length = 0; // FLUSH_RX
          else if (v === 0xe3) reuse = true; // REUSE_TX_PL
          return s;
        }
        const i = n++;
        if (cmd < 0x20) return readReg(cmd, i);
        if (cmd < 0x40) { writeReg(cmd & 0x1f, i, v); return 0; }
        if (cmd === 0x61) return cur ? cur.bytes[i] ?? 0 : 0;
        if (cmd === 0x60) { const q = rxq(); return i ? 0 : q.length ? q[0].len : 0; } // R_RX_PL_WID
        if (cmd === 0xa0 || cmd === 0xb0 || (cmd & 0xf8) === 0xa8) data.push(v);
        return 0; // ACTIVATE (0x50) : sans effet sur le nRF24L01+ ; NOP
      },
      deselect() { if (cmd === 0xa0 || cmd === 0xb0 || (cmd & 0xf8) === 0xa8) commit(); cmd = -1; },
      frame() { sync(); publish(); },
      dispose() {
        dead = true; tgen++; offs.forEach(f => f());
        const st = periph(comp); st.on = false; st.listening = false; st.ver++;
        if (irqPin) io.drive(irqPin, null);
      }
    };
  }
};
