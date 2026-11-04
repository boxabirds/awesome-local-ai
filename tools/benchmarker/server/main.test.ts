// main.ts is the server entry point: importing it parses argv and starts listening. These tests start it in fixture
// mode, as the end-to-end tests do (`--fixture`), on a free port, and drive it over HTTP.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer as listenOn } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const started: Server[] = [];
vi.mock("node:http", async (original) => {
  const real = await original<typeof import("node:http")>();
  // Keep a handle on the server main.ts creates, so the test can stop it.
  return { ...real, default: real, createServer: ((...a: Parameters<typeof real.createServer>) => { const s = real.createServer(...a); started.push(s); return s; }) as typeof real.createServer };
});

const SCRATCH = mkdtempSync(join(tmpdir(), "benchmarker-main-"));
const FIXTURE = join(SCRATCH, "fixture.json");
const DIST = join(SCRATCH, "dist");
const j = (v: unknown) => JSON.stringify(v);

const POLL_LIMIT_MS = 10_000;
const POLL_EVERY_MS = 25;
/** main.ts reads the lake this often (its FETCH_EVERY_MS). */
const FETCH_EVERY_MS = 60_000;
const OLD_UPDATE = 5; // seconds since 1970: long ago
const job = (id: string, status: string, updated_at?: number) => ({ id, spec: { pack: "benchmarks/vidi", run_id: id, install_id: "i" }, progress: { combination: "c" }, state: { status }, submitted_at: 1, ...(updated_at === undefined ? {} : { updated_at }) });

// The fixture with every optional part left out.
const BARE = { records: [], suites: { vidi: "vidi-v1" }, jobs: { "node-a": [job("fresh", "failed"), job("old", "failed", OLD_UPDATE), job("q", "queued")] } };
// The same file, rewritten with every optional part present.
const FULL = {
  ...BARE, documents: { "combinations/s/benchmarks/vidi/fresh/summary.md": "# fresh\n" }, flowCounts: { "vidi-v1": { "1": 4, "2": 3 } },
  machines: { "node-a": { hostname: "node-a-from-fixture", combinations: [] } },
  conversations: { "story-x": { fmt: "pi", complete: false, node: "node-a", events: [{ tMs: 1, kind: "msg", ord: 0, idx: 0 }] } },
  activity: { version: 9, themes: [], rows: [] },
};

const scopeOf = (state: any, runId: string): number => state.rows.find((r: any) => r.runId === runId).storiesWorking.scope;
let base = "";
/** Starts main.ts afresh with these arguments and says where it listens. */
async function startMain(...args: string[]): Promise<string> {
  vi.resetModules();
  const port = await freePort();
  process.argv = [process.argv[0], "main.ts", ...args, "--port", String(port), "--dist", DIST];
  await import("./main.ts");
  return `http://127.0.0.1:${port}`;
}
const get = async (path: string) => (await fetch(base + path)).json() as Promise<any>;

async function freePort(): Promise<number> {
  const probe = listenOn();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((ok) => probe.close(ok));
  return port;
}

const PATH_BEFORE = process.env.PATH;
afterAll(() => { process.env.PATH = PATH_BEFORE; delete process.env.GIT_ALLOW_PROTOCOL; vi.useRealTimers(); });

