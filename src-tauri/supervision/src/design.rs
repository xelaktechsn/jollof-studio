// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Aide au réglage d'un canal à partir d'exigences : ce qu'on tolère, ce qu'il faut détecter.
//!
//! Toute la mathématique vient de `maisa_core::design` (`separation_feasible`, `threshold_interval`,
//! `time_to_threshold`, `guard_band_f64`) ; ce module ne fait que choisir, parmi les réglages que ces fonctions
//! déclarent admissibles, celui qui laisse le plus de marge, et le dire.
use crate::channels::axis_p;
use maisa_core::design::{
    guard_band_f64, separation_feasible, threshold_interval, time_to_threshold,
};
use serde::{Deserialize, Serialize};

/// Exigences saisies : écarts en unité du signal, durées en secondes.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct DesignRequest {
    /// Écart toléré hors de la plage, pendant au plus `tol_time`.
    pub tol_dev: f64,
    pub tol_time: f64,
    /// Écart qui doit être détecté, en au plus `det_time`.
    pub det_dev: f64,
    pub det_time: f64,
    pub scale: f64,
    #[serde(default)]
    pub deadband: f64,
    #[serde(default = "one")]
    pub weight: f64,
    pub dt_max: f64,
    pub dt_min: f64,
}

fn one() -> f64 {
    1.0
}

/// Réglage proposé, ou la raison pour laquelle il n'en existe pas.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DesignProposal {
    /// Un couple (alpha, z_crit) qui sépare le toléré du à-détecter existe (théorème 9.1).
    pub feasible: bool,
    /// `invalid_input`, `not_separable`, `sampling` (le pas maximal dépasse le temps de détection demandé) ou absent.
    pub reason: Option<&'static str>,
    /// Entrées d'anomalie correspondant aux deux écarts.
    pub u_tol: f64,
    pub u_det: f64,
    pub alpha: Option<f64>,
    /// Intervalle admissible `]z_lo, z_hi]` de `z_crit` pour cet `alpha`.
    pub z_lo: Option<f64>,
    pub z_hi: Option<f64>,
    pub z_crit: Option<f64>,
    pub z_enter: Option<f64>,
    pub z_exit: Option<f64>,
    pub t_stable: Option<f64>,
    pub z_max: Option<f64>,
    pub guard_band: Option<f64>,
    /// Temps de détection de l'écart à détecter, entrée constante, accumulateur parti de zéro (théorème 4.6).
    pub t_detect: Option<f64>,
    /// Le même, plus un pas d'échantillonnage maximal : ce que la simulation garantit.
    pub t_detect_sampled: Option<f64>,
    /// Temps au bout duquel l'écart toléré, s'il durait, serait détecté (absent : jamais).
    pub t_tolerated: Option<f64>,
}

impl DesignProposal {
    fn none(reason: &'static str, u_tol: f64, u_det: f64) -> Self {
        Self {
            feasible: false,
            reason: Some(reason),
            u_tol,
            u_det,
            alpha: None,
            z_lo: None,
            z_hi: None,
            z_crit: None,
            z_enter: None,
            z_exit: None,
            t_stable: None,
            z_max: None,
            guard_band: None,
            t_detect: None,
            t_detect_sampled: None,
            t_tolerated: None,
        }
    }
}

