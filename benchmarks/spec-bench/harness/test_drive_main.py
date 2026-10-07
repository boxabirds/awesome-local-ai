"""drive.main, the story loop, pinned branch by branch before it is rebuilt (CLAUDE.md, "Refactor DELETE FIRST").

The loop is the real one, from the command line to metrics.json: a small pack in tmp_path (three stories, a named
scope, an epic, no held-out suite), a scripted agent (a real process printing pi's events, which commits in the real
workspace), the real gate (which finds no package.json) and the real bookkeeping. What depends on the machine is
replaced: the sandbox, the conditions sampler, containment, the stray-process sweep, other runs' baselines, the
harness's own commit. It needs git and nothing else, and each run takes about a second; test_pipeline.py is the
end-to-end test with a real build and a held-out suite.

By what main does: the arguments it refuses; the dry run; an ordinary run and its records; a run started again;
a story the operator ended (before a restart, while it ran, too late); a story continued after a harness restart;
the guards and the stops; what the agent left behind (uncommitted work, a changed spec); a partial rerun; --record.
"""
from __future__ import annotations

import dataclasses
import json
import os
import runpy
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

import attempts
import containment
import drive
import gates
import heldout
import hostenv
import machine_fit
import progress
import progress_file
import sandbox
from clients import PiClient
from sandbox_testing import no_sandbox

PACK = "covpack"
MODEL = "cov-model"
BASE_URL = "http://127.0.0.1:9/v1"
BASE_URL_PORT = 9
NOMINAL = {"ac": True, "low_power": False, "thermal": "nominal"}
HARNESS_PROVENANCE = {"harness_commit": "abc1234", "harness_dirty": False, "harness_release": None}
PACK_VERSION = "covpack-v1"
TEMPLATE = "STORY {{ID}}: {{TITLE}}\n{{STORIES_SO_FAR}}\n{{SCOPE_NOTE}}\n"
SCOPE_NOTE = "Nothing beyond the second story."
TITLES = {1: "First", 2: "Second", 3: "Third"}
STORY_DIRS = {1: "001-first", 2: "002-second", 3: "003-third"}
OUTPUT_TOKENS = 7
OLD_LOG_T = 1_000_000.0          # when a story's earlier attempts ran, in logs written by hand: long before any test

G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]


def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*G, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


# What the scripted agent does for a story, from plan.json ({story: {...}}); with no plan it writes one file,
# commits it, reports one model call and ends its reply with the story's DONE line (the stop rule: test_stop_rule.py).
# Each run is appended to runs.jsonl with the prompt it was given.
AGENT = textwrap.dedent(r'''
    import json, os, subprocess, sys
    from pathlib import Path
    home = Path(@HOME@)
    story = (home / "run" / "current_story").read_text().strip()
    plan = json.loads((home / "plan.json").read_text()).get(story, {})
    with (home / "runs.jsonl").open("a") as f:
        f.write(json.dumps({"story": int(story), "prompt": sys.argv[1], "resume_from": sys.argv[2], "fork": sys.argv[3],
                            "cwd": os.getcwd()}) + "\n")
    runs = [json.loads(l) for l in (home / "runs.jsonl").read_text().splitlines()]
    n = len(runs)
    first_run_of_story = sum(r["story"] == int(story) for r in runs) == 1
    def emit(e):
        print(json.dumps(e), flush=True)
    def sh(*cmd):
        subprocess.run(cmd, check=True, capture_output=True)
    if plan.get("silent"):
        sys.exit(plan.get("exit", 0))
    emit({"type": "session", "id": f"cov-{story}"})
    for line in plan.get("junk", []):                               # output that is JSON but not an event
        print(line, flush=True)
    progress = Path("PROGRESS.md")
    with (home / "progress-seen.jsonl").open("a") as f:
        f.write(json.dumps({"story": int(story), "text": progress.read_text() if progress.exists() else None}) + "\n")
    for old, new in plan.get("progress", {}).items():                # its own account of its tasks: {"row before": "row after"}
        progress.write_text(progress.read_text().replace(old, new))
    if plan.get("progress_gone"):
        progress.unlink()
    if plan.get("seen"):                                             # where the agent finds itself
        (home / "seen.json").write_text(json.dumps({"cwd": os.getcwd(), "env": dict(os.environ)}))
    if plan.get("try_spec"):                                         # what agents did in recorded runs: edit the spec
        try:
            target = Path("spec/README.md")
            target.chmod(0o644)
            target.write_text("# rewritten by the agent\n")
            outcome = "written"
        except OSError as e:
            outcome = f"refused: {type(e).__name__}"
        (home / "spec-write.txt").write_text(outcome)
    if plan.get("commit", True):
        Path("src").mkdir(exist_ok=True)
        Path(f"src/story{story}.ts").write_text(f"// story {story}, run {n}\n")
        sh("git", "add", "-A", "src", "PROGRESS.md")
        sh("git", "commit", "-qm", f"story {story}: work")
    if plan.get("leave"):
        Path(plan["leave"]).write_text("not committed\n")
    if plan.get("tamper"):
        target = Path(plan.get("tamper_file", "spec/README.md"))
        if target.exists():
            target.chmod(0o644)
        target.write_text("# rewritten by the agent\n")
        if plan["tamper"] == "committed":
            sh("git", "add", "-A", "spec")
            sh("git", "commit", "-qm", "spec: suit myself")
    if plan.get("skip_request"):
        control = home / "run" / "control"
        control.mkdir(exist_ok=True)
        (control / "skip-story.json").write_text(json.dumps({"story": int(story), "reason": "too slow", "by": "someone"}))
    emit({"type": "tool_execution_start", "toolName": "bash", "args": {"command": "git commit"}})
    head = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    says = plan.get("says", f"STORY {story} DONE {head}")          # "says": every time; "first_says": the first time only
    if first_run_of_story:
        says = plan.get("first_says", says)
    emit({"type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                             "content": [{"type": "text", "text": says}],
                                             "usage": {"input": 10, "output": @OUTPUT@}}})
    sys.exit(plan.get("exit", 0))
''')


class Scripted(PiClient):
    """pi's events, counting and config, with the scripted agent in place of `pi`."""
    name = "cov"
    script: Path
    made: list = []

    def __init__(self, work, thinking=None, view=None):
        super().__init__(work, thinking, view)
        Scripted.made.append(self)

    def command(self, model_id, prompt, resume_from=None, fork=True):
        return [sys.executable, str(self.script), prompt, str(resume_from), str(fork)]


class Sampler:
    """The conditions sampler, without reading the machine: what it was built with, and a record set by the test."""
    made: list = []
    record: dict = {}

    def __init__(self, ws, server_port=None, record=None):
        Sampler.made.append((ws, server_port, record))

    def start(self):
        pass

    def stop(self):
        return dict(Sampler.record)


def never_skips(*a, **k):
    return type("NeverSkips", (), {"start": lambda s: None, "cap": lambda s, reason: None, "stop": lambda s: None})()


def ends_story(sid: int, request: dict):
    """A skip watcher for which the operator ends story sid as its agent finishes."""
    def make(run, story, ws, **k):
        return type("Ends", (), {"start": lambda s: None, "cap": lambda s, reason: None,
                                 "stop": lambda s: dict(request) if story == sid else None})()
    return make


class Loop:
    """drive.main in tmp_path: the pack, the scripted agent, the machine's parts replaced; what it left behind."""

    def __init__(self, root: Path, mp: pytest.MonkeyPatch, default_scope: str | None):
        self.root, self.mp = root, mp
        self.pack = (root / "pack").resolve()
        self.run = root / "run"
        self.ws_links = root / "links"                                       # drive.WORK_LINKS: the long names
        self.strays: list[Path] = []
        self.recorded: list[tuple] = []
        self.record_result: dict = {"committed": True, "pushed": True, "commit": "abc1234"}
        self._make_pack(default_scope)
        (root / "plan.json").write_text("{}")
        script = root / "agent.py"
        script.write_text(AGENT.replace("@HOME@", repr(str(root))).replace("@OUTPUT@", str(OUTPUT_TOKENS)))
        for name in ("PK", "PACK", "SPEC", "PROMPT_TMPL"):                 # set_pack changes them: put back afterwards
            mp.setattr(drive, name, getattr(drive, name))
        mp.setenv("SPEC_BENCH_PACK_DIR", str(self.pack))
        Scripted.made, Sampler.made = [], []
        Sampler.record = {**drive.summarise_conditions(0, []), "aborted_swap": False, "aborted_memory": False}
        mp.setattr(Scripted, "script", script, raising=False)
        mp.setitem(drive.CLIENTS, Scripted.name, Scripted)
        mp.setattr(drive, "WORK_ROOT", root / "work")
        mp.setattr(drive, "WORK_LINKS", self.ws_links)
        self.work = drive.work_dir_for(self.run)                             # root/work/<id>: short and neutral
        self.ws = self.work / "workspace"
        no_sandbox(mp)
        mp.setattr(hostenv, "oom_first", lambda cmd: cmd)
        mp.setattr(drive, "conditions", lambda: dict(NOMINAL))
        mp.setattr(drive, "ConditionSampler", Sampler)
        real = containment.StoryContainment
        mp.setattr(containment, "StoryContainment", lambda run, story: real(run, story, enabled=False))
        mp.setattr(drive, "kill_strays", self.strays.append)
        mp.setattr(progress, "baselines", lambda repo, sid, run: [])
        mp.setattr(drive, "harness_provenance", lambda code_root: dict(HARNESS_PROVENANCE))
        mp.setattr(drive.provenance, "pack_version", lambda pack_dir, name: PACK_VERSION)
        mp.setattr(drive, "record_story", lambda repo, run, message, **k: self.recorded.append((repo, run, message))
                   or dict(self.record_result))

    def _make_pack(self, default_scope: str | None) -> None:
        for n, slug in STORY_DIRS.items():
            d = self.pack / "spec" / "stories" / slug
            d.mkdir(parents=True)
            (d / "story.md").write_text(f"# {TITLES[n]}\n\nThe story.\n")
            (d / "tasks.md").write_text("# Tasks\n")
        (self.pack / "spec" / "README.md").write_text("# covpack\n")
        (self.pack / "spec" / "epics").mkdir()
        (self.pack / "spec" / "epics" / "small.md").write_text("| Story | Title |\n|---|---|\n| 2 | Second |\n")
        (self.pack / "scope").mkdir()
        (self.pack / "scope" / "two.json").write_text(json.dumps(
            {"name": "two", "stories": [{"id": 1}, {"id": 2}], "out_of_scope_note": SCOPE_NOTE}))
        (self.pack / "prompts").mkdir()
        (self.pack / "prompts" / "story.md.tmpl").write_text(TEMPLATE)
        config = {"name": PACK, "gate": ["build"], **({"default_scope": default_scope} if default_scope else {})}
        (self.pack / "bench.json").write_text(json.dumps(config))

    def plan(self, **stories: dict) -> None:
        (self.root / "plan.json").write_text(json.dumps({k.lstrip("s"): v for k, v in stories.items()}))

    def args(self, *extra: str, client: str = Scripted.name) -> list[str]:
        return ["drive.py", "--pack", PACK, "--run-dir", str(self.run), "--base-url", BASE_URL, "--model-id", MODEL,
                "--client", client, *extra]

    def main(self, *extra: str, **k) -> None:
        self.mp.setattr(sys, "argv", self.args(*extra, **k))
        drive.main()

    def bare(self, *argv: str) -> None:
        """main with exactly these arguments (no run directory, URL or model unless given)."""
        self.mp.setattr(sys, "argv", ["drive.py", "--pack", PACK, *argv])
        drive.main()

    def metrics(self) -> dict:
        return heldout.load_metrics(self.run)

    def story(self, sid: int) -> dict:
        return self.metrics()["stories"][str(sid)]

    def agent_runs(self) -> list[dict]:
        f = self.root / "runs.jsonl"
        return [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []

    def skip_request(self, **req) -> Path:
        f = self.run / drive.CONTROL_DIR / drive.SKIP_FILE
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(req))
        return f

    def events(self, sid: int) -> Path:
        return self.run / "stories" / f"{sid:02d}" / "agent-events.jsonl"


