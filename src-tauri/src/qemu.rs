// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//
// Mode fidèle de l'ESP32 : le vrai programme tourne dans QEMU (fork d'Espressif, GPL-2.0). QEMU reste un programme à
// part : téléchargé à la première utilisation dans le dossier de données de l'application (archive vérifiée par
// son empreinte SHA-256, figée ici), puis lancé avec des arguments fixes. Jamais lié à l'application, il ne lui
// parle que par des sockets locales (ports série de la carte) et par sa sortie d'erreur (trace des écritures de
// registres GPIO et LEDC). L'interface ne choisit ni le programme lancé ni ses arguments : seulement l'image de la
// flash (validée) et les octets envoyés aux ports série.
//
// Pour le développement : JOLLOF_QEMU=/chemin/qemu-system-xtensa remplace l'émulateur installé (sans vérification).
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

/// Version de l'émulateur : fork d'Espressif esp-develop-9.2.2-20250817, révision j1 de scripts/esp32-qemu/build-qemu.sh.
pub const VERSION: &str = "9.2.2-20250817-j1";
/// Page de la publication (GitHub Releases), remplie par .github/workflows/qemu-esp32.yml.
const RELEASE_URL: &str = "https://github.com/xelaktechsn/jollof-studio/releases/download/qemu-esp32-9.2.2-20250817-j1";
/// Paquet de chaque plateforme : (plateforme, archive, SHA-256). Empreinte vide : pas encore publié, installation
/// refusée. Les empreintes viennent du fichier SHA256SUMS.txt de la publication.
const PACKAGES: &[(&str, &str, &str)] = &[
    ("x86_64-apple-darwin", "jollof-qemu-esp32-9.2.2-20250817-j1-x86_64-apple-darwin.zip", ""),
    ("aarch64-apple-darwin", "jollof-qemu-esp32-9.2.2-20250817-j1-aarch64-apple-darwin.zip", ""),
    ("x86_64-linux-gnu", "jollof-qemu-esp32-9.2.2-20250817-j1-x86_64-linux-gnu.zip", ""),
    ("aarch64-linux-gnu", "jollof-qemu-esp32-9.2.2-20250817-j1-aarch64-linux-gnu.zip", ""),
    ("x86_64-w64-mingw32", "jollof-qemu-esp32-9.2.2-20250817-j1-x86_64-w64-mingw32.zip", ""),
];
const EXE: &str = if cfg!(windows) { "qemu-system-xtensa.exe" } else { "qemu-system-xtensa" };
const MAX_ZIP: u64 = 100 * 1024 * 1024;
/// Image de la flash : 1 à 16 Mo, par blocs de 64 Kio, chargeur d'amorçage de l'ESP32 à 0x1000 (octet magique 0xE9).
const MAX_FLASH: usize = 16 * 1024 * 1024;

pub fn platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("linux", "x86_64") => Some("x86_64-linux-gnu"),
        ("linux", "aarch64") => Some("aarch64-linux-gnu"),
        ("windows", "x86_64") => Some("x86_64-w64-mingw32"),
        _ => None,
    }
}
fn package(p: &str) -> Option<(&'static str, &'static str)> {
    PACKAGES.iter().find(|x| x.0 == p).map(|x| (x.1, x.2))
}

/* ---------- Installation ---------- */

/// Dossier de l'émulateur installé (une version par dossier).
fn install_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("qemu-esp32").join(VERSION))
}
/// Dossier des images de flash des cartes lancées.
fn run_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("qemu-run"))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}
/// L'archive téléchargée doit avoir l'empreinte figée ; une empreinte vide veut dire « pas encore publié ».
pub fn check_hash(bytes: &[u8], expected: &str) -> Result<(), String> {
    if expected.is_empty() {
        return Err("L’émulateur ESP32 n’est pas encore publié pour cette plateforme.".into());
    }
    let got = sha256_hex(bytes);
    if got.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("Archive de l’émulateur corrompue (SHA-256 {got}, attendu {expected})."))
    }
}

