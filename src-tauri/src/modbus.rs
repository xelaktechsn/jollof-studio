// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Serveur Modbus TCP de l'automate simulé : une IHM, un SCADA ou un autre automate lisent ses entrées, ses sorties,
//! ses mémoires, ses temporisations et ses compteurs, et peuvent appuyer sur les boutons de son pupitre.
//!
//! La fenêtre calcule l'image des variables (src/plc/modbus.js) et l'envoie ici (`modbus_image`) quelques fois par
//! seconde ; le serveur répond aux clients depuis cette image, sans attendre la fenêtre. Une écriture d'un client
//! n'est acceptée que sur les bobines déclarées inscriptibles (les boutons du pupitre) ; elle part vers la fenêtre
//! par un canal, qui appuie sur le bouton comme la souris.
//!
//! Plan des adresses (le même que la table affichée dans le panneau Automate) :
//!   entrées TOR (fonction 2)        0…   les entrées %I (8 par mot : %I1.2 → 10)
//!   bobines (fonctions 1, 5, 15)    0…   les sorties %Q (lecture)
//!                                   100… les boutons du pupitre (lecture et écriture)
//!                                   200… les mémoires %M (lecture)
//!   registres d'entrée (fonction 4) 0…   temps écoulé des temporisations %TM (dixièmes de seconde)
//!                                   100… valeur des compteurs %C
//!                                   200  numéro du cycle (modulo 65 536), 201 : 1 si le programme est en erreur
//!
//! Sécurité : arrêté par défaut ; démarré, il écoute sur 127.0.0.1 seulement, sauf si l'utilisateur choisit le
//! réseau local (Modbus n'a pas de mot de passe : tout appareil du réseau peut alors lire et appuyer). Aucune
//! écriture ne touche autre chose que les boutons du pupitre.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::{ready, Ready};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;
use tokio_modbus::server::tcp::{accept_tcp_connection, Server};
use tokio_modbus::{ExceptionCode, Request, Response};

/// Taille de chaque table : bien au-delà de ce qu'écrit l'automate (32 entrées du pupitre, 600 éléments).
pub const MAX_TABLE: usize = 1024;
/// Une écriture d'un client l'emporte sur l'image de la fenêtre le temps que celle-ci l'ait prise en compte.
const PENDING: Duration = Duration::from_millis(1500);

type OnWrite = Box<dyn Fn(u16, bool) + Send + Sync>;

#[derive(Default)]
struct Image {
    di: Vec<bool>,
    coils: Vec<bool>,
    writable: Vec<bool>,
    ir: Vec<u16>,
    /// Écritures des clients pas encore revenues dans l'image de la fenêtre.
    pending: HashMap<u16, (bool, Instant)>,
}

#[derive(Default)]
pub struct Shared {
    image: Mutex<Image>,
    on_write: Mutex<Option<OnWrite>>,
}

impl Shared {
    fn lock(&self) -> std::sync::MutexGuard<'_, Image> {
        self.image.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// Nouvelle image de la fenêtre ; les écritures récentes des clients y restent tant qu'elle ne les a pas prises.
    fn set_image(&self, di: Vec<bool>, coils: Vec<bool>, writable: Vec<bool>, ir: Vec<u16>) {
        let mut g = self.lock();
        g.di = di.into_iter().take(MAX_TABLE).collect();
        g.coils = coils.into_iter().take(MAX_TABLE).collect();
        g.writable = writable.into_iter().take(MAX_TABLE).collect();
        g.ir = ir.into_iter().take(MAX_TABLE).collect();
        let now = Instant::now();
        let Image { coils, pending, .. } = &mut *g;
        pending.retain(|&a, &mut (v, t)| {
            let i = a as usize;
            let seen = coils.get(i).copied() == Some(v);
            let keep = !seen && now.duration_since(t) < PENDING;
            if keep {
                if let Some(c) = coils.get_mut(i) {
                    *c = v;
                }
            }
            keep
        });
    }
    fn bits(table: &[bool], addr: u16, qty: u16) -> Result<Vec<bool>, ExceptionCode> {
        let (a, n) = (addr as usize, qty as usize);
        if n == 0 || n > 2000 {
            return Err(ExceptionCode::IllegalDataValue);
        }
        table
            .get(a..a + n)
            .map(<[bool]>::to_vec)
            .ok_or(ExceptionCode::IllegalDataAddress)
    }
    fn write(&self, addr: u16, values: &[bool]) -> Result<(), ExceptionCode> {
        if values.is_empty() || values.len() > 1968 {
            return Err(ExceptionCode::IllegalDataValue);
        }
        let changed: Vec<(u16, bool)> = {
            let mut g = self.lock();
            let a = addr as usize;
            let ok = g
                .writable
                .get(a..a + values.len())
                .is_some_and(|w| w.iter().all(|&x| x));
            if !ok || g.coils.len() < a + values.len() {
                return Err(ExceptionCode::IllegalDataAddress);
            }
            let now = Instant::now();
            values
                .iter()
                .enumerate()
                .map(|(k, &v)| {
                    let at = addr + k as u16;
                    g.coils[at as usize] = v;
                    g.pending.insert(at, (v, now));
                    (at, v)
                })
                .collect()
        };
        if let Some(f) = self
            .on_write
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            for (a, v) in changed {
                f(a, v);
            }
        }
        Ok(())
    }
    fn handle(&self, req: Request<'static>) -> Result<Response, ExceptionCode> {
        match req {
            Request::ReadCoils(a, n) => {
                Self::bits(&self.lock().coils, a, n).map(Response::ReadCoils)
            }
            Request::ReadDiscreteInputs(a, n) => {
                Self::bits(&self.lock().di, a, n).map(Response::ReadDiscreteInputs)
            }
            Request::ReadInputRegisters(a, n) => {
                let (s, q) = (a as usize, n as usize);
                if q == 0 || q > 125 {
                    return Err(ExceptionCode::IllegalDataValue);
                }
                self.lock()
                    .ir
                    .get(s..s + q)
                    .map(|w| Response::ReadInputRegisters(w.to_vec()))
                    .ok_or(ExceptionCode::IllegalDataAddress)
            }
            Request::WriteSingleCoil(a, v) => self
                .write(a, &[v])
                .map(|()| Response::WriteSingleCoil(a, v)),
            Request::WriteMultipleCoils(a, vs) => self
                .write(a, &vs)
                .map(|()| Response::WriteMultipleCoils(a, vs.len() as u16)),
            _ => Err(ExceptionCode::IllegalFunction),
        }
    }
}

