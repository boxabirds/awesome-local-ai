# benchmarker

One page with the live status of every benchmark run: where each run is in **build → score → judge**,
with links to its record, its scores and the review page.

A React app (Vite, SWR) with a small Node server. Needs Node 24 or later, which runs the server's
TypeScript directly.

```bash
cd tools/benchmarker
npm install && npm run build
npm start                                    # then open http://127.0.0.1:7760
node server/main.ts --repo /path/to/awesome-local-ai --port 7760 --judge-url http://127.0.0.1:7800/review
```

Tests: `npm test` (the domain logic, Vitest) and `npm run test:e2e` (Playwright against fixed data in
`e2e/fixture.json`: running and queued rows, stories, the version filter, width at 1000 px, the stale
warning, reload on a new build).

Layout: `server/` reads git and dbench and serves `/api/state` plus the built page; `server/domain.ts`
turns records and jobs into rows (pure, unit-tested); `src/` is the page, one component per column;
`shared/types.ts` is the state both sides agree on.

## Where the data comes from

- **The repo's `origin/main`**, fetched every 60 seconds. The harness commits and pushes each run's
  record after every story, so the pushed branch is always the latest. The page reads the fetched commit
  directly (`git ls-tree`, `git cat-file`), so your working copy is never pulled, touched or blocked by
  local edits.
- **dbench** (`dbench status --json`), every 10 seconds, when `dbench` is on the PATH with a node list
  (`~/.config/dbench/nodes.toml`): queued and running jobs, the current story, and the last log line.
  Without dbench the page shows the repo only.

The page itself refreshes every 5 seconds and says when the repo and dbench were last read. A running story's live numbers (agent minutes, calls, tokens, tasks) come from the harness, which writes them about once a minute, so they move in steps. When the benchmarker is rebuilt, open tabs reload themselves (each build has an id; the page reloads when the server's differs). If it can't refresh for 20 seconds (the server stopped, or an error), it greys out under a red bar saying how old the data is, so old data never passes for current.

## One section per machine

Each dbench node has one section, headed by its hardware and what it is running now (model and engine,
run, story, agent minutes), or **idle**, and how many jobs wait. Inside it: the running run, then its
queue in dbench's order, then finished runs. A run is filed under its dbench node; a record with no
job (from before dbench, or aged out) goes under the node another run on the same host (run.json's
`host`) ran on, else under the host itself. Each run shows its model and engine above its run id.

## What each column means

| Column | From |
|---|---|
| Build | the dbench job (queued, running: story N, failed with its reason) or the record's `run-status.json`; for the running story, agent minutes, calls, output tokens, tasks written and the agent's latest action |
| Stories | one square per finished story, coloured by its live held-out result (all passed, some, none); the running story pulses |
| Live held-out | the latest story's held-out result as scored during the run (a progress signal; the score of record is the re-score) |
| Score | the run's re-scores (`rescore/<suite version>/`), each linking to its per-story table; otherwise what scoring is waiting for |
| Judge | **Judge →** once the run is finished, re-scored with the pack's current version and has its `workspace.bundle`; otherwise what it is waiting for |
| Links | the run's record and summary on GitHub |

Runs are filtered by pack and version family (`vidi-v2`, `vidi-v1`, …); results are
compared only within one family. Records written before runs recorded a version show as "unversioned".

**Scores appear only once they are pushed:** re-score results must be committed like the run records.
