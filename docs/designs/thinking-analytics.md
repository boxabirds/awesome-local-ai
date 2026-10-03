# Thinking analytics: layers 0 and 1 on the warehouse

Design, 3 October 2026. Follows the owner's decision on the thinking-spread research
(`docs/research/20261003-thinking-spread.md`): build the infrastructure, backfill it, then keep it current as business
as usual. Status: being built; the sequence at the end says what is done.

## Where it sits

The conversational data lake, warehouse and analytics design (`conversational-data-lake-warehouse-analytics.md`) is
built: `dbench collect` pulls raw files into the lake, ingests them into `conversations.db` (the warehouse: 504 story
runs, 102,968 calls, every thinking text whole), and serves them over the time-range API. This adds to the analytics
layer, as that design draws it: analytics reads the warehouse, never the lake, and never writes to it.

```
LAKE ──ingest──► WAREHOUSE conversations.db ──read-only──► ANALYTICS analytics.db  (this design)
                 (one writer: the collector)                derived, rebuildable, versioned
```

## Decisions

1. **A separate file, `analytics.db`, next to the warehouse.** Everything in it is derived and can be rebuilt from the
   warehouse in minutes, so it is never a system of record, and a change to a feature never touches the warehouse.
   SQLite, as the warehouse is: one dependency, and DuckDB (not installed here) can `ATTACH` a SQLite file for ad hoc
   queries if the owner wants it later.
2. **Rust, inside dbench** (`src/analytics/`): the project builds in Rust, the collector is already there, and the
   features are string and hashing work that Rust does in seconds over the 79 MB of thinking text.
3. **One row per model call, in two tables by layer.** `call_context` is layer 0 (where the call sits and what
   preceded it); `think_text` is layer 1 (what the thinking text is like). Both keyed by (`rel`, `idx`): `rel` is the
   story run's stable id (`<run dir>/stories/NN`), not the warehouse's integer `sk`, which a warehouse rebuild may
   renumber.
4. **Lexical features only in version 1; no embeddings yet.** The research plan said "embedding cosine, with a lexical
   cross-check". The embedding half needs a model chosen, hosted and versioned, which is a decision of its own. The
   lexical measure (word 5-gram overlap) is the cross-check, built first, and answers "does this block repeat earlier
   thinking, the task, or the tool output" without a model. Embeddings can be added as columns later without
   changing anything here.
5. **Versioned and incremental.** A story run is recomputed when its warehouse inputs change or the analytics version
   is bumped, and only then. `analytics_story` records, per story run, the digest and version it was computed from.
6. **Failure isolation.** Analytics runs after ingest in the collector's pass. An error in it is logged and never stops
   collection or ingest.
7. **Facts only.** Nothing here explains or judges; a column is a count, a ratio or an overlap, and its definition is
   in this document.

## Tables

