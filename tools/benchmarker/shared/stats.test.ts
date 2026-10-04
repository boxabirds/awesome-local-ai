import { describe, expect, it } from "vitest";
import { closeCalls, comboStats, compareRanked, indistinguishable, INDISTINGUISHABLE_TESTS, isComplete, median, NOT_COUNTED_ORDER, perStory, rankCombinations, runTokS, scoreOfRecord, SMALL_N, spread, standingOf, summarise, visibleRuns } from "./stats.ts";
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
interface RunOpts { status?: RunStatus; score?: number | null; scores?: Record<string, number>; secs?: (number | null)[]; out?: number[]; calls?: number[]; read?: number[]; machine?: string }
let seq = 0;
/** A run of stack `stack`: finished and scored `score`/75 under the current suite unless told otherwise. */
interface RunOptsExt extends RunOpts { runId?: string; stateAt?: string; knownGood?: boolean }
const run = (stack: string, o: RunOptsExt = {}): Row => {
  const secs = o.secs ?? [3600];
  const scores = o.scores ?? (o.score === undefined ? { [SUITE]: 60 } : o.score === null ? {} : { [SUITE]: o.score });
  return {
    pack: "p", stack, label: stack, runId: o.runId ?? `v2-r${++seq}`, machine: o.machine ?? "m1", status: o.status ?? "finished", suite: SUITE, knownGood: o.knownGood ?? false,
    stateAt: o.stateAt ?? "2026-10-01T00:00:00Z",
    scores: Object.fromEntries(Object.entries(scores).map(([v, p]) => [v, { passed: p, total: 75, flaky: 0, at: "" }])),
    stories: secs.map((s, i) => ({ id: String(i + 1), usage: { agentSeconds: s, outTokens: o.out?.[i] ?? null, calls: o.calls?.[i] ?? null, readTokens: o.read?.[i] ?? null } as Usage })),
    storiesWorking: { squares: [] }, usage: { tokS: null }, interventions: [],
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
  it("finished, unscored or scored only under another version: pending", () => {
    expect(standingOf(run("a", { score: null }))).toBe("pending");
    expect(standingOf(run("a", { scores: { [OLD_SUITE]: 70 } }))).toBe("pending");
  });
  it("any other status: that status", () => expect(standingOf(run("a", { status: "running" }))).toBe("running"));
});

