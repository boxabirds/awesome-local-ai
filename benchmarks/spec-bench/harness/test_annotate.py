"""annotate.py: attempts built from the run records, ordered for coverage, labels saved safely."""
import _thread
import csv
import gzip
import json
import os
import socket
import subprocess
import threading
import urllib.request

import pytest

import annotate
import benchlake
import claims
from conftest import record_before_archive
import heldout
import lake_testing
import packdir


def ev(**kw):
    return json.dumps(kw)


def test_timeline_collapses_repeated_tools_and_marks_compactions_and_errors():
    lines = [ev(type="tool_execution_start", toolName="read", args={"path": "a.ts"}, _rx=100.0),
             ev(type="tool_execution_start", toolName="read", args={"path": "b.ts"}, _rx=130.0),
             ev(type="tool_execution_start", toolName="bash", args={"command": "npm test"}, _rx=160.0),
             ev(type="compaction_start", reason="threshold", _rx=220.0),
             ev(type="tool_execution_end", toolName="bash", isError=True, _rx=230.0)]
    tl = annotate.timeline(lines)
    assert [e["kind"] for e in tl] == ["tool", "tool", "compaction", "error"]
    assert tl[0]["count"] == 2 and tl[0]["last"] == "read b.ts"
    assert tl[2]["min"] == 2.0


