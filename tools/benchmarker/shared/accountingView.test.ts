// The accounting check, said in plain words: what each recorded problem means (classified mechanically from the
// harness's own phrasing, accounting.py check()), what a passed, failed or unchecked check means for the story run's
// time figures, the likely cause, and what to do. By dimension: one problem; one story's check (ok / failed by class /
// unchecked, Claude Code or older); a run's stories together.
import { describe, expect, it } from "vitest";
import type { Row, Story, TimeSplit } from "./types.ts";
import { checkTip, checkView, readProblem, recomputeCommand, runCheckSummary, type CheckRun } from "./accountingView.ts";

const DIR = "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r2";
const pi = (over: Partial<CheckRun> = {}): CheckRun => ({ client: "pi", dir: DIR, machine: "node-c", status: "finished", ...over });
const claude = (over: Partial<CheckRun> = {}): CheckRun => ({ client: "claude", dir: "benchmarks/reference/vidi/opus-5.5/v2-r2", machine: "node-m2", status: "finished", ...over });
const failed = (...problems: string[]): TimeSplit["check"] => ({ status: "problems", problems });
const OK: TimeSplit["check"] = { status: "ok", problems: [] };
const UNCHECKED: TimeSplit["check"] = { status: "unchecked", problems: [] };

// The one the owner saw: mlx-serve v2-r2 story 4.
const DOUBLE = "wall 13113.4 s differs from the agent's own clock (13111.7 s + 205.8 s between sessions)";
const CLOCK = "wall 900.0 s differs from the agent's own clock (700.0 s)";
const CLOCK_WITH_WAITS = "wall 900.0 s differs from the agent's own clock (600.0 s + 100.0 s between sessions)";
const PARTS = "parts sum to 590.0 s, not the wall's 600.0 s";
const NEGATIVE = "negative between_sessions: -3.2 s";
const KINDS = "tools by kind sum to 80.0 s, not tools' 90.0 s";
const TOOL_NEVER = "tool call t9 never ended; counted to the agent's next step";
const COMPACTION_NEVER = "a compaction never ended; counted to the window's end";
const ODD = "the window ends before it starts";

describe("one problem, in plain words", () => {
  it("the wall equals the agent's clock alone, yet waits were added on top: the waits counted twice", () => {
    expect(readProblem(DOUBLE)).toEqual({
      kind: "waitsCountedTwice", raw: DOUBLE,
      text: "The wall time (13113.4 s) already matches the agent's own clock (13111.7 s), but 205.8 s of waits between sessions were added on top of it: they were counted twice.",
    });
  });

  it("the wall and the agent's clock simply disagree, with or without waits", () => {
    expect(readProblem(CLOCK)).toMatchObject({ kind: "clockDisagrees", text: "The wall time (900.0 s) doesn't match the agent's own clock (700.0 s)." });
    expect(readProblem(CLOCK_WITH_WAITS)).toMatchObject({ kind: "clockDisagrees", text: "The wall time (900.0 s) doesn't match the agent's own clock (600.0 s) plus the waits between sessions (100.0 s)." });
  });

  it("the parts don't add up to the wall", () => {
    expect(readProblem(PARTS)).toMatchObject({ kind: "partsDisagree", text: "The parts add up to 590.0 s, but the wall time is 600.0 s." });
  });

  it("a negative part, by the name the page gives it", () => {
    expect(readProblem(NEGATIVE)).toMatchObject({ kind: "negativePart", text: "The Between sessions part is negative (-3.2 s); no part of the time can be." });
    expect(readProblem("negative decode: -1 s").text).toBe("The Generation part is negative (-1 s); no part of the time can be.");
  });

  it("the tools by kind don't add up to Tools", () => {
    expect(readProblem(KINDS)).toMatchObject({ kind: "kindsDisagree", text: "The tools by kind add up to 80.0 s, but Tools is 90.0 s." });
  });

  it("a tool call or a compaction with no end in the log", () => {
    expect(readProblem(TOOL_NEVER)).toMatchObject({ kind: "neverEnded", text: "Tool call t9 has no end in the log, so its time was counted up to the agent's next step." });
    expect(readProblem("a tool call never ended")).toMatchObject({ kind: "neverEnded", text: "A tool call has no end in the log, so its time was counted up to the agent's next step." });
    expect(readProblem(COMPACTION_NEVER)).toMatchObject({ kind: "neverEnded", text: "A compaction has no end in the log, so its time was counted up to the end of the story." });
  });

  it("a restarted story's problem keeps its attempt", () => {
    expect(readProblem(`attempt 2: ${PARTS}`)).toMatchObject({ kind: "partsDisagree", text: "Attempt 2: the parts add up to 590.0 s, but the wall time is 600.0 s." });
  });

  it("anything else: shown as recorded, never a guessed meaning", () => {
    expect(readProblem(ODD)).toEqual({ kind: "other", raw: ODD, text: "The window ends before it starts." });
  });
});

