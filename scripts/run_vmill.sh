#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PORT="${PORT:-8080}"
echo "[vmill] starting vmill_server.py on 0.0.0.0:${PORT}"
PORT="$PORT" python3 vmill_server.py
