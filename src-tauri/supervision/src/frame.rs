// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Ce que la supervision rend à chaque pas : état, verrou, canaux, preuves, moteur d'intervention, événements.
use maisa_core::{Evidence, Outcome, State};
use serde::Serialize;

/// Nom stable d'un état du superviseur.
pub const fn state_name(s: State) -> &'static str {
    match s {
        State::Unknown => "unknown",
        State::Normal => "normal",
        State::Degraded => "degraded",
        State::Corrective => "corrective",
        State::SafeRequested => "safe_requested",
        State::SafeConfirmed => "safe_confirmed",
        State::LockedRecovery => "locked_recovery",
    }
}

/// Nom stable de la réponse du moteur d'intervention à une demande.
pub const fn outcome_name(o: Outcome) -> &'static str {
    match o {
        Outcome::Accepted => "accepted",
        Outcome::Duplicate => "duplicate",
        Outcome::RejectedGuard => "rejected_guard",
        Outcome::RejectedLimit => "rejected_limit",
        Outcome::RejectedCooldown => "rejected_cooldown",
    }
}

/// Preuves du pas (définition 7.4 de la spécification) : H limite dure, C seuil critique, S perte de donnée
/// critique ou escalade du moteur d'intervention, V mesures et horloge valides, W avertissement, X action
/// corrective autorisée, K état sûr confirmé, R reprise vérifiée, A réarmement autorisé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EvidenceFrame {
    pub h: bool,
    pub c: bool,
    pub s: bool,
    pub v: bool,
    pub w: bool,
    pub x: bool,
    pub k: bool,
    pub r: bool,
    pub a: bool,
}

impl From<Evidence> for EvidenceFrame {
    fn from(e: Evidence) -> Self {
        Self {
            h: e.h,
            c: e.c,
            s: e.s,
            v: e.v,
            w: e.w,
            x: e.x,
            k: e.k,
            r: e.r,
            a: e.a,
        }
    }
}

/// Moteur d'intervention : demandes acceptées depuis le dernier réarmement, budget, demande en attente, escalade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EngineFrame {
    pub attempts: usize,
    pub max_attempts: usize,
    pub pending: usize,
    pub pending_id: Option<u32>,
    pub escalated: bool,
}

/// Un canal au pas courant.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ChannelFrame<'a> {
    pub id: &'a str,
    pub name: &'a str,
    /// `axis` ou `relationship`.
    pub kind: &'static str,
    /// Valeur `z` de l'accumulateur.
    pub value: f64,
    pub warning: bool,
    /// Seuil critique atteint (bande de garde comprise) ou accumulateur saturé.
    pub critical: bool,
    /// Entrée d'anomalie du pas ; absente si la mesure est invalide.
    pub p: Option<f64>,
    pub valid: bool,
    /// Limite dure franchie à ce pas (axe).
    pub hard: bool,
    /// Relation : `idle`, `pending`, `satisfied` ou `violating`.
    pub phase: Option<&'static str>,
    pub z_enter: f64,
    pub z_exit: f64,
    pub z_crit: f64,
    pub z_max: f64,
}

/// Événement du journal, daté par le temps simulé de la trame qui le porte.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    State {
        from: &'static str,
        to: &'static str,
    },
    Latch {
        latch: bool,
    },
    Warning {
        channel: usize,
        on: bool,
    },
    Critical {
        channel: usize,
        on: bool,
    },
    Validity {
        channel: usize,
        valid: bool,
    },
    HardLimit {
        channel: usize,
    },
    /// Demande de mise en état sûr soumise au moteur d'intervention, et sa réponse (une demande acceptée n'est pas
    /// une demande exécutée).
    Request {
        id: u32,
        outcome: &'static str,
    },
    /// Demande close : `success` vrai si l'opérateur a confirmé l'état sûr, faux si le délai est passé.
    Resolved {
        id: Option<u32>,
        success: bool,
    },
    Escalated,
    ClockFault,
    /// Entrée de l'opérateur prise en compte : `confirm`, `verify`, `reset`, `corrective_on`, `corrective_off`.
    Operator {
        action: &'static str,
    },
}

/// Résultat d'un pas de supervision.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SupervisionFrame<'a> {
    /// Temps simulé du pas (s).
    pub time: f64,
    pub state: &'static str,
    pub latch: bool,
    pub latch_changed: bool,
    pub request_safe_state: bool,
    pub clock_ok: bool,
    pub evidence: EvidenceFrame,
    pub engine: EngineFrame,
    pub channels: Vec<ChannelFrame<'a>>,
    pub events: Vec<Event>,
}
