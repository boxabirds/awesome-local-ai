import { describe, expect, it } from "vitest";
import {
  findRuns, versionFamily, rowFamily, webBase, indexJobs, queuePositions, liveFromJob, storyEntry,
  mergeStories, judgeReady, mergeRows, machines, assignMachines, runStatus, countTests, storiesWorking, finalScore, rescoreFault, runUsage, RECENT_S, type DbenchJob,
  jobsByRun, jobReason, buildRows, buildFullRows, parseFinalize, publicStory, type FullRow, type RecordStory,
} from "./domain.ts";
import type { Row } from "../shared/types.ts";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";

const PATHS = [
  `combinations/${SWIFT}/benchmarks/vidi/v2-r1/run.json`,
  `combinations/${SWIFT}/benchmarks/vidi/v2-r1/run-status.json`,
  `combinations/${SWIFT}/benchmarks/vidi/v2-r1/stories/01/accept.json`,
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/run.json",
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/rescore/vidi-v1.3.2/rescore.json",
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/rescore/vidi-v1.3.2/stories/03/accept.json",
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/rescore/vidi-v1.3.2/stories/12/accept.json",
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/workspace.bundle",
  "benchmarks/reference/vidi/opus-5.5/run-3/run.json",
  "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/perf/results.json",
];

function job(over: Partial<DbenchJob> & { id: string }): DbenchJob {
  return {
    spec: { pack: "benchmarks/vidi", run_id: "v2-r1" },
    progress: { combination: SWIFT },
    state: { status: "queued" },
    submitted_at: 1,
    updated_at: 1,
    ...over,
  };
}

describe("finding runs", () => {
  it("finds runs by their run.json under combinations and reference", () => {
    const runs = findRuns(PATHS);
    expect(runs.map((r) => [r.pack, r.stack, r.runId])).toEqual([
      ["vidi", SWIFT, "v2-r1"],
      ["vidi", "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi", "canvas-gufo-r3"],
      ["vidi", "reference/opus-5.5", "run-3"],
    ]);
    expect(runs[1].rescores).toEqual(["vidi-v1.3.2"]);
    expect(runs[1].rescoreLast).toEqual({ "vidi-v1.3.2": "12" }); // the latest re-scored story per version
    expect(runs[1].hasBundle).toBe(true);
    expect(runs[0].rescores).toEqual([]);
    expect(runs[0].hasBundle).toBe(false);
  });
  it("finds a re-score's latest story from its public summary, the only file a record has since 30 Sep 2026", () => {
    const dir = `combinations/${SWIFT}/benchmarks/vidi/v2-r2`;
    const runs = findRuns([`${dir}/run.json`, `${dir}/rescore/vidi-v2.0-pre2/rescore.json`,
      `${dir}/rescore/vidi-v2.0-pre2/stories/03/accept-summary.json`, `${dir}/rescore/vidi-v2.0-pre2/stories/12/accept-summary.json`,
      `${dir}/rescore/vidi-v2.0-pre2/stories/12/accept-report.json`]);
    expect(runs[0].rescoreLast).toEqual({ "vidi-v2.0-pre2": "12" });
  });
});

describe("versions", () => {
  it("a version family is the tag up to its major number", () => {
    expect(versionFamily("vidi-v2.0-pre1")).toBe("vidi-v2");
    expect(versionFamily("vidi-v1.3.2")).toBe("vidi-v1");
    expect(versionFamily("vidi-v1.1+e9b0291f-dirty")).toBe("vidi-v1");
    expect(versionFamily("")).toBe("");
  });
  it("a record without a pack version is unversioned, a job without a record runs the current one", () => {
    expect(rowFamily({ dir: "x", packVersion: "" }, "vidi-v2.0-pre1")).toBe("unversioned");
    expect(rowFamily({ dir: "x", packVersion: "3f2a1bc" }, "vidi-v2.0-pre1")).toBe("unversioned");
    expect(rowFamily({ dir: "x", packVersion: "vidi-v1.1" }, "vidi-v2.0-pre1")).toBe("vidi-v1");
    expect(rowFamily({ dir: null, packVersion: "" }, "vidi-v2.0-pre1")).toBe("vidi-v2");
  });
});

describe("links", () => {
  it("point at the repo on GitHub whatever the remote form", () => {
    expect(webBase("git@github.com:boxabirds/awesome-local-ai.git")).toBe("https://github.com/boxabirds/awesome-local-ai");
    expect(webBase("https://github.com/boxabirds/awesome-local-ai")).toBe("https://github.com/boxabirds/awesome-local-ai");
    expect(webBase("/some/local/path")).toBeNull();
  });
});

