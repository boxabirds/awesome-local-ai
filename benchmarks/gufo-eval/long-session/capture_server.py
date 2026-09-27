# /// script
# requires-python = ">=3.11"
# ///
"""Record the exact chat request a client sends, and answer with a one-line stub.

    uv run capture_server.py --port 18099 --out DIR

Each POST to /v1/chat/completions is saved as DIR/request-N.json; the reply is a minimal
OpenAI-compatible stream (or a plain response) so the client finishes its turn and exits.
GET /v1/models lists one model, "capture". Used to take pi's real requests (system prompt, tools,
history) from a recorded session, to replay them unchanged against different engines.
"""
from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STUB = "ok"


def make_handler(out: Path):
    counter = {"n": 0}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _json(self, obj: dict, code: int = 200) -> None:
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            if self.path.rstrip("/").endswith("/v1/models"):
                return self._json({"object": "list", "data": [{"id": "capture", "object": "model"}]})
            self._json({"error": "not found"}, 404)

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            counter["n"] += 1
            (out / f"request-{counter['n']}.json").write_bytes(body)
            req = json.loads(body or b"{}")
            base = {"id": "capture", "object": "chat.completion.chunk", "created": int(time.time()), "model": "capture"}
            if req.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for delta, finish in (({"role": "assistant", "content": STUB}, None), ({}, "stop")):
                    chunk = {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                usage = {**base, "choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
                self.wfile.write(f"data: {json.dumps(usage)}\n\ndata: [DONE]\n\n".encode())
                return
            self._json({**base, "object": "chat.completion",
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": STUB}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    return H


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(a.out)).serve_forever()


if __name__ == "__main__":
    main()
