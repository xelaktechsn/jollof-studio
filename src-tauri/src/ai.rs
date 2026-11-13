// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Pont vers les assistants IA (protocole MCP, Model Context Protocol). Désactivé par défaut ; activé dans
//! l'application (bouton « IA »), il laisse un assistant (Claude, Cursor, VS Code…) piloter le montage.
//!
//! Chemin d'un message : l'assistant lance `jollof-studio --mcp` (relais stdio, configuré en un clic par
//! `ai_connect`) ; le relais lit la clé et le port dans ai-bridge.json (dossier de données de l'application,
//! lisible par l'utilisateur seul) et poste chaque message JSON-RPC sur http://127.0.0.1:<port>/mcp ; Rust le
//! remet à la fenêtre (src/ai/mcp.js), qui exécute l'outil et rend la réponse. La clé n'est jamais écrite dans
//! la configuration d'un autre logiciel.
//!
//! Sécurité, en couches :
//!   - écoute sur 127.0.0.1 seulement, et seulement quand l'utilisateur l'a activé ;
//!   - clé de 256 bits exigée à chaque requête (comparaison en temps constant) ;
//!   - en-têtes Host et Origin vérifiés : une page web ne peut pas piloter l'application (rebinding DNS, CSRF) ;
//!   - sessions : `initialize` ouvre une session (identifiant aléatoire, en-tête Mcp-Session-Id) que la fenêtre
//!     n'accepte qu'avec l'accord de l'utilisateur (une fois, ou toujours pour cet assistant) ; toute autre requête
//!     doit porter une session acceptée ;
//!   - corps limité à 4 Mo, en-têtes à 16 Ko, une requête par connexion, délai de 120 s ;
//!   - configuration des assistants : chemins fixes (aucun chemin venu de la fenêtre), seule l'entrée
//!     « jollof-studio » est touchée, copie de sauvegarde avant la première modification, écriture atomique.

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::hash_map::RandomState;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{ipc::Channel, AppHandle, Manager, State};

const FILE: &str = "ai-bridge.json";
/// Éditions de l'application (tauri.conf.json, tauri.pro.conf.json) : chacune a son dossier de données.
const IDENTIFIERS: [&str; 2] = ["sn.jollof.studio", "sn.jollof.studio.pro"];
const SERVER_KEY: &str = "jollof-studio";
const PORT0: u16 = 47821;
const MAX_BODY: usize = 4 << 20;
const MAX_HEAD: usize = 16 << 10;
/// Une simulation, une compilation ou l'accord de l'utilisateur peuvent prendre du temps : au-delà, abandon.
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct Bridge(Arc<Shared>);
#[derive(Default)]
struct Shared {
    inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
    channel: Option<Channel<Value>>,
    pending: HashMap<u64, mpsc::Sender<String>>,
    next: u64,
    stop: Option<Arc<AtomicBool>>,
    port: u16,
    token: String,
    /// Sessions ouvertes par un initialize accepté.
    sessions: HashSet<String>,
}

/// Ce que l'interface affiche.
#[derive(Serialize)]
pub struct Info {
    enabled: bool,
    port: u16,
    exe: String,
}

#[derive(serde::Deserialize, Serialize, Default)]
struct Config {
    port: u16,
    token: String,
}

/* ---------- Dossiers et fichier de la clé ---------- */

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}
/// Dossier des réglages des applications : ~/Library/Application Support, %APPDATA%, ~/.config.
fn app_support() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        home().map(|h| h.join("Library").join("Application Support"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".config")))
    }
}
/// Dossier de données d'une édition, calculé sans Tauri (mode `--mcp`) : le même que son app_data_dir().
fn data_dir(identifier: &str) -> Option<PathBuf> {
    let base = if cfg!(any(target_os = "macos", windows)) {
        app_support()
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".local").join("share")))
    };
    base.map(|b| b.join(identifier))
}
/// Identifiant d'édition donné au relais (`--mcp sn.jollof.studio.pro`) : lettres, chiffres, points et tirets.
fn valid_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('.')
        && !s.contains("..")
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE))
}
fn read_config(path: &Path) -> Option<Config> {
    serde_json::from_str::<Config>(&std::fs::read_to_string(path).ok()?)
        .ok()
        .filter(|c| c.token.len() >= 32)
}
/// Écriture atomique (fichier temporaire puis renommage) ; private : lisible par l'utilisateur seul.
fn write_atomic(path: &Path, text: &str, private: bool) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("jollof-tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if private {
            0o600
        } else {
            std::fs::metadata(path)
                .map(|m| m.permissions().mode() & 0o777)
                .unwrap_or(0o644)
        };
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = private;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}
fn write_config(path: &Path, c: &Config) -> Result<(), String> {
    write_atomic(
        path,
        &serde_json::to_string_pretty(c).map_err(|e| e.to_string())?,
        true,
    )
}
/// Jeton aléatoire : clés aléatoires du système (RandomState), heure et processus, passées par SHA-256.
fn random_hex() -> String {
    let mut h = Sha256::new();
    for i in 0..8u64 {
        let mut s = RandomState::new().build_hasher();
        s.write_u64(i);
        h.update(s.finish().to_le_bytes());
    }
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    h.update(t.to_le_bytes());
    h.update(std::process::id().to_le_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
/// Comparaison en temps constant (la clé ne se devine pas caractère par caractère).
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}
fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/* ---------- Commandes de la fenêtre ---------- */

/// Active (ou coupe) le pont. on_request reçoit chaque message : { rid, sid, msg } ; la fenêtre répond par ai_reply.
#[tauri::command]
pub fn ai_bridge(
    app: AppHandle,
    bridge: State<'_, Bridge>,
    enabled: bool,
    on_request: Channel<Value>,
) -> Result<Info, String> {
    let shared = bridge.0.clone();
    let mut g = shared.inner.lock().map_err(|e| e.to_string())?;
    if !enabled {
        if let Some(stop) = g.stop.take() {
            stop.store(true, Ordering::SeqCst);
            let _ = TcpStream::connect(("127.0.0.1", g.port)); // débloque accept()
        }
        g.channel = None;
        g.sessions.clear();
        for (_, tx) in g.pending.drain() {
            let _ = tx.send(String::new());
        }
        return Ok(Info {
            enabled: false,
            port: g.port,
            exe: exe_path(),
        });
    }
    g.channel = Some(on_request);
    if g.stop.is_none() {
        let path = config_path(&app)?;
        let mut cfg = read_config(&path).unwrap_or_default();
        if cfg.token.len() < 32 {
            cfg.token = random_hex();
        }
        let first = if cfg.port >= 1024 { cfg.port } else { PORT0 };
        let found = std::iter::once(first)
            .chain(PORT0..PORT0 + 20)
            .find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok().map(|l| (p, l)));
        let (port, listener) =
            found.ok_or_else(|| "aucun port libre pour le pont IA".to_string())?;
        cfg.port = port;
        write_config(&path, &cfg)?;
        let stop = Arc::new(AtomicBool::new(false));
        g.stop = Some(stop.clone());
        g.port = port;
        g.token = cfg.token;
        let sh = shared.clone();
        std::thread::spawn(move || serve(listener, sh, stop));
    }
    Ok(Info {
        enabled: true,
        port: g.port,
        exe: exe_path(),
    })
}

