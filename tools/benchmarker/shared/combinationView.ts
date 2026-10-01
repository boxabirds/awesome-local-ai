// The combination page's matrix, as pure data: one row per run, one column per story, each cell a story run.
// Everything here is mechanical: medians, the 10% divergence rule, and the mechanism label from the story's
// conversation profile and usage against the same story's other runs. No LLM, nothing guessed.
import type { ConversationProfile, Row, Story, TimeSplit, Usage } from "./types.ts";
import { median } from "./stats.ts";
import { toolGist } from "./runView.ts";
import type { TermId } from "./glossary.ts";

const SECONDS_PER_MINUTE = 60;

// ---------- metrics ----------

export type Metric = "minutes" | "outTokens" | "calls" | "heldOut" | "tokS";
export const METRICS: Metric[] = ["minutes", "outTokens", "calls", "heldOut", "tokS"];
export const DEFAULT_METRIC: Metric = "minutes";

/** A story run's value on a metric, or why it has none. Held-out is the share of its own tests passing. */
export function metricValue(story: Story, metric: Metric): { value: number | null; missing: string | null } {
  const u = story.usage;
  const need = (v: number | null | undefined, why: string) => (v == null ? { value: null, missing: why } : { value: v, missing: null });
  if (metric === "heldOut") {
    return story.ownTotal ? { value: (story.ownPassed ?? 0) / story.ownTotal, missing: null }
      : { value: null, missing: "its own held-out tests weren't recorded" };
  }
  if (!u) return { value: null, missing: "no usage recorded for this story yet" };
  switch (metric) {
    case "minutes": return need(u.agentSeconds == null ? null : u.agentSeconds / SECONDS_PER_MINUTE, "its agent time wasn't recorded");
    case "outTokens": return need(u.outTokens, "its output tokens weren't recorded");
    case "calls": return need(u.calls, "its tool calls weren't recorded (a cloud client counts them only at the end)");
    case "tokS": return need(u.tokS, "its speed wasn't recorded");
  }
}

// ---------- rows and columns ----------

/** Finished first, then running and queued, then the rest; within each, by run id in natural order. */
const STATUS_RANK: Record<string, number> = { finished: 0, running: 1, queued: 2, failed: 3, stopped: 4, cancelled: 5, unknown: 6 };
export function runOrder(runs: Row[]): Row[] {
  return runs.toSorted((a, b) => (STATUS_RANK[a.status] ?? STATUS_RANK.unknown) - (STATUS_RANK[b.status] ?? STATUS_RANK.unknown)
    || a.runId.localeCompare(b.runId, undefined, { numeric: true }));
}

/** Every story in the pack that any of the runs has in scope or recorded, in story order. */
export function storyIds(runs: Row[]): string[] {
  const ids = new Set<string>();
  for (const r of runs) {
    for (const q of r.storiesWorking.squares) ids.add(String(Number(q.id)));
    for (const s of r.stories) ids.add(String(Number(s.id)));
  }
  return [...ids].toSorted((a, b) => Number(a) - Number(b));
}

/** The story a running run is building now, if any. */
export function buildingStory(run: Row): string | null {
  if (run.status !== "running" || !run.live) return null;
  const id = run.live.currentStory || run.live.runningStory;
  return id ? String(Number(id)) : null;
}

export type CellState = "recorded" | "building" | "absent";
export type HeldOutState = "ok" | "part" | "bad" | "none" | "running" | "unbuilt";

export interface Cell {
  storyId: string;
  state: CellState;
  story: Story | null;
  value: number | null;
  /** Why value is null, for the "—" hover. */
  missing: string | null;
  heldOut: HeldOutState;
}

export function heldOutState(story: Story | null, building: boolean): HeldOutState {
  if (building) return "running";
  if (!story) return "unbuilt";
  if (!story.ownTotal) return "none";
  return story.ownPassed === story.ownTotal ? "ok" : story.ownPassed ? "part" : "bad";
}

/** One story run: recorded (a value, or "—" and why), being built now, or not built (absent: an empty cell). */
export function cellOf(run: Row, storyId: string, metric: Metric): Cell {
  const story = run.stories.find((s) => String(Number(s.id)) === storyId) ?? null;
  if (story) return { storyId, state: "recorded", story, ...metricValue(story, metric), heldOut: heldOutState(story, false) };
  if (buildingStory(run) === storyId) return { storyId, state: "building", story: null, value: null, missing: "being built now", heldOut: "running" };
  return { storyId, state: "absent", story: null, value: null, missing: "not built", heldOut: "unbuilt" };
}

// ---------- medians and divergence ----------

