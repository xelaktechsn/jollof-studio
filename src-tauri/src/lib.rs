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

mod serial;

use percent_encoding::percent_decode_str;
use serde::de::IgnoredAny;
use std::borrow::Cow;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Exécute un travail disque (ou de calcul) dans un fil dédié et en attend le résultat.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
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
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let res = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res
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
    app.path().app_data_dir().ok().map(|d| d.join("grants.json"))
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
            let _ = fs::write(f, text);
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
        && exts.iter().all(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()));
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
    let file_name: String = name.chars().filter(|c| !c.is_control() && *c != '/' && *c != '\\').take(120).collect();
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

/// Écrit des octets bruts (vidéo, PDF) à un emplacement choisi par l'utilisateur.
/// Le chemin arrive dans l'en-tête `x-path`, encodé façon URL ; le corps est binaire,
/// ce qui évite de sérialiser des dizaines de mégaoctets en JSON.
#[tauri::command]
async fn save_bytes(app: AppHandle, state: State<'_, Mutex<Grants>>, request: Request<'_>) -> Result<u64, String> {
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
    blocking_in_place(|| fs::write(&path, bytes)).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(bytes.len() as u64)
}

#[tauri::command]
async fn save_text(app: AppHandle, state: State<'_, Mutex<Grants>>, path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !can_write(&app, &state, &p) {
        return Err("Emplacement non autorisé : choisissez-le dans la boîte de dialogue".into());
    }
    blocking(move || fs::write(&p, contents).map_err(|e| format!("Écriture impossible : {e}"))).await
}