@pytest.fixture(autouse=True)
def clean_story_state(monkeypatch):
    def reset():
        drive.STORY_FAULTS.clear()
        drive.STORY_SKIP.clear()
        drive.RUN_ABORT.clear()
    reset()
    monkeypatch.setattr(drive, "CONTAINMENT", None)
    yield
    reset()


@pytest.fixture
def loop(tmp_path, monkeypatch) -> Loop:
    """The pack's default scope is its named scope `two` (stories 1 and 2)."""
    return Loop(tmp_path, monkeypatch, default_scope="two")


@pytest.fixture
def whole(tmp_path, monkeypatch) -> Loop:
    """A pack with no default scope: every story (1, 2, 3)."""
    return Loop(tmp_path, monkeypatch, default_scope=None)


def no_story_so_far() -> str:
    return "Stories already implemented in this repository, in order: none (empty repository)."


def prompt(sid: int, so_far: str, note: str = SCOPE_NOTE) -> str:
    """The story's prompt: the pack's template filled in, then the harness's request for the DONE line."""
    filled = f"STORY {sid}: {TITLES[sid]}\n{so_far}\n{note}\n"
    return f"{filled.rstrip()}\n\n{drive.harness_paragraph(sid)}\n"


# ======================= the dry run =======================

def test_a_dry_run_prints_the_pack_the_scope_and_the_first_prompt_and_runs_nothing(loop, capsys):
    loop.bare("--dry-run")
    assert capsys.readouterr().out == (
        f"pack {PACK} at {loop.pack}\n"
        "scope two: stories [1, 2]\n"
        "held-out suite: none (acceptance reported n/a); gate: ['build']\n"
        "--- first prompt ---\n"
        f"{prompt(1, no_story_so_far())}\n")
    assert not loop.run.exists() and not (loop.root / "work").exists() and loop.agent_runs() == []


def test_a_dry_run_of_an_epic_takes_the_epic_s_stories_over_the_default_scope(loop, capsys):
    loop.bare("--dry-run", "--epic", "small")
    out = capsys.readouterr().out
    assert "scope epic:small: stories [2]\n" in out and out.endswith(prompt(2, no_story_so_far(), note="") + "\n")


def test_a_dry_run_of_a_pack_without_a_default_scope_takes_every_story(whole, capsys):
    whole.bare("--dry-run")
    out = capsys.readouterr().out
    assert "scope all: stories [1, 2, 3]\n" in out and out.endswith(prompt(1, no_story_so_far(), note="") + "\n")


def test_a_dry_run_of_a_named_scope_narrowed_to_some_stories(whole, capsys):
    whole.bare("--dry-run", "--scope", "two", "--only", "2,3")
    out = capsys.readouterr().out
    assert "scope two: stories [2]\n" in out and "STORY 2: Second\n" in out


def test_a_dry_run_with_no_story_left_prints_no_prompt(loop, capsys):
    loop.bare("--dry-run", "--only", "9")
    out = capsys.readouterr().out
    assert out.splitlines()[1] == "scope two: stories []" and "first prompt" not in out


def test_a_dry_run_names_the_held_out_suite_when_the_pack_has_one(loop, capsys):
    (loop.pack / "acceptance" / "tests").mkdir(parents=True)
    loop.bare("--dry-run")
    assert f"held-out suite: {loop.pack / 'acceptance'}; gate: ['build']\n" in capsys.readouterr().out


# ======================= arguments main refuses =======================

@pytest.mark.parametrize("given, missing", [
    ([], "--run-dir, --base-url, --model-id"),
    (["--run-dir", "RUN"], "--base-url, --model-id"),
    (["--run-dir", "RUN", "--model-id", "m"], "--base-url"),
])
def test_a_run_without_its_directory_url_or_model_is_refused(loop, capsys, given, missing):
    with pytest.raises(SystemExit) as e:
        loop.bare(*[str(loop.run) if a == "RUN" else a for a in given])
    assert e.value.code == 2
    assert f"error: {missing} required (or --dry-run)" in capsys.readouterr().err
    assert not loop.run.exists()


def test_client_thinking_is_refused_for_a_client_other_than_pi(loop):
    with pytest.raises(SystemExit) as e:
        loop.main("--client-thinking", "high")
    assert str(e.value) == "--client-thinking applies to pi only" and loop.agent_runs() == []


NEEDS_ONE = ("--from-run needs --only N (that one story, built on the reference run's code) or --from-story N "
             "(story N and every later story of the scope)")
NOT_BOTH = "--from-run takes --only N or --from-story N, not both"
ONE_STORY = "--from-run with --only runs exactly one story; for story N and every later one use --from-story N"
NEEDS_FROM_RUN = "--from-story needs --from-run: the finished run whose code the stories are built on"


@pytest.mark.parametrize("args, message", [
    (("--from-run", "REF"), NEEDS_ONE),
    (("--from-run", "REF", "--only", "2", "--from-story", "2"), NOT_BOTH),
    (("--from-run", "REF", "--only", "2,3"), ONE_STORY),
    (("--from-run", "REF", "--only", "9"), ONE_STORY),                      # no such story in the scope: none to run
    (("--from-story", "2"), NEEDS_FROM_RUN),
    (("--from-story", "2", "--only", "2"), NEEDS_FROM_RUN),
    (("--from-run", "REF", "--from-story", "9"), "--from-story 9: story 9 is not in the scope (all: stories [1, 2, 3])"),
])
@pytest.mark.parametrize("dry", [False, True])
def test_known_good_mode_is_refused_unless_it_is_told_plainly_which_stories_to_run(whole, tmp_path, capsys, args, message, dry):
    ref, _ = reference_run(whole, tmp_path)
    given = [str(ref) if a == "REF" else a for a in args]
    with pytest.raises(SystemExit) as e:
        whole.bare("--dry-run", *given) if dry else whole.main(*given)
    assert e.value.code == 2 and f"error: {message}\n" in capsys.readouterr().err
    assert not whole.run.exists() and whole.agent_runs() == []


# ======================= an ordinary run =======================

# "memory_start": what the model server held as the story began (memory_snapshot.py), added 7 Oct 2026. The set is
# pinned on purpose, so a new field in the record is a decision and not an accident; it is in TELEMETRY.md too.
RECORD_KEYS = {"title", "conditions_start", "started", "engine_settings", "memory_start", "agent", "agent_finished", "conditions",
               "containment", "agent_commits", "provenance", "gate", "accept", "commit", "requests", "time_split",
               "conversation", "loc", "finished", "status", "ended_by", "partial_base", "tasks", "tasks_claimed", "end_reason"}
ENTRY_KEYS = {"id", "title", "status", "ended_by", "started_at", "ended_at", "agent_minutes", "calls", "output_tokens",
              "compactions", "last_commit_at", "accept", "partial_base", "tasks", "baselines"}


