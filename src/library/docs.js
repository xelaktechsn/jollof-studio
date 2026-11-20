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
import { ANALOG_DOCS } from './analog-docs.js';

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
/** Diode Zener BZX55 (verre DO-35) : tension nominale, plage à 5 mA (fiche Vishay), résistance dynamique, un usage. */
const ZENER_DOC = (vz, range, zz, use) => ({
  specs: [[tl('Tension Zener'), tl('{0} nominal, {1} à 5 mA (série C, ≈ ±5 %)', vz, range)], [tl('Puissance'), tl('500 mW au plus')], [tl('Résistance dynamique'), zz], [tl('Sens direct'), tl('comme une diode : ≈ 0,7 V, 1,5 V au plus à 200 mA')], [tl('Boîtier'), tl('DO-35 en verre, bague noire côté cathode')]],
  how: tl('Montée en inverse (cathode vers le +), elle ne laisse rien passer tant que la tension reste sous Vz, puis conduit autant qu’il le faut pour que la tension à ses bornes ne dépasse presque plus Vz. Une résistance en série absorbe l’écart : R = (Vin − Vz) ÷ I. Dans le sens direct, c’est une diode ordinaire.'),
  pinout: [['A', tl('Anode : vers la masse')], ['K', tl('Cathode, côté bague noire : vers le +, à travers la résistance série')]],
  uses: [use, tl('Petite tension de référence pour un comparateur ou un ADC'), tl('Écrêter un signal trop grand')],
  mistakes: [tl('Pas de résistance en série : rien ne limite le courant, elle grille.'), tl('La monter dans le sens direct : elle ne tient que ≈ 0,7 V.'), tl('Dépasser 500 mW (Vz × I) : avec une charge débranchée, tout le courant de la résistance passe dans la Zener.')]
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
  'esp32-38': {
    specs: [[tl('Puce'), tl('ESP32-WROOM-32, double cœur Xtensa LX6 jusqu’à 240 MHz')], [tl('Sans fil'), tl('Wi-Fi 802.11 b/g/n 2,4 GHz, Bluetooth 4.2 et BLE')], [tl('Broches'), tl('2 × 19, marquées IO0, IO2… (le numéro de GPIO)')], [tl('Logique'), tl('3,3 V : aucune broche ne tolère 5 V')], [tl('Alimentation'), tl('USB 5 V, ou broche 5V')], [tl('Analogique'), tl('ADC 12 bits (0 à 4095), 2 DAC 8 bits sur IO25 et IO26')]],
    how: tl('Le même ESP32 que la DevKit V1, sur une carte à 38 broches (ESP32-DevKitC d’Espressif, NodeMCU-32S et leurs copies). Le programme est identique ; seules la disposition et les noms des broches changent. Dans l’Arduino IDE : « ESP32 Dev Module » ou « NodeMCU-32S ».'),
    uses: [tl('Objets connectés en Wi-Fi ou en Bluetooth'), tl('Projets qui ont besoin de beaucoup de broches sur une carte ESP32')],
    mistakes: [tl('Envoyer 5 V sur une entrée : passez par un pont diviseur.'), tl('Brancher sur IO12 un module qui la tire au niveau haut : la carte ne démarre plus.'), tl('Utiliser SD0 à SD3, CMD ou CLK : elles appartiennent à la mémoire flash.'), tl('La poser sur une breadboard de 400 points : trop large, il ne reste qu’une rangée libre d’un côté.')],
    code: blink(2, tl('LED bleue de la NodeMCU-32S'))
  },
  esp32s3: {
    specs: [[tl('Puce'), tl('ESP32-S3 (module WROOM-1), double cœur Xtensa LX7 jusqu’à 240 MHz')], [tl('Mémoire'), tl('512 Ko de SRAM, 8 à 16 Mo de flash, PSRAM selon le module')], [tl('Sans fil'), tl('Wi-Fi 802.11 b/g/n 2,4 GHz et Bluetooth LE 5 (pas de Bluetooth classique)')], [tl('Logique'), tl('3,3 V : aucune broche ne tolère 5 V')], [tl('Analogique'), tl('ADC 12 bits : IO1 à IO10 (ADC1, utilisables avec le Wi-Fi), pas de DAC')], [tl('USB'), tl('deux prises USB-C : UART (puce USB-série) et USB natif')], [tl('Tactile'), tl('14 entrées tactiles (IO1 à IO14)')]],
    how: tl('Le successeur de l’ESP32 : plus rapide, plus de broches, l’USB natif et des instructions pour l’intelligence artificielle. Dans l’Arduino IDE, choisissez « ESP32S3 Dev Module » et branchez la prise « UART » pour téléverser et lire le moniteur série. Le numéro écrit à côté de chaque broche est son numéro de GPIO.'),
    uses: [tl('Objets connectés plus exigeants (écran, caméra, son)'), tl('Clavier ou souris USB grâce à l’USB natif'), tl('Reconnaissance vocale ou d’images simple')],
    mistakes: [tl('Utiliser BluetoothSerial : l’ESP32-S3 n’a que le Bluetooth LE.'), tl('Utiliser IO35 à IO37 sur un module N8R8 ou N16R8 : elles servent à sa PSRAM.'), tl('Chercher dacWrite() : l’ESP32-S3 n’a pas de convertisseur numérique-analogique.'), tl('Brancher la prise « USB » au lieu de « UART » : le moniteur série reste muet tant que l’option USB CDC n’est pas activée.')],
    code: blink('LED_BUILTIN', tl('LED RVB de la carte (s’allume en blanc)'))
  },
  esp32c3: {
    specs: [[tl('Puce'), tl('ESP32-C3, un cœur RISC-V jusqu’à 160 MHz')], [tl('Mémoire'), tl('400 Ko de SRAM, 4 Mo de flash')], [tl('Sans fil'), tl('Wi-Fi 802.11 b/g/n 2,4 GHz et Bluetooth LE 5 (pas de Bluetooth classique)')], [tl('Logique'), tl('3,3 V : aucune broche ne tolère 5 V')], [tl('Analogique'), tl('ADC 12 bits sur IO0 à IO4, pas de DAC')], [tl('Format'), tl('22,5 × 18 mm, 2 rangées de 8 broches, USB-C')]],
    how: tl('Une toute petite carte Wi-Fi bon marché. Le moniteur série passe directement par l’USB de la puce : dans l’Arduino IDE, choisissez « Nologo ESP32C3 Super Mini » (ou « ESP32C3 Dev Module » avec « USB CDC On Boot » activé). Si le téléversement échoue, maintenez BOOT en branchant l’USB.'),
    uses: [tl('Capteur Wi-Fi miniature, dans un boîtier ou sur pile'), tl('Remplacer un ESP8266 : même prix, plus moderne, Bluetooth LE en plus')],
    mistakes: [tl('Moniteur série muet : l’option « USB CDC On Boot » est désactivée.'), tl('Utiliser BluetoothSerial : l’ESP32-C3 n’a que le Bluetooth LE.'), tl('Brancher un module qui tire IO9 au niveau bas : la carte reste en mode téléversement.'), tl('Vouloir plus de 5 entrées analogiques : seules IO0 à IO4 en sont.')],
    code: blink('LED_BUILTIN', tl('LED bleue de la carte (IO8)'))
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
  d1mini: {
    specs: [[tl('Puce'), tl('ESP8266 (module ESP-12F), 80 MHz (160 MHz possible)')], [tl('Mémoire'), tl('≈ 80 Ko de RAM pour le programme, 4 Mo de flash')], [tl('Sans fil'), tl('Wi-Fi 802.11 b/g/n 2,4 GHz, pas de Bluetooth')], [tl('Logique'), tl('3,3 V')], [tl('Alimentation'), tl('USB 5 V, ou broche 5V (6 V au plus)')], [tl('Analogique'), tl('une seule entrée, A0, 10 bits (0 à 1023 pour 0 à 3,3 V)')], [tl('Format'), tl('34 × 26 mm, 2 rangées de 8 broches')]],
    how: tl('Le même ESP8266 que le NodeMCU sur une carte deux fois plus petite : mêmes noms D0 à D8, même programme. Dans l’Arduino IDE, choisissez la carte « LOLIN(WEMOS) D1 R2 & mini » du paquet « esp8266 ». Les cartes d’extension (relais, écran, capteur) s’empilent dessus.'),
    uses: [tl('Capteur Wi-Fi compact, sur pile ou dans un petit boîtier'), tl('Prise ou interrupteur connecté'), tl('Objet connecté qui doit tenir dans peu de place')],
    mistakes: [tl('Vouloir plusieurs capteurs analogiques : une seule entrée A0 ; ajoutez un convertisseur I2C (ADS1115).'), tl('D3, D4 ou D8 au mauvais niveau au démarrage : la carte ne démarre pas.'), tl('Mettre plus de 6 V sur la broche 5V : son régulateur grille.')],
    code: blink('LED_BUILTIN', tl('LED de la carte, allumée à LOW'))
  },
  mega: {
    specs: [[tl('Puce'), tl('ATmega2560, 16 MHz')], [tl('Mémoire'), tl('256 Ko de flash, 8 Ko de SRAM, 4 Ko d’EEPROM')], [tl('Entrées/sorties'), tl('54 numériques dont 15 PWM (2 à 13, 44 à 46), 16 analogiques')], [tl('Ports série'), tl('4 : Serial (USB), Serial1, Serial2 et Serial3')], [tl('Analogique'), tl('ADC 10 bits (0 à 1023 pour 0 à 5 V)')], [tl('Logique'), '5 V'], [tl('Alimentation'), tl('USB 5 V, ou jack / VIN 7 à 12 V')], [tl('Courant'), tl('20 mA conseillés par broche, 40 mA au maximum')]],
    how: tl('La grande sœur de l’Uno : même logique 5 V, mêmes fonctions, mais bien plus de broches, de mémoire et de ports série. Un programme d’Uno y tourne presque sans changement ; seules les broches I2C (D20, D21) et SPI (D50 à D53) changent de place.'),
    uses: [tl('Projets à beaucoup de capteurs et d’actionneurs : robot, imprimante 3D, serre automatique'), tl('Plusieurs modules série en même temps (GPS, GSM, Bluetooth) sur Serial1 à Serial3'), tl('Programmes trop gros pour les 2 Ko de RAM de l’Uno')],
    mistakes: [tl('Chercher l’I2C sur A4 et A5 comme sur l’Uno : sur le Mega, il est sur D20 (SDA) et D21 (SCL).'), tl('Utiliser D0 et D1 : le téléversement échoue.'), tl('Brancher un module 3,3 V (BMP280, RC522) sur le 5 V : il grille.'), tl('Alimenter servos ou moteurs par le 5 V de la carte : redémarrages.')],
    code: blink(13, tl('LED « L » de la carte'))
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
  bme280: {
    specs: [[tl('Mesures'), tl('température −40 à 85 °C (±1 °C), humidité 0 à 100 % (±3 %), pression 300 à 1100 hPa (±1 hPa)')], [tl('Alimentation'), tl('1,71 à 3,6 V : modules « 3,3 V » sans régulateur')], [tl('Bus'), tl('I2C, adresse 0x76 (SDO à la masse) ou 0x77')], [tl('Consommation'), tl('moins de 1 mA pendant une mesure, quelques µA au repos')]],
    how: tl('Trois capteurs dans une puce de 2,5 mm : une membrane qui se déforme avec la pression, une couche dont la capacité change avec l’humidité, et une sonde de température. La bibliothèque lit leurs mesures brutes et les corrige avec les coefficients d’étalonnage gravés en usine.'),
    uses: [tl('Station météo complète'), tl('Altimètre (la pression baisse de 1 hPa tous les 8 m environ)'), tl('Confort d’une salle de classe ou d’une serre')],
    mistakes: [tl('L’alimenter en 5 V : un module sans régulateur grille.'), tl('Acheter un « BME280 » qui est en fait un BMP280 : pas d’humidité, et begin() échoue (identifiant 0x58 au lieu de 0x60).'), tl('Le coller contre la carte : il mesure sa chaleur, pas celle de l’air.')]
  },
  bh1750: {
    specs: [[tl('Plage'), tl('1 à 65 535 lx, au lux près')], [tl('Alimentation'), tl('3 à 5 V (module GY-302 avec régulateur)')], [tl('Bus'), tl('I2C, adresse 0x23 (ADDR à la masse) ou 0x5C')], [tl('Mesure'), tl('120 ms en haute résolution')]],
    how: tl('Une photodiode filtrée pour voir la lumière comme l’œil humain, suivie d’un convertisseur : la puce donne directement l’éclairement en lux, sans calcul ni étalonnage. Le programme doit démarrer le bus I2C (Wire.begin()) avant begin().'),
    uses: [tl('Allumer l’éclairage quand il fait sombre, sans à-coups'), tl('Vérifier l’éclairage d’un poste de travail (300 à 500 lx)'), tl('Suivre l’ensoleillement d’une serre ou d’un panneau solaire')],
    mistakes: [tl('Oublier Wire.begin() : begin() échoue.'), tl('Changer l’adresse dans le constructeur seulement : begin() reprend 0x23 si on ne lui redonne pas l’adresse.'), tl('Le placer à l’ombre d’un boîtier : il mesure l’ombre.')]
  },
  vl53l0x: {
    specs: [[tl('Portée'), tl('3 cm à 2 m, au millimètre (±3 % environ)')], [tl('Principe'), tl('temps de vol d’un laser infrarouge 940 nm, invisible et sans danger')], [tl('Alimentation'), tl('2,6 à 5,5 V (module avec régulateur 2,8 V), logique 2,8 à 3,3 V')], [tl('Bus'), tl('I2C, adresse 0x29 (modifiable par le programme)')], [tl('Mesure'), tl('≈ 33 ms')]],
    how: tl('La puce envoie de très courtes impulsions laser et compte, avec des photodiodes SPAD, le temps que met la lumière à revenir : quelques nanosecondes pour quelques dizaines de centimètres. Elle mesure aussi la force du signal renvoyé, d’où l’état de la mesure (RangeStatus) : 0 valable, 4 hors de portée.'),
    uses: [tl('Robot qui évite les obstacles, plus précis qu’un capteur à ultrasons'), tl('Détecter une main ou un objet sans contact'), tl('Mesurer un niveau de liquide ou une hauteur')],
    mistakes: [tl('Lire RangeMilliMeter sans regarder RangeStatus : 8190 mm veut dire « rien vu ».'), tl('Deux VL53L0X (ou un TCS34725) sur le même bus à 0x29 : tenez l’un éteint par XSHUT et changez l’adresse de l’autre.'), tl('Laisser le film de protection jaune sur la fenêtre : les mesures sont fausses.')]
  },
  max30102: {
    specs: [[tl('LED'), tl('rouge 660 nm et infrarouge 880 nm, 0 à 51 mA')], [tl('Convertisseur'), tl('18 bits, 50 à 3200 mesures par seconde, FIFO de 32 échantillons')], [tl('Alimentation'), tl('3,3 à 5 V (module avec régulateurs 1,8 V et 3,3 V)')], [tl('Bus'), tl('I2C, adresse 0x57')], [tl('Extra'), tl('thermomètre de la puce (pas de 0,0625 °C)')]],
    how: tl('Le sang absorbe d’autant plus de lumière que le cœur vient de battre : la lumière renvoyée par le doigt baisse légèrement (moins de 1 %) à chaque battement. Compter ces creux donne le pouls. Le sang chargé d’oxygène absorbe moins le rouge que l’infrarouge : le rapport des deux variations donne la saturation en oxygène (SpO₂).'),
    uses: [tl('Cardiofréquencemètre sur un écran OLED'), tl('Mesure de la saturation en oxygène (projet d’apprentissage)'), tl('Détecter la présence d’un doigt ou d’un objet proche')],
    mistakes: [tl('Appuyer fort sur le capteur : le sang ne circule plus et le pouls disparaît.'), tl('Lire trop lentement : la FIFO de 32 échantillons déborde et des battements se perdent ; appelez check() souvent.'), tl('Module tiré à 1,8 V sur un Uno en 5 V : le bus I2C ne fonctionne pas toujours.')]
  },
  tcs34725: {
    specs: [[tl('Mesures'), tl('rouge, vert, bleu et lumière totale (clair), 16 bits chacune')], [tl('Réglages'), tl('intégration 2,4 à 614 ms, gain 1, 4, 16 ou 60')], [tl('Alimentation'), tl('3 à 5 V (module avec régulateur), LED blanche d’éclairage')], [tl('Bus'), tl('I2C, adresse 0x29')]],
    how: tl('Douze photodiodes de chaque filtre accumulent la lumière pendant le temps d’intégration ; plus il est long (ou le gain grand), plus les nombres sont grands, jusqu’à saturer. La couleur se lit dans les proportions rouge / vert / bleu, la luminosité dans le canal clair. Un filtre coupe l’infrarouge, qui fausserait les couleurs.'),
    uses: [tl('Trier des objets par couleur (bonbons, pièces, briques)'), tl('Suivre une ligne de couleur'), tl('Mesurer la température de couleur d’un éclairage')],
    mistakes: [tl('Intégration trop longue en pleine lumière : les quatre canaux saturent et la couleur est fausse.'), tl('Comparer les nombres bruts sans tenir compte du canal clair : divisez par lui (getRGB le fait).'), tl('Même adresse que le VL53L0X : un seul des deux sur le bus, sauf à changer l’adresse du VL53L0X.')]
  },
  ccs811: {
    specs: [[tl('Mesures'), tl('eCO₂ 400 à 8192 ppm, COV totaux 0 à 1187 ppb')], [tl('Cadence'), tl('une mesure par seconde, 10 s, 60 s, ou 250 ms (brut)')], [tl('Alimentation'), tl('1,8 à 3,6 V : pas de régulateur sur le module CJMCU-811')], [tl('Bus'), tl('I2C, adresse 0x5A (ADDR à la masse) ou 0x5B ; WAKE à la masse')]],
    how: tl('Une couche d’oxyde métallique chauffée change de résistance en présence de composés organiques volatils (alcools, solvants, haleine). Le micrologiciel de la puce en déduit les COV totaux et un équivalent CO₂ : c’est une estimation, pas une mesure directe du CO₂. Au démarrage, le programme doit lancer ce micrologiciel (APP_START).'),
    uses: [tl('Voyant d’aération d’une salle de classe'), tl('Station de qualité de l’air avec un BME280 pour la compensation'), tl('Détecter la présence humaine dans une pièce fermée')],
    mistakes: [tl('Alimenter le module en 5 V : la puce est détruite.'), tl('Laisser WAKE en l’air : la puce ne répond pas sur le bus.'), tl('Croire les premières minutes de mesure : il faut 20 minutes de chauffe (48 h la première fois).')]
  },
  bme680: {
    specs: [[tl('Mesures'), tl('−40 à 85 °C, 0 à 100 % HR, 300 à 1100 hPa, résistance du gaz')], [tl('Gaz'), tl('plaque chauffée (≈ 320 °C), résistance de quelques kΩ à quelques centaines de kΩ')], [tl('Alimentation'), tl('3 à 5 V (module avec régulateur)')], [tl('Bus'), tl('I2C, adresse 0x77 (0x76 avec SDO à la masse)')]],
    how: tl('Le BME280 (température, humidité, pression) plus une petite plaque d’oxyde chauffée : sa résistance baisse quand l’air contient des composés volatils. Chaque mesure se demande (mode forcé), dure le temps de la chauffe, puis la bibliothèque convertit les nombres bruts avec les coefficients d’étalonnage lus dans la puce.'),
    uses: [tl('Station météo complète'), tl('Suivi de la qualité de l’air intérieur (tendance de la résistance du gaz)'), tl('Altimètre, avec la pression')],
    mistakes: [tl('Lire la résistance du gaz comme une concentration : elle dépend de chaque puce, seule sa variation compte.'), tl('Mesurer trop souvent : la chauffe réchauffe aussi la puce, la température lue monte.'), tl('Oublier performReading() avant de lire temperature ou gas_resistance : on relit l’ancienne mesure.')]
  },
  hx711: {
    specs: [[tl('Capteur'), tl('barre de force (jauges de contrainte en pont), 5 kg, 1 mV/V')], [tl('Convertisseur'), tl('HX711, 24 bits, gain 128, 10 mesures par seconde')], [tl('Alimentation'), tl('2,6 à 5,5 V')], [tl('Liaison'), tl('2 fils : DT (données) et SCK (horloge), sur deux broches quelconques')]],
    how: tl('Quatre jauges collées sur la barre changent très légèrement de résistance quand elle plie : quelques millivolts au plus. Le HX711 amplifie ce signal 128 fois et le convertit en un nombre de 24 bits. Le programme retire la valeur à vide (tare) puis divise par le nombre de coups par gramme (étalonnage).'),
    uses: [tl('Balance de cuisine ou de marché'), tl('Peser une ruche, un sac de récolte, un réservoir'), tl('Compter des pièces identiques par leur masse')],
    mistakes: [tl('Fixer la barre sans espace sous son extrémité libre : elle ne peut pas plier, la mesure reste à zéro.'), tl('Poser la barre à l’envers (flèche gravée vers le haut) : les masses deviennent négatives.'), tl('Oublier l’étalonnage : get_units() rend des coups, pas des grammes.'), tl('Inverser les fils A+ et A− de la barre : même effet qu’une barre à l’envers.')]
  },
  acs712: {
    specs: [[tl('Versions'), tl('±5 A (185 mV/A), ±20 A (100 mV/A), ±30 A (66 mV/A)')], [tl('Sortie'), tl('VCC/2 à 0 A, proportionnelle à VCC')], [tl('Alimentation'), tl('4,5 à 5,5 V, 10 mA')], [tl('Primaire'), tl('1,2 mΩ, isolé de la sortie (2,1 kV efficaces)')], [tl('Bande passante'), tl('80 kHz')], [tl('Bruit'), tl('21, 11 ou 7 mV crête à crête selon la version')]],
    how: tl('Le courant traverse une piste de cuivre dans la puce ; le champ magnétique qu’il crée est mesuré par un capteur à effet Hall, sans contact électrique avec le circuit mesuré. La sortie vaut VCC/2 sans courant, monte quand le courant va de IP+ vers IP− et descend dans l’autre sens : il mesure le continu comme l’alternatif.'),
    uses: [tl('Consommation d’un moteur, d’une pompe, d’un panneau solaire'), tl('Détecter un moteur bloqué (courant qui grimpe)'), tl('Compteur d’énergie d’une petite installation')],
    mistakes: [tl('Oublier de retirer le décalage de 2,5 V : sans courant, analogRead() rend environ 512, pas 0.'), tl('Prendre la version 30 A pour mesurer 200 mA : 66 mV/A, le pas de l’ADC (4,9 mV) vaut déjà 74 mA.'), tl('Lire OUT sur une carte 3,3 V sans pont diviseur : la sortie monte jusqu’à près de 5 V.'), tl('Faire passer le secteur 230 V sans boîtier ni protection : l’isolation de la puce ne protège pas les doigts.')]
  },
  ttp223: {
    specs: [[tl('Détection'), tl('un doigt à travers 0 à 3 mm de plastique ou de verre')], [tl('Alimentation'), tl('2 à 5,5 V')], [tl('Sortie'), tl('SIG : HIGH tant que le doigt est posé (réglable)')], [tl('Temps de réponse'), tl('environ 60 ms')]],
    how: tl('La pastille forme un petit condensateur avec son environnement. Un doigt, conducteur, augmente sa capacité ; la puce le repère et change sa sortie. Elle se recalibre en permanence pour suivre l’humidité et la température.'),
    uses: [tl('Bouton sans pièce mobile, étanche derrière une vitre'), tl('Interrupteur de lampe tactile'), tl('Clavier ou jeu à boutons tactiles')],
    mistakes: [tl('Toucher la pastille à la mise sous tension : elle prend le doigt pour la référence et ne réagit plus.'), tl('La coller sur du métal : elle détecte en permanence.')]
  },
  rcwl0516: {
    specs: [[tl('Principe'), tl('radar Doppler à 3,2 GHz')], [tl('Portée'), tl('5 à 7 m, à travers le plastique, le bois ou une cloison fine')], [tl('Alimentation'), tl('4 à 28 V sur VIN')], [tl('Sortie'), tl('OUT : 3,3 V pendant environ 2 s à chaque mouvement')]],
    how: tl('Le module émet une onde radio et écoute son écho. Quand quelque chose bouge, l’écho change légèrement de fréquence (effet Doppler) : le module le détecte et met OUT au niveau haut. Contrairement au PIR, il ne mesure pas la chaleur : il voit aussi les objets.'),
    uses: [tl('Éclairage automatique d’un couloir ou d’un escalier'), tl('Détecteur caché dans un boîtier fermé'), tl('Compter les passages')],
    mistakes: [tl('Le placer près d’un ventilateur ou d’un rideau : il détecte en permanence.'), tl('Mettre du métal devant : le radar ne le traverse pas.'), tl('Croire qu’il donne une distance : il dit seulement « mouvement » ou « rien ».')]
  },
  mq135: {
    specs: [[tl('Gaz détectés'), tl('ammoniac, oxydes d’azote, alcool, benzène, fumée, CO₂')], [tl('Chauffage'), tl('5 V, environ 170 mA')], [tl('Sorties'), tl('AO analogique (monte avec la pollution) · DO numérique (LOW au-delà du seuil)')], [tl('Préchauffage'), tl('24 h la première fois, quelques minutes ensuite')]],
    how: tl('Une couche d’oxyde d’étain chauffée par un filament devient plus conductrice en présence de ces gaz. Le module la place dans un pont diviseur : la tension AO monte quand l’air est plus pollué, et un comparateur fait passer DO à LOW au-delà du seuil réglé.'),
    uses: [tl('Indicateur de qualité de l’air d’une salle de classe'), tl('Déclencher une aération quand l’air est vicié'), tl('Détecter la fumée ou des vapeurs d’alcool')],
    mistakes: [tl('Lire la valeur comme des ppm de CO₂ exacts : c’est une tendance, pas une mesure étalonnée.'), tl('L’alimenter par une broche ou en 3,3 V : le filament demande 5 V et 170 mA.'), tl('Relier AO directement à une carte 3,3 V : passez par un pont diviseur.')]
  },
  lm35: {
    specs: [[tl('Alimentation'), tl('4 à 30 V, moins de 60 µA')], [tl('Sortie'), tl('10 mV par °C (0,25 V à 25 °C)')], [tl('Plage'), tl('2 à 150 °C avec ce montage simple')], [tl('Précision'), tl('±0,5 °C à 25 °C')], [tl('Boîtier'), tl('TO-92, trois pattes')]],
    how: tl('La puce produit une tension proportionnelle à la température en degrés Celsius : il suffit de la lire avec analogRead() et de la multiplier. Température (°C) = tension (V) × 100.'),
    uses: [tl('Thermomètre sans bibliothèque'), tl('Alarme de surchauffe'), tl('Premier capteur analogique')],
    mistakes: [tl('Le monter à l’envers (face plate vers soi : VS, VOUT, GND de gauche à droite) : il chauffe très vite.'), tl('L’alimenter en 3,3 V : sous 4 V, la mesure n’est plus juste.'), tl('Oublier la conversion : analogRead() rend une valeur brute, pas des degrés.')]
  },
  flame: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Détection'), tl('infrarouge de 760 à 1100 nm, environ 60°, jusqu’à 1 m pour une bougie')], [tl('Comparateur'), tl('LM393, seuil réglable')], [tl('Sorties'), tl('AO analogique · DO numérique (LOW quand une flamme est vue)')]],
    how: tl('Une photodiode infrarouge noire reçoit le rayonnement d’une flamme. AO baisse quand la flamme est plus forte ou plus proche ; le comparateur fait passer DO à LOW au-delà du seuil du potentiomètre.'),
    uses: [tl('Alarme incendie de démonstration'), tl('Robot pompier qui cherche une bougie')],
    mistakes: [tl('Tester au soleil : il est plein d’infrarouge.'), tl('Le prendre pour un détecteur de sécurité certifié : il ne l’est pas.'), tl('Approcher la flamme trop près : le capteur chauffe et se déforme.')]
  },
  rain: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Plaque'), tl('pistes croisées nickelées, environ 5 × 4 cm')], [tl('Comparateur'), tl('LM393, seuil réglable')], [tl('Sorties'), tl('AO analogique · DO numérique (LOW quand c’est mouillé)')]],
    how: tl('Les gouttes relient les pistes de la plaque : sa résistance baisse, la tension AO aussi. Le comparateur fait passer DO à LOW au-delà du seuil réglé.'),
    uses: [tl('Fermer une fenêtre de toit quand il pleut'), tl('Arrêter l’arrosage par temps de pluie')],
    mistakes: [tl('Laisser la plaque alimentée en permanence : elle se corrode en quelques jours.'), tl('Mouiller le module comparateur : seule la plaque va dehors.')]
  },
  water: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Zone de mesure'), tl('environ 40 mm de pistes de cuivre')], [tl('Sortie'), tl('S analogique : 0 V au sec, jusqu’à environ 70 % de l’alimentation immergé')]],
    how: tl('Des pistes reliées à l’alimentation et d’autres reliées à un transistor alternent sur la plaque. Plus elles trempent, plus l’eau les relie et plus la tension S monte.'),
    uses: [tl('Alarme de fuite d’eau'), tl('Niveau d’un réservoir d’arrosage'), tl('Détecter une baignoire qui déborde')],
    mistakes: [tl('Immerger tout le module : les composants ne supportent pas l’eau.'), tl('Attendre une mesure en millimètres précise : la valeur dépend de l’eau (sel, minéraux).'), tl('Le laisser alimenté en continu : les pistes se corrodent.')]
  },
  irobst: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Portée'), tl('2 à 30 cm, réglable par le potentiomètre')], [tl('Angle'), '≈ 35°'], [tl('Sortie'), tl('OUT numérique : LOW quand un obstacle est vu')]],
    how: tl('La LED transparente envoie de l’infrarouge ; la photodiode noire reçoit ce qu’un obstacle renvoie. Au-delà du seuil réglé, le comparateur fait passer OUT à LOW et allume la LED témoin.'),
    uses: [tl('Robot qui évite les obstacles'), tl('Compter des objets qui passent'), tl('Distributeur de gel sans contact')],
    mistakes: [tl('Attendre une distance : il dit seulement « obstacle » ou « rien ».'), tl('Viser un objet noir mat : il renvoie peu de lumière et n’est vu que de très près.')]
  },
  line: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Capteur'), tl('TCRT5000 : LED infrarouge et phototransistor côte à côte')], [tl('Distance au sol'), tl('1 à 8 mm, idéalement 2 à 3 mm')], [tl('Sorties'), tl('DO numérique (HIGH sur une ligne noire) · AO analogique')]],
    how: tl('La LED éclaire le sol ; une surface claire renvoie beaucoup de lumière, une ligne noire presque rien. Le comparateur transforme cette différence en un niveau logique sur DO.'),
    uses: [tl('Robot suiveur de ligne (deux ou trois capteurs)'), tl('Compte-tours avec une bande noire'), tl('Détecter une marque sur un tapis roulant')],
    mistakes: [tl('Le placer à plusieurs centimètres du sol : il ne voit plus rien.'), tl('Ne pas régler le seuil au-dessus de la vraie ligne et du vrai sol.')]
  },
  hall: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Capteur'), tl('A3144, tout-ou-rien, réagit au pôle sud')], [tl('Sortie'), tl('S : LOW près d’un aimant, HIGH sinon')]],
    how: tl('Un champ magnétique dévie les électrons qui traversent la puce et crée une petite tension (effet Hall). La puce la compare à un seuil et commande sa sortie.'),
    uses: [tl('Détecter une porte fermée (aimant sur la porte)'), tl('Compte-tours d’une roue avec un aimant'), tl('Interrupteur sans contact')],
    mistakes: [tl('Présenter le mauvais pôle de l’aimant : retournez-le.'), tl('Croire qu’il mesure la force du champ : celui-ci répond seulement oui ou non.')]
  },
  'tilt-sw': {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Contact'), tl('SW-520D, bille métallique')], [tl('Sortie'), tl('S : LOW droit, HIGH penché au-delà d’environ 45°')]],
    how: tl('Une bille roule dans un petit tube : capteur droit, elle relie les deux contacts ; penché, elle s’en écarte et le contact s’ouvre.'),
    uses: [tl('Alarme de chute ou de renversement'), tl('Jouet qui réagit quand on le retourne')],
    mistakes: [tl('Attendre un angle : il dit seulement « droit » ou « penché ».'), tl('Ne pas filtrer les rebonds de la bille : plusieurs changements pour un seul mouvement.')]
  },
  shock: {
    specs: [[tl('Alimentation'), tl('3,3 à 5 V')], [tl('Capteur'), tl('SW-420, à ressort, normalement fermé')], [tl('Comparateur'), tl('LM393, sensibilité réglable')], [tl('Sortie'), tl('DO : HIGH pendant une secousse')]],
    how: tl('Au repos, le ressort du tube touche le contact. Une secousse le fait vibrer et ouvrir le contact par instants ; le comparateur transforme ces coupures en impulsions sur DO.'),
    uses: [tl('Alarme antivol sur un objet'), tl('Détecter un choc sur un colis'), tl('Machine qui vibre anormalement')],
    mistakes: [tl('Lire DO une seule fois : une secousse donne des impulsions brèves, comptez-les ou utilisez une interruption.')]
  },
  laser: {
    specs: [[tl('Commande'), tl('S à HIGH : allumé (3,3 ou 5 V)')], [tl('Diode'), tl('rouge 650 nm, ≤ 5 mW (classe 3R)')], [tl('Courant'), tl('environ 30 mA')]],
    how: tl('La diode laser et sa résistance sont commandées directement par la sortie de la carte : HIGH l’allume, LOW l’éteint, une PWM fait varier sa puissance moyenne.'),
    uses: [tl('Barrière laser avec une photorésistance'), tl('Pointeur de démonstration')],
    mistakes: [tl('Viser un œil ou un miroir : danger pour la vue, même brièvement.'), tl('Croire qu’il éclaire comme une lampe : c’est un point, pas une zone.')]
  },
  traffic: {
    specs: [[tl('LED'), tl('rouge, orange, verte, avec leurs résistances')], [tl('Commande'), tl('une broche par couleur, HIGH allume')], [tl('Masse'), tl('commune (GND)')]],
    how: tl('Chaque couleur est une LED avec sa résistance sur la carte : on la relie directement à une sortie. Le programme allume une couleur à la fois, comme un vrai feu.'),
    uses: [tl('Feu tricolore d’un carrefour'), tl('Témoin d’état (OK, attention, alarme)'), tl('Feu de passage piéton avec un bouton')],
    mistakes: [tl('Allumer deux couleurs à la fois par oubli d’un digitalWrite(…, LOW).'), tl('Ajouter une résistance : elle est déjà sur le module.')]
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
  ky040: {
    specs: [[tl('Crans'), tl('20 par tour, une période de quadrature par cran')], [tl('Sorties'), tl('CLK (A) et DT (B), tirées au niveau haut par 10 kΩ ; SW à la masse quand on appuie')], [tl('Alimentation'), tl('3,3 à 5 V (tension logique de la carte)')], [tl('Rotation'), tl('sans fin, dans les deux sens')]],
    how: tl('Deux contacts frottent sur une couronne crantée et ouvrent ou ferment leur ligne à tour de rôle : les signaux A et B sont décalés d’un quart de période. Dans le sens horaire, A change avant B ; dans l’autre sens, B mène. Au front de A, il suffit de lire B : différent de A, on avance ; égal, on recule. Contrairement à un potentiomètre, l’encodeur ne connaît pas sa position absolue : le programme compte les crans.'),
    uses: [tl('Bouton de réglage sans butée (volume, consigne, menu)'), tl('Navigation dans un menu sur écran LCD ou OLED, avec validation par appui'), tl('Compter les tours d’un axe lent')],
    mistakes: [tl('Lire CLK et DT trop rarement (delay() dans loop()) : des crans se perdent ; utilisez une interruption (D2/D3 sur l’Uno) ou la bibliothèque Encoder.'), tl('Diviser read() par 2 au lieu de 4 : la bibliothèque Encoder compte 4 fronts par cran.'), tl('SW lu sans INPUT_PULLUP : sur beaucoup de modules, sa résistance de tirage n’est pas soudée et l’entrée flotte.')]
  },
  irremote: {
    specs: [[tl('Touches'), tl('21 (CH, ⏮ ⏭ ⏯, volume, EQ, 0 à 9, 100+, 200+)')], [tl('Protocole'), tl('NEC, adresse 0x00, porteuse 38 kHz')], [tl('Pile'), tl('CR2025 (3 V)')], [tl('Portée'), tl('≈ 8 m, LED dirigée vers le récepteur')]],
    how: tl('Chaque touche envoie une trame NEC : salve de 9 ms, silence de 4,5 ms, puis 32 bits (adresse, adresse inversée, commande, commande inversée), le bit de poids faible d’abord. Une touche maintenue envoie une trame de répétition toutes les 110 ms. Le récepteur (VS1838B) démodule la porteuse ; la bibliothèque IRremote mesure les durées et rend la commande.'),
    uses: [tl('Piloter un robot, une lampe ou un menu à distance'), tl('Saisir un code à quatre chiffres')],
    mistakes: [tl('Comparer decodedRawData au lieu de command : la valeur brute dépend de l’ordre des bits et de l’adresse.'), tl('Agir sur les trames de répétition comme sur un nouvel appui : testez IRDATA_FLAGS_IS_REPEAT.'), tl('Oublier IrReceiver.resume() : la trame suivante n’est jamais lue.')]
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
  psu24: {
    specs: [[tl('Sortie'), tl('24 V continu, 2,5 A (60 W) ; réglable de 21,6 à 29 V')], [tl('Entrée'), tl('85 à 264 V alternatif (secteur)')], [tl('Montage'), tl('rail DIN, dans une armoire ou sur un banc')], [tl('Source'), 'MEAN WELL HDR-60 (spécification) : 24 V, 2,5 A, plage de réglage 21,6 à 29 V']],
    how: tl('Un bloc secteur à découpage transforme le 230 V du réseau en 24 V continu, la tension des automatismes industriels : distributeurs pneumatiques, capteurs, voyants. Dans le simulateur, il alimente les bobines d’électrovanne ; son 0 V est relié à la masse de la carte pour que le transistor de commande fonctionne.'),
    uses: [tl('Alimenter les bobines des distributeurs pneumatiques'), tl('Banc d’électropneumatique avec une carte Arduino ou ESP32'), tl('Armoire d’automatisme')],
    mistakes: [tl('Relier le 24 V à une broche de la carte : elle est détruite.'), tl('Oublier de relier le 0 V à la masse de la carte : la commande par transistor ne marche plus.'), tl('Câbler le côté secteur sans protection : seul un adulte qualifié le fait, appareil débranché.')]
  },
  coil24: {
    specs: [[tl('Tension'), tl('24 V continu, ±10 %')], [tl('Puissance'), tl('3,0 W, soit ≈ 125 mA')], [tl('Temps de réponse'), tl('0,05 s au plus')], [tl('Pression du distributeur'), tl('1,5 à 8 bar')], [tl('Source'), 'AirTAC, distributeurs série 4V (tableau des bobines) : DC24V ±10 %, 3,0 W, 0,05 s']],
    how: tl('Une bobine de fil de cuivre devient un électroaimant quand le courant la traverse : elle attire le noyau qui fait basculer le tiroir du distributeur. Dans le simulateur, la bobine est excitée au-delà de 18 V : le distributeur du plan de travail pneumatique qui porte le même repère (Y1…) bascule. Au repos, son ressort le ramène.'),
    uses: [tl('Commander un vérin depuis un programme Arduino'), tl('Porte automatique, presse, tri de pièces'), tl('Apprendre l’électropneumatique')],
    mistakes: [tl('La brancher sur une broche de la carte : elle demande 24 V et 125 mA.'), tl('Oublier la diode de roue libre : à la coupure, la bobine renvoie une pointe de tension qui détruit le transistor.'), tl('Donner un repère qui n’existe pas dans le plan pneumatique : le distributeur ne bascule jamais.')]
  },
  pressostat: {
    specs: [[tl('Contact'), tl('normalement ouvert, fermé au-dessus du seuil')], [tl('Câblage'), tl('2 fils : entrée INPUT_PULLUP et masse')], [tl('Seuil'), tl('réglé sur le pressostat du plan de travail pneumatique')]],
    how: tl('Une membrane, poussée par l’air, actionne un contact quand la pression dépasse le seuil réglé. La carte sait alors que le réseau ou un vérin est sous pression : démarrage autorisé, serrage assuré, alarme de chute de pression. Dans le plan de travail pneumatique, le pressostat porte le repère de ce contact (S1…).'),
    uses: [tl('Vérifier qu’une pièce est bien serrée avant d’usiner'), tl('Alarme de chute de pression du réseau d’air'), tl('Démarrer un cycle seulement quand l’air est là')],
    mistakes: [tl('Régler le seuil au-dessus de la pression du réseau : le contact ne se ferme jamais.'), tl('Lire l’entrée sans INPUT_PULLUP : elle flotte quand le contact est ouvert.')]
  },
  cylsensor: {
    specs: [[tl('Contact'), tl('ILS (ampoule à lames souples), normalement ouvert')], [tl('Câblage'), tl('2 fils : entrée INPUT_PULLUP et masse')], [tl('Lecture'), tl('LOW quand le piston est devant')]],
    how: tl('Le piston d’un vérin « magnétique » porte un aimant. Le capteur, fixé sur le tube du vérin, ferme son contact quand l’aimant passe devant : la carte sait alors que le vérin est rentré (capteur B1) ou sorti (capteur B2). Dans le plan de travail pneumatique, un vérin porte les repères de ses capteurs.'),
    uses: [tl('Savoir qu’un vérin est arrivé en fin de course'), tl('Enchaîner les mouvements d’un cycle automatique'), tl('Compter les cycles d’une machine')],
    mistakes: [tl('Lire l’entrée sans INPUT_PULLUP : elle flotte quand le contact est ouvert.'), tl('Placer les deux capteurs au même repère : le programme ne distingue plus rentré et sorti.'), tl('Utiliser un vérin sans aimant : le capteur ne voit jamais le piston.')]
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
  l293d: {
    specs: [[tl('Alimentation moteurs (VCC2)'), tl('4,5 à 36 V')], [tl('Logique (VCC1)'), tl('4,5 à 7 V')], [tl('Courant'), tl('600 mA par voie (1,2 A en pointe)')], [tl('Chute de tension'), tl('≈ 1,4 V côté haut et 1,2 V côté bas à 600 mA')], [tl('Charges'), tl('2 moteurs à courant continu (sens et vitesse), ou 1 moteur pas à pas bipolaire')], [tl('Boîtier'), tl('DIP-16, diodes de roue libre intégrées')]],
    how: tl('Quatre demi-ponts : chaque sortie OUTn recopie son entrée INn, à la tension des moteurs. Un moteur entre OUT1 et OUT2 tourne dans un sens quand IN1/IN2 valent HIGH/LOW, dans l’autre pour LOW/HIGH. EN12 valide la première paire, EN34 la seconde ; une PWM sur EN règle la vitesse (LOW : roue libre).'),
    uses: [tl('Petit robot à deux roues (moteurs jaunes 3-6 V)'), tl('Ventilateur ou pompe dans les deux sens'), tl('Montage sur breadboard : la puce s’enfiche directement')],
    mistakes: [tl('Oublier VCC2 : la logique fonctionne mais les moteurs ne reçoivent rien.'), tl('Dépasser 600 mA : la puce chauffe et coupe ; un moteur bloqué en tire bien plus.'), tl('Laisser EN12 en l’air : contrairement au L298N, il n’y a pas de cavalier, la voie reste coupée.')]
  },
  tb6612: {
    specs: [[tl('Alimentation moteurs (VM)'), tl('2,5 à 13,5 V (15 V au maximum absolu)')], [tl('Logique (VCC)'), tl('2,7 à 5,5 V')], [tl('Courant'), tl('1,2 A moyens par voie, 3,2 A en pointe')], [tl('Résistance'), tl('≈ 0,5 Ω (MOSFET haut + bas)')], [tl('PWM'), tl('jusqu’à 100 kHz')]],
    how: tl('Deux ponts en H à MOSFET. AIN1/AIN2 donnent le sens (HIGH/LOW, LOW/HIGH), HIGH/HIGH freine en court-circuitant le moteur, LOW/LOW le laisse libre. PWMA découpe : pendant l’impulsion le moteur est alimenté, le reste du temps il est freiné. STBY bas met tout en veille.'),
    uses: [tl('Robot sur batterie Li-ion 7,4 V : presque toute la tension arrive aux moteurs'), tl('Cartes 3,3 V (ESP32, Pico) : logique compatible sans adaptateur')],
    mistakes: [tl('Laisser STBY en l’air : tirée à la masse dans la puce, rien ne tourne.'), tl('Alimenter VM en 24 V : au-delà de 15 V la puce est détruite.'), tl('Confondre frein et arrêt : PWM à 0 freine le moteur, IN1 = IN2 = LOW le laisse tourner sur son élan.')]
  },
  nema17: {
    specs: [[tl('Pas'), tl('1,8° (200 pas par tour)')], [tl('Courant nominal'), tl('1,7 A par phase')], [tl('Bobines'), tl('2, de 1,5 Ω et 2,8 mH')], [tl('Couple de maintien'), tl('≈ 0,4 N·m')], [tl('Taille'), tl('42,3 × 42,3 × 40 mm, axe de 5 mm')]],
    how: tl('Deux bobines (A et B) entourent un rotor aimanté à 50 paires de pôles. Le pilote alimente les bobines tour à tour, dans un sens puis dans l’autre : le rotor avance d’un pas (1,8°) à chaque changement. En microrésolution, le courant est partagé entre les deux bobines et le rotor s’arrête entre deux pas.'),
    pinout: [['A+, A−', tl('Bobine A (souvent fils rouge et bleu, ou noir et vert selon le fabricant)')], ['B+, B−', tl('Bobine B')]],
    uses: [tl('Axes d’une imprimante 3D, d’une petite fraiseuse ou d’un traceur'), tl('Plateau tournant, glissière de caméra'), tl('Positionnement précis sans capteur')],
    mistakes: [tl('Mélanger les fils de deux bobines : le moteur vibre sans tourner (trouvez les paires à l’ohmmètre).'), tl('Démarrer trop vite sans rampe d’accélération : il décroche et perd des pas (AccelStepper règle ce problème).'), tl('Régler le courant du pilote au-dessus de 1,7 A : le moteur brûle au toucher.')]
  },
  a4988: {
    specs: [[tl('Alimentation moteur (VMOT)'), tl('8 à 35 V')], [tl('Logique (VDD)'), tl('3 à 5,5 V')], [tl('Courant'), tl('≈ 1 A par phase sans radiateur, 2 A au plus')], [tl('Microrésolution'), tl('1, 1/2, 1/4, 1/8, 1/16 de pas (MS1 à MS3)')], [tl('Réglage du courant'), tl('Vref = 8 × I × 0,068 Ω (0,54 V pour 1 A)')]],
    how: tl('Un traducteur intégré : chaque front montant sur STEP fait avancer d’un cran la séquence des courants dans les deux bobines, dans le sens donné par DIR. Le pilote découpe la tension de VMOT pour que le courant atteigne la valeur réglée, sans plus : un moteur de 1,5 Ω peut tourner sous 24 V.'),
    uses: [tl('Imprimante 3D et CNC (carte RAMPS, CNC Shield)'), tl('Tout moteur NEMA 17 commandé par deux broches')],
    mistakes: [tl('Oublier de relier RESET à SLEEP : RESET en l’air, le pilote ignore les pas.'), tl('Régler Vref trop haut sans radiateur : la puce surchauffe et coupe.'), tl('Débrancher le moteur sous tension : la pointe de tension détruit le pilote.'), tl('Pas de condensateur de 47 µF ou plus sur VMOT : les pointes à la mise sous tension dépassent 35 V.')]
  },
  drv8825: {
    specs: [[tl('Alimentation moteur (VMOT)'), tl('8,2 à 45 V')], [tl('Logique'), tl('aucune : régulateur interne, entrées 3,3 et 5 V')], [tl('Courant'), tl('≈ 1,5 A par phase sans radiateur, 2,2 A au plus')], [tl('Microrésolution'), tl('jusqu’à 1/32 de pas (M0 à M2)')], [tl('Réglage du courant'), tl('Vref = I ÷ 2 (0,5 V pour 1 A)')]],
    how: tl('Même principe que l’A4988 (STEP, DIR, découpage du courant), même brochage à une broche près : FAULT remplace VDD et signale une surchauffe ou une surintensité. Ses impulsions STEP doivent durer au moins 1,9 µs.'),
    uses: [tl('Moteurs plus gros ou alimentation 36 V'), tl('Mouvement plus doux en 1/32 de pas')],
    mistakes: [tl('Laisser SLEEP et RESET en l’air : tirées à la masse dans la puce, le pilote reste endormi.'), tl('Mesurer Vref avec la formule de l’A4988 : ici le courant vaut 2 × Vref.'), tl('Des impulsions STEP trop courtes (moins de 1,9 µs) : des pas sont ignorés.')]
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
  pnp: {
    specs: [[tl('Tension'), tl('45 V maximum')], [tl('Courant collecteur'), tl('100 mA maximum')], [tl('Puissance'), '625 mW'], [tl('Gain'), tl('120 à 800')], [tl('Brochage'), tl('C, B, E, face plate vers soi (comme le BC547)')]],
    how: tl('Le complément du BC547, avec tous les sens inversés : le courant entre par l’émetteur, relié au +, et sort par le collecteur vers la charge. Il conduit quand la base est tirée sous l’émetteur (≈ 0,7 V plus bas) : une broche à LOW, à travers 1 kΩ, le rend passant ; à HIGH, à la tension de l’émetteur, il se bloque. Il commute ainsi le côté + d’une charge dont l’autre borne reste à la masse.'),
    pinout: [['C', tl('Collecteur : vers le + de la charge')], ['B', tl('Base : vers la broche de la carte, via ≈ 1 kΩ')], ['E', tl('Émetteur : vers le + (tension logique de la carte)')]],
    uses: [tl('Commuter le + d’une charge dont le − doit rester à la masse'), tl('Étage complémentaire d’un NPN (push-pull, pont en H)')],
    mistakes: [tl('Attendre que HIGH l’allume : c’est LOW qui le rend passant.'), tl('Émetteur au 5 V et base commandée par une carte 3,3 V : la base reste sous l’émetteur, il ne se bloque jamais.'), tl('Le monter comme un NPN, émetteur à la masse : il ne conduit pas.')]
  },
  pn2907: {
    specs: [[tl('Tension'), tl('60 V maximum')], [tl('Courant collecteur'), tl('600 mA maximum (500 mA conseillés)')], [tl('Puissance'), '625 mW'], [tl('Gain'), tl('100 à 300 (à 150 mA)')], [tl('Vce(sat)'), tl('0,4 V au plus à 150 mA')], [tl('Brochage'), tl('E, B, C, face plate vers soi')]],
    how: tl('Le complément du PN2222A : émetteur au +, charge entre le collecteur et la masse. Une broche à LOW tire 2 à 4 mA hors de la base, à travers 1 kΩ, et le sature pour quelques centaines de mA ; à HIGH, à la tension de l’émetteur, il se bloque.'),
    pinout: [['E', tl('Émetteur : vers le + (tension logique de la carte)')], ['B', tl('Base : vers la broche de la carte, via 1 kΩ')], ['C', tl('Collecteur : vers le + de la charge')]],
    uses: [tl('Ventilateur, pompe ou bande de LED commandés côté +'), tl('Étage complémentaire du PN2222A')],
    mistakes: [tl('Attendre que HIGH l’allume : c’est LOW qui le rend passant.'), tl('Émetteur à une tension plus haute que celle de la broche (12 V, ou 5 V sur une carte 3,3 V) : il reste passant. Ajoutez un NPN pour tirer la base.'), tl('Oublier la diode de roue libre aux bornes d’un moteur.')]
  },
  'zener-3v3': ZENER_DOC(tl('3,3 V'), tl('3,1 à 3,5 V'), tl('85 Ω au plus'), tl('Référence ou limitation à 3,3 V : protéger une entrée d’ESP32 ou de Pico')),
  'zener-5v1': ZENER_DOC(tl('5,1 V'), tl('4,8 à 5,4 V'), tl('35 Ω au plus'), tl('Protéger une entrée 5 V contre les surtensions')),
  'zener-12v': ZENER_DOC('12 V', tl('11,4 à 12,7 V'), tl('20 Ω au plus'), tl('Limiter la tension sur la grille d’un MOSFET alimenté en 24 V')),

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
  ams1117: {
    specs: [[tl('Entrée'), tl('4,5 à 15 V')], [tl('Sortie'), tl('3,3 V, 1 A au plus')], [tl('Chute minimale'), tl('1,1 V à 0,8 A (1,3 V au pire)')], [tl('Boîtier'), tl('SOT-223 sur un petit module, condensateurs soudés')]],
    how: tl('Régulateur linéaire à faible chute : un transistor en série laisse passer juste ce qu’il faut pour garder 3,3 V en sortie, et transforme le reste en chaleur, P = (VIN − 3,3 V) × I. Le courant pris à l’entrée est celui de la sortie. Sous 4,4 V d’entrée, il ne régule plus : la sortie suit l’entrée moins ≈ 1,1 V.'),
    uses: [tl('Alimenter un ESP32 ou un ESP8266 depuis le 5 V d’un chargeur USB'), tl('Rail 3,3 V pour des modules (nRF24L01, RC522) quand le 3V3 de la carte ne suffit plus'), tl('Seconde étape après un LM2596 (12 V → 5 V → 3,3 V)')],
    mistakes: [tl('L’alimenter avec un accu 18650 (3,7 V) : il ne reste que ≈ 2,6 V, l’ESP32 redémarre en boucle.'), tl('Le brancher à l’envers (IN et OUT croisés) : rien ne fonctionne, ou il grille.'), tl('12 V en entrée pour 300 mA : 2,6 W dans un boîtier qui en supporte moins de 1 W.')]
  },
  lm2596: {
    specs: [[tl('Entrée'), tl('4,5 à 40 V')], [tl('Sortie'), tl('1,25 à 37 V, réglée par un potentiomètre multitour (5 V par défaut ici)')], [tl('Courant'), tl('3 A au plus, 2 A sans radiateur')], [tl('Rendement'), tl('≈ 85 % (73 % typiques à pleine charge, 3 A de 12 V à 5 V)')], [tl('Chute minimale'), tl('≈ 1,5 V (interrupteur saturé)')], [tl('Fréquence'), '150 kHz']],
    how: tl('Convertisseur abaisseur (buck) : un interrupteur hache la tension d’entrée 150 000 fois par seconde, une bobine et un condensateur lissent le résultat. La puissance se conserve au rendement près : Vin × Iin ≈ Vout × Iout ÷ 0,85, donc le courant d’entrée est bien plus faible que celui de la sortie quand la tension baisse beaucoup.'),
    uses: [tl('Alimenter une carte en 5 V depuis une batterie 12 V ou une alimentation 24 V'), tl('Robot : moteurs sur la batterie, carte et servos sur le 5 V du LM2596'), tl('Remplacer un LM7805 qui chauffe trop')],
    mistakes: [tl('Brancher la carte avant d’avoir réglé la sortie : un module neuf peut sortir 12 V ou plus.'), tl('Croiser IN et OUT : il ne régule rien et peut être détruit.'), tl('Demander 5 V avec une entrée de 5 V : il lui faut au moins 1,5 V de marge, la sortie tombe à ≈ 3,5 V.')]
  },
  mt3608: {
    specs: [[tl('Entrée'), tl('2 à 24 V')], [tl('Sortie'), tl('jusqu’à 28 V, toujours au-dessus de l’entrée (9 V par défaut ici)')], [tl('Courant'), tl('2 A en entrée (interrupteur limité à 4 A)')], [tl('Rendement'), tl('≈ 90 %')], [tl('Fréquence'), '1,2 MHz']],
    how: tl('Convertisseur élévateur (boost) : un interrupteur charge une bobine puis la décharge dans la sortie à travers une diode Schottky. Puissance conservée au rendement près : la sortie monte, mais le courant d’entrée vaut Vout × Iout ÷ (0,9 × Vin), plus que le courant de sortie. Réglé sous la tension d’entrée, il laisse passer l’entrée moins la chute de la diode.'),
    uses: [tl('Obtenir 5 V depuis un accu lithium 3,7 V (avec un TP4056)'), tl('9 ou 12 V pour un petit moteur, un ruban de LED ou un capteur depuis deux piles AA'), tl('Alimenter un montage autonome solaire')],
    mistakes: [tl('Attendre qu’il abaisse la tension : il ne sait que monter.'), tl('Tirer 1 A à 9 V d’un accu de 3,7 V : l’accu fournit ≈ 2,7 A, le module chauffe et s’arrête.'), tl('Laisser le potentiomètre au hasard : jusqu’à 28 V en sortie, de quoi détruire une carte.')]
  },
  tp4056: {
    specs: [[tl('Entrée'), tl('5 V (micro-USB ou USB-C), 8 V au plus')], [tl('Charge'), tl('CC/CV : 1 A au plus, puis 4,2 V (±1,5 %) jusqu’à ce que le courant tombe à 1/10')], [tl('Protection (DW01)'), tl('surdécharge ≈ 2,4 V, surcharge, surintensité, court-circuit')], [tl('Voyants'), tl('rouge : en charge · bleu ou vert : chargé')]],
    how: tl('Chargeur linéaire pour une cellule lithium-ion : à courant constant (1 A) tant que l’accu est sous 4,2 V, puis à tension constante 4,2 V pendant que le courant diminue ; il s’arrête à 100 mA. Le circuit DW01 et ses deux MOSFET coupent la sortie OUT− si l’accu est trop déchargé ou en court-circuit. Simulation : l’accu 18650 reste à 3,7 V (sans état de charge), le chargeur y pousse donc toujours son courant maximal.'),
    uses: [tl('Montage autonome : TP4056 + accu 18650 + MT3608 pour 5 V'), tl('Station météo solaire avec un panneau 6 V sur l’entrée'), tl('Recharger un accu récupéré dans un objet')],
    mistakes: [tl('Relier le montage sur B+ et B− au lieu de OUT+ et OUT− : l’accu n’est plus protégé.'), tl('Laisser 1 A pour un petit accu de 500 mAh : il chauffe et vieillit vite (changez RPROG).'), tl('Charger deux cellules en série : le TP4056 n’en gère qu’une.'), tl('Inverser l’accu : le module et l’accu peuvent brûler.')]
  },
  solar6v: {
    specs: [[tl('Puissance'), tl('1 W (1,2 W crête)')], [tl('Tension'), tl('≈ 6 V en charge, 7,7 V à vide')], [tl('Courant'), tl('≈ 180 mA en plein soleil')], [tl('Éclairement de référence'), tl('1000 W/m² ≈ 100 000 lx')]],
    how: tl('Des cellules au silicium en série transforment la lumière en courant : le courant suit l’éclairement, la tension à vide ne baisse que peu quand la lumière faiblit. Modèle de la simulation : une source de tension à vide 7,7 V + 0,43 V × ln(éclairement) derrière une résistance choisie pour que le courant de court-circuit vaille 190 mA × l’éclairement (100 000 lx = 1) ; il ne donne donc pas toute la puissance du vrai panneau au coude de sa courbe.'),
    uses: [tl('Recharger un accu 18650 par un TP4056'), tl('Mesurer l’ensoleillement par la tension du panneau'), tl('Station autonome : capteurs et ESP32 en veille profonde')],
    mistakes: [tl('Croire qu’il donne 1 W à l’intérieur : sous une lampe (500 lx), à peine quelques mA.'), tl('Brancher un ESP32 directement dessus : au premier nuage, la tension s’effondre et la carte redémarre.'), tl('Le relier directement à un accu : la nuit, l’accu se décharge dans le panneau. Passez par un chargeur ou une diode.')]
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
  sx1278: {
    specs: [[tl('Alimentation'), tl('1,8 à 3,7 V, ≈ 10 mA en réception, jusqu’à 120 mA en émission à +20 dBm')], [tl('Radio'), tl('LoRa, 410 à 525 MHz pour le Ra-02 (433E6 en Europe et en Afrique)')], [tl('Débit'), tl('≈ 0,3 à 37 kbit/s selon le facteur d’étalement (SF6 à SF12) et la bande (7,8 à 500 kHz)')], [tl('Portée'), tl('plusieurs kilomètres en champ libre, quelques centaines de mètres en ville')], [tl('Paquets'), tl('255 octets au plus, CRC, en-tête explicite ou implicite')], [tl('Interface'), tl('SPI jusqu’à 10 MHz, logique 3,3 V (entrées non tolérantes au 5 V)')]],
    how: tl('La puce étale chaque symbole sur une rampe de fréquence (chirp) : plus le facteur d’étalement est grand, plus le paquet porte loin et plus il dure. Le programme écrit le paquet dans la FIFO de 256 octets, passe la puce en émission, et le drapeau TxDone se lève à la fin. En réception, la puce attend un préambule ; à la fin du paquet, RxDone se lève et la broche DIO0 passe à HIGH. Deux modules ne s’entendent qu’avec la même fréquence, le même facteur d’étalement, la même bande et le même mot de synchronisation.'),
    uses: [tl('Station météo ou capteur de champ à des kilomètres'), tl('Alarme ou compteur d’eau dans un bâtiment éloigné'), tl('Messagerie entre deux cartes sans réseau mobile')],
    mistakes: [tl('Module alimenté en 5 V : la puce est détruite.'), tl('NSS, SCK et MOSI attaqués en 5 V sans adaptateur de niveau.'), tl('LoRa.begin(868E6) avec un module 433 MHz : rien ne passe.'), tl('Facteur d’étalement, bande ou mot de synchronisation différents des deux côtés.'), tl('Envoyer un paquet toutes les secondes à SF12 : chacun dure presque une seconde, la réglementation limite le temps d’émission (1 % en 433 MHz).')]
  },
  w5500: {
    specs: [[tl('Alimentation'), tl('2,97 à 3,63 V, ≈ 130 mA avec un lien à 100 Mb/s')], [tl('Réseau'), tl('Ethernet 10BASE-T et 100BASE-TX, prise RJ45 à transformateurs intégrés')], [tl('Protocoles'), tl('TCP, UDP, IPv4, ICMP, ARP gérés par la puce, 8 connexions (sockets) à la fois, 32 Ko de mémoire d’émission et de réception')], [tl('Interface'), tl('SPI jusqu’à 33,3 MHz garantis, entrées tolérantes au 5 V')], [tl('Bibliothèque'), tl('Ethernet d’Arduino (EthernetClient, EthernetServer, EthernetUDP, DHCP et DNS)')]],
    how: tl('La puce porte toute la pile réseau : le programme écrit l’adresse MAC, l’adresse IP, le masque et la passerelle dans ses registres (ou laisse Ethernet.begin(mac) les demander au serveur DHCP de la box), puis ouvre des connexions. Pour chaque socket, il écrit les octets à envoyer dans la mémoire d’émission et donne l’ordre SEND ; ce qui arrive s’accumule dans la mémoire de réception jusqu’à ce que le programme le lise. Le module se relie par un câble RJ45 à un switch ou à la box, dans le plan réseau du projet.'),
    uses: [tl('Petit serveur web qui affiche des mesures'), tl('Capteur qui publie ses mesures sur un serveur MQTT'), tl('Lecture ou écriture des registres d’un automate en Modbus TCP')],
    mistakes: [tl('L’alimenter par la broche 3V3 d’un Uno : 50 mA au plus, le module en demande 130.'), tl('Deux modules avec la même adresse MAC sur le même réseau : ils se volent les trames.'), tl('Adresse IP fixe hors du réseau de la box (192.168.0.x au lieu de 192.168.1.x) : rien ne répond.'), tl('Oublier le câble dans le plan réseau : Ethernet.linkStatus() dit LinkOFF et le DHCP échoue.')]
  },
  enc28j60: {
    specs: [[tl('Alimentation'), tl('3,1 à 3,6 V, 160 mA (180 mA au plus) en émission')], [tl('Réseau'), tl('Ethernet 10BASE-T seulement, prise RJ45 à transformateurs intégrés')], [tl('Protocoles'), tl('aucun : la puce envoie et reçoit des trames, le programme porte la pile TCP/IP')], [tl('Interface'), tl('SPI jusqu’à 20 MHz ; CS, SCK, SI et RESET tolèrent le 5 V')], [tl('Bibliothèques'), tl('UIPEthernet (compatible avec Ethernet) ou EtherCard')]],
    how: tl('La puce n’est qu’une carte réseau : elle filtre les trames qui lui sont adressées et les range dans sa mémoire de 8 Ko. Tout le reste (ARP, IP, TCP, DHCP) est calculé par le programme de la carte, ce qui prend beaucoup de mémoire sur un Uno.'),
    uses: [tl('Petit serveur web à bas coût'), tl('Comprendre ce qu’une pile TCP/IP fait trame par trame')],
    mistakes: [tl('Alimentation par la broche 3V3 d’un Uno : 180 mA en émission, le module redémarre sans cesse.'), tl('Programme trop gros : UIPEthernet occupe près de la moitié de la mémoire d’un Uno.'), tl('Croire qu’il passe à 100 Mb/s : le lien reste à 10 Mb/s.')]
  },
  lvlshift: {
    specs: [[tl('Voies'), tl('4, bidirectionnelles')], [tl('Côté LV'), tl('1,8 à 3,6 V (le 3,3 V de la carte ou du module)')], [tl('Côté HV'), tl('jusqu’à 5,5 V (le 5 V)')], [tl('Composants'), tl('un MOSFET BSS138 et deux résistances de 10 kΩ par voie')], [tl('Débit'), tl('I2C 400 kHz, SPI quelques MHz, série')]],
    how: tl('Au repos, chaque côté est tiré à sa propre tension par 10 kΩ. Quand le côté 3,3 V passe à LOW, le MOSFET conduit et tire aussi le côté 5 V à LOW ; quand c’est le côté 5 V, la diode interne puis le MOSFET tirent le côté 3,3 V. Aucun côté ne reçoit jamais la tension de l’autre.'),
    pinout: [['LV', tl('3,3 V')], ['HV', tl('5 V')], ['GND', tl('Masse commune')], ['LV1…LV4', tl('Signaux côté 3,3 V')], ['HV1…HV4', tl('Signaux côté 5 V (même numéro = même signal)')]],
    uses: [tl('Écran LCD I2C (5 V) sur un ESP32 ou un Pico'), tl('BMP280 ou RC522 (3,3 V) sur un Arduino Uno'), tl('Toute liaison I2C, SPI ou série entre deux tensions')],
    mistakes: [tl('Inverser LV et HV : le côté 3,3 V reçoit du 5 V.'), tl('Oublier de relier LV ou HV : les voies ne sont plus tirées et rien ne passe.'), tl('S’en servir pour alimenter un module : il ne transporte que des signaux.')]
  },

  /* ---------- Circuits logiques ---------- */
  hc595: {
    specs: [[tl('Alimentation'), tl('2 à 6 V')], [tl('Sorties'), tl('8 (Q0 à Q7) à trois états, plus la sortie série Q7S')], [tl('Courant'), tl('6 mA en gardant un niveau net, 35 mA au plus par sortie, 70 mA au plus pour la puce')], [tl('Horloge'), tl('jusqu’à ≈ 25 MHz sous 4,5 V')], [tl('Boîtier'), 'DIP-16']],
    how: tl('Deux registres de 8 bits. À chaque front montant de SHCP, le registre à décalage avance d’un rang et le niveau de DS entre en Q0. Un front montant de STCP recopie ce registre dans le registre de sortie : les huit sorties changent ensemble, sans scintillement pendant l’envoi. OE à l’état haut met les sorties en haute impédance ; MR à l’état bas vide le registre à décalage.'),
    uses: [tl('Huit LED, un bargraphe ou un afficheur 7 segments avec trois broches'), tl('Plusieurs 74HC595 en cascade (Q7S vers DS) : 16, 24… sorties sur les mêmes trois broches'), tl('Commander des relais ou un ULN2803 quand la carte manque de broches'), tl('Régler l’éclat des huit LED d’un coup : OE sur une broche PWM, analogWrite(OE, 255 − éclat)')],
    mistakes: [tl('Oublier le front de STCP après shiftOut() : les sorties ne changent pas.'), tl('Laisser OE ou MR en l’air : sorties éteintes au hasard, bits effacés.'), tl('Huit LED à 220 Ω : chaque sortie va bien, mais la puce dépasse 70 mA au total.'), tl('Inverser MSBFIRST et LSBFIRST : le motif sort à l’envers.')]
  },
  hc165: {
    specs: [[tl('Alimentation'), tl('2 à 6 V')], [tl('Entrées'), tl('8 parallèles (D0 à D7) et une série (DS)')], [tl('Sorties'), tl('Q7 et son inverse Q7N, 25 mA au plus')], [tl('Courant'), tl('50 mA au plus pour la puce')], [tl('Boîtier'), 'DIP-16']],
    how: tl('Tant que PL est à l’état bas, le registre recopie les huit entrées. PL remonté, chaque front montant de l’horloge (CP, ou CE : elles sont interchangeables) fait avancer les bits d’un rang vers Q7, et DS entre au premier rang. Après le chargement, Q7 donne D7 ; après sept fronts, D0.'),
    uses: [tl('Huit boutons ou interrupteurs sur trois broches'), tl('Plusieurs 74HC165 en cascade (Q7 vers DS) pour 16, 24… entrées'), tl('Lire des interrupteurs DIP de configuration')],
    mistakes: [tl('Entrées laissées en l’air : sans résistance de tirage, elles lisent n’importe quoi.'), tl('Horloge basse au moment de shiftIn() : le premier front décale avant la lecture, D7 est perdu.'), tl('Oublier de remonter PL : le registre recharge sans cesse et ne décale jamais.')]
  },
  mcp23017: {
    specs: [[tl('Alimentation'), tl('1,8 à 5,5 V')], [tl('Entrées-sorties'), tl('16, en deux ports A et B')], [tl('Bus'), tl('I2C jusqu’à 1,7 MHz, adresse 0x20 à 0x27')], [tl('Courant'), tl('25 mA au plus par broche, 125 mA par VDD, 150 mA par VSS')], [tl('Tirage interne'), tl('100 kΩ par broche, au choix')]],
    how: tl('Une puce à registres : IODIR choisit le sens de chaque broche (1 = entrée, à la mise sous tension), GPPU active son tirage, OLAT garde les niveaux des sorties, GPIO lit les broches (et écrire GPIO écrit OLAT). La carte lit et écrit ces registres par le bus I2C ; le pointeur de registre avance tout seul à chaque octet.'),
    uses: [tl('16 LED ou relais de plus sur deux fils'), tl('Clavier de boutons, interrupteurs de fin de course'), tl('Jusqu’à 8 modules (128 broches) sur le même bus')],
    mistakes: [tl('Deux modules à la même adresse : ils répondent ensemble, les lectures sont fausses.'), tl('Une LED sans résistance : la broche dépasse 25 mA.'), tl('Lire une entrée sans tirage (INPUT au lieu d’INPUT_PULLUP) avec un bouton vers la masse : elle flotte.')]
  },
  pcf8574: {
    specs: [[tl('Alimentation'), tl('2,5 à 6 V')], [tl('Entrées-sorties'), tl('8 quasi bidirectionnelles')], [tl('Bus'), tl('I2C 100 kHz, adresse 0x20 à 0x27 (PCF8574A : 0x38 à 0x3F)')], [tl('Courant'), tl('25 mA absorbés par broche, ≈ 100 µA fournis, 80 mA absorbés en tout')]],
    how: tl('Pas de registre de sens : la carte écrit un octet, chaque 0 tire sa broche à la masse, chaque 1 la laisse sur une faible source de courant (≈ 100 µA). Lire l’octet donne le niveau réel des broches : une broche laissée à 1 qu’un bouton relie à la masse se lit 0.'),
    uses: [tl('Adaptateur I2C des écrans LCD 16×2'), tl('Huit boutons ou huit LED (actives à l’état bas) sur deux fils'), tl('Commander des modules relais actifs à l’état bas')],
    mistakes: [tl('Brancher une LED vers la masse : un 1 ne fournit que 100 µA, elle reste éteinte.'), tl('Écrire 0 sur une broche puis vouloir la lire comme entrée : elle reste à 0.'), tl('Confondre PCF8574 et PCF8574A : l’adresse n’est pas la même.')]
  },
  pca9685: {
    specs: [[tl('Alimentation'), tl('2,3 à 5,5 V (logique), servos sur V+')], [tl('Sorties'), tl('16 PWM de 12 bits (4096 pas), même fréquence pour toutes')], [tl('Fréquence'), tl('24 à 1526 Hz (horloge interne de 25 MHz)')], [tl('Courant'), tl('25 mA absorbés, 10 mA fournis par sortie, 400 mA pour la puce')], [tl('Bus'), tl('I2C, adresse 0x40 (0x40 à 0x7F par cavaliers)')]],
    how: tl('Un compteur de 12 bits tourne à la fréquence choisie (PRE_SCALE = 25 MHz ÷ (4096 × fréquence) − 1). Chaque voie a deux registres : le compte où la sortie passe à l’état haut (ON) et celui où elle retombe (OFF). Une fois réglée, la puce tient les impulsions seule : la carte n’a plus rien à faire.'),
    uses: [tl('Bras robotisé ou hexapode : 16 servos sur deux fils'), tl('Variation de 16 LED'), tl('Plusieurs modules en cascade pour plus de voies')],
    mistakes: [tl('Alimenter les servos par VCC ou par la carte : ils doivent prendre leur courant sur V+, d’une alimentation séparée.'), tl('Oublier setPWMFreq(50) : à 1000 Hz, les servos ne comprennent pas les impulsions.'), tl('Croire que setPWM() prend un angle : il prend des pas de 0 à 4095.')]
  },
  neo6m: {
    specs: [[tl('Récepteur'), tl('u-blox NEO-6M, GPS, 50 canaux')], [tl('Précision'), tl('environ 2,5 m en terrain dégagé')], [tl('Démarrage'), tl('à froid ≈ 27 s, à chaud ≈ 1 s (pile de sauvegarde sur le module)')], [tl('Sortie'), tl('trames NMEA, 9600 bauds, une salve par seconde')], [tl('Alimentation'), tl('3 à 5 V (régulateur 3,3 V), ≈ 45 mA')]],
    how: tl('Le récepteur écoute les satellites GPS ; chacun envoie l’heure exacte de son horloge atomique et sa position. En comparant les heures d’arrivée d’au moins quatre satellites, il calcule sa position, son altitude et l’heure. Chaque seconde, il envoie du texte : des trames NMEA comme $GPRMC (position, vitesse, date) et $GPGGA (position, altitude, nombre de satellites), terminées par une somme de contrôle.'),
    uses: [tl('Suivi d’un véhicule, d’un troupeau, d’un colis'), tl('Horloge à l’heure UTC exacte, sans Internet'), tl('Compteur de vitesse et de distance parcourue')],
    mistakes: [tl('Tester à l’intérieur : le module ne voit pas les satellites et ne donne jamais de position.'), tl('Attendre une position avant la fin du démarrage à froid : les champs restent vides et isValid() faux.'), tl('Un long delay() dans loop() : les trames débordent du tampon et la somme de contrôle échoue.'), tl('Croiser mal les fils : TX du module va sur la broche RX de la carte.')]
  },
  hc12: {
    specs: [[tl('Fréquence'), tl('433,4 à 473,0 MHz, 100 canaux utiles de 400 kHz')], [tl('Portée'), tl('jusqu’à 1 km en champ libre (20 dBm, 5 000 bit/s)')], [tl('Liaison'), tl('série transparente, 1200 à 115 200 bauds (9600 d’usine)')], [tl('Alimentation'), tl('3,2 à 5,5 V, 100 mA en émission')], [tl('Réglages'), tl('commandes AT, broche SET à LOW')]],
    how: tl('Ce que la carte écrit sur RXD part par la radio ; ce qui arrive par la radio sort sur TXD. Deux modules réglés sur le même canal se comportent comme un câble série invisible. Broche SET à LOW : le module écoute des commandes AT à 9600 bauds (canal, vitesse, puissance), qu’il garde en mémoire.'),
    uses: [tl('Station météo qui envoie ses mesures à la maison'), tl('Télécommande de robot ou de portail à longue portée'), tl('Relever un compteur ou une cuve loin de la carte')],
    mistakes: [tl('Deux modules sur des canaux différents ou à des vitesses de groupes différents : rien ne passe.'), tl('SET laissé à LOW : le module répond aux commandes AT au lieu de transmettre.'), tl('Alimentation par la broche 3,3 V d’un Uno (50 mA) : le module redémarre à chaque émission.')]
  },
  max485: {
    specs: [[tl('Bus'), tl('RS-485, paire différentielle A/B, jusqu’à 1200 m')], [tl('Appareils'), tl('32 sur le même bus')], [tl('Débit'), tl('jusqu’à 2,5 Mbit/s')], [tl('Sens'), tl('semi-duplex : DE à HIGH pour émettre, /RE à LOW pour recevoir')], [tl('Alimentation'), tl('5 V')]],
    how: tl('Le module traduit la liaison série de la carte en deux signaux opposés sur A et B : le récepteur ne regarde que leur différence, ce qui efface les parasites captés le long d’un câble. Tous les modules partagent la même paire, mais un seul doit émettre à la fois : chacun passe DE à HIGH le temps d’envoyer, puis revient en écoute.'),
    uses: [tl('Capteurs répartis dans un bâtiment, une serre, une usine'), tl('Modbus RTU avec des automates et des variateurs'), tl('Relier deux cartes à plusieurs centaines de mètres')],
    mistakes: [tl('DE laissé à HIGH après l’envoi : le module bloque le bus, personne d’autre ne peut répondre.'), tl('Repasser DE à LOW avant la fin de l’envoi : sans Serial.flush(), les derniers octets sont coupés.'), tl('A et B croisés entre deux modules : tous les bits arrivent inversés.'), tl('Pas de masse commune entre deux cartes éloignées : le bus devient instable.')]
  },
  sim800: {
    specs: [[tl('Alimentation'), tl('3,4 à 4,4 V, pointes de 2 A')], [tl('Réseau'), tl('GSM 850/900/1800/1900 MHz, 2G et GPRS')], [tl('Commande'), tl('commandes AT sur liaison série')], [tl('Carte SIM'), 'micro-SIM'], [tl('Voyant NET'), tl('un éclair par seconde : recherche du réseau ; toutes les 3 s : connecté')]],
    how: tl('Un téléphone 2G sans écran : on lui envoie des commandes AT par la liaison série pour envoyer un SMS, appeler ou se connecter en GPRS.'),
    uses: [tl('Alerte par SMS (alarme, niveau d’eau)'), tl('Commande à distance par SMS')],
    mistakes: [tl('Alimentation trop faible : le voyant clignote, puis le module redémarre en boucle.'), tl('Réseau 2G arrêté dans votre pays : le module ne se connecte jamais.'), tl('Code PIN actif sur la carte SIM.')]
  },
  max7219m: {
    specs: [[tl('Matrice'), tl('64 LED rouges, 8 lignes × 8 colonnes')], [tl('Pilote'), tl('MAX7219, balayage des 8 lignes à 800 Hz')], [tl('Alimentation'), tl('4 à 5,5 V, jusqu’à 330 mA par module')], [tl('Interface'), tl('3 fils (DIN, CLK, CS), mots de 16 bits, jusqu’à 10 MHz')], [tl('Luminosité'), tl('16 niveaux (rapport cyclique 1/32 à 31/32)')], [tl('Chaînage'), tl('DOUT vers DIN du module suivant')]],
    how: tl('La carte envoie un mot de 16 bits : 4 bits d’adresse (une ligne, ou un réglage : luminosité, limite de balayage, arrêt, test) et 8 bits de donnée (les 8 LED de la ligne). Au front montant de CS, la puce le range dans son registre et allume les LED seule, sans que la carte s’en occupe. En chaîne, chaque mot traverse le registre de 16 bits de chaque module : les premiers envoyés finissent dans le plus éloigné.'),
    uses: [tl('Texte défilant, icônes, jeux simples'), tl('Grands afficheurs de 4 modules ou plus (32 × 8)'), tl('Vu-mètre, oscilloscope de poche')],
    mistakes: [tl('Rien ne s’allume : la puce démarre en mode arrêt (shutdown) ; LedControl demande lc.shutdown(0, false).'), tl('Image tournée ou en miroir avec MD_MAX72XX : le type de module (FC16_HW, GENERIC_HW…) ne correspond pas au câblage de la matrice.'), tl('Plusieurs modules sur le 5 V de l’USB à pleine luminosité : la carte redémarre ; alimentez-les à part.')]
  },
  max7219s: {
    specs: [[tl('Afficheur'), tl('8 chiffres de 7 segments et point, rouges')], [tl('Pilote'), 'MAX7219'], [tl('Alimentation'), tl('4 à 5,5 V')], [tl('Interface'), tl('3 fils (DIN, CLK, CS)')], [tl('Décodage'), tl('code B (0 à 9, -, E, H, L, P) ou segments libres')]],
    how: tl('Un registre par chiffre : en mode décodé, la puce dessine elle-même le chiffre écrit (code B) ; sinon chaque bit allume un segment (D7 le point, D6 à D0 les segments A à G). Le chiffre 0 de la puce est celui de droite.'),
    uses: [tl('Compteur, chronomètre, fréquencemètre'), tl('Affichage de mesures à 8 chiffres')],
    mistakes: [tl('Seul le chiffre de droite s’allume : la limite de balayage vaut 0 au démarrage ; setScanLimit(0, 7).'), tl('Des 0 partout en mode décodé : un chiffre à 0 affiche « 0 » ; écrivez 0x0F (espace) pour l’éteindre.')]
  },
  tm1637: {
    specs: [[tl('Afficheur'), tl('4 chiffres de 7 segments et deux-points')], [tl('Pilote'), 'TM1637'], [tl('Alimentation'), tl('3,3 à 5,5 V')], [tl('Interface'), tl('2 fils (CLK, DIO), sans adresse')], [tl('Luminosité'), tl('8 niveaux')]],
    how: tl('La carte envoie des trames : un départ, des octets (bit de poids faible d’abord, chacun acquitté par la puce), un arrêt. Une commande de données, puis l’adresse du premier chiffre suivie des segments, puis la commande d’affichage (allumé et luminosité). La puce garde l’image et balaie les chiffres seule.'),
    uses: [tl('Horloge (avec un DS3231)'), tl('Minuteur, compte à rebours'), tl('Affichage d’une température')],
    mistakes: [tl('Afficheur éteint : setBrightness() n’a pas été appelé avant le premier affichage.'), tl('Module alimenté en 5 V sur une carte 3,3 V : les résistances de tirage remontent CLK et DIO à 5 V.'), tl('Deux-points absent : c’est le bit 7 du deuxième chiffre (showNumberDecEx(…, 0b01000000)).')]
  },
  lcd2004: {
    specs: [[tl('Écran'), tl('20 caractères × 4 lignes, rétroéclairé')], [tl('Contrôleurs'), tl('HD44780 et adaptateur I2C PCF8574')], [tl('Adresse'), tl('0x27 (PCF8574T) ou 0x3F (PCF8574AT)')], [tl('Alimentation'), '5 V']],
    how: tl('Comme l’écran 16 × 2 : l’adaptateur I2C pilote le HD44780 en mode 4 bits. Les lignes 3 et 4 sont la suite des lignes 1 et 2 dans la mémoire de l’écran (adresses 0x14 et 0x54).'),
    uses: [tl('Tableau de bord de plusieurs mesures'), tl('Menus à plusieurs choix')],
    mistakes: [tl('Texte de la ligne 1 qui réapparaît sur la ligne 3 : il dépasse 20 caractères ; placez le curseur avec setCursor().'), tl('Écran déclaré 16 × 2 dans le code : seules 16 colonnes sont utilisées.')]
  },
  st7735: {
    specs: [[tl('Écran'), tl('TFT 1,8", 128 × 160 points, 65 536 couleurs (RGB565)')], [tl('Contrôleur'), 'ST7735S'], [tl('Interface'), tl('SPI (jusqu’à 15 MHz en écriture), broche DC commande / donnée')], [tl('Alimentation'), tl('3,3 à 5 V (régulateur sur le module), logique 3,3 V')]],
    how: tl('La carte choisit une fenêtre (commandes CASET et RASET), puis envoie la couleur de chaque point sur 16 bits (RAMWR) ; la mémoire de l’écran garde l’image. MADCTL règle le sens de remplissage : c’est ce que change setRotation().'),
    uses: [tl('Petites interfaces en couleur, menus, icônes'), tl('Graphiques de mesures'), tl('Jeux')],
    mistakes: [tl('Écran blanc : mauvaise initialisation (initR(INITR_BLACKTAB) pour la plupart des modules rouges) ou CS/DC inversés.'), tl('Couleurs inversées (rouge et bleu) : variante d’écran différente, essayez un autre INITR_….'), tl('Entrées 3,3 V attaquées en 5 V sans adaptateur : l’écran vieillit mal.')]
  },
  ili9341: {
    specs: [[tl('Écran'), tl('TFT 2,4" ou 2,8", 240 × 320 points, 65 536 couleurs')], [tl('Contrôleur'), 'ILI9341'], [tl('Interface'), tl('SPI, broche DC commande / donnée, MISO pour relire')], [tl('Alimentation'), tl('3,3 à 5 V (régulateur sur le module), logique 3,3 V')]],
    how: tl('Même principe que le ST7735 : fenêtre (CASET, PASET), puis couleurs de 16 bits (RAMWR), sens réglé par MADCTL. 76 800 points : remplir tout l’écran prend du temps sur un Uno (≈ 150 000 octets).'),
    uses: [tl('Tableau de bord en couleur'), tl('Courbes, jauges, petites interfaces graphiques')],
    mistakes: [tl('Rafraîchir tout l’écran à chaque boucle : très lent ; ne redessinez que ce qui change.'), tl('Entrées 3,3 V attaquées en 5 V sans adaptateur.')]
  },
  ds3231: {
    specs: [[tl('Précision'), tl('±2 ppm de 0 à 40 °C (≈ 1 minute par an)')], [tl('Alimentation'), tl('2,3 à 5,5 V, pile CR2032 de secours')], [tl('Bus'), tl('I2C, adresse 0x68 (mémoire AT24C32 du module en 0x57)')], [tl('Extras'), tl('2 alarmes, thermomètre (pas de 0,25 °C), sortie 32 kHz')]],
    how: tl('Un compteur de secondes alimenté par un quartz dont la fréquence est corrigée selon la température. Les registres 0 à 6 donnent secondes, minutes, heures, jour, date, mois et année en BCD ; le programme les lit en un seul accès. La pile garde l’heure quand la carte est éteinte ; le bit OSF signale une coupure.'),
    uses: [tl('Horloge, réveil, programmateur'), tl('Horodatage de mesures (avec une carte SD)'), tl('Réveil d’une carte endormie par son alarme')],
    mistakes: [tl('Heure remise à la compilation à chaque démarrage : n’appelez adjust() que si lostPower() est vrai.'), tl('Pile CR2032 sur un module ZS-042 avec son circuit de charge : elle chauffe ; retirez la résistance de charge.'), tl('Deux modules à 0x68 (DS3231 et MPU6050) : changez l’adresse du MPU6050 (AD0).')]
  },
  ds1307: {
    specs: [[tl('Précision'), tl('quartz 32,768 kHz non compensé (quelques secondes par jour)')], [tl('Alimentation'), tl('4,5 à 5,5 V, pile de secours')], [tl('Bus'), tl('I2C 100 kHz, adresse 0x68')], [tl('Mémoire'), tl('56 octets de RAM sauvegardée par la pile')]],
    how: tl('Mêmes registres BCD que le DS3231 (secondes à année). Le bit 7 des secondes (CH) arrête l’oscillateur. La RAM de 0x08 à 0x3F garde 56 octets tant que la pile tient.'),
    uses: [tl('Horloge simple sur une carte 5 V'), tl('Compteur de jours, journal horodaté')],
    mistakes: [tl('Module branché en 3,3 V : le DS1307 ne répond plus (il lui faut 4,5 V au moins).'), tl('isrunning() faux : l’oscillateur n’a jamais été lancé ; rtc.adjust() le démarre.')]
  },
  at24c256: {
    specs: [[tl('Capacité'), tl('32 Ko (32 768 octets)')], [tl('Alimentation'), tl('1,7 à 5,5 V')], [tl('Bus'), tl('I2C jusqu’à 1 MHz, adresse 0x50 à 0x57')], [tl('Écriture'), tl('pages de 64 octets, 5 ms par cycle')], [tl('Endurance'), tl('1 million d’écritures, 100 ans de rétention')]],
    how: tl('Deux octets d’adresse, puis des données. Une écriture remplit un tampon de page de 64 octets, gravé à l’arrêt de la trame pendant 5 ms ; pendant ce temps la puce n’acquitte plus son adresse (on l’interroge jusqu’à ce qu’elle réponde). La lecture avance seule d’octet en octet sur toute la mémoire.'),
    uses: [tl('Journal de mesures sans carte SD'), tl('Réglages et compteurs qui survivent aux coupures'), tl('Tables de données trop grandes pour l’EEPROM de la carte')],
    mistakes: [tl('Écrire plus de 64 octets d’un coup ou à cheval sur deux pages : les octets en trop reviennent au début de la page et écrasent les premiers.'), tl('Relire juste après une écriture sans attendre les 5 ms : la puce ne répond pas.'), tl('Écrire en boucle au même endroit : un million d’écritures sont vite atteintes.')]
  },
  sdcard: {
    specs: [[tl('Carte'), tl('microSD (SDHC), système de fichiers FAT16 ou FAT32')], [tl('Interface'), tl('SPI (MOSI, MISO, SCK, CS)')], [tl('Alimentation'), tl('5 V (régulateur 3,3 V et adaptateur de niveau sur le module)')], [tl('Courant'), tl('jusqu’à 100 mA en écriture')]],
    how: tl('En mode SPI, la carte reçoit des commandes de 6 octets (CMD0 pour la réveiller, CMD8 et ACMD41 pour l’initialiser, CMD17 et CMD24 pour lire et écrire un bloc de 512 octets). La bibliothèque SD range les fichiers dans les blocs selon le système FAT.'),
    uses: [tl('Enregistreur de données (température, horodatage)'), tl('Lecture de fichiers de configuration'), tl('Sons et images pour d’autres modules')],
    mistakes: [tl('Fichier vide : close() ou flush() oublié, les données restent dans le tampon de 512 octets.'), tl('Nom trop long : la bibliothèque SD n’accepte que 8 caractères, un point et 3 caractères.'), tl('Sur l’Uno, D10 laissée en entrée alors que CS est ailleurs : le SPI passe en esclave et rien ne marche.')]
  },
  // Composants analogiques et instruments (analog-docs.js)
  ...ANALOG_DOCS
};

/* ---------- Rendu d'une page ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NEED_TEXT = { io: tl('GPIO numérique (entrée/sortie)'), in: tl('GPIO en entrée'), out: tl('GPIO en sortie'), pullup: tl('GPIO en entrée, INPUT_PULLUP'), pwm: tl('GPIO avec PWM'), adc: tl('entrée analogique (ADC)'), sda: tl('SDA du bus I2C'), scl: tl('SCL du bus I2C'), sck: tl('SCK du bus SPI'), mosi: tl('MOSI du bus SPI'), miso: tl('MISO du bus SPI'), ss: tl('GPIO en sortie (sélection SPI)'), rx: tl('TX de la carte (croisé)'), tx: tl('RX de la carte (croisé)') };
const RES_NAME = { 'res-220': '220 Ω', 'res-1k': '1 kΩ', 'res-4k7': '4,7 kΩ', 'res-10k': '10 kΩ' };
function where(p) {
  switch (p.kind) {
    case 'pwr': { if (p.v === 'logic') return tl('Alimentation à la tension logique de la carte'); const [lo, hi] = vrange(p.v); return tl('Alimentation {0} à {1}', volts(lo), volts(hi)); }
    case 'ext': return tl('Alimentation par batterie');
    case 'gnd': return p.via ? tl('Masse, via {0}', RES_NAME[p.via]) : p.role === tl('Adresse') ? tl('Masse (choix de l’adresse)') : tl('Masse (GND)');
    case 'vin': return tl('Entrée VIN de la carte');
    case 'drv': return tl('Alimentation commandée : pilote L298N, transistor ou relais');
    case 'nc': return p.to || tl('Laissée libre'); // sortie d'un module d'alimentation : ce qu'elle alimente
    case 'contact': return tl('Contact de puissance, isolé de la carte');
    default: return NEED_TEXT[p.need] + (p.via ? tl(', via {0}', RES_NAME[p.via]) : '') + (p.pull ? (p.pullTo ? tl(', tirage {0} vers {1}', RES_NAME[p.pull], p.pullTo) : tl(', tirage 4,7 kΩ vers VDD')) : '') + (p.opt || p.when ? tl(' (facultative)') : '');
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
