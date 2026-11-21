// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mise à jour d'un fond de plan depuis une nouvelle version du même fichier DXF/DWG (chargée à la demande) :
// openRevision(ctx, file, { floor, underlay, old, done }). Le fichier est lu (worker), la même zone absolue est gardée
// (origine du dessin + zone), les mêmes calques par leur nom ; on compare l'ancien et le nouveau paquet (par poignée DXF
// quand les deux en portent, sinon par géométrie au millimètre), on montre les changements calque par calque, et
// « Appliquer » remplace le fond en gardant sa position sur l'étage (donc le réseau dessiné reste aligné) et ses réglages
// de calques, en UN seul ctx.commit() (Ctrl+Z revient à l'ancienne version). En option : refaire la conversion en modèle
// pour les seuls calques changés, dans les zones changées (modèle simplifié).
import './plan-underlay.css';
import './crimp.css';
import './cadimport.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';
import { bytesToDataUrl, dataUrlToBytes, newBlobId, cleanUnderlay, rememberBlob } from '../cad/store.js';
import { guessKind, PRESETS } from './cadimport-logic.js';
import { diffUnderlays, mergeLayerSettings, regionFor, changeBoxes } from './underlay-edit.js';
import { ulMatrix } from './plan-underlay-render.js';
import { uid, siteIds } from '../site.js';

const MODS = import.meta.glob(['../cad/dxf.js', '../cad/dwg.js', '../cad/underlay.js', '../cad/convert.js']);
const mod = p => (MODS[p] ? MODS[p]() : Promise.resolve(null));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString(isEn ? 'en' : 'fr-FR', { maximumFractionDigits: d }) : '—');

