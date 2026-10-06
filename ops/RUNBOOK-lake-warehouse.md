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
dbench ingest --schema      # print the schema
```

Ingest reads records from the repo's `origin/main`, never the working copy.

## The tables, and what a row is

`sqlite3` on the warehouse. Nine tables:

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
| `conditions` | one 30 s machine reading during a story | `sk`, `run_id`, `at`, `free_pct`, `swap_gb`, `footprint_gb`, `gpu_mem_gb`, `gpu_busy_pct`, `gpu_temp_c`, `gpu_power_w` |

### Gotchas that cost time

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
