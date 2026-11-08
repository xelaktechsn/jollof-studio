// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Broches d'un programme MicroPython, vues par le vérificateur (pendant de pinFacts pour le C++) : Pin(15, Pin.OUT)
// est une sortie, Pin(2, Pin.IN, Pin.PULL_UP) une entrée tirée, ADC(26) une entrée analogique, PWM(Pin(15)) une
// sortie PWM, I2C/SPI/UART/DHT/OneWire des broches gérées par leur bibliothèque, NeoPixel une sortie.
// Prudence d'abord : dès qu'une broche est calculée (variable de boucle, liste, Pin.init(), Pin.mode()…), le
// programme redevient « dynamique » — toute broche reliée peut être une sortie, à LOW comme à HIGH — et la preuve
// reste valable. Ce que l'analyse lit en clair ne fait que retirer des cas impossibles (un potentiomètre sur une
// entrée ADC n'est pas une sortie qui force contre lui).

const isPy = src => /^\s*(from\s+machine\s+import\b|import\s+machine\b)/m.test(src);

/** Commentaires retirés (les chaînes restent : Pin('LED')), positions conservées. */
function stripComments(src) {
  let out = '', q = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { out += ch; if (ch === '\\') { out += src[++i] || ''; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } out += '\n'; continue; }
    out += ch;
  }
  return out;
}
/** Arguments de premier niveau d'un appel dont la parenthèse ouvrante est en i : { args: [texte], end }. */
function argsAt(s, i) {
  let depth = 0, start = i + 1, q = null;
  const args = [];
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) { args.push(s.slice(start, j).trim()); return { args: args.filter(a => a !== ''), end: j }; } }
    else if (ch === ',' && depth === 1) { args.push(s.slice(start, j).trim()); start = j + 1; }
  }
  return null;
}
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

/**
 * src : texte du programme (fichiers .py mis bout à bout), prof : profil de la carte. Rend null si ce n'est pas
 * du MicroPython, sinon { ok: true, pins: Map clé → { modes, writes, reads, lib, at }, dynamic, uses }.
 */
