// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Le superviseur : il prépare les entrées du moniteur de `maisa-core` et lit ses sorties, rien de plus.
//!
//! À chaque pas terminé de la simulation : copie des valeurs observées, défauts injectés sur cette copie, entrée
//! d'anomalie `p` de chaque canal (canal invalide si son signal manque ou n'est pas fini), preuves externes, appel
//! de `Monitor::tick`, puis suivi de la demande de mise en état sûr par `InterventionEngine`.
//!
//! Temps : uniquement le temps simulé reçu en argument. Simulation arrêtée ou en pause : `step` n'est pas appelé,
//! donc ni les accumulateurs, ni les échéances des relations, ni les délais d'intervention n'avancent.
//!
//! Entrées de l'opérateur, telles que la machine d'états de `maisa-core` les exige :
//! - `k` (état sûr confirmé) et `r` (reprise vérifiée) sont des **niveaux tenus** : `SafeConfirmed` retombe en
//!   `SafeRequested` dès que `k` est faux, et le verrou ne s'ouvre qu'au pas où `r` et `a` sont vrais ensemble.
//!   Ils sont remis à faux quand le verrou s'ouvre, ou quand un nouvel événement critique survient pendant la reprise ;
//! - `a` (réarmement autorisé) est une impulsion, consommée au pas suivant ;
//! - `x` (action corrective autorisée) est un niveau que l'opérateur met et retire.
//!
//! `External.s` de `maisa-core` signifie « perte de donnée critique ou escalade de l'intervention » : on y met
//! `InterventionEngine::escalated()` (budget de demandes épuisé).
use crate::channels::{axis_p, hard_violation, RelParams, RelPhase, RelState};
use crate::config::{ChannelKind, SupervisionConfig, MAX_ATTEMPTS, MAX_CHANNELS};
use crate::error::{config_reason, SupervisionError};
use crate::faults::FaultInjector;
use crate::frame::{outcome_name, state_name, ChannelFrame, EngineFrame, Event, SupervisionFrame};
use crate::signals::{valid_value, SignalSnapshot};
use maisa_core::{ChannelConfig, External, InterventionEngine, Monitor, Outcome, Sample, State};

/// Action de l'opérateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperatorAction {
    /// Confirmer que l'état sûr est atteint (`k`).
    ConfirmSafeState,
    /// Vérifier la reprise (`r`).
    VerifyRecovery,
    /// Réarmement autorisé (`a`).
    AuthorisedReset,
    /// Autoriser ou retirer l'action corrective (`x`).
    Corrective(bool),
}

/// Superviseur d'un circuit simulé.
#[derive(Debug, Clone)]
pub struct Supervisor {
    cfg: SupervisionConfig,
    params: [ChannelConfig; MAX_CHANNELS],
    monitor: Monitor<MAX_CHANNELS>,
    engine: InterventionEngine<MAX_ATTEMPTS>,
    rel: [RelState; MAX_CHANNELS],
    faults: FaultInjector,
    /// Valeurs observées du pas (copie de l'instantané, après défauts) : tampon réutilisé d'un pas à l'autre.
    values: Vec<Option<f64>>,
    k: bool,
    r: bool,
    x: bool,
    a_pulse: bool,
    next_request: u32,
    pending_id: Option<u32>,
    last_time: Option<f64>,
    last_state: State,
    prev_warning: [bool; MAX_CHANNELS],
    prev_critical: [bool; MAX_CHANNELS],
    prev_valid: [bool; MAX_CHANNELS],
    prev_escalated: bool,
    queued: Vec<Event>,
    ticks: u64,
}

impl Supervisor {
    /// Crée le superviseur. `initial_latch` : verrou relu du projet (voir [`crate::config::initial_latch`]) ;
    /// `t0` : temps simulé de départ.
    pub fn new(
        cfg: SupervisionConfig,
        initial_latch: bool,
        t0: f64,
    ) -> Result<Self, SupervisionError> {
        let params = cfg.validate()?;
        let monitor = Monitor::<MAX_CHANNELS>::new(&params, cfg.dt_max, initial_latch, t0)
            .map_err(|e| SupervisionError::Config(config_reason(e)))?;
        let engine = InterventionEngine::<MAX_ATTEMPTS>::new(
            cfg.engine.n_max,
            cfg.engine.t_cooldown,
            cfg.engine.t_timeout,
        )
        .map_err(|e| SupervisionError::Config(config_reason(e)))?;
        Ok(Self {
            cfg,
            params,
            monitor,
            engine,
            rel: [RelState::default(); MAX_CHANNELS],
            faults: FaultInjector::default(),
            values: Vec::new(),
            k: false,
            r: false,
            x: false,
            a_pulse: false,
            next_request: 1,
            pending_id: None,
            last_time: None,
            last_state: State::Unknown,
            prev_warning: [false; MAX_CHANNELS],
            prev_critical: [false; MAX_CHANNELS],
            prev_valid: [true; MAX_CHANNELS],
            prev_escalated: false,
            queued: Vec::new(),
            ticks: 0,
        })
    }

