"""uv run --with pytest pytest harness/test_drive.py"""
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

from drive import sandboxed, VIDI

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
