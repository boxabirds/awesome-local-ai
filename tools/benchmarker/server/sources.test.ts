import { describe, expect, it } from "vitest";
import { rescoreStoryPaths, rescoredStory, runNotes, runNotePaths } from "./sources.ts";

// A re-scored story's counts: since 30 Sep 2026 a record has only the public summary (accept-summary.json);
// the full result (accept.json) is private. Older records have only the full result.
const DIR = "combinations/some/stack/benchmarks/vidi/r1";
const V = "vidi-v2.0-pre2";
const SUMMARY = `${DIR}/rescore/${V}/stories/12/accept-summary.json`;
const FULL = `${DIR}/rescore/${V}/stories/12/accept.json`;
const counts = (passed: number) => JSON.stringify({ passed, total: 75, by_story: { "12": { passed, total: 5 } } });

describe("a re-scored story's counts", () => {
  it("are looked for in the public summary first, then the full result", () => {
    expect(rescoreStoryPaths(DIR, V, "12")).toEqual([SUMMARY, FULL]);
    expect(rescoreStoryPaths(DIR, V, "3")[0]).toBe(`${DIR}/rescore/${V}/stories/03/accept-summary.json`);
  });
  it("come from the summary when the record has one", () => {
    expect(rescoredStory(new Map([[SUMMARY, counts(4)], [FULL, counts(1)]]), DIR, V, "12")?.by_story).toEqual({ "12": { passed: 4, total: 5 } });
  });
  it("come from the full result in a record from before the summaries", () => {
    expect(rescoredStory(new Map([[FULL, counts(1)]]), DIR, V, "12")?.by_story).toEqual({ "12": { passed: 1, total: 5 } });
  });
  it("fall back past a summary that doesn't parse, and are null when there is nothing", () => {
    expect(rescoredStory(new Map([[SUMMARY, "{not json"], [FULL, counts(2)]]), DIR, V, "12")?.by_story?.["12"].passed).toBe(2);
    expect(rescoredStory(new Map(), DIR, V, "12")).toBeNull();
  });
});

// ---------- what the record says about the run itself ----------

describe("a run's notes: its client and invalid mark (run.json), and interventions (interventions.md)", () => {
  const RUN = `${DIR}/run.json`;
  const IV = `${DIR}/interventions.md`;
  const meta = (extra: Record<string, unknown>) => JSON.stringify({ pack: "vidi", pack_version: V, ...extra }, null, 2);

  it("are read from run.json and interventions.md beside it", () => expect(runNotePaths(DIR)).toEqual([RUN, IV]));
  it("both present", () => {
    const n = runNotes(new Map([[RUN, meta({ invalid: { reason: "read the reference build in story 7", since: "2026-09-30" } })], [IV, "- 2026-09-26T08:57:29Z story 3: node-c froze"]]), DIR);
    expect(n.invalid).toEqual({ reason: "read the reference build in story 7", since: "2026-09-30" });
    expect(n.interventions).toEqual([{ at: Date.parse("2026-09-26T08:57:29Z") / 1000, story: "3", text: "node-c froze" }]);
  });
  it("neither: a valid run with no interventions", () => {
    expect(runNotes(new Map([[RUN, meta({})]]), DIR)).toEqual({ client: "", invalid: null, interventions: [] });
    expect(runNotes(new Map(), DIR)).toEqual({ client: "", invalid: null, interventions: [] });
  });
  it("the client that ran it, as run.json names it (Claude Code runs have no time accounting yet)", () => {
    expect(runNotes(new Map([[RUN, meta({ client: "claude" })]]), DIR).client).toBe("claude");
    expect(runNotes(new Map([[RUN, meta({ client: "pi" })]]), DIR).client).toBe("pi");
  });
  it("a run.json that doesn't parse says nothing about validity", () => {
    expect(runNotes(new Map([[RUN, "{not json"]]), DIR).invalid).toBeNull();
  });
});
