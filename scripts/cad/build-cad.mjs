// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Construit la bibliothèque CAO livrée avec Jollof Studio : télécharge les modèles STEP
// sous licence libre (usage commercial autorisé), les convertit en GLB légers (axes Y vers
// le haut, millimètres, une matière par couleur) et écrit le manifeste et les licences.
//
//   node scripts/cad/build-cad.mjs
//
// Sources retenues :
//  - Bibliothèque 3D KiCad : CC-BY-SA 4.0 (+ exception KiCad). Redistribution commerciale
//    permise avec attribution ; les modèles (et leurs conversions) restent sous CC-BY-SA 4.0.
//  - Adafruit_CAD_Parts : licence MIT.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'scripts/cad/.cache');
const OUT = path.join(ROOT, 'public/cad');
const KICAD = 'https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/';
const ADAFRUIT = 'https://raw.githubusercontent.com/adafruit/Adafruit_CAD_Parts/main/';
const K = (dir, file, title) => ({ url: KICAD + `${dir}.3dshapes/${file}.step`, license: 'CC-BY-SA-4.0', source: 'KiCad 3D library', author: 'KiCad Library Team', title, kicadUp: true });
const A = (dir, file, title, up = 'z') => ({ url: ADAFRUIT + encodeURIComponent(dir) + '/' + encodeURIComponent(file) + '.step', license: 'MIT', source: 'Adafruit_CAD_Parts', author: 'Adafruit Industries', title, up });

