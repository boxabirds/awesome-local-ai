# How coding agents hand context to subagents (read 11 Oct 2026)

This decides which concurrency case a client produces. A **fresh** subagent starts from a short prompt and builds its own context; a **forked** one starts from the parent's whole conversation, a prefix a server could share. Quotes are from each project's own docs or source; *inferred* marks my reading.

## Summary

| Client | Default subagent | Fork of the parent's context | Limits found |
|---|---|---|---|
| **Claude Code** | fresh: "Each subagent starts with a fresh, isolated context window. It doesn't see your conversation history" | **yes**: "inherits the entire conversation so far... same system prompt, tools, model, and message history"; on by default in interactive sessions, off with `-p` and in the SDK; `/subtask <task>` starts one | 20 concurrent by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`); nesting to three layers |
| **pi** | no subagents in the core (secondary sources). The Earendil example extension: "Each subagent runs in a separate `pi` process", isolated context | opt-in only, in a community package: `initialContext: "parent"` clones the parent's snapshot; the page says "this is expensive" | the example extension: "limited to 8 tasks, 4 concurrent"; output returned is capped at 50 KB |
| **OpenCode 1.x** (we ran 1.18.30; this Mac has 1.0.134; the RTX 4090 box 1.18.31) | fresh: "Each agent invocation starts with a fresh context unless you provide task_id to resume the same subagent session" | **no** | parallel calls in one message are encouraged; `background=true` needs `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`; depth 1 |
| **OpenCode 2** (v2.0.x; `opencode upgrade --major` since 1.19.0) | fresh: subagents "run with fresh context in foreground or background child sessions" | **no** (the docs do not mention inheriting) | `experimental.subagent_depth` default 1; the General agent "cannot launch more subagents"; no concurrency limit documented |

## Claude Code (`https://code.claude.com/docs/en/sub-agents`, advertised)

- A subagent loads the CLAUDE.md hierarchy and AGENTS.md; the built-in Explore and Plan agents skip them. "Claude composes a delegation message that summarizes the task."
- Limits: 20 concurrent subagents by default and "no limit on the total number" per session; nesting up to three layers (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`).
- The page was truncated at 100,000 of 108,547 characters when read.

## pi

- Not read from pi's own core docs; **no official fork tool found**. The example extension (`@earendil-works/pi-coding-agent` `examples/extensions/subagent/README.md`): a delegated system prompt and a task, an isolated context, "limited to 8 tasks, 4 concurrent".
- The community package `@mjakl/pi-subagent` (`https://pi.dev/packages/@mjakl/pi-subagent`): `initialContext: "empty"` is the default and recommended; `"parent"` is exceptional. 1 to 8 calls per invocation.

## OpenCode 1.x

- **Source** (`packages/opencode/src/tool/task.ts` and `task.txt` at tag v1.18.35, `github.com/anomalyco/opencode`). The tool's own instructions to the model: "Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses" and "Each agent invocation starts with a fresh context unless you provide task_id to resume the same subagent session (which continues with its previous messages and tool outputs)". So in 1.x the concurrency comes from the model emitting several task calls in one message; background mode is experimental and off by default.
- **Docs** (`https://opencode.ai/docs/agents/`): "OpenCode comes with three built-in subagents, **General**, **Explore**, and **Scout**." The docs do not say whether they are enabled by default (the owner says they are), and say nothing about context inheritance or a concurrency limit. A subagent "will use the model of the primary agent that invoked the subagent" unless one is set.
- **Hidden agents** make extra model calls: "Hidden system agent that generates short session titles", "...creates session summaries", and a compaction agent that "runs automatically when needed". `small_model` (`https://opencode.ai/docs/config/`): "By default, OpenCode tries to use a cheaper model if one is available from your provider," otherwise it "falls back to your main model". On a local server with one model, those calls land on the same server. `compaction.auto` defaults to true.

## OpenCode 2

- **Release:** tags `v2.0.3` to `v2.0.26` exist (v2.0.26 committed 8 Oct 2026); no GitHub release object was found for them. The v1.19.0 release (11 Oct 2026) says "Run `opencode upgrade --major` to upgrade to OpenCode 2", and "Use `/update` to install OpenCode updates or upgrade to OpenCode 2; updates are no longer installed automatically." v1.18.24 notes "V1 now reads supported V2 config fields". A secondary source called 2.0 a beta with a separate `opencode2` binary; the official migration page says "OpenCode 1 and OpenCode 2 both use the `opencode` command" and "the V2 curl installer replaces the V1 binary". I trust the official page.
- **Breaking changes** (`https://opencode.ai/v2/docs/migrate-v1`): "Plugins use a new plugin API." "The server API and clients have new contracts." "Terminal client configuration moves from layered `tui.json(c)` files to one global `cli.json` file (auto migrated)." Supported V1 behaviour elsewhere "is intended to remain compatible with V1".
- **Subagents** (`https://opencode.ai/v2/docs/agents`): run "through the `subagent` tool" in a child session. Built in: **General** ("cannot launch more subagents") and **Explore**; there is no `scout`. "A subagent uses its configured model, or inherits the parent session's model when none is configured." Hidden `compaction`, `title` and `summary` agents remain. The migration page adds that delegated commands (formerly `subtask`) "now run automatically in the background and report their results to the parent session", so more work runs in parallel by default than in 1.x.
- **Compaction:** "checkpoint-based compaction"; `reserved` becomes `buffer`, `preserve_recent_tokens` becomes `keep.tokens`, and `tail_turns` and `prune` are gone.
- **Other differences that matter for a benchmark:** no language servers or LSP diagnostics; only `AGENTS.md` is read, not the `CLAUDE.md` fallback; the server API and event shapes changed.
- **Source** (`packages/core/src/tool/plugin/subagent.ts` on `dev`): "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID"; a `background` parameter lets the parent continue; the model is the explicit override, else the agent's, else the parent's; the depth limit is `experimental.subagent_depth` (default 1).

## What this means for our measurements

- OpenCode never forks the parent's context, so its subagents share only the system prompt and tool definitions (about 10k tokens for the main agent in our traffic). Scenarios A and A2 in `design.md` mirror it. Claude Code's fork and pi's `parent` mode are scenario B.
- Hidden title and compaction calls add requests on the same server. In the the Strix Halo box log, two prompts of about 570 tokens that generated 28 and 65 tokens look like titles, and a 120,562-token prompt that generated 3,397 tokens looks like a compaction (*inferred*, not confirmed).
- **Benchmarking implication:** moving the OpenCode series to OpenCode 2 is a new client with a new server API and event contract. Per the repository's rule that every client needs its own parser, the harness's OpenCode parser would need a recorded OpenCode 2 stream and tests before any series. Our `gufo-opencode` series ran 1.18.30; v1.19.0 no longer updates automatically.

## Not found

A typical size for a subagent's first prompt, for any of these clients. Whether pi's core has a fork tool.
