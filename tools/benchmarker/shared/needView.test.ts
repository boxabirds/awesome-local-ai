// What each "needs you" item says about itself: what it affects, and whether a person must act ("do") or there is
// nothing to do now ("nothing": it is waiting for something, or no command fixes it). By dimension: every kind of
// need × whether its run is still going × whether a command fixes it. Each case names its group, its wording and its
// command, so the panel never lists something without saying what to do about it.
import { describe, expect, it } from "vitest";
import type { Finalize, RunStatus } from "./types.ts";
import { NEED_KINDS, type Need, type RunRef } from "./overviewView.ts";
import { finalizeCommand, groupNeeds, needAdvice, rescoreCommand } from "./needView.ts";

const DIR = "combinations/qwen/x/pi/benchmarks/vidi/r1";
const NO_SCORE = "This run has no score of record (the final score it is ranked by), so it doesn't count in the ranking.";
const WHERE = "on node-a, the machine that ran it, in the repo's benchmarks/spec-bench/harness";

const run = (over: Partial<RunRef> = {}): RunRef => ({ pack: "vidi", stack: "qwen/x/pi", runId: "r1", label: "x pi", machine: "node-a", dir: DIR, status: "finished", ...over });
const finalize = (rescore: Finalize["rescore"], reason: string): Finalize => ({ rescore, reason, version: "vidi-v2.0-pre2+28ace8b", packRef: "vidi-v2.0-pre2", at: "2026-10-01T08:25:57Z" });

const silent: Need = { kind: "silent", key: "s", machine: "node-a", run: run({ status: "running" }), story: "3", minutes: 20 };
const unreachable: Need = { kind: "unreachable", key: "u", machine: "node-d", error: "connection refused" };
const ended = (status: "failed" | "stopped"): Need => ({ kind: "ended", key: "e", run: run({ status }), status, endedAt: 0, note: "" });
const idle: Need = { kind: "idle", key: "i", machine: "node-d" };
const rescoreFault = (over: Partial<Extract<Need, { kind: "rescoreFault" }>> = {}): Need => ({ kind: "rescoreFault", key: "r", run: run(), suite: "vidi-v2.0-pre2", hasBundle: true, machineBusy: false, ...over });
const unscored = (f: Finalize | null, r: RunRef = run(), machineBusy = false): Need => ({ kind: "unscored", key: "n", run: r, why: "not re-scored under vidi-v2.0-pre2 yet", finalize: f, machineBusy });
// One recorded problem of each class (shared/accountingView.ts fixClass): the waits counted twice (a recompute), a
// clock disagreement in a record the current accounting made (to investigate), a call with no end (the log itself).
const DOUBLE = "wall 13113.4 s differs from the agent's own clock (13111.7 s + 205.8 s between sessions)";
const CLOCK = "wall 2352.1 s differs from the agent's own clock (2321.2 s)";
const NEVER = "tool call t9 never ended; counted to the agent's next step";
const PROBLEM = { recompute: DOUBLE, investigate: CLOCK, log: NEVER };
type Fix = keyof typeof PROBLEM;
const failing = (id: string, fix: Fix) => ({ id, problems: [PROBLEM[fix]], version: 3, current: true });
const accounting = (fix: Fix, status: RunStatus, over: Partial<Extract<Need, { kind: "accounting" }>> = {}): Need => ({
  kind: "accounting", key: "a", run: run({ status }), stories: [failing("4", fix)], ...over,
});
const CAUSE = {
  recompute: "Likely cause: an older harness counted the waits between sessions twice (a bug since fixed).",
  investigate: "Likely cause: not known. The harness's current accounting (version 3) made this record, so it isn't a bug since fixed.",
  log: "Likely cause: the agent's log has no end for it, usually a session cut off mid-call.",
};

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
      group: "do", lead: "Do this", detail: null, command: null, caution: null,
      affects: "The machine is held by a run that has stopped reporting, and anything queued behind it waits. No recorded result is affected.",
      todo: "On node-a's page, read the job's log. If it has stopped, press Stop on the job, then Restart: the run resumes at story 3.",
    });
  });
  it("an unreachable machine: nothing the app can run; check the machine", () => {
    expect(needAdvice(unreachable)).toEqual({
      group: "do", lead: "Do this", detail: null, command: null, caution: null,
      affects: "Nothing can be queued, stopped or watched on it until it answers. Runs already recorded are unaffected.",
      todo: "Check that node-d is on, on the network, and that its dbench service is running. Its page shows the address that was tried.",
    });
  });
  it("an idle machine: queue a run", () => {
    expect(needAdvice(idle)).toEqual({
      group: "do", lead: "Do this", detail: null, command: null, caution: null,
      affects: "No result is affected: the machine is doing no benchmarking.",
      todo: "Queue a run with the “Queue a run” form on node-d's page.",
    });
  });
});

