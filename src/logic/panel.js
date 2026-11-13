// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Logique : les onglets de l'inspecteur. « Circuit » : l'élément choisi (propriétés, fiche, table de
// la porte) ou, sans sélection, les entrées, les sorties et les vérifications (entrées en l'air,
// conflits, oscillations). « Table » : table de vérité des entrées et sorties nommées, ligne en cours
// surlignée (cliquer une ligne règle les entrées), équations simplifiées, tableau de Karnaugh.
// « Chronogramme » : les signaux enregistrés pendant que le temps avance.
import { tl, DEC } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { DEFS, CATS, propsOf, layoutOf, isInput, isOutput, pinKeys, fmtValue, memWords, LEVEL_TXT } from './elements.js';
import { truthTable, signals } from './sim.js';
import { busText } from './editor.js';
import { simplify, canonical, karnaugh, kGroups } from './boolean.js';
import { thumbSvg } from './render.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LV = ['lv0', 'lv1', 'lvX', 'lvZ'];
const lvChip = v => `<b class="lgLv ${LV[v]}">${LEVEL_TXT[v]}</b>`;
const pinName = p => (p.ov ? `<span class="ov">${esc(p.label || p.name)}</span>` : esc(p.label ?? p.name));
const GROUP_COLORS = ['#e0703a', '#5b9cf5', '#3fb27f', '#d36bb0', '#f2c94c', '#9b7be0', '#3fbfbf', '#e5484d'];