describe("a partial rerun is never counted as a full run", () => {
  it("finished and scored, but known-good: not of record, whatever its own score", () => {
    expect(standingOf(run("a", { knownGood: true, score: 74 }))).toBe("partial rerun");
  });
  it("ranking: excluded from n, the median and the mean", () => {
    const rs = [run("a", { score: 60 }), run("a", { score: 70 }), run("a", { knownGood: true, score: 100, scores: { [SUITE]: 100 } })];
    const sum = summarise("a", rs);
    expect(sum.score?.n).toBe(2);
    expect(sum.score?.median).toBe(65);
  });
  it("a combination with only known-good runs is unranked, not scored on them", () => {
    const sum = summarise("a", [run("a", { knownGood: true, score: 74 })]);
    expect(sum.score).toBeNull();
    expect(sum.unranked).toMatch(/no finished run/);
  });
  it("counted in byStatus (it's still a finished run) but not in notCounted (it has its own reason, not a status)", () => {
    const sum = summarise("a", [run("a", { knownGood: true, score: 74 })]);
    expect(sum.byStatus.finished).toBe(1);
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
  it("two series: the headline is the current one's, never a median across both", () => {
    // A series is one experiment (an engine build, a quant, a setting). Pooling two answers no question: Swift 1.5
    // read 61.5 on 4 Oct 2026 from v2 (median 61) and v2-fresh (median 66), a figure neither series ever scored.
    const c = summarise("a", [
      run("a", { runId: "v2-r1", score: 58, stateAt: "2026-10-01T00:00:00Z" }),
      run("a", { runId: "v2-r2", score: 61, stateAt: "2026-10-01T01:00:00Z" }),
      run("a", { runId: "v2-r3", score: 63, stateAt: "2026-10-01T02:00:00Z" }),
      run("a", { runId: "v2-fresh-r1", score: 66, stateAt: "2026-10-03T00:00:00Z" }),
      run("a", { runId: "v2-fresh-r2", score: 67, stateAt: "2026-10-03T01:00:00Z" }),
    ]);
    expect(c.score).toMatchObject({ median: 66.5, min: 66, max: 67, n: 2 });   // v2-fresh, the newest
    expect(c.series.map((x) => [x.prefix, x.score?.median, x.score?.n])).toEqual([["v2-fresh", 66.5, 2], ["v2", 61, 3]]);
    expect(c.currentSeries).toBe("v2-fresh");
  });
  it("the current series is the one with work in hand, even when another finished later", () => {
    const c = summarise("a", [
      run("a", { runId: "v2-r1", score: 58, stateAt: "2026-10-01T00:00:00Z" }),
      run("a", { runId: "v2-r2", score: 62, stateAt: "2026-10-01T01:00:00Z" }),
      run("a", { runId: "old-r1", score: 70, stateAt: "2026-10-05T00:00:00Z" }),   // finished later, but nothing in hand
      run("a", { runId: "v2-r3", status: "queued", score: null, stateAt: "2026-10-02T00:00:00Z" }),
    ]);
    expect(c.currentSeries).toBe("v2");
    expect(c.score).toMatchObject({ median: 60, n: 2 });
  });
  it("one series: exactly as before, and no series is singled out", () => {
    const c = summarise("a", [run("a", { score: 63 }), run("a", { score: 67 })]);
    expect(c.score).toMatchObject({ median: 65, n: 2 });
    expect(c.series).toHaveLength(1);
  });
  it("finished but none scored: unranked, with how many finished", () => {
    const c = summarise("a", [run("a", { score: null }), run("a", { scores: { [OLD_SUITE]: 74 } })]);
    expect(c.unranked).toBe("2 finished, scores pending");
    expect(c.notCounted).toEqual({ pending: 2 });
  });
  it("one run of record: its numbers, n=1", () => {
    const c = summarise("a", [run("a", { score: 63, secs: [1800, 3600] })]);
    expect(c.score).toEqual({ median: 63, min: 63, max: 63, n: 1, total: 75, mean: 63 / 75 });
    expect(c.hoursPerStory).toEqual({ median: 0.75, min: 0.75, max: 0.75, n: 1 });
    expect(c.unranked).toBeNull();
  });
  it("several (odd): median, range and mean over those runs; running and pending runs never fold in", () => {
    const c = summarise("a", [
      run("a", { score: 63, secs: [3600] }), run("a", { score: 68, secs: [1800] }), run("a", { score: 58, secs: [7200] }),
      run("a", { status: "running", score: 75, secs: [60] }), run("a", { scores: { [OLD_SUITE]: 75 }, secs: [60] }),
    ]);
    expect(c.score).toEqual({ median: 63, min: 58, max: 68, n: 3, total: 75, mean: (63 + 68 + 58) / 225 });
    expect(c.hoursPerStory).toEqual({ median: 1, min: 0.5, max: 2, n: 3 });
    expect(c.notCounted).toEqual({ running: 1, pending: 1 });
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
  it("by score median, highest first, whatever the live or mean figures", () => {
    const ranked = rankCombinations([run("low", { score: 60 }), run("high", { score: 70 }), run("mid", { score: 65 })]);
    expect(ranked.map((c) => c.stack)).toEqual(["high", "mid", "low"]);
  });
  it("a combination with no run of record sorts last, however good its running runs look", () => {
    const ranked = rankCombinations([run("live", { status: "running", score: 75 }), run("done", { score: 40 })]);
    expect(ranked.map((c) => c.stack)).toEqual(["done", "live"]);
    expect(ranked[1].unranked).toBe("no finished run yet");
  });
  it("ties on median: the higher mean first, then more runs, then by name", () => {
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
  it("the old live figure's trap: a running run's easy early stories no longer lift a combination", () => {
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

// ---------- complete runs: the one rule behind the header's switch ----------

describe("a complete run", () => {
  const SCOPE = ["1", "2", "3"];
  interface CompleteOpts extends RunOptsExt { recorded?: string[] }
  /** A run whose scope is three stories; all three recorded unless told otherwise. */
  const scoped = (o: CompleteOpts = {}): Row => {
    const r = run("s", o);
    const recorded = o.recorded ?? SCOPE;
    return {
      ...r,
      stories: recorded.map((id) => ({ id, usage: null })),
      storiesWorking: { working: 0, scope: SCOPE.length, squares: SCOPE.map((id) => ({ id, state: "ok", passed: 1, total: 1 })) },
    } as unknown as Row;
  };

  it("finished, every story in scope recorded, scored under the current suite: complete", () => {
    expect(isComplete(scoped())).toBe(true);
  });

  it("a low score is still complete: a model that broke its build is a result", () => {
    expect(isComplete(scoped({ score: 0 }))).toBe(true);
  });

  it.each(["running", "queued", "failed", "stopped", "cancelled", "unknown"] as RunStatus[])("a %s run is not complete", (status) => {
    expect(isComplete(scoped({ status }))).toBe(false);
  });

  it("finished without its final score: not complete", () => {
    expect(isComplete(scoped({ score: null }))).toBe(false);
  });

  it("finished and scored only under an older suite: not complete", () => {
    expect(isComplete(scoped({ scores: { [OLD_SUITE]: 60 } }))).toBe(false);
  });

  it("finished but missing a story's record: not complete", () => {
    expect(isComplete(scoped({ recorded: ["1", "3"] }))).toBe(false);
  });

  it("a partial rerun of one story is not complete, even with that story recorded and a score", () => {
    const r = scoped({ knownGood: true, recorded: ["2"] });
    const oneStory = { ...r, storiesWorking: { working: 1, scope: 1, squares: [{ id: "2", state: "ok", passed: 1, total: 1 }] } } as unknown as Row;
    expect(isComplete(oneStory)).toBe(false);
  });

  it("the switch: All runs keeps every run, Complete runs keeps only complete ones, in order", () => {
    const a = scoped(), b = scoped({ status: "cancelled" }), c = scoped({ score: null }), d = scoped({ score: 3 });
    expect(visibleRuns([a, b, c, d], "all")).toEqual([a, b, c, d]);
    expect(visibleRuns([a, b, c, d], "complete")).toEqual([a, d]);
  });
});
