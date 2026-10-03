// What the overview and the machine pages show, worked out from the state: pure functions, so every rule (what a
// machine is doing now, how long a running story has been silent, how a machine's history is grouped) is tested
// once here and the components only lay it out (plan sections 4.1 and 4.6).
import type { Machine, Row, RunStatus } from "./types.ts";

export { suiteFamily } from "./stats.ts";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;

/** A running story whose harness has said nothing for this many minutes is stuck.
 *
 * Why this number: while a story runs, the harness rewrites progress.json once a minute (drive.py's
 * ProgressWatcher, PROGRESS_POLL_S = 60), stamping `agent_minutes` = minutes since the story started. dbench
 * re-reads progress.json on every status call and this server asks dbench every 10 s. So "minutes since the story
 * started" less "the agent minutes it last reported" is how long the harness has been silent, and a healthy run is
 * never more than about two minutes behind. Fifteen minutes is fifteen missed refreshes in a row: not a slow poll,
 * but a harness, agent or machine that has stopped reporting. (A story that is only long is not stuck: the
 * watcher keeps writing while the agent works, however slowly.) */
export const SILENT_MINUTES = 15;

/** A failed or stopped run is news for a day after it ended; after that it is history (on its run page). */
export const RECENT_END_S = HOURS_PER_DAY * SECONDS_PER_HOUR;

/** Whether a machine answered the last request, from /api/machines. */
export interface Reach { ok: boolean }
/** Per machine name; null until /api/machines has answered (nothing is then said about reachability). */
export type Reachability = Record<string, Reach> | null;

// ---------- the machine's current story: how long the harness has been silent ----------

/** The story a running job is on, and whether the agent is done with it (its gates and scoring are running). */
export function runningStory(row: Pick<Row, "live">): { story: string | null; finishing: boolean } {
  const l = row.live;
  if (!l || l.status !== "running") return { story: null, finishing: false };
  return { story: l.currentStory || l.runningStory || null, finishing: !l.currentStory && Boolean(l.runningStory) };
}

/** Minutes since the harness last reported on a running story (see SILENT_MINUTES); null when it can't be told:
 * not running, finishing (the watcher stops for the gates), or no start time or agent minutes reported. */
export function silentMinutes(row: Pick<Row, "live">, now: number): number | null {
  const l = row.live;
  if (!l || l.status !== "running" || runningStory(row).finishing) return null;
  if (l.storyStartedAt === null || l.agentMinutes === null) return null;
  return Math.max(0, (now - l.storyStartedAt) / SECONDS_PER_MINUTE - l.agentMinutes);
}

/** A run as a now line names it. */
export interface RunRef { pack: string; stack: string; runId: string; label: string; machine: string }

const ref = (r: Row): RunRef => ({ pack: r.pack, stack: r.stack, runId: r.runId, label: r.label, machine: r.machine });

/** A job's end as dbench recorded it, else its last report. */
const jobEnd = (j: Row["jobs"][number] | undefined): number | null => j?.endedAt ?? j?.updatedAt ?? null;

