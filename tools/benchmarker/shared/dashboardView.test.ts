import { describe, expect, it } from "vitest";
import { SLOW_MIN_MINUTES, SLOW_MIN_RUNS, SLOW_RATIO, observations, scorePlot, seriesOf, slowStories, utilisation } from "./dashboardView.ts";
import { SILENT_MINUTES, type NowLine } from "./overviewView.ts";
import type { JobRef, Row, RunStatus } from "./types.ts";

const HOUR = 3600;
const SUITE = "p-v2.0";
const STACK_A = "q/a/pi", STACK_B = "q/b/pi";

interface Opts { jobs?: JobRef[]; stack?: string; id: string; status?: RunStatus; machine?: string; storySecs?: number[]; score?: number | null; position?: number; minutes?: number; scope?: number; knownGood?: boolean; started?: number }

/** A run: finished and scored unless told otherwise, each story taking the seconds given. */
const run = (o: Opts): Row => {
  const secs = o.storySecs ?? [];
  const status = o.status ?? "finished";
  const scope = o.scope ?? Math.max(secs.length, 3);
  return {
    pack: "p", stack: o.stack ?? STACK_A, label: o.stack ?? STACK_A, runId: o.id, machine: o.machine ?? "m1", node: o.machine ?? "m1", status, suite: SUITE, family: "p-v2",
    knownGood: o.knownGood ?? false,
    scores: o.score === null ? {} : { [SUITE]: { passed: o.score ?? 60, total: 75, flaky: 0, at: "" } },
    stories: secs.map((s, i) => ({ id: String(i + 1), title: `Story ${i + 1}`, usage: { agentSeconds: s } })),
    storiesWorking: { working: 0, scope, squares: Array.from({ length: scope }, (_, i) => ({ id: String(i + 1), state: i < secs.length ? "ok" : "unbuilt", passed: null, total: null })) },
    jobs: o.jobs ?? [], usage: {}, interventions: [],
    live: status === "running" || status === "queued"
      ? { jobId: o.id, status, currentStory: String(secs.length + 1), runningStory: String(secs.length + 1), agentMinutes: o.minutes ?? 0, storyStartedAt: o.started ?? null, storyTitle: null, storiesInScope: scope, runStartedAt: null, totalAgentMinutes: null, queue: status === "queued" ? { position: o.position ?? 2, ahead: [] } : null }
      : null,
  } as unknown as Row;
};

const finished = (id: string, total: number, o: Partial<Opts> = {}) => run({ id, storySecs: [total / 3, total / 3, total / 3], ...o });

describe("a series of runs of one stack", () => {
  it("runs named <prefix>-rN of one stack are one series: done, running, queued; cancelled and partial reruns are not in it", () => {
    const rs = [
      finished("v2-fresh-r1", 8 * HOUR, { score: 59 }), run({ id: "v2-fresh-r2", status: "running", storySecs: [100, 100] }),
      run({ id: "v2-fresh-r3", status: "queued" }), run({ id: "v2-fresh-r4", status: "queued" }),
      run({ id: "v2-fresh-r5", status: "cancelled" }), finished("v2-fresh-r9", HOUR, { knownGood: true }),
    ];
    const [s] = seriesOf(rs);
    expect(s.runs.map((r) => [r.runId, r.state])).toEqual([["v2-fresh-r1", "finished"], ["v2-fresh-r2", "running"], ["v2-fresh-r3", "queued"], ["v2-fresh-r4", "queued"]]);
    expect(s.done).toBe(1);
    expect(s.size).toBe(4);
    expect(s.runs[0].score).toBe(59);
    expect(s.runs[1].stories).toEqual({ done: 2, scope: 3 });
  });
  it("a series' score is the median of its finished runs' scores of record, out of the suite's total; none finished: null", () => {
    const rs = [finished("s-r1", HOUR, { score: 60 }), finished("s-r2", HOUR, { score: 70 }), finished("s-r3", HOUR, { score: 50 }), run({ id: "s-r4", status: "queued" })];
    const [s] = seriesOf(rs);
    expect(s.score).toEqual({ median: 60, min: 50, max: 70, total: 75, n: 3 });
    expect(seriesOf([run({ id: "t-r1", status: "queued" })])[0].score).toBeNull();
  });
  it("two series of one stack stay apart; the ones with work in hand come first", () => {
    const rs = [finished("v2-r1", HOUR), finished("v2-r2", HOUR), run({ id: "v2-fresh-r1", status: "running", storySecs: [] }), run({ id: "v2-fresh-r2", status: "queued" })];
    const all = seriesOf(rs);
    expect(all.map((s) => s.prefix)).toEqual(["v2-fresh", "v2"]);
  });
  it("a run whose id has no -rN is its own series of one", () => {
    expect(seriesOf([finished("run-9", HOUR)]).map((s) => [s.prefix, s.size])).toEqual([["run-9", 1]]);
  });
});

