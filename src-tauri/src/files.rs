// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Gros fichiers choisis par l'utilisateur : écriture par morceaux, atomique, et lecture par morceaux.
//!
//! Un projet avec des fonds de plan importés (data.blobs) ou un export DXF pèse vite des dizaines, voire des
//! centaines de Mo : ni un seul appel (copie complète en mémoire des deux côtés), ni une chaîne JSON. La fenêtre
//! envoie donc le fichier par morceaux bornés, dans l'ordre ; ils s'écrivent dans un fichier temporaire caché du
//! même dossier, vidé sur le disque puis renommé sur la cible à la fin (`file_write_commit`). Un arrêt brutal,
//! un disque plein ou une annulation laissent l'ancien fichier intact, jamais un fichier tronqué. Pas de copie
//! « .bak » : l'application n'en fait nulle part, le renommage atomique suffit à protéger l'ancienne version.
//!
//! Mêmes règles que le reste (lib.rs, « Fichiers choisis par l'utilisateur ») : seuls les chemins choisis dans les
//! boîtes de dialogue (ou reçus du système, double-clic sur un .jollof) sont lus ou écrits.

use crate::{blocking, blocking_in_place, can_read, can_write, Grants};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};

/// Fichier le plus gros écrit (64 Gio, comme les rendus vidéo).
const MAX_SIZE: u64 = 64 << 30;
/// Morceau de lecture le plus gros rendu à la fenêtre.
const MAX_CHUNK: u32 = 16 << 20;
/// Écritures ouvertes en même temps au plus (une écriture abandonnée par la fenêtre ne s'accumule pas).
const MAX_OPEN: usize = 8;

/// Message en français pour une erreur du système de fichiers.
pub(crate) fn io_msg(e: &io::Error) -> String {
    use io::ErrorKind as K;
    match e.kind() {
        K::PermissionDenied => {
            format!("Accès refusé par le système : choisissez un autre dossier ({e})")
        }
        K::StorageFull => "Disque plein : libérez de la place puis réessayez".into(),
        K::ReadOnlyFilesystem => {
            "Ce disque est en lecture seule : choisissez un autre emplacement".into()
        }
        K::NotFound => format!("Dossier ou fichier introuvable ({e})"),
        K::FileTooLarge => "Fichier trop gros pour ce disque".into(),
        _ => format!("Écriture impossible : {e}"),
    }
}

/// Fichier temporaire caché à côté de la cible (même dossier, donc même disque : le renommage est atomique).
fn tmp_path(target: &Path, id: u32) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fichier".into());
    let short: String = name.chars().take(80).collect();
    target.with_file_name(format!(".{short}.{}-{id}.part", std::process::id()))
}

struct Write1 {
    target: PathBuf,
    tmp: PathBuf,
    file: Option<File>,
    len: u64,
}
impl Write1 {
    fn begin(target: &Path, id: u32) -> Result<Write1, String> {
        if target.is_dir() {
            return Err("Cet emplacement est un dossier".into());
        }
        let tmp = tmp_path(target, id);
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| io_msg(&e))?;
        Ok(Write1 {
            target: target.to_path_buf(),
            tmp,
            file: Some(file),
            len: 0,
        })
    }
    /// Morceau suivant : sa position doit suivre exactement le précédent (morceau perdu ou en double : refusé).
    fn append(&mut self, pos: u64, bytes: &[u8]) -> Result<(), String> {
        if pos != self.len {
            return Err(format!(
                "Morceau hors d'ordre ({pos} au lieu de {}) : enregistrement interrompu",
                self.len
            ));
        }
        let end = pos
            .checked_add(bytes.len() as u64)
            .filter(|&e| e <= MAX_SIZE)
            .ok_or("Fichier trop gros")?;
        let f = self.file.as_mut().ok_or("Enregistrement déjà terminé")?;
        f.write_all(bytes).map_err(|e| io_msg(&e))?;
        self.len = end;
        Ok(())
    }
    /// Taille vérifiée, données vidées sur le disque, renommage sur la cible (puis le dossier, sous Unix).
    fn commit(mut self, size: u64) -> Result<u64, String> {
        if size != self.len {
            let _ = fs::remove_file(&self.tmp);
            return Err(format!(
                "Enregistrement incomplet ({} octets reçus sur {size})",
                self.len
            ));
        }
        let f = self.file.take().ok_or("Enregistrement déjà terminé")?;
        let res = f.sync_all().and_then(|_| {
            drop(f);
            fs::rename(&self.tmp, &self.target)
        });
        if let Err(e) = res {
            let _ = fs::remove_file(&self.tmp);
            return Err(io_msg(&e));
        }
        #[cfg(unix)]
        if let Some(dir) = self.target.parent() {
            if let Ok(d) = File::open(dir) {
                let _ = d.sync_all();
            }
        }
        Ok(self.len)
    }
    fn abort(mut self) {
        drop(self.file.take());
        let _ = fs::remove_file(&self.tmp);
    }
}

