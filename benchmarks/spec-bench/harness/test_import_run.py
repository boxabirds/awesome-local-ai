"""import_run: a run built by Claude Code subagents continues under the harness, only if nothing peeked."""
import json
import subprocess
from pathlib import Path

import import_run as ir

SCOPE = {"stories": [{"id": 1, "dir": "001-a"}, {"id": 2, "dir": "002-b"}, {"id": 3, "dir": "003-c"}]}


def transcript(tmp: Path, name: str, paths: list[str]) -> Path:
    t = tmp / f"{name}.jsonl"
    t.write_text("\n".join(json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Read", "input": {"file_path": p}}]}}) for p in paths) + "\n")
    return t


def make_ws(tmp: Path) -> Path:
    ws = tmp / "sub" / "workspace"
    ws.mkdir(parents=True)
    (ws / "README.md").write_text("x")
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=ws, check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "x", "--allow-empty"], cwd=ws, check=True)
    return ws


def test_harness_metrics_mark_imported_stories_done_in_scope_order():
    sub = {"stories": {"1": {"agent_minutes": 8, "subagent_tokens": 100, "tool_uses": 20, "commit": "a1"},
                       "2": {"agent_minutes": 17, "subagent_tokens": 200, "tool_uses": 60, "commit": "b2"}}}
    audits = {1: {"tool_calls": 20, "peeks": 0, "review": 1}, 2: {"tool_calls": 60, "peeks": 0, "review": 0}}
    m = ir.harness_metrics(sub, {1: "A", 2: "B"}, audits, SCOPE)
    assert [p["id"] for p in m["processed"]] == [1, 2] and all(p["status"] == "DONE" for p in m["processed"])
    s1 = m["stories"]["1"]
    assert s1["finished"] and s1["imported"]["method"] == "claude-code-subagent" and s1["imported"]["peek_audit"]["peeks"] == 0
    assert s1["agent"]["seconds"] == 8 * 60 and s1["agent"]["stalled"] is False


def test_import_refuses_when_any_story_peeked(tmp_path):
    ws = make_ws(tmp_path)
    clean = transcript(tmp_path, "s1", [f"{ws}/spec/x.md"])
    peek = transcript(tmp_path, "s2", ["/secret/pack/acceptance/tests/story-01.spec.ts"])
    res = ir.audit_stories({1: clean, 2: peek}, allowed=[str(ws.parent)], sensitive=["/secret/pack"])
    assert res[1]["peeks"] == 0 and res[2]["peeks"] == 1
    assert ir.refusal(res) and "story 2" in ir.refusal(res)


def test_workspace_is_copied_with_its_history(tmp_path):
    ws = make_ws(tmp_path)
    dest = tmp_path / "work" / "workspace"
    ir.copy_workspace(ws, dest)
    assert (dest / ".git").is_dir() and (dest / "README.md").read_text() == "x"
