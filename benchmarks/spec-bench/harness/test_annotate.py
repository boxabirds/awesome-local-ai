"""annotate.py: attempts built from the run records, ordered for coverage, labels saved safely."""
import _thread
import csv
import gzip
import json
import socket
import threading
import urllib.request

import pytest

import annotate
from conftest import record_before_archive
import heldout
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


REAL_PRIVATE = annotate.REPO.parent / "awesome-local-ai-bench-private"


# The current records hold this many story attempts or more (99 on 4 Oct 2026, after the v1 runs were archived).
FEWEST_REAL_ATTEMPTS = 90
PI03 = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/canvas-pi-03"   # archived 4 Oct 2026


# The real runs' held-out detail is in the private repo's copy (the public record keeps counts): read it there,
# read-only, and skip where it isn't checked out.
@pytest.mark.skipif(not (REAL_PRIVATE / heldout.PRIVATE_RUNS).is_dir(), reason="no private repo copy of the runs")
def test_attempts_build_from_the_real_records(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(REAL_PRIVATE))
    attempts = annotate.load_attempts(annotate.REPO, tmp_path / "cache.json", rebuild=True)
    ids = {a["id"] for a in attempts}
    assert len(ids) == len(attempts) and len(attempts) >= FEWEST_REAL_ATTEMPTS
    # cached on the second load
    again = annotate.load_attempts(annotate.REPO, tmp_path / "cache.json", rebuild=False)
    assert [a["id"] for a in again] == [a["id"] for a in attempts]
    # One attempt checked in detail: the 4090's story 7, from the record as it was before it was archived.
    old = tmp_path / "before-archive"
    record_before_archive(PI03, old)
    pi03_s7 = next(a for a in annotate.load_attempts(old, tmp_path / "old-cache.json", rebuild=True) if a["id"].endswith(f"{PI03}#07"))
    assert pi03_s7["title"].startswith("Select") and pi03_s7["timeline"] and pi03_s7["commits"]
    assert pi03_s7["behaviour"]["own_total"] == 8


def test_review_leaves_out_known_good_runs(tmp_path):
    """EVALUATION-POLICY rule 7: partial reruns are diagnostic and never mixed with full runs."""
    runs = tmp_path / "combinations" / "some" / "stack" / "benchmarks" / "vidi"
    for name, extra in (("full-01", {}), ("kg-3", {"known_good": {"from_run": "x", "commit": "c", "story": 3}})):
        (runs / name).mkdir(parents=True)
        (runs / name / "metrics.json").write_text(json.dumps({"stories": {}, **extra}))
    assert [p.name for p in annotate.run_dirs(tmp_path)] == ["full-01"]


SERVER_WAIT_S = 20            # how long a test waits for the review server to answer before giving up
POLLS_PER_S = 10
PAST_THE_BROWSER_TIMER_S = 1.0  # the command opens the browser 0.5 s after it starts
RUN_REL = "combinations/qwen/27b/benchmarks/vidi/run-1"


def tiny_repo(root, gate=True):
    """A repo with one recorded run: story 1 has results and an event stream; story 2 has results but no events."""
    run = root / RUN_REL
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


def test_a_story_without_a_self_check_file_has_no_self_check_verdict(tmp_path):
    run = tiny_repo(tmp_path, gate=False)
    metrics = json.loads((run / "metrics.json").read_text())
    got = annotate.build_attempt(run, tmp_path, run / "stories" / "01", metrics, "")
    assert got["self_check_green"] is None
    assert got["story"] == 1 and got["stack"] == "qwen/27b"
    assert got["behaviour"]["failed"] == [{"title": "pans", "error": "boom"}]  # first line of the error only


def test_a_story_with_a_self_check_file_carries_its_verdict(tmp_path):
    run = tiny_repo(tmp_path)
    metrics = json.loads((run / "metrics.json").read_text())
    got = annotate.build_attempt(run, tmp_path, run / "stories" / "01", metrics, "")
    assert got["self_check_green"] is True
    assert got["completion"]["agent_minutes"] == 1.5 and got["behaviour"]["own_total"] == 2
    assert got["timeline"][0]["text"] == "read a.ts"


def test_a_story_with_results_but_no_event_stream_is_left_out_of_the_attempts(tmp_path):
    tiny_repo(tmp_path)
    attempts = annotate.load_attempts(tmp_path, tmp_path / "cache" / "attempts.json", rebuild=True)
    assert [a["id"] for a in attempts] == [f"{RUN_REL}#01"]  # story 02 had no events
    assert json.loads((tmp_path / "cache" / "attempts.json").read_text())["attempts"] == attempts


def test_a_cache_from_other_records_is_rebuilt_and_one_from_these_is_reused(tmp_path):
    tiny_repo(tmp_path)
    cache = tmp_path / "attempts.json"
    cache.write_text(json.dumps({"fingerprint": "from-other-records", "attempts": [{"id": "stale"}]}))
    rebuilt = annotate.load_attempts(tmp_path, cache, rebuild=False)
    assert [a["id"] for a in rebuilt] == [f"{RUN_REL}#01"]
    cached = json.loads(cache.read_text())
    cached["attempts"] = [{"id": "marker"}]
    cache.write_text(json.dumps(cached))
    assert annotate.load_attempts(tmp_path, cache, rebuild=False) == [{"id": "marker"}]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve_main(monkeypatch, tmp_path, argv, probe):
    """Run annotate.main() as the command line does, against a tiny repo and a private repo in tmp_path. `probe`
    runs on another thread once the server answers; Ctrl-C is sent to main when it returns, as the owner would."""
    tiny_repo(tmp_path / "repo")
    monkeypatch.setattr(annotate, "REPO", tmp_path / "repo")
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
