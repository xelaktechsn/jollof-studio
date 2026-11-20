# Performances mesurées

Ce document donne des temps mesurés, la façon de les refaire, et ce qui n'a pas été mesuré. Les réglages qui
allègent l'application (mode léger, rendu à la demande, démarrage différé) sont décrits dans le
[guide](GUIDE.md#performances-vieux-ordinateurs).

## Refaire les mesures

```bash
node scripts/bench.mjs          # tableau
node scripts/bench.mjs --json   # même contenu en JSON, pour comparer deux versions
```

Le script tourne sous Node, sans navigateur ni carte graphique : il mesure les calculs, pas l'affichage. Chaque
valeur est la médiane de plusieurs passes après une passe d'échauffement. Les montages d'essai viennent d'un
générateur à graine fixe (composants en grille tous les 60 mm, fils entre composants pris au hasard) : les entrées
sont les mêmes à chaque lancement. Le vérificateur est mesuré sur les projets du dossier `exemples/`.

## Résultats

Mesures du 2026-11-20, sur Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz (12 cœurs), Darwin 25.5.0 x64, Node v22.18.0.


### Rangement des fils

| Cas | Temps | Détail |
|---|---:|---|
| 20 fils | 8,22 ms | 9 composants |
| 100 fils | 141,6 ms | 25 composants |
| 300 fils | 814,8 ms | 81 composants |
| 1000 fils | 1142,2 ms | 256 composants |

### Plans de caméra

| Cas | Temps | Détail |
|---|---:|---|
| 20 fils | 1,91 ms | 5 plans |
| 100 fils | 16,7 ms | 65 plans |
| 300 fils | 93,7 ms | 216 plans |
| 1000 fils | 879,5 ms | 781 plans |

### Synoptique

| Cas | Temps | Détail |
|---|---:|---|
| 10 blocs | 0,09 ms |  |
| 50 blocs | 0,37 ms |  |
| 200 blocs | 1,44 ms |  |

### Guide illustré (mise en page)

| Cas | Temps | Détail |
|---|---:|---|
| 10 étapes | 4,38 ms |  |
| 100 étapes | 42,9 ms |  |

### Vérificateur

| Cas | Temps | Détail |
|---|---:|---|
| 01-station-meteo | 7,97 ms | 5 composants, 16 fils, 1 états |
| 02-led-bouton-breadboard | 4,71 ms | 5 composants, 7 fils, 4 états |
| 03-radar-de-recul | 7,13 ms | 7 composants, 15 fils, 8 états |
| 04-thermometre-ds18b20 | 5,43 ms | 5 composants, 12 fils, 1 états |
| 05-arrosage-automatique | 6,94 ms | 5 composants, 12 fils, 4 états |
| 06-moteur-vitesse | 3,33 ms | 5 composants, 11 fils, 24 états |
| 07-a-corriger | 7,68 ms | 8 composants, 21 fils, 2 états |
| 08-verin-electropneumatique | 5,19 ms | 10 composants, 17 fils, 16 états |
| 09-ventilateur-pnp | 2,31 ms | 5 composants, 7 fils, 4 états |
| 10-regulateur-zener | 0,32 ms | 5 composants, 6 fils, 1 états |
| 11-analyseur-bus-i2c | 1,44 ms | 3 composants, 9 fils, 1 états |
| 12-feu-pietons-sequence | 3,87 ms | 6 composants, 11 fils, 32 états |
| 13-compteur-visiteurs | 8,84 ms | 7 composants, 14 fils, 8 états |
| 15-objet-connecte-w5500 | 4,56 ms | 5 composants, 13 fils, 3 états |
| 16-esp32-mqtt-wifi | 2,11 ms | 4 composants, 6 fils, 6 états |

## Ce que ces chiffres veulent dire

- **Rangement des fils.** Jusqu'à une centaine de fils, le tracé est refait sans attente visible. Au-delà de 250 fils,
  l'application le calcule dans un fil d'exécution à part : l'interface ne se fige pas, les fils se rangent un instant
  après. Pendant le déplacement d'un composant d'un grand montage, seuls ses fils sont recalculés. Le montage d'essai est
  dense (fils entre composants pris au hasard, souvent éloignés) : c'est un cas défavorable.
- **Plans de caméra.** Le calcul suit le nombre de fils. Jusqu'à 400 fils il est refait à chaque modification ; au-delà,
  il est remis au lancement de l'animation ou du rendu.
- **Vérificateur.** Les projets d'exemple se vérifient en quelques millisecondes. Le temps dépend surtout du nombre
  d'états atteignables (boutons, capteurs, sorties du programme), pas du nombre de fils.
- **Synoptique et guide illustré.** La mise en page est négligeable ; pour le guide, le temps réel est celui du rendu
  des images (une par fil), qui dépend de la carte graphique.

## Ce qui n'est pas mesuré ici

- **L'affichage 3D** (images par seconde) : il dépend de la carte graphique et du mode (standard ou léger). Les
  mesures faites sur un PC simulé très faible sont dans le guide ; elles restent à confirmer sur les postes des
  établissements pilotes.
- **Le démarrage** de l'application : à mesurer sur une construction finale (`npm run build`), pas sur le serveur de
  développement.
- **Le rendu vidéo** : il dépend de l'encodeur du système (puce graphique ou logiciel) et de la taille choisie.
- **L'import STEP** : la lecture d'un gros fichier prend plusieurs secondes ; un modèle trop détaillé est relu plus
  grossièrement, ce qui ajoute une lecture par niveau (quatre au plus).
