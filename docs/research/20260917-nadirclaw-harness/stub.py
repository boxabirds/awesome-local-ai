"""OpenAI/Anthropic-shaped stub upstream. Records every request to a JSONL file."""
import json, sys, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = int(sys.argv[1])
LOG = sys.argv[2]
DELAY_S = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self._send({"object": "list", "data": []})
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        rec = {"t": time.time(), "port": PORT, "path": self.path, "model": body.get("model"),
               "body_keys": sorted(body.keys()),
               "auth": self.headers.get("authorization"), "x_api_key": self.headers.get("x-api-key"),
               "n_messages": len(body.get("messages", []))}
        with open(LOG, "a") as f: f.write(json.dumps(rec) + "\n")
        if DELAY_S: time.sleep(DELAY_S)
        if self.path.endswith("/messages"):
            self._send({"id": "msg_stub", "type": "message", "role": "assistant", "model": body.get("model"),
                        "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn",
                        "usage": {"input_tokens": 1, "output_tokens": 1}})
        else:
            self._send({"id": "chatcmpl-stub", "object": "chat.completion", "created": int(time.time()),
                        "model": body.get("model"),
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})
    def _send(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
