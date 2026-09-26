"""run.sh keeps every server start's log in the run's server.log, each after a start marker with its
wall-clock time (llama_log reads per-request timings from it). It used to truncate the file at each
start, so a restart erased the timings of every story before it."""
import os
import shutil
import socket
import subprocess
from pathlib import Path

import llama_log
from test_record_event import HARNESS, IDENTITY, fake_pack, repo_with_remote

FAKE_SERVER = '''#!/usr/bin/env python3
import http.server, json, os
print("fake llama-server says hello", flush=True)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"data": [{"id": "fake-model"}]}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
'''


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_each_server_start_is_appended_after_a_start_marker(tmp_path):
    repo, _ = repo_with_remote(tmp_path)
    shutil.copytree(HARNESS, repo / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    (repo / "stack.env").write_text("CONTEXT_LIMIT=0\nOUTPUT_LIMIT=0\n")
    home = tmp_path / "home"
    install = home / ".local/share/fake-stack"
    install.mkdir(parents=True)
    (install / "install.env").write_text('COMBINATION="x"\nBACKEND="llamacpp"\n'
                                         'RUN_BASE="runs/fake"\nCONFIG_FILE="stack.env"\n')
    pack = fake_pack(tmp_path)
    (pack / "acceptance" / "node_modules").mkdir(parents=True)
    (pack / "acceptance" / "package-lock.json").write_text("{}")
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for tool in ("uv", "npm", "npx", "node", "pi"):
        (stubs / tool).write_text("#!/bin/sh\nexit 0\n")
    (stubs / "fake-stack-server").write_text(FAKE_SERVER)
    real_python = shutil.which("python3")
    (stubs / "python3").write_text(f'#!/bin/sh\ncase "$*" in *wait_for_thermal*) echo "  thermal=nominal"; exit 0;; esac\n'
                                   f'exec "{real_python}" "$@"\n')
    for f in stubs.iterdir():
        f.chmod(0o755)
    env = {**os.environ, **IDENTITY, "HOME": str(home), "VIDI_PACK_DIR": str(pack),
           "PATH": f"{stubs}:{os.environ['PATH']}", "BENCH_PORT": str(free_port())}
    log = repo / "runs/fake/r1/server.log"
    for _ in range(2):
        r = subprocess.run([str(repo / "benchmarks/spec-bench/harness/run.sh"), "fake-stack", "--run-id", "r1",
                            "--client", "pi"], env=env, capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]
    text = log.read_text()
    assert text.count("fake llama-server says hello") == 2, text
    starts = llama_log.server_starts(text)
    assert len(starts) == 2 and starts[0] <= starts[1], text