afterAll(async () => {
  for (const s of started) await new Promise((ok) => { s.close(ok); s.closeAllConnections(); });
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("loadFixture(): the fixed inputs of fixture mode", () => {
  beforeAll(async () => {
    writeFileSync(FIXTURE, j(BARE));
    base = await startMain("--fixture", FIXTURE);
  });

  it("at start, a fixture with only records, suites and jobs: no documents, no flow counts, default machine info, nothing to say about conversations", async () => {
    const state = await get("/api/state");
    expect(state.suites).toEqual({ vidi: "vidi-v1" });
    expect(state).not.toHaveProperty("web");
    expect((await fetch(`${base}/record/combinations/s/benchmarks/vidi/fresh/summary.md`)).status).toBe(404);
    expect(state.updating).toBe(true);
    expect(scopeOf(state, "fresh")).toBe(0); // no flow counts: the suite's stories are not known
    const machines = await get("/api/machines");
    expect(machines).toEqual([{ name: "node-a", url: "http://node-a:7717", ok: true, node: { hostname: "node-a", combinations: [] } }]);
    expect(await get("/api/conversations")).toEqual({ ids: [], complete: [] });
    expect(await get("/api/conversations/activity")).toEqual({ version: 0, themes: [], rows: [] });
  });

  it("a job with no updated_at is stamped as just updated, so a failed one still shows; one with an old time is gone from the list", async () => {
    const rows = (await get("/api/state")).rows as { runId: string }[];
    expect(rows.map((r) => r.runId).sort()).toEqual(["fresh", "q"]);
  });

  it("a reset loads the file afresh: every optional part of the fixture is then used", async () => {
    writeFileSync(FIXTURE, j(FULL));
    expect((await fetch(`${base}/api/test/reset`, { method: "POST" })).status).toBe(204);
    const state = await get("/api/state");
    const doc = await fetch(`${base}/record/combinations/s/benchmarks/vidi/fresh/summary.md`);
    expect([doc.status, doc.headers.get("content-type"), await doc.text()]).toEqual([200, "text/plain; charset=utf-8", "# fresh\n"]);
    expect(scopeOf(state, "fresh")).toBe(2); // the suite's flow counts name two stories
    expect((await get("/api/machines"))[0].node.hostname).toBe("node-a-from-fixture");
    expect(await get("/api/conversations")).toEqual({ ids: ["story-x"], complete: [] });
    expect(await get("/api/conversations/activity")).toEqual({ version: 9, themes: [], rows: [] });
  });

  it("a reset undoes what a test changed: a queued job a test cancelled is queued again", async () => {
    const statusOfQ = async () => ((await get("/api/state")).rows as { runId: string; status: string }[]).find((r) => r.runId === "q")?.status ?? "";
    expect(await statusOfQ()).toBe("queued");
    const cancelled = await (await fetch(`${base}/api/jobs/node-a/q/cancel`, { method: "POST", headers: { "X-Benchmarker": "1" } })).json() as { ok: boolean };
    expect(cancelled.ok).toBe(true);
    expect(await statusOfQ()).toBe("cancelled");
    await fetch(`${base}/api/test/reset`, { method: "POST" });
    expect(await statusOfQ()).toBe("queued");
  });
});

// Started without --fixture, main.ts reads the lake through bench-lake and asks dbench. Here the lake and the checkout
// are temporary folders, dbench is not on the PATH (so no machine is contacted), git on the PATH fails the read if it is
// run for run data, the warehouse's address is a port nothing listens on, and the timers that would repeat the reads are
// held (the first read of each still runs at once; a test moves them on by hand).
describe("started without a fixture: the live sources", () => {
  const ROOT = mkdtempSync(join(tmpdir(), "benchmarker-main-live-"));
  const gitIn = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null" } });
  const RUN = "combinations/fam/1.0/27b/ubuntu/box/llamacpp-pi/benchmarks/vidi/r1";
  const BENCH_LAKE = process.env.BENCH_LAKE ?? join(import.meta.dirname, "../../target/debug/bench-lake");
  const FAIL_FLAG = join(ROOT, "bench-lake-fails");
  let withPrivate = "", noGit = "", failing = "", lake = "", checkout = "";

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const unused = `http://127.0.0.1:${await freePort()}`;
    // the lake: one run, on one node; the checkout: a plain folder (not a repository) with the pack's bench.json
    lake = join(ROOT, "state");
    mkdirSync(join(lake, "collected/node-a", RUN), { recursive: true });
    writeFileSync(join(lake, "collected/node-a", RUN, "run.json"), j({ host: "hostA" }));
    writeFileSync(join(lake, "collected/node-a", RUN, "summary.md"), "# r1\n");
    checkout = join(ROOT, "checkout");
    mkdirSync(join(checkout, "benchmarks/vidi"), { recursive: true });
    writeFileSync(join(checkout, "benchmarks/vidi/bench.json"), j({ pack_ref: "vidi-v1" }));
    // bench-lake, through a wrapper that fails while a flag file exists
    const wrapper = join(ROOT, "bench-lake");
    writeFileSync(wrapper, `#!/bin/sh\nif [ -e "${FAIL_FLAG}" ]; then echo "bench-lake: the lake is gone" >&2; exit 2; fi\nexec "${BENCH_LAKE}" "$@"\n`);
    chmodSync(wrapper, 0o755);

    // the private suite (flow counts come from its tags, with the real git)
    const priv = join(ROOT, "private");
    mkdirSync(priv);
    gitIn(priv, "init", "-q", "-b", "main");
    const suiteDir = join(priv, "packs/vidi/acceptance/tests");
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(join(suiteDir, "story-01.spec.ts"), 'test("a", async () => {});\n');
    writeFileSync(join(suiteDir, "story-02.spec.ts"), 'test("b", async () => {});\ntest("c", async () => {});\n');
    gitIn(priv, "add", "-A");
    gitIn(priv, "commit", "-q", "-m", "suite");
    gitIn(priv, "tag", "vidi-v1");

    // a PATH that has git and nothing else
    const bin = join(ROOT, "bin");
    mkdirSync(bin);
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
    // a PATH whose git fails, loudly, if anything runs it
    const noGitBin = join(ROOT, "no-git-bin");
    mkdirSync(noGitBin);
    writeFileSync(join(noGitBin, "git"), "#!/bin/sh\necho git was run >&2\nexit 99\n");
    chmodSync(join(noGitBin, "git"), 0o755);

    // The PATH is the process's, shared by every server started here: the server without git reads first, alone.
    const common = ["--repo", checkout, "--lake", lake, "--conversations-url", unused];
    process.env.PATH = noGitBin;
    noGit = await startMain(...common, "--bench-lake", BENCH_LAKE);
    await until(noGit, (x) => x.rows.length > 0);
    process.env.PATH = bin;
    withPrivate = await startMain(...common, "--bench-lake", BENCH_LAKE, "--private", priv);
    failing = await startMain(...common, "--bench-lake", wrapper);
  });
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  const get2 = async (at: string) => (await fetch(`${at}/api/state`)).json() as Promise<any>;
  /** The state once `ready` holds of it (the reads run in the background after the server starts). */
  async function until(at: string, ready: (st: any) => boolean): Promise<any> {
    const deadline = Date.now() + POLL_LIMIT_MS;
    for (;;) {
      const st = await (await fetch(`${at}/api/state`)).json() as any;
      if (ready(st) || Date.now() > deadline) return st;
      await sleep(POLL_EVERY_MS);
    }
  }

  it("reads the runs in the lake, and the suite's flow counts from the --private repository", async () => {
    const st = await until(withPrivate, (x) => x.rows.length > 0);
    expect(st.rows.map((r: any) => [r.runId, r.host])).toEqual([["r1", "hostA"]]);
    expect(st).not.toHaveProperty("branch");
    expect(scopeOf(st, "r1")).toBe(2); // the two story files of the suite at the tag, in the --private repository
    expect(st.updatedAt).toBe(0); // dbench could not be read, so the page is not told the data is fresh
  });

  it("needs no git for the runs: the checkout is not a repository and git fails if run, and the runs are listed", async () => {
    const st = await until(noGit, (x) => x.rows.length > 0);
    expect(st.rows.map((r: any) => r.runId)).toEqual(["r1"]);
  });

  it("serves the run's record from the lake at the app's own address", async () => {
    await until(noGit, (x) => x.rows.length > 0);
    const index = await fetch(`${noGit}/record/${RUN}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain(`<a href="/record/${RUN}/summary.md">summary.md</a>`);
    expect(await (await fetch(`${noGit}/record/${RUN}/summary.md`)).text()).toBe("# r1\n");
  });

  it("bench-lake failing keeps the runs of the last load, and the page is told only that it is not updating", async () => {
    const before = await until(failing, (x) => x.rows.length > 0);
    expect(before.rows.map((r: any) => r.runId)).toEqual(["r1"]);
    writeFileSync(FAIL_FLAG, "");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(FETCH_EVERY_MS);
    const deadline = Date.now() + POLL_LIMIT_MS;
    while (!errors.mock.calls.length && Date.now() < deadline) await sleep(POLL_EVERY_MS);
    const after = await get2(failing);
    expect(after.updating).toBe(false);
    expect(after.rows.map((r: any) => r.runId)).toEqual(["r1"]);
    expect(JSON.stringify(after)).not.toMatch(/bench-lake|the lake is gone/);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/the lake could not be read.*the lake is gone/);
    errors.mockRestore();
  });

  it("the warehouse not answering is no conversations, not a failure", async () => {
    expect(await (await fetch(`${withPrivate}/api/conversations`)).json()).toEqual({ ids: [], complete: [] });
  });
});
