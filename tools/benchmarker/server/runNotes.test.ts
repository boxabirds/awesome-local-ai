// What a run's record says about the run itself, beyond its results: that it is invalid (run.json's "invalid"), and
// what the operator or the harness's watchdog did to it by hand (interventions.md); and when each dbench job ended.
// Each parser by the shapes its input takes in the records: present, absent, every real line format, and malformed.
import { describe, expect, it } from "vitest";
import { buildFullRows, buildRows, jobEndedAt, jobsByRun, parseInterventions, parseInvalid, type DbenchJob, type RunRecord } from "./domain.ts";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const at = (iso: string) => Date.parse(iso) / 1000;

// ---------------------------------------------------------------------------------------------------------------
describe("run.json's invalid", () => {
  it("reason and since, as written", () => {
    expect(parseInvalid({ reason: "read the reference build in story 7", since: "2026-09-30" }))
      .toEqual({ reason: "read the reference build in story 7", since: "2026-09-30" });
  });
  it("absent or null: a valid run", () => {
    expect(parseInvalid(undefined)).toBeNull();
    expect(parseInvalid(null)).toBeNull();
  });
  it("false: a valid run (the mark taken off)", () => expect(parseInvalid(false)).toBeNull());
  it("reason trimmed; since missing or not a string: empty, never a guess", () => {
    expect(parseInvalid({ reason: "  sandbox leak  " })).toEqual({ reason: "sandbox leak", since: "" });
    expect(parseInvalid({ reason: "x", since: 20260930 })).toEqual({ reason: "x", since: "" });
  });
  it("a bare string is its reason", () => expect(parseInvalid("sandbox leak")).toEqual({ reason: "sandbox leak", since: "" }));
  it("marked but with no usable reason (true, an empty reason, an object without one): still invalid, and says so", () => {
    for (const raw of [true, { reason: "" }, { reason: "   " }, { since: "2026-09-30" }, "", 1]) {
      expect(parseInvalid(raw)).toMatchObject({ reason: "marked invalid with no reason given" });
    }
    expect(parseInvalid({ since: "2026-09-30" })).toEqual({ reason: "marked invalid with no reason given", since: "2026-09-30" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("interventions.md", () => {
  it("an operator's line: time, story, text", () => {
    expect(parseInterventions("- 2026-09-26T08:57:29Z story 3: node-c froze; restarted by the operator")).toEqual([
      { at: at("2026-09-26T08:57:29Z"), story: "3", text: "node-c froze; restarted by the operator" },
    ]);
  });
  it("the harness watchdog's line (no bullet, a zero-padded story): the same", () => {
    expect(parseInterventions("2026-09-29T23:00:53Z 05: interrupted a tool call silent for 600s (killed processes under the workspace)")).toEqual([
      { at: at("2026-09-29T23:00:53Z"), story: "5", text: "interrupted a tool call silent for 600s (killed processes under the workspace)" },
    ]);
  });
  it("without a story: about the run as a whole", () => {
    expect(parseInterventions("- 2026-09-25T02:24:46Z held-out suite fixed mid-run")).toEqual([
      { at: at("2026-09-25T02:24:46Z"), story: null, text: "held-out suite fixed mid-run" },
    ]);
  });
  it("a time without seconds, or with a fraction; a '*' bullet; bold marks dropped", () => {
    expect(parseInterventions([
      "- 2026-09-25T16:10Z story 12: harness crashed",
      "* 2026-09-25T16:11:00.5Z **story 12**: resubmitted",
      "- **2026-09-27T19:58Z** run stopped: this run is the **capped variant**",
    ].join("\n"))).toEqual([
      { at: at("2026-09-25T16:10:00Z"), story: "12", text: "harness crashed" },
      { at: at("2026-09-25T16:11:00.5Z"), story: "12", text: "resubmitted" },
      { at: at("2026-09-27T19:58:00Z"), story: null, text: "run stopped: this run is the capped variant" },
    ]);
  });
  it("a heading that starts with a time is one too (canvas-gufo-r3: '## 2026-09-29T07:21Z: harness restarted mid-story 5')", () => {
    expect(parseInterventions("## 2026-09-29T07:21Z: harness restarted mid-story 5 (operator decision)")).toEqual([
      { at: at("2026-09-29T07:21:00Z"), story: null, text: "harness restarted mid-story 5 (operator decision)" },
    ]);
  });
  it("malformed lines are skipped: headings, prose, no time, an impossible time, a time with nothing after it", () => {
    expect(parseInterventions([
      "# Interventions: ab-s7s8-01",
      "",
      "Every manual or automatic intervention in this run, oldest first.",
      "- story 3: no time given",
      "- 2026-13-45T99:00:00Z story 3: not a time",
      "- 2026-09-26T08:57:29Z",
      "- 2026-09-26T08:57:29Z story 4:",
      "- 2026-09-26T09:00:00Z story 4: the one good line",
    ].join("\n"))).toEqual([{ at: at("2026-09-26T09:00:00Z"), story: "4", text: "the one good line" }]);
  });
  it("an empty file, or none: no interventions", () => {
    expect(parseInterventions("")).toEqual([]);
    expect(parseInterventions("\n\n")).toEqual([]);
    expect(parseInterventions(undefined)).toEqual([]);
  });
  it("oldest first, whatever order the file lists them in; Windows line ends too", () => {
    expect(parseInterventions("- 2026-09-27T00:00:00Z story 2: later\r\n- 2026-09-26T00:00:00Z story 1: earlier\r\n").map((i) => i.text)).toEqual(["earlier", "later"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("when a dbench job ended", () => {
  const job = (over: Partial<DbenchJob>): DbenchJob => ({ id: "j", spec: { pack: "benchmarks/vidi", run_id: "v2-r1" }, progress: { combination: SWIFT }, state: { status: "done" }, submitted_at: 1, updated_at: 1, ...over });
  const tail = (...lines: string[]) => ({ combination: SWIFT, log_tail: lines });

  it("the time of dbench's own line recording the end, for done, failed and cancelled jobs", () => {
    expect(jobEndedAt(job({ updated_at: 999, progress: tail("[story 12] done", "[dbench 2026-09-29T02:13:20Z] harness exited 0; job done") }))).toBe(at("2026-09-29T02:13:20Z"));
    expect(jobEndedAt(job({ state: { status: "failed" }, progress: tail("[dbench 2026-09-25T16:13:30Z] harness exited 2; job failed") }))).toBe(at("2026-09-25T16:13:30Z"));
    expect(jobEndedAt(job({ state: { status: "cancelled" }, progress: tail("[dbench 2026-09-29T21:26:41Z] cancelled while queued by 100.86.117.127") }))).toBe(at("2026-09-29T21:26:41Z"));
    expect(jobEndedAt(job({ state: { status: "cancelled" }, progress: tail("[dbench 2026-09-25T03:18:29Z] adopted harness ended; cancelled") }))).toBe(at("2026-09-25T03:18:29Z"));
  });
  it("the last such line when there are several (a job restarted in place)", () => {
    expect(jobEndedAt(job({ progress: tail("[dbench 2026-09-28T00:00:00Z] harness exited 0; job done", "[dbench 2026-09-29T00:00:00Z] harness exited 0; job done") }))).toBe(at("2026-09-29T00:00:00Z"));
  });
  it("no end line in the tail: dbench's updated_at", () => {
    expect(jobEndedAt(job({ updated_at: 1790648000, progress: tail("[story 12] still talking") }))).toBe(1790648000);
    expect(jobEndedAt(job({ updated_at: 1790648000, progress: undefined }))).toBe(1790648000);
    expect(jobEndedAt(job({ updated_at: 1790648000, progress: tail("[dbench not-a-time] harness exited 0; job done") }))).toBe(1790648000);
  });
  it("neither: unknown", () => expect(jobEndedAt(job({ updated_at: undefined, progress: undefined }))).toBeNull());
  it("a queued or running job hasn't ended, whatever its tail says", () => {
    for (const status of ["queued", "running"]) {
      expect(jobEndedAt(job({ state: { status }, progress: tail("[dbench 2026-09-29T02:13:20Z] harness exited 0; job done") }))).toBeNull();
    }
  });
  it("each of a run's jobs carries its end time", () => {
    const jobs = [...jobsByRun({ "node-a": [job({ id: "a", updated_at: 500, submitted_at: 1 }), job({ id: "b", state: { status: "running" }, updated_at: 600, submitted_at: 2 })] }).values()][0];
    expect(jobs.map((j) => [j.id, j.endedAt])).toEqual([["a", 500], ["b", null]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the record's invalid mark and interventions: the server keeps both, the page gets only the interventions", () => {
  const rec = (over: Partial<RunRecord>): RunRecord => ({ pack: "vidi", stack: SWIFT, runId: "v2-r1", dir: "d", rescores: [], rescoreLast: {}, hasBundle: false,
    host: "", packVersion: "", state: "finished", stateAt: "", stories: [], scores: {}, ...over });
  const iv = { at: 100, story: "3", text: "froze" };

  it("the full row has the mark; the page's rows leave the run out altogether", () => {
    const records = [rec({ invalid: { reason: "leak", since: "2026-09-30" }, interventions: [iv] }), rec({ runId: "v2-r2" })];
    const full = buildFullRows(records, {}, {}, 0);
    expect(full.map((r) => [r.runId, r.record.invalid])).toEqual([["v2-r1", { reason: "leak", since: "2026-09-30" }], ["v2-r2", null]]);
    expect(full[0].interventions).toEqual([iv]);
    const rows = buildRows(records, {}, {}, 0);
    expect(rows.map((r) => r.runId)).toEqual(["v2-r2"]);
    expect(rows[0]).not.toHaveProperty("record");
    expect(rows[0]).not.toHaveProperty("dbenchJobs");
  });
  it("an invalid run's job goes with it: neither the run nor a row for its job is shown", () => {
    const jobs = { "node-a": [{ id: "j", spec: { pack: "benchmarks/vidi", run_id: "v2-r1" }, progress: { combination: SWIFT }, state: { status: "running" } }] };
    expect(buildRows([rec({ invalid: { reason: "leak", since: "" } })], jobs, {}, 0)).toEqual([]);
  });
  it("a record without them (older records, fixtures): valid, and none", () => {
    const [r] = buildFullRows([rec({})], {}, {}, 0);
    expect(r.record.invalid).toBeNull();
    expect(r.interventions).toEqual([]);
  });
  it("a job with no record yet: valid, and none", () => {
    const [r] = buildFullRows([], { "node-a": [{ id: "j", spec: { pack: "benchmarks/vidi", run_id: "v2-r2" }, progress: { combination: SWIFT }, state: { status: "queued" } }] }, {}, 0);
    expect(r.record.invalid).toBeNull();
    expect(r.interventions).toEqual([]);
  });
});
