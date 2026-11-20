// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// MQTT 3.1.1 (OASIS, 2014) octet par octet : le broker du « Serveur MQTT » du plan réseau (port 1883) et les paquets
// d'un client. Le même broker sert les vrais programmes (PubSubClient compilé, par le modèle W5500) et l'interpréteur
// (PubSubClient simulé, qui envoie ces mêmes paquets). QoS 0 et 1 (QoS 2 accepté et acquitté), messages retenus,
// jokers + et #, PINGREQ, DISCONNECT.
import { byteStr, bytesOf, fromBytes } from './bytes.js';

export const MQTT = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, PUBREC: 5, PUBREL: 6, PUBCOMP: 7, SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };
const u16 = n => [(n >>> 8) & 255, n & 255];
const str = s => { const b = new TextEncoder().encode(String(s)); return [...u16(b.length), ...b]; };
function varLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; }
export const packet = (type, flags, body) => Uint8Array.from([(type << 4) | (flags & 15), ...varLen(body.length), ...body]);

/* ---------- Paquets d'un client ---------- */
export const connectPacket = (clientId, o = {}) => {
  let flags = 2; // session propre
  const tail = [...str(clientId)];
  if (o.user != null) { flags |= 128; tail.push(...str(o.user)); }
  if (o.pass != null) { flags |= 64; tail.push(...str(o.pass)); }
  return packet(MQTT.CONNECT, 0, [...str('MQTT'), 4, flags, ...u16(o.keepAlive ?? 15), ...tail]);
};
export const publishPacket = (topic, payload, o = {}) => {
  const q = o.qos | 0, p = typeof payload === 'string' ? [...new TextEncoder().encode(payload)] : [...payload];
  return packet(MQTT.PUBLISH, (q << 1) | (o.retain ? 1 : 0), [...str(topic), ...(q ? u16(o.id || 1) : []), ...p]);
};
export const subscribePacket = (id, filters) => packet(MQTT.SUBSCRIBE, 2, [...u16(id), ...filters.flatMap(([t, q]) => [...str(t), q | 0])]);
export const unsubscribePacket = (id, filters) => packet(MQTT.UNSUBSCRIBE, 2, [...u16(id), ...filters.flatMap(t => str(t))]);
export const pingPacket = () => packet(MQTT.PINGREQ, 0, []);
export const disconnectPacket = () => packet(MQTT.DISCONNECT, 0, []);

