// Pure logic: from repo paths, run records and dbench jobs to the rows the page shows. No I/O here.
//
// Two shapes: the server's own (RunRecord, FullRow), which keep everything a record says, faults included (the
// invalid mark, finalize.json, each story's accounting check and harness faults, each job's reason), and the page's
// (Row), which carries none of that: invalid runs are left out, a split that failed its check is sent as none, and a
// job's failure reason stays here. server/faults.ts reads the full shape for GET /api/faults.
import { collapsedStoryIds } from "../shared/collapse.ts";
import type { ConversationProfile, Intervention, JobRef, Live, Machine, QueuePlace, Row, RunStatus, RunUsage, StoriesWorking, StorySquare, TimeSplit, Usage, Score, Story } from "../shared/types.ts";

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
  spec: { pack?: string; run_id?: string; install_id?: string; combination?: string; client?: string };
  progress?: {
    combination?: string;
    current_story?: string | null;
    log_tail?: string[];
    stories?: DbenchStory[];
  };
  state: { status?: string; attempt?: number; reason?: string; started_at?: number };
  /** Why it was cancelled, as the canceller gave it (dbench keeps one from 1 Oct 2026). */
  cancel_reason?: string;
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

/** A record's time split: the page's, with the record's own check of it (accounting.py). "unchecked": the record
 * has no accounting (a Claude Code run, or one from before the check existed). `version`: the accounting version
 * that made the record; null when it doesn't say. */
export interface AccountingCheck { status: "ok" | "problems" | "unchecked"; problems: string[]; version: number | null }
export type RecordSplit = TimeSplit & { check: AccountingCheck };
export type RecordUsage = Omit<Usage, "split"> & { split?: RecordSplit | null };
/** Lines of a story's agent output that were JSON but not events (drive.py's skipped_output): how many, and the
 * first few, each cut by the harness. */
export interface SkippedOutput { count: number; samples: string[] }
/** What the publishing step's credential scan redacted from a story's published files (drive.record_story's
 * credentials_redacted): how many, and what each was called. Never a value: the harness records none. */
export interface CredentialsRedacted { count: number; names: string[] }
/** A story as the record has it: the page's, plus its check, the harness faults recorded with it (drive.py's
 * harness_faults, verbatim), its skipped agent output and what was redacted from its published files. */
export type RecordStory = Omit<Story, "usage"> & {
  usage?: RecordUsage | null; harnessFaults?: unknown[]; skippedOutput?: SkippedOutput; credentialsRedacted?: CredentialsRedacted;
};

/** A run marked invalid in its run.json (`"invalid": {"reason": …, "since": "2026-09-30"}`): its result can't stand (it
 * saw the reference build, say). The page never shows it; the faults feed names it. */
export interface Invalid {
  reason: string;
  /** The date it was marked, as written; "" when the mark gives none. */
  since: string;
}

/** run.json's "sandbox": what the run's agent ran in (harness/sandbox.py identity): its mode ("enforced", or "permissive"
 * for a run that had no sandbox at all), and for an enforced one agent-sandbox's version, platform and policy hash, so runs
 * can be compared. Absent in records written before the agent ran in a sandbox. The page never shows it. */
export interface RunSandbox {
  mode: string;
  version: string;
  platform: string;
  policyHash: string;
}

/** run.json's "sandbox" where it says a mode; null where it is absent or says nothing (a record from before). */
export function parseSandbox(raw: unknown): RunSandbox | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return typeof o.mode === "string" && o.mode ? { mode: o.mode, version: text(o.version), platform: text(o.platform), policyHash: text(o.policy_hash) } : null;
}

/** finalize.json as finalize.py writes it, verbatim: at least `rescore` ("done", "skipped", "failed" or "flagged"),
 * with whatever else it recorded (reason, reason_kind, needs_person, attempts, history, guard, …). */
export type RawFinalize = { rescore: string } & Record<string, unknown>;

