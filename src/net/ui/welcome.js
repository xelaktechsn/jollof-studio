// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Démarrage d'un projet réseau (chargé à la demande par shellnet.js) : choix d'un modèle (projet vide, petit bureau
// d'un étage, collège sur deux étages, plan DXF/DWG importé, plan scanné), puis, la première fois, une visite guidée
// en cinq étapes (vues, bibliothèque, inspecteur, vérificateur, menus et palette) qu'on peut passer et revoir depuis
// le menu Aide. Le grand exemple du collège est lu à la demande (exemples/pro), jamais au démarrage.
import './welcome.css';
import { tl, isEn } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { dialog } from '../../school/ui.js';
import { keyLabel } from '../menus.js';
import { onKeyFirst } from '../../ui/shell.js';
import { version } from '../../../package.json';

const TOUR_KEY = 'jollof-net-tour', WELCOME_KEY = 'jollof-net-welcome';
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };
// Navigateur piloté par un script (tests de bout en bout) : rien ne s'ouvre tout seul, sauf demande explicite.
const scripted = () => typeof navigator !== 'undefined' && navigator.webdriver && get(WELCOME_KEY) !== 'force';
const SCHOOL = import.meta.glob('../../../exemples/pro/17-college-reseau-deux-etages.jollof', { query: '?raw', import: 'default' });

/** Modèles proposés : id, icône, nom, texte, repères (chiffres du modèle), disponible ? */
function templates(api) {
  return [
    { id: 'empty', icon: 'filePlus', name: tl('Projet vide'), text: tl('Une page blanche : posez les équipements sur le schéma logique, ou dessinez d’abord le bâtiment dans la vue Plans.'), chips: [tl('Toutes les vues')] },
    { id: 'office', icon: 'building', name: tl('Petit bureau'), text: tl('Un étage de bureaux de 40 × 18 m : pièces, local technique avec sa baie, chemin de câbles, prises, Wi-Fi et caméra déjà reliés, routeur d’accès.'), chips: [tl('1 étage'), tl('24 prises'), tl('1 baie')] },
    { id: 'school', icon: 'floorPlan', name: tl('Collège sur deux étages'), text: tl('Un projet complet de professionnel : 26 pièces, deux locaux techniques, rocade fibre, cœur de niveau 3, quatre VLAN, 17 points d’accès, liens certifiés.'), chips: [tl('2 étages'), tl('95 prises'), tl('2 baies')], off: !SCHOOL[Object.keys(SCHOOL)[0]] },
    { id: 'cad', icon: 'upload', name: tl('Depuis un plan DXF ou DWG'), text: tl('Importez le plan d’architecte : calques choisis, échelle reconnue, murs et pièces convertis, puis le réseau dessiné dessus.'), chips: ['DXF', 'DWG'], off: !api.cap.cad },
    { id: 'image', icon: 'image', name: tl('Depuis un plan scanné'), text: tl('Une image du plan (PNG, JPG) sous le dessin : étalonnez-la en cliquant deux points de distance connue, puis tracez murs et pièces.'), chips: ['PNG', 'JPG'] }
  ].filter(t => !t.off);
}

/** Choix d'un modèle ; rend l'id choisi (null : fermé). */
export async function openTemplates(api, o = {}) {
  const list = templates(api);
  const body = document.createElement('div'); body.className = 'ntTpl';
  body.innerHTML = `<p class="ntTplLead">${esc(tl('Partez d’un modèle ou d’un plan existant : tout reste modifiable, et {0} annule.', keyLabel('Mod+Z', MAC, isEn)))}</p>
    <div class="ntTplGrid">${list.map(t => `<button type="button" class="ntTplCard" data-tpl="${t.id}"><span class="ntTplIc">${icon(t.icon)}</span><b>${esc(t.name)}</b><small>${esc(t.text)}</small><span class="ntTplChips">${t.chips.map(c => `<i>${esc(c)}</i>`).join('')}</span></button>`).join('')}</div>`;
  const v = await dialog({
    title: tl('{0}Nouveau projet réseau', icon('network')), width: 900, cls: 'ntTplDlg', body,
    actions: [], // la carte « Projet vide » suffit ; fermer (Échap, ×) garde le projet vide
    onOpen: (el, close) => {
      el.addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (b) close(b.dataset.tpl); });
      el.addEventListener('keydown', e => {
        const cards = [...el.querySelectorAll('.ntTplCard')], i = cards.indexOf(document.activeElement); if (i < 0 && !/^Arrow/.test(e.key)) return;
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
        e.preventDefault(); cards[(i + d + cards.length) % cards.length].focus();
      });
      // Pas de focus imposé sur une carte (le cadre du clavier ne s'affiche pas pour un clic) : les flèches ou Tab y vont.
      const box = el.querySelector('.ntTpl'); if (box) { box.tabIndex = -1; setTimeout(() => box.focus({ preventScroll: true }), 30); }
    }
  });
  if (v) await applyTemplate(api, v);
  return v;
}

