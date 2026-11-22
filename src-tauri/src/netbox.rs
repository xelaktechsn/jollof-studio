// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Synchronisation avec NetBox (API REST) : réglages, jeton dans le trousseau du système, requêtes HTTP faites ici
//! (jamais par la fenêtre), pagination, reprises, limite de débit, erreurs en français.
//!
//! Cible : NetBox 4.x (lu pour 4.4 à 4.7, documentation publique de NetBox Labs, « REST API Overview »,
//! https://netboxlabs.com/docs/netbox/integrations/rest-api/ ; clés de src/check/sources-net.js, bloc @interop) :
//!   - authentification : `Authorization: Bearer nbt_<clé>.<jeton>` (jetons v2, NetBox 4.5 et suivants) ou
//!     `Authorization: Token <jeton>` (jetons v1, dépréciés en 4.6, retirés en 5.0) : choisi d'après le préfixe nbt_ ;
//!   - pagination : `count`, `next`, `previous`, `results` ; `limit` borné par MAX_PAGE_SIZE (1000 par défaut) ;
//!     `next` est une adresse complète (on n'en garde que le chemin et la requête : on ne parle qu'au serveur réglé) ;
//!   - erreurs de validation : dictionnaire champ → messages (`{"slug": ["This field may not be blank."]}`), liste de
//!     tels dictionnaires pour une écriture groupée ;
//!   - /api/status/ : `netbox-version`, `netbox-full-version`, `django-version`, `python-version`, `plugins`,
//!     `rq-workers-running`, `hostname` (lu dans netbox/api/views.py, StatusView).
//!
//! Sécurité :
//!   - le jeton est rangé dans le trousseau (même mécanisme que la clé du pont IA, ai.rs : Trousseau macOS,
//!     Gestionnaire d'identification Windows, Secret Service) ; sans trousseau utilisable (ou en développement sans
//!     JOLLOF_KEYRING=1), dans un fichier lisible par l'utilisateur seul ; jamais dans le projet, jamais rendu à la
//!     fenêtre, jamais écrit au journal ;
//!   - https exigé (http seulement sur demande explicite) ; vérification TLS active par défaut (autorité PEM propre
//!     possible ; désactivation explicite seulement, pour un certificat auto-signé) ;
//!   - chemins limités à /api/… ; aucune redirection suivie (le jeton ne part jamais ailleurs) ;
//!   - délais de connexion et de réponse, corps de réponse borné, débit limité, reprises bornées.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const FILE: &str = "netbox.json";
const TOKEN_FILE: &str = "netbox.token";
const KEY_USER: &str = "netbox-token";
/// Taille d'une page demandée (NetBox la borne à MAX_PAGE_SIZE, 1000 par défaut).
const PAGE: u32 = 500;
/// Objets lus au plus par une requête paginée (un très grand NetBox : on s'arrête et on le dit).
const MAX_OBJECTS: u32 = 200_000;
/// Corps de réponse borné (une page de 500 interfaces fait moins de 2 Mo).
const MAX_BODY: u64 = 64 << 20;
/// Écart minimal entre deux requêtes (40 par seconde au plus) : un serveur partagé n'est pas inondé.
const MIN_GAP: Duration = Duration::from_millis(25);
/// Reprises : 5 essais au plus, attente doublée à chaque fois (0,5 s, 1 s, 2 s, 4 s), Retry-After respecté (30 s au plus).
const TRIES: u32 = 5;
const BACKOFF: Duration = Duration::from_millis(500);
const MAX_WAIT: Duration = Duration::from_secs(30);

/* ---------- Erreurs ---------- */

/// Erreur rendue à la fenêtre : kind ('config', 'url', 'net', 'tls', 'timeout', 'auth', 'notfound', 'invalid',
/// 'conflict', 'rate', 'server', 'redirect', 'format', 'cancel', 'store'), status HTTP (0 sans réponse), message en
/// français, erreurs par champ ({ field, msg, index? : rang de l'objet d'une écriture groupée }).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct NbError {
    pub kind: &'static str,
    pub status: u16,
    pub message: String,
    pub fields: Vec<FieldError>,
}
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct FieldError {
    pub field: String,
    pub msg: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
}
fn err(kind: &'static str, message: impl Into<String>) -> NbError {
    NbError {
        kind,
        status: 0,
        message: message.into(),
        fields: vec![],
    }
}
impl From<String> for NbError {
    fn from(s: String) -> Self {
        err("store", s)
    }
}

