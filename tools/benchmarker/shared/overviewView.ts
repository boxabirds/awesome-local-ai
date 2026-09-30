// What the overview and the machine pages show, worked out from the state: pure functions, so every rule (what
// needs you, what a machine is doing now, how a machine's history is grouped) is tested once here and the
// components only lay it out (plan sections 4.1 and 4.6).
import type { Invalid, Machine, Row, RunStatus } from "./types.ts";
import { isInvalid, scoreOfRecord, unscoredReason } from "./stats.ts";

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

/** Whether dbench answered for a machine, from /api/machines: `ok`, or the error it gave. */
export interface Reach { ok: boolean; error?: string }
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

// ---------- needs you ----------

/** The kinds of exception, in the order they are listed: what wastes a machine first, then what blocks a result,
 * then what makes a number doubtful. */
export const NEED_KINDS = ["silent", "unreachable", "ended", "idle", "rescoreFault", "unscored", "accounting"] as const;
export type NeedKind = (typeof NEED_KINDS)[number];

/** A run as a need or a now line names it; `invalid` so the link can be struck through. */
export interface RunRef { pack: string; stack: string; runId: string; label: string; machine: string; invalid?: Invalid | null }

export type Need =
  /** A running story whose harness has been silent for SILENT_MINUTES or more. */
  | { kind: "silent"; key: string; machine: string; run: RunRef; story: string; minutes: number }
  /** A dbench node in the list that didn't answer. */
  | { kind: "unreachable"; key: string; machine: string; error: string }
  /** A failed or stopped run that ended within RECENT_END_S. */
  | { kind: "ended"; key: string; run: RunRef; status: "failed" | "stopped"; endedAt: number; note: string }
  /** A reachable dbench node with nothing running and nothing queued. */
  | { kind: "idle"; key: string; machine: string }
  /** A finished run re-scored under the current suite whose re-score gave no score of record. */
  | { kind: "rescoreFault"; key: string; run: RunRef; suite: string }
  /** A finished run of the current spec version never re-scored under the current suite. */
  | { kind: "unscored"; key: string; run: RunRef; why: string }
  /** A run with stories whose time split failed its own checks. */
  | { kind: "accounting"; key: string; run: RunRef; stories: { id: string; problems: string[] }[] };

const ref = (r: Row): RunRef => ({ pack: r.pack, stack: r.stack, runId: r.runId, label: r.label, machine: r.machine, invalid: r.invalid ?? null });
const runKey = (r: Row) => `${r.pack}\u0000${r.stack}\u0000${r.runId}`;

/** The version family a suite belongs to: "vidi-v2" for "vidi-v2.0-pre1" (as the header picks the current one). */
export const suiteFamily = (suite: string) => /^(.*?-v\d+)/.exec(suite)?.[1] ?? "";

/** A job's end as dbench recorded it, else its last report. */
const jobEnd = (j: Row["jobs"][number] | undefined): number | null => j?.endedAt ?? j?.updatedAt ?? null;