describe("a story much slower than the same story in this stack's other runs", () => {
  const others = [1, 2, 3].map((i) => finished(`d${i}`, 3 * 1800, {}));   // every story 30 min
  const slowRun = (secs: number) => run({ id: "cur", status: "running", storySecs: [1800, secs], minutes: 5 });
  it("flagged at SLOW_RATIO times the median, with the figures", () => {
    const [s] = slowStories([...others, slowRun(SLOW_RATIO * 1800)]);
    expect(s).toMatchObject({ runId: "cur", story: "2", seconds: SLOW_RATIO * 1800, medianSeconds: 1800, n: 3 });
    expect(s.ratio).toBeCloseTo(SLOW_RATIO, 5);
  });
  it("not below the ratio, not on too few runs, not a short story", () => {
    expect(slowStories([...others, slowRun(1.9 * 1800)])).toEqual([]);
    expect(slowStories([...others.slice(0, SLOW_MIN_RUNS - 1), slowRun(5 * 1800)])).toEqual([]);
    const quick = [1, 2, 3].map((i) => finished(`q${i}`, 3 * 60));
    expect(slowStories([...quick, run({ id: "cur", status: "running", storySecs: [60, (SLOW_MIN_MINUTES - 1) * 60] })])).toEqual([]);
  });
  it("only runs in progress are looked at", () => {
    const old = run({ id: "old", storySecs: [1800, 6 * 1800] });
    expect(slowStories([...others, old])).toEqual([]);
  });
});

const line = (o: Partial<NowLine> & { machine: string }): NowLine => ({ state: "running", run: null, story: null, storyTitle: null, finishing: false, minutes: null, silent: null, queued: 0, ...o });

