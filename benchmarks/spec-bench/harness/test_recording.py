"""drive.py's recording path: each run's agent has a temporary directory of its own (item 2), and the conversation
log committed with each story is lossless (item 4).

Temp dir dimensions: the agent's environment; the macOS and Linux command shapes; behaviour in the real sandbox
(skipped where the platform's sandbox tool is missing): own temp usable, /tmp and another run's temp hidden, the
held-out suite's scratch hidden, mktemp still works.
Log dimensions: round trip (every non-delta event identical bar home redaction; deltas dropped but the first of each
model call); timing kept (accounting and conversation give the same answer as from the full log); size; the readers
(claims, annotate, history, progress) read it as before; publishing leaves it whole up to its own cap."""
from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import pytest

import drive
import publicise
import hostenv

HOME = str(Path.home())
T0 = 1_790_000_000.0
MIN_COMPRESSION = 10     # the lossless log is at least this many times smaller than the full log (real: ~44x)


# ======================= item 2: a temporary directory per run =======================

def test_the_agent_s_tmpdir_is_its_own_run_s(tmp_path):
    work = tmp_path / "work" / "run-a"
    env = drive.agent_env(work)
    own = work / drive.AGENT_TMP
    assert own.is_dir()
    assert env["TMPDIR"] == env["TMP"] == env["TEMP"] == str(own)


def test_two_runs_get_different_temp_dirs(tmp_path):
    a, b = drive.agent_env(tmp_path / "a"), drive.agent_env(tmp_path / "b")
    assert a["TMPDIR"] != b["TMPDIR"]


