# Fable 5.1 as a second reference stack

**Status:** parked (29 Sep 2026): the owner wants it later; Opus 5.5 is the v2 reference for now.
**Machine:** this Mac (Claude Code), like the Opus 5.5 reference.

## What it would add

A second frontier reference next to Opus 5.5 (`claude-opus-5-5`): the same packs run through Claude Code
with Fable 5.1 (`claude-fable-5-1`). It would show how much of the reference score depends on the model
rather than the pack, and give the local stacks two yardsticks.

## Checks before a run

1. The reference installer (`benchmarks/reference/install-stack.sh`) accepts the model id.
2. A one-story smoke test.
3. Three runs on the same spec and suite version as the Opus runs.

## Confounds

Claude Code's version and settings must match the Opus runs; the run record names both.

**Recheck when:** the Opus 5.5 v2 runs are done and scored.