/// Décompresse l'archive dans dest. Toutes les entrées doivent rester sous qemu/ (pas de « .. », pas de chemin
/// absolu) ; les droits d'exécution sont gardés.
pub fn extract(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("Archive illisible : {e}"))?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let rel = f.enclosed_name().ok_or_else(|| format!("Chemin refusé dans l’archive : {}", f.name()))?;
        if rel.components().next().map(|c| c.as_os_str()) != Some(std::ffi::OsStr::new("qemu")) {
            return Err(format!("Entrée inattendue dans l’archive : {}", f.name()));
        }
        let out = dest.join(&rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(d) = out.parent() {
            fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut data).map_err(|e| e.to_string())?;
        fs::write(&out, &data).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = f.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out, fs::Permissions::from_mode(mode & 0o755)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

struct Installed {
    exe: PathBuf,
    share: Option<PathBuf>,
    dev: bool,
}
/// L'émulateur à lancer : celui de JOLLOF_QEMU, sinon celui installé, dont l'exécutable a toujours l'empreinte notée
/// à l'installation (un fichier remplacé depuis n'est pas lancé).
fn installed(app: &AppHandle) -> Option<Installed> {
    if let Some(p) = std::env::var_os("JOLLOF_QEMU").map(PathBuf::from).filter(|p| p.is_file()) {
        let share = p.parent().and_then(|b| b.parent()).map(|r| r.join("share").join("qemu")).filter(|s| s.is_dir());
        return Some(Installed { exe: p, share, dev: true });
    }
    let root = install_root(app).ok()?.join("qemu");
    let exe = root.join("bin").join(EXE);
    let want = fs::read_to_string(root.join("installed.sha256")).ok()?;
    let bytes = fs::read(&exe).ok()?;
    (sha256_hex(&bytes) == want.trim()).then(|| Installed { exe, share: Some(root.join("share").join("qemu")), dev: false })
}

#[derive(Serialize)]
pub struct QemuStatus {
    installed: bool,
    /// Un paquet est publié pour cette plateforme (installation possible).
    available: bool,
    dev: bool,
    version: &'static str,
    platform: Option<&'static str>,
}

#[tauri::command]
pub async fn qemu_status(app: AppHandle) -> Result<QemuStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let i = installed(&app);
        let p = platform();
        Ok(QemuStatus {
            installed: i.is_some(),
            available: p.and_then(package).is_some_and(|x| !x.1.is_empty()),
            dev: i.is_some_and(|x| x.dev),
            version: VERSION,
            platform: p,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Télécharge l'émulateur de cette plateforme (adresse et empreinte figées), le vérifie et l'installe. Avancement :
/// octets reçus, envoyés par `on_progress` (avec le total quand le serveur le donne).
#[tauri::command]
pub async fn qemu_install(app: AppHandle, on_progress: Channel<(u64, u64)>) -> Result<QemuStatus, String> {
    let root = install_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let p = platform().ok_or("Plateforme non prise en charge par l’émulateur ESP32.")?;
        let (file, hash) = package(p).ok_or("Plateforme non prise en charge par l’émulateur ESP32.")?;
        if hash.is_empty() {
            return Err("L’émulateur ESP32 n’est pas encore publié pour cette plateforme.".to_string());
        }
        let bytes = download(&format!("{RELEASE_URL}/{file}"), &|got, total| {
            let _ = on_progress.send((got, total));
        })?;
        check_hash(&bytes, hash)?;
        // Décompressé à côté, puis mis en place d'un coup : une installation interrompue ne laisse rien de lancé.
        let tmp = root.with_extension("part");
        let _ = fs::remove_dir_all(&tmp);
        extract(&bytes, &tmp)?;
        let exe = tmp.join("qemu").join("bin").join(EXE);
        if !exe.is_file() || !tmp.join("qemu").join("share").join("qemu").join("esp32-v3-rom.bin").is_file() {
            let _ = fs::remove_dir_all(&tmp);
            return Err("Archive de l’émulateur incomplète.".into());
        }
        let exe_hash = sha256_hex(&fs::read(&exe).map_err(|e| e.to_string())?);
        fs::write(tmp.join("qemu").join("installed.sha256"), exe_hash).map_err(|e| e.to_string())?;
        let _ = fs::remove_dir_all(&root);
        fs::rename(&tmp, &root).map_err(|e| format!("Installation impossible : {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    qemu_status(app).await
}

fn download(url: &str, progress: &dyn Fn(u64, u64)) -> Result<Vec<u8>, String> {
    let mut res = ureq::get(url).call().map_err(|e| format!("Téléchargement impossible ({url}) : {e}"))?;
    let total = res
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mut reader = res.body_mut().with_config().limit(MAX_ZIP).reader();
    let (mut buf, mut chunk, mut last) = (Vec::new(), vec![0u8; 64 * 1024], Instant::now());
    loop {
        let n = reader.read(&mut chunk).map_err(|e| format!("Téléchargement interrompu : {e}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if last.elapsed() > Duration::from_millis(100) {
            last = Instant::now();
            progress(buf.len() as u64, total);
        }
    }
    progress(buf.len() as u64, total);
    Ok(buf)
}

/* ---------- Lancement d'une carte ---------- */

/// L'image doit ressembler à une flash d'ESP32 : taille, alignement, chargeur d'amorçage à 0x1000.
pub fn check_flash(bytes: &[u8]) -> Result<(), String> {
    let ok = bytes.len() >= 0x10000 && bytes.len() <= MAX_FLASH && bytes.len().is_multiple_of(0x10000) && bytes[0x1000] == 0xE9;
    if ok {
        Ok(())
    } else {
        Err("Image de flash ESP32 invalide".into())
    }
}

/// Arguments de QEMU, toujours les mêmes : machine ESP32 sans affichage ni moniteur, chiens de garde des groupes de
/// minuteries désactivés (le temps de la carte suit l'horloge de l'ordinateur : un à-coup de celui-ci les ferait
/// redémarrer la carte sans faute du programme), flash de la carte, UART0 (Serial) et UART1 (cale du mode fidèle)
/// sur des sockets locales où QEMU se connecte, trace des écritures de registres (GPIO, LEDC) sur la sortie
/// d'erreur. Dans -drive, une virgule du chemin se double.
pub fn qemu_args(share: Option<&Path>, flash: &Path, uart_port: u16, side_port: u16) -> Vec<OsString> {
    let mut a: Vec<OsString> = ["-machine", "esp32", "-display", "none", "-monitor", "none", "-nodefaults", "-global", "driver=timer.esp32.timg,property=wdt_disable,value=true"]
        .iter()
        .map(OsString::from)
        .collect();
    if let Some(s) = share {
        a.push("-L".into());
        a.push(s.as_os_str().to_owned());
    }
    let mut drive = OsString::from("file=");
    drive.push(flash.to_string_lossy().replace(',', ",,"));
    drive.push(",if=mtd,format=raw");
    a.push("-drive".into());
    a.push(drive);
    for (id, port) in [("uart0", uart_port), ("uart1", side_port)] {
        a.push("-chardev".into());
        a.push(format!("socket,id={id},host=127.0.0.1,port={port}").into());
        a.push("-serial".into());
        a.push(format!("chardev:{id}").into());
    }
    a.push("-trace".into());
    a.push("memory_region_ops_write".into());
    a
}

/// Ligne de trace de QEMU → (adresse, valeur) pour les registres GPIO et LEDC de l'ESP32 ; None pour le reste.
pub fn parse_trace(line: &str) -> Option<(u32, u32)> {
    let rest = line.split("memory_region_ops_write ").nth(1)?;
    let name = rest.split(" name '").nth(1)?.split('\'').next()?;
    if name != "esp32.gpio" && name != "misc.esp32.ledc" {
        return None;
    }
    let hex = |key: &str| -> Option<u64> {
        let s = rest.split(key).nth(1)?.split(' ').next()?;
        u64::from_str_radix(s.trim_start_matches("0x"), 16).ok()
    };
    Some((hex(" addr ")? as u32, hex(" value ")? as u32))
}

struct Instance {
    child: Arc<Mutex<Child>>,
    uart: TcpStream,
    side: TcpStream,
}
impl Drop for Instance {
    fn drop(&mut self) {
        let _ = self.uart.shutdown(Shutdown::Both);
        let _ = self.side.shutdown(Shutdown::Both);
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
        }
    }
}

/// Les émulateurs lancés, un par carte (identifiant du composant).
#[derive(Default)]
pub struct Qemu {
    runs: Mutex<HashMap<String, Instance>>,
}
impl Qemu {
    /// Fermeture de l'application : tous les émulateurs s'arrêtent.
    pub fn kill_all(&self) {
        if let Ok(mut m) = self.runs.lock() {
            m.clear();
        }
    }
}

#[derive(Serialize, Clone)]
pub struct QemuExit {
    code: Option<i32>,
    log: String,
}

/// Image de la flash d'une carte (corps binaire, carte dans l'en-tête x-board), écrite avant `qemu_start`.
#[tauri::command]
pub async fn qemu_flash(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let board = request.headers().get("x-board").and_then(|v| v.to_str().ok()).ok_or("En-tête x-board manquant")?;
    let board = crate::safe_id(board)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    check_flash(bytes)?;
    let dir = run_dir(&app)?;
    let bytes = bytes.clone();
    crate::blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join(format!("{board}.bin")), bytes).map_err(|e| e.to_string())
    })
    .await
}

/// Temps depuis le lancement, en dizaines de microsecondes (horodatage des messages vers l'interface).
fn stamp(t0: Instant) -> [u8; 4] {
    ((t0.elapsed().as_micros() / 10) as u32).to_le_bytes()
}
/// Attend la connexion de QEMU sur une socket locale (il se connecte au démarrage), ou son arrêt prématuré.
fn accept(l: &TcpListener, child: &Arc<Mutex<Child>>, deadline: Instant) -> Result<TcpStream, String> {
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    loop {
        match l.accept() {
            Ok((s, peer)) if peer.ip().is_loopback() => {
                s.set_nonblocking(false).map_err(|e| e.to_string())?;
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(e.to_string()),
        }
        if let Ok(Some(st)) = child.lock().map_err(|e| e.to_string())?.try_wait() {
            return Err(format!("QEMU s’est arrêté au démarrage ({st})"));
        }
        if Instant::now() > deadline {
            return Err("QEMU ne répond pas".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
/// Octets d'une socket vers l'interface, horodatés ; fin de la connexion : on s'arrête.
fn pump(mut s: TcpStream, ch: Channel<Vec<u8>>, t0: Instant) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match s.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut m = stamp(t0).to_vec();
                    m.extend_from_slice(&buf[..n]);
                    if ch.send(m).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Lance l'émulateur d'une carte sur l'image écrite par `qemu_flash`. Messages vers l'interface : `on_uart` (Serial)
/// et `on_side` (cale), 4 octets d'horodatage puis les octets reçus ; `on_trace`, des enregistrements de 12 octets
/// (adresse, valeur, horodatage, en u32 petit-boutistes) ; `on_exit`, une fois, à l'arrêt de QEMU.
#[tauri::command]
pub async fn qemu_start(
    app: AppHandle,
    state: State<'_, Qemu>,
    board: String,
    on_uart: Channel<Vec<u8>>,
    on_side: Channel<Vec<u8>>,
    on_trace: Channel<Vec<u8>>,
    on_exit: Channel<QemuExit>,
) -> Result<(), String> {
    let board = crate::safe_id(&board)?;
    if let Ok(mut m) = state.runs.lock() {
        m.remove(&board); // une seule instance par carte : l'ancienne s'arrête
    }
    let inst = {
        let app = app.clone();
        crate::blocking(move || installed(&app).ok_or_else(|| "L’émulateur ESP32 n’est pas installé.".to_string())).await?
    };
    let flash = run_dir(&app)?.join(format!("{board}.bin"));
    if !flash.is_file() {
        return Err("Image de flash introuvable : compilez d’abord le programme.".into());
    }
    let instance = crate::blocking(move || {
        let lu = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let ls = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let args = qemu_args(inst.share.as_deref(), &flash, lu.local_addr().map_err(|e| e.to_string())?.port(), ls.local_addr().map_err(|e| e.to_string())?.port());
        let mut cmd = Command::new(&inst.exe);
        cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui s'ouvre
        }
        let mut child = cmd.spawn().map_err(|e| format!("QEMU n’a pas pu démarrer : {e}"))?;
        let stderr = child.stderr.take().ok_or("sortie d’erreur indisponible")?;
        let child = Arc::new(Mutex::new(child));
        let t0 = Instant::now();
        let deadline = t0 + Duration::from_secs(20); // premier lancement : le système peut examiner le programme
        let (uart, side) = match (|| Ok::<_, String>((accept(&lu, &child, deadline)?, accept(&ls, &child, deadline)?)))() {
            Ok(x) => x,
            Err(e) => {
                let _ = child.lock().map(|mut c| c.kill());
                return Err(e);
            }
        };
        pump(uart.try_clone().map_err(|e| e.to_string())?, on_uart, t0);
        pump(side.try_clone().map_err(|e| e.to_string())?, on_side, t0);
        // Sortie d'erreur : trace des registres GPIO et LEDC (envoyée par paquets, toutes les 5 ms au plus), le
        // reste gardé pour le message d'arrêt.
        let waiter = child.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::new(stderr);
            let (mut raw, mut batch, mut since, mut tail) = (Vec::<u8>::new(), Vec::<u8>::new(), Instant::now(), String::new());
            loop {
                raw.clear();
                match r.read_until(b'\n', &mut raw) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let line = String::from_utf8_lossy(&raw); // un octet invalide n'arrête pas la lecture
                if let Some((addr, value)) = parse_trace(&line) {
                    if batch.is_empty() {
                        since = Instant::now();
                    }
                    batch.extend_from_slice(&addr.to_le_bytes());
                    batch.extend_from_slice(&value.to_le_bytes());
                    batch.extend_from_slice(&stamp(t0));
                } else if !line.starts_with("memory_region_ops_write") {
                    tail.push_str(&line);
                    if tail.len() > 4000 {
                        let cut = (tail.len() - 3000..tail.len()).find(|&i| tail.is_char_boundary(i)).unwrap_or(tail.len());
                        tail = tail[cut..].to_string();
                    }
                }
                if !batch.is_empty()
                    && (since.elapsed() > Duration::from_millis(5) || batch.len() >= 12 * 2048)
                    && on_trace.send(std::mem::take(&mut batch)).is_err()
                {
                    break;
                }
            }
            if !batch.is_empty() {
                let _ = on_trace.send(batch);
            }
            // Attente sans garder le verrou : qemu_stop doit pouvoir arrêter le processus pendant ce temps.
            let code = loop {
                match waiter.lock().ok().map(|mut c| c.try_wait()) {
                    Some(Ok(Some(st))) => break st.code(),
                    Some(Ok(None)) => std::thread::sleep(Duration::from_millis(20)),
                    _ => break None,
                }
            };
            let _ = on_exit.send(QemuExit { code, log: tail });
        });
        Ok(Instance { child, uart, side })
    })
    .await?;
    state.runs.lock().map_err(|e| e.to_string())?.insert(board, instance);
    Ok(())
}

/// Octets vers la carte : port 0, son Serial (UART0) ; port 1, la cale (UART1 : niveaux des entrées, ADC).
#[tauri::command]
pub fn qemu_input(state: State<'_, Qemu>, board: String, port: u8, bytes: Vec<u8>) -> Result<(), String> {
    let mut m = state.runs.lock().map_err(|e| e.to_string())?;
    let i = m.get_mut(&board).ok_or("émulateur arrêté")?;
    let s = match port {
        0 => &mut i.uart,
        1 => &mut i.side,
        _ => return Err("port inconnu".into()),
    };
    s.write_all(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn qemu_stop(state: State<'_, Qemu>, board: String) -> Result<(), String> {
    state.runs.lock().map_err(|e| e.to_string())?.remove(&board);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_fixed() {
        let a = qemu_args(Some(Path::new("/app/qemu/share/qemu")), Path::new("/cache/qemu-run/esp,32.bin"), 40001, 40002);
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(&s[..9], ["-machine", "esp32", "-display", "none", "-monitor", "none", "-nodefaults", "-global", "driver=timer.esp32.timg,property=wdt_disable,value=true"]);
        assert!(s.windows(2).any(|w| w == ["-L", "/app/qemu/share/qemu"]));
        // Une virgule du chemin est doublée : elle ne peut pas ajouter d'option à -drive.
        assert!(s.contains(&"file=/cache/qemu-run/esp,,32.bin,if=mtd,format=raw".to_string()));
        assert!(s.contains(&"socket,id=uart0,host=127.0.0.1,port=40001".to_string()));
        assert!(s.contains(&"socket,id=uart1,host=127.0.0.1,port=40002".to_string()));
        assert!(s.windows(2).any(|w| w == ["-trace", "memory_region_ops_write"]));
        assert!(!qemu_args(None, Path::new("/f.bin"), 1, 2).iter().any(|x| x == "-L"));
    }

    #[test]
    fn trace_lines() {
        let l = "memory_region_ops_write cpu 1 mr 0x7ff566c0b2c0 addr 0x3ff44008 value 0x4 size 4 name 'esp32.gpio'\n";
        assert_eq!(parse_trace(l), Some((0x3ff44008, 4)));
        let p = "12@1700000000.000001:memory_region_ops_write cpu 0 mr 0x1 addr 0x3ff59008 value 0x400 size 4 name 'misc.esp32.ledc'";
        assert_eq!(parse_trace(p), Some((0x3ff59008, 0x400)));
        assert_eq!(parse_trace("memory_region_ops_write cpu 0 mr 0x1 addr 0x3ff5f048 value 0x0 size 4 name 'timer.esp32.timg'"), None);
        assert_eq!(parse_trace("qemu-system-xtensa: warning"), None);
    }

    #[test]
    fn flash_images() {
        let mut img = vec![0xffu8; 4 * 1024 * 1024];
        img[0x1000] = 0xE9;
        assert!(check_flash(&img).is_ok());
        assert!(check_flash(&img[..0x10001]).is_err());
        assert!(check_flash(&vec![0u8; 0x10000]).is_err());
        assert!(check_flash(&vec![0u8; 32 * 1024 * 1024]).is_err());
    }

    #[test]
    fn hashes() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert!(check_hash(b"abc", "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD").is_ok());
        assert!(check_hash(b"abd", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").is_err());
        assert!(check_hash(b"abc", "").is_err(), "pas d'empreinte figée : refusé");
        for (p, f, _) in PACKAGES {
            assert!(f.contains(VERSION) && f.ends_with(&format!("{p}.zip")));
        }
    }

    /// Avec JOLLOF_QEMU et JOLLOF_ESP32_IMAGE (une image .merged.bin) : QEMU, lancé avec les arguments de
    /// l'application, se connecte aux deux sockets, écrit la bannière de sa mémoire morte sur l'UART0 et trace les
    /// registres GPIO. Sans ces variables, le test ne fait rien.
    #[test]
    fn live_qemu() {
        let (Some(exe), Some(img)) = (std::env::var_os("JOLLOF_QEMU"), std::env::var_os("JOLLOF_ESP32_IMAGE")) else {
            return;
        };
        let exe = PathBuf::from(exe);
        let share = exe.parent().and_then(|b| b.parent()).map(|r| r.join("share").join("qemu")).filter(|s| s.is_dir());
        let dir = std::env::temp_dir().join(format!("jollof-qemu-live-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let flash = dir.join("flash,1.bin"); // virgule dans le chemin : doublée dans -drive
        let bytes = fs::read(&img).unwrap();
        check_flash(&bytes).unwrap();
        fs::write(&flash, &bytes).unwrap();
        let lu = TcpListener::bind("127.0.0.1:0").unwrap();
        let ls = TcpListener::bind("127.0.0.1:0").unwrap();
        let args = qemu_args(share.as_deref(), &flash, lu.local_addr().unwrap().port(), ls.local_addr().unwrap().port());
        let mut child = Command::new(&exe).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().unwrap();
        let stderr = child.stderr.take().unwrap();
        let child = Arc::new(Mutex::new(child));
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut uart = accept(&lu, &child, deadline).unwrap();
        let _side = accept(&ls, &child, deadline).unwrap();
        let gpio = std::thread::spawn(move || BufReader::new(stderr).lines().map_while(Result::ok).filter_map(|l| parse_trace(&l)).take(1).count());
        uart.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        let (mut text, mut buf) = (String::new(), [0u8; 512]);
        while !text.contains("entry 0x") {
            let n = uart.read(&mut buf).unwrap();
            assert!(n > 0, "UART0 fermée : {text}");
            text.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        assert!(text.contains("rst:0x1 (POWERON_RESET)"), "{text}");
        std::thread::sleep(Duration::from_millis(1500));
        let _ = child.lock().unwrap().kill();
        assert_eq!(gpio.join().unwrap(), 1, "écritures GPIO tracées");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Avec JOLLOF_QEMU_ZIP (un paquet de build-qemu.sh) : il se décompresse comme à l'installation, exécutable
    /// compris (droits gardés), avec les ROM et la provenance des sources.
    #[test]
    fn real_package() {
        let Some(zip) = std::env::var_os("JOLLOF_QEMU_ZIP") else {
            return;
        };
        let bytes = fs::read(zip).unwrap();
        let d = std::env::temp_dir().join(format!("jollof-qemu-pkg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        extract(&bytes, &d).unwrap();
        let exe = d.join("qemu").join("bin").join(EXE);
        for f in [exe.clone(), d.join("qemu/share/qemu/esp32-v3-rom.bin"), d.join("qemu/SOURCE.md"), d.join("qemu/COPYING")] {
            assert!(f.is_file(), "{f:?}");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(fs::metadata(&exe).unwrap().permissions().mode() & 0o100, 0);
            let out = Command::new(&exe).arg("--version").output().unwrap();
            assert!(String::from_utf8_lossy(&out.stdout).contains(VERSION), "{out:?}");
        }
        let _ = fs::remove_dir_all(&d);
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).unix_permissions(0o755);
        for (n, d) in entries {
            w.start_file(*n, o).unwrap();
            w.write_all(d).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn extraction_stays_inside() {
        let d = std::env::temp_dir().join(format!("jollof-qemu-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        extract(&zip_of(&[("qemu/bin/qemu-system-xtensa", b"x"), ("qemu/share/qemu/esp32-v3-rom.bin", b"r")]), &d).unwrap();
        assert_eq!(fs::read(d.join("qemu/bin/qemu-system-xtensa")).unwrap(), b"x");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(d.join("qemu/bin/qemu-system-xtensa")).unwrap().permissions().mode() & 0o111, 0o111);
        }
        assert!(extract(&zip_of(&[("qemu/../../evil", b"x")]), &d).is_err());
        assert!(extract(&zip_of(&[("/etc/evil", b"x")]), &d).is_err());
        assert!(extract(&zip_of(&[("autre/fichier", b"x")]), &d).is_err());
        assert!(!d.parent().unwrap().join("evil").exists());
        let _ = fs::remove_dir_all(&d);
    }
}
