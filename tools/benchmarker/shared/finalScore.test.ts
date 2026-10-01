// A finished run with no score of record: whether its final score is pending (the harness retries it by itself) or
// needs a person (the harness says so), and what its pages say about it. By dimension: what the harness recorded about
// a person (true, false, nothing) × whether the run is owed a score at all (status, scored, invalid, spec version).
import { describe, expect, it } from "vitest";
import type { Finalize, Row, RunStatus, Score } from "./types.ts";
import { finalScoreNote, finalScoreOwed, finalizeSaid } from "./finalScore.ts";

const SUITE = "vidi-v2.0-pre1";
const score = (passed: number | null, total: number | null): Score => ({ passed, total, flaky: 0, at: "" });
const finalize = (over: Partial<Finalize> = {}): Finalize => ({
  rescore: "skipped", reason: "the suite checkout is at vidi-v2.0-pre1+28ace8b, not the pack's vidi-v2.0-pre1", version: "vidi-v2.0-pre1+28ace8b", packRef: SUITE,
  at: "2026-10-01T08:25:57Z", needsPerson: null, attempts: null, lastAttemptAt: "", ...over,
});
const row = (over: Partial<Row> = {}) => ({
  status: "finished", suite: SUITE, family: "vidi-v2", scores: {}, rescores: [], invalid: null, finalize: null, machine: "node-a", ...over,
} as Row);

describe("whether a finished run's final score is owed, and by whom", () => {
  it("the harness says a person is needed: needs a person", () => {
    expect(finalScoreOwed(row({ finalize: finalize({ needsPerson: true }) }))).toBe("needsPerson");
  });
  it("the harness says no person is needed: pending", () => {
    expect(finalScoreOwed(row({ finalize: finalize({ needsPerson: false }) }))).toBe("pending");
  });
  it("the harness says nothing about a person (every record from before it did): pending, never a person", () => {
    expect(finalScoreOwed(row({ finalize: finalize() }))).toBe("pending");
    expect(finalScoreOwed(row({ finalize: null }))).toBe("pending");
    expect(finalScoreOwed(row({ finalize: undefined }))).toBe("pending");
  });
  it("re-scored under the current suite with no score of it (a re-score fault): the same rule", () => {
    const fault = { rescores: [SUITE], scores: { [SUITE]: score(null, 75) } };
    expect(finalScoreOwed(row({ ...fault, finalize: finalize({ rescore: "failed", needsPerson: true }) }))).toBe("needsPerson");
    expect(finalScoreOwed(row({ ...fault, finalize: finalize({ rescore: "failed" }) }))).toBe("pending");
  });
  it("a run with a score of record is owed nothing, whatever its finalize record says", () => {
    expect(finalScoreOwed(row({ rescores: [SUITE], scores: { [SUITE]: score(60, 75) }, finalize: finalize({ needsPerson: true }) }))).toBeNull();
  });
  it.each(["running", "queued", "failed", "stopped", "cancelled", "unknown"] as RunStatus[])("a %s run is owed none: only a finished run is re-scored", (status) => {
    expect(finalScoreOwed(row({ status, finalize: finalize({ needsPerson: true }) }))).toBeNull();
  });
  it("an invalid run is owed none", () => {
    expect(finalScoreOwed(row({ invalid: { reason: "saw the reference build", since: "" }, finalize: finalize({ needsPerson: true }) }))).toBeNull();
  });
  it("a run of another spec version, or of an unknown one, is owed none: this suite can't score another spec", () => {
    expect(finalScoreOwed(row({ family: "vidi-v1", finalize: finalize({ needsPerson: true }) }))).toBeNull();
    expect(finalScoreOwed(row({ family: "" }))).toBeNull();
  });
});

describe("what the final re-score recorded, in a sentence", () => {
  it("skipped, failed or set aside, with the reason as written and never punctuated twice", () => {
    expect(finalizeSaid(finalize())).toBe("Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre1+28ace8b, not the pack's vidi-v2.0-pre1.");
    expect(finalizeSaid(finalize({ rescore: "failed", reason: "rescore.py exited 1." }))).toBe("Its final re-score failed: rescore.py exited 1.");
    expect(finalizeSaid(finalize({ rescore: "flagged", reason: "the re-score (3/75) differs from the live score of the same code (66/75)" })))
      .toBe("Its final re-score was set aside, not recorded: the re-score (3/75) differs from the live score of the same code (66/75).");
  });
  it("a reason recorded as empty is said to be missing, not invented", () => {
    expect(finalizeSaid(finalize({ reason: "" }))).toBe("Its final re-score was skipped: no reason was recorded.");
  });
  it("done, yet no score under this suite: the version it was made under", () => {
    expect(finalizeSaid(finalize({ rescore: "done", reason: "" }))).toBe("Its final re-score was made under vidi-v2.0-pre1+28ace8b, which is not the suite version shown here.");
    expect(finalizeSaid(finalize({ rescore: "done", reason: "", version: "" }))).toBe("Its final re-score was made under a suite version it didn't record, which is not the suite version shown here.");
  });
  it("the attempts, when the harness counted them, and the last one, when it recorded it", () => {
    expect(finalizeSaid(finalize({ rescore: "failed", reason: "no browser", attempts: 3, lastAttemptAt: "2026-10-01T12:00:00Z" }))).toBe("Its final re-score failed: no browser. Tried 3 times, last at 2026-10-01T12:00:00Z.");
    expect(finalizeSaid(finalize({ rescore: "failed", reason: "no browser", attempts: 1 }))).toBe("Its final re-score failed: no browser. Tried 1 time.");
  });
});

describe("what a run's pages say beside its score", () => {
  it("pending: retried automatically at its machine's next run, with the recorded reason and the attempts", () => {
    expect(finalScoreNote(row({ finalize: finalize({ needsPerson: false, attempts: 2 }) })))
      .toBe("Final score pending: retried automatically at node-a's next run. Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre1+28ace8b, not the pack's vidi-v2.0-pre1. Tried 2 times.");
  });
  it("pending, a record from before the harness said: the same, with no attempts invented", () => {
    expect(finalScoreNote(row({ finalize: finalize() })))
      .toBe("Final score pending: retried automatically at node-a's next run. Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre1+28ace8b, not the pack's vidi-v2.0-pre1.");
  });
  it("pending, with no final re-score recorded at all", () => {
    expect(finalScoreNote(row())).toBe("Final score pending: retried automatically at node-a's next run. Its record has no final re-score yet.");
  });
  it("a person is needed: says so, with the reason, and where what to do is given", () => {
    expect(finalScoreNote(row({ finalize: finalize({ rescore: "failed", reason: "no browser", needsPerson: true, attempts: 3 }) })))
      .toBe("Final score needs a person: the harness can't finish it by itself. Its final re-score failed: no browser. Tried 3 times. What to do is under “Needs you” on the Overview.");
  });
  it("nothing is said of a run that is owed no score", () => {
    expect(finalScoreNote(row({ rescores: [SUITE], scores: { [SUITE]: score(60, 75) } }))).toBeNull();
    expect(finalScoreNote(row({ status: "running" }))).toBeNull();
    expect(finalScoreNote(row({ family: "vidi-v1" }))).toBeNull();
  });
});
