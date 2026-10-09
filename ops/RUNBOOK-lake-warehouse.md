# Runbook: the lake, the warehouse and the analytics

Where the conversation data is, what is in it, and the queries that answer the questions we keep asking. Written
after rediscovering the paths from scratch during the Strata forensic on 6 Oct 2026.

The design is `docs/designs/conversational-data-lake-warehouse-analytics.md`; this file is the operator's half.

## Where everything is

Everything lives in the **private** bench repository, not this one:

| What | Path |
|---|---|
| Lake (raw, as pulled) | `~/expts/awesome-local-ai-bench-private/state/collected/` |
| Warehouse | `~/expts/awesome-local-ai-bench-private/state/insights/conversations.db` |
| Analytics | `~/expts/awesome-local-ai-bench-private/state/insights/analytics.db` |
| Superseded | `.../state/insights/conv_full.db` (the pre-dbench build; do not use) |

`dbench collect` pulls into the lake and ingests in-process after each pass, so the warehouse is usually current
to the last pass — including **runs still in progress**. A story appears as soon as its record is pushed.

Rebuild or repair:

```sh
dbench ingest --db  ~/expts/awesome-local-ai-bench-private/state/insights/conversations.db \
              --repo ~/expts/awesome-local-ai \
              --store ~/expts/awesome-local-ai-bench-private/state/collected
dbench ingest --schema --db /dev/null --repo /tmp --store /tmp   # print the schema (clap insists on the other three)
```

Ingest reads records from the repo's `origin/main`, never the working copy.

## Before a change to the warehouse: back it up, prove the migration on a copy

The warehouse is a gigabyte and the collector writes to it continuously, so a schema or ingest change is made like this,
and was for the `memory` table on 7 Oct 2026:

1. **Back up with SQLite's online backup, not `cp`.** `sqlite3 conversations.db ".backup 'DEST'"` is a consistent
   snapshot while the collector is writing; a plain copy of a WAL-mode file taken mid-write can be torn. Check
   `pragma integrity_check` on the BACKUP, record checksums and baseline row counts, and keep the old `dbench` binary
   beside it. Make it read-only. Backups live in `state/backups/<date>-<why>/` (git-ignored, so a `reset --hard` cannot
   touch them), each with a `MANIFEST.txt` carrying the rollback steps.
2. **Read a backup with `sqlite3 'file:PATH?mode=ro&immutable=1'`.** Opening a WAL-mode database normally creates
   `-shm` and `-wal` files beside it, which is a backup changing because you looked at it.
3. **Prove the migration on a copy** of the real database: run the new binary's `ingest --db <copy>`, then check
   integrity, that the new table exists, and that no table or row count shrank against the baseline.
4. **Install the binary as a separate file and rename it into place**, signed (`codesign -s - --force`): the running
   services keep the old file. Overwriting a running macOS binary in place gets it killed (exit 137).
5. **Restart only the collector** (`launchctl kickstart -k gui/$(id -u)/com.awesome-local-ai.dbench-collect`), wait
   for its first pass, and repeat the checks on the live file.

The backup of 7 Oct 2026 is `state/backups/20261007-before-memory-table/`: 360 stories, 41 runs, 87,434 calls.

## The tables, and what a row is

`sqlite3` on the warehouse. Ten tables:

