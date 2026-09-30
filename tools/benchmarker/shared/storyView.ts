// What the story page shows, worked out from the state (plan section 4.5): every combination's attempt at one story,
// its median and range over its finished runs, each run's numbers with the 10% divergence mark, the chosen comparison,
// and the way to the story before and after. Pure functions, so every rule is tested here once.
//
// The rules are the combination page's, reused, not copied: a story run's value on a measure (metricValue), the median
// over the combination's finished runs (as storyMedians), the divergence rule (divergence), run order (runOrder), and
// the mechanism behind a flag (classifyMechanism against the story's other runs in the combination).
import type { Row, Story, StorySquare, Usage } from "./types.ts";
import type { TermId } from "./glossary.ts";
import { isInvalid, spread, type Spread } from "./stats.ts";
import {
  buildingStory, cellOf, classifyMechanism, divergence, metricValue, runOrder, siblings, storyIds,
  type Divergence, type MechanismResult, type Metric, type StoryMedian,
} from "./combinationView.ts";
import { storyRunState } from "./runView.ts";

const PERCENT = 100;

/** Story ids are compared as numbers: "02" and "2" are the same story. */
export const sameStory = (a: string, b: string) => String(Number(a)) === String(Number(b));

// ---------- the measures ----------

export type StoryMeasureKey = "minutes" | "outTokens" | "calls" | "heldOut" | "readTokens" | "tokS" | "decodeTokS" | "compactions" | "nudges";

export interface StoryMeasure {
  key: StoryMeasureKey;
  term: TermId;
  /** The story run's value, or null when it wasn't recorded. */
  value: (s: Story) => number | null;
  /** Summarised per combination (median and range) and flagged against that median: the plan's four. */
  summarised: boolean;
  /** Shown as a percentage of the comparison's. Held-out is a pass rate: a percentage of one says nothing useful. */
  relative: boolean;
}

const fromMetric = (metric: Metric) => (s: Story) => metricValue(s, metric).value;
const fromUsage = (f: (u: Usage) => number | null) => (s: Story) => (s.usage ? f(s.usage) : null);

/** In the order shown: the four summarised first, then the rest of what the by-story view showed. */
export const STORY_MEASURES: StoryMeasure[] = [
  { key: "minutes", term: "agentTime", value: fromMetric("minutes"), summarised: true, relative: true },
  { key: "outTokens", term: "outTokens", value: fromMetric("outTokens"), summarised: true, relative: true },
  { key: "calls", term: "calls", value: fromMetric("calls"), summarised: true, relative: true },
  { key: "heldOut", term: "storyRunHeldOut", value: fromMetric("heldOut"), summarised: true, relative: false },
  { key: "readTokens", term: "inputTokens", value: fromUsage((u) => u.readTokens), summarised: false, relative: true },
  { key: "tokS", term: "tokS", value: fromUsage((u) => u.tokS), summarised: false, relative: true },
  { key: "decodeTokS", term: "decodeTokS", value: fromUsage((u) => u.decodeTokS), summarised: false, relative: true },
  { key: "compactions", term: "compactions", value: fromUsage((u) => u.compactions), summarised: false, relative: true },
  { key: "nudges", term: "nudges", value: fromUsage((u) => u.nudges), summarised: false, relative: true },
];

export type SummaryKey = "minutes" | "outTokens" | "calls" | "heldOut";
export const SUMMARY_KEYS: SummaryKey[] = ["minutes", "outTokens", "calls", "heldOut"];

// ---------- the stories ----------

export interface StoryItem { id: string; title: string }

/** The title most runs recorded for the story (runs can record it differently); ties go to the first run in run
 * order. The running story's live title when no run recorded one. "" when nothing names it. */
export function storyTitleOf(runs: Row[], id: string): string {
  const count = new Map<string, number>();
  for (const r of runOrder(runs)) {
    const t = r.stories.find((s) => sameStory(s.id, id))?.title;
    if (t) count.set(t, (count.get(t) ?? 0) + 1);
  }
  let best = "", most = 0;
  for (const [t, n] of count) if (n > most) { best = t; most = n; }
  if (best) return best;
  for (const r of runOrder(runs)) if (r.live?.storyTitle && r.live.runningStory && sameStory(r.live.runningStory, id)) return r.live.storyTitle;
  return "";
}

/** Every story any of the runs has in scope or recorded, in story order, with its title. */
export function storyList(runs: Row[]): StoryItem[] {
  return storyIds(runs).map((id) => ({ id, title: storyTitleOf(runs, id) }));
}

/** The stories before and after this one in the list; null at either end, and both null for a story not in it. */
export function storyNeighbours(list: StoryItem[], id: string): { prev: StoryItem | null; next: StoryItem | null } {
  const i = list.findIndex((s) => sameStory(s.id, id));
  if (i < 0) return { prev: null, next: null };
  return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
}

export interface TestCount { total: number; runs: number }

/** How many held-out tests the story has, as the runs counted them: a run scored under another suite version can
 * count a different number. One entry per distinct count, the most runs first (then the larger count). Each run
 * counts once: its record of the story, else its latest-build square. */
