// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Étape « Conversion » de l'assistant d'import DAO (cadimport.js la monte quand le module existe) : genre retenu pour
// chaque calque gardé, objets à créer (murs, portes, pièces, cheminements, équipements), correspondances des blocs et
// des textes vers des équipements, aperçu chiffré. apply() crée les objets dans le modèle (sans commit : l'assistant fait
// l'unique enregistrement, donc une seule annulation). Les objets créés portent src = 'cad:<étage>' : refaire l'import
// sur le même étage les remplace au lieu de les doubler.
import './cadconvert.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { DEVICES } from '../devices.js';
import { siteIds, uid } from '../site.js';
import { convertCad, applyConversion, blocksIn, CONVERT_KINDS, DEVICE_TYPES, TEXT_PATTERNS } from '../cad/convert.js';
import { guessKind, regexKeywords, keywordsToRegex } from './cadimport-logic.js';
import { addDevice } from './plan-demo.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND_NAMES = () => ({
  walls: tl('Murs'), partitions: tl('Cloisons'), doors: tl('Portes'), windows: tl('Fenêtres'), structure: tl('Structure'),
  elec: tl('Électricité'), cfo: tl('Courants forts'), cfa: tl('Courants faibles'), furniture: tl('Mobilier'), text: tl('Textes'),
  dims: tl('Cotes'), hatch: tl('Hachures'), other: tl('Autres'), skip: tl('Ignorer')
});
const MAKE = () => [['walls', tl('Murs et cloisons'), 'wall'], ['doors', tl('Portes'), 'door'], ['rooms', tl('Pièces nommées'), 'room'], ['power', tl('Cheminements d’énergie'), 'zap'], ['data', tl('Cheminements de données'), 'cableTray'], ['devices', tl('Prises et points d’accès'), 'outlet']];

