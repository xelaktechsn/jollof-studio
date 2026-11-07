#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Mamadou Sarr
#
# Miroir local des fichiers de cartes Arduino pour le boîtier école (feuille de route 1.7 : « les
# fichiers des cartes servis par le serveur de l'école »). Télécharge les cœurs AVR (Uno, Nano) et
# RP2040 (Pico), leurs outils (compilateurs, avrdude…), les outils intégrés d'arduino-cli et les
# bibliothèques connues de Jollof Studio (LIBS de src/emu/compile.js, avec leurs dépendances), puis
# écrit des index qui pointent vers le boîtier :
#   DEST/package_jollof_index.json   index des cartes (arduino-cli : board_manager.additional_urls)
#   DEST/library_index.json          index des bibliothèques (format de celui d'Arduino)
#   DEST/packages/, DEST/libraries/  archives, vérifiées (taille et SHA-256 des index d'origine)
#   DEST/mirror-info.json            résumé (date, adresse, versions)
# Le service « toolchain » de docker-compose.box.yml sert DEST sur le port 8080 (README, « Miroir des
# fichiers de cartes »).
#
#   ./mirror.sh --dry-run                               liste et taille, sans rien télécharger
#                                                       d'autre que les index (~10 Mo)
#   ./mirror.sh --base-url http://192.168.1.50:8080     téléchargement (plusieurs centaines de Mo)
#   ./mirror.sh --offline --base-url http://…           réécrit les index pour une autre adresse,
#                                                       sans Internet (dossier déjà rempli)
#
# Prérequis : bash, curl, jq, gzip, sha256sum (ou shasum). Le téléchargement est gros : le faire sur
# un PC bien connecté, copier le dossier sur le boîtier (clé USB), puis y relancer
# « mirror.sh --offline --base-url … » avec l'adresse du boîtier. Relancer le script ne retélécharge
# que ce qui manque ; les archives qui ne servent plus sont supprimées.
set -eu
set -o pipefail

HERE=$(cd -P "$(dirname "$0")" && pwd)
DEST=$HERE/mirror
BASE_URL=http://jollof-ecole.local:8080
HOSTS=windows,linux
BUILTIN=all
WITH_LIBS=1
OFFLINE=0
DRY=0
PLATFORMS=()
EXTRA_INDEXES=()
ARDUINO_INDEX=https://downloads.arduino.cc/packages/package_index.json
RP2040_INDEX=https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
LIB_INDEX=https://downloads.arduino.cc/libraries/library_index.json.gz
# Repli si src/emu/compile.js n'est pas là (dossier copié seul sur le boîtier) : garder à jour avec LIBS.
DEFAULT_LIBS=('DHT sensor library' 'Adafruit Unified Sensor' 'OneWire' 'DallasTemperature'
  'Adafruit BMP280 Library' 'Adafruit MPU6050' 'LiquidCrystal I2C' 'Adafruit SSD1306'
  'Adafruit GFX Library' 'Servo' 'Adafruit NeoPixel' 'Stepper' 'Keypad' 'IRremote' 'MFRC522' 'RF24')

info() { printf '==> %s\n' "$*"; }
warn() { printf 'Attention : %s\n' "$*" >&2; }
die() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Miroir local des fichiers de cartes Arduino (AVR, RP2040) et des bibliothèques de Jollof Studio.