export function heldOutTests(runs: Row[], id: string): TestCount[] {
  const count = new Map<number, number>();
  for (const r of runs) {
    const total = r.stories.find((s) => sameStory(s.id, id))?.ownTotal ?? squareOf(r, id)?.total ?? null;
    if (total) count.set(total, (count.get(total) ?? 0) + 1);
  }
  return [...count].map(([total, n]) => ({ total, runs: n })).toSorted((a, b) => b.runs - a.runs || b.total - a.total);
}

// ---------- one story run ----------

export const squareOf = (run: Row, id: string): StorySquare | null => run.storiesWorking.squares.find((q) => sameStory(q.id, id)) ?? null;

/** A run's part in the story: recorded; being built now (live figures); built, by its latest-build square, but not
 * recorded yet (dbench reported it before the record arrived); or not built, with why. */
export type Attempt =
  | { kind: "recorded"; story: Story }
  | { kind: "building"; agentMinutes: number | null; calls: number | null; outputTokens: number | null }
  | { kind: "unrecorded" }
  | { kind: "notBuilt"; why: string };

const BUILT: StorySquare["state"][] = ["ok", "part", "bad"];

export function attemptOf(run: Row, id: string): Attempt {
  const story = run.stories.find((s) => sameStory(s.id, id));
  if (story) return { kind: "recorded", story };
  const q = squareOf(run, id);
  if (buildingStory(run) === String(Number(id)) || (run.status === "running" && q?.state === "running")) {
    const l = run.live;
    return { kind: "building", agentMinutes: l?.agentMinutes ?? null, calls: l?.calls ?? null, outputTokens: l?.outputTokens ?? null };
  }
  if (q && BUILT.includes(q.state)) return { kind: "unrecorded" };
  const st = storyRunState(run, q?.id ?? id);
  return { kind: "notBuilt", why: st.kind === "notBuilt" ? st.why : `Not in this run's scope: it has ${run.storiesWorking.scope} stories in scope.` };
}

export interface Entry {
  run: Row;
  attempt: Exclude<Attempt, { kind: "notBuilt" }>;
  /** Its held-out tests against the run's latest build (live), when the run has a square for the story. */
  latest: StorySquare | null;
  /** Its divergence from the combination's median on each summarised measure; null when within 10%, or no median. */
  divergence: Record<SummaryKey, Divergence | null>;
  /** Why it differs, when any measure is flagged. */
  mechanism: MechanismResult | null;
}

// ---------- per combination ----------

export interface Summary { spread: Spread | null; /** For the divergence rule: the same median and n. */ median: StoryMedian | null }

/** Per summarised measure, the median, range and n over the combination's finished runs that have a value for the
 * story: the combination page's storyMedians, with the range. Missing values are left out; zeros count; invalid runs
 * are left out. */
export function combinationSummary(runs: Row[], id: string): Record<SummaryKey, Summary> {
  const finished = runs.filter((r) => r.status === "finished" && !isInvalid(r));
  const one = (metric: Metric): Summary => {
    const xs = finished.map((r) => cellOf(r, String(Number(id)), metric).value).filter((x): x is number => x !== null);
    const s = spread(xs);
    return { spread: s, median: s && { median: s.median, n: s.n } };
  };
  return { minutes: one("minutes"), outTokens: one("outTokens"), calls: one("calls"), heldOut: one("heldOut") };
}

export interface Group {
  stack: string;
  label: string;
  pack: string;
  machines: { machine: string; host: string }[];
  summary: Record<SummaryKey, Summary>;
  /** Valid finished runs that recorded the story: what the summary is over (each measure's own n can be smaller). */
  finishedRecorded: number;
  /** Runs that built the story or are building it, in run order. */
  entries: Entry[];
  /** Runs that haven't built it, with why. */
  notBuilt: { run: Row; why: string }[];
}

const NO_FLAGS: Record<SummaryKey, Divergence | null> = { minutes: null, outTokens: null, calls: null, heldOut: null };

function groupOf(stack: string, runs: Row[], id: string): Group {
  const ordered = runOrder(runs);
  const summary = combinationSummary(runs, id);
  const entries: Entry[] = [];
  const notBuilt: Group["notBuilt"] = [];
  for (const run of ordered) {
    const attempt = attemptOf(run, id);
    if (attempt.kind === "notBuilt") { notBuilt.push({ run, why: attempt.why }); continue; }
    const story = attempt.kind === "recorded" ? attempt.story : null;
    const flags = story && !isInvalid(run)
      ? Object.fromEntries(SUMMARY_KEYS.map((k) => [k, divergence(STORY_MEASURES.find((m) => m.key === k)!.value(story), summary[k].median)])) as Record<SummaryKey, Divergence | null>
      : NO_FLAGS;
    const flagged = SUMMARY_KEYS.some((k) => flags[k]);
    entries.push({
      run, attempt, latest: squareOf(run, id), divergence: flags,
      mechanism: flagged && story ? classifyMechanism(story, siblings(runs, run, String(Number(id)))) : null,
    });
  }
  const machines = new Map<string, string>();
  for (const r of ordered) if (!machines.has(r.machine)) machines.set(r.machine, r.host);
  return {
    stack, label: ordered[0].label, pack: ordered[0].pack,
    machines: [...machines].map(([machine, host]) => ({ machine, host })),
    summary,
    finishedRecorded: ordered.filter((r) => r.status === "finished" && !isInvalid(r) && r.stories.some((s) => sameStory(s.id, id))).length,
    entries, notBuilt,
  };
}

