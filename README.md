<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg"><img src="docs/brand/logo-light.svg" alt="Jollof Studio" width="420"></picture></p>

<p align="center"><b>Un labo d’électronique. Sans labo.</b><br>
<i>An electronics lab. No lab required.</i></p>

<p align="center">
  <a href="https://github.com/xelaktechsn/jollof-studio/releases/latest"><b>Télécharger</b></a> ·
  <a href="https://xelaktechsn.github.io/jollof-studio/">Site</a> ·
  <a href="docs/GUIDE.md">Guide complet</a>
</p>

<p align="center"><a href="https://xelaktechsn.github.io/jollof-studio/"><img src="docs/media/video-poster.jpg" alt="Vidéo de présentation" width="640"></a></p>

Jollof Studio est une application de bureau, gratuite et open source, pour **câbler, programmer et simuler** de l’électronique, de la pneumatique et de la logique, sans matériel. Pensée pour les élèves, les enseignants et les apprentis ingénieurs, surtout là où un vrai labo manque.

## Ce qu’on peut faire

- **Câbler en 3D** : 111 composants, cartes Arduino (Uno, Nano, Mega), ESP32, ESP8266 et Raspberry Pi Pico ; câblage automatique.
- **Programmer** : par règles (« quand… alors… »), par blocs ou en vrai code Arduino ; le programme tourne dans le simulateur.
- **Vérifier** : le vérificateur essaie chaque état possible du montage et prouve que rien ne grille avant de toucher une vraie carte.
- **Pneumatique et GRAFCET** : vérins, distributeurs, GRAFCET, machines animées en 3D, couplées au montage électronique.
- **Logique numérique** : portes, bascules, compteurs, tables de vérité, Karnaugh.
- **57 TP guidés**, vérifiés pas à pas, avec compte rendu PDF.
- **Passer au réel** : téléversement sur une vraie carte, moniteur série, guide de montage imprimable, export KiCad.
- En **français et en anglais**.

## Installer

| Système | Fichier |
|---|---|
| Windows 10/11 | `Jollof-Studio-Windows-x64-setup.exe` |
| Linux | `.AppImage`, `.deb` ou `.rpm` |
| macOS | bientôt |

Tout est sur la [page des versions](https://github.com/xelaktechsn/jollof-studio/releases/latest).

Déjà installé ? L’application propose elle-même les nouvelles versions (à partir de la 0.2.1).

## Compiler soi-même

Il faut [Node.js 20+](https://nodejs.org) et [Rust](https://rustup.rs) ([prérequis Tauri](https://tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev      # lancer en développement
npm run tauri build    # construire l’installateur
```

## En savoir plus

- [Guide complet](docs/GUIDE.md) : toutes les fonctions, raccourcis, structure du code, limites connues.
- [Ce que prouve le vérificateur](docs/PROVEN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contribuer](CONTRIBUTING.md)

## English

Jollof Studio is a free, open-source desktop app to wire, code and simulate electronics, pneumatics and digital logic, with no hardware. Arduino, ESP32 and Pico in 3D; a checker that proves nothing burns; GRAFCET and 3D machines; 57 guided labs; English and French. [Download](https://github.com/xelaktechsn/jollof-studio/releases/latest) · [Website](https://xelaktechsn.github.io/jollof-studio/).

## Licence

© 2026 Mamadou Sarr. [AGPL-3.0](LICENSE) avec [conditions supplémentaires](NOTICE.md) ; [licence commerciale](COMMERCIAL.md) possible. Composants tiers : [THIRD_PARTY.md](THIRD_PARTY.md).