export interface RunRecord extends RunRef {
  host?: string;
  /** run.json's client ("pi", "claude"); absent in fixtures and records read before it was kept. */
  client?: string;
  /** Per re-scored version, the latest re-scored story's per-story results. */
  rescored?: Record<string, Rescored>;
  /** Per re-scored version, what spoiled the re-score (rescore.json's harness_fault on its last result); absent: none. */
  rescoreFaults?: Record<string, string>;
  packVersion: string;
  state: string;
  stateAt: string;
  stories: RecordStory[];
  scores: Record<string, Score>;
  /** run.json's "invalid" mark; absent in records read before it existed: valid. */
  invalid?: Invalid | null;
  /** run.json's "sandbox": what the agent ran in; null or absent: the record does not say (written before it did). */
  sandbox?: RunSandbox | null;
  /** interventions.md, parsed; absent: none. */
  interventions?: Intervention[];
  /** finalize.json, verbatim; absent or null: none. */
  finalize?: RawFinalize | null;
  /** metrics.json's "known_good": a partial rerun, built on another run's code. */
  knownGood: boolean;
}

// ---------- what the record says about the run itself ----------

/** finalize.json, kept whole: null for no record or one that doesn't say how the re-score ended (nothing is made of
 * a record that can't be read). */
export function parseFinalize(raw: unknown): RawFinalize | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  return typeof o.rescore === "string" && o.rescore ? (o as RawFinalize) : null;
}

const NO_REASON = "marked invalid with no reason given";

/** run.json's "invalid": {"reason", "since"} (a bare string is its reason). Absent, null or false: valid. Any other
 * mark still makes the run invalid, saying it gave no reason: a mark is never silently dropped. */
export function parseInvalid(raw: unknown): Invalid | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw === "string") return { reason: raw.trim() || NO_REASON, since: "" };
  if (typeof raw === "object") {
    const o = raw as { reason?: unknown; since?: unknown };
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    return { reason: reason || NO_REASON, since: typeof o.since === "string" ? o.since.trim() : "" };
  }
  return { reason: NO_REASON, since: "" };
}

