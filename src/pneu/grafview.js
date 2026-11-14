// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pneumatique : le panneau GRAFCET du plan de travail. Le GRAFCET se lit et s'écrit au même endroit : chaque étape
// (son numéro dans un carré, double pour l'étape initiale) et ses actions à droite, sous elle sa transition et sa
// réceptivité ; une transition qui ne mène pas à l'étape suivante (retour à l'étape initiale…) est tracée par une
// liaison sur la gauche, flèche vers le haut. Une étape peut avoir des transitions en plus (« ou », divergence en OU),
// notées par un renvoi « → X1 ». Les branches parallèles (divergence et convergence en ET) sont côte à côte entre
// deux traits doubles ; une macro-étape (M5, carré barré en haut et en bas) a son expansion dessinée sous le GRAFCET,
// de son étape d'entrée E à son étape de sortie S. Pendant la simulation, les étapes actives portent leur jeton, les
// actions émises et les réceptivités vraies s'allument, et le pupitre (dcy…) se manipule à la souris.
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { menu as popMenu } from '../school/ui.js';
import { parseReceptivity, parseActions, INPUT_NAME, PART_NAME, newGrafcet, kindOf, walkItems, walkAll, rootsOf, locate, cmpOf } from './grafcet.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = g => JSON.parse(JSON.stringify(g));
const blank = n => ({ n, init: false, act: '', r: '', to: null, alt: [] });
/** Numéro de la première étape d'un élément (une étape, une macro-étape, ou la 1re branche d'un bloc parallèle). */
const firstN = it => (kindOf(it) === 'par' ? firstN(it.par[0][0]) : it.n);
/**
 * Liste désignée par son chemin : '' (principale), « P0: » (premier GRAFCET partiel), « 2/0 » (1re branche du bloc
 * 2), « 3/e » (expansion de M3), « 4/c » (encapsulation de X4).
 */
function listAt(g, sp) {
  const m = /^P(\d+):(.*)$/.exec(sp), rest = m ? m[2] : sp;
  if (rest === '') return m ? g.parts[+m[1]].steps : g.steps;
  const segs = rest.split('/'), it = locate(g, (m ? `P${m[1]}:` : '') + segs.slice(0, -1).join('/')).item, k = segs[segs.length - 1];
  return k === 'e' ? it.exp : k === 'c' ? it.enc : it.par[+k];
}
/** Après une suppression : branches vides retirées, bloc d'une seule branche remis à plat, macro-étape sans expansion redevenue étape. */
function normalize(list) {
  for (let j = 0; j < list.length; j++) {
    const it = list[j], k = kindOf(it);
    if (k === 'par') {
      it.par.forEach(normalize); it.par = it.par.filter(b => b.length);
      if (it.par.length === 0) { list.splice(j, 1); j--; } else if (it.par.length === 1) { list.splice(j, 1, ...it.par[0]); j--; }
    } else if (k === 'macro') {
      normalize(it.exp);
      if (!it.exp.length) list[j] = { n: it.n, init: it.init, act: '', r: it.r, to: it.to, alt: it.alt || [] };
    } else if (it.enc) { normalize(it.enc); if (!it.enc.length) delete it.enc; }
  }
}
/** Renumérotation dans les situations de forçage : « F/G1:{3,4} ». */
const renameSit = (s, a, b) => String(s || '').replace(/\{([^}]*)\}/g, (m, body) => `{${body.replace(/\d+/g, d => (+d === a ? String(b) : d))}}`);
/** Renomme la variable d'étape Xold en Xnew dans une réceptivité ou une condition (X3, 2s/X3, t/X3/2s). */
const renameX = (s, a, b) => String(s || '').replace(new RegExp(`\\bX${a}\\b`, 'gi'), `X${b}`);

const fmtS = v => String(Math.round(v * 10) / 10).replace('.', ',');
/** Temporisations d'une réceptivité : « 5s/X2 », « t/X2/5s », « 500ms/X3 » → [{ n: 2, s: 5 }]. */
export function timersIn(src) {
  const out = [], sec = (d, u) => parseFloat(String(d).replace(',', '.')) / (/^ms$/i.test(u) ? 1000 : 1);
  String(src || '')
    .replace(/\bt\s*\/\s*X\s*(\d+)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(ms|s)\b/gi, (_, n, d, u) => { out.push({ n: +n, s: sec(d, u) }); return ' '; })
    .replace(/(\d+(?:[.,]\d+)?)\s*(ms|s)\s*\/\s*X\s*(\d+)/gi, (_, d, u, n) => { out.push({ n: +n, s: sec(d, u) }); return ' '; });
  return out;
}
const CMP_TXT = { eq: '=', ne: '≠', lt: '<', le: '≤', gt: '>', ge: '≥' };
/** Lecture en clair d'une réceptivité (« dcy ET a0 », « 5 s après l'activation de X2 »), ou null si elle est illisible. */
export function readReceptivity(src) {
  const r = parseReceptivity(src); if (r.error) return null; if (!r.expr) return tl('vide : la transition n’est jamais franchie');
  const say = (e, parent) => {
    let s;
    if (e.op === 'const') return e.v ? tl('toujours vrai') : tl('jamais vrai');
    if (e.op === 'var') {
      const l = e.name; let m;
      if ((m = /^__t_(\d+)_(\d+)$/i.exec(l))) return tl('{0} s après l’activation de X{1}', fmtS(+m[2] / 1000), m[1]);
      if ((m = /^__up_(.+)$/i.exec(l))) return tl('front montant de {0}', m[1]);
      if ((m = /^__dn_(.+)$/i.exec(l))) return tl('front descendant de {0}', m[1]);
      const q = cmpOf(l); if (q) return `${q.name} ${CMP_TXT[q.op]} ${q.v}`;
      if ((m = /^x(\d+)$/i.exec(l))) return tl('X{0} active', m[1]);
      return l;
    }
    if (e.op === 'not') return tl('NON {0}', say(e.a, 'not'));
    s = `${say(e.a, e.op)} ${e.op === 'and' ? tl('ET') : e.op === 'or' ? tl('OU') : tl('OU exclusif')} ${say(e.b, e.op)}`;
    return parent && parent !== e.op ? `(${s})` : s;
  };
  return say(r.expr, null);
}

