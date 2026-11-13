// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Évite l'ouverture d'une console en plus de la fenêtre sous Windows, en version finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `jollof-studio --mcp [édition]` : relais stdio du protocole MCP vers l'application ouverte (assistants IA).
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--mcp") {
        return jollof_studio_lib::ai::stdio_proxy(args.next());
    }
    jollof_studio_lib::run()
}
