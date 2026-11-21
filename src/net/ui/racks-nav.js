// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Navigation de la vue Baies vers les autres vues (points d'entrée réutilisables par l'historique de navigation) :
// un équipement de baie vers son nœud du schéma logique ou sa place sur le plan ; un port de panneau ou de switch vers
// le câble, la prise au bout du lien permanent et le port du switch d'en face ; une baie vers sa place sur le plan.
import { portsOf, specOf } from '../devices.js';
import { PANELS } from '../rack.js';

/** Câble branché sur un port, et le bout d'en face : { cable, peer: [dev, port] } ou null. */
export function cableAt(data, devId, portId) {
  const c = (data.cables || []).find(x => (x.a[0] === devId && x.a[1] === portId) || (x.b[0] === devId && x.b[1] === portId));
  return c ? { cable: c, peer: c.a[0] === devId && c.a[1] === portId ? c.b : c.a } : null;
}
/**
 * Ce qui est relié à un port (fonction pure) : pour un port avant de panneau, le cordon et le port du switch, le lien
 * permanent et la prise derrière ; pour un port de switch, le cordon, le panneau et, par le lien permanent, la prise.
 * Rend { cord, switchPort: [dev, port] | null, link, outlet: [dev, port] | null, panelPort: [dev, port] | null }.
 */
export function portLinks(data, devId, portId) {
  const byId = new Map((data.devices || []).map(d => [d.id, d])), d = byId.get(devId);
  const out = { cord: null, switchPort: null, link: null, outlet: null, panelPort: null };
  if (!d) return out;
  const passiveOf = (dev, pid) => { const p = portsOf(dev).find(x => x.id === pid); return p ? p.passive : null; };
  const behind = (panel, front) => { const b = passiveOf(panel, front); const l = b && cableAt(data, panel.id, b); if (l) { out.link = l.cable; out.outlet = l.peer; } };
  if (PANELS.has(d.type)) {
    const p = portsOf(d).find(x => x.id === portId);
    const front = p && p.punch ? p.passive : portId;
    const f = cableAt(data, devId, front); if (f) { out.cord = f.cable; out.switchPort = f.peer; }
    out.panelPort = [devId, front];
    behind(d, front);
    return out;
  }
  const f = cableAt(data, devId, portId); if (!f) return out;
  out.cord = f.cable;
  const peer = byId.get(f.peer[0]);
  if (peer && PANELS.has(peer.type)) { out.panelPort = f.peer; out.switchPort = [devId, portId]; behind(peer, f.peer[1]); }
  else out.switchPort = specOf(peer || {}) ? f.peer : null;
  return out;
}

/** Montre un équipement dans le schéma logique (sélectionné, cadré). */
export function revealLogical(ctx, id) { return ctx.openView('logic').then(() => ctx.reveal(id)); }
/** Montre un câble dans le schéma logique (inspecteur du câble : longueur, catégorie, test). */
export function revealCable(ctx, id) { return ctx.openView('logic').then(() => ctx.reveal(id)); }
/** Montre un équipement (sa place, ou celle de sa baie) ou une baie sur le plan d'étage. */
export function revealOnPlan(ctx, id) {
  return ctx.openView('plan').then(vw => {
    const ok = vw && vw.reveal ? vw.reveal(id) : false;
    if (!ok) ctx.status(ctx.tl('Pas encore de place sur un plan d’étage : placez-le dans la vue Plans.'), 'warn');
    return ok;
  });
}
/** Peut-on le montrer sur un plan ? Une baie posée sur un étage, ou un équipement placé (ou rangé dans une telle baie). */
export function onPlan(data, id) {
  const r = (data.racks || []).find(x => x.id === id); if (r) return !!r.floor;
  const d = (data.devices || []).find(x => x.id === id); if (!d) return false;
  if (d.loc && d.loc.floor) return true;
  const rk = d.rack && (data.racks || []).find(x => x.id === d.rack.id);
  return !!(rk && rk.floor);
}