/** Applique un modèle au projet en cours (un seul pas d'annulation pour les modèles posés dans le plan). */
export async function applyTemplate(api, id) {
  const { app, ws } = api;
  if (id === 'empty') { await api.view('logic'); api.status(tl('Projet réseau vide : glissez des équipements depuis la bibliothèque, ou ouvrez la vue Plans (Alt+2).'), 'ok'); return; }
  if (id === 'cad') return api.run({ act: 'importCad' });
  if (id === 'image') { await api.view('plan'); return api.run({ act: 'importImage' }); }
  if (id === 'office') {
    const [demo, rack, sim, devs, dim] = await Promise.all([import('./plan-demo.js'), import('../rack.js').catch(() => null), import('./simpane.js').catch(() => null), import('../devices.js'), import('../dimension.js').catch(() => null)]);
    const data = ws.data();
    officeFloor(data, demo, rack, devs, dim);
    ws.commit();
    await certifyAll(ws);
    ws.commit();
    if (sim && sim.autoArrange) { try { sim.autoArrange(ws.data(), ws.lan()); ws.commit(); } catch (e) { console.error(e); } }
    // Schéma logique cadré une fois (tout voir), puis la vue Plans.
    await api.view('logic'); api.run({ act: 'fit' }); await new Promise(r => requestAnimationFrame(r));
    await api.view('plan');
    api.status(tl('Petit bureau posé : {0} équipements, {1} câbles. Vues Baies (Alt+3) et Conception (Alt+4) pour la suite.', data.devices.length, data.cables.length), 'ok');
    return;
  }
  if (id === 'school') {
    const load = SCHOOL[Object.keys(SCHOOL)[0]]; if (!load) return;
    api.status(tl('Chargement du modèle…'));
    const d = JSON.parse(await load()), en = d.en; delete d.en;
    if (isEn && en) { d.name = en.name || d.name; d.description = en.description || d.description; }
    await app.openProject(d, d.name, { dirty: true });
    const w = await api.net.ready(); if (w && w.openView) await w.openView('plan');
    api.status(tl('Modèle ouvert : {0}.', d.name), 'ok');
  }
}
/** Port libre (cuivre) d'un équipement dont l'id correspond à re, le dernier d'abord si last. */
function portFree(data, dev, re, ports, last = false) {
  const used = new Set(); for (const c of data.cables) { if (c.a[0] === dev.id) used.add(c.a[1]); if (c.b[0] === dev.id) used.add(c.b[1]); }
  const ids = ports(dev).filter(p => !p.sfp && !p.fibre && re.test(p.id) && !used.has(p.id)).map(p => p.id);
  return (last ? ids.reverse() : ids)[0] || null;
}
/**
 * Liens du modèle certifiés d'emblée (valeurs simulées par le modèle de certify.js, comme « Tester tout » de la vue
 * Conception) : un modèle s'ouvre sans avertissement à traiter. Un seul pas d'annulation.
 */
async function certifyAll(ws) {
  try {
    const C = await import('../certify.js'), d = ws.data(), at = new Date().toISOString();
    const rows = C.certLinks(d).map(l => C.resultRow(C.certify(l, C.defaultLimit(l), { band: C.BAND_DEFAULT }), l, C.linkLabel(d, l), at));
    if (rows.length) { const t = C.storeResults(d, rows, at); if (t) t.band = C.BAND_DEFAULT; ws.commit(); }
  } catch (e) { console.error(e); }
}
/**
 * Modèle « Petit bureau » : l'étage d'exemple de la vue Plans (plan-demo.js), complété pour être propre au vérificateur :
 * les deux prises de chaque boîtier câblées (second panneau), baie de 12 U rangée (panneaux, passe-câbles, switch,
 * routeur d'accès, obturateurs, PDU), canaux Wi-Fi sans recouvrement, nombre de prises de chaque pièce retenu par le
 * dimensionnement. Reste à faire par l'utilisateur, exprès : la certification des liens (menu Tests).
 */
