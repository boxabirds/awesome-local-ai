# Failure modes of an agentic coding run

Knowing how a stack fails is as useful as knowing how it scores. A score says a combination is worse; a failure
mode says what to change, and whether the fault is the model, the quantisation, the engine or the harness.

These classes were drawn from one comparison — Qwen3.8-Flash-Next at 3-bit (GSQ-RCO IQ3_XXS, Strata) against the
same base model at 4/8-bit mixed (mlx-serve) — on the vidi pack, 6 October 2026. They are written to be applied
to any run, including older and weaker stacks, not to describe one engine.

Each class has a **detector**: a signal measurable from the warehouse (`ops/RUNBOOK-lake-warehouse.md`), so a run
can be scored against these without reading its conversation. The detectors are starting points, not finished
tools; where one needs judgement, it says so.

**A caution before using them.** The failing run that produced these was not incompetent. It independently found
and fixed a non-obvious pointer-capture bug that the winning run also found; it wrote idiomatic Yjs transaction
boundaries and surrogate-pair-safe text diffing; its edit-tool accuracy equalled the winner's; it read the
specification more often than the winner did. Nine of ten held-out tests it lost came from a single identifier it
changed on its own initiative. Failure modes describe *behaviour*, not *capacity*, and the two are easy to
confuse.

---

## FM-1 Spec Confabulation

Quotes a requirement from memory, in quotation marks, that is not in the specification, and then treats its own
quotation as authoritative over the file it could have read.

**Detect:** extract quoted strings from `calls.think_full`; grep the spec tree for each. A miss is a
confabulation. Needs judgement: not every quoted string is a claimed citation.

**Evidence:** story 2, call 147 — *"the design requires tooltips like 'Sticky note – centre of view'"*. That
string appears in no spec file; the word "tooltip" appears zero times in that story's design. It replaced correct
code with the invented requirement and recorded *"matches design exactly"*.

This is the one symptom in the set that looks like low-fidelity recall, which is where quantisation damage would
be expected to show.

## FM-2 Contract Drift

Changes a machine-checkable identifier — an `aria-label`, `role`, test id, route or exact user-facing string —
away from a literal the specification states, because its own wording seems better.

**Detect:** search tool payloads for the *drifted* form, not for the mandated literal. In `args_json` the payload
is JSON, so a quote in the source is stored as `\"`; a JSX expression has no quote at all, which is what makes the
drift findable.

```sql
select s.stack, s.run, s.story,
       sum(t.args_json like '%aria-label={%Sticky note,%') drifted
from stories s join tools t on t.sk = s.sk
group by s.stack, s.run, s.story having drifted > 0;
```

Run against the warehouse on 6 October 2026 this returns three rows: `v2-strata0139-r2` story 2 (the decisive
edit) and story 7, and `v2-mlx26101-r5` story 12. Nothing else in 33 stack+run pairs.

**Counting the mandated literal instead does not work, and the first version of this file said it did.** Every
one of the 33 pairs writes `aria-label=\"Sticky note\"` at some point, Strata included — four times in story 2.
A run that writes the right literal and then changes it is indistinguishable, by that count, from one that keeps
it. "A zero where a peer has a hit" never happens.

Two traps this cost: a run name is not unique — `v2-r4` names a run in three stacks, so every query here keys on
`(stack, run)` — and a `like` for a quoted literal must escape the quote as `\"` or it silently matches nothing.
Both are in `ops/RUNBOOK-lake-warehouse.md`.

**Evidence:** the whole failure. It wrote `aria-label="Sticky note"` correctly at call 48, confirmed it by grep at
call 149, and at call 150 changed it to ``aria-label={`Sticky note, ${note.color}`}``. Every held-out test for
stories 2 and 3 locates a note through `div[role="group"][aria-label="Sticky note"]`, so all of them stopped
finding notes at all. The drifted form was written again in story 7; the warehouse records what a run *wrote*,
not the state of its files, so how long the attribute stayed drifted in between is an inference from the
held-out results, not a measurement.

**Why it is the most dangerous class:** the cost is wildly out of proportion to the act. One attribute, changed
once, for a defensible-sounding reason, cost twenty-one tests across two stories.

## FM-3 Self-Improvement Override

The deciding criterion for a specification-governed choice is the model's taste rather than the document.

**Detect:** `calls.think_full` matching `better|nicer|reasonable|helpful|improve` within a sentence of an edit to
an identifier the spec fixes.

**Evidence:** story 2, call 145 — *"update the test to match implementation (the implementation's label is
better)"* and *"include it: nice for screen readers"*. Call 146 — *"Including the colour is reasonable."*

Distinguish from legitimate judgement: the test is whether the document speaks to the question. Where it does,
taste is a failure mode; where it is silent, taste is the job.

## FM-4 Oracle Inversion

When its own test and its own code disagree, it changes the test.

**Detect:** an edit to a `tests/` path in the call immediately after a tool reporting `failed > 0`, with no `src/`
edit in between.