def test_each_story_in_scope_is_run_scored_snapshotted_and_recorded_in_order(loop, capsys):
    loop.main()
    m = loop.metrics()
    assert {k: m[k] for k in ("pack", "scope", "model_id", "client", "compact_at", "client_thinking")} == {
        "pack": PACK, "scope": "two", "model_id": MODEL, "client": Scripted.name, "compact_at": None, "client_thinking": None}
    assert [p["id"] for p in m["processed"]] == [1, 2] and sorted(m["stories"]) == ["1", "2"]
    assert "known_good" not in m
    for sid in (1, 2):
        rec, entry = m["stories"][str(sid)], m["processed"][sid - 1]
        assert set(rec) == RECORD_KEYS and set(entry) == ENTRY_KEYS
        assert (rec["title"], rec["status"], rec["ended_by"], rec["partial_base"], rec["tasks"]) == (TITLES[sid], drive.DONE, "agent", [], [])
        assert rec["conditions_start"] == NOMINAL and rec["conditions"] == Sampler.record and rec["engine_settings"] is None
        assert rec["started"] <= rec["agent_finished"] <= rec["finished"]
        agent = rec["agent"]
        assert (agent["steps"], agent["tool_calls"], agent["exit"], agent["stalled"], agent["sessions"]) == (1, 1, 0, False, [f"cov-{sid}"])
        assert (agent["resumes"], agent["nudges"], agent["errors"], agent["ended_by_operator"]) == (0, 0, [], False)
        assert agent["finished"] is True                                    # on its DONE line, at its first stop
        assert rec["end_reason"] == drive.AGENT_FINISHED == "agent-finished"
        assert agent["interventions"] == {"total": 0, "stop_message": 0, "toolcall_text_resumes": 0, "error_resumes": 0}
        assert agent["tokens"]["output"] == OUTPUT_TOKENS
        assert rec["agent_commits"] == 1 and rec["commit"] == git(loop.ws, "rev-parse", f"HEAD~{2 * (2 - sid)}")
        assert rec["provenance"] == {**HARNESS_PROVENANCE, "pack_version": PACK_VERSION, "source": drive.provenance.LIVE}
        assert rec["gate"] == {"steps": {}, "error": "no package.json"}
        assert rec["accept"] == {"skipped": True, "build_exit": None, "runner_exit": None, "runner_tail": "", "passed": 0,
                                 "total": 0, "on_partial": {"passed": 0, "total": 0}, "by_story": {}, "harness_fault": None}
        assert rec["requests"] == {} and rec["loc"] == {"files": sid, "lines": sid}
        assert rec["time_split"]["accounting"]["ok"] is True and rec["conversation"] is not None
        assert "harness_faults" not in rec and "record" not in rec and "skip" not in rec and "spec_tampered" not in rec
        assert entry == {"id": sid, "title": TITLES[sid], "status": drive.DONE, "ended_by": "agent",
                         "started_at": rec["started"], "ended_at": rec["agent_finished"],
                         "agent_minutes": round(agent["seconds"] / 60, 1), "calls": 1, "output_tokens": OUTPUT_TOKENS,
                         "compactions": 0, "last_commit_at": entry["last_commit_at"], "accept": None, "partial_base": [],
                         "tasks": [], "baselines": []}
        assert isinstance(entry["last_commit_at"], (int, float))
        sdir = loop.run / "stories" / f"{sid:02d}"
        assert json.loads((sdir / "gate.json").read_text()) == rec["gate"]
        assert json.loads((sdir / "accept.json").read_text())["tests"] == []
        # The story began at the harness's commit of its PROGRESS.md: that commit is not the agent's, nor the story's.
        assert (sdir / "base-commit").read_text() == git(loop.ws, "rev-parse", f"HEAD~{5 - 2 * sid}")
        assert rec["tasks_claimed"] == {"file": progress_file.READ, "tasks": {}}          # covpack's stories list no tasks
    out = capsys.readouterr().out
    for sid in (1, 2):
        assert f"[story {sid}] {TITLES[sid]} — agent starting\n" in out
        assert f"[story {sid}] agent done in {m['stories'][str(sid)]['agent']['seconds']}s; running gates\n" in out
        assert f"[story {sid}] DONE gate green=None accept n/a (no held-out suite) stalled=False\n" in out
    assert "recorded:" not in out and loop.recorded == []


def test_the_agent_gets_each_story_s_prompt_in_the_workspace_and_the_prompt_is_kept(loop):
    loop.main()
    first = prompt(1, no_story_so_far())
    second = prompt(2, "Stories already implemented in this repository, in order: 1.")
    assert loop.agent_runs() == [
        {"story": 1, "prompt": first, "resume_from": "None", "fork": "True", "cwd": str(loop.ws.resolve())},
        {"story": 2, "prompt": second, "resume_from": "None", "fork": "True", "cwd": str(loop.ws.resolve())}]
    assert (loop.run / "stories" / "01" / "prompt.md").read_text() == first
    assert (loop.run / "stories" / "02" / "prompt.md").read_text() == second


def test_the_run_s_bookkeeping_files_and_the_workspace_are_where_local_tools_look(loop):
    loop.main()
    assert (loop.run / "work_dir.txt").read_text() == str(loop.work) and (loop.run / "current_story").read_text() == ""
    assert loop.work.name == drive.work_id("run") and (loop.ws_links / "run").resolve() == loop.work.resolve()   # the long name links
    doc = json.loads((loop.run / "progress.json").read_text())
    assert doc["scope"] == "two" and [(s["id"], s["status"]) for s in doc["stories"]] == [(1, drive.DONE), (2, drive.DONE)]
    assert git(loop.ws, "log", "--format=%s").split("\n") == [
        "story 2: work", "harness: PROGRESS.md for story 2", "story 1: work", "harness: PROGRESS.md for story 1",
        "harness: empty repository with spec"]
    assert git(loop.ws, "status", "--porcelain") == ""
    assert sorted(p.name for p in (loop.run / "workspace").iterdir()) == ["PROGRESS.md", "README.md", "src"]      # the mirror: no .git, no spec
    assert "story 2: work" in (loop.run / "workspace-git-log.txt").read_text()
    assert not (loop.run / "interventions.md").exists()


def test_the_machine_is_sampled_by_port_and_swept_after_the_agent_and_after_the_gate(loop):
    loop.main("--only", "1")
    assert [m[:2] for m in Sampler.made] == [(loop.ws, BASE_URL_PORT)]
    # Every reading of the story goes beside its log: stories/NN/conditions.jsonl (git-ignored; dbench collect pulls it).
    assert Sampler.made[0][2].name == drive.CONDITIONS_FILE and Sampler.made[0][2].parent.parent.name == "stories"
    assert loop.strays == [loop.ws, loop.ws]


def test_the_client_is_configured_with_the_server_and_the_limits_given(loop):
    loop.main("--only", "1", "--context-limit", "9000", "--output-limit", "800", "--compact-at", "7000")
    client, = Scripted.made
    assert client.agent_dir == loop.work / "pi-agent" and client.thinking is None
    model, = json.loads((client.agent_dir / "models.json").read_text())["providers"].popitem()[1]["models"]
    assert (model["id"], model["contextWindow"], model["maxTokens"]) == (MODEL, 9000, 800)
    assert json.loads((client.agent_dir / "settings.json").read_text())["compaction"] == {"reserveTokens": 2000}
    assert loop.metrics()["compact_at"] == 7000


def test_pi_is_given_the_thinking_level_asked_for(loop, monkeypatch):
    monkeypatch.setitem(drive.CLIENTS, "pi", Scripted)
    loop.main("--only", "1", "--client-thinking", "high", client="pi")
    client, = Scripted.made
    assert client.thinking == "high" and loop.metrics()["client_thinking"] == "high" and loop.metrics()["client"] == "pi"


@pytest.mark.parametrize("flag, waited", [((), True), (("--no-condition-wait",), False)])
def test_a_story_waits_for_a_fit_machine_unless_told_not_to(loop, monkeypatch, flag, waited):
    asked = []
    monkeypatch.setattr(drive, "wait_for_conditions", lambda wait=True: asked.append(wait) or dict(NOMINAL))
    loop.main("--only", "1", *flag)
    assert asked == [waited]


def test_only_narrows_the_stories_run_and_the_rest_stay_pending(loop):
    loop.main("--only", "2")
    assert [p["id"] for p in loop.metrics()["processed"]] == [2] and [r["story"] for r in loop.agent_runs()] == [2]
    doc = json.loads((loop.run / "progress.json").read_text())
    assert [(s["id"], s["status"]) for s in doc["stories"]] == [(2, drive.DONE)]


def test_a_run_started_again_runs_only_the_stories_not_yet_processed(loop):
    loop.main("--only", "1")
    first = loop.story(1)
    loop.main()
    assert [r["story"] for r in loop.agent_runs()] == [1, 2]                  # story 1's agent was not started again
    assert loop.story(1) == first and [p["id"] for p in loop.metrics()["processed"]] == [1, 2]
    loop.main()
    assert len(loop.agent_runs()) == 2


def test_the_server_s_request_log_is_read_for_the_story_s_window(loop, tmp_path):
    log = tmp_path / "request-log.jsonl"
    log.write_text(json.dumps({"logged_at_s": 1.0, "prompt_tokens": 5}) + "\n")
    loop.main("--only", "1", "--server-log", str(log))
    assert loop.story(1)["requests"]["requests"] == 0 and "decode_by_context" in loop.story(1)["requests"]


def test_a_held_out_result_is_recorded_without_its_tests_and_printed_as_a_score(loop, monkeypatch, capsys):
    calls = []

    def accept(ws, processed, out, acceptance):
        calls.append((ws, [dict(p) for p in processed], out, acceptance))
        sid = processed[-1]["id"]
        return {"skipped": False, "passed": 2, "total": 3, "by_story": {f"{sid:02d}": {"passed": 2, "total": 3}},
                "harness_fault": None, "tests": [{"file": f"story-{sid:02d}.spec.ts", "title": "t", "status": "passed"}]}
    monkeypatch.setattr(gates, "accept", accept)
    loop.main()
    assert loop.story(2)["accept"] == {"skipped": False, "passed": 2, "total": 3, "by_story": {"02": {"passed": 2, "total": 3}},
                                       "harness_fault": None}
    assert loop.metrics()["processed"][1]["accept"] == {"passed": 2, "total": 3}
    assert calls[0] == (loop.ws, [{"id": 1, "status": drive.DONE}], loop.run / "stories" / "01", None)
    assert [p["id"] for p in calls[1][1]] == [1, 2] and calls[1][1][1] == {"id": 2, "status": drive.DONE}
    assert "[story 2] DONE gate green=None accept 2/3 stalled=False\n" in capsys.readouterr().out


def test_a_story_run_under_poor_power_is_marked_degraded_in_its_last_line(loop, capsys):
    Sampler.record = {**Sampler.record, "degraded": True}
    loop.main("--only", "1")
    assert "stalled=False DEGRADED (power/thermal) — timing not comparable\n" in capsys.readouterr().out


