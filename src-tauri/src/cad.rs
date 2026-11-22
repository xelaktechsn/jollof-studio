// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Import des plans DWG par un convertisseur installé sur l'ordinateur de l'utilisateur. Le DWG est un format fermé :
//! Jollof Studio n'en lit que le DXF. Rien n'est livré ni lié avec l'application ; on lance, comme programme à part,
//! le premier convertisseur trouvé :
//!   - ODA File Converter (gratuit, propriétaire, Open Design Alliance), de préférence. Il travaille sur des dossiers :
//!     le DWG est copié (ou lié) seul dans un dossier d'entrée neuf, sous le nom `input.DWG` ;
//!   - `dwg2dxf` de LibreDWG (GPL-3), seulement s'il est déjà installé : exécuté, jamais lié ni distribué.
//!
//! Déroulé côté fenêtre (src/net/cad/dwg.js) : `cad_begin` ouvre un travail (dossier temporaire dans le cache de
//! l'application) ; le DWG vient soit d'un chemin choisi dans la boîte « Ouvrir » (`pick_open`, autorisation de
//! lecture vérifiée), soit d'un fichier glissé dans la fenêtre, envoyé par morceaux (`cad_upload_write`) ;
//! `cad_convert_dwg` lance le convertisseur (progression : temps écoulé et taille du DXF déjà écrite, annulable,
//! délai maximal) ; `cad_read` rend le DXF par morceaux de 16 Mo au plus (un DXF de plusieurs centaines de Mo n'entre
//! jamais en entier dans la webview) ; `cad_cleanup` efface le dossier. Les dossiers restés d'une session précédente
//! sont effacés au travail suivant et à la fermeture.
//!
//! Sécurité : aucun interpréteur de commandes (Command avec un tableau d'arguments) ; la fenêtre ne donne ni le
//! chemin du convertisseur (seulement « oda » ou « libredwg », retrouvés ici), ni de chemin de sortie, ni de chemin
//! de lecture du DXF (seulement un numéro de travail) ; le DWG d'entrée doit être un fichier choisi dans la boîte de
//! dialogue, existant, d'extension .dwg, commençant par la signature « AC », de taille bornée.

use crate::{blocking, blocking_in_place, can_read, can_write, Grants};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

/// Travaux ouverts en même temps au plus : chacun peut recevoir plusieurs Gio (un par conversion suffit ; la fenêtre
/// ne peut pas remplir le disque en en ouvrant sans fin : au-delà, le plus ancien est fermé).
const MAX_JOBS: usize = 4;
/// DWG le plus gros accepté (2 Gio).
const MAX_DWG: u64 = 2 << 30;
/// DXF le plus gros accepté (8 Gio) : au-delà le convertisseur est arrêté (disque).
const MAX_DXF: u64 = 8 << 30;
/// Morceau de lecture le plus gros rendu à la fenêtre.
const MAX_CHUNK: u32 = 16 << 20;
/// Délai par défaut et bornes (secondes).
const TIMEOUT_DEFAULT: u64 = 15 * 60;
const TIMEOUT_MIN: u64 = 30;
const TIMEOUT_MAX: u64 = 2 * 3600;
/// Version du DXF demandée à ODA File Converter (AC1032, lue par toutes les applications récentes).
const ODA_VERSION: &str = "ACAD2018";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Oda,
    LibreDwg,
}
impl Kind {
    fn id(self) -> &'static str {
        match self {
            Kind::Oda => "oda",
            Kind::LibreDwg => "libredwg",
        }
    }
    fn name(self) -> &'static str {
        self.tool(Dir::ToDxf)
    }
    /// Nom du programme selon le sens (LibreDWG a un programme par sens, ODA un seul).
    fn tool(self, dir: Dir) -> &'static str {
        match (self, dir) {
            (Kind::Oda, _) => "ODA File Converter",
            (Kind::LibreDwg, Dir::ToDxf) => "LibreDWG dwg2dxf",
            (Kind::LibreDwg, Dir::ToDwg) => "LibreDWG dxf2dwg",
        }
    }
}
/// Sens de la conversion : import (DWG → DXF) ou export (DXF → DWG).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dir {
    ToDxf,
    ToDwg,
}

#[derive(Serialize, Clone, Debug)]
pub struct Converter {
    /// oda | libredwg
    id: &'static str,
    name: &'static str,
    path: String,
    version: Option<String>,
}

// ---------------------------------------------------------------------------
// Recherche des convertisseurs
// ---------------------------------------------------------------------------

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}
/// Entrées d'un dossier dont le nom commence par `prefix` (ordre décroissant : la version la plus récente d'abord).
fn entries_starting(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .map(|l| {
            l.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with(prefix))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v.reverse();
    v
}
/// Dossiers du PATH, plus ceux que les applications graphiques de macOS ne reçoivent pas (Homebrew, MacPorts).
fn search_dirs() -> Vec<PathBuf> {
    // Entrées absolues seulement : ni « . » ni entrée vide (le dossier courant ne fournit jamais le convertisseur).
    let mut d: Vec<PathBuf> = crate::path_dirs();
    if !cfg!(windows) {
        for x in [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/opt/local/bin",
            "/usr/bin",
        ] {
            d.push(PathBuf::from(x));
        }
        if let Some(h) = home() {
            d.push(h.join(".local").join("bin"));
        }
    }
    d
}
fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Emplacements habituels d'ODA File Converter (le premier qui existe gagne).
fn oda_candidates() -> Vec<PathBuf> {
    let mut c = vec![];
    if cfg!(target_os = "macos") {
        let mut apps = vec![PathBuf::from("/Applications")];
        if let Some(h) = home() {
            apps.push(h.join("Applications"));
        }
        for a in apps {
            for pre in ["ODAFileConverter", "ODA File Converter"] {
                for app in entries_starting(&a, pre) {
                    if app.extension().is_some_and(|e| e == "app") {
                        c.push(app.join("Contents").join("MacOS").join("ODAFileConverter"));
                    }
                }
            }
        }
    } else if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(pf) = std::env::var_os(var).map(PathBuf::from) {
                for d in entries_starting(&pf.join("ODA"), "ODAFileConverter") {
                    c.push(d.join("ODAFileConverter.exe"));
                }
            }
        }
    } else {
        c.push(PathBuf::from("/usr/bin/ODAFileConverter"));
        c.push(PathBuf::from("/usr/local/bin/ODAFileConverter"));
        for d in entries_starting(Path::new("/opt"), "ODAFileConverter") {
            c.push(d.join("ODAFileConverter"));
        }
        if let Some(h) = home() {
            for dir in [
                h.join("Applications"),
                h.join(".local").join("bin"),
                h.join("bin"),
            ] {
                for f in entries_starting(&dir, "ODAFileConverter") {
                    if f.extension().is_some_and(|e| e == "AppImage") || f.extension().is_none() {
                        c.push(f);
                    }
                }
            }
        }
    }
    for d in search_dirs() {
        c.push(d.join(exe("ODAFileConverter")));
    }
    c
}
fn libredwg_candidates(dir: Dir) -> Vec<PathBuf> {
    let name = match dir {
        Dir::ToDxf => "dwg2dxf",
        Dir::ToDwg => "dxf2dwg",
    };
    search_dirs()
        .into_iter()
        .map(|d| d.join(exe(name)))
        .collect()
}
/// Convertisseur qu'on accepte de lancer : chemin absolu d'un fichier exécutable que seul son propriétaire (ou son
/// groupe) peut remplacer (crate::trusted_exec : ni fichier ni dossier inscriptible par tous).
fn is_exec(p: &Path) -> bool {
    crate::trusted_exec(p)
}
fn find(kind: Kind, dir: Dir) -> Option<PathBuf> {
    let list = match kind {
        Kind::Oda => oda_candidates(),
        Kind::LibreDwg => libredwg_candidates(dir),
    };
    list.into_iter().find(|p| is_exec(p))
}

