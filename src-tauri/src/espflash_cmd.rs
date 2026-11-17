// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Téléversement sur ESP32 sans esptool : la bibliothèque d'espflash parle directement au chargeur de démarrage de la
//! puce par le port série (aucun Python, aucun outil du paquet de la carte). arduino-cli compile toujours le
//! programme ; l'image complète (`jollof_sketch.ino.merged.bin` : chargeur, table des partitions, programme) est
//! écrite à l'adresse 0, en sautant les zones déjà identiques (deuxième envoi bien plus court), avec la progression
//! envoyée à la fenêtre. `esp_detect` reconnaît la puce branchée (ESP32, S3, C3…) pour choisir le bon modèle.
//!
//! Le chemin du fichier est fixe (dossier de compilation de l'application) : la fenêtre ne choisit que le port, qui
//! doit être un port série que le système déclare.

use crate::build_dir;
use espflash::connection::{Connection, ResetAfterOperation, ResetBeforeOperation};
use espflash::flasher::Flasher;
use espflash::image_format::Segment;
use espflash::target::{Chip, ProgressCallbacks};
use serde::Serialize;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::AppHandle;

/// Vitesse d'écriture après connexion (115 200 bauds pour se connecter, comme esptool).
const FAST_BAUD: u32 = 460_800;
const MAX_IMAGE: u64 = 16 * 1024 * 1024;

#[derive(Serialize)]
pub struct ChipInfo {
    /// esp32, esp32s3, esp32c3… (nom court, comme les modèles de carte)
    chip: String,
    revision: Option<String>,
    flash: String,
    mac: Option<String>,
    features: Vec<String>,
}

fn open(port: &str) -> Result<Connection, String> {
    let known = serialport::available_ports().map_err(|e| e.to_string())?;
    let info = known
        .into_iter()
        .find(|p| p.port_name == port)
        .ok_or_else(|| {
            format!("Port {port} introuvable : rebranchez la carte, puis cherchez à nouveau")
        })?;
    let usb = match info.port_type {
        serialport::SerialPortType::UsbPort(u) => u,
        _ => serialport::UsbPortInfo {
            vid: 0,
            pid: 0,
            serial_number: None,
            manufacturer: None,
            product: None,
        },
    };
    let serial = serialport::new(port, 115_200)
        .flow_control(serialport::FlowControl::None)
        .open_native()
        .map_err(|e| format!("Port {port} : ouverture impossible ({e})"))?;
    Ok(Connection::new(
        serial,
        usb,
        ResetAfterOperation::HardReset,
        ResetBeforeOperation::DefaultReset,
        115_200,
    ))
}

/// Connexion au chargeur de la puce (reset par DTR/RTS) ; message clair si elle ne répond pas.
fn connect(port: &str) -> Result<Flasher, String> {
    Flasher::connect(open(port)?, true, true, true, None, Some(FAST_BAUD)).map_err(|e| {
        log::warn!("espflash : {e}");
        format!(
            "Failed to connect to ESP : la puce ne répond pas ({e}). Maintenez son bouton BOOT enfoncé au début du téléversement."
        )
    })
}

fn chip_name(c: Chip) -> String {
    c.to_string().to_lowercase()
}

