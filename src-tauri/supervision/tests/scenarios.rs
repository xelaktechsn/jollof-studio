// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Scénarios sans interface : nominal, défaut persistant, reprise ordonnée, perte de capteur, pause, horloge,
//! relation, budget d'interventions, persistance. Tout en temps simulé.
use jollof_supervision::api::Session;
use jollof_supervision::config::initial_latch;
use jollof_supervision::*;
use maisa_core::design::time_to_threshold;
use maisa_core::State;
use serde_json::{json, Value};

const DT: f64 = 0.1;

fn axis(id: &str, source: &str) -> ChannelDef {
    ChannelDef {
        id: id.into(),
        name: format!("Rail {id}"),
        kind: ChannelKind::Axis {
            source: source.into(),
            lo: 4.5,
            hi: 5.5,
            scale: 0.5,
            deadband: 0.0,
            weight: 1.0,
            hard_lo: None,
            hard_hi: None,
        },
        acc: AccParams {
            alpha: 1.0,
            z_crit: 1.0,
            z_enter: 0.5,
            z_exit: 0.2,
            t_stable: 0.5,
            z_max: None,
            guard_band: None,
            required: true,
        },
    }
}
fn relation() -> ChannelDef {
    ChannelDef {
        id: "rel".into(),
        name: "Vérin sorti après la commande".into(),
        kind: ChannelKind::Relationship {
            signal_a: "pos".into(),
            signal_b: "cmd".into(),
            threshold: 0.98,
            delay: 2.0,
            scale: 0.5,
            deadband: 0.0,
            gain: 1.0,
        },
        acc: AccParams {
            alpha: 1.0,
            z_crit: 1.0,
            z_enter: 0.5,
            z_exit: 0.2,
            t_stable: 0.5,
            z_max: None,
            guard_band: None,
            required: true,
        },
    }
}
fn cfg(channels: Vec<ChannelDef>) -> SupervisionConfig {
    SupervisionConfig {
        dt_max: 0.5,
        channels,
        ..SupervisionConfig::default()
    }
}
fn snap(v: f64) -> SignalSnapshot {
    SignalSnapshot::from_pairs(&[("v", v)])
}
/// Avance de `n` pas à la valeur `v` ; rend le temps atteint et le dernier état.
fn run(s: &mut Supervisor, t: &mut f64, n: usize, v: f64) -> &'static str {
    let mut state = "";
    for _ in 0..n {
        *t += DT;
        state = s.step(*t, &snap(v)).unwrap().state;
    }
    state
}

#[test]
fn nominal_stays_normal_for_10000_steps() {
    let mut s = Supervisor::new(cfg(vec![axis("a", "v"), relation()]), false, 0.0).unwrap();
    let mut t = 0.0;
    for k in 0..10_000 {
        t += DT;
        // Rail qui ondule dans sa plage ; commande périodique suivie à temps par le vérin.
        let v = 5.0 + 0.4 * (k as f64 * 0.01).sin();
        let cmd = if (k / 100) % 2 == 1 { 1.0 } else { 0.0 };
        let pos = if cmd > 0.5 && k % 100 >= 10 { 1.0 } else { 0.0 };
        let f = s
            .step(
                t,
                &SignalSnapshot::from_pairs(&[("v", v), ("cmd", cmd), ("pos", pos)]),
            )
            .unwrap();
        assert_eq!(f.state, "normal", "pas {k}");
        assert!(!f.latch && f.clock_ok && !f.evidence.c && !f.evidence.w);
    }
    assert_eq!(s.ticks(), 10_000);
    assert_eq!(s.attempts(), 0);
}

