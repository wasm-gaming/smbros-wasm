#!/usr/bin/env bash
set -euo pipefail

# Export Super Mario Bros. Remastered (Godot 4) to WebAssembly.
#
#   1. fetch the pinned Godot editor + export templates into .tmp/toolchain
#   2. check out the pinned upstream revision into .tmp/smbros-src
#   3. apply the web-compatibility patches (scripts/patch-smbros-project.mjs)
#   4. import the project headlessly, then export one runtime variant per
#      entry in $VARIANTS
#
# Everything lands in .tmp/ (gitignored) so a rebuild is incremental: the
# toolchain is downloaded once and the imported .godot/ cache is reused.
#
# Env knobs (all optional):
#   GODOT_VERSION   Godot release to build with        (default 4.6.3-stable)
#   UPSTREAM_REPO   Game repository
#   UPSTREAM_REF    Commit/tag/branch to export
#   VARIANTS        "nothreads", "threads" or both     (default: both)
#   FORCE_REIMPORT  Set to 1 to drop the import cache first

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="${PROJECT_DIR}/.tmp"
TOOLCHAIN_DIR="${TMP_DIR}/toolchain"
SRC_DIR="${TMP_DIR}/smbros-src"
DIST_DIR="${PROJECT_DIR}/dist/smbros"

GODOT_VERSION="${GODOT_VERSION:-4.6.3-stable}"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public.git}"
UPSTREAM_REF="${UPSTREAM_REF:-d5bd2b4b85c5ddb58ba1ee66c53455b090152af8}"
VARIANTS="${VARIANTS:-nothreads threads}"

BUILDS_BASE="https://github.com/godotengine/godot-builds/releases/download/${GODOT_VERSION}"

log() { printf '[smbros] %s\n' "$*"; }
die() { printf '[smbros] error: %s\n' "$*" >&2; exit 1; }

# Godot writes editor settings, shader caches and template lookups under the
# user data dir. Point the XDG vars at .tmp so a build never touches the
# machine's real Godot configuration (macOS honours these when absolute).
export XDG_DATA_HOME="${TMP_DIR}/godot-home/data"
export XDG_CONFIG_HOME="${TMP_DIR}/godot-home/config"
export XDG_CACHE_HOME="${TMP_DIR}/godot-home/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

# ---------------------------------------------------------------- toolchain --

fetch() {
  local url="$1" out="$2"
  [[ -s "$out" ]] && return 0
  log "downloading $(basename "$url")"
  curl -fL --retry 3 --retry-delay 2 -o "${out}.part" "$url"
  mv "${out}.part" "$out"
}

