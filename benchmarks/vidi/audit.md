# Vidi delivery audit: method

One rubric, applied the same way to every setup, so the counts compare. The audit checks the delivered code against the spec, and checks the agent's completion claims against the code. Its output is one row per fault.

> **Where the inputs are:** the spec and the held-out suite are in the private repo `boxabirds/awesome-local-ai-bench-private` (`packs/vidi/`), not here. Auditors and graders need access to it; ask the repo owner (Julian Harris). The blinded packages for independent graders are in that repo's `gradings/`, and their A/B keys are kept outside every repo.

## Inputs, per setup and per story
- **The spec:** `packs/vidi/spec/stories/<story>/` in the private repo (`prd.md`, `design.md`, `tasks.md`).
- **The delivered workspace:** code and the agent's own tests.
- **The agent's own claims:**
  - the Opus reference: its final report in `agent-reports/story-NN.md`;
  - harness runs: the agent's final messages in `stories/NN/agent-events.compact.jsonl.gz`.
- **Held-out results:** `accept.json`, and the suite source in the private repo's `packs/vidi/acceptance/tests/`.

## Checks, per story
1. **Tasks.** For every task in `tasks.md`, is its "Done when" met in the code?
2. **Test cases.** For every test case (TC-nn) that `design.md` lists, is there a test that checks what the TC says, in the layer it names? Record it if it is:
   - missing;
   - skipped (`skip`, `fixme`, a condition that never runs);
   - weakened (its assertions don't check the TC's point);
   - in a different layer.
3. **Requirements.** For every PRD requirement (by anchor), does the code implement it? That includes the exact UI text, `aria-label`s and the named settings in `src/shared/config.ts`.
4. **Held-out failures.** For each failing held-out test for the story, decide from the test source and the code whether it's an **app fault**, a **test fault** or **undetermined**. App faults become rows, merged with any duplicate from step 3. Test faults are listed separately and aren't counted against the setup.
5. **Gap-fills (runs with a PARTIAL story only).** For every story after a PARTIAL one, find code that implements the PARTIAL story's unverified tasks, or stands in for them. Use the story's `stub_markers` and `partial_heldout_changes` in `metrics.json` as leads. Record each as a `gap-fill` row: declared or undeclared, and real or stub.
6. **Claims.** Compare the agent's own statements ("all tests pass", "TC-12 covered", "nothing left undone") with what steps 1–5 found. Each false or overstated claim is a row.

## What doesn't count
- Anything the spec marks out of scope, manual-only or "not covered".
- WebKit not being run, when the machine couldn't launch it.
- Decisions recorded in `NOTES.md` that the spec leaves open.

## Row fields
| Field | Values |
|---|---|
| `story` | the story number |
| `category` | `functional` (behaviour differs from the PRD), `missing-test`, `weak-test`, `false-claim`, `design-deviation` (differs from the design with no user-visible effect), `gap-fill` (work that belongs to an earlier PARTIAL story, done in a later one: `declared` in NOTES.md under "Gap filled from story N", or `undeclared`; a stub or fake standing in for it is `high`) |
| `severity` | `high` (a core flow is broken), `medium` (a requirement is missed), `low` (an edge case or cosmetic) |
| `ref` | the PRD anchor, task number or TC id |
| `discrepancy` | one sentence |
| `evidence` | a file and line, a test name, or a held-out test title |
| `verified_by` | `code-read`, `held-out`, `own-run` |

The headline count is **functional** rows. The other categories are counted separately.
