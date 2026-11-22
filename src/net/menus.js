// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Menus de l'application pour un projet réseau (types Réseau et Objets connectés) : des données, sans interface. Chaque
// entrée dit ce qu'elle fait (act : action de src/net/ui/shellnet.js ; cmd : commande de la palette d'un autre module,
// reprise telle quelle), son raccourci, quand elle se montre (when) et son état (coché, grisé), d'après un « env » :
// { kind, view, cap: { cad, dxf, pdf, … }, has(cmdId), floors, racks, layers, sim, sel, exam, canUndo, canRedo }.
// menusFor(env) rend les menus à afficher (rien pour un projet sans plan réseau) ; shortcutRows(env) les raccourcis
// globaux (aide « ? ») ; matchKey(e, keys) reconnaît un raccourci ; keyLabel(keys) l'écrit à la façon du système.
import { tl, isEn } from '../i18n/index.js';
import { spacesOf, netOnly } from '../ui/kind.js';

/** Le projet montre le plan réseau (Réseau seul, ou Objets connectés). */
export const hasNet = kind => spacesOf(kind).includes('net');
/** Projet réseau seul : rien de l'électronique ne se montre (kind.js). */
export { netOnly };

const SEP = { sep: true };
const VIEWS = [['logic', 'network', () => tl('Vue logique')], ['plan', 'floorPlan', () => tl('Plans')], ['racks', 'rack', () => tl('Baies')], ['design', 'clipboard', () => tl('Conception')]];
const CSV = [['labels', 'tag', () => tl('Étiquettes')], ['cables', 'cable', () => tl('Câbles')], ['patch', 'patchPanel', () => tl('Brassage')], ['bom', 'list', () => tl('Nomenclature')], ['rooms', 'floorPlan', () => tl('Pièces et prises')]];
const DESIGN_TABS = [['dim', 'gauge', () => tl('Dimensionnement')], ['labels', 'tag', () => tl('Étiquetage')], ['cables', 'cable', () => tl('Tableau des câbles')], ['patch', 'patchPanel', () => tl('Tableau de brassage')], ['bom', 'list', () => tl('Nomenclature et chiffrage')]];
const cap = (env, k) => !!(env.cap && env.cap[k]);
const has = (env, id) => !!(env.has && env.has(id));
const inView = (env, v) => env.view === v;
/** Vues qui ont un presse-papiers (Copier, Coller, Dupliquer) ; Couper et Tout sélectionner : plan et schéma logique. */
const CLIP = new Set(['logic', 'plan', 'racks']), CLIP_CUT = new Set(['logic', 'plan']);

/**
 * Menus d'un projet réseau. Entrée : { id, label(), icon, keys, act | cmd, when(env), enabled(env), check(env),
 * radio, desk (application de bureau seulement : signalé dans la version web, reste ouvrable pour l'expliquer),
 * sub(env) → entrées, global (raccourci traité par le module : il n'existe pas ailleurs), scope (vue où une touche
 * seule agit : 'plan', 'logic'), palette (false : pas d'entrée de palette, la commande y est déjà) }.
 */
