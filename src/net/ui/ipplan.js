// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan d'adressage IPv4 (VLSM) : onglet de la vue Conception (design.js). Bloc parent, convention de passerelle, réserve
// de croissance et taille minimale d'un réseau (data.design.ip) ; hôtes de chaque VLAN (comptés dans le modèle : ports
// d'accès câblés, téléphones du VLAN voix, sinon estimés d'après le dimensionnement ; ou saisis). Le plan GARDE les réseaux
// en place qui conviennent (subnet.js planKeep) et ne propose un changement que pour ceux qui manquent, sont trop petits ou
// se chevauchent ; « Appliquer » montre ce qui change et demande confirmation (une étape d'annulation). N'écrit que net,
// gw et hosts des entrées de data.vlans (contrat « base des VLAN »), puis les SVI et le DHCP du cœur (dimension.js applyL3).
import { tl } from '../../i18n/index.js';
import { planKeep, overlaps, parseCidr } from '../subnet.js';
import { dimension, applyL3 } from '../dimension.js';
import { specOf } from '../devices.js';
import { esc, fmt, design, numField, selField, txtField, table, kpi } from './design-util.js';

/** Hôtes estimés d'un VLAN de base à partir du dimensionnement (DATA : postes, VOICE : téléphones, WIFI : 25 clients
 * par point d'accès, MGMT : équipements administrables) ; null si le VLAN n'est pas un de ceux-là. Estimation modifiable. */
export function estimateHosts(data, v) {
  const t = dimension(data).totals, n = String(v.name || '').toLowerCase();
  const mgmt = (data.devices || []).filter(d => /switch|router|ap|ups|pdu/.test(d.type)).length;
  if (v.id === 10 || /data|donn/.test(n)) return Math.max(t.wa, (data.devices || []).filter(d => /^(pc|laptop|printer)$/.test(d.type)).length);
  if (v.id === 20 || /voice|voix|tel/.test(n)) return t.phones;
  if (v.id === 30 || /wifi|wi-fi|wlan/.test(n)) return Math.max(t.aps, (data.devices || []).filter(d => /^ap/.test(d.type)).length) * 25;
  if (v.id === 99 || /mgmt|gestion|admin/.test(n)) return Math.max(mgmt, t.switches + t.aps);
  return null;
}
/** Hôtes comptés dans le modèle par VLAN : ports d'accès câblés des switchs administrables (VLAN d'accès) et ports qui
 * portent ce VLAN en voix ; Map(vlan → n). */
export function countHosts(data) {
  const used = new Set(); for (const c of data.cables || []) { used.add(c.a.join('|')); used.add(c.b.join('|')); }
  const m = new Map(), add = (v, n = 1) => m.set(+v, (m.get(+v) || 0) + n);
  for (const d of data.devices || []) {
    const s = specOf(d); if (!s || !s.managed || !d.p || !d.p.ports) continue;
    for (const [pid, c] of Object.entries(d.p.ports)) { if (!c || c.mode !== 'access' || !used.has(d.id + '|' + pid)) continue; add(c.vlan ?? 1); if (c.voice) add(c.voice); }
  }
  return m;
}
/** Hôtes à prévoir pour un VLAN : saisis, sinon le plus grand du compte du modèle et de l'estimation. { n, src: 'set'|'count'|'estimate'|'none' }. */
export function hostsFor(data, v, counted = countHosts(data)) {
  if (v.hosts != null && v.hosts !== '') return { n: +v.hosts, src: 'set' };
  const c = counted.get(+v.id) || 0, e = estimateHosts(data, v);
  if (e != null && e > c) return { n: e, src: 'estimate' };
  return c ? { n: c, src: 'count' } : { n: 0, src: 'none' };
}
/** Plan d'adressage du projet (réglages de data.design.ip, réseaux en place gardés quand ils conviennent). */
export function projectPlan(data, D) {
  const counted = countHosts(data), vl = data.vlans || [];
  // Hôtes : saisis, sinon comptés dans le modèle ; l'estimation (dimensionnement) ne sert qu'aux VLAN sans réseau en place,
  // pour ne jamais proposer de changer un réseau qui marche sur la foi d'une estimation.
  const reqs = vl.map(v => { const h = hostsFor(data, v, counted), has = !!parseCidr(v.net); return { id: v.id, name: v.name, hosts: h.src === 'estimate' && has ? counted.get(+v.id) || 0 : h.n, net: v.net, gw: v.gw }; });
  return { plan: planKeep(D.ip.block, reqs, { gw: D.ip.gw, growth: D.ip.growth, minHosts: D.ip.minHosts, keep: D.ip.keep }), counted };
}

