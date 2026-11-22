// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Cœur natif de Jollof Studio.
//!
//! L'interface 3D tourne dans la webview. Rust prend en charge tout ce qui
//! touche au disque : projets `.jollof`, export des vidéos et bibliothèque
//! de composants personnels stockée dans le dossier de données de l'application.
//!
//! Les commandes qui touchent au disque sont asynchrones et font leur travail dans un fil à part
//! (`blocking`) : la boucle d'événements de la fenêtre n'attend jamais une lecture ou une écriture.

pub mod ai;
mod cad;
mod espflash_cmd;
mod ffmpeg;
mod files;
mod modbus;
mod netbox;
mod plcopen;
mod qemu;
mod render;
mod serial;
mod supervision_cmd;

use percent_encoding::percent_decode_str;
use serde::de::IgnoredAny;
use std::borrow::Cow;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Exécute un travail disque (ou de calcul) dans un fil dédié et en attend le résultat.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Comme `blocking`, mais sur le fil asynchrone en cours (signalé à tokio, qui confie ailleurs ses
/// autres tâches) : pour écrire des données empruntées à la requête (vidéo de plusieurs centaines
/// de Mo, sauvegarde automatique) sans en faire une copie.
fn blocking_in_place<T>(f: impl FnOnce() -> T) -> T {
    tokio::task::block_in_place(f)
}

/// Écriture atomique : fichier temporaire à côté de la cible, vidé sur le disque, puis renommé.
/// Un arrêt brutal pendant l'écriture laisse l'ancien fichier intact, jamais un fichier tronqué.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    atomic_write(path, bytes, None)
}

/// Écriture atomique sûre, commune à tout ce que l'application écrit d'un coup (projets, réglages, clés).
///
/// Le fichier temporaire porte un nom propre à ce processus et à cette écriture, et il est créé en exclusivité
/// (`create_new`, O_EXCL) : un fichier ou un lien symbolique déjà posé à ce nom n'est jamais suivi ni écrasé (un
/// lien préparé dans un dossier partagé ne détourne pas l'écriture, un « projet.jollof.tmp » de l'utilisateur
/// n'est pas détruit). `mode` (Unix) : droits posés à la création, avant le premier octet, si bien qu'une clé
/// n'est lisible par personne d'autre à aucun moment (0o600) ; None : droits par défaut du système.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8], mode: Option<u32>) -> std::io::Result<()> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs::create_dir_all(dir)?;
    }
    let name: String = path
        .file_name()
        .map(|n| n.to_string_lossy().chars().take(80).collect())
        .unwrap_or_else(|| "fichier".into());
    let mut last = None;
    for _ in 0..16 {
        let tmp = path.with_file_name(format!(
            ".{name}.{}-{}.tmp",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let mut o = fs::OpenOptions::new();
        o.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(m) = mode {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(m);
        }
        #[cfg(not(unix))]
        let _ = mode;
        let mut f = match o.open(&tmp) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                last = Some(e);
                continue;
            }
            Err(e) => return Err(e),
        };
        let res = f.write_all(bytes).and_then(|_| f.sync_all()).and_then(|_| {
            drop(f);
            fs::rename(&tmp, path)
        });
        if res.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        return res;
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("fichier temporaire impossible à créer")))
}

// ---------------------------------------------------------------------------
// Programmes externes (arduino-cli, convertisseurs DWG) : lesquels peut-on lancer ?
//
// Ils sont cherchés par leur nom dans le PATH et aux emplacements d'installation habituels, puis lancés par leur
// chemin absolu (jamais par un interpréteur de commandes, jamais par un nom nu que le système résoudrait). Deux
// garde-fous contre un programme glissé à la place du vrai :
//  - les entrées relatives du PATH (« . », entrée vide, « bin ») sont ignorées : le dossier courant de
//    l'application (celui du projet ouvert par un double-clic, un dossier de téléchargements…) ne peut pas
//    fournir le programme ;
//  - sous Unix, un programme que n'importe quel utilisateur de la machine peut remplacer n'est pas lancé : fichier
//    inscriptible par tous, ou rangé dans un dossier inscriptible par tous (/tmp…).
// ---------------------------------------------------------------------------

/// Dossiers absolus d'un PATH (`value` : contenu de la variable).
pub(crate) fn absolute_path_dirs(value: Option<std::ffi::OsString>) -> Vec<PathBuf> {
    value
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|d| d.is_absolute())
                .collect()
        })
        .unwrap_or_default()
}

/// Dossiers du PATH où chercher un programme : les absolus seulement.
pub(crate) fn path_dirs() -> Vec<PathBuf> {
    absolute_path_dirs(std::env::var_os("PATH"))
}

