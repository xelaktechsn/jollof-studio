# Jollof Studio

Application de bureau pour monter des circuits électroniques en 3D, connecter les broches, animer le câblage et exporter des vidéos pédagogiques. Construite avec Tauri 2 (cœur en Rust) et Three.js.

## Fonctions

- Bibliothèque de 58 composants courants (dont ventilateur 5 V, mini pompe à eau et moteur vibreur), classés par catégorie et filtrables par recherche : cartes (ESP32, ESP8266, Uno, Nano, Pico), breadboards, capteurs, entrées, écrans, sorties, moteurs, passifs, alimentation, communication.
- Plan de travail sans limite : le tapis, la lumière et les ombres suivent la vue, on se déplace où l’on veut (clic droit glissé, deux doigts sur le pavé tactile, Maj + molette ou flèches du clavier) et l’on peut reculer assez pour embrasser un très grand montage. Un composant ajouté par un clic se pose au centre de la vue.
- Zoom vers le curseur : la molette (ou le pincement sur le pavé tactile) zoome vers le point visé, qui reste immobile à l’écran.
- Repère X, Y, Z en haut à droite du plan de travail, comme en CAO : un cube d’orientation (DESSUS, AVANT, DROITE, GAUCHE, ARRIÈRE) tourne avec la caméra, avec ses axes X (rouge), Y (vert), Z (bleu) et une boussole (N, E, S, O). Un clic sur une face, une arête ou un coin oriente la vue ; glisser sur le cube fait tourner la caméra ; la maison revient à la vue 3D de tout le montage.
- Repères des composants (R1, LED1, ESP32…) au-dessus de chacun, à afficher ou masquer par un bouton en bas du plan de travail. La position du curseur sur le tapis s’affiche dans la barre d’état.
- Blocs : « Encadrer » (en haut du plan de travail ou dans l’onglet Câblage), puis tracer un rectangle sur le tapis, regroupe les composants qu’il contient sous un nom (« Alimentation », « Capteurs »…). Le cadre entoure ces composants et les fils qui les relient, et suit leurs déplacements ; saisir son étiquette déplace tout le bloc. Un clic sur l’étiquette sélectionne le bloc : huit poignées blanches permettent alors de l’agrandir ou de le réduire, et les composants que le cadre couvre au relâchement le rejoignent (ceux qu’il ne couvre plus le quittent) ; Échap désélectionne. Nom, couleur et composants se règlent dans l’onglet Câblage ou depuis le composant sélectionné. Les blocs apparaissent en cadres pointillés sur le schéma électrique.
- Fils rangés automatiquement : chaque fil monte de sa broche, file à angle droit au-dessus des composants et redescend. Les fils parallèles prennent des couloirs voisins (pas de 2,54 mm) plutôt que de se superposer ; deux fils qui se croisent passent à des hauteurs différentes, et un fil qui survole la broche d’un autre passe au-dessus de son fil. Calcul rapide (grille de voisinage) : seuls les fils dont le tracé change sont reconstruits ; pendant le déplacement d’un composant d’un grand montage, seuls ses fils sont recalculés ; au-delà de 250 fils, le rangement complet se fait dans un Web Worker. Le style « Souples » (arcs) reste disponible en bas du plan de travail.
- Les LED partagent quatre lampes de la scène, données aux plus brillantes : un montage de cent LED reste fluide.
- Câblage direct : glisser d'une broche à l'autre, aimantation sur la broche la plus proche, couleur automatique pour GND et l'alimentation.
- Un fil par broche, comme un vrai connecteur : une broche déjà reliée est signalée « occupée » et refuse un second fil. Pour relier plusieurs fils au même point, on passe par une breadboard.
- Rebranchement : cliquer sur un fil puis glisser une de ses extrémités vers une autre broche.
- Câblage automatique : sélectionner un composant puis « Câbler automatiquement », ou « Câbler automatiquement tout le circuit ». Le bon type de broche est choisi : alimentation à la bonne tension, ADC1 sur l’ESP32, bus I2C/SPI par défaut, port série croisé. Les broches de démarrage sont évitées (jamais un tirage au mauvais niveau sur D12 d’un ESP32 ou D3, D4, D8 d’un ESP8266), et les broches I2C restent libres pour les modules I2C. Les composants indispensables sont ajoutés, comme le ferait un électronicien d’après les fiches techniques : 220 Ω pour une LED (330 Ω pour un haut-parleur sur une carte qui débite peu), 4,7 kΩ de tirage pour la DS18B20 ; un **étage de puissance** pour ce qu’une broche ne peut pas alimenter (buzzer derrière un BC547 ; ventilateur, pompe et vibreur derrière un PN2222A avec résistance de base de 1 kΩ et diode de roue libre 1N4007, alimentés en 5 V, 22 Ω en série pour le vibreur 3 V) ; pilote L298N et pile pour un moteur réversible ; l’**adaptation de niveau** entre 5 V et 3,3 V (pont diviseur 4,7 kΩ / 10 kΩ pour un signal à sens unique comme l’ECHO du HC-SR04 ou le RX d’un HC-05, adaptateur de niveau BSS138 pour les bus I2C et SPI : écran LCD sur ESP32, BMP280 ou RC522 sur Uno) ; une diode anti-retour pour un accu sur le VSYS du Pico. Ce qui est physiquement impossible (deux entrées analogiques sur l’ESP8266, plus de broches que la carte n’en a de libres) est refusé avec une explication plutôt que câblé à moitié. Chaque composant câblé seul sur chaque carte, et des montages à plusieurs modules, passent le vérificateur sans erreur ni avertissement (`node --test src/sim/autowire.test.mjs`). Quand une breadboard est sur le plan de travail, l’alimentation et la masse passent par ses rails, et les bus partagés (I2C) ou les jonctions (résistance de tirage) par ses rangées de 5 trous. S’il en faut une et qu’il n’y en a pas, elle est ajoutée, et les fils directs déjà en place sont déplacés dessus. Les nouveaux fils sont animés, avec leur rôle en légende.
- Explication du câblage : pour le composant sélectionné, le rôle de chaque broche et où elle est reliée. Les erreurs sont signalées : broche non alimentée, masse non commune, signal 5 V sur une carte 3,3 V, broche sans ADC. Le code Arduino est donné avec les broches réellement utilisées.
- Simulation : des curseurs règlent l’environnement (température, humidité, lumière, distance, gaz, son, inclinaison…) selon les capteurs présents. Chaque capteur réagit comme le vrai : plage, résolution, inertie, cadence de lecture et valeur brute de l’ADC. Les mesures s’affichent au-dessus des capteurs et sur les écrans OLED/LCD reliés, et une impulsion parcourt le fil de données. Un capteur mal câblé ne mesure rien et dit pourquoi. Les courts-circuits sont signalés.
- Programmation des cartes (onglet « Code ») :
  - **Mode d’exécution** (Uno, Nano) : « Débutant », l’interpréteur intégré, instantané et pas à pas ; ou « Fidèle », où le **vrai programme** est compilé par arduino-cli puis tourne instruction par instruction sur un ATmega328P émulé (avr8js, MIT) : tout le C++ d’Arduino (classes, modèles, pointeurs, `sprintf`, registres, interruptions, EEPROM…) et toutes les bibliothèques. Les broches, la PWM, `tone()`, les impulsions de servo, le port série, l’ADC et l’EEPROM se raccordent au même montage : LED, moteurs, oscilloscope et moniteur série n’y voient pas de différence. Application installée seulement ; arduino-cli, les fichiers de la carte et les bibliothèques se téléchargent à la première utilisation puis restent en cache. Le vérificateur juge alors le programme de façon prudente (toute broche reliée peut être une sortie) quand il ne sait pas le lire. Corpus de programmes réels : `node --test src/emu/corpus.test.mjs`.
  - **Règles** : sélectionnez un composant puis « Programmer », ou « + Règle ». Une règle relie une mesure à une action : « quand BTN1 est appuyé, LED1 s’allume, sinon elle s’éteint », « quand la distance est sous 20 cm, le buzzer bipe », « le potentiomètre fait varier la vitesse du moteur ». Les règles s’imbriquent : chaque branche « Alors » ou « Sinon » contient plusieurs actions et d’autres conditions (« quand le sol est sec, arroser, sauf s’il fait plus de 35 °C ») ; une seule condition sous « Sinon » devient un `else if`. Chaque règle devient du vrai code Arduino, commenté, avec les broches réellement câblées.
  - **États par défaut** : un effecteur reçoit un état de départ (LED éteinte, servo à 90°, relais ouvert, texte sur l’écran…), appliqué dans `setup()` et, au choix, chaque fois qu’aucune règle ne le commande dans le tour de `loop()`. Un capteur ou une entrée reçoit une valeur de départ pour la simulation (bouton appuyé, curseur à 30 %, température à 35 °C…), reprise à chaque lancement. Ils se règlent dans l’onglet Code (« États par défaut ») ou sur le composant sélectionné.
  - **Code** : le code généré se modifie librement (il n’est alors plus réécrit ; « Régénérer » y revient), ou s’écrit entièrement à la main. Coloration, numéros de ligne, erreurs signalées pendant la frappe avec une suggestion (« vouliez-vous écrire digitalWrite ? »), Tab, Ctrl+/ pour commenter, Ctrl+Entrée pour téléverser.
  - **Exécution** : le programme est compilé dans l’application puis exécuté en temps virtuel pendant la simulation. `delay()` ne fige rien et une boucle sans fin non plus ; la ligne en cours est repérée dans l’éditeur. Les entiers suivent la carte (`int` sur 16 bits sur un Uno, 32 bits sur un ESP32), une division par zéro ou un indice hors du tableau arrête le programme et montre la ligne.
  - **Ce qui est simulé** : `pinMode`, `digitalRead/Write`, `analogRead/Write` (ADC et PWM de la carte), `millis`, `tone`, `pulseIn`, interruptions, `Serial` (moniteur série avec envoi), `String`, et les bibliothèques DHT, OneWire + DallasTemperature, Adafruit BMP280, MPU6050, SSD1306 (textes et formes), LiquidCrystal_I2C, Servo/ESP32Servo, NeoPixel, Stepper, et `ledc` sur ESP32.
  - **Effecteurs** : les LED (simples, RGB, barrette WS2812, 7 segments) s’allument selon le niveau ou la PWM, le servo tourne, le pas à pas tourne, le buzzer et le haut-parleur sonnent, les écrans affichent ce que le programme y écrit. Moteur, ventilateur, pompe et vibreur **suivent le calcul du circuit** : leur vitesse vient de la tension réellement reçue, quelle que soit la commande (pile seule, transistor, contacts du relais, pilote L298N et sa PWM) ; l’hélice, les pales, la turbine (avec son jet d’eau) et le vibreur bougent en 3D, avec inertie. Le relais a ses contacts **COM, NO, NC** : sa bobine colle quand le module est alimenté et IN tiré à la masse (broche à LOW ou fil), et COM–NO alimente vraiment la charge. Les effecteurs tirent leur courant (bobine, servo qui tourne, moteur) et le signal d’un servo se lit comme ses impulsions. Erreurs vues par le calcul : broche de carte surchargée (moteur branché directement), moteur sous trop de tension, ventilateur à l’envers, servo sous-alimenté. Les erreurs typiques sont expliquées : broche sans PWM, entrée qui flotte sans `INPUT_PULLUP`, `digitalWrite` sans `pinMode`, mauvaise adresse I2C, type de DHT différent du capteur câblé…
  - Pendant la simulation, un clic sur un bouton du montage l’enfonce.
