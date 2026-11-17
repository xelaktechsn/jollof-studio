// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jumeau numérique : la machine 3D que l'utilisateur construit lui-même, à partir de composants (bâti, convoyeur,
// poussoir, chariot, bras, ventouse, outil, capteurs, source et bac de pièces, bec, bouton, voyant, modèle glTF) qu'il
// pose dans l'espace et relie aux éléments réels du projet : un mobile suit un vérin du circuit (par son repère), un
// convoyeur, un voyant, une ventouse ou un bec obéissent à une sortie (bobine du GRAFCET ou de l'automate, électrovanne
// du montage), un capteur produit un signal nommé que le GRAFCET, l'automate et le montage lisent comme une fin de
// course, un bouton appuie sur une entrée du même nom. Conventions des outils de mise en service virtuelle : unités SI
// (mètres, secondes, degrés pour les angles), repère direct Y vers le haut, sol en y = 0, noms de signaux conformes aux
// identificateurs IEC 61131-3 ; la scène se garde avec le circuit (circuit.scene, kind « twin »), s'exporte en
// glTF 2.0 (ISO/IEC 12113) et en AutomationML (IEC 62714, voir aml.js). Ce module décrit le catalogue, nettoie et
// vérifie une scène ; sans interface ni Three.js (le moteur est dans engine.js, le rendu dans render.js).
import { tl } from '../i18n/index.js';

/** Identificateur de signal (IEC 61131-3, raccourci) : lettre ou _ puis lettres, chiffres, _ ; 16 caractères au plus. */
export const SIGNAL_RE = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;
/** Repère d'un élément du circuit (vérin) : comme clean.js. */
const TAG_RE = /^[A-Za-z0-9_-]{1,12}$/;
const ID_RE = /^[\w-]{1,40}$/;
/** Directions d'un mobile dans son repère local. */
export const DIRS = ['x', '-x', 'y', '-y', 'z', '-z'];
export const DIR_VEC = { x: [1, 0, 0], '-x': [-1, 0, 0], y: [0, 1, 0], '-y': [0, -1, 0], z: [0, 0, 1], '-z': [0, 0, -1] };
/** Pièces produites par une source : dimensions (m) et couleur par défaut. */
export const ITEMS = {
  box: { size: [0.2, 0.15, 0.2], color: '#c98a4b', name: () => tl('Colis') },
  bottle: { size: [0.08, 0.26, 0.08], color: '#7fb2e0', name: () => tl('Bouteille') },
  puck: { size: [0.1, 0.06, 0.1], color: '#9aa6af', name: () => tl('Palet') },
  pallet: { size: [0.4, 0.12, 0.4], color: '#8a6f4d', name: () => tl('Palette') },
  car: { size: [1.0, 0.6, 0.6], color: '#2a7ab0', name: () => tl('Voiture') }
};
export const LIMITS = { parts: 200, items: 60, coord: 50, size: [0.01, 20], stroke: [0.01, 10], speed: [0, 5], asset: 1_500_000, assets: 4_000_000 };

/**
 * Catalogue. cat : famille ; name() ; icon ; size : dimensions par défaut (w, h, d) si sizable ; props : réglages et
 * valeurs par défaut (nombre, chaîne, liste par enum) ; bind : liaisons (cyl : vérin du circuit, out : sortie,
 * signal : capteur produit, input : entrée appuyée) ; mover : 'linear' (course × position du vérin le long de dir)
 * ou 'rotary' (angle range × position autour de axis) ; solid : les pièces ne le traversent pas ; surface : les pièces
 * se posent dessus ; help() : une phrase pour l'inspecteur.
 */
