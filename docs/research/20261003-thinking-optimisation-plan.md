# From thinking to optimisation: what the classes must be

3 October 2026. The owner's brief: work backwards from what we want to change. We want opportunities to (1) improve the
quality of the output by context engineering (the system prompt, what the agent is told), and (2) bake in better quality,
faster inference or less thinking variance by fine-tuning. So the classes of thinking must map tractably onto data for those
changes. This document works out what each change needs, what that demands of a class, and the plan that follows.

Sources for the methods are search results read as abstracts and summaries, not full papers; what each is said to show is
stated as theirs, not ours. Our own figures come from `docs/research/20261003-thinking-spread.md`.

## 1. The changes, cheapest first, and what each needs from its data

| Change | What it is | What its data must be |
|---|---|---|
| **Context engineering** | Change the system prompt or what the agent is shown: an instruction against a named habit. A series of runs against the baseline. | A class that **names a habit a sentence can instruct against** ("do not re-run a check that has passed"), and a measured link from the habit to cost or result. No training data. |
| **Rejection-sampled fine-tuning (SFT, LoRA)** | Train on the model's own best trajectories: those that reached the best result at the least cost. LoRA is how the weights are trained cheaply (a small adapter), not what is trained on. | **On-policy trajectories** with an outcome and a cost per trajectory. Classes help by **editing** a trace (cutting redundant segments) or **weighting** segments. One source reports that SFT on shortest-path demonstrations does not learn to backtrack, so whole good trajectories are safer than pruned ones. |
| **Preference optimisation (DPO and relatives)** | Train on pairs: a chosen and a rejected continuation. | **Pairs that share the same prompt**, differing in outcome or cost. One source builds pairs from a raw and a refined trajectory with the same final answer. Offline pairs shape behaviour the model already shows; they do not teach what it never did right. |
| **RL with verifiable rewards (GRPO and relatives)** | Sample a group of completions per prompt, reward each by a check, learn from the differences. A length penalty can be added; one line of work scales it by the prompt's solve rate. | A **verifiable reward** (our held-out tests are one), **a group of rollouts from the same state**, and the cost in tokens. Segment-level credit assignment (cutpoints between sub-problems; redundancy-aware rewards that penalise redundant steps) is the active research on putting the reward where it belongs. Compute-heavy: each rollout is a story run. |

Two facts from our own setup shape every row:

- **Our held-out tests are the benchmark.** Fine-tuning on a story's trajectories and then scoring that story's held-out
  tests measures memory, not skill. Any training set needs a split by story (train on some stories, score the others) or new
  stories. We have 11 stories of one app: a small and narrow set, so a model tuned on it will learn this app.
- **Our trajectories do not share prompts.** Two runs of a story diverge after the first few calls, so natural preference
  pairs and RL groups do not exist. They have to be made by **branching**: re-running from an identical state (a partial
  rerun, which the harness already does) several times at a chosen point. Everything in rows 3 and 4 depends on that.

## 2. What follows for the classes

Working backwards, a class is useful for an optimisation only if it has these properties. The 14 themes found so far fail
the first and fourth.

1. **It names a change, not a topic.** Each class must point at an action: keep, shorten, remove, reward, penalise, or an
   instruction. "Zoom and camera maths" points at nothing; "re-verifying what already passed" points at an instruction, a
   penalty and an edit.
2. **It carries value, not only function.** What matters to every row above is whether a segment **earns its tokens**.
   Function ("looking", "checking", "drafting") says what a step is; value says whether it was needed: *critical*,
   *supporting* or *redundant*. The redundancy-aware and segment-level methods above need exactly this label. So a class has
   two parts: a function, and a value.
3. **It is universal.** Defined by what the thinking does, never by the task's subject, so it carries to other tasks, other
   stacks and a new suite (the owner's requirement). Subject-bound themes stay as one explicit "task subject" class.
4. **It is linked to outcome by evidence, not by naming.** A class's value is measured: observationally (within a story, does
   more of it go with a better result), by proxy features (below), and for a calibration sample by **intervention** (remove
   or skip a segment at a branch point and re-sample what follows; the same idea as counterfactual resampling of sentences in
   the research on "thought anchors", at a coarser grain).
5. **It sits on segment boundaries.** Edits, penalties and credit all need clean units. The paragraph is the unit now;
   cutpoints at the turns of thought ("but", "wait", "let me") are the better unit and can be found by rule.
6. **It can be assigned cheaply at scale.** There are about 100,000 calls. A judge model cannot read them all; a light
   classifier trained on a validated sample can.