#[test]
fn persistent_fault_reaches_safe_requested_in_time_then_ordered_recovery() {
    let c = cfg(vec![axis("a", "v")]);
    let dt_max = c.dt_max;
    let params = c.validate().unwrap()[0];
    let mut s = Supervisor::new(c, false, 0.0).unwrap();
    let mut t = 0.0;
    assert_eq!(run(&mut s, &mut t, 50, 5.0), "normal");
    // Défaut : 3,5 V, soit 1 V sous la plage, p = 2.
    let t_fault = t;
    let bound = time_to_threshold(
        params.alpha,
        2.0,
        params.z_crit - params.guard_band,
        s.value(0).unwrap(),
    ) + dt_max;
    let mut detected = None;
    let mut saw_degraded = false;
    while t < t_fault + 5.0 {
        t += DT;
        let f = s.step(t, &snap(3.5)).unwrap();
        saw_degraded |= f.state == "degraded";
        if f.state == "safe_requested" {
            assert!(f.latch && f.latch_changed && f.request_safe_state);
            assert!(f.events.iter().any(|e| matches!(
                e,
                Event::Request {
                    outcome: "accepted",
                    ..
                }
            )));
            detected = Some(t - t_fault);
            break;
        }
    }
    let detected = detected.expect("le défaut doit être détecté");
    assert!(
        detected <= bound + 1e-9,
        "détecté en {detected} s, borne {bound} s"
    );
    assert!(saw_degraded, "l'avertissement précède l'événement critique");

    // Défaut retiré : le verrou tient, l'état ne revient pas à la normale tout seul.
    for _ in 0..200 {
        t += DT;
        let f = s.step(t, &snap(5.0)).unwrap();
        assert_eq!(f.state, "safe_requested");
        assert!(f.latch);
    }
    // L'ordre est imposé : ni vérification ni réarmement avant la confirmation.
    assert!(matches!(
        s.operator(OperatorAction::VerifyRecovery),
        Err(SupervisionError::Rejected(_))
    ));
    assert!(matches!(
        s.operator(OperatorAction::AuthorisedReset),
        Err(SupervisionError::Rejected(_))
    ));
    s.operator(OperatorAction::ConfirmSafeState).unwrap();
    assert_eq!(run(&mut s, &mut t, 1, 5.0), "safe_confirmed");
    assert_eq!(run(&mut s, &mut t, 1, 5.0), "locked_recovery");
    assert_eq!(run(&mut s, &mut t, 20, 5.0), "locked_recovery");
    // Réarmement sans vérification : refusé.
    assert!(matches!(
        s.operator(OperatorAction::AuthorisedReset),
        Err(SupervisionError::Rejected(_))
    ));
    s.operator(OperatorAction::VerifyRecovery).unwrap();
    assert_eq!(run(&mut s, &mut t, 5, 5.0), "locked_recovery");
    assert!(s.latch());
    s.operator(OperatorAction::AuthorisedReset).unwrap();
    t += DT;
    let f = s.step(t, &snap(5.0)).unwrap();
    assert!(!f.latch && f.latch_changed);
    assert_eq!(f.state, "normal");
    assert_eq!(f.engine.attempts, 0);
    assert_eq!(run(&mut s, &mut t, 50, 5.0), "normal");
}

#[test]
fn relapse_during_recovery_needs_fresh_confirmation() {
    let mut s = Supervisor::new(cfg(vec![axis("a", "v")]), false, 0.0).unwrap();
    let mut t = 0.0;
    run(&mut s, &mut t, 30, 3.5);
    run(&mut s, &mut t, 100, 5.0);
    s.operator(OperatorAction::ConfirmSafeState).unwrap();
    run(&mut s, &mut t, 3, 5.0);
    s.operator(OperatorAction::VerifyRecovery).unwrap();
    assert_eq!(run(&mut s, &mut t, 1, 5.0), "locked_recovery");
    // Le défaut revient avant le réarmement : retour en demande d'état sûr, sans confirmation ancienne.
    assert_eq!(run(&mut s, &mut t, 30, 3.5), "safe_requested");
    assert_eq!(run(&mut s, &mut t, 5, 3.5), "safe_requested");
}

#[test]
fn sensor_loss_holds_accumulator_bit_for_bit_and_state_is_unknown() {
    let mut s = Supervisor::new(cfg(vec![axis("a", "v")]), false, 0.0).unwrap();
    let mut t = 0.0;
    run(&mut s, &mut t, 20, 5.0);
    run(&mut s, &mut t, 2, 5.8); // petit écart : z > 0, sous le seuil d'avertissement
    let before = s.value(0).unwrap();
    assert!(before > 0.0 && before < 0.5);
    let id = s
        .faults_mut()
        .add(FaultSpec::Loss { signal: "v".into() })
        .unwrap();
    for _ in 0..100 {
        t += DT;
        let f = s.step(t, &snap(5.8)).unwrap();
        assert_eq!(f.state, "unknown");
        assert!(!f.channels[0].valid && f.channels[0].p.is_none());
        assert_eq!(f.channels[0].value.to_bits(), before.to_bits());
    }
    // Signal absent de l'instantané, ou non fini : même traitement, jamais remplacé par zéro.
    t += DT;
    assert_eq!(
        s.step(t, &SignalSnapshot::default()).unwrap().state,
        "unknown"
    );
    s.faults_mut().clear(id).unwrap();
    t += DT;
    assert_eq!(s.step(t, &snap(f64::NAN)).unwrap().state, "unknown");
    t += DT;
    assert_eq!(s.step(t, &snap(f64::INFINITY)).unwrap().state, "unknown");
    assert_eq!(s.value(0).unwrap().to_bits(), before.to_bits());
    // Retour de la mesure : l'accumulateur reprend de là où il était, sans mesure inventée pour la coupure.
    t += DT;
    let f = s.step(t, &snap(5.0)).unwrap();
    assert_eq!(f.state, "normal");
    assert!(f.channels[0].value < before);
}

