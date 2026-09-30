import type { Row, RunStatus, Score, Usage } from "./types.ts";

const SECONDS_PER_HOUR = 3600;

export interface ComboStats {
  runs: number;
  /** Agent hours per recorded story, over the runs shown. */
  hoursPerStory: number | null;
  /** Held-out tests passing over all held-out tests of every built story of every run shown (each run's latest build). */
  quality: number | null;
}

/** A run its record marks invalid (it saw the reference build, say): shown, but in no figure anywhere. Every figure
 * leaves it out through this one test. A row from an older server has no mark: valid. */
export const isInvalid = (row: Pick<Row, "invalid">): boolean => Boolean(row.invalid);

/** Live progress over the runs the filters show, running ones included: shown labelled "live", and never used to rank.
 * Invalid runs are left out. */
export function comboStats(all: Row[]): ComboStats {
  const rows = all.filter((r) => !isInvalid(r));
  const secs = rows.flatMap((r) => r.stories.map((s) => s.usage?.agentSeconds).filter((x): x is number => x != null));
  const squares = rows.flatMap((r) => r.storiesWorking.squares).filter((q) => q.total);
  const total = squares.reduce((t, q) => t + (q.total ?? 0), 0);
  return {
    runs: rows.length,
    hoursPerStory: secs.length ? secs.reduce((a, b) => a + b, 0) / SECONDS_PER_HOUR / secs.length : null,
    quality: total ? squares.reduce((t, q) => t + (q.passed ?? 0), 0) / total : null,
  };
}

/** A run's score for display: the re-score under its current suite, else its latest re-score under another version.
 * Never for ranking: that falls back across suite versions; rankings use scoreOfRecord. */
export function scoreOf(row: Row): [string, Score] | null {
  const all = Object.entries(row.scores);
  return all.find(([v]) => v === row.suite) ?? all.toSorted(([a], [b]) => b.localeCompare(a))[0] ?? null;
}

// ---------- the ranking: finished runs, scored under their pack's current suite ----------
// Why: pooling every run shown mixed running runs (whose early stories are easier), live scores from older suite
// versions, and a weighting by tests per story, and the order flipped with what was included. A combination is
// ranked only on its finished runs' scores of record; everything else is counted beside it, never folded in.

/** Below this many runs, a difference of INDISTINGUISHABLE_TESTS or fewer can't separate two combinations
 * (the methods review of 30 Sep: run-to-run spread of one combination is about that wide). */
export const SMALL_N = 5;
export const INDISTINGUISHABLE_TESTS = 12;

/** A run's score of record: its finished build re-scored under exactly its pack's current suite. No fallback to
 * another suite version, and none to live scores: a run without one is counted as unscored, never ranked. An invalid
 * run has none, however it was scored. */
export function scoreOfRecord(row: Row): Score | null {
  if (row.status !== "finished" || isInvalid(row)) return null;
  const s = row.scores[row.suite];
  return s && s.passed !== null && s.total !== null ? s : null;
}

/** Where a run stands for the ranking: counted (of record), or why not. Invalid comes before any status. */
export type Standing = "ofRecord" | "unscored" | "invalid" | Exclude<RunStatus, "finished">;
export const NOT_COUNTED_ORDER: Exclude<Standing, "ofRecord">[] = ["running", "queued", "unscored", "invalid", "failed", "stopped", "cancelled", "unknown"];

export function standingOf(row: Row): Standing {
  if (isInvalid(row)) return "invalid";
  if (row.status !== "finished") return row.status;
  return scoreOfRecord(row) ? "ofRecord" : "unscored";
}

/** Why a finished run has no score of record, in words: scored only under other suite versions, or not at all. */
export function unscoredReason(row: Row): string {
  const other = Object.entries(row.scores).filter(([v]) => v !== row.suite).map(([v, s]) => `${s.passed ?? "?"}/${s.total ?? "?"} under ${v}`);
  return other.length ? `re-scored only under another suite version (${other.join(", ")}), not under ${row.suite}` : `not re-scored under ${row.suite} yet`;
}

