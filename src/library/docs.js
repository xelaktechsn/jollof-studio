// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Documentation des composants : caractéristiques, fonctionnement, usages et erreurs
// fréquentes. Le brochage et le code d'exemple viennent des fiches de câblage
// (sim/parts.js) et des profils de cartes (sim/boards.js), pour rester cohérents
// avec le câblage automatique et la simulation.
import { BOARDS, volts, vrange } from '../sim/boards.js';
import { PARTS, MOTORS } from '../sim/parts.js';
import { limitRows } from '../check/limits.js';
import { tl, COLON } from '../i18n/index.js';

const blink = (pin, note) => `void setup() {\n  pinMode(${pin}, OUTPUT);${note ? ' // ' + note : ''}\n}\n\nvoid loop() {\n  digitalWrite(${pin}, HIGH);\n  delay(500);\n  digitalWrite(${pin}, LOW);\n  delay(500);\n}`;
const LED_DOC = {
  specs: [[tl('Diamètre'), tl('5 mm')], [tl('Courant'), tl('20 mA maximum, 5 à 15 mA suffisent')], [tl('Tension de seuil'), tl('rouge ≈ 2,0 V · jaune et verte ≈ 2,1 V · bleue et blanche ≈ 3,0 V')], [tl('Repères'), tl('anode = patte longue · cathode = patte courte, côté méplat')]],
  how: tl('Une diode qui émet de la lumière quand le courant la traverse de l’anode vers la cathode. Au-delà de sa tension de seuil, le courant grimpe très vite : la résistance en série le limite. Valeur : R = (tension de la broche − tension de seuil) ÷ courant voulu.'),
  uses: [tl('Voyant d’état (marche, erreur, connexion)'), tl('Signalisation, feux tricolores de démonstration'), tl('Premier programme : faire clignoter une LED')],
  mistakes: [tl('Pas de résistance en série : la LED et la broche de la carte souffrent.'), tl('LED montée à l’envers : elle reste éteinte.'), tl('LED bleue ou blanche sur 3,3 V avec 220 Ω : très peu lumineuse ; prenez 47 à 100 Ω.')]
};
const RES_DOC = (value, bands, uses) => ({
  specs: [[tl('Valeur'), value], [tl('Code couleur'), bands], [tl('Puissance'), '1/4 W'], [tl('Tolérance'), tl('±5 % (bague or)')]],
  how: tl('Elle s’oppose au passage du courant : U = R × I (loi d’Ohm). L’énergie freinée devient de la chaleur : P = U × I.'),
  pinout: [['1', tl('Patte, sans polarité')], ['2', tl('Patte, sans polarité')]],
  uses, mistakes: [tl('Lire le code couleur à l’envers : la bague or (tolérance) se place à droite.'), tl('Dépasser 1/4 W : elle chauffe, noircit et change de valeur.')]
});
const BREADBOARD_MISTAKES = [tl('Placer les deux pattes d’un composant dans la même colonne : il est court-circuité, rien ne le traverse.'), tl('Croire qu’une rangée a–e est reliée à la rangée f–j d’en face : la rainure centrale les sépare.')];