export const CATALOG = {
  frame: { cat: 'structure', name: () => tl('Bâti (table)'), icon: 'frame', size: [1.6, 0.8, 0.8], sizable: true, solid: true, surface: true, props: {}, bind: [], help: () => tl('Un plateau sur ses pieds : les autres composants se posent dessus (son dessus est à la hauteur y + h).') },
  block: { cat: 'structure', name: () => tl('Bloc (butée, guide)'), icon: 'cube', size: [0.3, 0.3, 0.3], sizable: true, solid: true, surface: true, props: { color: '#59636c' }, bind: [], help: () => tl('Un volume plein : mur, guide ou butée fixe. Les pièces ne le traversent pas et peuvent se poser dessus.') },
  conveyor: { cat: 'transport', name: () => tl('Convoyeur à bande'), icon: 'flow', size: [2, 0.1, 0.4], sizable: true, solid: true, surface: true, props: { speed: 0.25 }, bind: ['out'], help: () => tl('Emporte les pièces posées dessus vers son +X local à la vitesse réglée, quand la sortie liée est vraie (toujours, sans sortie).') },
  pusher: { cat: 'actuator', name: () => tl('Poussoir (vérin)'), icon: 'send', props: { stroke: 0.3, dir: 'z', width: 0.25, height: 0.1 }, bind: ['cyl'], mover: 'linear', solid: true, help: () => tl('Une plaque poussée par le vérin lié : elle avance de la course réglée et pousse ou arrête les pièces.') },
  stopper: { cat: 'actuator', name: () => tl('Butée escamotable (vérin)'), icon: 'minus', props: { stroke: 0.08, face: 'x', width: 0.3 }, bind: ['cyl'], mover: 'linear', solid: true, help: () => tl('Une lame qui monte de la course réglée quand le vérin lié sort : posée au niveau du tapis, elle arrête les pièces qui arrivent dans l’axe choisi, et les laisse passer rentrée.') },
  carriage: { cat: 'actuator', name: () => tl('Chariot (vérin)'), icon: 'layers', size: [0.4, 0.06, 0.4], sizable: true, props: { stroke: 0.6, dir: 'x' }, bind: ['cyl'], mover: 'linear', solid: true, surface: true, help: () => tl('Un plateau guidé par le vérin lié : il emporte les pièces posées dessus et les composants qui lui sont attachés (parent).') },
  rotary: { cat: 'actuator', name: () => tl('Bras tournant (vérin)'), icon: 'rotate', props: { range: 90, axis: 'z', length: 1.2 }, bind: ['cyl'], mover: 'rotary', solid: true, help: () => tl('Un bras qui pivote de l’angle réglé quand le vérin lié sort : lisse de barrière, aiguillage, basculeur.') },
  gripper: { cat: 'actuator', name: () => tl('Ventouse'), icon: 'target', props: { reach: 0.08, mode: 'out' }, bind: ['out', 'cyl'], help: () => tl('Saisit la pièce juste sous elle quand elle est commandée (sortie vraie, ou vérin lié en bout de course) et la lâche sinon ; attachez-la à un chariot.') },
  tool: { cat: 'actuator', name: () => tl('Outil (poinçon, foret)'), icon: 'wrench', props: { stroke: 0.15, dir: '-y' }, bind: ['cyl'], mover: 'linear', help: () => tl('Descend avec le vérin lié ; en bout de course, la pièce atteinte est marquée « usinée » (comptée).') },
  photocell: { cat: 'sensor', name: () => tl('Cellule photoélectrique'), icon: 'eye', props: { range: 0.5, dir: 'z', nc: false }, bind: ['signal'], help: () => tl('Un faisceau de la longueur réglée, dans la direction choisie : le signal est vrai quand une pièce le coupe.') },
  proximity: { cat: 'sensor', name: () => tl('Détecteur de proximité'), icon: 'radio', props: { zone: 0.12, detect: 'any', nc: false }, bind: ['signal'], help: () => tl('Vrai quand une pièce est dans sa zone (toutes, ou seulement les pièces pleines ou usinées : capteur de niveau, contrôle).') },
  source: { cat: 'flow', name: () => tl('Source de pièces'), icon: 'plus', props: { item: 'box', every: 6, max: 10, color: '' }, bind: ['out'], help: () => tl('Dépose une pièce neuve à sa place : à intervalle régulier, au bouton de la vue, ou au front montant de la sortie liée.') },
  sink: { cat: 'flow', name: () => tl('Bac (sortie des pièces)'), icon: 'inbox', size: [0.4, 0.3, 0.4], sizable: true, props: { accept: 'any' }, bind: [], help: () => tl('Retire et compte les pièces qui y arrivent ; avec un critère (pleine, usinée, vide), celles qui ne le remplissent pas sont comptées à part.') },
  dispenser: { cat: 'flow', name: () => tl('Bec de remplissage'), icon: 'bottle', props: { fillTime: 3 }, bind: ['out'], help: () => tl('Remplit la pièce juste sous lui tant que la sortie liée est vraie ; sans pièce, il coule à vide (alarme).') },
  button: { cat: 'hmi', name: () => tl('Bouton du pupitre'), icon: 'pointer', props: { mode: 'hold', color: '#15803d' }, bind: ['input'], help: () => tl('Un bouton cliquable dans la scène : il appuie sur l’entrée du même nom (pupitre du GRAFCET ou de l’automate, bouton du montage).') },
  lamp: { cat: 'hmi', name: () => tl('Voyant'), icon: 'bulb', props: { color: '#4ade80' }, bind: ['out'], help: () => tl('S’allume quand la sortie liée est vraie.') },
  label: { cat: 'decor', name: () => tl('Étiquette'), icon: 'tag', props: { text: 'Poste 1' }, bind: [], help: () => tl('Un texte posé dans la scène.') },
  model: { cat: 'decor', name: () => tl('Modèle 3D (glTF)'), icon: 'shapes', props: { asset: '', scale: 1 }, bind: [], help: () => tl('Un modèle glTF 2.0 (.glb, .gltf) importé, à l’échelle réglée (1 = mètres). Décor : les pièces le traversent.') }
};
export const CATS = { structure: () => tl('Structure'), transport: () => tl('Transport'), actuator: () => tl('Actionneurs'), sensor: () => tl('Capteurs'), flow: () => tl('Pièces'), hmi: () => tl('Pupitre'), decor: () => tl('Décor') };
/** Valeurs admises des réglages à choix. */
export const ENUMS = { dir: DIRS, axis: ['x', 'y', 'z'], face: ['x', 'z'], mode: ['out', 'cyl'], detect: ['any', 'full', 'done'], item: Object.keys(ITEMS), accept: ['any', 'full', 'done', 'empty'] };
const BTN_MODES = ['hold', 'toggle'];
export const isMover = p => !!(CATALOG[p.type] && CATALOG[p.type].mover);
export const isSensor = p => p.type === 'photocell' || p.type === 'proximity';

