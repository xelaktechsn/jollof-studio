// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Composants standard décrits en paquet (.jpart, manifeste seul) : livrés avec l'application dans
// src/library/standard, installés au démarrage dans leur catégorie (Capteurs…), comme ceux de la bibliothèque.
// Les tests sous Node lisent le même dossier (import.meta.glob n'existe que dans Vite).
export const STANDARD = Object.values(import.meta.glob('./standard/*.json', { eager: true, import: 'default' }));
