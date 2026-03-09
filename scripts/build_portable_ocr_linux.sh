#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_OCR="${VENV_OCR:-$ROOT_DIR/.venv_ocr_linux}"
if [[ ! -f "$VENV_OCR/bin/activate" ]]; then
  echo "[pack] creating Linux OCR venv at $VENV_OCR with ${PYTHON_BIN}"
  "$PYTHON_BIN" -m venv "$VENV_OCR"
fi

# shellcheck disable=SC1091
source "$VENV_OCR/bin/activate"
PYTHON_BIN="${PYTHON_BIN:-python}"
DIST_BASE="$ROOT_DIR/dist_portable/ocr-linux"
WORK_DIR="$ROOT_DIR/build/pyinstaller-ocr"
SPEC_DIR="$ROOT_DIR/build"

echo "[pack] building OCR portable Linux bundle with ${PYTHON_BIN}"
"$PYTHON_BIN" -m pip install --upgrade pip pyinstaller
"$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements_ocr.txt"

rm -rf "$DIST_BASE" "$WORK_DIR"
mkdir -p "$DIST_BASE"

"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name ocr_server \
  --distpath "$DIST_BASE" \
  --workpath "$WORK_DIR" \
  --specpath "$SPEC_DIR" \
  --collect-all fastapi \
  --collect-all starlette \
  --collect-all uvicorn \
  --collect-all paddleocr \
  --collect-all paddlex \
  --collect-all paddle \
  --collect-all cv2 \
  --collect-all numpy \
  --collect-all openpyxl \
  --collect-all PIL \
  --hidden-import python_multipart \
  "$ROOT_DIR/ocr_server.py"

cat >"$DIST_BASE/run_ocr_portable.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8081}"
export PORT
export VMILL_OCR_BASE_DIR="${APP_DIR}"
export PADDLE_HOME="${APP_DIR}/.paddlex"
export PADDLEX_HOME="${APP_DIR}/.paddlex"
export PADDLE_PDX_CACHE_HOME="${APP_DIR}/.paddlex"
export PADDLEOCR_HOME="${APP_DIR}/.paddleocr"
export TEMP="${APP_DIR}/temp"
export TMP="${APP_DIR}/temp"
mkdir -p "$PADDLE_PDX_CACHE_HOME" "$PADDLEOCR_HOME" "$TEMP"
echo "[ocr-portable] starting on :${PORT}"
"$APP_DIR/ocr_server/ocr_server"
EOF

chmod +x "$DIST_BASE/run_ocr_portable.sh"

paddlex_target="$DIST_BASE/.paddlex/official_models"
candidate_model_dirs=(
  "$ROOT_DIR/.paddlex/official_models"
  "$HOME/.paddlex/official_models"
)
model_source=""
for candidate in "${candidate_model_dirs[@]}"; do
  if [[ -d "$candidate" ]]; then
    model_source="$candidate"
    break
  fi
done
if [[ -n "$model_source" ]]; then
  mkdir -p "$paddlex_target"
  cp -a "$model_source"/. "$paddlex_target"/
  echo "[pack] copied local PaddleX models from $model_source"
else
  echo "[pack] no local PaddleX model cache found; first portable startup may require internet."
fi

echo
echo "Built OCR portable bundle:"
echo "  $DIST_BASE"
echo "Run:"
echo "  $DIST_BASE/run_ocr_portable.sh"
