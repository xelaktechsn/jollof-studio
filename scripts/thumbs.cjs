// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pre-renders library thumbnails from the dev app into public/thumbs/{simple,real}/<id>.webp
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
// Régénère les vignettes livrées (public/thumbs) après un changement de modèles : lancer d'abord
// "npm run dev", puis "node scripts/thumbs.cjs" (nécessite playwright-core : npm i -D playwright-core).
const OUT = require('path').join(__dirname, '..', 'public', 'thumbs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext()).newPage();
  await p.goto('http://localhost:1420/?lang=fr'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('jollof-quality', 'standard'); }); await p.goto('http://localhost:1420/?lang=fr');
  await p.waitForSelector('#lib button'); await p.waitForTimeout(2000);
  for (const mode of ['simple', 'real']) {
    const res = await p.evaluate(async mode => {
      const cad = await import('/src/cad/library.js'); const th = await import('/src/library/thumbs.js'); const cat = await import('/src/library/catalog.js');
      if (mode === 'real') { await cad.loadCadLibrary(); cad.setRealistic(true); } else cad.setRealistic(false);
      const out = {}; for (const e of cat.LIBRARY) out[e.id] = th.renderThumbnail(e.id, mode); return out;
    }, mode);
    fs.mkdirSync(path.join(OUT, mode), { recursive: true });
    let n = 0, bytes = 0;
    for (const [id, url] of Object.entries(res)) { const buf = Buffer.from(url.split(',')[1], 'base64'); fs.writeFileSync(path.join(OUT, mode, id + '.webp'), buf); n++; bytes += buf.length; }
    console.log(mode, n, 'files', Math.round(bytes / 1024), 'KB');
  }
  await b.close();
})();
