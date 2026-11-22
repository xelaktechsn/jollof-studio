// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export IFC du projet réseau (chargé à la demande depuis les menus, la palette et l'IA) : exportIfc(ctx) ouvre une
// petite boîte d'options (étages, vue de définition, contenu, nom du fichier), puis écrit le fichier .ifc (IFC4,
// src/net/interop/ifcwrite.js) et l'enregistre (boîte « Enregistrer sous » de l'application, téléchargement dans un
// navigateur). exportIfc(ctx, { direct: true, … }) enregistre sans la boîte (IA). Géométrie simplifiée : dit dans la boîte.
// Schéma : IFC4 seulement (l'écriture IFC2X3 n'est pas faite : ses entités de réseau n'existent pas, voir ifcwrite.js).
import './cadimport.css';
import './crimp.css';
import './ifcimport.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';
import { writeIfc } from '../interop/ifcwrite.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = v => (+v || 0).toLocaleString(isEn ? 'en' : 'fr-FR');
const clean = s => String(s || '').replace(/\.jollof$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
/** Nom du projet (sinon le site, sinon « reseau »). */
function projectName(ctx) {
  const n = ctx.app && ctx.app.projectName ? ctx.app.projectName() : '', d = ctx.data(), p = (d.design && d.design.project) || {};
  return clean(n && n !== tl('Sans titre') ? n : p.site || (d.site && d.site.name) || '') || tl('reseau');
}
/** Nom de fichier proposé : projet + date du jour (AAAA-MM-JJ). */
export function ifcFileName(ctx, date = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${projectName(ctx)}-${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}.ifc`;
}

/** Fichier IFC du projet : { text, stats, name } (sans l'enregistrer). */
export function buildIfc(ctx, opts = {}) {
  const data = ctx.data(), p = (data.design && data.design.project) || {}, name = opts.name || ifcFileName(ctx);
  const r = writeIfc(data, { author: p.author || '', org: p.client || '', names: { system: tl('Réseau de données'), project: p.site || (data.site && data.site.name) || projectName(ctx) }, ...opts, name });
  return { ...r, name };
}
async function save(ctx, opts) {
  const r = buildIfc(ctx, opts), s = r.stats;
  try {
    const native = await import('../../native.js');
    const path = await native.saveFile(new Blob([r.text], { type: 'application/x-step' }), r.name, tl('Modèle IFC'), 'ifc');
    if (!path) return null;
    const msg = tl('IFC4 enregistré : {0:# étage|# étages}, {1:# pièce|# pièces}, {2:# équipement ou prise|# équipements et prises}, {3:# câble|# câbles}, {4:# cheminement|# cheminements} (géométrie simplifiée).', nf(s.storeys), nf(s.spaces), nf(s.appliances + s.outlets), nf(s.cables), nf(s.carriers));
    ctx.status(msg, 'ok');
    if (ctx.app && ctx.app.log) ctx.app.log(tl('IFC · {0} : {1}', r.name, msg), 'ok');
    return { path, stats: s };
  } catch (e) { ctx.status(tl('Enregistrement impossible : {0}', e.message || e), 'err'); return null; }
}

/** Écrit et enregistre le fichier IFC : boîte d'options, sauf { direct: true }. Rend { path, stats } ou null. */
export async function exportIfc(ctx, opts = {}) {
  const data = ctx.data(), floors = [];
  for (const b of (data.site && data.site.buildings) || []) for (const f of b.floors || []) floors.push({ b, f });
  if (!floors.length) { ctx.status(tl('Aucun étage à exporter : dessinez-les dans la vue Plans.'), 'warn'); return null; }
  if (opts.direct) { const o = { ...opts }; delete o.direct; return save(ctx, o); }
  return new Promise(resolve => openDialog(ctx, floors, resolve));
}

function openDialog(ctx, floors, resolve) {
  const layer = document.createElement('div'); layer.className = 'ntCiLayer'; document.body.appendChild(layer);
  const O = overlay(layer, { label: tl('Exporter un modèle BIM (IFC)'), cls: 'ntCiOv ntIfxOv' }), { dlg } = O;
  const data = ctx.data(), many = (data.site.buildings || []).length > 1;
  const S = { floors: new Set(floors.map(x => x.f.id)), view: 'rv', walls: true, ports: true, cables: true, name: ifcFileName(ctx) };
  const devOn = id => (data.devices || []).filter(d => d.loc && d.loc.floor === id).length + (data.racks || []).filter(r => r.floor === id).length;
  dlg.classList.add('ntIfx');
  let done = false;
  const finish = v => { if (done) return; done = true; window.removeEventListener('keydown', onKey, true); O.close(); layer.remove(); resolve(v); };
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } else if (e.key === 'Enter' && !/^(SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName) && dlg.contains(e.target)) { e.preventDefault(); go(); } }
  window.addEventListener('keydown', onKey, true);
  const opt = (k, ic, label, hint) => `<label class="ntIfcOpt${S[k] ? ' on' : ''}"><input type="checkbox" data-ifx="${k}"${S[k] ? ' checked' : ''}>${icon(ic)}<span>${esc(label)}<small>${esc(hint)}</small></span><em></em></label>`;
  const view = (v, label, hint) => `<label class="ntCiMode${S.view === v ? ' on' : ''}"><input type="radio" name="ifxview" value="${v}"${S.view === v ? ' checked' : ''}><b>${esc(label)}</b><span>${esc(hint)}</span></label>`;
  function paint() {
    const n = S.floors.size;
    dlg.innerHTML = `<div class="nt-hd">${icon('download')}<div class="nt-ttl"><b>${esc(tl('Exporter un modèle BIM (IFC)'))}</b><span>${esc(tl('IFC4 (ADD2 TC1) · fichier STEP .ifc'))}</span></div>
        <button class="nt-x" data-ifa="close" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
      <div class="ntIfxBody">
        <section class="ntCiSec"><h4>${icon('layers')}${esc(tl('Étages'))} <span class="mut">${nf(n)} / ${nf(floors.length)}</span><span class="grow"></span>
          <button type="button" class="btn small subtle" data-ifa="all">${esc(tl('Tous'))}</button><button type="button" class="btn small subtle" data-ifa="none">${esc(tl('Aucun'))}</button></h4>
          <div class="ntIfcList ntIfxFloors">${floors.map(({ b, f }) => `<label class="ntIfcRow${S.floors.has(f.id) ? ' on' : ''}"><input type="checkbox" data-iff="${esc(f.id)}"${S.floors.has(f.id) ? ' checked' : ''}><div><b>${esc((many ? (b.name || b.id) + ' · ' : '') + (f.name || f.id))}</b><span>${esc(tl('{0:# pièce|# pièces} · {1:# mur|# murs} · {2:# équipement|# équipements}', nf((f.rooms || []).length), nf((f.walls || []).length), nf(devOn(f.id))))}</span></div></label>`).join('')}</div></section>
        <section class="ntCiSec"><h4>${icon('eye')}${esc(tl('Vue de définition (MVD)'))}</h4>
          <div class="ntCiModes" role="radiogroup" aria-label="${esc(tl('Vue de définition (MVD)'))}">
            ${view('rv', tl('Reference View 1.2 (recommandée)'), tl('Coordination et visionneuses BIM : solides extrudés, matériaux simples, câbles en prismes le long de leur tracé.'))}
            ${view('design', tl('Sans vue imposée (conception)'), tl('Ajoute les axes des murs et des cheminements, les couches de matériaux et les câbles en tubes ; aucune vue déclarée.'))}
          </div></section>
        <section class="ntCiSec"><h4>${icon('checklist')}${esc(tl('Contenu'))}</h4>
          <div class="ntIfcWhat">${opt('walls', 'wall', tl('Murs et portes'), tl('avec les ouvertures'))}${opt('ports', 'link', tl('Ports et connexions'), tl('IfcDistributionPort, IfcRelConnectsPorts'))}${opt('cables', 'cable', tl('Géométrie des câbles'), tl('sinon leur seule fiche, sans forme'))}</div>
          <p class="mut">${esc(tl('Toujours exportés : site, bâtiments, étages, pièces, équipements, prises, baies, cheminements, câbles, système de données et jeux de propriétés. Géométrie simplifiée (boîtes, profils extrudés).'))}</p></section>
        <section class="ntCiSec"><h4>${icon('file')}${esc(tl('Fichier'))}</h4>
          <label class="ntCiField"><span>${esc(tl('Nom du fichier'))}</span><input class="inp" data-ifx="name" maxlength="90" spellcheck="false" value="${esc(S.name)}"></label></section>
      </div>
      <div class="ntCiFoot"><span class="ntCiMsg" aria-live="polite">${n ? '' : esc(tl('Choisissez au moins un étage.'))}</span><span class="grow"></span>
        <button type="button" class="btn" data-ifa="close">${esc(tl('Annuler l’export'))}</button>
        <button type="button" class="btn primary" data-ifa="go"${n ? '' : ' disabled'}>${icon('download')}<span>${esc(tl('Exporter'))}</span></button></div>`;
  }
  function go() {
    if (!S.floors.size) return;
    let name = String(S.name || '').trim() || ifcFileName(ctx); if (!/\.ifc$/i.test(name)) name += '.ifc';
    const o = { view: S.view, floors: S.floors.size === floors.length ? undefined : [...S.floors], walls: S.walls, doors: S.walls, ports: S.ports, cables: S.cables, name };
    finish(save(ctx, o)); // la boîte se ferme ; la promesse rend le résultat de l'enregistrement
  }
  dlg.addEventListener('click', e => {
    const t = e.target.closest('[data-ifa]'); if (!t) return;
    const a = t.dataset.ifa;
    if (a === 'close') finish(null);
    else if (a === 'go') go();
    else if (a === 'all' || a === 'none') { S.floors = a === 'all' ? new Set(floors.map(x => x.f.id)) : new Set(); paint(); }
  });
  dlg.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.iff != null) { t.checked ? S.floors.add(t.dataset.iff) : S.floors.delete(t.dataset.iff); paint(); return; }
    if (t.name === 'ifxview') { S.view = t.value; paint(); return; }
    if (t.dataset.ifx && t.dataset.ifx !== 'name') { S[t.dataset.ifx] = t.checked; paint(); }
  });
  dlg.addEventListener('input', e => { if (e.target.dataset.ifx === 'name') S.name = e.target.value; });
  paint();
  dlg.focus({ preventScroll: true });
  if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.ifcExportDialog = { state: () => S, go, close: () => finish(null) }; // (essais automatiques)
}
