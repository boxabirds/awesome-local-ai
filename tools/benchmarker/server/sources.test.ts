import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { finalizePath, git, isKnownGood, loadFlowCounts, loadRuns, rescoreStoryPaths, rescoredStory, runFinalize, runNotes, runNotePaths } from "./sources.ts";

// A re-scored story's counts: since 30 Sep 2026 a record has only the public summary (accept-summary.json);
// the full result (accept.json) is private. Older records have only the full result.
const DIR = "combinations/some/stack/benchmarks/vidi/r1";
const V = "vidi-v2.0-pre2";
const SUMMARY = `${DIR}/rescore/${V}/stories/12/accept-summary.json`;
const FULL = `${DIR}/rescore/${V}/stories/12/accept.json`;
const counts = (passed: number) => JSON.stringify({ passed, total: 75, by_story: { "12": { passed, total: 5 } } });

describe("a partial rerun (metrics.json's known_good)", () => {
  it("present and an object: known good", () => {
    expect(isKnownGood({ known_good: { from_run: "x", story: 2 } })).toBe(true);
  });
  it("absent, null, or not an object: a full run", () => {
    expect(isKnownGood({})).toBe(false);
    expect(isKnownGood({ known_good: null })).toBe(false);
    expect(isKnownGood({ known_good: false })).toBe(false);
    expect(isKnownGood(null)).toBe(false);
  });
});

describe("a re-scored story's counts", () => {
  it("are looked for in the public summary first, then the full result", () => {
    expect(rescoreStoryPaths(DIR, V, "12")).toEqual([SUMMARY, FULL]);
    expect(rescoreStoryPaths(DIR, V, "3")[0]).toBe(`${DIR}/rescore/${V}/stories/03/accept-summary.json`);
  });
  it("come from the summary when the record has one", () => {
    expect(rescoredStory(new Map([[SUMMARY, counts(4)], [FULL, counts(1)]]), DIR, V, "12")?.by_story).toEqual({ "12": { passed: 4, total: 5 } });
  });
  it("come from the full result in a record from before the summaries", () => {
    expect(rescoredStory(new Map([[FULL, counts(1)]]), DIR, V, "12")?.by_story).toEqual({ "12": { passed: 1, total: 5 } });
  });
  it("fall back past a summary that doesn't parse, and are null when there is nothing", () => {
    expect(rescoredStory(new Map([[SUMMARY, "{not json"], [FULL, counts(2)]]), DIR, V, "12")?.by_story?.["12"].passed).toBe(2);
    expect(rescoredStory(new Map(), DIR, V, "12")).toBeNull();
  });
});

// ---------- what the record says about the run itself ----------

describe("a run's notes: its client and invalid mark (run.json), and interventions (interventions.md)", () => {
  const RUN = `${DIR}/run.json`;
  const IV = `${DIR}/interventions.md`;
  const meta = (extra: Record<string, unknown>) => JSON.stringify({ pack: "vidi", pack_version: V, ...extra }, null, 2);

  it("are read from run.json and interventions.md beside it", () => expect(runNotePaths(DIR)).toEqual([RUN, IV]));
  it("both present", () => {
    const n = runNotes(new Map([[RUN, meta({ invalid: { reason: "read the reference build in story 7", since: "2026-09-30" } })], [IV, "- 2026-09-26T08:57:29Z story 3: node-c froze"]]), DIR);
    expect(n.invalid).toEqual({ reason: "read the reference build in story 7", since: "2026-09-30" });
    expect(n.interventions).toEqual([{ at: Date.parse("2026-09-26T08:57:29Z") / 1000, story: "3", text: "node-c froze" }]);
  });
  it("neither: a valid run with no interventions", () => {
    expect(runNotes(new Map([[RUN, meta({})]]), DIR)).toEqual({ client: "", invalid: null, sandbox: null, expertCache: null, interventions: [] });
    expect(runNotes(new Map(), DIR)).toEqual({ client: "", invalid: null, sandbox: null, expertCache: null, interventions: [] });
  });
  it("the hot-expert cache the engine settled on, where its settings record one", () => {
    const settings = { engine_settings: { expert_cache: { value: { requested: "auto", experts: 9094, vram_gib: 14.73 }, source: "engine startup", evidence: "server log: …" } } };
    expect(runNotes(new Map([[RUN, meta(settings)]]), DIR).expertCache).toEqual({ requested: "auto", experts: 9094, vramGib: 14.73 });
  });
  it("the client that ran it, as run.json names it (Claude Code runs have no time accounting yet)", () => {
    expect(runNotes(new Map([[RUN, meta({ client: "claude" })]]), DIR).client).toBe("claude");
    expect(runNotes(new Map([[RUN, meta({ client: "pi" })]]), DIR).client).toBe("pi");
  });
  it("the sandbox its agent ran in, as run.json records it: mode, agent-sandbox's version, platform and policy hash", () => {
    const enforced = { mode: "enforced", version: "0.2.0", platform: "linux-x86_64", policy_hash: "ab".repeat(32) };
    expect(runNotes(new Map([[RUN, meta({ sandbox: enforced })]]), DIR).sandbox)
      .toEqual({ mode: "enforced", version: "0.2.0", platform: "linux-x86_64", policyHash: "ab".repeat(32) });
    expect(runNotes(new Map([[RUN, meta({ sandbox: { mode: "permissive" } })]]), DIR).sandbox)
      .toEqual({ mode: "permissive", version: "", platform: "", policyHash: "" });
    for (const raw of [undefined, null, "enforced", 3, {}, { mode: "" }, { mode: 7 }]) {
      expect(runNotes(new Map([[RUN, meta({ sandbox: raw })]]), DIR).sandbox).toBeNull();
    }
  });
  it("a run.json that doesn't parse says nothing about validity", () => {
    expect(runNotes(new Map([[RUN, "{not json"]]), DIR).invalid).toBeNull();
  });
});

