"""drive.py's helpers, pinned branch by branch before the story loop is rebuilt (CLAUDE.md, "Refactor DELETE FIRST").

Each test says what a helper returns, writes or calls for one kind of input: shell calls, the sandbox profile, log
compaction and publishing, the workspace and the known-good base, event-log readers, server statistics, the
machine's conditions (both platforms, whichever one the tests run on), the fault-isolating wrapper, and the time
split over a story's attempts. Nothing here starts an agent, reads the machine's power or memory, or touches a
repository outside tmp_path: commands the helpers would run are faked where the answer depends on the machine.
"""
from __future__ import annotations

import gzip
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

import accounting
import attempts
import drive
import hostenv
from clients import PiClient

G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
NOMINAL = {"ac": True, "low_power": False, "thermal": "nominal"}
ON_BATTERY = {"ac": False, "low_power": False, "thermal": "nominal"}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*G, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def done(stdout: str = "", returncode: int = 0, stderr: str = "") -> SimpleNamespace:
    """What a faked subprocess.run returns."""
    return SimpleNamespace(stdout=stdout, returncode=returncode, stderr=stderr)


def fake_run(monkeypatch, answer) -> list[tuple[list[str], dict]]:
    """subprocess.run replaced by answer(cmd, **kwargs); returns the list the calls are recorded in."""
    calls: list[tuple[list[str], dict]] = []

    def run(cmd, **kwargs):
        calls.append((list(cmd), kwargs))
        return answer(cmd, **kwargs)
    monkeypatch.setattr(drive.subprocess, "run", run)
    return calls


def never(*a, **k):
    raise AssertionError("must not be called")


@pytest.fixture(autouse=True)
def clean_story_state():
    """The module's per-story state, as a fresh process has it, before and after every test."""
    def reset():
        drive.STORY_FAULTS.clear()
        drive.STORY_SKIP.clear()
        drive.RUN_ABORT.clear()
    reset()
    yield
    reset()


def lines(*events) -> str:
    return "".join((e if isinstance(e, str) else json.dumps(e)) + "\n" for e in events)


# ---------- sh, tree_hash ----------

def test_sh_returns_stdout_and_passes_extra_environment(tmp_path):
    out = drive.sh([sys.executable, "-c", "import os; print(os.environ['COV_EXTRA'], os.getcwd())"], tmp_path,
                   {"COV_EXTRA": "given"})
    assert out.split() == ["given", str(tmp_path.resolve())]


def test_sh_raises_with_the_command_and_its_stderr_when_it_fails(tmp_path):
    cmd = [sys.executable, "-c", "import sys; sys.stderr.write('went wrong'); sys.exit(3)"]
    with pytest.raises(RuntimeError) as e:
        drive.sh(cmd, tmp_path)
    assert str(e.value) == f"{' '.join(cmd)} failed: went wrong"


def test_sh_unchecked_returns_the_failed_command_s_stdout(tmp_path):
    cmd = [sys.executable, "-c", "import sys; print('partial'); sys.exit(3)"]
    assert drive.sh(cmd, tmp_path, check=False) == "partial\n"


