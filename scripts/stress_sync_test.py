#!/usr/bin/env python3
"""
VMill sync stress test (stdlib only).

What it does:
- Starts an isolated vmill_server.py instance with a temporary SQLite DB (default),
  or targets an already-running server (--server-url).
- Logs in admin, creates many users, and runs concurrent workers.
- Workers perform poll/pull/push/list/update loops to stress sync + CRUD paths.
- Collects HTTP/error/conflict metrics and validates DB invariants at the end.

Usage examples:
  python3 scripts/stress_sync_test.py
  python3 scripts/stress_sync_test.py --users 40 --duration 45 --workers 40
  python3 scripts/stress_sync_test.py --server-url http://127.0.0.1:8080 --no-db-check
"""

from __future__ import annotations

import argparse
import json
import os
import random
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASS = "vmill2024"


def now_ms() -> int:
    return int(time.time() * 1000)


def find_free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = int(s.getsockname()[1])
    s.close()
    return port


def json_dumps(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def http_json(
    base_url: str,
    method: str,
    path: str,
    *,
    token: str = "",
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 8.0,
) -> Tuple[int, Dict[str, Any], str]:
    url = f"{base_url.rstrip('/')}{path}"
    data = json_dumps(payload) if payload is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url=url, method=method.upper(), data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except Exception:
                parsed = {}
            return int(resp.status), parsed if isinstance(parsed, dict) else {}, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {}
        return int(e.code), parsed if isinstance(parsed, dict) else {}, raw
    except Exception as e:
        return 0, {"ok": False, "error": f"transport:{type(e).__name__}"}, str(e)


@dataclass
class WorkerResult:
    user: str
    ops: int
    status_counts: Dict[int, int]
    type_counts: Dict[str, int]
    errors: List[str]
    conflicts: int
    pushes_ok: int
    pulls_ok: int
    polls_ok: int


class Metrics:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.status_counts: Counter[int] = Counter()
        self.type_counts: Counter[str] = Counter()
        self.errors: List[str] = []
        self.conflicts = 0
        self.pushes_ok = 0
        self.pulls_ok = 0
        self.polls_ok = 0
        self.total_ops = 0

    def add(self, result: WorkerResult) -> None:
        with self.lock:
            self.total_ops += int(result.ops)
            self.conflicts += int(result.conflicts)
            self.pushes_ok += int(result.pushes_ok)
            self.pulls_ok += int(result.pulls_ok)
            self.polls_ok += int(result.polls_ok)
            self.status_counts.update(result.status_counts)
            self.type_counts.update(result.type_counts)
            self.errors.extend(result.errors[:20])


def wait_server_ready(base_url: str, timeout_s: float = 20.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        status, data, _ = http_json(base_url, "GET", "/api/status", timeout=2.5)
        if status == 200 and bool(data.get("ok")):
            return True
        time.sleep(0.3)
    return False


def create_or_login_user(base_url: str, admin_token: str, username: str, password: str, role: str) -> str:
    # Try create first (ignore conflict), then login.
    http_json(
        base_url,
        "POST",
        "/api/users",
        token=admin_token,
        payload={"username": username, "password": password, "role": role},
    )
    status, data, raw = http_json(
        base_url,
        "POST",
        "/api/auth/login",
        payload={"username": username, "password": password},
    )
    if status != 200 or not data.get("token"):
        raise RuntimeError(f"login failed for {username}: status={status} body={raw[:300]}")
    return str(data.get("token"))


def ensure_seed_records(base_url: str, manager_token: str, count: int = 6) -> Tuple[List[str], List[str], List[str]]:
    product_ids: List[str] = []
    node_ids: List[str] = []
    job_ids: List[str] = []

    for i in range(count):
        p_code = f"TSTP{i+1:03d}"
        p_name = f"Stress Product {i+1}"
        s_name = f"Stress Node {i+1}"
        j_name = f"Stress Job {i+1}"

        st, data, _ = http_json(
            base_url,
            "POST",
            "/api/products",
            token=manager_token,
            payload={"code": p_code, "name": p_name, "meta": {"seed": True}},
        )
        if st in (200, 201) and isinstance(data.get("item"), dict):
            pid = str(data["item"].get("id") or "")
            if pid:
                product_ids.append(pid)

        st, data, _ = http_json(
            base_url,
            "POST",
            "/api/nodes",
            token=manager_token,
            payload={"name": s_name, "type": "Station", "meta": {"seed": True}},
        )
        node_id = ""
        if st in (200, 201) and isinstance(data.get("item"), dict):
            node_id = str(data["item"].get("id") or "")
            if node_id:
                node_ids.append(node_id)

        product_id = random.choice(product_ids) if product_ids else ""
        st, data, _ = http_json(
            base_url,
            "POST",
            "/api/jobs",
            token=manager_token,
            payload={
                "name": j_name,
                "node_id": node_id or None,
                "product_id": product_id or None,
                "status": "active",
                "meta": {"seed": True},
            },
        )
        if st in (200, 201) and isinstance(data.get("item"), dict):
            jid = str(data["item"].get("id") or "")
            if jid:
                job_ids.append(jid)

    # Re-read all ids in case some already existed.
    st, data, _ = http_json(base_url, "GET", "/api/products", token=manager_token)
    if st == 200:
        product_ids = [str(x.get("id") or "") for x in (data.get("items") or []) if str(x.get("id") or "")]
    st, data, _ = http_json(base_url, "GET", "/api/nodes", token=manager_token)
    if st == 200:
        node_ids = [str(x.get("id") or "") for x in (data.get("items") or []) if str(x.get("id") or "")]
    st, data, _ = http_json(base_url, "GET", "/api/jobs", token=manager_token)
    if st == 200:
        job_ids = [str(x.get("id") or "") for x in (data.get("items") or []) if str(x.get("id") or "")]

    return product_ids, node_ids, job_ids


def worker_loop(
    base_url: str,
    username: str,
    password: str,
    is_manager: bool,
    duration_s: float,
    product_ids: List[str],
    node_ids: List[str],
    job_ids: List[str],
) -> WorkerResult:
    status_counts: Counter[int] = Counter()
    type_counts: Counter[str] = Counter()
    errors: List[str] = []
    conflicts = 0
    pushes_ok = 0
    pulls_ok = 0
    polls_ok = 0
    ops = 0
    rev = 0

    st, data, raw = http_json(base_url, "POST", "/api/auth/login", payload={"username": username, "password": password})
    status_counts[st] += 1
    if st != 200 or not data.get("token"):
        return WorkerResult(username, ops, dict(status_counts), dict(type_counts), [f"login_fail:{st}:{raw[:140]}"], conflicts, pushes_ok, pulls_ok, polls_ok)
    token = str(data["token"])

    deadline = time.time() + max(1.0, duration_s)
    rand = random.Random(hash(username) ^ now_ms())
    seq = 0

    while time.time() < deadline:
        seq += 1
        pick = rand.random()
        try:
            # 40% poll, 20% pull, 20% push, 20% CRUD/list.
            if pick < 0.40:
                tname = "poll"
                st, data, _ = http_json(base_url, "GET", f"/api/sync/poll?since={rev}", token=token)
                status_counts[st] += 1
                type_counts[tname] += 1
                if st == 200:
                    polls_ok += 1
                    rev = max(rev, int(data.get("rev") or rev))

            elif pick < 0.60:
                tname = "pull"
                st, data, _ = http_json(base_url, "GET", "/api/sync/pull", token=token)
                status_counts[st] += 1
                type_counts[tname] += 1
                if st == 200:
                    pulls_ok += 1
                    rev = max(rev, int(data.get("rev") or rev))

            elif pick < 0.80:
                tname = "push"
                payload = {
                    "base_rev": rev,
                    "client_id": f"stress-{username}",
                    "modules": {
                        "meta": {"updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                        "store": {
                            "stress_test": [{
                                "id": f"{username}-{seq}",
                                "user": username,
                                "seq": seq,
                                "ts": now_ms(),
                            }]
                        },
                    },
                }
                st, data, _ = http_json(base_url, "POST", "/api/sync/push", token=token, payload=payload)
                status_counts[st] += 1
                type_counts[tname] += 1
                if st == 200:
                    pushes_ok += 1
                    rev = max(rev, int(data.get("rev") or rev))
                elif st == 409:
                    conflicts += 1
                    # conflict-recovery pull
                    st2, data2, _ = http_json(base_url, "GET", "/api/sync/pull", token=token)
                    status_counts[st2] += 1
                    type_counts["pull_after_conflict"] += 1
                    if st2 == 200:
                        pulls_ok += 1
                        rev = max(rev, int(data2.get("rev") or rev))

            else:
                tname = "crud"
                # Read-heavy with occasional manager update.
                st, data, _ = http_json(base_url, "GET", "/api/jobs", token=token)
                status_counts[st] += 1
                type_counts["list_jobs"] += 1
                if st == 200 and (data.get("items") or []):
                    j = rand.choice(data.get("items") or [])
                    jid = str(j.get("id") or "")
                    if is_manager and jid and rand.random() < 0.45:
                        # manager-only path; operator will return 403 (counted).
                        new_status = rand.choice(["active", "hold", "done"])
                        st2, _, _ = http_json(
                            base_url,
                            "PUT",
                            f"/api/jobs/{urllib.parse.quote(jid)}",
                            token=token,
                            payload={"status": new_status, "meta": {"touchedBy": username, "seq": seq}},
                        )
                        status_counts[st2] += 1
                        type_counts["update_job"] += 1
                if rand.random() < 0.35 and product_ids:
                    pid = rand.choice(product_ids)
                    st3, _, _ = http_json(base_url, "GET", f"/api/products/{urllib.parse.quote(pid)}", token=token)
                    status_counts[st3] += 1
                    type_counts["get_product"] += 1

            ops += 1
        except Exception as e:
            errors.append(f"{type(e).__name__}:{e}")
            if len(errors) > 30:
                break

    return WorkerResult(
        user=username,
        ops=ops,
        status_counts=dict(status_counts),
        type_counts=dict(type_counts),
        errors=errors,
        conflicts=conflicts,
        pushes_ok=pushes_ok,
        pulls_ok=pulls_ok,
        polls_ok=polls_ok,
    )


def db_checks(db_path: Path) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ok": True, "checks": {}}
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS c FROM users")
        users = int(cur.fetchone()["c"])
        out["checks"]["users_count"] = users
        if users < 1:
            out["ok"] = False
            out.setdefault("issues", []).append("no_users")

        cur.execute("SELECT COUNT(*) AS c FROM sync_log")
        logs = int(cur.fetchone()["c"])
        out["checks"]["sync_log_count"] = logs
        if logs < 1:
            out["ok"] = False
            out.setdefault("issues", []).append("no_sync_log_entries")

        cur.execute("SELECT id, settings_json, updated_at FROM workspace WHERE id='default'")
        row = cur.fetchone()
        if not row:
            out["ok"] = False
            out.setdefault("issues", []).append("workspace_default_missing")
        else:
            out["checks"]["workspace_updated_at"] = str(row["updated_at"] or "")
            try:
                ws = json.loads(str(row["settings_json"] or "{}"))
                out["checks"]["workspace_has_app_key"] = isinstance(ws, dict) and ("app" in ws or "modules" in ws)
            except Exception:
                out["ok"] = False
                out.setdefault("issues", []).append("workspace_settings_invalid_json")

        cur.execute("SELECT COALESCE(MAX(id), 0) AS mx FROM sync_log")
        max_rev = int(cur.fetchone()["mx"])
        out["checks"]["max_sync_rev"] = max_rev

        cur.execute("SELECT COUNT(*) AS c FROM tokens")
        out["checks"]["active_tokens"] = int(cur.fetchone()["c"])
    finally:
        conn.close()
    return out


def start_isolated_server(project_root: Path) -> Tuple[subprocess.Popen, str, Path]:
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    tmp = tempfile.TemporaryDirectory(prefix="vmill_stress_")
    db_path = Path(tmp.name) / "vmill_stress.db"

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["VMILL_DB_PATH"] = str(db_path)
    env.setdefault("PYTHONUNBUFFERED", "1")

    proc = subprocess.Popen(
        [sys.executable, str(project_root / "vmill_server.py")],
        cwd=str(project_root),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    # keep tempdir alive by attaching
    proc._vmill_tmpdir = tmp  # type: ignore[attr-defined]
    return proc, base_url, db_path


def stop_isolated_server(proc: subprocess.Popen) -> None:
    try:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)
    finally:
        tmp = getattr(proc, "_vmill_tmpdir", None)
        if tmp is not None:
            try:
                tmp.cleanup()
            except Exception:
                pass


def run_stress(args: argparse.Namespace) -> int:
    project_root = Path(__file__).resolve().parent.parent
    isolated_proc: Optional[subprocess.Popen] = None
    db_path: Optional[Path] = None
    base_url = args.server_url.strip()

    try:
        if not base_url:
            isolated_proc, base_url, db_path = start_isolated_server(project_root)
            print(f"[stress] started isolated vmill_server at {base_url}")
            if not wait_server_ready(base_url, timeout_s=25):
                print("[stress] server did not become ready in time")
                if isolated_proc.stdout:
                    print(isolated_proc.stdout.read()[:4000])
                return 2
        else:
            if not wait_server_ready(base_url, timeout_s=10):
                print(f"[stress] target server not ready: {base_url}")
                return 2

        # Admin login.
        st, data, raw = http_json(
            base_url,
            "POST",
            "/api/auth/login",
            payload={"username": args.admin_user, "password": args.admin_pass},
        )
        if st != 200 or not data.get("token"):
            print(f"[stress] admin login failed: status={st} body={raw[:500]}")
            return 2
        admin_token = str(data["token"])

        # Create users + one manager token for seed actions.
        users: List[Tuple[str, str, bool]] = []
        manager_user = f"mgr_{uuid.uuid4().hex[:8]}"
        manager_pass = "vmill_mgr_2026"
        manager_token = create_or_login_user(base_url, admin_token, manager_user, manager_pass, "manager")
        for i in range(max(1, args.users)):
            uname = f"u_{i+1:03d}_{uuid.uuid4().hex[:6]}"
            upass = "vmill_op_2026"
            role = "manager" if (i % max(2, args.manager_ratio)) == 0 else "operator"
            try:
                create_or_login_user(base_url, admin_token, uname, upass, role)
                users.append((uname, upass, role == "manager"))
            except Exception as e:
                print(f"[stress] skip user {uname}: {e}")

        if not users:
            print("[stress] no users created, aborting")
            return 2

        product_ids, node_ids, job_ids = ensure_seed_records(base_url, manager_token, count=max(4, args.seed_records))
        print(
            f"[stress] seeded baseline data: products={len(product_ids)} nodes={len(node_ids)} jobs={len(job_ids)} users={len(users)}"
        )

        # Concurrent workload.
        metrics = Metrics()
        workers = min(max(1, args.workers), len(users))
        selected = users[:workers]
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [
                ex.submit(
                    worker_loop,
                    base_url,
                    uname,
                    upass,
                    is_manager,
                    float(args.duration),
                    product_ids,
                    node_ids,
                    job_ids,
                )
                for (uname, upass, is_manager) in selected
            ]
            for fut in as_completed(futures):
                try:
                    metrics.add(fut.result())
                except Exception as e:
                    metrics.errors.append(f"worker_crash:{type(e).__name__}:{e}")
        elapsed = max(0.001, time.time() - t0)

        # Final pull + status.
        st, data, _ = http_json(base_url, "GET", "/api/sync/pull", token=admin_token)
        final_rev = int(data.get("rev") or 0) if st == 200 else -1

        # Report.
        print("\n=== STRESS TEST SUMMARY ===")
        print(f"server: {base_url}")
        print(f"workers: {workers}, duration: {args.duration}s, elapsed: {elapsed:.2f}s")
        print(f"ops: {metrics.total_ops}, ops/s: {metrics.total_ops / elapsed:.1f}")
        print(f"push_ok={metrics.pushes_ok} pull_ok={metrics.pulls_ok} poll_ok={metrics.polls_ok} conflicts={metrics.conflicts}")

        major_statuses = sorted((k, v) for k, v in metrics.status_counts.items() if v > 0)
        print("http_status_counts:", major_statuses)

        top_types = sorted(metrics.type_counts.items(), key=lambda kv: kv[1], reverse=True)[:12]
        print("top_ops:", top_types)
        print(f"final_rev_from_pull={final_rev}")

        # Hard fail criteria.
        bad_5xx = sum(v for k, v in metrics.status_counts.items() if k >= 500)
        transport_err = sum(1 for k in metrics.status_counts if k == 0)
        unauthorized = metrics.status_counts.get(401, 0) + metrics.status_counts.get(403, 0)
        failure = False
        if bad_5xx > 0:
            print(f"[FAIL] server returned 5xx responses: {bad_5xx}")
            failure = True
        if transport_err > max(3, workers):
            print(f"[FAIL] transport errors too high: {transport_err}")
            failure = True
        elif transport_err > 0:
            print(f"[WARN] transport errors (transient): {transport_err}")
        # Some 403 may happen from operator trying manager updates; don't hard-fail unless excessive.
        if unauthorized > max(10, workers * 4):
            print(f"[WARN] high auth denials: {unauthorized}")
        if metrics.total_ops < workers * 8:
            print("[FAIL] too few operations completed")
            failure = True

        if args.db_check and db_path and db_path.exists():
            checks = db_checks(db_path)
            print("db_checks:", json.dumps(checks, indent=2))
            if not checks.get("ok"):
                failure = True

        if metrics.errors:
            print("\nworker_errors(sample):")
            for line in metrics.errors[:20]:
                print(" -", line)

        return 1 if failure else 0
    except Exception:
        print("[stress] fatal exception")
        traceback.print_exc()
        return 2
    finally:
        if isolated_proc is not None:
            stop_isolated_server(isolated_proc)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="VMill sync/API stress test")
    p.add_argument("--server-url", default="", help="Target existing server (e.g. http://127.0.0.1:8080). Empty = start isolated server.")
    p.add_argument("--users", type=int, default=32, help="Number of test users to create.")
    p.add_argument("--workers", type=int, default=24, help="Concurrent worker threads.")
    p.add_argument("--duration", type=int, default=35, help="Per-worker test duration (seconds).")
    p.add_argument("--seed-records", type=int, default=8, help="Seed products/nodes/jobs count before stress.")
    p.add_argument("--manager-ratio", type=int, default=5, help="Every Nth user is manager (rest operators).")
    p.add_argument("--admin-user", default=DEFAULT_ADMIN_USER, help="Admin username.")
    p.add_argument("--admin-pass", default=DEFAULT_ADMIN_PASS, help="Admin password.")
    p.add_argument("--no-db-check", dest="db_check", action="store_false", help="Skip SQLite checks (for external server).")
    p.set_defaults(db_check=True)
    return p.parse_args()


if __name__ == "__main__":
    raise SystemExit(run_stress(parse_args()))
