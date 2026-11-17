// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Jumeau numérique : échange au format AutomationML (IEC 62714-1, CAEX 3.0, édition AutomationML 2.10), le standard
// des outils d'ingénierie d'usine (mise en service virtuelle, planification). La scène devient une hiérarchie
// d'instances : un InternalElement par composant (imbriqués comme leurs parents), de classe de notre bibliothèque
// d'unités système (JollofStudioSystemUnitClassLib), avec l'attribut Frame normalisé (x, y, z en m, rx, ry, rz en °),
// la taille, les réglages avec leurs unités, les signaux en interfaces SignalInterface (nom de variable IEC 61131-3,
// sens, BOOL), le vérin lié par un InternalLink vers l'élément du circuit pneumatique, et la géométrie référencée par
// un ExternalDataConnector vers le glTF 2.0 exporté à côté. L'import relit nos propres classes (une scène écrite par
// un autre outil est ignorée faute de correspondance) ; sans DOMParser : un petit lecteur XML suffit (tests Node).
import { CATALOG, cleanTwin, isMover, isSensor, signalOf } from './model.js';

const X = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Identifiant CAEX (GUID attendu) déterministe d'après une graine : la même scène donne le même fichier. */
export function guid(seed) {
  let h = 0x811c9dc5, hex = '';
  for (let k = 0; k < 4; k++) { for (const ch of `${seed}:${k}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } hex += h.toString(16).padStart(8, '0'); }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const LIB = 'JollofStudioSystemUnitClassLib';
/** Classes d'unités système de nos composants (et du vérin pneumatique). */
export const CLASS = { frame: 'Frame', block: 'Block', conveyor: 'BeltConveyor', pusher: 'LinearPusher', stopper: 'StopBlade', carriage: 'LinearCarriage', rotary: 'RotaryArm', gripper: 'VacuumGripper', tool: 'Tool', photocell: 'PhotoelectricSensor', proximity: 'ProximitySensor', source: 'ProductSource', sink: 'ProductSink', dispenser: 'Dispenser', button: 'PushButton', lamp: 'IndicatorLamp', label: 'Label', model: 'ExternalModel' };
const TYPE_OF = Object.fromEntries(Object.entries(CLASS).map(([t, c]) => [c, t]));
const ROLE = { structure: 'Structure', transport: 'Resource', actuator: 'Resource', sensor: 'Resource', flow: 'Resource', hmi: 'Resource', decor: 'Structure' };
const BASE_ROLE = 'AutomationMLBaseRoleClassLib/AutomationMLBaseRole/';
const SIGNAL_IF = 'AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface';
const DATA_IF = 'AutomationMLInterfaceClassLib/AutomationMLBaseInterface/ExternalDataConnector';
const unitOf = (p, k) => (k === 'speed' ? 'm/s' : k === 'every' || k === 'fillTime' ? 's' : k === 'range' ? (p.type === 'rotary' ? '°' : 'm') : ['stroke', 'width', 'height', 'length', 'reach', 'zone'].includes(k) ? 'm' : '');
const isNum = v => typeof v === 'number';

const attr = (name, value, o = {}, pad = '      ') => `${pad}<Attribute Name="${X(name)}"${o.unit ? ` Unit="${X(o.unit)}"` : ''}${o.type ? ` AttributeDataType="${o.type}"` : ''}${o.ref ? ` RefAttributeType="${o.ref}"` : ''}>${value != null ? `<Value>${X(value)}</Value>` : ''}${o.children ? `\n${o.children}\n${pad}` : ''}</Attribute>`;
const frameAttr = (p, pad) => attr('Frame', null, { ref: 'AutomationMLBaseAttributeTypeLib/Frame', children: [['x', p.pos[0]], ['y', p.pos[1]], ['z', p.pos[2]], ['rx', 0], ['ry', p.rot], ['rz', 0]].map(([k, v]) => attr(k, v, { unit: k.startsWith('r') ? '°' : 'm', type: 'xs:double' }, pad + '  ')).join('\n') }, pad);
const signal = (name, dir, type, pad, variable = name) => `${pad}<ExternalInterface Name="${X(name)}" ID="${guid('if:' + name + ':' + dir)}" RefBaseClassPath="${SIGNAL_IF}">\n${attr('Direction', dir, { type: 'xs:string' }, pad + '  ')}\n${attr('DataType', type, { type: 'xs:string' }, pad + '  ')}\n${attr('Variable', variable, { type: 'xs:string' }, pad + '  ')}\n${pad}</ExternalInterface>`;

/** Un composant et ses enfants. */
function element(p, parts, links, pad) {
  const K = CATALOG[p.type], id = guid('part:' + p.id), lines = [];
  lines.push(`${pad}<InternalElement Name="${X(p.id)}" ID="${id}" RefBaseSystemUnitPath="${LIB}/${CLASS[p.type]}">`);
  if (p.name) lines.push(attr('Label', p.name, { type: 'xs:string' }, pad + '  '));
  lines.push(frameAttr(p, pad + '  '));
  if (p.size) lines.push(attr('Size', null, { children: ['w', 'h', 'd'].map((k, i) => attr(k, p.size[i], { unit: 'm', type: 'xs:double' }, pad + '    ')).join('\n') }, pad + '  '));
  for (const [k, v] of Object.entries(p.props)) if (k !== 'asset') lines.push(attr(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : v, { unit: unitOf(p, k), type: isNum(v) ? 'xs:double' : typeof v === 'boolean' ? 'xs:boolean' : 'xs:string' }, pad + '  '));
  const b = Object.entries(p.bind);
  if (b.length) lines.push(attr('Binding', null, { children: b.map(([k, v]) => attr(k, v, { type: 'xs:string' }, pad + '    ')).join('\n') }, pad + '  '));
  if (isSensor(p)) lines.push(signal(signalOf(p), 'Out', 'BOOL', pad + '  '));
  if (p.type === 'button' && p.bind.input) lines.push(signal(p.bind.input, 'Out', 'BOOL', pad + '  '));
  if (p.bind.out && !(p.type === 'gripper' && p.props.mode === 'cyl')) lines.push(signal(p.bind.out, 'In', 'BOOL', pad + '  '));
  if ((isMover(p) || (p.type === 'gripper' && p.props.mode === 'cyl')) && p.bind.cyl) {
    lines.push(`${pad}  <ExternalInterface Name="Actuator" ID="${guid('act:' + p.id)}" RefBaseClassPath="${SIGNAL_IF}">\n${attr('Direction', 'In', { type: 'xs:string' }, pad + '    ')}\n${attr('DataType', 'REAL', { type: 'xs:string' }, pad + '    ')}\n${attr('Variable', p.bind.cyl, { type: 'xs:string' }, pad + '    ')}\n${pad}  </ExternalInterface>`);
    links.push({ name: `${p.id}.cyl`, a: `${id}:Actuator`, b: `${guid('cyl:' + p.bind.cyl)}:Position` });
  }
  for (const c of parts.filter(q => q.parent === p.id)) lines.push(element(c, parts, links, pad + '  '));
  lines.push(`${pad}  <SupportedRoleClass RefRoleClassPath="${BASE_ROLE}${ROLE[K.cat]}"/>`);
  lines.push(`${pad}</InternalElement>`);
  return lines.join('\n');
}

/**
 * Scène → AutomationML (texte XML). circuit : le circuit pneumatique (ses vérins sont exportés et liés) ; o : { glb
 * (nom du fichier glTF écrit à côté), project (titre), version, date (ISO ; sinon maintenant) }.
 */
export function toAutomationML(scene, circuit = null, o = {}) {
  const s = cleanTwin(scene), name = s.name || 'Machine', parts = s.parts, links = [], date = o.date || new Date().toISOString();
  const cyls = ((circuit && circuit.elements) || []).filter(e => e.type === 'cyl1' || e.type === 'cyl2');
  const refOf = e => (e.p && e.p.label) || e.id;
  const used = new Set(parts.map(p => p.bind.cyl).filter(Boolean));
  const body = parts.filter(p => !p.parent).map(p => element(p, parts, links, '      ')).join('\n');
  const cylEls = cyls.map(e => `      <InternalElement Name="${X(refOf(e))}" ID="${guid('cyl:' + refOf(e))}" RefBaseSystemUnitPath="${LIB}/PneumaticCylinder">
${attr('Type', e.type === 'cyl1' ? 'single-acting' : 'double-acting', { type: 'xs:string' }, '        ')}
${attr('bore', (e.p && e.p.bore) || 25, { unit: 'mm', type: 'xs:double' }, '        ')}
${attr('stroke', (e.p && e.p.stroke) || 100, { unit: 'mm', type: 'xs:double' }, '        ')}
${e.p && e.p.s0 ? signal(e.p.s0, 'Out', 'BOOL', '        ') + '\n' : ''}${e.p && e.p.s1 ? signal(e.p.s1, 'Out', 'BOOL', '        ') + '\n' : ''}        <ExternalInterface Name="Position" ID="${guid('pos:' + refOf(e))}" RefBaseClassPath="${SIGNAL_IF}">
${attr('Direction', 'Out', { type: 'xs:string' }, '          ')}
${attr('DataType', 'REAL', { type: 'xs:string' }, '          ')}
${attr('Variable', refOf(e), { type: 'xs:string' }, '          ')}
        </ExternalInterface>
        <SupportedRoleClass RefRoleClassPath="${BASE_ROLE}Resource"/>
      </InternalElement>`).join('\n');
  const validLinks = links.filter(l => cyls.some(e => refOf(e) === l.b.split(':')[0] || guid('cyl:' + refOf(e)) === l.b.split(':')[0]));
  const classes = [...new Set(parts.map(p => CLASS[p.type]))].sort();
  return `<?xml version="1.0" encoding="utf-8"?>
<CAEXFile FileName="${X(name)}.aml" SchemaVersion="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CAEX_ClassModel_V3.0.xsd">
  <SuperiorStandardVersion>AutomationML 2.10</SuperiorStandardVersion>
  <SourceDocumentInformation OriginName="Jollof Studio" OriginID="sn.jollof.studio" OriginVersion="${X(o.version || '')}" LastWritingDateTime="${X(date)}" OriginProjectTitle="${X(o.project || name)}" OriginProjectID="${guid('project:' + (o.project || name))}" OriginRelease="${X(o.version || '')}" OriginVendor="Xelaktech" OriginVendorURL="https://xelaktechsn.github.io/jollof-studio/"/>
  <InstanceHierarchy Name="${X(name)}" ID="${guid('ih:' + name)}">
    <InternalElement Name="${X(name)}" ID="${guid('machine:' + name)}" RefBaseSystemUnitPath="${LIB}/Machine">
${attr('Units', 'SI: m, s, degrees; right-handed, Y up, floor at y = 0', { type: 'xs:string' }, '      ')}
${o.glb ? `      <ExternalInterface Name="Geometry" ID="${guid('geo:' + name)}" RefBaseClassPath="${DATA_IF}">
${attr('refURI', o.glb, { type: 'xs:anyURI' }, '        ')}
${attr('MIMEType', 'model/gltf-binary', { type: 'xs:string' }, '        ')}
      </ExternalInterface>\n` : ''}${body}
      <SupportedRoleClass RefRoleClassPath="${BASE_ROLE}Resource"/>
    </InternalElement>
${cylEls ? `    <InternalElement Name="PneumaticCircuit" ID="${guid('circuit:' + name)}" RefBaseSystemUnitPath="${LIB}/PneumaticCircuit">
${cylEls}
      <SupportedRoleClass RefRoleClassPath="${BASE_ROLE}Resource"/>
    </InternalElement>\n` : ''}${validLinks.map(l => `    <InternalLink Name="${X(l.name)}" RefPartnerSideA="${l.a}" RefPartnerSideB="${l.b}"/>`).join('\n')}${validLinks.length ? '\n' : ''}  </InstanceHierarchy>
  <SystemUnitClassLib Name="${LIB}">
    <Version>1.0</Version>
    <SystemUnitClass Name="Machine" ID="${guid('suc:Machine')}"><SupportedRoleClass RefRoleClassPath="${BASE_ROLE}Resource"/></SystemUnitClass>
    <SystemUnitClass Name="PneumaticCircuit" ID="${guid('suc:PneumaticCircuit')}"><SupportedRoleClass RefRoleClassPath="${BASE_ROLE}Resource"/></SystemUnitClass>
    <SystemUnitClass Name="PneumaticCylinder" ID="${guid('suc:PneumaticCylinder')}"><SupportedRoleClass RefRoleClassPath="${BASE_ROLE}Resource"/></SystemUnitClass>
${classes.map(c => `    <SystemUnitClass Name="${c}" ID="${guid('suc:' + c)}">${Object.entries(CATALOG[TYPE_OF[c]].props).filter(([k]) => k !== 'asset').map(([k, v]) => `<Attribute Name="${X(k)}" AttributeDataType="${isNum(v) ? 'xs:double' : typeof v === 'boolean' ? 'xs:boolean' : 'xs:string'}"/>`).join('')}<SupportedRoleClass RefRoleClassPath="${BASE_ROLE}${ROLE[CATALOG[TYPE_OF[c]].cat]}"/></SystemUnitClass>`).join('\n')}
  </SystemUnitClassLib>
  <RoleClassLib Name="AutomationMLBaseRoleClassLib">
    <Version>2.10.0</Version>
    <RoleClass Name="AutomationMLBaseRole"><RoleClass Name="Resource" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole"/><RoleClass Name="Structure" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole"/></RoleClass>
  </RoleClassLib>
  <InterfaceClassLib Name="AutomationMLInterfaceClassLib">
    <Version>2.10.0</Version>
    <InterfaceClass Name="AutomationMLBaseInterface"><InterfaceClass Name="SignalInterface" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface"/><InterfaceClass Name="ExternalDataConnector" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface"/></InterfaceClass>
  </InterfaceClassLib>
  <AttributeTypeLib Name="AutomationMLBaseAttributeTypeLib">
    <Version>2.10.0</Version>
    <AttributeType Name="Frame"><Attribute Name="x" Unit="m" AttributeDataType="xs:double"/><Attribute Name="y" Unit="m" AttributeDataType="xs:double"/><Attribute Name="z" Unit="m" AttributeDataType="xs:double"/><Attribute Name="rx" Unit="°" AttributeDataType="xs:double"/><Attribute Name="ry" Unit="°" AttributeDataType="xs:double"/><Attribute Name="rz" Unit="°" AttributeDataType="xs:double"/></AttributeType>
  </AttributeTypeLib>
</CAEXFile>
`;
}

/* ---------- Lecture ---------- */
const decode = s => s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, e) => (e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))));
/** Petit lecteur XML (éléments, attributs, texte, commentaires, CDATA) : arbre { name, attrs, children, text }. */
export function parseXml(text) {
  const root = { name: '#document', attrs: {}, children: [], text: '' }, stack = [root]; let i = 0;
  const top = () => stack[stack.length - 1];
  const tagEnd = from => { let q = null; for (let k = from; k < text.length; k++) { const c = text[k]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return k; } throw new Error('XML : balise non fermée'); };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { top().text += decode(text.slice(i)); break; }
    if (lt > i) top().text += decode(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); if (e < 0) throw new Error('XML : commentaire non fermé'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt); if (e < 0) throw new Error('XML : CDATA non fermé'); top().text += text.slice(lt + 9, e); i = e + 3; continue; }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) { const e = text.indexOf('>', lt); if (e < 0) throw new Error('XML : déclaration non fermée'); i = e + 1; continue; }
    const gt = tagEnd(lt + 1), raw = text.slice(lt + 1, gt).trim();
    if (raw[0] === '/') { const name = raw.slice(1).trim(); if (stack.length < 2 || top().name !== name) throw new Error(`XML : </${name}> inattendu`); stack.pop(); i = gt + 1; continue; }
    const self = raw.endsWith('/'), body = self ? raw.slice(0, -1) : raw, m = /^([^\s/>]+)\s*([\s\S]*)$/.exec(body);
    if (!m) throw new Error('XML : balise illisible');
    const el = { name: m[1], attrs: {}, children: [], text: '' }, re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
    while ((a = re.exec(m[2]))) el.attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    top().children.push(el); if (!self) stack.push(el); i = gt + 1;
  }
  if (stack.length !== 1) throw new Error(`XML : <${top().name}> non fermé`);
  return root;
}
const kids = (el, name) => el.children.filter(c => c.name === name);
const attrOf = (el, name) => kids(el, 'Attribute').find(a => a.attrs.Name === name) || null;
const valueOf = el => { const v = el && kids(el, 'Value')[0]; return v ? v.text.trim() : null; };
/** Lecture d'un fichier AutomationML écrit par Jollof Studio : la scène (nettoyée) ; erreur lisible sinon. */
export function fromAutomationML(xml) {
  const doc = parseXml(String(xml)), file = kids(doc, 'CAEXFile')[0];
  if (!file) throw new Error('AutomationML : pas de CAEXFile');
  const parts = []; let name = '';
  const walk = (el, parent) => {
    for (const ie of kids(el, 'InternalElement')) {
      const ref = ie.attrs.RefBaseSystemUnitPath || '', cls = ref.startsWith(LIB + '/') ? ref.slice(LIB.length + 1) : null, type = cls && TYPE_OF[cls];
      if (cls === 'Machine') { name = name || ie.attrs.Name || ''; walk(ie, null); continue; }
      if (!type) { walk(ie, parent); continue; }
      const F = attrOf(ie, 'Frame'), num = (a, k) => { const v = a && valueOf(attrOf(a, k)); return v == null ? 0 : +v; };
      const p = { id: ie.attrs.Name, type, pos: [num(F, 'x'), num(F, 'y'), num(F, 'z')], rot: num(F, 'ry'), props: {}, bind: {} };
      const lbl = valueOf(attrOf(ie, 'Label')); if (lbl) p.name = lbl;
      const S = attrOf(ie, 'Size'); if (S) p.size = [num(S, 'w'), num(S, 'h'), num(S, 'd')];
      for (const k of Object.keys(CATALOG[type].props)) { const v = valueOf(attrOf(ie, k)); if (v != null) p.props[k] = typeof CATALOG[type].props[k] === 'number' ? +v : typeof CATALOG[type].props[k] === 'boolean' ? v === 'true' : v; }
      const B = attrOf(ie, 'Binding'); if (B) for (const k of CATALOG[type].bind) { const v = valueOf(attrOf(B, k)); if (v) p.bind[k] = v; }
      if (parent) p.parent = parent;
      parts.push(p); walk(ie, p.id);
    }
  };
  for (const ih of kids(file, 'InstanceHierarchy')) walk(ih, null);
  if (!parts.length) throw new Error('AutomationML : aucun composant de Jollof Studio dans ce fichier');
  return cleanTwin({ name, parts });
}
