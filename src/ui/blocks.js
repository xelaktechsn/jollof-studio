// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Blocs : un cadre nommé autour d'une partie du montage (« Alimentation », « Capteurs »…).
// Le cadre entoure ses composants et les fils qui les relient entre eux, et suit leurs
// déplacements ; son étiquette se saisit pour déplacer tout le bloc. Un bloc sélectionné
// montre huit poignées : on l'agrandit ou on le réduit, et les composants qu'il couvre alors
// le rejoignent (ceux qu'il ne couvre plus le quittent). Les blocs se retrouvent sur le schéma.
// Un composant posé ou déposé sur un cadre rejoint ce bloc ; déplacé hors du cadre de son bloc, il le
// quitte (blockAt, settle). Le dernier composant d'un bloc ne le quitte pas : le cadre le suit.
import * as THREE from 'three';
import { textSprite, dispose } from './guides.js';
import { tl } from '../i18n/index.js';

export const BLOCK_COLORS = ['#3b82f6', '#e0703a', '#3fb27f', '#9b7be0', '#f2c94c', '#e5484d', '#3fbfbf'];
const PAD = 7, Y = 0.08;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HGEO = new THREE.BoxGeometry(2.6, 1.2, 2.6);

/**
 * o : { scene, camera, controls, comps(), wires(), boxOf(comp) }
 */
