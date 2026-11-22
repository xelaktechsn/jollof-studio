// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Palette de commandes (Ctrl+Maj+P ou F1), comme dans un éditeur de code : on tape quelques lettres, la liste
// se filtre (accents et casse ignorés, mots dans n'importe quel ordre), Entrée exécute. Les commandes fixes sont
// déclarées par register() ; des fournisseurs (provide) ajoutent des entrées calculées à l'ouverture : exemples,
// composants à poser, TP… Les dernières commandes exécutées remontent en tête quand la recherche est vide.
import { tl, COLON } from '../i18n/index.js';
import { icon } from './icons.js';

/** Aide en ligne publiée avec le site (GitHub Pages). */
export const HELP_URL = 'https://xelaktechsn.github.io/jollof-studio/aide/';

const MRU_KEY = 'jollof-cmd-mru';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const readMru = () => { try { const v = JSON.parse(localStorage.getItem(MRU_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const writeMru = l => { try { localStorage.setItem(MRU_KEY, JSON.stringify(l.slice(0, 24))); } catch (e) { /* stockage indisponible */ } };

/** Mots d'un libellé (espaces, tirets, ponctuation). */
const wordsOf = t => t.split(/[\s\-–—:·,;()/.]+/).filter(Boolean);
/** Sous-suite : chaque lettre de q apparaît dans t, dans l'ordre (« dht » dans « capteur DHT22 »). */
function subseq(t, q) { let i = 0; for (const c of t) { if (c === q[i]) i++; if (i === q.length) return true; } return false; }

/**
 * Score d'une entrée pour une requête (mots séparés par des espaces) : 0 si un mot ne correspond pas.
 * Un mot trouvé tel quel compte plus qu'une sous-suite ; au début du libellé, plus encore.
 */
function score(item, words) {
  const lab = norm(item.label), cat = norm(item.cat || ''), all = cat + ' ' + lab;
  let s = 0;
  for (const w of words) {
    if (lab.startsWith(w)) s += 30;
    else if (lab.includes(' ' + w)) s += 20;
    else if (all.includes(w)) s += 12;
    else if (w.length >= 2 && wordsOf(lab).some(x => x[0] === w[0] && subseq(x, w))) s += 3; // sous-suite dans un seul mot, depuis son début
    else return 0;
  }
  return s;
}

/** Libellé avec la requête mise en évidence (le premier mot trouvé tel quel). */
function highlight(label, words) {
  const n = norm(label);
  for (const w of words) {
    const i = n.indexOf(w);
    if (i >= 0 && n.length === label.length) return esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + w.length)) + '</mark>' + esc(label.slice(i + w.length));
  }
  return esc(label);
}

/**
 * Palette de commandes. Une commande : { id, label, cat, icon, keys (raccourci affiché), run(), when() → visible,
 * supersedes ([ids] cachés quand elle est visible) }. Rend { register(cmd | [cmds]), provide(fn → [cmds] | Promise),
 * get(id), run(id), open(texte), close(), isOpen() }.
 */
export function createPalette() {
  const items = new Map(), providers = [];
  let root = null, input = null, list = null, open = false, rows = [], sel = 0, dyn = [], gen = 0, mru = readMru();

  function build() {
    root = document.createElement('div'); root.className = 'cmdPal'; root.hidden = true;
    root.innerHTML = `<div class="cpBox" role="dialog" aria-modal="true" aria-label="${tl('Palette de commandes')}">
      <div class="cpHead">${icon('search')}<input class="cpInput" type="text" placeholder="${tl('Tapez une commande, un composant, un exemple, un TP…')}" aria-label="${tl('Palette de commandes')}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cpList" aria-autocomplete="list"></div>
      <ul class="cpList" id="cpList" role="listbox"></ul>
      <div class="cpFoot"><span><kbd>↑↓</kbd>${tl('choisir')}</span><span><kbd>↵</kbd>${tl('exécuter')}</span><span><kbd>${tl('Échap')}</kbd>${tl('fermer')}</span></div>
    </div>`;
    document.body.appendChild(root);
    input = root.querySelector('.cpInput'); list = root.querySelector('.cpList');
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', key);
    root.addEventListener('pointerdown', e => { if (!e.target.closest('.cpBox')) { e.preventDefault(); close(); } });
    list.addEventListener('pointerdown', e => { const li = e.target.closest('.cpItem'); if (!li) return; e.preventDefault(); run(rows[+li.dataset.i]); });
    list.addEventListener('pointermove', e => { const li = e.target.closest('.cpItem'); if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; paintSel(false); } });
  }
  function key(e) {
    const n = rows.length;
    const go = i => { e.preventDefault(); if (!n) return; sel = ((i % n) + n) % n; paintSel(true); };
    if (e.key === 'ArrowDown') go(sel + 1);
    else if (e.key === 'ArrowUp') go(sel - 1);
    else if (e.key === 'PageDown') go(Math.min(n - 1, sel + 8));
    else if (e.key === 'PageUp') go(Math.max(0, sel - 8));
    else if (e.key === 'Home' && (e.ctrlKey || e.metaKey || !input.value)) go(0);
    else if (e.key === 'End' && (e.ctrlKey || e.metaKey || !input.value)) go(n - 1);
    else if (e.key === 'Enter') { e.preventDefault(); run(rows[sel]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    else return;
    e.stopPropagation();
  }
  function visible() {
    const out = [];
    for (const it of [...items.values(), ...dyn]) { try { if (!it.when || it.when()) out.push(it); } catch (e) { /* commande indisponible */ } }
    // Une commande qui en remplace d'autres (supersedes : [ids], par exemple l'entrée d'un menu et celle d'une vue) les cache.
    const gone = new Set(out.flatMap(it => it.supersedes || []));
    return gone.size ? out.filter(it => !gone.has(it.id)) : out;
  }
  function render() {
    const q = norm(input.value).trim(), words = q ? q.split(/\s+/) : [];
    const all = visible();
    if (!words.length) {
      // Sans recherche : les dernières commandes exécutées, puis le reste par catégorie et libellé.
      const rank = it => { const i = mru.indexOf(it.id); return i < 0 ? 1e9 : i; };
      rows = all.sort((a, b) => rank(a) - rank(b) || String(a.cat).localeCompare(String(b.cat)) || a.label.localeCompare(b.label)).slice(0, 80);
    } else {
      rows = all.map(it => [score(it, words), it]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, 80).map(([, it]) => it);
    }
    sel = Math.min(sel, Math.max(0, rows.length - 1));
    list.innerHTML = rows.length ? rows.map((it, i) => `<li class="cpItem" role="option" id="cpOpt${i}" data-i="${i}" aria-selected="${i === sel}">${icon(it.icon || 'chevRight')}<span class="cpLab">${it.cat ? `<span class="cpCat">${esc(it.cat)}${COLON}</span>` : ''}${highlight(it.label, words)}</span><span class="cpKbd">${esc(it.keys || '')}</span></li>`).join('')
      : `<li class="cpEmpty">${tl('Aucune commande ne correspond.')}</li>`;
    paintSel(false);
  }
  function paintSel(scroll) {
    list.querySelectorAll('.cpItem').forEach(li => li.setAttribute('aria-selected', String(+li.dataset.i === sel)));
    const cur = list.querySelector(`#cpOpt${sel}`);
    input.setAttribute('aria-activedescendant', cur ? cur.id : '');
    if (scroll && cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  async function run(it) {
    if (!it) return;
    close();
    mru = [it.id, ...mru.filter(x => x !== it.id)]; writeMru(mru);
    try { await it.run(); } catch (e) { console.error(e); }
  }
  async function openPal(prefill = '') {
    if (!root) build();
    const my = ++gen;
    open = true; root.hidden = false; dyn = [];
    input.value = prefill; sel = 0; render();
    input.focus(); input.select();
    // Les fournisseurs (exemples, composants, TP…) répondent à leur rythme ; la liste se complète dès qu'ils ont répondu.
    const got = await Promise.all(providers.map(async p => { try { return (await p()) || []; } catch (e) { console.error(e); return []; } }));
    if (my !== gen || !open) return;
    dyn = got.flat(); render();
  }
  function close() {
    if (!open) return;
    open = false; root.hidden = true; gen++;
    if (document.activeElement === input) input.blur();
  }
  // Aide en ligne (site/aide, produit de docs/GUIDE.md par scripts/help-site.mjs) : toujours dans la palette.
  items.set('help.online', { id: 'help.online', cat: tl('Aide'), icon: 'book', label: tl('Documentation en ligne'), run: () => import('../native.js').then(n => n.openExternal(HELP_URL)) });
  return {
    register(c) { for (const it of Array.isArray(c) ? c : [c]) if (it && it.id && it.label && it.run) items.set(it.id, it); },
    unregister(id) { items.delete(id); },
    /** Commande enregistrée (fixe), utilisable maintenant (when), ou null : les menus reprennent les commandes des modules. */
    get(id) { const it = items.get(id); try { return it && (!it.when || it.when()) ? it : null; } catch (e) { return null; } },
    /** Exécute une commande par son identifiant (comptée dans les dernières utilisées) ; rend false si elle est indisponible. */
    run(id) { const it = this.get(id); if (!it) return false; mru = [it.id, ...mru.filter(x => x !== it.id)]; writeMru(mru); Promise.resolve().then(() => it.run()).catch(e => console.error(e)); return true; },
    provide(fn) { providers.push(fn); return () => { const i = providers.indexOf(fn); if (i >= 0) providers.splice(i, 1); }; },
    open: openPal, close, isOpen: () => open,
    toggle(prefill) { if (open) close(); else openPal(prefill); }
  };
}
