# spec-bench telemetry

What the harness records about every run and story, where it lands, and where it comes from. The
aim is to be able to say *why* a story took as long as it did (model, tools, compaction, the
machine) and not only *how long*.

Keep this file current: [`harness/test_telemetry_doc.py`](harness/test_telemetry_doc.py) fails when
the harness records a field this file does not name. Update the coverage table when a machine starts
or stops producing something.

## Where it lands

Everything is under the run directory,
`combinations/<COMBINATION>/benchmarks/<pack>/<run-id>/` (or `<RUN_BASE>/<run-id>/` for a reference
stack).

| File | Published | What |
|---|---|---|
| `run.json` | yes | the run's configuration, written at each start |
| `metrics.json` | yes | one record per story (the fields below) |
| `run-history.jsonl` | yes | run started / finished / failed / stopped, with the reason; each also pushed as a commit |
| `run-status.json` | yes | the run's current state |
| `progress.json`, `current_story`, `control/` | no (git-ignored) | live state of the current story, for dbench and watchers |
| `summary.md` | yes | the report (`report.py`), ending with *How it happened* (`history.py`): each story's commits and source files changed, which story broke or fixed an earlier story's held-out tests (with the tests and their error), and *Interruptions and dead time*: every machine freeze, harness crash or restart inside a story, how long it was down, the cause logged in `interventions.md`, and each story's active agent time across all its attempts |
| `workspace-git-log.txt` | yes | the agent's commit history |
| `stories/NN/prompt.md`, `base-commit` | yes | what the agent was given, and from which commit |
| `stories/NN/agent-events.compact.jsonl.gz` | yes | the agent's session, stream deltas dropped, long strings cut, home paths redacted |
| `stories/NN/agent-events.jsonl` | no (git-ignored) | the full session as pi streamed it, each line stamped `_rx` on arrival |
| `stories/NN/gate.json`, `accept.json`, `accept-report.json`, `screenshots/`, `artifacts/` | yes | the agent's own checks and the held-out suite |
| `server.log` | no (`*.log` is ignored) | the model server's own log, appended across restarts, each start after a `=== server start <epoch> ===` marker |
| `requests.jsonl` | yes, if present | per-request figures from the Python metering proxy; only with `run.sh --meter` (off by default; it adds a hop) |

dbench keeps its own job log and events (`story_start`, `agent_done`, `scored`, `crash`), attempts,
pull records and failure reasons in `~/.dbench/jobs/` on the node (`dbench status`, `dbench logs`).

## Per run: `run.json`