// interventions.md lines, as the operator writes them ("- 2026-09-26T08:57:29Z story 3: the M5 Max froze …", or a heading
// "## 2026-09-29T07:21Z: harness restarted …") and as the harness's watchdog does ("2026-09-29T23:00:53Z 05:
// interrupted a tool call …"). The time as history.py reads it; a ":" straight after it is dropped.
const INTERVENTION_RE = /^(?:[-*]\s*|#{1,6}\s*)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z)\s*:?\s*(.*)$/;
/** "story 3: …" or the watchdog's "05: …". */
const INTERVENTION_STORY_RE = /^(?:story\s+)?(\d+)\s*:\s*(.*)$/i;
const BOLD = /\*\*/g;
const MS_PER_S = 1000;
/** "2026-09-25T16:10Z": a time without seconds is on the minute. */
const MINUTE_ONLY = /T\d{2}:\d{2}Z$/;

/** Every well-formed line, oldest first. Lines without a time, or with nothing after it, are prose or headings: skipped. */
export function parseInterventions(text: string | undefined): Intervention[] {
  const out: Intervention[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const m = INTERVENTION_RE.exec(raw.trim().replace(BOLD, ""));
    if (!m) continue;
    const at = Date.parse(MINUTE_ONLY.test(m[1]) ? m[1].replace(/Z$/, ":00Z") : m[1]) / MS_PER_S;
    if (!Number.isFinite(at)) continue;
    const rest = m[2].trim();
    const st = INTERVENTION_STORY_RE.exec(rest);
    const story = st ? String(Number(st[1])) : null;
    const said = (st ? st[2] : rest).trim();
    if (!said) continue;
    out.push({ at, story, text: said });
  }
  return out.toSorted((a, b) => a.at - b.at);
}

const RUN_RE =
  /^(?:combinations\/(?<stack>.+)\/benchmarks\/(?<pack>[^/]+)|benchmarks\/reference\/(?<rpack>[^/]+)\/(?<rstack>[^/]+))\/(?<run>[^/]+)\/(?<rest>.+)$/;
const RESCORE_RE = /^rescore\/([^/]+)\/rescore\.json$/;
// A re-scored story's result: its public summary, or (records from before 30 Sep 2026) the full result.
const RESCORE_STORY_RE = /^rescore\/([^/]+)\/stories\/(\d+)\/accept(?:-summary)?\.json$/;

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

// dbench's own line recording a job's end: "[dbench 2026-09-29T02:13:20Z] harness exited 0; job done", "… cancelled
// while queued by …", "… adopted harness ended; cancelled".
const DBENCH_LINE = /^\[dbench (\S+)\] (.*)$/;
const END_WORDS = /\bjob (?:done|failed|cancelled)\b|\bcancelled\b/;

/** When a job ended, in Unix seconds: the last line of its log tail in which dbench recorded the end, else its last
 * update (dbench stamps updated_at when it ends a job); null for a queued or running job, or when neither says. */
export function jobEndedAt(j: DbenchJob): number | null {
  const st = j.state.status;
  if (st === "queued" || st === "running") return null;
  for (const line of (j.progress?.log_tail ?? []).toReversed()) {
    const m = DBENCH_LINE.exec(line);
    if (!m || !END_WORDS.test(m[2])) continue;
    const t = Date.parse(m[1]) / MS_PER_S;
    if (Number.isFinite(t)) return t;
  }
  return j.updated_at ?? null;
}
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

const CANCEL_LINE = /^cancel(led while queued| requested) by /;
const FAILURE_LINE = /FAILED/;                         // the harness's own failure lines: "PREFLIGHT FAILED (claude): …"
const NONZERO_EXIT = /^harness exited [1-9]\d*/;
const CANCEL_UNEXPLAINED = "no reason recorded; before the cancel its log shows: ";

/** Why a job ended as it did: a failure's reason; a cancel's, as dbench kept it. A cancel from before dbench kept
 * reasons gets the failure its log shows before the cancel (the harness's own FAILED line, else a non-zero exit of
 * the harness), said to be that; "" when there is nothing to show. */
export function jobReason(j: DbenchJob): string {
  if (j.state.status === "failed") return j.state.reason ?? "";
  if (j.state.status !== "cancelled") return j.state.reason ?? "";
  const given = j.cancel_reason?.trim() || j.state.reason?.trim();
  if (given) return given;
  const tail = j.progress?.log_tail ?? [];
  const at = tail.findIndex((l) => CANCEL_LINE.test(DBENCH_LINE.exec(l)?.[2] ?? ""));
  const before = tail.slice(0, at < 0 ? 0 : at);
  const failure = before.toReversed().find((l) => !DBENCH_LINE.test(l) && FAILURE_LINE.test(l))
    ?? before.toReversed().map((l) => DBENCH_LINE.exec(l)?.[2] ?? "").find((t) => NONZERO_EXIT.test(t));
  return failure ? CANCEL_UNEXPLAINED + failure.trim() : "";
}

/** Every job of each run, keyed as indexJobs keys them, oldest first. */
export function jobsByRun(byNode: Record<string, DbenchJob[]>): Map<string, JobRef[]> {
  const out = new Map<string, JobRef[]>();
  for (const [node, jobs] of Object.entries(byNode)) {
    for (const j of jobs) {
      const key = jobKey(jobStack(j), packName(j.spec.pack), j.spec.run_id ?? "");
      out.set(key, [...(out.get(key) ?? []), {
        id: j.id, node, status: j.state.status ?? "", submittedAt: j.submitted_at ?? null, updatedAt: j.updated_at ?? null,
        endedAt: jobEndedAt(j),
      }]);
    }
  }
  for (const js of out.values()) js.sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0) || a.id.localeCompare(b.id));
  return out;
}

/** Every dbench job of each run, whole and with its node, keyed as indexJobs keys them, oldest first: what the
 * faults feed reads (server/faults.ts). */
export function dbenchJobsByRun(byNode: Record<string, DbenchJob[]>): Map<string, NodeJob[]> {
  const out = new Map<string, NodeJob[]>();
  for (const [node, jobs] of Object.entries(byNode)) {
    for (const j of jobs) {
      const key = jobKey(jobStack(j), packName(j.spec.pack), j.spec.run_id ?? "");
      out.set(key, [...(out.get(key) ?? []), { ...j, node }]);
    }
  }
  for (const js of out.values()) js.sort((a, b) => (a.submitted_at ?? 0) - (b.submitted_at ?? 0) || a.id.localeCompare(b.id));
  return out;
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
  time_split?: { wall_s?: number; tools_s?: number; compaction_s?: number; between_sessions_s?: number; other_s?: number; tools_by_kind?: Record<string, number>;
    accounting?: { version?: number; ok?: boolean; problems?: string[] }; model?: {
    decode_tokens?: number; decode_s?: number; decode_tok_s?: number;
    prefill_tokens?: number; prefill_s?: number; prefill_tok_s?: number; draft_acceptance?: number | null;
  } };
}

