// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Réseau informatique des programmes de l'interpréteur (runtime.js), sur le réseau simulé commun (src/net/lan.js) :
//   - Ethernet (Ethernet.h, UIPEthernet.h) par un module W5500 ou ENC28J60 relié à la carte : nœud 'e:' + id du module,
//     son état d'adresse dans module.periph.eth (lu par le plan réseau) ;
//   - les sockets du Wi-Fi d'un ESP32 / ESP8266 rejoint à un point d'accès du plan réseau : nœud 'e:' + id de la carte ;
//   - clients et serveurs TCP (EthernetClient, EthernetServer, WiFiClient, WiFiServer), UDP (EthernetUDP, WiFiUDP),
//     MQTT (PubSubClient, vrais paquets MQTT 3.1.1 de src/net/mqtt.js), Modbus TCP (ModbusTCPClient d'ArduinoModbus,
//     trames de src/net/modbus.js), ping (ESP32Ping) ;
//   - le serveur web WebServer / ESP8266WebServer joignable depuis le plan réseau (requêtes HTTP lues par
//     src/net/http.js et rangées dans la file traitée par server.handleClient()) et HTTPClient vers les machines du plan.
// Sans plan réseau (hw.lan() nul : projet sans espace « Réseau »), Ethernet se comporte comme un module sans câble et le
// Wi-Fi garde le bac à sable de runtime.js.
// Les connexions du réseau simulé sont synchrones : ce qu'une machine écrit arrive aussitôt dans le tampon de l'autre.
// Les attentes (DHCP, établissement d'une connexion, ping) passent par des générateurs qui s'endorment en temps virtuel.
import { byteStr, fromBytes, bytesOf } from '../net/bytes.js';
import { parseRequest, response } from '../net/http.js';
import { connectPacket, publishPacket, subscribePacket, unsubscribePacket, pingPacket, disconnectPacket, mqttReader, parsePublish, ackPacket, MQTT } from '../net/mqtt.js';
import { modbusRequest, readPdu, writeCoilPdu, writeRegPdu, parseResponse } from '../net/modbus.js';

/** Modules Ethernet reliés en SPI (types de composants du banc). */
export const ETH_TYPES = ['w5500', 'enc28j60'];
/** Ethernet.hardwareStatus() : EthernetW5500 pour le W5500 ; EthernetENC28J60 (UIPEthernet 2, EthernetENC) pour l'ENC28J60. */
const HW_STATUS = { w5500: 3, enc28j60: 10 };
/** Méthodes HTTP du serveur web de runtime.js (HTTP_GET 1, HTTP_POST 3…). */
const METHOD = { GET: 1, HEAD: 2, POST: 3, PUT: 4, PATCH: 5, DELETE: 6, OPTIONS: 7 };
const MODBUS_ERR = { 1: 'Illegal function', 2: 'Illegal data address', 3: 'Illegal data value', 4: 'Slave device or server failure', 6: 'Slave device or server is busy', 11: 'Target device failed to respond' };

const prefixOf = mask => { const p = String(mask || '').split('.').map(Number); if (p.length !== 4 || p.some(x => !(x >= 0 && x <= 255))) return 24; let n = 0; for (const x of p) for (let b = 7; b >= 0; b--) if ((x >> b) & 1) n++; return n; };
const maskOf = n => { const m = n <= 0 ? 0 : (0xffffffff << (32 - Math.min(32, n))) >>> 0; return [24, 16, 8, 0].map(s => (m >>> s) & 255).join('.'); };
const hex2 = n => (n & 255).toString(16).toUpperCase().padStart(2, '0');

/**
 * ctx : { hw, me (la carte), myMac (MAC Wi-Fi de la carte), warn(msg), tl, fmt(valeur, format, étiquette), now() → ms
 * virtuelles, Wait, IPAddress, periph(comp), refStore(ref, octets, n), cbuf(texte) → tableau de char du programme }.
 * Rend { classes, objects, hasLan(), wifiNetworks(), wifiJoin(w, réseau, demande), wifiLeave(w), webListen(web, newReq), lanHttp(),
 * http(…), close() }.
 */