export function pyPinFacts(src, prof) {
  if (!src || !isPy(src)) return null;
  const s = stripComments(src), out = { ok: true, pins: new Map(), dynamic: false, uses: [], python: true };
  const byNum = new Map(Object.entries(prof.gpio).filter(([, g]) => typeof g.n === 'number').map(([k, g]) => [g.n, k]));
  // Constantes : NOM = entier, affecté une seule fois au niveau du module.
  const consts = new Map(), assignedTwice = new Set();
  for (const m of s.matchAll(/^([A-Za-z_]\w*)\s*=\s*(\d+)\s*$/gm)) { if (consts.has(m[1])) assignedTwice.add(m[1]); consts.set(m[1], +m[2]); }
  for (const n of assignedTwice) consts.delete(n);
  // Variables qui tiennent une broche : led = Pin(15, Pin.OUT).
  const pinVars = new Map();
  const rec = (key, at) => { if (!out.pins.has(key)) out.pins.set(key, { modes: new Set(), writes: new Set(), reads: new Set(), lib: false, at: [] }); const r = out.pins.get(key); r.at.push(at); return r; };
  /** Numéro de broche d'une expression : 15, LED_PIN, Pin(15…), 'GP15', une variable liée à une broche. */
  function pinOf(expr, at) {
    let e = expr.trim();
    if (/^(machine\.)?Pin\s*\(/.test(e)) { const a = argsAt(e, e.indexOf('(')); e = a && a.args[0] ? a.args[0].replace(/^id\s*=\s*/, '') : ''; }
    if (/^\d+$/.test(e)) return { n: +e };
    if (consts.has(e)) return { n: consts.get(e) };
    if (pinVars.has(e)) return { n: pinVars.get(e) };
    const str = /^['"](GP)?(\d+|LED)['"]$/.exec(e);
    if (str) return str[2] === 'LED' ? { led: true } : { n: +str[2] };
    out.dynamic = true; // broche calculée : on ne sait pas laquelle
    return null;
  }
  function keyOf(p, at) {
    if (!p || p.led) return null; // LED de la carte (GP25) : interne, rien à vérifier
    const key = byNum.get(p.n);
    if (key == null && p.n !== 25) out.uses.push({ key: null, value: p.n, line: at.line, col: at.col });
    return key || null;
  }
  // 1. Appels Pin(...) : sens d'après leurs arguments ; ceux affectés à une variable sont mémorisés.
  for (const m of s.matchAll(/(?<![\w.])(?:machine\.)?Pin\s*\(/g)) {
    const i = m.index + m[0].length - 1, a = argsAt(s, i); if (!a || !a.args.length) continue;
    const at = { line: lineOf(s, m.index), col: 1 }, p = pinOf(`Pin(${a.args.join(',')})`, at);
    const before = s.slice(Math.max(0, m.index - 80), m.index);
    const asg = /(?:^|\n)[ \t]*([A-Za-z_]\w*)\s*=\s*$/.exec(before); // led = Pin(…), pas sda=Pin(…)
    if (asg && p && p.n != null) pinVars.set(asg[1], p.n);
    // Dans un autre appel (ADC, PWM, I2C…) : c'est cet appel qui décide (étape 2).
    if (/(\(|,|=)\s*$/.test(before) && !asg) continue;
    const key = keyOf(p, at); if (!key) continue;
    const r = rec(key, at), rest = a.args.slice(1).join(',');
    if (/Pin\.(OUT|OPEN_DRAIN)\b/.test(rest)) { r.modes.add('out'); r.writes.add('d'); }
    else if (/Pin\.PULL_UP\b/.test(rest)) r.modes.add('pullup');
    else if (/Pin\.PULL_DOWN\b/.test(rest)) r.modes.add('pulldown');
    else if (/Pin\.IN\b/.test(rest)) r.modes.add('in');
    else { r.modes.add('out'); r.writes.add('d'); } // sens non dit : le pire, une sortie
  }
  // 2. Bibliothèques : ce que chaque appel fait de ses broches.
  const CALLS = [
    [/(?<![\w.])(?:machine\.)?ADC\s*\(/g, (r) => r.reads.add('a')],
    [/(?<![\w.])(?:machine\.)?PWM\s*\(/g, (r) => { r.modes.add('out'); r.writes.add('pwm'); }],
    [/(?<![\w.])(?:neopixel\.)?NeoPixel\s*\(/g, (r) => { r.modes.add('out'); r.writes.add('d'); }],
    [/(?<![\w.])(?:dht\.)?DHT(?:11|22)\s*\(/g, (r) => { r.lib = true; }],
    [/(?<![\w.])(?:onewire\.)?OneWire\s*\(/g, (r) => { r.lib = true; }]
  ];
  for (const [re, apply] of CALLS) for (const m of s.matchAll(re)) {
    const a = argsAt(s, m.index + m[0].length - 1); if (!a || !a.args.length) continue;
    const at = { line: lineOf(s, m.index), col: 1 }, arg = a.args[0].replace(/^pin\s*=\s*/, '');
    // ADC(0) à ADC(3) : canaux de l'ADC (GP26 à GP28, capteur de température) ; ADC(Pin(26)) ou ADC(26) : broche.
    if (/ADC/.test(m[0]) && /^\d$/.test(arg)) { const ch = +arg; if (ch <= 2) apply(rec(byNum.get(26 + ch), at)); continue; }
    const key = keyOf(pinOf(arg, at), at); if (key) apply(rec(key, at));
  }
  // Bus : broches nommées sda=, scl=, sck=, mosi=, miso=, tx=, rx= ; gérées par le périphérique.
  for (const m of s.matchAll(/(?<![\w.])(?:machine\.)?(?:Soft)?(?:I2C|SPI|UART)\s*\(/g)) {
    const a = argsAt(s, m.index + m[0].length - 1); if (!a) continue;
    const at = { line: lineOf(s, m.index), col: 1 };
    for (const arg of a.args) {
      const kw = /^(sda|scl|sck|mosi|miso|tx|rx|cs)\s*=\s*(.+)$/.exec(arg); if (!kw) continue;
      const key = keyOf(pinOf(kw[2].trim(), at), at); if (key) rec(key, at).lib = true;
    }
  }
  // Changement de sens après coup (pin.init(Pin.OUT), pin.mode(…)) : on ne suit pas, prudence.
  if (/\.\s*(init|mode)\s*\(/.test(s) && /Pin\.(OUT|IN|OPEN_DRAIN)/.test(s.replace(/(?<![\w.])(?:machine\.)?Pin\s*\([^)]*\)/g, ''))) out.dynamic = true;
  return out;
}
