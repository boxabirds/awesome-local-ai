# MTPLX memory in long agent sessions — report for Youssof, 2026-09-24

Most of this comes from MTPLX's own request log (`~/.mtplx/logs/request-log-<port>.jsonl`, fields `active_memory_bytes`, `peak_memory_bytes`, `context_len`) plus `footprint -p` samples of the server process.

Each item is labelled:
- **measured**: seen directly;
- **confounded**: something else was also consuming memory at the time;
- **question**: something I don't understand.

## Environment

| | |
|---|---|
| Hardware | Apple M5 Max, 128 GB, macOS 26.4 (25E246) |
| MTPLX | 2.11.3, then 2.12.0 (items below say which) |
| Model | `Youssofal/Qwen3.8-Flash-Next-MTPLX-Optimized-Speed`, served as `mtplx-flash-next-optimized-speed`, mtp_depth 3, ctx 131072 |
| Memory limit | stock (no `MTPLX_MEMORY_LIMIT_BYTES`), except in section 3 |
| `iogpu.wired_limit_mb` | untouched (macOS default) |
| Client | pi 0.86.0, one agent session per task; context grows to ~115k, then pi compacts |
| Workload | coding-agent benchmark: many tool calls per session, prompt-prefix reuse via the session bank |

## 1. 2.12.0 at stock: the guard works, but host overhang climbs all session (measured)

The first version of this section said memory "overshot the budget". That was wrong: it read the process footprint without the host allowance. The guard's own events give the real picture.

**What the guard reports.** The server logged 23 `prefill_admission_shed` events since it last started, covering stories 5 and 7 of the run with continuous agent use. Every one shows the same settings:
- `limit_bytes` 96.0 GiB;
- `threshold_bytes` 93.1 GiB;
- `host_allowance_bytes` 16.0 GiB.

**It behaves as designed:**
- It clears the allocator cache and admits the prompt when the projection after clearing is within the limit.
- It has refused one prompt so far: 75,961 tokens, projected 96.5 GiB after clearing. The client forked the session and carried on.

**What climbs steadily: `host_overhang_bytes`.** Selected events, in order:

| Event | Prompt tokens | `active_bytes` | `host_overhang_bytes` | `phys_footprint_bytes` |
|---|---|---|---|---|
| 1st | 34,794 | 88.4 GiB | 1.0 GiB | 92.3 GiB |
| 4th | 97,583 | 88.1 GiB | 1.9 GiB | 97.8 GiB |
| 10th | 109,971 | 81.8 GiB | 10.9 GiB | 100.6 GiB |
| 15th | 24,210 | 89.7 GiB | 13.1 GiB | 107.6 GiB |
| 21st (the refusal) | 75,961 | 93.3 GiB | 13.2 GiB | 109.2 GiB |
| 23rd | 31,113 | 86.0 GiB | 13.3 GiB | 107.4 GiB |

- The GPU-side `active_bytes` stays in an 82–93 GiB band throughout.
- `host_overhang_bytes` rises from 1.0 to 13.3 GiB and never comes back down. Pi compacts several times in this span, and cache clears happen too.
- One raw event reported `phys_footprint_bytes` at 115.3 GB (107.4 GiB), which fell to 109.5 GB once the cache was cleared.
- The machine stayed healthy: swap flat at 0.6–1.6 GB, and free memory mostly 20–28%, dipping to 16%.

**Questions:**
1. What is the host overhang made of, and is it meant to grow without bound until it reaches the 16 GiB allowance? Candidates I can think of: n-gram table pages streamed from SSD, the session bank's cold tier, or Python-side buffers. What happens when it reaches 16 GiB?
2. Is 96 GiB GPU plus 16 GiB host (about 120 GB) the intended ceiling on a 128 GB machine? That leaves about 8 GB for macOS and everything else.
3. The request log's `active_memory_bytes`/`peak_memory_bytes` reached 100.4 GiB, at context 128,606, while no guard event ever saw `active_bytes` above 93.3 GiB. Is the request-log figure taken at a different point, such as the peak during decode or MTP verify? If so, are transients above the 96 GiB limit expected?

Health at startup: `session_bank.max_bytes` 16.8 GB, `effective_max_bytes` 15.8 GB, `per_session_max_bytes` 8.4 GB, `max_entries` 48.

## 2. 2.11.3: kernel panic during a long session (measured, confounded)

Panic string:

```
panic(cpu 6 caller 0xfffffe003c321d7c): watchdog timeout: no checkins from watchdogd in 92 seconds (7148 total checkins since monitoring last enabled)
```

- **Before the panic:** in the last 30 minutes of the request log there were 68 requests. The highest reading was `peak_memory_bytes` 97.2 GiB at context 91,143, with active 86.0 GiB. The agent session was at ~112–115k context when the machine went down.
- **Confounder:** a third-party screensaver with a leak of roughly 10 GB was resident at the time. It has since been uninstalled. So I can't attribute the panic to MTPLX alone.
- **What I think is plausible, but unproven:** the model's working set plus a ~10 GB leak left too little room for the rest of the system.
- **Earlier warnings:** JetsamEvent reports on 18 Sep 15:00, 23 Sep 13:51 and 23 Sep 17:31, all on earlier MTPLX versions, show ~82 GiB wired and 0.4 GiB free.

Why I'm raising it anyway: on 2.12.0 at stock, the process footprint reaches 107–109 GiB (section 1). I have no footprint readings from 2.11.3 to compare it with, only the engine's own peak. Either way, a 109 GiB process on a 128 GB machine leaves little margin for anything else the user runs, such as a 10 GB leak.

## 3. 2.12.0 with `MTPLX_MEMORY_LIMIT_BYTES=88G` (measured, confounded)

**The guard worked as documented.** Prompts at ~85–89k context were refused with 507, and the messages were clear:

> this prompt projects 88.1 GiB against the engine's 88.0 GiB limit … after the allocator cache and the session bank were reclaimed

(Also 88.8 and 89.1 GiB.) After that, memory was shed at 12–40k context.

**Then it failed:**

```
RuntimeError: [Event::Event] Failed to create Metal shared event
```

- This happened in the SessionBank SSD serialize path.
- Swap was at 17.7–18.4 GB at the time, and the screensaver leak was still present, so this is heavily confounded.
- **Question:** is this failure expected under memory pressure? If so, could the bank fail soft here (skip persisting) rather than raising?

The 88G cap made an agent session unusable: repeated refusals near ~88k context, where pi does not compact until ~115k. I went back to stock.

## 4. Separate, older: 2.11.1 stall followed by a stuck session lock (measured)

This used the 27B Optimized-Quality pack on 2.11.1, and I have not re-tested it on 2.12.0.

1. At ~51–86k context, the log showed `mtplx_stream_stall_break` (`owner_frozen_s` 300.2, `streamed_tokens` 0).
2. After that, every request on that session id got 409 `session ... is already in flight`. This persisted even while `/health` showed `active_requests` 0.
3. I worked around it by forking to a new session id.

## Data I can send

- The request-log extract for each window above: the JSONL rows with the memory and context fields.
- The server stdout logs, including the 507 messages and the Metal traceback.
- `footprint` samples at 15 s intervals, and the full panic report.
- The server log for the 2.11.1 wedge.

Home paths are scrubbed before sending.
