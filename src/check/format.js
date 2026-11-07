// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Rendu texte des diagnostics, à la manière de rustc : code, titre, emplacement, état qui déclenche la faute,
// extrait de code souligné, note et aide. Sert à l'outil en ligne de commande, aux tests et au rapport de l'application.
import { tl, COLON, locale } from '../i18n/index.js';

/** Nombre d'états lisible : 1 073 741 824 (ou 1,073,741,824 en anglais). */
export const fmtN = n => Number(n).toLocaleString(locale());

/** Emplacement lisible : « LED1 · A », « UNO D7 », « programme de UNO, ligne 12, colonne 5 ». */
export function where(d) {
  const l = d.loc || {};
  if (l.line) return tl('programme de {0}, ligne {1}, colonne {2}', l.board ? l.board.name : '?', l.line, l.col || 1);
  if (d.where) return d.where;
  if (l.comp) return l.key ? `${l.comp.name} · ${l.key}` : l.comp.name;
  return '';
}

/** Lignes d'un diagnostic. programs : Map id de carte → texte (pour l'extrait de code). */
export function formatDiag(d, programs) {
  const lv = d.level === 'error' ? tl('erreur') : tl('avertissement'), out = [`${lv}[${d.code}]: ${d.title}`];
  out.push(`  --> ${where(d)}`);
  const l = d.loc || {};
  if (l.line && programs && l.board && programs.get(l.board.id)) {
    const src = programs.get(l.board.id).split('\n')[l.line - 1];
    if (src != null) {
      const n = String(l.line), pad = ' '.repeat(n.length);
      out.push(`${pad} |`, `${n} | ${src}`, `${pad} | ${' '.repeat(Math.max(0, (l.col || 1) - 1))}${'^'.repeat(Math.max(1, l.len || 1))}`);
    }
  }
  if (d.state) out.push(`   = ${tl('état')}${COLON}${d.state}${d.states === 2 ? tl(' (et 1 autre état sur {0})', fmtN(d.total)) : d.states > 2 ? tl(' (et {0} autres états sur {1})', fmtN(d.states - 1), fmtN(d.total)) : ''}`);
  if (d.note) out.push(`   = ${tl('note')}${COLON}${d.note}`);
  if (d.help) out.push(`   = ${tl('aide')}${COLON}${d.help}`);
  if (d.accepted != null) out.push(`   = ${tl('accepté')}${COLON}${d.accepted || tl('sans raison donnée')}`);
  out.push(`   = ${tl('en savoir plus')}${COLON}${d.code}`);
  return out;
}

/** Dernière ligne : réussite prouvée, ou nombre d'erreurs comme « error: could not compile ». */
export function summary(r) {
  if (r.errors) return tl('erreur : le montage ne passe pas la vérification ({0} erreur(s), {1} avertissement(s))', r.errors, r.warnings);
  const how = r.proven ? tl('prouvé sûr dans les {0} états atteignables', fmtN(r.states)) : tl('vérifié sur {0} états sur {1} (partiel)', fmtN(r.states), fmtN(r.space));
  return r.warnings ? tl('✓ montage vérifié : 0 erreur, {0} avertissement(s) ; {1}', r.warnings, how) : tl('✓ montage vérifié : 0 erreur ; {0}', how);
}

/** Rapport complet en texte. */
export function formatReport(r, programs) {
  const lines = [];
  for (const d of r.diags) lines.push(...formatDiag(d, programs), '');
  lines.push(summary(r));
  return lines.join('\n');
}
