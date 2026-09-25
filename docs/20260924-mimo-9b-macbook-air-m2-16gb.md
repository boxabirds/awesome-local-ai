# MiMo-V2.6-Qwen-9B on a MacBook Air M2 16 GB: not workable for agentic coding

**Verdict: fundamentally unworkable as a coding-agent machine.** The 20,480-token
context is set by 16 GB of memory, not by the chip, so no tuning fixes it; and on
this machine the model prefills at ~55 tok/s and decodes at ~5 tok/s. A trivial
request took **5 minutes 43 seconds over three turns and used a quarter of the
window.** The same holds for any 16 GB Mac running this pack: an M3/M4 would be
faster, but would get the same 20k window.

Tested 2026-09-24 with
[`mimo/2.6/9b/macos/16GB/mtplx-opencode`](../combinations/mimo/2.6/9b/macos/16GB/mtplx-opencode/README.md).
Everything below was measured on this machine unless it says otherwise.

## The machine

| | |
|---|---|
| Model | MacBook Air (`Mac14,2`) |
| Chip | Apple M2: 8-core CPU (4P + 4E), 10-core GPU |
| Memory | 16 GB unified |
| OS | macOS 26.6.2 |
| Server | MTPLX 2.12.0, pack `Youssofal/MiMo-V2.6-Qwen-9B-MTPLX-Optimized-Speed` (8.1 GiB of weights) |
| Client | pi 0.86.0 on node 24.15.0, launched with `./start.sh pi` |

