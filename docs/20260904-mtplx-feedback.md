# MTPLX 2.11.1 field notes — 2026-09-04

Observations from a day of real OpenCode agent use on Qwen3.8-Flash-Next,
after upgrading 2.10.1 → 2.11.1. Everything below is from the server's own
telemetry; nothing was reproduced in a controlled harness unless it says so.

Each item is labelled **verified** (observed directly in this session),
**unverified** (a risk spotted by reading, not exercised) or **open question**
(observed but not explained).

## Environment

| | |
|---|---|
| MTPLX | 2.11.1, upgraded from 2.10.1 the same day |
| Model | `Youssofal/Qwen3.8-Flash-Next-MTPLX-Optimized-Speed` |
| Launch | `mtplx serve` with no `--profile`; auto-resolved to `turbo` |
| Runtime | depth 3, ctx 131072, max_tokens 32768, reasoning on / effort low |
| Scheduler | `serial`, preset `latency`, `max_active_requests=1` |
| Hardware | Apple M5 Max, 128 GB, macOS 26.4 (25E246) |
| MLX | 0.32.1 / mlx_lm 0.31.3 |
| Client | OpenCode, single session |

## 1. Long cold prefills emit nothing, so streaming clients disconnect (verified)

A streaming request arrived with 76,060 prompt tokens but only 2,560 reusable
prefix, requiring 73,500 tokens of cold prefill. The client gave up before the
first token:

```
cancellation_reason         client_disconnected
cancellation_elapsed_s      15.32
generated_tokens            0
streamed_completion_tokens  0
mode                        stream
```

Fifteen seconds of complete stream silence, then a disconnect, and the prefill
work was discarded. On a 131k-context server a cold prefill will regularly
exceed common client timeouts, and there is currently no stream activity during
prefill to hold the connection open.

**Suggestion:** emit an SSE comment or keepalive frame when prefill starts,
before the first token. That alone would eliminate this failure class.

Concurrently the memory guard fired on the same request:

```
action                 prefill_admission_shed
prompt_tokens          76,060      reusable_prefix_tokens  2,560
miss_tokens            73,500      reusable_prefix_mode    block_prefix
projected_bytes        103,449,700,695
threshold_bytes         99,986,838,650
limit_bytes            103,079,215,104
cache_bytes              8,380,250,693  ->  cache_bytes_after   0
active_bytes            89,463,296,530  ->  active_bytes_after  89,333,128,618
lru_entries_evicted    1           cache_cleared           1
```

This is logged server-side only — nothing in the response body or on `/health`
tells a client its prefill was shed or that the cache was cleared. Two
questions:

- Is the shed surfaced to clients anywhere?
- After freeing 8.4 GB, does admission re-evaluate? Post-eviction
  `active_bytes_after` (89.3 GB) is well under `threshold_bytes` (100.0 GB), so
  a retry looks like it would fit — but the log does not show whether one was
  attempted, so this is a question, not a claim.

## 2. The SSD session cache served zero restores while costing foreground time (verified)

Over this session, with `ssd_session_cache=on` (the default):

```
restore_hits                         0
restore_misses                      23
last_miss_reason                     ssd_prefix_not_better_than_ram
prefix_lookups_not_better_than_ram  91
written_bytes_last_hour             28,733,851,056    (28.7 GB, rolling hour;
                                                       37.5 GB at peak earlier)
writer_foreground_pauses            18
writer_foreground_pause_s           81.75
managed_file_count                  653,676
managed_disk_bytes                  101,131,214,848   (101 GB)
```

The RAM bank won all 91 prefix lookups, so the SSD tier has never served a
restore. Its cost over the same session: 28.7 GB written in the trailing hour
against a 68.7 GB budget (37.5 GB/hr at its peak), 101 GB and 653k files on
disk, and **81.75 seconds of cumulative foreground pauses** — which land
directly on TTFT and throughput.

For a single long-lived agent session this looks like pure overhead. Worth
considering:

- Should the writer back off once `prefix_lookups_not_better_than_ram`
  dominates?
- Should `ssd_session_cache=off` be the recommendation for single-session agent
  use rather than the default `on`?

This session cannot speak to multi-session or restart-heavy workloads, where
the tier presumably earns its place.

## 3. No MTPLX version anywhere in the telemetry (verified)

The request-log record carries 186 fields and none identify the build;
`/health` has none either. Comparing 2.10.x against 2.11.1 from logs therefore
required splitting the arms on the installed binary's mtime, which is fragile
and impossible for anyone reading the logs later.

**Suggestion:** one `mtplx_version` field in the request-log record.

## 4. `reasoning_effort` is absent from `/health` (verified)

The resolved effort appears in `mtplx settings` and in the server process's
argv, but not on `/health`. Checked against both the 2.10.1 and 2.11.1 wheels —
it has never been there, so this is a gap rather than a regression. A client
that wants to confirm which effort a server resolved to has no HTTP means to do
so.

