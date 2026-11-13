// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Injection de défauts, pour la démonstration.
//!
//! Un défaut agit sur la **copie des valeurs observées** que reçoit la supervision, jamais sur le circuit simulé :
//! le montage continue de fonctionner comme avant, seul ce que « voit » le moniteur change. C'est un défaut de
//! mesure ou d'observation, pas un défaut de l'installation simulée. Tout est daté en temps simulé : la même suite
//! d'instants redonne exactement les mêmes valeurs.
use crate::error::SupervisionError;
use crate::signals::SignalSnapshot;
use serde::{Deserialize, Serialize};

/// Nombre maximal de défauts actifs.
pub const MAX_FAULTS: usize = 32;

/// Un défaut à injecter sur un signal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FaultSpec {
    /// Signal figé : à `value`, ou à sa valeur au moment de l'activation.
    Stuck {
        signal: String,
        #[serde(default)]
        value: Option<f64>,
    },
    /// Décalage et dérive : `y + bias + drift × (t − t0)`.
    Offset {
        signal: String,
        bias: f64,
        #[serde(default)]
        drift: f64,
    },
    /// Rafales : `y + bias` pendant `t_on` secondes, puis rien pendant `t_off`, et ainsi de suite.
    Burst {
        signal: String,
        bias: f64,
        t_on: f64,
        t_off: f64,
    },
    /// Perte du capteur : le signal manque (il n'est pas remplacé par zéro).
    Loss { signal: String },
    /// Actionneur bloqué, vu de la supervision : le signal observé reste à sa valeur du moment de l'activation,
    /// quelle que soit la commande (pour le canal de relation). L'actionneur simulé, lui, n'est pas touché.
    StuckActuator { signal: String },
}

impl FaultSpec {
    /// Signal visé.
    pub fn signal(&self) -> &str {
        match self {
            Self::Stuck { signal, .. }
            | Self::Offset { signal, .. }
            | Self::Burst { signal, .. }
            | Self::Loss { signal }
            | Self::StuckActuator { signal } => signal,
        }
    }

    fn validate(&self) -> Result<(), SupervisionError> {
        let bad = |m: &str| Err(SupervisionError::InvalidFault(m.to_string()));
        if self.signal().trim().is_empty() {
            return bad("no signal");
        }
        match self {
            Self::Stuck { value: Some(v), .. } if !v.is_finite() => bad("value must be finite"),
            Self::Offset { bias, drift, .. } if !(bias.is_finite() && drift.is_finite()) => {
                bad("bias and drift must be finite")
            }
            Self::Burst {
                bias, t_on, t_off, ..
            } if !(bias.is_finite()
                && t_on.is_finite()
                && *t_on > 0.0
                && t_off.is_finite()
                && *t_off > 0.0) =>
            {
                bad("bias must be finite, t_on and t_off finite and strictly positive")
            }
            _ => Ok(()),
        }
    }
}

/// Un défaut actif : sa description, l'instant simulé de sa première application, la valeur figée.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActiveFault {
    pub id: u32,
    #[serde(flatten)]
    pub spec: FaultSpec,
    /// Temps simulé de la première application (absent tant que la simulation n'a pas avancé depuis l'ajout).
    pub since: Option<f64>,
    #[serde(skip)]
    held: Option<f64>,
}

/// Défauts actifs, appliqués dans l'ordre de leur ajout.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FaultInjector {
    faults: Vec<ActiveFault>,
    next_id: u32,
}

impl FaultInjector {
    /// Ajoute un défaut ; rend son identifiant.
    pub fn add(&mut self, spec: FaultSpec) -> Result<u32, SupervisionError> {
        spec.validate()?;
        if self.faults.len() >= MAX_FAULTS {
            return Err(SupervisionError::InvalidFault(format!(
                "at most {MAX_FAULTS} active faults"
            )));
        }
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        self.faults.push(ActiveFault {
            id,
            spec,
            since: None,
            held: None,
        });
        Ok(id)
    }

    /// Retire un défaut.
    pub fn clear(&mut self, id: u32) -> Result<(), SupervisionError> {
        let n = self.faults.len();
        self.faults.retain(|f| f.id != id);
        if self.faults.len() == n {
            Err(SupervisionError::UnknownFault(id))
        } else {
            Ok(())
        }
    }

    /// Retire tous les défauts.
    pub fn clear_all(&mut self) {
        self.faults.clear();
    }

    /// Défauts actifs.
    pub fn list(&self) -> &[ActiveFault] {
        &self.faults
    }