`analytics_story(rel primary key, run_id, stack, run, story, n_calls, think_chars, think_chars_recorded, think_complete,
source_digest, version, computed_at)`: what was computed, from what. Copies the identifying fields so analytics.db is
queryable alone. `think_chars_recorded` is the harness's own count of the story run's thinking (the record's profile);
`think_complete` is 1 when the warehouse's thinking text adds up to it, 0 when it holds less (older compact logs do),
null when the record has no profile. **Any analysis of thinking text should say which it used.**

`call_context(rel, idx, attempt, frac, t_s, gap_s, dur_s, in_tok, cache_tok, out_tok, context_tok, n_tools, stop,
compactions_before, since_compaction, after_compaction, prev_tool_kinds, prev_tool_errors, prev_tests_passed,
prev_tests_failed, prev_res_chars, commits_before, since_commit_s; primary key (rel, idx))`

| Column | Meaning |
|---|---|
| `frac` | position in the story run, `idx / (calls - 1)`; 0 for a one-call story |
| `t_s` | seconds from the story run's first call to this one |
| `gap_s` | seconds between the previous call ending and this one being sent (the tools' and harness's time); null for the first |
| `dur_s` | seconds the call itself took, sent to ended |
| `context_tok` | `in_tok + cache_tok`: the prompt this call was sent |
| `compactions_before` | compactions that ended before this call was sent (null with no times) |
| `since_compaction` | calls since the last compaction ended; null before the first |
| `after_compaction` | 1 for the first call after a compaction ended |
| `prev_tool_kinds` | distinct kinds of the previous call's tools, comma-joined, sorted |
| `prev_tool_errors` | how many of the previous call's tools returned an error |
| `prev_tests_passed`, `prev_tests_failed` | sums of the tools' own passed and failed test counts |
| `prev_res_chars` | total characters the previous call's tools returned |
| `commits_before`, `since_commit_s` | bash tool calls whose command contains `git commit`, made by an earlier call (counted by position, so it needs no times); seconds since the last finished. A command-text heuristic, named as one |

`think_text(rel, idx, chars, words, lines, gzip_ratio, repeat5, max_line_repeat, n_wait, n_hmm, n_actually,
n_but_wait, n_alternatively, n_verify, code_share, prompt_overlap, result_overlap, prev_sim, max_prev_sim;
primary key (rel, idx))`

| Column | Meaning |
|---|---|
| `chars`, `words`, `lines` | of the thinking text (characters, not bytes) |
| `gzip_ratio` | gzip (flate2, default level) compressed bytes over text bytes: low means repetitive |
| `repeat5` | share of the block's word 5-grams that repeat an earlier one in the same block; null under 5 words |
| `max_line_repeat` | the most times one trimmed line of 20 or more characters occurs in the block; 0 when no line is that long |
| `n_wait` … `n_verify` | counts of whole-word reflection markers, case-insensitive: `wait`, `hmm`, `actually`, `but wait`, `alternatively`, and verification phrases (`let me check`, `let me verify`, `let me re…`, `double-check`; `n_but_wait` is a subset of `n_wait`) |
| `code_share` | share of characters inside ``` fences |
| `prompt_overlap` | share of the block's distinct 5-grams that occur in the story's first user message (the task) |
| `result_overlap` | share that occur in the previous call's tool results |
| `prev_sim` | Jaccard similarity of 5-gram sets with the previous thinking block of the story run |
| `max_prev_sim` | the highest such similarity over the previous 10 thinking blocks |

Any time-based column is null for a story run whose log carries no stamps (20% of the pi calls in the warehouse: older
compact logs): position and counts are still computed. A call with no thinking has a `call_context` row and no `think_text` row. A 5-gram is five consecutive
lower-cased whitespace-separated words, hashed (FNV-1a 64) for set work.

## Incremental, backfill, business as usual

- **Digest.** For a story run: the warehouse's `collection.inputs_digest`, its call count, and the analytics version.
  Unchanged: skipped. A story still being appended to changes its call count each pass and is recomputed, which costs
  milliseconds.
- **Backfill** is the same code with every story run selected (`dbench analyse --rebuild` writes a fresh file and renames it
  over, as `dbench ingest --rebuild` does). Its test: the figures the research document computed in Python from the
  records are reproduced from `analytics.db` by SQL.
- **Business as usual** is a call in the collector's pass after ingest, on the same blocking task, over the stories
  ingest changed (all whose digest differs). `dbench analyse` is the manual form: `--only REL`, `--rebuild`.

## Tests

Unit: every text feature on crafted text with known answers (a repeated paragraph, a novel one, markers, fences,
overlaps, identical and disjoint blocks, a short block). Layer 0 on an in-memory warehouse built to cover compaction
position, preceding tools, commits and gaps. Incremental: unchanged is skipped, changed is recomputed, a version bump
recomputes, a rebuild equals an incremental run. Parity: the real backfill against the Python figures.

## Sequence

1. Design (this document), then the schema, the features and the tests: infra for layers 0 and 1.
2. Backfill the real warehouse into a scratch `analytics.db`; check it against the research figures.
3. Go live: the collector calls it after each ingest; the host's `dbench collect` is restarted on the new binary
   once, and `analytics.db` is the one the analysis reads.
4. After: the labelling-validation tool (layer 2), and the analysis views.

## As built (3 October 2026)

- Steps 1 to 3 are done. `src/analytics/` (`text.rs` layer 1, `context.rs` layer 0, `store.rs`, `schema.sql`, the
  orchestrator and the collector's hook in `mod.rs`), `dbench analyse`, and tests: 17 unit tests, 12 integration tests
  (`tests/analytics.rs`), clippy clean, the whole dbench suite passing.
- **Backfill** of the live warehouse: 504 story runs, 103,125 calls, 95,854 thinking blocks, 18.6 s. A second pass
  recomputes nothing.
- **Parity.** From `analytics.db` by SQL, Swift 1.5's seven runs reproduce the research document: median thinking
  spread 0.83, variance of log thinking 1.02, within-story share 0.77. The decomposition by calls and per-call size
  is the research document's, from the same records.
- **What it found about the data.** Of 504 story runs, 230 have complete thinking text, 94 have less than the
  harness recorded (82 of them in the older `canvas-*` runs, whose compact logs hold short thinking), and 180 have no
  profile (cloud runs, which withhold it, and runs recorded before profiles). 20% of the pi calls have no stamps.
  Found by running against the real warehouse: the synthetic tests had every time and every text, and a story run with
  no stamps failed the first backfill; both cases are tests now. The flag columns exist because of it.
- **Live.** `dbench collect` calls `after_ingest` after each ingest: it makes `analytics.db` beside the warehouse when
  it is absent and otherwise recomputes what changed; an error is a logged line and never stops collection.
- **Found live, fixed:** the first version opened `analytics.db` in WAL mode, which a read-only reader (the sqlite3
  CLI, DuckDB's attach) cannot open once the collector has closed it. It is now a rollback-journal file, with a test
  that opens it read-only after a pass. The collector was restarted on the fixed binary (`launchctl kickstart` of
  `com.awesome-local-ai.dbench-collect`; the previous binary is kept in the session's scratchpad).