/// Réponse de la fenêtre à la requête rid (texte JSON).
#[tauri::command]
pub fn ai_reply(bridge: State<'_, Bridge>, rid: u64, body: String) {
    if let Ok(mut g) = bridge.0.inner.lock() {
        if let Some(tx) = g.pending.remove(&rid) {
            let _ = tx.send(body);
        }
    }
}

/// Nouvelle clé : les sessions ouvertes sont fermées ; les relais lisent la nouvelle clé d'eux-mêmes.
#[tauri::command]
pub fn ai_new_token(app: AppHandle, bridge: State<'_, Bridge>) -> Result<(), String> {
    let path = config_path(&app)?;
    let mut g = bridge.0.inner.lock().map_err(|e| e.to_string())?;
    let mut cfg = read_config(&path).unwrap_or_default();
    cfg.token = random_hex();
    if cfg.port < 1024 {
        cfg.port = if g.port >= 1024 { g.port } else { PORT0 };
    }
    write_config(&path, &cfg)?;
    g.token = cfg.token;
    g.sessions.clear();
    Ok(())
}

/// Ferme une session (assistant révoqué par l'utilisateur).
#[tauri::command]
pub fn ai_end_session(bridge: State<'_, Bridge>, sid: String) {
    if let Ok(mut g) = bridge.0.inner.lock() {
        g.sessions.remove(&sid);
    }
}

/// Fenêtre au premier plan : l'utilisateur doit voir la demande d'accord d'un assistant.
#[tauri::command]
pub fn ai_focus(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/* ---------- Serveur HTTP local ---------- */

fn serve(listener: TcpListener, shared: Arc<Shared>, stop: Arc<AtomicBool>) {
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        if let Ok(s) = stream {
            let sh = shared.clone();
            std::thread::spawn(move || {
                let _ = handle(s, &sh);
            });
        }
    }
}

