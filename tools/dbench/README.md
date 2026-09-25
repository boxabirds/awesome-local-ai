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
./build-linux.sh                      # Linux x86_64 glibc from a Mac, via zig (brew install zig;
                                      #   rustup target add x86_64-unknown-linux-gnu)
                                      # -> target/x86_64-unknown-linux-gnu/release/dbench
```

On a Linux box, `cargo build --release` works natively. TLS is rustls, so there's no OpenSSL.

## Run the server

```sh
dbench serve --bind 100.x.y.z:7717 --repo ~/awesome-local-ai \
  [--home ~/.dbench] [--share-dir ~/.local/share] \
  [--path-prepend ~/.local/bin --path-prepend ~/node20/bin] \
  [--max-restarts 3] [--no-pull]
```

- On first start it creates `<home>/token` (32 random bytes as hex, mode 0600) and prints where it put it.
- Before each job it runs `git -C <repo> pull --ff-only`, unless `--no-pull` is set. If the pull fails, the job still runs and the failure is recorded in the job.
- A job runs `bash <run.sh> <install-id> [--pack P] --run-id R [--scope S] [--only 1,2] --client C [--record]`.
  - The working directory is the repo.
  - The job gets its own process group.
  - PATH is the `--path-prepend` directories, then the server's PATH.
  - Output goes to `<home>/jobs/<id>.log`.
- A non-zero exit is restarted at the front of the queue after 30 s, up to `--max-restarts` times. After that the job is `failed`.
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
[nodes.gruntus]
url = "http://gruntus:7717"
token = "<contents of gruntus:~/.dbench/token>"

[nodes.quintus]
url = "http://quintus:7717"
token = "..."
```

### Any number of clients, from any machine

Nothing ties a node to the machine that set it up.
- **State:** all of a node's state (queue, job states, logs, token) lives in the node's `~/.dbench/`.
- **Results:** the harness pushes results to the git remote, not to a client.
- **What a client needs:** a route to the node's address and its token. For example, to add a second client on another Mac (such as the M2):

```sh
cd tools/dbench && cargo build --release          # or copy the binary from another Mac (same target)
mkdir -p ~/.config/dbench && ssh gruntus cat .dbench/token   # paste into nodes.toml as above
./target/release/dbench nodes                      # status of every node
./target/release/dbench status gruntus vidi-canvas-4090-01
./target/release/dbench logs gruntus vidi-canvas-4090-01 -f
git pull                                           # results, as each story is recorded
```

- **Several clients at once:** submits are idempotent by job id, and each node runs its queue in order.
- **Raw HTTP:** the API is plain HTTP+JSON, so `curl -H "Authorization: Bearer $TOKEN" http://gruntus:7717/v1/jobs` works without the client.
- **Staying up:** a node's service survives the client going away. On Linux it only runs with no one logged in on the node, and starts at boot, if linger is enabled (see above).

## Security model

- **Trusted network only.** Bind to the Tailscale or LAN address, never `0.0.0.0` on a network you don't control. The API is plain HTTP.
- **The token guards against mistakes; it is not a security boundary.** Every endpoint except `/v1/health` needs `Authorization: Bearer <token>`.
- **Named jobs only.**
  - A job names an installed combination, a pack directory in the repo, a run id, a scope and a client. All are checked against `[A-Za-z0-9._-]`.
  - The pack must be a relative path with no `..`.
  - The server builds the argv itself and never runs a shell string it was sent. Unknown JSON fields are rejected.
  - A job's `server_env` may set only `GPU_BACKEND` (vulkan|rocm), `SPEC_MTP` (0|1), `SPEC_DRAFT_N_MAX` (1–16), `SPEC_DRAFT_P_MIN` (0–1) and `PROFILE` (a plain name), each value checked. Nothing else (PATH, LD_PRELOAD, …) can be set.
- **What still runs as code:** a pack's harness and acceptance suite (Playwright). That code comes from the repo checkout at whatever `git pull` brought in, so anyone who can push to the repo can run code on the nodes.

## API

