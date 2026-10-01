// What each "needs you" item says about itself: what it affects and what a person must do, with the command and where
// to run it when there is one. Every kind the panel lists is one a person must act on (shared/overviewView.ts lists
// nothing else), so each case names its wording and its command, and no kind is listed without them.
import { describe, expect, it } from "vitest";
import type { Finalize } from "./types.ts";
import { NEED_KINDS, type Need, type RunRef } from "./overviewView.ts";
import { NEED_LEAD, finalizeCommand, needAdvice, rescoreCommand } from "./needView.ts";

const DIR = "combinations/qwen/x/pi/benchmarks/vidi/r1";
const NO_SCORE = "This run has no score of record (the final score it is ranked by), so it doesn't count in the ranking.";
const WHERE = "on node-a, the machine that ran it, in the repo's benchmarks/spec-bench/harness";

const run = (over: Partial<RunRef> = {}): RunRef => ({ pack: "vidi", stack: "qwen/x/pi", runId: "r1", label: "x pi", machine: "node-a", dir: DIR, status: "finished", ...over });
/** A final re-score the harness says a person is needed for. */
const finalize = (rescore: Finalize["rescore"], reason: string, over: Partial<Finalize> = {}): Finalize =>
  ({ rescore, reason, version: "vidi-v2.0-pre2+28ace8b", packRef: "vidi-v2.0-pre2", at: "2026-10-01T08:25:57Z", needsPerson: true, attempts: null, lastAttemptAt: "", ...over });

const silent: Need = { kind: "silent", key: "s", machine: "node-a", run: run({ status: "running" }), story: "3", minutes: 20 };
const unreachable: Need = { kind: "unreachable", key: "u", machine: "node-d", error: "connection refused" };
const ended = (status: "failed" | "stopped"): Need => ({ kind: "ended", key: "e", run: run({ status }), status, endedAt: 0, note: "" });
const idle: Need = { kind: "idle", key: "i", machine: "node-d" };
const FAILED = finalize("failed", "no browser");
const rescoreFault = (over: Partial<Extract<Need, { kind: "rescoreFault" }>> = {}): Need => ({ kind: "rescoreFault", key: "r", run: run(), suite: "vidi-v2.0-pre2", hasBundle: true, machineBusy: false, finalize: FAILED, ...over });
const unscored = (f: Finalize, r: RunRef = run(), machineBusy = false): Need => ({ kind: "unscored", key: "n", run: r, why: "not re-scored under vidi-v2.0-pre2 yet", finalize: f, machineBusy });

describe("the commands", () => {
  it("the final re-score: finalize.py from the harness folder, with the run's record and its pack, recording the result", () => {
    expect(finalizeCommand(DIR, "vidi")).toBe(`uv run finalize.py ../../../${DIR} --pack benchmarks/vidi --record`);
  });
  it("a re-score of the final build: rescore.py with the run's own bundle", () => {
    expect(rescoreCommand(DIR, "vidi")).toBe(`uv run rescore.py ../../../${DIR} --bundle ../../../${DIR}/workspace.bundle --pack benchmarks/vidi --final`);
  });
});

describe("machines: a person must act, on the machine's page", () => {
  it("a running story with no activity: stop and restart it there", () => {
    expect(needAdvice(silent)).toEqual({
      detail: null, command: null, caution: null,
      affects: "The machine is held by a run that has stopped reporting, and anything queued behind it waits. No recorded result is affected.",
      todo: "On node-a's page, read the job's log. If it has stopped, press Stop on the job, then Restart: the run resumes at story 3.",
    });
  });
  it("an unreachable machine: nothing the app can run; check the machine", () => {
    expect(needAdvice(unreachable)).toEqual({
      detail: null, command: null, caution: null,
      affects: "Nothing can be queued, stopped or watched on it until it answers. Runs already recorded are unaffected.",
      todo: "Check that node-d is on, on the network, and that its dbench service is running. Its page shows the address that was tried.",
    });
  });
  it("an idle machine: queue a run", () => {
    expect(needAdvice(idle)).toEqual({
      detail: null, command: null, caution: null,
      affects: "No result is affected: the machine is doing no benchmarking.",
      todo: "Queue a run with the “Queue a run” form on node-d's page.",
    });
  });
});

describe("a run that failed or was stopped: restart it", () => {
  it("failed", () => {
    expect(needAdvice(ended("failed"))).toEqual({
      detail: null, command: null, caution: null, affects: NO_SCORE,
      todo: "On node-a's page, under “Ended in the last day”, press Restart on its job: the run resumes at its first unfinished story.",
    });
  });
  it("stopped: the same, unless it was stopped on purpose (the app can't tell)", () => {
    expect(needAdvice(ended("stopped")).todo).toBe("On node-a's page, under “Ended in the last day”, press Restart on its job: the run resumes at its first unfinished story. If it was stopped on purpose, there is nothing to do.");
  });
});