    /// Applique les défauts aux valeurs observées (`values` est parallèle à `snapshot.signals`) au temps simulé `t`.
    /// Un défaut dont le signal est absent de l'instantané ne fait rien. Aucune allocation.
    pub fn apply(&mut self, t: f64, snapshot: &SignalSnapshot, values: &mut [Option<f64>]) {
        if !t.is_finite() {
            return;
        }
        for f in &mut self.faults {
            let Some(i) = snapshot.index_of(f.spec.signal()) else {
                continue;
            };
            let Some(slot) = values.get_mut(i) else {
                continue;
            };
            let t0 = *f.since.get_or_insert(t);
            match &f.spec {
                FaultSpec::Stuck { value, .. } => {
                    if f.held.is_none() {
                        f.held = value.or(*slot);
                    }
                    if f.held.is_some() {
                        *slot = f.held;
                    }
                }
                FaultSpec::StuckActuator { .. } => {
                    if f.held.is_none() {
                        f.held = *slot;
                    }
                    if f.held.is_some() {
                        *slot = f.held;
                    }
                }
                FaultSpec::Offset { bias, drift, .. } => {
                    if let Some(v) = slot {
                        *v += bias + drift * (t - t0);
                    }
                }
                FaultSpec::Burst {
                    bias, t_on, t_off, ..
                } => {
                    let phase = (t - t0) % (t_on + t_off);
                    if phase < *t_on {
                        if let Some(v) = slot {
                            *v += bias;
                        }
                    }
                }
                FaultSpec::Loss { .. } => *slot = None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(inj: &mut FaultInjector, t: f64, y: f64) -> Option<f64> {
        let snap = SignalSnapshot::from_pairs(&[("y", y), ("other", 7.0)]);
        let mut vals: Vec<Option<f64>> = snap.signals.iter().map(|s| s.value).collect();
        inj.apply(t, &snap, &mut vals);
        assert_eq!(vals[1], Some(7.0), "un autre signal n'est jamais touché");
        vals[0]
    }

    #[test]
    fn stuck_at_current_or_given_value() {
        let mut inj = FaultInjector::default();
        inj.add(FaultSpec::Stuck {
            signal: "y".into(),
            value: None,
        })
        .unwrap();
        assert_eq!(run(&mut inj, 1.0, 3.0), Some(3.0));
        assert_eq!(run(&mut inj, 2.0, 9.0), Some(3.0));
        let mut inj = FaultInjector::default();
        inj.add(FaultSpec::Stuck {
            signal: "y".into(),
            value: Some(0.5),
        })
        .unwrap();
        assert_eq!(run(&mut inj, 1.0, 3.0), Some(0.5));
    }

    #[test]
    fn offset_drift_burst_loss() {
        let mut inj = FaultInjector::default();
        inj.add(FaultSpec::Offset {
            signal: "y".into(),
            bias: 1.0,
            drift: 0.5,
        })
        .unwrap();
        assert_eq!(run(&mut inj, 10.0, 5.0), Some(6.0));
        assert_eq!(run(&mut inj, 14.0, 5.0), Some(8.0));
        let mut inj = FaultInjector::default();
        inj.add(FaultSpec::Burst {
            signal: "y".into(),
            bias: 2.0,
            t_on: 1.0,
            t_off: 3.0,
        })
        .unwrap();
        assert_eq!(run(&mut inj, 0.0, 5.0), Some(7.0));
        assert_eq!(run(&mut inj, 0.9, 5.0), Some(7.0));
        assert_eq!(run(&mut inj, 1.0, 5.0), Some(5.0));
        assert_eq!(run(&mut inj, 3.9, 5.0), Some(5.0));
        assert_eq!(run(&mut inj, 4.5, 5.0), Some(7.0));
        let mut inj = FaultInjector::default();
        let id = inj.add(FaultSpec::Loss { signal: "y".into() }).unwrap();
        assert_eq!(run(&mut inj, 0.0, 5.0), None);
        inj.clear(id).unwrap();
        assert_eq!(run(&mut inj, 1.0, 5.0), Some(5.0));
        assert_eq!(inj.clear(id), Err(SupervisionError::UnknownFault(id)));
    }

    #[test]
    fn reproducible_and_validated() {
        let seq = |inj: &mut FaultInjector| {
            (0..50)
                .map(|k| run(inj, k as f64 * 0.1, 1.0))
                .collect::<Vec<_>>()
        };
        let mk = || {
            let mut i = FaultInjector::default();
            i.add(FaultSpec::Burst {
                signal: "y".into(),
                bias: 1.0,
                t_on: 0.3,
                t_off: 0.7,
            })
            .unwrap();
            i.add(FaultSpec::Offset {
                signal: "y".into(),
                bias: 0.0,
                drift: 0.2,
            })
            .unwrap();
            i
        };
        assert_eq!(seq(&mut mk()), seq(&mut mk()));
        let mut inj = FaultInjector::default();
        assert!(inj
            .add(FaultSpec::Burst {
                signal: "y".into(),
                bias: 1.0,
                t_on: 0.0,
                t_off: 1.0
            })
            .is_err());
        assert!(inj
            .add(FaultSpec::Offset {
                signal: "y".into(),
                bias: f64::NAN,
                drift: 0.0
            })
            .is_err());
        assert!(inj.add(FaultSpec::Loss { signal: " ".into() }).is_err());
        // Signal absent de l'instantané : le défaut ne fait rien.
        inj.add(FaultSpec::Loss {
            signal: "absent".into(),
        })
        .unwrap();
        assert_eq!(run(&mut inj, 0.0, 5.0), Some(5.0));
    }
}