export function createBlocks(o) {
  let list = [], selected = null;
  const root = new THREE.Group(); root.name = 'blocs'; o.scene.add(root);
  const view = new Map(); // bloc → { group, fill, line, label, sig }
  const handleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const handles = HANDLES.map(h => { const m = new THREE.Mesh(HGEO, handleMat); m.userData.handle = h; m.renderOrder = 27; m.visible = false; root.add(m); return m; });

  const members = b => o.comps().filter(c => b.comps.includes(c.id));
  const hot = new Map(); // bloc → fin de son clignotement (un composant vient de le rejoindre)
  /** Emprise des composants du bloc (sauf without) et de leurs fils internes, marge comprise. */
  function fit(b, without = null) {
    const ms = members(b).filter(c => c !== without);
    if (!ms.length) return null;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const c of ms) { const bx = o.boxOf(c); x0 = Math.min(x0, bx.min.x); z0 = Math.min(z0, bx.min.z); x1 = Math.max(x1, bx.max.x); z1 = Math.max(z1, bx.max.z); }
    const set = new Set(ms);
    for (const w of o.wires()) {
      if (!set.has(w.a.comp) || !set.has(w.b.comp) || !w.route) continue;
      for (const p of w.route.pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[2]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[2]); }
    }
    return [x0 - PAD, z0 - PAD, x1 + PAD, z1 + PAD];
  }
  /** Emprise du bloc : ses composants, agrandie au rectangle choisi à la main s'il y en a un. */
  function bounds(b, without = null) {
    const f = fit(b, without), r = b.rect;
    if (!f) return r ? [...r] : null;
    if (!r || !b.manual) return f;
    return [Math.min(f[0], r[0]), Math.min(f[1], r[1]), Math.max(f[2], r[2]), Math.max(f[3], r[3])];
  }
  function build(b, r) {
    if (view.get(b)) drop(b);
    const g = new THREE.Group(), col = new THREE.Color(b.color);
    const [x0, z0, x1, z1] = r, w = x1 - x0, d = z1 - z0;
    const lit = hot.has(b) && performance.now() < hot.get(b);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: lit ? 0.24 : b === selected ? 0.12 : 0.07, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(x0 + w / 2, Y, z0 + d / 2); fill.renderOrder = 1;
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, Y + 0.04, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: col, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.95, depthWrite: false }));
    line.computeLineDistances(); line.renderOrder = 2;
    const label = textSprite(b.name, { color: '#0b0e11', size: 34, bg: b.color, border: b === selected ? '#ffffff' : null });
    label.center.set(0, 0); label.position.set(x0, Y + 0.5, z0); label.userData.block = b; label.renderOrder = 26;
    label.material.depthTest = false; // toujours lisible, même sous un fil
    g.add(fill, line, label); root.add(g);
    view.set(b, { g, fill, line, label, sig: '' });
  }
  function drop(b) {
    const v = view.get(b); if (!v) return;
    root.remove(v.g); v.fill.geometry.dispose(); v.fill.material.dispose(); v.line.geometry.dispose(); v.line.material.dispose(); dispose(v.label);
    view.delete(b);
  }
  /** À chaque image : un cadre n'est redessiné que si ses composants, ses fils ou sa taille ont changé. */
  function update() {
    for (const [b] of view) if (!list.includes(b)) drop(b);
    if (selected && !list.includes(selected)) selected = null;
    const dist = o.camera.position.distanceTo(o.controls.target), h = Math.min(10, Math.max(2.6, dist * 0.018));
    for (const b of list) {
      const r = bounds(b);
      if (!r) { drop(b); continue; }
      const lit = hot.has(b) && performance.now() < hot.get(b); if (hot.has(b) && !lit) hot.delete(b);
      const sig = r.map(v => v.toFixed(1)).join(',') + b.name + b.color + (b === selected) + lit;
      let v = view.get(b);
      if (!v || v.sig !== sig) { build(b, r); v = view.get(b); v.sig = sig; }
      v.label.scale.set(h * v.label.userData.aspect, h, 1);
    }
    // Poignées du bloc sélectionné, de taille constante à l'écran.
    const r = selected && bounds(selected), k = Math.max(0.6, dist / 160);
    handles.forEach(m => {
      m.visible = !!r; if (!r) return;
      const [x0, z0, x1, z1] = r, h2 = m.userData.handle;
      m.position.set(h2.includes('w') ? x0 : h2.includes('e') ? x1 : (x0 + x1) / 2, Y + 0.6, h2.includes('n') ? z0 : h2.includes('s') ? z1 : (z0 + z1) / 2);
      m.scale.setScalar(k);
    });
  }
  const center = c => { const b = o.boxOf(c); return [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]; };
  const holds = (r, [x, z]) => !!r && x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
  /** Composants dont le centre tombe dans le rectangle. */
  const inside = r => o.comps().filter(c => holds(r, center(c)));
  /** Bloc dont le cadre (tracé sans ce composant) contient son centre : le plus petit si des cadres se chevauchent. */
  function blockAt(c) {
    const p = center(c); let best = null, area = Infinity;
    for (const b of list) {
      const r = bounds(b, c); if (!holds(r, p)) continue;
      const a = (r[2] - r[0]) * (r[3] - r[1]); if (a < area) { best = b; area = a; }
    }
    return best;
  }
  const blockOf = c => list.find(b => b.comps.includes(c.id)) || null;
  return {
    get list() { return list; },
    get selected() { return selected; },
    select(b) { selected = b || null; },
    set(data) {
      for (const b of [...view.keys()]) drop(b);
      selected = null;
      list = (data || []).map(b => ({ id: b.id, name: b.name || tl('Bloc'), color: b.color || BLOCK_COLORS[0], comps: [...(b.comps || [])], rect: b.rect || null, manual: !!b.manual }));
    },
    data() {
      const ids = new Set(o.comps().map(c => c.id));
      return list.map(b => ({ id: b.id, name: b.name, color: b.color, comps: b.comps.filter(id => ids.has(id)), rect: b.manual || !b.comps.length ? b.rect : null, manual: b.manual || undefined }));
    },
    /** Nouveau bloc à partir d'un rectangle tracé sur le tapis : il prend les composants dont le centre y tombe. */
    create(rect) {
      const r = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
      let n = list.length + 1; while (list.some(b => b.name === tl('Bloc {0}', n))) n++;
      const b = { id: 'b' + Math.random().toString(36).slice(2, 8), name: tl('Bloc {0}', n), color: BLOCK_COLORS[list.length % BLOCK_COLORS.length], comps: inside(r).map(c => c.id), rect: r, manual: false };
      list.push(b);
      return b;
    },
    /** Nouveau bloc fait exactement de ces composants (sélection) : ils quittent leur ancien bloc ; le cadre les suit. */
    fromComps(cs) {
      const ids = new Set(cs.map(c => c.id));
      for (const b of list) b.comps = b.comps.filter(id => !ids.has(id));
      let n = list.length + 1; while (list.some(b => b.name === tl('Bloc {0}', n))) n++;
      const b = { id: 'b' + Math.random().toString(36).slice(2, 8), name: tl('Bloc {0}', n), color: BLOCK_COLORS[list.length % BLOCK_COLORS.length], comps: [...ids], rect: null, manual: false };
      list.push(b); hot.set(b, performance.now() + 900);
      return b;
    },
    /** Déplace un côté ou un coin (poignée h) jusqu'au point (x, z) du tapis. */
    resize(b, h, x, z, start) {
      const r = [...start];
      if (h.includes('w')) r[0] = Math.min(x, r[2] - 6); if (h.includes('e')) r[2] = Math.max(x, r[0] + 6);
      if (h.includes('n')) r[1] = Math.min(z, r[3] - 6); if (h.includes('s')) r[3] = Math.max(z, r[1] + 6);
      b.rect = r; b.manual = true;
    },
    /** Fin d'un redimensionnement : le bloc prend exactement les composants qu'il couvre. */
    adopt(b) { if (b.rect) b.comps = inside(b.rect).map(c => c.id); },
    move(b, dx, dz) { if (b.rect) b.rect = [b.rect[0] + dx, b.rect[1] + dz, b.rect[2] + dx, b.rect[3] + dz]; },
    remove(b) { list = list.filter(x => x !== b); drop(b); if (selected === b) selected = null; },
    bounds, members, update,
    /** Étiquette de bloc sous le rayon (pour la saisir et déplacer le bloc). */
    hit(ray) { const labels = [...view.values()].map(v => v.label); const h = ray.intersectObjects(labels, false)[0]; return h ? h.object.userData.block : null; },
    /** Poignée du bloc sélectionné sous le rayon. */
    hitHandle(ray) { if (!selected) return null; const h = ray.intersectObjects(handles.filter(m => m.visible), false)[0]; return h ? h.object.userData.handle : null; },
    blockOf, blockAt,
    /**
     * Un composant vient d'être posé (fresh) ou déposé après un déplacement : il rejoint le bloc dont le
     * cadre le contient, ou quitte le sien s'il en est sorti. Rend { joined, left } (blocs), ou null si rien ne change.
     */
    settle(c, fresh = false) {
      const cur = blockOf(c), to = blockAt(c);
      if (to === cur) return null;
      if (fresh && cur) return null; // composant neuf déjà rangé (collé avec son bloc…)
      if (!to) {
        // Hors de tout cadre : il quitte son bloc, sauf s'il en est le dernier composant (le cadre le suit alors).
        if (!members(cur).some(m => m !== c) && !(cur.manual && cur.rect)) return null;
        cur.comps = cur.comps.filter(id => id !== c.id);
        return { joined: null, left: cur };
      }
      if (cur) cur.comps = cur.comps.filter(id => id !== c.id);
      to.comps.push(c.id); hot.set(to, performance.now() + 900);
      return { joined: to, left: cur };
    },
  };
}
