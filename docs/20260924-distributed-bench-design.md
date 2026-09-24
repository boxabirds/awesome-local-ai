# Distributed spec-bench: design

> How might we run resilient benchmarks across any number of heterogeneous
> machines, where each machine carries on by itself when the controller goes away?

Machines today:
- **M2**: laptop, controller only.
- **quintus**: M5 Max 128 GB, macOS.
- **gruntus**: RTX 4090 24 GB, 62 GB RAM, Ubuntu 22.04.
- **tritus**: AMD Ryzen AI Max 395, unified memory, not yet reachable.

All are on one trusted network (Tailscale, which the design doesn't depend on).

## 0. Four problems with the brief

1. **Rust is more efficient, but the saving here is small.** Resident memory measured on quintus mid-story, 24 Sep:

   | Process | Resident memory |
   |---|---|
   | Python driver (uv wrapper + drive.py) | 28 MB |
   | pi agent (Node) | 179 MB |
   | the agent's app (workerd/wrangler) | 225 MB |
   | MTPLX server | 30 GB resident, ~100 GB footprint |

   - A Rust driver would be a few MB, saving about 20 MB. That is about 0.02% of a 128 GB machine.
   - The large items are the agent under test and the model server, and they stay whatever language the harness is in.
   - Rust also brings **deployment** (one static binary, no Python/uv on every box; gruntus has no uv today) and a type system that catches whole classes of harness bugs.
   - So: Rust for the **new** code, meaning the node daemon and the CLI.
   - Keep the story driver (`drive.py`, `clients.py`, `gates.py`) as the job payload for now. It holds a day's worth of hard-won fixes, all learned by failure. Examples:
     - sandbox metadata reads;
     - killing a stray wrangler;
     - pi's bash tool hanging;
     - nudges;
     - privacy scrubbing;
     - rebase-on-push;
     - memory refusals.
   - Rewriting it now means relearning each of those by failing again, in the middle of a baseline.
   - Port it later, module by module, once a second platform has produced results.
2. **Rust doesn't remove the heavy dependencies.**
   - Every node still needs Node, npm, Playwright and Chromium for the agent's toolchain and the held-out suite, plus the combination's own server.
   - gruntus has **node v12**, which is too old for Vite or Playwright. That, not the orchestrator, is the first real blocker.
3. **The hard part is portability, not orchestration.** The harness today is macOS-only in four places:
   - `sandbox-exec` (Linux needs bubblewrap; gruntus has `bwrap`);
   - power and thermal checks (`pmset`, `thermal.py`);
   - the memory guard (`footprint`, `memory_pressure`);
   - the preflight.

   Nothing distributed runs until one Linux node can run one story by hand.
4. **Scale.** There are four machines, and each can run one benchmark at a time: two runs would fight over the GPU or unified memory and ruin the timings. That means:
   - no scheduler;
   - no cluster membership;
   - no consensus;
   - no central database.

   Anything more than "a daemon per box and a CLI" is building infrastructure instead of producing results.

**Order to work in:**
1. Finish canvas-pi-01.
2. Get one story running on gruntus by hand.
3. Then build the daemon.

The daemon is small enough that the order matters more than the code.

## 0.5 Layers, and the operator's job moves into them

| Layer | What it is | Owns |
|---|---|---|
| **Configuration** (what's under test) | model + inference backend + coding agent (pi.dev) + settings, i.e. a `combinations/…` entry and its install | serving the model on `/v1`; nothing else |
| **Benchmark harness** | runs one spec pack against one configuration, story by story | the agent sandbox, prompts, nudges and resumes, guards, gates, the held-out suite, scoring, per-story record, interventions log, summary |
| **Remote server** (`benchd`) | controls the harness on its machine, for any spec | start, stop and resume runs; supervising the harness; status, events and logs; previews; triggering evaluation; notifications |

**The test for the split:** everything a human (or Claude) did by hand during canvas-pi-01 must be done by one of these layers, or deliberately left to a person. That work was: starting and restarting, watching, stopping on danger, logging interventions, re-scoring, previews, throughput stats, and judging quality. This table is the list of requirements:

| Operator work during canvas-pi-01 | Owner | Today |
|---|---|---|
| Start a run, resume after a crash or restart | server | manual `run.sh` → **missing** |
| Watch progress (stories, nudges, errors, refusals) | harness emits typed events; server stores and streams them | log lines grepped by hand → **missing** as events |
| Stop on real memory danger (free %, swap) | harness conditions | swap guard in the harness; the free-% watchdog was an external shell loop → **move into the harness** |
| Log every intervention with a timestamp | harness for automatic ones (hang guard does this); server for restarts, cancels and upgrades | partly; restarts written by hand → **missing** |
| Nudges, fork-resume on server errors | harness | exists |
| Record and push each story | harness; server retries pushes while offline | exists; offline retry **missing** |
| Serve the app at story N for manual testing | server: `POST /v1/runs/{id}/preview?story=N` serves the recorded code at that story's commit, not the live workspace | done by hand 3 times → **missing** |
| Re-score finished stories after a suite fix | harness command (`rescore <run> --stories …`), triggered by the server; keeps the old result and logs an intervention | done by hand → **missing** as a command |
| Throughput stats (sustained decode, busy share) | harness report, from the backend's own log | ad-hoc Python → **fold into `report.py`** |
| Quality review of the delivered code | harness end-of-run step: a judge model with `judge.md` on the final workspace | manual → **missing**. Needs a decision on which model judges. |
| Triage suite defects (e.g. story 5's rate limit) | **a person**, because the harness can't tell a test bug from an app bug. The harness **flags** candidates: a test that fails on every configuration, or a failure whose page shows spec-mandated text (for example "You're creating boards too quickly"). | manual |

**Specs are arbitrary.** A job names a pack by repo path at a pinned commit. A pack's acceptance suite is code (Playwright) that runs on the node. That is acceptable on a trusted network, but it's the one place where a job carries code, so packs come only from the repo and are never uploaded ad hoc.

## 1. Principles

1. **Every node is autonomous.** A node owns its queue, its running job and its results. The controller can be switched off, crash or move to another laptop, and nothing stops.
2. **Git is the result store.** This is already true: every story is committed and pushed. Each run writes to its own directory, `combinations/<combo>/benchmarks/<pack>/<run-id>/`, so nodes never write the same file. The remote is the one place where everything meets, and it already copes with nodes being offline.
3. **No central server.** The controller is a CLI with a list of nodes in a file. Any machine can be the controller, and several can be at once.
4. **One job at a time per node.** The daemon enforces this, not people.
5. **Idempotent, resumable and restartable.**
   - A job id is chosen by the submitter, so submitting twice is harmless.
   - A crashed or rebooted node resumes at the first unfinished story. That already works: the driver resumes, and it continues the same agent session in the middle of a story.
6. **Named things only, never arbitrary commands.** A job refers to an installed combination and a pack by name. The daemon never runs a shell string it was sent. On a trusted network this still matters, because a daemon that runs arbitrary commands is remote code execution for anything that can reach it.

## 2. Architecture

```
  controller (any machine: M2, quintus, ...)
  ┌──────────────────────────────┐
  │ bench CLI  (~/.config/bench/nodes.toml)
  │  submit / status / logs -f / cancel / deploy
  └──────┬───────────────┬───────┘
         │ HTTP+JSON     │ (fan-out, no state)
   ┌─────▼─────┐   ┌─────▼─────┐   ┌───────────┐
   │ benchd    │   │ benchd    │   │ benchd    │
   │ quintus   │   │ gruntus   │   │ tritus    │
   │ launchd   │   │ systemd   │   │ systemd   │
   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
         │ runs (own process group)      │
   harness job: run.sh → drive.py → pi → model server
         │               │               │
         └──── git push (per story, retry while offline) ────► GitHub remote
```

## 3. Components

### benchd: node daemon (Rust)

A single static binary built with `tokio` and `axum`. It keeps its state on disk in `~/.benchd/`:
- `jobs/<id>.json`: the spec and state;
- `jobs/<id>.log`: the log;
- a `node.json` manifest.

Plain JSON files are enough for one job at a time; SQLite can wait until something needs it.

| Responsibility | Detail |
|---|---|
| Capabilities | At startup and on request, reports OS, arch, CPU, RAM, GPUs and memory (from nvidia-smi, rocm-smi or sysctl), installed combinations (`~/.local/share/*/install.env`), toolchain versions (node, playwright, git) and the benchd version. |
| Queue | FIFO, exclusive. Its states are shown below. |
| Supervisor | Starts the job in its own process group, streams output to the job log, and records exit status. On benchd start it finds jobs marked `running` whose processes are gone and resumes them, re-running the same `run.sh --run-id`. The driver skips finished stories and continues a session that was cut off mid-story. A job that keeps crashing is capped by `max_restarts` and ends `failed`. |
| Conditions gate | Before each job, and each story via the driver: AC power, thermal nominal, no other GPU consumer. Platform adapters are in §6. A failed gate leaves the job `blocked(reason)`, not failed. |
| Memory guard | Stops the job on real pressure, meaning free memory below a floor or swap growth. Each platform gets its own signals. Never on the model server's footprint alone (see interventions.md, 24 Sep). |
| Results | The driver already commits and pushes each story. benchd adds a push retry loop, so commits made while offline are pushed when the network comes back, and it reports `unpushed_commits` in its status. |
| Status API | See §5. |
| Self-update | `PUT /binary` is accepted only when no job is running, or with `force`. It swaps the binary and exits; launchd or systemd restarts it. |

Job states:

```
queued → preparing (install check, preflight) → running{story, since} → done
                                              ↘ blocked{reason} (conditions; retried on a timer)
                                              ↘ failed{reason} | cancelled
```

### bench: controller CLI (Rust)

The CLI reads its node list from `~/.config/bench/nodes.toml`:

```toml
[nodes.quintus]
url = "http://quintus:7717"
[nodes.gruntus]
url = "http://gruntus:7717"
```

Commands:

| Command | What it does |
|---|---|
| `bench nodes` | Capabilities, current job, current story, and conditions for every node, fetched in parallel. An unreachable node shows as `unreachable` and doesn't stop the command. |
| `bench submit --node gruntus --combo qwen38-27b --pack benchmarks/vidi --scope canvas --run-id canvas-pi-01` | Checks the job against the node's capabilities (is the combination installed, is there enough memory), then sends `PUT /jobs/<id>`. |
| `bench status [run-id]` | Job state, stories done, the last acceptance score, and unpushed commits. |
| `bench logs -f <node> <id>` | Follows a job's log over SSE. |
| `bench cancel <node> <id>` | Stops the job's process group. The driver's checkpoint stays, so the job can be resumed later. |
| `bench deploy <node>` | Pushes a new benchd build to the node. |
| `bench results` | `git pull`, then `report.py --compare` across every run. It reads only the git remote; nodes aren't involved. |

### Job payload

The existing harness, unchanged apart from the platform adapters in §6: `benchmarks/spec-bench/harness/run.sh <install-id> --pack … --run-id … --record`, run from a checkout of this repo on the node. The job pins a repo commit, so every node runs the same harness and the same held-out suite.

## 4. Failure handling

| Failure | What happens |
|---|---|
| Controller offline or lost | Nothing on the nodes changes. Results reach git. Another machine's CLI sees the same state. |
| Network down | Jobs keep running. Commits pile up locally and benchd pushes them when the network is back. `status` shows the backlog once the node is reachable again. |
| Node reboot or kernel panic | launchd or systemd starts benchd, benchd resumes the job, and the driver continues from its checkpoint. The panic is recorded in `interventions.md` automatically: benchd notices an unclean shutdown from its `running` marker and the new boot time. |
| Harness crash | Resumed up to `max_restarts`, then `failed`, with the log and the checkpoint kept. |
| Model server crash or refusal | Already handled by the driver's fork-resume. |
| Duplicate submit | Same job id, so the second is a no-op that returns the existing job. |
| Two controllers submit different jobs | Queued FIFO on the node. The node still runs only one at a time. |
| Git push rejected (remote moved) | Rebase and retry. This already exists in `record_story`. |
| Disk full | Preflight checks free space before each story and blocks the job with a reason. |
| Conditions bad (battery, heat, another GPU user) | The job goes to `blocked` and is retried on a timer. It is never started degraded. |
| benchd upgraded mid-run | Refused unless `force`. Otherwise the job is paused and resumed as for a reboot. |

## 5. benchd HTTP API

Bound to the Tailscale or LAN interface, never `0.0.0.0` on a public network. It requires an `Authorization: Bearer <token>` header with a shared token from `~/.benchd/token`: cheap protection against mistakes, not a security boundary.

```
GET  /v1/node                    capabilities + benchd version + conditions now
GET  /v1/jobs                    all jobs, newest first
PUT  /v1/jobs/{id}               submit (idempotent): {combo, pack, scope|stories, run_id, client, repo_commit, record}
GET  /v1/jobs/{id}               state, current story, last gate/accept, unpushed commits
POST /v1/jobs/{id}/cancel
GET  /v1/jobs/{id}/log?follow=1  text/event-stream
GET  /v1/jobs/{id}/events?follow=1  typed harness events (story_start, nudge, resume, refusal, guard_stop, gate, accept, recorded)
POST /v1/runs/{run_id}/preview   {story} → serves the recorded code at that story's commit; returns URL; DELETE to stop
POST /v1/runs/{run_id}/rescore   {stories} → re-run the held-out suite on recorded code (keeps old result, logs intervention)
PUT  /v1/binary                  self-update (refused while running unless ?force=1)
```

## 6. Platform adapters

These are the changes to the harness payload, not to benchd.

| Concern | macOS (quintus, M2) | Linux + NVIDIA (gruntus) | Linux + AMD unified memory (tritus) |
|---|---|---|---|
| Agent sandbox | `sandbox-exec` (today) | `bwrap`: bind the workspace read-write, the toolchain read-only, and don't mount the repo or held-out suites at all | `bwrap`, as for NVIDIA |
| Power | `pmset -g batt` | Desktop, so treat it as always on AC. Record `nvidia-smi` power-limit changes. | Desktop, always on AC |
| Thermal | `thermal.py` (pressure level) | `nvidia-smi --query-gpu=temperature.gpu,clocks_throttle_reasons.active` | `sensors` / `amdgpu` hwmon |
| Memory guard | `memory_pressure` free % + swap growth | `/proc/meminfo` MemAvailable + swap. VRAM from `nvidia-smi`, reported but not a stop signal. | MemAvailable + swap. The GPU carve-out behaves like a Mac's wired memory, so watch free memory. |
| Other GPU users | — | `nvidia-smi --query-compute-apps` must show only the model server | `rocm-smi --showpids` |
| Service | launchd user agent | systemd `--user` unit + `loginctl enable-linger` (sudo, user-run) | same as gruntus |

## 7. Deployment

- **Builds:** `cargo zigbuild`, which gives:
  - `x86_64-unknown-linux-musl` for gruntus and tritus;
  - `aarch64-apple-darwin` for quintus and the M2.
- **`bench deploy <node>`:**
  - the first time, over ssh: copy the binary, write the unit or plist, generate the token, and start the service;
  - after that, through `PUT /v1/binary`.
- **What each node needs, beyond benchd:**
  - a checkout of this repo, with credentials to push to it. Either a per-node deploy key or one fine-grained token; see open question 2.
  - Node ≥ 20 with Playwright's Chromium;
  - the combinations it will run, installed by their own install scripts;
  - uv, until the driver is ported.
- **`benchd doctor`:** checks the requirements above and prints exactly what is missing, so that bringing a new node online is one command plus whatever it lists.

## 8. Plan

These are concrete steps, in order. Each one produces a result that can be checked.

1. **Finish canvas-pi-01 on quintus.** It's the reference result; nothing below should disturb it.
2. **Linux harness by hand on gruntus.**
   - Install Node 20 or later and uv. Add the bwrap sandbox, the NVIDIA conditions and the Linux memory adapters behind a `platform` switch.
   - Get the preflight passing inside bwrap.
   - Run story 1 of one gruntus combination (`qwen38-27b`, llama.cpp) over ssh.
   - **Done when** story 1 is recorded and pushed from gruntus, and the sandbox is shown to deny reads of the repo.
3. **Harness takes over the operator work** listed in §0.5:
   - typed events;
   - the free-% memory guard;
   - automatic intervention entries;
   - a `rescore` command;
   - throughput in `report.py`;
   - suite-defect flags.
4. **benchd MVP.**
   - `/v1/node`, `PUT/GET /v1/jobs`, events and log follow, previews, exclusive run, and resume after restart.
   - The `bench` CLI with nodes, submit, status and logs.
   - Deployed on gruntus and quintus.
   - **Done when** killing benchd, and rebooting gruntus, both resume the job with no manual step.
5. **Resilience.** Push-retry while offline, conditions gating, the memory guard, `deploy` and `doctor`. **Done when** unplugging gruntus's network mid-story loses nothing and the backlog is pushed afterwards.
6. **Bring tritus online** with `bench deploy tritus` and `benchd doctor`.
7. **Port the driver to Rust**, only if steps 2–6 show the Python/uv dependency actually hurts. Port module by module behind the existing tests: clients, gates, then drive.

## 9. Open questions

1. Which combinations should gruntus run?
   - Installed today: `qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode` and the swift variant.
   - The SGLang EXL3 combos written for the 3090 also fit the 4090.
2. Git credentials on the nodes: a deploy key per node (can be revoked one at a time) or one fine-grained token? I'd use per-node deploy keys.
3. tritus doesn't resolve from quintus yet (`ssh tritus` fails). Is it on the tailnet?
4. Should the M2 also be a benchmark node (a low-memory combination), or only a controller?
5. Which model judges quality at the end of a run? A local model changes nothing outside the tailnet. A Claude model is stronger but sends the delivered code to an external API.