#[test]
fn pause_produces_no_tick_and_no_clock_fault() {
    let mut s = Supervisor::new(cfg(vec![axis("a", "v"), relation()]), false, 0.0).unwrap();
    let both =
        |cmd: f64, pos: f64| SignalSnapshot::from_pairs(&[("v", 5.0), ("cmd", cmd), ("pos", pos)]);
    let mut t = 0.0;
    for _ in 0..10 {
        t += DT;
        s.step(t, &both(0.0, 0.0)).unwrap();
    }
    t += DT;
    s.step(t, &both(1.0, 0.0)).unwrap(); // commande : échéance dans 2 s de temps simulé
    let (ticks, z) = (s.ticks(), s.value(0).unwrap().to_bits());
    // Pause : la simulation n'avance pas, donc aucun appel. Une heure d'horloge murale peut passer.
    assert_eq!(s.ticks(), ticks);
    assert_eq!(s.value(0).unwrap().to_bits(), z);
    // Reprise : le temps simulé repart d'où il était, sans défaut d'horloge, et l'échéance n'a pas avancé.
    for k in 0..19 {
        t += DT;
        let f = s.step(t, &both(1.0, 0.0)).unwrap();
        assert!(f.clock_ok);
        assert_eq!(f.channels[1].phase, Some("pending"), "pas {k}");
    }
    t += DT;
    assert_eq!(
        s.step(t, &both(1.0, 0.0)).unwrap().channels[1].phase,
        Some("violating")
    );
}

#[test]
fn clock_faults_hold_everything() {
    let mut s = Supervisor::new(cfg(vec![axis("a", "v")]), false, 0.0).unwrap();
    let mut t = 0.0;
    run(&mut s, &mut t, 5, 5.8);
    let z = s.value(0).unwrap().to_bits();
    // Temps qui recule, qui se répète, non fini, ou pas plus grand que dt_max : défaut d'horloge, accumulateur tenu.
    for bad in [t - 0.05, f64::NAN, f64::INFINITY] {
        let f = s.step(bad, &snap(5.8)).unwrap();
        assert!(!f.clock_ok);
        assert_eq!(f.state, "unknown");
        assert!(f.events.contains(&Event::ClockFault));
    }
    assert_eq!(s.value(0).unwrap().to_bits(), z);
    let mut s = Supervisor::new(cfg(vec![axis("a", "v")]), false, 0.0).unwrap();
    assert!(s.step(0.1, &snap(5.0)).unwrap().clock_ok);
    assert!(!s.step(0.1, &snap(5.0)).unwrap().clock_ok);
    assert!(
        !s.step(0.1 + 0.51, &snap(5.0)).unwrap().clock_ok,
        "pas plus grand que dt_max"
    );
    assert!(
        s.step(0.1 + 0.51 + 0.5, &snap(5.0)).unwrap().clock_ok,
        "pas égal à dt_max accepté"
    );
}

