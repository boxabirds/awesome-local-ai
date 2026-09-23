# /// script
# requires-python = ">=3.11"
# dependencies = ["starlette>=0.40", "uvicorn>=0.30", "httpx>=0.27", "pytest>=8"]
# ///
"""Proxy passes SSE bytes through unchanged and records correct metrics.

    uv run --with pytest --with starlette --with uvicorn --with httpx pytest harness/test_meter_proxy.py
"""
from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from meter_proxy import build_app

FIRST_TOKEN_DELAY_S = 0.3
TOKEN_GAP_S = 0.05
N_TOKENS = 5
PROMPT_TOKENS = 1234
CACHED_TOKENS = 1000
TIMING_TOLERANCE_S = 0.1


def chunk(delta: dict, finish: str | None = None) -> bytes:
    return b"data: " + json.dumps({"choices": [{"delta": delta, "finish_reason": finish}]}).encode() + b"\n\n"


UPSTREAM_BODY: list[bytes] = []
SEEN_REQUESTS: list[dict] = []


async def fake_chat(request: Request):
    doc = await request.json()
    SEEN_REQUESTS.append(doc)
    if not doc.get("stream"):
        return JSONResponse({"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}],
                             "usage": {"prompt_tokens": PROMPT_TOKENS, "completion_tokens": 1}})

    async def gen():
        parts = [chunk({"reasoning_content": "think"})]
        parts += [chunk({"content": f"t{i}"}) for i in range(N_TOKENS - 1)]
        parts.append(chunk({}, "stop"))
        if doc.get("stream_options", {}).get("include_usage"):
            parts.append(b"data: " + json.dumps({"choices": [], "usage": {
                "prompt_tokens": PROMPT_TOKENS, "completion_tokens": N_TOKENS,
                "prompt_tokens_details": {"cached_tokens": CACHED_TOKENS}}}).encode() + b"\n\n")
        parts.append(b"data: [DONE]\n\n")
        UPSTREAM_BODY.clear()
        UPSTREAM_BODY.extend(parts)
        await asyncio.sleep(FIRST_TOKEN_DELAY_S)
        for p in parts:
            yield p
            await asyncio.sleep(TOKEN_GAP_S)

    return StreamingResponse(gen(), media_type="text/event-stream")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def serve(app, port: int) -> uvicorn.Server:
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.01)
    return server


def test_stream_passthrough_and_metrics(tmp_path: Path):
    up_port, px_port = free_port(), free_port()
    serve(Starlette(routes=[Route("/v1/chat/completions", fake_chat, methods=["POST"])]), up_port)
    story = tmp_path / "story"
    story.write_text("7\n")
    log = tmp_path / "req.jsonl"
    serve(build_app(f"http://127.0.0.1:{up_port}", log, story), px_port)

    body = {"model": "m", "stream": True, "messages": [{"role": "user", "content": "x"}], "tools": [{}, {}]}
    with httpx.stream("POST", f"http://127.0.0.1:{px_port}/v1/chat/completions", json=body, timeout=10) as r:
        received = b"".join(r.iter_raw())

    assert received == b"".join(UPSTREAM_BODY), "proxy must not alter response bytes"
    assert SEEN_REQUESTS[-1]["stream_options"]["include_usage"] is True
    rec = json.loads(log.read_text().splitlines()[-1])
    assert rec["story"] == "7"
    assert rec["prompt_tokens"] == PROMPT_TOKENS
    assert rec["completion_tokens"] == N_TOKENS
    assert rec["cached_tokens"] == CACHED_TOKENS
    assert rec["n_tools"] == 2 and rec["n_messages"] == 1
    assert rec["reasoning_chars"] == len("think")
    assert rec["finish_reason"] == "stop"
    assert abs(rec["ttft_s"] - FIRST_TOKEN_DELAY_S) < TIMING_TOLERANCE_S
    expected_decode = (N_TOKENS - 1) * TOKEN_GAP_S
    assert abs(rec["decode_s"] - expected_decode) < TIMING_TOLERANCE_S


def test_non_stream_usage(tmp_path: Path):
    up_port, px_port = free_port(), free_port()
    serve(Starlette(routes=[Route("/v1/chat/completions", fake_chat, methods=["POST"])]), up_port)
    log = tmp_path / "req.jsonl"
    serve(build_app(f"http://127.0.0.1:{up_port}", log, None), px_port)
    r = httpx.post(f"http://127.0.0.1:{px_port}/v1/chat/completions",
                   json={"model": "m", "messages": [{"role": "user", "content": "x"}]}, timeout=10)
    assert r.json()["choices"][0]["message"]["content"] == "hi"
    rec = json.loads(log.read_text().splitlines()[-1])
    assert rec["prompt_tokens"] == PROMPT_TOKENS and rec["content_chars"] == 2
