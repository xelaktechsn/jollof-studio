// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Éditeur de code Arduino léger : une zone de texte transparente posée sur une copie
// colorée du code, avec numéros de ligne, repères d'erreur, ligne en cours d'exécution,
// points d'arrêt et ligne d'arrêt du débogueur. Il sait aussi le Python (cartes sous MicroPython) :
// coloration, indentation de 4 espaces après « : », commentaires « # ».
import { FN, CONSTS, CLASSES, OBJECTS } from './api.js';
import { tl } from '../i18n/index.js';

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const KW = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof', 'true', 'false', 'enum', 'struct', 'class', 'const', 'static', 'volatile', 'constexpr', 'new', 'delete', 'this', 'typedef', 'nullptr', 'NULL']);
const TY = new Set(['void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'byte', 'word', 'String', 'size_t', 'unsigned', 'signed', 'auto',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', ...Object.keys(CLASSES)]);
const BI = new Set([...Object.keys(FN), 'setup', 'loop']);
const CO = new Set([...Object.keys(CONSTS), 'LED_BUILTIN', ...Object.keys(OBJECTS), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)[uUlLfF]*\b)|([A-Za-z_]\w*)/gm;

// Python (MicroPython) : mots-clés, fonctions intégrées, modules et classes de la carte.
const PY_KW = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const PY_BI = new Set(['print', 'range', 'len', 'int', 'float', 'str', 'bool', 'bytes', 'bytearray', 'list', 'dict', 'tuple', 'set', 'abs', 'min', 'max', 'sum', 'round', 'input', 'open', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed', 'isinstance', 'type', 'hex', 'bin', 'ord', 'chr', 'divmod', 'pow', 'super', 'object', 'getattr', 'setattr', 'hasattr', 'iter', 'next', 'any', 'all', 'callable', 'repr', 'id', 'hash', 'memoryview', 'Exception', 'ValueError', 'TypeError', 'OSError', 'KeyboardInterrupt', 'RuntimeError', 'IndexError', 'KeyError', 'ZeroDivisionError', 'StopIteration']);
const PY_TY = new Set(['machine', 'Pin', 'ADC', 'PWM', 'I2C', 'SoftI2C', 'SPI', 'SoftSPI', 'UART', 'Timer', 'RTC', 'WDT', 'time', 'utime', 'dht', 'DHT11', 'DHT22', 'onewire', 'OneWire', 'ds18x20', 'DS18X20', 'neopixel', 'NeoPixel', 'micropython', 'rp2', 'StateMachine', 'sys', 'os', 'math', 'random', 'gc', 'struct', 'json', 'framebuf', 'select', 'asyncio', 'uasyncio']);
const PY_RE = /(#[^\n]*)|((?:[rRbBfFuU]{1,2})?(?:'''[\s\S]*?(?:'''|(?![\s\S]))|"""[\s\S]*?(?:"""|(?![\s\S]))|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))|(^[ \t]*@[\w.]+)|(\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?|\.\d+)\b)|([A-Za-z_]\w*)/gm;
const pyClass = id => (PY_KW.has(id) ? 'tk' : PY_TY.has(id) ? 'tt' : PY_BI.has(id) ? 'tf' : id === 'self' || id === 'cls' ? 'to' : '');

/** Jetons colorés, découpés ligne par ligne. lang : 'cpp' (Arduino) ou 'python'. */
export function highlight(src, lang = 'cpp') {
  const py = lang === 'python', re = py ? PY_RE : RE;
  const lines = [[]];
  const push = (cls, text) => {
    const parts = text.split('\n');
    parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push(cls ? `<span class="${cls}">${esc(p)}</span>` : esc(p)); });
  };
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) push('', src.slice(last, m.index));
    const [t, com, str, pp, num, id] = m;
    const call = () => /^\s*\(/.test(src.slice(re.lastIndex, re.lastIndex + 3)) ? 'tu' : '';
    if (com) push('tc', t);
    else if (str) push('ts', t);
    else if (pp) push('tp', t);
    else if (num) push('tn', t);
    else if (id) push(py ? pyClass(id) || call() : KW.has(id) ? 'tk' : TY.has(id) ? 'tt' : BI.has(id) ? 'tf' : CO.has(id) ? 'to' : call(), t);
    last = re.lastIndex;
    if (!t.length) re.lastIndex++;
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
  let marks = { errors: [], warnings: [] }, runLine = 0, lineEls = [], gutEls = [], lang = 'cpp';
  const py = () => lang === 'python', IND = () => (py() ? '    ' : '  ');
  // Débogueur : points d'arrêt (lignes valides = où le programme peut s'arrêter, sinon rond creux) et ligne d'arrêt.
  let bps = new Set(), bpValid = null, pauseLine = 0;
  if (o.onGutter) root.classList.add('bpOn');
  const bpCls = n => (bps.has(n) ? (bpValid && !bpValid.has(n) ? ' bp off' : ' bp') : '');

  function paint() {
    const html = highlight(ta.value, lang), err = new Map(), warn = new Map(), sq = new Map();
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
      const c = py() ? '#' : '//', cre = py() ? /^\s*#/ : /^\s*\/\//, unre = py() ? /^(\s*)# ?/ : /^(\s*)\/\/ ?/;
      editLines(ls => { const all = ls.filter(l => l.trim()).every(l => cre.test(l)); return ls.map(l => (!l.trim() ? l : all ? l.replace(unre, '$1') : l.replace(/^(\s*)/, `$1${c} `))); });
      return;
    }
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      if (e.shiftKey) editLines(ls => ls.map(l => l.replace(py() ? /^ {1,4}/ : /^ {1,2}/, '')));
      else if (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) editLines(ls => ls.map(l => IND() + l));
      else insert(IND());
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && py()) {
      // Python : bloc ouvert par « : », fermé après return, pass, break, continue, raise.
      e.preventDefault();
      const v = ta.value, i = ta.selectionStart, line = v.slice(lineStart(v, i), i), ind = /^\s*/.exec(line)[0], code = line.replace(/#.*$/, '').trimEnd();
      insert('\n' + (code.endsWith(':') ? ind + '    ' : /^\s*(return|pass|break|continue|raise)\b/.test(code) ? ind.slice(0, -4) : ind));
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
    if (e.key === '}' && !mod && !py()) {
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
    /** Langage affiché : 'cpp' (Arduino) ou 'python' (MicroPython). */
    setLanguage(l) { l = l === 'python' ? 'python' : 'cpp'; if (l === lang) return; lang = l; ta.setAttribute('aria-label', py() ? tl('Code MicroPython') : tl('Code Arduino')); paint(); },
    get language() { return lang; },
    focus() { ta.focus(); },
    el: ta
  };
}
