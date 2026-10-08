#!/usr/bin/env python3
"""Does OpenCode, configured and run the way the harness runs it, complete a tool-calling task against a server?

The capability probe (basic-capability.py) talks to the server's API directly, so it never exercises what a CODING CLIENT adds:
its own system prompt, its nine tool definitions, its request shape. This runs OpenCode itself, with the harness's own adapter
(`benchmarks/spec-bench/harness/clients.py`, so the config and the command are the ones a series would use), in an empty workspace,
and asks for a small task that needs a tool call whose argument carries newlines: write a file of three lines. It then checks the
file, not what the model said about it.

    uv run tools/engine-probe/opencode-tool-smoke.py --base-url http://127.0.0.1:18010/v1 --model NAME
    uv run tools/engine-probe/opencode-tool-smoke.py --self-test
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[2] / "benchmarks" / "spec-bench" / "harness"
sys.path.insert(0, str(HARNESS))

CONTEXT = 131072
OUTPUT = 32768
TIMEOUT_S = 900
TARGET = "hello.txt"
LINES = ["one", "two", "three"]
PROMPT = (f"Create a file named {TARGET} in the current directory whose content is exactly these three lines, one per line, and nothing "
          f"else: {', '.join(LINES)}. Use your file tools, not the shell echo. Reply 'done' when it exists.")


def judge(workspace: Path) -> tuple[bool, str]:
    """Whether the file the task asked for exists with exactly the three lines. What the model SAID is not evidence."""
    f = workspace / TARGET
    if not f.is_file():
        return False, f"{TARGET} was not created"
    got = f.read_text().splitlines()
    return (got == LINES), f"{TARGET} has {len(got)} lines: {got!r}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--model")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
        return 0
    if not (a.base_url and a.model):
        ap.error("--base-url and --model are required")
    from clients import OpenCodeClient
    work = Path(tempfile.mkdtemp(prefix="oc-smoke-"))
    client = OpenCodeClient(work)
    client.write_config(a.base_url, a.model, CONTEXT, OUTPUT)
    ws = work / "ws"
    ws.mkdir()
    home = work / "agent-home"
    env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"), XDG_DATA_HOME=str(home / ".local/share"),
               XDG_CACHE_HOME=str(home / ".cache"), XDG_STATE_HOME=str(home / ".local/state"))
    started = time.time()
    run = subprocess.run(client.command(a.model, PROMPT), cwd=ws, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
    state = {"session": None, "steps": 0, "tool_calls": 0, "error": None, "tokens": {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0}}
    for line in run.stdout.splitlines():
        try:
            client.scan(json.loads(line), state)
        except ValueError:
            continue
    ok, why = judge(ws)
    print(json.dumps({"opencode_exit": run.returncode, "seconds": round(time.time() - started, 1), "steps": state["steps"],
                      "tool_calls": state["tool_calls"], "tokens": state["tokens"], "error": state["error"], "task_done": ok, "check": why}, indent=1))
    return 0 if ok else 1


def self_test() -> None:
    d = Path(tempfile.mkdtemp())
    assert judge(d) == (False, f"{TARGET} was not created")
    (d / TARGET).write_text("one\ntwo\n")
    assert judge(d)[0] is False and "2 lines" in judge(d)[1]
    (d / TARGET).write_text("one\ntwo\nthree\n")
    assert judge(d)[0] is True
    (d / TARGET).write_text("one\ntwo\nthree\nfour\n")
    assert judge(d)[0] is False, "extra content is not 'nothing else'"
    from clients import OpenCodeClient
    c = OpenCodeClient(d / "w")
    c.write_config("http://127.0.0.1:1/v1", "m", CONTEXT, OUTPUT)
    cfg = json.loads((d / "w" / "agent-home" / ".config" / "opencode" / "opencode.json").read_text())
    lim = cfg["provider"]["local"]["models"]["m"]["limit"]
    assert lim == {"context": CONTEXT, "output": OUTPUT}, "the config is the harness's: context and output limits only"
    assert c.command("m", "p")[:3] == ["opencode", "run", "--pure"]
    print("self-test ok")


if __name__ == "__main__":
    sys.exit(main())
