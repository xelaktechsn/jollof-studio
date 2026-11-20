// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// HTTP/1.1 minimal sur les connexions du réseau simulé : lecture d'une requête (serveurs des équipements, serveur web
// d'une carte sur l'interpréteur), écriture d'une réponse. Les pages d'état des équipements sont dans pages.js.
import { fromBytes } from './bytes.js';

const dec = x => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } };
export const parseQuery = q => String(q || '').split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), dec(p.slice(i + 1))]; });

/**
 * Requête complète dans buf (chaîne d'octets) ? Rend { method, path, query, args, headers, body, size } ou null s'il
 * manque encore des octets.
 */
export function parseRequest(buf) {
  const i = buf.indexOf('\r\n\r\n'); if (i < 0) return null;
  const lines = buf.slice(0, i).split('\r\n'), m = /^(\w+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/.exec(lines[0] || '');
  if (!m) return { bad: true, size: i + 4 };
  const headers = {};
  for (const l of lines.slice(1)) { const k = l.indexOf(':'); if (k > 0) headers[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim(); }
  const len = +headers['content-length'] || 0;
  if (buf.length - i - 4 < len) return null;
  const body = fromBytes(buf.slice(i + 4, i + 4 + len)), [path, query = ''] = m[2].split('?');
  const args = parseQuery(query).concat(/x-www-form-urlencoded/i.test(headers['content-type'] || '') ? parseQuery(body) : []);
  return { method: m[1].toUpperCase(), path: dec(path), query, args, headers, body, size: i + 4 + len };
}
const REASON = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error' };
export function response(code, type, body, headers = []) {
  const b = new TextEncoder().encode(String(body ?? ''));
  return `HTTP/1.1 ${code} ${REASON[code] || ''}\r\nContent-Type: ${type}\r\nContent-Length: ${b.length}\r\nConnection: close\r\n${headers.map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`;
}
/** Serveur : handler(req) → { code, type, body } (ou une promesse). Rend accept(sock) pour lan.listen(). */
export function createHttpServer(handler) {
  return sock => {
    let buf = '';
    sock.onData(async d => {
      buf += d; const req = parseRequest(buf); if (!req) return;
      buf = '';
      let r;
      try { r = req.bad ? { code: 400, type: 'text/plain', body: 'Bad Request' } : await handler(req); } catch (e) { r = { code: 500, type: 'text/plain', body: String(e && e.message || e) }; }
      r = r || { code: 404, type: 'text/plain', body: 'Not found' };
      sock.write(response(r.code, r.type || 'text/html; charset=utf-8', r.body, r.headers || []));
      sock.write(String(r.body ?? ''));
      sock.close();
    });
  };
}