/// Version d'ODA File Converter sans le lancer (sans arguments il ouvre sa fenêtre) : Info.plist de l'application
/// sur macOS, nom du dossier sur Windows (« ODAFileConverter 25.4.0 »).
fn oda_version(p: &Path) -> Option<String> {
    if cfg!(target_os = "macos") {
        let plist = p.parent()?.parent()?.join("Info.plist");
        let text = fs::read_to_string(plist).ok()?;
        return plist_string(&text, "CFBundleShortVersionString");
    }
    let dir = p.parent()?.file_name()?.to_str()?;
    let v = dir.trim_start_matches("ODAFileConverter").trim();
    (!v.is_empty() && v.len() <= 32 && v.chars().all(|c| c.is_ascii_digit() || c == '.'))
        .then(|| v.to_string())
}
/// Valeur texte d'une clé dans un plist XML (un plist binaire rend None).
fn plist_string(text: &str, key: &str) -> Option<String> {
    let at = text.find(&format!("<key>{key}</key>"))?;
    let rest = &text[at..];
    let a = rest.find("<string>")? + 8;
    let b = rest[a..].find("</string>")? + a;
    let v = rest[a..b].trim();
    (!v.is_empty() && v.len() <= 32).then(|| v.to_string())
}
/// `dwg2dxf --version` ou `dxf2dwg --version` (« dwg2dxf 0.14 »), trois secondes au plus.
fn libredwg_version(p: &Path) -> Option<String> {
    let mut c = Command::new(p);
    c.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    no_console(&mut c);
    let mut child = c.spawn().ok()?;
    let t0 = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if t0.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut s = String::new();
    child
        .stdout
        .take()?
        .take(4096)
        .read_to_string(&mut s)
        .ok()?;
    let first = s.lines().next()?.trim();
    let v = first.rsplit(' ').next()?.trim();
    (!v.is_empty() && v.len() <= 32).then(|| v.to_string())
}
fn no_console(_c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui s'ouvre
    }
}
fn detect(kind: Kind, dir: Dir) -> Option<Converter> {
    let p = find(kind, dir)?;
    let version = match kind {
        Kind::Oda => oda_version(&p),
        Kind::LibreDwg => libredwg_version(&p),
    };
    Some(Converter {
        id: kind.id(),
        name: kind.tool(dir),
        path: p.to_string_lossy().into_owned(),
        version,
    })
}

/// Convertisseurs installés, ODA File Converter d'abord. dir : « dxf » (DWG → DXF, par défaut) ou « dwg »
/// (DXF → DWG, export). Liste vide : aucun.
#[tauri::command]
pub async fn cad_converters(dir: Option<String>) -> Result<Vec<Converter>, String> {
    let d = parse_dir(dir.as_deref().unwrap_or("dxf"))?;
    blocking(move || {
        Ok([Kind::Oda, Kind::LibreDwg]
            .into_iter()
            .filter_map(|k| detect(k, d))
            .collect())
    })
    .await
}
fn parse_dir(s: &str) -> Result<Dir, String> {
    match s {
        "dxf" => Ok(Dir::ToDxf),
        "dwg" => Ok(Dir::ToDwg),
        _ => Err("Sens de conversion inconnu".into()),
    }
}
/// Le premier convertisseur installé (ODA d'abord), ou celui demandé.
fn choose(want: Option<Kind>, dir: Dir) -> Result<(Kind, PathBuf), String> {
    let found = match want {
        Some(k) => find(k, dir).map(|p| (k, p)),
        None => find(Kind::Oda, dir)
            .map(|p| (Kind::Oda, p))
            .or_else(|| find(Kind::LibreDwg, dir).map(|p| (Kind::LibreDwg, p))),
    };
    found.ok_or_else(|| "Aucun convertisseur DWG installé".to_string())
}

// ---------------------------------------------------------------------------
// Arguments et validation (purs, testés)
// ---------------------------------------------------------------------------

/// Choix de la fenêtre : « oda », « libredwg » ou « auto » (le premier installé).
fn parse_kind(s: &str) -> Result<Option<Kind>, String> {
    match s {
        "oda" => Ok(Some(Kind::Oda)),
        "libredwg" => Ok(Some(Kind::LibreDwg)),
        "auto" | "" => Ok(None),
        _ => Err("Convertisseur inconnu".into()),
    }
}

/// Arguments du convertisseur. ODA : dossier d'entrée, dossier de sortie, version, type, récursif, audit, filtre.
/// dwg2dxf : écrase la sortie (dossier neuf de toute façon), fichier de sortie, puis le DWG.
fn build_args(kind: Kind, input: &Path, in_dir: &Path, out_dir: &Path) -> Vec<OsString> {
    match kind {
        Kind::Oda => vec![
            in_dir.as_os_str().to_owned(),
            out_dir.as_os_str().to_owned(),
            ODA_VERSION.into(),
            "DXF".into(),
            "0".into(),
            "1".into(),
            "*.DWG".into(),
        ],
        Kind::LibreDwg => vec![
            "-y".into(),
            "-o".into(),
            out_dir.join("output.dxf").into_os_string(),
            input.as_os_str().to_owned(),
        ],
    }
}