/** Découpe un flux (chaîne d'octets) en paquets : push(données) → [{ type, flags, body (Uint8Array) }]. */
export function mqttReader() {
  let buf = '';
  return {
    push(d) {
      buf += d; const out = [];
      for (;;) {
        if (buf.length < 2) break;
        let len = 0, mul = 1, i = 1, ok = false;
        for (; i < 5 && i < buf.length; i++) { const c = buf.charCodeAt(i); len += (c & 127) * mul; mul *= 128; if (!(c & 128)) { ok = true; i++; break; } }
        if (!ok || buf.length < i + len) break;
        const h = buf.charCodeAt(0);
        out.push({ type: h >> 4, flags: h & 15, body: bytesOf(buf.slice(i, i + len)) });
        buf = buf.slice(i + len);
      }
      return out;
    }
  };
}
const rdStr = (b, i) => { const n = (b[i] << 8) | b[i + 1]; return [new TextDecoder().decode(b.slice(i + 2, i + 2 + n)), i + 2 + n]; };
/** PUBLISH reçu : { topic, payload (Uint8Array), text, qos, retain, id }. */
export function parsePublish(p) {
  const qos = (p.flags >> 1) & 3, [topic, i0] = rdStr(p.body, 0);
  let i = i0, id = 0; if (qos) { id = (p.body[i] << 8) | p.body[i + 1]; i += 2; }
  const payload = p.body.slice(i);
  return { topic, payload, text: new TextDecoder().decode(payload), qos, retain: !!(p.flags & 1), id };
}
/** Un sujet correspond-il à un filtre (jokers + et #) ? */
export function topicMatch(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return i > 0 || !topic.startsWith('$') ? true : false;
    if (i >= t.length) return false;
    if (f[i] === '+') { if (i === 0 && t[0].startsWith('$')) return false; continue; }
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/* ---------- Broker ---------- */
/** log(e) : { kind: 'connect' | 'publish' | 'subscribe' | 'disconnect', client, topic?, text? }. */
export function createBroker({ log = () => {} } = {}) {
  const sessions = new Set(), retained = new Map(), topics = new Map(); // sujet → { text, at, from, n, retained }
  let seen = 0;
  function deliver(topic, payload, retain, from) {
    const text = fromBytes(byteStr(payload));
    const t = topics.get(topic) || { n: 0 }; Object.assign(t, { text, at: Date.now(), from, n: t.n + 1, retained: !!retain }); topics.set(topic, t);
    if (retain) { if (payload.length) retained.set(topic, payload); else retained.delete(topic); }
    seen++;
    log({ kind: 'publish', client: from, topic, text });
    for (const s of sessions) for (const [f, q] of s.subs) if (topicMatch(f, topic)) { s.send(publishPacket(topic, payload, { qos: 0 })); void q; break; }
  }
  function accept(sock) {
    const rd = mqttReader(), s = { id: '', subs: new Map(), sock, send: p => sock.write(p), connected: false };
    sock.onData(d => {
      for (const p of rd.push(d)) {
        if (!s.connected && p.type !== MQTT.CONNECT) { sock.close(); return; }
        switch (p.type) {
          case MQTT.CONNECT: {
            const b = p.body, [proto, i] = rdStr(b, 0), level = b[i];
            if (proto !== 'MQTT' && proto !== 'MQIsdp') { sock.close(); return; }
            const flags = b[i + 1], [cid] = rdStr(b, i + 4);
            if (level !== 4 && level !== 3) { s.send(packet(MQTT.CONNACK, 0, [0, 1])); sock.close(); return; }
            s.id = cid || 'client-' + Math.random().toString(36).slice(2, 7); s.connected = true;
            for (const o of sessions) if (o.id === s.id && o !== s) o.sock.close(); // même identifiant : l'ancienne session part
            sessions.add(s);
            void flags;
            s.send(packet(MQTT.CONNACK, 0, [0, 0]));
            log({ kind: 'connect', client: s.id });
            break;
          }
          case MQTT.PUBLISH: {
            const m = parsePublish(p);
            if (m.qos === 1) s.send(packet(MQTT.PUBACK, 0, u16(m.id)));
            if (m.qos === 2) s.send(packet(MQTT.PUBREC, 0, u16(m.id)));
            deliver(m.topic, m.payload, m.retain, s.id);
            break;
          }
          case MQTT.PUBREL: s.send(packet(MQTT.PUBCOMP, 0, [p.body[0], p.body[1]])); break;
          case MQTT.SUBSCRIBE: {
            const b = p.body, id = (b[0] << 8) | b[1], codes = []; let i = 2;
            while (i < b.length) { const [f, j] = rdStr(b, i); const q = Math.min(1, b[j] & 3); s.subs.set(f, q); codes.push(q); i = j + 1; log({ kind: 'subscribe', client: s.id, topic: f }); }
            s.send(packet(MQTT.SUBACK, 0, [...u16(id), ...codes]));
            for (const [t, pl] of retained) if ([...s.subs.keys()].some(f => topicMatch(f, t))) s.send(publishPacket(t, pl, { retain: true }));
            break;
          }
          case MQTT.UNSUBSCRIBE: {
            const b = p.body, id = (b[0] << 8) | b[1]; let i = 2;
            while (i < b.length) { const [f, j] = rdStr(b, i); s.subs.delete(f); i = j; }
            s.send(packet(MQTT.UNSUBACK, 0, u16(id)));
            break;
          }
          case MQTT.PINGREQ: s.send(packet(MQTT.PINGRESP, 0, [])); break;
          case MQTT.DISCONNECT: sock.close(); break;
          default: break;
        }
      }
    });
    sock.onClose(() => { if (sessions.delete(s)) log({ kind: 'disconnect', client: s.id }); });
  }
  return {
    accept,
    /** Publication depuis le panneau (l'élève) : comme un client nommé « panneau ». */
    publish(topic, text, retain = false) { deliver(String(topic), new TextEncoder().encode(String(text)), retain, 'panneau'); },
    topics: () => [...topics].map(([topic, t]) => ({ topic, ...t })).sort((a, b) => a.topic.localeCompare(b.topic)),
    clients: () => [...sessions].map(s => ({ id: s.id, subs: [...s.subs.keys()] })),
    get count() { return seen; },
    clear() { topics.clear(); retained.clear(); }
  };
}
