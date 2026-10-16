"""import_run: a run built by Claude Code subagents continues under the harness, only if nothing peeked."""
import json
import subprocess
from pathlib import Path

import pytest

import drive
import import_run as ir
import roots

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


SUBAGENT_MINUTES = 8
SUBAGENT_TOKENS = 100
SUBAGENT_TOOL_USES = 20


class Import:
    """What the command line needs: a repo with the subagents' metrics, a workspace, a transcript for story 1, a pack
    with one story, and a work root, all in tmp_path and handed to drive the way a real run's are."""

    def __init__(self, tmp_path, monkeypatch, transcript_paths=None, stories=(1,)):
        self.tmp = tmp_path
        self.repo = tmp_path / "repo"
        self.run = self.repo / "benchmarks" / "reference" / "vidi" / "opus-5.5" / "run-2"
        self.run.mkdir(parents=True)
        self.sub = {"stories": {"1": {"agent_minutes": SUBAGENT_MINUTES, "subagent_tokens": SUBAGENT_TOKENS,
                                     "tool_uses": SUBAGENT_TOOL_USES, "commit": "a1"}}}
        (self.run / "metrics.json").write_text(json.dumps(self.sub))
        self.ws = make_ws(tmp_path)
        self.session = tmp_path / "session"
        (self.session / "subagents").mkdir(parents=True)
        paths = transcript_paths if transcript_paths is not None else [f"{self.ws}/spec/x.md"]
        (self.session / "subagents" / "agent-abc.jsonl").write_text(transcript(tmp_path, "s1", paths).read_text())
        self.agents = tmp_path / "agents.json"
        self.agents.write_text(json.dumps({str(s): "abc" for s in stories}))
        pack = tmp_path / "pack"
        (pack / "scope").mkdir(parents=True)
        (pack / "scope" / "canvas.json").write_text(json.dumps({"stories": [{"id": 1, "dir": "001-pan"}]}))
        (pack / "spec" / "stories" / "001-pan").mkdir(parents=True)
        (pack / "spec" / "stories" / "001-pan" / "story.md").write_text("# Pan the canvas\n\nbody\n")
        monkeypatch.setattr(drive, "REPO_ROOT", self.repo)
        monkeypatch.setattr(drive, "PACK", pack)
        monkeypatch.setattr(drive, "SPEC", pack / "spec")
        monkeypatch.setattr(drive, "WORK_ROOT", tmp_path / "work-root")

    def command(self, monkeypatch, run_dir=None, *extra):
        argv = ["import_run.py", "--run-dir", str(run_dir or self.run), "--workspace", str(self.ws),
                "--transcripts", str(self.agents), "--session-dir", str(self.session), *extra]
        monkeypatch.setattr("sys.argv", argv)
        ir.main()


def test_the_command_imports_a_clean_run_into_the_harness_form(tmp_path, monkeypatch, capsys):
    job = Import(tmp_path, monkeypatch)
    job.command(monkeypatch)
    work = Path((job.run / "work_dir.txt").read_text())
    assert work.parent == tmp_path / "work-root" and (work / "workspace" / ".git").is_dir()
    assert json.loads((job.run / "metrics.subagent.json").read_text()) == job.sub
    m = json.loads((job.run / "metrics.json").read_text())
    assert m["imported_from"] == ir.METHOD and m["scope"] == "canvas"
    assert [(p["id"], p["title"], p["status"]) for p in m["processed"]] == [(1, "Pan the canvas", "DONE")]
    assert m["stories"]["1"]["agent"]["seconds"] == SUBAGENT_MINUTES * ir.SECONDS_PER_MINUTE
    assert m["stories"]["1"]["imported"]["peek_audit"]["peeks"] == 0
    assert capsys.readouterr().out.splitlines() == [
        "story 1: 1 tool calls, 0 peeks, 0 to review",  # the transcript has one Read
        f"imported stories [1] into {job.run}; harness workspace {work / 'workspace'}"]


def test_the_command_takes_a_run_dir_relative_to_the_results_root(tmp_path, monkeypatch):
    job = Import(tmp_path, monkeypatch)
    job.command(monkeypatch, job.run.relative_to(job.repo))
    assert (job.run / "metrics.subagent.json").exists()


def test_the_command_imports_nothing_when_a_story_peeked(tmp_path, monkeypatch, capsys):
    job = Import(tmp_path, monkeypatch, transcript_paths=[f"{roots.RESULTS_ROOT}/benchmarks/vidi/acceptance/tests/story-01.spec.ts"])
    with pytest.raises(SystemExit, match="story 1 touched secrets; not importing"):
        job.command(monkeypatch)
    assert "1 peeks" in capsys.readouterr().out
    assert json.loads((job.run / "metrics.json").read_text()) == job.sub  # untouched
    assert not (job.run / "work_dir.txt").exists() and not (tmp_path / "work-root").exists()


def test_the_command_with_no_transcripts_audits_nothing_and_still_imports_the_recorded_stories(tmp_path, monkeypatch, capsys):
    job = Import(tmp_path, monkeypatch, stories=())
    job.command(monkeypatch)
    m = json.loads((job.run / "metrics.json").read_text())
    assert m["stories"]["1"]["imported"]["peek_audit"] == {}  # no audit was made of it
    assert capsys.readouterr().out.splitlines()[0].startswith("imported stories [1] into ")  # no "story N:" audit lines
