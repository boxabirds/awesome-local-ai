# RTK feasibility

Can [RTK](https://github.com/rtk-ai/rtk) ("Rust Token Killer"), which compresses shell command output before a coding agent reads it, make the local stacks in this repo faster without making them worse?

## Status

| Step | What | Status |
|---|---|---|
| 0 | [How much of our agents' tool output RTK could even touch](02-reach-analysis.md) | **done, 28 Sep 2026** |
| 1 | [A/B test on one stack](03-ab-test-plan.md) | not scheduled; see the decision below |

## Documents

1. [What RTK is](01-what-rtk-is.md): how it works, what it supports, and the independent evidence on this kind of tool.
2. [Reach analysis (step 0)](02-reach-analysis.md): 8,136 recorded tool calls from three stacks, classified with RTK's own rewrite rules.
3. [A/B test plan](03-ab-test-plan.md): the design, the decision rule and what it needs.

## Decisions so far

- **28 Sep 2026, after step 0:** RTK can reach only about 18–30% of our agents' tool output. Half or more of it comes from pi's own `read` tool, which RTK never sees, and most test-runner output is already piped into `tail` by the agents, which RTK then leaves alone. The upside is modest, perhaps a 4–17% smaller conversation, which is an estimate and not a measurement. Running the A/B test is still open.