describe("one story's check", () => {
  it("passed: the time figures can be trusted, nothing to do", () => {
    const v = checkView(OK, pi());
    expect(v).toMatchObject({ status: "ok", label: "passed", problems: [], cause: null, command: null });
    expect(v.meaning).toBe("The parts add up to the wall time and agree with the agent's own clock, so this story run's time figures can be trusted.");
    expect(v.todo).toBe("Nothing to do.");
  });

  describe("failed", () => {
    const MEANING = "This story run's time figures (the bar, the agent time and the shares) can't be trusted. Its held-out result is unaffected.";

    it("waits counted twice, run finished: an older harness's bug; recompute from the machine's full logs", () => {
      const v = checkView(failed(DOUBLE), pi());
      expect(v.label).toBe("failed");
      expect(v.meaning).toBe(MEANING);
      expect(v.problems.map((p) => p.kind)).toEqual(["waitsCountedTwice"]);
      expect(v.cause).toBe("An older harness counted the waits between sessions twice (a bug since fixed).");
      expect(v.todo).toBe("Recompute this record from the full logs on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness:");
      expect(v.command).toBe(`uv run backfill_timing.py --recompute ../../../${DIR}`);
    });

    it("still running: the run is on that older harness, so recompute once it has finished", () => {
      const v = checkView(failed(DOUBLE), pi({ status: "running" }));
      expect(v.cause).toBe("An older harness counted the waits between sessions twice (a bug since fixed), and this run is still going on it.");
      expect(v.todo).toBe("Once the run has finished, recompute this record from the full logs on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness:");
    });

    it.each([CLOCK, PARTS, NEGATIVE, KINDS, ODD])("%s: the generic cause, and the same remedy", (p) => {
      const v = checkView(failed(p), pi());
      expect(v.cause).toBe("The record was made by a harness with a bug since fixed.");
      expect(v.command).toBe(`uv run backfill_timing.py --recompute ../../../${DIR}`);
    });

    it("the generic cause for a running run says it is still going on that harness", () => {
      expect(checkView(failed(PARTS), pi({ status: "running" })).cause).toBe("The record was made by a harness with a bug since fixed, and this run is still going on it.");
    });

    it("only calls with no end: the log itself, which recomputing can't change", () => {
      const v = checkView(failed(TOOL_NEVER, COMPACTION_NEVER), pi());
      expect(v.cause).toBe("The agent's log has no end for it, usually a session cut off mid-call.");
      expect(v.todo).toBe("Nothing to fix: recomputing reads the same log and gives the same answer. Read the part it fell in as an upper estimate.");
      expect(v.command).toBeNull();
    });

    it("calls with no end beside another problem: the other problem's cause and remedy", () => {
      const v = checkView(failed(TOOL_NEVER, DOUBLE), pi());
      expect(v.cause).toBe("An older harness counted the waits between sessions twice (a bug since fixed).");
      expect(v.command).not.toBeNull();
    });

    it("a run with no record yet: no command to give", () => {
      expect(checkView(failed(PARTS), pi({ dir: null })).command).toBeNull();
    });
  });

  describe("unchecked", () => {
    it("a Claude Code run from before the harness read its logs: not a fault; the recompute fills it in where the full logs are", () => {
      const v = checkView(UNCHECKED, claude());
      expect(v.label).toBe("unchecked");
      expect(v.meaning).toBe("This Claude Code run was recorded before the harness read Claude Code's logs for its time, so the whole story counts as “Model, not split” and there is nothing to check. It isn't a fault, and the held-out result is unaffected.");
      expect(v.todo).toBe("Nothing is needed for the held-out result. To fill in its time, recompute this record on node-m2, the machine that ran it, in the repo's benchmarks/spec-bench/harness. It needs the full logs that machine kept: without them this story run can't be checked.");
      expect(v.cause).toBeNull();
      expect(v.command).toBe("uv run backfill_timing.py --recompute ../../../benchmarks/reference/vidi/opus-5.5/v2-r2");
    });

    it("an older run: recorded before the harness checked; recompute if the machine kept the full logs, else it can't be", () => {
      const v = checkView(UNCHECKED, pi());
      expect(v.meaning).toBe("This story run was recorded before the harness checked its time accounting, so its parts were never verified to add up. The held-out result is unaffected.");
      expect(v.todo).toBe("To check it, recompute this record on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness. It needs the full logs that machine kept: without them this story run can't be checked.");
      expect(v.command).toBe(`uv run backfill_timing.py --recompute ../../../${DIR}`);
    });

    it("a record that names no client is an older one", () => {
      expect(checkView(UNCHECKED, pi({ client: "" })).meaning).toMatch(/^This story run was recorded before the harness checked/);
    });
  });
});

