# MTPLX 2.12.0: the memory guard refuses a coding agent's compaction request, and the conversation deadlocks

For Youssof (MTPLX). Written 24 Sep 2026 by Julian Harris.

**Summary.** A coding agent ran one long conversation against MTPLX 2.12.0 on a 128 GB Mac. When the conversation neared the context window, the agent asked the model to summarise the older history so it could continue (compaction). MTPLX refused every one of those summary requests with HTTP 507, 13 in a row, while it kept the long conversation's own KV in memory. The conversation could then neither shrink nor continue: every further turn was allowed 1 output token. Only restarting MTPLX cleared it, after which the identical summary request succeeded at once.

Everything below comes from MTPLX's own request log (`~/.mtplx/logs/request-log-<port>.jsonl`) and server stdout, unless it's marked otherwise.

## Setup

| | |
|---|---|
| Machine | Apple M5 Max, 128 GB, macOS 26.4 (25E246) |
| MTPLX | 2.12.0, default memory limit (`limit_bytes` in the guard events = 96.0 GiB); `iogpu.wired_limit_mb` untouched |
| Model | `Youssofal/Qwen3.8-Flash-Next-MTPLX-Optimized-Speed`, served as `mtplx-flash-next-optimized-speed` |
| Client | the **pi** coding agent (pi.dev, `@earendil-works/pi-coding-agent` 0.86.0) talking to `/v1/chat/completions`, streaming, tool calls, one conversation per task, default settings |
| Workload | an autonomous agent building a web app over several hours: many short turns, each extending the same conversation, with tool output (file contents, test logs) appended |

**Exact server command** (from `ps`; started by our launcher script):

```
python -m mtplx.server.openai --model ~/.mtplx/models/Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed \
  --backend-id native_mtp --host 127.0.0.1 --port 18010 --depth 3 --generation-mode mtp --profile turbo \
  --reasoning-mode on --preserve-thinking auto --verify-strategy batched --verify-core linear-gdn-from-conv-tape \
  --draft-lm-head-bits 4 --draft-lm-head-group-size 64 --draft-lm-head-mode affine --rate-limit 0 --stream-interval 1 \
  --scheduler-mode serial --batching-preset latency --mtp-batch-numerics throughput --warmup-tokens 16 \
  --model-id mtplx-flash-next-optimized-speed --paged-kv-quantization off --fan-mode default --retrieval-max-resident 2 \
  --no-auth --context-window 131072 --ssd-session-cache on --ssd-session-cache-max-size auto \
  --ssd-session-cache-min-prefix-tokens 512 --draft-temperature 1.0 --draft-top-p 0.95 --draft-top-k 20 \
  --draft-sampler-source default --tool-prompt-mode hybrid --chat-template-profile tokenizer --max-response-tokens 32768 \
  --temperature 1.0 --top-p 0.95 --top-k 20 --enable-thinking --reasoning-parser qwen3 --reasoning-effort low
```

**What pi's compaction does.** This is checked in pi's source, `dist/core/compaction/compaction.js`:
- It compacts when the conversation exceeds `contextWindow − reserveTokens`. Here that's 131072 − 16384 = 114,688 tokens.
- It keeps the most recent `keepRecentTokens` (20,000) of the conversation as they are.
- It sends everything older, plus an instruction to summarise it, as a **separate request**.
- That request starts with a different prefix from the conversation, so MTPLX sees a new session each time: `request_session_source: "new"`, and a new `anon-…` session id per attempt.
- If a summary fails, pi carries on with the full conversation and tries again at the next threshold or overflow.

## 1. The deadlock (measured)

Condensed from the request log. The conversation's session id is `anon-909c9077673dcb79`; each compaction attempt is a new session id.

| Time | Request | prompt tokens | cached | result | `effective_max_tokens` | active memory |
|---|---|---|---|---|---|---|
| 20:45:58 | conversation | 65,354 | 64,045 | ok | 32,768 | 95.6 GiB |
| 20:53:09 | conversation | 86,557 | 86,480 | ok | 32,768 | 92.8 GiB |
| 20:56:10 | conversation | 113,610 | 111,115 | ok | 13,565 | 95.3 GiB |
| 20:56:10 | **compaction** (new session) | 67,833 | none | **507 memory_refusal** | — | 91.6 GiB |
| 20:56:21 | compaction | 70,361 | none | **507** | — | 91.7 GiB |
| 20:56:42 | compaction | 72,037 | none | **507** | — | 91.7 GiB |
| 20:58:14 – 20:59:24 | compaction ×10 | 73,663 | none | **507** every time | — | 91.6–92.1 GiB |
| 20:59:16 – 21:00:22 | conversation ×8 | 128,418–128,437 | ≈ all | 1 token each, `length` | **1** | 94.9–100.2 GiB |
| 21:04:31 | MTPLX restarted (warm-up) | 6 | 0 | ok | 16 | 77.6 GiB |
| 21:06:08 | compaction, identical 73,663-token request | 73,663 | 0 | **ok, 3,146 tokens** | 13,107 | 83.9 GiB |

The refusal text, from one of these requests:

> insufficient memory: this prompt projects 96.9 GiB against the engine's 96.0 GiB limit (0.9 GiB over) after the allocator cache and the session bank were reclaimed (73663 prompt tokens, 73663 not cached). The engine stays up and keeps its sessions; this request was refused before prefill instead of pushing the Mac into swap.