Usage : $0 [options]

  --dest DOSSIER       dossier du miroir (défaut : $HERE/mirror)
  --base-url URL       adresse où le boîtier sert ce dossier (défaut : $BASE_URL)
  --hosts LISTE        systèmes des postes : windows, linux, macos, linux-arm64
                       (défaut : $HOSTS, ~950 Mo ; avec macos ~1,7 Go) ; les autres
                       systèmes gardent l'adresse d'origine (Internet)
  --platform P:A[@V]   plateforme à copier, répétable (défaut : arduino:avr et rp2040:rp2040,
                       dernière version) ; ex. --platform arduino:avr@1.8.6
  --index URL          index de cartes supplémentaire (ex. ESP32), répétable
  --builtin all|latest|none
                       outils intégrés d'arduino-cli (serial-discovery, ctags…) : toutes les versions
                       (défaut, chaque version d'arduino-cli demande la sienne), la dernière, aucun
  --no-libs            sans les bibliothèques
  --offline            sans Internet : réutilise les index déjà téléchargés (DEST/.sources) et
                       vérifie que les archives sont là
  --dry-run            affiche ce qui serait téléchargé et la taille totale, sans rien écrire
  -h, --help           cette aide
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --dest) [ $# -ge 2 ] || die "--dest attend un dossier"; DEST=$2; shift ;;
    --base-url) [ $# -ge 2 ] || die "--base-url attend une adresse"; BASE_URL=$2; shift ;;
    --hosts) [ $# -ge 2 ] || die "--hosts attend une liste"; HOSTS=$2; shift ;;
    --platform) [ $# -ge 2 ] || die "--platform attend P:A[@V]"; PLATFORMS+=("$2"); shift ;;
    --index) [ $# -ge 2 ] || die "--index attend une adresse"; EXTRA_INDEXES+=("$2"); shift ;;
    --builtin) [ $# -ge 2 ] || die "--builtin attend all, latest ou none"; BUILTIN=$2; shift ;;
    --no-libs) WITH_LIBS=0 ;;
    --offline) OFFLINE=1 ;;
    --dry-run) DRY=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "option inconnue : $1 (voir --help)" ;;
  esac
  shift
