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

use crate::{blocking, blocking_in_place, can_read, Grants};
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
        match self {
            Kind::Oda => "ODA File Converter",
            Kind::LibreDwg => "LibreDWG dwg2dxf",
        }
    }
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
    let mut d: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
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
fn libredwg_candidates() -> Vec<PathBuf> {
    search_dirs()
        .into_iter()
        .map(|d| d.join(exe("dwg2dxf")))
        .collect()
}
fn is_exec(p: &Path) -> bool {
    let Ok(m) = fs::metadata(p) else { return false };
    if !m.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    true
}
fn find(kind: Kind) -> Option<PathBuf> {
    let list = match kind {
        Kind::Oda => oda_candidates(),
        Kind::LibreDwg => libredwg_candidates(),
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
/// `dwg2dxf --version` (« dwg2dxf 0.14 »), trois secondes au plus.
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
fn detect(kind: Kind) -> Option<Converter> {
    let p = find(kind)?;
    let version = match kind {
        Kind::Oda => oda_version(&p),
        Kind::LibreDwg => libredwg_version(&p),
    };
    Some(Converter {
        id: kind.id(),
        name: kind.name(),
        path: p.to_string_lossy().into_owned(),
        version,
    })
}

/// Convertisseurs DWG → DXF installés, ODA File Converter d'abord. Liste vide : aucun.
#[tauri::command]
pub async fn cad_converters() -> Result<Vec<Converter>, String> {
    blocking(|| {
        Ok([Kind::Oda, Kind::LibreDwg]
            .into_iter()
            .filter_map(detect)
            .collect())
    })
    .await
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
/// Premier fichier .dxf (casse indifférente) d'un dossier.
fn find_dxf(dir: &Path) -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
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

fn header<'a>(r: &'a Request<'_>, k: &str) -> Option<&'a str> {
    r.headers().get(k).and_then(|v| v.to_str().ok())
}

/// Un morceau du DWG glissé dans la fenêtre (corps binaire ; travail dans `x-job`, position dans `x-pos`).
/// Il s'écrit dans le dossier d'entrée du travail, toujours sous le nom `input.DWG`.
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
    pos.checked_add(bytes.len() as u64)
        .filter(|&e| e <= MAX_DWG)
        .ok_or("Fichier DWG trop gros")?;
    let job = state.job(id)?;
    let mut up = job.upload.lock().unwrap_or_else(|e| e.into_inner());
    if up.is_none() {
        *up = Some(
            File::create(job.dir.join("in").join("input.DWG"))
                .map_err(|e| format!("Écriture impossible : {e}"))?,
        );
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
    let (kind, exe) = match want {
        Some(k) => (k, find(k)),
        None => find(Kind::Oda)
            .map(|p| (Kind::Oda, Some(p)))
            .unwrap_or_else(|| (Kind::LibreDwg, find(Kind::LibreDwg))),
    };
    let exe = exe.ok_or("Aucun convertisseur DWG installé")?;
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
    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .current_dir(&j.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{} n'a pas pu démarrer : {e}", kind.name()))?;
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
        let bytes = watch_out(&out_dir);
        let why = if j.cancel.load(Ordering::SeqCst) {
            Some("Conversion annulée".to_string())
        } else if t0.elapsed() > timeout {
            Some(format!(
                "Conversion trop longue (plus de {} min) : arrêtée",
                timeout.as_secs() / 60
            ))
        } else if bytes > MAX_DXF {
            Some("DXF trop gros : conversion arrêtée".to_string())
        } else {
            None
        };
        if let Some(why) = why {
            if let Some(mut c) = j.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            log::warn!("dwg : {why}");
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
            [Kind::Oda, Kind::LibreDwg].map(detect)
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
}
