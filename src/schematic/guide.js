// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Guide de montage : un PDF à imprimer pour réaliser le montage sur la table.
// Feuille 1 : le matériel (quantités et repères), les blocs, les précautions. Feuilles suivantes :
// le câblage pas à pas, un fil par ligne avec sa couleur, ses deux broches et son rôle.
// Puis le schéma électrique.
import { tl, locale, LANG, COLON } from '../i18n/index.js';

export function installGuide(app) {
  const { $, icon } = app;
  const W = 297, H = 210;

  function build() {
    const { Draw, toPdf, textWidth, frame } = app.pdf;
    const title = app.projectTitle(), date = new Date().toLocaleDateString(locale());
    const comps = app.comps(), wires = app.wires(), blocks = app.blocks();
    const fit = (t, w, s) => { t = String(t ?? ''); while (t.length > 2 && textWidth(t, s) > w) t = t.slice(0, -2) + '…'; return t; };
    const pages = [];
    const page = (doc, no) => { const d = new Draw(); const ar = frame(d, W, H, { title, doc, date, scale: tl('A4 paysage'), boards: comps.filter(c => /^(esp32|uno|nano|nodemcu|pico)$/.test(c.type) || c.prof).map(c => c.name).join(', ') || '—' }, no, 0); pages.push({ w: W, h: H, ops: d.ops }); return { d, ar }; };

    /* --- Matériel --- */
    const { d, ar } = page(tl('Guide de montage · matériel'), 1);
    d.text(ar.x0, ar.y0 + 6, tl('Matériel'), { s: 4, b: true });
    const groups = new Map();
    for (const c of comps) { const k = app.describe(c).title; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c.name); }
    const rows = [...groups].sort((a, b) => a[0].localeCompare(b[0], LANG));
    let y = ar.y0 + 12;
    const colW = 150;
    d.rect(ar.x0, y, colW, 6, { w: 0.2, fill: '#eeeeee' }); d.text(ar.x0 + 1.5, y + 4.2, tl('Qté'), { s: 2.2, b: true }); d.text(ar.x0 + 14, y + 4.2, tl('Désignation'), { s: 2.2, b: true }); d.text(ar.x0 + 92, y + 4.2, tl('Repères (composants)'), { s: 2.2, b: true });
    y += 6;
    for (const [name, refs] of rows) {
      if (y > ar.y1 - 34) break;
      d.rect(ar.x0, y, colW, 6, { w: 0.15 }); d.rect(ar.x0 + 1.5, y + 1.3, 3.4, 3.4, { w: 0.2 });
      d.text(ar.x0 + 7, y + 4.2, String(refs.length), { s: 2.2, b: true }); d.text(ar.x0 + 14, y + 4.2, fit(name, 76, 2.2), { s: 2.2 }); d.text(ar.x0 + 92, y + 4.2, fit(refs.join(', '), 56, 2.1), { s: 2.1 });
      y += 6;
    }
    d.text(ar.x0, y + 5, tl('{0} composant{1} · {2} fil{3} de liaison (cases à cocher pour préparer le matériel)', comps.length, comps.length > 1 ? 's' : '', wires.length, wires.length > 1 ? 's' : ''), { s: 2, color: '#555' });
    const x2 = ar.x0 + colW + 12;
    d.text(x2, ar.y0 + 6, tl('Avant de commencer'), { s: 4, b: true });
    const tips = [tl('Câblez toujours carte débranchée : on ne branche l’USB qu’une fois le montage vérifié.'),
      tl('Respectez le sens des composants polarisés : LED (patte longue = anode), condensateur chimique, diode.'),
      tl('Reliez toutes les masses (GND) entre elles : carte, modules et piles.'),
      tl('Suivez les étapes dans l’ordre et cochez chaque fil posé.'),
      tl('Couleurs conseillées : rouge pour l’alimentation, noir pour la masse.')];
    let ty = ar.y0 + 14;
    for (const tip of tips) {
      const words = tip.split(' '); let line = '';
      d.circle(x2 + 1.2, ty - 1, 0.6, { fill: '#000', w: 0.1 });
      for (const w of words) { if (textWidth(line + ' ' + w, 2.2) > 98 && line) { d.text(x2 + 3.5, ty, line, { s: 2.2 }); ty += 3.6; line = w; } else line = line ? line + ' ' + w : w; }
      d.text(x2 + 3.5, ty, line, { s: 2.2 }); ty += 5.5;
    }
    if (blocks.length) {
      ty += 3; d.text(x2, ty, tl('Blocs du montage'), { s: 4, b: true }); ty += 7;
      for (const b of blocks) { if (ty > ar.y1 - 34) break; d.rect(x2, ty - 3, 3.5, 3.5, { fill: b.color, w: 0.1 }); d.text(x2 + 5.5, ty, fit(`${b.name}${COLON}${b.comps.map(c => c.name).join(', ') || tl('zone')}`, 92, 2.2), { s: 2.2 }); ty += 5; }
    }

    /* --- Câblage pas à pas --- */
    const blockOf = w => blocks.find(b => b.comps.includes(w.a.comp) && b.comps.includes(w.b.comp));
    const steps = wires.map((w, i) => ({ n: i + 1, color: w.color, from: `${w.a.comp.name} · ${w.a.key}`, to: `${w.b.comp.name} · ${w.b.key}`, role: w.role || '', block: (blockOf(w) || {}).name || '' }));
    const cols = [['', 7], ['N°', 10], [tl('Couleur'), 16], ['De', 52], [tl('Vers'), 52], [tl('Rôle'), 74], [tl('Bloc'), 38]];
    let i = 0, no = 2;
    while (i < steps.length || no === 2) {
      const { d: pd, ar: pa } = page(tl('Guide de montage · câblage'), no++);
      pd.text(pa.x0, pa.y0 + 6, tl('Câblage pas à pas'), { s: 4, b: true });
      let yy = pa.y0 + 12, x = pa.x0;
      const tw = cols.reduce((t, c) => t + c[1], 0);
      pd.rect(pa.x0, yy, tw, 6, { w: 0.2, fill: '#eeeeee' });
      cols.forEach(([h, w]) => { pd.text(x + 1.5, yy + 4.2, h, { s: 2.2, b: true }); x += w; });
      yy += 6;
      if (!steps.length) pd.text(pa.x0 + 2, yy + 6, tl('Aucun fil dans ce montage.'), { s: 2.4 });
      for (; i < steps.length && yy + 7 <= pa.y1 - 32; i++, yy += 7) {
        const s = steps[i]; x = pa.x0;
        pd.rect(pa.x0, yy, tw, 7, { w: 0.15 });
        pd.rect(x + 1.8, yy + 1.8, 3.4, 3.4, { w: 0.2 }); x += cols[0][1];
        pd.text(x + 1.5, yy + 4.7, String(s.n), { s: 2.4, b: true }); x += cols[1][1];
        pd.rect(x + 1.5, yy + 1.6, 12, 3.8, { fill: s.color, w: 0.15 }); x += cols[2][1];
        pd.text(x + 1.5, yy + 4.7, fit(s.from, cols[3][1] - 3, 2.3), { s: 2.3 }); x += cols[3][1];
        pd.text(x + 1.5, yy + 4.7, fit(s.to, cols[4][1] - 3, 2.3), { s: 2.3 }); x += cols[4][1];
        pd.text(x + 1.5, yy + 4.7, fit(s.role, cols[5][1] - 3, 2.1), { s: 2.1 }); x += cols[5][1];
        pd.text(x + 1.5, yy + 4.7, fit(s.block, cols[6][1] - 3, 2.1), { s: 2.1 });
      }
      if (no > 40) break;
    }

    /* --- Schéma --- */
    const sch = app.schematic({ format: 'A4', lists: false });
    sch.pages.forEach(p => pages.push({ w: p.w, h: p.h, ops: p.ops }));
    // Numérotation des feuilles.
    const total = pages.length;
    pages.forEach((p, k) => p.ops.forEach(op => { if (op.t === 'text' && /^\d+ \/ \d+$/.test(op.str)) op.str = `${k + 1} / ${total}`; }));
    return toPdf(pages, { title: tl('{0} — guide de montage', title) });
  }

  // Bouton dans la fenêtre du schéma.
  const pdfBtn = $('#schPdf');
  pdfBtn.insertAdjacentHTML('beforebegin', `<button type="button" class="btn" id="guidePdf" data-tip="${tl('Matériel, câblage pas à pas et schéma, à imprimer')}">${icon('list')}<span>${tl('Guide de montage')}</span></button>`);
  $('#guidePdf').onclick = async () => {
    // Un guide de montage sert à câbler en vrai : seulement pour un montage qui passe la vérification.
    if (app.verify) { const r = await app.verify(false); if (r && r.errors) { app.status(tl('Guide de montage refusé : le montage a {0} erreur(s). Corrigez-les d’abord (rapport ouvert).', r.errors), 'err'); app.openCheck(); return; } }
    try {
      const bytes = build();
      const path = await app.saveFile(new Blob([bytes], { type: 'application/pdf' }), `${app.projectTitle().replace(/[\\/:*?"<>|]+/g, '-')}-${tl('guide-de-montage')}.pdf`, tl('Document PDF'), 'pdf');
      if (path) app.status(app.isDesktop() ? tl('Guide de montage enregistré : {0}', path) : tl('Guide de montage téléchargé.'), 'ok');
    } catch (e) { app.status(tl('Guide de montage impossible : ') + (e.message || e), 'err'); }
  };
}
