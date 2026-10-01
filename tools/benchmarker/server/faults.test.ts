// The faults feed (GET /api/faults): every internal-fault condition the server knows of, for the monitor. Over the
// e2e fixture, the same data the pages are tested on: every condition the old pages used to show (the "Needs you"
// panel's kinds, the accounting marks, the invalid banner, the final-score notes, the job reasons, the header's
// source errors) must be here, and nothing here is of an unknown kind.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Machine } from "../shared/types.ts";
import { buildFullRows, machines, type DbenchJob, type RunRecord } from "./domain.ts";
import { FAULT_KINDS, findFaults, type Fault, type FaultsInput } from "./faults.ts";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const VK = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const MIN = 60;

interface Fixture { records: RunRecord[]; suites: Record<string, string>; jobs: Record<string, DbenchJob[]>; flowCounts: Record<string, Record<string, number>> }
const fixture = (): Fixture => JSON.parse(readFileSync(new URL("../e2e/fixture.json", import.meta.url), "utf8")) as Fixture;

/** The feed over the fixture at `now`, with the machines all reachable unless `reach` says otherwise, and the
 * running stories' progress up to date unless `change` moves one. */
function feed(opts: { now?: number; reach?: FaultsInput["reach"]; fetchError?: string; dbenchError?: string; change?: (f: Fixture) => void; silentStory?: boolean } = {}): Fault[] {
  const f = fixture();
  opts.change?.(f);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  // The fixture's running stories started on fixed dates: bring their progress up to date, so none is silent unless
  // a test makes it so (its `change` runs first and wins).
  for (const jobs of Object.values(f.jobs)) {
    for (const j of jobs) {
      j.updated_at ??= now;
      for (const s of j.progress?.stories ?? []) if (s.status === "running" && !opts.silentStory) s.started_at = now - (s.agent_minutes ?? 0) * MIN;
    }
  }
  const rows = buildFullRows(f.records, f.jobs, f.suites, now, f.flowCounts);
  const ms: Machine[] = machines(Object.keys(f.jobs), rows);
  const reach = opts.reach === undefined ? Object.keys(f.jobs).map((name) => ({ name, ok: true })) : opts.reach;
  return findFaults({ rows, machines: ms, reach, now, fetchError: opts.fetchError ?? "", dbenchError: opts.dbenchError ?? "" });
}
const ofKind = (fs: Fault[], kind: Fault["kind"]) => fs.filter((f) => f.kind === kind);
const about = (fs: Fault[], kind: Fault["kind"], run: string, story?: string) => fs.find((f) => f.kind === kind && f.run === run && (story === undefined || f.story === story));