def test_a_fault_in_the_bookkeeping_is_saved_with_the_story_even_without_record(loop, monkeypatch):
    def broken(ws):
        raise RuntimeError("no such tree")
    monkeypatch.setattr(drive, "loc", broken)
    loop.main("--only", "1")
    rec = loop.story(1)
    assert rec["loc"] == {} and [f["step"] for f in rec["harness_faults"]] == ["lines of code"]
    assert "harness fault in lines of code: RuntimeError: no such tree" in (loop.run / "interventions.md").read_text()


# ======================= what the agent left behind =======================

def test_a_story_that_never_finishes_is_capped_recorded_partial_and_its_work_committed_by_the_harness(loop, capsys):
    """The stop rule's cap, through the real loop: the agent keeps saying it is done, with work left uncommitted;
    it gets the stop message once (MAX_NUDGES); its next stop ends the story as an operator's skip would, by the
    harness, with the message already sent as the reason."""
    loop.plan(s1={"leave": "notes.txt", "says": "All tasks are complete."})
    loop.main()
    runs = [r for r in loop.agent_runs() if r["story"] == 1]
    message = drive.stop_message(1, "First", "spec/stories/001-first/tasks.md")
    assert [r["prompt"] for r in runs] == [prompt(1, no_story_so_far())] + [message] * drive.MAX_NUDGES
    assert {(r["resume_from"], r["fork"]) for r in runs[1:]} == {("cov-1", "False")}
    rec, entry = loop.story(1), loop.metrics()["processed"][0]
    reason = drive.STOP_SENT_REASON
    assert (rec["status"], rec["ended_by"]) == (drive.PARTIAL, "operator")
    assert (rec["skip"]["by"], rec["skip"]["reason"], rec["skip"]["story"]) == (drive.STOP_SENT_BY, reason, 1)
    assert (rec["agent"]["nudges"], rec["agent"]["finished"], rec["agent"]["steps"]) == (drive.MAX_NUDGES, False, drive.MAX_NUDGES + 1)
    assert (entry["status"], entry["by"], entry["reason"], entry["verdict"]) == (drive.PARTIAL, drive.STOP_SENT_BY, reason, "red")
    assert rec["end_reason"] == drive.STOP_MESSAGE_EXHAUSTED == "stop-message-exhausted"
    assert rec["agent"]["interventions"] == {"total": 1, "stop_message": 1, "toolcall_text_resumes": 0, "error_resumes": 0}
    # The work is kept: what the agent committed, and what it left, in a harness commit that is the story's commit.
    log = git(loop.ws, "log", "--format=%an %s", rec["commit"]).split("\n")
    assert log[0] == "vidi-agent harness: snapshot after story 1 (uncommitted agent work)"
    assert log[1:drive.MAX_NUDGES + 2] == ["agent story 1: work"] * (drive.MAX_NUDGES + 1)
    assert git(loop.ws, "show", "--name-only", "--format=", rec["commit"]) == "notes.txt"
    assert rec["agent_commits"] == drive.MAX_NUDGES + 1                     # the agent's own; the snapshot is not counted
    assert f"story 1: ended by the operator ({drive.STOP_SENT_BY}) after" in (loop.run / "interventions.md").read_text()
    out = capsys.readouterr().out
    for n in range(1, drive.MAX_NUDGES + 1):
        assert f"    agent stopped before the story was finished — message {n} of {drive.MAX_NUDGES} sent\n" in out   # dbench reads it
    assert f"    the story cap ended story 1 ({drive.STOP_SENT_BY}): {reason}\n" in out
    # And the run goes on: the next story is built on the partial one and finishes.
    second = loop.story(2)
    assert second["status"] == drive.DONE and second["partial_base"] == [1] and second["agent"]["finished"] is True


def test_a_commit_without_the_done_line_gets_the_stop_message_through_the_real_loop(loop):
    """What the old rule accepted as a finished story: the agent committed, and stopped without saying it was done."""
    loop.plan(s1={"first_says": "Task 1 is committed. Now let me look at task 2."})
    loop.main("--only", "1")
    runs = loop.agent_runs()
    assert [r["prompt"] for r in runs] == [prompt(1, no_story_so_far()), drive.stop_message(1, "First", "spec/stories/001-first/tasks.md")]
    rec = loop.story(1)
    assert rec["status"] == drive.DONE and rec["agent"]["nudges"] == 1 and rec["agent"]["finished"] is True
    assert rec["agent_commits"] == 2 and "skip" not in rec
    assert rec["end_reason"] == drive.STOP_MESSAGE_THEN_FINISHED == "stop-message-then-finished"


def test_a_spec_the_agent_edited_is_put_back_and_the_story_says_so(loop):
    """An edit left uncommitted: the tree is not clean, so the story is not finished and ends at its cap."""
    loop.plan(s1={"tamper": "uncommitted"})
    loop.main()
    assert loop.story(1)["spec_tampered"] is True and "spec_tampered" not in loop.story(2)
    assert loop.story(1)["spec_changed_files"] == ["spec/README.md"]
    assert loop.story(1)["status"] == drive.PARTIAL and loop.story(1)["skip"]["by"] == drive.STOP_SENT_BY
    assert (loop.ws / "spec" / "README.md").read_text() == "# covpack\n"
    assert git(loop.ws, "log", "--format=%s", "--", "spec") == "harness: empty repository with spec"


def test_a_spec_change_the_agent_committed_is_put_back_too(loop):
    """`git checkout -- spec` restored the spec from HEAD, the agent's own commit: the change was flagged, never put
    back, and every later story was built on it and flagged for it. It is restored from the harness's first commit."""
    loop.plan(s1={"tamper": "committed"})
    loop.main()
    first = loop.story(1)
    assert first["spec_tampered"] is True and first["spec_changed_files"] == ["spec/README.md"]
    assert (loop.ws / "spec" / "README.md").read_text() == "# covpack\n"
    assert (loop.ws / "spec" / "README.md").stat().st_mode & 0o777 == drive.SPEC_FILE_MODE
    assert "spec_tampered" not in loop.story(2) and "spec_changed_files" not in loop.story(2)
    # The restore is a harness commit, after the agent's two (its work, its change to the spec), which alone are counted.
    assert git(loop.ws, "log", "--format=%s", first["commit"]).split("\n")[:3] == [
        "harness: spec restored after story 1", "spec: suit myself", "story 1: work"]
    assert first["agent_commits"] == 2 and "harness_faults" not in first
    assert git(loop.ws, "status", "--porcelain") == ""
    assert drive.tree_hash(loop.ws / "spec") == drive.tree_hash(loop.pack / "spec")


def test_a_second_change_to_the_spec_in_a_later_story_is_flagged_in_that_story(whole):
    whole.plan(s1={"tamper": "committed"}, s3={"tamper": "committed", "tamper_file": "spec/stories/003-third/tasks.md"})
    whole.main()
    flagged = {sid: whole.story(sid).get("spec_changed_files") for sid in (1, 2, 3)}
    assert flagged == {1: ["spec/README.md"], 2: None, 3: ["spec/stories/003-third/tasks.md"]}
    assert [whole.story(sid).get("spec_tampered") for sid in (1, 2, 3)] == [True, None, True]
    assert drive.tree_hash(whole.ws / "spec") == drive.tree_hash(whole.pack / "spec")


def test_a_file_the_agent_added_to_the_spec_is_named_and_removed(loop):
    loop.plan(s1={"tamper": "committed", "tamper_file": "spec/stories/001-first/my-notes.md"})
    loop.main("--only", "1")
    assert loop.story(1)["spec_changed_files"] == ["spec/stories/001-first/my-notes.md"]
    assert not (loop.ws / "spec" / "stories" / "001-first" / "my-notes.md").exists()
    assert git(loop.ws, "ls-files", "spec/stories/001-first") == "spec/stories/001-first/story.md\nspec/stories/001-first/tasks.md"


def test_a_known_good_run_restores_the_spec_its_base_was_given_not_the_reference_s_first(whole, tmp_path, monkeypatch):
    """A reference built before a spec revision gets this pack's spec in a harness commit (setup_workspace_from):
    that commit, not the repository's first, is what the spec is restored from."""
    ref, _ = reference_run(whole, tmp_path)
    (whole.pack / "spec" / "README.md").write_text("# covpack, revised\n")             # the pack moved on since
    monkeypatch.setattr(drive, "install_base_deps", lambda ws: None)
    whole.plan(s3={"tamper": "committed"})
    whole.main("--from-run", str(ref), "--only", "3")
    m = whole.metrics()
    assert m["known_good"]["spec_updated"] is True
    assert git(whole.ws, "log", "-1", "--format=%s", m["known_good"]["spec_commit"]) == (
        "harness: spec updated to this pack's version (partial rerun's base)")
    assert m["stories"]["3"]["spec_changed_files"] == ["spec/README.md"]
    assert (whole.ws / "spec" / "README.md").read_text() == "# covpack, revised\n"


# ======================= output that is JSON but not an event =======================

def test_agent_output_that_is_json_but_not_an_event_is_skipped_counted_in_the_record_and_said_once(loop, capsys):
    """`42`, `null` or a list on a line of its own crashed the session; now each is skipped and logged, never
    dropped silently: the line stays in the story's log, the record counts them and keeps the first few (cut to
    their limit), and the console says how many, once per story. A story with none records nothing."""
    long_list = json.dumps(["x" * 300])
    loop.plan(s1={"junk": ["42", "null", long_list, "[1, 2]"]})
    loop.main()
    first, second = loop.story(1), loop.story(2)
    assert first["skipped_output"] == {"count": 4, "samples": ["42", "null", long_list[:drive.SKIPPED_OUTPUT_SAMPLE_CHARS]]}
    assert first["status"] == drive.DONE and first["agent"]["steps"] == 1 and "harness_faults" not in first
    assert "skipped_output" not in second and set(second) == RECORD_KEYS
    assert loop.events(1).read_text().splitlines()[1:5] == ["42", "null", long_list, "[1, 2]"]   # as they arrived, whole
    out = capsys.readouterr().out
    assert out.count("[story 1] agent output: 4 lines were JSON but not events; skipped, kept in the log\n") == 1
    assert "[story 2] agent output:" not in out