/** Modèles livrés : identifiant → source. */
export const MODELS = {
  'esp32-wroom-32': K('RF_Module', 'ESP32-WROOM-32', 'Module ESP32-WROOM-32'),
  'esp-12e': K('RF_Module', 'ESP-12E', 'Module ESP-12E (ESP8266)'),
  // Le STEP de la Pico n'a pas de couleurs : on les déduit de la géométrie (Y vers le haut, mm).
  'rpi-pico': { ...K('Module', 'RaspberryPi_Pico', 'Raspberry Pi Pico'), paint: (x, y, z) => (y <= 1.05 ? [0.13, 0.43, 0.24] : z < -23 ? [0.75, 0.76, 0.78] : [0.11, 0.11, 0.12]) },
  'dht11': K('Sensor', 'Aosong_DHT11_5.5x12.0_P2.54mm', 'Capteur DHT11'),
  'led-5mm-red': K('LED_THT', 'LED_D5.0mm', 'LED 5 mm rouge'),
  'led-5mm-green': K('LED_THT', 'LED_D5.0mm_Green', 'LED 5 mm verte'),
  'led-5mm-blue': K('LED_THT', 'LED_D5.0mm_Blue', 'LED 5 mm bleue'),
  'led-5mm-yellow': K('LED_THT', 'LED_D5.0mm_Yellow', 'LED 5 mm jaune'),
  'led-5mm-clear': K('LED_THT', 'LED_D5.0mm_Clear', 'LED 5 mm blanche'),
  'led-5mm-rgb': K('LED_THT', 'LED_D5.0mm-4_RGB', 'LED RGB 5 mm'),
  'resistor-axial': K('Resistor_THT', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', 'Résistance axiale 1/4 W'),
  'diode-do41': K('Diode_THT', 'D_DO-41_SOD81_P10.16mm_Horizontal', 'Diode DO-41'),
  'cap-radial': K('Capacitor_THT', 'CP_Radial_D6.3mm_P2.50mm', 'Condensateur électrolytique'),
  'cap-disc': K('Capacitor_THT', 'C_Disc_D5.0mm_W2.5mm_P2.50mm', 'Condensateur céramique'),
  'to-92': K('Package_TO_SOT_THT', 'TO-92_Inline', 'Boîtier TO-92'),
  'buzzer-12mm': K('Buzzer_Beeper', 'Buzzer_12x9.5RM7.6', 'Buzzer 12 mm'),
  'button-6mm': K('Button_Switch_THT', 'SW_PUSH_6mm', 'Bouton poussoir 6 mm'),
  'usb-micro-b': K('Connector_USB', 'USB_Micro-B_Molex_47346-0001', 'Connecteur micro-USB'),
  'usb-mini-b': K('Connector_USB', 'USB_Mini-B_Lumberg_2486_01_Horizontal', 'Connecteur mini-USB'),
  'barrel-jack': K('Connector_BarrelJack', 'BarrelJack_Horizontal', 'Prise jack d’alimentation'),
  'dip-28': K('Package_DIP', 'DIP-28_W7.62mm', 'Boîtier DIP-28 (ATmega328P)'),
  'crystal-hc49': K('Crystal', 'Crystal_HC49-U_Vertical', 'Quartz HC-49'),
  'battery-9v': A('1321 Battery 9V', '1321 Battery 9V', 'Pile 9 V'),
  'pot-10k': A('562 10K Potentiometer', '562 10K Potentiometer', 'Potentiomètre 10 kΩ')
};

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const pad4 = n => (n + 3) & ~3;

/** Écrit un GLB minimal : un maillage par couleur, positions + normales + indices. */
function writeGlb(groups) {
  const json = { asset: { version: '2.0', generator: 'Jollof Studio build-cad' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let offset = 0;
  const view = (data, target) => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes); const padLen = pad4(bytes.length) - bytes.length;
    if (padLen) chunks.push(Buffer.alloc(padLen)); offset += pad4(bytes.length);
    return json.bufferViews.length - 1;
  };
  groups.forEach((g, i) => {
    const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor);
    const idx = pos.length / 3 < 65536 ? new Uint16Array(g.idx) : new Uint32Array(g.idx);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[k + a]); max[a] = Math.max(max[a], pos[k + a]); }
    const pv = view(pos, 34962), nv = view(nor, 34962), iv = view(idx, 34963);
    json.accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    json.accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    json.accessors.push({ bufferView: iv, componentType: idx instanceof Uint16Array ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    const [r, gg, b] = g.color, grey = Math.abs(r - gg) < 0.06 && Math.abs(gg - b) < 0.06, bright = (r + gg + b) / 3;
    const metal = grey && bright > 0.55 || (r > 0.7 && gg > 0.55 && b < 0.4); // argent ou doré : métal
    json.materials.push({ name: `c${i}`, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [srgbToLinear(r), srgbToLinear(gg), srgbToLinear(b), 1], metallicFactor: metal ? 0.75 : 0, roughnessFactor: metal ? 0.35 : 0.6 } });
    json.meshes.push({ primitives: [{ attributes: { POSITION: 3 * i, NORMAL: 3 * i + 1 }, indices: 3 * i + 2, material: i }] });
    json.nodes.push({ mesh: i }); json.scenes[0].nodes.push(i);
  });
  json.buffers.push({ byteLength: offset });
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]);
}

/** STEP → groupes de triangles par couleur, convertis en Y vers le haut. */
function convert(occt, buf, up, paint) {
  const r = occt.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0015, angularDeflection: 0.4 });
  if (!r.success) throw new Error('lecture STEP impossible');
  const groups = new Map();
  const tf = up === 'y' ? (x, y, z) => [x, y, z] : (x, y, z) => [x, z, -y]; // Z vers le haut → Y vers le haut
  for (const m of r.meshes) {
    const p = m.attributes.position.array, n = m.attributes.normal ? m.attributes.normal.array : null, idx = m.index.array;
    const faces = m.brep_faces && m.brep_faces.length ? m.brep_faces : [{ first: 0, last: idx.length / 3 - 1, color: null }];
    for (const f of faces) {
      const base = f.color || m.color || [0.62, 0.62, 0.62];
      const group = col => {
        const key = col.map(v => v.toFixed(3)).join(',');
        if (!groups.has(key)) groups.set(key, { color: col, pos: [], nor: [], idx: [], map: new Map() });
        return groups.get(key);
      };
      for (let t = f.first; t <= f.last; t++) {
        let g = group(base);
        if (paint) { // couleur choisie d'après le centre du triangle
          const c = [0, 1, 2].map(k => tf(p[idx[t * 3 + k] * 3], p[idx[t * 3 + k] * 3 + 1], p[idx[t * 3 + k] * 3 + 2]));
          g = group(paint((c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3, (c[0][2] + c[1][2] + c[2][2]) / 3));
        }
        for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        let ni = g.map.get(v);
        if (ni === undefined) {
          ni = g.pos.length / 3; g.map.set(v, ni);
          g.pos.push(...tf(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]));
          g.nor.push(...(n ? tf(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) : [0, 1, 0]));
        }
        g.idx.push(ni);
        }
      }
      groups.forEach(g => { g.map = new Map(); }); // les sommets ne se partagent qu'à l'intérieur d'une face
    }
  }
  return [...groups.values()];
}

