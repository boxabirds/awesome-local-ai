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
| `run.json` | yes | the run's configuration, written at each start (the previous one is kept in `run-history.jsonl`) |
| `metrics.json` | yes | one record per story (the fields below) |
| `run-history.jsonl` | yes | every earlier `run.json`, one line per start: run.sh appends the old one before it writes the new, so a restart never loses what an earlier start ran (`provenance.py` reads it) |
| `run-status.json` | yes | the run's current state, and `host`: the machine's hardware (`host-desc.sh`), never its hostname |
| `progress.json`, `current_story`, `control/` | no (git-ignored) | live state of the current story, for dbench and watchers |
| `summary.md` | yes | the report (`report.py`), ending with *How it happened* (`history.py`): each story's commits and source files changed, how many of an earlier story's held-out tests each story broke or fixed (counts only; the tests and their errors are in the git-ignored `summary-detail.md`), and *Interruptions and dead time*: every machine freeze, harness crash or restart inside a story, how long it was down, the cause logged in `interventions.md`, and each story's active agent time across all its attempts |
| `workspace-git-log.txt` | yes | the agent's commit history |
| `stories/NN/prompt.md`, `base-commit` | yes | what the agent was given, and from which commit |
| `stories/NN/agent-events.compact.jsonl.gz` | yes | the agent's session, lossless: every event line exactly as the agent wrote it, home paths redacted, nothing cut; only the stream deltas (`message_update`, `tool_execution_update`) are dropped, except the first `message_update` of each model call, whose arrival is when prefill ended (`accounting.py` times prefill and decode by it). A restarted story's log also holds a `harness_attempt` line where each restart began (`attempt`, `harness_commit`, `pack_version`). About 1/40 of the full log (a 30.9 MB story: 0.7 MB). Its own size cap is 50 MB (GitHub warns over 50 MB and refuses over 100 MB); past it strings are cut and a first `harness_log_cut` line says so. Logs committed before 30 Sep 2026 cut strings at 2,000 characters (down to 80 over 512 KB) and have no deltas: `backfill_timing.py` rebuilds them from the full log where the machine kept it |
| `stories/NN/agent-events.jsonl` | no (git-ignored) | the full session as pi streamed it, each line stamped `_rx` on arrival |
| `stories/NN/gate.json` | yes | the agent's own checks |
| `stories/NN/accept-summary.json` (and `accept-final-summary.json`) | yes | the held-out result's counts: passed, total, per story, fallbacks, fault; never a test, its title or its output |
| `stories/NN/accept.json`, `accept-report.json`, `screenshots/`, `artifacts/`, `scoring-N/`; `accept-final.json`; `AUDIT.md`, `audit.jsonl`; `heldout-detail.json`, `summary-detail.md` | **no, never** (git-ignored; `publicise.py`) | the held-out suite's detail. Kept on the machine and copied to the private repo under `runs/<run path>/`; tools that need it read it there (`heldout.find`). The harness refuses any commit whose files carry a held-out test title |
| `finalize.json` | yes | the end of the run (`finalize.py`): its bundle and its score of record, or why there is none (below) |
| `workspace.bundle` | yes | the workspace's whole git history, from which every story's code is re-scored and reviewed |
| `rescore/<version>/rescore.json`, `per-story.md`, `stories/NN/accept-summary.json` | yes | a re-score under suite `<version>` (`rescore.py`; below); its `stories/NN/accept.json` and `scoring-N/` are held-out detail, private like the live ones |
| `rescore-spoiled/<version>-<UTC time>/` | yes (its detail private, as above) | a re-score that was not recorded: the machine spoiled it or the live-vs-record guard flagged it; `set-aside.json` says why (`reason`, `at`). The next finalize re-scores |
| `base/accept-summary.json` | yes, known-good runs only | the held-out suite's counts on the base before the agent starts, so the story's regressions and repairs are measured |
| `server.log` | no (`*.log` is ignored) | the model server's own log, appended across restarts, each start after a `=== server start <epoch> ===` marker |
| `requests.jsonl` | yes, if present | per-request figures from the Python metering proxy; only with `run.sh --meter` (off by default; it adds a hop) |

dbench keeps its own job log and events (`story_start`, `agent_done`, `scored`, `crash`), attempts,
pull records and failure reasons in `~/.dbench/jobs/` on the node (`dbench status`, `dbench logs`).

## Per run: `run.json`

