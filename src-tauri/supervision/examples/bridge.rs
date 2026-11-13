// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Pont de développement : sert les commandes de la supervision en HTTP local (POST /<commande>, corps JSON), pour
//! essayer l'interface dans un navigateur sans l'application Tauri. Même code que l'application : `Session::handle`.
//! `cargo run --example bridge -- 1439`. Jamais inclus dans l'application.
use jollof_supervision::api::Session;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

fn main() -> std::io::Result<()> {
    let port = std::env::args().nth(1).unwrap_or_else(|| "1439".into());
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))?;
    println!("supervision bridge on 127.0.0.1:{port}");
    let mut session = Session::default();
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut first = String::new();
        if reader.read_line(&mut first).is_err() {
            continue;
        }
        let mut parts = first.split_whitespace();
        let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
        let mut len = 0usize;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                break;
            }
            if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; len];
        if reader.read_exact(&mut body).is_err() {
            continue;
        }
        let reply = if method == "POST" {
            let args: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            match session.handle(path.trim_start_matches('/'), &args) {
                Ok(v) => json!({ "ok": v }),
                Err(e) => json!({ "error": e.to_string() }),
            }
        } else {
            Value::Null
        };
        let text = reply.to_string();
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            text.len(),
            text
        );
    }
    Ok(())
}
