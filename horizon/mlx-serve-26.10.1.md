# mlx-serve 26.10.1 (engine update)

**Status:** pin moved (2 Oct 2026); smoke story and the recorded series are next. The owner approved five recorded
runs once the smoke story is clean.
**Kind:** an engine version bump, not a new stack. Every mlx-serve run changes at once.
**Machine:** the M5 Max (128 GB). Combination `qwen/3.8/flash-next/macos/128GB/mlxserve-pi`.

## What it is

ddalcu/mlx-serve v26.10.1, released 1 Oct 2026. The combination was pinned to v26.9.6 (26 Sep 2026), one release
behind. The model pack (`ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit` at `7eaef0fa`) is unchanged and is still
the repository's newest revision.

From the release notes, the parts that bear on a long agent session with Flash Next:

- Long agent sessions "stay cached instead of re-reading the whole conversation every turn"; past 32k tokens Flash
  Next is about 12% faster.
- A "long-standing cause of agents looping" is fixed: lookup drafting could get stuck repeating itself.
- Prompt reading up to 51% faster for Flash Next, measured on an M5 Ultra. For other chips the notes give 5-8% on
  decode (M4 Max). There is no M5 Max figure.
- Output is stated to be word-for-word the same as 26.9.6, checked by them on 18 models. Not checked here.
- `--mtp` becomes a no-op and the MTP head is on by default for dense and MoE alike. Our launcher passes `--mtp` or
  `--no-mtp` itself, so the profile still decides.
- The prefix cache's default size changes on this model family: "2 GB, or one session at the working context on
  qwen4_exp when larger". We pass `--prefix-cache-mem` only when `PREFIX_CACHE_MEM` is set, so this default applies
  to our runs. It is the change most likely to move memory use and cache behaviour.
- New and off by default, so not used: `--ple-gpu` (+15% decode at 128k, needs the whole table in memory),
  `--mtp-greedy-tail`, `--prefill-decode-share`.

## Checks before a run

1. **Pin the release asset.** Done: `MLXSERVE_VERSION="26.10.1"` and the sha256 GitHub publishes for
   `mlx-serve-bin-macos-arm64.tar.gz` (`e53056e4…3873`). `tests/mlxserve-test.sh`: the pin check was changed first
   and seen to fail, then 103 of 103 pass.
2. **Install on the M5 Max and read the version the binary reports.**
3. **One smoke story, unrecorded:** a partial rerun of one story from a finished run, as for gufo 0.5.
4. **The recorded series:** five runs, named for the version, never pooled with the 26.9.6 runs.

## Confounds

The cache changes can move time and token figures on their own, so a 26.10.1 run is not directly comparable with the
26.9.6 `v2-r*` runs. The client stays pi 0.87.1 so only the engine changes.

**Last checked:** 2 Oct 2026. **Recheck when:** the smoke story ends.
