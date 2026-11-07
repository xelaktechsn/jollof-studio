<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Mamadou Sarr — kit de formation des enseignants de Jollof Studio -->

# Scripts des vidéos

Cinq vidéos courtes, une par projet du dossier [`projets/`](projets/). Chaque projet contient déjà sa
timeline : titre, câblage fil par fil, explication du programme, simulation, fin. Les horaires
ci-dessous sont ceux de cette timeline : la narration tombe juste si on la lit au rythme indiqué.

Les vidéos rendues par Jollof Studio n’ont **pas de son**. La narration s’enregistre à part (voir
« Ajouter la voix » plus bas), ou se dit en direct devant la classe pendant la projection.

## Rendre une vidéo avec l’onglet Vidéo

Les réglages sont les mêmes pour les cinq projets.

1. **Ouvrir le projet** : *Ouvrir* (<kbd>Ctrl</kbd>+<kbd>O</kbd>), puis le fichier `.jollof` du
   dossier `projets/`.
2. **Onglet Vidéo**, rubrique *Animation du câblage* :
   - *Séquence* affiche « Personnalisée (timeline) ». Ne la changez pas : « Fil par fil » ou
     « Tout en même temps » remplaceraient la timeline du kit par une timeline automatique.
   - *Afficher les légendes* : coché. Les légendes sont incrustées dans l’image.
   - *Rotation lente de la caméra* : décoché (les trois plans de caméra du projet s’en chargent).
3. **Vérifier** avant de rendre : bouton *Animer* (la vidéo se joue dans le plan de travail), ou
   *Timeline* pour voir les pistes Caméra, Fils et Légendes et glisser la tête de lecture.
4. **Lancer la simulation** (bouton *Simuler*). Pendant le rendu, la simulation avance avec la
   vidéo : chaque partie du montage s’anime une fois ses fils tracés (LED, écran LCD, buzzer).
   Sans simulation, la vidéo montre seulement le câblage. Pendant le câblage, des étiquettes
   signalent ce qui n’est pas encore relié (« non reliée à la masse ») : c’est normal, elles
   disparaissent quand les fils sont tracés.
5. **Export vidéo** :
   - *Résolution* : **1280 × 720** pour partager (messagerie, clé USB, site de l’établissement) ;
     **1920 × 1080** pour projeter en classe. Le 4K n’apporte rien sur un vidéoprojecteur scolaire.
   - *Images/s* : **30**.
6. **Rendre la vidéo**. Une barre de progression compte les images ; *Échap* annule. À la fin,
   la vidéo s’affiche : l’enregistrer (fichier MP4, H.264).

Durée et poids mesurés sur le projet 02 (80 s) : rendu en 2 à 3 minutes sur l’ordinateur de
test (un Mac récent), **28,3 Mo en 720p** (environ 21 Mo par minute) ; projet 05 (69 s) : 24,1 Mo. Le 1080p est à peu près deux fois
plus lourd. Un ordinateur lent met plus longtemps, mais la vidéo reste fluide : chaque image est
calculée à son instant exact.

Si le message « Encodage image par image indisponible » apparaît (fréquent sous Linux), la vidéo
est enregistrée en temps réel pendant la lecture : ne touchez pas à la fenêtre jusqu’à la fin.

### Modifier une timeline

- Une **légende** : double-clic dessus dans la piste Légendes, puis écrire. <kbd>L</kbd> en ajoute
  une à la tête de lecture. Pour une vidéo en anglais, réécrivez les légendes : elles ne sont pas
  traduites automatiquement.
- Un **plan de caméra** : placer la vue, puis dans *Plans de caméra*, bouton « Remplacer par la vue
  actuelle » du plan voulu. Le projet en a trois : vue d’ensemble (plan 1), vue rapprochée pendant
  le câblage (plan 2), gros plan sur le résultat pendant la simulation (plan 3).
- Un **fil** : glisser son extrait dans la piste Fils ; *Grouper* trace plusieurs fils ensemble.
- Chaque geste s’annule (<kbd>Ctrl</kbd>+<kbd>Z</kbd>). Enregistrer le projet garde la timeline.

### Ajouter la voix

- **Le plus simple** : enregistrer la narration au téléphone en regardant la vidéo, puis réunir les
  deux dans un logiciel de montage libre qui fonctionne hors ligne (Shotcut, OpenShot, Kdenlive).
- **En ligne de commande**, si `ffmpeg` est installé :
  `ffmpeg -i video.mp4 -i voix.m4a -c:v copy -c:a aac -shortest video-commentee.mp4`
- **Alléger** une vidéo pour la partager avec une connexion faible :
  `ffmpeg -i video.mp4 -c:v libx264 -crf 28 -preset slow video-legere.mp4`
  (sur le projet 02 en 720p : environ 28 Mo → 3,5 Mo, sans perte visible pour un montage).

---

## 1. LED et bouton poussoir

Fichier : `projets/01-led-bouton.jollof` · Arduino Uno · mode Débutant · **1 min 06 s**

