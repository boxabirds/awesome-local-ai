#!/usr/bin/env python3
"""Token-throughput benchmark for MTPLX models, straight at the server.

Why not the OpenCode harness: driving the agent adds a client, a system
prompt and tool schemas we do not control. MTPLX's own request log already
records prefill_tok_s, decode_tok_s, ttft_s and per-depth MTP acceptance, so
the cleanest measurement is a direct request plus the log line it produced.

MTP is on by default; `generation_mode: "ar"` is the ONLY per-request switch
that actually disables it (enable_mtp/mtp are silently ignored -- verified).

Usage:
  throughput-bench.py --model-id <id> --label <name> [--contexts 1000,100000]
"""
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from thermal import MAX_IQR_PCT, thermal_pressure  # noqa: E402

# Set from --port in main(). The request log is per-port, so these must move
# together or the harness reads another server's numbers.
PORT = 8010
BASE = f"http://127.0.0.1:{PORT}"
LOG = Path.home() / ".mtplx" / "logs" / f"request-log-{PORT}.jsonl"


def _set_port(port: int) -> None:
    global PORT, BASE, LOG
    PORT = port
    BASE = f"http://127.0.0.1:{PORT}"
    LOG = Path.home() / ".mtplx" / "logs" / f"request-log-{PORT}.jsonl"

# Decode length per sample. Long enough that per-request overhead does not
# dominate the rate, short enough that a 100k-context run stays affordable.
DECODE_TOKENS = 256
# Rough chars-per-token for English/code; the real count comes back in the
# log as prompt_tokens, which is what we report.
CHARS_PER_TOKEN = 3.5
SETTLE_S = 5


def corpus() -> str:
    """Varied real text. Repetitive filler would inflate the n-gram/PLD
    lanes and flatter the model under test, so use actual source files."""
    # MTPLX's own source if it is installed, and this repo either way, so the
    # corpus is reproducible on a machine that has only checked this repo out.
    roots = [Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent / "lib"]
    for parent in sorted((Path.home() / ".local/share/uv/tools/mtplx/lib").glob("python3.*")):
        roots.insert(0, parent / "site-packages" / "mtplx")
    parts: list[str] = []
    for root in roots:
        if not root.exists():
            continue
        for pattern in ("*.py", "*.sh"):
          for p in sorted(root.rglob(pattern)):
            try:
                parts.append(p.read_text(errors="ignore"))
            except OSError:
                continue
    text = "\n".join(parts)
    if not text:
        raise SystemExit("no corpus text found")
    return text


def make_prompt(text: str, target_tokens: int) -> str:
    need = int(target_tokens * CHARS_PER_TOKEN)
    while len(text) < need:
        text += text
    return text[:need]


def last_log_entry(after_ts: float) -> dict | None:
    if not LOG.exists():
        return None
    rows = [json.loads(l) for l in LOG.read_text().splitlines() if l.strip()]
    for r in reversed(rows):
        if r.get("logged_at_s", 0) >= after_ts:
            return r
    return None