describe("the hover: the same, in one paragraph", () => {
  it("failed: what it means, each problem, the cause, what to do and the command", () => {
    expect(checkTip(checkView(failed(DOUBLE), pi()))).toBe(
      "Accounting check failed. This story run's time figures (the bar, the agent time and the shares) can't be trusted. Its held-out result is unaffected. "
      + "The wall time (13113.4 s) already matches the agent's own clock (13111.7 s), but 205.8 s of waits between sessions were added on top of it: they were counted twice. "
      + "Likely cause: an older harness counted the waits between sessions twice (a bug since fixed). "
      + `What to do: recompute this record from the full logs on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness: uv run backfill_timing.py --recompute ../../../${DIR}`,
    );
  });

  it("unchecked, a Claude Code run", () => {
    expect(checkTip(checkView(UNCHECKED, claude()))).toBe(
      "Unchecked: no accounting check was made. This Claude Code run was recorded before the harness read Claude Code's logs for its time, so the whole story counts as “Model, not split” and there is nothing to check. It isn't a fault, and the held-out result is unaffected. "
      + "What to do: nothing is needed for the held-out result. To fill in its time, recompute this record on node-m2, the machine that ran it, in the repo's benchmarks/spec-bench/harness. It needs the full logs that machine kept: without them this story run can't be checked. uv run backfill_timing.py --recompute ../../../benchmarks/reference/vidi/opus-5.5/v2-r2",
    );
  });

  it("passed", () => {
    expect(checkTip(checkView(OK, pi()))).toBe("Accounting check passed. The parts add up to the wall time and agree with the agent's own clock, so this story run's time figures can be trusted.");
  });
});

