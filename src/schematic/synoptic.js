// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Synoptique : le montage vu comme des blocs reliés. La carte au centre, ce qu'elle lit à gauche (capteurs,
// entrées), ce qu'elle commande à droite (affichage, sorties, moteurs), et sur chaque lien les broches de la carte
// qui le portent. Les alimentations ne sont pas tracées : chaque bloc dit de quoi il est alimenté.
// Module pur : main.js donne les blocs et les nœuds du montage, et reçoit un dessin SVG autonome.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BW = 168, BH = 64, GX = 120, GY = 28, PAD = 32;
const pinBase = k => String(k).replace(/ \(\d+\)$/, '');

/**
 * Liens entre blocs.
 * blocks : [{ id, name, model, role: 'board' | 'in' | 'out' | 'other' }]
 * nets : [{ name, kind: 'sig' | 'pwr' | 'gnd' | 'short', pins: [[idBloc, broche], …] }]
 * Rend { edges: [{ a, b, labels }], power: Map id → { rails: [noms], gnd: bool } } ; un lien part toujours de la
 * carte quand elle est sur le nœud, sinon les blocs du nœud sont reliés l'un après l'autre.
 */
export function links(blocks, nets) {
  const byId = new Map(blocks.map(b => [b.id, b])), edges = new Map(), power = new Map(blocks.map(b => [b.id, { rails: [], gnd: false }]));
  const add = (a, b, label) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!edges.has(key)) edges.set(key, { a, b, labels: [] });
    const e = edges.get(key); if (label && !e.labels.includes(label)) e.labels.push(label);
  };
  for (const n of nets) {
    const pins = n.pins.filter(p => byId.has(p[0])), ids = [...new Set(pins.map(p => p[0]))];
    if (n.kind === 'gnd') { ids.forEach(id => (power.get(id).gnd = true)); continue; }
    if (n.kind === 'pwr' || n.kind === 'short') { ids.forEach(id => { const r = power.get(id).rails; if (!r.includes(n.name)) r.push(n.name); }); continue; }
    if (ids.length < 2) continue;
    const boards = ids.filter(id => byId.get(id).role === 'board');
    if (boards.length) {
      for (const bd of boards) {
        const label = pins.filter(p => p[0] === bd).map(p => pinBase(p[1])).join('/');
        for (const id of ids) if (id !== bd && !boards.includes(id)) add(bd, id, label);
      }
      for (let i = 1; i < boards.length; i++) add(boards[0], boards[i], n.name);
    } else for (let i = 1; i < ids.length; i++) add(ids[i - 1], ids[i], /^N\d+(_\d+)?$/.test(n.name) ? '' : n.name);
  }
  return { edges: [...edges.values()], power };
}

/**
 * Place les blocs : colonne 0 la ou les cartes, colonnes négatives à gauche (entrées), positives à droite
 * (sorties) ; un bloc relié à un autre bloc plutôt qu'à la carte se range une colonne plus loin, du même côté.
 * Les blocs sans lien vont sur une rangée du bas. Rend Map id → { col, row } et la liste des blocs isolés.
 */
