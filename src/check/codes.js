// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Codes stables des diagnostics du vérificateur, comme ceux de rustc (E0308…) : un numéro ne change jamais
// de sens. Familles : J01 alimentation et courts-circuits, J02 signaux (le « type » de chaque broche),
// J03 valeurs nominales prouvées dans tous les états, J04 polarité, J05 moteurs, J06 programme ↔ montage,
// J09 conseils (avertissements qu'on peut accepter), J1 code du programme (J10, J11), J12 réseau informatique.
// key : code de l'ancienne détection (circuit.js, faults.js) que ce numéro reprend.
import { tl, DEC } from '../i18n/index.js';

const dec = v => String(Math.round(v * 10) / 10).replace('.', DEC);
export const fmtMA = v => (Math.abs(v) >= 1000 ? `${dec(v / 1000)} A` : `${Math.round(v)} mA`);
export const fmtV = v => `${dec(v)} V`;
export const fmtW = v => (v >= 1 ? `${dec(v)} W` : `${Math.round(v * 1000)} mW`);
/** Courant au dixième de mA (bases de transistor, bus I2C). */
export const fmtMA1 = v => (Math.abs(v) >= 1000 ? fmtMA(v) : `${dec(v)} mA`);
const fmtOhm = v => (v >= 1000 ? `${dec(v / 1000)} kΩ` : `${Math.round(v)} Ω`);
const fmtHz = v => (v >= 1e6 ? `${dec(v / 1e6)} MHz` : `${Math.round(v / 1000)} kHz`);
const fmtU = { mA: fmtMA, W: fmtW, V: fmtV };
/** Limite citée dans un titre : « 40 mA au plus » (erreur) ou « 20 mA conseillés » (avertissement). */
const lim = (m, f) => (m.soft ? tl('{0} conseillés', f(m.limit)) : tl('{0} au plus', f(m.limit)));

