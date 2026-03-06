#!/usr/bin/env python3
"""
VMill local server (stdlib-only): auth, SQLite persistence, REST API, static hosting.
Run: python vmill_server.py
"""
from __future__ import annotations

import json
import mimetypes
import os
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse
import hashlib
import socket

ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / "public"
DB_PATH = Path(os.environ.get("VMILL_DB_PATH", str(ROOT_DIR / "vmill.db"))).expanduser()
DEFAULT_PORT = int(os.environ.get("PORT", "8080"))
TOKEN_TTL_HOURS = 24 * 7

ROLE_RANK = {
    "operator": 1,
    "manager": 2,
    "admin": 3,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(ts: str) -> datetime:
    if not ts:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        return datetime.fromisoformat(ts)
    except Exception:
        return datetime.fromtimestamp(0, tz=timezone.utc)


def hash_password(password: str, salt_hex: Optional[str] = None) -> Tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, digest_hex: str) -> bool:
    try:
        _, calc = hash_password(password, salt_hex)
        return secrets.compare_digest(calc, digest_hex)
    except Exception:
        return False


class DB:
    def __init__(self, path: Path):
        self.path = path
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()

    def init_schema(self) -> None:
        with self.lock:
            cur = self.conn.cursor()
            cur.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;

                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    role TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tokens (
                    token TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS workspace (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    settings_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    parent_id TEXT,
                    type TEXT NOT NULL,
                    order_index INTEGER NOT NULL DEFAULT 0,
                    image_url TEXT,
                    meta_json TEXT NOT NULL,
                    created_by TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    code TEXT,
                    name TEXT NOT NULL,
                    parent_product_id TEXT,
                    image_url TEXT,
                    meta_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    node_id TEXT,
                    product_id TEXT,
                    status TEXT,
                    meta_json TEXT NOT NULL,
                    created_by TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chrono_sessions (
                    id TEXT PRIMARY KEY,
                    node_id TEXT,
                    job_id TEXT,
                    user_id TEXT,
                    started_at TEXT,
                    ended_at TEXT,
                    notes TEXT,
                    data_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chrono_events (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    label TEXT,
                    meta_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS spc_characteristics (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    usl REAL,
                    lsl REAL,
                    target REAL,
                    unit TEXT,
                    meta_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS spc_series (
                    id TEXT PRIMARY KEY,
                    node_id TEXT,
                    characteristic_id TEXT,
                    active INTEGER NOT NULL DEFAULT 1,
                    meta_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS spc_measurements (
                    id TEXT PRIMARY KEY,
                    series_id TEXT NOT NULL,
                    node_id TEXT,
                    user_id TEXT,
                    value REAL NOT NULL,
                    timestamp TEXT NOT NULL,
                    out_of_control INTEGER NOT NULL DEFAULT 0,
                    rule_flags TEXT,
                    meta_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sync_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    changed_at TEXT NOT NULL,
                    changed_by TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
                CREATE INDEX IF NOT EXISTS idx_jobs_node ON jobs(node_id);
                CREATE INDEX IF NOT EXISTS idx_jobs_product ON jobs(product_id);
                CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
                CREATE INDEX IF NOT EXISTS idx_sync_changed_at ON sync_log(changed_at);
                """
            )
            self.conn.commit()

        self.ensure_default_workspace()
        self.ensure_default_admin()

    def ensure_default_workspace(self) -> None:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT id FROM workspace WHERE id='default'")
            if cur.fetchone() is None:
                cur.execute(
                    "INSERT INTO workspace(id,name,settings_json,updated_at) VALUES(?,?,?,?)",
                    ("default", "Default Workspace", json.dumps({"app": None, "modules": None}), now_iso()),
                )
                self.conn.commit()

    def ensure_default_admin(self) -> None:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT id FROM users WHERE username=?", ("admin",))
            if cur.fetchone() is not None:
                return
            uid = str(uuid.uuid4())
            salt, digest = hash_password("vmill2024")
            ts = now_iso()
            cur.execute(
                "INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (uid, "admin", digest, salt, "admin", ts, ts),
            )
            self.conn.commit()

    def query_one(self, sql: str, params: Tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            return cur.fetchone()

    def query_all(self, sql: str, params: Tuple[Any, ...] = ()) -> List[sqlite3.Row]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            return cur.fetchall()

    def execute(self, sql: str, params: Tuple[Any, ...] = ()) -> int:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            self.conn.commit()
            return cur.rowcount

    def last_sync_rev(self) -> int:
        row = self.query_one("SELECT COALESCE(MAX(id),0) AS rev FROM sync_log")
        return int(row["rev"]) if row else 0

    def log_sync(self, table_name: str, record_id: str, action: str, changed_by: Optional[str]) -> None:
        self.execute(
            "INSERT INTO sync_log(table_name,record_id,action,changed_at,changed_by) VALUES(?,?,?,?,?)",
            (table_name, record_id, action, now_iso(), changed_by or ""),
        )


db = DB(DB_PATH)


def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def decode_json_field(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        out = json.loads(str(value))
        return out if out is not None else fallback
    except Exception:
        return fallback


def decode_record(table: str, rec: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(rec)
    if table in {"nodes", "products", "jobs", "chrono_sessions", "spc_characteristics", "spc_series", "spc_measurements"}:
        if "meta_json" in out:
            out["meta"] = decode_json_field(out.pop("meta_json"), {})
        if "data_json" in out:
            out["data"] = decode_json_field(out.pop("data_json"), {})
    if table == "chrono_events" and "meta_json" in out:
        out["meta"] = decode_json_field(out.pop("meta_json"), {})
    return out


def get_local_ip() -> str:
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET, type=socket.SOCK_STREAM)
        for info in infos:
            addr = info[4][0] if info and len(info) > 4 else ""
            if not addr:
                continue
            if addr.startswith("127."):
                continue
            return addr
    except Exception:
        pass
    return "127.0.0.1"


class VMillHandler(BaseHTTPRequestHandler):
    server_version = "VMillServer/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")
        super().end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep server output concise by suppressing high-frequency health/poll noise.
        try:
            msg = fmt % args
        except Exception:
            msg = str(fmt or "")
        if " /api/sync/poll?" in msg and " 200 " in msg:
            return
        if " /api/sync/pull " in msg and " 200 " in msg:
            return
        if " /api/sync/push " in msg and " 200 " in msg:
            return
        if " /api/status " in msg and " 200 " in msg:
            return
        print("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), msg))

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        self.route_request("GET")

    def do_POST(self) -> None:
        self.route_request("POST")

    def do_PUT(self) -> None:
        self.route_request("PUT")

    def do_PATCH(self) -> None:
        self.route_request("PATCH")

    def do_DELETE(self) -> None:
        self.route_request("DELETE")

    def route_request(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        if path.startswith("/api/"):
            self.handle_api(method, path, parse_qs(parsed.query or ""))
            return
        if path == "/":
            self.redirect("/login.html")
            return
        if path == "/status":
            self.serve_status_page()
            return
        self.serve_static(path)

    def redirect(self, location: str, status: HTTPStatus = HTTPStatus.FOUND) -> None:
        self.send_response(status)
        self.send_header("Location", str(location or "/"))
        self.end_headers()

    def read_json_body(self) -> Dict[str, Any]:
        raw_len = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_len)
        except Exception:
            length = 0
        if length <= 0:
            return {}
        body = self.rfile.read(length)
        try:
            parsed = json.loads(body.decode("utf-8"))
        except Exception:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
            raise ValueError("invalid json")
        if not isinstance(parsed, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
            raise ValueError("invalid payload")
        return parsed

    def send_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def parse_bearer(self) -> str:
        auth = self.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return ""
        return auth.split(" ", 1)[1].strip()

    def require_auth(self, min_role: str = "operator") -> Optional[Dict[str, Any]]:
        token = self.parse_bearer()
        if not token:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "missing_token"})
            return None
        row = db.query_one(
            """
            SELECT t.token, t.expires_at, u.id AS user_id, u.username, u.role
            FROM tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token=?
            """,
            (token,),
        )
        if row is None:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "invalid_token"})
            return None
        if parse_iso(row["expires_at"]) <= datetime.now(timezone.utc):
            db.execute("DELETE FROM tokens WHERE token=?", (token,))
            self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "token_expired"})
            return None
        need = ROLE_RANK.get(min_role, 1)
        got = ROLE_RANK.get(str(row["role"]), 0)
        if got < need:
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "forbidden"})
            return None
        return {
            "id": row["user_id"],
            "username": row["username"],
            "role": row["role"],
            "token": row["token"],
        }

    def handle_api(self, method: str, path: str, query: Dict[str, List[str]]) -> None:
        parts = [p for p in path.split("/") if p]

        if parts == ["api", "status"] and method == "GET":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "status": "online",
                    "server": "vmill_server",
                    "time": now_iso(),
                    "db": str(DB_PATH.name),
                    "rev": db.last_sync_rev(),
                },
            )
            return

        # Auth
        if parts == ["api", "auth", "login"] and method == "POST":
            self.api_login()
            return
        if parts == ["api", "auth", "logout"] and method == "POST":
            self.api_logout()
            return
        if parts == ["api", "auth", "me"] and method == "GET":
            user = self.require_auth("operator")
            if not user:
                return
            self.send_json(HTTPStatus.OK, {"ok": True, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}})
            return

        # Users admin CRUD
        if parts[:2] == ["api", "users"]:
            self.api_users(method, parts)
            return

        # Sync endpoints
        if parts == ["api", "sync", "poll"] and method == "GET":
            user = self.require_auth("operator")
            if not user:
                return
            since = 0
            try:
                since = int((query.get("since") or ["0"])[0])
            except Exception:
                since = 0
            rev = db.last_sync_rev()
            self.send_json(HTTPStatus.OK, {"ok": True, "rev": rev, "changed": rev > since, "server_time": now_iso()})
            return
        if parts == ["api", "sync", "pull"] and method == "GET":
            user = self.require_auth("operator")
            if not user:
                return
            self.api_sync_pull(user)
            return
        if parts == ["api", "sync", "push"] and method == "POST":
            user = self.require_auth("operator")
            if not user:
                return
            self.api_sync_push(user)
            return

        # Nodes special actions
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "nodes" and parts[3] == "clone" and method == "POST":
            user = self.require_auth("manager")
            if not user:
                return
            self.api_clone_node(parts[2], user)
            return

        # Generic CRUD tables
        table_routes = {
            "nodes": "nodes",
            "jobs": "jobs",
            "products": "products",
            "chrono_sessions": "chrono_sessions",
            "chrono_events": "chrono_events",
            "spc_characteristics": "spc_characteristics",
            "spc_series": "spc_series",
            "spc_measurements": "spc_measurements",
        }
        if len(parts) >= 2 and parts[0] == "api":
            table = table_routes.get(parts[1], "")
            if table:
                self.api_table(method, parts, table, query)
                return

        # Aliases requested by prompt.
        if parts[:3] == ["api", "chrono", "sessions"]:
            alias_parts = ["api", "chrono_sessions"] + parts[3:]
            self.api_table(method, alias_parts, "chrono_sessions", query)
            return
        if parts[:3] == ["api", "chrono", "events"]:
            alias_parts = ["api", "chrono_events"] + parts[3:]
            self.api_table(method, alias_parts, "chrono_events", query)
            return
        if parts[:3] == ["api", "spc", "characteristics"]:
            alias_parts = ["api", "spc_characteristics"] + parts[3:]
            self.api_table(method, alias_parts, "spc_characteristics", query)
            return
        if parts[:3] == ["api", "spc", "series"]:
            alias_parts = ["api", "spc_series"] + parts[3:]
            self.api_table(method, alias_parts, "spc_series", query)
            return
        if parts[:3] == ["api", "spc", "measurements"]:
            alias_parts = ["api", "spc_measurements"] + parts[3:]
            self.api_table(method, alias_parts, "spc_measurements", query)
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def api_login(self) -> None:
        try:
            body = self.read_json_body()
        except ValueError:
            return
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        if not username or not password:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_credentials"})
            return
        row = db.query_one("SELECT * FROM users WHERE username=?", (username,))
        if row is None:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "invalid_credentials"})
            return
        if not verify_password(password, row["password_salt"], row["password_hash"]):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "invalid_credentials"})
            return

        token = secrets.token_urlsafe(32)
        created = datetime.now(timezone.utc)
        expires = created + timedelta(hours=TOKEN_TTL_HOURS)
        db.execute(
            "INSERT INTO tokens(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
            (token, row["id"], created.isoformat(), expires.isoformat()),
        )
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "token": token,
                "expires_at": expires.isoformat(),
                "user": {
                    "id": row["id"],
                    "username": row["username"],
                    "role": row["role"],
                },
            },
        )

    def api_logout(self) -> None:
        user = self.require_auth("operator")
        if not user:
            return
        db.execute("DELETE FROM tokens WHERE token=?", (user["token"],))
        self.send_json(HTTPStatus.OK, {"ok": True})

    def api_users(self, method: str, parts: List[str]) -> None:
        user = self.require_auth("admin")
        if not user:
            return

        if len(parts) == 2 and method == "GET":
            rows = db.query_all("SELECT id, username, role, created_at, updated_at FROM users ORDER BY username ASC")
            self.send_json(HTTPStatus.OK, {"ok": True, "users": [row_to_dict(r) for r in rows]})
            return

        if len(parts) == 2 and method == "POST":
            try:
                body = self.read_json_body()
            except ValueError:
                return
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", "")).strip()
            role = str(body.get("role", "operator")).strip().lower()
            if role not in ROLE_RANK:
                role = "operator"
            if not username or not password:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_fields"})
                return
            existing = db.query_one("SELECT id FROM users WHERE username=?", (username,))
            if existing:
                self.send_json(HTTPStatus.CONFLICT, {"ok": False, "error": "username_exists"})
                return
            uid = str(uuid.uuid4())
            salt, digest = hash_password(password)
            ts = now_iso()
            db.execute(
                "INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (uid, username, digest, salt, role, ts, ts),
            )
            db.log_sync("users", uid, "create", user["id"])
            self.send_json(HTTPStatus.CREATED, {"ok": True, "user": {"id": uid, "username": username, "role": role}})
            return

        if len(parts) >= 3:
            key = unquote(parts[2])
            row = db.query_one("SELECT * FROM users WHERE id=? OR username=?", (key, key))
            if row is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "user_not_found"})
                return
            uid = row["id"]
            if method in {"PUT", "PATCH"}:
                try:
                    body = self.read_json_body()
                except ValueError:
                    return
                updates: Dict[str, Any] = {}
                if "username" in body:
                    updates["username"] = str(body.get("username", "")).strip() or row["username"]
                if "role" in body:
                    role = str(body.get("role", "operator")).strip().lower()
                    updates["role"] = role if role in ROLE_RANK else row["role"]
                if "password" in body and str(body.get("password", "")).strip():
                    salt, digest = hash_password(str(body["password"]))
                    updates["password_hash"] = digest
                    updates["password_salt"] = salt
                if not updates:
                    self.send_json(HTTPStatus.OK, {"ok": True, "user": {"id": uid, "username": row["username"], "role": row["role"]}})
                    return
                updates["updated_at"] = now_iso()
                cols = ", ".join(f"{k}=?" for k in updates.keys())
                vals = tuple(updates.values()) + (uid,)
                db.execute(f"UPDATE users SET {cols} WHERE id=?", vals)
                db.log_sync("users", uid, "update", user["id"])
                updated = db.query_one("SELECT id, username, role, created_at, updated_at FROM users WHERE id=?", (uid,))
                self.send_json(HTTPStatus.OK, {"ok": True, "user": row_to_dict(updated) if updated else {"id": uid}})
                return
            if method == "DELETE":
                if uid == user["id"]:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "cannot_delete_self"})
                    return
                db.execute("DELETE FROM users WHERE id=?", (uid,))
                db.execute("DELETE FROM tokens WHERE user_id=?", (uid,))
                db.log_sync("users", uid, "delete", user["id"])
                self.send_json(HTTPStatus.OK, {"ok": True})
                return

        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"ok": False, "error": "method_not_allowed"})

    def api_sync_pull(self, user: Dict[str, Any]) -> None:
        row = db.query_one("SELECT * FROM workspace WHERE id='default'")
        if row is None:
            db.ensure_default_workspace()
            row = db.query_one("SELECT * FROM workspace WHERE id='default'")
        payload = decode_json_field(row["settings_json"] if row else "{}", {})
        if not isinstance(payload, dict):
            payload = {}
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "rev": db.last_sync_rev(),
                "workspace": {
                    "id": "default",
                    "name": row["name"] if row else "Default Workspace",
                    "updated_at": row["updated_at"] if row else now_iso(),
                    "app": payload.get("app"),
                    "modules": payload.get("modules"),
                },
            },
        )

    def api_sync_push(self, user: Dict[str, Any]) -> None:
        try:
            body = self.read_json_body()
        except ValueError:
            return

        row = db.query_one("SELECT * FROM workspace WHERE id='default'")
        if row is None:
            db.ensure_default_workspace()
            row = db.query_one("SELECT * FROM workspace WHERE id='default'")

        payload = decode_json_field(row["settings_json"] if row else "{}", {})
        if not isinstance(payload, dict):
            payload = {}

        changed = {"app": False, "modules": False}
        if "app" in body:
            payload["app"] = body.get("app")
            changed["app"] = True
        if "modules" in body:
            payload["modules"] = body.get("modules")
            changed["modules"] = True

        ts = now_iso()
        db.execute(
            "UPDATE workspace SET settings_json=?, updated_at=? WHERE id='default'",
            (json.dumps(payload, ensure_ascii=False), ts),
        )
        if changed["app"]:
            db.log_sync("workspace", "default:app", "update", user["id"])
        if changed["modules"]:
            db.log_sync("workspace", "default:modules", "update", user["id"])

        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "pushed": changed,
                "rev": db.last_sync_rev(),
                "workspace": {"id": "default", "updated_at": ts, "app": payload.get("app"), "modules": payload.get("modules")},
            },
        )

    def collect_node_subtree_ids(self, root_id: str) -> List[str]:
        rid = str(root_id or "").strip()
        if not rid:
            return []
        rows = db.query_all("SELECT id, parent_id FROM nodes")
        children_by_parent: Dict[str, List[str]] = {}
        for row in rows:
            nid = str(row["id"] or "")
            pid = str(row["parent_id"] or "")
            if not nid:
                continue
            children_by_parent.setdefault(pid, []).append(nid)
        if rid not in {str(r["id"] or "") for r in rows}:
            return []
        out: List[str] = []
        queue = [rid]
        seen = set()
        while queue:
            cur = queue.pop(0)
            if cur in seen:
                continue
            seen.add(cur)
            out.append(cur)
            for child in children_by_parent.get(cur, []):
                if child and child not in seen:
                    queue.append(child)
        return out

    def count_node_linked_data(self, node_ids: List[str]) -> Dict[str, int]:
        ids = [str(x or "").strip() for x in node_ids if str(x or "").strip()]
        if not ids:
            return {"jobs": 0, "spc_series": 0, "chrono_sessions": 0}
        marks = ",".join("?" for _ in ids)
        jobs = db.query_one(f"SELECT COUNT(*) AS c FROM jobs WHERE node_id IN ({marks})", tuple(ids))
        spc = db.query_one(f"SELECT COUNT(*) AS c FROM spc_series WHERE node_id IN ({marks})", tuple(ids))
        chrono = db.query_one(f"SELECT COUNT(*) AS c FROM chrono_sessions WHERE node_id IN ({marks})", tuple(ids))
        return {
            "jobs": int(jobs["c"]) if jobs else 0,
            "spc_series": int(spc["c"]) if spc else 0,
            "chrono_sessions": int(chrono["c"]) if chrono else 0,
        }

    def delete_node_subtree(self, root_id: str, user: Dict[str, Any]) -> Tuple[bool, int, str]:
        ids = self.collect_node_subtree_ids(root_id)
        if not ids:
            return (False, 0, "not_found")
        linked = self.count_node_linked_data(ids)
        if linked["jobs"] > 0 or linked["spc_series"] > 0 or linked["chrono_sessions"] > 0:
            return (False, 0, "linked_data")
        with db.lock:
            cur = db.conn.cursor()
            try:
                marks = ",".join("?" for _ in ids)
                cur.execute("BEGIN")
                cur.execute(f"DELETE FROM nodes WHERE id IN ({marks})", tuple(ids))
                deleted = int(cur.rowcount or 0)
                for nid in ids:
                    cur.execute(
                        "INSERT INTO sync_log(table_name,record_id,action,changed_at,changed_by) VALUES(?,?,?,?,?)",
                        ("nodes", nid, "delete", now_iso(), user.get("id", "")),
                    )
                db.conn.commit()
            except Exception:
                db.conn.rollback()
                raise
        return (True, deleted, "")

    def _float_or_none(self, value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            if isinstance(value, str) and not value.strip():
                return None
            return float(value)
        except Exception:
            return None

    def build_spc_snapshot(self, series_id: str) -> Dict[str, Any]:
        sid = str(series_id or "").strip()
        if not sid:
            return {}
        series = db.query_one("SELECT * FROM spc_series WHERE id=?", (sid,))
        if series is None:
            return {}
        characteristic_id = str(series["characteristic_id"] or "")
        ch = db.query_one("SELECT * FROM spc_characteristics WHERE id=?", (characteristic_id,)) if characteristic_id else None
        snap = {
            "captured_at": now_iso(),
            "series_id": sid,
            "series_node_id": str(series["node_id"] or ""),
            "series_active": int(series["active"] or 0),
            "characteristic_id": characteristic_id,
            "characteristic_name": str(ch["name"] or "") if ch else "",
            "usl": self._float_or_none(ch["usl"]) if ch else None,
            "lsl": self._float_or_none(ch["lsl"]) if ch else None,
            "target": self._float_or_none(ch["target"]) if ch else None,
            "unit": str(ch["unit"] or "") if ch else "",
        }
        return snap

    def api_clone_node(self, node_id: str, user: Dict[str, Any]) -> None:
        root_id = str(unquote(node_id or "")).strip()
        if not root_id:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_node_id"})
            return
        ids = self.collect_node_subtree_ids(root_id)
        if not ids:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return
        marks = ",".join("?" for _ in ids)
        rows = db.query_all(f"SELECT * FROM nodes WHERE id IN ({marks})", tuple(ids))
        if not rows:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return
        by_id: Dict[str, Dict[str, Any]] = {str(r["id"] or ""): row_to_dict(r) for r in rows}
        root = by_id.get(root_id)
        if not root:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return

        children_by_parent: Dict[str, List[str]] = {}
        for nid, row in by_id.items():
            pid = str(row.get("parent_id") or "")
            children_by_parent.setdefault(pid, []).append(nid)
        for pid in children_by_parent:
            children_by_parent[pid].sort(
                key=lambda nid: int(by_id.get(nid, {}).get("order_index") or 0)
            )

        ordered_ids: List[str] = []
        queue = [root_id]
        seen = set()
        while queue:
            cur = queue.pop(0)
            if cur in seen:
                continue
            seen.add(cur)
            ordered_ids.append(cur)
            queue.extend(children_by_parent.get(cur, []))

        old_to_new = {oid: str(uuid.uuid4()) for oid in ordered_ids}
        now = now_iso()
        new_rows: List[Dict[str, Any]] = []
        for oid in ordered_ids:
            src = by_id[oid]
            if oid == root_id:
                new_parent = src.get("parent_id")
            else:
                src_parent = str(src.get("parent_id") or "")
                new_parent = old_to_new.get(src_parent) if src_parent in old_to_new else src.get("parent_id")
            new_rows.append(
                {
                    "id": old_to_new[oid],
                    "name": str(src.get("name") or "Node"),
                    "parent_id": new_parent,
                    "type": str(src.get("type") or "Custom"),
                    "order_index": int(src.get("order_index") or 0),
                    "image_url": str(src.get("image_url") or ""),
                    "meta_json": str(src.get("meta_json") or "{}"),
                    "created_by": user.get("id", ""),
                    "created_at": now,
                    "updated_at": now,
                }
            )

        with db.lock:
            cur = db.conn.cursor()
            try:
                cur.execute("BEGIN")
                for row in new_rows:
                    cur.execute(
                        """
                        INSERT INTO nodes(id,name,parent_id,type,order_index,image_url,meta_json,created_by,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            row["id"],
                            row["name"],
                            row["parent_id"],
                            row["type"],
                            row["order_index"],
                            row["image_url"],
                            row["meta_json"],
                            row["created_by"],
                            row["created_at"],
                            row["updated_at"],
                        ),
                    )
                    cur.execute(
                        "INSERT INTO sync_log(table_name,record_id,action,changed_at,changed_by) VALUES(?,?,?,?,?)",
                        ("nodes", row["id"], "create", now_iso(), user.get("id", "")),
                    )
                db.conn.commit()
            except Exception:
                db.conn.rollback()
                raise

        new_root_id = old_to_new[root_id]
        out = db.query_one("SELECT * FROM nodes WHERE id=?", (new_root_id,))
        if not out:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "clone_failed"})
            return
        self.send_json(HTTPStatus.CREATED, {"ok": True, "item": decode_record("nodes", row_to_dict(out))})

    def api_table(self, method: str, parts: List[str], table: str, query: Dict[str, List[str]]) -> None:
        min_role = "operator" if method == "GET" else "manager"
        if table in {"chrono_events", "spc_measurements"} and method in {"POST", "PUT", "PATCH"}:
            min_role = "operator"
        user = self.require_auth(min_role)
        if not user:
            return

        table_cols = {
            "nodes": ["id", "name", "parent_id", "type", "order_index", "image_url", "meta_json", "created_by", "created_at", "updated_at"],
            "products": ["id", "code", "name", "parent_product_id", "image_url", "meta_json", "created_at", "updated_at"],
            "jobs": ["id", "name", "node_id", "product_id", "status", "meta_json", "created_by", "created_at", "updated_at"],
            "chrono_sessions": ["id", "node_id", "job_id", "user_id", "started_at", "ended_at", "notes", "data_json", "created_at", "updated_at"],
            "chrono_events": ["id", "session_id", "event_type", "timestamp_ms", "label", "meta_json"],
            "spc_characteristics": ["id", "name", "usl", "lsl", "target", "unit", "meta_json", "created_at", "updated_at"],
            "spc_series": ["id", "node_id", "characteristic_id", "active", "meta_json", "created_at", "updated_at"],
            "spc_measurements": ["id", "series_id", "node_id", "user_id", "value", "timestamp", "out_of_control", "rule_flags", "meta_json"],
        }

        id_key = parts[2] if len(parts) >= 3 else ""

        # Historical data rules:
        # - SPC measurements are append-only.
        # - Chrono events are append-only.
        # - Closed chrono sessions cannot be edited.
        if method in {"PUT", "PATCH"} and id_key and table == "spc_measurements":
            self.send_json(HTTPStatus.CONFLICT, {"ok": False, "error": "immutable_history", "message": "SPC measurements are immutable."})
            return
        if method in {"PUT", "PATCH"} and id_key and table == "chrono_events":
            self.send_json(HTTPStatus.CONFLICT, {"ok": False, "error": "immutable_history", "message": "Chrono events are immutable."})
            return
        if method in {"PUT", "PATCH"} and id_key and table == "chrono_sessions":
            current = db.query_one("SELECT ended_at FROM chrono_sessions WHERE id=?", (unquote(id_key),))
            if current is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                return
            if str(current["ended_at"] or "").strip():
                self.send_json(
                    HTTPStatus.CONFLICT,
                    {"ok": False, "error": "immutable_history", "message": "Closed chrono sessions are immutable."},
                )
                return

        if method == "GET" and not id_key:
            sql = f"SELECT * FROM {table}"
            where: List[str] = []
            params: List[Any] = []
            for k, vs in query.items():
                if not vs:
                    continue
                col = str(k)
                if col not in table_cols[table]:
                    continue
                where.append(f"{col}=?")
                params.append(vs[0])
            if where:
                sql += " WHERE " + " AND ".join(where)
            if "updated_at" in table_cols[table]:
                sql += " ORDER BY updated_at DESC"
            elif "timestamp_ms" in table_cols[table]:
                sql += " ORDER BY timestamp_ms DESC"
            rows = db.query_all(sql, tuple(params))
            self.send_json(HTTPStatus.OK, {"ok": True, "items": [decode_record(table, row_to_dict(r)) for r in rows]})
            return

        if method == "GET" and id_key:
            row = db.query_one(f"SELECT * FROM {table} WHERE id=?", (unquote(id_key),))
            if row is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                return
            self.send_json(HTTPStatus.OK, {"ok": True, "item": decode_record(table, row_to_dict(row))})
            return

        if method == "POST":
            try:
                body = self.read_json_body()
            except ValueError:
                return
            try:
                row = self._create_table_row(table, body, user)
            except ValueError as err:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload", "message": str(err)})
                return
            self.send_json(HTTPStatus.CREATED, {"ok": True, "item": row})
            return

        if method in {"PUT", "PATCH"} and id_key:
            try:
                body = self.read_json_body()
            except ValueError:
                return
            try:
                row = self._update_table_row(table, unquote(id_key), body, user)
            except ValueError as err:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload", "message": str(err)})
                return
            if row is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            else:
                self.send_json(HTTPStatus.OK, {"ok": True, "item": row})
            return

        if method == "DELETE" and id_key:
            rid = unquote(id_key)
            if table in {"chrono_sessions", "chrono_events", "spc_measurements"}:
                self.send_json(
                    HTTPStatus.CONFLICT,
                    {"ok": False, "error": "immutable_history", "message": f"{table} records cannot be deleted."},
                )
                return
            if table == "nodes":
                ok, deleted, reason = self.delete_node_subtree(rid, user)
                if not ok:
                    if reason == "not_found":
                        self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                        return
                    if reason == "linked_data":
                        self.send_json(
                            HTTPStatus.CONFLICT,
                            {
                                "ok": False,
                                "error": "linked_data",
                                "message": "Cannot delete node subtree with linked jobs/SPC/chrono data.",
                            },
                        )
                        return
                    self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "delete_failed"})
                    return
                self.send_json(HTTPStatus.OK, {"ok": True, "deleted": deleted})
                return
            count = db.execute(f"DELETE FROM {table} WHERE id=?", (rid,))
            if count <= 0:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                return
            db.log_sync(table, rid, "delete", user["id"])
            self.send_json(HTTPStatus.OK, {"ok": True})
            return

        self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"ok": False, "error": "method_not_allowed"})

    def _create_table_row(self, table: str, body: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
        now = now_iso()
        rid = str(body.get("id") or uuid.uuid4())

        if table == "nodes":
            row = {
                "id": rid,
                "name": str(body.get("name") or "Node"),
                "parent_id": body.get("parent_id"),
                "type": str(body.get("type") or "Custom"),
                "order_index": int(body.get("order_index") or 0),
                "image_url": str(body.get("image_url") or ""),
                "meta_json": json.dumps(body.get("meta") or {}, ensure_ascii=False),
                "created_by": user["id"],
                "created_at": now,
                "updated_at": now,
            }
        elif table == "products":
            row = {
                "id": rid,
                "code": str(body.get("code") or ""),
                "name": str(body.get("name") or "Product"),
                "parent_product_id": body.get("parent_product_id"),
                "image_url": str(body.get("image_url") or ""),
                "meta_json": json.dumps(body.get("meta") or {}, ensure_ascii=False),
                "created_at": now,
                "updated_at": now,
            }
        elif table == "jobs":
            row = {
                "id": rid,
                "name": str(body.get("name") or "Job"),
                "node_id": body.get("node_id"),
                "product_id": body.get("product_id"),
                "status": str(body.get("status") or "active"),
                "meta_json": json.dumps(body.get("meta") or {}, ensure_ascii=False),
                "created_by": user["id"],
                "created_at": now,
                "updated_at": now,
            }
        elif table == "chrono_sessions":
            row = {
                "id": rid,
                "node_id": body.get("node_id"),
                "job_id": body.get("job_id"),
                "user_id": body.get("user_id") or user["id"],
                "started_at": str(body.get("started_at") or now),
                "ended_at": body.get("ended_at"),
                "notes": str(body.get("notes") or ""),
                "data_json": json.dumps(body.get("data") or {}, ensure_ascii=False),
                "created_at": now,
                "updated_at": now,
            }
        elif table == "chrono_events":
            row = {
                "id": rid,
                "session_id": str(body.get("session_id") or ""),
                "event_type": str(body.get("event_type") or "event"),
                "timestamp_ms": int(body.get("timestamp_ms") or int(time.time() * 1000)),
                "label": str(body.get("label") or ""),
                "meta_json": json.dumps(body.get("meta") or {}, ensure_ascii=False),
            }
        elif table == "spc_characteristics":
            row = {
                "id": rid,
                "name": str(body.get("name") or "Characteristic"),
                "usl": body.get("usl"),
                "lsl": body.get("lsl"),
                "target": body.get("target"),
                "unit": str(body.get("unit") or ""),
                "meta_json": json.dumps(body.get("meta") or {}, ensure_ascii=False),
                "created_at": now,
                "updated_at": now,
            }
        elif table == "spc_series":
            row = {
                "id": rid,
                "node_id": body.get("node_id"),
                "characteristic_id": body.get("characteristic_id"),
                "active": 1 if body.get("active", True) else 0,
                "meta_json": json.dumps(body.get("meta") or {}, ensure_ascii=False),
                "created_at": now,
                "updated_at": now,
            }
        elif table == "spc_measurements":
            series_id = str(body.get("series_id") or "").strip()
            if not series_id:
                raise ValueError("series_id is required for spc_measurements")
            value_raw = body.get("value")
            try:
                value_num = float(value_raw)
            except Exception:
                raise ValueError("value must be numeric for spc_measurements")
            snapshot = self.build_spc_snapshot(series_id)
            if not snapshot:
                raise ValueError("series_id not found for spc_measurements")
            incoming_meta = body.get("meta")
            meta_obj = incoming_meta if isinstance(incoming_meta, dict) else {}
            snapshot_container = dict(snapshot)
            meta_out = {
                **meta_obj,
                "snapshot": snapshot_container,
                "tolerance_snapshot": {
                    "usl": snapshot_container.get("usl"),
                    "lsl": snapshot_container.get("lsl"),
                    "target": snapshot_container.get("target"),
                    "unit": snapshot_container.get("unit"),
                    "characteristic_id": snapshot_container.get("characteristic_id"),
                    "characteristic_name": snapshot_container.get("characteristic_name"),
                    "captured_at": snapshot_container.get("captured_at"),
                },
            }
            lsl = self._float_or_none(snapshot_container.get("lsl"))
            usl = self._float_or_none(snapshot_container.get("usl"))
            auto_ooc = (lsl is not None and value_num < lsl) or (usl is not None and value_num > usl)
            body_ooc = bool(body.get("out_of_control", False))
            out_of_control = 1 if (body_ooc or auto_ooc) else 0
            rule_flags = str(body.get("rule_flags") or "").strip()
            if auto_ooc:
                parts = [x.strip() for x in rule_flags.split(",") if x.strip()]
                if "tol" not in parts:
                    parts.append("tol")
                rule_flags = ",".join(parts)
            row = {
                "id": rid,
                "series_id": series_id,
                "node_id": body.get("node_id") or snapshot_container.get("series_node_id"),
                "user_id": body.get("user_id") or user["id"],
                "value": value_num,
                "timestamp": str(body.get("timestamp") or now),
                "out_of_control": out_of_control,
                "rule_flags": rule_flags,
                "meta_json": json.dumps(meta_out, ensure_ascii=False),
            }
        else:
            raise ValueError("unknown table")

        cols = list(row.keys())
        vals = tuple(row[c] for c in cols)
        db.execute(
            f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?'] * len(cols))})",
            vals,
        )
        db.log_sync(table, rid, "create", user["id"])
        saved = db.query_one(f"SELECT * FROM {table} WHERE id=?", (rid,))
        if not saved:
            return decode_record(table, row)
        return decode_record(table, row_to_dict(saved))

    def _update_table_row(self, table: str, rid: str, body: Dict[str, Any], user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        current = db.query_one(f"SELECT * FROM {table} WHERE id=?", (rid,))
        if current is None:
            return None

        updates: Dict[str, Any] = {}
        if table == "nodes":
            for key in ["name", "parent_id", "type", "order_index", "image_url"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)
            updates["updated_at"] = now_iso()
        elif table == "products":
            for key in ["code", "name", "parent_product_id", "image_url"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)
            updates["updated_at"] = now_iso()
        elif table == "jobs":
            for key in ["name", "node_id", "product_id", "status"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)
            updates["updated_at"] = now_iso()
        elif table == "chrono_sessions":
            for key in ["node_id", "job_id", "user_id", "started_at", "ended_at", "notes"]:
                if key in body:
                    updates[key] = body.get(key)
            if "data" in body:
                updates["data_json"] = json.dumps(body.get("data") or {}, ensure_ascii=False)
            updates["updated_at"] = now_iso()
        elif table == "chrono_events":
            for key in ["session_id", "event_type", "timestamp_ms", "label"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)
        elif table == "spc_characteristics":
            for key in ["name", "usl", "lsl", "target", "unit"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)
            updates["updated_at"] = now_iso()
        elif table == "spc_series":
            for key in ["node_id", "characteristic_id", "active"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)
            updates["updated_at"] = now_iso()
        elif table == "spc_measurements":
            for key in ["series_id", "node_id", "user_id", "value", "timestamp", "out_of_control", "rule_flags"]:
                if key in body:
                    updates[key] = body.get(key)
            if "meta" in body:
                updates["meta_json"] = json.dumps(body.get("meta") or {}, ensure_ascii=False)

        if not updates:
            saved = db.query_one(f"SELECT * FROM {table} WHERE id=?", (rid,))
            return decode_record(table, row_to_dict(saved)) if saved else None

        cols = ", ".join(f"{k}=?" for k in updates.keys())
        vals = tuple(updates.values()) + (rid,)
        db.execute(f"UPDATE {table} SET {cols} WHERE id=?", vals)
        db.log_sync(table, rid, "update", user["id"])
        saved = db.query_one(f"SELECT * FROM {table} WHERE id=?", (rid,))
        return decode_record(table, row_to_dict(saved)) if saved else None

    def serve_status_page(self) -> None:
        ip = get_local_ip()
        port = self.server.server_port if self.server else DEFAULT_PORT
        html = f"""<!doctype html>
<html>
<head>
<meta charset=\"utf-8\" />
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
<title>VMill Local Server</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 0; background: #0b1020; color: #e8eef8; }}
  .wrap {{ max-width: 840px; margin: 32px auto; padding: 18px; }}
  .card {{ background: #141d33; border: 1px solid #2f3d61; border-radius: 12px; padding: 16px; margin-bottom: 14px; }}
  .ok {{ color: #7be8a5; }}
  a {{ color: #7cc8ff; text-decoration: none; }}
</style>
</head>
<body>
  <div class=\"wrap\">
    <div class=\"card\">
      <h1 style=\"margin-top:0\">VMill Local Server</h1>
      <p class=\"ok\">Online</p>
      <p>Address: <code>http://{ip}:{port}</code></p>
      <p>Database: <code>{DB_PATH.name}</code></p>
      <p>Default user: <code>admin / vmill2024</code></p>
      <p>Open: <a href=\"/login.html\">/login.html</a></p>
    </div>
  </div>
</body>
</html>"""
        raw = html.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def serve_static(self, req_path: str) -> None:
        clean = unquote(req_path).split("?", 1)[0].split("#", 1)[0]
        rel = clean.lstrip("/")
        if not rel:
            self.serve_status_page()
            return

        candidates = [
            (PUBLIC_DIR / rel),
            (ROOT_DIR / rel),
        ]

        target: Optional[Path] = None
        for cand in candidates:
            try:
                resolved = cand.resolve()
            except Exception:
                continue
            if not resolved.exists() or not resolved.is_file():
                continue
            if str(resolved).startswith(str(PUBLIC_DIR.resolve())) or str(resolved).startswith(str(ROOT_DIR.resolve())):
                target = resolved
                break

        if target is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "file_not_found"})
            return

        try:
            content = target.read_bytes()
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "read_failed"})
            return

        ctype, _ = mimetypes.guess_type(str(target))
        if not ctype:
            ctype = "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def run() -> None:
    db.init_schema()
    host = "0.0.0.0"
    port = DEFAULT_PORT
    ip = get_local_ip()
    print(f"VMill server ready: http://{ip}:{port} (0.0.0.0:{port})")
    print(f"SQLite: {DB_PATH}")
    print("Default user: admin / vmill2024")

    server = ThreadingHTTPServer((host, port), VMillHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
