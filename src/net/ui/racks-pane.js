// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Inspecteur de la vue Baies : baie (taille, charge, valeurs de conception, bilan électrique, PDU, onduleurs, conseils,
// problèmes), équipement de baie sans rôle réseau (place, puissance, fiche), et résumé de toutes les baies. Rend du HTML ;
// les changements sont lus par la vue (data-rkf : champ de la baie, data-rkd : champ de l'équipement, data-rka : action).
import { MOUNT, RACK_U, RACK_W, RACK_D, PRESETS } from '../rack.js';
import { DEVICES } from '../devices.js';

const f1 = (v, isEn) => (v == null || !Number.isFinite(+v) ? '—' : (Math.round(v * 10) / 10).toLocaleString(isEn ? 'en-GB' : 'fr-FR'));
const gauge = (pct, cls = '') => `<div class="ntRkGauge ${pct > 100 ? 'bad' : pct > 80 ? 'warn' : ''} ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
const opts = (list, cur, label = v => v) => { const all = list.includes(cur) ? list : [...list, cur].sort((a, b) => a - b); return all.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${label(v)}</option>`).join(''); };

/** Étages connus du site (vue Plans) : [[id, nom]]. */
function floorsOf(data) {
  const out = [];
  for (const b of (data.site && data.site.buildings) || []) for (const f of b.floors || []) out.push([f.id, `${b.name ? b.name + ' · ' : ''}${f.name || f.id}`]);
  return out;
}
const issuesHtml = (ctx, list, none) => (list.length
  ? `<ul class="ntIss">${list.slice(0, 14).map(i => `<li class="${i.kind}" data-rkiss="${ctx.esc(i.id || '')}"><code>${i.code}</code> ${ctx.esc(i.text)}</li>`).join('')}</ul>`
  : `<p class="ntOk">${ctx.icon('check')}${none || ctx.tl('Aucun problème dans cette baie.')}</p>`);