def test_tree_hash_covers_names_and_contents_of_files_only(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    for root in (a, b):
        (root / "sub").mkdir(parents=True)
        (root / "sub" / "f.md").write_text("same")
    (b / "empty-dir").mkdir()                       # a directory alone changes nothing
    assert drive.tree_hash(a) == drive.tree_hash(b)
    (b / "sub" / "f.md").write_text("other")
    assert drive.tree_hash(a) != drive.tree_hash(b)
    (b / "sub" / "f.md").write_text("same")
    (b / "sub" / "f.md").rename(b / "sub" / "g.md")
    assert drive.tree_hash(a) != drive.tree_hash(b)


# ---------- the sandbox profile ----------

def test_no_user_temp_dir_is_looked_up_off_macos(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    calls = fake_run(monkeypatch, never)
    assert drive.user_temp_dir.__wrapped__() is None and calls == []


@pytest.mark.parametrize("answer, expected", [
    (done("/var/folders/zz/abc/T/\n"), Path("/var/folders/zz/abc/T").resolve()),
    (done("/var/folders/zz/abc/T/\n", returncode=1), None),      # getconf failed
    (done("\n"), None),                                           # it answered nothing
])
def test_macos_user_temp_dir_is_what_getconf_says_or_none(monkeypatch, answer, expected):
    monkeypatch.setattr(drive, "IS_MAC", True)
    calls = fake_run(monkeypatch, lambda cmd, **k: answer)
    assert drive.user_temp_dir.__wrapped__() == expected
    assert [c for c, _ in calls] == [["getconf", "DARWIN_USER_TEMP_DIR"]]


def test_macos_profile_without_a_user_temp_dir_reopens_only_tools_that_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", True)
    monkeypatch.setattr(drive, "user_temp_dir", lambda: None)
    tools, absent = tmp_path / "tools", tmp_path / "absent-tools"
    tools.mkdir()
    monkeypatch.setattr(drive, "SANDBOX_REOPEN_RO", [tools, absent])
    own = tmp_path / "run"
    cmd = drive.sandboxed(["true", "x"], own_dir=own)
    assert cmd[:2] == ["sandbox-exec", "-p"] and cmd[3:] == ["true", "x"]
    profile = cmd[2]
    assert (own / drive.AGENT_TMP).is_dir()                      # made for the agent, with its parents
    assert "regex" not in profile                                # no user temp dir: none of its rules
    assert f"(allow file-read* (subpath {drive._sb_quote(tools)}))" in profile
    assert str(absent) not in profile
    # stat, and only stat, on every ancestor of the run's own dir and of the re-opened tools.
    metadata = profile[profile.index("(allow file-read-metadata "):profile.index("(allow file-read* (subpath")]
    for d in (own, tools):
        for ancestor in d.resolve().parents:
            assert f"(literal {drive._sb_quote(ancestor)})" in metadata
    # Last, so they win (SBPL applies the last rule that matches): the run's own dir re-opened, and in it the
    # workspace's spec closed to writing again.
    assert profile.endswith(f"(allow file-read* file-write* (subpath {drive._sb_quote(own)}))"
                            f"(deny file-write* (subpath {drive._sb_quote(own / 'workspace' / 'spec')}))")
    assert (drive.WORKSPACE_DIR, drive.SPEC_DIR) == ("workspace", "spec")


def test_the_linux_sandbox_masks_what_is_denied_and_binds_the_run_s_temp_dir_over_the_shared_ones(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    denied, tools = tmp_path / "denied", tmp_path / "tools"
    denied.mkdir()
    tools.mkdir()
    monkeypatch.setattr(drive, "SANDBOX_DENY", [denied])
    monkeypatch.setattr(drive, "SANDBOX_REOPEN_RO", [tools])
    monkeypatch.setattr(drive, "WORK_ROOT", tmp_path / "work")
    own = tmp_path / "work" / "run"
    spec = own / "workspace" / "spec"
    spec.mkdir(parents=True)
    cmd = drive.sandboxed(["true", "x"], own_dir=own)
    own_s, tmp_s, spec_s = str(own.resolve()), str((own / drive.AGENT_TMP).resolve()), str(spec.resolve())
    assert (own / drive.AGENT_TMP).is_dir()
    assert cmd[0] == "bwrap" and cmd[-3:] == ["--", "true", "x"]
    # In order (bwrap mounts in order, a later mount over an earlier one): the masks, the tools re-opened read-only,
    # the run's temp dir over each shared one, the run's own dir, and over it the workspace's spec, read-only.
    tail = ["--ro-bind", str(tools.resolve()), str(tools.resolve()),
            *(a for p in drive.SHARED_TMP for a in ("--bind", tmp_s, str(p))), "--bind", own_s, own_s,
            "--ro-bind", spec_s, spec_s, "--", "true", "x"]
    assert cmd[-len(tail):] == tail
    masks = cmd[:-len(tail)]
    for hidden in (denied, tmp_path / "work"):
        assert masks[masks.index(str(hidden.resolve())) - 1] == "--tmpfs"


def test_the_linux_sandbox_of_a_run_without_a_spec_binds_none(tmp_path, monkeypatch):
    """bwrap can't bind a source that isn't there (the preflight's probe has a workspace and no spec)."""
    monkeypatch.setattr(drive, "IS_MAC", False)
    monkeypatch.setattr(drive, "SANDBOX_DENY", [])
    monkeypatch.setattr(drive, "SANDBOX_REOPEN_RO", [])
    monkeypatch.setattr(drive, "WORK_ROOT", tmp_path / "work")
    own = tmp_path / "work" / "run"
    cmd = drive.sandboxed(["true"], own_dir=own)
    assert cmd[-5:] == ["--bind", str(own.resolve()), str(own.resolve()), "--", "true"] and "--ro-bind" not in cmd


def test_a_path_is_quoted_for_the_sandbox_profile_with_its_quotes_and_backslashes_escaped(tmp_path):
    odd = tmp_path / 'a"b\\c'
    assert drive._sb_quote(odd) == '"' + str(tmp_path.resolve()) + '/a\\"b\\\\c"'


# ---------- the conversation log: compaction, the cut past its cap, publishing ----------

def test_truncate_cuts_long_strings_wherever_they_are_and_says_by_how_much():
    limit = 5
    got = drive._truncate({"keep": "12345", "cut": "1234567", "list": ["abcdefgh", 7, None, {"deep": "x" * 6}],
                           "n": 1.5, "flag": True}, limit)
    assert got == {"keep": "12345", "cut": "12345…[truncated 2 chars]",
                   "list": ["abcde…[truncated 3 chars]", 7, None, {"deep": "xxxxx…[truncated 1 chars]"}],
                   "n": 1.5, "flag": True}
    assert drive._truncate("x" * (drive.EVENT_STRING_MAX + 1)) == "x" * drive.EVENT_STRING_MAX + "…[truncated 1 chars]"


def test_redact_replaces_the_home_directory_with_a_tilde():
    assert drive._redact(f"at {Path.home()}/work and {Path.home()}") == "at ~/work and ~"


def compacted(tmp_path: Path, *events) -> list[dict]:
    raw = tmp_path / "agent-events.jsonl"
    raw.write_text(lines(*events))
    out = drive.compact_events(raw)
    assert out == tmp_path / "agent-events.compact.jsonl.gz"
    with gzip.open(out, "rt") as f:
        return [json.loads(l) for l in f]


def test_compaction_drops_a_stream_delta_whose_type_is_not_at_the_start_of_its_line(tmp_path):
    late = {"padding": "p" * (drive.DELTA_PREFIX + 1), "type": "message_update"}
    late_tool = {"padding": "p" * (drive.DELTA_PREFIX + 1), "type": "tool_execution_update"}
    kept = compacted(tmp_path, {"type": "session", "id": "s"}, late, late_tool, {"type": "agent_end"})
    assert [e["type"] for e in kept] == ["session", "agent_end"]


def test_compaction_keeps_the_first_chunk_of_an_assistant_message_only(tmp_path):
    late = {"padding": "p" * (drive.DELTA_PREFIX + 1), "type": "message_update", "n": 1}
    kept = compacted(
        tmp_path,
        {"type": "message_start", "message": {"role": "user"}},
        {"type": "message_update", "n": 0},                                   # a user message has no first chunk
        {"type": "message_start", "message": {"role": "assistant"}},
        {"type": "tool_execution_update", "n": 0},                            # not the first chunk's type
        late,                                                                 # the first chunk, type late in its line
        {"type": "message_update", "n": 2},
        {"type": "message_start", "message": "not a model message"},
        {"type": "message_update", "n": 3},
        {"type": "message_start", "message": {"role": "assistant"}},
        {"type": "message_update", "n": 4},                                   # the first chunk, type at the start
        {"type": "message_update", "n": 5},
        [1, 2],                                                               # JSON, but not an event
        '{"type": "message_end", "cut off',
    )
    assert [(e["type"], e.get("n")) for e in kept] == [
        ("message_start", None), ("message_start", None), ("message_update", 1), ("message_start", None),
        ("message_start", None), ("message_update", 4)]


def gz_events(f: Path) -> list[dict]:
    with gzip.open(f, "rt") as src:
        return [json.loads(l) for l in src if l.strip()]


CUT_MARGIN_BYTES = 200      # more than a gzip header's file name and the mark's digits; far less than one step's cut


def test_a_log_over_its_cap_is_cut_one_step_at_a_time_until_it_fits(tmp_path, monkeypatch):
    f = tmp_path / "agent-events.compact.jsonl.gz"
    import random
    rng = random.Random(7)
    noise = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(4000))   # doesn't compress
    with gzip.open(f, "wt") as dst:
        dst.write(lines({"type": "message_end", "text": noise}, {"type": "agent_end"}))
    sizes = {}
    for limit in drive.EVENT_STRING_STEPS:
        with gzip.open(tmp_path / "probe.gz", "wt") as dst:
            dst.write(lines({"type": drive.LOG_CUT_MARK, "limit_bytes": 0, "string_max": limit},
                            drive._truncate({"type": "message_end", "text": noise}, limit), {"type": "agent_end"}))
        sizes[limit] = (tmp_path / "probe.gz").stat().st_size
    (tmp_path / "probe.gz").unlink()
    second = drive.EVENT_STRING_STEPS[1]
    cap = sizes[second] + CUT_MARGIN_BYTES                  # the first step is still too big, the second fits
    assert sizes[drive.EVENT_STRING_STEPS[0]] > cap
    monkeypatch.setattr(drive, "EVENT_LOG_MAX_BYTES", cap)
    drive._cut_to_fit(f)
    events = gz_events(f)
    assert events[0] == {"type": drive.LOG_CUT_MARK, "limit_bytes": cap, "string_max": second}
    assert events[1]["text"] == noise[:second] + f"…[truncated {len(noise) - second} chars]"
    assert events[2] == {"type": "agent_end"} and len(events) == 3
    assert f.stat().st_size <= cap


def test_a_log_that_no_cut_can_fit_is_left_at_the_shortest_cut_with_one_mark(tmp_path, monkeypatch):
    f = tmp_path / "agent-events.compact.jsonl.gz"
    with gzip.open(f, "wt") as dst:
        dst.write(lines({"type": "message_end", "text": "y" * 300}, {"type": "agent_end"}) + "\n")
    monkeypatch.setattr(drive, "EVENT_LOG_MAX_BYTES", 1)     # nothing fits in a byte
    drive._cut_to_fit(f)
    drive._cut_to_fit(f)                                     # cut again: the earlier mark is replaced, not kept
    shortest = drive.EVENT_STRING_STEPS[-1]
    events = gz_events(f)
    assert events[0] == {"type": drive.LOG_CUT_MARK, "limit_bytes": 1, "string_max": shortest}
    assert [e["type"] for e in events] == [drive.LOG_CUT_MARK, "message_end", "agent_end"]
    assert events[1]["text"].startswith("y" * shortest + "…[truncated ")


def test_cutting_redacts_home_paths_it_rewrites(tmp_path, monkeypatch):
    f = tmp_path / "agent-events.compact.jsonl.gz"
    with gzip.open(f, "wt") as dst:
        dst.write(lines({"type": "tool", "path": f"{Path.home()}/work"}))
    monkeypatch.setattr(drive, "EVENT_LOG_MAX_BYTES", 10 ** 9)
    drive._cut_to_fit(f)
    assert gz_events(f)[1] == {"type": "tool", "path": "~/work"}


def test_publishing_redacts_text_files_and_leaves_everything_else_as_it_is(tmp_path):
    run = tmp_path / "run"
    home = str(Path.home())
    files = {
        "notes.md": f"built in {home}/work",
        "metrics.json": json.dumps({"dir": f"{home}/x"}),
        "clean.txt": "nothing personal",
        "work_dir.txt": f"{home}/bench/work",                         # machine-local, git-ignored: real paths stay
        "progress.json": json.dumps({"ws": f"{home}/ws"}),
        "current_story": f"{home}",
        "image.png": f"{home} in a file that isn't text",
        "node_modules/pkg/readme.md": f"{home}/pkg",
        ".git/config.txt": f"{home}/repo",
        "stories/01/agent-events.jsonl": f'{{"cwd": "{home}"}}\n',     # the git-ignored raw log: kept, and redacted too
    }
    for rel, text in files.items():
        (run / rel).parent.mkdir(parents=True, exist_ok=True)
        (run / rel).write_text(text)
    undecodable = b"\xff\xfe " + home.encode() + b" not utf-8"
    (run / "broken.log").write_bytes(undecodable)
    assert drive.make_publishable(run) == []
    assert (run / "notes.md").read_text() == "built in ~/work"
    assert json.loads((run / "metrics.json").read_text()) == {"dir": "~/x"}
    assert (run / "clean.txt").read_text() == "nothing personal"
    assert (run / "stories" / "01" / "agent-events.jsonl").read_text() == '{"cwd": "~"}\n'     # "everywhere": not compacted, still redacted
    for rel in ("work_dir.txt", "progress.json", "current_story", "image.png", "node_modules/pkg/readme.md",
                ".git/config.txt"):
        assert (run / rel).read_text() == files[rel], rel
    assert (run / "broken.log").read_bytes() == undecodable            # can't be read as text: not rewritten


def test_publishing_compacts_a_raw_log_outside_stories_and_cuts_a_compact_log_over_its_cap(tmp_path, monkeypatch):
    run = tmp_path / "run"
    (run / "judge").mkdir(parents=True)
    (run / "stories" / "01").mkdir(parents=True)
    (run / "judge" / "agent-events.jsonl").write_text(lines({"type": "session", "id": "j"}))
    (run / "stories" / "01" / "agent-events.jsonl").write_text(lines({"type": "session", "id": "s"}))
    big = run / "stories" / "01" / "agent-events.compact.jsonl.gz"
    with gzip.open(big, "wt") as dst:
        dst.write(lines({"type": "message_end", "text": "z" * 5000}))
    whole = big.read_bytes()
    drive.make_publishable(run)
    assert not (run / "judge" / "agent-events.jsonl").exists()
    assert gz_events(run / "judge" / "agent-events.compact.jsonl.gz") == [{"type": "session", "id": "j"}]
    assert (run / "stories" / "01" / "agent-events.jsonl").exists()
    assert big.read_bytes() == whole                                   # within its cap: byte for byte as it was
    monkeypatch.setattr(drive, "EVENT_LOG_MAX_BYTES", 60)
    drive.make_publishable(run)
    assert gz_events(big)[0]["type"] == drive.LOG_CUT_MARK


def test_publishing_names_the_files_still_over_their_limit_but_never_the_ignored_raw_log(tmp_path, monkeypatch):
    run = tmp_path / "run"
    (run / "stories" / "01").mkdir(parents=True)
    (run / "node_modules").mkdir()
    for rel in ("big.md", "small.md", "stories/01/agent-events.jsonl", "node_modules/big.md"):
        (run / rel).write_text("x" * (10 if rel == "small.md" else 100))
    monkeypatch.setattr(drive.publicise, "size_limit", lambda path: 50)
    assert drive.make_publishable(run) == [str(run / "big.md")]


# ---------- the workspace, and the known-good base ----------

def make_spec(root: Path) -> Path:
    spec = root / "spec"
    (spec / "stories" / "001-first").mkdir(parents=True)
    (spec / "README.md").write_text("# the spec\n")
    (spec / "stories" / "001-first" / "story.md").write_text("# First story\n\nbody\n")
    return spec


def mode(p: Path) -> int:
    return stat.S_IMODE(p.stat().st_mode)


def test_a_fresh_workspace_is_a_readme_the_read_only_spec_and_one_harness_commit(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "SPEC", make_spec(tmp_path))
    ws = tmp_path / "work" / "run" / "workspace"
    drive.setup_workspace(ws)
    assert (ws / "README.md").read_text() == "# vidi6\n\nA shared board for thinking together.\n"
    assert (ws / "spec" / "stories" / "001-first" / "story.md").read_text() == "# First story\n\nbody\n"
    assert mode(ws / "spec" / "README.md") == 0o444 and mode(ws / "spec" / "stories" / "001-first" / "story.md") == 0o444
    assert mode(ws / "spec" / "stories") & stat.S_IWUSR              # directories stay writable
    assert git(ws, "log", "--format=%an <%ae> %s") == "vidi-agent <agent@vidi.invalid> harness: empty repository with spec"
    assert git(ws, "rev-parse", "--abbrev-ref", "HEAD") == "main" and git(ws, "status", "--porcelain") == ""


def test_a_workspace_that_already_has_a_repository_is_left_exactly_as_it_is(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "SPEC", make_spec(tmp_path))
    ws = tmp_path / "workspace"
    (ws / ".git").mkdir(parents=True)
    (ws / "agent-file.ts").write_text("the agent's work")
    monkeypatch.setattr(drive, "sh", never)
    drive.setup_workspace(ws)
    assert sorted(p.name for p in ws.iterdir()) == [".git", "agent-file.ts"]


def reference_run(tmp_path: Path, spec_files: dict[str, str] | None = None, tag_last: bool = False) -> tuple[Path, dict]:
    """A finished reference run: a bundle with one commit per story, and metrics naming each story's end commit."""
    ws, run = tmp_path / "ref-ws", tmp_path / "ref-run"
    for rel, text in (spec_files or {"prd.md": "the spec"}).items():
        (ws / "spec" / rel).parent.mkdir(parents=True, exist_ok=True)
        (ws / "spec" / rel).write_text(text)
    git(ws, "init", "-q", "-b", "main")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "harness: empty repository with spec")
    stories = {}
    for sid in (1, 2, 3):
        (ws / f"story{sid}.ts").write_text(f"story {sid}")
        git(ws, "add", "-A")
        git(ws, "commit", "-qm", f"story {sid}")
        stories[str(sid)] = {"title": f"feature {sid}", "commit": git(ws, "rev-parse", "HEAD"), "finished": 1.0}
    if tag_last:
        git(ws, "tag", "after-story-3")
        git(ws, "branch", "side")
    run.mkdir()
    git(ws, "bundle", "create", str(run / "workspace.bundle"), "--all")
    (run / "metrics.json").write_text(json.dumps({"stories": stories}))
    return run, stories


def test_known_good_base_takes_the_stories_before_from_a_record_without_a_processed_queue(tmp_path):
    ref, stories = reference_run(tmp_path)
    base = drive.known_good_base(ref, 3)
    assert base == {"bundle": ref / "workspace.bundle", "from_run": ref, "story": 3, "commit": stories["2"]["commit"],
                    "processed": [{"id": 1, "title": "feature 1", "status": drive.DONE, "ended_by": drive.KNOWN_GOOD_BY},
                                  {"id": 2, "title": "feature 2", "status": drive.DONE, "ended_by": drive.KNOWN_GOOD_BY}]}


@pytest.mark.parametrize("sid, bundle, message", [
    (2, False, "has no workspace.bundle"),
    (9, True, "known-good: the reference run never processed story 9"),
    (1, True, "known-good: story 1 is the reference run's first; run it from empty instead"),
])
def test_known_good_base_stops_when_there_is_no_base_to_build_on(tmp_path, sid, bundle, message):
    ref, _ = reference_run(tmp_path)
    if not bundle:
        (ref / "workspace.bundle").unlink()
    with pytest.raises(SystemExit) as e:
        drive.known_good_base(ref, sid)
    assert message in str(e.value)
    if not bundle:
        assert str(e.value) == f"known-good: {ref} has no workspace.bundle"


def test_a_known_good_workspace_keeps_only_main_at_the_base_with_a_read_only_spec(tmp_path):
    ref, stories = reference_run(tmp_path, {"prd.md": "the spec", "stories/001/story.md": "# One"}, tag_last=True)
    spec = tmp_path / "ref-ws" / "spec"
    base = drive.known_good_base(ref, 3)
    ws = tmp_path / "work" / "run" / "workspace"
    drive.setup_workspace_from(ws, base, spec)
    assert git(ws, "rev-parse", "HEAD") == stories["2"]["commit"] and base["spec_updated"] is False
    assert git(ws, "for-each-ref", "--format=%(refname)") == "refs/heads/main"      # no tag, no other branch, no remote
    assert git(ws, "remote") == ""
    gone = subprocess.run(["git", "cat-file", "-e", stories["3"]["commit"]], cwd=ws, capture_output=True)
    assert gone.returncode != 0                                                    # the later story is not in the repository
    assert sorted(p.name for p in ws.iterdir() if p.name != ".git") == ["spec", "story1.ts", "story2.ts"]
    assert mode(ws / "spec" / "prd.md") == 0o444 and mode(ws / "spec" / "stories" / "001" / "story.md") == 0o444
    assert mode(ws / "spec" / "stories") & stat.S_IWUSR


OTHER_BRANCH = "side"       # the branch reference_run(tag_last=True) leaves beside main, at the same commit


def test_a_known_good_workspace_is_on_main_whichever_branch_the_clone_took_for_head(tmp_path, monkeypatch):
    """A bundle doesn't say which branch HEAD was on: where two branches end at HEAD's commit, git clone guesses
    (init.defaultBranch first, then by name). A clone that guessed the other branch lost HEAD when that branch
    was deleted, and `git rev-parse HEAD` exited 128 (on CI, whose git has no init.defaultBranch of main)."""
    ref, stories = reference_run(tmp_path, tag_last=True)
    for k, v in {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "init.defaultBranch", "GIT_CONFIG_VALUE_0": OTHER_BRANCH}.items():
        monkeypatch.setenv(k, v)
    ws = tmp_path / "work" / "run" / "workspace"
    drive.setup_workspace_from(ws, drive.known_good_base(ref, 3), tmp_path / "ref-ws" / "spec")
    assert git(ws, "rev-parse", "HEAD") == stories["2"]["commit"]
    assert git(ws, "symbolic-ref", "HEAD") == "refs/heads/main"
    assert git(ws, "for-each-ref", "--format=%(refname)") == "refs/heads/main"
    assert git(ws, "status", "--porcelain") == ""


def spec_repo(tmp_path: Path) -> tuple[Path, str]:
    """A workspace whose first commit is the harness's, with the spec; returns it and that commit."""
    ws = tmp_path / "ws"
    for rel, text in {"prd.md": "requirements", "stories/001/tasks.md": "| 1 | Do it | proposed |", "stories/001/story.md": "# One"}.items():
        (ws / "spec" / rel).parent.mkdir(parents=True, exist_ok=True)
        (ws / "spec" / rel).write_text(text)
    git(ws, "init", "-q", "-b", "main")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "harness: empty repository with spec")
    drive.spec_files_read_only(ws)
    return ws, git(ws, "rev-parse", "HEAD")


