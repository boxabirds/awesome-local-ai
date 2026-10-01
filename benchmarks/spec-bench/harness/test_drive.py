"""uv run --with pytest pytest harness/test_drive.py"""
import pytest
import json
from drive import LoopDetector, LOOP_REPEAT_LIMIT


def test_identical_calls_trip_at_limit():
    d = LoopDetector()
    hits = [d.tool_call("bash", {"command": "npm test"}) for _ in range(LOOP_REPEAT_LIMIT)]
    assert hits == [False] * (LOOP_REPEAT_LIMIT - 1) + [True]


def test_any_different_call_resets():
    d = LoopDetector()
    for _ in range(LOOP_REPEAT_LIMIT - 1):
        assert not d.tool_call("bash", {"command": "npm test"})
    assert not d.tool_call("read", {"filePath": "a.ts"})
    for _ in range(LOOP_REPEAT_LIMIT - 1):
        assert not d.tool_call("bash", {"command": "npm test"})


def test_same_tool_different_input_is_progress():
    d = LoopDetector()
    assert not any(d.tool_call("edit", {"n": i}) for i in range(LOOP_REPEAT_LIMIT * 2))


# ---- sandbox: the agent must not be able to read the harness or held-out suite ----
import subprocess
from pathlib import Path

from drive import sandboxed, REPO_ROOT

VIDI = REPO_ROOT / "benchmarks" / "vidi"   # the in-repo copy of the pack, which the sandbox must hide
SECRET = VIDI / "acceptance" / "package.json"


@pytest.mark.needs_sandbox
def test_sandbox_blocks_reading_the_acceptance_suite(tmp_path: Path):
    own = tmp_path / "run"
    (own / "workspace").mkdir(parents=True)
    r = subprocess.run(sandboxed(["cat", str(SECRET)], own_dir=own), capture_output=True, text=True)
    assert r.returncode != 0 and "vidi-acceptance" not in r.stdout


@pytest.mark.needs_sandbox
def test_sandbox_blocks_listing_the_repo(tmp_path: Path):
    own = tmp_path / "run"
    (own / "workspace").mkdir(parents=True)
    r = subprocess.run(sandboxed(["ls", str(VIDI)], own_dir=own), capture_output=True, text=True)
    assert r.returncode != 0 and "acceptance" not in r.stdout


@pytest.mark.needs_sandbox
def test_sandbox_allows_own_workspace(tmp_path: Path):
    own = tmp_path / "run"
    ws = own / "workspace"
    ws.mkdir(parents=True)
    (ws / "f.txt").write_text("mine")
    r = subprocess.run(sandboxed(["cat", str(ws / "f.txt")], own_dir=own), capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout == "mine"


@pytest.mark.needs_sandbox
def test_sandbox_hides_sibling_runs_but_not_own():
    from drive import WORK_ROOT
    import shutil
    mine, other = WORK_ROOT / "_test_mine", WORK_ROOT / "_test_other"
    try:
        for d in (mine, other):
            (d / "workspace").mkdir(parents=True, exist_ok=True)
            (d / "workspace" / "f.txt").write_text(d.name)
        own = subprocess.run(sandboxed(["cat", str(mine / "workspace/f.txt")], own_dir=mine), capture_output=True, text=True)
        sib = subprocess.run(sandboxed(["cat", str(other / "workspace/f.txt")], own_dir=mine), capture_output=True, text=True)
        assert own.returncode == 0 and own.stdout == "_test_mine"
        assert sib.returncode != 0 and "_test_other" not in sib.stdout
    finally:
        shutil.rmtree(mine, ignore_errors=True)
        shutil.rmtree(other, ignore_errors=True)


@pytest.mark.needs_sandbox
def test_agent_env_pwd_points_inside_sandbox(tmp_path: Path):
    """OpenCode lstat()s $PWD; an inherited PWD from the harness dir is denied (EPERM)."""
    import os
    from drive import agent_env, WORK_ROOT
    work = WORK_ROOT / "_test_pwd"
    ws = work / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    try:
        env = {**os.environ, **agent_env(work)}
        r = subprocess.run(sandboxed(["node", "-e", "require('fs').lstatSync(process.env.PWD)"], own_dir=work), cwd=ws, env=env,
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)


# ---- run conditions: benchmark only on AC power, no Low Power Mode, nominal thermals ----
from drive import parse_power

PMSET_BATT_AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t33%; charging; present: true\n"
PMSET_BATT_BATTERY = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging;\n"
PMSET_G_LPM_ON = " lowpowermode         1\n powermode            1\n"
PMSET_G_LPM_OFF = " powermode            0\n"


def test_on_ac_without_low_power_is_ok():
    assert parse_power(PMSET_BATT_AC, PMSET_G_LPM_OFF) == {"ac": True, "low_power": False}


def test_battery_is_flagged():
    assert parse_power(PMSET_BATT_BATTERY, PMSET_G_LPM_OFF)["ac"] is False


def test_low_power_mode_is_flagged():
    assert parse_power(PMSET_BATT_AC, PMSET_G_LPM_ON)["low_power"] is True


def test_condition_sampler_start_stop(monkeypatch):
    import drive
    monkeypatch.setattr(drive, "CONDITION_POLL_S", 0.01)
    monkeypatch.setattr(drive, "conditions", lambda: {"ac": False, "low_power": False, "thermal": "nominal"})
    s = drive.ConditionSampler()
    s.start()
    import time
    time.sleep(0.05)
    res = s.stop()
    assert res["degraded"] is True and res["samples"] >= 1


def test_opencode_error_event_is_detected_and_session_captured(tmp_path):
    from clients import OpenCodeClient, empty_state
    c, st = OpenCodeClient(tmp_path), empty_state()
    c.scan({"type": "step_start", "sessionID": "ses_1", "part": {}}, st)
    c.scan({"type": "error", "sessionID": "ses_1",
            "error": {"name": "UnknownError", "data": {"message": "already in flight"}}}, st)
    assert st["session"] == "ses_1" and "already in flight" in st["error"]


def test_resume_forks_into_a_new_session(tmp_path):
    """MTPLX wedges a session id after a stall; resuming must fork to a fresh id, not reuse it."""
    from clients import OpenCodeClient, PiClient
    oc = OpenCodeClient(tmp_path)
    cmd = oc.command("m", "go on", resume_from="ses_old")
    assert cmd[cmd.index("--session") + 1] == "ses_old" and "--fork" in cmd
    assert "--session" not in oc.command("m", "start")
    pi = PiClient(tmp_path)
    cmd = pi.command("m", "go on", resume_from="abc123")
    assert cmd[cmd.index("--fork") + 1] == "abc123"
    assert "--fork" not in pi.command("m", "start")


def test_thermal_throttling_is_reported_not_degraded():
    from drive import summarise_conditions
    hot = {"ac": True, "low_power": False, "thermal": "heavy"}
    r = summarise_conditions(4, [hot, hot])
    assert r["degraded"] is False and r["throttled_share"] == 0.5


def test_battery_is_degraded():
    from drive import summarise_conditions
    r = summarise_conditions(2, [{"ac": False, "low_power": False, "thermal": "nominal"}])
    assert r["degraded"] is True


def test_server_stats_windows_by_time_and_bands_context(tmp_path):
    import json
    from drive import server_stats
    log = tmp_path / "req.jsonl"
    rows = [
        {"logged_at_s": 100, "context_len": 5_000, "decode_tok_s": 90, "prompt_tokens": 4000, "completion_tokens": 100},
        {"logged_at_s": 200, "context_len": 70_000, "decode_tok_s": 40, "prompt_tokens": 69000, "completion_tokens": 50},
        {"logged_at_s": 900, "context_len": 5_000, "decode_tok_s": 10, "prompt_tokens": 1, "completion_tokens": 1},
    ]
    log.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    s = server_stats(log, 50, 500)
    assert s["requests"] == 2 and s["completion_tokens"] == 150 and s["max_context"] == 70_000
    assert s["decode_by_context"]["0-16k"]["decode_tok_s_median"] == 90
    assert s["decode_by_context"]["64-100k"]["decode_tok_s_median"] == 40
    assert server_stats(None, 0, 1) == {}


def test_mirror_is_committable_no_nested_git_or_spec(tmp_path):
    """The mirrored workspace goes into the outer repo: a nested .git becomes a broken gitlink."""
    import subprocess
    from drive import mirror
    ws = tmp_path / "ws"
    (ws / "src").mkdir(parents=True)
    (ws / "spec").mkdir()
    (ws / "src" / "a.ts").write_text("x")
    (ws / "spec" / "prd.md").write_text("spec")
    (ws / "node_modules").mkdir()
    subprocess.run(["git", "init", "-q"], cwd=ws, check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], cwd=ws, check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "story 1: x"], cwd=ws, check=True)
    dest = tmp_path / "out"
    mirror(ws, dest)
    assert (dest / "src" / "a.ts").exists()
    assert not (dest / ".git").exists() and not (dest / "spec").exists() and not (dest / "node_modules").exists()
    assert "story 1: x" in (dest.parent / "workspace-git-log.txt").read_text()