export const DOCS = {
  /* ---------- Cartes ---------- */
  esp32: {
    specs: [[tl('Puce'), tl('ESP32-WROOM-32, double cœur Xtensa LX6 jusqu’à 240 MHz')], [tl('Mémoire'), tl('520 Ko de SRAM, 4 Mo de flash')], [tl('Sans fil'), tl('Wi-Fi 802.11 b/g/n 2,4 GHz, Bluetooth 4.2 et BLE')], [tl('Logique'), tl('3,3 V : aucune broche ne tolère 5 V')], [tl('Alimentation'), tl('USB 5 V, ou VIN 5 à 12 V')], [tl('Analogique'), tl('ADC 12 bits (0 à 4095), 2 DAC 8 bits sur D25 et D26')], [tl('Courant par broche'), tl('20 mA conseillés, 40 mA maximum')], [tl('Autres'), tl('10 entrées tactiles, PWM sur toutes les sorties, 3 ports série')]],
    how: tl('Le microcontrôleur exécute le programme téléversé par USB (Arduino IDE avec le paquet « esp32 », ou MicroPython). Un régulateur ramène le 5 V de l’USB à 3,3 V : toutes les broches travaillent en 3,3 V. EN redémarre la carte ; BOOT la force en mode téléversement si l’outil n’y arrive pas seul.'),
    uses: [tl('Objets connectés en Wi-Fi : station météo, serveur web, envoi vers un tableau de bord'), tl('Commande par Bluetooth depuis un téléphone'), tl('Projets à plusieurs capteurs analogiques')],
    mistakes: [tl('Envoyer 5 V sur une entrée (écho du HC-SR04, sortie d’un module 5 V) : passez par un pont diviseur.'), tl('Brancher sur D12 un module qui la tire au niveau haut : la carte ne démarre plus.'), tl('Lire un capteur analogique sur l’ADC2 (D4, D13, D25…) avec le Wi-Fi actif : la lecture échoue. Préférez D32 à D39.'), tl('Téléversement qui échoue : maintenez BOOT appuyé au début du téléversement.')],
    code: blink(2, tl('LED bleue de la carte'))
  },
  nodemcu: {
    specs: [[tl('Puce'), tl('ESP8266 (module ESP-12E), 80 MHz (160 MHz possible)')], [tl('Mémoire'), tl('≈ 80 Ko de RAM pour le programme, 4 Mo de flash')], [tl('Sans fil'), tl('Wi-Fi 802.11 b/g/n 2,4 GHz, pas de Bluetooth')], [tl('Logique'), tl('3,3 V')], [tl('Alimentation'), tl('USB 5 V, ou VIN 4,5 à 10 V')], [tl('Analogique'), tl('une seule entrée, A0, 10 bits (0 à 1023 pour 0 à 3,3 V)')], [tl('Courant par broche'), tl('12 mA conseillés')]],
    how: tl('Se programme avec l’Arduino IDE (paquet « esp8266 ») : les noms D0 à D8 sont définis pour cette carte. L’ESP8266 n’a qu’un cœur, partagé avec le Wi-Fi : évitez les boucles bloquantes trop longues, appelez delay() ou yield().'),
    uses: [tl('Objet connecté Wi-Fi simple et bon marché'), tl('Prise ou interrupteur connecté'), tl('Capteur qui envoie ses mesures sur un serveur')],
    mistakes: [tl('Vouloir plusieurs capteurs analogiques : une seule entrée A0 ; ajoutez un convertisseur I2C (ADS1115).'), tl('D3, D4 ou D8 au mauvais niveau au démarrage : la carte ne démarre pas.'), tl('Utiliser SD0 à SD3, CMD ou CLK : elles appartiennent à la mémoire flash.')],
    code: blink('LED_BUILTIN', tl('LED de la carte, allumée à LOW'))
  },
  uno: {
    specs: [[tl('Puce'), tl('ATmega328P, 16 MHz')], [tl('Mémoire'), tl('32 Ko de flash, 2 Ko de SRAM, 1 Ko d’EEPROM')], [tl('Entrées/sorties'), tl('14 numériques dont 6 PWM (3, 5, 6, 9, 10, 11), 6 analogiques')], [tl('Analogique'), tl('ADC 10 bits (0 à 1023 pour 0 à 5 V)')], [tl('Logique'), '5 V'], [tl('Alimentation'), tl('USB 5 V, ou jack / VIN 7 à 12 V')], [tl('Courant'), tl('20 mA conseillés par broche, 200 mA pour l’ensemble ; sortie 3,3 V limitée à 50 mA')]],
    how: tl('Le programme est téléversé par USB grâce à un petit chargeur d’amorçage. Tout fonctionne en 5 V, ce qui rend la carte robuste et compatible avec la plupart des modules d’initiation. Pas de Wi-Fi : on ajoute un module si besoin.'),
    uses: [tl('Apprendre l’électronique et la programmation'), tl('Commander LED, moteurs et relais'), tl('Prototypes sans connexion réseau')],
    mistakes: [tl('Brancher un module 3,3 V (BMP280, RC522) sur le 5 V : il grille.'), tl('Utiliser D0 et D1 : le téléversement échoue.'), tl('Alimenter servos ou moteurs par le 5 V de la carte : redémarrages.'), tl('Seulement 2 Ko de RAM : gardez les textes en flash avec F("…").')],
    code: blink(13, tl('LED « L » de la carte'))
  },
  nano: {
    specs: [[tl('Puce'), tl('ATmega328P, 16 MHz')], [tl('Mémoire'), tl('32 Ko de flash, 2 Ko de SRAM, 1 Ko d’EEPROM')], [tl('Entrées/sorties'), tl('14 numériques dont 6 PWM, 8 analogiques (A6 et A7 analogiques seulement)')], [tl('Logique'), '5 V'], [tl('Alimentation'), tl('USB 5 V, ou VIN 7 à 12 V')], [tl('Format'), tl('18 × 45 mm, s’enfiche sur une breadboard')]],
    how: tl('Le même cœur que l’Uno dans un format compact. Les clones utilisent souvent un convertisseur USB CH340 : installez son pilote, et choisissez au besoin le processeur « ATmega328P (Old Bootloader) » pour téléverser.'),
    uses: [tl('Montages compacts ou définitifs'), tl('Projets montés entièrement sur breadboard')],
    mistakes: [tl('Téléversement qui échoue sur un clone : pilote CH340 manquant ou mauvais chargeur (« Old Bootloader »).'), tl('Utiliser A6 ou A7 en numérique : elles sont analogiques seulement.')],
    code: blink(13, tl('LED « L » de la carte'))
  },
  pico: {
    specs: [[tl('Puce'), tl('RP2040, double cœur Arm Cortex-M0+ jusqu’à 133 MHz')], [tl('Mémoire'), tl('264 Ko de SRAM, 2 Mo de flash')], [tl('Entrées/sorties'), tl('26 GPIO, 16 canaux PWM, 2 ports série, 2 I2C, 2 SPI, 8 machines PIO')], [tl('Analogique'), tl('3 entrées 12 bits (GP26 à GP28)')], [tl('Logique'), tl('3,3 V : aucune broche ne tolère 5 V')], [tl('Alimentation'), tl('USB 5 V (VBUS), ou VSYS 1,8 à 5,5 V')], [tl('LED de la carte'), 'GP25']],
    how: tl('Se programme en MicroPython ou en C/C++ (Arduino IDE avec le paquet « Raspberry Pi Pico/RP2040 »). Pour le premier téléversement, maintenez BOOTSEL en branchant l’USB : la carte apparaît comme une clé USB.'),
    uses: [tl('Apprendre MicroPython'), tl('Signaux très précis grâce aux PIO (LED WS2812, protocoles maison)'), tl('Projets à petit budget')],
    mistakes: [tl('Envoyer du 5 V sur une broche : aucune n’est tolérante.'), tl('Confondre le numéro de broche physique (1 à 40) et le numéro GPIO (GP0 à GP28) dans le code.'), tl('Mettre plus de 5,5 V sur VSYS.')],
    code: blink('LED_BUILTIN', 'GP25')
  },

  /* ---------- Prototypage ---------- */
  breadboard: {
    specs: [[tl('Points'), tl('400 : 30 colonnes de 2 × 5 trous, plus 4 rails de 25')], [tl('Pas'), tl('2,54 mm')], [tl('Fils acceptés'), tl('0,3 à 0,8 mm de diamètre')], [tl('Courant'), tl('environ 1 A par contact')]],
    how: tl('Sous chaque groupe de 5 trous, une lamelle métallique pince les pattes et les relie. La rainure centrale sépare les deux moitiés : on y place les circuits intégrés à cheval. Les rails + et − distribuent l’alimentation sur toute la longueur.'),
    pinout: [[tl('a à e'), tl('Les 5 trous d’une même colonne sont reliés')], [tl('f à j'), tl('Idem, de l’autre côté de la rainure')], ['T+ / T−', tl('Rails du haut, reliés sur toute la longueur')], ['B+ / B−', tl('Rails du bas, reliés sur toute la longueur')]],
    uses: [tl('Tester un montage sans souder'), tl('Modifier un circuit en quelques secondes')],
    mistakes: [...BREADBOARD_MISTAKES, tl('Supposer que les rails du haut et du bas sont reliés entre eux : ajoutez deux fils.')]
  },
  'breadboard-mini': {
    specs: [[tl('Points'), tl('170 : 17 colonnes de 2 × 5 trous')], [tl('Pas'), tl('2,54 mm')], [tl('Rails'), tl('aucun')]],
    how: tl('Même principe que la grande breadboard, sans rails d’alimentation : on distribue le + et le − avec des fils.'),
    pinout: [[tl('a à e'), tl('Les 5 trous d’une même colonne sont reliés')], [tl('f à j'), tl('Idem, de l’autre côté de la rainure')]],
    uses: [tl('Petit module à côté d’une carte'), tl('Montage compact')],
    mistakes: BREADBOARD_MISTAKES
  },

  /* ---------- Capteurs ---------- */
  dht11: {
    specs: [[tl('Alimentation'), tl('3,3 à 5,5 V, 0,3 mA en mesure')], [tl('Température'), tl('0 à 50 °C, ±2 °C, au degré près')], [tl('Humidité'), tl('20 à 90 %, ±5 %')], [tl('Cadence'), tl('une mesure par seconde au plus')], [tl('Interface'), tl('bus à un fil propre aux DHT')]],
    how: tl('Un élément dont la résistance varie avec l’humidité et une thermistance sont lus par une petite puce, qui envoie le résultat sur un seul fil : impulsions longues pour les 1, courtes pour les 0.'),
    uses: [tl('Thermomètre-hygromètre d’intérieur'), tl('Station météo d’initiation'), tl('Surveillance d’une serre ou d’un local')],
    mistakes: [tl('Lire plus d’une fois par seconde : valeurs répétées ou erreurs.'), tl('Le placer près de la carte ou d’un régulateur qui chauffe : mesure faussée.'), tl('Avec un DHT nu à 4 broches, oublier la résistance de tirage de 10 kΩ (le module en a déjà une).')]
  },
  dht22: {
    specs: [[tl('Alimentation'), tl('3,3 à 6 V, 1,5 mA en mesure')], [tl('Température'), tl('−40 à 80 °C, ±0,5 °C, résolution 0,1 °C')], [tl('Humidité'), tl('0 à 100 %, ±2 à 5 %, résolution 0,1 %')], [tl('Cadence'), tl('une mesure toutes les 2 s au plus')], [tl('Autre nom'), 'AM2302']],
    how: tl('Même principe que le DHT11, avec des éléments plus précis et une plage plus large. La trame de 40 bits contient l’humidité, la température et une somme de contrôle.'),
    uses: [tl('Station météo'), tl('Contrôle d’une couveuse, d’une cave ou d’une serre'), tl('Enregistreur de température')],
    mistakes: [tl('Lire toutes les secondes : la moitié des lectures échouent (NaN).'), tl('Câble de données de plus de quelques mètres : lectures instables.'), tl('Le placer en plein soleil : il mesure le soleil, pas l’air.')]
  },
  hcsr04: {
    specs: [[tl('Alimentation'), '5 V, 15 mA'], [tl('Portée'), tl('2 cm à 4 m')], [tl('Résolution'), tl('≈ 3 mm')], [tl('Angle de mesure'), '≈ 15°'], [tl('Fréquence'), '40 kHz'], [tl('Signaux'), tl('TRIG et ECHO en 5 V')]],
    how: tl('Une impulsion sur TRIG fait émettre 8 ultrasons par le transducteur de gauche. ECHO passe à l’état haut jusqu’au retour de l’écho sur celui de droite. Le son parcourt environ 343 m/s, à l’aller et au retour : distance (cm) = durée (µs) ÷ 58.'),
    uses: [tl('Robot qui évite les obstacles'), tl('Niveau d’eau dans une cuve'), tl('Aide au stationnement')],
    mistakes: [tl('ECHO (5 V) branché directement sur une carte 3,3 V.'), tl('Viser une surface molle ou inclinée (tissu, mousse) : l’écho se perd.'), tl('Mesurer trop vite : laissez 60 ms entre deux mesures pour éviter les échos parasites.')]
  },
  pir: {
    specs: [[tl('Alimentation'), tl('4,5 à 20 V, ≈ 50 µA au repos')], [tl('Sortie'), tl('3,3 V quand un mouvement est détecté')], [tl('Portée'), tl('réglable de 3 à 7 m (potentiomètre Sx)')], [tl('Angle'), '≈ 110°'], [tl('Temporisation'), tl('3 s à 5 min (potentiomètre Tx)')], [tl('Mode'), tl('cavalier H : redéclenchable · L : une seule impulsion')]],
    how: tl('Un capteur pyroélectrique, derrière une lentille de Fresnel (le dôme blanc), détecte les variations du rayonnement infrarouge quand un corps chaud se déplace devant lui. Il ne voit pas un objet immobile.'),
    uses: [tl('Éclairage automatique'), tl('Alarme'), tl('Compteur de passages')],
    mistakes: [tl('Ne pas attendre la stabilisation (30 à 60 s) : fausses détections au début.'), tl('Temporisation au maximum : la sortie reste haute plusieurs minutes et on croit à une panne.'), tl('Le placer face à une fenêtre ou un radiateur.')]
  },
  ldr: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Cellule'), tl('photorésistance GL5528 : ≈ 10 à 20 kΩ à 10 lx, ≈ 1 MΩ dans le noir')], [tl('Comparateur'), tl('LM393, seuil réglable')], [tl('Sorties'), tl('AO analogique · DO numérique (à LOW quand c’est éclairé)')]],
    how: tl('La photorésistance forme un pont diviseur avec une résistance fixe : la tension AO dépend de la lumière. Le comparateur compare AO au seuil du potentiomètre pour produire DO.'),
    uses: [tl('Veilleuse automatique'), tl('Distinguer le jour de la nuit'), tl('Robot qui suit la lumière')],
    mistakes: [tl('Attendre des lux précis : une photorésistance est lente et imprécise ; pour mesurer, prenez un BH1750.'), tl('Lire DO avec analogRead() ou AO avec digitalRead().')]
  },
  soil: {
    specs: [[tl('Alimentation'), tl('3,3 à 5,5 V, ≈ 5 mA')], [tl('Sortie'), tl('analogique, ≈ 1 à 3 V')], [tl('Principe'), tl('capacitif, aucune électrode à nu')]],
    how: tl('La sonde forme un condensateur dont la capacité augmente avec l’eau contenue dans le sol. Un petit circuit oscillant transforme cette capacité en tension.'),
    uses: [tl('Arrosage automatique'), tl('Suivi d’une plante en pot'), tl('Alerte de sécheresse')],
    mistakes: [tl('Enfoncer la sonde au-delà de la ligne blanche : l’électronique du haut doit rester au sec.'), tl('Utiliser les valeurs brutes sans étalonner (à sec, puis dans l’eau).')]
  },
  mq2: {
    specs: [[tl('Alimentation'), tl('5 V, ≈ 150 mA (filament chauffant)')], [tl('Détection'), tl('GPL, propane, méthane, hydrogène, fumée')], [tl('Plage'), tl('300 à 10 000 ppm')], [tl('Préchauffage'), tl('24 à 48 h la première fois, environ 1 min ensuite')], [tl('Sorties'), tl('AO analogique · DO numérique (seuil réglable)')]],
    how: tl('Une couche d’oxyde d’étain chauffée par un filament voit sa résistance baisser en présence de gaz combustibles. Le module la place dans un pont diviseur : AO monte avec la concentration.'),
    uses: [tl('Détecteur de fuite de gaz d’initiation'), tl('Détecteur de fumée de démonstration')],
    mistakes: [tl('L’alimenter en 3,3 V : le filament chauffe mal, les mesures dérivent.'), tl('Le prendre pour un détecteur de sécurité certifié : il ne l’est pas.'), tl('Il chauffe : ne le touchez pas et éloignez-le du plastique.')]
  },
  ds18b20: {
    specs: [[tl('Alimentation'), tl('3,0 à 5,5 V')], [tl('Température'), tl('−55 à 125 °C, ±0,5 °C entre −10 et 85 °C')], [tl('Résolution'), tl('9 à 12 bits (0,0625 °C)')], [tl('Conversion'), tl('750 ms en 12 bits')], [tl('Interface'), tl('1-Wire, adresse unique de 64 bits')], [tl('Formats'), tl('boîtier TO-92 ou sonde étanche en inox')]],
    how: tl('Le bus 1-Wire transporte les données sur un seul fil. Chaque sonde a une adresse gravée en usine : on peut en brancher des dizaines sur la même broche. Elle peut même s’alimenter par la ligne de données (mode parasite).'),
    uses: [tl('Température de l’eau (aquarium, chauffe-eau)'), tl('Congélateur, chambre froide'), tl('Mesure en plusieurs points sur un seul fil')],
    mistakes: [tl('Oublier la résistance de 4,7 kΩ entre DQ et VDD : lecture à −127 °C.'), tl('Inverser GND et VDD : la sonde chauffe fort et grille. Face plate vers soi : GND, DQ, VDD.'), tl('Lire 85 °C : c’est la valeur de démarrage, la conversion n’a pas eu lieu.')]
  },
  bmp280: {
    specs: [[tl('Alimentation'), tl('1,71 à 3,6 V (module 3,3 V), 2,7 µA à une mesure par seconde')], [tl('Pression'), tl('300 à 1100 hPa, ±1 hPa (±0,12 hPa en relatif, soit ≈ ±1 m)')], [tl('Température'), tl('−40 à 85 °C, ±1 °C')], [tl('Interface'), tl('I2C (0x76 ou 0x77) ou SPI')], [tl('À ne pas confondre'), tl('le BME280 mesure aussi l’humidité')]],
    how: tl('Une membrane en silicium se déforme sous la pression ; des jauges piézorésistives mesurent cette déformation, corrigée par la température. La pression baisse d’environ 12 hPa tous les 100 m d’altitude.'),
    uses: [tl('Altimètre'), tl('Prévision météo par la tendance de la pression'), tl('Drone, fusée à eau')],
    mistakes: [tl('L’alimenter en 5 V : il grille.'), tl('Mauvaise adresse (0x76 ou 0x77 selon SDO) : un scanner I2C règle la question.'), tl('Le confondre avec un BME280 et attendre une humidité.')]
  },
  mpu6050: {
    specs: [[tl('Alimentation'), tl('module 3,3 à 5 V (puce en 3,3 V), ≈ 4 mA')], [tl('Accéléromètre'), tl('±2 à ±16 g, 16 bits')], [tl('Gyroscope'), tl('±250 à ±2000 °/s, 16 bits')], [tl('Autres'), tl('capteur de température, processeur de mouvement (DMP)')], [tl('Interface'), tl('I2C, 0x68 (0x69 si AD0 au 3,3 V)')]],
    how: tl('Des microstructures (MEMS) bougent sous l’effet des accélérations et des rotations ; la puce mesure ces mouvements par variation de capacité. Au repos, l’accéléromètre mesure la gravité : on en déduit l’inclinaison.'),
    uses: [tl('Robot qui tient en équilibre'), tl('Détection de chute ou de secousse'), tl('Manette par inclinaison')],
    mistakes: [tl('Ne pas calibrer : un petit décalage subsiste au repos.'), tl('Intégrer le gyroscope sans correction : l’angle dérive. Combinez-le à l’accéléromètre (filtre complémentaire).')]
  },
  sound: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Composants'), tl('micro à électret, amplificateur, comparateur LM393')], [tl('Sorties'), tl('AO (le signal sonore) · DO (seuil réglable)')]],
    how: tl('Le micro transforme la pression sonore en une petite tension, amplifiée autour de la moitié de l’alimentation. Pour estimer un niveau, on mesure l’écart entre le maximum et le minimum sur une courte durée.'),
    uses: [tl('Détecteur de claquement de mains'), tl('Voyant de niveau sonore')],
    mistakes: [tl('Lire une seule valeur de AO : on tombe au hasard dans l’onde. Mesurez l’amplitude sur 50 ms.'), tl('Attendre des décibels précis : ce n’est pas un sonomètre.')]
  },

  /* ---------- Entrées ---------- */
  button: {
    specs: [[tl('Format'), tl('bouton tactile 6 × 6 mm')], [tl('Contact'), tl('≈ 50 mA sous 12 V')], [tl('Rebonds'), tl('5 à 20 ms')]],
    how: tl('Appuyer plaque une lamelle métallique qui relie les deux pattes. Au moment du contact, la lamelle rebondit : le programme voit plusieurs appuis en quelques millisecondes.'),
    uses: [tl('Démarrer, choisir dans un menu'), tl('Sonnette, compteur'), tl('Réinitialiser un montage')],
    mistakes: [tl('Entrée sans résistance de tirage : valeurs aléatoires. Utilisez INPUT_PULLUP.'), tl('Oublier l’anti-rebond : un appui compte plusieurs fois (delay(20) ou bibliothèque Bounce2).'), tl('Bouton à 4 pattes mal orienté : les pattes d’un même côté sont déjà reliées.')]
  },
  pot: {
    specs: [[tl('Valeur'), tl('10 kΩ, piste linéaire (B10K)')], [tl('Puissance'), tl('≈ 0,1 W')], [tl('Rotation'), '≈ 300°']],
    how: tl('Une piste résistive va de la broche 1 à la broche 3 ; le curseur W frotte dessus et prélève une tension intermédiaire. C’est un pont diviseur réglable à la main.'),
    uses: [tl('Régler une luminosité, un volume, une consigne'), tl('Naviguer dans un menu')],
    mistakes: [tl('Relier le curseur à l’alimentation ou à la masse : en butée, court-circuit à travers la piste.'), tl('Alimenter en 5 V sur une carte 3,3 V : l’ADC sature.')]
  },
  joystick: {
    specs: [[tl('Composants'), tl('2 potentiomètres de 10 kΩ et un bouton')], [tl('Alimentation'), tl('3,3 à 5 V')], [tl('Au centre'), tl('moitié de l’alimentation (≈ 2048 sur 12 bits, ≈ 512 sur 10 bits)')]],
    how: tl('Le manche entraîne deux potentiomètres à angle droit : chacun donne une position sur un axe. Appuyer sur le manche ferme un bouton vers la masse.'),
    uses: [tl('Robot ou voiture télécommandés'), tl('Jeu'), tl('Tourelle pour caméra')],
    mistakes: [tl('Le centre n’est jamais exactement au milieu : prévoyez une zone morte.'), tl('Alimenter en 5 V sur une carte 3,3 V : valeurs saturées.')]
  },
  ir: {
    specs: [[tl('Alimentation'), tl('2,7 à 5,5 V')], [tl('Porteuse'), '38 kHz'], [tl('Portée'), tl('≈ 10 à 18 m')], [tl('Angle'), '±45°'], [tl('Sortie'), tl('active à l’état bas')]],
    how: tl('La télécommande fait clignoter une LED infrarouge 38 000 fois par seconde, par paquets. Le récepteur filtre cette porteuse et ne sort que les paquets : une trame de bits, le plus souvent au format NEC.'),
    uses: [tl('Piloter un montage avec une télécommande de télévision'), tl('Interrupteur sans fil')],
    mistakes: [tl('Soleil ou lampes fluorescentes : réceptions parasites.'), tl('Ancienne syntaxe IRremote (irrecv.decode(&results)) : les versions 3 et suivantes utilisent IrReceiver.')]
  },
  keypad: {
    specs: [[tl('Touches'), tl('16, en matrice 4 × 4')], [tl('Fils'), tl('8 (4 lignes, 4 colonnes)')], [tl('Alimentation'), 'aucune'], [tl('Format'), tl('membrane souple autocollante')]],
    how: tl('Le programme met une ligne à LOW à la fois et lit les colonnes : celle qui passe à LOW indique la touche appuyée à l’intersection.'),
    uses: [tl('Code d’accès'), tl('Saisie de nombres, calculatrice')],
    mistakes: [tl('Inverser lignes et colonnes : les touches sont mélangées (corrigeable dans le tableau du code).'), tl('Brancher les colonnes sur des broches sans tirage interne.')]
  },

  /* ---------- Affichage ---------- */
  oled: {
    specs: [[tl('Écran'), tl('0,96", 128 × 64 pixels monochromes')], [tl('Contrôleur'), 'SSD1306'], [tl('Interface'), tl('I2C, adresse 0x3C (parfois 0x3D)')], [tl('Alimentation'), tl('3,3 à 5 V, ≈ 20 mA')], [tl('Éclairage'), tl('aucun : chaque pixel émet sa propre lumière')]],
    how: tl('Le programme dessine dans une image en mémoire (1 Ko), puis display() l’envoie à l’écran par I2C.'),
    uses: [tl('Afficher des mesures'), tl('Petit menu, icônes, graphiques')],
    mistakes: [tl('Oublier display() : rien ne s’affiche.'), tl('Adresse 0x3D au lieu de 0x3C : écran noir.'), tl('Confondre avec un écran 1,3" (SH1106) : il faut une autre bibliothèque.')]
  },
  lcd1602: {
    specs: [[tl('Écran'), tl('16 caractères × 2 lignes, rétroéclairé')], [tl('Contrôleurs'), tl('HD44780 et adaptateur I2C PCF8574')], [tl('Adresse'), tl('0x27 (PCF8574T) ou 0x3F (PCF8574AT)')], [tl('Alimentation'), '5 V'], [tl('Réglage'), tl('potentiomètre de contraste au dos')]],
    how: tl('L’adaptateur PCF8574 transforme les deux fils de l’I2C en 8 sorties qui pilotent l’écran HD44780 en mode 4 bits, plus le rétroéclairage.'),
    uses: [tl('Afficher des mesures et des messages'), tl('Menus simples')],
    mistakes: [tl('Écran allumé mais vide, ou rempli de rectangles : réglez le contraste au dos.'), tl('Mauvaise adresse : 0x27 pour un adaptateur PCF8574, 0x3F pour un PCF8574A (le scanner I2C la donne).'), tl('Lettres accentuées : la mémoire de l’écran ne les connaît pas ; créez-les avec createChar().')]
  },
  '7seg': {
    specs: [[tl('Taille'), '0,56"'], [tl('Type'), tl('cathode commune')], [tl('Par segment'), tl('≈ 2 V de seuil, 10 à 20 mA')], [tl('Broches'), tl('10, dont 2 communs reliés')]],
    how: tl('Sept segments en forme de 8, plus un point : chacun est une LED, et toutes les cathodes rejoignent le commun. Allumer une combinaison de segments forme un chiffre.'),
    uses: [tl('Compteur, minuteur'), tl('Horloge, tableau de score')],
    mistakes: [tl('Afficheur à anode commune : il faut relier le commun au + et inverser la logique.'), tl('Pas de résistance : segments trop brillants, sorties surchargées.'), tl('Pour plusieurs chiffres, câbler chaque segment : utilisez plutôt un pilote (MAX7219, TM1637).')]
  },
  ws2812: {
    specs: [['LED', tl('8 LED RGB adressables')], [tl('Alimentation'), tl('5 V (3,5 à 5,3 V)')], [tl('Courant'), tl('jusqu’à 60 mA par LED en blanc à pleine puissance')], [tl('Données'), tl('24 bits par LED (ordre GRB), 800 kbit/s')], [tl('Chaînage'), tl('DOUT vers DIN de la barrette suivante')]],
    how: tl('Chaque LED garde les 24 premiers bits qu’elle reçoit et transmet le reste à la suivante : une seule broche commande des centaines de LED.'),
    uses: [tl('Éclairage d’ambiance'), tl('Indicateurs colorés, bargraphes'), tl('Animations lumineuses')],
    mistakes: [tl('Alimenter une longue bande par la carte : chute de tension, couleurs fausses, carte qui redémarre.'), tl('Oublier la masse commune entre l’alimentation des LED et la carte.'), tl('Brancher les données sur DOUT au lieu de DIN.')]
  },

  /* ---------- Sorties ---------- */
  'led-red': LED_DOC, 'led-green': LED_DOC, 'led-blue': LED_DOC, 'led-yellow': LED_DOC, 'led-white': LED_DOC,
  'led-rgb': {
    specs: [[tl('Type'), tl('cathode commune')], [tl('Seuils'), tl('≈ 2 V pour le rouge, ≈ 3 V pour le vert et le bleu')], [tl('Courant'), tl('20 mA maximum par couleur')]],
    how: tl('Trois LED dans le même boîtier. En dosant chacune avec la PWM, on mélange les couleurs : rouge + vert = jaune, les trois ensemble = blanc.'),
    uses: [tl('Voyant multicolore'), tl('Lampe d’ambiance'), tl('Indiquer un état par une couleur')],
    mistakes: [tl('Une seule résistance sur la cathode commune : les couleurs s’influencent.'), tl('LED à anode commune : relier le commun au + et inverser la logique (255 = éteint).')]
  },
  buzzer: {
    specs: [[tl('Type'), tl('actif (oscillateur intégré)')], [tl('Alimentation'), tl('3,3 à 5 V, ≈ 25 mA')], [tl('Son'), tl('≈ 2,3 kHz, fréquence fixe')], [tl('Polarité'), '+ = patte longue']],
    how: tl('Un oscillateur intégré fait vibrer une pastille piézoélectrique dès que le buzzer est alimenté. Un buzzer passif, lui, n’a pas d’oscillateur et suit la fréquence envoyée par tone().'),
    uses: [tl('Alarme'), tl('Bip de confirmation'), tl('Minuteur')],
    mistakes: [tl('Utiliser tone() sur un buzzer actif : son grésillant.'), tl('Inverser + et − : il ne sonne pas.')]
  },
  speaker: {
    specs: [[tl('Impédance'), '8 Ω'], [tl('Puissance'), tl('0,5 W')]],
    how: tl('Une bobine placée dans le champ d’un aimant pousse une membrane au rythme du signal électrique, ce qui fait vibrer l’air.'),
    uses: [tl('Mélodies avec tone()'), tl('Sons de jeu, alertes')],
    mistakes: [tl('Le brancher sans résistance : 8 Ω demandent bien plus de courant qu’une broche n’en fournit.')]
  },
  relay: {
    specs: [[tl('Bobine'), '5 V, ≈ 70 mA'], [tl('Contacts'), tl('10 A sous 125 V~, 7 A sous 240 V~ ou 28 V⎓')], [tl('Commande'), tl('transistor et diode intégrés, souvent active à l’état bas')], [tl('Bornier'), tl('COM, NO (normalement ouvert), NC (normalement fermé)')]],
    how: tl('Le courant dans la bobine crée un champ magnétique qui attire une lame : le contact COM passe de NC à NO. Le circuit commandé reste isolé de la carte.'),
    uses: [tl('Allumer une lampe, une pompe, un ventilateur : + de la pile sur COM, l’appareil sur NO'), tl('Couper un appareil à distance')],
    mistakes: [tl('Travailler sur le secteur 230 V sous tension : danger de mort.'), tl('Alimenter la bobine en 3,3 V : le relais colle mal ou pas du tout.'), tl('Croire que HIGH active le relais : sur beaucoup de modules, c’est LOW.')]
  },

  /* ---------- Moteurs ---------- */
  servo: {
    specs: [[tl('Alimentation'), tl('4,8 à 6 V, jusqu’à ≈ 650 mA bloqué')], [tl('Couple'), tl('≈ 1,8 kg·cm')], [tl('Vitesse'), tl('0,1 s pour 60°')], [tl('Débattement'), '180°'], [tl('Commande'), tl('impulsion de 0,5 à 2,4 ms toutes les 20 ms (50 Hz)')], [tl('Fils'), tl('marron GND · rouge VCC · orange signal')]],
    how: tl('Un moteur, des engrenages et un potentiomètre fixé sur l’axe : le circuit interne compare la position mesurée à celle demandée par la largeur d’impulsion, et corrige.'),
    uses: [tl('Bras robotisé, pince'), tl('Barrière, trappe'), tl('Orienter un capteur')],
    mistakes: [tl('Plusieurs servos sur le 5 V de la carte : redémarrages.'), tl('Forcer en butée : les engrenages en plastique cassent.'), tl('Sur ESP32, la bibliothèque Servo standard ne fonctionne pas : utilisez ESP32Servo.')]
  },
  dcmotor: {
    specs: [[tl('Alimentation'), tl('3 à 6 V')], [tl('Courant'), tl('100 à 250 mA à vide, plus de 1 A bloqué')], [tl('Commande'), tl('par un pilote (L298N, TB6612…)')]],
    how: tl('Le courant dans les bobines du rotor crée une force dans le champ des aimants : l’axe tourne. Inverser la polarité inverse le sens ; la tension moyenne, réglée en PWM, fixe la vitesse.'),
    uses: [tl('Roues d’un robot'), tl('Ventilateur, pompe')],
    mistakes: [tl('Le brancher sur une broche de la carte.'), tl('Oublier le condensateur de 100 nF entre ses bornes : parasites qui perturbent la carte.'), tl('L’alimenter avec une pile 9 V : elle s’effondre en quelques minutes.')]
  },
  fan: {
    specs: [[tl('Alimentation'), tl('5 V (démarre vers 2 V)')], [tl('Courant'), tl('≈ 100 mA')], [tl('Taille'), '40 × 40 × 10 mm'], [tl('Fils'), tl('rouge + · noir −')], [tl('Commande'), tl('transistor, relais ou pilote ; vitesse en PWM')]],
    how: tl('Un moteur sans balais : une petite électronique alimente tour à tour les bobines pour faire tourner l’hélice. Elle ne fonctionne que dans un sens de branchement.'),
    uses: [tl('Refroidir un boîtier quand la température monte'), tl('Aérer une serre'), tl('Ventilateur de bureau commandé par un capteur')],
    mistakes: [tl('Le brancher à l’envers : il ne tourne pas.'), tl('Le relier à une broche de la carte : 100 mA, c’est trop pour elle.'), tl('L’alimenter en 9 V ou 12 V : il chauffe et s’use vite.')]
  },
  pump: {
    specs: [[tl('Alimentation'), tl('3 à 6 V')], [tl('Courant'), tl('130 à 220 mA')], [tl('Débit'), tl('≈ 1,5 L/min à 5 V')], [tl('Usage'), tl('immergée dans l’eau')]],
    how: tl('Un moteur à courant continu fait tourner une turbine : l’eau aspirée par le bas est projetée vers la buse de sortie.'),
    uses: [tl('Arrosage automatique quand la terre est sèche'), tl('Fontaine, aquarium'), tl('Distributeur d’eau')],
    mistakes: [tl('La faire tourner à sec : elle s’abîme vite.'), tl('La commander directement par une broche : passez par un transistor ou un relais.'), tl('Oublier la masse commune entre la pile de la pompe et la carte (avec un transistor).')]
  },
  vibro: {
    specs: [[tl('Alimentation'), tl('2,5 à 3,5 V')], [tl('Courant'), tl('≈ 80 mA')], [tl('Taille'), tl('pastille de 10 mm × 3 mm')]],
    how: tl('Une masse décentrée fixée sur l’axe d’un minuscule moteur : en tournant, elle secoue tout le boîtier.'),
    uses: [tl('Alerte silencieuse (montre, bracelet)'), tl('Retour tactile d’une manette'), tl('Signal pour une personne malentendante')],
    mistakes: [tl('L’alimenter en 5 V sans résistance : il s’use vite.'), tl('Le relier directement à une broche : passez par un transistor (avec une diode en parallèle).')]
  },
  stepper: {
    specs: [[tl('Alimentation'), '5 V, ≈ 200 mA'], [tl('Type'), tl('unipolaire 4 phases, réduction 1:64')], [tl('Résolution'), tl('2048 pas par tour')], [tl('Couple'), tl('≈ 0,3 kg·cm')], [tl('Pilote'), tl('carte ULN2003 avec 4 LED témoins')]],
    how: tl('Les bobines sont alimentées dans un ordre précis : l’aimant du rotor suit le champ, pas après pas. On sait exactement de combien l’axe a tourné, sans capteur.'),
    uses: [tl('Aiguille d’horloge, cadran'), tl('Store, distributeur'), tl('Positionnement précis et lent')],
    mistakes: [tl('Mauvais ordre des broches dans le code (IN1-IN3-IN2-IN4) : le moteur vibre sans tourner.'), tl('Vitesse trop élevée (plus de 15 tours/min) : il décroche.'), tl('Bobines alimentées à l’arrêt : il chauffe inutilement.')]
  },
  l298n: {
    specs: [[tl('Alimentation moteurs'), tl('5 à 35 V')], [tl('Courant'), tl('2 A par voie (3 A en pointe)')], [tl('Chute de tension'), '≈ 2 V'], [tl('Régulateur'), tl('5 V intégré (cavalier 5V-EN), si l’alimentation ne dépasse pas 12 V')], [tl('Charges'), tl('2 moteurs à courant continu, ou 1 moteur pas à pas bipolaire')]],
    how: tl('Un pont en H par voie : quatre transistors appliquent la tension au moteur dans un sens ou dans l’autre. ENA et ENB autorisent chaque voie ; en PWM, ils règlent la vitesse.'),
    uses: [tl('Robot à deux roues'), tl('Treuil, convoyeur')],
    mistakes: [tl('Oublier la masse commune avec la carte.'), tl('Laisser le cavalier 5V-EN avec plus de 12 V : le régulateur surchauffe.'), tl('Attendre toute la tension aux moteurs : environ 2 V se perdent dans le pilote.')]
  },

  /* ---------- Passifs ---------- */
  'res-22': RES_DOC('22 Ω', tl('rouge, rouge, noir, or'), [tl('En série avec un vibreur 3 V alimenté en 5 V (80 mA × 22 Ω ≈ 1,8 V de chute, 0,14 W)')]),
  'res-220': RES_DOC('220 Ω', tl('rouge, rouge, marron, or'), [tl('En série avec une LED'), tl('Protéger une entrée')]),
  'res-330': RES_DOC('330 Ω', tl('orange, orange, marron, or'), [tl('Haut-parleur ou LED sur une carte dont les broches débitent peu (ESP8266 : 12 mA conseillés, Pico : 12 mA)')]),
  'res-1k': RES_DOC('1 kΩ', tl('marron, noir, rouge, or'), [tl('Base d’un transistor (2 à 4 mA de base)'), tl('Limiter le courant d’un signal')]),
  'res-4k7': RES_DOC('4,7 kΩ', tl('jaune, violet, rouge, or'), [tl('Tirage d’un bus 1-Wire (DS18B20)'), tl('Tirage d’un bus I2C'), tl('Haut d’un pont diviseur 5 V → 3,3 V (avec 10 kΩ en bas : 3,4 V)')]),
  'res-10k': RES_DOC('10 kΩ', tl('marron, noir, orange, or'), [tl('Tirage d’une entrée vers le haut (pull-up) ou le bas (pull-down)'), tl('Pont diviseur avec une photorésistance'), tl('Bas d’un pont diviseur 5 V → 3,3 V (avec 4,7 kΩ en haut)')]),
  'cap-100n': {
    specs: [[tl('Valeur'), tl('100 nF (marqué 104)')], [tl('Type'), tl('céramique, non polarisé')], [tl('Tension'), '50 V']],
    how: tl('Placé au plus près d’une puce, il stocke un peu de charge et la restitue lors des appels de courant très brefs : il filtre les parasites de l’alimentation.'),
    pinout: [['1', tl('Patte, sans polarité')], ['2', tl('Patte, sans polarité')]],
    uses: [tl('Découplage d’une puce'), tl('Anti-parasite aux bornes d’un moteur'), tl('Anti-rebond matériel avec une résistance')],
    mistakes: [tl('Le placer loin de la puce : il ne sert presque à rien.')]
  },
  'cap-100u': {
    specs: [[tl('Valeur'), '100 µF'], [tl('Type'), tl('électrolytique, polarisé')], [tl('Tension'), tl('maximum imprimé sur le boîtier, souvent 16 ou 25 V')]],
    how: tl('Un réservoir d’énergie : il amortit les chutes de tension quand un moteur, un servo ou une radio tire brusquement beaucoup de courant.'),
    pinout: [['+', tl('Patte longue')], ['−', tl('Côté de la bande claire sur le boîtier')]],
    uses: [tl('Stabiliser l’alimentation de servos ou de LED WS2812'), tl('Lisser une tension')],
    mistakes: [tl('Le monter à l’envers : il chauffe et peut éclater.'), tl('Dépasser sa tension de service.')]
  },
  diode: {
    specs: [[tl('Courant'), '1 A'], [tl('Tension inverse'), '1000 V'], [tl('Seuil'), tl('≈ 0,7 à 1 V')]],
    how: tl('Le courant ne passe que de l’anode vers la cathode (côté bague). Montée en roue libre aux bornes d’une bobine, elle absorbe la pointe de tension produite à la coupure.'),
    pinout: [['A', tl('Anode')], ['K', tl('Cathode, côté bague grise')]],
    uses: [tl('Roue libre d’un moteur ou d’un relais'), tl('Protection contre l’inversion de polarité')],
    mistakes: [tl('La monter dans le mauvais sens en roue libre : court-circuit de l’alimentation.')]
  },
  npn: {
    specs: [[tl('Tension'), tl('45 V maximum')], [tl('Courant collecteur'), tl('100 mA maximum')], [tl('Gain'), tl('110 à 800')], [tl('Brochage'), tl('C, B, E, face plate vers soi')]],
    how: tl('Un petit courant de la base vers l’émetteur autorise un courant bien plus grand du collecteur vers l’émetteur : c’est un interrupteur commandé par la carte.'),
    pinout: [['C', tl('Collecteur : vers la charge')], ['B', tl('Base : vers la broche de la carte, via ≈ 1 kΩ')], ['E', tl('Émetteur : vers la masse')]],
    uses: [tl('Commander un buzzer, un petit relais nu, une bande de LED légère')],
    mistakes: [tl('Pas de résistance de base : la broche et le transistor surchauffent.'), tl('Charge de plus de 100 mA : un MOSFET logique (IRLZ44N) convient mieux.'), tl('Oublier la diode de roue libre avec une bobine.')]
  },

  pn2222: {
    specs: [[tl('Tension'), tl('40 V maximum')], [tl('Courant collecteur'), tl('600 mA maximum (500 mA conseillés)')], [tl('Puissance'), '625 mW'], [tl('Gain'), tl('100 à 300 (≥ 100 à 150 mA)')], [tl('Vce(sat)'), tl('≈ 0,3 V à 150 mA')], [tl('Brochage'), tl('E, B, C, face plate vers soi')]],
    how: tl('Même principe que le BC547, en plus robuste : 2 à 4 mA de base, à travers 1 kΩ, le saturent pour quelques centaines de mA. Saturé, il ne perd que Vce(sat) × Ic, quelques dizaines de mW.'),
    pinout: [['E', tl('Émetteur : vers la masse')], ['B', tl('Base : vers la broche de la carte, via 1 kΩ')], ['C', tl('Collecteur : vers le − de la charge')]],
    uses: [tl('Ventilateur, pompe, vibreur commandés en PWM'), tl('Bande de LED courte, petit relais nu')],
    mistakes: [tl('Confondre son brochage (E-B-C) avec celui du BC547 (C-B-E).'), tl('Base trop peu alimentée (10 kΩ) : il reste en régime linéaire et chauffe.'), tl('Oublier la diode de roue libre aux bornes d’un moteur.')]
  },

  /* ---------- Alimentation ---------- */
  bat9v: {
    specs: [[tl('Tension'), '9 V'], [tl('Capacité'), tl('≈ 500 mAh (alcaline)')], [tl('Courant raisonnable'), '≈ 100 mA']],
    how: tl('Six petites cellules de 1,5 V en série dans un même boîtier.'),
    uses: [tl('Alimenter une carte par VIN'), tl('Alimentation de secours pour un petit montage')],
    mistakes: [tl('Alimenter des moteurs : elle s’effondre en quelques minutes.'), tl('Sur le VIN d’une carte, le régulateur transforme 4 V en chaleur : acceptable seulement pour de petits courants.')]
  },
  bat18650: {
    specs: [[tl('Tension'), tl('3,7 V nominal, 4,2 V chargé, à ne pas décharger sous 2,5 à 3 V')], [tl('Capacité'), tl('2000 à 3500 mAh')], [tl('Courant'), tl('plusieurs ampères')]],
    how: tl('Une cellule lithium-ion : beaucoup d’énergie dans peu de place, et des courants élevés.'),
    uses: [tl('Montage autonome'), tl('Alimenter un module GSM SIM800L')],
    mistakes: [tl('La décharger trop bas : elle s’abîme ; utilisez un module avec protection.'), tl('Court-circuit : courant énorme, risque d’incendie.'), tl('La recharger sans chargeur adapté (TP4056).')]
  },
  mb102: {
    specs: [[tl('Entrée'), tl('jack 6,5 à 12 V, ou USB')], [tl('Sorties'), tl('5 V et 3,3 V, choisis par cavalier pour chaque rail')], [tl('Courant'), tl('≈ 700 mA maximum')]],
    how: tl('Deux régulateurs fournissent 5 V et 3,3 V directement sur les rails de la breadboard, sur laquelle le module s’enfiche.'),
    uses: [tl('Alimenter une breadboard sans passer par la carte')],
    mistakes: [tl('Cavaliers mal placés : 5 V sur un rail prévu pour 3,3 V.'), tl('Plus de 12 V en entrée : il surchauffe.')]
  },
  lm7805: {
    specs: [[tl('Entrée'), tl('7 à 35 V')], [tl('Sortie'), tl('5 V, jusqu’à 1,5 A avec dissipateur')], [tl('Chute minimale'), '≈ 2 V'], [tl('Brochage'), tl('IN, GND, OUT, face imprimée vers soi')]],
    how: tl('Régulateur linéaire : la tension en trop est transformée en chaleur. Puissance perdue : P = (tension d’entrée − 5 V) × courant.'),
    pinout: [['IN', tl('Entrée 7 à 35 V')], ['GND', tl('Masse commune')], ['OUT', tl('Sortie 5 V')]],
    uses: [tl('Obtenir 5 V depuis une batterie de 9 ou 12 V')],
    mistakes: [tl('Pas de condensateurs : la sortie oscille.'), tl('12 V vers 5 V sous 500 mA : 3,5 W de chaleur, il faut un dissipateur.')]
  },

  /* ---------- Communication ---------- */
  hc05: {
    specs: [[tl('Bluetooth'), tl('2.0 + EDR, profil série (SPP), pas de BLE')], [tl('Alimentation'), tl('3,6 à 6 V, logique 3,3 V')], [tl('Portée'), '≈ 10 m'], [tl('Vitesse'), tl('9600 bauds par défaut (38400 en mode AT)')], [tl('Appairage'), tl('code 1234 ou 0000')], [tl('Rôle'), tl('maître ou esclave')]],
    how: tl('Il se comporte comme un câble série sans fil : ce que la carte écrit sur son TX arrive sur le téléphone, et inversement.'),
    uses: [tl('Commander un robot depuis une application Android'), tl('Envoyer des mesures vers un téléphone')],
    mistakes: [tl('Relier TX à TX et RX à RX : il faut croiser.'), tl('Un iPhone ne voit pas le HC-05 (Bluetooth classique) : prenez un module BLE (HM-10).'), tl('Mode AT : il faut maintenir le bouton (ou EN au 3,3 V) pendant la mise sous tension.')]
  },
  rc522: {
    specs: [[tl('Fréquence'), '13,56 MHz'], [tl('Alimentation'), tl('3,3 V, 13 à 26 mA')], [tl('Interface'), tl('SPI jusqu’à 10 Mbit/s')], [tl('Cartes'), tl('MIFARE Classic 1K, Ultralight, NTAG')], [tl('Portée'), tl('moins de 5 cm')]],
    how: tl('L’antenne crée un champ qui alimente la puce du badge par induction ; tous deux échangent ensuite des données dans ce champ.'),
    uses: [tl('Contrôle d’accès par badge'), tl('Pointeuse'), tl('Jeu à cartes')],
    mistakes: [tl('Le brancher au 5 V : il grille.'), tl('Mauvaises broches SS et RST dans le code.'), tl('Croire que l’identifiant (UID) d’un badge est secret : il se copie facilement.')]
  },
  nrf24: {
    specs: [[tl('Alimentation'), tl('1,9 à 3,6 V, ≈ 11 mA en émission')], [tl('Radio'), tl('2,4 GHz, 126 canaux')], [tl('Débit'), tl('250 kbit/s, 1 ou 2 Mbit/s')], [tl('Portée'), tl('≈ 100 m en champ libre (jusqu’à 1 km avec antenne)')], [tl('Paquets'), tl('32 octets, accusé de réception automatique')]],
    how: tl('Deux modules réglés sur le même canal et la même adresse échangent de courts paquets, avec accusé de réception et renvoi automatiques.'),
    uses: [tl('Télécommande longue portée'), tl('Réseau de capteurs sans fil')],
    mistakes: [tl('Pas de condensateur de 10 µF : la radio décroche.'), tl('Version amplifiée (PA + LNA) sur le 3,3 V d’un Uno : courant insuffisant.'), tl('Adresses ou canaux différents des deux côtés.')]
  },
  lvlshift: {
    specs: [[tl('Voies'), tl('4, bidirectionnelles')], [tl('Côté LV'), tl('1,8 à 3,6 V (le 3,3 V de la carte ou du module)')], [tl('Côté HV'), tl('jusqu’à 5,5 V (le 5 V)')], [tl('Composants'), tl('un MOSFET BSS138 et deux résistances de 10 kΩ par voie')], [tl('Débit'), tl('I2C 400 kHz, SPI quelques MHz, série')]],
    how: tl('Au repos, chaque côté est tiré à sa propre tension par 10 kΩ. Quand le côté 3,3 V passe à LOW, le MOSFET conduit et tire aussi le côté 5 V à LOW ; quand c’est le côté 5 V, la diode interne puis le MOSFET tirent le côté 3,3 V. Aucun côté ne reçoit jamais la tension de l’autre.'),
    pinout: [['LV', tl('3,3 V')], ['HV', tl('5 V')], ['GND', tl('Masse commune')], ['LV1…LV4', tl('Signaux côté 3,3 V')], ['HV1…HV4', tl('Signaux côté 5 V (même numéro = même signal)')]],
    uses: [tl('Écran LCD I2C (5 V) sur un ESP32 ou un Pico'), tl('BMP280 ou RC522 (3,3 V) sur un Arduino Uno'), tl('Toute liaison I2C, SPI ou série entre deux tensions')],
    mistakes: [tl('Inverser LV et HV : le côté 3,3 V reçoit du 5 V.'), tl('Oublier de relier LV ou HV : les voies ne sont plus tirées et rien ne passe.'), tl('S’en servir pour alimenter un module : il ne transporte que des signaux.')]
  },
  sim800: {
    specs: [[tl('Alimentation'), tl('3,4 à 4,4 V, pointes de 2 A')], [tl('Réseau'), tl('GSM 850/900/1800/1900 MHz, 2G et GPRS')], [tl('Commande'), tl('commandes AT sur liaison série')], [tl('Carte SIM'), 'micro-SIM'], [tl('Voyant NET'), tl('un éclair par seconde : recherche du réseau ; toutes les 3 s : connecté')]],
    how: tl('Un téléphone 2G sans écran : on lui envoie des commandes AT par la liaison série pour envoyer un SMS, appeler ou se connecter en GPRS.'),
    uses: [tl('Alerte par SMS (alarme, niveau d’eau)'), tl('Commande à distance par SMS')],
    mistakes: [tl('Alimentation trop faible : le voyant clignote, puis le module redémarre en boucle.'), tl('Réseau 2G arrêté dans votre pays : le module ne se connecte jamais.'), tl('Code PIN actif sur la carte SIM.')]
  }
};

