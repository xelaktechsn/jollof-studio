// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Petits outils partagés par les onglets de la vue Conception (design.js) : champs de formulaire, tableaux, réglages de
// data.design (une modification = un pas d'annulation), enregistrement de fichiers.
import { tl, isEn } from '../../i18n/index.js';
import { cleanDesign } from '../dimension.js';
import { toCsv, csvOptions, csvTables } from '../docs.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Nombre écrit à la française (virgule) ou à l'anglaise. */
export const fmt = (v, d = 0) => (Number.isFinite(+v) ? (+v).toLocaleString(isEn ? 'en-GB' : 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
/** Paramètres de conception du modèle, propres (créés au besoin). */
export function design(ctx) {
  const data = ctx.data();
  if (!data.design || !data.design.usage) data.design = cleanDesign(data.design);
  return data.design;
}
/** Modifie un réglage (chemin « a.b.c ») de data.design, le borne (cleanDesign) et l'enregistre (Ctrl+Z). */
export function setDesign(ctx, path, value) {
  const D = design(ctx), keys = path.split('.');
  let o = D; for (const k of keys.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
  ctx.data().design = cleanDesign(D);
  ctx.commit();
}
/** Champ numérique d'un réglage : data-set="chemin". */
export const numField = (label, path, v, o = {}) => `<label class="ntDsF"><span>${esc(label)}</span><span class="ntDsIn"><input class="inp" type="number" data-set="${path}" value="${esc(v)}" min="${o.min ?? 0}" max="${o.max ?? 1e6}" step="${o.step ?? 1}" inputmode="decimal">${o.unit ? `<em>${esc(o.unit)}</em>` : ''}</span>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</label>`;
/** Liste déroulante d'un réglage. */
export const selField = (label, path, v, opts, o = {}) => `<label class="ntDsF"><span>${esc(label)}</span><select class="sel" data-set="${path}"${o.num ? ' data-num' : ''}>${opts.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</label>`;
export const txtField = (label, path, v, o = {}) => `<label class="ntDsF"><span>${esc(label)}</span><input class="inp" ${o.type ? `type="${o.type}"` : ''} data-set="${path}" value="${esc(v)}" maxlength="${o.max || 80}" spellcheck="false"${o.disabled ? ' disabled' : ''}>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</label>`;
/** Branche les champs data-set d'un élément : à la validation (change), le réglage est écrit et enregistré. */
export function bindSettings(ctx, el, after) {
  el.addEventListener('change', e => {
    const t = e.target.closest('[data-set]'); if (!t || !el.contains(t)) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'number' || t.hasAttribute('data-num')) v = v === '' ? null : +v;
    setDesign(ctx, t.dataset.set, v);
    if (after) after(t);
  });
}
/** Tableau HTML : cols [{ key | fn, name, num?, cls?, min? (largeur mini CSS) }], rows. attrs(row) → attributs de la ligne.
 *  En-têtes sur une ligne (ellipse au-delà de 14em, nom complet en infobulle), jamais coupés au milieu d'un mot. */
export function table(cols, rows, o = {}) {
  const cell = (c, r) => { const v = typeof c.key === 'function' ? c.key(r) : r[c.key]; return c.html ? v : esc(v); };
  const body = rows.length ? rows.map(r => `<tr${o.attrs ? ' ' + o.attrs(r) : ''}>${cols.map(c => `<td class="${c.num ? 'n' : ''} ${c.cls || ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="ntDsEmpty">${esc(o.empty || tl('Rien à afficher.'))}</td></tr>`;
  return `<div class="ntDsTblWrap"><table class="ntDsTbl${o.cls ? ' ' + o.cls : ''}"><thead><tr>${cols.map(c => `<th class="${c.num ? 'n' : ''}" title="${esc(c.name)}"${c.min ? ` style="min-width:${esc(c.min)}"` : ''}><span class="ntDsTh">${esc(c.name)}</span></th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
/** Tuile de chiffre clé. */
export const kpi = (label, value, o = {}) => `<div class="ntDsKpi${o.warn ? ' warn' : ''}${o.ok ? ' ok' : ''}"><span>${esc(label)}</span><b>${esc(value)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div>`;
/** Enregistre un fichier (boîte de dialogue du système dans l'application, téléchargement dans un navigateur). */
export async function saveText(ctx, text, name, type, ext) {
  try {
    const native = await import('../../native.js');
    // Filtre de la boîte « Enregistrer sous » : le type du fichier (le nom proposé est déjà dans la boîte).
    const label = { dxf: tl('Dessin DXF'), csv: tl('Tableau CSV'), svg: tl('Dessin SVG'), html: tl('Rapport HTML') }[ext] || ext.toUpperCase();
    const path = await native.saveFile(new Blob([text], { type }), name, label, ext);
    if (path) ctx.status(tl('Fichier enregistré : {0}', path), 'ok');
  } catch (e) { ctx.status(tl('Enregistrement impossible : {0}', e.message || e), 'err'); }
}
/** Export CSV d'un tableau : séparateur et virgule décimale réglés dans l'onglet Documents (UTF-8 avec BOM). */
export const saveCsv = (ctx, cols, rows, base) => saveText(ctx, toCsv(cols, rows, csvOptions(ctx.data(), isEn)), `${fileBase(ctx)}-${base}.csv`, 'text/csv', 'csv');
/** Tableau d'échange (docs.js csvTables : câbles, brassage, nomenclature, prises, plan d'adressage, étiquettes), en-têtes réglés. */
export function saveTable(ctx, name, base) {
  const o = csvOptions(ctx.data(), isEn), t = csvTables(ctx.data(), ctx.lan(), { headers: o.headers })[name];
  return saveText(ctx, toCsv(t.cols, t.rows, o), `${fileBase(ctx)}-${base}.csv`, 'text/csv', 'csv');
}
/** Début des noms de fichiers : nom du site ou du projet. */
export const fileBase = ctx => { const d = ctx.data(), p = (d.design && d.design.project) || {}; return (p.site || (d.site && d.site.name) || tl('reseau')).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'reseau'; };