/// Copie atomique d'un fichier de l'application (DWG converti…) vers une cible déjà autorisée : même écriture que
/// les enregistrements (temporaire du même dossier, vidé sur le disque, renommé). Rend la taille copiée.
pub(crate) fn copy_atomic(src: &Path, target: &Path) -> Result<u64, String> {
    static NEXT: AtomicU32 = AtomicU32::new(1 << 30);
    let mut r = File::open(src).map_err(|e| format!("Lecture impossible : {e}"))?;
    let mut w = Write1::begin(target, NEXT.fetch_add(1, Ordering::SeqCst))?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = match r.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                w.abort();
                return Err(format!("Lecture impossible : {e}"));
            }
        };
        if let Err(e) = w.append(w.len, &buf[..n]) {
            w.abort();
            return Err(e);
        }
    }
    let size = w.len;
    w.commit(size)
}

#[derive(Default)]
pub struct Writes {
    open: Mutex<HashMap<u32, Write1>>,
    next: AtomicU32,
}
impl Writes {
    /// Fermeture de l'application : les écritures inachevées sont abandonnées (fichiers temporaires effacés).
    pub fn abort_all(&self) {
        let all: Vec<Write1> = self
            .open
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
            .map(|(_, w)| w)
            .collect();
        for w in all {
            w.abort();
        }
    }
}

/// Commence l'écriture d'un fichier choisi dans la boîte « Enregistrer sous » ; rend le numéro de l'écriture.
#[tauri::command]
pub async fn file_write_begin(
    app: AppHandle,
    grants: State<'_, Mutex<Grants>>,
    state: State<'_, Writes>,
    path: String,
) -> Result<u32, String> {
    let target = PathBuf::from(&path);
    if !can_write(&app, &grants, &target) {
        return Err("Emplacement non autorisé : choisissez-le dans la boîte de dialogue".into());
    }
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let w = blocking(move || Write1::begin(&target, id)).await?;
    let mut open = state.open.lock().unwrap_or_else(|e| e.into_inner());
    while open.len() >= MAX_OPEN {
        let Some(&old) = open.keys().min() else { break };
        if let Some(o) = open.remove(&old) {
            o.abort();
        }
    }
    open.insert(id, w);
    Ok(id)
}

/// Morceau suivant (corps binaire ; numéro dans `x-id`, position dans `x-pos`).
#[tauri::command]
pub async fn file_write_chunk(
    state: State<'_, Writes>,
    request: Request<'_>,
) -> Result<(), String> {
    let h = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
    };
    let id = h("x-id").ok_or("Numéro x-id manquant")? as u32;
    let pos = h("x-pos").ok_or("Position x-pos manquante")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    let mut open = state.open.lock().unwrap_or_else(|e| e.into_inner());
    let w = open
        .get_mut(&id)
        .ok_or("Enregistrement inconnu ou abandonné")?;
    let r = blocking_in_place(|| w.append(pos, bytes));
    if r.is_err() {
        if let Some(w) = open.remove(&id) {
            w.abort();
        }
    }
    r
}

/// Fin de l'écriture : taille attendue vérifiée, puis le fichier remplace la cible d'un coup. Rend la taille.
#[tauri::command]
pub async fn file_write_commit(
    state: State<'_, Writes>,
    id: u32,
    size: u64,
) -> Result<u64, String> {
    let w = state
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id)
        .ok_or("Enregistrement inconnu ou abandonné")?;
    let target = w.target.clone();
    let n = blocking(move || w.commit(size)).await?;
    log::info!("fichier enregistré : {} ({n} octets)", target.display());
    Ok(n)
}

/// Abandon (erreur ou annulation côté fenêtre) : le fichier temporaire est effacé, la cible reste telle quelle.
#[tauri::command]
pub async fn file_write_abort(state: State<'_, Writes>, id: u32) -> Result<(), String> {
    let w = state
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    if let Some(w) = w {
        blocking(move || {
            w.abort();
            Ok(())
        })
        .await?;
    }
    Ok(())
}

fn read_range(p: &Path, offset: u64, len: u32) -> Result<Vec<u8>, String> {
    let n = len.min(MAX_CHUNK) as u64;
    let mut f = File::open(p).map_err(|e| format!("Lecture impossible : {e}"))?;
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Lecture impossible : {e}"))?;
    let mut buf = Vec::with_capacity(n as usize);
    f.take(n)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Lecture impossible : {e}"))?;
    Ok(buf)
}

