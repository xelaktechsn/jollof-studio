// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Export des schémas du projet réseau vers Microsoft Visio (.vsdx) et draw.io (.drawio) (chargé à la demande depuis les
// menus Fichier ▸ Exporter et Documents, la palette et l'IA). Une page par vue : schéma logique (câbles = connecteurs
// collés aux équipements), élévation de chaque baie, plan de chaque étage à l'échelle (mètres réels) ; calques, données
// de forme (étiquette, modèle, IP, VLAN, baie, U, catégorie, longueur). Écrivains purs : interop/diagram.js (vues),
// interop/vsdx.js, interop/drawio.js. Enregistrement par native.saveFile (boîte « Enregistrer sous », téléchargement
// dans un navigateur).
//
// exportVsdx(ctx, { views?, ask? }) / exportDrawio(ctx, { views?, ask? }) → { path, stats } | null
//   views : { logic, racks, floors } comme buildViews ; sans views (ou ask: true), la boîte de choix s'ouvre.
// openDiagramExport(ctx, 'vsdx'|'drawio') : la boîte (format, vues), puis l'export.
import './visioexport.css';
import { tl, isEn, CANCEL } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { fileBase } from './design-util.js';

const KEY = 'jollof-diagram-export';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const nf = v => (+v || 0).toLocaleString(isEn ? 'en' : 'fr-FR');
const remembered = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const remember = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* stockage indisponible */ } };

/** Adresses IP vues par la simulation (DHCP compris), sinon celles des réglages. */
function ipOfFn(ctx) {
  let lan = null; try { lan = ctx.lan && ctx.lan(); } catch (e) { lan = null; }
  if (!lan || typeof lan.ipOf !== 'function') return null;
  return id => { try { const f = lan.ipOf(id); return f && f.ip ? `${f.ip}/${f.prefix ?? 24}${f.src === 'dhcp' ? ' (DHCP)' : ''}` : ''; } catch (e) { return ''; } };
}

