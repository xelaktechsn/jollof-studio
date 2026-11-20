// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Plan réseau : éditeur des équipements et des câbles (SVG), bibliothèque, inspecteur, outils (câble, testeur, ping),
// atelier de sertissage, navigateur du PC, broker MQTT, automate Modbus, table MAC. Chargé seulement quand le projet en
// a besoin (install.js). La simulation est celle de src/net/lan.js, partagée avec les programmes des cartes (projet
// Objets connectés : les modules Ethernet et les cartes Wi-Fi du montage y sont des nœuds).
import './net.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { createNavDock } from '../../ui/navdock.js';
import { spacesOf } from '../../ui/kind.js';
import { menu as popMenu, confirm as confirmDlg, toast } from '../../school/ui.js';
import { cleanText } from '../../sanitize.js';
import { createLan } from '../lan.js';
import { DEVICES, LIB_GROUPS, specOf, portsOf, newDevice } from '../devices.js';
import { makeCable, CATS, CAT_IDS, analyzeCable } from '../cable.js';
import { cleanNet } from '../clean.js';
import { netIssues, NET_SRC } from '../issues.js';
import { prefixOf, isIp, maskStr } from '../ip.js';
import { extNodes, whyText } from '../labcheck.js';
import { openCrimp, cableSvg, crimpVerdict } from './crimp.js';
import { openTester, testerSummary } from './tester.js';
import { explain } from '../../check/explain.js';
import { SOURCES } from '../../check/sources.js';
import { cleanHtml } from '../../sim/models.js';
import { kindOf, boardOf } from '../../sim/boards.js';
import { macOf } from '../../sim/models.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PORT_W = 12, PORT_H = 9, GRID = 10;
const snap = v => Math.round(v / GRID) * GRID;
const speedTxt = s => (s >= 10000 ? '10 Gb/s' : s >= 1000 ? '1 Gb/s' : s >= 100 ? '100 Mb/s' : s ? '10 Mb/s' : '');
const ledCls = l => (!l ? 'off' : !l.up ? 'down' : l.errors ? 'err' : l.speed >= 1000 ? 'g' : l.speed >= 100 ? 'f' : 'e');
const PREF = 'jollof-net-cable';

/** Positions des ports sur le dessin d'un équipement (repère local, origine en haut à gauche). */
function portLayout(d, spec) {
  const ports = portsOf(d), w = spec.w, h = spec.h, out = new Map();
  const row = (list, y) => { const n = list.length, gap = Math.min(18, (w - 16) / Math.max(1, n)); const x0 = w / 2 - (gap * (n - 1)) / 2; list.forEach((p, i) => out.set(p.id, { x: x0 + i * gap, y })); };
  if (d.type === 'patch' || d.type === 'outlet') { row(ports.filter(p => !p.punch), h); row(ports.filter(p => p.punch), 0); }
  else row(ports, h);
  return out;
}