def test_macos_profile_hides_shared_temp_and_reopens_only_the_run_s_own(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", True)
    monkeypatch.setattr(drive, "user_temp_dir", lambda: Path("/private/var/folders/zz/abc/T"))
    own = tmp_path / "run"
    own.mkdir()
    cmd = drive.sandboxed(["true"], own_dir=own)
    assert cmd[:2] == ["sandbox-exec", "-p"] and cmd[3:] == ["true"]
    profile = cmd[2]
    deny = profile[profile.index("(deny file-read* file-write*"):]
    deny = deny[:deny.index(")(allow")]
    # The shared temp dirs as this machine resolves them (drive.SHARED_TMP): /private/tmp and /private/var/tmp on
    # macOS, where /tmp is a symlink; /tmp and /var/tmp where the profile is only built, never used (Linux).
    shared = [str(p.resolve()) for p in drive.SHARED_TMP]
    if hostenv.IS_MAC:
        assert shared == ["/private/tmp", "/private/var/tmp"]
    for p in (*shared, "/private/var/folders/zz/abc/T"):
        assert f'(subpath "{p}")' in deny
    # mktemp's own names and xcrun's cache stay usable in the user temp dir, which can't be listed.
    assert '(allow file-read-metadata (literal "/private/var/folders/zz/abc/T"))' in profile
    assert '(regex #"^/private/var/folders/zz/abc/T/(tmp\\.|xcrun_db)")' in profile
    # The run's own directory (its temp dir inside) is the last rule, so it wins over every deny.
    assert profile.endswith(f"(allow file-read* file-write* (subpath {drive._sb_quote(own)}))")


def test_linux_command_binds_the_run_s_temp_dir_over_tmp_before_its_own_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    own = tmp_path / "run"
    own.mkdir()
    cmd = drive.sandboxed(["true"], own_dir=own)
    own_s, tmp_s = str(own.resolve()), str((own / drive.AGENT_TMP).resolve())
    assert cmd[0] == "bwrap" and cmd[-2:] == ["--", "true"]
    binds = [(cmd[i + 1], cmd[i + 2]) for i, a in enumerate(cmd) if a == "--bind"]
    assert (tmp_s, "/tmp") in binds and (tmp_s, "/var/tmp") in binds
    # After the masks (a mask would cover it) and before the run's own dir (which may itself be under /tmp).
    assert binds.index((tmp_s, "/tmp")) < binds.index((own_s, own_s)) == len(binds) - 1
    last_mask = max(i for i, a in enumerate(cmd) if a == "--tmpfs") if "--tmpfs" in cmd else 0
    assert cmd.index(tmp_s) > last_mask
    assert (own / drive.AGENT_TMP).is_dir()


needs_sandbox = pytest.mark.needs_sandbox      # conftest.py: skipped where the sandbox tool is missing


@pytest.fixture
def two_runs():
    """Two runs' work dirs where real runs keep them (the sandbox hides WORK_ROOT but the agent's own)."""
    tag = uuid.uuid4().hex[:8]
    mine, other = drive.WORK_ROOT / f"_test_tmp_mine_{tag}", drive.WORK_ROOT / f"_test_tmp_other_{tag}"
    for d in (mine, other):
        (d / "workspace").mkdir(parents=True, exist_ok=True)
    try:
        yield mine, other
    finally:
        shutil.rmtree(mine, ignore_errors=True)
        shutil.rmtree(other, ignore_errors=True)


def _in_sandbox(own: Path, script: str) -> subprocess.CompletedProcess:
    env = {**os.environ, **drive.agent_env(own)}
    return subprocess.run(drive.sandboxed(["/bin/sh", "-c", script], own_dir=own), cwd=own / "workspace", env=env,
                          capture_output=True, text=True)


@needs_sandbox
def test_the_agent_writes_and_reads_its_own_temp_dir(two_runs):
    mine, _ = two_runs
    r = _in_sandbox(mine, 'echo mine > "$TMPDIR/f" && cat "$TMPDIR/f"')
    assert r.returncode == 0 and r.stdout.strip() == "mine", r.stderr
    assert (mine / drive.AGENT_TMP / "f").read_text().strip() == "mine"




# ======================= packages outside the workspace =======================
# Node and TypeScript look for packages in node_modules of every directory above the workspace. The Macs had
# ~/node_modules/@types/node: Sonnet 5.5 v2-r1 (1 Oct 2026) never declared @types/node, its build passed where the
# agent worked and failed from a clean clone, and the run has no score of record.

@pytest.fixture
def run_under_a_home_with_packages():
    """A run's work dir under a stand-in for the home directory that has node_modules and a package.json, placed
    where the sandbox hides nothing else (not under WORK_ROOT or a temp dir, which are hidden anyway)."""
    home = Path.home() / f".spec-bench-sandbox-test-{uuid.uuid4().hex[:8]}"
    own = home / "bench" / "work" / "run"
    (own / "workspace" / "node_modules" / "mine").mkdir(parents=True)
    (own / "workspace" / "node_modules" / "mine" / "index.js").write_text("module.exports = 'mine';\n")
    (home / "node_modules" / "leak").mkdir(parents=True)
    (home / "node_modules" / "leak" / "index.js").write_text("module.exports = 'leaked';\n")
    (home / "package.json").write_text('{"name": "home", "private": true}\n')
    try:
        yield home, own
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_outside_packages_are_every_ancestor_s_node_modules_and_manifests(tmp_path):
    own = tmp_path / "a" / "b" / "run"
    got = drive.outside_packages(own)
    for anc in (tmp_path / "a" / "b", tmp_path / "a", tmp_path, Path(tmp_path.anchor)):
        assert anc.resolve() / "node_modules" in got and anc.resolve() / "package.json" in got
    assert not [p for p in got if p.is_relative_to(own.resolve())]                 # the run's own are its own


def test_macos_profile_denies_packages_above_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", True)
    own = tmp_path / "home" / "bench" / "run"
    own.mkdir(parents=True)
    profile = drive.sandboxed(["true"], own_dir=own)[2]
    deny = profile[:profile.index("(allow file-read-metadata")]
    home = (tmp_path / "home").resolve()
    assert f"(subpath {drive._sb_quote(home / 'node_modules')})" in deny
    assert f"(literal {drive._sb_quote(home / 'package.json')})" in deny


def test_linux_command_masks_packages_above_the_run_that_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "IS_MAC", False)
    home = tmp_path / "home"
    own = home / "bench" / "run"
    own.mkdir(parents=True)
    (home / "node_modules").mkdir()
    (home / "package.json").write_text("{}")
    cmd = drive.sandboxed(["true"], own_dir=own)
    masks = [cmd[i + 1] for i, a in enumerate(cmd) if a == "--tmpfs"]
    nulled = [cmd[i + 2] for i, a in enumerate(cmd) if a == "--ro-bind" and cmd[i + 1] == "/dev/null"]
    assert str((home / "node_modules").resolve()) in masks and str((home / "package.json").resolve()) in nulled
    assert str((home / "bench" / "node_modules").resolve()) not in masks        # absent: masking would create it


