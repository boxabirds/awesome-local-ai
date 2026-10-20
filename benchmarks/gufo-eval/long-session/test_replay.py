"""uv run --with pytest pytest benchmarks/gufo-eval/long-session/test_replay.py"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import replay

MTP_USAGE = {"mtp": {"proposed": 607, "accepted": 446}}


class StreamingStub(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        chunks = [
            {"choices": [{"delta": {"content": "hi"}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 2, "gufo": MTP_USAGE}},
        ]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for c in chunks:
            self.wfile.write(f"data: {json.dumps(c)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *_):
        pass


def test_the_engines_own_usage_block_is_recorded_raw():
    """What a build reports differs by version (0.17.0 adds draft_rounds); a replay keeps all of it."""
    server = HTTPServer(("127.0.0.1", 0), StreamingStub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        r = replay.replay(f"http://127.0.0.1:{server.server_port}", {"messages": []})
    finally:
        server.shutdown()
    assert r["engine_usage"] == MTP_USAGE
    assert r["completion_tokens"] == 2