describe("dbench jobs", () => {
  it("are matched to runs by stack, pack and run id; the newest job wins", () => {
    const idx = indexJobs({
      "node-a": [
        job({ id: "new", state: { status: "running" }, updated_at: 2 }),
        job({ id: "old", state: { status: "failed" }, updated_at: 1 }),
      ],
    });
    const j = idx.get(`${SWIFT}\u0000vidi\u0000v2-r1`);
    expect(j?.id).toBe("new");
    expect(j?.node).toBe("node-a");
  });

  it("queued jobs know their place and what is ahead, in dbench's order", () => {
    const q = queuePositions({
      "node-a": [
        job({ id: "s1", state: { status: "running" }, spec: { pack: "benchmarks/vidi", run_id: "v2-r1" } }),
        job({ id: "s3", spec: { pack: "benchmarks/vidi", run_id: "v2-r3" }, submitted_at: 5, seq: 2 }),
        job({ id: "s2", spec: { pack: "benchmarks/vidi", run_id: "v2-r2" }, submitted_at: 5, seq: 1 }),
        job({ id: "b1", spec: { pack: "benchmarks/vidi", run_id: "v2-r1" }, submitted_at: 5, seq: 3,
              progress: { combination: "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi" } }),
        job({ id: "old", state: { status: "cancelled" } }),
      ],
    });
    expect(q.get("s2")).toEqual({ position: 2, ahead: ["3.8-swift-1.5/27b v2-r1 (running)"] });
    expect(q.get("b1")?.position).toBe(4);
    expect(q.get("b1")?.ahead).toEqual([
      "3.8-swift-1.5/27b v2-r1 (running)", "3.8-swift-1.5/27b v2-r2", "3.8-swift-1.5/27b v2-r3",
    ]);
    expect(q.has("s1")).toBe(false);
    expect(q.has("old")).toBe(false);
  });

  it("a job being restarted goes to the front of the queue", () => {
    const q = queuePositions({
      n: [job({ id: "first", submitted_at: 1 }), job({ id: "restart", submitted_at: 9, attempt: 2 })],
    });
    expect(q.get("restart")?.position).toBe(1);
    expect(q.get("first")?.position).toBe(2);
  });
});

describe("live numbers", () => {
  it("come from the running story, not the last listed", () => {
    const live = liveFromJob(job({
      id: "j", state: { status: "running", attempt: 1 },
      progress: {
        combination: SWIFT, current_story: "1", log_tail: ["[story 1] agent starting"],
        stories: [
          { id: "1", status: "running", agent_minutes: 6, calls: 32, output_tokens: 36199, started_at: 100,
            tasks: [{ status: "written" }, { status: "written" }, { status: "not-started" }],
            recent_activity: ["bash: npm run build", "bash: npx vitest run"] },
          { id: "2", status: "pending" },
          { id: "12", status: "pending" },
        ],
      },
    }), undefined);
    expect([live.currentStory, live.agentMinutes, live.calls, live.outputTokens]).toEqual(["1", 6, 32, 36199]);
    expect([live.tasksWritten, live.tasksTotal]).toEqual([2, 3]);
    expect(live.lastActivity).toBe("bash: npx vitest run");
    expect(live.storyStartedAt).toBe(100);
  });
});

describe("stories", () => {
  it("a recorded story has its whole-suite and own results", () => {
    const st = storyEntry("2", {
      title: "Sticky", status: "DONE",
      accept: { passed: 19, total: 20, by_story: { "01": { passed: 10, total: 10 }, "02": { passed: 9, total: 10 } } },
    });
    expect([st.passed, st.total, st.ownPassed, st.ownTotal]).toEqual([19, 20, 9, 10]);
  });

  it("a story marked not comparable carries the reason to the page; a story without the mark carries none", () => {
    const REASON = "This story run also built stories 11 and 12.";
    expect(storyEntry("10", { not_comparable: REASON }).notComparable).toBe(REASON);
    expect(publicStory(storyEntry("10", { not_comparable: REASON })).notComparable).toBe(REASON);
    for (const none of [undefined, null, "", "  ", false]) expect(storyEntry("1", { not_comparable: none }).notComparable).toBeNull();
    // A mark that gives no reason is still a mark: never silently dropped.
    expect(storyEntry("1", { not_comparable: true }).notComparable).toBe("no reason recorded");
  });

  it("finished stories come from dbench (own tests) before git catches up", () => {
    const recorded = [{ id: "1", title: "Pan", status: "DONE", passed: 6, total: 6, ownPassed: 6, ownTotal: 6 }];
    const merged = mergeStories(recorded, [
      { id: "1", status: "DONE", passed: 6, total: 6, title: "Pan" },
      { id: "2", status: "DONE", passed: 9, total: 10, title: "Sticky" },
      { id: "3", status: "running" },
      { id: "4", status: "pending" },
    ]);
    expect(merged).toEqual([
      recorded[0],
      { id: "2", title: "Sticky", status: "DONE", passed: null, total: null, ownPassed: 9, ownTotal: 10 },
    ]);
  });
});

describe("judgeReady", () => {
  const run = { state: "started", rescores: [] as string[], hasBundle: false };
  it("a run can be judged once finished, re-scored under the current suite, and with its workspace history", () => {
    expect(judgeReady(run, job({ id: "j", state: { status: "running" }, progress: { current_story: "3" } }), "vidi-v2.0")).toBe(false);
    const done = { state: "finished", rescores: [] as string[], hasBundle: true };
    expect(judgeReady(done, null, "vidi-v2.0")).toBe(false);
    expect(judgeReady({ ...done, rescores: ["vidi-v2.0"] }, null, "vidi-v2.0")).toBe(true);
    expect(judgeReady({ ...done, rescores: ["vidi-v2.0"], hasBundle: false }, null, "vidi-v2.0")).toBe(false);
    expect(judgeReady({ ...done, rescores: ["vidi-v2.0"] }, job({ id: "j", state: { status: "queued" } }), "vidi-v2.0")).toBe(false);
  });
});

describe("indexing jobs by run", () => {
  it("a run shows its live job: a restart queued in the same second as the cancel beats the cancelled one", () => {
    const spec = { pack: "benchmarks/vidi", run_id: "v2-r1" };
    const idx = indexJobs({ n: [
      job({ id: "old", spec, state: { status: "cancelled" }, updated_at: 100 }),
      job({ id: "old-again1", spec, state: { status: "queued" }, updated_at: 100 }),
    ] });
    expect([...idx.values()].map((j) => j.id)).toEqual(["old-again1"]);
  });
});