**Evidence:** story 2, call 147 — *"the TC-18 test asserts `aria-label` equals "Sticky note" — I need to update
that too"*.

**Needs the thinking to judge.** The same shape appears legitimately: at call 223 the run rewrote a test's
expected mapping after 4,169 characters of reasoning that correctly derived the right pairing. The detector finds
candidates; only the reasoning separates a correction from a capitulation.

## FM-5 Self-Certifying Green

Declares the story finished on a suite it wrote and amended, while the external contract is broken.

**Detect:** `sum(tools.passed)` high with a held-out gain of zero.

```sql
with s as (select sk, stack, run, story,
                  passed - lag(passed,1,0) over (partition by stack, run order by cast(story as integer)) gained
           from stories)
select s.stack, s.run, s.story, s.gained, sum(t.passed) own_passed
from s join tools t on t.sk = s.sk
group by s.stack, s.run, s.story having s.gained = 0 and own_passed > 100;
```

**Evidence:** story 2, call 236 — *"All green (typecheck clean; build ✓; 57 + 67 + 36 tests pass)."* Held-out:
0 of 14. Story 5: 1,222 of its own assertions passing, 2 of 5 held out.

A green suite the agent controls is not evidence. This is the strongest argument for held-out tests existing at
all.

## FM-6 Prose Substitution

Replaces mandated user-facing copy with better-written prose, and documents the choice confidently.

**Detect:** PRD-literal strings absent from every tool payload of a run while present in a peer's.

**Evidence:** story 5. The PRD mandates *"Check the link, or ask the person who shared it to send it again."* The
run instead shipped *"The link may be mistyped, copied only part of the way, or a link that was never created."*,
with a docstring explaining the choice. Count of PRD-verbatim strings in tool payloads: this run 0, the peer 1.

## FM-7 Stale-Context Decision

Decides a contract-governed question long after the governing text has left the context window, without
re-reading it.

**Detect:** compare `compactions.end` with the `call_idx` of the last access to the governing file before the
decisive edit.

**Evidence:** `design.md` read at call 2; second compaction around call 140; the contract decision at call 150;
the file never re-read. Its three intervening re-reads covered a different section (the test-case table).

**Not sufficient on its own.** The winning run also compacted during the same story and also never re-read
`design.md`, and kept the contract. Compaction enables this class; it does not cause it.

## FM-8 Blind In-Place Patching

Mutates files with `sed -i` or inline interpreter rewrites instead of read-verify-edit, so a pattern that does not
match changes nothing, silently.

**Detect:** `count(*) where tools.arg like '%sed -i%'`. Thirteen across two stories here, against the peer's one.

## FM-9 Environment Self-Harm

A broad pattern kill takes out the agent's own process group.

**Detect:** `tools.error = '1'` with "exited with code 143" in the result, following a `pkill` or `pgrep` argument.

**Evidence:** two consecutive calls ending in code 143 after `pkill -f "wrangler dev"` and a `pgrep -f "[w]rangler"`
loop. (The repo's own operators have made this mistake: see the no-broad-pkill rule.)

## FM-10 No Landing

Ends at the operator's time cap still iterating, with no closing message — so there is no account of what was
done or left undone.

**Detect:** `stories.ended_by = 'operator'` with zero text characters in the conversation.

**Evidence:** story 3 — 310 calls, 240 minutes, zero text output, the last three tools still re-running a single
e2e test. The peer finished the same story in 103 minutes at 6 of 7.

---

## Checked and not evidenced

As useful as the classes. On this comparison these were looked for and **not** found, so they should not be
assumed of a weak stack:

| looked for | finding |
|---|---|
| tool-call looping | zero verbatim bash commands repeated more than twice, in either run |
| tool-format incompetence | edit failure rates statistically indistinguishable; the *winner* was worse on one story (20.5% vs 9.1%) |
| test disabling | no `.skip`, `.only` or trivialised assertions introduced |
| shortcutting | flag rate 10.1% against the peer's 10.5% — no difference |
| eval-gaming | the `eval_aware` flag fired on discussion of the harness's own progress file; a lexical artefact |
| specification neglect | the failing run consulted the spec **more** than the winner |
| context overflow | mean prompt 67,365 tokens against 67,994 — effectively identical |

## What these classes do not explain

Wall-clock. The failing run was slower per token for reasons that belong to the engine and the machine, not the
model: 31.8 tok/s and 8.4 s to first token against 73.8 and 1.6 s. That gap explains most of the time difference
and four of eight stories hitting the cap. **It must not be read as evidence about the model or its
quantisation.**

## Using these

1. Score a run against the detectors before reading its conversation; they narrow where to look.
2. A class is a hypothesis about behaviour until the thinking is read. FM-4 in particular has a legitimate twin.
3. Record which classes were looked for and not found. An absence is a finding.
4. One run is one sample. These came from a single run at temperature 1.0 with no fixed seed, and the decisive
   defect was a single edit. Repeating the story is the way to learn whether a class is systematic or a sample.
