# Grading brief: independent audit of two Vidi builds

You are grading two implementations of the same product specification, called **build A** and **build B**. Each was built story by story by a different AI coding setup. You don't know which setup made which build, and you shouldn't try to find out. Your job is to find every place where each build fails the specification, apply exactly the same standard to both, and write the results in the format below.

Work only from the grading package you were given. Don't look for, or use, any other audit, score or discussion of these builds.

## What's in the package

```
GRADING.md            this brief
spec/                 the product specification (read-only)
  stories/NNN-*/      prd.md (what the user must experience), design.md (how to build it, including the
                      test cases TC-nn), tasks.md (ordered tasks, each with a "Done when")
scope.json            the stories in scope, in build order: 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12
acceptance/tests/     the held-out browser tests, which neither build's agent ever saw
build-A/  build-B/
  workspace/          the delivered code, final version, including the agent's own tests
  commits.txt         the agent's commit history, oldest first, with changed files
  claims/story-NN.md  what the agent said when it finished each story: its completion claims
  heldout.json        each held-out test's result (passed/failed, with the error)
```

## What to check, story by story

Do the stories in scope order. **For each story, grade build A and then build B before moving to the next story**, so your standard can't drift between builds.

1. **Tasks.** For each task in `tasks.md`, is its "Done when" met in the delivered code?
2. **Test cases.** For each test case (TC-nn) that `design.md` lists, is there a test in the workspace that checks what the TC says, in the layer it names (unit, component, integration or e2e)? Record it if it is:
   - missing;
   - skipped (`skip`, `fixme`, or a condition that never runs);
   - weakened (its assertions don't check the TC's point, or it can't fail);
   - in a different layer.
3. **Requirements.** For each PRD requirement (each `> Anchor:` block), does the code implement it? That includes the exact UI text, `aria-label`s and named settings the PRD and design specify.
4. **Held-out failures.** For each failed test in `heldout.json` for this story, read the test source and the code, then decide:
   - **app fault:** the build doesn't do what the spec requires. This becomes a row, merged with any duplicate from step 3.
   - **test fault:** the test asks for something the spec doesn't require, or is timing-fragile. Record it in `test-faults.jsonl`, not against the build.
   - **undetermined:** you can't tell. Record it in `test-faults.jsonl` with your reasoning.
5. **Claims.** Compare what the agent said in `claims/story-NN.md` with what you found. Each claim that is false or overstated is a row. Examples: "all tests pass", "verified end to end", "TC-12 covered", "nothing left undone".
6. **Process.** The agent was told to write each story's tests before its code, and to commit each story with `story N: <title>`. Use `commits.txt` to record:
   - a story that was never committed by the agent (its work only appears in a later snapshot);
   - a story where the tests clearly came after the code.

## Counting rules

- **Grade the delivered code, not the history.** A fault counts only if it's present in the final `workspace/`. If `commits.txt` shows a fault that a later story fixed, don't count it. A false claim still counts even if the problem was fixed later, because the claim was false when it was made.
- **One root cause is one row.** If one bug breaks several requirements, write one row and list every requirement it breaks in `ref`.
- **Don't count:**
  - anything the spec marks out of scope, manual-only or "not covered";
  - a browser that couldn't run on the build machine;
  - decisions the agent recorded in `NOTES.md` where the spec leaves the choice open. It does count if the spec is explicit and the agent departed from it, even if the departure is noted.
- **Evidence is required.** Every row cites a file and line, a test name, or a held-out test title. If you can't point to the evidence, don't write the row.
- **Don't inflate and don't soften.** A missing feature is one row, not one row per consequence. A small wording difference with no user effect is `low`, not `medium`.

## Categories and severity

| category | meaning |
|---|---|
| `functional` | the delivered app behaves differently from a PRD requirement |
| `false-claim` | the agent claimed something that isn't true |
| `missing-test` | a test case the design lists has no test |
| `weak-test` | a test exists but can't catch what its test case is about, is skipped, or is in the wrong layer |
| `design-deviation` | differs from the design with no user-visible effect, including the process rules in step 6 |

| severity | meaning | examples |
|---|---|---|
| `high` | a core flow is broken | live sync doesn't work; typing loses or scrambles text; a main feature can't be used |
| `medium` | a PRD requirement is missed | a required handle, message, limit or behaviour is absent or wrong |
| `low` | an edge case or cosmetic | label wording; a rarely hit edge; a missing test for an edge case |

## Output: write exactly these files

`build-A.jsonl` and `build-B.jsonl` hold one JSON object per line:

```json
{"story": 7, "category": "functional", "severity": "medium", "ref": "sel.resize, sel.aspect",
 "discrepancy": "One sentence describing what differs from the spec.",
 "evidence": "src/client/board/SelectionOverlay.tsx:42 (no handles rendered for sticky notes); held-out 'corner resize keeps sticky square'",
 "verified_by": "code-read"}
```

- `verified_by` is `code-read`, `held-out`, or `own-run` (only if you actually ran something).
- `test-faults.jsonl` holds `{"build": "A", "story": 9, "test": "<title>", "verdict": "test-fault|undetermined", "reason": "...", "evidence": "..."}`.
- `summary.md` holds:
  - each build's counted rows by category and severity;
  - the functional faults per story for each build;
  - the three most serious faults in each build;
  - anything you couldn't settle.

The headline number is the count of `functional` rows. Before you finish, re-read both files and check:
- every row has evidence;
- there are no duplicates;
- the same kind of fault has the same severity in both builds.
