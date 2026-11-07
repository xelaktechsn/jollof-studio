// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { err } from './errors';
import { isPlainObject, jsonBytes, KB } from './json';

// Document TipTap/ProseMirror : on n'accepte que ce que l'éditeur de l'application sait
// afficher, pour qu'aucun contenu actif (script, iframe, lien javascript:) ne passe.

const NODES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList',
  'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'image',
]);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'textStyle']);
const MAX_DEPTH = 40;
const DOC_MAX_BYTES = 200 * KB;

// Image : un fichier de ce serveur (chemin relatif ou URL absolue vers /api/v1/files/…).
const FILE_URL = /^(https?:\/\/[^\s/?#]+)?\/api\/v1\/files\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,128}$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

function isHttpUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function checkAttrs(attrs: unknown, where: string) {
  if (attrs === undefined || attrs === null) return;
  if (!isPlainObject(attrs)) throw err.validation(`${where}: attrs must be an object`);
  for (const [k, v] of Object.entries(attrs)) {
    const ok = v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 2048);
    if (!ok) throw err.validation(`${where}: attribute ${k} must be a scalar`);
  }
}

function checkMark(mark: unknown, where: string) {
  if (!isPlainObject(mark) || typeof mark.type !== 'string' || !MARKS.has(mark.type)) {
    throw err.validation(`${where}: mark type not allowed`);
  }
  checkAttrs(mark.attrs, where);
  const attrs = (mark.attrs ?? {}) as Record<string, unknown>;
  if (mark.type === 'link' && !isHttpUrl(attrs.href)) throw err.validation(`${where}: links must be http(s)`);
  if ((mark.type === 'textStyle' || mark.type === 'highlight') && attrs.color != null && !COLOR.test(String(attrs.color))) {
    throw err.validation(`${where}: invalid color`);
  }
}

function checkNode(node: unknown, depth: number, where: string) {
  if (depth > MAX_DEPTH) throw err.validation(`${where}: document too deep`);
  if (!isPlainObject(node) || typeof node.type !== 'string' || !NODES.has(node.type)) {
    throw err.validation(`${where}: node type not allowed`);
  }
  if (node.type === 'doc' && depth > 0) throw err.validation(`${where}: nested doc`);
  checkAttrs(node.attrs, where);
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  if (node.type === 'heading' && ![1, 2, 3].includes(attrs.level as number)) {
    throw err.validation(`${where}: heading level must be 1-3`);
  }
  if (node.type === 'image' && !(typeof attrs.src === 'string' && FILE_URL.test(attrs.src))) {
    throw err.validation(`${where}: image src must be a file URL of this server`);
  }
  if (node.type === 'text') {
    if (typeof node.text !== 'string') throw err.validation(`${where}: text node without text`);
    if (node.content !== undefined) throw err.validation(`${where}: text node with content`);
  } else if (node.text !== undefined) {
    throw err.validation(`${where}: only text nodes carry text`);
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) throw err.validation(`${where}: marks must be an array`);
    node.marks.forEach((m) => checkMark(m, where));
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw err.validation(`${where}: content must be an array`);
    node.content.forEach((c, i) => checkNode(c, depth + 1, `${where}.content[${i}]`));
  }
}

/** Vérifie un document riche ; lève VALIDATION ou PAYLOAD_TOO_LARGE (200 Ko). */
export function assertDoc(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value) || value.type !== 'doc') throw err.validation(`${field} must be a rich text document`);
  if (jsonBytes(value) > DOC_MAX_BYTES) throw err.tooLarge(`${field} exceeds 200 KB`);
  checkNode(value, 0, field);
  return value;
}

/** Variante qui accepte null (champ effacé). */
export function assertDocOrNull(value: unknown, field: string): Record<string, unknown> | null {
  return value === null ? null : assertDoc(value, field);
}
