#!/usr/bin/env python3
"""Does a model server's memory grow when the same work is repeated, and in which part of the process?

Sends N requests of the same size to a running OpenAI-compatible server, each with a DIFFERENT prompt (so none is served
from a cache, as in an agent's stories), and after each one reads how the server process's memory divides (macOS:
`footprint -p`, by category; Linux: RssAnon / RssFile). Then it waits and reads again, to see whether what grew is given
back. One JSON line per reading.

Written for MTPLX 2.12.2 on 8 Oct 2026. Its own log says its ACTIVE memory is flat across 1,437 requests (median 81.5,
81.5, 80.8, 80.7 GiB by quarter) while the process footprint rose from a median 89.5 to 92.3 GiB, the gap between them
doubling from 6.4 to 12.4 GiB. The request log has no figure for that gap; the categories say where it sits (heap,
GPU buffers, anonymous mappings).

    uv run tools/engine-probe/memory-growth.py --base-url http://127.0.0.1:18010/v1 --model NAME --port 18010 \\
        --tokens 60000 --requests 30 --out /tmp/memory-growth.jsonl
    uv run tools/engine-probe/memory-growth.py --self-test
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[2] / "benchmarks" / "spec-bench" / "harness"
sys.path.insert(0, str(HARNESS))
import memory_snapshot  # noqa: E402  (the parsers the harness uses, so this and a recorded story read memory the same way)

TIMEOUT_S = 1800
FILLER = "function step_{n}(x) {{ return (x * {n} + {m}) % 9973; }}\n"
APPROX_CHARS_PER_TOKEN = 3.6
CALIBRATION_TOKENS = 4000
CALIBRATION_DRIFT = 0.92          # later filler lines have longer numbers, so a small sample reads a little denser
ANSWER_TOKENS = 64
IDLE_READINGS_S = (0, 60, 300)    # seconds after the last request


def prompt(index: int, tokens: int, chars_per_token: float = APPROX_CHARS_PER_TOKEN) -> str:
    """About `tokens` tokens of filler code that differs from every other index's from its first line on, so the server
    can share no prefix between two of them."""
    lines = [f"// File {index}: the access phrase is PHRASE-{index:04d}-{index * 7919 % 10007}.\n"]
    chars, n = len(lines[0]), index * 100_003
    while chars < tokens * chars_per_token:
        line = FILLER.format(n=n, m=(n * 7 + index) % 101)
        lines.append(line)
        chars += len(line)
        n += 1
    lines.append("\nQuestion: what is the access phrase in the first line? Answer with the phrase only.\n")
    return "".join(lines)


def post(base_url: str, body: dict) -> dict:
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return json.load(r)


def ask(base_url: str, model: str, text: str) -> tuple[dict, float]:
    t = time.time()
    out = post(base_url, {"model": model, "messages": [{"role": "user", "content": text}], "max_tokens": ANSWER_TOKENS,
                          "temperature": 0})
    return out, time.time() - t


def server_pid(port: int) -> int | None:
    out = subprocess.run(["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


def read_process(pid: int) -> dict:
    """How the process's memory divides now: macOS footprint categories, or Linux anonymous/file-backed."""
    if sys.platform == "darwin":
        text = subprocess.run(["footprint", "-p", str(pid)], capture_output=True, text=True).stdout
        footprint_gb = memory_snapshot_footprint_gb(text)
        return {"phys_footprint_gib": footprint_gb, "categories_mib": memory_snapshot.parse_footprint_categories(text)}
    try:
        status = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        return {}
    import hostenv
    return {"split_mib": hostenv.parse_proc_status_split_mib(status)}


def memory_snapshot_footprint_gb(text: str) -> float | None:
    """phys_footprint in GiB from the footprint table's auxiliary data."""
    import re
    m = re.search(r"phys_footprint:\s*([\d.]+)\s*(KB|MB|GB|TB)", text)
    if not m:
        return None
    mib = float(m.group(1)) * {"KB": 1 / 1024, "MB": 1.0, "GB": 1024.0, "TB": 1024.0 ** 2}[m.group(2)]
    return round(mib / 1024, 2)


def grew(readings: list[dict], category: str) -> float | None:
    """MiB a category grew from the first reading to the last; None if either lacks it."""
    first, last = readings[0].get("categories_mib", {}), readings[-1].get("categories_mib", {})
    return round(last[category] - first[category], 1) if category in first and category in last else None


