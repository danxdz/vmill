#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VMILL_PORT="${VMILL_PORT:-8080}"
OCR_PORT="${OCR_PORT:-8081}"

cleanup() {
  set +e
  if [[ -n "${VMILL_PID:-}" ]] && kill -0 "$VMILL_PID" 2>/dev/null; then
    kill "$VMILL_PID" 2>/dev/null || true
  fi
  if [[ -n "${OCR_PID:-}" ]] && kill -0 "$OCR_PID" 2>/dev/null; then
    kill "$OCR_PID" 2>/dev/null || true
  fi
  wait "$VMILL_PID" "$OCR_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[all] starting VMill API on :${VMILL_PORT}"
PORT="$VMILL_PORT" python3 vmill_server.py &
VMILL_PID=$!

echo "[all] starting OCR API on :${OCR_PORT}"
if [[ -f ".venv_ocr/bin/activate" ]]; then
  (
    # shellcheck disable=SC1091
    source .venv_ocr/bin/activate
    PORT="$OCR_PORT" python ocr_server.py
  ) &
else
  PORT="$OCR_PORT" python3 ocr_server.py &
fi
OCR_PID=$!

sleep 1

echo
echo "VMill UI/API:  http://localhost:${VMILL_PORT}/login.html"
echo "OCR API docs:  http://localhost:${OCR_PORT}/docs"
echo "Press Ctrl+C to stop both."
echo

wait "$VMILL_PID" "$OCR_PID"
