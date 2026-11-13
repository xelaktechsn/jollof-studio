// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Supervision MA-ISA du circuit simulé : onglet « Supervision » de l'inspecteur. Le calcul est fait en Rust par la
// caisse publiée maisa-core (src-tauri/supervision) ; ici, on lit les signaux à chaque pas terminé de la simulation
// (10 par seconde, temps simulé), on les envoie, et on affiche la trame reçue. La supervision observe : elle ne
// change rien au circuit ; une panne simulée ne touche que les valeurs que voit le moniteur.
//
// Pensé pour des élèves comme pour des ingénieurs : chaque surveillance s'écrit comme une phrase (« UNO 5V doit
// rester entre 4,75 et 5,25 V », « quand Y1 devient actif, le vérin 1A doit dépasser 0,5 en moins de 1,2 s »), ses
// réglages MA-ISA sont calculés à partir de deux exigences (quel écart signaler, en combien de temps) par les
// fonctions de conception de maisa-core, et restent modifiables sous « Avancé ». Une bannière dit à chaque instant
// ce qui se passe et quoi faire ; la reprise après une mise en sécurité est guidée en trois étapes ; une
// démonstration toute prête et une page d'aide expliquent le principe. Configuration et verrou sont enregistrés
// avec le projet (module « supervision »). Démonstration pédagogique, pas un système de sécurité certifié.
import './supervision.css';
import { tl, DEC } from '../i18n/index.js';
import { icon, hydrateIcons } from '../ui/icons.js';
import { toast, dialog, confirm as confirmDlg } from '../school/ui.js';
import { collectSignals, labelOf, unitOf, isBinary, whoOf, thingsOf } from './signals.js';
import { available, call } from './backend.js';
import DEMO_PROJECT from '../../exemples/08-verin-electropneumatique.jollof?raw';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', DEC));
const num = v => (v === '' || v == null ? null : Number.isFinite(+String(v).replace(',', '.')) ? +String(v).replace(',', '.') : null);
/** États du superviseur : nom, icône, phrase ; la couleur vient de la classe s-<état> (fixe, doublée du nom). */
const STATES = {
  unknown: { name: () => tl('Inconnu'), icon: 'help', text: () => tl('Une mesure manque ou l’horloge est en défaut : impossible de juger.') },
  normal: { name: () => tl('Normal'), icon: 'check', text: () => tl('Tout est dans ses limites.') },
  degraded: { name: () => tl('Dégradé'), icon: 'alert', text: () => tl('Une anomalie dure : alerte levée.') },
  corrective: { name: () => tl('Correction'), icon: 'wrench', text: () => tl('Alerte levée, action corrective autorisée.') },
  safe_requested: { name: () => tl('État sûr demandé'), icon: 'stop', text: () => tl('Anomalie critique : mise en sécurité demandée.') },
  safe_confirmed: { name: () => tl('État sûr confirmé'), icon: 'lock', text: () => tl('La machine est en sécurité ; le défaut est encore là.') },
  locked_recovery: { name: () => tl('Reprise verrouillée'), icon: 'key', text: () => tl('Le défaut a disparu ; la reprise attend votre vérification.') }
};
/** Pannes simulées, en mots simples : ce qu'elles font, réglages éventuels. */
const FAULTS = {
  loss: { name: () => tl('Capteur muet'), text: () => tl('La mesure disparaît : la supervision ne peut plus juger (état Inconnu).') },
  stuck: { name: () => tl('Mesure figée'), text: () => tl('La valeur reste bloquée, quoi qu’il arrive dans le circuit.') },
  stuck_actuator: { name: () => tl('Actionneur bloqué'), text: () => tl('La position observée ne suit plus la commande, comme un vérin ou un moteur coincé.') },
  offset: { name: () => tl('Décalage ou dérive'), text: () => tl('La mesure est faussée d’un écart fixe, qui peut grandir avec le temps.') },
  burst: { name: () => tl('Parasites intermittents'), text: () => tl('Un écart apparaît par moments, puis disparaît.') }
};
const OUTCOME = { accepted: () => tl('acceptée'), duplicate: () => tl('refusée (doublon)'), rejected_guard: () => tl('refusée (non autorisée)'), rejected_limit: () => tl('refusée (budget épuisé)'), rejected_cooldown: () => tl('refusée (trop tôt après la précédente)') };
/** Réglages d'une surveillance de réponse : la relation est violée dès le délai passé ; avec A immobile, l'alerte
 * critique suit de quelques dixièmes de seconde (calculé et affiché par maisa_core::design::time_to_threshold). */
const REL_ACC = { alpha: 1, z_crit: 0.8, z_enter: 0.4, z_exit: 0.2, t_stable: 1, deadband: 0, gain: 1 };
const HISTORY = 1200, LOG = 200, MAX = 16;

