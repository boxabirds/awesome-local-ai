import { describe, expect, it } from "vitest";
import {
  buildMatrix, buildingStory, cellOf, classifyMechanism, DIVERGENCE, divergence, HUNG_COMMAND_SECONDS, HUNG_TOOL_SHARE, heldOutState,
  MANY_CALLS_RATIO, MECHANISM_PRECEDENCE, metricValue, MIN_RUNS_FOR_MEDIAN, NEAR_RATIO, runOrder, runSplit, runTotal, SHARE_RATIO,
  SLOWER_DECODE_RATIO, siblings, storyIds, storyMedians, tally, THINKING_RATIO, TIME_SHARE, MECHANISM_TERM, modelOf,
} from "./combinationView.ts";
import { GLOSSARY } from "./glossary.ts";
import { INDISTINGUISHABLE_TESTS, SMALL_N } from "./stats.ts";
import type { ConversationProfile, Row, RunStatus, Story, TimeSplit, Usage } from "./types.ts";

// ---------- builders: an ordinary story run, and a run of them ----------

/** Ordinary numbers for one story: 10 minutes, 100 calls at 100 chars of thinking each, nothing unusual. */
const WALL = 600;
const CALLS = 100;
const THINK_PER_CALL = 100;
const LARGEST = 4000;
const DECODE = 100;

function split(o: Partial<TimeSplit> = {}): TimeSplit {
  const wall = o.wall ?? WALL;
  return { wall, prefill: 60, decode: 400, tools: 100, compaction: 20, other: 20, modelUnsplit: 0, betweenSessions: 0, check: { status: "ok", problems: [] }, ...o };
}
function usage(o: Partial<Usage> = {}): Usage {
  return {
    outTokens: 50000, inTokens: 1e5, cacheRead: 1e6, readTokens: 1.1e6, calls: CALLS, agentSeconds: WALL, tokS: 50000 / WALL,
    decodeTokens: 50000, decodeSeconds: 400, decodeTokS: DECODE, prefillTokens: 1e4, prefillSeconds: 60, prefillTokS: 200,
    draftAcceptance: null, compactions: 1, nudges: 0, split: split(), ...o,
  };
}
function profile(o: Partial<ConversationProfile> = {}): ConversationProfile {
  const calls = o.calls ?? CALLS;
  return {
    calls, toolCalls: calls - 1, thinkingChars: calls * THINK_PER_CALL, textChars: 2000, toolArgChars: 50000, thinkingMedian: THINK_PER_CALL,
    thinkingMedianBefore: THINK_PER_CALL, thinkingMedianAfter: THINK_PER_CALL, largestThinking: { chars: LARGEST, call: 10, atS: 100 },
    contextStart: 9000, contextEnd: 60000, largestContextJump: { tokens: 4000, call: 20 }, toolsByName: { bash: 50 }, toolErrors: 0,
    longestTool: { seconds: 40, name: "bash", gist: "npx playwright test" }, signals: [], ...o,
  };
}
function story(id: string, o: { usage?: Usage | null; conversation?: ConversationProfile | null; own?: [number | null, number | null] } = {}): Story {
  const [ownPassed, ownTotal] = o.own ?? [10, 10];
  return { id, title: `Story ${id}`, status: "DONE", passed: null, total: null, ownPassed, ownTotal, usage: o.usage === undefined ? usage() : o.usage, conversation: o.conversation === undefined ? profile() : o.conversation };
}
let seq = 0;
function run(stories: Story[], o: { status?: RunStatus; runId?: string; scope?: string[]; current?: string | null; running?: string | null; tokS?: number | null; invalid?: boolean } = {}): Row {
  const status = o.status ?? "finished";
  return {
    pack: "p", stack: "s", runId: o.runId ?? `r${++seq}`, status, suite: "v2", scores: {}, stories,
    storiesWorking: { working: 0, scope: 0, squares: (o.scope ?? stories.map((s) => s.id)).map((id) => ({ id, state: "unbuilt", passed: null, total: null })) },
    live: status === "running" || status === "queued" ? { status, currentStory: o.current ?? null, runningStory: o.running ?? null } : null,
    usage: { tokS: o.tokS ?? null },
    invalid: o.invalid ? { reason: "read the reference build in story 7", since: "2026-09-30" } : null, interventions: [],
  } as unknown as Row;
}
/** Three ordinary siblings of story 1. */
const others = () => [story("1"), story("1"), story("1")];

