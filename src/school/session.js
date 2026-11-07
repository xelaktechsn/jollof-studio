// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Séances de travail dans le plan de travail : un devoir à faire, la copie d'un élève à
// regarder, un projet de groupe. Le projet personnel est mis de côté pendant la séance (aussi
// dans le stockage local, au cas où l'application se fermerait) et revient à la fin.
// Une pastille dans la barre d'application rappelle la séance ; le panneau de droite la détaille.
import { tl } from '../i18n/index.js';
import { icon, esc, toast, confirm, dialog } from './ui.js';
import { hydrateIcons } from '../ui/icons.js';

const STASH = 'jollof-stash';

export function createSessions(app, hub) {
  let cur = null;
  const chip = document.createElement('div');
  chip.className = 'sessChip'; chip.hidden = true;
  document.querySelector('.appbar .project').insertAdjacentElement('afterend', chip);

  function paintChip() {
    if (!cur) { chip.hidden = true; chip.innerHTML = ''; return; }
    const c = cur.chip();
    chip.hidden = false; chip.className = 'sessChip ' + (c.tone || '');
    chip.innerHTML = `<button type="button" class="scMain" data-panel title="${tl('Afficher ou masquer le panneau')}">${icon(c.icon)}<span class="scTitle">${esc(c.title)}</span>${c.meta ? `<span class="scMeta">${c.meta}</span>` : ''}</button>${(c.actions || []).map(a => `<button type="button" class="scAct ${a.kind || ''}" data-act="${a.id}" title="${esc(a.tip || a.label)}">${a.icon ? icon(a.icon) : ''}${a.label ? `<span>${a.label}</span>` : ''}</button>`).join('')}`;
  }
  chip.addEventListener('click', e => {
    if (!cur) return;
    if (e.target.closest('[data-panel]')) return togglePanel();
    const a = e.target.closest('[data-act]'); if (a && cur.action) cur.action(a.dataset.act);
  });
  // Le panneau de la séance est un onglet à part : Câblage, Code et Simulation restent à portée de clic.
  const TAB = { assignment: tl('Devoir'), lab: tl('TP'), project: tl('Projet'), review: tl('Copie'), view: tl('Aperçu') };
  const ICON = { assignment: 'edit', lab: 'checklist', project: 'users', review: 'eye', view: 'eye' };
  function openPanel() { if (!cur || !cur.panel) return; app.sessionTab.open(cur.panel, TAB[cur.kind] || tl('Séance'), ICON[cur.kind]); }
  function closePanel() { app.sessionTab.close(); }
  function togglePanel() { if (!cur || !cur.panel) return; if (app.sessionTab.visible) app.setTab('wiring'); else app.sessionTab.show(); }

  /**
   * Commence une séance. s : { kind, chip() → {icon, title, meta, tone, actions}, panel (élément),
   * action(id), data (projet à ouvrir, facultatif), name, onEnd() }.
   */
  async function begin(s) {
    if (cur && !(await end())) return false;
    if (s.data) {
      const mine = app.projectData();
      try { localStorage.setItem(STASH, JSON.stringify({ data: mine, name: app.projectName(), at: Date.now() })); } catch (e) { /* trop lourd : gardé en mémoire seulement */ }
      s.stash = { data: mine, name: app.projectName() };
      if (!(await app.openProject(s.data, s.name))) { toast(tl('Terminez d’abord l’enregistrement vidéo.'), 'warn'); return false; }
    }
    cur = s; paintChip(); openPanel(); hub.close();
    return true;
  }
  /** Termine la séance (et rend le projet personnel). Renvoie false si l'utilisateur annule. */
  async function end({ silent = false } = {}) {
    if (!cur) return true;
    const s = cur;
    if (s.beforeEnd && !(await s.beforeEnd())) return false;
    cur = null; paintChip(); closePanel();
    if (s.onEnd) { try { await s.onEnd(); } catch (e) { console.error(e); } }
    if (s.stash) {
      await app.openProject(s.stash.data, s.stash.name);
      try { localStorage.removeItem(STASH); } catch (e) { /* rien à effacer */ }
      if (!silent) toast(tl('Votre projet est revenu dans le plan de travail.'));
    }
    return true;
  }
  /** Au démarrage : un projet mis de côté par une séance interrompue est proposé au retour. */
  async function recover() {
    let st = null; try { st = JSON.parse(localStorage.getItem(STASH) || 'null'); } catch (e) { st = null; }
    if (!st || !st.data) return;
    const ok = await confirm(tl('Projet mis de côté'), tl('L’application s’est fermée pendant une séance (devoir ou projet de groupe). Votre projet personnel « {0} » avait été mis de côté : le remettre dans le plan de travail ?', esc(st.name || '')), tl('Restaurer mon projet'));
    if (ok) await app.openProject(st.data, st.name);
    try { localStorage.removeItem(STASH); } catch (e) { /* rien à effacer */ }
  }
  return {
    begin, end, paintChip, openPanel, closePanel, recover,
    get current() { return cur; },
    /** Remplace le contenu du panneau de la séance. */
    setPanel(el) { if (!cur) return; cur.panel = el; openPanel(); },
    dialog
  };
}