/// Le DWG d'entrée : chemin absolu canonique d'un fichier .dwg existant, non vide, borné, signature « AC ».
fn validate_dwg(p: &Path) -> Result<PathBuf, String> {
    let bad = || "Fichier DWG introuvable ou illisible".to_string();
    let c = fs::canonicalize(p).map_err(|_| bad())?;
    let m = fs::metadata(&c).map_err(|_| bad())?;
    if !m.is_file() {
        return Err(bad());
    }
    if !c
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("dwg"))
    {
        return Err("Ce n'est pas un fichier .dwg".into());
    }
    // Un chemin canonique est absolu : il ne peut pas être pris pour une option du convertisseur.
    if !c.is_absolute() || c.to_string_lossy().starts_with('-') {
        return Err(bad());
    }
    if m.len() == 0 || m.len() > MAX_DWG {
        return Err("Taille du fichier DWG refusée".into());
    }
    check_magic(&c)?;
    Ok(c)
}
/// Un DWG commence par la version « AC1015 », « AC1032 »… (« AC1.2 » pour les très anciens).
fn check_magic(p: &Path) -> Result<(), String> {
    let mut head = [0u8; 6];
    let mut f = File::open(p).map_err(|e| format!("Lecture impossible : {e}"))?;
    f.read_exact(&mut head)
        .map_err(|_| "Fichier DWG tronqué".to_string())?;
    if &head[..2] == b"AC"
        && head[2..]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'.')
    {
        Ok(())
    } else {
        Err("Ce fichier n'est pas un dessin DWG".into())
    }
}
/// Le DXF produit : ASCII (commence par un code de groupe) ou binaire (« AutoCAD Binary DXF »), et complet (fin
/// « EOF »). Un convertisseur peut sortir en erreur après avoir écrit un DXF valable (avertissements) : c'est le
/// fichier qui décide.
fn dxf_complete(p: &Path) -> bool {
    let Ok(mut f) = File::open(p) else {
        return false;
    };
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return false;
    };
    if len < 16 {
        return false;
    }
    let mut head = [0u8; 22];
    let n = f.read(&mut head).unwrap_or(0);
    let h = &head[..n];
    let binary = h.starts_with(b"AutoCAD Binary DXF");
    let ascii = h
        .iter()
        .find(|b| !(b.is_ascii_whitespace() || **b == 0xEF || **b == 0xBB || **b == 0xBF))
        .is_some_and(|b| b.is_ascii_digit() || *b == b'-');
    if !binary && !ascii {
        return false;
    }
    let tail = len.min(256);
    let mut buf = vec![0u8; tail as usize];
    if f.seek(SeekFrom::End(-(tail as i64))).is_err() || f.read_exact(&mut buf).is_err() {
        return false;
    }
    buf.windows(3).any(|w| w == b"EOF")
}
/// Fichier ordinaire, lien symbolique exclu : ce que le convertisseur a écrit dans le dossier de sortie est relu et
/// rendu à la fenêtre ; un lien posé là ne doit jamais faire lire un autre fichier du disque.
fn is_plain_file(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_file())
}
/// Premier fichier .dxf (casse indifférente) d'un dossier.
fn find_dxf(dir: &Path) -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            is_plain_file(p)
                && p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("dxf"))
        })
        .collect();
    v.sort();
    v.into_iter().next()
}
fn clamp_timeout(s: Option<u64>) -> Duration {
    Duration::from_secs(s.unwrap_or(TIMEOUT_DEFAULT).clamp(TIMEOUT_MIN, TIMEOUT_MAX))
}
/// Dernières lignes d'un texte, sans caractères de contrôle, 600 caractères au plus (message d'erreur).
fn tail_text(lines: &VecDeque<String>) -> String {
    let s: String = lines
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    let s: String = s.chars().filter(|c| !c.is_control()).collect();
    if s.chars().count() > 600 {
        s.chars().take(600).collect::<String>() + "…"
    } else {
        s
    }
}

// ---------------------------------------------------------------------------
// Travaux
// ---------------------------------------------------------------------------

struct Job {
    dir: PathBuf,
    cancel: AtomicBool,
    child: Mutex<Option<Child>>,
    upload: Mutex<Option<File>>,
    out: Mutex<Option<PathBuf>>,
}
#[derive(Default)]
pub struct Cad {
    jobs: Mutex<HashMap<u32, Arc<Job>>>,
    next: AtomicU32,
}
impl Cad {
    fn job(&self, id: u32) -> Result<Arc<Job>, String> {
        self.jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
            .ok_or_else(|| "Conversion inconnue ou terminée".to_string())
    }
    /// Fermeture de l'application : les conversions en cours s'arrêtent.
    pub fn kill_all(&self) {
        let jobs: Vec<Arc<Job>> = self
            .jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
            .map(|(_, j)| j)
            .collect();
        for j in jobs {
            stop(&j);
        }
    }
}
fn stop(j: &Job) {
    j.cancel.store(true, Ordering::SeqCst);
    if let Some(c) = j.child.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        let _ = c.kill();
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("cad"))
}
/// Fermeture : le dossier des conversions est effacé.
pub fn cleanup(app: &AppHandle) {
    if let Ok(d) = root(app) {
        let _ = fs::remove_dir_all(d);
    }
}

/// Ouvre un travail de conversion (dossier temporaire neuf) ; rend son numéro. Les dossiers d'une session
/// précédente (arrêt brutal) sont effacés au passage.
#[tauri::command]
pub async fn cad_begin(app: AppHandle, state: State<'_, Cad>) -> Result<u32, String> {
    let r = root(&app)?;
    // Travaux abandonnés par la fenêtre (jamais refermés) : au-delà de MAX_JOBS, les plus anciens sont arrêtés et
    // leur dossier effacé par le balayage ci-dessous. Une conversion ne reste jamais bloquée par d'anciens travaux.
    {
        let mut jobs = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
        while jobs.len() >= MAX_JOBS {
            let Some(&old) = jobs.keys().min() else { break };
            if let Some(j) = jobs.remove(&old) {
                stop(&j);
                j.upload.lock().unwrap_or_else(|e| e.into_inner()).take();
            }
        }
    }
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let dir = r.join(format!("job-{}-{id}", std::process::id()));
    let live: Vec<PathBuf> = state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .map(|j| j.dir.clone())
        .collect();
    let d = dir.clone();
    blocking(move || {
        if let Ok(list) = fs::read_dir(&r) {
            for e in list.flatten() {
                let p = e.path();
                if !live.contains(&p) {
                    let _ = fs::remove_dir_all(&p);
                }
            }
        }
        fs::create_dir_all(d.join("in")).map_err(|e| e.to_string())?;
        fs::create_dir_all(d.join("out")).map_err(|e| e.to_string())
    })
    .await?;
    state.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(
        id,
        Arc::new(Job {
            dir,
            cancel: AtomicBool::new(false),
            child: Mutex::new(None),
            upload: Mutex::new(None),
            out: Mutex::new(None),
        }),
    );
    Ok(id)
}

