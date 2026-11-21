// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Tests du chemin d'enregistrement et d'ouverture de native.js avec un faux cœur Rust (mêmes règles que
// src-tauri/src/files.rs et lib.rs : chemins autorisés par les boîtes de dialogue, écriture par morceaux dans un
// temporaire renommé à la fin, lecture par morceaux) : projet réseau avec fond de plan enregistré puis rouvert,
// fichier reçu du système (double-clic sur un .jollof), échecs qui laissent l'ancien fichier intact.
import test from 'node:test';
import assert from 'node:assert/strict';

/** Faux cœur : disque en mémoire, autorisations, journal des appels. */
function core({ failChunkAt = -1 } = {}) {
  const disk = new Map(), grants = new Set(), calls = [], writes = new Map();
  let next = 0, pickPath = null, launch = null;
  const allowed = p => { if (!grants.has(p)) throw 'Emplacement non autorisé : choisissez-le dans la boîte de dialogue'; };
  const raw = b => (b instanceof Uint8Array ? b : new Uint8Array(b));
  const cat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  const api = {
    async invoke(cmd, args, opts) {
      calls.push({ cmd, args: cmd.includes('chunk') || cmd === 'save_bytes' ? { len: raw(args).length } : args, headers: opts && opts.headers });
      switch (cmd) {
        case 'pick_save': case 'pick_open': if (pickPath) grants.add(pickPath); return pickPath;
        case 'take_launch_file': { const p = launch; launch = null; return p; }
        case 'save_bytes': { const p = decodeURIComponent(opts.headers['x-path']); allowed(p); disk.set(p, raw(args).slice()); return raw(args).length; }
        case 'file_write_begin': allowed(args.path); writes.set(++next, { path: args.path, parts: [], len: 0 }); return next;
        case 'file_write_chunk': {
          const w = writes.get(+opts.headers['x-id']); if (!w) throw 'Enregistrement inconnu ou abandonné';
          if (+opts.headers['x-pos'] !== w.len) throw 'Morceau hors d’ordre';
          if (w.parts.length === failChunkAt) throw 'Disque plein : libérez de la place puis réessayez';
          w.parts.push(raw(args).slice()); w.len += raw(args).length; return null;
        }
        case 'file_write_commit': { const w = writes.get(args.id); writes.delete(args.id); if (w.len !== args.size) throw 'Enregistrement incomplet'; disk.set(w.path, cat(w.parts)); return w.len; }
        case 'file_write_abort': writes.delete(args.id); return null;
        case 'file_size': allowed(args.path); return disk.get(args.path).length;
        case 'read_text': allowed(args.path); return new TextDecoder().decode(disk.get(args.path));
        case 'file_read_chunk': { allowed(args.path); const d = disk.get(args.path); assert.ok(args.len <= 16 << 20); return d.slice(args.offset, args.offset + args.len).buffer; }
        default: throw new Error('commande inattendue ' + cmd);
      }
    },
    transformCallback: () => 0
  };
  globalThis.window = { __TAURI_INTERNALS__: api };
  return {
    disk, grants, calls, writes,
    pick(p) { pickPath = p; }, launch(p) { launch = p; grants.add(p); },
    count: c => calls.filter(x => x.cmd === c).length
  };
}
const native = await import('./native.js');
const { cleanNet } = await import('./net/clean.js');

/** Projet réseau avec un étage, un fond de plan et ses données binaires (~24 Mo de base64 : bien au-delà d'un appel). */
function netProject() {
  const b64 = Buffer.alloc(18 << 20, 7).toString('base64');
  const net = {
    site: { name: 'Site', buildings: [{ id: 'b1', name: 'B', floors: [{ id: 'f1', name: 'RDC' }] }] },
    underlays: { f1: { id: 'cad1', name: 'plan.dxf', on: true, source: { file: 'plan.dxf', units: 'm' }, origin: [1000.5, 2000.25], toMetre: 1, region: [0, 0, 50, 30], transform: { dx: 1, dy: 2, rot: 0, scale: 1 }, layers: [{ id: 0, name: 'MURS', color: '#ff0000', on: true }] } },
    blobs: { cad1: 'data:application/octet-stream;base64,' + b64 },
    devices: [], cables: []
  };
  return { name: 'Réseau é', comps: [], wires: [], settings: { kind: 'net', modules: { net } } };
}

