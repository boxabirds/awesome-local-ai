# Strategic insights

A strategic insight is a claim that would change a decision: which combination is better, what to run next, what
to stop running, whether something is worth building. `CLAUDE.md` requires one to be checked before it is said,
and the check reported with it. This directory is where the checked ones are kept, so a conclusion is not
re-derived, and so a wrong one can be found and corrected rather than quietly inherited.

## What belongs here

- A hypothesis that was tested against the data, whether it survived or not. **A refuted hypothesis is worth as
  much as a confirmed one** and is usually cheaper to act on.
- The evidence, in full, including the parts that cut against the conclusion.
- The query or method, so the reader can re-run it.

## What does not

- A figure without a decision attached to it. That is a result, and it belongs with the run.
- An observation about a single run, unless the point is the single run.

## Each note has

- **The claim**, in one line, as it would be said to someone making a decision.
- **Status**: supported, refuted, or partial — and what the claim became if it changed.
- **Evidence**: the figures, with the denominator, and the query that produced them.
- **What cuts against it**: outliers, small samples, confounds. Never omitted.
- **What it changes**: the decision that is now different.
- **How to re-check it**: so it can be re-run when more data exists.

## Index

| Note | Claim | Status |
|---|---|---|
| [gufo 0.5.0 decodes slower](2026-10-07-gufo-0.5.0-decodes-slower.md) | 0.5.0 is no slower than the build before it, per its release notes | **Refuted** |
| [Truncated stories do not cascade](2026-10-06-truncated-stories-do-not-cascade.md) | Cutting a story short at the time cap guarantees the next story fails | **Refuted** (corrected 6 Oct) |

## When one of these turns out to be wrong

Correct the note in place, keep its name, and add a section at the end saying what the figures were, what they
are, and what made the error survive. A note that is quietly rewritten teaches nothing, and the index should
show that a published conclusion has been revised. If the conclusion itself changes, say so in the status.
