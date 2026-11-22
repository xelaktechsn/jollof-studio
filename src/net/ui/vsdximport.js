// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Import d'un schéma Visio (.vsdx) dans le schéma logique (chargé à la demande depuis Fichier ▸ Importer) : choix du
// fichier, de la page, puis d'un type d'équipement pour chaque gabarit (ou sorte de forme) trouvé ; les connecteurs
// collés entre deux formes retenues deviennent des câbles (ports libres pris dans l'ordre). Formes qui ont déjà leur
// équipement dans le projet (nom, étiquette, IP) : mettre à jour, garder tels quels ou ajouter en double. Une seule ctx.commit()
// (une annulation défait tout). Logique pure : interop/vsdximport.js ; lecture : interop/vsdx.js.
//
// openVsdxImport(ctx) → { devices, cables, skipped } | null
import './visioexport.css';
import { tl, CANCEL } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { DEVICES } from '../devices.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const MAX_BYTES = 64 * 1024 * 1024;

function pickFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.vsdx,application/vnd.ms-visio.drawing'; inp.style.display = 'none';
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); }, { once: true });
    inp.addEventListener('cancel', () => { inp.remove(); resolve(null); }, { once: true });
    document.body.appendChild(inp); inp.click();
  });
}

export async function openVsdxImport(ctx, file) {
  const f = file || await pickFile(); if (!f) return null;
  if (f.size > MAX_BYTES) { ctx.status(tl('Fichier trop lourd pour l’import ({0} Mo au plus).', MAX_BYTES / 1048576), 'err'); return null; }
  const [{ readVsdx }, I] = await Promise.all([import('../interop/vsdx.js'), import('../interop/vsdximport.js')]);
  let plan;
  try { plan = I.planVsdx(readVsdx(new Uint8Array(await f.arrayBuffer()))); } catch (e) { ctx.status(tl('Fichier Visio illisible : {0}', e.message || e), 'err'); return null; }
  const pages = plan.pages.filter(p => p.shapes.length);
  if (!pages.length) { ctx.status(tl('Aucune forme à importer dans ce fichier.'), 'warn'); return null; }
  const types = Object.keys(DEVICES).filter(t => DEVICES[t].role !== 'mech').map(t => [t, DEVICES[t].name()]).sort((a, b) => a[1].localeCompare(b[1]));
  const opts = sel => `<option value="">${esc(tl('Ignorer'))}</option>` + types.map(([t, n]) => `<option value="${t}"${t === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const groupsHtml = pg => pg.groups.map((g, i) => `<label class="ntVxRow ntVxMap"><span><b>${esc(g.label)}</b><em>${esc(tl('{0} formes', g.count))}${g.sample ? ' · ' + esc(g.sample) : ''}</em></span><select class="sInput" data-key="${i}" title="${esc(g.guess ? DEVICES[g.guess].name() : tl('Ignorer'))}">${opts(g.guess)}</select></label>`).join('');
  const body = `<div class="ntVx">
    ${pages.length > 1 ? `<label class="sField"><span>${esc(tl('Page'))}</span><select class="sInput" data-page>${pages.map((p, i) => `<option value="${i}">${esc(p.name)} — ${esc(tl('{0} formes, {1} connecteurs', p.shapes.length, p.links.length))}</option>`).join('')}</select></label>` : `<p class="ntVxNote"><b>${esc(pages[0].name)}</b> — ${esc(tl('{0} formes, {1} connecteurs', pages[0].shapes.length, pages[0].links.length))}</p>`}
    <p class="ntVxHead">${esc(tl('Type d’équipement de chaque gabarit'))}</p>
    <div class="ntVxViews" data-groups>${groupsHtml(pages[0])}</div>
    <div class="ntVxDup" data-dup hidden></div>
    <p class="ntVxNote">${esc(tl('Les formes deviennent des équipements du schéma logique, à leur place ; les connecteurs collés entre deux formes retenues deviennent des câbles (ports libres pris dans l’ordre). Groupes, images et plans à l’échelle ne sont pas repris.'))}</p>
  </div>`;
  const { dialog } = await import('../../school/ui.js');
  const res = await dialog({
    title: tl('Importer un schéma Visio'), head: { icon: 'upload', sub: tl('Formes et connecteurs → équipements et câbles du schéma logique') }, width: 680, body,
    actions: [{ label: CANCEL, value: null }, { label: tl('Importer'), value: 'ok', kind: 'primary' }],
    onOpen: root => {
      const ps = root.querySelector('[data-page]'), dupEl = root.querySelector('[data-dup]');
      const page = () => pages[+((ps || {}).value || 0)];
      const mappingOf = pg => { const m = {}; root.querySelectorAll('[data-key]').forEach(sel => { m[pg.groups[+sel.dataset.key].key] = sel.value; }); return m; };
      // Équipements déjà présents dans le projet (nom, étiquette, adresse IP) : choix de ce qu'on en fait.
      const dupSync = () => {
        const n = I.findDuplicates(ctx.data(), page(), mappingOf(page())).size, cur = (root.querySelector('input[name="ntVxDup"]:checked') || {}).value || 'update';
        dupEl.hidden = !n; if (!n) { dupEl.innerHTML = ''; return; }
        const opt = (v, label, sub) => `<label class="${v === cur ? 'on' : ''}"><input type="radio" name="ntVxDup" value="${v}"${v === cur ? ' checked' : ''}><span><b>${esc(label)}</b>${esc(sub)}</span></label>`;
        dupEl.innerHTML = `<p class="ntVxWarn">${icon('alert')}<span>${esc(tl('{0} formes correspondent à des équipements déjà dans le projet (même nom, même étiquette ou même adresse IP).', n))}</span></p>`
          + opt('update', tl('Mettre à jour les existants'), tl('Adresse IP reprise du fichier ; seuls les câbles qui manquent sont ajoutés.'))
          + opt('skip', tl('Garder les existants tels quels'), tl('Seuls les nouveaux équipements et les câbles qui manquent sont ajoutés.'))
          + opt('add', tl('Tout ajouter en double'), tl('Chaque forme devient un nouvel équipement.'));
      };
      if (ps) ps.addEventListener('change', () => { root.querySelector('[data-groups]').innerHTML = groupsHtml(page()); dupSync(); });
      root.addEventListener('change', e => {
        if (e.target.matches('[data-key]')) { const t = e.target.value; e.target.title = t ? DEVICES[t].name() : tl('Ignorer'); dupSync(); }
        if (e.target.name === 'ntVxDup') dupEl.querySelectorAll('label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
      });
      dupSync();
    },
    onAction: (v, root) => {
      if (v !== 'ok') return undefined;
      const pg = pages[+((root.querySelector('[data-page]') || {}).value || 0)], mapping = {};
      root.querySelectorAll('[data-key]').forEach(s => { mapping[pg.groups[+s.dataset.key].key] = s.value; });
      if (!Object.values(mapping).some(Boolean)) { ctx.status(tl('Choisissez un type pour au moins un gabarit.'), 'warn'); return false; }
      return { pg, mapping, dup: (root.querySelector('input[name="ntVxDup"]:checked') || {}).value || 'update' };
    }
  });
  if (!res) return null;
  const data = ctx.data();
  const r = I.applyVsdx(data, res.pg, res.mapping, { newDevice: (t, at) => ctx.newDevice(t, at), addCable: (a, b, o) => ctx.addCable(a, b, o) }, { dup: res.dup });
  if (!r.devices && !r.cables && !r.updated) { ctx.status(tl('Rien n’a été importé.'), 'warn'); return r; }
  ctx.commit();
  const skip = r.skipped.links + r.skipped.ports;
  const extra = [r.matched ? tl('{0} déjà présents', r.matched) : '', r.updated ? tl('{0} mis à jour', r.updated) : '', r.existing ? tl('{0} câbles déjà là', r.existing) : '', skip ? tl('{0} connecteurs ignorés', skip) : ''].filter(Boolean).join(', ');
  ctx.status(tl('Schéma Visio importé : {0} équipements, {1} câbles{2}.', r.devices, r.cables, extra ? ` (${extra})` : ''), skip ? 'warn' : 'ok');
  if (ctx.openView) ctx.openView('logic');
  return r;
}
