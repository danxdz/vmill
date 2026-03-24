# VMill

Browser CNC workshop suite with:
- Hub UI + module shell (`public/`)
- Multiuser backend (`vmill_server.py`, SQLite)
- Optional OCR backend (`ocr_server.py`)

## Magic Buttons

[![Run VMill](https://img.shields.io/badge/Run-VMill_Server-0B5FFF?style=for-the-badge)](#run-vmill-server)
[![Run OCR](https://img.shields.io/badge/Run-OCR_Server-0A8F5B?style=for-the-badge)](#run-ocr-server)
[![Run All](https://img.shields.io/badge/Run-Both_Servers-6B46C1?style=for-the-badge)](#run-both-servers)
[![Host Setup](https://img.shields.io/badge/Setup-LAN_Hosts-374151?style=for-the-badge)](#host-setup-lan)

These call local helper scripts:
- `scripts/run_vmill.sh`
- `scripts/run_ocr.sh`
- `scripts/run_all.sh`
- `scripts/hosts_hint.sh`

## Quick Start

### 1) Install dependencies

```bash
npm ci
```

### 2) Backend + Hub (required)

#### Run VMill server

```bash
make run-vmill
```

Open:
- `http://localhost:8080/login.html`
- default login: `admin / vmill2024`

### 3) OCR backend (optional)

#### Setup OCR env (first time)

```bash
make setup-ocr
```

#### Run OCR server

```bash
make run-ocr
```

Open:
- `http://localhost:8081/docs`
- `http://localhost:8081/openapi.json`

### 4) Run both servers

```bash
make run-all
```

### 5) Build portable Linux bundles (PyInstaller)

Yes, PyInstaller works on Linux. Build on the same OS you will run.

```bash
make setup-pack
make build-vmill-linux
make build-ocr-linux   # requires .venv_ocr
# or both:
make build-portable-linux
```

Outputs:
- `dist_portable/vmill-linux/run_vmill_portable.sh`
- `dist_portable/ocr-linux/run_ocr_portable.sh`

Notes:
- Use `--onedir` bundles (more reliable than `--onefile` for OCR dependencies).
- For Windows, build separately on Windows.

Windows OCR portable bundle:

```powershell
pwsh -File .\scripts\build_portable_ocr_windows.ps1
```

Outputs on Windows:
- `dist_portable\ocr-windows\`
- `dist_portable\ocr-windows-portable.zip`

The Windows OCR bundle now includes:
- `ocr_server.exe`
- bundled `.paddlex` cache
- bundled `.paddleocr` cache
- launcher `run_ocr_portable.cmd`

This is the folder/zip you can copy to another Windows PC.

### 6) Stress-test sync/API (multi-user)

Run a concurrent load test that:
- starts an isolated `vmill_server.py` + temp SQLite DB,
- creates many users,
- runs parallel `poll/pull/push + CRUD` loops,
- prints request/error/conflict metrics,
- checks DB invariants (`workspace`, `sync_log`, revision consistency).

```bash
make stress-sync
```

Custom run:

```bash
python3 scripts/stress_sync_test.py --users 40 --workers 30 --duration 45
```

Against an existing server (skip DB checks if needed):

```bash
python3 scripts/stress_sync_test.py --server-url http://127.0.0.1:8080 --no-db-check
```

### 7) Stress-test OCR API (multi-user uploads)

Runs concurrent multipart uploads to `/ocr/process` with mixed modes and reports:
- throughput (`ops/s`)
- status counts / transport errors
- latency (`p50/p95/p99`)
- zones detected metrics

```bash
make stress-ocr
```

Custom load:

```bash
python3 scripts/stress_ocr_test.py --workers 12 --duration 60
```

Fast-only stability run (recommended baseline):

```bash
python3 scripts/stress_ocr_test.py --workers 8 --duration 40 --modes fast
```

Mixed-mode run:

```bash
python3 scripts/stress_ocr_test.py --workers 8 --duration 40 --modes fast,accurate,hardcore
```

Against a running OCR server:

```bash
python3 scripts/stress_ocr_test.py --server-url http://127.0.0.1:8081 --workers 8 --duration 40
```

Save JSON report:

```bash
python3 scripts/stress_ocr_test.py --report ./docs/ocr_stress_report.json
```

Runtime stability note:
- `ocr_server.py` now serializes OCR `predict()` calls (thread-safe guard) and uses `OCR_WORKERS=1` by default.
- You can tune server-side task workers with environment variable `OCR_WORKERS` if needed.

## Host Setup (LAN)

Print host/IP hints:

```bash
make hosts-hint
```

Clients can use:
- `http://<SERVER_IP>:8080/login.html`
- `http://<SERVER_IP>:8081/docs`

## Deploy

### Recommended split deploy

- Frontend: **Vercel** (static UI)
- Backend: **Render** (or any VM) for `vmill_server.py`
- OCR: **Render** optional service for `ocr_server.py`

### One-click Render deploy (auto create + auto deploy)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/danxdz/vmill)

This uses `render.yaml` to create:
- `vmill-api` (main app + SQLite backend)
- `vmill-ocr` (OCR API)

After first deploy, pushes to `main` auto-deploy both services (`autoDeploy: true`).

### Why split

`vmill_server.py` is a long-running Python + SQLite service. This is not a good fit for Vercel serverless functions with ephemeral filesystem behavior.



### Render (VMill backend)

- Service type: Web Service
- Build command: `pip install --upgrade pip && pip install -r requirements.txt`
- Start command: `python vmill_server.py`
- Python version: `3.11.10` (via `PYTHON_VERSION` in `render.yaml`)
- Port: provided by `PORT` env (already supported)
- Persistent disk configured in `render.yaml`
- DB path is controlled by `VMILL_DB_PATH` (default `/var/data/vmill.db` on Render)

If Render logs show a different Python version (for example `3.14.x`), your service is likely not using Blueprint sync.
In that case, either:
- re-create/sync service from `render.yaml`, or
- set `PYTHON_VERSION=3.11.10` manually in the Render dashboard environment settings.

### Render (OCR backend, optional)

- Service type: Web Service
- Build command: `pip install -r requirements_ocr.txt`
- Start command: `python ocr_server.py`

If you deploy from a fork, replace the button repo URL with your fork URL:

```text
https://render.com/deploy?repo=https://github.com/<you>/<repo>
```


## API Docs

OCR API docs:
- `docs/OCR_API_OPENAPI_GUIDE.md`
- `docs/ocr_openapi.v1.yaml`
- live schema: `/openapi.json`

## Utility targets

```bash
make help
```

## License

See `LICENSE` (non-commercial).