def measured_chars_per_token(base_url: str, model: str) -> float:
    sample = prompt(0, CALIBRATION_TOKENS)
    used = ask(base_url, model, sample)[0]["usage"]["prompt_tokens"]
    return len(sample) / used * CALIBRATION_DRIFT


def sizes_from(spec: str) -> list[int]:
    """"60000" is one size; "10000,40000,120000" is a cycle of them, request i using the (i-1)th modulo its length."""
    sizes = [int(s) for s in str(spec).split(",") if s.strip()]
    if not sizes or any(s <= 0 for s in sizes):
        raise SystemExit(f"--tokens wants positive sizes, got {spec!r}")
    return sizes


def self_test() -> None:
    assert sizes_from("60000") == [60000] and sizes_from("10000, 40000,120000") == [10000, 40000, 120000]
    try:
        sizes_from("0")
    except SystemExit:
        pass
    else:
        raise AssertionError("a zero size must be refused")
    a, b = prompt(1, 1000), prompt(2, 1000)
    assert a != b and a.splitlines()[0] != b.splitlines()[0]
    assert not set(a.splitlines()[1:6]) & set(b.splitlines()[1:6]), "no shared lines near the start: no shared prefix"
    assert abs(len(a) / APPROX_CHARS_PER_TOKEN - 1000) < 100
    text = ("======\nx [1]: 64-bit    Footprint: 94 GB\n======\n\n  Dirty      Clean  Reclaimable    Regions    Category\n"
            "    ---        ---          ---        ---    ---\n  90 GB        0 B          0 B          9    IOAccelerator\n"
            "   4 GB        0 B          0 B          9    MALLOC_LARGE\n    ---\n 94 GB  0 B  0 B  18  TOTAL\n\n"
            "Auxiliary data:\n    phys_footprint: 94 GB\n")
    assert memory_snapshot_footprint_gb(text) == 94.0
    assert memory_snapshot_footprint_gb("nothing") is None
    r1 = {"categories_mib": {"MALLOC_LARGE": 4096.0, "IOAccelerator": 90 * 1024.0}}
    r2 = {"categories_mib": {"MALLOC_LARGE": 9216.0, "IOAccelerator": 90 * 1024.0}}
    assert grew([r1, r2], "MALLOC_LARGE") == 5120.0 and grew([r1, r2], "IOAccelerator") == 0.0
    assert grew([r1, r2], "missing") is None
    print("self-test ok")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--model")
    ap.add_argument("--port", type=int, help="the port the server listens on, to find its process")
    ap.add_argument("--tokens", default="60000", help="prompt size, or a comma-separated cycle of sizes (a context ramp)")
    ap.add_argument("--requests", type=int, default=30)
    ap.add_argument("--out", default="memory-growth.jsonl")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
        return 0
    if not (a.base_url and a.model and a.port):
        ap.error("--base-url, --model and --port are required")
    pid = server_pid(a.port)
    if not pid:
        print(f"nothing is listening on port {a.port}", file=sys.stderr)
        return 1
    sizes = sizes_from(a.tokens)
    cpt = measured_chars_per_token(a.base_url, a.model)
    out = open(a.out, "a")
    readings: list[dict] = []

    def record(kind: str, **more) -> None:
        r = {"kind": kind, "at": round(time.time(), 1), **read_process(pid), **more}
        readings.append(r)
        out.write(json.dumps(r) + "\n")
        out.flush()

    record("start")
    for i in range(1, a.requests + 1):
        target = sizes[(i - 1) % len(sizes)]
        resp, secs = ask(a.base_url, a.model, prompt(i, target, cpt))
        u = resp.get("usage", {})
        record("request", index=i, target_tokens=target, prompt_tokens=u.get("prompt_tokens"), seconds=round(secs, 1))
    last = time.time()
    for wait in IDLE_READINGS_S:
        time.sleep(max(0, last + wait - time.time()))
        record("idle", after_s=wait)
    for cat in sorted({c for r in readings for c in r.get("categories_mib", {})}):
        g = grew(readings, cat)
        if g:
            print(f"{cat:28} {g:+10.1f} MiB from the start to the end")
    return 0


if __name__ == "__main__":
    sys.exit(main())
