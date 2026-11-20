// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Projet d'essai des tests de la conception (dimension, docs) : un bâtiment de bureaux, deux étages, un local technique
// au rez-de-chaussée (une baie), aucun au premier étage. Pièces rectangulaires, en mètres.
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
function floor(id, name, level, elev) {
  const rooms = [
    { id: id + '-b1', name: 'Bureau 1', usage: 'office', poly: rect(0, 0, 5, 5) },
    { id: id + '-b2', name: 'Bureau 2', usage: 'office', poly: rect(5, 0, 5, 5) },
    { id: id + '-b3', name: 'Bureau 3', usage: 'office', poly: rect(10, 0, 5, 5) },
    { id: id + '-os', name: 'Plateau', usage: 'open', poly: rect(15, 0, 15, 10) },
    { id: id + '-mt', name: 'Réunion', usage: 'meeting', poly: rect(30, 0, 8, 5) },
    { id: id + '-co', name: 'Couloir', usage: 'corridor', poly: rect(0, 5, 15, 2) },
    { id: id + '-lt', name: 'Local technique', usage: 'tr', poly: rect(30, 5, 4, 3) }
  ];
  const walls = rooms.flatMap(r => r.poly.map((p, i) => ({ id: r.id + '-w' + i, a: p, b: r.poly[(i + 1) % 4], t: 100, mat: 'plaster' })));
  return { id, name, level, elev, height: 3, plenum: 0.6, raised: 0, walls, doors: [], rooms };
}
export function fixture() {
  return {
    view: 'net', devices: [], cables: [], ext: {},
    site: { name: 'Siège', buildings: [{ id: 'b1', name: 'Siège', x: 0, y: 0, floors: [floor('f0', 'RDC', 0, 0), floor('f1', 'R+1', 1, 3.5)] }] },
    paths: [], racks: [{ id: 'rk1', name: 'Baie 1', floor: 'f0', room: 'f0-lt', x: 32, y: 6.5, rot: 0, kind: 'floor', u: 42, w: 600, d: 800 }],
    vlans: [], design: {}, tests: null, images: {}
  };
}
/** Grand projet (mesure du temps de calcul) : nb bâtiments × nf étages, chaque étage un local technique et des bureaux. */
export function bigFixture(nb = 3, nf = 4) {
  const buildings = [], racks = [];
  for (let b = 0; b < nb; b++) {
    const floors = [];
    for (let k = 0; k < nf; k++) {
      const id = `b${b}f${k}`, f = floor(id, 'N' + k, k, k * 3.5);
      // une rangée de bureaux de plus pour arriver à environ 50 prises par étage
      for (let i = 0; i < 4; i++) f.rooms.push({ id: id + '-x' + i, name: 'Bureau ' + (10 + i), usage: 'office', poly: rect(i * 5, 7, 5, 4) });
      floors.push(f);
      racks.push({ id: 'rk' + id, name: 'Baie ' + id, floor: id, room: id + '-lt', x: 32, y: 6.5, rot: 0, kind: 'floor', u: 42, w: 600, d: 800 });
    }
    buildings.push({ id: 'b' + b, name: 'Bât ' + b, x: b * 80, y: 0, floors });
  }
  return { view: 'net', devices: [], cables: [], ext: {}, site: { name: 'Campus', buildings }, paths: [], racks, vlans: [], design: {}, tests: null, images: {} };
}
