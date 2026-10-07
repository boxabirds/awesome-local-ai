-- The conversation database (the warehouse): schema version 2.
--
-- The five tables the insights scripts read (stories, calls, tools, msgs, compactions) keep their
-- version-1 columns first, unchanged in name, order and meaning, so benchmarks/docs/insights/scripts
-- keep working with only the file's path changed; version-2 columns follow. `sk` is the integer
-- join key of a story run, stable across re-ingest; `stories.rel` is its id (<run dir>/stories/NN).
-- `events` is the time-ordered, append-only stream the conversation API pages over.

pragma journal_mode = wal;
pragma user_version = 2;

create table if not exists meta(key text primary key, value text);

create table if not exists runs(
  id text primary key,                 -- the run directory, relative to the repo (= the benchmarker's Row.dir)
  pack text, stack text, family text, variant text, engine text, client text, machine text, run text,
  node text,                           -- the dbench node the collector pulled it from; null when none
  host text, pack_version text, harness_commit text, harness_release text, model_id text,
  started_at real, ended_at real,
  state text, state_at text,           -- run-status.json
  invalid integer, known_good integer,
  run_json text, run_status_json text, -- verbatim
  ingested_at real
);

create table if not exists stories(
  sk integer primary key autoincrement,
  pack text, stack text, family text, variant text, engine text, client text, machine text, run text, story integer, rel text,
  status text, passed integer, total integer, wall real, fmt text, source text,
  truncated_strings integer, truncated_chars integer, v2 integer, invalid integer, nudges integer,
  started real, finished real,
  run_id text references runs(id), title text, ended_by text, attempts integer, first_started real, agent_seconds real,
  out_tok integer, in_tok integer, cache_tok integer, not_comparable text,
  time_split_json text, conversation_json text, conditions_json text, requests_json text, provenance_json text
);
create unique index if not exists s_rel on stories(rel);
create index if not exists s_run on stories(run_id);

create table if not exists calls(
  sk integer, idx integer, rx real, think integer, text integer, n_tools integer, out_tok integer, in_tok integer, cache_tok integer,
  stop text, sub integer, think_flags text, text_flags text, think_full text, text_full text, think_head text, think_tail text,
  text_head text, text_tail text,
  sent real, first real, attempt integer  -- v2: the call's timing from the client's stream (null where the log has none)
);
create unique index if not exists c_sk_idx on calls(sk, idx);
create index if not exists c_sk on calls(sk);

create table if not exists tools(
  sk integer, call_idx integer, idx integer, tid text, name text, arg text, arg_full integer, arg_chars integer, start real, end real,
  error integer, res_chars integer, sub integer, arg_flags text, res_flags text, n_edits integer, old_chars integer, new_chars integer,
  passed integer, failed integer, flaky integer, skipped integer, args_json text, res_full text, res_head text, res_tail text,
  kind text                            -- v2: e2e, unit, build, bash, or the tool's name (accounting.tool_kind)
);
create unique index if not exists t_sk_idx on tools(sk, idx);
create index if not exists t_sk on tools(sk);
create index if not exists t_name on tools(name);
create index if not exists t_call on tools(sk, call_idx);

create table if not exists msgs(sk integer, idx integer, rx real, role text, chars integer, text_full text, text_head text);
create unique index if not exists m_sk_idx on msgs(sk, idx);
create index if not exists m_sk on msgs(sk);

create table if not exists compactions(sk integer, start real, end real, reason text, summary_chars integer, summary text);
create index if not exists cp_sk on compactions(sk);

-- The harness's own account of each attempt and session of a story (metrics.json agent.attempts / agent.sessions).
create table if not exists attempts(
  sk integer, n integer, source text, started real, ended real, seconds real, steps integer, tool_calls integer,
  compactions integer, nudges integer, resumes integer, tokens_json text, time_split_json text,
  primary key(sk, n)
);
create table if not exists sessions(sk integer, attempt integer, idx integer, session_id text, primary key(sk, attempt, idx));

-- One row per request the model server finished, from its own log; placed in a story by time
-- (llama-server) or by its tokens (gufo, mlx-serve, Strata), the call it answered when matched.
create table if not exists requests(
  run_id text, source text, idx integer,   -- source: llama-log | gufo | mlx-serve | strata | meter-proxy; idx: order in that log
  sk integer, call_idx integer,
  ts real,                                 -- end time, epoch s; null for a server whose log has no clock
  server_start real,
  prompt_tok integer, prefill_tok integer, generated_tok integer, cached_tok integer,
  prefill_s real, decode_s real, ttft_s real, prefill_tok_s real, decode_tok_s real,
  draft_accepted integer, draft_proposed integer, rounds integer, mean_len real,
  context_len integer, finish text, status integer,
  primary key(run_id, source, idx)
);
create index if not exists r_sk on requests(sk, call_idx);

-- The harness's 30 s readings of the machine while a story runs (stories/NN/conditions.jsonl).
create table if not exists conditions(
  run_id text, at real, sk integer,
  ac integer, low_power integer, thermal text, swap_gb real, free_pct real, footprint_gb real, footprint_peak_gb real,
  gpu_busy_pct real, gpu_sclk_mhz integer, gpu_mem_gb real, gpu_temp_c real, gpu_power_w real, gpu_throttle text,
  primary key(run_id, at)
);
create index if not exists cd_sk on conditions(sk, at);

-- What the model server was holding when a story began: one row per story, from the record's `memory_start`
-- (benchmarks/spec-bench/harness/memory_snapshot.py). The engines offer different things about themselves, so
-- anything an engine does not say is NULL and never 0: a gufo run has a cache capacity, a llama.cpp run has
-- evictions, and neither has the other's. A total that could not be read is NULL too, because 0 is what a
-- containerised engine read for 2,381 readings before the port shim was recognised. `extras_json` carries what only
-- one engine volunteers (gufo's GPU use and the host's free memory), named as that engine named it.
create table if not exists memory(
  sk integer primary key, run_id text, at real,
  resident_mib real, model_bytes integer, engine text,
  cache_retained_mib real, cache_capacity_mib real, cache_skipped_for_capacity integer, cache_last_snapshot_mib real,
  cache_evictions integer, cache_evicted_mib real, cache_last_evicted_mib real, cache_checkpoints_erased integer,
  extras_json text
);
create index if not exists mem_run on memory(run_id, at);

-- What each story run was ingested from, and how far.
create table if not exists collection(
  sk integer primary key, node text, collected_at real, complete integer,
  events_source text,                      -- full | compact | none
  events_path text, events_bytes integer, events_consumed integer,
  has_server_log integer, has_proxy_log integer, has_egress integer, has_progress integer, has_conditions integer,
  inputs_digest text, ingested_at real, ingest_version integer, ingest_s real
);

-- The time-ordered stream: one immutable row per happening. `ord` is assigned at ingest and never
-- reassigned while a story is still being appended to; `t_ms` is the happening's own time.
create table if not exists events(
  sk integer, ord integer, t_ms integer, kind text, ref_idx integer, payload_json text,
  primary key(sk, ord)
);
create index if not exists e_sk_t on events(sk, t_ms, ord);
