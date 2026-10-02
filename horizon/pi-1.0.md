# pi 1.0 (client update)

**Status:** candidate (2 Oct 2026): release notes read end to end, 0.87.1 through 1.0.0. No landmine release found
(unlike gufo's 0.4.0) and two fixes land that are directly relevant to our engines. Not run yet.
**Kind:** a client variation, not a new stack. Every machine would change at once — same caution as [pi 0.99](pi-0.99.md),
which this supersedes (0.99 was never adopted; v2 pinned 0.87.1 before it existed).

## What it is

pi (`@earendil-works/pi-coding-agent`) went 0.87.1 (22 Sep 2026, our pin) → 0.99.0 → 0.99.1 → 0.99.2 → **1.0.0**
(1 Oct 2026, current latest). The jump is almost entirely MCP servers, "codemode" (model-written JavaScript
calling tools in a sandbox), new provider logins, and TUI changes (fullscreen by default, theme handling) — none
of which we use or are exposed to: the harness runs `pi -p --mode json` (`clients.py`), headless JSON mode, not
the interactive TUI, so "fullscreen by default" does not affect us.

Two fixes in the 0.87.1→0.99.0 jump are relevant to our actual engines, both tagged "Fixed inherited" (fixes to
the shared library pi's TUI and SDK/headless mode both use, so they do apply to our `-p --mode json` runs):

- **llama.cpp tool-call mixups**: "Fixed inherited OpenAI Responses streams from servers that omit
  `output_index`, such as llama.cpp, running mixed-up tool calls; such streams now end with an error." Directly
  names llama.cpp — relevant to the Swift 1.5 stack (llamacpp-pi, gruntus). Changes silent corruption to a loud
  stream error, which is a strict improvement for a benchmark (a wrong answer we didn't know was wrong, vs a
  failure we can see).
- **Dropped sampling params**: "Fixed inherited model-level `samplingParams` being dropped by direct
  `stream()`/`complete()` calls on OpenAI-compatible APIs." All three local engines (llama.cpp, gufo, mlx-serve)
  are served as OpenAI-compatible APIs that pi's `stream()`/`complete()` call directly — if this ever affected
  our requests, temperature/top_p/top_k could have been silently not applied. Not confirmed this actually hit
  us; worth checking the 0.87.1-era request bodies for it if pursued.

No `DO NOT USE` or regression-flagged release anywhere in the range (checked every release name 0.81.0 through
1.0.0 via `gh release list`) — unlike gufo, where 0.4.0 was a confirmed landmine one release before the fix.

**Version-numbering semantics, checked rather than assumed:** nothing in the 1.0.0 release notes frames it as an
API-stability or breaking-changes milestone — it reads as the next sequential release, same shape as 0.99.x
(a feature list, Added/Changed/Fixed sections). Semver convention still implies future breaking changes would
bump the major version going forward, which lowers the risk of this specific upgrade and of silent breaks later.

## Checks before a run

1. ~~Read the release notes from 0.87.1 to 1.0.0: anything touching requests, caching, compaction or tool
   calls.~~ Done, this note.
2. One smoke story per engine (llama.cpp, gufo, mlx-serve) on 1.0.0, compared with the same story on 0.87.1.
3. Then a full series as a labelled client variation, recorded by `run.json`'s `client_version`.

## Confounds

Same shape as a pi client bump generally (see [pi 0.99](pi-0.99.md)): a client version change can move time per
story on its own, independent of the engine underneath — don't compare a 1.0.0 run with a 0.87.1 run without
flagging the client changed. If the gufo v3 series (see [gufo 0.5](gufo-0.5.md)) and a pi 1.0 upgrade both land
around the same time, don't bundle them into one run without separately labelling which changed: two confounds
moving together make neither attributable.

**Not independently verified:** whether 1.0.0 changes `@earendil-works/pi-ai`'s internal package layout
(`dist/api/openai-completions.js`) — `tools/tensorfold-check/capture_pi_requests.mjs` depends on that exact path
to find pi's request-building code. Worth a quick check before relying on that script against a 1.0.0 install.

**Last checked:** 2 Oct 2026 (every release 0.81.0 through 1.0.0, via `gh release list`/`gh release view`
against `earendil-works/pi`). **Recheck when:** the smoke stories run, or a later pi release changes something
in this range's blast radius.
