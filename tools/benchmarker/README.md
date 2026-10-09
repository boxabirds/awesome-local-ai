# benchmarker

One page with the live status of every benchmark run: where each run is in **build → score → judge**,
with links to its record, its scores and the review page.

A React app (Vite, SWR) with a small Node server. Needs Node 24 or later, which runs the server's
TypeScript directly.

```bash
cd tools/benchmarker
bun install && bun run build
bun start                                    # then open http://127.0.0.1:7760
bun server/main.ts --repo /path/to/awesome-local-ai --port 7760 --judge-url http://127.0.0.1:7800/review
```

Tests: `bun run test` (the domain logic, Vitest) and `bun run test:e2e` (Playwright against fixed data in
`e2e/fixture.json`: running and queued rows, stories, the version filter, width at 1000 px, the stale
warning, reload on a new build).

Layout: `server/` reads git and dbench and serves `/api/state` plus the built page; `server/domain.ts`
turns records and jobs into rows (pure, unit-tested); `src/` is the page, one component per column;
`shared/types.ts` is the state both sides agree on.

## The faults feed: `GET /api/faults`

The page presents results and never shows the app's or the harness's own faults. Everything the server knows
of them goes to the monitor instead: `GET /api/faults` returns `{generatedAt, faults: [...]}`, one entry per
condition (`accounting_failed`, `not_scored`, `run_invalid`, `job_failed`, `machine_unreachable`, … the full
list is `FAULT_KINDS` in `server/faults.ts`), each with a stable `id`, the run or machine it is about, and the
raw recorded facts in `detail`. The UI never reads it; a run marked invalid is not in `/api/state` at all, and a
time split that failed its check is sent as none.

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

Click a run (its first cell) to open one line per recorded story: held-out tests passing on the latest
build (like the squares), agent minutes, calls, output tokens, read tokens and the cached share, tok/s (output over
story time), the model-only decode and prefill tok/s where timed, and how many drafted tokens the model accepted.

## Conversations

A story run's conversation, happening by happening, is a page of its own under the story run
(`#/<pack>/r/<stack>/<run>/s/<n>/conversation`), with one model call in full a step further (`…/conversation/c/<idx>`).
It comes from the warehouse (`conversations.db`, built by `dbench collect`; see tools/dbench/README.md), through
dbench's conversation API, which this server proxies as `/api/conversations/…` (`--conversations-url`, default
http://127.0.0.1:7761); the server never reads the database itself.

- **What the page shows:** the calls, tool calls, compactions, waits between sessions, messages, the model server's
  requests and the machine's readings, each a section with a count; a timeline of calls over the story's span, each
  tick a link to the call at that time; what the agent itself said, verbatim (`data-quoted="agent"`: a result the
  page presents, never its own words).
- **How it reads:** the API is one stream per story run with two forms over it. `?fromMs=&toMs=&cursor=&limit=`
  pages a time range in (time, ord) order, contiguous by construction (the page backfills with it); `?after=<cursor>`
  returns everything ingested after the cursor whatever its time, and the latest cursor for the next call (the page
  asks every 5 s with it, whether the story is running or long finished). Every time is integer milliseconds.
- **Where it links from:** every time bar's parts, on the run, story-run and story pages: the model's parts lead to
  the calls, tools to the tool calls, compaction to the compactions, the wait between sessions to the waits. A story
  whose conversation the warehouse doesn't have keeps its bar as a link to its story run, and its page says
  "Not available." with nothing about why. A combination page's bar sums a run's stories, so its parts open the
  run's time section.
- **The state** carries `storyRunId` (`<run dir>/stories/NN`) and `hasConversation` per story. The faults feed
  gains `conversation_missing`, `conversation_incomplete` and `conversation_service_unreachable`; no page shows them.
- **Tests:** `e2e/fixtures/conversations.py` writes the fixture's conversations, one case per cell of the matrix the
  pages can show (its docstring lists the dimensions); `e2e/conversation.spec.ts` covers the pages and the API by
  where the reader starts, `e2e/links.spec.ts` the bars, `e2e/no-faults.spec.ts` the sweep over the new pages
  (quoted agent text is checked apart, and must be the only place a fault word appears).

## Addresses and the way around

Every screen has an address in the hash, so it can be bookmarked, shared and gone back to. The four tabs are
links to the four sections: `#/` is the runs overview (always: nothing is remembered about which tab was open
last), `#/<pack>/stories` the pack's stories, `#/machines` the machines list and `#/setup` the setup page. The
entities sit under them: `#/<pack>/c/<stack>`, `…/r/<stack>/<run>`, `…/s/<n>`, `…/s/<n>/conversation`,
`…/conversation/c/<idx>`; `#/<pack>/s/<n>` for a story; `#/machines/<name>` for a machine (the older
`#/m/<name>` still opens it). The tab of the section a page is in is the selected one on every page.

