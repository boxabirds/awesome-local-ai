// How predictable a combination is: how much the same story differs from one finished run to the next, in the
// model's thinking and in the story's time. One function, so the overview and the combination page show the same
// figures. Pure arithmetic over the records: no LLM, nothing guessed.
import type { Row, Story } from "./types.ts";
import { median } from "./stats.ts";
import { isCompared } from "./combinationView.ts";

/** The least number of finished runs to state a spread from. With fewer, the amounts are shown and the spread isn't. */
export const MIN_RUNS_FOR_SPREAD = 3;

const SECONDS_PER_MINUTE = 60;

/** What a combination's thinking is counted in: characters where the log shows the thinking text; tokens for a
 * cloud model, whose text is withheld. A spread has no unit, so the two can sit side by side; the amounts can't. */
export type ThinkingUnit = "chars" | "tokens";

export interface Predictability {
  /** The runs the figures are over: see countedRuns. */
  runs: number;
  /** null when no counted story run recorded any thinking. */
  thinkingUnit: ThinkingUnit | null;
  /** Per story, the variation of its thinking across the runs (population standard deviation over mean); then the
   * median over stories. A fraction: 0.59 is 59%. null with fewer than MIN_RUNS_FOR_SPREAD runs, or no story to state it for. */
  thinkingSpread: number | null;
  /** The median thinking of one story run, in thinkingUnit. */
  thinkingPerStory: number | null;
  /** As thinkingSpread, on the story's agent time. */
  timeSpread: number | null;
  /** The median agent minutes of one story run. */
  minutesPerStory: number | null;
}

/** Newest version family first ("p-v2" before "p-v1"). */
const newestFirst = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

/** The runs that count: finished, with a record (not a job that has none), of one version family: the newest that
 * has such a run. Runs of another spec version built other stories, so they are never set against these. (The pages
 * pass one family's runs already; a run marked invalid never reaches the page at all.) */
export function countedRuns(runs: Row[]): Row[] {
  const done = runs.filter((r) => r.status === "finished" && r.dir !== null);
  const family = done.map((r) => r.family).toSorted(newestFirst)[0];
  return done.filter((r) => r.family === family);
}

const storyKey = (s: Story) => String(Number(s.id));

/** Whether the log shows this story run's thinking text. Only a profile that says it doesn't is a withheld one. */
const shown = (s: Story) => s.conversation?.thinkingVisible !== false;

/** A story run's thinking in the combination's unit; null with no profile, or one counted in the other unit. */
function thinkingOf(s: Story, unit: ThinkingUnit): number | null {
  const c = s.conversation;
  if (!c) return null;
  if (unit === "chars") return shown(s) ? c.thinkingChars ?? null : null;
  return shown(s) ? null : c.thinkingTokens ?? null;
}

/** The unit most of the profiled story runs are counted in; null when none has a profile. */
function unitOf(runs: Row[]): ThinkingUnit | null {
  const profiled = runs.flatMap((r) => r.stories).filter((s) => s.conversation);
  if (!profiled.length) return null;
  const visible = profiled.filter(shown).length;
  return visible >= profiled.length - visible ? "chars" : "tokens";
}

/** Population standard deviation over mean; null over a mean of 0, where there is no variation to state. */
function variation(xs: number[]): number | null {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return null;
  const variance = xs.reduce((t, x) => t + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

/** One measure over the stories every run has a value for: the median variation over stories, and the median value
 * over their story runs. A story run that isn't compared (isCompared) has no value here, so its story is left out
 * like one missing from a run. */
function measure(runs: Row[], value: (s: Story) => number | null): { spread: number | null; amount: number | null } {
  const byRun = runs.map((r) => new Map(r.stories.map((s) => [storyKey(s), isCompared(s) ? value(s) : null])));
  const ids = [...new Set(byRun.flatMap((m) => [...m.keys()]))];
  const perStory = ids.map((id) => byRun.map((m) => m.get(id) ?? null)).filter((xs): xs is number[] => xs.every((x) => x !== null));
  const spread = runs.length >= MIN_RUNS_FOR_SPREAD ? median(perStory.map(variation).filter((v): v is number => v !== null)) : null;
  return { spread, amount: median(perStory.flat()) };
}

/** A combination's predictability, from its runs (all of them: which count is decided here). */
export function predictability(runs: Row[]): Predictability {
  const counted = countedRuns(runs);
  const unit = unitOf(counted);
  const thinking = unit ? measure(counted, (s) => thinkingOf(s, unit)) : { spread: null, amount: null };
  const time = measure(counted, (s) => s.usage?.agentSeconds ?? null);
  return {
    runs: counted.length,
    thinkingUnit: unit && thinking.amount !== null ? unit : null,
    thinkingSpread: thinking.spread, thinkingPerStory: thinking.amount,
    timeSpread: time.spread, minutesPerStory: time.amount === null ? null : time.amount / SECONDS_PER_MINUTE,
  };
}
