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
