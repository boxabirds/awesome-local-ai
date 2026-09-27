# Vidi reference stack: Claude Code + Opus 5.5

The frontier-model reference the local setups are compared against: Claude Code
driving Claude Opus 5.5 through the Vidi canvas scope (stories 1–5 and 7–12).
`stack.env` registers it with `../../install-stack.sh`. The runbook is in
[`benchmarks/vidi/README.md`](../../../vidi/README.md).

| Run | How it was built | Record |
|---|---|---|
| [`run-1/`](run-1/) | One Opus subagent per story, isolated by instruction rather than a sandbox, scored once at the end. Audited. | Held-out results, audit and caveats in its README. |
| [`run-2/`](run-2/) | Stories 1–2 built by subagents and imported after a clean peek audit ([`import_run.py`](../../../spec-bench/harness/import_run.py)); stories 3–12 run by the harness, sandboxed, on the M2. | Per story, as the harness records any run. Stories 3–12 were first scored with no browser installed (every test failed to launch), so those scores were void. On 27 Sep they were re-scored from each story's commit with the same suite: 71/75 final, the same as the whole-build re-score of 25 Sep (`accept-final.json`). |
| `run-3/` | The harness, sandboxed, from story 1. | Starts when run-2 finishes. |