export function place(blocks, edges) {
  const adj = new Map(blocks.map(b => [b.id, []]));
  for (const e of edges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
  let roots = blocks.filter(b => b.role === 'board').map(b => b.id);
  if (!roots.length) { const top = [...blocks].sort((x, y) => adj.get(y.id).length - adj.get(x.id).length)[0]; if (top && adj.get(top.id).length) roots = [top.id]; }
  const col = new Map(roots.map(id => [id, 0])), byId = new Map(blocks.map(b => [b.id, b]));
  // Un bloc neutre (résistance, transistor) va du côté de ce qu'il dessert : à droite s'il mène à une sortie
  // (la résistance d'une LED), à gauche s'il mène à une entrée.
  const leadsTo = id => {
    const seen = new Set([id, ...roots]), todo = [id];
    while (todo.length) {
      const role = byId.get(todo[0]).role; if (role === 'in' || role === 'out') return role;
      for (const o of adj.get(todo.shift())) if (!seen.has(o)) { seen.add(o); todo.push(o); }
    }
    return 'other';
  };
  let frontier = [...roots], left = 0, right = 0;
  while (frontier.length) {
    const next = [];
    for (const id of frontier) for (const o of adj.get(id)) {
      if (col.has(o)) continue;
      const c = col.get(id);
      let side = Math.sign(c);
      if (!side) { const role = leadsTo(o); side = role === 'in' ? -1 : role === 'out' ? 1 : left <= right ? -1 : 1; if (side < 0) left++; else right++; }
      col.set(o, c + side); next.push(o);
    }
    frontier = next;
  }
  const rows = new Map(), pos = new Map(), lone = [];
  for (const b of blocks) {
    if (!col.has(b.id)) { lone.push(b.id); continue; }
    const c = col.get(b.id), r = rows.get(c) || 0; rows.set(c, r + 1); pos.set(b.id, { col: c, row: r });
  }
  return { pos, lone, rows };
}

/** Dessin SVG du synoptique. o : { title, blocks, nets, labels?: { in, out, power, none } } */
export function synopticSvg(o) {
  const blocks = o.blocks || [], { edges, power } = links(blocks, o.nets || []), { pos, lone, rows } = place(blocks, edges);
  const cols = [...rows.keys()], c0 = cols.length ? Math.min(...cols) : 0, c1 = cols.length ? Math.max(...cols) : 0;
  const tall = Math.max(1, ...rows.values()), bodyH = tall * BH + (tall - 1) * GY;
  const xy = new Map();
  for (const [id, p] of pos) {
    const n = rows.get(p.col), h = n * BH + (n - 1) * GY;
    xy.set(id, { x: PAD + (p.col - c0) * (BW + GX), y: PAD + 34 + (bodyH - h) / 2 + p.row * (BH + GY) });
  }
  const mainW = (c1 - c0 + 1) * BW + (c1 - c0) * GX;
  lone.forEach((id, i) => xy.set(id, { x: PAD + i * (BW + 24), y: PAD + 34 + bodyH + 56 }));
  const W = Math.max(mainW, lone.length * (BW + 24) - 24, 320) + 2 * PAD, H = PAD + 34 + bodyH + (lone.length ? 56 + BH : 0) + PAD;
  const byId = new Map(blocks.map(b => [b.id, b]));
  const link = e => {
    let A = xy.get(e.a), B = xy.get(e.b), a = e.a, b = e.b;
    if (!A || !B) return '';
    if (A.x > B.x) { [A, B] = [B, A]; [a, b] = [b, a]; }
    const label = e.labels.length > 3 ? `${e.labels.slice(0, 3).join(', ')} +${e.labels.length - 3}` : e.labels.join(', ');
    let d, lx, ly;
    if (Math.abs(A.x - B.x) < 1) { // même colonne : arc sur le côté
      const x = A.x + BW, y1 = A.y + BH / 2, y2 = B.y + BH / 2;
      d = `M${x} ${y1} C${x + 46} ${y1} ${x + 46} ${y2} ${x} ${y2}`; lx = x + 40; ly = (y1 + y2) / 2;
    } else {
      const x1 = A.x + BW, y1 = A.y + BH / 2, x2 = B.x, y2 = B.y + BH / 2, xm = (x1 + x2) / 2;
      d = `M${x1} ${y1} C${xm} ${y1} ${xm} ${y2} ${x2} ${y2}`; lx = xm; ly = (y1 + y2) / 2;
    }
    const w = Math.max(18, label.length * 6.4 + 10);
    return `<path class="lk" d="${d}"/>${label ? `<rect class="lb" x="${(lx - w / 2).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="9"/><text class="lt" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}">${esc(label)}</text>` : ''}`;
  };
  const block = b => {
    const p = xy.get(b.id), pw = power.get(b.id), feed = [...pw.rails, ...(pw.gnd ? ['GND'] : [])].join(' · ');
    const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
    return `<g class="bk ${esc(b.role)}" data-id="${esc(b.id)}" tabindex="0" role="button" aria-label="${esc(b.name)}"><rect x="${p.x}" y="${p.y}" width="${BW}" height="${BH}" rx="10"/>
<text class="nm" x="${p.x + BW / 2}" y="${p.y + 24}">${esc(cut(b.name, 20))}</text><text class="md" x="${p.x + BW / 2}" y="${p.y + 41}">${esc(cut(b.model || '', 26))}</text>${feed ? `<text class="pw" x="${p.x + BW / 2}" y="${p.y + 56}">${esc(cut(feed, 28))}</text>` : ''}</g>`;
  };
  const L = o.labels || {}, head = [];
  if (cols.some(c => c < 0)) head.push(`<text class="hd" x="${PAD + (-1 - c0) * (BW + GX) + BW / 2}" y="${PAD + 12}">${esc(L.in || '')}</text>`);
  if (cols.some(c => c > 0)) head.push(`<text class="hd" x="${PAD + (1 - c0) * (BW + GX) + BW / 2}" y="${PAD + 12}">${esc(L.out || '')}</text>`);
  if (lone.length) head.push(`<text class="hd left" x="${PAD}" y="${PAD + 34 + bodyH + 44}">${esc(L.none || '')}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<title>${esc(o.title || '')}</title>
<style>.bg{fill:#fff}.bk rect{fill:#f4f6f9;stroke:#9aa5b1;stroke-width:1.4}.bk.board rect{fill:#e3edff;stroke:#3b82f6;stroke-width:2}.bk.in rect{fill:#eaf7f0;stroke:#3fa87a}.bk.out rect{fill:#fff3e3;stroke:#e0913a}
.bk{cursor:pointer}.bk:hover rect,.bk:focus rect{stroke-width:2.6}.bk:focus{outline:none}
text{text-anchor:middle;fill:#15191d}.nm{font-size:14px;font-weight:650}.md{font-size:11px;fill:#4d5964}.pw{font-size:10px;fill:#7a8691;font-family:ui-monospace,Menlo,Consolas,monospace}
.hd{font-size:11px;font-weight:650;fill:#7a8691;letter-spacing:.06em;text-transform:uppercase}.hd.left{text-anchor:start}
.lk{fill:none;stroke:#5b6670;stroke-width:1.6}.lb{fill:#fff;stroke:#c9d1d9}.lt{font-size:10.5px;font-family:ui-monospace,Menlo,Consolas,monospace;fill:#15191d}</style>
<rect class="bg" width="${W}" height="${H}"/>
${head.join('')}
${edges.map(link).join('\n')}
${blocks.filter(b => xy.has(b.id)).map(block).join('\n')}
</svg>`;
}
