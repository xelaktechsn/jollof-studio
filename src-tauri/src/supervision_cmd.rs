// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Supervision MA-ISA : la couche Tauri, volontairement fine. Une seule commande transmet le nom et les arguments
//! à `jollof_supervision::api::Session::handle`, où vit toute la logique (sans type de Tauri). La simulation tourne
//! dans la fenêtre : à chaque pas terminé elle envoie l'instantané de ses signaux et reçoit la trame de supervision.
use jollof_supervision::api::Session;
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

/// Session de supervision de la fenêtre.
#[derive(Default)]
pub struct Supervision(Mutex<Session>);

/// Commande de supervision (`configure`, `step`, `operator`, `fault_add`, `fault_clear`, `fault_clear_all`,
/// `fault_list`, `validate`, `design`, `stop`). Toute erreur revient en texte lisible.
#[tauri::command]
pub fn supervision(
    state: State<'_, Supervision>,
    cmd: String,
    args: Value,
) -> Result<Value, String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "supervision state is unavailable".to_string())?;
    session.handle(&cmd, &args).map_err(|e| e.to_string())
}
