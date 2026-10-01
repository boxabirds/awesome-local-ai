"""A tiny OpenAI-compatible chat server for testing the TensorFold checks without TensorFold.

It serves one conversation and can be told to misbehave in each way the checks must catch:

  cache    keep         every turn reuses the previous prompt (one token short, as TensorFold keeps it)
           drop         nothing is ever reused (every turn re-reads the whole context)
           drop_above   reuse stops once the previous prompt passes --drop-above tokens (TensorFold issue 71's shape)
           lie_slow     reports reuse, but takes as long as re-reading the whole context
  tools    structured   tool calls come back as structured tool_calls
           text         tool calls come back as "<tool_call>" text in content (gufo issue 304's shape)
           stringify    numbers in the arguments come back as strings
           stream_mismatch  the streamed call differs from the non-streamed one
           prose        no tool call at all, a text answer
           once         one tool call when the last message is the user's, then a text answer (drives a real pi)
  effort   honoured     reasoning_effort "high" thinks longer than "low"
           ignored      every effort thinks the same
           rejected     a request naming reasoning_effort gets HTTP 400

Prompt tokens are the request's JSON length over CHARS_PER_TOKEN, so a growing conversation grows its count, and time
to first token is (prompt - cached) * --sec-per-token. Run as a script it serves on --port and prints TensorFold's
startup lines (for the driver's end-to-end test); imported, `serve()` starts it on a free port in a thread.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHARS_PER_TOKEN = 4
LOW_REASONING_TOKENS = 6
HIGH_REASONING_TOKENS = 60
REPLY_TOKENS = 12


class State:
    def __init__(self, cache="keep", tools="structured", effort="honoured", sec_per_token=0.0, drop_above=0,
                 window=1_000_000, report_cached=True):
        self.cache, self.tools, self.effort = cache, tools, effort
        self.sec_per_token, self.drop_above, self.window = sec_per_token, drop_above, window
        self.report_cached = report_cached
        self.last_prompt = 0
        self.lock = threading.Lock()
        self.requests: list[dict] = []


def prompt_tokens(body: dict) -> int:
    return len(json.dumps(body.get("messages", [])) + json.dumps(body.get("tools", []))) // CHARS_PER_TOKEN


def _cached(st: State, prompt: int) -> int:
    prev = st.last_prompt
    if st.cache == "drop" or prompt <= prev or prev == 0:
        return 0
    if st.cache == "drop_above" and prev > st.drop_above:
        return 0
    return prev - 1


def _call(body: dict, streamed: bool, st: State) -> tuple[str, dict] | None:
    names = [t["function"]["name"] for t in body.get("tools", []) if t.get("type") == "function"]
    if not names:
        return None
    if "bash" in names:
        args = {"command": "ls -la", "timeout": 30}
        if st.tools == "stringify":
            args["timeout"] = "30"
        if st.tools == "stream_mismatch" and streamed:
            args["timeout"] = 31
        return "bash", args
    return names[0], {"path": "README.md"}


class Handler(BaseHTTPRequestHandler):
    st: State

    def log_message(self, *a):  # quiet
        pass

    def _json(self, code: int, doc: dict):
        data = json.dumps(doc).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/v1/models"):
            return self._json(200, {"object": "list", "data": [{"id": "bench", "object": "model"}]})
        if self.path.startswith("/health"):
            return self._json(200, {"status": "ok"})
        self._json(404, {"error": "no route"})

    def do_POST(self):
        if not self.path.startswith("/v1/chat/completions"):
            return self._json(404, {"error": "no route"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        st = self.st
        st.requests.append(body)
        effort = body.get("reasoning_effort")
        if effort is not None and st.effort == "rejected":
            return self._json(400, {"error": {"message": "unknown field reasoning_effort", "type": "invalid_request_error"}})
        prompt = prompt_tokens(body)
        reply_limit = int(body.get("max_completion_tokens") or body.get("max_tokens") or 0)
        if prompt + reply_limit > st.window:
            return self._json(400, {"error": {"message": f"This server's maximum context length is {st.window} tokens",
                                              "type": "invalid_request_error", "code": "context_length_exceeded"}})
        with st.lock:
            cached = _cached(st, prompt)
            st.last_prompt = prompt
        work = prompt if st.cache == "lie_slow" else prompt - cached
        time.sleep(work * st.sec_per_token)
        thinks = HIGH_REASONING_TOKENS if (effort in ("high", "xhigh") and st.effort == "honoured") else LOW_REASONING_TOKENS
        reasoning = " ".join(["think"] * thinks)
        streamed = bool(body.get("stream"))
        last_role = (body.get("messages") or [{}])[-1].get("role")
        call = None if st.tools == "prose" or (st.tools == "once" and last_role != "user") else _call(body, streamed, st)
        content = None
        if call and st.tools == "text":
            content = ("<tool_call>\n<function=" + call[0] + ">\n" +
                       "".join(f"<parameter={k}>\n{v}\n</parameter>\n" for k, v in call[1].items()) +
                       "</function>\n</tool_call>")
            call = None
        elif call is None:
            content = "Done."
        usage = {"prompt_tokens": prompt, "completion_tokens": thinks + REPLY_TOKENS,
                 "total_tokens": prompt + thinks + REPLY_TOKENS,
                 "completion_tokens_details": {"reasoning_tokens": thinks}}
        if st.report_cached:
            usage["prompt_tokens_details"] = {"cached_tokens": cached}
        finish = "tool_calls" if call else "stop"
        if not streamed:
            msg = {"role": "assistant", "content": content, "reasoning_content": reasoning}
            if call:
                msg["tool_calls"] = [{"id": "call_0", "type": "function",
                                      "function": {"name": call[0], "arguments": json.dumps(call[1])}}]
            return self._json(200, {"id": "x", "object": "chat.completion", "model": body.get("model"),
                                    "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                                    "usage": usage})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def chunk(delta=None, finish_reason=None, usage_=None):
            doc = {"id": "x", "object": "chat.completion.chunk", "model": body.get("model"),
                   "choices": [] if delta is None else [{"index": 0, "delta": delta, "finish_reason": finish_reason}]}
            if usage_ is not None:
                doc["usage"] = usage_
            self.wfile.write(b"data: " + json.dumps(doc).encode() + b"\n\n")
            self.wfile.flush()

        chunk({"role": "assistant", "reasoning_content": reasoning})
        if content:
            half = len(content) // 2
            chunk({"content": content[:half]})
            chunk({"content": content[half:]})
        if call:
            text = json.dumps(call[1])
            cut = len(text) // 2
            chunk({"tool_calls": [{"index": 0, "id": "call_0", "type": "function",
                                   "function": {"name": call[0], "arguments": ""}}]})
            chunk({"tool_calls": [{"index": 0, "function": {"arguments": text[:cut]}}]})
            chunk({"tool_calls": [{"index": 0, "function": {"arguments": text[cut:]}}]})
        chunk({}, finish)
        if (body.get("stream_options") or {}).get("include_usage"):
            chunk(None, None, usage)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def serve(**kw) -> tuple[ThreadingHTTPServer, State, str]:
    """Start on a free loopback port (the OS picks one far from any fixed service port); returns server, state, base URL."""
    st = State(**kw)
    handler = type("H", (Handler,), {"st": st})
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, st, f"http://127.0.0.1:{srv.server_address[1]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--cache", default="keep")
    ap.add_argument("--tools", default="structured")
    ap.add_argument("--effort", default="honoured")
    ap.add_argument("--sec-per-token", type=float, default=0.0)
    ap.add_argument("--window", type=int, default=1_000_000)
    ap.add_argument("--startup-line", action="append", default=[])
    ap.add_argument("--loaded-seconds", type=float, default=0.1)
    a = ap.parse_args()
    st = State(cache=a.cache, tools=a.tools, effort=a.effort, sec_per_token=a.sec_per_token, window=a.window)
    handler = type("H", (Handler,), {"st": st})
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), handler)
    for line in a.startup_line:
        print(line, flush=True)
    print(f"[tensorfold] serving bench at http://127.0.0.1:{a.port}/v1 (sampling: temperature 1.0; drafts: on; "
          f"context: {a.window}; loaded in {a.loaded_seconds:.1f}s)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