done
[ ${#PLATFORMS[@]} -gt 0 ] || PLATFORMS=(arduino:avr rp2040:rp2040)
case $BUILTIN in all | latest | none) ;; *) die "--builtin : all, latest ou none" ;; esac
case $BASE_URL in http://* | https://*) BASE_URL=${BASE_URL%/} ;; *) die "--base-url doit commencer par http:// ou https://" ;; esac
case $DEST in /*) ;; *) DEST=$(pwd)/$DEST ;; esac
for c in curl jq gzip; do command -v "$c" >/dev/null 2>&1 || die "$c est nécessaire (apt install $c / brew install $c)."; done
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "sha256sum (ou shasum) est nécessaire."
fi
fsize() { wc -c <"$1" | tr -d ' '; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SOURCES=$DEST/.sources
[ "$DRY" = 1 ] && SOURCES=$WORK/sources

# Noms des bibliothèques : LIBS de src/emu/compile.js (dépôt complet), sinon la liste ci-dessus.
lib_names() {
  local js=$HERE/../../src/emu/compile.js names=''
  if [ -f "$js" ]; then
    names=$(sed -n '/^export const LIBS = {/,/^};/p' "$js" | grep -o "\[[^]]*\]" | grep -o "'[^']*'" | tr -d "'" | sort -u || true)
    [ -n "$names" ] || warn "LIBS introuvable dans $js : liste intégrée utilisée."
  fi
  if [ -z "$names" ]; then names=$(printf '%s\n' "${DEFAULT_LIBS[@]}"); fi
  printf '%s\n' "$names"
}

# --- 1. Index d'origine -------------------------------------------------------------------------

fetch() { # fetch URL FICHIER
  if [ "$OFFLINE" = 1 ]; then
    [ -s "$SOURCES/$2" ] || die "--offline : $SOURCES/$2 manque (lancer d'abord le script avec Internet)."
    return 0
  fi
  info "Index : $1"
  curl -fsSL --retry 3 --connect-timeout 20 -o "$WORK/$2" "$1" || die "téléchargement impossible : $1"
  mkdir -p "$SOURCES"
  mv "$WORK/$2" "$SOURCES/$2"
}

PKG_FILES=()
i=0
for url in "$ARDUINO_INDEX" "$RP2040_INDEX" ${EXTRA_INDEXES[@]+"${EXTRA_INDEXES[@]}"}; do
  i=$((i + 1))
  f=$(printf '%02d-%s' "$i" "$(basename "${url%%\?*}")")
  fetch "$url" "$f"
  PKG_FILES+=("$SOURCES/$f")
done
if [ "$WITH_LIBS" = 1 ]; then fetch "$LIB_INDEX" library_index.json.gz; fi

# --- 2. Choix des fichiers et index réécrits (jq) ----------------------------------------------

# Programmes jq entre apostrophes : leurs $variables sont celles de jq, pas du shell.
# shellcheck disable=SC2016
JQ_COMMON='
# Clé de tri des versions : 1.8.10 > 1.8.9, et 2.0.0 > 2.0.0-rc1.
def vkey: tostring | split("-") as $p
  | ($p[0] | split(".") | map(tonumber? // 0)) + [if ($p | length) > 1 then 0 else 1 end];
'

# Variantes copiées d'un outil, selon les systèmes des postes. arduino-cli prend la variante exacte
# de son système, sinon une compatible (Windows 64 bits : 32 bits ; Mac Apple : Intel).
# shellcheck disable=SC2016
JQ_PACKAGES=$JQ_COMMON'
def pick($fam):
  if $fam == "windows" then
    [.[] | select(.host | test("^(x86_64|amd64)-.*mingw32"))] as $a
    | if ($a | length) > 0 then $a else [.[] | select(.host | test("^i[3-6]86-.*mingw32"))] end
  elif $fam == "macos" then
    [.[] | select(.host | test("^(x86_64|arm64)-apple-darwin"))] as $a
    | if ($a | length) > 0 then $a else [.[] | select(.host | test("apple-darwin"))] end
  elif $fam == "linux" then [.[] | select(.host | test("^(x86_64|amd64)-(pc-|unknown-)?linux-gnu"))]
  elif $fam == "linux-arm64" then [.[] | select(.host | test("^(aarch64|arm64)-(unknown-)?linux-gnu"))]
  else error("système inconnu dans --hosts : \($fam)") end;
def mirrored: [. as $sys | $fams[] as $f | $sys | pick($f)[]] | unique_by(.host);
def local_url($dir): $base + "/" + $dir + "/" + .archiveFileName;

([.[].packages[]]) as $pkgs
| [$specs[] | (capture("^(?<p>[^:@]+):(?<a>[^:@]+)(@(?<v>.+))?$") // error("plateforme mal écrite : \(.)"))] as $sp
| [$sp[] as $s
    | [$pkgs[] | select(.name == $s.p) | .platforms[]? | select(.architecture == $s.a)] as $rels
    | (if $s.v then [$rels[] | select(.version == $s.v)][0] else ($rels | max_by(.version | vkey)) end) as $r
    | if $r == null then error("plateforme introuvable dans les index : \($s.p):\($s.a)\(if $s.v then "@" + $s.v else "" end)")
      else {packager: $s.p, release: $r} end] as $plats
| [$plats[].release | ((.toolsDependencies // []) + (.discoveryDependencies // []) + (.monitorDependencies // []))[]
    | {packager, name, version: (.version // null)}] as $deps
| (if $builtin == "none" then []
   else [$pkgs[] | select(.name == "builtin") | .tools[]?] | group_by(.name)
     | map(if $builtin == "all" then .[] else max_by(.version | vkey) end)
     | map({packager: "builtin", name, version})
   end) as $bdeps
| [($deps + $bdeps | unique)[] as $d
    | [$pkgs[] | select(.name == $d.packager) | .tools[]? | select(.name == $d.name)] as $c
    | (if $d.version then [$c[] | select(.version == $d.version)][0] else ($c | max_by(.version | vkey)) end) as $t
    | if $t == null then {missing: "\($d.packager):\($d.name)@\($d.version // "?")"} else {packager: $d.packager, tool: $t} end] as $tr
| ([$tr[] | select(.tool)] | unique_by([.packager, .tool.name, .tool.version])) as $tools
| ([$plats[].packager] + [$tools[].packager] | unique) as $packagers
| {
    index: {packages: [$packagers[] as $pn
      | ([$pkgs[] | select(.name == $pn)][0]) as $src
      | {name: $pn, maintainer: $src.maintainer, websiteURL: $src.websiteURL, email: $src.email, help: $src.help,
         platforms: [$plats[] | select(.packager == $pn) | .release | .url = local_url("packages")],
         tools: [$tools[] | select(.packager == $pn) | .tool
           | ([.systems | mirrored[] | .host]) as $h
           | .systems |= map(if (.host | IN($h[])) then .url = local_url("packages") else . end)]}
      | with_entries(select(.value != null))]},
    files: ([$plats[].release | {dir: "packages", url, name: .archiveFileName, checksum, size, what: "\(.name // .architecture) \(.version)"}]
      + [$tools[] | .tool as $t | $t.systems | mirrored[]
         | {dir: "packages", url, name: .archiveFileName, checksum, size, what: "\($t.name) \($t.version) (\(.host))"}]),
    platforms: [$plats[] | "\(.packager):\(.release.architecture)@\(.release.version)"],
    missing: [$tr[] | select(.missing) | .missing]
  }
'

# shellcheck disable=SC2016
JQ_LIBS=$JQ_COMMON'
(.libraries | group_by(.name) | map({key: .[0].name, value: max_by(.version | vkey)}) | from_entries) as $latest
| {todo: $names, done: {}, missing: []}
| until((.todo | length) == 0;
    .todo[0] as $n | .todo |= .[1:]
    | if (.done | has($n)) or any(.missing[]; . == $n) then .
      elif $latest[$n] == null then .missing += [$n]
      else .done[$n] = $latest[$n] | .todo += [($latest[$n].dependencies // [])[].name]
      end)
| ([.done[]] | sort_by(.name)) as $libs
| {
    index: {libraries: [$libs[] | .url = ($base + "/libraries/" + .archiveFileName)]},
    files: [$libs[] | {dir: "libraries", url, name: .archiveFileName, checksum, size, what: "\(.name) \(.version)"}],
    libraries: [$libs[] | "\(.name)@\(.version)"],
    missing: .missing
  }
'

specs=$(printf '%s\n' "${PLATFORMS[@]}" | jq -R . | jq -cs .)
fams=$(printf '%s' "$HOSTS" | tr ',' '\n' | sed '/^$/d' | jq -R . | jq -cs .)
info "Choix des fichiers (plateformes : ${PLATFORMS[*]} ; postes : $HOSTS)…"
jq -s --argjson specs "$specs" --argjson fams "$fams" --arg base "$BASE_URL" --arg builtin "$BUILTIN" \
  "$JQ_PACKAGES" "${PKG_FILES[@]}" >"$WORK/plan-packages.json"
if [ "$WITH_LIBS" = 1 ]; then
  names=$(lib_names | jq -R . | jq -cs .)
  gzip -dc "$SOURCES/library_index.json.gz" \
    | jq --argjson names "$names" --arg base "$BASE_URL" "$JQ_LIBS" >"$WORK/plan-libraries.json"
else
  echo '{"index":{"libraries":[]},"files":[],"libraries":[],"missing":[]}' >"$WORK/plan-libraries.json"
fi
jq -r '.missing[] | "introuvable dans les index : " + .' "$WORK/plan-packages.json" "$WORK/plan-libraries.json" \
  | while read -r m; do warn "$m"; done

# Une ligne par archive (même nom = même fichier ; deux contenus pour un nom serait une erreur).
jq -rs '[.[].files[]] | unique_by([.dir, .name, .checksum]) | .[] | [.dir, .name, .url, .checksum, (.size | tostring), .what] | @tsv' \
  "$WORK/plan-packages.json" "$WORK/plan-libraries.json" >"$WORK/files.tsv"
dup=$(cut -f 1,2 "$WORK/files.tsv" | sort | uniq -d | head -n 1)
[ -z "$dup" ] || die "deux archives différentes portent le même nom : $dup"
count=$(wc -l <"$WORK/files.tsv" | tr -d ' ')
total=$(awk -F '\t' '{ s += $5 } END { printf "%.0f", s / 1048576 }' "$WORK/files.tsv")

if [ "$DRY" = 1 ]; then
  echo
  echo "Plateformes : $(jq -r '.platforms | join(", ")' "$WORK/plan-packages.json")"
  [ "$WITH_LIBS" = 0 ] || echo "Bibliothèques : $(jq -r '.libraries | join(", ")' "$WORK/plan-libraries.json")"
  echo
  awk -F '\t' '{ printf "  %8.1f Mo  %-10s %s\n", $5 / 1048576, $1, $6 }' "$WORK/files.tsv"
  echo
  awk -F '\t' '{ s[$1] += $5 } END { for (d in s) printf "  %-10s %8.0f Mo\n", d, s[d] / 1048576 }' "$WORK/files.tsv" | sort
  echo "Total : $count archives, $total Mo (essai à blanc : rien n'a été téléchargé ni écrit)."
  exit 0
fi

# --- 3. Téléchargement et vérification ----------------------------------------------------------

mkdir -p "$DEST/packages" "$DEST/libraries"
info "$count archives, $total Mo au total, dans $DEST"
new=0 kept=0 absent=0
while IFS=$'\t' read -r dir name url sum size what; do
  out=$DEST/$dir/$name
  if [ -f "$out" ] && [ "$(fsize "$out")" = "$size" ]; then kept=$((kept + 1)); continue; fi
  if [ "$OFFLINE" = 1 ]; then warn "absent : $dir/$name ($what)"; absent=$((absent + 1)); continue; fi
  part=$DEST/$dir/.$name.part
  printf '   %s (%s Mo)\n' "$what" "$(awk -v s="$size" 'BEGIN { printf "%.1f", s / 1048576 }')"
  curl -fL --retry 3 --retry-delay 3 --connect-timeout 20 -s -S -o "$part" "$url" || { rm -f "$part"; die "téléchargement impossible : $url"; }
  [ "$(fsize "$part")" = "$size" ] || { rm -f "$part"; die "taille inattendue : $url"; }
  case $sum in
    SHA-256:*)
      [ "$(sha256 "$part")" = "$(printf '%s' "${sum#SHA-256:}" | tr 'A-F' 'a-f')" ] \
        || { rm -f "$part"; die "somme SHA-256 fausse : $url"; } ;;
    *) warn "$name : somme « ${sum%%:*} » non vérifiée (taille seulement)." ;;
  esac
  mv "$part" "$out"
  new=$((new + 1))
done <"$WORK/files.tsv"
[ "$absent" = 0 ] || die "$absent archives manquent : relancer sans --offline sur une machine reliée à Internet."

# Archives qui ne figurent plus dans les index (anciennes versions) : supprimées.
removed=0
for dir in packages libraries; do
  for f in "$DEST/$dir"/* "$DEST/$dir"/.*.part; do
    [ -f "$f" ] || continue
    if ! awk -F '\t' -v d="$dir" -v n="$(basename "$f")" '$1 == d && $2 == n { found = 1 } END { exit !found }' "$WORK/files.tsv"; then
      rm -f "$f"
      removed=$((removed + 1))
    fi
  done
done

# --- 4. Index réécrits (écrits en dernier : jamais d'index qui désigne un fichier absent) -------

jq '.index' "$WORK/plan-packages.json" >"$DEST/.package_jollof_index.json.tmp"
mv "$DEST/.package_jollof_index.json.tmp" "$DEST/package_jollof_index.json"
if [ "$WITH_LIBS" = 1 ]; then
  jq '.index' "$WORK/plan-libraries.json" >"$DEST/.library_index.json.tmp"
  mv "$DEST/.library_index.json.tmp" "$DEST/library_index.json"
else
  rm -f "$DEST/library_index.json"
fi
jq -n --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg base "$BASE_URL" --arg hosts "$HOSTS" \
  --slurpfile p "$WORK/plan-packages.json" --slurpfile l "$WORK/plan-libraries.json" \
  '{generated: $date, baseUrl: $base, hosts: ($hosts | split(",")), platforms: $p[0].platforms,
    libraries: $l[0].libraries, boardsIndex: ($base + "/package_jollof_index.json"),
    librariesIndex: (if ($l[0].libraries | length) > 0 then $base + "/library_index.json" else null end)}' \
  >"$DEST/mirror-info.json"
chmod -R a+rX "$DEST"

info "Miroir prêt : $new téléchargées, $kept déjà là, $removed supprimées ($total Mo)."
cat <<EOF
Index des cartes : $BASE_URL/package_jollof_index.json
Sur le boîtier   : COMPOSE_PROFILES=toolchain dans .env (et TOOLCHAIN_DIR si le miroir n'est pas
                   dans toolchain/mirror), puis sudo systemctl reload jollof
Sur un poste     : arduino-cli config init (une fois), puis
                   arduino-cli config add board_manager.additional_urls $BASE_URL/package_jollof_index.json
EOF
