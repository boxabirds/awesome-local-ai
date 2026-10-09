"""reread_finish.py: a story the harness recorded PARTIAL because it could not read the agent's reply is re-read.

Why: gufo-opencode v2-gufoopencode-r1 story 1, 8 Oct 2026. The agent ended with `STORY 1 DONE <hash>` on a clean tree and held-out 6/6;
the harness read OpenCode's events as an empty reply, sent the stop message, and recorded PARTIAL (ended by the operator). Fixed
parser, same events: the story finished at the stop message, as STOP_MESSAGE_THEN_FINISHED.
"""
import json
from pathlib import Path

import pytest

import reread_finish as rf

HASH = "0e77fa2ffd7d7b74e018ad96ef7dd599738e2709"
FIXTURE = Path(__file__).parent / "fixtures" / "opencode-stream.jsonl"


def oc_text(mid, text, rx):
    return json.dumps({"_rx": rx, "type": "text", "part": {"type": "text", "messageID": mid, "text": text}}) + "\n"


def run_with(tmp_path, commit=HASH, reply=f"STORY 1 DONE {HASH}", status="PARTIAL", end_reason="stop-message-exhausted"):
    run = tmp_path / "run"
    (run / "stories" / "01").mkdir(parents=True)
    events = (run / "stories" / "01" / "agent-events.jsonl")
    events.write_text(FIXTURE.read_text() + oc_text("msg_z", reply, 1791501270.0))
    agent = {"seconds": 10.0, "steps": 6, "nudges": 1, "finished": False, "ended_by_operator": True, "exit": 0, "errors": []}
    rec = {"title": "Pan", "started": 1791500830.0, "agent_finished": 1791501300.0, "commit": commit, "status": status,
           "ended_by": "operator", "end_reason": end_reason, "agent": agent, "accept": {"passed": 6, "total": 6},
           "skip": {"story": 1, "reason": "story cap", "by": rf_stop_by()}, "verdict": {"verdict": "green"}, "conversation": None}
    entry = {"id": 1, "status": status, "ended_by": "operator", "accept": {"passed": 6, "total": 6}, "reason": "story cap",
             "by": rf_stop_by(), "requested_at": 1.0, "verdict": "green", "health": {"verdict": "green"}}
    (run / "metrics.json").write_text(json.dumps({"stories": {"1": rec}, "processed": [entry]}))
    return run


def rf_stop_by():
    import drive
    return drive.STOP_SENT_BY


def metrics(run):
    return json.loads((run / "metrics.json").read_text())


def test_a_story_that_did_finish_is_recorded_as_finished_with_its_profile(tmp_path):
    run = run_with(tmp_path)
    assert rf.reread(run, 1) is True
    m = metrics(run)
    rec, entry = m["stories"]["1"], m["processed"][0]
    assert rec["status"] == entry["status"] == "DONE" and rec["ended_by"] == entry["ended_by"] == "agent"
    assert rec["end_reason"] == "stop-message-then-finished", "the stop message really was sent; it is not erased"
    assert rec["agent"]["finished"] is True and rec["agent"]["nudges"] == 1
    assert "skip" not in rec and "verdict" not in rec
    assert not {"reason", "by", "requested_at", "verdict", "health"} & set(entry)
    assert rec["accept"] == {"passed": 6, "total": 6}, "the held-out result is not touched"
    assert rec["conversation"]["calls"] == 6, "the profile is read from the events with the fixed parser"
    assert "re-read with the fixed reader" in (run / "interventions.md").read_text()


def test_it_is_idempotent(tmp_path):
    run = run_with(tmp_path)
    rf.reread(run, 1)
    before = (run / "metrics.json").read_text(), (run / "interventions.md").read_text()
    assert rf.reread(run, 1) is False
    assert before == ((run / "metrics.json").read_text(), (run / "interventions.md").read_text())


@pytest.mark.parametrize("kw", [
    {"reply": "I think I am done"},                       # no DONE line
    {"reply": "STORY 1 DONE 1234567"},                    # a hash that is not the story's commit
    {"commit": "ffffffffffffffffffffffffffffffffffffffff"},  # the harness had to snapshot uncommitted work: not a clean finish
    {"status": "DONE", "end_reason": "agent-finished"},   # not a story the old reader failed
    {"end_reason": "cap-time"},                     # ended for another reason
])
def test_it_leaves_alone_a_story_the_evidence_does_not_show_finished(tmp_path, kw):
    run = run_with(tmp_path, **kw)
    before = (run / "metrics.json").read_text()
    assert rf.reread(run, 1) is False
    assert (run / "metrics.json").read_text() == before and not (run / "interventions.md").exists()