function splitOf(ts: RawUsage["time_split"]): RecordSplit | null {
  if (!ts || ts.wall_s == null) return null;
  const m = ts.model, other = ts.other_s ?? 0;
  return {
    wall: ts.wall_s, prefill: m?.prefill_s ?? 0, decode: m?.decode_s ?? 0, tools: ts.tools_s ?? 0, compaction: ts.compaction_s ?? 0,
    // Untimed model: "other" holds the model's time and the agent's own, which can't be told apart.
    other: m ? other : 0, modelUnsplit: m ? 0 : other,
    toolsByKind: ts.tools_by_kind ?? {},
    betweenSessions: ts.between_sessions_s ?? 0,
    check: !ts.accounting ? { status: "unchecked", problems: [], version: null }
      : { status: ts.accounting.ok ? "ok" : "problems", problems: ts.accounting.problems ?? [], version: ts.accounting.version ?? null },
  };
}

function usageOf(raw: RawUsage): RecordUsage | null {
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

/** A story as the page gets it: the record's, without its check, harness faults and skipped output. A split that failed its check
 * is not sent: the breakdown is not available, like one never recorded. The story's own totals (agent time, tokens,
 * calls, held-out) stay. */
export function publicStory(s: RecordStory): Story {
  const { harnessFaults: _faults, skippedOutput: _skipped, credentialsRedacted: _redacted, usage, ...rest } = s;
  // The warehouse's id and whether it has the conversation are set by the server once it knows the row's directory.
  const base = { ...rest, storyRunId: null, hasConversation: false };
  if (!usage) return { ...base, usage: usage ?? null };
  const { split, ...u } = usage;
  if (!split) return { ...base, usage: { ...u, split: split ?? null } };
  const { check, ...parts } = split;
  return { ...base, usage: { ...u, split: check.status === "problems" ? null : parts } };
}

/** A run's tokens and speeds over its recorded stories. Speeds are total tokens over total seconds, so a
 * long story counts for more than a short one. tokS (output tokens over story time) exists for every run;
 * the model-only decode and prefill rates only where the harness timed the model. */
export function runUsage(stories: Pick<Story, "usage">[]): RunUsage {
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

/** metrics.json's per-story "conversation", as the harness writes it (conversation.py). */
export interface RawConversation {
  version?: number; calls?: number; tool_calls?: number; thinking_chars?: number | null; text_chars?: number; tool_arg_chars?: number;
  thinking_median?: number | null; thinking_median_before?: number | null; thinking_median_after?: number | null;
  largest_thinking?: { chars: number; call: number; at_s: number } | null; context_start?: number | null; context_end?: number | null;
  largest_context_jump?: { tokens: number; call: number } | null; tools_by_name?: Record<string, number>; tool_errors?: number;
  longest_tool?: { seconds: number; name: string; gist: string } | null; signals?: string[];
  thinking_visible?: boolean; thinking_tokens?: number | null;
}

function conversationOf(c: RawConversation | undefined | null): ConversationProfile | null {
  if (!c || c.calls == null) return null;
  return {
    calls: c.calls, toolCalls: c.tool_calls ?? 0, thinkingChars: c.thinking_chars ?? null, textChars: c.text_chars ?? 0,
    toolArgChars: c.tool_arg_chars ?? 0, thinkingMedian: c.thinking_median ?? null,
    thinkingMedianBefore: c.thinking_median_before ?? null, thinkingMedianAfter: c.thinking_median_after ?? null,
    largestThinking: c.largest_thinking ? { chars: c.largest_thinking.chars, call: c.largest_thinking.call, atS: c.largest_thinking.at_s } : null,
    contextStart: c.context_start ?? null, contextEnd: c.context_end ?? null,
    largestContextJump: c.largest_context_jump ?? null, toolsByName: c.tools_by_name ?? {}, toolErrors: c.tool_errors ?? 0,
    longestTool: c.longest_tool ?? null, signals: c.signals ?? [],
    // Profiles from before the field (version 1, pi) all showed their thinking.
    thinkingVisible: c.thinking_visible ?? true, thinkingTokens: c.thinking_tokens ?? null,
  };
}

const NO_COMPARABLE_REASON = "no reason recorded";

/** metrics.json's per-story "not_comparable": the reason, in plain words, the story run is left out of story-by-story
 * comparisons. Absent, null, false or blank: compared. Any other mark still takes effect, saying it gave no reason:
 * a mark is never silently dropped. */
function notComparableOf(mark: unknown): string | null {
  if (typeof mark === "string") return mark.trim() || null;
  return mark ? NO_COMPARABLE_REASON : null;
}

/** The record's skipped_output where it is what the harness writes (a count above none, and its samples). */
function skippedOutputOf(raw: unknown): SkippedOutput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { count, samples } = raw as { count?: unknown; samples?: unknown };
  if (typeof count !== "number" || count <= 0) return null;
  return { count, samples: Array.isArray(samples) ? samples.map(String) : [] };
}

/** The record's credentials_redacted where it is what the harness writes (a count above none, and the names). */
function credentialsRedactedOf(raw: unknown): CredentialsRedacted | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { count, names } = raw as { count?: unknown; names?: unknown };
  if (typeof count !== "number" || count <= 0) return null;
  return { count, names: Array.isArray(names) ? names.map(String) : [] };
}