# ======================= the agent's own account of its tasks: PROGRESS.md =======================

REAL_LAUNCH, REAL_VIEW_ROOT, REAL_TMP_VIEW, REAL_WORLD_FOR = (drive.launch_agent, sandbox.view_root, sandbox.tmp_view,
                                                               sandbox.world_for)


# In the harness's environment, and in no agent's: a key, a variable naming the benchmark, one naming a benchmark's path, and
# what CI itself sets. What a shell or a runtime puts in its own environment when it starts is not the harness's.
CANARY_ENV = {"FAKE_API_KEY": "sk-canary-0123456789abcdef", "BENCH_SOMETHING": "/x/benchmarks/vidi/v2-r3",
              "RUST_TOOLCHAIN_FILE": "tools/dbench/rust-toolchain.toml"}
RUNTIME_ADDED_ENV = {"SHLVL", "_", "LC_CTYPE", "__CF_USER_TEXT_ENCODING"}

# An agent that can only see its own directory: what it does is told by its own output, not by files beside the test.
SANDBOXED_AGENT = textwrap.dedent(r'''
    import json, os, re, subprocess, sys
    from pathlib import Path
    story = re.search(r"story (\d+)", sys.argv[1], re.I).group(1)
    emit = lambda e: print(json.dumps(e), flush=True)
    sh = lambda *cmd: subprocess.run(cmd, check=True, capture_output=True)
    emit({"type": "session", "id": f"sbx-{story}"})
    emit({"type": "seen", "cwd": os.getcwd(), "env": dict(os.environ)})
    progress = Path("PROGRESS.md")
    progress.write_text(progress.read_text().replace("| 1 | Unit tests for the thing | todo |",
                                                     "| 1 | Unit tests for the thing | done |"))
    try:                                                              # what agents did in recorded runs: edit the spec
        target = Path("spec/README.md")
        target.chmod(0o644)
        target.write_text("# rewritten by the agent\n")
        outcome = "written"
    except OSError as e:
        outcome = f"refused: {type(e).__name__}"
    emit({"type": "spec_write", "outcome": outcome})
    Path("src").mkdir(exist_ok=True)
    Path(f"src/story{story}.ts").write_text("// work\n")
    sh("git", "add", "-A", "src", "PROGRESS.md")
    sh("git", "commit", "-qm", f"story {story}: work")
    head = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    emit({"type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                             "content": [{"type": "text", "text": f"STORY {story} DONE {head}"}],
                                             "usage": {"input": 10, "output": 5}}})
''')


@pytest.mark.needs_sandbox
def test_in_the_real_sandbox_an_agent_that_edits_the_spec_is_refused_and_keeps_its_progress_in_its_own_file(
        outside_shared_temp, monkeypatch):
    """The story loop with the agent in the real sandbox (sandbox-exec on macOS, bwrap on Linux): its write to the
    spec is refused, so nothing is flagged or restored, and its PROGRESS.md and its commit go through."""
    loop = Loop(outside_shared_temp, monkeypatch, default_scope="two")
    fake = outside_shared_temp / "fake-agent"
    fake.mkdir()
    (fake / "agent.py").write_text(SANDBOXED_AGENT)
    monkeypatch.setattr(Scripted, "script", fake / "agent.py", raising=False)
    # The real launch and the real view of the run; the fake agent's own directory is the one thing added to its world.
    monkeypatch.setattr(drive, "launch_agent", REAL_LAUNCH)
    monkeypatch.setattr(sandbox, "view_root", REAL_VIEW_ROOT)
    monkeypatch.setattr(sandbox, "tmp_view", REAL_TMP_VIEW)
    monkeypatch.setattr(sandbox, "world_for", lambda *a, **k: dataclasses.replace(
        REAL_WORLD_FOR(*a, **k), extra_read_only=(fake,), host_ports=(), kernel_picked_ports=False))   # the test's model URL names port 9: a port a user cannot bridge
    with_tasks(loop, 1)
    monkeypatch.setenv("SPEC_BENCH_RESULTS_ROOT", str(loop.root / "awesome-local-ai"))       # as dbench sets it
    for name, value in CANARY_ENV.items():
        monkeypatch.setenv(name, value)
    loop.main("--only", "1")
    seen = next(json.loads(l) for l in (loop.run / "stories" / "01" / "agent-events.jsonl").read_text().splitlines()
                if l.startswith("{") and json.loads(l).get("type") == "seen")
    events = (loop.run / "stories" / "01" / "agent-events.jsonl").read_text()
    assert '"outcome": "refused: ' in events, events[-600:]
    # What the agent saw of where it is and of its environment: nothing of the run, nothing of the machine's own.
    if sys.platform == "darwin":
        assert seen["cwd"] == str(loop.ws.resolve()) and seen["cwd"].endswith(f"/work/{drive.work_id('run')}/workspace")
    else:
        assert seen["cwd"] == "/w/workspace"
    env = seen["env"]
    assert env["PWD"] == seen["cwd"] and "SPEC_BENCH_RESULTS_ROOT" not in env
    assert set(env) <= set(sandbox.ENV_ALLOWED) | set(sandbox.ENV_FROM_HARNESS) | set(sandbox.ENV_FROM_SANDBOX) | RUNTIME_ADDED_ENV, \
        sorted(set(env) - set(sandbox.ENV_ALLOWED) - set(sandbox.ENV_FROM_HARNESS) - set(sandbox.ENV_FROM_SANDBOX) - RUNTIME_ADDED_ENV)
    assert not set(CANARY_ENV) & set(env)
    for k, v in env.items():
        for word in ("bench", MODEL, Scripted.name, "covpack", str(loop.run), str(loop.root / "awesome-local-ai")):
            assert word not in v.lower().replace(str(loop.root).lower(), ""), (k, word)
    rec = loop.story(1)
    assert rec["status"] == drive.DONE and "spec_tampered" not in rec and "spec_changed_files" not in rec
    assert rec["tasks_claimed"] == {"file": progress_file.READ, "tasks": {"1": "done", "2": "todo"}}
    assert (loop.ws / "spec" / "README.md").read_text() == "# covpack\n"
    assert git(loop.ws, "log", "--format=%s", "--", "spec") == "harness: empty repository with spec"

TASKS_MD = """# Tasks

| # | Task | Status | Type | Implements |
|---|---|---|---|---|
| 1 | Unit tests for the thing | proposed | test:unit | thing |
| 2 | The thing | proposed | implementation | thing |
"""
STORY_TASKS = [{"n": 1, "title": "Unit tests for the thing"}, {"n": 2, "title": "The thing"}]


def with_tasks(loop: Loop, *sids: int) -> None:
    for sid in sids:
        (loop.pack / "spec" / "stories" / STORY_DIRS[sid] / "tasks.md").write_text(TASKS_MD)


def progress_seen(loop: Loop) -> list[tuple[int, str | None]]:
    """PROGRESS.md as the agent found it, each time it was started."""
    return [(e["story"], e["text"]) for e in map(json.loads, (loop.root / "progress-seen.jsonl").read_text().splitlines())]


def test_each_story_starts_with_its_own_progress_file_every_task_todo_committed_by_the_harness(loop):
    with_tasks(loop, 1)
    loop.plan(s1={"progress": {"| 1 | Unit tests for the thing | todo |": "| 1 | Unit tests for the thing | done |"}})
    loop.main()
    assert progress_seen(loop) == [(1, progress_file.text(1, "First", STORY_TASKS)), (2, progress_file.text(2, "Second", []))]
    # Story 2's file replaced story 1's, which the agent had edited and committed.
    assert (loop.ws / progress_file.FILE).read_text() == progress_file.text(2, "Second", [])
    assert "| 1 | Unit tests for the thing | done |" in git(loop.ws, "show", f"{loop.story(1)['commit']}:PROGRESS.md")
    # The harness's commit comes before the story's starting commit: not the agent's, and not among the story's lines.
    for sid in (1, 2):
        base = (loop.run / "stories" / f"{sid:02d}" / "base-commit").read_text()
        assert git(loop.ws, "log", "-1", "--format=%an|%s", base) == f"vidi-agent|harness: PROGRESS.md for story {sid}"
        assert git(loop.ws, "show", "--name-only", "--format=", base) == "PROGRESS.md"
        assert loop.story(sid)["agent_commits"] == 1
    assert "PROGRESS.md" not in git(loop.ws, "diff", "--name-only", (loop.run / "stories" / "02" / "base-commit").read_text(), "HEAD")


def test_what_the_agent_claimed_for_each_task_is_recorded_beside_the_evidence(loop):
    with_tasks(loop, 1)
    loop.plan(s1={"progress": {"| 1 | Unit tests for the thing | todo |": "| 1 | Unit tests for the thing | **Done** |",
                               "| 2 | The thing | todo |": "| 2 | The thing | nearly there |"}})
    loop.main("--only", "1")
    rec = loop.story(1)
    assert rec["tasks_claimed"] == {"file": progress_file.READ, "tasks": {"1": "done", "2": "nearly there"}}
    # The harness's own table is from evidence, as before: nothing the agent wrote in PROGRESS.md moves it.
    assert [(t["n"], t["status"]) for t in rec["tasks"]] == [(1, "not-started"), (2, "not-started")]
    assert rec["status"] == drive.DONE and "harness_faults" not in rec


def test_a_progress_file_the_agent_deleted_is_recorded_as_missing(loop):
    loop.plan(s1={"progress_gone": True})
    loop.main("--only", "1")
    assert loop.story(1)["tasks_claimed"] == {"file": progress_file.MISSING, "tasks": {}}
    assert loop.story(1)["status"] == drive.DONE


