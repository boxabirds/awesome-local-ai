import { describe, expect, it } from "vitest";
import { countedRuns, MIN_RUNS_FOR_SPREAD, predictability } from "./predictability.ts";
import { GLOSSARY } from "./glossary.ts";
import type { Row, RunStatus } from "./types.ts";

const FAMILY = "p-v2";
const OLD_FAMILY = "p-v1";
const MIN = 60;
const DIGITS = 6;

/** One story run: agent seconds, and its thinking as the log gives it. `profile: false` is a record with no
 * conversation profile; `withheld` is a cloud model's (thinking counted in tokens, no characters). */
interface StoryOpts { secs?: number | null; chars?: number | null; tokens?: number | null; withheld?: boolean; profile?: false; collapsed?: boolean }
interface RunOpts { status?: RunStatus; dir?: string | null; family?: string; knownGood?: boolean }

let seq = 0;
const run = (stories: Record<string, StoryOpts>, o: RunOpts = {}): Row => {
  const runId = `r${++seq}`;
  return {
    pack: "p", stack: "s", runId, dir: o.dir === undefined ? `runs/${runId}` : o.dir, status: o.status ?? "finished", family: o.family ?? FAMILY, knownGood: o.knownGood ?? false,
    stories: Object.entries(stories).map(([id, s]) => ({
      id,
      ...(s.collapsed ? { collapsed: true } : {}),
      usage: s.secs === undefined ? null : { agentSeconds: s.secs },
      conversation: s.profile === false ? null : { thinkingVisible: !s.withheld, thinkingChars: s.withheld ? null : s.chars ?? null, thinkingTokens: s.tokens ?? null },
    })),
  } as unknown as Row;
};

/** Population standard deviation over mean, worked by hand for the fixtures below. */
const CV_100_200_300 = Math.sqrt(2 / 3) / 2;   // sd √(20000/3) over mean 200
const CV_10_10_40 = Math.SQRT2 / 2;            // sd √200 over mean 20

describe("the runs that count", () => {
  it("finished runs with a record; not running, queued, failed, stopped or cancelled ones, and not a job with no record", () => {
    const a = run({ 1: { secs: 60 } }), b = run({ 1: { secs: 60 } });
    const others = (["running", "queued", "failed", "stopped", "cancelled", "unknown"] as RunStatus[]).map((status) => run({ 1: { secs: 60 } }, { status }));
    const noRecord = run({}, { dir: null });
    expect(countedRuns([a, ...others, noRecord, b])).toEqual([a, b]);
  });

  it("one version family only: the newest with a finished run (another spec's stories are other stories)", () => {
    const old = run({ 1: { secs: 60 } }, { family: OLD_FAMILY }), cur = run({ 1: { secs: 60 } });
    expect(countedRuns([old, cur])).toEqual([cur]);
    expect(countedRuns([old, run({ 1: { secs: 60 } }, { status: "running" })])).toEqual([old]);
  });

  it("the least to quote a spread from is three", () => {
    expect(MIN_RUNS_FOR_SPREAD).toBe(3);
    expect(GLOSSARY.spreadTooFewRuns.what).toBe("Needs three finished runs");
  });

  it("not a partial rerun: mixed with full runs, one covering a different single story than another breaks every figure (real bug, 2 Oct 2026)", () => {
    const full = run({ 1: { secs: 60 }, 2: { secs: 60 } });
    const partialOfStory1 = run({ 1: { secs: 90 } }, { knownGood: true });
    const partialOfStory2 = run({ 2: { secs: 90 } }, { knownGood: true });
    expect(countedRuns([full, partialOfStory1, partialOfStory2])).toEqual([full]);
  });
});

