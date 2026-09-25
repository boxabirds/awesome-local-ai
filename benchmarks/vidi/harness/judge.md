# Vidi judge rubric

You are judging two implementations, **A** and **B**, of the same specification
(`spec/`), built one story at a time by two different local-model coding setups.
You do not know which setup produced which. Do not guess; it is irrelevant.

## Inputs (paths are given in the task)

- `spec/` — the specification. Stories in scope are listed in `scope.json`.
- `A/workspace`, `B/workspace` — the final repositories. `git log` shows one or more commits per story.
- `A/stories/NN/accept.json`, `B/...` — the held-out acceptance results after each story (black-box Playwright, never shown to the builders).
- `A/stories/NN/gate.json`, `B/...` — the builders' own build/typecheck/test results after each story.
- `A/stories/NN/screenshots/`, `B/...` — golden-path screenshots from the acceptance suite.

Acceptance and gate numbers are already computed. **Your job is what numbers cannot capture.** Read code; do not re-run anything unless you need to confirm a specific claim.

When a story's held-out tests fail, don't take the failure at face value: find how that implementation actually exposes the feature (its route or entry point, from its code and its own tests) and say whether the feature works that way. "Implemented but wired to a different address than the spec" and "not implemented" are different defects; name which one it is, with the path.

## Score each implementation 1–5 on each dimension

| Dimension | 5 means | 1 means |
|---|---|---|
| **Spec adherence** | Behaviour, UI copy, aria-labels and named settings match the PRD and design; deviations are deliberate and noted in NOTES.md | Large parts missing or reinterpreted; UI copy invented |
| **Architecture vs design** | Files, modules and interfaces follow the design's layout; pure logic separated from UI as designed | Ad-hoc structure; design ignored |
| **Test quality** | Tests assert the design's test cases (TC-nn) with real assertions; no tests weakened, skipped or tautological | Tests missing, trivially passing, or asserting implementation details only |
| **Code quality** | Readable, no dead code, named constants instead of magic numbers, errors handled where the PRD requires | Duplicated, dead or placeholder code; magic numbers; swallowed errors |
| **Product quality** | Screenshots look like a coherent product; interactions described in the PRD feel finished | Broken layout; placeholder UI; obviously unfinished |

For each score give **one sentence of evidence with a file path** (and line if useful). Scores without evidence are discarded.

Then list the **three most serious defects** in each implementation, most serious first, each with a path.

## Output

Return exactly this JSON:

```json
{
  "A": {"spec_adherence": {"score": 0, "evidence": ""}, "architecture": {...}, "test_quality": {...}, "code_quality": {...}, "product_quality": {...}, "defects": ["", "", ""]},
  "B": { ... },
  "overall": "A" | "B" | "tie",
  "overall_reason": "two or three sentences, citing the biggest differences"
}
```

Be blunt. A higher acceptance pass rate does not automatically make an implementation better code, and vice versa — say so when they disagree.
