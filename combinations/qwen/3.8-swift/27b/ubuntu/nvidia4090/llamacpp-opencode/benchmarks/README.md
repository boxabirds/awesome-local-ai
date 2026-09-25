# Benchmarks -- Swift Qwen3.8-27B (24GB, llama.cpp + OpenCode)

## A/B vs the baseline (the reason this combination exists)

`base.tsv` and `swift.tsv` are the raw per-effort averages from the A/B that
justified this combination. Same `llama-server` binary (commit `972d231`), same
config, same 5 prompts, greedy (`temperature 0, top_k 1`), one run, on an RTX
4090 24GB:

| effort | base rch | swift rch | Δreason | base tok | swift tok | base s | swift s | ×fast |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| low | 4366 | 3035 | +30.5% | 2941 | 2346 | 32.12 | 23.40 | 1.37× |
| medium | 5789 | 4442 | +23.3% | 3673 | 2905 | 38.95 | 28.25 | 1.38× |
| xhigh | 9717 | 5967 | +38.6% | 3211 | 2235 | 37.24 | 24.72 | 1.51× |
| total | 19872 | 13444 | +32.4% | 9825 | 7486 | 108.31 | 76.37 | 1.42× |

Full method, the spec-acceptance comparison, caveats (n=5, single run,
throughput not quality), and the baseline-reconciliation note live in
[`docs/20260921-swift-qwen38-27b-ab.md`](../../../../../../../docs/20260921-swift-qwen38-27b-ab.md).

Reproduce with:

```bash
bash benchmarks/perf/swift-ab.sh          # repo root -- stops the baseline, runs both,
                                     # restores nothing (run swift-stop.sh after)
```

## Still to measure on this install

The `need_mib` values in [`profiles.tsv`](../profiles.tsv) are **conservative
bounds carried from the baseline**, not Swift measurements. To replace them with
real numbers, probe the context ceiling the way the baseline did
(`combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/benchmarks/`
`ctx-probe-*.txt`): start at 131072, step up, note where it OOMs, and record the
server-only footprint per profile. Until then, `coding` has plenty of slack and
the top profiles should be treated as foreground-only.
