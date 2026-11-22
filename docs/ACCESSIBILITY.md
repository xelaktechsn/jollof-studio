# Accessibilité

Ce qui est couvert, comment c’est vérifié, et ce qui ne l’est pas encore. Règles d’interface : [UI.md](UI.md).

## Ce qui est couvert

- **Contraste** : texte à 4,5:1 au moins sur toutes les surfaces, en sombre et en clair. `--muted` a été ajusté pour
  tenir sur `--raise-2` ; le bleu d’accent en texte sur fond teinté passe par `--accent-hi` ; les couleurs de syntaxe du
  thème clair ont été foncées ; les cartes (`--card`) suivent le thème clair.
- **Noms** : chaque bouton a un nom, même réduit à son icône quand la place manque (libellé masqué à la vue, pas aux
  lecteurs d’écran) ; les boîtes de dialogue sont nommées par leur titre ; les plans de travail dessinés (canvas 3D,
  schémas SVG) portent un nom ; la page a un titre de niveau 1.
- **Rôles** : listes d’onglets qui ne contiennent que des onglets (`aria-selected`, `aria-controls` valides), menus
  (`role="menu"`, `menuitem`, `menuitemradio`), sections repliables (bouton avec `aria-expanded`), poignées de partage
  (`role="separator"` avec valeur), notifications (`role="status"`), un seul bandeau et un seul contenu principal.
- **Clavier** :
  - onglets des plans, de l’inspecteur, des vues du réseau : Tab jusqu’à l’onglet choisi, flèches pour changer ;
  - menus (projet, type de projet, menus contextuels, barre de menus du réseau) : Entrée ouvre, flèches, Début, Fin,
    Échap ferme et rend le focus au bouton, Tab ferme ;
  - boîtes de dialogue (accueil, TP, documentation, export, assistants) : le focus y entre, Tab et Maj+Tab y restent,
    Échap ferme, le focus revient au bouton d’origine (`src/ui/a11y.js`, pour toute boîte `aria-modal`) ;
  - palette de commandes (Ctrl+Maj+P ou F1) : toute action enregistrée, pose d’un composant, ouverture d’un exemple ou
    d’un TP, par son nom ;
  - poignées de largeur et de hauteur : flèches ; interrupteurs (`.switch`) : atteignables et marqués au focus.
- **Focus visible** au clavier seulement (`:focus-visible`), jamais supprimé sans autre marque.
- **Mouvement réduit** : `prefers-reduced-motion: reduce` coupe les animations et transitions de l’interface.
- **Site d’aide** (`site/aide/`) : lien d’évitement, sommaire en `nav`, recherche étiquetée avec résultats annoncés
  (`aria-live`), navigation des résultats aux flèches ; aucune violation axe.

## Vérification

axe-core 4.10 (règles WCAG 2.0 et 2.1 A et AA, plus les bonnes pratiques), dans WebKit (Playwright), sur le serveur de
développement de l’édition Pro, thèmes sombre et clair. axe-core (MPL-2.0) n’est pas une dépendance du projet : l’audit
le charge depuis un dossier de travail. Nombre d’éléments en infraction par écran :

| Écran | Avant, sombre | Avant, clair | Après, sombre | Après, clair |
|---|---|---|---|---|
| Accueil | 19 | 24 | 0 | 0 |
| Électronique, projet vide | 16 | 22 | 0 | 0 |
| Montage 3D (TP ouvert) | 15 | 17 | 0 | 0 |
| Schéma | 12 | 14 | 0 | 0 |
| Code | 16 | 36 | 0 | 0 |
| Pneumatique, vide | 3 | 3 | 0 | 0 |
| Pneumatique (tutoriel ouvert) | 15 | 18 | 0 | 0 |
| Logique, vide | 5 | 5 | 0 | 0 |
| Logique (TP ouvert) | 5 | 5 | 0 | 0 |
| Réseau, vide | 9 | 12 | 0 | 0 |
| Réseau, vue logique | 9 | 9 | 0 | 0 |
| Réseau, plans | 8 | 8 | 0 | 0 |
| Réseau, baies | 6 | 11 | 0 | 0 |
| Réseau, conception | 6 | 6 | 0 | 0 |
| Bibliothèque des TP (boîte) | 26 | 70 | 0 | 0 |
| Menu du projet | 15 | 17 | 0 | 0 |
| Palette de commandes | 15 | 17 | 0 | 0 |
| Menu du type de projet | – | – | 7 | 7 |
| Documentation (fenêtre) | – | – | 1 | 1 |
| **Total** | 200 | 294 | 8 | 8 |