def test_compact_events_drops_stream_deltas(tmp_path):
    import gzip, json
    from drive import compact_events
    raw = tmp_path / "agent-events.jsonl"
    raw.write_text("\n".join(json.dumps(e) for e in [
        {"type": "session", "id": "s"}, {"type": "message_update", "delta": "x" * 100},
        {"type": "message_end", "message": {"role": "assistant"}}, "not json"]) + "\n")
    out = compact_events(raw)
    kept = [json.loads(l) for l in gzip.open(out, "rt")]
    assert [e["type"] for e in kept] == ["session", "message_end"]


def test_record_story_commits_only_the_run_dir_and_pushes(tmp_path):
    import subprocess
    from drive import record_story
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo = tmp_path / "repo"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True)
    (repo / "unrelated.txt").write_text("user's own uncommitted work")
    run = repo / "combos" / "x" / "benchmarks" / "vidi" / "r1"
    (run / "stories" / "01").mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    (run / "stories" / "01" / "agent-events.jsonl").write_text("huge raw log")
    (run / "work_dir.txt").write_text("/abs/path")
    res = record_story(repo, run, "vidi x r1: story 1 done", git=g)
    assert res["pushed"], res
    files = subprocess.run(["git", "--git-dir", str(remote), "show", "--name-only", "--format=%s", "main"],
                           capture_output=True, text=True).stdout
    assert "vidi x r1: story 1 done" in files and "metrics.json" in files
    assert "unrelated.txt" not in files and "agent-events.jsonl" not in files and "work_dir.txt" not in files


def test_record_story_rebases_when_remote_moved(tmp_path):
    import subprocess
    from drive import record_story
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo, other = tmp_path / "repo", tmp_path / "other"
    for d in (repo, other):
        subprocess.run(["git", "clone", "-q", str(remote), str(d)], check=True)
    (other / "elsewhere.md").write_text("someone else's commit")
    subprocess.run([*g, "add", "-A"], cwd=other, check=True)
    subprocess.run([*g, "commit", "-qm", "other"], cwd=other, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=other, check=True)
    subprocess.run([*g, "commit", "-q", "--allow-empty", "-m", "base"], cwd=repo, check=True)  # diverged history
    run = repo / "c" / "benchmarks" / "vidi" / "r"
    run.mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    (repo / "dirty.txt").write_text("uncommitted user work")
    res = record_story(repo, run, "story 1 done", git=g)
    assert res["pushed"], res
    assert (repo / "dirty.txt").read_text() == "uncommitted user work"



def test_record_story_after_the_remote_moved_never_stashes_or_rewrites_uncommitted_work(tmp_path):
    """1 Oct 2026: recording from a checkout where another process was editing files ran pull --rebase --autostash,
    which stashed that process's uncommitted work and wrote it back. The replay onto the remote now leaves every
    file the remote didn't change exactly as it was (same inode, same mtime), and never starts a rebase."""
    import os, subprocess
    from drive import record_story
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo, other = tmp_path / "repo", tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True)
    (repo / "app.ts").write_text("v1")
    subprocess.run([*g, "add", "-A"], cwd=repo, check=True)
    subprocess.run([*g, "commit", "-qm", "app"], cwd=repo, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=repo, check=True)
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
    (other / "elsewhere.md").write_text("another machine's record")
    subprocess.run([*g, "add", "-A"], cwd=other, check=True)
    subprocess.run([*g, "commit", "-qm", "other"], cwd=other, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=other, check=True)
    (repo / "app.ts").write_text("v2, being edited")              # tracked and modified: what autostash takes
    (repo / "new.ts").write_text("untracked work")
    before = {f: os.stat(repo / f) for f in ("app.ts", "new.ts")}
    run = repo / "c" / "benchmarks" / "vidi" / "r"
    run.mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    res = record_story(repo, run, "story 1 done", git=g)
    assert res["pushed"], res
    for f, st in before.items():
        now = os.stat(repo / f)
        assert (now.st_ino, now.st_mtime_ns) == (st.st_ino, st.st_mtime_ns), f"{f} was rewritten"
    assert (repo / "app.ts").read_text() == "v2, being edited"
    assert (repo / "elsewhere.md").read_text() == "another machine's record"     # the remote's change is checked out
    reflog = subprocess.run(["git", "reflog", "--format=%gs"], cwd=repo, capture_output=True, text=True).stdout
    assert "rebase" not in reflog and "autostash" not in reflog, reflog
    log = subprocess.run(["git", "log", "--format=%s", "main"], cwd=repo, capture_output=True, text=True).stdout.split()
    assert subprocess.run(["git", "--git-dir", str(remote), "rev-parse", "main"], capture_output=True, text=True).stdout == \
        subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout
    assert subprocess.run(["git", "status", "--porcelain", "--", "c"], cwd=repo, capture_output=True, text=True).stdout == ""


def test_record_story_leaves_the_checkout_alone_when_the_remote_changed_a_file_being_edited(tmp_path):
    """The remote changed a file this checkout has uncommitted edits to: nothing is overwritten and nothing moves;
    the story stays committed locally, reported unpushed, as with a conflicting remote."""
    import subprocess
    from drive import record_story
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo, other = tmp_path / "repo", tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True)
    (repo / "app.ts").write_text("v1")
    subprocess.run([*g, "add", "-A"], cwd=repo, check=True)
    subprocess.run([*g, "commit", "-qm", "app"], cwd=repo, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=repo, check=True)
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
    (other / "app.ts").write_text("v1, changed on the remote")
    subprocess.run([*g, "commit", "-qam", "other"], cwd=other, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=other, check=True)
    (repo / "app.ts").write_text("v2, being edited")
    run = repo / "c" / "benchmarks" / "vidi" / "r"
    run.mkdir(parents=True)
    (run / "metrics.json").write_text("{}")
    head_before = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout
    res = record_story(repo, run, "story 1 done", git=g)
    assert res["committed"] and not res["pushed"] and res.get("unpushed"), res
    assert (repo / "app.ts").read_text() == "v2, being edited"
    head = subprocess.run(["git", "log", "-1", "--format=%s"], cwd=repo, capture_output=True, text=True).stdout.strip()
    assert head == "story 1 done"
    parent = subprocess.run(["git", "rev-parse", "HEAD~1"], cwd=repo, capture_output=True, text=True).stdout
    assert parent == head_before                                   # not moved onto the remote


def test_record_story_survives_a_conflicting_remote_and_pushes_the_backlog_later(tmp_path):
    """The remote changed this run's own files (as the 24GB -> nvidia4090 rename did to the RTX 4090 machine's
    canvas-pi-02): the pull-and-rebase conflicts. The checkout must not be left mid-rebase, each
    story must still be committed locally and reported unpushed, and once the remote no longer
    conflicts the next story pushes the backlog."""
    import subprocess
    from drive import record_story
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo, other = tmp_path / "repo", tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True)
    rel = "c/benchmarks/vidi/r"
    run = repo / rel
    run.mkdir(parents=True)
    (run / "metrics.json").write_text('{"story": 1}')
    assert record_story(repo, run, "story 1 done", git=g)["pushed"]
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
    (other / rel / "metrics.json").write_text('{"changed": "elsewhere"}')
    subprocess.run([*g, "commit", "-qam", "someone else rewrites the run"], cwd=other, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=other, check=True)

    (repo / "todoodle-spec.md").write_text("a user's untracked work")
    in_rebase = lambda: any((repo / ".git" / d).exists() for d in ("rebase-merge", "rebase-apply"))
    for story in (2, 3):
        (run / "metrics.json").write_text(f'{{"story": {story}}}')
        res = record_story(repo, run, f"story {story} done", git=g)
        assert res["committed"] and not res["pushed"], res
        assert res.get("unpushed") and "conflict" in res["error"], res
        assert not in_rebase(), f"story {story} left the checkout mid-rebase"
        head = subprocess.run(["git", "log", "-1", "--format=%s"], cwd=repo, capture_output=True, text=True).stdout
        assert head.strip() == f"story {story} done"
        assert (repo / "todoodle-spec.md").read_text() == "a user's untracked work"

    subprocess.run([*g, "revert", "--no-edit", "HEAD"], cwd=other, check=True, capture_output=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=other, check=True)
    (run / "metrics.json").write_text('{"story": 4}')
    res = record_story(repo, run, "story 4 done", git=g)
    assert res["pushed"], res
    pushed = subprocess.run(["git", "--git-dir", str(remote), "log", "--format=%s", "main"],
                            capture_output=True, text=True).stdout
    assert all(f"story {n} done" in pushed for n in (2, 3, 4)), pushed


