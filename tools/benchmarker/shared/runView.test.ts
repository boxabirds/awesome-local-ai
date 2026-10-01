// The run and story-run pages' rules, organised by dimension: the run's state, the story's state, data present
// or absent, held-out, jobs, and comparisons. Each dimension's cases are exhaustive for the values it can take.
import { describe, expect, it } from "vitest";
import type { ConversationProfile, Intervention, Live, Row, RunStatus, Score, Story, StorySquare, TimeSplit, Usage } from "./types.ts";
import {
  AGAINST_MEASURES, COMPARE_MEASURES, DIFF_THRESHOLD, SEGMENTS, STATUS_ICON, againstCombination, agentTime, compareRuns,
  conversationView, divergence, heldOutAgreement, isOver, jobsView, liveProgress, median, neighbours, otherRuns, relDiff,
  runTimeBars, runTotals, scopeIds, scoreOfRecord, segmentTip, signedPercent, splitParts, squareTip, statusView,
  storyRunState, storyTitle, toolKinds, whyMissing, whyRunMissing,
  groupInterventions, interventionsOf, interventionTip, invalidTip, MAX_TIP_INTERVENTIONS,
  againstFlagTip, typicalRun, whatDiffered, BELOW_CAVEAT, HELD_OUT_CAVEAT,
} from "./runView.ts";
import { classifyMechanism } from "./combinationView.ts";
import { GLOSSARY } from "./glossary.ts";

const SUITE = "vidi-v2.0-pre1";
const OLD_SUITE = "vidi-v1.1";

const split = (over: Partial<TimeSplit> = {}): TimeSplit => ({
  wall: 600, prefill: 60, decode: 400, tools: 100, compaction: 20, other: 20, modelUnsplit: 0, betweenSessions: 0,
  check: { status: "ok", problems: [] }, ...over,
});

const usage = (over: Partial<Usage> = {}): Usage => ({
  outTokens: 1000, inTokens: 100, cacheRead: 900, readTokens: 1000, calls: 10, agentSeconds: 600, tokS: 1.7,
  decodeTokens: 900, decodeSeconds: 400, decodeTokS: 2.25, prefillTokens: 100, prefillSeconds: 60, prefillTokS: 1.7,
  draftAcceptance: null, compactions: 1, nudges: 0, split: split(), ...over,
});

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id, title: `Story ${id}`, status: "DONE", passed: 5, total: 10, ownPassed: 5, ownTotal: 5, usage: usage(), conversation: null, ...over,
});

const live = (over: Partial<Live> = {}): Live => ({
  jobId: "job", status: "running", attempt: 1, currentStory: null, runningStory: null, agentMinutes: null, calls: null,
  outputTokens: null, tasksWritten: null, tasksTotal: null, lastActivity: null, storyStartedAt: null, storyTitle: null,
  storiesInScope: null, runStartedAt: null, totalAgentMinutes: null, logTail: [], queue: null, ...over,
});

const squares = (states: StorySquare["state"][]): StorySquare[] =>
  states.map((state, i) => ({ id: String(i + 1), state, passed: state === "ok" ? 5 : null, total: state === "ok" ? 5 : null }));

const score = (passed: number | null, total: number | null, at = "2026-09-30T18:30:00Z"): Score => ({ passed, total, flaky: 0, at });

const row = (over: Partial<Row> = {}): Row => ({
  pack: "vidi", stack: "qwen/x/pi", runId: "r1", dir: "d", node: "n", host: "h", machine: "m", label: "x pi",
  packVersion: SUITE, family: "vidi-v2", suite: SUITE, state: "finished", stateAt: "2026-09-30T15:28:00Z", status: "finished",
  storiesWorking: { working: 0, scope: 3, squares: squares(["ok", "ok", "unbuilt"]) },
  usage: { outTokens: 2000, inTokens: 200, readTokens: 2000, calls: 20, tokS: 1.7, decodeTokS: 2.25, prefillTokS: 1.7 },
  statusNote: "", stories: [story("1"), story("2")], rescores: [], scores: {}, hasBundle: false,
  stages: { build: "finished", score: "", judge: "" }, live: null, jobs: [], invalid: null, interventions: [], ...over,
});

const ALL_STATUSES: RunStatus[] = ["running", "queued", "finished", "failed", "stopped", "cancelled", "unknown"];

