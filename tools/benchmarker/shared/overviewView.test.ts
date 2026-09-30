// The overview's and the machine page's rules, by dimension: each "needs you" rule at its boundary, with its
// absence and missing data; the "now" line for every machine state; a machine's jobs; and its history grouped
// across packs and versions. Each dimension's cases cover every value it can take.
import { describe, expect, it } from "vitest";
import type { JobRef, Live, Machine, Row, RunStatus, Score, Story, TimeSplit, Usage } from "./types.ts";
import {
  NEED_KINDS, RECENT_END_S, SILENT_MINUTES, endedAt, jobEndedAt, jobPlace, machineHistory, machineJobs, needsYou, nowLines,
  runningStory, silentMinutes, subject, suiteFamily, type Need, type Reachability,
} from "./overviewView.ts";

const SUITE = "vidi-v2.0-pre1";
const NOW = 1_790_800_000;
const MIN = 60;
const DAY = 86_400;

const split = (check: TimeSplit["check"]): TimeSplit => ({
  wall: 600, prefill: 60, decode: 400, tools: 100, compaction: 20, other: 20, modelUnsplit: 0, betweenSessions: 0, check,
});
const usage = (over: Partial<Usage> = {}): Usage => ({
  outTokens: 1000, inTokens: 100, cacheRead: 900, readTokens: 1000, calls: 10, agentSeconds: 600, tokS: 1.7,
  decodeTokens: 900, decodeSeconds: 400, decodeTokS: 2.25, prefillTokens: 100, prefillSeconds: 60, prefillTokS: 1.7,
  draftAcceptance: null, compactions: 1, nudges: 0, split: split({ status: "ok", problems: [] }), ...over,
});
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id, title: `Story ${id}`, status: "DONE", passed: 5, total: 10, ownPassed: 5, ownTotal: 5, usage: usage(), conversation: null, ...over,
});
const live = (over: Partial<Live> = {}): Live => ({
  jobId: "job", status: "running", attempt: 1, currentStory: null, runningStory: null, agentMinutes: null, calls: null,
  outputTokens: null, tasksWritten: null, tasksTotal: null, lastActivity: null, storyStartedAt: null, storyTitle: null,
  storiesInScope: null, runStartedAt: null, totalAgentMinutes: null, logTail: [], queue: null, ...over,
});
const job = (id: string, status: string, updatedAt: number | null, reason = "", ended: number | null = null): JobRef => ({ id, node: "node-a", status, submittedAt: null, updatedAt, reason, endedAt: ended });
const score = (passed: number | null, total: number | null): Score => ({ passed, total, flaky: 0, at: "2026-09-30T18:30:00Z" });

const row = (over: Partial<Row> = {}): Row => ({
  pack: "vidi", stack: "qwen/x/pi", runId: "r1", dir: "d", node: "node-a", host: "h", machine: "node-a", label: "x pi",
  packVersion: SUITE, family: "vidi-v2", suite: SUITE, state: "finished", stateAt: "", status: "finished",
  storiesWorking: { working: 0, scope: 0, squares: [] },
  usage: { outTokens: null, inTokens: null, readTokens: null, calls: null, tokS: null, decodeTokS: null, prefillTokS: null },
  statusNote: "", stories: [story("1")], rescores: [SUITE], scores: { [SUITE]: score(60, 75) }, hasBundle: false,
  stages: { build: "finished", score: "", judge: "" }, live: null, jobs: [], invalid: null, interventions: [], ...over,
});

/** A running row on story 3 that started `startedMinAgo` minutes ago and last reported `agentMinutes`. */
const running = (startedMinAgo: number | null, agentMinutes: number | null, over: Partial<Live> = {}): Row => row({
  status: "running", runId: "run", scores: {}, rescores: [],
  live: live({ currentStory: "3", runningStory: "3", storyStartedAt: startedMinAgo === null ? null : NOW - startedMinAgo * MIN, agentMinutes, ...over }),
});

const machine = (node: string, over: Partial<Machine> = {}): Machine => ({ node, running: null, queued: 0, ...over });
const busy = (node: string, runId = "run", queued = 0): Machine =>
  machine(node, { running: { stack: "qwen/x/pi", short: "x pi", runId, story: "3", finishing: false, agentMinutes: 12 }, queued });

const needs = (input: Partial<Parameters<typeof needsYou>[0]>) =>
  needsYou({ rows: [], all: [], machines: [], reach: null, now: NOW, ...input });
