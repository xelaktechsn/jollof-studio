# Montrer Jollof Studio : inventaire et plan de démonstration

Pour qui prépare une vidéo, une présentation en salle ou un article. Ce document dit quoi montrer, dans quel ordre,
quoi dire, et ce qu'il ne faut pas promettre. Les détails de chaque fonction sont dans le [guide](GUIDE.md) ; ce que
le vérificateur garantit est dans [PROVEN.md](PROVEN.md).

## Ce qu'il y a à montrer

| Domaine | Ce qu'on voit à l'écran |
|---|---|
| Montage 3D | Bibliothèque de composants et de cartes (Arduino, ESP32, ESP8266, Pico), fils rangés automatiquement, câblage automatique, forme d'un fil réglée à la main |
| Programme | Règles « quand… alors… », blocs, code Arduino ; moniteur série ; le vrai programme émulé sur les cartes qui ont un émulateur |
| Simulation | Capteurs réglables, LED, écrans, moteurs, courant animé, pannes signalées dans la scène |
| Vérificateur | Rapport d'erreurs à la manière d'un compilateur, avec la source de chaque limite |
| Schéma | Schéma électrique tracé à partir du montage, PDF, export KiCad, synoptique en blocs |
| Autres plans de travail | Logique numérique, pneumatique et GRAFCET, automate (Ladder), machines animées en 3D |
| TP | Travaux pratiques guidés, validés pas à pas, compte rendu PDF |
| Sorties | Vidéo du câblage (plans de caméra automatiques, démonstration finale, bande-son, sous-titres), image PNG jusqu'en 4K, guide de montage PDF, guide illustré HTML |
| Vers le réel | Téléversement sur une vraie carte et moniteur série (application de bureau) |

## Préparer

1. Ouvrir un projet d'exemple court (`exemples/02-led-bouton-breadboard.jollof` : cinq composants, sept fils).
2. Vérifier que la pastille du vérificateur est verte.
3. Onglet Vidéo : « Plans automatiques », puis « Démonstration à la fin » sur 5 s.
4. Pour une projection : onglet Vidéo → « Présentation » (Échap pour revenir).
5. Faire une copie du projet avant toute démonstration qui supprime des fils.

## Plan d'une vidéo de 5 à 7 minutes

| Temps | À l'écran | À dire |
|---|---|---|
| 0:00 – 0:30 | L'accueil, puis un montage terminé qui tourne en simulation | « Un labo d'électronique sans labo : on câble, on programme et on simule avant d'acheter quoi que ce soit. » |
| 0:30 – 1:30 | Poser une carte, une LED, une résistance ; tirer deux fils ; « Câbler tout le circuit » | Les fils se rangent seuls ; une broche ne reçoit qu'un fil, comme en vrai. |
| 1:30 – 2:30 | Onglet Code : une règle, puis le même programme en Arduino ; lancer la simulation, appuyer sur le bouton | Trois façons de programmer, le même résultat à l'écran. |
| 2:30 – 3:30 | Retirer la résistance de la LED : le vérificateur passe au rouge ; ouvrir le rapport | « Le vérificateur essaie chaque état du montage et dit pourquoi ça grille, avec la fiche technique à l'appui. » |
| 3:30 – 4:15 | Vue Schéma, puis synoptique ; cliquer un bloc | Le schéma et le synoptique sont tirés du montage, rien n'est redessiné à la main. |
| 4:15 – 5:15 | Onglet Vidéo : « Animer » avec les plans automatiques et la démonstration finale ; exporter le guide illustré | La caméra va chercher chaque fil ; à la fin, le circuit fonctionne à l'image. |
| 5:15 – 6:00 | Un TP guidé, ou le plan de travail pneumatique avec une machine en 3D | Le même outil sert du collège à l'atelier d'automatisme. |
| 6:00 – 6:30 | Le site, le bouton « Essayer dans le navigateur », le dépôt | Gratuit, libre (AGPL-3.0), utilisable sans installation. |

## Images et vidéos propres

- **Image fixe** : onglet Vidéo → « Image et présentation ». Fond blanc pour une fiche imprimée, transparent pour un
  diaporama. La vue exportée est celle de l'écran : cadrer d'abord.
- **Vidéo** : MP4 pour le web ; « Images PNG » pour un logiciel de montage ou pour garder un fond transparent.
- **Synoptique** : SVG pour un document, PNG pour une diapositive.

## Ce qu'il ne faut pas promettre

- Le vérificateur prouve la sûreté **dans son modèle** (régime continu, valeurs nominales). Il ne remplace pas une
  mesure sur le montage réel. Lire [PROVEN.md](PROVEN.md) avant d'en parler.
- La version en ligne ne compile pas le C++ et ne téléverse pas sur une carte : ces deux fonctions demandent
  l'application de bureau.
- L'application macOS n'est pas encore distribuée ; Windows et Linux le sont.
- Les plans de caméra automatiques raisonnent sur l'encombrement des composants (des boîtes) : dans un montage très
  serré, un plan peut être à reprendre à la main.
- Les limites connues, fonction par fonction, sont listées à la fin du [guide](GUIDE.md#limites-connues).