const num = (v, lo, hi, def) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 1e4) / 1e4)) : def; };
const str = (v, n = 40) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, n) : '');
const color = (v, def) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def);
const sizeOf = (v, def) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => num(x, LIMITS.size[0], LIMITS.size[1], def[i])) : def.slice());

/**
 * Scène reçue (projet, exemple, assistant) : parts connus, nombres bornés, identifiants uniques, parents existants sans
 * cycle, liaisons nettoyées, modèles glTF bornés. Rend { kind: 'twin', name, parts, assets } (jamais null).
 */
export function cleanTwin(s) {
  const src = s && typeof s === 'object' ? s : {};
  const seen = new Set(), parts = [];
  for (const p of (Array.isArray(src.parts) ? src.parts : []).slice(0, LIMITS.parts)) {
    if (!p || !CATALOG[p.type]) continue;
    const D = CATALOG[p.type];
    let id = typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : ''; if (!id || seen.has(id)) { let k = 1; while (!id || seen.has(id)) id = `${p.type}${k++}`; }
    seen.add(id);
    const q = { id, type: p.type, name: str(p.name, 40), pos: Array.isArray(p.pos) && p.pos.length === 3 ? p.pos.map(x => num(x, -LIMITS.coord, LIMITS.coord, 0)) : [0, 0, 0], rot: num(p.rot, -360, 360, 0), props: {}, bind: {} };
    if (D.sizable) q.size = sizeOf(p.size, D.size);
    const src2 = p.props && typeof p.props === 'object' ? p.props : p; // réglages à plat acceptés (écriture à la main)
    for (const [k, def] of Object.entries(D.props)) {
      const v = src2[k];
      if (k === 'mode' && p.type === 'button') q.props[k] = BTN_MODES.includes(v) ? v : def; // avant ENUMS.mode (ventouse)
      else if (ENUMS[k]) q.props[k] = ENUMS[k].includes(v) ? v : def;
      else if (k === 'color') q.props[k] = color(v, def);
      else if (k === 'nc') q.props[k] = v === true || v === 'true';
      else if (k === 'asset') q.props[k] = typeof v === 'string' && ID_RE.test(v) ? v : '';
      else if (k === 'text') q.props[k] = str(v, 40) || def;
      else if (typeof def === 'number') q.props[k] = num(v, k === 'stroke' ? LIMITS.stroke[0] : k === 'speed' ? 0 : k === 'range' ? -360 : k === 'every' || k === 'max' ? 0 : 0.001, k === 'stroke' ? LIMITS.stroke[1] : k === 'speed' ? LIMITS.speed[1] : k === 'range' ? 360 : k === 'max' ? LIMITS.items : k === 'every' ? 3600 : k === 'length' || k === 'reach' || k === 'zone' ? 5 : 100, def);
    }
    if (p.type === 'button') q.props.mode = BTN_MODES.includes(q.props.mode) ? q.props.mode : 'hold';
    const b = p.bind && typeof p.bind === 'object' ? p.bind : p;
    for (const k of D.bind) { const v = typeof b[k] === 'string' ? b[k].trim() : ''; if (v && (k === 'cyl' ? TAG_RE : SIGNAL_RE).test(v)) q.bind[k] = v; }
    if (typeof p.parent === 'string' && ID_RE.test(p.parent) && p.parent !== id) q.parent = p.parent;
    parts.push(q);
  }
  // Parents : existants, et sans cycle (le lien qui boucle est coupé).
  const byId = new Map(parts.map(p => [p.id, p]));
  for (const p of parts) {
    if (p.parent && !byId.has(p.parent)) delete p.parent;
    const trail = new Set([p.id]); let q = p;
    while (q && q.parent) { if (trail.has(q.parent)) { delete q.parent; break; } trail.add(q.parent); q = byId.get(q.parent); }
  }
  const assets = {}; let total = 0;
  if (src.assets && typeof src.assets === 'object') for (const [k, v] of Object.entries(src.assets)) {
    if (!ID_RE.test(k) || typeof v !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(v) || v.length > LIMITS.asset * 4 / 3 + 4) continue;
    if (!parts.some(p => p.type === 'model' && p.props.asset === k)) continue; // modèle qui n'est plus posé
    if (total + v.length > LIMITS.assets * 4 / 3) break;
    assets[k] = v; total += v.length;
  }
  for (const p of parts) if (p.type === 'model' && p.props.asset && !assets[p.props.asset]) p.props.asset = '';
  return { kind: 'twin', ...(str(src.name, 40) ? { name: str(src.name, 40) } : {}), parts, ...(Object.keys(assets).length ? { assets } : {}) };
}
/** Est-ce une scène construite (jumeau) ? */
export const isTwin = s => !!s && s.kind === 'twin';

