// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Entrée d'anomalie `p` de chaque type de canal, avec les fonctions de `maisa-core`.
use maisa_core::{deviation, response};

/// Axe : `p = weight × response(deviation(y, lo, hi, scale), deadband, 1)`.
pub fn axis_p(y: f64, lo: f64, hi: f64, scale: f64, deadband: f64, weight: f64) -> f64 {
    weight * response(deviation(y, lo, hi, scale), deadband, 1.0)
}

/// Limite dure franchie : la valeur sort de `[hard_lo, hard_hi]` (bornes absentes : pas de limite).
pub fn hard_violation(y: f64, hard_lo: Option<f64>, hard_hi: Option<f64>) -> bool {
    hard_lo.is_some_and(|h| y < h) || hard_hi.is_some_and(|h| y > h)
}

/// Où en est une relation « A atteint X au plus T secondes après que B devient vrai ».
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RelPhase {
    /// B est faux : rien n'est attendu.
    Idle,
    /// B est devenu vrai à `since` (temps simulé) : A a jusqu'à `since + delay`.
    Pending { since: f64 },
    /// A a atteint le seuil : la relation est tenue jusqu'à ce que B retombe.
    Satisfied,
    /// Le délai est passé sans que A atteigne le seuil : la relation est violée tant que B reste vrai et A sous le seuil.
    Violating,
}

/// État d'une relation entre deux pas.
///
/// Sémantique (v1), entièrement en temps simulé :
/// - le passage de B de faux à vrai déclenche une échéance ; B vrai dès la première mesure compte comme un déclenchement ;
/// - tant que B reste vrai, il n'y a pas de nouveau déclenchement ;
/// - A au seuil avant ou après l'échéance tient la relation jusqu'au prochain retour de B à faux ;
/// - B qui retombe à faux annule l'attente ou la violation (la commande est retirée) : `p = 0` ;
/// - un nouveau déclenchement n'est donc possible qu'après un retour de B à faux, et repart d'une échéance neuve ;
/// - mesure invalide (A ou B manquant) : le canal est invalide et l'état de la relation ne change pas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RelState {
    pub phase: RelPhase,
}

impl Default for RelState {
    fn default() -> Self {
        Self {
            phase: RelPhase::Idle,
        }
    }
}

/// Paramètres d'une relation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RelParams {
    pub threshold: f64,
    pub delay: f64,
    pub scale: f64,
    pub deadband: f64,
    pub gain: f64,
}

impl RelState {
    /// Avance la relation au temps simulé `t` avec les mesures valides `a` et `b` (`b >= 0,5` : vrai). Rend `p`.
    pub fn step(&mut self, t: f64, a: f64, b: f64, k: &RelParams) -> f64 {
        if b < 0.5 {
            self.phase = RelPhase::Idle;
            return 0.0;
        }
        if self.phase == RelPhase::Idle {
            self.phase = RelPhase::Pending { since: t };
        }
        let reached = a >= k.threshold;
        self.phase = match self.phase {
            RelPhase::Pending { .. } | RelPhase::Violating if reached => RelPhase::Satisfied,
            RelPhase::Pending { since } if t - since >= k.delay => RelPhase::Violating,
            other => other,
        };
        if self.phase == RelPhase::Violating {
            let d = ((k.threshold - a) / k.scale).max(0.0);
            k.gain * response(d, k.deadband, 1.0)
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axis_inside_is_zero_outside_scaled() {
        assert_eq!(axis_p(5.0, 4.5, 5.5, 0.5, 0.0, 1.0), 0.0);
        assert_eq!(axis_p(4.5, 4.5, 5.5, 0.5, 0.0, 1.0), 0.0);
        // 1 V sous la borne basse, échelle 0,5 V : écart 2 ; zone morte 0,5 : 1,5 ; poids 2 : 3.
        assert!((axis_p(3.5, 4.5, 5.5, 0.5, 0.5, 2.0) - 3.0).abs() < 1e-12);
        assert!((axis_p(6.0, 4.5, 5.5, 0.5, 0.0, 1.0) - 1.0).abs() < 1e-12);
        // Dans la zone morte : rien.
        assert_eq!(axis_p(5.6, 4.5, 5.5, 0.5, 0.5, 1.0), 0.0);
        // Mesure non finie : p non fini, que le moniteur traite comme invalide.
        assert!(axis_p(f64::NAN, 4.5, 5.5, 0.5, 0.0, 1.0).is_nan());
    }

    #[test]
    fn hard_limits() {
        assert!(hard_violation(-1.0, Some(0.0), None));
        assert!(hard_violation(7.0, None, Some(6.0)));
        assert!(!hard_violation(5.0, Some(0.0), Some(6.0)));
        assert!(!hard_violation(99.0, None, None));
    }

    const K: RelParams = RelParams {
        threshold: 0.98,
        delay: 2.0,
        scale: 0.5,
        deadband: 0.0,
        gain: 1.0,
    };

    #[test]
    fn relationship_waits_then_violates() {
        let mut r = RelState::default();
        assert_eq!(r.step(0.0, 0.0, 0.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Idle);
        assert_eq!(r.step(1.0, 0.0, 1.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Pending { since: 1.0 });
        // B reste vrai : pas de nouveau déclenchement, l'échéance ne recule pas.
        assert_eq!(r.step(2.9, 0.1, 1.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Pending { since: 1.0 });
        // Échéance passée, A à 0,48 sous le seuil : p = 0,5 / 0,5 = 1 (à l'arrondi près).
        let p = r.step(3.0, 0.48, 1.0, &K);
        assert_eq!(r.phase, RelPhase::Violating);
        assert!((p - 1.0).abs() < 1e-12);
    }

    #[test]
    fn relationship_satisfied_in_time_and_late() {
        let mut r = RelState::default();
        r.step(0.0, 0.0, 1.0, &K);
        assert_eq!(r.step(1.5, 1.0, 1.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Satisfied);
        // A retombe ensuite : ce n'est plus cette relation (elle ne parle que de la réponse à la commande).
        assert_eq!(r.step(5.0, 0.0, 1.0, &K), 0.0);
        // En retard : violation, puis tenue dès que A arrive.
        let mut r = RelState::default();
        r.step(0.0, 0.0, 1.0, &K);
        assert!(r.step(2.5, 0.0, 1.0, &K) > 0.0);
        assert_eq!(r.step(2.6, 0.99, 1.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Satisfied);
    }

    #[test]
    fn relationship_cancel_and_retrigger() {
        let mut r = RelState::default();
        r.step(0.0, 0.0, 1.0, &K);
        // B retombe avant l'échéance : attente annulée.
        assert_eq!(r.step(1.0, 0.0, 0.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Idle);
        // Nouveau déclenchement : échéance neuve à partir de 4 s.
        r.step(4.0, 0.0, 1.0, &K);
        assert_eq!(r.step(5.9, 0.0, 1.0, &K), 0.0);
        assert!(r.step(6.0, 0.0, 1.0, &K) > 0.0);
        // B retombe pendant la violation : p revient à zéro.
        assert_eq!(r.step(6.1, 0.0, 0.0, &K), 0.0);
    }

    #[test]
    fn relationship_true_at_first_sample_triggers() {
        let mut r = RelState::default();
        assert_eq!(r.step(10.0, 0.0, 1.0, &K), 0.0);
        assert_eq!(r.phase, RelPhase::Pending { since: 10.0 });
    }
}
