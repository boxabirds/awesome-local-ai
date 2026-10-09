"""Tests for the monitor's detector (monitor.py) and the triage runner's bookkeeping (triage.py).

Recorded inputs are in fixtures/: `dbench --json status`, `dbench --json nodes` and the benchmarker's /api/faults,
taken on 1 Oct 2026 with the machines renamed node-a … node-d (a: RTX 4090, b: M2, c: M5 Max, d: Strix Halo).

    uv run --quiet --with pytest pytest ops/monitor
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import monitor
import triage

FIX = Path(__file__).parent / "fixtures"
NOW = 1790874000.0          # 1 Oct 2026 17:00 UTC, just after the fixtures were recorded
MIN = 60


def load(name: str):
    return json.loads((FIX / name).read_text())


def ids(dets: list[dict]) -> set[str]:
    return {d["id"] for d in dets}


def kinds(dets: list[dict]) -> list[str]:
    return sorted(d["kind"] for d in dets)


# ---- machines are named by hardware, never by node name ------------------------------------------------------------

def test_labels_name_the_hardware():
    labels = monitor.machine_labels(load("nodes.json"))
    assert labels["node-a"] == "NVIDIA GeForce RTX 4090"
    assert labels["node-b"] == "Apple M2"
    assert labels["node-c"] == "Apple M5 Max"
    assert "RYZEN AI MAX+ 395" in labels["node-d"]


def test_redact_replaces_every_node_name_and_home_path():
    labels = {"node-c": "Apple M5 Max"}
    rec = {"id": "machine_idle:node-c", "detail": {"node": "node-c", "path": "/Users/tester/x and /home/someoneelse/y"}}
    out = monitor.redact(rec, labels)
    text = json.dumps(out)
    assert "node-c" not in text and "/Users/tester" not in text and "/home/someoneelse" not in text
    assert out["id"] == "machine_idle:Apple M5 Max"


# ---- the faults feed: one fault, one detection; a fault that goes is reported once ---------------------------------

def test_a_fault_is_detected_once_and_its_clearing_is_reported():
    feed = load("faults.json")["faults"]
    first, open_ = monitor.fault_detections(feed, {}, NOW)
    assert len(first) == len(feed) and all(d["kind"].startswith("fault.") for d in first)
    again, open2 = monitor.fault_detections(feed, open_, NOW + 600)
    assert again == []
    gone, open3 = monitor.fault_detections(feed[1:], open2, NOW + 1200)
    assert [d["kind"] for d in gone] == ["fault_cleared"]
    assert gone[0]["id"] == "cleared:" + feed[0]["id"] + f":{int(NOW + 1200)}"
    assert feed[0]["id"] not in open3


# ---- machines: idle, held, unreachable ----------------------------------------------------------------------------

def _nodes_state(status, nodes, prev=None, now=NOW):
    """One look at the machines, as a tick takes it: the conditions found, less those already logged. What was
    logged travels with the state under "_seen" (the tick keeps it beside the state in the same way)."""
    prev = prev or {}
    seen = dict(prev.get("_seen") or {})
    dets, st = monitor.node_detections(status, nodes, {k: v for k, v in prev.items() if k != "_seen"}, now)
    fresh = monitor.new_only(dets, seen, now)
    st["_seen"] = seen
    return fresh, st


def test_busy_machines_raise_nothing_new_on_a_second_look():
    status, nodes = load("status.json"), load("nodes.json")
    _, st = _nodes_state(status, nodes)
    dets, _ = _nodes_state(status, nodes, st, NOW + 5 * MIN)
    assert dets == []


def test_an_idle_machine_with_an_empty_queue_is_detected_once():
    status, nodes = load("status.json"), load("nodes.json")
    for j in status["node-c"]:
        j["state"] = {"status": "done", "exit_code": 0}
    dets, st = _nodes_state(status, nodes)
    assert "machine_idle" in kinds(dets)
    idle = next(d for d in dets if d["kind"] == "machine_idle")
    # logged for triage, never a notification: an idle machine is not an emergency (owner, 2 Oct 2026)
    assert idle["machine"] == "node-c" and not idle["urgent"]
    dets2, _ = _nodes_state(status, nodes, st, NOW + 10 * MIN)
    assert "machine_idle" not in kinds(dets2)


def test_queued_jobs_that_do_not_start_are_urgent_after_15_minutes():
    status, nodes = load("status.json"), load("nodes.json")
    for j in status["node-a"]:
        if j["state"]["status"] == "running":
            j["state"] = {"status": "done", "exit_code": 0}
    dets, st = _nodes_state(status, nodes)
    assert "queue_not_starting" not in kinds(dets)
    dets, st = _nodes_state(status, nodes, st, NOW + 16 * MIN)
    d = next(d for d in dets if d["kind"] == "queue_not_starting")
    assert d["urgent"] and d["machine"] == "node-a" and "held" in d["detail"]


def test_an_unreachable_machine_is_urgent_after_15_minutes():
    status, nodes = load("status.json"), load("nodes.json")
    nodes["node-d"]["status"] = "unreachable"
    dets, st = _nodes_state(status, nodes)
    assert [d["urgent"] for d in dets if d["kind"] == "machine_unreachable"] == [False]
    dets, _ = _nodes_state(status, nodes, st, NOW + 16 * MIN)
    assert [d["urgent"] for d in dets if d["kind"] == "machine_unreachable_15m"] == [True]


# ---- jobs: failed, restarted ---------------------------------------------------------------------------------------

def test_a_job_that_fails_or_restarts_is_detected():
    status, nodes = load("status.json"), load("nodes.json")
    _, st = _nodes_state(status, nodes)
    later = copy.deepcopy(status)
    run = next(j for j in later["node-d"] if j["state"]["status"] == "running")
    run["attempt"] = 2
    run["history"] = [{"at": NOW, "text": "harness exited 1 on attempt 1; restarting"}]
    dets, st = _nodes_state(later, nodes, st, NOW + 5 * MIN)
    d = next(d for d in dets if d["kind"] == "job_restarted")
    assert "harness exited 1" in d["detail"]
    run["state"] = {"status": "failed", "exit_code": 1, "reason": "harness exited 1 on attempt 4; all 3 restarts used"}
    dets, _ = _nodes_state(later, nodes, st, NOW + 10 * MIN)
    d = next(d for d in dets if d["kind"] == "job_failed")
    assert d["urgent"] and "all 3 restarts used" in d["detail"]


# ---- stories: stuck, and the wait for a fit machine ------------------------------------------------------------------

def test_a_story_that_does_not_move_is_flagged_at_20_and_urgent_at_30_minutes():
    status, nodes = load("status.json"), load("nodes.json")
    _, st = _nodes_state(status, nodes)
    dets, st = _nodes_state(status, nodes, st, NOW + 21 * MIN)
    stuck = [d for d in dets if d["kind"] == "story_no_progress" and d["machine"] == "node-d"]
    assert len(stuck) == 1 and not stuck[0]["urgent"]
    dets, st = _nodes_state(status, nodes, st, NOW + 31 * MIN)
    stuck = [d for d in dets if d["kind"] == "story_stuck" and d["machine"] == "node-d"]
    assert len(stuck) == 1 and stuck[0]["urgent"]
    dets, _ = _nodes_state(status, nodes, st, NOW + 41 * MIN)
    assert not [d for d in dets if d["machine"] == "node-d" and d["kind"].startswith("story_")]


def test_progress_resets_the_clock():
    status, nodes = load("status.json"), load("nodes.json")
    _, st = _nodes_state(status, nodes)
    moved = copy.deepcopy(status)
    for j in moved["node-d"]:
        for s in (j.get("progress") or {}).get("stories") or []:
            if s.get("status") == "running":
                s["calls"] += 5
    _, st = _nodes_state(moved, nodes, st, NOW + 19 * MIN)
    dets, _ = _nodes_state(moved, nodes, st, NOW + 30 * MIN)
    assert not [d for d in dets if d["machine"] == "node-d" and d["kind"].startswith("story_")]


def test_a_wait_for_a_fit_machine_is_not_a_stuck_story_until_two_hours():
    status, nodes = load("status.json"), load("nodes.json")
    run = next(j for j in status["node-b"] if j["state"]["status"] == "running")
    for s in run["progress"]["stories"]:
        if s.get("status") == "running":
            s["status"] = "pending"
    run["progress"]["log_tail"].append("  waiting for AC power, no Low Power Mode, nominal thermals: now {'thermal': 'heavy'}")
    _, st = _nodes_state(status, nodes)
    dets, st = _nodes_state(status, nodes, st, NOW + 45 * MIN)
    mine = [d for d in dets if d["machine"] == "node-b"]
    assert kinds(mine) == ["unfit_wait"] and not mine[0]["urgent"]
    dets, _ = _nodes_state(status, nodes, st, NOW + 121 * MIN)
    assert [d["urgent"] for d in dets if d["machine"] == "node-b" and d["kind"] == "unfit_wait_2h"] == [True]


# ---- records: a server's memory climbing story after story, with the restart exception -----------------------------

def _story(fp, server="s1", restarted=False):
    return {"fp_max": fp, "server_started": server, "restarted": restarted}


def test_a_footprint_that_climbs_on_one_server_is_a_leak_suspect():
    rows = {"5": _story(92.0), "7": _story(96.5)}
    assert monitor.leak_suspects(rows) == [("7", 92.0, 96.5)]


def test_no_leak_after_a_server_start_or_a_restarted_story():
    assert monitor.leak_suspects({"5": _story(92.0, "s1"), "7": _story(96.5, "s2")}) == []
    assert monitor.leak_suspects({"11": _story(81.0, restarted=True), "12": _story(93.0)}) == []
    assert monitor.leak_suspects({"5": _story(92.0), "7": _story(94.9)}) == []


def test_story_record_flags():
    row = monitor.story_row("12", {
        "status": "DONE", "agent": {"seconds": 1154, "steps": 47, "tool_calls": 50, "tokens": {"output": 56000}},
        "agent_commits": 1, "gate": {"all_green": False},
        "accept": {"build_exit": 0, "runner_exit": 1, "passed": 0, "total": 0, "by_story": {}, "harness_fault": None},
        "time_split": {"accounting": {"ok": True, "problems": []}}})
    flags = monitor.story_flags(row)
    assert "heldout-ran-no-tests" in flags and "gate-red-on-DONE" in flags
    ok = monitor.story_row("1", {
        "status": "DONE", "agent": {"seconds": 400, "steps": 20, "tool_calls": 22, "tokens": {"output": 30000}},
        "agent_commits": 1, "gate": {"all_green": True},
        "accept": {"build_exit": 0, "runner_exit": 0, "passed": 6, "total": 6, "by_story": {"01": {"passed": 6, "total": 6}}},
        "time_split": {"accounting": {"ok": True, "problems": []}}})
    assert monitor.story_flags(ok) == []


# ---- commits on main: someone else's, or a test's fixtures ---------------------------------------------------------

def test_commits_by_another_author_or_under_a_fixture_path_are_urgent():
    log = ("aaaaaaa1|The Owner|vidi x v2-r1: story 1 done\ncombinations/x/benchmarks/vidi/v2-r1/metrics.json\n"
           "bbbbbbb2|t|kat kat/combo r1: story 1 done\ncombinations/kat/combo/benchmarks/kat/r1/metrics.json\n")
    dets = monitor.commit_detections(log, "The Owner")
    assert kinds(dets) == ["commit_fixture_path", "commit_foreign_author"]
    assert all(d["urgent"] for d in dets)
    assert monitor.commit_detections("aaaaaaa1|The Owner|x\nops/anomaly-tracking.md\n", "The Owner") == []


# ---- only what is new is logged -------------------------------------------------------------------------------------

def test_new_only_keeps_first_sightings():
    seen: dict = {}
    a = [{"id": "x", "kind": "k"}, {"id": "y", "kind": "k"}]
    assert ids(monitor.new_only(a, seen, NOW)) == {"x", "y"}
    assert monitor.new_only(a + [{"id": "z", "kind": "k"}], seen, NOW + 1)[0]["id"] == "z"


# ---- times for the owner are UK local time --------------------------------------------------------------------------

def test_owner_times_are_uk_local():
    assert monitor.uk_time(1790874000) == "1 Oct 2026 18:00 BST"       # 17:00 UTC
    assert monitor.uk_time(1798761600).endswith("GMT")                  # 1 Jan 2027 00:00 UTC


# ---- the status the owner asked for ---------------------------------------------------------------------------------

def test_status_ok_when_triage_is_current():
    t = {"last_run": NOW - 20 * MIN, "outcome": "ok", "triaged_through": 40}
    s = monitor.compute_status(NOW, t, log_lines=40)
    assert s["state"] == "ok" and s["untriaged"] == 0


def test_status_says_detecting_only_when_triage_has_not_run():
    s = monitor.compute_status(NOW, {}, log_lines=3)
    assert s["state"].startswith("detecting only: triage has never run") and s["untriaged"] == 3
    t = {"last_run": NOW - 200 * MIN, "outcome": "ok", "triaged_through": 10}
    s = monitor.compute_status(NOW, t, log_lines=14)
    assert s["state"].startswith("detecting only: triage has not run since ") and "BST" in s["state"]
    assert s["untriaged"] == 4


def test_status_says_plainly_when_the_usage_limit_stopped_triage():
    t = {"last_run": NOW - 5 * MIN, "outcome": "usage_limit", "message": "Claude usage limit reached",
         "triaged_through": 10}
    s = monitor.compute_status(NOW, t, log_lines=17)
    assert s["state"] == ("triage stopped: Claude usage limit reached at 1 Oct 2026 17:55 BST; "
                          "detections are still being logged (7 waiting)")


def test_status_names_another_triage_failure_with_its_message():
    t = {"last_run": NOW - 5 * MIN, "outcome": "failed", "message": "exit 1: something else", "triaged_through": 0}
    s = monitor.compute_status(NOW, t, log_lines=2)
    assert s["state"].startswith("detecting only: triage failed at 1 Oct 2026 17:55 BST (exit 1: something else)")


def test_the_owner_is_notified_once_per_state_change():
    sent: list[str] = []
    st: dict = {}
    for state in ["ok", "ok", "triage stopped: Claude usage limit reached at X; detections are still being logged (1 waiting)",
                  "triage stopped: Claude usage limit reached at X; detections are still being logged (4 waiting)", "ok"]:
        monitor.notify_on_change(state, st, sent.append)
    assert len(sent) == 2 and sent[0].startswith("triage stopped") and sent[1] == "ok"


# ---- triage: what a Claude run's ending means -----------------------------------------------------------------------

def test_a_clean_run_is_ok():
    out = json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "triaged 3"})
    assert triage.classify(0, out, "") == ("ok", "triaged 3")


def test_usage_and_credit_limits_are_recognised_from_the_cli_s_own_words():
    for text in ("Claude usage limit reached. Your limit will reset at 7pm.",
                 "You've hit your limit · resets 7pm",
                 "You're out of extra usage",
                 "Credit balance is too low",
                 "Credit balance too low · Add funds",
                 '{"type":"error","error":{"type":"billing_error","message":"spend limit reached (daily)"}}',
                 '{"type":"error","error":{"type":"rate_limit_error","message":"x"}}',
                 "You've hit your monthly spend limit."):
        out = json.dumps({"type": "result", "is_error": True, "result": text})
        assert triage.classify(1, out, "")[0] == "usage_limit", text
        assert triage.classify(1, "", text)[0] == "usage_limit", text


def test_an_error_result_with_exit_0_is_still_a_failure():
    out = json.dumps({"type": "result", "is_error": True, "result": "API Error: 500"})
    kind, msg = triage.classify(0, out, "")
    assert kind == "failed" and "500" in msg


def test_other_failures_keep_their_exit_code_and_message():
    kind, msg = triage.classify(127, "", "claude: command not found")
    assert kind == "failed" and msg.startswith("exit 127: claude: command not found")


def test_pending_is_the_log_after_the_last_triaged_line(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_text("".join(json.dumps({"id": f"d{i}"}) + "\n" for i in range(5)))
    assert [d["id"] for d in triage.pending(log, 3)] == ["d3", "d4"]
    assert triage.pending(log, 5) == [] and triage.pending(tmp_path / "none.jsonl", 0) == []


def test_the_cli_s_json_output_is_a_list_of_events_ending_in_the_result():
    """`claude -p --output-format json` (2.1.285) prints one JSON array; the last `result` event says how it ended."""
    events = [{"type": "system", "subtype": "init"}, {"type": "assistant", "message": {}},
              {"type": "result", "subtype": "success", "is_error": False, "result": "triaged 17"}]
    assert triage.classify(0, json.dumps(events) + "\n\n", "") == ("ok", "triaged 17")
    events[-1] = {"type": "result", "subtype": "error_during_execution", "is_error": True,
                  "result": "Claude usage limit reached. Your limit will reset at 7pm."}
    assert triage.classify(0, json.dumps(events), "")[0] == "usage_limit"
    assert triage.classify(1, json.dumps(events), "")[0] == "usage_limit"


# ---- what is urgent: only what needs the owner now ----------------------------------------------------------------

REPAIR_LEFT_FINALIZE = {
    "rescore": "done",
    "repair": {"left": {"7": "its accounting check failed; recomputed from the full log, still so"}},
}


def test_an_accounting_check_the_repair_could_not_fix_is_logged_but_never_urgent():
    # It costs a story its time breakdown; no score, no machine and no run is at stake. On 8 Oct 2026 it raised an
    # "urgent" notification for a 9-second overrun on a 14-minute story.
    dets = monitor.record_detections("combos/x/benchmarks/vidi/v2-r1", {"stories": {}}, REPAIR_LEFT_FINALIZE, {"state": "finished"})
    left = [d for d in dets if d["kind"] == "repair_left"]
    assert len(left) == 1, "still logged, so triage sees it"
    assert not left[0]["urgent"]


def test_a_run_that_could_not_be_scored_is_urgent_only_when_it_needs_a_person():
    fin = {"rescore": "failed", "attempts": 2, "reason_kind": "x", "reason": "y"}
    for needs, expected in ((True, True), (False, False)):
        dets = monitor.record_detections("combos/x/benchmarks/vidi/v2-r1", {"stories": {}}, {**fin, "needs_person": needs}, {"state": "finished"})
        assert [d["urgent"] for d in dets if d["kind"] == "run_not_scored"] == [expected]


# ---- the backup (ops/backup/backup.py writes state/backups/status.json after every run) ----

HOUR = 3600.0
GB = 1_000_000_000


def backup_status(at, local=None, remote=None):
    """What backup.py writes: per repository, whether the last run worked, the last good time, the capacity forecast."""
    ok = lambda last, cap: {"ok": True, "last_good": last, "capacity": cap, "staleness": {"status": "ok", "message": ""}}
    quiet = {"status": "ok", "days_left": 400.0, "growth_per_day": 0.1 * GB, "free_bytes": 40 * GB, "message": "400 days of room"}
    return {"at": at, "exit": 0, "warnings": [], "repos": {
        "/Users/someone/bench-backup-local/repo": local or ok(at, quiet),
        "sftp:node-a:/home/someone/bench-backup/repo": remote or ok(at, quiet)}}


def test_a_healthy_backup_raises_nothing():
    assert monitor.backup_detections(backup_status(NOW - 2 * HOUR), NOW) == []


def test_no_status_file_raises_nothing():
    assert monitor.backup_detections(None, NOW) == []


def test_a_repository_whose_last_good_backup_is_over_36_hours_old_is_detected_once_a_day_and_is_not_urgent():
    s = backup_status(NOW - 2 * HOUR)
    s["repos"]["sftp:node-a:/home/someone/bench-backup/repo"]["last_good"] = NOW - 40 * HOUR
    d = monitor.backup_detections(s, NOW)
    assert kinds(d) == ["backup_stale"] and not d[0]["urgent"]
    assert "remote" in d[0]["detail"] and "40 hours" in d[0]["detail"]
    assert d[0]["id"] == monitor.backup_detections(s, NOW + 3 * HOUR)[0]["id"], "the same day, the same detection"
    assert d[0]["id"] != monitor.backup_detections(s, NOW + 30 * HOUR)[0]["id"], "a new day, raised again"


def test_the_job_not_running_at_all_is_stale_too_since_staleness_is_judged_now_not_when_the_status_was_written():
    s = backup_status(NOW - 50 * HOUR)       # nothing has run for 50 hours; both repositories looked fine when last written
    assert kinds(monitor.backup_detections(s, NOW)) == ["backup_stale", "backup_stale"]


def test_a_failed_run_is_detected_once_per_run_with_the_reason():
    s = backup_status(NOW - 1 * HOUR)
    s["repos"]["/Users/someone/bench-backup-local/repo"].update(ok=False, error="backup failed: disk full")
    d = monitor.backup_detections(s, NOW)
    assert kinds(d) == ["backup_failed"] and "local" in d[0]["detail"] and "disk full" in d[0]["detail"]
    assert monitor.backup_detections(s, NOW + HOUR)[0]["id"] == d[0]["id"]


def test_under_a_month_of_room_is_detected_as_a_fact_with_its_numbers_and_no_remedy():
    s = backup_status(NOW - HOUR)
    s["repos"]["/Users/someone/bench-backup-local/repo"]["capacity"] = {
        "status": "warn", "days_left": 12.0, "growth_per_day": 4 * GB, "free_bytes": 48 * GB,
        "message": "less than a month left: 12 days of room at 4.0 GB a day; 48.0 GB free"}
    d = monitor.backup_detections(s, NOW)
    assert kinds(d) == ["backup_capacity"] and not d[0]["urgent"]
    assert "12 days of room at 4.0 GB a day" in d[0]["detail"] and "local" in d[0]["detail"]


def test_a_repository_with_no_history_yet_raises_nothing_about_capacity():
    s = backup_status(NOW - HOUR)
    s["repos"]["/Users/someone/bench-backup-local/repo"]["capacity"] = {"status": "no-history", "days_left": None, "message": "not enough history yet"}
    assert monitor.backup_detections(s, NOW) == []


def test_the_detail_names_no_machine_and_no_home_directory_after_the_ticks_redaction():
    s = backup_status(NOW - 40 * HOUR)
    d = monitor.backup_detections(s, NOW)
    labels = {"node-a": "RTX 4090"}
    text = json.dumps(monitor.redact(d, labels))
    assert "node-a" not in text and "/Users/someone" not in text
