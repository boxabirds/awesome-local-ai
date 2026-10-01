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

Why: the agent sandbox allowed everything and denied a list of paths. Each leak in the week of 28 September 2026 was a path nobody had listed: a file share holding a clone of this repo, other runs' leftovers in `/tmp`, and `~/node_modules`, which gave a build a package it never declared and cost a run its score.

## The app shows results, never its own faults

The benchmarker (and anything else a person reads results in) presents benchmark results. It never shows its own or the harness's bugs, diagnoses, likely causes, remedies, shell commands or instructions to the reader, and it has no "needs you" list. Where a figure is unreliable or missing because of an internal fault, it shows as not available, the same as any other missing figure, with nothing about why. A run that an internal fault spoiled (marked invalid) does not appear in the app at all.

Internal faults go where they are worked on: the monitor's log (`ops/anomaly-tracking.md`), tests, and fixes. The fix for a fault is to make the system repair itself or not fail, not to explain the fault better on screen.

Why: on 1 October 2026 the dashboard listed skipped re-scores and failed time-accounting checks under "Needs you", with causes and commands to run on bench machines, and then explained them at greater length. The owner: "Apps don't share their bugs with users like this. Stop it. Everywhere."