export const MENUS = [
  { id: 'file', label: () => tl('Fichier'), items: [
    { id: 'file.new', label: () => tl('Nouveau projet…'), icon: 'filePlus', keys: 'Mod+N', act: 'click:#newBtn', palette: false },
    { id: 'file.template', label: () => tl('Nouveau projet réseau depuis un modèle…'), icon: 'layers', act: 'templates' },
    { id: 'file.open', label: () => tl('Ouvrir…'), icon: 'folder', keys: 'Mod+O', act: 'click:#openBtn', palette: false },
    SEP,
    { id: 'file.save', label: () => tl('Enregistrer'), icon: 'save', keys: 'Mod+S', act: 'click:#saveMenuBtn', palette: false },
    { id: 'file.saveAs', label: () => tl('Enregistrer sous…'), icon: 'save', keys: 'Mod+Shift+S', act: 'click:#saveAsBtn', palette: false },
    SEP,
    // Importer : plans (DXF/DWG, image, IFC), schéma Visio, classeur Excel modifié, tarif fournisseur.
    { id: 'file.import', label: () => tl('Importer'), icon: 'upload', sub: () => [
      { id: 'file.importCad', label: () => tl('Importer un plan DXF ou DWG…'), icon: 'upload', keys: 'Mod+I', act: 'importCad', global: true, when: env => cap(env, 'cad') },
      { id: 'file.importImage', label: () => tl('Importer un plan (image)…'), icon: 'image', act: 'importImage' },
      { id: 'file.importIfc', label: () => tl('Importer un modèle IFC…'), icon: 'upload', act: 'importIfc', when: env => cap(env, 'ifc') },
      { id: 'file.importVsdx', label: () => tl('Importer un schéma Visio (.vsdx)…'), icon: 'upload', act: 'importVsdx', when: env => cap(env, 'visio') },
      { id: 'file.importXlsx', label: () => tl('Importer un classeur Excel modifié…'), icon: 'upload', act: 'importXlsx', when: env => cap(env, 'xlsx') },
      { id: 'file.importPrices', label: () => tl('Importer un tarif (Excel)…'), icon: 'upload', act: 'importPrices', when: env => cap(env, 'xlsx') },
    ] },
    // Exporter : les mêmes commandes que le menu Documents, mêmes libellés (un seul nom par commande).
    { id: 'file.export', label: () => tl('Exporter'), icon: 'download', sub: () => [
      { id: 'file.exportDxf', label: () => tl('Plan en DXF…'), icon: 'download', keys: 'Mod+Shift+E', act: 'exportDxf', global: true, when: env => cap(env, 'dxf') },
      // DWG : le DXF converti par le convertisseur installé (ui/dwgexport.js : exportDwg), détecté par shellnet.js.
      { id: 'file.exportDwg', desk: true, label: () => tl('Plan en DWG…'), icon: 'download', act: 'exportDwg', when: env => cap(env, 'dwg') },
      { id: 'file.exportPdf', label: () => tl('Planches avec cartouche (PDF)…'), icon: 'printer', act: 'exportPdf', when: env => cap(env, 'pdf') },
      { id: 'file.exportIfc', label: () => tl('Modèle BIM (IFC)…'), icon: 'download', act: 'exportIfc', when: env => cap(env, 'ifc') },
      // Schémas Visio et draw.io (ui/visioexport.js : exportVsdx, exportDrawio), détectés par shellnet.js.
      { id: 'file.exportVsdx', label: () => tl('Schémas Visio (.vsdx)…'), icon: 'download', act: 'exportVsdx', when: env => cap(env, 'visio') },
      { id: 'file.exportDrawio', label: () => tl('Schémas draw.io (.drawio)…'), icon: 'download', act: 'exportDrawio', when: env => cap(env, 'visio') },
      { id: 'file.exportXlsx', label: () => tl('Classeur Excel (.xlsx)…'), icon: 'list', act: 'exportXlsx', when: env => cap(env, 'xlsx') },
      { id: 'file.exportReport', label: () => tl('Enregistrer le rapport (HTML)…'), icon: 'download', act: 'doc:save-report', palette: false },
      { id: 'file.exportCsv', label: () => tl('Tableaux (CSV)'), icon: 'list', sub: () => CSV.map(([k, ic, name]) => ({ id: 'file.csv.' + k, label: name, icon: ic, act: 'csv:' + k })) }
    ] },
    { id: 'file.print', label: () => tl('Imprimer le rapport…'), icon: 'printer', keys: 'Mod+P', act: 'doc:print', global: true },
    SEP,
    { id: 'file.home', label: () => tl('Accueil'), icon: 'home', act: 'click:#homeBtn', palette: false }
  ] },
  { id: 'edit', label: () => (isEn ? 'Edit' : 'Édition'), items: [
    { id: 'edit.undo', label: () => tl('Annuler'), icon: 'undo', keys: 'Mod+Z', act: 'click:#undoBtn', enabled: env => env.canUndo !== false, palette: false },
    { id: 'edit.redo', label: () => tl('Rétablir'), icon: 'redo', keys: 'Mod+Shift+Z', act: 'click:#redoBtn', enabled: env => env.canRedo !== false, palette: false },
    SEP,
    // Presse-papiers : routé vers la vue montrée, qui a ses propres gestes (plan, schéma logique, baies).
    { id: 'edit.cut', label: () => tl('Couper'), icon: 'scissors', keys: 'Mod+X', act: 'combo:Mod+X', when: env => CLIP_CUT.has(env.view), enabled: env => !!env.sel },
    { id: 'edit.copy', label: () => tl('Copier'), icon: 'copy', keys: 'Mod+C', act: 'combo:Mod+C', when: env => CLIP.has(env.view), enabled: env => !!env.sel },
    { id: 'edit.paste', label: () => tl('Coller'), icon: 'clipboard', keys: 'Mod+V', act: 'combo:Mod+V', when: env => CLIP.has(env.view) },
    { id: 'edit.duplicate', label: () => tl('Dupliquer'), icon: 'copy', keys: 'Mod+D', act: 'combo:Mod+D', when: env => CLIP.has(env.view), enabled: env => !!env.sel },
    SEP,
    { id: 'edit.selectAll', label: env => (env && env.view === 'plan' ? tl('Tout sélectionner sur l’étage') : tl('Tout sélectionner')), icon: 'pointer', keys: 'Mod+A', act: 'combo:Mod+A', when: env => CLIP_CUT.has(env.view) },
    { id: 'edit.rename', label: () => tl('Renommer'), icon: 'edit', keys: 'F2', act: 'rename', enabled: env => !!env.sel },
    { id: 'edit.delete', label: () => tl('Supprimer la sélection'), icon: 'trash', keys: 'Del', act: 'key:Delete', enabled: env => !!env.sel, palette: false },
    { id: 'edit.deselect', label: () => tl('Désélectionner'), icon: 'x', keys: 'Esc', act: 'deselect', enabled: env => !!env.sel },
    SEP,
    { id: 'edit.find', label: () => tl('Rechercher dans le projet…'), icon: 'search', keys: 'Mod+F', cmd: 'net.find', when: env => has(env, 'net.find'), palette: false },
    { id: 'edit.goto', label: () => tl('Aller à…'), icon: 'chevRight', keys: 'Mod+G', cmd: 'net.goto', when: env => has(env, 'net.goto'), palette: false },
    { id: 'edit.props', label: () => tl('Propriétés de la sélection'), icon: 'sliders', act: 'inspector' }
  ] },
  { id: 'view', label: () => (isEn ? 'View' : 'Affichage'), items: [
    ...VIEWS.map(([v, ic, name], i) => ({ id: 'view.' + v, label: name, icon: ic, keys: 'Alt+' + (i + 1), act: 'view:' + v, radio: true, check: env => env.view === v, palette: false })),
    SEP,
    { id: 'view.layers', label: () => tl('Calques'), icon: 'layers', cmd: 'net.layers', when: env => has(env, 'net.layers'), palette: false },
    { id: 'view.browser', label: () => tl('Arbre des objets du projet'), icon: 'list', cmd: 'net.browser', when: env => has(env, 'net.browser'), palette: false },
    { id: 'view.wifi', label: () => tl('Carte de couverture Wi-Fi'), icon: 'wifi', act: 'layer:wifi', check: env => !!(env.layers && env.layers.wifi) },
    { id: 'view.underlay', label: () => tl('Plan de fond importé'), icon: 'image', act: 'layer:image', check: env => !env.layers || env.layers.image !== false },
    { id: 'view.routes', label: () => tl('Tracé des câbles de la sélection'), icon: 'route', act: 'layer:routes', check: env => !env.layers || env.layers.routes !== false },
    { id: 'view.vlan', label: () => tl('Couleurs des VLAN'), icon: 'vlanTag', act: 'sim:vlan', check: env => !!(env.sim && env.sim.vlan) },
    { id: 'view.passive', label: () => tl('Masquer le câblage passif'), icon: 'patchPanel', act: 'sim:passive', check: env => !!(env.sim && env.sim.passive) },
    { id: 'view.arrange', label: () => tl('Ranger le schéma logique'), icon: 'treeLayout', cmd: 'net.sim.arrange', palette: false },
    SEP,
    { id: 'view.fit', label: () => tl('Tout voir'), icon: 'fitAll', keys: 'F', act: 'fit' },
    { id: 'view.lib', label: () => tl('Bibliothèque'), icon: 'box', keys: 'Mod+B', act: 'lib', palette: false },
    { id: 'view.inspector', label: () => tl('Inspecteur'), icon: 'sliders', keys: 'Mod+Alt+B', act: 'inspectorToggle', global: true, check: env => env.insOpen !== false },
    { id: 'view.dock', label: () => tl('Panneau du bas'), icon: 'sidebar', keys: 'Mod+J', act: 'dock', palette: false },
    { id: 'view.problems', label: () => tl('Problèmes'), icon: 'alert', keys: 'Mod+Shift+M', act: 'problems', palette: false },
    { id: 'view.output', label: () => (isEn ? 'Output' : 'Sortie'), icon: 'terminal', keys: 'Mod+Shift+U', act: 'output', palette: false },
    { id: 'view.dockPatch', label: () => tl('Brassage (panneau du bas)'), icon: 'patchPanel', cmd: 'net.dock.patch', when: env => has(env, 'net.dock.patch'), palette: false },
    { id: 'view.dockCables', label: () => tl('Câbles (panneau du bas)'), icon: 'cable', cmd: 'net.dock.cables', when: env => has(env, 'net.dock.cables'), palette: false },
    { id: 'view.dockTests', label: () => tl('Résultats des tests (panneau du bas)'), icon: 'certifier', cmd: 'net.dock.tests', when: env => has(env, 'net.dock.tests'), palette: false },
    SEP,
    { id: 'view.theme', label: () => tl('Basculer le thème clair ou sombre'), icon: 'sun', act: 'theme', palette: false }
  ] },
  { id: 'insert', label: () => tl('Insertion'), items: [
    { id: 'ins.device', label: () => tl('Équipement de la bibliothèque…'), icon: 'box', act: 'libSearch' },
    { id: 'ins.quick', label: () => tl('Équipement courant'), icon: 'plus', sub: () => [
      ['switch24', 'switchNet', () => tl('Switch 24 ports PoE+')], ['ap', 'wifi', () => tl('Point d’accès Wi-Fi')], ['outlet2', 'outlet2', () => tl('Prise RJ45 double')],
      ['patch24', 'patchPanel', () => tl('Panneau de brassage 24 ports')], ['routerpro', 'router', () => tl('Routeur')], ['pc', 'desktopPc', () => tl('Poste de travail')]
    ].map(([t, ic, name]) => ({ id: 'ins.dev.' + t, label: name, icon: ic, act: 'place:' + t })) },
    SEP,
    { id: 'ins.building', label: () => tl('Bâtiment'), icon: 'building', act: 'plan:newBuilding' },
    { id: 'ins.floor', label: () => tl('Étage au-dessus'), icon: 'plus', act: 'plan:addFloor' },
    { id: 'ins.wall', label: () => tl('Murs'), icon: 'wall', keys: 'W', act: 'tool:wall', scope: 'plan' },
    { id: 'ins.room', label: () => tl('Salle'), icon: 'room', keys: 'R', act: 'tool:room', scope: 'plan' },
    { id: 'ins.detect', label: () => tl('Pièces fermées par les murs (détection)'), icon: 'wand', act: 'plan:detect' },
    { id: 'ins.door', label: () => tl('Porte'), icon: 'door', keys: 'D', act: 'tool:door', scope: 'plan' },
    { id: 'ins.path', label: () => tl('Cheminement de câbles'), icon: 'cableTray', keys: 'K', act: 'tool:path', scope: 'plan' },
    { id: 'ins.link', label: () => tl('Lien permanent'), icon: 'link', keys: 'L', act: 'tool:link', scope: 'plan' },
    SEP,
    { id: 'ins.rack', label: () => tl('Baie au sol'), icon: 'rack', act: 'rack:floor' },
    { id: 'ins.wrack', label: () => tl('Coffret mural'), icon: 'rack', act: 'rack:wall' },
    SEP,
    { id: 'ins.cable', label: () => tl('Câble (schéma logique)'), icon: 'cable', keys: 'C', act: 'ltool:cable', scope: 'logic' }
  ] },
  { id: 'net', label: () => tl('Réseau'), items: [
    { id: 'net.vlans', label: () => tl('Base des VLAN…'), icon: 'vlanTag', cmd: 'net.sim.vlans', palette: false },
    { id: 'net.ip', label: () => tl('Plan d’adressage IP'), icon: 'network', act: 'design:ip' },
    SEP,
    { id: 'net.l3', label: () => tl('Routage et OSPF (routeurs, switchs L3)'), icon: 'router', act: 'cfg:l3' },
    { id: 'net.stp', label: () => tl('Spanning Tree (switchs)'), icon: 'treeLayout', act: 'cfg:stp' },
    { id: 'net.dhcp', label: () => tl('Serveurs DHCP'), icon: 'server', act: 'cfg:dhcp' },
    { id: 'net.wifiPlan', label: () => tl('Plan de canaux Wi-Fi automatique'), icon: 'wifi', cmd: 'net.wifi.autochannel', when: env => has(env, 'net.wifi.autochannel'), palette: false },
    SEP,
    { id: 'net.arrange', label: () => tl('Ranger le schéma : cœur, distribution, accès'), icon: 'treeLayout', cmd: 'net.sim.arrange', palette: false }
  ] },
  { id: 'design', label: () => tl('Conception'), items: [
    ...DESIGN_TABS.map(([k, ic, name]) => ({ id: 'design.' + k, label: name, icon: ic, act: 'design:' + k })),
    SEP,
    { id: 'design.generate', label: () => tl('Générer l’installation depuis les pièces…'), icon: 'wand', act: 'design:generate' }
  ] },
  { id: 'tests', label: () => tl('Tests'), items: [
    { id: 'tests.ping', label: () => 'Ping', icon: 'ping', keys: 'P', act: 'ltool:ping', scope: 'logic' },
    { id: 'tests.trace', label: () => 'Traceroute', icon: 'traceroute', keys: 'R', act: 'ltool:trace', scope: 'logic' },
    { id: 'tests.tester', label: () => tl('Testeur de câble'), icon: 'cableTester', keys: 'T', act: 'ltool:tester', scope: 'logic' },
    SEP,
    { id: 'tests.certAll', label: () => tl('Certifier tous les liens'), icon: 'certifier', keys: 'Mod+Shift+K', act: 'cert:all', global: true },
    { id: 'tests.cert', label: () => tl('Testeur de certification…'), icon: 'certifier', act: 'cert:open' },
    { id: 'tests.results', label: () => tl('Résultats des tests'), icon: 'checklist', act: 'design:tests' },
    SEP,
    { id: 'tests.check', label: () => tl('Lancer le vérificateur'), icon: 'check', keys: 'F7', cmd: 'sim:check', palette: false },
    // Mode examen : outil de l'enseignant. Au menu seulement dans l'édition Pro (enseignement) ou pour sortir d'un examen
    // en cours ; l'édition libre le garde dans la palette, sans le mettre en avant (pas d'appât vers le Pro).
    { id: 'tests.exam', label: () => tl('Mode examen (enseignant)'), icon: 'lock', cmd: 'net.exam', check: env => !!env.exam, when: env => has(env, 'net.exam') && (!!env.pro || !!env.exam), palette: false }
  ] },
  { id: 'docs', label: () => tl('Documents'), items: [
    { id: 'docs.print', label: () => tl('Imprimer le rapport…'), icon: 'printer', keys: 'Mod+P', act: 'doc:print', palette: false },
    { id: 'docs.report', label: () => tl('Enregistrer le rapport (HTML)…'), icon: 'download', act: 'doc:save-report' },
    { id: 'docs.sheets', label: () => tl('Planches avec cartouche (PDF)…'), icon: 'printer', act: 'exportPdf', when: env => cap(env, 'pdf'), palette: false },
    SEP,
    { id: 'docs.floors', label: () => tl('Plan d’étage (SVG)'), icon: 'floorPlan', enabled: env => !!(env.floors && env.floors.length), sub: env => (env.floors || []).map(f => ({ id: 'docs.floor.' + f.id, label: () => f.name, act: 'svg-floor:' + f.id, palette: false })) },
    { id: 'docs.racks', label: () => tl('Élévation de baie (SVG)'), icon: 'rack', enabled: env => !!(env.racks && env.racks.length), sub: env => (env.racks || []).map(r => ({ id: 'docs.rack.' + r.id, label: () => r.name, act: 'svg-rack:' + r.id, palette: false })) },
    { id: 'docs.dxf', label: () => tl('Plan en DXF…'), icon: 'download', act: 'exportDxf', when: env => cap(env, 'dxf'), palette: false },
    { id: 'docs.dwg', desk: true, label: () => tl('Plan en DWG…'), icon: 'download', act: 'exportDwg', when: env => cap(env, 'dwg'), palette: false },
    { id: 'docs.ifc', label: () => tl('Modèle BIM (IFC)…'), icon: 'download', act: 'exportIfc', when: env => cap(env, 'ifc'), palette: false },
    { id: 'docs.xlsx', label: () => tl('Classeur Excel (.xlsx)…'), icon: 'list', act: 'exportXlsx', when: env => cap(env, 'xlsx'), palette: false },
    { id: 'docs.vsdx', label: () => tl('Schémas Visio (.vsdx)…'), icon: 'network', act: 'exportVsdx', when: env => cap(env, 'visio'), palette: false },
    { id: 'docs.drawio', label: () => tl('Schémas draw.io (.drawio)…'), icon: 'network', act: 'exportDrawio', when: env => cap(env, 'visio'), palette: false },
    { id: 'docs.csv', label: () => tl('Tableaux (CSV)'), icon: 'list', sub: () => CSV.map(([k, ic, name]) => ({ id: 'docs.csv.' + k, label: name, icon: ic, act: 'csv:' + k, palette: false })) },
    SEP,
    { id: 'docs.info', label: () => tl('Renseignements du projet (cartouche)'), icon: 'clipboard', act: 'design:docs' },
    SEP,
    // Inventaire DCIM / IPAM (ui/netbox.js : openNetbox), détecté par shellnet.js.
    { id: 'docs.netbox', desk: true, label: () => tl('Synchroniser avec NetBox…'), icon: 'dcimSync', act: 'netbox', when: env => cap(env, 'netbox') }
  ] },
  { id: 'help', label: () => tl('Aide'), items: [
    { id: 'help.tour', label: () => tl('Visite guidée du module réseau'), icon: 'play', act: 'tour' },
    { id: 'help.keys', label: () => tl('Raccourcis clavier'), icon: 'keyboard', keys: '?', act: 'keys' },
    { id: 'help.palette', label: () => tl('Palette de commandes'), icon: 'keyboard', keys: 'Mod+Shift+P', act: 'palette', palette: false },
    SEP,
    { id: 'help.labs', label: () => tl('TP de réseau'), icon: 'checklist', act: 'labs' },
    { id: 'help.example', label: () => tl('Exemple : collège sur deux étages'), icon: 'building', act: 'template:school' },
    SEP,
    { id: 'help.docs', label: () => tl('Documentation en ligne'), icon: 'book', act: 'url:help', palette: false },
    { id: 'help.issue', label: () => tl('Signaler un problème…'), icon: 'alert', act: 'url:issues' },
    { id: 'help.about', label: () => tl('À propos de Jollof Studio'), icon: 'info', act: 'about' }
  ] }
];

