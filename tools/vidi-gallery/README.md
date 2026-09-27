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
- **pass / fail / skip** and a note, saved as you type to the private repo's
  `analysis/story-reviews.csv` (one row per story and build, by run name).
- Keys: `1`–`9` pick a build, `o` opens or goes to its tab, `+` pass, `-` fail, space skip,
  `n` note (`Esc` to leave), `↑`/`↓` build, `←`/`→` story.

**Blind by default.** Builds are "Build A", "Build B"…, shuffled each session, and their tabs carry
a grey "Build C" banner instead of the setup's name. A story's names can be revealed once every build
has a verdict on it. `--labelled` shows names throughout. The main page (`/`) shows every name, so
don't open it during a blind review.

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
