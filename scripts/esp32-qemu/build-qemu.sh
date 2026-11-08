#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
#
# Construit l'émulateur de l'ESP32 du mode fidèle : qemu-system-xtensa, tiré du fork de QEMU d'Espressif
# (GPL-2.0), à un commit figé. Ce script ne fait que le compiler et l'empaqueter : QEMU reste un programme à part,
# lancé par l'application, jamais lié à elle.
#
# Ce que fait le script :
#   1. récupère les sources au commit figé (vérifié) ;
#   2. configure le strict nécessaire : machine xtensa (ESP32) seule, sans interface graphique, sans réseau ;
#   3. compile et installe dans un dossier de travail ;
#   4. empaquette : l'exécutable, les ROM de l'ESP32, les bibliothèques non fournies par le système (rendues
#      relogeables : @loader_path sur macOS, $ORIGIN sur Linux, à côté du .exe sur Windows), les licences,
#      SOURCE.md (commit exact, options, ce script) ; puis une archive .zip et la liste de ses empreintes SHA-256.
#
# Plateformes : macOS (x86_64, arm64), Linux (x86_64, aarch64), Windows dans MSYS2 MINGW64 (construction statique).
# Prérequis : git, python3 (>= 3.8), ninja, pkg-config, un compilateur C, glib-2.0 (>= 2.66), pixman, libgcrypt ;
#   macOS : brew install glib pixman libgcrypt ninja pkgconf
#   Debian/Ubuntu : apt install build-essential git python3 python3-venv ninja-build pkg-config libglib2.0-dev
#                   libpixman-1-dev libgcrypt20-dev patchelf
#   MSYS2 MINGW64 : pacman -S git mingw-w64-x86_64-{gcc,glib2,libgcrypt,libiconv,ninja,pixman,pkg-config,python}
#
# Variables : WORK (dossier de travail, défaut ./qemu-build), JOBS, PLATFORM (sinon déduite), PYTHON,
#   CODESIGN_IDENTITY (macOS : identité de signature ; défaut « - », signature ad hoc), SOURCE_TARBALL=1 (archive
#   aussi les sources compilées, à publier avec les binaires), EXTRA_PKG_CONFIG_PATH (bibliothèques hors du système).
set -euo pipefail

QEMU_REPO="${QEMU_REPO:-https://github.com/espressif/qemu.git}"
QEMU_TAG="esp-develop-9.2.2-20250817"
QEMU_COMMIT="4f4148e2f68689eb8861bf9fce0b46ada9200fef"
JOLLOF_REV="j1"   # révision de notre construction (ce script, ses options) ; à changer si l'un ou l'autre change

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$PWD/qemu-build}"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
PYTHON="${PYTHON:-python3}"

detect_platform() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-x86_64) echo x86_64-apple-darwin ;;
    Darwin-arm64) echo aarch64-apple-darwin ;;
    Linux-x86_64) echo x86_64-linux-gnu ;;
    Linux-aarch64) echo aarch64-linux-gnu ;;
    MINGW64*-x86_64 | MSYS*-x86_64) echo x86_64-w64-mingw32 ;;
    *) echo "Plateforme non prise en charge : $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
}
PLATFORM="${PLATFORM:-$(detect_platform)}"
VERSION="${QEMU_TAG#esp-develop-}-${JOLLOF_REV}"          # 9.2.2-20250817-j1
NAME="jollof-qemu-esp32-${VERSION}-${PLATFORM}"
EXE="qemu-system-xtensa"; [[ "$PLATFORM" == *mingw32 ]] && EXE="qemu-system-xtensa.exe"
SRC="$WORK/src"; BUILD="$SRC/build"; STAGE="$WORK/stage"; PKG="$WORK/pkg/qemu"; DIST="$WORK/dist"
[ -n "${EXTRA_PKG_CONFIG_PATH:-}" ] && export PKG_CONFIG_PATH="${EXTRA_PKG_CONFIG_PATH}${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
log() { printf '\n== %s\n' "$*"; }

