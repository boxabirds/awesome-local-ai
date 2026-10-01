// Reading the two sources: the repo's fetched origin/main (git) and dbench.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Intervention, Score } from "../shared/types.ts";
import { countTests, finalScore, findRuns, normaliseByStory, parseFinalize, parseInterventions, parseInvalid, rescoreFault, type Invalid, type RawFinalize, type RawRescore, type RawUsage, storyEntry, type DbenchJob, type Rescored, type RunRecord } from "./domain.ts";

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

const STORY_DIR_DIGITS = 2;
// A re-scored story's counts: the public summary beside its result (the harness writes it since 30 Sep 2026,
// and the result itself is private), else the full result in records from before.
const RESCORE_STORY_FILES = ["accept-summary.json", "accept.json"];

/** Where a re-scored story's counts may be, in the order they are tried. */
export const rescoreStoryPaths = (dir: string, version: string, id: string) =>
  RESCORE_STORY_FILES.map((f) => `${dir}/rescore/${version}/stories/${id.padStart(STORY_DIR_DIGITS, "0")}/${f}`);

type RawRescoredStory = { by_story?: Record<string, { passed?: number; total?: number }> };

/** A re-scored story's counts from the blobs read: the first of its files that parses. */
export function rescoredStory(blobs: Map<string, string>, dir: string, version: string, id: string): RawRescoredStory | null {
  for (const p of rescoreStoryPaths(dir, version, id)) {
    const doc = json<RawRescoredStory>(blobs.get(p));
    if (doc) return doc;
  }
  return null;
}

function json<T>(text: string | undefined): T | null {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/** The files a run's notes are read from: its run.json (the client, the "invalid" mark) and interventions.md. */
export const runNotePaths = (dir: string) => [`${dir}/run.json`, `${dir}/interventions.md`];

/** What the record says about the run itself: the client that ran it, whether it is invalid, and what was done to
 * it by hand. */
export function runNotes(blobs: Map<string, string>, dir: string): { client: string; invalid: Invalid | null; interventions: Intervention[] } {
  const [meta, notes] = runNotePaths(dir);
  const run = json<{ client?: unknown; invalid?: unknown }>(blobs.get(meta));
  return {
    client: typeof run?.client === "string" ? run.client : "",
    invalid: parseInvalid(run?.invalid),
    interventions: parseInterventions(blobs.get(notes)),
  };
}

/** Where a run's final re-score is recorded (finalize.py). */
export const finalizePath = (dir: string) => `${dir}/finalize.json`;

/** What the run's final re-score recorded, whole; null when the record has none or it doesn't parse. */
export const runFinalize = (blobs: Map<string, string>, dir: string): RawFinalize | null => parseFinalize(json<unknown>(blobs.get(finalizePath(dir))));

type RawStory = { title?: string; status?: string; accept?: { passed?: number; total?: number } | null; harness_faults?: unknown[]; skipped_output?: unknown; record?: { credentials_redacted?: unknown } | null; not_comparable?: unknown } & RawUsage;

/** Every pushed run record, and each pack's current version (bench.json pack_ref). */
export async function loadRuns(repo: string): Promise<{ records: RunRecord[]; suites: Record<string, string> }> {
  await git(repo, "fetch", "-q", "origin", BRANCH);
  const paths = (await git(repo, "ls-tree", "-r", "--name-only", REF, "--", ...RUN_ROOTS)).split("\n").filter(Boolean);
  const runs = findRuns(paths);
  const packs = [...new Set(runs.map((r) => r.pack))].sort();
  const wanted = runs.flatMap((r) => [
    ...runNotePaths(r.dir), `${r.dir}/run-status.json`, `${r.dir}/metrics.json`, finalizePath(r.dir),
    ...r.rescores.map((v) => `${r.dir}/rescore/${v}/rescore.json`),
    ...Object.entries(r.rescoreLast).flatMap(([v, id]) => rescoreStoryPaths(r.dir, v, id)),
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
    const rescoreFaults: Record<string, string> = {};
    const lastStory = pairs.at(-1)?.[0];
    for (const v of r.rescores) {
      const rs = json<RawRescore>(blobs.get(`${r.dir}/rescore/${v}/rescore.json`));
      const score = finalScore(rs, status.state ?? "", lastStory);
      if (score) scores[v] = score;
      const fault = rescoreFault(rs);
      if (fault) rescoreFaults[v] = fault;
    }
    const rescored: Record<string, Rescored> = {};
    for (const [v, id] of Object.entries(r.rescoreLast)) {
      const acc = rescoredStory(blobs, r.dir, v, id);
      if (acc?.by_story) rescored[v] = { after: id, byStory: normaliseByStory(acc.by_story) };
    }
    return { ...r, rescored, rescoreFaults, host: meta.host ?? "", packVersion: meta.pack_version ?? "", state: status.state ?? "", stateAt: status.at ?? "",
      stories: pairs.map(([id, s]) => storyEntry(id, s)), scores, ...runNotes(blobs, r.dir), finalize: runFinalize(blobs, r.dir) };
  });
  return { records, suites };
}

/** `dbench status --json`: jobs per node. */
export async function loadJobs(): Promise<Record<string, DbenchJob[]>> {
  const { stdout } = await run("dbench", ["status", "--json"], { timeout: DBENCH_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const data = JSON.parse(stdout) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v))) as Record<string, DbenchJob[]>;
}

// ---------- flow counts from the private held-out suite ----------

const STORY_FILE = /story-(\d+)\.spec\.ts$/;
const flowCache = new Map<string, Record<string, number>>(); // "<pack>@<tag>": a tag's files never change

/** Tests per story in the private suite at a version tag: {"1": 10, "2": 10, ...}; null if the tag isn't there. */
async function flowCountsAt(privateRepo: string, pack: string, tag: string): Promise<Record<string, number> | null> {
  const key = `${pack}@${tag}`;
  const cached = flowCache.get(key);
  if (cached) return cached;
  const dir = `packs/${pack}/acceptance/tests`;
  const files = (await git(privateRepo, "ls-tree", "-r", "--name-only", tag, "--", dir).catch(() => ""))
    .split("\n").filter((f) => STORY_FILE.test(f));
  if (!files.length) return null;
  const counts: Record<string, number> = {};
  for (const f of files) counts[String(Number(STORY_FILE.exec(f)![1]))] = countTests(await git(privateRepo, "show", `${tag}:${f}`));
  flowCache.set(key, counts);
  return counts;
}

/** Flow counts for every suite version the runs use, keyed by version. Unknown versions are left out. */
export async function loadFlowCounts(privateRepo: string, versions: { pack: string; version: string }[]) {
  await git(privateRepo, "fetch", "-q", "--tags").catch(() => ""); // offline: use the tags already here
  const out: Record<string, Record<string, number>> = {};
  for (const { pack, version } of versions) {
    if (!version || out[version]) continue;
    const counts = await flowCountsAt(privateRepo, pack, version);
    if (counts) out[version] = counts;
  }
  return out;
}
