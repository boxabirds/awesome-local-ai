#!/usr/bin/env python3
"""Capture exactly what a coding client sends to an OpenAI-compatible server, with no model behind it.

    uv run --with tokenizers tools/engine-probe/capture-client-request.py OUTDIR {opencode|pi} [TOKENIZER_JSON]

Run it where the client is installed. Starts a stub on a private port that records every request body and answers with a one-line streamed reply, then runs
`opencode run` the way the harness does (isolated XDG config, same provider config) in an empty directory, and
tokenizes each part of what was sent with the Qwen tokenizer. Prints a table; writes the raw bodies for inspection.
"""
import json, os, subprocess, sys, tempfile, threading, http.server, pathlib

PORT = 18777
DEFAULT_TOKENIZER = "~/.mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit/tokenizer.json"  # the Qwen3.8 tokenizer
TOKENIZER = os.path.expanduser(sys.argv[3] if len(sys.argv) > 3 else DEFAULT_TOKENIZER)
CLIENT = sys.argv[2] if len(sys.argv) > 2 else "opencode"
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
CTX, OUTLIM, MODEL = 131072, 32768, "stub-model"
bodies = []

class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        bodies.append(body); (OUT / f"req{len(bodies)}.json").write_text(json.dumps(body, indent=1))
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        ch = lambda d, f=None: ("data: " + json.dumps({"id": "x", "object": "chat.completion.chunk", "model": MODEL,
            "choices": [{"index": 0, "delta": d, "finish_reason": f}]}) + "\n\n").encode()
        self.wfile.write(ch({"role": "assistant", "content": "ok"})); self.wfile.write(ch({}, "stop"))
        self.wfile.write(b"data: " + json.dumps({"id": "x", "object": "chat.completion.chunk", "model": MODEL, "choices": [],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}).encode() + b"\n\ndata: [DONE]\n\n")
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

home = pathlib.Path(tempfile.mkdtemp()); cfgdir = home / ".config" / "opencode"; cfgdir.mkdir(parents=True)
(cfgdir / "opencode.json").write_text(json.dumps({
    "$schema": "https://opencode.ai/config.json", "autoupdate": False, "share": "disabled",
    "permission": {"edit": "allow", "bash": "allow", "webfetch": "deny", "external_directory": "deny"},
    "provider": {"local": {"npm": "@ai-sdk/openai-compatible", "name": "vidi local",
        "options": {"baseURL": f"http://127.0.0.1:{PORT}/v1", "apiKey": "local"},
        "models": {MODEL: {"name": MODEL, "limit": {"context": CTX, "output": OUTLIM}}}}}}))
work = home / "ws"; work.mkdir(); subprocess.run(["git", "init", "-q"], cwd=work)
env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"), XDG_DATA_HOME=str(home / ".local/share"),
           XDG_CACHE_HOME=str(home / ".cache"), XDG_STATE_HOME=str(home / ".local/state"))
if CLIENT == "opencode":
    r = subprocess.run(["opencode", "run", "--pure", "--format", "json", "--model", f"local/{MODEL}", "Say ok."],
                       cwd=work, env=env, capture_output=True, text=True, timeout=180)
else:
    ad = home / "pi-agent"; ad.mkdir(); sd = home / "pi-sessions"; sd.mkdir()
    (ad / "models.json").write_text(json.dumps({"providers": {"local": {"baseUrl": f"http://127.0.0.1:{PORT}/v1", "api": "openai-completions", "apiKey": "local",
        "models": [{"id": MODEL, "name": MODEL, "input": ["text"], "contextWindow": CTX, "maxTokens": OUTLIM, "reasoning": True,
                    "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False}}]}}}))
    (ad / "settings.json").write_text(json.dumps({"quietStartup": True}))
    env.update(PI_CODING_AGENT_DIR=str(ad), PI_OFFLINE="1")
    r = subprocess.run(["pi", "-p", "--mode", "json", "--model", f"local/{MODEL}", "--no-extensions", "--no-skills", "--no-prompt-templates",
                        "--no-context-files", "--no-approve", "--session-dir", str(sd), "--", "Say ok."], cwd=work, env=env, capture_output=True, text=True, timeout=180)
print(CLIENT, "exit", r.returncode, "requests captured:", len(bodies), file=sys.stderr)

from tokenizers import Tokenizer
tok = Tokenizer.from_file(TOKENIZER)
n = lambda s: len(tok.encode(s).ids)
rows = []
for i, b in enumerate(bodies, 1):
    msgs = b.get("messages", []); tools = b.get("tools") or []
    sys_t = sum(n(m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])) for m in msgs if m["role"] == "system")
    usr_t = sum(n(m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])) for m in msgs if m["role"] != "system")
    per_tool = {t["function"]["name"]: n(json.dumps(t["function"])) for t in tools}
    rows.append({"request": i, "model": b.get("model"), "n_messages": len(msgs), "system_tokens": sys_t, "other_message_tokens": usr_t,
                 "tools": len(tools), "tools_tokens": sum(per_tool.values()), "per_tool": per_tool,
                 "other_keys": sorted(k for k in b if k not in ("messages", "tools"))})
print(json.dumps(rows, indent=1))
