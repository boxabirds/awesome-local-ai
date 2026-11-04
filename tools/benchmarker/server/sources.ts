// Reading the two sources: the lake (through bench-lake) and dbench.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Intervention, Score } from "../shared/types.ts";
import { countTests, finalScore, findRuns, normaliseByStory, parseExpertCache, parseFinalize, parseInterventions, parseInvalid, parseSandbox, rescoreFault, type ExpertCache, type Invalid, type RawFinalize, type RawAccept, type RunSandbox, type RawRescore, type RawUsage, storyEntry, builtUnderEarlierSuite, acceptUnderScoringSuite, type DbenchJob, type Rescored, type RunRecord } from "./domain.ts";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const DBENCH_TIMEOUT_MS = 60_000;
const BENCH_LAKE_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 1024 * 1024 * 1024;
const BUNDLE_FILE = "workspace.bundle";

export async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** Where the runs are read from: the bench-lake command, the lake's state folder, and the host checkout (its archived
 * markers and each pack's bench.json). */
export interface LakeConfig { benchLake: string; state: string; checkout: string }

/** One run of bench-lake's `records` answer (tools/bench-lake/CANONICAL.md). */
interface LakeRun { id: string; files: Record<string, string>; bundle: boolean }

/** Every run's result documents, from bench-lake's `records` question, as checkout-relative paths: the file list
 * (with the bundle, when the lake has one) and each document's text. Runs the checkout marks archived are left out
 * by bench-lake. */
export async function lakeRecords(cfg: LakeConfig): Promise<{ paths: string[]; blobs: Map<string, string> }> {
  const { stdout } = await run(cfg.benchLake, [cfg.state, "records", "--archived", cfg.checkout], { timeout: BENCH_LAKE_TIMEOUT_MS, maxBuffer: MAX_BUFFER })
    .catch((e: { code?: unknown; stderr?: string; message?: string }) => {
      // bench-lake's own message (its standard error) says why; the first line of the error is only the command.
      throw new Error(`bench-lake ${cfg.benchLake} failed (${String(e.code ?? "")}): ${(e.stderr ?? "").trim() || e.message}`);
    });
  const runs = (JSON.parse(stdout) as { runs: LakeRun[] }).runs;
  const blobs = new Map<string, string>();
  const paths: string[] = [];
  for (const r of runs) {
    for (const [rel, text] of Object.entries(r.files)) {
      blobs.set(`${r.id}/${rel}`, text);
      paths.push(`${r.id}/${rel}`);
    }
    if (r.bundle) paths.push(`${r.id}/${BUNDLE_FILE}`);
  }
  return { paths, blobs };
}

/** A file of the checkout as text; undefined when it can't be read. */
const checkoutFile = (cfg: LakeConfig, rel: string) => readFile(join(cfg.checkout, rel), "utf8").catch(() => undefined);

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

/** The files a run's notes are read from: its run.json (the client, the "invalid" mark, what the engine settled on)
 * and interventions.md. */
export const runNotePaths = (dir: string) => [`${dir}/run.json`, `${dir}/interventions.md`];

/** What the record says about the run itself: the client that ran it, whether it is invalid, what its agent ran in, and
 * what was done to it by hand. */
export function runNotes(blobs: Map<string, string>, dir: string): { client: string; invalid: Invalid | null; sandbox: RunSandbox | null; expertCache: ExpertCache | null; interventions: Intervention[] } {
  const [meta, notes] = runNotePaths(dir);
  const run = json<{ client?: unknown; invalid?: unknown; sandbox?: unknown; engine_settings?: unknown }>(blobs.get(meta));
  return {
    client: typeof run?.client === "string" ? run.client : "",
    invalid: parseInvalid(run?.invalid),
    sandbox: parseSandbox(run?.sandbox),
    expertCache: parseExpertCache(run?.engine_settings),
    interventions: parseInterventions(blobs.get(notes)),
  };
}

/** Where a run's final re-score is recorded (finalize.py). */
export const finalizePath = (dir: string) => `${dir}/finalize.json`;

/** What the run's final re-score recorded, whole; null when the record has none or it doesn't parse. */
export const runFinalize = (blobs: Map<string, string>, dir: string): RawFinalize | null => parseFinalize(json<unknown>(blobs.get(finalizePath(dir))));

/** metrics.json's "known_good": present (an object naming the reference run) only for a partial rerun. */
export const isKnownGood = (metrics: { known_good?: unknown } | null): boolean =>
  typeof metrics?.known_good === "object" && metrics.known_good !== null;

type RawStory = { title?: string; status?: string; accept?: { passed?: number; total?: number } | null; harness_faults?: unknown[]; skipped_output?: unknown; record?: { credentials_redacted?: unknown } | null; not_comparable?: unknown; memory_start?: unknown; conditions?: { host?: unknown } | null } & RawUsage;

/** Every run record in the lake, each pack's current version (bench.json pack_ref, from the checkout), and every
 * result document read, by checkout-relative path (the app's record routes serve them). */
export async function loadRuns(cfg: LakeConfig): Promise<{ records: RunRecord[]; suites: Record<string, string>; documents: Map<string, string> }> {
  const { paths, blobs } = await lakeRecords(cfg);
  const runs = findRuns(paths);
  const packs = [...new Set(runs.map((r) => r.pack))].sort();
  const suiteOf = async (p: string) => json<{ pack_ref?: string }>(await checkoutFile(cfg, `benchmarks/${p}/bench.json`))?.pack_ref ?? "";
  // A run built under an earlier suite shows the per-story figures of its re-score under the suite its score of
  // record was made with: bench-lake gives every re-scored story's documents, so they are already read.
  const suites = Object.fromEntries(await Promise.all(packs.map(async (p) => [p, await suiteOf(p)])));
  const records = runs.map((r): RunRecord => {
    const meta = json<{ pack_version?: string; host?: string }>(blobs.get(`${r.dir}/run.json`)) ?? {};
    const status = json<{ state?: string; at?: string }>(blobs.get(`${r.dir}/run-status.json`)) ?? {};
    const metrics = json<{ stories?: Record<string, RawStory> | RawStory[]; known_good?: unknown }>(blobs.get(`${r.dir}/metrics.json`));
    const raw = metrics?.stories ?? {};
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
    const finalize = runFinalize(blobs, r.dir);
    const scoringSuite = builtUnderEarlierSuite(finalize);
    const rescored: Record<string, Rescored> = {};
    for (const [v, id] of Object.entries(r.rescoreLast)) {
      const acc = rescoredStory(blobs, r.dir, v, id);
      if (acc?.by_story) rescored[v] = { after: id, byStory: normaliseByStory(acc.by_story) };
    }
    return { ...r, rescored, rescoreFaults, host: meta.host ?? "", packVersion: meta.pack_version ?? "", state: status.state ?? "", stateAt: status.at ?? "",
      stories: pairs.map(([id, s]) => storyEntry(id, scoringSuite ? acceptUnderScoringSuite(s, json<RawAccept>(blobs.get(`${r.dir}/rescore/${scoringSuite}/stories/${id.padStart(2, "0")}/accept-summary.json`))) : s)),
      scores, ...runNotes(blobs, r.dir), finalize, knownGood: isKnownGood(metrics) };
  });
  return { records, suites, documents: blobs };
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