/// Requête HTTP lue : méthode, chemin, en-têtes (noms en minuscules), corps.
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, (u16, &'static str)> {
    let mut r = BufReader::new(stream.try_clone().map_err(|_| (500, "socket"))?);
    let mut head = 0usize;
    let mut line = String::new();
    r.read_line(&mut line)
        .map_err(|_| (400, "requête illisible"))?;
    head += line.len();
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        let n = r
            .read_line(&mut h)
            .map_err(|_| (400, "en-têtes illisibles"))?;
        head += n;
        if head > MAX_HEAD {
            return Err((431, "en-têtes trop longs"));
        }
        let h = h.trim_end();
        if n == 0 || h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let mut body = Vec::new();
    if method == "POST" {
        if headers.contains_key("transfer-encoding") {
            return Err((411, "Content-Length attendu"));
        }
        let len: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .ok_or((411, "Content-Length attendu"))?;
        if len > MAX_BODY {
            return Err((413, "corps trop gros"));
        }
        body.resize(len, 0);
        r.read_exact(&mut body)
            .map_err(|_| (400, "corps incomplet"))?;
    }
    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

fn respond_with(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
    extra: &[(&str, &str)],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    if !body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if status == 405 {
        head.push_str("Allow: POST, DELETE\r\n");
    }
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    write!(
        stream,
        "{head}Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()
}
fn respond(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    respond_with(stream, status, body, &[])
}
fn rpc_error(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

/// Décision sur une requête déjà lue, sans la fenêtre : Some((statut, corps)) si elle s'arrête là.
fn screen(req: &Request, port: u16, token: &str) -> Option<(u16, String)> {
    let host = req.headers.get("host").map(String::as_str).unwrap_or("");
    let host_ok = [
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
        format!("[::1]:{port}"),
    ]
    .iter()
    .any(|h| h == host);
    if !host_ok {
        return Some((403, rpc_error(&Value::Null, -32600, "Host refusé")));
    }
    // Une page web envoie toujours Origin : seul l'accès local est admis (pas de pilotage depuis un site).
    if let Some(o) = req.headers.get("origin") {
        let local = o == "null"
            || o.starts_with("http://127.0.0.1")
            || o.starts_with("http://localhost")
            || o == "tauri://localhost";
        if !local {
            return Some((403, rpc_error(&Value::Null, -32600, "Origin refusée")));
        }
    }
    if req.path != "/mcp" && req.path != "/mcp/" {
        return Some((
            404,
            rpc_error(&Value::Null, -32600, "chemin inconnu : /mcp attendu"),
        ));
    }
    let auth = req
        .headers
        .get("authorization")
        .map(String::as_str)
        .unwrap_or("");
    let given = auth
        .strip_prefix("Bearer ")
        .or_else(|| auth.strip_prefix("bearer "))
        .unwrap_or("");
    if token.is_empty() || !same(given.trim(), token) {
        return Some((
            401,
            rpc_error(&Value::Null, -32001, "clé manquante ou invalide"),
        ));
    }
    if req.method != "POST" && req.method != "DELETE" {
        return Some((405, String::new()));
    }
    None
}

fn handle(mut stream: TcpStream, shared: &Arc<Shared>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err((code, why)) => {
            return respond(&mut stream, code, &rpc_error(&Value::Null, -32700, why))
        }
    };
    let (port, token) = match shared.inner.lock() {
        Ok(g) => (g.port, g.token.clone()),
        Err(_) => return respond(&mut stream, 503, ""),
    };
    if let Some((code, body)) = screen(&req, port, &token) {
        return respond(&mut stream, code, &body);
    }
    let given_sid = req
        .headers
        .get("mcp-session-id")
        .cloned()
        .unwrap_or_default();
    // DELETE : l'assistant ferme sa session (fin du relais).
    if req.method == "DELETE" {
        if let Ok(mut g) = shared.inner.lock() {
            g.sessions.remove(&given_sid);
        }
        return respond(&mut stream, 200, "");
    }
    let msg: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            return respond(
                &mut stream,
                400,
                &rpc_error(&Value::Null, -32700, "JSON invalide"),
            )
        }
    };
    if !msg.is_object() {
        return respond(
            &mut stream,
            400,
            &rpc_error(&Value::Null, -32600, "un seul message JSON-RPC par requête"),
        );
    }
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let is_request = msg.get("method").is_some() && msg.get("id").is_some();
    let init = msg.get("method").and_then(Value::as_str) == Some("initialize");
    let (tx, rx) = mpsc::channel();
    let (rid, sid) = {
        let mut g = match shared.inner.lock() {
            Ok(g) => g,
            Err(_) => return respond(&mut stream, 503, ""),
        };
        // Hors initialize, seule une session acceptée passe (404 : le client doit se réinitialiser).
        let sid = if init {
            random_hex()[..32].to_string()
        } else {
            given_sid
        };
        if !init && !g.sessions.contains(&sid) {
            return respond(
                &mut stream,
                404,
                &rpc_error(&id, -32004, "session inconnue : réinitialisez la connexion"),
            );
        }
        let Some(ch) = g.channel.clone() else {
            return respond(&mut stream, 503, &rpc_error(&id, -32002, "Jollof Studio : les assistants IA sont désactivés (bouton « IA » de l'application)."));
        };
        g.next += 1;
        let rid = g.next;
        if is_request {
            g.pending.insert(rid, tx);
        }
        if ch
            .send(json!({ "rid": if is_request { rid } else { 0 }, "sid": sid, "msg": msg }))
            .is_err()
        {
            g.pending.remove(&rid);
            g.channel = None;
            return respond(
                &mut stream,
                503,
                &rpc_error(&id, -32002, "fenêtre de Jollof Studio indisponible"),
            );
        }
        (rid, sid)
    };
    if !is_request {
        return respond(&mut stream, 202, "");
    }
    match rx.recv_timeout(TIMEOUT) {
        Ok(body) if !body.is_empty() => {
            // initialize accepté par l'utilisateur : la session est ouverte et son identifiant renvoyé.
            let accepted = init
                && serde_json::from_str::<Value>(&body)
                    .ok()
                    .is_some_and(|v| v.get("result").is_some());
            if accepted {
                if let Ok(mut g) = shared.inner.lock() {
                    g.sessions.insert(sid.clone());
                }
                return respond_with(&mut stream, 200, &body, &[("Mcp-Session-Id", &sid)]);
            }
            respond(&mut stream, 200, &body)
        }
        Ok(_) => respond(&mut stream, 503, &rpc_error(&id, -32002, "pont IA coupé")),
        Err(_) => {
            if let Ok(mut g) = shared.inner.lock() {
                g.pending.remove(&rid);
            }
            respond(
                &mut stream,
                200,
                &rpc_error(&id, -32003, "délai dépassé : Jollof Studio n'a pas répondu"),
            )
        }
    }
}

/* ---------- Mode `--mcp` : relais stdio ⇄ HTTP ---------- */

/// Réponse du pont : statut, corps, session renvoyée (initialize accepté).
struct Reply {
    status: u16,
    body: String,
    sid: Option<String>,
}

const NOT_ENABLED: &str =
    "Jollof Studio : ouvrez l'application et activez les assistants IA (bouton « IA »).";