describe("the faults feed over the fixture", () => {
  const fs = feed();

  it("every fault has a kind from the list, a stable id, and the fields the monitor keys on", () => {
    for (const f of fs) {
      expect(FAULT_KINDS).toContain(f.kind);
      expect(f.id).toMatch(new RegExp(`^${f.kind}`));
      for (const k of ["id", "kind", "pack", "combination", "run", "detail"]) expect(f).toHaveProperty(k);
    }
    expect(new Set(fs.map((f) => f.id)).size).toBe(fs.length);
    expect(feed().map((f) => f.id)).toEqual(fs.map((f) => f.id));   // the same data gives the same ids
  });

  it("a run marked invalid (the old banner and struck-through names): its reason and date", () => {
    const f = about(fs, "run_invalid", "v2-r8")!;
    expect(f).toMatchObject({ pack: "vidi", combination: SWIFT, machine: "node-a" });
    expect(f.detail).toEqual({ reason: "read the reference build in story 2, through a clone of the repo the sandbox did not hide", since: "2026-09-30" });
  });

  it("a story whose time split failed its check (the old ⚠ mark and 'Likely cause'): the problems verbatim and the accounting version", () => {
    const f = about(fs, "accounting_failed", "v2-r1", "1")!;
    expect(f).toMatchObject({ combination: SWIFT, story: "1" });
    expect(f.detail).toEqual({ problems: ["tool call t9 never ended; counted to the agent's next step"], accounting_version: null });
  });

  it("a story with no accounting (the old 'unchecked' chip): listed, with the version it has", () => {
    expect(about(fs, "accounting_unchecked", "run-9", "1")).toMatchObject({ combination: OPUS, detail: { accounting_version: null } });
  });

  it("a recorded story with no time split at all (55 published stories on 1 Oct 2026): listed as unchecked, never left out", () => {
    const fs2 = feed({ change: (f) => {
      const r = f.records.find((x) => x.runId === "v2-r1" && x.stack.includes("3.8-swift-1.5"))!;
      (r.stories[0].usage as { split: unknown }).split = null;
    } });
    const id = fixture().records.find((x) => x.runId === "v2-r1" && x.stack.includes("3.8-swift-1.5"))!.stories[0].id;
    expect(about(fs2, "accounting_unchecked", "v2-r1", String(id))).toMatchObject({ detail: { accounting_version: null, time_split: null } });
  });

  it("a finished run with no score of record (the old 'Final score pending/needs a person' notes): finalize.json whole, or that there is none", () => {
    expect(about(fs, "not_scored", "v2-r1")!.detail).toMatchObject({
      suite: "vidi-v2.0-pre1", has_bundle: true,
      finalize: { rescore: "failed", needs_person: true, attempts: 3, last_attempt_at: "2026-09-29T07:30:00Z", reason: expect.stringContaining("build failed in the re-score") },
    });
    expect(about(fs, "not_scored", "v2-r2")!.detail).toMatchObject({ finalize: { rescore: "skipped", needs_person: false, attempts: 2 } });
    expect(about(fs, "not_scored", "v2-r7")!.detail).toMatchObject({ finalize: { rescore: "skipped" }, rescores: ["vidi-v2.0-pre0"] });
    expect(about(fs, "not_scored", "canvas-gufo-r3")!.detail).toMatchObject({ finalize: "no finalize record" });
    // A scored run is not listed, nor is one that isn't finished.
    expect(about(fs, "not_scored", "v2-r5")).toBeUndefined();
    expect(ofKind(fs, "not_scored").map((f) => f.run)).not.toContain("v2-r3");
  });

  it("a finished run without its workspace history (the old 'Judge: needs workspace.bundle'): listed", () => {
    expect(ofKind(fs, "no_workspace_bundle").map((f) => f.run)).toEqual(["canvas-gufo-r3"]);
  });

  it("a re-score the guard flagged, and a live score that disagrees with the record: listed with both numbers", () => {
    const flagged = feed({ change: (f) => { f.records.find((r) => r.runId === "v2-r5")!.finalize = { rescore: "flagged", reason: "guard", guard: { flagged: true } }; } });
    expect(about(flagged, "rescore_flagged", "v2-r5")!.detail).toMatchObject({ finalize: { rescore: "flagged" } });
    expect(about(flagged, "live_record_disagree", "v2-r5")!.detail).toMatchObject({ guard: { flagged: true } });
    const differ = feed({ change: (f) => { const r = f.records.find((r) => r.runId === "v2-r5")!; r.stories.at(-1)!.passed = 60; r.stories.at(-1)!.total = 75; } });
    expect(about(differ, "live_record_disagree", "v2-r5")!.detail).toMatchObject({ live: { passed: 60, total: 75 }, record: { passed: 63, total: 75 } });
    expect(about(fs, "live_record_disagree", "v2-r5")).toBeUndefined();   // the fixture's agree
  });

  it("a story's harness faults: verbatim", () => {
    const faults = [{ step: "record", error: "git push failed" }];
    const withFault = feed({ change: (f) => { f.records.find((r) => r.runId === "v2-r5")!.stories[0].harnessFaults = faults; } });
    expect(about(withFault, "harness_fault", "v2-r5", "1")!.detail).toEqual({ faults });
    expect(ofKind(fs, "harness_fault")).toEqual([]);
  });

  it("a cancelled or failed dbench job (the old Reason column): its id, reason as dbench kept it, and log tail", () => {
    const cancelled = about(fs, "job_cancelled", "v2-r5")!;
    expect(cancelled.detail).toMatchObject({ job_id: "vidi-v2b-swift15-r5", node: "node-a", status: "cancelled", reason: "stopped by the operator" });
    expect(Array.isArray(cancelled.detail.log_tail)).toBe(true);
    expect(about(fs, "job_cancelled", "v2-r2")).toMatchObject({ combination: "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi" });
    const failed = feed({ change: (f) => { f.jobs["node-a"][0].state = { status: "failed", reason: "harness exited 1 on attempt 4; all 3 restarts used", attempt: 4 }; } });
    expect(about(failed, "job_failed", "v2-r1")!.detail).toMatchObject({ reason: "harness exited 1 on attempt 4; all 3 restarts used", attempt: 4 });
  });

  it("a restarted job (the old 'restarted once: 2 jobs'): the later job with its place", () => {
    expect(about(fs, "job_restarted", "v2-r5")!.detail).toMatchObject({ job_id: "vidi-v2b-swift15-r5-again1", place: 2, of: 2 });
    const attempt = feed({ change: (f) => { f.jobs["node-a"][0].state.attempt = 2; } });
    expect(about(attempt, "job_restarted", "v2-r1")!.detail).toMatchObject({ attempt: 2, place: 1, of: 1 });
  });

  it("a run that ended early (the old 'ended early' item): its status, end and last job", () => {
    const f = feed({ change: (f) => { f.records.find((r) => r.runId === "v2-r5")!.state = "failed"; f.jobs["node-a"] = f.jobs["node-a"].filter((j) => !j.id.startsWith("vidi-v2b-swift15-r5")); } });
    expect(about(f, "run_ended_early", "v2-r5")!.detail).toMatchObject({ status: "failed", record_state: "failed" });
  });

  it("an idle machine (the old 'idle' item), and one with a queue but nothing running", () => {
    expect(ofKind(fs, "machine_idle").map((f) => f.machine)).toEqual(["node-d"]);
    const queued = feed({ change: (f) => { f.jobs["node-d"] = [{ id: "q", spec: { pack: "benchmarks/vidi", run_id: "x" }, progress: { combination: VK }, state: { status: "queued" } }]; } });
    expect(ofKind(queued, "machine_idle_with_queue")).toMatchObject([{ machine: "node-d", detail: { queued: 1 } }]);
    expect(ofKind(queued, "machine_idle")).toEqual([]);
  });

  it("an unreachable machine (the old 'unreachable' item): its error and address; one listed but not in the job list too", () => {
    const f = feed({ reach: [{ name: "node-a", ok: false, error: "connection refused", url: "http://node-a:7717" }, { name: "node-e", ok: true }] });
    expect(ofKind(f, "machine_unreachable")).toMatchObject([
      { machine: "node-a", run: "v2-r1", detail: { error: "connection refused", url: "http://node-a:7717" } },
      { machine: "node-e", detail: { error: "not in dbench's job list" } },
    ]);
    expect(ofKind(f, "machine_idle").map((x) => x.machine)).toContain("node-d");
  });

  it("a running story with no activity (the old 'no activity' item): the machine, the run, the story and the minutes", () => {
    const now = Math.floor(Date.now() / 1000);
    const f = feed({ now, silentStory: true, change: (f) => {
      for (const jobs of Object.values(f.jobs)) for (const j of jobs) for (const s of j.progress?.stories ?? []) if (s.status === "running") s.started_at = now - (s.agent_minutes ?? 0) * MIN;
      const s = f.jobs["node-a"][0].progress!.stories!.find((x) => x.status === "running")!; s.agent_minutes = 20; s.started_at = now - 40 * MIN;
    } });
    expect(ofKind(f, "machine_no_activity")).toMatchObject([{ machine: "node-a", run: "v2-r1", story: "3", detail: { silent_minutes: 20 } }]);
    expect(ofKind(fs, "machine_no_activity")).toEqual([]);
  });

  it("the server's own source errors (the old header strip): verbatim", () => {
    const f = feed({ fetchError: "git fetch: exit 128", dbenchError: "dbench: not found" });
    expect(ofKind(f, "fetch_error")).toEqual([{ id: "fetch_error", kind: "fetch_error", pack: "", combination: "", run: "", detail: { error: "git fetch: exit 128" } }]);
    expect(ofKind(f, "dbench_error")[0].detail).toEqual({ error: "dbench: not found" });
    expect(ofKind(fs, "fetch_error")).toEqual([]);
  });

  it("MECE: every kind the old pages showed is a kind here, and the fixture exercises each run-level one", () => {
    const exercised = new Set(fs.map((f) => f.kind));
    for (const k of ["run_invalid", "accounting_failed", "accounting_unchecked", "not_scored", "no_workspace_bundle", "job_cancelled", "job_restarted", "machine_idle"]) expect(exercised).toContain(k);
  });
});