/** Median, lowest, highest and how many; null for none. An even count takes the mean of the middle two. */
export interface Spread { median: number; min: number; max: number; n: number }

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function spread(xs: number[]): Spread | null {
  const m = median(xs);
  return m === null ? null : { median: m, min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
}

/** A run's own rate per story: the sum of a usage figure over the stories that recorded it, over how many did. */
export function perStory(row: Row, f: (u: Usage) => number | null | undefined): number | null {
  const xs = row.stories.map((s) => (s.usage ? f(s.usage) : null)).filter((x): x is number => x != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** A run's output tokens over the time of the stories that recorded both. */
export function runTokS(row: Row): number | null {
  const us = row.stories.map((s) => s.usage).filter((u): u is Usage => u?.outTokens != null && u.agentSeconds != null && u.agentSeconds > 0);
  const secs = us.reduce((t, u) => t + u.agentSeconds!, 0);
  return secs > 0 ? us.reduce((t, u) => t + u.outTokens!, 0) / secs : null;
}

const spreadOf = (rows: Row[], f: (r: Row) => number | null) => spread(rows.map(f).filter((x): x is number => x !== null));

export interface RankedCombination {
  pack: string;
  stack: string;
  label: string;
  machines: string[];
  byStatus: Partial<Record<RunStatus, number>>;
  /** The runs the numbers are over: finished, with a score of record. */
  ofRecord: Row[];
  /** Every other run, by why it isn't counted. */
  notCounted: Partial<Record<Exclude<Standing, "ofRecord">, number>>;
  /** The runs marked invalid, whatever their status: shown with their reasons, counted in nothing. */
  invalid: Row[];
  /** Score of record over those runs, with the pooled pass rate (sum passed over sum total). */
  score: (Spread & { total: number | null; pooled: number }) | null;
  /** Each a median over the runs of record of that run's own per-story figure. */
  hoursPerStory: Spread | null;
  outPerStory: Spread | null;
  callsPerStory: Spread | null;
  readPerStory: Spread | null;
  tokS: Spread | null;
  /** Why it can't be ranked; null when it is. */
  unranked: string | null;
}

/** One summary per combination in `rows`: numbers over its finished runs of record only. */
export function summarise(stack: string, rs: Row[]): RankedCombination {
  const ofRecord = rs.filter((r) => standingOf(r) === "ofRecord");
  const byStatus: RankedCombination["byStatus"] = {};
  const notCounted: RankedCombination["notCounted"] = {};
  for (const r of rs) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const st = standingOf(r);
    if (st !== "ofRecord") notCounted[st] = (notCounted[st] ?? 0) + 1;
  }
  const scores = ofRecord.map((r) => scoreOfRecord(r)!);
  const s = spread(scores.map((x) => x.passed!));
  const total = scores.reduce((t, x) => t + x.total!, 0);
  const invalid = rs.filter(isInvalid);
  const finished = rs.filter((r) => r.status === "finished" && !isInvalid(r)).length;
  const suite = rs[0]?.suite ?? "";
  return {
    pack: rs[0]?.pack ?? "", stack, label: rs[0]?.label ?? stack, machines: [...new Set(rs.map((r) => r.machine))].toSorted(),
    byStatus, ofRecord, notCounted, invalid,
    score: s ? { ...s, total: new Set(scores.map((x) => x.total)).size === 1 ? scores[0].total : null, pooled: scores.reduce((t, x) => t + x.passed!, 0) / total } : null,
    hoursPerStory: spreadOf(ofRecord, (r) => { const x = perStory(r, (u) => u.agentSeconds); return x === null ? null : x / SECONDS_PER_HOUR; }),
    outPerStory: spreadOf(ofRecord, (r) => perStory(r, (u) => u.outTokens)),
    callsPerStory: spreadOf(ofRecord, (r) => perStory(r, (u) => u.calls)),
    readPerStory: spreadOf(ofRecord, (r) => perStory(r, (u) => u.readTokens)),
    tokS: spreadOf(ofRecord, runTokS),
    unranked: s ? null : finished ? `${finished} finished, none re-scored under ${suite}`
      : invalid.length ? `no valid finished run: ${invalid.length} invalid` : "no finished run yet",
  };
}

/** Ranked: score of record median, highest first; ties by pooled pass rate, then more runs; unranked last. */
export function rankCombinations(rows: Row[]): RankedCombination[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.stack, [...(by.get(r.stack) ?? []), r]);
  return [...by.entries()].map(([stack, rs]) => summarise(stack, rs)).toSorted(compareRanked);
}

export function compareRanked(a: RankedCombination, b: RankedCombination): number {
  if (!a.score || !b.score) return a.score === b.score ? a.label.localeCompare(b.label) : a.score ? -1 : 1;
  return b.score.median - a.score.median || b.score.pooled - a.score.pooled || b.score.n - a.score.n || a.label.localeCompare(b.label);
}

/** True when two ranked combinations can't be told apart: both have few runs and their medians are close. */
export function indistinguishable(a: RankedCombination, b: RankedCombination): boolean {
  if (!a.score || !b.score) return false;
  return a.score.n <= SMALL_N && b.score.n <= SMALL_N && Math.abs(a.score.median - b.score.median) <= INDISTINGUISHABLE_TESTS;
}

/** Neighbours in the ranking that small n can't separate. */
export function closeCalls(ranked: RankedCombination[]): [RankedCombination, RankedCombination][] {
  const scored = ranked.filter((c) => c.score);
  return scored.slice(1).map((c, i) => [scored[i], c] as [RankedCombination, RankedCombination]).filter(([a, b]) => indistinguishable(a, b));
}
