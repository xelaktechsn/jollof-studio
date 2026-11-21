// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Trousse d'interface du module réseau (chargée à la demande, jamais au démarrage) : un seul import pour les vues.
//   ctxMenu(at, items) / menuAt(anchor, items) ...... menu.js     propGrid(el, fields, values, onChange) ... propgrid.js
//   createTree(host, o) ............................. tree.js     createTable(host, o) ..................... table.js
//   searchBox(host, o) .............................. search.js   task(label, fn, o) / notify(text, kind, o)  task.js
// Logique pure (Node) : model.js.
export { ctxMenu, menuAt, closeMenus, keyLabel } from './menu.js';
export { propGrid } from './propgrid.js';
export { createTree } from './tree.js';
export { createTable } from './table.js';
export { searchBox } from './search.js';
export { task, notify } from './task.js';
export { norm, mergeValues, parseValue, fmtValue, getPath, setPath, sortRows, filterRows, filterTree, flatten, indexTree } from './model.js';
