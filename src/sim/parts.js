// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fiches de câblage des composants de la bibliothèque.
// Chaque broche décrit ce qu'elle attend côté carte et pourquoi :
//   kind 'pwr'  alimentation, v = [min, max] en volts ou 'logic' (tension logique de la carte)
//   kind 'gnd'  masse
//   kind 'io'   signal vers un GPIO ; need = io | in | out | pullup | pwm | adc | sda | scl | sck | mosi | miso | ss | rx | tx
//   kind 'ext'  alimentation par une batterie (src = type de batterie, gndPin = masse du module)
//   kind 'vin'  batterie vers l'entrée VIN de la carte
//   kind 'drv'  sortie de puissance, vers un pilote de moteur
//   kind 'nc'   laissée libre (expliquée, jamais câblée)
//   kind 'contact' contact d'un relais (COM, NO, NC) : côté puissance, isolé de la carte, libre ou non
// Options : via (résistance série ajoutée), pull (résistance de tirage vers pullTo), opt (facultative),
// when (câblée seulement si l'une de ces broches l'est), switch (peut être mise à la masse par un bouton),
// lv5 (le module sort du 5 V), lv3 (module en logique 3,3 V), idle: 1 (sortie tirée au niveau haut au repos).
// ma : courant consommé sur son alimentation (mA, fiche technique ; pour le calcul et le budget des broches 5V/3V3).
// ds : fiche technique (clé de SOURCES, check/sources.js, ou liste de clés) d'où viennent v sur une broche, ma sur une fiche.
import { volts } from './boards.js';
import { tl, DEC } from '../i18n/index.js';
import { ANALOG_PARTS } from './analog-parts.js';

/** Fiche de câblage d'un composant : celle de la bibliothèque, ou celle d'un module importé (c.spec). */
export const partOf = c => (c && (c.spec || PARTS[c.type])) || null;

/**
 * Moteurs à courant continu et ce qui en dérive (ventilateur, pompe, vibreur) : pour le calcul du circuit, une
 * résistance (r, Ω) entre plus et minus ; vitesse = (|U| − vStart) / (vNom − vStart). rev : tourne dans les deux
 * sens selon la polarité ; polar : électronique interne, ne tourne pas à l'envers ; rpm : à vNom, pour l'affichage.
 */
export const MOTORS = {
  dcmotor: { plus: 'M+', minus: 'M-', r: 30, vNom: 6, vStart: 0.8, vMax: 9, rev: true, rpm: 9000 },
  fan: { plus: '+', minus: '-', r: 50, vNom: 5, vStart: 1.8, vMax: 6, polar: true, rpm: 5000 },
  pump: { plus: '+', minus: '-', r: 25, vNom: 5, vStart: 2, vMax: 6, rpm: 3000 },
  vibro: { plus: '+', minus: '-', r: 37, vNom: 3, vStart: 0.8, vMax: 3.8, rpm: 12000 }
};
export const isMotor = c => !!(c && MOTORS[c.type]);
/** Bornes d'un moteur : [plus, minus], ou null. */
export const motorPins = c => (isMotor(c) ? [MOTORS[c.type].plus, MOTORS[c.type].minus] : null);
/**
 * Bobines d'électrovanne (distributeurs du plan de travail pneumatique) : une résistance r (Ω) entre plus et minus ;
 * tension nominale vNom ; le distributeur bascule à partir de vPull. coil24 : bobine 24 V continu de 3,0 W
 * (série AirTAC 4V : DC24V ±10 %, 3,0 W ; r = 24² ÷ 3), soit 125 mA.
 */
export const COILS = { coil24: { plus: '+', minus: '-', r: 192, vNom: 24, vPull: 18, vMax: 26.4 } };
export const isCoil = c => !!(c && COILS[c.type]);
/** Contacts commandés de l'extérieur, lus comme un bouton (1–2 fermé quand inp.pressed) : bouton, capteur de vérin. */
export const CONTACTS = new Set(['button', 'cylsensor', 'pressostat']);
export const isContact = c => !!(c && CONTACTS.has(c.type));
/** Charges commutées comme un moteur (transistor côté masse) : bornes [plus, minus]. */
const LOADS = { buzzer: ['+', '-'], coil24: ['+', '-'] };
export const loadPins = c => motorPins(c) || (c && LOADS[c.type]) || null;
/**
 * Transistors NPN de la bibliothèque : courant de collecteur (mA, conseillé / maximum), Vce maximale (V),
 * puissance (mW), gain β pour le calcul. BC547 : petits signaux ; PN2222A : jusqu'à 600 mA (moteurs, pompes).
 * src : fiche technique (clé de SOURCES, check/sources.js).
 */
export const NPNS = {
  npn: { ic: { warn: 80, max: 100 }, vce: 45, p: 500, beta: 200, rsat: 2, src: 'onsemiBc547' },
  pn2222: { ic: { warn: 500, max: 600 }, vce: 40, p: 625, beta: 100, rsat: 0.6, src: 'onsemiPn2222a' },
  // PNP (pnp: true) : le NPN en miroir, émetteur au +, il conduit quand la base descend sous l'émetteur.
  pnp: { ic: { warn: 80, max: 100 }, vce: 45, p: 625, beta: 200, rsat: 2, pnp: true, src: 'onsemiBc557' },
  pn2907: { ic: { warn: 500, max: 600 }, vce: 60, p: 625, beta: 100, rsat: 0.6, pnp: true, src: 'onsemiPn2907a' }
};
export const isNpn = c => !!(c && NPNS[c.type] && !NPNS[c.type].pnp);
/**
 * Diodes Zener : tension Zener vz (V) à leur courant d'essai, résistance dynamique rz (Ω), puissance p (mW). En inverse,
 * elles conduisent dès vz (régulateur de tension, protection d'entrée) ; en direct, comme une diode ordinaire.
 */
/**
 * Capteur de courant ACS712 (effet Hall, primaire isolé de 1,2 mΩ) : sensibilité (V/A, sous VCC = 5 V, la sortie est
 * proportionnelle à VCC) de chaque version, plage de mesure ±range (A), bruit de sortie crête à crête (V). Le modèle
 * se choisit sur le composant (c.inp.range : 5, 20 ou 30), comme on choisit le module. Fiche Allegro (check/sources.js).
 */
export const ACS712 = { 5: { sens: 0.185, noise: 0.021 }, 20: { sens: 0.1, noise: 0.011 }, 30: { sens: 0.066, noise: 0.007 } };
export const ACS712_RP = 0.0012;
/** Plage (A) de cet ACS712 : 5 par défaut (module le plus courant, ACS712ELCTR-05B). */
export const acsRange = c => { const r = Math.trunc(+((c && c.inp && c.inp.range) || 5)); return ACS712[r] ? r : 5; };
export const ZENERS = {
  'zener-3v3': { vz: 3.3, rz: 28, p: 500, src: 'vishayBzx55' },
  'zener-5v1': { vz: 5.1, rz: 10, p: 500, src: 'vishayBzx55' },
  'zener-12v': { vz: 12, rz: 20, p: 500, src: 'vishayBzx55' }
};

const OUT = 'out', IN = 'in';
const gnd = (pin = 'GND', why) => ({ pin, kind: 'gnd', why });
const pwr = (pin, v, why, ds, role) => ({ pin, kind: 'pwr', v, why, ...(ds && { ds }), ...(role && { role }) });
const io = (pin, need, role, why, o = {}) => ({ pin, kind: 'io', need, role, why, ...o });
const nc = (pin, why) => ({ pin, kind: 'nc', why });
// Bornes d'un moteur : alimentation commandée (pilote, transistor, relais), jamais une broche de la carte.
const drvPins = (plus, minus) => [
  { pin: plus, kind: 'drv', role: tl('Plus'), why: tl('Côté + : vers l’alimentation commandée (sortie de pilote, contact de relais, pile). Un moteur demande des centaines de mA : jamais directement sur une broche de la carte.') },
  { pin: minus, kind: 'drv', role: tl('Moins'), why: tl('Côté − : vers la masse, le collecteur d’un transistor ou l’autre sortie du pilote.') }
];
const i2c = (o = {}) => [
  io('SCL', 'scl', 'I2C SCL', tl('Horloge du bus I2C, partagée par tous les modules I2C.'), o),
  io('SDA', 'sda', 'I2C SDA', tl('Données du bus I2C : chaque module y répond à sa propre adresse.'), o)
];
const spi = (o = {}) => [
  io('SCK', 'sck', 'SPI SCK', tl('Horloge du bus SPI, partagée par tous les modules SPI.'), o),
  io('MOSI', 'mosi', 'SPI MOSI', tl('Données de la carte vers le module.'), o),
  io('MISO', 'miso', 'SPI MISO', tl('Données du module vers la carte.'), o)
];
// Port série matériel si le module est sur ses broches, sinon SoftwareSerial.
const serialCode = (prof, p, baud) => {
  const u = prof && prof.uart, hw = u && prof.code(u.rx, prof.gpio[u.rx]) === p.TXD;
  if (!hw) return tl('SoftwareSerial liaison({0}, {1}); // (RX, TX) côté carte\nliaison.begin({2});', p.TXD, p.RXD, baud);
  // ESP32 : broches données à begin() (RX, TX), justes quelle que soit la version du cœur arduino-esp32.
  return `${u.port}.begin(${baud}${u.pins ? `, SERIAL_8N1, ${p.TXD}, ${p.RXD}` : ''});`;
};

const dht = (model, what, v, period, ds) => ({
  what,
  pins: [
    pwr('VCC', v, undefined, ds),
    io('DATA', 'io', tl('Données'), tl('Bus à un fil propre aux DHT : la carte envoie une impulsion de départ, le capteur répond par 40 bits (humidité, température, contrôle). La résistance de tirage de 10 kΩ est déjà soudée sur le module : la ligne monte à la tension du module.'), { lv5: true, idle: 1 }),
    gnd()
  ],
  notes: [tl('Une mesure toutes les {0} s au plus : lire plus souvent renvoie l’ancienne valeur.', period)],
  lib: 'DHT sensor library (Adafruit)', ma: 2.5, ds,
  code: p => `DHT dht(${p.DATA}, ${model});\n// setup() : dht.begin();\nfloat t = dht.readTemperature();\nfloat h = dht.readHumidity();`
});

const LED_VF = { 'led-red': 2.0, 'led-green': 2.2, 'led-yellow': 2.1, 'led-blue': 3.0, 'led-white': 3.0 };
const led = type => ({
  what: tl('LED 5 mm : ne laisse passer le courant que de l’anode vers la cathode, et doit toujours être protégée par une résistance.'),
  pins: [
    io('A', OUT, tl('Anode'), tl('Anode (patte longue) : reçoit le courant de la broche à travers la résistance.'), { via: 'res-220' }),
    gnd('K', tl('Cathode (patte courte, côté méplat) vers la masse.'))
  ],
  tips: prof => {
    const vf = LED_VF[type], v = prof ? prof.logic : 3.3, mA = Math.max(0, (v - vf) / 220 * 1000);
    return [tl('Courant ≈ ({0} − {1} de seuil) ÷ 220 Ω ≈ {2} mA{3}.', volts(v), volts(vf), String(mA.toFixed(1)).replace('.', DEC), mA < 3 ? tl(' : faible, la LED éclairera peu ; une résistance de 100 Ω conviendrait') : '')];
  },
  code: p => tl('pinMode({0}, OUTPUT);\ndigitalWrite({1}, HIGH); // allumée', p.A, p.A)
});

// Transistors PNP : logique inversée, et l'émetteur doit rester à la tension que la broche atteint.
const PNP_LOW = tl('Logique inversée : digitalWrite(broche, LOW) rend le transistor passant, HIGH le bloque. La sortie doit pouvoir remonter jusqu’à la tension de l’émetteur, sinon la base reste sous l’émetteur et le transistor ne se bloque jamais.');
const PNP_3V3 = tl('Sur une carte 3,3 V, ne mettez pas l’émetteur au 5 V pour une charge 5 V : la broche ne monte qu’à 3,3 V, la base reste 1,7 V sous l’émetteur et le PNP ne se bloque pas. Gardez l’émetteur à la tension logique de la carte, ou ajoutez un NPN dont le collecteur tire la base vers la masse.');
/**
 * Diode Zener (ZENERS) : cathode vers le + à travers une résistance série, anode à la masse. vin : tension d'entrée
 * de l'exemple de calcul de la résistance (10 mA dans la diode).
 */
const zener = (type, vin) => {
  const z = ZENERS[type], r = Math.round((vin - z.vz) / 0.01);
  return {
    what: tl('Diode Zener {0} (BZX55, verre DO-35) : en direct, une diode ordinaire ; montée en inverse, cathode vers le +, elle conduit dès {0} et garde cette tension à ses bornes. Elle stabilise une petite tension de référence ou protège une entrée.', volts(z.vz)),
    pins: [
      { ...nc('A', tl('Anode : vers la masse.')), role: tl('Anode') },
      { ...nc('K', tl('Cathode (côté bague noire) : vers le + à travers une résistance série, et vers ce qu’elle stabilise ou protège.')), role: tl('Cathode') }
    ],
    notes: [
      tl('Toujours une résistance en série : R = (Vin − Vz) ÷ I. Depuis {0}, pour 10 mA : R = ({1} − {2}) ÷ 0,01 A ≈ {3} Ω.', volts(vin), String(vin), String(z.vz).replace('.', DEC), String(r)),
      tl('Puissance dissipée : Vz × I, {0} mW au plus pour une BZX55 (comptez aussi le courant que la charge ne prend pas).', z.p)
    ]
  };
};

const resistor = what => ({ what: tl('{0} Pas de câblage type : elle s’insère dans un montage (limiter le courant d’une LED, tirer une entrée vers un niveau, pont diviseur).', what) });
const battery = (volt, what, notes = []) => ({
  what, volts: volt, notes,
  pins: [{ pin: '+', kind: 'vin', role: tl('Alimentation'), why: tl('Vers l’entrée de la carte qui passe par son régulateur.') }, gnd('-', tl('Masse commune avec la carte.'))]
});

/** Module MAX7219 (matrice ou chiffres) : mêmes broches, même puce ; DOUT sort vers le module suivant. */
const maxPart = (what, notes, code) => ({
  what,
  pins: [
    pwr('VCC', [4, 5.5], tl('4 à 5,5 V : la puce et les LED prennent jusqu’à 330 mA à pleine luminosité, toutes LED allumées.'), 'maximMax7219'),
    gnd(),
    io('DIN', OUT, tl('Données (DIN)'), tl('Bit entré dans le registre de 16 bits à chaque front montant de CLK (adresse puis donnée, poids fort d’abord). Sur un module chaîné, DIN vient du DOUT du module précédent.')),
    io('CS', OUT, tl('Chargement (CS / LOAD)'), tl('Le front montant recopie le mot reçu dans le registre adressé. Commun à tous les modules de la chaîne.')),
    io('CLK', OUT, tl('Horloge (CLK)'), tl('Chaque front montant fait avancer les bits d’un rang. Commune à tous les modules de la chaîne.')),
    { ...nc('DOUT', tl('Sortie des bits qui ont traversé le registre (16 fronts plus tard) : vers DIN du module suivant.')), role: tl('Sortie de chaîne (DOUT)'), drives: true },
    ...['VCC', 'GND', 'CS', 'CLK'].map(k => ({ ...nc(k + ' (2)', tl('Recopie de {0} sur le connecteur de sortie (même piste) : vers {0} du module suivant de la chaîne.', k)), role: tl('{0} vers le module suivant', k) }))
  ],
  tips: prof => (prof && prof.logic < 4 ? [tl('Sur une carte 3,3 V, le niveau haut de 3,3 V est sous le seuil du MAX7219 (3,5 V sous 5 V) : la plupart des modules l’acceptent, un adaptateur de niveau (74HCT125) le garantit.')] : []),
  notes: [...notes, tl('Courant : 40 mA par segment (résistance RSET de 10 kΩ du module), soit 320 mA quand les 8 LED d’une ligne sont allumées. Pour 4 modules ou plus, alimentez-les à part et baissez l’intensité.')],
  lib: 'LedControl / MD_MAX72XX', ma: 160, ds: 'maximMax7219',
  code
});
/** Écran TFT SPI : VCC (régulateur 3,3 V du module), entrées logiques en 3,3 V, rétroéclairage LED. */
const tftPart = (what, mosi, ds, code, lib, miso) => ({
  what,
  pins: [
    pwr('VCC', [3.3, 5.5], tl('3,3 à 5 V : le module a son régulateur 3,3 V.'), ds),
    gnd(),
    io('CS', OUT, tl('Sélection de l’écran (CS)'), tl('Sélection de l’écran sur le bus SPI, donnée au constructeur.'), { lv3: true }),
    io('RESET', OUT, tl('Remise à zéro'), tl('Remise à zéro de l’écran au démarrage. Facultative : reliée au 3,3 V, ou libre, donnez -1 au constructeur (la bibliothèque envoie alors une remise à zéro par commande).'), { lv3: true, opt: true }),
    io('DC', OUT, tl('Commande ou donnée (DC / A0)'), tl('Bas : l’octet est une commande ; haut : une donnée (couleur des points).'), { lv3: true }),
    io(mosi, 'mosi', 'SPI MOSI', tl('Données de la carte vers l’écran.'), { lv3: true }),
    io('SCK', 'sck', 'SPI SCK', tl('Horloge du bus SPI.'), { lv3: true }),
    { pin: 'LED', kind: 'pwr', v: [3, 5.5], role: tl('Rétroéclairage'), why: tl('Rétroéclairage : au 3,3 V ou au 5 V (résistance sur le module). Libre, l’écran reste sombre.'), ds },
    ...(miso ? [io('MISO', 'miso', 'SPI MISO', tl('Lecture des registres de l’écran (facultative).'), { opt: true })] : [])
  ],
  notes: [tl('Entrées logiques en 3,3 V : sur une carte 5 V (Uno, Mega), passez par un adaptateur de niveau ou des résistances en série (1 kΩ à 2,2 kΩ) ; sur un ESP32 ou un Pico, câblez directement.'), tl('Les coordonnées (0, 0) sont en haut à gauche ; setRotation(1) passe en paysage.')],
  lib, code
});

