# Evaluation policy

How a spec pack is scored, so every pack (vidi now, todoodle v2 and later ones) is judged the same way. A pack isn't used for runs until it meets this.

## Held-out tests

The held-out suite is the pack's acceptance tests, kept in the private repo and never visible to the agent. It follows the same idea as SWE-bench's hidden tests: the agent is judged by tests it couldn't tune its work to.

1. **Every held-out test checks something the spec states.** Each test names the PRD requirement it checks (`@ref prd:<anchor>`). Any name it relies on (a button label, an `aria-label`, a route, a serve command) must appear in the spec: the PRD, `design.md` or `tasks.md`. A test that needs something the spec doesn't say is a test fault, and gets fixed or removed.
2. **Know how much of the suite repeats what the agent was told to test.** For each pack version, classify every held-out test against the spec:
   - **mirrors a spec test case**: the same action and expectation as a TC-nn in `design.md`, which the agent was told to write;
   - **PRD requirement beyond the test cases**: stated in the PRD but not covered by any TC. These show whether the agent built what the spec asks for, not only what it was told to test;
   - **not stated in the spec**: not allowed (rule 1).

   Record the mix per story with the pack version.
3. **The spec is checked for contradictions before its first run,** and epics declare the stories they depend on (`Depends on:`), so the build order is the spec's, not the harness's.

## When a failure counts against the agent

4. **A failure counts only if the agent could have found and fixed it with what it had:** the spec, and the app run the way the spec says. Every regression and every story that scores zero is recorded in the run's audit with **detectable by the agent: yes or no, and how**, for example "by running the spec's serve command" or "by walking the PRD's golden path in a browser". A "no" means the test or spec is at fault: fix the pack, don't count it.
5. **The harness gives the agent no feedback taken from the held-out tests.** Extra help, such as a checklist to re-walk earlier stories or a harness check that says the app doesn't start, changes what is measured. It runs only as a separately labelled variant, never mixed into the main results.

## What a run reports

6. **Per story, separately, then the total:**
   - **new work**: the story's own held-out tests, passed out of total;
   - **regressions**: earlier stories' held-out tests that passed before this story and fail after it;
   - **repairs**: earlier held-out tests that failed before and pass after;
   - **cumulative**: every held-out test for the stories built so far.

   The cumulative score is how usable the finished app is. The per-story parts show why, so that a single early bug doesn't hide what the rest of the run did.
7. **A partial rerun is diagnostic.** Running one story from a base (another run's code at the end of the previous story) measures that story on its own, with no earlier mistakes carried in. Its results are labelled as such and never combined with full runs.

8. **A story the operator's time cap ends is scored, and marked time-limited.** Its held-out result counts
   towards the run: the cumulative score is what a user would end up with, and work stopped part-way is part of
   that. But the agent did not choose to stop, so under rule 4 the story and any total containing it carry the
   mark wherever they are reported, and a figure is never compared with one from a run that had no cap without
   saying so. The stories that follow are **not** discounted and no known-good base is substituted for them:
   measured on 6 Oct 2026 over every recorded run, all nine stories that followed a cap on a capable stack
   recovered — 46 held-out tests gained against 45 that became available, two of them repairing a test that had
   been failing before the cap
   (`docs/reports/strategic-insights/2026-10-06-truncated-stories-do-not-cascade.md`). Truncation does not
   invalidate what comes after it; failing to recover from one is a property of the stack, and worth reporting as
   its own figure.

## Setting up held-out tests

9. **A setup step that follows an undocumented alternate flow falls back to the documented flow.** Held-out tests put the app into the state their check needs (setup), then act and assert (the check). When a setup step reaches its state by a flow the spec implies should work but no design test case documents (an alternate flow: for example documented steps chained at machine speed, in an order no TC walks), it names its documented counterpart, the TC that reaches the same state. If the alternate flow fails, the step is redone by the documented flow and the resulting state is asserted to be exactly the intended one before the test goes on. The alternate-flow failure is recorded once, as a finding against the story that owns that behaviour, instead of failing every later test that merely passes through it. A step with no documented counterpart gets no fallback, and a test's own check never falls back. Added in vidi v1.2, after one such failure in story 7 of a run made most later tests fail in their setup.

## What a spec asks for

10. **No operational requirements.** Rate limits, abuse protection, quotas and similar operational settings are for a production deployment, not for a benchmark of building the product. They cost agents work that nothing scores, and they get in the way of scoring (vidi's board-creation limit made every held-out scoring wait 7.5 minutes). Specs leave them out; vidi v1.3 removed its four.

## The score of record

A run's score of record is its final commit re-scored after the run (`finalize.py`, `rescore.py`), from the committed code on a clean install, so that anyone can reproduce it from `workspace.bundle`. Live scores, taken in the agent's own workspace after each story, show the run's course; they are not the record.

11. **The record's app is installed from the committed lockfile, with the workspace's own package manager.** npm installs with `npm ci`, and one stated fallback, `npm ci --legacy-peer-deps`: the spec never asks for a clean `npm ci`, agents install with `--legacy-peer-deps` when peers conflict, and the fallback keeps the lockfile's versions. bun installs with `bun install --frozen-lockfile` and no fallback. A checkpoint with no `package.json`, no lockfile for its package manager, or a lockfile none of these accepts is not scored. Under rule 4 a lockfile the agent's own `npm ci` would reject could be counted against it, but the agent was never told to run `npm ci`, so it could not have found out.
12. **A failure of the scoring is never a score.** If the install fails, if the build fails where the live build of the same commit passed, if a scoring port is held by another process, or if the runner stops before it reports, the re-score is a harness fault. It is set aside with its reason (`rescore-spoiled/`), and the run is recorded as unscored: `finalize.json` and the record's commit message give the reason and its live score, until a clean re-score succeeds. (Showing unscored runs on the page, instead of leaving them out of every mean, is still to do.)
13. **A score of record that disagrees with the run's own live score is checked before it is recorded.** Where the live scoring of the final commit ran under the same suite version, a re-score more than 3 tests away from it, or one that ran a different number of tests, is flagged and not recorded. So is a re-score whose every failure shares one error, across two or more stories and at least five failures, unless the live scoring of the same code failed the same way. Both scoring faults of 30 Sep 2026 differed from their live scores by 63 tests; on the v2 records, live and record agree to within one test.
14. **Flakiness is measured both ways.** Every checkpoint is scored three times: the failing tests, and a seeded sample of the passing ones (a fifth, at least five), are rerun, and each rerun test takes its majority result. The record reports how many tests changed result, split into those that failed first and those that passed first, with the number of passing tests sampled.
15. **The scoring environment is recorded with every result:** Node and npm, the suite's Playwright and Chromium, the OS, the number of held-out workers, and the install command.