/// Fichier d'entrée d'un envoi par morceaux : créé en exclusivité (`create_new`). Un nom déjà pris est refusé au lieu
/// d'être vidé : après une conversion ODA, `input.DWG` peut être un lien physique vers le DWG de l'utilisateur
/// (même fichier sur le disque), et l'ouvrir en écriture écraserait son dessin ; un lien symbolique posé là n'est
/// pas suivi non plus.
fn open_upload(path: &Path) -> Result<File, String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => {
                "Ce travail a déjà un fichier d'entrée : ouvrez un nouveau travail".to_string()
            }
            _ => format!("Écriture impossible : {e}"),
        })
}
fn header<'a>(r: &'a Request<'_>, k: &str) -> Option<&'a str> {
    r.headers().get(k).and_then(|v| v.to_str().ok())
}

/// Un morceau du fichier à convertir (corps binaire ; travail dans `x-job`, position dans `x-pos`, type dans `x-ext` :
/// `dwg` par défaut, DWG glissé dans la fenêtre ; `dxf` pour l'export DWG, DXF écrit par l'application). Il s'écrit
/// dans le dossier d'entrée du travail, toujours sous le nom `input.DWG` ou `input.DXF`.
#[tauri::command]
pub async fn cad_upload_write(state: State<'_, Cad>, request: Request<'_>) -> Result<(), String> {
    let id: u32 = header(&request, "x-job")
        .and_then(|v| v.parse().ok())
        .ok_or("Travail x-job manquant")?;
    let pos: u64 = header(&request, "x-pos")
        .and_then(|v| v.parse().ok())
        .ok_or("Position x-pos manquante")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    let dxf = header(&request, "x-ext") == Some("dxf");
    pos.checked_add(bytes.len() as u64)
        .filter(|&e| e <= if dxf { MAX_DXF } else { MAX_DWG })
        .ok_or("Fichier trop gros")?;
    let job = state.job(id)?;
    let mut up = job.upload.lock().unwrap_or_else(|e| e.into_inner());
    if up.is_none() {
        *up = Some(open_upload(&job.dir.join("in").join(if dxf {
            "input.DXF"
        } else {
            "input.DWG"
        }))?);
    }
    let f = up.as_mut().ok_or("Écriture impossible")?;
    blocking_in_place(|| {
        f.seek(SeekFrom::Start(pos))?;
        f.write_all(bytes)
    })
    .map_err(|e| format!("Écriture impossible : {e}"))
}

#[derive(Serialize)]
pub struct Converted {
    job: u32,
    converter: &'static str,
    version: Option<String>,
    /// Taille du DXF (octets).
    size: u64,
    ms: u64,
    /// Code de sortie non nul alors que le DXF est complet (avertissements du convertisseur).
    warning: Option<String>,
}

/// Convertit le DWG du travail en DXF. `path` : DWG choisi dans la boîte « Ouvrir » ; sans `path`, le DWG envoyé par
/// `cad_upload_write`. converter : oda | libredwg | auto. Progression : { stage: copy | convert | done, ms, bytes }
/// quatre fois par seconde (bytes : taille du DXF déjà écrite). `cad_cancel` arrête le convertisseur.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cad_convert_dwg(
    app: AppHandle,
    grants: State<'_, Mutex<Grants>>,
    state: State<'_, Cad>,
    job: u32,
    path: Option<String>,
    converter: String,
    timeout_s: Option<u64>,
    on_progress: Channel<Value>,
) -> Result<Converted, String> {
    let want = parse_kind(&converter)?;
    let src = match &path {
        Some(p) => {
            let raw = PathBuf::from(p);
            if !can_read(&app, &grants, &raw) {
                return Err("Fichier non autorisé : ouvrez-le avec la boîte de dialogue".into());
            }
            Some(raw)
        }
        None => None,
    };
    let j = state.job(job)?;
    let timeout = clamp_timeout(timeout_s);
    blocking(move || run(job, &j, src, want, timeout, &on_progress)).await
}

fn run(
    id: u32,
    j: &Job,
    src: Option<PathBuf>,
    want: Option<Kind>,
    timeout: Duration,
    ch: &Channel<Value>,
) -> Result<Converted, String> {
    let t0 = Instant::now();
    let (kind, exe) = choose(want, Dir::ToDxf)?;
    let in_dir = j.dir.join("in");
    let out_dir = j.dir.join("out");
    let staged = in_dir.join("input.DWG");
    // Entrée : le fichier choisi (vérifié), ou celui envoyé par morceaux (fermé ici, puis vérifié).
    let input = match src {
        Some(p) => {
            let c = validate_dwg(&p)?;
            if kind == Kind::Oda {
                let _ = ch.send(json!({ "stage": "copy", "ms": 0 }));
                if fs::hard_link(&c, &staged).is_err() {
                    fs::copy(&c, &staged).map_err(|e| format!("Copie du DWG impossible : {e}"))?;
                }
                staged.clone()
            } else {
                c
            }
        }
        None => {
            if let Some(f) = j.upload.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = f.sync_data();
            }
            validate_dwg(&staged)?
        }
    };
    if j.cancel.load(Ordering::SeqCst) {
        return Err("Conversion annulée".into());
    }
    let args = build_args(kind, &input, &in_dir, &out_dir);
    let (status, tail) = exec(
        j,
        kind.name(),
        &exe,
        &args,
        &out_dir,
        MAX_DXF,
        t0,
        timeout,
        ch,
    )?;
    let out = find_dxf(&out_dir).filter(|p| dxf_complete(p));
    let Some(out) = out else {
        log::warn!("dwg : {} : échec ({status}) {tail}", kind.name());
        return Err(if tail.is_empty() {
            format!("{} n'a pas produit de DXF ({status})", kind.name())
        } else {
            format!("{} n'a pas produit de DXF : {tail}", kind.name())
        });
    };
    // Le DWG copié n'est plus utile : place libérée tout de suite.
    let _ = fs::remove_file(&staged);
    let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    let ms = t0.elapsed().as_millis() as u64;
    let version = match kind {
        Kind::Oda => oda_version(&exe),
        Kind::LibreDwg => None,
    };
    log::info!("dwg : {} → DXF {size} octets en {ms} ms", kind.name());
    *j.out.lock().unwrap_or_else(|e| e.into_inner()) = Some(out);
    let _ = ch.send(json!({ "stage": "done", "ms": ms, "bytes": size }));
    Ok(Converted {
        job: id,
        converter: kind.id(),
        version,
        size,
        ms,
        warning: (!status.success()).then(|| format!("{status} {tail}").trim().to_string()),
    })
}

