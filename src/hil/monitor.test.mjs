// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Moniteur série d'une carte réelle : node --test src/hil/monitor.test.mjs
// Une fausse carte (globalThis.__serialMock) remplace le port USB : texte reçu, envoi, débranchement, téléversement.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const i18n = await import('../i18n/index.js');
await i18n.loadLanguage();
const { baudOf, noise, explainError, createRealMonitor } = await import('./monitor.js');
const { claim, unclaim, ownerOf, usbBoard } = await import('./serial.js');

/** Fausse carte : la liste des ports, et chaque port ouvert garde ce qu'on lui écrit. */
function fakeBoard() {
  const dev = { plugged: true, opened: [], written: [], resets: 0, link: null };
  globalThis.__serialMock = {
    list: async () => (dev.plugged ? [{ name: '/dev/cu.usbserial-1', usb: true, label: 'cu.usbserial-1 · CP210x', board: null }] : []),
    open: async (name, baud) => {
      if (!dev.plugged) throw new Error('No such file or directory');
      let sink = () => {}, closed = () => {};
      const link = {
        name, baud, open: true,
        write: async bytes => { dev.written.push(new TextDecoder().decode(bytes)); },
        onData: fn => { sink = fn; }, onClose: fn => { closed = fn; },
        reset: async () => { dev.resets++; },
        close: async () => { link.open = false; },
        push: bytes => sink(bytes), drop: () => closed()
      };
      dev.opened.push(link); dev.link = link;
      return link;
    }
  };
  return dev;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const make = () => { const out = { text: '', states: [], status: [] }; const m = createRealMonitor({ onText: t => { out.text += t; }, onChange: s => out.states.push(s.state), status: (t, k) => out.status.push([t, k]) }); return { m, out }; };

test('débit lu dans le programme, texte illisible, erreurs expliquées', () => {
  assert.equal(baudOf('void setup() {\n  Serial.begin(115200);\n}'), 115200);
  assert.equal(baudOf('// Serial.begin(9600);\nvoid setup() { Serial.begin( 57600 ); }'), 57600, 'les commentaires ne comptent pas');
  assert.equal(baudOf('Serial.begin(12345);'), null, 'débit inhabituel');
  assert.equal(baudOf(''), null);
  assert.ok(noise('Température : 21,5 °C\r\n') < 0.05);
  assert.ok(noise('\u0000ÿ\u0081x\u0002\u0003��') > 0.5);
  assert.match(explainError(new Error('Device or resource busy')), /déjà ouvert|already open/);
  assert.match(explainError(new Error('Permission denied'), 'Linux x86_64'), /dialout/);
  assert.equal(explainError({ name: 'NotFoundError' }), null, 'fenêtre de choix fermée : rien à dire');
  assert.equal(usbBoard(0x2341, 0x0043).kind, 'uno');
  assert.match(usbBoard(0x10c4, 0xea60).name, /CP210x/);
  assert.equal(usbBoard(0x1234, 1), null);
});

test('connexion, texte UTF-8 coupé entre deux paquets, envoi avec la fin de ligne, redémarrage', async () => {
  const dev = fakeBoard(), { m, out } = make();
  assert.equal(await m.connect('/dev/cu.usbserial-1', 115200), true);
  assert.equal(m.state().state, 'on'); assert.equal(dev.link.baud, 115200);
  const bytes = new TextEncoder().encode('Température : 21 °C\r\n');
  dev.link.push(bytes.slice(0, 3)); dev.link.push(bytes.slice(3)); // « é » coupé en deux
  assert.equal(out.text, 'Température : 21 °C\r\n');
  assert.equal(m.state().noisy, false);
  await m.send('LED ON', '\r\n'); await m.send('x', '');
  assert.deepEqual(dev.written, ['LED ON\r\n', 'x']);
  await m.reset(); assert.equal(dev.resets, 1);
  await m.disconnect(); assert.equal(m.state().state, 'off'); assert.equal(dev.link.open, false);
  assert.equal(await m.send('perdu'), false, 'rien ne part une fois déconnecté');
});

test('mauvais débit : le texte illisible est repéré', async () => {
  const dev = fakeBoard(), { m } = make();
  await m.connect('/dev/cu.usbserial-1', 9600);
  dev.link.push(Uint8Array.from([0x00, 0xff, 0x81, 0x02, 0xfe, 0x03, 0x99, 0x10, 0x11, 0x12, 0xf0, 0x80, 0x05, 0x06, 0x07, 0x08, 0x0e, 0x0f, 0x1b, 0x1c, 0x1d, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e]));
  assert.equal(m.state().noisy, true);
  await m.disconnect();
});

test('carte débranchée puis rebranchée : reconnexion automatique', async () => {
  const dev = fakeBoard(), { m, out } = make();
  await m.connect('/dev/cu.usbserial-1', 9600);
  dev.plugged = false; dev.link.drop();
  assert.equal(m.state().state, 'lost'); assert.match(out.text, /débranchée|unplugged/);
  await wait(1200); assert.equal(m.state().state, 'lost', 'toujours débranchée');
  dev.plugged = true;
  await wait(2000);
  assert.equal(m.state().state, 'on', 'reconnectée'); assert.equal(dev.opened.length, 2);
  assert.match(out.text, /rebranchée|plugged back/);
  await m.disconnect();
});

test('téléversement : le port est libéré puis repris ; Firmata prend le port, le moniteur s’efface', async () => {
  const dev = fakeBoard(), { m, out } = make();
  await m.connect('/dev/cu.usbserial-1', 9600);
  const back = await m.release('/dev/cu.usbserial-1');
  assert.equal(m.state().state, 'off'); assert.equal(m.state().by, 'upload'); assert.equal(dev.link.open, false);
  back(10); await wait(60);
  assert.equal(m.state().state, 'on', 'repris après le téléversement'); assert.equal(ownerOf('/dev/cu.usbserial-1'), 'monitor');
  assert.equal(typeof (await m.release('/dev/cu.autre')), 'function', 'un autre port : rien à libérer');
  assert.equal(m.state().state, 'on');
  // Un autre utilisateur du port (la carte réelle Firmata) : le moniteur se déconnecte et le dit.
  let firmataReleased = false;
  await claim('/dev/cu.usbserial-1', 'firmata', () => { firmataReleased = true; });
  assert.equal(m.state().state, 'off'); assert.equal(m.state().by, 'firmata');
  assert.match(out.status.at(-1)[0], /Firmata/);
  await m.connect('/dev/cu.usbserial-1', 9600); // le moniteur reprend : Firmata est prévenue
  assert.equal(firmataReleased, true); assert.equal(ownerOf('/dev/cu.usbserial-1'), 'monitor');
  await m.disconnect(); assert.equal(ownerOf('/dev/cu.usbserial-1'), null);
  unclaim('/dev/cu.usbserial-1', 'firmata');
});