/** Flag a story run more than this far from its story's median (the owner's rule). Exactly 10% is not flagged. */
export const DIVERGENCE = 0.1;
/** A median of one run is that run: there is nothing to differ from until at least two finished runs have the story. */
export const MIN_RUNS_FOR_MEDIAN = 2;
/** Floating point puts 110 ÷ 100 − 1 at 0.10000000000000009: exactly 10% must not be flagged. */
const FLOAT_TOLERANCE = 1e-9;

export interface StoryMedian { median: number; n: number }

/** Per story, the median over the finished runs that have a value for it. */
export function storyMedians(runs: Row[], ids: string[], metric: Metric): Map<string, StoryMedian | null> {
  const finished = runs.filter((r) => r.status === "finished");
  return new Map(ids.map((id) => {
    const xs = finished.map((r) => cellOf(r, id, metric).value).filter((x): x is number => x !== null);
    const m = median(xs);
    return [id, m === null ? null : { median: m, n: xs.length }];
  }));
}

export interface Divergence { direction: "above" | "below"; /** value ÷ median − 1; Infinity over a median of 0. */ by: number }

/** How far a value is from its median, when more than DIVERGENCE; null when within it, or with too few runs. */
export function divergence(value: number | null, m: StoryMedian | null): Divergence | null {
  if (value === null || !m || m.n < MIN_RUNS_FOR_MEDIAN) return null;
  if (m.median === 0) return value === 0 ? null : { direction: value > 0 ? "above" : "below", by: value > 0 ? Infinity : -Infinity };
  const by = value / m.median - 1;
  return Math.abs(by) > DIVERGENCE + FLOAT_TOLERANCE ? { direction: by > 0 ? "above" : "below", by } : null;
}

// ---------- mechanism ----------
// Why a story run differs from the same story's other runs in this combination, from counts alone. Each rule
// compares the story run with the median of the others, because what is normal differs by combination: a 20k
// thinking block is ordinary for one model and abnormal for another (30 Sep backfill: median largest block 10.6k
// for gufo, 30.5k for Swift 1.5, 38.9k for mlx-serve). Only a hung command is judged on its own.

export type Mechanism = "hung command" | "restarted" | "verbose thinking" | "many small steps" | "compaction-heavy" | "slower generation" | "unexplained" | "not recorded";

/** When several rules fire, the first here wins. Independent time sinks come first (a hung command, a restart:
 * nothing else explains them); then root causes before their consequences: long thinking and many steps both
 * grow the context, which brings compactions and slower generation. */
export const MECHANISM_PRECEDENCE: Mechanism[] = ["hung command", "restarted", "verbose thinking", "many small steps", "compaction-heavy", "slower generation"];

/** Verbose thinking: thinking per call, the thinking after the largest block, or the largest block itself, at least this
 * many times the other runs' median for the story. */
export const THINKING_RATIO = 2;
/** Many small steps: model calls at least this many times the others' median… */
export const MANY_CALLS_RATIO = 1.5;
/** …with thinking per call within this factor of theirs (either way): more steps, not bigger ones. */
export const NEAR_RATIO = 1.5;
/** Hung command: one tool call of at least this long (abnormal on any machine; the recorded "hung-command" signal)… */
export const HUNG_COMMAND_SECONDS = 600;
/** …or taking at least this share of the story's wall time. */
export const HUNG_TOOL_SHARE = 0.4;
/** Compaction-heavy and restarted: that part of the time at least this share of the story's wall… */
export const TIME_SHARE = 0.2;
/** …and at least this many times the others' median share (any share, over a median of 0). */
export const SHARE_RATIO = 2;
/** Slower generation: decode tok/s at most this fraction of the others' median. */
export const SLOWER_DECODE_RATIO = 0.75;

export interface Fired { label: Mechanism; evidence: string }
export interface MechanismResult { label: Mechanism; /** Every rule that fired, in precedence order. */ fired: Fired[]; /** Why this label, with the numbers. */ evidence: string }

const perCall = (c: ConversationProfile) => (c.calls > 0 ? c.thinkingChars / c.calls : 0);
const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (x: number) => `${x.toFixed(1)}×`;
const medianOf = <T>(xs: T[], f: (x: T) => number | null | undefined) => median(xs.map(f).filter((x): x is number => x != null));
const share = (split: TimeSplit | null | undefined, part: "compaction" | "betweenSessions") => (split && split.wall > 0 ? split[part] / split.wall : null);

/** Is `x` at least `ratio` times `m`? Over a median of 0, any positive x is. */
const atLeast = (x: number, m: number, ratio: number) => (m === 0 ? x > 0 : x / m >= ratio);

