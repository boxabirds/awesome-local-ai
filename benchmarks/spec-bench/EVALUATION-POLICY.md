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
7. **Known-good mode is diagnostic.** Running one story from a known-good base (another run's code at the end of the previous story) measures that story on its own, with no earlier mistakes carried in. Its results are labelled as such and never combined with full runs.

## Setting up held-out tests

8. **A setup step that follows an undocumented alternate flow falls back to the documented flow.** Held-out tests put the app into the state their check needs (setup), then act and assert (the check). When a setup step reaches its state by a flow the spec implies should work but no design test case documents (an alternate flow: for example documented steps chained at machine speed, in an order no TC walks), it names its documented counterpart, the TC that reaches the same state. If the alternate flow fails, the step is redone by the documented flow and the resulting state is asserted to be exactly the intended one before the test goes on. The alternate-flow failure is recorded once, as a finding against the story that owns that behaviour, instead of failing every later test that merely passes through it. A step with no documented counterpart gets no fallback, and a test's own check never falls back. Added in vidi v1.2, after one such failure in story 7 of a run made most later tests fail in their setup.