/** Une entrée se montre-t-elle ? (when absent : toujours.) */
const visible = (it, env) => { try { return !it.when || !!it.when(env); } catch (e) { return false; } };
const val = (f, env, d) => { try { return f ? f(env) : d; } catch (e) { return d; } };

/** Entrées résolues (libellés en texte, états calculés), séparateurs en trop retirés. */
function resolve(items, env) {
  const out = [];
  for (const it of items) {
    if (it.sep) { if (out.length && !out[out.length - 1].sep) out.push({ sep: true }); continue; }
    if (!visible(it, env)) continue;
    const sub = it.sub ? resolve(val(it.sub, env, []), env) : null;
    if (sub && !sub.length && !it.enabled) continue; // sous-menu vide : rien à montrer
    const tag = it.desk && env.desktop === false ? tl('application de bureau') : ''; // version web : la commande l'explique
    const r = { id: it.id, tag, label: it.label(env), icon: it.icon || '', keys: it.scope && env.view !== it.scope ? '' : it.keys || '', scope: it.scope || '', act: it.act || '', cmd: it.cmd || '', disabled: it.enabled ? !val(it.enabled, env, true) : false };
    if (it.check) { r.checked = !!val(it.check, env, false); r.radio = !!it.radio; }
    if (sub) { r.sub = sub; if (!sub.length) r.disabled = true; }
    out.push(r);
  }
  while (out.length && out[out.length - 1].sep) out.pop();
  return out;
}