describe("a run that failed or was stopped: restart it", () => {
  it("failed", () => {
    expect(needAdvice(ended("failed"))).toEqual({
      group: "do", lead: "Do this", detail: null, command: null, caution: null, affects: NO_SCORE,
      todo: "On node-a's page, under “Ended in the last day”, press Restart on its job: the run resumes at its first unfinished story.",
    });
  });
  it("stopped: the same, unless it was stopped on purpose (the app can't tell)", () => {
    expect(needAdvice(ended("stopped")).todo).toBe("On node-a's page, under “Ended in the last day”, press Restart on its job: the run resumes at its first unfinished story. If it was stopped on purpose, there is nothing to do.");
    expect(needAdvice(ended("stopped")).group).toBe("do");
  });
});

describe("a finished run with no score of record", () => {
  const COMMAND = `uv run finalize.py ../../../${DIR} --pack benchmarks/vidi --record`;

  it("its final re-score was skipped: the reason as recorded, then the command and where to run it", () => {
    expect(needAdvice(unscored(finalize("skipped", "the suite checkout is at vidi-v2.0-pre2+28ace8b, not the pack's vidi-v2.0-pre2")))).toEqual({
      group: "do", lead: "Do this", affects: NO_SCORE, caution: null,
      detail: "Its final re-score was skipped: the suite checkout is at vidi-v2.0-pre2+28ace8b, not the pack's vidi-v2.0-pre2.",
      todo: `Put right what that reason names, then run the final re-score again ${WHERE}:`,
      command: COMMAND,
    });
  });
  it("it failed: the reason as recorded, never re-punctuated twice", () => {
    expect(needAdvice(unscored(finalize("failed", "rescore.py exited 1."))).detail).toBe("Its final re-score failed: rescore.py exited 1.");
  });
  it("it was flagged by the live-against-record guard: set aside, with the reason", () => {
    expect(needAdvice(unscored(finalize("flagged", "the re-score (3/75) differs from the live score of the same code (66/75)"))).detail)
      .toBe("Its final re-score was set aside, not recorded: the re-score (3/75) differs from the live score of the same code (66/75).");
  });
  it("no record of a final re-score at all: only the command", () => {
    expect(needAdvice(unscored(null))).toEqual({
      group: "do", lead: "Do this", affects: NO_SCORE, caution: null, detail: "Its record has no final re-score: none was run, or it was recorded before the harness kept one.",
      todo: `Run the final re-score ${WHERE}:`, command: COMMAND,
    });
  });
  it("a final re-score recorded as done, yet no score under this suite: nothing is said about its reason", () => {
    const a = needAdvice(unscored(finalize("done", "")));
    expect(a.detail).toBe("Its final re-score was made under vidi-v2.0-pre2+28ace8b, which is not the suite version shown here.");
    expect(a.command).toBe(COMMAND);
  });
  it("a reason recorded as empty is said to be missing, not invented", () => {
    expect(needAdvice(unscored(finalize("skipped", ""))).detail).toBe("Its final re-score was skipped: no reason was recorded.");
  });
  it("a run with no record folder: no command to give", () => {
    expect(needAdvice(unscored(null, run({ dir: null }))).command).toBeNull();
  });

  it("the machine to run it on is running a job now: still to do, with that said (a re-score would share the machine)", () => {
    const BUSY = "node-a is running a job now: a re-score there would share the machine with it.";
    expect(needAdvice(unscored(null, run(), true))).toMatchObject({ group: "do", caution: BUSY });
    expect(needAdvice(rescoreFault({ machineBusy: true }))).toMatchObject({ group: "do", caution: BUSY });
    expect(needAdvice(unscored(null)).caution).toBeNull();
  });

  describe("a re-score fault: re-scored under this suite, but no score came of it", () => {
    it("re-score its final build again from its bundle", () => {
      expect(needAdvice(rescoreFault())).toEqual({
        group: "do", lead: "Do this", affects: NO_SCORE, caution: null, detail: null,
        todo: "Re-score its final build again on node-a, in the repo's benchmarks/spec-bench/harness, then push the run's record to main so its score shows here:",
        command: `uv run rescore.py ../../../${DIR} --bundle ../../../${DIR}/workspace.bundle --pack benchmarks/vidi --final`,
      });
    });
    it("without a recorded bundle there is nothing to re-score from: the final re-score makes one", () => {
      const a = needAdvice(rescoreFault({ hasBundle: false }));
      expect(a.todo).toBe(`Its record has no workspace bundle to re-score from. Run the final re-score, which makes one, ${WHERE}:`);
      expect(a.command).toBe(`uv run finalize.py ../../../${DIR} --pack benchmarks/vidi --record`);
    });
  });
});