/** When a run ended, in Unix seconds: the later of its last job's end and its record's time; null if neither. */
export function endedAt(r: Pick<Row, "jobs" | "stateAt">): number | null {
  const job = jobEnd(r.jobs.at(-1));
  const rec = r.stateAt ? Date.parse(r.stateAt) / 1000 : NaN;
  const times = [job, Number.isFinite(rec) ? rec : null].filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

export interface NeedsInput {
  /** The runs in the page's context (the pack and version chosen in the header): run exceptions are over these. */
  rows: Row[];
  /** Every run of every pack: a machine's running story is found here, whatever the header shows. */
  all: Row[];
  /** dbench's nodes (State.machines). */
  machines: Machine[];
  reach: Reachability;
  /** The server's clock, Unix seconds. */
  now: number;
}

/** Everything that asks for action, each with the entity it is about. Missing data never raises one: a story with
 * no start time is never called stuck, a run with no end time never called recent. An invalid run raises nothing:
 * it is left out of "needs you" like every other figure (its machine is still judged as a machine). */
export function needsYou({ rows: shown, all, machines, reach, now }: NeedsInput): Need[] {
  const out: Need[] = [];
  const rows = shown.filter((r) => !isInvalid(r));

  // Machines: a stuck story, an unreachable node, an idle one.
  for (const r of all) {
    if (isInvalid(r)) continue;
    const m = silentMinutes(r, now);
    const story = runningStory(r).story;
    if (m !== null && m >= SILENT_MINUTES && story) {
      out.push({ kind: "silent", key: `silent:${runKey(r)}`, machine: r.node ?? r.machine, run: ref(r), story, minutes: m });
    }
  }
  for (const [machine, re] of Object.entries(reach ?? {})) {
    if (!re.ok) out.push({ kind: "unreachable", key: `unreachable:${machine}`, machine, error: re.error ?? "" });
  }
  for (const m of machines) {
    if (reach && reach[m.node] && !reach[m.node].ok) continue;  // unreachable, said above
    if (m.running === null && m.queued === 0) out.push({ kind: "idle", key: `idle:${m.node}`, machine: m.node });
  }

  // Runs in the page's context.
  for (const r of rows) {
    if (r.status === "failed" || r.status === "stopped") {
      const at = endedAt(r);
      if (at !== null && now - at <= RECENT_END_S) {
        out.push({ kind: "ended", key: `ended:${runKey(r)}`, run: ref(r), status: r.status, endedAt: at, note: r.statusNote || r.jobs.at(-1)?.reason || "" });
      }
    }
    if (r.status === "finished" && scoreOfRecord(r) === null) {
      if (r.rescores.includes(r.suite)) {
        out.push({ kind: "rescoreFault", key: `rescoreFault:${runKey(r)}`, run: ref(r), suite: r.suite });
      } else if (r.family && r.family === suiteFamily(r.suite)) {
        // A run of an older spec version can't be scored by this suite (another spec): not an omission to fix.
        out.push({ kind: "unscored", key: `unscored:${runKey(r)}`, run: ref(r), why: unscoredReason(r) });
      }
    }
    const bad = r.stories
      .filter((s) => s.usage?.split?.check.status === "problems")
      .map((s) => ({ id: s.id, problems: s.usage!.split!.check.problems }));
    if (bad.length) out.push({ kind: "accounting", key: `accounting:${runKey(r)}`, run: ref(r), stories: bad });
  }

  const order = (n: Need) => NEED_KINDS.indexOf(n.kind);
  return out.toSorted((a, b) => order(a) - order(b) || subject(a).localeCompare(subject(b), undefined, { numeric: true }));
}

/** What a need is about, as text: its machine, or its run. Orders needs of one kind. */
export function subject(n: Need): string {
  switch (n.kind) {
    case "unreachable": case "idle": return n.machine;
    case "silent": return `${n.machine} ${n.run.label} ${n.run.runId}`;
    default: return `${n.run.label} ${n.run.runId}`;
  }
}

// ---------- now: one line per machine ----------

export type NowState = "running" | "queuedOnly" | "idle" | "unreachable";

export interface NowLine {
  machine: string;
  state: NowState;
  /** The running run, when there is one (found among every run, whatever the header shows). */
  run: RunRef | null;
  story: string | null;
  storyTitle: string | null;
  finishing: boolean;
  /** Agent minutes on the running story, as the harness last reported them. */
  minutes: number | null;
  /** See silentMinutes; null when it can't be told. */
  silent: number | null;
  queued: number;
  /** Why it is unreachable, for an unreachable machine. */
  error: string;
}

/** One line per machine dbench knows or the machine list names, by name. An unreachable machine says so whatever
 * dbench last said about it; a machine with a queue and nothing running is not idle (its queue is waiting). */
export function nowLines(machines: Machine[], all: Row[], reach: Reachability, now: number): NowLine[] {
  const names = [...new Set([...machines.map((m) => m.node), ...Object.keys(reach ?? {})])]
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return names.map((machine) => {
    const m = machines.find((x) => x.node === machine) ?? null;
    const re = reach?.[machine];
    const row = m?.running ? all.find((r) => r.node === machine && r.stack === m.running!.stack && r.runId === m.running!.runId && r.live?.status === "running") ?? null : null;
    const base = { machine, run: null, story: null, storyTitle: null, finishing: false, minutes: null, silent: null, queued: m?.queued ?? 0, error: "" };
    if (re && !re.ok) return { ...base, state: "unreachable" as const, error: re.error || "no answer" };
    if (!m) return { ...base, state: "unreachable" as const, error: "dbench's job list has nothing for it" };
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
 * isn't called recent. (30 Sep: tritus listed jobs ended on 27-29 Sep here, with no time limit at all.) */
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

const STATUS_ORDER: Record<RunStatus, number> = { running: 0, queued: 1, finished: 2, failed: 2, stopped: 2, cancelled: 2, unknown: 2 };
const newestFirst = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

/** Running first, the queue in its order, then the rest latest-ended first, then by run id. */
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
