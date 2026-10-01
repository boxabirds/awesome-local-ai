import { describe, expect, it } from "vitest";
import {
  acrossCombinations, acrossNoMedian, attemptOf, combinationSummary, compareGroups, compareParam, comparisonOf, heldOutTests, parseCompare, relativeTo, sameStory,
  STORY_MEASURES, storyList, storyNeighbours, storyPage, storyTitleOf, SUMMARY_KEYS, type Group,
} from "./storyView.ts";
import { DIVERGENCE, MIN_RUNS_FOR_MEDIAN, SPLIT_PARTS, storyMedians } from "./combinationView.ts";
import { SEGMENTS } from "./runView.ts";
import { GLOSSARY } from "./glossary.ts";
import type { Live, Row, RunStatus, Story, StorySquare, TimeSplit, Usage } from "./types.ts";

// MECE by what the page works out: the measures; the story list, titles, neighbours and test counts; one run's part
// in the story; each combination's median and range; the divergence rule; the order of combinations and runs; the
// comparison; and the one definition of the time-bar segments.

// ---------- builders ----------

const MINUTE = 60;
const WALL = 600;

function split(o: Partial<TimeSplit> = {}): TimeSplit {
  const wall = o.wall ?? WALL;
  return { wall, prefill: 60, decode: 400, tools: 100, compaction: 20, other: 20, modelUnsplit: 0, betweenSessions: 0, ...o };
}
function usage(o: Partial<Usage> = {}): Usage {
  return {
    outTokens: 50000, inTokens: 1e5, cacheRead: 1e6, readTokens: 1.1e6, calls: 100, agentSeconds: WALL, tokS: 50000 / WALL,
    decodeTokens: 50000, decodeSeconds: 400, decodeTokS: 100, prefillTokens: 1e4, prefillSeconds: 60, prefillTokS: 200,
    draftAcceptance: null, compactions: 1, nudges: 0, split: split({ wall: o.agentSeconds ?? WALL }), ...o,
  };
}
function story(id: string, o: { usage?: Usage | null; own?: [number | null, number | null]; title?: string } = {}): Story {
  const [ownPassed, ownTotal] = o.own ?? [10, 10];
  return { id, title: o.title ?? `Story ${id}`, status: "DONE", passed: null, total: null, ownPassed, ownTotal, usage: o.usage === undefined ? usage() : o.usage, conversation: null };
}
/** Minutes as a story run: `mins(12)` took 12 minutes. */
const mins = (m: number, o: Partial<Usage> = {}) => usage({ agentSeconds: m * MINUTE, ...o });

let seq = 0;
interface RunOpts {
  status?: RunStatus; runId?: string; stack?: string; label?: string; machine?: string;
  squares?: StorySquare[]; live?: Partial<Live> | null; scope?: number; pack?: string; family?: string;
}
function run(stories: Story[], o: RunOpts = {}): Row {
  const status = o.status ?? "finished";
  const squares = o.squares ?? stories.map((s) => ({ id: s.id, state: "ok" as const, passed: s.ownPassed, total: s.ownTotal }));
  return {
    pack: o.pack ?? "p", family: o.family ?? "p-v2", stack: o.stack ?? "a/stack", label: o.label ?? "A", runId: o.runId ?? `r${++seq}`, status, suite: "v2", scores: {}, stories,
    machine: o.machine ?? "m1", host: "Host 1", statusNote: "", stateAt: "",
    storiesWorking: { working: 0, scope: o.scope ?? squares.length, squares },
    live: o.live === undefined ? null : o.live === null ? null : ({ status, currentStory: null, runningStory: null, storyTitle: null, agentMinutes: null, calls: null, outputTokens: null, ...o.live } as Live),
    usage: { tokS: null }, jobs: [], interventions: [],
  } as unknown as Row;
}
const sq = (id: string, state: StorySquare["state"], passed: number | null = null, total: number | null = null): StorySquare => ({ id, state, passed, total });

// ---------- the measures ----------

