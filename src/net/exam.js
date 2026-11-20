// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Mode examen du plan réseau : data.exam = true (settings.modules.net.exam, gardé par clean.js). L'enseignant le règle
// dans le plan réseau (commande « Réseau : mode examen ») avant d'envoyer le projet, ou un TP le déclare (champ
// « exam »: true, son plan de départ porte alors exam: true). En examen, rien ne donne la réponse à la place de l'élève :
// pas de verdict au sertissage (carte des normes cachée), testeur sans verdict ni nom de défaut (voyants et carte de
// câblage bruts), inspecteur du câble sans conformité ni défaut caché, certification sans verdict. Pendant une séance
// (TP, devoir), l'élève ne peut pas le retirer.
//
// Code enseignant (facultatif) : data.examLock = { salt, hash, it } (PBKDF2-SHA-256, sel aléatoire de 16 octets,
// 200 000 tours ; jamais le code en clair). Hors séance, retirer le mode examen demande ce code. Ce que cela protège :
// l'élève qui clique la pastille, la commande ou tout autre chemin de l'interface. Ce que cela ne protège PAS : un
// fichier .jollof est du JSON modifiable ; qui le modifie à la main peut retirer « exam » et « examLock » (il faudrait
// une signature et une clé hors de portée de l'élève, ce qu'une application hors ligne n'a pas), et un code court se
// devine hors ligne malgré PBKDF2 (d'où 6 caractères au moins). L'enseignant qui veut une garantie corrige à partir de
// sa propre copie du projet, ou passe par un devoir de l'espace classe (séance : verrouillé).

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

/* ---------- Code enseignant ---------- */
export const CODE_MIN = 6, LOCK_ITER = 200000;
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
/** Verrou valide (forme) : { salt: 32 hexa, hash: 64 hexa, it }, sinon null. */
export function cleanLock(l) {
  if (!l || typeof l !== 'object' || !/^[0-9a-f]{32}$/.test(l.salt) || !/^[0-9a-f]{64}$/.test(l.hash)) return null;
  const it = Math.round(+l.it); return { salt: l.salt, hash: l.hash, it: it >= 10000 && it <= 5000000 ? it : LOCK_ITER };
}
async function derive(code, salt, it) {
  const c = globalThis.crypto.subtle, k = await c.importKey('raw', new TextEncoder().encode(String(code).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return hex(await c.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, 256));
}
/** Verrou d'un code (6 caractères au moins) : { salt, hash, it }. */
export async function makeLock(code, it = LOCK_ITER) {
  if (String(code).length < CODE_MIN) throw new Error('code trop court');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { salt: hex(salt), hash: await derive(code, salt, it), it };
}
/** Le code ouvre-t-il le verrou ? (comparaison sur toute la longueur) */
export async function checkLock(lock, code) {
  const l = cleanLock(lock); if (!l || !code) return false;
  const h = await derive(code, unhex(l.salt), l.it);
  let d = 0; for (let i = 0; i < 64; i++) d |= h.charCodeAt(i) ^ l.hash.charCodeAt(i);
  return d === 0;
}
/** Essais du code : après 3 erreurs, 30 s d'attente (puis le double à chaque nouvelle erreur, 15 min au plus). */
export function attempts(now = () => Date.now()) {
  let bad = 0, until = 0;
  return {
    wait: () => Math.max(0, until - now()),
    fail() { bad++; if (bad >= 3) until = now() + Math.min(900000, 30000 * 2 ** (bad - 3)); },
    ok() { bad = 0; until = 0; }
  };
}
