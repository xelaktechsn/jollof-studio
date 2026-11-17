// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Automate : le panneau Ladder du plan de travail pneumatique. Les réseaux se lisent et s'écrivent au même endroit :
// barre de gauche, contacts et bobines en série (dérivations en parallèle), barre de droite ; chaque élément porte son
// nom au-dessus et son adresse d'automate (%I0.0, %Q0.0, %M0…) au-dessous. On choisit un élément (ou le « + » en bout
// de réseau), la palette du pied insère un élément à sa suite, change son nom ou son réglage, le met en dérivation ou
// le retire. Un pupitre (boutons de l'automate) se manipule à la souris pendant la simulation. La table des variables
// donne nom, adresse, nature et état. Les fautes (compilation et noms) sont écrites sous le réseau fautif ; un
// programme en erreur ne tourne pas, le bandeau le dit. Pendant la simulation, le courant allume les éléments, les
// temporisations montrent leur temps écoulé, les compteurs leur valeur.
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { menu as popMenu, confirm as confirmDlg, toast } from '../school/ui.js';
import { newPlc, newRung, uid, cleanPlc, compilePlc, lintPlc, walkPlc, CONTACTS, OUTPUTS, TIMERS, COUNTERS, OPS, KIND_NAME, SYM } from './ladder.js';
import { isTauri, plcExportXml, saveFile } from '../native.js';
import { createModbusLink } from './modbus.js';
import './plc.css';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = p => JSON.parse(JSON.stringify(p));
const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');
const CLS_NAME = { in: () => tl('entrée'), out: () => tl('sortie'), mem: () => tl('mémoire'), timer: () => tl('temporisation'), counter: () => tl('compteur'), step: () => tl('étape GRAFCET'), sys: () => tl('système') };
const BLOCKS = new Set([...TIMERS, ...COUNTERS]);

/* ---------- Symboles (SVG) : contacts, bobines, blocs ---------- */
const M = 14;
const wire = (a, b) => `<path d="M${a} ${M}H${b}"/>`;
const contact = (inner = '') => `${wire(0, 17)}${wire(31, 48)}<path d="M17 4V24M31 4V24"/>${inner}`;
const coil = (inner = '') => `${wire(0, 16)}${wire(32, 48)}<path d="M16 3a11 11 0 0 0 0 22M32 3a11 11 0 0 1 0 22"/>${inner}`;
const letter = ch => `<text x="24" y="18.5" class="plT">${ch}</text>`;
const SVG = {
  no: contact(), nc: contact('<path d="M15 24L33 4"/>'), p: contact(letter('P')), n: contact(letter('N')),
  cmp: `${wire(0, 10)}${wire(38, 48)}<path d="M10 4V24h4M38 4V24h-4"/><text x="24" y="18.5" class="plT">⋛</text>`,
  coil: coil(), ncoil: coil('<path d="M18 23L30 5"/>'), set: coil(letter('S')), reset: coil(letter('R'))
};
const glyph = it => (BLOCKS.has(it.t)
  ? `<svg class="plG plGb" viewBox="0 0 72 28" aria-hidden="true">${wire(0, 12)}${wire(60, 72)}<rect class="plBox" x="12" y="2" width="48" height="24" rx="3"/><rect class="plFill" x="12" y="2" width="0" height="24" rx="3"/><text x="36" y="19" class="plT plTb">${it.t.toUpperCase()}</text></svg>`
  : `<svg class="plG" viewBox="0 0 48 28" aria-hidden="true">${SVG[it.t] || ''}</svg>`);
/** Texte d'un élément (au-dessus du symbole). */
const labelOf = it => (it.t === 'cmp' ? `${it.a || '?'} ${it.op} ${it.b}` : it.v || '?');
const subOf = (it, addr) => (TIMERS.has(it.t) ? `PT ${fmt(it.pt)} s` : COUNTERS.has(it.t) ? `PV ${it.pv}${it.r ? ` · ${it.t === 'ctu' ? 'R' : 'LD'} ${it.r}` : ''}` : addr || '');

/**
 * host : le plan de travail pneumatique. api : { get() → programme ou null, set(p) (modification annulable),
 * sim() → simulation en cours ?, live() → { run (état d'exécution), out (sorties vraies), read(nom) } ou null,
 * press(nom, appuyé), pressed(nom), known() → { inputs, outputs, steps } (noms du circuit, du montage, du GRAFCET),
 * fromGrafcet() → { plc, notes } ou { error }, grafcetDrive(v), opened(), closed(), status(msg, kind) }.
 */