# ---------- 1. Sources au commit figé ----------
log "Sources : $QEMU_REPO $QEMU_TAG ($QEMU_COMMIT)"
mkdir -p "$WORK"
if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$QEMU_REPO"
fi
if [ "$(git -C "$SRC" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$QEMU_COMMIT" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "refs/tags/$QEMU_TAG:refs/tags/$QEMU_TAG"
  git -C "$SRC" checkout -q --force "$QEMU_TAG^{commit}"
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$QEMU_COMMIT" ] || { echo "Le tag $QEMU_TAG ne pointe plus sur $QEMU_COMMIT : arrêt." >&2; exit 1; }

# Changements du système de construction seulement (aucun changement du code de l'émulateur), notés dans SOURCE.md.
PATCHES=()
# Le fork déclare la dépendance slirp même quand elle est désactivée (declare_dependency toujours « trouvée ») :
# net/slirp.c serait compilé sans libslirp. On ne la déclare que si libslirp est trouvée.
"$PYTHON" - "$SRC/meson.build" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
a = "  slirp = declare_dependency(dependencies: [slirp_dep],"
b = "  slirp = not slirp_dep.found() ? not_found : declare_dependency(dependencies: [slirp_dep],"
if a in s and b not in s: open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
PATCHES+=("meson.build : la dépendance slirp n'est déclarée que si libslirp est trouvée (réseau désactivé)")
# Contournements pour macOS, repris des scripts d'intégration continue d'Espressif.
if [[ "$PLATFORM" == *apple-darwin ]]; then
  "$PYTHON" - "$SRC/meson.build" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read(); t = s
t = t.replace("project('qemu', ['c'],", "project('qemu', ['c', 'objc'],", 1)
t = t.replace("common_user_inc = []", "common_user_inc = ['include', 'build']", 1)
if t != s: open(p, 'w', encoding='utf-8').write(t)
PY
  PATCHES+=("meson.build : langage objc ajouté au projet, common_user_inc = ['include', 'build'] (comme configure-macos.sh d'Espressif)")
fi

# ---------- 2. Configuration ----------
log "Configuration ($PLATFORM)"
CONF=(
  --prefix="$STAGE" --bindir=bin --datadir=share/qemu --with-suffix=""
  --target-list=xtensa-softmmu
  --without-default-features
  --enable-gcrypt --enable-pixman --enable-stack-protector
  --with-pkgversion="jollof-$VERSION"
  --python="$PYTHON"
)
[[ "$PLATFORM" == *mingw32 ]] && CONF+=(--static)
if [ ! -f "$BUILD/build.ninja" ] || [ "${RECONFIGURE:-0}" = 1 ]; then
  rm -rf "$BUILD"
  (cd "$SRC" && ./configure "${CONF[@]}") || { cat "$BUILD/meson-logs/meson-log.txt" 2>/dev/null | tail -60; exit 1; }
  if [[ "$PLATFORM" == *mingw32 ]]; then
    # Construction statique dans MSYS2 : meson ne donne pas le chemin Windows de libintl et libiconv (même
    # contournement que configure-win.sh d'Espressif).
    MSYS_BASE="$(cygpath -w / | sed 's/\\/\//g')"
    sed -i "s|/mingw64/lib/libintl.dll.a|${MSYS_BASE}/mingw64/lib/libintl.dll.a|g; s|/mingw64/lib/libiconv.dll.a|${MSYS_BASE}/mingw64/lib/libiconv.dll.a|g" "$BUILD/build.ninja"
  fi
fi

# ---------- 3. Compilation ----------
log "Compilation ($JOBS tâches)"
ninja -C "$BUILD" -j "$JOBS" install

# ---------- 4. Paquet ----------
log "Paquet $NAME"
rm -rf "$WORK/pkg"; mkdir -p "$PKG/bin" "$PKG/share/qemu" "$PKG/lib" "$DIST"
cp "$STAGE/bin/$EXE" "$PKG/bin/"
cp "$STAGE/share/qemu/esp32-v3-rom.bin" "$STAGE/share/qemu/esp32-v3-rom-app.bin" "$PKG/share/qemu/"
BUNDLED=()

# Bibliothèques hors du système, copiées à côté et rendues relogeables.
bundle_macos() {
  local queue=("$PKG/bin/$EXE") f dep base id
  while [ ${#queue[@]} -gt 0 ]; do
    f="${queue[0]}"; queue=("${queue[@]:1}")
    id="$(otool -D "$f" 2>/dev/null | tail -n +2 | head -1 || true)"
    while read -r dep; do
      [ -z "$dep" ] && continue
      [ "$dep" = "$id" ] && continue
      case "$dep" in /usr/lib/* | /System/* | @executable_path/* | @loader_path/*) continue ;; esac
      case "$dep" in @rpath/*) echo "Dépendance @rpath non résolue : $dep ($f)" >&2; exit 1 ;; esac
      base="$(basename "$dep")"
      if [ ! -f "$PKG/lib/$base" ]; then
        cp -L "$dep" "$PKG/lib/$base"; chmod u+w "$PKG/lib/$base"
        install_name_tool -id "@loader_path/$base" "$PKG/lib/$base"
        queue+=("$PKG/lib/$base"); BUNDLED+=("$base")
      fi
      if [ "$f" = "$PKG/bin/$EXE" ]; then install_name_tool -change "$dep" "@executable_path/../lib/$base" "$f"
      else install_name_tool -change "$dep" "@loader_path/$base" "$f"; fi
    done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
  done
  # Signature (ad hoc par défaut : obligatoire sur Apple Silicon). Identité réelle : runtime renforcé, avec le droit
  # de générer du code (le traducteur TCG de QEMU écrit et exécute du code machine).
  local ident="${CODESIGN_IDENTITY:--}" ent="$WORK/qemu.entitlements" sign=()
  cat > "$ent" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
XML
  [ "$ident" != "-" ] && sign=(--options runtime --timestamp)
  for f in "$PKG"/lib/*.dylib; do [ -e "$f" ] && codesign --force --sign "$ident" ${sign[@]+"${sign[@]}"} "$f"; done
  codesign --force --sign "$ident" ${sign[@]+"${sign[@]}"} --entitlements "$ent" "$PKG/bin/$EXE"
}
bundle_linux() {
  command -v patchelf >/dev/null || { echo "patchelf est nécessaire (apt install patchelf)" >&2; exit 1; }
  local so base
  while read -r so; do
    base="$(basename "$so")"
    case "$base" in   # glibc et la bibliothèque d'exécution du compilateur viennent du système
      ld-linux* | libc.so* | libm.so* | libdl.so* | libpthread.so* | librt.so* | libresolv.so* | libutil.so* | libgcc_s.so* | libstdc++.so*) continue ;;
    esac
    cp -L "$so" "$PKG/lib/$base"; chmod u+w "$PKG/lib/$base"; BUNDLED+=("$base")
    patchelf --set-rpath '$ORIGIN' "$PKG/lib/$base"
  done < <(ldd "$PKG/bin/$EXE" | awk '/=> \// {print $3}')
  patchelf --set-rpath '$ORIGIN/../lib' "$PKG/bin/$EXE"
}
bundle_windows() {
  # Construction statique : seules restent d'éventuelles DLL de MinGW, posées à côté du .exe.
  local dll
  while read -r dll; do
    cp "$dll" "$PKG/bin/"; BUNDLED+=("$(basename "$dll")")
  done < <(ldd "$PKG/bin/$EXE" | awk '/=> \/mingw64\// {print $3}')
  rmdir "$PKG/lib" 2>/dev/null || true
}
case "$PLATFORM" in
  *apple-darwin) bundle_macos ;;
  *linux-gnu) bundle_linux ;;
  *mingw32) bundle_windows ;;
esac
[ -d "$PKG/lib" ] && rmdir "$PKG/lib" 2>/dev/null || true

# Licences et provenance.
cp "$SRC/COPYING" "$PKG/COPYING"; cp "$SRC/COPYING.LIB" "$PKG/COPYING.LIB"; cp "$SRC/LICENSE" "$PKG/LICENSE"
cp "${BASH_SOURCE[0]}" "$PKG/build-qemu.sh"
libver() { pkg-config --modversion "$1" 2>/dev/null || echo "?"; }
{
  echo "# Sources of this QEMU build (Jollof Studio, ESP32 faithful mode)"
  echo
  echo "This package is QEMU, Espressif's fork, licensed under the GNU GPL version 2 (see COPYING and LICENSE)."
  echo "It is a separate program started by Jollof Studio; it is not linked with it."
  echo
  echo "- Upstream: $QEMU_REPO"
  echo "- Tag: $QEMU_TAG"
  echo "- Commit: $QEMU_COMMIT"
  echo "- Build: jollof-$VERSION, platform $PLATFORM, $(date -u +%Y-%m-%d)"
  echo "- Build script: build-qemu.sh (included in this package; also scripts/esp32-qemu/build-qemu.sh in the Jollof Studio repository)"
  echo "- Configure options: ${CONF[*]//$STAGE/<prefix>}"
  echo "- Changes to the upstream sources: ${PATCHES[*]-none}"
  echo
  echo "The complete corresponding source code is the upstream commit above, plus the build-system changes listed,"
  echo "built with this script. It is published next to this binary as jollof-qemu-esp32-$VERSION-source.tar.gz"
  echo "(same download page). Write to the Jollof Studio maintainers to receive it on request for three years."
  echo
  echo "## Bundled libraries"
  echo
  if [ ${#BUNDLED[@]} -eq 0 ]; then echo "None (static build)."; else
    echo "| File | Library | Version | License |"
    echo "|---|---|---|---|"
    for b in ${BUNDLED[@]+"${BUNDLED[@]}"}; do
      case "$b" in
        libglib*) echo "| $b | GLib | $(libver glib-2.0) | LGPL-2.1-or-later |" ;;
        libpcre2*) echo "| $b | PCRE2 | $(libver libpcre2-8) | BSD-3-Clause |" ;;
        libintl*) echo "| $b | GNU gettext (libintl) | ? | LGPL-2.1-or-later |" ;;
        libpixman*) echo "| $b | pixman | $(libver pixman-1) | MIT |" ;;
        libgcrypt*) echo "| $b | libgcrypt | $(libver libgcrypt) | LGPL-2.1-or-later |" ;;
        libgpg-error*) echo "| $b | libgpg-error | $(libver gpg-error) | LGPL-2.1-or-later |" ;;
        libz*) echo "| $b | zlib | $(libver zlib) | Zlib |" ;;
        libffi*) echo "| $b | libffi | $(libver libffi) | MIT |" ;;
        libiconv*) echo "| $b | GNU libiconv | ? | LGPL-2.1-or-later |" ;;
        *) echo "| $b | ? | ? | see upstream |" ;;
      esac
    done
    echo
    echo "LGPL libraries are dynamically linked and can be replaced. Their sources are available from their"
    echo "upstream projects (GLib: https://download.gnome.org/sources/glib/, libgcrypt and libgpg-error:"
    echo "https://gnupg.org/ftp/gcrypt/, gettext: https://ftp.gnu.org/gnu/gettext/) at the versions listed."
  fi
  echo
  echo "## ESP32 ROM images"
  echo
  echo "share/qemu/esp32-v3-rom.bin and esp32-v3-rom-app.bin are Espressif's ESP32 mask ROM, shipped by the fork in"
  echo "pc-bios/. Copyright (c) Espressif Systems (Shanghai) Co. Ltd. Espressif publishes the same ROMs (as ELF"
  echo "files, https://github.com/espressif/esp-rom-elfs) under the Apache License 2.0."
} > "$PKG/SOURCE.md"

# Archive .zip (droits d'exécution gardés) et empreintes.
rm -f "$DIST/$NAME.zip"
"$PYTHON" - "$WORK/pkg" "$DIST/$NAME.zip" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for d, dirs, files in os.walk(root):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, root))
PY
if [ "${SOURCE_TARBALL:-0}" = 1 ]; then
  log "Archive des sources"
  tar -C "$WORK" --exclude=src/build --exclude=src/.git -czf "$DIST/jollof-qemu-esp32-$VERSION-source.tar.gz" src
fi
"$PYTHON" - "$DIST" <<'PY'
import hashlib, os, sys
d = sys.argv[1]
lines = []
for f in sorted(os.listdir(d)):
    if f.endswith(('.zip', '.tar.gz')):
        h = hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest()
        lines.append(f"{h}  {f}")
open(os.path.join(d, 'SHA256SUMS.txt'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
PY
log "Terminé : $DIST/$NAME.zip"
