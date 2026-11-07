// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Texte enrichi (consignes, questions, réponses, commentaires) : éditeur TipTap, chargé à la
// demande. Les documents sont du JSON ProseMirror ; l'affichage passe par le même schéma, donc
// aucun HTML arbitraire n'est rendu. Les images sont des fichiers du serveur : le document garde
// leur chemin (/api/v1/files/…), l'éditeur et l'affichage les complètent avec l'adresse du serveur.
import { tl } from '../i18n/index.js';
import { icon, esc, toast, ask } from './ui.js';
import { upload, server, errorText } from './api.js';
import { openExternal } from '../native.js';

let M = null, loading = null;
/** Charge l'éditeur (une seule fois). */
export function ready() {
  if (M) return Promise.resolve(M);
  if (!loading) loading = Promise.all([
    import('@tiptap/core'), import('@tiptap/starter-kit'), import('@tiptap/extension-underline'), import('@tiptap/extension-link'),
    import('@tiptap/extension-image'), import('@tiptap/extension-placeholder'), import('@tiptap/extension-highlight'),
    import('@tiptap/extension-text-align'), import('@tiptap/extension-task-list'), import('@tiptap/extension-task-item')
  ]).then(([core, sk, ul, link, img, ph, hl, ta, tlist, titem]) => (M = { Editor: core.Editor, generateHTML: core.generateHTML, StarterKit: sk.default, Underline: ul.default, Link: link.default, Image: img.default, Placeholder: ph.default, Highlight: hl.default, TextAlign: ta.default, TaskList: tlist.default, TaskItem: titem.default }));
  return loading;
}
const exts = (placeholder) => [
  M.StarterKit.configure({ heading: { levels: [1, 2, 3] } }), M.Underline, M.Highlight, M.TaskList, M.TaskItem.configure({ nested: true }),
  M.Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
  M.Image.configure({ inline: false, allowBase64: false }), M.TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ...(placeholder ? [M.Placeholder.configure({ placeholder })] : [])
];

/** Parcourt les images d'un document (copie) pour réécrire leur adresse. */
function mapImages(doc, fn) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = Array.isArray(doc) ? doc.map(d => mapImages(d, fn)) : { ...doc };
  if (!Array.isArray(doc)) {
    if (doc.type === 'image' && doc.attrs) out.attrs = { ...doc.attrs, src: fn(doc.attrs.src || '') };
    if (doc.content) out.content = mapImages(doc.content, fn);
  }
  return out;
}
const toAbs = d => mapImages(d, s => (s.startsWith('/') ? server() + s : s));
const toRel = d => mapImages(d, s => (s.startsWith(server() + '/') ? s.slice(server().length) : s));
export const isEmptyDoc = d => !d || !d.content || !d.content.some(n => n.type === 'image' || n.type === 'horizontalRule' || (n.content && JSON.stringify(n.content).includes('"text"')));
export const textDoc = s => ({ type: 'doc', content: String(s || '').split('\n').map(l => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })) });

/** HTML d'un document (l'éditeur doit être chargé : voir ready()). */
export function richHtml(doc) {
  if (!doc || !doc.content) return '';
  if (!M) return `<p>${esc(plainText(doc))}</p>`;
  try { return M.generateHTML(toAbs(doc), exts()); } catch (e) { return `<p>${esc(plainText(doc))}</p>`; }
}
/** Texte brut d'un document (aperçus). */
export function plainText(doc) {
  const out = []; const walk = n => { if (!n) return; if (n.type === 'text') out.push(n.text); (n.content || []).forEach(walk); if (/paragraph|heading|listItem|taskItem/.test(n.type)) out.push(' '); };
  walk(doc); return out.join('').replace(/\s+/g, ' ').trim();
}
/** Les liens d'un texte affiché s'ouvrent dans le navigateur du système, pas dans l'application. */
export function bindLinks(root) {
  root.addEventListener('click', e => { const a = e.target.closest('.richView a[href]'); if (!a) return; e.preventDefault(); openExternal(a.href); });
}

const TOOLS = [
  ['bold', 'bold', tl('Gras (Ctrl+B)'), c => c.toggleBold(), 'bold'],
  ['italic', 'italic', tl('Italique (Ctrl+I)'), c => c.toggleItalic(), 'italic'],
  ['underline', 'underline', tl('Souligné (Ctrl+U)'), c => c.toggleUnderline(), 'underline'],
  ['strike', 'strike', tl('Barré'), c => c.toggleStrike(), 'strike'],
  ['highlight', 'marker', tl('Surligner'), c => c.toggleHighlight(), 'highlight'],
  ['code', 'code', tl('Code'), c => c.toggleCode(), 'code'],
  '|',
  ['bullet', 'list', tl('Liste à puces'), c => c.toggleBulletList(), 'bulletList'],
  ['ordered', 'listOl', tl('Liste numérotée'), c => c.toggleOrderedList(), 'orderedList'],
  ['task', 'checklist', tl('Liste de tâches'), c => c.toggleTaskList(), 'taskList'],
  ['quote', 'quote', tl('Citation'), c => c.toggleBlockquote(), 'blockquote'],
  ['codeBlock', 'terminal', tl('Bloc de code'), c => c.toggleCodeBlock(), 'codeBlock'],
  ['hr', 'minus', tl('Séparateur'), c => c.setHorizontalRule(), null],
  '|',
  ['left', 'alignLeft', tl('Aligner à gauche'), c => c.setTextAlign('left'), { textAlign: 'left' }],
  ['center', 'alignCenter', tl('Centrer'), c => c.setTextAlign('center'), { textAlign: 'center' }],
  ['right', 'alignRight', tl('Aligner à droite'), c => c.setTextAlign('right'), { textAlign: 'right' }],
  '|',
  ['link', 'link', tl('Lien'), null, 'link'],
  ['image', 'image', tl('Image'), null, null],
  '|',
  ['undo', 'undo', tl('Annuler (Ctrl+Z)'), c => c.undo(), null],
  ['redo', 'redo', tl('Rétablir (Ctrl+Maj+Z)'), c => c.redo(), null]
];