export function createPlcPanel(host, api) {
  const el = document.createElement('aside');
  el.className = 'plPanel glass'; el.hidden = true; el.setAttribute('aria-label', tl('Automate (Ladder)'));
  el.innerHTML = `<header class="plHead"><b>${icon('cpu')}${tl('Automate')}</b><span class="plMode"></span><span class="grow"></span>
      <button type="button" class="tb" data-pl="gen" data-tip="${tl('Écrire le Ladder d’après le GRAFCET du plan')}" aria-label="${tl('Écrire le Ladder d’après le GRAFCET')}">${icon('workflow')}</button>
      <button type="button" class="tb" data-pl="vars" data-tip="${tl('Table des variables : noms, adresses, états')}" aria-label="${tl('Table des variables')}" aria-pressed="false">${icon('list')}</button>
      ${isTauri() ? `<button type="button" class="tb" data-pl="mb" data-tip="${tl('Modbus TCP : une IHM, un SCADA ou un autre automate lit et commande cet automate')}" aria-label="${tl('Serveur Modbus TCP')}" aria-pressed="false">${icon('link')}<i class="plMbDot" hidden></i></button>
      <button type="button" class="tb" data-pl="xml" data-tip="${tl('Exporter en PLCopen XML (CODESYS, OpenPLC, Beremiz…)')}" aria-label="${tl('Exporter en PLCopen XML')}">${icon('save')}</button>` : ''}
      <button type="button" class="tb" data-pl="close" aria-label="${tl('Fermer l’automate')}">${icon('x')}</button></header>
    <div class="plPupitre"></div>
    <div class="plHalt" hidden>${icon('alert')}<span></span></div>
    <div class="plVars" hidden></div>
    <div class="plMb" hidden></div>
    <div class="plScroll"><div class="plNets"></div><div class="plAdd"><button type="button" class="btn subtle small" data-pl="addrung">${icon('plus')}<span>${tl('Ajouter un réseau')}</span></button></div></div>
    <footer class="plFoot"><div class="plPal"></div><label class="plDrive"><input type="checkbox" data-pl="drive"><span>${tl('L’automate commande les électrovannes')}</span></label></footer>`;
  host.appendChild(el);
  const nets = el.querySelector('.plNets'), pup = el.querySelector('.plPupitre'), pal = el.querySelector('.plPal'), varsBox = el.querySelector('.plVars'), halt = el.querySelector('.plHalt'), mbBox = el.querySelector('.plMb');
  let showMb = false;
  let sel = null; // { el: id } ou { slot: { rung: id, par: id|null, br: k } } (bout de liste)
  let showVars = false, C = null, L = null, addr = new Map(), diagOf = new Map();

  const g = () => api.get() || newPlc();
  const commit = fn => { const n = clone(g()); fn(n); api.set(cleanPlc(n) || newPlc()); };
  /** Compile et résout les noms (pour l'affichage) ; fautes rangées par réseau et par élément. */
  function analyse() {
    const p = g(); C = compilePlc(p); L = lintPlc(C, api.known ? api.known() : {});
    addr = new Map(L.vars.map(v => [v.name.toLowerCase(), v])); diagOf = new Map();
    for (const d of [...C.errors, ...L.diags.filter(x => x.level === 'error'), ...C.warnings, ...L.diags.filter(x => x.level === 'warning')]) { const k = d.rung; if (!diagOf.has(k)) diagOf.set(k, []); diagOf.get(k).push(d); }
  }
  const addrOf = name => { const v = addr.get(String(name || '').toLowerCase()); return v ? v.addr : ''; };

  /* ---------- Position d'un élément ou d'un bout de liste ---------- */
  /** Liste et index d'un élément par son identifiant : { list, j, par, rung } ou null. */
  function findEl(p, id) {
    let out = null;
    p.rungs.forEach((r, ri) => { if (out) return; const go = (list, par) => list.forEach((it, j) => { if (out) return; if (it.id === id) out = { list, j, par, rung: ri, rungId: r.id }; else if (it.t === 'par') it.branches.forEach(b => go(b, it)); }); go(r.items, null); });
    return out;
  }
  /** Liste visée par un bout de réseau ou de branche. */
  function listOfSlot(p, s) {
    const r = p.rungs.find(x => x.id === s.rung); if (!r) return null;
    if (!s.par) return r.items;
    const f = findEl(p, s.par); return f && f.list[f.j].t === 'par' ? f.list[f.j].branches[s.br] || null : null;
  }
  /** Où insérer d'après la sélection : { list, at } dans le programme n ; sans sélection, à la fin du dernier réseau. */
  function target(n) {
    if (sel && sel.el) { const f = findEl(n, sel.el); if (f) return { list: f.list, at: f.j + 1 }; }
    if (sel && sel.slot) { const list = listOfSlot(n, sel.slot); if (list) return { list, at: list.length }; }
    if (!n.rungs.length) n.rungs.push(newRung());
    const list = n.rungs[n.rungs.length - 1].items; return { list, at: list.length };
  }
  const defaults = t => (TIMERS.has(t) ? { v: nextName(n => `T${n}`), pt: 2 } : COUNTERS.has(t) ? { v: nextName(n => `C${n}`), pv: 3, r: '' } : t === 'cmp' ? { a: '', op: '>=', b: 1 } : { v: '' });
  function nextName(fmtN) { const used = new Set(); walkPlc(g(), it => { if (it.v) used.add(it.v.toLowerCase()); }); let i = 1; while (used.has(fmtN(i).toLowerCase())) i++; return fmtN(i); }

  /* ---------- Dessin ---------- */
  function itemsHtml(list, slot) {
    return list.map(it => (it.t === 'par'
      ? `<div class="plPar${sel && sel.el === it.id ? ' sel' : ''}" data-el="${it.id}">${it.branches.map((b, k) => `<div class="plBr">${itemsHtml(b, { rung: slot.rung, par: it.id, br: k })}<span class="plWire"></span></div>`).join('')}</div>`
      : elHtml(it))).join('') + slotHtml(slot);
  }
  function elHtml(it) {
    const d = (diagOf.get(-1) || []); void d;
    const bad = [...(C.errors), ...(L.diags)].find(x => x.el === it.id);
    const cls = `plEl ${CONTACTS.has(it.t) ? 'plC' : OUTPUTS.has(it.t) ? 'plO' : 'plB'}${sel && sel.el === it.id ? ' sel' : ''}${bad ? (bad.level === 'error' ? ' err' : ' warn') : ''}`;
    const sub = subOf(it, addrOf(it.v));
    return `<button type="button" class="${cls}" data-el="${it.id}" title="${esc(KIND_NAME[it.t] ? KIND_NAME[it.t]() : it.t)}${bad ? ' · ' + esc(bad.text) : ''}"><span class="plLbl">${esc(labelOf(it))}</span>${glyph(it)}<span class="plSub">${esc(sub)}</span><span class="plLive"></span></button>`;
  }
  const slotHtml = s => { const on = sel && sel.slot && sel.slot.rung === s.rung && (sel.slot.par || null) === (s.par || null) && (sel.slot.br || 0) === (s.br || 0); return `<button type="button" class="plSlot${on ? ' sel' : ''}" data-slot="${esc(JSON.stringify(s))}" title="${tl('Insérer ici (palette)')}">${icon('plus')}</button>`; };
  function rungHtml(r, i) {
    const ds = diagOf.get(i) || [], errs = ds.filter(d => d.level === 'error').length;
    return `<section class="plRung${errs ? ' err' : ds.length ? ' warn' : ''}" data-rung="${r.id}" data-i="${i}">
      <div class="plRungHead"><span class="plNo">${i + 1}</span><input class="plComment" data-f="comment" value="${esc(r.comment)}" placeholder="${tl('commentaire du réseau')}" maxlength="80" spellcheck="false" aria-label="${tl('Commentaire du réseau {0}', i + 1)}"><button type="button" class="tb plMore" data-pl="more" data-tip="${tl('Réseau {0} : insérer, dupliquer, déplacer, supprimer', i + 1)}" aria-label="${tl('Menu du réseau {0}', i + 1)}">${icon('dots')}</button></div>
      <div class="plNet"><span class="plRail"></span><div class="plSer">${itemsHtml(r.items, { rung: r.id })}</div><span class="plRail r"></span></div>
      ${ds.length ? `<ul class="plDiags">${ds.slice(0, 4).map(d => `<li class="${d.level}">${icon(d.level === 'error' ? 'alert' : 'info')}<span>${esc(d.text)}</span></li>`).join('')}</ul>` : ''}</section>`;
  }
  function render() {
    if (el.hidden) return;
    analyse();
    const p = g(), a = document.activeElement, keep = a && el.contains(a) && a.dataset.f ? { f: a.dataset.f, rung: a.closest('[data-rung]') && a.closest('[data-rung]').dataset.rung, s: a.selectionStart, e: a.selectionEnd } : null;
    el.querySelector('[data-pl="drive"]').checked = p.drive !== false;
    el.querySelector('.plMode').textContent = p.drive !== false ? tl('commande') : tl('observation');
    el.querySelector('[data-pl="vars"]').setAttribute('aria-pressed', String(showVars));
    const mbB = el.querySelector('[data-pl="mb"]'); if (mbB) mbB.setAttribute('aria-pressed', String(showMb));
    nets.innerHTML = p.rungs.length ? p.rungs.map(rungHtml).join('') : `<div class="plEmpty">${icon('cpu')}<b>${tl('Programme vide')}</b><p>${tl('Ajoutez un réseau, puis des contacts et une bobine depuis la palette : par exemple « dcy » en contact et « Y1 » en bobine. Ou écrivez le Ladder d’après le GRAFCET du plan (bouton en haut).')}</p></div>`;
    renderPupitre(); renderVars(); renderMb(); renderPal();
    if (keep && keep.f === 'comment') { const f = nets.querySelector(`[data-rung="${keep.rung}"] [data-f="comment"]`); if (f) { f.focus(); try { f.setSelectionRange(keep.s, keep.e); } catch (e) { /* rien */ } } }
    live();
  }
  function renderPupitre() {
    const p = g(), sim = api.sim();
    const chips = p.inputs.map(x => `<span class="plInput" data-name="${esc(x.name)}"><button type="button" class="gfPress${x.kind === 'switch' ? ' sw' : ''}" data-press="${esc(x.name)}"${sim ? '' : ' disabled'} aria-pressed="${!!api.pressed(x.name)}" title="${x.kind === 'switch' ? tl('Interrupteur : un clic le ferme, un autre l’ouvre') : tl('Bouton poussoir : maintenez le clic')}">${esc(x.name)}</button>${sim ? '' : `<button type="button" class="tb" data-pl="kind" data-tip="${x.kind === 'switch' ? tl('Interrupteur (cliquer : bouton poussoir)') : tl('Bouton poussoir (cliquer : interrupteur)')}">${icon(x.kind === 'switch' ? 'toggle' : 'pointer')}</button><button type="button" class="tb" data-pl="indel" aria-label="${tl('Retirer {0}', x.name)}">${icon('x')}</button>`}</span>`).join('');
    pup.innerHTML = `<span class="gfLbl">${tl('Pupitre')}</span>${chips}${sim ? `<span class="plCycle"></span>` : `<input class="gfNewIn" placeholder="${tl('+ entrée')}" maxlength="16" spellcheck="false" aria-label="${tl('Nouvelle entrée du pupitre')}">`}`;
  }
  function renderVars() {
    varsBox.hidden = !showVars; if (!showVars) return;
    const rows = L.vars.map(v => `<tr data-var="${esc(v.name.toLowerCase())}"><td class="plVN">${esc(v.name)}</td><td class="plVA">${esc(v.addr)}</td><td class="plVC">${CLS_NAME[v.cls] ? CLS_NAME[v.cls]() : v.cls}</td><td class="plVV"><i></i><span></span></td></tr>`).join('');
    varsBox.innerHTML = rows ? `<table><thead><tr><th>${tl('Nom')}</th><th>${tl('Adresse')}</th><th>${tl('Nature')}</th><th>${tl('État')}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="plNone">${tl('Aucune variable : le programme est vide.')}</p>`;
  }
  /* ---------- Palette : insérer, régler l'élément choisi ---------- */
  function renderPal() {
    const p = g(), it = sel && sel.el ? (findEl(p, sel.el) || {}).list?.[findEl(p, sel.el).j] : null;
    const chip = (t, label, tip) => `<button type="button" class="plChip" data-ins="${t}" title="${esc(tip)}"><svg viewBox="0 0 48 28" aria-hidden="true">${t === 'par' ? '<path d="M0 8H48M0 20H48M10 8V20M38 8V20"/>' : SVG[t] || `<rect x="8" y="4" width="32" height="20" rx="3"/><text x="24" y="18" class="plT">${label}</text>`}</svg><span>${esc(label)}</span></button>`;
    const where = it ? tl('après {0}', labelOf(it)) : sel && sel.slot ? tl('au bout du réseau') : p.rungs.length ? tl('au bout du dernier réseau') : tl('dans un nouveau réseau');
    let h = `<div class="plPalHead"><b>${tl('Insérer')}</b><small>${esc(where)}</small></div>
      <div class="plChips">${chip('no', tl('ouvert'), KIND_NAME.no())}${chip('nc', tl('fermé'), KIND_NAME.nc())}${chip('p', 'P', KIND_NAME.p())}${chip('n', 'N', KIND_NAME.n())}${chip('cmp', tl('comparer'), KIND_NAME.cmp())}<i class="plSep"></i>${chip('coil', tl('bobine'), KIND_NAME.coil())}${chip('set', 'S', KIND_NAME.set())}${chip('reset', 'R', KIND_NAME.reset())}${chip('ncoil', tl('inversée'), KIND_NAME.ncoil())}<i class="plSep"></i>${chip('ton', 'TON', KIND_NAME.ton())}${chip('tof', 'TOF', KIND_NAME.tof())}${chip('tp', 'TP', KIND_NAME.tp())}${chip('ctu', 'CTU', KIND_NAME.ctu())}${chip('ctd', 'CTD', KIND_NAME.ctd())}${it && it.t !== 'par' ? `<i class="plSep"></i>${chip('par', tl('dérivation'), tl('Mettre l’élément choisi en parallèle avec une nouvelle branche'))}` : ''}</div>`;
    if (it && it.t !== 'par') {
      const K = api.known ? api.known() : { inputs: [], outputs: [] };
      const names = [...new Set([...(K.inputs || []), ...(K.outputs || []), ...[...C.written.values()].map(w => w.name), ...[...C.timers.values()].map(t => t.name), ...[...C.counters.values()].map(k => k.name), ...(K.steps ? [...K.steps].map(n => `X${n}`) : []), 'INIT'])];
      const dl = `<datalist id="plNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
      const fam = CONTACTS.has(it.t) ? ['no', 'nc', 'p', 'n', 'cmp'] : OUTPUTS.has(it.t) ? ['coil', 'set', 'reset', 'ncoil'] : TIMERS.has(it.t) ? ['ton', 'tof', 'tp'] : ['ctu', 'ctd'];
      const kind = `<select class="sel" data-f="t" aria-label="${tl('Nature de l’élément')}">${fam.map(t => `<option value="${t}"${t === it.t ? ' selected' : ''}>${esc(KIND_NAME[t]())}</option>`).join('')}</select>`;
      let fields = '';
      if (it.t === 'cmp') fields = `<input class="inp" data-f="a" value="${esc(it.a)}" list="plNames" placeholder="C1" spellcheck="false" aria-label="${tl('Compteur ou temporisation')}"><select class="sel" data-f="op">${OPS.map(o => `<option${o === it.op ? ' selected' : ''}>${o}</option>`).join('')}</select><input class="inp plNum" data-f="b" type="number" step="1" value="${it.b}" aria-label="${tl('Valeur')}">`;
      else {
        fields = `<input class="inp" data-f="v" value="${esc(it.v)}" list="plNames" placeholder="${TIMERS.has(it.t) ? 'T1' : COUNTERS.has(it.t) ? 'C1' : OUTPUTS.has(it.t) ? 'Y1' : 'dcy'}" spellcheck="false" maxlength="16" aria-label="${tl('Nom de la variable')}">`;
        if (TIMERS.has(it.t)) fields += `<label class="plF"><span>PT</span><input class="inp plNum" data-f="pt" type="number" min="0.1" step="0.5" value="${it.pt}" aria-label="${tl('Durée (s)')}"><span>s</span></label>`;
        if (COUNTERS.has(it.t)) fields += `<label class="plF"><span>PV</span><input class="inp plNum" data-f="pv" type="number" min="1" step="1" value="${it.pv}" aria-label="${tl('Présélection')}"></label><label class="plF"><span>${it.t === 'ctu' ? 'R' : 'LD'}</span><input class="inp" data-f="r" value="${esc(it.r)}" list="plNames" placeholder="raz" spellcheck="false" maxlength="16" aria-label="${it.t === 'ctu' ? tl('Entrée de remise à zéro') : tl('Entrée de chargement')}"></label>`;
      }
      const v = it.v && addr.get(it.v.toLowerCase());
      h += `<div class="plEdit">${dl}<div class="plEditRow">${kind}${fields}</div><div class="plEditRow"><small class="plWhat">${v ? `${esc(v.addr)} · ${CLS_NAME[v.cls] ? CLS_NAME[v.cls]() : ''}` : ''}</small><span class="grow"></span><button type="button" class="btn small" data-pl="del">${icon('trash')}<span>${tl('Retirer')}</span></button></div></div>`;
    } else if (it && it.t === 'par') {
      h += `<div class="plEdit"><div class="plEditRow"><small class="plWhat">${tl('Dérivation : {0} branches', it.branches.length)}</small><span class="grow"></span><button type="button" class="btn small" data-pl="branch">${icon('plus')}<span>${tl('Branche')}</span></button><button type="button" class="btn small" data-pl="del">${icon('trash')}<span>${tl('Retirer')}</span></button></div></div>`;
    } else {
      h += `<p class="plHint">${icon('info')}<span>${tl('Cliquez un élément pour le régler ou en insérer un à sa suite ; le « + » d’un réseau insère à son bout. Les contacts lisent le pupitre, les capteurs (a0, B1…), le montage et les étapes X du GRAFCET ; les bobines écrivent les électrovannes (Y1…) et des mémoires (M1…).')}</span></p>`;
    }
    const nErr = C.errors.length + L.diags.filter(d => d.level === 'error').length, nWarn = C.warnings.length + L.diags.filter(d => d.level === 'warning').length;
    h += `<div class="plStatus ${nErr ? 'err' : nWarn ? 'warn' : 'ok'}">${icon(nErr ? 'alert' : nWarn ? 'info' : 'check')}<span>${nErr ? tl('{0} erreur{1} : l’automate ne tourne pas tant qu’elles restent.', nErr, nErr > 1 ? 's' : '') : nWarn ? tl('{0} avertissement{1}.', nWarn, nWarn > 1 ? 's' : '') : p.rungs.length ? tl('Programme correct.') : ''}</span></div>`;
    pal.innerHTML = h;
  }
  /* ---------- Simulation : courant, temporisations, compteurs, pupitre, table ---------- */
  function live() {
    if (el.hidden) return;
    const Lv = api.live();
    el.classList.toggle('running', !!Lv);
    const run = Lv && Lv.run;
    halt.hidden = !(run && run.halted); if (run && run.halted) halt.querySelector('span').textContent = tl('Programme en erreur : l’automate ne tourne pas. Corrigez les réseaux marqués en rouge.');
    const cyc = pup.querySelector('.plCycle'); if (cyc && run) cyc.textContent = tl('cycle {0}', run.scan);
    nets.querySelectorAll('.plEl').forEach(b => {
      const id = b.dataset.el, on = !!run && !!run.power.get(id);
      b.classList.toggle('on', on);
      const f = C.els.get(id); if (!f) return;
      const it = f.it, lv = b.querySelector('.plLive'), fill = b.querySelector('.plFill');
      let txt = '';
      if (run && TIMERS.has(it.t)) { const T = run.timers.get(it.v.toLowerCase()); const et = T ? T.et : 0; txt = `${fmt(et)} s`; if (fill) fill.setAttribute('width', String(48 * Math.min(1, it.pt ? et / it.pt : 0))); }
      else if (run && COUNTERS.has(it.t)) { const K = run.counters.get(it.v.toLowerCase()); txt = String(K ? K.cv : 0); if (fill) fill.setAttribute('width', String(48 * Math.min(1, it.pv ? (K ? K.cv : 0) / it.pv : 0))); }
      else if (fill) fill.setAttribute('width', '0');
      if (lv.textContent !== txt) lv.textContent = txt;
      if (OUTPUTS.has(it.t) && run) b.classList.toggle('lit', !!run.bits.get(it.v.toLowerCase()));
    });
    pup.querySelectorAll('[data-press]').forEach(b => { const on = !!api.pressed(b.dataset.press); if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); });
    if (showMb) mbBox.querySelectorAll('tr[data-mbv]').forEach(tr => {
      const l = tr.dataset.mbv, k = tr.dataset.k, vv = tr.querySelector('.plVV'), sp = vv.querySelector('span');
      let t = '', on = false;
      if (Lv) {
        if (k === 'pupitre') on = !!api.pressed(tr.dataset.name);
        else if (k === 'timer') { const T = run.timers.get(l); t = String(Math.round(((T && T.et) || 0) * 10)); }
        else if (k === 'counter') { const K = run.counters.get(l); t = String((K && K.cv) || 0); }
        else if (k === 'sys') t = l === 'cycle' ? String(run.scan & 0xffff) : run.halted ? '1' : '0';
        else on = !!Lv.read(l);
        if (!t) t = on ? '1' : '0';
      }
      vv.classList.toggle('on', on); vv.classList.toggle('off', !!Lv && !on && !['timer', 'counter', 'sys'].includes(k));
      if (sp.textContent !== t) sp.textContent = t;
    });
    if (showVars) varsBox.querySelectorAll('tr[data-var]').forEach(tr => {
      const l = tr.dataset.var, v = Lv ? Lv.read(l) : null, vv = tr.querySelector('.plVV');
      vv.classList.toggle('on', !!v); vv.classList.toggle('off', Lv && !v);
      const T = run && run.timers.get(l), K = run && run.counters.get(l);
      const t = !Lv ? '' : T ? `${fmt(T.et)} s` : K ? String(K.cv) : v ? '1' : '0';
      const sp = vv.querySelector('span'); if (sp.textContent !== t) sp.textContent = t;
    });
  }

  /* ---------- Saisie ---------- */
  nets.addEventListener('click', e => {
    const more = e.target.closest('[data-pl="more"]'); if (more) { rungMenu(more, more.closest('[data-rung]').dataset.rung); return; }
    const s = e.target.closest('[data-slot]'); if (s) { sel = { slot: JSON.parse(s.dataset.slot) }; paintSel(); return; }
    const b = e.target.closest('[data-el]'); if (b) { sel = { el: b.dataset.el }; paintSel(); }
  });
  nets.addEventListener('dblclick', e => { const b = e.target.closest('.plEl'); if (b) { const f = pal.querySelector('[data-f="v"], [data-f="a"]'); if (f) { f.focus(); f.select(); } } });
  function paintSel() {
    nets.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    if (sel && sel.el) { const b = nets.querySelector(`[data-el="${sel.el}"]`); if (b) b.classList.add('sel'); }
    if (sel && sel.slot) { for (const s of nets.querySelectorAll('[data-slot]')) if (s.dataset.slot === JSON.stringify(sel.slot)) s.classList.add('sel'); }
    renderPal();
  }
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.pl === 'drive') { commit(n => { n.drive = t.checked; }); return; }
    if (t.dataset.f === 'comment') { const id = t.closest('[data-rung]').dataset.rung; commit(n => { const r = n.rungs.find(x => x.id === id); if (r) r.comment = t.value.trim().slice(0, 80); }); return; }
    if (!pal.contains(t) || !t.dataset.f || !sel || !sel.el) return;
    const f = t.dataset.f, v = t.value;
    commit(n => {
      const loc = findEl(n, sel.el); if (!loc) return; const it = loc.list[loc.j];
      if (f === 't') { const nt = v; const d = defaults(nt); const keep = { id: it.id }; if (it.t === 'cmp' || nt === 'cmp') Object.assign(keep, d); else { keep.v = it.v; if (TIMERS.has(nt)) keep.pt = it.pt ?? d.pt; if (COUNTERS.has(nt)) { keep.pv = it.pv ?? d.pv; keep.r = it.r ?? ''; } } loc.list[loc.j] = { t: nt, ...keep }; return; }
      if (f === 'v' || f === 'a' || f === 'r') { const s = v.trim(); if (s && !SYM.test(s)) { api.status(tl('Nom invalide : lettres, chiffres et « _ », 16 au plus (a0, 1Y1, M1).'), 'warn'); return; } it[f] = s; return; }
      if (f === 'pt') it.pt = Math.max(0, +String(v).replace(',', '.') || 0);
      if (f === 'pv') it.pv = Math.max(0, Math.round(+v || 0));
      if (f === 'b') it.b = Math.round(+v || 0);
      if (f === 'op') it.op = OPS.includes(v) ? v : '>=';
    });
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.inp, .plComment')) { e.preventDefault(); e.target.blur(); return; }
    if (e.key === 'Enter' && e.target.matches('.gfNewIn')) {
      e.preventDefault(); const name = e.target.value.trim();
      if (!SYM.test(name) || g().inputs.some(x => x.name.toLowerCase() === name.toLowerCase())) { e.target.classList.add('err'); return; }
      commit(n => { n.inputs.push({ name, kind: 'push' }); });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.el && !e.target.matches('input, select, textarea')) { e.preventDefault(); e.stopPropagation(); removeSel(); return; }
    if (e.key === 'Escape' && sel) { sel = null; paintSel(); e.stopPropagation(); }
  });
  pal.addEventListener('mousedown', e => { if (!e.target.closest('input, select')) e.preventDefault(); }); // la sélection du réseau ne se perd pas
  el.addEventListener('click', async e => {
    const ins = e.target.closest('[data-ins]');
    if (ins) { insert(ins.dataset.ins); return; }
    const b = e.target.closest('[data-pl]'); if (!b || b.disabled) return;
    const what = b.dataset.pl, chip = b.closest('[data-name]');
    if (what === 'close') { close(); return; }
    if (what === 'vars') { showVars = !showVars; render(); return; }
    if (what === 'mb') { showMb = !showMb; render(); return; }
    if (what === 'mbgo') { await toggleModbus(); return; }
    if (what === 'xml') { await exportXml(); return; }
    if (what === 'addrung') { commit(n => { n.rungs.push(newRung()); }); const p = g(); sel = { slot: { rung: p.rungs[p.rungs.length - 1].id } }; paintSel(); return; }
    if (what === 'del') { removeSel(); return; }
    if (what === 'branch' && sel && sel.el) { commit(n => { const loc = findEl(n, sel.el); if (loc && loc.list[loc.j].t === 'par') loc.list[loc.j].branches.push([]); }); return; }
    if (what === 'kind' && chip) { commit(n => { const x = n.inputs.find(y => y.name === chip.dataset.name); if (x) x.kind = x.kind === 'switch' ? 'push' : 'switch'; }); return; }
    if (what === 'indel' && chip) { commit(n => { n.inputs = n.inputs.filter(y => y.name !== chip.dataset.name); }); return; }
    if (what === 'gen') { await generate(); }
  });
  /** Insère un élément (ou met l'élément choisi en dérivation) à l'endroit visé ; le nouvel élément est choisi. */
  function insert(t) {
    let newId = null;
    commit(n => {
      if (t === 'par') {
        if (!sel || !sel.el) return;
        const loc = findEl(n, sel.el); if (!loc || loc.list[loc.j].t === 'par') return;
        const it = loc.list[loc.j], par = { t: 'par', id: uid(), branches: [[it], []] }; loc.list[loc.j] = par; newId = { slot: { rung: loc.rungId, par: par.id, br: 1 } };
        return;
      }
      const { list, at } = target(n), it = { t, id: uid(), ...defaults(t) };
      list.splice(at, 0, it); newId = { el: it.id };
    });
    if (newId) { sel = newId; paintSel(); const f = pal.querySelector('[data-f="v"], [data-f="a"]'); if (f && !f.value) { f.focus(); } }
  }
  function removeSel() {
    if (!sel || !sel.el) return;
    const id = sel.el;
    commit(n => {
      const loc = findEl(n, id); if (!loc) return;
      loc.list.splice(loc.j, 1);
      // Dérivation vidée ou réduite à une branche : remise à plat.
      if (loc.par) { loc.par.branches = loc.par.branches.filter(b => b.length || loc.par.branches.length <= 2); const pl = findEl(n, loc.par.id); if (pl) { const live = loc.par.branches.filter(b => b.length); if (!live.length) pl.list.splice(pl.j, 1); else if (loc.par.branches.length === 1) pl.list.splice(pl.j, 1, ...loc.par.branches[0]); } }
    });
    sel = null; paintSel();
  }
  async function rungMenu(anchor, id) {
    const p = g(), i = p.rungs.findIndex(r => r.id === id);
    const v = await popMenu(anchor, [
      { label: tl('Insérer un réseau au-dessus'), icon: 'plus', value: 'above' }, { label: tl('Insérer un réseau en dessous'), icon: 'plus', value: 'below' },
      { label: tl('Dupliquer'), icon: 'copy', value: 'dup' }, '-',
      ...(i > 0 ? [{ label: tl('Monter'), icon: 'chevUp', value: 'up' }] : []), ...(i < p.rungs.length - 1 ? [{ label: tl('Descendre'), icon: 'chevDown', value: 'down' }] : []),
      '-', { label: tl('Supprimer le réseau'), icon: 'trash', value: 'del', danger: true }]);
    if (!v) return;
    commit(n => {
      const j = n.rungs.findIndex(r => r.id === id); if (j < 0) return;
      if (v === 'above') n.rungs.splice(j, 0, newRung());
      if (v === 'below') n.rungs.splice(j + 1, 0, newRung());
      if (v === 'dup') { const c = clone(n.rungs[j]); c.id = uid(); const go = l => l.forEach(it => { it.id = uid(); if (it.t === 'par') it.branches.forEach(go); }); go(c.items); n.rungs.splice(j + 1, 0, c); }
      if (v === 'up' && j > 0) { const [r] = n.rungs.splice(j, 1); n.rungs.splice(j - 1, 0, r); }
      if (v === 'down' && j < n.rungs.length - 1) { const [r] = n.rungs.splice(j, 1); n.rungs.splice(j + 1, 0, r); }
      if (v === 'del') n.rungs.splice(j, 1);
    });
    if (v === 'del') { sel = null; paintSel(); }
  }
  /** Ladder écrit d'après le GRAFCET : remplace le programme (annulable) ; le GRAFCET passe en observation. */
  async function generate() {
    const r = api.fromGrafcet();
    if (r.error) { toast(r.error, 'warn', 8000); return; }
    if (g().rungs.length && !(await confirmDlg(tl('Écrire le Ladder d’après le GRAFCET'), tl('Le programme actuel ({0} réseaux) sera remplacé (Ctrl+Z pour revenir). Le GRAFCET passera en observation : c’est l’automate qui commandera les électrovannes.', g().rungs.length), tl('Remplacer')))) return;
    api.set(cleanPlc(r.plc)); if (api.grafcetDrive) api.grafcetDrive(false);
    sel = null; render();
    toast([tl('{0} réseaux écrits : un bit par étape, un réseau par transition (S et R), un par action.', r.plc.rungs.length), ...r.notes].join(' '), 'ok', 8000);
  }
  // Pupitre : bouton poussoir appuyé tant que le clic est maintenu ; interrupteur à chaque clic.
  let held = null;
  pup.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-press]'); if (!b || b.disabled || e.button !== 0) return;
    const x = g().inputs.find(y => y.name === b.dataset.press); if (!x) return;
    e.preventDefault();
    if (x.kind === 'switch') api.press(x.name, !api.pressed(x.name)); else { api.press(x.name, true); held = x.name; }
    live();
  });
  addEventListener('pointerup', () => { if (held) { api.press(held, false); held = null; live(); } }, true);

  /* ---------- Modbus TCP : l'automate en réseau (src/plc/modbus.js, src-tauri/src/modbus.rs) ---------- */
  // Le serveur continue quand le panneau se ferme ; il s'arrête avec l'application ou par son bouton.
  let snap = { p: null, k: '', vars: [] };
  function snapshot() {
    const p = g(), K = api.known ? api.known() : {}, k = JSON.stringify([K.inputs, K.outputs, K.steps ? [...K.steps] : null]);
    if (snap.p !== p || snap.k !== k) snap = { p, k, vars: lintPlc(compilePlc(p), K).vars };
    return { vars: snap.vars, inputs: p.inputs, live: api.live(), pressed: api.pressed };
  }
  const mb = isTauri() ? createModbusLink({
    snapshot,
    press: (n, v) => { if (api.sim()) { api.press(n, v); live(); } },
    changed: () => { const d = el.querySelector('.plMbDot'); if (d) d.hidden = !mb.state().on; renderMb(); }
  }) : null;
  const MB_PORT = 'jollof-modbus-port';
  const mbPort = () => { try { const v = +localStorage.getItem(MB_PORT); return v >= 1 && v <= 65535 ? v : 5020; } catch (e) { return 5020; } };
  const ROLE = { in: () => tl('entrée'), out: () => tl('sortie'), mem: () => tl('mémoire'), pupitre: () => tl('bouton du pupitre'), timer: () => tl('temps écoulé (0,1 s)'), counter: () => tl('valeur du compteur'), sys: () => tl('système') };
  function renderMb() {
    mbBox.hidden = !showMb || !mb; if (mbBox.hidden) return;
    const st = mb.state(), m = mb.map();
    const where = st.on ? `${st.info.lan ? (st.info.ip || tl('cet ordinateur')) : '127.0.0.1'}:${st.info.port}` : '';
    const row = (table, e) => `<tr data-mbv="${esc(e.name.toLowerCase())}" data-k="${esc(e.cls)}" data-name="${esc(e.name)}"><td class="plVA">${table} ${e.addr}</td><td class="plVN">${esc(e.name)}</td><td class="plVC">${ROLE[e.cls] ? ROLE[e.cls]() : e.cls}${e.rw ? ` · <b>${tl('écriture')}</b>` : ''}</td><td class="plVV"><i></i><span></span></td></tr>`;
    const rows = [...m.di.map(e => row(tl('Entrée TOR'), e)), ...m.coils.map(e => row(tl('Bobine'), e)), ...m.ir.map(e => row(tl('Registre'), e))].join('');
    mbBox.innerHTML = `<div class="plMbHead"><b>${tl('Serveur Modbus TCP')}</b><span class="plMbState ${st.on ? 'on' : ''}">${st.on ? tl('en écoute sur {0}', where) : tl('arrêté')}</span></div>
      <div class="plMbRow"><label class="plF"><span>${tl('Port')}</span><input class="inp plNum" data-mb="port" type="number" min="1" max="65535" value="${st.on ? st.info.port : mbPort()}"${st.on ? ' disabled' : ''}></label>
        <label class="plMbLan"><input type="checkbox" data-mb="lan"${st.on && st.info.lan ? ' checked' : ''}${st.on ? ' disabled' : ''}><span>${tl('Réseau local')}</span></label><span class="grow"></span>
        <button type="button" class="btn small${st.on ? '' : ' primary'}" data-pl="mbgo">${icon(st.on ? 'stop' : 'play')}<span>${st.on ? tl('Arrêter') : tl('Démarrer')}</span></button></div>
      <p class="plMbNote">${st.error ? `<span class="err">${esc(st.error)}</span>` : st.on && st.info.lan ? tl('Ouvert au réseau local : Modbus n’a pas de mot de passe, tout appareil du réseau peut lire l’automate et appuyer sur les boutons du pupitre.') : tl('Unité 1, ou toute autre. Les clients lisent les entrées, sorties, mémoires, temporisations et compteurs ; ils n’écrivent que les boutons du pupitre, pendant la simulation.')}</p>
      ${m.skipped.length ? `<p class="plMbNote">${tl('Sans adresse Modbus : {0}.', esc(m.skipped.join(', ')))}</p>` : ''}
      <table><thead><tr><th>${tl('Adresse')}</th><th>${tl('Nom')}</th><th>${tl('Rôle')}</th><th>${tl('État')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  async function toggleModbus() {
    if (!mb) return;
    if (mb.state().on) { await mb.stop(); api.status(tl('Serveur Modbus arrêté.')); return; }
    const port = Math.round(+mbBox.querySelector('[data-mb="port"]').value || 0), lan = mbBox.querySelector('[data-mb="lan"]').checked;
    if (!(port >= 1 && port <= 65535)) { api.status(tl('Port invalide (1 à 65535).'), 'warn'); return; }
    try { localStorage.setItem(MB_PORT, String(port)); } catch (e) { /* stockage indisponible */ }
    try { const r = await mb.start(port, lan); api.status(tl('Serveur Modbus TCP en écoute sur le port {0}.', r.port), 'ok'); } catch (e) { api.status(tl('Modbus : {0}', String(e && e.message || e)), 'warn'); }
  }

  /* ---------- Export PLCopen XML : le même programme dans un vrai automate ---------- */
  async function exportXml() {
    analyse();
    const p = g(), nErr = C.errors.length + L.diags.filter(d => d.level === 'error').length;
    if (!p.rungs.length) { toast(tl('Programme vide : rien à exporter.'), 'warn'); return; }
    if (nErr) { toast(tl('Corrigez d’abord les erreurs du programme ({0}) : un programme en erreur ne s’exporte pas.', nErr), 'warn', 6000); return; }
    try {
      const r = await plcExportXml(clone(p), L.vars.map(v => ({ name: v.name, cls: v.cls, addr: v.addr || '' })));
      const path = await saveFile(new Blob([r.xml], { type: 'application/xml' }), `${p.name || 'API1'}.xml`, tl('PLCopen XML'), 'xml');
      if (path) toast([tl('Programme exporté en PLCopen XML : importez-le dans CODESYS, OpenPLC Editor ou Beremiz.'), ...r.notes].join(' '), 'ok', 9000);
    } catch (e) { toast(tl('Export impossible : {0}', String(e && e.message || e)), 'warn', 8000); }
  }

  function open() { const was = !el.hidden; el.hidden = false; host.classList.add('plOpen'); render(); if (!was && api.opened) api.opened(); }
  function close() { el.hidden = true; host.classList.remove('plOpen'); if (api.closed) api.closed(); }
  return { el, open, close, isOpen: () => !el.hidden, render, live };
}
