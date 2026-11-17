// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
fn main() {
    // Cible de compilation : sert à trouver ffmpeg (src-tauri/binaries/ffmpeg-<cible>) en développement.
    println!(
        "cargo:rustc-env=JOLLOF_TARGET={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    tauri_build::build()
}
