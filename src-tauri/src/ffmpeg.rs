// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! ffmpeg à côté de l'application (programme à part, version LGPL : voir scripts/ffmpeg.mjs), lancé par
//! ffmpeg-sidecar. Deux usages :
//!   - master pour le montage : ProRes 422 HQ (Apple, SMPTE RDD 36) ou DNxHR HQ (Avid, SMPTE ST 2019), 4:2:2,
//!     BT.709 plage limitée, son PCM 24 bits, sous-titres mov_text, piste de code temporel, dans un .mov ;
//!   - repli du rendu web quand la webview ne sait pas encoder (Linux) : H.264 (OpenH264) ou AV1 (SVT-AV1) ou VP9,
//!     selon ce que contient le binaire, son AAC, dans un .mp4.
//!
//! La fenêtre envoie les images RVBA brutes une par une (tailles vérifiées) ; ffmpeg convertit en Y′CbCr BT.709 et
//! encode. Le fichier s'écrit dans le cache des rendus et devient le rendu courant (`render_save` le copie).
//! Les seuls fichiers d'entrée possibles sont ceux du cache (son, sous-titres), écrits par `master_aux`.

use crate::render::{self, Render};
use crate::{blocking, blocking_in_place};
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::{FfmpegEvent, LogLevel};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::ChildStdin;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};

const EXE: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};

/// Chemin de ffmpeg : à côté de l'exécutable (application installée), sinon, en développement,
/// src-tauri/binaries/ffmpeg-<cible>, la variable JOLLOF_FFMPEG ou le PATH.
fn locate() -> Option<PathBuf> {
    if let Some(p) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join(EXE)))
    {
        if p.is_file() {
            return Some(p);
        }
    }
    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "ffmpeg-{}{}",
                env!("JOLLOF_TARGET"),
                if cfg!(windows) { ".exe" } else { "" }
            ));
        if dev.is_file() {
            return Some(dev);
        }
        if let Some(p) = std::env::var_os("JOLLOF_FFMPEG").map(PathBuf::from) {
            return Some(p);
        }
        return Some(PathBuf::from(EXE));
    }
    None
}

#[derive(Serialize, Clone)]
pub struct Info {
    version: String,
    lgpl: bool,
    /// Encodeurs utiles présents : prores_ks, dnxhd, libopenh264, libsvtav1, libvpx-vp9, aac, mov_text…
    encoders: Vec<String>,
}
static INFO: OnceLock<Option<Info>> = OnceLock::new();
const WANTED: [&str; 10] = [
    "prores_ks",
    "dnxhd",
    "libopenh264",
    "libsvtav1",
    "libaom-av1",
    "libvpx-vp9",
    "mpeg4",
    "aac",
    "pcm_s24le",
    "mov_text",
];

fn output(args: &[&str]) -> Option<String> {
    let p = locate()?;
    let mut c = std::process::Command::new(p);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // pas de console
    }
    let o = c.output().ok()?;
    o.status
        .success()
        .then(|| String::from_utf8_lossy(&o.stdout).into_owned())
}
fn probe() -> Option<Info> {
    let version = output(&["-hide_banner", "-version"])?;
    let encoders = output(&["-hide_banner", "-encoders"])?;
    let lgpl = !version.contains("--enable-gpl") && !version.contains("--enable-nonfree");
    let have: Vec<String> = WANTED
        .iter()
        .filter(|w| {
            encoders
                .lines()
                .any(|l| l.split_whitespace().nth(1) == Some(**w))
        })
        .map(|w| w.to_string())
        .collect();
    let first = version.lines().next().unwrap_or("").to_string();
    log::info!("ffmpeg : {first} ; {}", have.join(" "));
    Some(Info {
        version: first,
        lgpl,
        encoders: have,
    })
}

/// ffmpeg disponible ? (version, licence, encodeurs). null s'il manque.
#[tauri::command]
pub async fn ffmpeg_info() -> Result<Option<Info>, String> {
    blocking(|| Ok(INFO.get_or_init(probe).clone())).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterOpts {
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
    /// prores | dnxhr | web (repli : H.264, AV1 ou VP9 selon le binaire)
    codec: String,
    audio: bool,
    subs: bool,
    title: String,
    /// ISO 639-2 (fra, eng…)
    lang: String,
}

struct Job {
    child: ffmpeg_sidecar::child::FfmpegChild,
    stdin: Option<ChildStdin>,
    out: PathBuf,
    frame: usize,
    log: Arc<Mutex<Vec<String>>>,
    reader: Option<std::thread::JoinHandle<()>>,
}
#[derive(Default)]
pub struct Ffmpeg(Mutex<Option<Job>>);
impl Ffmpeg {
    pub fn kill(&self) {
        if let Some(mut j) = self.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = j.child.kill();
        }
    }
}

