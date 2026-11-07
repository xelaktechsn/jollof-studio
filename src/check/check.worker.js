// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Vérificateur dans un travailleur en arrière-plan : la preuve dans tous les états ne prend jamais de temps au fil
// de l'interface. Il reçoit le montage en données simples (composants, fils, programmes) et rend les diagnostics,
// leurs composants et fils désignés par identifiant et rang (l'application les retrouve).
// Aucun import statique : la langue (premier message) doit être connue avant que i18n/index.js s'évalue, puis
// les tables de libellés s'évaluent au chargement : le dictionnaire d'abord, le vérificateur ensuite.
let ready = null;

self.onmessage = async e => {
  if (e.data && e.data.lang) {
    self.JOLLOF_LANG = e.data.lang;
    ready = import('../i18n/index.js').then(m => m.loadLanguage()).then(() => import('./check.js'));
    return;
  }
  if (!ready) ready = import('../i18n/index.js').then(m => m.loadLanguage()).then(() => import('./check.js'));
  const { id, proj } = e.data;
  try {
    const { checkProject } = await ready;
    const comps = proj.comps.map(c => ({ id: c.id, type: c.type, name: c.name, pins: Object.fromEntries(c.pins.map(k => [k, {}])), inp: { ...(c.inp || {}) }, relayOn: c.relayOn, group: { position: { x: c.x, z: c.z } } }));
    const by = Object.fromEntries(comps.map(c => [c.id, c]));
    const wires = proj.wires.map(w => ({ a: { comp: by[w.a[0]], key: w.a[1] }, b: { comp: by[w.b[0]], key: w.b[1] }, progress: 1 }));
    const r = checkProject({ comps, wires: wires.filter(w => w.a.comp && w.b.comp), programs: new Map(proj.programs), auto: new Set(proj.auto || []), allow: proj.allow || [] });
    self.postMessage({ id, result: pack(r, new Map(wires.map((w, i) => [w, i]))) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};

/** Diagnostics en données transférables : { $c: id, key } pour une broche, rang pour un fil. */
function pack(r, wi) {
  const R = x => (x && x.comp ? { $c: x.comp.id, key: x.key } : null);
  const W = w => (w && wi.has(w) ? wi.get(w) : null);
  return {
    ...r,
    diags: r.diags.map(d => ({
      ...d,
      loc: { comp: d.loc.comp ? d.loc.comp.id : null, key: d.loc.key || null, board: d.loc.board ? d.loc.board.id : null, line: d.loc.line || 0, col: d.loc.col || 0, len: d.loc.len || 0, pins: (d.loc.pins || []).map(R).filter(Boolean) },
      fault: d.fault ? {
        key: d.fault.key, level: d.fault.level, code: d.fault.code, title: d.fault.title, where: d.fault.where, why: typeof d.fault.why === 'string' ? d.fault.why : '', fix: d.fault.fix,
        missing: !!d.fault.missing, actions: d.fault.actions, swap: d.fault.swap || null, fx: d.fault.fx || null,
        comp: d.fault.comp ? d.fault.comp.id : null, pins: d.fault.pins.map(R).filter(Boolean), culprits: (d.fault.culprits || []).map(R).filter(Boolean),
        wires: (d.fault.wires || []).map(W).filter(x => x != null), cutWire: W(d.fault.cutWire), other: R(d.fault.other),
        suggest: d.fault.suggest ? { from: R(d.fault.suggest.from), to: R(d.fault.suggest.to) } : null
      } : null
    }))
  };
}