fn post_to(
    agent: &ureq::Agent,
    cfg_path: &Path,
    line: &str,
    sid: Option<&str>,
) -> Result<Reply, String> {
    let cfg = read_config(cfg_path).ok_or(NOT_ENABLED)?;
    let mut rq = agent
        .post(&format!("http://127.0.0.1:{}/mcp", cfg.port))
        .header("Authorization", &format!("Bearer {}", cfg.token))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");
    if let Some(s) = sid {
        rq = rq.header("Mcp-Session-Id", s);
    }
    let mut res = rq
        .send(line)
        .map_err(|e| format!("connexion impossible : {e}"))?;
    let status = res.status().as_u16();
    let sid = res
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
    Ok(Reply { status, body, sid })
}
/// Où joindre l'application : fichiers de clé candidats (l'édition demandée, sinon chaque édition) ; le premier
/// qui répond est retenu pour la suite (la session lui appartient), et oublié s'il ne répond plus.
struct Target {
    paths: Vec<PathBuf>,
    pinned: Option<usize>,
}
impl Target {
    fn post(
        &mut self,
        agent: &ureq::Agent,
        line: &str,
        sid: Option<&str>,
    ) -> Result<Reply, String> {
        if let Some(i) = self.pinned {
            match post_to(agent, &self.paths[i], line, sid) {
                Ok(r) => return Ok(r),
                Err(_) => self.pinned = None,
            }
        }
        let mut last = Err(NOT_ENABLED.to_string());
        for (i, p) in self.paths.iter().enumerate() {
            if read_config(p).is_none() {
                continue;
            }
            match post_to(agent, p, line, sid) {
                Ok(r) => {
                    self.pinned = Some(i);
                    return Ok(r);
                }
                Err(e) => last = Err(e),
            }
        }
        last
    }
    fn path(&self) -> Option<&Path> {
        self.pinned.map(|i| self.paths[i].as_path())
    }
}

fn close_session(agent: &ureq::Agent, cfg_path: &Path, sid: &str) {
    if let Some(cfg) = read_config(cfg_path) {
        let _ = agent
            .delete(&format!("http://127.0.0.1:{}/mcp", cfg.port))
            .header("Authorization", &format!("Bearer {}", cfg.token))
            .header("Mcp-Session-Id", sid)
            .call();
    }
}

/// Battement du relais : un ping toutes les 45 s garde sa session vivante ; un relais arrêté sans prévenir
/// (assistant quitté) disparaît de la liste des connexions au bout de quelques minutes.
const BEAT: Duration = Duration::from_secs(45);
const PING: &str = r#"{"jsonrpc":"2.0","id":"jollof-heartbeat","method":"ping"}"#;
/// initialize rejoué par le relais lui-même (application redémarrée) : marqué « silencieux », il n'ouvre la
/// session que si l'utilisateur a déjà autorisé cet assistant, sans jamais afficher de demande.
fn silent_init(line: &str) -> String {
    let mut v: Value = serde_json::from_str(line).unwrap_or(Value::Null);
    if let Some(p) = v.get_mut("params").and_then(Value::as_object_mut) {
        if let Some(m) = p
            .entry("_meta")
            .or_insert_with(|| json!({}))
            .as_object_mut()
        {
            m.insert("sn.jollof/silent".into(), json!(true));
        }
    }
    v.to_string()
}
/// État partagé entre la boucle du relais et son battement.
#[derive(Default)]
struct Link {
    sid: Option<String>,
    init: Option<String>,
    path: Option<PathBuf>,
}

/// Relais : une ligne JSON-RPC lue, une ligne écrite pour chaque requête (rien pour une notification). La
/// session ouverte par initialize accompagne les requêtes suivantes ; si l'application a redémarré (session
/// inconnue), le relais refait l'initialisation puis renvoie la requête. launch : lance l'application si elle
/// est fermée au moment de l'initialisation (pont déjà activé une fois). beat : période du battement.
fn relay(
    input: impl BufRead,
    mut out: impl Write,
    target: &mut Target,
    launch: Option<&dyn Fn()>,
    beat: Duration,
) {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT + Duration::from_secs(10)))
        .build()
        .into();
    let link = Arc::new(Mutex::new(Link::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let heart = {
        let (link, stop, agent) = (link.clone(), stop.clone(), agent.clone());
        std::thread::spawn(move || {
            let tick = Duration::from_millis(20).min(beat);
            loop {
                let t0 = Instant::now();
                while t0.elapsed() < beat {
                    if stop.load(Ordering::SeqCst) {
                        return;
                    }
                    std::thread::sleep(tick);
                }
                let (sid, init, path) = match link.lock() {
                    Ok(l) => (l.sid.clone(), l.init.clone(), l.path.clone()),
                    Err(_) => return,
                };
                let (Some(sid), Some(path)) = (sid, path) else {
                    continue;
                };
                let lost = post_to(&agent, &path, PING, Some(&sid)).is_ok_and(|r| r.status == 404);
                if let (true, Some(il)) = (lost, init) {
                    if let Ok(r) = post_to(&agent, &path, &silent_init(&il), None) {
                        if let (Some(ns), Ok(mut l)) = (r.sid, link.lock()) {
                            l.sid = Some(ns);
                        }
                    }
                }
            }
        })
    };
    let sid_now = |link: &Arc<Mutex<Link>>| link.lock().ok().and_then(|l| l.sid.clone());
    let mut launched = false;
    for line in input.lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value = serde_json::from_str(line).unwrap_or(Value::Null);
        let id = msg.get("id").cloned();
        let init = msg.get("method").and_then(Value::as_str) == Some("initialize");
        if init {
            if let Ok(mut l) = link.lock() {
                l.init = Some(line.to_string());
                l.sid = None;
            }
        }
        let mut res = target.post(&agent, line, sid_now(&link).as_deref());
        if init
            && res
                .as_ref()
                .err()
                .is_some_and(|e| e.starts_with("connexion"))
            && !launched
        {
            if let Some(start) = launch {
                launched = true;
                start();
                let t0 = Instant::now();
                while t0.elapsed() < Duration::from_secs(40) {
                    std::thread::sleep(Duration::from_millis(500));
                    res = target.post(&agent, line, None);
                    if res.is_ok() {
                        break;
                    }
                }
            }
        }
        // Session perdue (application redémarrée, clé changée) : nouvelle initialisation, puis la requête.
        if !init && res.as_ref().is_ok_and(|r| r.status == 404) {
            let il = link.lock().ok().and_then(|l| l.init.clone());
            if let Some(il) = il {
                if let Ok(r) = target.post(&agent, &il, None) {
                    if let Some(ns) = r.sid {
                        if let Ok(mut l) = link.lock() {
                            l.sid = Some(ns);
                        }
                        res = target.post(&agent, line, sid_now(&link).as_deref());
                    }
                }
            }
        }
        if let Ok(mut l) = link.lock() {
            l.path = target.path().map(Path::to_path_buf);
        }
        let text = match res {
            Ok(r) => {
                if let (true, Some(ns), Ok(mut l)) = (init, r.sid, link.lock()) {
                    l.sid = Some(ns);
                }
                r.body.trim().to_string()
            }
            Err(e) => id
                .as_ref()
                .map(|id| rpc_error(id, -32000, &e))
                .unwrap_or_default(),
        };
        if !text.is_empty() && id.is_some() {
            let _ = writeln!(out, "{text}");
            let _ = out.flush();
        }
    }
    stop.store(true, Ordering::SeqCst);
    let _ = heart.join();
    if let (Some(s), Some(p)) = (sid_now(&link), target.path()) {
        close_session(&agent, p, &s);
    }
}

