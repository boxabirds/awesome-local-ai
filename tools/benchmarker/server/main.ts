// benchmarker server: keeps the live state fresh in the background and serves the built React page.
//
//   node server/main.ts [--repo PATH] [--port 7760] [--judge-url URL]
//   node server/main.ts --port 7769 --fixture e2e/fixture.json      (tests: fixed data, no git, no dbench)
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { State } from "../shared/types.ts";
import { buildRows, machines, webBase, type DbenchJob, type RunRecord } from "./domain.ts";
import { BRANCH, git, loadFlowCounts, loadJobs, loadRuns } from "./sources.ts";

const HERE = import.meta.dirname;
const DIST = resolve(HERE, "../dist");
const DEFAULT_PORT = 7760; // clear of the gallery (7800-7999) and the benchmark (8787, 18010-19811)
const FETCH_EVERY_MS = 60_000;
const DBENCH_EVERY_MS = 10_000;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain",
};

const { values: args } = parseArgs({
  options: {
    repo: { type: "string", default: resolve(HERE, "../../..") },
    port: { type: "string", default: String(DEFAULT_PORT) },
    "judge-url": { type: "string", default: "http://127.0.0.1:7800/review" },
    // The private held-out suite, for the number of flows in each suite version (default: next to the repo).
    private: { type: "string" },
    fixture: { type: "string" },
  },
});

interface Sources {
  records: RunRecord[];
  suites: Record<string, string>;
  jobs: Record<string, DbenchJob[]>;
  fetchedAt: number;
  fetchError: string;
  dbenchAt: number;
  dbenchError: string;
  web: string | null;
  flowCounts: Record<string, Record<string, number>>;
}

const src: Sources = { records: [], suites: {}, jobs: {}, fetchedAt: 0, fetchError: "", dbenchAt: 0, dbenchError: "", web: null, flowCounts: {} };
const now = () => Date.now() / 1000;
const message = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/** The build id the page was compiled with; the page reloads itself when it differs from its own. */
function buildId(): string {
  const f = join(DIST, "build-id.txt");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : "dev";
}

async function refreshRepo(repo: string, privateRepo: string) {
  try {
    const { records, suites } = await loadRuns(repo);
    const versions = [
      ...records.map((r) => ({ pack: r.pack, version: r.packVersion })),
      ...Object.entries(suites).map(([pack, version]) => ({ pack, version })),
    ];
    const flowCounts = await loadFlowCounts(privateRepo, versions);
    Object.assign(src, { records, suites, flowCounts, fetchError: "", fetchedAt: now() });
  } catch (e) {
    src.fetchError = message(e);
  }
}

async function refreshDbench() {
  try {
    Object.assign(src, { jobs: await loadJobs(), dbenchError: "", dbenchAt: now() });
  } catch (e) {
    src.dbenchError = message(e);
  }
}

function every(ms: number, fn: () => Promise<void>) {
  const tick = async () => {
    await fn();
    setTimeout(tick, ms);
  };
  void tick();
}

function state(): State {
  const t = now();
  const rows = buildRows(src.records, src.jobs, src.suites, t, src.flowCounts);
  return {
    buildId: buildId(), now: t, fetchedAt: src.fetchedAt, fetchError: src.fetchError,
    dbenchAt: src.dbenchAt, dbenchError: src.dbenchError, suites: src.suites, web: src.web,
    judgeUrl: args["judge-url"]!, branch: BRANCH, rows, machines: machines(Object.keys(src.jobs), rows),
  };
}

if (args.fixture) {
  // Fixed inputs for tests: run records, dbench jobs and suites, timestamps made current.
  const f = JSON.parse(readFileSync(resolve(args.fixture), "utf8"));
  // A job with no updated_at was just updated, so it counts as recent however old the fixture is.
  for (const jobs of Object.values(f.jobs as Record<string, DbenchJob[]>)) for (const j of jobs) j.updated_at ??= now();
  Object.assign(src, { records: f.records, suites: f.suites, jobs: f.jobs, web: f.web ?? null, flowCounts: f.flowCounts ?? {}, fetchedAt: now(), dbenchAt: now() });
} else {
  const repo = resolve(args.repo!);
  src.web = webBase(await git(repo, "remote", "get-url", "origin").catch(() => ""));
  const privateRepo = resolve(args.private ?? join(repo, "../awesome-local-ai-bench-private"));
  every(FETCH_EVERY_MS, () => refreshRepo(repo, privateRepo));
  every(DBENCH_EVERY_MS, refreshDbench);
}

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(state()));
    return;
  }
  const file = normalize(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  const hashed = path.startsWith("/assets/"); // Vite names assets by content hash: cache them for good
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-store",
  });
  res.end(readFileSync(file));
}).listen(Number(args.port), "127.0.0.1", () => {
  console.log(`benchmarker: http://127.0.0.1:${args.port}  (build ${buildId()}${args.fixture ? ", fixture" : `, repo ${args.repo}`})`);
});
