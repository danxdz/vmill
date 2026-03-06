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

### Why split

`vmill_server.py` is a long-running Python + SQLite service. This is not a good fit for Vercel serverless functions with ephemeral filesystem behavior.

### Vercel (frontend)

Your `vercel.json` is already present.

If this folder is the project root:
- Framework: `Vite`
- Build command: `npm run build`
- Output: `dist`

### Render (VMill backend)

- Service type: Web Service
- Start command: `python vmill_server.py`
- Port: provided by `PORT` env (already supported)
- Add persistent disk if you need durable `vmill.db`

### Render (OCR backend, optional)

- Service type: Web Service
- Build command: `pip install -r requirements_ocr.txt`
- Start command: `python ocr_server.py`

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
