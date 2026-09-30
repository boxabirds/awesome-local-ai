// Pure logic: from repo paths, run records and dbench jobs to the rows the page shows. No I/O here.
import type { Live, Machine, QueuePlace, Row, RunStatus, RunUsage, StoriesWorking, StorySquare, Usage, Score, Stages, Story } from "../shared/types.ts";

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
  state: { status?: string; attempt?: number; reason?: string; started_at?: number };
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
  /** Per re-scored version, the latest story re-scored ("12" for a final re-score). */
  rescoreLast: Record<string, string>;
  hasBundle: boolean;
}

/** A re-score's per-story results against the build after story `after`. */
export interface Rescored { after: string; byStory: NonNullable<Story["byStory"]> }

export interface RunRecord extends RunRef {
  host?: string;
  /** Per re-scored version, the latest re-scored story's per-story results. */
  rescored?: Record<string, Rescored>;
  packVersion: string;
  state: string;
  stateAt: string;
  stories: Story[];
  scores: Record<string, Score>;
}

const RUN_RE =
  /^(?:combinations\/(?<stack>.+)\/benchmarks\/(?<pack>[^/]+)|benchmarks\/reference\/(?<rpack>[^/]+)\/(?<rstack>[^/]+))\/(?<run>[^/]+)\/(?<rest>.+)$/;
const RESCORE_RE = /^rescore\/([^/]+)\/rescore\.json$/;
const RESCORE_STORY_RE = /^rescore\/([^/]+)\/stories\/(\d+)\/accept\.json$/;

/** Runs are directories holding a run.json, under combinations/<stack>/benchmarks/<pack>/<run>/ or
 * benchmarks/reference/<pack>/<stack>/<run>/; also notes each run's re-scores and bundle. */