/** Inspecteur d'une baie. s : rackSummary ; list : problèmes de la baie et de ses équipements. */
export function rackPane(ctx, r, s, list) {
  const { tl, esc, icon, isEn } = ctx, data = ctx.data(), fl = floorsOf(data);
  const field = (label, html, tip = '') => `<label class="ntF"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${label}</span>${html}</label>`;
  const num = (k, v, a = '') => `<input class="inp" type="number" data-rkf="${k}" value="${esc(v)}" ${a}>`;
  const P = PRESETS[r.kind];
  let h = `<div class="ntHead">${icon('rack')}<div><b>${esc(r.name)}</b><small>${r.kind === 'wall' ? tl('Coffret mural') : tl('Baie au sol')} · ${r.u} U · ${r.w} × ${r.d} mm</small></div><button type="button" class="tb" data-rka="delrack" data-tip="${tl('Supprimer la baie (ses équipements restent dans le projet)')}" aria-label="${tl('Supprimer la baie')}">${icon('trash')}</button></div>`;
  h += `<section class="ntSec">${field(tl('Nom'), `<input class="inp" data-rkf="name" value="${esc(r.name)}" maxlength="24">`)}
    ${field(tl('Genre'), `<select class="sel" data-rkf="kind"><option value="floor"${r.kind === 'floor' ? ' selected' : ''}>${tl('Baie au sol')}</option><option value="wall"${r.kind === 'wall' ? ' selected' : ''}>${tl('Coffret mural')}</option></select>`)}
    ${field(tl('Hauteur'), `<select class="sel" data-rkf="u">${opts(RACK_U, r.u, v => v + ' U')}</select>`)}
    ${field(tl('Largeur'), `<select class="sel" data-rkf="w">${opts(RACK_W, r.w, v => v + ' mm')}</select>`)}
    ${field(tl('Profondeur'), `<select class="sel" data-rkf="d">${opts(RACK_D, r.d, v => v + ' mm')}</select>`)}
    ${field(tl('Profondeur utile (mm)'), num('depth', r.depth, 'min="100" max="1400" step="0.1"'), tl('Entre les rails avant et arrière. Baie de référence : {0} à {1} mm (rails réglables).', f1(P.depth, isEn), f1(P.depthMax, isEn)))}
    ${field(tl('Charge admise (kg)'), num('load', r.load, 'min="1" max="5000"'), tl('Charge statique de la fiche de la baie ({0} : {1} kg).', P.ref, P.load))}
    ${field(tl('Étage'), fl.length ? `<select class="sel" data-rkf="floor"><option value="">—</option>${fl.map(([id, n]) => `<option value="${esc(id)}"${id === r.floor ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<input class="inp" data-rkf="floor" value="${esc(r.floor)}" placeholder="${tl('aucun plan d’étage')}">`)}</section>`;
  // Bilan.
  const kgPct = r.load ? (s.kg / r.load) * 100 : 0, heatPct = r.heat ? (s.heatW / r.heat) * 100 : 0;
  h += `<section class="ntSec"><h4>${tl('Bilan de la baie')}</h4>
    <table class="ntTable ntRkTot"><tr><th>${tl('Unités')}</th><td>${tl('{0} U occupés, {1} libres', s.usedU, s.freeU)}</td></tr>
    <tr><th>${tl('Poids')}</th><td>${f1(s.kg, isEn)} / ${f1(r.load, isEn)} kg${s.unknownKg.length ? ` <small class="mut">${tl('(+ {0} sans poids connu)', s.unknownKg.length)}</small>` : ''}${gauge(kgPct)}</td></tr>
    <tr><th>${tl('Puissance consommée')}</th><td>${f1(s.w, isEn)} W <small class="mut">(${s.basis === 'max' ? tl('maximale') : tl('typique')})</small><br><small class="mut">${tl('typique {0} W, maximale {1} W', f1(s.typW, isEn), f1(s.maxW, isEn))}</small>${s.poeW ? `<br><small class="mut">${tl('dont {0} W de PoE réservé par les switchs', f1(s.poeW, isEn))}</small>` : ''}</td></tr>
    <tr><th>${tl('Puissance apparente')}</th><td>${f1(s.va, isEn)} VA <small class="mut">(${tl('facteur de puissance {0}', f1(r.pf, isEn))})</small></td></tr>
    <tr><th>${tl('Chaleur')}</th><td>${f1(s.heatW, isEn)} W · ${f1(s.btu, isEn)} BTU/h${gauge(heatPct)}</td></tr></table>
    ${s.guess.length ? `<p class="mut">${tl('{0} appareil(s) sans consommation typique dans sa fiche : sa puissance maximale est comptée (majorant). Saisissez une puissance mesurée dans son inspecteur.', s.guess.length)}</p>` : ''}</section>`;
  if (s.pdus.length) h += `<section class="ntSec"><h4>PDU</h4><table class="ntTable"><tr><th>${tl('PDU')}</th><th>${tl('Taux de charge')}</th><th>${tl('Prises')}</th></tr>${s.pdus.map(p => `<tr><td>${esc(ctx.nameOf(p.id))}</td><td>${f1(p.va, isEn)} / ${f1(p.capVA, isEn)} VA · ${f1(p.amps, isEn)} A${gauge(p.pct)}</td><td>${p.plugs} / ${p.outlets}</td></tr>`).join('')}</table><p class="mut">${tl('Branchements non choisis : partagés également entre les PDU (modèle simplifié).')}</p></section>`;
  if (s.ups.length) h += `<section class="ntSec"><h4>${tl('Onduleurs')}</h4><table class="ntTable"><tr><th>${tl('Onduleur')}</th><th>${tl('Taux de charge')}</th><th>${tl('Autonomie')}</th></tr>${s.ups.map(u => `<tr><td>${esc(ctx.nameOf(u.id))}${u.ebm ? `<br><small class="mut">+ ${esc(ctx.nameOf(u.ebm))}</small>` : ''}</td><td>${f1(u.w, isEn)} / ${u.capW} W${gauge(u.pct)}</td><td class="${u.runtime < r.runtime ? 'bad' : ''}">${u.runtime === Infinity ? '—' : tl('{0} min', f1(u.runtime, isEn))}${u.extra ? `<br><small class="mut">${tl('extrapolé')}</small>` : ''}</td></tr>`).join('')}</table><p class="mut">${tl('Autonomie interpolée entre les points de la fiche (pleine charge, demi-charge) : modèle simplifié, ±15 % selon le fabricant.')}</p></section>`;
  h += `<section class="ntSec"><h4>${tl('Valeurs de conception (modifiables)')}</h4>
    ${field(tl('Chaleur admise (W)'), num('heat', r.heat, 'min="50" max="100000" step="50"'), tl('Limite propre à la salle et à sa climatisation, pas une norme.'))}
    ${field(tl('Autonomie visée (min)'), num('runtime', r.runtime, 'min="0" max="600"'))}
    ${field(tl('Facteur de puissance'), num('pf', r.pf, 'min="0.5" max="1" step="0.01"'), tl('Hypothèse pour passer des watts aux voltampères (VA = W / facteur).'))}
    ${field(tl('Puissance retenue'), `<select class="sel" data-rkf="basis"><option value="typ"${r.basis === 'typ' ? ' selected' : ''}>${tl('typique (fiches)')}</option><option value="max"${r.basis === 'max' ? ' selected' : ''}>${tl('maximale (fiches)')}</option></select>`)}
    ${field(tl('Tension (V)'), num('volts', r.volts, 'min="100" max="400"'))}</section>`;
  const tips = [];
  if (s.managers.missing.length) tips.push(tl('{0} panneau(x) de brassage sans passe-câbles 1U à côté (règle de conception : un passe-câbles par panneau).', s.managers.missing.length));
  if (s.blanks) tips.push(tl('{0} U libres à boucher par des obturateurs 1U.', s.blanks));
  if (tips.length) h += `<section class="ntSec"><h4>${tl('Conseils')}</h4><ul class="ntRkTips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
  h += `<section class="ntSec"><h4>${tl('Problèmes')}</h4>${issuesHtml(ctx, list)}</section>`;
  return h;
}

