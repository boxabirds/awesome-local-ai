# dbench

Runs and watches benchmark jobs on remote machines. It's a single binary: `dbench serve` runs on each benchmark machine, and the client commands can run on any machine.

## Three layers

| Layer | What it is | dbench's part |
|---|---|---|
| **Configuration under test** | model + inference backend + coding agent (for example pi), installed from a `combinations/…` entry into `~/.local/share/<install-id>/` | none; dbench only reads `install.env` |
| **Benchmark harness** | `<pack>/harness/run.sh <install-id> --run-id R …` (or `benchmarks/spec-bench/harness/run.sh … --pack <pack>` once that exists). It drives the agent story by story, scores each story and records results under `combinations/<COMBINATION>/benchmarks/<pack>/<run-id>/`. Re-running the same run id resumes. | none; dbench runs it as is |
| **dbench** | controls the harness on its machine: a FIFO queue that runs one job at a time, restarts, cancel, recovery after a restart or reboot, status, logs and events | all of it |

Design: `docs/20260924-distributed-bench-design.md` (§3 and §5). dbench is the "benchd + bench CLI" part of that design, built as one binary.

## Build

```sh
cd tools/dbench
cargo build --release                 # native: target/release/dbench
cargo test                            # unit tests, plus end-to-end tests against the real binary
cargo clippy -- -D warnings           # kept at zero warnings; both are checks of `dbench harness-release`
./build-linux.sh                      # Linux x86_64 glibc from a Mac, via zig (brew install zig)
                                      # -> target/x86_64-unknown-linux-gnu/release/dbench
```

The Rust version is pinned in `rust-toolchain.toml` (an exact release, with clippy and the Linux target): rustup installs it the first time cargo runs here, so a new stable release can't fail a commit that passed before. To move to a newer Rust, change `channel` there and run the checks.

On a Linux box, `cargo build --release` works natively. TLS is rustls, so there's no OpenSSL.

## Run the server

```sh
dbench serve --bind 100.x.y.z:7717 --repo ~/awesome-local-ai \
  [--home ~/.dbench] [--share-dir ~/.local/share] \
  [--path-prepend ~/.local/bin --path-prepend ~/node20/bin] \
  [--max-restarts 3] [--no-pull] [--allow-unreleased]
```

- On first start it creates `<home>/token` (32 random bytes as hex, mode 0600) and prints where it put it.
- Before each job it runs `git -C <repo> pull --ff-only`, unless `--no-pull` is set. If the pull fails, the job still runs and the failure is recorded in the job. The checkout stays on main: it is where results are written, committed and pushed.
- **A job runs the harness of the latest release, not of main** (see "Which harness a job runs" below). With no release there is, the job fails and says how to make one, unless the server was started with `--allow-unreleased`.
- A job runs `bash <run.sh> <install-id> [--pack P] --run-id R [--scope S] [--only 1,2] --client C [--record]`.
  - `<run.sh>` is the release's `benchmarks/spec-bench/harness/run.sh`, and `SPEC_BENCH_RESULTS_ROOT` is set to the repo.
  - The working directory is the repo.
  - The job gets its own process group.
  - PATH is the `--path-prepend` directories, then the server's PATH.
  - Output goes to `<home>/jobs/<id>.log`.
- A non-zero exit is restarted at the front of the queue after 30 s, up to `--max-restarts` times. After that the job is `failed`.
  - Except the same failure twice with no progress: a restart can't get past a broken checkout, a model server that exits at start or a traceback at import, so the job fails at once rather than use up its restarts. Each failure's signature is the exit code plus the attempt's last meaningful log line: the exception line ending a Python traceback, or a `PREFLIGHT FAILED` / `MACHINE UNFIT` / `MISSING RESOURCES` line; else the last line reporting a failure (`failed`, `error:`, `fatal:`, `exited`); else the last line. Only the attempt's last 60 harness lines count, never dbench's own. Times, dates, durations, temp paths, hex addresses, pids and ports are replaced by placeholders (`<time>`, `<tmp>`, `<n>`, `<port>`, …) so they don't make two runs of the same failure look different; story numbers, exit codes and line numbers are kept. If a failure's signature equals the previous failed attempt's and the run has recorded no new story since (finished stories in `progress.json`, else in `metrics.json`), the job is `failed` with reason `the same failure twice with no progress: exit <code>: <line>`, noted in its history. An attempt that recorded a story always gets its restart.
  - Exit 3 (missing resources) fails at once and exit 75 (machine unfit) waits, as below; neither counts here.