/// Texte court d'une réponse (détail d'une erreur), sans retour à la ligne.
fn short(s: &str) -> String {
    let t: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > 300 {
        t.chars().take(300).collect::<String>() + "…"
    } else {
        t
    }
}
/// Erreurs par champ d'une réponse 400 : { champ: [messages] } ou [ {…}, {…} ] (écriture groupée) ;
/// « detail » et « non_field_errors » deviennent un champ vide.
pub fn field_errors(body: &Value) -> Vec<FieldError> {
    fn walk(v: &Value, prefix: &str, index: Option<usize>, out: &mut Vec<FieldError>) {
        match v {
            Value::Object(m) => {
                for (k, x) in m {
                    let name = if k == "detail" || k == "non_field_errors" || k == "__all__" {
                        prefix.to_string()
                    } else if prefix.is_empty() {
                        k.clone()
                    } else {
                        format!("{prefix}.{k}")
                    };
                    walk(x, &name, index, out);
                }
            }
            Value::Array(a) if a.iter().all(|x| x.is_string()) => {
                for x in a {
                    out.push(FieldError {
                        field: prefix.to_string(),
                        msg: short(x.as_str().unwrap_or_default()),
                        index,
                    });
                }
            }
            Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    walk(x, prefix, if prefix.is_empty() && index.is_none() { Some(i) } else { index }, out);
                }
            }
            Value::String(s) => out.push(FieldError {
                field: prefix.to_string(),
                msg: short(s),
                index,
            }),
            _ => {}
        }
    }
    let mut out = vec![];
    walk(body, "", None, &mut out);
    out.truncate(200);
    out
}
/// Erreur d'une réponse HTTP (code ≥ 300), en français.
pub fn http_error(status: u16, body: &str, path: &str) -> NbError {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let detail = v
        .get("detail")
        .and_then(Value::as_str)
        .map(short)
        .unwrap_or_else(|| if v.is_null() { short(body) } else { String::new() });
    let tail = if detail.is_empty() {
        String::new()
    } else {
        format!(" ({detail})")
    };
    let (kind, message) = match status {
        300..=399 => ("redirect", format!("Le serveur redirige la requête ({status}) : vérifiez l’adresse (https, sous-chemin de NetBox). Aucune redirection n’est suivie, pour ne jamais envoyer le jeton ailleurs.")),
        400 => {
            let fields = field_errors(&v);
            let list = fields
                .iter()
                .take(6)
                .map(|f| match (f.index, f.field.is_empty()) {
                    (Some(i), true) => format!("objet {} : {}", i + 1, f.msg),
                    (Some(i), false) => format!("objet {}, champ « {} » : {}", i + 1, f.field, f.msg),
                    (None, true) => f.msg.clone(),
                    (None, false) => format!("champ « {} » : {}", f.field, f.msg),
                })
                .collect::<Vec<_>>()
                .join(" ; ");
            return NbError {
                kind: "invalid",
                status,
                message: format!("Données refusées par NetBox : {}", if list.is_empty() { short(body) } else { list }),
                fields,
            };
        }
        401 | 403 => ("auth", format!("Accès refusé par NetBox ({status}) : jeton absent, invalide, expiré, en lecture seule, ou sans la permission nécessaire pour {path}{tail}.")),
        404 => ("notfound", format!("Introuvable sur ce serveur : {path} (adresse de NetBox, version, ou objet supprimé entre-temps){tail}.")),
        409 | 412 => ("conflict", format!("Conflit ({status}) : l’objet a changé sur le serveur entre-temps{tail}. Relancez la comparaison.")),
        429 => ("rate", "Trop de requêtes : le serveur limite le débit. Réessayez dans un moment.".to_string()),
        500..=599 => ("server", format!("Erreur du serveur NetBox ({status}){tail}.")),
        _ => ("server", format!("Réponse inattendue du serveur ({status}){tail}.")),
    };
    NbError {
        kind,
        status,
        message,
        fields: vec![],
    }
}
/// Erreur de transport (pas de réponse HTTP).
fn transport_error(e: &ureq::Error) -> NbError {
    use ureq::Error as E;
    match e {
        E::Timeout(_) => err("timeout", "Le serveur NetBox ne répond pas (délai dépassé)."),
        E::HostNotFound => err("net", "Serveur introuvable : le nom de l’hôte ne se résout pas (DNS)."),
        E::ConnectionFailed => err("net", "Connexion impossible : serveur arrêté, port fermé ou pare-feu."),
        E::Tls(_) | E::Pem(_) | E::Rustls(_) => err("tls", format!("Connexion TLS refusée : {e}. Si le serveur utilise un certificat d’une autorité interne, ajoutez-la (fichier PEM) ; désactiver la vérification n’est à faire que sur un réseau de confiance.")),
        E::Io(io) if io.to_string().to_ascii_lowercase().contains("certificate") => err("tls", format!("Certificat du serveur refusé : {io}.")),
        E::Io(io) => err("net", format!("Échange interrompu avec le serveur : {io}.")),
        E::BodyExceedsLimit(_) => err("format", "Réponse trop volumineuse : demandez moins d’objets à la fois."),
        _ => err("net", format!("Échange impossible avec le serveur : {e}.")),
    }
}

/* ---------- Adresse, chemins, jeton ---------- */

