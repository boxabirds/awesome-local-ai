# Working in this repository

## Nothing reaches another project without asking

This repository is public, and every push is visible to the world under the owner's name. Never cause anything to appear on another project's GitHub (issues, pull requests, discussions, commits) without asking first and getting a clear yes. That includes indirect ways:

- **Commit messages must not reference other repositories' issues or pull requests.** Don't write `owner/repo#123`, `#123` meant for another project, or a github.com issue or pull-request URL in a commit message. GitHub copies the reference, with the whole commit message, onto that issue's timeline, and it can't be removed without rewriting history. To mention one, write it in plain words: "gufo issue 304".
- Links to other projects' issues inside committed documents are fine: GitHub doesn't cross-reference file contents.
- No issues, comments, pull requests, forks or reactions on other projects unless the owner asks for that specific action.

Why: on 28 September 2026 three commit messages saying `gufo-org/gufo#304` put this repository's internal notes (run names, harness constants, session links) on the timeline of an issue the owner had filed with the gufo maintainers, where they meant nothing to anyone.

## Every bug fix starts with a test that reproduces it

For any change to code in this repository, a bug fix begins with a test that fails because of the bug. Run it and see it fail for the reason you expect. Then fix the code until that test passes, and run the module's other tests. If the fix already exists when you find the bug (someone else's change fixed it, say), still write the test, and prove it would catch the bug: run it against the broken version, from git history or with the bug put back in a scratch copy. A test that has never been seen to fail proves nothing.

Where the failure happens late in a long run (the end of a story, after hours), the test must reach the same code in seconds. Prefer a focused test of the exact path to an end-to-end one; keep the end-to-end test as well where one exists.

Why: on 30 September 2026 a change to time accounting rebound the variable that held the story's held-out result. Every story then crashed after scoring and before its record was saved, and the mlx-serve v2-r2 run used up all three restarts on story 4. No test exercised that path before the run started.

## A fault found by looking is still a bug, and still starts with a test

The rule above covers a bug someone reports. This one covers the bug you find yourself, by opening the page in a
browser, running the tool, or reading the output of what you have just built. The temptation is to fix it on the
spot, because you are already looking at it and the fix is obvious. Don't.

**Write the test that fails because of it first**, at the level that would have caught it, and see it fail for that
reason. Then fix. A fault that the suite could not see is two defects: the fault, and the gap in the suite that let
it through. Fixing only the first leaves the second, and the next change walks into it.

The test has to assert the thing that was actually wrong — what the page renders, what the command prints — not that
the component exists or the function was called. A test that would have passed while the bug was present is not the
test.

Why: on 5 October 2026 three faults in one afternoon's work on the combination page were found only by opening it,
while 818 unit tests and 566 end-to-end tests were green for all three: an edit whose string did not match, so an
import was never added and the page rendered nothing; a block of CSS inserted inside the wrong rule, so the new panel
had no styling; and a helper function shadowed by a prop of the same name. Each was fixed in a minute. None of the
three left a test behind until this rule was written.

## Presenting to the owner

When reporting, keep information separate from requests for action. Put what happened and what was found under one heading. Put what needs the owner (decisions, approvals, things only they can do) under another, so neither has to be dug out of the other.

When problems lead to recommended actions, give each one as:

- **Problem:** what is wrong, with the evidence.
- **Recommended solution:** the change that would address it.
- **Proposed actions:** the concrete steps, marked with whether each needs the owner's approval.

## No branches

Never create a branch: not local, not remote, not temporary, not in a scratch clone, and not "to keep main safe". Work on the checked-out branch (main) and commit there. That rules out `git checkout -b`, `git switch -c`, `git checkout -B`, `git branch <name>`, `git worktree add` without `--detach`, and pushing to any new remote branch. Agents and subagents follow the same rule. If some work seems to need isolation, ask the owner first.

Why: the owner works on main only. During the 30 September 2026 history rewrite a temporary `local-main` branch was created in a scratch clone, against this rule.

## Build in Rust unless there's good reason not to

Unless there's good reason, use Rust as the language to build. It's more efficient, tractable, provably eliminates entire classes of bugs, and runs faster. Only when compile times or tech stacks become a problem should other languages be considered.

## Refactor DELETE FIRST

Refactoring breaks things easily, so all refactoring in this repository follows three steps, in order:

1. **Prove 100% coverage.** Assert that the code to be refactored has 100% test coverage (lines and branches), with exhaustive test fixtures. If it doesn't, write the missing tests first, against the code as it is, until it does. Never refactor code that isn't fully covered.
2. **Delete first.** Delete all the actual code, leaving only the functions (their signatures, as stubs). The tests stay, and now fail.
3. **Rebuild step by step.** Insert new code in the new design, piece by piece, until every test passes again.

Why: moving working code around keeps its untested assumptions and hides what was lost. Deleting it makes the tests the only definition of the behaviour, so whatever they don't pin down is found in step 1, before the refactor, and not on a live run after it.

## Least privilege

Apply the principle of least privilege for all resource access. Deny by default and allow only what the task needs: files, network, processes, credentials, tokens and tool permissions alike. A list of things to hide is the wrong shape, because it only covers what someone has already thought of.

