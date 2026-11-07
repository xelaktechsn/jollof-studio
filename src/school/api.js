// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Client de l'API de l'espace classe (server/API.md). La session (jetons, utilisateur, école)
// est gardée dans le stockage local ; un jeton d'accès expiré est renouvelé une fois, de façon
// transparente, avec le jeton de rafraîchissement.
import { tl } from '../i18n/index.js';

const KEY = 'jollof-session', SERVER = 'jollof-server';
const DEFAULT = (import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:3100';
let session = null, refreshing = null;
const listeners = new Set();

try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { session = null; }

export class ApiError extends Error {
  constructor(status, code, message, body) { super(message || code); this.status = status; this.code = code; this.body = body; }
}

/** Adresse du serveur : réglée par l'utilisateur, sinon celle de la construction. */
export const server = () => { try { return (localStorage.getItem(SERVER) || DEFAULT).replace(/\/+$/, ''); } catch (e) { return DEFAULT; } };
export function setServer(url) { try { url && url !== DEFAULT ? localStorage.setItem(SERVER, url.replace(/\/+$/, '')) : localStorage.removeItem(SERVER); } catch (e) { /* stockage indisponible */ } }
export const defaultServer = DEFAULT;
export const fileUrl = u => (/^https?:/.test(u) ? u : server() + u);

export const current = () => session;
export const user = () => (session ? session.user : null);
export const isTeacher = () => !!session && (session.user.role === 'teacher' || session.user.role === 'admin');
export function onSession(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function save(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible */ }
  listeners.forEach(fn => fn(session));
}
export function patchSession(p) { if (session) save({ ...session, ...p }); }

async function refresh() {
  if (!session || !session.refreshToken) throw new ApiError(401, 'AUTH_TOKEN_INVALID');
  if (!refreshing) refreshing = (async () => {
    const r = await raw('POST', '/auth/refresh', { refreshToken: session.refreshToken }, false);
    save({ ...session, accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user || session.user, school: r.school || session.school });
  })().catch(e => { if (e.status === 401 || e.status === 403) save(null); throw e; }).finally(() => { refreshing = null; });
  return refreshing;
}
export const accessToken = async () => session && session.accessToken;
export { refresh };

async function raw(method, path, body, auth, form) {
  const headers = {};
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (auth && session) headers.Authorization = 'Bearer ' + session.accessToken;
  let res;
  try { res = await fetch(server() + '/api/v1' + path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch (e) { throw new ApiError(0, 'NETWORK', e.message); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.code) || 'HTTP_' + res.status, data && data.message, data);
  return data;
}
async function request(method, path, body, form) {
  try { return await raw(method, path, body, true, form); }
  catch (e) {
    if (e.status !== 401 || !session || /^\/auth\//.test(path)) throw e;
    await refresh();
    return raw(method, path, body, true, form);
  }
}
export const get = p => request('GET', p);
export const post = (p, b = {}) => request('POST', p, b);
export const put = (p, b = {}) => request('PUT', p, b);
export const patch = (p, b = {}) => request('PATCH', p, b);
export const del = p => request('DELETE', p);
export function upload(file) { const f = new FormData(); f.append('file', file, file.name); return request('POST', '/files', undefined, f); }
export const qs = o => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString(); return s ? '?' + s : ''; };

/* ---------- Compte ---------- */
export async function login(loginName, password) {
  const r = await raw('POST', '/auth/login', { login: loginName.trim(), password }, false);
  save({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user, school: r.school, server: server() });
  return r;
}
export async function registerSchool(o) {
  const r = await raw('POST', '/auth/register-school', o, false);
  save({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user, school: r.school, server: server() });
  return r;
}
export async function logout() {
  const s = session; save(null);
  if (s && s.refreshToken) { try { await raw('POST', '/auth/logout', { refreshToken: s.refreshToken }, false); } catch (e) { /* hors ligne : la session locale est effacée quand même */ } }
}
export async function reloadMe() { const r = await get('/me'); patchSession({ user: r.user, school: r.school }); return r; }

/** Texte à montrer pour une erreur de l'API. */
export function errorText(e) {
  const T = {
    NETWORK: tl('Serveur injoignable : vérifiez la connexion Internet ou l’adresse du serveur.'),
    VALIDATION: tl('Certaines informations sont invalides.'),
    AUTH_INVALID_CREDENTIALS: tl('Identifiant ou mot de passe incorrect.'),
    AUTH_TOKEN_INVALID: tl('Session expirée : reconnectez-vous.'),
    AUTH_DISABLED: tl('Ce compte est désactivé. Adressez-vous à votre enseignant ou à l’administrateur de l’école.'),
    FORBIDDEN: tl('Vous n’avez pas le droit de faire cela.'),
    NOT_FOUND: tl('Introuvable : l’élément a peut-être été supprimé.'),
    PLAN_REQUIRED: tl('L’abonnement de l’école a expiré : les outils enseignant sont en lecture seule.'),
    EMAIL_TAKEN: tl('Cette adresse e-mail est déjà utilisée.'),
    USERNAME_TAKEN: tl('Ce nom d’utilisateur est déjà pris.'),
    NOT_IN_CLASS: tl('Cette personne n’est pas dans la classe.'),
    ASSIGNMENT_CLOSED: tl('Ce devoir est clos.'),
    ATTEMPTS_EXHAUSTED: tl('Plus aucune tentative possible pour ce devoir.'),
    PAST_DUE: tl('La date limite est passée.'),
    TIME_UP: tl('Temps écoulé : votre copie a été envoyée.'),
    SUBMISSION_LOCKED: tl('Cette copie est déjà envoyée.'),
    LOCKED: tl('Quelqu’un d’autre modifie ce projet.'),
    LOCK_REQUIRED: tl('Vous n’avez plus la main sur ce projet.'),
    VERSION_CONFLICT: tl('Une version plus récente a été enregistrée entre-temps.'),
    GROUPS_DISABLED: tl('Les groupes sont désactivés dans cette classe.'),
    GROUP_FULL: tl('Le groupe est complet.'),
    POSTING_DISABLED: tl('Seuls les enseignants peuvent écrire dans cette discussion.'),
    EDIT_WINDOW_PASSED: tl('Un message ne se modifie que dans les 15 minutes.'),
    FILE_TOO_LARGE: tl('Fichier trop lourd (10 Mo au plus).'),
    FILE_TYPE: tl('Type de fichier non accepté.'),
    PAYLOAD_TOO_LARGE: tl('Projet trop lourd pour être envoyé.'),
    RATE_LIMITED: tl('Trop d’essais : patientez une minute.')
  };
  if (e && e.code === 'RATE_LIMITED' && e.body && e.body.retryAfter) { const w = +e.body.retryAfter; return w >= 90 ? tl('Trop d’essais : réessayez dans {0} min.', Math.ceil(w / 60)) : tl('Trop d’essais : réessayez dans {0} s.', w); }
  if (e && T[e.code]) return T[e.code];
  return tl('Erreur inattendue : {0}', (e && (e.message || e.code)) || '?');
}
