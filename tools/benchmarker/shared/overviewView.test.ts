// The overview's and the machine page's rules, by dimension: how long a running story has been silent; the "now"
// line for every machine state; a machine's jobs; and its history grouped across packs and versions. Each dimension's cases cover every value it can take.
import { describe, expect, it } from "vitest";
import type { JobRef, Live, Machine, Row, Score, Story, TimeSplit, Usage } from "./types.ts";
import {
  RECENT_END_S, endedAt, jobEndedAt, jobPlace, machineHistory, machineJobs, nowLines,
  runningStory, silentMinutes, suiteFamily, type Reachability,
} from "./overviewView.ts";

const SUITE = "vidi-v2.0-pre1";
const NOW = 1_790_800_000;
const MIN = 60;
const DAY = 86_400;

const split = (): TimeSplit => ({
  wall: 600, prefill: 60, decode: 400, tools: 100, compaction: 20, other: 20, modelUnsplit: 0, betweenSessions: 0,
});
const usage = (over: Partial<Usage> = {}): Usage => ({
  outTokens: 1000, inTokens: 100, cacheRead: 900, readTokens: 1000, calls: 10, agentSeconds: 600, tokS: 1.7,
  decodeTokens: 900, decodeSeconds: 400, decodeTokS: 2.25, prefillTokens: 100, prefillSeconds: 60, prefillTokS: 1.7,
  draftAcceptance: null, compactions: 1, nudges: 0, split: split(), ...over,
});
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id, title: `Story ${id}`, status: "DONE", passed: 5, total: 10, ownPassed: 5, ownTotal: 5, usage: usage(), conversation: null, ...over,
});
const live = (over: Partial<Live> = {}): Live => ({
  jobId: "job", status: "running", currentStory: null, runningStory: null, agentMinutes: null, calls: null,
  outputTokens: null, tasksWritten: null, tasksTotal: null, lastActivity: null, storyStartedAt: null, storyTitle: null,
  storiesInScope: null, runStartedAt: null, totalAgentMinutes: null, queue: null, ...over,
});
const job = (id: string, status: string, updatedAt: number | null, reason = "", ended: number | null = null): JobRef => ({ id, node: "node-a", status, submittedAt: null, updatedAt, reason, endedAt: ended });
const score = (passed: number | null, total: number | null): Score => ({ passed, total, flaky: 0, at: "2026-09-30T18:30:00Z" });

const row = (over: Partial<Row> = {}): Row => ({
  pack: "vidi", stack: "qwen/x/pi", runId: "r1", dir: "d", node: "node-a", host: "h", machine: "node-a", label: "x pi", client: "pi",
  packVersion: SUITE, family: "vidi-v2", suite: SUITE, state: "finished", stateAt: "", status: "finished",
  storiesWorking: { working: 0, scope: 0, squares: [] },
  usage: { outTokens: null, inTokens: null, readTokens: null, calls: null, tokS: null, decodeTokS: null, prefillTokS: null },
  statusNote: "", stories: [story("1")], rescores: [SUITE], scores: { [SUITE]: score(60, 75) }, judgeReady: false, live: null, jobs: [], interventions: [], ...over,
});

/** A running row on story 3 that started `startedMinAgo` minutes ago and last reported `agentMinutes`. */
const running = (startedMinAgo: number | null, agentMinutes: number | null, over: Partial<Live> = {}): Row => row({
  status: "running", runId: "run", scores: {}, rescores: [],
  live: live({ currentStory: "3", runningStory: "3", storyStartedAt: startedMinAgo === null ? null : NOW - startedMinAgo * MIN, agentMinutes, ...over }),
});

const machine = (node: string, over: Partial<Machine> = {}): Machine => ({ node, running: null, busy: false, queued: 0, ...over });
const busy = (node: string, runId = "run", queued = 0): Machine =>
  machine(node, { running: { stack: "qwen/x/pi", short: "x pi", runId, story: "3", finishing: false, agentMinutes: 12 }, queued });


// ---------------------------------------------------------------------------------------------------------------
describe("the running story", () => {
  it("is the current story; while the agent is done with it and its gates run, it is finishing", () => {
    expect(runningStory(running(1, 1))).toEqual({ story: "3", finishing: false });
    expect(runningStory(running(1, 1, { currentStory: null }))).toEqual({ story: "3", finishing: true });
  });
  it("is none for a job that isn't running, and for a run with no job", () => {
    for (const status of ["queued", "done", "failed", "cancelled"]) expect(runningStory(row({ live: live({ status, currentStory: "3" }) }))).toEqual({ story: null, finishing: false });
    expect(runningStory(row({ live: null }))).toEqual({ story: null, finishing: false });
  });
});

