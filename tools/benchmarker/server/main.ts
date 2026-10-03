// benchmarker server: keeps the live state fresh in the background and serves the built React page.
//
//   node server/main.ts [--repo PATH] [--port 7760] [--judge-url URL]
//   node server/main.ts --port 7769 --fixture e2e/fixture.json      (tests: fixed data, no git, no dbench)
//
// GET /api/state is what the page shows; GET /api/faults is what it never shows: every internal-fault condition the
// server knows of (server/faults.ts), for the monitor.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { State } from "../shared/types.ts";
import { storyRunId } from "../shared/conversation.ts";
import { buildFullRows, machines, publicRow, webBase, type DbenchJob, type RunRecord } from "./domain.ts";
import { fixtureStore, proxyStore, type ConversationStore } from "./conversations.ts";
import { findFaults, type Fault } from "./faults.ts";
import { BRANCH, git, loadFlowCounts, loadJobs, loadRuns } from "./sources.ts";
import { fakeOps, realOps, type Ops } from "./ops.ts";

const HERE = import.meta.dirname;
const DEFAULT_PORT = 7760; // clear of the gallery (7800-7999) and the benchmark (8787, 18010-19811)
const FETCH_EVERY_MS = 60_000;
const DBENCH_EVERY_MS = 10_000;
/** How often the warehouse is asked which story runs have a conversation. */
const CONVERSATIONS_EVERY_MS = 10_000;
const DEFAULT_CONVERSATIONS_URL = "http://127.0.0.1:7761";
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
    // dbench's conversation API (`dbench collect --api`), proxied as /api/conversations/….
    "conversations-url": { type: "string", default: DEFAULT_CONVERSATIONS_URL },
    // The built page to serve. The live page serves dist/ (a release); tests and work in progress use dist-test/.
    dist: { type: "string", default: resolve(HERE, "../dist") },
  },
});
const DIST = resolve(args.dist!);

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
  /** Which story runs the warehouse has a conversation for; null when it couldn't be asked. */
  conversations: { ids: Set<string>; complete: Set<string> } | null;
}

const src: Sources = { records: [], suites: {}, jobs: {}, fetchedAt: 0, fetchError: "", dbenchAt: 0, dbenchError: "", web: null, flowCounts: {}, conversations: null };
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

let conversations: ConversationStore;
async function refreshConversations() {
  const a = await conversations.available();
  src.conversations = a ? { ids: new Set(a.ids), complete: new Set(a.complete) } : null;
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
  const full = buildFullRows(src.records, src.jobs, src.suites, t, src.flowCounts);
  return {
    buildId: buildId(), now: t,
    // The page says only how fresh its data is: the older of the two sources' reads, and whether the last reads worked.
    updatedAt: Math.min(src.fetchedAt, src.dbenchAt), updating: !src.fetchError && !src.dbenchError,
    suites: src.suites, web: src.web, judgeUrl: args["judge-url"]!, branch: BRANCH,
    rows: full.filter((f) => !f.record.invalid).map(publicRow).map(withConversations), machines: machines(Object.keys(src.jobs), full),
  };
}

/** Each story with its id in the warehouse and whether its conversation is there. */
function withConversations(row: State["rows"][number]): State["rows"][number] {
  return {
    ...row,
    stories: row.stories.map((s) => {
      const id = row.dir ? storyRunId(row.dir, s.id) : null;
      return { ...s, storyRunId: id, hasConversation: id !== null && (src.conversations?.ids.has(id) ?? false) };
    }),
  };
}

/** When each fault was first listed by this server, by id: a monitor can tell a new one from one it has logged. */
const firstSeen = new Map<string, string>();

async function faults(): Promise<{ generatedAt: string; faults: Fault[] }> {
  const t = now();
  const full = buildFullRows(src.records, src.jobs, src.suites, t, src.flowCounts);
  const reach = await ops.machines().then((ms) => ms.map((m) => ({ name: m.name, url: m.url, ok: m.ok, error: m.error })), () => null);
  const generatedAt = new Date(t * 1000).toISOString();
  const found = findFaults({ rows: full, machines: machines(Object.keys(src.jobs), full), reach, now: t, fetchError: src.fetchError, dbenchError: src.dbenchError, conversations: src.conversations });
  for (const f of found) if (!firstSeen.has(f.id)) firstSeen.set(f.id, generatedAt);
  return { generatedAt, faults: found.map((f) => ({ ...f, firstSeenAt: firstSeen.get(f.id) })) };
}

let ops: Ops;
/** Fixture mode: load the fixed inputs afresh (each test starts from them, whatever the last one queued or stopped). */
function loadFixture() {
  const f = JSON.parse(readFileSync(resolve(args.fixture!), "utf8"));
  // A job with no updated_at was just updated, so it counts as recent however old the fixture is.
  for (const jobs of Object.values(f.jobs as Record<string, DbenchJob[]>)) for (const j of jobs) j.updated_at ??= now();
  Object.assign(src, { records: f.records, suites: f.suites, jobs: f.jobs, web: f.web ?? null, flowCounts: f.flowCounts ?? {}, fetchedAt: now(), dbenchAt: now() });
  ops = fakeOps(src.jobs, f.machines ?? {});
  conversations = fixtureStore(f.conversations ?? {});
}
if (args.fixture) {
  loadFixture();
  await refreshConversations();
} else {
  conversations = proxyStore(args["conversations-url"]!);
  every(CONVERSATIONS_EVERY_MS, refreshConversations);
  const repo = resolve(args.repo!);
  src.web = webBase(await git(repo, "remote", "get-url", "origin").catch(() => ""));
  const privateRepo = resolve(args.private ?? join(repo, "../awesome-local-ai-bench-private"));
  every(FETCH_EVERY_MS, () => refreshRepo(repo, privateRepo));
  every(DBENCH_EVERY_MS, refreshDbench);
  ops = realOps();
}

