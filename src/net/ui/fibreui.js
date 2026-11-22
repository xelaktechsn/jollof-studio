// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Calculette du bilan optique d'une liaison fibre, ouverte depuis l'inspecteur d'un câble (chargée à la demande) :
// openBudget(ctx, cableId). On y règle le support du câble (type de fibre, longueur, épissures, atténuateur, cordon de
// conditionnement de mode) et on essaie un autre module (« et si… ») ; le tableau détaille la perte (fibre, connexions,
// épissures) face à ce que les modules tolèrent, avec la marge. Les calculs sont ceux de fibre.js (modèle simplifié, dit à
// l'écran) ; chaque réglage du câble est un geste annulable (ctx.commit()).
import { tl, isEn, dec } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { overlay } from './crimp.js';
import { FIBRE_TYPES, FIBRE_IDS, MODULES, MODULE_IDS, moduleOf, fibreChannel, fibreLink, budgetRows } from '../fibre.js';
import { fibreLinks } from '../checks/fibre.js';
import { NET } from '../limits.js';
import './crimp.css';
import './fibreui.css';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dB = x => (x == null ? '—' : (Math.round(x * 100) / 100).toLocaleString(isEn ? 'en' : 'fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' dB');
const WHY = {
  nomodule: () => tl('il manque un module à un bout'), mismatch: () => tl('modules différents aux deux bouts'),
  media: () => tl('support incompatible (cuivre et fibre)'), fibretype: () => tl('ce module ne va pas avec cette fibre'),
  mcp: () => tl('LX sur multimode : il faut un cordon de conditionnement de mode'), reach: () => tl('plus long que la portée du module'),
  budget: () => tl('perte supérieure à ce que les modules tolèrent')
};

/** Ouvre la calculette pour le câble cableId (ctx : contexte des vues du plan réseau). Rend { close() } ou null. */
export function openBudget(ctx, cableId) {
  const cable = () => (ctx.data().cables || []).find(c => c.id === cableId) || null;
  if (!cable()) return null;
  const O = overlay(ctx.host, { label: tl('Bilan optique'), cls: 'ntFbOv' }), { dlg } = O;
  const st = { mod: '' }; // module essayé ('' : ceux qui sont posés)
  const name = id => (ctx.nameOf ? ctx.nameOf(id) : id);

  function state() {
    const c = cable(); if (!c) return null;
    let L = null;
    try { L = fibreLinks(ctx.data(), ctx.lan ? ctx.lan() : null).find(x => x.cables.some(k => k.id === cableId)) || null; } catch (e) { L = null; }
    const ch = L ? L.ch : fibreChannel([c], 0);
    const try_ = st.mod ? fibreLink(ch, st.mod, st.mod) : null;
    const link = try_ || (L ? L.link : null);
    return { c, L, ch, link, tried: !!try_ };
  }

  function render() {
    const S = state(); if (!S) { close(); return; }
    const { c, L, ch, link } = S, fib = c.media === 'fibre';
    const sub = L ? tl('{0} ↔ {1}', name(L.a.n), name(L.b.n)) + (L.cables.length > 1 ? ' · ' + tl('{0} câbles bout à bout, {1:# traversée|# traversées}', L.cables.length, L.passes) : '') : tl('Câble seul (liaison incomplète)');
    const placed = L ? [L.modA, L.modB].map(x => x || tl('aucun')).join(' / ') : tl('aucun');
    const mods = MODULE_IDS.filter(id => MODULES[id].media !== 'copper');
    const rows = fib && link && link.nm ? budgetRows(ch, link) : fib ? budgetRows(ch, { module: st.mod || (L && (L.modA || L.modB)) || null, nm: (moduleOf(st.mod) || moduleOf(L && (L.modA || L.modB)) || {}).nm || 1310 }) : [];
    const ok = link && link.up && !link.overload, margin = link && link.budget != null && link.loss != null ? link.budget - link.loss : null;
    const verdict = !fib ? tl('Câble cuivre : pas de bilan optique.') : !link ? tl('Choisissez un module pour calculer le bilan.')
      : link.up ? (link.overload ? tl('Le récepteur sature : il faut au moins {0} de perte en plus (atténuateur).', dB(link.overload)) : tl('La liaison passe : {0}.', link.speed >= 1000 ? dec(link.speed / 1000) + ' Gb/s' : link.speed + ' Mb/s'))
        : tl('Pas de lien : {0}.', (link.need === 'mcp' ? WHY.mcp : WHY[link.why] || (() => link.why))());
    const pct = link && link.budget ? Math.max(0, Math.min(100, (link.loss / link.budget) * 100)) : 0;
    dlg.innerHTML = `<div class="nt-hd">${icon('fibre')}<div class="nt-ttl"><b>${esc(tl('Bilan optique'))}</b><span>${esc(sub)}</span></div>
      <button class="nt-x" data-act="close" aria-label="${esc(tl('Fermer'))}" title="${esc(tl('Fermer'))}">${icon('x')}</button></div>
    <div class="ntFbBody">
      <section class="ntFbSide">
        <h4>${esc(tl('Câble {0}', c.tag || c.id))}</h4>
        <label class="ntFbRow"><span>${esc(tl('Support'))}</span><select data-k="media"><option value="copper"${fib ? '' : ' selected'}>${esc(tl('Cuivre'))}</option><option value="fibre"${fib ? ' selected' : ''}>${esc(tl('Fibre optique'))}</option></select></label>
        ${fib ? `<label class="ntFbRow"><span>${esc(tl('Type de fibre'))}</span><select data-k="fibre">${FIBRE_IDS.map(t => `<option value="${t}"${c.fibre === t ? ' selected' : ''}>${esc(FIBRE_TYPES[t].name)} · ${FIBRE_TYPES[t].mode === 'mmf' ? esc(tl('multimode')) : esc(tl('monomode'))}</option>`).join('')}</select></label>
        <label class="ntFbRow"><span>${esc(tl('Longueur (m)'))}</span><input type="number" data-k="len" min="0.1" max="100000" step="1" value="${esc(c.len)}"></label>
        <label class="ntFbRow"><span>${esc(tl('Épissures'))}</span><input type="number" data-k="splices" min="0" max="200" step="1" value="${esc(c.splices || 0)}"></label>
        <label class="ntFbRow"><span>${esc(tl('Atténuateur (dB)'))}</span><input type="number" data-k="attn" min="0" max="30" step="0.5" value="${esc(c.attn || 0)}"></label>
        <label class="ntFbChk"><input type="checkbox" data-k="mcp"${c.mcp ? ' checked' : ''}><span>${esc(tl('Cordon de conditionnement de mode (LX sur multimode)'))}</span></label>` : ''}
        <h4>${esc(tl('Modules'))}</h4>
        <div class="ntFbPlaced">${esc(tl('Posés : {0}', placed))}</div>
        ${fib ? `<label class="ntFbRow"><span>${esc(tl('Essayer'))}</span><select data-k="try"><option value="">${esc(tl('les modules posés'))}</option>${mods.map(id => `<option value="${id}"${st.mod === id ? ' selected' : ''}>${esc(id)}</option>`).join('')}</select></label>` : ''}
      </section>
      <section class="ntFbMain">
        ${fib ? `<table class="ntFbTbl"><tbody>${rows.map(r => `<tr class="ntFbR-${r.key}"><th>${esc(r.label)}</th><td class="ntFbDet">${esc(r.detail)}</td><td class="ntFbDb">${dB(r.db)}</td></tr>`).join('')}</tbody></table>
        <div class="ntFbMeter" role="img" aria-label="${esc(tl('Perte : {0} sur {1}', dB(link && link.loss), dB(link && link.budget)))}"><i class="${ok ? 'ntFbOk' : 'ntFbBad'}" style="width:${pct.toFixed(1)}%"></i></div>` : ''}
        <div class="ntFbVerdict ${!fib || !link ? '' : ok ? 'ntFbOk' : 'ntFbBad'}" role="status">${esc(verdict)}${link && link.reach ? ` <span>${esc(tl('Portée du module sur ce support : {0} m.', link.reach))}</span>` : ''}${margin != null && link.up && link.basis === 'power' && margin < NET.FIBRE_MARGIN_DB.v ? ` <span>${esc(tl('Marge sous les {0} dB conseillés.', NET.FIBRE_MARGIN_DB.v))}</span>` : ''}</div>
        ${S.tried ? `<div class="ntFbNote">${esc(tl('Essai : le même module {0} aux deux bouts, rien n’est changé dans le plan.', st.mod))}</div>` : ''}
      </section>
    </div>
    <div class="nt-ft"><span class="ntFbNote">${esc(tl('Modèle simplifié : valeurs maximales de la TIA-568 et pertes de canal de l’IEEE 802.3 (lues via FOA et Fluke), fiches des modules Cisco. Une connexion par traversée de panneau.'))}</span><span class="nt-sp"></span><button class="btn small" data-act="close">${esc(tl('Fermer'))}</button></div>`;
  }

  function set(k, v) {
    const c = cable(); if (!c) return;
    if (k === 'media') { if (v === 'fibre') { c.media = 'fibre'; c.fibre = c.fibre || 'om4'; c.splices = c.splices || 0; } else { delete c.media; delete c.fibre; delete c.splices; delete c.attn; delete c.mcp; } }
    else if (k === 'fibre') c.fibre = v;
    else if (k === 'len') { const n = +v; if (!(n > 0)) return; c.len = Math.min(100000, n); }
    else if (k === 'splices') c.splices = Math.max(0, Math.min(200, Math.round(+v || 0)));
    else if (k === 'attn') { const n = Math.max(0, Math.min(30, +v || 0)); if (n) c.attn = n; else delete c.attn; }
    else if (k === 'mcp') { if (v) c.mcp = true; else delete c.mcp; }
    ctx.commit();
  }
  let off = null;
  const close = () => { O.close(); if (typeof off === 'function') off(); off = null; };
  dlg.addEventListener('click', e => { if (e.target.closest('[data-act="close"]')) close(); });
  dlg.addEventListener('change', e => {
    const el = e.target.closest('[data-k]'); if (!el) return;
    if (el.dataset.k === 'try') st.mod = el.value; else set(el.dataset.k, el.type === 'checkbox' ? el.checked : el.value);
    render();
    const again = dlg.querySelector(`[data-k="${el.dataset.k}"]`); if (again) again.focus();
  });
  dlg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  O.ov.addEventListener('mousedown', e => { if (e.target === O.ov) close(); });
  off = ctx.onChange ? ctx.onChange(() => { if (O.isOpen()) render(); }) : null;
  render(); dlg.focus();
  return { close };
}
