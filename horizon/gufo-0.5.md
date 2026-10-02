# gufo 0.5 (engine update)

**Status:** smoke test passed (2 Oct 2026); the full recorded series of five runs (`v2-gufo05-r1` to `-r5`) is running. Checks 1-4 are done.
The unrecorded smoke story (v2-r5 story 2, job `gufo-0.5-smoke`) ran clean on 0.5.0: `toolcall_text_resumes` 0 where
v2-r5 had 3, acceptance 10/10 (v2-r5: 8/10), no errors or stalls. The version-string check had failed under amd64
emulation on a Mac (twice, no output, ~30 min each); on tritus it completed, including the image pull, inside a 9-minute limit.
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
2. **Read the real version string, on tritus.** Done, 2 Oct 2026: the image prints
   `gufo version 0.5.0 (23cacbb)`. The old `_gufo_require_version()` took the last token, which here is
   `(23cacbb)` with the parentheses, so it could not have matched a sensible pin. It now takes the release number
   from `gufo version X (hash)` and keeps the last-token rule for development builds (`gufo version b722a61`).
   The owner chose to pin the release number, `0.5.0`. Tested first: six checks in `tests/gufo-test.sh`, two of
   which failed before the fix. Recorded runs store the image's whole `--version` line, so 0.5.0 runs read
   `gufo version 0.5.0 (23cacbb)` and earlier ones `gufo version b722a61`.
3. **Update `config.sh`.** Done in the working tree (not yet pushed to the clone the benchmark node uses):
   `GUFO_IMAGE` is the 0.5.0 digest and `GUFO_VERSION` is `0.5.0`. On a machine with no benchmark running, run
   `tests/gufo-test.sh` unmodified: while one is, 25 launcher checks fail on the "another model server is
   running" guard (the same 25 fail without these changes). With that guard bypassed in a scratch copy, only the
   guard's own five tests fail. Still to check: whether the installed server manifest keeps the old image digest
   until the installer is re-run.
4. **One smoke story, unrecorded.** Per the release-candidate process already used for harness changes: one
   partial rerun of a story, unrecorded so nothing publishes from an unverified pin. Use a story that
   actually hit issue 304's pattern, to directly confirm the fix landed rather than just that gufo starts —
   `analysis/story-runs.csv`'s `toolcall_text_resumes` column (capped at 3) shows it maxed out on three:
   v2-r5 story 2, v2-r5 story 5, and v2-r1 story 5. **v2-r5 story 2** is the one to use: earliest of the
   three (cheapest run), and the same signature also showed up (uncapped) on v2-r1 story 2, so it isn't a
   one-off.

   ```
   dbench submit tritus --id gufo-0.5-smoke --combination qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi \
     --pack benchmarks/vidi --from-run combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r5 \
     --stories 2 --run-id gufo-0-5-smoke --client pi --no-record
   ```

   (`--no-record` is required — dbench records and pushes by default. Flags checked against
   `tools/dbench/src/cli.rs`'s `Submit` variant.) Success: `toolcall_text_resumes` is 0 for story 2 in the
   resulting `metrics.json`, where v2-r5's own run had it at 3.
   **Result (2 Oct 2026):**

   | | v2-r5 story 2 (old pin) | smoke (0.5.0) |
   |---|---|---|
   | `toolcall_text_resumes` | 3 | 0 |
   | Acceptance | 8/10 | 10/10 |
   | Agent time | 42 min | 84 min |
   | Tool calls | 119 | 224 |
   | Compactions | 1 | 2 |

   One run, so it is not proof the fix holds. Things it does not settle:
   - 204 of 216 server requests logged `snapshot action=skipped reason=byte_capacity` (cache retained ~16.8 GB of
     an 18.3 GB cap), with prompt reuse still ~96% in the requests sampled. Watch this on longer stories; it bears
     on `docs/20260928-gufo-long-session-investigation.md`.
   - Twice the time and calls of v2-r5: one run cannot separate engine speed from agent variation.
   - One stop-message nudge, which v2-r5 did not have.

   Submitting needs a `nodes.toml` for the client (none exists on tritus; the smoke used a scratch copy), and the
   node was held, so it had to be released for the job to start.
5. The full recorded series: five runs, `v2-gufo05-r1` to `v2-gufo05-r5` (jobs `vidi-v2-gufo05-r1` to `-r5`), queued on
   the Strix Halo box on 2 Oct 2026; the first started at 21:35 BST. The run name carries the engine version.

## Confounds

The cache-behaviour fixes (#358, #362, #369) can move timing and thinking-spread numbers on their own, the
same way a pi client bump does (see [pi 0.99](pi-0.99.md)) — a post-upgrade run isn't directly comparable to
the pre-upgrade `v2-r*`/`replay-*` runs already recorded without flagging the engine version changed.

**Last checked:** 2 Oct 2026. **Recheck when:** the full recorded series is submitted (flag the engine version;
watch the cache-skip warning at longer contexts).