/** Menus à montrer pour ce projet : [] sans plan réseau. */
export function menusFor(env) {
  if (!env || !hasNet(env.kind)) return [];
  return MENUS.map(m => ({ id: m.id, label: m.label(), items: resolve(m.items, env) })).filter(m => m.items.length);
}

/** Toutes les entrées (sous-menus compris), à plat : palette, recherche d'un raccourci. */
export function flatItems(env) {
  const out = [], walk = (list, path) => { for (const it of list) { if (it.sep) continue; out.push({ ...it, path }); if (it.sub) walk(it.sub, path.concat(it.label)); } };
  for (const m of menusFor(env)) walk(m.items, [m.label]);
  return out;
}

/** Raccourcis du projet réseau (aide « ? ») : ses combinaisons (Ctrl, Alt, touches de fonction), une fois chacune ; Alt+1…4 en une ligne. */
/** Raccourcis de toute l'application (fichier, édition, panneaux) : l'aide « ? » ne les répète pas. */
const APP_KEYS = new Set(['Mod+N', 'Mod+O', 'Mod+S', 'Mod+Shift+S', 'Mod+Z', 'Mod+Shift+Z', 'Mod+A', 'Mod+B', 'Mod+J', 'Mod+Shift+M', 'Mod+Shift+U', 'Mod+Shift+P', 'Mod+X', 'Mod+C', 'Mod+V', 'Mod+D', 'F2']);
export function shortcutRows(env) {
  const seen = new Set(), rows = [];
  for (const it of flatItems(env)) {
    if (!it.keys || seen.has(it.keys) || APP_KEYS.has(it.keys) || !/^(Mod|Alt|F\d)/.test(it.keys)) continue;
    seen.add(it.keys);
    if (/^Alt\+\d$/.test(it.keys)) { if (!seen.has('views')) { seen.add('views'); rows.push(['Alt+1…4', tl('Vues : logique, plans, baies, conception')]); } continue; }
    rows.push([it.keys, it.label]);
  }
  return rows;
}