// ---------------------------------------------------------------------------------------------------------------
describe("run state", () => {
  describe("status: one icon per status, and what else is known", () => {
    it("every status has its own icon", () => {
      const icons = ALL_STATUSES.map((s) => STATUS_ICON[s]);
      expect(new Set(icons).size).toBe(ALL_STATUSES.length);
      expect(STATUS_ICON).toMatchObject({ finished: "✓", running: "▶", queued: "⏸", failed: "✕", cancelled: "⊘" });
    });

    it("running: the server's note, no queue place, no end time", () => {
      const v = statusView(row({ status: "running", statusNote: "finishing story 3", stateAt: "" }));
      expect(v).toEqual({ status: "running", icon: "▶", note: "finishing story 3", queuePosition: null, endedAt: null });
    });

    it("queued: its place on the machine's queue", () => {
      const v = statusView(row({ status: "queued", live: live({ status: "queued", queue: { position: 2, ahead: ["a"] } }) }));
      expect(v.queuePosition).toBe(2);
      expect(v.endedAt).toBeNull();
    });

    it("queued with no queue known: no place rather than a made-up one", () => {
      expect(statusView(row({ status: "queued", live: null })).queuePosition).toBeNull();
    });

    it.each(["finished", "failed", "stopped", "cancelled"] as RunStatus[])("%s: when the record says it ended", (status) => {
      expect(statusView(row({ status })).endedAt).toBe("2026-09-30T15:28:00Z");
    });

    it("ended with no time in the record: none", () => {
      expect(statusView(row({ status: "failed", stateAt: "" })).endedAt).toBeNull();
    });

    it("failed: the failure's reason is the note", () => {
      expect(statusView(row({ status: "failed", statusNote: "agent crashed" })).note).toBe("agent crashed");
    });
  });

  describe("score of record", () => {
    it("scored under the current suite", () => {
      expect(scoreOfRecord(row({ scores: { [SUITE]: score(63, 75) } }))).toEqual({
        kind: "scored", passed: 63, total: 75, version: SUITE, at: "2026-09-30T18:30:00Z", flaky: 0, currentSuite: true,
      });
    });

    it("scored only under an older suite: shown, and marked as not the current suite", () => {
      const r = scoreOfRecord(row({ scores: { [OLD_SUITE]: score(50, 60) } }));
      expect(r).toMatchObject({ kind: "scored", version: OLD_SUITE, currentSuite: false });
    });

    it("finished and unscored: says it isn't re-scored under the current suite yet", () => {
      expect(scoreOfRecord(row())).toEqual({ kind: "none", reason: "not-rescored", why: `Finished, but not re-scored under ${SUITE} yet.` });
    });

    it.each(["running", "queued"] as RunStatus[])("%s: not finished, even with a score from an earlier attempt", (status) => {
      const r = scoreOfRecord(row({ status, scores: { [SUITE]: score(63, 75) } }));
      expect(r).toMatchObject({ kind: "none", reason: "not-finished" });
      if (r.kind === "none") expect(r.why).toContain(status);
    });

    it.each([["failed", "failed"], ["stopped", "stopped"], ["cancelled", "was cancelled"], ["unknown", "is in an unknown state"]] as [RunStatus, string][])(
      "%s and unscored: it ended before finishing", (status, words) => {
        const r = scoreOfRecord(row({ status }));
        expect(r).toMatchObject({ kind: "none", reason: "ended-early" });
        if (r.kind === "none") expect(r.why).toContain(words);
      });

    it("a re-score with no result: none, and says so", () => {
      expect(scoreOfRecord(row({ scores: { [SUITE]: score(null, 75) } }))).toMatchObject({ kind: "none", reason: "no-result" });
      expect(scoreOfRecord(row({ scores: { [SUITE]: score(60, null) } }))).toMatchObject({ kind: "none", reason: "no-result" });
    });

    it("zero passing is a score, not a missing one", () => {
      expect(scoreOfRecord(row({ scores: { [SUITE]: score(0, 75) } }))).toMatchObject({ kind: "scored", passed: 0 });
    });
  });

  describe("agent time", () => {
    it("finished: the recorded stories' time summed; no live figure", () => {
      expect(agentTime(row({ stories: [story("1", { usage: usage({ agentSeconds: 660 }) }), story("2", { usage: usage({ agentSeconds: 4811 }) })] })))
        .toEqual({ recordedSeconds: 5471, recordedStories: 2, untimedStories: 0, liveSeconds: null });
    });

    it("running: the live total too, from the job", () => {
      const t = agentTime(row({ status: "running", live: live({ totalAgentMinutes: 28 }) }));
      expect(t.liveSeconds).toBe(28 * 60);
    });

    it("not running: a job's leftover live total isn't shown as live", () => {
      expect(agentTime(row({ status: "finished", live: live({ status: "done", totalAgentMinutes: 28 }) })).liveSeconds).toBeNull();
    });

    it("stories without a time are counted as untimed, not as zero", () => {
      const t = agentTime(row({ stories: [story("1"), story("2", { usage: null })] }));
      expect(t).toMatchObject({ recordedSeconds: 600, recordedStories: 2, untimedStories: 1 });
    });

    it("queued, nothing recorded: no time at all", () => {
      expect(agentTime(row({ status: "queued", stories: [] }))).toEqual({ recordedSeconds: null, recordedStories: 0, untimedStories: 0, liveSeconds: null });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("story state", () => {
  const running = row({
    status: "running", stories: [story("1")],
    storiesWorking: { working: 1, scope: 4, squares: squares(["ok", "running", "unbuilt", "unbuilt"]) },
    live: live({ runningStory: "2", agentMinutes: 4, calls: 41, outputTokens: 12000, storyStartedAt: 100, storyTitle: "Live title" }),
  });

  it("recorded: its record", () => {
    expect(storyRunState(running, "1")).toEqual({ kind: "recorded", story: running.stories[0] });
  });

  it("recorded without usage is still recorded (a story dbench reported first)", () => {
    expect(storyRunState(row({ stories: [story("1", { usage: null })] }), "1").kind).toBe("recorded");
  });

  it("in progress: the live figures", () => {
    expect(storyRunState(running, "2")).toEqual({ kind: "inProgress", agentMinutes: 4, calls: 41, outputTokens: 12000, startedAt: 100 });
  });

  it("in progress, known only from its square (between the agent and the gates)", () => {
    const r = { ...running, live: live({ runningStory: null }) };
    expect(storyRunState(r, "2")).toMatchObject({ kind: "inProgress", agentMinutes: null });
  });

  it("not built, run running: says which story the run is at", () => {
    expect(storyRunState(running, "3")).toEqual({ kind: "notBuilt", why: "Not built yet: the run is at story 2." });
  });

  it("not built, run queued: says the run is queued", () => {
    const r = row({ status: "queued", stories: [], storiesWorking: { working: 0, scope: 2, squares: squares(["unbuilt", "unbuilt"]) } });
    expect(storyRunState(r, "1")).toEqual({ kind: "notBuilt", why: "The run is queued: no story is built yet." });
  });

  it.each([["failed", "failed"], ["cancelled", "was cancelled"], ["stopped", "stopped"]] as [RunStatus, string][])(
    "not built, run %s: it ended before reaching the story", (status, words) => {
      expect(storyRunState(row({ status }), "3")).toEqual({ kind: "notBuilt", why: `Not built: the run ${words} before it reached this story.` });
    });

  it("not built, run finished: finished without recording it", () => {
    expect(storyRunState(row(), "3")).toEqual({ kind: "notBuilt", why: "Not built: the run finished without recording this story." });
  });

  it("a square that says running, in a run that isn't running, is not in progress", () => {
    const r = row({ status: "stopped", storiesWorking: { working: 0, scope: 3, squares: squares(["ok", "ok", "running"]) } });
    expect(storyRunState(r, "3").kind).toBe("notBuilt");
  });

  it("out of scope: a story the run was never going to build", () => {
    expect(storyRunState(row(), "99")).toEqual({ kind: "outOfScope" });
  });

  describe("scope and neighbours", () => {
    it("scope: squares and recorded stories together, in numeric order", () => {
      const r = row({ stories: [story("12")], storiesWorking: { working: 0, scope: 3, squares: [2, 10, 1].map((n) => ({ id: String(n), state: "unbuilt" as const, passed: null, total: null })) } });
      expect(scopeIds(r)).toEqual(["1", "2", "10", "12"]);
    });

    it("first story: no previous", () => expect(neighbours(row(), "1")).toEqual({ prev: null, next: "2" }));
    it("middle story: both", () => expect(neighbours(row(), "2")).toEqual({ prev: "1", next: "3" }));
    it("last story: no next", () => expect(neighbours(row(), "3")).toEqual({ prev: "2", next: null }));
    it("a gap in story numbers is skipped over (no story 6)", () => {
      const r = row({ stories: [], storiesWorking: { working: 0, scope: 3, squares: ["5", "7"].map((id) => ({ id, state: "unbuilt" as const, passed: null, total: null })) } });
      expect(neighbours(r, "5")).toEqual({ prev: null, next: "7" });
    });
    it("out of scope: neither", () => expect(neighbours(row(), "99")).toEqual({ prev: null, next: null }));
  });

  describe("title", () => {
    const other = row({ runId: "r2", stories: [story("3", { title: "From another run" })] });

    it("its own record's", () => expect(storyTitle(row(), [other], "1")).toBe("Story 1"));
    it("the live title while it is built", () => expect(storyTitle(running, [], "2")).toBe("Live title"));
    it("another run of the pack's, when this run hasn't built it", () => expect(storyTitle(row(), [other], "3")).toBe("From another run"));
    it("never another pack's", () => expect(storyTitle(row(), [{ ...other, pack: "todoodle" }], "3")).toBe(""));
    it("none known: empty, not invented", () => expect(storyTitle(row(), [], "3")).toBe(""));
  });

  describe("square hovers", () => {
    it.each([
      ["ok", 5, 5, "story 1: all its held-out tests pass (5/5), against the latest build"],
      ["part", 9, 10, "story 1: some of its held-out tests pass (9/10), against the latest build"],
      ["bad", 0, 10, "story 1: none of its held-out tests pass (0/10), against the latest build"],
      ["unbuilt", null, null, "story 1: not built yet"],
      ["running", null, null, "story 1: being built now"],
    ] as [StorySquare["state"], number | null, number | null, string][])("%s", (state, passed, total, text) => {
      expect(squareTip({ id: "1", state, passed, total })).toBe(text);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("data present or absent", () => {
  describe("time split", () => {
    it("one bar per recorded story, on the scale of the longest", () => {
      const r = row({ stories: [story("1", { usage: usage({ split: split({ wall: 660 }) }) }), story("2", { usage: usage({ split: split({ wall: 4811 }) }) })] });
      const { bars, scaleSeconds } = runTimeBars(r);
      expect(bars.map((b) => b.id)).toEqual(["1", "2"]);
      expect(scaleSeconds).toBe(4811);
    });

    it("a story with usage but no split, or no usage, still has its row, with no split", () => {
      const r = row({ stories: [story("1", { usage: usage({ split: null }) }), story("2", { usage: null })] });
      expect(runTimeBars(r).bars.map((b) => b.split)).toEqual([null, null]);
      expect(runTimeBars(r).scaleSeconds).toBe(1);  // never a zero scale to divide by
    });

    it("no stories: no bars", () => expect(runTimeBars(row({ stories: [] })).bars).toEqual([]));

    it("parts: every segment in TimeBars' order, with its share", () => {
      const { parts, unaccounted } = splitParts(split());
      expect(parts.map((p) => p.seg)).toEqual(["prefill", "decode", "modelUnsplit", "compaction", "tools", "betweenSessions", "other"]);
      expect(parts.find((p) => p.seg === "decode")!.share).toBeCloseTo(400 / 600, 6);
      expect(parts.find((p) => p.seg === "modelUnsplit")!.seconds).toBe(0);
      expect(unaccounted).toBe(0);
    });

    it("parts that don't add up to the wall: what's unaccounted", () => {
      expect(splitParts(split({ wall: 700 })).unaccounted).toBe(100);
      expect(splitParts(split({ wall: 500 })).unaccounted).toBe(-100);
    });

    it("a zero wall: no shares rather than dividing by zero", () => {
      const s = split({ wall: 0, prefill: 0, decode: 0, tools: 0, compaction: 0, other: 0 });
      expect(splitParts(s).parts.every((p) => p.share === null)).toBe(true);
    });

    it("every segment's name comes from the glossary", () => {
      for (const s of SEGMENTS) expect(GLOSSARY[s.term].name).toBeTruthy();
    });

    it("segment hovers explain each part from the story's usage", () => {
      const u = usage({ prefillTokens: 45000, prefillTokS: 750, decodeTokens: 54000, decodeTokS: 101.4, compactions: 2, calls: 95, nudges: 1 });
      expect(segmentTip("prefill", 60, u)).toBe("Prefill 1.0 min: 45k fresh input tokens at 750 tok/s");
      expect(segmentTip("decode", 480, u)).toBe("Generation 8.0 min: 54k tokens at 101 tok/s");
      expect(segmentTip("compaction", 270, u)).toBe("Compaction 4.5 min, over 2 compactions");
      expect(segmentTip("tools", 90, u)).toBe("Tools 1.5 min over 95 calls");
      expect(segmentTip("betweenSessions", 60, u)).toContain("(1 nudges)");
      expect(segmentTip("modelUnsplit", 480, u)).toContain("cloud model");
      expect(segmentTip("other", 6, u)).toBe("Other 0.1 min: the agent's own overhead");
    });

    it("segment hovers with no usage say '?' rather than 0", () => {
      expect(segmentTip("decode", 60, null)).toBe("Generation 1.0 min: ? tokens at ? tok/s");
    });

    it("tools by kind, longest first, zeros left out; none recorded: empty", () => {
      expect(toolKinds(split({ toolsByKind: { bash: 1, unit: 62, e2e: 43, build: 0 } }))).toEqual([
        { kind: "unit", seconds: 62 }, { kind: "e2e", seconds: 43 }, { kind: "bash", seconds: 1 },
      ]);
      expect(toolKinds(split())).toEqual([]);
    });
  });

  describe("cloud model (no time split into reading and writing, no decode speed)", () => {
    const cloud = usage({ decodeTokS: null, prefillTokS: null, split: split({ prefill: 0, decode: 0, tools: 0, compaction: 0, other: 0, modelUnsplit: 600, check: { status: "unchecked", problems: [] } }) });

    it("decode and prefill: missing because the model wasn't timed apart from the agent", () => {
      expect(whyMissing(cloud, "decode")).toContain("cloud model");
      expect(whyMissing(cloud, "prefill")).toContain("cloud model");
    });

    it("a local model that simply wasn't timed on this story says that instead", () => {
      const u = usage({ decodeTokS: null });
      expect(whyMissing(u, "decode")).toBe("Not recorded: the harness didn't time the model's generation for this story.");
      expect(whyMissing(u, "prefill")).toBe("Not recorded: the harness didn't time the model's reading for this story.");
    });

    it("draft acceptance: the engine didn't report drafting", () => expect(whyMissing(usage(), "draft")).toContain("speculative decoding"));
    it("cached share: the record doesn't split input", () => expect(whyMissing(usage(), "cached")).toContain("cached"));
    it("no usage at all: the story isn't recorded with usage, whatever was asked", () => {
      for (const w of ["decode", "prefill", "draft", "story", "cached"] as const) expect(whyMissing(null, w)).toMatch(/^Not recorded: this story's record has no usage/);
    });
    it("usage but a figure missing: not recorded for this story", () => expect(whyMissing(usage(), "story")).toBe("Not recorded for this story."));
  });

  describe("run totals", () => {
    it("tokens and speeds from the server; compactions and nudges summed over the stories", () => {
      const r = row({ stories: [story("1", { usage: usage({ compactions: 1, nudges: 2 }) }), story("2", { usage: usage({ compactions: 2, nudges: 0 }) })] });
      expect(runTotals(r)).toEqual({ outTokens: 2000, readTokens: 2000, calls: 20, tokS: 1.7, decodeTokS: 2.25, prefillTokS: 1.7, compactions: 3, nudges: 2, stories: 2 });
    });

    it("zero compactions is 0, not missing", () => {
      expect(runTotals(row({ stories: [story("1", { usage: usage({ compactions: 0 }) })] })).compactions).toBe(0);
    });

    it("no story recorded a counter: missing, not 0", () => {
      const r = row({ stories: [story("1", { usage: usage({ compactions: null, nudges: null }) })] });
      expect(runTotals(r)).toMatchObject({ compactions: null, nudges: null });
    });

    it("nothing recorded: missing everywhere, over 0 stories", () => {
      const r = row({ stories: [], usage: { outTokens: null, inTokens: null, readTokens: null, calls: null, tokS: null, decodeTokS: null, prefillTokS: null } });
      expect(runTotals(r)).toEqual({ outTokens: null, readTokens: null, calls: null, tokS: null, decodeTokS: null, prefillTokS: null, compactions: null, nudges: null, stories: 0 });
    });

    it("why a run total is missing: queued, nothing recorded, never timed, or not in the records", () => {
      expect(whyRunMissing(row({ status: "queued", stories: [] }), "tokens")).toBe("Nothing recorded yet: the run is queued.");
      expect(whyRunMissing(row({ status: "running", stories: [story("1", { usage: null })] }), "tokens")).toContain("no story of this run has usage");
      expect(whyRunMissing(row(), "model-speed")).toContain("timed the model");
      expect(whyRunMissing(row(), "counter")).toBe("Not in any of this run's story records.");
    });
  });

  describe("conversation profile", () => {
    const profile = (over: Partial<ConversationProfile> = {}): ConversationProfile => ({
      calls: 207, toolCalls: 204, thinkingChars: 328750, textChars: 4889, toolArgChars: 279940, thinkingMedian: 424,
      thinkingMedianBefore: 80, thinkingMedianAfter: 464, largestThinking: { chars: 64543, call: 14, atS: 480 },
      contextStart: 9000, contextEnd: 120000, largestContextJump: { tokens: 16607, call: 15 },
      toolsByName: { read: 21, bash: 115, write: 28, edit: 40 }, toolErrors: 5,
      longestTool: { seconds: 61.7, name: "bash", gist: "npm run test:unit" }, signals: ["long-thinking-block"], ...over,
    });

    it("absent: nothing to show", () => {
      expect(conversationView(null)).toBeNull();
      expect(conversationView(undefined)).toBeNull();
    });

    it("present: the derived figures", () => {
      const v = conversationView(profile())!;
      expect(v.afterRatio).toBeCloseTo(464 / 80, 6);
      expect(v.largest).toEqual({ chars: 64543, call: 14, minutesIn: 8 });
      expect(v.contextGrowth).toBeCloseTo(120000 / 9000, 6);
      expect(v.tools.map((t) => t.name)).toEqual(["bash", "edit", "write", "read"]);
      expect(v.signals).toEqual([]);  // "long-thinking-block" is retired: it meant nothing on its own
    });

    it("ties among tools: by name, so the order is stable", () => {
      expect(conversationView(profile({ toolsByName: { write: 3, bash: 3 } }))!.tools.map((t) => t.name)).toEqual(["bash", "write"]);
    });

    it("a known signal in words; an unknown one as the harness wrote it", () => {
      expect(conversationView(profile({ signals: ["hung-command", "new-thing"] }))!.signals).toEqual(["a command that hung", "new-thing"]);
    });

    it("a retired signal is left out, whatever else is there", () => {
      expect(conversationView(profile({ signals: ["long-thinking-block", "hung-command"] }))!.signals).toEqual(["a command that hung"]);
    });

    it("parts the harness couldn't count: missing, and no ratio made from them", () => {
      const v = conversationView(profile({ thinkingMedianBefore: null, thinkingMedianAfter: null, largestThinking: null, contextStart: null, contextEnd: null, largestContextJump: null, longestTool: null }))!;
      expect(v).toMatchObject({ before: null, after: null, afterRatio: null, largest: null, contextGrowth: null, largestJump: null, longestTool: null });
    });

    it("zero thinking before the largest block: no ratio (no multiple of nothing)", () => {
      expect(conversationView(profile({ thinkingMedianBefore: 0 }))!.afterRatio).toBeNull();
    });

    it("no tools, no signals: empty lists", () => {
      const v = conversationView(profile({ toolsByName: {}, signals: [] }))!;
      expect(v.tools).toEqual([]);
      expect(v.signals).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("held-out: live progress and the score of record", () => {
  it("live progress: the whole suite so far after each story, in story order", () => {
    const r = row({ stories: [story("2", { passed: 20, total: 20 }), story("1", { passed: 6, total: 6 })] });
    expect(liveProgress(r)).toEqual([{ id: "1", passed: 6, total: 6 }, { id: "2", passed: 20, total: 20 }]);
  });

  it("a story without a live figure keeps its place, as missing", () => {
    expect(liveProgress(row({ stories: [story("1", { passed: null, total: null })] }))).toEqual([{ id: "1", passed: null, total: null }]);
  });

  it("agree: the last live figure counts the same tests and matches", () => {
    const r = row({ stories: [story("1", { passed: 63, total: 75 })], scores: { [SUITE]: score(63, 75) } });
    expect(heldOutAgreement(r)).toEqual({ kind: "agree", passed: 63, total: 75 });
  });

  it("differ: the same tests, a different count", () => {
    const r = row({ stories: [story("1", { passed: 60, total: 75 })], scores: { [SUITE]: score(63, 75) } });
    expect(heldOutAgreement(r)).toEqual({ kind: "differ", live: 60, record: 63, total: 75 });
  });

  it("incomparable: the live figure covers fewer tests than the record", () => {
    const r = row({ stories: [story("1", { passed: 20, total: 20 })], scores: { [SUITE]: score(63, 75) } });
    const a = heldOutAgreement(r);
    expect(a.kind).toBe("incomparable");
    if (a.kind === "incomparable") expect(a.why).toBe("Not the same tests: the live figure after story 1 counts 20 tests, the score of record 75.");
  });

  it("incomparable: the last story has no live figure, so the one before it is used", () => {
    const r = row({ stories: [story("1", { passed: 63, total: 75 }), story("2", { passed: null, total: null })], scores: { [SUITE]: score(63, 75) } });
    expect(heldOutAgreement(r).kind).toBe("agree");
  });

  it("incomparable: no score of record", () => {
    expect(heldOutAgreement(row())).toMatchObject({ kind: "incomparable", why: "There is no score of record to check the live figure against." });
  });

  it("incomparable: no live figure at all", () => {
    const r = row({ stories: [story("1", { passed: null, total: null })], scores: { [SUITE]: score(63, 75) } });
    expect(heldOutAgreement(r)).toMatchObject({ kind: "incomparable", why: "No story recorded a live held-out figure." });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("jobs", () => {
  const job = (id: string, status: string, reason = "") => ({ id, node: "node-a", status, submittedAt: 1, updatedAt: 2, reason });

  it("no jobs (a run from the record alone): none", () => expect(jobsView(row({ jobs: [] }))).toEqual([]));

  it("one job: job 1 of 1, not a restart", () => {
    expect(jobsView(row({ jobs: [job("a", "done")] }))).toEqual([{ ...job("a", "done"), place: 1, of: 1, restart: false }]);
  });

  it("a restart: each job knows its place, and every one after the first is a restart", () => {
    const v = jobsView(row({ jobs: [job("a", "cancelled", "stopped by the operator"), job("a-again1", "done")] }));
    expect(v.map((j) => [j.place, j.of, j.restart, j.reason])).toEqual([[1, 2, false, "stopped by the operator"], [2, 2, true, ""]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("comparisons", () => {
  describe("relative difference and the 10% rule", () => {
    it.each([
      ["over, above", 111, 100, 0.11, true],
      ["over, below", 89, 100, -0.11, true],
      ["under, above", 109, 100, 0.09, false],
      ["under, below", 91, 100, -0.09, false],
      ["exactly 10% is not more than 10%", 110, 100, 0.1, false],
      ["equal", 100, 100, 0, false],
    ] as [string, number, number, number, boolean][])("%s", (_, value, base, rel, flagged) => {
      expect(relDiff(value, base)).toBeCloseTo(rel, 9);
      expect(isOver(relDiff(value, base))).toBe(flagged);
    });

    it("the threshold is the plan's 10%", () => expect(DIFF_THRESHOLD).toBe(0.1));

    // A pass rate of 10/10 against a median of 10/11 is exactly 10% more, but floating point makes it 0.10000000000000003.
    it("exactly 10% in floating point (all pass against 10 of 11) is not more than 10%", () => {
      expect(isOver(relDiff(1, 10 / 11))).toBe(false);
      expect(isOver(relDiff(110, 100))).toBe(false);
    });

    it.each([[null, 100], [100, null], [null, null], [undefined, 100]])("missing (%s against %s): no difference, not flagged", (a, b) => {
      expect(relDiff(a, b)).toBeNull();
      expect(isOver(relDiff(a, b))).toBe(false);
    });

    it("zero against zero: no difference", () => {
      expect(relDiff(0, 0)).toBe(0);
      expect(isOver(0)).toBe(false);
    });

    it("something against zero: infinitely more, flagged", () => {
      expect(relDiff(5, 0)).toBe(Infinity);
      expect(relDiff(-5, 0)).toBe(-Infinity);
      expect(isOver(Infinity)).toBe(true);
    });

    it("zero against something: 100% less, flagged", () => {
      expect(relDiff(0, 50)).toBe(-1);
      expect(isOver(-1)).toBe(true);
    });

    it("signed percentages", () => {
      expect(signedPercent(0.123)).toBe("+12%");
      expect(signedPercent(-0.083)).toBe("−8%");
      expect(signedPercent(0.001)).toBe("±0%");
      expect(signedPercent(Infinity)).toBe("from 0");
      expect(signedPercent(null)).toBe("");
    });
  });

  describe("median", () => {
    it("odd count: the middle", () => expect(median([3, 1, 2])).toBe(2));
    it("even count: the mean of the middle two", () => expect(median([4, 1, 3, 2])).toBe(2.5));
    it("one: itself", () => expect(median([7])).toBe(7));
    it("none: missing", () => expect(median([])).toBeNull());
    it("doesn't reorder what it's given", () => {
      const xs = [3, 1, 2];
      median(xs);
      expect(xs).toEqual([3, 1, 2]);
    });
  });

  describe("two runs story by story", () => {
    const a = row({ runId: "r5", stories: [story("1", { usage: usage({ agentSeconds: 660, calls: 95 }), ownPassed: 14, ownTotal: 14 }), story("2")] });
    const b = row({ runId: "r1", stories: [story("1", { usage: usage({ agentSeconds: 720, calls: 95 }), ownPassed: 9, ownTotal: 10 }), story("3")] });

    it("every story either run recorded, in order, knowing which has it", () => {
      expect(compareRuns(a, b).map((r) => [r.id, r.inA, r.inB])).toEqual([["1", true, true], ["2", true, false], ["3", false, true]]);
    });

    it("measures, in order, from the glossary", () => {
      expect(compareRuns(a, b)[0].cells.map((c) => c.key)).toEqual(COMPARE_MEASURES.map((m) => m.key));
      for (const m of COMPARE_MEASURES) expect(GLOSSARY[m.term]).toBeDefined();
    });

    it("under 10%: shown, not flagged (660 against 720 is −8%)", () => {
      const c = compareRuns(a, b)[0].cells.find((x) => x.key === "minutes")!;
      expect(c).toMatchObject({ a: 660, b: 720, flagged: false });
      expect(c.rel).toBeCloseTo(-60 / 720, 9);
    });

    it("held-out compares pass rates: 14/14 against 9/10 is +11%, flagged", () => {
      const c = compareRuns(a, b)[0].cells.find((x) => x.key === "heldOut")!;
      expect(c.a).toBe(1);
      expect(c.b).toBe(0.9);
      expect(c.flagged).toBe(true);
    });

    it("equal values: not flagged", () => expect(compareRuns(a, b)[0].cells.find((x) => x.key === "calls")!.flagged).toBe(false));

    it("a story only one run has: its values against missing, never flagged", () => {
      const cells = compareRuns(a, b)[1].cells;
      expect(cells.every((c) => c.b === null && c.rel === null && !c.flagged)).toBe(true);
    });

    it("a story with no held-out tests: missing, not 0%", () => {
      const r = compareRuns(row({ stories: [story("1", { ownTotal: null, ownPassed: null })] }), b)[0];
      expect(r.cells.find((c) => c.key === "heldOut")!.a).toBeNull();
    });

    it("a story with no usage: its usage measures missing", () => {
      const r = compareRuns(row({ stories: [story("1", { usage: null })] }), b)[0];
      expect(r.cells.filter((c) => c.key !== "heldOut").every((c) => c.a === null)).toBe(true);
    });

    it("the title comes from whichever run has it", () => expect(compareRuns(a, b)[2].title).toBe("Story 3"));
  });

  describe("other runs of the combination", () => {
    const rows = [
      row({ runId: "v2-r10" }), row({ runId: "v2-r2" }), row({ runId: "v2-r1" }),
      row({ runId: "v2-r3", stack: "other/stack" }), row({ runId: "v2-r4", pack: "todoodle" }),
    ];
    it("same pack and combination only, not itself, in run order", () => {
      expect(otherRuns(rows[2], rows).map((r) => r.runId)).toEqual(["v2-r2", "v2-r10"]);
    });
    it("a combination with one run: none", () => expect(otherRuns(rows[3], rows)).toEqual([]));
  });

  describe("a story run against the median of the combination's other runs", () => {
    it("no other run has the number: nothing to differ from", () => {
      expect(divergence(100, [])).toBeNull();
      expect(divergence(100, [null, undefined])).toBeNull();
    });

    it("over 10% from the median: flagged", () => {
      expect(divergence(4811, [660, 720, 700])).toMatchObject({ median: 700, n: 3, flagged: true });
    });

    it("under 10%: not flagged", () => expect(divergence(660, [720])).toMatchObject({ median: 720, n: 1, flagged: false }));

    it("missing values among the others are left out of the median and of n", () => {
      expect(divergence(100, [90, null, 110])).toMatchObject({ median: 100, n: 2, flagged: false });
    });

    it("this story run's value missing: the median, but no difference", () => {
      expect(divergence(null, [100])).toEqual({ value: null, median: 100, n: 1, rel: null, flagged: false });
    });

    it("the others' median is 0 and this isn't: flagged", () => expect(divergence(3, [0, 0])).toMatchObject({ median: 0, rel: Infinity, flagged: true }));
    it("all zero: not flagged", () => expect(divergence(0, [0])).toMatchObject({ rel: 0, flagged: false }));

    describe("across the combination", () => {
      const talk = (thinkingChars: number, largest: number) => ({
        calls: 1, toolCalls: 1, thinkingChars, textChars: 0, toolArgChars: 0, thinkingMedian: 0, thinkingMedianBefore: null, thinkingMedianAfter: null,
        largestThinking: { chars: largest, call: 1, atS: 0 }, contextStart: null, contextEnd: null, largestContextJump: null,
        toolsByName: {}, toolErrors: 0, longestTool: null, signals: [],
      });
      const s1 = (secs: number, out: number, calls: number, conversation: ConversationProfile | null = null) =>
        story("1", { usage: usage({ agentSeconds: secs, outTokens: out, calls, split: split({ wall: secs }) }), conversation });
      const me = row({ runId: "v2-r5", stories: [s1(4811, 175000, 204, talk(328750, 64543))] });
      const rows = [
        me,
        row({ runId: "v2-r1", stories: [s1(660, 60000, 95, talk(9100, 60000))] }),
        row({ runId: "v2-r2", stories: [s1(720, 60000, 190)] }),
        row({ runId: "v2-r3", stories: [] }),
        row({ runId: "v2-r9", stack: "other", stories: [s1(1, 1, 1)] }),
      ];

      it("every run of the combination in run order, this one marked, including runs without the story", () => {
        const { entries } = againstCombination(me, rows, "1");
        expect(entries.map((e) => [e.run.runId, e.isThis, e.story !== null])).toEqual([
          ["v2-r1", false, true], ["v2-r2", false, true], ["v2-r3", false, false], ["v2-r5", true, true],
        ]);
      });

      it("one scale: the longest wall among them", () => expect(againstCombination(me, rows, "1").scaleSeconds).toBe(4811));

      it("flags on time, output tokens and calls against the others' median", () => {
        const { flags } = againstCombination(me, rows, "1");
        expect(Object.keys(flags)).toEqual(AGAINST_MEASURES.map((m) => m.key));
        expect(flags.minutes).toMatchObject({ median: 690, n: 2, flagged: true });
        expect(flags.outTokens).toMatchObject({ median: 60000, flagged: true });
        expect(flags.calls).toMatchObject({ median: 142.5, flagged: true });
      });

      it("thinking is judged against the others, not by its size: a 64k block beside a 60k one is not flagged", () => {
        const { flags } = againstCombination(me, rows, "1");
        expect(flags.largestThinking).toMatchObject({ median: 60000, n: 1, flagged: false });
        expect(flags.thinking).toMatchObject({ median: 9100, n: 1, flagged: true });
      });

      it("others without a conversation profile are left out of the thinking median", () => {
        expect(againstCombination(me, rows, "1").flags.thinking!.n).toBe(1);
      });

      it("the only run with the story: nothing to compare with", () => {
        const { flags } = againstCombination(me, [me], "1");
        expect(flags).toEqual({ heldOut: null, minutes: null, outTokens: null, calls: null, thinking: null, largestThinking: null });
      });

      it("this run hasn't built the story: the others' median, no flag", () => {
        const { flags } = againstCombination(rows[3], rows, "1");
        expect(flags.minutes).toMatchObject({ value: null, flagged: false, n: 3 });
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("an invalid run", () => {
  const INVALID = { reason: "read the reference build in story 7", since: "2026-09-30" };

  describe("its score of record", () => {
    it("has none, and says why, naming the re-score it isn't", () => {
      const r = scoreOfRecord(row({ invalid: INVALID, rescores: [SUITE], scores: { [SUITE]: score(70, 75) } }));
      expect(r).toMatchObject({ kind: "none", reason: "invalid" });
      expect(r.kind === "none" && r.why).toBe(`Invalid: read the reference build in story 7 (marked 2026-09-30). Its re-score, 70/75 under ${SUITE}, is not a result: it is left out of every figure.`);
    });
    it("unscored as well: says so without a number", () => {
      const r = scoreOfRecord(row({ invalid: INVALID }));
      expect(r.kind === "none" && r.why).toBe("Invalid: read the reference build in story 7 (marked 2026-09-30). It is left out of every figure.");
    });
    it("a mark with no date leaves the date out", () => {
      const r = scoreOfRecord(row({ invalid: { reason: "leak", since: "" } }));
      expect(r.kind === "none" && r.why).toBe("Invalid: leak. It is left out of every figure.");
    });
    it("whatever its status: running and invalid is still invalid", () => {
      expect(scoreOfRecord(row({ invalid: INVALID, status: "running" }))).toMatchObject({ reason: "invalid" });
    });
    it("the live figure has nothing of record to agree with", () => {
      expect(heldOutAgreement(row({ invalid: INVALID, scores: { [SUITE]: score(5, 10) } }))).toMatchObject({ kind: "incomparable" });
    });
  });

  it("its hover: the reason, the date, and what being invalid does", () => {
    expect(invalidTip(INVALID)).toBe("Invalid run: read the reference build in story 7 (marked 2026-09-30). Shown for the record, struck through, and left out of every figure: rankings, medians, ranges, pooled scores and needs you.");
    expect(invalidTip({ reason: "leak", since: "" })).toMatch(/^Invalid run: leak\. Shown/);
  });

  describe("against the combination", () => {
    const at = (id: string, runId: string, secs: number, over: Partial<Row> = {}) => row({ runId, stories: [story(id, { usage: usage({ agentSeconds: secs, outTokens: secs, calls: secs, split: split({ wall: secs }) }) })], ...over });
    const me = at("1", "me", 1000);
    const rows = [me, at("1", "a", 1000), at("1", "b", 1000), at("1", "bad", 100, { invalid: INVALID })];

    it("the median of the other runs leaves an invalid one out", () => {
      const { flags } = againstCombination(me, rows, "1");
      expect(flags.minutes).toMatchObject({ median: 1000, n: 2, flagged: false });
      expect(flags.calls).toMatchObject({ n: 2, flagged: false });
    });
    it("it is still shown among the combination's runs, on the same scale", () => {
      const { entries, scaleSeconds } = againstCombination(me, rows, "1");
      expect(entries.map((e) => e.run.runId)).toEqual(["a", "b", "bad", "me"]);
      expect(scaleSeconds).toBe(1000);
    });
    it("an invalid run's own page still compares it with the valid runs", () => {
      const bad = rows[3];
      expect(againstCombination(bad, rows, "1").flags.minutes).toMatchObject({ median: 1000, n: 3, flagged: true });
    });
    it("unmarked, it would pull the median (the control)", () => {
      expect(againstCombination(me, rows.map((r) => ({ ...r, invalid: null })), "1").flags.minutes).toMatchObject({ n: 3 });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("interventions", () => {
  const T = Date.parse("2026-09-26T14:17:23Z") / 1000;
  const iv = (story: string | null, text: string, at = T): Intervention => ({ at, story, text });

  describe("which apply", () => {
    const list = [iv("3", "froze"), iv(null, "suite fixed"), iv("11", "capped"), iv("3", "restarted", T + 60)];
    it("to the run: all of them, oldest first", () => expect(interventionsOf({ interventions: list }).map((i) => i.text)).toEqual(["froze", "suite fixed", "capped", "restarted"]));
    it("to a story run: those naming that story, whatever its padding", () => {
      expect(interventionsOf({ interventions: list }, "3").map((i) => i.text)).toEqual(["froze", "restarted"]);
      expect(interventionsOf({ interventions: list }, "03").map((i) => i.text)).toEqual(["froze", "restarted"]);
    });
    it("to a story nobody intervened in: none", () => expect(interventionsOf({ interventions: list }, "5")).toEqual([]));
    it("a run-wide one belongs to no story run", () => expect(interventionsOf({ interventions: [iv(null, "x")] }, "1")).toEqual([]));
    it("a row from an older server (no field): none", () => expect(interventionsOf({} as Pick<Row, "interventions">)).toEqual([]));
  });

  describe("grouped: a watchdog repeating itself reads as one line", () => {
    it("consecutive identical lines for one story collapse, with the count and the first and last time", () => {
      const reps = Array.from({ length: 95 }, (_, i) => iv("7", "interrupted a tool call silent for 600s", T + i * 30));
      expect(groupInterventions([iv("5", "other"), ...reps])).toEqual([
        { story: "5", text: "other", count: 1, first: T, last: T },
        { story: "7", text: "interrupted a tool call silent for 600s", count: 95, first: T, last: T + 94 * 30 },
      ]);
    });
    it("the same text in different stories stays apart", () => {
      expect(groupInterventions([iv("2", "x"), iv("4", "x")])).toHaveLength(2);
    });
    it("not consecutive: stays apart, so the order stays true", () => {
      expect(groupInterventions([iv("2", "x"), iv("2", "y"), iv("2", "x")]).map((g) => g.text)).toEqual(["x", "y", "x"]);
    });
  });

  describe("the hover", () => {
    it("says how many, then one line each: when, which story, what", () => {
      expect(interventionTip([iv("3", "froze"), iv(null, "suite fixed", T + 3600)])).toBe(
        "Operator interventions (2):\n2026-09-26 14:17 UTC · story 3: froze\n2026-09-26 15:17 UTC · the run: suite fixed");
    });
    it("a repeated line once, with how many times and over when", () => {
      const reps = Array.from({ length: 3 }, (_, i) => iv("7", "killed a silent tool call", T + i * 60));
      expect(interventionTip(reps)).toBe("Operator interventions (3):\n2026-09-26 14:17–14:19 UTC · story 7: killed a silent tool call (3 times)");
    });
    it(`at most ${MAX_TIP_INTERVENTIONS} lines, then how many more`, () => {
      const many = Array.from({ length: MAX_TIP_INTERVENTIONS + 3 }, (_, i) => iv(String(i + 1), `line ${i + 1}`, T + i * 60));
      const tip = interventionTip(many);
      expect(tip.split("\n")).toHaveLength(1 + MAX_TIP_INTERVENTIONS + 1);
      expect(tip.split("\n").at(-1)).toBe("… and 3 more on the run page");
    });
    it("none: empty", () => expect(interventionTip([])).toBe(""));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The story against the combination's other runs: its quality beside its cost, why a flagged figure differs (the
// combination page's mechanism, not a copy), the most typical other run, and the two conversations side by side.
describe("a story run against the combination: quality, mechanism, the most typical run, what differed", () => {
  const prof = (over: Partial<ConversationProfile> = {}): ConversationProfile => ({
    calls: 100, toolCalls: 100, thinkingChars: 10000, textChars: 0, toolArgChars: 0, thinkingMedian: 100, thinkingMedianBefore: 80,
    thinkingMedianAfter: 120, largestThinking: { chars: 4000, call: 10, atS: 300 }, contextStart: 2000, contextEnd: 80000,
    largestContextJump: { tokens: 9000, call: 3 }, toolsByName: { bash: 50, read: 20 }, toolErrors: 3,
    longestTool: { seconds: 10, name: "bash", gist: "npm test" }, signals: [], ...over,
  });
  /** Story 2 of a run: `secs` of agent time, ten output tokens a second, a tool call every ten seconds. */
  const st = (secs: number, own: [number, number] | null = [10, 10], conversation: ConversationProfile | null = prof()) => story("2", {
    ownPassed: own?.[0] ?? null, ownTotal: own?.[1] ?? null, conversation,
    usage: usage({ agentSeconds: secs, outTokens: secs * 10, calls: secs / 10, split: split({ wall: secs }) }),
  });
  const run = (runId: string, s: Story | null, over: Partial<Row> = {}) => row({ runId, stories: s ? [s] : [], ...over });
  const INVALID = { reason: "saw the reference build", since: "2026-09-30" };

  describe("held-out: this story's own tests, first among the measures", () => {
    const heldOut = AGAINST_MEASURES[0];
    it("comes first, under the story run's held-out term", () => expect([heldOut.key, heldOut.term]).toEqual(["heldOut", "storyRunHeldOut"]));
    it("is the pass rate of its own tests, not the cumulative suite", () => {
      expect(heldOut.value(story("2", { ownPassed: 7, ownTotal: 10, passed: 15, total: 20 }))).toBe(0.7);
    });
    it.each([[null, null], [0, 0], [null, 10]])("own tests not recorded (%s/%s): missing, never 0", (p, t) => {
      expect(heldOut.value(story("2", { ownPassed: p, ownTotal: t }))).toBe(t ? 0 : null);
    });

    const flagsFor = (mine: [number, number] | null, others: ([number, number] | null)[]) => {
      const me = run("me", st(1000, mine));
      return againstCombination(me, [me, ...others.map((o, i) => run(`o${i + 1}`, st(1000, o)))], "2").flags.heldOut;
    };
    it("more than 10% above the others' median: flagged", () => {
      const d = flagsFor([10, 10], [[8, 10], [9, 10], [8, 10]])!;
      expect(d).toMatchObject({ value: 1, median: 0.8, n: 3, flagged: true });
      expect(d.rel).toBeCloseTo(0.25, 9);
    });
    it("more than 10% below: flagged, negative", () => {
      const d = flagsFor([6, 10], [[9, 10], [9, 10]])!;
      expect(d.flagged).toBe(true);
      expect(d.rel).toBeCloseTo(-1 / 3, 9);
    });
    it("one test short of all of them (exactly 10%): not flagged", () => expect(flagsFor([9, 10], [[10, 10], [10, 10]])).toMatchObject({ flagged: false }));
    it("pass rates, not counts: 10 of 12 against 5 of 6 is no difference", () => expect(flagsFor([10, 12], [[5, 6]])).toMatchObject({ rel: 0, flagged: false }));
    it("a run without its result is left out of the median and of n", () => expect(flagsFor([9, 10], [[8, 10], null, [10, 10]])).toMatchObject({ median: 0.9, n: 2 }));
    it("this story run without its result: the median, no difference", () => {
      expect(flagsFor(null, [[8, 10]])).toEqual({ value: null, median: 0.8, n: 1, rel: null, flagged: false });
    });
    it("no other run has a result: no median", () => expect(flagsFor([9, 10], [null, null])).toBeNull());
  });

  describe("the mechanism behind a flag", () => {
    const others = [run("o1", st(1000)), run("o2", st(1000))];
    it("nothing flagged: no mechanism", () => {
      const me = run("me", st(1000));
      expect(againstCombination(me, [me, ...others], "2").mechanism).toBeNull();
    });
    it("flagged: the combination page's mechanism, against the same story in the other runs", () => {
      const mine = st(3000, [10, 10], prof({ thinkingChars: 100000 }));
      const me = run("me", mine);
      const { mechanism } = againstCombination(me, [me, ...others], "2");
      expect(mechanism).toEqual(classifyMechanism(mine, others.map((o) => o.stories[0])));
      expect(mechanism!.label).toBe("verbose thinking");
    });
    it("an invalid run is no yardstick for the mechanism either", () => {
      const mine = st(3000, [10, 10], prof({ thinkingChars: 100000 }));
      const me = run("me", mine);
      const bad = run("bad", st(3000, [10, 10], prof({ thinkingChars: 1000000 })), { invalid: INVALID });
      expect(againstCombination(me, [me, bad, ...others], "2").mechanism).toEqual(classifyMechanism(mine, others.map((o) => o.stories[0])));
    });
    it("flagged on held-out alone: it carries one too", () => {
      const me = run("me", st(1000, [5, 10]));
      expect(againstCombination(me, [me, ...others], "2").mechanism).toMatchObject({ label: "unexplained", fired: [] });
    });
    it("this run hasn't recorded the story: no mechanism", () => {
      const me = run("me", null);
      expect(againstCombination(me, [me, ...others], "2").mechanism).toBeNull();
    });
  });

  describe("the flag's hover", () => {
    const d = { value: 4811, median: 1000, n: 2, rel: 3.811, flagged: true };
    const fired = { label: "verbose thinking" as const, fired: [
      { label: "verbose thinking" as const, evidence: "thinking per call 1,588 chars against 105 (15.1×)" },
      { label: "slower generation" as const, evidence: "decode 41.7 tok/s against 99.0 (42%)" },
    ], evidence: "thinking per call 1,588 chars against 105 (15.1×)" };
    it("how far, the median of how many runs, the mechanism, and every rule that fired with its numbers", () => {
      expect(againstFlagTip("minutes", d, "17 min", fired)).toBe(`${GLOSSARY.divergence.what} The median of the other 2 runs: 17 min. `
        + "Mechanism: verbose thinking. verbose thinking: thinking per call 1,588 chars against 105 (15.1×) · slower generation: decode 41.7 tok/s against 99.0 (42%).");
    });
    it("one run: \"run\", not \"runs\"", () => expect(againstFlagTip("minutes", { ...d, n: 1 }, "17 min", fired)).toContain("The median of the other 1 run: 17 min."));
    it("no rule fired: the mechanism's own words", () => {
      const none = { label: "unexplained" as const, fired: [], evidence: "None of the rules fired." };
      expect(againstFlagTip("calls", d, "118", none)).toMatch(/Mechanism: unexplained\. None of the rules fired\.$/);
    });
    it("below the median: says the rules look for what makes a figure higher", () => {
      expect(againstFlagTip("minutes", { ...d, rel: -0.8 }, "17 min", fired)).toMatch(new RegExp(`${BELOW_CAVEAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    });
    it("held-out, either way: says the rules explain cost, not quality", () => {
      expect(againstFlagTip("heldOut", { ...d, rel: 0.25 }, "80%", fired)).toMatch(/explain cost, not quality/);
      expect(againstFlagTip("heldOut", { ...d, rel: -0.25 }, "80%", fired)).toContain(HELD_OUT_CAVEAT);
      expect(againstFlagTip("heldOut", { ...d, rel: -0.25 }, "80%", fired)).not.toContain(BELOW_CAVEAT);
    });
    it("a cost figure above the median: no caveat", () => {
      const tip = againstFlagTip("outTokens", d, "72k", fired);
      expect(tip).not.toContain(BELOW_CAVEAT);
      expect(tip).not.toContain(HELD_OUT_CAVEAT);
    });
  });

  describe("the most typical other run: closest to the medians", () => {
    const entries = (rows: Row[], me: Row) => againstCombination(me, [me, ...rows], "2");
    const me = run("me", st(5000));
    it("the smallest sum of relative deviations from the medians wins", () => {
      // Medians: 1100 s, 11k tokens, 110 calls; held-out and thinking all equal. a is 9% off on three measures, b on none.
      const t = entries([run("a", st(1000)), run("b", st(1100)), run("c", st(3000))], me).typical!;
      expect(t.run.runId).toBe("b");
      expect(t.deviation).toBeCloseTo(0, 9);
      expect(t.measures).toBe(AGAINST_MEASURES.length);
    });
    it("is worked out from the same medians the table shows", () => {
      const { typical, flags } = entries([run("a", st(1000)), run("c", st(3000))], me);
      expect(flags.minutes!.median).toBe(2000);
      expect(typical!.run.runId).toBe("a");                       // 50% off on three measures, against c's 50%: a tie
      expect(typical!.deviation).toBeCloseTo(1.5, 9);
    });
    it("a tie: the earlier run (v2-r2 before v2-r10)", () => {
      expect(entries([run("v2-r10", st(1000)), run("v2-r2", st(1000))], me).typical!.run.runId).toBe("v2-r2");
    });
    it("one other run: that one", () => expect(entries([run("a", st(9000))], me).typical!.run.runId).toBe("a"));
    it("no other run recorded the story: none", () => {
      expect(entries([run("a", null)], me).typical).toBeNull();
      expect(againstCombination(me, [me], "2").typical).toBeNull();
    });
    it("an invalid run is never the typical one", () => {
      expect(entries([run("bad", st(1100), { invalid: INVALID }), run("a", st(3000))], me).typical!.run.runId).toBe("a");
      expect(entries([run("bad", st(1100), { invalid: INVALID })], me).typical).toBeNull();
    });
    it("a run with more of the measures beats one with fewer, however close", () => {
      // b matches the medians exactly but has no conversation profile (no thinking figures); a has every figure.
      const t = entries([run("a", st(1300)), run("b", st(1100, [10, 10], null)), run("c", st(1100))], me).typical!;
      expect(t.run.runId).toBe("c");
      const u = entries([run("a", st(1300)), run("b", st(1100, [10, 10], null))], me).typical!;
      expect(u.run.runId).toBe("a");
      expect(u.measures).toBe(AGAINST_MEASURES.length);
    });
    it("this run is never its own typical run", () => expect(entries([run("a", st(1000))], run("a2", st(1000))).typical!.run.runId).toBe("a"));
  });

  describe("what differed: the two story runs side by side", () => {
    const a = st(2000, [9, 10], prof({ thinkingChars: 40000, thinkingMedian: 400, largestThinking: { chars: 16000, call: 4, atS: 60 }, contextEnd: 100000, toolErrors: 6, toolsByName: { bash: 80, write: 10 } }));
    const b = st(1000, [10, 10]);
    a.usage!.split!.toolsByKind = { e2e: 100, unit: 20 };
    b.usage!.split!.toolsByKind = { e2e: 50, build: 5 };
    const v = whatDiffered(a, b);
    const r = (key: string) => v.rows.find((x) => x.key === key)!;

    it("groups in order: the outcome, then cost, where the time went, the conversation", () => {
      const groups = v.rows.map((x) => x.group).filter((g, i, all) => all.indexOf(g) === i);
      expect(groups).toEqual(["outcome", "cost", "time", "conversation"]);
      expect(v.rows[0].key).toBe("heldOut");
    });
    it("each row: both figures and this one over the other, marked where more than 10% apart", () => {
      expect(r("minutes")).toMatchObject({ a: { value: 2000 }, b: { value: 1000 }, ratio: 2, differs: true });
      expect(r("heldOut")).toMatchObject({ a: { value: 0.9 }, b: { value: 1 }, differs: false });
      expect(r("heldOut").ratio).toBeCloseTo(0.9, 9);
      expect(r("compactions")).toMatchObject({ ratio: 1, differs: false });
    });
    it("from the profile: model calls, thinking, per call, after the largest block, the largest block, context, failed commands", () => {
      expect(r("modelCalls").a.value).toBe(100);
      expect(r("thinking")).toMatchObject({ a: { value: 40000 }, b: { value: 10000 }, ratio: 4 });
      expect(r("thinkingMedian")).toMatchObject({ a: { value: 400 }, b: { value: 100 } });
      expect(r("thinkingAfter")).toMatchObject({ a: { value: 120 }, b: { value: 120 } });
      expect(r("largestThinking")).toMatchObject({ a: { value: 16000 }, b: { value: 4000 } });
      expect(r("contextEnd")).toMatchObject({ a: { value: 100000 }, b: { value: 80000 } });
      expect(r("contextGrowth")).toMatchObject({ a: { value: 50 }, b: { value: 40 } });
      expect(r("contextJump").a.value).toBe(9000);
      expect(r("toolErrors")).toMatchObject({ a: { value: 6 }, b: { value: 3 }, ratio: 2 });
      expect(r("longestTool").a.value).toBe(10);
      expect(v.rows.filter((x) => x.group === "conversation").every((x) => x.needsProfile)).toBe(true);
      expect(v.rows.filter((x) => x.group !== "conversation").some((x) => x.needsProfile)).toBe(false);
    });
    it("tools by kind: every kind either run used, the larger first; 0 where a run used none", () => {
      const kinds = v.rows.filter((x) => x.key.startsWith("toolKind:"));
      expect(kinds.map((x) => [x.label, x.a.value, x.b.value])).toEqual([["e2e", 100, 50], ["unit", 20, 0], ["build", 0, 5]]);
      expect(kinds.every((x) => x.group === "time")).toBe(true);
    });
    it("tool calls by tool: likewise", () => {
      expect(v.rows.filter((x) => x.key.startsWith("tool:")).map((x) => [x.label, x.a.value, x.b.value])).toEqual([["bash", 80, 50], ["read", 0, 20], ["write", 10, 0]]);
    });
    it("the other's figure is 0: no ratio, with why", () => {
      const x = r("toolKind:unit");
      expect(x.ratio).toBeNull();
      expect(x.ratioWhy).toMatch(/is 0/);
      expect(x.differs).toBe(true);
    });
    it("both 0: the same", () => expect(whatDiffered(st(1000), st(1000)).rows.find((x) => x.key === "nudges")).toMatchObject({ ratio: 1, differs: false }));
    it("both have a profile", () => expect(v.profile).toEqual({ a: true, b: true }));

    it("one has no profile: says which; its conversation figures missing with why; no ratio", () => {
      const w = whatDiffered(a, st(1000, [10, 10], null));
      expect(w.profile).toEqual({ a: true, b: false });
      const t = w.rows.find((x) => x.key === "thinking")!;
      expect(t).toMatchObject({ a: { value: 40000 }, b: { value: null, why: "No conversation profile for this story run." }, ratio: null });
      expect(w.rows.filter((x) => x.key.startsWith("tool:")).map((x) => x.b.value)).toEqual([null, null]);
    });
    it("neither has a profile: no tool-by-tool rows", () => {
      const w = whatDiffered(st(1000, [10, 10], null), st(1000, [10, 10], null));
      expect(w.profile).toEqual({ a: false, b: false });
      expect(w.rows.some((x) => x.key.startsWith("tool:"))).toBe(false);
      expect(w.rows.some((x) => x.key === "thinking")).toBe(true);
    });
    it("a profile that couldn't count a figure: missing with why", () => {
      const w = whatDiffered(st(1000, [10, 10], prof({ largestThinking: null, thinkingMedianAfter: null, contextStart: null })), b);
      for (const k of ["largestThinking", "thinkingAfter", "contextGrowth"]) {
        expect(w.rows.find((x) => x.key === k)!.a).toEqual({ value: null, why: "The harness couldn't count this from the story run's event log." });
      }
    });
    it("no usage: its cost and time figures missing with why", () => {
      const w = whatDiffered(story("2", { usage: null, conversation: prof() }), b);
      expect(w.rows.find((x) => x.key === "minutes")!.a).toEqual({ value: null, why: "No usage recorded for this story run." });
      expect(w.rows.find((x) => x.key === "compaction")!.a).toEqual({ value: null, why: "No usage recorded for this story run." });
    });
    it("no time split: its time figures missing with why", () => {
      const w = whatDiffered(story("2", { usage: usage({ split: null }), conversation: prof() }), b);
      expect(w.rows.find((x) => x.key === "tools")!.a).toEqual({ value: null, why: "No time split recorded for this story run." });
      expect(w.rows.find((x) => x.key === "toolKind:e2e")!.a).toEqual({ value: null, why: "No time split recorded for this story run." });
    });
    it("a split without tools by kind: those missing with why", () => {
      const w = whatDiffered(st(1000), b);
      expect(w.rows.find((x) => x.key === "toolKind:e2e")!.a).toEqual({ value: null, why: "Its tool time wasn't recorded by kind." });
    });
    it("a figure the usage lacks: missing with why", () => {
      const w = whatDiffered(story("2", { usage: usage({ decodeTokS: null }), conversation: prof() }), b);
      expect(w.rows.find((x) => x.key === "decodeTokS")!.a).toEqual({ value: null, why: "Not recorded for this story run." });
    });
    it("held-out not recorded: missing with why, not 0", () => {
      const w = whatDiffered(st(1000, null), b);
      expect(w.rows[0].a).toEqual({ value: null, why: "Its own held-out tests weren't recorded." });
      expect(w.rows[0].ratio).toBeNull();
    });
  });
});
