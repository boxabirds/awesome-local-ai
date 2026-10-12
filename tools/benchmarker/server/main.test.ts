// main.ts is the server entry point: importing it parses argv and starts listening. These tests start it in fixture
// mode, as the end-to-end tests do (`--fixture`), on a free port, and drive it over HTTP.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const OLD_UPDATE = 5; // seconds since 1970: long ago
const job = (id: string, status: string, updated_at?: number) => ({ id, spec: { pack: "benchmarks/vidi", run_id: id, install_id: "i" }, progress: { combination: "c" }, state: { status }, submitted_at: 1, ...(updated_at === undefined ? {} : { updated_at }) });

// The fixture with every optional part left out.
const BARE = { records: [], suites: { vidi: "vidi-v1" }, jobs: { "node-a": [job("fresh", "failed"), job("old", "failed", OLD_UPDATE), job("q", "queued")] } };
// The same file, rewritten with every optional part present.
const FULL = {
  ...BARE, web: "https://github.com/example/repo", flowCounts: { "vidi-v1": { "1": 4, "2": 3 } },
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

  it("at start, a fixture with only records, suites and jobs: no web link, no flow counts, default machine info, nothing to say about conversations", async () => {
    const state = await get("/api/state");
    expect(state.suites).toEqual({ vidi: "vidi-v1" });
    expect(state.web).toBeNull();
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
    expect(state.web).toBe("https://github.com/example/repo");
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

// Started without --fixture, main.ts reads a repository and asks dbench. Here the repository is a temporary one, dbench
// is not on the PATH (so no machine is contacted), the warehouse's address is a port nothing listens on, and the
// timers that would repeat the reads are held (the first read of each still runs at once).
describe("started without a fixture: the live sources", () => {
  const ROOT = mkdtempSync(join(tmpdir(), "benchmarker-main-live-"));
  const gitIn = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null" } });
  const RUN = "combinations/stackA/benchmarks/vidi/r1";
  let withOrigin = "", withoutOrigin = "", withWeb = "";

  beforeAll(async () => {
    // a PATH that has git and nothing else
    const bin = join(ROOT, "bin");
    mkdirSync(bin);
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
    process.env.PATH = bin;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const unused = `http://127.0.0.1:${await freePort()}`;

    const origin = join(ROOT, "origin.git"), repo = join(ROOT, "repo");
    gitIn(ROOT, "init", "-q", "--bare", "-b", "main", origin);
    gitIn(ROOT, "clone", "-q", origin, repo);
    gitIn(repo, "checkout", "-q", "-B", "main");
    mkdirSync(join(repo, RUN), { recursive: true });
    writeFileSync(join(repo, RUN, "run.json"), j({ host: "hostA" }));
    mkdirSync(join(repo, "benchmarks/vidi"), { recursive: true });
    writeFileSync(join(repo, "benchmarks/vidi/bench.json"), j({ pack_ref: "vidi-v1" }));
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "a run");
    gitIn(repo, "push", "-q", "origin", "main");

    const lone = join(ROOT, "lone");
    mkdirSync(lone);
    gitIn(lone, "init", "-q", "-b", "main");

    // with an origin and a --private repository
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
    withOrigin = await startMain("--repo", repo, "--private", priv, "--conversations-url", unused);
    // no origin, and no --private: the default is a sibling that does not exist
    withoutOrigin = await startMain("--repo", lone, "--conversations-url", unused);
    // an origin on GitHub: the page links to it. No transport but file is allowed, so nothing is fetched from it.
    const hosted = join(ROOT, "hosted");
    mkdirSync(hosted);
    gitIn(hosted, "init", "-q", "-b", "main");
    gitIn(hosted, "remote", "add", "origin", "git@github.com:example/repo.git");
    process.env.GIT_ALLOW_PROTOCOL = "file";
    withWeb = await startMain("--repo", hosted, "--conversations-url", unused);
  });
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  /** The state once `ready` holds of it (the reads run in the background after the server starts). */
  async function until(at: string, ready: (st: any) => boolean): Promise<any> {
    const deadline = Date.now() + POLL_LIMIT_MS;
    for (;;) {
      const st = await (await fetch(`${at}/api/state`)).json() as any;
      if (ready(st) || Date.now() > deadline) return st;
      await sleep(POLL_EVERY_MS);
    }
  }

  it("reads the runs pushed to the repository's origin/main", async () => {
    const st = await until(withOrigin, (x) => x.rows.length > 0);
    expect(st.rows.map((r: any) => [r.runId, r.host])).toEqual([["r1", "hostA"]]);
    expect(st.branch).toBe("main");
    expect(scopeOf(st, "r1")).toBe(2); // the two story files of the suite at the tag, in the --private repository
    expect(st.updatedAt).toBe(0); // dbench could not be read, so the page is not told the data is fresh
  });

  it("a repository with no origin has no web link and no rows, and the page is told it is not updating", async () => {
    const st = await until(withoutOrigin, (x) => !x.updating);
    expect(st.web).toBeNull();
    expect(st.rows).toEqual([]);
    expect(st.updating).toBe(false); // neither the fetch nor dbench worked
  });

  it("the repository's origin on GitHub is the page's link to it, even when it cannot be fetched", async () => {
    const st = await until(withWeb, (x) => !x.updating);
    expect(st.web).toBe("https://github.com/example/repo");
    expect(st.rows).toEqual([]);
  });

  it("the warehouse not answering is no conversations, not a failure", async () => {
    expect(await (await fetch(`${withOrigin}/api/conversations`)).json()).toEqual({ ids: [], complete: [] });
  });
});
