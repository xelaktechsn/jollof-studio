// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Éditeur de code Arduino léger : une zone de texte transparente posée sur une copie
// colorée du code, avec numéros de ligne, repères d'erreur, ligne en cours d'exécution,
// points d'arrêt et ligne d'arrêt du débogueur.
import { FN, CONSTS, CLASSES, OBJECTS } from './api.js';
import { tl } from '../i18n/index.js';

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const KW = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof', 'true', 'false', 'enum', 'struct', 'class', 'const', 'static', 'volatile', 'constexpr', 'new', 'delete', 'this', 'typedef', 'nullptr', 'NULL']);
const TY = new Set(['void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'byte', 'word', 'String', 'size_t', 'unsigned', 'signed', 'auto',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', ...Object.keys(CLASSES)]);
const BI = new Set([...Object.keys(FN), 'setup', 'loop']);
const CO = new Set([...Object.keys(CONSTS), 'LED_BUILTIN', ...Object.keys(OBJECTS), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)[uUlLfF]*\b)|([A-Za-z_]\w*)/gm;

/** Jetons colorés, découpés ligne par ligne. */
function highlight(src) {
  const lines = [[]];
  const push = (cls, text) => {
    const parts = text.split('\n');
    parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push(cls ? `<span class="${cls}">${esc(p)}</span>` : esc(p)); });
  };
  let last = 0, m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    if (m.index > last) push('', src.slice(last, m.index));
    const [t, com, str, pp, num, id] = m;
    if (com) push('tc', t);
    else if (str) push('ts', t);
    else if (pp) push('tp', t);
    else if (num) push('tn', t);
    else if (id) push(KW.has(id) ? 'tk' : TY.has(id) ? 'tt' : BI.has(id) ? 'tf' : CO.has(id) ? 'to' : /^\s*\(/.test(src.slice(RE.lastIndex, RE.lastIndex + 3)) ? 'tu' : '', t);
    last = RE.lastIndex;
    if (!t.length) RE.lastIndex++;
  }
  if (last < src.length) push('', src.slice(last));
  return lines.map(l => l.join(''));
}

/**
 * Crée l'éditeur dans `root`.
 * o : { onChange(text), onRun(), onGutter(ligne) (clic dans la marge : point d'arrêt), placeholder }
 */
