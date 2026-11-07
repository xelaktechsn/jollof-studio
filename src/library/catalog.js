// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Bibliothèque de Jollof Studio : les composants les plus courants des montages
// ESP32, ESP8266, Arduino et Raspberry Pi Pico. Chaque entrée décrit son nom,
// sa catégorie, le préfixe de ses repères (R1, LED2...) et sa géométrie.
import * as THREE from 'three';
import { M, V3, PITCH, mat, block, cyl, dome, decal, text, board, header, leg, socket, moduleBoard, add, boxGeo, cad } from './kit.js';
import { ownMaterial } from '../cad/library.js';
import { tl } from '../i18n/index.js';
import { stdMat } from '../quality.js';

export const CATEGORIES = [tl('Cartes'), tl('Prototypage'), tl('Capteurs'), tl('Entrées'), tl('Affichage'), tl('Sorties'), tl('Moteurs'), tl('Passifs'), tl('Alimentation'), tl('Communication')];

const BLUE = '#1b4f8c', GREEN = '#22603a', BLACK = '#17191c', RED = '#9b2226', PURPLE = '#4b2d7a';

/* ---------- Cartes à deux rangées ---------- */
function dualRow(c, o) {
  const b = board(c, o.w, o.l, o.pcb);
  header(c, o.left, { board: b, axis: 'z', x: -o.rowX, start: o.z0, labels: 1 });
  header(c, o.right, { board: b, axis: 'z', x: o.rowX, start: o.z0, labels: -1 });
  b.finish(o.paint);
  return b.top;
}
function esp32(c) {
  const T = dualRow(c, { w: 28, l: 52, pcb: BLACK, rowX: 12.7, z0: -13.78,
    left: ['EN','VP','VN','D34','D35','D32','D33','D25','D26','D27','D14','D12','D13','GND','VIN'],
    right: ['D23','D22','TX0','RX0','D21','D19','D18','D5','TX2','RX2','D4','D2','D15','GND','3V3'],
    paint: (x, k) => { text(x, k, 'DEVKIT V1', 14, 29, 1.5); text(x, k, 'EN      BOOT', 14, 44.5, 1.05, { weight: 500 }); } });
  if (!cad(c, 'esp32-wroom-32', 0, T, -12.75)) espModule(c, T);
  if (!cad(c, 'usb-micro-b', 0, T, 24.4)) block(c, 8, 2.8, 5.6, 0, T, 24, M.silver);
  [-7.5, 7.5].forEach(xx => { block(c, 4, 1.4, 3, xx, T, 22.2, M.plastic); cyl(c, 0.9, 0.8, xx, T + 1.4, 22.2, 0x2a2a2a); });
  block(c, 1, 0.6, 0.6, 4, T, 17, 0xff2a2a, { e: 0x991111 });
}
/** Module ESP32-WROOM-32 dessiné (rendu simple). */
function espModule(c, T) {
  block(c, 18, 0.8, 25.5, 0, T, -12.75, '#1c2733');
  decal(c, 18, 7, 0, T + 0.82, -22, (x, k, cv) => {
    x.fillStyle = '#1c2733'; x.fillRect(0, 0, cv.width, cv.height);
    x.strokeStyle = '#c9a35a'; x.lineWidth = 0.55 * k; x.beginPath(); x.moveTo(2 * k, 5.5 * k);
    for (let i = 0; i < 7; i++) { const xx = (3 + i * 2) * k; x.lineTo(xx, 1.5 * k); x.lineTo(xx + k, 1.5 * k); x.lineTo(xx + k, 5.5 * k); x.lineTo(xx + 2 * k, 5.5 * k); }
    x.stroke();
  }, 14);
  shield(c, 16, 17.5, 0, T + 0.8, -9.5, ['ESP32-WROOM-32', 'Wi-Fi + Bluetooth', '240 MHz  4 MB']);
}
function shield(c, w, l, x, y, z, lines) {
  block(c, w, 2.4, l, x, y, z, M.silver);
  decal(c, w, l, x, y + 2.42, z, (g, k, cv) => {
    const gr = g.createLinearGradient(0, 0, cv.width, cv.height); gr.addColorStop(0, '#c9cdd1'); gr.addColorStop(1, '#a3a8ad');
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
    lines.forEach((t, i) => text(g, k, t, w / 2, l * 0.34 + i * 2.4, i ? 1.05 : 1.45, { color: '#3a3e42', weight: i ? 500 : 600 }));
  }, 14, { m: 0.5, r: 0.4 });
}
function nodemcu(c) {
  const T = dualRow(c, { w: 31, l: 58, pcb: BLACK, rowX: 13.97, z0: -14.78,
    left: ['A0','RSV','RSV','SD3','SD2','SD1','CMD','SD0','CLK','GND','3V3','EN','RST','GND','VIN'],
    right: ['D0','D1','D2','D3','D4','3V3','GND','D5','D6','D7','D8','RX','TX','GND','3V3'],
    paint: (x, k) => text(x, k, 'NodeMCU V3', 15.5, 33, 1.5) });
  if (!cad(c, 'esp-12e', 0, T, -15)) { block(c, 16, 0.8, 24, 0, T, -15, '#1c2733'); shield(c, 12, 15, 0, T + 0.8, -12, ['ESP8266', 'ESP-12E', '80 MHz']); }
  if (!cad(c, 'usb-micro-b', 0, T, 27.4)) block(c, 8, 2.8, 5.6, 0, T, 27, M.silver);
  block(c, 5, 1.2, 5, 0, T, 13, M.plastic);
}
function nano(c) {
  const T = dualRow(c, { w: 18, l: 44, pcb: '#1b4f8c', rowX: 7.62, z0: -17.78,
    left: ['D13','3V3','REF','A0','A1','A2','A3','A4','A5','A6','A7','5V','RST','GND','VIN'],
    right: ['D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','GND','RST','RX0','TX1'],
    paint: (x, k) => text(x, k, 'NANO V3', 9, 31, 1.4, { rot: -Math.PI / 2 }) });
  block(c, 7, 1, 7, 0, T, 3, M.plastic, { rot: [0, Math.PI / 4, 0] });
  if (!cad(c, 'usb-mini-b', 0, T, -20, { rotY: Math.PI })) block(c, 7.5, 3.8, 8, 0, T, -20, M.silver);
  block(c, 3, 1.4, 3, 0, T, -6, 0xe8e8e8);
}
const PICO_L = ['GP0','GP1','GND','GP2','GP3','GP4','GP5','GND','GP6','GP7','GP8','GP9','GND','GP10','GP11','GP12','GP13','GND','GP14','GP15'];
const PICO_R = ['VBUS','VSYS','GND','3V3_EN','3V3','VREF','GP28','AGND','GP27','GP26','RUN','GP22','GND','GP21','GP20','GP19','GP18','GND','GP17','GP16'];
function pico(c) {
  // Rendu réaliste : la vraie carte (KiCad), avec les broches mâles du constructeur par-dessus.
  if (cad(c, 'rpi-pico', 0, 0, 0.6)) {
    const b = { top: 1, pads: [], labels: [] };
    header(c, PICO_L, { board: b, axis: 'z', x: -8.89, start: -24.13 });
    header(c, PICO_R, { board: b, axis: 'z', x: 8.89, start: -24.13 });
    return;
  }
  const T = dualRow(c, { w: 21, l: 51, pcb: '#2c7a3f', rowX: 8.89, z0: -24.13, left: PICO_L, right: PICO_R,
    paint: (x, k) => text(x, k, 'Raspberry Pi Pico', 10.5, 40, 1.15, { rot: -Math.PI / 2 }) });
  block(c, 7, 0.9, 7, 0, T, 2, M.plastic, { rot: [0, Math.PI / 4, 0] });
  block(c, 8, 2.6, 5.5, 0, T, -24, M.silver);
  block(c, 3.5, 1, 3.5, 0, T, -13, 0xeeeeee);
}
function uno(c) {
  const b = board(c, 68.6, 53.3, '#0b6e79');
  header(c, ['SCL','SDA','AREF','GND','D13','D12','D11','D10','D9','D8'], { board: b, axis: 'x', x: -4, z: -24.4, female: true, labels: 1 });
  header(c, ['D7','D6','D5','D4','D3','D2','D1','D0'], { board: b, axis: 'x', x: 21, z: -24.4, female: true, labels: 1 });
  header(c, ['IOREF','RST','3V3','5V','GND','GND','VIN'], { board: b, axis: 'x', x: -2, z: 24.4, female: true, labels: -1 });
  header(c, ['A0','A1','A2','A3','A4','A5'], { board: b, axis: 'x', x: 22, z: 24.4, female: true, labels: -1 });
  b.finish((x, k) => { text(x, k, 'UNO', 42, 30, 4.2); text(x, k, 'DIGITAL (PWM ~)', 46, 11.5, 1.2, { weight: 500 }); text(x, k, 'POWER        ANALOG IN', 46, 42, 1.2, { weight: 500 }); });
  block(c, 16, 11, 12, -29, b.top, -14, M.silver);
  if (!cad(c, 'barrel-jack', -28.5, b.top, 17, { rotY: -Math.PI / 2 })) block(c, 14, 11, 9, -29.5, b.top, 17, M.plastic);
  if (!cad(c, 'dip-28', 13, b.top, 9, { rotY: Math.PI / 2 })) {
    block(c, 35, 3.5, 7.5, 13, b.top + 1, 9, M.plastic);
    for (let i = 0; i < 14; i++) [-1, 1].forEach(s => block(c, 0.5, 1.2, 1.2, 13 + (i - 6.5) * PITCH, b.top, 9 + s * 4, M.leg));
  }
  cad(c, 'crystal-hc49', -14, b.top, -15, { rotY: Math.PI / 2 });
  block(c, 3, 1.4, 3, -27, b.top, -1, 0xd03a2c);
}