/// Programme qu'on accepte de lancer : chemin absolu d'un fichier exécutable que seuls son propriétaire (ou son
/// groupe) peuvent remplacer. Les liens sont suivis (Homebrew range ses programmes derrière des liens).
pub(crate) fn trusted_exec(p: &Path) -> bool {
    if !p.is_absolute() {
        return false;
    }
    let Ok(real) = fs::canonicalize(p) else {
        return false;
    };
    let Ok(m) = fs::metadata(&real) else {
        return false;
    };
    if !m.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = m.permissions().mode();
        if mode & 0o111 == 0 || mode & 0o002 != 0 {
            return false;
        }
        // Le dossier du programme (réel) et celui où on l'a trouvé (un lien y serait remplaçable).
        for dir in [real.parent(), p.parent()].into_iter().flatten() {
            match fs::metadata(dir) {
                Ok(d) if d.permissions().mode() & 0o002 == 0 => {}
                _ => return false,
            }
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Fichiers choisis par l'utilisateur
//
// La webview ne donne jamais un chemin libre : elle demande une boîte de dialogue (ouvrir,
// enregistrer) affichée ici, et ne peut ensuite lire ou écrire QUE les chemins que l'utilisateur
// y a choisis. Même un contenu malveillant exécuté dans la webview (projet piégé, message…) ne
// peut donc ni lire ni écrire ailleurs sur le disque. Les autorisations d'écriture sont gardées
// (fichier `grants.json`) pour que « Enregistrer » fonctionne encore après un redémarrage.
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Grants {
    read: HashSet<PathBuf>,
    write: Vec<PathBuf>,
    loaded: bool,
}
const MAX_WRITE_GRANTS: usize = 200;

fn grants_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("grants.json"))
}
fn load_grants(app: &AppHandle, g: &mut Grants) {
    if g.loaded {
        return;
    }
    g.loaded = true;
    if let Some(f) = grants_file(app) {
        if let Ok(text) = fs::read_to_string(f) {
            if let Ok(list) = serde_json::from_str::<Vec<PathBuf>>(&text) {
                g.write = list;
            }
        }
    }
}
fn save_grants(app: &AppHandle, g: &Grants) {
    if let Some(f) = grants_file(app) {
        if let Some(dir) = f.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string(&g.write) {
            // Atomique, lisible par l'utilisateur seul : la liste des emplacements autorisés ne se tronque pas.
            let _ = atomic_write(&f, text.as_bytes(), Some(0o600));
        }
    }
}
fn grant_write(app: &AppHandle, state: &Mutex<Grants>, p: &Path) {
    let mut g = state.lock().unwrap_or_else(|e| e.into_inner());
    load_grants(app, &mut g);
    g.write.retain(|x| x != p);
    g.write.push(p.to_path_buf());
    if g.write.len() > MAX_WRITE_GRANTS {
        let extra = g.write.len() - MAX_WRITE_GRANTS;
        g.write.drain(0..extra);
    }
    save_grants(app, &g);
}
fn can_write(app: &AppHandle, state: &Mutex<Grants>, p: &Path) -> bool {
    let mut g = state.lock().unwrap_or_else(|e| e.into_inner());
    load_grants(app, &mut g);
    g.write.iter().any(|x| x == p)
}
fn can_read(app: &AppHandle, state: &Mutex<Grants>, p: &Path) -> bool {
    let mut g = state.lock().unwrap_or_else(|e| e.into_inner());
    load_grants(app, &mut g);
    g.read.contains(p) || g.write.iter().any(|x| x == p)
}
/// Extensions acceptées : quelques lettres ou chiffres, sans point ni séparateur.
fn clean_exts(exts: &[String]) -> Result<Vec<String>, String> {
    let ok = !exts.is_empty()
        && exts.len() <= 8
        && exts
            .iter()
            .all(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()));
    if ok {
        Ok(exts.iter().map(|e| e.to_ascii_lowercase()).collect())
    } else {
        Err("Extensions refusées".into())
    }
}
fn has_ext(p: &Path, exts: &[String]) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| exts.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// Boîte « Enregistrer sous » ; le chemin choisi devient inscriptible. None si l'utilisateur annule.
#[tauri::command]
async fn pick_save(
    app: AppHandle,
    state: State<'_, Mutex<Grants>>,
    name: String,
    label: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let exts = clean_exts(&extensions)?;
    let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
    let file_name: String = name
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .take(120)
        .collect();
    let picked = app
        .dialog()
        .file()
        .add_filter(label.chars().take(60).collect::<String>(), &refs)
        .set_file_name(file_name)
        .blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let mut path = fp.into_path().map_err(|e| e.to_string())?;
    if !has_ext(&path, &exts) {
        let ext = exts[0].clone();
        let with = match path.extension().and_then(|e| e.to_str()) {
            Some(old) => format!("{old}.{ext}"),
            None => ext,
        };
        path.set_extension(with);
    }
    grant_write(&app, &state, &path);
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Boîte « Ouvrir » ; le fichier choisi devient lisible (et inscriptible : « Enregistrer » le réécrit).
#[tauri::command]
async fn pick_open(
    app: AppHandle,
    state: State<'_, Mutex<Grants>>,
    label: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let exts = clean_exts(&extensions)?;
    let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
    let picked = app
        .dialog()
        .file()
        .add_filter(label.chars().take(60).collect::<String>(), &refs)
        .blocking_pick_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    if !has_ext(&path, &exts) {
        return Err("Type de fichier refusé".into());
    }
    {
        let mut g = state.lock().unwrap_or_else(|e| e.into_inner());
        g.read.insert(path.clone());
    }
    grant_write(&app, &state, &path);
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Écrit des octets bruts (vidéo, PDF) à un emplacement choisi par l'utilisateur, d'un coup (petits fichiers ; les
/// gros passent par files.rs, par morceaux).
/// Le chemin arrive dans l'en-tête `x-path`, encodé façon URL ; le corps est binaire,
/// ce qui évite de sérialiser des dizaines de mégaoctets en JSON.
#[tauri::command]
async fn save_bytes(
    app: AppHandle,
    state: State<'_, Mutex<Grants>>,
    request: Request<'_>,
) -> Result<u64, String> {
    let raw = request
        .headers()
        .get("x-path")
        .ok_or("En-tête x-path manquant")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = PathBuf::from(
        percent_decode_str(raw)
            .decode_utf8()
            .map_err(|e| e.to_string())?
            .into_owned(),
    );
    if !can_write(&app, &state, &path) {
        return Err("Emplacement non autorisé : choisissez-le dans la boîte de dialogue".into());
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    // Atomique : un arrêt brutal ou un disque plein laissent l'ancien fichier intact.
    blocking_in_place(|| write_atomic(&path, bytes)).map_err(|e| files::io_msg(&e))?;
    Ok(bytes.len() as u64)
}

#[tauri::command]
async fn save_text(
    app: AppHandle,
    state: State<'_, Mutex<Grants>>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !can_write(&app, &state, &p) {
        return Err("Emplacement non autorisé : choisissez-le dans la boîte de dialogue".into());
    }
    blocking(move || write_atomic(&p, contents.as_bytes()).map_err(|e| files::io_msg(&e))).await
}

#[tauri::command]
async fn read_text(
    app: AppHandle,
    state: State<'_, Mutex<Grants>>,
    path: String,
) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !can_read(&app, &state, &p) {
        return Err("Fichier non autorisé : ouvrez-le avec la boîte de dialogue".into());
    }
    blocking(move || {
        let meta = fs::metadata(&p).map_err(|e| format!("Lecture impossible : {e}"))?;
        if meta.len() > 64 * 1024 * 1024 {
            return Err("Fichier trop lourd".into());
        }
        fs::read_to_string(&p).map_err(|e| format!("Lecture impossible : {e}"))
    })
    .await
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// N'accepte que des identifiants simples pour qu'un nom ne puisse pas sortir du dossier.
fn safe_id(id: &str) -> Result<String, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id.to_string())
    } else {
        Err("Identifiant de composant invalide".into())
    }
}

/// Renvoie le JSON de chaque composant personnel (modèle .glb en base64 + broches).
#[tauri::command]
async fn library_list(app: AppHandle) -> Result<Vec<String>, String> {
    blocking(move || {
        let dir = library_dir(&app)?;
        let mut items = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(text) = fs::read_to_string(&path) {
                    items.push(text);
                }
            }
        }
        items.sort();
        Ok(items)
    })
    .await
}

/// Vérifie qu'un texte est du JSON valide sans en construire l'arbre (pas de copie en mémoire).
fn check_json(bytes: &[u8]) -> Result<(), String> {
    serde_json::from_slice::<IgnoredAny>(bytes)
        .map(|_| ())
        .map_err(|e| format!("JSON invalide : {e}"))
}

