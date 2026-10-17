"""Every reader of a story's agent events gives the same answer from the raw log (stories/NN/agent-events.jsonl)
as from its compact copy (agent-events.compact.jsonl.gz), which the harness no longer writes but 99 reference
runs still have alone.

The raw log holds the per-token stream deltas (message_update, tool_execution_update) the compact copy dropped
(but for the first of each model call). A reader written against the compact shape may count or time them wrongly,
so each test here feeds the same real excerpt in both forms and asserts one answer.

fixtures/events/<client>/ holds real excerpts from the lake (pi: mtplx-pi v2-mtplx2122-r1 story 12, lines 1-124
and 979-1009, so it has 877-style deltas, a tool_execution_update and three agent restarts; opencode: gufo-opencode
v2-gufoopencode-r1 story 1, first 145 KB; Claude Code: the stream the repo's other tests use), each beside the
compact copy drive.compact_events made of exactly that excerpt.
"""
from __future__ import annotations

import gzip
import json
import shutil
from pathlib import Path

import pytest

import annotate
import backfill_timing
import claims
import heldout
import history
import logscan
import recount_tokens

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "events"
RAW = "agent-events.jsonl"
COMPACT = "agent-events.compact.jsonl.gz"
CLIENTS = ("pi", "opencode", "claude")
SID = "07"
FORMS = ("raw", "compact")


def _story_dir(run: Path, client: str, form: str) -> Path:
    d = run / "stories" / SID
    d.mkdir(parents=True, exist_ok=True)
    name = RAW if form == "raw" else COMPACT
    shutil.copy(FIXTURES / client / name, d / name)
    return d


def _run(tmp_path: Path, client: str, form: str) -> Path:
    run = tmp_path / form / client
    _story_dir(run, client, form)
    return run


def _delta_lines(path: Path) -> int:
    return sum('"message_update"' in l or '"tool_execution_update"' in l for l in path.read_text().splitlines())


def test_the_raw_excerpts_really_hold_the_deltas_the_compact_ones_dropped():
    raw, compact = FIXTURES / "pi" / RAW, FIXTURES / "pi" / COMPACT
    kept = sum('"message_update"' in l or '"tool_execution_update"' in l for l in gzip.open(compact, "rt"))
    assert _delta_lines(raw) > 100 > kept
    assert any('"tool_execution_update"' in l for l in raw.read_text().splitlines())
    assert sum('"type":"session"' in l for l in raw.read_text().splitlines()) >= 2


@pytest.mark.parametrize("client", CLIENTS)
def test_claims_are_the_same_from_raw_and_compact(tmp_path, client):
    got = {}
    for form in FORMS:
        run = _run(tmp_path, client, form)
        out = tmp_path / f"claims-{form}-{client}"
        ids = claims.write_claims(run, out)
        got[form] = (ids, {f.name: f.read_text() for f in sorted(out.iterdir())})
    assert got["raw"] == got["compact"]
    if client == "claude":                       # its excerpt ends in a result event: a claim to compare
        assert got["raw"][0] == [SID]


@pytest.mark.parametrize("client", CLIENTS)
def test_the_timeline_and_claim_of_an_attempt_are_the_same_from_raw_and_compact(tmp_path, client):
    got = {}
    for form in FORMS:
        sdir = _story_dir(tmp_path / form / client, client, form)
        lines = claims.event_lines(sdir)
        got[form] = (annotate.timeline(lines), claims.final_message(lines))
    assert got["raw"] == got["compact"]
    assert got["raw"][0]


def test_an_attempt_is_built_from_a_story_that_has_only_its_raw_log(tmp_path):
    """build_attempt used to skip a story with no compact log."""
    out = {}
    for form in FORMS:
        repo = tmp_path / f"repo-{form}"
        run = repo / "benchmarks" / "reference" / "vidi" / "m" / "run-1"
        _story_dir(run, "pi", form)
        (run / "stories" / SID / "accept.json").write_text(json.dumps({"passed": 1, "total": 2, "tests": [], "by_story": {}}))
        (run / "metrics.json").write_text(json.dumps({"stories": {SID: {"title": "t", "status": "done", "agent": {}}}}))
        metrics = json.loads((run / "metrics.json").read_text())
        out[form] = annotate.build_attempt(run, repo, run / "stories" / SID, metrics, "")
    assert out["raw"] is not None
    assert {k: v for k, v in out["raw"].items() if k != "id"} == {k: v for k, v in out["compact"].items() if k != "id"}


