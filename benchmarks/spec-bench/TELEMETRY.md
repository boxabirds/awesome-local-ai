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
| `rescore-spoiled/<version>-<UTC time>/` | yes (its detail private, as above) | a re-score that was not recorded: the machine spoiled it, the live-vs-record guard flagged it, or the run went on after it (it scored an earlier checkpoint); `set-aside.json` says why (`reason`, `at`). The next finalize, or the sweep, re-scores |
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
(whether the Python proxy was on), `host` (CPU, RAM, GPU), `harness_commit`, `harness_release`, `pack_version`,
`started_at`, `identity`, `engine_settings`.

`harness_commit` and `harness_release` name the harness code this start ran ([`harness/roots.py`](harness/roots.py)).
A benchmark node runs the harness of the latest release: dbench materialises the newest `harness-vYYYY.MM.DD.n` tag
on main as a directory of its own and runs it with `SPEC_BENCH_RESULTS_ROOT` naming the node's checkout, where the
run is written, committed and pushed. `harness_release` is then that tag and `harness_commit` the commit it tags.
Run from a checkout (a developer's `run.sh`, or a node started with `--allow-unreleased` before any release exists),
`harness_release` is null and `harness_commit` is the checkout's HEAD, which may never have passed the release checks.
Run records from before 1 Oct 2026 have no `harness_release`: all of them ran from a checkout.

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
| `provenance` | what the story ran under: `harness_commit` (HEAD when this harness process started, as `run.json` records it; the harness's code is loaded once per process), `harness_dirty` (the harness had uncommitted edits; null for a release, whose files are made from the tag and not compared with it again), `harness_release` (the release tag the harness ran from, `harness-vYYYY.MM.DD.n`; null when it ran from a checkout, i.e. unreleased code; absent in stories recorded before 1 Oct 2026), `pack_version` (`pack-version.sh` when the story was scored, so a suite checkout moved mid-run is caught), `started_under` (the `pack_version`, and in a backfill the `harness_commit`, at the story's start when they differ from its scoring), `source` (`drive`: recorded live; `run-history`: backfilled from the start that was current when the agent finished, with its `run_started_at`) |
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
| `suspended_s` | of the wall, how long the machine was suspended (asleep) while a session ran. Not a part beside the others: these seconds are inside them, owned by whatever was running when the machine stopped (the log can't say where in the session they lie), so the parts sum to `wall_s` with or without it. The wall clock goes on through a suspension; the agent's own clock (`agent.seconds`) and Claude Code's (its result's `duration_ms`) stop. It is each session's length on the wall less its length by Claude Code's clock, where that is 1 s or more (over 94 recorded sessions the two differ by 0.16 s at most; Sonnet 5.5 v2-r4 story 4, its lid closed mid-session, by 30.8 s). pi's log has no clock of its own, so a pi story is always 0.0 here. Absent from records made before accounting version 4: read as 0 |
| `accounting` | the checks recorded with the split: `version` of the calculation, `ok`, `problems` (what makes `ok` false: a tool call that ended without starting, parts not summing to the wall, tools by kind not summing to tools, `suspended_s` negative or more than the wall, and the clock check below), `abandoned_calls` (model calls cut off before they ended: a session killed mid-reply), and what was cut off, which is information and leaves `ok` true: `interrupted_tools` (each tool call with no end event: its `kind`, its `seconds` inside the window, `ended_by`, and in a restarted story's summed split its `attempt`) and `interrupted_compactions` (how many compactions had no end event) |

A tool call has no end event when something cut it off: the hang guard or the swap guard killing it, its session
ending, the harness restarting, the story's cap. `ended_by` names what showed it was over: `the agent's next step`
or `its session's end` (counted to there); `a harness restart` (the log's `harness_attempt` line) or `the next
session's start` (a new agent process: the call is counted to the last line the process before it wrote, when it
was last heard from); else `the window's end`. It is listed in the window it started in, so once for a restarted
story, and owns nothing after the restart. A compaction with no end event ends the same way at a restart or a new
session, else at the window's end. A session with no end (its process died) ended when it was last heard from, and
the wait until the harness started the next one is `between_sessions_s`, except across a `harness_attempt` line,
where the harness itself was down. Until version 4 a call or compaction with no end was a problem and failed the
check, a call cut off by a restart was reported by both attempts and owned the next attempt's first seconds, and
the wait after a session that died was `other_s`.

The clock check: `wall_s` against `agent.seconds` + `between_sessions_s` + `suspended_s`, which must agree within
1% of the wall (or 1 s). It fails one of two ways, and says which: the agent's clock is more than the wall (agent
time was counted twice: mlx-serve v2-r2 story 4 counted an earlier attempt's waits twice), or the wall is longer
than the agent's clock (the machine was suspended with nothing in the log to show it, which is how a pi story on a
machine that slept reads, or agent time is missing from the record).

`version` is `accounting.VERSION`, and changes with the calculation: `test_accounting.py` keeps a digest of the
calculation's output for the fixture logs (`harness/fixtures/accounting`) per version (`accounting.DIGESTS`) and
fails when the output changes under the same version. Version 3 covered several calculations (the waits between
sessions, Claude Code's stream and the kinds that round to zero all changed under it); 4 is the calculation above.

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
| `harness_faults` | present only when a step of the harness's own bookkeeping failed for this story (`drive.derived`): each `step` ("time split", "conversation profile", "reply check", "summary", "record", …), `error` and `where` (file:line). The story was still scored, committed and recorded; the field that step fills is null or empty, each fault is also in the run's interventions, and `backfill_timing.py` can fill the time split and profile afterwards from the logs |
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

`finalize.py` ends every run: it bundles the workspace, brings the run's own records up to date, re-scores its final
commit (`rescore.py --final`) on a clean install, and records the result as the score of record unless the re-score
is spoiled or flagged. The suite it scores with is the one at the pack's tag (`pack_ref`), taken from the private
repo's git objects and kept on the machine (`tagsuite.py`): where the private checkout is (on a branch, past the tag,
detached, dirty) changes nothing, and the version recorded is the tag that was scored. The live score of each story
during a run still comes from the checkout's working tree, under the version `pack-version.sh` gives it.

