// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Sélecteur du catalogue de matériel réel (chargé à la demande, avec le catalogue) : recherche par fabricant, modèle ou
// référence, filtre par genre, résumé de la fiche et lien vers elle. Trois usages : donner un modèle réel à un équipement
// (openModelPicker), poser un équipement neuf d'après un modèle (openCatalog), choisir la référence d'une ligne de
// nomenclature — modules SFP, câble, baies (openRefPicker). Noms de produits : des faits ; ni logo ni image.
import './xlsxui.css';
import './measured.css';
import { tl, isEn, CANCEL } from '../../i18n/index.js';
import { loadCatalog, searchProducts, productsFor, applyModel, clearModel, lostCables, cleanModel, cleanRefs, refKindOf, specLine, notesOf, modelLabel, kindName, KINDS } from '../catalog.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = v => (typeof v === 'number' ? v.toLocaleString(isEn ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 2 }) : String(v));
const ui = () => import('../../school/ui.js');

/** Boîte de choix d'un produit dans list. Rend le produit, 'none' (retirer le modèle) ou null. */
async function pickProduct({ title, sub, list, current, none }) {
  const { dialog } = await ui();
  const kinds = KINDS.filter(k => list.some(p => p.kind === k));
  const body = `<div class="ntCat"><div class="ntCatTools"><input class="inp" type="search" data-q placeholder="${esc(tl('Fabricant, modèle ou référence…'))}" aria-label="${esc(tl('Rechercher dans le catalogue'))}">
    ${kinds.length > 1 ? `<select class="sel" data-kind aria-label="${esc(tl('Genre de matériel'))}"><option value="">${esc(tl('Tout'))}</option>${kinds.map(k => `<option value="${k}">${esc(kindName(k))}</option>`).join('')}</select>` : ''}</div>
    <div class="ntCatList" role="listbox" aria-label="${esc(tl('Produits'))}"></div><p class="ntCatInfo" aria-live="polite"></p>
    <p class="ntXlNote">${esc(tl('Chiffres lus dans les fiches des fabricants (lien ci-dessus) ; un champ que la fiche ne donne pas reste vide. Pas de prix : la nomenclature garde votre propre tarif.'))}</p></div>`;
  let chosen = current ? list.find(p => p.id === current) || null : null;
  const actions = [{ label: CANCEL, value: null }, ...(none ? [{ label: tl('Revenir au modèle générique'), value: 'none' }] : []), { label: tl('Choisir'), value: 'ok', kind: 'primary' }];
  return dialog({ title, head: { icon: 'search', sub }, body, width: 640, cls: 'ntXlDlg', actions,
    onOpen: root => {
      const q = root.querySelector('[data-q]'), kd = root.querySelector('[data-kind]'), box = root.querySelector('.ntCatList'), info = root.querySelector('.ntCatInfo');
      const showInfo = () => { info.innerHTML = chosen ? `<b>${esc(modelLabel(chosen))}</b> · ${esc(specLine(chosen, fmt))}${chosen.url ? ` · <a href="${esc(chosen.url)}" target="_blank" rel="noopener noreferrer">${esc(tl('fiche du fabricant'))}</a>` : ''}${notesOf(chosen).map(n => '<br>' + esc(n)).join('')}` : esc(tl('Choisissez un produit dans la liste.')); };
      const draw = () => {
        const rows = searchProducts(list, q.value, kd ? kd.value : '').slice(0, 200);
        box.innerHTML = rows.length ? rows.map(p => `<button type="button" role="option" class="ntCatRow${chosen && chosen.id === p.id ? ' on' : ''}" aria-selected="${!!(chosen && chosen.id === p.id)}" data-id="${esc(p.id)}"><b>${esc(p.vendor)} ${esc(p.model)}</b><i>${esc(p.pn)}</i><small>${esc(specLine(p, fmt))}</small></button>`).join('') : `<p class="ntCatEmpty">${esc(tl('Aucun produit ne correspond.'))}</p>`;
        showInfo();
      };
      q.addEventListener('input', draw); if (kd) kd.addEventListener('change', draw);
      box.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (!b) return; chosen = list.find(p => p.id === b.dataset.id) || null; draw(); });
      box.addEventListener('dblclick', e => { if (e.target.closest('[data-id]')) { const ok = [...root.querySelectorAll('footer button, .sActions button')].pop(); if (ok) ok.click(); } });
      draw(); setTimeout(() => q.focus(), 30);
    },
    onAction: v => (v === 'ok' ? (chosen ? chosen : false) : v === 'none' ? 'none' : undefined) });
}