- Schéma électrique 2D (bouton « Schéma ») : le montage redessiné sur une feuille A4 ou A3 paysage, avec cadre, repères de zones et cartouche. Symboles dans l’esprit de la norme CEI 60617 : résistance, condensateurs, diode, LED, LED RVB, bouton poussoir, potentiomètre, transistor NPN, pile, moteur, buzzer, haut-parleur ; cartes, modules et capteurs en blocs avec le nom de chaque broche (Uno : alimentation et analogiques à gauche, D0 à D13 à droite). Alimentations et masses par leurs symboles, liaisons simples en fils, les autres par étiquettes de nœud ; broche non reliée marquée d’une croix, court-circuit signalé. Une seconde feuille donne la nomenclature et la liste des connexions. « Enregistrer en PDF » écrit un PDF vectoriel (sans bibliothèque) ; « Imprimer » passe par l’impression du système.
- Pendant la simulation, le câblage est verrouillé : on ne tire, ne rebranche ni ne retire de fil (les corrections proposées par les erreurs restent possibles). Les composants se sélectionnent et se déplacent toujours.
- Erreurs de câblage pendant la simulation : une alerte apparaît et le bord du plan de travail clignote en rouge. Des ondes et une étiquette marquent la broche fautive et celle à l’autre bout, et les fils en cause rougeoient. Un court-circuit fait des étincelles, une surtension fait de la fumée. Un fil fantôme vert montre la bonne broche. Chaque erreur dit où elle est, pourquoi c’est un problème dans un vrai montage et comment corriger. Un bouton se branche dans les deux sens : vers la masse (entrée avec tirage, appuyé = LOW), vers l’alimentation avec une résistance de rappel vers la masse (appuyé = HIGH, le code généré suit), ou sans carte en interrupteur dans le circuit d’une pile ; une LED commandée par un interrupteur n’est pas en faute, et un bouton qui relierait seul le + à la masse est signalé. Corrections en un clic : « Relier à la masse » (bouton sur l’alimentation sans résistance de rappel : l’autre patte passe à GND, le code passe à `INPUT_PULLUP`), « Brancher sur 3V3 » (bouton sur 5 V avec une carte 3,3 V), « Retirer le fil » (bouton seul entre le + et le −). « Voir » amène la caméra dessus. « Recâbler », « Inverser les fils », « Relier les masses » ou « Retirer le fil » corrigent en un clic.
- Documentation : chaque carte, capteur et composant a sa fiche, avec caractéristiques, fonctionnement, brochage, utilisations, erreurs fréquentes et exemple de code. Un modèle 3D qu’on peut tourner aide à reconnaître le composant ; survoler une ligne du brochage allume la broche sur le modèle. On l’ouvre par le bouton « Documentation », le « ? » de la bibliothèque ou « Fiche » sur le composant sélectionné.
- Exemples : six montages prêts à simuler et un « Montage à corriger » plein d’erreurs volontaires. On les ouvre par le bouton « Exemples » ; les fichiers sont dans le dossier [`exemples/`](exemples/).
- Interface : barre d’outils à icônes, inspecteur à onglets (Câblage, Simulation, Vidéo), barre d’état, historique complet pour annuler et rétablir.
- Animation du câblage, en une fois ou fil par fil, avec légendes.
- Timeline de la vidéo (bouton « Timeline » de l’onglet Vidéo) : sous le plan de travail, une piste pour la caméra, une pour les fils, une pour les légendes (et, dans l’édition Pro, une pour les notes). On glisse la tête de lecture pour voir la vidéo à un instant précis ; on déplace ou rogne un extrait à la souris (aimantation sur les autres extraits, la tête de lecture et une grille de 0,1 s ; Alt pour la couper) ou au clavier (flèches, Maj pour 1 s, Alt pour rogner). « Grouper » trace plusieurs fils ensemble. « + Légende » (touche L) et, en Pro, « + Note » (touche N, puis un clic sur le montage) ajoutent un élément à la tête de lecture et ouvrent un panneau à droite de la timeline : on y écrit le texte (et, pour une note, son titre et son type), son début et sa durée, la scène montrant le résultat en direct ; Entrée ou un clic ailleurs valide, Échap annule. Double-clic sur une légende ou une note : le même panneau. Double-clic sur la piste Caméra : la vue actuelle devient un plan à cet instant (clic droit : remplacer, coupe nette, supprimer). Ctrl + molette zoome. Tant qu’on ne la modifie pas, la timeline est automatique (« Séquence » et « Durée par fil ») et redonne exactement l’animation d’avant ; modifiée, elle est enregistrée avec le projet et chaque geste s’annule. Le modèle est dans `src/video/timeline.js` (pur, testé : `node --test src/video/timeline.test.mjs`), la piste dans `src/video/dock.js`.
- Rendu réaliste : de vraies pièces CAO sont posées sur les modèles dessinés.
  - Pièces : module ESP32-WROOM-32 et ESP-12E, carte Raspberry Pi Pico, ATmega328P en DIP-28, connecteurs USB, jack, quartz, LED 5 mm, résistances, diodes, condensateurs, TO-92, buzzer, bouton, potentiomètre, pile 9 V.
  - Les broches restent celles du modèle dessiné, donc simulation et câblage sont inchangés.
  - L’interrupteur « Simple / Réaliste » sur le plan de travail passe d’un rendu à l’autre.