fn clean_meta(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect()
}

/// Arguments de ffmpeg pour un master ou un repli web. Rend (arguments, extension).
fn args_for(
    o: &MasterOpts,
    have: &[String],
    dir: &std::path::Path,
) -> Result<(Vec<String>, &'static str), String> {
    let mut a: Vec<String> = vec![];
    let s = |v: &str| v.to_string();
    a.extend(["-hide_banner", "-loglevel", "warning", "-stats", "-nostdin"].map(s));
    // Images RVBA brutes sur l'entrée standard, au rythme exact (fraction).
    a.extend(["-f", "rawvideo", "-pix_fmt", "rgba", "-s"].map(s));
    a.push(format!("{}x{}", o.width, o.height));
    a.push(s("-framerate"));
    a.push(format!("{}/{}", o.fps_num, o.fps_den));
    a.extend(["-color_range", "pc", "-i", "pipe:0"].map(s));
    let mut idx = 1;
    let audio = o.audio.then(|| {
        let i = idx;
        idx += 1;
        i
    });
    if audio.is_some() {
        a.push(s("-i"));
        a.push(dir.join("aux.wav").to_string_lossy().into_owned());
    }
    let subs = o.subs.then_some(idx);
    if subs.is_some() {
        a.push(s("-i"));
        a.push(dir.join("aux.srt").to_string_lossy().into_owned());
    }
    a.extend(["-map", "0:v"].map(s));
    if let Some(i) = audio {
        a.push(s("-map"));
        a.push(format!("{i}:a"));
    }
    if let Some(i) = subs {
        a.push(s("-map"));
        a.push(format!("{i}:s"));
    }
    let has = |e: &str| have.iter().any(|x| x == e);
    let (pix, ext) = match o.codec.as_str() {
        "prores" => {
            if !has("prores_ks") {
                return Err("ProRes indisponible dans ce ffmpeg".into());
            }
            a.extend(["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0"].map(s));
            ("yuv422p10le", "mov")
        }
        "dnxhr" => {
            if !has("dnxhd") {
                return Err("DNxHR indisponible dans ce ffmpeg".into());
            }
            a.extend(["-c:v", "dnxhd", "-profile:v", "dnxhr_hq"].map(s));
            ("yuv422p", "mov")
        }
        "web" => {
            let bitrate = format!(
                "{}k",
                (o.width as u64 * o.height as u64 * 8 / 2_073_600).max(4) * 1000
            );
            if has("libopenh264") {
                a.extend(
                    [
                        "-c:v",
                        "libopenh264",
                        "-profile:v",
                        "high",
                        "-b:v",
                        &bitrate,
                    ]
                    .map(s),
                );
            } else if has("libsvtav1") {
                a.extend(["-c:v", "libsvtav1", "-preset", "8", "-crf", "32"].map(s));
            } else if has("libvpx-vp9") {
                a.extend(
                    [
                        "-c:v",
                        "libvpx-vp9",
                        "-b:v",
                        &bitrate,
                        "-deadline",
                        "good",
                        "-cpu-used",
                        "4",
                        "-row-mt",
                        "1",
                    ]
                    .map(s),
                );
            } else if has("mpeg4") {
                a.extend(["-c:v", "mpeg4", "-q:v", "3"].map(s));
            } else {
                return Err("Aucun encodeur vidéo dans ce ffmpeg".into());
            }
            a.push(s("-g"));
            a.push(
                ((o.fps_num as f64 / o.fps_den as f64).round() as u32)
                    .max(1)
                    .to_string(),
            );
            ("yuv420p", "mp4")
        }
        _ => return Err("Format inconnu".into()),
    };
    // RVB (sRGB) → Y′CbCr BT.709 plage limitée, sous-échantillonnage soigné ; étiquettes de couleur dans le flux.
    a.push(s("-vf"));
    a.push(format!(
        "scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format={pix},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
    ));
    a.extend(
        [
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
        ]
        .map(s),
    );
    if audio.is_some() {
        if ext == "mov" {
            a.extend(["-c:a", "pcm_s24le"].map(s));
        } else {
            a.extend(["-c:a", "aac", "-b:a", "256k"].map(s));
        }
        a.push(s("-metadata:s:a:0"));
        a.push(format!("language={}", o.lang));
    }
    if subs.is_some() {
        a.extend(["-c:s", "mov_text"].map(s));
        a.push(s("-metadata:s:s:0"));
        a.push(format!("language={}", o.lang));
    }
    if ext == "mov" {
        a.extend(["-timecode", "00:00:00:00"].map(s)); // piste de code temporel SMPTE, attendue au montage
    }
    a.push(s("-metadata"));
    a.push(format!("title={}", clean_meta(&o.title, 120)));
    a.extend(
        [
            "-metadata",
            "comment=Jollof Studio",
            "-movflags",
            "+faststart",
            "-shortest",
            "-y",
        ]
        .map(s),
    );
    Ok((a, ext))
}