describe("predictability: thinking spread and time spread", () => {
  it("three runs: per story the variation across runs, then the median over stories; amounts are medians over story runs", () => {
    const p = predictability([
      run({ 1: { secs: 10 * MIN, chars: 100 }, 2: { secs: 100, chars: 5000 } }),
      run({ 1: { secs: 20 * MIN, chars: 200 }, 2: { secs: 100, chars: 5000 } }),
      run({ 1: { secs: 30 * MIN, chars: 300 }, 2: { secs: 100, chars: 5000 } }),
    ]);
    expect(p.runs).toBe(3);
    expect(p.thinkingUnit).toBe("chars");
    // Story 1 varies by CV_100_200_300 on both, story 2 not at all: the median of the two.
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300 / 2, DIGITS);
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300 / 2, DIGITS);
    expect(p.thinkingPerStory).toBe((300 + 5000) / 2);            // 100 200 300 5000 5000 5000
    expect(p.minutesPerStory).toBeCloseTo((100 + 600) / 2 / MIN, DIGITS);
  });

  it("an odd number of stories: the middle story's variation", () => {
    const p = predictability([
      run({ 1: { secs: 10 }, 2: { secs: 100 }, 3: { secs: 50 } }),
      run({ 1: { secs: 10 }, 2: { secs: 200 }, 3: { secs: 50 } }),
      run({ 1: { secs: 40 }, 2: { secs: 300 }, 3: { secs: 50 } }),
    ]);
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);     // 0, CV_100_200_300, CV_10_10_40
    expect(CV_10_10_40).toBeGreaterThan(CV_100_200_300);
  });

  it("two runs: no spread (not 0), and the amounts still show", () => {
    const p = predictability([run({ 1: { secs: 600, chars: 100 } }), run({ 1: { secs: 1200, chars: 300 } })]);
    expect(p).toEqual({ runs: 2, thinkingUnit: "chars", thinkingSpread: null, timeSpread: null, thinkingPerStory: 200, minutesPerStory: 15 });
  });

  it("a run that isn't counted doesn't make three", () => {
    const p = predictability([run({ 1: { secs: 600 } }), run({ 1: { secs: 1200 } }), run({ 1: { secs: 9000 } }, { status: "running" })]);
    expect(p.runs).toBe(2);
    expect(p.timeSpread).toBeNull();
  });

  it("no counted run: nothing at all, never a 0", () => {
    expect(predictability([run({ 1: { secs: 600, chars: 5 } }, { status: "failed" })]))
      .toEqual({ runs: 0, thinkingUnit: null, thinkingSpread: null, timeSpread: null, thinkingPerStory: null, minutesPerStory: null });
  });

  it("a story missing from one run is left out, of the spreads and of the amounts", () => {
    const p = predictability([
      run({ 1: { secs: 100, chars: 100 }, 2: { secs: 10, chars: 1 } }),
      run({ 1: { secs: 200, chars: 200 }, 2: { secs: 9000, chars: 90000 } }),
      run({ 1: { secs: 300, chars: 300 } }),
    ]);
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingPerStory).toBe(200);
    expect(p.minutesPerStory).toBeCloseTo(200 / MIN, DIGITS);
  });

  it("story ids are matched as numbers: '01' and '1' are one story", () => {
    const p = predictability([run({ "01": { secs: 100 } }), run({ 1: { secs: 200 } }), run({ 1: { secs: 300 } })]);
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);
  });

  it("a cloud model's thinking is its tokens; a local model's its characters", () => {
    const cloud = predictability([100, 200, 300].map((tokens) => run({ 1: { secs: 60, tokens, withheld: true } })));
    expect(cloud.thinkingUnit).toBe("tokens");
    expect(cloud.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(cloud.thinkingPerStory).toBe(200);
    // A local model's log shows its thinking: characters, whatever tokens the record also has.
    const local = predictability([100, 200, 300].map((chars) => run({ 1: { secs: 60, chars, tokens: 7 } })));
    expect(local.thinkingUnit).toBe("chars");
    expect(local.thinkingPerStory).toBe(200);
  });

  it("characters and tokens are never mixed: the combination's unit is its story runs' commoner one, and a story with a run in the other is left out", () => {
    const p = predictability([
      run({ 1: { secs: 60, chars: 100 }, 2: { secs: 60, chars: 10 } }),
      run({ 1: { secs: 60, chars: 200 }, 2: { secs: 60, tokens: 999999, withheld: true } }),
      run({ 1: { secs: 60, chars: 300 }, 2: { secs: 60, chars: 10 } }),
    ]);
    expect(p.thinkingUnit).toBe("chars");
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);   // story 2 is out
    expect(p.thinkingPerStory).toBe(200);
  });

  it("a story run with no profile: its story is out of the thinking figures, and still in the time figures", () => {
    const p = predictability([
      run({ 1: { secs: 100, chars: 100 }, 2: { secs: 10, chars: 10 } }),
      run({ 1: { secs: 200, chars: 200 }, 2: { secs: 10, profile: false } }),
      run({ 1: { secs: 300, chars: 300 }, 2: { secs: 40, chars: 40 } }),
    ]);
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingPerStory).toBe(200);
    expect(p.timeSpread).toBeCloseTo((CV_100_200_300 + CV_10_10_40) / 2, DIGITS);
  });

  it("a story run with no time recorded: its story is out of the time figures only", () => {
    const p = predictability([
      run({ 1: { secs: 100, chars: 100 }, 2: { secs: null, chars: 10 } }),
      run({ 1: { secs: 200, chars: 200 }, 2: { chars: 10 } }),
      run({ 1: { secs: 300, chars: 300 }, 2: { secs: 40, chars: 40 } }),
    ]);
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingSpread).toBeCloseTo((CV_100_200_300 + CV_10_10_40) / 2, DIGITS);
  });

  it("no thinking recorded anywhere: no unit and no thinking figures; time still has its own", () => {
    const p = predictability([100, 200, 300].map((secs) => run({ 1: { secs, profile: false } })));
    expect(p).toMatchObject({ runs: 3, thinkingUnit: null, thinkingSpread: null, thinkingPerStory: null });
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);
  });

  it("a mean of zero has no variation to state: the story is left out of the spread (never NaN), and counts in the amount", () => {
    const p = predictability([
      run({ 1: { secs: 60, chars: 0 }, 2: { secs: 60, chars: 100 } }),
      run({ 1: { secs: 60, chars: 0 }, 2: { secs: 60, chars: 200 } }),
      run({ 1: { secs: 60, chars: 0 }, 2: { secs: 60, chars: 300 } }),
    ]);
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingPerStory).toBe(50);                           // 0 0 0 100 200 300
    const allZero = predictability([0, 0, 0].map((chars) => run({ 1: { secs: 60, chars } })));
    expect(allZero.thinkingSpread).toBeNull();
    expect(allZero.thinkingPerStory).toBe(0);
  });

  it("a story where one run thought nothing still varies: 0 is a value, not a missing one", () => {
    const p = predictability([0, 30, 30].map((chars) => run({ 1: { secs: 60, chars } })));
    expect(p.thinkingSpread).toBeCloseTo(CV_10_10_40, DIGITS);     // 0 30 30: the same shape as 40 10 10, mirrored
  });
});

