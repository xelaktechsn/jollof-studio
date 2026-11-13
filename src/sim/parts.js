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
  vibro: { plus: '+', minus: '-', r: 37, vNom: 3, vStart: 0.8, vMax: 4, rpm: 12000 }
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
  pn2222: { ic: { warn: 500, max: 600 }, vce: 40, p: 625, beta: 100, rsat: 0.6, src: 'onsemiPn2222a' }
};
export const isNpn = c => !!(c && NPNS[c.type]);

const OUT = 'out', IN = 'in';
const gnd = (pin = 'GND', why) => ({ pin, kind: 'gnd', why });
const pwr = (pin, v, why, ds) => ({ pin, kind: 'pwr', v, why, ...(ds && { ds }) });
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

const resistor = what => ({ what: tl('{0} Pas de câblage type : elle s’insère dans un montage (limiter le courant d’une LED, tirer une entrée vers un niveau, pont diviseur).', what) });
const battery = (volt, what, notes = []) => ({
  what, volts: volt, notes,
  pins: [{ pin: '+', kind: 'vin', role: tl('Alimentation'), why: tl('Vers l’entrée de la carte qui passe par son régulateur.') }, gnd('-', tl('Masse commune avec la carte.'))]
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
    lib: 'Adafruit BMP280', ma: 1, ds: 'boschBmp280',
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
    lib: 'Adafruit BME280', ma: 1, ds: 'boschBme280',
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
    ma: 4, ds: 'invensenseMpu6050',
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
    pins: ['M+', 'M-'].map(k => ({ pin: k, kind: 'drv', role: tl('Moteur'), why: tl('Vers une sortie du pilote L298N : un moteur demande des centaines de mA et renvoie des pointes de tension, jamais directement sur une broche de la carte.') }))
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

  /* ---------- Prototypage ---------- */
  breadboard: { what: tl('Breadboard : dans chaque colonne, les trous a à e sont reliés entre eux, de même que f à j. Les rails + et − courent sur toute la longueur.') },
  'breadboard-mini': { what: tl('Mini breadboard : dans chaque colonne, les trous a à e sont reliés entre eux, de même que f à j. Pas de rails d’alimentation.') },

  /* ---------- Analogique (analog-parts.js) ---------- */
  ...ANALOG_PARTS
};
