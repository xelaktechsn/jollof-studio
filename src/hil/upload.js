// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Téléversement sur une vraie carte (application installée). Le programme de l'onglet Code est compilé
// et envoyé par USB avec arduino-cli, l'outil officiel d'Arduino, installé sur l'ordinateur.
// « Préparer » installe le support de la carte et les bibliothèques que le programme inclut.
import './upload.css';
import { tl, locale } from '../i18n/index.js';
import { listPorts, claim, unclaim } from './serial.js';
import { baudOf } from './monitor.js';

const FQBN = { uno: 'arduino:avr:uno', nano: 'arduino:avr:nano', nanoOld: 'arduino:avr:nano:cpu=atmega328old', mega: 'arduino:avr:mega', esp32: 'esp32:esp32:esp32doit-devkit-v1', 'esp32-38': 'esp32:esp32:nodemcu-32s', esp32s3: 'esp32:esp32:esp32s3', esp32c3: 'esp32:esp32:nologo_esp32c3_super_mini', nodemcu: 'esp8266:esp8266:nodemcuv2', d1mini: 'esp8266:esp8266:d1_mini', pico: 'rp2040:rp2040:rpipico' };
/** Modèle à proposer : celui de la carte elle-même (Wemos D1 mini), sinon celui de sa famille de code. */
const modelOf = cur => (cur.board && FQBN[cur.board.type] ? cur.board.type : cur.kind);
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } } };
/** Cartes dont le support et les bibliothèques ont déjà été installés (« Préparer » n'est plus à faire à la main). */
const prepared = () => { try { return new Set(JSON.parse(store.get('jollof-prepared') || '[]')); } catch (e) { return new Set(); } };
/** Message d'un outil de téléversement → ce qui se passe et quoi faire. */
function uploadHint(txt, fqbn) {
  if (/not in sync|stk500_recv|programmer is not responding|stk500_getsync/i.test(txt)) return /nano/.test(fqbn) && !/atmega328old/.test(fqbn)
    ? tl('La carte ne répond pas. Beaucoup de Nano compatibles ont l’ancien chargeur : choisissez « Arduino Nano (ancien bootloader) » et réessayez.')
    : tl('La carte ne répond pas : vérifiez le modèle de carte choisi et le port, puis réessayez.');
  if (/Wrong boot mode|Failed to connect to ESP|Timed out waiting for packet header|No serial data received/i.test(txt)) return tl('L’ESP ne passe pas en mode téléversement : maintenez son bouton BOOT enfoncé au début du téléversement, relâchez-le quand « Writing » apparaît.');
  if (/busy|Access is denied|Permission denied|could not open port|can't open device/i.test(txt)) return tl('Le port est utilisé par un autre logiciel (IDE Arduino, autre moniteur série…) : fermez-le, puis réessayez.');
  if (/No such file or directory.*\.h|fatal error: .*\.h/i.test(txt)) return tl('Une bibliothèque manque : « Préparer » l’installe.');
  return '';
}
const CORE_URL = {
  esp32: 'https://espressif.github.io/arduino-esp32/package_esp32_index.json',
  esp8266: 'https://arduino.esp8266.com/stable/package_esp8266com_index.json',
  rp2040: 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json'
};
const LIBS = {
  'DHT.h': ['DHT sensor library', 'Adafruit Unified Sensor'], 'OneWire.h': ['OneWire'], 'DallasTemperature.h': ['DallasTemperature'],
  'Adafruit_BMP280.h': ['Adafruit BMP280 Library'], 'Adafruit_BME280.h': ['Adafruit BME280 Library'], 'BH1750.h': ['BH1750'], 'HX711.h': ['HX711 Arduino Library'], 'Adafruit_MPU6050.h': ['Adafruit MPU6050'], 'LiquidCrystal_I2C.h': ['LiquidCrystal I2C'],
  'Adafruit_SSD1306.h': ['Adafruit SSD1306', 'Adafruit GFX Library'], 'Adafruit_GFX.h': ['Adafruit GFX Library'], 'Servo.h': ['Servo'], 'ESP32Servo.h': ['ESP32Servo'],
  'Adafruit_NeoPixel.h': ['Adafruit NeoPixel'], 'Stepper.h': ['Stepper']
};

export function installUpload(app) {
  const { $, esc, icon, native } = app;
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'boardModal'; modal.hidden = true;
  modal.innerHTML = `<div class="sheet boardSheet" role="dialog" aria-modal="true" aria-labelledby="boardTitle">
    <div class="sheetHead"><h2 id="boardTitle">${tl('{0}Téléverser sur la carte réelle', icon('upload'))}</h2><button type="button" class="btn" data-b="close">${tl('Fermer')}</button></div>
    <p class="note" data-b="intro"></p>
    <div class="grid2">
      <label class="field">${tl('Modèle de carte')}<select class="sel" data-b="fqbn"></select></label>
      <label class="field">${tl('Port USB')}<span class="portRow"><select class="sel" data-b="port"><option value="">${tl('— rechercher —')}</option></select><button type="button" class="btn icon" data-b="ports" aria-label="${tl('Rechercher les cartes branchées')}">${icon('rotate')}</button></span></label>
    </div>
    <div class="row">
      <button type="button" class="btn" data-b="prepare">${icon('wand')}<span>${tl('Préparer (support et bibliothèques)')}</span></button>
      <button type="button" class="btn" data-b="compile">${icon('check')}<span>${tl('Compiler')}</span></button>
      <button type="button" class="btn primary" data-b="upload">${icon('upload')}<span>${tl('Téléverser')}</span></button>
    </div>
    <pre class="boardLog" data-b="log" aria-live="polite"></pre>
  </div>`;
  document.body.appendChild(modal);
  const q = k => modal.querySelector(`[data-b="${k}"]`);
  let busy = false, cur = null, lastOut = '';
  const log = (s, cls) => { const el = q('log'); const line = document.createElement('div'); if (cls) line.className = cls; line.textContent = s; el.appendChild(line); el.scrollTop = el.scrollHeight; };
  const setBusy = on => { busy = on; ['prepare', 'compile', 'upload', 'ports'].forEach(k => (q(k).disabled = on)); };
  async function cli(args, label) {
    log(`$ arduino-cli ${args.join(' ')}`, 'cmd');
    try {
      const r = await native.arduinoCli(args);
      const txt = (r.stdout + (r.stderr ? '\n' + r.stderr : '')).trim(); lastOut = txt;
      if (txt) log(txt.length > 6000 ? '…' + txt.slice(-6000) : txt, r.code ? 'err' : '');
      if (r.code) { log(tl('✕ {0} : échec (code {1}).', label, r.code), 'err'); return null; }
      return r;
    } catch (e) {
      const m = String(e && e.message || e).replace(/^arduino-cli n’a pas pu démarrer :/, tl('arduino-cli n’a pas pu démarrer :'));
      log(m === 'desktop-only' ? tl('✕ Le téléversement sur une vraie carte n’est possible que dans l’application installée.') : /introuvable/.test(m)
        ? tl('✕ arduino-cli est introuvable. Installez-le (https://arduino.github.io/arduino-cli/latest/installation/), puis relancez Jollof Studio.') : '✕ ' + m, 'err');
      return null;
    }
  }
  const coreOf = fqbn => fqbn.split(':').slice(0, 2).join(':');
  const urlArgs = fqbn => { const u = CORE_URL[fqbn.split(':')[0]]; return u ? ['--additional-urls', u] : []; };
  // Ports listés par l'application elle-même (quelques millisecondes), pas par `arduino-cli board list` : ses outils
  // de découverte n'ont qu'une seconde pour répondre, et certains Mac en demandent cinq (liste vide, carte branchée).
  // Le téléversement n'en dépend pas : `upload -p` passe le port tel quel à l'outil de la carte.
  async function findPorts() {
    let list;
    try { list = await listPorts(); } catch (e) { log('✕ ' + (e && e.message || e), 'err'); return; }
    ports = list;
    const sel = q('port'), prev = sel.value, usb = list.filter(p => p.usb).length;
    sel.innerHTML = list.length ? list.map(p => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join('') : `<option value="">${tl('Aucune carte détectée')}</option>`;
    const real = app.realBoard && app.realBoard.state().port, remembered = store.get('jollof-real-port'), usbFirst = (list.find(p => p.usb) || {}).name;
    const pick = [prev, real, remembered, usbFirst].find(n => n && list.some(p => p.name === n));
    if (pick) sel.value = pick;
    checkMatch();
    log(usb ? tl('✓ {0} port{1} trouvé{2}.', usb, usb > 1 ? 's' : '', usb > 1 ? 's' : '') : tl('Aucune carte branchée n’a été trouvée : vérifiez le câble USB (certains ne transportent que le courant).'), usb ? 'ok' : 'err');
  }
  /** Le port choisi semble être une autre carte que le modèle choisi (identifiant USB) : on le dit. */
  let ports = [];
  function checkMatch() {
    const p = ports.find(x => x.name === q('port').value), kind = Object.keys(FQBN).find(k => FQBN[k] === q('fqbn').value);
    if (p && p.board && p.board.kind && kind && !kind.startsWith(p.board.kind) && !p.board.kind.startsWith(kind.replace('Old', ''))) log(tl('⚠ Ce port semble être une carte « {0} », pas le modèle choisi : vérifiez le modèle de carte.', p.board.name), 'err');
  }
  async function prepare() {
    const fqbn = q('fqbn').value, core = coreOf(fqbn);
    if (!await cli(['core', 'update-index', ...urlArgs(fqbn)], tl('Mise à jour de l’index'))) return false;
    if (!await cli(['core', 'install', core, ...urlArgs(fqbn)], tl('Installation de {0}', core))) return false;
    const incs = [...new Set([...cur.code.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)].map(m => m[1]))];
    const libs = [...new Set(incs.flatMap(i => LIBS[i] || []))].filter(l => !(l === 'Servo' && /^esp32/.test(fqbn)));
    if (libs.length && !await cli(['lib', 'install', ...libs], tl('Installation des bibliothèques'))) return false;
    log(tl('✓ Carte et bibliothèques prêtes.'), 'ok');
    const done = prepared(); done.add(fqbn); store.set('jollof-prepared', JSON.stringify([...done]));
    return true;
  }
  async function compile(retry = true) {
    const fqbn = q('fqbn').value;
    if (!prepared().has(fqbn)) { // première fois avec cette carte : son support et les bibliothèques, une seule fois
      log(tl('Première utilisation de ce modèle de carte : installation de son support et des bibliothèques (une seule fois, connexion Internet nécessaire)…'), 'ok');
      if (!await prepare()) return null;
    }
    const dir = await native.writeSketch(cur.code).catch(e => { log('✕ ' + (e.message || e), 'err'); return null; });
    if (!dir) return null;
    const r = await cli(['compile', '--fqbn', fqbn, dir], tl('Compilation'));
    if (!r && retry && /\.h: No such file|fatal error: .*\.h|platform not installed|Platform .* not found/i.test(lastOut)) {
      log(tl('Il manque quelque chose : installation, puis nouvelle compilation…'), 'ok');
      if (await prepare()) return compile(false);
    }
    if (r) log(tl('✓ Compilation réussie.'), 'ok');
    return r ? dir : null;
  }
  modal.addEventListener('click', async e => {
    if (e.target === modal) { if (!busy) modal.hidden = true; return; }
    const b = e.target.closest('[data-b]'); if (!b || busy) return;
    const k = b.dataset.b;
    if (k === 'close') { modal.hidden = true; return; }
    if (!['ports', 'prepare', 'compile', 'upload'].includes(k)) return;
    setBusy(true);
    try {
      // Comme rustc : rien ne part vers une vraie carte tant que le vérificateur trouve une erreur.
      if ((k === 'compile' || k === 'upload') && app.verify) {
        const r = await app.verify(false);
        if (r && r.errors) {
          log(tl('✕ Refusé : le montage ou le programme ne passe pas la vérification ({0} erreur(s)). Corrigez-les : le rapport s’ouvre.', r.errors), 'err');
          modal.hidden = true; app.openCheck(); return;
        }
        if (r) log(r.proven ? tl('✓ Vérifié : aucune faute dans les {0} états atteignables.', Number(r.states).toLocaleString(locale())) : tl('✓ Vérifié sur {0} états (vérification partielle).', Number(r.states).toLocaleString(locale())), 'ok');
      }
      if (k === 'ports') await findPorts();
      if (k === 'prepare') await prepare();
      if (k === 'compile') { const ok = await compile(); if (!ok) { const hint = uploadHint(lastOut, q('fqbn').value); if (hint) log('→ ' + hint, 'err'); } }
      if (k === 'upload') {
        const port = q('port').value;
        if (!port) { log(tl('Choisissez d’abord le port USB de la carte (bouton de recherche).'), 'err'); return; }
        store.set('jollof-real-port', port); store.set(`jollof-up-fqbn-${modelOf(cur)}`, q('fqbn').value);
        const dir = await compile(); if (!dir) return;
        // Le port ne sert qu'à un logiciel à la fois : moniteur série et carte réelle Firmata le libèrent.
        const wasOn = !!(app.realBoard && app.realBoard.state().state === 'on');
        await claim(port, 'upload', () => {});
        let r;
        try { r = await cli(['upload', '-p', port, '--fqbn', q('fqbn').value, dir], tl('Téléversement')); } finally { unclaim(port, 'upload'); }
        if (r) {
          log(tl('✓ Programme téléversé : la carte l’exécute.'), 'ok'); app.status(tl('Programme téléversé sur la carte réelle ({0}).', port), 'ok');
          if (app.realBoard) { // la sortie de la carte, tout de suite : le moniteur série de la carte réelle s'ouvre
            log(tl('Le moniteur série de la carte réelle s’ouvre (onglet Code)…'), 'ok');
            setTimeout(() => { modal.hidden = true; app.realBoard.open({ port, baud: baudOf(cur.code) || undefined }); }, 900);
          }
        } else {
          const hint = uploadHint(lastOut, q('fqbn').value); if (hint) log('→ ' + hint, 'err');
          if (wasOn && app.realBoard) app.realBoard.open({ port });
        }
      }
    } finally { setBusy(false); }
  });
  function open() {
    cur = app.program();
    if (!cur) { app.status(tl('Ajoutez d’abord une carte au montage.'), 'warn'); return; }
    const opts = Object.entries({ uno: tl('Arduino Uno'), nano: tl('Arduino Nano'), nanoOld: tl('Arduino Nano (ancien bootloader, cartes compatibles)'), mega: tl('Arduino Mega 2560'), esp32: tl('ESP32 DevKit V1'), 'esp32-38': tl('ESP32 38 broches (DevKitC, NodeMCU-32S)'), esp32s3: 'ESP32-S3 DevKitC-1', esp32c3: 'ESP32-C3 SuperMini', nodemcu: tl('NodeMCU (ESP8266)'), d1mini: 'Wemos D1 mini (ESP8266)', pico: 'Raspberry Pi Pico' });
    const model = modelOf(cur);
    q('fqbn').innerHTML = opts.map(([k, l]) => `<option value="${FQBN[k]}"${k === model ? ' selected' : ''}>${l}</option>`).join('');
    const kept = store.get(`jollof-up-fqbn-${model}`); if (kept && [...q('fqbn').options].some(o => o.value === kept)) q('fqbn').value = kept;
    q('fqbn').onchange = checkMatch; q('port').onchange = checkMatch;
    q('intro').textContent = tl('Le programme de {0} (onglet Code) est compilé puis envoyé par USB avec arduino-cli. La première fois, « Préparer » installe le support de la carte et les bibliothèques (connexion Internet nécessaire).', cur.board.name);
    q('log').textContent = '';
    modal.hidden = false;
    if (app.isDesktop()) findPorts(); else log(tl('Le téléversement sur une vraie carte n’est possible que dans l’application installée.'), 'err');
  }
  app.codeBar(`<button type="button" class="btn small" id="boardUpload" data-tip="${tl('Compiler et envoyer le programme sur la carte branchée en USB (arduino-cli)')}">${icon('cpu')}<span>${tl('Carte réelle')}</span></button>`).onclick = open;
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden && !busy) { e.stopImmediatePropagation(); modal.hidden = true; } }, true);
}