/** Raccourcis que ce module traite lui-même (personne d'autre ne les écoute) : [[keys, id d'entrée]]. */
export function globalKeys() {
  const out = [], walk = list => { for (const it of list) { if (it.sep) continue; if (it.global && it.keys) out.push([it.keys, it.id]); if (it.sub) walk(typeof it.sub === 'function' ? it.sub({}) : it.sub); } };
  for (const m of MENUS) walk(m.items);
  return out;
}

/** L'événement clavier e correspond-il au raccourci keys (« Mod+Shift+E », « Alt+2 », « F7 ») ? */
export function matchKey(e, keys) {
  if (!e || !keys) return false;
  const parts = keys.split('+'), key = parts.pop(), want = new Set(parts);
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod !== want.has('Mod') || !!e.shiftKey !== want.has('Shift') || !!e.altKey !== want.has('Alt')) return false;
  if (/^\d$/.test(key)) return e.code === 'Digit' + key || e.key === key;
  if (/^[A-Z]$/.test(key)) return e.code === 'Key' + key || String(e.key).toUpperCase() === key;
  return e.key === key;
}

/** Raccourci écrit à la façon du système : ⌘⇧E sur Mac, Ctrl+Maj+E (Ctrl+Shift+E en anglais) ailleurs. */
export function keyLabel(keys, mac = false, en = isEn) {
  if (!keys) return '';
  if (String(keys).includes('|')) return String(keys).split('|').map(k => keyLabel(k, mac, en)).join(en ? ' or ' : ' ou ');
  keys = String(keys).replace(/\bCtrl\b/g, 'Mod').replace(/\bMaj\b/g, 'Shift');
  const W = { Mod: mac ? '⌘' : 'Ctrl', Shift: mac ? '⇧' : en ? 'Shift' : 'Maj', Alt: mac ? '⌥' : 'Alt', Del: en ? 'Del' : 'Suppr', Esc: en ? 'Esc' : 'Échap' };
  const p = keys.split('+').map(k => W[k] || k);
  return mac ? p.join('') : p.join('+');
}