export function installSupervision(app) {
  const $ = s => document.querySelector(s);
  let cfg = { version: 1, enabled: true, dt_max: 1, dt_min: 0.016, engine: { n_max: 3, t_cooldown: 2, t_timeout: 10 }, channels: [] };
  let latch = null, neverSaved = true; // verrou enregistré avec le projet (valeur brute relue)
  let running = false, gen = 0, queue = Promise.resolve(), frame = null, selected = 0, cfgError = '', lastPaint = 0, pendingPaint = false;
  let hist = [], log = [], faults = [], signals = [], editing = -1, estimates = {}, shown = false;
  let demo = null; // démonstration guidée : { cycled, faulted, latched, done }
  let demoStash = null, demoLoading = false; // projet de l'utilisateur, remis en place en quittant la démonstration
  let wiz = null; // assistant « nouvelle surveillance » : { step, thing, prob, vals, draft, est }

  $('.panel.right .tabs').insertAdjacentHTML('beforeend', `<button type="button" role="tab" class="tab svTab" id="tab-superv" aria-controls="pane-superv" aria-selected="false" data-tip="${tl('Supervision : un gardien qui surveille le circuit pendant la simulation')}">${icon('eye')}${tl('Supervision')}<span class="live svLive" hidden></span></button>`);
  const pane = document.createElement('div'); pane.className = 'pane svPane'; pane.id = 'pane-superv'; pane.setAttribute('role', 'tabpanel'); pane.hidden = true;
  $('#modPane').before(pane);
  const openTab = () => { shown = true; app.setTab('superv'); render(); };
  $('#tab-superv').onclick = openTab;
  // L'onglet reste ouvert au lancement de la simulation (qui affiche sinon l'onglet Simulation).
  $('.panel.right .tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t && t.id !== 'tab-superv') shown = false; });
  // Première modification d'un projet sans supervision : le verrou part ouvert (il n'a jamais été fermé).
  const dirty = () => { if (neverSaved) { neverSaved = false; latch = false; } app.markDirty(); };
  const logAdd = (t, text, cls = '') => { log.push({ t, text, cls }); if (log.length > LOG) log.splice(0, log.length - LOG); };
  const chName = i => (cfg.channels[i] ? cfg.channels[i].name : `#${i + 1}`);
  const sigs = () => (signals.length ? signals : collectSignals(app));

  /* ---------- Phrases ---------- */
  /** La règle d'une surveillance, en une phrase. */
  function rule(c) {
    if (c.kind === 'relationship' && /\.x$/.test(c.signal_a || '')) return tl('Quand {0} devient actif, le vérin {1} doit sortir au moins à {2} % en moins de {3} s.', whoOf(c.signal_b || '?'), c.signal_a.replace(/\.x$/, ''), Math.round(100 * (+c.threshold || 0)), fmt(c.delay, 1));
    if (c.kind === 'relationship') return tl('Quand {0} devient actif, {1} doit atteindre {2} en moins de {3} s.', whoOf(c.signal_b || '?'), labelOf(c.signal_a || '?'), fmt(c.threshold), fmt(c.delay, 1));
    if (c.only_hard) return tl('{0} ne doit jamais dépasser {1} {2}.', labelOf(c.source || '?'), fmt(c.hard_hi), unitOf(c.source || '')).replace(/ \./, '.');
    const u = unitOf(c.source || ''), lim = [c.hard_lo != null ? tl('jamais sous {0} {1}', fmt(c.hard_lo), u) : '', c.hard_hi != null ? tl('jamais au-dessus de {0} {1}', fmt(c.hard_hi), u) : ''].filter(Boolean).join(', ');
    return tl('{0} doit rester entre {1} et {2} {3}.', labelOf(c.source || '?'), fmt(c.lo), fmt(c.hi), u).replace(/ \./, '.') + (lim ? ' ' + tl('Limite immédiate : {0}.', lim) : '');
  }
  function eventText(e) {
    const st = n => (STATES[n] ? STATES[n].name() : n);
    switch (e.kind) {
      case 'state': return tl('État : {0} → {1}', st(e.from), st(e.to));
      case 'latch': return e.latch ? tl('Verrou de sécurité fermé') : tl('Verrou de sécurité ouvert');
      case 'warning': return e.on ? tl('{0} : alerte', chName(e.channel)) : tl('{0} : fin de l’alerte', chName(e.channel));
      case 'critical': return e.on ? tl('{0} : seuil critique atteint', chName(e.channel)) : tl('{0} : repassé sous le seuil critique', chName(e.channel));
      case 'validity': return e.valid ? tl('{0} : mesure de nouveau disponible', chName(e.channel)) : tl('{0} : mesure absente ou invalide', chName(e.channel));
      case 'hard_limit': return tl('{0} : limite immédiate franchie', chName(e.channel));
      case 'request': return tl('Demande de mise en sécurité n° {0} : {1}', e.id, OUTCOME[e.outcome] ? OUTCOME[e.outcome]() : e.outcome);
      case 'resolved': return e.success ? tl('Mise en sécurité confirmée par l’opérateur') : tl('Mise en sécurité non confirmée dans le délai : échec');
      case 'escalated': return tl('Trop de demandes sans réponse : escalade');
      case 'clock_fault': return tl('Défaut d’horloge : pas de temps hors limites, niveaux figés');
      case 'operator': return { confirm: tl('Vous : état sûr confirmé'), verify: tl('Vous : reprise vérifiée'), reset: tl('Vous : réarmement'), corrective_on: tl('Vous : action corrective autorisée'), corrective_off: tl('Vous : action corrective retirée') }[e.action] || e.action;
      default: return e.kind;
    }
  }

  /* ---------- Réglages tirés des exigences (fonctions de conception de maisa-core, côté Rust) ---------- */
  /** Surveillance de plage : calcule alpha et les seuils pour « signaler un écart de det_dev en det_time s ». */
  async function tuneAxis(c) {
    const r = c.req || (c.req = defaultReq(c));
    if (c.manual) return { ok: true, text: tl('Réglages manuels (onglet « Avancé »).') };
    try {
      const p = await call('design', { tol_dev: r.tol_dev, tol_time: r.tol_time, det_dev: r.det_dev, det_time: r.det_time, scale: r.det_dev, deadband: 0, weight: 1, dt_max: cfg.dt_max, dt_min: cfg.dt_min });
      if (!p.feasible) return { ok: false, text: { not_separable: tl('Impossible : l’écart à signaler doit être plus grand que l’écart toléré, ou durer plus longtemps. Changez l’un des deux.'), sampling: tl('Impossible : {0} s est trop court ; la simulation avance par pas de {1} s au plus. Laissez plus de temps.', fmt(r.det_time, 1), fmt(cfg.dt_max, 1)), invalid_input: tl('Valeurs à corriger : écarts et durées doivent être positifs.') }[p.reason] || p.reason };
      Object.assign(c, { scale: r.det_dev, deadband: 0, weight: 1, alpha: p.alpha, z_crit: p.z_crit, z_enter: p.z_enter, z_exit: p.z_exit, t_stable: p.t_stable });
      delete c.z_max; delete c.guard_band;
      const u = unitOf(c.source || '');
      return { ok: true, text: tl('Un écart de {0} {1} est signalé en {2} s au plus. Un écart de {3} {1} pendant {4} s est ignoré.', fmt(r.det_dev), u, fmt(p.t_detect_sampled, 1), fmt(r.tol_dev), fmt(r.tol_time, 1)).replace(/  /g, ' ') };
    } catch (e) { return { ok: false, text: String(e.message || e) }; }
  }
  /** Surveillance de réponse : réglages fixes ; temps de l'alerte critique si A ne bouge pas, calculé par maisa-core. */
  async function tuneRel(c) {
    if (!c.manual) Object.assign(c, REL_ACC, { scale: Math.max(0.05, Math.abs(+c.threshold || 0) * 0.2) });
    try {
      const p0 = Math.max(0, (+c.threshold || 0) / c.scale) * (c.gain || 1);
      const r = await call('detect_time', { alpha: c.alpha, p0, z_crit: c.z_crit });
      return r.t == null ? { ok: false, text: tl('Avec ces réglages, une absence de réponse ne serait jamais signalée : seuil X trop petit. Augmentez-le, ou réglez à la main sous « Avancé ».') }
        : { ok: true, text: /\.x$/.test(c.signal_a || '') ? tl('Si le vérin {0} ne bouge pas, la mise en sécurité est demandée {1} s après que {2} devient actif.', c.signal_a.replace(/\.x$/, ''), fmt((+c.delay || 0) + r.t, 1), whoOf(c.signal_b || 'B')) : tl('Si {0} reste à 0, l’alerte critique tombe {1} s après que {2} devient actif.', labelOf(c.signal_a || 'A'), fmt((+c.delay || 0) + r.t, 1), whoOf(c.signal_b || 'B')) };
    } catch (e) { return { ok: false, text: String(e.message || e) }; }
  }
  const tuneOne = c => (c.kind === 'relationship' ? tuneRel(c) : tuneAxis(c));
  const tune = async i => { const c = cfg.channels[i]; if (!c) return; estimates[c.id] = await tuneOne(c); };
  function defaultReq(c) {
    const w = Math.max(1e-6, (+c.hi || 0) - (+c.lo || 0));
    return { det_dev: +(w / 2).toPrecision(2), det_time: 2, tol_dev: +(w / 8).toPrecision(2), tol_time: 0.5 };
  }
  /** Nouvelle surveillance de plage autour de la valeur actuelle d'un signal. */
  function newAxis(source) {
    const s = sigs().find(x => x.id === source), v = s && s.value != null ? s.value : 0, w = Math.abs(v) > 0.2 ? Math.abs(v) * 0.1 : 0.5;
    const c = { id: freeId('plage'), name: labelOf(source || tl('Signal')), kind: 'axis', source: source || '', lo: +(v - w).toPrecision(3), hi: +(v + w).toPrecision(3), required: true, ...REL_ACC, scale: w, weight: 1 };
    delete c.gain; c.req = defaultReq(c); return c;
  }
  function newRel(a, b) {
    return { id: freeId('reponse'), name: tl('{0} suit {1}', labelOf(a || 'A'), whoOf(b || 'B')), kind: 'relationship', signal_a: a || '', signal_b: b || '', threshold: 0.5, delay: 2, required: true, ...REL_ACC, scale: 0.1 };
  }
  const freeId = p => { let i = 1; while (cfg.channels.some(c => c.id === `${p}-${i}`)) i++; return `${p}-${i}`; };
  async function validate() { try { await call('validate', { config: cfg }); cfgError = ''; } catch (e) { cfgError = String(e.message || e); } }

  /** Surveillances proposées d'après le circuit : chaque vérin doit sortir après la commande de sa bobine ; chaque
   * rail d'alimentation câblé d'une carte reste à ±5 % de sa tension. */
  function suggest() {
    const list = sigs(), ids = new Set(list.map(s => s.id)), out = [], P = app.pneu;
    if (P && (!app.kind || app.kind() === 'epneu')) for (const l of P.links().filter(x => x.kind === 'coil' && x.bench_part)) {
      const C = P.circuit(), v = C.elements.find(e => e.id === l.element), tube = v && (C.tubes || []).find(t => (t.a[0] === v.id && t.a[1] === '4') || (t.b[0] === v.id && t.b[1] === '4'));
      const cylId = tube && (tube.a[0] === v.id ? tube.b[0] : tube.a[0]), cyl = C.elements.find(e => e.id === cylId && /^cyl/.test(e.type));
      const a = cyl && `${(cyl.p && cyl.p.label) || cyl.id}.x`, b = `${l.tag}.on`, time = +((cyl && cyl.p && cyl.p.time) || 1);
      // La tige doit avoir passé la mi-course peu après la commande : 1,2 fois la durée de course réglée.
      if (a && ids.has(a) && ids.has(b)) out.push({ ...newRel(a, b), id: `rep-${l.tag}`, name: tl('{0} sort après {1}', a.replace(/\.x$/, ''), l.tag), delay: Math.round(12 * time) / 10 });
    }
    for (const s of list) if (/\.(5V|3V3)$/.test(s.id)) {
      const nom = /5V$/.test(s.id) ? 5 : 3.3, c = newAxis(s.id);
      Object.assign(c, { id: `rail-${s.id}`, name: tl('Rail {0}', s.id.replace('.', ' ')), lo: nom * 0.95, hi: nom * 1.05, req: { det_dev: +(nom * 0.1).toPrecision(2), det_time: 2, tol_dev: +(nom * 0.02).toPrecision(2), tol_time: 0.5 } });
      out.push(c);
    }
    return out.filter(c => !cfg.channels.some(x => x.id === c.id)).slice(0, MAX - cfg.channels.length);
  }
  /* ---------- Assistant : quoi surveiller, quel problème, vérifier ---------- */
  /** Électrovanne (ou autre bobine) qui fait sortir un vérin du plan pneumatique, d'après les tuyaux : « Y1.on ». */
  function driverOf(cylSignal) {
    const P = app.pneu; if (!P) return null;
    const C = P.circuit(), name = cylSignal.replace(/\.x$/, '');
    const cyl = C.elements.find(e => /^cyl/.test(e.type) && ((e.p && e.p.label) || e.id) === name); if (!cyl) return null;
    for (const l of P.links().filter(x => x.kind === 'coil')) {
      const v = C.elements.find(e => e.id === l.element), tube = v && (C.tubes || []).find(t => (t.a[0] === v.id && t.a[1] === '4' && t.b[0] === cyl.id) || (t.b[0] === v.id && t.b[1] === '4' && t.a[0] === cyl.id));
      if (tube) return `${l.tag}.on`;
    }
    return null;
  }
  const strokeOf = cylSignal => { const P = app.pneu, n = cylSignal.replace(/\.x$/, ''), e = P && P.circuit().elements.find(x => /^cyl/.test(x.type) && ((x.p && x.p.label) || x.id) === n); return +((e && e.p && e.p.time) || 1); };
  const SPEED = { fast: 1, normal: 3, slow: 6 };
  /** Les problèmes qu'on peut surveiller sur un objet du circuit, en mots simples, avec des valeurs proposées. */
  function problemsFor(t) {
    const all = thingsOf(app), acts = all.filter(x => x.kind === 'act' && x.key !== t.key), pick = list => list.map(x => [x.signal, x.name]);
    const sig = (k, label, list, v) => ({ k, kind: 'sig', label, list, v });
    const n = (k, label, unit, v, step = 'any') => ({ k, kind: 'num', label, unit, v, step });
    const speed = { k: 'speed', kind: 'choice', label: tl('Réagir'), list: [['fast', tl('vite (1 s)')], ['normal', tl('normalement (3 s)')], ['slow', tl('patiemment (6 s)')]], v: 'normal' };
    const near = v => (v == null || !Number.isFinite(v) ? null : +v.toPrecision(3));
    if (t.kind === 'cyl') {
      const cmd = driverOf(t.signal) || (acts[0] && acts[0].signal) || '';
      return [{ id: 'extend', title: tl('Il ne sort pas quand on le commande'), text: tl('Vérin coincé, tuyau débranché, électrovanne en panne : la commande est donnée, la tige ne sort pas.'),
        fields: [sig('cmd', tl('Commandé par'), pick(acts), cmd), n('delay', tl('Temps accordé pour sortir à mi-course'), 's', Math.round(12 * strokeOf(t.signal)) / 10)],
        // Sortie à mi-course (0,5) : un réducteur de débit ralentit la fin de course, pas le début ; délai : 1,2 fois la durée de course.
        make: v => ({ ...newRel(t.signal, v.cmd), name: tl('{0} sort quand {1} le commande', t.name, whoOf(v.cmd)), threshold: 0.5, delay: +v.delay }) }];
    }
    if (t.kind === 'act') {
      const targets = all.filter(x => x.key !== t.key && x.kind !== 'act'), fed = all.find(x => x.kind === 'cyl' && driverOf(x.signal) === t.signal);
      return [{ id: 'effect', title: tl('Ce qu’il commande ne réagit pas'), text: tl('Il est activé, mais l’effet attendu n’arrive pas : panne mécanique, câble coupé, capteur déréglé.'),
        fields: [sig('target', tl('Ce qui doit réagir'), pick(targets), (fed || targets[0] || {}).signal || ''), n('delay', tl('Temps accordé'), 's', 2)],
        make: v => { const k = (all.find(x => x.signal === v.target) || {}).kind, th = k === 'cyl' ? 0.9 : k === 'sensor' ? 0.5 : num(v.expect) ?? 1; return { ...newRel(v.target, t.signal), name: tl('{0} réagit à {1}', labelOf(v.target), t.name), threshold: th, delay: +v.delay }; } }];
    }
    if (t.kind === 'sensor') {
      return [{ id: 'detect', title: tl('Il ne détecte rien après une commande'), text: tl('Par exemple un capteur de fin de course qui devrait se fermer quand le vérin arrive au bout.'),
        fields: [sig('cmd', tl('Après la commande de'), pick(acts), (acts[0] || {}).signal || ''), n('delay', tl('Temps accordé'), 's', 2)],
        make: v => ({ ...newRel(t.signal, v.cmd), name: tl('{0} détecte après {1}', t.name, whoOf(v.cmd)), threshold: 0.5, delay: +v.delay }) }];
    }
    const u = unitOf(t.signal), nom = near(t.value) ?? (/5V$/.test(t.signal) ? 5 : /3V3$/.test(t.signal) ? 3.3 : null);
    return [
      { id: 'range', title: t.kind === 'pin' ? tl('La tension s’écarte de sa valeur normale') : tl('La valeur s’écarte de la normale'), text: t.switching ? tl('Attention : cette broche passe de 0 à 5 V en fonctionnement normal, car elle est reliée à {0}. Surveillez plutôt {0} ou ce qu’il commande.', t.switching) : tl('Une alimentation qui baisse, une broche qui ne donne plus la bonne tension, un réglage qui dérive.'),
        fields: [n('nominal', tl('Valeur normale'), u, nom ?? ''), n('tol', tl('Écart accepté (±)'), '%', 10), speed],
        make: v => { const nominal = +v.nominal, band = Math.max(Math.abs(nominal) * (+v.tol || 10) / 100, 0.05), c = newAxis(t.signal);
          return Object.assign(c, { name: tl('{0} normale', t.name), lo: +(nominal - band).toPrecision(4), hi: +(nominal + band).toPrecision(4), req: { det_dev: +band.toPrecision(3), det_time: SPEED[v.speed] || 3, tol_dev: +(band / 4).toPrecision(3), tol_time: 0.5 } }); } },
      { id: 'never', title: tl('Elle dépasse une valeur à ne jamais franchir'), text: tl('Mise en sécurité immédiate, sans attendre : pour une limite de destruction ou de danger.'),
        fields: [n('limit', tl('Ne jamais dépasser'), u, nom != null ? +(nom * 1.2).toPrecision(3) : '')],
        make: v => { const L = +v.limit, c = newAxis(t.signal); return Object.assign(c, { name: tl('{0} sous {1} {2}', t.name, fmt(L), u).trim(), only_hard: true, lo: -1e6, hi: L, hard_hi: L, req: { det_dev: Math.max(Math.abs(L) * 0.1, 0.05), det_time: 3, tol_dev: Math.max(Math.abs(L) * 0.02, 0.01), tol_time: 0.5 } }); } }
    ];
  }
  /** Brouillon de la surveillance à partir des réponses ; null si une réponse manque. */
  function draftOf() {
    const pr = wiz && wiz.prob; if (!pr) return null;
    for (const f of pr.fields) { const v = wiz.vals[f.k]; if (v === '' || v == null || (f.kind === 'num' && num(v) == null)) return null; }
    const c = pr.make(wiz.vals); c.id = freeId(c.id.replace(/-\d+$/, '')); return c;
  }
  function openWizard() {
    if (running) { toast(tl('Arrêtez la simulation pour ajouter une surveillance.'), 'warn'); return; }
    if (cfg.channels.length >= MAX) { toast(tl('{0} surveillances au plus.', MAX), 'warn'); return; }
    wiz = { step: 1, thing: null, prob: null, vals: {}, draft: null, est: null }; editing = -1; render();
  }
  function paintWizard() {
    const box = q('wiz'); if (!box) return;
    if (!wiz) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const W = wiz, dots = [tl('Quoi'), tl('Quel problème'), tl('Vérifier')].map((l, i) => `<li class="${i + 1 === W.step ? 'cur' : i + 1 < W.step ? 'done' : ''}"><span>${i + 1 < W.step ? icon('check') : i + 1}</span>${l}</li>`).join('');
    let body = '';
    if (W.step === 1) {
      const things = thingsOf(app);
      body = `<h4>${tl('Que voulez-vous surveiller ?')}</h4>` + (things.length ? `<div class="svThings">${things.map(x => `<button type="button" class="svThing" data-thing="${esc(x.key)}">${icon(x.icon)}<b>${esc(x.name)}</b>${x.value != null && (x.kind === 'pin' || x.kind === 'analog') ? `<small>${fmt(x.value)} ${unitOf(x.signal)}</small>` : ''}</button>`).join('')}</div>` : `<p class="svSmall">${tl('Rien à surveiller pour l’instant : ajoutez des composants au circuit (une carte, un capteur, une électrovanne…).')}</p>`);
    }
    if (W.step === 2) {
      const probs = problemsFor(W.thing);
      body = `<h4>${tl('Qu’est-ce qui serait anormal pour {0} ?', esc(W.thing.name))}</h4><div class="svProbs">${probs.map(p => `<button type="button" class="svProb${W.prob && W.prob.id === p.id ? ' on' : ''}" data-prob="${p.id}"><b>${p.title}</b><small>${p.text}</small></button>`).join('')}</div>`;
      if (W.prob) body += `<div class="svFields">${W.prob.fields.map(f => `<label class="svF">${f.label}${f.kind === 'num' ? `<span class="svIn"><input class="inp" type="number" step="${f.step}" data-w="${f.k}" value="${esc(W.vals[f.k] ?? '')}">${f.unit ? `<i>${esc(f.unit)}</i>` : ''}</span>` : `<select class="sel" data-w="${f.k}">${f.kind === 'sig' ? `<option value="">${tl('(choisir)')}</option>` : ''}${f.list.map(([v, l]) => `<option value="${esc(v)}"${String(W.vals[f.k]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`}</label>`).join('')}</div>`;
    }
    if (W.step === 3) {
      body = `<h4>${tl('Le gardien vérifiera que :')}</h4><p class="svSummary">${esc(rule(W.draft))}</p><p class="svSmall">${tl('Sinon : une alerte d’abord, puis une demande de mise en sécurité si cela dure.')}</p><p class="svSmall">${icon('info')} ${tl('Conseil : lancez d’abord la simulation sans panne et faites fonctionner le circuit : la surveillance doit rester « Normal ». Sinon, accordez plus de temps ou un écart plus large.')}</p>${W.est ? `<p class="svEst ${W.est.ok ? 'ok' : 'bad'}">${icon(W.est.ok ? 'clock' : 'alert')}<span>${esc(W.est.text)}</span></p>` : ''}
        <label class="svF wide">${tl('Nom de la surveillance')}<input class="inp" data-wname value="${esc(W.draft.name)}" maxlength="40"></label>`;
    }
    const ready = W.step === 1 ? false : W.step === 2 ? !!draftOf() : !!(W.est && W.est.ok);
    box.innerHTML = `<header><b>${icon('plus')}${tl('Nouvelle surveillance')}</b><span class="grow"></span><button type="button" class="tb" data-wact="close" aria-label="${tl('Fermer')}">${icon('x')}</button></header>
      <ol class="svDots">${dots}</ol>${body}
      <footer>${W.step > 1 ? `<button type="button" class="btn small" data-wact="back">${icon('chevLeft')}<span>${tl('Retour')}</span></button>` : ''}<span class="grow"></span>${W.step === 2 ? `<button type="button" class="btn small primary" data-wact="next"${ready ? '' : ' disabled'}>${tl('Suivant')}${icon('chevRight')}</button>` : W.step === 3 ? `<button type="button" class="btn small primary" data-wact="create"${ready ? '' : ' disabled'}>${icon('check')}<span>${tl('Créer la surveillance')}</span></button>` : ''}</footer>`;
    hydrateIcons(box);
    if (W.step === 3) { const i = box.querySelector('[data-wname]'); if (i && document.activeElement === document.body) i.focus(); }
  }
  async function wizardClick(e) {
    const W = wiz; if (!W) return false;
    const th = e.target.closest('[data-thing]'), pr = e.target.closest('[data-prob]'), wa = e.target.closest('[data-wact]');
    if (!th && !pr && !wa) return false;
    if (th) { W.thing = thingsOf(app).find(x => x.key === th.dataset.thing); W.step = 2; const ps = problemsFor(W.thing); W.prob = ps.length === 1 ? ps[0] : null; W.vals = W.prob ? Object.fromEntries(W.prob.fields.map(f => [f.k, f.v])) : {}; }
    if (pr) { W.prob = problemsFor(W.thing).find(x => x.id === pr.dataset.prob); W.vals = Object.fromEntries(W.prob.fields.map(f => [f.k, f.v])); }
    if (wa) {
      const a = wa.dataset.wact;
      if (a === 'close') { wiz = null; render(); return true; }
      if (a === 'back') { W.step = Math.max(1, W.step - 1); }
      if (a === 'next') { W.draft = draftOf(); if (!W.draft) return true; W.step = 3; W.est = null; paintWizard(); W.est = await tuneOne(W.draft); }
      if (a === 'create' && W.draft && W.est && W.est.ok) {
        const c = W.draft, nm = pane.querySelector('[data-wname]'); if (nm && nm.value.trim()) c.name = nm.value.trim();
        cfg.channels.push(c); estimates[c.id] = W.est; wiz = null; dirty(); await validate(); render();
        toast(cfgError ? tl('Surveillance ajoutée, avec un réglage à corriger : {0}', cfgError) : tl('Surveillance « {0} » ajoutée. Lancez la simulation pour la voir à l’œuvre.', c.name), cfgError ? 'warn' : 'ok', 6000);
        return true;
      }
    }
    paintWizard(); return true;
  }

  async function autoWatch() {
    const s = suggest();
    if (!s.length) { toast(tl('Rien à proposer automatiquement pour ce circuit : ajoutez une surveillance à la main.'), 'warn', 6000); return false; }
    cfg.channels.push(...s); for (let i = cfg.channels.length - s.length; i < cfg.channels.length; i++) await tune(i);
    dirty(); await validate(); render(); return true;
  }

  /* ---------- Trames ---------- */
  function onFrame(f) {
    frame = f;
    if (f.latch_changed) { latch = f.latch; dirty(); } // verrou : enregistré avec le projet dès qu'il change
    f.channels.forEach((c, i) => { const h = hist[i] || (hist[i] = []); h.push([f.time, c.valid ? c.value : null]); if (h.length > HISTORY) h.splice(0, h.length - HISTORY); });
    for (const e of f.events) logAdd(f.time, eventText(e), e.kind === 'latch' || e.kind === 'critical' || e.kind === 'hard_limit' ? 'crit' : e.kind === 'warning' || e.kind === 'clock_fault' || e.kind === 'validity' ? 'warn' : '');
    if (demo) {
      if (!demo.faulted && app.pneu && app.pneu.moves().length >= 2) demo.cycled = true;
      if (f.latch) demo.latched = true;
      if (demo.latched && !f.latch && f.state === 'normal') demo.done = true;
    }
    // Affichage limité à 20 par seconde ; le moniteur, lui, a évalué chaque pas.
    const now = performance.now();
    if (now - lastPaint >= 50) { lastPaint = now; paintLive(); } else if (!pendingPaint) { pendingPaint = true; setTimeout(() => { pendingPaint = false; lastPaint = performance.now(); paintLive(); }, 50); }
  }

  /* ---------- Simulation ---------- */
  const active = () => cfg.enabled && cfg.channels.length > 0 && available();
  app.onSimState(on => { if (shown) app.setTab('superv'); restart(on); });
  /** (Re)démarre la supervision avec la configuration courante, ou l'arrête. */
  async function restart(on) {
    running = false; gen++; frame = null; hist = []; $('.svLive').hidden = true;
    if (!on) { queue = queue.then(() => (available() ? call('stop').catch(() => {}) : null)); render(); return; }
    if (!active()) { render(); return; }
    const my = gen;
    try {
      const r = await call('configure', { config: cfg, latch, never_saved: neverSaved, t0: 0 });
      if (my !== gen) return;
      cfgError = ''; running = true; $('.svLive').hidden = false;
      log = []; logAdd(0, tl('Supervision lancée : {0} surveillance(s), verrou {1}', r.channels, r.latch ? tl('fermé') : tl('ouvert')));
      refreshFaults();
    } catch (e) { cfgError = String(e.message || e); toast(tl('Supervision non lancée : {0}', cfgError), 'warn', 7000); }
    render();
  }
  // Chaque pas terminé du circuit : instantané des signaux, envoyé dans l'ordre (aucun pas n'est sauté).
  app.onSimTick(t => {
    signals = collectSignals(app);
    if (!running) return;
    const my = gen, snap = signals;
    queue = queue.then(() => call('step', { t, signals: snap })).then(f => { if (my === gen) onFrame(f); }, e => { if (my === gen) { running = false; cfgError = String(e.message || e); render(); } });
  });
  async function operator(action, on) {
    try { await call('operator', { action, on }); } catch (e) { toast(String(e.message || e).replace(/^rejected: /, ''), 'warn', 6000); }
  }
  async function refreshFaults() { try { faults = await call('fault_list'); } catch (e) { faults = []; } paintFaults(); }
  async function addFault(fault) {
    try { await call('fault_add', { fault }); logAdd(app.simTime ? app.simTime() : 0, tl('Panne simulée : {0} sur {1}', FAULTS[fault.kind].name(), labelOf(fault.signal)), 'warn'); if (demo) demo.faulted = true; } catch (err) { toast(String(err.message || err), 'warn', 6000); }
    await refreshFaults(); paintLive();
  }
  async function clearFaults(id) {
    try { if (id == null) await call('fault_clear_all'); else await call('fault_clear', { id }); logAdd(app.simTime ? app.simTime() : 0, id == null ? tl('Pannes simulées retirées') : tl('Panne simulée retirée')); } catch (err) { toast(String(err.message || err), 'warn'); }
    await refreshFaults(); paintLive();
  }
  /** Appui bref sur un bouton du montage (démonstration). */
  function tap(name) {
    const b = app.comps().find(c => c.name === name && c.inp && 'pressed' in c.inp); if (!b) return;
    b.inp.pressed = true; app.invalidate(600); setTimeout(() => { b.inp.pressed = false; app.invalidate(300); }, 450);
  }

  /* ---------- Démonstration et aide ---------- */
  async function startDemo() {
    if (demo) return;
    if (app.comps().length && !(await confirmDlg(tl('Démonstration de la supervision'), tl('La démonstration ouvre le projet « Vérin électropneumatique ». Votre projet est mis de côté, tel quel : il revient quand vous quittez la démonstration.'), tl('Ouvrir la démonstration')))) return;
    if (app.simOn()) app.setSim(false);
    demoStash = { data: app.projectData(), name: app.projectName(), path: app.projectPath ? app.projectPath() : null, dirty: app.isDirty ? app.isDirty() : false };
    const d = JSON.parse(DEMO_PROJECT); delete d.en;
    demoLoading = true; try { await app.openProject(d, d.name); } finally { demoLoading = false; }
    cfg.channels = []; latch = false; neverSaved = false;
    if (app.pneu && app.pneu.isOn()) app.pneu.setMode(false);
    await new Promise(r => requestAnimationFrame(r));
    await autoWatch();
    demo = { cycled: false, faulted: false, latched: false, done: false };
    openTab();
  }
  /** Quitte la démonstration : simulation arrêtée, pannes retirées, projet de l'utilisateur remis tel qu'il était. */
  async function quitDemo() {
    if (app.simOn()) app.setSim(false);
    const back = demoStash; demoStash = null; demo = null;
    if (available()) await call('fault_clear_all').catch(() => {});
    if (back) { demoLoading = true; try { await app.openProject(back.data, back.name, { path: back.path, dirty: back.dirty }); } finally { demoLoading = false; } }
    toast(back ? tl('Démonstration terminée : votre projet est de retour.') : tl('Démonstration terminée.'), 'ok', 5000);
    openTab();
  }
  function help() {
    const st = Object.entries(STATES).map(([k, S]) => `<li><span class="svDot s-${k}"></span><b>${S.name()}</b><span>${S.text()}</span></li>`).join('');
    const body = `<div class="svDoc">
      <p class="lead">${tl('La supervision regarde le circuit pendant la simulation, comme un gardien. Elle ne commande rien et ne modifie rien : elle observe, juge, prévient, et demande une mise en sécurité si une anomalie dure.')}</p>
      <ol class="svFlow"><li><b>${tl('Mesure')}</b><span>${tl('une tension, un bouton, la position d’un vérin')}</span></li><li><b>${tl('Écart')}</b><span>${tl('hors de la plage prévue ? de combien ?')}</span></li><li><b>${tl('Niveau d’anomalie')}</b><span>${tl('monte tant que l’écart dure, redescend peu à peu sinon')}</span></li><li><b>${tl('Décision')}</b><span>${tl('alerte, puis mise en sécurité')}</span></li></ol>
      <h4>${tl('Pourquoi accumuler ?')}</h4><p>${tl('Un pic bref, comme un parasite, ne déclenche rien ; un petit écart qui dure, si. Chaque surveillance a son propre niveau : aucun n’est moyenné avec les autres, si bien qu’une panne grave ne peut pas être cachée par des mesures normales ailleurs. C’est le principe de MA-ISA (accumulation intégrée multi-axes).')}</p>
      <h4>${tl('Deux sortes de surveillance')}</h4><ul><li><b>${tl('Plage')}</b> : ${tl('un signal doit rester entre deux valeurs (une tension d’alimentation, une température). On peut ajouter une limite immédiate, qui déclenche la mise en sécurité sans attendre.')}</li><li><b>${tl('Réponse')}</b> : ${tl('après une commande, un signal doit réagir à temps (le vérin sort quand l’électrovanne est excitée, le moteur tourne quand le relais colle).')}</li></ul>
      <h4>${tl('Les états')}</h4><ul class="svStates">${st}</ul>
      <h4>${tl('Le verrou et la reprise')}</h4><p>${tl('Dès qu’une mise en sécurité est demandée, le verrou se ferme. Il reste fermé même si le défaut disparaît, et même après la fermeture du projet. Pour repartir, trois gestes, dans l’ordre : confirmer que la machine est en sécurité, vérifier que le défaut a disparu, réarmer. Une personne garde toujours la main.')}</p>
      <h4>${tl('Mesure absente')}</h4><p>${tl('Une mesure qui manque n’est jamais remplacée par zéro : le niveau reste figé et l’état devient Inconnu, jusqu’au retour de la mesure.')}</p>
      <h4>${tl('Pannes simulées')}</h4><p>${tl('Pour s’exercer, on peut fausser ce que voit la supervision (capteur muet, mesure figée, actionneur bloqué…) sans toucher au circuit, qui continue de fonctionner normalement.')}</p>
      <p class="note">${tl('Calcul en temps simulé, à chaque pas du circuit (10 par seconde), par maisa-core, l’implémentation de référence de MA-ISA (Rust), utilisée telle quelle. Démonstration pédagogique : ce n’est pas un système de sécurité certifié.')}</p></div>`;
    return dialog({ title: tl('{0}Comment fonctionne la supervision ?', icon('eye')), width: 640, cls: 'svHelpDlg', body, actions: [{ label: tl('Fermer'), value: null }, { label: tl('Essayer la démonstration'), value: 'demo', kind: 'primary' }] }).then(v => { if (v === 'demo') startDemo(); });
  }

  /* ---------- Ce qu'il faut faire maintenant ---------- */
  /** Bannière : la situation en une phrase, et l'action utile (bouton) s'il y en a une. */
  function guide() {
    const f = frame, st = running && f ? f.state : null, warn = f ? f.channels.filter(c => c.warning || c.critical).map(c => c.name) : [];
    if (cfgError) return { tone: 'bad', icon: 'alert', text: tl('Réglage à corriger : {0}', cfgError) };
    if (!app.simOn()) return { tone: 'go', icon: 'play', text: demo ? tl('Démonstration, étape 1 : lancez la simulation. La surveillance « {0} » vérifie que le vérin sort quand la carte excite l’électrovanne.', cfg.channels[0] ? cfg.channels[0].name : '') : tl('Lancez la simulation : chaque pas du circuit sera surveillé.'), btn: ['sim', 'play', tl('Simuler')] };
    if (!running) return { tone: 'bad', icon: 'alert', text: tl('La supervision n’a pas pu démarrer. Arrêtez puis relancez la simulation.') };
    if (!f) return { tone: '', icon: 'clock', text: tl('Premières mesures…') };
    if (st === 'unknown') return { tone: 'warn', icon: 'help', text: faults.some(x => x.kind === 'loss') ? tl('Capteur muet : la supervision ne peut plus juger. Les niveaux restent figés, rien n’est inventé. Retirez la panne pour revenir.') : tl('Une mesure manque (signal non câblé ou absent) : impossible de juger. Vérifiez le signal de chaque surveillance.') };
    if (st === 'safe_requested') return { tone: 'bad', icon: 'stop', text: tl('Mise en sécurité demandée : {0} a franchi le seuil critique. Arrêtez la machine dans une position sans danger, puis confirmez-le (étape 1 ci-dessous).', warn.join(', ') || tl('une surveillance')) };
    if (st === 'safe_confirmed') return faults.length ? { tone: 'info', icon: 'lock', text: tl('En sécurité. La panne simulée est encore là : retirez-la pour que la reprise devienne possible.'), btn: ['clearfaults', 'x', tl('Retirer la panne')] } : { tone: 'info', icon: 'lock', text: tl('En sécurité. La reprise attend que le défaut disparaisse.') };
    if (st === 'locked_recovery') return f.evidence.r ? { tone: 'info', icon: 'key', text: tl('Dernière étape : réarmez pour ouvrir le verrou et repartir.') } : { tone: 'info', icon: 'key', text: tl('Le défaut a disparu. Vérifiez que la machine peut repartir sans danger (étape 2).') };
    if (st === 'degraded') return { tone: 'warn', icon: 'alert', text: tl('Alerte sur {0} : l’anomalie dure. Si elle continue, la mise en sécurité sera demandée.', warn.join(', ')), btn: ['corrective', 'wrench', tl('Autoriser une correction')] };
    if (st === 'corrective') return { tone: 'warn', icon: 'wrench', text: tl('Correction autorisée sur {0}. Si l’anomalie disparaît, l’état redevient Normal.', warn.join(', ')), btn: ['corrective-off', 'x', tl('Retirer l’autorisation')] };
    if (demo && demo.done) return { tone: 'ok', icon: 'award', text: tl('Démonstration terminée : la supervision a vu que le vérin ne répondait plus, a demandé la mise en sécurité, puis vous a laissé reprendre en trois étapes. Essayez une autre panne, ou retrouvez votre projet.'), btn: ['demo-quit', 'x', tl('Quitter la démonstration')] };
    if (demo && !demo.cycled) return { tone: 'go', icon: 'pointer', text: tl('Étape 2 : appuyez sur BTN1. Le vérin sort puis rentre ; la commande est suivie d’effet, l’état reste Normal.'), btn: ['tap', 'pointer', tl('Appuyer sur BTN1')] };
    if (demo && !demo.faulted) return { tone: 'go', icon: 'bug', text: tl('Étape 3 : simulez une panne. La position du vérin vue par la supervision ne bougera plus, comme si le vérin était coincé ; le vrai vérin, lui, continue.'), btn: ['demofault', 'bug', tl('Simuler la panne')] };
    if (demo) return { tone: 'go', icon: 'pointer', text: tl('Étape 4 : appuyez de nouveau sur BTN1 et regardez le niveau d’anomalie monter.'), btn: ['tap', 'pointer', tl('Appuyer sur BTN1')] };
    return faults.length ? { tone: 'ok', icon: 'check', text: tl('Tout va bien, malgré la panne simulée : elle n’a pas (encore) d’effet sur ce qui est surveillé.') } : { tone: 'ok', icon: 'check', text: tl('Tout va bien. Pour voir la supervision réagir, simulez une panne plus bas.') };
  }

  /* ---------- Affichage ---------- */
  const q = k => pane.querySelector(`[data-sv="${k}"]`);
  function render() {
    if (pane.hidden) return;
    const head = `<header class="svHead"><b>${icon('eye')}${tl('Supervision')}</b><span class="grow"></span>${!available() ? '' : demo ? `<button type="button" class="btn small primary" data-act="demo-quit">${icon('x')}<span>${tl('Quitter la démonstration')}</span></button>` : `<button type="button" class="btn small" data-act="demo"${running ? ' disabled' : ''}>${icon('graduation')}<span>${tl('Démonstration')}</span></button>`}<button type="button" class="tb" data-act="help" aria-label="${tl('Comment ça marche ?')}" title="${tl('Comment ça marche ?')}">${icon('help')}</button></header>`;
    if (!available()) {
      pane.innerHTML = head + `<section class="svIntro">${icon('eye')}<b>${tl('Un gardien pour votre circuit')}</b><p>${tl('La supervision tourne dans l’application Jollof Studio installée : son calcul est fait en Rust, par maisa-core.')}</p><button type="button" class="link" data-act="help">${tl('Comment ça marche ?')}</button></section>`;
      hydrateIcons(pane); return;
    }
    if (!cfg.channels.length && wiz) { pane.innerHTML = head + `<section class="svWiz" data-sv="wiz"></section>`; hydrateIcons(pane); paintWizard(); return; }
    if (!cfg.channels.length) {
      pane.innerHTML = head + `<section class="svIntro">${icon('eye')}<b>${tl('Un gardien pour votre circuit')}</b>
        <p>${tl('Pendant la simulation, la supervision repère un signal qui sort de sa plage ou une commande qui n’est pas suivie d’effet. Elle prévient d’abord, puis demande une mise en sécurité si l’anomalie dure. Elle ne modifie jamais le circuit.')}</p>
        <ol class="svIdeas"><li><b>${tl('Choisissez quoi surveiller')}</b><span>${tl('un vérin, une électrovanne, un capteur, une tension')}</span></li><li><b>${tl('Dites ce qui serait anormal')}</b><span>${tl('« il ne sort pas quand on le commande »')}</span></li><li><b>${tl('Lancez la simulation')}</b><span>${tl('le gardien prévient, puis met en sécurité')}</span></li></ol>
        <div class="svIntroBtns"><button type="button" class="btn primary" data-act="wizard">${icon('plus')}<span>${tl('Ajouter une surveillance')}</span></button><button type="button" class="btn" data-act="auto" data-tip="${tl('Propose des surveillances d’après le circuit')}">${icon('wand')}<span>${tl('Me proposer')}</span></button></div>
        <p class="svSmall">${tl('Première fois ?')} <button type="button" class="link" data-act="demo">${tl('Essayez la démonstration guidée')}</button> · <button type="button" class="link" data-act="help">${tl('Comment ça marche ?')}</button></p></section>`;
      hydrateIcons(pane); return;
    }
    pane.innerHTML = head + `
      <section class="svState" data-sv="state"></section>
      <div class="svGuide" data-sv="guide" aria-live="polite"></div>
      <section class="svSteps" data-sv="steps" hidden></section>
      <section class="svSec"><h3>${icon('activity')}${tl('Surveillances')}<span class="grow"></span>${running ? '' : `<button type="button" class="btn small primary" data-act="wizard">${icon('plus')}<span>${tl('Ajouter')}</span></button>`}</h3>
        <section class="svWiz" data-sv="wiz" hidden></section>
        <ul class="svChans" data-sv="chans"></ul><div data-sv="edit"></div></section>
      <section class="svSec"><h3>${icon('chart')}<span data-sv="chartName"></span></h3><canvas class="svChart" width="720" height="300" aria-hidden="true"></canvas><p class="svLegend"><span class="l"></span>${tl('niveau d’anomalie')}<span class="e"></span>${tl('alerte')}<span class="c"></span>${tl('critique')}<span class="g"></span>${tl('mesure absente')}</p></section>
      <section class="svSec"><h3>${icon('bug')}${tl('Simuler une panne')}</h3>
        <p class="svSmall">${tl('Pour s’exercer : la panne ne touche que ce que voit la supervision ; le circuit continue de fonctionner normalement.')}</p>
        <div data-sv="fform"></div><ul class="svFaults" data-sv="faults"></ul></section>
      <details class="svSec svLogSec" open><summary><h3>${icon('list')}${tl('Historique')}</h3></summary><ol class="svLog" data-sv="log"></ol></details>
      <p class="svFoot">${tl('Fondée sur MA-ISA (maisa-core). Démonstration pédagogique : pas un système de sécurité certifié.')}</p>`;
    hydrateIcons(pane); paintWizard(); paintFaultForm(); paintEdit(); paintLive(); paintFaults();
  }
  function paintLive() {
    if (pane.hidden || !q('state')) return;
    const f = running ? frame : null, S = STATES[f ? f.state : 'unknown'];
    const warn = f ? f.channels.filter(c => c.warning && !c.critical).length : 0, crit = f ? f.channels.filter(c => c.critical).length : 0;
    q('state').className = `svState s-${f ? f.state : 'idle'}`;
    q('state').innerHTML = f
      ? `<span class="svBadge">${icon(S.icon)}<b>${S.name()}</b></span><span class="svSay">${S.text()}</span><span class="svMeta"><span class="svChip${f.latch ? ' on' : ''}" title="${tl('Le verrou se ferme à chaque mise en sécurité et ne s’ouvre qu’après la reprise en trois étapes.')}">${icon('lock')}${f.latch ? tl('Verrou fermé') : tl('Verrou ouvert')}</span>${warn ? `<span class="svChip warn">${tl('{0} alerte(s)', warn)}</span>` : ''}${crit ? `<span class="svChip on">${tl('{0} critique(s)', crit)}</span>` : ''}${f.clock_ok ? '' : `<span class="svChip on">${icon('clock')}${tl('Défaut d’horloge')}</span>`}${f.engine.escalated ? `<span class="svChip on">${tl('Escalade')}</span>` : ''}<span class="svChip mono" title="${tl('Temps simulé depuis le lancement')}">${fmt(f.time, 1)} s</span></span>`
      : `<span class="svBadge">${icon('eye')}<b>${app.simOn() ? tl('Démarrage…') : tl('En attente')}</b></span><span class="svSay">${tl('{0} surveillance(s) prête(s). Elles s’activent avec la simulation.', cfg.channels.length)}</span>`;
    const g = guide(), gb = q('guide');
    const gh = `${icon(g.icon)}<span>${esc(g.text)}</span>${g.btn ? `<button type="button" class="btn small${g.tone === 'go' ? ' primary' : ''}" data-act="${g.btn[0]}">${icon(g.btn[1])}<span>${esc(g.btn[2])}</span></button>` : ''}`;
    if (gb.dataset.h !== gh) { gb.dataset.h = gh; gb.className = `svGuide ${g.tone}`; gb.innerHTML = gh; }
    paintSteps(f);
    const list = f ? f.channels : cfg.channels.map(c => ({ ...c, idle: true }));
    if (selected >= list.length) selected = 0;
    const chHtml = list.map((c, i) => {
      const def = cfg.channels[i] || c, frac = c.idle || !c.valid ? 0 : Math.max(0, Math.min(1.15, c.value / c.z_crit));
      const status = c.idle ? '' : !c.valid ? ['inv', tl('mesure absente')] : c.critical ? ['crit', c.hard ? tl('limite franchie') : tl('critique')] : c.warning ? ['warn', tl('alerte')] : ['ok', c.phase === 'pending' ? tl('attend la réponse') : tl('normal')];
      return `<li class="svChan${i === selected ? ' sel' : ''}${status ? ' ' + status[0] : ''}" data-ch="${i}" tabindex="0" aria-label="${esc(def.name)}"><div class="svChHead"><b>${esc(def.name)}</b>${status ? `<span class="svTag ${status[0]}">${status[1]}</span>` : ''}<span class="grow"></span>${running ? '' : `<button type="button" class="tb" data-edit="${i}" aria-label="${tl('Modifier')}" title="${tl('Modifier')}">${icon('edit')}</button>`}</div>
        <p class="svRule">${esc(rule(def))}</p>
        ${c.idle ? '' : `<div class="svBar" title="${tl('Niveau d’anomalie : {0} % du seuil critique (z = {1})', Math.round(100 * (c.value || 0) / c.z_crit), fmt(c.value, 3))}"><i style="width:${Math.min(100, (100 * frac) / 1.15)}%"></i><u class="enter" style="left:${(100 * c.z_enter) / c.z_crit / 1.15}%"></u><u class="crit" style="left:${100 / 1.15}%"></u></div>`}</li>`;
    }).join('');
    const ul = q('chans'); if (ul.dataset.h !== chHtml) { ul.dataset.h = chHtml; ul.innerHTML = chHtml; hydrateIcons(ul); }
    q('chartName').textContent = list[selected] ? tl('Niveau d’anomalie : {0}', (cfg.channels[selected] || list[selected]).name) : '';
    drawChart(list[selected]);
    const lg = q('log'), n = String(log.length) + (log[log.length - 1] || {}).text;
    if (lg.dataset.n !== n) { lg.dataset.n = n; lg.innerHTML = log.slice(-60).reverse().map(e => `<li class="${e.cls}"><time>${fmt(e.t, 1)} s</time><span>${esc(e.text)}</span></li>`).join('') || `<li class="muted">${tl('Rien pour l’instant.')}</li>`; }
  }
  /** Reprise guidée : trois étapes, visibles dès que le verrou est fermé. */
  function paintSteps(f) {
    const box = q('steps'); if (!box) return;
    const on = !!(f && (f.latch || ['safe_requested', 'safe_confirmed', 'locked_recovery'].includes(f.state)));
    if (box.hidden === on) box.hidden = !on;
    if (!on) { box.dataset.h = ''; return; }
    const st = f.state, ev = f.evidence, esc8 = f.engine.escalated;
    const done1 = st === 'safe_confirmed' || st === 'locked_recovery', done2 = st === 'locked_recovery' && ev.r;
    const step = (n, k, ok, can, title, text, btn) => `<li class="${ok ? 'done' : can ? 'cur' : ''}"><span class="svNum">${ok ? icon('check') : n}</span><div><b>${title}</b><small>${text}</small></div>${can && !ok ? `<button type="button" class="btn small primary" data-op="${k}">${btn}</button>` : ''}</li>`;
    const h = `<h3>${icon('lock')}${tl('Reprise en trois étapes')}</h3><ol>
      ${step(1, 'confirm', done1, st === 'safe_requested', tl('Confirmer l’état sûr'), tl('La machine est arrêtée dans une position sans danger.'), tl('Confirmer'))}
      ${step(2, 'verify', done2, st === 'locked_recovery' && !ev.r, tl('Vérifier la reprise'), tl('Le défaut a disparu et la machine peut repartir.'), tl('Vérifier'))}
      ${step(3, 'reset', false, (st === 'locked_recovery' && ev.r) || esc8, tl('Réarmer'), esc8 ? tl('Trop de demandes sans réponse : réarmez d’abord pour débloquer.') : tl('Le verrou s’ouvre, retour à la normale.'), tl('Réarmer'))}</ol>`;
    if (box.dataset.h !== h) { box.dataset.h = h; box.innerHTML = h; hydrateIcons(box); }
  }
  function drawChart(ch) {
    const cv = pane.querySelector('.svChart'); if (!cv) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, L = 74, B = 34, T = 12, R = 12;
    g.clearRect(0, 0, W, H); g.fillStyle = '#0f1418'; g.fillRect(0, 0, W, H);
    g.font = '20px sans-serif'; g.fillStyle = '#8b97a1';
    const h = hist[selected] || [];
    if (!ch || ch.idle || !h.length) { g.fillText(running ? tl('Premières mesures…') : tl('La courbe s’affiche pendant la simulation.'), L, H / 2); return; }
    const zmax = Math.max(1.25 * ch.z_crit, ...h.map(p => p[1] || 0)) || 1, t1 = h[h.length - 1][0], t0 = Math.max(h[0][0], t1 - 60);
    const X = t => L + (W - L - R) * (t - t0) / Math.max(1e-9, t1 - t0), Y = z => H - B - (H - B - T) * z / zmax;
    g.strokeStyle = '#2a333b'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const z = zmax * k / 4; g.beginPath(); g.moveTo(L, Y(z)); g.lineTo(W - R, Y(z)); g.stroke(); g.fillText(`${Math.round(100 * z / ch.z_crit)} %`, 6, Y(z) + 7); }
    g.fillText(`${fmt(t0, 0)} s`, L, H - 8); g.fillText(`${fmt(t1, 0)} s`, W - R - 62, H - 8);
    const line = (z, color) => { g.strokeStyle = color; g.setLineDash([6, 5]); g.lineWidth = 2; g.beginPath(); g.moveTo(L, Y(z)); g.lineTo(W - R, Y(z)); g.stroke(); g.setLineDash([]); };
    line(ch.z_enter, '#f2c94c'); line(ch.z_crit, '#ef4444');
    // Mesure absente : la courbe s'interrompt (elle n'est pas ramenée à zéro) et la plage est grisée.
    g.strokeStyle = '#60a5fa'; g.lineWidth = 3; g.beginPath(); let pen = false;
    for (const [t, z] of h) { if (t < t0) continue; if (z == null) { pen = false; g.fillStyle = '#ffffff14'; g.fillRect(X(t) - 3, T, 6, H - B - T); continue; } if (pen) g.lineTo(X(t), Y(z)); else { g.moveTo(X(t), Y(z)); pen = true; } }
    g.stroke();
  }
  function paintFaultForm() {
    const box = q('fform'); if (!box) return;
    const used = [...new Set(cfg.channels.flatMap(c => (c.kind === 'axis' ? [c.source] : [c.signal_a, c.signal_b])).filter(Boolean))];
    const others = sigs().map(s => s.id).filter(id => !used.includes(id));
    const kind = box.dataset.kind || 'stuck_actuator', sig = box.dataset.sig || used[0] || others[0] || '';
    const opt = id => `<option value="${esc(id)}"${id === sig ? ' selected' : ''}>${esc(labelOf(id))}</option>`;
    const n = (k, label, v) => `<label class="svF">${label}<input class="inp" type="number" step="any" data-fp="${k}" value="${v}"></label>`;
    const params = { stuck: n('value', tl('Bloquée à (vide : sa valeur actuelle)'), ''), offset: n('bias', tl('Écart'), 1) + n('drift', tl('Dérive par seconde'), 0), burst: n('bias', tl('Écart'), 1) + n('t_on', tl('Pendant (s)'), 1) + n('t_off', tl('Puis rien pendant (s)'), 3) }[kind] || '';
    box.innerHTML = `<label class="svF wide">${tl('Signal touché')}<select class="sel" data-ff="signal">${used.length ? `<optgroup label="${tl('Surveillés')}">${used.map(opt).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="${tl('Autres signaux')}">${others.map(opt).join('')}</optgroup>` : ''}</select></label>
      <div class="svKinds" role="radiogroup" aria-label="${tl('Type de panne')}">${Object.entries(FAULTS).map(([k, F]) => `<label class="svKind${k === kind ? ' on' : ''}"><input type="radio" name="svfk" value="${k}"${k === kind ? ' checked' : ''}><b>${F.name()}</b><small>${F.text()}</small></label>`).join('')}</div>
      ${params ? `<div class="svParams">${params}</div>` : ''}<button type="button" class="btn small primary" data-act="fadd"${sig ? '' : ' disabled'}>${icon('bug')}<span>${tl('Simuler cette panne')}</span></button>`;
    hydrateIcons(box);
  }
  function paintFaults() {
    const ul = q('faults'); if (!ul) return;
    ul.innerHTML = faults.map(f => `<li>${icon('bug')}<b>${esc(labelOf(f.signal))}</b><span>${FAULTS[f.kind] ? FAULTS[f.kind].name() : f.kind}${f.since != null ? ' · ' + tl('depuis {0} s', fmt(f.since, 1)) : ''}</span><span class="grow"></span><button type="button" class="btn small" data-fclear="${f.id}">${tl('Retirer')}</button></li>`).join('') + (faults.length > 1 ? `<li class="all"><span class="grow"></span><button type="button" class="btn small" data-fclear="all">${tl('Tout retirer')}</button></li>` : '');
    hydrateIcons(ul);
  }

  /* ---------- Modifier une surveillance ---------- */
  function paintEdit() {
    const box = q('edit'); if (!box) return;
    const c = cfg.channels[editing]; if (!c || running) { box.innerHTML = ''; return; }
    const list = sigs(), sel = (k, filter = () => true) => `<select class="sel" data-k="${k}"><option value="">${tl('(choisir)')}</option>${[...new Set([c[k], ...list.map(s => s.id).filter(filter)].filter(Boolean))].map(id => `<option value="${esc(id)}"${id === c[k] ? ' selected' : ''}>${esc(labelOf(id))}</option>`).join('')}</select>`;
    const inp = (k, v, w = 'n') => `<input class="inp ${w}" type="number" step="any" data-k="${k}" value="${v ?? ''}">`;
    const r = c.req || {}, rq = (k, v) => `<input class="inp n" type="number" step="any" data-r="${k}" value="${v ?? ''}">`, u = unitOf(c.source || ''), est = estimates[c.id];
    const sentence = c.kind === 'axis'
      ? `<p class="svSentence">${sel('source', id => !isBinary(id))} ${tl('doit rester entre')} ${inp('lo', c.lo)} ${tl('et')} ${inp('hi', c.hi)} ${u}</p>
         <p class="svSentence">${tl('Signaler un écart de')} ${rq('det_dev', r.det_dev)} ${u} ${tl('en moins de')} ${rq('det_time', r.det_time)} s ; ${tl('ignorer un écart de')} ${rq('tol_dev', r.tol_dev)} ${u} ${tl('qui dure moins de')} ${rq('tol_time', r.tol_time)} s.</p>
         <details class="svMore"><summary>${tl('Limite immédiate (facultatif)')}</summary><p class="svSentence">${tl('Mise en sécurité sans attendre sous')} ${inp('hard_lo', c.hard_lo)} ${tl('ou au-dessus de')} ${inp('hard_hi', c.hard_hi)} ${u}</p></details>`
      : `<p class="svSentence">${tl('Quand')} ${sel('signal_b')} ${tl('devient actif,')} ${sel('signal_a', id => !isBinary(id) || true)} ${tl('doit atteindre')} ${inp('threshold', c.threshold)} ${tl('en moins de')} ${inp('delay', c.delay)} s.</p>${/\.x$/.test(c.signal_a || '') ? `<p class="svSmall">${tl('Position d’un vérin : 0 tige rentrée, 1 tige sortie.')}</p>` : ''}`;
    box.innerHTML = `<div class="svEdit"><header><b>${c.kind === 'axis' ? tl('Surveillance de plage') : tl('Surveillance de réponse')}</b><span class="grow"></span><button type="button" class="tb" data-act="close" aria-label="${tl('Fermer')}">${icon('x')}</button></header>
      <label class="svF wide">${tl('Nom')}<input class="inp" data-k="name" value="${esc(c.name)}" maxlength="40"></label>
      ${sentence}
      ${est ? `<p class="svEst ${est.ok ? 'ok' : 'bad'}">${icon(est.ok ? 'check' : 'alert')}<span>${esc(est.text)}</span></p>` : ''}
      <label class="check"><input type="checkbox" data-k="required"${c.required !== false ? ' checked' : ''}> ${tl('Mesure indispensable : si elle manque, l’état devient Inconnu')}</label>
      <details class="svMore"><summary>${tl('Avancé : réglages MA-ISA')}</summary>
        <p class="svSmall">${tl('Calculés à partir de vos exigences par les fonctions de conception de maisa-core. Les modifier ici passe la surveillance en réglage manuel.')}</p>
        <div class="svGrid">${[['alpha', tl('alpha : vitesse d’oubli (1/s)')], ['z_enter', tl('z_enter : seuil d’alerte')], ['z_exit', tl('z_exit : fin d’alerte')], ['z_crit', tl('z_crit : seuil critique')], ['t_stable', tl('t_stable : calme avant fin d’alerte (s)')], ['scale', tl('échelle de l’écart')]].map(([k, l]) => `<label class="svF">${l}<input class="inp" type="number" step="any" data-m="${k}" value="${c[k] ?? ''}"></label>`).join('')}</div>
        ${c.manual ? `<button type="button" class="btn small" data-act="auto-tune">${icon('wand')}<span>${tl('Revenir au calcul automatique')}</span></button>` : ''}</details>
      <div class="row"><button type="button" class="btn small" data-act="del">${icon('trash')}<span>${tl('Supprimer')}</span></button><span class="grow"></span><button type="button" class="btn small primary" data-act="close">${tl('Terminé')}</button></div></div>`;
    hydrateIcons(box);
  }
  const refreshEdit = async () => { await tune(editing); dirty(); await validate(); render(); };

  /* ---------- Gestes ---------- */
  pane.addEventListener('click', async e => {
    const t = e.target, act = t.closest('[data-act]'), op = t.closest('[data-op]'), ch = t.closest('[data-ch]'), add = t.closest('[data-add]'), fc = t.closest('[data-fclear]'), ed = t.closest('[data-edit]');
    if (await wizardClick(e)) return;
    if (op) { await operator(op.dataset.op); return; }
    if (ed) { editing = +ed.dataset.edit; await tune(editing); paintEdit(); return; }
    if (add) {
      if (cfg.channels.length >= MAX) { toast(tl('{0} surveillances au plus.', MAX), 'warn'); return; }
      const list = sigs(), analog = list.find(s => !isBinary(s.id) && s.value != null), cmd = list.find(s => /\.on$/.test(s.id)), pos = list.find(s => /\.x$/.test(s.id));
      cfg.channels.push(add.dataset.add === 'axis' ? newAxis(analog ? analog.id : '') : newRel(pos ? pos.id : '', cmd ? cmd.id : ''));
      editing = cfg.channels.length - 1; await refreshEdit(); return;
    }
    if (fc) { await clearFaults(fc.dataset.fclear === 'all' ? null : +fc.dataset.fclear); return; }
    if (ch && !act) { selected = +ch.dataset.ch; paintLive(); return; }
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'help') help();
    if (a === 'demo') startDemo();
    if (a === 'demo-quit') quitDemo();
    if (a === 'auto') autoWatch();
    if (a === 'wizard') openWizard();
    if (a === 'sim') app.setSim(true);
    if (a === 'tap') tap('BTN1');
    if (a === 'corrective') operator('corrective', true);
    if (a === 'corrective-off') operator('corrective', false);
    if (a === 'clearfaults') clearFaults(null);
    if (a === 'demofault') addFault({ kind: 'stuck_actuator', signal: '1A.x' });
    if (a === 'close') { editing = -1; render(); }
    if (a === 'del') { cfg.channels.splice(editing, 1); editing = -1; dirty(); await validate(); render(); }
    if (a === 'auto-tune') { delete cfg.channels[editing].manual; await refreshEdit(); }
    if (a === 'fadd') {
      const box = q('fform'), kind = box.dataset.kind || 'stuck_actuator', signal = box.querySelector('[data-ff="signal"]').value, v = k => { const el = box.querySelector(`[data-fp="${k}"]`); return el ? num(el.value) ?? undefined : undefined; };
      addFault({ kind, signal, value: v('value'), bias: v('bias'), drift: v('drift'), t_on: v('t_on'), t_off: v('t_off') });
    }
  });
  // Valeur tapée dans l'assistant : gardée tout de suite ; « Suivant » s'active dès que tout est rempli.
  pane.addEventListener('input', e => {
    const t = e.target; if (!(t.dataset.w && wiz)) return;
    wiz.vals[t.dataset.w] = t.value;
    const b = pane.querySelector('[data-wact="next"]'); if (b) b.disabled = !draftOf();
  });
  pane.addEventListener('keydown', e => { const ch = e.target.closest('[data-ch]'); if (ch && (e.key === 'Enter' || e.key === ' ') && e.target === ch) { e.preventDefault(); selected = +ch.dataset.ch; paintLive(); } });
  pane.addEventListener('change', async e => {
    const t = e.target, box = q('fform');
    if (t.dataset.w && wiz) { wiz.vals[t.dataset.w] = t.value; if (t.tagName === 'SELECT') paintWizard(); return; }
    if (t.name === 'svfk') { box.dataset.kind = t.value; paintFaultForm(); return; }
    if (t.dataset.ff === 'signal') { box.dataset.sig = t.value; return; }
    const c = cfg.channels[editing]; if (!c) return;
    if (t.dataset.k) {
      const k = t.dataset.k;
      if (k === 'required') c.required = t.checked;
      else if (k === 'name') c.name = t.value.trim() || c.name;
      else if (['source', 'signal_a', 'signal_b'].includes(k)) { c[k] = t.value; if (k === 'source' && !c.manual) { const n = newAxis(t.value); Object.assign(c, { lo: n.lo, hi: n.hi, name: n.name }); c.req = defaultReq(c); } }
      else if (num(t.value) == null) delete c[k]; else c[k] = num(t.value);
      if ((k === 'lo' || k === 'hi') && c.req && !c.manual) c.req = { ...defaultReq(c), det_time: c.req.det_time, tol_time: c.req.tol_time };
    }
    if (t.dataset.r) { c.req = c.req || defaultReq(c); if (num(t.value) != null) c.req[t.dataset.r] = num(t.value); }
    if (t.dataset.m) { c.manual = true; if (num(t.value) == null) delete c[t.dataset.m]; else c[t.dataset.m] = num(t.value); }
    await refreshEdit();
  });

  app.register('supervision', {
    save: () => (neverSaved ? null : { config: cfg, latch }),
    load(d) {
      neverSaved = d == null;
      const c = d && d.config && typeof d.config === 'object' ? d.config : {};
      cfg = { version: 1, enabled: c.enabled !== false, dt_max: +c.dt_max > 0 ? +c.dt_max : 1, dt_min: +c.dt_min > 0 ? +c.dt_min : 0.016, engine: { n_max: 3, t_cooldown: 2, t_timeout: 10, ...(c.engine || {}) }, channels: Array.isArray(c.channels) ? c.channels.slice(0, MAX) : [] };
      latch = d ? (d.latch === undefined ? null : d.latch) : null; // illisible ou absent d'un projet enregistré : le Rust ferme le verrou
      frame = null; hist = []; log = []; editing = -1; cfgError = ''; estimates = {}; demo = null; faults = []; wiz = null;
      signals = []; // signaux du projet précédent : jamais proposés pour celui-ci
      if (!demoLoading) demoStash = null; // un autre projet ouvert pendant la démonstration la termine
      // Autre projet : les pannes simulées du précédent disparaissent, et la supervision repart si la simulation tourne.
      if (available()) queue = queue.then(() => call('fault_clear_all')).catch(() => {});
      restart(app.simOn());
    }
  });
  return { config: () => cfg, frame: () => frame, running: () => running, signals: () => collectSignals(app), suggest, autoWatch, startDemo, demo: () => demo, setConfig(c) { cfg = c; dirty(); return validate(); }, log: () => log, render };
}
