"""capture_pi_requests.mjs must render a recorded session into exactly the requests pi itself sent.

A real pi session is run against the fake server (one tool call, then an answer), with the harness's model config;
the fake records what pi sent. The capture then reads pi's own event log of that session and renders it; each body
must equal pi's, field for field. Skipped, saying so, where pi or node is not installed.
"""

import gzip
import json
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
CAPTURE = HERE.parent / "capture_pi_requests.mjs"
PI_RUN_TIMEOUT_S = 120
MODEL = "tf"
CONTEXT_WINDOW = 131072
MAX_TOKENS = 32768

pytestmark = pytest.mark.skipif(not (shutil.which("pi") and shutil.which("node")),
                                reason="pi and node are needed to compare against pi's own requests")


def _pi_session(url: str, tmp: Path) -> Path:
    agent, ws, sessions = tmp / "agent", tmp / "ws", tmp / "sessions"
    for d in (agent, ws, sessions):
        d.mkdir()
    # the harness's config (benchmarks/spec-bench/harness/clients.py write_config)
    (agent / "models.json").write_text(json.dumps({"providers": {"local": {
        "baseUrl": url + "/v1", "api": "openai-completions", "apiKey": "local",
        "models": [{"id": MODEL, "name": MODEL, "input": ["text"], "contextWindow": CONTEXT_WINDOW,
                    "maxTokens": MAX_TOKENS, "reasoning": True,
                    "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False}}]}}}))
    (agent / "settings.json").write_text(json.dumps({"quietStartup": True}))
    out = subprocess.run(
        ["pi", "-p", "--mode", "json", "--model", f"local/{MODEL}", "--no-extensions", "--no-skills",
         "--no-prompt-templates", "--no-context-files", "--no-approve", "--session-dir", str(sessions), "--",
         "List the files here, then say done."],
        cwd=ws, env={**__import__("os").environ, "PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1"},
        capture_output=True, text=True, timeout=PI_RUN_TIMEOUT_S)
    log = tmp / "agent-events.jsonl"
    log.write_text(out.stdout)
    return log


def test_capture_reproduces_pis_own_requests(fake, tmp_path):
    st, url = fake(tools="once")
    log = _pi_session(url, tmp_path)
    sent = list(st.requests)
    assert len(sent) == 2, f"pi should have made a tool call and then answered; it sent {len(sent)} requests"
    assert sent[0]["messages"][-1]["role"] == "user" and sent[1]["messages"][-1]["role"] == "tool"

    out = tmp_path / "bodies"
    subprocess.run(["node", str(CAPTURE), "--log", str(log), "--out", str(out), "--model", MODEL,
                    "--context-window", str(CONTEXT_WINDOW), "--max-tokens", str(MAX_TOKENS)],
                   check=True, capture_output=True, text=True, timeout=PI_RUN_TIMEOUT_S)
    got = [json.loads(gzip.open(p, "rt").read()) for p in sorted(out.glob("*.json.gz"))]
    assert len(got) == len(sent)
    for mine, pis in zip(got, sent):
        assert mine == pis
    index = json.loads((out / "index.json").read_text())
    assert [t["turn"] for t in index["turns"]] == [1, 2]
