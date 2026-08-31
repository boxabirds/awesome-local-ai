# Measured results — Qwen3.8-27B / Ubuntu / 24GB NVIDIA / llama.cpp

Raw output from the harnesses in [`benchmarks/`](../../../../../../../../benchmarks/),
run on **RTX 4090 24GB (24,047 MiB usable), Ubuntu 22.04.5, driver 580.159.03,
CUDA 12.3**, on **2026-08-16**, against `Qwen3.8-27B-UD-Q4_K_XL` with the
ggml-org MTP head.

These are the primary sources for every number in
[`docs/discovery.md`](../../../../../../../../docs/discovery.md), in
[`profiles.tsv`](../profiles.tsv) and in [`help.txt`](../help.txt). If a figure
in this repo is not traceable to a file here, treat it as unverified.

| File | Harness | What it shows |
|---|---|---|
| [`niah-64k.txt`](niah-64k.txt) | `run-niah.sh` | KV quantisation vs retrieval at 64k, 63,116-token haystack. `f16` **8/8**, `q8_0` **8/8**, `q4_0` **8/8** |
| [`niah-128k.txt`](niah-128k.txt) | `CTX=131072 run-niah.sh` | the same at the shipped 128k default, 126,760-token haystack. `q4_0` **8/8** |
| [`throughput-thinking.txt`](throughput-thinking.txt) | `tokbench.sh` | thinking on 73.1 tok/s aggregate over 1,602 tokens; off 78.9 tok/s over 621. Rate barely moves; **volume is 2.6x** |
| [`ctx-probe-1.txt`](ctx-probe-1.txt) | `ctxprobe.sh` | the starting point: 32k with vision, and where dropping vision gets you |
| [`ctx-probe-2.txt`](ctx-probe-2.txt) | `ctxprobe2.sh` | the q8_0 ceiling, and `-ub 256` turning a 96k OOM into a load |
| [`ctx-probe-3.txt`](ctx-probe-3.txt) | `ctxprobe3.sh` | the hard ceiling: 160k loads, 192k does not |
| [`profile-refit.txt`](profile-refit.txt) | `refit.sh` | the shipped profile table — VRAM, headroom and real prefill per profile |
| [`reasoning-effort.txt`](reasoning-effort.txt) | `effort.sh` | what each `reasoning_effort` level costs: `xhigh` is 3.5x the reasoning and 2.0x the total output of `low`, at the same tok/s |
| [`session-lifecycle.txt`](session-lifecycle.txt) | `lifecycle-test.sh` | idle-shutdown behaviour: server stays up with a live client, exits 45s after the last one |
| [`logs/`](logs) | all | raw `llama-server` output, including the OOM messages the failures are read from |

## Reading the retrieval numbers

8/8 everywhere, including `f16`. That is **no evidence of harm from 4-bit KV**,
not proof of parity — the unquantised control also scored 8/8, so the test
never demonstrated it could detect damage. `discovery.md` §8b sets out what
this does and does not establish; the short version is that verbatim recall of
a distinctive six-digit code is the easiest long-context task there is.

Note also what the haystack *is*: 854 (at 64k) or 1,699 (at 128k) synthetic
filler paragraphs about harbour administration, delivered as **one user turn**.
It is not a conversation history, and nothing here measures multi-turn
behaviour, code comprehension, or reasoning over dispersed facts.

## Reading the throughput numbers

The per-request rates in `throughput-thinking.txt` are end-to-end over HTTP;
the `server-reported eval` line is llama.cpp's own figure and runs higher
because it excludes request overhead. Draft acceptance is logged per request
and ranges 0.56–0.93 — the ~92 tok/s headline elsewhere in this repo is a
best-case single-request figure, not the aggregate you see here.

## Re-verification

`effort.sh` was run on **2026-08-31**, after the default reasoning effort moved
from the template's `xhigh` to `low`. `lifecycle-test.sh` was re-run the same day against the restructured
`local-ai-session` and reproduced the original result exactly — server held up
past the 45s idle timeout by a live client, shut down 45s after it exited. The
retrieval and throughput runs have not been re-run since 2026-08-16; they
predate the restructure but the launcher emits byte-identical `llama-server`
arguments, so the configurations they measured are unchanged.