@needs_sandbox
def test_the_agent_cannot_read_packages_above_its_run(run_under_a_home_with_packages):
    home, own = run_under_a_home_with_packages
    r = _in_sandbox(own, f'cat "{home}/node_modules/leak/index.js"; ls "{home}/node_modules"; cat "{home}/package.json"')
    assert "leaked" not in r.stdout and "leak" not in r.stdout and '"home"' not in r.stdout, r.stdout


@needs_sandbox
@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_node_resolves_the_workspace_s_packages_and_none_from_above(run_under_a_home_with_packages):
    home, own = run_under_a_home_with_packages
    outside = subprocess.run(["node", "-e", "console.log(require('leak'))"], cwd=own / "workspace", capture_output=True, text=True)
    assert outside.stdout.strip() == "leaked"                  # the leak is real without the sandbox
    r = _in_sandbox(own, "node -e \"console.log(require('mine'))\"; node -e \"console.log(require('leak'))\"")
    assert "mine" in r.stdout and "leaked" not in r.stdout and "Cannot find module 'leak'" in r.stderr, r.stderr[-600:]

def test_claude_code_is_told_to_keep_its_temp_files_in_the_run_s_own(tmp_path):
    env = drive.agent_env(tmp_path / "run-a")
    assert env["CLAUDE_CODE_TMPDIR"] == env["TMPDIR"]


@needs_sandbox
def test_claude_code_s_temp_dir_works_in_the_sandbox_when_the_shared_one_exists(two_runs):
    """1 Oct 2026, the Sonnet 5.5 reference run: Claude Code keeps its temp files in ${CLAUDE_CODE_TMPDIR:-/tmp}/claude-<uid>.
    With /tmp denied, the sandboxed agent couldn't see that /tmp/claude-<uid> (made by any other Claude Code on the
    machine) existed, and its mkdir failed with EEXIST: the preflight's Claude session never started."""
    mine, _ = two_runs
    shared = Path("/tmp") / f"claude-{os.getuid()}"
    made = not shared.exists()
    shared.mkdir(exist_ok=True)
    try:
        r = _in_sandbox(mine, 'd="${CLAUDE_CODE_TMPDIR:-/tmp}/claude-$(id -u)"; mkdir -p "$d" && echo ok > "$d/f" && cat "$d/f"')
        assert r.returncode == 0 and r.stdout.strip() == "ok", r.stderr
    finally:
        if made:
            shared.rmdir()

@needs_sandbox
def test_another_run_s_temp_dir_is_not_visible(two_runs):
    mine, other = two_runs
    drive.agent_env(other)
    (other / drive.AGENT_TMP / "leftover").write_text("other run")
    r = _in_sandbox(mine, f'cat "{other / drive.AGENT_TMP / "leftover"}"; ls "{other / drive.AGENT_TMP}"')
    assert "other run" not in r.stdout and "leftover" not in r.stdout


@needs_sandbox
def test_what_another_run_left_in_tmp_is_not_visible(two_runs):
    """A run found another run's leftover git worktree at /tmp/vidi-baseline."""
    mine, _ = two_runs
    leftover = Path("/tmp") / f"_test-leftover-{uuid.uuid4().hex[:8]}"
    leftover.mkdir()
    try:
        (leftover / "HEAD").write_text("other run's worktree")
        r = _in_sandbox(mine, f'cat "{leftover}/HEAD"; ls /tmp')
        assert "other run's worktree" not in r.stdout and leftover.name not in r.stdout
    finally:
        shutil.rmtree(leftover, ignore_errors=True)


