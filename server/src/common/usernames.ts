// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// « Aïssatou Diallo » → « aissatou.diallo » : prénom.nom en ASCII minuscule.

const LIGATURES: Record<string, string> = { œ: 'oe', Œ: 'oe', æ: 'ae', Æ: 'ae', ß: 'ss', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ł: 'l', Ł: 'l' };

export function asciiFold(s: string): string {
  return s
    .replace(/[œŒæÆßøØđĐłŁ]/g, (c) => LIGATURES[c])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const MAX_BASE = 32;

export function usernameBase(displayName: string): string {
  const tokens = asciiFold(displayName)
    // Apostrophe dans un nom (N'Diaye) : supprimée, pas un séparateur.
    .replace(/['’`]/g, '')
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
  let base = tokens.length === 0 ? 'eleve' : tokens.length === 1 ? tokens[0] : `${tokens[0]}.${tokens[tokens.length - 1]}`;
  base = base.slice(0, MAX_BASE).replace(/[.-]+$/, '');
  if (base.length < 2) base = `${base || 'u'}0`.padEnd(2, '0');
  return base;
}

/** Premier nom libre : base, puis base2, base3… (suffixe numérique quand le nom est pris). */
export function firstFree(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