/// Propose un réglage. Ne choisit jamais de paramètres qui violent les exigences : sans réglage admissible, le dit.
pub fn propose(q: &DesignRequest) -> DesignProposal {
    let ok = |v: f64| v.is_finite() && v > 0.0;
    if !(q.tol_dev.is_finite()
        && q.tol_dev >= 0.0
        && ok(q.tol_time)
        && ok(q.det_dev)
        && ok(q.det_time)
        && ok(q.scale)
        && q.deadband.is_finite()
        && q.deadband >= 0.0
        && ok(q.weight)
        && ok(q.dt_min)
        && q.dt_max.is_finite()
        && q.dt_max > q.dt_min)
    {
        return DesignProposal::none("invalid_input", f64::NAN, f64::NAN);
    }
    // Écart → entrée d'anomalie, par les fonctions de la caisse (plage [0, 0] : l'écart est la mesure elle-même).
    let u_tol = axis_p(q.tol_dev, 0.0, 0.0, q.scale, q.deadband, q.weight);
    let u_det = axis_p(q.det_dev, 0.0, 0.0, q.scale, q.deadband, q.weight);
    if !(u_det > 0.0) || !separation_feasible(u_tol, q.tol_time, u_det, q.det_time) {
        return DesignProposal::none("not_separable", u_tol, u_det);
    }
    // La détection se constate à un pas d'échantillonnage : il reste `det_time − dt_max` pour atteindre le seuil.
    let budget = q.det_time - q.dt_max;
    if !(budget > 0.0) {
        return DesignProposal::none("sampling", u_tol, u_det);
    }
    // Parmi les alpha d'une grille, celui dont l'intervalle admissible de z_crit est le plus large en proportion.
    let mut best: Option<(f64, f64, f64, f64)> = None; // (marge, alpha, lo, hi)
    for k in 0..=240 {
        let alpha = 10f64.powf(-3.0 + 6.0 * f64::from(k) / 240.0) / q.det_time;
        if let Some((lo, hi)) = threshold_interval(alpha, u_tol, q.tol_time, u_det, budget) {
            let margin = if lo > 0.0 { hi / lo } else { f64::INFINITY };
            if best.is_none_or(|b| margin > b.0) {
                best = Some((margin, alpha, lo, hi));
            }
        }
    }
    let Some((_, alpha, lo, hi)) = best else {
        return DesignProposal::none("sampling", u_tol, u_det);
    };
    // Seuil au milieu géométrique de l'intervalle (ou à mi-hauteur si rien n'est toléré).
    let z_crit = if lo > 0.0 { (lo * hi).sqrt() } else { hi / 2.0 };
    let z_max = 4.0 * z_crit;
    let guard_band = guard_band_f64(alpha, alpha * z_max, z_max, q.dt_min, q.dt_max);
    let t_detect = time_to_threshold(alpha, u_det, z_crit - guard_band, 0.0);
    let t_tol = time_to_threshold(alpha, u_tol, z_crit - guard_band, 0.0);
    DesignProposal {
        feasible: true,
        reason: None,
        u_tol,
        u_det,
        alpha: Some(alpha),
        z_lo: Some(lo),
        z_hi: Some(hi),
        z_crit: Some(z_crit),
        z_enter: Some(0.5 * z_crit),
        z_exit: Some(0.25 * z_crit),
        t_stable: Some(q.tol_time.max(q.dt_max)),
        z_max: Some(z_max),
        guard_band: Some(guard_band),
        t_detect: Some(t_detect),
        t_detect_sampled: Some(t_detect + q.dt_max),
        t_tolerated: t_tol.is_finite().then_some(t_tol),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> DesignRequest {
        DesignRequest {
            tol_dev: 0.2,
            tol_time: 1.0,
            det_dev: 1.0,
            det_time: 3.0,
            scale: 0.5,
            deadband: 0.0,
            weight: 1.0,
            dt_max: 0.6,
            dt_min: 0.016,
        }
    }

    #[test]
    fn proposal_meets_both_requirements() {
        let p = propose(&req());
        assert!(p.feasible, "{p:?}");
        let (alpha, z) = (p.alpha.unwrap(), p.z_crit.unwrap());
        assert!(p.z_lo.unwrap() < z && z <= p.z_hi.unwrap());
        // Détecté à temps, pas d'échantillonnage compris.
        assert!(p.t_detect_sampled.unwrap() <= 3.0 + 1e-9, "{p:?}");
        // L'écart toléré pendant la durée tolérée n'atteint pas le seuil.
        assert!(time_to_threshold(alpha, p.u_tol, z, 0.0) > 1.0);
        assert!(p.z_exit.unwrap() < p.z_enter.unwrap() && p.z_enter.unwrap() <= z);
    }

    #[test]
    fn impossible_requirements_are_refused() {
        // On tolère plus, plus longtemps, que ce qu'il faudrait détecter : aucune séparation.
        let mut q = req();
        q.tol_dev = 1.0;
        q.tol_time = 5.0;
        q.det_dev = 0.5;
        q.det_time = 1.0;
        let p = propose(&q);
        assert!(!p.feasible);
        assert_eq!(p.reason, Some("not_separable"));
        // Détection demandée plus vite que le pas d'échantillonnage.
        let mut q = req();
        q.det_time = 0.5;
        assert_eq!(propose(&q).reason, Some("sampling"));
        let mut q = req();
        q.scale = 0.0;
        assert_eq!(propose(&q).reason, Some("invalid_input"));
    }
}
