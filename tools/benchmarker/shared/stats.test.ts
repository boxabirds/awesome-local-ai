import { describe, expect, it } from "vitest";
import { comboStats } from "./stats.ts";
import type { Row } from "./types.ts";

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