/** level : 'error' (bloque) ou 'warning' ; family : J01… ; key : ancien code ; title(m) pour les nouveaux contrôles. */
export const CODES = {
  J0101: { key: 'short-g', level: 'error' },
  J0102: { key: 'short-v', level: 'error' },
  J0103: { level: 'error', title: m => tl('Court-circuit : {0} débite {1}', m.name, fmtMA(m.value)) },
  J0104: { key: 'nopower', level: 'error' },
  J0105: { key: 'undervolt', level: 'error' },
  J0106: { key: 'overvolt', level: 'error' },
  J0107: { key: 'nognd', level: 'error' },
  J0108: { key: 'commongnd', level: 'error' },
  J0109: { level: 'error', title: m => tl('{0} surchargée : {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0110: { key: 'swshort', level: 'error' },
  J0111: { level: 'error', title: m => tl('{0} reçoit {1} ({2} à {3} admis)', m.name, fmtV(m.value), fmtV(m.lo), fmtV(m.hi)) },
  J0112: { level: 'warning', title: m => tl('{0} ne reçoit que {1} : il faut au moins {2}', m.name, fmtV(m.value), fmtV(m.lo)) },
  J0201: { key: 'topwr', level: 'error' },
  J0202: { key: 'togn', level: 'error' },
  J0203: { key: 'nogpio', level: 'error' },
  J0204: { key: 'cap', level: 'error' },
  J0205: { key: 'flash', level: 'error' },
  J0206: { key: 'bus', level: 'error' },
  J0207: { key: 'lv5', level: 'error' },
  J0208: { key: 'lv3', level: 'error' },
  J0209: { key: 'pullup', level: 'warning' },
  J0210: { key: 'pulldown', level: 'warning' },
  J0211: { key: 'uart0', level: 'warning' },
  J0212: { key: 'nores', level: 'warning' },
  J0213: { level: 'warning', title: m => tl('{0} reçoit {1} au niveau haut : il lui faut au moins {2}', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0214: { level: 'warning', title: m => tl('Bus I2C de {0} : ses tirages demandent {1} pour descendre à 0,4 V ({2} au plus)', m.name, fmtMA1(m.value), fmtMA1(m.limit)) },
  J0215: { level: 'warning', title: m => tl('Bus I2C de {0} : tirage de {1}, trop faible à {2} (au plus {3})', m.name, fmtOhm(m.value), fmtHz(m.f), fmtOhm(m.limit)) },
  J0301: { level: 'error', title: m => tl('{0} traversée par {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0302: { key: 'gpioover', level: 'error', title: m => tl('{0} débite {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0303: { level: 'error', title: m => tl('{0} reçoit {1} : au-delà de sa tension ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0304: { level: 'error', title: m => tl('{0} dissipe {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0305: { level: 'error', title: m => tl('{0} : {1} dans le collecteur ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0306: { level: 'error', title: m => tl('{0} alimenté sous {1} ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0307: { level: 'error', title: m => tl('{0} sous {1} : au-delà de sa tension de service ({2})', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0308: { level: 'error', title: m => tl('{0} traversée par {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0309: { level: 'error', title: m => tl('{0} : {1} sur une voie ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0310: { level: 'error', title: m => tl('{0} : {1} dans ses contacts ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0311: { key: 'motorover', level: 'warning', title: m => tl('{0} sous {1} pour {2} prévus', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0312: { key: 'servolow', level: 'warning', title: m => tl('{0} sous-alimenté : {1}', m.name, fmtV(m.value)) },
  J0313: { level: 'error', title: m => tl('{0} reçoit {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0314: { level: 'error', title: m => tl('{0} dissipe {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0315: { level: 'error', title: m => tl('{0} sous {1} ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0316: { level: 'error', title: m => tl('{0} dissipe {1} ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0317: { level: 'error', title: m => tl('{0} dissipe {1} sans radiateur ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0318: { level: 'error', title: m => tl('{0} : {1} dans le drain ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0319: { level: 'error', title: m => tl('{0} : {1} entre grille et source ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0320: { level: 'error', title: m => tl('{0} : {1} entre drain et source ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0321: { level: 'error', title: m => tl('{0} : {1} sur sa sortie ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0322: { level: 'error', title: m => tl('{0} traversée par {1} ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0323: { level: 'warning', title: m => tl('{0} à {1} : hors de la plage d’entrée de l’ampli (au plus {2})', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0324: { level: 'error', title: m => tl('{0} à {1} : sous la masse ({2})', m.name, fmtV(m.value), lim(m, fmtV)) },
  J0325: { level: 'error', title: m => tl('{0} dissipe {1} sans radiateur ({2})', m.name, fmtW(m.value), lim(m, fmtW)) },
  J0326: { level: 'error', title: m => tl('{0} : {1} sur cette sortie ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0327: { level: 'error', title: m => tl('{0} : {1} pour toute la puce ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0328: { level: 'error', title: m => tl('{0} réglé à {1} par phase ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0329: { level: 'error', title: m => tl('{0} : son pilote lui envoie {1} par phase ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0331: { level: 'error', title: m => tl('{0} : {1} dans le primaire ({2})', m.name, fmtMA(m.value), lim(m, fmtMA)) },
  J0330: { level: 'warning', title: m => tl('{0} : chaîne de {1} MAX7219, jusqu’à {2} sur la broche 5V de la carte ({3})', m.name, m.n, fmtMA(m.value), lim(m, fmtMA)) },
  J0332: { level: 'error', title: m => (m.low ? tl('{0} à {1} : sous la masse ({2} au moins)', m.name, fmtV(m.value), fmtV(m.limit)) : tl('{0} reçoit {1} : au-delà de ce que tolère cette entrée ({2} au plus)', m.name, fmtV(m.value), fmtV(m.limit))) },
  J0333: { level: 'error', title: m => tl('{0} : {1} {2} par les broches {3} ({4} au plus)', m.name, fmtMA(m.value), m.dir === 'sink' ? tl('absorbés') : tl('fournis'), m.group, fmtMA(m.limit)) },
  J0334: { level: 'error', title: m => tl('{0} : {1} demandés au port USB ({2} au plus)', m.name, fmtMA(m.value), fmtMA(m.limit)) },
  J0401: { key: 'reversed', level: 'error' },
  J0402: { key: 'capreversed', level: 'error', title: m => tl('{0} monté à l’envers : {1} entre + et −', m.name, fmtV(m.value)) },
  J0403: { key: 'fanrev', level: 'warning', title: m => tl('{0} branché à l’envers : {1} sur le fil rouge', m.name, fmtV(m.value)) },
  J0501: { key: 'drvdirect', level: 'error' },
  J0502: { key: 'drvmissing', level: 'error' },
  J0503: { level: 'error', title: m => tl('{0} : bobines mal appariées sur {1}', m.name, m.b) },
  J0601: { level: 'error', title: m => tl('Deux sorties sur le même nœud : {0} et {1}', m.a, m.b) },
  J0602: { level: 'error', title: m => tl('{0} lue sans niveau défini', m.name) },
  J0603: { level: 'error', title: m => tl('analogWrite sur {0}, qui n’a pas de PWM', m.name) },
  J0604: { level: 'error', title: m => tl('analogRead sur {0}, qui n’est pas une entrée analogique', m.name) },
  J0605: { level: 'warning', title: m => tl('{0} commandée mais reliée à rien', m.name) },
  J0606: { level: 'warning', title: m => tl('{0} câblé mais jamais utilisé par le programme', m.name) },
  J0607: { level: 'warning', title: m => tl('digitalWrite sur {0} sans pinMode(OUTPUT)', m.name) },
  J0608: { level: 'error', title: m => tl('{0} en sortie contre la sortie de {1}', m.name, m.b) },
  J0609: { level: 'error', title: m => tl('Broche {0} inconnue sur {1}', m.name, m.b) },
  J0610: { level: 'error', title: m => tl('{0} et {1} répondent à la même adresse I2C (0x{2})', m.a, m.b, m.addr) },
  J0611: { level: 'error', title: m => tl('{0} est une entrée seulement : le programme ne peut pas la commander', m.name) },
  J0612: { level: 'error', title: m => tl('GPIO {0} tient la mémoire flash de l’ESP32 : le programme ne doit pas s’en servir', m.name) },
  J0613: { level: 'error', title: m => tl('{0} tirée au niveau haut : la flash passe à 1,8 V et la carte ne démarre pas', m.name) },
  J0614: { level: 'error', title: m => tl('analogRead sur {0} (ADC2) alors que le programme utilise le Wi-Fi', m.name) },
  J0615: { level: 'error', title: m => tl('Wire.setClock({0}) : {1} n’accepte que {2}', String(m.value), m.b, fmtHz(m.limit)) },
  // Plan pneumatique et électropneumatique : le titre vient du vérificateur du plan (src/pneu/check.js).
  J0701: { level: 'error' }, J0702: { level: 'warning' }, J0703: { level: 'error' }, J0704: { level: 'warning' }, J0705: { level: 'error' }, J0706: { level: 'warning' },
  // Circuit logique : le titre vient des vérifications du plan (src/logic/issues.js).
  J0801: { level: 'error' }, J0802: { level: 'warning' }, J0803: { level: 'warning' },
  J0901: { level: 'warning', title: m => tl('{0} sans diode de roue libre', m.name) },
  J0902: { level: 'warning', title: m => tl('{0} : {1} demandés, la pile se videra vite', m.name, fmtMA(m.value)) },
  J0903: { level: 'warning', title: m => tl('{0} : broche de démarrage tirée au niveau {1}', m.name, m.high ? tl('haut') : tl('bas')) },
  J0904: { level: 'warning', title: m => tl('{0} : {1}, plus de {2} % de sa limite ({3})', m.name, (fmtU[m.unit] || fmtV)(m.value), m.pct, (fmtU[m.unit] || fmtV)(m.limit)) },
  J0905: { level: 'warning', title: m => tl('{0} à {1} : analogRead sature au-delà de {2}', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0906: { level: 'warning', title: m => tl('{0} : grille sans résistance de rappel', m.name) },
  J0907: { level: 'warning', title: m => tl('{0} commandé sous {1} : sa résistance n’est garantie qu’à partir de {2}', m.name, fmtV(m.value), fmtV(m.limit)) },
  J0908: { level: 'warning', title: m => tl('{0} pas saturé : {1} dans la base, il en faut {2} (IC ÷ {3})', m.name, fmtMA1(m.value), fmtMA1(m.limit), m.beta) },
  J0909: { level: 'warning', title: m => tl('{0} sans condensateur {1}', m.name, m.which === 'in' ? tl('d’entrée') : tl('de sortie')) },
  J0910: { level: 'warning', title: m => tl('{0} alimenté par la broche 5V de {1} : un SG90 peut tirer {2} ({3} pour toute la carte)', m.name, m.b, fmtMA(m.value), fmtMA(m.limit)) },
  // Plan réseau : le titre vient des vérifications du plan (src/net/issues.js).
  J1201: { level: 'error' }, J1202: { level: 'error' }, J1203: { level: 'error' }, J1204: { level: 'warning' }, J1205: { level: 'error' }, J1206: { level: 'error' },
  J1207: { level: 'error' }, J1208: { level: 'error' }, J1209: { level: 'error' }, J1210: { level: 'error' }, J1211: { level: 'warning' }, J1212: { level: 'error' },
  J1213: { level: 'error' }, J1214: { level: 'warning' }, J1215: { level: 'warning' }, J1216: { level: 'warning' },
  // @sim
  J1217: { level: 'error' }, J1218: { level: 'error' }, J1219: { level: 'error' }, J1220: { level: 'warning' }, J1221: { level: 'error' }, J1222: { level: 'error' },
  J1223: { level: 'warning' }, J1224: { level: 'error' }, J1225: { level: 'error' }, J1226: { level: 'error' }, J1227: { level: 'warning' }, J1228: { level: 'error' },
  J1229: { level: 'warning' }, J1230: { level: 'error' }, J1231: { level: 'warning' }, J1232: { level: 'warning' }, J1233: { level: 'warning' }, J1234: { level: 'warning' },
  J1235: { level: 'warning' }, J1236: { level: 'error' }, J1237: { level: 'warning' }, J1238: { level: 'error' }, J1239: { level: 'error' }, J1296: { level: 'warning' }, J1297: { level: 'error' }, J1298: { level: 'error' }, J1299: { level: 'error' },
  // @fibre
  J1240: { level: 'error' }, J1241: { level: 'error' }, J1242: { level: 'error' }, J1243: { level: 'error' }, J1244: { level: 'error' },
  J1245: { level: 'error' }, J1246: { level: 'warning' }, J1247: { level: 'warning' }, J1248: { level: 'error' }, J1249: { level: 'error' },
  // @plan
  J1250: { level: 'error' }, J1251: { level: 'warning' }, J1252: { level: 'warning' }, J1253: { level: 'error' }, J1254: { level: 'warning' }, J1255: { level: 'warning' },
  J1256: { level: 'warning' }, J1257: { level: 'warning' }, J1258: { level: 'warning' }, J1259: { level: 'warning' }, J1260: { level: 'warning' }, J1261: { level: 'warning' }, J1262: { level: 'warning' },
  // @wifi
  J1265: { level: 'warning' }, J1266: { level: 'warning' }, J1267: { level: 'warning' }, J1268: { level: 'error' },
  J1269: { level: 'warning' }, J1270: { level: 'warning' }, J1271: { level: 'error' }, J1272: { level: 'warning' },
  // @rack
  J1273: { level: 'error' }, J1274: { level: 'error' }, J1275: { level: 'error' }, J1276: { level: 'error' }, J1277: { level: 'error' }, J1278: { level: 'warning' },
  J1279: { level: 'error' }, J1280: { level: 'warning' }, J1281: { level: 'warning' }, J1282: { level: 'warning' }, J1283: { level: 'warning' }, J1284: { level: 'warning' },
  J1285: { level: 'warning' },
  // @cert
  J1286: { level: 'error' }, J1287: { level: 'warning' }, J1288: { level: 'warning' }, J1289: { level: 'warning' },
  // Résultats mesurés par un vrai testeur, importés (src/net/checks/cert.js).
  J1301: { level: 'error' }, J1302: { level: 'warning' }, J1303: { level: 'warning' },
  // @design
  J1290: { level: 'warning' }, J1291: { level: 'warning' }, J1292: { level: 'warning' }, J1293: { level: 'warning' }, J1294: { level: 'warning' }, J1295: { level: 'warning' },
  J1001: { level: 'error' }, J1002: { level: 'error' }, J1101: { level: 'error' }, J1102: { level: 'error' },
  J1103: { level: 'error' }, J1104: { level: 'error' }, J1105: { level: 'error' }, J1106: { level: 'error' },
  J1107: { level: 'error' }, J1108: { level: 'error' }, J1109: { level: 'warning' }, J1110: { level: 'error' }, J1111: { level: 'error' }, J1199: { level: 'error' }
};
/** Ancien code (circuit.js, faults.js) → numéro stable. */
export const BY_KEY = Object.fromEntries(Object.entries(CODES).filter(([, c]) => c.key).map(([j, c]) => [c.key, j]));
/** Famille d'un code, pour regrouper. */
export const FAMILY = {
  J01: tl('Alimentation et courts-circuits'), J02: tl('Signaux et broches'), J03: tl('Valeurs nominales'), J04: tl('Polarité'),
  J05: tl('Moteurs'), J06: tl('Programme et montage'), J07: tl('Pneumatique et électropneumatique'), J08: tl('Circuit logique'), J09: tl('Conseils'), J1: tl('Code du programme'), J12: tl('Réseau informatique')
};
export const familyOf = code => FAMILY[code.slice(0, 3)] || FAMILY[code.slice(0, 2)] || '';