def test_timeline_reads_claude_tool_uses():
    line = ev(type="assistant", timestamp="2026-09-25T10:00:00Z",
              message={"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]})
    assert annotate.timeline([line])[0]["text"] == "Bash ls"


LOG = """commit 3333333
a  Fri

    harness: snapshot after story 12 (uncommitted agent work)

commit 2222222
a  Fri

    story 12: images

commit 1111111
a  Fri

    story 11: pen
"""


def test_commits_are_matched_to_their_story_including_harness_snapshots():
    got = annotate.commits_for(LOG, 12)
    assert len(got) == 2 and "story 12: images" in got[0] and "snapshot after story 12" in got[1]
    assert len(annotate.commits_for(LOG, 11)) == 1
    assert annotate.commits_for(LOG, 1) == []  # "story 1" must not match "story 11" or "story 12"


def attempt(stack, run, story):
    return {"id": f"{stack}/{run}#{story:02d}", "stack": stack, "run": run, "story": story}


def test_order_interleaves_stacks_spreads_stories_and_is_stable():
    items = [attempt(s, r, n) for s in ("A", "B") for r in ("r1", "r2") for n in (1, 2, 3)]
    order = annotate.coverage_order([dict(a) for a in items])
    assert sorted(a["id"] for a in order) == sorted(a["id"] for a in items)
    assert all(order[i]["stack"] != order[i + 1]["stack"] for i in range(5))  # stacks alternate early
    first_a = [a["story"] for a in order if a["stack"] == "A"][:3]
    assert sorted(first_a) == [1, 2, 3]  # every story once before any repeats
    assert [a["id"] for a in annotate.coverage_order([dict(a) for a in items])] == [a["id"] for a in order]


def test_labels_are_saved_updated_and_validated(tmp_path):
    path, lock = tmp_path / "analysis" / "labels.csv", threading.Lock()
    annotate.write_label(path, "run#01", "skip", "is dragging a note meant to pan?", lock)
    annotate.write_label(path, "run#02", "fail", "", lock)
    annotate.write_label(path, "run#01", "fail", "pans on drag", lock)
    rows = list(csv.DictReader(path.open()))
    assert [(r["attempt"], r["verdict"], r["notes"]) for r in rows] == [("run#01", "fail", "pans on drag"), ("run#02", "fail", "")]
    with pytest.raises(ValueError):
        annotate.write_label(path, "run#03", "maybe", "", lock)


REAL_PRIVATE = benchlake.REPO.parent / "awesome-local-ai-bench-private"


# A sample of the lake's runs, every REAL_SAMPLE_STRIDE-th by id, holds this many story attempts or more (126 on
# 6 Nov 2026 with a stride of 6, from 12 runs of 10 stacks).
REAL_SAMPLE_STRIDE = 6
FEWEST_REAL_ATTEMPTS = 90
PI03 = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/canvas-pi-03"   # archived 4 Oct 2026


# The real runs' held-out detail is in the private repo's copy (the public record keeps counts): read it there,
# read-only, and skip where it isn't checked out.
# The real runs come from the real lake (story 23, through bench-lake), read-only; skipped where this machine has none.
@pytest.mark.skipif(not (benchlake.DEFAULT_STATE / benchlake.COLLECTED).is_dir(), reason="no lake on this machine")
def test_attempts_build_from_the_real_records(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(REAL_PRIVATE))
    monkeypatch.delenv(benchlake.STATE_ENV, raising=False)
    # Every REAL_SAMPLE_STRIDE-th run by id, across the stacks: the whole lake is 696 attempts (6 Nov 2026), whose
    # compact logs take minutes to read; a sample checks the same thing (real records build) in seconds.
    sample = annotate.run_dirs()[::REAL_SAMPLE_STRIDE]
    attempts = annotate.load_attempts(sample, tmp_path / "cache.json", rebuild=True)
    ids = {a["id"] for a in attempts}
    assert len(ids) == len(attempts) and len(attempts) >= FEWEST_REAL_ATTEMPTS
    # cached on the second load, though the collector may have rewritten some of these files in between
    again = annotate.load_attempts(annotate.run_dirs()[::REAL_SAMPLE_STRIDE], tmp_path / "cache.json", rebuild=False)
    assert [a["id"] for a in again] == [a["id"] for a in attempts]
    # One attempt checked in detail: the 4090's story 7, from the record as it was before it was archived (it was
    # archived before the lake existed, so only git history holds it).
    old = record_before_archive(PI03, tmp_path / "before-archive")
    pi03_s7 = next(a for a in annotate.load_attempts([(PI03, old)], tmp_path / "old-cache.json", rebuild=True)
                   if a["id"].endswith(f"{PI03}#07"))
    assert pi03_s7["title"].startswith("Select") and pi03_s7["timeline"] and pi03_s7["commits"]
    assert pi03_s7["behaviour"]["own_total"] == 8


STACK = "m/1/size/linux/hw/eng-cli"
VIDI = f"combinations/{STACK}/benchmarks/vidi"


def lake_run(state, run_id, metrics, node=lake_testing.NODE):
    """A run in the lake with this metrics.json (a reference run when the id names one)."""
    if run_id.startswith(benchlake.REFERENCE_ID_PREFIX + "/"):
        run = state / benchlake.REFERENCE / run_id.removeprefix(benchlake.REFERENCE_ID_PREFIX + "/")
        run.mkdir(parents=True)
        (run / "run.json").write_text("{}")
    else:
        run = lake_testing.add_run(state, None, {}, node=node, run_id=run_id)
    (run / "metrics.json").write_text(metrics if isinstance(metrics, str) else json.dumps(metrics))
    return run


def test_review_lists_the_lakes_vidi_runs_once_each_and_leaves_out_known_good_and_archived_ones(tmp_path, monkeypatch):
    """EVALUATION-POLICY rule 7: partial reruns are diagnostic and never mixed with full runs. The runs come from the
    lake through bench-lake: one entry per run id however many machines hold it, the operator's archive honoured, and
    other benchmarks than vidi left out."""
    state = lake_testing.lake(tmp_path, monkeypatch)
    full = lake_run(state, f"{VIDI}/full-01", {"stories": {}})
    lake_run(state, f"{VIDI}/full-01", {"stories": {}}, node="node-u")   # the same run, carried to a second machine
    lake_run(state, f"{VIDI}/kg-3", {"stories": {}, "known_good": {"from_run": "x", "commit": "c", "story": 3}})
    lake_run(state, f"{VIDI}/gone", {"stories": {}})
    lake_run(state, f"combinations/{STACK}/benchmarks/todoodle/t-1", {"stories": {}})
    ref = lake_run(state, "benchmarks/reference/vidi/opus/r1", {"stories": {}})
    lake_run(state, "benchmarks/reference/todoodle/opus/r1", {"stories": {}})
    subprocess.run([str(benchlake.binary()), str(state), "annotate", "set", "archived", f"{VIDI}/gone",
                    "--reason", "a test"], check=True, capture_output=True)
    got = annotate.run_dirs()
    assert [rid for rid, _ in got] == ["benchmarks/reference/vidi/opus/r1", f"{VIDI}/full-01"]
    assert got[0][1] == ref and got[1][1].name == full.name and got[1][1].is_relative_to(state / "collected")
    # a metrics.json that cannot be read says nothing about a known good base: the run is reviewed
    (state / "collected" / lake_testing.NODE / f"{VIDI}/kg-3" / "metrics.json").write_text("{not json")
    assert [rid for rid, _ in annotate.run_dirs()] == ["benchmarks/reference/vidi/opus/r1", f"{VIDI}/full-01",
                                                       f"{VIDI}/kg-3"]


SERVER_WAIT_S = 20            # how long a test waits for the review server to answer before giving up
POLLS_PER_S = 10
PAST_THE_BROWSER_TIMER_S = 1.0  # the command opens the browser 0.5 s after it starts
RUN_REL = lake_testing.RUN_ID


def tiny_run(run, gate=True):
    """One recorded run in folder `run`: story 1 has results and an event stream; story 2 has results but no events."""
    for sid in ("01", "02"):
        (run / "stories" / sid).mkdir(parents=True)
        (run / "stories" / sid / "accept.json").write_text(json.dumps(
            {"passed": 3, "total": 4, "by_story": {sid: {"passed": 2, "total": 2}},
             "tests": [{"title": "pans", "status": "failed", "file": f"story-{sid}.spec.ts", "error": "boom\nmore"}]}))
    with gzip.open(run / "stories" / "01" / annotate.EVENTS, "wt") as f:
        f.write(ev(type="tool_execution_start", toolName="read", args={"path": "a.ts"}, _rx=100.0) + "\n")
    if gate:
        (run / "stories" / "01" / "gate.json").write_text(json.dumps({"all_green": True}))
    (run / "metrics.json").write_text(json.dumps({"stories": {"1": {"title": "Pan", "status": "DONE", "ended_by": "agent",
                                                                     "agent": {"seconds": 90, "tool_calls": 4}}}}))
    (run / "workspace-git-log.txt").write_text(LOG)
    return run


def tiny_lake(tmp_path, monkeypatch, gate=True):
    """A lake holding that one run, the way the collector lays it out."""
    return tiny_run(lake_testing.add_run(lake_testing.lake(tmp_path, monkeypatch), None, {}), gate)


def test_a_story_without_a_self_check_file_has_no_self_check_verdict(tmp_path):
    run = tiny_run(tmp_path / "run", gate=False)
    metrics = json.loads((run / "metrics.json").read_text())
    got = annotate.build_attempt(RUN_REL, run, run / "stories" / "01", metrics, "")
    assert got["self_check_green"] is None
    assert got["story"] == 1 and got["stack"] == STACK and got["id"] == f"{RUN_REL}#01"
    assert got["behaviour"]["failed"] == [{"title": "pans", "error": "boom"}]  # first line of the error only


def test_a_story_with_a_self_check_file_carries_its_verdict(tmp_path):
    run = tiny_run(tmp_path / "run")
    metrics = json.loads((run / "metrics.json").read_text())
    got = annotate.build_attempt(RUN_REL, run, run / "stories" / "01", metrics, "")
    assert got["self_check_green"] is True
    assert got["completion"]["agent_minutes"] == 1.5 and got["behaviour"]["own_total"] == 2
    assert got["timeline"][0]["text"] == "read a.ts"


def test_a_story_with_both_logs_is_read_from_its_compact_copy(tmp_path):
    """The lake holds a story's raw log beside its compact copy (up to 200 MB a story; git only ever carried the
    compact one). The review reads the compact copy, as it always did: the same attempts, and a rebuild that takes
    seconds, not the raw logs' gigabytes. The raw log is read only for a story without a compact copy."""
    run = tiny_run(tmp_path / "run")
    raw = run / "stories" / "01" / claims.RAW_EVENTS
    raw.write_text(ev(type="tool_execution_start", toolName="bash", args={"command": "from the raw log"}) + "\n")
    raw.chmod(0)
    try:
        metrics = json.loads((run / "metrics.json").read_text())
        got = annotate.build_attempt(RUN_REL, run, run / "stories" / "01", metrics, "")
    finally:
        raw.chmod(0o644)
    assert got["timeline"][0]["text"] == "read a.ts"


def test_a_story_with_results_but_no_event_stream_is_left_out_of_the_attempts(tmp_path, monkeypatch):
    tiny_lake(tmp_path, monkeypatch)
    attempts = annotate.load_attempts(annotate.run_dirs(), tmp_path / "cache" / "attempts.json", rebuild=True)
    assert [a["id"] for a in attempts] == [f"{RUN_REL}#01"]  # story 02 had no events
    assert json.loads((tmp_path / "cache" / "attempts.json").read_text())["attempts"] == attempts


def test_a_cache_from_other_records_is_rebuilt_and_one_from_these_is_reused(tmp_path, monkeypatch):
    tiny_lake(tmp_path, monkeypatch)
    cache = tmp_path / "attempts.json"
    cache.write_text(json.dumps({"fingerprint": "from-other-records", "attempts": [{"id": "stale"}]}))
    rebuilt = annotate.load_attempts(annotate.run_dirs(), cache, rebuild=False)
    assert [a["id"] for a in rebuilt] == [f"{RUN_REL}#01"]
    cached = json.loads(cache.read_text())
    cached["attempts"] = [{"id": "marker"}]
    cache.write_text(json.dumps(cached))
    assert annotate.load_attempts(annotate.run_dirs(), cache, rebuild=False) == [{"id": "marker"}]


def test_a_record_rewritten_with_the_same_bytes_keeps_the_cache(tmp_path, monkeypatch):
    """The collector rewrites a lake file it pulls again (a new mtime, the same bytes): the attempts made from it are
    still these records', so the cache is reused; a changed record is not the same records, so it is rebuilt."""
    run = tiny_lake(tmp_path, monkeypatch)
    cache = tmp_path / "attempts.json"
    annotate.load_attempts(annotate.run_dirs(), cache, rebuild=True)
    cached = json.loads(cache.read_text())
    cache.write_text(json.dumps({**cached, "attempts": [{"id": "marker"}]}))
    for f in (run / "metrics.json", run / "stories" / "01" / "accept.json"):
        f.write_bytes(f.read_bytes())                                  # rewritten, same bytes
        os.utime(f, ns=(f.stat().st_atime_ns, f.stat().st_mtime_ns + MTIME_STEP_NS))
    assert annotate.load_attempts(annotate.run_dirs(), cache, rebuild=False) == [{"id": "marker"}]
    accept = run / "stories" / "01" / "accept.json"
    accept.write_text(accept.read_text().replace('"passed": 3', '"passed": 4'))
    assert [a["id"] for a in annotate.load_attempts(annotate.run_dirs(), cache, rebuild=False)] == [f"{RUN_REL}#01"]


MTIME_STEP_NS = 5_000_000_000


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve_main(monkeypatch, tmp_path, argv, probe):
    """Run annotate.main() as the command line does, against a tiny lake and a private repo in tmp_path. `probe`
    runs on another thread once the server answers; Ctrl-C is sent to main when it returns, as the owner would."""
    tiny_lake(tmp_path, monkeypatch)
    monkeypatch.setattr(packdir, "REPO_ROOT", tmp_path / "repo")
    private = packdir.private_checkout()
    private.mkdir()
    monkeypatch.setattr("sys.argv", ["annotate.py", *argv])
    seen, abandoned = {}, threading.Event()

    def run_probe():
        url = f"http://127.0.0.1:{argv[argv.index('--port') + 1]}/api/state"
        for _ in range(SERVER_WAIT_S * POLLS_PER_S):
            if abandoned.is_set():
                return  # main() ended on its own (it failed): nobody is left to interrupt
            try:
                with urllib.request.urlopen(url) as r:
                    seen["state"] = json.loads(r.read())
                    break
            except OSError:
                threading.Event().wait(1 / POLLS_PER_S)
        try:
            probe(seen)
        finally:
            _thread.interrupt_main()  # Ctrl-C

    t = threading.Thread(target=run_probe)
    t.start()
    try:
        annotate.main()
    finally:
        abandoned.set()
        t.join()
    return seen, private


def test_the_command_serves_the_attempts_and_stops_quietly_on_ctrl_c(tmp_path, monkeypatch, capsys):
    opened = threading.Event()
    urls = []
    monkeypatch.setattr(annotate.webbrowser, "open", lambda u: (urls.append(u), opened.set()))
    port = free_port()
    seen, private = serve_main(monkeypatch, tmp_path, ["--port", str(port), "--rebuild"],
                               lambda seen: opened.wait(SERVER_WAIT_S))
    out = capsys.readouterr().out
    assert [(a["id"], a["verdict"]) for a in seen["state"]] == [(f"{RUN_REL}#01", "")]
    assert "building attempts from the run records" in out
    assert f"1 attempts; labels in {private / 'analysis' / 'labels.csv'}" in out
    assert f"open http://127.0.0.1:{port}/  (Ctrl-C to stop)" in out
    assert urls == [f"http://127.0.0.1:{port}/"]  # the browser is opened on the page
    assert (private / "state" / "annotate" / "attempts.json").exists()


def test_the_command_with_no_browser_opens_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(annotate.webbrowser, "open", lambda u: pytest.fail("opened a browser"))
    port = free_port()
    seen, _ = serve_main(monkeypatch, tmp_path, ["--port", str(port), "--no-browser"],
                         lambda seen: threading.Event().wait(PAST_THE_BROWSER_TIMER_S))  # longer than the browser timer's delay
    assert len(seen["state"]) == 1 and f"open http://127.0.0.1:{port}/" in capsys.readouterr().out


def test_the_command_stops_when_there_is_no_private_repo(tmp_path, monkeypatch):
    monkeypatch.setattr(packdir, "REPO_ROOT", tmp_path / "repo")
    monkeypatch.setattr("sys.argv", ["annotate.py", "--no-browser"])
    with pytest.raises(SystemExit) as stop:
        annotate.main()
    assert str(stop.value) == f"no private repo at {tmp_path / 'awesome-local-ai-bench-private'}: the labels and attempt data belong there"


def test_the_command_stops_naming_bench_lakes_message_when_bench_lake_fails(tmp_path, monkeypatch):
    """The runs come only from bench-lake: when it cannot answer, the command stops with its message and reads no
    checkout instead."""
    monkeypatch.setattr(packdir, "REPO_ROOT", tmp_path / "repo")
    packdir.private_checkout().mkdir(parents=True)
    failing = tmp_path / "bench-lake"
    failing.write_text("#!/bin/sh\necho 'E-LAKE-UNREADABLE: permission denied' >&2\nexit 1\n")
    failing.chmod(0o755)
    monkeypatch.setenv(benchlake.BIN_ENV, str(failing))
    monkeypatch.setenv(benchlake.STATE_ENV, str(tmp_path / "state"))
    monkeypatch.setattr("sys.argv", ["annotate.py", "--no-browser"])
    with pytest.raises(SystemExit) as stop:
        annotate.main()
    assert str(stop.value) == "bench-lake records failed (exit 1): E-LAKE-UNREADABLE: permission denied"