/// Mode `--mcp [édition]` : relais de l'entrée et de la sortie standard vers l'application (lancée au besoin).
/// Sans édition (configuration plus ancienne), chaque édition installée est essayée.
pub fn stdio_proxy(identifier: Option<String>) {
    let ids: Vec<String> = match identifier.filter(|s| valid_identifier(s)) {
        Some(id) => vec![id],
        None => IDENTIFIERS.iter().map(|s| s.to_string()).collect(),
    };
    let paths = ids
        .iter()
        .filter_map(|id| data_dir(id))
        .map(|d| d.join(FILE))
        .collect();
    let start = || {
        if let Ok(exe) = std::env::current_exe() {
            let _ = std::process::Command::new(exe).spawn();
        }
    };
    relay(
        std::io::stdin().lock(),
        std::io::stdout(),
        &mut Target {
            paths,
            pinned: None,
        },
        Some(&start),
        BEAT,
    );
}

/* ---------- Assistants configurés en un clic ---------- */

/// Forme de la configuration d'un assistant.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Style {
    /// { "mcpServers": { nom: { command, args } } } : Claude Desktop, Cursor, Windsurf, LM Studio.
    McpServers,
    /// { "servers": { nom: { type: "stdio", command, args } } } : VS Code.
    VsCode,
    /// ~/.claude.json : { "mcpServers": { nom: { type: "stdio", command, args, env } } } : Claude Code.
    ClaudeCode,
}
/// (identifiant, nom, fichier de configuration, dossier qui prouve que l'assistant est installé, forme, redémarrage).
fn clients() -> Vec<(&'static str, &'static str, PathBuf, PathBuf, Style, bool)> {
    let (Some(h), Some(sup)) = (home(), app_support()) else {
        return vec![];
    };
    vec![
        (
            "claude-desktop",
            "Claude Desktop",
            sup.join("Claude").join("claude_desktop_config.json"),
            sup.join("Claude"),
            Style::McpServers,
            true,
        ),
        (
            "claude-code",
            "Claude Code",
            h.join(".claude.json"),
            h.join(".claude"),
            Style::ClaudeCode,
            false,
        ),
        (
            "cursor",
            "Cursor",
            h.join(".cursor").join("mcp.json"),
            h.join(".cursor"),
            Style::McpServers,
            true,
        ),
        (
            "vscode",
            "VS Code",
            sup.join("Code").join("User").join("mcp.json"),
            sup.join("Code").join("User"),
            Style::VsCode,
            false,
        ),
        (
            "windsurf",
            "Windsurf",
            h.join(".codeium").join("windsurf").join("mcp_config.json"),
            h.join(".codeium").join("windsurf"),
            Style::McpServers,
            true,
        ),
        (
            "lmstudio",
            "LM Studio",
            h.join(".lmstudio").join("mcp.json"),
            h.join(".lmstudio"),
            Style::McpServers,
            true,
        ),
    ]
}
fn group(style: Style) -> &'static str {
    if style == Style::VsCode {
        "servers"
    } else {
        "mcpServers"
    }
}
/// Entrée d'un assistant : il lance `<exe> --mcp <édition>` (l'édition dit quel dossier de données lire).
fn entry_for(style: Style, exe: &str, identifier: &str) -> Value {
    let args = json!(["--mcp", identifier]);
    match style {
        Style::McpServers => json!({ "command": exe, "args": args }),
        Style::VsCode => json!({ "type": "stdio", "command": exe, "args": args }),
        Style::ClaudeCode => json!({ "type": "stdio", "command": exe, "args": args, "env": {} }),
    }
}
/// Entrée « jollof-studio » d'un fichier de configuration (None : absente ou fichier illisible).
fn read_entry(file: &Path, style: Style) -> Option<Value> {
    let root: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    root.get(group(style))?.get(SERVER_KEY).cloned()
}
/// Ajoute (Some) ou retire (None) l'entrée « jollof-studio », sans toucher au reste du fichier ; sauvegarde du
/// fichier d'origine avant la première modification.
fn set_entry(file: &Path, style: Style, entry: Option<Value>) -> Result<(), String> {
    let mut root: Value = match std::fs::read_to_string(file) {
        Ok(t) if !t.trim().is_empty() => serde_json::from_str(&t).map_err(|_| {
            format!(
                "{} n'est pas du JSON pur (commentaires ?) : ajoutez l'assistant à la main",
                file.display()
            )
        })?,
        _ => json!({}),
    };
    let Some(obj) = root.as_object_mut() else {
        return Err(format!("{} : objet JSON attendu", file.display()));
    };
    if file.exists() {
        let bak = PathBuf::from(format!("{}.jollof-backup", file.display()));
        if !bak.exists() {
            std::fs::copy(file, &bak).map_err(|e| e.to_string())?;
        }
    }
    let servers = obj.entry(group(style)).or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else {
        return Err(format!(
            "{} : « {} » n'est pas un objet",
            file.display(),
            group(style)
        ));
    };
    match entry {
        Some(e) => {
            servers.insert(SERVER_KEY.to_string(), e);
        }
        None => {
            servers.shift_remove(SERVER_KEY);
        }
    }
    write_atomic(
        file,
        &(serde_json::to_string_pretty(&root).map_err(|e| e.to_string())? + "\n"),
        false,
    )
}