/// Lance le convertisseur (sans interpréteur de commandes) et le surveille : progression (temps, taille déjà écrite
/// dans `out_dir`) quatre fois par seconde, annulation, délai, taille maximale. Rend son code de sortie et ses
/// dernières lignes.
#[allow(clippy::too_many_arguments)]
fn exec(
    j: &Job,
    name: &str,
    exe: &Path,
    args: &[OsString],
    out_dir: &Path,
    max_out: u64,
    t0: Instant,
    timeout: Duration,
    ch: &Channel<Value>,
) -> Result<(std::process::ExitStatus, String), String> {
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .current_dir(&j.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{name} n'a pas pu démarrer : {e}"))?;
    // Sorties du convertisseur lues en continu (un tuyau plein le bloquerait) ; on garde les dernières lignes.
    let lines = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let mut readers = vec![];
    let pipes: Vec<Box<dyn Read + Send>> = [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .collect();
    for p in pipes {
        let l = lines.clone();
        readers.push(std::thread::spawn(move || {
            for line in BufReader::new(p).split(b'\n').map_while(Result::ok) {
                let mut q = l.lock().unwrap_or_else(|e| e.into_inner());
                q.push_back(String::from_utf8_lossy(&line[..line.len().min(400)]).into_owned());
                if q.len() > 40 {
                    q.pop_front();
                }
            }
        }));
    }
    *j.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    let watch_out = |dir: &Path| -> u64 {
        fs::read_dir(dir)
            .map(|l| {
                l.flatten()
                    .filter_map(|e| e.metadata().ok())
                    .map(|m| m.len())
                    .sum()
            })
            .unwrap_or(0)
    };
    let mut last = Instant::now() - Duration::from_secs(1);
    let status = loop {
        let st = {
            let mut g = j.child.lock().unwrap_or_else(|e| e.into_inner());
            match g.as_mut() {
                Some(c) => c.try_wait().map_err(|e| e.to_string())?,
                None => return Err("Conversion annulée".into()),
            }
        };
        if let Some(s) = st {
            break s;
        }
        let bytes = watch_out(out_dir);
        let why = if j.cancel.load(Ordering::SeqCst) {
            Some("Conversion annulée".to_string())
        } else if t0.elapsed() > timeout {
            Some(format!(
                "Conversion trop longue (plus de {} min) : arrêtée",
                timeout.as_secs() / 60
            ))
        } else if bytes > max_out {
            Some("Fichier converti trop gros : conversion arrêtée".to_string())
        } else {
            None
        };
        if let Some(why) = why {
            if let Some(mut c) = j.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            log::warn!("cad : {why}");
            return Err(why);
        }
        if last.elapsed() >= Duration::from_millis(250) {
            last = Instant::now();
            let _ = ch.send(json!({ "stage": "convert", "ms": t0.elapsed().as_millis() as u64, "bytes": bytes }));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    j.child.lock().unwrap_or_else(|e| e.into_inner()).take();
    for r in readers {
        let _ = r.join();
    }
    let tail = tail_text(&lines.lock().unwrap_or_else(|e| e.into_inner()));
    if j.cancel.load(Ordering::SeqCst) {
        return Err("Conversion annulée".into());
    }
    Ok((status, tail))
}

// ---------------------------------------------------------------------------
// Export : DXF écrit par l'application → DWG (ODA File Converter, ou dxf2dwg de LibreDWG s'il est installé)
// ---------------------------------------------------------------------------

/// Versions DWG proposées (année d'AutoCAD qui a introduit le format) et leur signature en tête de fichier.
const DWG_YEARS: [(&str, &str); 6] = [
    ("2018", "AC1032"),
    ("2013", "AC1027"),
    ("2010", "AC1024"),
    ("2007", "AC1021"),
    ("2004", "AC1018"),
    ("2000", "AC1015"),
];

/// Argument de version du convertisseur pour l'année demandée, et l'année réellement écrite. ODA écrit toutes les
/// versions (ACAD2018, ACAD2013…). dxf2dwg (LibreDWG 0.14, `--help`) n'écrit que r12, r14, r2000 (défaut) et r2004 ;
/// une année plus récente donne donc un DWG 2000, que toutes les applications ouvrent, et la fenêtre le dit.
fn dwg_version_arg(kind: Kind, want: &str) -> Result<(String, &'static str), String> {
    let (year, _) = DWG_YEARS
        .iter()
        .find(|(y, _)| *y == want)
        .ok_or("Version DWG inconnue")?;
    Ok(match kind {
        Kind::Oda => (format!("ACAD{year}"), year),
        Kind::LibreDwg if *year == "2004" => ("r2004".into(), "2004"),
        Kind::LibreDwg => ("r2000".into(), "2000"),
    })
}
/// Arguments de l'export. ODA : comme l'import, type DWG et filtre *.DXF. dxf2dwg : écrase, version, sortie, DXF.
fn build_export_args(
    kind: Kind,
    input: &Path,
    in_dir: &Path,
    out_dir: &Path,
    ver: &str,
) -> Vec<OsString> {
    match kind {
        Kind::Oda => vec![
            in_dir.as_os_str().to_owned(),
            out_dir.as_os_str().to_owned(),
            ver.into(),
            "DWG".into(),
            "0".into(),
            "1".into(),
            "*.DXF".into(),
        ],
        Kind::LibreDwg => vec![
            "-y".into(),
            "--as".into(),
            ver.into(),
            "-o".into(),
            out_dir.join("output.dwg").into_os_string(),
            input.as_os_str().to_owned(),
        ],
    }
}
/// Année du format d'un DWG d'après sa signature (« AC1032 » → 2018), None si ce n'est pas un DWG connu.
fn dwg_year(p: &Path) -> Option<&'static str> {
    let mut head = [0u8; 6];
    File::open(p).ok()?.read_exact(&mut head).ok()?;
    DWG_YEARS
        .iter()
        .find(|(_, sig)| sig.as_bytes() == head)
        .map(|(y, _)| *y)
}
/// Premier fichier .dwg (casse indifférente) d'un dossier.
fn find_dwg(dir: &Path) -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            is_plain_file(p)
                && p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("dwg"))
        })
        .collect();
    v.sort();
    v.into_iter().next()
}

#[derive(Serialize)]
pub struct Exported {
    job: u32,
    converter: &'static str,
    /// Version du convertisseur (ODA), si connue.
    version: Option<String>,
    /// Année du format DWG réellement écrit (lue dans le fichier) : 2018, 2013… 2000.
    dwg: &'static str,
    size: u64,
    ms: u64,
    warning: Option<String>,
}

/// Convertit en DWG le DXF envoyé par `cad_upload_write` (x-ext: dxf). version : 2018 | 2013 | 2010 | 2007 | 2004 |
/// 2000 ; converter : oda | libredwg | auto. Le DWG reste dans le dossier du travail ; `cad_save_output` le copie à
/// l'emplacement choisi dans la boîte « Enregistrer sous ».
#[tauri::command]
pub async fn cad_export_dwg(
    state: State<'_, Cad>,
    job: u32,
    version: String,
    converter: String,
    timeout_s: Option<u64>,
    on_progress: Channel<Value>,
) -> Result<Exported, String> {
    let want = parse_kind(&converter)?;
    let j = state.job(job)?;
    let timeout = clamp_timeout(timeout_s);
    blocking(move || run_export(job, &j, &version, want, timeout, &on_progress)).await
}

