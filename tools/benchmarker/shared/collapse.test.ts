import { describe, expect, it } from "vitest";
import { collapsedStoryIds, COLLAPSE_RUN } from "./collapse.ts";

// A story run "passes none" when its own held-out tests number more than zero and none passed. A run has collapsed where
// COLLAPSE_RUN or more stories in a row (in the run's own order of stories) pass none: its short thinking or time there
// is a broken run's, not a thrifty one's.
const s = (id: number, passed: number | null, total: number | null = 5) => ({ id: String(id), ownPassed: passed, ownTotal: total });

describe("collapsed stretches of a run", () => {
  it("is three stories in a row", () => expect(COLLAPSE_RUN).toBe(3));

  it("marks every story of a stretch of three or more that pass none", () => {
    const run = [s(1, 5), s(2, 4), s(3, 0), s(4, 0), s(5, 0), s(7, 3)];
    expect([...collapsedStoryIds(run)].sort()).toEqual(["3", "4", "5"]);
  });

  it("does not mark one or two in a row", () => {
    expect(collapsedStoryIds([s(1, 5), s(2, 0), s(3, 0), s(4, 5)]).size).toBe(0);
    expect(collapsedStoryIds([s(1, 0), s(2, 5), s(3, 0)]).size).toBe(0);
  });

  it("marks a stretch broken by a story that passes anything as separate stretches", () => {
    const run = [s(1, 0), s(2, 0), s(3, 0), s(4, 1), s(5, 0), s(7, 0)];
    expect([...collapsedStoryIds(run)]).toEqual(["1", "2", "3"]);
  });

  it("goes by the run's order of stories, so a story out of scope (6) does not break it", () => {
    const run = [s(5, 0), s(7, 0), s(8, 0)];
    expect([...collapsedStoryIds(run)].sort()).toEqual(["5", "7", "8"]);
  });

  it("orders by story number, whatever order the stories arrive in", () => {
    // 8, 3, 4 are the run's stories in the order 3, 4, 8: three in a row.
    expect([...collapsedStoryIds([s(8, 0), s(3, 0), s(4, 0)])].sort()).toEqual(["3", "4", "8"]);
    expect([...collapsedStoryIds([s(8, 0), s(3, 5), s(4, 0)])]).toEqual([]);
  });

  it("a story with no own tests recorded, or a total of zero, passes nothing and breaks the stretch", () => {
    const run = [s(1, 0), s(2, null, null), s(3, 0), s(4, 0), s(5, 0, 0), s(7, 0)];
    expect(collapsedStoryIds(run).size).toBe(0);
  });

  it("a run with fewer than three stories, or none, has none", () => {
    expect(collapsedStoryIds([]).size).toBe(0);
    expect(collapsedStoryIds([s(1, 0), s(2, 0)]).size).toBe(0);
  });

  it("the whole run broken after the first stories, as in Swift 1.5 v2-r5", () => {
    // own results 6/6 7/10 0/7 0/4 1/5 0/8 0/7 0/6 0/8 0/5 0/5
    const run = [[6, 6], [7, 10], [0, 7], [0, 4], [1, 5], [0, 8], [0, 7], [0, 6], [0, 8], [0, 5], [0, 5]].map(([p, t], i) => s([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12][i], p, t));
    expect([...collapsedStoryIds(run)].sort((a, b) => Number(a) - Number(b))).toEqual(["7", "8", "9", "10", "11", "12"]);
  });
});