export const PARTS = {
  /* ---------- Capteurs ---------- */
  dht11: dht('DHT11', tl('Capteur numérique de température (0 à 50 °C, ±2 °C) et d’humidité (20 à 90 %).'), [3.3, 5.5], 1, 'aosongDht11'),
  dht22: dht('DHT22', tl('Capteur numérique de température (−40 à 80 °C, ±0,5 °C) et d’humidité (0 à 100 %).'), [3.3, 6], 2, 'aosongDht22'),
  hcsr04: {
    what: tl('Télémètre à ultrasons : mesure une distance de 2 cm à 4 m grâce au temps de vol d’une salve à 40 kHz.'),
    pins: [
      pwr('VCC', [4.5, 5.5], tl('Le module ne fonctionne correctement qu’en 5 V.'), 'elecfreaksHcsr04'),
      io('TRIG', OUT, tl('Déclenchement'), tl('Une impulsion de 10 µs lance une salve de 8 ultrasons.')),
      io('ECHO', IN, tl('Écho'), tl('Reste à l’état haut pendant l’aller-retour du son : distance (cm) = durée (µs) ÷ 58.'), { lv5: true }),
      gnd()
    ],
    ma: 15, ds: 'elecfreaksHcsr04',
    code: p => `digitalWrite(${p.TRIG}, HIGH); delayMicroseconds(10); digitalWrite(${p.TRIG}, LOW);\nlong us = pulseIn(${p.ECHO}, HIGH, 30000);\nfloat cm = us / 58.0;`
  },
  pir: {
    what: tl('Détecteur de mouvement infrarouge passif (HC-SR501) : réagit à la chaleur d’un corps qui se déplace, jusqu’à 7 m.'),
    pins: [
      pwr('VCC', [4.5, 20], tl('Le module a son propre régulateur 3,3 V : il lui faut au moins 4,5 V.'), 'rapidHcsr501'),
      io('OUT', IN, tl('Détection'), tl('Passe à 3,3 V quand un mouvement est détecté et y reste pendant la temporisation (potentiomètre Tx).')),
      gnd()
    ],
    notes: [tl('Laissez-le se stabiliser 30 à 60 s après la mise sous tension.')],
    code: p => `pinMode(${p.OUT}, INPUT);\nbool mouvement = digitalRead(${p.OUT}) == HIGH;`
  },
  ldr: {
    what: tl('Module photorésistance : la résistance de la cellule baisse quand la lumière augmente. Sortie analogique AO et sortie tout-ou-rien DO.'),
    pins: [
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte, AO ne dépasse jamais la plage de l’ADC.')),
      gnd(),
      io('DO', IN, tl('Seuil'), tl('Sortie du comparateur : bascule quand la lumière franchit le seuil réglé par le potentiomètre bleu. Facultative quand AO est lue.'), { opt: true }),
      io('AO', 'adc', tl('Analogique'), tl('Pont diviseur photorésistance + 10 kΩ : plus il y a de lumière, plus la tension (et la valeur lue) baisse.'))
    ],
    ma: 5, ds: 'tiLm393',
    code: p => `int lumiere = analogRead(${p.AO});`
  },
  soil: {
    what: tl('Sonde d’humidité du sol capacitive : aucune électrode à nu, donc pas de corrosion.'),
    pins: [gnd(), pwr('VCC', [3.3, 5.5], undefined, 'dfrobotSen0193'), io('AOUT', 'adc', tl('Analogique'), tl('Environ 3 V dans l’air sec, 1,2 V dans l’eau, quelle que soit l’alimentation (régulateur 3,3 V sur la sonde v1.2) : sans danger pour une carte 3,3 V. Relevez la valeur à l’air libre (sec) et dans un verre d’eau (mouillé) pour étalonner.'))],
    ma: 5, ds: 'dfrobotSen0193',
    code: p => `int brut = analogRead(${p.AOUT});\nint pourcent = map(brut, SEC, MOUILLE, 0, 100);`
  },
  mq2: {
    what: tl('Capteur de gaz combustibles et de fumée (GPL, méthane, hydrogène). Un filament chauffe la couche sensible.'),
    pins: [
      pwr('VCC', [4.8, 5.2], tl('Le filament chauffant demande 5 V et environ 150 mA.'), 'mq2'),
      gnd(),
      io('DO', IN, tl('Alarme'), tl('Passe à l’état bas quand la concentration dépasse le seuil réglé sur le module ; au repos, tirée à la tension du module.'), { opt: true, lv5: true, idle: 1 }),
      io('AO', 'adc', tl('Analogique'), tl('Tension qui monte avec la concentration de gaz.'), { lv5: true })
    ],
    ma: 150, ds: 'mq2',
    notes: [tl('Comptez 1 à 2 minutes de préchauffage (24 h la toute première fois) avant des mesures stables.')],
    code: p => `int gaz = analogRead(${p.AO});`
  },
  'tilt-sw': {
    what: tl('Capteur d’inclinaison à bille (KY-020, SW-520D) : une petite bille ferme le contact quand le capteur est droit et l’ouvre quand on le penche.'),
    pins: [
      io('S', IN, tl('Inclinaison'), tl('LOW quand le capteur est droit (contact fermé), HIGH quand il est penché de plus de 45° environ (la résistance du module tire S vers le haut).')),
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : S reste dans la plage de ses entrées.')),
      gnd()
    ],
    notes: [tl('Tout-ou-rien : il ne mesure pas un angle (pour un angle, prenez un MPU6050). La bille rebondit : filtrez les changements trop rapides.')],
    code: p => `pinMode(${p.S}, INPUT);\nbool penche = digitalRead(${p.S}) == HIGH;`
  },
  hall: {
    what: tl('Capteur à effet Hall (KY-003, A3144) : détecte la présence d’un aimant, sans contact.'),
    pins: [
      io('S', IN, tl('Aimant'), tl('Sortie à collecteur ouvert tirée vers le haut sur le module : LOW quand un pôle sud d’aimant s’approche, HIGH sinon.'), { idle: 1 }),
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : S reste dans la plage de ses entrées.')),
      gnd()
    ],
    notes: [tl('Il ne réagit qu’à un pôle de l’aimant (le sud) : retournez l’aimant s’il ne détecte rien.')],
    code: p => `pinMode(${p.S}, INPUT);\nbool aimant = digitalRead(${p.S}) == LOW;`
  },
  flame: {
    what: tl('Capteur de flamme (KY-026) : une photodiode infrarouge sensible à la lumière d’une flamme (760 à 1100 nm). Sortie analogique AO et sortie tout-ou-rien DO.'),
    pins: [
      io('AO', 'adc', tl('Analogique'), tl('Tension qui baisse quand la flamme est plus forte ou plus proche.'), { opt: true }),
      gnd(),
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte, AO ne dépasse jamais la plage de l’ADC.')),
      io('DO', IN, tl('Alarme'), tl('Sortie du comparateur : passe à LOW quand une flamme dépasse le seuil réglé par le potentiomètre.'))
    ],
    ma: 5, ds: 'tiLm393',
    notes: [tl('La lumière du soleil contient beaucoup d’infrarouge : elle peut déclencher le capteur. Faites les essais à l’intérieur.')],
    code: p => `pinMode(${p.DO}, INPUT);\nbool flamme = digitalRead(${p.DO}) == LOW;`
  },
  rain: {
    what: tl('Capteur de pluie (FC-37) : une plaque à pistes croisées reliée à un petit module comparateur. L’eau sur la plaque fait baisser sa résistance.'),
    pins: [
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte, AO ne dépasse jamais la plage de l’ADC.')),
      gnd(),
      io('DO', IN, tl('Pluie'), tl('Sortie du comparateur : passe à LOW quand la plaque est mouillée au-delà du seuil réglé par le potentiomètre.')),
      io('AO', 'adc', tl('Analogique'), tl('Tension qui baisse quand la plaque est plus mouillée.'), { opt: true })
    ],
    ma: 5, ds: 'tiLm393',
    notes: [tl('Alimentée en permanence, la plaque se corrode vite : n’alimentez le module (par une broche) que le temps d’une mesure.')],
    code: p => `pinMode(${p.DO}, INPUT);\nbool pluie = digitalRead(${p.DO}) == LOW;`
  },
  water: {
    what: tl('Capteur de niveau d’eau : des pistes de cuivre parallèles ; plus elles trempent, plus la tension de sortie monte.'),
    pins: [
      io('S', 'adc', tl('Analogique'), tl('0 V au sec, jusqu’à environ 70 % de l’alimentation quand la partie cuivrée est entièrement immergée.')),
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : S reste dans la plage de l’ADC.')),
      gnd()
    ],
    notes: [tl('Ne plongez que la partie cuivrée, jamais les composants. Alimentée en permanence, la sonde se corrode : alimentez-la par une broche, le temps d’une mesure.')],
    code: p => `int niveau = analogRead(${p.S});`
  },
  irobst: {
    what: tl('Capteur d’obstacle infrarouge (FC-51) : une LED infrarouge éclaire devant elle, une photodiode reçoit la lumière renvoyée par un obstacle proche.'),
    pins: [
      io('OUT', IN, tl('Obstacle'), tl('LOW quand un obstacle est détecté (de 2 à 30 cm selon le potentiomètre et la couleur de l’objet), HIGH sinon.'), { idle: 1 }),
      gnd(),
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : OUT reste dans la plage de ses entrées.'))
    ],
    ma: 5, ds: 'tiLm393',
    notes: [tl('Un objet noir renvoie peu d’infrarouge : il est vu de moins loin. Le soleil peut l’éblouir.')],
    code: p => `pinMode(${p.OUT}, INPUT);\nbool obstacle = digitalRead(${p.OUT}) == LOW;`
  },
  line: {
    what: tl('Capteur de ligne (TCRT5000) : une LED infrarouge et un phototransistor regardent le sol de près ; une ligne noire renvoie peu de lumière. Pour les robots suiveurs de ligne.'),
    pins: [
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : ses sorties restent dans la plage de la carte.')),
      gnd(),
      io('DO', IN, tl('Ligne'), tl('HIGH au-dessus d’une ligne noire (peu de lumière renvoyée), LOW sur un fond clair.')),
      io('AO', 'adc', tl('Analogique'), tl('Tension qui monte quand la surface est plus sombre.'), { opt: true })
    ],
    ma: 5, ds: 'tiLm393',
    notes: [tl('Il voit de 1 à 8 mm : placez-le au ras du sol. Réglez le seuil avec le potentiomètre au-dessus de la ligne.')],
    code: p => `pinMode(${p.DO}, INPUT);\nbool surLaLigne = digitalRead(${p.DO}) == HIGH;`
  },
  lm35: {
    what: tl('Capteur de température LM35 : une tension proportionnelle à la température, 10 mV par °C. Un seul calcul, aucune bibliothèque.'),
    pins: [
      pwr('VS', [4, 30], tl('Il lui faut au moins 4 V : en 3,3 V, la tension de sortie n’est plus juste.'), 'tiLm35'),
      io('VOUT', 'adc', tl('Analogique'), tl('10 mV par °C : 0,25 V à 25 °C. Température = tension × 100.')),
      gnd()
    ],
    ma: 0.06, ds: 'tiLm35',
    notes: [tl('Sur une carte 3,3 V, alimentez VS par le 5 V (VIN, VBUS) : VOUT ne dépasse 1,5 V qu’au-delà de 150 °C, sans risque pour l’entrée.')],
    code: p => `float temperature = analogRead(${p.VOUT}) * (5.0 / 1023.0) * 100.0; // 10 mV par °C`
  },
  shock: {
    what: tl('Capteur de vibration (SW-420) : un ressort dans un petit tube s’ouvre et se ferme quand le capteur est secoué. Sortie tout-ou-rien.'),
    pins: [
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : DO reste dans la plage de ses entrées.')),
      gnd(),
      io('DO', IN, tl('Vibration'), tl('HIGH pendant une secousse (le contact s’ouvre), LOW au repos.'))
    ],
    ma: 5, ds: 'tiLm393',
    notes: [tl('Il détecte des chocs et des secousses, pas un niveau de vibration : comptez les fronts pour estimer l’agitation.')],
    code: p => `pinMode(${p.DO}, INPUT);\nbool secousse = digitalRead(${p.DO}) == HIGH;`
  },
  laser: {
    what: tl('Module laser (KY-008) : une diode laser rouge de 5 mW (650 nm) avec sa résistance, commandée directement par une sortie.'),
    pins: [io('S', OUT, tl('Commande'), tl('HIGH : le laser s’allume. La résistance du module limite le courant.')), gnd()],
    notes: [tl('Ne visez jamais un œil, même un instant, ni une surface qui renvoie le faisceau.')],
    code: p => `pinMode(${p.S}, OUTPUT);\ndigitalWrite(${p.S}, HIGH); // laser allumé`
  },
  traffic: {
    what: tl('Module feu tricolore : trois LED (rouge, orange, verte) avec leurs résistances, sur une petite carte. Une sortie par couleur.'),
    pins: [
      io('R', OUT, tl('Rouge'), tl('HIGH allume la LED rouge (résistance déjà sur le module).')),
      io('Y', OUT, tl('Orange'), tl('HIGH allume la LED orange.')),
      io('G', OUT, tl('Vert'), tl('HIGH allume la LED verte.')),
      gnd()
    ],
    code: p => `pinMode(${p.R}, OUTPUT); pinMode(${p.Y}, OUTPUT); pinMode(${p.G}, OUTPUT);\ndigitalWrite(${p.G}, HIGH); // vert`
  },
  ds18b20: {
    what: tl('Sonde de température numérique 1-Wire (−55 à 125 °C, ±0,5 °C). Plusieurs sondes peuvent partager le même fil.'),
    pins: [
      gnd(),
      io('DQ', 'io', tl('Données 1-Wire'), tl('Bus 1-Wire : la sonde tire la ligne vers le bas pour répondre. Une résistance de 4,7 kΩ vers VDD ramène la ligne au niveau haut ; sans elle, la lecture renvoie −127 °C.'), { pull: 'res-4k7', lv5: true }),
      pwr('VDD', [3.0, 5.5], undefined, 'maximDs18b20')
    ],
    pullTo: 'VDD', ma: 1.5, ds: 'maximDs18b20',
    lib: 'OneWire + DallasTemperature',
    code: p => `OneWire bus(${p.DQ});\nDallasTemperature sondes(&bus);\n// loop() :\nsondes.requestTemperatures();\nfloat t = sondes.getTempCByIndex(0);`
  },
  bmp280: {
    what: tl('Capteur de pression atmosphérique (300 à 1100 hPa) et de température, en I2C.'),
    pins: [
      pwr('VCC', [1.8, 3.6], tl('Puce 3,3 V : le 5 V la détruirait.'), 'boschBmp280'),
      gnd(),
      ...i2c({ lv3: true }),
      nc('CSB', tl('Laissée libre : tirée au niveau haut sur le module, elle sélectionne le mode I2C.')),
      { pin: 'SDO', kind: 'gnd', role: tl('Adresse'), why: tl('À la masse, elle fixe l’adresse I2C à 0x76 (0x77 si elle était reliée à 3,3 V).') }
    ],
    lib: 'Adafruit BMP280', ma: 1.12, ds: 'boschBmp280',
    code: () => `Adafruit_BMP280 bmp;\n// setup() : bmp.begin(0x76);\nfloat t = bmp.readTemperature();\nfloat hPa = bmp.readPressure() / 100;`
  },
  bme280: {
    what: tl('Capteur météo BME280 : température, humidité de l’air et pression atmosphérique, en I2C. Le BMP280 avec l’humidité en plus.'),
    pins: [
      pwr('VCC', [1.71, 3.6], tl('Puce 3,3 V : le 5 V la détruirait.'), 'boschBme280'),
      gnd(),
      ...i2c({ lv3: true }),
      nc('CSB', tl('Laissée libre : tirée au niveau haut sur le module, elle sélectionne le mode I2C.')),
      { pin: 'SDO', kind: 'gnd', role: tl('Adresse'), why: tl('À la masse, elle fixe l’adresse I2C à 0x76 (0x77 si elle était reliée à 3,3 V).') }
    ],
    lib: 'Adafruit BME280', ma: 0.714, ds: 'boschBme280',
    notes: [tl('Beaucoup de modules vendus « BME280 » portent en fait un BMP280 (sans humidité) : sensorID() rend 0x60 pour un vrai BME280, 0x58 pour un BMP280.')],
    code: () => `Adafruit_BME280 bme;\n// setup() : bme.begin(0x76);\nfloat t = bme.readTemperature();\nfloat h = bme.readHumidity();\nfloat hPa = bme.readPressure() / 100;`
  },
  bh1750: {
    what: tl('Capteur de lumière BH1750 (module GY-302) : mesure l’éclairement en lux, de 1 à 65 535 lx, en I2C. Plus juste qu’une photorésistance.'),
    pins: [
      pwr('VCC', 'logic', tl('Le module a son régulateur 3,3 V et ses résistances de tirage : alimenté à la tension logique de la carte, le bus I2C reste à son niveau.')),
      gnd(),
      ...i2c(),
      { pin: 'ADDR', kind: 'gnd', role: tl('Adresse'), why: tl('À la masse, elle fixe l’adresse I2C à 0x23 (0x5C si elle était reliée à VCC).') }
    ],
    lib: 'BH1750',
    code: () => `BH1750 lux1;\n// setup() : Wire.begin(); lux1.begin();\nfloat lux = lux1.readLightLevel();`
  },
  /* Capteurs I2C (sim/i2csensors.js) */
  vl53l0x: {
    what: tl('Capteur de distance VL53L0X (module GY-VL53L0XV2) : mesure le temps de vol d’un laser infrarouge invisible, de 3 cm à 2 m, au millimètre, en I2C (adresse 0x29).'),
    pins: [
      pwr('VIN', [2.6, 5.5], tl('2,6 à 5,5 V : le module a son régulateur 2,8 V.'), 'stVl53l0x'),
      gnd(),
      ...i2c({ lv3: true }),
      io('GPIO1', IN, tl('Interruption'), tl('Passe à LOW quand une mesure est prête : facultative.'), { opt: true }),
      io('XSHUT', OUT, tl('Arrêt'), tl('À LOW, la puce s’éteint. Libre, elle reste allumée (tirée au niveau haut sur le module). Avec plusieurs capteurs, on les allume un par un pour leur donner chacun une adresse.'), { opt: true, lv3: true })
    ],
    notes: [tl('Au-delà de sa portée (2 m dans la simulation), la mesure rend 8190 mm et RangeStatus vaut 4 : ignorez-la.'), tl('Même adresse 0x29 que le TCS34725 : sur le même bus, l’un des deux doit changer d’adresse (setAddress) après avoir tenu l’autre éteint.')],
    lib: 'Adafruit_VL53L0X', ma: 19, ds: 'stVl53l0x',
    code: () => tl('Adafruit_VL53L0X lox;\n// setup() : if (!lox.begin()) Serial.println("VL53L0X absent");\nVL53L0X_RangingMeasurementData_t mesure;\nlox.rangingTest(&mesure, false);\nif (mesure.RangeStatus != 4) Serial.println(mesure.RangeMilliMeter); // mm')
  },
  max30102: {
    what: tl('Oxymètre de pouls MAX30102 : une LED rouge et une LED infrarouge éclairent le doigt, une photodiode mesure la lumière renvoyée. Le pouls et la saturation en oxygène du sang se calculent à partir de ces mesures. En I2C (adresse 0x57).'),
    pins: [
      pwr('VIN', [3.0, 5.5], tl('3 à 5,5 V : le module a ses régulateurs 1,8 V (puce) et 3,3 V (LED).'), 'maximMax30102'),
      ...i2c({ lv3: true }),
      io('INT', IN, tl('Interruption'), tl('Passe à LOW quand des mesures attendent dans la FIFO : facultative.'), { opt: true }),
      nc('IRD', tl('Cathode de la LED infrarouge, pilotée par la puce : laissée libre.')),
      nc('RD', tl('Cathode de la LED rouge, pilotée par la puce : laissée libre.')),
      gnd()
    ],
    notes: [tl('Sur beaucoup de modules violets, SDA et SCL sont tirées à 1,8 V : une carte 5 V ne lit pas toujours ce niveau. Une carte 3,3 V (ESP32, Pico) ou un adaptateur de niveau évite le problème.'), tl('Posez le doigt sans appuyer : une pression trop forte chasse le sang et le pouls disparaît. Projet d’apprentissage, pas un appareil médical.')],
    lib: 'SparkFun MAX3010x', ma: 20, ds: 'maximMax30102',
    code: () => tl('MAX30105 capteur;\n// setup() : capteur.begin(Wire, I2C_SPEED_FAST); capteur.setup();\nlong ir = capteur.getIR();\nif (checkForBeat(ir)) Serial.println("battement"); // #include "heartRate.h"')
  },
  tcs34725: {
    what: tl('Capteur de couleur TCS34725 : quatre photodiodes filtrées (rouge, vert, bleu, sans filtre) sous un filtre infrarouge, et une LED blanche pour éclairer l’objet. En I2C (adresse 0x29).'),
    pins: [
      io('LED', OUT, tl('LED d’éclairage'), tl('Libre, la LED blanche est allumée ; à LOW, elle s’éteint : facultative.'), { opt: true }),
      io('INT', IN, tl('Interruption'), tl('Passe à LOW quand la mesure sort des seuils réglés : facultative.'), { opt: true }),
      ...i2c({ lv3: true }),
      nc('3V3', tl('Sortie 3,3 V du régulateur du module : rien à y relier.')),
      gnd(),
      pwr('VIN', [3.0, 5.5], tl('3 à 5,5 V : le module a son régulateur 3,3 V.'), 'amsTcs34725')
    ],
    notes: [tl('Même adresse 0x29 que le VL53L0X : les deux ne peuvent pas partager un bus I2C sans changer l’adresse du VL53L0X.'), tl('Dans la simulation, la couleur et l’éclairement se règlent dans l’onglet Simulation (sélecteur de couleur).')],
    lib: 'Adafruit TCS34725', ma: 20, ds: 'amsTcs34725',
    code: () => tl('Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_614MS, TCS34725_GAIN_1X);\n// setup() : if (!tcs.begin()) Serial.println("TCS34725 absent");\nuint16_t r, g, b, c;\ntcs.getRawData(&r, &g, &b, &c);\nSerial.println(tcs.calculateColorTemperature_dn40(r, g, b, c));')
  },
  ccs811: {
    what: tl('Capteur de qualité de l’air CCS811 (module CJMCU-811) : un capteur de gaz chauffé et un micrologiciel qui estiment l’équivalent CO₂ (400 à 8192 ppm) et les composés organiques volatils (0 à 1187 ppb). En I2C (adresse 0x5A).'),
    pins: [
      pwr('VCC', [1.8, 3.3], tl('1,8 à 3,3 V (3,6 V au plus) : pas de régulateur sur ce module, le 5 V détruit la puce.'), 'sciosenseCcs811'),
      gnd(),
      ...i2c({ lv3: true }),
      { pin: 'WAKE', kind: 'gnd', role: tl('Réveil'), why: tl('À la masse (ou à LOW), la puce écoute le bus I2C ; en l’air ou à HIGH, elle ne répond pas.') },
      io('INT', IN, tl('Interruption'), tl('Passe à LOW quand une mesure est prête : facultative.'), { opt: true }),
      nc('RST', tl('Remise à zéro, active à LOW : laissée libre.')),
      { pin: 'ADDR', kind: 'gnd', role: tl('Adresse'), why: tl('À la masse, adresse 0x5A ; au VCC, 0x5B.') }
    ],
    notes: [tl('La vraie puce a besoin de 20 minutes de chauffe avant des valeurs justes, et de 48 heures la première fois.'), tl('setEnvironmentalData(humidité, température) améliore la compensation, avec les mesures d’un autre capteur.')],
    lib: 'Adafruit CCS811', ma: 30, ds: 'sciosenseCcs811',
    code: () => tl('Adafruit_CCS811 ccs;\n// setup() : if (!ccs.begin()) Serial.println("CCS811 absent");\nif (ccs.available() && !ccs.readData()) {\n  Serial.print(ccs.geteCO2()); Serial.print(" ppm, ");\n  Serial.print(ccs.getTVOC()); Serial.println(" ppb");\n}')
  },
  bme680: {
    what: tl('Capteur d’environnement BME680 (module GY-BME680) : température, humidité, pression et résistance d’un capteur de gaz chauffé, qui baisse quand l’air se charge en composés volatils. En I2C (adresse 0x77).'),
    pins: [
      pwr('VCC', [3.0, 5.5], tl('3 à 5,5 V : le module a son régulateur 3,3 V.'), 'boschBme680'),
      gnd(),
      ...i2c({ lv3: true }),
      nc('SDO', tl('Libre (tirée au VCC sur le module) : adresse 0x77. À la masse : 0x76.')),
      nc('CS', tl('Laissée libre : tirée au niveau haut sur le module, elle sélectionne le mode I2C.'))
    ],
    notes: [tl('Chaque mesure chauffe le capteur de gaz (320 °C pendant 150 ms avec setGasHeater(320, 150)) : performReading() dure environ 0,2 s.'), tl('La résistance du gaz se compare à elle-même dans le temps (plus basse = air plus chargé) : ce n’est pas une concentration.')],
    lib: 'Adafruit BME680', ma: 12, ds: 'boschBme680',
    code: () => tl('Adafruit_BME680 bme;\n// setup() : if (!bme.begin()) Serial.println("BME680 absent");\nif (bme.performReading()) {\n  Serial.println(bme.temperature);\n  Serial.println(bme.gas_resistance / 1000.0); // kΩ\n}')
  },
  hx711: {
    what: tl('Balance : un capteur de force (barre de 5 kg) et son amplificateur HX711, un convertisseur 24 bits. Mesure une masse, après étalonnage.'),
    pins: [
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : DT reste dans la plage de ses entrées.')),
      gnd(),
      io('DT', IN, tl('Données'), tl('Sortie série du HX711 : passe au niveau bas quand une mesure est prête (10 par seconde), puis donne ses 24 bits au rythme de SCK.')),
      io('SCK', OUT, tl('Horloge'), tl('Horloge envoyée par la carte : 24 impulsions pour lire la mesure, une 25ᵉ pour choisir le gain 128. Tenue au niveau haut plus de 60 µs, elle met le HX711 en veille.'))
    ],
    lib: 'HX711 Arduino Library',
    notes: [tl('Étalonnage : posez une masse connue, puis réglez set_scale() pour que get_units() l’affiche. Avec cette barre de 5 kg, environ 430 coups par gramme.')],
    code: p => `HX711 balance;\n// setup() : balance.begin(${p.DT}, ${p.SCK}); balance.set_scale(430.0); balance.tare();\nif (balance.is_ready()) { float grammes = balance.get_units(1); }`
  },
  acs712: {
    what: tl('Capteur de courant ACS712 (effet Hall) : le courant à mesurer traverse le module par IP+ et IP−, isolé de la carte ; OUT donne une tension proportionnelle, VCC/2 à 0 A. Versions 5 A, 20 A et 30 A.'),
    pins: [
      pwr('VCC', [4.5, 5.5], tl('5 V : la sensibilité de la fiche (185, 100 ou 66 mV/A) est donnée sous 5 V, et la sortie suit VCC.'), 'allegroAcs712'),
      io('OUT', 'adc', tl('Sortie analogique'), tl('Tension VCC/2 (2,5 V) à 0 A, plus la sensibilité × le courant : à lire avec analogRead(). Sur une carte 3,3 V, elle peut dépasser 3,3 V : pont diviseur.'), { lv5: true }),
      gnd(),
      { pin: 'IP+', kind: 'contact', role: tl('Primaire +'), why: tl('Côté puissance : le courant entre par IP+ (bornier à vis), traverse 1,2 mΩ et ressort par IP−. Le montage à mesurer passe en série par le module, isolé de la carte.') },
      { pin: 'IP-', kind: 'contact', role: tl('Primaire −'), why: tl('Sortie du courant mesuré, vers la charge. Courant de IP+ vers IP− : la sortie monte au-dessus de VCC/2 ; dans l’autre sens, elle descend.') }
    ],
    notes: [tl('Choisissez la version du module dans le panneau du composant (5 A, 20 A ou 30 A) : la sensibilité et la plage en dépendent.'), tl('Sans circuit dans le primaire, la simulation prend le courant réglé dans l’onglet Simulation (« Courant mesuré »).')],
    ma: 10, ds: 'allegroAcs712',
    code: p => tl('// ACS712 5 A : 185 mV/A, 2,5 V à 0 A (carte 5 V, ADC 10 bits)\nfloat tension = analogRead({0}) * 5.0 / 1023.0;\nfloat courant = (tension - 2.5) / 0.185;\nSerial.println(courant, 2);', p.OUT)
  },
  ttp223: {
    what: tl('Bouton tactile capacitif TTP223 : il détecte un doigt posé sur sa surface, sans pièce mobile.'),
    pins: [
      gnd(),
      pwr('VCC', 'logic', tl('Alimenté à la tension logique de la carte : SIG reste dans la plage de ses entrées.')),
      io('SIG', IN, tl('Contact'), tl('HIGH tant qu’un doigt touche la surface, LOW sinon (réglage d’usine : pastilles A et B ouvertes).'))
    ],
    notes: [tl('Il se règle seul à la mise sous tension : ne touchez pas la surface pendant la première demi-seconde.')],
    code: p => `pinMode(${p.SIG}, INPUT);\nbool touche = digitalRead(${p.SIG}) == HIGH;`
  },
  rcwl0516: {
    what: tl('Détecteur de mouvement radar RCWL-0516 : une onde de 3,2 GHz traverse le plastique et les cloisons fines ; il voit un mouvement jusqu’à 5 à 7 m.'),
    pins: [
      nc('3V3', tl('Sortie 3,3 V du régulateur du module : laissée libre.')),
      gnd(),
      io('OUT', IN, tl('Détection'), tl('Passe à 3,3 V pendant environ 2 s à chaque mouvement détecté.')),
      pwr('VIN', [4, 28], tl('Le module a son propre régulateur 3,3 V : il lui faut au moins 4 V.'), 'rcwl0516'),
      nc('CDS', tl('Pour une photorésistance facultative (le module ne détecte alors que dans le noir) : laissée libre.'))
    ],
    notes: [tl('Il voit aussi à travers une boîte en plastique, et réagit à tout ce qui bouge : ventilateur, rideau, branche d’arbre.')],
    code: p => `pinMode(${p.OUT}, INPUT);\nbool mouvement = digitalRead(${p.OUT}) == HIGH;`
  },
  mq135: {
    what: tl('Capteur de qualité de l’air MQ-135 : réagit à l’ammoniac, aux oxydes d’azote, à l’alcool, au benzène, à la fumée et au CO₂. Un filament chauffe la couche sensible.'),
    pins: [
      pwr('VCC', [4.9, 5.1], tl('Le filament chauffant demande 5 V et environ 170 mA.'), 'winsenMq135'),
      gnd(),
      io('DO', IN, tl('Alarme'), tl('Passe à l’état bas quand la pollution dépasse le seuil réglé sur le module ; au repos, tirée à la tension du module.'), { opt: true, lv5: true, idle: 1 }),
      io('AO', 'adc', tl('Analogique'), tl('Tension qui monte quand l’air est plus pollué.'), { lv5: true })
    ],
    ma: 175, ds: 'winsenMq135',
    notes: [tl('Il indique une tendance (air plus ou moins pollué), pas une concentration exacte de CO₂ : pour cela, il faut un capteur NDIR. Préchauffage : 24 h la première fois, quelques minutes ensuite.')],
    code: p => `int air = analogRead(${p.AO});`
  },
  mpu6050: {
    what: tl('Accéléromètre et gyroscope 3 axes (module GY-521), en I2C : mesure l’inclinaison et les rotations.'),
    pins: [
      pwr('VCC', [3.3, 5], tl('Le module GY-521 a un régulateur 3,3 V intégré.'), 'invensenseMpu6050'),
      gnd(), ...i2c(),
      nc('XDA', tl('Bus I2C auxiliaire pour un magnétomètre externe : inutile ici.')),
      nc('XCL', tl('Bus I2C auxiliaire pour un magnétomètre externe : inutile ici.')),
      nc('AD0', tl('Libre (tirée à la masse sur le module) : adresse 0x68. Reliée à 3,3 V : 0x69.')),
      io('INT', IN, tl('Interruption'), tl('Signale qu’une mesure est prête : utile seulement pour un code par interruptions.'), { opt: true })
    ],
    lib: 'Adafruit MPU6050',
    ma: 3.9, ds: 'invensenseMpu6050',
    code: () => `Adafruit_MPU6050 mpu;\n// setup() : mpu.begin();\nsensors_event_t a, g, temp;\nmpu.getEvent(&a, &g, &temp);`
  },
  sound: {
    what: tl('Module microphone à électret avec comparateur : AO suit le son, DO bascule au-delà d’un seuil.'),
    pins: [
      io('AO', 'adc', tl('Analogique'), tl('Tension centrée sur la moitié de l’alimentation, qui oscille avec le son.')),
      gnd(), pwr('VCC', 'logic'),
      io('DO', IN, tl('Seuil'), tl('Passe à l’état haut quand le son dépasse le seuil réglé sur le module.'), { opt: true, lv5: true })
    ],
    ma: 5, ds: 'tiLm393',
    code: p => `int son = analogRead(${p.AO});`
  },

  /* ---------- Entrées ---------- */
  button: {
    what: tl('Bouton poussoir : relie ses deux pattes tant qu’on appuie.'),
    pins: [
      io('1', 'pullup', tl('Entrée'), tl('Lue avec la résistance de tirage interne (INPUT_PULLUP) : HIGH au repos, LOW quand on appuie. Aucune résistance externe nécessaire.'), { switch: true }),
      gnd('2', tl('Quand on appuie, ferme le circuit vers la masse et fait passer l’entrée à LOW.'))
    ],
    code: p => `pinMode(${p['1']}, INPUT_PULLUP);\nbool appuye = digitalRead(${p['1']}) == LOW;`
  },
  pot: {
    what: tl('Potentiomètre 10 kΩ : le curseur délivre une tension proportionnelle à sa position.'),
    pins: [
      gnd('1', tl('Une extrémité de la piste à la masse.')),
      io('W', 'adc', tl('Curseur'), tl('Tension entre 0 V et la tension d’alimentation selon la position du bouton.')),
      { ...pwr('3', 'logic', tl('L’autre extrémité à la tension logique de la carte, jamais plus : l’ADC ne doit pas recevoir plus que sa tension de référence.')), role: tl('Référence') }
    ],
    code: p => `int position = analogRead(${p.W});`
  },
  joystick: {
    what: tl('Joystick analogique deux axes (deux potentiomètres) avec un bouton poussoir.'),
    pins: [
      gnd(),
      pwr('+5V', 'logic', tl('Malgré l’étiquette, alimentez à la tension logique de la carte : sur une carte 3,3 V, VRx et VRy dépasseraient sinon la plage de l’ADC.')),
      io('VRx', 'adc', tl('Axe X'), tl('Position horizontale : la moitié de l’alimentation au centre.')),
      io('VRy', 'adc', tl('Axe Y'), tl('Position verticale : la moitié de l’alimentation au centre.')),
      io('SW', 'pullup', tl('Bouton'), tl('Bouton du manche : il relie la broche à la masse, à lire avec INPUT_PULLUP.'), { switch: true })
    ],
    code: p => `int x = analogRead(${p.VRx}), y = analogRead(${p.VRy});\npinMode(${p.SW}, INPUT_PULLUP);`
  },
  ir: {
    what: tl('Récepteur infrarouge 38 kHz (VS1838B) pour télécommandes.'),
    pins: [io('OUT', IN, tl('Signal'), tl('Trames de la télécommande déjà démodulées : la bibliothèque IRremote les décode. Au repos à l’état haut, à la tension du module.'), { lv5: true, idle: 1 }), gnd(), pwr('VCC', [2.7, 5.5], undefined, 'vs1838b')],
    ma: 1.5, ds: 'vs1838b',
    lib: 'IRremote',
    code: p => `// setup() : IrReceiver.begin(${p.OUT});\nif (IrReceiver.decode()) {\n  Serial.println(IrReceiver.decodedIRData.command, HEX); // 0x45 : CH−\n  IrReceiver.resume();\n}`
  },
  keypad: {
    what: tl('Clavier matriciel 4×4 : 16 touches sur 8 fils, 4 lignes (R1 à R4) et 4 colonnes (C1 à C4). Une touche appuyée relie sa ligne à sa colonne.'),
    pins: [
      ...['R1', 'R2', 'R3', 'R4'].map(k => io(k, 'pullup', tl('Ligne'), tl('Ligne : lue avec la résistance de tirage interne (INPUT_PULLUP). Elle passe à LOW quand on appuie sur une touche de la colonne en cours de balayage.'))),
      ...['C1', 'C2', 'C3', 'C4'].map(k => io(k, OUT, tl('Colonne'), tl('Colonne : la bibliothèque Keypad la met à LOW à son tour pour balayer le clavier ; le reste du temps, elle reste en entrée.')))
    ],
    lib: 'Keypad',
    code: p => `char touches[4][4] = {{'1','2','3','A'}, {'4','5','6','B'}, {'7','8','9','C'}, {'*','0','#','D'}};\nbyte lignes[4] = {${p.R1}, ${p.R2}, ${p.R3}, ${p.R4}};\nbyte colonnes[4] = {${p.C1}, ${p.C2}, ${p.C3}, ${p.C4}};\nKeypad clavier = Keypad(makeKeymap(touches), lignes, colonnes, 4, 4);\n// loop() : char t = clavier.getKey(); if (t) Serial.println(t);`
  },
  ky040: {
    what: tl('Encodeur rotatif KY-040 : 20 crans par tour, deux signaux en quadrature (CLK et DT) dont l’ordre donne le sens de rotation, et un bouton sur l’axe (SW).'),
    pins: [
      io('CLK', IN, tl('Signal A'), tl('Sortie A (CLK) : tirée au niveau haut par le module (10 kΩ), elle change deux fois par cran. Sur l’Uno, mettez-la sur D2 ou D3 pour l’interruption.'), { lv5: true, idle: 1 }),
      io('DT', IN, tl('Signal B'), tl('Sortie B (DT) : décalée d’un quart de période sur CLK ; son niveau au moment où CLK change donne le sens.'), { lv5: true, idle: 1 }),
      io('SW', 'pullup', tl('Bouton'), tl('Bouton de l’axe : il relie la broche à la masse quand on appuie. Lisez-le avec INPUT_PULLUP (la résistance de tirage de SW manque sur beaucoup de modules).'), { switch: true, opt: true }),
      pwr('+', 'logic', tl('À la tension logique de la carte : les résistances de tirage du module ramènent CLK et DT à cette tension.')),
      gnd()
    ],
    notes: [tl('Sens horaire : CLK change avant DT. Au repos, sur un cran, CLK et DT sont au niveau haut.'),
      tl('Bibliothèque Encoder : 4 fronts par cran ; Encoder molette(DT, CLK) compte en positif dans le sens horaire. Sur l’Uno, D2 et D3 ont une interruption : le comptage ne perd aucun front.')],
    lib: 'Encoder (Paul Stoffregen)',
    code: p => tl('Encoder molette({0}, {1}); // DT, CLK : le sens horaire compte en positif\n// setup() : pinMode({2}, INPUT_PULLUP);\nlong crans = molette.read() / 4;\nbool appuye = digitalRead({2}) == LOW;', p.DT, p.CLK, p.SW || 4)
  },
  irremote: {
    what: tl('Télécommande infrarouge « Car MP3 » à 21 touches, protocole NEC (adresse 0x00) : rien à câbler, elle parle aux récepteurs infrarouges du montage. Ses touches s’utilisent dans le panneau « Périphériques » de l’onglet Simulation.'),
    notes: [tl('Codes des touches (commande NEC) : CH− 0x45, CH 0x46, CH+ 0x47, ⏮ 0x44, ⏭ 0x40, ⏯ 0x43, − 0x07, + 0x15, EQ 0x09, 0 0x16, 100+ 0x19, 200+ 0x0D, 1 0x0C, 2 0x18, 3 0x5E, 4 0x08, 5 0x1C, 6 0x5A, 7 0x42, 8 0x52, 9 0x4A.'),
      tl('Touche maintenue : une trame de répétition toutes les 110 ms (IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT).')],
    lib: 'IRremote',
    code: () => tl('// avec un récepteur infrarouge : IrReceiver.begin(broche);\nif (IrReceiver.decode()) {\n  if (IrReceiver.decodedIRData.command == 0x45) Serial.println("CH-");\n  IrReceiver.resume();\n}')
  },

  /* ---------- Affichage ---------- */
  oled: {
    what: tl('Écran OLED 128×64 (SSD1306) en I2C, adresse 0x3C.'),
    pins: [gnd(), pwr('VCC', [3.3, 5], tl('Le module a son propre régulateur.'), 'adafruitOled'), ...i2c()],
    lib: 'Adafruit SSD1306 + Adafruit GFX', ma: 20, ds: 'adafruitOled',
    code: () => `Adafruit_SSD1306 ecran(128, 64, &Wire);\n// setup() : ecran.begin(SSD1306_SWITCHCAPVCC, 0x3C);\necran.print("Bonjour");\necran.display();`
  },
  lcd1602: {
    what: tl('Écran LCD 16 caractères × 2 lignes avec adaptateur I2C (PCF8574), adresse 0x27 (0x3F avec une puce PCF8574A).'),
    pins: [gnd(), pwr('VCC', [4.5, 5.5], tl('Le contraste et le rétroéclairage demandent 5 V.'), 'newhavenLcd1602'), io('SDA', 'sda', 'I2C SDA', tl('Données du bus I2C.'), { lv5: true }), io('SCL', 'scl', 'I2C SCL', tl('Horloge du bus I2C.'), { lv5: true })],
    lib: 'LiquidCrystal_I2C', ma: 25, ds: 'newhavenLcd1602',
    code: () => `LiquidCrystal_I2C lcd(0x27, 16, 2);\n// setup() : lcd.init(); lcd.backlight();\nlcd.print("Bonjour");`
  },
  '7seg': {
    what: tl('Afficheur 7 segments à cathode commune : chaque segment est une LED.'),
    pins: [
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map(k => io(k, OUT, tl('Segment {0}', k), tl('Segment (une LED) commandé par une sortie : HIGH l’allume.'))),
      { pin: 'COM', kind: 'gnd', via: 'res-220', role: tl('Commun'), why: tl('Cathode commune vers la masse, à travers une résistance de 220 Ω qui limite le courant. Une résistance par segment donnerait une luminosité plus régulière.') },
      nc('COM (2)', tl('Second commun, relié au premier à l’intérieur : inutile de le câbler.'))
    ],
    code: p => `byte segments[8] = {${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map(k => p[k]).join(', ')}};\nfor (byte s : segments) pinMode(s, OUTPUT);`
  },
  ws2812: {
    what: tl('Barrette de 8 LED RGB adressables (WS2812B) pilotées par un seul fil de données.'),
    pins: [gnd(), pwr('VCC', [3.5, 5.3], tl('Jusqu’à 60 mA par LED en blanc à pleine puissance, soit 480 mA pour la barrette.'), 'worldsemiWs2812b'), io('DIN', OUT, tl('Données'), tl('Données série à 800 kHz qui traversent les LED en cascade. Une résistance de 300 à 500 Ω en série protège la première LED.'))],
    tips: prof => (prof && prof.logic < 4 ? [tl('Sur une carte 3,3 V, le signal de données est un peu juste pour des LED en 5 V : un adaptateur de niveau (74AHCT125) le fiabilise.')] : []),
    lib: 'Adafruit NeoPixel', ma: 480, ds: 'adafruitNeopixel',
    code: p => `Adafruit_NeoPixel leds(8, ${p.DIN}, NEO_GRB + NEO_KHZ800);\n// setup() : leds.begin();\nleds.setPixelColor(0, leds.Color(255, 0, 0));\nleds.show();`
  },

  /* ---------- Sorties ---------- */
  'led-red': led('led-red'), 'led-green': led('led-green'), 'led-blue': led('led-blue'), 'led-yellow': led('led-yellow'), 'led-white': led('led-white'),
  'led-rgb': {
    what: tl('LED RGB à cathode commune : trois LED (rouge, verte, bleue) dans un même boîtier.'),
    pins: [
      io('R', 'pwm', tl('Rouge'), tl('LED rouge, à travers sa résistance ; la PWM règle son intensité.'), { via: 'res-220' }),
      gnd('GND', tl('Cathode commune (patte la plus longue) vers la masse.')),
      io('G', 'pwm', tl('Vert'), tl('LED verte, à travers sa résistance.'), { via: 'res-220' }),
      io('B', 'pwm', tl('Bleu'), tl('LED bleue, à travers sa résistance.'), { via: 'res-220' })
    ],
    code: p => `analogWrite(${p.R}, 255);\nanalogWrite(${p.G}, 80);\nanalogWrite(${p.B}, 0);`
  },
  buzzer: {
    what: tl('Buzzer actif : il a son propre oscillateur et sonne dès qu’il est alimenté.'),
    pins: [io('+', OUT, tl('Commande'), tl('Directement sur une sortie, il tire environ 25 mA, plus que les 20 mA conseillés par broche. Le câblage automatique le place donc derrière un transistor : + au 5 V, − au collecteur, la broche commande la base par 1 kΩ.')), gnd('-', tl('Vers la masse, ou vers le collecteur du transistor qui le commande.'))],
    stage: { q: 'npn', base: 'res-1k', v: 5, need: OUT },
    code: p => `pinMode(${p['+']}, OUTPUT);\ndigitalWrite(${p['+']}, HIGH); // sonne`
  },
  speaker: {
    what: tl('Haut-parleur 8 Ω : il lui faut un signal alternatif, produit par tone().'),
    pins: [io('+', OUT, tl('Signal'), tl('tone() envoie un signal carré sur n’importe quelle sortie ; la résistance limite le courant, le haut-parleur seul ne faisant que 8 Ω.'), { via: 'res-220' }), gnd('-')],
    notes: [tl('Pour un son fort, passez par un transistor ou un petit amplificateur (PAM8403).')],
    code: p => tl('tone({0}, 440, 500); // la 440 Hz pendant 0,5 s', p['+'])
  },
  relay: {
    what: tl('Module relais 1 canal : un petit courant de commande actionne un interrupteur de puissance isolé.'),
    pins: [pwr('VCC', [4.5, 5.5], tl('La bobine du relais demande 5 V (environ 70 mA).'), 'songleSrd'), gnd(), io('IN', OUT, tl('Commande'), tl('Commande la bobine via le transistor du module. Beaucoup de modules sont actifs à l’état bas : LOW colle le relais.')),
      { pin: 'COM', kind: 'contact', role: tl('Commun'), why: tl('Borne commune du contact : on y amène le + de l’alimentation de puissance (pile, adaptateur).') },
      { pin: 'NO', kind: 'contact', role: tl('Normalement ouvert'), why: tl('Relié à COM seulement quand le relais est collé : la charge (moteur, ventilateur, lampe) s’allume sur commande.') },
      { pin: 'NC', kind: 'contact', role: tl('Normalement fermé'), why: tl('Relié à COM au repos, ouvert quand le relais colle.') }],
    notes: [tl('Côté contacts (COM, NO, NC), le circuit de puissance est séparé : 10 A sous 125 V~, 7 A sous 240 V~ ou 28 V⎓. Le secteur est dangereux : coupez-le avant toute manipulation.')],
    code: p => tl('pinMode({0}, OUTPUT);\ndigitalWrite({1}, LOW); // relais collé (module actif à l’état bas)', p.IN, p.IN)
  },

  /* ---------- Moteurs ---------- */
  servo: {
    what: tl('Servomoteur SG90 : se place entre 0 et 180° selon la largeur des impulsions reçues.'),
    pins: [gnd('GND', tl('Fil marron : masse.')), pwr('VCC', [4.8, 6], tl('Fil rouge. Jusqu’à 500 mA en pointe : pour plusieurs servos, alimentation séparée avec masse commune.'), 'towerproSg90'), io('SIG', OUT, tl('Commande'), tl('Fil orange : une impulsion de 0,5 à 2,4 ms toutes les 20 ms, dont la largeur fixe l’angle. La bibliothèque Servo la produit sur n’importe quelle sortie (pas besoin d’une broche PWM).'))],
    lib: prof => (prof && prof.label === 'ESP32' ? 'ESP32Servo' : 'Servo'),
    code: p => `Servo servo;\n// setup() : servo.attach(${p.SIG});\nservo.write(90);`
  },
  dcmotor: {
    what: tl('Moteur à courant continu : tourne dans un sens ou dans l’autre selon la polarité.'),
    driver: 'l298n',
    pins: ['M+', 'M-'].map(k => ({ pin: k, kind: 'drv', role: tl('Moteur'), why: tl('Vers une sortie d’un pilote (L298N, L293D, TB6612FNG) : un moteur demande des centaines de mA et renvoie des pointes de tension, jamais directement sur une broche de la carte.') }))
  },
  fan: {
    what: tl('Ventilateur 5 V (40 mm) : moteur sans balais, son électronique interne impose la polarité : fil rouge au +, noir au −.'),
    stage: { q: 'pn2222', base: 'res-1k', flyback: 'diode', v: 5, need: 'pwm' },
    pins: drvPins('+', '-'),
    notes: [tl('Branché à l’envers, il ne tourne pas (sans dommage). Sa vitesse suit la tension : PWM par un transistor ou un pilote.'), tl('Câblage automatique : + au 5 V, − au collecteur d’un PN2222A (environ 100 mA), base par 1 kΩ, diode 1N4007 de roue libre aux bornes du ventilateur.')]
  },
  pump: {
    what: tl('Mini pompe à eau immergée 5 V : un petit moteur à courant continu entraîne une turbine.'),
    stage: { q: 'pn2222', base: 'res-1k', flyback: 'diode', v: 5, need: 'pwm' },
    pins: drvPins('+', '-'),
    notes: [tl('Toujours immergée : à sec, elle s’use en quelques minutes. Commandée par un transistor ou un relais, avec une pile ou un adaptateur 5 V.'), tl('Câblage automatique : + au 5 V, − au collecteur d’un PN2222A (environ 200 mA, trop pour un BC547), base par 1 kΩ, diode 1N4007 de roue libre aux bornes de la pompe.')]
  },
  vibro: {
    what: tl('Moteur vibreur (pièce de 10 mm) : une masse décentrée sur l’axe fait vibrer, comme dans un téléphone.'),
    stage: { q: 'pn2222', base: 'res-1k', flyback: 'diode', v: 5, series: 'res-22', need: 'pwm' },
    pins: drvPins('+', '-'),
    notes: [tl('3 V nominal, environ 80 mA : par un transistor, jamais directement sur une broche.'), tl('Câblage automatique : 5 V à travers 22 Ω (il reste ≈ 3 V aux bornes du vibreur), − au collecteur d’un PN2222A, base par 1 kΩ, diode 1N4007 de roue libre.')]
  },
  stepper: {
    what: tl('Moteur pas à pas 28BYJ-48 et sa carte ULN2003 : 2048 pas par tour.'),
    pins: [
      ...['IN1', 'IN2', 'IN3', 'IN4'].map(k => io(k, OUT, tl('Bobine'), tl('Commande une bobine via le ULN2003 ; activées dans l’ordre, elles font tourner l’axe pas à pas.'))),
      pwr('VCC', [4.5, 5.5], tl('Le 28BYJ-48 de la bibliothèque est la version 5 V : ses bobines demandent 5 V et jusqu’à 240 mA.'), 'kiatronics28byj48'), gnd()
    ],
    lib: 'Stepper',
    code: p => `Stepper moteur(2048, ${p.IN1}, ${p.IN3}, ${p.IN2}, ${p.IN4}); // ordre IN1-IN3-IN2-IN4\nmoteur.setSpeed(10);\nmoteur.step(2048); // un tour`
  },
  l298n: {
    what: tl('Pilote de moteurs à double pont en H : deux moteurs à courant continu, sens et vitesse, jusqu’à 2 A par voie.'),
    pins: [
      io('IN1', OUT, tl('Sens A'), tl('IN1/IN2 : HIGH/LOW dans un sens, LOW/HIGH dans l’autre, identiques pour freiner.')),
      io('IN2', OUT, tl('Sens A'), tl('Seconde entrée de sens de la voie A.')),
      io('ENA', 'pwm', tl('Vitesse A'), tl('Retirez le cavalier ENA : une PWM sur cette broche règle la vitesse.')),
      io('IN3', OUT, tl('Sens B'), tl('Entrées de sens de la voie B.'), { when: ['OUT3', 'OUT4'] }),
      io('IN4', OUT, tl('Sens B'), tl('Entrées de sens de la voie B.'), { when: ['OUT3', 'OUT4'] }),
      io('ENB', 'pwm', tl('Vitesse B'), tl('Vitesse de la voie B en PWM (cavalier retiré).'), { when: ['OUT3', 'OUT4'] }),
      { pin: '+12V', kind: 'ext', v: [5, 35], ds: ['stL298', 'tiUa78m'], src: 'bat9v', gndPin: 'GND', role: tl('Alimentation moteurs'), why: tl('Alimentation des moteurs (5 à 35 V) par une source séparée : la carte ne peut pas fournir ce courant.') },
      gnd('GND', tl('Masse commune entre la batterie, le pilote et la carte : sans elle, les commandes ne sont pas comprises.')),
      nc('+5V', tl('Sortie 5 V du régulateur intégré (cavalier 5V-EN en place) : peut alimenter la carte, inutile ici.')),
      ...['OUT1', 'OUT2', 'OUT3', 'OUT4'].map(k => nc(k, tl('Sortie de puissance vers un moteur.')))
    ],
    code: p => `analogWrite(${p.ENA}, 200); // vitesse\ndigitalWrite(${p.IN1}, HIGH);\ndigitalWrite(${p.IN2}, LOW);`
  },
  // Ponts en H et pilotes pas à pas : modèle électrique et logique dans motordrv.js.
  l293d: {
    what: tl('Pilote de moteurs L293D (DIP-16) : quatre demi-ponts, soit deux moteurs à courant continu commandés en sens et en vitesse, 600 mA par voie, diodes de roue libre intégrées.'),
    pins: [
      pwr('VCC1', [4.5, 7], tl('Broche 16 : alimentation de la logique, le 5 V de la carte.'), 'tiL293d', tl('Alimentation logique')),
      { pin: 'VCC2', kind: 'ext', v: [4.5, 36], ds: 'tiL293d', src: 'bat9v', gndPin: 'GND', role: tl('Alimentation moteurs'), why: tl('Broche 8 : alimentation des moteurs (4,5 à 36 V), par une source séparée. Les sorties en reprennent la tension, moins ≈ 2,6 V à 600 mA (étages bipolaires).') },
      gnd('GND', tl('Broches 4, 5, 12 et 13 : masse et dissipateur de la puce, commune avec la carte et la pile.')),
      ...['GND (2)', 'GND (3)', 'GND (4)'].map(k => nc(k, tl('Masse reliée aux autres dans la puce : elle évacue aussi la chaleur.'))),
      io('EN12', 'pwm', tl('Validation 1,2'), tl('Broche 1 : HIGH valide OUT1 et OUT2 ; une PWM y règle la vitesse du premier moteur. LOW : sorties en l’air, le moteur tourne en roue libre.')),
      io('IN1', OUT, tl('Sens A'), tl('Broche 2 : OUT1 suit IN1. IN1/IN2 à HIGH/LOW dans un sens, LOW/HIGH dans l’autre, identiques pour freiner.')),
      io('IN2', OUT, tl('Sens A'), tl('Broche 7 : OUT2 suit IN2.')),
      io('EN34', 'pwm', tl('Validation 3,4'), tl('Broche 9 : valide OUT3 et OUT4, vitesse du second moteur en PWM.'), { when: ['OUT3', 'OUT4'] }),
      io('IN3', OUT, tl('Sens B'), tl('Broche 10 : OUT3 suit IN3.'), { when: ['OUT3', 'OUT4'] }),
      io('IN4', OUT, tl('Sens B'), tl('Broche 15 : OUT4 suit IN4.'), { when: ['OUT3', 'OUT4'] }),
      ...['OUT1', 'OUT2', 'OUT3', 'OUT4'].map(k => nc(k, tl('Sortie de puissance vers une borne d’un moteur (600 mA au plus).')))
    ],
    notes: [tl('600 mA par voie en continu (1,2 A en pointe) : un petit moteur jaune de robot, pas un moteur d’essuie-glace.'), tl('Chute de tension importante (transistors bipolaires) : sous 9 V, le moteur ne reçoit qu’≈ 6,5 V à 600 mA.')],
    code: p => `analogWrite(${p.EN12}, 200); // vitesse\ndigitalWrite(${p.IN1}, HIGH);\ndigitalWrite(${p.IN2}, LOW);`
  },
  tb6612: {
    what: tl('Pilote de moteurs TB6612FNG (module) : double pont en H à MOSFET, deux moteurs à courant continu, 1,2 A par voie, presque sans chute de tension.'),
    pins: [
      { pin: 'VM', kind: 'ext', v: [2.5, 13.5], ds: ['toshibaTb6612', 'pololuTb6612'], src: 'bat9v', gndPin: 'GND', role: tl('Alimentation moteurs'), why: tl('Alimentation des moteurs, 2,5 à 13,5 V (15 V au maximum absolu), par une source séparée.') },
      pwr('VCC', [2.7, 5.5], tl('Alimentation de la logique : la tension de la carte (3,3 ou 5 V).'), 'toshibaTb6612', tl('Alimentation logique')),
      gnd('GND', tl('Masse commune entre la pile, le pilote et la carte.')),
      ...['GND (2)', 'GND (3)'].map(k => nc(k, tl('Autre broche de masse, reliée à GND sur le module.'))),
      io('AIN1', OUT, tl('Sens A'), tl('AIN1/AIN2 : HIGH/LOW dans un sens, LOW/HIGH dans l’autre ; HIGH/HIGH freine (court-circuit du moteur) ; LOW/LOW le laisse en roue libre.')),
      io('AIN2', OUT, tl('Sens A'), tl('Seconde entrée de sens de la voie A.')),
      io('PWMA', 'pwm', tl('Vitesse A'), tl('PWM de la voie A (jusqu’à 100 kHz) : à l’état bas, le moteur est freiné, pas seulement lâché.')),
      io('BIN1', OUT, tl('Sens B'), tl('Entrées de sens de la voie B.'), { when: ['BO1', 'BO2'] }),
      io('BIN2', OUT, tl('Sens B'), tl('Entrées de sens de la voie B.'), { when: ['BO1', 'BO2'] }),
      io('PWMB', 'pwm', tl('Vitesse B'), tl('PWM de la voie B.'), { when: ['BO1', 'BO2'] }),
      { pin: 'STBY', kind: 'pwr', v: 'logic', alt: OUT, role: tl('Veille (STBY)'), why: tl('Tirée à la masse dans la puce : tant qu’elle est basse, tout est coupé. Au VCC (toujours actif) ou sur une broche de la carte (mise en veille par le programme).') },
      ...['AO1', 'AO2', 'BO1', 'BO2'].map(k => nc(k, tl('Sortie de puissance vers une borne d’un moteur.')))
    ],
    notes: [tl('Résistance des MOSFET ≈ 0,5 Ω (haut + bas) : sous 9 V et 1 A, le moteur reçoit ≈ 8,5 V, quand un L298N n’en laisse que ≈ 6.'), tl('1,2 A moyens par voie (3,2 A en pointe de 10 ms) ; les deux voies peuvent être mises en parallèle.')],
    code: p => `digitalWrite(${p.STBY || 'STBY'}, HIGH); // pilote actif\nanalogWrite(${p.PWMA}, 200); // vitesse\ndigitalWrite(${p.AIN1}, HIGH);\ndigitalWrite(${p.AIN2}, LOW);`
  },
  nema17: {
    what: tl('Moteur pas à pas bipolaire NEMA 17 (17HS4401) : 200 pas par tour (1,8°), deux bobines de 1,5 Ω, 1,7 A par phase. Il se commande par un pilote (A4988, DRV8825), une impulsion par pas.'),
    driver: 'a4988',
    pins: [['A+', tl('Bobine A')], ['A-', tl('Bobine A')], ['B+', tl('Bobine B')], ['B-', tl('Bobine B')]].map(([k, role]) => ({ pin: k, kind: 'drv', role, why: tl('Vers une sortie du pilote : les deux fils d’une même bobine sur les deux sorties d’une même bobine du pilote (A sur 1A-1B, B sur 2A-2B pour l’A4988). Jamais sur une broche de la carte : 1,7 A par phase.') })),
    notes: [
      tl('Les deux fils d’une même bobine se trouvent à l’ohmmètre : ≈ 1,5 Ω entre eux, rien vers l’autre bobine. Mélangés, le moteur vibre sans tourner.'),
      tl('Inverser les deux fils d’une bobine, ou échanger les bobines, inverse le sens de rotation.'),
      tl('Décrochage : démarré d’un coup au-delà d’≈ 1000 pas par seconde (300 tr/min), ou poussé au-delà de 3000, le rotor ne suit plus et vibre sur place ; les pas sont perdus. Une rampe d’accélération (AccelStepper) le fait monter plus haut.')
    ]
  },
  a4988: {
    what: tl('Pilote de moteur pas à pas A4988 (carte Pololu) : chaque impulsion sur STEP fait avancer le moteur d’un pas ou d’une fraction de pas (jusqu’à 1/16), DIR choisit le sens. Le courant des bobines se règle au potentiomètre.'),
    pins: [
      io('STEP', OUT, tl('Pas (STEP)'), tl('Chaque front montant avance le moteur d’un pas (ou d’un micro-pas). Impulsions d’au moins 1 µs, au niveau haut puis au niveau bas.')),
      io('DIR', OUT, tl('Sens (DIR)'), tl('Lu à chaque pas : HIGH dans un sens, LOW dans l’autre.')),
      io('ENABLE', OUT, tl('Validation (ENABLE)'), tl('Active à l’état bas et tirée à la masse : libre, le pilote est actif. HIGH coupe les bobines : le moteur ne tient plus sa position.'), { opt: true }),
      ...['MS1', 'MS2', 'MS3'].map(k => ({ ...nc(k, tl('Microrésolution (tirée à la masse) : libres, pas entier ; MS1 seule au niveau haut, 1/2 pas ; MS2, 1/4 ; MS1 et MS2, 1/8 ; les trois, 1/16. Au VDD, ou sur une broche de la carte.')), role: tl('Microrésolution') })),
      { pin: 'RESET', kind: 'pwr', v: 'logic', alt: OUT, role: tl('Remise à zéro (RESET)'), why: tl('Active à l’état bas et en l’air sur la carte : reliez-la à SLEEP, sa voisine (tirée au niveau haut), au VDD, ou à une broche de la carte. Basse, le pilote ignore STEP.') },
      { ...nc('SLEEP', tl('Veille, active à l’état bas, tirée au niveau haut sur la carte : libre, le pilote fonctionne. Reliée à RESET, elle la tient au niveau haut.')), role: tl('Veille (SLEEP)') },
      { pin: 'VMOT', kind: 'ext', v: [8, 35], ds: ['pololuA4988', 'allegroA4988'], src: 'psu24', gndPin: 'GND', role: tl('Alimentation moteur'), why: tl('8 à 35 V par une alimentation séparée, avec un condensateur d’au moins 47 µF près de la carte : les pointes de tension à la mise sous tension dépassent sinon les 35 V.') },
      gnd('GND', tl('Masse de l’alimentation du moteur, commune avec la carte.')),
      ...['2B', '2A', '1A', '1B'].map(k => ({ ...nc(k, tl('Sortie vers la bobine {0} du moteur (1A-1B : une bobine, 2A-2B : l’autre).', k[0])), role: tl('Bobine {0}', k[0]) })),
      pwr('VDD', [3, 5.5], tl('Alimentation de la logique : la tension de la carte (3 à 5,5 V).'), 'allegroA4988', tl('Alimentation logique')),
      nc('GND (2)', tl('Masse de la logique, reliée à GND sur la carte.'))
    ],
    notes: [
      tl('Courant : I = Vref ÷ (8 × 0,068 Ω) ; pour 1 A, Vref = 0,54 V entre le potentiomètre et la masse. ≈ 1 A par phase sans radiateur, 2 A au plus. Réglez-le au courant du moteur (1,7 A pour un 17HS4401) ou en dessous.'),
      tl('Ne débranchez jamais le moteur pilote sous tension : la pointe de tension détruit la puce.')
    ],
    lib: 'AccelStepper',
    code: p => tl('AccelStepper moteur(AccelStepper::DRIVER, {0}, {1}); // (STEP, DIR)\n// setup() : moteur.setMaxSpeed(800); moteur.setAcceleration(400);\nmoteur.moveTo(200); // un tour en pas entiers\n// loop() : moteur.run();', p.STEP, p.DIR)
  },
  drv8825: {
    what: tl('Pilote de moteur pas à pas DRV8825 (carte Pololu) : comme l’A4988, une impulsion sur STEP par pas, DIR pour le sens, jusqu’à 1/32 de pas, 45 V et 1,5 A par phase sans radiateur.'),
    pins: [
      io('STEP', OUT, tl('Pas (STEP)'), tl('Chaque front montant avance le moteur d’un pas (ou d’un micro-pas). Impulsions d’au moins 1,9 µs au niveau haut et au niveau bas.')),
      io('DIR', OUT, tl('Sens (DIR)'), tl('Lu à chaque pas : HIGH dans un sens, LOW dans l’autre.')),
      io('ENABLE', OUT, tl('Validation (ENABLE)'), tl('Active à l’état bas et tirée à la masse : libre, le pilote est actif. HIGH coupe les bobines.'), { opt: true }),
      ...['M0', 'M1', 'M2'].map(k => ({ ...nc(k, tl('Microrésolution (tirée à la masse) : libres, pas entier ; M0, 1/2 ; M1, 1/4 ; M0 et M1, 1/8 ; M2, 1/16 ; M2 avec M0 ou M1, 1/32.')), role: tl('Microrésolution') })),
      { pin: 'RESET', kind: 'pwr', v: 'logic', alt: OUT, role: tl('Remise à zéro (RESET)'), why: tl('Active à l’état bas et tirée à la masse dans la puce : à mettre au niveau haut (alimentation logique de la carte, ou une broche).') },
      { pin: 'SLEEP', kind: 'pwr', v: 'logic', alt: OUT, role: tl('Veille (SLEEP)'), why: tl('Active à l’état bas et tirée à la masse dans la puce : à mettre au niveau haut. Contrairement à l’A4988, la relier seulement à RESET ne suffit pas.') },
      { pin: 'VMOT', kind: 'ext', v: [8.2, 45], ds: ['pololuDrv8825', 'tiDrv8825'], src: 'psu24', gndPin: 'GND', role: tl('Alimentation moteur'), why: tl('8,2 à 45 V par une alimentation séparée, avec un condensateur d’au moins 47 µF près de la carte.') },
      gnd('GND', tl('Masse de l’alimentation du moteur, commune avec la carte.')),
      ...['B2', 'B1', 'A1', 'A2'].map(k => ({ ...nc(k, tl('Sortie vers la bobine {0} du moteur (A1-A2 : une bobine, B1-B2 : l’autre).', k[0])), role: tl('Bobine {0}', k[0]) })),
      { ...nc('FAULT', tl('Sortie de défaut (drain ouvert) : passe à l’état bas en cas de surintensité ou de surchauffe. Sa résistance de 1,5 kΩ permet de la brancher là où l’A4988 attend son VDD.')), role: tl('Défaut') },
      nc('GND (2)', tl('Masse de la logique, reliée à GND sur la carte.'))
    ],
    notes: [
      tl('Courant : I = 2 × Vref ; pour 1 A, Vref = 0,5 V. ≈ 1,5 A par phase sans radiateur, 2,2 A au plus avec refroidissement.'),
      tl('Pas besoin d’alimentation logique : la puce a son propre régulateur. Ses entrées acceptent 3,3 V et 5 V.')
    ],
    lib: 'AccelStepper',
    code: p => tl('AccelStepper moteur(AccelStepper::DRIVER, {0}, {1}); // (STEP, DIR)\n// setup() : moteur.setMaxSpeed(800); moteur.setAcceleration(400);\nmoteur.moveTo(200); // un tour en pas entiers\n// loop() : moteur.run();', p.STEP, p.DIR)
  },

  /* ---------- Passifs ---------- */
  'res-22': resistor(tl('Résistance 22 Ω (rouge, rouge, noir) : en série avec un petit moteur pour abaisser sa tension (vibreur 3 V sur 5 V).')),
  'res-220': resistor(tl('Résistance 220 Ω (rouge, rouge, marron) : typique en série avec une LED.')),
  'res-330': resistor(tl('Résistance 330 Ω (orange, orange, marron) : LED ou haut-parleur sur une carte dont les broches débitent peu (ESP8266, Pico).')),
  'res-1k': resistor(tl('Résistance 1 kΩ (marron, noir, rouge) : base d’un transistor, pont diviseur.')),
  'res-4k7': resistor(tl('Résistance 4,7 kΩ (jaune, violet, rouge) : tirage d’un bus 1-Wire ou I2C.')),
  'res-10k': resistor(tl('Résistance 10 kΩ (marron, noir, orange) : tirage d’une entrée vers le haut ou vers le bas.')),
  // Condensateurs et transistor : aucune broche n'est « à câbler » vers la carte (nc), sauf la base ;
  // la fiche explique chaque patte et le solveur (dc.js) calcule la charge et la commutation.
  'cap-100n': {
    what: tl('Condensateur céramique 100 nF : découplage, au plus près des broches d’alimentation d’une puce.'),
    pins: ['1', '2'].map(k => ({ ...nc(k, tl('Non polarisé : les deux pattes sont interchangeables. L’une vers l’alimentation ou le signal, l’autre vers la masse.')), role: tl('Patte') }))
  },
  'cap-100u': {
    what: tl('Condensateur électrolytique 100 µF, polarisé (la bande marque le −) : réserve d’énergie qui absorbe les pointes de courant d’une alimentation.'),
    pins: [
      { ...nc('+', tl('Borne + (patte longue) : toujours côté tension la plus haute.')), role: tl('Borne +') },
      { ...nc('-', tl('Borne − (patte courte, côté bande claire) : vers la masse. Monté à l’envers, un électrolytique chauffe, gonfle et peut éclater.')), role: tl('Borne −') }
    ],
    notes: [tl('Chargé à travers une résistance R, il atteint 63 % de la tension en τ = R × C, et presque toute la tension en 5τ.')]
  },
  diode: { what: tl('Diode 1N4007 : ne laisse passer le courant que dans un sens (la bague marque la cathode). On la place en roue libre aux bornes d’un moteur ou d’une bobine de relais.') },
  npn: {
    what: tl('Transistor NPN BC547 : un petit courant de base (via ~1 kΩ) commande jusqu’à 100 mA entre collecteur et émetteur. Émetteur à la masse, charge entre l’alimentation et le collecteur.'),
    pins: [
      { ...nc('C', tl('Collecteur : reçoit le courant de la charge (LED et sa résistance, buzzer, relais), reliée de l’autre côté à l’alimentation. Ic peut atteindre β ≈ 200 fois le courant de base, au plus 100 mA.')), role: tl('Collecteur') },
      io('B', OUT, tl('Base'), tl('Base : la broche y envoie un petit courant, limité par la résistance de 1 kΩ, qui rend le transistor passant. Sans résistance, la jonction base-émetteur court-circuite la sortie de la carte.'), { via: 'res-1k' }),
      gnd('E', tl('Émetteur à la masse : le courant de base et celui du collecteur en ressortent ensemble.'))
    ],
    notes: [tl('Saturé (base bien alimentée), il se comporte comme un interrupteur fermé : Vce ≈ 0,2 V. La broche ne fournit que le courant de base, quelques mA.')],
    code: p => tl('pinMode({0}, OUTPUT);\ndigitalWrite({1}, HIGH); // transistor passant : la charge s’allume', p.B, p.B)
  },

  pn2222: {
    what: tl('Transistor NPN PN2222A : comme le BC547 mais jusqu’à 600 mA, pour commander un ventilateur, une pompe ou un vibreur. Brochage E-B-C, face plate vers soi.'),
    pins: [
      { ...nc('C', tl('Collecteur : reçoit le courant de la charge, reliée de l’autre côté au + de son alimentation. 500 mA conseillés, 600 mA au plus.')), role: tl('Collecteur') },
      io('B', OUT, tl('Base'), tl('Base, à travers 1 kΩ : 2 à 4 mA de base suffisent à saturer le transistor pour 200 mA de charge (β ≥ 100).'), { via: 'res-1k' }),
      gnd('E', tl('Émetteur à la masse.'))
    ],
    notes: [tl('Une charge qui contient une bobine (moteur, relais) renvoie une pointe de tension à la coupure : une diode de roue libre (1N4007) à ses bornes, cathode côté +, protège le transistor.')],
    code: p => tl('pinMode({0}, OUTPUT);\ndigitalWrite({1}, HIGH); // transistor passant : la charge s’allume', p.B, p.B)
  },
  // PNP : le NPN en miroir, émetteur au + (le câblage automatique prend la tension logique de la carte), charge entre le collecteur et la masse ;
  // la base passe par 1 kΩ vers une broche : LOW le rend passant, HIGH (à la tension de l'émetteur) le bloque.
  pnp: {
    what: tl('Transistor PNP BC557 : le complément du BC547, pour commuter le côté + d’une charge (jusqu’à 100 mA). Émetteur au +, charge entre le collecteur et la masse : il conduit quand la broche met la base à LOW.'),
    pins: [
      { ...nc('C', tl('Collecteur : vers le + de la charge (LED et sa résistance, buzzer), dont l’autre côté va à la masse. Le courant de la charge sort du collecteur, 100 mA au plus.')), role: tl('Collecteur') },
      io('B', OUT, tl('Base'), tl('Base, à travers 1 kΩ : LOW tire un petit courant hors de la base et rend le transistor passant ; HIGH, à la tension de l’émetteur, le bloque. Sans résistance, la jonction émetteur-base court-circuite la sortie de la carte.'), { via: 'res-1k' }),
      pwr('E', [1.8, 45], tl('Émetteur au + : à la tension logique de la carte quand la broche commande la base directement, pour qu’une sortie HIGH remonte la base jusqu’à l’émetteur et bloque bien le transistor. Jusqu’à 45 V (VCEO) si un NPN tire la base.'), 'onsemiBc557')
    ],
    notes: [PNP_LOW, PNP_3V3],
    code: p => tl('pinMode({0}, OUTPUT);\ndigitalWrite({1}, LOW); // PNP passant : la charge s’allume (HIGH l’éteint)', p.B, p.B)
  },
  pn2907: {
    what: tl('Transistor PNP PN2907A : le complément du PN2222A, jusqu’à 600 mA, pour commuter le côté + d’une charge (moteur, pompe, bande de LED). Brochage E-B-C, face plate vers soi.'),
    pins: [
      { ...nc('C', tl('Collecteur : vers le + de la charge, dont le − va à la masse. 500 mA conseillés, 600 mA au plus.')), role: tl('Collecteur') },
      io('B', OUT, tl('Base'), tl('Base, à travers 1 kΩ : LOW le sature (β ≥ 100, quelques mA de base suffisent pour 200 mA de charge) ; HIGH, à la tension de l’émetteur, le bloque.'), { via: 'res-1k' }),
      pwr('E', [1.8, 60], tl('Émetteur au +, où entre le courant de la charge : à la tension logique de la carte quand la broche commande la base directement ; jusqu’à 60 V (VCEO) si un NPN tire la base.'), 'onsemiPn2907a')
    ],
    notes: [PNP_LOW, PNP_3V3, tl('Une charge à bobine (moteur, relais) demande une diode de roue libre à ses bornes : cathode côté collecteur (le + de la charge), anode à la masse.')],
    code: p => tl('pinMode({0}, OUTPUT);\ndigitalWrite({1}, LOW); // PNP passant : la charge s’allume (HIGH l’éteint)', p.B, p.B)
  },
  'zener-3v3': zener('zener-3v3', 5), 'zener-5v1': zener('zener-5v1', 9), 'zener-12v': zener('zener-12v', 24),
  lvlshift: {
    what: tl('Adaptateur de niveau logique 4 voies (BSS138) : relie sans danger une carte 5 V et un module 3,3 V, dans les deux sens (I2C, SPI, série).'),
    pins: [
      pwr('LV', [1.8, 3.6], tl('Côté basse tension : le 3,3 V. Les voies LV1 à LV4 vont vers ce qui fonctionne en 3,3 V.'), 'adafruitLevelShifter'),
      pwr('HV', [3.3, 5.5], tl('Côté haute tension : le 5 V. Les voies HV1 à HV4 vont vers ce qui fonctionne en 5 V.'), 'adafruitLevelShifter'),
      gnd('GND', tl('Masse commune aux deux côtés.')),
      nc('GND (2)', tl('Seconde masse, reliée à la première sur le module.')),
      ...[1, 2, 3, 4].flatMap(i => [
        { ...nc('LV' + i, tl('Voie {0}, côté 3,3 V.', i)), role: tl('Voie {0} (3,3 V)', i) },
        { ...nc('HV' + i, tl('Voie {0}, côté 5 V : même signal que LV{1}, à l’autre tension.', i, i)), role: tl('Voie {0} (5 V)', i) }
      ])
    ],
    notes: [tl('Chaque voie : un MOSFET BSS138 et deux résistances de tirage de 10 kΩ, l’une vers LV, l’autre vers HV. Un niveau bas d’un côté passe de l’autre côté ; au repos, chaque côté est tiré à sa propre tension.')]
  },

  /* ---------- Circuits logiques (sim/chips.js) ---------- */
  // Sorties des puces : drives (elles pilotent elles-mêmes une LED, un servo ou l'entrée d'une autre puce).
  hc595: {
    what: tl('Registre à décalage 74HC595 (DIP-16) : la carte envoie 8 bits en série sur trois fils (données, horloge, verrou), la puce les présente sur 8 sorties Q0 à Q7. Huit LED pour trois broches ; d’autres puces se chaînent par Q7S.'),
    pins: [
      pwr('VCC', [2, 6], tl('Broche 16 : alimentation, 2 à 6 V (celle de la carte). Les sorties montent à cette tension.'), 'tiHc595'),
      gnd('GND', tl('Broche 8 : masse, commune avec la carte.')),
      io('DS', OUT, tl('Données série (DS)'), tl('Broche 14 : le bit à faire entrer, lu à chaque front montant de SHCP.')),
      io('SHCP', OUT, tl('Horloge de décalage (SHCP)'), tl('Broche 11 : à chaque front montant, les bits avancent d’un rang (Q0 vers Q7) et DS entre en Q0. shiftOut() en produit huit.')),
      io('STCP', OUT, tl('Verrou (STCP)'), tl('Broche 12 : un front montant recopie le registre à décalage sur les sorties Q0 à Q7, toutes ensemble.')),
      { pin: 'OE', kind: 'gnd', alt: OUT, role: tl('Validation des sorties (OE)'), why: tl('Broche 13, active à l’état bas : à la masse, les sorties sont toujours actives ; au niveau haut, elles passent en haute impédance (LED éteintes). Sur une broche PWM de la carte, analogWrite(OE, 255 − luminosité) règle l’éclat de toutes les LED à la fois.') },
      pwr('MR', [2, 6], tl('Broche 10, remise à zéro active à l’état bas : au VCC, la puce garde ses bits ; à la masse, le registre à décalage est vidé.'), 'tiHc595', tl('Remise à zéro (MR)')),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ ...nc('Q' + i, tl('Sortie {0} : vers une LED et sa résistance (220 Ω à 1 kΩ), ou l’entrée d’un autre circuit.', i)), role: tl('Sortie Q{0}', i), drives: true })),
      { ...nc('Q7S', tl('Broche 9, sortie série (Q7′) : le bit qui sort du registre à chaque front de SHCP. Vers DS d’un second 74HC595, pour 16 sorties avec les mêmes trois broches.')), role: tl('Sortie série (Q7S)'), drives: true }
    ],
    notes: [
      tl('shiftOut(DS, SHCP, MSBFIRST, octet) : le bit 7 de l’octet arrive en Q7, le bit 0 en Q0. Les sorties ne changent qu’au front montant de STCP.'),
      tl('Courant : 35 mA au plus par sortie, mais 70 mA au plus pour toute la puce (VCC ou GND). Huit LED à 13 mA (220 Ω sous 5 V) dépassent ce total : prenez 470 Ω à 1 kΩ, ou des LED à faible courant.'),
      tl('Un condensateur de 100 nF entre VCC et GND, au plus près de la puce, évite les bits parasites.')
    ],
    lib: tl('aucune (shiftOut() du cœur Arduino)'),
    code: p => tl('// setup() : pinMode({0}, OUTPUT); pinMode({1}, OUTPUT); pinMode({2}, OUTPUT);\ndigitalWrite({2}, LOW);\nshiftOut({0}, {1}, MSBFIRST, 0b10100101); // Q7 … Q0\ndigitalWrite({2}, HIGH); // les sorties changent ensemble', p.DS, p.SHCP, p.STCP)
  },
  hc165: {
    what: tl('Registre à décalage 74HC165 (DIP-16) : la puce lit 8 entrées D0 à D7 d’un coup et les rend une à une sur Q7. Huit boutons pour trois broches ; d’autres puces se chaînent par DS.'),
    pins: [
      pwr('VCC', [2, 6], tl('Broche 16 : alimentation, 2 à 6 V (celle de la carte, pour que Q7 reste à son niveau logique).'), 'tiHc165'),
      gnd('GND', tl('Broche 8 : masse, commune avec la carte.')),
      io('PL', OUT, tl('Chargement (PL)'), tl('Broche 1, active à l’état bas : tant qu’elle est basse, la puce recopie D0 à D7 ; remontée, elle les garde pour les décaler.')),
      io('CP', OUT, tl('Horloge (CP)'), tl('Broche 2 : à chaque front montant, les bits avancent d’un rang vers Q7 (D6 prend la place de D7…).')),
      io('Q7', IN, tl('Sortie série (Q7)'), tl('Broche 9 : le bit du dernier rang, D7 juste après le chargement. Lu par digitalRead() ou shiftIn().'), { lv5: true }),
      io('CE', OUT, tl('Blocage de l’horloge (CE)'), tl('Broche 15, active à l’état bas : CP et CE sont interchangeables (horloge OU). À la masse si une seule broche sert d’horloge, ou sur une broche de la carte.'), { opt: true }),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ ...nc('D' + i, tl('Entrée parallèle {0} : un bouton vers la masse, avec une résistance de 10 kΩ vers VCC (en l’air, une entrée CMOS lit n’importe quoi).', i)), role: tl('Entrée D{0}', i) })),
      { ...nc('DS', tl('Broche 10, entrée série : le bit qui entre à chaque front. Vers Q7 d’un second 74HC165 pour 16 entrées, sinon à la masse.')), role: tl('Entrée série (DS)') },
      { ...nc('Q7N', tl('Broche 7 : Q7 inversée, rarement utile.')), role: tl('Sortie inversée'), drives: true }
    ],
    notes: [
      tl('shiftIn() monte l’horloge avant chaque lecture : mettez CP au niveau haut avant de charger (PL), sinon le premier front décale déjà et D7 est perdu. Avec CE sur une broche, gardez CE haut pendant le chargement et ne l’abaissez qu’horloge haute.'),
      tl('Courant : 25 mA au plus sur Q7, 50 mA au plus pour toute la puce.')
    ],
    lib: tl('aucune (shiftIn() du cœur Arduino)'),
    code: p => tl('// setup() : pinMode({0}, OUTPUT); pinMode({1}, OUTPUT); pinMode({2}, INPUT);\ndigitalWrite({1}, HIGH); // horloge haute : D7 se lira avant le premier front\ndigitalWrite({0}, LOW); delayMicroseconds(5);\ndigitalWrite({0}, HIGH); // D0 … D7 chargées\nbyte etat = shiftIn({2}, {1}, MSBFIRST); // bit 7 = D7', p.PL, p.CP, p.Q7)
  },
  mcp23017: {
    what: tl('Extenseur MCP23017 (module) : 16 entrées-sorties de plus (GPA0 à GPA7, GPB0 à GPB7) par le bus I2C, adresse 0x20 à 0x27 selon A0 à A2.'),
    pins: [
      pwr('VCC', [1.8, 5.5], tl('1,8 à 5,5 V : à la tension logique de la carte, les entrées-sorties et le bus I2C en prennent le niveau.'), 'microchipMcp23017'),
      gnd(),
      ...i2c({ lv5: true }),
      ...['A0', 'A1', 'A2'].map((k, i) => ({ ...nc(k, tl('Bit {0} de l’adresse : au VCC, il vaut 1 ; à la masse ou libre (résistance de 10 kΩ vers la masse sur le module), 0. Trois fils : jusqu’à 8 modules sur le même bus.', i)), role: tl('Adresse') })),
      { ...nc('RST', tl('Remise à zéro, active à l’état bas : tirée au VCC par une résistance du module. Libre, la puce fonctionne.')), role: tl('Remise à zéro') },
      ...['INTA', 'INTB'].map(k => ({ ...nc(k, tl('Sortie d’interruption du port {0} : signale un changement sur une entrée (non simulée).', k.slice(3))), role: tl('Interruption') })),
      ...['A', 'B'].flatMap(port => [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ ...nc(`GP${port}${i}`, tl('Entrée-sortie {0} (numéro {1} pour la bibliothèque) : sortie vers une LED et sa résistance, ou entrée (bouton vers la masse, tirage interne de 100 kΩ par INPUT_PULLUP).', `GP${port}${i}`, (port === 'B' ? 8 : 0) + i)), role: `GP${port}${i}`, drives: true })))
    ],
    notes: [
      tl('Bibliothèque Adafruit : broches numérotées 0 à 15 (GPA0 = 0, GPB0 = 8). mcp.pinMode(), mcp.digitalWrite(), mcp.digitalRead() comme sur la carte.'),
      tl('25 mA au plus par broche, 125 mA au plus entrant par VCC et 150 mA sortant par GND.'),
      tl('Depuis la révision D de la fiche (2022), GPA7 et GPB7 du MCP23017 ne sont garanties qu’en sortie.')
    ],
    lib: 'Adafruit MCP23017 Arduino Library',
    code: () => tl('Adafruit_MCP23X17 mcp;\n// setup() : mcp.begin_I2C(0x20);\nmcp.pinMode(0, OUTPUT); // GPA0\nmcp.digitalWrite(0, HIGH);\nmcp.pinMode(8, INPUT_PULLUP); // GPB0\nbool appui = !mcp.digitalRead(8);')
  },
  pcf8574: {
    what: tl('Extenseur PCF8574 (module) : 8 entrées-sorties quasi bidirectionnelles P0 à P7 par le bus I2C, adresse 0x20 à 0x27 selon A0 à A2.'),
    pins: [
      pwr('VCC', [2.5, 6], tl('2,5 à 6 V : à la tension logique de la carte.'), 'tiPcf8574'),
      gnd(),
      ...i2c({ lv5: true }),
      ...['A0', 'A1', 'A2'].map((k, i) => ({ ...nc(k, tl('Bit {0} de l’adresse : au VCC, 1 ; à la masse (cavalier du module en place, ou libre), 0.', i)), role: tl('Adresse') })),
      { ...nc('INT', tl('Sortie d’interruption (drain ouvert) : passe à l’état bas quand une entrée change (non simulée).')), role: tl('Interruption') },
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ ...nc('P' + i, tl('Broche P{0} : écrire 0 la tire à la masse (25 mA), écrire 1 la laisse sur un faible tirage de 100 µA, qui sert d’entrée. Une LED se branche entre VCC (avec sa résistance) et la broche, allumée par un 0.', i)), role: 'P' + i, drives: true }))
    ],
    notes: [
      tl('Un 1 n’allume pas une LED branchée vers la masse : la broche ne fournit que ≈ 100 µA. Câblez la LED depuis VCC, active à l’état bas.'),
      tl('Pour lire un bouton, écrivez d’abord 1 sur la broche (c’est l’état au démarrage), puis lisez-la : le bouton la tire à la masse.'),
      tl('25 mA au plus par broche, 80 mA au plus absorbés en tout ; PCF8574A : adresses 0x38 à 0x3F.')
    ],
    lib: 'PCF8574 (Rob Tillaart)',
    code: () => tl('PCF8574 pcf(0x20);\n// setup() : Wire.begin(); pcf.begin();\npcf.write(0, LOW); // P0 à la masse : la LED (anode au VCC) s’allume\nint bouton = pcf.read(1); // 0 tant que le bouton relie P1 à la masse')
  },
  pca9685: {
    what: tl('Pilote PCA9685 (module) : 16 sorties PWM de 12 bits par le bus I2C (adresse 0x40), pour des servos ou des LED. Fréquence commune de 24 à 1526 Hz : 50 Hz pour des servos.'),
    pins: [
      gnd(),
      io('OE', OUT, tl('Validation des sorties (OE)'), tl('Active à l’état bas, tirée à la masse sur le module : libre, les sorties sont actives ; au niveau haut, elles s’éteignent toutes.'), { opt: true }),
      ...i2c({ lv5: true }),
      pwr('VCC', [2.3, 5.5], tl('Alimentation de la puce, 2,3 à 5,5 V : la tension logique de la carte (pas celle des servos).'), 'nxpPca9685'),
      { ...nc('V+', tl('Bornier des servos : 5 à 6 V d’une alimentation séparée, qui fournit leur courant (jusqu’à 500 mA par servo en pointe). Reliez le VCC des servos à cette alimentation et sa masse à GND.')), role: tl('Alimentation des servos') },
      ...Array.from({ length: 16 }, (_, i) => ({ ...nc('PWM' + i, tl('Sortie PWM {0} (résistance de 220 Ω en série sur le module) : fil de signal d’un servo, ou anode d’une LED.', i)), role: tl('Voie {0}', i), drives: true }))
    ],
    notes: [
      tl('À 50 Hz, une période de 20 ms vaut 4096 pas : setPWM(voie, 0, 307) donne ≈ 1,5 ms (servo au milieu), 102 ≈ 0,5 ms et 491 ≈ 2,4 ms.'),
      tl('25 mA au plus par sortie, 400 mA au plus pour toute la puce ; le courant des servos passe par V+, jamais par la puce.')
    ],
    lib: 'Adafruit PWM Servo Driver Library',
    code: () => tl('Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);\n// setup() : pwm.begin(); pwm.setPWMFreq(50);\npwm.setPWM(0, 0, 307); // voie 0 : impulsion de 1,5 ms, servo à 90°')
  },

  /* ---------- Afficheurs à pilote (sim/displays.js) et écrans TFT (sim/tft.js) ---------- */
  max7219m: maxPart(tl('Matrice de 64 LED rouges (8 × 8) et son pilote MAX7219 (module FC-16) : la carte envoie des mots de 16 bits sur trois fils (DIN, CLK, CS), la puce balaie les LED seule. Plusieurs modules se chaînent par DOUT.'),
    [tl('LedControl : lc.setRow(module, ligne, B10100000) (bit de gauche = colonne 0), lc.setLed(module, ligne, colonne, true). Le module 0 est le plus proche de la carte.'),
      tl('MD_MAX72XX / MD_Parola : choisissez MD_MAX72XX::FC16_HW, le câblage du module simulé ; avec un autre type, l’image tourne comme sur un vrai module.')],
    p => tl('LedControl lc = LedControl({0}, {1}, {2}, 1); // DIN, CLK, CS, nombre de modules\n// setup() : lc.shutdown(0, false); lc.setIntensity(0, 8); lc.clearDisplay(0);\nlc.setRow(0, 0, B10100000);\nlc.setLed(0, 7, 7, true);', p.DIN, p.CLK, p.CS)),
  max7219s: maxPart(tl('Afficheur de 8 chiffres de 7 segments et son pilote MAX7219 : un mot de 16 bits par chiffre, décodage des chiffres possible (code B), luminosité réglable. Plusieurs modules se chaînent par DOUT.'),
    [tl('LedControl : lc.setDigit(module, position, chiffre, point) ; la position 0 est le chiffre de droite. lc.setChar() affiche aussi quelques lettres (A à F, H, L, P, -).')],
    p => tl('LedControl lc = LedControl({0}, {1}, {2}, 1); // DIN, CLK, CS\n// setup() : lc.shutdown(0, false); lc.setIntensity(0, 8);\nlc.setDigit(0, 0, 7, false); // chiffre de droite\nlc.setDigit(0, 1, 2, true);  // avec le point', p.DIN, p.CLK, p.CS)),
  tm1637: {
    what: tl('Afficheur de 4 chiffres de 7 segments et deux-points piloté par un TM1637 : deux fils (CLK, DIO), un protocole proche de l’I2C sans adresse. Les résistances de tirage sont sur le module.'),
    pins: [
      io('CLK', OUT, tl('Horloge'), tl('Horloge du protocole à deux fils : la carte la tire à la masse ou la relâche (la résistance du module la remonte).'), { lv5: true, idle: 1 }),
      io('DIO', 'io', tl('Données'), tl('Données dans les deux sens : la puce y répond (acquittement) après chaque octet. Tirée au VCC du module au repos.'), { lv5: true, idle: 1 }),
      pwr('VCC', [4.5, 5.5], tl('5 V (4,5 à 5,5 V d’après la fiche). CLK et DIO remontent alors à 5 V : sur une carte 3,3 V, passez par un adaptateur de niveau.'), 'titanTm1637'),
      gnd()
    ],
    notes: [tl('TM1637Display : appelez setBrightness(0 à 7) avant le premier affichage ; sans lui, la luminosité de départ éteint l’afficheur.'), tl('showNumberDecEx(1234, 0b01000000, true) allume le deux-points (bit 7 du deuxième chiffre).')],
    lib: 'TM1637 (Avishay Orpaz)', ds: 'titanTm1637',
    code: p => tl('TM1637Display afficheur({0}, {1}); // CLK, DIO\n// setup() : afficheur.setBrightness(5);\nafficheur.showNumberDecEx(1230, 0b01000000, true); // 12:30', p.CLK, p.DIO)
  },
  lcd2004: {
    what: tl('Écran LCD 20 caractères × 4 lignes avec adaptateur I2C (PCF8574), adresse 0x27 (0x3F avec une puce PCF8574A). Même contrôleur HD44780 que le 16 × 2.'),
    pins: [gnd(), pwr('VCC', [4.7, 5.5], tl('Le contraste et le rétroéclairage demandent 5 V.'), 'newhavenLcd2004'), io('SDA', 'sda', 'I2C SDA', tl('Données du bus I2C.'), { lv5: true }), io('SCL', 'scl', 'I2C SCL', tl('Horloge du bus I2C.'), { lv5: true })],
    notes: [tl('Les lignes 3 et 4 prolongent les lignes 1 et 2 dans la mémoire de l’écran : un texte trop long sur la ligne 1 continue sur la ligne 3. Placez le curseur avec setCursor(colonne, ligne).')],
    lib: 'LiquidCrystal_I2C', ma: 18, ds: 'newhavenLcd2004',
    code: () => `LiquidCrystal_I2C lcd(0x27, 20, 4);\n// setup() : lcd.init(); lcd.backlight();\nlcd.setCursor(0, 3);\nlcd.print("Ligne 4");`
  },
  st7735: tftPart(tl('Écran TFT couleur 1,8" (128 × 160 points, 65 536 couleurs) et son contrôleur ST7735, en SPI. Module à régulateur 3,3 V : VCC en 5 V, mais ses entrées logiques sont en 3,3 V.'), 'SDA', 'sitronixSt7735',
    p => tl('Adafruit_ST7735 tft = Adafruit_ST7735({0}, {1}, {2}); // CS, DC, RESET (SDA sur MOSI, SCK sur SCK)\n// setup() : tft.initR(INITR_BLACKTAB); tft.fillScreen(ST77XX_BLACK);\ntft.setTextColor(ST77XX_WHITE);\ntft.print("Bonjour");', p.CS, p.DC, p.RESET || -1), 'Adafruit ST7735 and ST7789 Library + Adafruit GFX'),
  ili9341: tftPart(tl('Écran TFT couleur 2,8" (240 × 320 points) et son contrôleur ILI9341, en SPI. Module à régulateur 3,3 V : VCC en 5 V, mais ses entrées logiques sont en 3,3 V.'), 'MOSI', 'ilitekIli9341',
    p => tl('Adafruit_ILI9341 tft = Adafruit_ILI9341({0}, {1}, {2}); // CS, DC, RESET\n// setup() : tft.begin(); tft.fillScreen(ILI9341_BLACK);\ntft.fillCircle(120, 160, 40, ILI9341_RED);', p.CS, p.DC, p.RESET || -1), 'Adafruit ILI9341 + Adafruit GFX', true),

  /* ---------- Horloges et mémoires (sim/storage.js, sim/sdcard.js) ---------- */
  ds3231: {
    what: tl('Horloge temps réel DS3231 (module ZS-042) : date et heure gardées par une pile, quartz compensé en température (±2 ppm, une minute par an), deux alarmes, thermomètre. Adresse 0x68 ; la mémoire AT24C32 du module répond en 0x57.'),
    pins: [
      pwr('VCC', [2.3, 5.5], tl('2,3 à 5,5 V : à la tension de la carte (les résistances de tirage de SDA et SCL remontent à VCC).'), 'maximDs3231'),
      gnd(), ...i2c({ lv5: true }),
      { ...nc('SQW', tl('Signal carré (1 Hz à 8 kHz) ou sortie d’alarme active à l’état bas (INT), drain ouvert.')), role: tl('Signal carré / alarme') },
      { ...nc('32K', tl('Sortie 32 768 Hz (drain ouvert).')), role: '32K' }
    ],
    notes: [tl('Dans la simulation, l’horloge démarre à l’heure de l’ordinateur et avance avec le temps simulé. rtc.adjust(DateTime(F(__DATE__), F(__TIME__))) la règle à l’heure de la compilation.'),
      tl('Module ZS-042 : son circuit de charge (résistance de 200 Ω et diode) est prévu pour une pile rechargeable LIR2032 ; avec une pile CR2032, retirez la résistance ou la diode.')],
    lib: 'RTClib (Adafruit)', ma: 0.2, ds: 'maximDs3231',
    code: () => tl('RTC_DS3231 rtc;\n// setup() : rtc.begin(); if (rtc.lostPower()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));\nDateTime t = rtc.now();\nSerial.println(t.timestamp());\nSerial.println(rtc.getTemperature());')
  },
  ds1307: {
    what: tl('Horloge temps réel DS1307 (module Tiny RTC) : date et heure gardées par une pile, 56 octets de RAM sauvegardée. Adresse 0x68. Moins précise que le DS3231 (quartz non compensé).'),
    pins: [
      pwr('VCC', [4.5, 5.5], tl('4,5 à 5,5 V : le DS1307 ne fonctionne pas en 3,3 V (il passe sur la pile et ne répond plus).'), 'maximDs1307'),
      gnd(), ...i2c({ lv5: true }),
      { ...nc('SQW', tl('Signal carré (1 Hz à 32 kHz), drain ouvert.')), role: tl('Signal carré') },
      { ...nc('DS', tl('Sonde de température DS18B20 facultative du module, non soudée.')), role: 'DS18B20' }
    ],
    notes: [tl('Dans la simulation, l’horloge démarre à l’heure de l’ordinateur et avance avec le temps simulé. isrunning() rend 0 si le bit CH arrête l’oscillateur.')],
    lib: 'RTClib (Adafruit)', ma: 1.5, ds: 'maximDs1307',
    code: () => tl('RTC_DS1307 rtc;\n// setup() : rtc.begin(); if (!rtc.isrunning()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));\nDateTime t = rtc.now();\nSerial.print(t.hour()); Serial.print(\':\'); Serial.println(t.minute());')
  },
  at24c256: {
    what: tl('Mémoire EEPROM AT24C256 de 32 Ko en I2C, adresse 0x50 à 0x57 selon A0 à A2 : elle garde ses données sans alimentation (un million d’écritures par octet). Contenu gardé avec le projet.'),
    pins: [
      pwr('VCC', [1.7, 5.5], tl('1,7 à 5,5 V : à la tension de la carte.'), 'microchipAt24c256'),
      gnd(), ...i2c({ lv5: true }),
      { ...nc('WP', tl('Protection d’écriture : à la masse ou libre (tirée à la masse sur le module), la mémoire s’écrit. Non simulée.')), role: tl('Protection d’écriture') },
      ...['A0', 'A1', 'A2'].map((k, i) => ({ ...nc(k, tl('Bit {0} de l’adresse : au VCC, il vaut 1 ; à la masse ou libre, 0. Jusqu’à 8 mémoires sur le même bus.', i)), role: tl('Adresse') }))
    ],
    notes: [tl('Écriture par pages de 64 octets : au-delà de la fin de la page, l’adresse revient à son début. Après chaque écriture, la puce n’acquitte plus son adresse pendant 5 ms au plus (cycle d’écriture).'),
      tl('Bibliothèque I2C_eeprom : writeBlock() découpe par page et attend la fin de chaque cycle d’écriture.')],
    lib: 'I2C_EEPROM (Rob Tillaart)', ma: 3, ds: 'microchipAt24c256',
    code: () => tl('I2C_eeprom memoire(0x50, I2C_DEVICESIZE_24LC256);\n// setup() : Wire.begin(); memoire.begin();\nmemoire.writeByte(0, 42);\nSerial.println(memoire.readByte(0));')
  },
  sdcard: {
    what: tl('Lecteur de carte microSD en SPI, avec régulateur 3,3 V et adaptateur de niveau (74LVC125) : il se branche sur une carte 5 V. Les fichiers de la carte simulée sont gardés avec le projet (512 Ko au plus).'),
    pins: [
      gnd(), pwr('VCC', [4.5, 5.5], tl('4,5 à 5,5 V : le régulateur 3,3 V du module a besoin d’au moins 1,1 V de marge.'), 'ams1117'),
      ...spi(), io('CS', OUT, tl('Sélection de la carte (CS)'), tl('Sélection de la carte sur le bus SPI : à donner à SD.begin(). Sur l’Uno, D10 (SS) doit rester une sortie, même si CS est ailleurs.'))
    ],
    notes: [tl('Système de fichiers FAT16, noms courts (8 caractères, un point, 3 caractères). Les fichiers se voient et se téléchargent dans l’onglet Simulation (Cartes microSD).')],
    lib: 'SD', ma: 100, ds: 'sdaPhysical',
    code: p => tl('#include <SD.h>\n// setup() : if (!SD.begin({0})) Serial.println("Carte absente");\nFile f = SD.open("JOURNAL.TXT", FILE_WRITE);\nif (f) { f.println("Bonjour"); f.close(); }', p.CS)
  },

  /* ---------- Alimentation ---------- */
  bat9v: battery(9, tl('Pile 9 V.')),
  // Alimentation 24 V continu des automatismes (bloc sur rail DIN) : une source, comme le module MB102, sans broche
  // à câbler vers la carte ; les bobines d'électrovanne s'y branchent par leur étage de commande.
  psu24: { what: tl('Alimentation 24 V continu (bloc sur rail DIN, 2,5 A) : celle des distributeurs pneumatiques et des automatismes. Son 0 V se relie à la masse de la carte ; le 24 V ne va jamais sur une broche de la carte.') },
  coil24: {
    what: tl('Électrovanne : la bobine 24 V d’un distributeur pneumatique. Alimentée, elle fait basculer le distributeur ; son repère (Y1, Y2…) la relie au plan de travail pneumatique.'),
    // Étage de commande : + au 24 V de l'alimentation, − au collecteur d'un PN2222A (125 mA), diode de roue libre.
    stage: { q: 'pn2222', base: 'res-1k', flyback: 'diode', src: 'psu24', need: 'out' },
    pins: [
      { pin: '+', kind: 'drv', role: tl('Plus'), why: tl('Vers le + 24 V de l’alimentation, avec la cathode de la diode de roue libre.') },
      { pin: '-', kind: 'drv', role: tl('Moins'), why: tl('Vers le collecteur du transistor qui commande la bobine : la carte ne fournit ni 24 V ni 125 mA.') }
    ],
    notes: [tl('24 V continu, 3,0 W (≈ 125 mA) : commandée par un transistor ou un relais, avec une alimentation 24 V et la masse commune.'), tl('Câblage automatique : + au 24 V, − au collecteur d’un PN2222A, base par 1 kΩ vers une broche, diode de roue libre aux bornes de la bobine.')]
  },
  pressostat: {
    what: tl('Pressostat (contact) : il ferme son contact quand la pression de l’air atteint son seuil. Son repère (S1, S2…) le relie au pressostat du plan de travail pneumatique, où se règle le seuil.'),
    pins: [
      io('1', 'pullup', tl('Entrée'), tl('Lue avec INPUT_PULLUP : HIGH sous le seuil, LOW quand la pression l’atteint.'), { switch: true }),
      gnd('2', tl('Ferme le circuit vers la masse quand la pression atteint le seuil.'))
    ],
    code: p => `pinMode(${p['1']}, INPUT_PULLUP);\nbool pression = digitalRead(${p['1']}) == LOW;`
  },
  cylsensor: {
    what: tl('Capteur de position de vérin (contact ILS) : l’aimant du piston ferme le contact quand il passe devant. Son repère (B1, B2…) le place sur un vérin du plan de travail pneumatique.'),
    pins: [
      io('1', 'pullup', tl('Entrée'), tl('Lue avec INPUT_PULLUP : HIGH quand le piston est loin, LOW quand il est devant le capteur.'), { switch: true }),
      gnd('2', tl('Ferme le circuit vers la masse quand le piston est devant le capteur.'))
    ],
    code: p => `pinMode(${p['1']}, INPUT_PULLUP);\nbool piston = digitalRead(${p['1']}) == LOW;`
  },
  bat18650: battery(3.7, tl('Accu lithium 18650 : 3,7 V nominal, 4,2 V chargé.'), [tl('Un accu lithium se recharge avec un module dédié (TP4056), jamais directement.')]),
  mb102: { what: tl('Module d’alimentation pour breadboard : fournit 5 V et 3,3 V à partir d’un bloc de 6,5 à 12 V. Il s’enfiche directement sur les rails de la breadboard.') },
  lm7805: { what: tl('Régulateur linéaire 5 V : IN de 7 à 35 V, GND, OUT à 5 V. Ajoutez 100 nF en entrée et en sortie ; il chauffe d’autant plus que l’écart de tension est grand.') },
  // Modules d'alimentation : leur sortie (nc + to) se relie au montage qu'ils alimentent, jamais à une broche de la carte.
  ams1117: {
    what: tl('Module régulateur AMS1117-3.3 : un régulateur linéaire à faible chute qui donne 3,3 V (1 A au plus) à partir de 4,5 à 15 V. Idéal pour alimenter un ESP32, un ESP8266 ou des modules 3,3 V depuis le 5 V.'),
    pins: [
      pwr('IN', [4.5, 15], tl('Entrée : au moins 3,3 V + 1,1 V de chute (≈ 4,5 V), 15 V au plus. Plus l’écart est grand, plus il chauffe.'), 'ams1117'),
      gnd('GND', tl('Masse commune à l’entrée, à la sortie et à la carte.')),
      { ...nc('OUT', tl('Sortie 3,3 V : vers le 3V3 des modules ou d’une carte alimentée sans USB. Jamais vers une broche de signal.')), role: tl('Sortie 3,3 V'), to: tl('Montage à alimenter en 3,3 V') }
    ],
    notes: [
      tl('Chute de tension : il lui faut au moins 1,1 V de plus en entrée qu’en sortie (1,3 V au pire à 0,8 A). Sur un accu lithium (3,7 V), la sortie tombe à ≈ 2,6 V : l’ESP32 redémarre sans cesse.'),
      tl('Linéaire : il transforme (VIN − 3,3 V) × I en chaleur. De 12 V à 3,3 V sous 300 mA, 2,6 W : bien trop pour son petit boîtier SOT-223 ; passez par un LM2596.'),
      tl('Les condensateurs d’entrée et de sortie du module sont déjà soudés.')
    ]
  },
  lm2596: {
    what: tl('Module abaisseur LM2596 (convertisseur à découpage) : entrée de 4,5 à 40 V, sortie réglable de 1,25 à 37 V par son potentiomètre multitour, jusqu’à 3 A (2 A sans radiateur). Il ne gaspille presque rien : le courant pris à l’entrée est plus faible que celui de la sortie.'),
    pins: [
      pwr('IN+', [4.5, 40], tl('Entrée + : batterie 12 V, alimentation 24 V… Au moins 1,5 V de plus que la sortie réglée, 40 V au plus.'), 'onsemiLm2596', tl('Entrée +')),
      gnd('IN-', tl('Entrée − : la masse de l’alimentation. Reliée à OUT− sur le module.')),
      { ...nc('OUT+', tl('Sortie + : la tension réglée (5 V par défaut), vers le 5V ou le VIN de la carte, ou vers les moteurs et rubans de LED.')), role: tl('Sortie +'), to: tl('Montage à alimenter (tension réglée)') },
      gnd('OUT-', tl('Sortie − : masse commune avec la carte et le montage.'))
    ],
    notes: [
      tl('Réglez la tension de sortie (panneau de sélection, « Tension de sortie ») avant de brancher la carte : un module neuf sort souvent bien plus que 5 V.'),
      tl('Rendement ≈ 85 % : 12 V → 5 V sous 2 A ne demande à la batterie que ≈ 1 A (5 V × 2 A ÷ (0,85 × 12 V)).'),
      tl('Ne croisez pas IN et OUT : alimenté par sa sortie, le module ne régule rien et peut être détruit.')
    ]
  },
  mt3608: {
    what: tl('Module élévateur MT3608 (convertisseur à découpage) : entrée de 2 à 24 V, sortie réglable jusqu’à 28 V, toujours au-dessus de l’entrée. Il tire d’un accu lithium les 5, 9 ou 12 V qu’il faut ; l’entrée fournit alors plus de courant que la sortie.'),
    pins: [
      pwr('IN+', [2, 24], tl('Entrée + : accu lithium 3,7 V, deux piles AA, le 5 V de l’USB… 2 à 24 V.'), 'aerosemiMt3608', tl('Entrée +')),
      gnd('IN-', tl('Entrée − : la masse de la source. Reliée à OUT− sur le module.')),
      { ...nc('OUT+', tl('Sortie + : la tension réglée (9 V par défaut), vers le montage à alimenter.')), role: tl('Sortie +'), to: tl('Montage à alimenter (tension réglée)') },
      gnd('OUT-', tl('Sortie − : masse commune avec la carte et le montage.'))
    ],
    notes: [
      tl('Il ne sait que monter : réglée sous la tension d’entrée, la sortie suit l’entrée moins ≈ 0,4 V (diode Schottky).'),
      tl('Puissance conservée au rendement près (≈ 90 %) : 5 V × 0,5 A en sortie depuis un accu de 3,7 V lui demandent ≈ 0,75 A. Au-delà de 2 A en entrée il chauffe, et son interrupteur interne coupe vers 4 A.'),
      tl('Réglez la sortie (panneau de sélection, « Tension de sortie ») avant de brancher quoi que ce soit : jusqu’à 28 V.')
    ]
  },
  tp4056: {
    what: tl('Module chargeur TP4056 avec protection DW01 : il charge un accu lithium 18650 (une cellule) à 1 A au plus jusqu’à 4,2 V, depuis le 5 V d’une prise USB, et protège l’accu (surdécharge, surintensité, court-circuit). La charge se branche sur OUT+ et OUT−.'),
    pins: [
      { ...nc('IN+', tl('Entrée + : 5 V (prise USB du module, ou 4,5 à 8 V sur cette borne). Sans entrée, le module ne fait que protéger l’accu.')), role: tl('Entrée 5 V'), to: tl('Alimentation 5 V (USB)') },
      gnd('IN-', tl('Entrée − : masse de l’alimentation USB, reliée à B− sur le module.')),
      { ...nc('B+', tl('Vers le + de l’accu 18650 (une seule cellule).')), role: tl('Accu +'), to: tl('+ de l’accu 18650') },
      gnd('B-', tl('Vers le − de l’accu.')),
      { ...nc('OUT+', tl('Sortie + : la tension de l’accu (3,0 à 4,2 V), vers le montage, par exemple l’entrée d’un MT3608 pour obtenir 5 V.')), role: tl('Sortie +'), to: tl('Montage alimenté par l’accu') },
      gnd('OUT-', tl('Sortie − : la masse du montage, coupée par la protection quand l’accu est trop déchargé ou en court-circuit.'))
    ],
    notes: [
      tl('Deux voyants : rouge pendant la charge, bleu (ou vert) quand l’accu est plein.'),
      tl('Branchez le montage sur OUT+ et OUT−, pas sur B+ et B− : seule la sortie passe par la protection du DW01.'),
      tl('Courant de charge réglé à 1 A par la résistance RPROG de 1,2 kΩ : pour un petit accu (moins de 1000 mAh), remplacez-la (≈ 3,3 kΩ pour 400 mA).'),
      tl('Pendant la charge, le montage relié à OUT+ prend sa part du courant : la fin de charge (courant tombé à 100 mA) peut ne jamais arriver.')
    ]
  },
  solar6v: {
    what: tl('Petit panneau solaire 6 V 1 W : en plein soleil, ≈ 6 V et 180 mA au point de puissance maximale, 7,7 V à vide. Son courant suit la lumière : à l’intérieur, il ne donne presque rien.'),
    pins: [
      { ...nc('+', tl('Borne + : vers l’entrée d’un chargeur (TP4056) ou d’un régulateur, par une diode si un accu y est relié directement.')), role: tl('Plus'), to: tl('Chargeur ou régulateur') },
      gnd('-', tl('Borne − : la masse commune du montage.'))
    ],
    notes: [
      tl('Simulation : son éclairement suit la lumière de l’onglet Simulation (100 000 lx ≈ plein soleil, 1000 W/m²). Le courant de court-circuit est proportionnel à la lumière ; la tension à vide baisse peu.'),
      tl('Une source de courant, pas de tension : sous une charge trop gourmande, sa tension s’effondre.'),
      tl('Ne le reliez pas directement à un accu sans chargeur ni diode : la nuit, l’accu se décharge dans le panneau.')
    ],
    code: () => tl('// Tension du panneau sur A0 par un pont diviseur 10 kΩ / 10 kΩ (7,7 V à vide → 3,85 V : sur une carte 3,3 V, prenez 22 kΩ / 10 kΩ)\nfloat panneau = analogRead(A0) * (5.0 / 1023.0) * 2;')
  },

  /* ---------- Communication ---------- */
  hc05: {
    what: tl('Module Bluetooth classique (SPP) : une liaison série sans fil, 9600 bauds par défaut.'),
    pins: [
      nc('STATE', tl('Indique si un appareil est connecté : facultative.')),
      io('RXD', 'rx', tl('Série RX'), tl('Reçoit ce que la carte envoie : les liaisons série se croisent, TX de la carte vers RX du module.'), { lv3: true }),
      io('TXD', 'tx', tl('Série TX'), tl('Envoie vers l’entrée RX de la carte.')),
      gnd(), pwr('VCC', [3.6, 6], tl('Le module a un régulateur 3,3 V intégré.'), 'hc05Zs040'),
      nc('EN', tl('Passage en mode commandes AT pour la configuration : facultative.'))
    ],
    ma: 40, ds: 'hc05Manual',
    code: (p, prof) => { const s = serialCode(prof, p, 9600), port = (/^SoftwareSerial (\w+)/.exec(s) || /^(\w+)\.begin/.exec(s) || [])[1] || 'Serial2'; return `${s}\n${tl('// téléphone → carte : if ({0}.available()) { char c = {0}.read(); }\n// carte → téléphone : {0}.println("Bonjour");', port)}`; }
  },
  rc522: {
    what: tl('Lecteur RFID 13,56 MHz (cartes et badges MIFARE), en SPI.'),
    pins: [
      io('SDA', 'ss', 'SPI SS', tl('Sélection du module sur le bus SPI (nommée SDA sur ce module).'), { lv3: true }),
      ...spi({ lv3: true }),
      nc('IRQ', tl('Interruption : la bibliothèque MFRC522 ne s’en sert pas.')),
      gnd(),
      io('RST', OUT, tl('Reset'), tl('Remise à zéro du lecteur au démarrage.'), { lv3: true }),
      pwr('3.3V', [3.0, 3.6], tl('Puce 3,3 V : ne la reliez jamais à 5 V.'), 'nxpMfrc522')
    ],
    lib: 'MFRC522', ma: 26, ds: 'nxpMfrc522',
    code: p => `MFRC522 rfid(${p.SDA}, ${p.RST});\n// setup() : SPI.begin(); rfid.PCD_Init();\nif (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {\n  for (byte i = 0; i < rfid.uid.size; i++) Serial.print(rfid.uid.uidByte[i], HEX);\n  Serial.println();\n  rfid.PICC_HaltA();\n}`
  },
  nrf24: {
    what: tl('Module radio 2,4 GHz nRF24L01, en SPI.'),
    pins: [
      gnd(), pwr('VCC', [1.9, 3.6], tl('Puce 3,3 V : ses entrées tolèrent le 5 V, mais pas son alimentation.'), 'nordicNrf24'),
      io('CE', OUT, 'CE', tl('Active l’émission ou la réception.')),
      io('CSN', 'ss', 'SPI CSN', tl('Sélection du module sur le bus SPI.')),
      ...spi(),
      nc('IRQ', tl('Interruption : facultative.'))
    ],
    notes: [tl('Ajoutez un condensateur de 10 µF entre VCC et GND au plus près du module : les pointes de courant en émission font sinon décrocher la radio.')],
    lib: 'RF24', ma: 14, ds: 'nordicNrf24',
    code: p => tl('RF24 radio({0}, {1});\nconst byte adresse[6] = "00001";\n// émetteur, setup() : radio.begin(); radio.openWritingPipe(adresse); radio.stopListening();\nint valeur = 42;\nradio.write(&valeur, sizeof(valeur));\n// récepteur, setup() : radio.begin(); radio.openReadingPipe(1, adresse); radio.startListening();\n// loop() : if (radio.available()) radio.read(&valeur, sizeof(valeur));', p.CE, p.CSN)
  },
  sx1278: {
    what: tl('Module radio LoRa Ra-02 (puce Semtech SX1278, 433 MHz), en SPI : de petits paquets (255 octets au plus) jusqu’à plusieurs kilomètres en champ libre, au prix d’un débit très faible. Deux modules réglés pareil (fréquence, facteur d’étalement, bande, mot de synchronisation) se parlent.'),
    pins: [
      gnd(), pwr('3.3V', [1.8, 3.7], tl('Puce 3,3 V seulement (3,7 V au plus) : le 5 V la détruit. En émission à +20 dBm, elle tire jusqu’à 120 mA : la broche 3V3 d’un Pico ou d’un ESP32 suffit, pas celle d’un Uno (50 mA) ; prenez alors un régulateur AMS1117 3,3 V.'), 'semtechSx1278'),
      io('RST', OUT, tl('Reset'), tl('Remise à zéro de la puce au démarrage (LoRa.begin() la fait). Entrée 3,3 V.'), { lv3: true, opt: true }),
      io('DIO0', IN, tl('Interruption DIO0'), tl('Passe à HIGH à la fin d’une réception (RxDone) ou d’une émission (TxDone) : LoRa.onReceive() s’en sert, sur une broche à interruption (D2 ou D3 sur l’Uno).'), { opt: true }),
      io('NSS', 'ss', 'SPI NSS', tl('Sélection du module sur le bus SPI (LoRa.setPins(nss, rst, dio0) : 10, 9 et 2 par défaut).'), { lv3: true }),
      ...spi({ lv3: true }),
      nc('DIO1', tl('Autres interruptions (fin d’attente, saut de fréquence) : la bibliothèque LoRa ne s’en sert pas.')),
      nc('DIO2', tl('Autres interruptions (fin d’attente, saut de fréquence) : la bibliothèque LoRa ne s’en sert pas.'))
    ],
    notes: [tl('Ses entrées ne tolèrent pas le 5 V : sur un Uno, un Nano ou un Mega, passez NSS, SCK, MOSI et RST par un adaptateur de niveau (ou des ponts diviseurs). MISO et DIO0 sortent du 3,3 V, que la carte 5 V lit bien.'),
      tl('Ne l’alimentez jamais en émission sans antenne : l’énergie renvoyée peut abîmer l’étage de sortie.'),
      tl('Le Ra-02 couvre 410 à 525 MHz : LoRa.begin(433E6). 868E6 et 915E6 sont pour les modules SX1276.')],
    // ma : réception (IDDR_L ≈ 11,5 mA à 433 MHz), l'état de repos du budget ; les pointes d'émission (120 mA à +20 dBm) sont dans le texte.
    lib: 'LoRa (Sandeep Mistry)', ma: 120, ds: 'semtechSx1278', // pointe d'émission à +20 dBm : c'est elle qui fait tomber une alimentation trop faible
    code: p => tl('#include <LoRa.h>\n// setup() : LoRa.setPins({0}, {1}, {2}); // NSS, RST, DIO0\nif (!LoRa.begin(433E6)) Serial.println("LoRa absent");\n// émetteur :\nLoRa.beginPacket(); LoRa.print("Bonjour"); LoRa.endPacket();\n// récepteur, loop() :\nif (LoRa.parsePacket()) { Serial.print(LoRa.readString()); Serial.println(LoRa.packetRssi()); }', p.NSS, p.RST || -1, p.DIO0 || -1)
  },
  sim800: {
    what: tl('Module GSM SIM800L : SMS, appels et données 2G, piloté par commandes AT sur une liaison série.'),
    pins: [
      nc('NET', tl('Antenne : rien à relier à la carte.')),
      { pin: 'VCC', kind: 'ext', v: [3.4, 4.4], ds: 'simcomSim800l', src: 'bat18650', gndPin: 'GND', role: tl('Alimentation'), why: tl('Pointes de 2 A en émission entre 3,4 et 4,4 V : ni le 3,3 V ni le 5 V de la carte ne conviennent. Un accu 18650 est idéal.') },
      nc('RST', tl('Remise à zéro : facultative.')),
      io('RXD', 'rx', tl('Série RX'), tl('Reçoit ce que la carte envoie (TX de la carte vers RX du module).'), { lv3: true }),
      io('TXD', 'tx', tl('Série TX'), tl('Envoie vers l’entrée RX de la carte.')),
      gnd('GND', tl('Relié à la fois à l’accu et à la carte : masse commune.'))
    ],
    ma: 500, ds: 'simcomSim800l',
    code: (p, prof) => { const s = serialCode(prof, p, 9600), port = (/^SoftwareSerial (\w+)/.exec(s) || /^(\w+)\.begin/.exec(s) || [])[1] || 'Serial2'; return `${s}\n${tl('{0}.println("AT+CMGF=1"); // SMS en mode texte\n{0}.println("AT+CMGS=\\"+221770000000\\"");\n{0}.print("Bonjour");\n{0}.write(26); // Ctrl+Z : le SMS part', port)}`; }
  },

  neo6m: {
    what: tl('Module GPS u-blox NEO-6M (GY-NEO6MV2) : position, heure UTC, vitesse et cap, envoyés en trames NMEA sur une liaison série à 9600 bauds, une salve par seconde. Il lui faut le ciel : à froid, une trentaine de secondes avant la première position.'),
    pins: [
      pwr('VCC', [3, 5.5], tl('3 à 5 V : le module a un régulateur 3,3 V.'), 'neo6mUblox'),
      io('RX', 'rx', tl('Série RX'), tl('Reçoit les commandes de configuration (UBX) : facultative, le GPS parle seul dès sa mise sous tension. Sur une carte 5 V, un pont diviseur la protège.'), { lv3: true, opt: true }),
      io('TX', 'tx', tl('Série TX'), tl('Trames NMEA vers l’entrée RX de la carte (port série matériel ou SoftwareSerial), 9600 bauds.')),
      gnd()
    ],
    notes: [tl('Simulation : position, vitesse, cap et durée du démarrage à froid se règlent dans l’onglet Simulation (carte « GPS »), Dakar par défaut ; 5 s de démarrage au lieu d’une trentaine.'), tl('Lisez le GPS sans attendre : une salve de 450 octets arrive chaque seconde, plus que le tampon de 64 octets de SoftwareSerial. Évitez les longs delay() dans loop().')],
    lib: 'TinyGPSPlus', ma: 47, ds: 'neo6mUblox',
    code: (p, prof) => { const s = serialCode(prof, { TXD: p.TX, RXD: p.RX || 3 }, 9600), port = (/^SoftwareSerial (\w+)/.exec(s) || /^(\w+)\.begin/.exec(s) || [])[1] || 'Serial1'; return `TinyGPSPlus gps;\n${s}\n${tl('// loop() : while ({0}.available()) gps.encode({0}.read());\nif (gps.location.isUpdated()) { Serial.print(gps.location.lat(), 6); Serial.print(" "); Serial.println(gps.location.lng(), 6); }', port)}`; }
  },
  hc12: {
    what: tl('Radio HC-12 (SI4463, 433 MHz) : une liaison série sans fil transparente entre deux modules réglés sur le même canal, jusqu’à 1 km en champ libre. 9600 bauds par défaut ; SET à LOW pour les commandes AT.'),
    pins: [
      pwr('VCC', [3.2, 5.5], tl('3,2 à 5,5 V : en émission à pleine puissance, il tire jusqu’à 100 mA ; ajoutez un condensateur de 100 µF près du module.'), 'hc12Manual'),
      gnd(),
      io('RXD', 'rx', tl('Série RX'), tl('Ce que la carte envoie part par la radio (TX de la carte vers RXD du module).')),
      io('TXD', 'tx', tl('Série TX'), tl('Ce qui arrive par la radio, vers l’entrée RX de la carte.')),
      io('SET', OUT, 'SET', tl('À LOW : mode commandes AT, à 9600 bauds (AT+C001 à AT+C127 pour le canal, AT+B9600 pour la vitesse, AT+RX pour lire les réglages). Libre ou à HIGH : liaison transparente. Tirée au niveau haut sur le module.'), { opt: true })
    ],
    notes: [tl('Deux HC-12 ne se parlent que sur le même canal (433,4 MHz + 0,4 MHz par canal) et au même débit radio, fixé par leur vitesse série : 1200/2400, 4800/9600, 19200/38400 ou 57600/115200 bauds.'), tl('Canal et vitesse sont gardés par le module, comme dans sa mémoire flash : ils restent après l’arrêt de la simulation.')],
    ma: 100, ds: 'hc12Manual',
    code: (p, prof) => { const s = serialCode(prof, p, 9600), port = (/^SoftwareSerial (\w+)/.exec(s) || /^(\w+)\.begin/.exec(s) || [])[1] || 'Serial1'; return `${s}\n${tl('// émetteur : {0}.println("Bonjour");\n// récepteur : while ({0}.available()) Serial.write({0}.read());', port)}`; }
  },
  max485: {
    what: tl('Module RS-485 MAX485 : transforme une liaison série en signal différentiel sur une paire A/B, jusqu’à 1200 m et 32 appareils sur le même bus. Semi-duplex : DE et /RE choisissent si le module émet ou écoute.'),
    pins: [
      io('RO', 'tx', tl('Sortie du récepteur'), tl('Ce qui passe sur la paire, vers l’entrée RX de la carte, quand /RE est à LOW.')),
      io('RE', OUT, '/RE', tl('Réception active à LOW. Le plus souvent reliée à DE, sur une seule broche de la carte : LOW pour écouter, HIGH pour émettre.')),
      io('DE', OUT, 'DE', tl('Émission active à HIGH : le module pilote la paire avec ce qui arrive sur DI. Remettez-la à LOW dès l’envoi fini (Serial.flush()), sinon personne d’autre ne peut répondre.')),
      io('DI', 'rx', tl('Entrée du pilote'), tl('Ce que la carte envoie (sa broche TX), transmis sur la paire quand DE est à HIGH.')),
      pwr('VCC', [4.75, 5.25], tl('5 V : le MAX485 est une puce 5 V (4,75 à 5,25 V).'), 'maximMax485'),
      { pin: 'B', kind: 'contact', role: tl('Ligne B (−)'), why: tl('Ligne inverseuse de la paire RS-485 : B de tous les modules ensemble.') },
      { pin: 'A', kind: 'contact', role: tl('Ligne A (+)'), why: tl('Ligne non inverseuse de la paire : A de tous les modules ensemble. A et B croisés : les bits arrivent inversés.') },
      gnd()
    ],
    notes: [tl('Aux deux bouts d’un long bus, une résistance de 120 Ω entre A et B (soudée sur le module) évite les échos.'), tl('Dans la simulation, les octets passent d’un module à l’autre à la vitesse de l’émetteur ; l’analyseur de bus les montre sur chaque carte.')],
    ma: 0.9, ds: 'maximMax485',
    code: (p, prof) => { const s = serialCode(prof, { TXD: p.RO, RXD: p.DI }, 9600), port = (/^SoftwareSerial (\w+)/.exec(s) || /^(\w+)\.begin/.exec(s) || [])[1] || 'Serial1'; return `${s}\n${tl('pinMode({1}, OUTPUT); // DE et /RE reliées\n// émettre : digitalWrite({1}, HIGH); {0}.println("?T"); {0}.flush(); digitalWrite({1}, LOW);\n// écouter : while ({0}.available()) Serial.write({0}.read());', port, p.DE)}`; }
  },

  /* ---------- Prototypage ---------- */
  breadboard: { what: tl('Breadboard : dans chaque colonne, les trous a à e sont reliés entre eux, de même que f à j. Les rails + et − courent sur toute la longueur.') },
  'breadboard-mini': { what: tl('Mini breadboard : dans chaque colonne, les trous a à e sont reliés entre eux, de même que f à j. Pas de rails d’alimentation.') },

  /* ---------- Analogique (analog-parts.js) ---------- */
  ...ANALOG_PARTS
};