/* ---------- Rendu d'une page ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NEED_TEXT = { io: tl('GPIO numérique (entrée/sortie)'), in: tl('GPIO en entrée'), out: tl('GPIO en sortie'), pullup: tl('GPIO en entrée, INPUT_PULLUP'), pwm: tl('GPIO avec PWM'), adc: tl('entrée analogique (ADC)'), sda: tl('SDA du bus I2C'), scl: tl('SCL du bus I2C'), sck: tl('SCK du bus SPI'), mosi: tl('MOSI du bus SPI'), miso: tl('MISO du bus SPI'), ss: tl('GPIO en sortie (sélection SPI)'), rx: tl('TX de la carte (croisé)'), tx: tl('RX de la carte (croisé)') };
const RES_NAME = { 'res-220': '220 Ω', 'res-4k7': '4,7 kΩ' };
function where(p) {
  switch (p.kind) {
    case 'pwr': { if (p.v === 'logic') return tl('Alimentation à la tension logique de la carte'); const [lo, hi] = vrange(p.v); return tl('Alimentation {0} à {1}', volts(lo), volts(hi)); }
    case 'ext': return tl('Alimentation par batterie');
    case 'gnd': return p.via ? tl('Masse, via {0}', RES_NAME[p.via]) : p.role === tl('Adresse') ? tl('Masse (choix de l’adresse)') : tl('Masse (GND)');
    case 'vin': return tl('Entrée VIN de la carte');
    case 'drv': return tl('Alimentation commandée : pilote L298N, transistor ou relais');
    case 'nc': return tl('Laissée libre');
    case 'contact': return tl('Contact de puissance, isolé de la carte');
    default: return NEED_TEXT[p.need] + (p.via ? tl(', via {0}', RES_NAME[p.via]) : '') + (p.pull ? tl(', tirage 4,7 kΩ vers VDD') : '') + (p.opt || p.when ? tl(' (facultative)') : '');
  }
}
const codeName = k => 'PIN_' + (k === '+' ? 'PLUS' : k === '-' ? 'MOINS' : k.replace(/[^A-Za-z0-9]/g, '_'));
/** Lignes « broches utiles » d'une carte : [titre, texte, broches à allumer dans la visionneuse]. */
function boardRows(prof) {
  const rows = [
    [tl('Alimentation'), tl('{0} sort 3,3 V · {1} donne 5 V (USB) · {2} accepte {3} à {4}', prof.three, prof.five, prof.vin.pin, volts(prof.vin.min), volts(prof.vin.max)), [prof.three, prof.five, prof.vin.pin]],
    [tl('Masse'), tl('GND (toutes reliées entre elles)'), ['GND', 'AGND']],
    ['I2C', `SDA ${prof.i2c.sda} · SCL ${prof.i2c.scl}`, Object.values(prof.i2c)],
    ['SPI', `SCK ${prof.spi.sck} · MISO ${prof.spi.miso} · MOSI ${prof.spi.mosi} · SS ${prof.spi.ss}`, Object.values(prof.spi)],
    [tl('Série'), prof.uart ? `${prof.uart.port}${COLON}RX ${prof.uart.rx}, TX ${prof.uart.tx}` : tl('SoftwareSerial sur deux broches libres'), prof.uart ? [prof.uart.rx, prof.uart.tx] : []],
    [tl('Analogiques'), prof.adcOrder.join(', '), prof.adcOrder]
  ];
  Object.entries(prof.gpio).forEach(([k, g]) => g.note && rows.push([k, g.note, [k]]));
  return rows;
}
const pinRow = (pins, th, td) => `<tr data-pins="${esc(pins.join(','))}"><th>${th}</th><td>${td}</td></tr>`;

