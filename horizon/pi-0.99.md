# pi 0.99 (client update)

**Status:** parked (29 Sep 2026): released the day the v2 series started; v2 is pinned to pi 0.87.1.
**Kind:** a client variation, not a new stack. Every machine would change at once.

## What it is

pi (`@earendil-works/pi-coding-agent`) 0.99.0 and 0.99.1 were published on 29 Sep 2026, a week after 0.87.1.
What changed hasn't been read yet. For contrast, 0.87 introduced prompt-cache warming for faster turnarounds,
which is why the v2 series runs one pi version everywhere: a client change can move time per story on its own.

## Checks before a run

1. Read the release notes from 0.87.1 to 0.99.1: anything touching requests, caching, compaction or tool calls.
2. One smoke story per engine (llama.cpp, gufo, mlx-serve) on 0.99, compared with the same story on 0.87.1.
3. Then a full series as a labelled client variation, recorded by `run.json`'s `client_version`.

**Recheck when:** the v2 series is scored, or a later pi release fixes something we hit.
