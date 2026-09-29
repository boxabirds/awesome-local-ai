// Pure logic: from repo paths, run records and dbench jobs to the rows the page shows. No I/O here.
import type { Live, Machine, QueuePlace, Row, Score, Stages, Story } from "../shared/types.ts";

/** A finished or cancelled job with no run record is shown this long (seconds). */
export const RECENT_S = 24 * 3600;

// ---------- dbench's JSON (snake_case, as `dbench status --json` prints it) ----------

export interface DbenchStory {
  id: string;
  status?: string;
  title?: string | null;
  passed?: number | null;
  total?: number | null;
  agent_minutes?: number | null;
  calls?: number | null;
  output_tokens?: number | null;
  started_at?: number | null;
  tasks?: { status?: string }[];
  recent_activity?: string[];
}

export interface DbenchJob {
  id: string;
  spec: { pack?: string; run_id?: string; install_id?: string; combination?: string };
  progress?: {
    combination?: string;
    current_story?: string | null;
    log_tail?: string[];
    stories?: DbenchStory[];
  };
  state: { status?: string; attempt?: number; reason?: string };
  attempt?: number;
  seq?: number;
  submitted_at?: number;
  updated_at?: number;
}

export type NodeJob = DbenchJob & { node: string };

// ---------- runs found in the repo ----------

export interface RunRef {
  pack: string;
  stack: string;
  runId: string;
  dir: string;
  rescores: string[];
  hasBundle: boolean;
}

export interface RunRecord extends RunRef {
  host?: string;
  packVersion: string;
  state: string;
  stateAt: string;
  stories: Story[];
  scores: Record<string, Score>;
}

const RUN_RE =
  /^(?:combinations\/(?<stack>.+)\/benchmarks\/(?<pack>[^/]+)|benchmarks\/reference\/(?<rpack>[^/]+)\/(?<rstack>[^/]+))\/(?<run>[^/]+)\/(?<rest>.+)$/;
const RESCORE_RE = /^rescore\/([^/]+)\/rescore\.json$/;

/** Runs are directories holding a run.json, under combinations/<stack>/benchmarks/<pack>/<run>/ or
 * benchmarks/reference/<pack>/<stack>/<run>/; also notes each run's re-scores and bundle. */
export function findRuns(paths: string[]): RunRef[] {
  const runs = new Map<string, RunRef>();
  const extras = new Map<string, { rescores: string[]; hasBundle: boolean }>();
  for (const p of paths) {
    const g = RUN_RE.exec(p)?.groups;
    if (!g) continue;
    const stack = g.stack ?? `reference/${g.rstack}`;
    const pack = g.pack ?? g.rpack;
    const key = [pack, stack, g.run].join("\u0000");
    const e = extras.get(key) ?? { rescores: [], hasBundle: false };
    extras.set(key, e);
    if (g.rest === "run.json") {
      runs.set(key, { pack, stack, runId: g.run, dir: p.slice(0, p.length - g.rest.length - 1), rescores: [], hasBundle: false });
    } else if (g.rest === "workspace.bundle") {
      e.hasBundle = true;
    } else {
      const r = RESCORE_RE.exec(g.rest);
      if (r && !e.rescores.includes(r[1])) e.rescores.push(r[1]);
    }
  }
  return [...runs.entries()].map(([key, run]) => {
    const e = extras.get(key)!;
    return { ...run, rescores: [...e.rescores].sort(), hasBundle: e.hasBundle };
  });
}

// ---------- versions and links ----------

/** "vidi-v2.0-pre1" -> "vidi-v2": results compare only within one major version. */
export function versionFamily(v: string): string {
  return /^(.*?-v\d+)/.exec(v ?? "")?.[1] ?? "";
}

/** A record's family is its pack version's; a job with no record yet runs the pack's current version;
 * a record written before runs recorded a version (or with a bare commit) is "unversioned". */
export function rowFamily(row: { dir: string | null; packVersion: string }, suite: string): string {
  if (row.packVersion) return versionFamily(row.packVersion) || "unversioned";
  return row.dir === null ? versionFamily(suite) : "unversioned";
}

