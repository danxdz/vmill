#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/build_portable_vmill_linux.sh
./scripts/build_portable_ocr_linux.sh

echo
echo "All portable Linux bundles were built under:"
echo "  $ROOT_DIR/dist_portable"