describe("STORY_MEASURES", () => {
  it("the four summarised measures come first, in the plan's order", () => {
    expect(STORY_MEASURES.filter((m) => m.summarised).map((m) => m.key)).toEqual(SUMMARY_KEYS);
    expect(STORY_MEASURES.slice(0, SUMMARY_KEYS.length).map((m) => m.key)).toEqual(SUMMARY_KEYS);
  });
  it("covers everything the by-story view showed, and held-out", () => {
    expect(STORY_MEASURES.map((m) => m.key)).toEqual(["minutes", "outTokens", "calls", "heldOut", "readTokens", "tokS", "decodeTokS", "compactions", "nudges"]);
  });
  it("every heading has a glossary term", () => {
    for (const m of STORY_MEASURES) expect(GLOSSARY[m.term].name).toBeTruthy();
  });
  it("held-out is never a percentage of the comparison's; everything else is", () => {
    expect(STORY_MEASURES.filter((m) => !m.relative).map((m) => m.key)).toEqual(["heldOut"]);
  });
  it("reads a recorded story: minutes from seconds, held-out as a pass rate", () => {
    const s = story("1", { usage: mins(12, { calls: 7, readTokens: 3, tokS: 4, decodeTokS: 5, compactions: 6, nudges: 0 }), own: [3, 4] });
    const v = Object.fromEntries(STORY_MEASURES.map((m) => [m.key, m.value(s)]));
    expect(v).toEqual({ minutes: 12, outTokens: 50000, calls: 7, heldOut: 0.75, readTokens: 3, tokS: 4, decodeTokS: 5, compactions: 6, nudges: 0 });
  });
  it("missing: null, never 0 (no usage; a field not recorded; no held-out tests)", () => {
    const none = story("1", { usage: null, own: [null, null] });
    for (const m of STORY_MEASURES) expect(m.value(none)).toBeNull();
    expect(STORY_MEASURES.find((m) => m.key === "calls")!.value(story("1", { usage: usage({ calls: null }) }))).toBeNull();
  });
  it("zero is a value: 0 nudges, 0 of 5 tests passing", () => {
    const s = story("1", { usage: usage({ nudges: 0 }), own: [0, 5] });
    expect(STORY_MEASURES.find((m) => m.key === "nudges")!.value(s)).toBe(0);
    expect(STORY_MEASURES.find((m) => m.key === "heldOut")!.value(s)).toBe(0);
  });
});

// ---------- the stories ----------

describe("storyList and storyTitleOf", () => {
  it("every story in any run's scope or record, in numeric order, each once", () => {
    const a = run([story("2")], { squares: [sq("1", "unbuilt"), sq("2", "ok"), sq("10", "unbuilt")] });
    const b = run([story("3")], { squares: [sq("3", "ok")] });
    expect(storyList([a, b]).map((s) => s.id)).toEqual(["1", "2", "3", "10"]);
  });
  it("no runs: no stories", () => expect(storyList([])).toEqual([]));
  it("the title most runs recorded wins", () => {
    const rs = [run([story("1", { title: "Long title" })], { status: "running" }), run([story("1", { title: "Pan" })]), run([story("1", { title: "Pan" })])];
    expect(storyTitleOf(rs, "1")).toBe("Pan");
  });
  it("a tie goes to the first run in run order (finished before running)", () => {
    const rs = [run([story("1", { title: "Running's" })], { status: "running", runId: "r-a" }), run([story("1", { title: "Finished's" })], { runId: "r-b" })];
    expect(storyTitleOf(rs, "1")).toBe("Finished's");
  });
  it("no record names it: the live title of the story being built; else empty", () => {
    const building = run([], { status: "running", squares: [sq("3", "running")], live: { runningStory: "3", storyTitle: "Live title" } });
    expect(storyTitleOf([building], "3")).toBe("Live title");
    expect(storyTitleOf([building], "4")).toBe("");
  });
  it("story ids compare as numbers", () => {
    expect(sameStory("02", "2")).toBe(true);
    expect(sameStory("12", "2")).toBe(false);
    expect(storyTitleOf([run([story("02", { title: "Two" })])], "2")).toBe("Two");
  });
});

describe("storyNeighbours", () => {
  const list = [{ id: "1", title: "" }, { id: "2", title: "" }, { id: "4", title: "" }];
  it("the first story: no previous", () => expect(storyNeighbours(list, "1")).toEqual({ prev: null, next: list[1] }));
  it("the last story: no next", () => expect(storyNeighbours(list, "4")).toEqual({ prev: list[1], next: null }));
  it("in the middle: both, skipping a gap in the numbers", () => expect(storyNeighbours(list, "2")).toEqual({ prev: list[0], next: list[2] }));
  it("the only story: neither", () => expect(storyNeighbours([list[0]], "1")).toEqual({ prev: null, next: null }));
  it("a story not in the list: neither", () => expect(storyNeighbours(list, "3")).toEqual({ prev: null, next: null }));
});

