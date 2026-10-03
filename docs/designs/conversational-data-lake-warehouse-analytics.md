# Conversational data lake, warehouse and analytics

Design for collecting every conversation and the server metrics around it from each bench machine into a lake, a warehouse and an analytics layer. Approved 3 October 2026. Status: being built; the sequence at the end says what is done.


## Context

Every bench machine runs `dbench serve`. After each story the harness commits and pushes the published record (metrics.json, run.json, the lossless compact transcript, scores). But the richest data never leaves the node: the full `agent-events.jsonl` (stream timing), the engine's `server.log` (per-request prefill/decode/draft figures), `progress.json`, the egress log, and the 30 s machine-condition readings, which are not even written to disk (`ConditionSampler` keeps them in memory, `drive.py:1596`; metrics.json gets a summary).

Offline analytics today is `conv_full.db`, a 639 MB SQLite file in the private repo's git-ignored `state/insights/`, built by hand with `build_full.py` whenever someone remembers, with no runs table, no engine requests, no machine conditions, and a documented location that is wrong. The benchmarker shows a counts-only conversation profile and never links the transcript.

The owner wants this moved from "logs we scrape" to an operational first-class citizen: a collector that pulls what git does not carry, a database that is always current, and conversations as entities in the benchmarker that the time bars link to.

## Decisions

1. **Pull + diff**, not push + queue. The host polls nodes; nodes keep nothing extra. Git stays the channel for published files; this collects only what git does not carry.
2. **Ingest in Rust**, rewriting the Python parsers. Cost accepted: the port is about 1,300 lines of Python (`conversation.py` 193, `accounting.py` 454, `engine_log.py` 164, `llama_log.py` 97, `attempts.py` 301, `build_full.parse` ~60, `drive.server_stats` ~40) plus the flag regex tables in `reduce_lib.py` (59 lines, no lookarounds anywhere, so the `regex` crate takes them as they are). Mitigation: golden-file parity tests exported from the Python parsers (section C.4), so a future Python VERSION bump fails the Rust tests until it is ported.
3. **The data API is time-ranged with a cursor, and the story's status is irrelevant to it.** It accepts and returns millisecond date ranges, pages through a guaranteed-contiguous span with a cursor over any number of requests, and has an open-ended form ("everything newer than this stamp", returning the latest stamp for the next call). Backfill and a simulated live stream are the same API used with different ranges. There is no live mode, no live flag.
4. **Whole bar and its parts link**: a story's time bar opens its conversation; a part (prefill/decode → calls, tools → tools, compaction → compactions, between sessions → sessions) lands on that section. Combination-page bars sum a run's stories, so a part there opens the run page's time section.

## Architecture: lake, warehouse, analytics

```
SOURCES (each bench machine, run dir)      LAKE (host, raw, byte-exact copies)
  stories/NN/agent-events.jsonl             <private>/state/collected/<node>/<run path>/
  server.log  proxy.log  progress.json        the same files + collection.json
  stories/NN/conditions.jsonl (new)   ──►   pulled by `dbench collect`
  ~/.vidi-bench/egress/<id>.jsonl           (GET /v1/runs, /files, /file; byte cursor + prefix check)
  + published files via git (metrics.json,
    run.json, compact transcript)                      │ ingest (Rust, in the same process)
                                                       ▼
                                           WAREHOUSE (host)
                                             <private>/state/insights/conversations.db
                                             events stream (ms time, append-only, cursor)
                                             + entity tables (runs, stories, calls, tools,
                                               msgs, compactions, requests, conditions, …)
                                                       │ conversation API 127.0.0.1:7761
                                                       │ (time-range + cursor)
                                                       ▼
                                           ANALYTICS
                                             benchmarker conversation pages (proxy :7760)
                                             detect_*.py and future offline analysis
```

The lake is raw and append-only: whatever the node had, byte for byte, plus a record of what was collected. The warehouse is the parsed, queryable form with one time axis. Analytics never reads the lake; it reads the warehouse. One host process (`dbench collect`) owns the lake, the warehouse and the API. The benchmarker stays a reader, proxying to it, so no SQLite driver enters the TypeScript side (Bun has `bun:sqlite`, Vitest runs on Node with `node:sqlite`; a proxy avoids the split entirely).