The guard's own event just before the refusals shows what was using the memory:
- `active_bytes` ≈ 98.4 GB (91.6 GiB), with `cache_bytes` 0 after it cleared the cache.
- `host_overhang_bytes` ≈ 14.2 GB, against a `host_allowance_bytes` of 16 GiB.

**Why this is a deadlock:**
- The summary request is *smaller* than the conversation (74k tokens against 113–128k). It only fails because the conversation's own KV is still resident.
- The guard releases the allocator cache and the session bank, but not that resident KV. The conversation isn't in flight while its client waits for the summary.
- The conversation keeps being admitted because its prefix is cached, and it runs until only 1 output token is left.
- After that, nothing can make progress without restarting the server. The client has no way to free MTPLX memory.

**What would fix it (suggestions):**
1. Before refusing a new prompt, evict or spill to SSD the KV of sessions that aren't in flight. The SSD session cache is on, so the conversation could be restored later.
2. Alternatively, give the refusal a signal that a retry can't succeed while session X stays resident. That would let a client choose to drop that session.
3. As a smaller step: when a request is refused, say which resident session is holding the memory.

## 2. How to reproduce

**A. With the real client (how it happened).**
1. Start MTPLX 2.12.0 with the command above on a 128 GB Mac.
2. Point pi 0.86.0 at it. Its `models.json` provider uses `"api": "openai-completions"`, `contextWindow` 131072, `maxTokens` 32768 and `compat: {supportsDeveloperRole: false, supportsReasoningEffort: false}`; pi's settings stay at their defaults.
3. Give it a long, multi-file coding task so that a single conversation grows past 114,688 tokens.

In the incident, the conversation reached the threshold about an hour into the task. It happened in 1 of the 9 agent tasks run so far. Two earlier tasks had 507 refusals (3 in all, one of them at 75,961 tokens) and recovered, because the client started a fresh conversation from the same history.

**B. Standalone script (stdlib Python).** Use [`mtplx-repro/compaction_refusal.py`](mtplx-repro/compaction_refusal.py):
1. The script grows one conversation to about 115k tokens, one turn at a time with a shared prefix.
2. It then sends an unrelated 74k-token request, which is the shape of pi's compaction request.
3. It exits 0 if that request gets a 507.

**Caveat:** I wrote the script from the log above and **have not run it yet**. The only machine that can run it was busy with the benchmark. Its prompts are synthetic, so memory use may differ from the real session. If it doesn't reproduce, method A does, and the full log rows are available.

## 3. Host-side memory grows through a session (measured; may be by design)

Across 23 `prefill_admission_shed` events in one server lifetime, `host_overhang_bytes` rose steadily and never came back down, even through cache clears:
- 1.0 GiB, 1.9, 10.9, 13.1, then 13.3 GiB;
- by the deadlock above, 14.2–14.8 GiB.

That's close to the 16 GiB `host_allowance_bytes`. Over the same period GPU-side `active_bytes` stayed within 82–93 GiB, and the process's `phys_footprint` went from 92 to 109 GiB, briefly 117 GiB. macOS stayed healthy throughout: swap under 1.6 GB and free memory mostly 20–28%.

**Questions:**
- What is the host overhang made of? Streamed n-gram table pages, the SSD session cache's cold tier, or Python buffers?
- What happens when it reaches the allowance?
- Is 96 GiB GPU plus 16 GiB host the intended ceiling on a 128 GB machine?

Separately, the request log's `active_memory_bytes` reached 100.4 GiB, above the 96 GiB limit. Guard events never showed `active_bytes` above 93.3 GiB. Is the request-log figure a peak taken during decode or verify?

## 4. Lower-confidence observations

These are included for completeness. Each was measured, but each has a confounder or an older version.

1. **2.11.3: kernel panic.**
   - The panic: `panic(cpu 6 …): watchdog timeout: no checkins from watchdogd in 92 seconds`, during a session at 112–115k tokens, with request-log peak memory 97.2 GiB.
   - **Confounded:** a third-party screen saver leaking about 10 GB was resident at the time. It has since been removed. We can't attribute the panic to MTPLX alone.
2. **2.12.0 with `MTPLX_MEMORY_LIMIT_BYTES=88G`.**
   - The guard refused cleanly at 85–89k tokens, with the same clear message as above.
   - Later, the SSD session cache failed to save with `RuntimeError: [Event::Event] Failed to create Metal shared event`.
   - **Confounded:** swap was at 17.7–18.4 GB, with the same leak present. Could the cache skip saving under memory pressure rather than raise?
3. **2.11.1, 27B Optimized-Quality pack: stall followed by a stuck session.**
   - At 51–86k tokens: `mtplx_stream_stall_break` with `owner_frozen_s` 300.2 and `streamed_tokens` 0.
   - Every later request on that session id got 409 `session … is already in flight`, even though `/health` showed `active_requests` 0.
   - Not re-tested on 2.12.

## Data available on request

- The request-log rows for every window above, as JSONL.
- The server stdout, including the guard events and the 507 messages.
- 15-second `footprint -p` samples of the server process.
- The full panic report.
- pi's own event log for the deadlocked conversation.
