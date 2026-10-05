// What the overview dashboard shows, worked out from the state: pure functions, tested once here, laid out by the
// components. Everything is measured from the runs and the schedule: how long a stack's run takes is the median of its
// finished runs, never a guess; an item that cannot be worked out says so ("no estimate yet") and is not drawn.
//
// Observations are facts about the work, found in the data of normal operation. A bug in the app, the harness or the
// pipeline is not one and never appears here (CLAUDE.md, "The app shows results, never its own faults").
import type { JobRef, Row } from "./types.ts";
import { closeCalls, INDISTINGUISHABLE_TESTS, isComplete, median, rankCombinations, scoreOfRecord, seriesPrefix, SMALL_N } from "./stats.ts";
import { SILENT_MINUTES, type NowLine } from "./overviewView.ts";
import { runOrder } from "./runGroups.ts";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;

/** A story is slow when it took this many times the median of the same story in the stack's other runs ... */
export const SLOW_RATIO = 2;
/** ... of at least this many runs ... */
export const SLOW_MIN_RUNS = 3;
/** A queue that will run dry within this many hours is worth saying; a longer one is on the machine's card. */
export const QUEUE_SHORT_HOURS = 24;

/** ... and it has taken at least this long: a two-minute story at twice its median is not news. */
export const SLOW_MIN_MINUTES = 20;

// ---------- how long a run takes ----------

const agentSeconds = (r: Pick<Row, "stories">) => r.stories.reduce((t, s) => t + (s.usage?.agentSeconds ?? 0), 0);
const sameStack = (a: Row, pack: string, family: string, stack: string) => a.pack === pack && a.family === family && a.stack === stack;

export interface RunDuration { median: number; n: number; min: number; max: number }

/** The agent time of the complete runs of a stack (its finished runs with every story recorded and a score of record):
 * the median, how many runs that is, and the lowest and highest. Null when there is none. */
export function medianRunSeconds(rows: Row[], pack: string, family: string, stack: string): RunDuration | null {
  const secs = rows.filter((r) => sameStack(r, pack, family, stack) && isComplete(r)).map(agentSeconds);
  const m = median(secs);
  return m === null ? null : { median: m, n: secs.length, min: Math.min(...secs), max: Math.max(...secs) };
}

export interface QueueDrain {
  /** Seconds of work still to do on the machine: the running run's remainder and a median run for each queued one. */
  seconds: number;
  /** Queued or running runs of a stack with no finished run: not in `seconds`, and not guessed. */
  unknown: number;
  basis: { stack: string; n: number; median: number }[];
}

/** How long the machine's work will take, from the measured run times of the stacks it holds. */
export function queueDrain(machine: string, rows: Row[], _now: number): QueueDrain {
  const mine = rows.filter((r) => r.node === machine && r.live);
  const basis = new Map<string, { stack: string; n: number; median: number }>();
  let seconds = 0, unknown = 0;
  const durationOf = (r: Row) => {
    const d = medianRunSeconds(rows, r.pack, r.family, r.stack);
    if (d) basis.set(r.stack, { stack: r.stack, n: d.n, median: d.median });
    return d;
  };
  for (const r of mine.filter((x) => x.live!.status === "running")) {
    const d = durationOf(r);
    if (!d) { unknown += 1; continue; }
    const elapsed = agentSeconds(r) + (r.live!.agentMinutes ?? 0) * SECONDS_PER_MINUTE;
    seconds += Math.max(0, d.median - elapsed);
  }
  for (const r of mine.filter((x) => x.live!.status === "queued")) {
    const d = durationOf(r);
    if (d) seconds += d.median; else unknown += 1;
  }
  return { seconds, unknown, basis: [...basis.values()] };
}

// ---------- a series: the runs of one stack made together ----------

export type SeriesState = "finished" | "running" | "queued";
export interface SeriesRun {
  runId: string;
  state: SeriesState;
  /** The score of record when finished and scored. */
  score: number | null;
  total: number | null;
  /** Stories recorded out of those in scope. */
  stories: { done: number; scope: number };
}
export interface SeriesScore { median: number; min: number; max: number; total: number | null; n: number }
export interface Series { stack: string; label: string; machine: string; prefix: string; runs: SeriesRun[]; size: number; done: number; active: boolean;
  /** The median, lowest and highest score of record over the finished runs; null while none is scored. */
  score: SeriesScore | null }