@needs_sandbox
def test_the_held_out_suite_s_scratch_is_not_visible(two_runs):
    """The suite keeps its app's state in os.tmpdir()/vidi-accept-*: the harness's temp dir (/tmp on Linux, the
    user temp dir on macOS), outside the sandbox."""
    mine, _ = two_runs
    scratch = Path(tempfile.mkdtemp(prefix="vidi-accept-", dir=tempfile.gettempdir()))
    try:
        (scratch / "board.json").write_text("suite state")
        r = _in_sandbox(mine, f'cat "{scratch}/board.json"; ls "{scratch.parent}"')
        assert "suite state" not in r.stdout and scratch.name not in r.stdout
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@needs_sandbox
def test_mktemp_and_git_still_work_in_the_sandbox(two_runs):
    """Agents run `mktemp -d` (canvas-mlx-01 story 4) and git; macOS's mktemp ignores TMPDIR."""
    mine, _ = two_runs
    r = _in_sandbox(mine, 'd=$(mktemp -d) && echo ok > "$d/f" && cat "$d/f" && rm -r "$d" && '
                          'git init -q . && git -c user.name=a -c user.email=a@a commit -q --allow-empty -m x && echo git-ok')
    assert r.returncode == 0 and r.stdout.split() == ["ok", "git-ok"], r.stderr
    assert "error" not in r.stderr.lower(), r.stderr    # no xcrun cache complaints on every git call


# ======================= item 4: lossless conversation logs =======================

def _pi_call(t: float, n_deltas: int, text: str, tool: str) -> list[dict]:
    """A pi model call as pi streams it: every message_update repeats the partial message so far."""
    out = [{"_rx": t, "type": "message_start", "message": {"role": "assistant", "content": []}}]
    for i in range(1, n_deltas + 1):
        out.append({"_rx": t + i * 0.05, "type": "message_update",
                    "assistantMessageEvent": {"type": "text_delta", "delta": text[i - 1:i]},
                    "message": {"role": "assistant", "content": [{"type": "text", "text": text[:i]}]}})
    end = t + n_deltas * 0.05 + 0.1
    out.append({"_rx": end, "type": "message_end", "message": {
        "role": "assistant", "stopReason": "toolUse",
        "content": [{"type": "thinking", "thinking": "think " * 400}, {"type": "text", "text": text},
                    {"type": "toolCall", "id": f"t{t}", "name": "read", "arguments": {"path": f"{HOME}/w/{tool}"}}],
        "usage": {"input": 1000, "output": n_deltas, "cacheRead": 5000, "cacheWrite": 0}}})
    out.append({"_rx": end, "type": "tool_execution_start", "toolCallId": f"t{t}", "toolName": "read",
                "args": {"path": f"{HOME}/w/{tool}"}})
    out += [{"_rx": end + 0.01 * k, "type": "tool_execution_update", "partialResult": "x" * 100} for k in range(3)]
    out.append({"_rx": end + 0.5, "type": "tool_execution_end", "toolCallId": f"t{t}", "toolName": "read",
                "result": {"content": [{"type": "text", "text": "file body " * 800}]}, "isError": False})
    return out


def _story(calls: int, n_deltas: int = 60) -> list[dict]:
    ev = [{"_rx": T0, "type": "session", "id": "s1", "cwd": f"{HOME}/.vidi-bench/work/x"},
          {"_rx": T0, "type": "agent_start"}]
    for i in range(calls):
        ev += _pi_call(T0 + 1 + i * 10, n_deltas, f"call {i} " + "word " * 30, f"f{i}.ts")
    return ev + [{"_rx": T0 + 2 + calls * 10, "type": "agent_end"}]


def _raw(tmp_path: Path, events: list[dict], extra_lines: str = "") -> Path:
    raw = tmp_path / "stories" / "01" / "agent-events.jsonl"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in events) + extra_lines)
    return raw


def _read_gz(gz: Path) -> list[dict]:
    with gzip.open(gz, "rt") as f:
        return [json.loads(l) for l in f if l.strip()]