/**
 * host : le plan de travail pneumatique. api : { get() → GRAFCET ou null, set(g) (modification annulable),
 * sim() → simulation en cours ?, live() → { X: Set, macros: Set des macro-étapes actives, rec: [vrai/faux par
 * transition compilée], trans: transitions compilées, vars: [[nom, valeur]] } ou null, press(nom, appuyé),
 * pressed(nom), code(), opened(), closed(), names() → { sensors, coils } (repères du circuit, pour la palette) }.
 */
export function createGrafcetPanel(host, api) {
  const el = document.createElement('aside');
  el.className = 'gfPanel glass'; el.hidden = true; el.setAttribute('aria-label', 'GRAFCET');
  el.innerHTML = `<header class="gfHead"><b>${icon('list')}GRAFCET</b><span class="gfMode"></span><span class="grow"></span>
      <button type="button" class="tb" data-gf="code" data-tip="${tl('Écrire le programme Arduino de ce GRAFCET')}" aria-label="${tl('Programme Arduino')}">${icon('code')}</button>
      <button type="button" class="tb" data-gf="close" aria-label="${tl('Fermer le GRAFCET')}">${icon('x')}</button></header>
    <div class="gfPupitre"></div>
    <div class="gfScroll"><div class="gfChart"></div><svg class="gfLanes" aria-hidden="true"></svg></div>
    <footer class="gfFoot"><div class="gfPal" aria-label="${tl('Palette : noms et opérateurs à insérer')}"></div><label class="gfDrive"><input type="checkbox" data-gf="drive"><span>${tl('Le GRAFCET commande les électrovannes')}</span></label></footer>`;
  host.appendChild(el);
  const chart = el.querySelector('.gfChart'), lanes = el.querySelector('.gfLanes'), pup = el.querySelector('.gfPupitre'), pal = el.querySelector('.gfPal');
  let lastRec = null, jumps = []; // dernier champ choisi (réceptivité ou actions : la palette y insère) ; liaisons à tracer

  const g = () => api.get() || newGrafcet();
  const commit = fn => { const n = clone(g()); fn(n); api.set(n); };
  const numbers = G => { const s = []; walkAll(G, it => { if (kindOf(it) !== 'par') s.push(it.n); }); return s; };
  /** Bouton « ⋯ » d'une étape ou d'un bloc : ses commandes dans un menu (rien ne recouvre les champs). */
  const more = (gf, tip, extra = '') => `<button type="button" class="tb gfMore" data-gf="${gf}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${extra}>${icon('dots')}</button>`;

  /* ---------- Dessin ---------- */
  /** Une liste d'éléments (principale : loop, la dernière transition revient au début ; branche ; expansion). */
  function seqHtml(G, list, base, ctx) {
    const sp = base.replace(/\/$/, '');
    let h = list.map((it, j) => itemHtml(G, list, j, base, ctx)).join('');
    h += ctx.loop ? `<div class="gfAdd"><button type="button" class="btn subtle small" data-gf="add" data-seq="${sp}">${icon('plus')}<span>${tl('Ajouter une étape')}</span></button></div>`
      : `<div class="gfRow gfFill"><div class="gfCol"></div><button type="button" class="tb gfAddIn" data-gf="add" data-seq="${sp}" data-tip="${tl('Ajouter une étape à la fin')}" aria-label="${tl('Ajouter une étape à la fin')}">${icon('plus')}</button></div>`;
    return h;
  }
  function itemHtml(G, list, j, base, ctx) {
    const it = list[j], path = base + j, k = kindOf(it), last = j === list.length - 1, hasT = !(last && !ctx.loop);
    const natural = j + 1 < list.length ? firstN(list[j + 1]) : ctx.loop ? firstN(list[0]) : null;
    const prev = j > 0 ? list[j - 1] : null, prevJump = prev && prev.to != null && prev.to !== firstN(it);
    const noTop = (j === 0 && !ctx.branch) || prevJump;
    let h = '';
    if (k === 'par') {
      h += `<div class="gfPar${noTop ? ' noTop' : ''}" data-path="${path}"><div class="gfDbl"></div><div class="gfBranches">${it.par.map((b, bi) => `<div class="gfBranch" data-path="${path}/${bi}">${seqHtml(G, b, `${path}/${bi}/`, { branch: true })}</div>`).join('')}</div><div class="gfDbl"></div></div>`;
      // Bloc en fin de branche (pas de convergence à lui) : son menu sur une ligne à part.
      if (!hasT) h += `<div class="gfRow gfParFoot" data-path="${path}"><div class="gfCol"></div><span class="grow"></span>${more('parmore', tl('Bloc parallèle'))}</div>`;
    } else {
      const macro = k === 'macro', badge = ctx.exp ? (j === 0 ? 'E' : last ? 'S' : '') : ctx.enc && it.init ? '*' : '';
      h += `<div class="gfRow gfStepRow${noTop ? ' noTop' : ''}${macro ? ' gfMacroRow' : ''}" data-path="${path}">
        <div class="gfCol"><div class="gfStep${it.init && !ctx.enc ? ' init' : ''}${macro ? ' gfMacro' : ''}${it.enc ? ' gfEncl' : ''}" data-step="${it.n}">${macro ? '<i class="gfM">M</i>' : ''}<input class="gfNum" data-f="n" value="${it.n}" inputmode="numeric" maxlength="3" aria-label="${tl('Numéro de l’étape')}">${badge ? `<i class="gfBadge">${badge}</i>` : ''}</div></div>
        <span class="gfHook"></span>${macro ? `<span class="gfMacroNote">${tl('macro-étape : expansion ci-dessous')}</span>` : `<input class="gfIn gfAct" data-f="act" value="${esc(it.act)}" placeholder="${tl('actions (1Y1, 2Y1…)')}" spellcheck="false" aria-label="${tl('Actions de l’étape {0}', it.n)}">`}
        ${more('more', tl('Étape {0} : initiale, insérer, branches, macro-étape, supprimer', it.n), ` data-t="${hasT ? 1 : 0}"`)}</div>`;
      if (it.enc) h += `<div class="gfRow gfEnclNote" data-path="${path}"><div class="gfCol"></div><span>${tl('encapsule : voir « Encapsulation de X{0} » ci-dessous', it.n)}</span></div>`;
    }
    if (hasT) {
      const target = it.to ?? natural, jump = it.to != null && it.to !== natural || (last && ctx.loop);
      if (jump) jumps.push({ path, to: target });
      const label = last && ctx.loop ? `↺ X${natural}` : `↓ X${natural}`;
      const nums = numbers(G);
      h += `<div class="gfRow gfTrRow${jump ? ' jump' : ''}${k === 'par' ? ' gfConv' : ''}" data-path="${path}">
        <div class="gfCol"><span class="gfBar"></span></div>
        <input class="gfIn gfR" data-f="r" value="${esc(it.r)}" placeholder="${k === 'par' ? tl('réceptivité de la convergence (=1…)') : tl('réceptivité (dcy . a0…)')}" spellcheck="false" aria-label="${tl('Réceptivité')}">
        <select class="gfTo" data-f="to" aria-label="${tl('Étape suivante')}"><option value=""${it.to == null ? ' selected' : ''}>${esc(label)}</option>${nums.map(n => `<option value="${n}"${it.to === n ? ' selected' : ''}>→ X${n}</option>`).join('')}</select>${k === 'par' ? more('parmore', tl('Bloc parallèle')) : ''}</div>`;
      h += timerRows(it.r, jump, path, -1);
      (it.alt || []).forEach((t, ai) => {
        h += `<div class="gfRow gfAltRow" data-path="${path}" data-k="${ai}"><div class="gfCol"><span class="gfOr">${tl('ou')}</span></div>
          <input class="gfIn gfR" data-f="ar" data-k="${ai}" value="${esc(t.r)}" placeholder="${tl('réceptivité')}" spellcheck="false">
          <select class="gfTo" data-f="ato" data-k="${ai}">${nums.map(n => `<option value="${n}"${t.to === n ? ' selected' : ''}>→ X${n}</option>`).join('')}</select>
          <button type="button" class="tb" data-gf="altdel" data-k="${ai}" aria-label="${tl('Retirer cette transition')}">${icon('x')}</button></div>`;
        h += timerRows(t.r, true, path, ai);
      });
    }
    return h;
  }
  /**
   * Temporisation d'une réceptivité, dessinée sous sa transition : un chronomètre, le retard et l'étape qu'il suit ;
   * pendant la simulation, la barre se remplit et le temps écoulé s'affiche (voir live).
   */
  function timerRows(src, jump, path, k) {
    return timersIn(src).map(t => `<div class="gfRow gfTimerRow${jump ? ' jump' : ''}" data-path="${path}" data-k="${k}"><div class="gfCol"></div><span class="gfTimer" data-tn="${t.n}" data-ts="${t.s}" title="${esc(tl('Temporisation : vraie {0} s après l’activation de l’étape {1}', fmtS(t.s), t.n))}">${icon('clock')}<b>${fmtS(t.s)} s</b><small>${tl('après X{0}', t.n)}</small><i class="gfTBar"><i></i></i><em></em></span></div>`).join('');
  }
  /** Expansions des macro-étapes et encapsulations des étapes encapsulantes, sous le GRAFCET (tous GRAFCET partiels). */
  function expansionsHtml(G) {
    let h = '';
    const visit = (list, base) => list.forEach((it, j) => {
      const path = base + j, k = kindOf(it);
      if (k === 'par') it.par.forEach((b, bi) => visit(b, `${path}/${bi}/`));
      if (k === 'macro') {
        h += `<section class="gfExp" data-macro="${it.n}"><h4>${tl('Expansion de M{0}', it.n)}</h4>${seqHtml(G, it.exp, `${path}/e/`, { exp: true })}</section>`;
        visit(it.exp, `${path}/e/`);
      }
      if (it.enc) {
        h += `<section class="gfExp gfEnc" data-encl="${it.n}"><h4>${tl('Encapsulation de X{0}', it.n)} <small>${tl('* : activée avec X{0}', it.n)}</small></h4>${seqHtml(G, it.enc, `${path}/c/`, { loop: true, enc: true })}</section>`;
        visit(it.enc, `${path}/c/`);
      }
    });
    visit(G.steps, '');
    (G.parts || []).forEach((p, k) => visit(p.steps, `P${k}:`));
    return h;
  }
  /** En-tête d'un GRAFCET partiel : son nom (modifiable), « forcé » pendant un forçage, son menu. */
  const partHead = (name, k) => `<div class="gfPartHead" data-name="${esc(name)}"><span>${k < 0 ? 'GRAFCET' : tl('GRAFCET partiel')}</span><input class="gfPName" data-f="pname" data-part="${k}" value="${esc(name)}" maxlength="12" spellcheck="false" aria-label="${tl('Nom du GRAFCET partiel')}"><i class="gfForced" hidden>${tl('forcé')}</i><span class="grow"></span>${k >= 0 ? `<button type="button" class="tb gfMore" data-gf="partmore" data-part="${k}" aria-label="${tl('GRAFCET partiel {0}', name)}">${icon('dots')}</button>` : ''}</div>`;
  function render() {
    if (el.hidden) return;
    const G = g(), sim = api.sim();
    // Le champ en cours de saisie garde le focus après la reconstruction.
    const a = document.activeElement, row = a && el.contains(a) && a.dataset.f ? a.closest('[data-path]') : null;
    const keep = row ? { f: a.dataset.f, path: row.dataset.path, k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd } : null;
    el.querySelector('[data-gf="drive"]').checked = G.drive !== false;
    el.querySelector('.gfMode').textContent = G.drive !== false ? tl('commande') : tl('observation');
    jumps = [];
    const parts = G.parts || [];
    chart.innerHTML = (parts.length ? partHead(G.name || 'G1', -1) : '') + seqHtml(G, G.steps, '', { loop: true })
      + parts.map((p, k) => `<section class="gfPart">${partHead(p.name, k)}${seqHtml(G, p.steps, `P${k}:`, { loop: true })}</section>`).join('')
      + expansionsHtml(G)
      + `<div class="gfAdd gfAddPart"><button type="button" class="btn subtle small" data-gf="addpart">${icon('plus')}<span>${tl('Ajouter un GRAFCET partiel (sécurité, forçage…)')}</span></button></div>`;
    renderPupitre(sim);
    validate();
    requestAnimationFrame(layout);
    if (keep) {
      const f = [...chart.querySelectorAll(`[data-path="${keep.path}"] [data-f="${keep.f}"]`)].find(x => keep.k == null || x.dataset.k === keep.k);
      if (f) { f.focus(); try { if (keep.s != null) f.setSelectionRange(keep.s, keep.e); } catch (e) { /* liste */ } }
    }
    live();
  }
  /** Après mise en page : traits doubles des blocs parallèles (d'une branche à l'autre), liaisons des sauts. */
  function layout() {
    const box = chart.getBoundingClientRect();
    chart.querySelectorAll('.gfPar').forEach(p => {
      const cols = [...p.querySelectorAll(':scope > .gfBranches > .gfBranch > .gfRow:first-child .gfCol, :scope > .gfBranches > .gfBranch > .gfPar:first-child')], pb = p.getBoundingClientRect();
      if (!cols.length) return;
      const xs = cols.map(c => { const r = c.getBoundingClientRect(); return c.classList.contains('gfPar') ? r.left + 32 : r.left + r.width / 2; });
      const l = Math.min(...xs) - pb.left - 6, w = Math.max(...xs) - Math.min(...xs) + 12;
      p.querySelectorAll(':scope > .gfDbl').forEach(d => { d.style.marginLeft = `${l}px`; d.style.width = `${w}px`; });
    });
    lanes.setAttribute('width', box.width); lanes.setAttribute('height', chart.scrollHeight);
    lanes.setAttribute('viewBox', `0 0 ${box.width} ${chart.scrollHeight}`);
    let d = '', arrows = '', lane = 0;
    for (const j of jumps) {
      const tr = chart.querySelector(`.gfTrRow[data-path="${j.path}"] .gfBar`);
      const st = chart.querySelector(`.gfStep[data-step="${j.to}"]`) || chart.querySelector('.gfStep');
      if (!tr || !st) continue;
      const b = tr.getBoundingClientRect(), t = st.getBoundingClientRect();
      const cx = b.left + b.width / 2 - box.left, tx = t.left + t.width / 2 - box.left, y0 = b.top + b.height / 2 - box.top + 10, yt = t.top - box.top, lx = 9 + (lane++ % 3) * 6;
      d += `M${cx} ${y0 - 10} L${cx} ${y0} L${lx} ${y0} L${lx} ${yt - 8} L${tx} ${yt - 8} L${tx} ${yt} `;
      const my = (y0 + yt - 8) / 2, up = yt < y0;
      arrows += `<path class="gfArrow" d="M${lx - 4} ${my + (up ? 4 : -4)} L${lx} ${my + (up ? -3 : 3)} L${lx + 4} ${my + (up ? 4 : -4)}"/>`;
    }
    lanes.innerHTML = `<path class="gfLane" d="${d}"/>${arrows}`;
  }
  /** Pupitre : les boutons du GRAFCET (appuyer pendant la simulation), et l'état de ses capteurs. */
  function renderPupitre(sim) {
    const G = g();
    const chips = G.inputs.map(x => `<span class="gfInput" data-name="${esc(x.name)}"><button type="button" class="gfPress${x.kind === 'switch' ? ' sw' : ''}" data-press="${esc(x.name)}"${sim ? '' : ' disabled'} aria-pressed="${!!api.pressed(x.name)}" title="${x.kind === 'switch' ? tl('Interrupteur : un clic le ferme, un autre l’ouvre') : tl('Bouton poussoir : maintenez le clic')}">${esc(x.name)}</button>${sim ? '' : `<button type="button" class="tb gfKind" data-gf="kind" data-tip="${x.kind === 'switch' ? tl('Interrupteur (cliquer : bouton poussoir)') : tl('Bouton poussoir (cliquer : interrupteur)')}">${icon(x.kind === 'switch' ? 'toggle' : 'pointer')}</button><button type="button" class="tb" data-gf="indel" aria-label="${tl('Retirer {0}', x.name)}">${icon('x')}</button>`}</span>`).join('');
    pup.innerHTML = `<span class="gfLbl">${tl('Pupitre')}</span>${chips}${sim ? '<span class="gfVars"></span>' : `<input class="gfNewIn" placeholder="${tl('+ entrée')}" maxlength="12" spellcheck="false" aria-label="${tl('Nouvelle entrée du pupitre')}">`}`;
  }
  /** Erreurs de saisie, champ par champ (sans attendre la vérification du circuit). */
  function validate() {
    chart.querySelectorAll('.gfR').forEach(i => { const r = parseReceptivity(i.value); i.classList.toggle('err', !!r.error); i.title = r.error ? tl('Réceptivité illisible : {0}', r.error) : ''; });
    chart.querySelectorAll('.gfAct').forEach(i => { const r = parseActions(i.value); i.classList.toggle('err', r.errors.length > 0); i.title = r.errors.join(' · '); });
  }
  /** Simulation : jetons, actions émises, réceptivités vraies, boutons appuyés, capteurs. Ne reconstruit rien. */
  function live() {
    if (el.hidden) return;
    const L = api.live();
    el.classList.toggle('running', !!L);
    chart.querySelectorAll('.gfStep').forEach(s => { const n = +s.dataset.step; s.classList.toggle('on', !!L && (s.classList.contains('gfMacro') ? L.macros.has(n) : L.X.has(n))); });
    chart.querySelectorAll('.gfStepRow').forEach(r => { const st = r.querySelector('.gfStep'), act = r.querySelector('.gfAct'); if (act) act.classList.toggle('on', !!L && L.X.has(+st.dataset.step) && act.value.trim() !== ''); });
    const T = L ? L.trans : [];
    chart.querySelectorAll('.gfTrRow, .gfAltRow').forEach(r => {
      const k = r.dataset.k == null ? -1 : +r.dataset.k, at = T.findIndex(t => t.path === r.dataset.path && t.alt === k);
      const v = L && at >= 0 ? L.rec[at] : null;
      r.classList.toggle('true', v === true); r.classList.toggle('ready', v === true && T[at].from.every(n => L.X.has(n)));
    });
    // Temporisations : temps écoulé depuis l'activation de l'étape suivie (barre et texte).
    chart.querySelectorAll('.gfTimer').forEach(tm => {
      const n = +tm.dataset.tn, d = +tm.dataset.ts, act = !!L && L.X.has(n) && L.since && L.since.has(n);
      const t = act ? Math.max(0, Math.min(d, L.t - L.since.get(n))) : 0, done = act && t >= d - 1e-6;
      tm.classList.toggle('run', act && !done); tm.classList.toggle('done', done);
      tm.querySelector('.gfTBar > i').style.width = `${d ? (t / d) * 100 : 0}%`;
      const txt = act ? (done ? tl('écoulé') : `${fmtS(t)} s`) : '';
      const em = tm.querySelector('em'); if (em.textContent !== txt) em.textContent = txt;
    });
    pup.querySelectorAll('[data-press]').forEach(b => { const on = !!api.pressed(b.dataset.press); if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); });
    const vs = pup.querySelector('.gfVars');
    if (vs && L) { const h = L.vars.map(([n, v]) => `<i class="${v ? 'on' : ''}">${esc(n)}</i>`).join('') + (L.counters || []).map(([n, v]) => `<i class="gfCnt">${esc(n)} = ${v}</i>`).join(''); if (vs.dataset.h !== h) { vs.dataset.h = h; vs.innerHTML = h; } }
    // GRAFCET partiels forcés : leur en-tête le dit.
    chart.querySelectorAll('.gfPartHead').forEach(hd => { const f = !!L && !!L.forced && L.forced.has(hd.dataset.name); hd.classList.toggle('forced', f); hd.querySelector('.gfForced').hidden = !f; });
  }

  /* ---------- Saisie ---------- */
  el.addEventListener('input', e => { if (e.target.matches('.gfR, .gfAct')) { validate(); paintPal(); } });
  el.addEventListener('focusin', e => { if (e.target.matches('.gfR, .gfAct')) { lastRec = e.target; paintPal(); } });
  el.addEventListener('focusout', () => setTimeout(() => { if (!el.contains(document.activeElement) && !pal.contains(document.activeElement)) { lastRec = null; paintPal(); } }, 0));
  el.addEventListener('change', e => {
    if (e.target.dataset.gf === 'drive') { commit(n => { n.drive = e.target.checked; }); return; }
    if (e.target.dataset.f === 'pname') {
      // Nom d'un GRAFCET partiel : unique ; les ordres de forçage qui le visent suivent.
      const k = +e.target.dataset.part, v = e.target.value.trim();
      commit(n => {
        const cur = k < 0 ? n.name || 'G1' : n.parts[k].name, all = [n.name || 'G1', ...(n.parts || []).map(p => p.name)];
        if (!PART_NAME.test(v) || all.some(x => x.toLowerCase() === v.toLowerCase() && x !== cur)) return;
        if (k < 0) n.name = v; else n.parts[k].name = v;
        walkAll(n, x => { if (x.act) x.act = x.act.replace(new RegExp(`(F\\s*/\\s*)${cur}(\\s*:?\\s*\\{)`, 'gi'), `$1${v}$2`); });
      });
      return;
    }
    const f = e.target.dataset.f, row = e.target.closest('[data-path]'); if (!f || !row) return;
    const k = +e.target.dataset.k, v = e.target.value;
    commit(n => {
      const s = locate(n, row.dataset.path).item; if (!s) return;
      if (f === 'act') s.act = v.trim();
      else if (f === 'r') s.r = v.trim();
      else if (f === 'to') s.to = v === '' ? null : +v;
      else if (f === 'ar') s.alt[k].r = v.trim();
      else if (f === 'ato') s.alt[k].to = +v;
      else if (f === 'n') {
        const nv = parseInt(v, 10);
        if (!Number.isInteger(nv) || nv < 0 || nv > 999 || numbers(n).includes(nv)) return; // refusé : le dessin remet l'ancien
        const old = s.n; s.n = nv;
        walkAll(n, x => {
          if (x.to === old) x.to = nv;
          for (const a of x.alt || []) { if (a.to === old) a.to = nv; a.r = renameX(a.r, old, nv); }
          x.r = renameX(x.r, old, nv); if (x.act != null) x.act = renameSit(renameX(x.act, old, nv), old, nv);
        });
      }
    });
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.gfIn, .gfNum')) { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Enter' && e.target.matches('.gfNewIn')) {
      e.preventDefault(); const name = e.target.value.trim();
      if (!INPUT_NAME.test(name) || g().inputs.some(x => x.name.toLowerCase() === name.toLowerCase())) { e.target.classList.add('err'); return; }
      commit(n => { n.inputs.push({ name, kind: 'push' }); });
    }
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-gf]'), ins = e.target.closest('[data-ins]');
    if (ins) { insert(ins.dataset.ins, ins.dataset.kind); return; }
    if (e.target.closest('[data-tm]')) { const f = pal.querySelector('.gfTmForm'); const s = parseFloat(String(f.querySelector('input').value).replace(',', '.')); const n = f.querySelector('select').value; if (s > 0 && n !== '') insert(`${fmtS(s).replace(',', '.')}s/X${n}`, 'name'); return; }
    if (!b || b.disabled) return;
    const what = b.dataset.gf, row = b.closest('[data-path]'), path = row ? row.dataset.path : null, chip = b.closest('[data-name]');
    if (what === 'close') { close(); return; }
    if (what === 'code') { api.code(); return; }
    if (what === 'drive') return;
    if (what === 'more' || what === 'parmore') { openMenu(b, what, path); return; }
    if (what === 'partmore') { popMenu(b, [{ label: tl('Supprimer ce GRAFCET partiel'), icon: 'trash', value: 'partdel', danger: true }]).then(v => { if (v) apply('partdel', null, null, +b.dataset.part, null); }); return; }
    apply(what, path, b.dataset.seq, +b.dataset.k, chip && chip.dataset.name);
  });

  /* ---------- Palette : ce qu'on peut écrire dans le champ choisi ---------- */
  /** Étape « amont » d'une transition (celle que suit sa temporisation par défaut). */
  const stepOfField = f => { const row = f && f.closest('[data-path]'); if (!row) return null; const it = locate(g(), row.dataset.path).item; return it && kindOf(it) !== 'par' ? it.n : null; };
  function paintPal() {
    const f = lastRec && el.contains(lastRec) ? lastRec : null;
    if (!f) { pal.innerHTML = `<p class="gfPalHint">${icon('info')}<span>${tl('Cliquez dans une réceptivité ou dans les actions d’une étape : les noms, opérateurs et temporisations à insérer apparaissent ici.')}</span></p>`; return; }
    const G = g(), nm = api.names ? api.names() : { sensors: [], coils: [] }, chip = (v, kind, tip = '', cls = '') => `<button type="button" class="gfChip${cls}" data-ins="${esc(v)}" data-kind="${kind}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(v)}</button>`;
    const group = (label, html) => (html ? `<div class="gfPalRow"><span>${label}</span><div>${html}</div></div>` : '');
    if (f.classList.contains('gfAct')) {
      pal.innerHTML = `<div class="gfPalHead"><b>${tl('Actions de l’étape')}</b><small>${tl('émises tant que l’étape est active ; séparez-les par des virgules')}</small></div>`
        + group(tl('Électrovannes'), nm.coils.map(c => chip(c, 'act')).join('') || `<small class="gfNone">${tl('aucune bobine dans le circuit')}</small>`)
        + group(tl('Mémoriser'), chip(':=1', 'op', tl('Mise à 1 mémorisée : la sortie reste à 1 après l’étape')) + chip(':=0', 'op', tl('Mise à 0 mémorisée')) + chip(' si ', 'op', tl('Action conditionnelle : « 1Y1 si p »')));
      return;
    }
    const steps = []; walkAll(G, it => { if (kindOf(it) !== 'par') steps.push(it.n); });
    const up = stepOfField(f), read = f.value.trim() ? readReceptivity(f.value) : null;
    pal.innerHTML = `<div class="gfPalHead"><b>${tl('Réceptivité')}</b><small>${tl('condition pour franchir la transition')}</small></div>`
      + group(tl('Pupitre'), G.inputs.map(x => chip(x.name, 'name', tl('Bouton du pupitre'))).join(''))
      + group(tl('Capteurs'), nm.sensors.map(s => chip(s, 'name')).join('') || `<small class="gfNone">${tl('aucun capteur de vérin ni pressostat')}</small>`)
      + group(tl('Logique'), chip(' . ', 'op', tl('ET : les deux conditions'), ' op') + chip(' + ', 'op', tl('OU : l’une ou l’autre'), ' op') + chip('/', 'op', tl('NON : « /a0 » se lit « a0 n’est pas actionné »'), ' op') + chip('↑', 'op', tl('Front montant : l’instant où le signal passe à 1'), ' op') + chip('↓', 'op', tl('Front descendant : l’instant où le signal passe à 0'), ' op') + chip('( )', 'paren', tl('Parenthèses'), ' op') + chip('=1', 'name', tl('Toujours vraie : la transition est franchie aussitôt'), ' op'))
      + `<div class="gfPalRow"><span>${icon('clock')}${tl('Temporisation')}</span><div class="gfTmForm"><input type="number" min="0.1" step="0.5" value="2" aria-label="${tl('Durée en secondes')}"><span>${tl('s après')}</span><select aria-label="${tl('Étape suivie')}">${steps.map(n => `<option value="${n}"${n === up ? ' selected' : ''}>X${n}</option>`).join('')}</select><button type="button" class="btn small primary" data-tm>${tl('Insérer')}</button></div></div>`
      + (f.value.trim() ? `<p class="gfRead${read ? '' : ' err'}">${read ? `${tl('Se lit :')} <b>${esc(read)}</b>` : tl('Réceptivité illisible : vérifiez les noms et les opérateurs.')}</p>` : '');
  }
  // La palette ne prend pas le focus : le curseur reste dans le champ.
  pal.addEventListener('mousedown', e => { if (!e.target.closest('input, select')) e.preventDefault(); });
  /** Insère v au curseur du champ choisi ; un nom collé à un autre est relié par « . » (réceptivité) ou « , » (actions). */
  function insert(v, kind) {
    const f = lastRec; if (!f || !el.contains(f)) return;
    const s = f.selectionStart ?? f.value.length, e2 = f.selectionEnd ?? s, before = f.value.slice(0, s), after = f.value.slice(e2);
    let t = v;
    if (kind === 'paren') { t = `(${f.value.slice(s, e2)})`; }
    else if ((kind === 'name' || kind === 'act') && /[\w)]\s*$/.test(before)) t = (f.classList.contains('gfAct') ? ', ' : ' . ') + v;
    if (kind === 'op' && t.trim() && /\s$/.test(before) && /^\s/.test(t)) t = t.trimStart();
    f.value = before + t + after;
    const caret = kind === 'paren' && s === e2 ? before.length + 1 : before.length + t.length;
    f.focus(); f.setSelectionRange(caret, caret);
    f.dispatchEvent(new Event('change', { bubbles: true })); // enregistré tout de suite (annulable), le focus reste
  }
  /** Menu d'une étape (initiale, « ou », insérer, branches, macro-étape, supprimer) ou d'un bloc parallèle. */
  async function openMenu(b, what, path) {
    const it = locate(g(), path).item; if (!it) return;
    let items;
    if (what === 'parmore') {
      items = [{ label: tl('Ajouter une branche'), icon: 'plus', value: ['branch'] },
        ...(it.par.length > 2 ? it.par.map((x, k) => ({ label: tl('Retirer la branche {0}', k + 1), icon: 'x', value: ['brdel', k] })) : []),
        '-', { label: tl('Supprimer le bloc parallèle'), icon: 'trash', value: ['del'], danger: true }];
    } else {
      const macro = kindOf(it) === 'macro', only = g().steps.length < 2 && !path.includes('/') && !path.startsWith('P');
      items = [{ label: it.init ? tl('Ne plus être une étape initiale') : tl('En faire une étape initiale'), icon: 'target', value: ['init'] },
        ...(b.dataset.t === '1' ? [{ label: tl('Ajouter une transition « ou » (divergence)'), icon: 'workflow', value: ['alt'] }] : []),
        { label: tl('Insérer une étape dessous'), icon: 'plus', value: ['ins'] },
        { label: tl('Insérer des branches parallèles dessous (divergence en ET)'), icon: 'sidebar', value: ['par'] },
        macro ? { label: tl('Redevenir une étape simple'), icon: 'box', value: ['unmacro'] } : { label: tl('En faire une macro-étape'), icon: 'layers', value: ['macro'] },
        ...(macro ? [] : [it.enc ? { label: tl('Retirer l’encapsulation'), icon: 'x', value: ['unencl'] } : { label: tl('En faire une étape encapsulante'), icon: 'frame', value: ['encl'] }]),
        ...(only ? [] : ['-', { label: tl('Supprimer l’étape'), icon: 'trash', value: ['del'], danger: true }])];
    }
    const v = await popMenu(b, items);
    if (v) apply(v[0], path, null, v[1], null);
  }
  /** Après une modification : structures vides retirées ; les transitions vers des étapes disparues reprennent l'élément suivant. */
  function tidy(n, before) {
    rootsOf(n).forEach(normalize);
    n.parts = (n.parts || []).filter(p => p.steps.length);
    if (!n.steps.length) n.steps.push({ ...blank(Math.max(-1, ...numbers(n)) + 1), init: true });
    const now = new Set(numbers(n)), gone = [...before].filter(x => !now.has(x));
    if (gone.length) walkAll(n, x => { if (gone.includes(x.to)) x.to = null; if (x.alt) x.alt = x.alt.filter(a => !gone.includes(a.to)); });
  }
  /** Une modification de la structure (annulable). */
  function apply(what, path, seq, k, chipName) {
    commit(n => {
      let next = Math.max(-1, ...numbers(n)) + 1;
      const fresh = () => blank(next++);
      const before = new Set(numbers(n));
      if (what === 'add') listAt(n, seq).push(fresh());
      if (what === 'kind' && chipName) { const x = n.inputs.find(y => y.name === chipName); if (x) x.kind = x.kind === 'switch' ? 'push' : 'switch'; }
      if (what === 'indel' && chipName) n.inputs = n.inputs.filter(y => y.name !== chipName);
      if (what === 'addpart') {
        const taken = new Set([n.name || 'G1', ...(n.parts || []).map(p => p.name)].map(x => x.toLowerCase()));
        let i = 2; while (taken.has(`g${i}`)) i++;
        (n.parts = n.parts || []).push({ name: `G${i}`, steps: [{ ...fresh(), init: true }] });
      }
      if (what === 'partdel') n.parts.splice(k, 1);
      if (path == null) { tidy(n, before); return; }
      const { list, j, item } = locate(n, path);
      if (!item) return;
      if (what === 'ins') list.splice(j + 1, 0, fresh());
      if (what === 'par') list.splice(j + 1, 0, { par: [[fresh()], [fresh()]], r: '', to: null });
      if (what === 'macro') { const e1 = { ...fresh(), act: item.act }, e2 = fresh(); list[j] = { n: item.n, macro: true, init: item.init, r: item.r, to: item.to, alt: item.alt || [], exp: [e1, e2] }; }
      if (what === 'unmacro') list[j] = { n: item.n, init: item.init, act: '', r: item.r, to: item.to, alt: item.alt || [] };
      if (what === 'init') item.init = !item.init;
      if (what === 'alt') (item.alt = item.alt || []).push({ r: '', to: firstN(n.steps[0]) });
      if (what === 'altdel') item.alt.splice(k, 1);
      if (what === 'branch') item.par.push([fresh()]);
      if (what === 'brdel') item.par.splice(k, 1);
      if (what === 'del') list.splice(j, 1);
      if (what === 'encl') item.enc = [{ ...fresh(), init: true }];
      if (what === 'unencl') delete item.enc;
      tidy(n, before);
    });
  }
  // Pupitre : un bouton poussoir est appuyé tant que le clic est maintenu ; un interrupteur change à chaque clic.
  let held = null;
  pup.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-press]'); if (!b || b.disabled || e.button !== 0) return;
    const x = g().inputs.find(y => y.name === b.dataset.press); if (!x) return;
    e.preventDefault();
    if (x.kind === 'switch') api.press(x.name, !api.pressed(x.name));
    else { api.press(x.name, true); held = x.name; }
    live();
  });
  addEventListener('pointerup', () => { if (held) { api.press(held, false); held = null; live(); } }, true);

  function open() { const was = !el.hidden; el.hidden = false; host.classList.add('gfOpen'); render(); paintPal(); if (!was && api.opened) api.opened(); }
  function close() { el.hidden = true; host.classList.remove('gfOpen'); if (api.closed) api.closed(); }
  return { el, open, close, isOpen: () => !el.hidden, render, live, relayout: () => { if (!el.hidden) layout(); } };
}
