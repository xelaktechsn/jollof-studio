// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Port série vers une carte réelle : dans l'application, par les commandes Rust (serial.rs) ; dans Chrome ou
// Edge, par Web Serial (l'utilisateur choisit le port dans la fenêtre du navigateur). Rend un transport
// { write(octets), onData(fn), reset(), close() } pour le client Firmata.
import { invoke, Channel } from '@tauri-apps/api/core';
import { isTauri } from '../native.js';
import { tl } from '../i18n/index.js';

export const webSerial = () => typeof navigator !== 'undefined' && !!navigator.serial;
/** Tests de l'interface (développement seulement) : un faux port série remplace la carte (globalThis.__serialMock). */
const mock = () => (typeof globalThis !== 'undefined' && globalThis.__serialMock) || null;

/** Débits proposés (ceux du moniteur série de l'IDE Arduino) ; serial.rs accepte les mêmes. */
export const BAUDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 921600];

/**
 * Ce que l'on reconnaît d'une carte à son identifiant USB (fabricant, produit) : son nom, ou la puce USB-série qui
 * la relie (une carte compatible Uno ou un ESP32 de marque inconnue passent par un CH340 ou un CP210x).
 */
const USB = [
  [0x2341, 0x0043, 'Arduino Uno', 'uno'], [0x2341, 0x0001, 'Arduino Uno', 'uno'], [0x2a03, 0x0043, 'Arduino Uno', 'uno'], [0x2341, 0x0243, 'Arduino Uno', 'uno'],
  [0x2341, 0x0042, 'Arduino Mega 2560', 'mega'], [0x2341, 0x0010, 'Arduino Mega 2560', 'mega'], [0x2a03, 0x0042, 'Arduino Mega 2560', 'mega'],
  [0x2341, 0x0058, 'Arduino Nano Every', 'nano'], [0x2341, null, 'Arduino', null], [0x2a03, null, 'Arduino', null],
  [0x1a86, null, 'CH340 (Uno ou Nano compatible, NodeMCU…)', null], [0x10c4, null, 'CP210x (ESP32, NodeMCU…)', null], [0x0403, null, 'FTDI (Nano, adaptateur USB-série…)', 'nano'],
  [0x303a, 0x1001, 'ESP32-S3 ou ESP32-C3 (USB natif)', null], [0x303a, null, 'ESP32-S3 ou ESP32-C3 (USB natif)', null], [0x2e8a, null, 'Raspberry Pi Pico', 'pico'], [0x239a, null, 'Adafruit', null]
];
export function usbBoard(vid, pid) {
  if (vid == null) return null;
  const hit = USB.find(([v, p]) => v === vid && (p == null || p === pid));
  return hit ? { name: tl(hit[2]), kind: hit[3] } : null;
}
/**
 * Ports disponibles (application) : [{ name, label, usb }], en quelques millisecondes (IOKit, udev, registre de
 * Windows) ; dans un navigateur, la liste vient au moment d'ouvrir.
 */
export async function listPorts() {
  if (mock()) return mock().list();
  if (!isTauri()) return [];
  const all = await invoke('serial_list'), names = new Set(all.map(p => p.name));
  // macOS montre chaque port deux fois : /dev/cu.X, à ouvrir, et /dev/tty.X, qui attend la ligne DCD et bloque.
  const dup = p => p.name.startsWith('/dev/tty.') && names.has(p.name.replace('/dev/tty.', '/dev/cu.'));
  // Cartes Arduino et convertisseurs USB-série d'abord ; le reste (Bluetooth…) ensuite.
  return all.filter(p => !dup(p)).sort((a, b) => (a.kind === 'usb' ? 0 : 1) - (b.kind === 'usb' ? 0 : 1))
    .map(p => {
      const known = usbBoard(p.vid, p.pid);
      return { name: p.name, usb: p.kind === 'usb', kind: p.kind, board: known, label: [p.name.replace(/^\/dev\//, ''), known ? known.name : p.product || p.manufacturer].filter(Boolean).join(' · ') };
    });
}

/**
 * Ouvre le port. Navigateur : la fenêtre de choix du port s'ouvre, sauf si reuse et qu'un port a déjà été autorisé
 * (reconnexion après un débranchement, sans redemander).
 */
export async function openPort(name, baud = 57600, { reuse = false } = {}) {
  if (mock()) return mock().open(name, baud);
  let sink = () => {}, closed = () => {};
  if (isTauri()) {
    const ch = new Channel();
    ch.onmessage = bytes => { if (!bytes.length) closed(); else sink(bytes); };
    const id = await invoke('serial_open', { name, baud, onData: ch });
    return {
      write: bytes => invoke('serial_write', { id, bytes: Array.from(bytes) }).catch(() => closed()),
      onData: fn => { sink = fn; }, onClose: fn => { closed = fn; },
      reset: () => invoke('serial_reset', { id }).catch(() => {}),
      close: () => invoke('serial_close', { id }).catch(() => {})
    };
  }
  const granted = reuse && navigator.serial.getPorts ? await navigator.serial.getPorts() : [];
  const port = granted.length ? granted[0] : await navigator.serial.requestPort();
  await port.open({ baudRate: baud });
  const writer = port.writable.getWriter();
  let reader = null, alive = true;
  (async () => {
    while (alive && port.readable) {
      reader = port.readable.getReader();
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) sink(value); } } catch (e) { /* carte débranchée */ } finally { reader.releaseLock(); }
      if (alive) { alive = false; closed(); }
    }
  })();
  return {
    write: bytes => writer.write(Uint8Array.from(bytes)).catch(() => closed()),
    onData: fn => { sink = fn; }, onClose: fn => { closed = fn; },
    reset: async () => { try { await port.setSignals({ dataTerminalReady: false }); await new Promise(r => setTimeout(r, 50)); await port.setSignals({ dataTerminalReady: true }); } catch (e) { /* signal non géré */ } },
    close: async () => { alive = false; try { if (reader) await reader.cancel(); writer.releaseLock(); await port.close(); } catch (e) { /* déjà fermé */ } }
  };
}

/**
 * Un seul utilisateur à la fois par port (moniteur série, carte réelle Firmata, téléversement) : qui le demande
 * le prend, l'utilisateur précédent est prévenu par sa fonction release() et le libère.
 */
const owners = new Map();
export async function claim(name, who, release) {
  const key = name || 'web', o = owners.get(key);
  if (o && o.who !== who) { owners.delete(key); try { await o.release(who); } catch (e) { /* déjà libéré */ } }
  owners.set(key, { who, release });
}
export function unclaim(name, who) { const key = name || 'web', o = owners.get(key); if (o && o.who === who) owners.delete(key); }
export const ownerOf = name => (owners.get(name || 'web') || {}).who || null;