| Table | One row is | Key columns |
|---|---|---|
| `stories` | one story run | `sk` (the key everything else joins on), `stack`, `run`, `story`, `status`, `passed`, `total`, `agent_seconds`, `out_tok`, `in_tok`, `machine`, `ended_by`, `nudges`, `truncated_strings` |
| `runs` | one run | `id`, `stack`, `node`, `harness_release`, `state`, `run_json` |
| `calls` | one model turn | `sk`, `idx`, `n_tools`, `out_tok`, `stop`, `think_flags`, `text_flags`, `text_full` |
| `tools` | one tool call | `sk`, `call_idx`, `kind`, `name`, `error`, `n_edits`, `new_chars`, `passed`, `failed` |
| `msgs` | one conversation message | `sk`, `role`, `text_full` |
| `requests` | one engine request | `run_id`, `source`, `prompt_tok`, `cached_tok`, `generated_tok`, `prefill_tok_s`, `decode_tok_s`, `draft_accepted/proposed` |
| `events` | one timeline event | `sk`, `kind`, `t_ms` |
| `compactions` | one compaction | `sk`, `reason`, `summary_chars` |
| `attempts` | one harness attempt | `sk`, `n`, `seconds`, `steps` |
| `conditions` | one 30 s machine reading during a story | `sk`, `run_id`, `at`, `free_pct`, `swap_gb`, `footprint_gb`, `gpu_mem_gb`, `gpu_busy_pct`, `gpu_temp_c`, `gpu_power_w`, and from 9 Oct 2026 the host's own load: `host_cpu_busy_pct`, `host_load1`, `host_psi_cpu_some_pct`, `host_psi_mem_some_pct`, `host_psi_io_some_pct`, `host_cache_gb`, `host_major_faults_per_s`, `host_top` (NULL for readings before then) |
| `memory` | what the model server held as one story began (from the record's `memory_start`; none for stories recorded before 7 Oct 2026) | `sk`, `run_id`, `resident_mib`, `model_bytes`, `engine`, `cache_retained_mib`, `cache_capacity_mib`, `cache_skipped_for_capacity`, `cache_evictions`, `cache_evicted_mib`, `extras_json` |

### Gotchas that cost time

- **`memory` columns are NULL when an engine does not say, never 0.** The engines offer different things about
  themselves: gufo has a cache `capacity` and what it `retained`; llama.cpp prints neither and has `cache_evictions`
  instead. `where cache_capacity_mib is not null` is therefore "a gufo story", and a llama.cpp story has no
  capacity to compare. `resident_mib` is NULL when the total could not be read: a containerised engine once read
  0.0 for every sample (2,381 on one run) because the port's owner was podman's shim, and a zero looks like an empty
  server where NULL looks like what it is.
- **`cache_evictions` and `cache_evicted_mib` (llama.cpp) are cumulative since the SERVER started, not per story.**
  A story's own evictions are the difference from the previous story's row in the same run, and a restart of the
  server resets the count, so a row smaller than the one before it means a restart. Compare rows within a run.
- **`model_bytes` is the exact size of the files the install manifest names**, every shard and the draft head, and is
  NULL when the model itself is not on the machine. A draft head alone is deliberately not reported: it would read as
  a small model.
- **`footprint_gb` in `conditions` is the same total sampled every 30 s; `memory.resident_mib` is the one reading at a
  story's start.** Use `conditions` for the peak during a story and `memory` for the breakdown at its start.

- **`stories.run` is NOT unique. The key is `(stack, run)`.** A run name is the series position, and every
  combination running that series uses it: `v2-r1` … `v2-r4` each name three different runs, on three different
  machines, and `v2-r5` names two. 24 distinct run names cover 33 stack+run pairs. Any `partition by run` or
  `group by run` silently mixes machines — on 6 October 2026 one invented a −24-test regression that reached a
  committed strategic-insights note. `tests/warehouse-sql-test.sh` fails any committed query that does it.
- **A `like` for a quoted literal must escape the quote.** `args_json` holds JSON, so source text
  `aria-label="Sticky note"` is stored as `aria-label=\"Sticky note\"`. The unescaped pattern matches nothing and
  returns zero for every row, which reads like a finding. Check a `like` returns *something* before believing a
  zero.
- **`stories.passed`/`total` are CUMULATIVE over the suite**, not that story's own tests. Story 2 showing `6/20`
  means six of the first twenty tests pass after two stories. `dbench status`'s per-story "accept 0/10" column is
  the delta. Do not mix them.
- **`machine` is the hardware, not the node name**: `ubuntu/nvidia4090`, `macos/128GB`, `ubuntu/strix-halo-128GB`.
  The node names the machines are known by in `dbench` are not in the warehouse at all.
- **`tools.error` is `'0'`/`'1'` as text**, not null-or-message. `where error is not null` matches everything and
  will tell you every tool failed. Use `where error='1'`.
- **`requests.source` differs by engine** (`engine-log` for Strata/gufo/mlx-serve, `llama-log` for llama.cpp) and
  the formats are **not comparable field by field**. llama.cpp's `prompt_tok` averages ~1.4k against Strata's ~68k
  for the same work, because the logs count different things. Compare an engine against itself over time, or
  against another engine only on fields you have checked mean the same.
- **`requests.finish`/`status` are null for Strata**: the engine-log parser does not fill them.
- `stories.sk` is the join key. `runs.id` is a repo-relative run directory, which is what `requests.run_id` holds —
  so `requests` joins to runs by path, not to `stories` by `sk`.

## Recipes

What a run's server was holding at the start of each story, and whether its prompt cache is full or churning:

```sql
select s.story, round(m.resident_mib/1024.0,1) resident_gib, round(m.model_bytes/1073741824.0,1) model_gib,
       m.engine, round(m.cache_retained_mib/1024.0,1) cache_gib, round(m.cache_capacity_mib/1024.0,1) cache_cap_gib,
       m.cache_skipped_for_capacity skipped, m.cache_evictions evictions
from memory m join stories s on s.sk = m.sk
where s.stack = ? and s.run = ?  -- (stack, run): a run name is not unique
order by cast(s.story as integer);
```


A story across every stack on one machine:

```sql
select substr(stack,1,34) stack, run, status, passed||'/'||total score,
       round(agent_seconds/60.0) mins, out_tok, in_tok, ended_by
from stories where machine='ubuntu/nvidia4090' and story='2' order by stack, run;
```

Effort and shape of the work (edits, the agent's own tests):

```sql
with s as (select sk, stack, run from stories where machine='ubuntu/nvidia4090' and story='2' and status='DONE')
select substr(s.stack,1,20) stack, s.run, sum(t.n_edits) edits, sum(t.new_chars) new_ch,
       sum(t.passed) own_pass, sum(t.failed) own_fail
from s join tools t on t.sk=s.sk group by 1,2 order by edits desc;
```

True tool failure rate:

```sql
select run, count(*) tools, sum(error='1') failed, round(100.0*sum(error='1')/count(*),1) pct
from stories s join tools t on t.sk=s.sk where story='2' group by 1 order by pct desc;
```

Does an engine slow down as context grows (one engine, one log source):

```sql
select (prompt_tok/16384)*16 ctx_k, count(*) n, round(avg(prompt_tok-cached_tok)) new_tok,
       round(avg(decode_tok_s),1) decode_ts, round(avg(generated_tok)) gen,
       round(100.0*sum(draft_accepted)/nullif(sum(draft_proposed),0),1) draft_pct
from requests where run_id like '%strata%' group by 1 order by 1;
```

`decode_tok_s` is sound across buckets; **`prefill_tok_s` is not** — it falls with batch size because per-request
overhead dominates small reads, so a falling prefill rate is usually an artefact, not a finding.

Behavioural flags (the vocabulary is `shortcut`, `claims_done`, `blames_env`, `eval_aware`, `question`); always
compare per call, never as totals, because call counts differ several-fold between runs:

```sql
with s as (select sk, run from stories where machine='ubuntu/nvidia4090' and story='2' and status='DONE')
select s.run, count(*) calls,
       round(100.0*sum(c.text_flags like '%shortcut%' or c.think_flags like '%shortcut%')/count(*),1) shortcut_pct
from s join calls c on c.sk=s.sk group by 1 order by shortcut_pct desc;
```

Whether a machine had memory to spare while it worked (`free_pct` is MemFree, not MemAvailable, so available
headroom is higher by whatever cache is reclaimable):

```sql
select substr(s.stack,1,22) stack, s.run, count(*) readings,
       round(min(c.free_pct),1) min_free_pct, round(max(c.swap_gb),2) max_swap_gb, round(max(c.gpu_mem_gb),1) max_vram
from stories s join conditions c on c.sk=s.sk
where s.machine='ubuntu/nvidia4090' group by 1,2 order by min_free_pct;
```

The host columns (9 Oct 2026) answer "was the machine waiting on something other than the GPU?": `host_psi_*_pct` is the share of a
reading's interval the kernel says work stalled on the CPU, memory or disk; `host_cpu_busy_pct`, `host_load1` and `host_top` (a JSON
array of the busiest processes) say what was using the CPU; `host_cache_gb` and `host_major_faults_per_s` say whether weights read
through the file cache were being evicted and read back from disk. An old warehouse gets the columns added when the new binary opens
it (`Db::init`, `HOST_COLUMNS`); rows from before read NULL, never 0.

```sql
-- a story's speed regime against what the host was doing (Strata v2-strata0139-r2 is the case this was added for)
select s.story, count(*) readings, round(avg(c.gpu_power_w)) gpu_w, round(avg(c.host_cpu_busy_pct),1) cpu_busy,
       round(max(c.host_psi_mem_some_pct),1) mem_stall_max, round(min(c.host_cache_gb),1) cache_min_gb
from stories s join conditions c on c.sk=s.sk
where s.stack like '%strata-pi' and c.host_cpu_busy_pct is not null group by s.sk order by s.story;
```

`conditions` was empty until 6 Oct 2026 — ingest parsed the readings into the event stream but never wrote the
table. Fixed; the 26,756 readings then came back from the lake, so anything collected before that date is there.

What the agent was asked, and what it claimed at the end:

```sql
select substr(replace(coalesce(text_full,text_head),char(10),' '),1,900)
from msgs where sk=(select sk from stories where run='<run>' and story='<n>') and role='user' order by idx limit 1;

select substr(replace(coalesce(text_full,text_head),char(10),' '),1,700)
from calls where sk=(select sk from stories where run='<run>' and story='<n>')
  and coalesce(text_full,text_head)<>'' order by idx desc limit 2;
```

## Reading results honestly

The rule in `CLAUDE.md` ("Check a strategic insight before saying it") bites hardest here, because a one-line
query always returns something. In the Strata forensic three readings were wrong before they were right: every
tool looked failed (`error is not null`), per-story scores looked like suite scores (cumulative), and prefill
looked collapsed (batch-size artefact). Each would have been a confident, wrong claim about someone's engine.

Cross-check every figure against a second source — the benchmarker's own screen, `dbench status`, or the run's
`metrics.json` — before it goes in front of anyone.