- Import de ses propres cartes : un fichier STEP (.step, .stp) ou glTF (.glb, .gltf) est converti dans l’application (millimètres, axe vertical, centrage). Un assistant en trois étapes dit ce que représente le modèle :
  - **apparence d’un composant de la bibliothèque** : on clique chaque broche demandée sur le modèle ; le composant garde tout son comportement (simulation, câblage automatique, erreurs) ;
  - **carte à microcontrôleur** : on choisit la famille (ESP32, ESP32-S3, ESP32-C3, ESP8266, RP2040, ATmega328P) et on nomme les broches comme sur la carte (GPIO4, D13, GP15, A0, 3V3, GND…). Tensions, ADC, bus I2C/SPI, broches de démarrage et broches de la flash en sont déduits ;
  - **module ou capteur** : chaque broche reçoit un rôle (alimentation, masse, données, analogique, I2C, SPI, série…), deviné d’après son nom ;
  - **objet décoratif**, sans broche.

  Le résultat s’ajoute à la bibliothèque personnelle.
- Export vidéo rendu image par image, en MP4 H.264 de 720p à 4K, 30 ou 60 images/s. Chaque image est calculée à son instant exact, avec une barre de progression et l’annulation possible. Si le système ne sait pas encoder, la vidéo est enregistrée en temps réel. L’enregistrement sur le disque passe par Rust.
- Plans de caméra : la caméra passe d’une vue enregistrée à la suivante pendant la vidéo et pendant « Animer ».
- Points de vue 3D, dessus, face, côté. Position (mm) et orientation (°) saisies au clavier pour le composant sélectionné.
- Vignettes 3D dans la bibliothèque.
- Vue « Nœuds » des connexions : broches reliées regroupées, avec un nom automatique (3,3 V, GND, D21 · I2C SDA…) qu’on peut renommer d’un double-clic.
- Projets au format `.jollof` (JSON lisible), programmes et règles compris, sauvegarde automatique de la session.

## Le vérificateur : « le Rust de l’électronique »

Comme le compilateur Rust refuse un programme dangereux, Jollof Studio ne laisse rien partir vers le monde réel tant que le montage ou son programme ont une erreur.

- **Prouvé dans tous les états atteignables.** Le vérificateur essaie chaque combinaison : boutons relâchés ou appuyés, relais au repos ou collés, potentiomètres aux butées et au milieu, sorties des capteurs à leurs extrêmes, et chaque broche que le programme commande, à LOW comme à HIGH (ce qui borne aussi la PWM). Dans chaque état, il calcule le circuit et compare chaque composant à ses valeurs nominales, lisibles par la machine (`src/check/limits.js`) : courant des LED, des broches et des sources, puissance des résistances, tension des modules et des condensateurs, transistor, diode, pilote, relais, moteurs. Le montage est d’abord découpé en sous-montages indépendants, coupés aux nœuds dont la tension ne dépend de rien (masses, 5V et 3V3 d’une carte) : chacun est essayé dans toutes ses combinaisons, les autres au repos, et les budgets partagés (toutes les GPIO, broches 5V et 3V3) additionnent la pire contribution de chacun. La preuve couvre ainsi le produit des états pour le prix de leur somme : 6 boutons et 6 LED commandées (4 096 états) en 13 calculs et 5 ms au lieu de 194 ms, 30 boutons (plus d’un milliard d’états) en 25 ms. Un sous-montage de plus de 4 096 états est échantillonné (coins, une variable à la fois, tirage) et le rapport le dit : « vérification partielle ». Le tout tourne dans un travailleur en arrière-plan ; une réécriture en Rust n’apporterait qu’un facteur constant sur un problème exponentiel et obligerait à garder deux solveurs identiques (simulation et vérification), ce qui fragiliserait la garantie.
- **Diagnostics à la manière de rustc**, avec un code stable : `erreur[J0301]: LED1 traversée par 75 mA (30 mA au plus)`, l’emplacement (cliquable), **l’état qui déclenche la faute** (« UNO D7 = HIGH », « BTN1 appuyé »), une note, une aide, la correction en un clic quand elle existe, et « Expliquer J0301 » (ce qui est vérifié, pourquoi, comment corriger). Familles : J01 alimentation et courts-circuits, J02 signaux (le « type » de chaque broche), J03 valeurs nominales, J04 polarité, J05 moteurs, J06 programme ↔ montage, J09 conseils, J1 code.
- **Programme ↔ montage** (le « vérificateur d’emprunts ») : deux sorties sur le même nœud, entrée lue en l’air dans un état (comme une variable non initialisée), `analogWrite` sans PWM, `analogRead` sans ADC, broche commandée mais reliée à rien, composant câblé jamais utilisé, `digitalWrite` sans `pinMode`, broche inexistante. Les broches sont lues dans le texte du programme (constantes, `#define`, `A0`, `LED_BUILTIN`, énumérations, bibliothèques) ; une broche calculée rend la vérification prudente (toute broche reliée peut être une sortie).
- **Code** : les erreurs du compilateur ont leur code (J1101 nom non déclaré, J1002 « ; » manquant…), leur aide sur une ligne à part et la partie fautive soulignée dans l’éditeur.
- **Pastille** à côté de « Simuler » (✓ Vérifié, ✕ N erreurs, ! avertissements), relancée après chaque changement, sans jamais figer l’interface ; **F7** ouvre le rapport.
- **Bloqué tant qu’une erreur reste** : téléversement sur une carte réelle (Pro), guide de montage (Pro), envoi d’une copie (espace classe ; l’envoi automatique à l’échéance passe toujours). La simulation, elle, tourne et montre les fautes : c’est en voyant fumer qu’on apprend. Le schéma imprimé porte le tampon « VÉRIFIÉ » ou « NON VÉRIFIÉ ».
- **`#[allow]`** : un avertissement voulu (un buzzer de 25 mA sur une broche) peut être accepté, avec sa raison, enregistrée dans le projet et affichée dans le rapport. Une erreur ne s’accepte jamais.
- **En ligne de commande**, comme `cargo check` : `node src/check/cli.mjs mon-projet.jollof` (ajoutez `--en` pour l’anglais) affiche le rapport et sort avec le code 1 s’il reste une erreur.
- **Fiches techniques respectées** : consommation de chaque module sur son alimentation (MQ-2 : 150 mA de chauffage, WS2812 : 400 mA, RC522 : 26 mA…), comptée dans le budget des broches 5V et 3V3 ; tension maximale d’une broche (VCC + 0,5 V sur un ATmega328P, 3,6 V sur ESP32, ESP8266 et RP2040) ; courant par broche propre à chaque carte ; transistor (courant, puissance dissipée), LM7805 sans radiateur (puissance), plage de VIN / VSYS ; adresses I2C en double ; broches de démarrage tirées au mauvais niveau ; sortie ECHO du HC-SR04 dans chaque état ; niveaux logiques à travers un pont diviseur (son rapport est calculé) ou un adaptateur de niveau (chaque côté à sa tension).
- La garantie vaut **dans le modèle de Jollof** : calcul en courant continu (PWM moyennée, impulsions bornées par l’état haut), valeurs nominales des composants, servo et moteurs au pire ; elle est rappelée au bas du rapport. Chaque fiche de composant liste ses « Limites vérifiées ».

