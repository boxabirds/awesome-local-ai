import { describe, expect, it } from "vitest";
import {
  findRuns, versionFamily, rowFamily, webBase, indexJobs, queuePositions, liveFromJob, storyEntry,
  mergeStories, stages, mergeRows, RECENT_S, type DbenchJob,
} from "./domain.ts";

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";

const PATHS = [
  `combinations/${SWIFT}/benchmarks/vidi/v2-r1/run.json`,
  `combinations/${SWIFT}/benchmarks/vidi/v2-r1/run-status.json`,
  `combinations/${SWIFT}/benchmarks/vidi/v2-r1/stories/01/accept.json`,
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/run.json",
  "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/canvas-gufo-r3/rescore/vidi-v1.3.2/rescore.json",
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
});
