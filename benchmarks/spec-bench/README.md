# spec-bench: how does this setup build real software?

Runs a local coding setup — model + inference stack + coding agent — through a
real specification one story at a time, then scores each story with the
agent's own build and tests and, where the spec has one, a **held-out**
acceptance suite the agent never sees. It answers, for any combination in this
repo and any spec in the same shape: *how does this setup build this spec?*

The first spec is [Vidi](../vidi/) (a Miro-style whiteboard, 17 stories).

## Run it

```bash
# any installed combination, any pack; results land in
#   combinations/<COMBINATION>/benchmarks/<pack-name>/<run-id>/
benchmarks/spec-bench/harness/run.sh <install-id> --pack benchmarks/vidi --record

# choose stories: a named scope, an epic's table, or an explicit ordered list
  --scope canvas | --epic canvas | --stories 1,2,3

# resume an interrupted run (continues at the first unfinished story)
benchmarks/spec-bench/harness/run.sh <install-id> --pack benchmarks/vidi --run-id <same ID> --record

# validate a pack without a model: story order, titles, first prompt
uv run benchmarks/spec-bench/harness/drive.py --pack benchmarks/<pack> --scope <name> --dry-run

# compare runs
uv run benchmarks/spec-bench/harness/report.py --compare <run-dir> <run-dir> ...
```

A combination qualifies if it installs `<install-id>-server` (honouring `PORT`
and `REASONING_EFFORT`) and serves an OpenAI-compatible `/v1` with tool calling.

## A benchmark pack

```
benchmarks/<pack>/
  bench.json            optional; everything has a default
  spec/
    README.md
    epics/<slug>.md     a table whose first column is story ids (used by --epic)
    stories/NNN-slug/   story.md (first line = title), prd.md, design.md, tasks.md
  scope/<name>.json     optional named, ordered story lists  {"stories": [{"id": 1}, ...], "out_of_scope_note": "..."}
  acceptance/           optional held-out Playwright suite: tests/story-NN.spec.ts
```

`bench.json` (see [`../vidi/bench.json`](../vidi/bench.json)):

| Key | Default | Meaning |
|---|---|---|
| `name` | folder name | results go under `benchmarks/<name>/` in each combination |
| `app_line` | generic | first line of every story prompt |
| `readme` | `# <name>` | the only file in the empty repo the agent starts from |
| `rules` | generic list | numbered rules in every prompt (`{{ID}}`/`{{TITLE}}` allowed) |
| `stack` | `node-web` | `node-web` runs the sandbox preflight; other stacks skip it (and say so) |
| `gate` | build, typecheck, test:unit, test:component, test:integration, test:e2e | package scripts run after each story, in order; missing ones are skipped |
| `serve` | wrangler dev | how the acceptance suite starts the app; `{port}` and `{persist}` are filled in |

**Dependencies are yours to state.** Epic tables list an epic's stories, not
what they build on, so `--epic` runs only those. When stories depend on other
epics (Vidi's canvas stories need 3–5), write a `scope/<name>.json` in build
order.

### Writing an acceptance suite

Copy `../vidi/acceptance/` as the skeleton: `tests/global-setup.ts` and
`tests/app-server.ts` start the app once with the pack's `serve` command and
expose a restart endpoint; `tests/fixtures.ts` has `requires(...storyIds)`
(skips a test until those stories are built), `newPerson()` (a second browser
context), `shot()` (screenshots for the judge). The harness sets `WORKSPACE`,
`DONE_STORIES`, `ACCEPT_SERVE_CMD`, `SHOT_DIR` and `ACCEPT_JSON`.

Rules that kept Vidi's suite honest:

- Locate only what the spec pins down: PRD UI text, `aria-label`s and roles the
  design declares, keyboard shortcuts, routes. Never an implementation detail.
- Tag each test `@ref prd:<anchor>` so a failure traces to a requirement.
- Validate against an empty stub app: every test must fail cleanly, none hang.
- A test that fails on *every* setup is triaged against the spec before it
  counts; fix it and re-score finished runs with `harness/gates.py accept`.

## What happens in a run

1. **Preflight** (node-web packs, ~12 s): a tiny Vite + Wrangler + Playwright
   project is built, served and browsed inside the agent's exact sandbox; the
   run refuses to start if anything fails.
2. **Server**: waits for thermal `nominal`, starts the combination's launcher on
   `BENCH_PORT` (18010). Timing comes from the server's own request log where it
   keeps one (MTPLX); `--meter` puts a client-side proxy in front instead.
3. **Agent**: one fresh pi (default) or OpenCode session per story, same
   prompt template for every setup, isolated `HOME`, sandboxed (`sandbox-exec`):
   the repo, held-out suites, your agent config and other runs are unreadable.
4. **Guards**, all recorded, none capping time or tokens:
   - loop: the identical tool call 8× in a row ends the story (`stalled`);
   - hung tool: a tool call silent for 10 min is interrupted (Ctrl-C of the
     processes under the workspace) — pi's bash tool has no default timeout;
   - crash: an agent error exit forks the session and continues, up to 3×;
   - conditions: each story starts on AC power, no Low Power Mode, thermal
     nominal; losing power mid-story marks it `DEGRADED`, throttling is reported.
5. **Gates**: the pack's gate scripts, then the held-out suite for every story
   built so far (regressions count).
6. **Record** (`--record`): the run directory is committed and pushed after
   every story — the agent's code (no nested `.git`), its git log as text,
   compacted agent events, gate/acceptance results, `summary.md`.

## Caveats to quote with any result

- It compares **setups**, not models: quantisation, runtime, speculative
  decoding, client and memory footprint all differ at once.
- Reasoning effort is set **server-side** (clients drop it); a backend without
  that knob runs at its default.
- One run per setup unless stated; small differences are noise.

## Files

| Path | Role |
|---|---|
| `harness/run.sh` | one-command entry point |
| `harness/drive.py` | per-story driver, sandbox, guards, conditions, checkpoints, per-story record |
| `harness/pack.py` | pack loading, story discovery, scope resolution, prompt rendering |
| `harness/clients.py` | pi and OpenCode adapters (config, command, event parsing) |
| `harness/gates.py` | agent gate + acceptance runner, standalone for re-scoring |
| `harness/preflight.py` | sandbox toolchain check |
| `harness/report.py` | `summary.md` and cross-run comparison |
| `harness/judge_prep.py`, `harness/judge.md` | blind A/B code review |
| `harness/meter_proxy.py` | optional client-side request meter (`--meter`) |
| `prompts/story.md.tmpl` | the per-story instruction every setup gets |