describe("heldOutTests", () => {
  it("one count when every run agrees", () => {
    expect(heldOutTests([run([story("1", { own: [6, 6] })]), run([story("1", { own: [5, 6] })])], "1")).toEqual([{ total: 6, runs: 2 }]);
  });
  it("counts that differ (another suite version): each with its runs, the most runs first", () => {
    const rs = [run([story("2", { own: [9, 10] })]), run([story("2", { own: [14, 14] })]), run([story("2", { own: [12, 14] })])];
    expect(heldOutTests(rs, "2")).toEqual([{ total: 14, runs: 2 }, { total: 10, runs: 1 }]);
  });
  it("a tie in runs: the larger count first", () => {
    expect(heldOutTests([run([story("2", { own: [1, 10] })]), run([story("2", { own: [1, 14] })])], "2")).toEqual([{ total: 14, runs: 1 }, { total: 10, runs: 1 }]);
  });
  it("a run without a record of the story counts its latest-build square", () => {
    expect(heldOutTests([run([], { squares: [sq("3", "part", 2, 5)] })], "3")).toEqual([{ total: 5, runs: 1 }]);
  });
  it("nothing counted (no tests recorded, or unbuilt squares): empty", () => {
    expect(heldOutTests([run([story("1", { own: [null, null] })], { squares: [sq("1", "ok")] }), run([], { squares: [sq("1", "unbuilt")] })], "1")).toEqual([]);
  });
});

// ---------- one run's part ----------

describe("attemptOf", () => {
  it("recorded: its story", () => {
    const s = story("1");
    expect(attemptOf(run([s]), "1")).toEqual({ kind: "recorded", story: s });
  });
  it("being built now: the live figures", () => {
    const r = run([], { status: "running", squares: [sq("2", "running")], live: { currentStory: "2", agentMinutes: 7, calls: 30, outputTokens: 900 } });
    expect(attemptOf(r, "2")).toEqual({ kind: "building", agentMinutes: 7, calls: 30, outputTokens: 900 });
  });
  it("being built, by its square alone (dbench between stories): live figures missing, not 0", () => {
    const r = run([], { status: "running", squares: [sq("2", "running")], live: {} });
    expect(attemptOf(r, "2")).toEqual({ kind: "building", agentMinutes: null, calls: null, outputTokens: null });
  });
  it("built by its square, no record yet", () => {
    expect(attemptOf(run([], { squares: [sq("2", "part", 3, 4)] }), "2")).toEqual({ kind: "unrecorded" });
  });
  it("not built: queued, running an earlier story, ended early, or not in scope, each with why", () => {
    expect(attemptOf(run([], { status: "queued", squares: [sq("2", "unbuilt")] }), "2")).toEqual({ kind: "notBuilt", why: "The run is queued: no story is built yet." });
    const early = run([], { status: "running", squares: [sq("1", "running"), sq("2", "unbuilt")], live: { runningStory: "1", currentStory: "1" } });
    expect(attemptOf(early, "2")).toMatchObject({ kind: "notBuilt", why: expect.stringContaining("at story 1") });
    expect(attemptOf(run([], { status: "cancelled", squares: [sq("2", "unbuilt")] }), "2")).toMatchObject({ kind: "notBuilt", why: expect.stringContaining("cancelled") });
    expect(attemptOf(run([], { squares: [sq("1", "ok")] }), "2")).toMatchObject({ kind: "notBuilt", why: expect.stringContaining("Not in this run's scope") });
  });
});

// ---------- per combination: medians and ranges ----------

