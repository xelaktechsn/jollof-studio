// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles du réseau (rules-net.js) : phrases, réglages, code robuste, puis le programme généré qui tourne dans
// l'interpréteur sur le réseau simulé (src/net/lan.js) : publications vues par le serveur MQTT, message du serveur qui
// allume une LED, page web lue par le navigateur du PC, demande « /on » ; Uno + W5500 et ESP32 en Wi-Fi. Avec
// arduino-cli (bibliothèques Ethernet et PubSubClient), le même programme compilé tourne sur l'Uno émulé avec le
// modèle fidèle du W5500 et donne les mêmes résultats. node --test src/prog/rules-net.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bench, rule, act, set, variable, netRules as workshop, hasCli } from './rulekit.mjs';

const R = await import('./rules.js');
const { NET, netText, fixNet, autoMac, netLink } = await import('./rules-net.js');
const { compile } = await import('./lang.js');
const { createRuntime } = await import('./runtime.js');
const { BOARDS, kindOf } = await import('../sim/boards.js');
const { createLan } = await import('../net/lan.js');
const { newDevice } = await import('../net/devices.js');
const { makeCable } = await import('../net/cable.js');
const { macOf } = await import('../sim/models.js');

const tick = () => new Promise(r => setImmediate(r));

test('phrases : publier, message reçu, nombre reçu, page web, connexion, réglages', () => {
  const M = bench('uno', ['w5500', 'pot', 'led-red']), rules = workshop(M), all = rules.map(r => R.migrate(JSON.parse(JSON.stringify(r))));
  const byAny = id => M.comps.find(c => c.id === id) || all.find(r => r.id === id) || null, txt = r => R.ruleText(r, byAny, null);
  assert.equal(txt(all[1]), 'Toutes les 2 s : publie POT1 · position sur le sujet « atelier/pot ».');
  assert.equal(txt(all[2]), 'Toujours : publie compte sur le sujet « atelier/compte », la page web affiche POT1 · position.');
  assert.equal(txt(all[3]), 'Quand le message du sujet « atelier/led » vaut « ON » : LED1 s’allume, la page web affiche « LED allumée », ajoute 1 à compte.');
  assert.equal(txt(all[5]), 'Quand un nombre arrive sur le sujet « atelier/seuil » : Moniteur série écrit la valeur de le nombre reçu sur le sujet « atelier/seuil ».');
  assert.equal(txt(all[6]), 'Quand la page web reçoit « /on » : LED1 s’allume.', 'chemin complété par « / »');
  assert.equal(txt(all[7]), 'Quand la carte est connectée au serveur MQTT : publie « bonjour » sur le sujet « atelier/etat ».');
  assert.equal(R.condText(R.migrate(rule({ comp: NET, sig: 'msg', topic: 'maison/#' }, [], [], { op: 'any' })), byAny, null), 'Quand un message arrive sur le sujet « maison/# »');
  assert.equal(R.condText(R.migrate(rule({ comp: NET, sig: 'online' }, [], [], { op: '==', v: 0 })), byAny, null), 'Quand la carte n’est pas connectée au réseau');
  assert.equal(R.condText(R.migrate(rule({ comp: NET, sig: 'page' }, [], [], { op: 'any' })), byAny, null), 'Quand la page web reçoit une demande');
  // Sujet publié : sans joker ni espace ; réglages remis en ordre.
  assert.equal(R.migrate(rule(null, [act(NET, 'publish', 'x', { topic: ' maison/+/temp ' })])).then[0].topic, 'maison//temp');
  const n = R.migrate({ kind: 'net', ip: '300.1.1.1', mac: 'de-ad-be-ef-00-01', port: 99999, broker: ' mq ', ssid: 'Atelier' });
  assert.deepEqual([n.kind, n.dhcp, n.ip, n.mac, n.port, n.broker], ['net', true, '192.168.1.177', 'DE:AD:BE:EF:00:01', 65535, 'mq']);
  assert.equal(netText(n), 'Réseau : Ethernet par DHCP, Wi-Fi « Atelier », serveur MQTT mq:65535.');
  assert.equal(R.ruleText(fixNet({ kind: 'net', dhcp: false, ip: '192.168.1.60' }), byAny, null), 'Réseau : Ethernet à l’adresse 192.168.1.60, Wi-Fi « Atelier », serveur MQTT 192.168.1.10:1883.');
  assert.match(autoMac(M.board), /^02:4A(:[0-9A-F]{2}){4}$/);
  // Comment la carte rejoint le réseau : module relié, Wi-Fi, ou rien.
  const cx = M.cx();
  assert.equal(netLink(M.board, M.comps, cx.inspect).via, 'eth');
  const E = bench('esp32', ['led-red']); assert.equal(netLink(E.board, E.comps, E.cx().inspect).via, 'wifi');
  const U = bench('uno', ['led-red']); assert.equal(netLink(U.board, U.comps, U.cx().inspect), null);
});