#[tauri::command]
async fn library_save(app: AppHandle, id: String, json: String) -> Result<(), String> {
    if json.len() > 64 * 1024 * 1024 {
        return Err("Composant trop lourd".into());
    }
    let id = safe_id(&id)?;
    blocking(move || {
        check_json(json.as_bytes())?;
        let path = library_dir(&app)?.join(format!("{id}.json"));
        write_atomic(&path, json.as_bytes()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn library_delete(app: AppHandle, id: String) -> Result<(), String> {
    let id = safe_id(&id)?;
    blocking(move || {
        let path = library_dir(&app)?.join(format!("{id}.json"));
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------------------
// Sauvegarde automatique du projet en cours
//
// Un seul fichier (`autosave.json`) dans le dossier de données de l'application, réécrit de façon
// atomique après chaque modification. Sans la limite de quelques Mo du stockage local de la
// webview : un projet avec des modèles importés (.glb en base64) est sauvegardé comme les autres.
// ---------------------------------------------------------------------------

/// Garde-fou contre un contenu aberrant (le stockage local s'arrêtait vers 5 Mo).
const AUTOSAVE_MAX: usize = 512 * 1024 * 1024;
/// Une écriture à la fois : deux écritures ne se mélangent jamais dans le fichier temporaire.
static AUTOSAVE_LOCK: Mutex<()> = Mutex::new(());

fn autosave_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("autosave.json"))
}

/// Contenu envoyé par la webview : corps binaire brut (UTF-8), ou `{ json: "…" }`, ou tableau
/// d'octets (repli de l'IPC quand le protocole binaire n'est pas disponible).
fn body_bytes(body: &InvokeBody) -> Result<Cow<'_, [u8]>, String> {
    match body {
        InvokeBody::Raw(b) => Ok(Cow::Borrowed(b)),
        InvokeBody::Json(serde_json::Value::String(s)) => Ok(Cow::Borrowed(s.as_bytes())),
        InvokeBody::Json(serde_json::Value::Object(m)) => match m.get("json") {
            Some(serde_json::Value::String(s)) => Ok(Cow::Borrowed(s.as_bytes())),
            _ => Err("Champ json manquant".into()),
        },
        InvokeBody::Json(serde_json::Value::Array(a)) => a
            .iter()
            .map(|x| x.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect::<Option<Vec<u8>>>()
            .map(Cow::Owned)
            .ok_or_else(|| "Corps de requête invalide".into()),
        _ => Err("Corps de requête invalide".into()),
    }
}

/// Écrit la sauvegarde (JSON vérifié) dans `path`, de façon atomique.
fn autosave_store(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > AUTOSAVE_MAX {
        return Err("Projet trop lourd pour la sauvegarde automatique".into());
    }
    check_json(bytes)?;
    let _g = AUTOSAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    write_atomic(path, bytes).map_err(|e| format!("Écriture impossible : {e}"))
}

/// Lit la sauvegarde ; vide si elle n'existe pas (ou dépasse le garde-fou).
fn autosave_load(path: &Path) -> Result<Vec<u8>, String> {
    let _g = AUTOSAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match fs::metadata(path) {
        Ok(m) if m.len() as usize > AUTOSAVE_MAX => Ok(Vec::new()),
        Ok(_) => fs::read(path).map_err(|e| format!("Lecture impossible : {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("Lecture impossible : {e}")),
    }
}

/// Enregistre la sauvegarde automatique. Le JSON arrive de préférence en corps binaire brut :
/// pas de second encodage JSON de plusieurs mégaoctets, ni d'analyse sur le fil de la fenêtre.
#[tauri::command]
async fn autosave_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let bytes = body_bytes(request.body())?;
    let path = autosave_file(&app)?;
    blocking_in_place(|| autosave_store(&path, &bytes))
}

/// Contenu de la sauvegarde automatique, en octets UTF-8 bruts (vide s'il n'y en a pas) : la
/// webview le décode elle-même, sans passer par une chaîne JSON encodée deux fois.
#[tauri::command]
async fn autosave_read(app: AppHandle) -> Result<Response, String> {
    let path = autosave_file(&app)?;
    blocking(move || autosave_load(&path).map(Response::new)).await
}

#[tauri::command]
async fn autosave_clear(app: AppHandle) -> Result<(), String> {
    let path = autosave_file(&app)?;
    blocking(move || {
        let _g = AUTOSAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    })
    .await
}

/// Résultat d'une commande arduino-cli.
#[derive(serde::Serialize)]
struct CliOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

/// Cherche arduino-cli : dans le PATH, puis aux emplacements d'installation habituels
/// (une application lancée depuis le Finder ou le menu Démarrer n'hérite pas toujours du PATH du terminal).
fn find_arduino_cli() -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "arduino-cli.exe"
    } else {
        "arduino-cli"
    };
    let mut dirs: Vec<PathBuf> = path_dirs();
    for d in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/snap/bin",
    ] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        dirs.push(home.join("bin"));
        dirs.push(home.join(".local").join("bin"));
        dirs.push(
            home.join("AppData")
                .join("Local")
                .join("Programs")
                .join("arduino-cli"),
        );
    }
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        dirs.push(PathBuf::from(pf).join("Arduino CLI"));
    }
    // Lancé par son chemin absolu ; un programme remplaçable par n'importe qui n'est pas retenu (trusted_exec).
    dirs.into_iter()
        .map(|d| d.join(exe))
        .find(|p| trusted_exec(p))
}

/// Dossier du croquis compilé et téléversé (le seul que arduino-cli peut recevoir).
fn sketch_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("sketch")
        .join("jollof_sketch"))
}
const CORE_URLS: [&str; 3] = [
    "https://espressif.github.io/arduino-esp32/package_esp32_index.json",
    "https://arduino.esp8266.com/stable/package_esp8266com_index.json",
    "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json",
];
/// Cartes avec options acceptées telles quelles : l'ESP32 du mode fidèle se compile en flash DIO (le mode QIO par
/// défaut ne démarre pas dans QEMU) ; les Nano compatibles gardent souvent l'ancien chargeur d'amorçage. Aucune autre
/// option (ni `=`, ni `,`) ne passe.
const FQBN_WITH_OPTIONS: [&str; 4] = [
    "esp32:esp32:esp32:FlashMode=dio",
    "esp32:esp32:esp32s3:FlashMode=dio",
    "esp32:esp32:esp32c3:FlashMode=dio",
    "arduino:avr:nano:cpu=atmega328old",
];
/// Propriété de compilation du mode fidèle de l'ESP32 (src/emu/esp32-wraps.js) : `build.extra_libs=-Wl,` suivi
/// d'une liste de `--wrap=symbole` (fonctions du cœur remplacées par la cale de l'émulateur), rien d'autre.
fn esp32_link_property(s: &str) -> bool {
    let Some(list) = s.strip_prefix("build.extra_libs=-Wl,") else {
        return false;
    };
    s.len() <= 8192
        && list.split(',').all(|w| {
            w.strip_prefix("--wrap=").is_some_and(|sym| {
                !sym.is_empty()
                    && sym.len() <= 64
                    && sym.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            })
        })
}
fn word(s: &str, extra: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && !s.starts_with('-')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
}
/// Dossier où la compilation dépose le programme machine (.hex, .uf2, .bin), lu ensuite par `read_build`
/// pour le faire tourner dans l'émulateur (mode « fidèle »).
fn build_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("build")
        .join("jollof_sketch"))
}
/// N'accepte que les commandes utiles au téléversement et à l'émulation, avec des arguments vérifiés : la
/// webview ne peut pas faire exécuter autre chose à arduino-cli (configuration, dépôts git…).
fn check_cli_args(app: &AppHandle, args: &[String]) -> Result<(), String> {
    check_cli_args_in(&sketch_dir(app)?, &build_dir(app)?, args)
}
fn check_cli_args_in(sketch: &Path, build: &Path, args: &[String]) -> Result<(), String> {
    let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let is_sketch = |p: &str| Path::new(p) == sketch;
    let is_build = |p: &str| Path::new(p) == build;
    let fqbn =
        |s: &str| (word(s, ":_-.") && s.split(':').count() >= 3) || FQBN_WITH_OPTIONS.contains(&s);
    let urls_ok = |rest: &[&str]| {
        rest.is_empty()
            || (rest.len() == 2 && rest[0] == "--additional-urls" && CORE_URLS.contains(&rest[1]))
    };
    let port = |s: &str| {
        !s.is_empty()
            && s.len() <= 64
            && !s.starts_with('-')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "/._-:".contains(c))
    };
    let ok = match a.as_slice() {
        ["board", "list", "--format", "json"] => true,
        ["core", "list", "--format", "json"] => true,
        ["core", "update-index", rest @ ..] => urls_ok(rest),
        ["core", "install", core, rest @ ..] => {
            word(core, ":_-.") && core.split(':').count() == 2 && urls_ok(rest)
        }
        ["lib", "install", libs @ ..] => {
            !libs.is_empty() && libs.len() <= 20 && libs.iter().all(|l| word(l, " _-."))
        }
        ["compile", "--fqbn", f, dir] => fqbn(f) && is_sketch(dir),
        ["compile", "--fqbn", f, "--output-dir", out, dir] => {
            fqbn(f) && is_build(out) && is_sketch(dir)
        }
        ["compile", "--fqbn", f, "--build-property", prop, "--output-dir", out, dir] => {
            f.starts_with("esp32:")
                && fqbn(f)
                && esp32_link_property(prop)
                && is_build(out)
                && is_sketch(dir)
        }
        ["upload", "-p", p, "--fqbn", f, dir] => port(p) && fqbn(f) && is_sketch(dir),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err("Commande arduino-cli refusée".into())
    }
}

