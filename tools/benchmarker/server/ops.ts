// What the Machines tab can do: list and add machines, and queue, stop, restart and read jobs. The real
// ones go through the dbench command line (which holds the tokens and checks every name) and the node's
// own API; tests use a fake over the fixture's jobs, so they never touch a real machine.
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { DbenchJob } from "./domain.ts";
import { addMachine, NAME, parseNodes, renderNodes, restartId, type AddResult, type Node } from "./machines.ts";

const run = promisify(execFile);
const CONFIG = join(homedir(), ".config/dbench/nodes.toml");
const TIMEOUT_MS = 60_000;
const SSH_TIMEOUT_S = 8;
const PROBE_MS = 8_000;
const PRIVATE = 0o600;
const TOKEN = /^[A-Za-z0-9_-]{16,}$/;

export interface Machine {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  /** dbench's GET /v1/node: hostname, os, cpus, gpus, installed combinations, current job, versions. */
  node?: Record<string, unknown>;
}

export interface SubmitReq {
  node: string; installId: string; pack: string; runId: string; scope?: string; client: string; repeat?: number; id?: string;
}

export interface Result { ok: boolean; message: string; ids?: string[] }

export interface Ops {
  machines(): Promise<Machine[]>;
  add(req: { name: string; url?: string; token?: string }): Promise<AddResult>;
  remove(name: string): Promise<Result>;
  submit(req: SubmitReq): Promise<Result>;
  cancel(node: string, id: string): Promise<Result>;
  restart(node: string, id: string): Promise<Result>;
  log(node: string, id: string): Promise<string>;
}

const why = (e: unknown) => {
  const x = e as { stderr?: string; message?: string };
  return (x.stderr || x.message || String(e)).trim().split("\n").slice(-3).join(" ");
};

/** The id a new job gets: the pack's name, the install and the run id. */
export const jobId = (req: SubmitReq) => req.id?.trim() || `${req.pack.split("/").at(-1)}-${req.installId}-${req.runId}`;

function checkSubmit(req: SubmitReq): string | null {
  for (const [k, v] of [["machine", req.node], ["install", req.installId], ["run id", req.runId], ["client", req.client], ["id", jobId(req)]] as const) {
    if (!v || !NAME.test(v)) return `${k} "${v ?? ""}" isn't valid: letters, digits, dot, dash and underscore only`;
  }
  if (req.scope && !NAME.test(req.scope)) return `scope "${req.scope}" isn't valid`;
  if (!/^[A-Za-z0-9._/-]+$/.test(req.pack)) return `pack "${req.pack}" isn't valid`;
  return null;
}

async function readNodes(): Promise<Record<string, Node>> {
  try { return parseNodes(await readFile(CONFIG, "utf8")); } catch { return {}; }
}
async function writeNodes(nodes: Record<string, Node>) {
  await mkdir(dirname(CONFIG), { recursive: true });
  await writeFile(CONFIG, renderNodes(nodes), { mode: PRIVATE });
  await chmod(CONFIG, PRIVATE);  // a file that existed keeps its mode through writeFile
}

const dbench = async (...args: string[]) => (await run("dbench", args, { timeout: TIMEOUT_MS })).stdout;