/// Adresse de base validée : « https://hôte[:port][/sous-chemin] » sans « / » final ni « /api ». http seulement si
/// allow_http. Ni identifiants (user@), ni requête, ni fragment, ni espace.
pub fn validate_base(raw: &str, allow_http: bool) -> Result<String, NbError> {
    let s = raw.trim();
    let bad = |m: &str| err("url", format!("Adresse du serveur invalide : {m}."));
    let rest = if let Some(r) = s.strip_prefix("https://") {
        r
    } else if let Some(r) = s.strip_prefix("http://") {
        if !allow_http {
            return Err(bad("https exigé (le jeton circulerait en clair) ; cochez « Autoriser http » seulement sur un réseau de confiance"));
        }
        r
    } else {
        return Err(bad("elle doit commencer par https://"));
    };
    if s.len() > 300 || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(bad("caractères non permis"));
    }
    if rest.contains(['@', '?', '#', '\\']) {
        return Err(bad("ni identifiants, ni requête, ni fragment"));
    }
    let (host_port, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let (host, port) = if let Some(h) = host_port.strip_prefix('[') {
        let end = h.find(']').ok_or_else(|| bad("adresse IPv6 mal fermée"))?;
        let after = &h[end + 1..];
        (&host_port[..end + 2], after.strip_prefix(':'))
    } else {
        match host_port.rsplit_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (host_port, None),
        }
    };
    let host_ok = !host.is_empty()
        && host.len() <= 253
        && (host.starts_with('[')
            || host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_'));
    if !host_ok {
        return Err(bad("nom d’hôte"));
    }
    if let Some(p) = port {
        if p.is_empty() || p.len() > 5 || !p.chars().all(|c| c.is_ascii_digit()) || p.parse::<u32>().unwrap_or(0) > 65535 {
            return Err(bad("port"));
        }
    }
    if path.contains("..") || !path.chars().all(|c| c.is_ascii_alphanumeric() || "/-._~".contains(c)) {
        return Err(bad("chemin"));
    }
    let mut path = path.trim_end_matches('/').to_string();
    if let Some(p) = path.strip_suffix("/api") {
        path = p.to_string();
    }
    let scheme = if s.starts_with("https://") { "https" } else { "http" };
    Ok(format!("{scheme}://{}{}", host_port.to_ascii_lowercase(), path))
}
/// Chemin d'API permis : /api/…/ (lettres, chiffres, - _ . /), sans « .. », terminé par « / » (NetBox redirige sinon).
pub fn validate_path(path: &str) -> Result<(), NbError> {
    let ok = path.starts_with("/api/")
        && path.ends_with('/')
        && path.len() <= 200
        && !path.contains("..")
        && !path.contains("//")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c));
    if ok {
        Ok(())
    } else {
        Err(err("url", format!("Chemin d’API refusé : {path}")))
    }
}
/// Jeton plausible : 8 à 512 caractères visibles, sans espace (rien ne peut s'ajouter à l'en-tête).
pub fn validate_token(t: &str) -> Result<(), NbError> {
    if (8..=512).contains(&t.len()) && t.chars().all(|c| c.is_ascii_graphic()) {
        Ok(())
    } else {
        Err(err("config", "Jeton invalide : collez le jeton tel que NetBox l’affiche (sans espace)."))
    }
}
/// En-tête d'authentification : jetons v2 (« nbt_… », NetBox 4.5+) en Bearer, jetons v1 en « Token ».
pub fn auth_header(token: &str) -> String {
    if token.starts_with("nbt_") {
        format!("Bearer {token}")
    } else {
        format!("Token {token}")
    }
}
fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}
/// Requête encodée (« ?a=1&b=x%20y ») ; clés limitées aux lettres, chiffres, _ . - (filtres NetBox : site_id,
/// cf_jollof_id, slug, tag…).
pub fn encode_query(q: &[(String, String)]) -> Result<String, NbError> {
    let mut out = String::new();
    for (k, v) in q {
        if k.is_empty() || k.len() > 60 || !k.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c)) {
            return Err(err("url", format!("Paramètre refusé : {k}")));
        }
        out.push(if out.is_empty() { '?' } else { '&' });
        out.push_str(k);
        out.push('=');
        out.push_str(&enc(v));
    }
    Ok(out)
}
/// Page suivante : chemin et requête de « next », gardés seulement s'ils restent sous l'API du serveur réglé.
pub fn next_path(base: &str, next: &str) -> Option<String> {
    let after = next.split_once("://").map(|(_, r)| r).unwrap_or(next);
    let pq = &after[after.find('/')?..];
    let base_path = base.split_once("://").map(|(_, r)| r).and_then(|r| r.find('/').map(|i| &r[i..])).unwrap_or("");
    let rel = pq.strip_prefix(base_path)?;
    let (p, q) = rel.split_once('?').unwrap_or((rel, ""));
    validate_path(p).ok()?;
    if q.chars().any(|c| c.is_whitespace() || c == '#') {
        return None;
    }
    Some(if q.is_empty() { p.to_string() } else { format!("{p}?{q}") })
}

/* ---------- Connexion ---------- */

/// Annulation : chaque opération longue note la génération à son début et s'arrête si elle a changé (nb_cancel).
static GEN: AtomicU64 = AtomicU64::new(0);
/// Heure de la dernière requête (limite de débit, toutes connexions confondues).
static PACE: Mutex<Option<Instant>> = Mutex::new(None);

