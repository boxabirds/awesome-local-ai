"""Streaming OpenAI-compatible stub that saves full request bodies.

Turn 1 answers with a read-only `glob` tool call; later turns answer "done".
This makes OpenCode send both a first-turn body and a tool-result body.
"""
import json, sys, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = int(sys.argv[1]); OUT = sys.argv[2]
count = {"n": 0}

def chunk(delta, finish=None):
    return {"id": "c1", "object": "chat.completion.chunk", "created": int(time.time()), "model": "stub",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        b = b'{"object":"list","data":[{"id":"stub-model","object":"model"}]}'
        self.send_response(200); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        count["n"] += 1
        with open(f"{OUT}/req{count['n']}.json", "wb") as f: f.write(body)
        req = json.loads(body)
        has_tool_result = any(m.get("role") == "tool" for m in req.get("messages", []))
        self.send_response(200); self.send_header("content-type", "text/event-stream"); self.end_headers()
        if not has_tool_result and req.get("tools"):
            events = [chunk({"role": "assistant", "tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                      "function": {"name": "glob", "arguments": json.dumps({"pattern": "*.txt"})}}]}),
                      chunk({}, "tool_calls")]
        else:
            events = [chunk({"role": "assistant", "content": "done"}), chunk({}, "stop")]
        for e in events: self.wfile.write(f"data: {json.dumps(e)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
