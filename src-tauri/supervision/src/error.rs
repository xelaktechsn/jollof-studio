// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Erreurs de la supervision : chaque chemin faillible en rend une, avec un texte lisible.
use core::fmt;
use maisa_core::ConfigError;

/// Erreur de configuration, de commande ou de défaut injecté.
#[derive(Debug, Clone, PartialEq)]
pub enum SupervisionError {
    /// Plus de canaux que la capacité fixe du moniteur.
    TooManyChannels { given: usize, max: usize },
    /// Deux canaux portent le même identifiant.
    DuplicateChannel(String),
    /// Un canal a un paramètre invalide.
    Channel { id: String, reason: String },
    /// Un réglage global est invalide.
    Config(String),
    /// Aucune supervision n'est configurée.
    NotConfigured,
    /// Action de l'opérateur sans effet possible dans l'état courant : refusée, avec la raison.
    Rejected(String),
    /// Défaut inconnu.
    UnknownFault(u32),
    /// Défaut mal décrit.
    InvalidFault(String),
    /// Commande ou arguments illisibles.
    BadRequest(String),
}

impl fmt::Display for SupervisionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooManyChannels { given, max } => {
                write!(f, "too many channels: {given} configured, at most {max}")
            }
            Self::DuplicateChannel(id) => write!(f, "duplicate channel id \"{id}\""),
            Self::Channel { id, reason } => write!(f, "channel \"{id}\": {reason}"),
            Self::Config(m) => write!(f, "configuration: {m}"),
            Self::NotConfigured => write!(f, "supervision is not configured"),
            Self::Rejected(m) => write!(f, "rejected: {m}"),
            Self::UnknownFault(id) => write!(f, "no fault with id {id}"),
            Self::InvalidFault(m) => write!(f, "invalid fault: {m}"),
            Self::BadRequest(m) => write!(f, "bad request: {m}"),
        }
    }
}

impl std::error::Error for SupervisionError {}

/// Texte d'une erreur de configuration de `maisa-core`.
pub fn config_reason(e: ConfigError) -> String {
    match e {
        ConfigError::Rate => "alpha must be finite and strictly positive".into(),
        ConfigError::InitialValue => "initial value must be within [0, z_max]".into(),
        ConfigError::Cap => "z_max must be strictly positive".into(),
        ConfigError::Thresholds => {
            "thresholds must satisfy 0 <= z_exit < z_enter <= z_crit <= z_max".into()
        }
        ConfigError::Duration => "durations must be finite and strictly positive".into(),
        ConfigError::GuardBand => "guard band must be finite and non-negative".into(),
        other => format!("{other:?}"),
    }
}