    pub fn config(&self) -> &SupervisionConfig {
        &self.cfg
    }
    pub fn state(&self) -> State {
        self.monitor.state()
    }
    pub fn latch(&self) -> bool {
        self.monitor.latch()
    }
    /// Valeur de l'accumulateur du canal `i`.
    pub fn value(&self, i: usize) -> Option<f64> {
        self.monitor.value(i)
    }
    /// Nombre de pas évalués.
    pub fn ticks(&self) -> u64 {
        self.ticks
    }
    pub fn faults(&self) -> &FaultInjector {
        &self.faults
    }
    pub fn faults_mut(&mut self) -> &mut FaultInjector {
        &mut self.faults
    }
    /// Reprend les défauts d'un superviseur précédent (reconfiguration).
    pub fn adopt_faults(&mut self, faults: FaultInjector) {
        self.faults = faults;
    }
    /// Demandes d'intervention acceptées depuis le dernier réarmement.
    pub fn attempts(&self) -> usize {
        self.engine.attempts()
    }

    /// Entrée de l'opérateur. Refusée, avec la raison, si elle ne peut avoir aucun effet dans l'état courant.
    pub fn operator(&mut self, action: OperatorAction) -> Result<(), SupervisionError> {
        let state = self.monitor.state();
        let reject = |m: &str| Err(SupervisionError::Rejected(m.to_string()));
        match action {
            OperatorAction::ConfirmSafeState => {
                if !matches!(state, State::SafeRequested | State::SafeConfirmed) {
                    return reject("the safe state can only be confirmed after it was requested");
                }
                self.k = true;
                if let Some(id) = self.pending_id.take() {
                    self.engine.resolve(id, true);
                    self.queued.push(Event::Resolved {
                        id: Some(id),
                        success: true,
                    });
                }
                self.queued.push(Event::Operator { action: "confirm" });
            }
            OperatorAction::VerifyRecovery => {
                if state != State::LockedRecovery {
                    return reject("recovery can only be verified once the safe state is confirmed and the fault has cleared");
                }
                self.r = true;
                self.queued.push(Event::Operator { action: "verify" });
            }
            OperatorAction::AuthorisedReset => {
                // Budget d'interventions épuisé (escalade) : le réarmement autorisé rend d'abord la main au moteur,
                // sans quoi la preuve S resterait vraie et la reprise serait impossible.
                if !self.engine.escalated() {
                    if state != State::LockedRecovery {
                        return reject("a reset is only possible in locked recovery");
                    }
                    if !self.r {
                        return reject("verify recovery before the reset");
                    }
                }
                self.a_pulse = true;
                self.queued.push(Event::Operator { action: "reset" });
            }
            OperatorAction::Corrective(on) => {
                if self.monitor.latch() {
                    return reject("no corrective action while the latch is set");
                }
                self.x = on;
                self.queued.push(Event::Operator {
                    action: if on {
                        "corrective_on"
                    } else {
                        "corrective_off"
                    },
                });
            }
        }
        Ok(())
    }

    /// Un pas de supervision au temps simulé `sim_time`, sur l'instantané des signaux du pas de simulation terminé.
    pub fn step(
        &mut self,
        sim_time: f64,
        signals: &SignalSnapshot,
    ) -> Result<SupervisionFrame<'_>, SupervisionError> {
        if !self.cfg.enabled {
            return Err(SupervisionError::Rejected("supervision is disabled".into()));
        }
        let n = self.cfg.channels.len();
        // Le temps avance-t-il ? Sinon les échéances des relations et du moteur ne bougent pas ; le moniteur, lui,
        // reçoit le temps tel quel et déclare le défaut d'horloge.
        let advancing = sim_time.is_finite() && self.last_time.is_none_or(|l| sim_time > l);

        // 1. Valeurs observées : copie, puis défauts (le circuit simulé n'est pas touché).
        self.values.clear();
        self.values.extend(signals.signals.iter().map(|s| s.value));
        self.faults.apply(sim_time, signals, &mut self.values);

        // 2. Entrée d'anomalie de chaque canal ; places libres : invalides et non requises.
        let mut samples = [Sample {
            p: 0.0,
            valid: false,
        }; MAX_CHANNELS];
        let mut hard = [false; MAX_CHANNELS];
        for (i, ch) in self.cfg.channels.iter().enumerate() {
            match &ch.kind {
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
                    if let Some(y) = valid_value(signals, &self.values, source) {
                        samples[i] = Sample {
                            p: axis_p(y, *lo, *hi, *scale, *deadband, *weight),
                            valid: true,
                        };
                        hard[i] = hard_violation(y, *hard_lo, *hard_hi);
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
                    let a = valid_value(signals, &self.values, signal_a);
                    let b = valid_value(signals, &self.values, signal_b);
                    if let (Some(a), Some(b), true) = (a, b, advancing) {
                        let k = RelParams {
                            threshold: *threshold,
                            delay: *delay,
                            scale: *scale,
                            deadband: *deadband,
                            gain: *gain,
                        };
                        samples[i] = Sample {
                            p: self.rel[i].step(sim_time, a, b, &k),
                            valid: true,
                        };
                    }
                }
            }
        }