const kinds = (ns: Need[]) => ns.map((n) => n.kind);

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

// ---------------------------------------------------------------------------------------------------------------
describe("needs you", () => {
  it("nothing needs you when all is well: a busy reachable machine, a scored run, checked stories", () => {
    const ok = running(10, 10);
    expect(needs({ rows: [row(), ok], all: [row(), ok], machines: [busy("node-a")], reach: { "node-a": { ok: true } } })).toEqual([]);
  });

  describe("a running story with no activity for a long time", () => {
    it(`fires at exactly ${SILENT_MINUTES} silent minutes, and not a minute before`, () => {
      const at = running(SILENT_MINUTES + 5, 5);
      const before = running(SILENT_MINUTES + 4, 5);
      expect(needs({ all: [at] })).toMatchObject([{ kind: "silent", machine: "node-a", story: "3", run: { runId: "run" } }]);
      expect((needs({ all: [at] })[0] as Extract<Need, { kind: "silent" }>).minutes).toBeCloseTo(SILENT_MINUTES);
      expect(needs({ all: [before] })).toEqual([]);
    });
    it("a long story that is still reporting is not stuck", () => {
      expect(needs({ all: [running(600, 600)] })).toEqual([]);
    });
    it("is looked for in every run, whatever pack or version the page shows", () => {
      expect(kinds(needs({ rows: [], all: [running(120, 5)] }))).toEqual(["silent"]);
    });
    it("never fires on missing data or while the story finishes", () => {
      expect(needs({ all: [running(null, 5), running(120, null), running(120, 5, { currentStory: null })] })).toEqual([]);
    });
    it("names the node the job runs on", () => {
      expect(needs({ all: [{ ...running(120, 5), node: "node-d", machine: "AMD box" }] })).toMatchObject([{ machine: "node-d" }]);
    });
  });

  describe("an idle machine: reachable, nothing running, nothing queued", () => {
    it("fires for a node with nothing running and nothing queued", () => {
      expect(needs({ machines: [machine("node-d")], reach: { "node-d": { ok: true } } })).toMatchObject([{ kind: "idle", machine: "node-d" }]);
    });
    it("fires before /api/machines answers: dbench listing the node is an answer", () => {
      expect(kinds(needs({ machines: [machine("node-d")], reach: null }))).toEqual(["idle"]);
    });
    it("not with one job queued and nothing running, nor with one running and nothing queued", () => {
      expect(needs({ machines: [machine("node-d", { queued: 1 }), busy("node-a")] })).toEqual([]);
    });
    it("an unreachable machine is unreachable, not idle", () => {
      expect(kinds(needs({ machines: [machine("node-d")], reach: { "node-d": { ok: false, error: "timed out" } } }))).toEqual(["unreachable"]);
    });
  });

  describe("an unreachable machine", () => {
    it("fires for each machine /api/machines couldn't reach, with dbench's error", () => {
      expect(needs({ reach: { down: { ok: false, error: "connection refused" }, up: { ok: true } } })).toEqual([
        { kind: "unreachable", key: "unreachable:down", machine: "down", error: "connection refused" },
      ]);
    });
    it("says nothing before /api/machines answers", () => {
      expect(needs({ reach: null })).toEqual([]);
    });
  });

  describe("a failed or stopped run from the last day", () => {
    const ended = (status: RunStatus, agoS: number, over: Partial<Row> = {}) =>
      row({ status, scores: {}, rescores: [], jobs: [job("j1", status, NOW - agoS, "agent crashed")], ...over });
    it("fires for failed and for stopped, with the reason", () => {
      expect(needs({ rows: [ended("failed", 60)] })).toMatchObject([{ kind: "ended", status: "failed", note: "agent crashed", endedAt: NOW - 60 }]);
      expect(kinds(needs({ rows: [ended("stopped", 60)] }))).toEqual(["ended"]);
    });
    it(`fires at exactly ${RECENT_END_S / 3600} hours, and not a second after`, () => {
      expect(kinds(needs({ rows: [ended("failed", RECENT_END_S)] }))).toEqual(["ended"]);
      expect(needs({ rows: [ended("failed", RECENT_END_S + 1)] })).toEqual([]);
    });
    it("not for cancelled (the operator did it), finished, running or queued runs", () => {
      for (const s of ["cancelled", "finished", "running", "queued"] as RunStatus[]) {
        expect(needs({ rows: [ended(s, 60, { scores: { [SUITE]: score(60, 75) }, rescores: [SUITE] })] }).filter((n) => n.kind === "ended")).toEqual([]);
      }
    });
    it("uses the record's time when there is no job, and the later of the two when both", () => {
      expect(kinds(needs({ rows: [row({ status: "failed", jobs: [], stateAt: new Date((NOW - 60) * 1000).toISOString() })] }))).toEqual(["ended"]);
      expect(kinds(needs({ rows: [ended("failed", 2 * DAY, { stateAt: new Date((NOW - 60) * 1000).toISOString() })] }))).toEqual(["ended"]);
    });
    it("never fires when when it ended is unknown", () => {
      expect(needs({ rows: [row({ status: "failed", jobs: [job("j", "failed", null)], stateAt: "" })] })).toEqual([]);
    });
    it("takes the reason from the run's note first, then its last job's", () => {
      expect(needs({ rows: [ended("failed", 60, { statusNote: "out of memory" })] })).toMatchObject([{ note: "out of memory" }]);
    });
    it("is only looked for in the runs the page shows", () => {
      expect(needs({ rows: [], all: [ended("failed", 60)] })).toEqual([]);
    });
  });

  describe("a finished run with no score of record: not scored, or a re-score fault", () => {
    it("not scored: never re-scored under the current suite, with why", () => {
      expect(needs({ rows: [row({ rescores: [], scores: {} })] })).toMatchObject([{ kind: "unscored", why: `not re-scored under ${SUITE} yet` }]);
    });
    it("not scored: re-scored only under another suite version, which the reason names", () => {
      const n = needs({ rows: [row({ rescores: ["vidi-v2.0-pre0"], scores: { "vidi-v2.0-pre0": score(60, 75) } })] });
      expect(n).toMatchObject([{ kind: "unscored" }]);
      expect((n[0] as Extract<Need, { kind: "unscored" }>).why).toMatch(/only under another suite version \(60\/75 under vidi-v2\.0-pre0\)/);
    });
    it("a re-score fault: re-scored under the current suite, but it gave no score of record", () => {
      expect(needs({ rows: [row({ rescores: [SUITE], scores: {} })] })).toMatchObject([{ kind: "rescoreFault", suite: SUITE }]);
    });
    it("a re-score fault: a result with no counts", () => {
      expect(kinds(needs({ rows: [row({ rescores: [SUITE], scores: { [SUITE]: score(null, 75) } })] }))).toEqual(["rescoreFault"]);
    });
    it("the two never fire together for one run", () => {
      const both = needs({ rows: [row({ rescores: [SUITE], scores: {} })] });
      expect(kinds(both)).toEqual(["rescoreFault"]);
    });
    it("a run of an older spec version is not flagged: this suite can't score another spec", () => {
      expect(needs({ rows: [row({ family: "vidi-v1", packVersion: "vidi-v1.1", rescores: [], scores: {} })] })).toEqual([]);
    });
    it("a run whose version family is unknown is not flagged either", () => {
      expect(needs({ rows: [row({ family: "", rescores: [], scores: {} })] })).toEqual([]);
    });
    it("a scored run, and runs that haven't finished, are not flagged", () => {
      for (const status of ["running", "queued", "failed", "stopped", "cancelled", "unknown"] as RunStatus[]) {
        expect(needs({ rows: [row({ status, rescores: [], scores: {} })] }).filter((n) => n.kind === "unscored" || n.kind === "rescoreFault")).toEqual([]);
      }
      expect(needs({ rows: [row()] })).toEqual([]);
    });
  });

  describe("a story whose accounting check failed", () => {
    const bad = (id: string) => story(id, { usage: usage({ split: split({ status: "problems", problems: ["parts sum to 590 s of 600 s"] }) }) });
    it("one line per run, naming each failing story and its problems", () => {
      expect(needs({ rows: [row({ stories: [bad("1"), story("2"), bad("4")] })] })).toMatchObject([
        { kind: "accounting", stories: [{ id: "1", problems: ["parts sum to 590 s of 600 s"] }, { id: "4" }] },
      ]);
    });
    it("fires on a running run's recorded stories too", () => {
      expect(kinds(needs({ rows: [row({ status: "running", scores: {}, rescores: [], stories: [bad("1")] })] }))).toEqual(["accounting"]);
    });
    it("not for a check that passed, one never made (unchecked), or a story with no split or usage", () => {
      expect(needs({ rows: [row({ stories: [
        story("1"), story("2", { usage: usage({ split: split({ status: "unchecked", problems: [] }) }) }),
        story("3", { usage: usage({ split: null }) }), story("4", { usage: null }),
      ] })] })).toEqual([]);
    });
  });

  describe("order", () => {
    it("by kind: what wastes a machine first, then what blocks a result, then doubtful numbers", () => {
      expect(NEED_KINDS).toEqual(["silent", "unreachable", "ended", "idle", "rescoreFault", "unscored", "accounting"]);
      const all = [running(120, 5)];
      const rows = [
        row({ runId: "u", rescores: [], scores: {} }),
        row({ runId: "f", status: "failed", scores: {}, rescores: [], jobs: [job("j", "failed", NOW)] }),
        row({ runId: "a", stories: [story("1", { usage: usage({ split: split({ status: "problems", problems: ["x"] }) }) })] }),
        row({ runId: "r", rescores: [SUITE], scores: {} }),
      ];
      const reach: Reachability = { down: { ok: false }, "node-d": { ok: true } };
      expect(kinds(needs({ rows, all, machines: [machine("node-d")], reach }))).toEqual(["silent", "unreachable", "ended", "idle", "rescoreFault", "unscored", "accounting"]);
    });
    it("within a kind, by what it is about, numbers in order", () => {
      const n = needs({ machines: [machine("node-10"), machine("node-9"), machine("alpha")] });
      expect(n.map(subject)).toEqual(["alpha", "node-9", "node-10"]);
    });
    it("every need has its own key", () => {
      const n = needs({ rows: [row({ runId: "a", rescores: [], scores: {} }), row({ runId: "b", rescores: [], scores: {} })], machines: [machine("x"), machine("y")] });
      expect(new Set(n.map((x) => x.key)).size).toBe(n.length);
    });
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
      story: "3", storyTitle: "Sticky notes", finishing: false, minutes: 12, queued: 2, error: "",
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
  it("unreachable: /api/machines couldn't reach it, whatever dbench last said", () => {
    expect(nowLines([busy("node-a")], [], { "node-a": { ok: false, error: "timed out" } }, NOW)[0]).toMatchObject({ state: "unreachable", error: "timed out", run: null });
    expect(nowLines([], [], { down: { ok: false } }, NOW)[0]).toMatchObject({ machine: "down", state: "unreachable", error: "no answer" });
  });
  it("in the machine list and reachable, but not in dbench's job list: can't say what it does", () => {
    expect(nowLines([], [], { fresh: { ok: true } }, NOW)[0]).toMatchObject({ state: "unreachable", error: "dbench's job list has nothing for it" });
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
describe("an invalid run needs nothing from you: it is left out", () => {
  const INVALID = { reason: "read the reference build in story 7", since: "2026-09-30" };
  const bad = (over: Partial<Row>) => row({ invalid: INVALID, ...over });
  it("not unscored, not a re-score fault", () => {
    expect(needs({ rows: [bad({ rescores: [], scores: {} })] })).toEqual([]);
    expect(needs({ rows: [bad({ rescores: [SUITE], scores: {} })] })).toEqual([]);
  });
  it("not a failure or stop from the last day", () => {
    expect(needs({ rows: [bad({ status: "failed", scores: {}, rescores: [], jobs: [job("j", "failed", NOW - 60)] })] })).toEqual([]);
  });
  it("not an accounting problem", () => {
    expect(needs({ rows: [bad({ stories: [story("1", { usage: usage({ split: split({ status: "problems", problems: ["x"] }) }) })] })] })).toEqual([]);
  });
  it("not a silent story", () => {
    expect(needs({ all: [{ ...running(120, 5), invalid: INVALID }] })).toEqual([]);
  });
  it("the same run without the mark does need you (the control)", () => {
    expect(kinds(needs({ rows: [row({ rescores: [], scores: {} })] }))).toEqual(["unscored"]);
  });
  it("its machine is still judged as a machine: busy with it is not idle", () => {
    expect(needs({ machines: [busy("node-a")], all: [{ ...running(1, 1), invalid: INVALID }] })).toEqual([]);
  });
  it("the machine's now line names the run with its mark, so it can be struck through", () => {
    const r = { ...running(1, 1), invalid: INVALID };
    const [line] = nowLines([busy("node-a")], [r], null, NOW);
    expect(line.run?.invalid).toEqual(INVALID);
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
