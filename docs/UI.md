# Règles d’interface

Les règles que suit déjà l’interface la plus aboutie (la coquille de `src/ui/shell.js` et le module réseau). Elles ne
définissent pas un nouveau dessin : elles disent quel jeton, quelle classe commune et quel comportement employer, pour
que les plans de travail se ressemblent. Tout vient de `src/styles.css` (jetons en tête de fichier, composants communs)
et de `src/school/school.css` (boîtes de dialogue, menus, notifications). Accessibilité : [ACCESSIBILITY.md](ACCESSIBILITY.md).

Trois principes :

1. **Un jeton, jamais une valeur.** Couleur, rayon, hauteur de contrôle, police : `var(--…)`. Une couleur écrite en dur
   casse le thème clair.
2. **Une classe commune avant une règle de module.** Un module ne redessine pas un bouton, un onglet ou un champ : il
   prend la classe commune et ne fixe que son écart (une hauteur, une marge), avec un commentaire qui le dit.
3. **Un espace de noms par module** (`nt*` réseau, `pn*` pneumatique, `lg*` logique, `pl*` automate, `ed*`/`dk*`/`cp*`
   coquille). Les feuilles de l’édition Pro possèdent `.studio` et `st*` : on n’y touche pas, et toute interface nouvelle
   se vérifie dans WebKit avec les feuilles Pro chargées.

## Jetons