def _redacted(e: dict) -> dict:
    return json.loads(json.dumps(e).replace(HOME, "~"))


def test_every_non_delta_event_survives_whole(tmp_path):
    events = _story(5)
    gz = drive.compact_events(_raw(tmp_path, events))
    kept = [e for e in _read_gz(gz) if e["type"] not in drive.STREAM_DELTA_EVENTS]
    assert kept == [_redacted(e) for e in events if e["type"] not in drive.STREAM_DELTA_EVENTS]
    # Nothing cut: the long thinking block and tool result are whole.
    text = gzip.open(gz, "rt").read()
    assert "truncated" not in text and ("file body " * 800) in text


def test_home_paths_are_redacted(tmp_path):
    gz = drive.compact_events(_raw(tmp_path, _story(2)))
    text = gzip.open(gz, "rt").read()
    assert HOME not in text and '"~/w/f0.ts"' in text


def test_only_the_first_stream_delta_of_each_model_call_is_kept(tmp_path):
    events = _story(4)
    kept = _read_gz(drive.compact_events(_raw(tmp_path, events)))
    updates = [e for e in kept if e["type"] == "message_update"]
    firsts = [events[i + 1] for i, e in enumerate(events) if e["type"] == "message_start"]
    assert updates == [_redacted(e) for e in firsts]
    assert not any(e["type"] == "tool_execution_update" for e in kept)


def test_lines_that_are_not_json_are_dropped(tmp_path):
    raw = _raw(tmp_path, _story(1), extra_lines='not json\n{"_rx":1,"type":"message_end","mess')
    kept = _read_gz(drive.compact_events(raw))
    assert len(kept) == len([e for e in _story(1) if e["type"] not in drive.STREAM_DELTA_EVENTS]) + 1


def _plain(gz: Path, dest: Path) -> Path:
    with gzip.open(gz, "rt") as src:
        dest.write_text(src.read())
    return dest


def test_timing_from_the_compact_log_matches_the_full_log(tmp_path):
    """accounting.py times prefill by each call's first streamed chunk: the kept first delta."""
    import accounting
    raw = _raw(tmp_path, _story(6))
    plain = _plain(drive.compact_events(raw), tmp_path / "plain.jsonl")
    window = (T0, T0 + 100)
    full, compact = (accounting.time_split(p, tmp_path / "none.log", *window) for p in (raw, plain))
    assert compact == full and full["model"]["prefill_s"] > 0 and full["model"]["decode_s"] > 0


def test_the_conversation_profile_from_the_compact_log_matches_the_full_log(tmp_path):
    import conversation
    raw = _raw(tmp_path, _story(6))
    plain = _plain(drive.compact_events(raw), tmp_path / "plain.jsonl")
    redacted = tmp_path / "redacted.jsonl"                 # paths are shorter once the home is redacted
    redacted.write_text(raw.read_text().replace(HOME, "~"))
    assert conversation.profile(plain, T0, T0 + 100) == conversation.profile(redacted, T0, T0 + 100)


def test_the_lossless_log_is_a_small_fraction_of_the_full_log(tmp_path):
    """Measured on a real story: 30.9 MB raw to about 0.7 MB gzipped. Here: the deltas are most of the bytes."""
    raw = _raw(tmp_path, _story(40, n_deltas=200))
    gz = drive.compact_events(raw)
    assert gz.stat().st_size * MIN_COMPRESSION < raw.stat().st_size
    assert gz.stat().st_size < drive.EVENT_LOG_MAX_BYTES


def test_the_readers_read_the_lossless_log_as_before(tmp_path):
    import annotate, claims, history, progress
    from clients import PiClient, empty_state
    events = _story(3)
    raw = _raw(tmp_path, events)
    gz = drive.compact_events(raw)
    no_deltas = tmp_path / "no-deltas.jsonl"
    no_deltas.write_text("".join(json.dumps(_redacted(e)) + "\n" for e in events if e["type"] not in drive.STREAM_DELTA_EVENTS))
    lines = gzip.open(gz, "rt").readlines()
    ref = no_deltas.read_text().splitlines()
    assert claims.final_message(lines) == claims.final_message(ref) and claims.final_message(lines).startswith("call 2")
    assert annotate.timeline(lines) == annotate.timeline(ref)
    run = tmp_path
    assert history._event_times(run, "1") == sorted(e["_rx"] for e in events if e["type"] not in drive.STREAM_DELTA_EVENTS)
    tally = progress.EventTally(PiClient(tmp_path), _plain(gz, tmp_path / "p.jsonl"), empty_state).update()
    assert tally["calls"] == 3 and tally["output_tokens"] == 3 * 60


