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


def test_sandbox_blocks_reading_the_acceptance_suite(tmp_path: Path):
    own = tmp_path / "run"
    (own / "workspace").mkdir(parents=True)
    r = subprocess.run(sandboxed(["cat", str(SECRET)], own_dir=own), capture_output=True, text=True)
    assert r.returncode != 0 and "vidi-acceptance" not in r.stdout


def test_sandbox_blocks_listing_the_repo(tmp_path: Path):
    own = tmp_path / "run"
    (own / "workspace").mkdir(parents=True)
    r = subprocess.run(sandboxed(["ls", str(VIDI)], own_dir=own), capture_output=True, text=True)
    assert r.returncode != 0 and "acceptance" not in r.stdout


def test_sandbox_allows_own_workspace(tmp_path: Path):
    own = tmp_path / "run"
    ws = own / "workspace"
    ws.mkdir(parents=True)
    (ws / "f.txt").write_text("mine")
    r = subprocess.run(sandboxed(["cat", str(ws / "f.txt")], own_dir=own), capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout == "mine"


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


def test_record_story_survives_a_conflicting_remote_and_pushes_the_backlog_later(tmp_path):
    """The remote changed this run's own files (as the 24GB -> nvidia4090 rename did to gruntus's
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


def test_make_publishable_redacts_home_and_keeps_event_logs_small(tmp_path):
    """tests/privacy-test.sh: no /Users/<name> paths and no benchmark file over 512K may be committed."""
    import gzip, json as _json
    from pathlib import Path as _P
    from drive import make_publishable, compact_events, PUBLISH_MAX_BYTES
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
    assert home not in text and "truncated" in text
    assert gz.stat().st_size < PUBLISH_MAX_BYTES
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


def test_oversized_compact_log_is_shrunk_below_the_limit(tmp_path):
    """canvas-pi-01 story 4: 408 steps compacted to 836 KB, over the 512 KB repo limit."""
    import gzip, json as _json, os
    from drive import make_publishable, PUBLISH_MAX_BYTES
    run = tmp_path / "run"
    (run / "stories" / "04").mkdir(parents=True)
    gz = run / "stories" / "04" / "agent-events.compact.jsonl.gz"
    with gzip.open(gz, "wt") as f:
        for i in range(4000):
            f.write(_json.dumps({"type": "message_end", "i": i, "text": os.urandom(900).hex()[:1900]}) + "\n")
    assert gz.stat().st_size > PUBLISH_MAX_BYTES
    assert make_publishable(run) == []
    assert gz.stat().st_size <= PUBLISH_MAX_BYTES
    kept = [_json.loads(l) for l in gzip.open(gz, "rt")]
    assert len(kept) == 4000 and all(e["type"] == "message_end" for e in kept)   # every event kept, strings shortened


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


def test_unmonitored_thermal_is_fit_and_not_throttled():
    """A Linux host with no thermal source must neither block every story nor count as throttled."""
    from drive import conditions_ok, summarise_conditions
    c = {"ac": True, "low_power": False, "thermal": "unmonitored"}
    assert conditions_ok(c)
    assert summarise_conditions(2, [])["throttled_share"] == 0.0


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


def test_dbench_home_is_hidden_except_its_tools(tmp_path, monkeypatch):
    """Agents under dbench must not reach its jobs, token, repo checkouts or other runs' builds,
    but must still run the tools installed in ~/.dbench/tools (pi, uv)."""
    import subprocess
    import drive
    dbench = tmp_path / "dotdbench"
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
    local = REPO_ROOT / "combinations" / "qwen" / "3.8" / "27b" / "ubuntu" / "nvidia4090" / "llamacpp-opencode" / "benchmarks" / "vidi" / "canvas-pi-03"
    assert combination_label(local) == "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode"


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


def test_sandbox_blocks_the_held_out_suites_browsers(tmp_path: Path):
    import hostenv
    suite_cache = hostenv.playwright_cache(Path.home())
    if not suite_cache.is_dir():
        pytest.skip("no Playwright browsers installed on this machine")
    own = tmp_path / "run"
    (own / "workspace").mkdir(parents=True)
    r = subprocess.run(sandboxed(["ls", str(suite_cache)], own_dir=own), capture_output=True, text=True)
    assert r.returncode != 0 and "chromium" not in r.stdout
    rm = subprocess.run(sandboxed(["touch", str(suite_cache / "agent-was-here")], own_dir=own),
                        capture_output=True, text=True)
    assert rm.returncode != 0 and not (suite_cache / "agent-was-here").exists()


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