def test_a_fault_reading_the_progress_file_is_a_harness_fault_and_the_story_is_still_recorded(loop, monkeypatch):
    def boom(ws):
        raise ValueError("no such table")
    monkeypatch.setattr(progress_file, "claimed", boom)
    loop.main("--only", "1")
    rec = loop.story(1)
    assert rec["tasks_claimed"] == {"file": progress_file.UNPARSEABLE, "tasks": {}} and rec["status"] == drive.DONE
    assert [f["step"] for f in rec["harness_faults"]] == ["claimed task statuses"]


def test_a_story_continued_after_a_harness_restart_keeps_the_progress_file_as_its_agent_left_it(loop):
    with_tasks(loop, 1)
    edit = {"| 1 | Unit tests for the thing | todo |": "| 1 | Unit tests for the thing | doing |"}
    loop.plan(s1={"progress": edit})
    Sampler.record = {**Sampler.record, "aborted_swap": True}                # the first start is stopped by a guard
    with pytest.raises(SystemExit):
        loop.main("--only", "1")
    Sampler.record = {**Sampler.record, "aborted_swap": False}
    loop.plan()
    loop.main("--only", "1")
    edited = progress_file.text(1, "First", STORY_TASKS).replace(*next(iter(edit.items())))
    assert progress_seen(loop) == [(1, progress_file.text(1, "First", STORY_TASKS)), (1, edited)]
    assert loop.story(1)["tasks_claimed"]["tasks"] == {"1": "doing", "2": "todo"}
    assert git(loop.ws, "log", "--format=%s").count("harness: PROGRESS.md for story 1") == 1


def test_a_story_whose_reply_check_faulted_is_recorded_with_that_as_its_end_reason(loop, monkeypatch):
    def broken(events_path, story_id, ws):
        raise RuntimeError("no such log")
    monkeypatch.setattr(drive, "_stop_check", broken)
    loop.main("--only", "1")
    rec = loop.story(1)
    assert rec["end_reason"] == drive.HARNESS_FAULT == "harness-fault" and rec["status"] == drive.DONE
    assert [f["step"] for f in rec["harness_faults"]] == [drive.REPLY_CHECK_STEP] and rec["agent"]["finished"] is False


def test_an_agent_that_never_reached_the_model_stops_the_run_and_checkpoints_nothing(loop, capsys):
    loop.plan(s1={"silent": True, "exit": 1})
    with pytest.raises(SystemExit) as e:
        loop.main()
    assert str(e.value) == (f"[story 1] agent made no model calls (exit 1); see {loop.events(1)}. Not checkpointed.")
    assert not (loop.run / "metrics.json").exists()
    assert len(loop.agent_runs()) == 1 and (loop.run / "current_story").read_text() == ""
    assert loop.strays == [loop.ws]                                         # swept after the agent; no gate was run


# ======================= the guards and the stops =======================

@pytest.mark.parametrize("guard", ["aborted_swap", "aborted_memory"])
def test_a_story_a_guard_stopped_is_swept_and_ends_the_run_unfit_with_nothing_checkpointed(loop, guard):
    Sampler.record = {**Sampler.record, guard: True, "swap_start_gb": 1.0, "swap_max_gb": 6.0, "free_min_pct": 5.0}
    with pytest.raises(SystemExit) as e:
        loop.main()
    assert e.value.code == machine_fit.EXIT_MACHINE_UNFIT
    assert loop.strays == [loop.ws] and (loop.run / "current_story").read_text() == ""
    assert not (loop.run / "metrics.json").exists() and len(loop.agent_runs()) == 1
    unfit = json.loads((loop.run / machine_fit.UNFIT_FILE).read_text())
    assert unfit["story"] == 1 and unfit["reason"].startswith("memory guard" if guard == "aborted_memory" else "swap guard")


def test_a_machine_that_cannot_run_the_tests_stops_the_run_after_recording_the_story(loop, monkeypatch, capsys):
    fault = f"{gates.MISSING_RESOURCES} the agent's e2e tests have no browser"
    monkeypatch.setattr(gates, "gate", lambda ws, steps: {"steps": {}, "all_green": False, "harness_fault": fault})
    with pytest.raises(SystemExit) as e:
        loop.main()
    assert e.value.code == drive.EXIT_MISSING_RESOURCES
    assert sorted(loop.metrics()["stories"]) == ["1"] and loop.story(1)["gate"]["harness_fault"] == fault
    assert len(loop.agent_runs()) == 1                                      # story 2 was not started
    captured = capsys.readouterr()
    assert "[story 1] DONE gate green=False" in captured.out and captured.err.startswith("MISSING RESOURCES: the agent's e2e tests have no browser.")


# ======================= a story the operator ended =======================

REQUEST = {"story": 1, "reason": "stuck on the build", "by": drive.OPERATOR, "at": 5.0}


def test_a_story_the_operator_ended_while_it_ran_is_partial_with_a_verdict_and_the_run_goes_on(loop, monkeypatch, capsys):
    monkeypatch.setattr(drive, "SkipWatcher", ends_story(1, REQUEST))
    loop.plan(s1={"skip_request": True})                                    # the request file appears while the agent runs
    loop.main()
    rec, entry = loop.story(1), loop.metrics()["processed"][0]
    health = {"verdict": "red", "gate_green": False, "unverified_tasks": [], "unverified_implementation_tasks": [],
              "heldout": None, "heldout_floor": 1.0, "heldout_ok": True}
    assert (rec["status"], rec["ended_by"], rec["skip"], rec["verdict"]) == (drive.PARTIAL, "operator", REQUEST, health)
    assert rec["end_reason"] == drive.OPERATOR_SKIP == "operator-skip"
    assert set(rec) == RECORD_KEYS | {"skip", "verdict"}
    assert {k: entry[k] for k in ("status", "ended_by", "reason", "by", "requested_at", "verdict", "health")} == {
        "status": drive.PARTIAL, "ended_by": "operator", "reason": "stuck on the build", "by": drive.OPERATOR,
        "requested_at": 5.0, "verdict": "red", "health": health}
    assert set(entry) == ENTRY_KEYS | {"reason", "by", "requested_at", "verdict", "health"}
    control = loop.run / drive.CONTROL_DIR
    assert sorted(p.name for p in control.iterdir()) == ["skip-story-1.applied.json"]
    log = (loop.run / "interventions.md").read_text()
    assert (f"story 1: ended by the operator (operator) after {entry['agent_minutes']} agent-min, 1 calls: stuck on the "
            f"build. Recorded PARTIAL. Verdict red: gate red, tasks not verified none (implementation: none), held-out "
            f"None/None (floor 1.0). The run continued with the next story.") in log
    assert "[story 1] PARTIAL verdict red gate green=None accept n/a (no held-out suite) stalled=False\n" in capsys.readouterr().out
    # The next story is built on the partial one: told so, and checked for stubs and held-out changes.
    second = loop.story(2)
    assert second["status"] == drive.DONE and second["partial_base"] == [1]
    assert second["stub_markers"] == [] and second["partial_heldout_changes"] == {"1": {"fixed": [], "regressed": []}}
    assert set(second) == RECORD_KEYS | {"stub_markers", "partial_heldout_changes"}
    assert "Stories already processed in this repository, in order: 1 (partial)." in loop.agent_runs()[1]["prompt"]
    assert loop.metrics()["processed"][1]["partial_base"] == [1]


def test_a_partial_story_whose_held_out_result_is_gone_has_no_changes_to_report(loop, monkeypatch):
    monkeypatch.setattr(drive, "SkipWatcher", ends_story(1, REQUEST))
    real = heldout.read_json
    monkeypatch.setattr(heldout, "read_json", lambda run, rel, *a: None if rel == "stories/01/accept.json" else real(run, rel, *a))
    loop.main()
    assert loop.story(2)["partial_heldout_changes"] == {} and "harness_faults" not in loop.story(2)


def test_a_story_ended_by_the_operator_before_any_model_call_is_still_recorded_partial(loop, monkeypatch):
    monkeypatch.setattr(drive, "SkipWatcher", ends_story(1, REQUEST))
    loop.plan(s1={"silent": True, "exit": 143})
    loop.main("--only", "1")
    rec = loop.story(1)
    assert rec["status"] == drive.PARTIAL and rec["agent"]["steps"] == 0 and rec["agent"]["exit"] == 143


def test_a_request_that_arrives_as_the_agent_finishes_by_itself_is_kept_unapplied(loop, monkeypatch):
    monkeypatch.setattr(drive, "SkipWatcher", never_skips)
    loop.plan(s1={"skip_request": True})
    loop.main("--only", "1")
    rec = loop.story(1)
    assert rec["status"] == drive.DONE and rec["ended_by"] == "agent" and "skip" not in rec
    control = loop.run / drive.CONTROL_DIR
    assert sorted(p.name for p in control.iterdir()) == ["skip-story-1.too-late.json"]
    assert json.loads((control / "skip-story-1.too-late.json").read_text())["reason"] == "too slow"
    assert not (loop.run / "interventions.md").exists()


def stamped(*events: dict) -> str:
    return "".join(json.dumps(e, separators=(",", ":")) + "\n" for e in events)


