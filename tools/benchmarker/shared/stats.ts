import type { Row } from "./types.ts";

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