/**
 * Éditeur dans host. Renvoie { getJSON, setContent, isEmpty, focus, destroy, editor }.
 * o : { content, placeholder, onChange(doc), compact (barre réduite), minHeight }.
 */
export async function richEditor(host, o = {}) {
  await ready();
  host.classList.add('rich');
  const tools = o.compact ? TOOLS.filter(t => t === '|' || ['bold', 'italic', 'underline', 'highlight', 'code', 'bullet', 'ordered', 'link', 'image'].includes(t[0])) : TOOLS;
  host.innerHTML = `<div class="rtBar" role="toolbar">${o.compact ? '' : `<select class="rtBlock" aria-label="${tl('Style du paragraphe')}"><option value="p">${tl('Texte')}</option><option value="1">${tl('Titre 1')}</option><option value="2">${tl('Titre 2')}</option><option value="3">${tl('Titre 3')}</option></select><span class="rtSep"></span>`}${tools.map(t => (t === '|' ? '<span class="rtSep"></span>' : `<button type="button" class="rtBtn" data-t="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${icon(t[1])}</button>`)).join('')}</div><div class="rtArea" style="min-height:${o.minHeight || 120}px"></div><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>`;
  const bar = host.querySelector('.rtBar'), area = host.querySelector('.rtArea'), file = host.querySelector('input[type=file]');
  const ed = new M.Editor({
    element: area, extensions: exts(o.placeholder || ''), content: o.content ? toAbs(o.content) : '',
    editorProps: { attributes: { class: 'richView editing', spellcheck: 'true' } },
    onUpdate: () => { refresh(); if (o.onChange) o.onChange(api.getJSON()); },
    onSelectionUpdate: () => refresh()
  });
  function refresh() {
    bar.querySelectorAll('.rtBtn').forEach(b => { const t = TOOLS.find(x => x !== '|' && x[0] === b.dataset.t); if (t && t[4]) b.classList.toggle('on', ed.isActive(t[4])); });
    const sel = bar.querySelector('.rtBlock'); if (sel) sel.value = [1, 2, 3].find(l => ed.isActive('heading', { level: l })) || 'p';
    bar.querySelector('[data-t="undo"]') && (bar.querySelector('[data-t="undo"]').disabled = !ed.can().undo());
    bar.querySelector('[data-t="redo"]') && (bar.querySelector('[data-t="redo"]').disabled = !ed.can().redo());
  }
  bar.addEventListener('mousedown', e => { if (e.target.closest('.rtBtn')) e.preventDefault(); });
  bar.addEventListener('click', async e => {
    const b = e.target.closest('.rtBtn'); if (!b) return;
    const t = TOOLS.find(x => x !== '|' && x[0] === b.dataset.t);
    if (t[0] === 'link') {
      const prev = ed.getAttributes('link').href || '';
      const url = await ask(tl('Lien'), tl('Adresse (https://…) — vide pour retirer le lien'), prev, { placeholder: 'https://' });
      if (url === null) return;
      if (!url) ed.chain().focus().extendMarkRange('link').unsetLink().run();
      else if (/^https?:\/\//i.test(url)) ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      else toast(tl('Le lien doit commencer par http:// ou https://'), 'warn');
      return;
    }
    if (t[0] === 'image') { file.click(); return; }
    t[3](ed.chain().focus()).run();
  });
  const blockSel = bar.querySelector('.rtBlock');
  if (blockSel) blockSel.onchange = () => { const v = blockSel.value; v === 'p' ? ed.chain().focus().setParagraph().run() : ed.chain().focus().toggleHeading({ level: +v }).run(); };
  file.onchange = async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    try { const r = await upload(f); ed.chain().focus().setImage({ src: server() + r.url, alt: f.name }).run(); }
    catch (err) { toast(errorText(err), 'err'); }
  };
  refresh();
  const api = {
    editor: ed,
    getJSON: () => (ed.isEmpty ? null : toRel(ed.getJSON())),
    setContent: d => ed.commands.setContent(d ? toAbs(d) : ''),
    isEmpty: () => ed.isEmpty,
    focus: () => ed.commands.focus('end'),
    destroy: () => ed.destroy()
  };
  return api;
}