/// Écrit le son (WAV) ou les sous-titres (SRT) du prochain master dans le cache. En-tête x-kind : wav | srt.
#[tauri::command]
pub async fn master_aux(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let kind = request
        .headers()
        .get("x-kind")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let name = match kind {
        "wav" => "aux.wav",
        "srt" => "aux.srt",
        _ => return Err("Type de fichier refusé".into()),
    };
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    if bytes.len() as u64 > 4 << 30 {
        return Err("Fichier trop grand".into());
    }
    let d = render::dir(&app)?;
    blocking_in_place(|| {
        std::fs::create_dir_all(&d)?;
        std::fs::write(d.join(name), bytes)
    })
    .map_err(|e| e.to_string())
}

/// Lance ffmpeg pour un master (ou un repli web). Rend l'extension du fichier produit.
#[tauri::command]
pub async fn master_begin(
    app: AppHandle,
    state: State<'_, Ffmpeg>,
    opts: MasterOpts,
) -> Result<String, String> {
    let ok_size = (16..=8192).contains(&opts.width)
        && (16..=8192).contains(&opts.height)
        && opts.width.is_multiple_of(2)
        && opts.height.is_multiple_of(2);
    if !ok_size
        || !(1..=240_000).contains(&opts.fps_num)
        || !(1..=1001).contains(&opts.fps_den)
        || !opts.lang.chars().all(|c| c.is_ascii_lowercase())
        || opts.lang.len() != 3
    {
        return Err("Réglages refusés".into());
    }
    let info = blocking(|| Ok(INFO.get_or_init(probe).clone()))
        .await?
        .ok_or("ffmpeg introuvable")?;
    let exe = locate().ok_or("ffmpeg introuvable")?;
    state.kill();
    let d = render::dir(&app)?;
    let (args, ext) = args_for(&opts, &info.encoders, &d)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis())
        .unwrap_or(0);
    let out = d.join(format!("master-{stamp}.{ext}"));
    let mut cmd = FfmpegCommand::new_with_path(exe);
    cmd.args(&args).arg(out.to_string_lossy().as_ref());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ffmpeg ne démarre pas : {e}"))?;
    let stdin = child.take_stdin();
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    // Lit tout ce que ffmpeg écrit (sinon il se bloque) ; garde les avertissements et erreurs.
    let events = child.iter().map_err(|e| e.to_string())?;
    let keep = log.clone();
    let reader = std::thread::spawn(move || {
        for e in events {
            let line = match e {
                FfmpegEvent::Log(LogLevel::Error | LogLevel::Fatal | LogLevel::Warning, l)
                | FfmpegEvent::Error(l) => l,
                _ => continue,
            };
            log::warn!("ffmpeg : {line}");
            let mut v = keep.lock().unwrap_or_else(|e| e.into_inner());
            if v.len() < 50 {
                v.push(line);
            }
        }
    });
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(Job {
        child,
        stdin,
        out,
        frame: (opts.width * opts.height * 4) as usize,
        log,
        reader: Some(reader),
    });
    log::info!(
        "master {} {}x{} {}/{}",
        opts.codec,
        opts.width,
        opts.height,
        opts.fps_num,
        opts.fps_den
    );
    Ok(ext.to_string())
}