def test_the_first_commit_is_the_harness_s_however_many_follow(tmp_path):
    ws, first = spec_repo(tmp_path)
    (ws / "a.ts").write_text("a")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "story 1")
    assert drive.first_commit(ws) == first != git(ws, "rev-parse", "HEAD")


def test_restoring_the_spec_undoes_edits_deletions_additions_and_closed_directories_and_names_the_files(tmp_path):
    ws, first = spec_repo(tmp_path)
    before = drive.tree_hash(ws / "spec")
    tasks = ws / "spec" / "stories" / "001" / "tasks.md"
    tasks.chmod(0o644)
    tasks.write_text("| 1 | Do it | done |")                                 # edited and committed
    git(ws, "rm", "-q", "spec/prd.md")                                       # deleted and committed
    (ws / "spec" / "design").mkdir()
    (ws / "spec" / "design" / "mine.md").write_text("my own design")         # added and committed
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "spec: suit myself")
    (ws / "spec" / "stories" / "001" / "story.md").unlink()                  # deleted, not committed
    (ws / "spec" / "loose.md").write_text("left lying")                      # added, not committed
    (ws / "src.ts").write_text("the agent's uncommitted work")
    (ws / "spec" / "design").chmod(0o500)                                    # a directory closed to writing
    changed = drive.restore_spec(ws, first, 7)
    assert changed == ["spec/design/mine.md", "spec/loose.md", "spec/prd.md", "spec/stories/001/story.md", "spec/stories/001/tasks.md"]
    assert drive.tree_hash(ws / "spec") == before and not (ws / "spec" / "design").exists()
    assert all(mode(f) == drive.SPEC_FILE_MODE for f in (ws / "spec").rglob("*") if f.is_file())
    assert git(ws, "log", "-1", "--format=%an|%s") == "vidi-agent|harness: spec restored after story 7"
    assert git(ws, "diff", "--name-only", first, "HEAD", "--", "spec") == ""       # the spec at HEAD is the first commit's
    assert git(ws, "status", "--porcelain") == "?? src.ts"                   # the agent's own work is left as it was


def test_restoring_a_spec_changed_only_in_the_working_tree_makes_no_commit(tmp_path):
    ws, first = spec_repo(tmp_path)
    (ws / "spec" / "prd.md").chmod(0o644)
    (ws / "spec" / "prd.md").write_text("rewritten")
    assert drive.restore_spec(ws, first, 2) == ["spec/prd.md"]
    assert (ws / "spec" / "prd.md").read_text() == "requirements" and git(ws, "rev-parse", "HEAD") == first
    assert git(ws, "status", "--porcelain") == ""