MTPLX recommends this pack for M3 and later. It runs on an M2, but without
native BF16 for the vision tower and draft head (see the
[combination README](../combinations/mimo/2.6/9b/macos/16GB/mtplx-opencode/README.md#m1-and-m2-macs)),
so the speeds here are an M2's, not an M3's. The context window is not.

## Why the context is 20k, and why that can't move

MTPLX prints its own memory plan at startup. On this machine:

```
Memory plan: 16G Mac: engine budget 12.0G, weights 8.1G, context 20480 (machine-bound)
weights 8.1 GiB + runtime 3.25 GiB leave 0.67 GiB for KV under the 12.0 GiB engine budget
context window 20480 is machine-bound (model supports 262144); larger windows would swap on 16 GiB
```

The model supports 262,144 tokens. The machine leaves room for 20,480. Of those,
pi reserves 8,192 for the reply (`OUTPUT_LIMIT`), leaving **12,288 for the
system prompt, tool definitions, files and conversation**. Raising the engine
budget above 12 GB buys context by taking memory macOS needs, which is how this
machine froze (below).

For scale, from other runs recorded in this repo:

- Story 1 of the vidi benchmark (Qwen3.8-27B on the 4090): **14,847 prompt
  tokens** in context after reading the story's three spec files, before
  writing any code. That alone is more than this machine's 12,288. (Qwen3.8
  tokenizer; MiMo's Qwen3.5-based one will differ somewhat.)
- The same benchmark on Qwen3.8-Flash-Next (M5 Max 128 GB) peaked at
  **114,803 to 130,921 tokens per story**
  ([summary](../combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/benchmarks/vidi/canvas-pi-01/summary.md)).

pi's defaults make it worse. By the rule described in the combination README,
pi compacts once context passes `window − reserveTokens` = 20,480 − 16,384 =
**~4,096 tokens**, unless you add a per-model override that `./start.sh pi`
does not write. The session below passed that point on its third turn. (The
compaction itself was not observed; the session ended first.)

## Speed: one real pi session

The prompt was `create a fibonacci function in python`, in pi, through
`./start.sh pi`. Per request, from the MTPLX server log (`elapsed_s`,
`tok_s`, token counts) and pi's session file (`cacheRead`, which says how much
of each prompt was reused rather than prefilled):

| # | prompt | cached | new (prefilled) | prefill s | prefill tok/s | output | decode s | decode tok/s | total s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3,231 | 0 | 3,231 | 58.7 | 55.1 | 118 | 32.0 | 3.69 | 90.7 |
| 2 | 4,649 | 3,231 | 1,418 | 25.8 | 55.0 | 606 | 126.8 | 4.78 | 152.6 |
| 3 | 5,280 | 4,649 | 631 | 20.7 | 30.5 | 481 | 79.4 | 6.06 | 100.1 |

**Totals: 5,280 tokens prefilled in 105.1 s (50.2 tok/s); 1,205 tokens decoded
in 238.2 s (5.06 tok/s); 343.3 s of wall time.**

How the columns are derived: MTPLX logs decode speed and total time but not
prefill, so decode time = output ÷ decode tok/s, and prefill time = total −
decode time. Prefill tok/s is over the *new* tokens only, since pi's
`cacheRead` shows the rest was reused. For every request, the server's prompt
size equals pi's new + cached tokens exactly.

What that means in practice:

- **The first request costs about a minute before a single token appears**:
  pi's system prompt and tool definitions plus the one-line request are 3,231
  tokens, prefilled at ~55 tok/s.
- Filling the 12,288-token input budget from cold would take **~3.7 minutes of
  prefill** at that rate. That is arithmetic from the measured rate, not a
  measurement.
- At ~5 tok/s, a 500-token reply takes about 1½ minutes.

For comparison, measured the same day: Qwen3.8-27B on an RTX 4090 prefilled at
~2,000 tok/s and decoded at 77–111 tok/s; Qwen3.8-Flash-Next on the M5 Max
decodes at a median of ~59–66 tok/s.

A separate one-shot `./start.sh pi -- -p "Reply with exactly: OK"` ran for
8 minutes 1 second and printed no answer. Its server log was overwritten when
the server was restarted, so why is unknown.

## Memory, and the freeze

macOS's free-memory percentage (`memory_pressure`), sampled every second:

| | free at start | lowest | swap |
|---|---:|---:|---:|
| install + smoke test | 90% | 24% | 0 |
| reinstall + smoke test | 85% | 23% | 0 |
| `./start.sh pi`, one-shot request, 8 min | 83% | 23% | 0 |
| `./start.sh pi`, an earlier attempt (stopped by the test's own watchdog) | ~24% after load | 14% | 0 |

During the pi session MTPLX's own guard fired (`memory pressure guard ...
"action": "pressure_trim", "level": 2 ... "system_available_bytes":
1889785610`): **about 1.9 GB left for everything else on the machine.**

**The first install attempt froze the Mac and needed a hard restart.** Other
apps were open. The installer's smoke test starts the server, and the
launcher's pre-flight check got it right:

```
WARNING: profile 'coding' needs ~8909 MiB but only 4096 MiB is free.
         Not enough free memory for any profile; free some first.
         Continuing anyway in 5s (Ctrl-C to abort)...
```

Then it continued anyway. Nobody watches a smoke test to press Ctrl-C. MLX
wires the model's memory, and macOS cannot page wired memory out, so the result
was a hard freeze partway through loading the weights (the log stops at
`Model still loading... 130s elapsed`) rather than slow swapping. The same
warn-then-continue code is in four launchers (`lib/runtime/server-mtplx.sh`,
`server-sglang.sh`, and two places in `server-llamacpp.sh`). It is not fixed
yet.

## Found and fixed along the way

Neither of these is specific to 16 GB, but this Mac is where they showed up.

- **`./start.sh pi` (and `--opencode`, `--server-only`) failed on every Mac
  without `flock`.** `lib/runtime/session.sh` locked startup with `flock(1)`,
  which is Linux-only. It now falls back to perl's `flock(2)` on the same file
  descriptor. Test: `tests/session-lock-test.sh`.
- **The installer could not tell pi.dev from another program called `pi`.**
  Homebrew's Python had a 2013 package named `pi` installed, which crashes on
  Python 3. `_pi_find` accepted it, so pi.dev was never offered. It now
  accepts only a `pi` that resolves into `@earendil-works/pi-coding-agent` (or
  a volta or asdf-nodejs shim). Test: `tests/pi-find-test.sh`.

## What to do with a 16 GB Mac instead

Use it as the *client*, not the server: run pi or OpenCode on the Mac and point
it at a model served by a bigger machine over the network (`./start.sh --host
0.0.0.0` on the server). That gets the big machine's context and speed with the
Mac's editor and terminal. **Not tested in this repo yet.**
