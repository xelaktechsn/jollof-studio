// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Supervision MA-ISA d'un circuit simulé par Jollof Studio.
//!
//! Ce module observe : il lit à chaque pas les signaux de la simulation, en tire une entrée d'anomalie par canal,
//! et confie tout le calcul (accumulateurs, hystérésis, machine d'états, verrou, moteur d'intervention) à la caisse
//! publiée `maisa-core`, utilisée telle quelle. Il ne modifie jamais le circuit simulé.
//!
//! Aucun type de Tauri ni de l'interface ici : la couche de commandes (`src-tauri/src/supervision_cmd.rs`) et le pont
//! de développement (`examples/bridge.rs`) passent tous deux par [`api::handle`].
//!
//! Ce n'est pas un système de sécurité certifié : c'est une démonstration pédagogique sur un circuit simulé.
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

pub mod api;
pub mod channels;
pub mod config;
pub mod design;
pub mod error;
pub mod faults;
pub mod frame;
pub mod signals;
pub mod supervisor;

pub use config::{
    AccParams, ChannelDef, ChannelKind, EngineConfig, SupervisionConfig, MAX_ATTEMPTS, MAX_CHANNELS,
};
pub use error::SupervisionError;
pub use faults::{FaultInjector, FaultSpec};
pub use frame::{Event, SupervisionFrame};
pub use signals::{Signal, SignalSnapshot};
pub use supervisor::{OperatorAction, Supervisor};