export function storyEntry(
  id: string, raw: { title?: string; status?: string; accept?: RawAccept | null; conversation?: RawConversation | null; harness_faults?: unknown[]; skipped_output?: unknown; record?: { credentials_redacted?: unknown } | null; not_comparable?: unknown } & RawUsage,
): RecordStory {
  const skipped = skippedOutputOf(raw.skipped_output);
  const redacted = credentialsRedactedOf(raw.record?.credentials_redacted);
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
    conversation: conversationOf(raw.conversation),
    notComparable: notComparableOf(raw.not_comparable),
    ...(Array.isArray(raw.harness_faults) && raw.harness_faults.length ? { harnessFaults: raw.harness_faults } : {}),
    ...(skipped ? { skippedOutput: skipped } : {}),
    ...(redacted ? { credentialsRedacted: redacted } : {}),
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

// ---------- judge ----------

/** A run can be judged once it is finished, re-scored under the current suite, and has its workspace history
 * (workspace.bundle, which the review page rebuilds each story from). */
export function judgeReady(run: { state: string; rescores: string[]; hasBundle: boolean }, job: DbenchJob | null, suite: string): boolean {
  const status = job?.state.status;
  const finished = run.state === "finished" && status !== "running" && status !== "queued";
  return finished && run.rescores.includes(suite) && run.hasBundle;
}

/** One word for where a run is, and where in its work it is: the dbench job's state when there is a job, else the
 * record's. Never why a job failed: that is the faults feed's (server/faults.ts). */
export function runStatus(run: { state: string }, job: DbenchJob | null): { status: RunStatus; note: string } {
  const st = job?.state.status;
  if (st === "running") {
    const prog = job!.progress ?? {};
    const busy = (prog.stories ?? []).find((s) => s.status === "running")?.id;
    const phase = prog.current_story ? "" : busy ? `finishing story ${busy}` : prog.stories?.length ? "between stories" : "starting";
    return { status: "running", note: phase };
  }
  if (st === "queued") return { status: "queued", note: "" };
  if (st === "failed") return { status: "failed", note: "" };
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
  stories: [] as RecordStory[], scores: {} as Record<string, Score>, knownGood: false,
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

/** What the server knows of a run: the page's row, plus what the record and its jobs say that the page never
 * shows (server/faults.ts reads it). */
export interface FullRow extends Row {
  record: {
    invalid: Invalid | null;
    /** What the run's agent ran in (run.json's "sandbox"); null where the record does not say. */
    sandbox: RunSandbox | null;
    finalize: RawFinalize | null;
    /** The record's stories, with their checks and harness faults (the row's `stories` are the page's). */
    stories: RecordStory[];
    rescoreFaults: Record<string, string>;
    hasBundle: boolean;
  };
  /** Every dbench job of the run, whole, oldest first. */
  dbenchJobs: NodeJob[];
}

/** Everything known, per run: invalid runs included. */
export function buildFullRows(
  records: RunRecord[], byNode: Record<string, DbenchJob[]>, suites: Record<string, string>, now: number,
  flowCounts: Record<string, Record<string, number>> = {},
): FullRow[] {
  const queue = queuePositions(byNode);
  const allJobs = jobsByRun(byNode);
  const wholeJobs = dbenchJobsByRun(byNode);
  return assignMachines(mergeRows(records, indexJobs(byNode), now).map(({ job, ...r }): Omit<FullRow, "machine"> => {
    const suite = suites[r.pack] ?? "";
    const recorded = r.stories.map(publicStory);
    const merged = job ? mergeStories(recorded, job.progress?.stories) : recorded;
    const collapsed = collapsedStoryIds(merged);
    const stories = merged.map((st) => (collapsed.has(st.id) ? { ...st, collapsed: true } : st));
    const { invalid, sandbox, finalize, rescoreFaults, hasBundle, rescored: _rescored, rescoreLast: _last, stories: _stories, ...plain } = r;
    return {
      ...plain,
      host: r.host ?? "",
      label: machineLabel(r.stack),
      client: r.client || job?.spec.client || "",
      node: job?.node ?? null,
      family: rowFamily(r, suite),
      suite,
      stories,
      usage: runUsage(recorded), // recorded stories only: a story dbench reports done has no time split yet
      judgeReady: judgeReady(r, job, suite),
      ...(({ status, note }) => ({ status, statusNote: note }))(runStatus(r, job)),
      storiesWorking: storiesWorking(
        stories,
        scopeIds((job?.progress?.stories ?? []).map((st) => String(st.id)), flowCounts[r.packVersion || suite], stories.map((st) => st.id)),
        job?.state.status === "running" ? runningStoryId(job) : null,
        r.rescored?.[suite],
      ),
      live: job ? liveFromJob(job, queue.get(job.id)) : null,
      jobs: allJobs.get(jobKey(r.stack, r.pack, r.runId)) ?? [],
      interventions: r.interventions ?? [],
      record: { invalid: invalid ?? null, sandbox: sandbox ?? null, finalize: finalize ?? null, stories: r.stories, rescoreFaults: rescoreFaults ?? {}, hasBundle },
      dbenchJobs: wholeJobs.get(jobKey(r.stack, r.pack, r.runId)) ?? [],
    };
  }));
}

/** The page's row: without what only the server keeps. */
export function publicRow(f: FullRow): Row {
  const { record: _record, dbenchJobs: _jobs, ...row } = f;
  return row;
}

/** Everything the page needs, per run it shows: a run marked invalid is not among them. */
export function buildRows(
  records: RunRecord[], byNode: Record<string, DbenchJob[]>, suites: Record<string, string>, now: number,
  flowCounts: Record<string, Record<string, number>> = {},
): Row[] {
  return buildFullRows(records, byNode, suites, now, flowCounts).filter((f) => !f.record.invalid).map(publicRow);
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

/** What each node is doing: its running job and the number queued, idle nodes included, by name. Over every run
 * the server knows: a node running or queuing a run the page doesn't show (one marked invalid) is busy, not idle,
 * and that run is named to nobody. */
export function machines(nodes: string[], rows: FullRow[]): Machine[] {
  return nodes.toSorted().map((node) => {
    const mine = rows.filter((r) => r.node === node);
    const live = mine.find((r) => r.live?.status === "running");
    const run = live && !live.record.invalid ? live : null;
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
      busy: Boolean(live) && !run,
      queued: mine.filter((r) => r.live?.status === "queued" && !r.record.invalid).length,
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

export interface RawRescore { finished_at?: string; results?: { story?: number; passed?: number; total?: number; flaky?: number; harness_fault?: string | null }[] }

/** A re-score is a score of record only when the run finished and it re-scored the run's last story (the
 * whole build), and the machine didn't spoil it (harness_fault). A partial re-score still corrects the story
 * squares, but isn't the run's score. */
export function finalScore(rs: RawRescore | null, state: string, lastStory: string | undefined): Score | null {
  const last = rs?.results?.at(-1);
  if (!last || last.harness_fault || state !== "finished" || lastStory === undefined || String(last.story) !== String(Number(lastStory))) return null;
  return { passed: last.passed ?? null, total: last.total ?? null,
    flaky: (rs!.results ?? []).reduce((n, x) => n + (x.flaky ?? 0), 0), at: rs!.finished_at ?? "" };
}

/** What spoiled a re-score, as its last result recorded it (harness_fault); null for none. */
export function rescoreFault(rs: RawRescore | null): string | null {
  const fault = rs?.results?.at(-1)?.harness_fault;
  return typeof fault === "string" && fault.trim() ? fault.trim() : null;
}