#[derive(Clone)]
struct Svc(Arc<Shared>);
impl tokio_modbus::server::Service for Svc {
    type Request = Request<'static>;
    type Response = Response;
    type Exception = ExceptionCode;
    type Future = Ready<Result<Response, ExceptionCode>>;
    fn call(&self, req: Self::Request) -> Self::Future {
        ready(self.0.handle(req))
    }
}

/// Sert les clients de `listener` jusqu'à ce que `stop` soit envoyé (ou abandonné).
fn spawn_server(
    listener: tokio::net::TcpListener,
    shared: Arc<Shared>,
) -> tokio::sync::oneshot::Sender<()> {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let server = Server::new(listener);
        let on_connected = move |stream, addr: SocketAddr| {
            let svc = Svc(shared.clone());
            log::info!("Modbus : client {addr}");
            async move { accept_tcp_connection(stream, addr, move |_| Ok(Some(svc.clone()))) }
        };
        let stop = async move {
            let _ = rx.await;
        };
        if let Err(e) = server
            .serve_until(&on_connected, |e| log::warn!("Modbus : {e}"), stop)
            .await
        {
            log::warn!("Modbus arrêté : {e}");
        }
    });
    tx
}

#[derive(Default)]
pub struct Modbus {
    shared: Arc<Shared>,
    stop: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}
impl Modbus {
    /// Arrête le serveur (fermeture de l'application, arrêt demandé).
    pub fn stop(&self) {
        if let Some(tx) = self.stop.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(());
            log::info!("Modbus : serveur arrêté");
        }
        *self
            .shared
            .on_write
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[derive(Serialize)]
pub struct Started {
    port: u16,
    lan: bool,
    /// Adresse de l'ordinateur sur le réseau local (pour régler l'IHM), si on la trouve.
    ip: Option<String>,
}

/// Adresse de l'ordinateur sur le réseau local : celle que le système choisirait pour sortir (aucun paquet envoyé).
fn local_ip() -> Option<IpAddr> {
    let s = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    s.connect((Ipv4Addr::new(192, 0, 2, 1), 502)).ok()?;
    s.local_addr()
        .ok()
        .map(|a| a.ip())
        .filter(|ip| !ip.is_unspecified())
}

/// Démarre (ou redémarre) le serveur. lan : écoute sur toutes les interfaces au lieu de 127.0.0.1. on_write reçoit
/// { addr, value } pour chaque bobine écrite par un client.
#[tauri::command]
pub async fn modbus_start(
    state: State<'_, Modbus>,
    port: u16,
    lan: bool,
    on_write: Channel<Value>,
) -> Result<Started, String> {
    state.stop();
    if port == 0 {
        return Err("Port invalide".into());
    }
    let ip = if lan {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    } else {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    };
    let listener = tokio::net::TcpListener::bind((ip, port))
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => format!(
                "Port {port} réservé par le système : choisissez un port au-dessus de 1024 (5020 par exemple)"
            ),
            std::io::ErrorKind::AddrInUse => {
                format!("Port {port} déjà utilisé par un autre logiciel")
            }
            _ => e.to_string(),
        })?;
    *state
        .shared
        .on_write
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(Box::new(move |addr, value| {
        let _ = on_write.send(json!({ "addr": addr, "value": value }));
    }));
    let tx = spawn_server(listener, state.shared.clone());
    *state.stop.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);
    log::info!(
        "Modbus : serveur sur {}:{port}",
        if lan { "0.0.0.0" } else { "127.0.0.1" }
    );
    Ok(Started {
        port,
        lan,
        ip: if lan {
            local_ip().map(|i| i.to_string())
        } else {
            Some("127.0.0.1".into())
        },
    })
}