def test_the_progress_file_is_committed_by_itself_even_where_the_agent_ignored_it_and_once_while_unchanged(tmp_path):
    ws, first = spec_repo(tmp_path)
    (ws / ".gitignore").write_text("PROGRESS.md\n")
    (ws / "half.ts").write_text("staged by the agent, not committed")
    git(ws, "add", ".gitignore", "half.ts")
    tasks = [{"n": 1, "title": "Do it"}]
    drive.begin_progress_file(ws, 3, "Third", tasks)
    assert git(ws, "log", "--format=%an|%s").split("\n") == ["vidi-agent|harness: PROGRESS.md for story 3", "t|harness: empty repository with spec"]
    assert git(ws, "show", "--name-only", "--format=", "HEAD") == "PROGRESS.md"
    assert (ws / "PROGRESS.md").read_text() == drive.progress_file.text(3, "Third", tasks)
    assert git(ws, "status", "--porcelain") == "A  .gitignore\nA  half.ts"   # what the agent had staged is still only staged
    head = git(ws, "rev-parse", "HEAD")
    drive.begin_progress_file(ws, 3, "Third", tasks)                         # the story started again: nothing new to commit
    assert git(ws, "rev-parse", "HEAD") == head


def test_a_known_good_workspace_that_already_exists_is_not_rebuilt(tmp_path, monkeypatch):
    ws = tmp_path / "workspace"
    (ws / ".git").mkdir(parents=True)
    base = {"bundle": tmp_path / "none.bundle", "commit": "abc"}
    monkeypatch.setattr(drive, "sh", never)
    drive.setup_workspace_from(ws, base, tmp_path / "no-spec")
    assert "spec_updated" not in base and [p.name for p in ws.iterdir()] == [".git"]


def test_a_known_good_workspace_gets_this_pack_s_spec_in_a_harness_commit_when_it_differs(tmp_path):
    ref, stories = reference_run(tmp_path, {"prd.md": "the old spec", "dropped.md": "gone in the new spec"})
    current = tmp_path / "current-spec"
    current.mkdir()
    (current / "prd.md").write_text("the new spec")
    (current / ".DS_Store").write_text("finder")
    base = drive.known_good_base(ref, 3)
    ws = tmp_path / "work" / "workspace"
    drive.setup_workspace_from(ws, base, current)
    assert base["spec_updated"] is True
    assert sorted(p.name for p in (ws / "spec").iterdir()) == ["prd.md"] and (ws / "spec" / "prd.md").read_text() == "the new spec"
    assert mode(ws / "spec" / "prd.md") == 0o444
    assert git(ws, "log", "-1", "--format=%an %s") == "vidi-agent harness: spec updated to this pack's version (known-good base)"
    assert git(ws, "rev-parse", "HEAD~1") == stories["2"]["commit"] and git(ws, "status", "--porcelain") == ""


def test_the_spec_hash_ignores_finder_files_and_nothing_else(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    for root in (a, b):
        (root / "stories").mkdir(parents=True)
        (root / "stories" / "s.md").write_text("story")
    (b / ".DS_Store").write_text("finder")
    (b / "stories" / ".DS_Store").write_text("finder")
    assert drive._spec_hash(a) == drive._spec_hash(b)
    (b / "stories" / "extra.md").write_text("")
    assert drive._spec_hash(a) != drive._spec_hash(b)


@pytest.mark.parametrize("lockfile, installed", [(False, False), (False, True), (True, True)])
def test_base_dependencies_are_not_installed_without_a_lockfile_or_when_already_there(tmp_path, monkeypatch, lockfile, installed):
    if lockfile:
        (tmp_path / "package-lock.json").write_text("{}")
    if installed:
        (tmp_path / "node_modules").mkdir()
    calls = fake_run(monkeypatch, never)
    drive.install_base_deps(tmp_path)
    assert calls == []


def test_base_dependencies_are_installed_from_the_base_s_lockfile(tmp_path, monkeypatch):
    (tmp_path / "package-lock.json").write_text("{}")
    calls = fake_run(monkeypatch, lambda cmd, **k: done())
    drive.install_base_deps(tmp_path)
    assert calls == [(["npm", "ci", "--no-audit", "--no-fund"],
                      {"cwd": tmp_path, "capture_output": True, "text": True, "timeout": drive.NPM_CI_TIMEOUT_S})]


def test_a_failed_install_of_the_base_s_dependencies_stops_the_run_with_npm_s_error(tmp_path, monkeypatch):
    (tmp_path / "package-lock.json").write_text("{}")
    fake_run(monkeypatch, lambda cmd, **k: done(returncode=1, stderr="x" * 3000 + "npm ERR! ERESOLVE"))
    with pytest.raises(SystemExit) as e:
        drive.install_base_deps(tmp_path)
    message = str(e.value)
    assert message.startswith("known-good: npm ci failed in the base: x") and message.endswith("npm ERR! ERESOLVE")
    assert len(message) == len("known-good: npm ci failed in the base: ") + 2000


# ---------- the agent's home ----------

def test_the_agent_s_browsers_are_linked_once_and_an_existing_cache_is_left_alone(tmp_path):
    home, real = tmp_path / "agent-home", tmp_path / "real-home"
    default, target = hostenv.playwright_cache(home), hostenv.agent_playwright_cache(real)
    drive.link_agent_browsers(home, real)
    assert default.is_symlink() and os.readlink(default) == str(target)       # a link even though its target is absent
    other = tmp_path / "other-real"
    drive.link_agent_browsers(home, other)                                     # already a link: not repointed
    assert os.readlink(default) == str(target)
    own_home = tmp_path / "home-with-cache"
    own = hostenv.playwright_cache(own_home)
    own.mkdir(parents=True)
    drive.link_agent_browsers(own_home, real)
    assert own.is_dir() and not own.is_symlink()


def test_the_agent_s_environment_is_its_own_home_temp_dir_and_identity(tmp_path):
    work = tmp_path / "work" / "run"
    env = drive.agent_env(work)
    home, tmp, ws = work / "agent-home", work / drive.AGENT_TMP, work / "workspace"
    assert home.is_dir() and tmp.is_dir()
    assert env == {
        "HOME": str(home), "TMPDIR": str(tmp), "TMP": str(tmp), "TEMP": str(tmp), "CLAUDE_CODE_TMPDIR": str(tmp),
        "PWD": str(ws), "OLDPWD": str(ws),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local" / "share"),
        "XDG_CACHE_HOME": str(home / ".cache"), "XDG_STATE_HOME": str(home / ".local" / "state"),
        "npm_config_cache": str(Path.home() / ".npm"),
        "PLAYWRIGHT_BROWSERS_PATH": str(hostenv.agent_playwright_cache(Path.home())),
        "WRANGLER_SEND_METRICS": "false",
        "GIT_AUTHOR_NAME": "vidi-agent", "GIT_AUTHOR_EMAIL": "agent@vidi.invalid",
        "GIT_COMMITTER_NAME": "vidi-agent", "GIT_COMMITTER_EMAIL": "agent@vidi.invalid"}


# ---------- the prompt ----------

def test_stories_so_far_names_none_then_the_done_stories_in_order():
    assert drive.stories_so_far([], 1) == "Stories already implemented in this repository, in order: none (empty repository)."
    two = [{"id": 1, "status": drive.DONE}, {"id": 2, "status": drive.DONE}]
    assert drive.stories_so_far(two, 3) == "Stories already implemented in this repository, in order: 1, 2."


def test_stories_so_far_names_each_partial_story_with_its_unverified_tasks():
    processed = [{"id": 1, "status": drive.DONE},
                 {"id": 2, "status": drive.PARTIAL, "tasks": [{"n": 1, "status": "verified"}, {"n": 2, "status": "written"},
                                                              {"n": 3}]},
                 {"id": 3, "status": drive.PARTIAL}]
    text = drive.stories_so_far(processed, 4).splitlines()
    assert text[0] == "Stories already processed in this repository, in order: 1 (done), 2 (partial), 3 (partial)."
    assert len(text) == 3
    assert text[1].startswith("Story 2 was ended before it was complete. Tasks in its tasks.md that were not verified then: 2, 3. ")
    assert "If story 4 needs behaviour story 2 was meant to provide" in text[1] and '"Gap filled from story 2"' in text[1]
    assert text[2].startswith("Story 3 was ended before it was complete. Tasks in its tasks.md that were not verified then: none recorded. ")


def test_the_prompt_fills_every_placeholder_of_the_pack_s_template(tmp_path, monkeypatch):
    template = tmp_path / "story.md.tmpl"
    template.write_text("{{APP_LINE}}|{{RULES}}|{{ID}}|{{TITLE}}|{{SPEC_DIR}}|{{STORY_DIR}}|{{STORIES_SO_FAR}}|{{SCOPE_NOTE}}")
    monkeypatch.setattr(drive, "PROMPT_TMPL", template)
    monkeypatch.setattr(drive, "PK", SimpleNamespace(app_line="the app", rules="1. a rule"))
    story = {"id": 7, "dir": "007-seventh"}
    so_far = drive.stories_so_far([], 7)
    done_line = "\n\n" + drive.harness_paragraph(7) + "\n"        # the harness's own last paragraph
    assert drive.render_prompt(story, "Seventh", [], {"out_of_scope_note": "not the eighth"}) == (
        f"the app|1. a rule|7|Seventh|spec/|spec/stories/007-seventh|{so_far}|not the eighth{done_line}")
    assert drive.render_prompt(story, "Seventh", [], {}) == (                        # a scope without a note
        f"the app|1. a rule|7|Seventh|spec/|spec/stories/007-seventh|{so_far}|{done_line}")


def test_a_story_s_title_is_its_first_line_without_the_heading_marks(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "SPEC", make_spec(tmp_path))
    assert drive.story_title({"id": 1, "dir": "001-first"}) == "First story"


# ---------- reading the agent's event log ----------

def test_the_last_event_type_is_that_of_the_last_line_that_is_an_event(tmp_path):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines({"type": "message_end"}, {"type": "tool_execution_start"}, "[1, 2]", '{"type": "cut o'))
    assert drive._last_event_type(ev) == "tool_execution_start"       # the cut-off line and the non-event are skipped
    ev.write_text(lines({"type": "tool_execution_start"}, {"no": "type"}))
    assert drive._last_event_type(ev) is None                         # the last event has no type: none is reported