def test_record_story_clears_a_rebase_left_by_a_killed_harness(tmp_path):
    """A harness killed mid-rebase leaves the checkout in that state; committing into it would bury
    the story. The next recording aborts the stale rebase first."""
    import subprocess
    from drive import record_story
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo, other = tmp_path / "repo", tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True)
    rel = "c/benchmarks/vidi/r"
    (repo / rel).mkdir(parents=True)
    (repo / rel / "metrics.json").write_text('{"story": 1}')
    assert record_story(repo, repo / rel, "story 1 done", git=g)["pushed"]
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
    (other / rel / "metrics.json").write_text('{"theirs": 1}')
    subprocess.run([*g, "commit", "-qam", "theirs"], cwd=other, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=other, check=True)
    (repo / rel / "metrics.json").write_text('{"story": 2}')
    subprocess.run([*g, "commit", "-qam", "story 2 done"], cwd=repo, check=True)
    subprocess.run([*g, "pull", "-q", "--rebase", "origin", "main"], cwd=repo, capture_output=True)
    assert (repo / ".git" / "rebase-merge").exists() or (repo / ".git" / "rebase-apply").exists()

    (repo / rel / "notes.md").write_text("story 3")
    res = record_story(repo, repo / rel, "story 3 done", git=g)
    assert res["committed"], res
    assert not any((repo / ".git" / d).exists() for d in ("rebase-merge", "rebase-apply"))
    log = subprocess.run(["git", "log", "--format=%s"], cwd=repo, capture_output=True, text=True).stdout
    assert log.splitlines()[:2] == ["story 3 done", "story 2 done"], log


def test_tool_hang_guard_interrupts_only_a_silent_tool_call(tmp_path):
    """pi's bash tool has no default timeout; a backgrounded server holding its pipe hangs it forever."""
    import json, os, subprocess, time
    from drive import tool_hang_check
    ws = tmp_path / "workspace"
    ws.mkdir()
    events = tmp_path / "agent-events.jsonl"
    hung = subprocess.Popen(["/bin/sh", "-c", f"sleep 300; true # {ws}"])  # cmdline carries the workspace path
    bystander = subprocess.Popen(["/bin/sh", "-c", "sleep 300; true # elsewhere"])
    try:
        events.write_text(json.dumps({"type": "tool_execution_start", "toolName": "bash"}) + "\n")
        old = time.time() - 700
        os.utime(events, (old, old))
        assert tool_hang_check(events, ws, idle_s=600) is True
        time.sleep(0.5)
        assert hung.poll() is not None, "hung tool process should have been killed"
        assert bystander.poll() is None, "processes outside the workspace must be untouched"
        # A silent model generation (last event not a tool) is never interrupted.
        events.write_text(json.dumps({"type": "message_start"}) + "\n")
        os.utime(events, (old, old))
        assert tool_hang_check(events, ws, idle_s=600) is False
        # A recent tool event is not a hang.
        events.write_text(json.dumps({"type": "tool_execution_update"}) + "\n")
        assert tool_hang_check(events, ws, idle_s=600) is False
    finally:
        for p in (hung, bystander):
            p.kill()


@pytest.mark.needs_sandbox
def test_sandbox_allows_realpath_of_own_workspace():
    """wrangler/node resolve real paths by lstat()ing every ancestor. Denying the work root's
    own directory entry made `wrangler dev` fail inside the sandbox with EPERM (canvas-pi-01)."""
    import os, shutil
    from drive import WORK_ROOT
    work = WORK_ROOT / "_test_realpath"
    (work / "workspace" / "dist" / "client").mkdir(parents=True, exist_ok=True)
    try:
        js = ("const fs=require('fs');"
              f"console.log(fs.realpathSync({json.dumps(str(work / 'workspace' / 'dist' / 'client'))}));"
              f"fs.watch({json.dumps(str(work / 'workspace'))}).close();")
        r = subprocess.run(sandboxed(["node", "-e", js], own_dir=work), capture_output=True, text=True,
                           cwd=work / "workspace", env={**os.environ, "PWD": str(work / "workspace")})
        assert r.returncode == 0, r.stderr
        # ...while a sibling run's files stay unreadable.
        sib = WORK_ROOT / "_test_realpath_sibling"
        sib.mkdir(exist_ok=True)
        (sib / "secret.txt").write_text("x")
        r2 = subprocess.run(sandboxed(["cat", str(sib / "secret.txt")], own_dir=work), capture_output=True, text=True)
        assert r2.returncode != 0
        shutil.rmtree(sib, ignore_errors=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_kill_strays_catches_processes_by_working_directory(tmp_path):
    """canvas-pi-01 story 1: `node node_modules/vite/bin/vite.js preview` (relative path, cwd in the
    workspace) survived kill_strays and held port 8787 through the gate's e2e run."""
    import subprocess, time
    from drive import kill_strays
    ws = tmp_path / "workspace"
    ws.mkdir()
    by_cwd = subprocess.Popen(["/bin/sh", "-c", "sleep 300; true"], cwd=ws)          # no path in its cmdline
    by_cmd = subprocess.Popen(["/bin/sh", "-c", f"sleep 300; true # {ws}"])
    bystander = subprocess.Popen(["/bin/sh", "-c", "sleep 300; true"], cwd=tmp_path)
    try:
        time.sleep(0.3)
        kill_strays(ws)
        time.sleep(0.5)
        assert by_cwd.poll() is not None, "process running in the workspace must be killed"
        assert by_cmd.poll() is not None
        assert bystander.poll() is None
    finally:
        for p in (by_cwd, by_cmd, bystander):
            p.kill()


def test_hang_guard_kills_a_tool_child_that_left_the_workspace(tmp_path):
    """canvas-mlx-02 story 7 (the M5 Max): the agent ran `cd <ws> && ...; find / ...`. find changed
    directory as it walked the disk and has no workspace path in its command line, so killing only
    matching processes left it running, holding the tool's output pipe, and the story froze for 3 h
    through 367 "interrupts". The guard must kill the tool's whole process group."""
    import json as _json, os, subprocess, time
    from drive import tool_hang_check
    ws = tmp_path / "workspace"
    ws.mkdir()
    # pi starts each bash tool call in its own session; the child leaves the workspace.
    # The trailing `; true` keeps the shell as the child's parent: a newer bash (5.2 on the CI runner, 5.3) runs
    # the last command of a -c list in place of the shell (no fork), which leaves no child and no process
    # naming the workspace. macOS's bash 3.2 always forks.
    tool = subprocess.Popen(["/bin/bash", "-c", f"cd {ws} && true; python3 -c "
                             "'import os,time; os.chdir(\"/\"); time.sleep(300)'; true"],
                            start_new_session=True, stdout=subprocess.PIPE)
    events = tmp_path / "agent-events.jsonl"
    events.write_text(_json.dumps({"type": "tool_execution_start"}) + "\n")
    old = time.time() - 700
    os.utime(events, (old, old))
    try:
        time.sleep(1)
        child = subprocess.run(["pgrep", "-P", str(tool.pid)], capture_output=True, text=True).stdout.split()
        assert child, "the tool's child should be running"
        assert tool_hang_check(events, ws, idle_s=600)
        time.sleep(1)
        alive = subprocess.run(["ps", "-p", child[0]], capture_output=True).returncode == 0
        assert tool.poll() is not None and not alive, "the tool and everything it started must be killed"
    finally:
        try:
            os.killpg(tool.pid, 9)
        except ProcessLookupError:
            pass


# A stand-in for the agent: its own session (as the harness starts it), a tool started in another session (as pi
# starts each bash tool call), the tool's pid printed, then it waits.
FAKE_AGENT = """
import subprocess, sys, time
tool = subprocess.Popen(["/bin/bash", "-c", sys.argv[1]], start_new_session=True, stdout=subprocess.DEVNULL)
print(tool.pid, flush=True)
time.sleep(300)
"""


def test_hang_guard_kills_a_tool_that_replaced_its_shell_and_left_the_workspace(tmp_path, monkeypatch):
    """The case above, as a newer bash runs it (5.2 on the CI runner, 5.3 from Homebrew): the last command of
    `bash -c "cd <ws> && ...; find / ..."` is run in place of the shell, with no fork. There is then no shell
    left whose command line names the workspace, and the tool itself has left it: `exec` makes any bash do that.
    The guard can't find it by path; it is still something the agent started, outside the agent's own process
    group, and is found and killed as that. The agent itself is left running."""
    import json as _json, os, signal, subprocess, sys, time
    import drive
    ws = tmp_path / "workspace"
    ws.mkdir()
    script = f"cd {ws} && true; exec python3 -c 'import os,time; os.chdir(\"/\"); time.sleep(300)'"
    agent = subprocess.Popen([sys.executable, "-c", FAKE_AGENT, script], start_new_session=True,
                             stdout=subprocess.PIPE, text=True)
    tool = int(agent.stdout.readline())
    events = tmp_path / "agent-events.jsonl"
    events.write_text(_json.dumps({"type": "tool_execution_start"}) + "\n")
    old = time.time() - 700
    os.utime(events, (old, old))
    # Gone, or a zombie its parent hasn't reaped ("Z" on macOS; "Zs" on Linux for a session leader).
    state = lambda pid: subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True).stdout.strip()
    alive = lambda pid: state(pid) != "" and not state(pid).startswith("Z")
    monkeypatch.setattr(drive, "AGENT_ROOT_PID", agent.pid, raising=False)
    try:
        time.sleep(1)
        assert alive(tool), "the tool should be running"
        assert drive.tool_hang_check(events, ws, idle_s=600)
        time.sleep(1)
        assert not alive(tool), "the tool must be killed"
        assert agent.poll() is None, "the agent must be left running"
    finally:
        for pid in (tool, agent.pid):
            try:
                os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass


