# Goldens for test_lake_readers.py (story 23, TC-A0)

What each analysis tool gave **from a checkout**, before it read the lake: the code as it was at commit `7cf93f444^`
(the parent of task 23.18's commit), run on `test_lake_readers.world(..., "checkout")`. The test builds the same runs
in the lake layout and expects the current code to give the same output. Never edit these by hand.

| File | What it holds |
|---|---|
| `annotate.json` | `annotate.load_attempts` on the checkout: every attempt |
| `heldout.json` | `heldout.read_json` of each story's `accept.json`: the held-out result found for it |
| `judge.json` | `judge.py --prepare-only` for two pairs: every file of the blinded package (letter replaced by label), by SHA-256 |
| `corpus.json` | the token counter's `corpus` on the checkout with its runs tracked: the samples from the runs' logs |

How they were captured (6 Nov 2026), so it can be done again if the fixture changes:

1. Export the old modules: `git show 7cf93f444^:benchmarks/spec-bench/harness/<m>.py` for `annotate`, `heldout`,
   `benchlake`, `claims` and `judge`, into a scratch folder. In the copies, set `benchlake.REPO` and `HERE` (in
   `annotate` and `judge`) to this checkout's paths, and drop the module-level `sys.path.insert(0, str(HERE))`, so the
   old modules import each other and not the current ones.
2. Build the old token counter alone: `git archive 7cf93f444^ tools/anthropic-token-counter`, add `[workspace]` to
   its `Cargo.toml`, copy `tools/Cargo.lock` beside it, `cargo build --release` with a scratch target folder.
3. With the scratch folder first on `sys.path` (and this folder after it), call `test_lake_readers`'s `world(...,
   "checkout")` and `attempts_of`, `heldout_of`, `package_of`, and `corpus_of(..., lake=False)` with the old binary
   then `log_samples`; write each result as indented, key-sorted JSON.
