-- analytics.db: everything derived from the warehouse (docs/designs/thinking-analytics.md). Rebuildable; never a
-- system of record. Keyed by the story run's stable id (`rel`), not the warehouse's integer sk.

create table if not exists analytics_meta(key text primary key, value text);

-- What was computed for each story run, from what.
create table if not exists analytics_story(
  rel text primary key, run_id text, stack text, run text, story integer,
  n_calls integer, think_chars integer,
  think_chars_recorded integer,   -- the harness's own count (the record's profile); null when the record has none
  think_complete integer,         -- 1 when think_chars equals it, 0 when the warehouse holds less or more, null with no profile
  source_digest text, version integer, computed_at real
);

-- Layer 0: where a model call sits and what preceded it. One row per call. A time-based column is null for a story
-- whose log carries no stamps.
create table if not exists call_context(
  rel text, idx integer, attempt integer,
  frac real, t_s real, gap_s real, dur_s real,
  in_tok integer, cache_tok integer, out_tok integer, context_tok integer, n_tools integer, stop text,
  compactions_before integer, since_compaction integer, after_compaction integer,
  prev_tool_kinds text, prev_tool_errors integer, prev_tests_passed integer, prev_tests_failed integer, prev_res_chars integer,
  commits_before integer, since_commit_s real,
  primary key (rel, idx)
);

-- Layer 1: what a call's thinking is like as text. One row per call that has thinking.
create table if not exists think_text(
  rel text, idx integer,
  chars integer, words integer, lines integer, gzip_ratio real, repeat5 real, max_line_repeat integer,
  n_wait integer, n_hmm integer, n_actually integer, n_but_wait integer, n_alternatively integer, n_verify integer,
  code_share real, prompt_overlap real, result_overlap real, prev_sim real, max_prev_sim real,
  primary key (rel, idx)
);

-- The themes of thinking (benchmarks/docs/insights/thinking): written by those scripts, not by `dbench analyse`, which
-- only carries them over when it rebuilds the file. A paragraph is spread over the themes by its weights, so a story
-- run's `chars` per theme is the characters of its paragraphs times their weight on it; `paragraphs` counts those
-- whose strongest theme it is.
create table if not exists theme(version integer, id integer, name text, definition text, primary key (version, id));
create table if not exists theme_story(rel text, version integer, source_digest text, paragraphs integer, computed_at real, primary key (rel, version));
create table if not exists theme_share(rel text, version integer, theme integer, chars real, paragraphs integer, primary key (rel, version, theme));
