import { describe, expect, it } from "vitest";
import { closeCalls, comboStats, compareRanked, indistinguishable, INDISTINGUISHABLE_TESTS, isInvalid, median, NOT_COUNTED_ORDER, perStory, rankCombinations, runTokS, scoreOfRecord, SMALL_N, spread, standingOf, summarise, unscoredReason } from "./stats.ts";
import type { Row, RunStatus, Usage } from "./types.ts";

const row = (stories: { secs?: number }[], squares: [number | null, number | null, string][]) => ({
  stories: stories.map((s, i) => ({ id: String(i + 1), usage: s.secs === undefined ? null : { agentSeconds: s.secs } })),
  storiesWorking: { squares: squares.map(([passed, total, state], i) => ({ id: String(i + 1), passed, total, state })) },
}) as unknown as Row;

describe("combination stats", () => {
  it("hours per story: agent time over every recorded story of the runs shown", () => {
    const s = comboStats([row([{ secs: 3600 }, { secs: 1800 }], []), row([{ secs: 5400 }], [])]);
    expect(s.hoursPerStory).toBeCloseTo((3600 + 1800 + 5400) / 3600 / 3, 6);
  });

  it("held-out quality: tests passing over all tests, across every built story of every run", () => {
    const s = comboStats([
      row([], [[10, 10, "ok"], [5, 7, "part"], [null, null, "unbuilt"], [null, null, "running"]]),
      row([], [[0, 10, "bad"]]),
    ]);
    expect(s.quality).toBeCloseTo(15 / 27, 6);
    expect(s.runs).toBe(2);
  });

  it("nothing recorded yet: no numbers rather than zeros", () => {
    expect(comboStats([row([{}], [[null, null, "unbuilt"]])])).toEqual({ runs: 1, hoursPerStory: null, quality: null });
  });
});

// ---------- the ranking: finished runs with a score of record only ----------


const SUITE = "p-v2.0";
const OLD_SUITE = "p-v1.9";
interface RunOpts { invalid?: boolean; status?: RunStatus; score?: number | null; scores?: Record<string, number>; secs?: (number | null)[]; out?: number[]; calls?: number[]; read?: number[]; machine?: string }
let seq = 0;
/** A run of stack `stack`: finished and scored `score`/75 under the current suite unless told otherwise. */
const run = (stack: string, o: RunOpts = {}): Row => {
  const secs = o.secs ?? [3600];
  const scores = o.scores ?? (o.score === undefined ? { [SUITE]: 60 } : o.score === null ? {} : { [SUITE]: o.score });
  return {
    pack: "p", stack, label: stack, runId: `r${++seq}`, machine: o.machine ?? "m1", status: o.status ?? "finished", suite: SUITE,
    scores: Object.fromEntries(Object.entries(scores).map(([v, p]) => [v, { passed: p, total: 75, flaky: 0, at: "" }])),
    stories: secs.map((s, i) => ({ id: String(i + 1), usage: { agentSeconds: s, outTokens: o.out?.[i] ?? null, calls: o.calls?.[i] ?? null, readTokens: o.read?.[i] ?? null } as Usage })),
    storiesWorking: { squares: [] }, usage: { tokS: null },
    invalid: o.invalid ? { reason: "read the reference build", since: "2026-09-30" } : null, interventions: [],
  } as unknown as Row;
};

describe("median and spread", () => {
  it("no values: null, never 0", () => { expect(median([])).toBeNull(); expect(spread([])).toBeNull(); });
  it("one value: itself, n=1", () => expect(spread([63])).toEqual({ median: 63, min: 63, max: 63, n: 1 }));
  it("odd n: the middle value, whatever the input order", () => expect(spread([68, 58, 63])).toEqual({ median: 63, min: 58, max: 68, n: 3 }));
  it("even n: the mean of the middle two", () => expect(spread([58, 68, 60, 70])).toEqual({ median: 64, min: 58, max: 70, n: 4 }));
  it("ties: the tied value", () => expect(spread([60, 60, 70])!.median).toBe(60));
});

describe("score of record", () => {
  it("a finished run's re-score under exactly its pack's current suite", () => expect(scoreOfRecord(run("a", { score: 63 }))?.passed).toBe(63));
  it("a score under another suite version only: none (no fallback)", () => expect(scoreOfRecord(run("a", { scores: { [OLD_SUITE]: 70 } }))).toBeNull());
  it("both versions: the current one, never the other", () => expect(scoreOfRecord(run("a", { scores: { [OLD_SUITE]: 70, [SUITE]: 61 } }))?.passed).toBe(61));
  it("a run that isn't finished has none, even with a score recorded", () => {
    for (const status of ["running", "queued", "failed", "stopped", "cancelled", "unknown"] as RunStatus[]) expect(scoreOfRecord(run("a", { status, score: 60 }))).toBeNull();
  });
  it("a re-score with no pass count is not a score", () => {
    const r = run("a"); r.scores[SUITE].passed = null;
    expect(scoreOfRecord(r)).toBeNull();
  });
});

