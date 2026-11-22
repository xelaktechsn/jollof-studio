// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Site d'aide : conversion du Markdown du guide, découpage en pages, index de recherche. node --test scripts/help-site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slug, plain, inline, render, split, build } from './help-site.mjs';

test('slug : sans accents, tirets, jamais vide', () => {
  assert.equal(slug('Le vérificateur : « le Rust de l’électronique »'), 'le-verificateur-le-rust-de-l-electronique');
  assert.equal(slug('…'), 'section');
});
test('inline : code protégé, liens du dépôt vers GitHub, HTML échappé', () => {
  assert.equal(inline('**a** `<b>` *i*'), '<strong>a</strong> <code>&lt;b&gt;</code> <em>i</em>');
  assert.match(inline('[x](../LICENSE)'), /href="https:\/\/github\.com\/[^"]+\/blob\/main\/LICENSE"/);
  assert.match(inline('[x](PROVEN.md)'), /blob\/main\/docs\/PROVEN\.md/);
  assert.match(inline('[x](../server/)'), /tree\/main\/server"/);
  assert.equal(inline('<script>'), '&lt;script&gt;');
  assert.equal(plain('**a** [b](c) `d`'), 'a b d');
});
test('render : listes imbriquées, tableau, code, ancres uniques', () => {
  const r = render('### Titre\n\n- **Un** : a\n  - b\n- deux\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\na < b\n```\n\n### Titre\n');
  assert.match(r.html, /<ul><li id="un"><strong>Un<\/strong> : a<ul><li>b<\/li><\/ul><\/li><li>deux<\/li><\/ul>/);
  assert.match(r.html, /<th scope="col">A<\/th>/);
  assert.match(r.html, /<pre tabindex="0" data-lang="js"><code>a &lt; b<\/code><\/pre>/);
  assert.deepEqual(r.heads.map(h => h.id), ['titre', 'titre-2']);
  assert.ok(r.chunks.some(c => c.id === 'un' && /a b/.test(c.text)));
});
test('split : une page par « ## », un « ## » dans un bloc de code ne coupe pas', () => {
  const { docTitle, pages } = split('# Guide\n\nintro\n\n## A\n\n```\n## pas un titre\n```\n\n## B\n\nb\n');
  assert.equal(docTitle, 'Guide');
  assert.deepEqual(pages.map(p => p.file), ['index.html', 'a.html', 'b.html']);
});
test('build : le guide réel donne des pages liées et un index', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aide-'));
  try {
    const r = build(out);
    assert.ok(r.pages > 5 && r.entries > r.pages);
    const files = fs.readdirSync(out), html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    for (const f of ['index.html', 'aide.css', 'aide.js', 'search-index.js']) assert.ok(files.includes(f), f);
    for (const m of html.matchAll(/<a href="([a-z0-9-]+\.html)"/g)) assert.ok(files.includes(m[1]), m[1]);
    assert.ok(!/https?:\/\/[^"]*\.(js|css)"/.test(html), 'aucun script ni feuille extérieurs');
    const idx = JSON.parse(fs.readFileSync(path.join(out, 'search-index.js'), 'utf8').replace(/^window\.AIDE_INDEX=/, '').replace(/;\s*$/, ''));
    assert.ok(idx.every(e => e.u && e.t && e.p));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