The breadcrumb is the address spelled out, one shape per section: Overview › combination › run › Story N ›
Conversation › Call N; Overview › Stories › Story N; Overview › Machines › name. Every crumb but the last is a
link to that level. The window's title is the same trail, nearest first.

A link followed starts at the top of its page; Back and Forward return to the position the reader left (the
app keeps it per history entry, so a page that loads its data after render is restored once it is tall
enough). A page's own choices (the combination page's metric, the story and run pages' comparison, the
conversation page's kinds, search text and span: `?kind=call,tool&q=…&span=<from>-<to>` in milliseconds from
the story's start) are written into the address by replacement, so Back leaves the page and coming back finds
the choices still made.

## Machines and Setup

**Machines** lists the dbench nodes in `~/.config/dbench/nodes.toml` (shared with the `dbench` command
line): each one's hardware, installed combinations and dbench version, and its jobs (running, then the
queue in order, then the five latest ended). **Queue a run** takes a combination installed there, a pack,
a run id and a number of runs. A running job can be **stopped** (after a confirmation: it throws away the
story in progress); a queued one **removed**; a failed or cancelled one **restarted**, which queues the
same run under a new job id so it resumes at its first unfinished story.
**Add a machine** takes its Tailscale name: the benchmarker reads its token over SSH if it can, else asks
you to paste it (with the command to print it), checks the node answers, then saves it (mode 600).

