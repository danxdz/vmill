#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PORT="${PORT:-8081}"
if [[ -f ".venv_ocr/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source .venv_ocr/bin/activate
  echo "[ocr] using .venv_ocr"
else
  echo "[ocr] warning: .venv_ocr not found, using system python"
fi
echo "[ocr] starting ocr_server.py on 0.0.0.0:${PORT}"
PORT="$PORT" python ocr_server.py
