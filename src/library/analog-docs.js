// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fiches de documentation des composants analogiques et des instruments (docs.js les ajoute aux siennes) :
// caractéristiques tirées des fiches techniques citées dans check/sources.js, fonctionnement, usages, erreurs.
import { tl } from '../i18n/index.js';

export const ANALOG_DOCS = {
  ne555: {
    specs: [[tl('Alimentation'), tl('4,5 à 16 V (18 V au maximum absolu)')], [tl('Consommation'), tl('≈ 3 mA sous 5 V (sortie basse, sans charge)')], [tl('Seuils'), tl('déclenchement à 1/3 de VCC, seuil à 2/3 de VCC')], [tl('Sortie'), tl('±200 mA ; haute ≈ VCC − 1,4 V, basse ≈ 0,1 V')], [tl('Boîtier'), tl('DIP-8, broche 1 à gauche de l’encoche')]],
    how: tl('Deux comparateurs surveillent la tension d’un condensateur : sous 1/3 de VCC (broche TRIG), une bascule met la sortie à l’état haut ; au-dessus de 2/3 de VCC (broche THR), elle la remet à l’état bas et ferme le transistor de décharge (DIS), qui vide le condensateur. En astable, le condensateur se charge par RA + RB et se décharge par RB : la sortie oscille seule. En monostable, une impulsion sur TRIG lance une durée fixe de 1,1 × R × C.'),
    uses: [tl('Faire clignoter une LED sans programme'), tl('Générer un signal carré (buzzer passif, horloge)'), tl('Temporisation : minuterie d’escalier, anti-rebond')],
    mistakes: [tl('Laisser RESET (broche 4) en l’air : la minuterie peut s’arrêter au hasard. Reliez-la à VCC.'), tl('Inverser RA et RB, ou oublier que le temps haut dépasse toujours le temps bas en astable simple.'), tl('Alimenter une charge de plus de 200 mA directement sur la sortie : passez par un transistor.')],
    code: tl('// Le NE555 oscille tout seul : la carte peut lire sa sortie.\nvoid setup() {\n  pinMode(2, INPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println(digitalRead(2));\n  delay(50);\n}')
  },
  lm358: {
    specs: [[tl('Alimentation'), tl('3 à 30 V en simple alimentation (32 V au maximum absolu)')], [tl('Sortie'), tl('de 5 mV à VCC − 1,5 V')], [tl('Entrées'), tl('de la masse à VCC − 1,5 V (plage de mode commun)')], [tl('Gain en boucle ouverte'), tl('100 000 (100 V/mV)')], [tl('Produit gain-bande'), '0,7 MHz'], [tl('Vitesse de balayage'), '0,3 V/µs'], [tl('Consommation'), tl('≈ 0,35 mA par ampli')]],
    how: tl('Un ampli-op amplifie énormément la différence entre ses entrées + et −. Avec une contre-réaction (une résistance de la sortie vers l’entrée −), il ajuste sa sortie pour que les deux entrées restent au même potentiel : le gain ne dépend plus que des résistances. Non inverseur : G = 1 + R2 / R1. Inverseur : G = −R2 / R1, autour d’une tension de référence. La sortie ne peut pas dépasser ses rails : elle sature à VCC − 1,5 V et près de 0 V.'),
    uses: [tl('Amplifier le signal d’un capteur avant l’ADC de la carte'), tl('Tampon (suiveur) qui ne charge pas un pont diviseur'), tl('Filtre actif, comparateur de tension')],
    mistakes: [tl('Attendre une sortie à 5 V sous 5 V d’alimentation : elle plafonne à 3,5 V.'), tl('Faire descendre le signal sous la masse en alimentation simple : décalez-le d’abord (pont diviseur, générateur).'), tl('Laisser l’ampli B en l’air : reliez ses entrées (suiveur à la masse) pour qu’il ne s’agite pas.')],
    code: tl('void setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  int brut = analogRead(A0);          // sortie de l’ampli\n  Serial.println(brut * 5.0 / 1023); // en volts\n  delay(100);\n}')
  },
  irlz44n: {
    specs: [[tl('Type'), tl('MOSFET canal N à commande logique')], [tl('Tension'), tl('55 V maximum entre drain et source')], [tl('Courant'), tl('47 A (boîtier à 25 °C), bien moins sans radiateur')], [tl('RDS(on)'), tl('25 mΩ à VGS = 5 V, 35 mΩ à 4 V')], [tl('Seuil VGS(th)'), tl('1 à 2 V')], [tl('Grille'), tl('±16 V au plus')], [tl('Brochage'), tl('G, D, S, face imprimée vers soi ; la languette est le drain')]],
    how: tl('La grille est isolée : elle ne consomme du courant que pour se charger. Au-dessus de son seuil, un canal se forme entre drain et source, d’autant moins résistant que VGS est grand. En commutation, il ne perd que RDS(on) × I² : avec 1 A et une grille à 5 V, 25 mW seulement.'),
    pinout: [['G', tl('Grille : vers la broche de la carte, via ≈ 220 Ω')], ['D', tl('Drain : vers le − de la charge')], ['S', tl('Source : vers la masse')]],
    uses: [tl('Commander un moteur, une pompe ou une bande de LED en PWM'), tl('Électroaimant, serrure électrique, élément chauffant')],
    mistakes: [tl('Laisser la grille en l’air au démarrage : le MOSFET conduit au hasard. Gardez la résistance de 10 kΩ vers la masse.'), tl('Oublier la diode de roue libre aux bornes d’un moteur : la pointe de tension peut détruire le MOSFET.'), tl('Prendre un IRFZ44N (sans « L ») : il lui faut 10 V sur la grille, une carte ne le rend pas assez passant.')],
    code: tl('void setup() {\n  pinMode(9, OUTPUT);\n}\n\nvoid loop() {\n  analogWrite(9, 64);   // moteur à 25 %\n  delay(2000);\n  analogWrite(9, 255);  // pleine vitesse\n  delay(2000);\n}')
  },
  'ind-10m': {
    specs: [[tl('Inductance'), tl('10 mH ±10 % (code couleur marron, noir, orange en µH)')], [tl('Résistance du fil'), tl('24 Ω au plus')], [tl('Courant assigné'), tl('76 mA (35 °C d’échauffement)')], [tl('Saturation'), tl('110 mA (l’inductance chute de 10 %)')]],
    how: tl('Une bobine s’oppose aux variations du courant qui la traverse : U = L × di/dt. Mise sous tension à travers une résistance R, son courant monte vers U / R avec la constante de temps τ = L / R ; en continu, il ne reste que la résistance de son fil. Si l’on coupe brusquement le courant, elle produit une forte pointe de tension.'),
    pinout: [['1', tl('Patte, sans polarité')], ['2', tl('Patte, sans polarité')]],
    uses: [tl('Filtre (LC, RL), lissage d’une alimentation'), tl('Étudier le régime transitoire d’un circuit RL')],
    mistakes: [tl('Oublier la résistance de son fil dans le calcul de τ = L / R.'), tl('Couper le courant d’une bobine sans diode de roue libre : étincelle et transistor détruit.')]
  },
  siggen: {
    specs: [[tl('Formes'), tl('sinus, carré, triangle, continu')], [tl('Fréquence'), tl('jusqu’à 1 MHz (calcul en direct limité à quelques hertz, Lab analogique au-delà)')], [tl('Amplitude'), tl('valeur crête, 0 à 10 V')], [tl('Décalage'), tl('−10 à 10 V')], [tl('Sortie'), '50 Ω']],
    how: tl('Il fournit un signal périodique entre OUT et GND : décalage ± amplitude. Réglez-le dans l’onglet Simulation (section Générateurs). Comme un vrai générateur, sa sortie a 50 Ω de résistance interne : sous une charge faible, l’amplitude baisse.'),
    uses: [tl('Exciter un filtre RC et mesurer sa fréquence de coupure'), tl('Envoyer un signal à amplifier'), tl('Échelon (carré lent) pour étudier une charge RC ou RL')],
    mistakes: [tl('Oublier de relier GND à la masse du montage : le signal n’a pas de référence.'), tl('Envoyer plus que la tension logique sur une entrée de la carte (décalage + amplitude).')]
  },
  scope: {
    specs: [[tl('Voies'), tl('2 (CH1 jaune, CH2 cyan)')], [tl('Base de temps'), tl('de 10 µs à 1 s par division')], [tl('Sensibilité'), tl('de 10 mV à 5 V par division')], [tl('Déclenchement'), tl('front montant ou descendant, niveau réglable')], [tl('Entrées'), tl('idéales (aucun courant prélevé)')]],
    how: tl('Reliez CH1 et CH2 aux points à observer et GND à la masse, puis ouvrez le banc de mesure (onglet Oscilloscope 2 voies). Pendant la simulation, les courbes viennent du calcul en direct ; en mode Lab analogique, ngspice calcule une fenêtre de temps exacte, même pour des signaux de plusieurs kilohertz.'),
    uses: [tl('Voir la charge d’un condensateur, la sortie d’un NE555, un signal amplifié'), tl('Comparer l’entrée et la sortie d’un filtre')],
    mistakes: [tl('Choisir une base de temps trop lente : un signal rapide devient une bande floue.'), tl('Oublier la masse de l’oscilloscope : les tensions se lisent alors par rapport à la masse du montage.')]
  }
};