describe("standing: counted, or why not", () => {
  it("finished and scored: of record", () => expect(standingOf(run("a"))).toBe("ofRecord"));
  it("finished, unscored or scored only under another version: unscored", () => {
    expect(standingOf(run("a", { score: null }))).toBe("unscored");
    expect(standingOf(run("a", { scores: { [OLD_SUITE]: 70 } }))).toBe("unscored");
  });
  it("any other status: that status", () => expect(standingOf(run("a", { status: "running" }))).toBe("running"));
  it("says why a finished run is unscored, naming the other version's score", () => {
    expect(unscoredReason(run("a", { scores: { [OLD_SUITE]: 70 } }))).toBe(`re-scored only under another suite version (70/75 under ${OLD_SUITE}), not under ${SUITE}`);
    expect(unscoredReason(run("a", { score: null }))).toBe(`not re-scored under ${SUITE} yet`);
  });
});

describe("per-run rates", () => {
  it("per story: over the stories that recorded the figure, not all stories", () => {
    expect(perStory(run("a", { secs: [600, null, 1200] }), (u) => u.agentSeconds)).toBe(900);
  });
  it("per story: no story recorded it → null, not 0", () => expect(perStory(run("a", { secs: [null] }), (u) => u.agentSeconds)).toBeNull());
  it("per story: a real 0 is kept", () => expect(perStory(run("a", { secs: [0, 0] }), (u) => u.agentSeconds)).toBe(0));
  it("tok/s: output over time of the stories with both, weighted by time", () => {
    expect(runTokS(run("a", { secs: [100, 300], out: [1000, 1000] }))).toBe(5);
    expect(runTokS(run("a", { secs: [0], out: [1000] }))).toBeNull();
  });
});

describe("summarise: by run set", () => {
  it("no runs finished: unranked, says so, and counts the rest", () => {
    const c = summarise("a", [run("a", { status: "running" }), run("a", { status: "queued" }), run("a", { status: "queued" })]);
    expect(c.score).toBeNull();
    expect(c.hoursPerStory).toBeNull();
    expect(c.unranked).toBe("no finished run yet");
    expect(c.notCounted).toEqual({ running: 1, queued: 2 });
  });
  it("finished but none scored: unranked, with how many finished", () => {
    const c = summarise("a", [run("a", { score: null }), run("a", { scores: { [OLD_SUITE]: 74 } })]);
    expect(c.unranked).toBe(`2 finished, none re-scored under ${SUITE}`);
    expect(c.notCounted).toEqual({ unscored: 2 });
  });
  it("one run of record: its numbers, n=1", () => {
    const c = summarise("a", [run("a", { score: 63, secs: [1800, 3600] })]);
    expect(c.score).toEqual({ median: 63, min: 63, max: 63, n: 1, total: 75, pooled: 63 / 75 });
    expect(c.hoursPerStory).toEqual({ median: 0.75, min: 0.75, max: 0.75, n: 1 });
    expect(c.unranked).toBeNull();
  });
  it("several (odd): median, range and pooled over those runs; running and unscored runs never fold in", () => {
    const c = summarise("a", [
      run("a", { score: 63, secs: [3600] }), run("a", { score: 68, secs: [1800] }), run("a", { score: 58, secs: [7200] }),
      run("a", { status: "running", score: 75, secs: [60] }), run("a", { scores: { [OLD_SUITE]: 75 }, secs: [60] }),
    ]);
    expect(c.score).toEqual({ median: 63, min: 58, max: 68, n: 3, total: 75, pooled: (63 + 68 + 58) / 225 });
    expect(c.hoursPerStory).toEqual({ median: 1, min: 0.5, max: 2, n: 3 });
    expect(c.notCounted).toEqual({ running: 1, unscored: 1 });
    expect(c.byStatus).toEqual({ finished: 4, running: 1 });
    expect(c.ofRecord).toHaveLength(3);
  });
  it("several (even): the median is the mean of the middle two", () => {
    expect(summarise("a", [run("a", { score: 58 }), run("a", { score: 60 }), run("a", { score: 66 }), run("a", { score: 70 })]).score!.median).toBe(63);
  });
  it("output tokens, calls and input per story: each the median of each run's own per-story figure", () => {
    const c = summarise("a", [
      run("a", { secs: [60, 60], out: [1000, 3000], calls: [10, 30], read: [1e6, 3e6] }),
      run("a", { secs: [60], out: [4000], calls: [40], read: [4e6] }),
      run("a", { secs: [60], out: [500], calls: [5], read: [5e5] }),
    ]);
    expect(c.outPerStory).toEqual({ median: 2000, min: 500, max: 4000, n: 3 });
    expect(c.callsPerStory).toEqual({ median: 20, min: 5, max: 40, n: 3 });
    expect(c.readPerStory!.median).toBe(2e6);
  });
  it("a figure no run of record recorded: null, not 0", () => expect(summarise("a", [run("a")]).outPerStory).toBeNull());
  it("machines: every machine of every run, sorted, counted or not", () => {
    expect(summarise("a", [run("a", { machine: "zeta" }), run("a", { machine: "alpha", status: "queued" })]).machines).toEqual(["alpha", "zeta"]);
  });
});