| Rôle | Jetons |
|---|---|
| Surfaces, du fond vers l’avant | `--bg` (fond, champs) · `--stage` (plan de travail) · `--panel`, `--panel-2` (panneaux, en-têtes) · `--raise`, `--raise-2` (survol, choisi) · `--menu`, `--tip`, `--glass`, `--overlay` (flottants) · `--backdrop` (voile des boîtes) |
| Traits | `--line` (séparations) · `--line-2` (bord des contrôles et des flottants) · `--line-3` (bord au survol) |
| Texte | `--fg` (principal) · `--fg-2` (secondaire) · `--muted` (légendes, étiquettes ; 4,5:1 au moins sur toutes les surfaces) |
| Accent | `--accent` (#3b82f6, bleu Xelaktech : icône active, filet, focus) · `--accent-hi` (texte d’accent sur fond sombre ou teinté) · `--accent-soft` (fond teinté) · `--accent-fill`, `--accent-fill-hi` (fond plein sous un texte `--accent-ink`) |
| États | `--ok`, `--warn`, `--danger`, `--info` (pastilles, icônes, bords) · `--ok-ink`, `--warn-ink`, `--danger-ink` (les mêmes en texte) |
| Reflets | `--hi-0` … `--hi-3` (voiles clairs en sombre, sombres en clair) |
| Formes | `--r` 8 px (cartes) · `--r-sm` 6 px (boutons, champs) · `--ctl` 32 px (hauteur d’un contrôle) · `--shadow` (flottants) |
| Polices | `--sans` (Instrument Sans) · `--mono` (JetBrains Mono : valeurs, broches, code, compteurs) |

Le bleu d’accent ne sert pas de couleur de texte sur un fond teinté d’accent (`--accent` sur `--accent-soft` ne passe
pas 4,5:1) : texte en `--accent-hi` ou `--fg`. Les couleurs de plan (vert de la logique `--lg1`, bleu de l’air `--pnP`,
catégories de câbles `--nt-*`) ne colorent que l’icône du plan et son dessin, jamais un contrôle.

## Espacements

Échelle : **2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 24** px.

- dans un contrôle (icône et libellé) : 6 ou 7 ; entre deux boutons d’une barre : 2 ; entre deux groupes : 8 ;
- section d’inspecteur : `padding: 14px 16px`, `gap: 10px`, filet `--line` entre deux sections ;
- en-tête de panneau (`.phead`) : `14px 16px 10px` ; pied (`.pfoot`) : `10px 12px` ;
- boîte de dialogue : 16 à 18 px de marge intérieure, 8 px entre les boutons du pied ;
- barres flottantes du plan de travail : à 12 px des bords.

Rayons : 6 (contrôles) · 7 (onglets en pastille, lignes de menu) · 9 (groupe de segments) · 11 (menus, notifications) ·
16 (boîtes de dialogue) · 999 (pastilles, puces).

## Typographie

Base : `13px/1.45 var(--sans)`. Graisses : 500 pour un contrôle, 600 pour un titre, 700 seulement pour une étiquette
de niveau.

| Usage | Dessin |
|---|---|
| Titre de boîte de dialogue | 16 px, 600 |
| Titre d’objet choisi, de carte | 14 à 15 px, 600 |
| Texte, boutons, onglets des plans | 13 px |
| Onglets en pastille, champs d’inspecteur, notes | 12 à 12,5 px |
| Étiquette de section (`h2` de panneau, `.cap`, `h4` d’inspecteur) | 11 px, 600, capitales, interlettrage .06 à .08em, `--muted` |
| Compteurs, valeurs, raccourcis | `--mono`, 10,5 à 12 px |

Pas de texte sous 10 px. Phrases en capitale initiale seulement (« Enregistrer sous… », pas « Enregistrer Sous »).

## Boutons

| Classe | Emploi |
|---|---|
| `.btn` | action dans un panneau ou une boîte ; `.primary` pour **la** suite attendue (une seule par vue), `.danger` pour détruire, `.subtle` (pointillé) pour une action secondaire ou d’import, `.small` (26 px) dans une ligne, `.icon` sans libellé, `.wide` sur toute la largeur |
| `.tb` | bouton de barre (application, barres flottantes `.glass`, en-têtes) : transparent, fond au survol ; `.label` quand il porte un texte |
| `.seg` + `.segBtn` | choix exclusif ou bascules groupées, état par `aria-pressed` |
| `.iconBtn` | fermeture et actions d’en-tête des boîtes de dialogue |

- État actif d’une bascule : `aria-pressed="true"` (bord et texte d’accent sur `.btn`, fond `--raise-2` sur `.segBtn`).
  Jamais une classe seule : l’état doit se lire sans la couleur.
- **Segments d’outil** : quand le groupe choisit ce que fera le prochain clic (outil, mode, plan de travail), le
  segment choisi prend le fond `--accent-soft` et un filet d’accent (`.seg.pick`, et les sélecteurs existants nommés dans
  `styles.css`). Un groupe qui règle seulement l’affichage garde `--raise-2`.
- Un bouton sans libellé visible porte `aria-label` et `data-tip` (l’infobulle n’est pas un nom).
- **Libellé retiré faute de place** : on le masque à la vue, pas aux lecteurs d’écran — le motif de `.sr`
  (`position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)`), jamais `display: none`.
- Désactivé : attribut `disabled` (opacité .45, curseur interdit), pas une classe.

## Onglets

Trois niveaux, trois dessins ; on ne les mélange pas.

| Niveau | Classe | Dessin |
|---|---|---|
| Plans de travail (Montage 3D, Schéma, Code, Logique, Pneumatique, Réseau) | `.edTab` | onglet d’éditeur, 36 px, filet d’accent en haut, se fond dans le plan |
| Vues dans un plan ou un panneau (vues du réseau, Conception, étages, panneau du bas) | `.pillTab` (`.ntVTab`, `.dkTab`…) | pastille 28 px, rayon 7, choisi : `--panel-2` et filet d’accent en bas |
| Inspecteur | `.tab` | 46 px, filet d’accent sous l’onglet choisi ; inspecteur étroit : seul l’onglet choisi garde son libellé |

Toujours `role="tablist"` (qui ne contient **que** des onglets : les boutons voisins vont à côté), `role="tab"`,
`aria-selected`, `aria-controls` vers un `role="tabpanel"` existant, `tabindex="0"` sur le seul onglet choisi, flèches
gauche et droite pour passer de l’un à l’autre.

## Champs

- `.sel` (liste) et `.inp` (saisie) : hauteur `--ctl`, fond `--bg`, bord `--line-2`, rayon `--r-sm`. En inspecteur ou en
  grille de propriétés : 26 à 28 px (le module ne fixe que la hauteur).
- `.field` : étiquette au-dessus (12 px, `--fg-2`), `.fh` pour l’étiquette et sa valeur (`output` en `--mono`).
- `.search` : champ de recherche avec loupe ; `.check` : case et libellé ; `.switch` : interrupteur.
- `.sField` + `.sInput` : champs des boîtes de dialogue.
- Tout champ a un nom : `<label>`, ou `aria-label` quand l’étiquette est une icône. L’exemple (`placeholder`) n’est pas
  une étiquette.
- Focus : bord d’accent et halo `0 0 0 3px var(--accent-soft)` pour un champ de texte, cadre du clavier pour le reste.
- Erreur : bord `--danger` et message en `--danger-ink` sous le champ, pas la couleur seule.

## Panneaux et inspecteurs

- `.panel` (gauche : bibliothèque ; droite : inspecteur) : `.phead` (titre `h2` et actions), contenu qui défile, `.pfoot`.
- L’inspecteur est fait de `section` dans un `.pane` ; `.secHead` aligne le titre (`h2`, avec icône de 14 px) et ses
  actions. Une section repliable porte `data-fold` : `src/ui/inspector.js` y ajoute le chevron et le bouton, et retient
  l’état.
- Sous-sections des modules : étiquette `.cap` (ou le `h4` des sections `.ntSec`, `.lgPins`, `.pnSeq`).
- Un objet choisi s’annonce toujours de la même façon : icône, nom (`b` ou `h3`), type en `small` `--muted`.
- Largeur et hauteurs se règlent par des poignées `role="separator"` focalisables (flèches, double-clic : valeur d’origine).

## Menus

- Menu d’un bouton : `.abMenu` (barre d’application, `src/ui/appbar.js`) ou `menu()` de `src/school/ui.js` (`.sMenu`) ;
  barre de menus du réseau : `src/net/ui/menubar.js`. Fond `--menu`, bord `--line-2`, rayon 11, lignes de 34 px au
  rayon 7, icône de 15 px à gauche, raccourci (`kbd`) à droite, `hr` entre les groupes.
- `role="menu"` et `role="menuitem"` (ou `menuitemradio` avec `aria-checked`) ; le bouton porte `aria-haspopup="menu"`
  et `aria-expanded`.
- Clavier : flèches, Début, Fin ; Échap ferme et rend le focus au bouton ; Tab ferme.
- Une action destructrice vient en dernier, après un filet, en `--danger-ink`.

## Boîtes de dialogue

- Une seule fabrique pour une boîte nouvelle : `dialog()` de `src/school/ui.js` (`.sDialog` : titre de 16 px, croix
  `.iconBtn`, corps `.sBody`, pied aux boutons alignés à droite, `confirm()` et `ask()` pour les cas courants). Les
  fenêtres de `index.html` (`.modal` > `.sheet`) ont le même rayon, le même titre et le même voile.
- `role="dialog"`, `aria-modal="true"`, un nom (`aria-labelledby` vers le titre).
- Pied : « Annuler » à gauche de l’action ; l’action attendue en `.primary`, la destruction en `.danger`. Le libellé dit
  l’action (« Supprimer la baie »), pas « OK ».
- Échap et un clic sur le voile ferment sans rien appliquer ; Entrée dans un champ valide l’action principale.
- Focus : premier champ à l’ouverture, retenu dans la boîte, rendu au bouton d’origine à la fermeture (`src/ui/a11y.js`
  le fait pour toute boîte modale).

## Notifications

- `toast(texte, 'ok' | 'warn' | 'err')` de `src/school/ui.js` : en bas à droite, 3,8 s, une phrase, sans bouton.
  Région `role="status"` : le texte est annoncé sans prendre le focus.
- Ce qui demande une décision n’est pas une notification : boîte de dialogue, ou carte persistante (mise à jour).
- L’état courant (« Projet ouvert », simulation) va dans la barre d’état ; le journal dans le panneau du bas (`app.log`).

## Icônes

- Toutes dans `src/ui/icons.js`, trait de 1,8, `currentColor` ; 16 px par défaut, 15 dans un onglet ou un menu, 14 dans
  un petit bouton ou un titre de section. Décoratives (`aria-hidden`) : le nom vient du bouton.
- **Une icône, un sens.** `sparkle` : l’assistant IA, rien d’autre. `wand` : calcul automatique (câblage, génération,
  détection). `play` / `stop` : simulation. `check` : vérificateur et validation. `alert` : problème. `help` : fiche
  d’un composant. `book` : documentation. `checklist` : TP. `trash` : supprimer. `x` : fermer. `plus` : ajouter.
  `upload` / `download` : importer, exporter. Avant d’en dessiner une, chercher celle qui porte déjà ce sens.
- Pas d’émoji ni de caractère en guise d’icône (sauf `•` de document modifié et `›` de fil d’Ariane).

## Focus

- Le cadre du focus ne s’affiche qu’au clavier : `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`
  (règle globale). Dans un conteneur qui rogne : `outline-offset: -2px`. Jamais `outline: none` sans autre marque
  visible.
- Un onglet ou un outil cliqué à la souris rend le focus au plan de travail (`releaseTabFocus`, `shell.js`) : Espace et
  Entrée restent des raccourcis du plan.
- Ordre de tabulation : celui de l’écran, de gauche à droite et de haut en bas ; pas de `tabindex` positif.

## États vides

- Panneau ou vue sans contenu : `.emptyState` (ou `empty()` de `src/school/ui.js`) — icône d’accent, un titre court en
  gras, une phrase en `--muted` qui dit quoi faire, puis **une** action (`.btn`), au plus deux.
- Liste vide dans une section : une ligne `.empty` (12 px, `--muted`), sans icône.
- Plan de travail vide : des cartes d’action au centre (exemple, TP, premier composant), jamais une zone muette.
- Recherche sans résultat : le dire, et proposer d’effacer la recherche.

## Mouvement

Transitions de 120 à 180 ms (`fadeIn`, `sheetIn`), sans rebond. `prefers-reduced-motion: reduce` coupe toutes les
animations et transitions de l’interface (règle globale de `styles.css`) ; les simulations, qui sont le contenu, restent
animées.

## Avant de livrer une interface

1. Thèmes sombre et clair, dans WebKit, édition Pro chargée (`npm run dev:pro`).
2. Tout au clavier : Tab atteint chaque contrôle, Échap ferme, le focus revient.
3. Fenêtre de 1180 px de large : les libellés se retirent sans que les boutons perdent leur nom.
4. Aucune couleur en dur, aucune classe hors de l’espace de noms du module, aucune règle qui redessine un composant commun.