def test_publishing_leaves_a_lossless_log_whole_even_over_the_old_512_kb_cap(tmp_path):
    run = tmp_path / "run"
    gz = run / "stories" / "02" / "agent-events.compact.jsonl.gz"
    gz.parent.mkdir(parents=True)
    with gzip.open(gz, "wt") as f:
        for i in range(1000):
            f.write(json.dumps({"type": "message_end", "i": i, "text": os.urandom(600).hex()}) + "\n")
    assert gz.stat().st_size > publicise.DEFAULT_SIZE_LIMIT
    before = gz.read_bytes()
    assert drive.make_publishable(run) == []
    assert gz.read_bytes() == before


def test_a_log_over_its_own_cap_is_cut_to_fit_and_says_so(tmp_path, monkeypatch):
    """A safety valve, never expected: GitHub refuses files over 100 MB, and a refused push stops every record."""
    monkeypatch.setattr(drive, "EVENT_LOG_MAX_BYTES", 200 * 1024)
    run = tmp_path / "run"
    gz = run / "stories" / "04" / "agent-events.compact.jsonl.gz"
    gz.parent.mkdir(parents=True)
    with gzip.open(gz, "wt") as f:
        for i in range(2000):
            f.write(json.dumps({"type": "message_end", "i": i, "text": os.urandom(900).hex()[:1900]}) + "\n")
    assert drive.make_publishable(run) == []
    assert gz.stat().st_size <= drive.EVENT_LOG_MAX_BYTES
    kept = _read_gz(gz)
    assert kept[0]["type"] == drive.LOG_CUT_MARK and kept[0]["limit_bytes"] == drive.EVENT_LOG_MAX_BYTES
    assert [e["i"] for e in kept[1:]] == list(range(2000))            # every event kept, strings shortened


def test_other_files_keep_the_512_kb_cap(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    (run / "big.json").write_text("x" * (publicise.DEFAULT_SIZE_LIMIT + 1))
    assert drive.make_publishable(run) == [str(run / "big.json")]


def test_a_raw_log_outside_stories_is_replaced_by_its_lossless_form(tmp_path):
    run = tmp_path / "run"
    sup = run / "superseded" / "agent-events.jsonl"
    sup.parent.mkdir(parents=True)
    sup.write_text("".join(json.dumps(e) + "\n" for e in _story(2)))
    drive.make_publishable(run)
    assert not sup.exists()
    kept = _read_gz(run / "superseded" / "agent-events.compact.jsonl.gz")
    assert "file body " * 800 in json.dumps(kept)


def test_the_publish_gate_still_reads_the_log(tmp_path):
    """heldout.staged_problems treats the log as the agent's own work (it never saw the suite), as before."""
    import publicise
    assert publicise.is_own_work("combinations/x/benchmarks/vidi/r/stories/01/agent-events.compact.jsonl.gz")
    assert not publicise.is_private("combinations/x/benchmarks/vidi/r/stories/01/agent-events.compact.jsonl.gz")



@needs_sandbox
def test_the_preflight_names_packages_above_the_run_that_the_agent_can_read(run_under_a_home_with_packages, monkeypatch):
    import preflight
    home, own = run_under_a_home_with_packages
    assert [p for p in preflight.visible_outside_packages(own) if p.is_relative_to(home)] == []
    monkeypatch.setattr(preflight, "sandboxed", lambda cmd, own_dir: cmd)        # a sandbox that hides nothing
    seen = preflight.visible_outside_packages(own)
    assert home / "node_modules" in seen and home / "package.json" in seen