pub struct Conn {
    pub base: String,
    token: String,
    agent: ureq::Agent,
    pub backoff: Duration,
}
impl Conn {
    /// verify : vérification TLS ; ca : autorité PEM propre (seule reconnue alors).
    pub fn new(base: &str, token: &str, verify: bool, ca: Option<&str>) -> Result<Conn, NbError> {
        let mut tls = ureq::tls::TlsConfig::builder().disable_verification(!verify);
        if let Some(pem) = ca.filter(|p| !p.trim().is_empty()) {
            let certs = parse_ca(pem)?;
            tls = tls.root_certs(ureq::tls::RootCerts::new_with_certs(&certs));
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(90)))
            .user_agent(concat!("JollofStudio/", env!("CARGO_PKG_VERSION"), " (NetBox sync)"))
            .tls_config(tls.build())
            .build()
            .into();
        Ok(Conn {
            base: base.to_string(),
            token: token.to_string(),
            agent,
            backoff: BACKOFF,
        })
    }
    pub fn tls_verifies(&self) -> bool {
        !self.agent.config().tls_config().disable_verification()
    }

    /// Une requête, avec reprises : GET, PATCH, PUT, DELETE sur 429, 502, 503, 504 et pannes de transport ; POST
    /// (non idempotent) seulement sur 429 et 503 (requête non traitée). Rend (code, corps JSON ou Null).
    pub fn request(&self, method: &str, path_q: &str, body: Option<&str>, gen: u64) -> Result<(u16, Value), NbError> {
        let url = format!("{}{}", self.base, path_q);
        let idem = method != "POST";
        let path = path_q.split('?').next().unwrap_or(path_q);
        let mut wait = self.backoff;
        for attempt in 1..=TRIES {
            if GEN.load(Ordering::SeqCst) != gen {
                return Err(err("cancel", "Annulé."));
            }
            pace();
            let res = self.send(method, &url, body);
            let last = attempt == TRIES;
            match res {
                Ok((status, retry_after, text)) => {
                    let retry = status == 429 || status == 503 || (idem && (status == 502 || status == 504));
                    if retry && !last {
                        let w = retry_after.map(|s| Duration::from_secs(s).min(MAX_WAIT)).unwrap_or(wait);
                        log::info!("NetBox : {method} {path} → {status}, nouvel essai dans {} ms", w.as_millis());
                        sleep_cancellable(w, gen)?;
                        wait = (wait * 2).min(MAX_WAIT);
                        continue;
                    }
                    if !(200..300).contains(&status) {
                        return Err(http_error(status, &text, path));
                    }
                    if status == 204 || text.trim().is_empty() {
                        return Ok((status, Value::Null));
                    }
                    let v = serde_json::from_str(&text).map_err(|_| err("format", "Réponse inattendue (pas du JSON) : l’adresse ne mène peut-être pas à un serveur NetBox."))?;
                    return Ok((status, v));
                }
                Err(e) => {
                    let ne = transport_error(&e);
                    // Pas de reprise sur une erreur TLS ou de nom (elle reviendrait) ; POST : pas de reprise du tout.
                    if idem && !last && matches!(ne.kind, "net" | "timeout") && !matches!(e, ureq::Error::HostNotFound) {
                        sleep_cancellable(wait, gen)?;
                        wait = (wait * 2).min(MAX_WAIT);
                        continue;
                    }
                    return Err(ne);
                }
            }
        }
        Err(err("server", "Le serveur n’a pas répondu après plusieurs essais."))
    }
    fn send(&self, method: &str, url: &str, body: Option<&str>) -> Result<(u16, Option<u64>, String), ureq::Error> {
        let auth = auth_header(&self.token);
        let a = &self.agent;
        let mut res = match (method, body) {
            ("GET", _) => a.get(url).header("Authorization", &auth).header("Accept", "application/json").call()?,
            ("DELETE", None) => a.delete(url).header("Authorization", &auth).header("Accept", "application/json").call()?,
            ("DELETE", Some(b)) => a
                .delete(url)
                .header("Authorization", &auth)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .force_send_body()
                .send(b)?,
            (m, b) => {
                let b = b.unwrap_or("{}");
                let rq = match m {
                    "POST" => a.post(url),
                    "PUT" => a.put(url),
                    _ => a.patch(url),
                };
                rq.header("Authorization", &auth)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .send(b)?
            }
        };
        let status = res.status().as_u16();
        let retry_after = res
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());
        let text = res.body_mut().with_config().limit(MAX_BODY).read_to_string()?;
        Ok((status, retry_after, text))
    }

    /// Lecture paginée (suit « next ») : { count, results, truncated }. max : objets lus au plus.
    pub fn get_all(&self, path: &str, query: &[(String, String)], max: u32, gen: u64) -> Result<Value, NbError> {
        validate_path(path)?;
        let max = max.clamp(1, MAX_OBJECTS);
        let mut q: Vec<(String, String)> = query.iter().filter(|(k, _)| k != "limit" && k != "offset").cloned().collect();
        q.push(("limit".into(), PAGE.min(max).to_string()));
        let mut next = Some(format!("{path}{}", encode_query(&q)?));
        let (mut results, mut count, mut truncated) = (Vec::<Value>::new(), 0u64, false);
        let mut pages = 0;
        while let Some(pq) = next.take() {
            pages += 1;
            if pages > 2000 {
                truncated = true;
                break;
            }
            let (_, v) = self.request("GET", &pq, None, gen)?;
            match v.get("results").and_then(Value::as_array) {
                Some(list) => {
                    count = v.get("count").and_then(Value::as_u64).unwrap_or(count);
                    results.extend(list.iter().cloned());
                    if results.len() as u32 >= max {
                        truncated = v.get("next").is_some_and(|n| !n.is_null()) || results.len() as u32 > max;
                        results.truncate(max as usize);
                        break;
                    }
                    if let Some(n) = v.get("next").and_then(Value::as_str) {
                        next = Some(next_path(&self.base, n).ok_or_else(|| err("format", "Lien de page suivante inattendu (autre serveur ou autre chemin) : lecture arrêtée."))?);
                    }
                }
                // Point d'accès non paginé (un objet seul) : rendu tel quel.
                None => return Ok(json!({ "count": 1, "results": [v], "truncated": false })),
            }
        }
        Ok(json!({ "count": count.max(results.len() as u64), "results": results, "truncated": truncated }))
    }
}
fn parse_ca(pem: &str) -> Result<Vec<ureq::tls::Certificate<'static>>, NbError> {
    let mut out = vec![];
    for item in ureq::tls::parse_pem(pem.as_bytes()) {
        if let Ok(ureq::tls::PemItem::Certificate(c)) = item {
            out.push(c);
        }
    }
    if out.is_empty() {
        return Err(err("tls", "Le fichier d’autorité ne contient aucun certificat PEM (-----BEGIN CERTIFICATE-----)."));
    }
    Ok(out)
}
fn pace() {
    let mut last = PACE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = *last {
        let d = t.elapsed();
        if d < MIN_GAP {
            std::thread::sleep(MIN_GAP - d);
        }
    }
    *last = Some(Instant::now());
}
fn sleep_cancellable(d: Duration, gen: u64) -> Result<(), NbError> {
    let t0 = Instant::now();
    while t0.elapsed() < d {
        if GEN.load(Ordering::SeqCst) != gen {
            return Err(err("cancel", "Annulé."));
        }
        std::thread::sleep(Duration::from_millis(20).min(d));
    }
    Ok(())
}

/* ---------- Réglages ---------- */

/// Fichier netbox.json (dossier de données de l'application) : tout sauf le jeton.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
pub struct Config {
    url: String,
    /// Vérification TLS : vraie par défaut (désactivée seulement par l'utilisateur).
    #[serde(default = "yes")]
    verify: bool,
    allow_http: bool,
    /// Autorité de certification propre (PEM : données publiques).
    ca: String,
    /// Adresses pour lesquelles l'utilisateur a accepté l'envoi des données du projet.
    consented: Vec<String>,
    /// Où est le jeton : 'keyring' | 'file' | '' (aucun).
    store: String,
}
fn yes() -> bool {
    true
}
/// Ce que la fenêtre voit des réglages (jamais le jeton).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    url: String,
    verify: bool,
    allow_http: bool,
    has_ca: bool,
    has_token: bool,
    store: String,
    consented: bool,
}
pub struct Store {
    dir: PathBuf,
    identifier: String,
}
/// Jeton lu une fois (le trousseau peut demander l'accord) puis gardé en mémoire jusqu'au prochain réglage.
static TOKEN: Mutex<Option<String>> = Mutex::new(None);

