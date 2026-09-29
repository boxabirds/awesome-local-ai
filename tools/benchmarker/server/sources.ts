// Reading the two sources: the repo's fetched origin/main (git) and dbench.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Score } from "../shared/types.ts";
import { findRuns, storyEntry, type DbenchJob, type RunRecord } from "./domain.ts";

const run = promisify(execFile);
export const REF = "origin/main";
export const BRANCH = "main";
const RUN_ROOTS = ["combinations", "benchmarks/reference"];
const GIT_TIMEOUT_MS = 120_000;
const DBENCH_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 256 * 1024 * 1024;

export async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** Many files from origin/main in one `git cat-file --batch`. */
export function readBlobs(repo: string, paths: string[]): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, string>();
    if (!paths.length) return resolve(out);
    const p = spawn("git", ["-C", repo, "cat-file", "--batch"]);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", reject);
    p.on("close", () => {
      const data = Buffer.concat(chunks);
      let pos = 0;
      for (const path of paths) {
        const nl = data.indexOf(10, pos);
        if (nl < 0) break;
        const header = data.subarray(pos, nl).toString();
        pos = nl + 1;
        if (header.endsWith("missing")) continue;
        const size = Number(header.split(" ").at(-1));
        out.set(path, data.subarray(pos, pos + size).toString("utf8"));
        pos += size + 1;
      }
      resolve(out);
    });
    p.stdin.end(paths.map((x) => `${REF}:${x}\n`).join(""));
  });
}

function json<T>(text: string | undefined): T | null {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

interface RawStory { title?: string; status?: string; accept?: { passed?: number; total?: number } | null }
interface RawRescore { finished_at?: string; results?: { passed?: number; total?: number; flaky?: number }[] }

/** Every pushed run record, and each pack's current version (bench.json pack_ref). */
export async function loadRuns(repo: string): Promise<{ records: RunRecord[]; suites: Record<string, string> }> {
  await git(repo, "fetch", "-q", "origin", BRANCH);
  const paths = (await git(repo, "ls-tree", "-r", "--name-only", REF, "--", ...RUN_ROOTS)).split("\n").filter(Boolean);
  const runs = findRuns(paths);
  const packs = [...new Set(runs.map((r) => r.pack))].sort();
  const wanted = runs.flatMap((r) => [
    `${r.dir}/run.json`, `${r.dir}/run-status.json`, `${r.dir}/metrics.json`,
    ...r.rescores.map((v) => `${r.dir}/rescore/${v}/rescore.json`),
  ]).concat(packs.map((p) => `benchmarks/${p}/bench.json`));
  const blobs = await readBlobs(repo, wanted);
  const suites = Object.fromEntries(packs.map((p) => [p, json<{ pack_ref?: string }>(blobs.get(`benchmarks/${p}/bench.json`))?.pack_ref ?? ""]));
  const records = runs.map((r): RunRecord => {
    const meta = json<{ pack_version?: string; host?: string }>(blobs.get(`${r.dir}/run.json`)) ?? {};
    const status = json<{ state?: string; at?: string }>(blobs.get(`${r.dir}/run-status.json`)) ?? {};
    const raw = json<{ stories?: Record<string, RawStory> | RawStory[] }>(blobs.get(`${r.dir}/metrics.json`))?.stories ?? {};
    // metrics.json keys stories by id ("1", "2", …); older records list them in order
    const pairs: [string, RawStory][] = Array.isArray(raw)
      ? raw.map((s, i) => [String(i + 1), s])
      : Object.entries(raw).toSorted((a, b) => Number(a[0]) - Number(b[0]));
    const scores: Record<string, Score> = {};
    for (const v of r.rescores) {
      const rs = json<RawRescore>(blobs.get(`${r.dir}/rescore/${v}/rescore.json`));
      const last = rs?.results?.at(-1);
      if (last) scores[v] = { passed: last.passed ?? null, total: last.total ?? null,
        flaky: (rs!.results ?? []).reduce((n, x) => n + (x.flaky ?? 0), 0), at: rs!.finished_at ?? "" };
    }
    return { ...r, host: meta.host ?? "", packVersion: meta.pack_version ?? "", state: status.state ?? "", stateAt: status.at ?? "",
      stories: pairs.map(([id, s]) => storyEntry(id, s)), scores };
  });
  return { records, suites };
}

/** `dbench status --json`: jobs per node. */
export async function loadJobs(): Promise<Record<string, DbenchJob[]>> {
  const { stdout } = await run("dbench", ["status", "--json"], { timeout: DBENCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const data = JSON.parse(stdout) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v))) as Record<string, DbenchJob[]>;
}
