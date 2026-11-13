// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Effecteurs pilotés par le programme : chaque image, l'état des broches de la carte
// (niveau, PWM, tone, servo, NeoPixel, pas à pas) devient lumière, mouvement ou son.
// Un effecteur relié à une carte sans programme garde le comportement d'avant (LED
// allumée dès qu'elle est câblée), géré ailleurs.
import * as audio from './audio.js';
import { tl, DEC } from '../i18n/index.js';
import { MOTORS, isMotor, COILS } from './parts.js';

const IDLE = { mode: 0, d: 0, pwm: null, freq: 0, servo: null, px: null, stepper: null, weak: false };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = v => `${Math.round(v * 100)} %`;
/** Part du temps où la broche est à l'état haut, de 0 à 1. */
const duty = p => (p.weak ? 0.06 : p.mode !== 1 ? 0 : p.freq > 0 ? 0.5 : p.pwm != null ? p.pwm : p.d);
/** Éclat d'une LED d'après son courant (calcul du circuit) : 1 mA ≈ 0,5 ; 12 mA ≈ 1. */
const mAtoB = mA => clamp(Math.log10(Math.max(mA, 1e-6) / 0.05) / Math.log10(300), 0, 1);
const easeTo = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const dec = (v, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toString().replace('.', DEC);
const volts = v => `${dec(v)} V`, milli = mA => `${Math.round(mA)} mA`;
// Inertie (s) et tours par seconde à pleine vitesse, pour l'animation : un ventilateur lance ses pales, un vibreur part tout de suite.
const SPIN = { dcmotor: { tau: 0.3, rev: 3 }, fan: { tau: 0.8, rev: 5 }, pump: { tau: 0.4, rev: 6 }, vibro: { tau: 0.08, rev: 0 } };
/** Vitesse d'un moteur (−1,4 à 1,4) d'après la tension à ses bornes. */
export function motorSpeed(type, v) {
  const m = MOTORS[type];
  if (!m || v == null) return 0;
  const a = Math.abs(v), sp = a <= m.vStart ? 0 : Math.min(1.4, (a - m.vStart) / (m.vNom - m.vStart));
  if (m.polar) return v > 0 ? sp : 0;
  return m.rev ? Math.sign(v) * sp : sp;
}

/**
 * cx : { ins: Map composant → inspection, rts: Map id de carte → exécution, A : analyse du montage,
 *        dc : calcul du circuit (courant réel dans chaque LED) }.
 * Retourne true si au moins un effecteur est piloté par un programme.
 */
export function driveActuators(comps, cx, dt) {
  let any = false;
  // État de la broche de la carte qui commande la broche `k` du composant.
  const pin = (c, k) => {
    const ins = cx.ins.get(c), g = ins && ins.io[k];
    if (!g) return null;
    const rt = cx.rts.get(g.comp.id);
    if (!rt) return undefined;
    return { p: rt.pins.get(g.key) || IDLE, rt, key: g.key };
  };
  const ok = c => { const ins = cx.ins.get(c); return ins && ins.level !== 'err'; };
  // Valeurs du calcul du circuit : ce que l'effecteur reçoit vraiment (pile, transistor, relais, pilote, PWM).
  const dc = cx.dc && cx.dc.ok ? cx.dc : null;
  const across = c => (dc ? dc.across(c) : null);
  const volt = (c, k) => (dc ? dc.volts({ comp: c, key: k }) : null);
  for (const c of comps) {
    if (isMotor(c)) { if (motor(c, across(c), dt)) any = true; continue; }
    // Bobine d'électrovanne : excitée au-delà de sa tension d'appel ; le plan de travail pneumatique lit c.coilOn.
    if (COILS[c.type]) {
      const m = COILS[c.type], a = across(c), v = a && a.v != null ? Math.abs(a.v) : 0, on = v >= m.vPull;
      c.coilOn = on; any = true;
      c.actR = { value: on ? tl('excitée ({0} V)', String(Math.round(v * 10) / 10).replace('.', DEC)) : v > 0.5 ? tl('trop peu de tension ({0} V)', String(Math.round(v * 10) / 10).replace('.', DEC)) : tl('au repos'), level: v > m.vMax || (v > 0.5 && !on) ? 'warn' : 'ok', live: on };
      continue;
    }
    if (c.led) {
      const s = pin(c, 'A'), led = cx.dc && cx.dc.ok && cx.dc.leds ? cx.dc.leds.get(c) : null;
      if (!s) {
        // LED alimentée sans broche de carte (pile, 5 V, transistor) : son courant réel décide.
        if (!led) continue;
        const b = led.mA > 0.01 ? mAtoB(led.mA) : 0;
        c.led.mat.emissive.setHex(b > 0 ? c.led.glow : 0); c.led.mat.emissiveIntensity = 1.3 * b; c.led.light.intensity = 1.6 * b;
        c.actR = { value: b > 0 ? tl('allumée ({0} mA)', (Math.round(led.mA * 10) / 10).toString().replace('.', DEC)) : tl('éteinte'), sig: '', level: 'ok' };
        any = true; continue;
      }
      any = true;
      let b = ok(c) ? duty(s.p) : 0;
      if (cx.dc && cx.dc.dyn && led && led.mA <= 0.01) b = 0; // circuit à condensateur ou transistor : pas de courant, pas de lumière
      c.led.mat.emissive.setHex(b > 0 ? c.led.glow : 0); c.led.mat.emissiveIntensity = 1.3 * b; c.led.light.intensity = 1.6 * b;
      c.actR = { value: b > 0.99 ? tl('allumée') : b > 0 ? tl('allumée à {0}', pct(b)) : tl('éteinte'), sig: s.key, level: ok(c) ? 'ok' : 'err' };
      continue;
    }
    switch (c.type) {
      case 'led-rgb': {
        const r = pin(c, 'R'), g = pin(c, 'G'), b = pin(c, 'B');
        if (!r && !g && !b) break;
        if (r === undefined || g === undefined || b === undefined) break;
        any = true;
        const on = ok(c), v = [r, g, b].map(s => (on && s ? duty(s.p) : 0)), m = Math.max(...v);
        if (c.rgb) {
          c.rgb.mat.emissive.setRGB(v[0], v[1], v[2]); c.rgb.mat.emissiveIntensity = m ? 1.4 : 0;
          c.rgb.light.color.setRGB(v[0], v[1], v[2]); c.rgb.light.intensity = 1.8 * m;
        }
        c.actR = { value: m ? `R ${Math.round(v[0] * 255)} · V ${Math.round(v[1] * 255)} · B ${Math.round(v[2] * 255)}` : tl('éteinte'), sig: (r || g || b).key, level: on ? 'ok' : 'err' };
        break;
      }
      case 'ws2812': {
        const s = pin(c, 'DIN'); if (!s || !c.pixels) break; any = true;
        const px = ok(c) && s.p.px, lit = px ? px.filter(q => q[0] + q[1] + q[2] > 0).length : 0;
        c.pixels.forEach((m, i) => { const q = px && px[i]; if (q) m.emissive.setRGB(q[0] / 255 * 1.6, q[1] / 255 * 1.6, q[2] / 255 * 1.6); else m.emissive.setHex(0); });
        c.actR = { value: lit ? tl('{0} LED allumée{1}', lit, lit > 1 ? 's' : '') : tl('éteinte'), sig: s.key, level: ok(c) ? 'ok' : 'err' };
        break;
      }
      case '7seg': {
        if (!c.seg7) break;
        const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'], st = keys.map(k => pin(c, k));
        if (st.every(s => !s)) break;
        if (st.some(s => s === undefined)) break;
        any = true;
        const on = new Set(ok(c) ? keys.filter((k, i) => st[i] && duty(st[i].p) > 0.3) : []);
        const key = [...on].join();
        if (c.seg7.key !== key) {
          c.seg7.key = key;
          const tex = c.seg7.mesh.material.map, x = tex.image.getContext('2d');
          c.seg7.paint(x, c.seg7.k, on); tex.needsUpdate = true;
          c.seg7.mesh.material.emissiveIntensity = on.size ? 0.9 : 0;
        }
        c.actR = { value: on.size ? `segments ${[...on].join(' ')}` : tl('éteint'), sig: '', level: ok(c) ? 'ok' : 'err' };
        break;
      }
      case 'laser': {
        const s = pin(c, 'S'); if (!s || !c.laser) break; any = true;
        const on = ok(c) && duty(s.p) > 0;
        c.laser.mat.emissive.setHex(on ? 0xff1a1a : 0); c.laser.mat.emissiveIntensity = on ? 2 : 0;
        if (c.laser.beam) c.laser.beam.visible = on;
        c.actR = { value: on ? tl('faisceau allumé') : tl('éteint'), sig: s.key, level: ok(c) ? 'ok' : 'err' };
        break;
      }
      case 'traffic': {
        const st = ['R', 'Y', 'G'].map(k => pin(c, k)); if (!c.traffic || st.every(s => !s)) break;
        if (st.some(s => s === undefined)) break;
        any = true;
        const lit = st.map(s => (ok(c) && s ? duty(s.p) : 0)), names = [tl('rouge'), tl('orange'), tl('vert')];
        c.traffic.lamps.forEach((l, i) => { l.mat.emissive.setHex(lit[i] > 0 ? l.glow : 0); l.mat.emissiveIntensity = 1.5 * lit[i]; });
        const on = names.filter((n, i) => lit[i] > 0);
        c.actR = { value: on.length ? on.join(' + ') : tl('éteint'), sig: (st.find(Boolean) || {}).key || '', level: ok(c) ? 'ok' : 'err' };
        break;
      }
      case 'buzzer': {
        const s = pin(c, '+');
        if (s === undefined) break;
        let on;
        if (s) on = ok(c) && duty(s.p) > 0; // piloté par le programme (tone, digitalWrite, PWM)
        else {
          // Sur une pile, le 5 V, derrière un transistor ou un relais : il sonne dès qu'il reçoit assez de tension.
          const a = across(c); if (!a || a.v == null) break;
          on = a.v > 2.5;
        }
        any = true;
        if (on) audio.tone(c.id, s && s.p.freq > 0 ? s.p.freq : 2730, 'square', 0.03); else audio.silence(c.id);
        c.actR = { value: on ? tl('♪ sonne') : tl('silencieux'), sig: s ? s.key : '', level: !s || ok(c) ? 'ok' : 'err', live: on };
        break;
      }
      case 'speaker': {
        const s = pin(c, '+'); if (!s) break; any = true;
        const f = ok(c) && s.p.mode === 1 ? s.p.freq : 0;
        if (f > 0) audio.tone(c.id, f, 'square', 0.04); else audio.silence(c.id);
        c.actR = { value: f > 0 ? `♪ ${Math.round(f)} Hz` : tl('silencieux'), sig: s.key, level: ok(c) ? 'ok' : 'err', live: f > 0 };
        break;
      }
      case 'relay': {
        // Module actif à l'état bas : la bobine colle quand le module est alimenté et que IN est tiré vers la masse
        // (broche de la carte à LOW, fil vers GND). IN en l'air : tiré au niveau haut sur le module, relais au repos.
        const s = pin(c, 'IN'), vcc = volt(c, 'VCC'), gnd = volt(c, 'GND'), vin = volt(c, 'IN');
        let on, powered = true;
        if (vcc != null && gnd != null) { powered = vcc - gnd > 3.5; on = powered && vin != null && vin - gnd < 1.5; }
        else if (s) on = ok(c) && s.p.mode === 1 && duty(s.p) < 0.5;
        else break;
        any = true;
        if (c.relayOn !== undefined && c.relayOn !== on) audio.click();
        c.relayOn = on;
        if (c.relay) { c.relay.led.emissive.setHex(on ? 0xff2020 : 0); c.relay.led.emissiveIntensity = on ? 1.5 : 0; }
        c.actR = { value: !powered ? tl('bobine non alimentée') : on ? tl('collé : contact fermé') : tl('au repos : contact ouvert'), sig: s ? s.key : '', level: !powered ? 'warn' : !s || ok(c) ? 'ok' : 'err', live: on };
        break;
      }
      case 'servo': {
        const s = pin(c, 'SIG'); if (!s) break; any = true;
        if (c.servoA == null) c.servoA = 90;
        // Tension reçue (calcul du circuit) : sous 4,2 V le servo peine, sous 3 V il ne bouge plus.
        const a = across(c), v = a && a.v != null ? a.v : null, weak = v != null && v < 4.2, dead = v != null && v < 3;
        const target = s.p.servo, powered = ok(c) && !dead;
        let busy = false;
        if (powered && target != null) {
          const step = 600 * dt * (weak ? clamp((v - 3) / 1.2, 0.15, 1) : 1); // SG90 : 0,1 s pour 60°
          busy = Math.abs(target - c.servoA) > 0.5;
          c.servoA += clamp(target - c.servoA, -step, step);
        }
        c.servoBusy = busy; // le servo en mouvement tire son courant sur l'alimentation (calcul suivant)
        if (c.servo) c.servo.piv.rotation.y = c.servoA * Math.PI / 180;
        const val = !ok(c) ? tl('non alimenté') : dead ? tl('tension trop faible ({0}) : le servo ne bouge pas', volts(v)) : target == null ? tl('aucune commande') : tl('angle {0}°', Math.round(c.servoA));
        c.actR = { value: val + (a && a.mA > 1 && powered ? ` · ${milli(a.mA)}` : ''), sig: s.key, level: !ok(c) ? 'err' : dead || weak ? 'warn' : 'ok', live: busy };
        break;
      }
      case 'stepper': {
        const s = pin(c, 'IN1'); if (!s) break; any = true;
        const st = s.p.stepper, powered = ok(c);
        let pos = c.stepPos || 0;
        let busy = false;
        if (st && powered) { const k = st.t1 > st.t0 ? clamp((s.rt.clock() - st.t0) / (st.t1 - st.t0), 0, 1) : 1; pos = st.from + (st.to - st.from) * k; busy = k < 1; }
        c.stepPos = pos; c.stepBusy = busy; // bobines alimentées pendant un pas : courant pris sur VCC
        if (c.spin) c.spin.obj.rotation.y = -pos * Math.PI * 2;
        c.actR = { value: powered ? tl('{0} tour', (Math.round(pos * 100) / 100).toString().replace('.', DEC)) : tl('non alimenté'), sig: s.key, level: powered ? 'ok' : 'err' };
        break;
      }
    }
  }
  return any;
}

/**
 * Moteur CC, ventilateur, pompe, vibreur : vitesse d'après la tension que donne le calcul du circuit, quelle que
 * soit la commande (pile, transistor, relais, pilote L298N, PWM). Rend vrai s'il est relié à quelque chose.
 */
function motor(c, a, dt) {
  if (!a || a.v == null) { if (c.motorV) c.motorV = easeTo(c.motorV, 0, dt, 0.2); return false; }
  const m = MOTORS[c.type], k = SPIN[c.type] || SPIN.dcmotor, target = motorSpeed(c.type, a.v);
  c.motorV = easeTo(c.motorV || 0, target, dt, k.tau);
  const sp = c.motorV, mag = Math.abs(sp);
  if (c.spin && k.rev) c.spin.obj.rotation[c.spin.axis || 'z'] -= sp * dt * Math.PI * 2 * k.rev;
  if (c.buzz) { const o = c.buzz.obj, b = c.buzz.base, j = 0.45 * Math.min(1, mag); o.position.set(b.x + (Math.random() - 0.5) * j, b.y, b.z + (Math.random() - 0.5) * j); }
  if (c.water) { c.water.speed = mag; c.water.tick(dt); }
  const pc = pct(Math.min(1, mag)), el = ` · ${volts(Math.abs(a.v))} · ${milli(Math.abs(a.mA || 0))}`;
  let value;
  if (m.polar && a.v < -m.vStart) value = tl('branché à l’envers : il ne tourne pas');
  else if (mag < 0.02) value = Math.abs(a.v) > 0.05 ? tl('à l’arrêt : {0}, trop peu pour démarrer', volts(Math.abs(a.v))) : tl('à l’arrêt');
  else if (Math.abs(target) < mag - 0.05 && Math.abs(a.v) < m.vStart) value = tl('ralentit sur son élan ({0})', pc); // plus alimenté : il s'arrête peu à peu
  else if (c.type === 'dcmotor') value = `${sp > 0 ? tl('avant') : tl('arrière')} ${pc}${el}`;
  else value = (c.type === 'pump' ? tl('pompe à {0}', pc) : c.type === 'vibro' ? tl('vibre à {0}', pc) : tl('tourne à {0}', pc)) + el;
  const over = Math.abs(a.v) > m.vMax;
  c.actR = { value, sig: '', level: over || (m.polar && a.v < -m.vStart) ? 'warn' : 'ok', live: mag >= 0.02 };
  return true;
}

/** Simulation arrêtée : effecteurs au repos, sons coupés. */
export function resetActuators(comps) {
  audio.stopAll();
  for (const c of comps) {
    c.actR = null; c.relayOn = undefined; c.motorV = 0; c.servoBusy = false; c.stepBusy = false;
    if (c.buzz) c.buzz.obj.position.copy(c.buzz.base);
    if (c.water) { c.water.speed = 0; c.water.tick(0); }
    if (c.rgb) { c.rgb.mat.emissive.setHex(0); c.rgb.mat.emissiveIntensity = 0; c.rgb.light.intensity = 0; }
    if (c.pixels) c.pixels.forEach(m => m.emissive.setHex(0x221a08));
    if (c.relay) { c.relay.led.emissive.setHex(0); c.relay.led.emissiveIntensity = 0; }
    if (c.seg7 && c.seg7.key !== undefined) {
      c.seg7.key = undefined;
      const tex = c.seg7.mesh.material.map; c.seg7.paint(tex.image.getContext('2d'), c.seg7.k, null); tex.needsUpdate = true;
      c.seg7.mesh.material.emissiveIntensity = 0;
    }
  }
}
