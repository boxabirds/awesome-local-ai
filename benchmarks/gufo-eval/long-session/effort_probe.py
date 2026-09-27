# /// script
# requires-python = ">=3.11"
# ///
"""H1: which reasoning effort does a server actually apply to a request that names none?

    uv run effort_probe.py --url http://127.0.0.1:PORT --engine gufo --out FILE.jsonl [--repeats 3]

pi (every stack's agent) sends no reasoning_effort, so the effort a run gets is whatever the server
does with that silence. The same moderately hard prompt is sent with no effort field, with
reasoning_effort "low" and "xhigh", and with "low" in chat_template_kwargs; the thinking length of
each shows which effort silence maps to. Sampling is the agents' (temperature 1.0, top-p 0.95,
top-k 20), so repeats vary and several are needed.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request

PROMPT = ("A collaborative whiteboard stores each board as a Yjs document in a Cloudflare Durable Object. "
          "Two people edit the same sticky note while one of them is offline for 30 seconds. Explain exactly how the "
          "edits merge when the offline person reconnects, what the other person sees, and one way it can go wrong.")
MAX_TOKENS = 6000
REQUEST_TIMEOUT_S = 900
LISTING_TIMEOUT_S = 10
SAMPLER = {"temperature": 1.0, "top_p": 0.95, "top_k": 20}
VARIANTS = {
    "none": {},
    "effort-low": {"reasoning_effort": "low"},
    "effort-xhigh": {"reasoning_effort": "xhigh"},
    "kwargs-low": {"chat_template_kwargs": {"reasoning_effort": "low"}},
}


def served_model(url: str) -> str:
    with urllib.request.urlopen(f"{url}/v1/models", timeout=LISTING_TIMEOUT_S) as r:
        data = json.loads(r.read()).get("data") or [{}]
    return data[0].get("id", "default")


def ask(url: str, model: str, extra: dict) -> dict:
    body = {"model": model, "messages": [{"role": "user", "content": PROMPT}], "max_tokens": MAX_TOKENS,
            "stream": False, **SAMPLER, **extra}
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
        d = json.loads(r.read())
    msg = (d.get("choices") or [{}])[0].get("message") or {}
    reasoning = msg.get("reasoning_content") or msg.get("reasoning") or ""
    usage = d.get("usage") or {}
    return {"seconds": round(time.monotonic() - t0, 1), "completion_tokens": usage.get("completion_tokens"),
            "reasoning_chars": len(reasoning), "content_chars": len(msg.get("content") or ""),
            "finish": (d.get("choices") or [{}])[0].get("finish_reason"), "reasoning_head": reasoning[:200]}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True)
    ap.add_argument("--engine", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--variants", default=",".join(VARIANTS))
    a = ap.parse_args()
    model = served_model(a.url)
    for rep in range(1, a.repeats + 1):
        for name in a.variants.split(","):
            try:
                r = ask(a.url, model, VARIANTS[name])
            except Exception as e:  # a refusal is a result too
                r = {"error": f"{type(e).__name__}: {e}"}
            r.update({"engine": a.engine, "variant": name, "repeat": rep, "model": model})
            with open(a.out, "a") as f:
                f.write(json.dumps(r) + "\n")
            print(json.dumps({k: v for k, v in r.items() if k != "reasoning_head"}), flush=True)


if __name__ == "__main__":
    main()
