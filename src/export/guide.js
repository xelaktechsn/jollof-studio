// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Guide de montage : une page HTML autonome (images incluses) qui se lit à l'écran et s'imprime,
// une étape par fil, dans l'ordre du câblage. Module pur : main.js prend les images de la scène
// et donne les textes ; ici, seulement la mise en page. Tout texte reçu est échappé.
import { tl } from '../i18n/index.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = c => (/^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : '#888888');
const img = (src, alt) => (typeof src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? `<img src="${src}" alt="${esc(alt)}">` : '');

/** Matériel : composants regroupés par modèle, dans l'ordre où ils apparaissent. [{ name, refs }] */
export function billOf(comps) {
  const by = new Map();
  for (const c of comps) { const k = c.model || c.name; if (!by.has(k)) by.set(k, []); by.get(k).push(c.name); }
  return [...by].map(([name, refs]) => ({ name, refs }));
}
/** Fils par couleur : [{ color, name, n }], les plus nombreux d'abord. */
export function wireCount(steps) {
  const by = new Map();
  for (const s of steps) { const k = hex(s.color); const e = by.get(k) || { color: k, name: s.colorName || '', n: 0 }; e.n++; by.set(k, e); }
  return [...by.values()].sort((a, b) => b.n - a.n);
}
/** Phrase d'une étape. */
export function stepText(s) {
  const wire = s.colorName ? tl('un fil {0}', s.colorName.toLowerCase()) : tl('un fil');
  return tl('Reliez {0}, broche {1}, à {2}, broche {3}, avec {4}.', s.a.comp, s.a.pin, s.b.comp, s.b.pin, wire);
}

/**
 * Page du guide.
 * o : { title, lang, date, cover, comps: [{ name, model }], steps: [{ img, a: { comp, pin }, b: { comp, pin }, color, colorName, role }],
 *       issues: [{ level: 'error' | 'warning', text }], checked: bool (le vérificateur a tourné), program: bool, footer }
 */
export function guideHtml(o) {
  const steps = o.steps || [], bill = billOf(o.comps || []), wires = wireCount(steps), n = steps.length;
  const issues = (o.issues || []).slice(0, 12), errs = issues.filter(i => i.level === 'error').length;
  const check = !o.checked ? '' : `<section class="chk ${errs ? 'err' : issues.length ? 'warn' : 'ok'}"><h2>${esc(tl('Vérification du montage'))}</h2>${issues.length
    ? `<ul>${issues.map(i => `<li><b>${esc(i.level === 'error' ? tl('Erreur') : tl('Avertissement'))}</b> ${esc(i.text)}</li>`).join('')}</ul>`
    : `<p>${esc(tl('Aucun problème détecté : tensions, courants et branchements sont cohérents.'))}</p>`}</section>`;
  const step = (s, i) => `<section class="step"><div class="pic">${img(s.img, tl('Étape {0}', i + 1))}</div>
    <div class="txt"><h3><span class="box"></span>${esc(tl('Étape {0} sur {1}', i + 1, n))}</h3>
    <p class="do"><i class="sw" style="background:${hex(s.color)}"></i>${esc(stepText(s))}</p>
    <table class="ends"><tr><th>${esc(s.a.comp)}</th><td>${esc(s.a.pin)}</td><td class="ar">→</td><th>${esc(s.b.comp)}</th><td>${esc(s.b.pin)}</td></tr></table>
    ${s.role ? `<p class="why">${esc(s.role)}</p>` : ''}</div></section>`;
  return `<!doctype html>
<html lang="${esc(o.lang || 'fr')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tl('{0} — guide de montage', o.title))}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 960px; padding: 24px 16px 48px; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #15191d; background: #fff; }
h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 0 0 8px; } h3 { font-size: 16px; margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
.sub { color: #5b6670; margin: 0 0 16px; }
img { display: block; width: 100%; height: auto; border-radius: 8px; border: 1px solid #dde2e8; background: #0f1316; }
section { margin: 0 0 20px; break-inside: avoid; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e6eaee; font-weight: 500; }
th { font-weight: 600; } td.n { text-align: right; width: 3em; color: #5b6670; } td.refs { color: #5b6670; font-size: 13px; }
.sw { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1px solid #0003; margin-right: 8px; vertical-align: -1px; }
.chk { border: 1px solid #dde2e8; border-left-width: 4px; border-radius: 6px; padding: 10px 14px; } .chk ul { margin: 0; padding-left: 18px; } .chk p { margin: 0; }
.chk.ok { border-left-color: #2f9e6b; } .chk.warn { border-left-color: #d98a1f; } .chk.err { border-left-color: #d6453d; }
.step { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; align-items: start; padding-top: 16px; border-top: 1px solid #e6eaee; }
.box { display: inline-block; width: 16px; height: 16px; border: 2px solid #15191d; border-radius: 3px; }
.do { margin: 0 0 8px; font-size: 16px; } .why { margin: 8px 0 0; color: #5b6670; font-size: 13.5px; }
.ends th, .ends td { border: 0; padding: 2px 6px 2px 0; width: auto; } .ends td { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f1f4f7; border-radius: 4px; padding: 1px 6px; } .ends td.ar { background: none; }
footer { color: #5b6670; font-size: 12.5px; border-top: 1px solid #e6eaee; padding-top: 10px; margin-top: 28px; }
@media (max-width: 640px) { .cols, .step { grid-template-columns: 1fr; } }
@page { size: A4; margin: 14mm; }
@media print { body { max-width: none; padding: 0; font-size: 12pt; } .step { break-inside: avoid; } .cover { break-after: page; } img { border-color: #999; } }
</style></head><body>
<section class="cover"><h1>${esc(o.title)}</h1><p class="sub">${esc(tl('Guide de montage · {0} composant(s) · {1} fil(s)', (o.comps || []).length, n))}${o.date ? ' · ' + esc(o.date) : ''}</p>
${img(o.cover, tl('Montage terminé'))}</section>
<div class="cols"><section><h2>${esc(tl('Matériel'))}</h2><table>${bill.map(b => `<tr><td class="n">${b.refs.length} ×</td><th>${esc(b.name)}</th><td class="refs">${esc(b.refs.join(', '))}</td></tr>`).join('')}</table></section>
<section><h2>${esc(tl('Fils'))}</h2><table>${wires.map(w => `<tr><td class="n">${w.n} ×</td><th><i class="sw" style="background:${w.color}"></i>${esc(w.name || w.color)}</th></tr>`).join('')}</table></section></div>
${check}
<h2>${esc(tl('Câblage, étape par étape'))}</h2>
<p class="sub">${esc(tl('Débranchez l’alimentation pendant le câblage. Cochez chaque étape une fois le fil posé.'))}</p>
${steps.map(step).join('\n')}
<section class="step"><div class="pic">${img(o.cover, tl('Montage terminé'))}</div><div class="txt"><h3><span class="box"></span>${esc(tl('Mise sous tension'))}</h3>
<p class="do">${esc(tl('Relisez chaque fil d’après les images, puis branchez l’alimentation.'))}</p>${o.program ? `<p class="why">${esc(tl('Téléversez ensuite le programme du projet sur la carte.'))}</p>` : ''}</div></section>
<footer>${esc(o.footer || '')}</footer>
</body></html>`;
}