Contraste : 120 éléments en échec avant (13 en sombre, 107 en clair, dont les cartes de TP restées sombres en thème clair), 0 après. Les deux derniers écrans n’avaient pas été mesurés avant ; ce qui y reste relève des bonnes pratiques (voir « Limites connues »).

Clavier, vérifié par script dans WebKit : accueil (focus retenu), menu du projet, menu du type de projet, palette,
bibliothèque des TP, documentation (focus retenu, Échap, focus rendu), sections repliables, onglets, fenêtre de
1100 px (aucun bouton visible sans nom).

Refaire l’audit après un changement d’interface : mêmes écrans, les deux thèmes, puis le parcours au clavier.

## Plans de travail dessinés

| Zone | Nom et rôle | Au clavier | Ce qui manque |
|---|---|---|---|
| Montage 3D (canvas WebGL) | `role="img"`, « Montage 3D » | vue : flèches, + et −, F (tout voir) ; ajout d’un composant par la palette ; câblage automatique (inspecteur, onglet Câblage) ; la liste des problèmes mène au composant | le contenu du canvas n’est pas décrit aux lecteurs d’écran ; placer un composant à un endroit précis, le déplacer et tirer un fil broche à broche demandent la souris |
| Schéma électrique (SVG et canvas) | `role="img"`, « Schéma électrique du montage » | déplacement de la vue aux flèches | les valeurs affichées en direct ne sont pas lues ; la même information est dans l’inspecteur (mesures, problèmes) |
| Pneumatique, Logique (SVG) | nommés, `role="group"` | outils et zoom par raccourcis (touche ? : liste), simulation et pas à pas par boutons | sélection, déplacement et liaison des éléments à la souris |
| Réseau : vue logique, plans (SVG, canvas) | nommés, `role="group"` | arbre du projet et recherche (panneau de gauche), grille de propriétés, menus, Alt+1…4 pour les vues | tracer un câble ou un mur se fait à la souris ; le plan d’étage n’a pas d’équivalent textuel hors des tableaux de Conception |
| Baies (SVG) | `role="img"`, « Élévation de la baie » | liste des équipements et tableaux à côté | glisser un équipement dans une unité précise |
| Traceur série (canvas) | nommé | — | les courbes ne sont pas décrites ; le moniteur série donne les mêmes valeurs en texte |
| Oscilloscope, modèle 3D d’une fiche, aperçus | non vérifiés | — | pas d’équivalent textuel connu |

Pourquoi : un canvas WebGL n’a pas d’arbre d’accessibilité, et l’édition spatiale (position, routage d’un fil) n’a pas
d’équivalent simple au clavier. La voie retenue est de donner chaque résultat par un autre chemin (listes, tableaux,
palette, vérificateur) plutôt que de simuler un pointeur.

## Limites connues

- **Menus contextuels** (`.sMenu`) : posés à la racine du document, hors des régions (règle axe « region », bonne
  pratique). Les déplacer dans une région changerait leur empilement au-dessus des boîtes de dialogue.
- **Fenêtre de documentation** : un saut de niveau de titre (règle « heading-order », bonne pratique).
- **macOS** : WebKit ne s’arrête sur les boutons avec Tab que si « Navigation au clavier » est activée dans les réglages
  du système (sinon Option+Tab). Les champs, listes et menus ne sont pas concernés.
- **Infobulles** (`data-tip`, en CSS) : visibles au survol et au focus du clavier, mais on ne peut ni les survoler ni
  les fermer avec Échap (WCAG 1.4.13).
- **Texte sur le canvas ou sur un fond en dégradé** : axe ne mesure pas son contraste ; non vérifié.
- **Couleur seule** : la couleur d’un fil ou d’un câble porte un sens (potentiel, catégorie) que rien d’autre ne répète
  sur le plan ; l’inspecteur et les tableaux le disent en texte.
- **Non audités** : éditeur de blocs (Blockly), atelier de composants, constructeur de machines, supervision, éditeur
  Ladder et GRAFCET, export vidéo, assistants d’import du réseau, sertissage, espace classe (Pro).
- **Lecteurs d’écran** : aucun essai avec VoiceOver ou NVDA ; les contrôles sont automatiques (axe) et au clavier.