Avant le rendu : pour voir la LED s’allumer dans la vidéo, onglet **Code** → *États par défaut* →
BTN1 → *Au départ : appuyé*. Le bouton reste alors appuyé pendant toute la simulation. Remettez
« relâché » après le rendu, avant de donner le projet aux élèves.

| Temps | Ce qu’on voit | Narration |
|---|---|---|
| 0:00 – 0:05 | Titre, vue d’ensemble | « LED et bouton poussoir, sur une Arduino Uno. » |
| 0:05 – 0:19 | Légende « La LED », puis fils 1 à 4 | « D’abord la LED. La masse de la carte va au rail moins de la breadboard. La cathode, la patte courte, rejoint ce rail. L’anode passe par une résistance de 220 ohms, qui limite le courant, jusqu’à la broche D7. » |
| 0:20 – 0:28 | Légende « Le bouton », puis fils 5 et 6 | « Le bouton : une patte à la masse, l’autre sur D2. Pas de résistance à ajouter : la carte a une résistance de tirage interne. » |
| 0:29 – 0:45 | Légendes sur le programme | « Dans le programme, D7 est une sortie, D2 une entrée en INPUT_PULLUP. Bouton relâché, D2 lit HIGH ; appuyé, il est relié à la masse et lit LOW. Si on lit LOW, la LED s’allume ; sinon, elle s’éteint. » |
| 0:45 – 1:02 | Gros plan, simulation | « En simulation, un clic sur le bouton l’enfonce, et la LED s’allume. Le vérificateur a essayé le bouton relâché et appuyé : aucune faute, le courant de la LED reste sous sa limite. À vous : faites-la clignoter tant que le bouton est appuyé. » |
| 1:02 – 1:06 | Fin | « Simuler d’abord, câbler ensuite. » |

## 2. Feu tricolore

Fichier : `projets/02-feu-tricolore.jollof` · Arduino Uno · mode Débutant · **1 min 20 s**

Avant le rendu : rien de particulier, lancer la simulation. Le programme commence dès le début de
la vidéo ; chaque feu s’allume quand ses fils sont tracés.

| Temps | Ce qu’on voit | Narration |
|---|---|---|
| 0:00 – 0:05 | Titre | « Un feu tricolore, avec trois LED et une Arduino Uno. » |
| 0:05 – 0:19 | Feu rouge, fils 1 à 4 | « Le feu rouge d’abord. Un fil relie la masse de la carte au rail moins. La cathode de la LED rouge va à ce rail ; son anode passe par une résistance de 220 ohms jusqu’à la broche D7. » |
| 0:20 – 0:31 | Feu orange, fils 5 à 7 | « Le feu orange : le même montage, sur la broche D8. Chaque LED a sa propre résistance : on ne la partage pas entre deux LED. » |
| 0:32 – 0:43 | Feu vert, fils 8 à 10 | « Puis le feu vert, sur la broche D2. Les trois cathodes partagent le rail de masse. C’est le câblage automatique qui a ajouté les trois résistances. » |
| 0:44 – 1:00 | Légendes sur le programme | « Le programme déclare trois sorties. La fonction feux allume les feux demandés et éteint les autres. Dans la boucle : vert pendant cinq secondes, orange deux secondes, rouge cinq secondes. delay compte en millisecondes, et loop recommence sans fin. » |
| 1:00 – 1:16 | Gros plan sur les feux, simulation | « En simulation, le cycle tourne en temps réel. Le moniteur série, dans l’onglet Code, écrit chaque changement de feu. Exercice : ajoutez un feu pour les piétons, avec une LED verte, une LED rouge et un bouton d’appel. » |
| 1:16 – 1:20 | Fin | « Simuler d’abord, câbler ensuite. » |

## 3. Thermomètre DHT22 et écran LCD

Fichier : `projets/03-thermometre-lcd.jollof` · Arduino Uno · mode Débutant · **1 min 14 s**

Avant le rendu : la température de départ est 24 °C (onglet Simulation). Pour une valeur plus
parlante, réglez-la avant de lancer la simulation, par exemple à 31 °C : le capteur simulé y monte
progressivement, comme un vrai.

| Temps | Ce qu’on voit | Narration |
|---|---|---|
| 0:00 – 0:05 | Titre | « Un thermomètre : capteur DHT22 et écran LCD, sur Arduino Uno. » |
| 0:05 – 0:22 | DHT22, fils 1 à 5 | « Le 5 volts et la masse de la carte vont aux rails de la breadboard. Le DHT22 y prend son alimentation et sa masse. Sa broche de données rejoint D7 : le capteur envoie température et humidité en une trame numérique. » |
| 0:22 – 0:37 | Écran LCD, fils 6 à 9 | « L’écran LCD a un adaptateur I2C : quatre fils seulement. Le 5 volts, la masse, puis SDA et SCL, les deux fils du bus I2C, sur les broches SDA et SCL de la carte. » |
| 0:37 – 0:54 | Légendes sur le programme | « Le programme utilise deux bibliothèques : DHT pour le capteur, LiquidCrystal I2C pour l’écran, à l’adresse 0x27. Toutes les deux secondes, il lit la température et l’humidité et les affiche : la température sur la première ligne, l’humidité sur la seconde. » |
| 0:54 – 1:10 | Gros plan sur l’écran, simulation | « En simulation, l’écran affiche la mesure. Dans l’onglet Simulation, un curseur change la température : la valeur suit avec un peu de retard, comme un vrai capteur. Exercice : allumez une LED rouge au-dessus de 30 degrés. » |
| 1:10 – 1:14 | Fin | « Simuler d’abord, câbler ensuite. » |

