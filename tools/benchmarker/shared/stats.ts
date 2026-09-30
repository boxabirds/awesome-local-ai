import type { Row, Score } from "./types.ts";

const SECONDS_PER_HOUR = 3600;

export interface ComboStats {
  runs: number;
  /** Agent hours per recorded story, over the runs shown. */
  hoursPerStory: number | null;
  /** Held-out tests passing over all held-out tests of every built story of every run shown (each run's latest build). */
  quality: number | null;
}

/** A combination's headline numbers over the runs the filters show. */
export function comboStats(rows: Row[]): ComboStats {
  const secs = rows.flatMap((r) => r.stories.map((s) => s.usage?.agentSeconds).filter((x): x is number => x != null));
  const squares = rows.flatMap((r) => r.storiesWorking.squares).filter((q) => q.total);
  const total = squares.reduce((t, q) => t + (q.total ?? 0), 0);
  return {
    runs: rows.length,
    hoursPerStory: secs.length ? secs.reduce((a, b) => a + b, 0) / SECONDS_PER_HOUR / secs.length : null,
    quality: total ? squares.reduce((t, q) => t + (q.passed ?? 0), 0) / total : null,
  };
}

/** A run's score of record: the re-score under its current suite, else its latest re-score. */
export function scoreOf(row: Row): [string, Score] | null {
  const all = Object.entries(row.scores);
  return all.find(([v]) => v === row.suite) ?? all.toSorted(([a], [b]) => b.localeCompare(a))[0] ?? null;
}

export interface Combination {
  stack: string;
  label: string;
  machines: string[];
  byStatus: Record<string, number>;
  stats: ComboStats;
  /** Output tokens over the stories' time, over all its recorded stories. */
  tokS: number | null;
  callsPerStory: number | null;
  readPerStory: number | null;
  /** Mean score of record over the runs that have one (n of them). */
  score: { mean: number; total: number | null; n: number } | null;
}

/** One summary per combination over the runs given, whichever machines they ran on. */
export function combinations(rows: Row[]): Combination[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.stack, [...(by.get(r.stack) ?? []), r]);
  return [...by.entries()].map(([stack, rs]) => {
    const us = rs.flatMap((r) => r.stories.map((s) => s.usage).filter((u) => !!u));
    const sum = (f: (u: NonNullable<(typeof us)[number]>) => number | null | undefined) => us.reduce((t, u) => t + (f(u!) ?? 0), 0);
    const secs = sum((u) => u.agentSeconds);
    const scores = rs.map(scoreOf).filter((x): x is [string, Score] => !!x && x[1].passed !== null);
    const byStatus: Record<string, number> = {};
    for (const r of rs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      stack, label: rs[0].label, machines: [...new Set(rs.map((r) => r.machine))].toSorted(), byStatus, stats: comboStats(rs),
      tokS: secs > 0 ? sum((u) => u.outTokens) / secs : null,
      callsPerStory: us.length ? sum((u) => u.calls) / us.length : null,
      readPerStory: us.length ? sum((u) => u.readTokens) / us.length : null,
      score: scores.length ? { mean: scores.reduce((t, [, x]) => t + x.passed!, 0) / scores.length, total: scores[0][1].total, n: scores.length } : null,
    };
  });
}
