// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Évite l'ouverture d'une console en plus de la fenêtre sous Windows, en version finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jollof_studio_lib::run()
}
