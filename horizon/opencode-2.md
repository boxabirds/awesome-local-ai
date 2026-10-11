# OpenCode 2: the coding client's next major version

**Status:** gated (11 Oct 2026). Nothing built or run. The `gufo-opencode` series ran OpenCode 1.18.30. OpenCode 1.19.0 (11 Oct 2026) offers `opencode upgrade --major` and `/update` to move to OpenCode 2, and no longer updates automatically.
**Where it could run:** the Strix Halo box, against `gufo-opencode` (one variable: the client version). See [`gufo-opencode.md`](gufo-opencode.md).

## What it is

OpenCode 2 is released as tags `v2.0.3` to `v2.0.26` (the latest committed 8 Oct 2026) in `github.com/anomalyco/opencode`; no GitHub release objects were found for them. Its docs are at `https://opencode.ai/v2/docs/`. The breaking changes listed on its migration page: a new plugin API; new server API and client contracts; the terminal client's configuration moves to one `cli.json`. Both versions use the `opencode` command, and the V2 installer replaces the V1 binary.

Differences that matter for a benchmark: the server API and event shapes changed; no language servers or LSP diagnostics; only `AGENTS.md` is read, not `CLAUDE.md`; compaction is checkpoint-based (`keep.tokens`, `buffer`; `prune` and `tail_turns` removed); delegated commands run in the background by default; subagents are General and Explore (no Scout), start with fresh context, and cannot nest by default. Details and sources: [`subagent-context.md`](../benchmarks/inference-server-concurrency/subagent-context.md).

## Checks before a run

- **A parser for OpenCode 2's event stream**, written test-first from a real recorded stream, for every reader of it (`drive.final_reply_text`, the scan of steps and tokens, conversation ingestion). The repository rule: every client needs its own parser, and a smoke run must show the harness's own reader finding the final reply and the DONE line in what the client really wrote.
- The client version pinned and recorded in each run.
- A decision on whether OpenCode 1.x runs continue alongside, since 1.19.0 no longer updates itself.

## Confounds

A different client version changes the system prompt, tools, compaction and how much context a story uses (as moving from pi to OpenCode did), so a score or time difference is about the client, not the engine. Token and time comparisons need the conversation records, not only totals. The LSP and `CLAUDE.md` changes alter what the agent sees.

**Last checked:** 11 Oct 2026, from the project's changelog, migration page, agents page and source. **Recheck when:** a GitHub release or changelog entry describes OpenCode 2's event stream; the owner wants a series on it; OpenCode 1.x stops receiving fixes.