## Éditions gratuite et Pro

Le même code donne deux applications. L’édition Pro ajoute des modules qui vivent dans un **dépôt privé à part**, `jollof-studio-pro`, cloné à côté de celui-ci (`../jollof-studio-pro`, ou le chemin donné par la variable `JOLLOF_PRO_DIR`). `src/main.js` les charge par `import('virtual:jollof-pro')`, que `vite.config.js` résout vers ce dépôt en mode « pro » et vers un module vide sinon ; le code Pro importe le code public par l’alias `@jollof/…`. La construction gratuite ne contient donc pas une ligne de code Pro, et le dépôt public se construit sans lui.

| Commande | Résultat |
|---|---|
| `npm run tauri dev` · `npm run tauri:build:free` | Édition gratuite (« Jollof Studio », `sn.jollof.studio`) |
| `npm run tauri:dev:pro` · `npm run tauri:build:pro` | Édition Pro (« Jollof Studio Pro », `sn.jollof.studio.pro`), installable à côté de la gratuite |
| `npm run dev` · `npm run dev:pro` | Interface seule dans un navigateur, gratuite ou Pro |

L’édition est fixée par `.env` (`VITE_EDITION=free`) et `.env.pro` (`VITE_EDITION=pro`) ; la configuration Tauri de l’édition Pro est `src-tauri/tauri.pro.conf.json`. Un projet garde les données des modules Pro (notes…) même ouvert et enregistré avec l’édition gratuite.

Modules de l’édition Pro :

- **Enseignement** : notes numérotées posées sur un composant (elles le suivent) ou sur le tapis, de type information, astuce ou attention ; présentation pas à pas en plein écran (flèches, espace, Échap), la caméra allant sur chaque note ; les notes apparaissent dans les vidéos exportées.
- **Évaluation** (onglet du panneau Enseigner) : l’enseignant monte la solution et l’enregistre comme référence (titre, consigne) ; « Retirer tous les fils » prépare le projet à donner aux élèves. « Vérifier le montage » compare le câblage de l’élève aux liaisons attendues (peu importe le trou de breadboard ou la broche GND utilisés), liste les liaisons manquantes, les raccords en trop et les erreurs de câblage, et donne une note.
- **Guide de montage** (fenêtre Schéma) : un PDF à imprimer avec le matériel (quantités, repères, cases à cocher), les précautions, les blocs, le câblage pas à pas (un fil par ligne : couleur, broches de départ et d’arrivée, rôle, bloc), puis le schéma.
- **Carte réelle** (onglet Code) : le programme est compilé et téléversé par USB sur une vraie carte (Uno, Nano, ESP32, NodeMCU, Pico) avec [arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/), à installer sur l’ordinateur. « Préparer » installe le support de la carte et les bibliothèques incluses par le programme (connexion Internet nécessaire la première fois). Application installée seulement.

Un module reçoit de l’application une interface (`moduleApi` dans `src/main.js`) : scène, caméra, composants, choix d’un point de la scène, crochet d’image, panneau à la place de l’inspecteur, bouton de barre d’outils, données enregistrées avec le projet. Un nouveau module s’ajoute dans le dépôt privé (`src/`) et s’installe dans son `src/index.js`.

## Laboratoire sans laboratoire

Jollof Studio sert d'abord de **salle de TP d'électronique quand il n'y a pas de matériel** : on câble, on programme, on simule et on mesure comme sur une paillasse.