export function realOps(): Ops {
  const submitArgs = (req: SubmitReq, id: string, record = true) => [
    "submit", req.node, "--id", id, "--install-id", req.installId, "--pack", req.pack, "--run-id", req.runId,
    "--client", req.client, ...(req.scope ? ["--scope", req.scope] : []),
    ...(req.repeat && req.repeat > 1 ? ["--repeat", String(req.repeat)] : []), ...(record ? [] : ["--no-record"]),
  ];
  return {
    async machines() {
      const nodes = await readNodes();
      let status: Record<string, { node?: Record<string, unknown>; status?: string; error?: string; url?: string }> = {};
      try { status = JSON.parse(await dbench("nodes", "--json")); } catch { /* every node shown as unreachable below */ }
      return Object.entries(nodes).map(([name, n]) => {
        const s = status[name];
        return s?.node ? { name, url: n.url, ok: true, node: s.node } : { name, url: n.url, ok: false, error: s?.error || s?.status || "no answer" };
      });
    },
    add: (req) => addMachine(req, {
      async sshReadToken(host) {
        // Some SSH servers exit 0 on failure, so the token's own shape is the check.
        const { stdout } = await run("ssh", ["-o", "BatchMode=yes", "-o", `ConnectTimeout=${SSH_TIMEOUT_S}`, host, "cat ~/.dbench/token"], { timeout: TIMEOUT_MS });
        const token = stdout.trim();
        if (!TOKEN.test(token)) throw new Error("no token in ~/.dbench/token");
        return token;
      },
      async probe(url, token) {
        const r = await fetch(`${url}/v1/node`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(PROBE_MS) });
        if (!r.ok) throw new Error(r.status === 401 ? "the token was refused" : `HTTP ${r.status}`);
        return r.json();
      },
      async save(name, node) { await writeNodes({ ...(await readNodes()), [name]: node }); },
    }),
    async remove(name) {
      const nodes = await readNodes();
      if (!nodes[name]) return { ok: false, message: `${name} isn't in the list` };
      delete nodes[name];
      await writeNodes(nodes);
      return { ok: true, message: `${name} removed from the list (its dbench service keeps running)` };
    },
    async submit(req) {
      const bad = checkSubmit(req);
      if (bad) return { ok: false, message: bad };
      try {
        const out = await dbench(...submitArgs(req, jobId(req)));
        return { ok: true, message: out.trim(), ids: [...out.matchAll(/job (\S+) (?:queued|exists)/g)].map((m) => m[1]) };
      } catch (e) { return { ok: false, message: why(e) }; }
    },
    async cancel(node, id) {
      if (!NAME.test(node) || !NAME.test(id)) return { ok: false, message: "invalid machine or job" };
      try { return { ok: true, message: (await dbench("cancel", node, id)).trim() }; } catch (e) { return { ok: false, message: why(e) }; }
    },
    async restart(node, id) {
      if (!NAME.test(node) || !NAME.test(id)) return { ok: false, message: "invalid machine or job" };
      try {
        const jobs = (JSON.parse(await dbench("status", "--json")) as Record<string, DbenchJob[]>)[node] ?? [];
        const job = jobs.find((j) => j.id === id);
        if (!job) return { ok: false, message: `no job ${id} on ${node}` };
        const s = job.spec as DbenchJob["spec"] & { scope?: string; client?: string; record?: boolean };
        const again = restartId(id, jobs.map((j) => j.id));
        const req: SubmitReq = { node, installId: s.install_id ?? "", pack: s.pack ?? "", runId: s.run_id ?? "", scope: s.scope, client: s.client ?? "pi", id: again };
        const bad = checkSubmit(req);
        if (bad) return { ok: false, message: bad };
        await dbench(...submitArgs(req, again, s.record !== false));
        return { ok: true, message: `queued ${again}: run ${req.runId} resumes at its first unfinished story`, ids: [again] };
      } catch (e) { return { ok: false, message: why(e) }; }
    },
    async log(node, id) {
      if (!NAME.test(node) || !NAME.test(id)) return "invalid machine or job";
      try { return await dbench("logs", node, id); } catch (e) { return why(e); }
    },
  };
}

/** Fixture machines and jobs in memory: the jobs are the server's own, so what the fake does shows in Runs. */
export function fakeOps(jobs: Record<string, DbenchJob[]>, info: Record<string, Record<string, unknown>>): Ops {
  const nodes: Record<string, Node> = Object.fromEntries(Object.keys(jobs).map((n) => [n, { url: `http://${n}:7717`, token: "t" }]));
  const now = () => Math.floor(Date.now() / 1000);
  const find = (node: string, id: string) => (jobs[node] ?? []).find((j) => j.id === id);
  return {
    async machines() {
      return Object.entries(nodes).map(([name, n]) => ({ name, url: n.url, ok: name !== "down", node: info[name] ?? { hostname: name, combinations: [] } }));
    },
    add: (req) => addMachine(req, {
      async sshReadToken(host) { if (!host.startsWith("ssh")) throw new Error("ssh failed"); return "fake-token-from-ssh"; },
      async probe(url) { if (url.includes("down")) throw new Error("connection refused"); return { hostname: req.name }; },
      async save(name, node) { nodes[name] = node; jobs[name] ??= []; info[name] ??= { hostname: name, combinations: [] }; },
    }),
    async remove(name) { delete nodes[name]; delete jobs[name]; return { ok: true, message: `${name} removed` }; },
    async submit(req) {
      const bad = checkSubmit(req);
      if (bad) return { ok: false, message: bad };
      const n = req.repeat && req.repeat > 1 ? req.repeat : 1;
      const ids: string[] = [];
      for (let i = 1; i <= n; i++) {
        const id = n > 1 ? `${jobId(req)}-r${i}` : jobId(req), runId = n > 1 ? `${req.runId}-r${i}` : req.runId;
        (jobs[req.node] ??= []).push({ id, spec: { pack: req.pack, run_id: runId, install_id: req.installId }, progress: { combination: String((info[req.node]?.combinations as { combination: string; install_id: string }[] | undefined)?.find((c) => c.install_id === req.installId)?.combination ?? req.installId) }, state: { status: "queued" }, submitted_at: now(), updated_at: now() });
        ids.push(id);
      }
      return { ok: true, message: ids.map((id) => `${req.node}: job ${id} queued`).join("\n"), ids };
    },
    async cancel(node, id) {
      const j = find(node, id);
      if (!j) return { ok: false, message: "no such job" };
      j.state = { status: "cancelled" }; j.updated_at = now();
      return { ok: true, message: `${node}: job ${id} cancelled` };
    },
    async restart(node, id) {
      const j = find(node, id);
      if (!j) return { ok: false, message: "no such job" };
      const again = restartId(id, (jobs[node] ?? []).map((x) => x.id));
      jobs[node].push({ ...j, id: again, state: { status: "queued" }, submitted_at: now(), updated_at: now() });
      return { ok: true, message: `queued ${again}: run ${j.spec.run_id} resumes at its first unfinished story`, ids: [again] };
    },
    async log(node, id) { return `[dbench] ${node} ${id}: fixture log\nstory 3 running\n`; },
  };
}
