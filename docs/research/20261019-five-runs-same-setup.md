# Five runs of the same app on the same setup: what repeated and what did not

Written 19 October 2026 for the owner's article, "Here are the patterns I saw when I built the same app 5 times in a row on the
same hardware and software setup." Everything here is read from the recorded runs; nothing was run for it.

## 1. Which series, and how "the same" it was

The app is the `vidi` collaborative whiteboard (`vidi-v2.0-pre2`, 11 stories, 75 held-out tests). The closest thing to five runs
of one setup is **gufo 0.5.0 with the pi client on the Strix Halo machine**: same engine release, same container image, same model
files, same sampler, same machine, runs `v2-gufo05-r1` to `r5`, started 3 to 6 October 2026. **Swift 1.5 27B on the RTX 4090
machine** (`v2-fresh-r1` to `r5`) is a second five-run series and tests whether a pattern replicates.

It was not identical, and the article should say so. The harness itself changed between the runs: the five gufo runs used four
harness releases (`2026.10.02.3`, `03.1` twice, `04.1`, `05.2`) and the five Swift runs three. No five-run series has one harness
release throughout. I did not check whether those releases changed anything that would move a score.

## 2. The patterns

1. **Same setup, different scores.** gufo 0.5.0: 64, 71, 68, 67, 74 of 75 (spread 10). Swift 27B: 59, 66, 72, 67, 63 (spread 13).
2. **Most of the app comes out the same every time.** In the five gufo runs 60 of the 75 held-out tests (80%) pass in every run.
   The other 15 tests produced 31 failures between them, and **four tests account for 15 of the 31** (they fail in 3, 3, 4 and
   5 of the 5 runs). The rest are spread thinly: 11 tests that fail once or twice. Swift is less settled: 47 of 75 pass in
   every run, 21 fail in exactly one run.
3. **Some tests fail almost everywhere.** Across 23 runs on six stacks with test-level results, 31 tests pass in all 23 and 44
   fail at least once. "Offline edits catch up on reconnect" (story 3, `live.catch_up`) fails in 22 of 23, in every stack.
   Failure rates per test correlate across stacks (Pearson 0.33 to 0.68 over the 75 tests), so a good part of what is hard
   belongs to the app and its spec, not to the model.
4. **The one test everybody failed was passed by the one run that read a library's limit.** All five gufo apps contain the
   exact badge text the spec requires ("Reconnecting…", with the Unicode ellipsis), so spelling is not the cause. The test
   waits 30 s for the badge and never sees it. Run 5, the only pass, wrote its own idle watchdog
   (`CONNECTION_IDLE_TIMEOUT_MS = 8000`) and a comment saying the provider's silence timeout "is 30 s and not configurable".
   Runs 1 to 4 have no liveness logic of their own, and the same holds in the ten Swift, base-27B and Strata workspaces I
   could inspect; I did not inspect the source of the other eight runs in the table. I did not run the failing apps to confirm the 30 s timeout is
   what delays the badge. It is the mechanism the code and the 30.4 to 30.5 s failure times point to.
5. **Models override the spec's literal wording with their own judgement, the same way each time.** The story 9 test fails in
   all five gufo runs (and in the Strata run) because it clicks a button whose accessible name matches `/\bXL\b/`. The spec says
   "S, M, L, XL size buttons". Four of the five gufo runs labelled the button "Extra large" or "Extra large text" (my search did
   not find the fifth's label). One left a comment: "a lone letter in a toolbar is a puzzle". Swift 27B passed this test in
   five of seven runs; I did not look at how its buttons are labelled.
6. **Totals are stable and stories are not.** gufo runs took 17.0 to 22.5 agent hours (mean 18.9), 1.89 to 2.15 million output
   tokens and 2,773 to 3,187 steps. Per story the same runs vary up to 5.3× (story 5: 219, 65, 62, 80, 41 minutes). The slow
   stories are partly the same each time: the average pairwise rank correlation of per-story time is 0.54 for gufo and 0.20 for
   Swift.
7. **Thinking follows the same shape.** gufo 0.5.0 totals 3.78 to 4.20 million characters (1.1×), but per story the spread is
   2.6× on average. Swift is 11× per story and 1.7× per run. See section 4.1 of `docs/reports/20261017.md`.
8. **The worst run was the one where tool calls hung.** gufo run 1 (64, the lowest, and 22.5 hours, the longest) was interrupted
   ten times by the harness for tool calls silent for 600 s (four in story 3, two in story 4, four in story 5), and story 4 hit
   the 4-hour cap. I read this from its `interventions.md`; I did not establish what hung. That file is missing for run 5.
9. **Code size is not stable even when structure is.** The gufo apps have 171 to 193 tracked files but 32,866 to 68,940 lines
   (2.1×) in `src/` and `tests/`. The count includes test files, and I did not look at where the extra lines are.

## 3. What I could not establish

- Whether the harness differences between runs moved any score. This is the main threat to calling it "the same setup".
- The mechanism behind pattern 4 beyond the code evidence above, and whether runs 1 to 4 would pass with the watchdog added.
- Anything about the runs with no retained test-level report on the machines (the M5 Max runs, two older gufo runs, two Swift
  runs).
- Causes behind patterns 8 and 9.
- Five runs is a small sample. A pattern at "4 of 5" could be 2 of 5 on the next five.

## 4. Method

Test-level results are each run's story-12 Playwright report (`accept-report.json`) from the node's `rescore/vidi-v2.0-pre2/stories/12`,
combined by the harness's own rule: a checkpoint with a failing test is scored three times and each test counts its majority
result. The resulting matrices equal the recorded scores for every run used (gufo 0.5.0: 64, 71, 68, 67, 74; Swift 27B, base 27B,
gufo b722a61, gufo OpenCode and Strata runs all match `finalize.json`). Per-story figures come from `metrics.json`
(`accept.by_story`, `agent.seconds`, `agent.tokens.output`). The run set is the 23 runs with a retained report: gufo 0.5.0 ×5,
gufo `b722a61` ×3, gufo with OpenCode ×3, Swift 27B ×7, base 27B ×4, Strata 0.1.41 ×1. Source checks read the workspace of each
run on the machine that ran it, read-only.