Naming: "conditions" is the harness's 30 s readings of the machine while a story runs (swap, free memory, server footprint, GPU busy/clock/memory/temperature/power, thermal state) from `ConditionSampler`. It was called "samples" in an earlier draft; that word is reserved for analytics and is not used anywhere in this design.

## A. Node side: file endpoints in `dbench serve`

Files: `tools/dbench/src/collect.rs` (new), `src/server.rs`, `src/cli.rs`.

**Allow-list, deny by default** (`collect.rs`). A request names a file; the name is matched against a table, never joined to a path:

| name | kind | source |
|---|---|---|
| `stories/<1-3 digits>/agent-events.jsonl` | append | run dir |
| `stories/<1-3 digits>/conditions.jsonl` | append | run dir (new, section E) |
| `server.log`, `proxy.log` | append | run dir |
| `progress.json` | whole | run dir |
| `egress.jsonl` | append | `<bench_home>/egress/<basename(work_dir.txt)>.jsonl`, basename checked by `ids::valid_id`; absent for runs before 1 Oct 2026 |

`parse_name(&str) -> Option<FileName>`, `resolve(run_dir, bench_home, &FileName) -> Option<PathBuf>`; a unit test asserts every accepted name resolves under the run dir or the egress dir. MTPLX's `~/.mtplx/logs/request-log-<port>.jsonl` is out of scope: per port, shared across runs, not recorded in the run dir, and MTPLX is no longer a baseline.

**Endpoints** (behind the bearer token; axum 0.8 forbids a wildcard mid-path, so run paths go in a query parameter):