describe("silent minutes: how long the harness has said nothing about a running story", () => {
  it("is the minutes since the story started less the agent minutes last reported", () => {
    expect(silentMinutes(running(40, 30), NOW)).toBeCloseTo(10);
  });
  it("is 0 for a harness that is up to date, and never negative when it reports ahead of this clock", () => {
    expect(silentMinutes(running(30, 30), NOW)).toBe(0);
    expect(silentMinutes(running(30, 31), NOW)).toBe(0);
  });
  it("can't be told without a start time or agent minutes (a Claude story, or one just started)", () => {
    expect(silentMinutes(running(null, 30), NOW)).toBeNull();
    expect(silentMinutes(running(30, null), NOW)).toBeNull();
  });
  it("can't be told for a finishing story: the harness stops reporting while its gates run", () => {
    expect(silentMinutes(running(90, 10, { currentStory: null }), NOW)).toBeNull();
  });
  it("is none for a job that isn't running", () => {
    expect(silentMinutes(row({ live: live({ status: "queued", storyStartedAt: NOW - DAY, agentMinutes: 0 }) }), NOW)).toBeNull();
  });
});

describe("helpers", () => {
  it("a suite's version family is its name up to the major version", () => {
    expect(suiteFamily("vidi-v2.0-pre1")).toBe("vidi-v2");
    expect(suiteFamily("todoodle-v10.3")).toBe("todoodle-v10");
    expect(suiteFamily("")).toBe("");
  });
  it("when a run ended: the later of its last job's report and its record's time; null with neither", () => {
    expect(endedAt({ jobs: [job("a", "done", 100), job("b", "done", 200)], stateAt: "" })).toBe(200);
    expect(endedAt({ jobs: [], stateAt: "1970-01-01T00:05:00Z" })).toBe(300);
    expect(endedAt({ jobs: [job("a", "done", 100)], stateAt: "1970-01-01T00:05:00Z" })).toBe(300);
    expect(endedAt({ jobs: [job("a", "done", null)], stateAt: "not a time" })).toBeNull();
  });
  it("a live job's place among its run's jobs, or none when it isn't one of them", () => {
    expect(jobPlace({ jobs: [job("a", "cancelled", 1), job("b", "running", 2)], live: live({ jobId: "b" }) })).toEqual({ place: 2, of: 2 });
    expect(jobPlace({ jobs: [], live: live({ jobId: "b" }) })).toBeNull();
    expect(jobPlace({ jobs: [job("a", "done", 1)], live: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("now: one line per machine", () => {
  const reach: Reachability = { "node-a": { ok: true }, "node-d": { ok: true } };

  it("running: the run (found among every run), its story and title, minutes on it, silence, and its queue", () => {
    const r = running(20, 12, { storyTitle: "Sticky notes" });
    const [line] = nowLines([busy("node-a", "run", 2)], [r], reach, NOW);
    expect(line).toMatchObject({
      machine: "node-a", state: "running", run: { pack: "vidi", stack: "qwen/x/pi", runId: "run", label: "x pi" },
      story: "3", storyTitle: "Sticky notes", finishing: false, minutes: 12, queued: 2,
    });
    expect(line.silent).toBeCloseTo(8);
  });
  it("running, finishing: says so, and has no silence to measure", () => {
    const r = running(20, 12, { currentStory: null });
    const m = machine("node-a", { running: { stack: "qwen/x/pi", short: "x pi", runId: "run", story: "3", finishing: true, agentMinutes: 12 } });
    expect(nowLines([m], [r], reach, NOW)[0]).toMatchObject({ state: "running", finishing: true, silent: null });
  });
  it("running, but its run isn't among the runs: named from dbench, with no pack to link it by", () => {
    expect(nowLines([busy("node-a")], [], reach, NOW)[0]).toMatchObject({ state: "running", run: { pack: "", runId: "run", label: "x pi" }, storyTitle: null, silent: null });
  });
  it("running, starting: no story yet", () => {
    const m = machine("node-a", { running: { stack: "qwen/x/pi", short: "x pi", runId: "run", story: null, finishing: false, agentMinutes: null } });
    expect(nowLines([m], [], reach, NOW)[0]).toMatchObject({ state: "running", story: null, minutes: null });
  });
  it("idle: reachable, nothing running, nothing queued", () => {
    expect(nowLines([machine("node-d")], [], { "node-d": { ok: true } }, NOW)).toMatchObject([{ machine: "node-d", state: "idle", run: null, queued: 0 }]);
  });
  it("queued only: nothing running but a queue waiting, which is not idle", () => {
    expect(nowLines([machine("node-d", { queued: 3 })], [], { "node-d": { ok: true } }, NOW)).toMatchObject([{ state: "queuedOnly", queued: 3, run: null }]);
  });
  it("unreachable: /api/machines couldn't reach it, whatever was last said about it; never why", () => {
    const line = nowLines([busy("node-a")], [], { "node-a": { ok: false } }, NOW)[0];
    expect(line).toMatchObject({ state: "unreachable", run: null });
    expect(line).not.toHaveProperty("error");
    expect(nowLines([], [], { down: { ok: false } }, NOW)[0]).toMatchObject({ machine: "down", state: "unreachable" });
  });
  it("busy with a run the page doesn't show: running, with no run named", () => {
    const m = { ...machine("node-a"), busy: true };
    expect(nowLines([m], [], reach, NOW)[0]).toMatchObject({ state: "running", run: null, story: null, minutes: null, silent: null });
  });
  it("in the machine list and reachable, but not in the job list: can't say what it does, so unreachable", () => {
    expect(nowLines([], [], { fresh: { ok: true } }, NOW)[0]).toMatchObject({ state: "unreachable" });
  });
  it("before /api/machines answers, dbench's nodes are listed as dbench sees them", () => {
    expect(nowLines([machine("node-d"), busy("node-a")], [], null, NOW).map((l) => [l.machine, l.state])).toEqual([["node-a", "running"], ["node-d", "idle"]]);
  });
  it("one line per machine, by name with numbers in order, each machine once", () => {
    const lines = nowLines([machine("node-10"), machine("node-9")], [], { "node-9": { ok: true }, alpha: { ok: false } }, NOW);
    expect(lines.map((l) => l.machine)).toEqual(["alpha", "node-9", "node-10"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("a machine's jobs now", () => {
  const q = (runId: string, position: number) => row({ runId, status: "queued", live: live({ jobId: runId, status: "queued", queue: { position, ahead: [] } }) });
  it("the running job, the queue in dbench's order, then jobs that ended, latest first", () => {
    const rows = [
      q("third", 3), row({ runId: "old", live: live({ jobId: "old", status: "done" }), jobs: [job("old", "done", 100)] }),
      running(1, 1), q("second", 2), row({ runId: "new", live: live({ jobId: "new", status: "cancelled" }), jobs: [job("new", "cancelled", 200)] }),
    ];
    const j = machineJobs("node-a", rows, 300);
    expect(j.running.map((r) => r.runId)).toEqual(["run"]);
    expect(j.queued.map((r) => r.runId)).toEqual(["second", "third"]);
    expect(j.ended.map((r) => r.runId)).toEqual(["new", "old"]);
  });
  it("only this machine's jobs, and only runs with a job", () => {
    const j = machineJobs("node-a", [{ ...running(1, 1), node: "node-d" }, row({ live: null })], NOW);
    expect(j).toEqual({ running: [], queued: [], ended: [] });
  });
});

// The bug of 30 Sep: node-d's page listed jobs that ended on 27-29 Sep under "Ended in the last day". dbench keeps
// ended jobs for days; the list took every one it kept. What ended in the last day is judged on the job's own end.
describe("a machine's jobs that ended in the last day", () => {
  const ended = (runId: string, agoS: number | null, status = "done", over: Partial<Row> = {}) => row({
    runId, live: live({ jobId: runId, status }), jobs: agoS === null ? [job(runId, status, null)] : [job(runId, status, NOW - agoS, "", NOW - agoS)], ...over,
  });
  const listed = (rows: Row[]) => machineJobs("node-a", rows, NOW).ended.map((r) => r.runId);

  it("a job that ended days ago is not listed (node-d: ended 27-29 Sep, shown on 30 Sep)", () => {
    expect(listed([ended("canvas-vk-01", 4 * DAY), ended("canvas-gufo-r2", 2 * DAY), ended("v2-r2", 6 * 3600)])).toEqual(["v2-r2"]);
  });
  it(`listed up to exactly ${RECENT_END_S / 3600} hours after it ended, and not a second after`, () => {
    expect(listed([ended("edge", RECENT_END_S)])).toEqual(["edge"]);
    expect(listed([ended("past", RECENT_END_S + 1)])).toEqual([]);
  });
  it("every ended status is judged the same way: done, failed, cancelled", () => {
    for (const status of ["done", "failed", "cancelled"]) {
      expect(listed([ended("new", 60, status), ended("old", 2 * DAY, status)])).toEqual(["new"]);
    }
  });
  it("a job whose end can't be told is not called recent", () => {
    expect(listed([ended("unknown", null)])).toEqual([]);
  });
  it("judged on the job the run shows, not a later record time (a record re-written after the job ended)", () => {
    const r = ended("rewritten", 3 * DAY, "done", { stateAt: new Date((NOW - 60) * 1000).toISOString() });
    expect(listed([r])).toEqual([]);
  });
  it("judged on the job the run shows, not on another of the run's jobs", () => {
    const r = row({ runId: "restarted", live: live({ jobId: "first", status: "cancelled" }),
      jobs: [job("first", "cancelled", NOW - 3 * DAY, "", NOW - 3 * DAY), job("second", "running", NOW, "", null)] });
    expect(listed([r])).toEqual([]);
  });
  it("latest first", () => {
    expect(listed([ended("a", 3 * 3600), ended("b", 60), ended("c", 2 * 3600)])).toEqual(["b", "c", "a"]);
  });
  it("running and queued jobs are never ended, however old their last report", () => {
    const j = machineJobs("node-a", [running(1, 1), row({ runId: "q", status: "queued", live: live({ jobId: "q", status: "queued" }), jobs: [job("q", "queued", NOW - 5 * DAY)] })], NOW);
    expect(j.ended).toEqual([]);
    expect(j.running).toHaveLength(1);
    expect(j.queued).toHaveLength(1);
  });
});

describe("when a machine's job ended", () => {
  it("the end dbench recorded for the job the run shows", () => {
    expect(jobEndedAt({ jobs: [job("a", "done", 900, "", 500)], live: live({ jobId: "a", status: "done" }), stateAt: "" })).toBe(500);
  });
  it("its last report when dbench recorded no end", () => {
    expect(jobEndedAt({ jobs: [job("a", "done", 900, "", null)], live: live({ jobId: "a", status: "done" }), stateAt: "" })).toBe(900);
  });
  it("the run's end when the job it shows isn't among its jobs, or it shows none", () => {
    expect(jobEndedAt({ jobs: [job("b", "done", 700, "", 600)], live: live({ jobId: "a", status: "done" }), stateAt: "" })).toBe(600);
    expect(jobEndedAt({ jobs: [], live: null, stateAt: "1970-01-01T00:05:00Z" })).toBe(300);
  });
  it("null when nothing says", () => expect(jobEndedAt({ jobs: [job("a", "done", null)], live: live({ jobId: "a", status: "done" }), stateAt: "" })).toBeNull());
  it("a run's end uses its last job's recorded end over its last report", () => {
    expect(endedAt({ jobs: [job("a", "done", 900, "", 500)], stateAt: "" })).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("a machine's history", () => {
  const r = (stack: string, pack: string, family: string, packVersion: string, runId: string, over: Partial<Row> = {}) =>
    row({ stack, label: stack.toUpperCase(), pack, family, packVersion, runId, ...over });

  it("groups by combination, then by pack and version family: v1 and v2 apart, newest first", () => {
    const h = machineHistory([
      r("a", "vidi", "vidi-v1", "vidi-v1.1", "canvas-01", { stateAt: "2026-09-01T00:00:00Z" }),
      r("a", "vidi", "vidi-v2", "vidi-v2.0-pre1", "v2-r1", { stateAt: "2026-09-02T00:00:00Z" }),
      r("a", "vidi", "vidi-v2", "vidi-v2.0-pre0", "v2-r0", { stateAt: "2026-08-02T00:00:00Z" }),
    ]);
    expect(h).toHaveLength(1);
    expect(h[0].groups.map((g) => [g.pack, g.family, g.packVersions, g.runs.map((x) => x.runId)])).toEqual([
      ["vidi", "vidi-v2", ["vidi-v2.0-pre1", "vidi-v2.0-pre0"], ["v2-r1", "v2-r0"]],
      ["vidi", "vidi-v1", ["vidi-v1.1"], ["canvas-01"]],
    ]);
  });
  it("one combination in two packs: a group per pack, packs by name", () => {
    const h = machineHistory([r("a", "vidi", "vidi-v2", SUITE, "x"), r("a", "todoodle", "todoodle-v1", "todoodle-v1.0", "y")]);
    expect(h[0].groups.map((g) => g.pack)).toEqual(["todoodle", "vidi"]);
  });
  it("a group's pack versions leave out the blank one of a run with no record yet", () => {
    const h = machineHistory([r("a", "vidi", "vidi-v2", "", "q", { status: "queued" }), r("a", "vidi", "vidi-v2", SUITE, "f")]);
    expect(h[0].groups[0].packVersions).toEqual([SUITE]);
  });
  it("within a group: running, the queue in its order, then latest ended first, then run id", () => {
    const h = machineHistory([
      r("a", "vidi", "vidi-v2", SUITE, "old", { stateAt: "2026-09-01T00:00:00Z" }),
      r("a", "vidi", "vidi-v2", SUITE, "q2", { status: "queued", live: live({ status: "queued", queue: { position: 3, ahead: [] } }) }),
      r("a", "vidi", "vidi-v2", SUITE, "new", { stateAt: "2026-09-03T00:00:00Z" }),
      r("a", "vidi", "vidi-v2", SUITE, "q1", { status: "queued", live: live({ status: "queued", queue: { position: 2, ahead: [] } }) }),
      r("a", "vidi", "vidi-v2", SUITE, "run", { status: "running" }),
      r("a", "vidi", "vidi-v2", SUITE, "r-9", { stateAt: "" }), r("a", "vidi", "vidi-v2", SUITE, "r-10", { stateAt: "" }),
    ]);
    expect(h[0].groups[0].runs.map((x) => x.runId)).toEqual(["run", "q1", "q2", "new", "old", "r-10", "r-9"]);
  });
  it("finished runs come before failed, stopped and cancelled ones, however recently those ended", () => {
    const h = machineHistory([
      r("a", "vidi", "vidi-v2", SUITE, "cx", { status: "cancelled", stateAt: "2026-09-09T00:00:00Z" }),
      r("a", "vidi", "vidi-v2", SUITE, "fin", { stateAt: "2026-09-01T00:00:00Z" }),
      r("a", "vidi", "vidi-v2", SUITE, "fail", { status: "failed", stateAt: "2026-09-08T00:00:00Z" }),
    ]);
    expect(h[0].groups[0].runs.map((x) => x.runId)).toEqual(["fin", "cx", "fail"]);
  });
  it("combinations with work in hand first, then the most recently ended", () => {
    const h = machineHistory([
      r("old", "vidi", "vidi-v2", SUITE, "1", { stateAt: "2026-01-01T00:00:00Z" }),
      r("recent", "vidi", "vidi-v2", SUITE, "1", { stateAt: "2026-09-01T00:00:00Z" }),
      r("queued", "vidi", "vidi-v2", SUITE, "1", { status: "queued" }),
      r("busy", "vidi", "vidi-v2", SUITE, "1", { status: "running" }),
    ]);
    expect(h.map((c) => c.stack)).toEqual(["busy", "queued", "recent", "old"]);
  });
  it("carries each combination's label; no runs, no groups", () => {
    expect(machineHistory([r("a", "vidi", "vidi-v2", SUITE, "1")])[0]).toMatchObject({ stack: "a", label: "A" });
    expect(machineHistory([])).toEqual([]);
  });
  it("every run lands in exactly one group", () => {
    const runs = [r("a", "vidi", "vidi-v2", SUITE, "1"), r("a", "vidi", "vidi-v1", "vidi-v1.1", "2"), r("b", "todoodle", "todoodle-v1", "t", "3"), r("b", "vidi", "vidi-v2", SUITE, "4")];
    const ids = machineHistory(runs).flatMap((c) => c.groups.flatMap((g) => g.runs.map((x) => x.runId)));
    expect(ids.toSorted()).toEqual(["1", "2", "3", "4"]);
  });
});