describe("combinationSummary", () => {
  it("no finished run: no summary on any measure, even with running runs that recorded it", () => {
    const s = combinationSummary([run([story("1")], { status: "running" }), run([], { status: "queued" })], "1");
    for (const k of SUMMARY_KEYS) expect(s[k]).toEqual({ spread: null, median: null });
  });
  it("one finished run: its own value, no range, n=1", () => {
    const s = combinationSummary([run([story("1", { usage: mins(12) })])], "1");
    expect(s.minutes.spread).toEqual({ median: 12, min: 12, max: 12, n: 1 });
    expect(s.minutes.median).toEqual({ median: 12, n: 1 });
  });
  it("several: median (the middle two averaged for an even count), range and n; running runs left out", () => {
    const rs = [10, 14, 20, 30].map((m) => run([story("1", { usage: mins(m) })]));
    const s = combinationSummary([...rs, run([story("1", { usage: mins(99) })], { status: "running" })], "1");
    expect(s.minutes.spread).toEqual({ median: 17, min: 10, max: 30, n: 4 });
  });
  it("a missing value is left out of that measure only", () => {
    const rs = [run([story("1", { usage: mins(10, { calls: null }) })]), run([story("1", { usage: mins(20, { calls: 40 }) })])];
    const s = combinationSummary(rs, "1");
    expect(s.minutes.spread?.n).toBe(2);
    expect(s.calls.spread).toEqual({ median: 40, min: 40, max: 40, n: 1 });
  });
  it("no usage at all: time, tokens and calls missing; held-out still counts", () => {
    const s = combinationSummary([run([story("1", { usage: null, own: [1, 2] })])], "1");
    expect(s.minutes.spread).toBeNull();
    expect(s.heldOut.spread).toEqual({ median: 0.5, min: 0.5, max: 0.5, n: 1 });
  });
  it("zero is counted, not dropped", () => {
    const s = combinationSummary([run([story("1", { own: [0, 5] })]), run([story("1", { own: [5, 5] })]), run([story("1", { own: [0, 5] })])], "1");
    expect(s.heldOut.spread).toEqual({ median: 0, min: 0, max: 1, n: 3 });
  });
  it("finished runs that didn't record the story are left out", () => {
    const s = combinationSummary([run([story("1", { usage: mins(10) })]), run([story("2")])], "1");
    expect(s.minutes.spread?.n).toBe(1);
  });
  it("the median is the combination page's median for the same story, on every measure", () => {
    const rs = [run([story("1", { usage: mins(10, { calls: 5, outTokens: 1 }), own: [1, 2] })]), run([story("1", { usage: mins(13, { calls: 9, outTokens: 3 }), own: [2, 2] })]),
      run([story("1", { usage: mins(40, { calls: 1, outTokens: 7 }) })], { status: "running" })];
    const s = combinationSummary(rs, "1");
    for (const k of SUMMARY_KEYS) expect(s[k].median).toEqual(storyMedians(rs, ["1"], k).get("1"));
  });
});

// ---------- the divergence rule ----------

describe("divergence against the combination's median", () => {
  /** Finished runs of story 1 at these minutes; returns each run's minutes flag. */
  const flags = (minutes: number[], extra: Row[] = []) => {
    const rs = minutes.map((m, i) => run([story("1", { usage: mins(m) })], { runId: `r${i + 1}` }));
    const g = storyPage([...rs, ...extra], "1").groups[0];
    return Object.fromEntries(g.entries.map((e) => [e.run.runId, e.divergence.minutes]));
  };
  it("exactly 10% above the median is not flagged; just over is", () => {
    // Median of 100, 100, 110 is 100: 110 is exactly +10%.
    expect(flags([100, 100, 110]).r3).toBeNull();
    expect(flags([100, 100, 110.1]).r3).toMatchObject({ direction: "above" });
  });
  it("exactly 10% below is not flagged; just under is", () => {
    expect(flags([100, 100, 90]).r3).toBeNull();
    expect(flags([100, 100, 89.9]).r3).toMatchObject({ direction: "below" });
  });
  it(`fewer than ${MIN_RUNS_FOR_MEDIAN} finished runs: nothing to differ from`, () => {
    expect(flags([10])).toEqual({ r1: null });
  });
  it("a running run is flagged against the finished runs' median, and isn't in it", () => {
    const running = run([story("1", { usage: mins(50) })], { status: "running", runId: "live" });
    expect(flags([10, 10], [running]).live).toMatchObject({ direction: "above" });
  });
  it("a median of 0: any other value is infinitely above; 0 is not flagged", () => {
    const rs = [0, 0, 1].map((p, i) => run([story("1", { own: [p, 1] })], { runId: `r${i + 1}` }));
    const e = storyPage(rs, "1").groups[0].entries;
    expect(e.map((x) => x.divergence.heldOut?.by ?? null)).toEqual([null, null, Infinity]);
  });
  it("a missing value is never flagged", () => {
    const rs = [run([story("1", { usage: mins(10) })]), run([story("1", { usage: mins(10) })]), run([story("1", { usage: null })])];
    expect(storyPage(rs, "1").groups[0].entries.map((e) => e.divergence.minutes)).toEqual([null, null, null]);
  });
  it("a flagged story run carries its mechanism; an unflagged one none", () => {
    const e = storyPage([10, 10, 30].map((m) => run([story("1", { usage: mins(m) })])), "1").groups[0].entries;
    expect(e[2].mechanism?.label).toBeTruthy();
    expect(e[0].mechanism).toBeNull();
  });
  it(`the threshold is the combination page's (${DIVERGENCE * 100}%)`, () => expect(DIVERGENCE).toBe(0.1));
});

