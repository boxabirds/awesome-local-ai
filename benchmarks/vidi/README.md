# Vidi: how does this setup build real software?

A benchmark that runs a local coding setup (model + inference stack + OpenCode)
through a real specification, one story at a time. It records time and tokens,
checks the result with a **held-out** acceptance suite, and finishes with a blind
code-quality judgement. It answers one question for any combination in this
repo: *how does this setup implement Vidi?*

The spec (`spec/`) is a Miro-style collaborative whiteboard ("vidi6"): 17 stories
in 3 epics, each with a PRD, a technical design and ordered tasks.

## Where the spec, the held-out suite and the other secrets are

The specification, the **held-out acceptance suite** and the grading material are **not in this public repo**. They live in the private repo [`boxabirds/awesome-local-ai-bench-private`](https://github.com/boxabirds/awesome-local-ai-bench-private), so that they stay out of public training data and out of the agents' reach. That repo holds:
- `packs/vidi/spec/`, `scope/`, `prompts/`;
- `packs/vidi/acceptance/`: the held-out Playwright suite;
- `packs/vidi/GRADING.md`: the independent grader's brief;
- `gradings/`: blinded grading packages.

Everything else is public: this harness, dbench, the audit method, and all run records and results.

> **Transition note (25 Sep 2026):** copies of `spec/`, `acceptance/`, `scope/` and `prompts/` are still under `benchmarks/vidi/` here: they are bench **v1**, which was publicly exposed. They're removed once the runs that still read them have finished. The harness already prefers the private checkout when it sits next to this repo.

**Want to run the benchmark on your own hardware** (a 3090, a DGX, anything else)? Ask the repo owner (Julian Harris) for access to the private repo. With access:
1. Clone it next to this repo.
2. Run `benchmarks/spec-bench/harness/setup-node.sh`, which checks your tools, pins the pack to the current bench version (`vidi-v1`) and proves the sandbox hides the suite.
3. Run your setup with `run.sh` or dbench.

Results are only comparable within one bench version.

Two secrets never go in either repo:
- the A/B keys of blinded gradings (`~/.vidi-bench/grading-keys/`);
- the Claude subscription token (`~/.dbench/claude-oauth-token`).

## Run it

```bash
# any installed combination; results land in combinations/<COMBINATION>/benchmarks/vidi/<run-id>/
benchmarks/spec-bench/harness/run.sh <install-id> [--scope canvas] [--run-id ID] [--only 1,2]

# resume an interrupted run (continues at the first unfinished story)
benchmarks/spec-bench/harness/run.sh <install-id> --run-id <same ID>

# compare runs
uv run benchmarks/spec-bench/harness/report.py --compare <run-dir> <run-dir> ...
```

A combination qualifies if it installs `<install-id>-server` (honouring `PORT`
and `REASONING_EFFORT`) and serves an OpenAI-compatible `/v1` with tool calling.
Nothing in the harness is specific to a backend.

## What happens

1. **Server:** waits for thermal `nominal`, then starts the combination's own launcher on `BENCH_PORT` (18010).
2. **Meter:** `meter_proxy.py` sits in front of the server and logs one line per request: TTFT, decode tok/s, prompt/completion/cached tokens, tool calls, finish reason. The same client-side meter is used for every backend.
3. **Agent:** for each story in `scope/<scope>.json`, `drive.py` runs `opencode run` in a **fresh session**, with the same prompt (`prompts/story.md.tmpl`) and an isolated `HOME`, so none of your own config, skills or plugins leak in. Stories run in dependency order and build on each other.
4. **Loop guard:** there is no time or token cap. A story stops early only if the agent makes the identical tool call 8 times in a row (`stalled`).
5. **Crash resume:** if OpenCode exits on an error (a server stall, a 409, a dropped stream), the harness waits 60s and forks the session (same history, new session id, because MTPLX can leave a session id locked after a stall) and continues with "Continue with the task from where you left off.", up to 3 times. Every resume and its error go into `metrics.json` and the report: they are part of the result, not hidden.
6. **Run conditions:** before each story the harness pauses until the Mac is on AC power, not in Low Power Mode, and at thermal `nominal`, so every story starts cool. It samples every 30s during the story. Losing AC or entering Low Power Mode marks the story `DEGRADED` (re-run it). Thermal throttling *under load* is not a fault: sustained 27B decoding heats the machine on its own, and that is how the setup really performs. It is reported per story as `throttled N%`.
7. **Gates, after each story:**
   - `gate`: the agent's own `build`, `typecheck` and `test:*` scripts.
   - `accept`: the held-out Playwright suite in `acceptance/` against `wrangler dev`, for every story built so far (so regressions count).
8. **Snapshot:** anything the agent left uncommitted is committed as `harness: snapshot after story N`, and `metrics.json` is checkpointed.
9. **Report:** `summary.md` in the run directory.

## Watching a run and ending a story early

While a story runs, the harness keeps `progress.json` in the run directory up to date, and `dbench status <node> <job>` shows it. It lists every story in scope (`pending`, `running`, `DONE` or `PARTIAL`) with the running story's effort (agent minutes, calls, output tokens, compactions), the time since its last commit and since any task last moved, the same story's figures in other runs (baselines), and its recent tool calls. It also shows the story's tasks from `tasks.md`, each `not-started`, `written`, `committed` or `verified`. The harness works these out from the workspace: the TC ids on lines the story added, commit messages that name a task, and at the end, the agent's gate. It never asks the agent.

If a story seems to be taking far too long, the operator (a person, or Claude with the user's go-ahead) can end it:

```bash
dbench skip-story <node> <job> --story 3 --reason "3h, no commit for 107 min: e2e/WebKit flake triage"
```

The harness stops the agent (no resume, no nudge), runs the usual gates and snapshot, records the story as **PARTIAL** with the reason, and goes on to the next story. `metrics.json` keeps the processed stories as a queue, each `DONE` (the agent finished it) or `PARTIAL`. A PARTIAL story also gets a verdict on whether later stories can build on it. The verdict never stops the run:

| Verdict | Meaning |
|---|---|
| green | gate green, only test tasks unverified, own held-out tests no worse than the worst healthy (DONE, gate green) baseline |
| amber | gate green, but an implementation task is unverified or the held-out tests fall short |
| red | gate red |

The story order is the only dependency the spec records, so every later story counts as built on the PARTIAL one:
- The next agent's prompt names the PARTIAL story and its unverified tasks. It says to fill a gap only if the story needs it, to the PARTIAL story's design, recorded in `NOTES.md` under "Gap filled from story N", and never with stubs or fakes.
- The held-out suite gets `PROCESSED_STORIES=1:DONE,2:DONE,3:PARTIAL`. Tests built on a PARTIAL story are annotated `on-partial` and counted apart.
- Each later story records stub-like lines added to `src/`, and which of the PARTIAL story's held-out tests it fixed or broke.

Every early end is written to `interventions.md`. The file contract between the harness and dbench is in `harness/CONTROL.md`.

## Reference stack: Claude Code + Claude Opus 5.5

The reference stack runs through the same harness as the local setups: the same prompts, the same guards, the same scorer, **and the same sandbox**. The agent can't read the held-out suite, the repo, other runs or dbench's state. The preflight proves this before every run, by making Claude Code try to list the suite from inside the sandbox.

1. **Token (once per machine).** Headless Claude Code bills your Claude subscription through a long-lived OAuth token. Never use an API key: one set in the environment would switch it to API billing, and the harness strips `ANTHROPIC_API_KEY` from the agent anyway.
   ```sh
   claude setup-token                      # browser approval; prints the token
   # save it: ~/.dbench/claude-oauth-token, chmod 600 (or set CLAUDE_BENCH_TOKEN_FILE)
   ```
2. **Register the stack (once per machine):** `benchmarks/reference/install-stack.sh benchmarks/reference/vidi/opus-5.5`
3. **Run it:**
   ```sh
   benchmarks/spec-bench/harness/run.sh claude-code-opus-5-5 --client claude --run-id run-3 --record
   # or queued and repeated on a node:
   dbench submit <node> --id opus --install-id claude-code-opus-5-5 --client claude --pack benchmarks/vidi \
     --scope canvas --run-id opus --repeat 3
   ```
   Runs are recorded in `benchmarks/reference/vidi/opus-5.5/<run-id>/`.

**On another machine (e.g. the M2).** Run reference stacks on a machine where no other harness run is going, because the two agents' apps would collide on ports. Every step is a script:
```sh
cd ~/expts/awesome-local-ai && git pull                                        # public repo, with push access
benchmarks/reference/save-claude-token.sh                                       # `claude setup-token`, saved with mode 600
benchmarks/spec-bench/harness/setup-node.sh --stack benchmarks/reference/vidi/opus-5.5   # tools, private pack, preflight -> "ready"
benchmarks/spec-bench/harness/fetch-work.sh quintus benchmarks/reference/vidi/opus-5.5/run-2   # only to continue a run begun elsewhere
benchmarks/spec-bench/harness/run-series.sh claude-code-opus-5-5 --client claude --runs run-2,run-3 --background
benchmarks/spec-bench/harness/run-series.sh --status      # or: tail -f ~/.vidi-bench/series.log
benchmarks/spec-bench/harness/run-series.sh --stop        # stops; the same command later resumes where it stopped
```
- `run-series.sh` runs the listed runs **strictly one after another**, never in parallel: run-3 starts only when run-2 has finished, and a failed run stops the series.
- `--background` detaches it and keeps a Mac awake (`caffeinate -i`). Keep the machine on mains power: the harness pauses stories while on battery, and closing a laptop's lid sleeps it.
- Every story is committed and pushed as it finishes.

**Continuing a run that Claude Code subagents started.** Early reference runs were built by subagents that were only *told* not to look. To continue one under the harness:
1. `harness/import_run.py` peek-audits every finished story's transcript (`~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`). It refuses the import if any story touched the suite, the pack, the repo or another run.
2. If the audit is clean, it hands the workspace and the finished stories to the harness.
3. `run.sh … --run-id <same run> --client claude` then carries on, sandboxed, at the next story.

**Auditing any transcript for peeking:** `uv run harness/peek_audit.py --workspace <ws> <transcript.jsonl>…`. It reads Claude Code transcripts and pi event logs, and exits 1 on a peek.

## Scopes

| Scope | Stories | Why |
|---|---|---|
| `canvas` | 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12 | The "Infinite canvas and content" epic, plus stories 3–5, which its designs depend on |

## The held-out acceptance suite

`acceptance/` is **never copied into a workspace**. It has 75 black-box tests, one file per story. They use only what the spec pins down: PRD UI copy, the designs' `aria-label`s and roles, keyboard shortcuts and routes (`/b/<22-char id>`). Each test is tagged `@ref prd:<anchor>` so a failure traces back to a requirement. A test only runs once every story it depends on has been built.

It has been validated in one direction only: against an empty stub app, all 75 fail and none hang. **No implementation has yet proven every test passable.** A test that fails for *every* setup is triaged by hand against the spec, then either fixed (and every run re-scored with `harness/gates.py accept`) or marked a suite defect.

## Judging

### Independent grading (a second model audits two builds, blinded)

The brief is `GRADING.md` in the private pack: the same checks as [`audit.md`](audit.md), one row per
fault, including whether a failed feature works the build's own way (`own_way`). A package pairs two
builds as A and B; the key is kept outside every repo, in `~/.vidi-bench/keys/`, on the machine that
made it (`harness/grading_package.py`).

```bash
# 1. On the judging machine: extract the package (the private repo's checkout never moves) and print the kick-off message.
benchmarks/spec-bench/harness/judge-setup.sh vidi-v1
#    Start the judge in <private repo>/judging/vidi-v1/ (that folder only, if its tool allows) and give it the message.
# 2. When it has written build-A.jsonl, build-B.jsonl, test-faults.jsonl and summary.md: push them, with its transcript.
benchmarks/spec-bench/harness/judge-submit.sh vidi-v1 gpt-5.6 --transcript <session file>
# 3. On the machine with the key: check the rows and the transcript (any read outside the package is a peek), un-blind, compare.
uv run benchmarks/spec-bench/harness/judge_collect.py vidi-v1 gpt-5.6 \
    --audit opus=benchmarks/reference/vidi/opus-5.5/run-1/audit.jsonl \
    --audit flash-next=combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/benchmarks/vidi/canvas-pi-01/audit.jsonl
```

The judging folder is inside the private repo's checkout, which every harness version hides from
agents, so a benchmark can run on the same machine. The kick-off message keeps the judge off the
ports a run uses. Give the judge no access to this repo: it holds our audits of the same builds.

### Pairwise quality judge

```bash
uv run benchmarks/spec-bench/harness/judge_prep.py <run-1> <run-2> --out /tmp/vidi-judge --seed 1
```

This builds an anonymised A/B bundle; the label→run key is written *outside* it. Judges score with `harness/judge.md` (spec adherence, architecture, test quality, code quality, product quality, each with file-path evidence). Run it twice with swapped labels to check for position bias.

## Caveats you must quote with any result

- It compares **setups**, not models: quantisation, runtime, speculative decoding and memory footprint all differ at once.
- Thinking is on at effort `low` for every arm, set **server-side** (OpenCode drops a client-side `reasoning_effort`). A backend without an equivalent knob runs at its default, and the run says so.
- If a backend omits `usage` from streamed responses, its token totals are a lower bound. `summary.md` flags this.
- One run per setup. There are no repeats yet, so small differences are noise.

## Files

| Path | Role |
|---|---|
| `spec/` | the specification (read-only in each workspace) |
| `scope/*.json` | which stories, in which order |
| `prompts/story.md.tmpl` | the identical per-story instruction |
| `acceptance/` | held-out Playwright suite |
| `harness/run.sh` | one-command entry point |
| `harness/meter_proxy.py` | client-side request meter (tests: `test_meter_proxy.py`) |
| `harness/drive.py` | per-story agent driver, loop guard, checkpoints (tests: `test_drive.py`) |
| `harness/gates.py` | agent gate + acceptance runner, usable standalone for re-scoring |
| `harness/report.py` | `summary.md` and cross-run comparison |
| `harness/progress.py` | task status from workspace evidence, baselines, the PARTIAL verdict, `progress.json` (tests: `test_progress.py`) |
| `harness/CONTROL.md` | the harness ↔ dbench contract: `progress.json` and `control/skip-story.json` |
| `harness/judge_prep.py`, `harness/judge.md` | blind A/B judging |
