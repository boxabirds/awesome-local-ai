"""The conversation fixture: one case per cell of the matrix the conversation pages can show.

Dimensions, and the cell each story run covers (MECE: every cell once, nothing twice):
  availability   complete (SWIFT v2-r5 s2, OPUS run-9 s1) | growing (SWIFT v2-r1 s1) | none, with a split (SWIFT v2-r5 s1)
                 | none, no split (OPUS run-9 s2) | no record directory (the fixture's job-only rows: storyRunId null)
  format         pi, thinking visible (SWIFT v2-r5 s2) | claude, thinking withheld (OPUS run-9 s1)
  event kinds    all nine in SWIFT v2-r5 s2; a few in the others
  text           inline (every call) | cut head/tail/chars (SWIFT s2 call 2's thinking, tool 1's result)
                 | more than five lines (SWIFT s2 call 4's text: folded behind the + button) | search hits ("harness" in call 3)
  tools          ended, ok (t0) | ended, error with test counts (t1) | started, never ended (t2) | subagent (OPUS t0, sub 1)
  calls          tokens known | tokens null (SWIFT s2 call 4) | stop reason null (OPUS call 1)
  requests       matched to a call (r0) | late-placed: earlier time, later ord (r1) | condition with gpu null (c1)
  ordering       two events at the same millisecond (SWIFT s2 tool_end t0 and call 1)
  paging         SWIFT s2 has 17 events (pages of 3 and 7 leave a short last page); OPUS s1 has exactly 6 (a page of 6 is exact)
  fault words    verbatim agent text holds "harness", "attempt 2", "invalid" (SWIFT s2 call 3's text, on the conversation page)
                 and "retry" (call 2's thinking, on the call page): never the app's own words
Written into e2e/fixture.json's "conversations" by:  python3 e2e/fixtures/conversations.py
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWIFT = "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi"
OPUS = "benchmarks/reference/vidi/opus-5.5"
T0 = 1790000000000  # ms

def cut(text):  # a cut text as the warehouse writes one over 4,000 characters
    return {"head": text[:400], "tail": text[-700:], "chars": len(text)}

def inline(text):
    return {"text": text}

LONG = ("Let me think about the harness and whether a retry is needed. " * 90)  # > 4000 chars, with fault words
RESULT_LONG = ("line of output with attempt 2 noted\n" * 200)
SEVEN_LINES = "Story 2 is done.\nPan works.\nZoom works.\nTests pass.\nLint passes.\nBuild passes.\nCommitted."  # more than five lines: folded behind +

def swift_s2():
    ev = []
    def push(t, k, ref, **p): ev.append({"tMs": t, "kind": k, "refIdx": ref, **p})
    push(T0 + 0, "msg", 0, idx=0, role="user", chars=22, textBody=inline("Implement story 2 now."))
    push(T0 + 1000, "between_sessions", 0, idx=0, endMs=T0 + 3000, seconds=2.0)
    push(T0 + 5000, "call", 0, idx=0, think=120, text=40, nTools=1, outTok=300, inTok=1500, cacheTok=0, stop="toolUse", sub=0, thinkFlags=[], textFlags=[],
         sentMs=T0 + 3200, firstMs=T0 + 4000, thinking=inline("I should look at the spec first; the harness is invalid to mention but here it is."), textBody=inline("Reading the spec."))
    push(T0 + 5000, "tool_start", 0, idx=0, callIdx=0, name="read", toolKind="read", arg="spec/story-2.md", argChars=30, sub=0, argFlags=[])
    push(T0 + 7000, "tool_end", 0, idx=0, callIdx=0, name="read", toolKind="read", error=0, resChars=5000, resFlags=["truncated_output"], passed=None, failed=None, flaky=None, skipped=None, seconds=2.0, result=cut(RESULT_LONG))
    push(T0 + 7000, "call", 1, idx=1, think=4800, text=10, nTools=1, outTok=900, inTok=1800, cacheTok=1500, stop="toolUse", sub=0, thinkFlags=["eval_aware"], textFlags=[],
         sentMs=T0 + 7000, firstMs=T0 + 7500, thinking=cut(LONG), textBody=inline("Running the tests."))
    push(T0 + 9000, "tool_start", 1, idx=1, callIdx=1, name="bash", toolKind="unit", arg="npm test", argChars=20, sub=0, argFlags=[])
    push(T0 + 15000, "tool_end", 1, idx=1, callIdx=1, name="bash", toolKind="unit", error=1, resChars=800, resFlags=["tests_failed", "tests_passed"], passed=9, failed=1, flaky=0, skipped=None, seconds=6.0, result=inline("Tests: 1 failed, 9 passed\nattempt 2 of the suite"))
    push(T0 + 16000, "compaction_start", 0, idx=0, reason="context")
    push(T0 + 19000, "compaction_end", 0, idx=0, reason="context", summaryChars=1200, seconds=3.0)
    push(T0 + 21000, "call", 2, idx=2, think=0, text=60, nTools=1, outTok=120, inTok=900, cacheTok=0, stop="toolUse", sub=0, thinkFlags=[], textFlags=["claims_done"],
         sentMs=T0 + 19500, firstMs=T0 + 20000, thinking=inline(""), textBody=inline("Fixing the failing test; the harness said attempt 2 was invalid, then everything is complete."))
    push(T0 + 21500, "tool_start", 2, idx=2, callIdx=2, name="bash", toolKind="bash", arg="npm run dev &", argChars=18, sub=0, argFlags=[])
    push(T0 + 30000, "call", 3, idx=3, think=50, text=20, nTools=0, outTok=None, inTok=None, cacheTok=None, stop="endTurn", sub=0, thinkFlags=[], textFlags=[],
         sentMs=T0 + 29000, firstMs=T0 + 29500, thinking=inline("Done."), textBody=inline(SEVEN_LINES))
    push(T0 + 31000, "request", 0, idx=0, callIdx=2, promptTok=900, prefillTok=900, generatedTok=120, cachedTok=0, prefillS=0.4, decodeS=1.2, ttftS=None, prefillTokS=2250.0, decodeTokS=100.0, draftAccepted=40, draftProposed=60, meanLen=2.7)
    push(T0 + 32000, "condition", 0, ac=1, lowPower=0, thermal="nominal", swapGb=0.0, freePct=41.5, footprintGb=58.2, gpu={"busyPct": 97.0, "sclkMhz": 2500, "memGb": 22.1, "tempC": 71.0, "powerW": 310.0, "throttle": None})
    push(T0 + 33000, "condition", 1, ac=1, lowPower=0, thermal="nominal", swapGb=0.1, freePct=40.0, footprintGb=58.4, gpu=None)
    # Late-placed: an engine request whose time is early (call 0) but which arrived after everything else.
    push(T0 + 4900, "request", 1, idx=1, callIdx=0, promptTok=1500, prefillTok=1500, generatedTok=300, cachedTok=0, prefillS=0.8, decodeS=2.0, ttftS=None, prefillTokS=1875.0, decodeTokS=150.0, draftAccepted=None, draftProposed=None, meanLen=None)
    for i, e in enumerate(ev): e["ord"] = i
    calls = {
        "0": {"idx": 0, "rx": T0 / 1000 + 5, "think": 120, "text": 40, "nTools": 1, "outTok": 300, "inTok": 1500, "cacheTok": 0, "stop": "toolUse", "sub": 0, "thinkFlags": "", "textFlags": "",
              "thinking": "I should look at the spec first; the harness is invalid to mention but here it is.", "text": "Reading the spec.", "sent": T0 / 1000 + 3.2, "first": T0 / 1000 + 4.0,
              "tools": [{"idx": 0, "callIdx": 0, "id": "t0", "name": "read", "kind": "read", "arg": "spec/story-2.md", "argChars": 30, "start": T0 / 1000 + 5, "end": T0 / 1000 + 7, "error": 0, "resChars": 5000, "sub": 0, "argFlags": "", "resFlags": "truncated_output", "nEdits": 0, "oldChars": 0, "newChars": 0, "passed": None, "failed": None, "flaky": None, "skipped": None, "args": {"path": "spec/story-2.md"}, "result": RESULT_LONG}]},
        "1": {"idx": 1, "rx": T0 / 1000 + 7, "think": 4800, "text": 10, "nTools": 1, "outTok": 900, "inTok": 1800, "cacheTok": 1500, "stop": "toolUse", "sub": 0, "thinkFlags": "eval_aware", "textFlags": "",
              "thinking": LONG, "text": "Running the tests.", "sent": T0 / 1000 + 7, "first": T0 / 1000 + 7.5,
              "tools": [{"idx": 1, "callIdx": 1, "id": "t1", "name": "bash", "kind": "unit", "arg": "npm test", "argChars": 20, "start": T0 / 1000 + 9, "end": T0 / 1000 + 15, "error": 1, "resChars": 800, "sub": 0, "argFlags": "", "resFlags": "tests_failed,tests_passed", "nEdits": 0, "oldChars": 0, "newChars": 0, "passed": 9, "failed": 1, "flaky": 0, "skipped": None, "args": {"command": "npm test"}, "result": "Tests: 1 failed, 9 passed\nattempt 2 of the suite"}]},
        "2": {"idx": 2, "rx": T0 / 1000 + 21, "think": 0, "text": 60, "nTools": 1, "outTok": 120, "inTok": 900, "cacheTok": 0, "stop": "toolUse", "sub": 0, "thinkFlags": "", "textFlags": "claims_done", "thinking": "", "text": "Fixing the failing test; the harness said attempt 2 was invalid, then everything is complete.", "sent": T0 / 1000 + 19.5, "first": T0 / 1000 + 20, "tools": [
            {"idx": 2, "callIdx": 2, "id": "t2", "name": "bash", "kind": "bash", "arg": "npm run dev &", "argChars": 18, "start": T0 / 1000 + 21.5, "end": None, "error": None, "resChars": None, "sub": 0, "argFlags": "", "resFlags": "", "nEdits": 0, "oldChars": 0, "newChars": 0, "passed": None, "failed": None, "flaky": None, "skipped": None, "args": {"command": "npm run dev &"}, "result": None}]},
        "3": {"idx": 3, "rx": T0 / 1000 + 30, "think": 50, "text": 20, "nTools": 0, "outTok": None, "inTok": None, "cacheTok": None, "stop": "endTurn", "sub": 0, "thinkFlags": "", "textFlags": "", "thinking": "Done.", "text": SEVEN_LINES, "sent": T0 / 1000 + 29, "first": T0 / 1000 + 29.5, "tools": []},
    }
    tools = {str(t["idx"]): t for c in calls.values() for t in c["tools"]}
    return {"fmt": "pi", "complete": True, "node": "node-a", "events": ev, "calls": calls, "tools": tools}

def opus_s1():
    ev = []
    def push(t, k, ref, **p): ev.append({"tMs": t, "kind": k, "refIdx": ref, **p})
    push(T0 + 0, "msg", 0, idx=0, role="user", chars=15, textBody=inline("Build story 1."))
    push(T0 + 4000, "call", 0, idx=0, think=0, text=30, nTools=1, outTok=200, inTok=2000, cacheTok=1000, stop="tool_use", sub=0, thinkFlags=[], textFlags=[], sentMs=T0 + 500, firstMs=T0 + 2000, thinking=None, textBody=inline("Delegating to a subagent."))
    push(T0 + 4000, "tool_start", 0, idx=0, callIdx=0, name="Task", toolKind="task", arg="explore the repo", argChars=40, sub=1, argFlags=[])
    push(T0 + 9000, "tool_end", 0, idx=0, callIdx=0, name="Task", toolKind="task", error=0, resChars=300, resFlags=[], passed=None, failed=None, flaky=None, skipped=None, seconds=5.0, result=inline("Found the files."))
    push(T0 + 12000, "call", 1, idx=1, think=0, text=12, nTools=0, outTok=50, inTok=2300, cacheTok=2000, stop=None, sub=0, thinkFlags=[], textFlags=[], sentMs=T0 + 9000, firstMs=T0 + 11000, thinking=None, textBody=inline("All done here."))
    push(T0 + 13000, "between_sessions", 0, idx=0, endMs=T0 + 14000, seconds=1.0)
    for i, e in enumerate(ev): e["ord"] = i
    calls = {"0": {"idx": 0, "rx": T0 / 1000 + 4, "think": 0, "text": 30, "nTools": 1, "outTok": 200, "inTok": 2000, "cacheTok": 1000, "stop": "tool_use", "sub": 0, "thinkFlags": "", "textFlags": "", "thinking": "", "text": "Delegating to a subagent.", "sent": T0 / 1000 + 0.5, "first": T0 / 1000 + 2,
                   "tools": [{"idx": 0, "callIdx": 0, "id": "tu0", "name": "Task", "kind": "task", "arg": "explore the repo", "argChars": 40, "start": T0 / 1000 + 4, "end": T0 / 1000 + 9, "error": 0, "resChars": 300, "sub": 1, "argFlags": "", "resFlags": "", "nEdits": 0, "oldChars": 0, "newChars": 0, "passed": None, "failed": None, "flaky": None, "skipped": None, "args": {"prompt": "explore the repo"}, "result": "Found the files."}]},
             "1": {"idx": 1, "rx": T0 / 1000 + 12, "think": 0, "text": 12, "nTools": 0, "outTok": 50, "inTok": 2300, "cacheTok": 2000, "stop": None, "sub": 0, "thinkFlags": "", "textFlags": "", "thinking": "", "text": "All done here.", "sent": T0 / 1000 + 9, "first": T0 / 1000 + 11, "tools": []}}
    return {"fmt": "claude", "complete": True, "node": None, "events": ev, "calls": calls, "tools": {"0": calls["0"]["tools"][0]}}

def swift_r1_s1():  # growing: the run is still started, the collection incomplete
    ev = [{"ord": 0, "tMs": T0 + 100000, "kind": "msg", "refIdx": 0, "idx": 0, "role": "user", "chars": 10, "textBody": inline("Go ahead.")},
          {"ord": 1, "tMs": T0 + 105000, "kind": "call", "refIdx": 0, "idx": 0, "think": 10, "text": 5, "nTools": 0, "outTok": 20, "inTok": 100, "cacheTok": 0, "stop": "endTurn", "sub": 0, "thinkFlags": [], "textFlags": [], "sentMs": T0 + 101000, "firstMs": T0 + 103000, "thinking": inline("Start."), "textBody": inline("Hello")}]
    return {"fmt": "pi", "complete": False, "node": "node-a", "events": ev, "calls": {"0": {"idx": 0, "rx": T0 / 1000 + 105, "think": 10, "text": 5, "nTools": 0, "outTok": 20, "inTok": 100, "cacheTok": 0, "stop": "endTurn", "sub": 0, "thinkFlags": "", "textFlags": "", "thinking": "Start.", "text": "Hello", "sent": T0 / 1000 + 101, "first": T0 / 1000 + 103, "tools": []}}, "tools": {}}

CONVERSATIONS = {
    f"{SWIFT}/v2-r5/stories/02": swift_s2(),
    f"{OPUS}/run-9/stories/01": opus_s1(),
    f"{SWIFT}/v2-r1/stories/01": swift_r1_s1(),
}

if __name__ == "__main__":
    f = ROOT / "fixture.json"
    data = json.loads(f.read_text())
    data["conversations"] = CONVERSATIONS
    f.write_text(json.dumps(data, indent=1) + "\n")
    print("conversations:", {k: len(v["events"]) for k, v in CONVERSATIONS.items()})