describe("rankCombinations: the order", () => {
  it("by score median, highest first, whatever the live or pooled figures", () => {
    const ranked = rankCombinations([run("low", { score: 60 }), run("high", { score: 70 }), run("mid", { score: 65 })]);
    expect(ranked.map((c) => c.stack)).toEqual(["high", "mid", "low"]);
  });
  it("a combination with no run of record sorts last, however good its running runs look", () => {
    const ranked = rankCombinations([run("live", { status: "running", score: 75 }), run("done", { score: 40 })]);
    expect(ranked.map((c) => c.stack)).toEqual(["done", "live"]);
    expect(ranked[1].unranked).toBe("no finished run yet");
  });
  it("ties on median: the higher pooled pass rate first, then more runs, then by name", () => {
    const a = rankCombinations([run("a", { score: 60 }), run("a", { score: 60 }), run("a", { score: 70 }),     // median 60, pooled 63.3
                                run("b", { score: 50 }), run("b", { score: 60 }), run("b", { score: 61 })]);   // median 60, pooled 57
    expect(a.map((c) => c.stack)).toEqual(["a", "b"]);
    const n = rankCombinations([run("few", { score: 60 }), run("many", { score: 60 }), run("many", { score: 60 })]);
    expect(n.map((c) => c.stack)).toEqual(["many", "few"]);
    const name = rankCombinations([run("zed", { score: 60 }), run("abe", { score: 60 })]);
    expect(name.map((c) => c.stack)).toEqual(["abe", "zed"]);
  });
  it("two unranked sort by name", () => {
    const x = summarise("x", [run("x", { status: "queued" })]), y = summarise("y", [run("y", { status: "queued" })]);
    expect(compareRanked(y, x)).toBeGreaterThan(0);
  });
  it("the old pooled figure's trap: a running run's easy early stories no longer lift a combination", () => {
    // Pooled live, "fast" would lead (its running run passes everything so far); of record, "steady" leads.
    const ranked = rankCombinations([run("fast", { score: 55 }), run("fast", { status: "running", score: null }), run("steady", { score: 62 })]);
    expect(ranked[0].stack).toBe("steady");
  });
});

describe("small n: when two combinations can't be told apart", () => {
  const c = (stack: string, scores: number[]) => summarise(stack, scores.map((s) => run(stack, { score: s })));
  it(`at n ≤ ${SMALL_N}, medians ${INDISTINGUISHABLE_TESTS} tests apart or closer are indistinguishable`, () => {
    expect(indistinguishable(c("a", [70]), c("b", [70 - INDISTINGUISHABLE_TESTS]))).toBe(true);
    expect(indistinguishable(c("a", [70]), c("b", [70 - INDISTINGUISHABLE_TESTS - 1]))).toBe(false);
  });
  it(`more than ${SMALL_N} runs on either side: distinguishable`, () => {
    expect(indistinguishable(c("a", Array(SMALL_N + 1).fill(70)), c("b", [65]))).toBe(false);
    expect(indistinguishable(c("a", Array(SMALL_N).fill(70)), c("b", Array(SMALL_N).fill(65)))).toBe(true);
  });
  it("an unranked combination is never a close call", () => expect(indistinguishable(c("a", [70]), summarise("b", [run("b", { status: "running" })]))).toBe(false));
  it("close calls are neighbours in the ranking", () => {
    const ranked = rankCombinations([run("a", { score: 74 }), run("b", { score: 63 }), run("c", { score: 40 })]);
    expect(closeCalls(ranked).map(([x, y]) => `${x.stack}~${y.stack}`)).toEqual(["a~b"]);
  });
});

