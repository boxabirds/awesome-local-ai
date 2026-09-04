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
./effort.sh                                    # reasoning_effort cost, one model load
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
| `effort.sh` | what does each `reasoning_effort` level actually cost in tokens? greedy, so the levels separate from sampling noise |
| `lifecycle-test.sh` | does a live client hold the server up, and does it shut down once the last one exits? |

## MTPLX harnesses (macOS)

| Script | Question |
|---|---|
| `mtplx-throughput.sh` | How much does native MTP actually buy at a realistic context? Runs each context in both `mtp` and `ar` mode against one loaded model. |
| `mtplx-ab.sh` | Which of two installed MTPLX combinations is faster, controlling for thermal state and context band? Serial blocks, cooled to `nominal` between. |
| `mtplx_session_report.py` | What did a real agent session actually cost? Post-hoc analysis of MTPLX's request log, with a noise-floor gate that refuses to call a winner. |
| `mtplx_thermal_log.py` | Background sampler: thermal transitions to `~/.mtplx/logs/thermal.jsonl`, joined per request by the reporter. |
| `mtplx-version-compare.py` | Did upgrading MTPLX change anything? Takes two `mtplx-throughput.sh` result files and reports per-cell deltas against this machine's drift floor. Refuses to compare different models. |
| `thermal.py` | Thermal pressure and the drift/IQR floors. Imported by the above; vendored so this repo has no dependency on a private checkout. |

Two things about the MTPLX harnesses are worth copying rather than
rediscovering. `ar` is the **only** per-request MTP kill switch — `enable_mtp`
and `mtp` are accepted and silently ignored. And the reporter's headline is
*effective* tok/s (completion over TTFT + decode), not decode: decode alone
ranks models the way a user would not.

```bash
# one combination
LOCAL_AI_INSTALL_REL=.local/share/mtplx-qwen38-27b ./mtplx-throughput.sh

# two, head to head
./mtplx-ab.sh mtplx-qwen38-27b mtplx-qwen38-flash-next

# what a real session cost
python3 mtplx_session_report.py --since 3h --compare --by-thermal --by-context

# before/after an upgrade -- baseline FIRST, the old version is gone afterwards
LOCAL_AI_INSTALL_REL=.local/share/mtplx-qwen38-27b REPEATS=3 LABEL=before ./mtplx-throughput.sh
uv tool upgrade mtplx
LOCAL_AI_INSTALL_REL=.local/share/mtplx-qwen38-27b REPEATS=3 LABEL=after  ./mtplx-throughput.sh
python3 mtplx-version-compare.py results/before.json results/after.json
```

### Comparing versions honestly

`REPEATS` defaults to 1, which is fine for "does this work" and useless for
"is this faster". With `REPEATS>1` the harness discards the first sample as
warm-up and reports a median with its spread; `mtplx-version-compare.py` then
holds both against the two floors in `thermal.py`:

- a cell whose spread exceeds `MAX_IQR_PCT` (25%) is **unusable**, not a datum;
- a delta smaller than `DRIFT_FLOOR_PCT` (20%) is **not a change**, because
  repeat runs of an identical request on this machine have drifted that far on
  their own.

Expect "no measurable difference" from a point release, and treat that as the
result rather than a failed experiment. A comparison that reports "+3% faster"
from two single samples is noise with a sign on it.

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
