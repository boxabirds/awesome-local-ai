# /// script
# requires-python = ">=3.11"
# ///
"""Test A of the gufo vs llama.cpp plan (docs/20260926-gufo-vs-llamacpp-eval-plan.md): throughput.

    throughput.py --engine NAME --url http://127.0.0.1:PORT --prompts DIR --out FILE.jsonl
        [--fills 2048,32768,65536,120000] [--repeats 3] [--decode 400]

Engine-neutral: it measures only what a client sees, the same way for both engines.
- prefill tok/s = prompt tokens / time to the first streamed token;
- decode tok/s  = (completion tokens - 1) / time from the first streamed token to the last;
- peak GPU memory (VRAM + GTT, MiB) sampled from the kernel's counters during the request;
- MTP acceptance as the engine reports it (llama.cpp `timings`, gufo `usage.gufo`), recorded raw.
Greedy sampling, thinking off, as the plan specifies for throughput. Every request starts with a
unique line so neither engine can serve it from a cached prefix. Prompts are files
<DIR>/fill-<N>.txt made beforehand (test-a.sh cuts them to exact token counts with llama.cpp's
tokenizer), so both engines get byte-identical input.
"""
from __future__ import annotations

import argparse
import glob
import json
import statistics
import threading
import time
import urllib.request
import uuid
from pathlib import Path

MIB = 1024 * 1024
SAMPLE_EVERY_S = 0.25
REQUEST_TIMEOUT_S = 3600
INSTRUCTION = "\n\nContinue the code above: write the next function in the same style."
# The combination's thinking sampler (config.sh SAMPLING_THINKING), as the coding agents run it.
AGENT_SAMPLER = {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0.0}


def gpu_used_mib() -> int:
    """VRAM + GTT in use on the AMD GPU, from the kernel's counters (0 if there are none)."""
    total = 0
    for name in ("mem_info_vram_used", "mem_info_gtt_used"):
        for f in glob.glob(f"/sys/class/drm/card*/device/{name}"):
            try:
                total += int(Path(f).read_text())
            except (OSError, ValueError):
                pass
    return total // MIB


class PeakSampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.peak = gpu_used_mib()
        self.stop = threading.Event()

    def run(self):
        while not self.stop.is_set():
            self.peak = max(self.peak, gpu_used_mib())
            time.sleep(SAMPLE_EVERY_S)


def body(prompt: str, decode: int, sampling: str = "greedy", reuse_prefix: bool = False) -> dict:
    """The request. greedy: temperature 0, thinking off (throughput). agent: the agents' sampler,
    thinking on. The unique line defeats prefix caching; reuse_prefix puts it last instead, so
    repeats pay prefill once and only decode is compared."""
    tag = f"run {uuid.uuid4()}"
    content = f"{prompt}{INSTRUCTION}\n{tag}" if reuse_prefix else f"{tag}\n{prompt}{INSTRUCTION}"
    b = {
        "model": "default",
        "messages": [{"role": "user", "content": content}],
        "max_tokens": decode,
        "stream": True,
        "stream_options": {"include_usage": True},
        "ignore_eos": True,                                # llama.cpp: decode the full budget
    }
    if sampling == "agent":
        b.update(AGENT_SAMPLER, chat_template_kwargs={"enable_thinking": True})
    else:
        b.update(temperature=0, reasoning_effort="off",   # gufo
                 chat_template_kwargs={"enable_thinking": False})  # llama.cpp
    return b


def request(url: str, prompt: str, decode: int, sampling: str = "greedy", reuse_prefix: bool = False) -> dict:
    body_ = body(prompt, decode, sampling, reuse_prefix)
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(body_).encode(),
                                 headers={"Content-Type": "application/json"})
    sampler = PeakSampler()
    sampler.start()
    t0 = time.monotonic()
    t_first = t_last = None
    usage, timings, text = {}, {}, []
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
            for raw in r:
                line = raw.decode(errors="replace").strip()
                if not line.startswith("data:") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[5:])
                for c in chunk.get("choices") or []:
                    d = c.get("delta") or {}
                    piece = (d.get("content") or "") + (d.get("reasoning_content") or "")
                    if piece:
                        now = time.monotonic()
                        t_first = t_first or now
                        t_last = now
                        text.append(piece)
                usage = chunk.get("usage") or usage
                timings = chunk.get("timings") or timings
    finally:
        sampler.stop.set()
        sampler.join()
    prompt_tokens = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    out = {"prompt_tokens": prompt_tokens, "completion_tokens": completion,
           "ttft_s": round(t_first - t0, 3) if t_first else None, "peak_gpu_mib": sampler.peak,
           "mtp_llamacpp": {k: timings.get(k) for k in ("draft_n", "draft_n_accepted") if k in timings} or None,
           "mtp_gufo": usage.get("gufo")}
    if t_first and prompt_tokens:
        out["prefill_tok_s"] = round(prompt_tokens / (t_first - t0), 1)
    if t_first and t_last and completion and completion > 1 and t_last > t_first:
        out["decode_tok_s"] = round((completion - 1) / (t_last - t_first), 1)
    out["output_chars"] = len("".join(text))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", required=True)
    ap.add_argument("--url", required=True)
    ap.add_argument("--prompts", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fills", default="2048,32768,65536,120000")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--decode", type=int, default=400)
    ap.add_argument("--sampling", choices=["greedy", "agent"], default="greedy")
    ap.add_argument("--reuse-prefix", action="store_true", help="unique line last: repeats measure decode only")
    ap.add_argument("--label", default="", help="recorded with each result, e.g. draft-depth-3")
    a = ap.parse_args()
    a.out.parent.mkdir(parents=True, exist_ok=True)
    for fill in (int(x) for x in a.fills.split(",")):
        prompt = (a.prompts / f"fill-{fill}.txt").read_text()
        runs = []
        for rep in range(1, a.repeats + 1):
            try:
                r = request(a.url, prompt, a.decode, a.sampling, a.reuse_prefix)
            except Exception as e:  # a refusal or a crash is a result too
                r = {"error": f"{type(e).__name__}: {e}"}
            r.update({"engine": a.engine, "label": a.label, "sampling": a.sampling, "fill": fill, "repeat": rep})
            runs.append(r)
            with a.out.open("a") as f:
                f.write(json.dumps(r) + "\n")
            print(json.dumps(r), flush=True)
        ok = [r for r in runs if "decode_tok_s" in r]
        if ok:
            print(f"== {a.engine} fill {fill}: median prefill {statistics.median(r['prefill_tok_s'] for r in ok)} tok/s, "
                  f"decode {statistics.median(r['decode_tok_s'] for r in ok)} tok/s, peak {max(r['peak_gpu_mib'] for r in ok)} MiB",
                  flush=True)


if __name__ == "__main__":
    main()