test('code : robuste (ni String ni delay), sujets et textes en flash sur AVR, publication à la modification, jokers', () => {
  const M = bench('uno', ['w5500', 'pot', 'led-red']), code = M.code(workshop(M));
  assert.ok(!/\bString\b/.test(code)); assert.ok(!/\bunsigned long\b/.test(code));
  const loop = code.slice(code.indexOf('void loop() {'));
  assert.deepEqual((loop.match(/\bdelay\(\d+\)/g) || []), []);
  assert.match(code, /Ethernet\.init\(ETH1_CS\);/);
  assert.match(code, /mqttPublier\(PSTR\("atelier\/pot"\), texte\);/, 'minuterie : publiée à chaque fois');
  assert.match(code, /if \(\(!pub1_fait \|\| v != pub1_valeur\) && maintenant - pub1_t >= 1000UL\)/, 'règle permanente : quand la valeur change, une fois par seconde au plus');
  assert.match(code, /mqttPublierP\(PSTR\("atelier\/etat"\), PSTR\("bonjour"\)\);/);
  assert.match(code, /if \(mqttEnLigne\) mqttEnLigne = mqtt\.loop\(\);/, 'mqtt.loop() à chaque tour');
  assert.match(code, /maintenant - mqttEssai >= 5000UL/, 'reconnexion espacée de 5 s');
  assert.match(code, /mqtt_atelier_seuil_nombre = atof\(mqtt_atelier_seuil\);/);
  assert.match(code, /strcmp_P\(pageChemin, PSTR\("\/on"\)\) == 0/);
  assert.match(code, /<a href=\\"\/on\\">\/on<\/a>/, 'lien vers « /on » sur la page');
  // Les deux textes fixes partagent la ligne « message » de la page ; la valeur a la sienne.
  assert.match(code, /pageQuoi\[1\] = 2;[\s\S]*pageQuoi\[1\] = 3;/);
  // Mesure à virgule : jamais publiée si NaN ; joker « + » : comparaison du sujet par sujetVa.
  const D = bench('esp32', ['dht22']), DHT = D.comps.find(c => c.type === 'dht22');
  const c2 = D.code([rule(null, [act(NET, 'publish', null, { topic: 'serre/temp', what: { comp: DHT.id, sig: 'temp' } })]), rule({ comp: NET, sig: 'msg', topic: 'serre/+/cmd' }, [act('@serial', 'print', 'ok')], [], { op: 'any' })]);
  assert.match(c2, /if \(!isnan\(v\) && \(!pub1_fait \|\| v != pub1_valeur\)/);
  assert.match(c2, /dtostrf\(v, 0, 1, texte\);/);
  assert.match(c2, /if \(sujetVa\("serre\/\+\/cmd", sujet\)\)/);
  assert.match(c2, /WiFi\.begin\(RESEAU_WIFI, RESEAU_CLE\);/);
  assert.match(c2, /mqtt\.publish\("serre\/temp", texte\)/);
  // Réglages : adresse fixe, autre serveur ; carte sans réseau : les règles du réseau sont ignorées.
  const c3 = M.code([{ kind: 'net', id: 'n1', dhcp: false, ip: '192.168.1.60', broker: 'mq', port: 1884, mac: 'DE:AD:BE:EF:00:01' }, rule({ every: 1000 }, [act(NET, 'publish', 'x')])]);
  assert.match(c3, /IPAddress reseauIp\(192, 168, 1, 60\);/); assert.match(c3, /Ethernet\.begin\(reseauMac, reseauIp\);/);
  assert.match(c3, /uint8_t reseauMac\[6\] = \{0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01\};/); assert.match(c3, /MQTT_SERVEUR\[\] = "mq";/); assert.match(c3, /MQTT_PORT = 1884;/);
  const U = bench('uno', ['led-red']), c4 = U.code([rule({ every: 1000 }, [act(NET, 'publish', 'x')])]);
  assert.match(c4, /n’a ni module Ethernet relié \(W5500, ENC28J60\) ni Wi-Fi/); assert.ok(!/PubSubClient/.test(c4));
});

/* ---------- Dans l'interpréteur, sur le réseau simulé ---------- */
/**
 * Réseau de l'atelier : box (DHCP), switch, PC, serveur MQTT « MQ » (192.168.1.10), point d'accès « Atelier ».
 * nodes : nœuds du montage, { comp, type: 'w5500' | 'wifi' } ; un module Ethernet est câblé au switch.
 */
function plan(nodes) {
  const used = new Set(), data = { devices: [], cables: [] };
  for (const [id, type, p] of [['box', 'router'], ['sw', 'switch'], ['pc', 'pc'], ['mq', 'broker'], ['ap', 'ap', { power: 'adapter' }]]) {
    const d = newDevice(type, used); used.add(d.name); d.id = id; d.name = id.toUpperCase(); if (p) Object.assign(d.p, p); data.devices.push(d);
  }
  const links = [[['box', 'lan1'], ['sw', 'p1']], [['pc', 'eth0'], ['sw', 'p2']], [['mq', 'eth0'], ['sw', 'p3']], [['ap', 'eth0'], ['sw', 'p5']]];
  nodes.filter(n => n.type !== 'wifi').forEach((n, i) => links.push([['e:' + n.comp.id, 'eth'], ['sw', 'p' + (6 + i)]]));
  links.forEach(([a, b], i) => data.cables.push({ id: 'c' + i, a, b, cat: 'cat6', len: 3, wire: makeCable('straight') }));
  const eth = c => (c.periph && c.periph.eth) || null;
  const wifi = c => { const w = c.periph && c.periph.wifi; return w && w.lan && w.status === 3 && w.ip ? { ip: w.ip, prefix: w.prefix ?? 24, gw: w.gw, dhcp: !w.fixed } : null; };
  const ext = () => nodes.map(n => (n.type === 'wifi'
    ? { id: 'e:' + n.comp.id, type: 'wifi', name: n.comp.name, x: 0, y: 0, mac: () => macOf(n.comp), ipcfg: () => wifi(n.comp) }
    : { id: 'e:' + n.comp.id, type: n.type, name: n.comp.name, x: 0, y: 0, mac: () => (eth(n.comp) ? eth(n.comp).mac : ''), ipcfg: () => eth(n.comp) }));
  return createLan({ data: () => data, ext, sig: () => JSON.stringify(nodes.map(n => (n.type === 'wifi' ? wifi(n.comp) : eth(n.comp)))) });
}
/** Lance le programme généré dans l'interpréteur ; la carte voit ses modules Ethernet et le réseau. */
function run(M, code, lan) {
  const kind = kindOf(M.board), c = compile(code, { board: kind });
  assert.ok(c.ok, JSON.stringify(c.errors && c.errors.slice(0, 3)));
  const store = { ee: '', prefs: {} }, mods = M.comps.filter(x => x.type === 'w5500' || x.type === 'enc28j60');
  const hw = { kind, label: kind, prof: BOARDS[kind], read: k => (/^(A0|D3[2-9]|GP2[6-8]|D\d+)$/.test(k) ? { v: 2.5 } : null), echo: () => null, at: () => [], onPin: () => null, data: () => null,
    bus: () => [], i2c: () => [], status: () => ({ ok: true, msg: '' }), mem: () => store, memChanged: () => {}, level: () => null,
    comps: types => mods.filter(x => types.includes(x.type)), peers: () => [], self: () => M.board, lan: () => lan };
  const rt = createRuntime(c.js, hw, { globals: c.globals });
  rt.out = '';
  rt.step = (n = 1) => { for (let i = 0; i < n; i++) { rt.run(16); rt.out += rt.takeSerial(); } assert.notEqual(rt.state, 'error', rt.error && rt.error.msg); return rt; };
  rt.until = async (p, max = 300) => { let done = false, v; p.then(x => { done = true; v = x; }); for (let i = 0; i < max && !done; i++) { rt.step(1); await tick(); } assert.ok(done, 'pas de réponse'); return v; };
  rt.pin = name => { const m = new RegExp(`constexpr uint8_t ${name} = (\\d+);`).exec(code); const p = m && [...rt.pins.entries()].find(([k]) => k.replace(/^\D+/, '') === m[1]); return p ? p[1].d : null; };
  return rt;
}
/** Le scénario de l'atelier, le même pour chaque carte : rt (interpréteur ou carte émulée) et ses outils. */
async function scenario(t) {
  await t.wait(s => /MQTT : connecté/.test(s), 'connexion au serveur MQTT');
  const br = t.lan.broker('mq'), topic = k => { const x = br.topics().find(e => e.topic === k); return x ? x.text : null; };
  const ip = /Réseau : (?:Wi-Fi connecté, )?adresse (\d+\.\d+\.\d+\.\d+)/.exec(t.out())[1];
  assert.match(ip, /^192\.168\.1\.1\d\d$/);
  await t.wait(() => topic('atelier/pot') != null && topic('atelier/etat') != null, 'publications');
  assert.equal(topic('atelier/etat'), 'bonjour');
  assert.equal(topic('atelier/compte'), '0');
  assert.ok(+topic('atelier/pot') > 0, topic('atelier/pot'));
  assert.equal(t.led(), 0);
  // Le serveur publie sur le sujet suivi : la LED s'allume, le compte augmente (publié quand il change).
  br.publish('atelier/led', 'ON');
  await t.wait(() => t.led() === 1 && topic('atelier/compte') === '1', 'message ON');
  br.publish('atelier/seuil', '21.5');
  await t.wait(s => /nombre reçu sur le sujet « atelier\/seuil » : 21\.50/.test(s), 'nombre reçu');
  // La page web, lue par le navigateur du PC.
  let page = await t.http(`http://${ip}/`);
  assert.equal(page.code, 200, JSON.stringify(page));
  assert.match(page.body, /<h1>\w+1<\/h1><p>POT1 · position : \d+<\/p><p>LED allumée<\/p><p><a href="\/on">\/on<\/a><\/p><\/body><\/html>$/);
  br.publish('atelier/led', 'OFF');
  await t.wait(() => t.led() === 0, 'message OFF');
  page = await t.http(`http://${ip}/`);
  assert.match(page.body, /<p>LED éteinte<\/p>/);
  assert.equal((await t.http(`http://${ip}/favicon.ico`)).code, 404);
  // « Quand la page web reçoit /on » : la LED s'allume.
  page = await t.http(`http://${ip}/on`);
  assert.equal(page.code, 200);
  await t.wait(() => t.led() === 1, 'demande /on');
}

for (const [kind, types] of [['uno', ['w5500', 'pot', 'led-red']], ['esp32', ['pot', 'led-red']], ['pico', ['w5500', 'pot', 'led-red']]]) {
  test(`interpréteur, ${kind}${types.includes('w5500') ? ' + W5500' : ' en Wi-Fi'} : le serveur MQTT reçoit les publications, un message allume la LED, le PC lit la page`, async () => {
    const M = bench(kind, types), code = M.code(workshop(M));
    const nodes = types.includes('w5500') ? [{ comp: M.c('ETH1'), type: 'w5500' }] : [{ comp: M.board, type: 'wifi' }];
    const lan = plan(nodes), rt = run(M, code, lan);
    const wait = async (ok, what, max = 600) => { for (let i = 0; i < max && !ok(rt.out); i++) { rt.step(1); await tick(); } assert.ok(ok(rt.out), `${what} : ${rt.out.slice(-400)}`); };
    await scenario({ lan, out: () => rt.out, wait, led: () => rt.pin('LED1'), http: url => rt.until(lan.http('pc', url)) });
    rt.stop();
  });
}

test('interpréteur, Uno + W5500 : sujet à joker, texte reçu gardé dans une variable, publié quand il change, écrit sans HTML sur la page', async () => {
  const M = bench('uno', ['w5500', 'led-red']), t = variable('mode', 'text', 'ok', { len: 12 });
  const msg = { comp: NET, sig: 'msg', topic: 'atelier/+/mode' };
  const code = M.code([t, { kind: 'net', id: 'n1', broker: 'mq' },
    rule(msg, [set(t, '=', null, { src: msg })], [], { op: 'any' }),
    rule(null, [act(NET, 'publish', null, { topic: 'atelier/mode', what: { var: t.id } }), act(NET, 'page', null, { what: { var: t.id }, line: 2 })])]);
  assert.match(code, /sujetVaP\(PSTR\("atelier\/\+\/mode"\), sujet\)/); assert.match(code, /MQTT_SERVEUR\[\] = "mq";/);
  const lan = plan([{ comp: M.c('ETH1'), type: 'w5500' }]), rt = run(M, code, lan), br = () => lan.broker('mq');
  const topic = k => { const x = br() && br().topics().find(e => e.topic === k); return x ? x.text : null; };
  const wait = async (ok, what) => { for (let i = 0; i < 600 && !ok(); i++) { rt.step(1); await tick(); } assert.ok(ok(), `${what} : ${rt.out.slice(-300)}`); };
  await wait(() => topic('atelier/mode') === 'ok', 'première publication (nom du serveur résolu par la box)');
  br().publish('atelier/salon/mode', '<auto>');
  await wait(() => topic('atelier/mode') === '<auto>', 'texte reçu, publié de nouveau');
  br().publish('atelier/salon/autre', 'x'); rt.step(5);
  assert.equal(topic('atelier/mode'), '<auto>', 'un autre sujet ne correspond pas au filtre');
  const ip = /Réseau : adresse (\S+)/.exec(rt.out)[1], page = await rt.until(lan.http('pc', `http://${ip}/`));
  assert.match(String(page.body), /<p>mode : &lt;auto><\/p>/, JSON.stringify(page));
  rt.stop();
});

/* ---------- Le même programme compilé, sur l'Uno émulé avec le W5500 fidèle ---------- */
const libs = hasCli ? spawnSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).stdout || '' : '';
const skipFw = !hasCli ? 'arduino-cli absent' : !/^Ethernet\s/m.test(libs) || !/^PubSubClient\s/m.test(libs) ? 'bibliothèques Ethernet et PubSubClient absentes' : false;
test('parité : le programme compilé sur l’Uno émulé (W5500 fidèle) fait comme l’interpréteur', { skip: skipFw, timeout: 300000 }, async () => {
  const { compileSketch, fakeBoard, boot, runFor } = await import('../emu/testkit.mjs');
  const M = bench('uno', ['w5500', 'pot', 'led-red']), code = M.code(workshop(M));
  const pin = name => 'D' + new RegExp(`constexpr uint8_t ${name} = (\\d+);`).exec(code)[1];
  const cs = pin('ETH1_CS'), led = pin('LED1');
  const { hw, comps } = fakeBoard({ kind: 'uno', modules: [{ type: 'w5500', id: 'eth-fw', pins: { CS: cs, SCK: 'D13', MOSI: 'D11', MISO: 'D12' } }], inputs: { A0: { v: 2.5 } } });
  const lan = plan([{ comp: comps[0], type: 'w5500' }]);
  hw.lan = () => lan;
  const rt = boot(compileSketch(code, 'arduino:avr:uno'), hw);
  let out = '';
  const take = () => { out += Buffer.from(rt.takeSerial(), 'latin1').toString('utf8'); return out; };
  const wait = async (ok, what, ms = 20000) => { const end = rt.clock() + ms; while (rt.clock() < end && !ok(take())) { runFor(rt, 20); await tick(); } assert.ok(ok(out), `${what} : ${out.slice(-400)}`); };
  const http = async url => { let r = null; lan.http('pc', url).then(x => { r = x; }); await wait(() => r != null, url, 5000); return r; };
  const level = () => { const p = rt.pins.get(led); return p ? p.d : null; };
  await scenario({ lan, out: take, wait, led: level, http });
});