/** Inspecteur d'un équipement de baie sans rôle réseau (passe-câbles, PDU, onduleur…). */
export function mechPane(ctx, d, s) {
  const { tl, esc, icon, isEn } = ctx, data = ctx.data(), m = MOUNT[d.type] || {}, spec = DEVICES[d.type];
  const field = (label, html, tip = '') => `<label class="ntF"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${label}</span>${html}</label>`;
  let h = `<div class="ntHead">${icon(spec.icon)}<div><b>${esc(d.name)}</b><small>${esc(spec.name())}</small></div><button type="button" class="tb" data-rka="deldev" data-tip="${tl('Supprimer cet équipement')}" aria-label="${tl('Supprimer')}">${icon('trash')}</button></div>`;
  h += `<p class="ntDoc">${esc(spec.doc())}</p>`;
  h += `<section class="ntSec">${field(tl('Nom'), `<input class="inp" data-rkd="name" value="${esc(d.name)}" maxlength="24">`)}${placeFields(ctx, d, data)}</section>`;
  h += `<section class="ntSec"><h4>${tl('Fiche technique')}</h4><table class="ntTable"><tr><th>${tl('Modèle')}</th><td>${esc(m.ref || '—')}</td></tr><tr><th>${tl('Encombrement')}</th><td>${m.u ? m.u + ' U' : tl('0U (vertical)')} · ${f1(m.depth, isEn)} mm</td></tr><tr><th>${tl('Poids')}</th><td>${m.kg == null ? tl('non donné') : f1(m.kg, isEn) + ' kg'}</td></tr>${m.max ? `<tr><th>${tl('Puissance consommée')}</th><td>${f1(m.max, isEn)} W</td></tr>` : ''}${m.pdu ? `<tr><th>${tl('Capacité')}</th><td>${m.pdu.a} A · ${m.pdu.w} W · ${tl('{0} prises', m.pdu.outlets)}</td></tr>` : ''}${m.ups ? `<tr><th>${tl('Capacité')}</th><td>${m.ups.va} VA / ${m.ups.w} W · ${tl('{0} prises', m.ups.outlets)}</td></tr>` : ''}${m.load ? `<tr><th>${tl('Taux de charge')}</th><td>${m.load} kg</td></tr>` : ''}</table></section>`;
  if (s && m.pdu) { const p = s.pdus.find(x => x.id === d.id); if (p) h += `<section class="ntSec"><h4>${tl('Taux de charge')}</h4><p>${f1(p.va, isEn)} / ${f1(p.capVA, isEn)} VA · ${f1(p.amps, isEn)} A · ${tl('{0} prises sur {1}', p.plugs, p.outlets)}</p>${gauge(p.pct)}</section>`; }
  if (s && m.ups) { const u = s.ups.find(x => x.id === d.id); if (u) h += `<section class="ntSec"><h4>${tl('Taux de charge')}</h4><p>${f1(u.w, isEn)} / ${u.capW} W · ${u.runtime === Infinity ? '' : tl('environ {0} min d’autonomie', f1(u.runtime, isEn))}</p>${gauge(u.pct)}<p class="mut">${tl('Autonomie interpolée entre les points de la fiche (pleine charge, demi-charge) : modèle simplifié, ±15 % selon le fabricant.')}</p></section>`; }
  return h;
}