/** The mechanism for one story run against the same story's other runs of the combination. */
export function classifyMechanism(target: Story, others: Story[]): MechanismResult {
  const c = target.conversation ?? null;
  const u: Usage | null = target.usage ?? null;
  if (!c && !u) return { label: "not recorded", fired: [], evidence: "Nothing was recorded for this story run: no usage and no conversation profile." };
  const oc = others.map((o) => o.conversation).filter((x): x is ConversationProfile => !!x);
  const ou = others.map((o) => o.usage).filter((x): x is Usage => !!x);
  const fired: Fired[] = [];

  if (c?.longestTool) {
    const wall = u?.split?.wall ?? u?.agentSeconds ?? null;
    const sh = wall ? c.longestTool.seconds / wall : null;
    if (c.longestTool.seconds >= HUNG_COMMAND_SECONDS || (sh !== null && sh >= HUNG_TOOL_SHARE)) {
      fired.push({ label: "hung command", evidence: `one ${c.longestTool.name} call ran ${fmt(c.longestTool.seconds)} s${sh !== null ? ` (${pct(sh)} of the story)` : ""}: ${toolGist(c.longestTool.gist)}` });
    }
  }

  const between = share(u?.split, "betweenSessions");
  const betweenMedian = medianOf(ou, (o) => share(o.split, "betweenSessions"));
  if (between !== null && betweenMedian !== null && between >= TIME_SHARE && atLeast(between, betweenMedian, SHARE_RATIO)) {
    fired.push({ label: "restarted", evidence: `${pct(between)} of the story between agent sessions, against ${pct(betweenMedian)} in the other runs` });
  }

  if (c && oc.length) {
    const tpc = perCall(c), tpcM = median(oc.map(perCall))!;
    const parts: string[] = [];
    if (atLeast(tpc, tpcM, THINKING_RATIO)) parts.push(`thinking per call ${fmt(tpc)} chars against ${fmt(tpcM)} (${tpcM ? times(tpc / tpcM) : "from 0"})`);
    const after = c.thinkingMedianAfter, afterM = medianOf(oc, (o) => o.thinkingMedianAfter);
    if (after != null && afterM !== null && atLeast(after, afterM, THINKING_RATIO)) parts.push(`after its largest block, ${fmt(after)} chars per call against ${fmt(afterM)} (${afterM ? times(after / afterM) : "from 0"})`);
    const big = c.largestThinking?.chars, bigM = medianOf(oc, (o) => o.largestThinking?.chars);
    if (big != null && bigM !== null && atLeast(big, bigM, THINKING_RATIO)) parts.push(`largest thinking block ${fmt(big)} chars against ${fmt(bigM)} (${bigM ? times(big / bigM) : "from 0"})`);
    if (parts.length) fired.push({ label: "verbose thinking", evidence: parts.join("; ") });

    const callsM = median(oc.map((o) => o.calls))!;
    const nearThinking = tpcM === 0 ? tpc === 0 : tpc / tpcM <= NEAR_RATIO && tpcM / Math.max(tpc, Number.EPSILON) <= NEAR_RATIO;
    if (atLeast(c.calls, callsM, MANY_CALLS_RATIO) && nearThinking) {
      fired.push({ label: "many small steps", evidence: `${fmt(c.calls)} model calls against ${fmt(callsM)} (${callsM ? times(c.calls / callsM) : "from 0"}), at ${fmt(tpc)} chars of thinking per call against ${fmt(tpcM)}` });
    }
  }

  const comp = share(u?.split, "compaction");
  const compM = medianOf(ou, (o) => share(o.split, "compaction"));
  if (comp !== null && compM !== null && comp >= TIME_SHARE && atLeast(comp, compM, SHARE_RATIO)) {
    fired.push({ label: "compaction-heavy", evidence: `${pct(comp)} of the story compacting (${u?.compactions ?? "?"} compactions), against ${pct(compM)} in the other runs` });
  }

  const dec = u?.decodeTokS ?? null, decM = medianOf(ou, (o) => o.decodeTokS);
  if (dec !== null && decM !== null && decM > 0 && dec / decM <= SLOWER_DECODE_RATIO) {
    fired.push({ label: "slower generation", evidence: `decode ${dec.toFixed(1)} tok/s against ${decM.toFixed(1)} (${pct(dec / decM)})` });
  }

  const ordered = MECHANISM_PRECEDENCE.flatMap((m) => fired.filter((f) => f.label === m));
  if (ordered.length) return { label: ordered[0].label, fired: ordered, evidence: ordered[0].evidence };
  if (!c) return { label: "not recorded", fired: [], evidence: "No conversation profile for this story run, and nothing in its usage explains it." };
  if (!oc.length) return { label: "unexplained", fired: [], evidence: "No other run of this story has a conversation profile to compare with." };
  // The rules look only for more (time sinks, more thinking, more steps): say which didn't fire, never that the counts
  // were near the others', which a run far below them would contradict.
  return { label: "unexplained", fired: [], evidence: `None of the rules fired: no hung command or restart, and not at least ${THINKING_RATIO}× the thinking, ${MANY_CALLS_RATIO}× the model calls, a compaction-heavy story or slower generation, against the other runs.` };
}