def earlier_attempt(t: float, session: str, timestamp: bool = False) -> list[dict]:
    """One attempt in a story's log, as run_agent stamps it: a session with one model call, 20 s long."""
    first = {"_rx": t, "type": "session", "id": session, **({"timestamp": int(t * 1000)} if timestamp else {})}
    return [first,
            {"_rx": t + 20, "type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                                              "usage": {"input": 10, "output": OUTPUT_TOKENS}}}]


def test_a_story_skipped_before_the_harness_restarted_is_ended_from_its_log_without_starting_the_agent(loop, capsys):
    loop.events(1).parent.mkdir(parents=True)
    loop.events(1).write_text(stamped(*earlier_attempt(OLD_LOG_T, "s-before", timestamp=True)))
    loop.skip_request(story=1, reason="not worth the wait", by="someone@example.invalid", at=7.0)
    loop.main()
    assert [r["story"] for r in loop.agent_runs()] == [2]                    # story 1's agent was never started
    rec = loop.story(1)
    # No agent was started for this story, so it has no memory snapshot either: one is taken as a story BEGINS, and a
    # story ended from its log never did. Absent, not zero.
    assert set(rec) == (RECORD_KEYS - {"conditions_start", "containment", "memory_start"}) | {"skip", "verdict"}
    assert rec["status"] == drive.PARTIAL and rec["skip"] == {"story": 1, "reason": "not worth the wait", "by": drive.OPERATOR, "at": 7.0}
    agent = rec["agent"]
    assert agent["reconstructed_from_log"] is True and agent["ended_by_operator"] is True and agent["exit"] is None
    assert rec["end_reason"] == drive.OPERATOR_SKIP and agent["interventions"]["total"] == 0
    assert (agent["steps"], agent["sessions"], agent["tokens"]["output"]) == (1, ["s-before"], OUTPUT_TOKENS)
    assert "restarted" not in agent and "first_started" not in rec          # one attempt in the log: nothing to add up
    assert rec["conditions"] == {"samples": 0, "degraded": False, "throttled_share": 0.0, "bad_samples": [],
                                 "aborted_swap": False, "aborted_memory": False}
    assert rec["agent_commits"] == 0 and [m[:2] for m in Sampler.made] == [(loop.ws, BASE_URL_PORT)]      # only story 2 was sampled
    assert Sampler.made[0][2].parent.name == "02"
    assert (loop.run / drive.CONTROL_DIR / "skip-story-1.applied.json").exists()
    assert "[story 1] First — ended by the operator before the agent restarted\n" in capsys.readouterr().out
    assert loop.story(2)["status"] == drive.DONE


def test_a_story_skipped_before_a_restart_counts_the_agent_time_of_each_attempt_in_its_log(loop):
    loop.events(1).parent.mkdir(parents=True)
    loop.events(1).write_text(stamped(*earlier_attempt(OLD_LOG_T, "s-a")))
    attempts.write_restart_mark(loop.events(1), OLD_LOG_T + 5000, 2, {})
    with loop.events(1).open("a") as f:
        f.write(stamped(*earlier_attempt(OLD_LOG_T + 5001, "s-b")))
    loop.skip_request(story=1, reason="not worth the wait")
    loop.main("--only", "1")
    rec = loop.story(1)
    agent = rec["agent"]
    assert agent["restarted"] is True and agent["harness_attempts"] == 2 and rec["first_started"] == OLD_LOG_T
    assert [(a["attempt"], a["source"], a["started"], a["sessions"]) for a in agent["attempts"]] == [
        (1, "log", OLD_LOG_T, ["s-a"]), (2, "log", OLD_LOG_T + 5001, ["s-b"])]
    assert agent["seconds"] == 40.0                                          # the two attempts, not the 5,000 s between them
    assert "harness_faults" not in rec and rec["time_split"]["attempts"] == 2


# ======================= a story continued after a harness restart =======================

def test_a_story_whose_harness_restarted_continues_the_agent_s_session_from_where_the_story_began(loop, capsys):
    Sampler.record = {**Sampler.record, "aborted_swap": True}                # the first start is stopped by a guard
    with pytest.raises(SystemExit):
        loop.main("--only", "1")
    began = (loop.run / "stories" / "01" / "base-commit").read_text()
    assert began == git(loop.ws, "rev-parse", "HEAD~1")                      # the agent had committed before the stop
    Sampler.record = {**Sampler.record, "aborted_swap": False}
    capsys.readouterr()
    loop.main("--only", "1")
    first, second = loop.agent_runs()
    assert (first["resume_from"], first["fork"]) == ("None", "True")
    assert (second["prompt"], second["resume_from"], second["fork"]) == (drive.RESUME_PROMPT, "cov-1", "False")
    rec = loop.story(1)
    assert rec["continued_session"] == "cov-1" and rec["status"] == drive.DONE
    assert (loop.run / "stories" / "01" / "base-commit").read_text() == began       # still where the story began
    assert rec["agent_commits"] == 1                                         # this attempt's; the story's evidence has both
    agent = rec["agent"]
    assert agent["restarted"] is True and agent["harness_attempts"] == 2 and agent["steps"] == 2
    assert [a["source"] for a in agent["attempts"]] == ["log", "harness"] and rec["first_started"] < rec["started"]
    kinds = [json.loads(l).get("type") for l in loop.events(1).read_text().splitlines()]
    assert kinds.count("session") == 2 and kinds.count(attempts.RESTART_MARK) == 1   # the log was kept and marked
    assert "[story 1] continuing the agent's own session cov-1 after a harness restart\n" in capsys.readouterr().out


def test_a_restarted_story_with_no_record_of_where_it_began_begins_at_the_workspace_s_head(loop):
    Sampler.record = {**Sampler.record, "aborted_swap": True}
    with pytest.raises(SystemExit):
        loop.main("--only", "1")
    (loop.run / "stories" / "01" / "base-commit").unlink()
    Sampler.record = {**Sampler.record, "aborted_swap": False}
    loop.main("--only", "1")
    assert (loop.run / "stories" / "01" / "base-commit").read_text() == git(loop.ws, "rev-parse", "HEAD~1")


# ======================= a partial rerun =======================

def reference_run(loop: Loop, root: Path, ran: tuple[int, ...] = (1, 2, 3)) -> tuple[Path, dict]:
    """A finished run of the same pack: its bundle (one commit per story it ran) and its metrics."""
    ws, run = root / "ref-ws", root / "ref-run"
    ws.mkdir()
    subprocess.run(["cp", "-R", str(loop.pack / "spec"), str(ws / "spec")], check=True)
    git(ws, "init", "-q", "-b", "main")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "harness: empty repository with spec")
    stories = {}
    for sid in ran:
        (ws / f"ref{sid}.ts").write_text(f"reference story {sid}\n")
        git(ws, "add", "-A")
        git(ws, "commit", "-qm", f"story {sid}")
        stories[str(sid)] = {"title": TITLES[sid], "commit": git(ws, "rev-parse", "HEAD"), "finished": 1.0}
    run.mkdir()
    git(ws, "bundle", "create", str(run / "workspace.bundle"), "--all")
    (run / "metrics.json").write_text(json.dumps({"stories": stories}))
    return run, stories


def known_good_processed() -> list[dict]:
    return [{"id": n, "title": TITLES[n], "status": drive.DONE, "ended_by": drive.KNOWN_GOOD_BY} for n in (1, 2)]


def test_a_known_good_run_builds_one_story_on_another_run_s_code_and_scores_the_base_first(whole, tmp_path, monkeypatch, capsys):
    ref, stories = reference_run(whole, tmp_path)
    installed = []
    monkeypatch.setattr(drive, "install_base_deps", installed.append)
    whole.main("--from-run", str(ref), "--only", "3")
    m = whole.metrics()
    assert m["known_good"] == {"from_run": str(ref.resolve()), "commit": stories["2"]["commit"], "story": 3,
                               "spec_updated": False, "spec_commit": stories["2"]["commit"], "continues": False}
    assert m["processed"][:2] == known_good_processed() and [p["id"] for p in m["processed"]] == [1, 2, 3]
    assert sorted(m["stories"]) == ["3"] and m["stories"]["3"]["status"] == drive.DONE and m["scope"] == "all"
    assert installed == [whole.ws]
    assert git(whole.ws, "log", "--format=%s").split("\n") == [
        "story 3: work", "harness: PROGRESS.md for story 3", "story 2", "story 1", "harness: empty repository with spec"]
    assert not (whole.ws / "ref3.ts").exists()                               # how the reference did story 3 is not there
    base = json.loads((whole.run / drive.history.BASE_DIR / "accept.json").read_text())
    assert base["skipped"] is True and (whole.run / drive.history.BASE_DIR / "accept-summary.json").exists()
    assert whole.strays == [whole.ws] * 3                                    # after the base's scoring, the agent, the gate
    out = capsys.readouterr().out
    assert "[partial rerun] scoring the base (stories [1, 2])\n" in out
    assert whole.agent_runs()[0]["prompt"].splitlines()[:2] == [
        "STORY 3: Third", "Stories already implemented in this repository, in order: 1, 2."]
    # Started again: the base is not scored twice, its record is kept, and the story is not run again.
    whole.main("--from-run", str(ref), "--only", "3")
    assert "[partial rerun]" not in capsys.readouterr().out and len(whole.agent_runs()) == 1
    assert whole.metrics()["known_good"] == m["known_good"] and len(whole.strays) == 3


def test_a_known_good_run_names_a_reference_inside_the_results_by_its_path_there(whole, tmp_path, monkeypatch):
    ref, _ = reference_run(whole, tmp_path)
    monkeypatch.setattr(drive, "REPO_ROOT", tmp_path.resolve())
    monkeypatch.setattr(drive, "install_base_deps", lambda ws: None)
    whole.main("--from-run", str(ref), "--only", "3")
    assert heldout.load_metrics(whole.run)["known_good"]["from_run"] == "ref-run"


def test_a_dry_run_in_known_good_mode_names_the_base_and_prompts_with_its_stories(whole, tmp_path, capsys):
    ref, stories = reference_run(whole, tmp_path)
    whole.bare("--dry-run", "--from-run", str(ref), "--only", "3")
    out = capsys.readouterr().out
    assert f"partial rerun's base: {ref.resolve()} at {stories['2']['commit'][:12]}, processed [1, 2]\n" in out
    assert out.endswith(prompt(3, "Stories already implemented in this repository, in order: 1, 2.", note="") + "\n")
    assert not whole.run.exists()


def base_entry(sid: int) -> dict:
    return {"id": sid, "title": TITLES[sid], "status": drive.DONE, "ended_by": drive.KNOWN_GOOD_BY}


def test_a_known_good_continuation_runs_the_story_and_every_later_one_each_built_on_the_one_before(whole, tmp_path, monkeypatch, capsys):
    ref, stories = reference_run(whole, tmp_path)
    monkeypatch.setattr(drive, "install_base_deps", lambda ws: None)
    whole.main("--from-run", str(ref), "--from-story", "2")
    m = whole.metrics()
    assert m["known_good"] == {"from_run": str(ref.resolve()), "commit": stories["1"]["commit"], "story": 2,
                               "spec_updated": False, "spec_commit": stories["1"]["commit"], "continues": True}
    assert m["processed"][0] == base_entry(1) and [p["id"] for p in m["processed"]] == [1, 2, 3]
    assert [(p["status"], p["ended_by"]) for p in m["processed"][1:]] == [(drive.DONE, "agent")] * 2
    assert sorted(m["stories"]) == ["2", "3"]
    assert git(whole.ws, "log", "--format=%s").split("\n") == [
        "story 3: work", "harness: PROGRESS.md for story 3", "story 2: work", "harness: PROGRESS.md for story 2",
        "story 1", "harness: empty repository with spec"]
    assert not (whole.ws / "ref2.ts").exists() and not (whole.ws / "ref3.ts").exists()   # none of the reference's later work
    assert m["stories"]["3"]["commit"] == git(whole.ws, "rev-parse", "HEAD")
    assert m["stories"]["2"]["commit"] == git(whole.ws, "rev-parse", "HEAD~2")           # story 3 was built on this run's story 2
    runs = whole.agent_runs()
    assert [r["story"] for r in runs] == [2, 3]
    assert runs[0]["prompt"] == prompt(2, "Stories already implemented in this repository, in order: 1.", note="")
    assert runs[1]["prompt"] == prompt(3, "Stories already implemented in this repository, in order: 1, 2.", note="")
    out = capsys.readouterr().out
    assert out.count("[partial rerun] scoring the base (stories [1])\n") == 1               # the base is scored once
    doc = json.loads((whole.run / "progress.json").read_text())
    assert [(s["id"], s["status"]) for s in doc["stories"]] == [(2, drive.DONE), (3, drive.DONE)]   # the stories it ran


def test_a_known_good_continuation_survives_a_harness_restart_between_its_stories(whole, tmp_path, monkeypatch, capsys):
    ref, stories = reference_run(whole, tmp_path)
    monkeypatch.setattr(drive, "install_base_deps", lambda ws: None)
    args = ("--from-run", str(ref), "--from-story", "2")
    whole.plan(s3={"silent": True, "exit": 1})                               # the harness stops at story 3
    with pytest.raises(SystemExit):
        whole.main(*args)
    first = whole.metrics()
    assert sorted(first["stories"]) == ["2"] and [p["id"] for p in first["processed"]] == [1, 2]
    capsys.readouterr()
    whole.plan()
    whole.main(*args)                                                        # started again, as run.sh does
    m = whole.metrics()
    assert m["known_good"] == first["known_good"] and m["known_good"]["continues"] is True
    assert m["stories"]["2"] == first["stories"]["2"]                        # story 2 was not run again
    assert [p["id"] for p in m["processed"]] == [1, 2, 3] and m["processed"][0] == base_entry(1)
    assert [r["story"] for r in whole.agent_runs()] == [2, 3, 3]             # 3: the start that failed, then the one that ran
    assert "[partial rerun]" not in capsys.readouterr().out                     # the base was not scored again
    # Story 3 began twice and has one PROGRESS.md commit: the second start found the file as the first wrote it.
    assert git(whole.ws, "log", "--format=%s").split("\n")[:4] == [
        "story 3: work", "harness: PROGRESS.md for story 3", "story 2: work", "harness: PROGRESS.md for story 2"]


def test_a_reference_run_that_stopped_before_the_end_of_the_scope_still_supplies_the_base(whole, tmp_path, monkeypatch):
    ref, stories = reference_run(whole, tmp_path, ran=(1, 2))                # it never ran story 3
    monkeypatch.setattr(drive, "install_base_deps", lambda ws: None)
    whole.main("--from-run", str(ref), "--from-story", "2")
    m = whole.metrics()
    assert [p["id"] for p in m["processed"]] == [1, 2, 3] and m["known_good"]["commit"] == stories["1"]["commit"]
    assert m["stories"]["3"]["status"] == drive.DONE


def test_a_continuation_from_the_scope_s_last_story_runs_that_story(whole, tmp_path, monkeypatch):
    ref, stories = reference_run(whole, tmp_path)
    monkeypatch.setattr(drive, "install_base_deps", lambda ws: None)
    whole.main("--from-run", str(ref), "--from-story", "3")
    m = whole.metrics()
    assert sorted(m["stories"]) == ["3"] and m["known_good"]["continues"] is True and m["known_good"]["story"] == 3


def test_a_dry_run_of_a_known_good_continuation_names_the_base_and_the_stories_it_would_run(whole, tmp_path, capsys):
    ref, stories = reference_run(whole, tmp_path)
    whole.bare("--dry-run", "--from-run", str(ref), "--from-story", "2")
    out = capsys.readouterr().out
    assert "scope all: stories [2, 3]\n" in out
    assert f"partial rerun's base: {ref.resolve()} at {stories['1']['commit'][:12]}, processed [1]\n" in out
    assert out.endswith(prompt(2, "Stories already implemented in this repository, in order: 1.", note="") + "\n")
    assert not whole.run.exists()


NOT_INSTALLED = "cov-no-such-install"     # run.sh stops at "not installed" once its arguments are accepted
RUN_SH_REFUSAL = "--from-run needs --only N (that one story) or --from-story N (story N and every later story of the scope)"


def run_sh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(drive.HARNESS / "run.sh"), NOT_INSTALLED, *args], capture_output=True, text=True)


