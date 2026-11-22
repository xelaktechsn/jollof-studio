// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Rendu vidéo écrit au fil de l'eau : la fenêtre encode les images (WebCodecs, encodeur matériel du système) et
//! envoie le MP4 par morceaux, chacun avec sa position dans le fichier (le multiplexeur revient au début pour
//! l'index « moov »). Le fichier grandit dans le cache de l'application au lieu de la mémoire de la webview : une
//! vidéo 4K de plusieurs minutes ne la fait pas tomber. La fenêtre le lit ensuite par le protocole `asset:`, limité
//! au dossier des rendus, puis « Enregistrer sous » le copie à l'endroit choisi dans la boîte de dialogue.
//!
//! Un seul rendu à la fois ; le précédent est effacé quand le suivant commence. La fenêtre ne donne jamais de chemin
//! d'écriture : seulement des positions et des octets, bornés.

use crate::{blocking, blocking_in_place, can_write, Grants};
use std::fs::{self, File};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

/// Taille la plus grande d'un rendu (64 Gio : 4K 60 i/s en qualité « original » pendant plus d'une heure).
const MAX_SIZE: u64 = 64 << 30;

#[derive(Default)]
pub struct Render(Mutex<Option<Job>>);
struct Job {
    path: PathBuf,
    file: Option<File>,
    len: u64,
}

pub(crate) fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("renders"))
}

/// Efface les rendus restés dans le cache (un seul fichier y vit à la fois, plus le son et les sous-titres du
/// master en cours).
pub(crate) fn clear(dir: &std::path::Path) {
    if let Ok(list) = fs::read_dir(dir) {
        for e in list.flatten() {
            let p = e.path();
            if p.extension()
                .is_some_and(|x| ["mp4", "mov", "part", "wav", "srt"].iter().any(|e| x == *e))
            {
                let _ = fs::remove_file(p);
            }
        }
    }
}

/// Ouvre un nouveau fichier de rendu ; rend son chemin (lu ensuite par le protocole `asset:`).
#[tauri::command]
pub async fn render_begin(app: AppHandle, state: State<'_, Render>) -> Result<String, String> {
    let d = dir(&app)?;
    let mut job = state.0.lock().unwrap_or_else(|e| e.into_inner());
    *job = None;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis())
        .unwrap_or(0);
    let path = d.join(format!("render-{stamp}.mp4"));
    let file = blocking_in_place(|| {
        fs::create_dir_all(&d)?;
        clear(&d);
        File::create(&path)
    })
    .map_err(|e| format!("Fichier de rendu impossible à créer : {e}"))?;
    *job = Some(Job {
        path: path.clone(),
        file: Some(file),
        len: 0,
    });
    Ok(path.to_string_lossy().into_owned())
}

/// Écrit un morceau à la position donnée (en-tête `x-pos`), corps binaire.
#[tauri::command]
pub async fn render_write(state: State<'_, Render>, request: Request<'_>) -> Result<(), String> {
    let pos: u64 = request
        .headers()
        .get("x-pos")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("Position x-pos manquante")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    let end = pos
        .checked_add(bytes.len() as u64)
        .filter(|&e| e <= MAX_SIZE)
        .ok_or("Vidéo trop grande")?;
    let mut job = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let job = job.as_mut().ok_or("Aucun rendu en cours")?;
    let file = job.file.as_mut().ok_or("Rendu déjà terminé")?;
    blocking_in_place(|| {
        file.seek(SeekFrom::Start(pos))?;
        file.write_all(bytes)
    })
    .map_err(|e| format!("Écriture du rendu impossible : {e}"))?;
    job.len = job.len.max(end);
    Ok(())
}

/// Ferme le fichier (vidé sur le disque) ; rend sa taille.
#[tauri::command]
pub async fn render_end(state: State<'_, Render>) -> Result<u64, String> {
    let mut job = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let job = job.as_mut().ok_or("Aucun rendu en cours")?;
    if let Some(f) = job.file.take() {
        blocking_in_place(|| f.sync_data()).map_err(|e| e.to_string())?;
    }
    log::info!("rendu vidéo : {} octets", job.len);
    Ok(job.len)
}

/// Abandon (rendu annulé ou en erreur) : le fichier est effacé.
#[tauri::command]
pub async fn render_discard(state: State<'_, Render>) -> Result<(), String> {
    let job = state.0.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(j) = job {
        drop(j.file);
        let _ = fs::remove_file(&j.path);
    }
    Ok(())
}

/// Copie le dernier rendu terminé vers un chemin choisi dans la boîte « Enregistrer sous ».
#[tauri::command]
pub async fn render_save(
    app: AppHandle,
    grants: State<'_, Mutex<Grants>>,
    state: State<'_, Render>,
    path: String,
) -> Result<u64, String> {
    let dest = PathBuf::from(&path);
    if !can_write(&app, &grants, &dest) {
        return Err("Emplacement non autorisé : choisissez-le dans la boîte de dialogue".into());
    }
    let src = {
        let job = state.0.lock().unwrap_or_else(|e| e.into_inner());
        match job.as_ref() {
            Some(j) if j.file.is_none() => j.path.clone(),
            Some(_) => return Err("Le rendu n'est pas terminé".into()),
            None => return Err("Aucune vidéo à enregistrer".into()),
        }
    };
    // Copie atomique (files.rs) : un disque plein ou un arrêt brutal ne laissent pas une vidéo tronquée à la place
    // de celle qui était là.
    blocking(move || crate::files::copy_atomic(&src, &dest)).await
}

/// Un rendu fait par ffmpeg (master) devient le rendu courant : « Enregistrer sous » le copiera.
pub(crate) fn adopt(state: &Render, path: PathBuf, len: u64) {
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(Job {
        path,
        file: None,
        len,
    });
}

/// Fermeture de l'application : le cache des rendus est vidé.
pub fn cleanup(app: &AppHandle) {
    if let Ok(d) = dir(app) {
        clear(&d);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_render_files_are_cleared() {
        let d = std::env::temp_dir().join(format!("jollof-render-test-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("render-1.mp4"), b"x").unwrap();
        fs::write(d.join("render-2.part"), b"x").unwrap();
        fs::write(d.join("keep.txt"), b"x").unwrap();
        fs::write(d.join("master.mov"), b"x").unwrap();
        fs::write(d.join("aux.wav"), b"x").unwrap();
        clear(&d);
        let left: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec!["keep.txt".to_string()]);
        let _ = fs::remove_dir_all(&d);
    }
}
