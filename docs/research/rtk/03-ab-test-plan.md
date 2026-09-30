# A/B test plan

*28 September 2026. Not scheduled: see [the decision log](README.md#decisions-so-far).*

Runs of the same stack vary a lot on their own (Qwen3.8-Swift scored 68 and 57 out of 75 in two identical runs), so a single run per arm shows nothing. The test uses short tasks, repeated, in pairs.

## Design

- **Task:** a short, self-grading story. The planned smoke-test story (a small Rust port) suits this best, since cargo output is exactly what RTK compresses. Until it exists, canvas stories 1–2.
- **Machine:** one, the fastest free one (the RTX 4090 machine, or the Strix Halo box between gufo runs).
- **Arms:** A as today. B with RTK's hook installed for pi (`rtk init -g --agent pi`), rewriting the agent's shell commands without telling it, so the prompt is identical in both arms.
- **Repeats:** three pairs, run alternately A B A B A B, so drift over the day (room temperature, other load) hits both arms equally.
- **Recorded per run:** held-out score, agent time, turns, compactions, tool-output tokens, and signs of hidden information: re-running a command, or asking for fuller output (`cat`, `--verbose`, re-running tests).
- **The run record must show the arm,** so the two can never be mixed in results.

## Decision rule, fixed before running

Adopt RTK only if held-out scores do not drop and agent time or compactions fall clearly. Any drop in score means stop, whatever the token savings.

Three pairs can only detect large effects: a clear time saving (25% or more) or an obvious quality drop. That is enough, because the [reach analysis](02-reach-analysis.md) suggests anything smaller is not worth the risk.

## What it needs

1. A harness option that installs RTK where the agent's sandbox can run it and records the arm in the run record, with failing tests written first.
2. RTK's pi hook working inside the harness sandbox. This has not been tried.
3. About six short runs: roughly half a day of one machine on canvas stories 1–2, less on the smoke story.