def test_hang_guard_is_not_fooled_by_a_workspace_path_that_names_a_client(tmp_path):
    """Combination directories are named after their client (mlxserve-opencode), so the workspace
    path itself contains "opencode". Every tool process carrying the path looked like the agent and
    was spared: the guard on the M5 Max never killed anything."""
    import json as _json, os, subprocess, time
    from drive import tool_hang_check
    ws = tmp_path / "qwen__flash-next__mlxserve-opencode__canvas" / "workspace"
    ws.mkdir(parents=True)
    tool = subprocess.Popen(["/bin/sh", "-c", f"sleep 300; true # {ws}"], start_new_session=True)
    events = tmp_path / "agent-events.jsonl"
    events.write_text(_json.dumps({"type": "tool_execution_start"}) + "\n")
    old = time.time() - 700
    os.utime(events, (old, old))
    try:
        time.sleep(0.3)
        assert tool_hang_check(events, ws, idle_s=600)
        time.sleep(1)
        assert tool.poll() is not None, "a tool process must not be mistaken for the agent"
    finally:
        try:
            os.killpg(tool.pid, 9)
        except ProcessLookupError:
            pass


def test_agent_home_has_playwright_browsers_where_playwright_looks_by_default(tmp_path, monkeypatch):
    """canvas-mlx-02 story 7: the agent looked for browsers in ~/Library/Caches/ms-playwright, found
    nothing (HOME is the sandbox home) and searched the whole disk. PLAYWRIGHT_BROWSERS_PATH points
    to the agents' cache; the default location in the agent's home must lead there too."""
    import drive, hostenv
    real = tmp_path / "real-home"
    (real / ".cache" / "vidi-agent-ms-playwright" / "chromium-1").mkdir(parents=True)
    monkeypatch.setattr(drive.Path, "home", classmethod(lambda cls: real))
    env = drive.agent_env(tmp_path / "run")
    default = hostenv.playwright_cache(drive.Path(env["HOME"]))
    assert (default / "chromium-1").is_dir(), default
    assert default.resolve() == drive.Path(env["PLAYWRIGHT_BROWSERS_PATH"]).resolve()
    drive.agent_env(tmp_path / "run")      # idempotent on a resumed run


def test_hang_guard_spares_the_agent_whose_cwd_is_the_workspace(tmp_path):
    import json as _json, os, subprocess, time
    from drive import tool_hang_check, kill_strays
    ws = tmp_path / "workspace"
    ws.mkdir()
    # one process, like pi itself (its tool children are separate processes)
    agent = subprocess.Popen(["python3", "-c", "import time; time.sleep(300)", "pi-coding-agent/dist/cli.js"], cwd=ws)
    tool = subprocess.Popen(["/bin/sh", "-c", "sleep 300; true"], cwd=ws)
    events = tmp_path / "agent-events.jsonl"
    events.write_text(_json.dumps({"type": "tool_execution_start"}) + "\n")
    old = time.time() - 700
    os.utime(events, (old, old))
    try:
        time.sleep(0.3)
        assert tool_hang_check(events, ws, idle_s=600)
        time.sleep(0.5)
        assert tool.poll() is not None and agent.poll() is None, "guard must kill the tool, not the agent"
        kill_strays(ws)          # after the story, everything in the workspace goes
        time.sleep(0.5)
        assert agent.poll() is not None
    finally:
        for p in (agent, tool):
            p.kill()


def test_needs_nudge_only_when_agent_quit_without_committing():
    """canvas-pi-01 story 2: the model ended a turn with reasoning only, pi exited 0 after 3 minutes, no commit."""
    from drive import needs_nudge
    clean = {"stalled": False, "error": None, "session": "s1"}
    assert needs_nudge(clean, commits=0) is True
    assert needs_nudge(clean, commits=2) is False                      # it committed: trust it finished
    assert needs_nudge({**clean, "stalled": True}, commits=0) is False  # loops are not nudged
    assert needs_nudge({**clean, "error": "boom"}, commits=0) is False  # errors go through fork-resume
    assert needs_nudge({**clean, "session": None}, commits=0) is False  # nothing to continue


def test_continue_uses_the_same_session_not_a_fork(tmp_path):
    from clients import PiClient, OpenCodeClient
    pi = PiClient(tmp_path).command("m", "go on", resume_from="abc", fork=False)
    assert pi[pi.index("--session") + 1] == "abc" and "--fork" not in pi
    oc = OpenCodeClient(tmp_path).command("m", "go on", resume_from="ses", fork=False)
    assert oc[oc.index("--session") + 1] == "ses" and "--fork" not in oc


def test_make_publishable_redacts_home_and_leaves_event_logs_whole(tmp_path):
    """tests/privacy-test.sh: no /Users/<name> paths may be committed. The conversation log is published whole
    (item 4, 30 Sep 2026): nothing truncated; its own cap is drive.EVENT_LOG_MAX_BYTES (test_recording.py)."""
    import gzip, json as _json
    from pathlib import Path as _P
    from drive import make_publishable, compact_events, EVENT_LOG_MAX_BYTES
    home = str(_P.home())
    run = tmp_path / "run"
    (run / "stories" / "01").mkdir(parents=True)
    (run / "metrics.json").write_text(_json.dumps({"tail": f"error at {home}/.vidi-bench/work/x"}))
    raw = run / "stories" / "01" / "agent-events.jsonl"
    big = "x" * 50_000
    raw.write_text("\n".join(_json.dumps({"type": "message_end", "path": f"{home}/w", "content": big}) for _ in range(60)))
    gz = compact_events(raw)
    (run / "superseded").mkdir()
    (run / "superseded" / "agent-events.jsonl").write_text(raw.read_text())
    (run / "work_dir.txt").write_text(f"{home}/.vidi-bench/work/x")
    make_publishable(run)
    assert (run / "work_dir.txt").read_text() == f"{home}/.vidi-bench/work/x"   # local-only file untouched
    assert home not in (run / "metrics.json").read_text() and "~/.vidi-bench" in (run / "metrics.json").read_text()
    text = gzip.open(gz, "rt").read()
    assert home not in text and "truncated" not in text and text.count(big) == 60
    assert gz.stat().st_size < EVENT_LOG_MAX_BYTES
    assert not (run / "superseded" / "agent-events.jsonl").exists()          # raw log replaced by its compact form
    assert (run / "superseded" / "agent-events.compact.jsonl.gz").exists()


def test_parse_swap_used():
    from drive import parse_swap_gb
    assert parse_swap_gb("total = 22528.00M  used = 21304.88M  free = 1223.12M  (encrypted)") == 21304.88 / 1024
    assert parse_swap_gb("total = 0.00M  used = 0.00M  free = 0.00M") == 0.0


def test_sampler_aborts_when_swap_grows(monkeypatch):
    """A leak that pushes the Mac into swap preceded the 24 Sep kernel panic; stop before that."""
    import time, drive
    monkeypatch.setattr(drive, "CONDITION_POLL_S", 0.01)
    killed = []
    monkeypatch.setattr(drive, "kill_pids", lambda pids: killed.append(pids))
    monkeypatch.setattr(drive, "workspace_pids", lambda ws, spare_agent=False: {123})
    swaps = iter([1.0] + [1.0 + drive.SWAP_ABORT_GROWTH_GB + 0.5] * 1000)
    monkeypatch.setattr(drive, "swap_used_gb", lambda: next(swaps))
    monkeypatch.setattr(drive, "conditions", lambda: {"ac": True, "low_power": False, "thermal": "nominal"})
    s = drive.ConditionSampler(ws=drive.Path("/tmp/ws"))
    s.start()
    time.sleep(0.1)
    res = s.stop()
    assert res["aborted_swap"] and s.aborted.is_set() and killed and drive.RUN_ABORT.is_set()
    drive.RUN_ABORT.clear()


def test_nudges_are_unlimited_but_stop_when_a_nudge_makes_no_progress():
    """keep_nudging is about progress only. The story-level cap (25 Sep: 4 h or 5 nudges) is cap_reason's."""
    from drive import keep_nudging
    progressing = {"stalled": False, "error": None, "session": "s", "steps": 5, "tool_calls": 4}
    assert keep_nudging(progressing, commits=0, nudges=50) is True          # no cap
    assert keep_nudging(progressing, commits=1, nudges=0) is False          # it committed
    assert keep_nudging({**progressing, "steps": 0}, commits=0, nudges=3) is False  # no progress on a nudge