`install_id`, `combination`, `model_id`, `pack`, `scope`, `backend`, `backend_version`,
`mtplx_memory_limit_bytes` (MTPLX only), `client`, `client_version`, `reasoning_effort` (what the
harness passed to the server launcher; a server without server-side effort, such as mlx-serve, ignores
it), `client_thinking` (the effort pi itself sends with each request, empty when it sends none),
`known_good_from` (known-good mode's reference run, empty for a full run), `context_limit`, `output_limit`, `compact_at` (the client's compaction threshold), `metered`
(whether the Python proxy was on), `host` (CPU, RAM, GPU), `harness_commit`, `pack_version`,
`started_at`, `identity`, `engine_settings`.

`identity` is what the start actually ran, from [`harness/identity.py`](harness/identity.py), so runs can
be compared as variations over time: `backend`; `install_manifest` (every setting in the install's
`install.env`: engine settings, sampling, draft method and depth, model file names, pinned images and
versions); `server_command` (the engine's own command line, `$HOME` written as `~` and keys masked: when
the port's listener is a container's network helper (Podman's pasta, slirp4netns, rootlessport, conmon;
docker-proxy), the process inside that container, from `podman inspect` / `docker inspect` of the
launcher's `<install id>-<port>` container, else the container publishing the port; null when neither
is found); `engine_version` (what the engine prints for `--version`: inside its container for gufo, of
`mtplx` rather than the Python interpreter MTPLX's server runs in, e.g. llama.cpp's commit);
`listener_command` (the host process on the port when it isn't the engine, e.g. pasta; else null);
`container` (`runtime`, `name`, `image` of the engine's container; else null);
`model_files` (per model file: `role`, `name`, `bytes`, and the Hugging Face `revision` and `sha256`
saved when it was downloaded, or a pinned directory's verified revision); `drivers` (NVIDIA driver,
Linux kernel); `os`. Anything it can't find is null; it never stops a run. Runs before 29 Sep 2026 have
no `identity`. Runs before 30 Sep 2026 have gufo's `server_command` and `engine_version` as pasta's
(Podman's network helper), not gufo's, and MTPLX's `engine_version` as its Python interpreter's.

`engine_settings` is what the engine actually applies, read from `identity.server_command` by
[`harness/engine_settings.py`](harness/engine_settings.py) (llama.cpp, gufo, mlx-serve, MTPLX; any other
backend, a cloud one, or a command line that isn't the engine's own process gets every setting
`unknown` with the reason). `engine` and `engine_version`, then one entry per setting:
`thinking_mode` (the chat template's thinking mode: `on`/`off`), `thinking_budget` (tokens),
`context_size`, `kv_cache_type` (`{k, v}` on llama.cpp), `speculative` (`method`, and where set
`draft_max`, `p_min`, `draft_quantisation`, `depth`), `temperature`, `top_p`, `top_k`, `min_p`,
`quantisation` (from the model file's name). Each entry is `{value, source, evidence}`; `source` is one
of `command line`, `model file name`, `model config` (mlx-serve's served `generation_config.json`),
`client`, `not set` (nothing sets it; the value is `not set` and the evidence says what applies then),
or `unknown` (the value is `unknown` and the evidence says why). No value is inferred from an engine's
defaults.

`reasoning_effort` separates what was asked from what was applied: `requested` (what the harness passed
to the launcher, the old top-level `reasoning_effort`), `engine` (the effort on the engine's command line),
`client` (what the client sends per request: pi's `--thinking`, from `client_thinking`), `effective` (the
client's if it sends one, else `thinking off` when thinking is off, else the engine's, else `unknown`), and
`matches_request` (true, false, or null when the effective effort is unknown). `gaps` lists, in words,
where what was asked is not what the engine was given (effort; context against `context_limit`). The
record is written at every start, so a restart mid-run records its own; `engine_settings.for_story()`
gives a story the settings of the start it ran under, stamped `server_started_at`. Runs before 30 Sep
2026 have no `engine_settings`.

## Per run: `metrics.json` top level

`processed` (the stories processed so far, in order, each with its `status` and `ended_by`), and for a
known-good run (EVALUATION-POLICY rule 7) `known_good`: `from_run` (the reference run), `commit` (its
code when the story before ended, the workspace's starting point), `story` (the one story run) and
`spec_updated` (the reference predates this pack's spec, so the base got the current spec in a harness
commit). A
known-good run's earlier stories are in `processed` with `ended_by` "known-good base"; progress
baselines and the review tool leave these runs out.

## Per story: `metrics.json` → `stories[]`

| Field | What |
|---|---|
| `title`, `status`, `ended_by`, `verdict` | the story, DONE or PARTIAL, whether the agent or an operator ended it, and the operator's verdict on a skip |
| `started`, `agent_finished`, `finished` | epoch seconds: story start, agent done, scoring done |
| `continued_session` | set when a harness restart resumed the agent's own session (the first reply then re-plans: expect one long call) |
| `first_started` | a restarted story only: when its first attempt started (its first logged event). `started` stays the last attempt's start |
| `provenance` | what the story ran under: `harness_commit` (HEAD when this harness process started, as `run.json` records it; the harness's code is loaded once per process), `harness_dirty` (the harness had uncommitted edits), `pack_version` (`pack-version.sh` when the story was scored, so a suite checkout moved mid-run is caught), `started_under` (the `pack_version`, and in a backfill the `harness_commit`, at the story's start when they differ from its scoring), `source` (`drive`: recorded live; `run-history`: backfilled from the start that was current when the agent finished, with its `run_started_at`) |
| `time_split_covers` | `last attempt`: a restarted story recomputed from an old published log (cut strings, no deltas), whose `time_split` could not be redone over every attempt |
| `agent_commits`, `commit`, `loc` | commits the agent made; the story's recorded commit; `files` and `lines` of code |
| `spec_tampered` | the agent edited the spec (it is restored) |
| `tasks`, `partial_base`, `stub_markers`, `partial_heldout_changes` | per-task evidence from the workspace; for a PARTIAL story, what later stories build on |
| `record` | `commit`, `committed`, `pushed`: whether the story reached the repo |

### `agent`: what the agent did (from pi's session events)

`seconds` (the agent's time over every attempt of the story: summed per attempt, so the time the harness was down between attempts is left out; records before 30 Sep 2026 counted only the last attempt until backfilled), `steps` (model calls), `tool_calls`, `tool_interruptions`, `compactions`,
`tokens` (`input`, `output`, `reasoning`, `cache_read`, `cache_write`, as the server reported them to
the client), `exit`, `stalled` (the loop detector stopped it), `resumes` (after errors), `nudges`
(after stopping without a commit), `toolcall_text_resumes` (continuations after the session ended on a
tool call the engine returned as text instead of running it; see gufo-org/gufo#304), `errors`, `ended_by_operator`, `ended_in_error`, `sessions`.

Claude Code reports `tokens` per `result` event, one per stretch of a session (a session can end in more than one),
and they are added. Until 30 Sep 2026 each overwrote the last, so a story ending in two kept only the second
(Opus v2-r3 story 12: 1,230 output tokens recorded against 91,850). `recount_tokens.py` rebuilds a story's `tokens`
from its event log; a record it changed has `tokens_recounted`: `previous` (what was there), `from` (the log it
read) and `at`.

A story the harness restarted mid-way (`harness/attempts.py`, tests: `test_attempts.py`) has these as totals over
every attempt, how it ended (`exit`, `stalled`, `ended_in_error`) from the last, and also `restarted` (true),
`harness_attempts` (how many), and `attempts`: per attempt, `attempt` (1-based), `source` (`harness`: the harness's
own record of the attempt it ran; `log`: an earlier attempt counted from the story's event log), `started`, `ended`,
`seconds`, `steps`, `tool_calls`, `compactions`, `tokens`, `sessions`, the resume and nudge counts where the harness
kept them, and its own `time_split`. An attempt is one harness process: nudges and resumes within it are not
attempts. Earlier attempts are told apart by the log's `harness_attempt` lines, else by run.sh's start times. A story
run once has none of these fields. `backfill_timing.py` recomputes past records (canvas-gufo-r3 story 5: recorded
at 18 minutes and 27 tool calls, 88 minutes and 284 over its two attempts).

### `time_split`: where the story's wall time went

`harness/accounting.py` (tests: `test_accounting.py`). The story's window, agent start to agent done, is laid out
as one timeline and every second has exactly one owner: a compaction, a tool call, the model's prefill, its
decode, the wait between the agent's sessions, or other. Where things overlap the higher owns the second
(compaction > tool > prefill > decode > between sessions), and
anything outside the window doesn't count. So the parts never overlap,
never go negative, and always sum to `wall_s`. A restarted story's split is one per attempt, over that attempt's own
window, summed (`attempts`: how many; rates are tokens over the summed raw seconds; a problem names its attempt);
the time the harness was down between attempts belongs to no attempt and isn't counted.

| Field | What |
|---|---|
| `wall_s` | agent start to agent done |
| `model` | the agent's model calls: `source` (`llama-log`: llama-server's own log, used when it has requests in the window; `client-stream`: the agent's own streamed events, request sent, first chunk, last chunk, which match the server's log to within 0.5% where both exist), `requests`, `prefill_s` and `decode_s` (the seconds each owns on the timeline), `prefill_tokens` (tokens actually processed, not served from the prompt cache), `cached_tokens`, `prefill_tok_s` and `decode_tok_s` (from the counted calls' own durations), `decode_tokens`, `draft_acceptance` (MTP drafts accepted / drafted), `mean_accepted_len` (tokens per verification step, weighted by tokens generated). A call is counted in `requests`, tokens and rates when it lies wholly inside the window and isn't a compaction's own call |
| `tools_s`, `tools_by_kind` | time inside tool calls, by kind: `e2e`, `unit`, `build` (the agent's own tests and builds), `bash` (any other shell command), `read`, `edit`, `write` |
| `compaction_s`, `compactions` | time spent compacting the context, including the compaction's own model call |
| `between_sessions_s` | from the end of one agent session to the start of the next: the harness resuming the agent after its session ended in an error (it waits 60 s first) or nudging it after it stopped without committing. The agent's own clock (`agent.seconds`) runs only while a session does |
| `other_s` | the rest: the client's own overhead, and gaps |
| `accounting` | the checks recorded with the split: `version` of the calculation, `ok`, `problems` (a tool call or compaction that never ended or ended without starting, parts not summing to the wall, tools by kind not summing to tools, the wall disagreeing with the agent's own clock plus the time between sessions by more than 1%), `abandoned_calls` (model calls cut off before they ended: a session killed mid-reply) |

`model` is null when neither source has a model call: a cloud model (Claude Code logs no stream), or a record
made before the accounting timed every engine and not yet backfilled. `harness/backfill_timing.py` recomputes a
finished run's splits with the current calculation from the full event logs its machine kept.
`python3 harness/llama_log.py <server.log> [from to]` prints llama-server's own summary for any window.

### `conversation`: what the agent's conversation looked like

`harness/conversation.py` (tests: `test_conversation.py`), counted from the story's event log inside its window
(from `first_started` for a restarted story, so every attempt counts);
no LLM. Null when the log has no receive stamps (runs before the harness stamped them) or no model call pi logged
(Claude Code runs).

| Field | What |
|---|---|
| `calls`, `tool_calls` | model calls, and the tool calls they made |
| `thinking_chars`, `text_chars`, `tool_arg_chars` | characters of reasoning, of reply text, and of tool arguments (file contents written, edits, commands) |
| `thinking_median`, `thinking_median_before`, `thinking_median_after` | median reasoning characters per call; and before and after the largest block (null when there is nothing on that side) |
| `largest_thinking` | the longest reasoning block: `chars`, `call` (1-based), `at_s` (seconds into the story) |
| `context_start`, `context_end`, `largest_context_jump` | what the model read on its first and last call (fresh plus cached tokens), and the largest growth between two consecutive calls (`tokens`, `call`) |
| `tools_by_name`, `tool_errors` | tool calls by tool, and results marked as errors |
| `longest_tool` | the longest tool call: `seconds`, `name`, `gist` (its command or path); one that never ended runs to the story's end |
| `signals` | signs abnormal on any stack: `hung-command` (a single tool call of 600 s or more). A long thinking block is not one: its normal size differs by combination (median largest block 10.6k characters for gufo, 30.5k for Swift 1.5, 38.9k for mlx-serve), so it is judged against the same story in the combination's other runs |

`backfill_timing.py` fills it for past stories from the full logs each machine keeps.

### `requests`: the server's own request log (MTPLX only)

`requests`, `prompt_tokens`, `completion_tokens`, `cached_tokens`, `ttft_median_s`,
`prefill_tok_s_median`, `decode_tok_s_median`, `max_context`, `decode_by_context`; over every attempt's window
of a restarted story.

### `conditions_start`, `conditions`: the machine during the story

Sampled every 30 s (`CONDITION_POLL_S`).

| Field | What |
|---|---|
| `ac`, `low_power`, `thermal` | at the start (`conditions_start`) and in every sample; a story waits until they are fit |
| `samples`, `degraded`, `throttled_share`, `bad_samples` | power trouble marks the story DEGRADED (not comparable); thermal throttling is reported as a share, since that is how the setup really performs |
| `swap_start_gb`, `swap_max_gb`, `aborted_swap` | the swap guard stops the story if swap grows more than 4 GB |
| `free_min_pct`, `aborted_memory` | the memory guard stops it below 8% free |
| `containment` | Linux with a systemd user manager: the story's agent sessions ran in their own scopes (tools/agent-containment/PROPOSAL.md). `enabled`, `units`, `memory_max_gb` (the agent's limit: memory available at the session's start less a reserve), `memory_peak_gb`, `left_at_story_end` (processes killed with the scope) and `reaped`: each process killed during the story (`pid`, `comm`, `age_s`, `rss_gb`, `rule`: `interrupted` when the hang guard cut its tool call off, `memory pressure` for an orphan past the grace period while free memory was below 30%). `{"enabled": false}` on macOS |
| `outside_workspace` | written at finalize by `harness/logscan.py` from the story's agent log, on the machine that ran it: whether the agent's own tool calls reached outside its workspace for anything that could give it answers (reference builds, other runs' workspaces or `/tmp` leftovers, the held-out suite, clones of this repo, this repo on GitHub). `version`, `ok` (true, false, or null with no readable log), `log` (file and format read), `truncated` (a clean verdict from a truncated log is weaker), `reaches` (`route`, `target`, `calls`, `example`). The run's summary goes in `finalize.json` and a reach is named in the record's message |
| `engine_settings` | the engine settings of the server start this story ran under (`engine_settings.for_story`: run.json's `engine_settings`, stamped `server_started_at`); null when the run records none |
| `memory_snapshot` | what held memory at the story's lowest point, once free memory fell below 20%: `t`, `free_pct`, `total_rss_gb`, `processes` (the 15 largest: `pid`, `rss_gb`, `command` with home paths and keys hidden) and `by_program` (totals per program: `program`, `count`, `rss_gb`). Null when memory never ran that low |
| `server_footprint_max_gb`, `server_footprint_peak_gb` | the model server's memory |
| `gpu` | the GPU, summarised: `samples`, `busy_mean_pct`, `sclk_min_busy_mhz` (the lowest shader clock while more than 50% busy: a drop here is throttling, not idling), `sclk_max_mhz`, `power_mean_w`, `power_max_w`, `temp_max_c`, `gtt_max_gb` (amdgpu: unified memory mapped for the GPU) or `vram_max_gb` (NVIDIA), `throttled_samples` (NVIDIA's clock throttle reasons) |

### `gate`: the agent's own checks

Run after the agent finishes, in the workspace, against the agent's own browsers: `steps` (per npm
script: `cmd`, `exit`, `seconds`, `passed`, `failed`, `tail`; `browser_install` if the gate had to
fetch a browser), `all_green`, `harness_fault`.

### `accept`: the held-out suite

`skipped` (the pack has none: n/a, not 0/0), `build_exit`, `runner_exit`, `runner_tail`, `passed`,
`total`, `on_partial` (tests built on PARTIAL stories), `by_story`, `setup_fallbacks` (from pack
vidi-v1.2: `tests` whose setup fell back to the documented flow, and their count `by_owner`, the story
that owns the behaviour; EVALUATION-POLICY rule 8), `harness_fault`; and, in the private copy only, `runner_tail`
and `tests` (per test, each with its own `setup_fallbacks` list). The public `metrics.json` keeps the counts;
the rest is in the git-ignored `heldout-detail.json` beside it.

Also `environment`: what the scoring ran on (`scoring_env.py`): `node`, `npm`, `playwright` (the held-out suite's
own), `chromium` (the build it launches, `<version> (r<revision>)`), `os`, `arch`, `workers` (held-out workers,
`ACCEPT_WORKERS`); a re-score adds `install_command`. And `build_tail`, the build's last output, when it failed.
Both are kept in the private copy only.

A `harness_fault` (`missing resources: …`, `scoring interrupted: …`) means the machine couldn't run the tests: the
story's scores are void and the run stops with exit 3, which dbench reports without restarting. Among the causes: no
browser; the runner killed or crashed before it wrote a report; a scoring port held by another process, before the
suite starts or while it waits for one (`waitPortFree`).

## Re-scores and the score of record

`finalize.py` ends every run: it bundles the workspace, re-scores its final commit (`rescore.py --final`) on a clean
install, and records the result as the score of record unless the re-score is spoiled or flagged.

**`rescore/<version>/rescore.json`**: `pack_version`, `harness_commit`, `host` (the scorer's hardware, as `run.json` names a
machine; never its hostname: records written before 1 Oct 2026 carried the hostname and were rewritten), `held_out_workers`, `host_limits`,
`finished_at`, `environment` (as above, for the scorer), `passing_sample` (`fraction`, `min`: the rule below), and
`results`, one per checkpoint: `story`, `passed`, `total`, `fallbacks`, `scores` (each scoring's passed count),
`flaky` (tests whose result changed between scorings), `flaky_failing` (of those, failed the first time),
`flaky_passing` (passed the first time), `passing_sampled` (passing tests rerun), `harness_fault`, `build_exit`,
`environment` (with `install_command`), `seconds`. Counts only: no test is named in it.

Each checkpoint's `stories/NN/accept.json` (private) holds the result as under `accept`, and, after repeats,
`scorings`, `scores`, `flaky`, `flaky_failing`, `flaky_passing` (as lists of tests), `passing_sampled`, `sample_seed`
(the checkpoint's commit: the same code gets the same sample), each test's `statuses`, and `install` (`ok`,
`command`, `fallback`, `error`).

Every checkpoint is scored three times: the tests that failed, and a sample of those that passed (a fifth, at least
5), are rerun twice without a rebuild, and each rerun test takes its majority result. Rerunning only the failures
made a test passing half the time count as passing 62.5% of the time; a sampled one counts as a majority of three
would (`rescore.py`, `PASSING_SAMPLE_FRACTION`).

A checkpoint is a harness fault, not a score, when its dependencies don't install from its own lockfile with the
workspace's package manager (no `package.json`, no lockfile, or the install refused: npm gets one fallback,
`--legacy-peer-deps`; bun none), when its build fails in the re-score where the live build of the same commit
passed (or there is no live build to compare), or when a repeat scoring was spoiled.

**`finalize.json`**: `version`, `pack_ref`, `at`, `bundle`, `rescore` (`done`, `skipped`, `failed`: the machine
spoiled it, or `flagged`: the guard stopped it), `reason`, `score` (only when `done`), and `guard`, the live-vs-record
check: `story`, `record` and `live` (passed/total), `live_version` (the suite the live score ran under: the story's
own `pack_version`, else run.json's), `comparable` (same suite version, or unknown), `difference` (record minus
live), `threshold` (`DIVERGENCE_TESTS`, 3), `failures`, `one_signature` (every failure has one cause, across at
least two stories and five failures), `live_same_signature`, `flagged` (why, or null). A flagged re-score is set
aside in `rescore-spoiled/` and the run stays unscored, its live score shown in the record message.

## Coverage by machine

| | Strix Halo (llama.cpp, Vulkan) | RTX 4090 (llama.cpp) | M5 Max (Mac, MTPLX) |
|---|---|---|---|
| agent, gate, accept, conditions | all runs | all runs | all runs |
| `time_split.model` | canvas-vk-01 from story 7 (dbench job canvas-vk-01g, harness 5b17d48, 26 Sep 08:45 UTC); stories 1–5 have none | canvas-pi-04 and later jobs; canvas-pi-03 can be backfilled (see below) | no: `requests` instead |
| `time_split` tools and compaction | as above | as above | canvas-pi-03 (harness 61ac40e) and later |
| `conditions.gpu` | as above, from sysfs | as above, from `nvidia-smi` | no (needs `powermetrics`, which needs root) |
| lossless conversation log, every attempt counted, per-story `provenance` | runs started on the harness that adds them (30 Sep 2026) and later; earlier runs after `backfill_timing.py` (the log rebuild needs the machine's full logs) | as Strix Halo | as Strix Halo |

A server log without a start marker (before 0ef8480) can still be read by prepending a marker with
the server's start time, which is the log file's creation time (`stat -c %W server.log`).

## Not captured yet

- **Context per request** on llama.cpp: the server log gives prefill tokens processed, not the total
  context. pi's per-call usage has it, by time; the join is not built.
- **MTP acceptance by draft position**: llama.cpp prints it only at trace verbosity. This decides
  whether draft depth 4 beats 3.
- **CPU load and memory bandwidth**, which compete with the GPU on unified memory.
- **Energy**: 30 s power samples are too coarse to integrate, and the RTX 4090 machine's driver has no energy
  counter.
- **Power comparability**: the 4090 reports board power; whether amdgpu's `power1_average` on Strix
  Halo is the GPU alone or the whole package is unverified. Compare throttling, not watts, across
  machines.
