<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Mamadou Sarr — kit de formation des enseignants de Jollof Studio -->

# Kit de formation des enseignants

Ce kit sert à animer une séance de **2 heures** pour des collègues enseignants (collège, lycée,
lycée technique, formation professionnelle) qui découvrent Jollof Studio. Il est prévu pour une
salle avec un vidéoprojecteur, des ordinateurs sans Internet fiable et, si possible, une ou deux
vraies cartes Arduino.

À la fin de la séance, chaque participant sait câbler et programmer un montage dans l’application,
lire le vérificateur, lancer une simulation, utiliser les TP guidés et produire une vidéo de
câblage pour ses élèves.

## Contenu

| Fichier | Rôle |
|---|---|
| [`slides.html`](slides.html) | Diaporama de 25 diapositives (16:9), avec notes du présentateur. S’ouvre dans un navigateur, sans Internet. |
| [`projets/`](projets/) | 5 projets `.jollof` prêts : ateliers et vidéos. |
| [`scripts-videos.md`](scripts-videos.md) | Narration de chaque vidéo, minutée, et réglages du rendu. |
| `img/` | Captures d’écran utilisées par le diaporama (WebP). |

Le dossier entier pèse moins de 2 Mo : il tient sur n’importe quelle clé USB et s’envoie facilement.

## Déroulé de la séance

| Horaire | Durée | Partie | Diapositives | Ce que fait le formateur |
|---|---|---|---|---|
| 0:00 – 0:10 | 10 min | Accueil, pourquoi simuler | 1 à 4 | Présente l’objectif, interroge les collègues sur leur matériel et ce qui casse. |
| 0:10 – 0:30 | 20 min | Démonstration | 5 à 12 | Montre en direct : interface, câblage automatique, vérificateur (exemple « Montage à corriger »), modes de code, simulation. |
| 0:30 – 0:50 | 20 min | Atelier 1 : LED et bouton | 13 | Les participants câblent à la main et écrivent le programme. Le formateur circule. |
| 0:50 – 1:10 | 20 min | Atelier 2 : feu tricolore | 14 | Câblage automatique, lecture du programme, multimètre. |
| 1:10 – 1:15 | 5 min | Pause | | |
| 1:15 – 1:35 | 20 min | Atelier 3 : capteurs, puis montage à corriger | 15 | Thermomètre ou radar au choix, puis recherche des 5 erreurs. |
| 1:35 – 1:50 | 15 min | Pour la classe | 16 à 22 | TP guidés, rendu des élèves, boîtier école, vidéo, Wokwi, KiCad, carte réelle. Démonstration rapide de chaque point. |
| 1:50 – 2:00 | 10 min | Dépannage, questions | 23 à 25 | Problèmes fréquents, aide, date d’une première séance avec les élèves. |

Si le temps manque, raccourcir « Pour la classe » : ces diapositives se lisent seules après la
séance. Ne pas raccourcir les ateliers.

Organisation conseillée : un participant par poste (deux au plus). Les ateliers se suivent en
difficulté ; un participant rapide passe au défi de la diapositive ou au projet suivant.

## Matériel

**Indispensable**

- Un ordinateur pour le formateur, relié au vidéoprojecteur (1280 × 720 au minimum).
- Un poste par participant (ou pour deux), Windows 10 ou plus récent, macOS ou Linux, avec
  Jollof Studio installé. Sur un poste ancien, le mode léger (⚡) s’active seul ou à la main.
- Une clé USB avec : l’installateur de Jollof Studio, ce kit (diaporama, projets) et le diaporama
  en PDF en secours.

**Facultatif**

- Une Arduino Uno avec son câble USB, une breadboard, une LED, une résistance de 220 Ω et un
  bouton, pour montrer la carte réelle (diapositive 22). Téléverser **StandardFirmata** à l’avance
  depuis l’IDE Arduino (Fichier → Exemples → Firmata → StandardFirmata).