const TIER_MEASURED = 0, TIER_UNFINISHED = 1, TIER_NOT_BUILT = 2;
const tier = (g: Group) => (g.finishedRecorded > 0 ? TIER_MEASURED : g.entries.length > 0 ? TIER_UNFINISHED : TIER_NOT_BUILT);
/** Nulls sort after every number. */
const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b));

/** Combinations with a finished run of the story first, best held-out median first (quality before cost), then the
 * shortest agent time; then those only running or unrecorded; then those that haven't built it. Ties by label. */
export function compareGroups(a: Group, b: Group): number {
  return tier(a) - tier(b)
    || nullsLast(a.summary.heldOut.spread?.median ?? null, b.summary.heldOut.spread?.median ?? null, -1)
    || nullsLast(a.summary.minutes.spread?.median ?? null, b.summary.minutes.spread?.median ?? null, 1)
    || a.label.localeCompare(b.label) || a.stack.localeCompare(b.stack);
}

export interface StoryPageView {
  groups: Group[];
  /** One scale for every time bar on the page: the longest wall time among the story runs (never 0). */
  scaleSeconds: number;
  /** Story runs shown, and runs that haven't built the story. */
  storyRuns: number;
  notBuilt: number;
}

/** Every combination among the runs, with its attempts at the story. */
export function storyPage(runs: Row[], id: string): StoryPageView {
  const byStack = new Map<string, Row[]>();
  for (const r of runs) byStack.set(r.stack, [...(byStack.get(r.stack) ?? []), r]);
  const groups = [...byStack].map(([stack, rs]) => groupOf(stack, rs, id)).toSorted(compareGroups);
  const walls = groups.flatMap((g) => g.entries).map((e) => (e.attempt.kind === "recorded" ? e.attempt.story.usage?.split?.wall ?? 0 : 0));
  return {
    groups,
    scaleSeconds: Math.max(1, ...walls),
    storyRuns: groups.reduce((t, g) => t + g.entries.length, 0),
    notBuilt: groups.reduce((t, g) => t + g.notBuilt.length, 0),
  };
}

// ---------- the comparison ----------

const SEP = "|";

/** The address's form of a story run chosen as the comparison: "<combination>|<run>". */
export const compareParam = (stack: string, runId: string) => `${stack}${SEP}${runId}`;

/** The combination and run a compare parameter names; null for none or a malformed one. A combination id has no "|". */
export function parseCompare(param: string | undefined): { stack: string; runId: string } | null {
  if (!param) return null;
  const i = param.indexOf(SEP);
  if (i <= 0 || i === param.length - 1) return null;
  return { stack: param.slice(0, i), runId: param.slice(i + 1) };
}

export type Comparison =
  | { kind: "none" }
  | { kind: "ok"; entry: Entry & { attempt: { kind: "recorded"; story: Story } } }
  | { kind: "unusable"; why: string };

/** The story run the numbers are shown against, or why the one the address names can't be. */
export function comparisonOf(view: StoryPageView, param: string | undefined, id: string): Comparison {
  if (!param) return { kind: "none" };
  const want = parseCompare(param);
  if (!want) return { kind: "unusable", why: `"${param}" doesn't name a run (it should be <combination>|<run>).` };
  const group = view.groups.find((g) => g.stack === want.stack);
  const entry = group?.entries.find((e) => e.run.runId === want.runId);
  if (entry?.attempt.kind === "recorded") return { kind: "ok", entry: entry as Entry & { attempt: { kind: "recorded"; story: Story } } };
  if (entry) return { kind: "unusable", why: `${want.runId} of ${group!.label} hasn't recorded story ${Number(id)} yet, so there is nothing to compare with.` };
  if (group?.notBuilt.some((n) => n.run.runId === want.runId)) {
    return { kind: "unusable", why: `${want.runId} of ${group.label} hasn't built story ${Number(id)}, so there is nothing to compare with.` };
  }
  return { kind: "unusable", why: `No run ${want.runId} of ${want.stack} in this pack version.` };
}

export type Relative =
  | { kind: "percent"; percent: number }
  /** The run's own number: a share of 0 or of nothing means nothing. */
  | { kind: "own"; value: number; why: string }
  | { kind: "missing" };

/** A value as a percentage of the comparison's, rounded; its own number where the comparison's is 0 or missing. */
export function relativeTo(value: number | null, base: number | null): Relative {
  if (value === null) return { kind: "missing" };
  if (base === null) return { kind: "own", value, why: "The comparison has no figure here, so this is the run's own number." };
  if (base === 0) return { kind: "own", value, why: "The comparison's figure is 0, and no share of 0 means anything, so this is the run's own number." };
  return { kind: "percent", percent: Math.round((value / base) * PERCENT) };
}