#[test]
fn relationship_detects_stuck_actuator_and_hard_limit_is_immediate() {
    let mut s = Supervisor::new(cfg(vec![relation()]), false, 0.0).unwrap();
    let sig = |cmd: f64, pos: f64| SignalSnapshot::from_pairs(&[("cmd", cmd), ("pos", pos)]);
    let mut t = 0.0;
    for _ in 0..10 {
        t += DT;
        assert_eq!(s.step(t, &sig(0.0, 0.0)).unwrap().state, "normal");
    }
    // Actionneur bloqué, vu de la supervision : la position observée reste à 0 alors que le vérin simulé sort.
    s.faults_mut()
        .add(FaultSpec::StuckActuator {
            signal: "pos".into(),
        })
        .unwrap();
    t += DT;
    s.step(t, &sig(0.0, 0.0)).unwrap();
    let t_cmd = t + DT;
    let mut detected = None;
    for _ in 0..80 {
        t += DT;
        let f = s.step(t, &sig(1.0, 1.0)).unwrap();
        if f.state == "safe_requested" {
            detected = Some(t - t_cmd);
            break;
        }
    }
    // Échéance 2 s, puis p = 0,98 / 0,5 = 1,96 jusqu'au seuil : T = ln(1,96 / 0,96) ≈ 0,714 s, plus un pas.
    let d = detected.expect("relation violée détectée");
    let bound = 2.0 + time_to_threshold(1.0, 1.96, 1.0, 0.0) + 0.5;
    assert!(
        d > 2.0 && d <= bound,
        "détecté {d} s après la commande, borne {bound}"
    );

    // Limite dure : preuve H au pas même, sans attendre l'accumulateur.
    let mut ch = axis("a", "v");
    if let ChannelKind::Axis { hard_hi, .. } = &mut ch.kind {
        *hard_hi = Some(6.0);
    }
    let mut s = Supervisor::new(cfg(vec![ch]), false, 0.0).unwrap();
    assert_eq!(s.step(0.1, &snap(5.0)).unwrap().state, "normal");
    let f = s.step(0.2, &snap(6.5)).unwrap();
    assert!(f.evidence.h && f.latch && f.channels[0].hard);
    assert_eq!(f.state, "safe_requested");
    assert!(
        f.channels[0].value < 1.0,
        "l'accumulateur est encore loin du seuil"
    );
}

#[test]
fn intervention_budget_timeout_escalation_and_reset() {
    let mut c = cfg(vec![axis("a", "v")]);
    c.engine = EngineConfig {
        n_max: 1,
        t_cooldown: 0.5,
        t_timeout: 1.0,
    };
    let mut s = Supervisor::new(c, false, 0.0).unwrap();
    let mut t = 0.0;
    assert_eq!(run(&mut s, &mut t, 9, 3.5), "safe_requested");
    assert_eq!(s.attempts(), 1);
    // Personne ne confirme : la demande expire (échec) et, budget épuisé, le moteur escalade (preuve S).
    let mut escalated = false;
    for _ in 0..15 {
        t += DT;
        let f = s.step(t, &snap(5.0)).unwrap();
        if f.events.contains(&Event::Escalated) {
            assert!(f
                .events
                .iter()
                .any(|e| matches!(e, Event::Resolved { success: false, .. })));
            assert!(f.evidence.s && f.engine.escalated);
            escalated = true;
        }
    }
    assert!(escalated);
    // Tant que l'escalade dure, la reprise est impossible : S maintient l'événement critique.
    run(&mut s, &mut t, 100, 5.0);
    s.operator(OperatorAction::ConfirmSafeState).unwrap();
    assert_eq!(run(&mut s, &mut t, 5, 5.0), "safe_confirmed");
    // Le réarmement autorisé rend la main au moteur ; la reprise suit alors son ordre.
    s.operator(OperatorAction::AuthorisedReset).unwrap();
    assert_eq!(run(&mut s, &mut t, 2, 5.0), "locked_recovery");
    assert!(s.latch());
    s.operator(OperatorAction::VerifyRecovery).unwrap();
    s.operator(OperatorAction::AuthorisedReset).unwrap();
    assert_eq!(run(&mut s, &mut t, 1, 5.0), "normal");
    assert!(!s.latch());
}

#[test]
fn configuration_is_validated() {
    let many: Vec<_> = (0..17).map(|i| axis(&format!("c{i}"), "v")).collect();
    assert_eq!(
        Supervisor::new(cfg(many), false, 0.0).err(),
        Some(SupervisionError::TooManyChannels { given: 17, max: 16 })
    );
    assert!(Supervisor::new(
        cfg((0..16).map(|i| axis(&format!("c{i}"), "v")).collect()),
        false,
        0.0
    )
    .is_ok());
    assert_eq!(
        Supervisor::new(cfg(vec![axis("a", "v"), axis("a", "v")]), false, 0.0).err(),
        Some(SupervisionError::DuplicateChannel("a".into()))
    );
    let mut bad = axis("a", "v");
    bad.acc.z_exit = 0.6; // z_exit >= z_enter
    assert!(matches!(
        Supervisor::new(cfg(vec![bad]), false, 0.0),
        Err(SupervisionError::Channel { .. })
    ));
    let mut bad = axis("a", "v");
    bad.acc.alpha = f64::NAN;
    assert!(Supervisor::new(cfg(vec![bad]), false, 0.0).is_err());
    let mut bad = axis("a", "v");
    if let ChannelKind::Axis { scale, .. } = &mut bad.kind {
        *scale = 0.0;
    }
    assert!(Supervisor::new(cfg(vec![bad]), false, 0.0).is_err());
    let mut c = cfg(vec![axis("a", "v")]);
    c.dt_max = 0.01; // pas plus grand que dt_min
    assert!(matches!(
        Supervisor::new(c, false, 0.0),
        Err(SupervisionError::Config(_))
    ));
    // Canaux non requis et places libres : une mesure absente n'y rend pas l'état inconnu.
    let mut opt = axis("b", "absent");
    opt.acc.required = false;
    let mut s = Supervisor::new(cfg(vec![axis("a", "v"), opt]), false, 0.0).unwrap();
    assert_eq!(s.step(0.1, &snap(5.0)).unwrap().state, "normal");
}

