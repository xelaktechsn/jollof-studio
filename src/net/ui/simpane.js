// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Inspecteur des équipements administrables (vue logique du plan réseau) : tableau des ports (accès, trunk, VLAN,
// agrégat, rôle Spanning Tree), Spanning Tree, agrégats, interfaces de niveau 3 (SVI, sous-interfaces), routes, étendues
// DHCP et relais, listes d'accès, traduction d'adresses, DNS ; base des VLAN du projet. Plus la disposition automatique
// du schéma (cœur → distribution → accès → postes) et le texte d'un traceroute. Les réglages sont nettoyés par le type
// de l'équipement (devices.js → vlan.js) avant chaque enregistrement.
import './sim.css';
import { tl } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { DEVICES, specOf, portsOf } from '../devices.js';
import { portCfg, cleanVlans, vlanHue, parseNet, MANAGED } from '../vlan.js';
import { cleanText } from '../../sanitize.js';
import { prefixOf, ipStr } from '../ip.js';
import { whyText } from '../labcheck.js';
import { lagWhyText } from '../issues-sim.js';
import { modulesFor, moduleAt } from '../fibre.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ROLE = { root: () => tl('racine'), designated: () => tl('désigné'), alternate: () => tl('alternatif (bloqué)'), backup: () => tl('secours (bloqué)') };
export const roleText = r => (ROLE[r] ? ROLE[r]() : r || '—');
const LAGST = { bundled: () => tl('dans l’agrégat'), standby: () => tl('en attente'), individual: () => tl('isolé'), suspended: () => tl('suspendu') };
const sel = (attrs, opts, v) => `<select class="sel ntSmIn" ${attrs}>${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const inp = (attrs, v, o = '') => { const m = /class="([^"]*)"/.exec(o), cls = m ? m[1] : 'inp ntSmIn'; return `<input class="${cls}" ${attrs} value="${esc(v ?? '')}" spellcheck="false" ${m ? o.replace(m[0], '') : o}>`; };
const chk = (attrs, v, label) => `<label class="ntChk"><input type="checkbox" ${attrs}${v ? ' checked' : ''}><span>${label}</span></label>`;
const del = (list, i) => `<button type="button" class="tb ntSmDel" data-sdel="${list}" data-i="${i}" aria-label="${tl('Retirer')}" data-tip="${tl('Retirer')}">${icon('x')}</button>`;
const add = (list, label) => `<button type="button" class="btn small subtle" data-sadd="${list}">${icon('plus')}<span>${label}</span></button>`;
const sec = (title, body, tip = '') => `<section class="ntSec ntSm"><h4${tip ? ` data-tip="${esc(tip)}"` : ''}>${title}</h4>${body}</section>`;
/** Couleur d'un VLAN (base du projet, sinon teinte tirée de son numéro). */
export const vlanColor = (data, id) => {
  const V = (data && data.vlans) || [], i = V.findIndex(x => x.id === id);
  if (i >= 0 && V[i].color) return V[i].color;
  return i >= 0 && i < 10 ? `var(--nt-v${i})` : `hsl(${vlanHue(id)} 65% 55%)`; // palette du thème dans l'ordre de la base
};

/* ---------- Inspecteur d'un équipement ---------- */
/** Sections de l'inspecteur pour un équipement administrable, un routeur d'entreprise ou un serveur (html), ou ''. */
export function simPane(ctx, n) {
  const lan = ctx.lan(), P = n.p || {}, s = specOf(n); let h = '';
  if (!s || n.ext) return '';
  if (MANAGED.has(n.type)) h += portsSec(ctx, n) + stpSec(ctx, n) + lagSec(ctx, n);
  if (n.type === 'l3switch') h += sviSec(ctx, n);
  if (n.type === 'routerpro') h += ifSec(ctx, n);
  if (n.type === 'l3switch' || n.type === 'routerpro') h += routeSec(ctx, n) + ospfSec(ctx, n) + aclSec(ctx, n);
  if (n.type === 'routerpro') h += natSec(ctx, n);
  if (Array.isArray(P.dhcp)) h += dhcpSec(ctx, n);
  if (P.dns) h += dnsSec(ctx, n);
  void lan;
  return h;
}
function portsSec(ctx, n) {
  const lan = ctx.lan(), P = n.p, ports = portsOf(n).filter(p => !p.passive), data = ctx.data();
  const cabled = p => !!lan.port(n.id, p.id) || !!(P.ports || {})[p.id];
  const lags = [['', '—'], ...(P.lags || []).map(g => [g.id, g.id])];
  const row = p => {
    const c = portCfg(n, p.id), l = lan.port(n.id, p.id), r = lan.l2port(n.id, p.id), m = r.lag;
    const vl = c.mode === 'access'
      ? inp(`type="number" min="1" max="4094" data-sport="${p.id}" data-f="vlan" aria-label="${tl('VLAN d’accès')}"`, c.vlan, `style="--vc:${vlanColor(data, c.vlan)}"`)
        + inp(`type="number" min="0" max="4094" data-sport="${p.id}" data-f="voice" aria-label="${tl('VLAN voix')}" data-tip="${tl('VLAN voix : un téléphone IP branché sur ce port y est placé (0 : aucun)')}" placeholder="${tl('voix')}"`, c.voice || '', 'class="inp ntSmIn tiny"')
      : `${inp(`type="number" min="1" max="4094" data-sport="${p.id}" data-f="native" aria-label="${tl('VLAN natif')}" data-tip="${tl('VLAN natif (sans étiquette)')}"`, c.native)}${inp(`data-sport="${p.id}" data-f="allowed" aria-label="${tl('VLAN autorisés')}" data-tip="${tl('VLAN autorisés : toutes, aucune ou 10,20,30-40')}"`, c.allowed === 'all' ? tl('toutes') : c.allowed === 'none' ? tl('aucune') : c.allowed, 'class="inp ntSmIn wide"')}`;
    const link = !l ? `<span class="mut">${tl('libre')}</span>` : l.up ? `<b class="ok">${l.speed >= 1000 ? l.speed / 1000 + ' G' : l.speed + ' M'}</b>` : `<b class="bad" data-tip="${esc(whyText(l.why))}">${tl('sans lien')}</b>`;
    const role = r.role ? `<span class="ntSmRole ${r.fwd ? 'fwd' : 'blk'}">${esc(roleText(r.role))}${r.edge ? ' · ' + tl('bord') : ''}</span>` : !r.fwd && l && l.up ? `<span class="ntSmRole blk">${tl('port bloqué')}</span>` : '';
    // Deux lignes par port : nom, lien, rôle Spanning Tree, coupure ; puis mode, VLAN, agrégat.
    return `<div class="ntSmPort${!r.fwd && l && l.up ? ' blk' : ''}"><b>${esc(p.label)}${p.sfp ? ` <small>${esc(p.sfp.toUpperCase())}</small>` : ''}</b><span class="ntSmLink">${link}${role ? ' · ' + role : ''}${m ? ` · <small>${esc(LAGST[m.state] ? LAGST[m.state]() : m.state)}</small>` : ''}</span>`
      + `${chk(`data-sport="${p.id}" data-f="shut" aria-label="${tl('Port coupé par l’administrateur')}"`, c.shut, `<small>${tl('Hors service')}</small>`)}`
      + (p.sfp ? `<div class="ntSmPortCfg ntSmSfp"><small>${tl('Module {0}', p.sfp.toUpperCase())}</small>${sel(`data-ssfp="${p.id}" aria-label="${tl('Module optique de la cage')}" data-tip="${tl('Module posé dans la cage : il doit convenir à la fibre et être le même type aux deux bouts')}"`, [['', tl('cage vide')], ...modulesFor(p.sfp).map(id => [id, id])], moduleAt(n, p.id) || '')}</div>` : '')
      + `<div class="ntSmPortCfg">${sel(`data-sport="${p.id}" data-f="mode" aria-label="${tl('Mode')}"`, [['access', tl('accès')], ['trunk', 'trunk']], c.mode)}<span class="ntSmVl">${vl}</span>${sel(`data-sport="${p.id}" data-f="lag" aria-label="${tl('Agrégat')}"`, lags, c.lag)}</div></div>`;
  };
  const used = ports.filter(cabled), rest = ports.filter(p => !cabled(p));
  return sec(tl('Ports : VLAN et Spanning Tree'), `<div class="ntSmPorts">${used.map(row).join('')}</div>`
    + (rest.length ? `<details class="ntSmMore"><summary>${tl('{0:# autre port|# autres ports}, libres', rest.length)}</summary><div class="ntSmPorts">${rest.map(row).join('')}</div></details>` : ''),
  tl('Accès : un VLAN, sans étiquette. Trunk : VLAN natif sans étiquette, VLAN autorisés étiquetés 802.1Q.'));
}
function stpSec(ctx, n) {
  const lan = ctx.lan(), st = lan.stp(n.id), P = n.p, prios = Array.from({ length: 16 }, (_, i) => [i * 4096, String(i * 4096)]);
  let info = '';
  const per = P.stp.mode !== 'rstp' ? [...lan.stpInstances()].filter(([v, m]) => v && m.has(n.id)).sort((x, y) => x[0] - y[0]) : [];
  if (P.stp.on && per.length > 1) {
    // Rapid PVST+ : une ligne par VLAN (racine, priorité, ports bloqués).
    info = `<table class="ntTable ntSmRt"><tr><th>VLAN</th><th>${tl('Racine')}</th><th>${tl('Priorité')}</th><th>${tl('Ports bloqués')}</th></tr>${per.map(([v, m]) => { const x = m.get(n.id), blk = [...x.ports].filter(([, r]) => !r.fwd).map(([pp]) => pp); return `<tr><td>${v}</td><td>${x.isRoot ? `<b class="ok">${tl('ce switch')}</b>` : esc(ctx.nameOf(x.root))}</td><td>${sel(`data-sprio="${v}" aria-label="${tl('Priorité du VLAN {0}', v)}"`, prios, (P.stp.vlans || {})[v] ?? P.stp.prio)}</td><td>${esc(blk.join(', ') || '—')}</td></tr>`; }).join('')}</table>`;
  } else if (P.stp.on && st) info = st.isRoot ? `<p class="ntOk">${icon('check')}${tl('Ce switch est la racine du Spanning Tree.')}</p>` : `<p class="mut">${tl('Racine : {0} · coût {1} · port racine {2}', esc(ctx.nameOf(st.root)), st.cost, esc(st.rootPort || '—'))}</p>`;
  else if (!P.stp.on) info = `<p class="ntWarn">${icon('alert')}${tl('Spanning Tree arrêté : une boucle par ce switch n’est pas coupée.')}</p>`;
  return sec(tl('Spanning Tree'), chk('data-sset="stp.on"', P.stp.on, tl('Spanning Tree actif'))
    + `<label class="ntF"><span>${tl('Mode')}</span>${sel('data-sset="stp.mode"', [['rpvst', tl('Rapid PVST+ (une instance par VLAN)')], ['rstp', tl('RSTP (une instance pour tous)')]], P.stp.mode)}</label>`
    + `<label class="ntF"><span>${tl('Priorité du pont')}</span>${sel('data-sset="stp.prio"', prios, P.stp.prio)}</label>` + info,
  tl('La plus basse priorité, puis la plus basse adresse MAC, devient la racine.'));
}
/** OSPF d'un routeur : activation, déclarations « network … area », interfaces (aire, coût, minuteries, priorité), voisins. */
function ospfSec(ctx, n) {
  const P = n.p, O = P.ospf || { on: false, nets: [], ifs: {} }, lan = ctx.lan();
  let body = chk('data-sset="ospf.on"', O.on, tl('OSPF actif'));
  if (O.on) {
    const os = lan.ospf(), mine = os.ifs.get(n.id) || [], adj = os.adj.filter(e => e.a === n.id || e.b === n.id);
    const WHY = { passive: tl('interface passive'), subnet: tl('sous-réseau ou masque différent'), area: tl('aires différentes'), timers: tl('minuteries hello et dead différentes'), rid: tl('même identifiant') };
    const areas = [...(os.areas.get(n.id) || [])].sort((x, y) => x - y);
    const role = os.abr.has(n.id) ? tl('routeur de bordure (ABR) : aires {0}', areas.join(', ')) : areas.length > 1 ? tl('plusieurs aires sans l’aire 0 : {0}', areas.join(', ')) : areas.length ? tl('routeur interne de l’aire {0}', areas[0]) : '';
    const ROLE = { DR: 'DR', BDR: 'BDR', DROTHER: 'DROTHER' };
    body += `<div class="ntSmGrid">${L2(tl('Identifiant du routeur'), inp('data-sset="ospf.rid" placeholder="' + esc(os.rid.get(n.id) || '') + '"', O.rid))}${L2(tl('Bande de référence (Mb/s)'), inp('type="number" min="1" data-sset="ospf.ref"', O.ref))}</div>`
      + (role ? `<p class="${os.noBackbone.includes(n.id) ? 'ntWarn' : 'mut'}">${esc(role)}</p>` : '')
      + chk('data-sset="ospf.originate"', O.originate, tl('Annoncer la route par défaut'))
      + `<label class="ntSmL"><small>${tl('Réseaux (« network … area ») : un par ligne, préfixe puis aire')}</small><textarea class="inp ntSmTa" rows="${Math.max(2, O.nets.length + 1)}" data-stext="onets" spellcheck="false" placeholder="10.0.0.0/8 0">${esc(O.nets.map(x => `${x.net} ${x.area}`).join('\n'))}</textarea></label>`
      + (mine.length ? `<div class="ntSmScroll"><table class="ntTable ntSmRt"><tr><th>${tl('Interface')}</th><th>${tl('Aire')}</th><th>${tl('Coût')}</th><th>Hello / dead</th><th data-tip="${tl('Priorité pour l’élection du routeur désigné (0 : jamais DR)')}">${tl('Priorité')}</th><th>${tl('Rôle')}</th><th>${tl('Passive')}</th></tr>${mine.map(x => `<tr><td>${esc(x.name)}</td><td>${x.area}</td><td>${inp(`type="number" min="0" max="65535" data-sospf="${esc(x.name)}" data-f="cost" placeholder="${x.cost}"`, ospfOwn(P, x.name).cost || '', 'class="inp ntSmIn tiny"')}</td><td>${inp(`type="number" min="1" data-sospf="${esc(x.name)}" data-f="hello"`, x.hello, 'class="inp ntSmIn tiny"')}${inp(`type="number" min="1" data-sospf="${esc(x.name)}" data-f="dead"`, x.dead, 'class="inp ntSmIn tiny"')}</td><td>${inp(`type="number" min="0" max="255" data-sospf="${esc(x.name)}" data-f="prio"`, x.prio, 'class="inp ntSmIn tiny"')}</td><td>${esc(ROLE[x.state] || '—')}</td><td>${chk(`data-sospf="${esc(x.name)}" data-f="passive"`, x.passive, '')}</td></tr>`).join('')}</table></div>` : `<p class="mut">${tl('Aucune interface n’est couverte par les réseaux déclarés.')}</p>`)
      + (adj.length ? `<h4>${tl('Voisins')}</h4><table class="ntTable ntSmRt"><tr><th>${tl('Interface')}</th><th>${tl('Voisin')}</th><th>${tl('Identifiant')}</th><th>${tl('Rôle')}</th><th>${tl('État')}</th></tr>${adj.map(e => { const me = e.a === n.id, other = me ? e.b : e.a, ox = me ? e.fb : e.fa; return `<tr class="${e.up ? '' : 'bad'}"><td>${esc((me ? e.fa : e.fb).name)}</td><td>${esc(ctx.nameOf(other))}</td><td>${esc(os.rid.get(other) || '')}</td><td>${esc(ROLE[ox.state] || '—')}</td><td>${e.up ? (e.full ? '<b class="ok">FULL</b>' : '2-WAY') : `<span class="bad">${esc(WHY[e.why] || e.why)}</span>`}</td></tr>`; }).join('')}</table>` : '')
      + `<p class="mut ntSmNote">${tl('Modèle simplifié : élection du routeur désigné au démarrage simultané (sans garder un DR déjà en place), résumés sans agrégation, ni liens virtuels, ni aires terminales, ni authentification.')}</p>`;
  }
  return sec('OSPF', body, tl('Voisins : même sous-réseau et masque, même aire, mêmes minuteries ; adjacence complète avec le DR et le BDR seulement ; entre deux aires, tout passe par l’aire 0 ; distance administrative 110.'));
}
const ospfOwn = (P, name) => ((P.ospf && P.ospf.ifs) || {})[name] || {};
function lagSec(ctx, n) {
  const P = n.p, st = ctx.lan().lags(n.id);
  const rows = (P.lags || []).map((g, i) => {
    const x = st && st.get(g.id), state = !x || !x.up.length ? `<span class="mut">${tl('aucun port relié')}</span>` : x.ok ? `<b class="ok">${tl('formé')} · ${x.active.length} × · ${x.speed >= 1000 ? x.speed / 1000 + ' Gb/s' : x.speed + ' Mb/s'}</b>` : `<b class="bad">${esc(lagWhyText(x.why))}</b>`;
    const members = Object.entries(P.ports || {}).filter(([, c]) => c.lag === g.id).map(([p]) => p).join(', ') || '—';
    return `<tr><td><b>${g.id}</b></td><td>${sel(`data-slist="lags" data-i="${i}" data-f="mode"`, [['active', tl('LACP actif')], ['passive', tl('LACP passif')], ['on', tl('statique')]], g.mode)}</td><td>${esc(members)}</td><td>${state}</td><td>${del('lags', i)}</td></tr>`;
  }).join('');
  return sec(tl('Agrégats de liens'), (rows ? `<table class="ntTable"><tr><th>${tl('Agrégat')}</th><th>${tl('Mode')}</th><th>${tl('Ports')}</th><th>${tl('État')}</th><th></th></tr>${rows}</table>` : `<p class="mut">${tl('Aucun agrégat. Créez-en un, puis choisissez-le sur les ports.')}</p>`) + `<div class="row">${add('lags', tl('Agrégat'))}</div>`);
}
const ipCell = (list, i, f) => `${inp(`data-slist="${list}" data-i="${i}" data-f="ip" aria-label="${tl('Adresse')}" placeholder="10.0.10.1"`, f.ip)}${inp(`data-slist="${list}" data-i="${i}" data-f="prefix" aria-label="${tl('Masque')}"`, '/' + f.prefix, 'class="inp ntSmIn tiny"')}`;
const aclOpts = P => [['', '—'], ...(P.acls || []).map(a => [a.name, a.name])];
function ifState(ctx, n, f, match) {
  const x = ctx.lan().ifacesOf(n.id).find(match);
  return !x ? '' : x.up === false ? `<span class="bad">${tl('éteinte')}</span>` : x.ip ? `<span class="ok">${esc(x.ip)}</span>` : `<span class="mut">${tl('sans adresse')}</span>`;
}
/** Champ étiqueté d'une fiche (interface, étendue) : petite légende au-dessus du champ. */
const L2 = (label, html, wide = false) => `<label class="ntSmL${wide ? ' wide' : ''}"><small>${label}</small>${html}</label>`;
const card = (head, body, i, list) => `<div class="ntSmCard"><div class="ntSmCardH">${head}${del(list, i)}</div><div class="ntSmGrid">${body}</div></div>`;
function sviSec(ctx, n) {
  const P = n.p;
  const rows = (P.svis || []).map((f, i) => card(`<b>VLAN</b>${inp(`type="number" min="1" max="4094" data-slist="svis" data-i="${i}" data-f="vlan" aria-label="VLAN"`, f.vlan, 'class="inp ntSmIn tiny"')}<span class="grow"></span>${ifState(ctx, n, f, x => x.svi && x.vlan === f.vlan)}`,
    L2(tl('Adresse'), `<span class="ntSmIp">${ipCell('svis', i, f)}</span>`, true) + L2(tl('Relais DHCP'), inp(`data-slist="svis" data-i="${i}" data-f="helper" placeholder="${tl('serveur DHCP')}" data-tip="${tl('Relais DHCP (ip helper) : adresse du serveur')}"`, f.helper))
    + L2(tl('Liste d’accès en entrée'), sel(`data-slist="svis" data-i="${i}" data-f="aclIn"`, aclOpts(P), f.aclIn)) + (f.helper ? `<div class="ntSmL wide">${chk(`data-slist="svis" data-i="${i}" data-f="o82"`, f.o82, tl('Option 82 (interface du relais transmise au serveur)'))}</div>` : ''), i, 'svis')).join('');
  return sec(tl('Interfaces VLAN (SVI)'), chk('data-sset="routing"', P.routing !== false, tl('Routage IP actif')) + (rows || `<p class="mut">${tl('Aucune interface VLAN : ajoutez-en une par VLAN à router (passerelle des postes).')}</p>`) + `<div class="row">${add('svis', tl('Interface VLAN'))}</div>`,
    tl('Une interface VLAN est active si un port relié porte son VLAN.'));
}
function ifSec(ctx, n) {
  const P = n.p, ports = portsOf(n).map(p => [p.id, p.label]);
  const rows = (P.ifs || []).map((f, i) => card(`${sel(`data-slist="ifs" data-i="${i}" data-f="port" aria-label="${tl('Port')}"`, ports, f.port)}<b>.</b>${inp(`type="number" min="0" max="4094" data-slist="ifs" data-i="${i}" data-f="vlan" aria-label="VLAN" data-tip="${tl('0 : interface ; 1 à 4094 : sous-interface 802.1Q')}"`, f.vlan, 'class="inp ntSmIn tiny"')}<span class="grow"></span>${ifState(ctx, n, f, x => x.port === f.port && x.vlan === f.vlan)}`,
    L2(tl('Mode'), sel(`data-slist="ifs" data-i="${i}" data-f="mode"`, [['static', tl('fixe')], ['dhcp', 'DHCP']], f.mode)) + L2('NAT', sel(`data-slist="ifs" data-i="${i}" data-f="nat"`, [['', '—'], ['inside', tl('intérieur')], ['outside', tl('extérieur')]], f.nat))
    + (f.mode === 'static' ? L2(tl('Adresse'), `<span class="ntSmIp">${ipCell('ifs', i, f)}</span>`, true) : '')
    + L2(tl('Relais DHCP'), inp(`data-slist="ifs" data-i="${i}" data-f="helper" placeholder="${tl('serveur DHCP')}"`, f.helper)) + L2(tl('Liste d’accès en entrée'), sel(`data-slist="ifs" data-i="${i}" data-f="aclIn"`, aclOpts(P), f.aclIn)) + (f.helper ? `<div class="ntSmL wide">${chk(`data-slist="ifs" data-i="${i}" data-f="o82"`, f.o82, tl('Option 82 (interface du relais transmise au serveur)'))}</div>` : ''), i, 'ifs')).join('');
  return sec(tl('Interfaces et sous-interfaces'), rows + `<div class="row">${add('ifs', tl('Interface'))}</div>`,
    tl('Routeur sur un bâton : une sous-interface par VLAN sur un port relié à un trunk.'));
}
function routeSec(ctx, n) {
  const P = n.p, tab = ctx.lan().routes(n.id);
  const txt = r => `${[r.net >>> 24, (r.net >>> 16) & 255, (r.net >>> 8) & 255, r.net & 255].join('.')}/${r.prefix}`;
  const KIND = { connected: tl('connectée'), static: tl('statique'), default: tl('par défaut'), dhcp: 'DHCP', ospf: 'OSPF' };
  const bad = r => (tab.bad || []).some(b => b.net === r.net && b.via === r.via);
  const rows = (P.routes || []).map((r, i) => `<div class="ntSmRoute">${inp(`data-slist="routes" data-i="${i}" data-f="net" aria-label="${tl('Réseau')}"`, r.net)}${inp(`data-slist="routes" data-i="${i}" data-f="via" aria-label="${tl('Passerelle')}"`, r.via)}${del('routes', i)}${bad(r) ? `<small class="bad">${tl('passerelle injoignable')}</small>` : ''}</div>`).join('');
  return sec(tl('Routage'), `<div class="ntSmScroll"><table class="ntTable mono ntSmRt"><tr><th>${tl('Réseau')}</th><th>${tl('Passerelle')}</th><th>${tl('Interface de sortie')}</th><th>${tl('Type')}</th></tr>${tab.map(r => `<tr><td>${txt(r)}</td><td>${esc((r.paths && r.paths.length > 1 ? r.paths.map(x => x.via) : [r.via || '—']).join(' / '))}</td><td>${esc((r.paths && r.paths.length > 1 ? r.paths.map(x => x.iface.port || x.iface.role) : [r.iface.port || r.iface.role]).join(' / '))}</td><td>${esc(KIND[r.kind] || r.kind)}${r.kind === 'ospf' ? ` ${r.type === 'inter' ? 'IA' : 'O'} ${r.metric}` : ''}</td></tr>`).join('') || `<tr><td colspan="4" class="mut">${tl('Table vide : aucune interface active.')}</td></tr>`}</table></div>`
    + `<h4>${tl('Routes statiques')}</h4>${rows}<div class="row">${add('routes', tl('Route'))}</div>`,
  tl('Plus long préfixe d’abord ; 0.0.0.0/0 : route par défaut.'));
}
function dhcpSec(ctx, n) {
  const P = n.p, lan = ctx.lan(), leases = lan.state().ifaces.filter(f => f.server === n.id), full = lan.full().filter(e => e.node === n.id);
  const f = (i, k, ph) => inp(`data-slist="dhcp" data-i="${i}" data-f="${k}" placeholder="${ph}"`, P.dhcp[i][k]);
  const rows = (P.dhcp || []).map((s2, i) => card(`${chk(`data-slist="dhcp" data-i="${i}" data-f="on" aria-label="${tl('Étendue')}"`, s2.on, '')}${inp(`data-slist="dhcp" data-i="${i}" data-f="net" aria-label="${tl('Réseau')}"`, s2.net)}${full.some(e => e.scope === s2.net) ? `<span class="bad">${tl('pleine')}</span>` : ''}`,
    L2(tl('début'), f(i, 'from', tl('début'))) + L2(tl('fin'), f(i, 'to', tl('fin'))) + L2(tl('Passerelle'), f(i, 'gw', '10.0.10.1')) + L2('DNS', f(i, 'dns', '10.0.99.10')), i, 'dhcp')).join('');
  return sec(tl('Serveur DHCP : étendues'), (rows || `<p class="mut">${tl('Aucune étendue.')}</p>`) + `<div class="row">${add('dhcp', tl('Étendue'))}</div>`
    + (leases.length ? `<details class="ntSmMore"><summary>${tl('{0:# bail|# baux}', leases.length)}</summary><table class="ntTable mono">${leases.map(x => `<tr><td>${esc(ctx.nameOf(x.node))}</td><td>${esc(x.ip)}</td><td>${x.relay ? esc(tl('par {0}', ctx.nameOf(x.relay))) : ''}</td></tr>`).join('')}</table></details>` : ''),
  tl('Le serveur choisit l’étendue du réseau de l’interface qui reçoit la demande, ou de l’adresse du relais (giaddr).'));
}
/** Règle en texte, façon Cisco : « permit tcp 10.0.20.0/24 any eq 80 », « permit tcp any eq 80 any established ». */
const aclLine = r => [r.act, r.proto, r.src, r.sport ? 'eq ' + r.sport : '', r.dst, r.port ? 'eq ' + r.port : '', r.est ? 'established' : ''].filter(Boolean).join(' ');
function aclSec(ctx, n) {
  const P = n.p;
  const rows = (P.acls || []).map((a, i) => `<div class="ntSmAcl"><div class="row">${inp(`data-slist="acls" data-i="${i}" data-f="name" aria-label="${tl('Nom')}"`, a.name)}${del('acls', i)}</div><textarea class="inp ntSmTa" rows="${Math.max(2, a.rules.length + 1)}" data-stext="acl" data-i="${i}" spellcheck="false" aria-label="${tl('Règles')}">${esc(a.rules.map(aclLine).join('\n'))}</textarea></div>`).join('');
  return sec(tl('Listes d’accès (ACL)'), rows + `<p class="mut ntSmNote">${tl('Une règle par ligne : permit|deny any|icmp|tcp|udp source [eq port] destination [eq port] [established]. La première qui correspond décide, tout le reste est refusé. Filtrage sans état : les réponses passent aussi par la liste.')}</p><div class="row">${add('acls', tl('Liste d’accès'))}</div>`);
}
function natSec(ctx, n) {
  const P = n.p, lines = (P.fwd || []).map(f => `${f.proto} ${f.port} ${f.to} ${f.toPort}`).join('\n');
  return sec(tl('Traduction d’adresses (NAT)'), `<p class="mut">${tl('Les adresses des interfaces « intérieur » sortent avec celle de l’interface « extérieur ».')}</p><label class="ntF"><span>${tl('Redirections de ports')}</span><textarea class="inp ntSmTa" rows="${Math.max(2, (P.fwd || []).length + 1)}" data-stext="fwd" spellcheck="false" placeholder="tcp 8080 192.168.10.50 80">${esc(lines)}</textarea></label>`);
}
function dnsSec(ctx, n) {
  const D = n.p.dns;
  return sec('DNS', chk('data-sset="dns.on"', D.on, tl('Serveur DNS actif (noms des appareils du plan, plus ces enregistrements)')) + `<textarea class="inp ntSmTa" rows="${Math.max(2, D.records.length + 1)}" data-stext="dns" spellcheck="false" placeholder="intranet 10.0.99.20" aria-label="${tl('Enregistrements A')}">${esc(D.records.map(r => `${r.name} ${r.ip}`).join('\n'))}</textarea>`);
}

/* ---------- Base des VLAN ---------- */
/** Exemple de passerelle : première adresse du sous-réseau saisi (sinon un exemple générique). */
const gwHint = net => { const n = parseNet(net); return n && n.prefix <= 30 ? ipStr(n.net + 1) : '10.0.10.1'; };
/** Éditeur de la base des VLAN du projet (inspecteur quand rien n'est choisi). */
export function vlanDbPane(ctx) {
  const V = ctx.data().vlans || [];
  const rows = V.map((v, i) => `<div class="ntSmV"><i class="ntSmSw" style="background:${vlanColor(ctx.data(), v.id)}"></i>${inp(`type="number" min="1" max="4094" data-vdb="${i}" data-f="id" aria-label="VLAN"`, v.id)}${inp(`data-vdb="${i}" data-f="name" aria-label="${tl('Nom')}"`, v.name)}<button type="button" class="tb ntSmDel" data-vdel="${i}" aria-label="${tl('Retirer')}">${icon('x')}</button>`
    + `<span></span><div class="ntSmNet">${inp(`data-vdb="${i}" data-f="net" placeholder="10.0.10.0/24" aria-label="${tl('Sous-réseau')}" data-tip="${tl('Sous-réseau')}"`, v.net)}${inp(`data-vdb="${i}" data-f="gw" placeholder="${gwHint(v.net)}" aria-label="${tl('Passerelle')}" data-tip="${tl('Passerelle')}"`, v.gw)}</div></div>`).join('');
  return `<section class="ntSec ntSm ntSmVdb" id="ntVlanDb"><h4>${icon('vlanTag')}${tl('Base des VLAN du projet')}</h4>${rows || `<p class="mut">${tl('Aucun VLAN déclaré : tout le réseau est dans le VLAN 1.')}</p>`}<div class="row"><button type="button" class="btn small subtle" data-vadd>${icon('plus')}<span>${tl('VLAN')}</span></button></div></section>`;
}

/* ---------- Événements ---------- */
const NUM = new Set(['vlan', 'voice', 'native', 'cost', 'prio', 'id', 'ospf.ref']);
/** Lit la valeur d'un champ : booléen, nombre, préfixe (/24), texte borné. */
function valueOf(t, f) {
  if (t.type === 'checkbox') return t.checked;
  if (f === 'prefix') return prefixOf(t.value);
  if (NUM.has(f) || f.endsWith('.prio')) return Math.round(+t.value || 0);
  if (f === 'ospf.rid') return String(t.value).trim();
  return cleanText(String(t.value), 64).trim();
}
/** Nettoie les réglages d'un équipement par son type (mêmes règles qu'un fichier). */
const reclean = d => { const s = DEVICES[d.type]; if (s && s.clean) d.p = s.clean(d.p, s.props()); };
/** Lit une règle : act proto source [eq port] destination [eq port] [established] (un nombre seul en fin : port de destination). */
function parseRule(w) {
  const r = { act: w[0].toLowerCase(), proto: (w[1] || 'any').toLowerCase(), src: 'any', dst: 'any', port: 0 };
  let i = 2;
  const addr = () => w[i++] || 'any', eq = () => { if ((w[i] || '').toLowerCase() === 'eq') { i += 2; return +w[i - 1] || 0; } return 0; };
  r.src = addr(); const sp = eq(); if (sp) r.sport = sp;
  r.dst = addr(); r.port = eq();
  for (; i < w.length; i++) { if (/^established$/i.test(w[i])) r.est = true; else if (/^\d+$/.test(w[i]) && !r.port) r.port = +w[i]; }
  return r;
}
const parseRules = txt => String(txt).split('\n').map(l => l.trim().split(/\s+/)).filter(w => w[0] && /^(permit|deny)$/i.test(w[0])).map(parseRule);
/** Défauts d'une nouvelle ligne de liste. */
function newItem(list, d, data) {
  const used = new Set((d.p.svis || []).map(s => s.vlan)), free = (data.vlans || []).map(v => v.id).find(v => !used.has(v)) || 10;
  const vl = (data.vlans || []).find(v => v.id === free), gw = vl && vl.gw ? vl.gw : `10.0.${free % 256}.1`;
  if (list === 'svis') return { vlan: free, ip: gw, prefix: vl && vl.net ? +vl.net.split('/')[1] : 24, helper: '' };
  if (list === 'ifs') { const subs = (d.p.ifs || []).filter(f => f.port === 'ge1').map(f => f.vlan); const v = (data.vlans || []).map(x => x.id).find(x => !subs.includes(x)) || 10; return { port: 'ge1', vlan: v, mode: 'static', ip: `10.0.${v % 256}.1`, prefix: 24, nat: 'inside' }; }
  if (list === 'routes') return { net: '0.0.0.0/0', via: '' };
  if (list === 'dhcp') { const n = parseNet((vl && vl.net) || `10.0.${free % 256}.0/24`); return { net: n.text, from: '', to: '', gw, dns: '', on: true }; }
  if (list === 'lags') { let i = 1; while ((d.p.lags || []).some(g => g.id === 'Po' + i)) i++; return { id: 'Po' + i, mode: 'active' }; }
  if (list === 'acls') { let i = 1; while ((d.p.acls || []).some(a => a.name === 'ACL' + i)) i++; return { name: 'ACL' + i, rules: [{ act: 'permit', proto: 'any', src: 'any', dst: 'any', port: 0 }] }; }
  return {};
}
/**
 * Événement de l'inspecteur (change, click) sur un champ de simpane.js : modifie le modèle et enregistre (ctx.commit).
 * Rend true s'il est traité. d : équipement choisi (modèle) ou null.
 */
export function simPaneEvent(ctx, e, d) {
  const t = e.target, data = ctx.data();
  // Base des VLAN.
  if (e.type === 'click' && t.closest('[data-vadd]')) {
    const ids = new Set((data.vlans || []).map(v => v.id)); let id = 10; while (ids.has(id)) id += 10;
    data.vlans = cleanVlans([...(data.vlans || []), { id, name: 'VLAN' + id, net: `10.0.${id % 256}.0/24`, gw: `10.0.${id % 256}.1` }]); ctx.commit(); return true;
  }
  if (e.type === 'click' && t.closest('[data-vdel]')) { const i = +t.closest('[data-vdel]').dataset.vdel; data.vlans = (data.vlans || []).filter((_, k) => k !== i); ctx.commit(); return true; }
  if (e.type === 'change' && t.dataset.vdb != null) {
    const v = data.vlans[+t.dataset.vdb]; if (!v) return true;
    v[t.dataset.f] = valueOf(t, t.dataset.f); data.vlans = cleanVlans(data.vlans);
    if (t.dataset.f === 'net' && v.net && !v.gw) { const n = parseNet(v.net); if (n) v.gw = [n.net >>> 24, (n.net >>> 16) & 255, (n.net >>> 8) & 255, (n.net & 255) + 1].join('.'); }
    ctx.commit(); return true;
  }
  if (!d || !(MANAGED.has(d.type) || ['routerpro', 'server'].includes(d.type))) return false;
  const P = d.p;
  if (e.type === 'click') {
    const a = t.closest('[data-sadd]'), r = t.closest('[data-sdel]');
    if (a) { const l = a.dataset.sadd; P[l] = [...(P[l] || []), newItem(l, d, data)]; reclean(d); ctx.commit(); return true; }
    if (r) {
      const l = r.dataset.sdel, i = +r.dataset.i, gone = (P[l] || [])[i]; P[l] = (P[l] || []).filter((_, k) => k !== i);
      if (l === 'lags' && gone) for (const c of Object.values(P.ports || {})) if (c.lag === gone.id) c.lag = '';
      reclean(d); ctx.commit(); return true;
    }
    return false;
  }
  if (e.type !== 'change') return false;
  if (t.dataset.sport) {
    const p = t.dataset.sport, f = t.dataset.f; P.ports = P.ports || {};
    P.ports[p] = { ...portCfg(d, p), [f]: valueOf(t, f) };
    reclean(d); ctx.commit(); return true;
  }
  if (t.dataset.ssfp) {
    const cur = P.sfp && typeof P.sfp === 'object' ? { ...P.sfp } : {};
    if (t.value) cur[t.dataset.ssfp] = t.value; else delete cur[t.dataset.ssfp];
    P.sfp = cur; reclean(d); ctx.commit(); return true;
  }
  if (t.dataset.sprio) { P.stp.vlans = { ...(P.stp.vlans || {}), [t.dataset.sprio]: +t.value }; reclean(d); ctx.commit(); return true; }
  if (t.dataset.sospf) {
    const O = P.ospf || (P.ospf = { on: true, nets: [], ifs: {} }); O.ifs = O.ifs || {};
    const name = t.dataset.sospf, f = t.dataset.f; O.ifs[name] = { ...ospfOwn(P, name), [f]: t.type === 'checkbox' ? t.checked : +t.value || 0 };
    reclean(d); ctx.commit(); return true;
  }
  if (t.dataset.sset) {
    const ks = t.dataset.sset.split('.'); let o = P; for (const k of ks.slice(0, -1)) o = o[k] || (o[k] = {});
    o[ks[ks.length - 1]] = valueOf(t, t.dataset.sset); reclean(d); ctx.commit(); return true;
  }
  if (t.dataset.slist) {
    const it = (P[t.dataset.slist] || [])[+t.dataset.i]; if (!it) return true;
    const f = t.dataset.f, v = valueOf(t, f);
    if (f === 'prefix' && v == null) { ctx.status(tl('Masque invalide : écrivez /24 ou 255.255.255.0.'), 'warn'); ctx.renderPane(); return true; }
    if (t.dataset.slist === 'lags' && f === 'id') return true;
    it[f] = f === 'vlan' && t.dataset.slist === 'ifs' ? Math.max(0, v) : v;
    reclean(d); ctx.commit(); return true;
  }
  if (t.dataset.stext) {
    const k = t.dataset.stext;
    if (k === 'acl') { const a = (P.acls || [])[+t.dataset.i]; if (a) a.rules = parseRules(t.value); }
    if (k === 'fwd') P.fwd = String(t.value).split('\n').map(l => l.trim().split(/\s+/)).filter(w => w.length >= 3).map(w => ({ proto: w[0].toLowerCase(), port: +w[1], to: w[2], toPort: +(w[3] || w[1]) }));
    if (k === 'onets') P.ospf = { ...(P.ospf || {}), nets: String(t.value).split('\n').map(l => l.trim().split(/\s+/)).filter(w => w[0]).map(w => ({ net: w[0], area: +w[1] || 0 })) };
    if (k === 'dns') P.dns = { ...(P.dns || { on: true }), records: String(t.value).split('\n').map(l => l.trim().split(/\s+/)).filter(w => w.length >= 2).map(w => ({ name: w[0], ip: w[1] })) };
    reclean(d); ctx.commit(); return true;
  }
  return false;
}

/* ---------- Traceroute ---------- */
/** Lignes d'un traceroute, façon terminal. */
export function traceLines(r, target, nameOf) {
  const out = [tl('traceroute vers {0} ({1}), 30 sauts au plus', target, r.ip || '?')];
  for (const h of r.hops || []) out.push(h.ip ? `${String(h.n).padStart(2)}  ${h.ip}${h.node ? ' (' + nameOf(h.node) + ')' : ''}  ${h.ok ? h.ms + ' ms' : '* * *'}${h.why ? '  ' + whyText(h.why) : ''}` : `${String(h.n).padStart(2)}  * * *  ${whyText(h.why)}`);
  if (!r.hops || !r.hops.length) out.push(`    ${whyText(r.why)}`);
  return out;
}

/* ---------- Disposition automatique ---------- */
/**
 * Range le schéma logique en couches : routeurs et cœur en haut, puis distribution, accès, enfin les postes sous leur
 * switch (prises et panneaux à côté). Couche d'un switch : distance (en liens) au cœur. Rend le nombre d'équipements
 * déplacés. Modifie data.devices (x, y) ; l'appelant enregistre.
 */
export function autoArrange(data, lan) {
  const st = lan.state(), devs = data.devices.filter(d => specOf(d) && specOf(d).role !== 'mech');
  if (!devs.length) return 0;
  const role = d => specOf(d).role, adj = new Map(devs.map(d => [d.id, new Set()]));
  for (const [k, l] of st.links) { if (!l.peer) continue; const a = k.split('|')[0]; if (adj.has(a) && adj.has(l.peer.n)) { adj.get(a).add(l.peer.n); adj.get(l.peer.n).add(a); } }
  // Couche 0 : routeurs, box, switchs de niveau 3 ; puis largeur d'abord sur les switchs et points d'accès.
  const layer = new Map(), q = [];
  for (const d of devs) if (role(d) === 'l3' || role(d) === 'router' || d.type === 'l3switch') { layer.set(d.id, 0); q.push(d.id); }
  if (!q.length) { const sw = devs.filter(d => role(d) === 'switch').sort((a, b) => adj.get(b.id).size - adj.get(a.id).size)[0]; if (sw) { layer.set(sw.id, 0); q.push(sw.id); } }
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    for (const w of adj.get(u)) { const r = role(devs.find(x => x.id === w)); if (layer.has(w) || (r !== 'switch' && r !== 'ap')) continue; layer.set(w, layer.get(u) + 1); q.push(w); }
  }
  const byId = new Map(devs.map(d => [d.id, d])), maxL = Math.max(0, ...layer.values());
  // Voisins par câble (tous appareils, passifs compris) : un passif va sous le premier switch atteint en suivant les câbles.
  const cab = new Map(devs.map(d => [d.id, []]));
  for (const c of data.cables) if (cab.has(c.a[0]) && cab.has(c.b[0])) { cab.get(c.a[0]).push(c.b[0]); cab.get(c.b[0]).push(c.a[0]); }
  const nearest = id => {
    const seen = new Set([id]), fifo = [id];
    for (let i = 0; i < fifo.length && i < 400; i++) for (const w of cab.get(fifo[i]) || []) { if (seen.has(w)) continue; if (layer.has(w)) return w; seen.add(w); fifo.push(w); }
    return null;
  };
  // Les postes (et les switchs isolés) vont sous le switch auquel ils sont reliés.
  const under = new Map();
  for (const d of devs) {
    if (layer.has(d.id)) continue;
    let host = null;
    if (role(d) !== 'passive') {
      const ch = portsOf(d).map(p => lan.channel(d.id, p.id)).find(c => c && c.far);
      host = ch && layer.has(ch.far.n) ? ch.far.n : [...adj.get(d.id)].find(x => layer.has(x)) || null;
    }
    host = host || nearest(d.id);
    const k = host || '_'; if (!under.has(k)) under.set(k, []); under.get(k).push(d);
  }
  const rows = Array.from({ length: maxL + 1 }, () => []);
  for (const [id, l] of layer) rows[l].push(byId.get(id));
  // Rangées de 12 au plus ; largeur et hauteur réelles, pour qu'aucun bloc n'en chevauche un autre.
  const PER = 12, GAP = 40, HG = 20, VG = 34;
  const chunks = list => { const out = []; for (let i = 0; i < list.length; i += PER) out.push(list.slice(i, i + PER)); return out; };
  const blockOf = kids => {
    // Panneaux d'abord, puis prises, puis appareils ; une sorte par rangée.
    const pas = kids.filter(d => role(d) === 'passive'), kinds = [...new Set(pas.map(d => d.type))].sort((a, b) => specOf(pas.find(d => d.type === b)).w - specOf(pas.find(d => d.type === a)).w);
    const lines = [...kinds.flatMap(t => chunks(pas.filter(d => d.type === t))), ...chunks(kids.filter(d => role(d) !== 'passive'))];
    const w = Math.max(0, ...lines.map(l => l.reduce((t, d) => t + specOf(d).w + HG, -HG)));
    const h = lines.reduce((t, l) => t + Math.max(...l.map(d => specOf(d).h)) + VG, 0);
    return { lines, w, h };
  };
  const placeBlock = (blk, x0, y0) => { let y = y0; for (const l of blk.lines) { let x = x0; for (const d of l) { d.x = Math.round(x); d.y = Math.round(y); x += specOf(d).w + HG; moved++; } y += Math.max(...l.map(d => specOf(d).h)) + VG; } return y; };
  const xOf = new Map(); let moved = 0, y = 0;
  function bary(d) { const ps = [...adj.get(d.id)].filter(x => xOf.has(x)); return ps.length ? ps.reduce((a, x) => a + xOf.get(x), 0) / ps.length : 0; }
  for (let l = 0; l <= maxL; l++) {
    const row = rows[l];
    if (l > 0) row.sort((a, b) => bary(a) - bary(b));
    let x = 0, bottom = y;
    for (const d of row) {
      const s = specOf(d), blk = blockOf(under.get(d.id) || []), w = Math.max(s.w, blk.w);
      d.x = Math.round(x + (w - s.w) / 2); d.y = y; xOf.set(d.id, d.x + s.w / 2); moved++;
      bottom = Math.max(bottom, y + s.h, blk.lines.length ? placeBlock(blk, x, y + s.h + 60) : 0);
      x += w + GAP;
    }
    y = bottom + 90;
  }
  // Appareils reliés à rien de rangé : en bas.
  if (under.has('_')) placeBlock(blockOf(under.get('_')), 0, y);
  return moved;
}