        // 3. Moteur d'intervention : demandes en attente dont le délai est passé (échecs), puis escalade.
        let mut events = core::mem::take(&mut self.queued);
        let a = core::mem::take(&mut self.a_pulse);
        if a {
            // Réarmement autorisé : le moteur d'intervention repart (compteur, demandes en attente, escalade).
            self.engine.authorised_reset();
            self.pending_id = None;
        }
        if advancing {
            let expired = self.engine.tick(sim_time);
            if expired > 0 {
                events.push(Event::Resolved {
                    id: self.pending_id.take(),
                    success: false,
                });
            }
        }
        let escalated = self.engine.escalated();
        if escalated && !self.prev_escalated {
            events.push(Event::Escalated);
        }
        self.prev_escalated = escalated;

        // 4. Le moniteur de maisa-core décide.
        let ext = External {
            h: hard[..n].iter().any(|&h| h),
            s: escalated,
            x: self.x,
            k: self.k,
            r: self.r,
            a,
        };
        let out = self.monitor.tick(sim_time, &samples, ext);
        self.ticks += 1;
        if sim_time.is_finite() {
            self.last_time = Some(sim_time);
        }

        // 5. Suites : réarmement, demande de mise en état sûr, niveaux de l'opérateur.
        if !out.clock_ok {
            events.push(Event::ClockFault);
        }
        if out.state != self.last_state {
            events.push(Event::State {
                from: state_name(self.last_state),
                to: state_name(out.state),
            });
        }
        if out.latch_changed {
            events.push(Event::Latch { latch: out.latch });
        }
        if out.request_safe_state {
            let id = self.next_request;
            self.next_request = self.next_request.wrapping_add(1).max(1);
            let outcome = self.engine.request(sim_time, id, true);
            if outcome == Outcome::Accepted {
                self.pending_id = Some(id);
            }
            events.push(Event::Request {
                id,
                outcome: outcome_name(outcome),
            });
        }
        // Nouvel événement critique pendant la reprise, ou verrou ouvert : les confirmations ne valent plus.
        let relapse = self.last_state == State::LockedRecovery && out.state == State::SafeRequested;
        if relapse || !out.latch {
            self.k = false;
            self.r = false;
        }
        if out.latch {
            self.x = false;
        }
        self.last_state = out.state;

        // 6. Trame.
        let mut channels = Vec::with_capacity(n);
        for (i, ch) in self.cfg.channels.iter().enumerate() {
            let p = &self.params[i];
            let value = self.monitor.value(i).unwrap_or(f64::NAN);
            let warning = self.monitor.warning(i).unwrap_or(false);
            // Même comparaison que le moniteur pour la preuve C, canal par canal, pour l'affichage.
            let critical = value >= p.z_crit - p.guard_band || value >= p.z_max;
            let valid =
                out.clock_ok && samples[i].valid && samples[i].p.is_finite() && samples[i].p >= 0.0;
            if warning != self.prev_warning[i] {
                events.push(Event::Warning {
                    channel: i,
                    on: warning,
                });
            }
            if critical != self.prev_critical[i] {
                events.push(Event::Critical {
                    channel: i,
                    on: critical,
                });
            }
            if valid != self.prev_valid[i] {
                events.push(Event::Validity { channel: i, valid });
            }
            if hard[i] {
                events.push(Event::HardLimit { channel: i });
            }
            self.prev_warning[i] = warning;
            self.prev_critical[i] = critical;
            self.prev_valid[i] = valid;
            let (kind, phase) = match ch.kind {
                ChannelKind::Axis { .. } => ("axis", None),
                ChannelKind::Relationship { .. } => (
                    "relationship",
                    Some(match self.rel[i].phase {
                        RelPhase::Idle => "idle",
                        RelPhase::Pending { .. } => "pending",
                        RelPhase::Satisfied => "satisfied",
                        RelPhase::Violating => "violating",
                    }),
                ),
            };
            channels.push(ChannelFrame {
                id: &ch.id,
                name: &ch.name,
                kind,
                value,
                warning,
                critical,
                p: samples[i]
                    .valid
                    .then_some(samples[i].p)
                    .filter(|p| p.is_finite()),
                valid,
                hard: hard[i],
                phase,
                z_enter: p.z_enter,
                z_exit: p.z_exit,
                z_crit: p.z_crit,
                z_max: p.z_max,
            });
        }
        Ok(SupervisionFrame {
            time: sim_time,
            state: state_name(out.state),
            latch: out.latch,
            latch_changed: out.latch_changed,
            request_safe_state: out.request_safe_state,
            clock_ok: out.clock_ok,
            evidence: out.evidence.into(),
            engine: EngineFrame {
                attempts: self.engine.attempts(),
                max_attempts: self.cfg.engine.n_max,
                pending: self.engine.pending(),
                pending_id: self.pending_id,
                escalated: self.engine.escalated(),
            },
            channels,
            events,
        })
    }
}