export function createEditor(root, o = {}) {
  root.classList.add('ed');
  root.innerHTML = `<div class="edGut" aria-hidden="true"></div><div class="edBox"><pre class="edHl" aria-hidden="true"></pre><textarea class="edTa" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="${tl('Code Arduino')}"></textarea></div>`;
  const gut = root.querySelector('.edGut'), hl = root.querySelector('.edHl'), ta = root.querySelector('.edTa');
  if (o.placeholder) ta.placeholder = o.placeholder;
  let marks = { errors: [], warnings: [] }, runLine = 0, lineEls = [], gutEls = [];
  // Débogueur : points d'arrêt (lignes valides = où le programme peut s'arrêter, sinon rond creux) et ligne d'arrêt.
  let bps = new Set(), bpValid = null, pauseLine = 0;
  if (o.onGutter) root.classList.add('bpOn');
  const bpCls = n => (bps.has(n) ? (bpValid && !bpValid.has(n) ? ' bp off' : ' bp') : '');

  function paint() {
    const html = highlight(ta.value), err = new Map(), warn = new Map(), sq = new Map();
    marks.errors.forEach(e => err.set(e.line, e.msg));
    marks.warnings.forEach(w => { if (!err.has(w.line)) warn.set(w.line, w.msg); });
    // Soulignement ondulé de la partie fautive (colonne et longueur), comme dans un éditeur de code moderne.
    [...marks.errors.map(e => [e, '']), ...marks.warnings.map(w => [w, ' warn'])].forEach(([m, k]) => {
      if (!m.line || !m.col) return;
      if (!sq.has(m.line)) sq.set(m.line, '');
      sq.set(m.line, sq.get(m.line) + `<i class="sq${k}" style="left:${m.col - 1}ch;width:${Math.max(1, m.len || 1)}ch"></i>`);
    });
    hl.innerHTML = html.map((l, i) => `<div class="cl${err.has(i + 1) ? ' err' : warn.has(i + 1) ? ' warn' : ''}${pauseLine === i + 1 ? ' pause' : ''}">${l || ' '}${sq.get(i + 1) || ''}</div>`).join('');
    gut.innerHTML = html.map((_, i) => {
      const n = i + 1, m = err.get(n) || warn.get(n);
      return `<div class="gl${err.has(n) ? ' err' : warn.has(n) ? ' warn' : ''}${bpCls(n)}${pauseLine === n ? ' pause' : ''}"${m ? ` title="${esc(m).replace(/"/g, '&quot;')}"` : ''}>${n}</div>`;
    }).join('') + '<div class="gl pad"></div>';
    lineEls = [...hl.children]; gutEls = [...gut.children];
    const r = runLine; runLine = 0; setRunLine(r);
    sync();
  }
  function sync() { hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gut.scrollTop = ta.scrollTop; }
  function setRunLine(n) {
    if (n === runLine) return;
    if (lineEls[runLine - 1]) { lineEls[runLine - 1].classList.remove('run'); gutEls[runLine - 1].classList.remove('run'); }
    runLine = n;
    if (lineEls[n - 1]) { lineEls[n - 1].classList.add('run'); gutEls[n - 1].classList.add('run'); }
  }
  const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
  const insert = text => { ta.focus(); if (!document.execCommand('insertText', false, text)) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } };
  /** Remplace les lignes sélectionnées en gardant l'historique d'annulation du navigateur. */
  function editLines(fn) {
    const v = ta.value, a = lineStart(v, ta.selectionStart), endIdx = v.indexOf('\n', ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? 1 : 0));
    const b = endIdx < 0 ? v.length : endIdx, block = v.slice(a, b), next = fn(block.split('\n')).join('\n');
    ta.setSelectionRange(a, b); insert(next); ta.setSelectionRange(a, a + next.length);
  }
  ta.addEventListener('input', () => { paint(); o.onChange && o.onChange(ta.value); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); o.onRun && o.onRun(); return; }
    if (ta.readOnly) return; // programme en pause : le texte ne change pas
    if (mod && (e.key === '/' || e.code === 'Slash')) {
      e.preventDefault();
      editLines(ls => { const all = ls.filter(l => l.trim()).every(l => /^\s*\/\//.test(l)); return ls.map(l => (!l.trim() ? l : all ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.replace(/^(\s*)/, '$1// '))); });
      return;
    }
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      if (e.shiftKey) editLines(ls => ls.map(l => l.replace(/^ {1,2}/, '')));
      else if (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) editLines(ls => ls.map(l => '  ' + l));
      else insert('  ');
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const v = ta.value, i = ta.selectionStart, line = v.slice(lineStart(v, i), i), ind = /^\s*/.exec(line)[0];
      const opens = /[{(\[]\s*$/.test(line), closesNext = /^\s*[}\])]/.test(v.slice(ta.selectionEnd));
      if (opens && closesNext) { insert('\n' + ind + '  \n' + ind); const p = i + 1 + ind.length + 2; ta.setSelectionRange(p, p); }
      else insert('\n' + ind + (opens ? '  ' : ''));
      return;
    }
    if (e.key === '}' && !mod) {
      const v = ta.value, i = ta.selectionStart, a = lineStart(v, i);
      if (/^\s+$/.test(v.slice(a, i)) && ta.selectionStart === ta.selectionEnd) { e.preventDefault(); ta.setSelectionRange(Math.max(a, i - 2), i); insert('}'); }
    }
  });
  gut.addEventListener('click', e => {
    const g = e.target.closest('.gl'); if (!g || g.classList.contains('pad')) return;
    const n = gutEls.indexOf(g) + 1;
    if (o.onGutter) o.onGutter(n); else goLine(n);
  });
  /* --- Débogueur --- */
  /** Points d'arrêt affichés ; valid : lignes où le programme peut s'arrêter (null : inconnues). */
  function setBreakpoints(set, valid = bpValid) {
    bps = new Set(set); bpValid = valid || null;
    gutEls.forEach((g, i) => { if (!g.classList.contains('pad')) { const c = bpCls(i + 1); g.classList.toggle('bp', !!c); g.classList.toggle('off', c.includes('off')); } });
  }
  function setPauseLine(n) {
    if (n === pauseLine) return;
    if (lineEls[pauseLine - 1]) { lineEls[pauseLine - 1].classList.remove('pause'); gutEls[pauseLine - 1].classList.remove('pause'); }
    pauseLine = n;
    if (lineEls[n - 1]) { lineEls[n - 1].classList.add('pause'); gutEls[n - 1].classList.add('pause'); }
  }
  /** Fait défiler jusqu'à la ligne n sans prendre le focus (ni bouger le curseur). */
  function reveal(n) {
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18, top = (n - 1) * lh + 8;
    if (top < ta.scrollTop + lh || top > ta.scrollTop + ta.clientHeight - lh * 2) { ta.scrollTop = Math.max(0, top - ta.clientHeight / 3); sync(); }
  }
  function readOnly(on) { ta.readOnly = !!on; root.classList.toggle('ro', !!on); }
  /** Ligne du curseur (F9 : point d'arrêt). */
  const caretLine = () => ta.value.slice(0, ta.selectionStart).split('\n').length;
  function goLine(n, col = 1) {
    const ls = ta.value.split('\n'); n = Math.max(1, Math.min(n, ls.length));
    let p = 0; for (let i = 0; i < n - 1; i++) p += ls[i].length + 1;
    ta.focus(); ta.setSelectionRange(p + col - 1, p + ls[n - 1].length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const top = (n - 1) * lh;
    if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    sync();
  }
  paint();
  return {
    get value() { return ta.value; },
    set value(v) { if (v === ta.value) return; ta.value = v; paint(); },
    setMarks(m) { marks = { errors: m.errors || [], warnings: m.warnings || [] }; paint(); },
    setRunLine, goLine, setBreakpoints, setPauseLine, reveal, readOnly, caretLine,
    focus() { ta.focus(); },
    el: ta
  };
}