def test_a_nudge_answered_without_any_tool_call_is_no_progress():
    """canvas-pi-01 story 11 (25 Sep): 3,066 nudges each answered "Nothing left to do." with no tool
    call and no commit. A reply is a model call but not progress; the story must end instead."""
    from drive import keep_nudging
    talked_only = {"stalled": False, "error": None, "session": "s", "steps": 1, "tool_calls": 0}
    assert keep_nudging(talked_only, commits=0, nudges=1) is False
    assert keep_nudging(talked_only, commits=0, nudges=0) is True   # the first stop still gets a nudge


def test_last_session_is_found_so_a_restarted_story_continues_it(tmp_path):
    """After a harness restart mid-story, continue the agent's own session instead of starting over."""
    import json as _json
    from drive import last_session
    from clients import PiClient
    ev = tmp_path / "agent-events.jsonl"
    ev.write_text("\n".join(_json.dumps(e) for e in [
        {"type": "session", "id": "first"}, {"type": "message_update"},
        {"type": "session", "id": "second"}, {"type": "tool_execution_start", "toolName": "bash", "args": {}}]))
    assert last_session(PiClient(tmp_path), ev) == "second"
    assert last_session(PiClient(tmp_path), tmp_path / "missing.jsonl") is None


def test_parse_footprint_reads_current_and_peak():
    from drive import parse_footprint_gb
    out = ("Python [58822]: 64-bit    Footprint: 92 GB (16384 bytes per page)\n"
           "    phys_footprint: 92 GB\n    phys_footprint_peak: 99 GB\n")
    assert parse_footprint_gb(out) == (92.0, 99.0)
    assert parse_footprint_gb("    phys_footprint: 1264 KB\n    phys_footprint_peak: 512 MB\n") == (1264 / 1024 ** 2, 0.5)
    assert parse_footprint_gb("") == (None, None)


def test_sampler_aborts_when_free_memory_runs_out(monkeypatch):
    """The external watchdog's free-memory stop, now inside the harness (24 Sep design: no operator loop)."""
    import time, drive
    monkeypatch.setattr(drive, "CONDITION_POLL_S", 0.01)
    killed = []
    monkeypatch.setattr(drive, "kill_pids", lambda pids: killed.append(pids))
    monkeypatch.setattr(drive, "workspace_pids", lambda ws, spare_agent=False: {123})
    monkeypatch.setattr(drive, "swap_used_gb", lambda: 1.0)
    monkeypatch.setattr(drive, "mem_free_pct", lambda: drive.MEM_FREE_ABORT_PCT - 1)
    monkeypatch.setattr(drive, "conditions", lambda: {"ac": True, "low_power": False, "thermal": "nominal"})
    s = drive.ConditionSampler(ws=drive.Path("/tmp/ws"))
    s.start()
    time.sleep(0.1)
    res = s.stop()
    assert res["aborted_memory"] and killed and drive.RUN_ABORT.is_set()
    assert res["free_min_pct"] == drive.MEM_FREE_ABORT_PCT - 1
    drive.RUN_ABORT.clear()



def test_sampler_records_what_held_memory_at_its_lowest(monkeypatch):
    """When free memory falls below MEM_SNAPSHOT_PCT, the processes holding it are recorded at the
    lowest point, whether or not the guard then fires."""
    import time, drive
    monkeypatch.setattr(drive, "CONDITION_POLL_S", 0.01)
    monkeypatch.setattr(drive, "swap_used_gb", lambda: 1.0)
    readings = iter([50.0, drive.MEM_SNAPSHOT_PCT - 1, drive.MEM_SNAPSHOT_PCT - 5, drive.MEM_SNAPSHOT_PCT - 2])
    monkeypatch.setattr(drive, "mem_free_pct", lambda: next(readings, drive.MEM_SNAPSHOT_PCT - 2))
    monkeypatch.setattr(drive, "conditions", lambda: {"ac": True, "low_power": False, "thermal": "nominal"})
    calls = []
    monkeypatch.setattr(drive.hostenv, "memory_snapshot", lambda: calls.append(1) or {"processes": [len(calls)]})
    s = drive.ConditionSampler()
    s.start()
    time.sleep(0.1)
    res = s.stop()
    assert res["memory_snapshot"]["free_pct"] == drive.MEM_SNAPSHOT_PCT - 5
    assert res["memory_snapshot"]["processes"] == [2]   # taken at the second low, the lowest; not retaken after
    assert not res["aborted_memory"]


def test_sampler_records_nothing_when_memory_is_plentiful(monkeypatch):
    import time, drive
    monkeypatch.setattr(drive, "CONDITION_POLL_S", 0.01)
    monkeypatch.setattr(drive, "swap_used_gb", lambda: 1.0)
    monkeypatch.setattr(drive, "mem_free_pct", lambda: 60.0)
    monkeypatch.setattr(drive, "conditions", lambda: {"ac": True, "low_power": False, "thermal": "nominal"})
    s = drive.ConditionSampler()
    s.start()
    time.sleep(0.05)
    assert s.stop()["memory_snapshot"] is None

def test_unmonitored_thermal_is_fit_and_not_throttled():
    """A Linux host with no thermal source must neither block every story nor count as throttled."""
    from drive import conditions_ok, summarise_conditions
    c = {"ac": True, "low_power": False, "thermal": "unmonitored"}
    assert conditions_ok(c)
    assert summarise_conditions(2, [])["throttled_share"] == 0.0


@pytest.mark.needs_sandbox
def test_private_pack_checkout_is_hidden_from_the_agent(tmp_path):
    """Moving the held-out suite out of the public repo must not make it readable: the sandbox
    hides the private checkout exactly as it hides the repo."""
    import subprocess
    from drive import PACK, sandboxed
    from packdir import private_root
    root = private_root(PACK)
    if root is None:
        import pytest
        pytest.skip("pack is in-repo; covered by the repo-hiding test")
    own = tmp_path / "work" / "run"
    own.mkdir(parents=True)
    r = subprocess.run(sandboxed(["ls", str(PACK / "acceptance")], own_dir=own), capture_output=True, text=True)
    assert r.returncode != 0 or not r.stdout.strip(), r.stdout


@pytest.mark.needs_sandbox
def test_dbench_home_is_hidden_except_its_tools(tmp_path, outside_shared_temp, monkeypatch):
    """Agents under dbench must not reach its jobs, token, repo checkouts or other runs' builds,
    but must still run the tools installed in ~/.dbench/tools (pi, uv)."""
    import subprocess
    import drive
    # Like the real ~/.dbench, not under /tmp: there (tmp_path on Linux) the sandbox's own /tmp covers it, tools and all.
    dbench = outside_shared_temp / "dotdbench"
    (dbench / "jobs").mkdir(parents=True)
    (dbench / "jobs" / "job.json").write_text("secret")
    (dbench / "tools" / "bin").mkdir(parents=True)
    (dbench / "tools" / "bin" / "tool.txt").write_text("usable")
    monkeypatch.setattr(drive, "SANDBOX_DENY", [*drive.SANDBOX_DENY, dbench])
    monkeypatch.setattr(drive, "SANDBOX_REOPEN_RO", [dbench / "tools"])
    own = tmp_path / "work" / "run"
    own.mkdir(parents=True)
    secret = subprocess.run(drive.sandboxed(["cat", str(dbench / "jobs" / "job.json")], own_dir=own), capture_output=True, text=True)
    tool = subprocess.run(drive.sandboxed(["cat", str(dbench / "tools" / "bin" / "tool.txt")], own_dir=own), capture_output=True, text=True)
    assert secret.returncode != 0 and "secret" not in secret.stdout
    assert tool.returncode == 0 and tool.stdout == "usable"


def test_reference_runs_get_distinct_labels_and_work_dirs():
    """Runs outside combinations/ (reference stacks) must not share a work dir by run name alone."""
    from drive import REPO_ROOT, WORK_ROOT, combination_label, work_dir_for
    a = REPO_ROOT / "benchmarks" / "reference" / "vidi" / "opus-5.5" / "run-2"
    b = REPO_ROOT / "benchmarks" / "reference" / "vidi" / "sonnet-5" / "run-2"
    assert combination_label(a) == "reference/opus-5.5"
    assert work_dir_for(a) != work_dir_for(b) and work_dir_for(a).parent == WORK_ROOT
    local = REPO_ROOT / "combinations" / "qwen" / "3.8" / "27b" / "ubuntu" / "nvidia4090" / "llamacpp-pi" / "benchmarks" / "vidi" / "canvas-pi-03"
    assert combination_label(local) == "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi"