export function openRevision(ctx, file, o) {
  const O = overlay(ctx.host, { label: tl('Nouvelle version du fond'), cls: 'ntUrOv' }), { dlg } = O;
  dlg.classList.add('ntUr');
  const R = { busy: null, doc: null, un: null, pk: null, diff: null, extra: new Set(), extraList: [], highlight: true, reconv: false, err: null, ac: new AbortController() };
  const u = o.underlay, f = o.floor;
  const converted = () => f.walls.some(w => String(w.src || '').startsWith('cad:' + f.id)) || f.rooms.some(r => String(r.src || '').startsWith('cad:' + f.id));
  const close = () => { R.ac.abort(); O.close(); };
  function render() {
    const d = R.diff;
    let body;
    if (R.err) body = `<p class="ntCiErr">${icon('alert')}<span>${esc(R.err)}</span></p>`;
    else if (R.busy) body = `<div class="ntCiProg"><div class="ntCiProgHd">${icon('file')}<b>${esc(file.name)}</b></div><div class="ntCiBar${R.busy.f == null ? ' ind' : ''}"><i style="width:${R.busy.f == null ? 30 : Math.round(R.busy.f * 100)}%"></i></div><div class="ntCiProgFt"><span>${esc(R.busy.label)}</span></div></div>`;
    else if (d) {
      const T = d.total, none = !T.added && !T.removed && !T.changed;
      body = `<p class="ntUrSum ${none ? 'same' : ''}">${icon(none ? 'check' : 'history')}<span>${esc(none ? tl('Aucun changement dans la zone du fond.') : tl('{0} ajoutée(s), {1} retirée(s), {2} modifiée(s) (entités).', T.added, T.removed, T.changed))}</span></p>
        <p class="mut">${esc(d.byHandle ? tl('Comparaison par poignée DXF : une entité modifiée garde sa poignée.') : tl('Comparaison géométrique au millimètre (le fichier ne garde pas de poignées) : une entité déplacée compte comme retirée puis ajoutée.'))}</p>
        <div class="ntUrTbl" role="table" aria-label="${esc(tl('Changements par calque'))}"><div role="row" class="hd"><span>${esc(tl('Calque'))}</span><span>${esc(tl('Ajoutées'))}</span><span>${esc(tl('Retirées'))}</span><span>${esc(tl('Modifiées'))}</span></div>
        ${d.layers.filter(l => l.added || l.removed || l.changed).slice(0, 200).map(l => `<div role="row"><span title="${esc(l.name)}">${esc(l.name)}</span><span class="add">${l.added || ''}</span><span class="del">${l.removed || ''}</span><span class="chg">${l.changed || ''}</span></div>`).join('') || `<div role="row"><span class="mut">${esc(tl('Aucun calque changé.'))}</span></div>`}</div>
        ${R.extraList.length ? `<details class="ntUrExtra"><summary>${esc(tl('{0} calque(s) absent(s) du fond actuel', R.extraList.length))}</summary>${R.extraList.map(l => `<label class="ntChk"><input type="checkbox" data-urx="${l.id}"${R.extra.has(l.id) ? ' checked' : ''}><span>${esc(l.name)}</span></label>`).join('')}<p class="mut">${esc(tl('Cochés, ils sont ajoutés au fond (la comparaison est refaite).'))}</p></details>` : ''}
        <label class="ntChk"><input type="checkbox" data-ur="hl"${R.highlight ? ' checked' : ''}><span>${esc(tl('Surligner les changements sur le plan (vert : ajouté, rouge : retiré)'))}</span></label>
        <label class="ntChk${converted() && !none ? '' : ' off'}"><input type="checkbox" data-ur="rc"${R.reconv ? ' checked' : ''}${converted() && !none ? '' : ' disabled'}><span>${esc(tl('Refaire la conversion en murs, pièces, cheminements pour les calques changés, dans les zones changées (modèle simplifié)'))}</span></label>
        <p class="mut">${esc(tl('Position sur l’étage, calques masqués, verrouillés ou recolorés : gardés. Ctrl+Z revient à l’ancienne version.'))}</p>`;
    } else body = '';
    dlg.innerHTML = `<div class="nt-hd">${icon('history')}<div class="nt-ttl"><b>${esc(tl('Nouvelle version du fond'))}</b><span>${esc(u.source.file)} → ${esc(file.name)}</span></div><button class="nt-x" data-ur="close" aria-label="${esc(tl('Fermer'))}">${icon('x')}</button></div>
      <div class="ntUrBody">${body}</div>
      <div class="ntCiFoot"><span class="grow"></span><button type="button" class="btn" data-ur="close">${esc(tl('Annuler l’import'))}</button><button type="button" class="btn primary" data-ur="apply"${d && !R.busy ? '' : ' disabled'}>${icon('check')}<span>${esc(tl('Appliquer'))}</span></button></div>`;
  }
  const busy = (label, f0 = null) => { R.busy = { label, f: f0 }; render(); };

  async function read() {
    try {
      busy(tl('Lecture du fichier'), 0);
      const dxf = await mod('../cad/dxf.js'); if (!dxf) throw new Error(tl('Le lecteur DXF n’est pas disponible.'));
      let doc;
      if (/\.dwg$/i.test(file.name)) {
        const dwg = await mod('../cad/dwg.js');
        if (!dwg || !(await dwg.canConvertDwg().catch(() => false))) throw new Error(tl('Les fichiers DWG ne s’ouvrent que sur l’application de bureau : enregistrez le plan en DXF.'));
        busy(tl('Conversion du DWG en DXF'));
        const conv = await dwg.convertDwg(file, { signal: R.ac.signal });
        try { doc = await dxf.parseDxf(conv.dxf, { size: conv.size, signal: R.ac.signal, onProgress: x => busy(tl('Lecture du DXF converti'), x) }); } finally { if (conv.cleanup) conv.cleanup(); }
      } else doc = await dxf.openCad(file, { signal: R.ac.signal, onProgress: x => busy(tl('Lecture du fichier'), x) });
      R.doc = doc;
      // Calques : ceux du fond actuel (par nom) ; les autres sont proposés, décochés.
      const keep = new Set(u.layers.map(l => l.name));
      R.extraList = doc.layers.filter(l => !keep.has(l.name) && l.count > 0 && PRESETS.clean.includes(guessKind(l.name)));
      await compare();
    } catch (e) { if (e && e.name === 'AbortError') return; console.error(e); R.busy = null; R.err = (e && e.message) || String(e); render(); }
  }
  async function compare() {
    busy(tl('Comparaison des versions'));
    await new Promise(r => setTimeout(r, 20));
    const um = await mod('../cad/underlay.js'); if (!um) throw new Error(tl('Le module des fonds de plan n’est pas disponible.'));
    const names = new Set(u.layers.map(l => l.name)), layers = new Set(R.doc.layers.filter(l => names.has(l.name) || R.extra.has(l.id)).map(l => l.id));
    R.region = regionFor(u, R.doc);
    R.pk = um.packUnderlay(R.doc, { region: R.region, layers, toMetre: u.toMetre, ents: true });
    R.un = um.unpackUnderlay(R.pk.meta, R.pk.bytes);
    // Ancien paquet pas encore déballé (étage jamais montré) : on le déballe ici.
    if (!o.old) { const url = (ctx.data().blobs || {})[u.id]; if (url) o.old = um.unpackUnderlay(u.pack || {}, await dataUrlToBytes(url)); }
    const oldNames = new Map(u.layers.map(l => [l.id, l.name])), newNames = (R.pk.meta.layers || []).map(l => l.name);
    R.diff = o.old ? diffUnderlays(o.old, R.un, (un, l) => (un === R.un ? newNames[l] : oldNames.get(l)) || '?', R.pk.meta.step || 0.001) : { layers: [], added: new Float32Array(0), removed: new Float32Array(0), total: { added: 0, removed: 0, changed: 0 }, byHandle: false };
    R.busy = null; render();
  }

  /** Reconversion locale : calques changés seulement, objets créés gardés s'ils touchent une zone changée. */
  async function reconvert(d, n) {
    const m = await mod('../cad/convert.js'); if (!m || !m.convertCad || !m.applyConversion) return null;
    const changed = new Set(R.diff.layers.filter(l => l.added || l.removed || l.changed).map(l => l.name));
    const layers = new Set(R.doc.layers.filter(l => changed.has(l.name)).map(l => l.id)); if (!layers.size) return null;
    // Zones changées dans le repère de l'étage.
    const T = ulMatrix(u.transform), H = R.un.bbox ? R.un.bbox[3] : 0, toF = (x, y) => T.to(x, H - y);
    const boxes = changeBoxes(Float32Array.from([...R.diff.added, ...R.diff.removed])).map(b => { const P = [toF(b[0], b[1]), toF(b[2], b[1]), toF(b[0], b[3]), toF(b[2], b[3])]; return [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))]; });
    const hit = pts => pts.some(p => boxes.some(b => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]));
    const base = 'cad:' + f.id, mine = x => String(x.src || '').startsWith(base);
    // Anciens objets convertis dans les zones changées : retirés (avec les portes de leurs murs).
    const gone = new Set(f.walls.filter(w => mine(w) && hit([w.a, w.b])).map(w => w.id));
    f.walls = f.walls.filter(w => !gone.has(w.id)); f.doors = f.doors.filter(x => !gone.has(x.wall));
    f.rooms = f.rooms.filter(r => !(mine(r) && hit(r.poly)));
    d.paths = (d.paths || []).filter(p => !(mine(p) && p.floor === f.id && hit(p.pts)));
    const kinds = Object.fromEntries(R.doc.layers.map(l => [l.id, guessKind(l.name)])), tag = base + ':r' + n;
    const conv = m.convertCad(R.doc, { region: R.region, layers, toMetre: u.toMetre, transform: u.transform, kinds, make: { devices: false }, floor: f, tag });
    conv.walls = conv.walls.filter(w => hit([w.a, w.b])); const kept = new Set(conv.walls);
    conv.doors = conv.doors.filter(x => kept.has(x.wall)); conv.rooms = conv.rooms.filter(r => hit(r.poly)); conv.paths = conv.paths.filter(p => hit(p.pts)); conv.devices = [];
    const ids = siteIds(d.site), pids = new Set((d.paths || []).map(p => p.id));
    const cnt = m.applyConversion(d, f, conv, tag, { uid: p => uid('', p, ids), pathId: () => { let i = 1; while (pids.has('pa' + i)) i++; pids.add('pa' + i); return 'pa' + i; }, newDevice: () => null });
    return { removed: gone.size, ...cnt };
  }
  async function apply() {
    if (!R.diff || R.busy) return;
    try {
      busy(tl('Mise à jour du fond'));
      const url = await bytesToDataUrl(R.pk.bytes), d = ctx.data(), id = newBlobId(), n = (u.rev ? u.rev.n : 0) + 1;
      const packed = (R.pk.meta.layers || []).map((l, i) => ({ id: l.id ?? i, name: l.name, color: l.color }));
      const head = { ...R.pk.meta }; delete head.layers;
      const nu = cleanUnderlay({ ...u, id, source: { ...u.source, file: file.name }, origin: R.doc.origin, region: R.region, layers: mergeLayerSettings(u.layers, packed), pack: head,
        stats: { segs: R.pk.meta.segs || 0, texts: R.pk.meta.texts || 0, bytes: R.pk.bytes.length }, rev: { n, file: file.name, at: Date.now(), ...R.diff.total } });
      rememberBlob(u.id, d.blobs[u.id]); delete d.blobs[u.id];
      d.blobs[id] = url; rememberBlob(id, url); d.underlays[f.id] = nu;
      let rc = null; if (R.reconv) { try { rc = await reconvert(d, n); } catch (e) { console.error(e); } }
      ctx.commit();
      const diff = R.highlight ? R.diff : null, un = R.un;
      close();
      o.done(id, un, diff);
      ctx.status(tl('Fond mis à jour (version {0}) : {1} ajoutée(s), {2} retirée(s), {3} modifiée(s).', n + 1, R.diff.total.added, R.diff.total.removed, R.diff.total.changed) + (rc ? ' ' + tl('Reconversion : {0} objet(s) retiré(s), {1} mur(s), {2} pièce(s), {3} cheminement(s).', rc.removed, rc.walls, rc.rooms, rc.paths) : ''), 'ok');
      if (import.meta.env && import.meta.env.DEV && window.__jollof) window.__jollof.cadRevLast = { total: R.diff.total, byHandle: R.diff.byHandle, layers: R.diff.layers.slice(0, 20), rc };
    } catch (e) { console.error(e); R.busy = null; R.err = (e && e.message) || String(e); render(); }
  }
  dlg.addEventListener('click', ev => { const t = ev.target.closest('[data-ur]'); if (!t) return; if (t.dataset.ur === 'close') close(); else if (t.dataset.ur === 'apply') apply(); });
  dlg.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.ur === 'hl') R.highlight = t.checked;
    else if (t.dataset.ur === 'rc') R.reconv = t.checked;
    else if (t.dataset.urx != null) { const k = +t.dataset.urx; t.checked ? R.extra.add(k) : R.extra.delete(k); compare().catch(e => { R.err = e.message; render(); }); }
  });
  dlg.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } });
  render(); read();
  return { close };
}