/** Nom d'une pièce pour l'interface : son nom, sinon « type id ». */
export const partLabel = p => p.name || `${CATALOG[p.type] ? CATALOG[p.type].name() : p.type} ${p.id}`;
/** Nom du signal d'un capteur : sa liaison, sinon son identifiant (toujours lisible). */
export const signalOf = p => p.bind.signal || p.id;

/**
 * Ce que la scène échange avec le circuit : sensors [{ part, name }] (signaux produits), outputs [noms lus],
 * inputs [entrées appuyées par les boutons], cyls [{ part, ref }] (vérins suivis), acts [identifiants des sources].
 */
export function twinSignals(scene) {
  const parts = (scene && scene.parts) || [], uniq = a => [...new Set(a)];
  return {
    sensors: parts.filter(isSensor).map(p => ({ part: p.id, name: signalOf(p) })),
    outputs: uniq(parts.filter(p => p.bind.out && !(p.type === 'gripper' && p.props.mode === 'cyl')).map(p => p.bind.out)),
    inputs: uniq(parts.filter(p => p.type === 'button' && p.bind.input).map(p => p.bind.input)),
    cyls: parts.filter(p => isMover(p) || (p.type === 'gripper' && p.props.mode === 'cyl')).map(p => ({ part: p.id, ref: p.bind.cyl || '' })),
    acts: parts.filter(p => p.type === 'source').map(p => p.id)
  };
}

/**
 * Problèmes d'une scène, pour l'inspecteur et le vérificateur. ctx : { cyls: [repères de vérins du circuit],
 * sensors: [capteurs du circuit : fins de course, pressostats], inputs: [entrées connues], outputs: [sorties connues] }.
 * Rend [{ level: 'error' | 'warning' | 'info', part, text }].
 */
