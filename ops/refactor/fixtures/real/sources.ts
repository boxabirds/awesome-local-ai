// Unchanged excerpt of tools/benchmarker/server/sources.ts, pinned to commit f76e6a167. Refresh deliberately, with the pin.

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
  // A run built under an earlier suite shows the per-story figures of its re-score under the suite its score of record was made with.
  const rescoredStories = runs.flatMap((r) => {
    const suite = builtUnderEarlierSuite(runFinalize(blobs, r.dir));
    return suite ? paths.filter((p) => p.startsWith(`${r.dir}/rescore/${suite}/stories/`) && p.endsWith("/accept-summary.json")) : [];
  });
  if (rescoredStories.length) for (const [path, text] of await readBlobs(repo, rescoredStories)) blobs.set(path, text);
  const suites = Object.fromEntries(packs.map((p) => [p, json<{ pack_ref?: string }>(blobs.get(`benchmarks/${p}/bench.json`))?.pack_ref ?? ""]));
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
  return { records, suites };
}

/** `dbench status --json`: jobs per node. */
