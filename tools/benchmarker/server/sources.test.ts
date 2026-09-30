import { describe, expect, it } from "vitest";
import { rescoreStoryPaths, rescoredStory } from "./sources.ts";

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
