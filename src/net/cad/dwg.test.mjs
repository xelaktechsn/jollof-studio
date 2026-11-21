// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du pont DWG (dwg.js) avec un faux pont Tauri : ordre des commandes, envoi par morceaux, flux lu par morceaux,
// annulation, nettoyage, version web.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _setBridge, convertDwg, canConvertDwg, dwgConverters, pickDwg, isDwgName } from './dwg.js';

/** Faux pont : un DXF de `size` octets, un convertisseur installé ou non, conversion qui attend `gate` si donné. */
function fake({ size = 20 << 20, converters = [{ id: 'oda', name: 'ODA File Converter', path: '/x', version: '25.12.0' }], gate = null, failWith = null, desktop = true } = {}) {
  const calls = [];
  let progressCh = null;
  const dxf = new Uint8Array(size).map((_, i) => i & 0xff);
  class Channel { constructor() { this.onmessage = null; } }
  const invoke = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    switch (cmd) {
      case 'cad_converters': return converters;
      case 'pick_open': return '/home/u/plan.dwg';
      case 'cad_begin': return 7;
      case 'cad_upload_write': return null;
      case 'cad_convert_dwg': {
        progressCh = args.onProgress;
        progressCh.onmessage({ stage: 'convert', ms: 250, bytes: 1000 });
        if (gate) await gate;
        if (calls.some(c => c.cmd === 'cad_cancel')) throw 'Conversion annulée';
        if (failWith) throw failWith;
        progressCh.onmessage({ stage: 'done', ms: 500, bytes: size });
        return { job: 7, converter: 'oda', version: '25.12.0', size, ms: 500, warning: null };
      }
      case 'cad_read': return dxf.slice(args.offset, args.offset + args.len).buffer;
      case 'cad_cancel': case 'cad_cleanup': return null;
      default: throw new Error('commande inattendue ' + cmd);
    }
  };
  _setBridge({ invoke, Channel, desktop: () => desktop });
  return { calls, dxf, count: cmd => calls.filter(c => c.cmd === cmd).length };
}
async function readAll(stream) {
  const parts = []; let n = 0;
  for (const r = stream.getReader(); ;) { const { done, value } = await r.read(); if (done) break; parts.push(value); n += value.length; }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('recognises DWG names', () => {
  assert.ok(isDwgName('Plan.DWG') && isDwgName('a.dwg'));
  assert.ok(!isDwgName('a.dxf') && !isDwgName('') && !isDwgName(null));
});

test('web build: no converter, conversion refused with code web', async () => {
  fake({ desktop: false });
  assert.equal(await canConvertDwg(), false);
  assert.deepEqual(await dwgConverters(), []);
  await assert.rejects(convertDwg('/a.dwg'), e => e.code === 'web');
  await assert.rejects(pickDwg(), e => e.code === 'web');
});

test('desktop without converter: code noconverter, nothing started', async () => {
  const f = fake({ converters: [] });
  assert.equal(await canConvertDwg(), false);
  await assert.rejects(convertDwg('/a.dwg'), e => e.code === 'noconverter');
  assert.equal(f.count('cad_begin'), 0);
});

test('path chosen in the dialog: converted, read back in chunks as a stream, then cleaned', async () => {
  const f = fake();
  assert.deepEqual(await pickDwg(), { path: '/home/u/plan.dwg', name: 'plan.dwg' });
  const prog = [];
  const r = await convertDwg('/home/u/plan.dwg', { onProgress: p => prog.push(p) });
  assert.equal(r.name, 'plan.dxf'); assert.equal(r.converter, 'oda'); assert.equal(r.size, f.dxf.length);
  const conv = f.calls.find(c => c.cmd === 'cad_convert_dwg').args;
  assert.equal(conv.job, 7); assert.equal(conv.path, '/home/u/plan.dwg'); assert.equal(conv.converter, 'auto');
  assert.equal(f.count('cad_upload_write'), 0);
  assert.ok(prog.some(p => p.stage === 'convert' && p.f === null && p.bytes === 1000));
  assert.ok(prog.some(p => p.stage === 'done' && p.f === 1));
  const bytes = await readAll(r.dxf);
  assert.deepEqual(bytes, f.dxf);
  // 20 Mo par morceaux de 8 Mo au plus : jamais tout d'un coup.
  const reads = f.calls.filter(c => c.cmd === 'cad_read');
  assert.equal(reads.length, 3);
  assert.ok(reads.every(c => c.args.len <= 8 << 20));
  assert.equal(f.count('cad_cleanup'), 1);
  await r.cleanup();
  assert.equal(f.count('cad_cleanup'), 1, 'cleanup idempotent');
});

test('dropped file: uploaded in positioned chunks, no path given to Rust', async () => {
  const f = fake({ size: 100 });
  const blob = new Blob([new Uint8Array((8 << 20) + 5)]);
  blob.name = 'drop.dwg';
  const prog = [];
  const r = await convertDwg(blob, { onProgress: p => prog.push(p) });
  const ups = f.calls.filter(c => c.cmd === 'cad_upload_write');
  assert.deepEqual(ups.map(c => c.opts.headers['x-pos']), ['0', String(8 << 20)]);
  assert.ok(ups.every(c => c.opts.headers['x-job'] === '7' && c.args instanceof Uint8Array));
  assert.equal(ups[1].args.length, 5);
  assert.equal(f.calls.find(c => c.cmd === 'cad_convert_dwg').args.path, null);
  assert.equal(prog.filter(p => p.stage === 'upload').at(-1).f, 1);
  assert.equal((await readAll(r.dxf)).length, 100);
});

test('abort during conversion: converter cancelled, AbortError, temp dir cleaned', async () => {
  let open; const gate = new Promise(res => { open = res; });
  const f = fake({ gate });
  const ac = new AbortController();
  const p = convertDwg('/a.dwg', { signal: ac.signal });
  await new Promise(res => setTimeout(res, 5));
  ac.abort(); open();
  await assert.rejects(p, e => e.name === 'AbortError' && e.code === 'aborted');
  assert.equal(f.count('cad_cancel'), 1);
  assert.equal(f.count('cad_cleanup'), 1);
});

test('converter failure: code failed with the message, cleaned', async () => {
  const f = fake({ failWith: "LibreDWG dwg2dxf n'a pas produit de DXF" });
  await assert.rejects(convertDwg('/a.dwg'), e => e.code === 'failed' && /dwg2dxf/.test(e.message));
  assert.equal(f.count('cad_cleanup'), 1);
});

test('stream cancelled by the reader: cleaned without reading the rest', async () => {
  const f = fake();
  const r = await convertDwg('/a.dwg');
  const rd = r.dxf.getReader();
  await rd.read();
  await rd.cancel();
  assert.equal(f.count('cad_cleanup'), 1);
  assert.ok(f.count('cad_read') <= 2);
});

test('unknown converter id falls back to auto', async () => {
  const f = fake();
  await (await convertDwg('/a.dwg', { converter: '/bin/sh' })).cleanup();
  assert.equal(f.calls.find(c => c.cmd === 'cad_convert_dwg').args.converter, 'auto');
});
