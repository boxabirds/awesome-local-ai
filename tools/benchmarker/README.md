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

## Per-story detail

Click a run (its first cell) to open one line per recorded story: flows passing now (against the latest
build, like the squares), agent minutes, calls, output tokens, read tokens and the cached share, tok/s (output over
story time), the model-only decode and prefill tok/s where timed, and how many drafted tokens the model accepted.

## Filters

Pack and version at the top, and a toggle per status with its count: running, queued, finished,
failed, stopped, cancelled. Cancelled runs are hidden at first; **only running** and **all** are one
click. The choice is remembered in the browser. A machine with nothing under the filter is left out,
unless it is idle.

## What each column means

| Column | From |
|---|---|
| Run | model and engine, run id, spec version |
| Status | one word from the dbench job, else the run record; below it the place in the node's queue, a failure's reason, "finishing story N" while a story is scored, or when the run ended |
| Story | the running story out of the job's scope ("story 4 of 11") and its title (up to three lines); for other runs, how many stories were built |
| Time | running: agent minutes on this story and how long the run has gone; otherwise agent time over its stories |
| Activity | the running story's calls, output tokens and tasks, and the agent's latest action. Claude runs count calls and tokens only at the end of a story, so they show none mid-story rather than a false zero |
| Stories working | how many of the run's stories work against its latest build, out of every story in its scope ("4 of 11 working"), and one square per story: green all its hidden flows pass, amber some, red none, grey not built yet, pulsing blue being built. A story that worked and was broken by a later one turns red. From the latest story recorded with a per-story breakdown (accept.json `by_story`), or from the run's re-score under the pack's current suite when that reaches the same story or later (a re-score corrects live scores taken with an older suite); the scope is the job's story list, else every story in the private suite at the run's version (`--private`) |
| Tokens | output tokens over the run's recorded stories; under it everything the model **read** (fresh input plus cache reads and writes: clients split input differently, Claude Code reporting nearly all of it as cache reads, so only the total compares) and the number of calls. Every call re-reads the conversation, so read grows with calls |
| tok/s | output tokens over the time the run's recorded stories took (agent seconds: model, tools and all), for every run including the cloud reference. The per-story table also has the model-only decode and prefill rates where the harness timed the model (llama.cpp's log, or its metering proxy) |
| Score / N | the score of record as one number: hidden flows passing in the re-score (`rescore/<suite version>/`) of a finished run's last story, under the current suite (else the latest). The heading carries the total when every shown score has the same one; the tooltip gives the suite version and flaky count; the number links to the per-story table. A partial re-score (e.g. one story of a running run) only corrects the story squares |
| Judge | **Judge →** once the run is finished, re-scored with the pack's current version and has its `workspace.bundle` (the app's git history, one commit per story, which the review page rebuilds each story from; the harness doesn't write it yet, so it is made by hand); otherwise what it is waiting for |
| Links | the run's record and summary on GitHub |

Runs are filtered by pack and version family (`vidi-v2`, `vidi-v1`, …); results are
compared only within one family. Records written before runs recorded a version show as "unversioned".

**Scores appear only once they are pushed:** re-score results must be committed like the run records.
