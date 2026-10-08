# gufo with OpenCode: the same engine and model, a different coding client

**Status:** candidate (8 Oct 2026). The owner wants other harnesses (clients) tried on the same stack, one variable at a
time. Nothing built or run for this combination. It is a new combination and a new series, not a change to `gufo-pi`.
**Where it would run:** the Strix Halo box (tritus), against `qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi`.

## What changes, and what must not

**One variable: the client.** pi 0.87.1 becomes OpenCode. Everything else is held to `gufo-pi`:

| Held fixed | How |
|---|---|
| Engine | gufo **0.5.0**, the same image digest as `gufo-pi` (`GUFO_IMAGE` and `GUFO_VERSION` in its `config.sh`), even if 0.9.0 is faster or a later release fixes the speculation regression. Moving the engine would make a result unattributable. |
| Model, quantisation, context, KV, thinking, sampling | the same `config.sh` values: `--think on --temperature 1.0 --top-p 0.95 --top-k 20 --min-p 0.0`, 131,072 context |
| Pack and harness | `vidi`, the pack version and harness release in force when the series starts, recorded per run |
| Machine | tritus, same sandbox |

**The client itself must be pinned by version**, recorded in each run (`client_version`), as pi is. The harness already has
an `OpenCodeClient` (`benchmarks/spec-bench/harness/clients.py`) and other combinations use it (for example
`llamacpp-opencode`, `mtplx-opencode`), so this is a new combination directory plus a launcher entry, not a new adapter.

## What a difference would and would not mean

OpenCode differs from pi in its system prompt, tool set and tool-call format, its compaction behaviour and how it nudges a
stalled model. A score or time difference is therefore a statement about the **client on this engine and model**; it says
nothing about the engine. It would also change how much context a story uses, so token and time comparisons need the
conversation records, not only the totals.

## Checks before a run

1. The capability probe (`tools/engine-probe/basic-capability.py`) through OpenCode's own request path: a tool call with
   arguments that carry raw newlines, and a large one. This is where an engine and a client interact badly.
2. A short run of OpenCode against the server, to confirm what it sends (sampling fields, reasoning effort, tool schema), so
   the effective settings match `gufo-pi`'s. Set ours explicitly and confirm.
3. The ten-minute smoke rule, then queue the series and watch story 1. Five runs, or three if the spread settles it
   (`EVALUATION-POLICY.md`, rule 16).

## Confounds

- OpenCode's context accounting and compaction differ from pi's, so "131k context" is not the same working window.
- Its version moves quickly; a series is for one version.
- gufo 0.5.0 decodes slower than the build before it (issue 475). That holds for both clients here, so it cancels for a
  comparison with `gufo-pi`, and is why the pin is kept.

**Last checked:** 8 Oct 2026, from the repository's own client adapters and combinations; OpenCode not run against gufo.
**Recheck when:** the owner decides to build it, or OpenCode ships a release that changes tool calling.
