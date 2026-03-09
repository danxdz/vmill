#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
DIST_BASE="$ROOT_DIR/dist_portable/vmill-linux"
WORK_DIR="$ROOT_DIR/build/pyinstaller-vmill"
SPEC_DIR="$ROOT_DIR/build"

echo "[pack] building VMill portable Linux bundle with ${PYTHON_BIN}"
"$PYTHON_BIN" -m pip install --upgrade pip pyinstaller

rm -rf "$DIST_BASE" "$WORK_DIR"
mkdir -p "$DIST_BASE"

"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name vmill_server \
  --distpath "$DIST_BASE" \
  --workpath "$WORK_DIR" \
  --specpath "$SPEC_DIR" \
  --add-data "$ROOT_DIR/public:public" \
  --add-data "$ROOT_DIR/docs:docs" \
  "$ROOT_DIR/vmill_server.py"

cat >"$DIST_BASE/run_vmill_portable.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
PORT="${PORT:-8080}"
export VMILL_DB_PATH="${VMILL_DB_PATH:-$APP_DIR/vmill.db}"
export PORT
echo "[vmill-portable] starting on :${PORT} with DB ${VMILL_DB_PATH}"
"$APP_DIR/vmill_server/vmill_server"
EOF

chmod +x "$DIST_BASE/run_vmill_portable.sh"

echo
echo "Built VMill portable bundle:"
echo "  $DIST_BASE"
echo "Run:"
echo "  $DIST_BASE/run_vmill_portable.sh"