#[tauri::command]
async fn read_text(app: AppHandle, state: State<'_, Mutex<Grants>>, path: String) -> Result<String, String> {
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
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
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
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("autosave.json"))
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
    let exe = if cfg!(windows) { "arduino-cli.exe" } else { "arduino-cli" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin"] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        dirs.push(home.join("bin"));
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join("AppData").join("Local").join("Programs").join("arduino-cli"));
    }
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        dirs.push(PathBuf::from(pf).join("Arduino CLI"));
    }
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
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
fn word(s: &str, extra: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
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
    let fqbn = |s: &str| word(s, ":_-.") && s.split(':').count() >= 3;
    let urls_ok = |rest: &[&str]| rest.is_empty() || (rest.len() == 2 && rest[0] == "--additional-urls" && CORE_URLS.contains(&rest[1]));
    let port = |s: &str| !s.is_empty() && s.len() <= 64 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-:".contains(c));
    let ok = match a.as_slice() {
        ["board", "list", "--format", "json"] => true,
        ["core", "list", "--format", "json"] => true,
        ["core", "update-index", rest @ ..] => urls_ok(rest),
        ["core", "install", core, rest @ ..] => word(core, ":_-.") && core.split(':').count() == 2 && urls_ok(rest),
        ["lib", "install", libs @ ..] => !libs.is_empty() && libs.len() <= 20 && libs.iter().all(|l| word(l, " _-.")),
        ["compile", "--fqbn", f, dir] => fqbn(f) && is_sketch(dir),
        ["compile", "--fqbn", f, "--output-dir", out, dir] => fqbn(f) && is_build(out) && is_sketch(dir),
        ["upload", "-p", p, "--fqbn", f, dir] => port(p) && fqbn(f) && is_sketch(dir),
        _ => false,
    };
    if ok { Ok(()) } else { Err("Commande arduino-cli refusée".into()) }
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

/// Programme machine produit par la dernière compilation : `hex` (Uno, Nano), `uf2` ou `bin` (Pico, ESP32).
/// Seul le dossier de compilation est lu, et seulement ces extensions.
#[tauri::command]
async fn read_build(app: AppHandle, ext: String) -> Result<tauri::ipc::Response, String> {
    if !["hex", "uf2", "bin", "elf"].contains(&ext.as_str()) {
        return Err("Format refusé".into());
    }
    let path = build_dir(&app)?.join(format!("jollof_sketch.ino.{ext}"));
    let bytes = blocking(move || fs::read(&path).map_err(|e| format!("Programme compilé introuvable : {e}"))).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Écrit le programme dans un croquis Arduino (dossier et fichier .ino du même nom) et renvoie son dossier.
#[tauri::command]
async fn write_sketch(app: AppHandle, code: String) -> Result<String, String> {
    if code.len() > 1024 * 1024 {
        return Err("Programme trop long".into());
    }
    let dir = sketch_dir(&app)?;
    blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("jollof_sketch.ino"), code).map_err(|e| e.to_string())?;
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
    let r = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Langue choisie à l'installation (fichier `language.txt` écrit par l'installateur Windows
/// à côté de l'exécutable) ; None si l'installateur n'en a pas écrit.
#[tauri::command]
async fn install_language() -> Option<String> {
    blocking(|| Ok(read_install_language())).await.ok().flatten()
}
fn read_install_language() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for p in [dir.join("language.txt"), dir.join("..").join("Resources").join("language.txt")] {
        if let Ok(t) = fs::read_to_string(&p) {
            let l = t.trim().to_lowercase();
            if l == "fr" || l == "en" {
                return Some(l);
            }
        }
    }
    None
}

/// La fenêtre ne quitte jamais l'application : toute navigation vers une autre adresse
/// (lien piégé dans un message, redirection…) est bloquée ; les liens s'ouvrent dans le
/// navigateur du système par `open_external`.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| allowed_navigation(url.scheme(), url.host_str().unwrap_or("")))
        .build()
}
fn allowed_navigation(scheme: &str, host: &str) -> bool {
    match scheme {
        "tauri" => true,
        "http" | "https" => host == "tauri.localhost" || (cfg!(debug_assertions) && (host == "localhost" || host == "127.0.0.1")),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation_guard())
        .manage(Mutex::new(Grants::default()))
        .manage(serial::Ports::default())
        .invoke_handler(tauri::generate_handler![
            pick_save,
            pick_open,
            save_bytes,
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
            serial::serial_list,
            serial::serial_open,
            serial::serial_write,
            serial::serial_reset,
            serial::serial_close
        ])
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Jollof Studio");
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
        assert!(ok(&["core", "update-index", "--additional-urls", CORE_URLS[0]]));
        assert!(ok(&["core", "install", "arduino:avr"]));
        assert!(ok(&["lib", "install", "DHT sensor library", "Adafruit Unified Sensor"]));
        assert!(ok(&["compile", "--fqbn", "arduino:avr:uno", &d]));
        assert!(ok(&["compile", "--fqbn", "arduino:avr:uno", "--output-dir", &b, &d]));
        assert!(ok(&["core", "list", "--format", "json"]));
        assert!(ok(&["upload", "-p", "/dev/cu.usbmodem1101", "--fqbn", "esp32:esp32:esp32", &d]));
        assert!(ok(&["upload", "-p", "COM3", "--fqbn", "arduino:avr:nano", &d]));
        // Refusés : autres commandes, autres dossiers, options cachées, dépôts arbitraires.
        assert!(!ok(&["config", "set", "library.enable_unsafe_install", "true"]));
        assert!(!ok(&["lib", "install", "--git-url", "https://evil.example/x.git"]));
        assert!(!ok(&["lib", "install", "--zip-path", "/tmp/x.zip"]));
        assert!(!ok(&["compile", "--fqbn", "arduino:avr:uno", "/etc"]));
        assert!(!ok(&["compile", "--fqbn", "arduino:avr:uno", &d, "--build-property", "x"]));
        assert!(!ok(&["compile", "--fqbn", "arduino:avr:uno", "--output-dir", "/tmp", &d]));
        assert!(!ok(&["compile", "--fqbn", "arduino:avr:uno", "--output-dir", &d, &d]));
        assert!(!ok(&["core", "install", "arduino:avr", "--additional-urls", "https://evil.example/index.json"]));
        assert!(!ok(&["upload", "-p", "--config-file=/x", "--fqbn", "arduino:avr:uno", &d]));
        assert!(!ok(&["daemon"]));
        assert!(!ok(&[]));
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
        assert!(!d.join("sous").join("a.json.tmp").exists(), "aucun fichier temporaire ne reste");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn autosave_roundtrip() {
        let d = temp_dir("autosave");
        let f = d.join("autosave.json");
        assert!(autosave_load(&f).unwrap().is_empty(), "pas de sauvegarde : contenu vide");
        let big = format!("{{\"comps\":[],\"glb\":\"{}\"}}", "A".repeat(8 * 1024 * 1024));
        autosave_store(&f, big.as_bytes()).unwrap(); // bien au-delà de la limite du stockage local
        assert_eq!(autosave_load(&f).unwrap(), big.as_bytes());
        assert!(autosave_store(&f, b"{pas du json").is_err());
        assert_eq!(autosave_load(&f).unwrap(), big.as_bytes(), "un contenu refusé ne remplace pas la sauvegarde");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn autosave_bodies() {
        let j = |s: &str| InvokeBody::Json(serde_json::from_str(s).unwrap());
        assert_eq!(&*body_bytes(&InvokeBody::Raw(b"{}".to_vec())).unwrap(), b"{}");
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
}