export function createLogicPanels(ed, app) {
  const circ = document.createElement('div'); circ.className = 'lgPane lgCirc';
  const table = document.createElement('div'); table.className = 'lgPane lgTable';
  const wave = document.createElement('div'); wave.className = 'lgPane lgWave';
  const visible = el => el.isConnected && !el.closest('[hidden]');

  /* ---------- Circuit ---------- */
  function propField(e, pr) {
    const p = propsOf(e), v = p[pr.k];
    if (pr.type === 'hidden' || pr.hidden) return '';
    if (pr.type === 'mem') {
      const a = p.abits || 4, d = p.dbits || 4, words = memWords(v, a, d), used = (String(v || '').match(/[0-9a-f]+/gi) || []).length;
      return `<label class="lgField lgMem"><span>${pr.label()}</span><textarea class="sInput mono" data-prop="${pr.k}" rows="4" spellcheck="false" placeholder="00 01 02 03…">${esc(v || '')}</textarea>
        <small>${tl('Un mot hexadécimal par adresse, l’adresse 0 en premier : {0} mot(s) sur {1}, les autres valent 0.', Math.min(used, words.length), words.length)}</small></label>`;
    }
    if (pr.type === 'text') return `<label class="lgField"><span>${pr.label()}</span><input class="sInput" data-prop="${pr.k}" value="${esc(v ?? '')}" maxlength="${pr.k === 'text' ? 80 : 12}" spellcheck="false"></label>`;
    if (pr.type === 'int') return `<label class="lgField"><span>${pr.label()}</span><input class="sInput" type="number" data-prop="${pr.k}" data-int min="${pr.min}" max="${pr.max}" value="${v ?? pr.def}"></label>`;
    if (pr.opts.length <= 5) return `<div class="lgField"><span>${pr.label()}</span><div class="seg mini" role="group">${pr.opts.map(([val, lab]) => `<button type="button" class="segBtn" data-prop="${pr.k}" data-val="${esc(JSON.stringify(val))}" aria-pressed="${String(v) === String(val)}">${esc(lab())}</button>`).join('')}</div></div>`;
    return `<label class="lgField"><span>${pr.label()}</span><select class="sel" data-prop="${pr.k}">${pr.opts.map(([val, lab]) => `<option value="${esc(JSON.stringify(val))}"${String(v) === String(val) ? ' selected' : ''}>${esc(lab())}</option>`).join('')}</select></label>`;
  }
  /** Petite table d'une porte (2 entrées au plus affichées). */
  function gateTable(e) {
    const d = DEFS[e.type], p = propsOf(e);
    if (d.kind !== 'gate' || e.type === 'tri') return '';
    const n = Math.min(p.n || (d.props.length ? 2 : 1), 3), names = 'ABC'.slice(0, n).split(''), rows = [];
    for (let k = 0; k < 1 << n; k++) {
      const I = {}; names.forEach((nm, i) => (I[nm] = (k >> (n - 1 - i)) & 1));
      for (const nm of 'DEFGH') I[nm] = d.fn === 'and' || d.fn === 'nand' ? 1 : 0; // entrées en plus : neutres
      rows.push(`<tr>${names.map(nm => `<td>${I[nm]}</td>`).join('')}<td class="o">${d.ev(I, { ...p, n })['Y']}</td></tr>`);
    }
    return `<table class="lgMini"><thead><tr>${names.map(nm => `<th>${nm}</th>`).join('')}<th class="o">Y</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  /** Contenu d'une mémoire vive, en hexadécimal (16 mots par ligne au plus). */
  function ramView(e, sim) {
    const live = sim.live(e.id), mem = live && live.st && live.st.mem; if (!mem) return '';
    const p = propsOf(e), d = p.dbits || 4, cols = Math.min(8, mem.length), cur = (() => { const a = live.ins, n = p.abits || 4; let v = 0; for (let i = 0; i < n; i++) { const b = a[n === 1 ? 'A' : 'A' + i]; if (b > 1) return -1; v |= b << i; } return v; })();
    const rows = [];
    for (let r = 0; r < mem.length; r += cols) rows.push(`<tr><th>${r.toString(16).toUpperCase()}</th>${mem.slice(r, r + cols).map((v, i) => `<td${r + i === cur ? ' class="cur"' : ''}>${v == null ? 'X' : fmtValue(v, d, 'hex').slice(2)}</td>`).join('')}</tr>`);
    return `<div class="lgPins"><h4>${tl('Contenu de la mémoire')}</h4><table class="lgMemT">${rows.join('')}</table></div>`;
  }
  /** Niveau d'une broche : 0/1/X/Z, ou la valeur d'un bus. */
  const pinLevel = (sim, e, q) => (q.bus ? `<b class="lgLv lvB">${esc(busText(sim.levels(e.id, q.name)))}</b>` : lvChip(sim.level(e.id, q.name)));
  function renderCirc() {
    const S = ed.selection(), sim = ed.sim(), C = ed.circuit(), ctx = app.blockCtx ? app.blockCtx() : null;
    if (S.els.length === 1) {
      const e = S.els[0], d = DEFS[e.type], p = propsOf(e);
      const pins = layoutOf(e).pins, blk = e.type === 'block';
      circ.innerHTML = `<section class="lgSel">
        <div class="lgSelHead"><span class="lgSelThumb">${thumbSvg(e.type, app.style(), e.p)}</span><div><small>${esc(catName(d.cat))}</small><h3>${esc(blk ? tl('Bloc « {0} »', (p.io && p.io.t) || '?') : d.full())}</h3></div></div>
        <p class="lgDoc">${esc(d.doc ? d.doc() : '')}</p>
        ${blk ? `<div class="lgActs"><button type="button" class="btn small primary" data-act="openBlock">${icon('edit')}<span>${tl('Ouvrir le bloc')}</span></button></div>` : ''}
        ${(d.props || []).some(pr => pr.type !== 'hidden' && !pr.hidden) ? `<div class="lgProps">${d.props.map(pr => propField(e, pr)).join('')}</div>` : ''}
        ${gateTable(e)}
        ${e.type === 'ram' ? ramView(e, sim) : ''}
        ${pins.length ? `<div class="lgPins"><h4>${tl('Broches')}</h4>${pins.map(q => `<span class="lgPinRow"><span>${pinName(q)}${q.clk ? ' ▷' : ''}${q.bus ? ` <small class="lgBusW">${tl('{0} bits', q.bus.length)}</small>` : ''}</span><small>${q.dir === 'in' ? (q.opt != null ? tl('entrée facultative ({0})', q.opt) : tl('entrée')) : q.dir === 'out' ? tl('sortie') : tl('liaison')}</small>${pinLevel(sim, e, q)}</span>`).join('')}</div>` : ''}
        <div class="lgActs">
          <button type="button" class="btn small" data-act="rot">${icon('rotate')}<span>${tl('Tourner')}</span></button>
          <button type="button" class="btn small" data-act="dup">${icon('copy')}<span>${tl('Dupliquer')}</span></button>
          ${pins.some(q => q.dir === 'out') && d.kind !== 'in' ? `<button type="button" class="btn small" data-act="watch" aria-pressed="${!!(e.p && e.p.watch)}">${icon('activity')}<span>${tl('Chronogramme')}</span></button>` : ''}
          <span class="grow"></span>
          <button type="button" class="btn small danger" data-act="del" title="${tl('Supprimer · Suppr')}">${icon('trash')}</button>
        </div></section>`;
    } else if (S.els.length > 1) {
      circ.innerHTML = `<section class="lgSel"><h3>${tl('{0} éléments sélectionnés', S.els.length)}</h3><p class="lgDoc">${tl('Glissez-les ensemble, tournez-les (R), copiez-les (Ctrl+C, Ctrl+V) ou supprimez-les (Suppr).')}</p>
        <div class="lgActs"><button type="button" class="btn small" data-act="rot">${icon('rotate')}<span>${tl('Tourner')}</span></button><button type="button" class="btn small" data-act="dup">${icon('copy')}<span>${tl('Dupliquer')}</span></button><span class="grow"></span><button type="button" class="btn small danger" data-act="del">${icon('trash')}</button></div>
        ${app.makeBlock ? `<div class="lgActs"><button type="button" class="btn small" data-act="makeBlock">${icon('cube')}<span>${tl('Faire un bloc avec la sélection')}</span></button></div><p class="note">${tl('Le bloc reçoit une copie de ces éléments ; ses entrées et sorties nommées deviennent ses broches.')}</p>` : ''}</section>`;
    } else if (S.wire) {
      const e0 = C.elements.find(x => x.id === S.wire.a[0]), q0 = e0 && layoutOf(e0).pins.find(q => q.name === S.wire.a[1]);
      const head = q0 && q0.bus ? `${tl('Bus de {0} bits', q0.bus.length)} ${pinLevel(sim, e0, q0)}` : `${tl('Fil')} ${lvChip(sim.level(S.wire.a[0], S.wire.a[1]))}`;
      circ.innerHTML = `<section class="lgSel"><h3>${head}</h3>${sim.bad.has(S.wire.id) ? `<p class="lgDoc warn">${tl('Ce fil relie deux broches de largeurs différentes : il ne transmet rien. Utilisez un séparateur de bus.')}</p>` : ''}<p class="lgDoc">${tl('Un fil relie des broches : elles prennent toutes le même niveau. Tirez depuis un fil pour en faire partir un autre (un nœud apparaît).')}</p>
        <div class="lgActs"><button type="button" class="btn small" data-act="straight">${icon('route')}<span>${tl('Redresser')}</span></button><span class="grow"></span><button type="button" class="btn small danger" data-act="del">${icon('trash')}</button></div></section>`;
    } else {
      const Sg = signals(C), ins = C.elements.filter(isInput), outs = C.elements.filter(isOutput);
      const issues = [];
      const named = e => esc(String(propsOf(e).label || '') || (e.type === 'block' && e.p.io ? e.p.io.t : DEFS[e.type].name()));
      const seen = new Set();
      for (const f of sim.floating()) {
        const e = C.elements.find(x => x.id === f.id); if (!e) continue;
        // Bit d'une broche de bus : la broche entière (D pour D0…D3 en bus, A pour A#2 d'un bloc).
        const q = layoutOf(e).pins.find(p => pinKeys(p).includes(f.pin)), pn = q ? q.name : f.pin;
        if (seen.has(f.id + pn)) continue; seen.add(f.id + pn);
        issues.push({ kind: 'warn', id: e.id, html: tl('{0} : l’entrée {1} n’est reliée à rien (niveau inconnu).', `<b>${named(e)}</b>`, `<b>${esc(pn)}</b>`) });
      }
      if (sim.badTunnels.size) issues.push({ kind: 'err', html: tl('Étiquettes de même nom mais de largeurs différentes : {0}. Seuls les premiers bits sont reliés.', [...sim.badTunnels].map(n => `<b>${esc(n)}</b>`).join(', ')) });
      if (sim.truncated) issues.push({ kind: 'err', html: tl('Circuit trop grand une fois les blocs dépliés : certains blocs ne sont pas simulés.') });
      if (sim.bad.size) issues.push({ kind: 'err', html: tl('{0} fil(s) entre des broches de largeurs différentes (un bus et un fil simple, ou deux bus) : ils ne transmettent rien.', sim.bad.size) });
      if (sim.conflicts.size) issues.push({ kind: 'err', html: tl('{0} fil(s) reliant des sorties qui se contredisent (X, en rouge).', sim.conflicts.size) });
      if (sim.osc) issues.push({ kind: 'err', html: tl('Le circuit oscille : une boucle ne trouve pas d’état stable.') });
      const labels = new Map(); for (const e of C.elements) { const l = String((e.p && e.p.label) || '').trim(); if (l && e.type !== 'tunnel') labels.set(l, (labels.get(l) || 0) + 1); }
      for (const [l, n] of labels) if (n > 1) issues.push({ kind: 'warn', html: tl('Le repère {0} est utilisé {1} fois : chaque entrée et sortie doit avoir un nom différent.', `<b>${esc(l)}</b>`, n) });
      const io = (list, inp) => list.map(e => {
        const keys = layoutOf(e).pins.filter(q => q.dir === (inp ? 'out' : 'in') && q.name !== 'V').flatMap(pinKeys);
        let val = '';
        if (e.type === 'seg7') val = '';
        else if (keys.length > 1) { const lv = keys.map(k => sim.level(e.id, k)); val = `<b class="lgLv">${lv.some(v => v > 1) ? '–' : e.type === 'hex' ? lv.reduce((a, v, i) => a | (v << i), 0).toString(16).toUpperCase() : lv.reduce((a, v, i) => a | (v << i), 0)}</b>`; }
        else if (keys.length) val = lvChip(sim.level(e.id, keys[0]));
        return `<button type="button" class="lgIo" data-pick="${esc(e.id)}"${inp && (e.type === 'switch') ? ' data-flip="1"' : ''}><span class="lgIoT">${thumbSvg(e.type, app.style(), e.p)}</span><span class="grow">${named(e)}<small>${esc(DEFS[e.type].name())}</small></span>${val}</button>`;
      }).join('');
      const banner = ctx ? `<section class="lgBlockCtx"><div class="secHead"><h2>${icon('cube')}${tl('Bloc « {0} »', ctx.name)}</h2></div>
        <p class="lgDoc">${tl('Vous modifiez un bloc. Ses entrées nommées (interrupteurs, boutons, horloges, blocs DIP, entrées numériques) deviennent ses broches d’entrée, ses sorties nommées (LED, sondes, afficheurs) ses broches de sortie. Essayez-le ici, puis revenez au circuit.')}</p>
        <div class="lgPinsSum">${ctx.io.ins.length ? ctx.io.ins.map(q => `<span class="in">${esc(q.n)}${q.w > 1 ? `<small>[${q.w}]</small>` : ''}</span>`).join('') : `<em>${tl('aucune entrée nommée')}</em>`}<span class="arrow">→</span>${ctx.io.outs.length ? ctx.io.outs.map(q => `<span class="out">${esc(q.n)}${q.w > 1 ? `<small>[${q.w}]</small>` : ''}</span>`).join('') : `<em>${tl('aucune sortie nommée')}</em>`}</div>
        <div class="lgActs"><button type="button" class="btn small primary" data-act="leaveBlock">${icon('chevLeft')}<span>${tl('Retour au circuit')}</span></button><button type="button" class="btn small" data-act="renameBlock">${icon('tag')}<span>${tl('Renommer')}</span></button><span class="grow"></span><button type="button" class="btn small danger" data-act="deleteBlock" title="${tl('Supprimer le bloc')}">${icon('trash')}</button></div></section>` : '';
      circ.innerHTML = `${banner}<section><div class="secHead"><h2>${icon('toggle')}${tl('Entrées')}<span class="count">${ins.length}</span></h2></div>${ins.length ? `<div class="lgIoList">${io(ins, true)}</div>` : `<p class="note">${tl('Ajoutez des interrupteurs (bibliothèque → Entrées) : chacun reçoit un nom, A, B, C…')}</p>`}</section>
        <section><div class="secHead"><h2>${icon('bulb')}${tl('Sorties')}<span class="count">${outs.length}</span></h2></div>${outs.length ? `<div class="lgIoList">${io(outs, false)}</div>` : `<p class="note">${tl('Ajoutez des LED ou des sondes (bibliothèque → Sorties) pour lire les résultats.')}</p>`}</section>
        <section><div class="secHead"><h2>${icon('check')}${tl('Vérifications')}</h2></div>${issues.length ? `<ul class="lgIssues">${issues.map(i => `<li class="${i.kind}"${i.id ? ` data-pick="${esc(i.id)}"` : ''}>${icon('alert')}<span>${i.html}</span></li>`).join('')}</ul>` : `<p class="lgOk">${icon('check')}${C.elements.length ? tl('Toutes les entrées sont reliées, aucun conflit.') : tl('Plan de travail vide.')}</p>`}</section>
        <section><div class="secHead"><h2>${icon('help')}${tl('Mode d’emploi')}</h2></div><ul class="lgHelp">
          <li>${tl('<b>Poser</b> : glissez un élément depuis la bibliothèque (ou cliquez-le, puis cliquez sur le plan de travail).')}</li>
          <li>${tl('<b>Câbler</b> : tirez d’une broche à une autre. Relâché dans le vide, le fil continue : chaque clic pose un coude.')}</li>
          <li>${tl('<b>Brancher sur un fil</b> : tirez depuis un fil existant, ou terminez dessus.')}</li>
          <li>${tl('<b>Tester</b> : cliquez sur un interrupteur ; un bouton-poussoir vaut 1 tant qu’on appuie.')}</li>
          <li>${tl('<b>Bus</b> : réglez les broches d’un composant sur « Un bus » pour faire passer un nombre par un seul fil épais ; le séparateur de bus le redonne bit par bit.')}</li>
          <li>${tl('<b>Blocs</b> : sélectionnez un montage puis « Faire un bloc avec la sélection », ou « Nouveau bloc » dans la bibliothèque. Un bloc se pose ensuite comme une porte.')}</li>
          <li>${tl('<b>Raccourcis</b> : R tourner, Suppr effacer, Ctrl+D dupliquer, F cadrer, T avancer d’un front, Espace + glisser pour se déplacer.')}</li></ul></section>`;
    }
    hydrate(circ);
  }
  const catName = id => { if (id === 'blocks') return tl('Mes blocs'); const c = CATS.find(x => x[0] === id); return c ? c[1]() : ''; };
  circ.addEventListener('click', e => {
    const S = ed.selection(), a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'rot') ed.rotateSelection(); else if (act === 'dup') ed.duplicate(); else if (act === 'del') ed.deleteSelection();
      else if (act === 'watch' && S.els[0]) ed.setProps(S.els[0].id, { watch: S.els[0].p && S.els[0].p.watch ? undefined : 1 });
      else if (act === 'straight' && S.wire) { delete S.wire.via; ed.structural(); ed.commit(); }
      else if (act === 'openBlock' && S.els[0]) app.openBlock(propsOf(S.els[0]).ref);
      else if (act === 'makeBlock') app.makeBlock(S.els);
      else if (act === 'leaveBlock') app.leaveBlock();
      else if (act === 'renameBlock') app.renameBlock();
      else if (act === 'deleteBlock') app.deleteBlock();
      return;
    }
    const sb = e.target.closest('button[data-prop][data-val]');
    if (sb && S.els[0]) { ed.setProps(S.els[0].id, { [sb.dataset.prop]: JSON.parse(sb.dataset.val) }); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) { if (pk.dataset.flip) { const it = ed.circuit().elements.find(x => x.id === pk.dataset.pick); if (it) ed.poke(it.id, { value: propsOf(it).value ? 0 : 1 }); } else ed.select([pk.dataset.pick]); }
  });
  circ.addEventListener('change', e => {
    const S = ed.selection(), f = e.target.closest('[data-prop]'); if (!f || !S.els[0]) return;
    const e0 = S.els[0], k = f.dataset.prop, d = DEFS[e0.type], pr = d.props.find(p => p.k === k);
    let v = f.tagName === 'SELECT' ? JSON.parse(f.value) : f.value;
    if (f.dataset.int != null) { v = Math.round(+v); if (!Number.isFinite(v)) v = pr.def; v = Math.max(pr.min, Math.min(pr.max, v)); }
    if (k === 'label') {
      v = String(v).replace(/#/g, '').trim().slice(0, 12); // « # » est réservé aux bits des bus
      if (v && ed.circuit().elements.some(x => x !== e0 && x.p && x.p.label === v && x.type !== 'tunnel' && e0.type !== 'tunnel')) { app.status(tl('Le repère {0} est déjà pris.', v), 'warn'); renderCirc(); return; }
      if (!v) v = undefined;
    }
    ed.setProps(e0.id, { [k]: v });
  });

  /* ---------- Table de vérité ---------- */
  let T = null, kOut = 0, showCanon = false;
  function computeTable() { const C = ed.circuit(); T = truthTable(C, { maxIn: 8 }); }
  function currentRow() {
    if (!T || !T.rows.length) return -1;
    const S = signals(ed.circuit()), C = ed.circuit();
    let k = 0;
    for (const s of S.ins) { const e = C.elements.find(x => x.id === s.id), p = propsOf(e); const b = s.bit != null ? ((p.value || 0) >> s.bit) & 1 : e.type === 'button' ? (p.pressed ? 1 : 0) : (p.value ? 1 : 0); k = (k << 1) | b; }
    return k;
  }
  function renderTable() {
    if (!T) computeTable();
    if (!T.ins.length || !T.outs.length) {
      table.innerHTML = `<div class="emptyState"><i>${icon('list')}</i><b>${tl('Pas encore de table de vérité')}</b><p>${tl('Il faut au moins une entrée (interrupteur, bouton, bloc DIP) et une sortie (LED, sonde, afficheur hexadécimal), chacune avec un nom.')}</p></div>`;
      hydrate(table); return;
    }
    if (T.tooMany) { table.innerHTML = `<div class="emptyState"><i>${icon('list')}</i><b>${tl('Trop d’entrées')}</b><p>${tl('La table est calculée jusqu’à 8 entrées ({0} ici).', T.ins.length)}</p></div>`; hydrate(table); return; }
    const cur = currentRow(), n = T.ins.length;
    const cols = T.outs.map((o, j) => T.rows.map(r => (r.out[j] === 1 ? '1' : r.out[j] === 0 ? '0' : 'x')).join(''));
    const eqs = T.outs.map((o, j) => {
      const unknown = cols[j].includes('x');
      const r = showCanon ? canonical(cols[j], T.ins) : simplify(cols[j], T.ins);
      return `<li><span class="lgEqN">${esc(o)}</span><span class="lgEqV">= ${r.html}</span>${unknown ? `<small class="warn">${tl('(lignes inconnues comptées comme indifférentes)')}</small>` : ''}<button type="button" class="iconBtn" data-copy="${esc(o + ' = ' + r.text)}" title="${tl('Copier')}">${icon('copy')}</button></li>`;
    }).join('');
    kOut = Math.min(kOut, T.outs.length - 1);
    table.innerHTML = `${T.seq ? `<p class="note warnNote">${icon('info')}${tl('Circuit séquentiel (mémoire) : la sortie dépend aussi de l’état mémorisé. Cette table est celle obtenue en essayant les lignes dans l’ordre ; préférez le chronogramme.')}</p>` : ''}
      <section><div class="secHead"><h2>${icon('list')}${tl('Table de vérité')}<span class="count">${T.rows.length}</span></h2><button type="button" class="btn small" data-csv title="${tl('Enregistrer la table (tableur, .csv)')}">${icon('save')}<span>CSV</span></button></div>
      <div class="lgTT"><table><thead><tr>${T.ins.map(x => `<th>${esc(x)}</th>`).join('')}<th class="sep"></th>${T.outs.map(x => `<th class="o">${esc(x)}</th>`).join('')}</tr></thead>
      <tbody>${T.rows.map((r, k) => `<tr data-row="${k}"${k === cur ? ' class="cur"' : ''}>${r.in.map(b => `<td class="b${b}">${b}</td>`).join('')}<td class="sep"></td>${r.out.map(v => `<td class="o ${LV[v]}">${LEVEL_TXT[v]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note">${tl('Cliquez sur une ligne : les entrées prennent ces valeurs sur le plan de travail.')}</p></section>
      <section><div class="secHead"><h2>${icon('sparkle')}${tl('Équations')}</h2><div class="seg mini" role="group"><button type="button" class="segBtn" data-canon="0" aria-pressed="${!showCanon}">${tl('Simplifiées')}</button><button type="button" class="segBtn" data-canon="1" aria-pressed="${showCanon}">${tl('Canoniques')}</button></div></div>
      <ul class="lgEqs">${eqs}</ul><p class="note">${tl('Notation : · ET, + OU, barre au-dessus : NON.')}</p></section>
      ${n >= 2 && n <= 4 ? `<section><div class="secHead"><h2>${icon('grid')}${tl('Tableau de Karnaugh')}</h2>${T.outs.length > 1 ? `<div class="seg mini" role="group">${T.outs.map((o, j) => `<button type="button" class="segBtn" data-kout="${j}" aria-pressed="${j === kOut}">${esc(o)}</button>`).join('')}</div>` : ''}</div>${kmap(cols[kOut], T.ins, T.outs[kOut])}</section>` : ''}`;
    hydrate(table);
  }
  function kmap(col, vars, out) {
    const K = karnaugh(vars), cs = 36, lw = 46, th = 40;
    const W = lw + K.cols.length * cs, H = th + K.rows.length * cs;
    const code = (c, n) => c.toString(2).padStart(n, '0');
    const r = simplify(col, vars);
    const parts = [`<svg class="lgK" viewBox="-2 -2 ${W + 4} ${H + 4}" width="${W + 4}" height="${H + 4}">`];
    parts.push(`<text x="${lw - 6}" y="${th - 22}" text-anchor="end" class="kv">${esc(K.rowVars.join(''))}\\${esc(K.colVars.join(''))}</text>`);
    K.cols.forEach((c, j) => parts.push(`<text x="${lw + j * cs + cs / 2}" y="${th - 8}" text-anchor="middle" class="kh">${code(c, K.nc)}</text>`));
    K.rows.forEach((c, i) => parts.push(`<text x="${lw - 8}" y="${th + i * cs + cs / 2 + 4}" text-anchor="end" class="kh">${code(c, K.nr)}</text>`));
    K.rows.forEach((rc, i) => K.cols.forEach((cc, j) => {
      const v = col[K.cell(i, j)];
      parts.push(`<rect x="${lw + j * cs}" y="${th + i * cs}" width="${cs}" height="${cs}" class="kc${v === '1' ? ' one' : ''}"/><text x="${lw + j * cs + cs / 2}" y="${th + i * cs + cs / 2 + 5}" text-anchor="middle" class="kt${v === '1' ? ' one' : ''}">${v === 'x' ? '–' : v}</text>`);
    }));
    if (r.terms.length && !(r.terms.length === 1 && r.terms[0].m === (1 << vars.length) - 1)) r.terms.forEach((t, g) => {
      const colr = GROUP_COLORS[g % GROUP_COLORS.length], ins = 3 + (g % 3) * 2;
      for (const b of kGroups(K, t)) parts.push(`<rect x="${lw + b.c0 * cs + ins}" y="${th + b.r0 * cs + ins}" width="${(b.c1 - b.c0 + 1) * cs - 2 * ins}" height="${(b.r1 - b.r0 + 1) * cs - 2 * ins}" rx="10" fill="${colr}" fill-opacity="0.08" stroke="${colr}" stroke-width="2"/>`);
    });
    parts.push('</svg>');
    return `<div class="lgKWrap">${parts.join('')}<p class="lgKEq"><b>${esc(out)}</b> = ${r.html}</p></div>`;
  }
  table.addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-row]');
    if (tr && T) {
      const k = +tr.dataset.row, S = signals(ed.circuit()), C = ed.circuit(), list = [], dips = new Map();
      S.ins.forEach((s, i) => {
        const b = T.rows[k].in[i], el = C.elements.find(x => x.id === s.id);
        if (s.bit != null) { const cur = dips.has(s.id) ? dips.get(s.id) : (propsOf(el).value || 0); dips.set(s.id, b ? cur | (1 << s.bit) : cur & ~(1 << s.bit)); }
        else if (el.type === 'button') list.push([s.id, { pressed: !!b }]); else list.push([s.id, { value: b }]);
      });
      for (const [id, v] of dips) list.push([id, { value: v }]);
      ed.setInputs(list); return;
    }
    const c = e.target.closest('[data-canon]'); if (c) { showCanon = c.dataset.canon === '1'; renderTable(); return; }
    const ko = e.target.closest('[data-kout]'); if (ko) { kOut = +ko.dataset.kout; renderTable(); return; }
    const cp = e.target.closest('[data-copy]'); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); app.status(tl('Équation copiée.')); } catch (err) { app.status(cp.dataset.copy); } return; }
    if (e.target.closest('[data-csv]') && T) {
      const sep = DEC === ',' ? ';' : ',', lines = [[...T.ins, ...T.outs].join(sep), ...T.rows.map(r => [...r.in, ...r.out.map(v => LEVEL_TXT[v])].join(sep))];
      const { download } = await import('../school/ui.js');
      download(lines.join('\n'), `${app.title()}-table.csv`);
    }
  });

  /* ---------- Chronogramme ---------- */
  let win = 10, hoverT = null;
  wave.innerHTML = `<div class="lgWaveBar"><div class="seg mini" role="group" aria-label="${tl('Durée affichée')}">${[[2, '2 s'], [5, '5 s'], [10, '10 s'], [30, '30 s']].map(([v, l]) => `<button type="button" class="segBtn" data-win="${v}" aria-pressed="${v === win}">${l}</button>`).join('')}</div><span class="grow"></span><span class="lgTime"></span><button type="button" class="btn small" data-clear>${icon('trash')}<span>${tl('Effacer')}</span></button></div>
    <div class="lgWaveBox"><canvas></canvas><div class="lgWaveEmpty" hidden>${icon('activity')}<b>${tl('Rien d’enregistré')}</b><p>${tl('Nommez des entrées et des sorties, puis lancez l’horloge (▶ sous le plan de travail) ou basculez les interrupteurs : chaque changement s’inscrit ici.')}</p></div></div>
    <p class="note">${tl('Ajoutez un signal interne (sortie d’une bascule, d’une porte) : clic droit sur l’élément, « Afficher au chronogramme ».')}</p>`;
  const cv = wave.querySelector('canvas'), ctx = cv.getContext('2d');
  wave.addEventListener('click', e => {
    const b = e.target.closest('[data-win]'); if (b) { win = +b.dataset.win; wave.querySelectorAll('[data-win]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); drawWave(); return; }
    if (e.target.closest('[data-clear]')) ed.clearTrace();
  });
  cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left; hoverT = x > NAMES_W ? x : null; drawWave(); });
  cv.addEventListener('pointerleave', () => { hoverT = null; drawWave(); });
  const NAMES_W = 64, ROW = 30;
  let css = null;
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  function drawWave() {
    if (!visible(wave)) return;
    // Fenêtre : la durée choisie, ou moins au début (le tracé s'élargit jusqu'à elle).
    const tr = ed.trace(), T1 = ed.time(), span = Math.max(1, Math.min(win, T1 + 0.5)), T0 = Math.max(0, T1 - span);
    wave.querySelector('.lgTime').textContent = `t = ${ed.timeText()} s`;
    wave.querySelector('.lgWaveEmpty').hidden = tr.length > 0;
    cv.hidden = !tr.length; if (!tr.length) return;
    if (!css) css = { hi: cssVar('--lg1'), lo: cssVar('--lg0'), x: cssVar('--lgX'), z: cssVar('--lgZ'), fg: cssVar('--fg'), mut: cssVar('--muted'), line: cssVar('--line'), acc: cssVar('--accent') };
    const box = cv.parentElement, W = box.clientWidth, H = tr.length * ROW + 24, dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const X = t => NAMES_W + (t - T0) / span * (W - NAMES_W - 16);
    ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
    // Graduations
    ctx.strokeStyle = css.line; ctx.lineWidth = 1; ctx.fillStyle = css.mut; ctx.textAlign = 'center';
    const stepT = span <= 2 ? 0.25 : span <= 5 ? 0.5 : span <= 10 ? 1 : 5;
    for (let t = Math.ceil(T0 / stepT) * stepT; t <= T0 + span + 1e-9; t += stepT) { const x = X(t); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 18); ctx.stroke(); ctx.fillText(String(+t.toFixed(2)).replace('.', DEC), x, H - 5); }
    tr.forEach((s, i) => {
      const y0 = i * ROW + 6, yH = y0 + 4, yL = y0 + ROW - 10, ym = (yH + yL) / 2;
      ctx.fillStyle = css.fg; ctx.textAlign = 'right'; ctx.fillText(s.name.length > 8 ? s.name.slice(0, 7) + '…' : s.name, NAMES_W - 8, ym + 4);
      const sm = s.samples;
      for (let j = 0; j < sm.length; j++) {
        const t0 = sm[j][0], t1 = j + 1 < sm.length ? sm[j + 1][0] : T1, v = sm[j][1];
        if (t1 < T0) continue;
        const xa = Math.max(X(t0), NAMES_W), xb = X(Math.min(t1, T1));
        if (s.kind === 'bus') {
          ctx.strokeStyle = v == null ? css.x : css.hi; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(xa, ym); ctx.lineTo(Math.min(xa + 4, xb), yH); ctx.lineTo(Math.max(xb - 4, xa), yH); ctx.lineTo(xb, ym); ctx.lineTo(Math.max(xb - 4, xa), yL); ctx.lineTo(Math.min(xa + 4, xb), yL); ctx.closePath(); ctx.stroke();
          if (xb - xa > 18) { ctx.fillStyle = css.fg; ctx.textAlign = 'center'; ctx.fillText(v == null ? 'X' : String(v), (xa + xb) / 2, ym + 4); }
          continue;
        }
        if (v === 2) { ctx.fillStyle = css.x + '55'; ctx.fillRect(xa, yH, xb - xa, yL - yH); ctx.strokeStyle = css.x; ctx.lineWidth = 1; ctx.strokeRect(xa, yH, xb - xa, yL - yH); continue; }
        const y = v === 1 ? yH : v === 0 ? yL : ym;
        ctx.strokeStyle = v === 1 ? css.hi : v === 0 ? css.hi : css.z; ctx.lineWidth = 2;
        ctx.beginPath();
        if (j > 0 && sm[j - 1][1] !== v && X(t0) >= NAMES_W) { const pv = sm[j - 1][1]; ctx.moveTo(xa, pv === 1 ? yH : pv === 0 ? yL : ym); ctx.lineTo(xa, y); } else ctx.moveTo(xa, y);
        ctx.lineTo(xb, y); ctx.stroke();
        if (v === 1) { ctx.fillStyle = css.hi + '22'; ctx.fillRect(xa, yH, xb - xa, yL - yH); }
      }
    });
    if (hoverT != null) {
      ctx.strokeStyle = css.acc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hoverT, 0); ctx.lineTo(hoverT, H - 18); ctx.stroke();
      const t = T0 + (hoverT - NAMES_W) / (W - NAMES_W - 16) * span;
      ctx.fillStyle = css.acc; ctx.textAlign = hoverT > W - 60 ? 'right' : 'left'; ctx.fillText(`${String(+t.toFixed(2)).replace('.', DEC)} s`, hoverT + (hoverT > W - 60 ? -4 : 4), 12);
    }
  }
  new ResizeObserver(() => drawWave()).observe(wave);

  /* ---------- Rafraîchissements ---------- */
  let tTable = 0;
  function hydrate() { /* icônes déjà en SVG */ }
  ed.on(kind => {
    if (kind === 'select' || kind === 'struct') renderCirc();
    // Niveaux changés : l'inspecteur suit, sauf pendant une saisie (le champ garderait mal le focus).
    if (kind === 'levels' && visible(circ)) { clearTimeout(renderCirc.t); renderCirc.t = setTimeout(() => { const a = document.activeElement; if (a && circ.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return; renderCirc(); }, 80); }
    if (kind === 'struct') { clearTimeout(tTable); tTable = setTimeout(() => { computeTable(); if (visible(table)) renderTable(); }, 120); }
    if (kind === 'levels' && visible(table)) { const cur = currentRow(); table.querySelectorAll('tr[data-row]').forEach(r => r.classList.toggle('cur', +r.dataset.row === cur)); }
    if (kind === 'levels' || kind === 'tick') { cancelAnimationFrame(drawWave.raf); drawWave.raf = requestAnimationFrame(drawWave); }
  });
  return {
    circ, table, wave,
    shown(name) { if (name === 'ltable') { computeTable(); renderTable(); } if (name === 'lwave') drawWave(); if (name === 'lcirc') renderCirc(); },
    refresh() { renderCirc(); computeTable(); if (visible(table)) renderTable(); drawWave(); },
    restyle() { css = null; renderCirc(); drawWave(); }
  };
}