#[test]
fn config_and_latch_round_trip() {
    let c = cfg(vec![axis("a", "v"), relation()]);
    let text = serde_json::to_string(&c).unwrap();
    let back: SupervisionConfig = serde_json::from_str(&text).unwrap();
    assert_eq!(back, c);
    // Champs absents : valeurs par défaut ; un projet d'avant garde sa configuration lisible.
    let partial: SupervisionConfig = serde_json::from_value(json!({ "channels": [] })).unwrap();
    assert_eq!(partial, SupervisionConfig::default());
    // Verrou : jamais enregistré → ouvert ; enregistré → sa valeur ; illisible → fermé.
    assert!(!initial_latch(None));
    assert!(initial_latch(Some(&json!(true))));
    assert!(!initial_latch(Some(&json!(false))));
    assert!(initial_latch(Some(&Value::Null)));
    assert!(initial_latch(Some(&json!("oui"))));
    // Verrou fermé relu : le superviseur repart en demande d'état sûr, même sans défaut.
    let mut s = Supervisor::new(c, true, 0.0).unwrap();
    let f = s
        .step(
            0.1,
            &SignalSnapshot::from_pairs(&[("v", 5.0), ("cmd", 0.0), ("pos", 0.0)]),
        )
        .unwrap();
    assert_eq!(f.state, "safe_requested");
    assert!(f.latch && !f.latch_changed);
    assert_eq!(s.state(), State::SafeRequested);
}