describe("a story run marked not comparable", () => {
  const REASON = "This story run also built stories 2 and 3.";
  const marked = (r: Row, id: string): Row => ({ ...r, stories: r.stories.map((s) => (s.id === id ? { ...s, notComparable: REASON } : s)) });

  it("has no value on either measure, so its story is left out like one missing from a run: of the spreads and of the amounts", () => {
    const p = predictability([
      run({ 1: { secs: 100, chars: 100 }, 2: { secs: 10, chars: 1 } }),
      run({ 1: { secs: 200, chars: 200 }, 2: { secs: 10, chars: 1 } }),
      marked(run({ 1: { secs: 300, chars: 300 }, 2: { secs: 9000, chars: 90000 } }), "2"),
    ]);
    expect(p.runs).toBe(3);                                         // the run still counts: its other stories are compared
    expect(p.timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingPerStory).toBe(200);
    expect(p.minutesPerStory).toBeCloseTo(200 / MIN, DIGITS);
  });
});

describe("a collapsed story run (a stretch of stories in a row that pass none) is not counted as a thrifty one", () => {
  const thin = (chars: number, secs: number, collapsed = false): StoryOpts => ({ chars, secs, collapsed });

  it("is left out of its story's spread, which is stated from the runs that remain", () => {
    const runs = [run({ 1: thin(100, 600) }), run({ 1: thin(200, 600) }), run({ 1: thin(300, 600) }), run({ 1: thin(5, 30, true) })];
    const p = predictability(runs);
    expect(p.thinkingSpread).toBeCloseTo(CV_100_200_300, DIGITS);
    expect(p.thinkingPerStory).toBe(200);                       // the median over the three that remain, not the four
    expect(p.minutesPerStory).toBe(10);
  });

  it("takes the story out when fewer than three runs remain for it", () => {
    const runs = [run({ 1: thin(100, 600) }), run({ 1: thin(200, 600) }), run({ 1: thin(5, 30, true) }), run({ 1: thin(5, 30, true) })];
    expect(predictability(runs).thinkingSpread).toBeNull();
  });

  it("does not rescue a story a run has no value for: that still takes it out", () => {
    const runs = [run({ 1: thin(100, 600) }), run({ 1: thin(200, 600) }), run({ 1: thin(300, 600) }), run({ 1: { secs: 60, profile: false } })];
    expect(predictability(runs).thinkingSpread).toBeNull();
  });

  it("each story is judged on its own: a run collapsed in one story still counts in the others", () => {
    const runs = [
      run({ 1: thin(100, 600), 2: thin(100, 600) }), run({ 1: thin(200, 600), 2: thin(200, 600) }),
      run({ 1: thin(300, 600), 2: thin(300, 600) }), run({ 1: thin(5, 30, true), 2: thin(150, 600) }),
    ];
    const p = predictability(runs);
    // story 1 from the three, story 2 from the four: the median of the two variations.
    expect(p.thinkingSpread).not.toBeNull();
    expect(p.thinkingPerStory).toBe(200);                       // the median of 100 200 300 and 100 150 200 300 together
  });

  it("time spread leaves them out too", () => {
    const runs = [run({ 1: thin(1, 60) }), run({ 1: thin(1, 120) }), run({ 1: thin(1, 180) }), run({ 1: thin(1, 5, true) })];
    expect(predictability(runs).timeSpread).toBeCloseTo(CV_100_200_300, DIGITS);
  });
});