godot_editor_asset() {
  case "$(uname -s)/$(uname -m)" in
    Darwin/*)          echo "Godot_v${GODOT_VERSION}_macos.universal.zip" ;;
    Linux/x86_64)      echo "Godot_v${GODOT_VERSION}_linux.x86_64.zip" ;;
    Linux/aarch64|Linux/arm64) echo "Godot_v${GODOT_VERSION}_linux.arm64.zip" ;;
    *) die "unsupported host $(uname -s)/$(uname -m) — build inside Docker instead (make build-wasm-docker)" ;;
  esac
}

setup_toolchain() {
  mkdir -p "$TOOLCHAIN_DIR"

  local editor_asset editor_zip templates_tpz
  editor_asset="$(godot_editor_asset)"
  editor_zip="${TOOLCHAIN_DIR}/${editor_asset}"
  templates_tpz="${TOOLCHAIN_DIR}/Godot_v${GODOT_VERSION}_export_templates.tpz"

  fetch "${BUILDS_BASE}/${editor_asset}" "$editor_zip"
  fetch "${BUILDS_BASE}/Godot_v${GODOT_VERSION}_export_templates.tpz" "$templates_tpz"

  if [[ "$(uname -s)" == "Darwin" ]]; then
    [[ -d "${TOOLCHAIN_DIR}/Godot.app" ]] || unzip -q -o "$editor_zip" -d "$TOOLCHAIN_DIR"
    GODOT_BIN="${TOOLCHAIN_DIR}/Godot.app/Contents/MacOS/Godot"
  else
    GODOT_BIN="$(find "$TOOLCHAIN_DIR" -maxdepth 1 -name 'Godot_v*_linux*' ! -name '*.zip' ! -name '*.part' -type f | head -1)"
    if [[ -z "$GODOT_BIN" ]]; then
      unzip -q -o "$editor_zip" -d "$TOOLCHAIN_DIR"
      GODOT_BIN="$(find "$TOOLCHAIN_DIR" -maxdepth 1 -name 'Godot_v*_linux*' ! -name '*.zip' ! -name '*.part' -type f | head -1)"
    fi
  fi
  [[ -x "$GODOT_BIN" ]] || chmod +x "$GODOT_BIN"
  [[ -x "$GODOT_BIN" ]] || die "Godot binary not found under ${TOOLCHAIN_DIR}"

  # The .tpz is a zip with everything under templates/. We only need the two
  # web ones, and we reference them from the export preset by absolute path
  # (custom_template/release) rather than installing them system-wide.
  WEB_TEMPLATE_DIR="${TOOLCHAIN_DIR}/templates-${GODOT_VERSION}"
  if [[ ! -f "${WEB_TEMPLATE_DIR}/web_release.zip" ]]; then
    log "extracting web export templates"
    rm -rf "$WEB_TEMPLATE_DIR"
    mkdir -p "$WEB_TEMPLATE_DIR"
    unzip -q -o -j "$templates_tpz" \
      'templates/web_release.zip' 'templates/web_nothreads_release.zip' \
      -d "$WEB_TEMPLATE_DIR"
  fi

  export WEB_TEMPLATE_THREADS="${WEB_TEMPLATE_DIR}/web_release.zip"
  export WEB_TEMPLATE_NOTHREADS="${WEB_TEMPLATE_DIR}/web_nothreads_release.zip"

  log "godot: $("$GODOT_BIN" --headless --version 2>/dev/null | tail -1)"
}

# ----------------------------------------------------------------- upstream --

sync_upstream() {
  mkdir -p "$SRC_DIR"
  if [[ ! -d "${SRC_DIR}/.git" ]]; then
    log "initializing upstream repo at ${SRC_DIR}"
    git -C "$SRC_DIR" init --quiet
    git -C "$SRC_DIR" remote add origin "$UPSTREAM_REPO" 2>/dev/null || git -C "$SRC_DIR" remote set-url origin "$UPSTREAM_REPO"
  fi

  log "checking out ${UPSTREAM_REF}"
  git -C "$SRC_DIR" fetch --filter=blob:none origin "$UPSTREAM_REF" 2>/dev/null \
    || git -C "$SRC_DIR" fetch --filter=blob:none origin
  git -C "$SRC_DIR" checkout --quiet --force --detach "$UPSTREAM_REF"

  # Drop the previous run's patches (but keep .godot/, the import cache) so the
  # patch script always starts from pristine upstream sources.
  git -C "$SRC_DIR" checkout --quiet -- .
  git -C "$SRC_DIR" clean --quiet -fd -e .godot
}

# ------------------------------------------------------------------- export --

import_project() {
  if [[ "${FORCE_REIMPORT:-0}" == "1" ]]; then
    rm -rf "${SRC_DIR}/.godot"
  fi

  log "importing resources (first run takes a few minutes)"
  # Godot exits non-zero on benign import warnings, and a single pass can leave
  # dependent resources unimported, so run it twice and let the export be the
  # real gate.
  "$GODOT_BIN" --headless --path "$SRC_DIR" --import >"${TMP_DIR}/import.log" 2>&1 || true
  "$GODOT_BIN" --headless --path "$SRC_DIR" --import >>"${TMP_DIR}/import.log" 2>&1 || true
  log "import log: ${TMP_DIR}/import.log"
}

export_variant() {
  local variant="$1" preset basename
  case "$variant" in
    nothreads) preset="Web";         basename="smbros" ;;
    threads)   preset="Web Threaded"; basename="smbros.threaded" ;;
    *) die "unknown variant '${variant}' (expected: nothreads, threads)" ;;
  esac

  log "exporting '${preset}' → dist/smbros/${basename}.html"
  mkdir -p "$DIST_DIR"
  "$GODOT_BIN" --headless --path "$SRC_DIR" \
    --export-release "$preset" "${DIST_DIR}/${basename}.html" \
    >"${TMP_DIR}/export-${variant}.log" 2>&1 \
    || { tail -40 "${TMP_DIR}/export-${variant}.log" >&2; die "export failed (${TMP_DIR}/export-${variant}.log)"; }

  [[ -f "${DIST_DIR}/${basename}.wasm" ]] || die "no ${basename}.wasm produced"
}

# The .pck is byte-identical between variants — it is just the game data — so
# the threaded build reuses the one the default build wrote instead of shipping
# a second ~50 MB copy. The SDK always passes mainPack: smbros.pck; the Godot
# shell for that variant is rewritten to match.
dedupe_pack() {
  local threaded_pck="${DIST_DIR}/smbros.threaded.pck"
  [[ -f "$threaded_pck" && -f "${DIST_DIR}/smbros.pck" ]] || return 0
  rm -f "$threaded_pck"
  if [[ -f "${DIST_DIR}/smbros.threaded.html" ]]; then
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("smbros.threaded.pck", "smbros.pck"));
    ' "${DIST_DIR}/smbros.threaded.html"
  fi
  log "de-duplicated smbros.threaded.pck"
}

# Keep the stock Godot page reachable at dist/original/index.html, the way the
# other engine packages preserve their upstream shell. It lives one directory
# up from its own assets, so it gets a <base> to fix the relative URLs.
snapshot_original_shell() {
  local shell="${DIST_DIR}/smbros.html"
  [[ -f "$shell" ]] || return 0
  mkdir -p "${PROJECT_DIR}/dist/original"
  node -e '
    const fs = require("fs");
    const [src, dest] = process.argv.slice(1);
    const html = fs.readFileSync(src, "utf8")
      .replace(/<head>/i, "<head>\n\t\t<base href=\"../smbros/\">");
    fs.writeFileSync(dest, html);
  ' "$shell" "${PROJECT_DIR}/dist/original/index.html"
  log "wrote dist/original/index.html"
}

main() {
  command -v git >/dev/null || die "git is required"
  command -v curl >/dev/null || die "curl is required"
  command -v node >/dev/null || die "node is required"

  setup_toolchain
  sync_upstream

  log "patching project for the web platform"
  node "${PROJECT_DIR}/scripts/patch-smbros-project.mjs" "$SRC_DIR"

  import_project

  for variant in $VARIANTS; do
    export_variant "$variant"
  done

  dedupe_pack
  snapshot_original_shell

  log "runtime artifacts:"
  ls -la "$DIST_DIR"
}

main "$@"
