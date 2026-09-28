# What RTK is

*28 September 2026. RTK 0.49.0, commit `7efbaef`.*

[RTK](https://github.com/rtk-ai/rtk) is a single Rust binary that sits between a coding agent and the shell. When the agent runs a command, a hook rewrites it to RTK's version (`git status` becomes `rtk git status`), and RTK runs the command and compresses its output before the agent sees it. It has about 82,000 GitHub stars and is under active development.

It compresses in four ways: filtering boilerplate, grouping similar lines, truncating, and collapsing repeated log lines. It has handlers for more than 100 commands, including git, grep, find, ls, cat (as `rtk read`), test runners (vitest, jest, Playwright, pytest, cargo test and others, which it reduces to failures only), linters and build tools. The project claims 60–90% fewer tokens on those commands.

## Our agents are already supported

RTK has hooks for both agents used in this repo:

```bash
rtk init -g --agent pi     # pi
rtk init -g --opencode     # OpenCode plugin
```

So using it here is mostly configuration, not a port.

## What it doesn't touch

The hook only rewrites shell (bash) tool calls. An agent's own built-in tools bypass it. For pi that means its `read` tool, which is how our agents read most files (see the [reach analysis](02-reach-analysis.md)).

## Independent evidence on this kind of tool

["Token Reduction Is Not Cost Reduction"](https://arxiv.org/abs/2607.12161) compared three tool-output compression approaches against unmodified Claude Code on controlled coding tasks:

- The most aggressive setup cut tool-output tokens by 38.4% but raised billed cost by 6.8%. Token savings barely predicted cost savings (correlation 0.15).
- Compression changed what the agent did: more fetching, diagnosing, testing and extra turns, which offset the savings.
- On a SWE-bench Go subset, aggressive compression reduced successful patches.

Their cost was cloud billing, dominated by cache charges. Ours is time. For us, smaller tool output means less prompt reading and fewer compactions, which could matter more than it did for them. But every extra turn the agent takes because something was hidden costs a full round of generation, our most expensive resource. So an RTK test here is judged on held-out score and total time, never on token counts.

## Similar tools

[sqz](https://github.com/ojuschugh1/sqz) and [tokf](https://github.com/mpecan/tokf) do the same job and are much less widely used. [TokenPilot](https://arxiv.org/abs/2606.17016) (part of [LightRSI](https://github.com/zjunlp/LightRSI)) trims tool output generically and also rewrites conversation history, which is costly on Flash-Next.
