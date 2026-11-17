// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Panneau « Bande-son » de l'onglet Vidéo : musique (bibliothèque libre ou fichier), effets à chaque fil et à la fin,
// voix off (enregistrée au micro pendant que l'animation défile, ou importée), sonie visée. Préfixe CSS : au.
import { MUSIC, MUSIC_LICENSE, musicById } from './library.js';
import { SFX } from './sfx.js';
import { emptyAudio, MAX_CLIP_B64, MAX_CLIPS } from './mix.js';
import * as engine from './engine.js';

/**
 * h : { host, tl, esc, icon, DEC, status, get() → bande-son, commit() (projet modifié), base,
 *       playhead() → s, playFrom(T), playing() → bool, stopAnim() }.
 * Rend { refresh(), recording() }.
 */
export function installAudio(h) {
  const { tl, esc, icon } = h;
  const root = h.host;
  let rec = null; // enregistrement en cours
  const A = () => h.get();
  const nextClip = a => { let n = 0; for (const k of Object.keys(a.clips)) n = Math.max(n, +k.slice(1)); return `a${n + 1}`; };
  const nextVoice = a => { let n = 0; for (const v of a.voice) n = Math.max(n, +v.id.slice(1)); return `v${n + 1}`; };
  const dB = v => `${v > 0 ? '+' : ''}${String(Math.round(v)).replace('.', h.DEC)} dB`;
  const sec = v => `${v.toFixed(1).replace('.', h.DEC)} s`;
  const moods = [...new Set(MUSIC.map(m => m.mood))];

  async function addClip(blob, name) {
    const a = A();
    if (Object.keys(a.clips).length >= MAX_CLIPS) throw new Error(tl('Trop de sons dans ce projet.'));
    const b64 = await engine.blobToB64(blob);
    if (b64.length > MAX_CLIP_B64) throw new Error(tl('Fichier trop long (20 Mo au plus).'));
    const id = nextClip(a);
    a.clips[id] = { mime: blob.type || 'audio/mpeg', b64, name: String(name || '').slice(0, 80) };
    try { await engine.clipDuration(id, a.clips[id]); } catch (e) { delete a.clips[id]; throw new Error(tl('Ce fichier audio ne se lit pas sur ce système.')); }
    return id;
  }
  /** Supprime les sons importés qui ne servent plus. */
  function prune(a) {
    const used = new Set([...a.voice.map(v => v.clip), a.music && a.music.clip].filter(Boolean));
    for (const k of Object.keys(a.clips)) if (!used.has(k)) delete a.clips[k];
  }
  // Champ de fichier attaché à la page le temps du choix (WebKit ignore le clic sur un champ détaché).
  const pick = accept => new Promise(res => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept, hidden: true });
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    document.body.appendChild(i); i.click();
  });
  const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm';

  function render() {
    const a = A(), m = a.music, cur = m ? (m.id ? `lib:${m.id}` : `clip:${m.clip}`) : '';
    const imported = Object.entries(a.clips).filter(([k]) => m && m.clip === k);
    const info = m && m.id ? musicById(m.id) : null;
    const opt = (v, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    const sfxOpts = sel => `<option value="">${esc(tl('Aucun'))}</option>${SFX.map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${esc(tl(s.name))}</option>`).join('')}`;
    root.innerHTML = `
      <h2>${icon('music')}${esc(tl('Bande-son'))}</h2>
      <div class="auBlock">
        <label class="field">${esc(tl('Musique'))}
          <span class="auRow"><select data-au="music">${opt('', tl('Aucune'))}
            ${moods.map(md => `<optgroup label="${esc(tl(md))}">${MUSIC.filter(x => x.mood === md).map(x => opt(`lib:${x.id}`, `${x.title} — ${x.artist}`)).join('')}</optgroup>`).join('')}
            ${imported.map(([k, c]) => opt(`clip:${k}`, c.name || tl('Fichier importé'))).join('')}
            <option value="import">${esc(tl('Importer un fichier…'))}</option></select>
          <button type="button" class="btn auIco" data-au="prevMusic" ${m ? '' : 'disabled'} title="${esc(tl('Écouter'))}" aria-label="${esc(tl('Écouter'))}">${icon('play')}</button></span>
        </label>
        ${info ? `<p class="auNote">${esc(info.title)} — ${esc(info.artist)} · ${esc(MUSIC_LICENSE)} · ${esc(tl('libre de droits, sans attribution obligatoire'))}</p>` : ''}
        ${m ? `<label class="field"><span class="fh">${esc(tl('Volume de la musique'))} <output>${dB(m.gain)}</output></span><input type="range" data-au="mGain" min="-30" max="0" step="1" value="${m.gain}"></label>
        <div class="grid2"><label class="field">${esc(tl('Fondu d’entrée (s)'))}<input type="number" data-au="fadeIn" min="0" max="10" step="0.5" value="${m.fadeIn}"></label>
        <label class="field">${esc(tl('Fondu de sortie (s)'))}<input type="number" data-au="fadeOut" min="0" max="10" step="0.5" value="${m.fadeOut}"></label></div>` : ''}
      </div>
      <div class="auBlock">
        <div class="grid2">
          <label class="field">${esc(tl('Son à chaque fil'))}<span class="auRow"><select data-au="wire">${sfxOpts(a.sfx.wire)}</select><button type="button" class="btn auIco" data-au="prevWire" ${a.sfx.wire ? '' : 'disabled'} aria-label="${esc(tl('Écouter'))}">${icon('play')}</button></span></label>
          <label class="field">${esc(tl('Son de fin'))}<span class="auRow"><select data-au="done">${sfxOpts(a.sfx.done)}</select><button type="button" class="btn auIco" data-au="prevDone" ${a.sfx.done ? '' : 'disabled'} aria-label="${esc(tl('Écouter'))}">${icon('play')}</button></span></label>
        </div>
        ${a.sfx.wire || a.sfx.done ? `<label class="field"><span class="fh">${esc(tl('Volume des effets'))} <output>${dB(a.sfx.gain)}</output></span><input type="range" data-au="sGain" min="-30" max="0" step="1" value="${a.sfx.gain}"></label>` : ''}
      </div>
      <div class="auBlock">
        <span class="auLabel">${icon('mic')}${esc(tl('Voix off'))}</span>
        <div class="auRow">
          <button type="button" class="btn ${rec ? 'auRec' : 'primary'} auGrow" data-au="rec">${icon(rec ? 'stop' : 'record')}<span>${esc(rec ? tl('Arrêter l’enregistrement') : tl('Enregistrer la voix'))}</span>${rec ? '<span class="auMeter"><span></span></span>' : ''}</button>
          <button type="button" class="btn" data-au="importVoice" ${rec ? 'disabled' : ''}>${icon('upload')}<span>${esc(tl('Importer'))}</span></button>
        </div>
        <p class="auNote">${esc(tl('L’animation défile depuis la tête de lecture pendant que vous parlez : la voix tombe au bon moment. Un casque évite que la musique entre dans le micro.'))}</p>
        ${a.voice.length ? `<ul class="auVoices">${a.voice.map(v => `<li data-v="${esc(v.id)}">
            <span class="auName" title="${esc(v.name)}">${esc(v.name || v.id)}</span>
            <label>${esc(tl('Début'))} <input type="number" data-au="vT" min="0" max="3600" step="0.1" value="${v.t}"></label>
            <label title="${esc(tl('Volume'))}"><input type="range" data-au="vGain" min="-20" max="12" step="1" value="${v.gain}"></label>
            <button type="button" class="btn auIco" data-au="vHead" title="${esc(tl('Placer à la tête de lecture'))}" aria-label="${esc(tl('Placer à la tête de lecture'))}">${icon('pin')}</button>
            <button type="button" class="btn auIco" data-au="vPlay" aria-label="${esc(tl('Écouter'))}">${icon('play')}</button>
            <button type="button" class="btn auIco" data-au="vDel" aria-label="${esc(tl('Supprimer'))}">${icon('trash')}</button></li>`).join('')}</ul>
          <label class="field"><span class="fh">${esc(tl('Musique baissée sous la voix'))} <output>${a.duck ? dB(-a.duck) : tl('non')}</output></span><input type="range" data-au="duck" min="0" max="24" step="1" value="${a.duck}"></label>` : ''}
      </div>
      <label class="field">${esc(tl('Sonie visée'))}<select data-au="target">
        <option value="web"${a.target === 'web' ? ' selected' : ''}>${esc(tl('Web, YouTube : −14 LUFS, crête −1 dBTP'))}</option>
        <option value="ebu"${a.target === 'ebu' ? ' selected' : ''}>${esc(tl('Télévision, UER R 128 : −23 LUFS, crête −1 dBTP'))}</option>
        <option value="atsc"${a.target === 'atsc' ? ' selected' : ''}>${esc(tl('Télévision, ATSC A/85 : −24 LKFS, crête −2 dBTP'))}</option></select></label>`;
    hydrate();
  }
  function hydrate() { /* icônes déjà en SVG (icon()) */ }

  const set = (fn, redraw = true) => { fn(A()); engine.stop(); h.commit(); if (redraw) render(); };

  root.addEventListener('change', async e => {
    const el = e.target.closest('[data-au]'); if (!el) return;
    const k = el.dataset.au, v = el.value, li = el.closest('[data-v]');
    try {
      if (k === 'music') {
        if (v === 'import') {
          render(); const f = await pick(ACCEPT); if (!f) return;
          h.status(tl('Lecture du fichier…'));
          const id = await addClip(f, f.name);
          set(a => { a.music = { id: null, clip: id, gain: -12, start: 0, fadeIn: 1, fadeOut: 2, loop: true }; prune(a); });
          h.status(tl('Musique importée : {0}', f.name), 'ok');
        } else set(a => { a.music = v ? { ...(a.music || { gain: -12, start: 0, fadeIn: 1, fadeOut: 2, loop: true }), id: v.startsWith('lib:') ? v.slice(4) : null, clip: v.startsWith('clip:') ? v.slice(5) : null } : null; prune(a); });
      } else if (k === 'wire' || k === 'done') set(a => { a.sfx[k] = v || null; });
      else if (k === 'fadeIn' || k === 'fadeOut') set(a => { a.music[k] = Math.max(0, Math.min(10, +v || 0)); }, false);
      else if (k === 'target') set(a => { a.target = v; }, false);
      else if (k === 'vT' && li) set(a => { const x = a.voice.find(q => q.id === li.dataset.v); if (x) x.t = Math.max(0, Math.min(3600, +v || 0)); }, false);
      else if (k === 'mGain' || k === 'sGain' || k === 'duck' || k === 'vGain') onInput(e);
    } catch (err) { h.status(err.message || String(err), 'err'); }
  });
  function onInput(e) {
    const el = e.target.closest('[data-au]'); if (!el) return;
    const k = el.dataset.au, v = +el.value, out = el.closest('.field') && el.closest('.field').querySelector('output'), a = A();
    if (k === 'mGain' && a.music) a.music.gain = v;
    else if (k === 'sGain') a.sfx.gain = v;
    else if (k === 'duck') a.duck = v;
    else if (k === 'vGain') { const x = a.voice.find(q => q.id === el.closest('[data-v]').dataset.v); if (x) x.gain = v; }
    else return;
    if (out) out.textContent = k === 'duck' ? (v ? dB(-v) : tl('non')) : dB(v);
    if (e.type === 'change') { engine.stop(); h.commit(); }
  }
  root.addEventListener('input', onInput);

  root.addEventListener('click', async e => {
    const b = e.target.closest('button[data-au]'); if (!b) return;
    const k = b.dataset.au, a = A(), li = b.closest('[data-v]'), v = li && a.voice.find(q => q.id === li.dataset.v);
    try {
      if (k === 'prevMusic' && a.music) await engine.preview(a.music.id ? 'music' : 'clip', a.music.id || a.music.clip, a, h.base);
      else if (k === 'prevWire' && a.sfx.wire) await engine.preview('sfx', a.sfx.wire);
      else if (k === 'prevDone' && a.sfx.done) await engine.preview('sfx', a.sfx.done);
      else if (k === 'vPlay' && v) await engine.preview('clip', v.clip, a);
      else if (k === 'vHead' && v) set(x => { x.voice.find(q => q.id === v.id).t = Math.round(h.playhead() * 10) / 10; });
      else if (k === 'vDel' && v) set(x => { x.voice = x.voice.filter(q => q.id !== v.id); prune(x); });
      else if (k === 'importVoice') {
        const f = await pick(ACCEPT); if (!f) return;
        h.status(tl('Lecture du fichier…'));
        const id = await addClip(f, f.name), t = Math.round(h.playhead() * 10) / 10;
        set(x => { x.voice.push({ id: nextVoice(x), clip: id, t, gain: 0, name: f.name.slice(0, 80) }); });
        h.status(tl('Voix importée à {0}.', sec(t)), 'ok');
      } else if (k === 'rec') await (rec ? stopRecording() : startRecording());
    } catch (err) { h.status(err.message || String(err), 'err'); }
  });

  /* ---------- Enregistrement : décompte, animation qui défile, niveau du micro ---------- */
  async function startRecording() {
    engine.stop();
    const t0 = Math.round(h.playhead() * 10) / 10;
    let mic;
    try { mic = await engine.recordVoice(); } catch (e) { throw new Error(tl('Micro inaccessible : autorisez-le pour Jollof Studio dans les réglages du système. ({0})', e.message || e)); }
    mic.cancel(); // l'accès est accordé ; on rouvre au bon moment, après le décompte
    for (const n of [3, 2, 1]) { h.status(tl('Enregistrement dans {0}…', n)); await new Promise(r => setTimeout(r, 700)); }
    mic = await engine.recordVoice();
    rec = { mic, t0, started: performance.now(), timer: 0 };
    h.playFrom(t0);
    render();
    h.status(tl('Parlez… (fin de l’animation ou bouton pour arrêter)'));
    const meter = () => {
      if (!rec) return;
      const bar = root.querySelector('.auMeter span'), p = rec.mic.level();
      if (bar) { bar.style.width = `${Math.min(100, p * 140).toFixed(0)}%`; bar.classList.toggle('hot', p > 0.89); }
      if (!h.playing() && performance.now() - rec.started > 800) { stopRecording(); return; }
      rec.timer = requestAnimationFrame(meter);
    };
    meter();
  }
  async function stopRecording() {
    if (!rec) return;
    const r = rec; rec = null; cancelAnimationFrame(r.timer);
    h.stopAnim();
    const { blob } = await r.mic.stop();
    if (blob.size < 2000) { render(); h.status(tl('Enregistrement vide.'), 'warn'); return; }
    const a = A(), n = a.voice.length + 1;
    const id = await addClip(blob, tl('Voix {0}', n));
    set(x => { x.voice.push({ id: nextVoice(x), clip: id, t: r.t0, gain: 0, name: tl('Voix {0}', n) }); });
    h.status(tl('Voix enregistrée à {0} ; elle sera dans la vidéo.', sec(r.t0)), 'ok');
  }

  render();
  return { refresh: () => { if (!rec) render(); }, recording: () => !!rec, emptyAudio };
}
