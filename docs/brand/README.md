# Identité visuelle

| Fichier | Usage |
|---|---|
| `logo-dark.svg` | Logo sur fond sombre (« Jollof » clair, « Studio » bleu) |
| `logo-light.svg` | Logo sur fond clair (« Jollof » bleu nuit, « Studio » bleu) |
| `icon.svg` | Icône 1024 × 1024, tuile au gabarit macOS (source de `icon.icns`) |
| `icon-windows.svg` | Même icône, marge réduite (PNG et `icon.ico` pour Windows et Linux) |
| `../../public/favicon.svg` | Icône du navigateur (tuile seule) |
| `../../src/ui/brand.js` | Logo et icône de la barre d’application, aux couleurs du thème |

Le logo écrit « Jollof Studio » en pistes de circuit imprimé : traits de largeur constante, angles
coupés à 45°, une pastille de soudure au départ du J et sur le i. La piste du dernier « o » allume
une LED. L’icône reprend le J du logo, sa queue terminée par la LED allumée.

## Couleurs

| Rôle | Valeur |
|---|---|
| Bleu de l’entreprise (accent de l’interface) | `#3b82f6` |
| Bleu soutenu (fonds pleins sous un texte blanc) | `#2563eb` |
| Bleu nuit (tuile de l’icône, logo sur fond clair) | `#0f1d4a` → `#2050c8` |
| LED allumée | `#22d3ee` |

Dans l’interface, ces couleurs passent par les variables de `src/styles.css` (`--accent`,
`--accent-hi`, `--accent-fill`, `--accent-soft`).

## Retoucher le logo

Tout est dessiné par `scripts/brand.mjs` (lettres, pistes, LED, icône). Après une retouche :

```sh
node scripts/brand.mjs
```

Puis, pour les icônes de l’application (dans un dossier temporaire, car `tauri icon` crée aussi des
icônes Android et iOS dont le projet n’a pas besoin) :

```sh
npx tauri icon docs/brand/icon-windows.svg -o /tmp/ic-win   # PNG, Square*Logo, icon.ico, icon.png
npx tauri icon docs/brand/icon.svg -o /tmp/ic-mac           # icon.icns
```

Copier dans `src-tauri/icons/` les fichiers déjà présents : `icon.icns` depuis `/tmp/ic-mac`, tous les
autres depuis `/tmp/ic-win`.