/** Boîte de choix : format et vues ; rend { fmt, views } ou null. */
async function ask(ctx, fmt0) {
  const D = await import('../interop/diagram.js');
  const data = ctx.data(), av = D.availableViews(data), mem = remembered();
  const nDev = av.logic ? av.logic.devices : 0, nCab = av.logic ? av.logic.cables : 0;
  const row = (k, ic, label, count, on, disabled) => `<label class="ntVxRow"><input type="checkbox" data-g="${k}"${on && !disabled ? ' checked' : ''}${disabled ? ' disabled' : ''}>${icon(ic)}<span>${esc(label)}</span><em>${esc(count)}</em></label>`;
  const sub = (k, list) => list.map(x => `<label class="ntVxRow sub"><input type="checkbox" data-k="${k}" data-id="${esc(x.id)}" checked><span>${esc(x.name)}</span></label>`).join('');
  const fmt = fmt0 || mem.fmt || 'vsdx';
  const body = `<div class="ntVx">
    <div class="ntVxFmt" role="radiogroup" aria-label="${esc(tl('Format du fichier'))}">
      <label class="${fmt === 'vsdx' ? 'on' : ''}"><input type="radio" name="ntVxF" value="vsdx"${fmt === 'vsdx' ? ' checked' : ''}><b>${esc(tl('Visio (.vsdx)'))}</b><span>${esc(tl('Gabarits par type d’équipement, câbles collés, plans à l’échelle.'))}</span></label>
      <label class="${fmt === 'drawio' ? 'on' : ''}"><input type="radio" name="ntVxF" value="drawio"${fmt === 'drawio' ? ' checked' : ''}><b>${esc(tl('draw.io (.drawio)'))}</b><span>${esc(tl('Un onglet par vue, liens reliés aux formes, données sur chaque forme.'))}</span></label>
    </div>
    <p class="ntVxHead">${esc(tl('Pages à exporter'))}</p>
    <div class="ntVxViews">
      ${row('logic', 'network', tl('Schéma logique'), tl('{0} équipements, {1} câbles', nf(nDev), nf(nCab)), mem.logic !== false, !av.logic)}
      ${row('racks', 'rack', tl('Élévations de baies'), tl('{0} pages', nf(av.racks.length)), mem.racks !== false, !av.racks.length)}${sub('racks', av.racks)}
      ${row('floors', 'floorPlan', tl('Plans d’étage'), tl('{0} pages', nf(av.floors.length)), mem.floors !== false, !av.floors.length)}${sub('floors', av.floors)}
    </div>
    <p class="ntVxNote" data-note></p>
  </div>`;
  const { dialog } = await import('../../school/ui.js');
  const note = f => (f === 'vsdx'
    ? tl('Visio recalcule les connecteurs à l’ouverture. Plans en mètres réels, à l’échelle 1:50 à 1:2000 (modifiable dans Mise en page). Calques : équipements, câbles, pièces, murs, cheminements, baies, prises, points d’accès, étiquettes.')
    : tl('Fichier XML non compressé (draw.io, diagrams.net). draw.io n’a pas d’échelle de dessin : les plans sont dessinés à l’échelle indiquée dans leur titre ; une pièce qui n’est pas rectangulaire devient un contour sans remplissage.'));
  return dialog({
    title: tl('Exporter les schémas'), head: { icon: 'download', sub: tl('Visio (.vsdx) ou draw.io : une page par vue') }, width: 540, body,
    actions: [{ label: CANCEL, value: null }, { label: tl('Exporter…'), value: 'ok', kind: 'primary' }],
    onOpen: root => {
      const sync = () => {
        const f = root.querySelector('input[name="ntVxF"]:checked').value;
        root.querySelectorAll('.ntVxFmt label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
        root.querySelector('[data-note]').textContent = note(f);
        for (const g of ['racks', 'floors']) { const on = root.querySelector(`[data-g="${g}"]`).checked; root.querySelectorAll(`[data-k="${g}"]`).forEach(c => { c.disabled = !on; }); }
      };
      root.addEventListener('change', sync); sync();
    },
    onAction: (v, root) => {
      if (v !== 'ok') return undefined;
      const g = k => { const c = root.querySelector(`[data-g="${k}"]`); return !!(c && c.checked && !c.disabled); };
      const ids = k => [...root.querySelectorAll(`[data-k="${k}"]:checked`)].map(c => c.dataset.id);
      const views = { logic: g('logic'), racks: g('racks') ? ids('racks') : false, floors: g('floors') ? ids('floors') : false };
      if (!views.logic && !(views.racks || []).length && !(views.floors || []).length) { ctx.status(tl('Choisissez au moins une page.'), 'warn'); return false; }
      const f = root.querySelector('input[name="ntVxF"]:checked').value;
      remember({ fmt: f, logic: views.logic, racks: views.racks !== false, floors: views.floors !== false });
      return { fmt: f, views };
    }
  });
}

async function run(ctx, fmt, views) {
  const D = await import('../interop/diagram.js');
  const data = ctx.data(), p = (data.design && data.design.project) || {};
  const V = D.buildViews(data, { views, ipOf: ipOfFn(ctx) });
  if (!V.pages.length) { ctx.status(tl('Rien à exporter : ni équipement, ni baie, ni étage dessiné.'), 'warn'); return null; }
  let blob, name, label;
  if (fmt === 'drawio') {
    const { writeDrawio } = await import('../interop/drawio.js');
    blob = new Blob([writeDrawio(V)], { type: 'application/xml' }); name = `${fileBase(ctx)}.drawio`; label = tl('Diagramme draw.io');
  } else {
    const { writeVsdx } = await import('../interop/vsdx.js');
    blob = new Blob([writeVsdx(V, { title: V.title, creator: p.author || '', company: p.client || '' })], { type: 'application/vnd.ms-visio.drawing' }); name = `${fileBase(ctx)}.vsdx`; label = tl('Dessin Visio');
  }
  try {
    const native = await import('../../native.js');
    const path = await native.saveFile(blob, name, label, fmt === 'drawio' ? 'drawio' : 'vsdx');
    if (!path) return null;
    const s = V.stats;
    ctx.status(tl('{0} enregistré : {1} pages ({2} formes, {3} câbles reliés) — {4}', fmt === 'drawio' ? 'draw.io' : 'Visio', nf(s.pages), nf(s.shapes), nf(s.edges), path), 'ok');
    return { path, stats: s, fmt };
  } catch (e) { ctx.status(tl('Enregistrement impossible : {0}', e.message || e), 'err'); return null; }
}

/** Boîte de choix puis export. */
export async function openDiagramExport(ctx, fmt) {
  const r = await ask(ctx, fmt); if (!r) return null;
  return run(ctx, r.fmt, r.views);
}
export const exportVsdx = (ctx, o = {}) => (o.views && !o.ask ? run(ctx, 'vsdx', o.views) : openDiagramExport(ctx, 'vsdx'));
export const exportDrawio = (ctx, o = {}) => (o.views && !o.ask ? run(ctx, 'drawio', o.views) : openDiagramExport(ctx, 'drawio'));