`install_id`, `combination`, `model_id`, `pack`, `scope`, `backend`, `backend_version`,
`mtplx_memory_limit_bytes` (MTPLX only), `client`, `client_version`, `reasoning_effort`,
`context_limit`, `output_limit`, `compact_at` (the client's compaction threshold), `metered`
(whether the Python proxy was on), `host` (CPU, RAM, GPU), `harness_commit`, `pack_version`,
`started_at`.

## Per story: `metrics.json` → `stories[]`

| Field | What |
|---|---|
| `title`, `status`, `ended_by`, `verdict` | the story, DONE or PARTIAL, whether the agent or an operator ended it, and the operator's verdict on a skip |
| `started`, `agent_finished`, `finished` | epoch seconds: story start, agent done, scoring done |
| `continued_session` | set when a harness restart resumed the agent's own session (the first reply then re-plans: expect one long call) |
| `agent_commits`, `commit`, `loc` | commits the agent made; the story's recorded commit; `files` and `lines` of code |
| `spec_tampered` | the agent edited the spec (it is restored) |
| `tasks`, `partial_base`, `stub_markers`, `partial_heldout_changes` | per-task evidence from the workspace; for a PARTIAL story, what later stories build on |
| `record` | `commit`, `committed`, `pushed`: whether the story reached the repo |

### `agent`: what the agent did (from pi's session events)

`seconds` (wall time of the attempt after the story's last restart only: work before a crash or restart is left out, and so is the dead time; the report's *Interruptions and dead time* gives the active time across every attempt), `steps` (model calls), `tool_calls`, `tool_interruptions`, `compactions`,
`tokens` (`input`, `output`, `reasoning`, `cache_read`, `cache_write`, as the server reported them to
the client), `exit`, `stalled` (the loop detector stopped it), `resumes` (after errors), `nudges`
(after stopping without a commit), `errors`, `ended_by_operator`, `ended_in_error`, `sessions`.

### `time_split`: where the story's wall time went

From the stamped session events and llama-server's own log (no proxy in the request path):

| Field | What |
|---|---|
| `wall_s` | agent start to agent done |
| `model` | the agent's model calls, compaction calls excluded: `requests`, `prefill_s`, `prefill_tokens` (tokens actually processed, i.e. not served from the prompt cache), `prefill_tok_s`, `decode_s`, `decode_tokens`, `decode_tok_s`, `draft_acceptance` (MTP drafts accepted / drafted), `mean_accepted_len` (tokens per verification step, weighted by tokens generated) |
| `tools_s`, `tools_by_kind` | time inside tool calls, by kind: `e2e`, `unit`, `build`, `bash` (other shell), `read`, `edit`, `write` |
| `compaction_s`, `compactions` | time spent compacting the context, including the compaction's own model call |
| `other_s` | the rest: the client's own overhead, and gaps |

`model` is null when there is no llama-server log with a start marker (cloud and MTPLX backends,
and runs before the marker existed). `python3 harness/llama_log.py <server.log> [from to]` prints the
same model summary for any window.

### `requests`: the server's own request log (MTPLX only)

`requests`, `prompt_tokens`, `completion_tokens`, `cached_tokens`, `ttft_median_s`,
`prefill_tok_s_median`, `decode_tok_s_median`, `max_context`, `decode_by_context`.

### `conditions_start`, `conditions`: the machine during the story

Sampled every 30 s (`CONDITION_POLL_S`).

| Field | What |
|---|---|
| `ac`, `low_power`, `thermal` | at the start (`conditions_start`) and in every sample; a story waits until they are fit |
| `samples`, `degraded`, `throttled_share`, `bad_samples` | power trouble marks the story DEGRADED (not comparable); thermal throttling is reported as a share, since that is how the setup really performs |
| `swap_start_gb`, `swap_max_gb`, `aborted_swap` | the swap guard stops the story if swap grows more than 4 GB |
| `free_min_pct`, `aborted_memory` | the memory guard stops it below 8% free |
| `server_footprint_max_gb`, `server_footprint_peak_gb` | the model server's memory |
| `gpu` | the GPU, summarised: `samples`, `busy_mean_pct`, `sclk_min_busy_mhz` (the lowest shader clock while more than 50% busy: a drop here is throttling, not idling), `sclk_max_mhz`, `power_mean_w`, `power_max_w`, `temp_max_c`, `gtt_max_gb` (amdgpu: unified memory mapped for the GPU) or `vram_max_gb` (NVIDIA), `throttled_samples` (NVIDIA's clock throttle reasons) |

### `gate`: the agent's own checks

Run after the agent finishes, in the workspace, against the agent's own browsers: `steps` (per npm
script: `cmd`, `exit`, `seconds`, `passed`, `failed`, `tail`; `browser_install` if the gate had to
fetch a browser), `all_green`, `harness_fault`.

### `accept`: the held-out suite

`skipped` (the pack has none: n/a, not 0/0), `build_exit`, `runner_exit`, `runner_tail`, `passed`,
`total`, `on_partial` (tests built on PARTIAL stories), `by_story`, `harness_fault`, and `tests`
(per test, in `accept.json` only).

A `harness_fault` (`missing resources: …`) means the machine couldn't run the tests: the story's
scores are void and the run stops with exit 3, which dbench reports without restarting.

## Coverage by machine

| | tritus (Strix Halo, llama.cpp, Vulkan) | gruntus (RTX 4090, llama.cpp) | quintus (Mac, MTPLX) |
|---|---|---|---|
| agent, gate, accept, conditions | all runs | all runs | all runs |
| `time_split.model` | canvas-vk-01 from story 7 (dbench job canvas-vk-01g, harness 5b17d48, 26 Sep 08:45 UTC); stories 1–5 have none | canvas-pi-04 and later jobs; canvas-pi-03 can be backfilled (see below) | no: `requests` instead |
| `time_split` tools and compaction | as above | as above | canvas-pi-03 (harness 61ac40e) and later |
| `conditions.gpu` | as above, from sysfs | as above, from `nvidia-smi` | no (needs `powermetrics`, which needs root) |

A server log without a start marker (before 0ef8480) can still be read by prepending a marker with
the server's start time, which is the log file's creation time (`stat -c %W server.log`).

## Not captured yet

- **Context per request** on llama.cpp: the server log gives prefill tokens processed, not the total
  context. pi's per-call usage has it, by time; the join is not built.
- **MTP acceptance by draft position**: llama.cpp prints it only at trace verbosity. This decides
  whether draft depth 4 beats 3.
- **CPU load and memory bandwidth**, which compete with the GPU on unified memory.
- **Energy**: 30 s power samples are too coarse to integrate, and gruntus's driver has no energy
  counter.
- **Power comparability**: the 4090 reports board power; whether amdgpu's `power1_average` on Strix
  Halo is the GPU alone or the whole package is unverified. Compare throttling, not watts, across
  machines.
