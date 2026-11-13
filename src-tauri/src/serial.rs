// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//
// Carte réelle branchée en USB (simulation avec du vrai matériel) : liste des ports série, ouverture, écriture,
// lecture en continu. Les octets reçus partent vers l'interface par un canal (tauri::ipc::Channel), sans attente.
// Seuls les ports que le système déclare comme ports série peuvent être ouverts : l'interface ne peut pas s'en
// servir pour lire ou écrire un fichier quelconque.
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct PortInfo {
    pub name: String,
    /// "usb", "bluetooth", "pci" ou "unknown"
    pub kind: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
}

struct Open {
    port: Box<dyn serialport::SerialPort>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Ports {
    open: Mutex<HashMap<u32, Open>>,
    next: AtomicU32,
}

/// Débits acceptés (ceux du moniteur série de l'IDE Arduino, jusqu'à 921 600 pour les ESP32).
pub const BAUDS: [u32; 13] = [
    300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 921600,
];

fn list() -> Vec<PortInfo> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let (kind, vid, pid, product, manufacturer) = match p.port_type {
                serialport::SerialPortType::UsbPort(u) => {
                    ("usb", Some(u.vid), Some(u.pid), u.product, u.manufacturer)
                }
                serialport::SerialPortType::BluetoothPort => ("bluetooth", None, None, None, None),
                serialport::SerialPortType::PciPort => ("pci", None, None, None, None),
                serialport::SerialPortType::Unknown => ("unknown", None, None, None, None),
            };
            PortInfo {
                name: p.port_name,
                kind: kind.into(),
                vid,
                pid,
                product,
                manufacturer,
            }
        })
        .collect()
}

/// Le port demandé doit figurer dans la liste du système, et le débit être un débit usuel.
pub fn check_open(name: &str, baud: u32, known: &[PortInfo]) -> Result<(), String> {
    if !BAUDS.contains(&baud) {
        return Err(format!("débit non pris en charge : {baud}"));
    }
    if !known.iter().any(|p| p.name == name) {
        return Err(format!("port série inconnu : {name}"));
    }
    Ok(())
}

#[tauri::command]
pub fn serial_list() -> Vec<PortInfo> {
    list()
}

/// Ouvre le port ; les octets reçus arrivent par `on_data` jusqu'à la fermeture (ou la carte débranchée :
/// un tableau vide signale la fin). Rend l'identifiant du port ouvert.
#[tauri::command]
pub fn serial_open(
    state: State<'_, Ports>,
    name: String,
    baud: u32,
    on_data: Channel<Vec<u8>>,
) -> Result<u32, String> {
    check_open(&name, baud, &list())?;
    let port = serialport::new(&name, baud)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(|e| e.to_string())?;
    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let flag = stop.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while !flag.load(Ordering::Relaxed) {
            match reader.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => break,
            }
        }
        let _ = on_data.send(Vec::new());
    });
    state
        .open
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, Open { port, stop });
    Ok(id)
}

#[tauri::command]
pub fn serial_write(state: State<'_, Ports>, id: u32, bytes: Vec<u8>) -> Result<(), String> {
    let mut map = state.open.lock().map_err(|e| e.to_string())?;
    let o = map.get_mut(&id).ok_or("port fermé")?;
    o.port.write_all(&bytes).map_err(|e| e.to_string())
}

/// DTR : une impulsion redémarre la plupart des cartes Arduino (comme à l'ouverture du moniteur série).
#[tauri::command]
pub fn serial_reset(state: State<'_, Ports>, id: u32) -> Result<(), String> {
    let mut map = state.open.lock().map_err(|e| e.to_string())?;
    let o = map.get_mut(&id).ok_or("port fermé")?;
    o.port
        .write_data_terminal_ready(false)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_millis(50));
    o.port
        .write_data_terminal_ready(true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn serial_close(state: State<'_, Ports>, id: u32) -> Result<(), String> {
    if let Some(o) = state.open.lock().map_err(|e| e.to_string())?.remove(&id) {
        o.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(name: &str) -> PortInfo {
        PortInfo {
            name: name.into(),
            kind: "usb".into(),
            vid: Some(0x2341),
            pid: Some(0x0043),
            product: None,
            manufacturer: None,
        }
    }

    #[test]
    fn open_only_known_ports_at_usual_speeds() {
        let known = [port("/dev/cu.usbmodem1101")];
        assert!(check_open("/dev/cu.usbmodem1101", 57600, &known).is_ok());
        assert!(check_open("/dev/cu.usbmodem1101", 123456, &known).is_err());
        assert!(check_open("/dev/cu.usbmodem1101", 921600, &known).is_ok());
        assert!(check_open("/etc/passwd", 57600, &known).is_err());
        assert!(check_open("/dev/cu.usbmodem1102", 57600, &known).is_err());
    }
}
