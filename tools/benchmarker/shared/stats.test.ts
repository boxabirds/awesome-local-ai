import { describe, expect, it } from "vitest";
import { comboStats, combinations } from "./stats.ts";
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

describe("combinations", () => {
  const r = (stack: string, machine: string, status: string, o: { secs?: number; out?: number; calls?: number; read?: number; score?: [number, number] } = {}) => ({
    stack, label: stack, machine, status, suite: "v2", runId: `${machine}-${status}`,
    stories: [{ id: "1", usage: o.secs === undefined ? null : { agentSeconds: o.secs, outTokens: o.out ?? 0, calls: o.calls ?? 0, readTokens: o.read ?? 0 } }],
    storiesWorking: { squares: [] },
    scores: o.score ? { v2: { passed: o.score[0], total: o.score[1], flaky: 0, at: "" } } : {},
  }) as unknown as Row;

  it("one row per combination, across every machine it ran on, with its runs by status", () => {
    const cs = combinations([r("a", "m1", "finished", { secs: 600, out: 6000, calls: 60, read: 1e6, score: [75, 75] }),
                             r("a", "m2", "running", { secs: 1200, out: 6000, calls: 140, read: 3e6 }),
                             r("b", "m1", "finished", { score: [70, 75] })]);
    const a = cs.find((c) => c.stack === "a")!;
    expect(a.machines).toEqual(["m1", "m2"]);
    expect(a.byStatus).toEqual({ finished: 1, running: 1 });
    expect(a.stats.runs).toBe(2);
    expect(a.tokS).toBeCloseTo(12000 / 1800, 6);           // weighted by time, not a mean of rates
    expect(a.callsPerStory).toBe(100);
    expect(a.readPerStory).toBe(2e6);
    expect(a.score).toEqual({ mean: 75, total: 75, n: 1 }); // only runs with a score of record count
    expect(cs.find((c) => c.stack === "b")!.score).toEqual({ mean: 70, total: 75, n: 1 });
  });
});
