import { describe, expect, it } from "vitest";
import {
  findRuns, versionFamily, rowFamily, webBase, indexJobs, queuePositions, liveFromJob, storyEntry,
  mergeStories, stages, mergeRows, machines, assignMachines, runStatus, countTests, storiesWorking, RECENT_S, type DbenchJob,
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
      gruntus: [
        job({ id: "new", state: { status: "running" }, updated_at: 2 }),
        job({ id: "old", state: { status: "failed" }, updated_at: 1 }),
      ],
    });
    const j = idx.get(`${SWIFT}\u0000vidi\u0000v2-r1`);
    expect(j?.id).toBe("new");
    expect(j?.node).toBe("gruntus");
  });

  it("queued jobs know their place and what is ahead, in dbench's order", () => {
    const q = queuePositions({
      gruntus: [
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

describe("stages", () => {
  const run = { state: "started", rescores: [] as string[], hasBundle: false };
  it("say what a run is waiting for", () => {
    const s = stages(run, job({ id: "j", state: { status: "running" }, progress: { current_story: "3" } }), "vidi-v2.0");
    expect(s).toEqual({ build: "running: story 3", score: "waiting for the build", judge: "waiting for scoring" });
    const done = { state: "finished", rescores: [] as string[], hasBundle: true };
    expect(stages(done, null, "vidi-v2.0").score).toBe("not scored with vidi-v2.0");
    expect(stages({ ...done, rescores: ["vidi-v2.0"] }, null, "vidi-v2.0").judge).toBe("ready");
    expect(stages({ ...done, rescores: ["vidi-v2.0"], hasBundle: false }, null, "vidi-v2.0").judge).toBe("needs workspace.bundle");
  });
  it("between stories the build names the story being finished", () => {
    const s = stages(run, job({ id: "j", state: { status: "running" }, progress: { current_story: null,
      stories: [{ id: "1", status: "running" }, { id: "2", status: "pending" }] } }), "x");
    expect(s.build).toBe("running: story 1 (finishing)");
  });
  it("failed, queued and finished-unrecorded jobs read plainly", () => {
    expect(stages(run, job({ id: "j", state: { status: "failed", reason: "harness exited 1" } }), "x").build).toBe("failed: harness exited 1");
    expect(stages({ ...run, state: "" }, job({ id: "j", state: { status: "queued" } }), "x").build).toBe("queued");
    expect(stages({ ...run, state: "" }, job({ id: "j", state: { status: "done" } }), "x").build).toBe("finished (not recorded)");
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

  it("names the story being finished between stories, not \"starting\"", () => {
    const r = { stack: SWIFT, runId: "v2-r1", node: "gruntus", pack: "vidi", live: { status: "running", currentStory: "", runningStory: "3", agentMinutes: 33 } } as unknown as Row;
    expect(machines(["gruntus"], [r])[0].running).toMatchObject({ story: "3", finishing: true });
  });

  it("says what each node runs now and how many wait, and names idle nodes", () => {
    const rows = [
      row(SWIFT, "v2-r1", "gruntus", "running", "3"),
      row(SWIFT, "v2-r2", "gruntus", "queued"),
      row("qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi", "v2-r1", "gruntus", "queued"),
      row(SWIFT, "smoke-v2-01", "gruntus", "done"),
    ];
    expect(machines(["tritus", "gruntus"], rows)).toEqual([
      { node: "gruntus", running: { stack: SWIFT, short: "3.8-swift-1.5/27b llamacpp", runId: "v2-r1", story: "3", finishing: false, agentMinutes: 25 }, queued: 2 },
      { node: "tritus", running: null, queued: 0 },
    ]);
  });
});

describe("assignMachines", () => {
  const r = (runId: string, node: string | null, host: string) => ({ runId, node, host }) as unknown as Row;

  it("files a run by its dbench node, else by the node its host was seen on, else by its host", () => {
    const rows = assignMachines([
      r("v2-r1", "quintus", "Apple M5 Max 128GB"),
      r("canvas-mlx-01", null, "Apple M5 Max 128GB"), // finished before dbench knew it: same host, so quintus
      r("run-2", null, "Apple M2 16GB"),              // no node ever ran on this host
      r("old", null, ""),
    ]);
    expect(rows.map((x) => x.machine)).toEqual(["quintus", "quintus", "Apple M2 16GB", "unknown machine"]);
  });
});

describe("runStatus", () => {
  const rec = (state: string) => ({ state });
  const running = (progress: DbenchJob["progress"], attempt = 1) => job({ id: "j", state: { status: "running", attempt }, progress });

  it("one word per run, from the dbench job when there is one, else the record", () => {
    expect(runStatus(rec("started"), running({ current_story: "3" }))).toEqual({ status: "running", note: "" });
    expect(runStatus(rec("started"), running({ current_story: "", stories: [{ id: 3, status: "running" }] }))).toEqual({ status: "running", note: "finishing story 3" });
    expect(runStatus(rec(""), running({}, 2))).toEqual({ status: "running", note: "starting · attempt 2" });
    expect(runStatus(rec(""), job({ id: "j", state: { status: "queued" } }))).toEqual({ status: "queued", note: "" });
    expect(runStatus(rec(""), job({ id: "j", state: { status: "failed", reason: "exit 1" } }))).toEqual({ status: "failed", note: "exit 1" });
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
