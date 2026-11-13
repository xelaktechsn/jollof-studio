// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Composants en paquet (.jpart) côté application : bibliothèque personnelle, paquets apportés par un projet, import
// (.jpart, pièce Fritzing .fzpz, symbole KiCad .kicad_sym), export, et accès à l'atelier de composants (studio.js),
// où un composant se crée ou se modifie sans écrire de code. Un modèle du montage décrit comme « composant à
// décrire » (assistant d'import de main.js) s'ouvre lui aussi dans l'atelier ; enregistré, il devient le composant
// en paquet, ses fils restant branchés.
import * as J from './jpart.js';
import * as P from './packages.js';
import * as D from './partdraft.js';
import * as studio from './studio.js';
import { tl } from '../i18n/index.js';

let A = null; // interface de l'application (main.js)
const esc = D.esc;
export const manifestOf = D.manifestOf;
export const specOf = D.specOf;
export const blockModel = D.blockModel;

/* ---------- Bibliothèque personnelle et projets ---------- */
/** Installe les paquets de la bibliothèque personnelle ; rend les autres éléments (modèles importés). */
export async function loadLibrary(items) {
  const rest = [];
  for (const it of items || []) {
    if (it && it.kind === 'package' && typeof it.jpart === 'string') {
      try { await P.installBytes(J.fromB64(it.jpart), { saved: true }); } catch (e) { console.warn(tl('Composant ignoré'), it.id, e); }
    } else rest.push(it);
  }
  return rest;
}
export const embed = comps => P.embedFor(comps);
/** Paquets enregistrés dans un projet ouvert (avant ses composants). */
export async function restoreEmbedded(list) {
  const r = await P.installEmbedded(list);
  if (A && (r.added.length || r.errors.length)) {
    A.renderLibrary();
    if (r.errors.length) A.status(tl('Composant en paquet ignoré : {0}', r.errors[0]), 'warn');
  }
  return r;
}
async function saveToLibrary(type) {
  const p = P.packageOf(type); if (!p) return;
  await A.native.librarySave({ id: type, kind: 'package', name: p.manifest.name, jpart: J.toB64(p.bytes) });
  P.markSaved(type);
}

/* ---------- Assistant (main.js renderWizard) ---------- */
/** Prolonge l'assistant d'un composant importé : sa nature « composant à décrire » s'édite dans l'atelier. */
export function wizard(c) {
  const d = c && c.custom, box = A && A.$('#partEd');
  if (!box) return;
  const part = !!d && d.kind === 'part';
  // Pose des broches dans la barre latérale : seulement pour les autres natures (l'atelier a ses propres outils).
  const name = A.$('#pinName'), place = A.$('#placeBtn');
  if (place) place.hidden = part;
  if (name && name.closest('label')) name.closest('label').hidden = part;
  if (!part) { box.hidden = true; resetSaveLabel(c); return; }
  d.part = d.part || { category: J.PKG_CATEGORIES[0], prefix: 'U', look: { kind: d.glb ? 'glb' : 'module' } };
  const errs = D.problems(d), K = D.KIND_LABEL();
  A.$('#pinHint').textContent = tl('Broches, natures, limites et documentation se règlent dans l’atelier de composants : vue dédiée, grille, tableau des broches et vérification en direct.');
  A.$('#cPins').innerHTML = (d.pins || []).map(q => `<li><b>${esc(q.name)}</b><span>${esc(K[D.pinOut(q).kind])}</span></li>`).join('') || `<li class="note">${tl('Aucune broche posée.')}</li>`;
  box.hidden = false;
  box.innerHTML = `<button type="button" class="btn primary wide" data-pe="studio">${A.icon('wrench')}<span>${tl('Ouvrir dans l’atelier de composants')}</span></button>
    ${errs.length ? `<p class="note">${esc(tl('{0} point(s) à régler avant l’enregistrement.', errs.length))}</p>` : `<p class="note ok">${tl('Prêt : le composant peut être enregistré.')}</p>`}`;
  A.$('#saveLibBtn').disabled = !d.pins.length;
  A.$('#saveLibBtn').querySelector('span').textContent = tl('Enregistrer dans ma bibliothèque');
}
/** Remet le libellé d'origine du bouton d'ajout (assistant d'un modèle qui n'est pas un composant à décrire). */
function resetSaveLabel(c) {
  const b = A && A.$('#saveLibBtn'); if (!b) return;
  if (!c || !c.custom || c.custom.kind !== 'part') b.querySelector('span').textContent = tl('Ajouter à ma bibliothèque');
}