/** Runs named `<prefix>-rN` of one stack are one series. Cancelled, failed and stopped runs are not in it, and neither
 * are partial reruns. A series with work in hand comes first. */
export function seriesOf(rows: Row[]): Series[] {
  const states: Record<string, SeriesState | undefined> = { finished: "finished", running: "running", queued: "queued" };
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.knownGood || !states[r.status]) continue;
    const key = `${r.pack}|${r.stack}|${seriesPrefix(r.runId)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const all = [...groups.values()].map((rs): Series => {
    const ordered = rs.toSorted((a, b) => a.runId.localeCompare(b.runId, undefined, { numeric: true }));
    const runs = ordered.map((r): SeriesRun => {
      const s = r.status === "finished" ? scoreOfRecord(r) : null;
      return { runId: r.runId, state: states[r.status]!, score: s?.passed ?? null, total: s?.total ?? null, stories: { done: r.stories.length, scope: r.storiesWorking.scope } };
    });
    const scores = runs.map((r) => r.score).filter((x): x is number => x !== null);
    const m = median(scores);
    const score = m === null ? null : { median: m, min: Math.min(...scores), max: Math.max(...scores), total: runs.find((r) => r.total !== null)?.total ?? null, n: scores.length };
    return { stack: rs[0].stack, label: rs[0].label, machine: rs[0].machine, prefix: seriesPrefix(rs[0].runId), runs, size: runs.length, done: runs.filter((r) => r.state === "finished").length, active: runs.some((r) => r.state !== "finished"), score };
  });
  return all.toSorted((a, b) => Number(b.active) - Number(a.active) || b.prefix.localeCompare(a.prefix, undefined, { numeric: true }));
}

// ---------- the utilisation timeline: what each machine ran, and the gaps ----------

/** One run on a machine's lane. `from` is when the machine can first have been running it: a job queued while the
 * one before it was still going cannot have started until that one ended. */
export interface UtilisationSegment {
  runId: string;
  stack: string;
  label: string;
  pack: string;
  /** Unix seconds, clipped to the window. */
  from: number;
  to: number;
  /** Still going: it runs to the right-hand edge. */
  running: boolean;
}

export interface UtilisationLane {
  machine: string;
  segments: UtilisationSegment[];
  /** How much of the window the machine was running something, in seconds. */
  busySeconds: number;
}

export interface Utilisation { from: number; to: number; lanes: UtilisationLane[] }

/** What each machine ran over the last `windowSeconds`, busiest machine first. A machine runs one job at a time, so
 * a job's own stretch begins when the one before it ended, never when it was merely queued: the space left over is
 * the machine standing idle, which is the point of the picture. A machine that ran nothing has no lane. */
export function utilisation(rows: Row[], now: number, windowSeconds: number): Utilisation {
  const from = now - windowSeconds;
  const byMachine = new Map<string, { row: Row; job: JobRef }[]>();
  for (const r of rows) {
    for (const j of r.jobs ?? []) {
      if (j.submittedAt === null) continue;
      const node = j.node || r.machine;
      if (!node) continue;
      byMachine.set(node, [...(byMachine.get(node) ?? []), { row: r, job: j }]);
    }
  }
  const lanes: UtilisationLane[] = [];
  for (const [machine, jobs] of byMachine) {
    const ordered = jobs.toSorted((a, b) => (a.job.submittedAt ?? 0) - (b.job.submittedAt ?? 0));
    const segments: UtilisationSegment[] = [];
    let free = 0;                    // when the machine was last free: a queued job cannot have started before this
    for (const { row, job } of ordered) {
      const running = job.endedAt === null;
      const start = Math.max(job.submittedAt!, free);
      const end = running ? now : job.endedAt!;
      if (end > start) free = end;
      if (end <= from || end <= start) continue;             // wholly before the window, or no time on the machine
      segments.push({
        runId: row.runId, stack: row.stack, label: row.label, pack: row.pack,
        from: Math.max(start, from), to: Math.min(end, now), running,
      });
    }
    if (segments.length) {
      lanes.push({ machine, segments, busySeconds: segments.reduce((t, s) => t + (s.to - s.from), 0) });
    }
  }
  return { from, to: now, lanes: lanes.toSorted((a, b) => b.busySeconds - a.busySeconds || a.machine.localeCompare(b.machine)) };
}

// ---------- a story far slower than the stack's others ----------

export interface SlowStory { pack: string; stack: string; machine: string; runId: string; story: string; seconds: number; medianSeconds: number; n: number; ratio: number }

/** Recorded stories of runs in progress that took SLOW_RATIO times the median of the same story in the stack's other
 * complete runs (at least SLOW_MIN_RUNS of them), and at least SLOW_MIN_MINUTES. */
export function slowStories(rows: Row[]): SlowStory[] {
  const out: SlowStory[] = [];
  for (const r of rows.filter((x) => x.status === "running")) {
    const others = rows.filter((o) => sameStack(o, r.pack, r.family, r.stack) && o.runId !== r.runId && isComplete(o));
    for (const s of r.stories) {
      const secs = s.usage?.agentSeconds;
      if (secs == null || secs < SLOW_MIN_MINUTES * SECONDS_PER_MINUTE) continue;
      const peers = others.map((o) => o.stories.find((x) => x.id === s.id)?.usage?.agentSeconds).filter((x): x is number => x != null);
      const m = median(peers);
      if (m === null || peers.length < SLOW_MIN_RUNS || secs < SLOW_RATIO * m) continue;
      out.push({ pack: r.pack, stack: r.stack, machine: r.machine, runId: r.runId, story: s.id, seconds: secs, medianSeconds: m, n: peers.length, ratio: secs / m });
    }
  }
  return out;
}

// ---------- observations ----------

export type ObservationKind = "unreachable" | "silent" | "idle" | "slow" | "queue";
export interface Observation {
  kind: ObservationKind;
  machine: string;
  text: string;
  /** What the observation links to: the run's story page when it is about one, else the machine. */
  run?: { pack: string; stack: string; runId: string; story?: string };
}
const KIND_ORDER: ObservationKind[] = ["unreachable", "silent", "idle", "slow", "queue"];

/** "2h00m" or "30 min": a duration as a person reads it. */
export function span(seconds: number): string {
  const min = Math.round(seconds / SECONDS_PER_MINUTE);
  if (min < MINUTES_PER_HOUR) return `${min} min`;
  return `${Math.floor(min / MINUTES_PER_HOUR)}h${String(min % MINUTES_PER_HOUR).padStart(2, "0")}m`;
}

/** Facts about the work, most actionable first: a machine that cannot be reached, a run that has gone quiet, idle
 * capacity, a story far slower than the stack's, and how much work a queue holds. Each states what was measured and
 * against what, never a cause or an instruction. */
export function observations(lines: NowLine[], rows: Row[], now: number): Observation[] {
  const out: Observation[] = [];
  for (const l of lines) {
    if (l.state === "unreachable") out.push({ kind: "unreachable", machine: l.machine, text: `${l.machine}: not reachable` });
    if (l.silent !== null && l.silent >= SILENT_MINUTES) out.push({ kind: "silent", machine: l.machine, text: `${l.machine}: no activity for ${Math.round(l.silent)} min`, run: l.run ?? undefined });
    if (l.state === "idle") out.push({ kind: "idle", machine: l.machine, text: `${l.machine}: idle, nothing queued` });
  }
  // One line per run, for its slowest story: a run with several slow stories is still one thing to look at.
  const slow = slowStories(rows);
  for (const runId of new Set(slow.map((s) => `${s.pack}|${s.stack}|${s.runId}`))) {
    const mine = slow.filter((s) => `${s.pack}|${s.stack}|${s.runId}` === runId).toSorted((a, b) => b.ratio - a.ratio);
    const s = mine[0];
    out.push({ kind: "slow", machine: s.machine, run: { pack: s.pack, stack: s.stack, runId: s.runId, story: s.story },
      text: `${s.runId} story ${s.story}: ${span(s.seconds)}, ${s.ratio.toFixed(1)} times the ${span(s.medianSeconds)} median of ${s.n} runs${mine.length > 1 ? `; ${mine.length - 1} more ${mine.length === 2 ? "story" : "stories"} this slow` : ""}` });
  }
  for (const l of lines.filter((x) => x.queued > 0)) {
    const d = queueDrain(l.machine, rows, now);
    if (!d.basis.length || d.seconds > QUEUE_SHORT_HOURS * SECONDS_PER_HOUR) continue;
    const n = Math.min(...d.basis.map((b) => b.n));
    out.push({ kind: "queue", machine: l.machine,
      text: `${l.machine}: ${l.queued} queued, about ${Math.round(d.seconds / SECONDS_PER_HOUR)} h of work (median of ${n} finished runs)${d.unknown ? `, and ${d.unknown} with no estimate yet` : ""}` });
  }
  return out.toSorted((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.machine.localeCompare(b.machine, undefined, { numeric: true }));
}

// ---------- the score plot ----------

export interface ScorePlotRow { stack: string; label: string; pack: string; machines: string[]; dots: number[]; median: number; min: number; max: number; n: number }
export interface ScorePlot {
  total: number | null;
  rows: ScorePlotRow[];
  /** Where the scale starts: the tens below the lowest ordinary dot (0 when the scores are low). */
  axisMin: number;
  /** Runs far below the rest: drawn pinned at the left edge, so one bad run doesn't squash everyone else. */
  offScale: { stack: string; label: string; value: number }[];
  /** Neighbours the runs so far can't separate (the small-n rule), each chain of them one group, best first. */
  groups: string[][];
  /** The chart in plain English, one sentence each. */
  narrative: string[];
}

/** A dot below this share of the middle score of all dots is off the scale. */
export const OFF_SCALE_SHARE = 0.6;
const SCALE_STEP = 10;
const REFERENCE_PREFIX = "reference/";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const score = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const joined = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** One row per combination with a score of record, best median first: a dot per run, the median and the range. */
export function scorePlot(rows: Row[]): ScorePlot {
  const ranked = rankCombinations(rows).filter((c) => c.score);
  if (!ranked.length) return { total: null, rows: [], axisMin: 0, offScale: [], groups: [], narrative: [] };
  const total = ranked.map((c) => c.score!.total).find((t): t is number => t !== null) ?? null;
  const plot: ScorePlotRow[] = ranked.map((c) => ({
    stack: c.stack, label: c.label, pack: c.pack, machines: c.machines,
    dots: c.ofRecord.map((r) => scoreOfRecord(r)!.passed!).toSorted((a, b) => a - b),
    median: c.score!.median, min: c.score!.min, max: c.score!.max, n: c.score!.n,
  }));
  const all = plot.flatMap((r) => r.dots);
  const cut = OFF_SCALE_SHARE * (median(all) ?? 0);
  const ordinary = all.filter((v) => v >= cut);
  const axisMin = Math.floor(Math.min(...(ordinary.length ? ordinary : all)) / SCALE_STEP) * SCALE_STEP;
  const offScale = plot.flatMap((r) => r.dots.filter((v) => v < cut).map((value) => ({ stack: r.stack, label: r.label, value })));
  const groups: string[][] = [];
  for (const [a, b] of closeCalls(ranked)) {
    const last = groups.at(-1);
    if (last && last.at(-1) === a.stack) last.push(b.stack); else groups.push([a.stack, b.stack]);
  }
  const label = (stack: string) => plot.find((r) => r.stack === stack)!.label;
  const top = plot[0], local = plot.find((r) => !r.stack.startsWith(REFERENCE_PREFIX));
  const said = (r: ScorePlotRow) => `${r.label}, ${score(r.median)} of ${total} in the middle, over ${plural(r.n, "run")}.`;
  const narrative = [
    `Each dot is one finished run: how many of the ${total} hidden tests it passed. The black bar is the middle run; the grey line runs from the lowest to the highest. Further right is better.`,
    `Highest: ${said(top)}`,
    ...(local && local !== top ? [`Best of the local stacks: ${said(local)}`] : []),
    ...groups.map((g) => `${joined(g.map(label))} are within ${INDISTINGUISHABLE_TESTS} tests of each other, and each has ${SMALL_N} runs or fewer, so with the runs so far their order could change.`),
    ...offScale.map((o) => `One run of ${o.label} scored ${score(o.value)}, off the left edge of the scale.`),
    ...(axisMin > 0 ? [`The scale starts at ${axisMin}, not 0, so the differences show.`] : []),
  ];
  return { total, rows: plot, axisMin, offScale, groups, narrative };
}

// The run order in the lists the dashboard draws is the app's one order.
export { runOrder };