// ---------- groups and order ----------

describe("storyPage: groups, entries and scale", () => {
  const A = { stack: "a", label: "Alpha" }, B = { stack: "b", label: "Beta" };
  it("one group per combination, with its machines once each", () => {
    const rs = [run([story("1")], { ...A, machine: "m1" }), run([story("1")], { ...A, machine: "m2" }), run([story("1")], { ...A, machine: "m1" }), run([story("1")], B)];
    const v = storyPage(rs, "1");
    expect(v.groups.map((g) => [g.stack, g.label, g.machines.map((m) => m.machine)])).toEqual([["a", "Alpha", ["m1", "m2"]], ["b", "Beta", ["m1"]]]);
  });
  it("runs that built the story are entries, in run order; the rest are listed as not built, with why", () => {
    const rs = [
      run([], { ...A, runId: "q", status: "queued", squares: [sq("1", "unbuilt")] }),
      run([story("1")], { ...A, runId: "v2-r10" }),
      run([story("1")], { ...A, runId: "v2-r2" }),
      run([], { ...A, runId: "b", status: "running", squares: [sq("1", "running")], live: { currentStory: "1" } }),
    ];
    const g = storyPage(rs, "1").groups[0];
    expect(g.entries.map((e) => [e.run.runId, e.attempt.kind])).toEqual([["v2-r2", "recorded"], ["v2-r10", "recorded"], ["b", "building"]]);
    expect(g.notBuilt.map((n) => [n.run.runId, n.why])).toEqual([["q", "The run is queued: no story is built yet."]]);
  });
  it("counts the finished runs that recorded it", () => {
    const rs = [run([story("1")], A), run([story("1")], { ...A, status: "running" }), run([story("2")], A)];
    expect(storyPage(rs, "1").groups[0].finishedRecorded).toBe(1);
  });
  it("an entry's latest-build result is its square", () => {
    const g = storyPage([run([story("1")], { squares: [sq("1", "part", 4, 6)] })], "1").groups[0];
    expect(g.entries[0].latest).toEqual(sq("1", "part", 4, 6));
  });
  it("one time scale: the longest wall among the story runs; never 0", () => {
    const rs = [run([story("1", { usage: mins(10) })]), run([story("1", { usage: mins(25) })], B)];
    expect(storyPage(rs, "1").scaleSeconds).toBe(25 * MINUTE);
    expect(storyPage([run([story("1", { usage: null })])], "1").scaleSeconds).toBe(1);
    expect(storyPage([], "1")).toEqual({ groups: [], scaleSeconds: 1, storyRuns: 0, notBuilt: 0 });
  });
  it("counts story runs shown and runs not built", () => {
    const v = storyPage([run([story("1")], A), run([], { ...B, status: "queued", squares: [sq("1", "unbuilt")] })], "1");
    expect([v.storyRuns, v.notBuilt]).toEqual([1, 1]);
  });
});

describe("compareGroups: the order of combinations", () => {
  const g = (label: string, finishedRecorded: number, entries: number, heldOut: number | null, minutes: number | null): Group => ({
    stack: label, label, pack: "p", machines: [], finishedRecorded, notBuilt: [],
    entries: Array.from({ length: entries }) as Group["entries"],
    summary: {
      heldOut: { spread: heldOut === null ? null : { median: heldOut, min: heldOut, max: heldOut, n: 1 }, median: null },
      minutes: { spread: minutes === null ? null : { median: minutes, min: minutes, max: minutes, n: 1 }, median: null },
      outTokens: { spread: null, median: null }, calls: { spread: null, median: null },
    },
  });
  const order = (gs: Group[]) => gs.toSorted(compareGroups).map((x) => x.label);
  it("measured before only running, before not built", () => {
    expect(order([g("none", 0, 0, null, null), g("live", 0, 1, null, null), g("done", 1, 1, 0.5, 10)])).toEqual(["done", "live", "none"]);
  });
  it("the best held-out median first: quality before cost", () => {
    expect(order([g("fast", 1, 1, 0.8, 5), g("good", 1, 1, 1, 50)])).toEqual(["good", "fast"]);
  });
  it("equal held-out: the shorter agent time first", () => {
    expect(order([g("slow", 1, 1, 1, 50), g("quick", 1, 1, 1, 5)])).toEqual(["quick", "slow"]);
  });
  it("a missing median sorts after any number", () => {
    expect(order([g("unknown", 1, 1, null, 5), g("zero", 1, 1, 0, 5)])).toEqual(["zero", "unknown"]);
    expect(order([g("untimed", 1, 1, 1, null), g("timed", 1, 1, 1, 90)])).toEqual(["timed", "untimed"]);
  });
  it("otherwise by label", () => {
    expect(order([g("b", 0, 0, null, null), g("a", 0, 0, null, null)])).toEqual(["a", "b"]);
  });
});