/* ---------- Prototypage ---------- */
function breadboard(c) {
  const W = 82, L = 55, H = 8.5;
  block(c, W, H, L, 0, 0, 0, 0xeceae4, { r: 0.7 });
  const cols = 30, colX = i => (i - 14.5) * PITCH;
  const rows = 'ABCDEFGHIJ'.split(''), rowZ = i => (i < 5 ? -13.97 + i * PITCH : 3.81 + (i - 5) * PITCH);
  const railX = j => (j + Math.floor(j / 5) - 14) * PITCH;
  const rails = [['T-', -24.13], ['T+', -21.59], ['B+', 21.59], ['B-', 24.13]];
  decal(c, W, L, 0, H + 0.02, 0, (x, k, cv) => {
    x.fillStyle = '#eceae4'; x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#d9d6cd'; x.fillRect(0, (L / 2 - 1.2) * k, cv.width, 2.4 * k);
    const hole = (px, pz) => { x.fillStyle = '#3b3b38'; x.fillRect((px + W / 2 - 0.55) * k, (pz + L / 2 - 0.55) * k, 1.1 * k, 1.1 * k); };
    rows.forEach((r, ri) => { for (let i = 0; i < cols; i++) hole(colX(i), rowZ(ri)); text(x, k, r.toLowerCase(), 1.8, rowZ(ri) + L / 2, 1.2, { color: '#8a877e' }); });
    for (let i = 0; i < cols; i += 5) { text(x, k, String(i + 1), colX(i) + W / 2, L / 2 - 16.3, 1.05, { color: '#8a877e' }); }
    rails.forEach(([n, z]) => { for (let j = 0; j < 25; j++) hole(railX(j), z); });
    [[-25.6, '#2f6fd6'], [-20.1, '#d33b32'], [20.1, '#d33b32'], [25.6, '#2f6fd6']].forEach(([z, col]) => { x.fillStyle = col; x.fillRect(4 * k, (z + L / 2 - 0.12) * k, (W - 8) * k, 0.24 * k); });
  }, 10, { r: 0.75 });
  const marker = (px, pz, name) => { const m = add(c, boxGeo(1.1, 0.3, 1.1), M.hole, px, H + 0.15, pz); c.pin(name, m, new V3(px, H, pz)); };
  rows.forEach((r, ri) => { for (let i = 0; i < cols; i++) marker(colX(i), rowZ(ri), r + (i + 1)); });
  rails.forEach(([n, z]) => { for (let j = 0; j < 25; j++) marker(railX(j), z, n + (j + 1)); });
}
function miniBreadboard(c) {
  const W = 46, L = 35, H = 8.5;
  block(c, W, H, L, 0, 0, 0, 0xeceae4, { r: 0.7 });
  const colX = i => (i - 8) * PITCH, rows = 'ABCDEFGHIJ'.split(''), rowZ = i => (i < 5 ? -13.97 + i * PITCH : 3.81 + (i - 5) * PITCH);
  decal(c, W, L, 0, H + 0.02, 0, (x, k, cv) => {
    x.fillStyle = '#eceae4'; x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#d9d6cd'; x.fillRect(0, (L / 2 - 1.2) * k, cv.width, 2.4 * k);
    rows.forEach((r, ri) => { for (let i = 0; i < 17; i++) { x.fillStyle = '#3b3b38'; x.fillRect((colX(i) + W / 2 - 0.55) * k, (rowZ(ri) + L / 2 - 0.55) * k, 1.1 * k, 1.1 * k); } });
  }, 10, { r: 0.75 });
  rows.forEach((r, ri) => { for (let i = 0; i < 17; i++) { const m = add(c, boxGeo(1.1, 0.3, 1.1), M.hole, colX(i), H + 0.15, rowZ(ri)); c.pin(r + (i + 1), m, new V3(colX(i), H, rowZ(ri))); } });
}