- Un boîtier école déjà installé (vieux PC ou Raspberry Pi), pour montrer l’espace classe
  (diapositive 18). Installation : `server/README.md`, section « Boîtier école (pas à pas) ».
- Une connexion Internet le jour de la préparation seulement, si l’on veut le mode Fidèle (voir
  ci-dessous).

## Préparer la séance (la veille)

1. **Installer Jollof Studio** sur chaque poste depuis la clé USB. L’application, les exemples, les
   TP et MicroPython fonctionnent ensuite sans Internet.
2. **Copier le dossier `projets/`** sur chaque poste (par exemple dans *Documents*), puis ouvrir
   chaque projet une fois (<kbd>Ctrl</kbd>+<kbd>O</kbd>) : la pastille doit afficher « ✓ Vérifié ».
3. **Mode Fidèle** (facultatif) : il télécharge arduino-cli, les fichiers de la carte et les
   bibliothèques à la première utilisation. Sur chaque poste, avec Internet, ouvrir un projet Uno,
   onglet Code, *Mode d’exécution* → *Fidèle*, lancer la simulation une fois. Les fichiers restent
   ensuite en cache. Sans cette préparation, rester en mode Débutant : les ateliers n’en ont pas
   besoin.
4. **Tester le vidéoprojecteur** avec `slides.html` en plein écran (touche <kbd>F</kbd>).
5. **Rendre les vidéos** à l’avance si vous voulez les montrer (voir plus bas) : le rendu prend
   quelques minutes par vidéo.

## Présenter les diapositives

Ouvrir `slides.html` dans un navigateur récent (Chrome, Edge, Firefox). Aucun accès à Internet
n’est nécessaire : les captures sont dans `img/`, à garder à côté du fichier.

| Touche | Action |
|---|---|
| <kbd>→</kbd>, <kbd>Espace</kbd>, <kbd>Page suivante</kbd> | Diapositive suivante |
| <kbd>←</kbd>, <kbd>Page précédente</kbd> | Diapositive précédente |
| <kbd>Début</kbd>, <kbd>Fin</kbd> | Première, dernière diapositive |
| <kbd>F</kbd> | Plein écran |
| <kbd>N</kbd> | Notes du présentateur (en bas de l’écran) |
| <kbd>?</kbd> | Rappel des touches |

Un clic dans le tiers droit de l’écran avance, dans le tiers gauche recule ; sur une tablette, on
glisse du doigt. L’adresse garde le numéro de la diapositive (`slides.html#13` ouvre l’atelier 1).

## Imprimer les diapositives en PDF

1. Ouvrir `slides.html` dans Chrome ou Edge, puis <kbd>Ctrl</kbd>+<kbd>P</kbd>.
2. *Destination* : « Enregistrer au format PDF ».
3. *Plus de paramètres* : marges « Aucune », cocher « Graphiques d’arrière-plan ».
4. Enregistrer. On obtient **25 pages, une diapositive par page**, au format 16:9 fixé par le
   fichier. Les notes du présentateur ne sont pas imprimées.

Firefox respecte aussi le format de page. Si un navigateur impose le format A4, choisir
l’orientation Paysage et l’échelle « Ajuster à la page ».

## Les projets

Les cinq projets ont été montés dans l’application elle-même : composants posés, carte
sélectionnée, bouton **« Câbler les composants à cette carte »**, puis programme écrit avec les
broches que le câblage automatique a choisies. Chacun a été rouvert depuis son fichier et testé en
simulation.

