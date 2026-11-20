// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles : réseau informatique (projets d'objets connectés). La carte rejoint le réseau par un module Ethernet relié en
// SPI (W5500 : bibliothèque Ethernet ; ENC28J60 : EthernetENC) ou par son Wi-Fi (ESP32, ESP32-S3, ESP32-C3, ESP8266) ;
// les règles publient des valeurs sur un serveur MQTT, réagissent aux messages reçus, et montrent une page web.
//
// Pseudo-composant NET (« @net », « Réseau » dans le panneau), comme le moniteur série de rules.js :
//   mesures (NET_SIG) : src { comp: NET, sig, topic? } — msg : texte reçu sur le sujet `topic` (événement) ; num : nombre
//     reçu sur ce sujet (événement) ; page : chemin d'une demande de la page web, « /on » (événement) ; online : la carte
//     a une adresse sur le réseau ; mqtt : la carte est connectée au serveur MQTT ;
//   actions (NET_ACTS) : { kind: 'act', comp: NET, act: 'publish', topic, what? | arg } publie une valeur (mesure ou
//     variable) ou un texte sur un sujet ; { act: 'page', what? | arg, line? } : une ligne de la page web de la carte.
// Réglages du programme : un élément { kind: 'net', id, board?, dhcp, ip, mac, ssid, pass, broker, port } de la liste des
//   règles (un par carte au plus ; sans lui, NET_DEFAULTS).
//
// Code produit, robuste comme le reste des règles : rien n'attend le réseau dans loop() (connexion au serveur MQTT
// retentée toutes les 5 s au plus, nouvel essai DHCP toutes les 30 s), mqtt.loop() à chaque tour, sujets et textes fixes
// en flash sur AVR (PSTR, F), aucun String, valeurs publiées quand elles changent (une fois par seconde au plus) ou à
// chaque événement, mesures NaN jamais publiées. La page web est lue au fil des tours (une demande peut arriver en
// plusieurs morceaux) et sa réponse, écrite à la fin du tour, montre les valeurs de ce tour : du HTML statique, sans
// rafraîchissement automatique.
import { tl, quote, COLON } from '../i18n/index.js';
import { kindOf } from '../sim/boards.js';

export const NET = '@net';
/** Modules Ethernet reliés en SPI, et cartes qui ont le Wi-Fi. */
export const ETH_TYPES = ['w5500', 'enc28j60'];
export const WIFI_KINDS = ['esp32', 'esp32s3', 'esp32c3', 'nodemcu'];
export const NET_SIG = {
  msg: { label: tl('reçoit un message'), kind: 'text', event: true, len: 32, v: 'message', topic: true, short: tl('Message') },
  num: { label: tl('reçoit un nombre'), kind: 'num', type: 'float', event: true, def: 0, range: [0, 100], v: 'nombre', topic: true, short: tl('Valeur') },
  page: { label: tl('reçoit une demande de page web'), kind: 'text', event: true, len: 23, v: 'chemin', short: tl('Page') },
  online: { label: tl('la carte est connectée au réseau'), neg: tl('la carte n’est pas connectée au réseau'), kind: 'bool', v: 'enLigne', short: tl('Réseau') },
  mqtt: { label: tl('la carte est connectée au serveur MQTT'), neg: tl('la carte n’est pas connectée au serveur MQTT'), kind: 'bool', v: 'mqttOk', short: 'MQTT' }
};
export const NET_ACTS = {
  publish: { label: tl('publie'), arg: { kind: 'text', def: tl('Bonjour'), max: 64 }, what: true, topic: true },
  page: { label: tl('affiche sur la page web'), arg: { kind: 'text', def: tl('Bonjour'), max: 64 }, what: true, rows: 8 }
};
/** Lignes de la page web. */
export const PAGE_ROWS = 8;
export const NET_DEFAULTS = { dhcp: true, ip: '192.168.1.177', mac: '', ssid: 'Atelier', pass: 'jollof2024', broker: '192.168.1.10', port: 1883 };
export const TOPIC_PUB = 'atelier/mesure', TOPIC_SUB = 'atelier/commande';

