// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Configuration de la supervision, enregistrée avec le projet, et sa validation.
//!
//! Le nombre de canaux d'un circuit n'est connu qu'à l'exécution, alors que le moniteur de `maisa-core` a une
//! capacité fixée à la compilation. On instancie donc `Monitor<MAX_CHANNELS>` et on complète les places libres par
//! des canaux non requis, toujours invalides : ils ne produisent ni avertissement, ni événement critique, ni perte
//! de validité.
use crate::error::{config_reason, SupervisionError};
use maisa_core::design::guard_band_f64;
use maisa_core::{Accumulator, ChannelConfig, Hysteresis};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Capacité fixe du moniteur.
pub const MAX_CHANNELS: usize = 16;
/// Capacité fixe du moteur d'intervention.
pub const MAX_ATTEMPTS: usize = 8;

/// Budget d'interventions : nombre de demandes entre deux réarmements, délai entre deux demandes, délai de réponse.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EngineConfig {
    pub n_max: usize,
    pub t_cooldown: f64,
    pub t_timeout: f64,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            n_max: 3,
            t_cooldown: 2.0,
            t_timeout: 10.0,
        }
    }
}

/// Paramètres de l'accumulateur et de l'hystérésis d'un canal (ceux de `maisa_core::ChannelConfig`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AccParams {
    pub alpha: f64,
    pub z_crit: f64,
    pub z_enter: f64,
    pub z_exit: f64,
    pub t_stable: f64,
    /// Plafond de l'accumulateur ; absent : quatre fois `z_crit`.
    #[serde(default)]
    pub z_max: Option<f64>,
    /// Bande de garde ; absente : calculée par `maisa_core::design::guard_band_f64`.
    #[serde(default)]
    pub guard_band: Option<f64>,
    /// Canal requis : sa mesure invalide rend l'état `Unknown`.
    #[serde(default = "yes")]
    pub required: bool,
}

fn yes() -> bool {
    true
}

/// Ce que surveille un canal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChannelKind {
    /// Axe : un signal doit rester dans `[lo, hi]`. `p = weight × response(deviation(y, lo, hi, scale), deadband, 1)`.
    /// `hard_lo` / `hard_hi` : limites dures, évaluées tout de suite (preuve `H`), sans attendre l'accumulateur.
    Axis {
        source: String,
        lo: f64,
        hi: f64,
        scale: f64,
        #[serde(default)]
        deadband: f64,
        #[serde(default = "one")]
        weight: f64,
        #[serde(default)]
        hard_lo: Option<f64>,
        #[serde(default)]
        hard_hi: Option<f64>,
    },
    /// Relation : le signal `signal_a` doit atteindre `threshold` au plus `delay` secondes après que `signal_b`
    /// devient vrai. Passé ce délai, `p = gain × response(max(0, (threshold − a) / scale), deadband, 1)`.
    Relationship {
        signal_a: String,
        signal_b: String,
        threshold: f64,
        delay: f64,
        scale: f64,
        #[serde(default)]
        deadband: f64,
        #[serde(default = "one")]
        gain: f64,
    },
}

fn one() -> f64 {
    1.0
}

/// Un canal configuré.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelDef {
    /// Identifiant stable.
    pub id: String,
    /// Nom lisible.
    pub name: String,
    #[serde(flatten)]
    pub kind: ChannelKind,
    #[serde(flatten)]
    pub acc: AccParams,
}

/// Configuration enregistrée avec le projet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SupervisionConfig {
    /// Version du format.
    pub version: u32,
    pub enabled: bool,
    /// Plus grand pas de temps simulé accepté (s) : au-delà, le moniteur signale un défaut d'horloge.
    pub dt_max: f64,
    /// Plus petit pas de temps simulé attendu (s) : sert au calcul de la bande de garde.
    pub dt_min: f64,
    pub engine: EngineConfig,
    pub channels: Vec<ChannelDef>,
}