export function createNetLib(ctx) {
  const { hw, me, warn, tl, fmt, Wait, IPAddress, periph, refStore } = ctx;
  const lan = () => (hw.lan ? hw.lan() : null) || null;
  const wifiNode = 'e:' + me.id;
  const opened = new Set(), stops = new Set(); // connexions et écoutes de ce programme, fermées à l'arrêt
  const ipText = x => (x instanceof IPAddress ? x.s : x && typeof x === 'object' && typeof x.s === 'string' ? x.s : fmt(x)).trim();
  const macText = m => (Array.isArray(m) ? m.slice(0, 6).map(hex2).join(':') : typeof m === 'string' && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(m) ? m.toUpperCase() : 'DE:AD:BE:EF:FE:ED');
  /** Module Ethernet relié à cette carte (et bien câblé), ou null. */
  const ethMod = () => {
    const list = hw.comps ? hw.comps(ETH_TYPES) : hw.peers ? hw.peers(ETH_TYPES).filter(p => p.ok).map(p => p.comp) : [];
    return list[0] || null;
  };
  const ethOf = m => periph(m).eth || null;
  const wifiSt = () => periph(me).wifi || null;
  /** Raison d'un échec du réseau simulé (ping, connexion), en français. */
  const WHY = {
    nolan: () => tl('le projet n’a pas de plan réseau (espace « Réseau ») : rien n’est branché'),
    nohw: () => tl('aucun module Ethernet (W5500, ENC28J60) n’est relié à la carte'),
    nowifi: () => tl('la carte n’est pas connectée au Wi-Fi (WiFi.status() doit valoir WL_CONNECTED)'),
    sandbox: () => tl('le réseau Wi-Fi rejoint est celui du bac à sable, hors du plan réseau : rejoignez un point d’accès ou la box du plan'),
    nolink: () => tl('pas de lien : aucun câble branché, ou câble défectueux'),
    noip: () => tl('pas d’adresse IP (Ethernet.begin() ou DHCP pas encore fait)'),
    dns: () => tl('nom inconnu sur le réseau'),
    arp: () => tl('aucune machine ne répond à cette adresse sur le réseau local'),
    nogw: () => tl('adresse hors du réseau local et aucune passerelle réglée'),
    gwout: () => tl('la passerelle n’est pas dans le sous-réseau'),
    gwunreach: () => tl('la passerelle ne répond pas'),
    gwnotrouter: () => tl('la passerelle n’est pas un routeur'),
    noroute: () => tl('aucune route vers cette adresse'),
    nat: () => tl('la box ne laisse pas entrer une connexion venue de l’extérieur (traduction d’adresses)'),
    storm: () => tl('tempête de diffusion : une boucle entre switchs bloque le réseau'),
    apipa: () => tl('adresse 169.254 : aucun serveur DHCP n’a répondu'),
    errors: () => tl('le lien perd des paquets (câble trop long ou mal serti)'),
    refused: () => tl('connexion refusée : aucun serveur n’écoute ce port'),
    'wifi:nossid': () => tl('réseau Wi-Fi introuvable'), 'wifi:auth': () => tl('mot de passe Wi-Fi refusé')
  };
  const whyText = w => { const s = String(w || ''); if (WHY[s]) return WHY[s](); if (s.startsWith('reply:')) return tl('la réponse ne revient pas ({0})', whyText(s.slice(6))); return s || tl('raison inconnue'); };

  /* ---------- Ethernet ---------- */
  class EthernetClass {
    constructor() { this.cs = null; this.to = 1000; }
    init(cs) { this.cs = cs; }
    /** Le module relié, son nœud du réseau et son état d'adresse. */
    mod() { return ethMod(); }
    hardwareStatus() { const m = ethMod(); return m ? HW_STATUS[m.type] ?? 3 : 0; }
    linkStatus() {
      const m = ethMod(); if (!m) return 0;
      const L = lan(); if (!L) return 2;
      const p = L.port('e:' + m.id, 'eth'); return p && p.up ? 1 : 2;
    }
    /** Raison pour laquelle le module n'a pas de lien utilisable (ou null). */
    linkWhy(m) {
      const L = lan(); if (!L) return WHY.nolan();
      const p = L.port('e:' + m.id, 'eth');
      if (!p) return tl('aucun câble RJ45 n’est branché sur {0} dans le plan réseau', m.name);
      if (!p.up) return tl('le câble de {0} n’établit pas de lien ({1})', m.name, p.why || '?');
      return null;
    }
    /**
     * begin(mac) : adresse par DHCP (rend 1, ou 0 après timeout ms si aucun serveur ne répond) ;
     * begin(mac, ip[, dns[, passerelle[, masque]]]) : adresse fixe (dns et passerelle : ip en .1 par défaut, comme la bibliothèque).
     */
    begin(mac, ip, dns, gw, sn) {
      const m = ethMod(), macS = macText(mac);
      const dhcp = ip === undefined || typeof ip === 'number';
      if (!m) {
        warn(tl('Ethernet.begin() : aucun module Ethernet (W5500, ENC28J60) n’est relié à {0} (bus SPI et CS) : rien ne se passe', hw.label));
        return dhcp ? 0 : undefined;
      }
      const st = periph(m);
      if (dhcp) {
        const timeout = typeof ip === 'number' ? Math.max(0, ip) : 60000;
        st.eth = { mac: macS, ip: '', prefix: 0, gw: '', dns: '', dhcp: true }; st.ver++;
        const why = this.linkWhy(m), L = lan(), l = !why && L ? L.dhcpLease('e:' + m.id, macS) : null;
        if (!l) {
          warn(tl('Ethernet.begin(mac) : aucune réponse DHCP pour {0} : {1}. La bibliothèque attend {2} s puis rend 0', m.name, why || tl('aucun serveur DHCP sur ce réseau (box absente ou DHCP désactivé)'), Math.round(timeout / 1000)));
          return new Wait(timeout, 0);
        }
        return (function* () {
          yield 1000; // DISCOVER, OFFER, REQUEST, ACK
          Object.assign(st.eth, { ip: l.ip, prefix: l.prefix, gw: l.gw, dns: l.dns || l.gw }); st.ver++;
          return 1;
        })();
      }
      const ipS = ipText(ip), dot1 = ipS.replace(/\.\d+$/, '.1');
      const dnsS = dns !== undefined ? ipText(dns) : dot1, gwS = gw !== undefined ? ipText(gw) : dot1, prefix = sn !== undefined ? prefixOf(ipText(sn)) : 24;
      st.eth = { mac: macS, ip: ipS, prefix, gw: gwS, dns: dnsS, dhcp: false }; st.ver++;
      const why = this.linkWhy(m); if (why) warn(tl('Ethernet.begin() : {0}', why));
      return undefined;
    }
    eth() { const m = ethMod(); return m ? ethOf(m) : null; }
    localIP() { const e = this.eth(); return new IPAddress(e && e.ip ? e.ip : '0.0.0.0'); }
    subnetMask() { const e = this.eth(); return new IPAddress(e && e.ip ? maskOf(e.prefix) : '0.0.0.0'); }
    gatewayIP() { const e = this.eth(); return new IPAddress(e && e.gw ? e.gw : '0.0.0.0'); }
    dnsServerIP() { const e = this.eth(); return new IPAddress(e && e.dns ? e.dns : '0.0.0.0'); }
    set(k, v) { const m = ethMod(); if (!m) return; const st = periph(m); st.eth = { mac: 'DE:AD:BE:EF:FE:ED', ip: '', prefix: 24, gw: '', dns: '', dhcp: false, ...st.eth, [k]: v }; st.ver++; }
    setLocalIP(ip) { this.set('ip', ipText(ip)); this.set('dhcp', false); }
    setSubnetMask(sn) { this.set('prefix', prefixOf(ipText(sn))); }
    setGatewayIP(gw) { this.set('gw', ipText(gw)); }
    setDnsServerIP(d) { this.set('dns', ipText(d)); }
    setMACAddress(mac) { this.set('mac', macText(mac)); }
    MACAddress(buf) { const e = this.eth(); const b = (e ? e.mac : '00:00:00:00:00:00').split(':').map(h => parseInt(h, 16)); if (Array.isArray(buf)) b.forEach((x, i) => { buf[i] = x; }); }
    /** Renouvellement du bail : le bail simulé ne s'éteint pas (DHCP_CHECK_NONE). */
    maintain() { return 0; }
    setRetransmissionTimeout() {} setRetransmissionCount() {} setHostname() {}
  }

  /* ---------- Client TCP (Ethernet ou Wi-Fi) ---------- */
  /** Nœud du réseau d'où part une connexion : { node } ou { why }. */
  const fromOf = kind => {
    if (!lan()) return { why: 'nolan' };
    if (kind === 'eth') { const m = ethMod(); return m ? { node: 'e:' + m.id } : { why: 'nohw' }; }
    const w = wifiSt();
    if (!w || w.status !== 3) return { why: 'nowifi' };
    if (!w.lan) return { why: 'sandbox' };
    return { node: wifiNode };
  };
  class NetClient {
    constructor(kind = 'eth') { this.kind = kind; this.sock = null; this.rx = ''; this.rip = '0.0.0.0'; this.rport = 0; this.lport = 0; this.to = kind === 'wifi' ? 3000 : 1000; }
    get label() { return this.kind === 'wifi' ? 'WiFiClient' : 'EthernetClient'; }
    /** Branche une connexion du réseau simulé : les octets reçus vont dans rx. */
    attach(sock) {
      this.sock = sock; this.rx = '';
      sock.onData(d => { if (this.sock === sock) { this.rx += d; if (this.rx.length > 1 << 20) this.rx = this.rx.slice(-(1 << 20)); } });
      sock.onClose(() => opened.delete(sock));
      opened.add(sock);
    }
    /** Connexion sans attente (PubSubClient, Modbus) : { ok, why }. */
    open(host, port) {
      const f = fromOf(this.kind); if (f.why) return { ok: false, why: f.why };
      const L = lan(), ip = L.resolve(ipText(host)); if (!ip) return { ok: false, why: 'dns' };
      if (this.sock) this.stop();
      const r = L.connect(f.node, ip, port | 0); if (!r.ok) return r;
      this.attach(r.sock); this.rip = ip; this.rport = port | 0; this.lport = r.sock.peer && r.sock.peer.remote ? r.sock.peer.remote.port : 0;
      return { ok: true };
    }
    /** connect(adresse ou nom, port) : 1 si la connexion s'établit, 0 sinon (refusée aussitôt, ou au bout du délai). */
    connect(host, port) {
      const r = this.open(host, port);
      if (r.ok) return new Wait(2, 1);
      warn(tl('{0}.connect({1}, {2}) : échec, {3}', this.label, ipText(host), port | 0, whyText(r.why)));
      return new Wait(r.why === 'refused' ? 2 : this.to, 0);
    }
    connected() { return this.sock && (this.sock.open || this.rx.length) ? 1 : 0; }
    __bool() { return !!this.sock && (this.sock.open || this.rx.length > 0); }
    available() { return this.rx.length; }
    /** read() : un octet (-1 si rien) ; read(tampon, n) : jusqu'à n octets copiés dans le tampon, rend leur nombre. */
    read(buf, n) {
      if (buf === undefined) { if (!this.rx) return -1; const c = this.rx.charCodeAt(0); this.rx = this.rx.slice(1); return c; }
      const k = Math.max(0, Math.min(n == null ? this.rx.length : n | 0, this.rx.length));
      const part = this.rx.slice(0, k); this.rx = this.rx.slice(k);
      if (k) refStore(buf, Array.from(bytesOf(part)), k);
      return k;
    }
    peek() { return this.rx ? this.rx.charCodeAt(0) : -1; }
    readString() { const s = this.rx; this.rx = ''; return fromBytes(s); }
    readStringUntil(c) { const ch = typeof c === 'number' ? String.fromCharCode(c & 255) : String(c)[0] || '\n', i = this.rx.indexOf(ch); const s = i < 0 ? this.rx : this.rx.slice(0, i); this.rx = i < 0 ? '' : this.rx.slice(i + 1); return fromBytes(s); }
    parseInt() { const m = /-?\d+/.exec(this.rx); if (!m) return 0; this.rx = this.rx.slice(m.index + m[0].length); return parseInt(m[0], 10); }
    parseFloat() { const m = /-?\d+(\.\d+)?/.exec(this.rx); if (!m) return 0; this.rx = this.rx.slice(m.index + m[0].length); return parseFloat(m[0]); }
    find(t) { const s = fmt(t), i = this.rx.indexOf(s); if (i < 0) { this.rx = ''; return false; } this.rx = this.rx.slice(i + s.length); return true; }
    /** Envoi : texte (UTF-8, comme le source du programme) ou octets. */
    send(d) {
      if (!this.sock || !this.sock.open) { warn(tl('{0} : écriture sur une connexion fermée, rien n’est envoyé', this.label)); return 0; }
      return this.sock.write(d) || 0;
    }
    print(x, f, tag) { return this.send(fmt(x, f, tag)); }
    println(x, f, tag) { return this.send(fmt(x, f, tag) + '\r\n'); }
    printf() { return 0; }
    write(x, n) {
      if (typeof x === 'number') return this.send(Uint8Array.of(x & 255));
      if (Array.isArray(x)) return this.send(Uint8Array.from(x.slice(0, n ?? x.length), v => v & 255));
      const s = fmt(x); return this.send(n != null ? s.slice(0, n) : s);
    }
    flush() {} setTimeout(ms) { this.to = Math.max(0, +ms || 0); } setConnectionTimeout(ms) { this.to = Math.max(0, +ms || 0); } setNoDelay() {}
    stop() { const s = this.sock; this.sock = null; this.rx = ''; if (s) { try { s.close(); } catch (e) { /* déjà fermée */ } opened.delete(s); } }
    remoteIP() { return new IPAddress(this.rip); } remotePort() { return this.rport; } localPort() { return this.lport; }
    status() { return this.sock && this.sock.open ? 0x17 : 0; }
    /** Octets reçus, retirés du tampon (PubSubClient, Modbus). */
    take() { const s = this.rx; this.rx = ''; return s; }
  }
  class EthernetClient extends NetClient { constructor() { super('eth'); } }
  class WiFiClient extends NetClient {
    constructor() { super('wifi'); }
    connect(host, port) {
      if (!lan()) { warn(tl('client.connect() : sans plan réseau (espace « Réseau » du projet), les connexions directes ne sont pas simulées ; utilisez HTTPClient')); return 0; }
      return super.connect(host, port);
    }
  }

  /* ---------- Serveur TCP ---------- */
  class NetServer {
    constructor(kind, port = 80) { this.kind = kind; this.port = port | 0; this.clients = []; this.fresh = []; this.unl = null; }
    get label() { return this.kind === 'wifi' ? 'WiFiServer' : 'EthernetServer'; }
    begin(port) {
      if (port) this.port = port | 0;
      const L = lan(); if (!L) { warn(tl('{0}.begin() : {1}', this.label, WHY.nolan())); return; }
      let node = wifiNode;
      if (this.kind === 'eth') { const m = ethMod(); if (!m) { warn(tl('{0}.begin() : {1}', this.label, WHY.nohw())); return; } node = 'e:' + m.id; }
      else { const w = wifiSt(); if (!w || w.status !== 3 || !w.lan) warn(tl('{0}.begin() : {1}', this.label, !w || w.status !== 3 ? WHY.nowifi() : WHY.sandbox())); }
      this.end();
      const C = this.kind === 'wifi' ? WiFiClient : EthernetClient;
      this.unl = L.listen(node, this.port, sock => {
        const c = new C(); c.attach(sock); c.rip = sock.remote.ip; c.rport = sock.remote.port; c.lport = this.port;
        this.clients.push(c); this.fresh.push(c);
      });
      stops.add(this.unl);
    }
    prune() { this.clients = this.clients.filter(c => c.__bool()); this.fresh = this.fresh.filter(c => c.__bool()); }
    /** Ethernet : un client qui a des octets à lire (le même tant qu'il en a). WiFi (ESP32) : comme accept(). */
    available() {
      this.prune();
      if (this.kind === 'wifi') return this.accept();
      const c = this.clients.find(x => x.rx.length > 0);
      if (c) { const i = this.fresh.indexOf(c); if (i >= 0) this.fresh.splice(i, 1); return c; }
      return new EthernetClient();
    }
    /** Nouveau client connecté, rendu une seule fois (faux s'il n'y en a pas). */
    accept() { this.prune(); return this.fresh.shift() || new (this.kind === 'wifi' ? WiFiClient : EthernetClient)(); }
    hasClient() { this.prune(); return this.fresh.length > 0; }
    /** Écrit à tous les clients connectés. */
    write(x, n) { this.prune(); let k = 0; for (const c of this.clients) if (c.sock && c.sock.open) k = c.write(x, n); return k; }
    print(x, f, tag) { const s = fmt(x, f, tag); this.prune(); for (const c of this.clients) if (c.sock && c.sock.open) c.send(s); return s.length; }
    println(x, f, tag) { return this.print(fmt(x, f, tag) + '\r\n'); }
    end() { if (this.unl) { this.unl(); stops.delete(this.unl); this.unl = null; } }
    close() { this.end(); } stop() { this.end(); }
    setNoDelay() {} getNoDelay() { return false; }
    __bool() { return !!this.unl; }
  }
  class EthernetServer extends NetServer { constructor(port) { super('eth', port); } }
  class WiFiServer extends NetServer { constructor(port) { super('wifi', port); } }

  /* ---------- UDP ---------- */
  class NetUDP {
    constructor(kind) { this.kind = kind; this.q = []; this.cur = null; this.pos = 0; this.port = 0; this.tx = null; this.unb = null; }
    get label() { return this.kind === 'wifi' ? 'WiFiUDP' : 'EthernetUDP'; }
    begin(port) {
      const f = fromOf(this.kind); if (f.why) { warn(tl('{0}.begin() : {1}', this.label, whyText(f.why))); return 0; }
      this.stop(); this.port = port | 0;
      this.unb = lan().udpBind(f.node, this.port, dg => { this.q.push(dg); if (this.q.length > 16) this.q.shift(); });
      stops.add(this.unb);
      return 1;
    }
    beginPacket(host, port) {
      const L = lan(), ip = L ? L.resolve(ipText(host)) : null;
      if (!ip) { warn(tl('{0}.beginPacket({1}) : {2}', this.label, ipText(host), whyText(L ? 'dns' : 'nolan'))); return 0; }
      this.tx = { ip, port: port | 0, b: [] }; return 1;
    }
    write(x, n) {
      if (!this.tx) return 0;
      const b = typeof x === 'number' ? [x & 255] : Array.isArray(x) ? x.slice(0, n ?? x.length).map(v => v & 255) : Array.from(bytesOf(byteStr(fmt(x))));
      this.tx.b.push(...b); return b.length;
    }
    print(x, f, tag) { return this.write(fmt(x, f, tag)); }
    println(x, f, tag) { return this.write(fmt(x, f, tag) + '\r\n'); }
    endPacket() {
      const t = this.tx; this.tx = null; if (!t) return 0;
      const f = fromOf(this.kind); if (f.why) { warn(tl('{0}.endPacket() : {1}', this.label, whyText(f.why))); return 0; }
      return lan().udpSend(f.node, this.port || 49152 + (t.port % 1000), t.ip, t.port, Uint8Array.from(t.b)) ? 1 : 0;
    }
    parsePacket() { this.cur = this.q.shift() || null; this.pos = 0; return this.cur ? this.cur.bytes.length : 0; }
    available() { return this.cur ? this.cur.bytes.length - this.pos : 0; }
    read(buf, n) {
      if (!this.cur) return -1;
      if (buf === undefined) return this.pos < this.cur.bytes.length ? this.cur.bytes[this.pos++] : -1;
      const k = Math.max(0, Math.min(n == null ? this.available() : n | 0, this.available()));
      if (k) refStore(buf, Array.from(this.cur.bytes.slice(this.pos, this.pos + k)), k);
      this.pos += k; return k;
    }
    peek() { return this.cur && this.pos < this.cur.bytes.length ? this.cur.bytes[this.pos] : -1; }
    remoteIP() { return new IPAddress(this.cur ? this.cur.from : '0.0.0.0'); }
    remotePort() { return this.cur ? this.cur.sport : 0; }
    flush() {}
    stop() { if (this.unb) { this.unb(); stops.delete(this.unb); this.unb = null; } this.q = []; this.cur = null; }
  }
  class EthernetUDP extends NetUDP { constructor() { super('eth'); } }
  class WiFiUDP extends NetUDP { constructor() { super('wifi'); } }

  /* ---------- MQTT : PubSubClient (Nick O'Leary) ---------- */
  class PubSubClient {
    /** PubSubClient(client) ; PubSubClient(adresse, port, client) ; PubSubClient(adresse, port, rappel, client). */
    constructor(a, b, c, d) {
      this.cl = null; this.host = null; this.port = 1883; this.cb = null; this.st = -1; this.rd = mqttReader(); this.inbox = [];
      this.max = 256; this.keep = 15; this.sockTo = 15; this.pid = 0; this.last = 0; this.ack = null;
      if (a instanceof NetClient) this.cl = a;
      else if (a !== undefined) { this.host = a; this.port = b | 0 || 1883; if (typeof c === 'function') { this.cb = c; this.cl = d || null; } else this.cl = c || null; }
    }
    setServer(host, port) { this.host = host; this.port = port | 0 || 1883; return this; }
    setCallback(fn) { this.cb = typeof fn === 'function' ? fn : null; return this; }
    setClient(c) { this.cl = c; return this; }
    setKeepAlive(s) { this.keep = Math.max(0, s | 0); return this; }
    setSocketTimeout(s) { this.sockTo = Math.max(1, s | 0); return this; }
    setBufferSize(n) { this.max = Math.max(16, n | 0); return true; }
    getBufferSize() { return this.max; }
    /** Paquets reçus : CONNACK attendu, messages publiés gardés pour loop(). */
    pump() {
      if (!this.cl) return;
      for (const p of this.rd.push(this.cl.take())) {
        if (p.type === MQTT.CONNACK) this.ack = p.body[1];
        else if (p.type === MQTT.PUBLISH) { this.inbox.push(parsePublish(p)); if (this.inbox.length > 64) this.inbox.shift(); }
      }
    }
    out(pkt) { this.last = ctx.now(); return this.cl.send(pkt); }
    /** connect(identifiant[, utilisateur, mot de passe]) : vrai quand le broker accepte (CONNACK 0). */
    connect(id, user, pass) {
      if (!this.cl) { warn(tl('PubSubClient : aucun client réseau (EthernetClient, WiFiClient) donné au constructeur ou à setClient()')); return false; }
      if (this.host == null) { warn(tl('PubSubClient.connect() : adresse du broker inconnue, appelez setServer(adresse, 1883)')); this.st = -2; return false; }
      const r = this.cl.open(this.host, this.port);
      if (!r.ok) {
        this.st = -2;
        warn(tl('PubSubClient.connect() vers {0}:{1} : {2}', ipText(this.host), this.port, whyText(r.why)));
        return new Wait(r.why === 'refused' ? 2 : this.cl.to, false);
      }
      const o = { keepAlive: this.keep };
      if (user != null && user !== 0 && user !== '') { o.user = fmt(user); if (pass != null && pass !== 0) o.pass = fmt(pass); }
      this.rd = mqttReader(); this.inbox = []; this.ack = null;
      this.out(connectPacket(fmt(id), o));
      const self = this, end = ctx.now() + this.sockTo * 1000;
      return (function* () {
        for (;;) {
          self.pump();
          if (self.ack != null) break;
          if (!self.cl.connected() || ctx.now() >= end) { self.st = self.cl.connected() ? -4 : -2; self.cl.stop(); return false; }
          yield 5;
        }
        self.st = self.ack;
        if (self.ack !== 0) { warn(tl('PubSubClient.connect() : le broker refuse la connexion (code {0})', self.ack)); self.cl.stop(); return false; }
        yield 2;
        return true;
      })();
    }
    connected() {
      const ok = this.st === 0 && !!this.cl && !!this.cl.sock && this.cl.sock.open;
      if (this.st === 0 && !ok) this.st = -3;
      return ok;
    }
    state() { this.connected(); return this.st; }
    /** publish(sujet, texte[, retenu]) ou publish(sujet, octets, longueur[, retenu]). */
    publish(topic, payload, a, b) {
      if (!this.connected()) return false;
      let bytes, retain;
      if (Array.isArray(payload)) { bytes = payload.slice(0, typeof a === 'number' ? a : payload.length).map(v => v & 255); retain = !!b; }
      else { bytes = Array.from(bytesOf(byteStr(fmt(payload)))); retain = !!a; }
      const t = fmt(topic), pkt = publishPacket(t, bytes, { retain });
      if (pkt.length > this.max) { warn(tl('PubSubClient.publish() : message de {0} octets, plus que le tampon de {1} octets (setBufferSize) : il n’est pas envoyé', pkt.length, this.max)); return false; }
      return this.out(pkt) > 0;
    }
    publish_P(topic, payload, a, b) { return this.publish(topic, payload, a, b); }
    subscribe(topic, qos = 0) {
      if (!this.connected() || qos > 1) return false;
      this.pid = (this.pid % 65535) + 1; return this.out(subscribePacket(this.pid, [[fmt(topic), qos | 0]])) > 0;
    }
    unsubscribe(topic) { if (!this.connected()) return false; this.pid = (this.pid % 65535) + 1; return this.out(unsubscribePacket(this.pid, [fmt(topic)])) > 0; }
    /**
     * Messages reçus : le rappel du programme s'exécute pour chacun, dans loop(), comme la vraie bibliothèque (2.8) :
     * QoS 1 : PUBACK après le rappel ; QoS 2 (que le broker n'envoie pas, l'abonnement étant en QoS 0 ou 1) : lu comme
     * un QoS 0, les deux octets de l'identifiant en tête du contenu, sans PUBREC ; sans rappel, rien, pas même le PUBACK.
     */
    loop() {
      if (!this.connected()) return false;
      this.pump();
      if (this.keep && ctx.now() - this.last >= this.keep * 1000) this.out(pingPacket());
      const msgs = this.inbox.splice(0), cb = this.cb, self = this;
      if (!msgs.length || !cb) return true;
      return (function* () {
        for (const m of msgs) {
          const bytes = m.qos === 2 ? [m.id >> 8, m.id & 255, ...m.payload] : Array.from(m.payload);
          yield* cb(ctx.cbuf(m.topic), bytes, bytes.length);
          if (m.qos === 1 && self.connected()) self.out(ackPacket(MQTT.PUBACK, m.id));
        }
        return true;
      })();
    }
    disconnect() { if (this.cl && this.cl.sock && this.cl.sock.open) this.out(disconnectPacket()); if (this.cl) this.cl.stop(); this.st = -1; }
  }

  /* ---------- Modbus TCP : ModbusTCPClient (ArduinoModbus) ---------- */
  class ModbusTCPClient {
    constructor(client) { this.cl = client instanceof NetClient ? client : new EthernetClient(); this.tid = 0; this.err = ''; this.to = 1000; }
    /** begin(adresse[, port 502]) : 1 si la connexion s'établit. */
    begin(ip, port = 502) {
      const r = this.cl.open(ip, port | 0);
      if (r.ok) { this.err = ''; return new Wait(2, 1); }
      this.err = whyText(r.why);
      warn(tl('ModbusTCPClient.begin({0}, {1}) : {2}', ipText(ip), port | 0, this.err));
      return new Wait(r.why === 'refused' ? 2 : this.to, 0);
    }
    connected() { return this.cl.connected(); }
    stop() { this.cl.stop(); } end() { this.cl.stop(); }
    setTimeout(ms) { this.to = Math.max(0, +ms || 0); }
    lastError() { return this.err; }
    /** Une requête et sa réponse (le serveur de l'automate répond aussitôt) : { ok, values, ms (durée de l'échange) }. */
    req(unit, pdu, n) {
      if (!this.cl.sock || !this.cl.sock.open) { this.err = 'Connection reset by peer'; warn(tl('ModbusTCPClient : pas de connexion, appelez begin(adresse, 502)')); return { ok: false, ms: 0 }; }
      this.tid = (this.tid + 1) & 0xffff; this.cl.take();
      this.cl.send(modbusRequest(this.tid, unit, pdu));
      const raw = this.cl.take(); if (raw.length < 9) { this.err = 'Connection timed out'; return { ok: false, ms: this.to }; }
      const r = parseResponse(bytesOf(raw).slice(7), n);
      if (!r.ok) { this.err = MODBUS_ERR[r.code] || 'Modbus exception ' + r.code; return { ok: false, ms: 2 }; }
      this.err = ''; return { ...r, ms: 2 };
    }
    /** (adresse) ou (identifiant, adresse) : la valeur lue, -1 en cas d'erreur. */
    read(fn, args) {
      const [unit, addr] = args.length >= 2 ? [args[0] & 255, args[1]] : [0xff, args[0]];
      const r = this.req(unit, readPdu(fn, addr | 0, 1), 1);
      return new Wait(r.ms, r.ok ? r.values[0] : -1);
    }
    write(args, mk) {
      const [unit, addr, v] = args.length >= 3 ? [args[0] & 255, args[1], args[2]] : [0xff, args[0], args[1]];
      const r = this.req(unit, mk(addr | 0, v), 0);
      return new Wait(r.ms, r.ok ? 1 : 0);
    }
    coilRead(...a) { return this.read(1, a); }
    discreteInputRead(...a) { return this.read(2, a); }
    holdingRegisterRead(...a) { return this.read(3, a); }
    inputRegisterRead(...a) { return this.read(4, a); }
    coilWrite(...a) { return this.write(a, (addr, v) => writeCoilPdu(addr, !!v)); }
    holdingRegisterWrite(...a) { return this.write(a, (addr, v) => writeRegPdu(addr, v | 0)); }
  }

  /* ---------- Ping (ESP32Ping, ESP8266Ping) ---------- */
  class PingClass {
    constructor() { this.avg = 0; }
    /** ping(adresse ou nom[, nombre]) : vrai si la machine répond ; un écho par seconde, comme la bibliothèque. */
    ping(host, count = 5) {
      const n = Math.max(1, count | 0), f = fromOf('wifi'), t = ipText(host);
      if (f.why) { warn(tl('Ping.ping({0}) : {1}', t, whyText(f.why))); this.avg = 0; return new Wait(n * 1000, false); }
      const r = lan().ping(f.node, t);
      if (!r.ok) { warn(tl('Ping.ping({0}) : pas de réponse, {1}', t, whyText(r.why))); this.avg = 0; return new Wait(n * 1000, false); }
      this.avg = r.ms; return new Wait((n - 1) * 1000 + r.ms, true);
    }
    averageTime() { return this.avg; }
  }

  /* ---------- Wi-Fi des cartes sur le plan réseau ---------- */
  /** Réseaux du plan (points d'accès alimentés, Wi-Fi des box), marqués lan. */
  const wifiNetworks = () => { const L = lan(); return L ? L.wifiNetworks().map(n => ({ ssid: n.ssid, pass: n.pass, rssi: n.rssi, lan: true, node: n.node })) : []; };
  /** Fin de WiFi.begin() vers un réseau du plan : association, bail DHCP (ou adresse de WiFi.config()). Met à jour w. */
  function wifiJoin(w, n, want) {
    const L = lan(), r = L.wifiJoin(wifiNode, n.ssid, want.pass, w.mac);
    if (!r.ok) { w.status = r.why === 'auth' ? 4 : 1; w.lan = false; warn(r.why === 'auth' ? tl('WiFi.begin("{0}", …) : mot de passe refusé par le réseau', want.ssid) : tl('WiFi.begin("{0}") : aucun réseau de ce nom', want.ssid)); return; }
    const fx = w.fixed;
    if (fx) Object.assign(w, { ip: String(fx), gw: w.fixedGw || String(fx).replace(/\.\d+$/, '.1'), prefix: w.fixedPrefix || 24 });
    else if (r.lease && r.lease.ip) Object.assign(w, { ip: r.lease.ip, gw: r.lease.gw, prefix: r.lease.prefix, dns: r.lease.dns });
    else { L.wifiLeave(wifiNode); w.status = 6; w.lan = false; warn(tl('WiFi.begin("{0}") : associée, mais aucun serveur DHCP ne donne d’adresse sur ce réseau (box absente ou DHCP désactivé) ; WiFi.config() fixe une adresse', want.ssid)); return; }
    Object.assign(w, { status: 3, ssid: n.ssid, rssi: n.rssi, lan: true });
  }
  function wifiLeave(w) { const L = lan(); if (w && w.lan && L) L.wifiLeave(wifiNode); if (w) w.lan = false; }

  /* ---------- Serveur web de runtime.js joignable depuis le plan ---------- */
  /** web : état du serveur (periph(carte).web : port, queue, on). newReq : fabrique de requête de runtime.js. */
  function webListen(web, newReq) {
    const L = lan(); if (!L) return;
    if (web.unl) web.unl();
    web.unl = L.listen(wifiNode, web.port, sock => {
      let buf = '';
      opened.add(sock); sock.onClose(() => opened.delete(sock));
      sock.onData(d => {
        buf += d; const q = parseRequest(buf); if (!q) return;
        buf = '';
        if (q.bad) { sock.write(response(400, 'text/plain', 'Bad Request') + 'Bad Request'); sock.close(); return; }
        const req = newReq(METHOD[q.method] || 1, q.path, q.args, q.body, sock.remote.ip);
        req.done = r => {
          const resp = r.resp || { code: 500, type: 'text/plain', body: '', headers: [] };
          if (!sock.open) return;
          sock.write(response(resp.code || 500, resp.type || 'text/html', resp.body, resp.headers || []));
          if (q.method !== 'HEAD') sock.write(String(resp.body ?? ''));
          sock.close();
        };
        sock.onClose(() => { if (req.state === 'pending') req.state = 'expired'; });
        if (!web.on) { req.state = 'expired'; sock.close(); return; }
        web.queue.push(req);
      });
    });
    stops.add(web.unl);
  }

  /* ---------- Client HTTP vers les machines du plan ---------- */
  /** La carte passe-t-elle par le plan réseau (Wi-Fi rejoint à un point d'accès du plan) ? */
  const lanHttp = () => { const w = wifiSt(); return !!lan() && !!w && w.status === 3 && !!w.lan; };
  /**
   * Requête HTTP/1.1 vers u ({ host, port, path, query } de parseUrl) : générateur qui rend le code (négatif : erreur
   * de HTTPClient) et appelle got({ code, type, body, headers }) avec la réponse.
   */
  function http(method, u, body, hdr, timeout, got) {
    const L = lan(), ip = L.resolve(u.host);
    if (!ip) { warn(tl('http.{0}() : {1} : {2}', method, u.host, WHY.dns())); return new Wait(50, -1); }
    const c = L.connect(wifiNode, ip, u.port);
    if (!c.ok) { warn(tl('http.{0}() vers {1} : {2}', method, u.host, whyText(c.why))); return new Wait(c.why === 'refused' ? 5 : 1000, -1); }
    const sock = c.sock; opened.add(sock);
    let buf = '', closed = false;
    sock.onData(d => { buf += d; });
    sock.onClose(() => { closed = true; opened.delete(sock); });
    const b = body || '', has = n => hdr.some(h => h[0].toLowerCase() === n);
    sock.write(`${method} ${u.path || '/'}${u.query ? '?' + u.query : ''} HTTP/1.1\r\nHost: ${u.host}\r\nUser-Agent: ESP32HTTPClient\r\nConnection: close\r\n${hdr.map(([k, v]) => `${k}: ${v}\r\n`).join('')}${b && !has('content-type') ? 'Content-Type: application/x-www-form-urlencoded\r\n' : ''}${b || method === 'POST' || method === 'PUT' ? `Content-Length: ${byteStr(b).length}\r\n` : ''}\r\n${b}`);
    const end = ctx.now() + timeout;
    return (function* () {
      for (;;) {
        const i = buf.indexOf('\r\n\r\n'), len = i >= 0 ? /\r\ncontent-length:\s*(\d+)/i.exec('\r\n' + buf.slice(0, i)) : null;
        if (closed || (len && buf.length - i - 4 >= +len[1])) break;
        if (ctx.now() >= end) { try { sock.close(); } catch (e) { /* déjà fermée */ } return -11; }
        yield 5;
      }
      try { sock.close(); } catch (e) { /* déjà fermée */ }
      const i = buf.indexOf('\r\n\r\n'), head = i >= 0 ? buf.slice(0, i) : buf;
      const code = +((/^HTTP\/\d\.\d\s+(\d+)/.exec(head) || [])[1] || 0);
      if (!code) return -7; // HTTPC_ERROR_NO_HTTP_SERVER
      const headers = head.split('\r\n').slice(1).map(l => { const k = l.indexOf(':'); return [l.slice(0, k).trim(), l.slice(k + 1).trim()]; });
      got({ code, type: ((headers.find(h => /^content-type$/i.test(h[0])) || [])[1]) || 'text/html', body: fromBytes(buf.slice(i + 4)), headers });
      return code;
    })();
  }

  /** Fin du programme : connexions fermées, écoutes retirées, carte retirée du Wi-Fi du plan, module sans adresse. */
  function close() {
    for (const f of stops) { try { f(); } catch (e) { /* déjà retirée */ } }
    stops.clear();
    for (const s of opened) { try { s.close(); } catch (e) { /* déjà fermée */ } }
    opened.clear();
    const w = wifiSt(); if (w && w.lan) { wifiLeave(w); w.status = 6; w.ip = ''; }
    const m = ethMod(); if (m && m.periph && m.periph.eth) { m.periph.eth = { ...m.periph.eth, ip: '', gw: '', dns: '' }; m.periph.ver++; }
  }

  return {
    classes: {
      EthernetClass, EthernetClient, EthernetServer, EthernetUDP, WiFiClient, WiFiServer, WiFiUDP,
      // Cœur arduino-esp32 3.x : NetworkClient, NetworkServer, NetworkUDP (mêmes classes).
      NetworkClient: WiFiClient, NetworkServer: WiFiServer, NetworkUDP: WiFiUDP,
      PubSubClient, ModbusTCPClient, PingClass
    },
    objects: { Ethernet: new EthernetClass(), Ping: new PingClass() },
    hasLan: () => !!lan(), wifiNetworks, wifiJoin, wifiLeave, webListen, lanHttp, http, close, whyText
  };
}