/** Donne un modèle réel à l'équipement devId (ou le lui retire). Rend true si le projet a changé. */
export async function openModelPicker(ctx, devId) {
  const d = ctx.data().devices.find(x => x.id === devId); if (!d) return false;
  const list = productsFor(await loadCatalog(), d.type);
  if (!list.length) { ctx.status(tl('Le catalogue n’a pas encore de modèle réel pour ce type d’équipement.'), 'warn'); return false; }
  const p = await pickProduct({ title: tl('Modèle réel de {0}', d.name), sub: d.model ? modelLabel(d.model) : tl('modèle générique'), list, current: d.model && d.model.id, none: !!d.model });
  if (!p) return false;
  const live = ctx.data().devices.find(x => x.id === devId); if (!live) return false;
  const next = p === 'none' ? clearModel(live) : applyModel(live, p);
  if (!next) { ctx.status(tl('Ce modèle ne convient pas à cet équipement.'), 'warn'); return false; }
  const lost = lostCables(ctx.data(), live, next);
  if (lost.length) { ctx.status(tl('Changement refusé : {0:# câble est branché|# câbles sont branchés} sur des ports que ce modèle n’a pas. Débranchez-les d’abord.', lost.length), 'warn'); return false; }
  for (const k of Object.keys(live)) delete live[k];
  Object.assign(live, next);
  ctx.commit();
  ctx.status(p === 'none' ? tl('{0} : retour au modèle générique.', live.name) : tl('{0} : {1}. Ports, PoE, puissance et encombrement suivent la fiche.', live.name, modelLabel(live.model)), 'ok');
  return true;
}
/** Pose un équipement neuf d'après un modèle du catalogue. Rend l'équipement ou null. */
export async function openCatalog(ctx, at = {}) {
  const list = (await loadCatalog()).filter(p => p.type);
  const p = await pickProduct({ title: tl('Catalogue de matériel'), sub: tl('{0} produits de {1} fabricants', list.length, new Set(list.map(x => x.vendor)).size), list });
  if (!p || p === 'none') return null;
  const d = ctx.newDevice(p.type, { x: at.x ?? 80, y: at.y ?? 80 }), next = applyModel(d, p);
  if (next) Object.assign(d, next);
  if (ctx.select) ctx.select({ kind: 'dev', id: d.id });
  ctx.commit();
  ctx.status(tl('{0} posé : {1}.', d.name, modelLabel(d.model)), 'ok');
  return d;
}
/** Référence du catalogue pour une ligne de nomenclature (clé « sfp », « rack », « box_cat6 »…). */
export async function openRefPicker(ctx, key) {
  const rk = refKindOf(key); if (!rk) return false;
  const list = (await loadCatalog()).filter(p => p.kind === rk.kind && (!rk.cat || p.cat === rk.cat));
  if (!list.length) { ctx.status(tl('Le catalogue n’a pas de référence pour cette ligne.'), 'warn'); return false; }
  const data = ctx.data(), cur = data.refs && data.refs[key];
  const p = await pickProduct({ title: tl('Référence de la ligne'), sub: cur ? modelLabel(cur) : kindName(rk.kind), list, current: cur && cur.id, none: !!cur });
  if (!p) return false;
  const refs = { ...(ctx.data().refs || {}) };
  if (p === 'none') delete refs[key]; else refs[key] = cleanModel(p);
  ctx.data().refs = cleanRefs(refs);
  ctx.commit();
  return true;
}
