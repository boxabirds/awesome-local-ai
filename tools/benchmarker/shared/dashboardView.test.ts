import { describe, expect, it } from "vitest";
import {
  medianRunSeconds, observations, QUEUE_SHORT_HOURS, queueDrain, seriesOf, scorePlot, slowStories, SLOW_MIN_MINUTES, SLOW_MIN_RUNS, SLOW_RATIO,
} from "./dashboardView.ts";
import { SILENT_MINUTES, type NowLine } from "./overviewView.ts";
import type { Row, RunStatus } from "./types.ts";

const HOUR = 3600;
const SUITE = "p-v2.0";
const STACK_A = "q/a/pi", STACK_B = "q/b/pi";

interface Opts { stack?: string; id: string; status?: RunStatus; machine?: string; storySecs?: number[]; score?: number | null; position?: number; minutes?: number; scope?: number; knownGood?: boolean; started?: number }

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
    jobs: [], usage: {}, interventions: [],
    live: status === "running" || status === "queued"
      ? { jobId: o.id, status, currentStory: String(secs.length + 1), runningStory: String(secs.length + 1), agentMinutes: o.minutes ?? 0, storyStartedAt: o.started ?? null, storyTitle: null, storiesInScope: scope, runStartedAt: null, totalAgentMinutes: null, queue: status === "queued" ? { position: o.position ?? 2, ahead: [] } : null }
      : null,
  } as unknown as Row;
};

const finished = (id: string, total: number, o: Partial<Opts> = {}) => run({ id, storySecs: [total / 3, total / 3, total / 3], ...o });

describe("how long a run of a stack takes, measured", () => {
  it("the median agent time of its complete runs, with how many and the lowest and highest", () => {
    const rs = [finished("r1", 6 * HOUR), finished("r2", 8 * HOUR), finished("r3", 10 * HOUR)];
    expect(medianRunSeconds(rs, "p", "p-v2", STACK_A)).toEqual({ median: 8 * HOUR, n: 3, min: 6 * HOUR, max: 10 * HOUR });
  });
  it("leaves out runs that did not finish, partial reruns, and other stacks; none: null", () => {
    const rs = [finished("r1", 6 * HOUR), run({ id: "r2", status: "cancelled", storySecs: [100] }), finished("r3", HOUR, { knownGood: true }), finished("r4", 20 * HOUR, { stack: STACK_B })];
    expect(medianRunSeconds(rs, "p", "p-v2", STACK_A)?.n).toBe(1);
    expect(medianRunSeconds(rs, "p", "p-v2", "none")).toBeNull();
  });
});