def test_run_sh_passes_the_story_to_continue_from_to_the_harness():
    sh = (drive.HARNESS / "run.sh").read_text()
    assert '--from-story) FROM_STORY="$2"; shift 2 ;;' in sh
    assert '${FROM_STORY:+--from-story "$FROM_STORY"}' in sh


@pytest.mark.parametrize("args, accepted", [
    ((), False), (("--only", "2,3"), False), (("--from-story", "two"), False),
    (("--only", "2"), True), (("--from-story", "2"), True),
])
def test_run_sh_refuses_known_good_mode_without_one_story_or_a_story_to_continue_from(tmp_path, args, accepted):
    r = run_sh("--from-run", str(tmp_path), *args)
    if accepted:
        assert r.returncode == 1 and f"{NOT_INSTALLED} is not installed" in r.stderr and RUN_SH_REFUSAL not in r.stderr
    else:
        assert r.returncode == 2 and r.stderr.strip() == RUN_SH_REFUSAL


def test_run_sh_s_help_describes_both_forms_of_known_good_mode():
    out = subprocess.run(["bash", str(drive.HARNESS / "run.sh"), "--help"], capture_output=True, text=True).stdout
    assert "[--from-run DIR (--only N | --from-story N)]" in out
    assert out.rstrip().endswith("runs story N and every later story of the scope, each built on the one before in this run.")


# ======================= --record =======================

def test_each_story_is_recorded_with_its_summary_and_compacted_log(loop, monkeypatch, capsys):
    monkeypatch.setattr(drive, "SkipWatcher", ends_story(2, {**REQUEST, "story": 2}))
    loop.main("--record")
    label = drive.combination_label(loop.run)
    assert loop.recorded == [(drive.REPO_ROOT, loop.run.resolve(), f"{PACK} {label} run: story 1 done"),
                             (drive.REPO_ROOT, loop.run.resolve(), f"{PACK} {label} run: story 2 partial (ended by operator)")]
    for sid in (1, 2):
        assert loop.story(sid)["record"] == loop.record_result and "harness_faults" not in loop.story(sid)
        assert (loop.run / "stories" / f"{sid:02d}" / "agent-events.compact.jsonl.gz").exists()
    assert (loop.run / "summary.md").exists()
    out = capsys.readouterr().out
    assert "[story 1] recorded: commit abc1234 pushed=True\n" in out


def test_a_recording_run_with_no_sandbox_is_refused_before_anything_starts(loop, monkeypatch):
    """SPEC_BENCH_SANDBOX=permissive runs the agent with nothing around it, for the harness's own tests: it must not be
    able to produce a record (run.sh refuses it too, earlier)."""
    monkeypatch.setenv(sandbox.MODE_ENV, sandbox.PERMISSIVE)
    with pytest.raises(SystemExit) as e:
        loop.main("--record")
    assert "cannot record a benchmark" in str(e.value) and "permissive" in str(e.value)
    assert not loop.run.exists() and loop.agent_runs() == []
    loop.main("--only", "1")                                          # without --record it runs, unsandboxed
    assert loop.story(1)["status"] == drive.DONE


def test_a_record_that_was_not_pushed_says_so_with_its_error(loop, capsys):
    loop.record_result = {"committed": True, "pushed": False, "unpushed": True, "error": "remote: " + "e" * 300}
    loop.main("--record", "--only", "1")
    assert loop.story(1)["record"] == loop.record_result
    assert ("[story 1] recorded: commit - pushed=False  NOT PUSHED, kept locally; the next story retries  remote: "
            + "e" * 192 + "\n") in capsys.readouterr().out


def test_a_record_that_fails_outright_leaves_the_story_saved_with_the_fault(loop, monkeypatch):
    def broken(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(drive, "record_story", broken)
    loop.main("--record", "--only", "1")
    rec = loop.story(1)
    assert rec["record"] == {"committed": False, "pushed": False, "error": "recording failed: see harness_faults"}
    assert [f["step"] for f in rec["harness_faults"]] == ["record"] and rec["status"] == drive.DONE


# ======================= run as a script =======================

def test_drive_py_run_as_a_script_runs_main(loop, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["drive.py", "--pack", PACK, "--dry-run", "--only", "2"])
    runpy.run_path(str(drive.HARNESS / "drive.py"), run_name="__main__")
    assert "scope two: stories [2]\n" in capsys.readouterr().out
