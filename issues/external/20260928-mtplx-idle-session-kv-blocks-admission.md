> **Draft**, not filed. For sharing with the MTPLX maintainer.

**Title:** An idle session's live KV can't be reclaimed by the admission shed, so a smaller new request is refused (507) until restart

**Version:** MTPLX 2.12.0 (the latest release as of 28 Sep 2026)
**Machine:** Apple M5 Max, 128 GB, macOS 26.4 (25E246). Default memory limit (`limit_bytes` = 96.0 GiB in the guard events); `iogpu.wired_limit_mb` untouched.
**Model:** Qwen3.8 Flash-Next (`mtplx-flash-next-optimized-speed`)
**Launch flags:** `--paged-kv-quantization off --retrieval-max-resident 2 --no-auth --context-window 131072 --ssd-session-cache on --ssd-session-cache-max-size auto --ssd-session-cache-min-prefix-tokens 512 --draft-temperature 1.0 --draft-top-p 0.95 --draft-top-k 20`
**Client:** the pi coding agent, one conversation at a time. Its tools are bash, read, edit and write. It compacts at the context window minus 16,384 tokens (about 114k).

### What happened

One long coding conversation grew to about 113k tokens. pi then asked the model to summarise the older history (compaction), which is a new request of about 68–74k tokens under a new session id. MTPLX refused that request 13 times in a row with HTTP 507 `memory_refusal`:

> insufficient memory: this prompt projects 96.9 GiB against the engine's 96.0 GiB limit (0.9 GiB over) after the allocator cache and the session bank were reclaimed (73663 prompt tokens, 73663 not cached).

Meanwhile the long conversation kept being admitted, because its prefix was cached, until it was left 1 output token per turn. Neither could make progress. After restarting MTPLX, the identical 73,663-token request succeeded at once (3,146 tokens out, 83.9 GiB active).

| Time | Request | Prompt tokens | Cached | Result | Active memory |
|---|---|---|---|---|---|
| 20:56:10 | conversation | 113,610 | 111,115 | ok | 95.3 GiB |
| 20:56:10 | compaction (new session) | 67,833 | none | 507 | 91.6 GiB |
| 20:56:21–20:59:24 | compaction ×12 | 70,361–73,663 | none | 507 every time | 91.6–92.1 GiB |
| 20:59:16–21:00:22 | conversation ×8 | 128,418–128,437 | ≈ all | 1 token each (`length`) | 94.9–100.2 GiB |
| 21:04:31 | restart | | | | 77.6 GiB |
| 21:06:08 | the same 73,663-token compaction | 73,663 | 0 | ok | 83.9 GiB |

The summary request is smaller than the conversation, so there was room for it if the idle conversation's KV had been released.

### Why (our reading of the 2.12.0 source)

The admission shed (`_prefill_admission_shed`, `server/openai.py:18931`) frees memory in this order, and none of the steps can reach the idle conversation:

1. `mx.clear_cache()` (`server/openai.py:19156`). The allocator cache was already 0.
2. Superseded entries of the *incoming* request's session. The compaction has a new session id, so this matches nothing.
3. An LRU pass with `protect_active=True` (`server/openai.py:19198`). It skips any session active in the last `DEFAULT_ACTIVE_SESSION_PIN_TTL_S` = 600 s (`session_bank.py:250`). The conversation had sent a turn seconds earlier.
4. `shrink_for_admission` (`session_bank.py:3150`). Its `_evictable` filter (`session_bank.py:3206`) excludes every entry that holds a live cache reference (`cache_ref is not None` or `live_ref_only`). The conversation's entry holds one: the request carries coding-agent tools (`_anonymous_coding_agent_tool_request`, around `server/openai.py:20303`), so its KV is committed with a live reference.

The comment on `_evictable` explains the exclusion: *"Entries holding a live cache reference are the live session's own arrays … walking one frees nothing and costs the running session its state."* That's right while the session is running. But here the session was idle: its client was waiting for the summary. There doesn't seem to be any path that frees an idle session's live cache, or spills it to the SSD cold tier, under admission pressure. The in-flight set, which would tell idle from running, isn't consulted by the shed.

The numbers are consistent with the shed freeing nothing: 91.6 GiB active + `RUNTIME_TRANSIENTS_BYTES` (3 GiB, `memory_plan.py:54`) + the new prompt's planned KV comes to about the 96.9 GiB in the message. The message then suggests starting a new conversation, which is what the compaction request already was.

We haven't confirmed this with a debugger. The per-refusal `[mtplx] memory guard` log lines (`bank_bytes_before/after`, `lru_entries_evicted`, `chain_entries_evicted`) would show directly whether anything was evicted.

### Reproduction

1. Start MTPLX 2.12.0 with the flags above on a 128 GB Mac, serving Flash-Next.
2. With an agent that sends coding tools (pi in our case), grow one conversation past about 110k tokens.
3. Send a new request, under a new session id, of about 70k uncached tokens while the first session is still resident. With our client that happens naturally at compaction.

### Suggestion

Under admission pressure, for a request that is a full cache miss, let the shed release (or spill to SSD) the live-cache entries of sessions that aren't in flight, using the in-flight set rather than the 600 s activity pin. The SSD session cache is on, so the idle conversation could be restored later.

A smaller point: `protect_tokens` in `shrink_for_admission` protects the entry sharing the longest prefix with the new prompt, with no minimum length. A few shared chat-template tokens seem enough to protect an unrelated entry.

Possible workarounds, which we haven't tried:
- on a 507 `memory_refusal`, the client calls `POST /admin/sessions/{session_id}/clear` for the idle session and retries;
- `MTPLX_SESSION_BANK_ACTIVE_PIN_TTL_S=0`, which lets the LRU pass consider the idle session, at the cost of the pin's protection for every session.

### Related observation, possibly a separate issue

Over the same server lifetime, `host_overhang_bytes` in 23 `prefill_admission_shed` events rose 1.0 → 1.9 → 10.9 → 13.1 → 13.3 GiB and reached 14.2–14.8 GiB by the refusals above, against a 16 GiB `host_allowance_bytes`. It never came down, even through cache clears. The process's `phys_footprint` went from 92 to 109 GiB, briefly 117. The comment above `_HOST_MEMORY_ALLOWANCE_FLOOR_BYTES` (`server/openai.py:18802`) puts a healthy daemon at 3–6 GiB plus up to 4 GiB of SSD writer backlog, so this is about 2.5 times that.

We don't know what it is made of. From the source, two things could hold more than their caps: the n-gram hot-row cache, if cached rows keep their whole fetch batch alive, and a single oversized SSD write entry admitted past the backlog cap. Neither is confirmed. A `footprint -p <pid>` breakdown of a long-running daemon would settle it, and we're happy to share one if we reproduce it.