impl Default for SupervisionConfig {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: true,
            dt_max: 1.0,
            dt_min: 0.016,
            engine: EngineConfig::default(),
            channels: Vec::new(),
        }
    }
}

/// Canal de remplissage des places libres : non requis, jamais valide, accumulateur à zéro.
pub const fn unused_channel() -> ChannelConfig {
    ChannelConfig {
        alpha: 1.0,
        z_crit: 1.0,
        z_enter: 1.0,
        z_exit: 0.0,
        t_stable: 1.0,
        z_max: f64::INFINITY,
        guard_band: 0.0,
        required: false,
        z0: 0.0,
        w0: false,
    }
}

fn finite(id: &str, what: &str, v: f64) -> Result<(), SupervisionError> {
    if v.is_finite() {
        Ok(())
    } else {
        Err(SupervisionError::Channel {
            id: id.to_string(),
            reason: format!("{what} must be a finite number"),
        })
    }
}

fn positive(id: &str, what: &str, v: f64) -> Result<(), SupervisionError> {
    if v.is_finite() && v > 0.0 {
        Ok(())
    } else {
        Err(SupervisionError::Channel {
            id: id.to_string(),
            reason: format!("{what} must be finite and strictly positive"),
        })
    }
}

fn non_negative(id: &str, what: &str, v: f64) -> Result<(), SupervisionError> {
    if v.is_finite() && v >= 0.0 {
        Ok(())
    } else {
        Err(SupervisionError::Channel {
            id: id.to_string(),
            reason: format!("{what} must be finite and non-negative"),
        })
    }
}

impl ChannelDef {
    /// Plafond effectif de l'accumulateur.
    pub fn z_max(&self) -> f64 {
        self.acc.z_max.unwrap_or(4.0 * self.acc.z_crit)
    }

    /// Paramètres du canal pour `maisa-core`, bande de garde calculée par la caisse si elle n'est pas donnée.
    pub fn channel_config(&self, dt_min: f64, dt_max: f64) -> ChannelConfig {
        let z_max = self.z_max();
        let guard_band = self.acc.guard_band.unwrap_or_else(|| {
            guard_band_f64(
                self.acc.alpha,
                self.acc.alpha * z_max,
                z_max,
                dt_min,
                dt_max,
            )
        });
        ChannelConfig {
            alpha: self.acc.alpha,
            z_crit: self.acc.z_crit,
            z_enter: self.acc.z_enter,
            z_exit: self.acc.z_exit,
            t_stable: self.acc.t_stable,
            z_max,
            guard_band,
            required: self.acc.required,
            z0: 0.0,
            w0: false,
        }
    }

