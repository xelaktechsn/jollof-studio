// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Section « Cartes microSD » de l'onglet Simulation : les fichiers de chaque module carte SD du montage (gardés avec le
// projet, sim/sdcard.js), à télécharger, à ajouter (fichier de l'ordinateur, nom court 8.3) ou à effacer. Visible
// simulation arrêtée comme en marche ; pendant la simulation, la liste suit ce qu'écrit le programme et les
// modifications attendent l'arrêt (l'image de la carte du mode fidèle est construite au démarrage).
import './sdpanel.css';
import { tl, DEC } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { sdStore, saveStore, sdUsed, fileBytes, normPath, SD_CAP } from './sdcard.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = n => (n < 1024 ? `${n} o` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', DEC)} Ko`);

/**
 * app : { comps(), mem(comp) → objet gardé avec le projet (prog.compMem), changed() (projet modifié), simOn(),
 * save(octets, nom) (téléchargement), confirm(texte) → Promise<bool> }.
 */
export function installSdPanel(app) {
  let sec = null, list = null, sig = '';
  function mount() {
    if (sec) return true;
    const after = document.getElementById('probeSec'); if (!after) return false;
    after.insertAdjacentHTML('afterend', `<section id="sdfSec" data-fold="sdcards" hidden><h2>${icon('folder')}${tl('Cartes microSD')}</h2><ul class="probes sdf-list" id="sdfList"></ul><input type="file" id="sdfPick" hidden></section>`);
    sec = document.getElementById('sdfSec'); list = document.getElementById('sdfList');
    bind();
    return true;
  }
  const cards = () => app.comps().filter(c => c.type === 'sdcard');
  function render() {
    if (!mount()) return;
    const cs = cards(), on = app.simOn();
    if (sec.hidden !== !cs.length) sec.hidden = !cs.length;
    const parts = cs.map(c => { const st = sdStore(app.mem(c)); return [c, st]; });
    const s = on + '|' + parts.map(([c, st]) => `${c.id}:${c.name}:${st.ver}:${st.files.size}:${st.dirs.size}:${sdUsed(st)}`).join('|');
    if (s === sig) return;
    sig = s;
    list.innerHTML = parts.map(([c, st]) => {
      const rows = [...[...st.dirs].map(d => [d, null]), ...[...st.files].map(([p, f]) => [p, f.len])].sort((a, b) => a[0].localeCompare(b[0]));
      return `<li data-id="${esc(c.id)}"><div class="ph"><span class="lv"></span><b>${esc(c.name)}</b><span class="sig">${tl('{0} sur {1}', size(sdUsed(st)), size(SD_CAP))}</span></div>
        <ul class="sdf-files">${rows.map(([p, n]) => `<li><span class="sdf-name">${n == null ? icon('folder') : icon('file')}${esc(p)}</span>${n == null ? '<small></small><i></i>' : `<small>${size(n)}</small><button type="button" class="btn small" data-get="${esc(p)}" aria-label="${tl('Télécharger {0}', esc(p))}" title="${tl('Télécharger')}">${icon('save')}</button>`}</li>`).join('') || `<li class="sdf-none">${tl('Carte vide.')}</li>`}</ul>
        <div class="sdf-acts"><button type="button" class="btn small" data-add${on ? ' disabled' : ''}>${icon('upload')}<span>${tl('Ajouter un fichier')}</span></button>
        <button type="button" class="btn small" data-clear${on || !rows.length ? ' disabled' : ''}>${icon('trash')}<span>${tl('Vider la carte')}</span></button></div>
        <p class="sdf-hint" data-msg>${on ? tl('Les fichiers écrits par le programme apparaissent ici. Ajouter ou vider : après l’arrêt de la simulation.') : tl('Gardés avec le projet ; le programme les retrouve au prochain lancement.')}</p></li>`;
    }).join('');
  }
  let target = null;
  function bind() {
    list.addEventListener('click', async e => {
      const li = e.target.closest('li[data-id]'), c = li && cards().find(x => x.id === li.dataset.id); if (!c) return;
      const get = e.target.closest('[data-get]');
      if (get) { const data = fileBytes(sdStore(app.mem(c)), get.dataset.get); if (data) app.save(data, get.dataset.get.split('/').pop()); return; }
      if (e.target.closest('[data-add]')) { target = c; document.getElementById('sdfPick').click(); return; }
      if (e.target.closest('[data-clear]')) {
        if (app.simOn() || !(await app.confirm(tl('Effacer tous les fichiers de {0} ?', c.name)))) return;
        const m = app.mem(c), st = sdStore(m); st.files.clear(); st.dirs.clear(); saveStore(m, st); app.changed(); render();
      }
    });
    document.getElementById('sdfPick').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0], c = target; e.target.value = ''; target = null;
      if (!f || !c || app.simOn()) return;
      const li = list.querySelector(`li[data-id="${CSS.escape(c.id)}"]`), msg = li && li.querySelector('[data-msg]');
      const p = normPath(f.name), m = app.mem(c), st = sdStore(m), old = p && st.files.get(p);
      if (!p) { if (msg) msg.textContent = tl('« {0} » n’est pas un nom court 8.3 (8 caractères au plus, un point, 3 au plus, par exemple MESURES.CSV) : renommez-le.', f.name); return; }
      if (sdUsed(st) - (old ? old.len : 0) + f.size > SD_CAP) { if (msg) msg.textContent = tl('Fichier trop gros : {0} au plus sur la carte.', size(SD_CAP)); return; }
      const data = new Uint8Array(await f.arrayBuffer());
      st.files.set(p, { data, len: data.length, ver: (old && old.ver || 0) + 1 });
      saveStore(m, st); app.changed(); sig = ''; render();
    });
  }
  setInterval(render, 500);
  return { refresh: () => { sig = ''; render(); } };
}
