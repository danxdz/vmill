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
ZIP_PATH="$ROOT_DIR/dist_portable/ocr-linux-portable.zip"

echo "[pack] building OCR portable Linux bundle with ${PYTHON_BIN}"
"$PYTHON_BIN" -m pip install --upgrade pip pyinstaller
"$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements_ocr.txt"

rm -rf "$DIST_BASE" "$WORK_DIR" "$ZIP_PATH"
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
export VMILL_OCR_BASE_DIR="${APP_DIR}/ocr_server"
export PADDLE_HOME="${APP_DIR}/ocr_server/.paddlex"
export PADDLEX_HOME="${APP_DIR}/ocr_server/.paddlex"
export PADDLE_PDX_CACHE_HOME="${APP_DIR}/ocr_server/.paddlex"
export PADDLEOCR_HOME="${APP_DIR}/ocr_server/.paddleocr"
export TEMP="${APP_DIR}/ocr_server/temp"
export TMP="${APP_DIR}/ocr_server/temp"
mkdir -p "$PADDLE_PDX_CACHE_HOME" "$PADDLEOCR_HOME" "$TEMP"
echo "[ocr-portable] starting on :${PORT}"
"$APP_DIR/ocr_server/ocr_server"
EOF

chmod +x "$DIST_BASE/run_ocr_portable.sh"

copy_portable_cache() {
  local cache_name="$1"
  local target="$DIST_BASE/ocr_server/$cache_name"
  local source=""
  local candidate_dirs=(
    "$ROOT_DIR/$cache_name"
    "$HOME/$cache_name"
  )
  for candidate in "${candidate_dirs[@]}"; do
    if [[ -d "$candidate" ]]; then
      source="$candidate"
      break
    fi
  done
  if [[ -z "$source" ]]; then
    echo "[pack] no local $cache_name cache found; first portable startup may require internet."
    return
  fi
  mkdir -p "$target"
  cp -a "$source"/. "$target"/
  echo "[pack] copied $cache_name cache from $source"
}

copy_portable_cache ".paddlex"
copy_portable_cache ".paddleocr"

cat >"$DIST_BASE/PORTABLE_README.txt" <<'EOF'
Portable OCR Server Bundle
==========================

Contents
- ocr_server/ocr_server
- ocr_server/.paddlex
- ocr_server/.paddleocr
- run_ocr_portable.sh

Use on another Linux PC
1. Unzip the whole folder.
2. Keep the folder structure exactly as-is.
3. Run ./run_ocr_portable.sh
4. Default port is 8081

Notes
- This is a one-dir portable bundle. Do not move the ocr_server binary out of its folder.
- The Paddle caches are bundled so you can copy this to another PC without re-downloading models.
- If you already have newer .paddlex / .paddleocr folders on another PC, you can overwrite these bundled folders.
- To change the port before launch:
  PORT=8081 ./run_ocr_portable.sh
EOF

(
  cd "$DIST_BASE"
  zip -qr "$ZIP_PATH" .
)

echo
echo "Built OCR portable bundle:"
echo "  $DIST_BASE"
echo "Portable zip:"
echo "  $ZIP_PATH"
echo "Run:"
echo "  $DIST_BASE/run_ocr_portable.sh"
