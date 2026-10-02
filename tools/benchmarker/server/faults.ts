// The faults feed (GET /api/faults): every internal-fault condition the server knows of, for the monitor that logs
// and triages them. The page never renders any of it: it presents results, and shows a figure a fault makes
// unreliable as not available. Everything the page used to say about faults (the "Needs you" panel, accounting marks,
// invalid banners, final-score notes, job reasons, the header's source errors) is derivable from here, and nothing
// else is: the kinds below are the whole list.
//
// Pure: from the server's full rows (domain.ts's FullRow), the machines, their reachability and the server's own
// source errors. Each fault's id is stable across calls (kind + what it is about), so a monitor can track one.
import type { Machine } from "../shared/types.ts";
import { endedAt, runningStory, silentMinutes, SILENT_MINUTES } from "../shared/overviewView.ts";
import { jobReason, type FullRow, type NodeJob } from "./domain.ts";

export const FAULT_KINDS = [
  "accounting_failed", "accounting_unchecked", "harness_fault", "agent_output_skipped", "credentials_redacted",
  "not_scored", "rescore_flagged", "live_record_disagree", "no_workspace_bundle", "run_invalid", "run_ended_early",
  "sandbox_not_enforced", "job_failed", "job_cancelled", "job_restarted",
  "machine_unreachable", "machine_no_activity", "machine_idle", "machine_idle_with_queue",
  "fetch_error", "dbench_error",
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export interface Fault {
  /** Stable across calls: the kind and what it is about. */
  id: string;
  kind: FaultKind;
  pack: string;
  combination: string;
  run: string;
  story?: string;
  machine?: string;
  /** ISO; stamped by the server from when it first listed the id (main.ts), not here. */
  firstSeenAt?: string;
  /** The raw facts: recorded strings and numbers, verbatim. */
  detail: Record<string, unknown>;
}

/** How a machine answered the last request: from /api/machines (ops.machines()). */
export interface MachineReach { name: string; url?: string; ok: boolean; error?: string }

export interface FaultsInput {
  rows: FullRow[];
  /** What each dbench node is doing (domain.ts's machines()). */
  machines: Machine[];
  /** The machine list with each one's reachability; null when it couldn't be asked. */
  reach: MachineReach[] | null;
  /** Unix seconds. */
  now: number;
  /** The server's own data-source errors, "" for none. */
  fetchError: string;
  dbenchError: string;
}

/** The last lines of a job's log the server already has. */
const LOG_TAIL_LINES = 10;
const FIRST_PLACE = 1;
const FIRST_ATTEMPT = 1;

const idOf = (parts: (string | number | null | undefined)[]) => parts.map((p) => (p === null || p === undefined ? "" : String(p))).join(":");

/** A fault about a run (or one of its stories or jobs). */
function ofRun(r: FullRow, kind: FaultKind, detail: Record<string, unknown>, about: { story?: string; job?: string } = {}): Fault {
  return {
    id: idOf([kind, r.pack, r.stack, r.runId, about.story, about.job]), kind,
    pack: r.pack, combination: r.stack, run: r.runId, ...(about.story ? { story: about.story } : {}), machine: r.machine, detail,
  };
}

/** A fault about a machine, naming the run it is on when there is one. */
function ofMachine(machine: string, kind: FaultKind, detail: Record<string, unknown>, run?: FullRow | null): Fault {
  return { id: idOf([kind, machine]), kind, pack: run?.pack ?? "", combination: run?.stack ?? "", run: run?.runId ?? "", machine, detail };
}

const scored = (r: FullRow) => { const s = r.scores[r.suite]; return Boolean(s && s.passed !== null && s.total !== null); };

/** The live score after the last story against the score of record: a disagreement when they count the same tests
 * and differ, or when finalize.json's guard flagged the re-score. Null when they agree or can't be compared. */
function liveRecordDisagreement(r: FullRow): Record<string, unknown> | null {
  const guard = r.record.finalize?.guard as { flagged?: unknown } | undefined;
  const flagged = guard?.flagged === true;
  const rec = r.scores[r.suite];
  const last = r.record.stories.toSorted((a, b) => Number(a.id) - Number(b.id)).findLast((s) => s.passed !== null && s.total !== null);
  const comparable = Boolean(rec && rec.passed !== null && rec.total !== null && last && last.total === rec.total);
  const differ = comparable && last!.passed !== rec!.passed;
  if (!differ && !flagged) return null;
  return {
    live: last ? { story: last.id, passed: last.passed, total: last.total } : null,
    record: rec ? { suite: r.suite, passed: rec.passed, total: rec.total } : null,
    guard: guard ?? null,
  };
}

const jobDetail = (j: NodeJob) => ({
  job_id: j.id, node: j.node, status: j.state.status ?? "", attempt: j.state.attempt ?? null, reason: jobReason(j),
  cancel_reason: j.cancel_reason ?? null, log_tail: (j.progress?.log_tail ?? []).slice(-LOG_TAIL_LINES),
  submitted_at: j.submitted_at ?? null, updated_at: j.updated_at ?? null,
});

function runFaults(r: FullRow): Fault[] {
  const out: Fault[] = [];
  const { invalid, finalize, stories, rescoreFaults, hasBundle } = r.record;
  if (invalid) out.push(ofRun(r, "run_invalid", { reason: invalid.reason, since: invalid.since }));
  if (r.status === "failed" || r.status === "stopped") {
    const last = r.dbenchJobs.at(-1);
    out.push(ofRun(r, "run_ended_early", { status: r.status, record_state: r.state, ended_at: endedAt(r), last_job: last ? jobDetail(last) : null }));
  }
  // A partial rerun (knownGood) is diagnostic by design: it never gets a full-suite score or a workspace bundle,
  // so neither absence is a fault to chase.
  if (r.status === "finished" && !invalid && !r.knownGood) {
    if (!scored(r)) {
      out.push(ofRun(r, "not_scored", { suite: r.suite, rescores: r.rescores, rescore_faults: rescoreFaults, has_bundle: hasBundle, finalize: finalize ?? "no finalize record" }));
    }
    if (!hasBundle) out.push(ofRun(r, "no_workspace_bundle", { suite: r.suite }));
  }
  // The agent ran in no sandbox (SPEC_BENCH_SANDBOX=permissive), or the record of the one it ran in is incomplete: the
  // run cannot stand beside runs that did, and the harness refuses to publish it. A record from before the sandbox
  // was recorded says nothing either way, and is not a fault.
  const sandbox = r.record.sandbox;
  if (sandbox && (sandbox.mode !== "enforced" || !sandbox.policyHash)) {
    out.push(ofRun(r, "sandbox_not_enforced", { mode: sandbox.mode, version: sandbox.version, platform: sandbox.platform, policy_hash: sandbox.policyHash }));
  }
  if (finalize?.rescore === "flagged") out.push(ofRun(r, "rescore_flagged", { finalize }));
  const disagree = liveRecordDisagreement(r);
  if (disagree) out.push(ofRun(r, "live_record_disagree", disagree));
  for (const s of stories) {
    const check = s.usage?.split?.check;
    if (check?.status === "problems") out.push(ofRun(r, "accounting_failed", { problems: check.problems, accounting_version: check.version }, { story: s.id }));
    if (check?.status === "unchecked") out.push(ofRun(r, "accounting_unchecked", { accounting_version: check.version }, { story: s.id }));
    // A recorded story with no time split at all has no accounting either: worse than unchecked, never left out.
    if (s.usage && !s.usage.split) out.push(ofRun(r, "accounting_unchecked", { accounting_version: null, time_split: null }, { story: s.id }));
    if (s.harnessFaults?.length) out.push(ofRun(r, "harness_fault", { faults: s.harnessFaults }, { story: s.id }));
    // Lines of the agent's output that were JSON but not events: skipped by the harness, never silently.
    // Credentials the publishing step found in the story's files and replaced before they were committed: names only.
    if (s.credentialsRedacted) out.push(ofRun(r, "credentials_redacted", { count: s.credentialsRedacted.count, names: s.credentialsRedacted.names }, { story: s.id }));
    if (s.skippedOutput) out.push(ofRun(r, "agent_output_skipped", { count: s.skippedOutput.count, samples: s.skippedOutput.samples }, { story: s.id }));
  }
  r.dbenchJobs.forEach((j, i) => {
    const st = j.state.status;
    if (st === "failed") out.push(ofRun(r, "job_failed", jobDetail(j), { job: j.id }));
    if (st === "cancelled") out.push(ofRun(r, "job_cancelled", jobDetail(j), { job: j.id }));
    const place = i + 1;
    if (place > FIRST_PLACE || (j.state.attempt ?? FIRST_ATTEMPT) > FIRST_ATTEMPT) {
      out.push(ofRun(r, "job_restarted", { ...jobDetail(j), place, of: r.dbenchJobs.length }, { job: j.id }));
    }
  });
  return out;
}

function machineFaults({ rows, machines, reach, now }: FaultsInput): Fault[] {
  const out: Fault[] = [];
  const runOn = (node: string) => rows.find((r) => r.node === node && r.live?.status === "running") ?? null;
  for (const m of reach ?? []) {
    if (!m.ok) out.push(ofMachine(m.name, "machine_unreachable", { error: m.error ?? "", url: m.url ?? null }, runOn(m.name)));
    else if (!machines.some((x) => x.node === m.name)) out.push(ofMachine(m.name, "machine_unreachable", { error: "not in dbench's job list", url: m.url ?? null }));
  }
  for (const m of machines) {
    if (reach?.some((x) => x.name === m.node && !x.ok)) continue;
    if (m.running || m.busy) continue;
    out.push(m.queued > 0 ? ofMachine(m.node, "machine_idle_with_queue", { queued: m.queued }) : ofMachine(m.node, "machine_idle", {}));
  }
  for (const r of rows) {
    const minutes = silentMinutes(r, now);
    const story = runningStory(r).story;
    if (minutes !== null && minutes >= SILENT_MINUTES && story && r.node) {
      out.push({ ...ofMachine(r.node, "machine_no_activity", { silent_minutes: Math.round(minutes), story, agent_minutes: r.live?.agentMinutes ?? null, story_started_at: r.live?.storyStartedAt ?? null }, r), story });
    }
  }
  return out;
}

/** Every fault, runs first (in row order), then machines, then the server's own sources. */
export function findFaults(input: FaultsInput): Fault[] {
  const out = input.rows.flatMap(runFaults).concat(machineFaults(input));
  if (input.fetchError) out.push({ id: "fetch_error", kind: "fetch_error", pack: "", combination: "", run: "", detail: { error: input.fetchError } });
  if (input.dbenchError) out.push({ id: "dbench_error", kind: "dbench_error", pack: "", combination: "", run: "", detail: { error: input.dbenchError } });
  return out;
}