// ---------- the comparison ----------

describe("compare parameter", () => {
  it("round-trips a combination id with slashes", () => {
    const p = compareParam("qwen/3.8/27b/ubuntu/x/llamacpp-pi", "v2-r5");
    expect(p).toBe("qwen/3.8/27b/ubuntu/x/llamacpp-pi|v2-r5");
    expect(parseCompare(p)).toEqual({ stack: "qwen/3.8/27b/ubuntu/x/llamacpp-pi", runId: "v2-r5" });
  });
  it("none or malformed: null", () => {
    for (const p of [undefined, "", "no-separator", "|run", "stack|"]) expect(parseCompare(p)).toBeNull();
  });
});

describe("comparisonOf", () => {
  const A = { stack: "a", label: "Alpha" };
  const rs = [
    run([story("1")], { ...A, runId: "done" }),
    run([], { ...A, runId: "live", status: "running", squares: [sq("1", "running")], live: { currentStory: "1" } }),
    run([], { ...A, runId: "waiting", status: "queued", squares: [sq("1", "unbuilt")] }),
  ];
  const v = storyPage(rs, "1");
  it("none chosen", () => expect(comparisonOf(v, undefined, "1")).toEqual({ kind: "none" }));
  it("a recorded story run", () => {
    const c = comparisonOf(v, compareParam("a", "done"), "1");
    expect(c.kind === "ok" && c.entry.run.runId).toBe("done");
  });
  it("one being built: unusable, and why", () => expect(comparisonOf(v, compareParam("a", "live"), "1")).toEqual({ kind: "unusable", why: "live of Alpha hasn't recorded story 1 yet, so there is nothing to compare with." }));
  it("one not built", () => expect(comparisonOf(v, compareParam("a", "waiting"), "1")).toEqual({ kind: "unusable", why: "waiting of Alpha hasn't built story 1, so there is nothing to compare with." }));
  it("a run that doesn't exist here", () => expect(comparisonOf(v, compareParam("zz", "r1"), "1")).toEqual({ kind: "unusable", why: "No run r1 of zz in this pack version." }));
  it("a malformed parameter", () => expect(comparisonOf(v, "junk", "1")).toMatchObject({ kind: "unusable", why: expect.stringContaining("doesn't name a run") }));
});

describe("relativeTo: percentages of the comparison", () => {
  it("a percentage of the comparison's, rounded", () => {
    expect(relativeTo(12, 10)).toEqual({ kind: "percent", percent: 120 });
    expect(relativeTo(1, 3)).toEqual({ kind: "percent", percent: 33 });
    expect(relativeTo(10, 10)).toEqual({ kind: "percent", percent: 100 });
  });
  it("a zero value is 0%", () => expect(relativeTo(0, 10)).toEqual({ kind: "percent", percent: 0 }));
  it("a zero base: the run's own number, and why", () => {
    expect(relativeTo(5, 0)).toMatchObject({ kind: "own", value: 5, why: expect.stringContaining("is 0") });
    expect(relativeTo(0, 0)).toMatchObject({ kind: "own", value: 0 });
  });
  it("a missing base: the run's own number, and why", () => expect(relativeTo(5, null)).toMatchObject({ kind: "own", value: 5, why: expect.stringContaining("no figure") }));
  it("a missing value: missing, whatever the base", () => {
    expect(relativeTo(null, 10)).toEqual({ kind: "missing" });
    expect(relativeTo(null, null)).toEqual({ kind: "missing" });
  });
});

// ---------- the time-bar segments: one definition ----------

describe("time-bar segments", () => {
  it("the combination page's run split sums the same parts, in the same order, as every bar draws", () => {
    expect([...SPLIT_PARTS]).toEqual(SEGMENTS.map((s) => s.seg));
  });
  it("every segment is named and explained by the glossary", () => {
    for (const s of SEGMENTS) expect(GLOSSARY[s.term].name && GLOSSARY[s.term].what).toBeTruthy();
  });
});