fn run_export(
    id: u32,
    j: &Job,
    version: &str,
    want: Option<Kind>,
    timeout: Duration,
    ch: &Channel<Value>,
) -> Result<Exported, String> {
    let t0 = Instant::now();
    let (kind, exe) = choose(want, Dir::ToDwg)?;
    let (ver, _) = dwg_version_arg(kind, version)?;
    let in_dir = j.dir.join("in");
    let out_dir = j.dir.join("out");
    let input = in_dir.join("input.DXF");
    if let Some(f) = j.upload.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = f.sync_data();
    }
    let len = fs::metadata(&input).map(|m| m.len()).unwrap_or(0);
    if len == 0 || len > MAX_DXF || !dxf_complete(&input) {
        return Err("DXF à convertir incomplet".into());
    }
    let name = kind.tool(Dir::ToDwg);
    let args = build_export_args(kind, &input, &in_dir, &out_dir, &ver);
    let (status, tail) = exec(j, name, &exe, &args, &out_dir, MAX_DWG, t0, timeout, ch)?;
    let out = find_dwg(&out_dir).and_then(|p| dwg_year(&p).map(|y| (p, y)));
    let Some((out, dwg)) = out else {
        log::warn!("dwg : {name} : échec ({status}) {tail}");
        return Err(if tail.is_empty() {
            format!("{name} n'a pas produit de DWG ({status})")
        } else {
            format!("{name} n'a pas produit de DWG : {tail}")
        });
    };
    let _ = fs::remove_file(&input);
    let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    let ms = t0.elapsed().as_millis() as u64;
    log::info!("dwg : {name} → DWG {dwg}, {size} octets en {ms} ms");
    *j.out.lock().unwrap_or_else(|e| e.into_inner()) = Some(out);
    let _ = ch.send(json!({ "stage": "done", "ms": ms, "bytes": size }));
    Ok(Exported {
        job: id,
        converter: kind.id(),
        version: match kind {
            Kind::Oda => oda_version(&exe),
            Kind::LibreDwg => None,
        },
        dwg,
        size,
        ms,
        warning: (!status.success()).then(|| format!("{status} {tail}").trim().to_string()),
    })
}

/// Copie le DWG produit par `cad_export_dwg` à l'emplacement choisi dans la boîte « Enregistrer sous » (autorisation
/// d'écriture vérifiée, extension .dwg), par l'écriture atomique de files.rs. Rend la taille écrite.
#[tauri::command]
pub async fn cad_save_output(
    app: AppHandle,
    grants: State<'_, Mutex<Grants>>,
    state: State<'_, Cad>,
    job: u32,
    path: String,
) -> Result<u64, String> {
    let target = PathBuf::from(&path);
    if !can_write(&app, &grants, &target) {
        return Err("Emplacement non autorisé : choisissez-le dans la boîte de dialogue".into());
    }
    if !target
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("dwg"))
    {
        return Err("Le fichier enregistré doit avoir l'extension .dwg".into());
    }
    let j = state.job(job)?;
    let src = j
        .out
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("dwg")))
        .ok_or("Aucun DWG converti à enregistrer")?;
    blocking(move || crate::files::copy_atomic(&src, &target)).await
}

/// Morceau du DXF converti : `len` octets (16 Mo au plus) à partir de `offset`. Vide à la fin du fichier.
#[tauri::command]
pub async fn cad_read(
    state: State<'_, Cad>,
    job: u32,
    offset: u64,
    len: u32,
) -> Result<Response, String> {
    let j = state.job(job)?;
    let path = j
        .out
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("Conversion pas terminée")?;
    let n = len.min(MAX_CHUNK) as usize;
    let bytes = blocking(move || {
        let mut f = File::open(&path).map_err(|e| format!("Lecture impossible : {e}"))?;
        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(n);
        f.take(n as u64)
            .read_to_end(&mut buf)
            .map_err(|e| format!("Lecture impossible : {e}"))?;
        Ok(buf)
    })
    .await?;
    Ok(Response::new(bytes))
}

/// Arrête la conversion du travail (le convertisseur est tué).
#[tauri::command]
pub async fn cad_cancel(state: State<'_, Cad>, job: u32) -> Result<(), String> {
    if let Ok(j) = state.job(job) {
        stop(&j);
    }
    Ok(())
}