/// Lance arduino-cli (compilation, téléversement, cartes, bibliothèques), arguments vérifiés.
/// Exécuté à part pour ne pas figer l'interface pendant une compilation.
#[tauri::command]
async fn arduino_cli(app: AppHandle, args: Vec<String>) -> Result<CliOutput, String> {
    check_cli_args(&app, &args)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exe = find_arduino_cli().ok_or_else(|| "arduino-cli introuvable".to_string())?;
        let out = std::process::Command::new(exe)
            .args(&args)
            .output()
            .map_err(|e| format!("arduino-cli n’a pas pu démarrer : {e}"))?;
        Ok(CliOutput {
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dossiers du croquis et de sa compilation, pour construire la commande `compile --output-dir`.
#[tauri::command]
fn build_paths(app: AppHandle) -> Result<(String, String), String> {
    Ok((
        sketch_dir(&app)?.to_string_lossy().into_owned(),
        build_dir(&app)?.to_string_lossy().into_owned(),
    ))
}

/// Programme machine produit par la dernière compilation : `hex` (Uno, Nano), `uf2` ou `bin` (Pico), `merged.bin`
/// (ESP32 : image complète de la flash, chargeur d'amorçage et partitions compris). Seul le dossier de
/// compilation est lu, seulement ces extensions, 16 Mo au plus.
#[tauri::command]
async fn read_build(app: AppHandle, ext: String) -> Result<tauri::ipc::Response, String> {
    if !["hex", "uf2", "bin", "elf", "merged.bin"].contains(&ext.as_str()) {
        return Err("Format refusé".into());
    }
    let path = build_dir(&app)?.join(format!("jollof_sketch.ino.{ext}"));
    let bytes = blocking(move || {
        let len = fs::metadata(&path)
            .map_err(|e| format!("Programme compilé introuvable : {e}"))?
            .len();
        if len > 16 * 1024 * 1024 {
            return Err("Programme compilé trop gros".to_string());
        }
        fs::read(&path).map_err(|e| format!("Programme compilé introuvable : {e}"))
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Cale du mode fidèle de l'ESP32 (entrées, ADC, interruptions vues par l'émulateur), compilée avec le croquis.
const ESP32_SHIM: &str = include_str!("../../src/emu/esp32-shim/jollof_qemu_shim.cpp");
const ESP32_SHIM_FILE: &str = "jollof_qemu_shim.cpp";

/// Écrit le programme dans un croquis Arduino (dossier et fichier .ino du même nom) et renvoie son dossier.
/// shim : ajoute la cale de l'ESP32 émulé (sinon elle est retirée : le dossier sert à toutes les cartes).
#[tauri::command]
async fn write_sketch(app: AppHandle, code: String, shim: Option<bool>) -> Result<String, String> {
    if code.len() > 1024 * 1024 {
        return Err("Programme trop long".into());
    }
    let dir = sketch_dir(&app)?;
    blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("jollof_sketch.ino"), code).map_err(|e| e.to_string())?;
        if shim == Some(true) {
            fs::write(dir.join(ESP32_SHIM_FILE), ESP32_SHIM).map_err(|e| e.to_string())?;
        } else {
            let _ = fs::remove_file(dir.join(ESP32_SHIM_FILE));
        }
        Ok(dir.to_string_lossy().into_owned())
    })
    .await
}

/// Ouvre un lien (http ou https seulement) dans le navigateur du système : les liens des
/// consignes et des messages ne doivent pas remplacer l'application dans sa fenêtre.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let ok = (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() < 2048
        && !url.chars().any(|c| c.is_control() || c == '"' || c == ' ');
    if !ok {
        return Err("Adresse refusée".into());
    }
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Langue choisie à l'installation (fichier `language.txt` écrit par l'installateur Windows
/// à côté de l'exécutable) ; None si l'installateur n'en a pas écrit.
#[tauri::command]
async fn install_language() -> Option<String> {
    blocking(|| Ok(read_install_language()))
        .await
        .ok()
        .flatten()
}
fn read_install_language() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for p in [
        dir.join("language.txt"),
        dir.join("..").join("Resources").join("language.txt"),
    ] {
        if let Ok(t) = fs::read_to_string(&p) {
            let l = t.trim().to_lowercase();
            if l == "fr" || l == "en" {
                return Some(l);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Projet ouvert par le système : double-clic sur un .jollof (Finder, Explorateur, gestionnaire de fichiers), ou
// fichier glissé sur l'icône. Le chemin vient du système, pas de la webview : c'est un choix de l'utilisateur, au
// même titre que la boîte « Ouvrir ». Il devient lisible et inscriptible, attend dans LaunchFile, et la fenêtre le
// prend (take_launch_file) au démarrage ou quand l'évènement « open-file » arrive. Une seule application tourne :
// un deuxième lancement (single-instance) passe son fichier à la première et s'arrête.
// ---------------------------------------------------------------------------

#[derive(Default)]
struct LaunchFile(Mutex<Option<PathBuf>>);

/// Projet désigné par la ligne de commande : premier argument (après le programme) qui nomme un .jollof existant,
/// relatif au dossier de lancement.
fn project_arg(args: &[String], cwd: &Path) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .find(|p| is_project_file(p))
}
fn is_project_file(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("jollof"))
        && p.is_file()
}
/// Met la fenêtre au premier plan (deuxième lancement, fichier reçu).
fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
/// Projet reçu du système : autorisé, mis en attente, annoncé à la fenêtre.
fn offer_launch_file(app: &AppHandle, p: PathBuf) {
    let p = p.canonicalize().unwrap_or(p);
    log::info!("projet reçu du système : {}", p.display());
    grant_write(app, &app.state::<Mutex<Grants>>(), &p);
    *app.state::<LaunchFile>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(p);
    let _ = app.emit("open-file", ());
    focus_main(app);
}
/// Projet reçu du système et pas encore ouvert (une seule fois), ou None.
#[tauri::command]
fn take_launch_file(state: State<'_, LaunchFile>) -> Option<String> {
    state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .map(|p| p.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Journal : fichier tournant (1 Mo, trois anciens gardés) dans le dossier des journaux du système. Rust y écrit
// ses évènements ; la fenêtre y envoie ses erreurs (log_js, en nombre borné). « Aide → Ouvrir le dossier des
// journaux » le montre pour l'attacher à un rapport de bogue.
// ---------------------------------------------------------------------------

/// Messages de la fenêtre acceptés par session : une erreur répétée à chaque image ne remplit pas le disque.
const MAX_JS_LOGS: u32 = 300;
static JS_LOGS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

fn clean_log_text(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .take(4000)
        .collect()
}
/// Erreur ou avertissement de la fenêtre, écrit dans le journal.
#[tauri::command]
fn log_js(level: String, message: String) {
    use std::sync::atomic::Ordering;
    let n = JS_LOGS.fetch_add(1, Ordering::Relaxed);
    if n > MAX_JS_LOGS {
        return;
    }
    if n == MAX_JS_LOGS {
        log::warn!(target: "webview", "trop de messages : la suite n'est plus écrite");
        return;
    }
    let m = clean_log_text(&message);
    match level.as_str() {
        "error" => log::error!(target: "webview", "{m}"),
        "warn" => log::warn!(target: "webview", "{m}"),
        _ => log::info!(target: "webview", "{m}"),
    }
}
/// Ouvre le dossier des journaux dans le gestionnaire de fichiers du système.
#[tauri::command]
fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&dir).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}
/// Une panique (bogue) est écrite dans le journal avant le message habituel.
fn log_panics() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panique : {info}");
        prev(info);
    }));
}