impl Store {
    pub fn new(dir: PathBuf, identifier: &str) -> Store {
        Store {
            dir,
            identifier: identifier.to_string(),
        }
    }
    fn path(&self) -> PathBuf {
        self.dir.join(FILE)
    }
    pub fn config(&self) -> Config {
        std::fs::read_to_string(self.path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(Config {
                verify: true,
                ..Config::default()
            })
    }
    fn save(&self, c: &Config) -> Result<(), String> {
        crate::ai::write_atomic(&self.path(), &serde_json::to_string_pretty(c).map_err(|e| e.to_string())?, true)
    }
    fn token_path(&self) -> PathBuf {
        self.dir.join(TOKEN_FILE)
    }
    pub fn token(&self) -> Option<String> {
        if let Some(t) = TOKEN.lock().ok().and_then(|g| g.clone()) {
            return Some(t);
        }
        let c = self.config();
        let t = match c.store.as_str() {
            "keyring" if crate::ai::keyring_on() => keyring::Entry::new(&self.identifier, KEY_USER).ok()?.get_password().ok(),
            "file" => std::fs::read_to_string(self.token_path()).ok().map(|s| s.trim().to_string()),
            _ => None,
        }
        .filter(|t| validate_token(t).is_ok())?;
        if let Ok(mut g) = TOKEN.lock() {
            *g = Some(t.clone());
        }
        Some(t)
    }
    /// Range le jeton : trousseau si possible (relu pour vérifier), sinon fichier privé. "" : l'efface partout.
    fn set_token(&self, c: &mut Config, token: &str) -> Result<(), NbError> {
        if let Ok(mut g) = TOKEN.lock() {
            *g = None;
        }
        let entry = || keyring::Entry::new(&self.identifier, KEY_USER);
        if token.is_empty() {
            if crate::ai::keyring_on() {
                if let Ok(e) = entry() {
                    let _ = e.delete_credential();
                }
            }
            let _ = std::fs::remove_file(self.token_path());
            c.store.clear();
            return Ok(());
        }
        validate_token(token)?;
        let in_keyring = crate::ai::keyring_on()
            && entry().and_then(|e| e.set_password(token)).is_ok()
            && entry().and_then(|e| e.get_password()).ok().as_deref() == Some(token);
        if in_keyring {
            let _ = std::fs::remove_file(self.token_path());
            c.store = "keyring".into();
        } else {
            if crate::ai::keyring_on() {
                log::warn!("trousseau du système indisponible : jeton NetBox gardé dans un fichier privé");
            }
            crate::ai::write_atomic(&self.token_path(), token, true)?;
            c.store = "file".into();
        }
        Ok(())
    }
    pub fn settings(&self) -> Settings {
        let c = self.config();
        Settings {
            has_token: !c.store.is_empty() && self.token().is_some(),
            consented: !c.url.is_empty() && c.consented.contains(&c.url),
            has_ca: !c.ca.trim().is_empty(),
            url: c.url,
            verify: c.verify,
            allow_http: c.allow_http,
            store: c.store,
        }
    }
    /// Enregistre les réglages ; token : None garde le jeton, Some("") l'efface ; ca : None garde, Some("") retire.
    pub fn set(&self, url: &str, verify: bool, allow_http: bool, ca: Option<&str>, token: Option<&str>) -> Result<Settings, NbError> {
        let mut c = self.config();
        let url = if url.trim().is_empty() { String::new() } else { validate_base(url, allow_http)? };
        if let Some(p) = ca {
            if !p.trim().is_empty() {
                parse_ca(p)?;
                if p.len() > 256 << 10 {
                    return Err(err("tls", "Fichier d’autorité trop gros."));
                }
            }
            c.ca = p.trim().to_string();
        }
        // Autre serveur : le jeton de l'ancien ne doit pas partir vers le nouveau sans être ressaisi.
        let moved = !c.url.is_empty() && c.url != url;
        c.url = url;
        c.verify = verify;
        c.allow_http = allow_http;
        match token {
            Some(t) => self.set_token(&mut c, t.trim())?,
            None if moved => self.set_token(&mut c, "")?,
            None => {}
        }
        self.save(&c)?;
        Ok(self.settings())
    }
    pub fn consent(&self, url: &str) -> Result<(), NbError> {
        let mut c = self.config();
        if c.url.is_empty() || c.url != url {
            return Err(err("config", "L’accord porte sur un autre serveur que celui réglé."));
        }
        if !c.consented.contains(&c.url) {
            c.consented.push(c.url.clone());
            c.consented.truncate(20);
        }
        self.save(&c)?;
        Ok(())
    }
    pub fn conn(&self) -> Result<Conn, NbError> {
        let c = self.config();
        if c.url.is_empty() {
            return Err(err("config", "NetBox n’est pas réglé : saisissez l’adresse du serveur et un jeton d’API."));
        }
        let base = validate_base(&c.url, c.allow_http)?;
        let token = self.token().ok_or_else(|| err("config", "Aucun jeton d’API enregistré pour ce serveur."))?;
        Conn::new(&base, &token, c.verify, Some(&c.ca))
    }
}
fn store(app: &AppHandle) -> Result<Store, NbError> {
    let dir = app.path().app_data_dir().map_err(|e| err("store", e.to_string()))?;
    Ok(Store::new(dir, &app.config().identifier))
}
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, NbError> + Send + 'static) -> Result<T, NbError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| err("store", e.to_string()))?
}

/* ---------- Commandes ---------- */

