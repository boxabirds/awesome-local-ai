# Qwen3.8-Flash-Next on Strix Halo, gufo, OpenCode

The same stack as [`gufo-pi`](../gufo-pi/README.md), driven by OpenCode instead of pi. **One variable: the client.**
Engine (gufo 0.5.0, pinned by image digest), weights, sampling, context and profile are gufo-pi's, value for value;
`tests/gufo-opencode-test.sh` fails if any setting other than the install's identity, its location and the client
differs. It has its own install directory and install id; the weights live under `$HOME/gufo` and are shared, so they exist once.

**Not run yet.** Status: built, not benchmarked. See [Before a run](#before-a-run).

## The system prompt and when it compacts

The concern: OpenCode has a much bigger system prompt than pi and will compact more often in a 131,072-token window.
Both halves are true, and the second is larger than the first. Measured on 8 Oct 2026 with OpenCode **1.18.30** and pi
**0.87.1**, by running each the way the harness does (isolated config, same provider settings) against a stub server that
records the request, and counting with the model's own tokenizer (`tokenizer.json` of the ddalcu Flash-Next pack).
Reproduce with `tools/engine-probe/capture-client-request.py`.

### What each client sends before the first message

| | pi 0.87.1 | OpenCode 1.18.30 | OpenCode / pi |
|---|---:|---:|---:|
| System prompt | 649 | 2,078 | 3.2x |
| Tool definitions | 679 (4 tools) | 4,672 (9 tools) | 6.9x |
| **Fixed overhead, tokens** | **1,328** | **6,750** | **5.1x** |
| Share of a 131,072 window | 1.0% | 5.2% | |

The harness runs pi with `--no-extensions --no-skills --no-prompt-templates --no-context-files`; OpenCode runs with `--pure`
(no plugins) but has no switch for its built-in skills or its own tool set, so the table is OpenCode's smallest.

**What builds OpenCode's overhead.** In its 4,672 tool tokens: `bash` 1,295 (a long description with commit and
pull-request procedures), `task` 857 (sub-agents), `todowrite` 649, `read` 467, `edit` 452, `grep` 301, `glob` 256,
`write` 240, `skill` 155. pi has `read` 176, `bash` 128, `edit` 272, `write` 103. In the 2,078 system tokens: a fixed
instruction document (tone and style, proactiveness, following conventions, doing tasks, tool-usage policy, code
references, six worked examples), an `<env>` block (working directory, platform, date), and `<available_skills>` listing a
built-in skill. A model id that names a known family can select a different prompt file; a Qwen id gave 2,091 tokens
against 2,078 for an unknown id, so it is the same text. **What can add to it on a real run:** an `AGENTS.md` or
`CLAUDE.md` in the workspace or the home directory (pi's flag switches those off; OpenCode's does not), more skills, and any
MCP server or plugin. The vidi workspace should be checked for such a file before a series.

OpenCode also makes a second, small request per session to write a title (about 535 tokens) on the same server.

### When it compacts

The harness gives OpenCode `limit.context = 131072` and `limit.output = 32768` and no `limit.input`. OpenCode's rule
(`packages/opencode/src/session/overflow.ts`, read 8 Oct 2026) is then:

```
usable   = context - min(limit.output, 32,000)        # = 131,072 - 32,000 = 99,072
compacts when  input + output + cache read + cache write  >=  usable
```

pi's rule is `context - reserveTokens` with its default reserve of 16,384 (read from the installed pi), which is 114,688.

| | pi | OpenCode (as the harness configures it) |
|---|---:|---:|
| Compacts at, tokens | 114,688 | **99,072** |
| Fixed overhead | 1,328 | 6,750 |
| **Room for the conversation before the first compaction** | **113,360** | **92,322** |
| Recent history kept after a compaction | 20,000 (`keepRecentTokens`) | up to 15,000, plus a summary |

So OpenCode has about **21,000 fewer conversation tokens (18.6%)** before it first compacts: 15,616 from the earlier trigger and
5,422 from the larger prompt. It also compacts again sooner after each compaction, because the next cycle starts from
6,750 + summary + the kept tail. And the trigger is the whole prompt including output tokens already counted, not the
prompt alone.

**The earlier trigger is a setting, not a property of the client.** `compaction.reserved` is documented
(`auto`, `prune`, `reserved`), but it only takes effect when `limit.input` is also set; without `limit.input` the 32,000
output reserve above is used. The harness's OpenCode adapter says compaction cannot be set ("no documented setting"), which
is not right for this version. Setting `limit.input` to 131,072 and `compaction.reserved` to 16,384 gives
131,072 - 16,384 = 114,688, pi's trigger.

### Decided: OpenCode's defaults against pi's defaults

The owner's decision (8 Oct 2026): the variable is **each client as it ships**. OpenCode compacts at 99,072 tokens and pi
at 114,688, and the series keeps both. Nothing about compaction is changed for OpenCode, so the harness's OpenCode adapter
is used as it is (`limit.context` 131,072, `limit.output` 32,768, no `limit.input`).

The reason: moving OpenCode's trigger to pi's would be an intervention nobody has measured. It would leave 16,384 tokens free
for the reply where OpenCode asks for up to 32,000 per request, so what it does to a story is unknown. A result with the
setting changed would not be "OpenCode".

What this means for reading the result: a difference between this series and `gufo-pi` is the whole client, prompt, tools,
behaviour and compaction timing together. It cannot say which of those caused it. Conversation records (calls, compactions,
context at each call) can say how much of it was compaction.

## Before a run

1. OpenCode is **found, not installed, by `lib/clients/opencode.sh`**: it must be present on the node and pinned. Pin 1.18.30
   (the version measured here); it is recorded as `client_version` in each run.
2. Capability probe (`tools/engine-probe/basic-capability.py`) through OpenCode's own request path: a tool call with raw
   newlines, and a large one.
3. A look at what OpenCode sends to gufo (sampling fields, reasoning effort, `max_tokens` 32,000), so the effective settings
   match gufo-pi's. Set ours explicitly and confirm.
4. The ten-minute smoke rule, then queue the series and watch story 1. Five runs, or three if the spread settles it
   (`EVALUATION-POLICY.md`, rule 16).

## Confounds

- OpenCode's tool set differs from pi's (nine tools against four, including a sub-agent tool and a todo tool), so behaviour,
  not only context use, may differ.
- gufo 0.5.0 decodes slower than the build before it (gufo issue 475). That applies to both clients, so it cancels in a
  comparison with gufo-pi.
- OpenCode's version moves quickly; a series is for one version.