/// La fenêtre ne quitte jamais l'application : toute navigation vers une autre adresse
/// (lien piégé dans un message, redirection…) est bloquée ; les liens s'ouvrent dans le
/// navigateur du système par `open_external`.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            allowed_navigation(url.scheme(), url.host_str().unwrap_or(""))
        })
        .build()
}
fn allowed_navigation(scheme: &str, host: &str) -> bool {
    match scheme {
        "tauri" => true,
        "http" | "https" => {
            host == "tauri.localhost"
                || (cfg!(debug_assertions) && (host == "localhost" || host == "127.0.0.1"))
        }
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    let mut log_targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("jollof-studio".into()),
    })];
    if cfg!(debug_assertions) {
        log_targets.push(Target::new(TargetKind::Stdout));
    }
    tauri::Builder::default()
        // En premier : un deuxième lancement passe son projet à l'application ouverte et s'arrête aussitôt.
        .plugin(tauri_plugin_single_instance::init(
            |app, argv, cwd| match project_arg(&argv, Path::new(&cwd)) {
                Some(p) => offer_launch_file(app, p),
                None => focus_main(app),
            },
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .targets(log_targets)
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("tokio_modbus", log::LevelFilter::Warn)
                .level_for("espflash", log::LevelFilter::Warn)
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                .build(),
        )
        // Taille, position et état agrandi de la fenêtre retrouvés (pas sa visibilité : elle s'ouvre toujours).
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        // Mises à jour de l'édition gratuite : manifeste latest.json de la dernière version GitHub,
        // installateur vérifié par sa signature (clé publique dans tauri.conf.json), puis redémarrage.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(navigation_guard())
        .manage(Mutex::new(Grants::default()))
        .manage(LaunchFile::default())
        .manage(serial::Ports::default())
        .manage(qemu::Qemu::default())
        .manage(ai::Bridge::default())
        .manage(supervision_cmd::Supervision::default())
        .manage(modbus::Modbus::default())
        .manage(render::Render::default())
        .manage(ffmpeg::Ffmpeg::default())
        .manage(cad::Cad::default())
        .manage(files::Writes::default())
        .setup(|app| {
            log_panics();
            log::info!(
                "{} {} ({} {})",
                app.package_info().name,
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            if let Some(p) = project_arg(&args, &cwd) {
                offer_launch_file(app.handle(), p);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            supervision_cmd::supervision,
            pick_save,
            pick_open,
            save_bytes,
            render::render_begin,
            render::render_write,
            render::render_end,
            render::render_discard,
            render::render_save,
            ffmpeg::ffmpeg_info,
            ffmpeg::master_aux,
            ffmpeg::master_begin,
            ffmpeg::master_frame,
            ffmpeg::master_end,
            ffmpeg::master_abort,
            save_text,
            read_text,
            library_list,
            library_save,
            library_delete,
            autosave_write,
            autosave_read,
            autosave_clear,
            arduino_cli,
            write_sketch,
            build_paths,
            read_build,
            install_language,
            open_external,
            take_launch_file,
            log_js,
            open_log_dir,
            serial::serial_list,
            serial::serial_open,
            serial::serial_write,
            serial::serial_reset,
            serial::serial_close,
            qemu::qemu_status,
            qemu::qemu_install,
            qemu::qemu_flash,
            qemu::qemu_start,
            qemu::qemu_input,
            qemu::qemu_stop,
            ai::ai_bridge,
            ai::ai_reply,
            ai::ai_new_token,
            ai::ai_end_session,
            ai::ai_focus,
            ai::ai_clients,
            ai::ai_connect,
            modbus::modbus_start,
            modbus::modbus_stop,
            modbus::modbus_image,
            plcopen::plc_export_xml,
            espflash_cmd::esp_detect,
            espflash_cmd::esp_flash,
            cad::cad_converters,
            cad::cad_begin,
            cad::cad_upload_write,
            cad::cad_convert_dwg,
            cad::cad_read,
            cad::cad_cancel,
            cad::cad_cleanup,
            cad::cad_export_dwg,
            cad::cad_save_output,
            files::file_write_begin,
            files::file_write_chunk,
            files::file_write_commit,
            files::file_write_abort,
            files::file_size,
            files::file_read_chunk,
            netbox::nb_settings,
            netbox::nb_configure,
            netbox::nb_consent,
            netbox::nb_status,
            netbox::nb_get,
            netbox::nb_write,
            netbox::nb_cancel
        ])
        .build(tauri::generate_context!())
        .expect("Impossible de démarrer Jollof Studio")
        .run(|app, event| match event {
            // Fermeture : les émulateurs ESP32 (programmes à part) s'arrêtent avec l'application.
            tauri::RunEvent::Exit => {
                app.state::<qemu::Qemu>().kill_all();
                app.state::<modbus::Modbus>().stop();
                app.state::<ffmpeg::Ffmpeg>().kill();
                render::cleanup(app);
                app.state::<cad::Cad>().kill_all();
                cad::cleanup(app);
                app.state::<files::Writes>().abort_all();
                log::info!("fermeture");
            }
            // macOS : un .jollof ouvert depuis le Finder (au lancement ou ensuite) arrive par cet évènement.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                if let Some(p) = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .find(|p| is_project_file(p))
                {
                    offer_launch_file(app, p);
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn arduino_cli_allowlist() {
        let sk = PathBuf::from("/cache/sketch/jollof_sketch");
        let bd = PathBuf::from("/cache/build/jollof_sketch");
        let d = sk.to_string_lossy().into_owned();
        let b = bd.to_string_lossy().into_owned();
        let ok = |a: &[&str]| check_cli_args_in(&sk, &bd, &v(a)).is_ok();
        assert!(ok(&["board", "list", "--format", "json"]));
        assert!(ok(&["core", "update-index"]));
        assert!(ok(&[
            "core",
            "update-index",
            "--additional-urls",
            CORE_URLS[0]
        ]));
        assert!(ok(&["core", "install", "arduino:avr"]));
        assert!(ok(&[
            "lib",
            "install",
            "DHT sensor library",
            "Adafruit Unified Sensor"
        ]));
        assert!(ok(&["compile", "--fqbn", "arduino:avr:uno", &d]));
        assert!(ok(&[
            "compile",
            "--fqbn",
            "arduino:avr:uno",
            "--output-dir",
            &b,
            &d
        ]));
        assert!(ok(&["core", "list", "--format", "json"]));
        assert!(ok(&[
            "upload",
            "-p",
            "/dev/cu.usbmodem1101",
            "--fqbn",
            "esp32:esp32:esp32",
            &d
        ]));
        assert!(ok(&[
            "upload",
            "-p",
            "COM3",
            "--fqbn",
            "arduino:avr:nano",
            &d
        ]));
        // Cartes de la bibliothèque : Mega, ESP32 DevKit V1, 38 broches, S3, C3 SuperMini, D1 mini, Nano à l'ancien chargeur.
        for f in [
            "arduino:avr:mega",
            "esp32:esp32:esp32doit-devkit-v1",
            "esp32:esp32:nodemcu-32s",
            "esp32:esp32:esp32s3",
            "esp32:esp32:nologo_esp32c3_super_mini",
            "esp8266:esp8266:d1_mini",
            "arduino:avr:nano:cpu=atmega328old",
        ] {
            assert!(
                ok(&["upload", "-p", "/dev/cu.usbmodem1101", "--fqbn", f, &d]),
                "{f}"
            );
        }
        assert!(
            !ok(&[
                "upload",
                "-p",
                "COM3",
                "--fqbn",
                "arduino:avr:nano:cpu=atmega168",
                &d
            ]),
            "autre option refusée"
        );
        // Mode fidèle de l'ESP32 : fonctions du cœur remplacées par la cale (--wrap), et rien d'autre.
        let wraps = "build.extra_libs=-Wl,--wrap=i2cWrite,--wrap=_ZN7OneWire5resetEv";
        assert!(ok(&[
            "compile",
            "--fqbn",
            "esp32:esp32:esp32:FlashMode=dio",
            "--build-property",
            wraps,
            "--output-dir",
            &b,
            &d
        ]));
        for bad in [
            "build.extra_libs=-Wl,--wrap=i2cWrite,-T,/etc/x.ld",
            "build.extra_libs=-Wl,--wrap=a b",
            "compiler.c.elf.extra_flags=-Wl,--wrap=x",
            "build.extra_libs=-Wl,--defsym=x=0",
        ] {
            assert!(
                !ok(&[
                    "compile",
                    "--fqbn",
                    "esp32:esp32:esp32:FlashMode=dio",
                    "--build-property",
                    bad,
                    "--output-dir",
                    &b,
                    &d
                ]),
                "{bad}"
            );
        }
        for f in [
            "esp32:esp32:esp32s3:FlashMode=dio",
            "esp32:esp32:esp32c3:FlashMode=dio",
        ] {
            assert!(ok(&[
                "compile",
                "--fqbn",
                f,
                "--build-property",
                wraps,
                "--output-dir",
                &b,
                &d
            ]));
        }
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "arduino:avr:uno",
            "--build-property",
            wraps,
            "--output-dir",
            &b,
            &d
        ]));
        // Mode fidèle du Pico : cœur arduino-pico (dépôt d'Earle Philhower), compilation vers le dossier de build.
        assert!(ok(&[
            "core",
            "update-index",
            "--additional-urls",
            CORE_URLS[2]
        ]));
        assert!(ok(&[
            "core",
            "install",
            "rp2040:rp2040",
            "--additional-urls",
            CORE_URLS[2]
        ]));
        assert!(ok(&[
            "compile",
            "--fqbn",
            "rp2040:rp2040:rpipico",
            "--output-dir",
            &b,
            &d
        ]));
        assert!(!ok(&[
            "core",
            "install",
            "rp2040:rp2040",
            "--additional-urls",
            "https://github.com/evil/package_rp2040_index.json"
        ]));
        // Mode fidèle de l'ESP32 : cœur d'Espressif, flash DIO (seule option de carte acceptée).
        assert!(ok(&[
            "core",
            "install",
            "esp32:esp32",
            "--additional-urls",
            CORE_URLS[0]
        ]));
        assert!(ok(&[
            "compile",
            "--fqbn",
            "esp32:esp32:esp32:FlashMode=dio",
            "--output-dir",
            &b,
            &d
        ]));
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "esp32:esp32:esp32:FlashMode=qio",
            "--output-dir",
            &b,
            &d
        ]));
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "esp32:esp32:esp32:FlashMode=dio,PartitionScheme=x",
            "--output-dir",
            &b,
            &d
        ]));
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "esp32:esp32:esp32:build.extra_flags=-include/etc/passwd",
            "--output-dir",
            &b,
            &d
        ]));
        assert!(!ok(&[
            "upload",
            "-p",
            "COM3",
            "--fqbn",
            "esp32:esp32:esp32:FlashMode=dio --verbose",
            &d
        ]));
        // Refusés : autres commandes, autres dossiers, options cachées, dépôts arbitraires.
        assert!(!ok(&[
            "config",
            "set",
            "library.enable_unsafe_install",
            "true"
        ]));
        assert!(!ok(&[
            "lib",
            "install",
            "--git-url",
            "https://evil.example/x.git"
        ]));
        assert!(!ok(&["lib", "install", "--zip-path", "/tmp/x.zip"]));
        assert!(!ok(&["compile", "--fqbn", "arduino:avr:uno", "/etc"]));
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "arduino:avr:uno",
            &d,
            "--build-property",
            "x"
        ]));
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "arduino:avr:uno",
            "--output-dir",
            "/tmp",
            &d
        ]));
        assert!(!ok(&[
            "compile",
            "--fqbn",
            "arduino:avr:uno",
            "--output-dir",
            &d,
            &d
        ]));
        assert!(!ok(&[
            "core",
            "install",
            "arduino:avr",
            "--additional-urls",
            "https://evil.example/index.json"
        ]));
        assert!(!ok(&[
            "upload",
            "-p",
            "--config-file=/x",
            "--fqbn",
            "arduino:avr:uno",
            &d
        ]));
        assert!(!ok(&["daemon"]));
        assert!(!ok(&[]));
    }

    #[test]
    fn launch_argument_names_an_existing_project() {
        let dir = temp_dir("launch");
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("Projet 1.JOLLOF");
        fs::write(&p, "{}").unwrap();
        fs::write(dir.join("notes.txt"), "x").unwrap();
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // Relatif au dossier de lancement, insensible à la casse de l'extension ; options et autres fichiers ignorés.
        assert_eq!(
            project_arg(
                &a(&["jollof-studio", "--flag", "notes.txt", "Projet 1.JOLLOF"]),
                &dir
            ),
            Some(p.clone())
        );
        assert_eq!(
            project_arg(&a(&["jollof-studio", p.to_str().unwrap()]), Path::new("/")),
            Some(p.clone())
        );
        // Le programme lui-même, un fichier absent ou un dossier ne comptent pas.
        assert_eq!(project_arg(&a(&[p.to_str().unwrap()]), &dir), None);
        assert_eq!(project_arg(&a(&["x", "absent.jollof"]), &dir), None);
        fs::create_dir_all(dir.join("d.jollof")).unwrap();
        assert_eq!(project_arg(&a(&["x", "d.jollof"]), &dir), None);
        assert_eq!(clean_log_text("a\u{1b}[31mb\nc"), "a [31mb\nc");
    }

    #[test]
    fn extensions() {
        assert!(clean_exts(&v(&["jollof", "json"])).is_ok());
        assert!(clean_exts(&v(&["../x"])).is_err());
        assert!(clean_exts(&v(&[])).is_err());
        assert!(has_ext(Path::new("/a/b.JOLLOF"), &v(&["jollof"])));
        assert!(!has_ext(Path::new("/a/b.exe"), &v(&["jollof"])));
    }

    #[test]
    fn navigation() {
        assert!(allowed_navigation("tauri", "localhost"));
        assert!(allowed_navigation("https", "tauri.localhost"));
        assert!(!allowed_navigation("https", "evil.example"));
        assert!(!allowed_navigation("file", ""));
        assert!(!allowed_navigation("data", ""));
        assert!(!allowed_navigation("javascript", ""));
    }

    /// Dossier temporaire propre à un test.
    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jollof-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn atomic_write() {
        let d = temp_dir("atomic");
        let f = d.join("sous").join("a.json");
        write_atomic(&f, b"{\"v\":1}").unwrap();
        write_atomic(&f, b"{\"v\":2}").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"{\"v\":2}");
        assert!(
            !d.join("sous").join("a.json.tmp").exists(),
            "aucun fichier temporaire ne reste"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn autosave_roundtrip() {
        let d = temp_dir("autosave");
        let f = d.join("autosave.json");
        assert!(
            autosave_load(&f).unwrap().is_empty(),
            "pas de sauvegarde : contenu vide"
        );
        let big = format!(
            "{{\"comps\":[],\"glb\":\"{}\"}}",
            "A".repeat(8 * 1024 * 1024)
        );
        autosave_store(&f, big.as_bytes()).unwrap(); // bien au-delà de la limite du stockage local
        assert_eq!(autosave_load(&f).unwrap(), big.as_bytes());
        assert!(autosave_store(&f, b"{pas du json").is_err());
        assert_eq!(
            autosave_load(&f).unwrap(),
            big.as_bytes(),
            "un contenu refusé ne remplace pas la sauvegarde"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn autosave_bodies() {
        let j = |s: &str| InvokeBody::Json(serde_json::from_str(s).unwrap());
        assert_eq!(
            &*body_bytes(&InvokeBody::Raw(b"{}".to_vec())).unwrap(),
            b"{}"
        );
        assert_eq!(&*body_bytes(&j(r#"{"json":"{}"}"#)).unwrap(), b"{}");
        assert_eq!(&*body_bytes(&j(r#""{}""#)).unwrap(), b"{}");
        assert_eq!(&*body_bytes(&j("[123,125]")).unwrap(), b"{}");
        assert!(body_bytes(&j(r#"{"autre":1}"#)).is_err());
        assert!(body_bytes(&j("[300]")).is_err());
    }

    #[test]
    fn runtime_helpers() {
        // Comme une commande asynchrone : tâche lancée sur le moteur d'exécution de Tauri.
        let task = tauri::async_runtime::spawn(async {
            let a = blocking_in_place(|| 20);
            let b = blocking(|| Ok(22)).await.unwrap();
            a + b
        });
        assert_eq!(tauri::async_runtime::block_on(task).unwrap(), 42);
    }

    #[test]
    fn json_check() {
        assert!(check_json(br#"{"a":[1,2,{"b":null}]}"#).is_ok());
        assert!(check_json(b"{\"a\":").is_err());
        assert!(check_json(b"").is_err());
    }

    #[test]
    fn safe_ids() {
        assert!(safe_id("mon-composant_1").is_ok());
        assert!(safe_id("../../etc/passwd").is_err());
        assert!(safe_id("").is_err());
    }

    /// Dossier d'essai privé (0700 sous Unix : même dans /tmp, personne d'autre ne peut y écrire).
    fn sec_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jollof-sec-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&d, fs::Permissions::from_mode(0o700)).unwrap();
        }
        d
    }
    fn names(d: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temporary_file() {
        let d = sec_dir("aw");
        let f = d.join("projet.jollof");
        super::atomic_write(&f, b"un", None).unwrap();
        super::atomic_write(&f, b"deux", None).unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"deux");
        assert_eq!(names(&d), vec!["projet.jollof".to_string()]);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn atomic_write_never_touches_a_file_named_like_the_old_temporary() {
        // Avant : « cible.tmp » était ouvert, vidé, puis effacé. Un fichier de l'utilisateur de ce nom reste intact.
        let d = sec_dir("aw-tmp");
        let f = d.join("projet.jollof");
        let mine = d.join("projet.jollof.tmp");
        fs::write(&mine, b"a moi").unwrap();
        write_atomic(&f, b"contenu").unwrap();
        assert_eq!(fs::read(&mine).unwrap(), b"a moi");
        assert_eq!(fs::read(&f).unwrap(), b"contenu");
        let _ = fs::remove_dir_all(d);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_does_not_follow_a_planted_symlink() {
        use std::os::unix::fs::symlink;
        let d = sec_dir("aw-link");
        let victim = d.join("victime.txt");
        fs::write(&victim, b"intact").unwrap();
        let f = d.join("projet.jollof");
        // Lien posé au nom de l'ancien temporaire : il n'est ni suivi ni remplacé.
        symlink(&victim, d.join("projet.jollof.tmp")).unwrap();
        write_atomic(&f, b"contenu").unwrap();
        assert_eq!(fs::read(&victim).unwrap(), b"intact");
        // La cible elle-même est un lien : le renommage remplace le lien, pas le fichier visé.
        let f2 = d.join("lien.jollof");
        symlink(&victim, &f2).unwrap();
        write_atomic(&f2, b"autre").unwrap();
        assert_eq!(fs::read(&victim).unwrap(), b"intact");
        assert!(!fs::symlink_metadata(&f2).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&f2).unwrap(), b"autre");
        let _ = fs::remove_dir_all(d);
    }

    #[cfg(unix)]
    #[test]
    fn secrets_are_private_from_creation() {
        use std::os::unix::fs::PermissionsExt;
        let d = sec_dir("aw-mode");
        let f = d.join("netbox.token");
        ai::write_atomic(&f, "jeton-secret", true).unwrap();
        assert_eq!(
            fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o600
        );
        // Réécrit : toujours privé, et aucun temporaire lisible ne reste.
        ai::write_atomic(&f, "autre-jeton", true).unwrap();
        assert_eq!(
            fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(names(&d), vec!["netbox.token".to_string()]);
        // Fichier d'une autre application (non privé) : ses droits sont gardés.
        let g = d.join("mcp.json");
        fs::write(&g, b"{}").unwrap();
        fs::set_permissions(&g, fs::Permissions::from_mode(0o640)).unwrap();
        ai::write_atomic(&g, "{\"a\":1}", false).unwrap();
        assert_eq!(
            fs::metadata(&g).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn relative_path_entries_never_provide_a_program() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let abs = if cfg!(windows) {
            "C:\\outils"
        } else {
            "/opt/outils"
        };
        let value = [".", "", "bin", abs, "./x"].join(sep);
        assert_eq!(
            absolute_path_dirs(Some(value.into())),
            vec![PathBuf::from(abs)]
        );
        assert!(absolute_path_dirs(None).is_empty());
        // Un nom nu ou relatif n'est jamais « digne de confiance », même s'il existe dans le dossier courant.
        assert!(!trusted_exec(Path::new("arduino-cli")));
        assert!(!trusted_exec(Path::new("./arduino-cli")));
    }

    #[cfg(unix)]
    #[test]
    fn programs_anyone_can_replace_are_not_run() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let d = sec_dir("exec");
        let mode =
            |p: &Path, m: u32| fs::set_permissions(p, fs::Permissions::from_mode(m)).unwrap();
        let good = d.join("dwg2dxf");
        fs::write(&good, b"#!/bin/sh\n").unwrap();
        mode(&good, 0o755);
        assert!(trusted_exec(&good));
        // Pas exécutable, dossier, fichier absent.
        let plain = d.join("notes");
        fs::write(&plain, b"x").unwrap();
        mode(&plain, 0o644);
        assert!(!trusted_exec(&plain));
        assert!(!trusted_exec(&d));
        assert!(!trusted_exec(&d.join("absent")));
        // Inscriptible par tous : n'importe quel compte de la machine pourrait le remplacer.
        let open = d.join("ouvert");
        fs::write(&open, b"#!/bin/sh\n").unwrap();
        mode(&open, 0o757);
        assert!(!trusted_exec(&open));
        // Lien (comme Homebrew) vers un programme sûr : accepté ; vers un programme rangé dans un dossier
        // inscriptible par tous : refusé, comme le programme lui-même.
        let link = d.join("lien");
        symlink(&good, &link).unwrap();
        assert!(trusted_exec(&link));
        let shared = d.join("partage");
        fs::create_dir_all(&shared).unwrap();
        mode(&shared, 0o777);
        let inside = shared.join("dwg2dxf");
        fs::write(&inside, b"#!/bin/sh\n").unwrap();
        mode(&inside, 0o755);
        assert!(!trusted_exec(&inside));
        let link2 = d.join("lien2");
        symlink(&inside, &link2).unwrap();
        assert!(!trusted_exec(&link2));
        mode(&shared, 0o755);
        assert!(trusted_exec(&inside));
        let _ = fs::remove_dir_all(d);
    }
}