@pytest.mark.parametrize("content", ["", "not json\n[1]\n\"text\"\n"])
def test_a_log_with_no_events_has_no_last_event_type(tmp_path, content):
    ev = tmp_path / "e.jsonl"
    ev.write_text(content)
    assert drive._last_event_type(ev) is None


def test_the_last_event_type_reads_only_the_tail_of_a_long_log(tmp_path, monkeypatch):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines({"type": "tool_execution_start"}) + "x" * 100 + "\n")
    monkeypatch.setattr(drive, "EVENT_TAIL_BYTES", 50)                 # the event is before the tail read
    assert drive._last_event_type(ev) is None


@pytest.mark.parametrize("last, age_s, expected", [
    ("tool_execution_start", 100, True), ("tool_execution_update", 100, True), ("tool_use", 100, True),
    ("message_end", 100, False),                 # silent, but not inside a tool call
    ("tool_execution_start", 0, False),          # inside a tool call, but not silent for long enough
])
def test_a_tool_call_is_interrupted_only_when_it_is_the_last_event_and_silent(tmp_path, monkeypatch, last, age_s, expected):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines({"type": last}))
    old = time.time() - age_s
    os.utime(ev, (old, old))
    killed = []
    monkeypatch.setattr(drive, "kill_workspace_tools", killed.append)
    assert drive.tool_hang_check(ev, tmp_path / "ws", idle_s=50) is expected
    assert killed == ([tmp_path / "ws"] if expected else [])


def test_a_story_with_no_event_log_yet_has_no_hung_tool_call(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "kill_workspace_tools", never)
    assert drive.tool_hang_check(tmp_path / "missing.jsonl", tmp_path, idle_s=0) is False


def test_stamped_events_of_a_missing_log_are_none(tmp_path):
    assert list(drive._stamped_events(tmp_path / "missing.jsonl")) == []


def test_stamped_events_are_the_stamped_whole_non_delta_lines(tmp_path):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines('{"_rx":1.000,"type":"session","id":"s"}',
                        '{"type":"message_end"}',                                # never stamped: not counted
                        '{"_rx":2.000,"type":"message_update","delta":"x"}',    # a stream delta
                        '{"_rx":3.000,"type":"tool_execution_update"}',
                        '{"_rx":4.000,"type":"message_end","cut',                # cut off mid-write
                        '{"_rx":5.000,"type":"agent_end"}'))
    assert list(drive._stamped_events(ev)) == [{"_rx": 1.0, "type": "session", "id": "s"}, {"_rx": 5.0, "type": "agent_end"}]


def test_a_stamp_is_spliced_into_an_event_line_and_nothing_else():
    assert drive.stamp('{"type":"x"}\n', 12.3456) == '{"_rx":12.346,"type":"x"}\n'
    assert drive.stamp('{ "type":"x"}\n', 1) == '{"_rx":1.000,"type":"x"}\n'
    assert drive.stamp("{}\n", 1) == '{"_rx":1.000}\n'
    assert drive.stamp("npm warn something\n", 1) == "npm warn something\n"


def test_the_last_session_is_the_latest_one_named_in_the_log(tmp_path):
    client = PiClient(tmp_path)
    ev = tmp_path / "e.jsonl"
    assert drive.last_session(client, ev) is None                     # no log
    ev.write_text(lines({"type": "message_end", "message": {"role": "assistant"}}))
    assert drive.last_session(client, ev) is None                     # a log with no session in it
    ev.write_text(lines({"type": "session", "id": "first"}, "npm warn: not json", {"type": "session", "id": "second"},
                        {"type": "message_end", "message": {"role": "assistant"}}, '{"type": "session", "id": "cut'))
    assert drive.last_session(client, ev) == "second"


def test_the_final_reply_of_a_missing_log_is_empty(tmp_path):
    assert drive.final_reply_text(tmp_path / "missing.jsonl") == ""


@pytest.mark.parametrize("line, expected", [
    ({"timestamp": "2026-10-01T12:00:00Z"}, 1790856000.0),
    ({"timestamp": "2026-10-01T13:00:00+01:00"}, 1790856000.0),
    ({"timestamp": 1790856000123}, 1790856000.123),               # milliseconds
    ({"timestamp": 1790856000}, 1790856000.0),                    # seconds
    ({"timestamp": 1790856000.5}, 1790856000.5),
])
def test_the_first_event_time_reads_iso_milliseconds_or_seconds(tmp_path, line, expected):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines("not json", "[1]", {"type": "session"}, {"timestamp": None}, {"timestamp": [1]}, line,
                        {"timestamp": 5}))
    got = drive.first_event_time(ev)
    assert got == expected and isinstance(got, float)


def test_a_log_with_no_timestamp_or_no_log_has_no_first_event_time(tmp_path):
    ev = tmp_path / "e.jsonl"
    assert drive.first_event_time(ev) is None
    ev.write_text(lines({"type": "session"}, "garbage"))
    assert drive.first_event_time(ev) is None


def test_an_agent_s_record_is_rebuilt_from_its_log_alone(tmp_path):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines({"type": "session", "id": "s9", "timestamp": "2026-10-01T12:00:00Z"},
                        {"type": "tool_execution_start", "toolName": "bash", "args": {}},
                        {"type": "message_end", "message": {"role": "assistant", "usage": {"input": 3, "output": 4}}},
                        {"type": "compaction_end"}))
    os.utime(ev, (1790856090.26, 1790856090.26))
    assert drive.reconstruct_agent(PiClient(tmp_path), ev) == {
        "seconds": 90.3, "steps": 1, "tool_calls": 1, "compactions": 1, "tool_interruptions": 0,
        "tokens": {"input": 3, "output": 4, "reasoning": 0, "cache_read": 0, "cache_write": 0}, "exit": None,
        "stalled": False, "resumes": 0, "nudges": 0, "errors": [], "ended_in_error": False, "sessions": ["s9"],
        "ended_by_operator": True, "reconstructed_from_log": True}


def test_a_record_rebuilt_from_a_log_without_times_has_no_seconds(tmp_path):
    ev = tmp_path / "e.jsonl"
    ev.write_text(lines({"type": "session", "id": "s9"}))
    rec = drive.reconstruct_agent(PiClient(tmp_path), ev)
    assert rec["seconds"] == 0.0 and rec["steps"] == 0 and rec["sessions"] == ["s9"]


# ---------- server statistics, lines of code ----------

def test_server_stats_without_a_log_are_empty(tmp_path):
    assert drive.server_stats(None, 0, 10) == {}
    assert drive.server_stats(tmp_path / "missing.jsonl", 0, 10) == {}


def test_server_stats_count_the_requests_in_every_attempt_s_window_and_skip_broken_lines(tmp_path):
    log = tmp_path / "request-log.jsonl"
    log.write_text(lines(
        {"logged_at_s": 5, "prompt_tokens": 100, "completion_tokens": 10, "cached_tokens": 50, "ttft_s": 1.0,
         "prefill_tok_s": 300.0, "decode_tok_s": 30.0, "context_len": 15_999},
        "a line cut off when the server was kil",
        {"logged_at_s": 10, "prompt_tokens": 200, "completion_tokens": 20, "cached_tokens": None, "ttft_s": 3.0,
         "prefill_tok_s": 100.0, "decode_tok_s": 10.0, "context_len": 16_000},
        {"logged_at_s": 11, "prompt_tokens": 999, "completion_tokens": 999, "context_len": 999_999},   # in no window
        {"logged_at_s": 22, "prompt_tokens": 1, "completion_tokens": 2, "context_len": 120_000, "decode_tok_s": 20.0},
        {"prompt_tokens": 7, "completion_tokens": 7}))                                                  # no time: none
    assert drive.server_stats(log, 20, 30, earlier=[(5, 10)]) == {
        "requests": 3, "prompt_tokens": 301, "completion_tokens": 32, "cached_tokens": 50,
        "ttft_median_s": 3.0, "prefill_tok_s_median": 300.0, "decode_tok_s_median": 20.0, "max_context": 120_000,
        "decode_by_context": {"0-16k": {"requests": 1, "decode_tok_s_median": 30.0},
                              "16-32k": {"requests": 1, "decode_tok_s_median": 10.0},
                              "100-+k": {"requests": 1, "decode_tok_s_median": 20.0}}}


def test_server_stats_of_a_window_with_no_requests_are_zeroes(tmp_path):
    log = tmp_path / "request-log.jsonl"
    log.write_text(lines({"logged_at_s": 500, "prompt_tokens": 1}))
    assert drive.server_stats(log, 0, 10) == {
        "requests": 0, "prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "ttft_median_s": None,
        "prefill_tok_s_median": None, "decode_tok_s_median": None, "max_context": 0, "decode_by_context": {}}


def test_the_median_ignores_missing_values_and_takes_the_upper_middle():
    assert drive._median([]) is None and drive._median([None, None]) is None
    assert drive._median([3, None, 1]) == 3 and drive._median([5, 1, 3]) == 3 and drive._median(iter([2])) == 2


