# gufo 0.5 (engine update)

**Status:** gated (2 Oct 2026): tritus is mid-series on the gufo partial-rerun work this upgrade was raised
during, and a machine running a benchmark is never used for anything else. The version-string check below also
failed under amd64 emulation on a Mac (twice, no output, ~30 min each) — it needs tritus's own hardware.
**Kind:** an engine version bump, not a new stack. Every gufo run would change at once.

## What it is

gufo-org/gufo v0.5.0, released 2 Oct 2026 11:08 UTC. The combination's `config.sh` is pinned to commit
`b722a61` (26 Sep 2026), a development build from two days before gufo's first numbered release (v0.1.0,
28 Sep) — so the pin is five releases behind: v0.1.0, v0.1.1, v0.2.0, v0.3.0, v0.4.0, v0.5.0.

0.5.0 includes PR #373 ("preserve native tool schemas and historical calls"), which closes **our own issue
304** (a tool call with raw newlines returned as text, ending the story) and three related issues (#357,
#364, #368). It's a large, tested rewrite (20-case SDK suite across Qwen27B/Flash-Next/DeepSeek, ≤0.4%
timing regression per its own checks). v0.4.0's release title is literally "DO NOT USE (tool calling
regression)" — 0.5.0 is the very next release and reads as the fix-forward for that regression, not a
repeat of it.

Also in 0.5.0, three cache-behaviour fixes that look relevant to `docs/20260928-gufo-long-session-investigation.md`
already in this repo: cache reuse advancing as conversations grow (#358), cached conversations independent of
execution sessions (#369), prefixes retained across history edits (#362).

No `BREAKING CHANGE` note anywhere from v0.1.1 through v0.5.0.

## Where it could run

The Strix Halo box (tritus) — the `qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi` combination. No
other machine runs gufo.

## Checks before a run

1. **Resolve the image.** Done: `ghcr.io/gufo-org/toolboxes/gufo-runtime@sha256:371a731c5286d698c77daa2507300588e24dc063c7c665895331001410dc06b4`
   is the `0.5.0` tag (confirmed against `gufo-org/toolboxes/.github/workflows/publish_release.yml`: tagged
   by bare version, no `v`, linux/amd64 only).
2. **Read the real version string, on tritus.** `lib/gufo.sh`'s `_gufo_require_version()` compares
   `GUFO_VERSION` against the last whitespace-separated token of `podman run --rm --entrypoint gufo
   "$GUFO_IMAGE" --version`. Run that directly first (`podman run --rm --entrypoint gufo
   ghcr.io/gufo-org/toolboxes/gufo-runtime@sha256:371a731c52…d4e60 --version`) and take the token after the
   last space — don't guess the format from `src/cli/main.cpp`'s `"gufo version " <release> " (" <revision>
   ")"`; two attempts to run this same image under amd64 emulation on a Mac hung with no output, so it has
   to be read on real hardware.
3. **Update `config.sh`.** `combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/config.sh`:
   `GUFO_IMAGE` to the digest above, `GUFO_VERSION` to the string step 2 gave. Let `_gufo_require_version()`
   itself confirm the pin is self-consistent before anything else runs.
4. **One smoke story, unrecorded.** Per the release-candidate process already used for harness changes: one
   partial rerun of a story, unrecorded so nothing publishes from an unverified pin. Pick one that
   previously hit issue 304's pattern (a tool call whose output had raw newlines) if one is identifiable
   from the record, to directly confirm the fix landed rather than just that gufo starts.
5. Only after a clean smoke test, a full recorded series.

## Confounds

The cache-behaviour fixes (#358, #362, #369) can move timing and thinking-spread numbers on their own, the
same way a pi client bump does (see [pi 0.99](pi-0.99.md)) — a post-upgrade run isn't directly comparable to
the pre-upgrade `v2-r*`/`replay-*` runs already recorded without flagging the engine version changed.

**Last checked:** 2 Oct 2026. **Recheck when:** tritus goes idle.