describe("a run's stories together", () => {
  const split = (check: TimeSplit["check"]): TimeSplit => ({ wall: 600, prefill: 0, decode: 0, tools: 0, compaction: 0, other: 0, modelUnsplit: 600, betweenSessions: 0, check });
  const story = (id: string, check: TimeSplit["check"] | null): Story => ({
    id, title: "", status: "DONE", passed: null, total: null, ownPassed: null, ownTotal: null,
    usage: check ? { split: split(check) } as Story["usage"] : null,
  });
  const run = (stories: Story[], over: Partial<CheckRun> = {}) => ({ ...pi(), ...over, stories }) as Pick<Row, "stories"> & CheckRun;

  it("all passed: nothing to say", () => {
    expect(runCheckSummary(run([story("1", OK), story("2", OK)]))).toBeNull();
  });

  it("no story with a split: nothing to say", () => {
    expect(runCheckSummary(run([story("1", null)]))).toBeNull();
  });

  it("failed stories: which, out of how many, each problem by story, with the cause and remedy", () => {
    const s = runCheckSummary(run([story("1", OK), story("4", failed(DOUBLE)), story("5", failed(PARTS)), story("6", null)]))!;
    expect(s.failed).toEqual(["4", "5"]);
    expect(s.unchecked).toEqual([]);
    expect(s.text).toBe("Accounting check failed on stories 4 and 5: their time figures can't be trusted. Their held-out results are unaffected.");
    expect(s.tip).toBe(
      `${s.text} Story 4: the wall time (13113.4 s) already matches the agent's own clock (13111.7 s), but 205.8 s of waits between sessions were added on top of it: they were counted twice. `
      + "Story 5: the parts add up to 590.0 s, but the wall time is 600.0 s. "
      + "Likely cause: the record was made by a harness with a bug since fixed. "
      + `What to do: recompute this record from the full logs on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness: uv run backfill_timing.py --recompute ../../../${DIR}`,
    );
  });

  it("three or more failed stories are listed with commas", () => {
    expect(runCheckSummary(run([story("1", failed(PARTS)), story("2", failed(PARTS)), story("7", failed(PARTS))]))!.text).toMatch(/^Accounting check failed on stories 1, 2 and 7: /);
  });

  it("the only story with a time split, unchecked", () => {
    expect(runCheckSummary(run([story("1", UNCHECKED), story("2", null)], { client: "claude" }))!.text).toMatch(/^The one story with a time split is unchecked: /);
  });

  it("several, some unchecked", () => {
    expect(runCheckSummary(run([story("1", UNCHECKED), story("2", UNCHECKED), story("3", OK)]))!.text).toMatch(/^2 of the 3 stories with a time split are unchecked: /);
  });

  it("one failed story is named in the singular", () => {
    expect(runCheckSummary(run([story("4", failed(DOUBLE))]))!.text).toBe("Accounting check failed on story 4: its time figures can't be trusted. Its held-out result is unaffected.");
  });

  it("unchecked, a Claude Code run: how many, why, that it isn't a fault, and how to fill them in", () => {
    const s = runCheckSummary(run([story("1", UNCHECKED), story("2", UNCHECKED)], { client: "claude" }))!;
    expect(s.unchecked).toEqual(["1", "2"]);
    expect(s.text).toBe("All 2 stories with a time split are unchecked: recorded before the harness read Claude Code's logs for their time, so there is nothing to check. It isn't a fault, and the held-out results are unaffected.");
    expect(s.tip).toBe(`${s.text} To fill them in, recompute this record on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness. It needs the full logs that machine kept: without them they can't be checked. uv run backfill_timing.py --recompute ../../../${DIR}`);
  });

  it("unchecked, an older run: how many, why, and how to check them if the logs are still there", () => {
    const s = runCheckSummary(run([story("1", UNCHECKED), story("2", OK)]))!;
    expect(s.text).toBe("1 of the 2 stories with a time split is unchecked: recorded before the harness checked its time accounting. The held-out results are unaffected.");
    expect(s.tip).toBe(`${s.text} To check them, recompute this record on node-c, the machine that ran it, in the repo's benchmarks/spec-bench/harness. It needs the full logs that machine kept: without them they can't be checked. uv run backfill_timing.py --recompute ../../../${DIR}`);
  });

  it("failed and unchecked together: both said, failed first", () => {
    const s = runCheckSummary(run([story("1", UNCHECKED), story("2", failed(PARTS))]))!;
    expect(s.text).toMatch(/^Accounting check failed on story 2: .* 1 of the 2 stories with a time split is unchecked: /);
  });
});

describe("the recompute command", () => {
  it("is run from the harness folder, three levels below the repo", () => {
    expect(recomputeCommand(DIR)).toBe(`uv run backfill_timing.py --recompute ../../../${DIR}`);
  });
});