/* ---------- Enregistrer, exporter, importer ---------- */
async function download(bytes, m) {
  const path = await A.saveFile(new Blob([bytes], { type: 'application/zip' }), `${D.slug(m.name)}.jpart`, tl('Composant Jollof Studio'), 'jpart');
  if (path) A.status(A.isDesktop() ? tl('Composant exporté : {0}', path) : tl('Composant exporté.'), 'ok');
}
/**
 * Enregistre un brouillon posé sur le montage (bouton de l'assistant) : paquet vérifié, installé, rangé dans la
 * bibliothèque personnelle ; le composant du plan de travail devient le composant en paquet (ses fils restent branchés).
 */
export async function save(c) {
  const d = c && c.custom; if (!d) return;
  try {
    const old = d.part.id && P.packageOf(d.part.id);
    d.part.id = d.part.id || D.manifestOf(d).id;
    if (old) d.part.version = Math.max(old.manifest.version + 1, d.part.version || 1);
    const { m, bytes } = D.packDraft(d);
    await P.installBytes(bytes, { saved: true });
    await saveToLibrary(m.id);
    const data = A.projectData(), e = data.comps.find(x => x.id === c.id);
    if (e) { e.type = m.id; delete e.custom; e.name = c.name; }
    await A.refresh(data);
    const n = A.comps().find(x => x.id === c.id); if (n) A.select(n);
    A.renderLibrary();
    A.status(tl('{0} enregistré dans votre bibliothèque (paquet .jpart).', m.name), 'ok');
  } catch (e) { A.status(tl('Enregistrement impossible : {0}', String(e.message || e).split('\n')[0]), 'warn'); wizard(c); }
}
/**
 * Brouillon d'un fichier de composant, pour l'atelier : { draft, type?, msg } ; null si l'utilisateur renonce
 * (choix d'un symbole dans une bibliothèque KiCad). Un .jpart déjà installé garde son identifiant (mise à jour).
 */
async function readDraft(f) {
  const name = f.name || '', ext = ((name.match(/\.([a-z_]+)$/i) || [])[1] || '').toLowerCase();
  if (ext === 'jpart') {
    const pk = J.unpackJpart(new Uint8Array(await f.arrayBuffer())), m = pk.manifest;
    return { draft: D.draftOf(m, { glb: pk.glb, svg: pk.svg, symbol: pk.symbol }), type: P.packageOf(m.id) ? m.id : null, msg: tl('{0} ouvert dans l’atelier.', m.name) };
  }
  if (ext === 'fzpz') {
    const F = await import('../import/fritzing.js');
    const r = F.importFritzing(F.readFzpz(new Uint8Array(await f.arrayBuffer())));
    return { draft: D.draftOf(r.manifest, { svg: r.svg }), msg: tl('Pièce Fritzing « {0} » importée : {1} broche(s) placée(s) d’après le dessin, {2} estimée(s). Vérifiez la nature de chaque broche.', r.report.title, r.report.placed.length, r.report.estimated.length) };
  }
  if (ext === 'kicad_sym') {
    const K = await import('../import/kicadsym.js');
    const syms = K.importKicadSymbols(await f.text()).filter(s => s.pins.length);
    if (!syms.length) throw new Error(tl('aucun symbole avec des broches'));
    const s = syms.length === 1 ? syms[0] : await pickSymbol(syms);
    if (!s) return null;
    const dr = K.symbolDraft(s, name);
    return { draft: D.draftOf(dr.manifest, { symbol: dr.symbol }), msg: tl('Symbole KiCad « {0} » importé ({1} broches) : son dessin servira au schéma. Vérifiez la nature de chaque broche.', s.name, s.pins.length) + (s.multi ? ' ' + tl('Symbole à plusieurs unités : seule la première est reprise.') : '') };
  }
  throw new Error(tl('format non pris en charge : utilisez .jpart, .fzpz ou .kicad_sym'));
}
/** « Importer un composant » de la bibliothèque : un .jpart s'y range directement, une pièce Fritzing ou KiCad s'ouvre dans l'atelier. */
async function importFile(f) {
  try {
    if (/\.jpart$/i.test(f.name || '')) {
      const m = await P.installBytes(new Uint8Array(await f.arrayBuffer()), { saved: true });
      await saveToLibrary(m.id); A.renderLibrary();
      A.status(tl('{0} ajouté à votre bibliothèque.', m.name), 'ok');
      return;
    }
    const r = await readDraft(f);
    if (r) await studio.open({ draft: r.draft, msg: r.msg });
  } catch (e) { A.status(tl('Import impossible : ') + String(e.message || e).split('\n')[0], 'err'); }
}
/** Choix d'un symbole dans une bibliothèque KiCad qui en contient plusieurs. */
function pickSymbol(syms) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal'; box.style.zIndex = '45'; // au-dessus de l'atelier quand il l'ouvre
    box.innerHTML = `<div class="sheet pickSheet" role="dialog" aria-modal="true" aria-labelledby="pickTitle"><div class="sheetHead"><h2 id="pickTitle">${A.icon('schematic')}${tl('Choisir un symbole ({0})', syms.length)}</h2><button type="button" class="btn small" data-x>${tl('Fermer')}</button></div>
      <input class="pickQ" placeholder="${esc(tl('Rechercher…'))}" aria-label="${esc(tl('Rechercher un symbole'))}"><ul class="pickList"></ul></div>`;
    document.body.appendChild(box);
    const list = box.querySelector('.pickList'), q = box.querySelector('.pickQ');
    const draw = () => { const t = q.value.trim().toLowerCase(); list.innerHTML = syms.map((s, i) => [s, i]).filter(([s]) => !t || `${s.name} ${s.description}`.toLowerCase().includes(t)).slice(0, 300).map(([s, i]) => `<li><button type="button" data-i="${i}"><b>${esc(s.name)}</b><small>${esc(tl('{0} broches', s.pins.length))}${s.description ? ' · ' + esc(s.description.slice(0, 90)) : ''}</small></button></li>`).join(''); };
    const done = v => { box.remove(); resolve(v); };
    q.oninput = draw; draw(); q.focus();
    box.addEventListener('click', e => { if (e.target === box || e.target.closest('[data-x]')) done(null); const b = e.target.closest('[data-i]'); if (b) done(syms[+b.dataset.i]); });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

