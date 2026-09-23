# /// script
# requires-python = ">=3.11"
# dependencies = ["starlette>=0.40", "uvicorn>=0.30", "httpx>=0.27"]
# ///
"""OpenAI-compatible metering proxy.

Sits between the coding agent and any backend so that every combination is
measured the same way, from the client side. Response bytes are passed through
untouched; the only request change is asking for usage on streamed responses.

One JSON line per request goes to --log. The current story id is read from
--story-file at request time so one proxy can serve a whole run.

    uv run meter_proxy.py --upstream http://127.0.0.1:8010 --port 18100 \
        --log run/requests.jsonl --story-file run/current_story
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route

HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "host", "content-encoding"}
UPSTREAM_TIMEOUT_S = None  # local models can think for a long time; never cut a request off
SSE_DATA = b"data:"


class SSEMeter:
    """Incrementally parses an OpenAI SSE stream and records timing and usage."""

    def __init__(self, t_start: float):
        self.t_start = t_start
        self.t_first: float | None = None
        self.t_last: float | None = None
        self.buf = b""
        self.chunks = 0
        self.content_chars = 0
        self.reasoning_chars = 0
        self.tool_call_deltas = 0
        self.usage: dict | None = None
        self.finish_reason: str | None = None

    def feed(self, data: bytes) -> None:
        self.buf += data
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            line = line.strip()
            if not line.startswith(SSE_DATA):
                continue
            payload = line[len(SSE_DATA):].strip()
            if payload == b"[DONE]":
                continue
            try:
                obj = json.loads(payload)
            except json.JSONDecodeError:
                continue
            self._event(obj)

    def _event(self, obj: dict) -> None:
        if obj.get("usage"):
            self.usage = obj["usage"]
        for choice in obj.get("choices") or []:
            delta = choice.get("delta") or {}
            produced = False
            if delta.get("content"):
                self.content_chars += len(delta["content"])
                produced = True
            for key in ("reasoning_content", "reasoning"):
                if delta.get(key):
                    self.reasoning_chars += len(delta[key])
                    produced = True
            if delta.get("tool_calls"):
                self.tool_call_deltas += 1
                produced = True
            if produced:
                now = time.monotonic()
                self.chunks += 1
                self.t_first = self.t_first or now
                self.t_last = now
            if choice.get("finish_reason"):
                self.finish_reason = choice["finish_reason"]


def usage_fields(usage: dict | None) -> dict:
    usage = usage or {}
    details = usage.get("prompt_tokens_details") or {}
    cdetails = usage.get("completion_tokens_details") or {}
    return {
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cached_tokens": details.get("cached_tokens"),
        "reasoning_tokens": cdetails.get("reasoning_tokens"),
        "usage_present": bool(usage),
    }


def build_app(upstream: str, log_path: Path, story_file: Path | None) -> Starlette:
    client = httpx.AsyncClient(base_url=upstream, timeout=UPSTREAM_TIMEOUT_S)

    def story() -> str | None:
        try:
            return story_file.read_text().strip() if story_file else None
        except OSError:
            return None

    def write(rec: dict) -> None:
        with log_path.open("a") as f:
            f.write(json.dumps(rec) + "\n")

    async def proxy(request: Request) -> Response:
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        body = await request.body()
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
        is_chat = request.method == "POST" and request.url.path.endswith("/chat/completions")
        req_info: dict = {}
        if is_chat and body:
            try:
                doc = json.loads(body)
                msgs = doc.get("messages") or []
                req_info = {
                    "stream": bool(doc.get("stream")),
                    "n_messages": len(msgs),
                    "prompt_chars": len(json.dumps(msgs)),
                    "n_tools": len(doc.get("tools") or []),
                    "max_tokens": doc.get("max_tokens") or doc.get("max_completion_tokens"),
                }
                if doc.get("stream"):
                    doc.setdefault("stream_options", {})["include_usage"] = True
                    body = json.dumps(doc).encode()
            except json.JSONDecodeError:
                pass

        t_start = time.monotonic()
        wall_start = time.time()
        upstream_req = client.build_request(request.method, path, headers=headers, content=body)
        resp = await client.send(upstream_req, stream=True)
        out_headers = {k: v for k, v in resp.headers.items() if k.lower() not in HOP_BY_HOP}

        if not is_chat:
            content = await resp.aread()
            await resp.aclose()
            return Response(content, status_code=resp.status_code, headers=out_headers)

        meter = SSEMeter(t_start)
        streaming = req_info.get("stream", False)

        async def relay():
            collected = b""
            try:
                async for data in resp.aiter_raw():
                    if streaming:
                        meter.feed(data)
                    else:
                        collected += data
                    yield data
            finally:
                await resp.aclose()
                t_end = time.monotonic()
                usage = meter.usage
                if not streaming and collected:
                    try:
                        doc = json.loads(collected)
                        usage = doc.get("usage")
                        choice = (doc.get("choices") or [{}])[0]
                        meter.finish_reason = choice.get("finish_reason")
                        msg = choice.get("message") or {}
                        meter.content_chars = len(msg.get("content") or "")
                        meter.reasoning_chars = len(msg.get("reasoning_content") or msg.get("reasoning") or "")
                        meter.tool_call_deltas = len(msg.get("tool_calls") or [])
                    except json.JSONDecodeError:
                        pass
                ufields = usage_fields(usage)
                ttft = (meter.t_first - t_start) if meter.t_first else None
                decode_s = (meter.t_last - meter.t_first) if (meter.t_first and meter.t_last) else None
                ctoks = ufields["completion_tokens"]
                write({
                    "ts": wall_start,
                    "story": story(),
                    "status": resp.status_code,
                    **req_info,
                    "ttft_s": ttft,
                    "total_s": t_end - t_start,
                    "decode_s": decode_s,
                    # Decode rate over the streamed span; excludes the first token (it is in TTFT).
                    "decode_tok_s": (ctoks - 1) / decode_s if (ctoks and decode_s and ctoks > 1) else None,
                    "chunks": meter.chunks,
                    "content_chars": meter.content_chars,
                    "reasoning_chars": meter.reasoning_chars,
                    "tool_call_deltas": meter.tool_call_deltas,
                    "finish_reason": meter.finish_reason,
                    **ufields,
                })

        return StreamingResponse(relay(), status_code=resp.status_code, headers=out_headers)

    return Starlette(routes=[Route("/{path:path}", proxy, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--upstream", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--log", type=Path, required=True)
    ap.add_argument("--story-file", type=Path)
    args = ap.parse_args()
    args.log.parent.mkdir(parents=True, exist_ok=True)
    uvicorn.run(build_app(args.upstream, args.log, args.story_file), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