#[test]
fn json_api_end_to_end() {
    let mut sess = Session::default();
    assert!(
        sess.handle("step", &json!({ "t": 0.1, "signals": [] }))
            .is_err(),
        "pas configurée"
    );
    // Défaut ajouté avant la configuration : gardé.
    let id = sess
        .handle(
            "fault_add",
            &json!({ "fault": { "kind": "offset", "signal": "v", "bias": -1.5 } }),
        )
        .unwrap()["id"]
        .as_u64()
        .unwrap();
    let c = serde_json::to_value(cfg(vec![axis("a", "v")])).unwrap();
    assert_eq!(
        sess.handle("configure", &json!({ "config": c, "never_saved": true }))
            .unwrap()["latch"],
        json!(false)
    );
    assert_eq!(
        sess.handle("fault_list", &Value::Null)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut last = Value::Null;
    for k in 1..=30 {
        last = sess
            .handle(
                "step",
                &json!({ "t": k as f64 * 0.1, "signals": [{ "id": "v", "value": 5.0 }] }),
            )
            .unwrap();
    }
    assert_eq!(last["state"], "safe_requested");
    assert_eq!(last["channels"][0]["name"], "Rail a");
    sess.handle("fault_clear", &json!({ "id": id })).unwrap();
    assert!(sess.handle("fault_clear", &json!({ "id": id })).is_err());
    assert!(sess
        .handle("operator", &json!({ "action": "reset" }))
        .is_err());
    sess.handle("operator", &json!({ "action": "confirm" }))
        .unwrap();
    // Valeur nulle (mesure absente) : canal invalide.
    let f = sess
        .handle(
            "step",
            &json!({ "t": 3.1, "signals": [{ "id": "v", "value": null }] }),
        )
        .unwrap();
    assert_eq!(f["channels"][0]["valid"], json!(false));
    assert!(sess
        .handle("configure", &json!({ "config": c, "latch": "illisible" }))
        .unwrap()["latch"]
        .as_bool()
        .unwrap());
    assert!(sess.handle("design", &json!({ "tol_dev": 0.2, "tol_time": 1.0, "det_dev": 1.0, "det_time": 3.0, "scale": 0.5, "dt_max": 0.6, "dt_min": 0.016 })).unwrap()["feasible"].as_bool().unwrap());
    assert!(sess.handle("nope", &Value::Null).is_err());
    let t = sess
        .handle(
            "detect_time",
            &json!({ "alpha": 1.0, "p0": 5.0, "z_crit": 0.8 }),
        )
        .unwrap()["t"]
        .as_f64()
        .unwrap();
    assert!((t - time_to_threshold(1.0, 5.0, 0.8, 0.0)).abs() < 1e-12);
    assert!(
        sess.handle(
            "detect_time",
            &json!({ "alpha": 1.0, "p0": 0.5, "z_crit": 0.8 })
        )
        .unwrap()["t"]
            .is_null(),
        "jamais atteint"
    );
    assert!(sess
        .handle(
            "detect_time",
            &json!({ "alpha": 0.0, "p0": 1.0, "z_crit": 0.8 })
        )
        .is_err());
}

#[test]
fn simultaneous_and_repeated_faults() {
    let mut s = Supervisor::new(cfg(vec![axis("a", "v"), axis("b", "w")]), false, 0.0).unwrap();
    let two = SignalSnapshot::from_pairs(&[("v", 5.0), ("w", 5.0)]);
    let a = s
        .faults_mut()
        .add(FaultSpec::Burst {
            signal: "v".into(),
            bias: 2.0,
            t_on: 0.2,
            t_off: 1.8,
        })
        .unwrap();
    let mut t = 0.0;
    // Rafales courtes sur v : l'accumulateur monte et redescend sans atteindre le seuil critique.
    for _ in 0..200 {
        t += DT;
        let f = s.step(t, &two).unwrap();
        assert!(!f.latch, "une rafale brève ne verrouille pas");
        assert_eq!(f.channels[1].value, 0.0, "le canal voisin n'est pas touché");
    }
    // Un second défaut, persistant, sur l'autre canal : lui seul devient critique (pas de moyenne entre canaux).
    s.faults_mut()
        .add(FaultSpec::Offset {
            signal: "w".into(),
            bias: 0.0,
            drift: 0.5,
        })
        .unwrap();
    let mut f_state = "";
    for _ in 0..100 {
        t += DT;
        let f = s.step(t, &two).unwrap();
        f_state = f.state;
        if f.latch {
            assert!(f.channels[1].critical && !f.channels[0].critical);
            break;
        }
    }
    assert_eq!(f_state, "safe_requested");
    s.faults_mut().clear(a).unwrap();
    assert_eq!(s.faults().list().len(), 1);
}

#[test]
fn malformed_commands_never_panic_and_always_answer() {
    // Tout ce que la fenêtre pourrait envoyer de travers : chaque commande reçoit une erreur lisible, jamais un plantage.
    let junk = [
        Value::Null,
        json!(1),
        json!("x"),
        json!([]),
        json!({}),
        json!({ "t": "nan", "signals": 3 }),
        json!({ "t": f64::MAX, "signals": [{ "id": 7 }] }),
        json!({ "config": { "channels": "no" } }),
        json!({ "config": { "dt_max": -1.0, "channels": [] } }),
        json!({ "action": 42 }),
        json!({ "fault": { "kind": "burst", "signal": "v", "bias": 1, "t_on": -1, "t_off": 1 } }),
        json!({ "id": -3 }),
        json!({ "alpha": 1e308, "p0": 1e308, "z_crit": 1e-308 }),
    ];
    let cmds = [
        "configure",
        "step",
        "operator",
        "fault_add",
        "fault_clear",
        "fault_clear_all",
        "fault_list",
        "validate",
        "design",
        "detect_time",
        "stop",
        "nope",
    ];
    for cfg_first in [false, true] {
        let mut sess = Session::default();
        if cfg_first {
            let c = serde_json::to_value(cfg(vec![axis("a", "v")])).unwrap();
            sess.handle("configure", &json!({ "config": c, "never_saved": true }))
                .unwrap();
        }
        for cmd in cmds {
            for a in &junk {
                let _ = sess.handle(cmd, a);
            }
        }
        // Toujours utilisable après tout cela.
        let c = serde_json::to_value(cfg(vec![axis("a", "v")])).unwrap();
        sess.handle("configure", &json!({ "config": c, "never_saved": true }))
            .unwrap();
        let f = sess
            .handle(
                "step",
                &json!({ "t": 0.1, "signals": [{ "id": "v", "value": 5.0 }] }),
            )
            .unwrap();
        assert_eq!(f["state"], "normal");
    }
}