export function webBase(remote: string): string | null {
  const m = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}` : null;
}

// ---------- dbench jobs ----------

const jobKey = (stack: string, pack: string, runId: string) => [stack, pack, runId].join("\u0000");
const packName = (pack: string | undefined) => (pack ?? "").split("/").filter(Boolean).pop() ?? "";
const jobStack = (j: DbenchJob) => j.progress?.combination || j.spec.combination || j.spec.install_id || "";

/** dbench jobs keyed by (combination, pack name, run id); the most recently updated job wins. */
export function indexJobs(byNode: Record<string, DbenchJob[]>): Map<string, NodeJob> {
  const idx = new Map<string, NodeJob>();
  for (const [node, jobs] of Object.entries(byNode)) {
    for (const j of jobs) {
      const key = jobKey(jobStack(j), packName(j.spec.pack), j.spec.run_id ?? "");
      const prev = idx.get(key);
      if (!prev || (j.updated_at ?? 0) > (prev.updated_at ?? 0)) idx.set(key, { ...j, node });
    }
  }
  return idx;
}

/** "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi" -> "3.8-swift-1.5/27b". */
export function shortStack(combination: string): string {
  const parts = combination.split("/");
  return parts.length >= 3 ? parts.slice(1, 3).join("/") : combination;
}

/** Each queued job's place on its node and the jobs ahead of it. dbench runs one job at a time in
 * (submission time, sequence, id) order, except that a job being restarted goes to the front. */
export function queuePositions(byNode: Record<string, DbenchJob[]>): Map<string, QueuePlace> {
  const out = new Map<string, QueuePlace>();
  const label = (j: DbenchJob, suffix = "") => `${shortStack(jobStack(j))} ${j.spec.run_id ?? ""}${suffix}`;
  for (const jobs of Object.values(byNode)) {
    const running = jobs.filter((j) => j.state.status === "running");
    const queued = jobs
      .filter((j) => j.state.status === "queued")
      .toSorted((a, b) =>
        (a.attempt ? 0 : 1) - (b.attempt ? 0 : 1) ||
        (a.submitted_at ?? 0) - (b.submitted_at ?? 0) ||
        (a.seq ?? 0) - (b.seq ?? 0) ||
        a.id.localeCompare(b.id));
    const ahead = running.map((j) => label(j, " (running)"));
    for (const j of queued) {
      out.set(j.id, { position: ahead.length + 1, ahead: [...ahead] });
      ahead.push(label(j));
    }
  }
  return out;
}

/** The live numbers of a job's running story: dbench lists every story of the run, so pick the one
 * that is running (or the current one), never simply the last. */
export function liveFromJob(job: DbenchJob, queue: QueuePlace | undefined): Live {
  const prog = job.progress ?? {};
  const cur = prog.current_story ?? null;
  const stories = prog.stories ?? [];
  const story = stories.find((s) => s.status === "running") ??
    stories.find((s) => cur !== null && String(s.id) === String(cur));
  const tasks = story?.tasks ?? [];
  const activity = story?.recent_activity ?? [];
  return {
    jobId: job.id,
    status: job.state.status ?? "",
    attempt: job.state.attempt ?? null,
    currentStory: cur,
    runningStory: story ? String(story.id) : null,
    agentMinutes: story?.agent_minutes ?? null,
    calls: story?.calls ?? null,
    outputTokens: story?.output_tokens ?? null,
    tasksWritten: tasks.length ? tasks.filter((t) => t.status && t.status !== "not-started").length : null,
    tasksTotal: tasks.length || null,
    lastActivity: activity.at(-1) ?? null,
    storyStartedAt: story?.started_at ?? null,
    logTail: (prog.log_tail ?? []).slice(-3),
    queue: queue ?? null,
  };
}

// ---------- stories ----------

interface RawAccept {
  passed?: number;
  total?: number;
  by_story?: Record<string, { passed?: number; total?: number }>;
}

/** A recorded story: `passed`/`total` are the whole held-out suite up to that story; `ownPassed`/
 * `ownTotal` are that story's own tests (accept.json's by_story, keyed "01", "02", …). */
export function storyEntry(id: string, raw: { title?: string; status?: string; accept?: RawAccept | null }): Story {
  const acc = raw.accept ?? {};
  const own = acc.by_story?.[/^\d+$/.test(id) ? id.padStart(2, "0") : id] ?? {};
  return {
    id: String(id),
    title: raw.title ?? "",
    status: raw.status ?? "",
    passed: acc.passed ?? null,
    total: acc.total ?? null,
    ownPassed: own.passed ?? null,
    ownTotal: own.total ?? null,
  };
}

/** The record's finished stories, plus any dbench already reports finished that the fetched record
 * doesn't have yet (git is read once a minute, dbench every few seconds). dbench's figure is the
 * story's own tests; the whole-suite figure arrives with the record. */
export function mergeStories(recorded: Story[], live: DbenchStory[] | undefined): Story[] {
  const have = new Set(recorded.map((s) => s.id));
  const extra = (live ?? [])
    .filter((s) => s.total != null && !have.has(String(s.id)) && s.status !== "running" && s.status !== "pending")
    .map((s) => ({
      id: String(s.id), title: s.title ?? "", status: s.status ?? "",
      passed: null, total: null, ownPassed: s.passed ?? null, ownTotal: s.total ?? null,
    }));
  return [...recorded, ...extra];
}

// ---------- build -> score -> judge ----------

export function stages(run: { state: string; rescores: string[]; hasBundle: boolean }, job: DbenchJob | null, suite: string): Stages {
  const status = job?.state.status;
  let build: string;
  if (status === "running") {
    const prog = job!.progress ?? {};
    const cur = prog.current_story;
    const busy = (prog.stories ?? []).find((s) => s.status === "running")?.id;
    if (cur) build = `running: story ${cur}`;
    else if (busy) build = `running: story ${busy} (finishing)`; // agent done: gates, scoring, commit
    else if (prog.stories?.length) build = "running: between stories";
    else build = "running: starting";
  } else if (status === "queued") build = "queued";
  else if (status === "failed") build = `failed: ${job!.state.reason || "no reason given"}`;
  else if (status === "cancelled") build = "cancelled";
  else if (status === "done" && !run.state) build = "finished (not recorded)";
  else build = run.state || "unknown";

  const finished = run.state === "finished" && status !== "running" && status !== "queued";
  const scored = run.rescores.includes(suite);
  const score = !finished ? "waiting for the build" : scored ? `scored with ${suite}` : `not scored with ${suite}`;
  const judge = !scored || !finished ? "waiting for scoring" : run.hasBundle ? "ready" : "needs workspace.bundle";
  return { build, score, judge };
}

// ---------- rows ----------

export interface MergedRow extends Omit<RunRecord, "dir"> {
  dir: string | null;
  job: NodeJob | null;
}

const EMPTY_RECORD = {
  rescores: [] as string[], hasBundle: false, host: "", packVersion: "", state: "", stateAt: "",
  stories: [] as Story[], scores: {} as Record<string, Score>,
};

/** One row per run record, plus one per dbench job that has no record yet: queued and running jobs
 * always, failed or stopped ones for RECENT_S; cancelled or finished ones never, as they left no run. */
export function mergeRows(records: RunRecord[], jobs: Map<string, NodeJob>, now: number): MergedRow[] {
  const seen = new Set<string>();
  const rows: MergedRow[] = records.map((r) => {
    const key = jobKey(r.stack, r.pack, r.runId);
    seen.add(key);
    return { ...r, job: jobs.get(key) ?? null };
  });
  for (const [key, job] of jobs) {
    if (seen.has(key)) continue;
    const status = job.state.status;
    // Without a record, a cancelled or finished job (a smoke test, a dropped combination) left no run.
    if (status === "cancelled" || status === "done") continue;
    if (status !== "queued" && status !== "running" && now - (job.updated_at ?? 0) >= RECENT_S) continue;
    const [stack, pack, runId] = key.split("\u0000");
    rows.push({ ...EMPTY_RECORD, pack, stack, runId, dir: null, job });
  }
  return rows;
}

/** Everything the page needs, per row. */
export function buildRows(records: RunRecord[], byNode: Record<string, DbenchJob[]>, suites: Record<string, string>, now: number): Row[] {
  const queue = queuePositions(byNode);
  return assignMachines(mergeRows(records, indexJobs(byNode), now).map(({ job, ...r }) => {
    const suite = suites[r.pack] ?? "";
    return {
      ...r,
      host: r.host ?? "",
      machine: "",
      label: machineLabel(r.stack),
      node: job?.node ?? null,
      family: rowFamily(r, suite),
      suite,
      stories: job ? mergeStories(r.stories, job.progress?.stories) : r.stories,
      stages: stages(r, job, suite),
      live: job ? liveFromJob(job, queue.get(job.id)) : null,
    };
  }));
}

const UNKNOWN_MACHINE = "unknown machine";

/** Files each row under a machine: its dbench node; else the node another run on the same host ran
 * on (records from before dbench, or whose job has aged out); else the host itself. */
export function assignMachines<R extends Pick<Row, "node" | "host">>(rows: R[]): (R & { machine: string })[] {
  const nodeOfHost = new Map<string, string>();
  for (const r of rows) if (r.node && r.host) nodeOfHost.set(r.host, r.node);
  return rows.map((r) => ({ ...r, machine: r.node ?? nodeOfHost.get(r.host) ?? (r.host || UNKNOWN_MACHINE) }));
}

// ---------- machines ----------

/** A stack named for a one-line summary: model and engine, e.g. "3.8/flash-next gufo". */
export function machineLabel(stack: string): string {
  const parts = stack.split("/");
  if (parts.length < 3) return stack; // reference/opus-5.5
  const engine = parts.at(-1)!.replace(/-(pi|opencode|claude)$/, "");
  return `${shortStack(stack)} ${engine}`;
}

/** What each node is doing: its running job and the number queued, idle nodes included, by name. */
export function machines(nodes: string[], rows: Row[]): Machine[] {
  return nodes.toSorted().map((node) => {
    const mine = rows.filter((r) => r.node === node);
    const run = mine.find((r) => r.live?.status === "running");
    return {
      node,
      running: run
        ? {
            stack: run.stack, short: machineLabel(run.stack), runId: run.runId,
            story: run.live?.currentStory || run.live?.runningStory || null,
            finishing: !run.live?.currentStory && Boolean(run.live?.runningStory),
            agentMinutes: run.live?.agentMinutes ?? null,
          }
        : null,
      queued: mine.filter((r) => r.live?.status === "queued").length,
    };
  });
}