export function validateTwin(scene, ctx = {}) {
  const out = [], parts = (scene && scene.parts) || [], low = a => new Set((a || []).map(x => String(x).toLowerCase()));
  const cyls = new Set(ctx.cyls || []), circSens = low(ctx.sensors), inputs = low(ctx.inputs), outputs = ctx.outputs ? low(ctx.outputs) : null;
  const say = (level, p, text) => out.push({ level, part: p ? p.id : null, text: p ? `${partLabel(p)} : ${text}` : text });
  const names = new Map();
  for (const p of parts) {
    const D = CATALOG[p.type];
    if (D.mover || (p.type === 'gripper' && p.props.mode === 'cyl')) {
      if (!p.bind.cyl) say('error', p, tl('aucun vérin lié : choisissez le vérin du circuit qui le déplace.'));
      else if (cyls.size && !cyls.has(p.bind.cyl)) say('error', p, tl('le vérin {0} n’est pas dans le circuit.', p.bind.cyl));
    }
    if (isSensor(p)) {
      const n = signalOf(p);
      if (!p.bind.signal) say('warning', p, tl('sans nom de signal : il s’appelle {0}.', n));
      if (circSens.has(n.toLowerCase())) say('error', p, tl('le signal {0} est déjà un capteur du circuit.', n));
      names.set(n.toLowerCase(), (names.get(n.toLowerCase()) || 0) + 1);
    }
    if (p.type === 'conveyor' && !p.bind.out) say('info', p, tl('sans sortie liée : il tourne en permanence pendant la simulation.'));
    if ((p.type === 'lamp' || p.type === 'dispenser' || (p.type === 'gripper' && p.props.mode === 'out')) && !p.bind.out) say('warning', p, tl('aucune sortie liée : il ne fera jamais rien.'));
    if (p.bind.out && outputs && !outputs.has(p.bind.out.toLowerCase())) say('info', p, tl('la sortie {0} n’est écrite ni par le GRAFCET, ni par l’automate, ni par le montage.', p.bind.out));
    if (p.type === 'button') {
      if (!p.bind.input) say('warning', p, tl('aucune entrée liée : le bouton n’appuie sur rien.'));
      else if (inputs.size && !inputs.has(p.bind.input.toLowerCase())) say('warning', p, tl('aucune entrée {0} : ajoutez-la au pupitre du GRAFCET ou de l’automate, ou nommez ainsi un bouton du montage.', p.bind.input));
    }
    if (p.type === 'model' && !p.props.asset) say('warning', p, tl('aucun modèle importé.'));
    if (p.type === 'source' && !p.props.every && !p.bind.out) say('info', p, tl('ni période ni sortie : les pièces n’arrivent qu’au bouton « {0} ».', partLabel(p)));
    if (p.type === 'gripper' && !p.parent) say('info', p, tl('fixe : attachez-la à un chariot (parent) pour déplacer les pièces.'));
  }
  for (const [n, k] of names) if (k > 1) say('error', null, tl('Le signal {0} est produit par {1} capteurs.', n, k));
  if (!parts.length) say('info', null, tl('Scène vide : ajoutez des composants depuis la palette.'));
  return out;
}

/** Pièce neuve d'un type, posée en pos. */
export function newPart(type, pos = [0, 0, 0], extra = {}) {
  const D = CATALOG[type]; if (!D) throw new Error(`unknown part type "${type}"`);
  return cleanTwin({ parts: [{ id: extra.id || type, type, pos, rot: 0, ...(D.sizable ? { size: D.size } : {}), props: { ...D.props, ...(extra.props || {}) }, bind: extra.bind || {}, ...(extra.parent ? { parent: extra.parent } : {}), ...(extra.name ? { name: extra.name } : {}) }] }).parts[0];
}
/** Identifiant libre pour un type (type1, type2…). */
export function freeId(scene, type) { const used = new Set((scene.parts || []).map(p => p.id)); let k = 1; while (used.has(`${type}${k}`)) k++; return `${type}${k}`; }