/* ---------------- Réglages ---------------- */
const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
/** Sujet MQTT : sans espaces ni guillemets, 48 caractères au plus ; un sujet publié n'a pas de joker (+, #). */
export const cleanTopic = (t, pub) => { const s = String(t ?? '').trim().replace(/[\s"\\]/g, '').replace(pub ? /[+#]/g : /$^/, '').slice(0, 48); return s || (pub ? TOPIC_PUB : TOPIC_SUB); };
/** Chemin d'une page : commence par « / ». */
export const cleanPath = p => { const s = String(p ?? '').trim().replace(/[\s"\\?]/g, '').slice(0, 22); return s.startsWith('/') ? s : '/' + s; };
/** Réglages du réseau remis en ordre (élément { kind: 'net' }). */
export function fixNet(r) {
  r.id = r.id || 'n' + Math.random().toString(36).slice(2, 8);
  r.dhcp = r.dhcp !== false;
  r.ip = IP_RE.test(String(r.ip || '').trim()) ? String(r.ip).trim() : NET_DEFAULTS.ip;
  const mac = String(r.mac || '').trim().toUpperCase().replace(/-/g, ':');
  r.mac = MAC_RE.test(mac) ? mac : '';
  r.ssid = String(r.ssid ?? NET_DEFAULTS.ssid).slice(0, 32);
  r.pass = String(r.pass ?? NET_DEFAULTS.pass).slice(0, 63);
  r.broker = String(r.broker ?? '').trim().replace(/[\s"\\]/g, '').slice(0, 63) || NET_DEFAULTS.broker;
  r.port = Math.max(1, Math.min(65535, Math.round(+r.port || NET_DEFAULTS.port)));
  return r;
}
/** Élément de réglages du réseau de la carte (le sien, sinon celui de toutes les cartes), ou null. */
export const netItem = (rules, board) => (rules || []).find(r => r && r.kind === 'net' && board && r.board === board.id) || (rules || []).find(r => r && r.kind === 'net' && !r.board) || null;
export const netCfg = (rules, board) => fixNet({ ...NET_DEFAULTS, ...(netItem(rules, board) || {}) });
/** Adresse MAC propre à la carte (localement administrée : 02:4A:…), tant que l'élève n'en choisit pas une. */
export function autoMac(board) {
  let h = 0x811c9dc5; for (const ch of String(board ? board.id : '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return ['02', '4A', ...[24, 16, 8, 0].map(s => ((h >>> s) & 255).toString(16).toUpperCase().padStart(2, '0'))].join(':');
}
/** « Réseau : Ethernet par DHCP, Wi-Fi « Atelier », serveur MQTT 192.168.1.10:1883. » ; via : 'eth' ou 'wifi', le seul qui sert. */
export function netText(n, via) {
  const c = fixNet({ ...n }), eth = c.dhcp ? tl('par DHCP') : tl('à l’adresse {0}', c.ip);
  if (via === 'eth') return tl('Réseau : Ethernet {0}, serveur MQTT {1}:{2}.', eth, c.broker, c.port);
  if (via === 'wifi') return tl('Réseau : Wi-Fi {0}, serveur MQTT {1}:{2}.', quote(c.ssid), c.broker, c.port);
  return tl('Réseau : Ethernet {0}, Wi-Fi {1}, serveur MQTT {2}:{3}.', eth, quote(c.ssid), c.broker, c.port);
}
/** Comment la carte rejoint le réseau : { via: 'eth', mod } (module relié), { via: 'wifi' }, ou null. */
export function netLink(board, comps, inspect) {
  if (!board) return null;
  const mod = (comps || []).find(c => ETH_TYPES.includes(c.type) && inspect(c).board === board);
  if (mod) return { via: 'eth', mod };
  return WIFI_KINDS.includes(kindOf(board)) ? { via: 'wifi' } : null;
}

/* ---------------- Phrases ---------------- */
/** Nom d'une valeur du réseau : « le message du sujet « maison/led » ». */
export function netSrcName(src) {
  const q = quote(src.topic || TOPIC_SUB);
  return { msg: tl('le message du sujet {0}', q), num: tl('le nombre reçu sur le sujet {0}', q), page: tl('la page web demandée'), online: tl('la connexion au réseau'), mqtt: tl('la connexion au serveur MQTT') }[src.sig] || tl('(réseau ?)');
}
/** Événement sans comparaison : « un message arrive sur le sujet « maison/led » ». */
export function netEventText(src) {
  const q = quote(src.topic || TOPIC_SUB);
  return { msg: tl('un message arrive sur le sujet {0}', q), num: tl('un nombre arrive sur le sujet {0}', q), page: tl('la page web reçoit une demande') }[src.sig] || netSrcName(src);
}
/** « publie DHT1 · température sur le sujet « maison/temp » », « la page web affiche « Alerte » (ligne 2) ». what : nom de la valeur. */
export function netActText(it, what) {
  const val = what || quote(String(it.arg ?? ''));
  if (it.act === 'publish') return tl('publie {0} sur le sujet {1}', val, quote(cleanTopic(it.topic, true)));
  if (it.act === 'page') return tl('la page web affiche {0}', val) + (it.line ? tl(' (ligne {0})', it.line) : '');
  return tl('(réseau ?)');
}

/* ---------------- Génération du code ---------------- */
const ident = s => { let n = String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); if (/^\d/.test(n)) n = '_' + n; return n; };
const hex2 = n => `0x${(n & 255).toString(16).toUpperCase().padStart(2, '0')}`;
const html = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ind = (lines, n = 1) => lines.map(l => (l ? '  '.repeat(n) + l : l));
/** État du réseau pour un programme en cours de génération. */
const STATES = new WeakMap();
const state = g => { let s = STATES.get(g); if (!s) STATES.set(g, (s = { topics: new Map(), rows: new Map(), codes: new Map(), pubs: [] })); return s; };
/** Texte fixe en flash sur AVR. */
const pstr = (g, text) => (g.avr ? `PSTR(${g.cstr(text)})` : g.cstr(text));

/**
 * Prépare le réseau de la carte (une fois) : bibliothèques, réglages, démarrage dans setup(). Rend l'état, ou null si
 * la carte n'a ni module Ethernet relié ni Wi-Fi (une note le dit dans le programme).
 */
function init(g) {
  const s = state(g); if (s.ok !== undefined) return s.ok ? s : null;
  s.ok = false;
  const L = netLink(g.board, g.cx.comps, g.cx.inspect), cfg = netCfg(g.cx.rules, g.board);
  s.L = L; s.cfg = cfg;
  if (!L) {
    const m = tl('// Réseau : {0} n’a ni module Ethernet relié (W5500, ENC28J60) ni Wi-Fi : les règles du réseau sont ignorées.', g.board.name);
    if (!g.notes.includes(m)) g.notes.push(m);
    return null;
  }
  const N = s.N = { on: g.uniq('reseauEnLigne'), check: g.uniq('reseauVerif') };
  if (L.via === 'eth') {
    const cs = g.pinConst(L.mod, 'CS', tl('sélection (CS) du module {0} sur le bus SPI', L.mod.name));
    if (!cs) { g.missing(L.mod); return null; }
    const enc = L.mod.type === 'enc28j60';
    g.inc.add('SPI.h'); g.inc.add(enc ? 'EthernetENC.h' : 'Ethernet.h');
    N.mac = g.uniq('reseauMac');
    const mac = (cfg.mac || autoMac(g.board)).split(':').map(h => hex2(parseInt(h, 16)));
    g.glob.push(tl('// Réseau : module Ethernet {0}', L.mod.name), tl('uint8_t {0}[6] = {{1}}; // adresse MAC du module : chaque carte du réseau doit avoir la sienne', N.mac, mac.join(', ')));
    if (cfg.dhcp) {
      N.lease = g.uniq('reseauAdresse'); N.retry = g.uniq('reseauEssai');
      g.glob.push(tl('bool {0} = false; // adresse obtenue de la box (DHCP)', N.lease), tl('uint32_t {0} = 0; // dernier essai DHCP', N.retry));
      g.setup.push('{', tl('  // Réseau : module {0} (CS sur {1}) ; adresse demandée à la box (DHCP), 8 s au plus', L.mod.name, cs), `  Ethernet.init(${cs});`,
        `  Serial.println(${g.flash(tl('Réseau : demande d’une adresse (DHCP)…'))});`, `  ${N.lease} = Ethernet.begin(${N.mac}, 8000UL, 2000UL) != 0;`,
        `  if (!${N.lease}) Serial.println(${g.flash(tl('Réseau : pas de réponse DHCP (câble ? box ?), nouvel essai toutes les 30 s'))});`, `  ${N.retry} = millis();`, '}');
    } else {
      N.ip = g.uniq('reseauIp');
      g.glob.push(tl('IPAddress {0}({1}); // adresse fixe de la carte (passerelle et DNS : la même en .1)', N.ip, cfg.ip.split('.').join(', ')));
      g.setup.push('{', tl('  // Réseau : module {0} (CS sur {1}), adresse fixe', L.mod.name, cs), `  Ethernet.init(${cs});`, `  Ethernet.begin(${N.mac}, ${N.ip});`, '}');
    }
  } else {
    const esp8266 = kindOf(g.board) === 'nodemcu';
    g.inc.add(esp8266 ? 'ESP8266WiFi.h' : 'WiFi.h');
    N.ssid = g.uniq('RESEAU_WIFI'); N.pass = g.uniq('RESEAU_CLE');
    g.glob.push(tl('// Réseau : Wi-Fi de la carte'), tl('const char {0}[] = {1}; // nom du réseau Wi-Fi', N.ssid, g.cstr(cfg.ssid)), tl('const char {0}[] = {1}; // son mot de passe', N.pass, g.cstr(cfg.pass)));
    g.setup.push(tl('// Réseau : connexion au Wi-Fi, faite en arrière-plan (loop() ne l’attend pas)'), 'WiFi.mode(WIFI_STA);', `WiFi.begin(${N.ssid}, ${N.pass});`);
  }
  g.glob.push(tl('bool {0} = false; // la carte a une adresse sur le réseau', N.on), tl('uint32_t {0} = 0; // dernière vérification du lien', N.check));
  s.ok = true;
  return s;
}
/** Serveur MQTT (PubSubClient) : objets et réglages, une fois. */
function mqttOf(g, s) {
  if (s.M) return s.M;
  const M = s.M = { cli: g.uniq('reseauClient'), mqtt: g.uniq('mqtt'), host: g.uniq('MQTT_SERVEUR'), port: g.uniq('MQTT_PORT'), id: g.uniq('MQTT_ID'), on: g.uniq('mqttEnLigne'), wait: g.uniq('mqttAttendre'), last: g.uniq('mqttEssai') };
  g.inc.add('PubSubClient.h');
  const id = ('jollof-' + String(g.board.name).replace(/[^A-Za-z0-9_-]/g, '')).slice(0, 23);
  g.glob.push(tl('// Serveur MQTT'), `${s.L.via === 'eth' ? 'EthernetClient' : 'WiFiClient'} ${M.cli};`, `PubSubClient ${M.mqtt}(${M.cli});`,
    tl('const char {0}[] = {1}; // adresse (ou nom) du serveur MQTT', M.host, g.cstr(s.cfg.broker)), `constexpr uint16_t ${M.port} = ${s.cfg.port};`,
    tl('const char {0}[] = {1}; // nom de la carte auprès du serveur (unique)', M.id, g.cstr(id)),
    tl('bool {0} = false; // connectée au serveur MQTT', M.on), tl('bool {0} = false; // un essai vient d’échouer : attendre avant le suivant', M.wait), `uint32_t ${M.last} = 0;`);
  return M;
}
/** Page web : serveur, lecture des demandes, une fois. */
function webOf(g, s) {
  if (s.W) return s.W;
  const W = s.W = { srv: g.uniq('serveurWeb'), cli: g.uniq('pageClient'), line: g.uniq('pageLigne'), n: g.uniq('pageN'), step: g.uniq('pageEtape'), t0: g.uniq('pageDebut'), path: g.uniq('pageChemin'),
    q: g.uniq('pageQuoi'), num: g.uniq('pageNombre') };
  W.ev = g.uniq(`${W.path}_recu`);
  const eth = s.L.via === 'eth';
  g.glob.push(tl('// Page web de la carte (port 80)'), `${eth ? 'EthernetServer' : 'WiFiServer'} ${W.srv}(80);`, tl('{0} {1}; // navigateur dont la demande est en cours de lecture', eth ? 'EthernetClient' : 'WiFiClient', W.cli),
    tl('char {0}[48] = ""; // première ligne de la demande : GET /chemin HTTP/1.1', W.line), tl('uint8_t {0} = 0; // longueur de la ligne en cours', W.n),
    tl('uint8_t {0} = 0; // 0 : première ligne, 1 : en-têtes, 2 : demande complète, la réponse part en fin de tour', W.step), `uint32_t ${W.t0} = 0;`,
    tl('char {0}[24] = ""; // chemin demandé, « /on »', W.path), tl('bool {0} = false; // vrai pendant le tour où une page est demandée', W.ev));
  g.events.push({ c: NET, ev: W.ev, lines: [], period: 0 });
  if (eth) g.setup.push(`${W.srv}.begin(); // ${tl('la page web devient joignable')}`);
  return W;
}
/** Sujet auquel la carte s'abonne : texte reçu, drapeau, nombre (num). */
function topicOf(g, s, topic) {
  const t = cleanTopic(topic, false);
  if (s.topics.has(t)) return s.topics.get(t);
  mqttOf(g, s);
  const base = g.uniq('mqtt_' + (ident(t) || 'sujet')), e = { topic: t, buf: base, ev: g.uniq(`${base}_recu`), num: null, numEv: null };
  g.glob.push(tl('char {0}[33] = ""; // dernier message reçu sur {1}', base, quote(t)), tl('bool {0} = false; // vrai pendant le tour où un message arrive sur {1}', e.ev, quote(t)));
  g.events.push({ c: NET, ev: e.ev, lines: [], period: 0 });
  s.topics.set(t, e);
  return e;
}

/** Valeur d'une source du réseau, comme source() de rules.js : { v, sig, ev?, label, norm? } ou null. */
export function netSource(g, src) {
  const sig = NET_SIG[src.sig]; if (!sig) return null;
  const s = init(g); if (!s) return null;
  if (src.sig === 'online') return { v: s.N.on, sig, label: { name: 'Reseau: ', unit: '', kind: 'bool' } };
  if (src.sig === 'mqtt') return { v: mqttOf(g, s).on, sig, label: { name: 'MQTT: ', unit: '', kind: 'bool' } };
  if (src.sig === 'page') { const W = webOf(g, s); return { v: W.path, sig, ev: W.ev, label: { name: 'Page: ', unit: '', kind: 'text' }, norm: cleanPath }; }
  const e = topicOf(g, s, src.topic);
  if (src.sig === 'msg') return { v: e.buf, sig, ev: e.ev, label: { name: 'Message: ', unit: '', kind: 'text' } };
  if (!e.num) {
    e.num = g.uniq(`${e.buf}_nombre`); e.numEv = g.uniq(`${e.num}_recu`);
    g.glob.push(tl('float {0} = 0; // nombre du dernier message reçu sur {1} (0 si ce n’est pas un nombre)', e.num, quote(e.topic)), `bool ${e.numEv} = false;`);
    g.events.push({ c: NET, ev: e.numEv, lines: [], period: 0 });
  }
  return { v: e.num, sig, ev: e.numEv, label: { name: 'Nombre: ', unit: '', kind: 'num', d: 2 } };
}

/** Aide : empreinte d'un texte (la même que celle des écrans de rules.js). */
function fingerprint(g) {
  if (!g.helpers.some(h => h.includes('uint32_t empreinte('))) g.helpers.push([tl('// Empreinte d’un texte (FNV-1a) : savoir s’il a changé sans en garder une copie.'), 'uint32_t empreinte(const char *s) {', '  uint32_t h = 2166136261UL;', '  for (uint8_t i = 0; s[i] != \'\\0\'; i++) h = (h ^ (uint8_t)s[i]) * 16777619UL;', '  return h;', '}'].join('\n'));
}
/**
 * Code d'une action du réseau. x : valeur choisie (source() de rules.js) ou null (texte fixe it.arg) ; ctx.level : la
 * branche dure (la valeur est publiée quand elle change, une fois par seconde au plus), sinon instant unique (événement,
 * minuterie, « dès que ») : publiée à chaque fois.
 */
export function netAct(g, it, ctx, x, name) {
  const s = init(g); if (!s) return [tl('// (pas de réseau sur cette carte : action ignorée)')];
  const text = String(it.arg ?? NET_ACTS.publish.arg.def).replace(/[\r\n]/g, ' ').slice(0, 64);
  if (it.act === 'publish') {
    const M = mqttOf(g, s), topic = cleanTopic(it.topic, true), T = pstr(g, topic);
    if (g.avr) helperPub(g, M);
    const send = p => (g.avr ? `mqttPublier(${T}, ${p})` : `${M.mqtt}.publish(${T}, ${p})`);
    if (!x) return g.avr ? [`mqttPublierP(${T}, PSTR(${g.cstr(text)}));`] : [`${M.mqtt}.publish(${T}, ${g.cstr(text)});`];
    const kind = x.sig.kind, flt = x.sig.type === 'float', d = Math.max(1, Math.min(3, (x.label && x.label.d) || 2));
    const vdecl = kind === 'bool' ? `const bool v = ${x.v};` : kind === 'text' ? null : flt ? `const float v = ${x.v};` : `const int32_t v = ${x.v};`;
    const conv = kind === 'bool' || kind === 'text' ? [] : flt ? ['char texte[16];', `dtostrf(v, 0, ${d}, texte);`] : ['char texte[12];', 'ltoa(v, texte, 10);'];
    const payload = kind === 'bool' ? 'v ? "1" : "0"' : kind === 'text' ? x.v : 'texte';
    if (!ctx.level) {
      // Instant unique : publiée chaque fois.
      const body = [...conv, `${send(payload)};`];
      return ['{', ...ind([...(vdecl ? [vdecl] : []), ...(flt ? [tl('if (!isnan(v)) { // mesure invalide : rien n’est publié'), ...ind(body), '}'] : body)]), '}'];
    }
    // Branche qui dure : publiée quand elle change, une fois par seconde au plus, et de nouveau après une reconnexion.
    const k = s.pubs.length + 1, P = { done: g.uniq(`pub${k}_fait`), val: g.uniq(`pub${k}_valeur`), t: g.uniq(`pub${k}_t`) };
    s.pubs.push(P);
    const vtype = kind === 'bool' ? 'bool' : kind === 'text' ? 'uint32_t' : flt ? 'float' : 'int32_t';
    g.glob.push(tl('bool {0} = false; // {1} : déjà publiée (depuis la connexion)', P.done, name || x.v), `${vtype} ${P.val} = ${kind === 'bool' ? 'false' : '0'};`, `uint32_t ${P.t} = 0;`);
    if (kind === 'text') fingerprint(g);
    const cur = kind === 'text' ? 'h' : 'v', now = g.now();
    return ['{', ...ind([...(vdecl ? [vdecl] : [`const uint32_t h = empreinte(${x.v});`]),
      tl('if ({0}(!{1} || {2} != {3}) && {4} - {5} >= 1000UL) { // a changé (au plus une fois par seconde)', flt ? '!isnan(v) && ' : '', P.done, cur, P.val, now, P.t),
      `  ${P.t} = ${now};`, ...ind(conv), `  if (${send(payload)}) {`, `    ${P.val} = ${cur};`, `    ${P.done} = true;`, '  }', '}']), '}'];
  }
  if (it.act === 'page') {
    // Ligne : une par valeur affichée ; les textes fixes partagent une ligne « message » (le dernier écrit reste).
    const W = webOf(g, s), key = x ? `v:${x.v}` : 't';
    if (!s.rows.has(key)) s.rows.set(key, s.rows.size % PAGE_ROWS);
    const row = it.line ? Math.max(1, Math.min(PAGE_ROWS, it.line | 0)) - 1 : s.rows.get(key);
    const ck = x ? `v|${x.v}|${name}` : `t|${text}`;
    if (!s.codes.has(ck)) s.codes.set(ck, { code: Math.min(255, s.codes.size + 1), x, name, text });
    const c = s.codes.get(ck).code, set = `${W.q}[${row}] = ${c};`;
    if (!x) return [set];
    if (x.sig.kind === 'text') return [set]; // texte : une variable globale, lue au moment de la réponse
    return [set, `${W.num}[${row}] = ${x.sig.kind === 'bool' ? `${x.v} ? 1 : 0` : x.v};`];
  }
  return [];
}
/** AVR : publier avec un sujet (et un texte fixe) gardés en flash. */
function helperPub(g, M) {
  if (g.helpers.some(h => h.includes('bool mqttPublier('))) return;
  g.helpers.push([tl('// Publie un texte sur un sujet gardé en mémoire flash (PSTR) ; faux si le serveur MQTT n’est pas joignable.'), 'bool mqttPublier(PGM_P sujet, const char *texte) {',
    '  char s[49];', '  strlcpy_P(s, sujet, sizeof(s));', `  return ${M.mqtt}.publish(s, texte);`, '}', '', tl('// Même chose avec un texte fixe, lui aussi en flash.'), 'bool mqttPublierP(PGM_P sujet, PGM_P texte) {',
    '  char s[49], t[65];', '  strlcpy_P(s, sujet, sizeof(s));',
    tl('  strlcpy_P(t, texte, sizeof(t)); // copié en RAM : publish_P() de PubSubClient 2.8 mesure mal un texte en flash'), `  return ${M.mqtt}.publish(s, t);`, '}'].join('\n'));
}

/**
 * Signaux d'un module Ethernet (W5500, ENC28J60) : « est relié au réseau » (lien du câble), « a une adresse IP ».
 * Comme read() de rules-parts.js.
 */
export function ethRead(g, c, key) {
  const s = init(g); if (!s) return null;
  if (s.L.via !== 'eth' || s.L.mod !== c) return g.missing(c, tl('n’est pas le module réseau de {0} (un seul module Ethernet par carte)', g.board.name));
  if (key === 'link') return { expr: 'Ethernet.linkStatus() == LinkON', every: 250, why: tl('une lecture du module par le bus SPI') };
  if (key === 'ip') return { expr: s.N.lease || 'true', note: s.N.lease ? tl('bail DHCP obtenu') : tl('adresse fixe') };
  return null;
}

/**
 * Fin du programme : lignes de chaque tour (lien, serveur MQTT, page web), rappel des messages reçus, réponse de la page.
 * links : chemins des demandes attendues par les règles (« /on »), proposés en liens sur la page.
 */
export function netFinish(g, { links = [] } = {}) {
  const s = state(g); if (!s.ok) return;
  const { N, L, M, W } = s, now = g.now(), eth = L.via === 'eth', P = g.avr ? 'strcmp_P' : 'strcmp';
  const ip = eth ? 'Ethernet.localIP()' : 'WiFi.localIP()';
  const lines = [tl('// Réseau : lien et adresse vérifiés 4 fois par seconde'), `if (${now} - ${N.check} >= 250UL) {`, `  ${N.check} = ${now};`];
  if (eth && N.lease) lines.push(tl('  const int bail = Ethernet.maintain(); // entretient le bail DHCP ; 1 ou 3 : bail perdu'), `  if (bail == 1 || bail == 3) ${N.lease} = false;`,
    tl('  if (!{0} && Ethernet.linkStatus() == LinkON && {1} - {2} >= 30000UL) { // nouvel essai DHCP (bloque 4 s au plus)', N.lease, now, N.retry),
    `    ${N.retry} = ${now};`, `    ${N.lease} = Ethernet.begin(${N.mac}, 4000UL, 2000UL) != 0;`, '  }');
  lines.push(`  const bool enLigne = ${eth ? `${N.lease ? `${N.lease} && ` : ''}Ethernet.linkStatus() == LinkON` : 'WiFi.status() == WL_CONNECTED'};`,
    `  if (enLigne != ${N.on}) {`, `    ${N.on} = enLigne;`, '    if (enLigne) {', `      Serial.print(${g.flash(eth ? tl('Réseau : adresse ') : tl('Réseau : Wi-Fi connecté, adresse '))});`, `      Serial.println(${ip});`,
    ...(W && !eth ? [`      ${W.srv}.begin(); // ${tl('la page web devient joignable')}`] : []),
    '    } else {', `      Serial.println(${g.flash(eth ? tl('Réseau : hors ligne (câble débranché ou adresse perdue)') : tl('Réseau : Wi-Fi perdu, reconnexion en arrière-plan'))});`, '    }', '  }', '}');
  if (M) {
    const topics = [...s.topics.values()];
    g.setup.push(`${M.mqtt}.setServer(${M.host}, ${M.port});`, ...(topics.length ? [tl('{0}.setCallback(mqttRecu); // messages reçus : mqttRecu()', M.mqtt)] : []),
      // ESP32 : une connexion TCP sans réponse attend 3 s par défaut ; 1 s suffit sur un réseau local.
      ...(!eth && g.kind !== 'nodemcu' ? [tl('{0}.setConnectionTimeout(1000); // serveur injoignable : 1 s d’attente au plus', M.cli)] : []),
      tl('{0}.setSocketTimeout(2); // une connexion qui ne répond pas n’arrête le programme que 2 s', M.mqtt));
    const subs = topics.map(e => (g.avr ? `mqttAbonner(${pstr(g, e.topic)});` : `${M.mqtt}.subscribe(${g.cstr(e.topic)});`));
    lines.push(tl('// Serveur MQTT : messages reçus et maintien de la connexion à chaque tour ; connexion retentée toutes les 5 s au plus'),
      `if (${M.on}) ${M.on} = ${M.mqtt}.loop(); // ${tl('les messages reçus passent par mqttRecu()')}`,
      `else if (${N.on} && (!${M.wait} || ${now} - ${M.last} >= 5000UL)) {`, `  ${M.last} = ${now};`,
      tl('  {0} = {1}.connect({2}); // attend la réponse du serveur (2 s au plus)', M.on, M.mqtt, M.id), `  ${M.wait} = !${M.on};`,
      `  if (${M.on}) {`, `    Serial.println(${g.flash(tl('MQTT : connecté'))});`, ...ind(subs, 2), ...s.pubs.map(p => tl('    {0} = false; // publiée de nouveau', p.done)), '  } else {',
      `    Serial.print(${g.flash(tl('MQTT : pas de connexion (code '))});`, `    Serial.print(${M.mqtt}.state());`, `    Serial.println(${g.flash(tl('), nouvel essai dans 5 s'))});`, '  }', '}');
    if (g.avr && topics.length) g.helpers.push([tl('// Abonnement à un sujet gardé en mémoire flash (PSTR).'), 'bool mqttAbonner(PGM_P sujet) {', '  char s[49];', '  strlcpy_P(s, sujet, sizeof(s));', `  return ${M.mqtt}.subscribe(s);`, '}'].join('\n'));
    if (topics.length) {
      const wild = topics.some(e => /[+#]/.test(e.topic));
      if (wild) {
        g.helpers.push([tl('// Le sujet reçu correspond-il au filtre ? « + » : un niveau quelconque, « # » : tous les niveaux qui suivent.'), 'bool sujetVa(const char *filtre, const char *sujet) {',
          '  uint8_t i = 0, j = 0;', '  for (;;) {', "    if (filtre[i] == '#') return true;", "    if (filtre[i] == '+') {", "      while (sujet[j] != '\\0' && sujet[j] != '/') j++;", '      i++;', '      continue;', '    }',
          '    if (filtre[i] != sujet[j]) return false;', "    if (filtre[i] == '\\0') return true;", '    i++;', '    j++;', '  }', '}',
          ...(g.avr ? ['', 'bool sujetVaP(PGM_P filtre, const char *sujet) {', '  char f[49];', '  strlcpy_P(f, filtre, sizeof(f));', '  return sujetVa(f, sujet);', '}'] : [])].join('\n'));
      }
      const match = e => (/[+#]/.test(e.topic) ? `${g.avr ? 'sujetVaP' : 'sujetVa'}(${pstr(g, e.topic)}, sujet)` : `${P}(sujet, ${pstr(g, e.topic)}) == 0`);
      g.helpers.push([tl('// Copie le contenu d’un message (des octets, sans zéro final) dans un texte de n caractères (fin coupée si trop long).'),
        'void mqttCopier(char *texte, uint8_t n, const byte *contenu, unsigned int taille) {', '  const uint8_t k = taille < (unsigned int)(n - 1) ? (uint8_t)taille : (uint8_t)(n - 1);',
        '  for (uint8_t i = 0; i < k; i++) texte[i] = (char)contenu[i];', "  texte[k] = '\\0';", '}', '',
        tl('// Message reçu du serveur MQTT (appelé par {0}.loop()) : rangé selon son sujet, drapeau levé pour ce tour.', M.mqtt),
        'void mqttRecu(char *sujet, byte *contenu, unsigned int taille) {',
        ...topics.flatMap((e, i) => [`  ${i ? 'else if' : 'if'} (${match(e)}) {`, `    mqttCopier(${e.buf}, sizeof(${e.buf}), contenu, taille);`, `    ${e.ev} = true;`,
          ...(e.num ? [`    ${e.num} = atof(${e.buf});`, `    ${e.numEv} = true;`] : []), '  }']), '}'].join('\n'));
    }
  }
  if (W) {
    lines.push(tl('// Page web : la demande d’un navigateur est lue au fil des tours, sans l’attendre (elle arrive parfois en plusieurs morceaux)'),
      `if (!${W.cli}) {`, `  ${W.cli} = ${W.srv}.accept();`, `  ${W.step} = 0;`, `  ${W.n} = 0;`, `  ${W.line}[0] = '\\0';`, `  ${W.t0} = ${now};`, '}',
      `if (${W.cli} && ${W.step} < 2) {`, `  while (${W.cli}.available() > 0) {`, `    const char car = (char)${W.cli}.read();`, "    if (car == '\\n') {",
      tl('      if ({0} == 0) {0} = 1; // fin de la première ligne', W.step), tl('      else if ({0} == 0) { // ligne vide : fin de la demande', W.n), `        ${W.step} = 2;`, '        break;', '      }', `      ${W.n} = 0;`,
      "    } else if (car != '\\r') {", `      if (${W.step} == 0 && ${W.n} < sizeof(${W.line}) - 1) {`, `        ${W.line}[${W.n}] = car;`, `        ${W.line}[${W.n} + 1] = '\\0';`, '      }', `      if (${W.n} < 255) ${W.n}++;`, '    }', '  }',
      `  if (${W.step} == 2) {`, `    pageCheminDe(${W.line}, ${W.path}, sizeof(${W.path}));`, tl('    if ({0}({1}, {2}) != 0) {3} = true; // l’icône que demandent les navigateurs ne compte pas', P, W.path, pstr(g, '/favicon.ico'), W.ev),
      tl('  } else if ({0} - {1} >= 2000UL) {', now, W.t0), tl('    {0}.stop(); // demande incomplète : abandonnée', W.cli), '  }', '}');
    g.tail.push(tl('// Page web : réponse à la demande, avec les valeurs de ce tour'), `if (${W.step} == 2) {`, '  pageEnvoyer();', `  ${W.cli}.stop();`, `  ${W.step} = 0;`, '}');
    g.helpers.push([tl('// Chemin d’une demande : « GET /on?x=1 HTTP/1.1 » donne « /on ».'), 'void pageCheminDe(const char *ligne, char *chemin, uint8_t n) {', '  uint8_t i = 0, k = 0;',
      "  while (ligne[i] != '\\0' && ligne[i] != ' ') i++; // la méthode (GET)", "  if (ligne[i] == ' ') i++;",
      "  while (ligne[i] != '\\0' && ligne[i] != ' ' && ligne[i] != '?' && k < n - 1) chemin[k++] = ligne[i++];", "  chemin[k] = '\\0';", '}'].join('\n'));
    // Lignes de la page : ce qu'affiche chaque ligne (code), son nombre ou son texte.
    const codes = [...s.codes.values()], nums = codes.some(c => c.x && c.x.sig.kind !== 'text'), txts = codes.some(c => c.x && c.x.sig.kind === 'text');
    if (codes.length) {
      g.glob.push(tl('uint8_t {0}[{1}] = {{2}}; // ce qu’affiche chaque ligne de la page (0 : rien)', W.q, PAGE_ROWS, 0));
      if (nums) g.glob.push(tl('float {0}[{1}]; // nombre de chaque ligne', W.num, PAGE_ROWS));
    }
    const out = (t, n = 1) => `${'  '.repeat(n)}${W.cli}.print(${g.flash(t)});`;
    if (txts) g.helpers.push([tl('// Écrit un texte reçu dans la page, sans qu’il puisse y ajouter du HTML.'), 'void pageEcrire(const char *t) {', "  for (uint8_t i = 0; t[i] != '\\0'; i++) {",
      `    if (t[i] == '<') ${W.cli}.print(${g.flash('&lt;')});`, `    else if (t[i] == '&') ${W.cli}.print(${g.flash('&amp;')});`, `    else ${W.cli}.write((uint8_t)t[i]);`, '  }', '}'].join('\n'));
    const title = html(g.board.name), rows = codes.flatMap(c => {
      const head = `    case ${c.code}:`;
      if (!c.x) return [head, out(`<p>${html(c.text)}</p>`, 3), '      break;'];
      const lab = `<p>${html(c.name)}${COLON}`, unit = c.x.label && c.x.label.unit ? ` ${html(c.x.label.unit.trim())}` : '', k = c.x.sig.kind;
      const val = k === 'text' ? [`      pageEcrire(${c.x.v});`] : k === 'bool' ? [`      if (${W.num}[r] != 0) ${W.cli}.print(${g.flash(tl('oui'))});`, `      else ${W.cli}.print(${g.flash(tl('non'))});`]
        : [`      ${W.cli}.print(${W.num}[r], ${c.x.sig.type === 'float' ? Math.max(1, Math.min(3, (c.x.label && c.x.label.d) || 1)) : 0});`];
      return [head, out(lab, 3), ...val, out(`${unit}</p>`, 3), '      break;'];
    });
    const linkHtml = [...new Set(links.map(cleanPath))].slice(0, 12).map(p => `<a href="${html(p)}">${html(p)}</a>`).join(' · ');
    g.helpers.push([tl('// Page web de la carte : en-tête HTTP, puis les lignes que les règles affichent, avec leurs valeurs de ce tour.'), 'void pageEnvoyer() {',
      `  if (${P}(${W.path}, ${pstr(g, '/favicon.ico')}) == 0) {`, out('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n', 2), '    return;', '  }',
      out('HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n'),
      out(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><h1>${title}</h1>`),
      ...(codes.length ? [`  for (uint8_t r = 0; r < ${PAGE_ROWS}; r++) {`, `    switch (${W.q}[r]) {`, ...rows, '    default:', '      break;', '    }', '  }'] : []),
      ...(linkHtml ? [out(`<p>${linkHtml}</p>`)] : []), out('</body></html>'), '}'].join('\n'));
  }
  g.events.push({ c: NET, ev: null, lines, period: 0 });
}