`/health` does carry `reasoning`, `enable_thinking`, `preserve_thinking` and
`reasoning_parser`, so the omission looks accidental.

## 5. Effort validation is model-independent at the CLI (unverified)

`--reasoning-effort` accepts `{auto, low, medium, high, xhigh}` regardless of
model. This pack's own policy is narrower:

```
reasoning_policy.effort_levels   ["xhigh", "medium", "low"]
reasoning_policy.default_effort  "xhigh"
```

So `--reasoning-effort high` parses successfully against a model whose policy
does not list it. **We did not test whether it fails at request time** — but if
it does, it fails after a 77 GB model load. Gating the choices on the resolved
model's policy would fail it at parse time instead.

## 6. `serve --help` text is stale (verified)

`serve --help` describes the per-model turbo default as covering "the quantized
27B and 9B flagships". `start --help` correctly adds "and the Qwen 3.8
Flash-Next packs".

The behaviour is correct — `_apply_model_default_profile` keys off the
artifact's `recommended_profile`, and the runtime confirms it
(`[3/6] Runtime contract verified — profile: turbo`). Only the `serve` help
string is wrong, which is enough to make someone pass `--profile turbo`
redundantly, or assume they need to.

## Open question: `block_prefix` fallback with an exact prefix banked

On the request in item 1, the server reported `reusable_prefix_mode:
block_prefix` with 2,560 of 76,060 tokens reusable. At that moment the bank
held a 76,286-token prefix for the same session, and both before and after that
request the same session restored via `restore_kind: exact_prefix` (one later
request: 88,947 of 89,642 tokens, 695 new).

It was not an idle eviction — `idle_ttl_s` is 3600 s and the gap was ~13
minutes — and every entry in `eviction_log` is `superseded_by_longer_prefix`,
i.e. routine growth. The request immediately followed a client-side stall, so
the prompt may genuinely have diverged. We could not determine the cause and
are not going to guess; the data is here in case the pattern is familiar.

## Works well — no change wanted

**Session-bank observability is excellent.** `/health.session_bank` exposes
`idle_ttl_s`, `active_pin_ttl_s`, per-session `prefixes` with lengths and
access times, `last_prefix_diagnostic` (prompt length, common prefix, new
prefill tokens, restore kind, miss reason) and an `eviction_log` with reasons.
Every question asked of it during this investigation was answerable from that
one endpoint.

**Warm-path throughput is very good.** With the bank warm, effective tok/s runs
at 93% of decode — 99.7% cache-hit rate gives sub-second TTFT even on 65k
prompts. A 1,985-token completion at 65,757 context returned at 73.2 tok/s
decode / 72.6 effective after a 0.24 s wait.

## Possible throughput gain, 2.10.x → 2.11.1 (weak evidence)

Thermal-matched, from session logs, Flash-Next decode medians:

| Thermal | 2.10.x | 2.11.1 | Delta | Passes gates? |
|---|---|---|---|---|
| nominal | 51.5 (n=16, IQR 19.8%) | 70.0 (n=30, IQR 19.9%) | +36.1% | yes |
| moderate | 49.2 (n=14, IQR 27.3%) | 72.6 (n=32, IQR 25.0%) | +47.6% | no — spread |
| heavy | 45.9 (n=84, IQR 23.8%) | 62.1 (n=43, IQR 26.4%) | +35.4% | no — spread |

Gates are a 20% run-to-run drift floor and a 25% IQR ceiling, both measured on
this machine. One cell of three clears both; the other two point the same way
but are too noisy to count.

**A thermal-clamp observation you may find more useful than the delta.**
Effective tok/s by context band, within a single thermal state:

| Context band | 2.10.x heavy | 2.11.1 heavy |
|---|---:|---:|
| 20–45k | 34.6 (n=36) | — (n=1) |
| 45–75k | 34.6 (n=32) | 59.5 (n=24) |
| 75–130k | 34.3 (n=16) | 53.8 (n=18) |

At heavy thermal, 2.10.x is flat within 0.3 tok/s across three context bands on
n=36/32/16. That reads as a clamp rather than a decay curve — the thermal floor
sitting below whatever context decay would otherwise produce, so context stops
mattering. 2.11.1 at the same thermal state still decays (59.5 → 53.8), i.e. it
stays above that floor. In `nominal` and `moderate` both builds decay normally.

We cannot tell from this whether 2.11.1 is simply faster or generates less heat
for the same work — that needs power draw or a sustained fixed-load run, which
we did not do. If the clamp is a known governor behaviour, the flat 2.10.x line
may be more interesting to you than the version delta.

**This is not a benchmark.** It is real-session data, version attribution is
inferred from upgrade time rather than recorded (see item 3), and the two arms
differ in workload as well as build. Directionally encouraging; please do not
quote it as a measurement.