- **Travaux pratiques guidés** (bouton « TP ») : une bibliothèque de TP par niveau (collège, lycée, formation professionnelle). Chaque TP part d'un montage posé (non câblé), guide étape par étape et **vérifie automatiquement** : câblage (liaisons attendues, une résistance peut se poser dans les deux sens, une carte a plusieurs GND), programme (il compile et contient ce qui est demandé), comportement observé pendant la simulation (« appuyez sur le bouton : la LED doit s'allumer »), mesures au multimètre comparées au calcul du circuit, questions. Progression gardée sur l'ordinateur, **compte-rendu en PDF** (élève, étapes validées, réponses, mesures, schéma). Hors ligne, sans compte. Édition Pro : « Envoyer ce TP à une classe » en fait un devoir corrigé automatiquement. Les TP sont des fichiers JSON (`src/lab/tp/`), vérifiés par `node src/lab/validate.mjs`.
- **« Quelle carte choisir ? »** (Documentation, ou lien en tête de la catégorie Cartes) : microcontrôleur ou ordinateur monocarte, tableau comparatif des cartes simulées (tension logique, tolérance 5 V, broches, entrées analogiques, Wi-Fi, usages, prix indicatifs en FCFA), la règle 5 V / 3,3 V, par où commencer, pour aller plus loin. Données techniques lues dans les profils des cartes (`src/library/boardguide.js`). TP associé : « Choisir la bonne carte : Uno ou ESP32 ? » (mesure 5 V contre 3,3 V au multimètre, choix de cartes pour des projets). Autres TP de lycée : « Charge et décharge d'un condensateur » (constante de temps lue sur le traceur série) et « Le transistor, un interrupteur commandé » (Ib, Ic, Vce au multimètre).
- **Banc de mesure** (bouton « Instruments ») : un **oscilloscope** à 4 voies (chaque front des sorties arrive avec son heure exacte, même à haute fréquence ; base de temps de 1 ms à 1 s par division ; fréquence, rapport cyclique, PWM et tension mesurés ; image figée) et un **multimètre** (tension entre deux points, courant dans un composant), calculés par un solveur de circuit en continu (`src/sim/dc.js` : résistances, LED, diodes, boutons, potentiomètres, piles, broches de la carte).
- **Courant animé** (bouton « Courant », en bas du plan de travail) : pendant la simulation, des points suivent le courant réel dans chaque fil (sens conventionnel, du + vers le −), plus vite quand il est fort, colorés selon la tension (gris 0 V, vert 3,3 V, jaune 5 V, rouge 9 V et plus). Au survol, un composant affiche sa tension et son courant (puissance pour une résistance ; Ic, Ib, Vce et état pour un transistor), un fil sa tension et son courant. Courants des fils : `src/sim/flow.js` ; dessin : `src/sim/flowfx.js` (un seul objet, 180 points au plus en mode léger).
- **Vue « Schéma » en direct** (en haut à gauche du plan de travail : « 3D | Schéma », touche S) : le même montage redessiné en schéma électrique (symboles CEI, mêmes repères que le schéma imprimé), où l'on voit le courant pendant la simulation. Fils colorés selon leur tension ; points qui avancent dans le sens conventionnel, à travers les composants (résistance, LED, transistor : courant de base et de collecteur), plus vite quand le courant est fort ; LED qui s'allument ; intensité écrite sous chaque composant et tension de chaque nœud (bouton « Valeurs »). Les symboles suivent l'état des composants : bouton appuyé = contact fermé (le courant le traverse), curseur du potentiomètre à sa vraie place (le courant le suit), relais collé = contact fermé, ondes sonores du buzzer ou du haut-parleur qui sonne, flèche du sens de rotation du moteur, palonnier du servo animé à son angle (et l'angle écrit), rotor du moteur, pales du ventilateur et turbine de la pompe qui tournent à la vitesse calculée, vibreur qui tremble, repère du pas à pas, contacts COM/NO/NC du relais ; les parties actives sont en orange (le schéma imprimé garde les symboles au repos). On y appuie sur les boutons (clic maintenu) et on tourne les potentiomètres (molette) ; survol = tension et courant ; **on y édite** le montage : clic sur un symbole = le sélectionner (panneau de gauche), le glisser = le déplacer (il suit en 3D, les autres restent en place), Suppr = le supprimer ; un composant de la bibliothèque se pose sur le schéma par un clic ou un glisser-déposer. **On y câble** : glisser d'une broche à une autre (bout, patte ou nom écrit dans le bloc ; ou cliquer l'une puis l'autre ; Échap annule ; relâcher sur un fil relie à son nœud) ajoute le vrai fil au montage, visible en 3D et annulable par Ctrl+Z. Une broche n'ayant qu'un fil, comme en vrai, une broche déjà câblée passe la main à un point libre du même nœud (autre GND de la carte, sinon le trou de breadboard libre le plus proche) ; s'il n'y en a pas, une rangée libre de breadboard devient le point de raccord (breadboard posée au besoin), l'ancien fil y est rebranché, le tout en une seule étape d'annulation ; relâcher sur le symbole de masse ou l'étiquette d'une alimentation relie à ce nœud. Clic droit ou Suppr sur une broche la débranche, sur un fil le retire ; erreurs de câblage entourées en rouge ; double-clic sur un composant = le retrouver en 3D. Les nœuds de plus de deux broches (bus I2C partagé, pont diviseur) y sont reliés par de vrais fils avec jonctions, tracés par un plus court chemin sur la grille de 2,54 mm (le schéma imprimé garde ses étiquettes de nœud). La scène 3D, cachée, n'est plus dessinée : la vue Schéma coûte moins que la 3D. `src/schematic/live.js` (vue), `src/schematic/flows.js` (courant de chaque fil du schéma, calculable sous Node), disposition partagée avec le schéma PDF (`layoutSchematic` dans `src/schematic/sheet.js`).
- **Condensateurs et transistor NPN** : le solveur avance dans le temps (modèle d'Euler implicite, pas de 2 ms au plus) ; charge et décharge RC, transistor bloqué / actif / saturé (β = 200). `analogRead` lit la tension calculée à travers les composants (pont diviseur, condensateur) ; une LED alimentée par une pile, le 5 V ou un transistor s'allume d'après son courant réel. Un condensateur chimique monté à l'envers est signalé (avec « Inverser »).
- **Débogueur** (onglet Code) : clic dans la marge = point d'arrêt ; Continuer/Pause (F8), pas à pas principal (F10), entrer (F11), sortir (Maj+F11), point d'arrêt à la ligne du curseur (F9). En pause : ligne surlignée, horloge virtuelle figée (les autres cartes continuent), variables locales et globales (les valeurs changées depuis la dernière pause sont signalées). Compilé en mode débogage seulement quand c'est utile : aucun coût sinon.
- **Traceur série** (onglet Code, « Moniteur | Traceur ») : les nombres écrits avec `Serial.print` / `println` (format du traceur de l'Arduino IDE : `a:1 b:2`, séparés par espaces, virgules ou tabulations) deviennent des courbes (8 au plus), fenêtre de 2 à 30 s, échelle automatique, curseur, « Figer », export CSV.
- **Blocs de code** (onglet Code, « Code | Blocs de code ») : programmation par blocs à assembler pour les plus jeunes (Blockly, chargé seulement quand on ouvre ce mode). Événements, broches, temps, conditions, boucles, maths, texte, variables, moniteur série, son, servo et **blocs du montage** (« LED1 s'allume », « température de DHT1 »…). Le code Arduino généré, lisible, s'affiche en lecture seule dessous ; le bloc en cours d'exécution est surligné ; « Convertir en code » passe au code modifiable (les blocs restent enregistrés).

## Performances (vieux ordinateurs)

- **Mode léger**, choisi automatiquement (rendu logiciel, anciennes puces graphiques intégrées, peu de mémoire ou de cœurs) ou à la main (bouton ⚡ en bas du plan de travail) : ni ombres ni anticrénelage, matières simples, pas de lampes de LED, fils allégés, 30 images/s au plus (20 pendant la simulation), pièces CAO chargées seulement si l'on passe au rendu réaliste. S'il constate un affichage lent en mode standard, le logiciel propose le mode léger.
- **Rendu à la demande** dans les deux modes : la scène n'est redessinée que si quelque chose bouge ; au repos, une image par seconde au plus ; rien quand la fenêtre est cachée ou que l'espace classe la recouvre.
- Démarrage allégé : vignettes de la bibliothèque livrées toutes faites (aucun rendu au premier lancement ; `scripts/thumbs.cjs` les régénère), dictionnaire anglais, lecteurs de modèles 3D, import CAO, encodeur vidéo et éditeur de texte enrichi chargés seulement s'ils servent, détection de la carte graphique faite une fois, pas de vérification synchrone des shaders dans la version distribuée.
- Scène allégée : les cibles invisibles des broches (des centaines par breadboard) ne sont plus parcourues à chaque image, les pièces fixes gardent leur matrice ; historique d'annulation borné en mémoire.
- Vue Schéma : la scène 3D n'est plus dessinée tant qu'elle est cachée ; le dessin fixe (SVG) n'est refait que si le montage change (vérifié par une signature, sans rien recalculer sinon) ; 1 200 points au plus (350 en mode léger), courants recalculés 10 fois par seconde (5 en mode léger). Mesuré (processeur ralenti 4 fois, rendu logiciel, mode léger, LED allumée) : 13,7 % de processeur en vue Schéma contre 16,9 % en 3D.
- Nouveautés sans coût au repos : courant animé limité à 600 points (180 en mode léger) et recalculé 10 fois par seconde (5 en mode léger) ; solveur dans le temps seulement si le montage a un condensateur ou un transistor (moins de 0,1 ms par calcul) ; code de débogage seulement quand un point d'arrêt est posé ; Blockly (≈ 160 Ko compressé) chargé seulement à l'ouverture des blocs.
- Mesuré sur un PC simulé très faible (processeur ralenti 4 fois, carte graphique **logicielle**) : processeur au repos **100 % → 3 à 6 %** ; le travail JavaScript par image est devenu négligeable, la fluidité restante dépend de la carte graphique (en rendu logiciel, la rotation de la vue passe d'environ 3 à 5–9 images/s en mode léger ; une vraie puce graphique, même ancienne, est bien plus rapide que ce rendu logiciel).

## Sécurité

- **Application de bureau** : politique de sécurité du contenu stricte (aucun script injecté ne s'exécute ; le simulateur a seulement le droit de compiler le programme Arduino de l'élève), navigation de la fenêtre bloquée hors de l'application (les liens s'ouvrent dans le navigateur du système), permissions Tauri réduites au minimum.
- **Fichiers** : les boîtes de dialogue sont affichées par Rust ; la webview ne peut lire ou écrire **que** les fichiers choisis par l'utilisateur dans ces boîtes (autorisations gardées pour « Enregistrer »). Même un contenu piégé ne peut pas toucher au reste du disque.
- **arduino-cli** : seules les commandes utiles (cartes, cœurs, bibliothèques, compilation, téléversement du croquis de l'application) passent, arguments vérifiés (tests Rust : `cargo test` dans `src-tauri`).
- **Projets reçus** (fichier, projet de groupe, copie d'élève) : libellés nettoyés à l'ouverture (noms, rôles, couleurs, identifiants), en plus de l'échappement à l'affichage.
- **Blocs de code** : images et sons de Blockly livrés avec l'application (`public/blockly/media`, régénérés par `npm run blockly:media`) : rien n'est chargé depuis Internet, la politique de sécurité ne change pas.
- **Serveur** : voir [server/README.md](server/README.md) (protection contre le forçage des mots de passe, journal d'audit, conteneurs durcis, déploiement en « boîte école » sur le réseau local).

## Espace classe (élèves, enseignants, serveur)

Bouton « Classe » de la barre d'application. Les données (écoles, classes, comptes, devoirs, copies, groupes, projets partagés, messages) sont sur un serveur NestJS + PostgreSQL, **source unique de vérité** : dossier [server/](server/), contrat d'API dans [server/API.md](server/API.md).

- **Élèves (édition gratuite)** : connexion avec l'identifiant donné par l'enseignant ; accueil (à faire, en retard, résultats récents), classes, devoirs, notes. Un devoir s'ouvre dans le plan de travail : consignes en texte enrichi, questions (choix multiple, réponse rédigée, montage), chronomètre si la durée est limitée, enregistrement automatique, envoi de la copie et résultats. Le projet personnel est mis de côté pendant la séance et revient à la fin (même si l'application se ferme entre-temps).
- **Messagerie en temps réel** : discussion de chaque classe (l'enseignant peut la réserver aux annonces), de chaque groupe, messages directs (enseignant ↔ élève ; entre élèves si la classe le permet) ; pièces jointes, modification pendant 15 minutes, suppression et modération, « écrit… », messages non lus.
- **Groupes de travail** : les élèves d'une classe créent leurs groupes ; chaque groupe a ses projets partagés. Une personne a la main à la fois (verrou renouvelé tant qu'elle travaille ; « Prendre la main » possible), chaque enregistrement est une version (auteur, message, date), l'historique permet d'ouvrir ou de restaurer une version ; les autres membres ouvrent en lecture et sont prévenus des nouvelles versions.
- **Enseignants (édition Pro)** : tableau de bord (copies à corriger, échéances), classes (couleur, matière, niveau, réglages, archivage), élèves créés en lot à partir d'une liste ou d'un CSV avec identifiants et mots de passe provisoires et **fiches de connexion en PDF**, nouveau mot de passe, inscription depuis une autre classe ; **studio de rédaction** des exercices et évaluations en texte enrichi (titres, listes, cases à cocher, citations, code, images, liens), questions à choix multiple, réponses rédigées avec corrigé type, montages corrigés automatiquement (« Enregistrer le montage actuel comme solution »), montage de départ, règles (tentatives, durée, échéance, retards, résultats montrés, pénalité par erreur de câblage), élèves visés, aperçu élève, vérifications avant publication ; **copies** en direct (répartition des notes, réussite par question), correction copie par copie (points, commentaires, appréciation, montage de l'élève ouvert dans le plan de travail), copies rendues, export CSV ; **carnet de notes** coloré ; administration de l'école (comptes enseignants). L'exercice du mode Enseignement s'envoie à une classe.
- Les écoles sont isolées les unes des autres ; une école est créée depuis l'édition Pro (essai de 30 jours, puis abonnement : `POST /platform/schools/:id/plan`).

Lancer l'ensemble en développement :

```bash
cd server && docker compose up -d db && npm ci && npm run start:dev   # API sur http://localhost:3100 (PostgreSQL sur le port 5433)
npm run seed                                                          # école de démonstration (identifiants affichés)
cd .. && npm run dev:pro                                              # application sur http://localhost:1420
```

L'adresse du serveur se règle dans l'écran de connexion (« Serveur ») ; celle proposée par défaut vient de `VITE_API_URL` à la construction (`node scripts/release.mjs … --api https://…`). Déploiement du serveur : `docker compose up -d --build` dans `server/` (détails, variables et sécurité : [server/README.md](server/README.md)).

## Langues

L’interface existe en français et en anglais, dans les deux éditions. Le code est écrit en français ; chaque texte affiché passe par `tl('…')` (`src/i18n/index.js`) et sa traduction est dans `src/i18n/en.js`, ou `src/i18n/en.pro.js` pour les textes des seuls modules Pro (un texte absent du dictionnaire reste en français). Le code Arduino généré suit la langue : commentaires, textes affichés et noms de variables. Le HTML statique de `index.html` est traduit au démarrage. Les exemples portent leur version anglaise (champ `en` : nom, description, code écrit à la main).

La langue est fixée à l’installation :

- **Windows** : l’installateur (NSIS) demande « Français » ou « English ». Le choix est écrit dans `language.txt` à côté de l’application (`src-tauri/windows/hooks.nsh`) ; l’application le lit au démarrage (commande `install_language`) et le retient. Réinstaller dans l’autre langue change celle de l’application.
- **macOS et Linux** (pas d’installateur à questions) : la langue du système au premier lancement, ou une construction dans une seule langue (`--lang fr` ou `--lang en`).

Construction des installateurs, copiés dans `release/<édition>-<langue>/` :

| Commande | Résultat |
|---|---|
| `npm run release:free` · `npm run release:pro` | Bilingue : langue choisie dans l’installateur Windows, sinon langue du système |
| `npm run release:free:fr` · `release:free:en` · `release:pro:fr` · `release:pro:en` | Une seule langue (application et installateur) |
| `node scripts/release.mjs --edition free\|pro --lang auto\|fr\|en [--target <triple>] [--dry-run] [-- <options de tauri build>]` | Forme générale (`--dry-run` affiche la configuration sans construire) |

En développement, `?lang=en` (ou `?lang=fr`) dans l’adresse de `npm run dev` change la langue de l’interface.

## Prérequis

| Système | À installer |
|---|---|
| Tous | [Node.js 20+](https://nodejs.org) et [Rust](https://rustup.rs) |
| Windows | Microsoft C++ Build Tools et WebView2 (déjà présent sur Windows 10 et 11) |
| macOS | Xcode Command Line Tools : `xcode-select --install` |
| Linux (Debian, Ubuntu) | `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev` |

Le détail est sur https://tauri.app/start/prerequisites/

## Lancer et compiler

```bash
npm install
npm run tauri dev      # application en mode développement, rechargement à chaud
npm run tauri build    # installeurs dans src-tauri/target/release/bundle/
```

`npm run dev` lance seulement l'interface dans un navigateur, sans le cœur Rust (les fichiers passent alors par des téléchargements).

## Raccourcis

| Touche | Action |
|---|---|
| Glisser broche → broche | Tirer un fil |
| Clic sur un fil | Le sélectionner, puis glisser une poignée pour le rebrancher |
| Ctrl+Z | Annuler la dernière action (fil, composant, déplacement, câblage automatique…) |
| Ctrl+Maj+Z ou Ctrl+Y | Rétablir |
| Suppr | Supprimer le fil ou le composant sélectionné |
| R | Pivoter le composant sélectionné de 90° |
| F | Cadrer toute la scène (ou tout le schéma, en vue Schéma) |
| F7 | Vérifier le montage et le programme (rapport) |
| S | Passer de la 3D au schéma électrique en direct, et inversement |
| Molette, pincement | Zoomer vers le curseur |
| Clic droit glissé, deux doigts, Maj + molette, flèches | Déplacer la vue |
| Ctrl+S, Ctrl+Maj+S, Ctrl+O, Ctrl+N | Enregistrer, enregistrer sous, ouvrir, nouveau |
| Ctrl+Entrée (dans l’éditeur) | Téléverser le programme |
| Ctrl+/ (dans l’éditeur) | Commenter ou décommenter les lignes |
| Clic maintenu sur un bouton, molette sur un potentiomètre (vue Schéma, simulation lancée) | Appuyer, tourner le curseur |
| Clic, glisser, Suppr sur un symbole (vue Schéma) | Sélectionner, déplacer, supprimer le composant |
| Glisser d'une broche à une autre · clic droit ou Suppr sur une broche ou un fil (vue Schéma) | Câbler · débrancher, retirer le fil |
| Clic dans la marge du code, F9 | Point d'arrêt (débogueur) |
| F8 · F10 · F11 · Maj+F11 | Continuer ou mettre en pause · pas à pas principal · entrer · sortir |

## Structure

```
src/
  main.js              éditeur : scène, câblage, animation, export, projets
  native.js            pont vers les commandes Rust, avec repli navigateur
  library/kit.js       primitives de modélisation (PCB, rangées de broches, socles)
  library/catalog.js   la bibliothèque de composants
  sim/boards.js        profils électriques des cartes (tensions, ADC, I2C, SPI, broches à éviter)
  sim/parts.js         fiches de câblage : rôle et explication de chaque broche, code Arduino
  sim/circuit.js       analyse du montage : nœuds, courts-circuits, vérification d'un composant
  sim/models.js        comportement des capteurs simulés et grandeurs de l'environnement
  sim/autowire.js      câblage automatique (un fil par broche, rails et rangées de breadboard) et explications
  sim/labels.js        étiquettes de mesure dans la scène 3D
  sim/faults.js        erreurs de câblage : où, pourquoi, comment corriger
  sim/fx.js            effets 3D des erreurs (ondes, étincelles, fumée, fil fantôme)
  sim/wiring.js        rangement des fils : tracés à angle droit, couloirs, hauteurs, grille de voisinage
  sim/wiring.worker.js le même calcul hors du fil principal, pour les très grands montages
  sim/actuators.js     effecteurs : programme (LED, servo, sons) et calcul du circuit (moteurs, ventilateur, pompe, vibreur, relais)
  sim/drive.js         ce qui commande un moteur ou un buzzer (pilote L298N, transistor, relais) : code généré et carte
  check/check.js       vérificateur : structure, programme ↔ montage, calcul dans tous les états atteignables
  check/check.worker.js le vérificateur hors du fil de l’interface (repli sur le fil principal si le travailleur manque)
  check/codes.js       codes stables J0101… ; explain.js : leur explication ; limits.js : valeurs nominales
  check/program.js     broches commandées ou lues par le programme, lues dans son texte (analyse statique)
  check/states.js      états atteignables (boutons, relais, potentiomètres, capteurs, broches du programme)
  check/format.js      rendu à la manière de rustc ; ui.js : pastille et rapport ; cli.mjs : en ligne de commande
  sim/audio.js         sons du buzzer, du haut-parleur et du relais
  prog/api.js          fonctions, constantes et bibliothèques Arduino connues du simulateur
  prog/lang.js         compilateur : préprocesseur, analyse, vérification des types, génération JavaScript
  prog/runtime.js      exécution en temps virtuel : broches, port série, bibliothèques simulées
  prog/rules.js        règles de comportement et génération du code Arduino
  prog/editor.js       éditeur de code (coloration, repères d’erreur, ligne en cours)
  prog/panel.js        onglet Code : règles, éditeur, téléversement, moniteur série
  schematic/sheet.js   schéma 2D : symboles, nœuds, placement, fils, cartouche, nomenclature ; disposition partagée (layoutSchematic) et routage sur grille de la vue en direct
  schematic/live.js    vue « Schéma » du plan de travail : SVG fixe + toile du courant animé, des LED et des valeurs
  schematic/flows.js   courant de chaque fil du schéma (arbre de chaque nœud), couleurs de tension
  schematic/draw.js    dessin vectoriel commun à l’aperçu (SVG) et au fichier PDF
  library/docs.js      documentation des composants
  library/preview.js   visionneuse 3D de la documentation
  ui/icons.js          icônes de l'interface (SVG)
  ui/viewcube.js       cube d’orientation (repère X, Y, Z en haut à droite)
  ui/blocks.js         blocs : cadres nommés autour d’une partie du montage
  pro/                 modules de l’édition Pro (enseignement, évaluation, guide de montage, carte réelle), absents de l’édition gratuite
  lab/                 travaux pratiques guidés : moteur de vérification, panneau, compte-rendu, TP (tp/*.json), validate.mjs
  sim/bench.js         banc de mesure : oscilloscope et multimètre
  sim/plotkit.js       couleurs, graduations et formats partagés (oscilloscope, traceur)
  sim/flow.js          courant dans chaque fil (arbre couvrant de chaque nœud)
  sim/flowfx.js        courant animé : points le long des fils
  prog/plotter.js      traceur série
  prog/visual/         blocs de code : définitions, générateur de code (sans Blockly, testable), espace de travail
  sim/dc.js            calcul du circuit (tensions, courants ; condensateurs et transistor dans le temps)
  quality.js           profil graphique (léger ou standard)
  sanitize.js          nettoyage des projets reçus
  boot.js              point d'entrée (dictionnaire anglais chargé à la demande)
  school/              espace classe : client de l'API, temps réel, texte enrichi, pages élève, messagerie, groupes, séances
  pro/classroom/       espace classe, outils de l'enseignant (Pro) : classes, élèves, rédaction, correction, carnet
  i18n/index.js        langue de l’interface (installation, système), tl() et traduction du HTML
  i18n/en.js           dictionnaire français → anglais
  i18n/en.pro.js       dictionnaire des modules Pro (chargé par pro/lang.js, absent de l’édition gratuite)
  ui/guides.js         repères des composants, mise à jour du cube d’orientation
  sim/custom.js        cartes et modules importés : familles de microcontrôleurs, rôles des broches
  cad/library.js       bibliothèque CAO livrée (chargement, clones, rendu simple ou réaliste)
  cad/import.js        import STEP / glTF dans l'application, normalisation et export GLB
  library/thumbs.js    vignettes 3D de la bibliothèque
public/cad/            modèles CAO livrés (GLB), manifeste, licences et attributions
public/licenses/       licences des bibliothèques tierces (lecteur STEP, assemblage MP4)
scripts/cad/           build-cad.mjs : télécharge et convertit les modèles CAO livrés
exemples/              projets d'exemple (.jollof), dont un montage à corriger
src-tauri/
  src/lib.rs           commandes natives : fichiers, vidéo, bibliothèque personnelle, arduino-cli, langue d’installation
  tauri.conf.json      fenêtre, paquets, icônes, installateur Windows bilingue
  tauri.pro.conf.json  surcharge de l’édition Pro
  windows/hooks.nsh    installateur Windows : écrit la langue choisie
scripts/release.mjs    construction d’une édition dans une langue (ou bilingue), adresse du serveur
server/                serveur de l'espace classe (NestJS, PostgreSQL, Socket.IO) : API.md, README.md, tests
```

## Ajouter un composant

Chaque composant est une fonction de `src/library/catalog.js`, puis une ligne du tableau `LIBRARY`. Exemple d'un module à trois broches :

```js
function monCapteur(c) {
  const b = moduleBoard(c, 20, 25, BLUE, ['VCC', 'GND', 'OUT']); // PCB + rangée de broches étiquetées
  b.finish();                                                      // dessine la sérigraphie
  block(c, 10, 4, 10, 0, b.top, -4, 0x222222);                     // un boîtier posé sur le PCB
}

{ id: 'mon-capteur', name: 'Mon capteur', cat: 'Capteurs', pre: 'CAP', build: monCapteur }
```

Les dimensions sont en millimètres, les broches au pas de 2,54 mm et les noms de broches reprennent la sérigraphie réelle, pour que les vidéos correspondent au montage physique.

Sa fiche électrique va dans `src/sim/parts.js`, d’après la fiche technique du fabricant : pour chaque broche, son rôle (`pwr` avec sa plage de tension, `gnd`, `io` avec ce qu’elle attend de la carte), `lv5` si elle sort la tension du module (5 V), `lv3` si le module est en logique 3,3 V, `idle: 1` si elle est tirée au niveau haut au repos ; `ma` pour sa consommation ; `stage` pour une charge qu’une broche ne peut pas alimenter (transistor, résistance de base, diode de roue libre, tension). Le câblage automatique, le vérificateur et la documentation s’en servent tous ; `node --test src/sim/autowire.test.mjs` vérifie qu’il se câble sans faute sur chaque carte.

## Modèles CAO livrés et licences

Les modèles réels sont générés par `node scripts/cad/build-cad.mjs`. Ce script télécharge les STEP, les convertit en GLB légers (une matière par couleur, Y vers le haut, millimètres) et écrit `public/cad/models.json` et `public/cad/LICENSES.md`.

Seules des sources dont la licence permet la redistribution, y compris dans un logiciel commercial, sont utilisées :

| Source | Licence | Obligations |
|---|---|---|
| Bibliothèque 3D KiCad | CC-BY-SA 4.0 (avec l’exception KiCad) | Attribution. Les modèles, convertis ou non, restent sous CC-BY-SA 4.0. Le code de l’application n’est pas concerné. |
| Adafruit_CAD_Parts | MIT | Conserver la notice de copyright |

Les attributions sont listées dans l’application (Documentation → Crédits et licences) et dans `public/cad/LICENSES.md`. Pour ajouter un modèle, il suffit de l’ajouter au tableau `MODELS` du script, après avoir vérifié sa licence.

Le lecteur STEP (occt-import-js et Open CASCADE Technology, LGPL-2.1) est un module WebAssembly séparé, chargé seulement au premier import STEP. Leurs licences sont dans `public/licenses/`.

## Données

La bibliothèque personnelle est enregistrée dans le dossier de données de l'application (`library/` sous `%APPDATA%\sn.jollof.studio` sur Windows, `~/Library/Application Support/sn.jollof.studio` sur macOS, `~/.local/share/sn.jollof.studio` sur Linux).

## Limites connues

- Vérificateur : la garantie vaut dans le modèle (continu, valeurs nominales) ; les pointes de courant au démarrage d’un moteur ou à la charge d’un condensateur ne sont pas comptées ; la consommation d’un module est une charge fixe à sa tension nominale (pas les pointes de 2 A du SIM800L en émission) ; l’adaptateur de niveau est modélisé en continu (MOSFET idéal en interrupteur), pas sa vitesse de commutation ; le relais est essayé collé et au repos même si sa bobine ne peut pas coller (prudence) ; le compilateur ne signale qu’une erreur de code à la fois.

- Courant animé : quand des fils forment une boucle (fils en parallèle), le courant est montré sur un seul chemin.
- Effecteurs : un moteur est modélisé par une résistance (pas de force contre-électromotrice : son courant ne baisse pas quand il prend de la vitesse) ; les contacts d’un relais suivent la bobine avec un pas d’analyse (0,1 s) de retard.
- Vue Schéma : on n'y fait pas pivoter un composant (son symbole garde son orientation) et les breadboards n'y sont pas dessinées ; cartes et modules sont des blocs dont le courant interne n'est pas montré ; un nœud de plus de 16 broches, ou qu'aucun chemin libre ne permet de relier, garde ses étiquettes.
- Débogueur : pas d'arrêt dans une fonction d'interruption ; pendant une pause, les fronts brefs sur les broches sont perdus (les niveaux sont gardés).
- Transistor : modèle simplifié (pas de fonctionnement inversé collecteur/émetteur) ; condensateurs : erreur du modèle d'Euler de l'ordre de 1 % pour une constante de temps de 50 ms et plus.

- **Windows 7 / 8** : l'application de bureau (Tauri 2, WebView2) demande Windows 10 ou plus récent. Sur ces vieux postes, la version web (`npm run build`, servie par exemple par la boîte école) fonctionne dans Chrome ou Firefox récents.
- Les performances n'ont été mesurées qu'en simulation (processeur ralenti, rendu logiciel) : à valider sur les vrais PC des établissements pilotes.

- Sous Linux, la webview WebKitGTK ne propose pas toujours l’encodage vidéo (WebCodecs) : la vidéo est alors enregistrée en temps réel, si la webview le permet. Windows et macOS rendent image par image.
- En mode « Débutant », le langage des programmes est le C++ d’Arduino sans pointeurs, `struct`, classes ni modèles (templates) ; `sprintf` et les tableaux de caractères modifiables ne sont pas pris en charge (utilisez `String`). Le mode « Fidèle » (Uno, Nano, application installée) n’a pas ces limites ; ses modules I2C, SPI et à protocole temporel (écrans, capteurs, radio) arrivent avec les modèles de bus (étape M2). Simulés, depuis la section « Périphériques » de l’onglet Simulation : le **Wi-Fi** de l’ESP32 et de l’ESP8266 dans un bac à sable sans Internet (réseau « Ecole-WiFi » modifiable, `WiFi.begin`, point d’accès, `scanNetworks` ; `WebServer` dont la page s’affiche dans la carte « Navigateur », sans aucun script, liens et formulaires renvoyés au programme ; `HTTPClient` vers les sites fictifs meteo.jollof, journal.jollof (courbes) et heure.jollof, ou vers une autre carte ; ESP-NOW entre cartes), le Bluetooth (HC-05 avec son mode AT, `BluetoothSerial` de l’ESP32), le GSM (SIM800L : commandes AT, SMS, appels sortants et entrants), l’infrarouge (IRremote, NEC en réception), le RFID (MFRC522, MIFARE Classic 1K), la radio (RF24), le clavier matriciel (Keypad), l’EEPROM et `Preferences` (gardées avec le projet). Pas d’HTTPS, de MQTT, d’UDP/NTP, d’ArduinoJson ni de sockets bruts ; pas d’émission infrarouge, pas de GPRS, pas de portée radio ni d’interférences (chaque carte voit chaque réseau).
- Une carte sans programme garde le comportement d’avant : ses écrans affichent les mesures et une LED câblée s’allume.
- Un module importé est vérifié et câblé automatiquement, mais il n’a pas de modèle de mesure : il n’affiche pas de valeur simulée.
- Aucun modèle CAO redistribuable n’a été trouvé pour les cartes ESP32 DevKit, NodeMCU, Uno et Nano entières : elles restent dessinées, avec leurs puces et connecteurs réels en rendu réaliste. On peut importer son propre modèle comme « apparence » de ces cartes.

## Licence

Copyright (C) 2026 Mamadou Sarr.

Jollof Studio est publié sous la **GNU Affero General Public License v3** (ou ultérieure, fichier [LICENSE](LICENSE)), avec des conditions supplémentaires prévues par sa section 7 (fichier [NOTICE.md](NOTICE.md)) :

- toute copie, version modifiée ou œuvre fondée sur Jollof Studio garde la mention de copyright et affiche « Basé sur Jollof Studio par Mamadou Sarr » avec un lien vers le projet ;
- une version modifiée porte un autre nom : la licence ne donne aucun droit sur le nom « Jollof Studio », son logo ou ses icônes ;
- une version modifiée utilisée par d’autres, même seulement à travers un réseau (serveur d’école, site web), doit leur proposer son code source complet.

Une **licence commerciale** est proposée à qui ne peut pas respecter l’AGPL : [COMMERCIAL.md](COMMERCIAL.md). Les contributions sont acceptées sous le contrat de contributeur [CLA.md](CLA.md), qui garde cette double licence possible. Chaque fichier source porte l’en-tête `SPDX-License-Identifier: AGPL-3.0-or-later`.

Composants tiers (bibliothèques, modèles 3D, polices) : [THIRD_PARTY.md](THIRD_PARTY.md), produit par `node scripts/licenses.mjs` (`--check` : code de sortie 1 si une licence pose problème), et dans l’application (Documentation → Crédits et licences). Textes des licences tierces : `public/licenses/` et `public/cad/`.