/// Taille d'un fichier ouvert par la boîte de dialogue (ou reçu du système).
#[tauri::command]
pub async fn file_size(
    app: AppHandle,
    grants: State<'_, Mutex<Grants>>,
    path: String,
) -> Result<u64, String> {
    let p = PathBuf::from(&path);
    if !can_read(&app, &grants, &p) {
        return Err("Fichier non autorisé : ouvrez-le avec la boîte de dialogue".into());
    }
    blocking(move || {
        fs::metadata(&p)
            .map(|m| m.len())
            .map_err(|e| format!("Lecture impossible : {e}"))
    })
    .await
}

/// Morceau d'un fichier ouvert : `len` octets (16 Mo au plus) à partir de `offset` ; vide à la fin.
#[tauri::command]
pub async fn file_read_chunk(
    app: AppHandle,
    grants: State<'_, Mutex<Grants>>,
    path: String,
    offset: u64,
    len: u32,
) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !can_read(&app, &grants, &p) {
        return Err("Fichier non autorisé : ouvrez-le avec la boîte de dialogue".into());
    }
    Ok(Response::new(
        blocking(move || read_range(&p, offset, len)).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("jollof-files-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn left(d: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn chunked_write_then_chunked_read_gives_the_same_bytes() {
        let d = tmp("roundtrip");
        let target = d.join("Réseau site (v2).jollof");
        // Projet avec un fond de plan : ~20 Mo de base64, envoyé par morceaux de 8 Mo.
        let mut data = b"{\"comps\":[],\"settings\":{\"modules\":{\"net\":{\"blobs\":{\"u1\":\"data:application/octet-stream;base64,".to_vec();
        data.extend(
            (0..20_000_000u32).map(|i| b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"[(i % 32) as usize]),
        );
        data.extend_from_slice("\"}}}},\"name\":\"é\"}".as_bytes());
        let mut w = Write1::begin(&target, 1).unwrap();
        for (i, c) in data.chunks(8 << 20).enumerate() {
            w.append((i as u64) * (8 << 20), c).unwrap();
        }
        assert!(!target.exists(), "la cible n'apparaît qu'à la fin");
        assert_eq!(w.commit(data.len() as u64).unwrap(), data.len() as u64);
        assert_eq!(
            left(&d),
            vec!["Réseau site (v2).jollof".to_string()],
            "aucun fichier temporaire ne reste"
        );
        let mut back = vec![];
        loop {
            let part = read_range(&target, back.len() as u64, 16 << 20).unwrap();
            if part.is_empty() {
                break;
            }
            assert!(part.len() <= 16 << 20);
            back.extend(part);
        }
        assert_eq!(back, data);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn overwrite_is_atomic_and_failures_keep_the_old_file() {
        let d = tmp("atomic");
        let target = d.join("p.jollof");
        fs::write(&target, b"ancien").unwrap();
        // Abandon au milieu : l'ancien fichier reste, le temporaire disparaît.
        let mut w = Write1::begin(&target, 1).unwrap();
        w.append(0, b"nouv").unwrap();
        w.abort();
        assert_eq!(fs::read(&target).unwrap(), b"ancien");
        assert_eq!(left(&d), vec!["p.jollof".to_string()]);
        // Morceau hors d'ordre : refusé.
        let mut w = Write1::begin(&target, 2).unwrap();
        w.append(0, b"ab").unwrap();
        assert!(w.append(5, b"cd").is_err());
        assert!(w.append(0, b"ab").is_err(), "morceau en double refusé");
        // Taille annoncée différente : rien n'est remplacé.
        assert!(w.commit(10).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"ancien");
        assert_eq!(left(&d), vec!["p.jollof".to_string()]);
        // Écriture complète : remplace d'un coup.
        let mut w = Write1::begin(&target, 3).unwrap();
        w.append(0, b"nouveau").unwrap();
        w.commit(7).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"nouveau");
        // Un dossier n'est pas une cible.
        assert!(Write1::begin(&d, 4).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn temp_file_is_hidden_next_to_the_target() {
        let t = tmp_path(Path::new("/a/b/plan.dxf"), 7);
        assert_eq!(t.parent(), Some(Path::new("/a/b")));
        let n = t.file_name().unwrap().to_string_lossy().into_owned();
        assert!(n.starts_with(".plan.dxf.") && n.ends_with("-7.part"));
    }

    #[test]
    fn io_errors_read_in_french() {
        assert!(io_msg(&io::Error::from(io::ErrorKind::StorageFull)).starts_with("Disque plein"));
        assert!(
            io_msg(&io::Error::from(io::ErrorKind::PermissionDenied)).starts_with("Accès refusé")
        );
        assert!(io_msg(&io::Error::other("x")).starts_with("Écriture impossible"));
    }
}