#[derive(Serialize)]
pub struct ClientState {
    id: &'static str,
    name: &'static str,
    installed: bool,
    connected: bool,
    /// Relié à une autre copie ou une autre édition de Jollof Studio (ou configuration ancienne) : à relier de nouveau.
    elsewhere: bool,
    restart: bool,
}
fn client_states(exe: &str, identifier: &str) -> Vec<ClientState> {
    clients()
        .into_iter()
        .map(|(id, name, file, dir, style, restart)| {
            let e = read_entry(&file, style);
            let ours = e.as_ref().is_some_and(|v| {
                v.get("command").and_then(Value::as_str) == Some(exe)
                    && v.get("args") == Some(&json!(["--mcp", identifier]))
            });
            ClientState {
                id,
                name,
                installed: dir.exists() || file.exists(),
                connected: e.is_some(),
                elsewhere: e.is_some() && !ours,
                restart,
            }
        })
        .collect()
}

/// Assistants installés sur l'ordinateur et ceux déjà reliés à Jollof Studio.
#[tauri::command]
pub fn ai_clients(app: AppHandle) -> Vec<ClientState> {
    client_states(&exe_path(), &app.config().identifier)
}

/// Relie (on) ou détache un assistant : seule son entrée « jollof-studio » est écrite ou retirée.
#[tauri::command]
pub fn ai_connect(app: AppHandle, id: String, on: bool) -> Result<Vec<ClientState>, String> {
    let exe = exe_path();
    let ident = app.config().identifier.clone();
    let (_, _, file, dir, style, _) = clients()
        .into_iter()
        .find(|c| c.0 == id)
        .ok_or("assistant inconnu")?;
    if on && !dir.exists() && !file.exists() {
        return Err("cet assistant n'est pas installé".into());
    }
    set_entry(&file, style, on.then(|| entry_for(style, &exe, &ident)))?;
    Ok(client_states(&exe, &ident))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn req(method: &str, path: &str, h: &[(&str, &str)]) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            headers: h
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: vec![],
        }
    }
    const T: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn only_local_authenticated_posts_reach_the_window() {
        let ok = [
            ("host", "127.0.0.1:47821"),
            ("authorization", &*format!("Bearer {T}")),
        ];
        assert!(screen(&req("POST", "/mcp", &ok), 47821, T).is_none());
        assert!(screen(&req("DELETE", "/mcp", &ok), 47821, T).is_none());
        assert!(screen(
            &req(
                "POST",
                "/mcp",
                &[
                    ("host", "localhost:47821"),
                    ("authorization", &*format!("Bearer {T}"))
                ]
            ),
            47821,
            T
        )
        .is_none());
        assert_eq!(
            screen(
                &req("POST", "/mcp", &[("host", "127.0.0.1:47821")]),
                47821,
                T
            )
            .unwrap()
            .0,
            401
        );
        assert_eq!(
            screen(
                &req(
                    "POST",
                    "/mcp",
                    &[("host", "127.0.0.1:47821"), ("authorization", "Bearer abc")]
                ),
                47821,
                T
            )
            .unwrap()
            .0,
            401
        );
        assert_eq!(
            screen(
                &req(
                    "POST",
                    "/mcp",
                    &[
                        ("host", "evil.example:47821"),
                        ("authorization", &*format!("Bearer {T}"))
                    ]
                ),
                47821,
                T
            )
            .unwrap()
            .0,
            403
        );
        let web = [
            ("host", "127.0.0.1:47821"),
            ("origin", "https://evil.example"),
            ("authorization", &*format!("Bearer {T}")),
        ];
        assert_eq!(screen(&req("POST", "/mcp", &web), 47821, T).unwrap().0, 403);
        assert_eq!(
            screen(&req("POST", "/autre", &ok), 47821, T).unwrap().0,
            404
        );
        assert_eq!(screen(&req("GET", "/mcp", &ok), 47821, T).unwrap().0, 405);
        assert_eq!(screen(&req("POST", "/mcp", &ok), 47821, "").unwrap().0, 401);
    }

    /// Vrai serveur sur un port libre : requête HTTP brute, réponse lue en entier.
    fn http(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }
    #[test]
    fn server_requires_key_and_an_accepted_session() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let shared = Arc::new(Shared::default());
        {
            let mut g = shared.inner.lock().unwrap();
            g.port = port;
            g.token = T.into();
            g.sessions.insert("ouverte".into());
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (sh, st) = (shared.clone(), stop.clone());
        std::thread::spawn(move || serve(listener, sh, st));
        let post = |body: &str, extra: &str| {
            format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\n\r\n{body}", body.len())
        };
        let list = r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#;
        let key = format!("Authorization: Bearer {T}\r\n");
        assert!(http(port, &post(list, "")).starts_with("HTTP/1.1 401"));
        // Bonne clé, mais pas de session (ou une session jamais acceptée) : 404, le client doit s'initialiser.
        let r = http(port, &post(list, &key));
        assert!(
            r.starts_with("HTTP/1.1 404") && r.contains(r#""id":7"#),
            "{r}"
        );
        let r = http(
            port,
            &post(list, &format!("{key}Mcp-Session-Id: inventee\r\n")),
        );
        assert!(r.starts_with("HTTP/1.1 404"), "{r}");
        // Session acceptée mais pont sans fenêtre : 503 qui reprend l'identifiant.
        let r = http(
            port,
            &post(list, &format!("{key}Mcp-Session-Id: ouverte\r\n")),
        );
        assert!(r.starts_with("HTTP/1.1 503") && r.contains("-32002"), "{r}");
        // initialize sans fenêtre : refusé, aucune session ouverte.
        let r = http(
            port,
            &post(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
                &key,
            ),
        );
        assert!(
            r.starts_with("HTTP/1.1 503") && !r.contains("Mcp-Session-Id"),
            "{r}"
        );
        // DELETE ferme la session.
        let r = http(port, &format!("DELETE /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{key}Mcp-Session-Id: ouverte\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        assert!(!shared.inner.lock().unwrap().sessions.contains("ouverte"));
        let r = http(port, &format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{key}Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 411"), "{r}");
        stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", port));
    }

    /// Faux pont pour le relais : vérifie la clé et la session, rejoue un redémarrage (session perdue).
    #[test]
    fn stdio_relay_keeps_its_session_and_recovers_after_a_restart() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let dir = std::env::temp_dir().join(format!("jollof-ai-test-{port}"));
        let cfg = dir.join(FILE);
        write_config(
            &cfg,
            &Config {
                port,
                token: T.into(),
            },
        )
        .unwrap();
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            let mut inits = 0;
            for s in listener.incoming() {
                let mut s = s.unwrap();
                let Ok(req) = read_request(&mut s) else {
                    continue;
                };
                if req.headers.get("authorization").map(String::as_str)
                    != Some(&*format!("Bearer {T}"))
                {
                    respond(&mut s, 401, "").unwrap();
                    continue;
                }
                let sid = req
                    .headers
                    .get("mcp-session-id")
                    .cloned()
                    .unwrap_or_default();
                if req.method == "DELETE" {
                    log.lock().unwrap().push(format!("DELETE {sid}"));
                    respond(&mut s, 200, "").unwrap();
                    continue;
                }
                let v: Value = serde_json::from_slice(&req.body).unwrap();
                let m = v["method"].as_str().unwrap_or("").to_string();
                log.lock().unwrap().push(format!("{m} {sid}"));
                if m == "initialize" {
                    inits += 1;
                    let body = json!({ "jsonrpc": "2.0", "id": v["id"], "result": {} }).to_string();
                    respond_with(
                        &mut s,
                        200,
                        &body,
                        &[("Mcp-Session-Id", &format!("s{inits}"))],
                    )
                    .unwrap();
                } else if v.get("id").is_none() {
                    respond(&mut s, 202, "").unwrap();
                } else if sid != format!("s{inits}") || (inits == 1 && m == "tools/call") {
                    // La deuxième requête fait comme si l'application avait redémarré.
                    respond(
                        &mut s,
                        404,
                        &rpc_error(&v["id"], -32004, "session inconnue"),
                    )
                    .unwrap();
                } else {
                    respond(
                        &mut s,
                        200,
                        &json!({ "jsonrpc": "2.0", "id": v["id"], "result": { "sid": sid } })
                            .to_string(),
                    )
                    .unwrap();
                }
            }
        });
        let input = [
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_project"}}"#,
        ]
        .join("\n");
        // Deux éditions candidates : la première n'a jamais été activée, la seconde répond et est retenue.
        let mut target = Target {
            paths: vec![dir.join("absente").join(FILE), cfg.clone()],
            pinned: None,
        };
        let mut out = Vec::new();
        relay(input.as_bytes(), &mut out, &mut target, None, BEAT);
        assert_eq!(target.pinned, Some(1));
        let text = String::from_utf8(out).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert!(lines[1].contains(r#""sid":"s1""#), "{text}");
        assert!(
            lines[2].contains(r#""id":3"#) && lines[2].contains(r#""sid":"s2""#),
            "session refaite : {text}"
        );
        let calls = seen.lock().unwrap().clone();
        assert_eq!(calls.first().map(String::as_str), Some("initialize "));
        assert!(
            calls.contains(&"tools/list s1".to_string())
                && calls.contains(&"DELETE s2".to_string()),
            "{calls:?}"
        );
        // Plus de fichier : jamais activé, message clair qui reprend l'identifiant.
        let _ = std::fs::remove_dir_all(&dir);
        let mut out = Vec::new();
        relay(
            r#"{"jsonrpc":"2.0","id":"a","method":"initialize"}"#.as_bytes(),
            &mut out,
            &mut Target {
                paths: vec![cfg.clone()],
                pinned: None,
            },
            None,
            BEAT,
        );
        let text = String::from_utf8(out).unwrap();
        assert!(
            text.contains(r#""id":"a""#) && text.contains("-32000") && text.contains("IA"),
            "{text}"
        );
    }

    /// Entrée qui reste ouverte un moment avant de se fermer (assistant qui garde son relais lancé).
    struct Open(Duration);
    impl Read for Open {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            std::thread::sleep(std::mem::take(&mut self.0));
            Ok(0)
        }
    }
    /// Battement : pings avec la session ; session perdue (application redémarrée) : nouvelle initialisation
    /// « silencieuse », sans demande d'accord, puis pings avec la nouvelle session.
    #[test]
    fn heartbeat_keeps_the_session_and_rejoins_silently() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let dir = std::env::temp_dir().join(format!("jollof-ai-beat-{port}"));
        let cfg = dir.join(FILE);
        write_config(
            &cfg,
            &Config {
                port,
                token: T.into(),
            },
        )
        .unwrap();
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            let (mut inits, mut pings) = (0, 0);
            for s in listener.incoming() {
                let mut s = s.unwrap();
                let Ok(req) = read_request(&mut s) else {
                    continue;
                };
                let sid = req
                    .headers
                    .get("mcp-session-id")
                    .cloned()
                    .unwrap_or_default();
                if req.method == "DELETE" {
                    log.lock().unwrap().push(format!("DELETE {sid}"));
                    respond(&mut s, 200, "").unwrap();
                    continue;
                }
                let v: Value = serde_json::from_slice(&req.body).unwrap();
                let m = v["method"].as_str().unwrap_or("").to_string();
                if m == "initialize" {
                    inits += 1;
                    let quiet = v["params"]["_meta"]["sn.jollof/silent"] == json!(true);
                    log.lock()
                        .unwrap()
                        .push(format!("initialize{}", if quiet { " silent" } else { "" }));
                    respond_with(
                        &mut s,
                        200,
                        &json!({ "jsonrpc": "2.0", "id": v["id"], "result": {} }).to_string(),
                        &[("Mcp-Session-Id", &format!("s{inits}"))],
                    )
                    .unwrap();
                } else if m == "ping" {
                    pings += 1;
                    log.lock().unwrap().push(format!("ping {sid}"));
                    // Le premier ping trouve l'application redémarrée : session inconnue.
                    let st = if pings == 1 { 404 } else { 200 };
                    respond(
                        &mut s,
                        st,
                        &json!({ "jsonrpc": "2.0", "id": v["id"], "result": {} }).to_string(),
                    )
                    .unwrap();
                } else {
                    respond(&mut s, 202, "").unwrap();
                }
            }
        });
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"claude-ai"}}}"#.to_string() + "\n";
        let input = BufReader::new(init.as_bytes().chain(Open(Duration::from_millis(600))));
        let mut out = Vec::new();
        relay(
            input,
            &mut out,
            &mut Target {
                paths: vec![cfg.clone()],
                pinned: None,
            },
            None,
            Duration::from_millis(100),
        );
        let calls = seen.lock().unwrap().clone();
        assert_eq!(calls[0], "initialize", "{calls:?}");
        assert!(calls.contains(&"ping s1".to_string()), "{calls:?}");
        assert!(
            calls.contains(&"initialize silent".to_string()),
            "{calls:?}"
        );
        assert!(calls.contains(&"ping s2".to_string()), "{calls:?}");
        assert_eq!(
            calls.last().map(String::as_str),
            Some("DELETE s2"),
            "{calls:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn assistant_configs_are_merged_without_touching_the_rest() {
        let dir = std::env::temp_dir().join(format!("jollof-ai-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Fichier existant : autres serveurs et réglages gardés, dans le même ordre ; sauvegarde faite.
        let f = dir.join("claude_desktop_config.json");
        std::fs::write(
            &f,
            r#"{"zoom": 1, "mcpServers": {"autre": {"command": "x"}}, "apres": true}"#,
        )
        .unwrap();
        set_entry(
            &f,
            Style::McpServers,
            Some(entry_for(
                Style::McpServers,
                "/app/jollof-studio",
                "sn.jollof.studio.pro",
            )),
        )
        .unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(
            v.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["zoom", "mcpServers", "apres"]
        );
        assert_eq!(v["mcpServers"]["autre"]["command"], "x");
        assert_eq!(
            v["mcpServers"][SERVER_KEY],
            json!({ "command": "/app/jollof-studio", "args": ["--mcp", "sn.jollof.studio.pro"] })
        );
        assert!(PathBuf::from(format!("{}.jollof-backup", f.display())).exists());
        assert!(
            !std::fs::read_to_string(&f).unwrap().contains(T),
            "aucune clé dans la configuration d'un autre logiciel"
        );
        // Retrait : seule notre entrée part.
        set_entry(&f, Style::McpServers, None).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(v["mcpServers"].get(SERVER_KEY).is_none() && v["mcpServers"]["autre"].is_object());
        // Fichier absent (VS Code) : créé avec la bonne forme.
        let g = dir.join("User").join("mcp.json");
        set_entry(
            &g,
            Style::VsCode,
            Some(entry_for(Style::VsCode, "/app/j", "sn.jollof.studio")),
        )
        .unwrap();
        assert_eq!(read_entry(&g, Style::VsCode).unwrap()["type"], "stdio");
        // JSON avec commentaires : refusé, fichier intact.
        let h = dir.join("mcp.json");
        std::fs::write(&h, "{ // commentaire\n }").unwrap();
        assert!(set_entry(&h, Style::McpServers, Some(json!({}))).is_err());
        assert_eq!(std::fs::read_to_string(&h).unwrap(), "{ // commentaire\n }");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edition_argument_cannot_escape_the_data_folder() {
        assert!(valid_identifier("sn.jollof.studio.pro") && valid_identifier("sn.jollof.studio"));
        for bad in [
            "",
            "../etc",
            "a/b",
            ".hidden",
            "sn..x",
            "a b",
            &"x".repeat(65),
        ] {
            assert!(!valid_identifier(bad), "{bad}");
        }
        assert!(data_dir("sn.jollof.studio.pro")
            .unwrap()
            .ends_with("sn.jollof.studio.pro"));
    }

    #[test]
    fn tokens_are_long_and_distinct() {
        let a = random_hex();
        let b = random_hex();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
        assert!(same(&a, &a) && !same(&a, &b) && !same(&a, "court"));
    }
}