function officeFloor(data, demo, rack, devs, dim) {
  const r = demo.addDemoFloor(data, { newRack: rack && rack.newRack, name: tl('Bureaux') });
  data.site.name = data.site.name || tl('Petit bureau');
  // Un seul étage : le rez-de-chaussée (niveau 0, sol à 0 m).
  Object.assign(r.floor, { name: tl('Rez-de-chaussée'), level: 0, elev: 0 });
  const F = r.floor, lx = (r.building.x || 0) * 10, R = r.rack;
  const inRack = u => (R ? { rack: { id: R.id, u, face: 'front' } } : {});
  const at = (x, y, h) => (R ? null : { floor: F.id, x, y, h });
  // Second panneau : la deuxième prise de chaque boîtier double.
  const pp2 = demo.addDevice(data, 'patch24', { x: lx + 220, y: 0 }, at(1.5, 2.6, 1.4), inRack(8));
  let k = 1;
  for (const d of data.devices.filter(x => x.type === 'outlet2' && x.loc && x.loc.floor === F.id)) {
    const dp = demo.freePort(data, d, 'punch'); if (!dp) continue;
    demo.addLink(data, [pp2.id, 'b' + k], [d.id, dp], { route: 'auto', cat: 'cat6a' }); k++;
  }
  // Routeur d'accès relié au dernier port du switch.
  const gw = demo.addDevice(data, 'routerpro', { x: lx, y: -140 }, at(2.5, 2.6, 1.6), inRack(7));
  const up = r.sw ? portFree(data, r.sw, /^p\d+$/, devs.portsOf, true) : null, gp = portFree(data, gw, /^ge[1-3]$/, devs.portsOf);
  if (up && gp) demo.addLink(data, [r.sw.id, up], [gw.id, gp], { len: 1, cat: 'cat6a' });
  if (R) {
    // Baie de 12 U : panneau 1, passe-câbles, switch, passe-câbles, panneau 2, routeur ; obturateurs ; PDU sur le côté.
    R.u = 12;
    const place = (d, u) => { if (d) d.rack = { id: R.id, u, face: 'front' }; };
    place(r.patch, 12); place(r.sw, 10); place(pp2, 8); place(gw, 7);
    const mech = (type, u, i) => demo.addDevice(data, type, { x: lx + 400 + i * 10, y: 0 }, null, u ? inRack(u) : { rack: { id: R.id, u: 0, face: 'front' } });
    mech('cablemgr', 11, 0); mech('cablemgr', 9, 1);
    for (let u = 1; u <= 6; u++) mech('blank', u, 2 + u);
    if (devs.DEVICES.pdu) mech('pdu', 0, 9);
  }
  // Canaux : 1, 6, 11 en 2,4 GHz ; 36, 52, 100 en 5 GHz (40 MHz), un par point d'accès.
  const C24 = [1, 6, 11], C5 = [36, 52, 100];
  data.devices.filter(d => /^ap/.test(d.type) && d.p && d.p.radios).forEach((d, i) => {
    if (d.p.radios.b24) d.p.radios.b24.ch = C24[i % 3];
    if (d.p.radios.b5) d.p.radios.b5.ch = C5[i % 3];
  });
  // Prises de chaque pièce : celles du modèle, retenues par le dimensionnement (modifiable dans Conception).
  if (dim && dim.dimension) {
    try {
      const res = dim.dimension(data); data.design = data.design || {}; data.design.rooms = { ...(data.design.rooms || {}) };
      for (const x of res.rooms) if (x.placed > 0 && x.placed !== x.outlets) data.design.rooms[x.id] = { ...(data.design.rooms[x.id] || {}), outlets: x.placed };
    } catch (e) { console.error(e); }
  }
  return r;
}

