# Measuring this combination

Nothing in this directory has been measured yet. This is the plan that
changes that, and [`measure.sh`](measure.sh) runs most of it. Results go in
this directory, next to the numbers they justify.

## Record the machine with every run

`measure.sh` writes this header itself. A number without it cannot be compared
with anyone else's Strix Halo:

- vendor and product (DMI), BIOS version
- **BIOS power mode** (Performance / Balance / Quiet / Rack on the MS-S1 MAX).
  Not readable from Linux; set `POWER_MODE=performance` when you run it
- kernel, Mesa / RADV version, `linux-firmware` version
- GTT limit, BIOS carve-out, RAM
- GPU performance level (`auto` or `high`)
- llama.cpp commit and `GPU_API`

## What to measure, in order

| # | Measurement | Replaces | How |
|---|---|---|---|
| 1 | **Cold load time**, `--no-mmap` | the 900 s load allowance, the 30 min idle timer | `measure.sh load` (drops the page cache; needs sudo) |
| 2 | **Server memory per profile** | every `need_mib` in `profiles.tsv` | `measure.sh profiles`: RSS and GTT used after load and after a 100k-token prompt |
| 3 | **Decode and prefill at depth 0, 32k, 128k** | `combination_performance` in `config.sh` | `measure.sh bench` (llama-bench, `-mmp 0 -fa 1 -ub 512 -b 2048`) |
| 4 | **Vulkan vs ROCm**, same file | the "Vulkan by default" claim in `help.txt` | rebuild with `GPU_API=rocm`, rerun 3 |
| 5 | **n-gram speculation on and off** | the `SPEC_NGRAM_ARGS` default | `benchmarks/perf/tokbench.sh` (repo root) with `SPEC_NGRAM=0` and without |
| 6 | **Clock `auto` vs `high`** | the clock advice in `help.txt` | rerun 3 after `echo high \| sudo tee .../power_dpm_force_performance_level` |
| 7 | **Does the vision profile load?** | the "unverified" note on `vision` | `PROFILE=vision qwen38-flash-next-strix-server`, send one image |

Harnesses that read `nvidia-smi` (`refit.sh`, `ctxprobe*.sh`, `vprobe.sh`,
`run-niah.sh`) do not work here yet; `tokbench.sh`, `effort.sh` and
`lifecycle-test.sh` do. Point them at this install with
`LOCAL_AI_INSTALL_REL=.local/share/qwen38-flash-next-strix`.

## When the numbers are in

1. Replace the estimates in `profiles.tsv` and delete its ESTIMATE paragraph.
2. Put measured figures in `combination_performance` and the README table.
3. Set `TESTED_ON="minisforum-ms-s1-max"` (or the slug `measure.sh` prints).
4. Remove `AUTO_SELECT=0`, so it ranks as a measured combination.
5. Change the "NOT MEASURED" banners in `config.sh`, `help.txt` and README.