// ---------- what the run's final re-score recorded ----------

describe("a run's final re-score (finalize.json): kept whole for the faults feed", () => {
  const FIN = `${DIR}/finalize.json`;
  it("finalize.json is read from the run's folder", () => expect(finalizePath(DIR)).toBe(FIN));
  it("present: verbatim, every field as written", () => {
    const raw = { version: `${V}+28ace8b`, pack_ref: V, at: "2026-10-01T08:25:57Z", rescore: "skipped", reason: `the suite checkout is at ${V}+28ace8b, not the pack's ${V}`, needs_person: true, attempts: 3, history: [{ at: "x" }] };
    expect(runFinalize(new Map([[FIN, JSON.stringify(raw)]]), DIR)).toEqual(raw);
  });
  it("absent, or not parseable: null", () => {
    expect(runFinalize(new Map(), DIR)).toBeNull();
    expect(runFinalize(new Map([[FIN, "{not json"]]), DIR)).toBeNull();
  });
});

// ---------- real temporary git repositories ----------

const SCRATCH = mkdtempSync(join(tmpdir(), "benchmarker-sources-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
/** Runs git (synchronously, to build a fixture) in `cwd` and returns its output. */
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { env: { ...process.env, ...IDENTITY, GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8" });
/** Writes the files (path -> text) into a work tree. */
function put(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}
const j = (v: unknown) => JSON.stringify(v);

describe("git(): runs git in the given repository and gives its output", () => {
  it("returns stdout of the command, run in that repository", async () => {
    const repo = join(SCRATCH, "git-basic");
    mkdirSync(repo);
    g(repo, "init", "-q", "-b", "main");
    expect(await git(repo, "rev-parse", "--is-inside-work-tree")).toBe("true\n");
    expect((await git(repo, "rev-parse", "--show-toplevel")).trim().endsWith("git-basic")).toBe(true);
  });
  it("rejects with git's own message when the command fails", async () => {
    const notRepo = join(SCRATCH, "git-not-a-repo");
    mkdirSync(notRepo);
    await expect(git(notRepo, "rev-parse", "HEAD")).rejects.toThrow(/not a git repository|ambiguous argument|unknown revision/);
  });
});

describe("loadRuns(): every pushed run record, read from the fetched origin/main", () => {
  const R1 = "combinations/stackA/benchmarks/vidi/r1";
  const R2 = "combinations/stackA/benchmarks/vidi/r2";
  const R3 = "combinations/stackA/benchmarks/vidi/r3";
  const R4 = "combinations/stackA/benchmarks/vidi/r4";
  const RREF = "benchmarks/reference/other/stackB/r9";
  const story = (title: string, passed: number, total: number) => ({ title, status: "DONE", accept: { passed, total, by_story: { "01": { passed: 1, total: 2 }, "02": { passed: 3, total: 4 } } } });

  const files: Record<string, string> = {
    "benchmarks/vidi/bench.json": j({ pack_ref: "vidi-v2" }),
    // r1: a finished run built under vidi-v1 and scored under vidi-v2; stories keyed by id, listed out of order.
    [`${R1}/run.json`]: j({ host: "hostA", pack_version: "vidi-v1", client: "pi" }),
    [`${R1}/run-status.json`]: j({ state: "finished", at: "2026-10-01T10:00:00Z" }),
    [`${R1}/metrics.json`]: j({ stories: { "2": story("Second", 5, 8), "1": story("First", 2, 4) }, known_good: { run: "x" } }),
    [`${R1}/finalize.json`]: j({ rescore: "done", built_under: { version: "vidi-v1", scored_under: "vidi-v2" } }),
    [`${R1}/rescore/vidi-v2/rescore.json`]: j({ finished_at: "2026-10-01T11:00:00Z", results: [{ story: 1, passed: 1, total: 4, flaky: 1 }, { story: 2, passed: 7, total: 8, flaky: 2 }] }),
    [`${R1}/rescore/vidi-v2/stories/01/accept-summary.json`]: j({ passed: 3, total: 4, by_story: { "01": { passed: 3, total: 4 } } }),
    [`${R1}/rescore/vidi-v2/stories/02/accept-summary.json`]: j({ passed: 7, total: 8, by_story: { "01": { passed: 3, total: 4 }, "02": { passed: 4, total: 4 } } }),
    [`${R1}/interventions.md`]: "- 2026-09-26T08:57:29Z story 3: restarted the engine\n",
    // r2: stories as a list, no run-status, a spoiled re-score (harness_fault) and a re-scored story without per-story counts.
    [`${R2}/run.json`]: j({ host: "hostB" }),
    [`${R2}/metrics.json`]: j({ stories: [story("Only", 6, 6)] }),
    [`${R2}/rescore/vidi-v2/rescore.json`]: j({ results: [{ story: 1, passed: 0, total: 6, harness_fault: "  machine froze  " }] }),
    [`${R2}/rescore/vidi-v2/stories/01/accept.json`]: j({ passed: 6 }),
    // r3: a run.json that doesn't parse, no metrics.
    [`${R3}/run.json`]: "{not json",
    // r4: stories keyed "02" before "01" (zero-padded keys keep the order they were written in).
    [`${R4}/run.json`]: j({}),
    [`${R4}/metrics.json`]: j({ stories: { "02": story("Two", 1, 1), "01": story("One", 1, 1) } }),
    // A reference run whose pack has no bench.json; and an archived run, which is not listed.
    [`${RREF}/run.json`]: j({}),
    "combinations/stackA/benchmarks/vidi/gone/run.json": j({}),
    "combinations/stackA/benchmarks/vidi/gone/archived.json": j({}),
    "README.md": "not a run",
  };

  const origin = join(SCRATCH, "runs-origin.git");
  const repo = join(SCRATCH, "runs-clone");
  let loaded: Awaited<ReturnType<typeof loadRuns>>;
  const rec = (runId: string) => loaded.records.find((r) => r.runId === runId)!;

  it("fetches origin/main and reads the records and each pack's current version", async () => {
    g(SCRATCH, "init", "-q", "--bare", "-b", "main", origin);
    const work = join(SCRATCH, "runs-work");
    g(SCRATCH, "clone", "-q", origin, work);
    g(work, "checkout", "-q", "-B", "main");
    put(work, files);
    g(work, "add", "-A");
    g(work, "commit", "-q", "-m", "records");
    g(work, "push", "-q", "origin", "main");
    g(SCRATCH, "clone", "-q", origin, repo); // the clone is at the commit; push a newer one so only a fetch can see it
    put(work, { [`${R3}/run-status.json`]: j({ state: "running", at: "2026-10-02T00:00:00Z" }) });
    g(work, "add", "-A");
    g(work, "commit", "-q", "-m", "later");
    g(work, "push", "-q", "origin", "main");
    loaded = await loadRuns(repo);
    expect(loaded.records.map((r) => r.runId).sort()).toEqual(["r1", "r2", "r3", "r4", "r9"]);
    expect(loaded.suites).toEqual({ vidi: "vidi-v2", other: "" });
    expect(rec("r3").state).toBe("running"); // seen only because loadRuns fetched first
  });

  it("a finished run: host, version, state, client, notes, known_good", () => {
    const r = rec("r1");
    expect(r).toMatchObject({ pack: "vidi", stack: "stackA", dir: R1, host: "hostA", packVersion: "vidi-v1", state: "finished", stateAt: "2026-10-01T10:00:00Z", client: "pi", knownGood: true });
    expect(r.interventions).toEqual([{ at: Date.parse("2026-09-26T08:57:29Z") / 1000, story: "3", text: "restarted the engine" }]);
    expect(r.finalize).toMatchObject({ rescore: "done" });
  });

  it("stories keyed by id are listed in numeric order, and take their figures from the later suite's re-score when the run was built under an earlier one", () => {
    const s = rec("r1").stories;
    expect(s.map((x) => [x.id, x.title])).toEqual([["1", "First"], ["2", "Second"]]);
    expect([s[0].passed, s[0].total, s[0].ownPassed, s[0].ownTotal]).toEqual([3, 4, 3, 4]); // from rescore/vidi-v2/stories/01, not metrics.json's 2 of 4
    expect([s[1].passed, s[1].total, s[1].ownPassed, s[1].ownTotal]).toEqual([7, 8, 4, 4]);
  });

  it("the score of record is the last story's re-score of a finished run, with the flaky tests added up", () => {
    expect(rec("r1").scores).toEqual({ "vidi-v2": { passed: 7, total: 8, flaky: 3, at: "2026-10-01T11:00:00Z" } });
    expect(rec("r1").rescoreFaults).toEqual({});
  });

  it("the latest re-scored story's per-story counts, by version", () => {
    expect(rec("r1").rescored).toEqual({ "vidi-v2": { after: "2", byStory: { "1": { passed: 3, total: 4 }, "2": { passed: 4, total: 4 } } } });
    expect(rec("r2").rescored).toEqual({}); // its re-scored story has no per-story counts
  });

  it("stories listed in order are numbered from 1; a spoiled re-score gives a fault and no score; no run-status is an empty state", () => {
    const r = rec("r2");
    expect(r.stories.map((x) => [x.id, x.title, x.passed, x.total])).toEqual([["1", "Only", 6, 6]]);
    expect(r.scores).toEqual({});
    expect(r.rescoreFaults).toEqual({ "vidi-v2": "machine froze" });
    expect([r.state, r.stateAt, r.host, r.packVersion, r.knownGood]).toEqual(["", "", "hostB", "", false]);
  });

  it("a run.json that doesn't parse, and no metrics: an empty record, not an error", () => {
    const r = rec("r3");
    expect([r.host, r.packVersion, r.client, r.knownGood]).toEqual(["", "", "", false]);
    expect(r.stories).toEqual([]);
    expect(r.scores).toEqual({});
  });

  it("stories are listed in numeric order whatever order the keys were written in", () => {
    expect(rec("r4").stories.map((x) => x.title)).toEqual(["One", "Two"]);
  });

  it("reference runs are listed under their stack, and an archived run is not listed", () => {
    expect(rec("r9")).toMatchObject({ pack: "other", stack: "reference/stackB", dir: RREF });
    expect(loaded.records.some((r) => r.runId === "gone")).toBe(false);
  });
});

describe("loadFlowCounts(): tests per story in the private suite, by version tag", () => {
  const priv = join(SCRATCH, "private");
  const tests = (n: number) => Array.from({ length: n }, (_, i) => `test("case ${i}", async () => {});\n`).join("");
  const DIR_OF = (pack: string) => `packs/${pack}/acceptance/tests`;

  it("counts the tests of each story file at the tag; non-story files are ignored; unknown tags, empty versions and repeats are left out", async () => {
    mkdirSync(priv);
    g(priv, "init", "-q", "-b", "main");
    put(priv, {
      [`${DIR_OF("vidi")}/story-01.spec.ts`]: tests(3),
      [`${DIR_OF("vidi")}/story-12.spec.ts`]: tests(5) + "// test(not a test)\n",
      [`${DIR_OF("vidi")}/helpers.ts`]: tests(9),
      "packs/empty/README.md": "no acceptance tests here",
    });
    g(priv, "add", "-A");
    g(priv, "commit", "-q", "-m", "suite");
    g(priv, "tag", "vidi-v7");
    // no origin: the fetch fails and the tags already here are used
    const out = await loadFlowCounts(priv, [
      { pack: "vidi", version: "vidi-v7" },
      { pack: "vidi", version: "vidi-v7" }, // a version already counted
      { pack: "vidi", version: "" }, // a run with no version
      { pack: "vidi", version: "vidi-v404" }, // no such tag
      { pack: "empty", version: "vidi-v7" }, // the tag is there, the pack's tests are not
    ]);
    expect(out).toEqual({ "vidi-v7": { "1": 3, "12": 5 } });
  });

  it("a tag's counts are kept: asking again does not need the repository", async () => {
    g(priv, "tag", "-d", "vidi-v7");
    expect(await loadFlowCounts(priv, [{ pack: "vidi", version: "vidi-v7" }])).toEqual({ "vidi-v7": { "1": 3, "12": 5 } });
  });

  it("a tag that was never read and is gone gives nothing", async () => {
    expect(await loadFlowCounts(priv, [{ pack: "vidi", version: "vidi-v7-other" }])).toEqual({});
  });
});