describe("a finished run with no score of record, which the harness says needs a person", () => {
  const COMMAND = `uv run finalize.py ../../../${DIR} --pack benchmarks/vidi --record`;

  it("its final re-score was skipped: the reason as recorded, then the command and where to run it", () => {
    expect(needAdvice(unscored(finalize("skipped", "the suite checkout is at vidi-v2.0-pre2+28ace8b, not the pack's vidi-v2.0-pre2")))).toEqual({
      affects: NO_SCORE, caution: null,
      detail: "Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre2+28ace8b, not the pack's vidi-v2.0-pre2.",
      todo: `Put right what that reason names, then run the final re-score again ${WHERE}:`,
      command: COMMAND,
    });
  });
  it("it failed after several attempts: the reason and the attempts the harness made by itself", () => {
    expect(needAdvice(unscored(finalize("failed", "rescore.py exited 1.", { attempts: 3, lastAttemptAt: "2026-10-01T12:00:00Z" }))).detail)
      .toBe("Its final re-score failed: rescore.py exited 1. Tried 3 times, last at 2026-10-01T12:00:00Z.");
  });
  it("it was flagged by the live-against-record guard: set aside, with the reason", () => {
    expect(needAdvice(unscored(finalize("flagged", "the re-score (3/75) differs from the live score of the same code (66/75)"))).detail)
      .toBe("Its final re-score was set aside, not recorded: the re-score (3/75) differs from the live score of the same code (66/75).");
  });
  it("a final re-score recorded as done, yet no score under this suite: only the command, nothing to put right first", () => {
    const a = needAdvice(unscored(finalize("done", "")));
    expect(a.detail).toBe("Its final re-score was made under vidi-v2.0-pre2+28ace8b, which is not the suite version shown here.");
    expect(a.todo).toBe(`Run the final re-score ${WHERE}:`);
    expect(a.command).toBe(COMMAND);
  });
  it("a run with no record folder: no command to give", () => {
    const a = needAdvice(unscored(FAILED, run({ dir: null })));
    expect(a.command).toBeNull();
    expect(a.todo.endsWith(".")).toBe(true);
  });

  it("the machine to run it on is running a job now: still to do, with that said (a re-score would share the machine)", () => {
    const BUSY = "node-a is running a job now: a re-score there would share the machine with it.";
    expect(needAdvice(unscored(FAILED, run(), true)).caution).toBe(BUSY);
    expect(needAdvice(rescoreFault({ machineBusy: true })).caution).toBe(BUSY);
    expect(needAdvice(unscored(FAILED)).caution).toBeNull();
  });

  describe("a re-score fault: re-scored under this suite, but no score came of it", () => {
    it("re-score its final build again from its bundle, with the reason the harness recorded", () => {
      expect(needAdvice(rescoreFault())).toEqual({
        affects: NO_SCORE, caution: null, detail: "Its final re-score failed: no browser.",
        todo: "Re-score its final build again on node-a, in the repo's benchmarks/spec-bench/harness, then push the run's record to main so its score shows here:",
        command: `uv run rescore.py ../../../${DIR} --bundle ../../../${DIR}/workspace.bundle --pack benchmarks/vidi --final`,
      });
    });
    it("a final re-score recorded as done says nothing more: the fault is what the item already says", () => {
      expect(needAdvice(rescoreFault({ finalize: finalize("done", "") })).detail).toBeNull();
    });
    it("without a recorded bundle there is nothing to re-score from: the final re-score makes one", () => {
      const a = needAdvice(rescoreFault({ hasBundle: false }));
      expect(a.todo).toBe(`Its record has no workspace bundle to re-score from. Run the final re-score, which makes one, ${WHERE}:`);
      expect(a.command).toBe(`uv run finalize.py ../../../${DIR} --pack benchmarks/vidi --record`);
    });
  });
});

describe("every kind the panel lists is something a person must do", () => {
  const ONE_OF_EACH: Need[] = [silent, unreachable, ended("failed"), idle, rescoreFault(), unscored(FAILED)];
  it("the cases cover every kind", () => {
    expect(ONE_OF_EACH.map((n) => n.kind)).toEqual([...NEED_KINDS]);
  });
  it("each has what it affects and what to do; a command only ever ends a sentence that announces it", () => {
    for (const n of ONE_OF_EACH) {
      const a = needAdvice(n);
      expect(a.affects).not.toBe("");
      expect(a.todo).not.toBe("");
      expect(a.todo.endsWith(":")).toBe(a.command !== null);
    }
  });
  it("each opens with the same lead: there is no other group", () => {
    expect(NEED_LEAD).toBe("Do this");
  });
});