// ---------- the story across combinations, for the story-run page ----------
// MECE by what a row can be: several combinations; only this one; only unfinished runs; a measure
// nobody recorded; then the order, this run's own figures and marking, the one scale, and what is left out.

describe("acrossCombinations", () => {
  const A = { stack: "a/stack", label: "A" }, B = { stack: "b/stack", label: "B" }, C = { stack: "c/stack", label: "C" };
  const mine = run([story("2", { usage: mins(30, { outTokens: 90000, calls: 300 }), own: [9, 10] })], { ...A, runId: "v2-r1" });
  const stacks = (v: ReturnType<typeof acrossCombinations>) => v.rows.map((r) => r.stack);

  it("several combinations: one row each, with the story page's own medians and ranges", () => {
    const rows = [
      mine, run([story("2", { usage: mins(10), own: [10, 10] })], { ...A, runId: "v2-r2" }),
      run([story("2", { usage: mins(40), own: [5, 10] })], { ...B, runId: "v2-r1" }),
      run([story("2", { usage: mins(60), own: [7, 10] })], { ...B, runId: "v2-r2" }),
    ];
    const v = acrossCombinations(mine, rows, "2");
    expect(stacks(v)).toEqual(["a/stack", "b/stack"]);
    const page = storyPage(rows, "2");
    for (const r of v.rows) expect(r.summary).toEqual(page.groups.find((g) => g.stack === r.stack)!.summary);
    const b = v.rows[1];
    expect(b.state).toBe("measured");
    expect(b.n).toBe(2);
    expect(b.summary.minutes.spread).toEqual({ median: 50, min: 40, max: 60, n: 2 });
    expect(b.summary.heldOut.spread).toEqual({ median: 0.6, min: 0.5, max: 0.7, n: 2 });
    expect(v.withoutRecord).toBe(0);
  });

  it("only this combination: its one row, marked", () => {
    const v = acrossCombinations(mine, [mine], "2");
    expect(v.rows.map((r) => [r.stack, r.isThis, r.state, r.n])).toEqual([["a/stack", true, "measured", 1]]);
  });

  it("this run's combination is the only one marked", () => {
    const v = acrossCombinations(mine, [mine, run([story("2")], B), run([story("2")], C)], "2");
    expect(v.rows.filter((r) => r.isThis).map((r) => r.stack)).toEqual(["a/stack"]);
  });



  it("a combination whose only run is still running, with the story recorded: kept, no median (medians are over finished runs), the run counted as running", () => {
    const rows = [mine, run([story("2", { usage: mins(20) })], { ...B, status: "running" })];
    const b = acrossCombinations(mine, rows, "2").rows.find((r) => r.stack === "b/stack")!;
    expect([b.state, b.n]).toEqual(["unfinished", 0]);
    expect(b.unfinished).toEqual([{ status: "running", count: 1 }]);
    expect(b.summary.minutes.spread).toBeNull();
    expect(acrossNoMedian(b, "2", "agent time")).toBe("No finished run yet: story 2 is recorded only by runs that haven't finished (1 running), and the median is over finished runs, as on the story page.");
  });

  it("unfinished runs that recorded the story are counted by status beside the finished ones, and stay out of the median", () => {
    const rows = [mine, run([story("2", { usage: mins(20) })], B), run([story("2", { usage: mins(90) })], { ...B, status: "running" }), run([story("2", { usage: mins(90) })], { ...B, status: "failed" })];
    const b = acrossCombinations(mine, rows, "2").rows.find((r) => r.stack === "b/stack")!;
    expect([b.state, b.n]).toEqual(["measured", 1]);
    expect(b.unfinished).toEqual([{ status: "running", count: 1 }, { status: "failed", count: 1 }]);
    expect(b.summary.minutes.spread?.median).toBe(20);
  });

  it("a running run counts only where the story is recorded: a combination only building or queued for it is left out, and counted", () => {
    const rows = [
      mine,
      run([story("1")], { ...B, status: "running", squares: [sq("1", "ok", 6, 6), sq("2", "running")], live: { runningStory: "2" } }),
      run([], { ...C, status: "queued", squares: [sq("1", "unbuilt"), sq("2", "unbuilt")] }),
    ];
    const v = acrossCombinations(mine, rows, "2");
    expect(stacks(v)).toEqual(["a/stack"]);
    expect(v.withoutRecord).toBe(2);
  });

  it("a measure no finished run recorded is missing, never 0, while the others stand", () => {
    const rows = [mine, run([story("2", { usage: null, own: [9, 10] })], B)];
    const b = acrossCombinations(mine, rows, "2").rows.find((r) => r.stack === "b/stack")!;
    expect(b.state).toBe("measured");
    expect(b.summary.heldOut.spread).toEqual({ median: 0.9, min: 0.9, max: 0.9, n: 1 });
    expect(b.summary.minutes.spread).toBeNull();
    expect(b.summary.outTokens.spread).toBeNull();
    expect(acrossNoMedian(b, "2", "agent time")).toBe("No finished run of this combination recorded its agent time for story 2.");
  });

  it("a zero is a value, not a missing one", () => {
    const rows = [mine, run([story("2", { usage: mins(5, { calls: 0 }), own: [0, 10] })], B)];
    const b = acrossCombinations(mine, rows, "2").rows.find((r) => r.stack === "b/stack")!;
    expect(b.summary.calls.spread?.median).toBe(0);
    expect(b.summary.heldOut.spread?.median).toBe(0);
  });

  it("the story page's order: best median held-out first, then the shortest time; unfinished after", () => {
    const rows = [
      mine,                                                                             // A: 90%, 30 min
      run([story("2", { usage: mins(50), own: [10, 10] })], B),                         // B: 100%
      run([story("2", { usage: mins(10), own: [9, 10] })], C),                          // C: 90%, 10 min
      run([story("2")], { stack: "d/stack", label: "D", status: "running" }),            // D: unfinished
    ];
    const v = acrossCombinations(mine, rows, "2");
    expect(stacks(v)).toEqual(["b/stack", "c/stack", "a/stack", "d/stack"]);
    expect(stacks(v)).toEqual(storyPage(rows, "2").groups.map((g) => g.stack));
  });

  it("this story run's own figures, on the same measures", () => {
    const v = acrossCombinations(mine, [mine, run([story("2")], B)], "2");
    expect(v.mine).toEqual({ minutes: 30, outTokens: 90000, calls: 300, heldOut: 0.9 });
    expect(v.story).toBe(mine.stories[0]);
  });

  it("this story run's missing figures are null, never 0", () => {
    const bare = run([story("2", { usage: null, own: [null, null] })], { ...A, runId: "v2-r9" });
    expect(acrossCombinations(bare, [bare], "2").mine).toEqual({ minutes: null, outTokens: null, calls: null, heldOut: null });
  });


  it("a story run not recorded yet: no figures of its own; its combination is listed all the same", () => {
    const building = run([story("1")], { ...A, runId: "v2-r4", status: "running", squares: [sq("1", "ok", 6, 6), sq("2", "running")], live: { runningStory: "2" } });
    const v = acrossCombinations(building, [building, run([story("2")], B)], "2");
    expect(v.mine).toBeNull();
    expect(v.story).toBeNull();
    expect(v.rows.map((r) => [r.stack, r.isThis, r.state])).toEqual([["b/stack", false, "measured"], ["a/stack", true, "notRecorded"]]);
    expect(v.withoutRecord).toBe(0);
    expect(acrossNoMedian(v.rows[1], "2", "agent time")).toBe("No run of this combination has recorded story 2 yet.");
  });

  it("one scale for every bar: the longest of the ranges and this story run's own time", () => {
    const others = [run([story("2", { usage: mins(20) })], B), run([story("2", { usage: mins(80) })], B)];
    expect(acrossCombinations(mine, [mine, ...others], "2").scaleMinutes).toBe(80);
    const slow = run([story("2", { usage: mins(120) })], { ...A, runId: "v2-r5" });
    expect(acrossCombinations(slow, [slow, ...others], "2").scaleMinutes).toBe(120);
    const untimed = run([story("2", { usage: null })], A);
    expect(acrossCombinations(untimed, [untimed], "2").scaleMinutes).toBe(1);
  });

  it("only runs of the same pack and version family count", () => {
    const rows = [mine, run([story("2")], { ...B, family: "p-v1" }), run([story("2")], { ...C, pack: "q" })];
    const v = acrossCombinations(mine, rows, "2");
    expect(stacks(v)).toEqual(["a/stack"]);
    expect(v.withoutRecord).toBe(0);
  });

  it("story ids are compared as numbers", () => {
    expect(acrossCombinations(mine, [mine], "02").rows[0].n).toBe(1);
  });
});