@pytest.mark.parametrize("client", CLIENTS)
def test_event_times_are_the_same_from_raw_and_compact(tmp_path, client):
    got = {form: history._event_times(_run(tmp_path, client, form), SID) for form in FORMS}
    assert got["raw"] == got["compact"]
    assert got["raw"]


@pytest.mark.parametrize("client", CLIENTS)
def test_recounted_tokens_are_the_same_from_raw_and_compact(tmp_path, client):
    got = {}
    for form in FORMS:
        run = _run(tmp_path, client, form)
        (run / "metrics.json").write_text(json.dumps({"client": client, "stories": {"7": {"agent": {}}}}))
        row = recount_tokens.recount(run)[0]
        got[form] = row["recomputed"]
        assert row["log"].endswith(RAW if form == "raw" else COMPACT)
    assert got["raw"] == got["compact"]
    assert any(got["raw"].values())


@pytest.mark.parametrize("client", CLIENTS)
def test_the_outside_workspace_verdict_is_the_same_from_raw_and_compact(tmp_path, client):
    got = {}
    for form in FORMS:
        run = _run(tmp_path, client, form)
        verdicts = logscan.scan_run(run, logscan.Context(known_runs=frozenset()))
        got[form] = {sid: {k: v for k, v in v.items() if k != "log"} for sid, v in verdicts.items()}
        assert verdicts[SID]["log"]["file"].endswith(RAW if form == "raw" else COMPACT)
    assert got["raw"] == got["compact"]


def _pi_run_with_record(tmp_path: Path, form: str) -> Path:
    run = _run(tmp_path, "pi", form)
    times = [json.loads(l)["_rx"] for l in (FIXTURES / "pi" / RAW).read_text().splitlines()]
    last_session = [json.loads(l)["_rx"] for l in (FIXTURES / "pi" / RAW).read_text().splitlines()
                    if json.loads(l)["type"] == "session"][-1]
    agent = {"seconds": times[-1] - last_session, "steps": 1, "tool_calls": 0, "compactions": 0,
             "tokens": {"input": 0, "output": 0}, "sessions": ["s"], "nudges": 0}
    heldout.save_metrics(run, {"client": "pi", "stories": {"7": {
        "started": last_session, "agent_finished": times[-1], "agent": agent}},
        "processed": [{"id": 7, "agent_minutes": 0, "calls": 1, "output_tokens": 0, "compactions": 0}]})
    return run


def test_a_restarted_story_is_recomputed_the_same_from_raw_and_compact(tmp_path):
    got = {}
    for form in FORMS:
        run = _pi_run_with_record(tmp_path, form)
        assert backfill_timing.backfill_attempts(run) == ["7"]
        rec = heldout.load_metrics(run)["stories"]["7"]
        rec.pop("time_split", None)
        rec.pop("time_split_covers", None)
        got[form] = rec["agent"]
    assert got["raw"] == got["compact"]
    assert got["raw"]["harness_attempts"] >= 2 or got["raw"]["restarted"]


def test_backfill_all_no_longer_rebuilds_compact_logs(tmp_path):
    run = _pi_run_with_record(tmp_path, "raw")
    report = backfill_timing.backfill_all(run)
    assert "events" not in report
    assert not (run / "stories" / SID / COMPACT).exists()


def test_a_home_path_in_the_raw_log_reads_as_the_compact_copy_wrote_it(tmp_path):
    """The compact copy redacted this machine's home directory; a claim read from the raw log must not carry it."""
    sdir = tmp_path / "stories" / SID
    sdir.mkdir(parents=True)
    line = json.dumps({"_rx": 1.0, "type": "result", "result": f"done; see {Path.home()}/package.json"})
    (sdir / RAW).write_text(line + "\n")
    assert claims.final_message(claims.event_lines(sdir)) == "done; see ~/package.json"