/* ---------- Capteurs ---------- */
function dht(color, name) {
  return c => {
    const b = moduleBoard(c, 16, 30, BLUE, ['VCC', 'DATA', 'GND']); b.finish();
    if (name === 'DHT11' && cad(c, 'dht11', 0, b.top, -3, { rotX: -Math.PI / 2, rotZ: Math.PI / 2 })) return;
    block(c, 15.5, 7.7, 20, 0, b.top, -4, color, { r: 0.7 });
    decal(c, 15.5, 20, 0, b.top + 7.72, -4, (x, k) => {
      x.fillStyle = color; x.fillRect(0, 0, 15.5 * k, 20 * k); x.fillStyle = 'rgba(0,0,0,.35)';
      for (let r = 0; r < 6; r++) for (let q = 0; q < 4; q++) x.fillRect((1.6 + q * 3.3) * k, (1.5 + r * 2.4) * k, 2.4 * k, 1.2 * k);
      text(x, k, name, 7.75, 18.3, 1.4, { color: '#2a2d30' });
    }, 14);
  };
}
function hcsr04(c) {
  const b = moduleBoard(c, 45, 20, BLUE, ['VCC', 'TRIG', 'ECHO', 'GND']); b.finish(x => 0);
  [-13, 13].forEach(x => { cyl(c, 8, 12, x, b.top, -2, M.silver, { open: true, seg: 40 }); cyl(c, 7.7, 0.4, x, b.top + 11.4, -2, 0x2a2d30, { seg: 40 }); });
  block(c, 10, 3.2, 3.6, 0, b.top, -6, M.silver);
}
function pir(c) {
  const b = moduleBoard(c, 32, 24, GREEN, ['VCC', 'OUT', 'GND']); b.finish();
  block(c, 23, 2, 23, 0, b.top, -1, 0xf2f2ee);
  dome(c, 11, 0, b.top + 2, -1, 0xf6f6f2, { r: 0.85, o: 0.95 });
}
function ldr(c) {
  const b = moduleBoard(c, 14, 32, BLUE, ['VCC', 'GND', 'DO', 'AO']); b.finish();
  cyl(c, 2.6, 1.6, 0, b.top + 5, -12, 0xc98a3a); [-1, 1].forEach(s => block(c, 0.4, 5, 0.4, s, b.top, -12, M.leg));
  block(c, 6.5, 4, 6.5, 0, b.top, -2, 0x2f6fd6); cyl(c, 1.2, 1, 0, b.top + 4, -2, 0xe8d9a8);
}
function soil(c) {
  const b = moduleBoard(c, 23, 98, BLACK, ['GND', 'VCC', 'AOUT']); b.finish((x, k) => { text(x, k, 'Capacitive Soil', 11.5, 60, 1.6, { rot: -Math.PI / 2 }); x.fillStyle = '#c9a35a'; x.fillRect(5 * k, 2 * k, 13 * k, 40 * k); });
  block(c, 4.5, 1.2, 4.5, 0, b.top, 30, M.plastic);
}
function mq2(c) {
  const b = moduleBoard(c, 21, 33, BLUE, ['VCC', 'GND', 'DO', 'AO']); b.finish();
  cyl(c, 9.5, 3, 0, b.top, -4, 0xd18a3d); cyl(c, 8.5, 8, 0, b.top + 3, -4, M.silver, { seg: 36 });
  cyl(c, 7.8, 0.3, 0, b.top + 11, -4, 0x8d9196);
}
function ds18b20(c) {
  const s = socket(c, 8, 7, ['GND', 'DQ', 'VDD']);
  if (cad(c, 'to-92', 0, s.top, -1.4)) return;
  const body = add(c, new THREE.CylinderGeometry(2.4, 2.4, 4.8, 24, 1, false, 0, Math.PI), mat(0x151515), 0, 10.5, -1.4);
  body.rotation.y = Math.PI / 2;
  [-1.27, 0, 1.27].forEach(x => block(c, 0.4, 5.5, 0.4, x, s.top, -1.4, M.leg));
}
function bmp280(c) { const b = moduleBoard(c, 15, 12, PURPLE, ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO']); b.finish(); block(c, 2.5, 0.9, 2.5, 0, b.top, -2, M.silver); }
function mpu6050(c) {
  const b = moduleBoard(c, 21, 16, BLUE, ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT']);
  b.finish((x, k) => text(x, k, 'GY-521', 10.5, 3.2, 1.2));
  block(c, 4, 0.9, 4, 0, b.top, -2, M.plastic);
}
function dht11(c) { dht('#3f7fd0', 'DHT11')(c); }
function soundSensor(c) {
  const b = moduleBoard(c, 15, 34, BLUE, ['AO', 'GND', 'VCC', 'DO']); b.finish();
  cyl(c, 4.9, 5, 0, b.top, -11, M.silver); cyl(c, 4.4, 0.2, 0, b.top + 5, -11, 0x222222);
  block(c, 6.5, 4, 6.5, 0, b.top, 1, 0x2f6fd6);
}

/* ---------- Entrées ---------- */
function button(c) {
  socket(c, 9, 8.4, ['1', '2'], { pitch: 5.08 });
  if (cad(c, 'button-6mm', 0, 3, -1.6)) return;
  block(c, 6, 3, 6, 0, 3, -1.5, 0x2b2e31); cyl(c, 1.8, 1.6, 0, 6, -1.5, 0x8e959b);
}
function potentiometer(c) {
  socket(c, 12, 10, ['1', 'W', '3']);
  if (cad(c, 'pot-10k', 0, 3, -2)) return;
  block(c, 9.5, 5, 9.5, 0, 3, -1.5, 0x2f6fd6, { r: 0.5 }); cyl(c, 3.2, 2, 0, 8, -1.5, M.silver);
  cyl(c, 3, 8, 0, 10, -1.5, 0x2a2a2a); block(c, 0.6, 0.4, 3, 0, 18, -1.5, 0xdddddd);
}
function joystick(c) {
  const b = moduleBoard(c, 26, 34, BLACK, ['GND', '+5V', 'VRx', 'VRy', 'SW']); b.finish();
  block(c, 16, 6, 16, 0, b.top, -4, 0x2a2a2a); dome(c, 7, 0, b.top + 6, -4, 0x333333);
  cyl(c, 1.6, 8, 0, b.top + 10, -4, 0x444444); cyl(c, 6.5, 4, 0, b.top + 17, -4, 0x202020, { r2: 5 });
}
function irReceiver(c) {
  const b = moduleBoard(c, 15, 20, BLACK, ['OUT', 'GND', 'VCC']); b.finish();
  block(c, 6, 7, 3, 0, b.top, -5, 0x111111); dome(c, 2.2, 0, b.top + 4.5, -6.6, 0x1a1a1a);
}
function keypad(c) {
  const b = board(c, 69, 77, '#2a2d30', { holes: false, t: 0.8 });
  header(c, ['R1','R2','R3','R4','C1','C2','C3','C4'], { board: b, axis: 'x', z: 40.5, y: 0, labels: 0 });
  b.finish((x, k) => {
    const keys = ['1','2','3','A','4','5','6','B','7','8','9','C','*','0','#','D'];
    keys.forEach((t, i) => { const cx = 8.5 + (i % 4) * 17.3, cy = 9 + Math.floor(i / 4) * 17.3;
      x.fillStyle = /[A-D]/.test(t) ? '#c23b32' : (/[*#]/.test(t) ? '#2f6fd6' : '#e6e6e2'); x.fillRect((cx - 6.5) * k, (cy - 6.5) * k, 13 * k, 13 * k);
      text(x, k, t, cx, cy, 5, { color: /[*#A-D]/.test(t) ? '#fff' : '#222' }); });
  });
}

/* ---------- Affichage ---------- */
/**
 * Écran redessinable par la simulation : `lines` vaut null (texte de démonstration),
 * [] (écran éteint) ou les lignes à afficher. L'écran émet sa propre lumière.
 */
function screen(c, w, l, x, y, z, k, paint, o) {
  const mesh = decal(c, w, l, x, y, z, (g, kk) => paint(g, kk, null), k, o);
  mesh.material.emissive = new THREE.Color(0xffffff); mesh.material.emissiveMap = mesh.material.map; mesh.material.emissiveIntensity = 0.75;
  c.screen = { mesh, k, paint };
}
const OLED_ON = '#8fd3ff', OLED_OFF = '#040608';
/** Image produite par un programme (Adafruit_SSD1306) : textes et formes sur 128 × 64 points. */
function paintOledOps(x, k, scr) {
  const sc = 22 * k / 128, on = scr.inv ? OLED_OFF : OLED_ON, off = scr.inv ? OLED_ON : OLED_OFF;
  x.fillStyle = off; x.fillRect(0, 0, 22 * k, 11 * k);
  x.save(); x.scale(sc, sc); x.lineWidth = 1; x.textBaseline = 'top';
  for (const o of scr.ops) {
    const col = o.c === 0 ? off : on;
    x.fillStyle = col; x.strokeStyle = col;
    if (o.t === 'text') {
      x.font = `500 ${7.6 * o.s}px "JetBrains Mono", ui-monospace, monospace`;
      [...o.str].forEach((ch, i) => x.fillText(ch, o.x + i * 6 * o.s, o.y + 0.4 * o.s));
    } else if (o.t === 'rect') {
      if (o.fill) x.fillRect(o.x, o.y, o.w, o.h); else x.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    } else if (o.t === 'line') {
      x.beginPath(); x.moveTo(o.x0 + 0.5, o.y0 + 0.5); x.lineTo(o.x1 + 0.5, o.y1 + 0.5); x.stroke();
    } else if (o.t === 'circle') {
      x.beginPath(); x.arc(o.x + 0.5, o.y + 0.5, o.r, 0, 7); o.fill ? x.fill() : x.stroke();
    } else if (o.t === 'tri') {
      const p = o.p; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(p[2], p[3]); x.lineTo(p[4], p[5]); x.closePath(); o.fill ? x.fill() : x.stroke();
    }
  }
  x.restore();
}
/**
 * Image d'un vrai programme (mode fidèle) : la mémoire de l'écran SSD1306 telle que la puce la reçoit, octet par
 * octet (8 lignes de points par « page », bit 0 en haut). scr = { bits: Uint8Array(w * h / 8), w, h, inv, on }.
 */
function paintOledBits(x, k, scr) {
  const W = scr.w || 128, H = scr.h || 64, sc = 22 * k / 128, on = scr.inv ? OLED_OFF : OLED_ON, off = scr.inv ? OLED_ON : OLED_OFF;
  x.fillStyle = OLED_OFF; x.fillRect(0, 0, 22 * k, 11 * k);
  if (scr.on === false) return;
  x.fillStyle = off; x.fillRect(0, 0, W * sc, H * sc);
  x.fillStyle = on;
  for (let page = 0; page < H / 8; page++) for (let col = 0; col < W; col++) {
    const b = scr.bits[page * W + col]; if (!b) continue;
    for (let bit = 0; bit < 8; bit++) if (b & (1 << bit)) x.fillRect(col * sc, (page * 8 + bit) * sc, sc, sc);
  }
}
const paintOled = (x, k, lines) => {
  if (lines && lines.ops) { paintOledOps(x, k, lines); return; }
  if (lines && lines.bits) { paintOledBits(x, k, lines); return; }
  x.fillStyle = OLED_OFF; x.fillRect(0, 0, 22 * k, 11 * k);
  if (lines && !lines.length) return;
  const [a, b] = lines || ['JOLLOF', '23,4 °C  58 %'];
  text(x, k, a.slice(0, 12), 11, 3.4, 2.6, { color: '#8fd3ff' }); text(x, k, (b || '').slice(0, 22), 11, 7.6, 1.6, { color: '#8fd3ff', weight: 500 });
};
const paintLcd = (x, k, lines) => {
  const off = lines && !lines.length;
  x.fillStyle = off ? '#0f1830' : '#2f62d8'; x.fillRect(0, 0, 64 * k, 15 * k);
  if (off) return;
  const [a, b] = lines || ['Jollof Studio', 'Temp: 23.4 C'];
  text(x, k, a.slice(0, 16), 3, 4.4, 3.4, { color: '#eaf2ff', align: 'left', weight: 500 });
  text(x, k, (b || '').slice(0, 16), 3, 10.6, 3.4, { color: '#eaf2ff', align: 'left', weight: 500 });
};
function oled(c) {
  const b = moduleBoard(c, 27, 28, '#1d2b6b', ['GND', 'VCC', 'SCL', 'SDA']); b.finish();
  block(c, 26, 1.4, 19, 0, b.top, -2.5, 0x0a0a0a);
  screen(c, 22, 11, 0, b.top + 1.42, -3, 16, paintOled, { r: 0.2 });
}
function lcd1602(c) {
  const b = board(c, 80, 36, GREEN);
  header(c, ['GND', 'VCC', 'SDA', 'SCL'], { board: b, axis: 'z', x: -42.5, z: 0, y: 6, labels: 0 });
  b.finish();
  block(c, 71, 7, 26, 0, b.top, -1, 0x111111);
  screen(c, 64, 15, 0, b.top + 7.02, -1, 12, paintLcd, { r: 0.25 });
  block(c, 4, 6, 42, -40, 0, 0, '#1b1b1b');
}
/** Segments allumés : null = dessin de présentation (tous rouges), sinon un ensemble de lettres A…G, DP. */
const paintSeg = (x, k, on) => {
  x.fillStyle = '#151515'; x.fillRect(0, 0, 12.6 * k, 19 * k);
  const s = (name, a, bb, w, h) => { x.fillStyle = !on || on.has(name) ? '#ff3b2f' : '#3a1814'; x.fillRect(a * k, bb * k, w * k, h * k); };
  s('A', 3, 2, 6, 1.2); s('G', 3, 8.9, 6, 1.2); s('D', 3, 15.8, 6, 1.2); s('F', 2, 3, 1.2, 5.8); s('B', 8.8, 3, 1.2, 5.8); s('E', 2, 10, 1.2, 5.8); s('C', 8.8, 10, 1.2, 5.8);
  x.fillStyle = !on || on.has('DP') ? '#ff3b2f' : '#3a1814'; x.beginPath(); x.arc(11 * k, 16.4 * k, 0.7 * k, 0, 7); x.fill();
};
function sevenSeg(c) {
  block(c, 12.6, 8, 19, 0, 0, -1.5, 0xf2f2ee);
  const mesh = decal(c, 12.6, 19, 0, 8.02, -1.5, (x, k) => paintSeg(x, k, null), 16, { r: 0.4 });
  mesh.material.emissive = new THREE.Color(0xffffff); mesh.material.emissiveMap = mesh.material.map; mesh.material.emissiveIntensity = 0;
  c.seg7 = { mesh, k: 16, paint: paintSeg };
  ['E', 'D', 'COM', 'C', 'DP'].forEach((n, i) => leg(c, n, (i - 2) * PITCH, 10, 0, 7));
  ['G', 'F', 'COM', 'A', 'B'].forEach((n, i) => leg(c, n, (i - 2) * PITCH, -13, 0, 7));
}
function ws2812(c) {
  const b = moduleBoard(c, 51, 10, BLACK, ['GND', 'VCC', 'DIN'], { pinX: -21 }); b.finish();
  c.pixels = [];
  for (let i = 0; i < 8; i++) {
    block(c, 5, 1.5, 5, -17.5 + i * 6.3, b.top, -1.5, 0xf4f4f0);
    const m = stdMat({ color: 0xf2e6c8, emissive: 0x221a08, roughness: 0.4 });
    block(c, 3, 0.1, 3, -17.5 + i * 6.3, b.top + 1.5, -1.5, m); c.pixels.push(m);
  }
}

/* ---------- Sorties ---------- */
const LED_COLORS = { rouge: [0xd8322f, 0xff2a1a], verte: [0x2fbf5a, 0x30ff70], bleue: [0x2f6fe0, 0x3080ff], jaune: [0xf2c94c, 0xffd030], blanche: [0xf2f2ee, 0xffffff] };
const LED_CAD = { rouge: 'led-5mm-red', verte: 'led-5mm-green', bleue: 'led-5mm-blue', jaune: 'led-5mm-yellow', blanche: 'led-5mm-clear' };
function led(colorName) {
  return c => {
    const [body, glow] = LED_COLORS[colorName];
    socket(c, 8, 8, ['A', 'K']);
    const real = cad(c, LED_CAD[colorName], 0, 3, -1.8);
    let m = real && ownMaterial(real);
    if (m) { m.transparent = true; m.opacity = 0.92; m.roughness = 0.2; }
    else {
      m = stdMat({ color: body, roughness: 0.18, transparent: true, opacity: 0.9 });
      cyl(c, 2.9, 1, 0, 8, -1.8, m); cyl(c, 2.5, 4.6, 0, 9, -1.8, m); dome(c, 2.5, 0, 13.6, -1.8, m);
      [-1.27, 1.27].forEach(x => block(c, 0.5, 5, 0.5, x, 3, -1.8, M.leg));
    }
    // Lumière « virtuelle » : la scène prête l'une de ses quelques lampes aux LED les plus brillantes.
    const light = { intensity: 0, color: new THREE.Color(glow), position: new THREE.Vector3(0, 12, -1.8) };
    c.led = { mat: m, light, glow };
  };
}
function rgbLed(c) {
  socket(c, 10, 8, ['R', 'GND', 'G', 'B']);
  const real = cad(c, 'led-5mm-rgb', 0, 3, -1.8);
  let m = real && ownMaterial(real);
  if (!m) {
    m = stdMat({ color: 0xf2f2f2, roughness: 0.3, transparent: true, opacity: 0.75 });
    if (!real) { cyl(c, 2.9, 1, 0, 8, -1.8, m); cyl(c, 2.5, 4.6, 0, 9, -1.8, m); dome(c, 2.5, 0, 13.6, -1.8, m); }
  }
  const light = { intensity: 0, color: new THREE.Color(0xffffff), position: new THREE.Vector3(0, 12, -1.8) };
  c.rgb = { mat: m, light };
}
function buzzer(c) {
  socket(c, 13, 13, ['+', '-'], { pitch: 7.6 });
  if (cad(c, 'buzzer-12mm', 0, 3, -1.5)) return;
  cyl(c, 6, 8, 0, 3, -1.5, 0x161616, { seg: 36 }); cyl(c, 1.2, 0.2, 0, 11, -1.5, 0x050505);
}
function relay(c) {
  const b = moduleBoard(c, 50, 26, BLUE, ['VCC', 'GND', 'IN'], { pinX: -18 }); b.finish();
  block(c, 19, 15.5, 15.5, 2, b.top, -2, 0x2f62d8); decal(c, 19, 15.5, 2, b.top + 15.52, -2, (x, k) => { x.fillStyle = '#2f62d8'; x.fillRect(0, 0, 19 * k, 15.5 * k); text(x, k, 'SRD-05VDC', 9.5, 5, 1.6); text(x, k, '10A 250VAC', 9.5, 9, 1.3, { weight: 500 }); }, 12);
  block(c, 8, 10, 15, 20, b.top, -2, 0x2f9e5a);
  // Bornier à vis des contacts : NO, COM, NC (de l'arrière vers l'avant), une vis sur chaque borne.
  [['NO', -7], ['COM', -2], ['NC', 3]].forEach(([n, z]) => { cyl(c, 1.6, 0.8, 20, b.top + 10, z, M.silver); leg(c, n, 20, z, b.top + 10.8, 0.8); });
  const led = stdMat({ color: 0x5a1010, emissive: 0x000000, roughness: 0.3 });
  block(c, 1.6, 0.8, 1, -12, b.top, -8, led);
  c.relay = { led };
}
function speaker(c) {
  socket(c, 10, 8, ['+', '-'], { pitch: 5.08 });
  cyl(c, 14, 4, 0, 3, -14, M.silver, { seg: 40 }); cyl(c, 12, 0.4, 0, 7, -14, 0x1a1a1a, { seg: 40 });
}

/* ---------- Moteurs ---------- */
function servo(c) {
  block(c, 23, 22.5, 12.2, 0, 0, -8, 0x2f62d8, { r: 0.5 });
  block(c, 32, 2.5, 12.2, 0, 15.5, -8, 0x2f62d8);
  cyl(c, 6, 4, -5.5, 22.5, -8, 0x2f62d8); cyl(c, 2.5, 3.5, -5.5, 26.5, -8, 0xf2f2ee);
  // Palonnier sur un pivot : la simulation le fait tourner (0° vers la droite, 90° vers l'arrière).
  const piv = new THREE.Group(); piv.position.set(-5.5, 30, -8); c.g.add(piv);
  const arm = new THREE.Mesh(boxGeo(19, 1.8, 5), mat(0xf2f2ee)); arm.position.set(6.5, 0.9, 0); piv.add(arm);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.8, 24), mat(0xf2f2ee)); hub.position.set(0, 0.9, 0); piv.add(hub);
  piv.rotation.y = Math.PI / 2;
  c.servo = { piv };
  socket(c, 10, 6, ['GND', 'VCC', 'SIG']);
  [[0x6b3a1e, -2.54], [0xd8322f, 0], [0xf08a3c, 2.54]].forEach(([col, x]) => block(c, 1, 0.9, 6, x, 1, -2, col));
}
function dcMotor(c) {
  cyl(c, 10, 25, 0, 10, -10, M.silver, { axis: 'z', seg: 36 });
  cyl(c, 1, 8, 0, 10, -26, M.leg, { axis: 'z' });
  // Hélice en bout d'axe : on voit le moteur tourner, dans un sens ou dans l'autre.
  const piv = new THREE.Group(); piv.position.set(0, 10, -30.6); c.g.add(piv);
  const blade = mat(0xe0703a, { r: 0.5 });
  [0, Math.PI].forEach(a => { const m = new THREE.Mesh(boxGeo(9, 3, 0.8), blade); m.position.set(Math.cos(a) * 5, Math.sin(a) * 5, 0); m.rotation.z = a; piv.add(m); });
  piv.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.4, 16).rotateX(Math.PI / 2), mat(0x222222)));
  c.spin = { obj: piv, axis: 'z' };
  block(c, 10, 2, 7, 0, 0, 3.5, M.plastic);
  [['M+', -2.54], ['M-', 2.54]].forEach(([n, x]) => leg(c, n, x, 5, 2, 5));
}
/** Socle à deux pattes (+ et −) à l'avant, comme le moteur : fils rouge et noir vers le corps. */
function leads2(c, w = 10) {
  block(c, w, 2, 7, 0, 0, 3.5, M.plastic);
  [['+', -1.27], ['-', 1.27]].forEach(([n, x]) => leg(c, n, x, 5, 2, 5));
  block(c, 0.8, 0.8, 6, -1.27, 2, -2.5, 0xd8322f); block(c, 0.8, 0.8, 6, 1.27, 2, -2.5, 0x1b1b1b);
}
function fan(c) {
  leads2(c);
  // Cadre 40 × 40 × 10 debout, l'air soufflé vers l'avant ; rotor à 7 pales sur un pivot (axe z).
  const F = 0x1c1c1c, y0 = 2, z = -10;
  block(c, 44, 2, 14, 0, 0, z, 0x2b2b2b);
  block(c, 40, 4, 10, 0, y0, z, F); block(c, 40, 4, 10, 0, y0 + 36, z, F);
  block(c, 4, 32, 10, -18, y0 + 4, z, F); block(c, 4, 32, 10, 18, y0 + 4, z, F);
  const piv = new THREE.Group(); piv.position.set(0, y0 + 20, z); c.g.add(piv);
  piv.add(new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 7, 28).rotateX(Math.PI / 2), mat(0x111111)));
  const bm = mat(0x2a2a2a, { r: 0.5 });
  for (let i = 0; i < 7; i++) {
    const a = i * 2 * Math.PI / 7, b = new THREE.Mesh(boxGeo(5.5, 11, 0.8), bm);
    b.position.set(Math.cos(a) * 11.5, Math.sin(a) * 11.5, 0); b.rotation.set(0.5, 0, a - Math.PI / 2); piv.add(b);
  }
  piv.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 7.2, 20).rotateX(Math.PI / 2), mat(0xe0703a)));
  c.spin = { obj: piv, axis: 'z' };
}
function pump(c) {
  leads2(c);
  // Corps immergé, couvercle, buse de sortie ; turbine visible sur le dessus (axe y) ; jet d'eau à la sortie.
  const z = -12;
  cyl(c, 11, 24, 0, 0, z, 0x1f1f1f, { seg: 36 }); cyl(c, 11.4, 2, 0, 24, z, 0xe9e9e6, { seg: 36 });
  cyl(c, 3.2, 12, 16, 18, z, 0xe9e9e6, { axis: 'x' });
  const piv = new THREE.Group(); piv.position.set(0, 26.6, z); c.g.add(piv);
  const vm = mat(0x3b82f6, { r: 0.4 });
  for (let i = 0; i < 4; i++) { const v = new THREE.Mesh(boxGeo(15, 0.9, 1.8), vm); v.rotation.y = i * Math.PI / 4; piv.add(v); }
  piv.add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.4, 16), mat(0x111111)));
  c.spin = { obj: piv, axis: 'y' };
  // Gouttes préparées une fois : elles avancent et retombent selon la vitesse de la pompe.
  const water = new THREE.Group(); c.g.add(water);
  const dm = stdMat({ color: 0x4aa8ff, transparent: true, opacity: 0.8, roughness: 0.2 }), geo = new THREE.SphereGeometry(1.1, 10, 8), N = 14, drops = [];
  for (let i = 0; i < N; i++) { const m = new THREE.Mesh(geo, dm); m.visible = false; water.add(m); drops.push(m); }
  const ox = 22.5, oy = 18;
  let ph = 0;
  c.water = {
    obj: water, drops, speed: 0,
    tick(dt) {
      const sp = this.speed, on = sp > 0.05;
      ph = (ph + dt * (0.6 + 1.6 * sp)) % 1;
      drops.forEach((m, i) => {
        const t = (ph + i / N) % 1, L = 10 + 30 * Math.min(1, sp), y = oy + 5 * t * sp - 20 * t * t;
        m.visible = on && y > 0.6;
        if (m.visible) { m.position.set(ox + L * t, y, z); m.scale.setScalar(0.6 + 0.6 * (1 - t)); }
      });
    }
  };
}
function vibro(c) {
  socket(c, 12, 8, ['+', '-'], { pitch: 2.54 });
  // Pastille de 10 mm sur un groupe que la simulation fait trembler (masse décentrée).
  const o = new THREE.Group(); o.position.set(0, 3, -1); c.g.add(o);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3, 32), M.silver); disc.position.y = 1.5; o.add(disc);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.3, 24), mat(0xc9a227)); pad.position.y = 3.1; o.add(pad);
  c.buzz = { obj: o, base: o.position.clone() };
}
function l298n(c) {
  const b = board(c, 43, 43, RED);
  header(c, ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'], { board: b, axis: 'x', z: 19.5, x: 5, labels: -1 });
  ['+12V', 'GND', '+5V'].forEach((n, i) => { const x = -17 + i * 5; block(c, 5, 8, 7, x, b.top, 17, 0x2f62d8); leg(c, n, x, 19, b.top + 8, 2); });
  [['OUT1', -19, -6], ['OUT2', -19, 0], ['OUT3', 19, -6], ['OUT4', 19, 0]].forEach(([n, x, z]) => { block(c, 7, 8, 5, x, b.top, z, 0x2f62d8); leg(c, n, x, z, b.top + 8, 2); });
  b.finish((x, k) => text(x, k, 'L298N', 21.5, 36, 2));
  block(c, 16, 3, 23, 0, b.top, -8, 0x111111);
  for (let i = 0; i < 7; i++) block(c, 1.2, 22, 23, -6 + i * 2, b.top + 3, -8, 0x1b1b1b, { m: 0.4 });
}
function stepper(c) {
  cyl(c, 14, 19, 0, 0, -16, M.silver, { seg: 40 }); cyl(c, 2.5, 9, 0, 19, -24, 0xd4a64a);
  const piv = new THREE.Group(); piv.position.set(0, 28, -24); c.g.add(piv);
  const arm = new THREE.Mesh(boxGeo(11, 1.4, 3), mat(0xe0703a)); arm.position.set(4, 0.7, 0); piv.add(arm);
  c.spin = { obj: piv, axis: 'y' };
  block(c, 17, 16, 8, 0, 0, -2, 0x2f62d8);
  socket(c, 16, 6, ['IN1', 'IN2', 'IN3', 'IN4', 'VCC', 'GND']);
}

/* ---------- Passifs ---------- */
const BAND = { 0: 0x111111, 1: 0x6b3a1e, 2: 0xc0302a, 3: 0xe07a1f, 4: 0xe8c33a, 5: 0x2e9e4f, 6: 0x2f62d8, 7: 0x7a3fb0, 8: 0x888888, 9: 0xf2f2f2, g: 0xc9a24a };
function resistor(bands) {
  return c => {
    socket(c, 16, 7, ['1', '2'], { pitch: 10.16 });
    const real = cad(c, 'resistor-axial', 0, 3, -1.2);
    if (real) {
      const y = 3 + real.userData.size.y - 1.25;
      bands.forEach((bd, i) => cyl(c, 1.32, 0.5, [-1.9, -0.9, 0.1, 1.9][i], y, -1.2, BAND[bd], { axis: 'x' }));
      return;
    }
    cyl(c, 1.35, 6.5, 0, 8, -1.2, 0xd9c39a, { axis: 'x' });
    bands.forEach((bd, i) => cyl(c, 1.4, 0.55, [-2.1, -1, 0.1, 2.1][i], 8, -1.2, BAND[bd], { axis: 'x' }));
    [-1, 1].forEach(s => { cyl(c, 0.25, 2, s * 4.2, 8, -1.2, M.leg, { axis: 'x', seg: 8 }); block(c, 0.5, 5, 0.5, s * 5.08, 3, -1.2, M.leg); });
  };
}
function ceramicCap(c) {
  socket(c, 9, 7, ['1', '2']);
  if (cad(c, 'cap-disc', 0, 3, -1.5)) return;
  const d = add(c, new THREE.CylinderGeometry(2.8, 2.8, 1.4, 28), mat(0xd9a24a), 0, 11, -1.5, [Math.PI / 2, 0, 0]);
  void d; [-1.27, 1.27].forEach(x => block(c, 0.4, 6, 0.4, x, 3, -1.5, M.leg));
}
function electroCap(c) {
  socket(c, 10, 9, ['+', '-']);
  if (cad(c, 'cap-radial', 0, 3, -1.8)) return;
  cyl(c, 3.15, 11, 0, 3, -1.8, 0x1f3f8a, { seg: 32 }); cyl(c, 3.2, 11.02, 0, 3, -1.8, 0xb9c3d6, { seg: 32, open: true, r2: 3.2 });
  block(c, 1.6, 11.1, 0.3, 2.6, 3, -1.8, 0xdddddd, { rot: [0, 0.7, 0] });
}
function diode(c) {
  socket(c, 16, 7, ['A', 'K'], { pitch: 10.16 });
  if (cad(c, 'diode-do41', 0, 3, -1.2)) return;
  cyl(c, 1.35, 5.2, 0, 8, -1.2, 0x151515, { axis: 'x' }); cyl(c, 1.4, 0.7, 2, 8, -1.2, 0xcfcfcf, { axis: 'x' });
  [-1, 1].forEach(s => { cyl(c, 0.25, 2.6, s * 3.9, 8, -1.2, M.leg, { axis: 'x', seg: 8 }); block(c, 0.5, 5, 0.5, s * 5.08, 3, -1.2, M.leg); });
}
function to92(names) {
  return c => {
    const s = socket(c, 8, 7, names);
    if (cad(c, 'to-92', 0, s.top, -1.4)) return;
    const body = add(c, new THREE.CylinderGeometry(2.4, 2.4, 4.8, 24, 1, false, 0, Math.PI), mat(0x151515), 0, 10.5, -1.4);
    body.rotation.y = Math.PI / 2;
    [-1.27, 0, 1.27].forEach(x => block(c, 0.4, 5.5, 0.4, x, s.top, -1.4, M.leg));
  };
}

/* ---------- Alimentation ---------- */
function battery9v(c) {
  if (!cad(c, 'battery-9v', 0, 0, -10)) batteryBody(c);
  block(c, 12, 4, 8, 0, 0, 18, M.plastic);
  [['+', -2.54], ['-', 2.54]].forEach(([n, x]) => leg(c, n, x, 20.5, 4, 4));
}
function batteryBody(c) {
  block(c, 26, 17, 48, 0, 0, -10, 0x1b1b1b, { r: 0.5 });
  decal(c, 26, 48, 0, 17.02, -10, (x, k) => { x.fillStyle = '#d9692e'; x.fillRect(0, 0, 26 * k, 48 * k); x.fillStyle = '#1b1b1b'; x.fillRect(0, 30 * k, 26 * k, 18 * k); text(x, k, '9 V', 13, 18, 6, { color: '#1b1b1b' }); }, 10);
}
function mb102(c) {
  const b = moduleBoard(c, 33, 53, BLUE, ['+5V', 'GND', '+3V3'], { pinX: 0 }); b.finish((x, k) => text(x, k, 'MB102', 16.5, 30, 1.8));
  block(c, 9, 11, 14, -8, b.top, -18, M.plastic); block(c, 12, 6, 14, 8, b.top, -18, M.silver);
  block(c, 6, 5, 6, 0, b.top, 0, 0xeeeeee);
}
function lm7805(c) {
  socket(c, 10, 7, ['IN', 'GND', 'OUT']);
  block(c, 10, 9, 4.5, 0, 6, -1.5, 0x151515); block(c, 10, 6.5, 1.3, 0, 15, -3.1, M.silver);
  [-2.54, 0, 2.54].forEach(x => block(c, 0.8, 3, 0.5, x, 3, -1.5, M.leg));
}
function battery18650(c) {
  block(c, 22, 4, 77, 0, 0, -30, 0x1b1b1b);
  cyl(c, 9, 65, 0, 11, -30, 0x2f9e5a, { axis: 'z', seg: 40 });
  block(c, 10, 4, 8, 0, 0, 12, M.plastic);
  [['+', -2.54], ['-', 2.54]].forEach(([n, x]) => leg(c, n, x, 14.5, 4, 4));
}

/* ---------- Communication ---------- */
function hc05(c) {
  const b = moduleBoard(c, 16, 37, BLUE, ['STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN']); b.finish();
  block(c, 13, 2, 26, 0, b.top, -4, 0x1d8a4a); decal(c, 13, 26, 0, b.top + 2.02, -4, (x, k) => { x.fillStyle = '#1d8a4a'; x.fillRect(0, 0, 13 * k, 26 * k); text(x, k, 'HC-05', 6.5, 16, 1.8, { rot: -Math.PI / 2 }); x.fillStyle = '#c9a35a'; x.fillRect(1 * k, 1 * k, 11 * k, 5 * k); }, 12);
}
function rc522(c) {
  const b = board(c, 40, 60, BLUE);
  header(c, ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3.3V'], { board: b, axis: 'x', z: 27.8, labels: -1 });
  b.finish((x, k) => { x.strokeStyle = '#c9a35a'; x.lineWidth = 0.8 * k; for (let i = 0; i < 4; i++) x.strokeRect((4 + i * 1.6) * k, (4 + i * 1.6) * k, (32 - i * 3.2) * k, (34 - i * 3.2) * k); text(x, k, 'RFID-RC522', 20, 46, 1.6); });
  block(c, 5, 0.9, 5, 0, b.top, 18, M.plastic);
}
function nrf24(c) { const b = moduleBoard(c, 15, 29, BLACK, ['GND', 'VCC', 'CE', 'CSN', 'SCK', 'MOSI', 'MISO', 'IRQ'], { pitch: 1.78 }); b.finish((x, k) => { x.strokeStyle = '#c9a35a'; x.lineWidth = 0.6 * k; x.beginPath(); for (let i = 0; i < 6; i++) { x.lineTo(2 * k, (2 + i * 1.6) * k); x.lineTo(13 * k, (2.8 + i * 1.6) * k); } x.stroke(); }); block(c, 4, 0.9, 4, 0, b.top, 0, M.plastic); }
/** Adaptateur de niveau BSS138 4 voies : côté LV (3,3 V) d'un bord, côté HV (5 V) de l'autre, comme le module courant. */
function lvlshift(c) {
  const b = board(c, 16, 16, BLUE);
  header(c, ['LV1', 'LV2', 'LV', 'GND', 'LV3', 'LV4'], { board: b, axis: 'x', z: -6.4, labels: 1 });
  header(c, ['HV1', 'HV2', 'HV', 'GND', 'HV3', 'HV4'], { board: b, axis: 'x', z: 6.4, labels: -1 });
  b.finish((x, k) => { text(x, k, 'LV', 8, 5.2, 1.2); text(x, k, 'HV', 8, 11.6, 1.2); });
  [-4, 0, 4].forEach((xx, i) => i !== 1 && block(c, 2.2, 0.9, 1.4, xx, b.top, 0, M.plastic));
  [-2, 2, 6].forEach(xx => block(c, 1.2, 0.5, 0.7, xx - 2, b.top, 0, 0x2a2a2a));
}
function sim800(c) { const b = moduleBoard(c, 25, 23, '#c23b32', ['NET', 'VCC', 'RST', 'RXD', 'TXD', 'GND']); b.finish(); block(c, 15, 2.4, 15, 0, b.top, -3, M.silver); }

/* ---------- Catalogue ---------- */
export const LIBRARY = [
  { id: 'esp32', name: tl('ESP32 DevKit V1'), cat: tl('Cartes'), pre: 'ESP32', single: true, build: esp32 },
  { id: 'nodemcu', name: tl('ESP8266 NodeMCU'), cat: tl('Cartes'), pre: 'NODEMCU', single: true, build: nodemcu },
  { id: 'uno', name: tl('Arduino Uno R3'), cat: tl('Cartes'), pre: 'UNO', single: true, build: uno },
  { id: 'nano', name: tl('Arduino Nano'), cat: tl('Cartes'), pre: 'NANO', single: true, build: nano },
  { id: 'pico', name: 'Raspberry Pi Pico', cat: tl('Cartes'), pre: 'PICO', single: true, build: pico },

  { id: 'breadboard', name: tl('Breadboard 400 points'), cat: tl('Prototypage'), pre: 'BB', build: breadboard },
  { id: 'breadboard-mini', name: tl('Mini breadboard 170 points'), cat: tl('Prototypage'), pre: 'BB', build: miniBreadboard },

  { id: 'dht11', name: tl('DHT11 température/humidité'), cat: tl('Capteurs'), pre: 'DHT11', single: true, build: dht11 },
  { id: 'dht22', name: tl('DHT22 température/humidité'), cat: tl('Capteurs'), pre: 'DHT22', single: true, build: dht('#f2f2ee', 'DHT22') },
  { id: 'hcsr04', name: tl('HC-SR04 ultrason'), cat: tl('Capteurs'), pre: 'US', build: hcsr04 },
  { id: 'pir', name: tl('HC-SR501 mouvement PIR'), cat: tl('Capteurs'), pre: 'PIR', build: pir },
  { id: 'ldr', name: tl('Module photorésistance'), cat: tl('Capteurs'), pre: 'LDR', build: ldr },
  { id: 'soil', name: tl('Humidité du sol capacitif'), cat: tl('Capteurs'), pre: 'SOL', build: soil },
  { id: 'mq2', name: tl('MQ-2 gaz et fumée'), cat: tl('Capteurs'), pre: 'MQ', build: mq2 },
  { id: 'ds18b20', name: tl('DS18B20 température'), cat: tl('Capteurs'), pre: 'DS', build: ds18b20 },
  { id: 'bmp280', name: tl('BMP280 pression'), cat: tl('Capteurs'), pre: 'BMP', build: bmp280 },
  { id: 'mpu6050', name: tl('MPU6050 accéléromètre'), cat: tl('Capteurs'), pre: 'IMU', build: mpu6050 },
  { id: 'sound', name: tl('Module micro (son)'), cat: tl('Capteurs'), pre: 'MIC', build: soundSensor },

  { id: 'button', name: tl('Bouton poussoir'), cat: tl('Entrées'), pre: 'BTN', build: button },
  { id: 'pot', name: tl('Potentiomètre 10 kΩ'), cat: tl('Entrées'), pre: 'POT', build: potentiometer },
  { id: 'joystick', name: tl('Module joystick'), cat: tl('Entrées'), pre: 'JOY', build: joystick },
  { id: 'ir', name: tl('Récepteur infrarouge'), cat: tl('Entrées'), pre: 'IR', build: irReceiver },
  { id: 'keypad', name: tl('Clavier matriciel 4×4'), cat: tl('Entrées'), pre: 'KP', build: keypad },

  { id: 'oled', name: tl('Écran OLED 0,96" I2C'), cat: tl('Affichage'), pre: 'OLED', build: oled },
  { id: 'lcd1602', name: tl('Écran LCD 16×2 I2C'), cat: tl('Affichage'), pre: 'LCD', build: lcd1602 },
  { id: '7seg', name: tl('Afficheur 7 segments'), cat: tl('Affichage'), pre: 'SEG', build: sevenSeg },
  { id: 'ws2812', name: tl('Barrette WS2812 8 LED'), cat: tl('Affichage'), pre: 'RGB', build: ws2812 },

  { id: 'led-red', name: tl('LED 5 mm rouge'), cat: tl('Sorties'), pre: 'LED', build: led('rouge'), led: true },
  { id: 'led-green', name: tl('LED 5 mm verte'), cat: tl('Sorties'), pre: 'LED', build: led('verte'), led: true },
  { id: 'led-blue', name: tl('LED 5 mm bleue'), cat: tl('Sorties'), pre: 'LED', build: led('bleue'), led: true },
  { id: 'led-yellow', name: tl('LED 5 mm jaune'), cat: tl('Sorties'), pre: 'LED', build: led('jaune'), led: true },
  { id: 'led-white', name: tl('LED 5 mm blanche'), cat: tl('Sorties'), pre: 'LED', build: led('blanche'), led: true },
  { id: 'led-rgb', name: tl('LED RGB cathode commune'), cat: tl('Sorties'), pre: 'LED', build: rgbLed },
  { id: 'buzzer', name: tl('Buzzer actif'), cat: tl('Sorties'), pre: 'BZ', build: buzzer },
  { id: 'speaker', name: tl('Haut-parleur 8 Ω'), cat: tl('Sorties'), pre: 'HP', build: speaker },
  { id: 'relay', name: tl('Module relais 1 canal'), cat: tl('Sorties'), pre: 'K', build: relay },

  { id: 'servo', name: tl('Servomoteur SG90'), cat: tl('Moteurs'), pre: 'SERVO', build: servo },
  { id: 'dcmotor', name: tl('Moteur à courant continu'), cat: tl('Moteurs'), pre: 'M', build: dcMotor },
  { id: 'stepper', name: tl('Pas à pas 28BYJ-48 + ULN2003'), cat: tl('Moteurs'), pre: 'STEP', build: stepper },
  { id: 'l298n', name: tl('Pilote moteur L298N'), cat: tl('Moteurs'), pre: 'DRV', build: l298n },
  { id: 'fan', name: tl('Ventilateur 5 V'), cat: tl('Moteurs'), pre: 'FAN', build: fan },
  { id: 'pump', name: tl('Mini pompe à eau 5 V'), cat: tl('Moteurs'), pre: 'PMP', build: pump },
  { id: 'vibro', name: tl('Moteur vibreur'), cat: tl('Moteurs'), pre: 'VIB', build: vibro },

  { id: 'res-22', name: tl('Résistance 22 Ω'), cat: tl('Passifs'), pre: 'R', build: resistor([2, 2, 0, 'g']) },
  { id: 'res-220', name: tl('Résistance 220 Ω'), cat: tl('Passifs'), pre: 'R', build: resistor([2, 2, 1, 'g']) },
  { id: 'res-330', name: tl('Résistance 330 Ω'), cat: tl('Passifs'), pre: 'R', build: resistor([3, 3, 1, 'g']) },
  { id: 'res-1k', name: tl('Résistance 1 kΩ'), cat: tl('Passifs'), pre: 'R', build: resistor([1, 0, 2, 'g']) },
  { id: 'res-4k7', name: tl('Résistance 4,7 kΩ'), cat: tl('Passifs'), pre: 'R', build: resistor([4, 7, 2, 'g']) },
  { id: 'res-10k', name: tl('Résistance 10 kΩ'), cat: tl('Passifs'), pre: 'R', build: resistor([1, 0, 3, 'g']) },
  { id: 'cap-100n', name: tl('Condensateur 100 nF'), cat: tl('Passifs'), pre: 'C', build: ceramicCap },
  { id: 'cap-100u', name: tl('Condensateur 100 µF'), cat: tl('Passifs'), pre: 'C', build: electroCap },
  { id: 'diode', name: tl('Diode 1N4007'), cat: tl('Passifs'), pre: 'D', build: diode },
  { id: 'npn', name: tl('Transistor NPN BC547'), cat: tl('Passifs'), pre: 'Q', build: to92(['C', 'B', 'E']) },
  { id: 'pn2222', name: tl('Transistor NPN PN2222A'), cat: tl('Passifs'), pre: 'Q', build: to92(['E', 'B', 'C']) },

  { id: 'bat9v', name: tl('Pile 9 V'), cat: tl('Alimentation'), pre: 'BAT', build: battery9v },
  { id: 'bat18650', name: tl('Batterie 18650'), cat: tl('Alimentation'), pre: 'BAT', build: battery18650 },
  { id: 'mb102', name: tl('Module alimentation MB102'), cat: tl('Alimentation'), pre: 'PWR', build: mb102 },
  { id: 'lm7805', name: tl('Régulateur LM7805'), cat: tl('Alimentation'), pre: 'U', build: lm7805 },

  { id: 'hc05', name: tl('Bluetooth HC-05'), cat: tl('Communication'), pre: 'BT', build: hc05 },
  { id: 'rc522', name: tl('Lecteur RFID RC522'), cat: tl('Communication'), pre: 'RFID', build: rc522 },
  { id: 'nrf24', name: tl('Radio nRF24L01'), cat: tl('Communication'), pre: 'RF', build: nrf24 },
  { id: 'sim800', name: 'GSM SIM800L', cat: tl('Communication'), pre: 'GSM', build: sim800 },
  { id: 'lvlshift', name: tl('Adaptateur de niveau 3,3 V ↔ 5 V'), cat: tl('Communication'), pre: 'LS', build: lvlshift }
];
export const BY_ID = Object.fromEntries(LIBRARY.map(e => [e.id, e]));