/** Dessine l'onglet dans el ; rend { render(), destroy() }. */
export function renderIpPlan(ctx, el) {
  // Les champs data-set (bloc, passerelle, réserve) sont écrits par la vue Conception (design.js, bindSettings).
  el.classList.add('ntDsIp');
  const onClick = async e => {
    const b = e.target.closest('[data-ip]'); if (!b) return;
    const data = ctx.data(), vl = data.vlans || [];
    if (b.dataset.ip === 'estimate') { const counted = countHosts(data); let n = 0; for (const v of vl) { const h = hostsFor(data, { ...v, hosts: null }, counted); if (h.n) { v.hosts = Math.max(1, h.n); n++; } } if (n) { ctx.commit(); ctx.status(tl('Hôtes estimés pour {0} VLAN (à vérifier).', n), 'ok'); } else ctx.status(tl('Aucun VLAN de base à estimer.'), 'warn'); return; }
    if (b.dataset.ip === 'apply') {
      const { plan } = projectPlan(data, design(ctx)), ch = plan.subnets.filter(s => s.fit && (s.cidr !== s.from || s.gw !== s.fromGw));
      if (!ch.length) { ctx.status(tl('Le plan ne change rien : les réseaux en place conviennent.'), 'ok'); return; }
      const li = ch.map(s => `<li><b>VLAN ${esc(s.id)} ${esc(s.name)}</b> : ${s.from ? `${esc(s.from)} → ` : ''}<b>${esc(s.cidr)}</b>${s.gw !== s.fromGw ? ` · ${esc(tl('passerelle'))} ${s.fromGw ? esc(s.fromGw) + ' → ' : ''}<b>${esc(s.gw)}</b>` : ''}</li>`).join('');
      const core = (data.devices || []).some(d => d.type === 'l3switch');
      const text = `${esc(tl('{0} VLAN vont changer d’adresse :', ch.length))}<ul class="ntDsDiff">${li}</ul>${core ? esc(tl('Les interfaces VLAN (SVI) et le DHCP du cœur suivront ces réseaux.')) + ' ' : ''}${esc(tl('Les appareils à adresse fixe de ces VLAN devront être réadressés. Ctrl+Z pour annuler.'))}`;
      let ok = true;
      try { const UI = await import('../../school/ui.js'); ok = await UI.confirm(tl('Appliquer le plan d’adressage ?'), text, tl('Appliquer')); } catch (x) { ok = window.confirm(tl('{0} VLAN vont changer d’adresse.', ch.length)); }
      if (!ok) return;
      for (const s of ch) { const v = vl.find(x => x.id === s.id); if (v) { v.net = s.cidr; v.gw = s.gw; } }
      const l3 = applyL3(data);
      ctx.commit();
      const msg = tl('Plan d’adressage appliqué à {0} VLAN.', ch.length);
      ctx.status(l3 ? msg + ' ' + tl('Cœur {0} : interfaces VLAN (SVI) et DHCP mis à jour.', ctx.nameOf(l3.core)) : msg, 'ok');
    }
  };
  const onChange = e => {
    const t = e.target.closest('[data-hosts]'); if (!t) return;
    const v = (ctx.data().vlans || []).find(x => String(x.id) === t.dataset.hosts); if (!v) return;
    const n = Math.round(+t.value); if (t.value === '' || !Number.isFinite(n)) delete v.hosts; else v.hosts = Math.max(0, Math.min(16777214, n));
    ctx.commit();
  };
  el.addEventListener('click', onClick); el.addEventListener('change', onChange);
  function render() {
    const data = ctx.data(), D = design(ctx), vl = data.vlans || [], blk = parseCidr(D.ip.block), { plan, counted } = projectPlan(data, D);
    const ov = overlaps(vl.filter(v => v.net).map(v => ({ id: v.id, net: v.net }))), ovSet = new Set(ov.flat());
    const side = `<aside class="ntDsSide"><section><h3>${esc(tl('Bloc d’adresses'))}</h3>
      ${txtField(tl('Bloc parent (CIDR)'), 'ip.block', D.ip.block, { max: 20, hint: tl('Blocs privés : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918).') })}
      ${selField(tl('Passerelle'), 'ip.gw', D.ip.gw, [['first', tl('Première adresse utilisable')], ['last', tl('Dernière adresse utilisable')]])}
      ${numField(tl('Réserve de croissance'), 'ip.growth', D.ip.growth, { min: 0, max: 400, unit: '%' })}
      ${numField(tl('Taille minimale d’un réseau'), 'ip.minHosts', D.ip.minHosts, { min: 1, max: 65534, unit: tl('hôtes'), hint: tl('Valeur de conception modifiable : évite les /30 pour un VLAN encore vide.') })}
      ${selField(tl('Réseaux en place'), 'ip.keep', D.ip.keep ? 'yes' : 'no', [['yes', tl('Les garder quand ils conviennent')], ['no', tl('Tout redécouper dans le bloc')]])}</section>
      <p class="ntDsNote">${esc(tl('Découpage VLSM : les réseaux sont placés du plus grand au plus petit, chacun aligné sur sa taille (RFC 4632) ; l’adresse du réseau et celle de diffusion ne sont pas données aux hôtes (RFC 950). Une adresse est comptée pour la passerelle.'))}</p>
      <p class="ntDsNote">${esc(tl('Appliquer le plan crée aussi, sur le switch de niveau 3 de cœur, une interface VLAN (SVI) par VLAN à l’adresse de la passerelle, et le DHCP : relais vers le serveur DHCP du projet s’il y en a un, sinon des étendues sur le cœur (sauf le VLAN de gestion).'))}</p></aside>`;
    if (!vl.length) return (el.innerHTML = `<div class="ntDsGrid">${side}<main class="ntDsMain"><div class="ntDsEmptyBig">${ctx.icon('network')}<h3>${esc(tl('Aucun VLAN'))}</h3><p>${esc(tl('Créez les VLAN du projet (le générateur de l’onglet Dimensionnement pose DATA, VOICE, WIFI et MGMT) : ce plan leur donne ensuite un réseau et une passerelle.'))}</p></div></main></div>`);
    const ST = { kept: ['ntDsGood', tl('gardé')], new: ['ntDsMuted', tl('nouveau')], changed: ['ntDsWarnTxt', tl('change')], nofit: ['ntDsBad', tl('ne tient pas')] };
    const st = s => { if (ovSet.has(s.id) && s.status === 'kept') return `<span class="ntDsBad">${esc(tl('chevauchement'))}</span>`; const [c, t] = ST[s.status] || ST.new; return `<span class="${c}">${esc(t)}</span>`; };
    const SRC = { set: tl('saisi'), count: tl('compté'), estimate: tl('estimé'), none: '—' };
    const bar = u => `<span class="ntDsBar"><i style="width:${Math.round(Math.min(1, u) * 100)}%"></i></span> ${fmt(u * 100)} %`;
    const rows = plan.subnets, changes = plan.changes;
    el.innerHTML = `<div class="ntDsGrid">${side}<main class="ntDsMain">
      <div class="ntDsKpis">${kpi(tl('Bloc'), plan.block || D.ip.block, { warn: !blk || plan.private === false, sub: !blk ? tl('illisible') : plan.private === false ? tl('adresses publiques') : tl('privé (RFC 1918)') })}${kpi(tl('VLAN'), fmt(vl.length))}${kpi(tl('Changements proposés'), fmt(changes), { ok: !changes, warn: changes > 0 })}${kpi(tl('Sans place'), fmt(plan.fail.length), { warn: plan.fail.length > 0, ok: !plan.fail.length })}</div>
      <div class="ntDsTools"><button type="button" class="btn small" data-ip="estimate">${ctx.icon('gauge')}<span>${esc(tl('Estimer les hôtes'))}</span></button><span class="ntDsSp"></span><button type="button" class="btn small${changes ? ' primary' : ''}" data-ip="apply"${changes ? '' : ' disabled'}>${ctx.icon('check')}<span>${esc(changes ? tl('Appliquer {0:# changement|# changements}…', changes) : tl('Rien à appliquer'))}</span></button></div>
      ${ov.length ? `<section class="ntDsWarn">${ov.slice(0, 10).map(([a, b]) => `<p>${ctx.icon('alert')}${esc(tl('Les réseaux des VLAN {0} et {1} se chevauchent.', a, b))}</p>`).join('')}</section>` : ''}
      ${table([{ name: 'VLAN', key: 'id', num: 1 }, { name: tl('Nom'), key: 'name' },
        { name: tl('Hôtes prévus'), key: s => { const v = vl.find(x => x.id === s.id) || {}, h = hostsFor(data, v, counted); return `<input class="inp ntDsNum" type="number" min="0" data-hosts="${esc(s.id)}" value="${esc(v.hosts ?? '')}" placeholder="${esc(h.n || '')}" aria-label="${esc(tl('Hôtes prévus'))}" title="${esc(SRC[h.src])}">${v.hosts != null ? '' : `<small class="ntDsMuted ntDsSrc">${esc(SRC[h.src])}</small>`}`; }, html: 1 },
        { name: tl('En place'), key: s => (s.from ? `${esc(s.from)}${s.fromGw ? '<br>' + esc(s.fromGw) : ''}` : '—'), html: 1, cls: 'ntDsMono ntDsIpCell' },
        { name: tl('Proposé'), key: s => (s.fit ? `<span title="${esc(tl('Adresses utilisables'))} : ${esc(s.first)} – ${esc(s.last)}">${esc(s.cidr)}${s.gw ? '<br>' + esc(s.gw) : ''}</span>` : '—'), html: 1, cls: 'ntDsMono ntDsIpCell' },
        { name: tl('Utilisation'), key: s => (s.fit ? bar(s.util) : '—'), html: 1 },
        { name: tl('État'), key: st, html: 1 }], rows, { cls: 'ntDsFit' })}
    </main></div>`;
  }
  render();
  return { render, destroy() { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.classList.remove('ntDsIp'); } };
}
