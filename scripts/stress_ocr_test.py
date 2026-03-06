#!/usr/bin/env python3
"""
OCR server stress test (stdlib only).

Features:
- Optional isolated `ocr_server.py` startup (or target existing server URL)
- Concurrent multipart uploads to `/ocr/process`
- Mixed OCR modes (`fast`, `accurate`, `hardcore`)
- Metrics: throughput, status counts, p50/p95/p99 latency, errors
- Optional JSON report output

Examples:
  python3 scripts/stress_ocr_test.py
  python3 scripts/stress_ocr_test.py --workers 12 --duration 60
  python3 scripts/stress_ocr_test.py --server-url http://127.0.0.1:8081 --workers 8 --duration 40
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import random
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# Tiny valid 1x1 JPEG payload.
# OCR API stores uploads as .jpg before cv2 validation, so JPEG avoids format mismatch.
TINY_JPEG_BASE64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA"
    "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA"
    "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3"
    "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm"
    "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA"
    "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx"
    "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK"
    "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3"
    "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiig"
    "D//2Q=="
)
TINY_JPEG_BYTES = base64.b64decode(TINY_JPEG_BASE64)


def find_free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = int(s.getsockname()[1])
    s.close()
    return port


def pick_python_bin(project_root: Path, user_choice: str) -> str:
    if user_choice:
        return user_choice
    venv_ocr = project_root / ".venv_ocr" / "bin" / "python"
    if venv_ocr.exists():
        return str(venv_ocr)
    return sys.executable or "python3"


def json_or_empty(raw: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def http_req(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    body: Optional[bytes] = None,
    timeout: float = 30.0,
) -> Tuple[int, Dict[str, Any], str]:
    req = urllib.request.Request(url=url, method=method.upper(), data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return int(resp.status), json_or_empty(raw), raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return int(e.code), json_or_empty(raw), raw
    except Exception as e:
        return 0, {"ok": False, "error": f"transport:{type(e).__name__}"}, str(e)


def make_multipart_image(field_name: str, filename: str, content_type: str, data: bytes) -> Tuple[str, bytes]:
    boundary = f"----vmillOCRStress{int(time.time() * 1000)}{random.randint(1000,9999)}"
    parts: List[bytes] = []
    parts.append(f"--{boundary}\r\n".encode("utf-8"))
    parts.append(
        (
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    parts.append(data)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)
    return boundary, body


def wait_ready(base_url: str, timeout_s: float = 240.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        status, data, _ = http_req("GET", f"{base_url.rstrip('/')}/", timeout=5.0)
        if status == 200 and data.get("status") == "running" and bool(data.get("ocr_initialized")):
            return True
        time.sleep(0.5)
    return False


@dataclass
class OcrWorkerResult:
    ops: int
    ok_2xx: int
    status_counts: Dict[int, int]
    mode_counts: Dict[str, int]
    latencies_ms: List[float]
    errors: List[str]
    zones_total: int
    zones_max: int


class OcrMetrics:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.ops = 0
        self.ok_2xx = 0
        self.status_counts: Counter[int] = Counter()
        self.mode_counts: Counter[str] = Counter()
        self.latencies_ms: List[float] = []
        self.errors: List[str] = []
        self.zones_total = 0
        self.zones_max = 0

    def add(self, r: OcrWorkerResult) -> None:
        with self.lock:
            self.ops += r.ops
            self.ok_2xx += r.ok_2xx
            self.status_counts.update(r.status_counts)
            self.mode_counts.update(r.mode_counts)
            self.latencies_ms.extend(r.latencies_ms)
            self.errors.extend(r.errors[:20])
            self.zones_total += r.zones_total
            self.zones_max = max(self.zones_max, r.zones_max)


def percentile(vals: List[float], p: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return float(s[idx])


def weighted_mode(r: random.Random) -> str:
    # Bias toward fast mode for realistic usage, still exercises heavy paths.
    x = r.random()
    if x < 0.68:
        return "fast"
    if x < 0.90:
        return "accurate"
    return "hardcore"


def choose_mode(r: random.Random, modes: List[str]) -> str:
    if not modes:
        return weighted_mode(r)
    if len(modes) == 1:
        return modes[0]
    return modes[r.randrange(0, len(modes))]


def ocr_worker(base_url: str, duration_s: float, worker_id: int, modes: List[str]) -> OcrWorkerResult:
    status_counts: Counter[int] = Counter()
    mode_counts: Counter[str] = Counter()
    latencies_ms: List[float] = []
    errors: List[str] = []
    ops = 0
    ok_2xx = 0
    zones_total = 0
    zones_max = 0
    rnd = random.Random((worker_id + 1) * int(time.time()))

    deadline = time.time() + max(1.0, duration_s)
    while time.time() < deadline:
        mode = choose_mode(rnd, modes)
        rotation = rnd.choice([0, 90, 180, 270]) if rnd.random() < 0.2 else 0
        boundary, body = make_multipart_image(
            "file",
            f"stress_{worker_id}_{ops}.jpg",
            "image/jpeg",
            TINY_JPEG_BYTES,
        )
        headers = {
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        path = f"/ocr/process?mode={mode}&rotation={rotation}"
        t0 = time.perf_counter()
        st, data, raw = http_req("POST", f"{base_url.rstrip('/')}{path}", headers=headers, body=body, timeout=45.0)
        dt_ms = (time.perf_counter() - t0) * 1000.0
        latencies_ms.append(dt_ms)
        status_counts[st] += 1
        mode_counts[mode] += 1
        ops += 1
        if 200 <= st < 300:
            ok_2xx += 1
            zones = data.get("zones")
            if isinstance(zones, list):
                zc = len(zones)
                zones_total += zc
                zones_max = max(zones_max, zc)
        else:
            msg = data.get("detail") if isinstance(data, dict) else ""
            if not msg:
                msg = raw[:140]
            errors.append(f"status={st} mode={mode} detail={msg}")
            if len(errors) > 40:
                break

        # tiny think time avoids perfect lockstep
        if rnd.random() < 0.18:
            time.sleep(rnd.uniform(0.005, 0.04))

    return OcrWorkerResult(
        ops=ops,
        ok_2xx=ok_2xx,
        status_counts=dict(status_counts),
        mode_counts=dict(mode_counts),
        latencies_ms=latencies_ms,
        errors=errors,
        zones_total=zones_total,
        zones_max=zones_max,
    )


def start_isolated_ocr(project_root: Path, python_bin: str) -> Tuple[subprocess.Popen, str, str]:
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env["PORT"] = str(port)
    env.setdefault("PYTHONUNBUFFERED", "1")
    fd, log_path = tempfile.mkstemp(prefix="ocr_stress_server_", suffix=".log")
    os.close(fd)
    log_file = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [python_bin, str(project_root / "ocr_server.py")],
        cwd=str(project_root),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    log_file.close()
    return proc, base_url, log_path


def stop_proc(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)


def tail_file(path: str, max_chars: int = 4000) -> str:
    try:
        txt = Path(path).read_text(encoding="utf-8", errors="replace")
        return txt[-max_chars:]
    except Exception:
        return ""


def parse_modes(raw: str) -> List[str]:
    allowed = {"fast", "accurate", "hardcore"}
    out: List[str] = []
    for token in (raw or "").split(","):
        mode = token.strip().lower()
        if mode and mode in allowed and mode not in out:
            out.append(mode)
    return out


def run(args: argparse.Namespace) -> int:
    root = Path(__file__).resolve().parent.parent
    proc: Optional[subprocess.Popen] = None
    server_log_path = ""
    base_url = args.server_url.strip()
    modes = parse_modes(args.modes)
    if not modes:
        modes = ["fast", "accurate", "hardcore"]

    try:
        if not base_url:
            pybin = pick_python_bin(root, args.python_bin.strip())
            print(f"[ocr-stress] starting isolated OCR server with: {pybin}")
            proc, base_url, server_log_path = start_isolated_ocr(root, pybin)
            if not wait_ready(base_url, timeout_s=float(args.startup_timeout)):
                print(f"[ocr-stress] OCR server not ready in {args.startup_timeout}s: {base_url}")
                if server_log_path:
                    print("--- ocr_server output (tail) ---")
                    print(tail_file(server_log_path, max_chars=5000))
                return 2
        else:
            if not wait_ready(base_url, timeout_s=20):
                print(f"[ocr-stress] target OCR server not ready: {base_url}")
                return 2

        workers = max(1, int(args.workers))
        duration = max(2.0, float(args.duration))

        metrics = OcrMetrics()
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(ocr_worker, base_url, duration, i, modes) for i in range(workers)]
            for f in as_completed(futs):
                try:
                    metrics.add(f.result())
                except Exception as e:
                    metrics.errors.append(f"worker_crash:{type(e).__name__}:{e}")
        elapsed = max(0.001, time.time() - t0)

        # One final health check.
        st_root, data_root, _ = http_req("GET", f"{base_url.rstrip('/')}/", timeout=8.0)

        lat = metrics.latencies_ms
        p50 = percentile(lat, 50)
        p95 = percentile(lat, 95)
        p99 = percentile(lat, 99)
        rps = metrics.ops / elapsed

        print("\n=== OCR STRESS SUMMARY ===")
        print(f"server: {base_url}")
        print(f"workers={workers} duration={duration:.1f}s elapsed={elapsed:.2f}s")
        print(f"modes={','.join(modes)}")
        print(f"ops={metrics.ops} ok_2xx={metrics.ok_2xx} rps={rps:.1f}")
        print(f"latency_ms p50={p50:.1f} p95={p95:.1f} p99={p99:.1f}")
        print("status_counts:", sorted(metrics.status_counts.items()))
        print("mode_counts:", sorted(metrics.mode_counts.items()))
        if metrics.ops:
            avg_zones = metrics.zones_total / max(1, metrics.ok_2xx)
            print(f"zones: total={metrics.zones_total} max={metrics.zones_max} avg_per_ok={avg_zones:.2f}")
        print(f"health: status={st_root} ocr_initialized={bool(data_root.get('ocr_initialized'))}")

        report = {
            "server": base_url,
            "workers": workers,
            "duration_s": duration,
            "modes": modes,
            "elapsed_s": elapsed,
            "ops": metrics.ops,
            "ok_2xx": metrics.ok_2xx,
            "rps": rps,
            "latency_ms": {"p50": p50, "p95": p95, "p99": p99},
            "status_counts": dict(metrics.status_counts),
            "mode_counts": dict(metrics.mode_counts),
            "zones_total": metrics.zones_total,
            "zones_max": metrics.zones_max,
            "errors_sample": metrics.errors[:30],
            "health_status": st_root,
            "health_ocr_initialized": bool(data_root.get("ocr_initialized")),
            "ts": int(time.time()),
        }
        if args.report:
            report_path = Path(args.report).expanduser().resolve()
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"report: {report_path}")

        # Pass/fail criteria
        fail = False
        status_5xx = sum(v for k, v in metrics.status_counts.items() if int(k) >= 500)
        transport = int(metrics.status_counts.get(0, 0))
        if status_5xx > 0:
            print(f"[FAIL] 5xx responses: {status_5xx}")
            fail = True
        if transport > max(2, workers):
            print(f"[FAIL] transport errors too high: {transport}")
            fail = True
        elif transport > 0:
            print(f"[WARN] transport errors (transient): {transport}")
        if st_root != 200 or not bool(data_root.get("ocr_initialized")):
            print("[FAIL] OCR server health check failed at end")
            fail = True
        if metrics.ops < workers * 4:
            print("[FAIL] too few operations completed")
            fail = True

        if metrics.errors:
            print("\nerrors(sample):")
            for line in metrics.errors[:15]:
                print(" -", line)

        if fail and server_log_path:
            print("\n--- isolated ocr_server log tail ---")
            print(tail_file(server_log_path, max_chars=6000))

        return 1 if fail else 0
    except Exception:
        print("[ocr-stress] fatal exception")
        traceback.print_exc()
        return 2
    finally:
        if proc is not None:
            stop_proc(proc)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="OCR server stress test")
    p.add_argument("--server-url", default="", help="Existing OCR server base URL (e.g. http://127.0.0.1:8081). Empty = start isolated server.")
    p.add_argument("--python-bin", default="", help="Python binary for isolated OCR server start (default: .venv_ocr/bin/python if exists).")
    p.add_argument("--workers", type=int, default=8, help="Concurrent worker threads.")
    p.add_argument("--duration", type=int, default=30, help="Per-worker stress duration in seconds.")
    p.add_argument("--modes", default="fast,accurate,hardcore", help="Comma-separated OCR modes to test, e.g. fast or fast,accurate,hardcore.")
    p.add_argument("--startup-timeout", type=int, default=240, help="Isolated server startup wait timeout (seconds).")
    p.add_argument("--report", default="", help="Optional JSON report output file path.")
    return p.parse_args()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
