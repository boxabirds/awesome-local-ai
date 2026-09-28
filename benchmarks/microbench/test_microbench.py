# Tests for the microbench runner: summaries, criteria and a full plan against a stub server.
import json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import microbench as mb


def test_summary_per_variant():
    rows = [{"probe": "replay", "variant": "as-is", "completion_tokens": 1000, "seconds": 20, "tool_args_valid": True},
            {"probe": "replay", "variant": "as-is", "completion_tokens": 3000, "seconds": 40, "tool_args_valid": True},
            {"probe": "replay", "variant": "effort-low", "completion_tokens": 400, "seconds": 9, "tool_args_valid": True},
            {"probe": "replay", "variant": "effort-low", "completion_tokens": 600, "seconds": 11, "tool_args_valid": False}]
    s = mb.summarise(rows)
    assert s["replay"]["as-is"]["median_completion_tokens"] == 2000
    assert s["replay"]["effort-low"]["valid_tool_rate"] == 0.5
    assert s["replay"]["effort-low"]["n"] == 2


def test_errors_are_counted_not_averaged():
    rows = [{"probe": "replay", "variant": "as-is", "error": "timeout"},
            {"probe": "replay", "variant": "as-is", "completion_tokens": 10, "seconds": 1, "tool_args_valid": True}]
    s = mb.summarise(rows)["replay"]["as-is"]
    assert s["errors"] == 1 and s["median_completion_tokens"] == 10


def test_criteria_pass_and_fail():
    summary = {"replay": {"as-is": {"median_completion_tokens": 2000, "valid_tool_rate": 1.0},
                          "effort-low": {"median_completion_tokens": 500, "valid_tool_rate": 1.0}}}
    crit = [{"name": "thinks less", "expr": "ratio(replay['effort-low']['median_completion_tokens'], replay['as-is']['median_completion_tokens']) <= 0.7"},
            {"name": "tools fine", "expr": "replay['effort-low']['valid_tool_rate'] >= replay['as-is']['valid_tool_rate']"}]
    v = mb.verdict(summary, crit)
    assert v["passed"] and all(c["passed"] for c in v["criteria"])
    summary["replay"]["effort-low"]["valid_tool_rate"] = 0.5
    assert not mb.verdict(summary, crit)["passed"]


def test_a_criterion_that_cannot_be_evaluated_fails():
    v = mb.verdict({}, [{"name": "missing", "expr": "replay['x']['y'] > 1"}])
    assert not v["passed"] and "error" in v["criteria"][0]


class _Stub(BaseHTTPRequestHandler):
    """Answers like a thinking model: shorter reasoning when reasoning_effort is "low"."""
    def log_message(self, *a): pass
    def do_GET(self):
        self._send({"data": [{"id": "stub"}]})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        tokens = 100 if body.get("reasoning_effort") == "low" else 1000
        if body.get("stream"):
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            chunks = [{"choices": [{"delta": {"reasoning_content": "r" * tokens}}]},
                      {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "bash", "arguments": "{\"command\": \"ls\"}"}}]}}]},
                      {"choices": [{"delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 50, "completion_tokens": tokens}}]
            for c in chunks:
                self.wfile.write(f"data: {json.dumps(c)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self._send({"choices": [{"message": {"reasoning_content": "r" * tokens, "content": "ok"}, "finish_reason": "stop"}],
                        "usage": {"completion_tokens": tokens}})
    def _send(self, d):
        b = json.dumps(d).encode(); self.send_response(200)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers()
        self.wfile.write(b)


def test_plan_runs_end_to_end_against_a_stub_server(tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), _Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    req = tmp_path / "turn.json"
    req.write_text(json.dumps({"model": "x", "messages": [{"role": "user", "content": "hi"}], "tools": [], "max_completion_tokens": 100}))
    plan = {"name": "t", "probes": [
        {"probe": "effort-silence", "repeats": 1, "variants": ["none", "low"]},
        {"probe": "replay", "requests": [str(req)], "variants": ["as-is", "effort-low"], "repeats": 1}],
        "criteria": [{"name": "low thinks less", "expr": "ratio(replay['effort-low']['median_completion_tokens'], replay['as-is']['median_completion_tokens']) <= 0.7"}]}
    out = tmp_path / "out"
    result = mb.run_plan(plan, f"http://127.0.0.1:{srv.server_port}", out, label="stub")
    srv.shutdown()
    assert result["verdict"]["passed"]
    assert (out / "raw.jsonl").exists() and (out / "summary.json").exists() and (out / "verdict.json").exists()
    s = json.loads((out / "summary.json").read_text())
    assert s["effort-silence"]["none"]["median_completion_tokens"] == 1000
    assert s["effort-silence"]["low"]["median_completion_tokens"] == 100