The job actions go through the `dbench` command line; the server accepts them only from the page (a
header other sites can't send). **Setup** explains how to make a machine a node and what access each
part needs.

## By story

**By story** in the header turns the page round: the stories on the left, and for the one picked, a row
per job with that story's numbers side by side: held-out tests passing on the job's latest build, agent
minutes, calls, output and read tokens, tok/s, decode tok/s, compactions and nudges. Click a row to
select it, then **Set as comparison job**: every other job's numbers become a percentage of that job's
(its own row stays in full; where its number is 0 or missing, each job shows its own). The view, the
story and the comparison are remembered in the browser.

## Filters

Pack and version at the top, and one switch on every page and tab: **All runs** | **Complete runs**,
with no counts on it (a total for the whole pack says nothing about the page it sits on). All runs is the default; the choice is remembered
in the browser and is not in the address.

A run is **complete** when it finished, every story in its scope has a record, and it has its score of
record (its finished build re-scored under the pack's current suite). A complete run with a low score
is still complete. Everything else is hidden under Complete runs: running, queued, failed, stopped,
cancelled and unknown runs, finished runs waiting for their score or missing a story's record, and
partial reruns. One function decides it: `isComplete` in `shared/stats.ts`.

**Comparing a run with others.** A run page's *Compare with other runs* section takes any number of runs: type in the search box
(run id, model, engine, machine or status; every word must match) and pick a run, or use the arrow keys and Enter. Runs of this
combination come first, then other combinations'; only runs in the same pack and suite with a story recorded are offered, because a
story id means the same story only within one suite. Each chosen run is a chip with a remove button, and each table cell shows this
run's figure with one line per chosen run and its difference from this run's. The list is in the address
(`?compare=v2-r4,<combination>|v2-r1`; a run of this combination is its bare id), so a link or a reload keeps it, and it is
remembered in this browser (local storage) so the next run page starts with it, unless *remember these runs* is switched off. With
nothing in the address or remembered, the page starts with one other run of its combination.

Wherever runs are compared, they are in one order: **In progress**, **Queued**, **Finished**, then **Did not
finish** (failed, stopped, cancelled). Each is a section under its own heading, with its count, that folds away;
the runs that did not finish start folded. The choice is per page kind (the combination pages, the story pages,
the run pages, the story-run pages) and is remembered in the browser: folding Finished on one combination's page
folds it on every combination's page and nowhere else. A list with only one kind of run has no headings. The
order is `runOrder` and `groupRuns` in `shared/runGroups.ts`. A machine's history is a log, not a comparison:
one table of every run on the machine, newest activity first (the running run, then those that ended, latest
first, then the queue), with the combination and the spec version as columns and nothing folded.

The switch applies to every page's runs: the Combinations table, a combination's runs, a story's runs,
what a run or story run is compared with, and a machine's history. When it hides everything a page
would show, the page says so in one line with **Show all**, which sets the switch back to All runs.

It never hides what machines are doing now (the running job, the queue, recently ended jobs), or the
pack and version pickers.

## The overview: a dashboard

`#/` answers "what are my machines doing, and what is worth noticing?" from top to bottom:

- **Observations**: facts about the work, found in the data of normal operation, most actionable first: a machine
  that can't be reached, a run that has gone quiet, an idle machine with nothing queued, a story far slower than the
  same story in the stack's other runs (at least twice its median over three runs or more, and at least 20 minutes;
  one line per run), and a queue that will run dry within 24 hours. Each states its numbers and no cause or
  instruction. **Bugs of the app, the harness or the pipeline are never here**; they go to the monitor's log.
- **Now**: a card per machine: its state, the run and story it is on, the held-out strip of that run, where the run
  sits in its series ("run 2 of 5"), and its queue with how long the work will take. That duration is measured: the
  running run's remainder and a median run for each queued one, from the stack's finished runs; the basis is on hover,
  and where a stack has no finished run it says "no estimate yet" and draws nothing.
- **Series**: one row per series of runs of a stack (`<prefix>-rN`): the runs as segments, finished ones showing
  their score, the running one filled by stories done, queued ones outlined.
- **Score**: a dot per run, the median and the range on one axis, with neighbours the runs can't separate bracketed.
- **Combinations**: the full table.

The cards, the observations and the series ignore the runs switch (what machines are doing is not a result to
filter); the score plot and the table follow it. The view logic is `shared/dashboardView.ts`.

## Combinations

At the top of Runs, one row per combination over the runs the filters show, whichever machines they ran
on: its machines, its runs by status, held-out quality, the mean score of record (n = runs that have one),
hours per story, tok/s, calls and read tokens per story. Click a heading to sort by it (again to reverse);
every heading explains itself on hover. Sorted by held-out quality to start.


In each machine's table, every combination's runs sit under a heading line with two numbers over the
runs the filters show (hover the **?** for what each means):

- **hours per story**: the agent's time per recorded story, averaged over every story of those runs;
- **held-out quality**: held-out tests passing over all held-out tests, across every built story of every
  run, each on its run's latest build (100% = everything built passes the hidden tests).

Every column heading explains itself on hover too.

## What each column means

| Column | From |
|---|---|
| Run | model and engine, run id, spec version |
| Status | one word from the dbench job, else the run record; below it the place in the node's queue, "finishing story N" while a story is scored, or when the run ended |
| Story | the running story out of the job's scope ("story 4 of 11") and its title (up to three lines); for other runs, how many stories were built |
| Time | running: agent minutes on this story and how long the run has gone; otherwise agent time over its stories |
| Activity | the running story's calls, output tokens and tasks, and the agent's latest action. Claude runs count calls and tokens only at the end of a story, so they show none mid-story rather than a false zero |
| Stories working | how many of the run's stories work against its latest build, out of every story in its scope ("4 of 11 working"), and one square per story: green all its hidden flows pass, amber some, red none, grey not built yet, pulsing blue being built. A story that worked and was broken by a later one turns red. From the latest story recorded with a per-story breakdown (`accept-summary.json` `by_story`), or from the run's re-score under the pack's current suite when that reaches the same story or later (a re-score corrects live scores taken with an older suite); the scope is the job's story list, else every story in the private suite at the run's version (`--private`) |
| Tokens | output tokens over the run's recorded stories; under it everything the model **read** (fresh input plus cache reads and writes: clients split input differently, Claude Code reporting nearly all of it as cache reads, so only the total compares) and the number of calls. Every call re-reads the conversation, so read grows with calls |
| tok/s | output tokens over the time the run's recorded stories took (agent seconds: model, tools and all), for every run including the cloud reference. The per-story table also has the model-only decode and prefill rates where the harness timed the model (llama.cpp's log, or its metering proxy) |
| Score / N | the score of record as one number: hidden flows passing in the re-score (`rescore/<suite version>/`) of a finished run's last story, under the current suite (else the latest). The heading carries the total when every shown score has the same one; the tooltip gives the suite version and flaky count; the number links to the per-story table. A partial re-score (e.g. one story of a running run) only corrects the story squares |
| Live per-story held-out | each story's own and whole-suite figures as the live scoring recorded them. **Not available** for a run whose `finalize.json` says it was built under one suite version and scored under another (`built_under` differs from `scored_under`: Opus v2-r1 and v2-r2, built under vidi v2.0-pre1, whose suite asked for a button label the spec does not; every test failed from story 5 in v2-r1): the score of record stays, and the story's time, tokens and conversation are shown as before (`builtUnderEarlierSuite`, `withoutLiveHeldout`) |
| Judge | **Judge →** once the run is finished, re-scored with the pack's current version and has its `workspace.bundle` (the app's git history, one commit per story, which the review page rebuilds each story from; the harness doesn't write it yet, so it is made by hand); otherwise what it is waiting for |
| Links | the run's record and summary on GitHub |

Runs are filtered by pack and version family (`vidi-v2`, `vidi-v1`, …); results are
compared only within one family. Records written before runs recorded a version show as "unversioned".

**Scores appear only once they are pushed:** re-score results must be committed like the run records.
