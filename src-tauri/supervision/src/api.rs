// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Commandes de la supervision, en JSON : la couche Tauri (une commande fine) et le pont de développement passent
//! tous deux par [`handle`]. Aucun type de Tauri ici.
//!
//! Commandes : `configure { config, latch?, never_saved?, t0? }`, `step { t, signals }`, `operator { action, on? }`,
//! `fault_add { fault }`, `fault_clear { id }`, `fault_clear_all`, `fault_list`, `validate { config }`,
//! `design { … }`, `detect_time { alpha, p0, z_crit, guard_band? }`, `stop`.
use crate::config::{initial_latch, SupervisionConfig};
use crate::design::{propose, DesignRequest};
use crate::error::SupervisionError;
use crate::faults::{FaultInjector, FaultSpec};
use crate::signals::SignalSnapshot;
use crate::supervisor::{OperatorAction, Supervisor};
use maisa_core::design::time_to_threshold;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

/// État gardé entre deux commandes : le superviseur (absent tant que rien n'est configuré) et les défauts injectés,
/// qui survivent à une reconfiguration.
#[derive(Debug, Default)]
pub struct Session {
    supervisor: Option<Supervisor>,
    parked_faults: FaultInjector,
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, SupervisionError> {
    let v = args
        .get(key)
        .ok_or_else(|| SupervisionError::BadRequest(format!("missing \"{key}\"")))?;
    T::deserialize(v).map_err(|e| SupervisionError::BadRequest(format!("\"{key}\": {e}")))
}

fn to_value<T: serde::Serialize>(v: &T) -> Result<Value, SupervisionError> {
    serde_json::to_value(v).map_err(|e| SupervisionError::BadRequest(e.to_string()))
}

impl Session {
    fn faults_mut(&mut self) -> &mut FaultInjector {
        match self.supervisor.as_mut() {
            Some(s) => s.faults_mut(),
            None => &mut self.parked_faults,
        }
    }

    /// Exécute une commande et rend son résultat.
    pub fn handle(&mut self, cmd: &str, args: &Value) -> Result<Value, SupervisionError> {
        match cmd {
            "configure" => {
                let cfg: SupervisionConfig = arg(args, "config")?;
                // Verrou relu du projet : jamais enregistré → ouvert ; booléen → sa valeur ; illisible → fermé.
                let never = args
                    .get("never_saved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let latch = initial_latch(if never {
                    None
                } else {
                    Some(args.get("latch").unwrap_or(&Value::Null))
                });
                let t0 = args.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                let mut sup = Supervisor::new(cfg, latch, t0)?;
                let faults = match self.supervisor.take() {
                    Some(old) => old.faults().clone(),
                    None => core::mem::take(&mut self.parked_faults),
                };
                sup.adopt_faults(faults);
                let n = sup.config().channels.len();
                self.supervisor = Some(sup);
                Ok(json!({ "channels": n, "latch": latch }))
            }
            "step" => {
                let t = args.get("t").and_then(Value::as_f64).unwrap_or(f64::NAN);
                let snapshot = SignalSnapshot {
                    signals: arg(args, "signals")?,
                };
                let sup = self
                    .supervisor
                    .as_mut()
                    .ok_or(SupervisionError::NotConfigured)?;
                let frame = sup.step(t, &snapshot)?;
                to_value(&frame)
            }
            "operator" => {
                let action: String = arg(args, "action")?;
                let on = args.get("on").and_then(Value::as_bool).unwrap_or(true);
                let action = match action.as_str() {
                    "confirm" => OperatorAction::ConfirmSafeState,
                    "verify" => OperatorAction::VerifyRecovery,
                    "reset" => OperatorAction::AuthorisedReset,
                    "corrective" => OperatorAction::Corrective(on),
                    other => {
                        return Err(SupervisionError::BadRequest(format!(
                            "unknown action \"{other}\""
                        )))
                    }
                };
                self.supervisor
                    .as_mut()
                    .ok_or(SupervisionError::NotConfigured)?
                    .operator(action)?;
                Ok(Value::Null)
            }
            "fault_add" => {
                let spec: FaultSpec = arg(args, "fault")?;
                let id = self.faults_mut().add(spec)?;
                Ok(json!({ "id": id }))
            }
            "fault_clear" => {
                let id: u32 = arg(args, "id")?;
                self.faults_mut().clear(id)?;
                Ok(Value::Null)
            }
            "fault_clear_all" => {
                self.faults_mut().clear_all();
                Ok(Value::Null)
            }
            "fault_list" => to_value(&self.faults_mut().list()),
            "validate" => {
                let cfg: SupervisionConfig = arg(args, "config")?;
                cfg.validate()?;
                Ok(json!({ "ok": true }))
            }
            "design" => {
                let q: DesignRequest = DesignRequest::deserialize_from(args)?;
                to_value(&propose(&q))
            }
            "detect_time" => {
                // Temps pour atteindre le seuil critique sous une entrée constante p0, accumulateur parti de zéro
                // (maisa_core::design::time_to_threshold). Absent : jamais atteint.
                let num = |k: &str| -> Result<f64, SupervisionError> {
                    let v: f64 = arg(args, k)?;
                    if v.is_finite() {
                        Ok(v)
                    } else {
                        Err(SupervisionError::BadRequest(format!(
                            "\"{k}\" must be finite"
                        )))
                    }
                };
                let (alpha, p0, z_crit) = (num("alpha")?, num("p0")?, num("z_crit")?);
                let guard = args
                    .get("guard_band")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                if !(alpha > 0.0 && p0 >= 0.0 && z_crit > guard && guard >= 0.0) {
                    return Err(SupervisionError::BadRequest(
                        "alpha > 0, p0 >= 0 and z_crit > guard_band are required".into(),
                    ));
                }
                let t = time_to_threshold(alpha, p0, z_crit - guard, 0.0);
                Ok(json!({ "t": t.is_finite().then_some(t) }))
            }
            "stop" => {
                if let Some(old) = self.supervisor.take() {
                    self.parked_faults = old.faults().clone();
                }
                Ok(Value::Null)
            }
            other => Err(SupervisionError::BadRequest(format!(
                "unknown command \"{other}\""
            ))),
        }
    }
}

impl DesignRequest {
    fn deserialize_from(args: &Value) -> Result<Self, SupervisionError> {
        serde::Deserialize::deserialize(args)
            .map_err(|e: serde_json::Error| SupervisionError::BadRequest(e.to_string()))
    }
}