/// Puce branchée sur `port` : nom, révision, taille de la mémoire flash, adresse MAC. La carte redémarre ensuite.
#[tauri::command]
pub async fn esp_detect(port: String) -> Result<ChipInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut f = connect(&port)?;
        let chip = f.chip();
        let info = f.device_info().map_err(|e| e.to_string())?;
        let _ = f.connection().reset_after(true, chip);
        log::info!("espflash : {chip} sur {port}");
        Ok(ChipInfo {
            chip: chip_name(chip),
            revision: info.revision.map(|(a, b)| format!("v{a}.{b}")),
            flash: info.flash_size.to_string(),
            mac: info.mac_address,
            features: info.features,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Progression vers la fenêtre : { stage: "write" | "verify" | "done", done, total, skipped }, dix fois par seconde au plus.
struct Progress {
    ch: Channel<Value>,
    total: usize,
    last: Instant,
}
impl ProgressCallbacks for Progress {
    fn init(&mut self, _addr: u32, total: usize) {
        self.total = total;
        let _ = self
            .ch
            .send(json!({ "stage": "write", "done": 0, "total": total }));
    }
    fn update(&mut self, current: usize) {
        if self.last.elapsed().as_millis() >= 100 || current >= self.total {
            self.last = Instant::now();
            let _ = self
                .ch
                .send(json!({ "stage": "write", "done": current, "total": self.total }));
        }
    }
    fn verifying(&mut self) {
        let _ = self.ch.send(json!({ "stage": "verify" }));
    }
    fn finish(&mut self, skipped: bool) {
        let _ = self.ch.send(json!({ "stage": "done", "skipped": skipped }));
    }
}

/// Puce attendue pour un modèle de carte (fqbn d'arduino-cli) : esp32:esp32:esp32s3 → esp32s3.
fn expected_chip(fqbn: &str) -> Option<&'static str> {
    let board = fqbn.split(':').nth(2)?;
    Some(if board.contains("esp32s3") {
        "esp32s3"
    } else if board.contains("esp32c3") {
        "esp32c3"
    } else if board.contains("esp32s2") {
        "esp32s2"
    } else if board.contains("esp32c6") {
        "esp32c6"
    } else {
        "esp32"
    })
}

/// Écrit le dernier programme compilé (image complète) sur la puce branchée, puis la redémarre.
#[tauri::command]
pub async fn esp_flash(
    app: AppHandle,
    port: String,
    fqbn: String,
    on_progress: Channel<Value>,
) -> Result<ChipInfo, String> {
    let path = build_dir(&app)?.join("jollof_sketch.ino.merged.bin");
    tauri::async_runtime::spawn_blocking(move || {
        let len = std::fs::metadata(&path)
            .map_err(|_| "Image complète introuvable : compilez d'abord le programme".to_string())?
            .len();
        if len == 0 || len > MAX_IMAGE {
            return Err("Image du programme invalide".to_string());
        }
        let data = std::fs::read(&path).map_err(|e| e.to_string())?;
        let mut f = connect(&port)?;
        let chip = f.chip();
        if let Some(want) = expected_chip(&fqbn) {
            if chip_name(chip) != want {
                let _ = f.connection().reset_after(true, chip);
                return Err(format!(
                    "La carte branchée est un {chip}, pas un {want} : choisissez le modèle de carte qui correspond, puis recompilez."
                ));
            }
        }
        let mut p = Progress {
            ch: on_progress,
            total: 0,
            last: Instant::now(),
        };
        let mut seg = Segment {
            addr: 0,
            data: Cow::Owned(data),
        };
        // La puce écrit par mots de 4 octets.
        while !seg.data.len().is_multiple_of(4) {
            seg.data.to_mut().push(0xFF);
        }
        let t0 = Instant::now();
        f.write_bins_to_flash(&[seg], &mut p).map_err(|e| {
            log::warn!("espflash : écriture : {e}");
            format!("Écriture interrompue : {e}")
        })?;
        f.connection()
            .reset_after(true, chip)
            .map_err(|e| e.to_string())?;
        log::info!(
            "espflash : {} octets écrits sur {chip} ({port}) en {:.1} s",
            len,
            t0.elapsed().as_secs_f32()
        );
        Ok(ChipInfo {
            chip: chip_name(chip),
            revision: None,
            flash: String::new(),
            mac: None,
            features: Vec::new(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_chosen_board_names_its_chip() {
        assert_eq!(
            expected_chip("esp32:esp32:esp32doit-devkit-v1"),
            Some("esp32")
        );
        assert_eq!(expected_chip("esp32:esp32:nodemcu-32s"), Some("esp32"));
        assert_eq!(expected_chip("esp32:esp32:esp32s3"), Some("esp32s3"));
        assert_eq!(
            expected_chip("esp32:esp32:nologo_esp32c3_super_mini"),
            Some("esp32c3")
        );
        assert_eq!(expected_chip("esp32"), None);
        assert_eq!(chip_name(Chip::Esp32s3), "esp32s3");
    }
}
