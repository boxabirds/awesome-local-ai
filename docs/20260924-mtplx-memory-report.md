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

## 1. 2.12.0 at stock: process memory runs past the engine budget (measured)

This covers 562 requests over about 1.5 hours of continuous agent use after 11:30. There were no 507 refusals.

| Context band | Requests | Max `active_memory_bytes` | Max `peak_memory_bytes` |
|---|---|---|---|
| 0–32k | 48 | 97.6 GiB | 98.0 GiB |
| 32–64k | 193 | 95.1 GiB | 98.0 GiB |
| 64–96k | 192 | 96.0 GiB | 100.4 GiB |
| 96k+ | 129 | 100.4 GiB | 100.4 GiB |

- 516 of the 562 requests logged `peak_memory_bytes` above 96 GiB, at contexts from 2.6k to 128.6k.
- The highest reading was active = peak = 100.4 GiB, at context 128,606.
- macOS `footprint -p` on the server's Python process, sampled every 15 s, read 92–102 GB. `phys_footprint_peak` was 104 GB.
- The machine stayed healthy: swap flat at ~0.6 GB, free memory at 24–28%.

**Question:** what is the default engine limit on a 128 GB machine, and which number does the guard compare against it?
- I had understood the default to be 75% of RAM (96 GiB).
- If that is right, active memory went 4.4 GiB over it and the guard never refused anything.
- If the limit excludes something by design (the weights, the n-gram table mapping, the session bank's 15.8 GB ceiling), it would help to know what is excluded, so users can size headroom.

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

Why I'm raising it anyway: 2.12.0 at stock (section 1) runs about 3 GiB higher than the 2.11.3 pre-panic readings. On a 128 GB machine that leaves little margin for anything else the user runs.

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