/// Une image RVBA (largeur × hauteur × 4 octets), dans l'ordre.
#[tauri::command]
pub async fn master_frame(state: State<'_, Ffmpeg>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le corps de la requête doit être binaire".into());
    };
    let mut g = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let job = g.as_mut().ok_or("Aucun master en cours")?;
    if bytes.len() != job.frame {
        return Err("Taille d'image inattendue".into());
    }
    let stdin = job.stdin.as_mut().ok_or("Master déjà terminé")?;
    blocking_in_place(|| stdin.write_all(bytes)).map_err(|e| {
        let last = job
            .log
            .lock()
            .map(|v| v.last().cloned().unwrap_or_default())
            .unwrap_or_default();
        format!("ffmpeg s'est arrêté : {e} {last}")
    })
}

#[derive(Serialize)]
pub struct Done {
    path: String,
    size: u64,
}

/// Fin des images : ffmpeg termine le fichier, qui devient le rendu courant. Rend son chemin (lu par le protocole
/// `asset:`) et sa taille.
#[tauri::command]
pub async fn master_end(
    state: State<'_, Ffmpeg>,
    render_state: State<'_, Render>,
) -> Result<Done, String> {
    let mut job = state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or("Aucun master en cours")?;
    drop(job.stdin.take()); // fin de l'entrée : ffmpeg vide ses tampons et ferme le fichier
    let (status, job) = tokio::task::spawn_blocking(move || {
        let st = job.child.wait();
        if let Some(r) = job.reader.take() {
            let _ = r.join();
        }
        (st, job)
    })
    .await
    .map_err(|e| e.to_string())?;
    let status = status.map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&job.out);
        let log = job.log.lock().map(|v| v.join(" ; ")).unwrap_or_default();
        return Err(format!("ffmpeg a échoué ({status}) : {log}"));
    }
    let len = std::fs::metadata(&job.out)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;
    render::adopt(&render_state, job.out.clone(), len);
    log::info!("master : {len} octets");
    Ok(Done {
        path: job.out.to_string_lossy().into_owned(),
        size: len,
    })
}

/// Abandon : ffmpeg est arrêté, le fichier effacé.
#[tauri::command]
pub async fn master_abort(state: State<'_, Ffmpeg>) -> Result<(), String> {
    let job = state.0.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(mut j) = job {
        drop(j.stdin.take());
        let _ = j.child.kill();
        let _ = j.child.wait();
        let _ = std::fs::remove_file(&j.out);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn opts(codec: &str, audio: bool, subs: bool) -> MasterOpts {
        MasterOpts {
            width: 1920,
            height: 1080,
            fps_num: 30000,
            fps_den: 1001,
            codec: codec.into(),
            audio,
            subs,
            title: "Essai\n".into(),
            lang: "fra".into(),
        }
    }
    #[test]
    fn master_arguments_follow_the_delivery_standards() {
        let have: Vec<String> = WANTED.iter().map(|s| s.to_string()).collect();
        let d = std::path::Path::new("/cache");
        let (a, ext) = args_for(&opts("prores", true, true), &have, d).unwrap();
        let j = a.join(" ");
        assert_eq!(ext, "mov");
        assert!(j.contains("-framerate 30000/1001"));
        assert!(j.contains("-c:v prores_ks -profile:v 3"));
        assert!(j.contains("format=yuv422p10le"));
        assert!(j.contains("out_color_matrix=bt709"));
        assert!(
            j.contains("-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv")
        );
        assert!(j.contains("-map 1:a") && j.contains("-map 2:s"));
        assert!(
            j.contains("-c:a pcm_s24le")
                && j.contains("-c:s mov_text")
                && j.contains("-timecode 00:00:00:00")
        );
        assert!(j.contains("title=Essai") && !j.contains("Essai\n"));
        let (a, ext) = args_for(&opts("dnxhr", false, false), &have, d).unwrap();
        assert_eq!(ext, "mov");
        assert!(a.join(" ").contains("dnxhr_hq") && !a.join(" ").contains("-map 1"));
        let (a, ext) = args_for(&opts("web", true, false), &have, d).unwrap();
        assert_eq!(ext, "mp4");
        assert!(a.join(" ").contains("libopenh264") && a.join(" ").contains("-c:a aac"));
        let only_vp9 = vec!["libvpx-vp9".to_string()];
        assert!(args_for(&opts("web", false, false), &only_vp9, d)
            .unwrap()
            .0
            .join(" ")
            .contains("libvpx-vp9"));
        assert!(args_for(&opts("prores", false, false), &only_vp9, d).is_err());
        assert!(args_for(&opts("x", false, false), &have, d).is_err());
    }
}
