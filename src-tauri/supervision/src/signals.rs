// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Instantané des signaux d'un pas de simulation, indépendant de Tauri.
//!
//! Un signal absent de l'instantané, sans valeur ou de valeur non finie est **invalide** : il n'est jamais
//! remplacé par zéro ni par une valeur par défaut.
use serde::{Deserialize, Serialize};

/// Un signal : identifiant (« UNO.D7 », « B2.pressed », « 1A.x »…) et valeur, absente si la mesure manque.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signal {
    pub id: String,
    #[serde(default)]
    pub value: Option<f64>,
}

/// Les signaux d'un pas terminé de la simulation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct SignalSnapshot {
    pub signals: Vec<Signal>,
}

impl SignalSnapshot {
    /// Instantané à partir de paires (identifiant, valeur).
    pub fn from_pairs(pairs: &[(&str, f64)]) -> Self {
        Self {
            signals: pairs
                .iter()
                .map(|(id, v)| Signal {
                    id: (*id).to_string(),
                    value: Some(*v),
                })
                .collect(),
        }
    }

    /// Rang d'un signal.
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.signals.iter().position(|s| s.id == id)
    }
}

/// Valeur valide d'un signal dans `values` (tableau parallèle à l'instantané, après injection de défauts) :
/// `None` si le signal manque ou n'est pas fini.
pub fn valid_value(snapshot: &SignalSnapshot, values: &[Option<f64>], id: &str) -> Option<f64> {
    let i = snapshot.index_of(id)?;
    values.get(i).copied().flatten().filter(|v| v.is_finite())
}