#[tauri::command]
pub fn modbus_stop(state: State<'_, Modbus>) {
    state.stop();
}

/// Image des variables de l'automate, envoyée par la fenêtre.
#[tauri::command]
pub fn modbus_image(
    state: State<'_, Modbus>,
    di: Vec<bool>,
    coils: Vec<bool>,
    writable: Vec<bool>,
    ir: Vec<u16>,
) {
    state.shared.set_image(di, coils, writable, ir);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_modbus::client::{tcp, Reader, Writer};

    fn shared_with(writes: Arc<Mutex<Vec<(u16, bool)>>>) -> Arc<Shared> {
        let s = Arc::new(Shared::default());
        let mut coils = vec![false; 110];
        coils[0] = true; // %Q0.0
        let mut writable = vec![false; 110];
        writable[100] = true; // bouton du pupitre
        writable[101] = true;
        s.set_image(vec![true, false, true], coils, writable, vec![15, 3]);
        *s.on_write.lock().unwrap() =
            Some(Box::new(move |a, v| writes.lock().unwrap().push((a, v))));
        s
    }

    #[test]
    fn requests_are_served_from_the_image_and_writes_are_limited_to_the_pupitre() {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let s = shared_with(writes.clone());
        assert_eq!(
            s.handle(Request::ReadDiscreteInputs(0, 3)),
            Ok(Response::ReadDiscreteInputs(vec![true, false, true]))
        );
        assert_eq!(
            s.handle(Request::ReadCoils(0, 2)),
            Ok(Response::ReadCoils(vec![true, false]))
        );
        assert_eq!(
            s.handle(Request::ReadInputRegisters(0, 2)),
            Ok(Response::ReadInputRegisters(vec![15, 3]))
        );
        // Hors de l'image, quantité nulle ou trop grande, fonction non servie.
        assert_eq!(
            s.handle(Request::ReadDiscreteInputs(2, 5)),
            Err(ExceptionCode::IllegalDataAddress)
        );
        assert_eq!(
            s.handle(Request::ReadCoils(0, 0)),
            Err(ExceptionCode::IllegalDataValue)
        );
        assert_eq!(
            s.handle(Request::ReadInputRegisters(0, 126)),
            Err(ExceptionCode::IllegalDataValue)
        );
        assert_eq!(
            s.handle(Request::ReadHoldingRegisters(0, 1)),
            Err(ExceptionCode::IllegalFunction)
        );
        // Une sortie %Q ne s'écrit pas ; un bouton du pupitre, si.
        assert_eq!(
            s.handle(Request::WriteSingleCoil(0, false)),
            Err(ExceptionCode::IllegalDataAddress)
        );
        assert_eq!(
            s.handle(Request::WriteMultipleCoils(
                100,
                vec![true, true, true].into()
            )),
            Err(ExceptionCode::IllegalDataAddress)
        );
        assert_eq!(
            s.handle(Request::WriteSingleCoil(100, true)),
            Ok(Response::WriteSingleCoil(100, true))
        );
        assert_eq!(*writes.lock().unwrap(), vec![(100, true)]);
        // L'image suivante de la fenêtre (pas encore appuyée) ne l'efface pas ; celle qui l'a prise la confirme.
        let mut w = vec![false; 110];
        w[100] = true;
        s.set_image(vec![], vec![false; 110], w.clone(), vec![]);
        assert!(s.lock().coils[100]);
        let mut c = vec![false; 110];
        c[100] = true;
        s.set_image(vec![], c, w.clone(), vec![]);
        assert!(s.lock().pending.is_empty());
        s.set_image(vec![], vec![false; 110], w, vec![]);
        assert!(!s.lock().coils[100]);
    }

    #[test]
    fn a_real_client_reads_and_presses_over_tcp() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        tauri::async_runtime::set(rt.handle().clone());
        rt.block_on(async {
            let writes = Arc::new(Mutex::new(Vec::new()));
            let s = shared_with(writes.clone());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let stop = spawn_server(listener, s.clone());
            let mut ctx = tcp::connect(addr).await.unwrap();
            assert_eq!(
                ctx.read_discrete_inputs(0, 3).await.unwrap().unwrap(),
                vec![true, false, true]
            );
            assert_eq!(
                ctx.read_input_registers(1, 1).await.unwrap().unwrap(),
                vec![3]
            );
            ctx.write_single_coil(101, true).await.unwrap().unwrap();
            assert!(ctx.write_single_coil(5, true).await.unwrap().is_err());
            assert_eq!(*writes.lock().unwrap(), vec![(101, true)]);
            let _ = stop.send(());
            tokio::time::sleep(Duration::from_millis(50)).await;
            assert!(tcp::connect(addr).await.is_err(), "serveur arrêté");
        });
    }
}
