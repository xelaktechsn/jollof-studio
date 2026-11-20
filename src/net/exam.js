// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode examen du plan réseau : data.exam = true (settings.modules.net.exam, gardé par clean.js). L'enseignant le règle
// dans le plan réseau (commande « Réseau : mode examen ») avant d'envoyer le projet, ou un TP le déclare (champ
// « exam »: true, son plan de départ porte alors exam: true). En examen, rien ne donne la réponse à la place de l'élève :
// pas de verdict au sertissage (carte des normes cachée), testeur sans verdict ni nom de défaut (voyants et carte de
// câblage bruts), inspecteur du câble sans conformité ni défaut caché. Pendant une séance (TP, devoir), l'élève ne peut
// pas le retirer.

/** Le plan est-il en mode examen ? */
export const isExam = data => !!(data && data.exam === true);
/** Peut-on changer le mode examen maintenant ? Non pendant une séance (sessions.current : TP, devoir, copie). */
export const examLocked = sessions => !!(sessions && sessions.current);
/**
 * Champ « exam » d'un TP : booléen ; vrai → le plan réseau du départ (et de la solution entière, s'il y en a une) porte
 * exam: true, sinon l'élève ne serait pas en examen. Rend la faute (texte), ou null.
 */
export function examTpError(tp) {
  if (!tp || tp.exam == null) return null;
  if (typeof tp.exam !== 'boolean') return 'exam : true ou false';
  const netOf = p => (((p || {}).settings || {}).modules || {}).net || null;
  const plans = [['départ', netOf(tp.start)], ...(tp.solution && tp.solution.project ? [['solution', netOf(tp.solution.project)]] : [])];
  for (const [what, n] of plans) if (!n || isExam(n) !== tp.exam) return `exam : ${tp.exam} mais le plan réseau du ${what} a exam: ${!!(n && n.exam)}`;
  return null;
}