/** When a run ended, in Unix seconds: the later of its last job's end and its record's time; null if neither. */
export function endedAt(r: Pick<Row, "jobs" | "stateAt">): number | null {
  const job = jobEnd(r.jobs.at(-1));
  const rec = r.stateAt ? Date.parse(r.stateAt) / 1000 : NaN;
  const times = [job, Number.isFinite(rec) ? rec : null].filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

// ---------- now: one line per machine ----------

export type NowState = "running" | "queuedOnly" | "idle" | "unreachable";

export interface NowLine {
  machine: string;
  state: NowState;
  /** The running run, when there is one (found among every run, whatever the header shows); null while running
   * when the machine is busy with a run the page doesn't show. */
  run: RunRef | null;
  story: string | null;
  storyTitle: string | null;
  finishing: boolean;
  /** Agent minutes on the running story, as the harness last reported them. */
  minutes: number | null;
  /** See silentMinutes; null when it can't be told. */
  silent: number | null;
  queued: number;
}

/** One line per machine known or named in the machine list, by name. An unreachable machine says so whatever was
 * last said about it; a machine with a queue and nothing running is not idle (its queue is waiting); one busy with
 * a run the page doesn't show is running, with no run named. */
export function nowLines(machines: Machine[], all: Row[], reach: Reachability, now: number): NowLine[] {
  const names = [...new Set([...machines.map((m) => m.node), ...Object.keys(reach ?? {})])]
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return names.map((machine) => {
    const m = machines.find((x) => x.node === machine) ?? null;
    const re = reach?.[machine];
    const row = m?.running ? all.find((r) => r.node === machine && r.stack === m.running!.stack && r.runId === m.running!.runId && r.live?.status === "running") ?? null : null;
    const base = { machine, run: null, story: null, storyTitle: null, finishing: false, minutes: null, silent: null, queued: m?.queued ?? 0 };
    if (re && !re.ok) return { ...base, state: "unreachable" as const };
    if (!m) return { ...base, state: "unreachable" as const };
    if (m.busy) return { ...base, state: "running" as const };
    if (m.running) {
      return {
        ...base, state: "running" as const,
        run: row ? ref(row) : { pack: "", stack: m.running.stack, runId: m.running.runId, label: m.running.short, machine },
        story: m.running.story, storyTitle: row?.live?.storyTitle ?? null, finishing: m.running.finishing,
        minutes: m.running.agentMinutes, silent: row ? silentMinutes(row, now) : null,
      };
    }
    return { ...base, state: m.queued > 0 ? "queuedOnly" as const : "idle" as const };
  });
}

// ---------- a machine's jobs now ----------

/** When the job a run shows (its live job) ended: dbench's recorded end for that job, else its last report; the
 * run's end when the job isn't among the run's jobs. Never a later record time: the job is what is listed. */
export function jobEndedAt(r: Pick<Row, "jobs" | "live" | "stateAt">): number | null {
  const j = r.live ? r.jobs.find((x) => x.id === r.live!.jobId) : undefined;
  return j ? jobEnd(j) : endedAt(r);
}

/** A machine's live jobs: the running one, the queue in dbench's order, and jobs that ended within RECENT_END_S of
 * `now`, latest first. dbench keeps ended jobs for days, so each is judged on its own end; one whose end can't be told
 * isn't called recent. (30 Sep: the Strix Halo box listed jobs ended on 27-29 Sep here, with no time limit at all.) */
export function machineJobs(machine: string, all: Row[], now: number): { running: Row[]; queued: Row[]; ended: Row[] } {
  const mine = all.filter((r) => r.node === machine && r.live);
  const recent = (r: Row) => { const t = jobEndedAt(r); return t !== null && now - t <= RECENT_END_S; };
  return {
    running: mine.filter((r) => r.live!.status === "running"),
    queued: mine.filter((r) => r.live!.status === "queued").toSorted((a, b) => (a.live!.queue?.position ?? 0) - (b.live!.queue?.position ?? 0)),
    ended: mine.filter((r) => r.live!.status !== "running" && r.live!.status !== "queued" && recent(r))
      .toSorted((a, b) => (jobEndedAt(b) ?? 0) - (jobEndedAt(a) ?? 0)),
  };
}

/** "job 2 of 3" for a run's live job: its place among the run's dbench jobs, oldest first. */
export function jobPlace(r: Pick<Row, "jobs" | "live">): { place: number; of: number } | null {
  const i = r.jobs.findIndex((j) => j.id === r.live?.jobId);
  return i < 0 ? null : { place: i + 1, of: r.jobs.length };
}

// ---------- a machine's history ----------

export interface VersionGroup {
  pack: string;
  /** The spec version family ("vidi-v2"); "" when the runs don't say. */
  family: string;
  /** The pack versions its runs built against, newest first ("vidi-v2.0-pre1"). */
  packVersions: string[];
  runs: Row[];
}

export interface CombinationHistory { stack: string; label: string; groups: VersionGroup[] }

const STATUS_ORDER: Record<RunStatus, number> = { running: 0, queued: 1, finished: 2, failed: 3, stopped: 3, cancelled: 3, unknown: 3 };
const newestFirst = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

/** In progress, the queue in its order, finished, then the rest; each of the last two latest-ended first, then by run id. */
function byRecency(a: Row, b: Row): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (a.live?.queue?.position ?? 0) - (b.live?.queue?.position ?? 0)
    || (endedAt(b) ?? 0) - (endedAt(a) ?? 0)
    || newestFirst(a.runId, b.runId);
}

/** Every run on a machine, by combination, then by pack and version family: runs of different spec versions built
 * different specs, so they never share a group. Combinations with work in hand come first, then the most recent. */
export function machineHistory(runs: Row[]): CombinationHistory[] {
  const byStack = new Map<string, Row[]>();
  for (const r of runs) byStack.set(r.stack, [...(byStack.get(r.stack) ?? []), r]);
  const combos = [...byStack.entries()].map(([stack, rs]): CombinationHistory => {
    const byVersion = new Map<string, Row[]>();
    for (const r of rs) {
      const k = `${r.pack}\u0000${r.family}`;
      byVersion.set(k, [...(byVersion.get(k) ?? []), r]);
    }
    const groups = [...byVersion.values()].map((vr): VersionGroup => ({
      pack: vr[0].pack, family: vr[0].family,
      packVersions: [...new Set(vr.map((r) => r.packVersion).filter(Boolean))].toSorted(newestFirst),
      runs: vr.toSorted(byRecency),
    })).toSorted((a, b) => a.pack.localeCompare(b.pack) || newestFirst(a.family, b.family));
    return { stack, label: rs[0].label, groups };
  });
  const lead = (c: CombinationHistory) => c.groups.flatMap((g) => g.runs).toSorted(byRecency)[0];
  return combos.toSorted((a, b) => byRecency(lead(a), lead(b)) || a.label.localeCompare(b.label));
}