| Route | Query | Returns |
|---|---|---|
| `GET /v1/runs` | | `[{run, job, run_status:{state,at}, job_state}]`, every run dir on the node (walk `combinations/` to each `config.sh`, then `benchmarks/*/*/run.json`; plus each install's `RUN_BASE`); never descends into a run dir |
| `GET /v1/jobs/{id}/files`, `GET /v1/runs/files?run=` | | manifest `{run, job, run_status, job_state, files:[{name, kind, size, mtime}]}` from `metadata()` only, no file opened |
| `GET /v1/jobs/{id}/file`, `GET /v1/runs/file?run=` | `name`, `from`, `check` | raw bytes, `application/octet-stream`, headers `x-dbench-from/size/mtime/eof` |

Ranged read: `check` is the FNV-1a-64 hex of the last `min(PREFIX_CHECK_BYTES, from)` bytes the client holds (required when `from > 0`, else 400). Server stats the file (a stable `size` snapshot), 409 if `from > size` or the prefix window differs, then returns at most `COLLECT_CHUNK_BYTES` (4 MiB) never past the snapshot. `whole` files need `from = 0`, 413 past the cap. No gzip in v1 (reqwest is built without it, Tailscale/LAN link, deltas are small; recorded). Reads go through `tokio::fs`, never block the runner. Generalise `read_chunk` (`server.rs:591`) to `read_at(path, offset, cap, limit)`.

`ServerConfig.bench_home` from `$VIDI_BENCH_HOME` else `~/.vidi-bench` (`cli.rs`, no new flag). Constants named: `COLLECT_CHUNK_BYTES`, `PREFIX_CHECK_BYTES`, `MAX_STORY_DIGITS`, `RUN_MARKER`, `RUN_STATUS_FILE`, `WORK_DIR_FILE`, `EGRESS_DIR`, header names, FNV constants.

Client (`src/client.rs`): `Api::runs()`, `files(RunRef)`, `file_chunk(RunRef, name, from, check) -> (StatusCode, ChunkMeta, Bytes)` via a new `get_bytes` (`send` turns bodies into text); `RunRef = Job(id) | Path(run)`; `CHUNK_TIMEOUT` 120 s.

## B. Host side: `dbench collect`

Files: `tools/dbench/src/collector.rs` (new), `src/cli.rs`, `src/main.rs`, `src/client.rs` (`[collect] store`, `db`, `api` in nodes.toml).

```
dbench collect [--store DIR] [--db FILE] [--api ADDR] [--once] [--node NAME]... [--run PATH]
               [--running-poll-ms 10000] [--finished-recheck-ms 3600000] [--settle-grace-ms 60000]
```

Defaults from `~/.config/dbench/nodes.toml` `[collect]`: `store = <private>/state/collected`, `db = <private>/state/insights/conversations.db`, `api = 127.0.0.1:7761`. Long-running by default; `--once` is one pass and exits 0 even with unreachable nodes (reported on stderr, never fatal).

Per pass, per node, per run: manifest → `plan()` → `Skip | Append{from} | Refetch | Whole` per file → pull loop until `eof` → write `collection.json` atomically (`store::write_atomic`) → ingest the stories whose inputs changed (section C). **The local file length is the cursor**; `collection.json` is advisory, so a crash between append and record is healed next pass by the server's prefix check. 409 → truncate, refetch (`MAX_REFETCHES_PER_PASS` 2).

Layout: `<store>/<node>/<run path>/` holding byte-for-byte prefixes of the node's files plus `collection.json` `{node, run, job, run_status, job_state, complete, first_collected_at, collected_at, settled_at, files:{name:{bytes, node_size, node_mtime, at_eof, pulled_at, refetches}}, dbench_version}`. Facts only: no error text, no reasons, nothing the app would have to explain.

Cadence: running (`job_state running` or `run_status started`) every `RUNNING_POLL` 10 s; settled runs pulled until every file is at eof, then `complete` after an unchanged manifest `SETTLE_GRACE` later; complete runs re-checked every `FINISHED_RECHECK` 1 h (a resumed run flips back). Host sleep: wall-clock loop, first pass on wake. Node offline: that node's records untouched. Old node binary (404 on `/v1/runs`): "needs the new dbench", skipped. Node-side deletion of collected full logs is **not** in scope (follow-up for the owner).

## C. Ingest in Rust and the database

Files: `tools/dbench/src/ingest/{mod.rs, events.rs (pi + Claude event model), timing.rs (port of accounting.py), profile.rs (conversation.py), llama_log.rs, engine_log.rs, mtplx.rs, flags.rs (reduce_lib tables), attempts.rs, db.rs}`, `src/ingest/schema.sql`, `tests/ingest.rs`, `tests/golden/`. New crates: `rusqlite` (bundled), `regex`, `flate2` (compact `.gz` logs from git for backfill). All still gated by `checks.toml` (clippy `-D warnings`, `cargo test`).

### C.1 Where and how

`<private>/state/insights/conversations.db`, `PRAGMA journal_mode=wal`, `user_version=2`. The collector is the only writer and does ingest in-process after each pass. `dbench ingest --rebuild` writes `conversations.db.new` and renames over; `dbench ingest --changed | --story REL`. Inputs for a story: the collected full log if present, else the compact `.gz` from `origin/main` (`git cat-file`, as the benchmarker does), plus metrics.json/run.json/run-status.json from `origin/main`, plus the run's collected `server.log`/`proxy.log`/`egress.jsonl`/`conditions.jsonl`. The `-opencode/` → `-pi/` rename mapping (`build_full.py:27`) survives.

### C.2 Schema v2 (`schema.sql`, also printed by `dbench ingest --schema`)

v1 columns of `stories`, `calls`, `tools`, `msgs`, `compactions` stay an exact prefix (names, order, values) so the detect scripts keep working with only the path changed; v2 columns appended. New tables: `meta`, `runs` (id = run dir; pack/stack/family/variant/engine/client/machine/run, node, host, pack_version, harness_commit, harness_release, model_id, started_at, ended_at, state, state_at, invalid, known_good, run_json, run_status_json), `attempts`, `sessions`, `requests` (run_id, source `llama-log|gufo|mlx-serve|meter-proxy`, idx, sk, call_idx, ts, server_start, prompt/prefill/generated/cached tok, prefill_s, decode_s, ttft_s, tok/s, draft_accepted/proposed, rounds, mean_len, context_len, finish; pk (run_id, source, idx)), `conditions` (run_id, at, sk, ac, low_power, thermal, swap_gb, free_pct, footprint_gb, footprint_peak_gb, gpu_*; pk (run_id, at)), `collection` (sk pk, node, collected_at, complete, events_source `full|compact|none`, events_path, events_bytes, events_consumed (live cursor), has_*, inputs_digest, ingested_at, ingest_version, ingest_s). Unique indexes `calls(sk, idx)`, `tools(sk, idx)`, `stories(rel)`.

**`events`: the time-ordered, append-only stream the API pages over.** `events(sk, ord integer, t_ms integer, kind, ref_idx, payload_json; pk (sk, ord))` with index `(sk, t_ms, ord)`. One row per immutable happening: `call` (t = message end), `tool_start`, `tool_end`, `msg`, `compaction_start`, `compaction_end`, `session_start`, `session_end`, `request` (engine request, t = its end), `condition`. The entity tables stay for the detect scripts; `events` is the index the frontend reads. `t_ms` is integer epoch milliseconds (the logs' `_rx` floats carry sub-second time; the API never exposes float seconds). `ord` is assigned at ingest and never reassigned while a story is still being appended, so a late-placed engine request has an earlier `t_ms` but a later `ord`. On a full re-ingest of a story (its inputs changed, it is complete) the rows are rebuilt and `ord` = position in (t_ms, kind rank, ref_idx) order, so time order and ingest order coincide. v2 columns on `calls`: `sent, first, attempt`; on `tools`: `kind`; on `stories`: `run_id, title, ended_by, attempts, first_started, agent_seconds, out_tok, in_tok, cache_tok, not_comparable, time_split_json, conversation_json, conditions_json, requests_json, provenance_json`.

**Story-run id = `stories.rel` = `<run dir>/stories/<NN>`** (the IA plan §7's missing id; derivable on both sides from `Row.dir` + story number, `STORY_DIR_DIGITS` moves to `shared/`). `sk` stays the integer join key, stable across re-ingest.

### C.3 Incremental and live

Unit of work is a story run. `inputs_digest` = blob ids of its git inputs + (path, size, mtime) of its collected files + the collection entry; unchanged → skip; changed → one transaction, child rows replaced under the same `sk`. `requests` and `conditions` are per run and rewritten when any of that run's inputs change; placement: llama-log and meter-proxy by time (`sent <= ts <= end`), gufo and mlx-serve by (prompt, generated) token pair (port of `engine_log.match`), unmatched kept with null `call_idx`.

Appending: whatever the story's status, the parser is a streaming state machine over complete lines (a final line without `\n` is not consumed); its state lives in memory in the long-running collector, keyed by story; entity rows are upserted per pass (`insert or replace` on the unique indexes) and `events` rows are only ever appended with the next `ord`; `collection.events_consumed` records the byte cursor. On collector restart a story still being appended is re-parsed from byte 0 (Rust reads 300 MB in seconds) and its `events` rebuilt; a story whose digest is unchanged is untouched.

### C.4 Parity goldens

`benchmarks/spec-bench/harness/export_goldens.py` runs the Python parsers over every existing fixture (`fixtures/pi-smoke-events.jsonl`, `claude-stream.jsonl`, `fixtures/accounting/*.jsonl` with `cases.json` windows, `fixtures/engine-logs/{gufo,mlx-serve}-excerpt.txt`, `test_llama_log.SMOKE`) and writes JSON into `tools/dbench/tests/golden/` (profile, time_split, parsed calls with sent/first/end and tool kinds, engine requests and matches, llama timings, flags for a text corpus). `tests/ingest.rs` asserts the Rust output equals each golden. A harness check in `checks.toml` re-runs the export and fails on a diff, so a Python VERSION bump is visible on the Rust side the same day. A one-off parity run of `--rebuild` against `conv_full.db` (same `stories/calls/tools` counts; identical detect script output) before `build_full.py` is deleted.

## D. Benchmarker

Files: `tools/benchmarker/server/{main.ts, conversations.ts (proxy + fixture store), faults.ts}`, `shared/{conversation.ts (new), routes.ts, types.ts, glossary.ts}`, `src/{pages/ConversationPage.tsx, pages/CallPage.tsx, useConversation.ts, App.tsx, components/TimeBars.tsx, components/run/{RunTime.tsx, StoryDetail.tsx, Against.tsx}, components/story/StoryTime.tsx, components/combination/RunTimeBars.tsx}`, `e2e/fixture.json`.

**Conversation API** served by `dbench collect` at `/v1/conversations/...` and proxied by the benchmarker at `/api/conversations/...` (flag `--conversations-url`, default `http://127.0.0.1:7761`; fixture mode serves `fixture.conversations` from JSON in-process through the same `ConversationStore` interface):

| Route | Returns |
|---|---|
| `GET /api/conversations/:id` | `Conversation {id, fmt, range: {fromMs, toMs} \| null, latest: cursor, counts: {calls, toolCalls, msgs, compactions, requests, conditions}}`. `range` is the valid date range of what has been ingested so far; `latest` is the cursor after the newest event |
| `GET …/:id/events?fromMs=&toMs=&cursor=&limit=` | **the time-range form.** `{events: Event[], nextCursor: string \| null, range}`. Events with `fromMs <= t_ms < toMs`, ordered by `(t_ms, ord)`; `limit` ≤ `EVENTS_PAGE_MAX` 500. `nextCursor` continues exactly after the last event returned; null when the span is exhausted. Any number of pages, contiguous by construction |
| `GET …/:id/events?after=<cursor>&limit=` | **the open-ended form.** Everything ingested after the cursor, in `ord` order, whatever its `t_ms`; returns `nextCursor` (the latest stamp) for the next call. `after=0` is the whole story from the start. Nothing can be missed: a late-placed engine request has a later `ord` |
| `GET …/:id/calls/:idx`, `…/:id/tools/:idx` | one call / one tool in full (thinking, text, args, full result) for the detail page |
| unknown, not collected, service down | `404 {}`; no reason, ever |

`Event = {ord, tMs, kind, ref: {idx}, ...payload}`; a `call` event carries the outline fields (think/text chars, tools, tokens, stop, sent/first/end ms) and text cut at `RESULT_INLINE_CHARS` 4000 with `head/tail/chars` beyond it; `tool_end` carries the result cut the same way; `request` and `condition` carry their rows. The cursor is an opaque string encoding `(t_ms, ord)`. The page backfills with the time-range form and simulates a stream by polling the open-ended form with its last cursor every `POLL_MS` 5 s, whether the story is running or long finished; a finished story simply returns nothing new. `:id` is one URL-encoded segment. `publicConversation`/`publicCall` strip `invalid`, `collection.*`, `accounting`, `truncated_*`, `ended_by` reasons. `State.Story` gains `storyRunId` and `hasConversation` (from the service's `GET /v1/conversations/available`, refreshed with the repo fetch). Faults for the monitor only: `conversation_missing` (recorded > `CONVERSATION_STALE_H` 6 h ago, none), `conversation_incomplete`, `conversation_service_unreachable`.

**Routes** (`shared/routes.ts`): `#/<pack>/r/<stack>/<run>/s/<n>/conversation?at=<calls|tools|compactions|sessions|requests>` and `…/conversation/c/<idx>`; `Route` gains `conversation` and `call`; `conversationHref`, `callHref`. `shared/conversation.ts`: types, `storyRunId(dir, story)`, `SEGMENT_ANCHOR: Record<Seg, Anchor>` (prefill/decode/modelUnsplit/other → calls, tools → tools, compaction → compactions, betweenSessions → sessions), `timeline()` bins.

**Pages.** `src/useConversation.ts` keeps one client-side event store per story: it backfills the time range it needs with the time-range form, then polls the open-ended form with its last cursor; sections are views over that store. `ConversationPage`: breadcrumb, story-run header reused, timeline strip (one tick per call, compaction bands, click → call page), sections calls (outline, expandable), tools, compactions, sessions, messages, requests (callIdx links), conditions; `?at=` scrolls to the section; the header shows the range covered. `CallPage`: one call in full, prev/next. `hasConversation === false` → the page shell with `<Missing why="Not available." />`. Verbatim agent text is wrapped in `data-quoted="agent"`.

**Bars.** `SegmentBar` gets `hrefOf?: (seg) => string | null`; a part with an href renders as `<a class="seg-link" tabIndex={-1}>` (keyboard route stays the label link, as `RunTime.tsx:28` notes). Run page (`RunTime.tsx`), story page (`StoryTime.tsx`), story-run page big bar (`StoryDetail`) and `Against.tsx` small multiples → `conversationHref(…, SEGMENT_ANCHOR[seg])` when `hasConversation`, else the story-run page as now. Combination page (`RunTimeBars.tsx`) → `withParams(runHref, {at: "time"})`. `StoryDetail.Conversation` keeps the counts and adds "Open the conversation" or `Missing`.

**Fixture.** `e2e/fixture.json` gains `conversations: {<storyRunId>: {events: Event[], calls, tools}}` for SWIFT `v2-r5` story 2 (pi, 6 calls, a compaction, 3 llama-log requests, 4 condition readings) and OPUS `run-9` story 1 (claude, thinking withheld); every other story renders `Missing`. Fixture mode's `POST /api/test/reset` can also append events to a story (`{appendEvents: {<id>: Event[]}}`) so Playwright can prove the open-ended form picks up growth.

## E. Harness change (node side, needs a harness release)

`ConditionSampler` appends one JSON line per tick to `stories/NN/conditions.jsonl` (`t, ac, low_power, thermal, swap_gb, free_pct, footprint_gb, footprint_peak_gb, gpu{…}`); add it to the run-dir `.gitignore` template beside `stories/*/agent-events.jsonl`; document in TELEMETRY.md; tests in `test_drive_helpers.py` (drive.py keeps 100% branch coverage). Until this ships, `conditions` is filled from metrics.json's `conditions.bad_samples` summary only (that field keeps its existing name in the published record). Also `export_goldens.py` and its check (C.4).

## F. Docs and guide

- `tools/dbench/README.md`: API table rows, `dbench collect`/`ingest`, a "Collecting what git does not carry" section, the security bullet (serves only allow-listed names, never a path), rollout (nodes need the new binary: hold, restart, release).
- `benchmarks/spec-bench/TELEMETRY.md`: Published column gains **collected**; rows for `conditions.jsonl` and `egress.jsonl`; MTPLX log "not collected" with the one-line why; `collection.json` and the partial-last-line rule. `test_telemetry_doc.py` must pass.
- `benchmarks/docs/insights/README.md:177-193`: DB is `state/insights/conversations.db`, built and kept current by `dbench collect`; `SCHEMA.md` regenerated from `dbench ingest --schema`; `build_full.py` deleted after parity; detect scripts' usage lines updated; `detect_time.py`/`detect_reads.py` listed.
- Guide (`benchmarks/docs/guide/assets/guide-data.js`, then `node build.mjs`, `test/guide.test.mjs --static`, `tests/links-test.sh`, `tests/privacy-test.sh`): entities `collection` (watch), `conversation-db` (watch), `engine-request` (run), `collector` (operate); `rel` additions on `conversation`, `story-run`, `insights`; components `dbench` (collect, endpoints), `benchmarker` (conversation and call pages, the proxy), `insights-scripts` (ingest replaces build_full); flow **J Collect** (node run dir → `dbench serve` manifest/file → `dbench collect` → `state/collected` → ingest → `conversations.db` → `/api/conversations` → conversation page, with a "never on the page" guard node); README entity list and flow table.
- `tools/benchmarker/README.md`: Conversations section, `--conversations-url`.

## Tests

- **dbench unit** (`collect.rs`, `collector.rs`, `ingest/*`): allow-list accept/reject table incl. traversal forms; every accepted name resolves inside; manifest incl. egress from `work_dir.txt`; FNV vectors; run listing skips workspaces; `plan()` skip/append/refetch/whole; settled/complete/cadence rules; `collection.json` round-trip has no error field; store dir rejects bad run paths; parser goldens (C.4); flags tables; token-pair matching; time placement; partial last line not consumed; incremental re-ingest keeps `sk`; `--rebuild` rename.
- **dbench e2e** (`tests/server.rs`, new fake packs `growpack` appending every 100 ms and `bigpack` 5 MiB): manifest by job and by path, 400/404 cases, metrics.json not served; ranged read follows growth, wrong check → 409, from > size → 409, from without check → 400, whole-file rules, multi-chunk eof; `dbench collect --once` three passes (create, delta only, node killed → exit 0 untouched, restarted → catch-up, job ends + `--settle-grace-ms 0` → complete), truncation refetch, backfill of a run with no job, ingest rows appear and a live story grows between passes.
- **dbench conversation API** (`tests/ingest.rs` + an axum test client): time-range paging over a 1,200-event story in pages of 7 yields every event exactly once in `(t_ms, ord)` order; a page boundary between two events with the same `t_ms` loses nothing; `after=` yields a late-placed request with an earlier `t_ms`; `after=latest` on a finished story returns empty with the same cursor; `fromMs/toMs` half-open; `limit` over the cap → 400; unknown story → 404 `{}`; ms, never float seconds, in every field.
- **benchmarker Vitest**: `conversations.test.ts` (unknown id → null, proxy passes cursor and range through untouched, result cut, projection has no fault fields, service down → null), `faults.test.ts` (three kinds), `routes.test.ts` round trips, `conversation.test.ts` (`SEGMENT_ANCHOR` covers every `Seg`, `storyRunId` padding, timeline bins, the client event store merges pages and `after` results without duplicates).
- **Playwright**: `conversation-page.spec.ts` (sections, `?at=`, backfill across pages, call page prev/next, Claude thinking as `NotApplicable`, not-available shell, events appended through the fixture reset appear on the next poll without reload), `links.spec.ts` (+ bar part → conversation at that part from run, story-run and story pages; combination bar → run page), `story-run-page.spec.ts` (+ link / Missing), `no-faults.spec.ts` PAGES += the three new pages and `everything()` excludes `[data-quoted="agent"]` subtrees with a separate assertion that fault words occur only inside them (the fixture's agent text deliberately contains "harness" and "retry"). **Assumption:** verbatim agent text is a result, not the app's narration, so the sweep exempts it.
- **Harness pytest**: conditions.jsonl writer; `export_goldens.py`; telemetry doc test.

## Node transport versus data API

The node → host transport (section A) moves raw files, so its cursor is a byte offset with a prefix check: the same contiguous-span idea in bytes, because the node never parses. The millisecond time-range cursor API (section D) sits on the database, after ingest has given every happening a time. If the owner wants time ranges at the node too, the node would have to parse logs on the bench machine; not proposed.

## Ordered sequence

1. Node endpoints: `collect.rs` allow-list/manifest/listing + tests; `server.rs` handlers; `tests/server.rs` growpack tests. Clippy, test.
2. `export_goldens.py` + goldens committed; `checks.toml` entry.
3. Ingest: `schema.sql`, `db.rs`, events model, parsers one at a time against goldens (events/profile, timing, llama_log, engine_log, flags, attempts), incremental + live cursor; `dbench ingest --rebuild`; parity run against `conv_full.db`; delete `build_full.py`; insights README.
4. Collector: `client.rs` additions, `collector.rs`, `Cmd::Collect`, in-process ingest after each pass, conversation API (axum on `--api`); e2e collect tests.
5. Benchmarker: proxy store + fixture store, `Story.storyRunId/hasConversation`, faults; shared types/routes; pages, hook, `SegmentBar.hrefOf`, bar links; Vitest, Playwright incl. the `no-faults` rule.
6. Harness `conditions.jsonl` + TELEMETRY + tests (its own harness release).
7. Guide, READMEs. Report what changed in the guide.
8. Rollout: `dbench harness-release` checks; deploy node binaries (hold, restart, release) per the no-idle rule, between runs; start `dbench collect` on the host; first backfill pass over every node; point the benchmarker at it.

## Verification (end to end)

1. `cargo clippy -- -D warnings && cargo test` in `tools/dbench`; `uv run pytest` in the harness dir; `bun run test && bun run test:e2e` in `tools/benchmarker`; guide build and tests.
2. Against a real node after deploy: `dbench collect --once --node <node>` lists its runs, pulls deltas, writes `collection.json`; a second `--once` transfers only the growth (compare `collection.json` bytes to the node's manifest sizes). Check real values, not assumptions: open one collected `server.log` and the matching `requests` rows for a story and compare a prefill figure with `metrics.json`'s `time_split.model`.
3. `dbench ingest --rebuild` then each detect script on both the old `conv_full.db` and the new file: identical tables.
4. Browser: open a story run with a collected conversation, click the tools part of its bar, land on the tools section; open a story that is being appended and watch events arrive through the open-ended form without reload; open a story with no collection and see "—" with no reason; run the no-faults sweep. With curl against the service: page a finished story's whole range at `limit=7` and at `limit=500` and diff the concatenated event lists (identical).
5. Close every tab the browser extension opens; stop any private-port servers started for checking.

## Open points for the owner (not blocking; defaults stated)

- Story-run id as the path (`<run dir>/stories/NN`, default) versus a short hash. Path chosen: derivable on both sides, no lookup.
- Redaction at ingest: the DB keeps verbatim text as today (private repo, local app); a `publicise.leaks` pass before any hosting is a follow-up.
- Deleting full logs from nodes once collected and verified: not in scope; a follow-up with its own rule.
- MTPLX request log: out of scope v1 (reason above).

## As built (3 October 2026)

What landed on main, in the sequence's order, and where it departs from the design above.

- **Steps 1 to 5 are on main with their tests**: the node endpoints (`collect.rs`, `server.rs`), the goldens
  (`export_goldens.py`, the release check "ingest goldens current"), the parsers and the warehouse
  (`src/ingest/`, `dbench ingest`), the collector and the conversation API (`collector.rs`,
  `conversation_api.rs`, `dbench collect`), the benchmarker's conversation and call pages with every time bar
  linking in, and the harness's per-tick `stories/NN/conditions.jsonl`.
- **Not yet deployed.** The nodes run a dbench without the file endpoints (hold, restart, release, between runs);
  `dbench collect` is not running on the host, so the lake is empty and the warehouse holds only what the published
  compact logs give; the readings file needs a harness release. The verification against a real node (plan step 2)
  waits on the rollout.
- **The Rust port's scope is what ingest needs**, not every Python parser: the event-log reader behind the
  conversation database (`events.rs`), `accounting.parse` (`timing.rs`: call timing, tool kinds, sessions, the
  rules for a call cut off), llama-server's, gufo's, mlx-serve's and Strata's logs with the token matcher, and the
  insights flag tables. The conversation profile, the time-split partition and the attempts totals are computed on
  the node by the harness and arrive in the published record; the warehouse copies them (`conversation_json`,
  `time_split_json`, `attempts`) rather than recomputing them. The goldens hold the ported parsers equal to the
  Python ones on every fixture log, Strata's included.
- **Parity with the first database** (`conv_full.db`, 1 October): rebuilt from origin/main's published logs, the
  warehouse holds 477 story runs; of the 429 both hold, 425 have identical call, tool, message and compaction
  counts; three of the four that differ were still running on 1 October, and one has more calls in its machine's
  complete log than in its published compact log (the lake will supply the complete log once collected).
- **"Live" is not a mode.** The page backfills with the time-range form and follows with the open-ended form,
  whatever the story's status; the only live-specific code is the ingest's rule that a story still being appended
  to gains ords without rebuilding its stream.
- **Field names.** A tool event's own kind is `tool_start`/`tool_end`; the tool's kind rides beside it as `toolKind`
  (the fixture design caught the payload shadowing the event's kind). The harness's machine readings are
  "conditions" throughout: the file, the table, the event kind; "samples" is not used for data.
- **The MTPLX request log is not collected** (per port, shared across runs, named nowhere in the run directory).
- **The e2e fixture is a matrix**: `tools/benchmarker/e2e/fixtures/conversations.py` lists its dimensions
  (availability, format, every event kind, inline and cut text, tool outcomes, token and stop edge values,
  matched and late-placed requests, a reading without a GPU, a tie at one millisecond, page-boundary sizes,
  fault words in verbatim agent text) with one case per cell; the specs are organised by where the reader starts.
- **No reference models in the warehouse (3 October 2026, the owner's rule).** Claude Opus and Sonnet are the benchmark's
  quality yardstick, not a subject of conversation analysis, and their transcripts are not kept. Ingest no longer reads
  `benchmarks/reference` (`PUBLISHED_ROOTS`) and every ingest first deletes any reference run's rows from every table
  (`Db::purge_reference`); tests cover both. The live warehouse went from 506 story runs (121 reference) to 385, none
  reference. The file keeps its size until a `VACUUM`. The benchmarker's conversation pages for reference runs now read
  "Not available". `conv_full.db` (the hand-built database of 1 October) still holds them; it is not touched.