#[tauri::command]
pub async fn nb_settings(app: AppHandle) -> Result<Settings, NbError> {
    let s = store(&app)?;
    blocking(move || Ok(s.settings())).await
}
#[tauri::command]
pub async fn nb_configure(
    app: AppHandle,
    url: String,
    verify: bool,
    allow_http: bool,
    ca: Option<String>,
    token: Option<String>,
) -> Result<Settings, NbError> {
    let s = store(&app)?;
    blocking(move || s.set(&url, verify, allow_http, ca.as_deref(), token.as_deref())).await
}
#[tauri::command]
pub async fn nb_consent(app: AppHandle, url: String) -> Result<(), NbError> {
    let s = store(&app)?;
    blocking(move || s.consent(&url)).await
}
/// Test de connexion : /api/status/ (version de NetBox, greffons, travailleurs) + type de jeton.
#[tauri::command]
pub async fn nb_status(app: AppHandle) -> Result<Value, NbError> {
    let s = store(&app)?;
    let gen = GEN.load(Ordering::SeqCst);
    blocking(move || status(&s.conn()?, gen)).await
}
pub fn status(c: &Conn, gen: u64) -> Result<Value, NbError> {
    let (_, v) = c.request("GET", "/api/status/", None, gen)?;
    let version = v.get("netbox-version").and_then(Value::as_str).unwrap_or("").to_string();
    if version.is_empty() {
        return Err(err("format", "Le serveur répond, mais pas comme NetBox (pas de « netbox-version » dans /api/status/)."));
    }
    let mut o = Map::new();
    o.insert("version".into(), json!(version));
    for (k, n) in [("netbox-full-version", "full"), ("django-version", "django"), ("python-version", "python"), ("rq-workers-running", "workers"), ("hostname", "hostname")] {
        if let Some(x) = v.get(k) {
            o.insert(n.into(), x.clone());
        }
    }
    o.insert("plugins".into(), json!(v.get("plugins").and_then(Value::as_object).map(|m| m.len()).unwrap_or(0)));
    o.insert("tls".into(), json!(c.base.starts_with("https://") && c.tls_verifies()));
    o.insert("url".into(), json!(c.base));
    Ok(Value::Object(o))
}
/// Lecture paginée : path (/api/…/), query [[clé, valeur]], max objets.
#[tauri::command]
pub async fn nb_get(app: AppHandle, path: String, query: Option<Vec<(String, String)>>, max: Option<u32>) -> Result<Value, NbError> {
    let s = store(&app)?;
    let gen = GEN.load(Ordering::SeqCst);
    blocking(move || s.conn()?.get_all(&path, &query.unwrap_or_default(), max.unwrap_or(MAX_OBJECTS), gen)).await
}
/// Écriture : POST (création, liste = groupée), PATCH (mise à jour), DELETE ; path /api/…/ ou /api/…/<id>/.
#[tauri::command]
pub async fn nb_write(app: AppHandle, method: String, path: String, body: Option<Value>) -> Result<Value, NbError> {
    let s = store(&app)?;
    let gen = GEN.load(Ordering::SeqCst);
    blocking(move || write(&s.conn()?, &method, &path, body.as_ref(), gen)).await
}
pub fn write(c: &Conn, method: &str, path: &str, body: Option<&Value>, gen: u64) -> Result<Value, NbError> {
    if !["POST", "PATCH", "PUT", "DELETE"].contains(&method) {
        return Err(err("url", format!("Méthode refusée : {method}")));
    }
    validate_path(path)?;
    let text = body.map(|b| b.to_string());
    if text.as_ref().is_some_and(|t| t.len() > 16 << 20) {
        return Err(err("format", "Envoi trop volumineux : découpez-le."));
    }
    Ok(c.request(method, path, text.as_deref(), gen)?.1)
}
/// Annule les lectures et attentes en cours (une écriture partie va à son terme).
#[tauri::command]
pub fn nb_cancel() {
    GEN.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    #[derive(Clone, Debug)]
    struct Req {
        line: String,
        headers: Vec<(String, String)>,
        body: String,
    }
    impl Req {
        fn header(&self, k: &str) -> Option<&str> {
            self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.as_str())
        }
    }
    type Handler = dyn Fn(&Req, usize, u16) -> (u16, Vec<(&'static str, String)>, String) + Send + Sync;
    /// Faux serveur HTTP (fil de test, std seulement) : une connexion par requête (Connection: close).
    fn mock(n: usize, h: Arc<Handler>) -> (String, Arc<Mutex<Vec<Req>>>, std::thread::JoinHandle<()>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(vec![]));
        let s2 = seen.clone();
        let t = std::thread::spawn(move || {
            for i in 0..n {
                let (mut sock, _) = l.accept().unwrap();
                let mut r = BufReader::new(sock.try_clone().unwrap());
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                let mut headers = vec![];
                loop {
                    let mut h = String::new();
                    r.read_line(&mut h).unwrap();
                    let h = h.trim_end().to_string();
                    if h.is_empty() {
                        break;
                    }
                    let (k, v) = h.split_once(':').unwrap();
                    headers.push((k.trim().to_string(), v.trim().to_string()));
                }
                let len = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-length")).map(|(_, v)| v.parse::<usize>().unwrap()).unwrap_or(0);
                let mut body = vec![0; len];
                r.read_exact(&mut body).unwrap();
                let req = Req { line: line.trim_end().into(), headers, body: String::from_utf8(body).unwrap() };
                let (status, extra, text) = h(&req, i, port);
                s2.lock().unwrap().push(req);
                let mut out = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n", text.len());
                for (k, v) in extra {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                out.push_str("\r\n");
                out.push_str(&text);
                sock.write_all(out.as_bytes()).unwrap();
                let _ = sock.flush();
            }
        });
        (format!("http://127.0.0.1:{port}"), seen, t)
    }
    fn conn(base: &str, token: &str) -> Conn {
        let mut c = Conn::new(base, token, true, None).unwrap();
        c.backoff = Duration::from_millis(5);
        c
    }
    fn g() -> u64 {
        GEN.load(Ordering::SeqCst)
    }

    #[test]
    fn adresse_https_exigee_et_normalisee() {
        assert_eq!(validate_base("https://NetBox.Example.org/", false).unwrap(), "https://netbox.example.org");
        assert_eq!(validate_base(" https://nb.local:8443/netbox/api/ ", false).unwrap(), "https://nb.local:8443/netbox");
        assert_eq!(validate_base("http://10.0.0.5:8000", true).unwrap(), "http://10.0.0.5:8000");
        assert_eq!(validate_base("http://10.0.0.5", false).unwrap_err().kind, "url");
        for bad in ["ftp://x", "https://user:pw@h", "https://h/?a=1", "https://h/#x", "https://h:99999", "https://h/../etc", "https://", "https://h b"] {
            assert!(validate_base(bad, true).is_err(), "{bad}");
        }
        assert_eq!(validate_base("https://[::1]:8443", false).unwrap(), "https://[::1]:8443");
    }
    #[test]
    fn chemins_limites_a_l_api() {
        assert!(validate_path("/api/dcim/devices/").is_ok());
        assert!(validate_path("/api/dcim/devices/12/").is_ok());
        for bad in ["/admin/", "/api/dcim/devices", "/api/../admin/", "/api/dcim//x/", "/api/a b/", "/api/x/?q=1/"] {
            assert!(validate_path(bad).is_err(), "{bad}");
        }
        assert_eq!(encode_query(&[("site_id".into(), "3".into()), ("q".into(), "a b&c".into())]).unwrap(), "?site_id=3&q=a%20b%26c");
        assert!(encode_query(&[("a&b".into(), "1".into())]).is_err());
    }
    #[test]
    fn jeton_v1_et_v2() {
        assert_eq!(auth_header("0123456789abcdef"), "Token 0123456789abcdef");
        assert_eq!(auth_header("nbt_4F9DAouzURLb.zjebxBPz"), "Bearer nbt_4F9DAouzURLb.zjebxBPz");
        assert!(validate_token("abc def ghi").is_err());
        assert!(validate_token("abc\r\nX-Evil: 1").is_err());
        assert!(validate_token("short").is_err());
    }
    #[test]
    fn tls_verifie_par_defaut() {
        let c = Conn::new("https://nb.example.org", "0123456789abcdef", true, None).unwrap();
        assert!(c.tls_verifies());
        let c = Conn::new("https://nb.example.org", "0123456789abcdef", false, None).unwrap();
        assert!(!c.tls_verifies());
        // Réglages absents : vérification active.
        let dir = std::env::temp_dir().join(format!("jollof-nb-{}", std::process::id()));
        let s = Store::new(dir.clone(), "sn.jollof.test");
        assert!(s.config().verify);
        assert_eq!(parse_ca("pas un certificat").unwrap_err().kind, "tls");
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn page_suivante_reste_sur_le_serveur() {
        let b = "https://nb.example.org/netbox";
        assert_eq!(next_path(b, "http://nb.example.org/netbox/api/dcim/devices/?limit=100&offset=100").as_deref(), Some("/api/dcim/devices/?limit=100&offset=100"));
        assert_eq!(next_path(b, "https://evil.example/netbox/api/dcim/devices/?offset=1").as_deref(), Some("/api/dcim/devices/?offset=1"));
        assert_eq!(next_path(b, "https://nb.example.org/admin/?x=1"), None);
        assert_eq!(next_path("https://h", "https://h/api/dcim/sites/?limit=2&offset=2").as_deref(), Some("/api/dcim/sites/?limit=2&offset=2"));
    }
    #[test]
    fn pagination_et_entete_d_authentification() {
        let h: Arc<Handler> = Arc::new(|r: &Req, i, port| {
            let next = |o: u32| format!("\"http://127.0.0.1:{port}/api/dcim/devices/?limit=2&offset={o}\"");
            assert!(r.line.starts_with("GET /api/dcim/devices/?"), "{}", r.line);
            match i {
                0 => {
                    assert!(r.line.contains("site_id=7") && r.line.contains("limit="), "{}", r.line);
                    (200, vec![], format!(r#"{{"count":5,"next":{},"previous":null,"results":[{{"id":1}},{{"id":2}}]}}"#, next(2)))
                }
                1 => (200, vec![], format!(r#"{{"count":5,"next":{},"previous":null,"results":[{{"id":3}},{{"id":4}}]}}"#, next(4))),
                _ => (200, vec![], r#"{"count":5,"next":null,"previous":null,"results":[{"id":5}]}"#.into()),
            }
        });
        let (base, seen, t) = mock(3, h);
        let c = conn(&base, "nbt_abc123.secretsecret");
        let v = c.get_all("/api/dcim/devices/", &[("site_id".into(), "7".into())], 1000, g()).unwrap();
        t.join().unwrap();
        let ids: Vec<u64> = v["results"].as_array().unwrap().iter().map(|x| x["id"].as_u64().unwrap()).collect();
        assert_eq!(ids, vec![1, 2, 3, 4, 5]);
        assert_eq!(v["count"], 5);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        for r in seen.iter() {
            assert_eq!(r.header("authorization"), Some("Bearer nbt_abc123.secretsecret"));
        }
        assert!(seen[2].line.contains("offset=4"));
    }
    #[test]
    fn plafond_d_objets() {
        let h: Arc<Handler> = Arc::new(|_r: &Req, _i, port| (200, vec![], format!(r#"{{"count":9,"next":"http://127.0.0.1:{port}/api/dcim/sites/?limit=3&offset=3","results":[{{"id":1}},{{"id":2}},{{"id":3}}]}}"#)));
        let (base, _seen, t) = mock(1, h);
        let v = conn(&base, "0123456789abcdef").get_all("/api/dcim/sites/", &[], 3, g()).unwrap();
        t.join().unwrap();
        assert_eq!(v["results"].as_array().unwrap().len(), 3);
        assert_eq!(v["truncated"], true);
    }
    #[test]
    fn reprise_sur_429_et_503() {
        let h: Arc<Handler> = Arc::new(|r: &Req, i, _| {
            assert_eq!(r.header("authorization"), Some("Token 0123456789abcdef"));
            match i {
                0 => (429, vec![("Retry-After", "0".into())], r#"{"detail":"Request was throttled."}"#.into()),
                1 => (503, vec![], "{}".into()),
                _ => (201, vec![], r#"{"id":42,"name":"S1"}"#.into()),
            }
        });
        let (base, seen, t) = mock(3, h);
        let v = write(&conn(&base, "0123456789abcdef"), "POST", "/api/dcim/sites/", Some(&json!({"name":"S1","slug":"s1"})), g()).unwrap();
        t.join().unwrap();
        assert_eq!(v["id"], 42);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        assert_eq!(seen[2].header("content-type"), Some("application/json"));
        assert!(seen[2].body.contains("\"slug\":\"s1\""));
    }
    #[test]
    fn post_non_rejoue_sur_502() {
        let h: Arc<Handler> = Arc::new(|_r: &Req, _i, _| (502, vec![], "Bad gateway".into()));
        let (base, seen, t) = mock(1, h);
        let e = write(&conn(&base, "0123456789abcdef"), "POST", "/api/dcim/sites/", Some(&json!({})), g()).unwrap_err();
        t.join().unwrap();
        assert_eq!((e.kind, e.status), ("server", 502));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
    #[test]
    fn erreurs_400_par_champ() {
        let h: Arc<Handler> = Arc::new(|_r: &Req, _i, _| (400, vec![], r#"{"slug":["This field may not be blank."],"name":["site with this name already exists."]}"#.into()));
        let (base, _s, t) = mock(1, h);
        let e = write(&conn(&base, "0123456789abcdef"), "POST", "/api/dcim/sites/", Some(&json!({"name":"S"})), g()).unwrap_err();
        t.join().unwrap();
        assert_eq!((e.kind, e.status), ("invalid", 400));
        assert_eq!(e.fields.len(), 2);
        assert!(e.fields.iter().any(|f| f.field == "slug" && f.msg == "This field may not be blank."));
        assert!(e.message.starts_with("Données refusées par NetBox : "));
        assert!(e.message.contains("champ « slug »"));
        // Écriture groupée : une liste, un dictionnaire par objet (vide s'il passe).
        let f = field_errors(&json!([{}, {"name": ["Required."]}, {"non_field_errors": ["Duplicate."]}]));
        assert_eq!(f, vec![
            FieldError { field: "name".into(), msg: "Required.".into(), index: Some(1) },
            FieldError { field: "".into(), msg: "Duplicate.".into(), index: Some(2) },
        ]);
        let m = http_error(400, r#"[{}, {"vid": ["Ensure this value is less than or equal to 4094."]}]"#, "/api/ipam/vlans/").message;
        assert!(m.contains("objet 2, champ « vid »"), "{m}");
    }
    #[test]
    fn autres_codes_en_francais() {
        assert_eq!(http_error(403, r#"{"detail":"Invalid token"}"#, "/api/dcim/sites/").kind, "auth");
        assert!(http_error(403, r#"{"detail":"Invalid token"}"#, "/api/dcim/sites/").message.contains("Invalid token"));
        assert_eq!(http_error(404, "{}", "/api/x/").kind, "notfound");
        assert_eq!(http_error(302, "", "/api/x/").kind, "redirect");
        assert_eq!(http_error(500, "<html>boom</html>", "/api/x/").kind, "server");
    }
    #[test]
    fn statut_et_reponse_non_netbox() {
        let h: Arc<Handler> = Arc::new(|r: &Req, i, _| {
            assert!(r.line.starts_with("GET /api/status/ "));
            if i == 0 {
                (200, vec![], r#"{"django-version":"5.2.6","installed_apps":{},"netbox-version":"4.5.2","netbox-full-version":"4.5.2-Docker","plugins":{"netbox_bgp":"0.15"},"python-version":"3.12.3","rq-workers-running":1,"hostname":"nb1"}"#.into())
            } else {
                (200, vec![], "<html>Welcome to nginx</html>".into())
            }
        });
        let (base, _s, t) = mock(2, h);
        let c = conn(&base, "0123456789abcdef");
        let v = status(&c, g()).unwrap();
        assert_eq!(v["version"], "4.5.2");
        assert_eq!(v["plugins"], 1);
        assert_eq!(v["tls"], false);
        let e = status(&c, g()).unwrap_err();
        t.join().unwrap();
        assert_eq!(e.kind, "format");
    }
    #[test]
    fn aucune_redirection_suivie() {
        let h: Arc<Handler> = Arc::new(|_r: &Req, _i, _| (302, vec![("Location", "https://elsewhere.example/api/status/".into())], String::new()));
        let (base, seen, t) = mock(1, h);
        let e = status(&conn(&base, "0123456789abcdef"), g()).unwrap_err();
        t.join().unwrap();
        assert_eq!(e.kind, "redirect");
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
    #[test]
    fn reglages_sans_jeton_dans_le_fichier() {
        let dir = std::env::temp_dir().join(format!("jollof-nb-set-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = Store::new(dir.clone(), "sn.jollof.test");
        let st = s.set("https://nb.example.org/", true, false, None, Some("0123456789abcdef0123")).unwrap();
        assert!(st.has_token && st.verify && !st.consented);
        assert_eq!(st.url, "https://nb.example.org");
        let cfg = std::fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!cfg.contains("0123456789abcdef0123"), "jeton absent de netbox.json");
        let json = serde_json::to_string(&s.settings()).unwrap();
        assert!(!json.contains("0123456789abcdef0123"), "jeton jamais rendu à la fenêtre");
        assert!(s.consent("https://other.example").is_err());
        s.consent("https://nb.example.org").unwrap();
        assert!(s.settings().consented);
        // Autre serveur : le jeton est oublié.
        let st = s.set("https://nb2.example.org", true, false, None, None).unwrap();
        assert!(!st.has_token && !st.consented);
        assert!(s.set("http://nb2.example.org", true, false, None, None).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