7. **It is stable and validated.** Stable under re-clustering and across stories; recognised by a person; and its labels
   audited against a second labeller.

## 3. Evidence we already have that bears on value

The analytics layer holds proxies for value per segment, built for another purpose and usable now:

- **Redundancy:** `repeat5` (repeats inside a block), `prev_sim` and `max_prev_sim` (similarity to earlier thinking),
  `prompt_overlap` and `result_overlap` (restating the task or the last tool result).
- **Outcome around the call:** `prev_tests_passed` and `prev_tests_failed` (the state the call reacted to), and the next
  call's, which is the effect of this one; `prev_tool_errors`; position, compaction and context size.
- **Cost:** output tokens and seconds per call.

What the data says so far, which the plan must respect: a high-thinking run is a generally more verbose run, not one stuck in
one mode (every theme tracks its share of the spread); about half of the runs that reach a story's best result already think
less than the median, by up to five times between the shortest and longest; and the longest calls (over 10,000 characters, 1.3%
of calls on Swift 1.5, 30% of its thinking) are up-front planning and code drafting that go with better results (77% against
61% own pass rate), not loops. So the waste, if there is waste, is not in the longest calls; it is spread, and it needs a
value label, not a size cut.

## 4. The plan: a generalised classifier in four layers

### Why four, and in this order

Read backwards from the change, which is how the brief asks for it: a fine-tune needs a **dataset** of a particular shape
(layer D); a dataset needs a label on **every** segment, not on a sample (layer C); a label is only worth training on if it
says whether the segment **earned its tokens**, not merely what it was about (layer B); and worth can only be judged per
**kind** of step, because a plan, a re-check and a draft are worth different things (layer A).

Read forwards, each layer answers one question and hands the next its answer:

| | Question | Hands on |
|---|---|---|
| **A** | What kinds of thinking are there, independent of the task? | A vocabulary: a small set of universal function classes |
| **B** | Which of them earned their tokens? | A value label per segment, and the evidence for it |
| **C** | How do ~100,000 calls get labelled without reading them all? | A classifier, and a labelled store of every segment |
| **D** | What does each kind of change actually consume? | One dataset builder per change from section 1 |

