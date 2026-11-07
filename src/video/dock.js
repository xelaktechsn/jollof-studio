// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Timeline de la vidéo, sous le plan de travail : une piste par sorte d'élément (caméra, fils,
// légendes, et celles que les modules ajoutent). Tête de lecture glissée pour voir la vidéo à un
// instant précis ; extraits déplacés, rognés, groupés à la souris ou au clavier. Les données sont
// dans S.timeline (timeline.js) ; chaque geste passe par api.commit() : annulable et enregistré.
// Légendes et notes s'ajoutent à la tête de lecture (boutons de la barre, touches L et N) et
// s'écrivent dans un panneau à droite de la timeline, la scène montrant le résultat en direct.
import { MIN_D, MAX_T, MAX_D, sortClips, end as tlEnd, together, nextId } from './timeline.js';

const PAD = 10, SNAP_PX = 7, GRID = 0.1, MAX_SHOWN = 300, CAP_D = 2.5;
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
// Texte d'une légende : mêmes caractères refusés qu'au chargement d'un projet (sanitize.js), mais
// l'apostrophe droite devient typographique au lieu de disparaître (« l’alimentation »).
const capText = v => String(v ?? '').replace(/'/g, '’').replace(/[<>"`\u0000-\u001f\u007f\u2028\u2029]/g, '').slice(0, 120);

/**
 * api : timeline(), wire(id), wireIndex(w), wireLabel(w), shots(), state() → { T, playing } | null,
 * busy(), preview(T), play(), pause(), stop(), commit(), selectWire(w|null), addShotAt(T),
 * replaceShot(id), deleteShot(id), status(text, kind), captionsShown(), onToggle(open), tl, esc,
 * icon, menu, DEC.
 * Pistes des modules : api.tracks = [{ key, label, icon, items() → [{ id, t, d, label, color }],
 * move(id, t, d), remove(id), et pour en ajouter : add(T, done(id)), addLabel, addKey, addTip, hint,
 * itemLabel ; pour les écrire dans le panneau : fields(id) → [{ k, label, type: text|textarea|select|check,
 * value, max?, ph?, options?, untimed? }], set(id, k, value) }].
 */
export function createTimelineDock(root, api) {
  const { tl, esc, icon } = api;
  let open = false, pps = 40, needFit = true, cursor = 0, sel = new Set(), drag = null, loop = 0, wireMark = null;
  let sheet = null, addsSig = '';
  const tracks = api.tracks || (api.tracks = []);

  root.innerHTML = `
    <div class="tlGrip" aria-hidden="true"></div>
    <div class="tlBar">
      <button type="button" class="tb" data-a="play" aria-label="${tl('Lire')}" data-tip="${tl('Lire / pause · Espace')}">${icon('play')}</button>
      <button type="button" class="tb" data-a="stop" aria-label="${tl('Arrêter l’aperçu')}" data-tip="${tl('Arrêter l’aperçu · Échap')}">${icon('stop')}</button>
      <span class="tlTime" aria-live="off"><b data-o="now">00:00,0</b><span> / </span><span data-o="end">00:00,0</span></span>
      <span class="sep"></span>
      <button type="button" class="btn small" data-a="addCap" data-tip="${tl('Ajouter une légende à la tête de lecture · L')}">${icon('plus')}<span>${tl('Légende')}</span></button>
      <span class="tlAdds" data-o="adds"></span>
      <span class="tlMode" data-o="mode"></span>
      <span class="grow"></span>
      <button type="button" class="btn small" data-a="group" disabled data-tip="${tl('Tracer ensemble les fils sélectionnés')}">${icon('layers')}<span>${tl('Grouper')}</span></button>
      <button type="button" class="btn small" data-a="ungroup" disabled data-tip="${tl('Tracer un par un les fils de l’extrait')}">${icon('list')}<span>${tl('Dégrouper')}</span></button>
      <span class="sep"></span>
      <button type="button" class="tb" data-a="zoomOut" aria-label="${tl('Dézoomer')}">${icon('minus')}</button>
      <button type="button" class="tb" data-a="fit" aria-label="${tl('Toute la vidéo')}" data-tip="${tl('Toute la vidéo')}">${icon('frame')}</button>
      <button type="button" class="tb" data-a="zoomIn" aria-label="${tl('Zoomer')}">${icon('plus')}</button>
      <button type="button" class="tb" data-a="close" aria-label="${tl('Fermer la timeline')}">${icon('x')}</button>
    </div>
    <div class="tlBody">
      <div class="tlHeads"></div>
      <div class="tlScroll"><div class="tlCanvas">
        <div class="tlRuler" role="slider" tabindex="0" aria-label="${tl('Tête de lecture')}"></div>
        <div class="tlTracks"></div>
        <div class="tlPlay" aria-hidden="true"></div>
      </div></div>
    </div>
    <div class="tlSheet" role="dialog" hidden></div>`;
  const $ = s => root.querySelector(s);
  const scroll = $('.tlScroll'), canvas = $('.tlCanvas'), ruler = $('.tlRuler'), tracksEl = $('.tlTracks'), heads = $('.tlHeads'), head = $('.tlPlay'), sheetEl = $('.tlSheet');

  /* ---------- Échelle et formats ---------- */
  const X = t => PAD + t * pps;
  const T = x => (x - PAD) / pps;
  const fmtS = s => `${(+s.toFixed(1)).toString().replace('.', api.DEC)} s`;
  const clock = s => { const d = Math.round(s * 10), m = Math.floor(d / 600), r = (d % 600) / 10; return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0').replace('.', api.DEC)}`; };
  const total = () => tlEnd(api.timeline());
  function fit() { const w = scroll.clientWidth - PAD * 2; if (w > 40) { pps = Math.max(4, Math.min(400, w / Math.max(1, total()))); needFit = false; } }
  function zoom(f, atX) {
    const vx = atX ?? scroll.clientWidth / 2, t = T(scroll.scrollLeft + vx);
    pps = Math.max(4, Math.min(400, pps * f)); needFit = false;
    render(); scroll.scrollLeft = X(t) - vx;
  }

  /* ---------- Rendu ---------- */
  const key = (tr, id) => `${tr}:${id}`;
  function clipHtml(k, t, d, label, aria, cls = '', color = '', wireId = '') {
    return `<button type="button" class="tlClip ${cls}${sel.has(k) ? ' sel' : ''}" data-k="${esc(k)}"${wireId ? ` data-w="${esc(wireId)}"` : ''} style="left:${X(t)}px;width:${Math.max(6, d * pps)}px${color ? `;--c:${esc(color)}` : ''}" aria-label="${esc(aria)}" title="${esc(aria)}"><span class="h l" data-h="l"></span><span class="lb">${esc(label)}</span><span class="h r" data-h="r"></span></button>`;
  }
  function visibleRange() {
    const t0 = T(scroll.scrollLeft) - 2, t1 = T(scroll.scrollLeft + scroll.clientWidth) + 2;
    return c => c.t + c.d >= t0 && c.t <= t1;
  }
  function wiresTrack(line) {
    const n = line.wires.length, show = n > MAX_SHOWN ? visibleRange() : () => true;
    return line.wires.map((c, i) => {
      const k = key('w', c.id);
      if (!show(c) && !sel.has(k)) return '';
      const range = tl('de {0} à {1}', fmtS(c.t), fmtS(c.t + c.d));
      if (together(c)) return clipHtml(k, c.t, c.d, tl('{0} fils ensemble', c.ws.length), `${tl('{0} fils tracés ensemble', c.ws.length)}, ${range}`, 'grp');
      const w = api.wire(c.ws[0]); if (!w) return '';
      const name = `${i + 1} · ${w.role || `${w.a.comp.name} ${w.a.key}`}`;
      return clipHtml(k, c.t, c.d, name, `${tl('Fil {0}/{1}', i + 1, n)}, ${api.wireLabel(w)}, ${range}`, wireMark === w.id ? 'mark' : '', w.color, w.id);
    }).join('');
  }
  function camTrack(line) {
    const shots = api.shots(), idx = id => shots.findIndex(s => s.id === id);
    const keys = line.cam.filter(k => idx(k.shot) >= 0);
    const segs = keys.slice(1).map((k, i) => `<span class="tlSeg${k.ease === 'cut' ? ' cut' : ''}" style="left:${X(keys[i].t)}px;width:${Math.max(0, (k.t - keys[i].t) * pps)}px"></span>`).join('');
    return segs + keys.map(k => {
      const kk = key('k', k.id), n = idx(k.shot) + 1, aria = `${tl('Plan {0}', n)}, ${fmtS(k.t)}${k.ease === 'cut' ? ' · ' + tl('coupe nette') : ''}`;
      return `<button type="button" class="tlKey${k.ease === 'cut' ? ' cut' : ''}${sel.has(kk) ? ' sel' : ''}" data-k="${kk}" style="left:${X(k.t)}px" aria-label="${esc(aria)}" title="${esc(aria)}"><span>${n}</span></button>`;
    }).join('');
  }
  /** Piste vide : rappel de la façon d'y ajouter un élément (reste visible au défilement). */
  const hint = text => `<span class="tlHint">${esc(text)}</span>`;
  function capsTrack(line) {
    if (!line.caps.length) return hint(tl('Double-cliquez pour ajouter une légende · L'));
    return line.caps.map(c => clipHtml(key('t', c.id), c.t, c.d, c.text || '…', `${tl('Légende')} « ${c.text} », ${tl('de {0} à {1}', fmtS(c.t), fmtS(c.t + c.d))}`, 'cap')).join('');
  }
  function extraTrack(tr) {
    const items = tr.items();
    if (!items.length && tr.hint) return hint(tr.hint);
    return items.map(it => clipHtml(key('x', `${tr.key}~${it.id}`), it.t, it.d, it.label, `${tr.label}, ${it.label}, ${tl('de {0} à {1}', fmtS(it.t), fmtS(it.t + it.d))}`, 'ext', it.color)).join('');
  }
  /** Boutons « + Note »… des pistes de modules, refaits seulement quand la liste des pistes change. */
  function addButtons() {
    const list = tracks.filter(tr => tr.add && tr.addLabel), sig = list.map(tr => tr.key).join('|');
    if (sig === addsSig) return;
    addsSig = sig;
    $('[data-o=adds]').innerHTML = list.map(tr => `<button type="button" class="btn small" data-a="addX" data-tr="${esc(tr.key)}" data-tip="${esc(tr.addTip || tr.addLabel)}">${icon('plus')}<span>${esc(tr.addLabel)}</span></button>`).join('');
  }
  /** Graduations de la seule partie visible (une longue vidéo très zoomée en aurait des dizaines de milliers). */
  function drawRuler() {
    const step = STEPS.find(s => s * pps >= 64) || 600, minor = step / (step >= 1 && step % 5 === 0 ? 5 : 2);
    const t0 = Math.max(0, Math.floor(T(scroll.scrollLeft) / step) * step), t1 = T(scroll.scrollLeft + scroll.clientWidth) + step;
    let html = '';
    for (let i = 0, t = t0; t <= t1 && i < 2000; i++, t = t0 + i * minor) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      html += `<span class="tk${major ? ' M' : ''}" style="left:${X(t)}px">${major ? fmtS(Math.round(t * 10) / 10) : ''}</span>`;
    }
    ruler.innerHTML = html;
  }
  function render() {
    if (!open) return;
    const line = api.timeline(), len = total();
    if (needFit) fit();
    const focused = root.contains(document.activeElement) && document.activeElement.closest('[data-k]') ? document.activeElement.dataset.k : null;
    canvas.style.width = Math.max(scroll.clientWidth, X(len + 2) + PAD) + 'px';
    drawRuler();
    const rows = [
      ['cam', icon('frame') + tl('Caméra'), camTrack(line)],
      ['w', icon('cable') + tl('Fils'), wiresTrack(line)],
      ['t', icon('note') + tl('Légendes'), capsTrack(line)],
      ...tracks.map(tr => ['x:' + tr.key, icon(tr.icon || 'note') + esc(tr.label), extraTrack(tr)])
    ];
    heads.innerHTML = '<div class="tlHd ruler"></div>' + rows.map(r => `<div class="tlHd">${r[1]}</div>`).join('');
    tracksEl.innerHTML = rows.map(r => `<div class="tlTrack" data-track="${r[0]}">${r[2]}</div>`).join('');
    const auto = line.auto;
    $('[data-o=mode]').textContent = auto ? tl('Automatique · {0}', auto === 'all' ? tl('tout en même temps') : tl('fil par fil')) : tl('Personnalisée');
    $('[data-o=end]').textContent = clock(len);
    ruler.setAttribute('aria-valuemin', '0'); ruler.setAttribute('aria-valuemax', len.toFixed(1));
    groupButtons(); addButtons();
    if (focused) focusKey(focused); // le clavier reste sur l'extrait après un nouveau rendu
    update();
  }
  function focusKey(k) { const el = tracksEl.querySelector(`[data-k="${CSS.escape(k)}"]`); if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }
  /** Tête de lecture, bouton lecture/pause, temps affiché (appelé à chaque image pendant la lecture). */
  function update() {
    if (!open) return;
    const st = api.state();
    if (st) cursor = st.T;
    const playing = !!(st && st.playing);
    head.style.transform = `translateX(${X(cursor)}px)`;
    head.classList.toggle('live', !!st);
    $('[data-o=now]').textContent = clock(cursor);
    ruler.setAttribute('aria-valuenow', cursor.toFixed(1)); ruler.setAttribute('aria-valuetext', fmtS(cursor));
    const pb = $('[data-a=play]');
    pb.innerHTML = icon(playing ? 'pause' : 'play'); pb.setAttribute('aria-label', playing ? tl('Pause') : tl('Lire'));
    $('[data-a=stop]').disabled = !st;
    if (playing) {
      const x = X(cursor) - scroll.scrollLeft;
      if (x > scroll.clientWidth - 40 || x < 0) scroll.scrollLeft = X(cursor) - 60;
      if (!loop) loop = requestAnimationFrame(() => { loop = 0; update(); });
    }
  }

  /* ---------- Sélection et recherche ---------- */
  function find(k) {
    const line = api.timeline(), [tr, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (tr === 'w') return { tr, obj: line.wires.find(c => c.id === id) };
    if (tr === 'k') return { tr, obj: line.cam.find(c => c.id === id) };
    if (tr === 't') return { tr, obj: line.caps.find(c => c.id === id) };
    if (tr === 'x') {
      const [tk, iid] = id.split('~'), track = tracks.find(t => t.key === tk), it = track && track.items().find(i => String(i.id) === iid);
      return { tr, track, obj: it && { id: iid, t: it.t, d: it.d } };
    }
    return { tr };
  }
  /**
   * Sélection : les classes changent sur place, sans nouveau rendu (un double-clic doit retrouver
   * le même élément entre ses deux clics, et le focus clavier reste sur l'extrait).
   */
  function select(k, add) {
    if (!add) sel.clear();
    if (k) { if (add && sel.has(k)) sel.delete(k); else sel.add(k); }
    tracksEl.querySelectorAll('[data-k]').forEach(el => el.classList.toggle('sel', sel.has(el.dataset.k)));
    groupButtons();
    const f = k && find(k);
    if (f && f.tr === 'w' && f.obj && !together(f.obj) && sel.size === 1) api.selectWire(api.wire(f.obj.ws[0]) || null);
  }
  function groupButtons() {
    const line = api.timeline(), wsel = line.wires.filter(c => sel.has(key('w', c.id)));
    $('[data-a=group]').disabled = wsel.length < 2;
    $('[data-a=ungroup]').disabled = !(wsel.length === 1 && wsel[0].ws.length > 1);
  }
  /** Le fil sélectionné dans la vue 3D ou la liste est repéré sur sa piste. */
  function markWire(id) {
    wireMark = id;
    if (open) tracksEl.querySelectorAll('[data-w]').forEach(el => el.classList.toggle('mark', el.dataset.w === id));
  }

  /* ---------- Modifications ---------- */
  function touched(trs) {
    const line = api.timeline();
    if (trs.has('w')) line.auto = null;
    if (trs.has('k')) line.camAuto = false;
    sortClips(line);
  }
  function commit(trs) { touched(trs); api.commit(); render(); }
  function snapTargets(skip) {
    const line = api.timeline(), out = [0, cursor];
    const push = (k, t, d) => { if (!skip.has(k)) { out.push(t); if (d != null) out.push(t + d); } };
    line.wires.forEach(c => push(key('w', c.id), c.t, c.d));
    line.cam.forEach(c => push(key('k', c.id), c.t));
    line.caps.forEach(c => push(key('t', c.id), c.t, c.d));
    tracks.forEach(tr => tr.items().forEach(it => push(key('x', `${tr.key}~${it.id}`), it.t, it.d)));
    return out;
  }
  /** Instant aimanté : bord d'un autre extrait ou tête de lecture à moins de 7 px, sinon grille de 0,1 s. */
  function snap(t, targets, free) {
    if (free) return t;
    let best = null, gap = SNAP_PX / pps;
    for (const s of targets) { const g = Math.abs(s - t); if (g < gap) { gap = g; best = s; } }
    return best ?? Math.round(t / GRID) * GRID;
  }
  const clampT = t => Math.max(0, Math.min(MAX_T, t));
  /** Déplace ou rogne la sélection (souris ou clavier). `mode` : move, l (début), r (fin). */
  function applyEdit(items, mode, dt, free, targets) {
    const lead = items[0];
    if (mode === 'move') {
      const minT = Math.min(...items.map(i => i.t0));
      let start = lead.t0 + dt;
      const s1 = snap(start, targets, free), e1 = lead.d0 != null ? snap(start + lead.d0, targets, free) - lead.d0 : s1;
      start = Math.abs(s1 - start) <= Math.abs(e1 - start) ? s1 : e1;
      const delta = Math.max(-minT, start - lead.t0);
      items.forEach(i => { i.obj.t = clampT(i.t0 + delta); });
    } else if (lead.d0 != null) {
      const o = lead.obj, endT = lead.t0 + lead.d0;
      if (mode === 'l') { const t = Math.max(0, Math.min(endT - MIN_D, snap(lead.t0 + dt, targets, free))); o.t = t; o.d = endT - t; }
      else o.d = Math.max(MIN_D, Math.min(MAX_D, snap(endT + dt, targets, free) - lead.t0));
    }
  }
  function itemsOf(keys) {
    return [...keys].map(k => ({ k, ...find(k) })).filter(i => i.obj).map(i => ({ ...i, t0: i.obj.t, d0: i.obj.d }));
  }
  function finishItems(items) {
    items.filter(i => i.tr === 'x').forEach(i => i.track.move(i.obj.id, i.obj.t, i.obj.d));
    commit(new Set(items.map(i => i.tr)));
  }
  function group() {
    const line = api.timeline(), cs = line.wires.filter(c => sel.has(key('w', c.id)));
    if (cs.length < 2) return;
    const t = Math.min(...cs.map(c => c.t)), d = Math.max(...cs.map(c => c.d));
    const keep = cs[0];
    keep.ws = cs.flatMap(c => c.ws); keep.t = t; keep.d = d; keep.grp = true;
    line.wires = line.wires.filter(c => c === keep || !cs.includes(c));
    sel = new Set([key('w', keep.id)]);
    commit(new Set(['w']));
    api.status(tl('{0} fils tracés ensemble.', keep.ws.length), 'ok');
  }
  function ungroup() {
    const line = api.timeline(), c = line.wires.find(x => sel.has(key('w', x.id)));
    if (!c || c.ws.length < 2) return;
    const rest = c.ws.slice(1), gap = c.d * 1.25;
    c.ws = [c.ws[0]]; delete c.grp;
    // Les fils suivants partent un par un ; ce qui venait après est décalé d'autant.
    const shift = rest.length * gap, after = c.t + c.d;
    line.wires.forEach(x => { if (x !== c && x.t >= after) x.t += shift; });
    let n = +line.wires.reduce((m, x) => Math.max(m, +x.id.slice(1) || 0), 0);
    rest.forEach((w, i) => line.wires.push({ id: 'c' + (++n), ws: [w], t: c.t + (i + 1) * gap, d: c.d }));
    commit(new Set(['w']));
  }
  function removeSel() {
    let wiresAsked = false;
    const line = api.timeline();
    for (const k of [...sel]) {
      const f = find(k);
      if (!f.obj) continue;
      if (f.tr === 'w') { wiresAsked = true; continue; }
      if (f.tr === 't') line.caps = line.caps.filter(c => c !== f.obj);
      if (f.tr === 'k') api.deleteShot(f.obj.shot);
      if (f.tr === 'x') f.track.remove(f.obj.id);
      sel.delete(k);
    }
    if (wiresAsked) api.status(tl('Un fil reste dans la timeline tant qu’il est câblé : supprimez-le dans l’onglet Câblage.'), 'warn');
    commit(new Set(['t']));
  }
  /* ---------- Légendes et notes : ajout à la tête de lecture, panneau d'écriture ---------- */
  /** Aperçu figé à l'instant T : la scène montre ce qu'on est en train d'écrire. */
  function holdAt(T) {
    const st = api.state();
    if (st && st.playing) api.pause();
    if (api.timeline().wires.length) api.preview(T); // sans fil, pas d'aperçu possible
    else { cursor = T; update(); }
  }
  /** Montre un élément : la tête de lecture reste dessus si elle y est déjà, sinon va à son début. */
  const showItem = o => holdAt(cursor >= o.t && cursor < o.t + o.d ? cursor : o.t + 1e-4);
  /** Nouvelle légende à l'instant t, puis son panneau : écrire, Entrée, c'est fait (une seule étape d'annulation). */
  function addCaption(t0) {
    if (api.busy()) return;
    closeSheet(true, false);
    const line = api.timeline();
    let t = Math.max(0, Math.round(t0 / GRID) * GRID);
    // Instant déjà couvert par une légende : la nouvelle commence à sa fin (légendes triées).
    for (const c of line.caps) if (t >= c.t - 1e-6 && t < c.t + c.d - 1e-6) t = +(c.t + c.d).toFixed(2);
    const next = line.caps.find(c => c.t > t + 1e-6), room = next ? next.t - t : Infinity;
    const id = nextId('t', line.caps);
    line.caps.push({ id, t, d: room >= 0.5 ? Math.min(CAP_D, room) : CAP_D, text: '' });
    sortClips(line);
    if (api.captionsShown && !api.captionsShown()) api.status(tl('Les légendes sont masquées : cochez « Afficher les légendes » dans l’onglet Vidéo pour les voir.'), 'warn');
    openSheet(key('t', id), true);
  }
  /** Élément d'une piste de module (note…) : le module le crée (il peut d'abord demander un point de la scène). */
  function addItem(tr) {
    if (api.busy() || !tr || !tr.add) return;
    closeSheet(true, false);
    const T = Math.max(0, +cursor.toFixed(2));
    holdAt(T);
    // Le point vient d'un clic dans la scène : le panneau s'ouvre après lui, sinon ce clic lui
    // reprendrait le focus.
    tr.add(T, id => { render(); if (id != null) setTimeout(() => openSheet(key('x', `${tr.key}~${id}`), true)); });
  }
  /** Touche L (légende) ou celle d'une piste (N pour les notes). Rend vrai si elle a servi. */
  function shortcut(k) {
    if (!open || api.busy()) return false;
    if (k === 'l') { addCaption(cursor); return true; }
    const tr = tracks.find(x => x.add && x.addKey === k);
    if (tr) { addItem(tr); return true; }
    return false;
  }
  function fieldHtml(x) {
    const f = `data-f="${esc(x.k)}"`;
    if (x.type === 'check') return `<label class="check"><input type="checkbox" ${f}${x.value ? ' checked' : ''}> ${esc(x.label)}</label>`;
    const ph = x.ph ? ` placeholder="${esc(x.ph)}"` : '', max = x.max ? ` maxlength="${x.max}"` : '';
    const ctl = x.type === 'textarea' ? `<textarea ${f} rows="2"${ph}${max}>${esc(x.value ?? '')}</textarea>`
      : x.type === 'select' ? `<select ${f}>${(x.options || []).map(o => `<option value="${esc(o.value)}"${o.value === x.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : `<input ${f} value="${esc(x.value ?? '')}"${ph}${max} autocomplete="off">`;
    return `<label class="tlField"><span>${esc(x.label)}</span>${ctl}</label>`;
  }
  function sheetFields(f) {
    if (f.tr === 't') return [{ k: 'text', label: tl('Texte de la légende'), type: 'text', value: f.obj.text, max: 120, ph: tl('Ce qui se passe à ce moment…') }];
    return (f.track.fields && f.track.fields(f.obj.id)) || [];
  }
  /**
   * Panneau d'une légende ou d'une note, à droite de la timeline. Les changements s'appliquent
   * tout de suite à la scène ; Entrée ou un clic ailleurs valide, Échap annule.
   */
  function openSheet(k, fresh = false) {
    const f = find(k);
    if (!f.obj || (f.tr === 'x' && !f.track.fields) || (f.tr !== 't' && f.tr !== 'x')) return;
    if (sheet && sheet.k !== k) closeSheet(true, false);
    sheet = { k, fresh, touched: false, obj: f.tr === 't' ? f.obj : null, orig: { t: f.obj.t, d: f.obj.d, text: f.obj.text, fields: sheetFields(f).map(x => [x.k, x.value]) } };
    sel = new Set([k]);
    render();
    paintSheet(true);
    reveal(f.obj.t);
    showItem(f.obj);
  }
  function paintSheet(first) {
    const f = sheet && find(sheet.k);
    if (!f || !f.obj) { hideSheet(); return; }
    const fields = sheetFields(f), untimed = fields.some(x => x.untimed && x.value);
    const title = f.tr === 't' ? tl('Légende') : f.track.itemLabel || f.track.label;
    const was = !first && sheetEl.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    const n = v => String(+(+v).toFixed(2)), dis = untimed ? ' disabled' : '';
    sheetEl.setAttribute('aria-label', title);
    sheetEl.innerHTML = `
      <div class="tlShHead"><b>${esc(title)}</b><span class="tlShTime">${untimed ? tl('Toute la vidéo') : tl('de {0} à {1}', fmtS(f.obj.t), fmtS(f.obj.t + f.obj.d))}</span><span class="grow"></span><button type="button" class="tb" data-s="close" aria-label="${tl('Fermer')}">${icon('x')}</button></div>
      ${fields.map(fieldHtml).join('')}
      <div class="tlShRow">
        <label class="tlField"><span>${tl('Début (s)')}</span><input type="number" data-f="@t" min="0" max="${MAX_T}" step="0.1" value="${n(f.obj.t)}"${dis}></label>
        <label class="tlField"><span>${tl('Durée (s)')}</span><input type="number" data-f="@d" min="${MIN_D}" max="${MAX_D}" step="0.1" value="${n(f.obj.d)}"${dis}></label>
      </div>
      <div class="tlShFoot"><button type="button" class="btn small danger" data-s="del">${icon('trash')}<span>${tl('Supprimer')}</span></button><span class="grow"></span><button type="button" class="btn small primary" data-s="ok" data-tip="${tl('Entrée · Échap pour annuler')}">${tl('Valider')}</button></div>`;
    sheetEl.hidden = false; root.classList.add('editing');
    const target = first ? sheetEl.querySelector('input:not([type=number]):not([type=checkbox]), textarea') : was && sheetEl.querySelector(`[data-f="${CSS.escape(was)}"]`);
    if (!target) return;
    target.focus({ preventScroll: true });
    if (first && target.setSelectionRange) { if (sheet.fresh) target.select(); else target.setSelectionRange(target.value.length, target.value.length); }
  }
  /** La timeline défile pour que l'élément reste visible à gauche du panneau. */
  function reveal(t) {
    const x = X(t) - scroll.scrollLeft, room = scroll.clientWidth - sheetEl.offsetWidth - 24;
    if (x < 0 || x > room) scroll.scrollLeft = Math.max(0, X(t) - 48);
  }
  function hideSheet() { sheet = null; sheetEl.hidden = true; sheetEl.innerHTML = ''; root.classList.remove('editing'); }
  /** La scène reprend l'instant affiché (texte de la légende, bulle de la note). */
  function live() { const st = api.state(); if (st && !st.playing) api.preview(st.T); }
  /**
   * Ferme le panneau. `ok` : garde les changements (une légende vide disparaît) et les enregistre
   * en une étape d'annulation ; sinon tout revient comme avant (élément nouveau retiré).
   */
  function closeSheet(ok, refocus = true) {
    if (!sheet) return;
    const s = sheet, f = find(s.k);
    hideSheet();
    if (!f.obj) { render(); return; }
    let save = false, redraw = false;
    if (f.tr === 't') {
      const line = api.timeline(), drop = () => { line.caps = line.caps.filter(c => c !== f.obj); sel.delete(s.k); redraw = true; };
      if (ok) {
        f.obj.text = f.obj.text.trim();
        if (!f.obj.text) { drop(); save = !s.fresh; }
        else save = s.fresh || f.obj.text !== s.orig.text || f.obj.t !== s.orig.t || f.obj.d !== s.orig.d;
      } else if (s.fresh) drop();
      else { Object.assign(f.obj, { text: s.orig.text, t: s.orig.t, d: s.orig.d }); redraw = s.touched; }
      sortClips(line);
    } else if (!ok && s.fresh) { f.track.remove(f.obj.id); sel.delete(s.k); redraw = true; }
    else if (!ok && s.touched) { f.track.move(f.obj.id, s.orig.t, s.orig.d); s.orig.fields.forEach(([k, v]) => f.track.set(f.obj.id, k, v)); redraw = true; }
    if (save) commit(new Set(['t'])); else if (redraw) render();
    if (redraw || save || s.touched) live();
    if (refocus && open && sel.has(s.k)) focusKey(s.k);
  }
  /** Bouton « Supprimer » du panneau. Un élément tout juste ajouté s'en va sans étape d'annulation. */
  function deleteFromSheet() {
    const s = sheet, f = find(s.k); hideSheet();
    if (!f.obj) return;
    if (!s.fresh) { sel = new Set([s.k]); removeSel(); live(); return; }
    if (f.tr === 't') api.timeline().caps = api.timeline().caps.filter(c => c !== f.obj);
    else f.track.remove(f.obj.id);
    sel.delete(s.k); render(); live();
  }
  sheetEl.addEventListener('input', e => {
    const fk = e.target.dataset.f, f = sheet && find(sheet.k);
    if (!fk || fk[0] === '@' || !f || !f.obj || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
    sheet.touched = true;
    if (f.tr === 't') {
      const inp = e.target, v = capText(inp.value);
      if (v !== inp.value) { const p = Math.max(0, inp.selectionStart - (inp.value.length - v.length)); inp.value = v; inp.setSelectionRange(p, p); }
      f.obj.text = v;
      const lb = tracksEl.querySelector(`[data-k="${CSS.escape(sheet.k)}"] .lb`); if (lb) lb.textContent = v || '…';
    } else f.track.set(f.obj.id, fk, e.target.value);
    live();
  });
  /** Début, durée, case ou liste : l'élément change, la timeline et le panneau sont redessinés. */
  function applyField(el) {
    const fk = el.dataset.f, f = sheet && find(sheet.k); if (!fk || !f || !f.obj) return;
    if (fk[0] === '@') {
      const v = parseFloat(String(el.value).replace(',', '.'));
      if (!Number.isFinite(v)) { paintSheet(); return; }
      let { t, d } = f.obj;
      if (fk === '@t') t = Math.max(0, Math.min(MAX_T, v)); else d = Math.max(MIN_D, Math.min(MAX_D, v));
      if (t === f.obj.t && d === f.obj.d) return;
      if (f.tr === 't') { f.obj.t = t; f.obj.d = d; sortClips(api.timeline()); } else f.track.move(f.obj.id, t, d);
    } else if (el.type === 'checkbox' || el.tagName === 'SELECT') f.track.set(f.obj.id, fk, el.type === 'checkbox' ? el.checked : el.value);
    else return;
    sheet.touched = true;
    render(); paintSheet();
    const g = find(sheet.k); if (g.obj) showItem(g.obj);
  }
  sheetEl.addEventListener('change', e => applyField(e.target));
  sheetEl.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) { if (e.key === 'Enter') { e.preventDefault(); applyField(e.target); closeSheet(true); } return; } // Ctrl+S… restent ceux de l'application
    e.stopPropagation(); // ni raccourcis de la timeline, ni ceux du plan de travail
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(false); }
    else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); applyField(e.target); closeSheet(true); }
  });
  sheetEl.addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b || !sheet) return;
    if (b.dataset.s === 'ok' || b.dataset.s === 'close') closeSheet(true);
    if (b.dataset.s === 'del') deleteFromSheet();
  });
  // Clic hors du panneau (timeline, scène, autre panneau) : il se ferme en gardant ce qui est écrit.
  document.addEventListener('pointerdown', e => { if (sheet && !sheetEl.contains(e.target)) closeSheet(true, false); }, true);
  async function keyMenu(el, k) {
    const f = find(k); if (!f.obj) return;
    const v = await api.menu(el, [
      { label: tl('Voir ce plan'), icon: 'eye', value: 'see' },
      { label: tl('Remplacer par la vue actuelle'), icon: 'frame', value: 'set' },
      { label: f.obj.ease === 'cut' ? tl('Glisser depuis le plan précédent') : tl('Coupe nette'), icon: 'scissors', value: 'cut' },
      '-',
      { label: tl('Supprimer'), icon: 'trash', value: 'del', danger: true }
    ]);
    if (v === 'see') api.preview(f.obj.t);
    if (v === 'set') { api.replaceShot(f.obj.shot); render(); }
    if (v === 'cut') { f.obj.ease = f.obj.ease === 'cut' ? 'smooth' : 'cut'; commit(new Set(['k'])); }
    if (v === 'del') { sel = new Set([k]); removeSel(); }
  }

  /* ---------- Souris ---------- */
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || api.busy()) return;
    const x = e.clientX - canvas.getBoundingClientRect().left;
    if (e.target.closest('.tlRuler')) {
      drag = { kind: 'scrub' }; canvas.setPointerCapture(e.pointerId);
      cursor = Math.max(0, Math.min(total(), T(x))); api.preview(cursor); return;
    }
    const el = e.target.closest('[data-k]');
    if (!el) { if (!e.shiftKey && sel.size) select(null); return; }
    const k = el.dataset.k;
    e.preventDefault(); // pas de focus sur l'ancien bouton, remplacé par le rendu : on le donne au nouveau
    if (!sel.has(k) || e.shiftKey) select(k, e.shiftKey);
    focusKey(k);
    if (e.shiftKey) return;
    const kinds = new Set([...sel].map(s => s.slice(0, s.indexOf(':'))));
    const keys = kinds.size === 1 ? sel : new Set([k]); // une seule piste à la fois
    const h = e.target.closest('[data-h]'), mode = h && !k.startsWith('k:') ? h.dataset.h : 'move';
    const items = itemsOf(mode === 'move' ? keys : [k]);
    // L'extrait saisi passe en premier : c'est lui qu'on aimante.
    items.sort((a, b) => (a.k === k ? -1 : b.k === k ? 1 : 0));
    drag = { kind: 'edit', mode, items, x0: e.clientX, moved: false, targets: snapTargets(new Set(items.map(i => i.k))), pid: e.pointerId };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'scrub') { const x = e.clientX - canvas.getBoundingClientRect().left; cursor = Math.max(0, Math.min(total(), T(x))); api.preview(cursor); return; }
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 3) return;
    // Capture seulement une fois le glissé commencé : un double-clic garde sa cible (légende à modifier).
    if (!drag.moved) { drag.moved = true; try { canvas.setPointerCapture(drag.pid); } catch (err) { /* pointeur déjà relâché */ } }
    applyEdit(drag.items, drag.mode, dx / pps, e.altKey, drag.targets);
    for (const i of drag.items) {
      const el = tracksEl.querySelector(`[data-k="${CSS.escape(i.k)}"]`); if (!el) continue;
      el.style.left = X(i.obj.t) + 'px';
      if (i.obj.d != null) el.style.width = Math.max(6, i.obj.d * pps) + 'px';
    }
    root.classList.add('dragging');
  });
  const up = () => {
    if (!drag) return;
    const d = drag; drag = null; root.classList.remove('dragging');
    if (d.kind === 'edit' && d.moved) { finishItems(d.items); if (api.state()) api.preview(cursor); }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', e => {
    const tr = e.target.closest('.tlTrack'); if (!tr || api.busy()) return;
    const el = e.target.closest('[data-k]'), t = Math.max(0, T(e.clientX - canvas.getBoundingClientRect().left));
    if (el && /^[tx]:/.test(el.dataset.k)) { openSheet(el.dataset.k); return; }
    if (el) return;
    if (tr.dataset.track === 't') addCaption(t);
    if (tr.dataset.track === 'cam') { api.addShotAt(t); render(); }
    if (tr.dataset.track.startsWith('x:')) { cursor = t; addItem(tracks.find(x => 'x:' + x.key === tr.dataset.track)); }
  });
  canvas.addEventListener('contextmenu', e => {
    const el = e.target.closest('.tlKey'); if (!el) return;
    e.preventDefault(); select(el.dataset.k); keyMenu(tracksEl.querySelector(`[data-k="${CSS.escape(el.dataset.k)}"]`) || el, el.dataset.k);
  });
  scroll.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - scroll.getBoundingClientRect().left); return; }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); scroll.scrollLeft += e.deltaY; }
  }, { passive: false });
  let scrollT = 0;
  scroll.addEventListener('scroll', () => {
    if (!open || scrollT) return;
    scrollT = requestAnimationFrame(() => { scrollT = 0; if (api.timeline().wires.length > MAX_SHOWN) render(); else drawRuler(); });
  });

  /* ---------- Barre et clavier ---------- */
  root.querySelector('.tlBar').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'play') { const st = api.state(); if (st && st.playing) api.pause(); else { if (!st && cursor > 0 && cursor < total() - 0.01) { api.preview(cursor); } api.play(); } update(); }
    if (a === 'stop') { api.stop(); cursor = 0; update(); }
    if (a === 'zoomIn') zoom(1.5);
    if (a === 'zoomOut') zoom(1 / 1.5);
    if (a === 'fit') { fit(); render(); scroll.scrollLeft = 0; }
    if (a === 'group') group();
    if (a === 'ungroup') ungroup();
    if (a === 'addCap') addCaption(cursor);
    if (a === 'addX') addItem(tracks.find(x => x.key === b.dataset.tr));
    if (a === 'close') setOpen(false);
  });
  root.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea') || api.busy()) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod) return; // Ctrl+Z, Ctrl+S… : raccourcis de l'application
    let handled = true;
    if (k === ' ') { const st = api.state(); if (st && st.playing) api.pause(); else api.play(); update(); }
    else if (k === 'Home') { cursor = 0; api.preview(0); }
    else if (k === 'End') { cursor = total(); api.preview(cursor); }
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && sel.size) {
      const step = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : GRID);
      const items = itemsOf(sel);
      if (items.length) { applyEdit(items, e.altKey ? 'r' : 'move', step, true, []); finishItems(items); if (api.state()) api.preview(cursor); }
    }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { cursor = Math.max(0, Math.min(total(), cursor + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : GRID))); api.preview(cursor); }
    else if ((k === 'Delete' || k === 'Backspace') && sel.size) removeSel();
    else if (k === 'Escape' && sel.size) select(null);
    else if (k === 'Enter' && sel.size === 1 && /^[tx]:/.test([...sel][0])) openSheet([...sel][0]);
    else if (k.length === 1 && !e.altKey && shortcut(k.toLowerCase())) { /* légende ou note ajoutée */ }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });
  // Le focus suit la sélection faite au clavier (Tab entre extraits, puis flèches).
  tracksEl.addEventListener('focusin', e => { const el = e.target.closest('[data-k]'); if (el && !sel.has(el.dataset.k) && !drag) select(el.dataset.k); });
  // Espace lit la vidéo : le bouton qui a le focus ne doit pas aussi être « cliqué » au relâchement.
  root.addEventListener('keyup', e => { if (e.key === ' ' && !e.target.closest('input, select, textarea')) e.preventDefault(); });

  /* ---------- Hauteur réglable ---------- */
  const grip = $('.tlGrip');
  let H = 210;
  try { H = Math.max(140, Math.min(520, +localStorage.getItem('jollof-tl-h') || 210)); } catch (e) { /* stockage indisponible */ }
  const setH = h => { H = Math.max(140, Math.min(Math.round(innerHeight * 0.6), h)); document.documentElement.style.setProperty('--tl-h', H + 'px'); };
  setH(H);
  grip.addEventListener('pointerdown', e => {
    grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = H;
    const mv = ev => setH(h0 - (ev.clientY - y0));
    const done = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', done); try { localStorage.setItem('jollof-tl-h', String(H)); } catch (err) { /* stockage indisponible */ } };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', done);
  });

  function setOpen(on) {
    if (!on) closeSheet(true, false);
    open = on; root.hidden = !on; api.onToggle(on);
    if (on) { needFit = true; requestAnimationFrame(() => render()); }
    else { const st = api.state(); if (st && !st.playing) api.stop(); sel.clear(); }
  }
  /** Données changées ailleurs (fils, plans, annulation) : on redessine en gardant le zoom. */
  function refresh() {
    if (!open) return;
    const line = api.timeline(), ok = new Set([...line.wires.map(c => key('w', c.id)), ...line.cam.map(c => key('k', c.id)), ...line.caps.map(c => key('t', c.id))]);
    sel = new Set([...sel].filter(k => ok.has(k) || k.startsWith('x:')));
    // Élément du panneau disparu ou remplacé (annulation, projet rouvert) : le panneau se ferme.
    if (sheet) { const f = find(sheet.k); if (!f.obj || (sheet.obj && f.obj !== sheet.obj)) hideSheet(); }
    if (cursor > total()) cursor = total();
    render();
  }
  return { setOpen, toggle: () => setOpen(!open), get open() { return open; }, refresh, update, markWire, render, shortcut };
}
