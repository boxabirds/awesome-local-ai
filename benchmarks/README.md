# Benchmarks

The harnesses that produced every measured number in this repo. They are here
so the figures in [`docs/discovery.md`](../docs/discovery.md) and in each
combination's `profiles.tsv` can be re-derived rather than taken on trust.

Results live with the combination they were measured on, not here — e.g.
[`combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/benchmarks/`](../combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/benchmarks/).
Same split as the rest of the repo: harness is shared, measurements are data.

## Running them

Each script sources `lib.sh`, which reads the install manifest written by an
`install-*.sh` run. It measures whatever you have installed:

```bash
./run-niah.sh                                  # KV quantisation vs retrieval, 64k
CTX=131072 HAY=120000 KVS=q4_0 ./run-niah.sh   # the same at the 128k default
./tokbench.sh                                  # generation throughput, thinking on vs off
./ctxprobe.sh && ./ctxprobe2.sh && ./ctxprobe3.sh   # how much context fits
./refit.sh                                     # profile table: VRAM + real prefill
./vprobe.sh                                    # the same with vision enabled
./lifecycle-test.sh                            # idle-shutdown regression test (~3 min, 1 model load)
```

| Variable | Default | |
|---|---|---|
| `LOCAL_AI_INSTALL_REL` | `.local/share/qwen38-27b` | which install to measure |
| `OUT` | `./results` | where server logs land |
| `USABLE_MIB` | `24047` | device memory actually available, for the headroom column |
| `PORT` | per script | scratch port, deliberately not 8080 |

**These load the model repeatedly.** `ctxprobe*.sh` boots it a dozen times and
several of those boots are *meant* to OOM — that is the measurement. Do not run
them while you need the GPU.

`USABLE_MIB` is not the card's nameplate size. On the RTX 4090 these numbers
were taken on, 24,564 MiB total left 24,047 MiB usable with a desktop running;
that is the figure the headroom columns subtract from.

## What each one measures

| Script | Question |
|---|---|
| `niah.py` | needle-in-a-haystack core: 8 six-digit codes at depths 4%–95%, `temperature=0, top_k=1`, one seeded haystack shared as a prefix so the prompt cache makes queries after the first cheap |
| `run-niah.sh` | does KV quantisation cost retrieval accuracy? sweeps `q8_0`/`q4_0`/`f16` at one context size |
| `tokbench.sh` | thinking on vs off: separates *rate* (tok/s) from *volume* (tokens emitted) — only volume should change |
| `ctxprobe.sh` | baseline fit: how far does context go with vision, MTP, default batch? |
| `ctxprobe2.sh` | finding the q8_0 ceiling, and what `-ub 256` buys |
| `ctxprobe3.sh` | the hard ceiling, plus `llama-bench` prefill cost of the small micro-batch |
| `refit.sh` | the shipped profile table: VRAM *and* real prefill throughput per profile |
| `vprobe.sh` | the same with the vision projector loaded |
| `lifecycle-test.sh` | does a live client hold the server up, and does it shut down once the last one exits? |

## A note on the duplication

`ctxprobe*.sh`, `refit.sh` and `vprobe.sh` each carry their own near-identical
`try()` — boot the server, poll `/health`, record VRAM, kill it. The rest of
this repo goes to some trouble to avoid exactly that, and these are the
deliberate exception: they are lab scripts preserved **as run**, and the
published numbers came out of these bodies. Refactoring them into a shared
harness would mean the numbers in `discovery.md` no longer trace to the code
that produced them, and re-running the full suite to re-establish that costs
about an hour of model loads.

Only the environment was changed on the way in: hardcoded model paths and a
scratch directory became `lib.sh` lookups against the install manifest. The
measurement logic is untouched.

If you add a probe, reuse `lib.sh` and feel free to share a `try()` with it —
the exemption is for the existing scripts' provenance, not a licence for new
duplication.