export function createNetWorkspace(app, ui, raw) {
  const $ = s => document.querySelector(s), appEl = $('.app');
  let data = cleanNet(raw), on = false, fitted = false;
  let sel = null; // { kind: 'dev' | 'cable', id }
  let tool = 'select', pingFrom = null, pingOut = null, browser = null, crimpUi = null, testerUi = null;
  let cableDef = { kind: 'straight', cat: 'cat6', len: 3 };
  try { const v = JSON.parse(localStorage.getItem(PREF) || 'null'); if (v && CATS[v.cat]) cableDef = { ...cableDef, ...v }; } catch (e) { /* stockage indisponible */ }
  const view = { x: -40, y: -40, k: 1 };

  /* ---------- Réseau simulé ---------- */
  const comps = () => (spacesOf(app.kind()).includes('elec') ? app.comps() : []);
  const ext = () => {
    const list = extNodes(comps(), data.ext, c => (boardOf(c) ? kindOf(c) : c.type));
    // Place par défaut d'un nœud du montage : une colonne à gauche du plan.
    list.forEach((n, i) => { const k = n.id.slice(2); if (!data.ext[k] && !data.ext[n.id]) { n.x = -200; n.y = i * 90; } else { const p = data.ext[k] || data.ext[n.id]; n.x = p.x; n.y = p.y; } if (n.type === 'wifi') { const c = comps().find(x => 'e:' + x.id === n.id); if (c) n.mac = () => macOf(c); } });
    return list;
  };
  const lan = createLan({
    data: () => data, ext,
    sig: () => JSON.stringify(comps().map(c => (c.periph ? [c.periph.eth && c.periph.eth.ip, c.periph.wifi && c.periph.wifi.ip, c.periph.wifi && c.periph.wifi.lan] : 0))),
    plc: () => null,
    changed: () => { app.markDirty(); renderPane(); }
  });
  lan.on(e => {
    if (e.t === 'ping') return; // le journal du ping est écrit par son outil
    if (e.t === 'mqtt' && e.kind === 'publish') app.log(tl('MQTT · {0} : {1} = {2}', nameOf(e.node), e.topic, String(e.text).slice(0, 80)), 'info');
    else if (e.t === 'dhcp') app.log(tl('DHCP · {0} donne {1} à {2}', nameOf(e.node), e.ip, nameOf(e.to)), 'info');
    if (on) { if (e.t === 'mqtt' || e.t === 'modbus') renderPaneSoon(); }
  });
  const nameOf = id => { const n = lan.state().byId.get(id); return n ? n.name || specOf(n).name() : id; };

  /* ---------- Historique (Ctrl+Z) ---------- */
  const H = { undo: [], redo: [] };
  let snapshot = JSON.stringify(data);
  function commit() {
    const s = JSON.stringify(data); if (s === snapshot) return;
    H.undo.push(snapshot); if (H.undo.length > 120) H.undo.shift(); H.redo = []; snapshot = s;
    changed();
  }
  function travel(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(data)); data = cleanNet(JSON.parse(from.pop())); data.view = 'net'; snapshot = JSON.stringify(data);
    if (sel && !(sel.kind === 'dev' ? findDev(sel.id) || sel.id.startsWith('e:') : data.cables.some(c => c.id === sel.id))) sel = null;
    changed(); app.status(tl('Annulé ou rétabli.'));
  }
  const history = { undo: () => travel(H.undo, H.redo), redo: () => travel(H.redo, H.undo), canUndo: () => H.undo.length > 0, canRedo: () => H.redo.length > 0 };
  function changed() {
    lan.refresh(); render(); renderPane(); counts(); app.markDirty(); if (app.recheck) app.recheck(); if (on) app.historyUI();
    if (data.devices.length && app.ensureSpace) app.ensureSpace('net');
  }
  const findDev = id => data.devices.find(d => d.id === id) || null;
  const nodeById = id => lan.state().byId.get(id) || null;

  /* ---------- Plan de travail ---------- */
  const host = document.createElement('div'); host.className = 'ntHost'; host.hidden = true;
  $('#stage').appendChild(host);
  host.innerHTML = `
    <div class="ntView"><svg class="ntSvg" xmlns="http://www.w3.org/2000/svg"><g class="ntWorld"><g class="ntCables"></g><g class="ntWifi"></g><g class="ntDevs"></g><g class="ntOver"></g></g></svg></div>
    <div class="ntBar top">
      <div class="seg glass ntTools" role="group" aria-label="${tl('Outils du plan réseau')}">
        <button type="button" class="segBtn" data-tool="select" data-tip="${tl('Choisir et déplacer · V. Glisser d’un port à un autre : tirer un câble.')}">${icon('pointer')}<span>${tl('Choisir')}</span></button>
        <button type="button" class="segBtn" data-tool="cable" data-tip="${tl('Câble · C : cliquer un port puis un autre')}">${icon('cable')}<span>${tl('Câble')}</span></button>
        <button type="button" class="segBtn" data-tool="tester" data-tip="${tl('Testeur de câble · T : cliquer un câble ou un port')}">${icon('cableTester')}<span>${tl('Testeur')}</span></button>
        <button type="button" class="segBtn" data-tool="ping" data-tip="${tl('Ping · P : cliquer l’appareil de départ puis celui d’arrivée')}">${icon('ping')}<span>Ping</span></button>
      </div>
      <div class="glass ntDef" aria-label="${tl('Câble neuf')}">
        <label><span>${tl('Câble neuf')}</span><select class="sel" data-def="kind">
          <option value="straight">${tl('droit (T568B, serti)')}</option><option value="crossover">${tl('croisé (T568A-T568B)')}</option><option value="blank">${tl('à sertir soi-même')}</option></select></label>
        <select class="sel" data-def="cat" aria-label="${tl('Catégorie')}">${CAT_IDS.map(k => `<option value="${k}">${CATS[k].name}</option>`).join('')}</select>
        <label class="ntLen"><input class="inp" data-def="len" type="number" min="0.5" max="300" step="0.5" aria-label="${tl('Longueur (m)')}"><span>m</span></label>
      </div>
      <span class="grow"></span>
    </div>
    <div class="ntBar bottom"><div class="ntLegend glass"><span><i class="g"></i>1 Gb/s</span><span><i class="f"></i>100 Mb/s</span><span><i class="e"></i>10 Mb/s</span><span><i class="err"></i>${tl('erreurs')}</span><span><i class="down"></i>${tl('pas de lien')}</span><span><i class="poe"></i>PoE</span></div><span class="grow"></span><span class="ntHint glass"></span></div>
    <div class="ntEmpty"><div class="ntEmptyCard">${icon('network')}<b>${tl('Plan réseau')}</b>
      <p>${tl('Glissez une box, un switch et des PC depuis la bibliothèque, puis tirez des câbles de port en port. Cliquez un câble pour le sertir ou le tester, un PC pour régler son adresse IP et faire un ping.')}</p>
      <div class="row"><button type="button" class="btn primary" data-labs>${icon('checklist')}<span>${tl('TP de réseau')}</span></button><button type="button" class="btn" data-starter>${icon('wand')}<span>${tl('Petit réseau de départ')}</span></button></div></div></div>`;
  const svg = host.querySelector('.ntSvg'), world = host.querySelector('.ntWorld'), gCab = host.querySelector('.ntCables'), gWifi = host.querySelector('.ntWifi'), gDev = host.querySelector('.ntDevs'), gOver = host.querySelector('.ntOver');
  const hint = host.querySelector('.ntHint');
  const defEl = k => host.querySelector(`[data-def="${k}"]`);
  defEl('kind').value = cableDef.kind; defEl('cat').value = cableDef.cat; defEl('len').value = cableDef.len;
  host.querySelector('.ntDef').addEventListener('change', () => {
    cableDef = { kind: defEl('kind').value, cat: defEl('cat').value, len: Math.max(0.5, Math.min(300, +defEl('len').value || 3)) };
    try { localStorage.setItem(PREF, JSON.stringify(cableDef)); } catch (e) { /* rien */ }
  });
  host.addEventListener('click', e => {
    const t = e.target.closest('[data-tool]'); if (t) { setTool(t.dataset.tool); return; }
    if (e.target.closest('[data-labs]')) { if (app.openLabs) app.openLabs('net'); return; }
    if (e.target.closest('[data-starter]')) starter();
  });
  function setTool(t) {
    tool = t; pingFrom = null;
    host.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    host.classList.toggle('toolCable', t === 'cable'); host.classList.toggle('toolTester', t === 'tester'); host.classList.toggle('toolPing', t === 'ping');
    paintHint(); render();
  }
  function paintHint() {
    hint.textContent = tool === 'cable' ? (rubber ? tl('Cliquez le port d’arrivée (Échap : annuler).') : tl('Cliquez un port libre : le câble part de là.'))
      : tool === 'tester' ? tl('Cliquez un câble (ou un port) pour le passer au testeur.')
        : tool === 'ping' ? (pingFrom ? tl('Ping depuis {0} : cliquez l’appareil à joindre.', nameOf(pingFrom)) : tl('Cliquez l’appareil qui envoie le ping.'))
          : tl('Glisser un appareil : le déplacer · d’un port à un autre : un câble · clic : ses réglages à droite');
  }
  /** Petit réseau pour commencer : une box, un switch, deux PC, câblés. */
  function starter() {
    const used = new Set(data.devices.map(d => d.name));
    const add = (type, x, y) => { const d = newDevice(type, used, { x, y }); d.id = freeId(type); used.add(d.name); data.devices.push(d); return d; };
    const box = add('router', 0, 0), sw = add('switch', -15, 140), a = add('pc', -60, 280), b = add('pc', 80, 280);
    addCable([box.id, 'lan1'], [sw.id, 'p1']); addCable([a.id, 'eth0'], [sw.id, 'p3']); addCable([b.id, 'eth0'], [sw.id, 'p5']);
    commit(); fit();
  }
  const freeId = type => { const p = (DEVICES[type].prefix || 'n').toLowerCase(); let i = 1; while (data.devices.some(d => d.id === p + i)) i++; return p + i; };
  function addCable(a, b, o = {}) {
    let id = 'c1', i = 1; while (data.cables.some(c => c.id === id)) id = 'c' + ++i;
    const c = { id, a, b, cat: o.cat || cableDef.cat, len: o.len || cableDef.len, wire: makeCable(o.kind || cableDef.kind) };
    data.cables.push(c); return c;
  }

  /* ---------- Dessin ---------- */
  const nodes = () => { const st = lan.state(); return st.all; };
  const posOf = n => (n.ext ? n : findDev(n.id) || n);
  function portPos(n, pid) { const s = specOf(n), p = portLayout(n, s).get(pid), q = posOf(n); return p ? { x: q.x + p.x, y: q.y + p.y } : { x: q.x + s.w / 2, y: q.y + s.h / 2 }; }
  function applyView() {
    world.setAttribute('transform', `translate(${-view.x * view.k} ${-view.y * view.k}) scale(${view.k})`);
    const v = host.querySelector('.ntView'), g = 20 * view.k;
    v.style.setProperty('--gk', g + 'px'); v.style.setProperty('--gx', (-view.x * view.k) % g + 'px'); v.style.setProperty('--gy', (-view.y * view.k) % g + 'px');
    if (nav) nav.update();
  }
  function render() {
    if (!on) return;
    const st = lan.state();
    host.querySelector('.ntEmpty').hidden = st.all.length > 0;
    counts();
    // Équipements.
    let h = '';
    for (const n of st.all) {
      const s = specOf(n), q = posOf(n), pw = st.power.get(n.id), off = pw && !pw.on;
      const f = st.ifaces.find(x => x.node === n.id && (x.role === 'host' || x.role === 'lan'));
      const isSel = sel && sel.kind === 'dev' && sel.id === n.id, isPing = pingFrom === n.id;
      h += `<g class="ntDev${isSel ? ' sel' : ''}${off ? ' off' : ''}${n.ext ? ' ext' : ''}${isPing ? ' pingFrom' : ''} r-${s.role}" data-id="${esc(n.id)}" transform="translate(${q.x} ${q.y})">`;
      h += `<rect class="ntBody" width="${s.w}" height="${s.h}" rx="8"/>`;
      // Icône, nom, puis l'adresse IP dans le corps de l'appareil (les ports sont sur ses bords).
      const ip = f && f.ip ? f.ip : '', small = s.h < 56 || s.role === 'switch' || s.role === 'passive';
      if (small) {
        h += icon(s.icon).replace('<svg class="ic"', `<svg class="ic ntIc" x="${10}" y="${s.h / 2 - 10}" width="20" height="20"`);
        h += `<text class="ntName left" x="${36}" y="${s.h / 2 + (ip ? 0 : 4)}">${esc(n.name || s.name())}</text>`;
        if (ip) h += `<text class="ntIp left${f.src === 'apipa' ? ' bad' : ''}" x="${36}" y="${s.h / 2 + 12}">${esc(ip)}</text>`;
      } else {
        h += icon(s.icon).replace('<svg class="ic"', `<svg class="ic ntIc" x="${s.w / 2 - 11}" y="5" width="22" height="22"`);
        h += `<text class="ntName" x="${s.w / 2}" y="${ip ? s.h - 21 : s.h - 14}">${esc(n.name || s.name())}</text>`;
        if (ip) h += `<text class="ntIp${f.src === 'apipa' ? ' bad' : ''}" x="${s.w / 2}" y="${s.h - 9}">${esc(ip)}</text>`;
      }
      if (off) h += `<text class="ntTag bad" x="${s.w / 2}" y="${-7}">${tl('éteint')}</text>`;
      else if (n.type === 'ap' || (n.type === 'router' && n.p.wifi && n.p.wifi.on)) h += `<text class="ntSsid" x="${s.w / 2}" y="${-7}">« ${esc(st.ssidOf(n))} »</text>`;
      for (const [pid, p] of portLayout(n, s)) {
        const l = lan.port(n.id, pid), port = portsOf(n).find(x => x.id === pid), cab = cableAt(n.id, pid);
        const poeOn = port.poe === 'pse' && st.poe.get(n.id) && st.poe.get(n.id).ports.some(x => x.port === pid && !x.denied);
        h += `<g class="ntPort${cab ? ' used' : ''}${port.punch ? ' punch' : ''}" data-port="${esc(pid)}" transform="translate(${p.x - PORT_W / 2} ${p.y - PORT_H / 2})"><title>${esc(port.label)}${l ? ' · ' + (l.up ? speedTxt(l.speed) : tl('pas de lien')) : ''}</title>`
          + `<rect width="${PORT_W}" height="${PORT_H}" rx="2"/>${port.passive ? '' : `<circle class="led ${ledCls(l)}" cx="${PORT_W / 2}" cy="${PORT_H / 2}" r="2.3"/>`}${poeOn ? `<rect class="poeMark" x="-1" y="-1" width="${PORT_W + 2}" height="${PORT_H + 2}" rx="3"/>` : ''}</g>`;
        if (pid === 'wan') h += `<text class="ntPl" x="${p.x}" y="${p.y + 16}">WAN</text>`;
      }
      h += '</g>';
    }
    gDev.innerHTML = h;
    // Câbles.
    let c = '';
    for (const cb of data.cables) {
      const A = nodeById(cb.a[0]), B = nodeById(cb.b[0]); if (!A || !B) continue;
      const pa = portPos(A, cb.a[1]), pb = portPos(B, cb.b[1]), r = analyzeCable(cb.wire);
      const bad = r.kind === 'none' ? 'raw' : r.faults.length ? 'bad' : '';
      // Courbe en S d'un port à l'autre ; deux ports à la même hauteur : un arc vers le bas.
      const my0 = (pa.y + pb.y) / 2, flat = Math.abs(pb.y - pa.y) < 30, bend = flat ? Math.max(40, Math.abs(pb.x - pa.x) / 3) : 0;
      const d = flat ? `M${pa.x} ${pa.y} C${pa.x} ${pa.y + bend} ${pb.x} ${pb.y + bend} ${pb.x} ${pb.y}` : `M${pa.x} ${pa.y} C${pa.x} ${my0} ${pb.x} ${my0} ${pb.x} ${pb.y}`;
      const sa = flat ? 1 : 0, sb = flat ? 1 : 0, dy = bend;
      const isSel = sel && sel.kind === 'cable' && sel.id === cb.id;
      c += `<g class="ntCab ${cb.cat} ${bad}${isSel ? ' sel' : ''}" data-cable="${esc(cb.id)}"><path class="hit" d="${d}"/><path class="line" d="${d}"/>`;
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 + (sa + sb) * dy * 0.375;
      c += `<text class="ntCabL" x="${mx}" y="${my}">${esc(String(cb.len).replace('.', isEn ? '.' : ','))} m${bad === 'raw' ? ' · ' + tl('à sertir') : bad ? ' · ' + tl('défaut') : ''}</text></g>`;
    }
    gCab.innerHTML = c;
    // Wi-Fi : un trait pointillé du point d'accès à chaque client.
    let w = '';
    for (const [nid, apId] of st.wifiAssoc) {
      const A = nodeById(apId), B = nodeById(nid); if (!A || !B) continue;
      const a = posOf(A), b = posOf(B), sa = specOf(A), sb = specOf(B);
      w += `<line class="ntAir" x1="${a.x + sa.w / 2}" y1="${a.y + sa.h / 2}" x2="${b.x + sb.w / 2}" y2="${b.y + sb.h / 2}"/>`;
    }
    gWifi.innerHTML = w;
    paintRubber();
  }
  const cableAt = (n, p) => data.cables.find(c => (c.a[0] === n && c.a[1] === p) || (c.b[0] === n && c.b[1] === p)) || null;

  /* ---------- Vue : zoom, déplacement, tout voir ---------- */
  const rectOf = () => svg.getBoundingClientRect();
  const toWorld = (cx, cy) => { const r = rectOf(); return { x: view.x + (cx - r.left) / view.k, y: view.y + (cy - r.top) / view.k }; };
  function zoomAt(f, x, y) {
    const r = rectOf(), px = x ?? r.width / 2, py = y ?? r.height / 2, wx = view.x + px / view.k, wy = view.y + py / view.k;
    view.k = Math.max(0.2, Math.min(4, view.k * f)); view.x = wx - px / view.k; view.y = wy - py / view.k; applyView();
  }
  function bounds(list) {
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { const s = specOf(n), q = posOf(n); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y - 20); x1 = Math.max(x1, q.x + s.w); y1 = Math.max(y1, q.y + s.h + 26); }
    return { x0, y0, x1, y1 };
  }
  function fitTo(b) {
    const r = rectOf(); if (!b || !r.width) return;
    const W = r.width - 56 - 40, Hh = r.height - 120;
    view.k = Math.max(0.2, Math.min(1.6, Math.min(W / (b.x1 - b.x0 || 1), Hh / (b.y1 - b.y0 || 1))));
    view.x = b.x0 - (W / view.k - (b.x1 - b.x0)) / 2 - 20 / view.k; view.y = b.y0 - (Hh / view.k - (b.y1 - b.y0)) / 2 - 60 / view.k;
    applyView();
  }
  const fit = () => fitTo(bounds(nodes()));
  const selNode = () => (sel && sel.kind === 'dev' ? nodeById(sel.id) : null);
  const nav = createNavDock(host, {
    active: () => on, target: () => svg, tools: () => ['select', 'pan', 'zoom'],
    zoomBy: (f, x, y) => zoomAt(f, x, y), panBy: (dx, dy) => { view.x -= dx / view.k; view.y -= dy / view.k; applyView(); },
    zoomPct: () => Math.round(view.k * 100), setZoomPct: p => { zoomAt(p / 100 / view.k); },
    fit, fitSel: () => { const n = selNode(); if (!n) return false; fitTo(bounds([n])); return true; }, hasSel: () => !!selNode(),
    zoomRect(r, sr) { const a = toWorld(r.left, r.top), b = toWorld(r.right, r.bottom); void sr; fitTo({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }); return true; },
    mini: { data: () => { const b = bounds(nodes()); if (!b) return null; const r = rectOf(); return { bounds: [b.x0, b.y0, b.x1, b.y1], boxes: nodes().map(n => { const q = posOf(n), s = specOf(n); return [q.x, q.y, s.w, s.h, sel && sel.id === n.id]; }), view: [view.x, view.y, view.x + r.width / view.k, view.y + r.height / view.k] }; }, centerOn: (x, y) => { const r = rectOf(); view.x = x - r.width / 2 / view.k; view.y = y - r.height / 2 / view.k; applyView(); } },
    status: m => app.status(m), title: tl('Plan réseau'),
    shortcuts: () => [['V', tl('Choisir et déplacer')], ['C', tl('Outil câble')], ['T', tl('Testeur de câble')], ['P', 'Ping'], ['Del', tl('Retirer la sélection')], ['Esc', tl('Annuler le geste en cours')]]
  });
  svg.addEventListener('wheel', e => { if (!on) return; e.preventDefault(); const r = rectOf(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  /* ---------- Gestes ---------- */
  let drag = null, rubber = null;
  function paintRubber() {
    gOver.innerHTML = '';
    if (!rubber) return;
    const n = nodeById(rubber.n); if (!n) return;
    const a = portPos(n, rubber.p);
    gOver.innerHTML = `<line class="ntRubber" x1="${a.x}" y1="${a.y}" x2="${rubber.x}" y2="${rubber.y}"/>`;
  }
  // Élément sous le pointeur (pendant une capture, e.target est le SVG : on regarde ce qui est vraiment dessous).
  const hitOf = e => {
    const t = (e.type === 'pointerup' || e.type === 'pointermove' ? document.elementFromPoint(e.clientX, e.clientY) : e.target) || e.target;
    const pt = t.closest ? t.closest('.ntPort') : null, dv = t.closest ? t.closest('.ntDev') : null, cb = t.closest ? t.closest('.ntCab') : null;
    return { port: pt && dv ? { n: dv.dataset.id, p: pt.dataset.port } : null, dev: dv ? dv.dataset.id : null, cable: cb ? cb.dataset.cable : null };
  };
  svg.addEventListener('pointerdown', e => {
    if (!on || e.button !== 0 || nav.tool() !== 'select') return;
    const h = hitOf(e), w = toWorld(e.clientX, e.clientY);
    if (tool === 'tester') { if (h.cable) testCable(h.cable); else if (h.port) testPort(h.port.n, h.port.p); return; }
    if (tool === 'ping') { if (h.dev) pingClick(h.dev); return; }
    if (h.port) {
      const c = cableAt(h.port.n, h.port.p);
      if (rubber) { finishRubber(h.port); return; }
      if (c && tool === 'select') { select({ kind: 'cable', id: c.id }); return; }
      if (c) { app.status(tl('Ce port a déjà un câble : retirez-le d’abord.'), 'warn'); return; }
      rubber = { n: h.port.n, p: h.port.p, x: w.x, y: w.y, drag: tool === 'select' }; paintRubber(); paintHint(); svg.setPointerCapture(e.pointerId); return;
    }
    if (rubber) { rubber = null; paintRubber(); paintHint(); return; }
    if (h.cable) { select({ kind: 'cable', id: h.cable }); return; }
    if (h.dev) {
      select({ kind: 'dev', id: h.dev });
      const n = nodeById(h.dev), q = posOf(n);
      drag = { id: h.dev, ox: w.x - q.x, oy: w.y - q.y, moved: false }; svg.setPointerCapture(e.pointerId); return;
    }
    select(null);
    drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', e => {
    if (!on) return;
    const w = toWorld(e.clientX, e.clientY);
    if (rubber) { rubber.x = w.x; rubber.y = w.y; paintRubber(); return; }
    if (!drag) return;
    if (drag.pan) { view.x = drag.vx - (e.clientX - drag.sx) / view.k; view.y = drag.vy - (e.clientY - drag.sy) / view.k; applyView(); return; }
    const x = snap(w.x - drag.ox), y = snap(w.y - drag.oy), n = nodeById(drag.id); if (!n) return;
    if (n.ext) { const k = n.id.slice(2); data.ext[k] = { x, y }; } else { const d = findDev(drag.id); d.x = x; d.y = y; }
    drag.moved = true; lan.refresh(); render();
  });
  svg.addEventListener('pointerup', e => {
    if (rubber && rubber.drag) { const h = hitOf(e); if (h.port && (h.port.n !== rubber.n || h.port.p !== rubber.p)) finishRubber(h.port); else if (!h.port) { rubber.drag = false; if (Math.hypot(rubber.x - portPos(nodeById(rubber.n), rubber.p).x, rubber.y - portPos(nodeById(rubber.n), rubber.p).y) > 12) { rubber = null; paintRubber(); } paintHint(); } return; }
    if (drag && drag.moved) commit();
    if (drag && drag.pan) svg.classList.remove('panning');
    drag = null;
  });
  function finishRubber(to) {
    const from = rubber; rubber = null; paintRubber(); paintHint();
    if (to.n === from.n && to.p === from.p) return;
    if (cableAt(to.n, to.p)) { app.status(tl('Ce port a déjà un câble.'), 'warn'); return; }
    const c = addCable([from.n, from.p], [to.n, to.p]);
    sel = { kind: 'cable', id: c.id }; commit();
    app.status(cableDef.kind === 'blank' ? tl('Câble posé, fiches à sertir : boutons « Sertir » dans l’inspecteur.') : tl('Câble posé : {0} m, {1}.', c.len, CATS[c.cat].name), 'ok');
  }
  function select(s) { sel = s; render(); renderPane(); if (on && s) app.setTab('nprop'); nav.update(); }

  /* ---------- Bibliothèque ---------- */
  const lib = document.createElement('aside');
  lib.className = 'panel left ntLib'; lib.setAttribute('aria-label', tl('Bibliothèque réseau'));
  lib.innerHTML = `<nav class="ntRail" aria-label="${tl('Équipements courants')}"><button type="button" class="tb" data-open data-tip="${tl('Déplier la bibliothèque · Ctrl+B')}">${icon('chevsRight')}</button></nav>
    <div class="phead"><h2>${icon('network')}${tl('Réseau')}</h2><span class="count">${Object.keys(DEVICES).length}</span><button type="button" class="tb" data-close data-tip="${tl('Replier · Ctrl+B')}" aria-label="${tl('Replier la bibliothèque')}">${icon('chevsLeft')}</button></div>
    <div class="search">${icon('search')}<input type="search" placeholder="${tl('Rechercher : switch, box, caméra…')}" autocomplete="off" aria-label="${tl('Rechercher un équipement')}"></div>
    <div class="libScroll ntLibList"></div>
    <div class="pfoot"><div class="row"><button type="button" class="btn subtle small" data-labs>${icon('checklist')}<span>${tl('TP de réseau')}</span></button></div></div>`;
  $('#libPanel').after(lib);
  const list = lib.querySelector('.ntLibList'), search = lib.querySelector('input');
  function renderLib() {
    const q = norm(search.value.trim()); let html = '';
    for (const [g, types] of LIB_GROUPS) {
      const items = types.filter(t => !q || norm(`${DEVICES[t].name()} ${t} ${DEVICES[t].doc()}`).includes(q));
      if (!items.length) continue;
      html += `<h3>${esc(g())}<span>${items.length}</span></h3><div class="ntGrid">${items.map(t => `<button type="button" class="ntItem" data-t="${t}" title="${esc(DEVICES[t].doc())}">${icon(DEVICES[t].icon)}<span>${esc(DEVICES[t].name())}</span></button>`).join('')}</div>`;
    }
    list.innerHTML = html || `<p class="empty">${tl('Aucun équipement ne correspond à cette recherche.')}</p>`;
  }
  renderLib(); search.oninput = renderLib;
  let ghost = null;
  lib.addEventListener('pointerdown', e => {
    const b = e.target.closest('.ntItem'); if (!b || e.button !== 0) return;
    e.preventDefault();
    const t = b.dataset.t, sx = e.clientX, sy = e.clientY; let moved = false;
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      if (!ghost) { ghost = document.createElement('div'); ghost.className = 'ntGhost'; ghost.innerHTML = icon(DEVICES[t].icon); document.body.appendChild(ghost); }
      ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
    };
    const up = ev => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true);
      if (ghost) { ghost.remove(); ghost = null; }
      const r = rectOf();
      if (!moved) { place(t, view.x + r.width / 2 / view.k - DEVICES[t].w / 2, view.y + r.height / 2 / view.k - DEVICES[t].h / 2); return; }
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { const w = toWorld(ev.clientX, ev.clientY); place(t, w.x - DEVICES[t].w / 2, w.y - DEVICES[t].h / 2); }
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  });
  lib.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) app.setLibOpen(false);
    if (e.target.closest('[data-open]')) app.setLibOpen(true);
    if (e.target.closest('[data-labs]') && app.openLabs) app.openLabs('net');
  });
  function place(type, x, y) {
    if (!on) setMode(true);
    // Place libre la plus proche (pas sur un autre appareil).
    const sp = DEVICES[type], boxes = nodes().map(m => { const q = posOf(m), t = specOf(m); return [q.x - 24, q.y - 30, q.x + t.w + 24, q.y + t.h + 30]; });
    const free = (px, py) => !boxes.some(([a, b, c2, d2]) => px < c2 && px + sp.w > a && py < d2 && py + sp.h > b);
    let fx = snap(x), fy = snap(y);
    outer: for (let r = 0; r < 30; r++) for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) { const tx = snap(x + dx * r * 40), ty = snap(y + dy * r * 40); if (free(tx, ty)) { fx = tx; fy = ty; break outer; } }
    const d = newDevice(type, new Set(data.devices.map(z => z.name)), { x: fx, y: fy }); d.id = freeId(type);
    data.devices.push(d); sel = { kind: 'dev', id: d.id }; commit();
    app.status(tl('{0} posé. Tirez un câble depuis un de ses ports.', DEVICES[type].name()), 'ok');
    return d;
  }

  /* ---------- Outils : testeur, ping, sertissage, navigateur ---------- */
  function segmentsOf(n, p) { const ch = lan.channel(n, p); return ch && ch.segs.length ? ch.segs : null; }
  function testCable(id) {
    const c = data.cables.find(x => x.id === id); if (!c) return;
    openTesterOn([{ ...c.wire }], { a: nameOf(c.a[0]), b: nameOf(c.b[0]) });
  }
  function testPort(n, p) {
    const segs = segmentsOf(n, p); if (!segs) { app.status(tl('Aucun câble sur ce port.'), 'warn'); return; }
    const ch = lan.channel(n, p);
    openTesterOn(segs, { a: nameOf(n), b: ch.far ? nameOf(ch.far.n) : '?' });
  }
  function openTesterOn(segments, names) {
    if (testerUi) testerUi.close();
    ui.tester = true;
    testerUi = openTester({ host, segments, names, mode: 'qualification', onClose: () => { testerUi = null; ui.tester = false; } });
    app.log(tl('Testeur · {0} ↔ {1} : {2}', names.a, names.b, testerSummary(segments)), 'info');
  }
  function crimp(id, side) {
    const c = data.cables.find(x => x.id === id); if (!c) return;
    if (crimpUi) crimpUi.close();
    ui.crimp = true;
    crimpUi = openCrimp({
      host, end: c.wire[side], side, title: tl('Fiche {0} du câble {1} ↔ {2}', side.toUpperCase(), nameOf(c.a[0]), nameOf(c.b[0])),
      onDone: end => { crimpUi = null; ui.crimp = false; c.wire[side] = { order: end.order.slice(), crimped: !!end.crimped, shorts: (end.shorts || []).slice() }; commit(); },
      onCancel: () => { crimpUi = null; ui.crimp = false; }
    });
  }
  function pingClick(id) {
    const n = nodeById(id); if (!n) return;
    if (!pingFrom) {
      if (specOf(n).role !== 'host' && n.type !== 'router') { app.status(tl('Un ping part d’un appareil qui a une adresse IP (PC, imprimante, carte…).'), 'warn'); return; }
      pingFrom = id; render(); paintHint(); return;
    }
    const from = pingFrom; pingFrom = null; paintHint();
    const f = lan.ipOf(id); doPing(from, f && f.ip ? f.ip : nameOf(id));
  }
  function doPing(from, target) {
    const r = lan.ping(from, target); ui.ping = true;
    const who = nameOf(from);
    if (r.ok) { app.log(tl('ping {0} depuis {1} : réponse en {2} ms', r.ip, who, r.ms ?? 0), 'ok'); toast(tl('Ping {0} → {1} : réponse en {2} ms', who, r.ip, r.ms ?? 0), 'ok'); animate(from, r); }
    else { app.log(tl('ping {0} depuis {1} : échec ({2})', r.ip || target, who, whyText(r.why)), 'err'); toast(tl('Ping {0} → {1} : échec, {2}', who, r.ip || target, whyText(r.why)), 'err', 6000); }
    pingOut = { from, target, r }; render(); renderPane();
    return r;
  }
  /** Un point suit le chemin du ping (appareils traversés). */
  function animate(from, r) {
    const pts = [], push = id => { const n = nodeById(id); if (!n) return; const q = posOf(n), s = specOf(n); pts.push([q.x + s.w / 2, q.y + s.h / 2]); };
    push(from);
    for (const h of r.hops || []) for (const step of h.path || []) push(step.to.slice(2));
    if (pts.length < 2) return;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '6'); dot.setAttribute('class', 'ntPkt'); gOver.appendChild(dot);
    const seg = 380, t0 = performance.now(), path = pts.concat(pts.slice(0, -1).reverse());
    const step = now => {
      const t = (now - t0) / seg, i = Math.floor(t);
      if (i >= path.length - 1 || !dot.isConnected) { dot.remove(); return; }
      const [ax, ay] = path[i], [bx, by] = path[i + 1], f = t - i;
      dot.setAttribute('cx', ax + (bx - ax) * f); dot.setAttribute('cy', ay + (by - ay) * f);
      dot.classList.toggle('back', i >= pts.length - 1);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  /** Navigateur du PC : une page à la fois, dans un cadre sans scripts (le HTML passe par cleanHtml). */
  function openBrowser(from, url) {
    if (!browser) {
      const el = document.createElement('div'); el.className = 'ntBrowser glass'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', tl('Navigateur'));
      el.innerHTML = `<div class="ntBrHead">${icon('globe')}<b></b><span class="grow"></span><button type="button" class="tb" data-br="close" aria-label="${tl('Fermer')}">${icon('x')}</button></div>
        <form class="ntBrUrl"><input class="inp" name="url" spellcheck="false" autocomplete="off" aria-label="${tl('Adresse')}"><button class="btn small primary">${tl('Aller')}</button></form>
        <iframe class="ntBrView" sandbox="" title="${tl('Page reçue')}"></iframe><p class="ntBrStatus"></p>`;
      host.appendChild(el);
      browser = { el, from, path: '' };
      el.querySelector('[data-br="close"]').onclick = () => { el.remove(); browser = null; ui.browser = false; };
      el.querySelector('form').onsubmit = ev => { ev.preventDefault(); go(el.querySelector('input').value); };
      el.querySelector('iframe').addEventListener('load', () => {
        let href = ''; try { href = el.querySelector('iframe').contentWindow.location.href; } catch (err) { return; }
        if (!/^about:blank/.test(href)) return;
        let u; try { u = new URL(href); } catch (err) { return; }
        if (u.hash.startsWith('#jollof:')) { let t = u.hash.slice(8); try { t = decodeURIComponent(t); } catch (err) { /* tel quel */ } go(t); return; }
        const q = [...new URLSearchParams(u.search)], pickQ = k => { const x = q.find(([nm]) => nm === k); return x ? x[1] : null; };
        const act = pickQ('__jollof_action'); if (act == null) return;
        const fields = q.filter(([k]) => !k.startsWith('__jollof_')).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        if (pickQ('__jollof_method') === 'POST') go(act || browser.path, { method: 'POST', body: fields }); else go((act || browser.path.split('?')[0]) + (fields ? '?' + fields : ''));
      });
    }
    ui.browser = true;
    browser.from = from; browser.el.querySelector('.ntBrHead b').textContent = tl('Navigateur de {0}', nameOf(from));
    const go = async (target, o = {}, hops = 0) => {
      const b = browser; if (!b) return;
      let u; try { u = new URL(String(target || '/').trim(), b.base || 'http://192.168.1.1/'); } catch (err) { b.el.querySelector('.ntBrStatus').textContent = tl('Adresse invalide'); return; }
      if (u.protocol !== 'http:') { b.el.querySelector('.ntBrStatus').textContent = tl('Seules les adresses http:// du réseau simulé répondent.'); return; }
      b.base = u.origin + '/'; b.path = u.pathname + u.search;
      b.el.querySelector('input').value = u.href;
      b.el.querySelector('.ntBrStatus').textContent = tl('Chargement…');
      const r = await lan.http(b.from, u.href, o);
      if (r.code >= 300 && r.code < 400 && hops < 3) { const loc = /\r\nlocation:\s*([^\r\n]+)/i.exec('\r\n' + (r.raw || '').split('\r\n\r\n')[0]); if (loc) { go(loc[1], {}, hops + 1); return; } }
      const fr = b.el.querySelector('iframe');
      if (!r.code) { fr.srcdoc = ''; b.el.querySelector('.ntBrStatus').textContent = tl('Échec : {0}', whyText(r.why)); app.log(tl('navigateur de {0} : {1} injoignable ({2})', nameOf(b.from), u.host, whyText(r.why)), 'err'); return; }
      fr.srcdoc = /html/i.test(r.type) ? routed(cleanHtml(r.body)) : `<pre style="white-space:pre-wrap;font:12px ui-monospace,monospace;margin:8px">${esc(r.body)}</pre>`;
      b.el.querySelector('.ntBrStatus').textContent = tl('{0} · {1} · {2} octets', r.code, r.type, new TextEncoder().encode(r.body).length);
      app.log(tl('navigateur de {0} : {1} → {2}', nameOf(b.from), u.href, r.code), 'ok');
    };
    browser.go = go;
    if (url) go(url);
  }
  function routed(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const a of doc.querySelectorAll('a[href]')) { const h = a.getAttribute('href'); a.removeAttribute('target'); if (!h.startsWith('#')) a.setAttribute('href', 'about:blank#jollof:' + encodeURIComponent(h)); }
    for (const f of doc.querySelectorAll('form')) {
      const add = (n, v) => { const i = doc.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
      add('__jollof_action', f.getAttribute('action') || ''); add('__jollof_method', /^post$/i.test(f.getAttribute('method') || '') ? 'POST' : 'GET');
      f.setAttribute('action', 'about:blank'); f.setAttribute('method', 'get'); f.removeAttribute('target');
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }

  /* ---------- Inspecteur ---------- */
  const tabs = $('.panel.right .tabs');
  tabs.insertAdjacentHTML('beforeend', `<button type="button" role="tab" class="tab ntTab" id="tab-nprop" aria-controls="pane-nprop" aria-selected="false">${icon('network')}${tl('Réseau')}</button>`);
  const pane = document.createElement('div'); pane.className = 'pane ntPane'; pane.id = 'pane-nprop'; pane.setAttribute('role', 'tabpanel'); pane.hidden = true;
  $('#modPane').before(pane);
  $('#tab-nprop').onclick = () => { app.setTab('nprop'); renderPane(); };
  let paneT = 0;
  const renderPaneSoon = () => { clearTimeout(paneT); paneT = setTimeout(renderPane, 120); };
  const field = (label, html, tip = '') => `<label class="ntF"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${label}</span>${html}</label>`;
  const inp = (k, v, o = '') => `<input class="inp" data-k="${k}" value="${esc(v ?? '')}" ${o}>`;
  const chk = (k, v, label) => `<label class="ntChk"><input type="checkbox" data-k="${k}"${v ? ' checked' : ''}><span>${label}</span></label>`;
  function portRows(n) {
    return portsOf(n).filter(p => !p.punch || cableAt(n.id, p.id)).map(p => {
      const l = lan.port(n.id, p.id), c = cableAt(n.id, p.id);
      const peer = l && l.peer ? nameOf(l.peer.n) : c ? (lan.channel(n.id, p.id) && lan.channel(n.id, p.id).far ? nameOf(lan.channel(n.id, p.id).far.n) : '—') : '';
      const st = !c ? `<span class="mut">${tl('libre')}</span>` : !l ? '' : l.up ? `<b class="ok">${speedTxt(l.speed)}</b>${l.mdix ? ' · Auto-MDIX' : ''}${l.errors ? ` · <b class="bad">${tl('erreurs')}</b>` : ''}${l.notes.includes('downshift') ? ' · ' + tl('rétrogradé') : ''}` : `<b class="bad">${tl('pas de lien')}</b> <small>${esc(whyText(l.why))}</small>`;
      return `<tr><td><i class="led ${ledCls(l)}"></i>${esc(p.label)}</td><td>${esc(peer)}</td><td>${st}</td></tr>`;
    }).join('');
  }
  function renderPane() {
    if (!on && pane.hidden) return;
    const st = lan.state(); let h = '';
    const n = selNode(), c = sel && sel.kind === 'cable' ? data.cables.find(x => x.id === sel.id) : null;
    if (n) {
      const s = specOf(n), P = n.p || {}, f = st.ifaces.find(x => x.node === n.id && (x.role === 'host' || x.role === 'lan')), pw = st.power.get(n.id);
      h += `<div class="ntHead">${icon(s.icon)}<div><b>${esc(n.name || s.name())}</b><small>${esc(s.name())}</small></div>${n.ext ? '' : `<button type="button" class="tb" data-a="del" data-tip="${tl('Retirer cet équipement')}" aria-label="${tl('Retirer')}">${icon('trash')}</button>`}</div>`;
      h += `<p class="ntDoc">${esc(n.ext ? (n.type === 'wifi' ? tl('Carte du montage : elle rejoint un point d’accès par son programme (WiFi.begin).') : tl('Module Ethernet du montage : son adresse vient du programme de la carte (Ethernet.begin).')) : s.doc())}</p>`;
      if (!n.ext) h += `<section class="ntSec">${field(tl('Nom'), inp('name', n.name, 'maxlength="24"'))}</section>`;
      if (pw && !pw.on) h += `<p class="ntWarn">${icon('alert')}${tl('Éteint : {0}', whyText(pw.why))}</p>`;
      else if (pw && pw.w) h += `<p class="ntOk">${icon('zap')}${tl('Alimenté par PoE : classe {0}, {1} W réservés sur le switch.', pw.cls, pw.w)}</p>`;
      const rows = portRows(n);
      if (rows) h += `<section class="ntSec"><h4>${tl('Ports')}</h4><table class="ntTable"><tr><th>${tl('Port')}</th><th>${tl('Relié à')}</th><th>${tl('État')}</th></tr>${rows}</table></section>`;
      if (s.role === 'host') {
        h += `<section class="ntSec"><h4>${tl('Adresse IP')}</h4>`;
        if (f && f.ip) h += `<p class="ntIpNow"><b>${esc(f.ip)}</b>/${f.prefix} <small>(${esc(maskStr(f.prefix))})</small>${f.gw ? ` · ${tl('passerelle')} ${esc(f.gw)}` : ''} · <small>${esc({ dhcp: tl('donnée par DHCP'), static: tl('fixe'), apipa: tl('aucun serveur DHCP'), program: tl('fixée par le programme') }[f.src] || '')}</small></p>`;
        else h += `<p class="mut">${tl('Pas encore d’adresse.')}</p>`;
        if (!n.ext && P.ip) {
          h += `<div class="seg ntMode" role="group"><button type="button" class="segBtn" data-ipmode="dhcp" aria-pressed="${P.ip.mode !== 'static'}">DHCP</button><button type="button" class="segBtn" data-ipmode="static" aria-pressed="${P.ip.mode === 'static'}">${tl('Adresse fixe')}</button></div>`;
          if (P.ip.mode === 'static') h += field(tl('Adresse'), inp('ip.ip', P.ip.ip, 'placeholder="192.168.1.20" spellcheck="false"')) + field(tl('Masque'), inp('ip.prefix', '/' + P.ip.prefix, 'placeholder="/24 ou 255.255.255.0" spellcheck="false"')) + field(tl('Passerelle'), inp('ip.gw', P.ip.gw, 'placeholder="192.168.1.1" spellcheck="false"'));
        }
        h += '</section>';
        if ('legacy' in P) h += `<section class="ntSec">${chk('legacy', P.legacy, tl('Appareil ancien : 100 Mb/s, sans Auto-MDIX'))}</section>`;
        if (n.type === 'laptop') h += `<section class="ntSec"><h4>Wi-Fi</h4>${field(tl('Réseau (SSID)'), inp('wifi.ssid', P.wifi.ssid, 'maxlength="32"'))}${field(tl('Mot de passe'), inp('wifi.pass', P.wifi.pass, 'maxlength="63"'))}${st.wifiAssoc.get(n.id) ? `<p class="ntOk">${tl('Connecté à {0}', nameOf(st.wifiAssoc.get(n.id)))}</p>` : st.wifiWhy.get(n.id) ? `<p class="ntWarn">${esc(whyText('wifi:' + st.wifiWhy.get(n.id)))}</p>` : ''}</section>`;
        if ('poeClass' in P) h += `<section class="ntSec"><h4>PoE</h4>${field(tl('Classe PoE'), `<select class="sel" data-k="poeClass">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}"${k === P.poeClass ? ' selected' : ''}>${k}</option>`).join('')}</select>`)}${chk('adapter', P.power === 'adapter', tl('Alimenté par son propre bloc secteur'))}</section>`;
        // Ping et navigateur.
        h += `<section class="ntSec"><h4>Ping</h4><form class="ntPing" data-form="ping"><input class="inp" name="t" placeholder="${tl('adresse ou nom (ex. 192.168.1.1, PC2)')}" spellcheck="false" value="${esc(pingOut && pingOut.from === n.id ? pingOut.target : '')}"><button class="btn small primary" data-nt="ping">${icon('ping')}<span>Ping</span></button></form>`;
        if (pingOut && pingOut.from === n.id) { const r = pingOut.r; h += `<pre class="ntPingOut ${r.ok ? 'ok' : 'bad'}">${esc(pingText(r, pingOut.target))}</pre>`; }
        h += '</section>';
        if (n.type === 'pc' || n.type === 'laptop') h += `<section class="ntSec"><button type="button" class="btn small" data-nt="browser">${icon('globe')}<span>${tl('Ouvrir le navigateur')}</span></button></section>`;
      }
      if (n.type === 'router') {
        h += `<section class="ntSec"><h4>${tl('Réseau local (LAN)')}</h4>${field(tl('Adresse de la box'), inp('lan.ip', P.lan.ip, 'spellcheck="false"'))}${field(tl('Masque'), inp('lan.prefix', '/' + P.lan.prefix, 'spellcheck="false"'))}</section>`;
        h += `<section class="ntSec"><h4>DHCP</h4>${chk('dhcp.on', P.dhcp.on, tl('Serveur DHCP actif'))}${field(tl('Première adresse (.x)'), inp('dhcp.from', P.dhcp.from, 'type="number" min="1" max="254"'))}${field(tl('Dernière adresse (.x)'), inp('dhcp.to', P.dhcp.to, 'type="number" min="1" max="254"'))}`;
        const leases = st.ifaces.filter(x => x.server === n.id);
        h += leases.length ? `<table class="ntTable"><tr><th>${tl('Appareil')}</th><th>IP</th></tr>${leases.map(x => `<tr><td>${esc(nameOf(x.node))}</td><td>${esc(x.ip)}</td></tr>`).join('')}</table>` : `<p class="mut">${tl('Aucun bail pour l’instant.')}</p>`;
        h += `</section><section class="ntSec"><h4>WAN</h4><div class="seg ntMode" role="group">${['none', 'dhcp', 'static'].map(m => `<button type="button" class="segBtn" data-wanmode="${m}" aria-pressed="${P.wan.mode === m}">${{ none: tl('Aucun'), dhcp: 'DHCP', static: tl('Fixe') }[m]}</button>`).join('')}</div>`;
        if (P.wan.mode === 'static') h += field(tl('Adresse'), inp('wan.ip', P.wan.ip, 'spellcheck="false"')) + field(tl('Masque'), inp('wan.prefix', '/' + P.wan.prefix, 'spellcheck="false"')) + field(tl('Passerelle'), inp('wan.gw', P.wan.gw, 'spellcheck="false"'));
        const wf = st.ifaces.find(x => x.node === n.id && x.role === 'wan'); if (wf) h += `<p class="ntIpNow">WAN : <b>${esc(wf.ip)}</b>/${wf.prefix}</p>`;
        h += `</section><section class="ntSec"><h4>Wi-Fi</h4>${chk('wifi.on', P.wifi.on, tl('Wi-Fi de la box actif'))}${P.wifi.on ? field(tl('Nom (SSID)'), inp('wifi.ssid', P.wifi.ssid, 'maxlength="32"')) + field(tl('Mot de passe'), inp('wifi.pass', P.wifi.pass, 'maxlength="63"')) : ''}</section>`;
      }
      if (n.type === 'ap') h += `<section class="ntSec"><h4>Wi-Fi</h4>${field(tl('Nom (SSID)'), inp('ssid', P.ssid, 'maxlength="32"'))}${field(tl('Mot de passe'), inp('pass', P.pass, 'maxlength="63"'))}${chk('adapter', P.power === 'adapter', tl('Alimenté par son propre bloc secteur'))}<p class="mut">${tl('{0} appareil(s) connecté(s)', [...st.wifiAssoc.values()].filter(x => x === n.id).length)}</p></section>`;
      if (n.type === 'poeswitch') { const pi = st.poe.get(n.id) || { used: 0, budget: P.budget }; h += `<section class="ntSec"><h4>${tl('Budget PoE')}</h4><div class="ntGauge"><i style="width:${Math.min(100, (pi.used / (pi.budget || 1)) * 100)}%"></i></div><p>${tl('{0} W réservés sur {1} W', Math.round(pi.used * 100) / 100, pi.budget)}</p>${field(tl('Budget total (W)'), inp('budget', P.budget, 'type="number" min="0" max="2000"'))}${field(tl('Norme des ports'), `<select class="sel" data-k="pseType">${[['af', '802.3af (15,4 W)'], ['at', '802.3at (30 W)'], ['bt3', '802.3bt type 3 (60 W)'], ['bt4', '802.3bt type 4 (90 W)']].map(([k, l]) => `<option value="${k}"${P.pseType === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}</section>`; }
      if (s.role === 'switch') {
        const mt = lan.macTable(n.id);
        h += `<section class="ntSec"><h4>${tl('Table des adresses MAC')}</h4>${mt.length ? `<table class="ntTable mono"><tr><th>MAC</th><th>${tl('Port')}</th><th>${tl('Appareil')}</th></tr>${mt.map(m => `<tr><td>${esc(m.mac)}</td><td>${esc(m.port)}</td><td>${esc(m.node ? nameOf(m.node) : '?')}</td></tr>`).join('')}</table><button type="button" class="btn small subtle" data-a="clearmac">${tl('Vider la table')}</button>` : `<p class="mut">${tl('Vide : le switch apprend une adresse quand une trame arrive sur un port (faites un ping).')}</p>`}</section>`;
      }
      if (n.type === 'broker') {
        const b = lan.broker(n.id);
        const tp = b ? b.topics() : [], cl = b ? b.clients() : [];
        h += `<section class="ntSec"><h4>${tl('Sujets MQTT')}</h4>${tp.length ? `<table class="ntTable"><tr><th>${tl('Sujet')}</th><th>${tl('Dernier message')}</th><th>${tl('De')}</th></tr>${tp.map(t => `<tr><td class="mono">${esc(t.topic)}</td><td><b>${esc(String(t.text).slice(0, 60))}</b></td><td><small>${esc(t.from)}</small></td></tr>`).join('')}</table>` : `<p class="mut">${tl('Aucun message pour l’instant.')}</p>`}
          <form class="ntPub" data-form="pub"><input class="inp" name="topic" placeholder="${tl('sujet, ex. atelier/led')}" spellcheck="false"><input class="inp" name="msg" placeholder="${tl('message, ex. ON')}"><button class="btn small primary">${icon('send')}<span>${tl('Publier')}</span></button></form>
          <p class="mut">${tl('Clients connectés : {0}', cl.length ? cl.map(x => `${x.id}${x.subs.length ? ' (' + x.subs.join(', ') + ')' : ''}`).join(' · ') : tl('aucun'))}</p></section>`;
      }
      if (n.type === 'plc') {
        const bk = lan.bank(n.id);
        const row = (t, label, bit) => `<tr><th>${label}</th>${Array.from({ length: 8 }, (_, i) => { const v = bk ? bk.read(t, i) : 0; return `<td>${bit ? `<button type="button" class="ntBit${v ? ' on' : ''}" data-reg="${t}:${i}" aria-pressed="${!!v}">${i}</button>` : `<input class="inp ntReg" data-reg="${t}:${i}" type="number" min="0" max="65535" value="${v}">`}</td>`; }).join('')}</tr>`;
        h += `<section class="ntSec"><h4>${tl('Registres Modbus (port 502)')}</h4><table class="ntTable ntRegs">${row('coils', tl('Bobines'), true)}${row('di', tl('Entrées'), true)}${row('hr', tl('Registres'), false)}${row('ir', tl('Reg. entrée'), false)}</table><p class="mut">${tl('Les bobines et les registres de maintien s’écrivent ici ou par un client Modbus TCP.')}</p></section>`;
      }
    } else if (c) {
      const r = analyzeCable(c.wire), A = nodeById(c.a[0]), B = nodeById(c.b[0]);
      const v = e => { const x = crimpVerdict(e.order, false); return e.crimped ? x.head : tl('non sertie'); };
      h += `<div class="ntHead">${icon('cable')}<div><b>${tl('Câble {0} ↔ {1}', esc(A ? nameOf(A.id) : '?'), esc(B ? nameOf(B.id) : '?'))}</b><small>${esc(CATS[c.cat].name)} · ${c.len} m</small></div><button type="button" class="tb" data-a="delcable" data-tip="${tl('Retirer ce câble')}" aria-label="${tl('Retirer')}">${icon('trash')}</button></div>`;
      h += `<div class="ntCableArt">${cableSvg(c.wire)}</div>`;
      h += `<p class="${r.faults.length || r.kind === 'none' ? 'ntWarn' : 'ntOk'}">${esc(testerSummary([c.wire]))}</p>`;
      h += `<section class="ntSec"><div class="ntEnds"><div><b>${tl('Fiche A')}</b> <small>${esc(A ? nameOf(A.id) : '')}</small><span>${esc(v(c.wire.a))}</span><button type="button" class="btn small" data-nt="crimpA">${icon('rj45')}<span>${tl('Sertir')}</span></button></div>
        <div><b>${tl('Fiche B')}</b> <small>${esc(B ? nameOf(B.id) : '')}</small><span>${esc(v(c.wire.b))}</span><button type="button" class="btn small" data-nt="crimpB">${icon('rj45')}<span>${tl('Sertir')}</span></button></div></div>
        <button type="button" class="btn small primary" data-nt="test">${icon('cableTester')}<span>${tl('Passer au testeur')}</span></button></section>`;
      h += `<section class="ntSec">${field(tl('Catégorie'), `<select class="sel" data-ck="cat">${CAT_IDS.map(k => `<option value="${k}"${k === c.cat ? ' selected' : ''}>${CATS[k].name} (${CATS[k].mhz} MHz)</option>`).join('')}</select>`)}${field(tl('Longueur (m)'), `<input class="inp" data-ck="len" type="number" min="0.1" max="500" step="0.5" value="${c.len}">`)}</section>`;
      h += `<section class="ntSec"><h4>${tl('Remplacer')}</h4><div class="row"><button type="button" class="btn small subtle" data-a="renew" data-v="straight">${tl('Câble droit neuf')}</button><button type="button" class="btn small subtle" data-a="renew" data-v="crossover">${tl('Câble croisé neuf')}</button><button type="button" class="btn small subtle" data-a="renew" data-v="blank">${tl('À sertir')}</button></div>
        <details class="ntFault"><summary>${tl('Défaut à cacher (enseignant)')}</summary><p class="mut">${tl('Coupe un conducteur à l’intérieur du câble : le testeur le montrera ouvert.')}</p><div class="row">${['wo', 'o', 'wg', 'bl', 'wbl', 'g', 'wbr', 'br'].map(w => `<label class="ntChk"><input type="checkbox" data-cut="${w}"${c.wire.cut.includes(w) ? ' checked' : ''}><span>${esc(tl({ wo: 'blanc-orange', o: 'orange', wg: 'blanc-vert', bl: 'bleu', wbl: 'blanc-bleu', g: 'vert', wbr: 'blanc-marron', br: 'marron' }[w]))}</span></label>`).join('')}</div></details></section>`;
    } else {
      const iss = netIssues(lan, data);
      h += `<div class="ntHead">${icon('network')}<div><b>${tl('Plan réseau')}</b><small>${tl('{0} équipement(s), {1} câble(s)', data.devices.length, data.cables.length)}</small></div></div>`;
      h += `<p class="ntDoc">${tl('Cliquez un équipement ou un câble pour voir ses réglages. Les fautes du plan sont dans le panneau Problèmes (Ctrl+Maj+M).')}</p>`;
      h += iss.length ? `<section class="ntSec"><h4>${tl('À corriger')}</h4><ul class="ntIss">${iss.slice(0, 12).map((i, k) => `<li class="${i.kind}" data-iss="${k}"><code>${i.code}</code> ${esc(i.text)}</li>`).join('')}</ul></section>` : `<p class="ntOk">${icon('check')}${tl('Aucune faute dans le plan réseau.')}</p>`;
      const ev = lan.events().slice(-8).reverse();
      if (ev.length) h += `<section class="ntSec"><h4>${tl('Derniers échanges')}</h4><ul class="ntEv">${ev.map(e => `<li>${esc(eventText(e))}</li>`).join('')}</ul></section>`;
    }
    pane.innerHTML = h;
  }
  const pingText = (r, target) => r.ok
    ? [1, 2, 3, 4].map(i => tl('Réponse de {0} : temps={1} ms', r.ip, Math.max(1, (r.ms || 1) + (i % 2)))).join('\n') + '\n' + tl('4 envoyés, 4 reçus, 0 % de perte')
    : tl('Ping {0} : échec.', r.ip || target) + '\n' + whyText(r.why);
  const eventText = e => (e.t === 'ping' ? tl('Ping {0} → {1} : {2}', nameOf(e.from), e.ip, e.ok ? 'OK' : whyText(e.why)) : e.t === 'dhcp' ? tl('DHCP : {0} reçoit {1}', nameOf(e.to), e.ip) : e.t === 'mqtt' ? `MQTT ${e.kind} ${e.client || ''} ${e.topic || ''} ${e.text || ''}` : e.t === 'tcp' ? tl('TCP {0} → {1}:{2} {3}', nameOf(e.from), nameOf(e.to), e.port, e.ok ? 'OK' : tl('refusé')) : e.t === 'modbus' ? tl('Modbus : fonction {0}, adresse {1}', e.fn, e.addr) : e.t === 'dns' ? `DNS ${e.name || ''}` : e.t);
  /* Réglages : chaque champ écrit dans les propriétés de l'équipement choisi. */
  const setPath = (o, path, v) => { const ks = path.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] || (x[k] = {}); x[ks[ks.length - 1]] = v; };
  pane.addEventListener('change', e => {
    const t = e.target, n = sel && sel.kind === 'dev' ? findDev(sel.id) : null;
    if (t.dataset.ck && sel && sel.kind === 'cable') {
      const c = data.cables.find(x => x.id === sel.id);
      if (t.dataset.ck === 'cat' && CATS[t.value]) c.cat = t.value;
      if (t.dataset.ck === 'len') c.len = Math.max(0.1, Math.min(500, +t.value || c.len));
      commit(); return;
    }
    if (t.dataset.cut && sel && sel.kind === 'cable') {
      const c = data.cables.find(x => x.id === sel.id); const s = new Set(c.wire.cut); if (t.checked) s.add(t.dataset.cut); else s.delete(t.dataset.cut); c.wire.cut = [...s]; commit(); return;
    }
    if (t.dataset.reg) {
      const [tab, a] = t.dataset.reg.split(':'), bk = lan.bank(sel.id); if (bk) { const d = findDev(sel.id); const r = d.p.regs; if (r[tab]) r[tab][+a] = Math.max(0, Math.min(65535, +t.value | 0)); commit(); }
      return;
    }
    if (!n || !t.dataset.k) return;
    const k = t.dataset.k;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'adapter') { n.p.power = v ? 'adapter' : 'poe'; commit(); return; }
    if (k === 'name') { n.name = cleanText(String(v), 24) || n.name; commit(); return; }
    if (/(^|\.)prefix$/.test(k)) { const p = prefixOf(v); if (p == null) { app.status(tl('Masque invalide : écrivez /24 ou 255.255.255.0.'), 'warn'); renderPane(); return; } v = p; }
    else if (/(^|\.)(ip|gw)$/.test(k) && v && !isIp(v)) { app.status(tl('Adresse invalide : quatre nombres de 0 à 255 séparés par des points.'), 'warn'); renderPane(); return; }
    else if (/^dhcp\.(from|to)$/.test(k) || k === 'budget' || k === 'poeClass') v = Math.max(0, +v || 0);
    else if (typeof v === 'string') v = cleanText(v, 63);
    setPath(n.p, k, v); commit();
  });
  pane.addEventListener('click', async e => {
    const b = e.target.closest('[data-nt],[data-a],[data-ipmode],[data-wanmode],[data-reg],[data-iss]'); if (!b) return;
    const n = sel && sel.kind === 'dev' ? findDev(sel.id) : null;
    if (b.dataset.ipmode && n) { n.p.ip.mode = b.dataset.ipmode; if (n.p.ip.mode === 'static' && !n.p.ip.ip) { const f = lan.ipOf(n.id); if (f && f.ip && f.src === 'dhcp') Object.assign(n.p.ip, { ip: f.ip, prefix: f.prefix, gw: f.gw }); } commit(); return; }
    if (b.dataset.wanmode && n) { n.p.wan.mode = b.dataset.wanmode; commit(); return; }
    if (b.dataset.reg && b.classList.contains('ntBit')) { const [tab, a] = b.dataset.reg.split(':'), d = findDev(sel.id); d.p.regs[tab][+a] = d.p.regs[tab][+a] ? 0 : 1; commit(); return; }
    if (b.dataset.iss != null) { const i = netIssues(lan, data)[+b.dataset.iss]; if (i && i.id) reveal(i.id); return; }
    const a = b.dataset.nt || b.dataset.a;
    if (a === 'crimpA') crimp(sel.id, 'a'); else if (a === 'crimpB') crimp(sel.id, 'b'); else if (a === 'test') testCable(sel.id);
    else if (a === 'browser') { const gw = lan.ipOf(sel.id); openBrowser(sel.id, gw && gw.gw ? `http://${gw.gw}/` : ''); }
    else if (a === 'del') removeSel();
    else if (a === 'delcable') removeSel();
    else if (a === 'clearmac') { lan.clearMac(sel.id); renderPane(); }
    else if (a === 'renew') { const c = data.cables.find(x => x.id === sel.id); c.wire = makeCable(b.dataset.v); commit(); }
  });
  pane.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'ping') { const t = f.elements.t.value.trim(); if (t) doPing(sel.id, t); }
    if (f.dataset.form === 'pub') { const b = lan.broker(sel.id), t = f.elements.topic.value.trim(); if (b && t) { b.publish(t, f.elements.msg.value); renderPane(); } }
  });
  async function removeSel() {
    if (!sel) return;
    if (sel.kind === 'cable') { data.cables = data.cables.filter(c => c.id !== sel.id); sel = null; commit(); return; }
    const d = findDev(sel.id); if (!d) return;
    data.devices = data.devices.filter(x => x !== d); data.cables = data.cables.filter(c => c.a[0] !== d.id && c.b[0] !== d.id);
    sel = null; commit();
  }

  /* ---------- Mode ---------- */
  let countsBefore = '', hintBefore = '';
  function counts() { if (!on) return; $('#counts').textContent = tl('{0} équipement(s) · {1} câble(s)', lan.state().all.length, data.cables.length); }
  const paintSwitch = () => document.querySelectorAll('.wsSwitch [data-ws]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ws === (on ? 'net' : app.pneu && app.pneu.isOn() ? 'pneu' : app.logic && app.logic.isOn() ? 'logic' : 'elec'))));
  function setMode(v) {
    v = !!v; if (v === on) { paintSwitch(); return; }
    on = v; data.view = on ? 'net' : 'elec';
    appEl.classList.toggle('netMode', on); document.body.classList.toggle('netOpen', on);
    host.hidden = !on; paintSwitch();
    if (on) {
      if (app.simOn() && app.kind() === 'net') app.setSim(false);
      app.history(history);
      countsBefore = $('#counts').textContent; hintBefore = $('#hint').textContent; counts();
      $('#hint').textContent = tl('Port → port : tirer un câble · clic : réglages · Molette : zoom · Espace + glisser : se déplacer · ? : raccourcis');
      app.setTab('nprop'); lan.refresh(); render(); renderPane();
      if (!fitted) { fitted = true; requestAnimationFrame(() => { fit(); render(); }); }
      setTool(tool);
    } else {
      app.history(null);
      if (countsBefore) $('#counts').textContent = countsBefore;
      $('#hint').textContent = hintBefore;
      if ($('#tab-nprop').getAttribute('aria-selected') === 'true') app.setTab('wiring');
      for (const x of [crimpUi, testerUi]) if (x) x.close();
      app.invalidate(400);
    }
    if (on && app.ensureSpace) app.ensureSpace('net');
  }

  /* ---------- Clavier ---------- */
  const busyUi = () => document.querySelector('.sDialogWrap, .sMenu, .nt-ov') || [...document.querySelectorAll('.modal')].some(m => !m.hidden);
  addEventListener('keydown', e => {
    if (!on || busyUi()) return;
    const a = document.activeElement;
    if (a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod) return; // enregistrer, ouvrir, annuler, bibliothèque : l'application
    if (nav.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    let done = true;
    if (k === 'escape') { if (rubber) { rubber = null; paintRubber(); } else if (pingFrom) { pingFrom = null; render(); } else if (tool !== 'select') setTool('select'); else select(null); paintHint(); }
    else if (k === 'delete' || k === 'backspace') removeSel();
    else if (k === 'v') setTool('select'); else if (k === 'c') setTool('cable'); else if (k === 't') setTool('tester'); else if (k === 'p') setTool('ping');
    else done = false;
    if (done) e.preventDefault();
    e.stopImmediatePropagation(); // pas de raccourcis de la scène 3D ici
  }, true);
  addEventListener('keyup', e => nav.key(e), true);

  /* ---------- Montage changé (projet Objets connectés) ---------- */
  if (app.onChange) app.onChange(() => { lan.refresh(); if (on) { render(); renderPaneSoon(); } });
  // Programmes en marche : adresses et messages qui changent, panneaux à jour quelques fois par seconde.
  setInterval(() => {
    if (!on || document.hidden) return;
    // Un autre panneau de l'inspecteur ouvert d'ailleurs (simulation lancée) : en mode Réseau, seul le sien se montre.
    const cur = document.querySelector('.panel.right .tabs .tab[aria-selected="true"]');
    if (!cur || (!cur.classList.contains('ntTab') && !cur.classList.contains('sessTab'))) { app.setTab('nprop'); renderPane(); }
    const v = lan.version; lan.state(); if (lan.version !== v) render(); if (selNode() && (selNode().type === 'broker' || selNode().ext)) renderPane(); }, 700);

  /** Montre l'équipement ou le câble en cause (panneau Problèmes, rapport). */
  function reveal(id) {
    if (!on) setMode(true);
    if (!id) return;
    if (data.cables.some(c => c.id === id)) select({ kind: 'cable', id });
    else if (nodeById(id)) { select({ kind: 'dev', id }); fitTo(bounds([nodeById(id)])); }
  }
  const srcNote = code => (NET_SRC[code] || []).map(k => SOURCES[k] && SOURCES[k].publisher ? `${SOURCES[k].title} (${SOURCES[k].publisher})` : k).slice(0, 2).join(' ; ');

  return {
    isOn: () => on, setMode, lan: () => lan, data: () => data, reveal,
    load(d) {
      data = cleanNet(d); sel = null; pingOut = null; fitted = false; H.undo = []; H.redo = []; snapshot = JSON.stringify(data);
      lan.reset(); lan.refresh();
      for (const x of [crimpUi, testerUi]) if (x) x.close();
      if (browser) { browser.el.remove(); browser = null; }
      Object.assign(ui, { tester: false, crimp: false, browser: false, ping: false });
      if (!d) { if (on && app.comps().length) setMode(false); render(); renderPane(); return; }
      setMode(data.view === 'net' || (!spacesOf(app.kind()).includes('elec') && spacesOf(app.kind()).includes('net')));
      if (on) { fitted = true; requestAnimationFrame(() => { fit(); render(); }); }
      render(); renderPane(); counts();
    },
    save() {
      if (!data.devices.length && !data.cables.length && !on) return undefined;
      return JSON.parse(JSON.stringify(data));
    },
    /** Vérificateur du projet : les fautes du plan, codes J12xx (panneau Problèmes, rapport). */
    diags() {
      if (!data.devices.length && !data.cables.length) return [];
      let iss = [];
      try { iss = netIssues(lan, data); } catch (e) { console.error(e); return []; }
      return iss.map(i => { const ex = explain(i.code); return { code: i.code, level: i.kind === 'err' ? 'error' : 'warning', title: i.text, key: 'nt:' + i.code + ':' + (i.id || '') + ':' + i.text, where: tl('plan réseau'), space: 'net', el: i.id || null, loc: {}, note: ex ? `${ex.why} ${tl('Source : {0}.', srcNote(i.code))}` : '' }; });
    },
    /** Outils (IA, TP) : ping, test d'un câble, pose. */
    ping: (from, target) => doPing(from, target), place: (type, x, y) => place(type, x, y), refresh: () => changed(), commit, select,
    drawPdf: null
  };
}