/** The same story in the combination's other runs: what a story run is compared with. */
export function siblings(runs: Row[], run: Row, storyId: string): Story[] {
  return runs.filter((r) => r !== run).map((r) => cellOf(r, storyId, DEFAULT_METRIC).story).filter((s): s is Story => !!s);
}

// ---------- the matrix ----------

export interface MatrixCell extends Cell { divergence: Divergence | null; mechanism: MechanismResult | null }
export interface MatrixRow { run: Row; cells: MatrixCell[] }
export interface Matrix { stories: string[]; rows: MatrixRow[]; medians: Map<string, StoryMedian | null> }

/** Runs × stories on one metric, each cell with its divergence from the story's median and, when flagged, its mechanism. */
export function buildMatrix(runs: Row[], metric: Metric): Matrix {
  const stories = storyIds(runs);
  const medians = storyMedians(runs, stories, metric);
  const rows = runOrder(runs).map((run) => ({
    run,
    cells: stories.map((id): MatrixCell => {
      const cell = cellOf(run, id, metric);
      const d = cell.state === "recorded" ? divergence(cell.value, medians.get(id) ?? null) : null;
      return { ...cell, divergence: d, mechanism: d && cell.story ? classifyMechanism(cell.story, siblings(runs, run, id)) : null };
    }),
  }));
  return { stories, rows, medians };
}

export interface TallyLine { label: Mechanism; count: number }

/** How many flagged story runs each mechanism explains, in precedence order, out of every story run with a value. */
export function tally(m: Matrix): { lines: TallyLine[]; flagged: number; storyRuns: number } {
  const cells = m.rows.flatMap((r) => r.cells).filter((c) => c.state === "recorded" && c.value !== null);
  const flagged = cells.filter((c) => c.mechanism);
  const order: Mechanism[] = [...MECHANISM_PRECEDENCE, "unexplained", "not recorded"];
  const lines = order.map((label) => ({ label, count: flagged.filter((c) => c.mechanism!.label === label).length })).filter((l) => l.count > 0);
  return { lines, flagged: flagged.length, storyRuns: cells.length };
}

/** A run's total on the metric: summed for minutes, tokens and calls; stories passing for held-out; its rate for tok/s. */
export function runTotal(run: Row, metric: Metric): number | null {
  const vals = run.stories.map((s) => metricValue(s, metric).value).filter((x): x is number => x !== null);
  if (metric === "tokS") return run.usage.tokS;
  if (metric === "heldOut") return vals.length ? vals.filter((v) => v === 1).length : null;
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

// ---------- where the time went, per run ----------

export const SPLIT_PARTS = ["prefill", "decode", "modelUnsplit", "compaction", "tools", "betweenSessions", "other"] as const;
export type SplitPart = (typeof SPLIT_PARTS)[number];

export interface RunSplit {
  wall: number;
  parts: Record<SplitPart, number>;
  /** Stories whose split is summed, and the recorded stories without one. */
  stories: number;
  withoutSplit: number;
}

/** A run's time split summed over its recorded stories; null if none has one. */
export function runSplit(run: Row): RunSplit | null {
  const with_ = run.stories.filter((s) => s.usage?.split);
  if (!with_.length) return null;
  const parts = Object.fromEntries(SPLIT_PARTS.map((p) => [p, 0])) as Record<SplitPart, number>;
  let wall = 0;
  for (const s of with_) {
    const sp = s.usage!.split!;
    wall += sp.wall;
    for (const p of SPLIT_PARTS) parts[p] += sp[p] ?? 0;
  }
  return { wall, parts, stories: with_.length, withoutSplit: run.stories.length - with_.length };
}

// ---------- names ----------

/** Each mechanism's glossary entry: its definition, for the hover. */
export const MECHANISM_TERM: Record<Mechanism, TermId> = {
  "hung command": "mechHungCommand", restarted: "mechRestarted", "verbose thinking": "mechVerboseThinking", "many small steps": "mechManySmallSteps",
  "compaction-heavy": "mechCompactionHeavy", "slower generation": "mechSlowerGeneration", unexplained: "mechUnexplained", "not recorded": "mechNotRecorded",
};

/** Folders under combinations/ are vendor/model/size/os/hardware/engine-client: the model is all but the last three.
 * Anything shorter (reference/opus-5.5) is its own model. */
const COMBINATION_DEPTH = 6;
const PER_MODEL_PARTS = 3;
export function modelOf(stack: string): string {
  const parts = stack.split("/");
  return parts.length >= COMBINATION_DEPTH ? parts.slice(0, parts.length - PER_MODEL_PARTS).join("/") : stack;
}