def test_lines_of_code_count_tracked_files_under_src_and_tests(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    for rel, text in {"src/a.ts": "1\n2\n3\n", "tests/a.test.ts": "1\n2\n", "README.md": "1\n", "src/untracked.ts": "1\n"}.items():
        (tmp_path / rel).parent.mkdir(exist_ok=True)
        (tmp_path / rel).write_text(text)
    git(tmp_path, "add", "src/a.ts", "tests/a.test.ts", "README.md")
    assert drive.loc(tmp_path) == {"files": 2, "lines": 5}
    (tmp_path / "src" / "a.ts").unlink()                      # tracked but deleted from disk: a file, no lines
    assert drive.loc(tmp_path) == {"files": 2, "lines": 2}


def test_lines_of_code_outside_a_repository_are_none(tmp_path):
    assert drive.loc(tmp_path) == {"files": 0, "lines": 0}


# ---------- the machine's conditions, on either platform ----------

def test_conditions_on_linux_are_hostenv_s_power_and_thermal(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    monkeypatch.setattr(hostenv, "linux_power", lambda: {"ac": True, "low_power": True})
    monkeypatch.setattr(hostenv, "linux_thermal", lambda: "unmonitored")
    calls = fake_run(monkeypatch, never)
    assert drive.conditions() == {"ac": True, "low_power": True, "thermal": "unmonitored"} and calls == []


def test_conditions_on_macos_are_pmset_s_power_and_the_thermal_pressure(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", True)
    monkeypatch.setattr(drive, "thermal", lambda: "heavy")
    answers = {("pmset", "-g", "batt"): done("Now drawing from 'Battery Power'\n"),
               ("pmset", "-g"): done(" lowpowermode         1\n")}
    calls = fake_run(monkeypatch, lambda cmd, **k: answers[tuple(cmd)])
    assert drive.conditions() == {"ac": False, "low_power": True, "thermal": "heavy"}
    assert [c for c, _ in calls] == [["pmset", "-g", "batt"], ["pmset", "-g"]]


@pytest.mark.parametrize("pmset_g, low", [("", False), (" powermode 0\n lowpowermode 0\n", False),
                                           (" powermode            2\n", True), ("lowpowermode 1", True)])
def test_low_power_is_any_power_mode_other_than_zero(pmset_g, low):
    assert drive.parse_power("Now drawing from 'AC Power'", pmset_g) == {"ac": True, "low_power": low}


@pytest.mark.parametrize("c, ok", [
    (NOMINAL, True), ({**NOMINAL, "thermal": "unmonitored"}, True), (ON_BATTERY, False),
    ({**NOMINAL, "low_power": True}, False), ({**NOMINAL, "thermal": "heavy"}, False)])
def test_a_machine_is_fit_on_mains_out_of_low_power_and_cool(c, ok):
    assert bool(drive.conditions_ok(c)) is ok


def test_waiting_for_conditions_announces_once_and_polls_until_fit(monkeypatch, capsys):
    seen = iter([ON_BATTERY, {**NOMINAL, "thermal": "heavy"}, NOMINAL])
    monkeypatch.setattr(drive, "conditions", lambda: next(seen))
    slept = []
    monkeypatch.setattr(drive.time, "sleep", slept.append)
    assert drive.wait_for_conditions() == NOMINAL
    assert slept == [drive.CONDITION_POLL_S, drive.CONDITION_POLL_S]
    out = capsys.readouterr().out
    assert out == f"  waiting for AC power, no Low Power Mode, nominal thermals: now {ON_BATTERY}\n"


def test_a_run_told_not_to_wait_takes_the_conditions_as_they_are(monkeypatch, capsys):
    monkeypatch.setattr(drive, "conditions", lambda: ON_BATTERY)
    monkeypatch.setattr(drive.time, "sleep", never)
    assert drive.wait_for_conditions(wait=False) == ON_BATTERY and capsys.readouterr().out == ""


def test_a_fit_machine_is_not_waited_for(monkeypatch, capsys):
    monkeypatch.setattr(drive, "conditions", lambda: NOMINAL)
    monkeypatch.setattr(drive.time, "sleep", never)
    assert drive.wait_for_conditions() == NOMINAL and capsys.readouterr().out == ""


def test_the_swap_in_use_is_parsed_from_megabytes_to_gigabytes():
    assert drive.parse_swap_gb("total = 4096.00M  used = 2048.00M  free = 2048.00M  (encrypted)") == 2.0
    assert drive.parse_swap_gb("no figures here") == 0.0


@pytest.mark.parametrize("unit, gb", [("KB", 1 / 1024 ** 2), ("MB", 1 / 1024), ("GB", 1.0), ("TB", 1024.0)])
def test_a_footprint_is_read_in_any_unit(unit, gb):
    out = f"    phys_footprint: 2 {unit}\n    phys_footprint_peak: 4 {unit}\n"
    assert drive.parse_footprint_gb(out) == (2 * gb, 4 * gb)


def test_a_footprint_that_is_not_reported_is_none():
    assert drive.parse_footprint_gb("phys_footprint: 3 GB\n") == (3.0, None)
    assert drive.parse_footprint_gb("footprint: no such process") == (None, None)


def test_the_server_s_pid_is_the_first_listener_on_its_port(monkeypatch):
    calls = fake_run(monkeypatch, lambda cmd, **k: done("4321\n4322\n"))
    assert drive.server_pid(18010) == 4321
    assert [c for c, _ in calls] == [["lsof", "-nP", "-t", "-iTCP:18010", "-sTCP:LISTEN"]]


def test_a_port_nothing_listens_on_has_no_server_pid(monkeypatch):
    fake_run(monkeypatch, lambda cmd, **k: done(""))
    assert drive.server_pid(18010) is None


def test_the_server_s_footprint_is_unknown_without_a_port_or_a_listener(monkeypatch):
    monkeypatch.setattr(drive, "server_pid", never)
    assert drive.server_footprint_gb(None) == (None, None)
    monkeypatch.setattr(drive, "server_pid", lambda port: None)
    fake_run(monkeypatch, never)
    assert drive.server_footprint_gb(18010) == (None, None)


def test_the_server_s_footprint_on_linux_is_hostenv_s(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    monkeypatch.setattr(drive, "server_pid", lambda port: 77)
    monkeypatch.setattr(hostenv, "linux_process_gb", lambda pid: (pid / 10, pid / 5))
    fake_run(monkeypatch, never)
    assert drive.server_footprint_gb(18010) == (7.7, 15.4)


def test_the_server_s_footprint_on_macos_is_read_from_footprint(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", True)
    monkeypatch.setattr(drive, "server_pid", lambda port: 77)
    calls = fake_run(monkeypatch, lambda cmd, **k: done("  phys_footprint: 90 GB\n  phys_footprint_peak: 2048 MB\n"))
    assert drive.server_footprint_gb(18010) == (90.0, 2.0)
    assert [c for c, _ in calls] == [["footprint", "-p", "77"]]


def test_swap_in_use_on_linux_is_hostenv_s(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    monkeypatch.setattr(hostenv, "linux_swap_used_gb", lambda: 3.25)
    fake_run(monkeypatch, never)
    assert drive.swap_used_gb() == 3.25


def test_swap_in_use_on_macos_is_read_from_sysctl(monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", True)
    calls = fake_run(monkeypatch, lambda cmd, **k: done("total = 2048.00M  used = 512.00M  free = 1536.00M"))
    assert drive.swap_used_gb() == 0.5
    assert [c for c, _ in calls] == [["sysctl", "-n", "vm.swapusage"]]


def perf_dir(tmp_path: Path, monkeypatch, body: str | None) -> None:
    """drive.BENCHMARKS pointed at a made-up benchmarks/ whose perf/thermal.py has this body (None: no such file),
    with the import state (sys.path, the cached module) put back when the test ends."""
    benchmarks = tmp_path / "benchmarks"
    (benchmarks / "perf").mkdir(parents=True)
    if body is not None:
        (benchmarks / "perf" / "thermal.py").write_text(body)
    monkeypatch.setattr(drive, "BENCHMARKS", benchmarks)
    monkeypatch.setattr(sys, "path", [p for p in sys.path if Path(p).name != "perf"])
    monkeypatch.delitem(sys.modules, "thermal", raising=False)
    monkeypatch.setattr(sys, "dont_write_bytecode", True)


def test_thermal_is_what_the_perf_benchmark_s_reader_says(tmp_path, monkeypatch):
    perf_dir(tmp_path, monkeypatch, "def thermal_pressure():\n    return 'moderate'\n")
    assert drive.thermal() == "moderate"
    monkeypatch.delitem(sys.modules, "thermal", raising=False)


def test_a_thermal_reader_that_fails_is_reported_as_unknown_with_its_error(tmp_path, monkeypatch):
    perf_dir(tmp_path, monkeypatch, "def thermal_pressure():\n    raise OSError('no sensor')\n")
    assert drive.thermal() == "unknown (no sensor)"
    monkeypatch.delitem(sys.modules, "thermal", raising=False)


def test_a_missing_thermal_reader_is_reported_as_unknown(tmp_path, monkeypatch):
    perf_dir(tmp_path, monkeypatch, None)
    assert drive.thermal() == "unknown (No module named 'thermal')"


def test_conditions_are_summarised_as_degraded_by_power_and_throttled_by_heat():
    bad = [{**ON_BATTERY, "t": 1.0}, {**NOMINAL, "low_power": True, "t": 2.0}, {**NOMINAL, "thermal": "heavy", "t": 3.0}]
    assert drive.summarise_conditions(4, bad) == {"samples": 4, "degraded": True, "throttled_share": 0.25, "bad_samples": bad}
    hot = [{**NOMINAL, "thermal": "heavy", "t": 3.0}]
    assert drive.summarise_conditions(3, hot) == {"samples": 3, "degraded": False, "throttled_share": 0.33, "bad_samples": hot}
    assert drive.summarise_conditions(0, []) == {"samples": 0, "degraded": False, "throttled_share": 0.0, "bad_samples": []}


# ---------- processed stories and the operator's skip ----------

def test_the_processed_queue_is_the_record_s_own_when_it_has_one():
    queue = [{"id": 2, "status": drive.PARTIAL}]
    metrics = {"processed": queue, "stories": {"1": {"finished": 1.0}}}
    assert drive.load_processed(metrics, [{"id": 1}, {"id": 2}]) is queue


def test_an_older_record_s_finished_stories_become_done_in_scope_order():
    metrics = {"stories": {"3": {"finished": 3.0, "title": "Third"}, "1": {"finished": 1.0}, "2": {"title": "unfinished"},
                           "9": {"finished": 9.0, "title": "not in this scope"}}}
    assert drive.load_processed(metrics, [{"id": 1}, {"id": 2}, {"id": 3}]) == [
        {"id": 1, "title": None, "status": drive.DONE, "ended_by": "agent"},
        {"id": 3, "title": "Third", "status": drive.DONE, "ended_by": "agent"}]


def skip_file(run: Path) -> Path:
    f = run / drive.CONTROL_DIR / drive.SKIP_FILE
    f.parent.mkdir(parents=True, exist_ok=True)
    return f


def test_a_skip_request_counts_only_for_its_own_story_and_never_names_who_sent_it(tmp_path):
    assert drive.pending_skip(tmp_path, 4) is None                     # no request
    f = skip_file(tmp_path)
    f.write_text("{ not json")
    assert drive.pending_skip(tmp_path, 4) is None
    f.write_text(json.dumps({"story": 4, "reason": "stuck", "by": "someone@example.invalid", "at": 9.0}))
    assert drive.pending_skip(tmp_path, 4) == {"story": 4, "reason": "stuck", "by": drive.OPERATOR, "at": 9.0}
    assert drive.pending_skip(tmp_path, 5) is None                     # another story's request


def test_an_applied_skip_request_is_moved_aside_and_another_story_s_is_left(tmp_path):
    f = skip_file(tmp_path)
    f.write_text(json.dumps({"story": 4, "reason": "stuck"}))
    drive.mark_skip_applied(tmp_path, 5)
    assert f.exists()
    drive.mark_skip_applied(tmp_path, 4)
    assert not f.exists() and json.loads(f.with_name("skip-story-4.applied.json").read_text())["reason"] == "stuck"
    drive.mark_skip_applied(tmp_path, 4)                                # nothing waiting: nothing to do


# ---------- faults in the harness's own bookkeeping ----------

class Boom(RuntimeError):
    pass


def failing(message: str = "injected"):
    def fn():
        raise Boom(message)
    return fn


def test_a_derived_step_that_works_returns_its_result_and_records_nothing(tmp_path):
    assert drive.derived("a step", lambda: 42, "default", run=tmp_path) == 42
    assert drive.STORY_FAULTS == [] and not (tmp_path / "interventions.md").exists()


def test_a_fault_without_a_run_is_kept_with_the_story_and_logged_nowhere(tmp_path, capsys):
    assert drive.derived("a step", failing(), "the default") == "the default"
    assert len(drive.STORY_FAULTS) == 1
    fault = drive.STORY_FAULTS[0]
    assert fault["step"] == "a step" and fault["error"] == "Boom: injected"
    name, line = fault["where"].split(":")
    assert name == Path(__file__).name and int(line) > 0
    assert capsys.readouterr().out == "    HARNESS FAULT in a step (Boom: injected); the story is recorded without it\n"
    assert list(tmp_path.iterdir()) == []


def test_a_fault_with_a_run_is_also_written_to_its_interventions(tmp_path):
    assert drive.derived("a step", failing()) is None and drive.derived("a step", failing(), run=tmp_path) is None
    log = (tmp_path / "interventions.md").read_text()
    assert log.startswith("# Interventions\n\n") and log.count("harness fault in a step: Boom: injected (") == 1
    assert log.rstrip().endswith("); the story was recorded without it")
    assert [f["step"] for f in drive.STORY_FAULTS] == ["a step", "a step"]


def test_a_fault_s_error_is_cut_to_its_limit(tmp_path):
    drive.derived("a step", failing("m" * 1000))
    assert drive.STORY_FAULTS[0]["error"] == ("Boom: " + "m" * 1000)[:drive.FAULT_ERROR_CHARS]


def test_a_fault_while_logging_a_fault_is_recorded_too_and_goes_no_further(tmp_path):
    missing = tmp_path / "no-such-run"                                # interventions.md can't be written there
    assert drive.derived("a step", failing(), "d", run=missing) == "d"
    assert [f["step"] for f in drive.STORY_FAULTS] == ["a step", "interventions log"]
    assert drive.STORY_FAULTS[1]["error"].startswith("FileNotFoundError")


@pytest.mark.parametrize("stop", [SystemExit(75), KeyboardInterrupt()])
def test_a_stop_is_never_taken_for_a_fault(stop):
    def fn():
        raise stop
    with pytest.raises(type(stop)):
        drive.derived("a step", fn, "default")
    assert drive.STORY_FAULTS == []


def test_faults_are_copied_into_the_story_s_record_only_when_there_are_any():
    rec: dict = {}
    drive.keep_faults(rec)
    assert rec == {}
    drive.derived("a step", failing())
    drive.keep_faults(rec)
    assert rec["harness_faults"] == drive.STORY_FAULTS and rec["harness_faults"] is not drive.STORY_FAULTS


def test_interventions_get_their_heading_once_and_a_dated_line_each(tmp_path):
    drive.log_intervention(tmp_path, "first thing")
    drive.log_intervention(tmp_path, "second thing")
    text = (tmp_path / "interventions.md").read_text()
    head, _, body = text.partition("\n\n- ")
    assert head == ("# Interventions\n\nEvery manual or automatic intervention in this run, oldest first. "
                    "The run's numbers should be read with these in mind.")
    entries = ("- " + body).splitlines()
    assert [e.split(" ", 2)[2] for e in entries] == ["first thing", "second thing"]
    for e in entries:
        time.strptime(e.split(" ", 2)[1], "%Y-%m-%dT%H:%M:%SZ")


# ---------- a story's attempts, provenance and time split ----------

def test_a_fresh_story_has_no_earlier_attempts_and_its_record_is_left_alone(tmp_path):
    ev = tmp_path / "e.jsonl"
    assert drive.begin_attempt(PiClient(tmp_path), ev, None, 100.0, {}) == [] and not ev.exists()
    rec = {"agent": {"seconds": 5}, "started": 1.0, "agent_finished": 2.0}
    drive.record_attempts(rec, [])
    assert rec == {"agent": {"seconds": 5}, "started": 1.0, "agent_finished": 2.0}


def test_a_story_s_provenance_names_the_pack_version_it_started_under_only_when_it_moved():
    harness = {"harness_commit": "abc1234", "harness_dirty": False, "harness_release": None}
    assert drive.story_provenance(harness, "pack-v1", "pack-v1") == {
        **harness, "pack_version": "pack-v1", "source": drive.provenance.LIVE}
    assert drive.story_provenance(harness, "pack-v1", "pack-v2") == {
        **harness, "pack_version": "pack-v2", "source": drive.provenance.LIVE, "started_under": {"pack_version": "pack-v1"}}


def test_harness_provenance_is_the_code_s_commit_and_its_release(tmp_path, monkeypatch):
    monkeypatch.setattr(drive.provenance, "at_start", lambda root: {"harness_commit": "abc1234", "harness_dirty": True})
    monkeypatch.setattr(drive.roots, "release_tag", lambda root: "harness-v9")
    assert drive.harness_provenance(tmp_path) == {"harness_commit": "abc1234", "harness_dirty": True,
                                                  "harness_release": "harness-v9"}


def split(wall: float, model: dict | None = None, problems: list[str] | None = None, **extra) -> dict:
    return {"wall_s": wall, "tools_s": 0.0, "compaction_s": 0.0, "other_s": wall, "model": model,
            "accounting": {"version": 1, "ok": not problems, "problems": list(problems or [])}, **extra}


def test_a_story_run_once_is_split_over_its_own_window_and_checked_against_the_agent_s_clock(tmp_path, monkeypatch):
    windows = []
    monkeypatch.setattr(drive, "time_split", lambda ev, log, a, b: windows.append((ev, log, a, b)) or split(30.0, problems=["an old problem"]))
    monkeypatch.setattr(attempts, "split_of", never)
    monkeypatch.setattr(accounting, "draft_figures", never)
    checked = []
    monkeypatch.setattr(accounting, "check", lambda s, agent_seconds=None: checked.append(agent_seconds) or ["an old problem", "a clock problem"])
    rec = {"started": 100.0, "agent_finished": 130.0, "agent": {"seconds": 29.0, "attempts": [{"source": "harness"}]}}
    got = drive.story_time_split(rec, tmp_path / "e.jsonl", tmp_path / "server.log")
    assert windows == [(tmp_path / "e.jsonl", tmp_path / "server.log", 100.0, 130.0)] and checked == [29.0]
    assert got["accounting"] == {"version": 1, "ok": False, "problems": ["an old problem", "a clock problem"]}   # no duplicate
    assert rec["agent"] == {"seconds": 29.0, "attempts": [{"source": "harness"}]}       # one attempt: nothing rewritten


def test_a_story_with_no_agent_record_is_still_split_and_passes_with_no_problems(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "time_split", lambda *a: split(30.0))
    checked = []
    monkeypatch.setattr(accounting, "check", lambda s, agent_seconds=None: checked.append(agent_seconds) or [])
    got = drive.story_time_split({"started": 1.0, "agent_finished": 31.0}, tmp_path / "e", tmp_path / "s")
    assert checked == [None] and got["accounting"]["ok"] is True and got["accounting"]["problems"] == []


def restarted_story(monkeypatch, tmp_path: Path, log_split: dict, live_split: dict):
    """A story with one attempt the log recorded and one the harness ran; returns (rec, calls)."""
    calls = {"split_of": [], "draft": []}
    monkeypatch.setattr(drive, "time_split", lambda *a: live_split)
    monkeypatch.setattr(attempts, "split_of", lambda ev, log, a: calls["split_of"].append(a["attempt"]) or log_split)
    monkeypatch.setattr(accounting, "draft_figures",
                        lambda ev, log, windows: calls["draft"].append(windows) or {"draft_acceptance": 0.5})
    monkeypatch.setattr(accounting, "check", lambda s, agent_seconds=None: [])
    rec = {"started": 500.0, "agent_finished": 530.0, "agent": {"seconds": 999.0, "attempts": [
        {"attempt": 1, "source": "log", "started": 100.0, "ended": 200.0, "seconds": 100.0},
        {"attempt": 2, "source": "harness", "started": 500.0, "ended": 530.0, "seconds": 29.0}]}}
    return rec, calls


def test_a_restarted_story_is_split_attempt_by_attempt_and_summed(tmp_path, monkeypatch):
    model = {"source": "client-stream", "requests": 2, "prefill_s": 1.0, "prefill_tokens": 10, "decode_s": 1.0,
             "decode_tokens": 10, "cached_tokens": 0, "prefill_tok_s": 10.0, "decode_tok_s": 10.0}
    log_split = split(100.0, dict(model), between_sessions_s=20.0, suspended_s=5.0)
    live_split = split(30.0, dict(model))
    rec, calls = restarted_story(monkeypatch, tmp_path, log_split, live_split)
    got = drive.story_time_split(rec, tmp_path / "e.jsonl", tmp_path / "server.log")
    assert calls["split_of"] == [1]                                   # only the attempt the log recorded
    first, second = rec["agent"]["attempts"]
    assert first["time_split"] is log_split and second["time_split"] is live_split
    assert first["seconds"] == 75.0                                   # its span less the waits and the sleep
    assert second["seconds"] == 29.0                                  # the harness's own clock: kept
    assert rec["agent"]["seconds"] == 104.0
    assert got["attempts"] == 2 and got["wall_s"] == 130.0
    assert calls["draft"] == [[(100.0, 200.0), (500.0, 530.0)]]       # draft figures over every attempt's window
    assert got["model"]["draft_acceptance"] == 0.5 and got["model"]["requests"] == 4


def test_a_restarted_story_with_no_model_calls_in_any_attempt_gets_no_draft_figures(tmp_path, monkeypatch):
    rec, calls = restarted_story(monkeypatch, tmp_path, split(100.0), split(30.0))
    got = drive.story_time_split(rec, tmp_path / "e.jsonl", tmp_path / "server.log")
    assert got["model"] is None and calls["draft"] == []
    assert rec["agent"]["attempts"][0]["seconds"] == 100.0 and rec["agent"]["seconds"] == 129.0


def test_a_story_skipped_before_its_restart_takes_every_attempt_s_split_from_the_log(tmp_path, monkeypatch):
    rec, calls = restarted_story(monkeypatch, tmp_path, split(50.0), split(30.0))
    rec["agent"]["attempts"][1].update(source="log", seconds=None)
    got = drive.story_time_split(rec, tmp_path / "e.jsonl", tmp_path / "server.log")
    assert calls["split_of"] == [1, 2]
    assert [a["seconds"] for a in rec["agent"]["attempts"]] == [50.0, 50.0] and rec["agent"]["seconds"] == 100.0
    assert got["wall_s"] == 100.0


def test_the_time_split_is_accounting_s_over_the_given_window(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(accounting, "time_split", lambda *a: seen.append(a) or {"wall_s": 1.0})
    assert drive.time_split(tmp_path / "e", tmp_path / "s", 1.0, 2.0) == {"wall_s": 1.0}
    assert seen == [(tmp_path / "e", tmp_path / "s", 1.0, 2.0)]


# ---------- stopping the run ----------

def test_a_story_the_guards_did_not_stop_carries_on(tmp_path):
    drive.stop_if_machine_unfit(tmp_path, 3, {"aborted_swap": False, "aborted_memory": False})
    drive.stop_if_machine_unfit(tmp_path, 3, {})
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("conditions, guard", [
    ({"aborted_swap": True, "aborted_memory": False}, "swap"),
    ({"aborted_swap": False, "aborted_memory": True}, "memory"),
    ({"aborted_swap": True, "aborted_memory": True}, "memory"),
])
def test_a_story_a_guard_stopped_ends_the_run_as_machine_unfit(tmp_path, monkeypatch, capsys, conditions, guard):
    recorded = []
    monkeypatch.setattr(drive.machine_fit, "record_unfit", lambda *a: recorded.append(a))
    c = {**conditions, "swap_start_gb": 1.0, "swap_max_gb": 6.5, "free_min_pct": 7.0}
    with pytest.raises(SystemExit) as e:
        drive.stop_if_machine_unfit(tmp_path, 3, c)
    assert e.value.code == drive.machine_fit.EXIT_MACHINE_UNFIT
    reason = f"{guard} guard: swap 1.0 -> 6.5 GB, free memory at least 7.0%"
    assert recorded == [(tmp_path, 3, reason, 1.0, 6.5, 7.0)]
    assert capsys.readouterr().err == (f"[story 3] stopped by the {reason}. Not checkpointed; the run resumes once the "
                                       f"machine has recovered (machine_fit.py).\n")


def test_missing_resources_and_interrupted_scoring_each_stop_the_run_with_their_own_label(capsys):
    drive.stop_if_missing_resources(2, {"all_green": False}, {"harness_fault": None})
    assert capsys.readouterr().err == ""
    for prefix, label in ((drive.gates.MISSING_RESOURCES, "MISSING RESOURCES"), (drive.gates.SCORING_INTERRUPTED, "SCORING INTERRUPTED")):
        with pytest.raises(SystemExit) as e:
            drive.stop_if_missing_resources(2, {}, {"harness_fault": f"{prefix} the reason"})
        assert e.value.code == drive.EXIT_MISSING_RESOURCES
        assert capsys.readouterr().err == (f"{label}: the reason. Story 2's scores are void: fix it, re-score the story "
                                           f"(gates.py), then re-run to continue with the next story.\n")


# ---------- labels and work directories ----------

def test_a_run_is_labelled_and_given_a_work_dir_by_its_place_in_the_results(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "REPO_ROOT", tmp_path / "repo")
    monkeypatch.setattr(drive, "WORK_ROOT", tmp_path / "work")
    combo = tmp_path / "repo" / "combinations" / "fam" / "ver" / "size" / "os" / "ram" / "stack" / "benchmarks" / "vidi" / "r1"
    assert drive.combination_label(combo) == "fam/ver/size/os/ram/stack"
    assert drive.work_dir_for(combo) == tmp_path / "work" / "fam__ver__size__os__ram__stack__benchmarks__vidi__r1"
    ref = tmp_path / "repo" / "benchmarks" / "reference" / "vidi" / "some-stack" / "run-2"
    assert drive.combination_label(ref) == "reference/some-stack"
    assert drive.work_dir_for(ref) == tmp_path / "work" / "benchmarks__reference__vidi__some-stack__run-2"
    elsewhere = tmp_path / "elsewhere" / "run-9"
    assert drive.combination_label(elsewhere) == "run-9" and drive.work_dir_for(elsewhere) == tmp_path / "work" / "run-9"


def test_outside_packages_name_every_ancestor_s_package_dir_and_manifests(tmp_path):
    got = drive.outside_packages(tmp_path / "a" / "b")
    parents = list((tmp_path / "a" / "b").resolve().parents)
    assert got == [p / n for p in parents for n in ("node_modules", "package.json", "package-lock.json")]


def test_the_mirror_holds_the_source_without_build_output_and_the_git_log_beside_it(tmp_path):
    ws, dest = tmp_path / "ws", tmp_path / "run" / "workspace"
    for rel in ("src/a.ts", "spec/prd.md", "node_modules/p/i.js", "dist/out.js", ".wrangler/s", "test-results/r",
                "playwright-report/i.html", "sub/dist/kept.js"):
        (ws / rel).parent.mkdir(parents=True, exist_ok=True)
        (ws / rel).write_text(rel)
    git(ws, "init", "-q", "-b", "main")
    git(ws, "add", "src")
    git(ws, "commit", "-qm", "story 1: a")
    (dest / "stale.ts").parent.mkdir(parents=True)
    (dest / "stale.ts").write_text("deleted since")
    drive.mirror(ws, dest)
    kept = sorted(str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file())
    assert kept == ["src/a.ts", "sub/dist/kept.js"]                   # only top-level excludes; nothing stale
    log = (tmp_path / "run" / "workspace-git-log.txt").read_text()
    assert log.startswith("commit ") and "    story 1: a" in log and "src/a.ts" in log


def test_set_pack_points_every_pack_global_at_the_new_pack(tmp_path, monkeypatch):
    for name in ("PK", "PACK", "SPEC", "PROMPT_TMPL"):
        monkeypatch.setattr(drive, name, getattr(drive, name))
    pack = tmp_path / "packs" / "covpack"
    make_spec(pack)
    monkeypatch.setenv("SPEC_BENCH_PACK_DIR", str(pack))
    drive.set_pack("covpack")
    assert drive.PK.name == "covpack" and drive.PACK == pack.resolve() and drive.SPEC == pack.resolve() / "spec"
    assert drive.PROMPT_TMPL == drive.PK.template and drive.PK.stories == {1: "001-first"}
