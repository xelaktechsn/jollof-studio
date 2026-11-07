// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Éditeur « Blocs de code » : Blockly injecté dans un élément de la page, chargé à la première
// ouverture seulement. Rendu zelos (blocs arrondis, façon Scratch), thème sombre, médias locaux.
import './visual.css';
import { tl } from '../../i18n/index.js';
import { loadBlockly } from './load.js';
import { defineBlocks, toolbox, relabel, STYLE } from './blocks.js';
import { emptyWorkspace } from './types.js';

let theme = null, dialogHost = null;
function darkTheme(Blockly) {
  if (theme) return theme;
  const st = c => ({ colourPrimary: c });
  const own = Object.fromEntries(Object.entries(STYLE).map(([k, c]) => [`jollof_${k}`, st(c)]));
  return (theme = Blockly.Theme.defineTheme('jollof-dark', {
    base: Blockly.Themes.Classic,
    blockStyles: {
      ...own, jollof_events: { colourPrimary: STYLE.events, hat: 'cap' },
      logic_blocks: st(STYLE.logic), loop_blocks: st(STYLE.loops), math_blocks: st(STYLE.math), text_blocks: st(STYLE.text),
      variable_blocks: st(STYLE.variables), variable_dynamic_blocks: st(STYLE.variables), procedure_blocks: st('#8a6bd1'), list_blocks: st('#6b8ad1')
    },
    categoryStyles: Object.fromEntries(Object.entries(STYLE).map(([k, c]) => [k, { colour: c }])),
    componentStyles: {
      workspaceBackgroundColour: '#0b0e11', toolboxBackgroundColour: '#11151a', toolboxForegroundColour: '#e6e9eb',
      flyoutBackgroundColour: '#182027', flyoutForegroundColour: '#b6bec4', flyoutOpacity: 0.97,
      scrollbarColour: '#2d3740', scrollbarOpacity: 0.9, insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3,
      markerColour: '#e0703a', cursorColour: '#e0703a', selectedGlowColour: '#e0703a', selectedGlowOpacity: 0.6
    },
    fontStyle: { family: '"Instrument Sans", system-ui, sans-serif', weight: '600', size: 11 },
    startHats: true
  }));
}

/** Petite boîte de dialogue dans l'éditeur (window.prompt n'est pas disponible dans toutes les webviews). */
function ask(message, value, done) {
  const host = dialogHost || document.body, box = document.createElement('div'), form = document.createElement('form'), row = document.createElement('div');
  const label = document.createElement('label'), input = value == null ? null : document.createElement('input');
  const button = (text, v) => { const b = document.createElement('button'); b.type = v === 'ok' ? 'submit' : 'button'; b.value = v; b.textContent = text; return b; };
  const ok = button(tl('OK'), 'ok'), cancel = value === undefined ? null : button(tl('Fermer'), 'cancel');
  label.textContent = message; box.className = 'vDialog';
  if (input) { input.value = value; label.append(input); label.style.display = 'grid'; label.style.gap = '6px'; }
  row.append(...[cancel, ok].filter(Boolean)); form.append(label, row); box.append(form);
  const close = v => { box.remove(); done(v); };
  form.onsubmit = e => { e.preventDefault(); close(input ? input.value : true); };
  if (cancel) cancel.onclick = () => close(input ? null : false);
  form.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(input ? null : cancel ? false : true); } };
  host.append(box);
  (input || ok).focus(); if (input) input.select();
}
function dialogs(Blockly) {
  Blockly.dialog.setPrompt((msg, def, cb) => ask(msg, def ?? '', cb));
  Blockly.dialog.setConfirm((msg, cb) => ask(msg, null, cb));
  Blockly.dialog.setAlert((msg, cb) => ask(msg, undefined, () => cb && cb()));
}

/**
 * Ouvre l'éditeur dans `host` (asynchrone : Blockly est chargé à la première ouverture).
 * json : programme enregistré (Blockly.serialization.workspaces.save), vide → « au démarrage » + « en boucle ».
 * ctx : visualContext(carte, cx). onChange(json) : 300 ms après la dernière modification du programme
 * (pas pour la sélection, le zoom ou le défilement).
 * Retourne { save, highlight, refreshToolbox, warn, resize, dispose, workspace }.
 */
export async function openVisual(host, { json, ctx, onChange } = {}) {
  const Blockly = await loadBlockly();
  defineBlocks(Blockly, ctx);
  dialogs(Blockly);
  dialogHost = host;
  host.classList.add('visualHost');
  const ws = Blockly.inject(host, {
    renderer: 'zelos', theme: darkTheme(Blockly), toolbox: toolbox(ctx), media: './blockly/media/',
    zoom: { controls: true, wheel: true, pinch: true, startScale: 0.85, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15 },
    move: { scrollbars: true, drag: true, wheel: false },
    grid: { spacing: 24, length: 2, colour: '#212931', snap: true },
    trashcan: true, sounds: true, oneBasedIndex: true
  });
  // Chargement sans événements : ni onChange, ni annulation possible du chargement.
  Blockly.Events.disable();
  try { Blockly.serialization.workspaces.load(json && json.blocks ? json : emptyWorkspace(), ws); }
  catch (e) { console.warn('Blocs illisibles, espace de travail vide', e); ws.clear(); Blockly.serialization.workspaces.load(emptyWorkspace(), ws); }
  finally { Blockly.Events.enable(); }
  ws.clearUndo();
  ws.addChangeListener(Blockly.Events.disableOrphans); // un bloc détaché de tout événement ne s'exécute pas : il est grisé

  const save = () => Blockly.serialization.workspaces.save(ws);
  let timer = 0, lit = null, warned = new Map();
  const flush = () => { if (timer) { clearTimeout(timer); timer = 0; if (onChange) onChange(save()); } };
  ws.addChangeListener(e => { if (e.isUiEvent || !onChange) return; clearTimeout(timer); timer = setTimeout(flush, 300); });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => Blockly.svgResize(ws)) : null;
  if (ro) ro.observe(host);

  return {
    workspace: ws,
    /** Programme actuel (JSON à enregistrer dans le projet). */
    save,
    /** Met en évidence le bloc en cours d'exécution (null : aucun). */
    highlight(id) { id = id || null; if (id === lit) return; lit = id; ws.highlightBlock(id && ws.getBlockById(id) ? id : null); },
    /** Le montage a changé : menus des broches et composants, catégorie « Montage ». */
    refreshToolbox(next) { defineBlocks(Blockly, next); ws.updateToolbox(toolbox(next)); relabel(Blockly, ws); },
    /** Avertissements du générateur sur les blocs : [{ id, text }]. */
    warn(list) {
      const next = new Map();
      for (const w of list || []) next.set(w.id, next.has(w.id) ? `${next.get(w.id)}\n${w.text}` : w.text);
      for (const id of new Set([...warned.keys(), ...next.keys()])) {
        if (warned.get(id) === next.get(id)) continue;
        const b = ws.getBlockById(id); if (b) b.setWarningText(next.get(id) || null);
      }
      warned = next;
    },
    resize() { Blockly.svgResize(ws); },
    dispose() {
      flush();
      if (ro) ro.disconnect();
      ws.dispose();
      host.classList.remove('visualHost'); host.replaceChildren();
      if (dialogHost === host) dialogHost = null;
    }
  };
}