def test_agent_browsers_are_kept_apart_from_the_held_out_suites(tmp_path: Path):
    # `npx playwright install` deletes browsers no visible project uses. In the sandbox the suite's
    # folder is hidden, so an agent on another Playwright version deleted the suite's browser
    # (opus-5.5 run-2 stories 3-8 on the M2). The agent must never share the suite's browser cache.
    from drive import agent_env
    import hostenv
    env = agent_env(tmp_path / "work")
    suite_cache = hostenv.playwright_cache(Path.home())
    agent_cache = Path(env["PLAYWRIGHT_BROWSERS_PATH"])
    assert agent_cache != suite_cache
    assert suite_cache not in agent_cache.parents and agent_cache not in suite_cache.parents


@pytest.mark.needs_sandbox
def test_sandbox_blocks_the_held_out_suites_browsers(tmp_path: Path):
    import hostenv
    suite_cache = hostenv.playwright_cache(Path.home())
    if not suite_cache.is_dir():
        pytest.skip("no Playwright browsers installed on this machine")
    own = tmp_path / "run"
    (own / "workspace").mkdir(parents=True)
    r = subprocess.run(sandboxed(["ls", str(suite_cache)], own_dir=own), capture_output=True, text=True)
    rm = subprocess.run(sandboxed(["touch", str(suite_cache / "agent-was-here")], own_dir=own),
                        capture_output=True, text=True)
    if hostenv.IS_MAC:
        # sandbox-exec refuses the read and the write.
        assert r.returncode != 0 and rm.returncode != 0
    else:
        # bwrap covers the folder with an empty tmpfs: it lists, as empty, and a write lands in the tmpfs.
        assert r.stdout.strip() == ""
    assert "chromium" not in r.stdout
    assert not (suite_cache / "agent-was-here").exists()


@pytest.mark.needs_sandbox
def test_sandbox_hides_all_bench_state_but_the_agents_own_run():
    # Everything under the bench home (grading keys, reference builds and transcripts, logs, other
    # runs) is out of bounds; a reference build left readable once exposed Opus's whole solution.
    from drive import BENCH_HOME, WORK_ROOT
    import shutil
    mine = WORK_ROOT / "_test_mine2"
    secret = BENCH_HOME / "_test_secret"
    try:
        (mine / "workspace").mkdir(parents=True, exist_ok=True)
        (mine / "workspace" / "f.txt").write_text("mine")
        secret.mkdir(parents=True, exist_ok=True)
        (secret / "key.json").write_text("the answer")
        own = subprocess.run(sandboxed(["cat", str(mine / "workspace/f.txt")], own_dir=mine), capture_output=True, text=True)
        leak = subprocess.run(sandboxed(["cat", str(secret / "key.json")], own_dir=mine), capture_output=True, text=True)
        listing = subprocess.run(sandboxed(["ls", str(BENCH_HOME)], own_dir=mine), capture_output=True, text=True)
        assert own.returncode == 0 and own.stdout == "mine"
        assert leak.returncode != 0 and "the answer" not in leak.stdout
        assert "_test_secret" not in listing.stdout
    finally:
        shutil.rmtree(mine, ignore_errors=True)
        shutil.rmtree(secret, ignore_errors=True)


def test_a_story_is_capped_at_4_hours_or_5_nudges():
    """User decision (25 Sep): across 51 finished stories none took over 3.84 h and none that needed
    nudging needed more than 3; Flash-Next canvas-pi-02 story 5 ran 7.5 h and 20 nudges uncommitted."""
    from drive import cap_reason, MAX_STORY_AGENT_S, MAX_NUDGES
    assert (MAX_STORY_AGENT_S, MAX_NUDGES) == (4 * 3600, 5)
    assert cap_reason(MAX_STORY_AGENT_S - 1, MAX_NUDGES - 1) is None
    assert "4.0 h" in cap_reason(MAX_STORY_AGENT_S, 0)
    assert "5 nudges" in cap_reason(60, MAX_NUDGES)


def test_the_time_cap_ends_the_running_story_like_an_operator_skip(tmp_path):
    import drive
    clock = [1000.0]
    w = drive.SkipWatcher(tmp_path, 5, tmp_path, now=lambda: clock[0], poll_s=0.01)
    try:
        clock[0] += drive.MAX_STORY_AGENT_S
        w.start()
        w.join(timeout=5)
        req = w.stop()
        assert req and req["story"] == 5 and req["by"] == "harness (cap)" and "4.0 h" in req["reason"]
        assert drive.STORY_SKIP.is_set()
    finally:
        drive.STORY_SKIP.clear()


def test_the_nudge_cap_ends_the_story_after_the_fifth_nudge(tmp_path, monkeypatch):
    import drive
    clean = {"stalled": False, "error": None, "session": "s", "steps": 3, "tool_calls": 2, "exit": 0,
             "seconds": 60, "compactions": 0, "tokens": {"input": 1, "output": 1}}
    monkeypatch.setattr(drive, "run_agent", lambda *a, **k: dict(clean))
    monkeypatch.setattr(drive, "commits_since", lambda ws, head: 0)
    monkeypatch.setattr(drive, "sh", lambda *a, **k: "HEAD")

    class NoGuard:
        def __init__(self, *a): pass
        def start(self): pass
        def stop(self): return 0
    monkeypatch.setattr(drive, "ToolHangGuard", NoGuard)
    capped = []
    res = drive.run_story_agent(None, tmp_path, {}, "m", "go", tmp_path / "ev.jsonl", on_cap=capped.append)
    assert res["nudges"] == drive.MAX_NUDGES
    assert len(capped) == 1 and "5 nudges" in capped[0]



def test_a_no_commit_nudge_says_the_work_must_be_committed_and_other_resumes_do_not(tmp_path, monkeypatch):
    """gufo v2-r4 story 4 (1 Oct 2026): the agent finished, never committed, and was told five times only to
    "continue from where you left off"; each time it answered that nothing was left, and 33 agent-minutes and the
    story's DONE went on it. The no-commit nudge now says what is missing; a resume after an error and the
    continuation after a harness restart keep the plain prompt."""
    import drive
    assert "commit" in drive.NUDGE_PROMPT.lower() and "hash" in drive.NUDGE_PROMPT.lower()
    assert drive.NUDGE_PROMPT.startswith("Continue") and "commit" not in drive.RESUME_PROMPT.lower()
    prompts = []
    clean = {"stalled": False, "error": None, "session": "s", "steps": 3, "tool_calls": 2, "exit": 0,
             "seconds": 60, "compactions": 0, "tokens": {"input": 1, "output": 1}}
    replies = iter([dict(clean), {**clean, "error": "boom"}, dict(clean)])

    def fake_run(client, ws, env, model_id, prompt, events_path, **k):
        prompts.append(prompt)
        return next(replies)
    commits = iter([0, 1])                             # asked after each clean stop: no commit, then committed
    monkeypatch.setattr(drive, "run_agent", fake_run)
    monkeypatch.setattr(drive, "commits_since", lambda ws, head: next(commits))
    monkeypatch.setattr(drive, "sh", lambda *a, **k: "HEAD")
    monkeypatch.setattr(drive, "RESUME_BACKOFF_S", 0)

    class NoGuard:
        def __init__(self, *a): pass
        def start(self): pass
        def stop(self): return 0
    monkeypatch.setattr(drive, "ToolHangGuard", NoGuard)
    res = drive.run_story_agent(None, tmp_path, {}, "m", "the story", tmp_path / "ev.jsonl")
    assert prompts == ["the story", drive.NUDGE_PROMPT, drive.RESUME_PROMPT]
    assert res["nudges"] == 1 and res["resumes"] == 1


def test_missing_resources_stop_the_run_with_their_own_exit_code_and_reason(capsys):
    """A machine that can't run the tests must stop the run, not score story after story against
    nothing, and say why in a line dbench can show (run.sh's last stderr lines, the job log)."""
    import drive
    import gates
    fault = f"{gates.MISSING_RESOURCES} the agent's e2e tests have no browser (browser not installed)"
    for gate, acc in (({"harness_fault": fault}, {}), ({}, {"harness_fault": fault})):
        with pytest.raises(SystemExit) as e:
            drive.stop_if_missing_resources(3, gate, acc)
        assert e.value.code == drive.EXIT_MISSING_RESOURCES
        err = capsys.readouterr().err
        assert err.startswith("MISSING RESOURCES") and "browser not installed" in err and "story 3" in err.lower()
    drive.stop_if_missing_resources(3, {"all_green": False}, {"passed": 0})   # app failures carry on


def test_interrupted_scoring_stops_the_run_and_says_so(capsys):
    import drive
    import gates
    fault = f"{gates.SCORING_INTERRUPTED} the held-out suite was killed by signal 15 before writing a report"
    with pytest.raises(SystemExit) as e:
        drive.stop_if_missing_resources(5, {}, {"harness_fault": fault})
    assert e.value.code == drive.EXIT_MISSING_RESOURCES
    err = capsys.readouterr().err
    assert err.startswith("SCORING INTERRUPTED: the held-out suite was killed by signal 15"), err