## 4. Radar de recul

Fichier : `projets/04-radar-de-recul.jollof` · Arduino Nano · mode Débutant · **1 min 20 s**

Avant le rendu : distance de départ 35 cm (le buzzer bipe environ deux fois par seconde). Le son
n’est pas dans la vidéo ; l’étiquette « ♪ sonne » au-dessus du buzzer montre les bips.

| Temps | Ce qu’on voit | Narration |
|---|---|---|
| 0:00 – 0:05 | Titre | « Un radar de recul, avec un capteur à ultrasons, sur Arduino Nano. » |
| 0:05 – 0:25 | HC-SR04, fils 1 à 6 | « Le HC-SR04 fonctionne en 5 volts : son alimentation et sa masse passent par les rails de la breadboard. TRIG, la broche de déclenchement, va sur D7 ; ECHO, la broche de l’écho, sur D8. Carte et capteur sont en 5 volts : pas d’adaptation de niveau. » |
| 0:25 – 0:42 | Buzzer et transistor, fils 7 à 11 | « Le buzzer tire environ 25 milliampères, plus que les 20 conseillés pour une broche. Le câblage automatique l’a donc placé derrière un transistor BC547 : le buzzer entre le 5 volts et le collecteur, l’émetteur à la masse, et la broche D4 commande la base par une résistance de 1 kilo-ohm. » |
| 0:43 – 0:59 | Légendes sur le programme | « Le programme envoie une impulsion de dix microsecondes sur TRIG. pulseIn mesure la durée de l’écho ; divisée par 58, elle donne la distance en centimètres. Plus l’obstacle est proche, plus la pause entre deux bips est courte. » |
| 0:59 – 1:16 | Gros plan, simulation | « En simulation, le curseur de l’onglet Simulation règle la distance. Sous dix centimètres, le buzzer sonne sans arrêt ; au-delà d’un mètre, il se tait. Question pour la classe : pourquoi ne pas brancher le buzzer directement sur la broche ? » |
| 1:16 – 1:20 | Fin | « Simuler d’abord, câbler ensuite. » |

## 5. MicroPython sur Pico : variateur de LED

Fichier : `projets/05-pico-micropython-variateur.jollof` · Raspberry Pi Pico · **MicroPython** ·
**1 min 09 s**

Avant le rendu : le curseur du potentiomètre est à 50 % (LED à 25 %, à cause de la courbe du
programme). Pour une LED plus lumineuse dans la vidéo : onglet **Code** → *États par défaut* →
POT1 → *Curseur au départ* : 80 %. MicroPython met quelques secondes à démarrer au début de la
simulation : lancez-la quelques secondes avant *Rendre la vidéo*.

| Temps | Ce qu’on voit | Narration |
|---|---|---|
| 0:00 – 0:05 | Titre | « MicroPython sur Raspberry Pi Pico : un variateur de lumière. » |
| 0:05 – 0:16 | LED, fils 1 à 3 | « La LED : sa cathode à la masse, son anode par une résistance de 220 ohms jusqu’à la broche GP2. » |
| 0:17 – 0:31 | Potentiomètre, fils 4 à 7 | « Le potentiomètre : une extrémité au 3,3 volts, l’autre à la masse. Le curseur rejoint GP28, une entrée analogique, à travers une résistance de 1 kilo-ohm. Sur un Pico, jamais de 5 volts sur une entrée. » |
| 0:32 – 0:48 | Légendes sur le programme | « Le programme est un fichier main.py. ADC lit le potentiomètre, de 0 à 65 535. PWM envoie à la LED mille impulsions par seconde : leur largeur règle la luminosité. C’est le vrai MicroPython qui tourne sur le Pico émulé, et print écrit dans le moniteur série. » |
| 0:48 – 1:05 | Gros plan, simulation | « En simulation, on tourne le potentiomètre avec son curseur : la LED suit. Pourquoi la résistance de 1 kilo-ohm ? Si un programme passait GP28 en sortie par erreur, elle limiterait le courant ; sans elle, le vérificateur signale une erreur. Exercice : faites clignoter la LED, plus vite quand on tourne. » |
| 1:05 – 1:09 | Fin | « Simuler d’abord, câbler ensuite. » |