A run that ends without its score is retried with nobody asking: `finalize_pending.py` (the sweep) runs at the start
of every run on the machine, after the self-test and before the model server, and again at the end. It takes the
runs under the results root that ran on this machine, ended (`run-status.json`: `finished`, `failed` or `stopped`,
with at least one story's code recorded), are not marked `invalid` in `run.json`, and either have no score of record
and don't need a person, or have stale records with their full logs still here; the most recent first, at most
`SWEEP_MAX_RUNS` (3) a sweep, within `SWEEP_BUDGET_S` (900 s), and never while another harness run or re-score is
active on the machine. `finalize_pending.py --list` shows what is pending and what is waiting for a person.

**`rescore/<version>/rescore.json`**: `pack_version`, `suite_commit` (the commit of the pack's tag the suite was taken
from; null for a pack with no `pack_ref`, scored from its working tree), `harness_commit`, `host` (the scorer's hardware, as `run.json` names a
machine; never its hostname: records written before 1 Oct 2026 carried the hostname and were rewritten), `held_out_workers`, `host_limits`,
`finished_at`, `environment` (as above, for the scorer), `passing_sample` (`fraction`, `min`: the rule below), and
`results`, one per checkpoint: `story`, `passed`, `total`, `fallbacks`, `scores` (each scoring's passed count),
`flaky` (tests whose result changed between scorings), `flaky_failing` (of those, failed the first time),
`flaky_passing` (passed the first time), `passing_sampled` (passing tests rerun), `harness_fault`, `build_exit`,
`environment` (with `install_command`), `seconds`, `commit` (the workspace commit that was scored: finalize tells a
score of the run's final build from one of an earlier checkpoint by it). Counts only: no test is named in it.

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

**`finalize.json`**: `version` (the suite version scored under: the pack's tag), `pack_ref`, `at`, `bundle`,
`rescore` (`done`; `failed`: no score this time; `flagged`: the guard stopped it. Records from before 1 Oct 2026 may
say `skipped`, when the suite checkout was not exactly at its tag: that state no longer exists, and the sweep
re-scores those runs), `reason`, `score` (only when `done`), and `guard`, the live-vs-record
check: `story`, `record` and `live` (passed/total), `live_version` (the suite the live score ran under: the story's
own `pack_version`, else run.json's), `comparable` (same suite version, or unknown), `difference` (record minus
live), `threshold` (`DIVERGENCE_TESTS`, 3), `failures`, `one_signature` (every failure has one cause, across at
least two stories and five failures), `live_same_signature`, `flagged` (why, or null). A flagged re-score is set
aside in `rescore-spoiled/` and the run stays unscored, its live score shown in the record message.

Every outcome says whether a person is needed:

| field | meaning |
|---|---|
| `needs_person` | `false`: the run is scored, or what stopped it can change by trying again and the sweep will retry it. `true`: nothing will change without someone looking; the sweep leaves the run alone (`finalize.py <run>` by hand still tries) |
| `reason` | why there is no score, in words; empty when `done`. Public: one line, no path of the machine's home |
| `reason_kind` | the same as one word. Retried: `tool_missing` (uv, node, npm or npx not found), `suite_fetch_failed`, `suite_unavailable`, `suite_install_failed` (the suite at the tag could not be fetched, read or installed this time), `install_failed` (the app's dependencies), `scoring_spoiled` (the runner crashed, a port was held, a repeat was spoiled), `flagged`, `rescore_failed` (`rescore.py` itself failed), `harness_failed` (finalize could not run: the harness did not load), `out_of_time` (stopped at the sweep's time budget; not counted as an attempt). Needs a person at once: `build_fails_from_clean_clone` (the build passes where the agent worked and fails from a clean clone: a result, not a fault of the machine), `no_bundle` (no `workspace.bundle` and no work dir left), `nothing_to_score` (no story recorded any code), `suite_tag_missing`, `suite_not_in_tag`, `suite_not_in_git`. `scored` when `done` |
| `attempts`, `max_attempts` | re-scores tried under this `version`, and the cap (`MAX_ATTEMPTS`, 5). A retryable failure at the cap becomes `needs_person` |
| `retries_exhausted` | `true` when `needs_person` is true only because the cap was reached |
| `last_attempt_at` | when the last counted attempt was made (UTC); null before the first |
| `history` | the attempts, oldest first (the last 10): `at`, `rescore`, `reason_kind`, `reason` |
| `repair` | the run's own records brought up to date before it was recorded: `repaired` (story ids whose time accounting or conversation profile was recomputed from the machine's full log, `backfill_timing.py`), `left` (story id: why it is still stale, e.g. no full log on this machine), `accounting_version` and `harness_commit` (what did the repair; the sweep repeats one that changed nothing only under another), `at` when anything was recomputed, `error` when the repair itself failed (never fatal) |

A run with no `finalize.json` has not been finalized yet (it is still running, or its run ended before finalize): the
sweep will. `outside_workspace` is the run's summary of the per-story verdicts: `ok`, `reached` (the stories whose
agent reached outside its workspace) and `unjudged` (those with no readable log); it carries `error`, with `ok`
null, when the scan itself failed (the run is still scored).

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