/* ---------- Modèles de départ ---------- */
const P = (id, type, pos, more = {}) => ({ id, type, pos, ...more });
/** Scènes de départ : name(), text(), scene() (nettoyée). */
export const TEMPLATES = {
  empty: { name: () => tl('Scène vide'), text: () => tl('Un bâti seul : posez vos composants dessus.'), scene: () => cleanTwin({ name: 'Machine', parts: [P('frame1', 'frame', [0, 0, 0], { size: [2.4, 0.8, 1.0] })] }) },
  sorter: {
    name: () => tl('Convoyeur et éjecteur'),
    text: () => tl('Un convoyeur (sortie KM1) amène des colis ; la cellule pe les voit ; le poussoir (vérin A) les éjecte dans le bac de côté ; les autres finissent dans le bac du bout.'),
    scene: () => cleanTwin({ name: 'Tri', parts: [
      P('frame1', 'frame', [0, 0, 0], { size: [2.2, 0.8, 0.8] }),
      P('conv1', 'conveyor', [0, 0.8, 0], { size: [2.2, 0.1, 0.4], props: { speed: 0.25 }, bind: { out: 'KM1' } }),
      P('src1', 'source', [-1.0, 0.9, 0], { name: 'Arrivée', props: { item: 'box', every: 6, max: 8 } }),
      P('pe', 'photocell', [0.2, 0.97, -0.3], { props: { range: 0.6, dir: 'z' }, bind: { signal: 'pe' } }),
      P('push1', 'pusher', [0.1, 0.9, -0.25], { props: { stroke: 0.6, dir: 'z', width: 0.26, height: 0.12 }, bind: { cyl: 'A' } }),
      P('bac1', 'sink', [0.1, 0.4, 0.5], { name: 'Éjectés', size: [0.5, 0.4, 0.4], props: { accept: 'any' } }),
      P('bac2', 'sink', [1.3, 0.4, 0], { name: 'Fin de ligne', size: [0.4, 0.4, 0.5], props: { accept: 'any' } }),
      P('btn1', 'button', [-1.0, 0.8, 0.3], { name: 'Départ', props: { mode: 'toggle', color: '#15803d' }, bind: { input: 'dcy' } }),
      P('btn2', 'button', [-0.8, 0.8, 0.3], { name: 'Éjecter', props: { mode: 'toggle', color: '#2563eb' }, bind: { input: 'sel' } }),
      P('h1', 'lamp', [-0.6, 0.8, 0.3], { name: 'Marche', props: { color: '#4ade80' }, bind: { out: 'KM1' } }),
      P('lbl1', 'label', [0, 1.5, 0], { props: { text: 'Tri des colis' } })
    ] })
  },
  pickplace: {
    name: () => tl('Prise et dépose'),
    text: () => tl('Un chariot (vérin B) porte une ventouse (sortie VAC) ; les palets arrivent au poste de prise (capteur pp) et repartent dans le bac de dépose.'),
    scene: () => cleanTwin({ name: 'Prise et dépose', parts: [
      P('frame1', 'frame', [0, 0, 0], { size: [2.4, 0.8, 1.0] }),
      P('conv1', 'conveyor', [-0.6, 0.8, 0], { size: [1.2, 0.1, 0.3], props: { speed: 0.2 }, bind: { out: 'KM1' } }),
      P('src1', 'source', [-1.1, 0.9, 0], { name: 'Arrivée', props: { item: 'puck', every: 8, max: 6 } }),
      P('stop1', 'stopper', [-0.13, 0.9, 0], { name: 'Butée', props: { stroke: 0.08, face: 'x', width: 0.3 }, bind: { cyl: 'A' } }),
      P('pp', 'proximity', [-0.2, 0.92, 0], { props: { zone: 0.12, detect: 'any' }, bind: { signal: 'pp' } }),
      P('car1', 'carriage', [-0.2, 1.45, 0], { name: 'Chariot', size: [0.3, 0.05, 0.3], props: { stroke: 0.9, dir: 'x' }, bind: { cyl: 'B' } }),
      P('vac1', 'gripper', [0, -0.42, 0], { name: 'Ventouse', props: { reach: 0.12, mode: 'out' }, bind: { out: 'VAC' }, parent: 'car1' }),
      P('bac1', 'sink', [0.7, 0.8, 0], { name: 'Dépose', size: [0.4, 0.25, 0.4], props: { accept: 'any' } }),
      P('btn1', 'button', [-1.1, 0.8, 0.4], { name: 'Départ', props: { mode: 'hold', color: '#15803d' }, bind: { input: 'dcy' } })
    ] })
  }
};