| Fichier | Sujet | Carte, mode | Fils | Vérificateur | Vu en simulation |
|---|---|---|---|---|---|
| `01-led-bouton.jollof` | LED et bouton poussoir | Uno, Débutant | 6 | ✓ 0 erreur, 0 avertissement, 4 états prouvés | Bouton appuyé : LED allumée ; relâché : éteinte |
| `02-feu-tricolore.jollof` | Feu tricolore | Uno, Débutant | 10 | ✓ 0 / 0, 8 états | Vert, orange, rouge en boucle ; moniteur série |
| `03-thermometre-lcd.jollof` | Thermomètre DHT22 et écran LCD I2C | Uno, Débutant | 9 | ✓ 0 / 0, 1 état | « Temp : 24.0 C / Hum : 55 % » sur l’écran, suit le curseur de température |
| `04-radar-de-recul.jollof` | Radar de recul HC-SR04 et buzzer | Nano, Débutant | 11 | ✓ 0 / 0, 8 états | Bips à 35 cm, son continu à 6 cm, silence à 150 cm |
| `05-pico-micropython-variateur.jollof` | LED et potentiomètre en MicroPython | Pico, MicroPython | 7 | ✓ 0 / 0, 12 états | LED à 1 %, 25 %, 90 % pour le curseur à 10 %, 50 %, 95 % |

Ce que le câblage automatique a décidé de lui-même : les résistances de 220 Ω des LED, le passage
du 5 V et de la masse par les rails de la breadboard (posée à l’avance dans les projets 01 à 04), le
transistor BC547 et sa résistance de base de 1 kΩ pour le buzzer (il tire 25 mA, plus que les 20 mA
conseillés par broche).

**Une exception, dans le projet 05** : la résistance de 1 kΩ entre le curseur du potentiomètre et
GP28 a été ajoutée à la main après le câblage automatique. Le vérificateur ne lit pas les
programmes MicroPython : par prudence, il suppose que chaque broche reliée peut devenir une sortie.
Sans cette résistance, il signale une erreur (potentiomètre en butée et GP28 en sortie : 127 mA dans
la broche). Avec elle, le courant reste sous 3,3 mA dans tous les cas, et la lecture du
potentiomètre est inchangée. C’est aussi une bonne habitude sur une vraie carte. Les diapositives 9
et 24 l’expliquent.

Les projets se vérifient aussi en ligne de commande, un fichier à la fois, depuis la racine du
projet : `node src/check/cli.mjs docs/teacher-kit/projets/01-led-bouton.jollof` (code de sortie 1
s’il reste une erreur).

Chaque projet garde une timeline de vidéo (titre, câblage, code, simulation), trois plans de caméra
et les réglages d’export (1920 × 1080, 30 images/s, légendes affichées).

## Rendre les vidéos

Résumé (le détail et les narrations sont dans [`scripts-videos.md`](scripts-videos.md)) :

1. Ouvrir le projet, onglet **Vidéo**.
2. Lancer la **simulation** (bouton *Simuler*) pour que LED, écran et buzzer s’animent dans la vidéo.
3. Choisir **1280 × 720** pour partager, **1920 × 1080** pour projeter ; **30** images/s.
4. **Rendre la vidéo**, puis l’enregistrer (MP4, sans son).
5. Ajouter la narration à part, ou la dire en direct en classe.

Mesure : la vidéo du projet 02 (80 s, 720p) pèse 28 Mo ; recompressée avec `ffmpeg`, 3,5 Mo.

## À savoir sur les captures d’écran

Les captures ont été prises avec la version de développement de l’**édition Pro** (badge « PRO »
en haut à gauche, interface en français). L’édition gratuite a les mêmes écrans ; seuls quelques
boutons diffèrent et portent un cadenas : *Enseigner*, *Guide de montage*, téléversement sur une
vraie carte. Les fonctions présentées dans les ateliers sont toutes dans l’édition gratuite. Créer
des classes et des devoirs dans l’espace classe demande l’édition Pro ; les élèves utilisent
l’édition gratuite.

## Licence et crédit

Ce kit fait partie de **Jollof Studio par Mamadou Sarr** et suit sa licence : GNU Affero General
Public License v3 ou ultérieure, avec les conditions supplémentaires de `NOTICE.md` à la racine du
projet. Vous pouvez l’utiliser, le copier, l’adapter et le distribuer à vos collègues, à condition
de garder la mention « Jollof Studio par Mamadou Sarr » et de partager vos versions modifiées sous
la même licence. Licence commerciale : voir `COMMERCIAL.md` (contact à compléter par le titulaire
des droits).
