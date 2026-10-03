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

**Layer A: function class (universal).** Re-derive from the data, not by hand: cluster paragraphs on **function-only**
features (vocabulary that occurs across every story, plus structure and cutpoint markers), choose the number of classes by
**stability** (agreement across seeds and across story splits), and name them by their strongest evidence. Cross-check: fit on
six stories, assign the other five, and measure how many keep their class. Target about 8 to 12 classes; a task-subject class
for what is left. *Gate:* stable across splits, and a person recognises them.

**Layer B: value label (critical, supporting, redundant).** Defined by measured rules first, from the proxies in section 3 (a
segment whose content is already in the prompt, the last result or an earlier thought, and which is not followed by a change
in the work, is a candidate for redundant), then **calibrated by intervention** on a sample: at branch points, skip a
segment and re-sample the continuation several times, and see whether the result or the cost changes. This is the only layer
that costs bench time, and it is the one that makes the labels mean anything for training. *Gate:* the rule labels agree with
the intervention labels well enough to use, or they are not used for training.

**Layer C: the classifier that runs at scale.** A light model (a bag-of-words or small-embedding classifier) trained on the
validated sample from A and B, run over every paragraph into `analytics.db` (a `segment` table: story run, call, paragraph,
function, value, confidence, version). Weak rules label first; a judge adjudicates a sample; the owner validates; the light
model learns from that. *Constraint found:* the platform's safeguards stopped Claude models, as subagents and in this session,
when asked to read these thinking texts, so the judge is either **a local Qwen model on a bench machine** or the owner. That
decision needs a free machine and the owner's say.

**Layer D: dataset builders, one per change.** From the same labelled store: (1) a **habit report** that ranks the redundant
classes by tokens spent, each with the instruction it suggests, feeding context-engineering series; (2) a **trajectory
filter** for rejection-sampled SFT (best result at least cost, split by story); (3) **branch-point pair and group builders**
for preference optimisation and RL (same state, several continuations, each with outcome and cost). Layer D is built only as
far as the evidence from A to C supports.

**Layer A, first result (`function_classes.py`, 3 Oct 2026).** For 6, 8, 10, 12 and 14 classes on the cross-story vocabulary,
two stabilities: across seeds (similar for all, adjusted Rand 0.55 to 0.62), and **across stories**, where a model fitted on half
the stories assigns every paragraph and is compared with one fitted on the other half:

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
thinking. That is five functions and one subject class, and it supersedes the 10-class merge proposed earlier. The 8-class fit
splits the subject class in two and the checking class in two (a module-and-import form), which is the first step towards
story-bound classes.

**Order, and what each step costs:**

| Step | Needs |
|---|---|
| A: function-only clustering, stability and cross-story check | no bench time |
| Segment cutpoints by rule, and the `segment` table | no bench time |
| B (rules): value labels from the proxies, with the evidence per class | no bench time |
| Owner validation of proposals (the tool) | the owner's time |
| B (intervention): branch-point replay on a sample | bench time and a free machine |
| C: train the light classifier, run at scale, audit | a labeller (local Qwen, or the owner) |
| D (1): habit report, then one context-engineering series | one 5-run series |
| D (2 to 3): datasets for fine-tuning | the story split decided; training hardware not assessed |

## 5. What this does not settle

- **Whether fine-tuning is worth it** is not shown by anything here. The evidence points at a spread of verbosity across runs,
  not at one removable behaviour; a prompt change is a cheap first test of that, and a fine-tune a costly one.
- **The training hardware** (what can train a LoRA on a 27B model or on the 80B-class sparse model, and where) has not been
  assessed.
- **A story split** costs half of an already small suite; new stories (a v3 suite or other apps) would be the better answer.
- **Classes derived on one app** are universal only after the cross-story check and, properly, a second task.