describe("every job of a run", () => {
  const spec = { pack: "benchmarks/vidi", run_id: "v2-r1" };

  it("lists a run's jobs oldest first, whatever node or order dbench gives them in", () => {
    const by = jobsByRun({
      "node-a": [job({ id: "v2-r1-again1", spec, state: { status: "running" }, submitted_at: 300, updated_at: 400 }),
                job({ id: "v2-r1", spec, state: { status: "cancelled", reason: "stopped by the operator" }, submitted_at: 100, updated_at: 200 })],
    });
    const jobs = [...by.values()][0];
    expect(jobs.map((j) => j.id)).toEqual(["v2-r1", "v2-r1-again1"]);
    expect(jobs[0]).toEqual({ id: "v2-r1", node: "node-a", status: "cancelled", submittedAt: 100, updatedAt: 200, endedAt: 200 });
    expect(jobs[0]).not.toHaveProperty("reason");   // a job's reason is the faults feed's, never the page's
  });

  // 1 Oct 2026: a job cancelled after its preflight failed showed "none given" (dbench kept no reason then).
  const SONNET_TAIL = [
    "[dbench 2026-10-01T00:48:12Z] submitted by 100.86.117.127",
    "[dbench 2026-10-01T00:48:15Z] git pull --ff-only: ok",
    "  ok  held-out suite is hidden",
    "PREFLIGHT FAILED (claude): Claude Code did not complete a session in the sandbox (token missing or invalid?)",
    "EEXIST: file already exists, mkdir '/tmp/claude-501'",
    "",
    "preflight failed; not starting the run",
    "[dbench 2026-10-01T00:49:26Z] harness exited 1; stopping processes left in its group",
    "[dbench 2026-10-01T00:49:26Z] harness exited 1; restarting in 30s",
    "[dbench 2026-10-01T00:49:56Z] cancelled while queued by 100.86.117.127",
    "[dbench 2026-10-01T00:49:58Z] git pull --ff-only: ok",
  ];
  const reasonOf = (j: Parameters<typeof job>[0]) => jobReason(job(j));

  it("a cancel's reason is the one dbench kept with it", () => {
    expect(reasonOf({ id: "a", spec, state: { status: "cancelled" }, cancel_reason: "made room for a rerun",
                      progress: { log_tail: SONNET_TAIL } })).toBe("made room for a rerun");
  });

  it("a cancel with no reason kept says so, with the failure its log shows before the cancel", () => {
    expect(reasonOf({ id: "a", spec, state: { status: "cancelled" }, progress: { log_tail: SONNET_TAIL } })).toBe(
      "no reason recorded; before the cancel its log shows: PREFLIGHT FAILED (claude): Claude Code did not complete a session in the sandbox (token missing or invalid?)");
  });

  it("without a failure in its log, the harness's exit before the cancel", () => {
    const tail = ["[dbench 2026-10-01T00:49:26Z] harness exited 2; restarting in 30s",
                  "[dbench 2026-10-01T00:49:56Z] cancelled while queued by 100.86.117.127"];
    expect(reasonOf({ id: "a", spec, state: { status: "cancelled" }, progress: { log_tail: tail } })).toBe(
      "no reason recorded; before the cancel its log shows: harness exited 2; restarting in 30s");
  });

  it("a job cancelled before it ever ran, with no reason kept, has none to show", () => {
    const tail = ["[dbench 2026-10-01T00:48:12Z] submitted by 100.86.117.127",
                  "[dbench 2026-10-01T00:49:53Z] cancelled while queued by 100.86.117.127"];
    expect(reasonOf({ id: "a", spec, state: { status: "cancelled" }, progress: { log_tail: tail } })).toBe("");
  });

  it("a failure seen after the cancel (a later attempt) isn't taken as its reason", () => {
    const tail = ["[dbench 2026-10-01T00:49:56Z] cancel requested by 100.86.117.127",
                  "PREFLIGHT FAILED (claude): later"];
    expect(reasonOf({ id: "a", spec, state: { status: "cancelled" }, progress: { log_tail: tail } })).toBe("");
  });

  it("keeps different runs, packs and combinations apart", () => {
    const by = jobsByRun({ n: [
      job({ id: "a", spec }),
      job({ id: "b", spec: { pack: "benchmarks/vidi", run_id: "v2-r2" } }),
      job({ id: "c", spec: { pack: "benchmarks/todoodle", run_id: "v2-r1" } }),
      job({ id: "d", spec, progress: { combination: "reference/opus-5.5" } }),
    ] });
    expect([...by.values()].map((js) => js.map((j) => j.id))).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("each row carries its own jobs, and a run with no job has none", () => {
    const rec = { pack: "vidi", stack: SWIFT, runId: "v2-r1", dir: "d", rescores: [], rescoreLast: {}, hasBundle: false,
      host: "", packVersion: "", state: "finished", stateAt: "", stories: [], scores: {} };
    const rows = buildRows([rec, { ...rec, runId: "v2-r9", dir: "e" }], { "node-a": [job({ id: "j1", spec, state: { status: "done" } })] }, {}, 0);
    expect(rows.find((r) => r.runId === "v2-r1")!.jobs.map((j) => j.id)).toEqual(["j1"]);
    expect(rows.find((r) => r.runId === "v2-r9")!.jobs).toEqual([]);
  });

  it("each row carries its record's client, else its job's; one that names none has \"\"", () => {
    const rec = { pack: "vidi", stack: SWIFT, runId: "v2-r1", dir: "d", rescores: [], rescoreLast: {}, hasBundle: false,
      host: "", packVersion: "", state: "finished", stateAt: "", stories: [], scores: {} };
    const rows = buildRows([{ ...rec, client: "claude" }, { ...rec, runId: "v2-r9", dir: "e" }], { "node-a": [
      job({ id: "j2", spec: { pack: "benchmarks/vidi", run_id: "v2-r3", client: "claude" }, state: { status: "queued" } }),
      job({ id: "j3", spec: { pack: "benchmarks/vidi", run_id: "v2-r4" }, state: { status: "queued" } }),
    ] }, {}, 0);
    expect(Object.fromEntries(rows.map((r) => [r.runId, r.client]))).toEqual({ "v2-r1": "claude", "v2-r9": "", "v2-r3": "claude", "v2-r4": "" });
  });
});

describe("merging runs and jobs", () => {
  it("jobs without a record appear; old finished or cancelled ones don't", () => {
    const now = 1_000_000;
    const jobs = indexJobs({
      n: [
        job({ id: "q", state: { status: "queued" }, spec: { pack: "benchmarks/vidi", run_id: "q" }, updated_at: now - 99_999 }),
        job({ id: "r", state: { status: "running" }, spec: { pack: "benchmarks/vidi", run_id: "r" }, updated_at: now - 99_999 }),
        job({ id: "f", state: { status: "failed" }, spec: { pack: "benchmarks/vidi", run_id: "f" }, updated_at: now - 3600 }),
        job({ id: "c", state: { status: "cancelled" }, spec: { pack: "benchmarks/vidi", run_id: "c" }, updated_at: now - 2 * RECENT_S }),
      ],
    });
    const rows = mergeRows([], jobs, now);
    expect(rows.map((r) => r.runId).sort()).toEqual(["f", "q", "r"]);
    expect(rows[0].stories).toEqual([]);
  });

  it("a job that finished without recording anything (a smoke test) isn't a run; a recent cancel or failure shows", () => {
    const now = 1_000_000;
    const jobs = indexJobs({
      n: [
        job({ id: "c", state: { status: "cancelled" }, spec: { pack: "benchmarks/vidi", run_id: "c" }, updated_at: now - 60 }),
        job({ id: "smoke", state: { status: "done" }, spec: { pack: "benchmarks/vidi", run_id: "smoke" }, updated_at: now - 60 }),
        job({ id: "f", state: { status: "failed" }, spec: { pack: "benchmarks/vidi", run_id: "f" }, updated_at: now - 60 }),
      ],
    });
    expect(mergeRows([], jobs, now).map((r) => r.runId).sort()).toEqual(["c", "f"]);
  });
});

describe("machines", () => {
  const row = (stack: string, runId: string, node: string, status: string, story: string | null = null) =>
    ({ stack, runId, node, pack: "vidi", live: { status, currentStory: story, agentMinutes: 25 } }) as unknown as Row;
  const full = (r: Row, invalid = false): FullRow => ({ ...r, record: { invalid: invalid ? { reason: "x", since: "" } : null, finalize: null, stories: [], rescoreFaults: {}, hasBundle: false }, dbenchJobs: [] });

  it("names the story being finished between stories, not \"starting\"", () => {
    const r = { stack: SWIFT, runId: "v2-r1", node: "node-a", pack: "vidi", live: { status: "running", currentStory: "", runningStory: "3", agentMinutes: 33 } } as unknown as Row;
    expect(machines(["node-a"], [full(r)])[0].running).toMatchObject({ story: "3", finishing: true });
  });

  it("says what each node runs now and how many wait, and names idle nodes", () => {
    const rows = [
      row(SWIFT, "v2-r1", "node-a", "running", "3"),
      row(SWIFT, "v2-r2", "node-a", "queued"),
      row("qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi", "v2-r1", "node-a", "queued"),
      row(SWIFT, "smoke-v2-01", "node-a", "done"),
    ];
    expect(machines(["node-d", "node-a"], rows.map((r) => full(r)))).toEqual([
      { node: "node-a", running: { stack: SWIFT, short: "3.8-swift-1.5/27b llamacpp", runId: "v2-r1", story: "3", finishing: false, agentMinutes: 25 }, busy: false, queued: 2 },
      { node: "node-d", running: null, busy: false, queued: 0 },
    ]);
  });

  it("a node running or queuing a run marked invalid is busy, with the run named to nobody, and its queue counts only shown runs", () => {
    const rows = [full(row(SWIFT, "v2-r8", "node-a", "running", "3"), true), full(row(SWIFT, "v2-r9", "node-a", "queued"), true), full(row(SWIFT, "v2-r2", "node-a", "queued"))];
    expect(machines(["node-a"], rows)).toEqual([{ node: "node-a", running: null, busy: true, queued: 1 }]);
  });
});

describe("assignMachines", () => {
  const r = (runId: string, node: string | null, host: string) => ({ runId, node, host }) as unknown as Row;

  it("files a run by its dbench node, else by the node its host was seen on, else by its host", () => {
    const rows = assignMachines([
      r("v2-r1", "node-c", "Apple M5 Max 128GB"),
      r("canvas-mlx-01", null, "Apple M5 Max 128GB"), // finished before dbench knew it: same host, so node-c
      r("run-2", null, "Apple M2 16GB"),              // no node ever ran on this host
      r("old", null, ""),
    ]);
    expect(rows.map((x) => x.machine)).toEqual(["node-c", "node-c", "Apple M2 16GB", "unknown machine"]);
  });
});

describe("runStatus", () => {
  const rec = (state: string) => ({ state });
  const running = (progress: DbenchJob["progress"], attempt = 1) => job({ id: "j", state: { status: "running", attempt }, progress });

  it("one word per run, from the dbench job when there is one, else the record; never a failure's reason or an attempt count", () => {
    expect(runStatus(rec("started"), running({ current_story: "3" }))).toEqual({ status: "running", note: "" });
    expect(runStatus(rec("started"), running({ current_story: "", stories: [{ id: 3, status: "running" }] }))).toEqual({ status: "running", note: "finishing story 3" });
    expect(runStatus(rec(""), running({}, 2))).toEqual({ status: "running", note: "starting" });
    expect(runStatus(rec(""), job({ id: "j", state: { status: "queued" } }))).toEqual({ status: "queued", note: "" });
    expect(runStatus(rec(""), job({ id: "j", state: { status: "failed", reason: "exit 1" } }))).toEqual({ status: "failed", note: "" });
    expect(runStatus(rec("stopped"), job({ id: "j", state: { status: "cancelled" } }))).toEqual({ status: "cancelled", note: "" });
    expect(runStatus(rec("finished"), job({ id: "j", state: { status: "done" } }))).toEqual({ status: "finished", note: "" });
    expect(runStatus(rec("finished"), null)).toEqual({ status: "finished", note: "" });
    expect(runStatus(rec("failed"), null)).toEqual({ status: "failed", note: "" });
    // The record says a story started but no job runs it any more: it stopped.
    expect(runStatus(rec("started"), null)).toEqual({ status: "stopped", note: "no longer running" });
  });
});

describe("stories working", () => {
  it("counts a spec file's tests: test( and its variants, not describe blocks or loops inside tests", () => {
    const src = [
      "test.describe('story 3 @s3', () => {",
      "  test('golden path @ref prd:x', async ({ page }) => {",
      "    for (const p of [alex, sam]) {",
      "      await expect(p).toBeVisible();",
      "    }",
      "  });",
      "  test.fixme('later', async () => {});",
      "  test.beforeEach(async () => {});",
      "  test('second', async () => {});",
      "});",
    ].join("\n");
    expect(countTests(src)).toBe(3);
  });

  const st = (id: string, byStory: Record<string, [number, number]> | null, own: [number, number] | null = null) => ({
    id, title: "", status: "DONE", passed: null, total: null,
    ownPassed: own?.[0] ?? null, ownTotal: own?.[1] ?? null,
    byStory: byStory && Object.fromEntries(Object.entries(byStory).map(([k, [p, t]]) => [k, { passed: p, total: t }])),
  });
  const SCOPE = ["1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12"];

  it("colours every story in scope by how it does against the latest build; a story that broke later turns red", () => {
    const sw = storiesWorking([
      st("1", { "1": [10, 10] }),
      st("2", { "1": [10, 10], "2": [9, 10] }),
      st("3", { "1": [0, 10], "2": [0, 10], "3": [0, 7] }), // story 3 broke everything
    ], SCOPE, null);
    expect(sw.scope).toBe(11);
    expect(sw.working).toBe(0);
    expect(sw.squares.slice(0, 4).map((q) => q.state)).toEqual(["bad", "bad", "bad", "unbuilt"]);
    expect(sw.squares[0]).toMatchObject({ id: "1", passed: 0, total: 10 });
  });

  it("a re-score under the current suite overrides older live scores: a finished run scored 75/75 shows 11 of 11", () => {
    const live = [st("1", { "1": [10, 10] }), st("12", { "1": [0, 10], "12": [0, 5] })]; // live, under a broken suite
    const all = Object.fromEntries(SCOPE.map((id) => [id, [1, 1] as [number, number]]));
    const rescored = { after: "12", byStory: st("12", all).byStory! };
    expect(storiesWorking(live, SCOPE, null, rescored).working).toBe(11);
    // A re-score of an earlier story doesn't hide later live results.
    expect(storiesWorking(live, SCOPE, null, { after: "5", byStory: rescored.byStory }).working).toBe(0);
  });

  it("counts stories whose flows all pass now; the running story pulses; one dbench reports done ahead of git uses its own result", () => {
    const sw = storiesWorking([
      st("1", { "1": [10, 10] }),
      st("2", { "1": [10, 10], "2": [9, 10] }),
      st("3", null, [7, 7]), // dbench says done, the record hasn't got it yet
    ], SCOPE, "4");
    expect(sw.working).toBe(2);
    expect(sw.squares.slice(0, 5).map((q) => q.state)).toEqual(["ok", "part", "ok", "running", "unbuilt"]);
  });
});

describe("finalScore", () => {
  const rs = (stories: number[]) => ({ finished_at: "t", results: stories.map((story) => ({ story, passed: 50, total: 57, flaky: 1 })) });

  it("is a score of record only when it re-scores a finished run's last story", () => {
    expect(finalScore(rs([12]), "finished", "12")).toEqual({ passed: 50, total: 57, flaky: 1, at: "t" });
    expect(finalScore(rs([9]), "started", "9")).toBeNull();   // the run is still going
    expect(finalScore(rs([9]), "finished", "12")).toBeNull(); // a partial re-score of a finished run
    expect(finalScore(null, "finished", "12")).toBeNull();
    // A re-score the machine spoiled (the runner never started) says nothing about the app: not a score.
    expect(finalScore({ results: [{ story: 12, passed: 0, total: 0, harness_fault: "scoring interrupted: the held-out runner failed to start" }] }, "finished", "12")).toBeNull();
  });
});

describe("tokens and speed", () => {
  const raw = (out: number, inp: number, decodeS: number | null, prefillS: number | null) => ({
    title: "t", status: "DONE",
    agent: { seconds: 600, tool_calls: 100, tokens: { input: inp, output: out, cache_read: 1000, cache_write: 10 } },
    time_split: decodeS === null ? undefined : { model: {
      decode_tokens: out, decode_s: decodeS, decode_tok_s: out / decodeS,
      prefill_tokens: inp, prefill_s: prefillS, prefill_tok_s: inp / prefillS!, draft_acceptance: 0.85 } },
  });

  it("each recorded story keeps its tokens and speeds", () => {
    const st = storyEntry("2", raw(55968, 45179, 565.7, 59.2));
    expect(st.usage).toMatchObject({ outTokens: 55968, inTokens: 45179, cacheRead: 1000, calls: 100, agentSeconds: 600 });
    expect(st.usage!.decodeTokS).toBeCloseTo(98.9, 1);
    expect(st.usage!.draftAcceptance).toBe(0.85);
    expect(storyEntry("3", { agent: { compactions: 2, nudges: 1, tokens: {} } }).usage).toMatchObject({ compactions: 2, nudges: 1 });
  });

  it("read is everything the model read: fresh input plus cache reads and writes, however the client splits it", () => {
    // Claude Code reports almost all input as cache reads; llama.cpp clients mostly as fresh input.
    expect(storyEntry("1", raw(5000, 40, null, null)).usage!.readTokens).toBe(40 + 1000 + 10);
    expect(runUsage([storyEntry("1", raw(5000, 40, null, null)), storyEntry("2", raw(5000, 60, null, null))]).readTokens).toBe(2 * 1010 + 100);
  });

  it("keeps where the story's time went: prefill, generation, tools, compaction, and the rest", () => {
    const st = storyEntry("3", { agent: { seconds: 4800, tokens: {} }, time_split: { wall_s: 4800, tools_s: 420, compaction_s: 240, other_s: 60,
      model: { prefill_s: 1020, prefill_tokens: 1230000, decode_s: 3060, decode_tokens: 159000 } } } as never);
    expect(st.usage!.split).toMatchObject({ wall: 4800, prefill: 1020, decode: 3060, tools: 420, compaction: 240, other: 60, modelUnsplit: 0 });
  });

  it("keeps the tools time by kind, so the agent's own tests, builds and other commands can be told apart", () => {
    const st = storyEntry("4", { agent: { seconds: 7300, tokens: {} }, time_split: { wall_s: 7300, tools_s: 1158, compaction_s: 0, other_s: 0,
      tools_by_kind: { bash: 816, unit: 210, e2e: 114, build: 24 }, model: { prefill_s: 1, decode_s: 1 } } } as never);
    expect(st.usage!.split!.toolsByKind).toEqual({ bash: 816, unit: 210, e2e: 114, build: 24 });
  });

  it("keeps the wait between the agent's sessions as its own part", () => {
    const st = storyEntry("4", { agent: { seconds: 3348.8, tokens: {} }, time_split: { wall_s: 3528.9, tools_s: 900, compaction_s: 0, between_sessions_s: 180.1, other_s: 48.8,
      model: { prefill_s: 400, decode_s: 2000 }, accounting: { version: 3, ok: true, problems: [] } } } as never);
    expect(st.usage!.split).toMatchObject({ wall: 3528.9, betweenSessions: 180.1, other: 48.8 });
  });

  it("the record keeps the split's own check: passed, failed (with the problems and the accounting version), or unchecked", () => {
    const ts = (accounting?: object) => ({ agent: { seconds: 100, tokens: {} }, time_split: { wall_s: 100, tools_s: 0, compaction_s: 0, other_s: 100, model: null, accounting } });
    expect(storyEntry("1", ts({ version: 3, ok: true, problems: [] }) as never).usage!.split!.check).toEqual({ status: "ok", problems: [], version: 3 });
    expect(storyEntry("1", ts({ version: 3, ok: false, problems: ["tool call t1 never ended; counted to the agent's next step"] }) as never).usage!.split!.check)
      .toEqual({ status: "problems", problems: ["tool call t1 never ended; counted to the agent's next step"], version: 3 });
    expect(storyEntry("1", ts() as never).usage!.split!.check).toEqual({ status: "unchecked", problems: [], version: null });
    expect(storyEntry("1", ts({ ok: false, problems: ["x"] }) as never).usage!.split!.check).toMatchObject({ version: null });
    expect(storyEntry("1", ts() as never).usage!.split!.betweenSessions).toBe(0);
  });

  it("the record keeps a story's harness faults, verbatim; none when there are none", () => {
    const faults = [{ step: "record", error: "git push failed" }];
    expect(storyEntry("1", { agent: { seconds: 1, tokens: {} }, harness_faults: faults } as never).harnessFaults).toEqual(faults);
    expect(storyEntry("1", { agent: { seconds: 1, tokens: {} }, harness_faults: [] } as never)).not.toHaveProperty("harnessFaults");
    expect(storyEntry("1", { agent: { seconds: 1, tokens: {} } } as never)).not.toHaveProperty("harnessFaults");
  });

  it("the record keeps a story's skipped agent output (drive.py's skipped_output), and the page never gets it", () => {
    const skipped = { count: 2, samples: ["42", "null"] };
    const rec = storyEntry("1", { agent: { seconds: 1, tokens: {} }, skipped_output: skipped } as never);
    expect(rec.skippedOutput).toEqual(skipped);
    expect(publicStory(rec)).not.toHaveProperty("skippedOutput");
    expect(storyEntry("1", { agent: { seconds: 1, tokens: {} } } as never)).not.toHaveProperty("skippedOutput");
    // A record whose field is not the shape the harness writes is left out, not passed on.
    for (const odd of [null, "3", { count: 0, samples: [] }, { count: "2" }]) {
      expect(storyEntry("1", { agent: { seconds: 1, tokens: {} }, skipped_output: odd } as never)).not.toHaveProperty("skippedOutput");
    }
  });

  it("the record keeps what the publishing step redacted from a story (record.credentials_redacted), and the page never gets it", () => {
    const redacted = { count: 2, names: ["DEEPSEEK_API_KEY", "sk- key"] };
    const rec = storyEntry("1", { agent: { seconds: 1, tokens: {} }, record: { committed: true, pushed: true, credentials_redacted: redacted } } as never);
    expect(rec.credentialsRedacted).toEqual(redacted);
    expect(publicStory(rec)).not.toHaveProperty("credentialsRedacted");
    for (const record of [undefined, null, { committed: true }, { credentials_redacted: null }, { credentials_redacted: { count: 0, names: [] } }, { credentials_redacted: { count: "2" } }]) {
      expect(storyEntry("1", { agent: { seconds: 1, tokens: {} }, record } as never)).not.toHaveProperty("credentialsRedacted");
    }
  });

  describe("what the page gets of a story (publicStory): no check, no faults, and no breakdown that failed its check", () => {
    const ts = (accounting?: object) => ({ agent: { seconds: 100, tokens: {} }, time_split: { wall_s: 100, tools_s: 40, compaction_s: 0, other_s: 60, model: null, accounting } });
    it("a split that passed, or was never checked, is sent as it is, without the check", () => {
      for (const acc of [{ version: 3, ok: true, problems: [] }, undefined]) {
        const s = publicStory(storyEntry("1", ts(acc) as never));
        expect(s.usage!.split).toMatchObject({ wall: 100, tools: 40 });
        expect(s.usage!.split).not.toHaveProperty("check");
      }
    });
    it("a split that failed its check is not sent: the breakdown is not available, the story's own totals are", () => {
      const rec = storyEntry("1", { ...ts({ version: 3, ok: false, problems: ["parts sum to 90 s, not the wall's 100 s"] }), harness_faults: [{ step: "x" }] } as never);
      const s = publicStory(rec);
      expect(s.usage!.split).toBeNull();
      expect(s.usage!.agentSeconds).toBe(100);
      expect(s).not.toHaveProperty("harnessFaults");
      expect(rec.usage!.split!.check.status).toBe("problems");   // the record still has it, for the faults feed
    });
    it("a story with no usage, or usage with no split, is unchanged", () => {
      expect(publicStory({ id: "1", title: "", status: "", passed: null, total: null, ownPassed: null, ownTotal: null, usage: null } as RecordStory).usage).toBeNull();
      expect(publicStory(storyEntry("1", { agent: { seconds: 1, tokens: {} } } as never)).usage!.split).toBeNull();
    });
    it("a run's totals and the page's rows leave a failed split out of every per-part figure", () => {
      const rec = { pack: "vidi", stack: SWIFT, runId: "v2-r1", dir: "d", rescores: [], rescoreLast: {}, hasBundle: false, packVersion: "", state: "finished", stateAt: "", scores: {},
        stories: [storyEntry("1", ts({ version: 3, ok: false, problems: ["x"] }) as never), storyEntry("2", ts({ version: 3, ok: true, problems: [] }) as never)] };
      const [r] = buildRows([rec], {}, {}, 0);
      expect(r.stories.map((s) => s.usage!.split?.wall ?? null)).toEqual([null, 100]);
      expect(r.stories.map((s) => s.usage!.agentSeconds)).toEqual([100, 100]);
      expect(buildFullRows([rec], {}, {}, 0)[0].record.stories[0].usage!.split!.check.status).toBe("problems");
    });
  });

  it("keeps the conversation's profile, in the page's names; none recorded is null", () => {
    const st = storyEntry("2", { agent: { seconds: 4811, tokens: {} }, conversation: {
      version: 1, calls: 207, tool_calls: 204, thinking_chars: 328750, text_chars: 4889, tool_arg_chars: 279940,
      thinking_median: 424, thinking_median_before: 80, thinking_median_after: 464,
      largest_thinking: { chars: 64543, call: 14, at_s: 480 }, context_start: 9000, context_end: 120000,
      largest_context_jump: { tokens: 16607, call: 15 }, tools_by_name: { bash: 115, edit: 40 }, tool_errors: 5,
      longest_tool: { seconds: 61.7, name: "bash", gist: "npm run test:unit" }, signals: ["long-thinking-block"] } } as never);
    expect(st.conversation).toEqual({
      calls: 207, toolCalls: 204, thinkingChars: 328750, textChars: 4889, toolArgChars: 279940,
      thinkingMedian: 424, thinkingMedianBefore: 80, thinkingMedianAfter: 464,
      largestThinking: { chars: 64543, call: 14, atS: 480 }, contextStart: 9000, contextEnd: 120000,
      largestContextJump: { tokens: 16607, call: 15 }, toolsByName: { bash: 115, edit: 40 }, toolErrors: 5,
      longestTool: { seconds: 61.7, name: "bash", gist: "npm run test:unit" }, signals: ["long-thinking-block"],
      thinkingVisible: true, thinkingTokens: null });
    expect(storyEntry("3", { agent: { seconds: 1, tokens: {} } }).conversation).toBeNull();
  });

  it("a cloud model's withheld thinking: unknown in characters (never 0), exact in tokens, nothing estimated", () => {
    // Sonnet 5.5 v2-r4 story 3 (1 Oct 2026) read "0 chars": the log withholds the text, and null became 0.
    const st = storyEntry("3", { agent: { seconds: 940, tokens: {} }, conversation: {
      version: 2, calls: 58, tool_calls: 92, thinking_visible: false, thinking_chars: null, thinking_median: null,
      thinking_median_before: null, thinking_median_after: null, largest_thinking: null, thinking_tokens: 7986,
      thinking_estimated_tokens: 10203, largest_thinking_estimated: { tokens: 1000, call: 42, at_s: 457.6 },
      context_start: 16000, context_end: 140000, tools_by_name: { Bash: 56 }, tool_errors: 3, signals: [] } } as never);
    expect(st.conversation).toMatchObject({ thinkingVisible: false, thinkingChars: null, thinkingMedian: null, thinkingTokens: 7986 });
    // The client's estimates ran 13-28% over the exact totals and missed calls that thought: not carried at all.
    expect(JSON.stringify(st.conversation)).not.toMatch(/stimat/);
  });

  it("a profile from before thinking was told apart: visible, as it was then; no tokens", () => {
    const st = storyEntry("2", { agent: { seconds: 1, tokens: {} }, conversation: { version: 1, calls: 3, thinking_chars: 90, thinking_median: 30 } } as never);
    expect(st.conversation).toMatchObject({ thinkingVisible: true, thinkingChars: 90, thinkingTokens: null });
  });

  it("a cloud model's time isn't split: it is what's left of the wall time after tools and compaction", () => {
    const st = storyEntry("3", { agent: { seconds: 1400, tokens: {} }, time_split: { wall_s: 1400, tools_s: 0, compaction_s: 0, other_s: 1400, model: null } } as never);
    expect(st.usage!.split).toMatchObject({ prefill: 0, decode: 0, modelUnsplit: 1400, other: 0 });
  });

  it("a run's tok/s is weighted by tokens, not an average of the stories' rates", () => {
    const u = runUsage([storyEntry("1", raw(1000, 100, 10, 1)), storyEntry("2", raw(9000, 900, 180, 9))]);
    expect(u.outTokens).toBe(10000);
    expect(u.inTokens).toBe(1000);
    expect(u.decodeTokS).toBeCloseTo(10000 / 190, 6); // not (100 + 50) / 2
    expect(u.prefillTokS).toBeCloseTo(1000 / 10, 6);
  });

  it("tok/s is output tokens over the time the stories took, for every run, cloud included", () => {
    const u = runUsage([storyEntry("1", raw(5000, 40, null, null)), storyEntry("2", raw(7000, 40, null, null))]);
    expect(u.outTokens).toBe(12000);
    expect(u.tokS).toBeCloseTo(12000 / 1200, 6); // each story took 600 s
    expect(u.decodeTokS).toBeNull();              // the model-only rate needs the meter; nothing timed here
    expect(storyEntry("1", raw(5000, 40, null, null)).usage!.tokS).toBeCloseTo(5000 / 600, 6);
  });
});

describe("what a run's final re-score recorded (finalize.json): kept whole on the server, never sent to the page", () => {
  const RAW = { version: "vidi-v2.0-pre2+28ace8b", pack_ref: "vidi-v2.0-pre2", at: "2026-10-01T08:25:57Z", bundle: "workspace.bundle",
    rescore: "skipped", reason: "the suite checkout is at vidi-v2.0-pre2+28ace8b, not the pack's vidi-v2.0-pre2", needs_person: true, attempts: 3, history: [{ at: "x" }] };
  it("verbatim, whatever it says", () => expect(parseFinalize(RAW)).toEqual(RAW));
  it("no record, or one that doesn't say how the re-score ended: nothing", () => {
    for (const raw of [undefined, null, "skipped", {}, { reason: "x" }, { rescore: "" }, { rescore: 1 }]) expect(parseFinalize(raw)).toBeNull();
  });
  it("the full row carries its record's, or null; the page's row has none", () => {
    const rec = { pack: "vidi", stack: SWIFT, runId: "v2-r1", dir: "d", rescores: [], rescoreLast: {}, hasBundle: false, packVersion: "", state: "finished", stateAt: "", stories: [], scores: {} };
    const f = parseFinalize(RAW)!;
    expect(buildFullRows([{ ...rec, finalize: f }], {}, {}, 0)[0].record.finalize).toEqual(f);
    expect(buildFullRows([rec], {}, {}, 0)[0].record.finalize).toBeNull();
    expect(buildRows([{ ...rec, finalize: f }], {}, {}, 0)[0]).not.toHaveProperty("finalize");
  });
  it("what spoiled a re-score is kept beside the scores", () => {
    expect(rescoreFault({ results: [{ story: 12, harness_fault: " no browser " }] })).toBe("no browser");
    expect(rescoreFault({ results: [{ story: 12, passed: 60, total: 75 }] })).toBeNull();
    expect(rescoreFault(null)).toBeNull();
  });
});