// ---------- invalid runs: shown, but left out of every figure ----------
describe("an invalid run is left out of every figure", () => {
  const bad = (stack: string, o: RunOpts = {}) => run(stack, { invalid: true, ...o });

  it("is recognised by its mark, and only by it", () => {
    expect(isInvalid(bad("a"))).toBe(true);
    expect(isInvalid(run("a"))).toBe(false);
    expect(isInvalid({ ...run("a"), invalid: undefined } as unknown as Row)).toBe(false);  // a row from an older server
  });
  it("has no score of record, however it was scored", () => expect(scoreOfRecord(bad("a", { score: 75 }))).toBeNull());
  it("stands as invalid whatever its status or score: finished and scored, unscored, running", () => {
    expect(standingOf(bad("a"))).toBe("invalid");
    expect(standingOf(bad("a", { score: null }))).toBe("invalid");
    expect(standingOf(bad("a", { status: "running" }))).toBe("invalid");
  });
  it("is one of the reasons a run isn't counted, listed after the others that ask for work", () => {
    expect(NOT_COUNTED_ORDER).toContain("invalid");
    expect(NOT_COUNTED_ORDER.indexOf("invalid")).toBeGreaterThan(NOT_COUNTED_ORDER.indexOf("unscored"));
  });
  it("summarise: not in the runs of record, the score (median, range, n, pooled) or any per-story figure; counted as invalid", () => {
    const c = summarise("a", [
      run("a", { score: 60, secs: [3600], out: [1000], calls: [10], read: [5000] }),
      run("a", { score: 62, secs: [7200], out: [3000], calls: [30], read: [7000] }),
      bad("a", { score: 75, secs: [360], out: [100_000], calls: [900], read: [9_000_000] }),
    ]);
    expect(c.ofRecord).toHaveLength(2);
    expect(c.score).toMatchObject({ median: 61, min: 60, max: 62, n: 2, total: 75 });
    expect(c.score!.pooled).toBeCloseTo(122 / 150, 9);
    expect(c.hoursPerStory).toEqual({ median: 1.5, min: 1, max: 2, n: 2 });
    expect(c.outPerStory).toEqual({ median: 2000, min: 1000, max: 3000, n: 2 });
    expect(c.callsPerStory).toEqual({ median: 20, min: 10, max: 30, n: 2 });
    expect(c.readPerStory).toEqual({ median: 6000, min: 5000, max: 7000, n: 2 });
    expect(c.notCounted).toEqual({ invalid: 1 });
    expect(c.invalid.map((r) => r.runId)).toHaveLength(1);
    expect(c.byStatus).toEqual({ finished: 3 });  // it did finish: the status is a fact, the exclusion a judgement
  });
  it("tok/s over runs of record leaves it out too", () => {
    const good = run("a"); (good.usage as { tokS: number | null }).tokS = 40;
    const b = bad("a"); (b.usage as { tokS: number | null }).tokS = 400;
    const r1 = { ...good, stories: [{ id: "1", usage: { agentSeconds: 100, outTokens: 4000 } }] } as unknown as Row;
    const r2 = { ...b, stories: [{ id: "1", usage: { agentSeconds: 100, outTokens: 40_000 } }] } as unknown as Row;
    expect(summarise("a", [r1, r2]).tokS).toEqual({ median: 40, min: 40, max: 40, n: 1 });
  });
  it("a combination whose only finished run is invalid is unranked, and says why", () => {
    const c = summarise("a", [bad("a", { score: 75 }), run("a", { status: "running" })]);
    expect(c.score).toBeNull();
    expect(c.unranked).toBe("no valid finished run: 1 invalid");
  });
  it("the ranking: an invalid run's high score doesn't lift its combination", () => {
    const ranked = rankCombinations([run("a", { score: 60 }), bad("a", { score: 75 }), bad("a", { score: 75 }), run("b", { score: 65 })]);
    expect(ranked.map((c) => [c.stack, c.score?.median])).toEqual([["b", 65], ["a", 60]]);
  });
  it("close calls are judged without it: n counts valid runs only", () => {
    const many = (stack: string, score: number, n: number) => Array.from({ length: n }, () => run(stack, { score }));
    const ranked = rankCombinations([...many("a", 70, SMALL_N + 1), ...many("b", 69, SMALL_N)]);
    expect(closeCalls(ranked)).toHaveLength(0);
    const minus = rankCombinations([...many("a", 70, SMALL_N + 1).map((r, i) => (i ? r : { ...r, invalid: { reason: "x", since: "" } })), ...many("b", 69, SMALL_N)]);
    expect(minus.find((c) => c.stack === "a")!.score!.n).toBe(SMALL_N);
    expect(closeCalls(minus)).toHaveLength(1);
  });
  it("live progress (comboStats) leaves it out", () => {
    const ok = row([{ secs: 3600 }], [[10, 10, "ok"]]);
    const b = { ...row([{ secs: 36_000 }], [[0, 10, "bad"]]), invalid: { reason: "x", since: "" } } as Row;
    expect(comboStats([ok, b])).toEqual({ runs: 1, hoursPerStory: 1, quality: 1 });
  });
});