export function findRuns(paths: string[]): RunRef[] {
  const runs = new Map<string, RunRef>();
  const extras = new Map<string, { rescores: string[]; hasBundle: boolean; rescoreLast: Record<string, string> }>();
  for (const p of paths) {
    const g = RUN_RE.exec(p)?.groups;
    if (!g) continue;
    const stack = g.stack ?? `reference/${g.rstack}`;
    const pack = g.pack ?? g.rpack;
    const key = [pack, stack, g.run].join("\u0000");
    const e = extras.get(key) ?? { rescores: [], hasBundle: false, rescoreLast: {} };
    extras.set(key, e);
    if (g.rest === "run.json") {
      runs.set(key, { pack, stack, runId: g.run, dir: p.slice(0, p.length - g.rest.length - 1), rescores: [], hasBundle: false, rescoreLast: {} });
    } else if (g.rest === "workspace.bundle") {
      e.hasBundle = true;
    } else {
      const r = RESCORE_RE.exec(g.rest);
      if (r && !e.rescores.includes(r[1])) e.rescores.push(r[1]);
      const rs = RESCORE_STORY_RE.exec(g.rest);
      if (rs && Number(rs[2]) > Number(e.rescoreLast[rs[1]] ?? 0)) e.rescoreLast[rs[1]] = String(Number(rs[2]));
    }
  }
  return [...runs.entries()].map(([key, run]) => {
    const e = extras.get(key)!;
    return { ...run, rescores: [...e.rescores].sort(), hasBundle: e.hasBundle, rescoreLast: e.rescoreLast };
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
const live = (j: DbenchJob) => j.state.status === "queued" || j.state.status === "running";
/** Which of two jobs of one run the run shows: a queued or running one (a restart) over an ended one; then the
 * latest update; then the later submission. */
function newer(j: DbenchJob, prev: DbenchJob): boolean {
  if (live(j) !== live(prev)) return live(j);
  const later = (j.updated_at ?? 0) - (prev.updated_at ?? 0) || (j.submitted_at ?? 0) - (prev.submitted_at ?? 0) || (j.seq ?? 0) - (prev.seq ?? 0);
  return later > 0;
}

export function indexJobs(byNode: Record<string, DbenchJob[]>): Map<string, NodeJob> {
  const idx = new Map<string, NodeJob>();
  for (const [node, jobs] of Object.entries(byNode)) {
    for (const j of jobs) {
      const key = jobKey(jobStack(j), packName(j.spec.pack), j.spec.run_id ?? "");
      const prev = idx.get(key);
      if (!prev || newer(j, prev)) idx.set(key, { ...j, node });
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
    storyTitle: story?.title ?? null,
    storiesInScope: stories.length || null,
    runStartedAt: job.state.started_at ?? null,
    totalAgentMinutes: stories.some((s) => s.agent_minutes != null) ? stories.reduce((t, s) => t + (s.agent_minutes ?? 0), 0) : null,
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

/** accept.json's by_story ({"01": {passed, total}}) keyed by plain story id ("1"). */
export function normaliseByStory(by: Record<string, { passed?: number; total?: number }>): NonNullable<Story["byStory"]> {
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [String(Number(k)), { passed: v.passed ?? null, total: v.total ?? null }]));
}

/** A recorded story: `passed`/`total` are the whole held-out suite up to that story; `ownPassed`/
 * `ownTotal` are that story's own tests (accept.json's by_story, keyed "01", "02", …). */
/** metrics.json's per-story agent and time-split sections, as far as usage goes. */
export interface RawUsage {
  agent?: { seconds?: number; tool_calls?: number; compactions?: number; nudges?: number; tokens?: { input?: number; output?: number; cache_read?: number; cache_write?: number } };
  time_split?: { wall_s?: number; tools_s?: number; compaction_s?: number; other_s?: number; model?: {
    decode_tokens?: number; decode_s?: number; decode_tok_s?: number;
    prefill_tokens?: number; prefill_s?: number; prefill_tok_s?: number; draft_acceptance?: number | null;
  } };
}

function splitOf(ts: RawUsage["time_split"]): Usage["split"] {
  if (!ts || ts.wall_s == null) return null;
  const m = ts.model, other = ts.other_s ?? 0;
  return {
    wall: ts.wall_s, prefill: m?.prefill_s ?? 0, decode: m?.decode_s ?? 0, tools: ts.tools_s ?? 0, compaction: ts.compaction_s ?? 0,
    // Untimed model: "other" holds the model's time and the agent's own, which can't be told apart.
    other: m ? other : 0, modelUnsplit: m ? 0 : other,
  };
}

function usageOf(raw: RawUsage): Usage | null {
  const a = raw.agent, m = raw.time_split?.model;
  if (!a && !m) return null;
  return {
    outTokens: a?.tokens?.output ?? null, inTokens: a?.tokens?.input ?? null, cacheRead: a?.tokens?.cache_read ?? null,
    readTokens: a?.tokens ? (a.tokens.input ?? 0) + (a.tokens.cache_read ?? 0) + (a.tokens.cache_write ?? 0) : null,
    calls: a?.tool_calls ?? null, agentSeconds: a?.seconds ?? null,
    tokS: a?.tokens?.output != null && a?.seconds ? a.tokens.output / a.seconds : null,
    decodeTokens: m?.decode_tokens ?? null, decodeSeconds: m?.decode_s ?? null, decodeTokS: m?.decode_tok_s ?? null,
    prefillTokens: m?.prefill_tokens ?? null, prefillSeconds: m?.prefill_s ?? null, prefillTokS: m?.prefill_tok_s ?? null,
    draftAcceptance: m?.draft_acceptance ?? null,
    compactions: a?.compactions ?? null, nudges: a?.nudges ?? null,
    split: splitOf(raw.time_split),
  };
}

/** A run's tokens and speeds over its recorded stories. Speeds are total tokens over total seconds, so a
 * long story counts for more than a short one. tokS (output tokens over story time) exists for every run;
 * the model-only decode and prefill rates only where the harness timed the model. */
export function runUsage(stories: Story[]): RunUsage {
  const us = stories.map((s) => s.usage).filter((u): u is Usage => !!u);
  const sum = (f: (u: Usage) => number | null) => (us.some((u) => f(u) != null) ? us.reduce((t, u) => t + (f(u) ?? 0), 0) : null);
  const rate = (tok: (u: Usage) => number | null, sec: (u: Usage) => number | null) => {
    const timed = us.filter((u) => tok(u) != null && sec(u));
    const s = timed.reduce((t, u) => t + sec(u)!, 0);
    return s > 0 ? timed.reduce((t, u) => t + tok(u)!, 0) / s : null;
  };
  return {
    outTokens: sum((u) => u.outTokens), inTokens: sum((u) => u.inTokens), readTokens: sum((u) => u.readTokens),
    calls: sum((u) => u.calls),
    tokS: rate((u) => u.outTokens, (u) => u.agentSeconds),
    decodeTokS: rate((u) => u.decodeTokens, (u) => u.decodeSeconds),
    prefillTokS: rate((u) => u.prefillTokens, (u) => u.prefillSeconds),
  };
}

export function storyEntry(id: string, raw: { title?: string; status?: string; accept?: RawAccept | null } & RawUsage): Story {
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
    byStory: acc.by_story ? normaliseByStory(acc.by_story) : null,
    usage: usageOf(raw),
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

/** One word for where a run is, and a note: the dbench job's state when there is a job, else the record's. */
export function runStatus(run: { state: string }, job: DbenchJob | null): { status: RunStatus; note: string } {
  const st = job?.state.status;
  const attempt = (job?.state.attempt ?? 1) > 1 ? `attempt ${job!.state.attempt}` : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  if (st === "running") {
    const prog = job!.progress ?? {};
    const busy = (prog.stories ?? []).find((s) => s.status === "running")?.id;
    const phase = prog.current_story ? "" : busy ? `finishing story ${busy}` : prog.stories?.length ? "between stories" : "starting";
    return { status: "running", note: join(phase, attempt) };
  }
  if (st === "queued") return { status: "queued", note: "" };
  if (st === "failed") return { status: "failed", note: job!.state.reason || "no reason given" };
  if (st === "cancelled") return { status: "cancelled", note: "" };
  const byRecord: Record<string, RunStatus> = { finished: "finished", failed: "failed", stopped: "stopped" };
  if (byRecord[run.state]) return { status: byRecord[run.state], note: "" };
  if (run.state === "started") return { status: "stopped", note: "no longer running" }; // started, but no job runs it now
  return { status: st === "done" ? "finished" : "unknown", note: "" };
}

// ---------- rows ----------

export interface MergedRow extends Omit<RunRecord, "dir"> {
  dir: string | null;
  job: NodeJob | null;
}

const EMPTY_RECORD = {
  rescores: [] as string[], rescoreLast: {} as Record<string, string>, hasBundle: false, host: "", packVersion: "", state: "", stateAt: "",
  stories: [] as Story[], scores: {} as Record<string, Score>,
};

/** One row per run record, plus one per dbench job that has no record yet: queued and running jobs
 * always, failed, stopped or cancelled ones for RECENT_S; finished ones never, as they left no run. */
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
    // Without a record, a finished job (a smoke test) left no run.
    if (status === "done") continue;
    if (status !== "queued" && status !== "running" && now - (job.updated_at ?? 0) >= RECENT_S) continue;
    const [stack, pack, runId] = key.split("\u0000");
    rows.push({ ...EMPTY_RECORD, pack, stack, runId, dir: null, job });
  }
  return rows;
}

/** Everything the page needs, per row. */
export function buildRows(
  records: RunRecord[], byNode: Record<string, DbenchJob[]>, suites: Record<string, string>, now: number,
  flowCounts: Record<string, Record<string, number>> = {},
): Row[] {
  const queue = queuePositions(byNode);
  return assignMachines(mergeRows(records, indexJobs(byNode), now).map(({ job, ...r }) => {
    const suite = suites[r.pack] ?? "";
    const stories = job ? mergeStories(r.stories, job.progress?.stories) : r.stories;
    return {
      ...r,
      host: r.host ?? "",
      machine: "",
      label: machineLabel(r.stack),
      node: job?.node ?? null,
      family: rowFamily(r, suite),
      suite,
      stories,
      usage: runUsage(r.stories), // recorded stories only: a story dbench reports done has no time split yet
      stages: stages(r, job, suite),
      ...(({ status, note }) => ({ status, statusNote: note }))(runStatus(r, job)),
      storiesWorking: storiesWorking(
        stories,
        scopeIds((job?.progress?.stories ?? []).map((st) => String(st.id)), flowCounts[r.packVersion || suite], stories.map((st) => st.id)),
        job?.state.status === "running" ? runningStoryId(job) : null,
        r.rescored?.[suite],
      ),
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

// ---------- stories working ----------

/** Tests in one Playwright spec file: each test( / test.only( / test.fixme( / test.fail( call. */
const TEST_CALL = /^\s*test(?:\.(?:only|fixme|fail))?\(/gm;
export const countTests = (source: string) => source.match(TEST_CALL)?.length ?? 0;

/** The story a running job is on: current_story, or the one progress.json marks running while it is scored. */
function runningStoryId(job: DbenchJob): string | null {
  const prog = job.progress ?? {};
  const id = prog.current_story || (prog.stories ?? []).find((s) => s.status === "running")?.id;
  return id ? String(Number(id)) : null;
}

/** How each story in scope does against the latest build, from the last story recorded with a per-story
 * breakdown; stories dbench reports done after that use their own result; the running one is marked. */
export function storiesWorking(stories: Story[], scope: string[], running: string | null, rescored?: Rescored): StoriesWorking {
  const liveLast = stories.findLast((s) => s.byStory);
  // A re-score under the current suite wins unless the live scores reach a later story.
  const useRescore = rescored && (!liveLast || Number(rescored.after) >= Number(liveLast.id));
  const latest = (useRescore ? rescored.byStory : liveLast?.byStory) ?? {};
  const own = new Map(stories.filter((s) => s.ownTotal !== null).map((s) => [s.id, s]));
  const state = (passed: number | null, total: number | null): StorySquare["state"] =>
    !total ? "unbuilt" : passed === total ? "ok" : passed ? "part" : "bad";
  const squares = scope.map((id): StorySquare => {
    if (id === running) return { id, state: "running", passed: null, total: null };
    const r = latest[id] ?? (own.has(id) ? { passed: own.get(id)!.ownPassed, total: own.get(id)!.ownTotal } : null);
    return r ? { id, state: state(r.passed, r.total), passed: r.passed, total: r.total } : { id, state: "unbuilt", passed: null, total: null };
  });
  return { working: squares.filter((q) => q.state === "ok").length, scope: scope.length, squares };
}

/** The stories in a run's scope, in order: the job's list, else every story in the suite, else the recorded ones. */
export function scopeIds(jobStories: string[], counts: Record<string, number> | undefined, recorded: string[]): string[] {
  const ids = jobStories.length ? jobStories : counts ? Object.keys(counts) : recorded;
  return [...new Set(ids.map((id) => String(Number(id))))].toSorted((a, b) => Number(a) - Number(b));
}

// ---------- scores ----------

export interface RawRescore { finished_at?: string; results?: { story?: number; passed?: number; total?: number; flaky?: number }[] }

/** A re-score is a score of record only when the run finished and it re-scored the run's last story (the
 * whole build). A partial re-score still corrects the story squares, but isn't the run's score. */
export function finalScore(rs: RawRescore | null, state: string, lastStory: string | undefined): Score | null {
  const last = rs?.results?.at(-1);
  if (!last || state !== "finished" || lastStory === undefined || String(last.story) !== String(Number(lastStory))) return null;
  return { passed: last.passed ?? null, total: last.total ?? null,
    flaky: (rs!.results ?? []).reduce((n, x) => n + (x.flaky ?? 0), 0), at: rs!.finished_at ?? "" };
}