def test_each_agent_event_is_stamped_with_its_arrival_time():
    """pi's events carry no times of their own for tool runs; the harness stamps them as they arrive."""
    import drive
    line = '{"type":"tool_execution_start","toolCallId":"a"}\n'
    stamped = json.loads(drive.stamp(line, 1790390000.25))
    assert stamped["_rx"] == 1790390000.25 and stamped["toolCallId"] == "a"
    assert drive.stamp("not json\n", 1.0) == "not json\n"
    assert json.loads(drive.stamp("{}\n", 1.0)) == {"_rx": 1.0}


def test_time_split_puts_the_story_s_wall_time_into_model_tools_and_compaction(tmp_path):
    import drive
    import llama_log
    t0 = 1790390000.0
    ev = [{"type": "tool_execution_start", "toolCallId": "a", "toolName": "bash", "args": {"command": "npx playwright test"}, "_rx": t0 + 10},
          {"type": "tool_execution_end", "toolCallId": "a", "toolName": "bash", "_rx": t0 + 70},
          {"type": "tool_execution_start", "toolCallId": "b", "toolName": "read", "_rx": t0 + 80},
          {"type": "tool_execution_end", "toolCallId": "b", "toolName": "read", "_rx": t0 + 81},
          {"type": "compaction_start", "_rx": t0 + 100},
          {"type": "compaction_end", "_rx": t0 + 400}]
    events = tmp_path / "agent-events.jsonl"
    events.write_text("".join(drive.stamp(json.dumps({k: v for k, v in e.items() if k != "_rx"}) + "\n", e["_rx"])
                              for e in ev))
    log = tmp_path / "server.log"
    log.write_text(llama_log.start_marker(t0) +
                   "0.09.000.000 I slot print_timing: id  0 | task 0 | prompt eval time =  4000.00 ms /  1000 tokens (x)\n"
                   "0.09.000.001 I slot print_timing: id  0 | task 0 |        eval time =  5000.00 ms /   150 tokens (x)\n")
    s = drive.time_split(events, log, t0, t0 + 500)
    assert s["wall_s"] == 500 and s["tools_s"] == 61 and s["compaction_s"] == 300
    assert s["tools_by_kind"]["e2e"] == 60 and s["model"]["prefill_s"] == 4.0 and s["model"]["decode_s"] == 5.0
    assert s["other_s"] == 500 - 61 - 300 - 9.0
    assert drive.time_split(tmp_path / "none.jsonl", tmp_path / "none.log", t0, t0 + 1)["model"] is None


def test_a_cut_off_event_line_does_not_crash_the_end_of_a_story(tmp_path):
    """A story ended by the cap, a skip or the hang guard kills pi mid-line; a panic truncates the log.
    Reading the stamped events at story end must skip the broken line, not crash before the record
    is saved (a restart would then crash on the same line, story after story)."""
    import json as _json
    from drive import _stamped_events
    log = tmp_path / "agent-events.jsonl"
    good = [{"_rx": 1.0, "type": "message_end"}, {"_rx": 3.0, "type": "tool_execution_start"}]
    log.write_text(_json.dumps(good[0]) + "\n" + '{"_rx": 2.0, "type": "message_end", "message": {"content": "cut of\n'
                   + _json.dumps(good[1]) + "\n")
    assert [e["_rx"] for e in _stamped_events(log)] == [1.0, 3.0]


LEAKED_CALL = ("<tool_call>\n<function=edit>\n<parameter=path>\nsrc/a.tsx\n</parameter>\n"
               "<parameter=edits>\n[{\"oldText\": \"a,\n  b\", \"newText\": \"a,\n  c\"}]\n</parameter>\n"
               "</function>\n</tool_call>")


def _event(role, *parts):
    return json.dumps({"type": "message_end", "message": {"role": role, "content": list(parts)}}) + "\n"


def test_the_final_reply_is_the_last_assistant_messages_text(tmp_path):
    import drive
    ev = tmp_path / "ev.jsonl"
    ev.write_text(_event("assistant", {"type": "text", "text": "first"})
                  + _event("assistant", {"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": LEAKED_CALL})
                  + _event("toolResult", {"type": "text", "text": "not this"}) + "not json\n")
    assert drive.final_reply_text(ev) == LEAKED_CALL
    assert drive.final_reply_text(tmp_path / "missing.jsonl") == ""


# Claude Code's record of a tool call it refused: its "message" is a string, not a model message (from Sonnet 5.5
# v2-r1 story 9, 1 Oct 2026, the sandbox having hidden /tmp).
PERMISSION_DENIED = {"_rx": 1790822953.124, "type": "system", "subtype": "permission_denied", "tool_name": "Write",
                     "tool_use_id": "toolu_011xkvABddBnSf8Ej4ZTCFRu", "decision_reason_type": "other",
                     "message": "Refusing to write /tmp/patch_app.py: where it leads on disk could not be determined"}


def test_the_final_reply_skips_events_whose_message_is_not_a_model_message(tmp_path):
    """1 Oct 2026: every Sonnet 5.5 run crashed at the end of a story (AttributeError: 'str' object has no attribute
    'get') once Claude Code had refused a tool call, and used up its restarts."""
    import drive
    ev = tmp_path / "ev.jsonl"
    ev.write_text(_event("assistant", {"type": "text", "text": "the reply"}) + json.dumps(PERMISSION_DENIED) + "\n")
    assert drive.final_reply_text(ev) == "the reply"



def test_event_times_skip_an_unstamped_event_whose_message_is_a_string(tmp_path):
    """The history's event times read a message's own timestamp when an event has no receive stamp; a refused tool
    call's message is a string, which has none."""
    import history
    d = tmp_path / "stories" / "01"
    d.mkdir(parents=True)
    unstamped = {k: v for k, v in PERMISSION_DENIED.items() if k != "_rx"}
    (d / "agent-events.jsonl").write_text(json.dumps(unstamped) + "\n" + json.dumps({"_rx": 1790822960.0, "type": "x"}) + "\n")
    assert history._event_times(tmp_path, "1") == [1790822960.0]


def test_a_tool_call_written_as_text_is_recognised():
    """28 Sep: gufo b722a61 returned an `edit` call with raw newlines in its JSON argument as plain
    text (gufo-org/gufo#304); pi read it as "finished" and the story ended mid-work."""
    import drive
    assert drive.tool_call_as_text(LEAKED_CALL)
    assert drive.tool_call_as_text("Now fixing the import.\n" + LEAKED_CALL)
    assert not drive.tool_call_as_text("All tasks are done and committed.")
    assert not drive.tool_call_as_text("")


def _no_guard(monkeypatch):
    import drive

    class NoGuard:
        def __init__(self, *a): pass
        def start(self): pass
        def stop(self): return 0
    monkeypatch.setattr(drive, "ToolHangGuard", NoGuard)
    monkeypatch.setattr(drive, "sh", lambda *a, **k: "HEAD")


def test_a_session_that_ends_on_a_tool_call_written_as_text_is_continued_and_logged(tmp_path, monkeypatch):
    import drive
    clean = {"stalled": False, "error": None, "session": "s", "steps": 3, "tool_calls": 2, "exit": 0,
             "seconds": 60, "compactions": 0, "tokens": {"input": 1, "output": 1}}
    run = tmp_path / "run"
    ev = run / "stories" / "01" / "agent-events.jsonl"
    ev.parent.mkdir(parents=True)
    finals = [LEAKED_CALL, "Done: all tasks committed."]
    prompts = []

    def fake_run_agent(client, ws, env, model_id, prompt, events_path, resume_from=None, fork=True):
        prompts.append(prompt)
        with events_path.open("a") as f:
            f.write(_event("assistant", {"type": "text", "text": finals[len(prompts) - 1]}))
        return dict(clean)
    monkeypatch.setattr(drive, "run_agent", fake_run_agent)
    monkeypatch.setattr(drive, "commits_since", lambda ws, head: 1)   # it had committed: no nudge
    _no_guard(monkeypatch)
    res = drive.run_story_agent(None, tmp_path, {}, "m", "go", ev)
    assert prompts == ["go", drive.TOOLCALL_AS_TEXT_PROMPT]
    assert res["toolcall_text_resumes"] == 1 and res["nudges"] == 0
    assert "tool call written as text" in (run / "interventions.md").read_text()


def test_tool_call_as_text_resumes_are_capped(tmp_path, monkeypatch):
    import drive
    clean = {"stalled": False, "error": None, "session": "s", "steps": 3, "tool_calls": 2, "exit": 0,
             "seconds": 60, "compactions": 0, "tokens": {"input": 1, "output": 1}}
    ev = tmp_path / "run" / "stories" / "01" / "agent-events.jsonl"
    ev.parent.mkdir(parents=True)

    def fake_run_agent(client, ws, env, model_id, prompt, events_path, resume_from=None, fork=True):
        with events_path.open("a") as f:
            f.write(_event("assistant", {"type": "text", "text": LEAKED_CALL}))
        return dict(clean)
    monkeypatch.setattr(drive, "run_agent", fake_run_agent)
    monkeypatch.setattr(drive, "commits_since", lambda ws, head: 1)
    _no_guard(monkeypatch)
    res = drive.run_story_agent(None, tmp_path, {}, "m", "go", ev)
    assert res["toolcall_text_resumes"] == drive.MAX_TOOLCALL_TEXT_RESUMES