async function main() {
  const occt = await (await import(path.join(ROOT, 'node_modules/occt-import-js/dist/occt-import-js.js'))).default();
  fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  for (const [id, m] of Object.entries(MODELS)) {
    const cached = path.join(CACHE, id + '.step');
    if (!fs.existsSync(cached)) {
      const res = await fetch(m.url);
      if (!res.ok) { console.warn(`✗ ${id} : ${res.status} ${m.url}`); continue; }
      fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
    }
    const groups = convert(occt, fs.readFileSync(cached), m.up || 'z', m.paint);
    const glb = writeGlb(groups);
    fs.writeFileSync(path.join(OUT, id + '.glb'), glb);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    groups.forEach(g => { for (let k = 0; k < g.pos.length; k += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], g.pos[k + a]); max[a] = Math.max(max[a], g.pos[k + a]); } });
    const tris = groups.reduce((s, g) => s + g.idx.length / 3, 0);
    manifest[id] = { file: id + '.glb', title: m.title, license: m.license, source: m.source, author: m.author, url: m.url, min: min.map(v => +v.toFixed(3)), max: max.map(v => +v.toFixed(3)), tris };
    console.log(`✓ ${id.padEnd(16)} ${String(tris).padStart(6)} triangles  ${(glb.length / 1024).toFixed(0).padStart(5)} Ko  ${groups.length} matières`);
  }
  fs.writeFileSync(path.join(OUT, 'models.json'), JSON.stringify(manifest, null, 1) + '\n');
  // Licences et attributions, livrées avec les modèles.
  const rows = Object.entries(manifest).map(([id, m]) => `| \`${id}.glb\` | ${m.title} | ${m.author} — ${m.source} | ${m.license} | ${m.url} |`).join('\n');
  fs.writeFileSync(path.join(OUT, 'LICENSES.md'), `# Modèles 3D livrés avec Jollof Studio

Ces modèles sont des conversions (STEP → GLB, axes et matières adaptés) de modèles publiés sous licence libre autorisant la redistribution, y compris commerciale.

- **CC-BY-SA-4.0** : bibliothèque 3D KiCad, © KiCad Library Team, https://creativecommons.org/licenses/by-sa/4.0/ (avec l’exception KiCad, voir LICENSE-KiCad.md). Les fichiers convertis restent sous CC-BY-SA 4.0.
- **MIT** : Adafruit_CAD_Parts, © Adafruit Industries (voir LICENSE-Adafruit.txt).

| Fichier | Modèle | Auteur — source | Licence | Original |
|---|---|---|---|---|
${rows}
`);
  for (const [name, url] of [['LICENSE-KiCad.md', KICAD + 'LICENSE.md'], ['LICENSE-Adafruit.txt', ADAFRUIT + 'LICENSE']]) {
    const res = await fetch(url); if (res.ok) fs.writeFileSync(path.join(OUT, name), Buffer.from(await res.arrayBuffer()));
  }
  console.log(`\n${Object.keys(manifest).length} modèles → public/cad/`);
}
main().catch(e => { console.error(e); process.exit(1); });