    fn validate(&self, dt_min: f64, dt_max: f64) -> Result<ChannelConfig, SupervisionError> {
        let id = self.id.as_str();
        let bad = |reason: &str| SupervisionError::Channel {
            id: id.to_string(),
            reason: reason.to_string(),
        };
        if id.trim().is_empty() {
            return Err(SupervisionError::Config("a channel has an empty id".into()));
        }
        match &self.kind {
            ChannelKind::Axis {
                source,
                lo,
                hi,
                scale,
                deadband,
                weight,
                hard_lo,
                hard_hi,
            } => {
                if source.trim().is_empty() {
                    return Err(bad("no source signal"));
                }
                finite(id, "lo", *lo)?;
                finite(id, "hi", *hi)?;
                if lo > hi {
                    return Err(bad("lo must not exceed hi"));
                }
                positive(id, "scale", *scale)?;
                non_negative(id, "deadband", *deadband)?;
                positive(id, "weight", *weight)?;
                if let Some(h) = hard_lo {
                    finite(id, "hard_lo", *h)?;
                    if h > lo {
                        return Err(bad("hard_lo must not exceed lo"));
                    }
                }
                if let Some(h) = hard_hi {
                    finite(id, "hard_hi", *h)?;
                    if h < hi {
                        return Err(bad("hard_hi must not be below hi"));
                    }
                }
            }
            ChannelKind::Relationship {
                signal_a,
                signal_b,
                threshold,
                delay,
                scale,
                deadband,
                gain,
            } => {
                if signal_a.trim().is_empty() || signal_b.trim().is_empty() {
                    return Err(bad("both signals are required"));
                }
                finite(id, "threshold", *threshold)?;
                non_negative(id, "delay", *delay)?;
                positive(id, "scale", *scale)?;
                non_negative(id, "deadband", *deadband)?;
                positive(id, "gain", *gain)?;
            }
        }
        let cc = self.channel_config(dt_min, dt_max);
        // Mêmes contrôles que la caisse, canal par canal, pour nommer celui qui est en faute.
        if !(cc.z_enter <= cc.z_crit && cc.z_crit <= cc.z_max && cc.z_crit.is_finite()) {
            return Err(bad(&config_reason(maisa_core::ConfigError::Thresholds)));
        }
        if !(cc.guard_band >= 0.0 && cc.guard_band.is_finite()) {
            return Err(bad(&config_reason(maisa_core::ConfigError::GuardBand)));
        }
        if cc.guard_band >= cc.z_crit {
            return Err(bad("guard band must be smaller than z_crit"));
        }
        Accumulator::new(cc.alpha, cc.z0, cc.z_max).map_err(|e| bad(&config_reason(e)))?;
        Hysteresis::new(cc.z_enter, cc.z_exit, cc.t_stable, cc.w0)
            .map_err(|e| bad(&config_reason(e)))?;
        Ok(cc)
    }
}

impl SupervisionConfig {
    /// Vérifie toute la configuration et rend les `MAX_CHANNELS` paramètres de canal du moniteur.
    pub fn validate(&self) -> Result<[ChannelConfig; MAX_CHANNELS], SupervisionError> {
        if self.channels.len() > MAX_CHANNELS {
            return Err(SupervisionError::TooManyChannels {
                given: self.channels.len(),
                max: MAX_CHANNELS,
            });
        }
        if !(self.dt_min.is_finite() && self.dt_min > 0.0) {
            return Err(SupervisionError::Config(
                "dt_min must be finite and strictly positive".into(),
            ));
        }
        if !(self.dt_max.is_finite() && self.dt_max > self.dt_min) {
            return Err(SupervisionError::Config(
                "dt_max must be finite and larger than dt_min".into(),
            ));
        }
        let e = &self.engine;
        if e.n_max < 1 || e.n_max > MAX_ATTEMPTS {
            return Err(SupervisionError::Config(format!(
                "engine n_max must be between 1 and {MAX_ATTEMPTS}"
            )));
        }
        if !(e.t_cooldown.is_finite()
            && e.t_cooldown > 0.0
            && e.t_timeout.is_finite()
            && e.t_timeout > 0.0)
        {
            return Err(SupervisionError::Config(
                "engine cooldown and timeout must be finite and strictly positive".into(),
            ));
        }
        let mut out = [unused_channel(); MAX_CHANNELS];
        for (i, ch) in self.channels.iter().enumerate() {
            if self.channels[..i].iter().any(|o| o.id == ch.id) {
                return Err(SupervisionError::DuplicateChannel(ch.id.clone()));
            }
            out[i] = ch.validate(self.dt_min, self.dt_max)?;
        }
        Ok(out)
    }
}

/// Verrou initial à l'ouverture d'un projet (`initial_latch` du moniteur).
///
/// `saved` est la valeur enregistrée avec le projet. Jamais enregistrée (`None` : projet sans supervision jusque-là) :
/// verrou ouvert. Booléen : sa valeur. Toute autre chose (valeur illisible) : verrou **fermé**, par prudence.
pub fn initial_latch(saved: Option<&Value>) -> bool {
    match saved {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => true,
    }
}