describe("observations: facts about the work, in the order a person could act on them", () => {
  const rs: Row[] = [];
  it("an idle machine with nothing queued is one; a machine with a queue and nothing running is not", () => {
    const o = observations([line({ machine: "a", state: "idle" }), line({ machine: "b", state: "queuedOnly", queued: 2 })], rs, 0);
    expect(o.map((x) => [x.kind, x.machine])).toEqual([["idle", "a"]]);   // b is not idle: its queue is waiting
    expect(o[0].text).toBe("a: idle, nothing queued");
  });
  it("a silent run is one, from SILENT_MINUTES; below it is not", () => {
    const o = observations([line({ machine: "a", silent: SILENT_MINUTES + 10 }), line({ machine: "b", silent: SILENT_MINUTES - 1 })], rs, 0);
    expect(o.map((x) => [x.kind, x.machine])).toEqual([["silent", "a"]]);
    expect(o[0].text).toBe(`a: no activity for ${SILENT_MINUTES + 10} min`);
  });
  it("an unreachable machine is one, as the app already says it, with no cause", () => {
    const o = observations([line({ machine: "a", state: "unreachable" })], rs, 0);
    expect(o[0]).toMatchObject({ kind: "unreachable", text: "a: not reachable" });
  });
  it("a slow story is one, with its time, the median and how many runs it is over", () => {
    const others = [1, 2, 3].map((i) => finished(`d${i}`, 3 * 1800));
    const cur = run({ id: "cur", status: "running", storySecs: [1800, 4 * 1800], machine: "a", minutes: 5 });
    const o = observations([line({ machine: "a" })], [...others, cur], 0);
    expect(o.find((x) => x.kind === "slow")?.text).toBe("cur story 2: 2h00m, 4.0 times the 30 min median of 3 runs");
  });
  it("a run with several slow stories is one observation, for the slowest, with how many more", () => {
    const others = [1, 2, 3].map((i) => finished(`d${i}`, 3 * 1800));
    const cur = run({ id: "cur", status: "running", storySecs: [3 * 1800, 5 * 1800, 4 * 1800], machine: "a", minutes: 5 });
    const slow = observations([line({ machine: "a" })], [...others, cur], 0).filter((x) => x.kind === "slow");
    expect(slow).toHaveLength(1);
    expect(slow[0].text).toBe("cur story 2: 2h30m, 5.0 times the 30 min median of 3 runs; 2 more stories this slow");
    expect(slow[0].run?.story).toBe("2");
  });
  it("one more slow story is \"1 more story\", not \"1 more stories\"", () => {
    const others = [1, 2, 3].map((i) => finished(`d${i}`, 3 * 1800));
    const cur = run({ id: "cur", status: "running", storySecs: [3 * 1800, 5 * 1800], machine: "a", minutes: 5 });
    const slow = observations([line({ machine: "a" })], [...others, cur], 0).find((x) => x.kind === "slow");
    expect(slow?.text).toBe("cur story 2: 2h30m, 5.0 times the 30 min median of 3 runs; 1 more story this slow");
  });
  it("ordered: unreachable, silent, idle, slow", () => {
    // 30-minute stories, so cur's second story at 2 h is four times the median and really is slow: the point of
    // this test is the ORDER, which needs every kind to actually fire.
    const others = [1, 2, 3].map((i) => finished(`d${i}`, 3 * 1800));
    const cur = run({ id: "cur", status: "running", storySecs: [1800, 4 * 1800], machine: "d", minutes: 5 });
    const lines = [line({ machine: "d" }), line({ machine: "c", state: "idle" }), line({ machine: "b", silent: 60 }), line({ machine: "a", state: "unreachable" })];
    expect(observations(lines, [...others, cur], 0).map((x) => x.kind)).toEqual(["unreachable", "silent", "idle", "slow"]);
  });
  it("nothing to say: none", () => expect(observations([line({ machine: "a" })], rs, 0)).toEqual([]));
});