Why: the agent sandbox allowed everything and denied a list of paths. Each leak in the week of 28 September 2026 was a path nobody had listed: a file share holding a clone of this repo, other runs' leftovers in `/tmp`, and `~/node_modules`, which gave a build a package it never declared and cost a run its score. Since 1 October 2026 the agent runs in `tools/agent-sandbox`, which allows only what the run is given (its own directory, a read-only toolchain, an allow-listed environment and network); the allow-everything sandbox is gone, and a run that did not use the new one cannot be published.

## The app shows results, never its own faults

The benchmarker (and anything else a person reads results in) presents benchmark results. It never shows its own or the harness's bugs, diagnoses, likely causes, remedies, shell commands or instructions to the reader, and it has no "needs you" list. Where a figure is unreliable or missing because of an internal fault, it shows as not available, the same as any other missing figure, with nothing about why. A run that an internal fault spoiled (marked invalid) does not appear in the app at all.

Operational observations are not faults and may be shown: an idle machine, a queue's length, a story far slower than its stack's median, a series that has finished. They are facts found in the data of normal operation, stated with their numbers and no cause, remedy or instruction. The test is whether it could be written from the benchmark's own results and schedule without knowing what is broken: if it needs an explanation of a fault, it is a bug and goes to the log (the owner, 3 Oct 2026: "bugs in the app should be logged; operational observations are data insights from normal operation").

Internal faults go where they are worked on: the monitor's log (`ops/anomaly-tracking.md`), tests, and fixes. The fix for a fault is to make the system repair itself or not fail, not to explain the fault better on screen.

Why: on 1 October 2026 the dashboard listed skipped re-scores and failed time-accounting checks under "Needs you", with causes and commands to run on bench machines, and then explained them at greater length. The owner: "Apps don't share their bugs with users like this. Stop it. Everywhere."

## Keep the benchmark guide current

`benchmarks/docs/guide/index.html` is the interactive guide to how the benchmark system works: its concepts, entities and their relationships, components, key flows and the operational insights that illustrate them. Whenever you make a major change to the benchmark system, update the guide in the same piece of work, and update the insights it embeds when a new analysis is added. Major means: a new or removed entity, component or flow; a change to how a run, a story, a stop or finish rule, scoring, a sandbox boundary, a release or the benchmarker's presentation works; a new combination kind; a change to what is measured or reported. The guide's own `README.md` lists where each entity, flow and insight lives and what to check. Say in the final report what you changed in the guide, or that nothing needed changing and why.

Why: on 1 October 2026 the system's rules changed several times in a day (what ends a story, what the agent can see, how a score is made, what the app shows) while the only documentation was the code and a long conversation. A guide that is not updated with the system is wrong the first time someone relies on it.

## Check a strategic insight before saying it

A strategic insight is any claim that would change a decision: which combination is better, what to run next, what to stop
running, whether something is worth building. Before one is said to the owner, it is checked, and the check is reported with
it. Three rules, in order of how often they are broken:

1. **A surprising absence in the data is a fault in the reading until proved otherwise.** "No run has a score", "no stack
   records this", "nothing has that field" is almost always the wrong field, the wrong key or the wrong filter. Find where
   the figure really lives before building anything on its absence. Never route around it with a substitute metric.
2. **Check the figure against something independent.** The app's own screen, another field in the record, a count from the
   raw files. One query is not a finding. If the two disagree, say so and stop.
3. **Name the metric exactly, and where it came from.** "Median score of record, `scores[suite].passed` of 75, over 6
   finished runs" is a figure a reader can check. "79%" is not, and a figure computed as a fallback is not a headline.

The same care applies to anything that names a person or their work. This repository is public and its model repositories
belong to real people. A judgement on someone's quantisation, engine or fine-tune is a published judgement on their work, and
it must rest on the figure the benchmark actually recorded.

Why: on 3 October 2026 the owner was told that ddalcu's mlx-serve quantisation was 3.8 times more verbose and bought no
quality, on a per-story average invented as a fallback after looking for the score of record in the wrong field and
concluding that none of the three local combinations had one. The real scores were there, keyed by suite version, and said
the opposite: that quantisation was the **best** local combination, 69.5 of 75 against gufo's 66. The owner: "your laziness
was at fault", and the name was "held in vain".

## A smoke run takes ten minutes or less

A smoke run is a check that finishes in ten minutes or less: the engine starts, answers a request, returns a tool call, reuses a prompt. Anything longer is not a smoke run and must not be called one or run as one. A benchmark story is never a smoke run, recorded or not: a story takes as long as the stories of a normal run.

For an engine or client version change, the check before a series is the short one (the installer's own smoke test, or a few requests against the server). Then queue the series and watch its first story; a problem shows there as soon as it would in a separate story, and the machine's time is not spent twice.

Why: on 2 October 2026 an unrecorded "smoke" story for mlx-serve 26.10.1 ran for an hour on the M5 Max before the five-run series it was holding up. The owner had not asked for it: "it's not necessary to do a smoke run when it takes as long as a normal run! that's not smoke!"