/// Fin du travail : convertisseur arrêté s'il tourne encore, dossier temporaire (DWG copié, DXF) effacé.
#[tauri::command]
pub async fn cad_cleanup(state: State<'_, Cad>, job: u32) -> Result<(), String> {
    let j = state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&job);
    if let Some(j) = j {
        stop(&j);
        j.upload.lock().unwrap_or_else(|e| e.into_inner()).take();
        let dir = j.dir.clone();
        blocking(move || {
            // Le convertisseur tué peut tenir le dossier encore un instant (Windows).
            for _ in 0..20 {
                if fs::remove_dir_all(&dir).is_ok() || !dir.exists() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        })
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jollof-cad-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn oda_arguments_are_dirs_version_type_and_filter() {
        let a = build_args(
            Kind::Oda,
            Path::new("/c/in/input.DWG"),
            Path::new("/c/in"),
            Path::new("/c/out"),
        );
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(s, ["/c/in", "/c/out", "ACAD2018", "DXF", "0", "1", "*.DWG"]);
    }

    #[test]
    fn dwg2dxf_arguments_name_the_output_then_the_input() {
        let a = build_args(
            Kind::LibreDwg,
            Path::new("/home/u/plan avec espaces; rm -rf.dwg"),
            Path::new("/c/in"),
            Path::new("/c/out"),
        );
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(s[..2], ["-y", "-o"]);
        assert!(s[2].ends_with("output.dxf") && s[2].starts_with("/c/out"));
        // Le chemin reste UN argument, tel quel : aucun interpréteur de commandes ne le découpe.
        assert_eq!(s[3], "/home/u/plan avec espaces; rm -rf.dwg");
        assert_eq!(s.len(), 4);
    }

    #[test]
    fn only_known_converters_are_accepted() {
        assert_eq!(parse_kind("oda"), Ok(Some(Kind::Oda)));
        assert_eq!(parse_kind("libredwg"), Ok(Some(Kind::LibreDwg)));
        assert_eq!(parse_kind("auto"), Ok(None));
        assert!(parse_kind("/bin/sh").is_err());
        assert!(parse_kind("ODA").is_err());
    }

    #[test]
    fn input_must_be_an_existing_dwg_with_its_signature() {
        let d = tmp("validate");
        let good = d.join("Plan d'étage (v2).DWG");
        fs::write(&good, b"AC1032\0\0\0\0data").unwrap();
        let v = validate_dwg(&good).unwrap();
        assert!(v.is_absolute());
        // Chemin relatif ou avec « .. » : rendu canonique (absolu, sans détour).
        let indirect = d.join("sub").join("..").join("Plan d'étage (v2).DWG");
        fs::create_dir_all(d.join("sub")).unwrap();
        assert_eq!(validate_dwg(&indirect).unwrap(), v);
        // Mauvaise extension, signature absente, vide, dossier, absent.
        let txt = d.join("plan.txt");
        fs::write(&txt, b"AC1032").unwrap();
        assert!(validate_dwg(&txt).is_err());
        let fake = d.join("fake.dwg");
        fs::write(&fake, b"<html>not a drawing").unwrap();
        assert!(validate_dwg(&fake).is_err());
        let empty = d.join("empty.dwg");
        fs::write(&empty, b"").unwrap();
        assert!(validate_dwg(&empty).is_err());
        let dir = d.join("folder.dwg");
        fs::create_dir_all(&dir).unwrap();
        assert!(validate_dwg(&dir).is_err());
        assert!(validate_dwg(&d.join("missing.dwg")).is_err());
        let old = d.join("old.dwg");
        fs::write(&old, b"AC1.40 old").unwrap();
        assert!(validate_dwg(&old).is_ok());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_dxf_counts_only_when_complete() {
        let d = tmp("dxf");
        let ok = d.join("a.dxf");
        fs::write(&ok, b"  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n").unwrap();
        assert!(dxf_complete(&ok));
        let cut = d.join("b.dxf");
        fs::write(&cut, b"  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nLINE\n").unwrap();
        assert!(!dxf_complete(&cut));
        let bin = d.join("c.dxf");
        let mut b = b"AutoCAD Binary DXF\r\n\x1a\0".to_vec();
        b.extend_from_slice(&[0u8; 40]);
        b.extend_from_slice(b"\0\0EOF\0");
        fs::write(&bin, &b).unwrap();
        assert!(dxf_complete(&bin));
        let junk = d.join("d.dxf");
        fs::write(&junk, b"<!doctype html> ... EOF").unwrap();
        assert!(!dxf_complete(&junk));
        // Sortie d'ODA : extension en capitales trouvée aussi.
        let o = tmp("find");
        assert!(find_dxf(&o).is_none());
        fs::write(o.join("input.DXF"), b"x").unwrap();
        fs::write(o.join("note.txt"), b"x").unwrap();
        assert_eq!(find_dxf(&o).unwrap().file_name().unwrap(), "input.DXF");
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&o);
    }

    #[test]
    fn timeout_is_bounded() {
        assert_eq!(clamp_timeout(None).as_secs(), TIMEOUT_DEFAULT);
        assert_eq!(clamp_timeout(Some(1)).as_secs(), TIMEOUT_MIN);
        assert_eq!(clamp_timeout(Some(u64::MAX)).as_secs(), TIMEOUT_MAX);
    }

    #[test]
    fn versions_are_read_without_launching_oda() {
        let plist = "<dict><key>CFBundleName</key><string>ODA</string>\
                     <key>CFBundleShortVersionString</key>\n\t<string>25.12.0</string></dict>";
        assert_eq!(
            plist_string(plist, "CFBundleShortVersionString").as_deref(),
            Some("25.12.0")
        );
        assert_eq!(plist_string(plist, "Missing"), None);
        if !cfg!(target_os = "macos") {
            assert_eq!(
                oda_version(Path::new(
                    "/pf/ODA/ODAFileConverter 25.4.0/ODAFileConverter.exe"
                ))
                .as_deref(),
                Some("25.4.0")
            );
        }
    }

    /// Essai réel, à la main : JOLLOF_DWG=<plan.dwg> JOLLOF_DWG_OUT=<dossier vide> cargo test --lib cad -- --ignored
    /// (convertisseur installé requis ; le dossier de sortie est effacé à la fin).
    #[test]
    #[ignore]
    fn real_conversion_with_an_installed_converter() {
        let (Some(dwg), Some(out)) = (
            std::env::var_os("JOLLOF_DWG"),
            std::env::var_os("JOLLOF_DWG_OUT"),
        ) else {
            return;
        };
        println!(
            "convertisseurs : {:?}",
            [Kind::Oda, Kind::LibreDwg].map(|k| detect(k, Dir::ToDxf))
        );
        let dir = PathBuf::from(out).join("job-test");
        fs::create_dir_all(dir.join("in")).unwrap();
        fs::create_dir_all(dir.join("out")).unwrap();
        let j = Job {
            dir: dir.clone(),
            cancel: AtomicBool::new(false),
            child: Mutex::new(None),
            upload: Mutex::new(None),
            out: Mutex::new(None),
        };
        let n = Arc::new(AtomicU32::new(0));
        let n2 = n.clone();
        let ch = Channel::new(move |_| {
            n2.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        let kind = std::env::var("JOLLOF_DWG_KIND")
            .ok()
            .and_then(|k| parse_kind(&k).ok().flatten());
        let r = run(
            1,
            &j,
            Some(PathBuf::from(dwg)),
            kind,
            clamp_timeout(Some(1800)),
            &ch,
        )
        .unwrap();
        println!(
            "{} : DXF {} octets en {} ms, {} messages de progression, avertissement {:?}",
            r.converter,
            r.size,
            r.ms,
            n.load(Ordering::SeqCst),
            r.warning
        );
        assert!(r.size > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Export réel, à la main : JOLLOF_DXF=<plan.dxf> JOLLOF_DWG_OUT=<dossier> [JOLLOF_DWG_VERSION=2018]
    /// cargo test --lib cad -- --ignored ; le DWG est copié en <dossier>/export.dwg (par copy_atomic) pour la suite.
    #[test]
    #[ignore]
    fn real_export_with_an_installed_converter() {
        let (Some(dxf), Some(out)) = (
            std::env::var_os("JOLLOF_DXF"),
            std::env::var_os("JOLLOF_DWG_OUT"),
        ) else {
            return;
        };
        println!(
            "convertisseurs d'export : {:?}",
            [Kind::Oda, Kind::LibreDwg].map(|k| detect(k, Dir::ToDwg))
        );
        let out = PathBuf::from(out);
        let dir = out.join("job-export");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("in")).unwrap();
        fs::create_dir_all(dir.join("out")).unwrap();
        fs::copy(PathBuf::from(dxf), dir.join("in").join("input.DXF")).unwrap();
        let j = Job {
            dir: dir.clone(),
            cancel: AtomicBool::new(false),
            child: Mutex::new(None),
            upload: Mutex::new(None),
            out: Mutex::new(None),
        };
        let ch = Channel::new(|_| Ok(()));
        let ver = std::env::var("JOLLOF_DWG_VERSION").unwrap_or_else(|_| "2018".into());
        let r = run_export(1, &j, &ver, None, clamp_timeout(Some(600)), &ch).unwrap();
        let src = j.out.lock().unwrap().clone().unwrap();
        let n = crate::files::copy_atomic(&src, &out.join("export.dwg")).unwrap();
        println!(
            "{} : DWG {} ({} octets) en {} ms, avertissement {:?}",
            r.converter, r.dwg, n, r.ms, r.warning
        );
        assert_eq!(n, r.size);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dwg_versions_map_to_each_converter() {
        assert_eq!(
            dwg_version_arg(Kind::Oda, "2018").unwrap(),
            ("ACAD2018".to_string(), "2018")
        );
        assert_eq!(
            dwg_version_arg(Kind::Oda, "2013").unwrap(),
            ("ACAD2013".to_string(), "2013")
        );
        // dxf2dwg n'écrit que r2000 et r2004 : une version plus récente donne un DWG 2000, annoncé comme tel.
        assert_eq!(
            dwg_version_arg(Kind::LibreDwg, "2018").unwrap(),
            ("r2000".to_string(), "2000")
        );
        assert_eq!(
            dwg_version_arg(Kind::LibreDwg, "2004").unwrap(),
            ("r2004".to_string(), "2004")
        );
        assert!(dwg_version_arg(Kind::Oda, "ACAD2018").is_err());
        assert!(dwg_version_arg(Kind::Oda, "2018 --x").is_err());
        assert!(dwg_version_arg(Kind::LibreDwg, "").is_err());
        assert_eq!(parse_dir("dwg"), Ok(Dir::ToDwg));
        assert_eq!(parse_dir("dxf"), Ok(Dir::ToDxf));
        assert!(parse_dir("exe").is_err());
        assert_eq!(Kind::LibreDwg.tool(Dir::ToDwg), "LibreDWG dxf2dwg");
    }

    #[test]
    fn export_arguments_are_fixed_lists() {
        let a = build_export_args(
            Kind::Oda,
            Path::new("/c/in/input.DXF"),
            Path::new("/c/in"),
            Path::new("/c/out"),
            "ACAD2013",
        );
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(s, ["/c/in", "/c/out", "ACAD2013", "DWG", "0", "1", "*.DXF"]);
        let a = build_export_args(
            Kind::LibreDwg,
            Path::new("/c/in/input.DXF"),
            Path::new("/c/in"),
            Path::new("/c/out"),
            "r2000",
        );
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(
            s,
            [
                "-y",
                "--as",
                "r2000",
                "-o",
                "/c/out/output.dwg",
                "/c/in/input.DXF"
            ]
        );
    }

    #[test]
    fn exported_dwg_is_recognised_by_its_signature() {
        let d = tmp("dwgsig");
        assert!(find_dwg(&d).is_none());
        for (sig, year) in [
            ("AC1032", Some("2018")),
            ("AC1015", Some("2000")),
            ("AC1027", Some("2013")),
            ("AC9999", None),
        ] {
            let p = d.join("output.DWG");
            fs::write(&p, format!("{sig}\0\0rest")).unwrap();
            assert_eq!(dwg_year(&p), year, "{sig}");
        }
        fs::write(d.join("short.dwg"), b"AC").unwrap();
        assert_eq!(dwg_year(&d.join("short.dwg")), None);
        assert!(find_dwg(&d).is_some());
        // Copie atomique vers la cible choisie : contenu identique, aucun temporaire restant.
        let dst = tmp("dwgcopy");
        let target = dst.join("plan réseau.dwg");
        fs::write(&target, b"ancien").unwrap();
        let src = d.join("output.DWG");
        assert_eq!(
            crate::files::copy_atomic(&src, &target).unwrap(),
            fs::metadata(&src).unwrap().len()
        );
        assert_eq!(fs::read(&target).unwrap(), fs::read(&src).unwrap());
        assert_eq!(fs::read_dir(&dst).unwrap().count(), 1);
        assert!(crate::files::copy_atomic(&d.join("absent.dwg"), &target).is_err());
        assert_eq!(
            fs::read(&target).unwrap(),
            fs::read(&src).unwrap(),
            "échec : cible intacte"
        );
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn error_tail_is_short_and_clean() {
        let mut q = VecDeque::new();
        for i in 0..20 {
            q.push_back(format!("ligne {i}\u{1b}[31m"));
        }
        let t = tail_text(&q);
        assert!(t.starts_with("ligne 14"));
        assert!(!t.contains('\u{1b}'));
        q.push_back("x".repeat(2000));
        assert!(tail_text(&q).chars().count() <= 601);
    }

    #[test]
    fn upload_never_truncates_an_existing_input() {
        // Après une conversion ODA, in/input.DWG peut être un lien physique vers le DWG de l'utilisateur : un envoi
        // par morceaux sur le même travail ne doit pas le vider.
        let d = tmp("upload-excl");
        let original = d.join("plan.dwg");
        fs::write(&original, b"AC1032 dessin de l'utilisateur").unwrap();
        let staged = d.join("input.DWG");
        if fs::hard_link(&original, &staged).is_err() {
            fs::copy(&original, &staged).unwrap();
        }
        let e = open_upload(&staged).unwrap_err();
        assert!(e.contains("déjà un fichier d'entrée"), "{e}");
        assert_eq!(
            fs::read(&original).unwrap(),
            b"AC1032 dessin de l'utilisateur"
        );
        // Dossier neuf : le fichier se crée, une seule fois.
        let fresh = d.join("neuf.DWG");
        assert!(open_upload(&fresh).is_ok());
        assert!(open_upload(&fresh).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_in_the_output_folder_are_never_read_back() {
        use std::os::unix::fs::symlink;
        let d = tmp("out-links");
        let secret = d.join("secret.txt");
        fs::write(&secret, b"0\nSECTION\n0\nEOF\n").unwrap();
        let out = d.join("out");
        fs::create_dir_all(&out).unwrap();
        symlink(&secret, out.join("a.dxf")).unwrap();
        symlink(&secret, out.join("a.dwg")).unwrap();
        assert!(find_dxf(&out).is_none());
        assert!(find_dwg(&out).is_none());
        assert!(
            !open_upload(&out.join("a.dxf")).is_ok(),
            "un lien posé à la place de l'entrée n'est pas suivi"
        );
        fs::write(out.join("b.dxf"), b"0\nEOF\n").unwrap();
        assert_eq!(find_dxf(&out).unwrap().file_name().unwrap(), "b.dxf");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn converters_are_only_searched_in_absolute_folders() {
        for dir in search_dirs() {
            assert!(dir.is_absolute(), "{}", dir.display());
        }
        for c in oda_candidates()
            .into_iter()
            .chain(libredwg_candidates(Dir::ToDxf))
        {
            assert!(c.is_absolute(), "{}", c.display());
        }
        assert!(!is_exec(Path::new("dwg2dxf")));
    }
}
