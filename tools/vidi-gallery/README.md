# vidi-gallery

Review every Vidi build side by side. One page shows every recorded run's **scoring** (the held-out
suite), **judging** (audit rows) and **cost**, and opens any run's final build in its own window,
labelled with its setup and run.

```bash
cd tools/vidi-gallery && cargo run --release        # then open http://127.0.0.1:7800
cargo run --release -- --repo /path/to/awesome-local-ai --port 7800
```

Ctrl-C stops the gallery and every build it started.

## What it shows

One section per setup (a combination, or a reference stack such as `reference/opus-5.5`), one card
per run found under `combinations/**/benchmarks/vidi/<run>/` or `benchmarks/reference/vidi/<stack>/<run>/`:

- **Held-out score:** `accept-final.json` if the run has one, else the last story's `accept.json`
  (the whole suite, run after it), else the run's `accept.json` (a build scored once at the end).
  The strip shows each story's own tests: all passed, some, or none. **VOID** means the machine
  couldn't score it (e.g. no browser), so the numbers say nothing.
- **Judging:** counted rows of the run's `audit.jsonl`: functional faults by severity, the other
  categories, and whether failed features work the build's own way (`own_way`). Independent judges'
  results (`gradings/<package>/results/<judge>/` in the private repo) are listed at the bottom; they
  show build names only on a machine that holds the package's key (`~/.vidi-bench/keys/`).
- **Cost:** agent time, model calls and output tokens over the finished stories.
- Runs still going say so ("in progress, 4/11 stories").

## Story review: score each build story by story, blind

`http://127.0.0.1:7800/review` walks the stories in journey order (the scope's order: pan and zoom,
sticky notes, live sync, … images). For each story it shows what the user must be able to do: the
PRD's one-line summary, its **golden path** (the steps to follow in every build), its named
requirements and its **must-nots**. Below, one row per finished build:

- **Everything is prepared at startup, in the background:** each story's commit of each build is
  checked out, installed and built (story 1 first, three at a time). Builds with the same
  package-lock.json share one node_modules, cloned copy-on-write. A row says "queued", then
  "ready". Restarting the gallery skips what is already prepared.
- **Open** only starts the prepared build's server (a few seconds) and opens it in its own tab;
  after that the button goes to that tab, so you can switch between implementations.
- **One row per path** (a held-out test of the story), with its automated result. Picking one
  opens the **player**: every person's screen side by side (from the test's Playwright trace), a
  seek bar with a tick per check (green passed, red failed), and the test's steps beside it; the
  current step is highlighted as it plays. Drag or click the bar, click a tick or a step, or use
  `←`/`→` for the previous/next check; every frame is decoded when the path opens, so scrubbing
  doesn't wait. Long timed waits are drawn narrow and skipped in playback; fast tests start slowed
  down (0.1×–1×) so they can be watched. "details" opens Playwright's own trace viewer.
- **Traceability:** above the player, the PRD requirement(s) the test names (`@ref prd:<anchor>`)
  with their text; below it, the story's tasks with the status the harness recorded for this
  build, the commits that name each task, and all of the build's commits for the story. The spec
  doesn't say which task implements which requirement, so the page doesn't pretend to.
- **The verdict is per path: agree / disagree / skip** with the automated result, and a note, saved
  as you type to the private repo's `analysis/story-reviews.csv` (one row per story, build and path,
  by run name). A build's line sums its paths ("3 agree · 1 disagree · 1 to review"); a build with
  no recorded paths takes a pass / fail / skip of its own.