/** Liste des pages, dans l'ordre de la bibliothèque. */
export function docIndex(library, categories) {
  return categories.map(cat => ({ cat, items: library.filter(e => e.cat === cat) }));
}

/**
 * Page de documentation d'un composant : `head` (titre, résumé, bouton d'ajout) et
 * `body` (sections). Les lignes du brochage portent data-pins pour la visionneuse 3D.
 */
export function renderDoc(entry) {
  const d = DOCS[entry.id] || {}, spec = PARTS[entry.id], prof = BOARDS[entry.id];
  const lead = spec ? spec.what : prof ? tl('Carte {0}, logique {1}.', prof.label, volts(prof.logic)) : '';
  const sec = (title, body) => (body ? `<section><h3>${title}</h3>${body}</section>` : '');
  const list = items => (items && items.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
  let pinout = '';
  if (prof) pinout = `<table class="pinout"><tbody>${boardRows(prof).map(([a, b, pins]) => pinRow(pins, esc(a), esc(b))).join('')}</tbody></table>`;
  else if (spec && spec.pins) pinout = `<table class="pinout"><thead><tr><th>${tl('Broche')}</th><th>${tl('Se relie à')}</th></tr></thead><tbody>${spec.pins.map(p => pinRow([p.pin], esc(p.pin), `<b>${esc(where(p))}</b>${p.why ? `<p>${esc(p.why)}</p>` : ''}`)).join('')}</tbody></table>`;
  else if (d.pinout) pinout = `<table class="pinout"><tbody>${d.pinout.map(([a, b]) => pinRow([a], esc(a), esc(b))).join('')}</tbody></table>`;
  if (pinout) pinout = `<p class="hintline">${tl('Survolez une ligne pour repérer la broche sur le modèle 3D.')}</p>${pinout}`;
  let code = d.code || '';
  if (!code && spec && spec.code) {
    const p = {}; (spec.pins || []).forEach(x => (p[x.pin] = codeName(x.pin)));
    code = spec.code(p, null);
  }
  const lib = typeof spec?.lib === 'function' ? tl('{0} ({1} sur ESP32)', spec.lib(null), spec.lib(BOARDS.esp32)) : spec?.lib;
  const notes = [...(spec?.notes || []), ...(spec?.tips ? spec.tips(null) : [])];
  const head = `<small>${esc(entry.cat)}</small><h1>${esc(entry.name)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
    <button class="btn primary small" data-add="${esc(entry.id)}">${tl('Ajouter au plan de travail')}</button>`;
  return { head, body: sec(tl('Caractéristiques'), d.specs ? `<dl class="specs">${d.specs.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>` : '')
    + sec(tl('Fonctionnement'), d.how ? `<p>${esc(d.how)}</p>` : '')
    + sec(prof ? tl('Broches utiles') : tl('Brochage'), pinout)
    + sec(tl('Bon à savoir'), list(notes))
    + sec(tl('Utilisations'), list(d.uses))
    + sec(tl('Erreurs fréquentes'), d.mistakes ? `<ul class="mistakes">${d.mistakes.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '')
    + sec(tl('Limites vérifiées'), (() => { const rows = limitRows(entry.id, prof, spec, MOTORS); return rows.length ? `<dl class="specs">${rows.map(([a, v]) => `<dt>${esc(a)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><small>${tl('Le vérificateur (F7) prouve que le montage les respecte dans tous ses états.')}</small>` : ''; })())
    + sec(tl('Exemple de code'), code ? `${lib ? `<small>${tl('Bibliothèque : {0}', esc(lib))}</small>` : ''}<pre>${esc(code)}</pre>` : '') };
}
