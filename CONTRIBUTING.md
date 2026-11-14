# Contribuer à Jollof Studio · Contributing to Jollof Studio

*Français d’abord, English below.*

## Français

Merci de vouloir améliorer Jollof Studio. Le projet est pensé pour les écoles d’Afrique francophone :
il doit rester simple, hors ligne, rapide sur de vieux ordinateurs, et ne jamais laisser griller un
composant sans le dire.

### Avant de commencer

- Lisez [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (en anglais) : où vit chaque partie du code.
- Ouvrez d’abord un ticket (bug, idée, composant) pour en discuter : on évite ainsi le travail perdu.
- **Contrat de contributeur.** Toute contribution est acceptée sous le [CLA](CLA.md). Cochez la case
  du modèle de demande de fusion : vous gardez vos droits, et Jollof Studio peut rester disponible
  sous l’AGPL et sous licence commerciale.
- **Code d’autrui.** N’ajoutez que du code que vous avez écrit, ou des bibliothèques sous licence
  permissive (MIT, BSD, Apache-2.0…). Jamais de code copié d’un projet GPL ou AGPL d’un tiers : il
  empêcherait la double licence. `node scripts/licenses.mjs --check` vérifie les dépendances.

### Règles du code

- Le texte de l’interface est écrit **en français** dans le code, entouré de `tl('…')` ; ajoutez sa
  traduction anglaise dans `src/i18n/en.js`. Aucun texte affiché ne doit manquer en anglais.
- Chaque nouveau fichier source commence par :
  ```js
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Mamadou Sarr
  ```
  (Le copyright reste celui du projet ; vos droits sont décrits par le CLA.)
- Les commentaires expliquent le *pourquoi*, en français, comme le reste du code.
- Les codes du vérificateur (`J0301`…) ne changent jamais de sens : on en ajoute, on n’en réutilise pas.
- Un composant ajouté suit le guide « Ajouter un composant » de docs/GUIDE.md et doit passer
  `node --test src/sim/autowire.test.mjs` (câblé seul sur chaque carte, zéro faute).

### Vérifier avant d’envoyer

```bash
npm install
node --test $(find src -name "*.test.mjs")   # tous les tests
node src/lab/validate.mjs                    # les TP
npx vite build && npx vite build --mode pro  # les deux éditions (pro : si vous avez accès au dépôt privé)
node scripts/licenses.mjs --check            # licences des dépendances
```

L’interface se lance avec `npm run dev` (navigateur) ou `npm run tauri dev` (application de bureau).

### Édition Pro

Les modules de l’édition Pro sont dans un dépôt privé distinct ; le dépôt public se construit sans
eux. Une contribution au dépôt public ne doit pas dépendre du code Pro.

## English

Thank you for helping Jollof Studio. The project is built for schools in French-speaking Africa: it
must stay simple, work offline, run fast on old computers, and never let a part burn without saying so.

### Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): where each part of the code lives.
- Open an issue first (bug, idea, new part) so we can agree on the approach.
- **Contributor agreement.** Every contribution is accepted under the [CLA](CLA.md). Tick the box in
  the pull request template: you keep your rights, and Jollof Studio can stay available under the
  AGPL and under a commercial licence.
- **Other people’s code.** Only add code you wrote, or libraries under permissive licences (MIT,
  BSD, Apache-2.0…). Never copy code from a third-party GPL or AGPL project: it would block the dual
  licensing. `node scripts/licenses.mjs --check` checks dependencies.

### Code rules

- User-facing text is written **in French** in the code, wrapped in `tl('…')`, with its English
  translation in `src/i18n/en.js`. No displayed text may be missing in English.
- Every new source file starts with the SPDX header shown above.
- Comments explain *why*, in French like the rest of the code.
- Checker codes (`J0301`…) never change meaning: add new ones, never reuse.
- A new part follows “Ajouter un composant” in docs/GUIDE.md and must pass
  `node --test src/sim/autowire.test.mjs` (wired alone on every board, zero faults).

### Check before sending

Run the commands in the French section above: all tests, the lab exercises, both builds and the
licence check.

### Pro edition

Pro modules live in a separate private repository; the public repository builds without them. A
contribution to the public repository must not depend on Pro code.