test('network project with an underlay: saved in chunks, reopened identical, underlay data kept', async () => {
  const c = core();
  const proj = netProject();
  const before = cleanNet(proj.settings.modules.net);
  assert.ok(before.blobs.cad1 && before.underlays.f1, 'le fond de plan est un modèle valable');
  const json = JSON.stringify(proj, null, 1);
  c.pick('/home/u/Réseau é.jollof');
  const res = await native.saveProject(json, null, 'Réseau é.jollof');
  assert.deepEqual(res, { path: '/home/u/Réseau é.jollof', name: 'Réseau é.jollof' });
  // Par morceaux de 8 Mo, positions consécutives, puis remplacement d'un coup ; jamais save_text ni save_bytes.
  const chunks = c.calls.filter(x => x.cmd === 'file_write_chunk');
  assert.ok(chunks.length >= 3);
  assert.deepEqual(chunks.map(x => +x.headers['x-pos']), chunks.map((_, i) => i * (8 << 20)));
  assert.equal(c.count('file_write_commit'), 1);
  assert.equal(c.count('save_bytes') + c.count('save_text'), 0);
  assert.equal(c.writes.size, 0);
  // Réouverture par la boîte « Ouvrir » : lecture par morceaux (plus de limite d'un seul appel), texte identique.
  const f = await native.openProject();
  assert.equal(f.name, 'Réseau é.jollof');
  assert.ok(c.count('file_read_chunk') >= 2);
  assert.equal(c.count('read_text'), 0);
  assert.equal(f.text, json);
  const after = cleanNet(JSON.parse(f.text).settings.modules.net);
  assert.equal(after.blobs.cad1, before.blobs.cad1);
  assert.deepEqual(after.underlays, before.underlays);
});

test('“Save” again over the same path: no dialog, file replaced', async () => {
  const c = core();
  c.pick('/p/a.jollof');
  await native.saveProject('{"comps":[],"v":1}', null, 'a.jollof');
  c.pick(null);
  await native.saveProject('{"comps":[],"v":2}', '/p/a.jollof', 'a.jollof');
  assert.equal(c.count('pick_save'), 1);
  assert.equal(new TextDecoder().decode(c.disk.get('/p/a.jollof')), '{"comps":[],"v":2}');
});

test('path no longer allowed: the dialog asks again; a disk error is reported, not re-asked', async () => {
  const c = core();
  c.pick('/p/new.jollof');
  const r = await native.saveProject('{"comps":[]}', '/old/place.jollof', 'place.jollof');
  assert.equal(r.path, '/p/new.jollof');
  assert.equal(c.count('pick_save'), 1);
  const c2 = core({ failChunkAt: 1 });
  c2.grants.add('/p/x.jollof'); c2.disk.set('/p/x.jollof', new TextEncoder().encode('ancien'));
  await assert.rejects(native.saveProject('x'.repeat(10 << 20), '/p/x.jollof', 'x.jollof'), /Disque plein/);
  assert.equal(c2.count('pick_save'), 0);
  assert.equal(c2.count('file_write_abort'), 1);
  assert.equal(new TextDecoder().decode(c2.disk.get('/p/x.jollof')), 'ancien', 'l’ancien fichier reste intact');
});

test('exports (DXF, CSV…) go through the native save dialog with the type filter; big ones in chunks', async () => {
  const c = core();
  c.pick('/out/plan.dxf');
  const dxf = '  0\nSECTION\n' + 'x'.repeat(12 << 20) + '\n  0\nEOF\n';
  assert.equal(await native.saveFile(new Blob([dxf]), 'plan.dxf', 'Dessin DXF', 'dxf'), '/out/plan.dxf');
  const pick = c.calls.find(x => x.cmd === 'pick_save').args;
  assert.deepEqual(pick, { name: 'plan.dxf', label: 'Dessin DXF', extensions: ['dxf'] });
  assert.equal(c.disk.get('/out/plan.dxf').length, new TextEncoder().encode(dxf).length);
  assert.equal(c.count('file_write_chunk'), 2);
  c.pick('/out/t.csv');
  await native.saveFile(new Blob(['a;b\n1;2\n']), 't.csv', 'Tableau CSV', 'csv');
  assert.equal(c.count('save_bytes'), 1, 'petit fichier : un seul appel (écriture atomique côté Rust)');
  c.pick(null);
  assert.equal(await native.saveFile(new Blob(['x']), 'y.csv', 'CSV', 'csv'), null, 'annulé : rien d’écrit');
});

test('file association: a .jollof received from the system opens through the same reading path', async () => {
  const c = core();
  const big = JSON.stringify(netProject());
  c.disk.set('/Users/u/Projet.jollof', new TextEncoder().encode(big));
  c.launch('/Users/u/Projet.jollof');
  const f = await native.takeLaunchFile();
  assert.equal(f.name, 'Projet.jollof'); assert.equal(f.path, '/Users/u/Projet.jollof');
  assert.equal(f.text, big);
  assert.equal(await native.takeLaunchFile(), null, 'une seule fois');
  c.disk.set('/Users/u/petit.jollof', new TextEncoder().encode('{"comps":[]}'));
  c.launch('/Users/u/petit.jollof');
  assert.equal((await native.takeLaunchFile()).text, '{"comps":[]}');
});

test('web build: project and exports fall back to a download', async () => {
  const clicks = [];
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }), body: { appendChild() {} } };
  const URL0 = globalThis.URL;
  globalThis.URL = Object.assign(class extends URL0 {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  try {
    assert.deepEqual(await native.saveProject('{}', null, 'a.jollof'), { path: null, name: 'a.jollof' });
    assert.equal(await native.saveFile(new Blob(['x']), 'b.dxf', 'DXF', 'dxf'), 'b.dxf');
    assert.deepEqual(clicks, ['a.jollof', 'b.dxf']);
  } finally { globalThis.URL = URL0; delete globalThis.document; }
});