/* ---------- Composant en paquet sélectionné (main.js select) ---------- */
export function selected(c) {
  resetSaveLabel(c);
  const box = A && A.$('#pkgTools'); if (!box) return;
  const p = c && P.packageOf(c.type);
  if (!p || p.standard) { box.hidden = true; return; } // composant standard : comme ceux de la bibliothèque
  box.hidden = false;
  box.innerHTML = `<p class="note">${esc(tl('Composant en paquet (.jpart), version {0}{1}.', p.manifest.version, p.saved ? '' : tl(', apporté par ce projet')))}</p>
    <div class="row"><button type="button" class="btn small" data-pk="edit">${A.icon('wrench')}<span>${tl('Modifier dans l’atelier')}</span></button><button type="button" class="btn small" data-pk="export">${A.icon('upload')}<span>${tl('Exporter')}</span></button>
    ${p.saved ? `<button type="button" class="btn small" data-pk="remove">${A.icon('trash')}<span>${tl('Retirer de ma bibliothèque')}</span></button>` : `<button type="button" class="btn small" data-pk="keep">${A.icon('save')}<span>${tl('Ajouter à ma bibliothèque')}</span></button>`}</div>`;
  box.onclick = async e => {
    const b = e.target.closest('[data-pk]'); if (!b) return;
    try {
      // Les composants posés gardent l'ancienne version tant que la nouvelle n'est pas enregistrée.
      if (b.dataset.pk === 'edit') await studio.open({ draft: D.draftOf(p.manifest, { glb: p.glb, svg: p.svg, symbol: p.symbol }), type: c.type });
      if (b.dataset.pk === 'export') await download(p.bytes, p.manifest);
      if (b.dataset.pk === 'keep') { await saveToLibrary(c.type); A.renderLibrary(); selected(c); A.status(tl('{0} ajouté à votre bibliothèque.', p.manifest.name), 'ok'); }
      if (b.dataset.pk === 'remove') {
        await A.native.libraryDelete(c.type);
        P.uninstall(c.type, true); // les composants posés restent utilisables pendant la session
        A.renderLibrary(); selected(c); A.status(tl('{0} retiré de votre bibliothèque (il reste enregistré dans ce projet).', p.manifest.name), 'ok');
      }
    } catch (err) { A.status(String(err.message || err), 'err'); }
  };
}

/* ---------- Installation dans l'application ---------- */
/**
 * api : { $, icon, status, select, selected(), comps, projectData, refresh(data), rebuildCustom(c), addDraft(custom),
 *         place(type), renderLibrary, renderExplain, changed, native, saveFile, isDesktop }.
 */
export function install(api) {
  A = api;
  studio.install(api, { saveToLibrary, download, readDraft });
  const $ = api.$;
  const file = $('#partFile'), news = $('#partNew');
  if (file) file.onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  if (news) news.onclick = () => studio.open({ gallery: true });
  const box = $('#partEd');
  if (box) box.addEventListener('click', e => {
    if (!e.target.closest('[data-pe="studio"]')) return;
    const c = selectedDraft(); if (c) studio.open({ draft: c.custom, comp: c });
  });
}
/** Brouillon sélectionné (composant importé de nature « part »), ou null. */
function selectedDraft() {
  const c = A.selected ? A.selected() : null;
  return c && c.custom && c.custom.kind === 'part' ? c : null;
}