/** Champs de place dans une baie (baie, U, face, puissance imposée, PDU) : communs à l'inspecteur et à la carte de la vue. */
export function placeFields(ctx, d, data) {
  const { tl, esc } = ctx, m = MOUNT[d.type] || {}, racks = data.racks || [], r = d.rack && racks.find(x => x.id === d.rack.id);
  const field = (label, html, tip = '') => `<label class="ntF"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${label}</span>${html}</label>`;
  let h = field(tl('Baie'), `<select class="sel" data-rkd="rack"><option value="">${tl('hors baie')}</option>${racks.map(x => `<option value="${esc(x.id)}"${r && x.id === r.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`);
  if (r && m.u) h += field(tl('U du bas'), `<input class="inp" type="number" data-rkd="u" min="1" max="${r.u}" value="${d.rack.u}">`) + field(tl('Face de montage'), `<select class="sel" data-rkd="face"><option value="front"${d.rack.face !== 'rear' ? ' selected' : ''}>${tl('à l’avant')}</option><option value="rear"${d.rack.face === 'rear' ? ' selected' : ''}>${tl('à l’arrière')}</option></select>`);
  if (r && !m.pdu && !m.ups && !m.ebmOf && (m.max || m.typ || m.poe)) h += field(tl('Puissance mesurée (W)'), `<input class="inp" type="number" data-rkd="w" min="0" max="20000" value="${d.rack.w ?? ''}" placeholder="${tl('fiche')}">`, tl('Vide : la consommation de la fiche.'));
  if (r && !m.pdu && (m.max || m.typ || m.poe)) {
    const pdus = (data.devices || []).filter(x => x.rack && x.rack.id === r.id && MOUNT[x.type] && MOUNT[x.type].pdu);
    if (pdus.length > 1) h += field(tl('Branché sur'), `<select class="sel" data-rkd="pdu"><option value="">${tl('réparti')}</option>${pdus.map(p => `<option value="${esc(p.id)}"${d.rack.pdu === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`);
  }
  return h;
}

/** Résumé de toutes les baies (rien n'est choisi). */
export function summaryPane(ctx, sums, list) {
  const { tl, esc, icon, isEn } = ctx;
  let h = `<div class="ntHead">${icon('rack')}<div><b>${tl('Baies')}</b><small>${tl('{0} baie(s)', sums.length)}</small></div></div>`;
  h += `<p class="ntDoc">${tl('Cliquez une baie ou un équipement pour voir ses réglages. Glissez les équipements de la bibliothèque ou de la liste « Hors baie » dans les U libres.')}</p>`;
  if (sums.length) h += `<section class="ntSec"><table class="ntTable"><tr><th>${tl('Baie')}</th><th>U</th><th>W</th><th>kg</th></tr>${sums.map(s => `<tr data-rkgo="${esc(s.id)}"><td>${esc(s.name)}</td><td>${s.usedU}/${s.u}</td><td>${f1(s.w, isEn)}</td><td>${f1(s.kg, isEn)}</td></tr>`).join('')}</table></section>`;
  if (sums.length) h += `<section class="ntSec"><h4>${tl('Problèmes des baies')}</h4>${issuesHtml(ctx, list, tl('Aucun problème dans les baies.'))}</section>`;
  return h;
}
