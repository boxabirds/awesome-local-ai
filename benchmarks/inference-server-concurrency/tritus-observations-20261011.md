# What 11 hours of a gufo server's log say (tritus, 11 Oct 2026)

**Setup.** The Strix Halo box (tritus), gufo as pinned by the `gufo-pi` combination, Qwen3.8-Flash-Next UD-Q4_K_XL with the shared MTP head, started with `--context 196608 --sessions 1 --draft-tokens 7`, driven by one person's OpenCode (and possibly other clients; the log names none). No benchmark was running. The log is `podman logs` of the container: 257 completed requests between 08:37 and 19:44 on the machine's clock. **It is a single server's traffic under one person's use, not a designed experiment.** The figures below are reproduced by [`scripts/analyse_gufo_log.py`](scripts/analyse_gufo_log.py) on that log; the log itself is operational data and is not in this repository.

## How busy it was

- The server was working **14.9% of the 11.1 hours**. 79% of the 10-minute windows were nearly idle (under 10% busy); only 9% were over 80% busy. In the 14 windows with real activity it averaged **70%**.
- A direct sample of the GPU's busy counter (`gpu_busy_percent`, once a second for 60 s at about 19:45, while an agent was working) read **97% on average (maximum 98%, and none of the 60 samples at 0%)**, with requests back to back at 137k to 139k tokens.
- So a low average (the owner saw about 25%) is mostly idle time between sessions. **While an agent works, the GPU is not under-used.**
- A gap between one request finishing and the next arriving is a median 0.5 s (p90 38 s); 66 of 256 requests arrived while the previous one was still running.

## Queueing

- Median queue 86 ms, p90 6.3 s, max 49.9 s; **31 of 257 requests waited more than 5 s**. When a request did not queue, its first token came in about 0.8 to 1.0 s at 65k to 70k tokens.
- The server runs one request at a time (`plan=serial-c1`, `batch_width=1`). The log does not say who sent overlapping requests, so one client sending in parallel and several clients cannot be told apart.
- Two requests hit the 32,768-token output limit (`finish=length`): 8.5 and 16.9 minutes. Nothing was queued behind the longer one. Generated tokens per request: median 207, p90 966, p99 10,028.

## Long context and the cache (runaway generations left out)

| Prompt | n | Median decode | Tokens re-read (median / p90) | First token, queue excluded (median / p90) |
|---|---|---|---|---|
| under 100k | 165 | 40.0 tok/s | 942 / 7,526 | 1.3 s / 6.8 s |
| 100k to 131k | 53 | 37.5 | 859 / 3,075 | 1.5 s / 3.7 s |
| 131k and over | 30 | 38.0 | 562 / 4,125 | 1.4 s / 4.6 s |

- The largest prompt was 155,549 tokens; one request started at 127k and generated 32,768 more (a position of about 160k) at an average 32.4 tok/s with no error. **Nothing above 155,549 was seen**, so 156k to 196k and all of 256k are untested.
- The snapshot cache (auto-sized at 17,308,041,216 bytes) ran 90% to 98.5% full and skipped snapshots for `byte_capacity` 259 times, yet the median re-read stayed under 1,000 tokens. The worst seen was a 6,009-token re-read (8.2 s) at a 137k prompt.
- A snapshot costs 28.4 KB per token at 127k (3.61 GB at 127,272 tokens), 30.2 KB at 43k.

## Memory

- GPU memory in use 89,385 MiB of 122,880 at `--context 196608`; the only earlier measurement is 87,849 MiB at 131072 with a 120k prompt. The difference, 1,536 MiB for 65,536 tokens, is exactly 24 KiB per token.
- Available RAM stayed between 15.6 and 29.2 GB; gufo's resident memory grew from 3.6 GB to a plateau near 17 GB (mostly the snapshot cache). Swap held 2.1 to 2.4 GB with 0 KB/s swapped in or out when sampled.

## Draft depth (the cap is 7)

gufo logs `draft_accepted`, `draft_proposed` and `acceptance_pct` per request but **not the depth per step**. If a step yields its accepted drafts plus one verified token (an assumption), steps = generated - accepted, and over the whole log gufo proposed **2.36 drafts per step**, accepted 73.9% of them, and produced 2.75 tokens per step. Per request (those with at least 200 tokens): median 2.67, p90 3.93, maximum 6.10. gufo adapts below the ceiling, so by the "raise the cap when observed depth reaches it" rule, 7 is not binding; whether a cap of 4 would help or merely clip the tail needs an A/B. Until the harness fix of 11 Oct 2026 the depth was also masked as `***` in every gufo benchmark record (a rule meant for API keys matched `--draft-tokens`).

## Cold starts

9 of 257 requests started with under 20% of the prompt cached:

| Prompt tokens | Took | Probably |
|---|---|---|
| 568, 581 | 1.5, 2.2 s (28 and 65 tokens generated) | OpenCode title calls (*inferred*) |
| 9,735, 9,852, 10,185 | 11.6, 10.1, 11.7 s | a fresh agent's first request |
| 21,086 | 20.4 s | |
| 54,689 | 17.4 s (0 generated) | |
| 56,660 | 60.7 s | a cold 57k prefill |
| 120,562 | 182.9 s (3,397 generated) | a cold 120k prefill, then a long answer; possibly a compaction (*inferred*) |

A restored prefix cost 19.6 to 391 ms in the lines examined. A cold 10k start costs 10 to 12 s; a cold 120k one costs minutes. That is the whole case for prefix sharing between forked subagents.

## A simulation of N agents sharing the one-at-a-time server

Closed loop: each agent repeatedly waits its think gap and then sends a request whose service time is drawn from this log (gaps over 300 s dropped as "a person away", runaway generations excluded; 241 of 247 request pairs kept). One working agent alone keeps the server about **62%** busy (median service 7.2 s, p90 21.4 s).

| Agents | Mean wait per request | p90 wait | Server busy | Each agent takes |
|---|---|---|---|---|
| 1 | 0 s | 0 s | 62% | 1.00x as long |
| 2 | 6.5 s | 15.1 s | 88% | 1.41x |
| 3 | 15.6 s | 32.9 s | 97% | 1.91x |
| 4 | 26.3 s | 53.9 s | 99% | 2.50x |

So sharing the serial server raises total throughput about 1.4x at two agents and about 1.6x at three or four, then stops. Assumptions: requests are independent, service time does not change with sharing, and the log already contains some overlap. This is a model, not a measurement of two live agents.