/** host : élément de l'étape ; o : { ctx, doc, region, layers, toMetre, kinds }. Rend { apply(data, floor, underlay), destroy() }. */
export function createConvertStep(host, o) {
  const doc = o.doc, K = KIND_NAMES();
  const S = {
    kinds: Object.fromEntries([...o.layers].map(id => { const l = doc.layers.find(x => x.id === id); return [id, (o.kinds && o.kinds[id]) || (l ? guessKind(l.name) : 'other')]; })),
    make: { walls: true, doors: true, rooms: true, power: true, data: false, devices: true },
    blocks: {}, texts: TEXT_PATTERNS.map(p => ({ ...p, adv: !regexKeywords(p.re) })), preview: null, busy: false
  };
  const blocks = blocksIn(doc, o.region, o.layers).slice(0, 24);
  for (const b of blocks) if (b.guess) S.blocks[b.name] = b.guess;
  const opts = extra => ({ region: o.region, layers: o.layers, toMetre: o.toMetre, kinds: S.kinds, make: S.make, blocks: S.blocks, texts: S.texts, ...extra });

  /** Motif d'un type d'équipement : mots-clés (avec suffixe) ou expression régulière (mode avancé). */
  function patHtml(p, i) {
    const k = p.adv ? null : regexKeywords(p.re), nm = esc(DEVICES[p.type] ? DEVICES[p.type].name() : p.type);
    const body = k
      ? `<div class="ntCvKws">${k.words.map((w, j) => `<span class="ntCvKw">${esc(w)}<button type="button" data-cvkwdel="${i}:${j}" aria-label="${esc(tl('Retirer {0}', w))}">${icon('x')}</button></span>`).join('')}<input class="inp ntCvKwAdd" data-cvkwadd="${i}" placeholder="${esc(tl('+ mot'))}" aria-label="${esc(tl('Ajouter un mot-clé'))}" spellcheck="false"><select class="sel" data-cvsuf="${i}" aria-label="${esc(tl('Numéro après le mot'))}">${[['none', tl('sans numéro')], ['number', tl('numéro : « AP 12 »')], ['times', tl('nombre : « RJ45 ×2 »')]].map(([v, l]) => `<option value="${v}"${k.suffix === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`
      : `<input class="inp ntCvRe" data-cvtext="${i}" value="${esc(p.re)}" spellcheck="false" aria-label="${esc(tl('Motif (expression régulière)'))}">`;
    return `<div class="ntCvPat"><span>${nm}</span>${body}<label class="ntChk ntCvAdv"><input type="checkbox" data-cvadv="${i}"${p.adv || !k ? ' checked' : ''}${!p.adv && !k ? ' disabled' : ''}><span>${tl('Avancé (expression régulière)')}</span></label></div>`;
  }
  // Entités du DXF par calque dans la zone (o.counts, donné par l'assistant), sinon le nombre de traits du calque.
  const cnt0 = l => (o.counts && o.counts[l.id] != null ? +o.counts[l.id] : l.count || 0);
  const nEnt = () => [...o.layers].reduce((n, id) => { const l = doc.layers.find(x => x.id === id); return n + (l ? cnt0(l) : 0); }, 0) || (S.preview ? S.preview.stats.segs : 0);
  function paint() {
    const layers = [...o.layers].map(id => doc.layers.find(x => x.id === id)).filter(Boolean).sort((a, b) => cnt0(b) - cnt0(a));
    const pv = S.preview;
    const cnt = k => (pv ? (pv[k] || []).length : '…');
    host.innerHTML = `<div class="ntCv">
      <header class="ntCvHead">${icon('wand')}<div><b>${tl('Conversion en objets du plan')}</b><small>${tl('Modèle simplifié : murs reconstruits depuis les traits doubles, pièces depuis les murs fermés. Vérifiez le résultat ; refaire l’import sur cet étage remplace les objets créés.')}</small></div></header>
      <section class="ntCvSec"><h4>${tl('À créer')}</h4><div class="ntCvMake">${MAKE().map(([k, label, ic]) => `<label class="ntCvChip${S.make[k] ? ' on' : ''}"><input type="checkbox" data-cvmake="${k}"${S.make[k] ? ' checked' : ''}>${icon(ic)}<span>${esc(label)}</span><b>${k === 'walls' ? cnt('walls') : k === 'doors' ? cnt('doors') : k === 'rooms' ? cnt('rooms') : k === 'power' ? (pv ? pv.paths.filter(p => p.power).length : '…') : k === 'data' ? (pv ? pv.paths.filter(p => !p.power).length : '…') : cnt('devices')}</b></label>`).join('')}</div>
        <p class="ntCvNote">${S.busy ? tl('Calcul de l’aperçu…') : pv ? tl('Aperçu calculé en {0} ms sur {1} entités.', pv.stats.ms.toLocaleString(isEn ? 'en' : 'fr'), nEnt().toLocaleString(isEn ? 'en' : 'fr')) : ''}</p></section>
      <section class="ntCvSec"><h4>${tl('Genre de chaque calque')}</h4><div class="ntCvLayers" role="list">${layers.map(l => `<label class="ntCvLayer" role="listitem"><i style="background:${esc(l.color || '#888')}"></i><span title="${esc(l.name)}">${esc(l.name)}</span><small>${cnt0(l) ? cnt0(l).toLocaleString(isEn ? 'en' : 'fr') : ''}</small><select class="sel" data-cvkind="${l.id}">${CONVERT_KINDS.map(k => `<option value="${k}"${S.kinds[l.id] === k ? ' selected' : ''}>${esc(K[k] || k)}</option>`).join('')}</select></label>`).join('') || `<p class="mut">${tl('Aucun calque gardé.')}</p>`}</div></section>
      <section class="ntCvSec"><h4>${tl('Blocs → équipements')}</h4>${blocks.length ? `<div class="ntCvBlocks">${blocks.map(b => `<label class="ntCvLayer"><span title="${esc(b.name)}">${esc(b.name)}</span><small>× ${b.n}</small><select class="sel" data-cvblock="${esc(b.name)}"><option value="">${tl('— rien —')}</option>${DEVICE_TYPES.filter(t => DEVICES[t]).map(t => `<option value="${t}"${S.blocks[b.name] === t ? ' selected' : ''}>${esc(DEVICES[t].name())}</option>`).join('')}</select></label>`).join('')}</div>` : `<p class="mut">${tl('Aucun bloc dans la zone.')}</p>`}</section>
      <section class="ntCvSec"><h4>${tl('Textes → équipements')}</h4>${S.texts.map(patHtml).join('')}</section>
      <div class="ntCvBar"><button type="button" class="btn small" data-cv="preview">${icon('eye')}<span>${tl('Recalculer l’aperçu')}</span></button></div>
    </div>`;
  }
  let timer = 0;
  function preview() {
    clearTimeout(timer); S.busy = true; paint();
    timer = setTimeout(() => { try { S.preview = convertCad(doc, opts()); } catch (e) { console.error(e); S.preview = null; } S.busy = false; paint(); }, 30);
  }
  const onChange = e => {
    const t = e.target;
    if (t.dataset.cvmake) S.make[t.dataset.cvmake] = t.checked;
    else if (t.dataset.cvkind) S.kinds[+t.dataset.cvkind] = t.value;
    else if (t.dataset.cvblock != null) { if (t.value) S.blocks[t.dataset.cvblock] = t.value; else delete S.blocks[t.dataset.cvblock]; }
    else if (t.dataset.cvtext != null) S.texts[+t.dataset.cvtext].re = t.value;
    else if (t.dataset.cvadv != null) { const p = S.texts[+t.dataset.cvadv]; p.adv = t.checked || !regexKeywords(p.re); }
    else if (t.dataset.cvsuf != null) { const p = S.texts[+t.dataset.cvsuf], k = regexKeywords(p.re); if (k) p.re = keywordsToRegex(k.words, t.value); }
    else if (t.dataset.cvkwadd != null) { const p = S.texts[+t.dataset.cvkwadd], k = regexKeywords(p.re), w = t.value.trim(); if (k && w && !k.words.includes(w)) p.re = keywordsToRegex([...k.words, w], k.suffix); }
    else return;
    preview();
  };
  const onClick = e => {
    if (e.target.closest('[data-cv="preview"]')) { preview(); return; }
    const del = e.target.closest('[data-cvkwdel]');
    if (del) { const [i, j] = del.dataset.cvkwdel.split(':').map(Number), p = S.texts[i], k = regexKeywords(p.re); if (k && k.words.length > 1) { k.words.splice(j, 1); p.re = keywordsToRegex(k.words, k.suffix); preview(); } }
  };
  // Entrée dans « + mot » : ajoute le mot (comme à la sortie du champ).
  host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.cvkwadd != null) { e.preventDefault(); e.stopPropagation(); e.target.blur(); } }, true);
  host.addEventListener('change', onChange); host.addEventListener('click', onClick);
  paint(); preview();

  return {
    /** Crée les objets dans le modèle (mutation sur place, sans commit). Rend { summary, counts, ms }. */
    apply(data, floor, underlay) {
      const tag = 'cad:' + floor.id, t0 = performance.now();
      const conv = convertCad(doc, opts({ transform: underlay && underlay.transform, floor, tag }));
      const ids = siteIds(data.site), pids = new Set((data.paths || []).map(p => p.id));
      const h = {
        uid: p => uid('', p, ids),
        pathId: () => { let i = 1; while (pids.has('pa' + i)) i++; pids.add('pa' + i); return 'pa' + i; },
        newDevice: (type, d) => (DEVICES[type] ? addDevice(data, type, { x: Math.round(d.x * 20), y: Math.round(d.y * 20) }, null) : null)
      };
      const n = applyConversion(data, floor, conv, tag, h), ms = Math.round(performance.now() - t0);
      const summary = tl('Conversion : {0} murs, {1} portes, {2} pièces, {3} cheminements, {4} équipements ({5} ms).', n.walls, n.doors, n.rooms, n.paths, n.devices, ms);
      return { summary, counts: n, ms };
    },
    /** Choix courants (essais, IA). */
    state: () => ({ kinds: { ...S.kinds }, make: { ...S.make }, blocks: { ...S.blocks }, preview: S.preview && { walls: S.preview.walls.length, doors: S.preview.doors.length, rooms: S.preview.rooms.length, paths: S.preview.paths.length, devices: S.preview.devices.length, ms: S.preview.stats.ms } }),
    destroy() { clearTimeout(timer); host.removeEventListener('change', onChange); host.removeEventListener('click', onClick); host.innerHTML = ''; void isEn; }
  };
}