| Method and path | What it does |
|---|---|
| `GET /v1/health` | `{"ok":true,"version":…}`. No token needed. |
| `GET /v1/node` | hostname, os, arch, cpus, `total_ram_bytes`, `cpu_brand`, `gpus` (nvidia-smi; on macOS the chip with unified memory), installed `combinations` (INSTALL_ID/COMBINATION/BACKEND), `tools` (node, pi, git, uv versions, using the prepended PATH), `dbench_version`, `repo_head`, `current_job` |
| `PUT /v1/jobs/{id}` | body: `{install_id \| combination, pack, scope?, stories?, run_id, client: "pi"\|"opencode", record, server_env?}`. `server_env` is a map set in the harness's environment, and through it the model server's, from the allowed keys above; it is part of the job's identity, so the same id with a different `server_env` is a 409. `combination` is a directory under the node's `<repo>/combinations/` (a leading `combinations/` and trailing `/` are fine); the node reads `INSTALL_ID` from its `config.sh` and stores the job by install id, so both forms name the same job. Returns 201 if created, 200 if the same id and spec already exist, 409 if the id exists with a different spec, and 400 if a name is invalid, the combination isn't a whole directory in the repo or its install is of a different combination, the install is missing, or there's no harness for the pack. |
| `GET /v1/jobs` | all jobs, newest first, each with `progress` |
| `GET /v1/jobs/{id}` | `spec`, `state` (`queued` / `running{pid,pgid,attempt,started_at}` / `done{exit_code}` / `failed{reason,exit_code}` / `cancelled`), `attempt`, `history` (restarts, recoveries, pull failures, skip-story requests), `last_pull`, and `progress`. `progress` holds `run_dir`, `current_story`, `stories`, `stories_updated_at` and `log_tail` (last 20 lines). `stories` is every story in scope with its status, tasks, baselines and recent activity when the harness writes `progress.json`, and otherwise the finished stories from `metrics.json`; each always has `id`, `passed` and `total` (see below). |
| `POST /v1/jobs/{id}/cancel` | A queued job is cancelled at once (200). A running job gets SIGTERM to its process group and SIGKILL after 20 s (202), then becomes `cancelled`. A finished job returns 409. |
| `POST /v1/jobs/{id}/skip-story` | body: `{story, reason}`. Writes `control/skip-story.json` in the run dir for the harness and returns the job (202); the job keeps running. 404 for an unknown job, 400 for an empty reason, 409 if the job isn't running or `story` isn't the run's `current_story`. |
| `GET /v1/jobs/{id}/log?from=N&follow=1` | the log as plain text from byte N. With `follow=1` it keeps streaming until the job finishes. |
| `GET /v1/jobs/{id}/events` | `{"events":[{line, story, kind, …}]}`. The kinds are `story_start`, `story_continue`, `agent_error`, `nudge`, `agent_done`, `recorded`, `scored`, `hang_interrupt` and `crash`. |

## CLI examples

```sh
dbench nodes                                   # every node in parallel; unreachable ones say so
dbench submit gruntus --id canvas-pi-02 --combination qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode \
  --pack benchmarks/vidi --scope canvas --run-id canvas-pi-02 [--client pi] [--stories 1,2] [--no-record]
                                               # or --install-id qwen38-27b: the name the node installed it under
dbench submit gruntus --id vidi-4090 --install-id qwen38-27b --pack benchmarks/vidi --run-id canvas-pi --repeat 3
                                               # 3 queued jobs vidi-4090-r1..r3 / runs canvas-pi-r1..r3, run one after
                                               # another; each keeps its own record, resume and status
dbench submit … --repeat 2 --repeat-from 4     # add runs r4, r5 to an existing series
dbench submit tritus --id canvas-rocm-01 --install-id qwen38-flash-next-strix --pack benchmarks/vidi \
  --scope canvas --run-id canvas-rocm-01 --server-env GPU_BACKEND=rocm --server-env SPEC_DRAFT_N_MAX=4
                                               # a two-backend build on ROCm, draft depth 4; name the run for it
dbench status                                  # all jobs on all nodes
dbench status gruntus                          # one node
dbench status gruntus canvas-pi-02             # one job: state, stories, history, log tail
dbench logs gruntus canvas-pi-02 -f            # follow; reconnects from the last byte if the connection drops
dbench events gruntus canvas-pi-02
dbench cancel gruntus canvas-pi-02
dbench skip-story gruntus canvas-pi-02 --story 3 --reason "3h, no commit for 107 min"
                                               # end the running story as PARTIAL; the run goes on
dbench --json status gruntus canvas-pi-02      # --json: nodes, submit, status, events, cancel, skip-story
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

## Not built yet (from the design)

Conditions gate and `blocked` state, memory guard, offline push retry and `unpushed_commits`, previews, rescore, `PUT /v1/binary` self-update, `deploy`, `doctor`, and follow for events.