/** /api/conversations/…: the warehouse's conversation API, passed through. A conversation that isn't available is
 * 404 {} (and a store that can't be reached gives the same), never a reason. Returns false for other paths. */
async function conversationsApi(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/api/conversations") || req.method !== "GET") return false;
  const send = (code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  const orNotFound = (v: unknown) => (v === null ? send(404, {}) : send(200, v));
  let m: RegExpExecArray | null;
  if (path === "/api/conversations") return orNotFound((await conversations.available()) ?? { ids: [], complete: [] }), true;
  if ((m = /^\/api\/conversations\/([^/]+)$/.exec(path))) return orNotFound(await conversations.conversation(decodeURIComponent(m[1]))), true;
  if ((m = /^\/api\/conversations\/([^/]+)\/events$/.exec(path))) {
    const q = url.searchParams;
    const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
    const str = (k: string) => (q.has(k) ? q.get(k)! : undefined);
    const v = await conversations.events(decodeURIComponent(m[1]), { fromMs: num("fromMs"), toMs: num("toMs"), cursor: str("cursor"), after: str("after"), limit: num("limit") });
    if (v && "error" in v && !("events" in v)) return send(400, v), true;
    return orNotFound(v), true;
  }
  if ((m = /^\/api\/conversations\/([^/]+)\/calls\/(\d+)$/.exec(path))) return orNotFound(await conversations.call(decodeURIComponent(m[1]), Number(m[2]))), true;
  if ((m = /^\/api\/conversations\/([^/]+)\/tools\/(\d+)$/.exec(path))) return orNotFound(await conversations.tool(decodeURIComponent(m[1]), Number(m[2]))), true;
  send(404, {});
  return true;
}

/** Changing requests come from the page only: its header, and its own origin when the browser sends one.
 * A page on another site can't set the header, so it can't queue or stop jobs through this server. */
function fromPage(req: import("node:http").IncomingMessage): boolean {
  const origin = req.headers.origin;
  return req.headers["x-benchmarker"] === "1" && (!origin || origin === `http://127.0.0.1:${args.port}` || origin === `http://localhost:${args.port}`);
}

async function body(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

/** The Machines tab's API. Returns false when the path isn't one of its routes. */
async function machinesApi(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, path: string): Promise<boolean> {
  const send = (code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  const changes = req.method !== "GET";
  if (!path.startsWith("/api/machines") && !path.startsWith("/api/jobs")) return false;
  if (changes && !fromPage(req)) { send(403, { ok: false, message: "only the benchmarker page can change machines and jobs" }); return true; }
  const refresh = async () => { if (!args.fixture) await refreshDbench(); };
  let m: RegExpExecArray | null;
  if (path === "/api/machines" && req.method === "GET") return send(200, await ops.machines()), true;
  if (path === "/api/machines" && req.method === "POST") {
    const b = await body(req);
    const r = await ops.add({ name: String(b.name ?? ""), url: b.url ? String(b.url) : undefined, token: b.token ? String(b.token) : undefined });
    if (r.ok) await refresh();
    return send(r.ok ? 200 : 400, r), true;
  }
  if ((m = /^\/api\/machines\/([^/]+)$/.exec(path)) && req.method === "DELETE") return send(200, await ops.remove(decodeURIComponent(m[1]))), true;
  if (path === "/api/jobs" && req.method === "POST") {
    const b = await body(req);
    const r = await ops.submit({
      node: String(b.node ?? ""), installId: String(b.installId ?? ""), pack: String(b.pack ?? ""), runId: String(b.runId ?? ""),
      scope: b.scope ? String(b.scope) : undefined, client: String(b.client ?? "pi"), repeat: Number(b.repeat) || 1, id: b.id ? String(b.id) : undefined,
    });
    await refresh();
    return send(r.ok ? 200 : 400, r), true;
  }
  if ((m = /^\/api\/jobs\/([^/]+)\/([^/]+)\/(cancel|restart)$/.exec(path)) && req.method === "POST") {
    const [node, id] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
    const r = m[3] === "cancel" ? await ops.cancel(node, id) : await ops.restart(node, id);
    await refresh();
    return send(r.ok ? 200 : 400, r), true;
  }
  send(404, { ok: false, message: "no such route" });
  return true;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  if (args.fixture && path === "/api/test/reset" && req.method === "POST") {
    // The reset can also append events to a fixture conversation ({"appendEvents": {"<id>": [events]}}), so a test can
    // watch the page pick up what arrives after its latest cursor.
    const b = await body(req);
    loadFixture();
    const store = conversations as ReturnType<typeof fixtureStore>;
    for (const [id, evs] of Object.entries((b.appendEvents as Record<string, Parameters<typeof store.append>[1]>) ?? {})) store.append(id, evs);
    await refreshConversations();
    res.writeHead(204).end();
    return;
  }
  if (await machinesApi(req, res, path)) return;
  if (await conversationsApi(req, res, url)) return;
  if (path === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(state()));
    return;
  }
  if (path === "/api/faults") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(await faults()));
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
