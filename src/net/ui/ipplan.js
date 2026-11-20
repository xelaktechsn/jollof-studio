// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan d'adressage IPv4 (VLSM) : onglet de la vue Conception (design.js). Bloc parent, convention de passerelle et
// réserve de croissance (data.design.ip) ; hôtes prévus de chaque VLAN ; découpage par subnet.js (du plus grand au plus
// petit, alignés) ; chevauchements des réseaux en place. N'écrit que net, gw et hosts des entrées de data.vlans (contrat
// « base des VLAN » : le reste appartient à vlan.js).
import { tl } from '../../i18n/index.js';
import { planVlsm, overlaps, parseCidr } from '../subnet.js';
import { dimension, applyL3 } from '../dimension.js';
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

/** Dessine l'onglet dans el ; rend { render(), destroy() }. */
export function renderIpPlan(ctx, el) {
  // Les champs data-set (bloc, passerelle, réserve) sont écrits par la vue Conception (design.js, bindSettings).
  el.classList.add('ntDsIp');
  const onClick = e => {
    const b = e.target.closest('[data-ip]'); if (!b) return;
    const data = ctx.data(), vl = data.vlans || [];
    if (b.dataset.ip === 'estimate') { let n = 0; for (const v of vl) { const h = estimateHosts(data, v); if (h != null) { v.hosts = Math.max(1, h); n++; } } if (n) { ctx.commit(); ctx.status(tl('Hôtes estimés pour {0} VLAN (à vérifier).', n), 'ok'); } else ctx.status(tl('Aucun VLAN de base à estimer.'), 'warn'); return; }
    if (b.dataset.ip === 'apply') {
      const plan = currentPlan(data); if (!plan.subnets.length) return;
      let n = 0; for (const s of plan.subnets) { if (!s.fit) continue; const v = vl.find(x => x.id === s.id); if (v) { v.net = s.cidr; v.gw = s.gw; n++; } }
      // Interfaces de niveau 3 du cœur (SVI) et DHCP (relais ou étendues), d'après le plan : dimension.js applyL3.
      const l3 = applyL3(data);
      ctx.commit();
      const msg = plan.ok ? tl('Plan d’adressage appliqué à {0} VLAN.', n) : tl('Plan appliqué à {0} VLAN ; les autres ne tiennent pas dans le bloc.', n);
      ctx.status(l3 ? msg + ' ' + tl('Cœur {0} : interfaces VLAN (SVI) et DHCP mis à jour.', ctx.nameOf(l3.core)) : msg, plan.ok ? 'ok' : 'warn');
    }
  };
  const onChange = e => {
    const t = e.target.closest('[data-hosts]'); if (!t) return;
    const v = (ctx.data().vlans || []).find(x => String(x.id) === t.dataset.hosts); if (!v) return;
    const n = Math.round(+t.value); if (t.value === '' || !Number.isFinite(n)) delete v.hosts; else v.hosts = Math.max(0, Math.min(16777214, n));
    ctx.commit();
  };
  el.addEventListener('click', onClick); el.addEventListener('change', onChange);
  const currentPlan = data => { const D = design(ctx); return planVlsm(D.ip.block, (data.vlans || []).map(v => ({ id: v.id, name: v.name, hosts: v.hosts ?? 0 })), { gw: D.ip.gw, growth: D.ip.growth }); };
  function render() {
    const data = ctx.data(), D = design(ctx), vl = data.vlans || [], plan = currentPlan(data), blk = parseCidr(D.ip.block);
    const ov = overlaps(vl.filter(v => v.net).map(v => ({ id: v.id, net: v.net }))), ovSet = new Set(ov.flat());
    const side = `<aside class="ntDsSide"><section><h3>${esc(tl('Bloc d’adresses'))}</h3>
      ${txtField(tl('Bloc parent (CIDR)'), 'ip.block', D.ip.block, { max: 20, hint: tl('Blocs privés : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918).') })}
      ${selField(tl('Passerelle'), 'ip.gw', D.ip.gw, [['first', tl('Première adresse utilisable')], ['last', tl('Dernière adresse utilisable')]])}
      ${numField(tl('Réserve de croissance'), 'ip.growth', D.ip.growth, { min: 0, max: 400, unit: '%' })}</section>
      <p class="ntDsNote">${esc(tl('Découpage VLSM : les réseaux sont placés du plus grand au plus petit, chacun aligné sur sa taille (RFC 4632) ; l’adresse du réseau et celle de diffusion ne sont pas données aux hôtes (RFC 950). Une adresse est comptée pour la passerelle.'))}</p>
      <p class="ntDsNote">${esc(tl('Appliquer le plan crée aussi, sur le switch de niveau 3 de cœur, une interface VLAN (SVI) par VLAN à l’adresse de la passerelle, et le DHCP : relais vers le serveur DHCP du projet s’il y en a un, sinon des étendues sur le cœur (sauf le VLAN de gestion).'))}</p></aside>`;
    if (!vl.length) return (el.innerHTML = `<div class="ntDsGrid">${side}<main class="ntDsMain"><div class="ntDsEmptyBig">${ctx.icon('network')}<h3>${esc(tl('Aucun VLAN'))}</h3><p>${esc(tl('Créez les VLAN du projet (le générateur de l’onglet Dimensionnement pose DATA, VOICE, WIFI et MGMT) : ce plan leur donne ensuite un réseau et une passerelle.'))}</p></div></main></div>`);
    const st = s => {
      const v = vl.find(x => x.id === s.id);
      if (!s.fit) return `<span class="ntDsBad">${esc(tl('ne tient pas'))}</span>`;
      if (ovSet.has(s.id)) return `<span class="ntDsBad">${esc(tl('chevauchement'))}</span>`;
      if (v.net === s.cidr && v.gw === s.gw) return `<span class="ntDsGood">${esc(tl('appliqué'))}</span>`;
      return v.net ? `<span class="ntDsMuted">${esc(tl('à changer'))}</span>` : `<span class="ntDsMuted">${esc(tl('à appliquer'))}</span>`;
    };
    const bar = u => `<span class="ntDsBar"><i style="width:${Math.round(Math.min(1, u) * 100)}%"></i></span> ${fmt(u * 100)} %`;
    const rows = plan.subnets;
    el.innerHTML = `<div class="ntDsGrid">${side}<main class="ntDsMain">
      <div class="ntDsKpis">${kpi(tl('Bloc'), plan.block || D.ip.block, { warn: !blk || plan.private === false, sub: !blk ? tl('illisible') : plan.private === false ? tl('adresses publiques') : tl('privé (RFC 1918)') })}${kpi(tl('VLAN'), fmt(vl.length))}${kpi(tl('Adresses prises'), fmt(plan.used), { sub: blk ? tl('{0} % du bloc', fmt(plan.util * 100, 1)) : '' })}${kpi(tl('Sans place'), fmt(plan.fail.length), { warn: plan.fail.length > 0, ok: !plan.fail.length })}</div>
      <div class="ntDsTools"><button type="button" class="btn small" data-ip="estimate">${ctx.icon('gauge')}<span>${esc(tl('Estimer les hôtes'))}</span></button><span class="ntDsSp"></span><button type="button" class="btn small primary" data-ip="apply"${rows.some(s => s.fit) ? '' : ' disabled'}>${ctx.icon('check')}<span>${esc(tl('Appliquer le plan aux VLAN'))}</span></button></div>
      ${ov.length ? `<section class="ntDsWarn">${ov.slice(0, 10).map(([a, b]) => `<p>${ctx.icon('alert')}${esc(tl('Les réseaux des VLAN {0} et {1} se chevauchent.', a, b))}</p>`).join('')}</section>` : ''}
      ${table([{ name: 'VLAN', key: 'id', num: 1 }, { name: tl('Nom'), key: 'name' }, { name: tl('Hôtes prévus'), key: s => `<input class="inp ntDsNum" type="number" min="0" data-hosts="${esc(s.id)}" value="${esc((vl.find(v => v.id === s.id) || {}).hosts ?? '')}" aria-label="${esc(tl('Hôtes prévus'))}">`, html: 1, num: 1 },
        { name: tl('Réseau'), key: s => (s.fit ? s.cidr : '—'), cls: 'ntDsMono' }, { name: tl('Masque'), key: s => s.mask || '—', cls: 'ntDsMono' }, { name: tl('Passerelle'), key: s => s.gw || '—', cls: 'ntDsMono' },
        { name: tl('Adresses utilisables'), key: s => (s.fit ? `${s.first} – ${s.last}` : '—'), cls: 'ntDsMono' }, { name: tl('Utilisation'), key: s => (s.fit ? bar(s.util) : '—'), html: 1 },
        { name: tl('En place'), key: s => { const v = vl.find(x => x.id === s.id); return v.net ? `${v.net}${v.gw ? ' · ' + v.gw : ''}` : '—'; }, cls: 'ntDsMono' }, { name: tl('État'), key: st, html: 1 }], rows)}
    </main></div>`;
  }
  render();
  return { render, destroy() { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); el.classList.remove('ntDsIp'); } };
}
