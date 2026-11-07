// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Port série vers une carte réelle : dans l'application, par les commandes Rust (serial.rs) ; dans Chrome ou
// Edge, par Web Serial (l'utilisateur choisit le port dans la fenêtre du navigateur). Rend un transport
// { write(octets), onData(fn), reset(), close() } pour le client Firmata.
import { invoke, Channel } from '@tauri-apps/api/core';
import { isTauri } from '../native.js';

export const webSerial = () => typeof navigator !== 'undefined' && !!navigator.serial;
/** Ports disponibles (application) : [{ name, label }] ; dans un navigateur, la liste vient au moment d'ouvrir. */
export async function listPorts() {
  if (!isTauri()) return [];
  const all = await invoke('serial_list');
  // Cartes Arduino et convertisseurs USB-série d'abord ; le reste (Bluetooth…) ensuite.
  return all.sort((a, b) => (a.kind === 'usb' ? 0 : 1) - (b.kind === 'usb' ? 0 : 1)).map(p => ({ name: p.name, label: [p.name.replace(/^\/dev\//, ''), p.product || p.manufacturer].filter(Boolean).join(' · ') }));
}

export async function openPort(name, baud = 57600) {
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
  const port = await navigator.serial.requestPort();
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
