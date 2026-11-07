// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Travaux pratiques : contrôle automatique de chaque étape. Indépendant de l'interface : le même
// code vérifie un TP dans l'application et dans les tests (Node), avec un environnement fourni.
//
// Format d'un TP (src/lab/tp/*.json) :
// { id, level: 'college'|'lycee'|'pro', minutes, title: {fr,en}, summary: {fr,en},
//   objectives: [{fr,en}], start: <projet .jollof sans fils>, solution: { wires: [...], code: {…} },
//   steps: [{ title: {fr,en}, text: {fr,en}, hint?: {fr,en}, check?: Check }] }
// Check :
//   { type: 'wire', nets: [["UNO.D7","R1.1"], …] }               liaisons présentes (broches d'un même nœud)
//   { type: 'code', board?: 'UNO', must: ["regex", …], compile: true } programme de la carte
//   { type: 'watch', when?: { BTN1: 'pressed' }, expect: { LED1: 'on' }, hold?: 400 } comportement observé en simulation
//   { type: 'measure', unit: 'V'|'mA'|'s', probe?: ["LED1.A","UNO.GND"], part?: 'LED1', tolerance?: 0.12, state?: {"UNO.D7": 1}, expect?: 1.0 }
//     (expect : valeur fixée, par exemple une durée lue sur le traceur série, au lieu d'un calcul du circuit)
//   { type: 'quiz', options: [{fr,en}], answer: n | [n…] }
// Les noms (UNO, R1, LED1…) sont les repères des composants du montage de départ.

/** Composant et broche désignés par « REPÈRE.BROCHE ». */
export function refOf(comps, s) {
  const i = s.indexOf('.'), name = s.slice(0, i), key = s.slice(i + 1);
  const comp = comps.find(c => c.name === name);
  return comp && comp.pins[key] ? { comp, key } : null;
}
const same = (a, b) => a.comp === b.comp && a.key === b.key;

/**
 * Liaisons demandées : chaque groupe de broches doit former un même nœud. Une broche peut avoir
 * des variantes : « R1.1|R1.2 » (l'une ou l'autre : une résistance se pose dans les deux sens),
 * « UNO.GND* » (toute broche dont le nom commence ainsi : une carte a plusieurs GND).
 */
export function candidates(comps, s) {
  return s.split('|').flatMap(alt => {
    if (!alt.endsWith('*')) { const r = refOf(comps, alt); return r ? [r] : []; }
    const i = alt.indexOf('.'), name = alt.slice(0, i), pre = alt.slice(i + 1, -1), comp = comps.find(c => c.name === name);
    return comp ? Object.keys(comp.pins).filter(k => k.startsWith(pre)).map(key => ({ comp, key })) : [];
  });
}
export function checkWire(check, env) {
  const A = env.analyze(), comps = env.comps(), missing = [], found = [];
  for (const group of check.nets) {
    const alts = group.map(p => candidates(comps, p));
    if (alts.some(a => !a.length)) { missing.push({ group, why: 'absent' }); continue; }
    // Un nœud qui contient une variante de chaque broche du groupe.
    const net = alts[0].map(r0 => A.members(r0)).find(mem => alts.every(a => a.some(r => mem.some(m => same(m, r)))));
    if (!net) { missing.push({ group, why: 'open' }); continue; }
    found.push({ group, net });
  }
  // Composant à variantes (« R1.1|R1.2 ») présent dans plusieurs groupes : ses deux côtés doivent être
  // dans des nœuds différents, sinon il est court-circuité (les deux fils sur la même patte…).
  const multi = new Map();
  for (const f of found) for (const p of f.group) if (p.includes('|')) { const name = p.split('.')[0]; if (!multi.has(name)) multi.set(name, []); multi.get(name).push(f); }
  for (const [name, fs] of multi) if (fs.length > 1 && fs.every(f => f.net === fs[0].net || f.net.some(m => fs[0].net.includes(m)))) missing.push({ group: fs.map(f => f.group.join(' ↔ ')), why: 'short', comp: name });
  return { ok: !missing.length, missing };
}
/** Programme : il compile et contient ce qui est demandé. */
export function checkCode(check, env) {
  const p = env.program(check.board);
  if (!p || !p.code.trim()) return { ok: false, why: 'empty' };
  const missing = (check.must || []).filter(rx => !new RegExp(rx, 'm').test(p.code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  if (check.compile !== false) {
    const r = env.compile(p.code, p.kind);
    if (!r.ok) return { ok: false, why: 'compile', errors: r.errors, missing };
  }
  return { ok: !missing.length, why: missing.length ? 'missing' : null, missing };
}
/** État observable d'un composant : bouton appuyé, LED allumée, buzzer qui sonne… */
export function observe(comp) {
  if (!comp) return null;
  if (comp.type === 'button') return comp.inp && comp.inp.pressed ? 'pressed' : 'released';
  if (comp.led) return comp.led.mat.emissiveIntensity > 0.25 ? 'on' : 'off';
  if (comp.actR && comp.actR.live != null) return comp.actR.live ? 'on' : 'off';
  return null;
}
/** Comportement : quand la condition « when » est vraie, « expect » doit l'être aussi. */
export function checkWatch(check, env) {
  const comps = env.comps(), byName = n => comps.find(c => c.name === n);
  const when = Object.entries(check.when || {}), expect = Object.entries(check.expect || {});
  const cond = when.every(([n, v]) => observe(byName(n)) === v);
  if (!cond) return { ok: false, waiting: true };
  const bad = expect.filter(([n, v]) => observe(byName(n)) !== v);
  return { ok: !bad.length, waiting: false, bad: bad.map(([n]) => n) };
}
/** Valeur attendue d'une mesure (calcul du circuit) : tension entre deux points, ou courant. */
export function expectedMeasure(check, env) {
  // Valeur fixée par le TP (durée lue sur le traceur, constante de temps…) : pas de calcul du circuit.
  if (check.expect != null) return +check.expect;
  const r = env.dc(check.state || null);
  if (!r || !r.ok) return null;
  if (check.part) { const c = env.comps().find(x => x.name === check.part); return c ? r.current(c) : null; }
  const [a, b] = (check.probe || []).map(p => refOf(env.comps(), p));
  if (!a) return null;
  const va = r.volts(a), vb = b ? r.volts(b) : 0;
  return va == null || vb == null ? null : va - vb;
}
export function checkMeasure(check, answer, env) {
  const exp = expectedMeasure(check, env), v = parseFloat(String(answer ?? '').replace(',', '.'));
  if (exp == null) return { ok: false, why: 'nosim' };
  if (!Number.isFinite(v)) return { ok: false, why: 'nan', expected: exp };
  const tol = Math.max(Math.abs(exp) * (check.tolerance ?? 0.12), check.unit === 'mA' ? 0.5 : check.unit === 's' ? 0.02 : 0.05);
  return { ok: Math.abs(v - exp) <= tol, expected: exp, got: v };
}
export function checkQuiz(check, answer) {
  const want = [].concat(check.answer).sort().join(','), got = [].concat(answer ?? []).map(Number).sort().join(',');
  return { ok: want === got };
}
/** Toutes les liaisons du TP (étapes « wire ») : la solution de câblage, pour un devoir. */
export const allNets = tp => tp.steps.filter(s => s.check && s.check.type === 'wire').flatMap(s => s.check.nets);
