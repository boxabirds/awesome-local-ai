"""One chat-completions request against an OpenAI-compatible server, streamed or not, with its timing.

Streaming is read as server-sent events: time to first token is when the first delta carrying anything the model
wrote arrives (reasoning, content or a tool call), so it is the prefill time plus one decode round.
"""

from __future__ import annotations

import gzip
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# A prefill of ~135k tokens on a Mac plus a 32k-token reply at tens of tokens a second: generous, so a slow turn is
# measured rather than cut off. A request that takes longer than this is a failure in itself.
REQUEST_TIMEOUT_S = 3600


@dataclass
class Reply:
    status: int = 0
    error: str = ""               # the server's error message, or why the request failed
    error_code: str = ""          # e.g. context_length_exceeded
    ttft_s: float | None = None
    total_s: float = 0.0
    content: str = ""
    reasoning: str = ""
    tool_calls: list[dict] = field(default_factory=list)   # [{"id","name","arguments"(raw text)}]
    finish_reason: str | None = None
    usage: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == 200 and not self.error


def _error_of(raw: bytes) -> tuple[str, str]:
    try:
        doc = json.loads(raw)
        err = doc.get("error", doc)
        if isinstance(err, dict):
            return str(err.get("message") or err), str(err.get("code") or "")
        return str(err), ""
    except Exception:  # noqa: BLE001 - whatever came back is the message
        return raw.decode(errors="replace")[:500], ""


def chat(base_url: str, body: dict, timeout_s: float = REQUEST_TIMEOUT_S) -> Reply:
    """POST body to <base_url>/v1/chat/completions; streams when body["stream"] is true."""
    req = urllib.request.Request(base_url.rstrip("/") + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer local"})
    r = Reply()
    started = time.perf_counter()
    try:
        resp = urllib.request.urlopen(req, timeout=timeout_s)
    except urllib.error.HTTPError as e:
        r.status = e.code
        r.error, r.error_code = _error_of(e.read())
        r.total_s = time.perf_counter() - started
        return r
    except (urllib.error.URLError, OSError) as e:
        r.error = f"request failed: {e}"
        r.total_s = time.perf_counter() - started
        return r
    r.status = resp.status
    with resp:
        if body.get("stream"):
            _read_stream(resp, r, started)
        else:
            _read_plain(resp.read(), r)
    r.total_s = time.perf_counter() - started
    return r


def _read_plain(raw: bytes, r: Reply) -> None:
    doc = json.loads(raw)
    choice = (doc.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    r.content = msg.get("content") or ""
    r.reasoning = msg.get("reasoning_content") or msg.get("reasoning") or ""
    r.tool_calls = [{"id": c.get("id"), "name": (c.get("function") or {}).get("name"),
                     "arguments": (c.get("function") or {}).get("arguments") or ""} for c in msg.get("tool_calls") or []]
    r.finish_reason = choice.get("finish_reason")
    r.usage = doc.get("usage") or {}


def _read_stream(resp: Any, r: Reply, started: float) -> None:
    calls: dict[int, dict] = {}
    for raw in resp:
        line = raw.decode(errors="replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            break
        doc = json.loads(data)
        if "error" in doc:
            r.error, r.error_code = _error_of(json.dumps(doc).encode())
            break
        if doc.get("usage"):
            r.usage = doc["usage"]
        for choice in doc.get("choices") or []:
            delta = choice.get("delta") or {}
            wrote = False
            for key in ("reasoning_content", "reasoning"):
                if delta.get(key):
                    r.reasoning += delta[key]
                    wrote = True
            if delta.get("content"):
                r.content += delta["content"]
                wrote = True
            for tc in delta.get("tool_calls") or []:
                slot = calls.setdefault(int(tc.get("index", 0)), {"id": None, "name": None, "arguments": ""})
                fn = tc.get("function") or {}
                if tc.get("id"):
                    slot["id"] = tc["id"]
                if fn.get("name"):
                    slot["name"] = fn["name"]
                slot["arguments"] += fn.get("arguments") or ""
                wrote = True
            if wrote and r.ttft_s is None:
                r.ttft_s = time.perf_counter() - started
            if choice.get("finish_reason"):
                r.finish_reason = choice["finish_reason"]
    r.tool_calls = [calls[i] for i in sorted(calls)]


def cached_tokens(usage: dict) -> int | None:
    """prompt_tokens_details.cached_tokens, or None when the server does not report it."""
    details = usage.get("prompt_tokens_details")
    if isinstance(details, dict) and isinstance(details.get("cached_tokens"), int):
        return details["cached_tokens"]
    return None


def reasoning_tokens(usage: dict) -> int | None:
    details = usage.get("completion_tokens_details")
    if isinstance(details, dict) and isinstance(details.get("reasoning_tokens"), int):
        return details["reasoning_tokens"]
    return None


def load_bodies(directory: Path):
    """The request bodies capture_pi_requests.mjs wrote: NNNN.json or NNNN.json.gz, in turn order."""
    files = sorted(p for p in Path(directory).iterdir()
                   if p.name.split(".")[0].isdigit() and p.name.endswith((".json", ".json.gz")))
    for p in files:
        opener = gzip.open if p.suffix == ".gz" else open
        with opener(p, "rt") as f:
            yield json.load(f)