Today we are before A: every statement we can make is about "thinking" in aggregate ("the spread is 83%", "a run is
generally more verbose"), and no change can be aimed at an aggregate. The layers exist to turn that aggregate into
something a sentence in a prompt, or a row in a training set, can address.

### Layer A — the kinds (universal function classes)

**Question.** What kinds of thinking are there, in words that carry to another task?

**Unit.** A paragraph today (208,753 of them). It should become a **segment**: thinking cut at the turns of thought, which
a rule can find ("but", "wait", "actually", "let me", a numbered list item, a fenced block). A paragraph is often several
steps; a segment is one. Everything downstream, an edit, a penalty, a credit, needs the smaller unit, so this is the first
build.

**Method.** The one already used: TF-IDF over vocabulary that occurs across every story (so the app's nouns cannot form a
class), then NMF, which gives each segment a mixture rather than one label. The number of classes is not chosen by taste:
it is the largest number that still **reproduces on stories it was not fitted on**.

**First result (`function_classes.py`, 3 Oct 2026).** For 6, 8, 10, 12 and 14 classes, two stabilities: across seeds
(similar for all, adjusted Rand 0.55 to 0.62), and **across stories**, where a model fitted on half the stories assigns every
paragraph and is compared with one fitted on the other half:

| Classes | Across-story agreement (adjusted Rand) | Matched-class cosine |
|---|---|---|
| 6 | 0.47 | 0.75 |
| 8 | 0.41 | 0.69 |
| 10 | 0.34 | 0.63 |
| 12 | 0.25 | 0.62 |
| 14 | 0.23 | 0.64 |

The more classes, the more they depend on which stories they were fitted on: **the data supports about 6 universal classes,
not 10 or 14**, and even 6 agree only moderately across story halves. Read by their strongest terms, the 6 are: weighing and
correcting ("but", "so", "not"); looking at existing code or the spec ("look at", "understand"); checking a detail ("check");
running tests and announcing the next action ("run the tests", "now let me write"); code drafted in the thinking ("const",
"return", "export"); and one **task-subject** class (notes, zoom, widths, selection), which is the app's and not a way of
thinking. That is five functions and one subject class, and it supersedes both the 14 themes and the 10-class merge proposed
earlier. The 8-class fit splits the subject class in two and the checking class in two (a module-and-import form), which is
the first step back towards story-bound classes.

**The honest problem with it.** 0.47 is moderate agreement, not good agreement. Two things should be tried before the
classes are trusted: fitting on **segments** rather than paragraphs (a paragraph mixes steps, which blurs every class), and
**removing the subject vocabulary entirely** before fitting rather than relying on the cross-story filter to dilute it, since
the subject class is where most of the story-dependence lives. If neither lifts it, the honest answer is that five classes
is what one app's data can carry, and the sixth is a bucket.

**Artefact.** `themes_v2.json` (id, name, one-line definition, evidence terms) and the fitted model beside it, as v1 already
is. **Gate:** across-story agreement at or above the 6-class figure, *and* the owner recognising the classes on a sample of
proposals. Failing the second gate is as disqualifying as failing the first.

### Layer B — the value (did this segment earn its tokens?)

**Question.** A function class cannot tell anyone what to change. "Code drafted in thought" could be the most valuable thing
the model does, or pure waste; our own data says the longest such calls go with *better* results. The label that points at an
action is value, and it needs three grades:

- **critical** — remove it and what the agent did next, or the story's result, changes.
- **supporting** — it informs the step, but it could have been shorter or carried by another segment: removing it costs
  tokens, not outcome.
- **redundant** — its content is already available (in the prompt, in the last tool result, or in an earlier segment of the
  same story run) *and* nothing changed because of it.

**Two ways to get that label, different in kind, both needed.**

*(i) Rules over measured features — cheap, total coverage, circumstantial.* The analytics layer already holds the features
(section 3). A redundancy rule has two halves: **the content was already available** (`max_prev_sim`, `result_overlap` or
`prompt_overlap` over a threshold) **and nothing came of it** (the next call writes nothing, runs nothing new, or repeats a
tool call it has already made). Both halves matter: overlap alone is not waste, because restating a failing test before fixing
it is how the model keeps its place.

*(ii) Intervention — expensive, a sample only, causal.* At a branch point, re-run the story from the identical state N times
with the segment present, and N times with it cut, and compare held-out result and tokens. This is the only procedure that
can say "redundant" and mean it. The harness can already restart a story from another run's state (a partial rerun), so the
machinery exists; the cost is bench time, N rollouts per branch point.

**How they relate.** (i) is what the classifier in layer C learns from; (ii) is what tells us whether (i) measures anything
at all. If the rule labels and the intervention labels disagree on the calibration sample, the rules are reported as
observations and never used as training targets. That is the gate.

**A worked example, measured today.** The clearest redundancy rule I can state: *a test run that passed, when the previous
test run also passed and nothing was written or edited in between* — a re-check of work nothing had touched.

| Stack | Calls matching | Share of calls | Share of all output tokens |
|---|---|---|---|
| Flash-Next / gufo | 404 of 12,890 | 3.1% | 1.5% |
| Swift 1.5 / llama.cpp | 306 of 15,087 | 2.0% | 1.1% |
| Flash-Next / mlx-serve | 263 of 10,888 | 2.4% | 1.2% |

**This is the honest shape of such a finding, and it is why the plan is built this way.** It is a real habit, recognisable,
and a prompt sentence could address it. It is worth about 1% of output tokens. Five such rules might be worth 5%. That is a
context-engineering result, not a fine-tuning one: it would be absurd to train a model to recover 1%, and the measurement
costs nothing. The plan must therefore be able to *stop at D1* and report a handful of instructions, and only escalate to
training if the accumulated redundant share is large enough to be worth the contamination risk and the compute.

**Artefact.** A value label and a rule name per segment, plus a per-rule report of count and tokens. **Gate:** agreement
between rules and intervention on the calibration sample, stated as a number.

### Layer C — the labeller that runs at scale

**Question.** Layers A and B are established on hundreds of segments. Every dataset builder needs the label on all of them:
roughly 100,000 calls, and more segments than that. Nobody reads those.

**Pipeline, in four steps.** (1) **Weak labelling:** layer A's model gives every segment its function mixture, layer B's
rules give a provisional value. (2) **A gold set:** a stratified sample (by class, by confidence, by stack) is adjudicated,
one label per segment, and the owner validates proposals in the labelling tool. (3) **The light classifier:** a supervised
model, logistic regression over the same TF-IDF features plus the context features (position, what preceded, overlap), trains
on the gold set and relabels everything. (4) **An audit:** a fresh sample is re-validated against the trained labels.

**Why a supervised classifier and not the NMF model.** NMF is unsupervised and reads the text alone, so it can only ever give
*function*. Value depends on what happened around the segment as much as on its words, so it needs the context features and a
supervised target. Those are different models, which is why A and C are different layers rather than one.

**Artefact.** A `segment` table in `analytics.db`: story run, call index, segment index, character span, function class,
value, confidence, model version. Derived, rebuildable, never in the warehouse, like everything else in the analytics layer.

**The constraint that decides who the judge is.** Twice in this session, Claude models asked to read these thinking texts
were stopped by platform safeguards: a Sonnet 5.5 subagent and then an Opus 5.5 one, both on the same adjudication task. That
is a fact about the plan, not a preference. The judge in step 2 is therefore **a local Qwen model on a bench machine**, or
the owner, or rules alone with no judge. That decision needs a free machine and the owner's say, and it gates the size of the
gold set: a judge makes thousands affordable, the owner makes it hundreds.

**Gate.** The light classifier's agreement with held-out gold items, per class. A class below the stated rate is not used
downstream; it is better to carry four trustworthy classes than six shaky ones.

### Layer D — the dataset builders, one per change

Each change in section 1 consumes a different shape. D is the adapter from the one labelled store to those shapes, and each
builder is written only when the evidence justifies it.

**D1 — the habit report → context engineering.** *In:* the segment table and tokens. *Out:* a ranked list of redundant
patterns, each with how many calls and how many tokens it costs, and the instruction it suggests. *Then:* one 5-run series
per candidate instruction against the baseline, scored on held-out result first and tokens second. This is the only branch
that can run today, the only one with no training cost, and the only one whose result is directly actionable. The worked
example above is its first row.

**D2 — the trajectory filter → rejection-sampled SFT or LoRA.** *In:* finished story runs with outcome and cost. *Out:* for
each story, the trajectories that reached the best held-out result at the least cost, as training examples. *Blockers:* a
**story split** is mandatory, because our held-out tests are the benchmark and training on a story then scoring it measures
memory; with 11 stories of one app, a split halves an already small set. The literature also reports that training on
shortest-path demonstrations does not teach backtracking, so the filter should prefer *whole* good trajectories over
pruned ones, which makes the value labels a weighting rather than a knife.

**D3 — branch-point pairs and groups → DPO, GRPO.** *In:* branch points chosen by layer B (states where a decision was about
to be made), re-run N times each. *Out:* for preference methods, pairs sharing a state that differ in outcome or cost; for
RL, groups of rollouts each with a verified reward from the held-out tests. *Blockers:* bench time proportional to branch
points × N, where each rollout is a partial story run, so this is the most expensive thing in the document by a wide margin.
Nothing here is built until D1 has said whether there is enough to bake in.

**Order, what each step costs, and where it can stop.** The plan is built so that it pays for itself early and can be
abandoned at any gate without having wasted the steps before it.

| # | Step | Needs | Stop here if |
|---|---|---|---|
| 1 | Segment cutpoints by rule, and the `segment` table | no bench time | — |
| 2 | A: refit on segments, stability and cross-story check | no bench time | agreement stays below the 6-class figure: report five classes and go no further |
| 3 | B (rules): value labels and the per-rule token cost | no bench time | no rule is worth more than a fraction of a per cent |
| 4 | Owner validation of the proposals | the owner's time | the classes are not recognisable: redraw or abandon |
| 5 | **D1: habit report, then one context-engineering series** | one 5-run series | **the instructions work: take the win and stop** |
| 6 | B (intervention): branch-point replay on a sample | bench time, a free machine | rules and intervention disagree: value labels stay observations |
| 7 | C: train the light classifier, run at scale, audit | a labeller (local Qwen, or the owner) | per-class agreement too low: carry only the classes that pass |
| 8 | D2, D3: datasets for fine-tuning | story split decided; training hardware not assessed | the redundant share is too small to be worth training for |

Steps 1 to 5 need no bench time but one series, and they are the ones most likely to produce something usable. Steps 6 to 8
are where the cost is, and nothing commits to them until step 5 has reported.

## 5. What this does not settle

- **Whether fine-tuning is worth it** is not shown by anything here. The evidence points at a spread of verbosity across runs,
  not at one removable behaviour; a prompt change is a cheap first test of that, and a fine-tune a costly one.
- **The training hardware** (what can train a LoRA on a 27B model or on the 80B-class sparse model, and where) has not been
  assessed.
- **A story split** costs half of an already small suite; new stories (a v3 suite or other apps) would be the better answer.
- **Classes derived on one app** are universal only after the cross-story check and, properly, a second task.