describe("a story whose accounting check failed: by what fixes it × whether the run is still going", () => {
  const AFFECTS = "Only this story's time figures are affected (where its time went, its agent time); scores are not.";

  describe("a recompute fixes it", () => {
    it.each(["finished", "failed", "stopped", "cancelled", "unknown"] as RunStatus[])("the run is %s: do it now, with the command", (status) => {
      expect(needAdvice(accounting("recompute", status))).toEqual({
        group: "do", lead: "Do this", affects: AFFECTS, caution: null, detail: CAUSE.recompute,
        todo: `Recompute this record from the full logs ${WHERE}:`,
        command: `uv run backfill_timing.py --recompute ../../../${DIR}`,
      });
    });
    // The cause doesn't say which harness the run is going on now: a restarted run may be on a newer one.
    it.each(["running", "queued"] as RunStatus[])("the run is %s: nothing to do until it finishes, and no command yet", (status) => {
      expect(needAdvice(accounting("recompute", status))).toEqual({
        group: "nothing", lead: "Waiting", affects: AFFECTS, caution: null, detail: CAUSE.recompute,
        todo: "The run is still going. Recompute its record when it has finished: the command is given here then.",
        command: null,
      });
    });
  });

  describe("only calls with no end in the log: no command fixes it, whatever the run is doing", () => {
    it.each(["running", "finished"] as RunStatus[])("the run is %s", (status) => {
      expect(needAdvice(accounting("log", status))).toEqual({
        group: "nothing", lead: "Nothing to do", affects: AFFECTS, caution: null, detail: CAUSE.log,
        todo: "Recomputing reads the same log and gives the same answer. Read the part the call fell in as an upper estimate.",
        command: null,
      });
    });
  });

  describe("made by the harness's current accounting: a harness problem, not an operator's", () => {
    it.each(["running", "finished"] as RunStatus[])("the run is %s", (status) => {
      expect(needAdvice(accounting("investigate", status))).toEqual({
        group: "nothing", lead: "Nothing to do", affects: AFFECTS, caution: null, detail: CAUSE.investigate,
        todo: "No command fixes it: recomputing gives the same answer. It is a harness problem to investigate.",
        command: null,
      });
    });
  });

  it("several stories are named in the plural", () => {
    const a = needAdvice(accounting("log", "finished", { stories: [failing("9", "log"), failing("11", "log")] }));
    expect(a.affects).toBe("Only these stories' time figures are affected (where their time went, their agent time); scores are not.");
  });
  it("a recompute with no record folder: still to do, with no command to give", () => {
    const a = needAdvice(accounting("recompute", "finished", { run: run({ dir: null }) }));
    expect(a).toMatchObject({ group: "do", command: null, todo: `Recompute this record from the full logs ${WHERE}.` });
  });

  describe("one run's failing stories are listed by what fixes them, one item each", () => {
    // The owner's own case: a running run with story 4 (the waits counted twice) and stories 9 and 11 (calls with no end).
    const mixed = (status: RunStatus) => accounting("recompute", status, { stories: [failing("4", "recompute"), failing("5", "investigate"), failing("9", "log"), failing("11", "log")] });
    it("a finished run: the recompute is to do; the others are not", () => {
      const g = groupNeeds([mixed("finished")]);
      expect(g.do.map((x) => [x.need.key, (x.need as Extract<Need, { kind: "accounting" }>).stories.map((s) => s.id)])).toEqual([["a:recompute", ["4"]]]);
      expect(g.nothing.map((x) => [x.need.key, (x.need as Extract<Need, { kind: "accounting" }>).stories.map((s) => s.id), x.advice.lead]))
        .toEqual([["a:investigate", ["5"], "Nothing to do"], ["a:log", ["9", "11"], "Nothing to do"]]);
    });
    it("a running run: nothing is to do; the recompute waits for it to finish", () => {
      const g = groupNeeds([mixed("running")]);
      expect(g.do).toEqual([]);
      expect(g.nothing.map((x) => x.advice.lead)).toEqual(["Waiting", "Nothing to do", "Nothing to do"]);
    });
    it("each item's advice is about its own stories only", () => {
      const [, investigate, log] = groupNeeds([mixed("running")]).nothing;
      expect(investigate.advice.detail).toBe(CAUSE.investigate);
      expect(log.advice.detail).toBe(CAUSE.log);
    });
  });
});

describe("every kind lands in exactly one group, with something said about what to do", () => {
  const ONE_OF_EACH: Need[] = [silent, unreachable, ended("failed"), idle, rescoreFault(), unscored(null), accounting("recompute", "finished")];
  it("the cases cover every kind", () => {
    expect(ONE_OF_EACH.map((n) => n.kind)).toEqual([...NEED_KINDS]);
  });
  it("each has what it affects and what to do; a command only ever ends a sentence that announces it", () => {
    for (const n of [...ONE_OF_EACH, accounting("recompute", "running"), accounting("log", "finished"), accounting("investigate", "finished")]) {
      const a = needAdvice(n);
      expect(a.affects).not.toBe("");
      expect(a.todo).not.toBe("");
      expect(a.todo.endsWith(":")).toBe(a.command !== null);
      expect(a.group === "do").toBe(a.lead === "Do this");
    }
  });
  it("groupNeeds splits them, each group in the order given", () => {
    const g = groupNeeds([idle, accounting("recompute", "running"), unscored(null), accounting("log", "finished"), accounting("recompute", "finished")]);
    expect(g.do.map((x) => x.need.kind)).toEqual(["idle", "unscored", "accounting"]);
    expect(g.nothing.map((x) => x.advice.lead)).toEqual(["Waiting", "Nothing to do"]);
  });
  it("nothing at all: both groups empty", () => {
    expect(groupNeeds([])).toEqual({ do: [], nothing: [] });
  });
});