describe("the score plot: a dot for every run of record, the median and the range, on one axis", () => {
  const ref = (n: string) => `reference/${n}`;
  it("one row per combination with a score, best median first: the dots, median, range and runs", () => {
    // Series-shaped ids: a stack's runs are one experiment, and the headline is that series' (shared/stats.ts).
    const rs = [finished("v2-r1", HOUR, { score: 50 }), finished("v2-r2", HOUR, { score: 60 }), finished("v2-r3", HOUR, { score: 70 }), finished("v2-r1", HOUR, { stack: STACK_B, score: 66 })];
    const p = scorePlot(rs);
    expect(p.total).toBe(75);
    expect(p.rows.map((r) => r.stack)).toEqual([STACK_B, STACK_A]);
    expect(p.rows[1]).toMatchObject({ dots: [50, 60, 70], median: 60, min: 50, max: 70, n: 3 });
  });
  it("a combination with no score is left out; no runs of record: no rows and no axis", () => {
    expect(scorePlot([finished("a1", HOUR, { score: 60 }), finished("c1", HOUR, { stack: "q/c/pi", score: null })]).rows.map((r) => r.stack)).toEqual([STACK_A]);
    expect(scorePlot([run({ id: "r", status: "running" })])).toMatchObject({ total: null, rows: [], references: [], groups: [], narrative: [] });
  });
  it("the scale starts at the tens below the lowest ordinary dot, so the differences are visible", () => {
    const rs = [finished("a1", HOUR, { score: 56 }), finished("a2", HOUR, { score: 70 }), finished("b1", HOUR, { stack: STACK_B, score: 74 })];
    expect(scorePlot(rs).axisMin).toBe(50);
  });
  it("a run far below the rest is off the scale: pinned at the edge, listed, and never moves the scale", () => {
    const rs = [1, 61, 63, 62, 56].map((s, i) => finished(`a${i}`, HOUR, { score: s }));
    const p = scorePlot(rs);
    expect(p.axisMin).toBe(50);
    expect(p.offScale).toEqual([{ stack: STACK_A, label: STACK_A, value: 1 }]);
  });
  it("neighbours the runs can't separate form one group, however long the chain", () => {
    const rs = [finished("a1", HOUR, { score: 75 }), finished("b1", HOUR, { stack: STACK_B, score: 70 }), finished("c1", HOUR, { stack: "q/c/pi", score: 66 }), finished("d1", HOUR, { stack: "q/d/pi", score: 30 })];
    expect(scorePlot(rs).groups).toEqual([[STACK_A, STACK_B, "q/c/pi"]]);
  });
  it("no group when nothing is close", () => {
    expect(scorePlot([finished("a1", HOUR, { score: 70 }), finished("b1", HOUR, { stack: STACK_B, score: 30 })]).groups).toEqual([]);
  });
  it("says it in words: how to read it, the top, the reference's line, the groups, the off-scale run", () => {
    const rs = [
      ...[75, 75, 74].map((s, i) => finished(`v2-r${i + 1}`, HOUR, { stack: ref("opus-5.5"), score: s })),
      ...[70, 66, 72].map((s, i) => finished(`v2-r${i + 1}`, HOUR, { stack: STACK_B, score: s })),
      ...[1, 61, 63].map((s, i) => finished(`v2-r${i + 1}`, HOUR, { score: s })),
    ];
    const n = scorePlot(rs).narrative;
    expect(n[0]).toBe("Each dot is one finished run: how many of the 75 hidden tests it passed. The black bar is the middle run; the grey line runs from the lowest to the highest. Further right is better.");
    expect(n).toContain("Highest: q/b/pi, 70 of 75 in the middle, over 3 runs.");
    expect(n).toContain("The dashed line is reference/opus-5.5, the reference: 75 of 75 in the middle, over 3 runs.");
    expect(n).toContain("One run of q/a/pi scored 1, off the left edge of the scale.");
    expect(n.at(-1)).toBe("The scale starts at 60, not 0, so the differences show.");
  });

  // The reference is the yardstick the stacks are read against, not one of them (UI-IMPROVEMENTS-overview-dashboard).
  it("a reference is not a row and not ranked: it comes back on its own, to be drawn across the plot", () => {
    const rs = [
      ...[75, 74].map((s, i) => finished(`v2-r${i + 1}`, HOUR, { stack: ref("opus-5.5"), score: s })),
      ...[70, 66].map((s, i) => finished(`v2-r${i + 1}`, HOUR, { stack: STACK_B, score: s })),
    ];
    const p = scorePlot(rs);
    expect(p.rows.map((r) => r.stack)).toEqual([STACK_B]);
    expect(p.references.map((r) => r.stack)).toEqual([ref("opus-5.5")]);
    expect(p.references[0]).toMatchObject({ median: 74.5, min: 74, max: 75, n: 2 });
    // ... and never in a close-call group, which only orders the stacks under test.
    expect(p.groups).toEqual([]);
  });
  it("the reference never sets the scale: it is the stacks under test that have to be told apart", () => {
    const rs = [
      finished("v2-r1", HOUR, { stack: ref("opus-5.5"), score: 75 }),
      ...[56, 70].map((s, i) => finished(`v2-r${i + 1}`, HOUR, { score: s })),
    ];
    expect(scorePlot(rs).axisMin).toBe(50);
  });
  it("only references scored: the scale is theirs, so their lines still have an axis", () => {
    const p = scorePlot([finished("v2-r1", HOUR, { stack: ref("opus-5.5"), score: 72 })]);
    expect(p.rows).toEqual([]);
    expect(p.references.map((r) => r.median)).toEqual([72]);
    expect(p.axisMin).toBe(70);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the utilisation timeline: one lane per machine, what it ran and the gaps between", () => {
  const H = 3600;
  const NOW = Date.parse("2026-10-05T12:00:00Z") / 1000;
  /** A job as a run carries it: queued at `sub`, ended at `end` (null while it is still going). */
  const withJob = (id: string, machine: string, sub: number, end: number | null, over: Partial<Opts> = {}) =>
    run({ id, machine, status: end === null ? "running" : "finished", ...over,
          jobs: [{ id, node: machine, status: end === null ? "running" : "done", submittedAt: sub, updatedAt: end ?? NOW, endedAt: end }] } as Opts);

  it("a machine's lane: a segment per job, in time order, with the gaps left out", () => {
    const rs = [
      withJob("v2-r1", "m1", NOW - 10 * H, NOW - 8 * H),
      withJob("v2-r2", "m1", NOW - 3 * H, NOW - 1 * H),      // queued 5 h after the first ended: an idle gap
    ];
    const u = utilisation(rs, NOW, 24 * H);
    expect(u.lanes.map((l) => l.machine)).toEqual(["m1"]);
    expect(u.lanes[0].segments.map((s) => [s.runId, s.from - NOW, s.to - NOW])).toEqual([
      ["v2-r1", -10 * H, -8 * H],
      ["v2-r2", -3 * H, -1 * H],
    ]);
    expect(u.lanes[0].busySeconds).toBe(4 * H);              // 2 h + 2 h of the 24 h window
  });

  it("a job that waited in the queue is busy only from when the machine was free", () => {
    // It was submitted while the one before it was still running, so it cannot have started before that one ended.
    const rs = [
      withJob("v2-r1", "m1", NOW - 10 * H, NOW - 6 * H),
      withJob("v2-r2", "m1", NOW - 9 * H, NOW - 4 * H),      // queued an hour in, ran from 6 h ago
    ];
    const u = utilisation(rs, NOW, 24 * H);
    expect(u.lanes[0].segments.map((s) => [s.runId, s.from - NOW])).toEqual([["v2-r1", -10 * H], ["v2-r2", -6 * H]]);
    expect(u.lanes[0].busySeconds).toBe(6 * H);
  });

  it("a running job runs to now, and says so", () => {
    const u = utilisation([withJob("v2-r3", "m1", NOW - 2 * H, null)], NOW, 24 * H);
    expect(u.lanes[0].segments[0]).toMatchObject({ runId: "v2-r3", to: NOW, running: true });
  });

  it("only the window: an older job is cut at its start, one wholly before it is left out", () => {
    const rs = [
      withJob("old", "m1", NOW - 40 * H, NOW - 30 * H),      // wholly before the window
      withJob("edge", "m1", NOW - 26 * H, NOW - 20 * H),     // starts before it, ends inside
    ];
    const u = utilisation(rs, NOW, 24 * H);
    expect(u.lanes[0].segments.map((s) => s.runId)).toEqual(["edge"]);
    expect(u.lanes[0].segments[0].from).toBe(NOW - 24 * H);  // cut at the window's start
  });

  it("every machine that ran anything gets a lane, busiest first; one that ran nothing is left out", () => {
    const rs = [
      withJob("a1", "quiet", NOW - 5 * H, NOW - 4.5 * H),
      withJob("b1", "busy", NOW - 5 * H, NOW - 1 * H),
    ];
    const u = utilisation(rs, NOW, 24 * H);
    expect(u.lanes.map((l) => l.machine)).toEqual(["busy", "quiet"]);
    expect(u.from).toBe(NOW - 24 * H);
    expect(u.to).toBe(NOW);
  });

  it("nothing ran: no lanes", () => expect(utilisation([], NOW, 24 * H).lanes).toEqual([]));
});
