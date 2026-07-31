#!/usr/bin/env bash
set -euo pipefail

# Run the web export inside a pinned Linux container.
#
# `make build-wasm` builds with a host Godot and is what you want day to day.
# This wrapper exists for CI parity and for hosts the Godot editor has no binary
# for: it produces the same dist/smbros/ from the same script, only on Debian.
#
# The workspace is bind-mounted, so .tmp/ (toolchain + upstream checkout) and
# dist/ are shared with the host and survive between runs.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-smbros-wasm-builder}"
DOCKERFILE="${PROJECT_DIR}/scripts/smbros-builder.Dockerfile"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

echo "[smbros] building ${IMAGE}"
docker build --platform linux/amd64 -f "$DOCKERFILE" -t "$IMAGE" "${PROJECT_DIR}/scripts"

echo "[smbros] exporting inside ${IMAGE}"
docker run --rm \
  --platform linux/amd64 \
  -v "${PROJECT_DIR}:/workspace" \
  -e GODOT_VERSION \
  -e UPSTREAM_REPO \
  -e UPSTREAM_REF \
  -e VARIANTS \
  -e FORCE_REIMPORT \
  -e KEEP_MOD_LOADER \
  "$IMAGE"

echo "[smbros] runtime artifacts available in ${PROJECT_DIR}/dist/smbros"