def _reference_run(tmp_path, spec_text="the spec"):
    """A finished reference run: workspace.bundle with one commit per story, and metrics naming
    each story's end commit, as a real run leaves them."""
    import subprocess
    ws, run = tmp_path / "ref-ws", tmp_path / "ref-run"
    (ws / "spec").mkdir(parents=True)
    (ws / "spec" / "prd.md").write_text(spec_text)
    git = lambda *a: subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=ws,
                                    check=True, capture_output=True, text=True).stdout.strip()
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "harness: empty repository with spec")
    stories, processed = {}, []
    for sid in (1, 2, 3):
        (ws / f"story{sid}.ts").write_text(f"story {sid}")
        git("add", "-A"); git("commit", "-qm", f"story {sid}: feature {sid}")
        stories[str(sid)] = {"title": f"feature {sid}", "commit": git("rev-parse", "HEAD")}
        processed.append({"id": sid, "title": f"feature {sid}", "status": "DONE", "ended_by": "agent"})
    run.mkdir()
    git("bundle", "create", str(run / "workspace.bundle"), "--all")
    (run / "metrics.json").write_text(json.dumps({"stories": stories, "processed": processed}))
    return run, stories


def test_known_good_base_is_the_reference_runs_code_at_the_end_of_the_previous_story(tmp_path):
    """EVALUATION-POLICY rule 7: known-good mode runs one story on another run's code as it was
    when the previous story ended, with the earlier stories counted as processed."""
    from drive import known_good_base
    ref, stories = _reference_run(tmp_path)
    base = known_good_base(ref, 3)
    assert base["commit"] == stories["2"]["commit"]
    assert [p["id"] for p in base["processed"]] == [1, 2]
    assert all(p["ended_by"] == "known-good base" for p in base["processed"])
    with pytest.raises(SystemExit, match="story 1"):
        known_good_base(ref, 1)   # nothing before it: a full run from empty is the same thing
    with pytest.raises(SystemExit, match="story 9"):
        known_good_base(ref, 9)   # the reference run never got there


def test_known_good_workspace_holds_no_trace_of_later_stories(tmp_path):
    """The bundle holds the reference run's whole history: the agent must not be able to read how
    the story it is about to build was done."""
    import subprocess
    from drive import known_good_base, setup_workspace_from
    ref, stories = _reference_run(tmp_path)
    spec = tmp_path / "ref-ws" / "spec"
    ws = tmp_path / "work" / "workspace"
    setup_workspace_from(ws, known_good_base(ref, 3), spec)
    git = lambda *a: subprocess.run(["git", *a], cwd=ws, check=True, capture_output=True, text=True).stdout
    assert git("rev-parse", "HEAD").strip() == stories["2"]["commit"]
    assert git("branch", "--show-current").strip() == "main"
    assert git("remote").strip() == ""
    assert stories["3"]["commit"] not in git("rev-list", "--all", "--reflog")
    assert subprocess.run(["git", "cat-file", "-e", stories["3"]["commit"]], cwd=ws).returncode != 0
    assert not (ws / "story3.ts").exists() and (ws / "story2.ts").exists()


def test_known_good_brings_an_older_reference_up_to_this_packs_spec(tmp_path):
    """The reference may predate a spec revision (Opus run-3 is vidi-v1, the pack is now v1.1): the
    agent works from today's spec either way, so the base gets it in a harness commit, recorded."""
    import subprocess
    from drive import known_good_base, setup_workspace_from
    ref, stories = _reference_run(tmp_path, spec_text="an older spec")
    current = tmp_path / "current-spec"
    current.mkdir()
    (current / "prd.md").write_text("the spec as it is now")
    (current / ".DS_Store").write_bytes(b"finder noise")
    ws = tmp_path / "work" / "workspace"
    base = known_good_base(ref, 3)
    setup_workspace_from(ws, base, current)
    assert (ws / "spec" / "prd.md").read_text() == "the spec as it is now"
    assert base["spec_updated"] is True
    log = subprocess.run(["git", "log", "--format=%s", "-2"], cwd=ws, capture_output=True, text=True).stdout
    assert log.splitlines()[0].startswith("harness: spec updated")
    assert log.splitlines()[1] == "story 2: feature 2"
    assert subprocess.run(["git", "status", "--porcelain"], cwd=ws, capture_output=True, text=True).stdout == ""


def test_known_good_ignores_finder_files_when_comparing_specs(tmp_path):
    from drive import known_good_base, setup_workspace_from
    ref, _ = _reference_run(tmp_path)
    current = tmp_path / "current-spec"
    current.mkdir()
    (current / "prd.md").write_text("the spec")
    (current / ".DS_Store").write_bytes(b"finder noise")
    base = known_good_base(ref, 3)
    setup_workspace_from(tmp_path / "work" / "workspace", base, current)
    assert base["spec_updated"] is False


class _RecordingContainment:
    """Stands in for containment.StoryContainment: records what the harness asks of it."""
    def __init__(self):
        self.calls = []
    def wrap(self, cmd):
        self.calls.append("wrap")
        return cmd
    def started(self, pid):
        self.calls.append("started")
    def note_tool_start(self):
        self.calls.append("tool_start")
    def reap_interrupted(self):
        self.calls.append("reap_interrupted")
        return []
    def reap_pressure(self):
        self.calls.append("reap_pressure")
        return []


class _ScriptedClient:
    """An 'agent' that prints pi-shaped events: one tool call, then the end of its turn."""
    env_remove = ()
    def command(self, model_id, prompt, resume_from=None, fork=True):
        events = ['{"type":"session","id":"s1"}', '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash"}',
                  '{"type":"tool_execution_end","toolCallId":"t1","toolName":"bash"}', '{"type":"agent_end"}']
        return ["printf", "%s\\n", *events]
    def env(self):
        return {}
    def scan(self, e, st):
        return None


def test_the_agent_runs_contained_and_each_tool_call_is_noted(tmp_path, monkeypatch):
    """tools/agent-containment/PROPOSAL.md: the harness wraps the agent in its story's scope, tells it
    the agent's pid, and snapshots the scope at every tool call so an interrupted call can be reaped."""
    import drive, hostenv
    monkeypatch.setattr(drive, "sandboxed", lambda cmd, own_dir: cmd)
    monkeypatch.setattr(hostenv, "oom_first", lambda cmd: cmd)
    rec = _RecordingContainment()
    monkeypatch.setattr(drive, "CONTAINMENT", rec)
    drive.run_agent(_ScriptedClient(), tmp_path, {}, "m", "p", tmp_path / "events.jsonl")
    assert rec.calls == ["wrap", "started", "tool_start"]


def test_the_hang_guard_reaps_what_the_interrupted_call_started(tmp_path, monkeypatch):
    import time, drive
    rec = _RecordingContainment()
    monkeypatch.setattr(drive, "CONTAINMENT", rec)
    monkeypatch.setattr(drive, "TOOL_HANG_POLL_S", 0.01)
    monkeypatch.setattr(drive, "tool_hang_check", lambda events, ws: True)
    g = drive.ToolHangGuard(tmp_path / "e.jsonl", tmp_path, tmp_path / "interventions.md")
    g.start()
    time.sleep(0.05)
    g.stop()
    assert "reap_interrupted" in rec.calls


def test_memory_pressure_reaps_orphans_before_the_guard_stops_the_story(monkeypatch):
    import time as _t, drive
    rec = _RecordingContainment()
    monkeypatch.setattr(drive, "CONTAINMENT", rec)
    monkeypatch.setattr(drive, "CONDITION_POLL_S", 0.01)
    monkeypatch.setattr(drive, "swap_used_gb", lambda: 1.0)
    monkeypatch.setattr(drive, "mem_free_pct", lambda: drive.MEM_REAP_PCT - 1)
    monkeypatch.setattr(drive, "conditions", lambda: {"ac": True, "low_power": False, "thermal": "nominal"})
    monkeypatch.setattr(drive.hostenv, "memory_snapshot", lambda: {"processes": []})
    s = drive.ConditionSampler()
    s.start()
    _t.sleep(0.05)
    s.stop()
    assert "reap_pressure" in rec.calls


def test_sandbox_hides_the_file_share_that_held_a_clone_of_this_repo():
    # 25 Sep 2026: 27B canvas-pi-04 read the Opus reference build through a clone at ~/sambashare/tools on the RTX 4090 machine.
    from drive import SANDBOX_DENY
    assert Path.home() / "sambashare" in SANDBOX_DENY