def run(model_id: str, prompt: str, mode: str) -> dict:
    body = {
        "model": model_id,
        "messages": [
            {"role": "user",
             "content": prompt + "\n\nSummarise the above in about 200 words."}
        ],
        "max_tokens": DECODE_TOKENS,
        "stream": False,
    }
    if mode == "ar":
        body["generation_mode"] = "ar"
    t0 = time.time()
    req = urllib.request.Request(
        f"{BASE}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    wall_start = time.time()
    with urllib.request.urlopen(req, timeout=1800) as resp:
        json.load(resp)
    wall = time.time() - wall_start
    time.sleep(1)  # let the server flush its log line
    entry = last_log_entry(t0) or {}
    return {
        "mode": mode,
        "wall_s": round(wall, 2),
        "prompt_tokens": entry.get("prompt_tokens"),
        "cached_tokens": entry.get("cached_tokens"),
        "completion_tokens": entry.get("completion_tokens"),
        "ttft_s": entry.get("ttft_s"),
        "prefill_tok_s": entry.get("prefill_tok_s"),
        "decode_tok_s": entry.get("decode_tok_s"),
        "mtp_depth": entry.get("mtp_depth"),
        "verify_calls": entry.get("verify_calls"),
        "accepted_by_depth": entry.get("accepted_by_depth"),
        "generation_mode": entry.get("generation_mode"),
    }


def mtplx_version() -> str:
    """The version under test. Recorded because it is the thing being compared."""
    try:
        out = subprocess.run(["mtplx", "--version"], capture_output=True,
                             text=True, timeout=30).stdout
        return out.strip().split()[-1]
    except Exception:                                 # noqa: BLE001
        return "unknown"


def summarise(samples: list[dict], mode: str) -> dict:
    """Median of the kept samples, with the spread that says whether to trust it.

    A median without its spread invites a conclusion the data cannot support,
    so iqr_pct travels with it and is compared against the same MAX_IQR_PCT the
    session reporter uses.
    """
    ok = [s for s in samples if "error" not in s and s.get("decode_tok_s")]
    if not ok:
        return {"mode": mode, "n": 0,
                "error": samples[0].get("error", "no usable samples") if samples else "no samples"}

    def med(field):
        vals = [s[field] for s in ok if isinstance(s.get(field), (int, float))]
        return round(statistics.median(vals), 3) if vals else None

    decodes = sorted(s["decode_tok_s"] for s in ok)
    m = statistics.median(decodes)
    if len(decodes) >= 4:
        q1, q3 = statistics.quantiles(decodes, n=4)[0], statistics.quantiles(decodes, n=4)[2]
        iqr_pct = round((q3 - q1) / m * 100, 1) if m else None
    else:
        iqr_pct = round((decodes[-1] - decodes[0]) / m * 100, 1) if m and len(decodes) > 1 else 0.0

    return {
        "mode": mode,
        "n": len(ok),
        "decode_tok_s": round(m, 3),
        "decode_samples": [round(d, 3) for d in decodes],
        "iqr_pct": iqr_pct,
        "iqr_exceeds_floor": (iqr_pct is not None and iqr_pct > MAX_IQR_PCT),
        "prefill_tok_s": med("prefill_tok_s"),
        "ttft_s": med("ttft_s"),
        "wall_s": med("wall_s"),
        "prompt_tokens": ok[0].get("prompt_tokens"),
        "completion_tokens": med("completion_tokens"),
        "mtp_depth": ok[0].get("mtp_depth"),
        "generation_mode": ok[0].get("generation_mode"),
        "accepted_by_depth": ok[0].get("accepted_by_depth"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT,
                    help="server to measure; the request log is per-port")
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--contexts", default="1000,100000")
    ap.add_argument("--repeats", type=int, default=1,
                    help="samples per (context, mode). >1 discards the first as "
                         "warm-up and reports a median with its spread")
    ap.add_argument("--outdir", default=str(Path(__file__).resolve().parent / "results"),
                    help="where to write results (default: benchmarks/results, gitignored)")
    args = ap.parse_args()

    _set_port(args.port)
    targets = [int(x) for x in args.contexts.split(",")]
    text = corpus()
    out = {"label": args.label, "model_id": args.model_id,
           "decode_tokens": DECODE_TOKENS,
           "mtplx_version": mtplx_version(),
           "repeats": args.repeats,
           "thermal_start": thermal_pressure(),
           "runs": []}

    for target in targets:
        prompt = make_prompt(text, target)
        for mode in ("mtp", "ar"):
            # With repeats, the first sample is a warm-up and is discarded: the
            # first generation after a load pays for cache warming that has
            # nothing to do with what is being compared.
            n = args.repeats + 1 if args.repeats > 1 else 1
            samples = []
            for i in range(n):
                tag = " (warm-up)" if args.repeats > 1 and i == 0 else ""
                print(f"  [{args.label}] ctx~{target} mode={mode} {i+1}/{n}{tag} ...", flush=True)
                try:
                    samples.append(run(args.model_id, prompt, mode))
                except Exception as e:                # noqa: BLE001
                    samples.append({"mode": mode, "error": str(e)[:200]})
            kept = samples[1:] if args.repeats > 1 else samples
            r = summarise(kept, mode)
            r["thermal"] = thermal_pressure()
            r["target_ctx"] = target
            out["runs"].append(r)
            print(f"      prompt={r.get('prompt_tokens')} "
                  f"decode={r.get('decode_tok_s')} ttft={r.get('ttft_s')}", flush=True)
            time.sleep(SETTLE_S)

    d = Path(args.outdir)
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{args.label}.json"
    f.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
