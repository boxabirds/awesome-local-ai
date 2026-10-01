import { describe, expect, it } from "vitest";
import {
  acrossVerdicts, qualityVerdict, speedText, speedVerdict, timesText, attemptOf, combinationSummary, compareGroups, compareParam, comparisonOf, heldOutTests, parseCompare, relativeTo, sameStory,
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
// Two questions, answered per combination: is this story run higher or lower quality, and faster or slower? MECE by
// the verdict rules (quality: same within one of this story's tests; speed: the 10% band, then N× with one decimal
// under 10), then what a row can be (this combination; another; none to compare with; a figure missing), and order.

describe("verdicts: quality, in tests of this story", () => {
  it("same when the difference is at most one test of the story; better or worse beyond", () => {
    // 7 tests: one test is 14.3 points.
    expect(qualityVerdict(6 / 7, 5 / 7, 7)).toBe("same");
    expect(qualityVerdict(5 / 7, 6 / 7, 7)).toBe("same");
    expect(qualityVerdict(6 / 7, 4 / 7, 7)).toBe("better");
    expect(qualityVerdict(4 / 7, 6 / 7, 7)).toBe("worse");
    // A median between two runs: 1.5 tests apart is more than one.
    expect(qualityVerdict(1, 8.5 / 10, 10)).toBe("better");
    expect(qualityVerdict(1, 9 / 10, 10)).toBe("same");
  });
  it("no verdict without both figures or the story's test count", () => {
    expect(qualityVerdict(null, 0.5, 7)).toBeNull();
    expect(qualityVerdict(0.5, null, 7)).toBeNull();
    expect(qualityVerdict(0.5, 0.5, null)).toBeNull();
  });
});

describe("verdicts: speed, against the 10% band", () => {
  it("within 10% either way, exactly 10% included: same", () => {
    expect(speedVerdict(10, 11)).toEqual({ kind: "same" });
    expect(speedVerdict(11, 10)).toEqual({ kind: "same" });
    expect(speedVerdict(10, 10)).toEqual({ kind: "same" });
  });
  it("beyond it: how many times faster or slower, the median over this run's or this run's over the median", () => {
    expect(speedVerdict(16, 39)).toEqual({ kind: "faster", times: 39 / 16 });
    expect(speedVerdict(80, 17)).toEqual({ kind: "slower", times: 80 / 17 });
  });
  it("one decimal under 10, a whole number from 10", () => {
    expect(timesText(39 / 16)).toBe("2.4×");
    expect(timesText(1.12)).toBe("1.1×");
    expect(timesText(9.96)).toBe("10×");
    expect(timesText(28.8)).toBe("29×");
  });
  it("in words: the verdict, bold in the page; the numbers after it", () => {
    expect(speedText({ kind: "faster", times: 39 / 16 })).toBe("2.4× faster");
    expect(speedText({ kind: "slower", times: 80 / 17 })).toBe("4.7× slower");
    expect(speedText({ kind: "same" })).toBe("same");
  });
  it("no verdict without both times, or with a time of 0", () => {
    expect(speedVerdict(null, 10)).toBeNull();
    expect(speedVerdict(10, null)).toBeNull();
    expect(speedVerdict(0, 10)).toBeNull();
  });
});

describe("acrossVerdicts", () => {
  const A = { stack: "a/stack", label: "A" }, B = { stack: "b/stack", label: "B" }, C = { stack: "c/stack", label: "C" };
  // This run: 6 of 7 tests in 16 minutes.
  const mine = run([story("2", { usage: mins(16, { outTokens: 90000, calls: 300 }), own: [6, 7] })], { ...A, runId: "v2-r1" });
  const other = (o: RunOpts, m: number | null, own: [number, number]) => run([story("2", { usage: m === null ? null : mins(m), own })], o);
  const stacks = (v: ReturnType<typeof acrossVerdicts>) => v.rows.map((r) => r.stack);

  it("this combination first: this run against its combination's other finished runs, never itself", () => {
    const rows = [mine, other({ ...A, runId: "v2-r2" }, 39, [5, 7]), other({ ...A, runId: "v2-r3" }, 39, [5, 7]), other(B, 10, [7, 7])];
    const v = acrossVerdicts(mine, rows, "2");
    expect(stacks(v)).toEqual(["a/stack", "b/stack"]);
    const me = v.rows[0];
    expect(me).toMatchObject({ isThis: true, n: 2 });
    expect(me.quality).toMatchObject({ mine: 6 / 7, median: 5 / 7, verdict: "same" });
    expect(me.speed).toMatchObject({ mine: 16, median: 39, verdict: { kind: "faster", times: 39 / 16 } });
  });
  it("another combination: its median over its finished runs, with this run's figures", () => {
    const rows = [mine, other(B, 40, [3, 7]), other(B, 60, [4, 7]), other(B, 20, [5, 7])];
    const b = acrossVerdicts(mine, rows, "2").rows.find((r) => r.stack === "b/stack")!;
    expect(b).toMatchObject({ isThis: false, n: 3 });
    expect(b.quality).toMatchObject({ median: 4 / 7, verdict: "better" });
    expect(b.quality.spread).toMatchObject({ min: 3 / 7, max: 5 / 7 });
    expect(b.speed).toMatchObject({ median: 40, verdict: { kind: "faster", times: 2.5 } });
    expect(b.speed.spread).toMatchObject({ min: 20, max: 60 });
  });
  it("this combination with no other finished run of the story: no row of its own", () => {
    const v = acrossVerdicts(mine, [mine, other({ ...A, runId: "v2-r2", status: "running" }, 39, [5, 7]), other(B, 10, [7, 7])], "2");
    expect(stacks(v)).toEqual(["b/stack"]);
  });
  it("a combination with no finished run of the story is not listed; running runs count for nothing", () => {
    const rows = [mine, other({ ...B, status: "running" }, 10, [7, 7]), run([story("1")], C)];
    expect(acrossVerdicts(mine, rows, "2").rows).toEqual([]);
    const v = acrossVerdicts(mine, [mine, other(B, 10, [7, 7]), other({ ...B, status: "running" }, 90, [0, 7])], "2");
    expect(v.rows[0]).toMatchObject({ n: 1, quality: { median: 1 }, speed: { median: 10 } });
  });
  it("ordered by quality, best median first, this combination first whatever its quality; ties by speed, fastest first", () => {
    const rows = [
      mine, other({ ...A, runId: "v2-r2" }, 30, [1, 7]),
      other(B, 50, [6, 7]), other(C, 10, [6, 7]), other({ stack: "d/stack", label: "D" }, 5, [7, 7]),
    ];
    expect(stacks(acrossVerdicts(mine, rows, "2"))).toEqual(["a/stack", "d/stack", "c/stack", "b/stack"]);
  });
  it("a figure missing on either side: no verdict, the figure null (the page shows '—'), never 0", () => {
    const untimed = run([story("2", { usage: null, own: [6, 7] })], { ...A, runId: "v2-r9" });
    const b = acrossVerdicts(untimed, [untimed, other(B, 10, [6, 7])], "2").rows[0];
    expect(b.speed).toMatchObject({ mine: null, median: 10, verdict: null });
    expect(b.quality.verdict).toBe("same");
    const noTime = acrossVerdicts(mine, [mine, other(B, null, [6, 7])], "2").rows[0];
    expect(noTime.speed).toMatchObject({ median: null, verdict: null });
  });
  it("this story run not recorded: its figures null, every verdict null; the combinations are still listed", () => {
    const building = run([story("1")], { ...A, runId: "v2-r4", status: "running", squares: [sq("1", "ok", 6, 6), sq("2", "running")], live: { runningStory: "2" } });
    const v = acrossVerdicts(building, [building, other(B, 10, [6, 7])], "2");
    expect(v.story).toBeNull();
    expect(v.rows[0]).toMatchObject({ quality: { mine: null, verdict: null }, speed: { mine: null, verdict: null } });
  });
  it("output tokens and tool calls per combination, for the detail: medians with ranges", () => {
    const rows = [mine, run([story("2", { usage: mins(10, { outTokens: 1000, calls: 10 }) })], B), run([story("2", { usage: mins(10, { outTokens: 3000, calls: 30 }) })], B)];
    const b = acrossVerdicts(mine, rows, "2").rows[0];
    expect(b.outTokens).toMatchObject({ median: 2000, min: 1000, max: 3000, n: 2 });
    expect(b.calls).toMatchObject({ median: 20, min: 10, max: 30, n: 2 });
    expect(acrossVerdicts(mine, rows, "2").mine).toEqual({ minutes: 16, outTokens: 90000, calls: 300, heldOut: 6 / 7 });
  });
  it("only runs of the same pack and version family count; story ids compare as numbers", () => {
    const rows = [mine, other({ ...B, family: "p-v1" }, 10, [7, 7]), other({ ...C, pack: "q" }, 10, [7, 7])];
    expect(acrossVerdicts(mine, rows, "2").rows).toEqual([]);
    expect(acrossVerdicts(mine, [mine, other(B, 10, [7, 7])], "02").rows).toHaveLength(1);
  });
});

// ---------- a story run marked not comparable ----------
describe("a story run marked not comparable: the story page and the verdicts are worked out without it", () => {
  const REASON = "This story run also built stories 3 and 4.";
  const odd = (m: number, own: [number, number] = [10, 10]): Story => ({ ...story("2", { usage: mins(m), own }), notComparable: REASON });
  const plain = (m: number, own: [number, number] = [10, 10]) => story("2", { usage: mins(m), own });
  const A = { stack: "a/stack", label: "A" }, B = { stack: "b/stack", label: "B" };

  it("combinationSummary: the median, range and n are over the other finished runs", () => {
    const s = combinationSummary([run([plain(10)]), run([plain(20)]), run([odd(500)])], "2");
    expect(s.minutes.spread).toEqual({ median: 15, min: 10, max: 20, n: 2 });
    expect(s.heldOut.spread).toMatchObject({ n: 2 });
  });
  it("storyPage: it is not an entry, not counted among the finished runs that recorded the story, and not listed as not built", () => {
    const rs = [run([plain(10)], { ...A, runId: "r1" }), run([odd(500)], { ...A, runId: "r2" }), run([plain(20)], { ...A, runId: "r3" })];
    const v = storyPage(rs, "2");
    const g = v.groups[0];
    expect(g.entries.map((e) => e.run.runId)).toEqual(["r1", "r3"]);
    expect(g.notBuilt).toEqual([]);
    expect(g.finishedRecorded).toBe(2);
    expect([v.storyRuns, v.notBuilt]).toEqual([2, 0]);
    expect(v.scaleSeconds).toBe(20 * MINUTE);                       // the one scale is over the story runs shown
  });
  it("storyPage: a combination whose only run of the story is not comparable has no entry and no median", () => {
    const g = storyPage([run([odd(500)], A)], "2").groups[0];
    expect([g.entries.length, g.finishedRecorded, g.summary.minutes.spread]).toEqual([0, 0, null]);
  });
  it("acrossVerdicts: a combination's median and n leave it out, in this run's combination and in another", () => {
    const mine = run([plain(16)], { ...A, runId: "v2-r1" });
    const rows = [mine, run([plain(40)], { ...A, runId: "v2-r2" }), run([odd(900)], { ...A, runId: "v2-r3" }), run([plain(10)], B), run([odd(900)], B)];
    const v = acrossVerdicts(mine, rows, "2");
    expect(v.rows.map((r) => [r.stack, r.n, r.speed.median])).toEqual([["a/stack", 1, 40], ["b/stack", 1, 10]]);
  });
  it("acrossVerdicts: a combination left with no comparable finished run of the story is not listed", () => {
    const mine = run([plain(16)], { ...A, runId: "v2-r1" });
    expect(acrossVerdicts(mine, [mine, run([odd(900)], B)], "2").rows).toEqual([]);
  });
  it("acrossVerdicts: this story run not comparable itself gets no verdict against anyone", () => {
    const mine = run([odd(900, [1, 10])], { ...A, runId: "v2-r1" });
    const v = acrossVerdicts(mine, [mine, run([plain(40)], { ...A, runId: "v2-r2" }), run([plain(10)], B)], "2");
    expect(v.rows.length).toBe(2);
    for (const r of v.rows) expect([r.quality.verdict, r.speed.verdict]).toEqual([null, null]);
  });
});