// ---------- metrics: one story run's value ----------

describe("metricValue", () => {
  const s = story("1");
  it("each metric reads its own figure", () => {
    expect(metricValue(s, "minutes").value).toBe(WALL / 60);
    expect(metricValue(s, "outTokens").value).toBe(50000);
    expect(metricValue(s, "calls").value).toBe(CALLS);
    expect(metricValue(s, "tokS").value).toBeCloseTo(50000 / WALL, 6);
    expect(metricValue(s, "heldOut").value).toBe(1);
  });
  it("held-out is its own tests' pass share; some and none", () => {
    expect(metricValue(story("1", { own: [7, 14] }), "heldOut").value).toBe(0.5);
    expect(metricValue(story("1", { own: [0, 14] }), "heldOut").value).toBe(0);
  });
  it("a real zero stays zero", () => {
    expect(metricValue(story("1", { usage: usage({ calls: 0 }) }), "calls")).toEqual({ value: 0, missing: null });
  });
  it("missing: null with a reason, never 0", () => {
    expect(metricValue(story("1", { usage: null }), "minutes")).toEqual({ value: null, missing: "no usage recorded for this story yet" });
    expect(metricValue(story("1", { usage: usage({ calls: null }) }), "calls").missing).toMatch(/weren't recorded/);
    expect(metricValue(story("1", { usage: usage({ outTokens: null }) }), "outTokens").value).toBeNull();
    expect(metricValue(story("1", { usage: usage({ agentSeconds: null }) }), "minutes").value).toBeNull();
    expect(metricValue(story("1", { usage: usage({ tokS: null }) }), "tokS").value).toBeNull();
    expect(metricValue(story("1", { own: [null, null] }), "heldOut").missing).toMatch(/weren't recorded/);
    expect(metricValue(story("1", { own: [0, 0] }), "heldOut").value).toBeNull();   // no tests: no share
  });
  it("held-out needs no usage", () => expect(metricValue(story("1", { usage: null, own: [9, 10] }), "heldOut").value).toBe(0.9));
});

// ---------- story cells ----------

describe("cellOf: a story run's cell", () => {
  it("recorded: its value and held-out colour", () => {
    const c = cellOf(run([story("1", { own: [5, 10] })]), "1", "minutes");
    expect(c).toMatchObject({ state: "recorded", value: 10, missing: null, heldOut: "part" });
  });
  it("recorded without numbers (dbench reports it done before the record): '—' with why, and its held-out", () => {
    const c = cellOf(run([story("2", { usage: null, conversation: null, own: [9, 10] })], { status: "running" }), "2", "minutes");
    expect(c).toMatchObject({ state: "recorded", value: null, heldOut: "part" });
    expect(c.missing).toMatch(/no usage recorded/);
  });
  it("in progress: the story the running run is on now (current, or finishing)", () => {
    expect(cellOf(run([], { status: "running", current: "3" }), "3", "minutes")).toMatchObject({ state: "building", heldOut: "running", value: null });
    expect(cellOf(run([], { status: "running", running: "03" }), "3", "minutes").state).toBe("building");
  });
  it("absent: not built, an empty cell", () => {
    expect(cellOf(run([story("1")]), "2", "minutes")).toMatchObject({ state: "absent", heldOut: "unbuilt", value: null });
    expect(cellOf(run([], { status: "queued" }), "1", "minutes").state).toBe("absent");  // a queued run builds nothing
  });
  it("story ids match whatever their padding", () => expect(cellOf(run([story("01")]), "1", "minutes").state).toBe("recorded"));
  it("held-out states: all, some, none, not measured", () => {
    expect(heldOutState(story("1", { own: [10, 10] }), false)).toBe("ok");
    expect(heldOutState(story("1", { own: [3, 10] }), false)).toBe("part");
    expect(heldOutState(story("1", { own: [0, 10] }), false)).toBe("bad");
    expect(heldOutState(story("1", { own: [null, null] }), false)).toBe("none");
    expect(heldOutState(null, false)).toBe("unbuilt");
    expect(heldOutState(null, true)).toBe("running");
  });
  it("buildingStory: only a running run with a story", () => {
    expect(buildingStory(run([], { status: "running", current: "4" }))).toBe("4");
    expect(buildingStory(run([], { status: "running" }))).toBeNull();
    expect(buildingStory(run([], { status: "queued", current: "4" }))).toBeNull();
  });
});

describe("rows and columns", () => {
  it("runs: finished, then running, then queued, then the rest; by run id in natural order within", () => {
    const rs = [run([], { status: "queued", runId: "v2-r2" }), run([], { status: "cancelled", runId: "v2-r0" }), run([], { status: "running", runId: "v2-r1" }),
                run([], { runId: "v2-r10" }), run([], { runId: "v2-r9" })];
    expect(runOrder(rs).map((r) => r.runId)).toEqual(["v2-r9", "v2-r10", "v2-r1", "v2-r2", "v2-r0"]);
  });
  it("stories: every story in any run's scope or record, in story order", () => {
    expect(storyIds([run([story("2")], { scope: ["1", "2", "10"] }), run([story("3")], { scope: [] })])).toEqual(["1", "2", "3", "10"]);
  });
});

// ---------- medians ----------

describe("storyMedians: over finished runs only", () => {
  const mins = (secs: number) => story("1", { usage: usage({ agentSeconds: secs }) });
  it("odd and even n", () => {
    expect(storyMedians([run([mins(600)]), run([mins(1200)]), run([mins(6000)])], ["1"], "minutes").get("1")).toEqual({ median: 20, n: 3 });
    expect(storyMedians([run([mins(600)]), run([mins(1200)])], ["1"], "minutes").get("1")).toEqual({ median: 15, n: 2 });
  });
  it("running runs and runs without the value don't count; none left: null", () => {
    const m = storyMedians([run([mins(600)]), run([mins(6000)], { status: "running" }), run([story("1", { usage: null })])], ["1", "2"], "minutes");
    expect(m.get("1")).toEqual({ median: 10, n: 1 });
    expect(m.get("2")).toBeNull();
  });
});

// ---------- divergence ----------

describe("divergence: the 10% rule", () => {
  const m = (median: number, n = 3) => ({ median, n });
  it("under 10%: none, above or below", () => {
    expect(divergence(109, m(100))).toBeNull();
    expect(divergence(91, m(100))).toBeNull();
  });
  it("exactly 10%: none (the rule is more than 10%)", () => {
    expect(divergence(100 * (1 + DIVERGENCE), m(100))).toBeNull();
    expect(divergence(100 * (1 - DIVERGENCE), m(100))).toBeNull();
  });
  it("over 10%: flagged, above or below, with by how much", () => {
    expect(divergence(111, m(100))).toEqual({ direction: "above", by: expect.closeTo(0.11, 6) });
    expect(divergence(89, m(100))).toEqual({ direction: "below", by: expect.closeTo(-0.11, 6) });
  });
  it("a median of 0: 0 is not a difference; anything above it is, without end", () => {
    expect(divergence(0, m(0))).toBeNull();
    expect(divergence(3, m(0))).toEqual({ direction: "above", by: Infinity });
  });
  it(`fewer than ${MIN_RUNS_FOR_MEDIAN} runs behind the median, or no value: nothing to differ from`, () => {
    expect(divergence(500, m(100, MIN_RUNS_FOR_MEDIAN - 1))).toBeNull();
    expect(divergence(null, m(100))).toBeNull();
    expect(divergence(500, null)).toBeNull();
  });
});

// ---------- mechanism rules ----------

describe("mechanism: each rule on its own", () => {
  it("an ordinary story run: unexplained, with the reason", () => {
    const r = classifyMechanism(story("1"), others());
    expect(r.label).toBe("unexplained");
    expect(r.fired).toEqual([]);
    expect(r.evidence).toMatch(/None of the rules fired/);
  });

  // The rules look only for what makes a story run cost more. One that thought a tenth as much fires none of them,
  // and must not be told its thinking was near the others' (gufo v2-r2 story 2: 21k chars of thinking against 359k).
  it("far below the others on every count: unexplained, without claiming it was near them", () => {
    const r = classifyMechanism(story("1", { conversation: profile({ calls: CALLS / 2, thinkingChars: CALLS * THINK_PER_CALL / 10 }) }), others());
    expect(r.label).toBe("unexplained");
    expect(r.evidence).not.toMatch(/near/);
    expect(r.evidence).toBe("None of the rules fired: no hung command or restart, and not at least 2× the thinking, 1.5× the model calls, a compaction-heavy story or slower generation, against the other runs.");
  });

  it(`verbose thinking by thinking per call: at ${THINKING_RATIO}× the others' median, not just below`, () => {
    const at = classifyMechanism(story("1", { conversation: profile({ thinkingChars: CALLS * THINK_PER_CALL * THINKING_RATIO }) }), others());
    expect(at.label).toBe("verbose thinking");
    expect(at.evidence).toContain("thinking per call 200 chars against 100 (2.0×)");
    const under = classifyMechanism(story("1", { conversation: profile({ thinkingChars: CALLS * THINK_PER_CALL * THINKING_RATIO - CALLS }) }), others());
    expect(under.label).toBe("unexplained");
  });
  it("verbose thinking by thinking after the largest block, against the others' after", () => {
    expect(classifyMechanism(story("1", { conversation: profile({ thinkingMedianAfter: THINK_PER_CALL * THINKING_RATIO }) }), others()).evidence)
      .toContain("after its largest block, 200 chars per call against 100");
    expect(classifyMechanism(story("1", { conversation: profile({ thinkingMedianAfter: THINK_PER_CALL * THINKING_RATIO - 1 }) }), others()).label).toBe("unexplained");
  });
  it("verbose thinking by the largest block, against the others' largest, never an absolute size", () => {
    const big = (chars: number) => profile({ largestThinking: { chars, call: 5, atS: 60 } });
    expect(classifyMechanism(story("1", { conversation: big(LARGEST * THINKING_RATIO) }), others()).label).toBe("verbose thinking");
    expect(classifyMechanism(story("1", { conversation: big(LARGEST * THINKING_RATIO - 1) }), others()).label).toBe("unexplained");
    // 60k chars is ordinary where every run thinks in 60k blocks (as mlx-serve does), whatever the harness's own signal says.
    const bigOthers = [0, 1, 2].map(() => story("1", { conversation: big(60000) }));
    expect(classifyMechanism(story("1", { conversation: { ...big(64000), signals: ["long-thinking-block"] } }), bigOthers).label).toBe("unexplained");
  });

  it(`many small steps: calls at ${MANY_CALLS_RATIO}× the median with thinking per call within ${NEAR_RATIO}× of it`, () => {
    const steps = (calls: number, perCall = THINK_PER_CALL) => story("1", { conversation: profile({ calls, thinkingChars: calls * perCall }) });
    const r = classifyMechanism(steps(CALLS * MANY_CALLS_RATIO), others());
    expect(r.label).toBe("many small steps");
    expect(r.evidence).toContain("150 model calls against 100 (1.5×)");
    expect(classifyMechanism(steps(CALLS * MANY_CALLS_RATIO - 1), others()).label).toBe("unexplained");
    // Thinking per call just inside and just outside the band, either way.
    expect(classifyMechanism(steps(200, THINK_PER_CALL * NEAR_RATIO), others()).label).toBe("many small steps");
    expect(classifyMechanism(steps(200, THINK_PER_CALL / NEAR_RATIO), others()).label).toBe("many small steps");
    expect(classifyMechanism(steps(200, THINK_PER_CALL / NEAR_RATIO - 1), others()).label).toBe("unexplained");
  });

  it(`hung command: one call of ${HUNG_COMMAND_SECONDS} s or more, anywhere`, () => {
    const hung = (seconds: number, wall = 100000) => story("1", { usage: usage({ agentSeconds: wall, split: split({ wall }) }), conversation: profile({ longestTool: { seconds, name: "bash", gist: "npm run dev" } }) });
    const r = classifyMechanism(hung(HUNG_COMMAND_SECONDS), others());
    expect(r.label).toBe("hung command");
    expect(r.evidence).toBe("one bash call ran 600 s (1% of the story): npm run dev");
    expect(classifyMechanism(hung(HUNG_COMMAND_SECONDS - 1), others()).label).not.toBe("hung command");
  });
  it(`hung command: or one call taking ${HUNG_TOOL_SHARE * 100}% of the story`, () => {
    const call = (seconds: number) => story("1", { conversation: profile({ longestTool: { seconds, name: "bash", gist: "npm test" } }) });
    expect(classifyMechanism(call(WALL * HUNG_TOOL_SHARE), others()).label).toBe("hung command");
    expect(classifyMechanism(call(WALL * HUNG_TOOL_SHARE - 1), others()).label).toBe("unexplained");
  });

  it(`compaction-heavy: at least ${TIME_SHARE * 100}% of the story and ${SHARE_RATIO}× the others' share`, () => {
    const comp = (seconds: number) => story("1", { usage: usage({ compactions: 4, split: split({ compaction: seconds }) }) });
    const r = classifyMechanism(comp(WALL * TIME_SHARE), others());      // 20% against the others' 3%
    expect(r.label).toBe("compaction-heavy");
    expect(r.evidence).toBe("20% of the story compacting (4 compactions), against 3% in the other runs");
    expect(classifyMechanism(comp(WALL * TIME_SHARE - 1), others()).label).toBe("unexplained");
    // 20% is ordinary where the others compact as much.
    const heavy = [0, 1, 2].map(() => comp(WALL * TIME_SHARE * 0.6));
    expect(classifyMechanism(comp(WALL * TIME_SHARE), heavy).label).toBe("unexplained");
  });
  it("restarted: time between sessions, against the others' median of 0", () => {
    const r = classifyMechanism(story("1", { usage: usage({ split: split({ betweenSessions: WALL * TIME_SHARE }) }) }), others());
    expect(r.label).toBe("restarted");
    expect(r.evidence).toBe("20% of the story between agent sessions, against 0% in the other runs");
    expect(classifyMechanism(story("1", { usage: usage({ split: split({ betweenSessions: WALL * TIME_SHARE - 1 }) }) }), others()).label).toBe("unexplained");
  });
  it(`slower generation: decode at ${SLOWER_DECODE_RATIO * 100}% of the others' or below`, () => {
    const r = classifyMechanism(story("1", { usage: usage({ decodeTokS: DECODE * SLOWER_DECODE_RATIO }) }), others());
    expect(r.label).toBe("slower generation");
    expect(r.evidence).toBe("decode 75.0 tok/s against 100.0 (75%)");
    expect(classifyMechanism(story("1", { usage: usage({ decodeTokS: DECODE * SLOWER_DECODE_RATIO + 1 }) }), others()).label).toBe("unexplained");
  });
});

describe("mechanism: overlapping signals and which wins", () => {
  it("the precedence is documented and complete", () => {
    expect(MECHANISM_PRECEDENCE).toEqual(["hung command", "restarted", "verbose thinking", "many small steps", "compaction-heavy", "slower generation"]);
  });
  it("verbose thinking over its consequences (compaction, slower generation); every rule that fired is listed", () => {
    const s = story("1", {
      usage: usage({ decodeTokS: 40, split: split({ compaction: WALL * TIME_SHARE }) }),
      conversation: profile({ thinkingChars: CALLS * THINK_PER_CALL * 5 }),
    });
    const r = classifyMechanism(s, others());
    expect(r.label).toBe("verbose thinking");
    expect(r.fired.map((f) => f.label)).toEqual(["verbose thinking", "compaction-heavy", "slower generation"]);
  });
  it("a hung command wins over everything; a restart over thinking", () => {
    const s = story("1", {
      usage: usage({ split: split({ betweenSessions: WALL * TIME_SHARE }) }),
      conversation: profile({ thinkingChars: CALLS * THINK_PER_CALL * 5, longestTool: { seconds: HUNG_COMMAND_SECONDS, name: "bash", gist: "x" } }),
    });
    expect(classifyMechanism(s, others()).fired.map((f) => f.label)).toEqual(["hung command", "restarted", "verbose thinking"]);
  });
  it("many steps with much more thinking per call is verbose thinking, not small steps", () => {
    const s = story("1", { conversation: profile({ calls: 200, thinkingChars: 200 * THINK_PER_CALL * 3 }) });
    expect(classifyMechanism(s, others()).fired.map((f) => f.label)).toEqual(["verbose thinking"]);
  });
  it("many small steps over slower generation", () => {
    const s = story("1", { usage: usage({ decodeTokS: 50 }), conversation: profile({ calls: 200, thinkingChars: 200 * THINK_PER_CALL }) });
    expect(classifyMechanism(s, others()).label).toBe("many small steps");
  });
});

describe("mechanism: missing profiles", () => {
  it("no usage and no profile: not recorded", () => {
    expect(classifyMechanism(story("1", { usage: null, conversation: null }), others()).label).toBe("not recorded");
  });
  it("no profile, and nothing in its usage explains it: not recorded", () => {
    const r = classifyMechanism(story("1", { conversation: null }), others());
    expect(r.label).toBe("not recorded");
    expect(r.evidence).toMatch(/No conversation profile/);
  });
  it("no profile, but its usage explains it: the usage rule still fires", () => {
    expect(classifyMechanism(story("1", { conversation: null, usage: usage({ decodeTokS: 50 }) }), others()).label).toBe("slower generation");
  });
  it("a profile, but no other run has one: unexplained, and says so", () => {
    const r = classifyMechanism(story("1", { conversation: profile({ thinkingChars: 1e6 }) }), [story("1", { conversation: null })]);
    expect(r.label).toBe("unexplained");
    expect(r.evidence).toMatch(/No other run of this story has a conversation profile/);
  });
  it("no siblings at all: only what needs none (a hung command) can fire", () => {
    expect(classifyMechanism(story("1", { conversation: profile({ longestTool: { seconds: HUNG_COMMAND_SECONDS, name: "bash", gist: "x" } }) }), []).label).toBe("hung command");
    expect(classifyMechanism(story("1", { usage: usage({ decodeTokS: 1 }) }), []).label).toBe("unexplained");
  });
});

// ---------- the matrix ----------

describe("buildMatrix", () => {
  const mins = (secs: number, conv?: Partial<ConversationProfile>) => story("1", { usage: usage({ agentSeconds: secs, split: split({ wall: secs }) }), conversation: profile(conv) });
  const runs = [
    run([mins(600)], { runId: "a" }), run([mins(620)], { runId: "b" }), run([mins(3000, { thinkingChars: CALLS * THINK_PER_CALL * 10 })], { runId: "c" }),
    run([mins(9000)], { runId: "d", status: "running", current: "2", scope: ["1", "2", "3"] }), run([], { runId: "e", status: "queued" }),
  ];
  const m = buildMatrix(runs, "minutes");
  const at = (runId: string, id: string) => m.rows.find((r) => r.run.runId === runId)!.cells.find((c) => c.storyId === id)!;
  it("one row per run in order, one column per story", () => {
    expect(m.rows.map((r) => r.run.runId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(m.stories).toEqual(["1", "2", "3"]);
  });
  it("medians over finished runs; a flagged cell carries its mechanism, others none", () => {
    expect(m.medians.get("1")).toEqual({ median: 620 / 60, n: 3 });
    expect(at("a", "1").divergence).toBeNull();
    expect(at("a", "1").mechanism).toBeNull();
    expect(at("c", "1").divergence?.direction).toBe("above");
    expect(at("c", "1").mechanism?.label).toBe("verbose thinking");
    expect(at("d", "1").divergence?.direction).toBe("above");     // a running run's cell is compared with the finished median too
  });
  it("building and absent cells are never flagged", () => {
    expect(at("d", "2")).toMatchObject({ state: "building", divergence: null, mechanism: null });
    expect(at("e", "1")).toMatchObject({ state: "absent", divergence: null, mechanism: null });
  });
  it("the tally: mechanisms of flagged story runs out of every story run with a value", () => {
    expect(tally(m)).toEqual({ lines: [{ label: "verbose thinking", count: 1 }, { label: "unexplained", count: 1 }], flagged: 2, storyRuns: 4 });
  });
  it("the tally of a matrix with nothing flagged is empty", () => expect(tally(buildMatrix([run([mins(600)])], "minutes"))).toEqual({ lines: [], flagged: 0, storyRuns: 1 }));
});

describe("runTotal: a run's own figure on the metric", () => {
  const r = run([story("1", { own: [10, 10] }), story("2", { own: [5, 10], usage: usage({ calls: 50 }) }), story("3", { usage: null, own: [null, null] })], { tokS: 42 });
  it("sums minutes, tokens and calls over the stories that have them", () => {
    expect(runTotal(r, "minutes")).toBe(20);
    expect(runTotal(r, "outTokens")).toBe(100000);
    expect(runTotal(r, "calls")).toBe(150);
  });
  it("held-out: how many stories pass all their tests", () => expect(runTotal(r, "heldOut")).toBe(1));
  it("tok/s: the run's own rate", () => expect(runTotal(r, "tokS")).toBe(42));
  it("nothing recorded: null", () => {
    expect(runTotal(run([]), "minutes")).toBeNull();
    expect(runTotal(run([]), "heldOut")).toBeNull();
  });
});

describe("runSplit: where a run's time went", () => {
  it("sums every part over the stories with a split, and counts those without", () => {
    const s = runSplit(run([story("1"), story("2", { usage: usage({ split: split({ wall: 1200, tools: 700 }) }) }), story("3", { usage: null })]))!;
    expect(s.wall).toBe(1800);
    expect(s.parts.tools).toBe(800);
    expect(s.parts.decode).toBe(800);
    expect(s).toMatchObject({ stories: 2, withoutSplit: 1, problems: [], unchecked: 0 });
  });
  it("collects accounting problems with their story, and counts unchecked splits", () => {
    const s = runSplit(run([
      story("1", { usage: usage({ split: split({ check: { status: "problems", problems: ["tool call t9 never ended"] } }) }) }),
      story("2", { usage: usage({ split: split({ check: { status: "unchecked", problems: [] } }) }) }),
    ]))!;
    expect(s.problems).toEqual(["story 1: tool call t9 never ended"]);
    expect(s.unchecked).toBe(1);
  });
  it("no story with a split: null", () => expect(runSplit(run([story("1", { usage: null })]))).toBeNull());
});

describe("names", () => {
  it("the model: all but os, hardware and engine; a reference stack is its own", () => {
    expect(modelOf("qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi")).toBe("qwen/3.8/flash-next");
    expect(modelOf("qwen/3.8/flash-next/macos/128GB/mlxserve-pi")).toBe("qwen/3.8/flash-next");
    expect(modelOf("qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi")).not.toBe(modelOf("qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi"));
    expect(modelOf("reference/opus-5.5")).toBe("reference/opus-5.5");
  });
  it("every mechanism has a glossary entry named for it", () => {
    for (const [label, id] of Object.entries(MECHANISM_TERM)) expect(GLOSSARY[id].name).toBe(label);
  });
  it("the glossary states the same thresholds the rules use", () => {
    expect(GLOSSARY.mechVerboseThinking.what).toContain(`${THINKING_RATIO}×`);
    expect(GLOSSARY.mechManySmallSteps.what).toContain(`${MANY_CALLS_RATIO}× the other runs' model calls`);
    expect(GLOSSARY.mechManySmallSteps.what).toContain(`within ${NEAR_RATIO}×`);
    expect(GLOSSARY.mechHungCommand.what).toContain(`${HUNG_COMMAND_SECONDS} s`);
    expect(GLOSSARY.mechHungCommand.what).toContain(`${HUNG_TOOL_SHARE * 100}%`);
    for (const t of [GLOSSARY.mechCompactionHeavy, GLOSSARY.mechRestarted]) expect(t.what).toContain(`${TIME_SHARE * 100}% or more`), expect(t.what).toContain(`${SHARE_RATIO}×`);
    expect(GLOSSARY.mechSlowerGeneration.what).toContain(`${SLOWER_DECODE_RATIO * 100}%`);
    expect(GLOSSARY.smallN.what).toContain(`${SMALL_N} runs or fewer`);
    expect(GLOSSARY.smallN.what).toContain(`${INDISTINGUISHABLE_TESTS} held-out tests`);
    expect(GLOSSARY.divergence.what).toContain(`${DIVERGENCE * 100}%`);
  });
});

// ---------- invalid runs: in the matrix, struck through, but in no figure ----------

describe("an invalid run in the matrix", () => {
  const mins = (secs: number, conv?: Partial<ConversationProfile>) => story("1", { usage: usage({ agentSeconds: secs, split: split({ wall: secs }) }), conversation: profile(conv) });
  const runs = [
    run([mins(600)], { runId: "a" }), run([mins(660)], { runId: "b" }), run([mins(630)], { runId: "c" }),
    run([mins(6000, { thinkingChars: CALLS * THINK_PER_CALL * 10 })], { runId: "bad", invalid: true }),
  ];
  const m = buildMatrix(runs, "minutes");
  const at = (runId: string) => m.rows.find((r) => r.run.runId === runId)!.cells[0];

  it("is not in the story's median (n counts valid finished runs only)", () => {
    expect(storyMedians(runs, ["1"], "minutes").get("1")).toEqual({ median: 630 / 60, n: 3 });
    expect(m.medians.get("1")).toEqual({ median: 630 / 60, n: 3 });
  });
  it("its only run left out, a story has no median", () => {
    expect(storyMedians([run([mins(600)], { invalid: true })], ["1"], "minutes").get("1")).toBeNull();
  });
  it("still has its row and its value, in run order", () => {
    expect(m.rows.map((r) => r.run.runId)).toEqual(["a", "b", "bad", "c"]);
    expect(at("bad")).toMatchObject({ state: "recorded", value: 100 });
  });
  it("is never flagged, however far from the median, and has no mechanism", () => {
    expect(at("bad")).toMatchObject({ divergence: null, mechanism: null });
  });
  it("is not a sibling a valid run's mechanism is judged against", () => {
    expect(siblings(runs, runs[0], "1").length).toBe(2);
    // Two valid runs think 100 chars a call, two invalid ones 1000. A slow run thinking 300 a call is verbose against
    // the valid ones (3×); against all four (median 550) it would not be.
    const think = (perCall: number) => ({ thinkingChars: CALLS * perCall });
    const set = [
      run([mins(600, think(100))], { runId: "a" }), run([mins(600, think(100))], { runId: "b" }),
      run([mins(600, think(1000))], { runId: "x", invalid: true }), run([mins(600, think(1000))], { runId: "y", invalid: true }),
      run([mins(3000, think(300))], { runId: "slow" }),
    ];
    const slow = buildMatrix(set, "minutes").rows.find((r) => r.run.runId === "slow")!.cells[0];
    expect(slow.mechanism?.label).toBe("verbose thinking");
    const unmarked = buildMatrix(set.map((r) => ({ ...r, invalid: null })), "minutes").rows.find((r) => r.run.runId === "slow")!.cells[0];
    expect(unmarked.mechanism?.fired.map((f) => f.label) ?? []).not.toContain("verbose thinking");
  });
  it("is not in the tally: neither flagged nor counted as a story run", () => {
    expect(tally(m)).toEqual({ lines: [], flagged: 0, storyRuns: 3 });
  });
  it("the same run unmarked would be flagged and counted (the control)", () => {
    const plain = buildMatrix(runs.map((r) => ({ ...r, invalid: null })), "minutes");
    expect(plain.rows.find((r) => r.run.runId === "bad")!.cells[0].divergence?.direction).toBe("above");
    expect(tally(plain).storyRuns).toBe(4);
  });
});