/** Nouveau projet réseau : modèles (chaque fois), puis la visite la première fois. */
export async function welcome(api) {
  if (scripted()) return;
  await openTemplates(api, { first: true });
  if (get(TOUR_KEY) !== '1') setTimeout(() => startTour(api), 450);
}

/* ---------- Visite guidée ---------- */
let tour = null;
function steps() {
  const pal = keyLabel('Mod+Shift+P', MAC, isEn), prob = keyLabel('Mod+Shift+M', MAC, isEn);
  return [
    { sel: ['.ntViewBar', '.ntHost'], icon: 'layers', title: tl('Quatre vues, un seul projet'), text: tl('Vue logique, Plans, Baies et Conception montrent le même modèle : un switch posé sur le plan est aussi dans sa baie et sur le schéma. Alt+1 à Alt+4 pour passer de l’une à l’autre.') },
    { sel: ['.app.netMode .ntLib:not([hidden])', '#actBar .actBtn'], icon: 'box', title: tl('La bibliothèque'), text: tl('Switchs, routeurs, prises, points d’accès, panneaux, onduleurs… Glissez-les dans la vue montrée : sur un plan, ils se posent à l’échelle et leurs câbles prennent leur longueur réelle.') },
    { sel: ['.panel.right'], icon: 'sliders', title: tl('L’inspecteur'), text: tl('Les réglages de la sélection : adresses IP, VLAN, routage et OSPF, Spanning Tree, emplacement et hauteur de pose. Sans sélection : la base des VLAN du projet.') },
    { sel: ['.statusbar .sbProblems', '.statusbar'], icon: 'alert', title: tl('Le vérificateur, en continu'), text: tl('Longueurs, PoE, VLAN, Wi-Fi, baies, fibre : chaque règle est vérifiée à chaque modification, avec sa source. {0} ouvre les problèmes ; un clic montre l’objet en cause.', prob) },
    { sel: ['.ntMb:not([hidden])', '.appbar'], icon: 'keyboard', title: tl('Menus et palette de commandes'), text: tl('Tout le module est dans les menus : import d’un plan, insertion, réseau, dimensionnement, tests, documents. {0} retrouve n’importe quelle commande par son nom ; F10 donne le clavier aux menus.', pal) }
  ];
}
/** Lance la visite (o.force : même déjà vue). */
export function startTour(api, o = {}) {
  if (tour) return;
  if (!o.force && (get(TOUR_KEY) === '1' || scripted())) return;
  if (!api.ws.isOn()) api.ws.setMode(true);
  const S = steps();
  let i = 0;
  const root = document.createElement('div'); root.className = 'ntTour'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', tl('Visite guidée du module réseau'));
  root.innerHTML = '<div class="ntTourRing"></div><div class="ntTourCard" tabindex="-1"></div>';
  document.body.appendChild(root);
  const ring = root.querySelector('.ntTourRing'), card = root.querySelector('.ntTourCard');
  const target = s => { for (const q of s.sel) { const el = [...document.querySelectorAll(q)].find(x => x.getClientRects().length && x.offsetParent !== null || x === document.querySelector('.statusbar')); if (el) return el; } return null; };
  function place() {
    const s = S[i], el = target(s), W = innerWidth, H = innerHeight;
    const r = el ? el.getBoundingClientRect() : { left: W / 2 - 1, top: H / 2 - 1, width: 2, height: 2, right: W / 2 + 1, bottom: H / 2 + 1 };
    const pad = 6, x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(W - 8, r.width + pad * 2), h = Math.min(H - 8, r.height + pad * 2);
    Object.assign(ring.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const cw = card.offsetWidth || 360, ch = card.offsetHeight || 200, gap = 14;
    // Place de la carte : à droite, à gauche, dessous, dessus de la zone, sinon au centre.
    // Chaque place est ramenée dans la fenêtre ; on garde la première qui ne couvre pas la zone montrée.
    const clamp = ([a, b]) => [Math.max(8, Math.min(a, W - cw - 8)), Math.max(8, Math.min(b, H - ch - 8))];
    const free = ([a, b]) => a >= x + w || a + cw <= x || b >= y + h || b + ch <= y;
    const spots = [[x + w + gap, y], [x - cw - gap, y], [x, y + h + gap], [x, y - ch - gap]].map(clamp);
    const [cx, cy] = spots.find(free) || clamp([(W - cw) / 2, (H - ch) / 2]);
    card.style.left = cx + 'px'; card.style.top = cy + 'px';
  }
  function paint() {
    const s = S[i], last = i === S.length - 1;
    card.innerHTML = `<div class="ntTourHead"><span class="ntTourIc">${icon(s.icon)}</span><span class="ntTourStep">${esc(tl('{0} sur {1}', i + 1, S.length))}</span><button type="button" class="ntTourX" data-t="skip" aria-label="${esc(tl('Passer la visite'))}">${icon('x')}</button></div>
      <h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>
      <div class="ntTourDots">${S.map((x, k) => `<button type="button" data-k="${k}" aria-label="${esc(tl('Étape {0}', k + 1))}" aria-current="${k === i}"></button>`).join('')}</div>
      <div class="ntTourNav"><button type="button" class="btn" data-t="skip">${esc(tl('Passer'))}</button><span class="grow"></span>${i ? `<button type="button" class="btn" data-t="prev">${icon('chevLeft')}${esc(tl('Précédent'))}</button>` : ''}<button type="button" class="btn primary" data-t="${last ? 'done' : 'next'}">${esc(last ? tl('Terminer') : tl('Suivant'))}${last ? '' : icon('chevRight')}</button></div>`;
    place(); requestAnimationFrame(place);
    const p = card.querySelector('.btn.primary'); if (p) p.focus({ preventScroll: true });
  }
  let offKey = null;
  function end() {
    set(TOUR_KEY, '1');
    if (offKey) offKey(); removeEventListener('resize', place);
    root.classList.add('out'); setTimeout(() => root.remove(), 160); tour = null;
  }
  const go = k => { i = Math.max(0, Math.min(S.length - 1, k)); paint(); };
  // Clavier (avant les plans de travail : shell.js onKeyFirst) : la visite est modale, seules Entrée et Espace vont au bouton.
  const key = e => {
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight') { if (i < S.length - 1) go(i + 1); else end(); }
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Tab') { // le focus reste dans la carte
      const f = [...card.querySelectorAll('button')]; if (!f.length) return true;
      const j = f.indexOf(document.activeElement); f[(j + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    } else if (e.key === 'Enter' || e.key === ' ') { const b = card.contains(document.activeElement) ? document.activeElement : card.querySelector('.btn.primary'); if (b) b.click(); }
    return true;
  };
  root.addEventListener('click', e => {
    const d = e.target.closest('[data-k]'); if (d) { go(+d.dataset.k); return; }
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t; if (t === 'next') go(i + 1); else if (t === 'prev') go(i - 1); else end();
  });
  offKey = onKeyFirst(key); addEventListener('resize', place);
  tour = { end };
  requestAnimationFrame(paint);
}

/** À propos (menu Aide) : version, licence, auteur, liens. */
export function about(api) {
  const link = (u, t) => `<a href="${u}" target="_blank" rel="noopener" data-url="${u}">${esc(t)}</a>`;
  const body = document.createElement('div'); body.className = 'ntAbout';
  body.innerHTML = `<p class="ntAboutLead"><b>Jollof Studio</b> · ${esc(tl('version {0}', version))}</p>
    <p>${esc(tl('Électronique, pneumatique, logique et réseaux informatiques, simulés et vérifiés.'))}</p>
    <p>${esc(tl('Logiciel libre sous licence AGPL-3.0 (une licence commerciale existe aussi).'))} © 2026 Mamadou Sarr.</p>
    <p class="ntAboutLinks">${link('https://xelaktechsn.github.io/jollof-studio/', tl('Site et documentation'))} · ${link('https://github.com/xelaktechsn/jollof-studio', tl('Code source'))} · ${link('https://github.com/xelaktechsn/jollof-studio/issues', tl('Signaler un problème…'))}</p>`;
  body.addEventListener('click', e => { const a = e.target.closest('[data-url]'); if (!a) return; e.preventDefault(); const n = api.app.native; if (n && n.openExternal) n.openExternal(a.dataset.url); else window.open(a.dataset.url, '_blank', 'noopener'); });
  return dialog({ title: tl('{0}À propos de Jollof Studio', icon('info')), width: 460, body, actions: [{ label: tl('Fermer'), value: null }] });
}
