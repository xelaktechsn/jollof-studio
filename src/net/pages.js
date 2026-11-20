// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Pages d'état des équipements du plan réseau (port 80) : box, imprimante, caméra, NAS. Séparé de http.js, que
// l'interpréteur charge au démarrage, pour que les fiches des appareils (devices.js) restent chargées à la demande.
import { tl } from '../i18n/index.js';
import { specOf } from './devices.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => ({ code: 200, type: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:sans-serif;margin:16px;color:#1f2937}h1{font-size:20px}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:left}small{color:#64748b}</style></head><body>${body}</body></html>` });
/** Page d'état d'un équipement (port 80). */
export function statusPage(lan, id, req) {
  const st = lan.state(), d = st.byId.get(id); if (!d) return null;
  if (req.path !== '/' && req.path !== '/index.html') return { code: 404, type: 'text/plain', body: 'Not found' };
  const name = d.name || specOf(d).name();
  if (d.type === 'router') {
    const P = d.p, rows = st.ifaces.filter(f => f.server === id).map(f => `<tr><td>${esc((st.byId.get(f.node) || {}).name || f.node)}</td><td>${esc(f.ip)}</td><td><code>${esc(lan.macOf(f.node))}</code></td></tr>`).join('');
    return page(name, `<h1>${esc(name)}</h1><p>${tl('Adresse du réseau local')} : <b>${esc(P.lan.ip)}/${P.lan.prefix}</b></p>
      <p>DHCP : ${P.dhcp.on ? tl('actif, adresses .{0} à .{1}', P.dhcp.from, P.dhcp.to) : tl('désactivé')}</p>
      <h2>${tl('Baux DHCP')}</h2>${rows ? `<table><tr><th>${tl('Appareil')}</th><th>IP</th><th>MAC</th></tr>${rows}</table>` : `<p><small>${tl('Aucun bail.')}</small></p>`}
      <p>Wi-Fi : ${P.wifi && P.wifi.on ? esc(P.wifi.ssid) : tl('désactivé')}</p>`);
  }
  if (d.type === 'printer') return page(name, `<h1>${esc(name)}</h1><p>${tl('État : prête.')}</p><p>${tl('Papier : A4, 230 feuilles.')}</p>`);
  if (d.type === 'camera') return page(name, `<h1>${esc(name)}</h1><p>${tl('Flux vidéo : non simulé.')}</p><p>${tl('Alimentation PoE : {0}', (lan.power(id) || {}).on ? tl('oui') : tl('non'))}</p>`);
  return page(name, `<h1>${esc(name)}</h1><p>${tl('Serveur en marche.')}</p>`);
}