describe("how long a machine's queue will take", () => {
  const done = [finished("d1", 8 * HOUR), finished("d2", 8 * HOUR), finished("d3", 8 * HOUR)];
  it("the running run's remainder plus a median run for every queued one, with the basis", () => {
    const running = run({ id: "r1", status: "running", storySecs: [2 * HOUR] });
    const q = [run({ id: "r2", status: "queued", position: 2 }), run({ id: "r3", status: "queued", position: 3 })];
    const d = queueDrain("m1", [...done, running, ...q], 0);
    expect(d.seconds).toBe(6 * HOUR + 2 * 8 * HOUR);
    expect(d.unknown).toBe(0);
    expect(d.basis).toEqual([{ stack: STACK_A, n: 3, median: 8 * HOUR }]);
  });
  it("never below zero: a run past its median adds nothing to the remainder", () => {
    const running = run({ id: "r1", status: "running", storySecs: [12 * HOUR] });
    expect(queueDrain("m1", [...done, running], 0).seconds).toBe(0);
  });
  it("a queued run on a stack with no finished run is counted as unknown, never guessed", () => {
    const q = [run({ id: "r2", status: "queued", stack: STACK_B })];
    const d = queueDrain("m1", [...done, ...q], 0);
    expect(d.seconds).toBe(0);
    expect(d.unknown).toBe(1);
  });
  it("only this machine's queue", () => {
    const q = [run({ id: "r2", status: "queued", machine: "m2" })];
    expect(queueDrain("m1", [...done, ...q], 0)).toEqual({ seconds: 0, unknown: 0, basis: [] });
  });
});

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
  it("a queue that will run dry within QUEUE_SHORT_HOURS is one, with its measured length and basis", () => {
    const done = [finished("d1", 8 * HOUR), finished("d2", 8 * HOUR), finished("d3", 8 * HOUR)];
    const q = [run({ id: "q1", status: "queued", machine: "a" }), run({ id: "q2", status: "queued", machine: "a" })];
    const o = observations([line({ machine: "a", queued: 2 })], [...done, ...q], 0);
    expect(o.find((x) => x.kind === "queue")?.text).toBe("a: 2 queued, about 16 h of work (median of 3 finished runs)");
  });
  it("a longer queue is not news, and neither is one with no estimate (the machine's card says so)", () => {
    const done = [finished("d1", 8 * HOUR), finished("d2", 8 * HOUR), finished("d3", 8 * HOUR)];
    const long = Array.from({ length: QUEUE_SHORT_HOURS / 8 + 1 }, (_, i) => run({ id: `q${i}`, status: "queued", machine: "a" }));
    expect(observations([line({ machine: "a", queued: long.length })], [...done, ...long], 0)).toEqual([]);
    const none = [run({ id: "q1", status: "queued", machine: "a" })];
    expect(observations([line({ machine: "a", queued: 1 })], none, 0)).toEqual([]);
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
  it("ordered: unreachable, silent, idle, slow, queue", () => {
    const others = [1, 2, 3].map((i) => finished(`d${i}`, 8 * HOUR));
    const cur = run({ id: "cur", status: "running", storySecs: [1800, 4 * 1800], machine: "d", minutes: 5 });
    const q = run({ id: "q1", status: "queued", machine: "e" });
    const lines = [line({ machine: "e", queued: 1 }), line({ machine: "d" }), line({ machine: "c", state: "idle" }), line({ machine: "b", silent: 60 }), line({ machine: "a", state: "unreachable" })];
    expect(observations(lines, [...others, cur, q], 0).map((x) => x.kind)).toEqual(["unreachable", "silent", "idle", "queue"]);
  });
  it("nothing to say: none", () => expect(observations([line({ machine: "a" })], rs, 0)).toEqual([]));
});

describe("the score plot: a dot for every run of record, the median and the range, on one axis", () => {
  it("one row per combination with a score, best median first; dots, median, range, n and the axis total", () => {
    const rs = [finished("a1", HOUR, { score: 50 }), finished("a2", HOUR, { score: 60 }), finished("a3", HOUR, { score: 70 }), finished("b1", HOUR, { stack: STACK_B, score: 66 })];
    const p = scorePlot(rs);
    expect(p.total).toBe(75);
    expect(p.rows.map((r) => r.stack)).toEqual([STACK_B, STACK_A]);
    expect(p.rows[1]).toMatchObject({ dots: [50, 60, 70], median: 60, min: 50, max: 70, n: 3 });
  });
  it("combinations that can't be told apart are marked as a pair; a combination with no score is left out", () => {
    const rs = [finished("a1", HOUR, { score: 60 }), finished("b1", HOUR, { stack: STACK_B, score: 65 }), finished("c1", HOUR, { stack: "q/c/pi", score: null })];
    const p = scorePlot(rs);
    expect(p.rows.map((r) => r.stack)).toEqual([STACK_B, STACK_A]);
    expect(p.closeCalls).toEqual([[STACK_B, STACK_A]]);
  });
  it("no runs of record: no rows and no axis", () => {
    expect(scorePlot([run({ id: "r", status: "running" })])).toEqual({ total: null, rows: [], closeCalls: [] });
  });
});