- When the harness exits, anything left in its process group is stopped.
  - So is anything else it started that is still running, even in its own session: for example the model server run.sh starts under `setsid`, or pi under bwrap. The server samples the harness's process tree every 3 s while it runs, then sends SIGTERM, and SIGKILL after the cancel grace. The job only reaches its final state, and the next job only starts, once those processes are gone, so a leftover server can't keep holding the GPU.
- Stopping dbench leaves the harness running.
  - On start, a job still marked `running` whose process group is alive (and the machine hasn't rebooted since) is adopted. When it ends, it's requeued to resume.
  - If the harness is gone, the job is requeued as the next attempt, or marked `failed` if it has used all its restarts.

### Linux: systemd user unit

```sh
dbench service-unit --kind systemd --bind 100.x.y.z:7717 --repo ~/awesome-local-ai \
  > ~/.config/systemd/user/dbench.service
systemctl --user daemon-reload && systemctl --user enable --now dbench
sudo loginctl enable-linger $USER    # needs sudo: keeps user services running with nobody logged in, and starts them at boot
```

The unit has `KillMode=process`, so restarting dbench doesn't kill the harness. It also records the PATH of the shell that generated it.

### macOS: launchd agent

```sh
dbench service-unit --kind launchd --bind 100.x.y.z:7717 --repo ~/awesome-local-ai \
  > ~/Library/LaunchAgents/com.awesome-local-ai.dbench.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.awesome-local-ai.dbench.plist
```

The plist sets `KeepAlive` and `AbandonProcessGroup`, and records your current PATH. Its log is `<home>/dbench.log`.

## Client setup

Create `~/.config/dbench/nodes.toml`, or pass `--config FILE`:

```toml
# one table per machine; the name is yours (below: node-a is the RTX 4090 machine, node-c the M5 Max, node-d the Strix Halo box)
[nodes.node-a]
url = "http://node-a:7717"
token = "<contents of node-a:~/.dbench/token>"

[nodes.node-c]
url = "http://node-c:7717"
token = "..."
```

### Any number of clients, from any machine

Nothing ties a node to the machine that set it up.
- **State:** all of a node's state (queue, job states, logs, token) lives in the node's `~/.dbench/`.
- **Results:** the harness pushes results to the git remote, not to a client.
- **What a client needs:** a route to the node's address and its token. For example, to add a second client on another Mac (such as the M2):

```sh
cd tools/dbench && cargo build --release          # or copy the binary from another Mac (same target)
mkdir -p ~/.config/dbench && ssh node-a cat .dbench/token    # paste into nodes.toml as above
./target/release/dbench nodes                      # status of every node
./target/release/dbench status node-a vidi-canvas-4090-01
./target/release/dbench logs node-a vidi-canvas-4090-01 -f
git pull                                           # results, as each story is recorded
```

- **Several clients at once:** submits are idempotent by job id, and each node runs its queue in order.
- **Raw HTTP:** the API is plain HTTP+JSON, so `curl -H "Authorization: Bearer $TOKEN" http://node-a:7717/v1/jobs` works without the client.
- **Staying up:** a node's service survives the client going away. On Linux it only runs with no one logged in on the node, and starts at boot, if linger is enabled (see above).

## Security model

- **Trusted network only.** Bind to the Tailscale or LAN address, never `0.0.0.0` on a network you don't control. The API is plain HTTP.
- **The token guards against mistakes; it is not a security boundary.** Every endpoint except `/v1/health` needs `Authorization: Bearer <token>`.
- **Named jobs only.**
  - A job names an installed combination, a pack directory in the repo, a run id, a scope and a client. All are checked against `[A-Za-z0-9._-]`.
  - The pack must be a relative path with no `..`.
  - The server builds the argv itself and never runs a shell string it was sent. Unknown JSON fields are rejected.
  - A job's `server_env` may set only `GPU_BACKEND` (vulkan|rocm), `SPEC_MTP` (0|1), `SPEC_DRAFT_N_MAX` (1–16), `SPEC_DRAFT_P_MIN` (0–1) and `PROFILE` (a plain name), each value checked. Nothing else (PATH, LD_PRELOAD, …) can be set.
- **What still runs as code:** the harness and a pack's acceptance suite (Playwright). The harness is the latest release's, so it is code that passed every check; but a release is a tag anyone who can push to the repo can make, and the packs and each combination's config are read from the checkout at whatever `git pull` brought in. So anyone who can push to the repo can still run code on the nodes.

## API

| Method and path | What it does |
|---|---|
| `GET /v1/health` | `{"ok":true,"version":…}`. No token needed. |
| `GET /v1/node` | hostname, os, arch, cpus, `total_ram_bytes`, `cpu_brand`, `gpus` (nvidia-smi; on macOS the chip with unified memory), installed `combinations` (INSTALL_ID/COMBINATION/BACKEND), `tools` (node, pi, git, uv versions, using the prepended PATH), `dbench_version`, `repo_head`, `current_job` |
| `PUT /v1/jobs/{id}` | body: `{install_id \| combination, pack, scope?, stories?, run_id, client: "pi"\|"opencode", record, server_env?, from_run?, from_story?}`. `from_run` is a finished run to start from (the harness's partial rerun), as a run directory relative to the repo; it needs `stories` or `from_story`, is part of the job's identity like `server_env`, and a path that is absolute or has `..` is a 400. `from_story` (a positive number; needs `from_run`, refused with `stories`) runs that story and every later story of the scope, each built on the one before in the new run, starting from the reference run's code as it was before that story; also part of the identity. A node older than this field refuses the whole request (the spec denies unknown fields), so nothing is queued; install the new dbench on a node before submitting such a job. `server_env` is a map set in the harness's environment, and through it the model server's, from the allowed keys above; it is part of the job's identity, so the same id with a different `server_env` is a 409. `combination` is a directory under the node's `<repo>/combinations/` (a leading `combinations/` and trailing `/` are fine); the node reads `INSTALL_ID` from its `config.sh` and stores the job by install id, so both forms name the same job. Returns 201 if created, 200 if the same id and spec already exist, 409 if the id exists with a different spec, and 400 if a name is invalid, the combination isn't a whole directory in the repo or its install is of a different combination, the install is missing, or there's no harness for the pack. |
| `GET /v1/jobs` | all jobs, newest first, each with `progress` |
| `GET /v1/jobs/{id}` | `spec`, `state` (`queued` / `running{pid,pgid,attempt,started_at}` / `done{exit_code}` / `failed{reason,exit_code}` / `cancelled`), `attempt`, `history` (restarts, recoveries, pull failures, skip-story requests, the harness chosen), `last_pull`, `last_failure` (`{signature, stories}` of the last failed attempt that was restarted, which the next failure is compared with), `harness` (the release the job runs, once it has started: `{"kind": "release", "tag", "commit"}`, or `{"kind": "unreleased"}`), and `progress`. `progress` holds `run_dir`, `current_story`, `stories`, `stories_updated_at` and `log_tail` (last 20 lines). `stories` is every story in scope with its status, tasks, baselines and recent activity when the harness writes `progress.json`, and otherwise the finished stories from `metrics.json`; each always has `id`, `passed` and `total` (see below). |
| `POST /v1/hold` | Body `{"reason": "…"}`, required (400 without one). The running job carries on; no queued job starts until a release. Kept in `~/.dbench/hold.json`, so it outlives a restart of the server; `GET /v1/node` shows it as `hold`. |
| `POST /v1/release` | Ends a hold; queued jobs start again. Fine on a node that isn't held. |
| `POST /v1/jobs/{id}/cancel` | Body `{"reason": "…"}`, required (400 without one): kept as the job's `cancel_reason`, in its history and its log. A queued job is cancelled at once (200). A running job gets SIGTERM to its process group and SIGKILL after 20 s (202), then becomes `cancelled`. A finished job returns 409. |
| `POST /v1/jobs/{id}/skip-story` | body: `{story, reason}`. Writes `control/skip-story.json` in the run dir for the harness and returns the job (202); the job keeps running. 404 for an unknown job, 400 for an empty reason, 409 if the job isn't running or `story` isn't the run's `current_story`. |
| `GET /v1/jobs/{id}/log?from=N&follow=1` | the log as plain text from byte N. With `follow=1` it keeps streaming until the job finishes. |
| `GET /v1/jobs/{id}/events` | `{"events":[{line, story, kind, …}]}`. The kinds are `story_start`, `story_continue`, `agent_error`, `nudge`, `agent_done`, `recorded`, `scored`, `hang_interrupt` and `crash`. |

## CLI examples

```sh
dbench nodes                                   # every node in parallel; unreachable ones say so
dbench submit node-a --id canvas-pi-02 --combination qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi \
  --pack benchmarks/vidi --scope canvas --run-id canvas-pi-02 [--client pi] [--stories 1,2] [--no-record]
                                               # or --install-id qwen38-27b: the name the node installed it under
dbench submit node-a --id vidi-4090 --install-id qwen38-27b --pack benchmarks/vidi --run-id canvas-pi --repeat 3
                                               # 3 queued jobs vidi-4090-r1..r3 / runs canvas-pi-r1..r3, run one after
                                               # another; each keeps its own record, resume and status
dbench submit … --repeat 2 --repeat-from 4     # add runs r4, r5 to an existing series
dbench submit node-a --id v2-r3-s2 --combination qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi \
  --pack benchmarks/vidi --scope canvas --run-id v2-r3-s2 --stories 2 --repeat 5 \
  --from-run combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r3
                                               # partial rerun: story 2 on v2-r3's code as story 1 left it, five separate runs
dbench submit node-a --id v2-r3-s2on --combination qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi \
  --pack benchmarks/vidi --scope canvas --run-id v2-r3-s2on --repeat 3 --from-story 2 \
  --from-run combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r3
                                               # story 2 and every later story on v2-r3's code, three separate runs
dbench submit node-d --id canvas-rocm-01 --install-id qwen38-flash-next-strix --pack benchmarks/vidi \
  --scope canvas --run-id canvas-rocm-01 --server-env GPU_BACKEND=rocm --server-env SPEC_DRAFT_N_MAX=4
                                               # a two-backend build on ROCm, draft depth 4; name the run for it
dbench status                                  # all jobs on all nodes
dbench status node-a                           # one node
dbench status node-a canvas-pi-02              # one job: state, stories, history, log tail
dbench logs node-a canvas-pi-02 -f             # follow; reconnects from the last byte if the connection drops
dbench events node-a canvas-pi-02
dbench cancel node-a canvas-pi-02 --reason "preflight failed; resubmitting after the fix"
dbench hold node-a --reason "restart on the new binary"   # the running job finishes; nothing new starts
dbench release node-a                                       # queued jobs start again
dbench skip-story node-a canvas-pi-02 --story 3 --reason "3h, no commit for 107 min"
                                               # end the running story as PARTIAL; the run goes on
dbench --json status node-a canvas-pi-02       # --json: nodes, submit, status, events, cancel, skip-story
dbench harness-release --check-only            # every check a harness release must pass; no tag (see below)
```

## Stories and tasks in `status`

The harness keeps `progress.json` in the run dir: every story in scope with its status (`pending`, `running`, `DONE`, `PARTIAL`), agent time, calls, output tokens, acceptance result, last commit, its tasks, baselines from earlier runs and its latest activity. The contract, with the full shape, is `benchmarks/spec-bench/harness/CONTROL.md`. dbench serves it as `progress.stories`. Every field is optional, and a field of the wrong type reads as missing. Without a `progress.json` (an older harness), `stories` is the finished stories from `metrics.json` as before.

`dbench status <node> <job>` prints one line per story, for example:

```
    3  running  See other people's edits appear live on the…  agent 3h07m  572 calls  527k tokens  8 compactions  accept 5/7  last commit 1h47m ago  tasks: 2 committed, 1 written, 1 not-started
```

A PARTIAL story also shows its verdict, who ended it and why. Below the list come the task table, baselines and last few activity lines of the running story (or, once nothing runs, of the last one started). Ages are worked out when you run the command. `dbench status` with no job shows the running story's line under each job.

## Ending a story early: `skip-story`

```sh
dbench skip-story <node> <job> --story N --reason "<why>"
```

This ends the running story's work. The harness stops the agent (no resume, no nudge), records the story as PARTIAL with your reason, and the run continues with the next story. The job itself keeps running. Later stories may then build on incomplete work, so use it with care.

- **Checks:** the node refuses (409) unless the job is running and `N` is the run's `current_story`. The error names the current story. The reason can't be empty.
- **What it does:** dbench only writes `<run_dir>/control/skip-story.json` (`{story, reason, by, at}`, atomically). It records the request in the job's history and log, like a cancel. The harness checks for the file every few seconds and renames it to `skip-story-<N>.applied.json` once applied.
- **Timing:** it takes effect within a few seconds. `dbench status` then shows the story as PARTIAL.

## Which harness a job runs

Every push to main used to reach the next job within minutes, untested. Now a job runs the harness of the newest release (`harness-v<YYYY.MM.DD>.<n>`, made by `dbench harness-release` only when every check passes), and main can move on without touching running nodes.

- **Finding it.** Before a new job starts, the node fetches main and the tags, and takes the newest `harness-v*` tag that is on `origin/main`. Newest is by the tag's name (date, then that day's number, as numbers: `.2` < `.10` < the next day's `.1`), never by when the tag was made. A tag on a commit main doesn't have is ignored.
- **Materialising it.** Once per tag, under `<home>/releases/<tag>/`: the paths the release itself calls the harness (`harness = [...]` in its `tools/dbench/checks.toml`: `benchmarks/spec-bench`, `benchmarks/perf` and `tools/agent-sandbox`, the agent's sandbox as source: the harness builds it once per change on the node, with cargo, and keeps it under the bench home), taken from the tag with `git archive`, plus `RELEASE.json` (`tag`, `commit`, `commit_short`). The directory has no `.git` and is read-only: nothing can be committed into it or edited in it by accident, and it can't drift from the tag the way a worktree can. The harness reads `RELEASE.json` to record its commit and tag in every run (`run.json`, each story's `provenance`: `harness_commit`, `harness_release`).
- **Running it.** `<release>/benchmarks/spec-bench/harness/run.sh`, with `SPEC_BENCH_RESULTS_ROOT=<repo>`. The harness's code comes from the release; everything else comes from the checkout, which stays on main: run directories and their commits and pushes, other runs' records, the packs (they have their own version tags), and each combination's `config.sh` (it belongs with the install on the node, which is made from the checkout too). `benchmarks/spec-bench/harness/roots.py` is the one place that decides which is which.
- **What the job says.** `GET /v1/jobs/{id}` has `harness`: `{"kind": "release", "tag", "commit"}` or `{"kind": "unreleased"}`; `dbench status <node> <id>` shows it as `harness`, the job's history has a line for it, and the job log names the directory.
- **No release.** The job fails at once, without starting anything, and its reason says how to cut a release. A benchmark number from untested code is worse than no number. For development, `dbench serve --allow-unreleased` runs the checkout's own harness when there is no release (exactly as before releases: no `SPEC_BENCH_RESULTS_ROOT`), and says UNRELEASED in the job's history and log; such runs record `harness_release: null`. With a release on main the flag changes nothing.
- **Restarts keep the release.** The choice is stored in the job when it first starts. A restart after a crash, an unfit machine or a server restart runs the same release even if a newer one exists by then; the next job takes the newer one. If the release's directory is gone it is made again from the tag. If the tag no longer names the commit the job started on (deleted or moved), the job fails rather than change harness part-way through a run. The same goes for the checkout's own harness: a job that started unreleased, or under a dbench from before releases (nothing on record, and it has already started), keeps running the checkout's harness when it restarts, with or without `--allow-unreleased`.
- **Pruning.** When a job starts, release directories are removed except the newest 3 and any that a job which has started and not finished runs from. Anything else in `<home>/releases` that isn't a release directory is left alone.
- **A release that can't be run is refused**, and the job fails saying why: one whose `checks.toml` has no `harness` list, one without `benchmarks/spec-bench/harness/run.sh`, and one without `benchmarks/spec-bench/harness/roots.py` (a harness from before it could be told where results go would ignore `SPEC_BENCH_RESULTS_ROOT` and treat its own directory as the results root).
- **The first release.** A node with this version refuses jobs until main has a release whose `checks.toml` has the `harness` list: cut one (`dbench harness-release`) before restarting nodes on this binary, or start them with `--allow-unreleased` for the meantime.

## Releasing the harness: `harness-release`

A harness release is a git tag, `harness-v<YYYY.MM.DD>.<n>` (UTC date; `n` counts that day's releases from 1), made only after every check has passed on the commit it names.

```sh
dbench harness-release               # run every check; if all pass, tag HEAD (annotated) and push the tag
dbench harness-release --check-only  # run every check and report; tag nothing
dbench harness-release --dry-run     # show the checks and the tag a release would make; run nothing
```

It works on the git repository the current directory is in, or `--repo PATH`. This is not `dbench release <node>`, which ends a hold.

- **The checks are one list:** `tools/dbench/checks.toml` in the repo, read when the command runs. The same file says what a node runs from a release (`harness`, plain paths that must be under the checked `paths`). Each check is a name, a working directory and a command. To add a check, add it there and nowhere else.
- **What counts as a failure:**
  - the command exits non-zero;
  - the command can't be started (the program isn't installed);
  - a file the check `requires` is absent, or its directory is (`missing`);
  - the command exits 0 but its output reports a skip of a test file listed in the check's `no_skips_of` (a skipped test proved nothing). The harness suite may not skip `test_pipeline.py`, which needs node, npm and npx.
- **Every check runs, even after one fails,** so one attempt shows everything that is wrong. Each gets a `PASS` or `FAIL` line with its time. For each failed check the last 40 lines of its output follow, and its full output is kept in the log directory (`--log-dir DIR`, or a temporary directory that is named on failure and removed when everything passes).
- **A release is refused, with nothing tagged, when:**
  - any check fails;
  - HEAD isn't what `origin/main` points at. It fetches first (the branch and the tags), so both a commit that isn't pushed and a checkout that is behind are refused;
  - a file under the checked paths (`paths` in `checks.toml`) has uncommitted changes, staged or not, or is untracked and not ignored. The checks would run with that file, and the tagged commit wouldn't have it. Files elsewhere, such as benchmark results, don't matter;
  - HEAD moved, or a tracked file under the checked paths changed, while the checks ran;
  - the tag can't be pushed. The local tag is then removed.
- **`--check-only` doesn't look at git state:** no fetch, and a dirty tree or an unpushed commit is fine. It exits non-zero if any check fails.
- **What the checks need installed:** uv, node with npm and npx, rustup (cargo and clippy come from `rust-toolchain.toml`), bun with the benchmarker's packages (`bun install` in `tools/benchmarker`), and Playwright's chromium (`bunx playwright install chromium` there). On Linux, bubblewrap (`bwrap`) too: the harness tests that run the agent's sandbox skip without it, and in CI, which sets `SPEC_BENCH_REQUIRE_SANDBOX`, fail without it.

The machines don't run released tags yet: a job still runs whatever `git pull` brought in (see "Run the server").

## Not built yet (from the design)

Conditions gate and `blocked` state, memory guard, offline push retry and `unpushed_commits`, previews, rescore, `PUT /v1/binary` self-update, `deploy`, `doctor`, and follow for events.

## Restarting a node's server (a new binary, say)

A server restarted mid-job adopts the running harness but can't learn how it ended, so it requeues the job to
resume; and between two jobs there are only seconds. So: `dbench hold <node> --reason …`, wait until `dbench
nodes` shows no job on it, restart the service (it stays held: the hold is kept on disk), then `dbench release
<node>`.

## When the machine is unfit

The harness's swap and memory guards stop a run before memory pressure can take the machine down. That exit (75)
isn't a crash: dbench waits `--unfit-backoff-ms` (5 minutes) and tries again, without counting a restart, and notes
each wait. The harness decides: run.sh first checks the machine has recovered (machine_fit.py) and exits 75 again,
before loading anything, until it has.