- **Keys** (press `?` on the page for the sheet; the map is `keyAction` in `src/player.js`, tested in
  `tests/player.test.cjs`):

  Three panes, left to right: **stories**, a story's **held-out tests**, and the **browser steps** of the
  test being played. The focused pane has a ring.

  | Keys | Does |
  |---|---|
  | `Tab` · `⇧Tab` / `Esc` | next pane · previous pane |
  | stories: `↑` `↓` · `→` / `Return` | previous / next story · into its held-out tests |
  | tests: `↑` `↓` | previous / next held-out test |
  | steps: `↑` `↓` | previous / next browser step (the scrubber follows) |
  | tests: `←` `→` (`⇧` finer) | scrub 5% of the recording (1%); at an end, on to the next / previous test (hold `→` to fly through the story) |
  | steps: `←` `→` (`⇧` finer) | scrub 5% (1%), stopping at the ends |
  | `Space` | play / pause |
  | `=` · `-` | agree · disagree, and on to the next test |
  | `.` `,` | next / previous frame |
  | `1`…`9` · `0` · `Home` `End` | jump to 10%…90% · the start · the ends |
  | `>` `<` | faster / slower |
  | `]` `[`, `PgDn` `PgUp` | next / previous story, from any pane |
  | `Return` · `⇧Return` | agree and on to the next test · disagree and write why |
  | `a` `d` `s`, or the buttons | agree / disagree / skip, and on to the next test |
  | `n` · `o` · `w` | write a note · open the build · skip long waits on / off |

  Keys go by position for digits and `-` `=` `,` `.`, so shift and keyboard layouts don't change them.
  Cmd, Ctrl and Alt combinations are left to the browser.
- **Your place is in the address** (`#story=…&key=…&idx=…&pane=…`). When the gallery restarts (for
  example after a rebuild), an open review page reloads itself onto the new code and comes back to it.
- **One run:** `/review?setup=<setup>&run=<run>` (the benchmarker's **Judge →** link) shows only that
  build, with a link to all of them. If the run isn't under review yet, the page waits for it.

**One spec version at a time.** The review takes the version family of the private checkout
(`vidi-v2.0-pre2` → `vidi-v2`) and only runs recorded under it: builds made from different specs
can't be judged against one story's spec. Every minute it adds runs that have since become reviewable
(finished, scored, with a `workspace.bundle`) to the end of the list, and prepares them, so a new run
needs no restart.

**Labelled by default.** Each build is named by its combination and run (e.g.
`qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi · canvas-pi-03`), so the reviewer sees what they
judge. `--blind` hides them instead: "Build A", "Build B"…, shuffled each session, tabs with a grey
"Build C" banner, and a story's names revealed once every path of every build has a verdict. The main
page (`/`) shows every name, so don't open it during a blind review.

**Order and builds follow the user's journey.** A story is reviewed after the stories a user goes
through to reach it, and on the build after the latest of those (its own build if it came after
them). From v2, story numbers are the journey, so that is simply story order on each story's own
build. vidi v1 isn't numbered that way (boards are created in story 5, after pan and zoom in story
1), so the private pack's `scope/canvas-prerequisites.json` lists each story's prerequisites: story 1
is reviewed after story 5, on the build after story 5. The page shows "First: …" for each story.
Builds are checked out from the run record's `workspace.bundle`. Only runs that finished every
story with a valid score and have a bundle are reviewed (Opus run-1 was built outside the harness
and has no per-story history).

## Opening a build

**Open** runs that run's final committed workspace, on demand (never all at once):

1. copies it to `~/.cache/awesome-local-ai/vidi-gallery/<run>/` (the repo is never touched);
2. `npm ci --ignore-scripts`, then `npm run build`, then `wrangler dev` on a private port;
3. puts a proxy in front that adds a banner (setup, run, held-out score) in the setup's colour and
   prefixes the window title. HTTP and WebSockets (live sync) pass through untouched.

The first open of a build installs and builds it, which takes about a minute; later opens reuse
the cache. **Stop** ends it. Build *n* uses proxy port 7801+*n*, wrangler 7851+*n* and inspector
7901+*n*, clear of the benchmark's ports (8787, 18010, 18787-18788, 19787). Each build holds its
own board storage under its cache folder.

## Safety

These builds are code written by AI agents. Dependencies are installed without install scripts,
and the apps run inside wrangler's local Workers runtime, but building one runs its build tooling
(e.g. its Vite config) as you. Open builds you're willing to run on this machine.
