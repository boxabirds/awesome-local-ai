# Thinking spread: how to explain it with evidence

Written 3 October 2026 in answer to the owner's question: "no one will believe me when I say the thinking spread is 35% or
more. It makes no sense. We need exhaustive evidence explaining a) when it happens, b) why, c) that it doesn't really
affect quality, d) what can reduce the chance of sessions going to the upper end." This is the research on how to analyse
it, with the first figures from the data already collected. Nothing here is a conclusion yet: section 2 says what is
established and what is a hint.

## 1. What the figure is, and what it is now

Thinking spread (`tools/benchmarker/shared/predictability.ts`): for each story, the standard deviation of the model's
thinking (characters) across the finished runs of one combination, divided by its mean; then the median over stories.
Time spread is the same on agent time. A combination needs at least three runs.

Figures from the live app's data (finished runs of the newest version family, `vidi-v2`), computed again here from the
same records:

| Combination | Runs | Thinking spread | Time spread |
|---|---|---|---|
| Swift 1.5 27B, llama.cpp, RTX 4090 | 7 | 83% | 62% |
| Flash-Next, gufo, Strix Halo | 5 | 61% | 25% |
| Flash-Next, mlx-serve, M5 Max | 4 | 20% | 26% |

So "35% or more" understates the Swift and gufo figures and overstates mlx-serve's. The claim has to be made per
combination. A fixture in the e2e tests shows 144%: that is a test fixture, not data.

The spread is large within one story: the same story, Swift, thinking in thousands of characters across seven runs:
story 4 ran 91, 112, 114, 158, 164, 617, 933; story 12 ran 10, 43, 66, 68, 230, 236, 473. A factor of 10 to 47 between the
smallest and largest run of one story.

## 2. What the data already shows (first pass, from the profiles in the records)

Method: per story run, `thinkingChars`, `calls`, `largestThinking`, agent seconds and the story's own held-out pass rate
(77 story runs for Swift, 55 for gufo, 44 for mlx-serve). Variance taken on logarithms, because the spread is
multiplicative.

1. **It is a run-to-run effect, not a story effect, for Swift and gufo.** Within-story variation is 77% (Swift) and 74%
   (gufo) of the total variance of log thinking. Which story it is explains little. For mlx-serve it is 36%: there the
   stories differ more than the runs do.
2. **It is mostly how much the model writes per call, not how many calls it makes.** Within a story, variance of log
   characters per call is 0.36 (Swift) and 0.25 (gufo), against 0.15 and 0.07 for log call count. Rank correlation
   within story between a run's thinking and its characters per call is 0.93 for both. In mlx-serve the two are
   comparable (0.02 and 0.04), and its spread is low.
3. **It is not one runaway block.** The largest single thinking block is a median 16% of its story run's thinking (Swift)
   and at most 43%. A few giant blocks are not what makes a run high; the whole run is verbose.
4. **No sign that more thinking means worse held-out results.** Within a story, thinking and the story's own held-out pass
   rate correlate +0.36 (Swift, n=77), +0.09 (gufo) and +0.24 (mlx-serve). That is a hint, not evidence: a hard
   attempt may both think more and need more tests to pass, the pass rate saturates, and n is small. It does not yet
   support "doesn't affect quality"; it fails to contradict it.
5. **The same model family differs by engine.** Flash-Next is 61% on gufo and 20% on mlx-serve. They differ in engine and
   quantisation, and (not recorded for these older runs) possibly sampling settings. That is the nearest thing to a
   controlled comparison in the data. It points at the serving stack, not the model alone.
6. **Recorded settings that could matter** (Swift's `run.json`): temperature 1.0, K and V cache quantised to `q4_0`, no
   thinking budget, thinking mode "unknown: the chat template's default applies". gufo and mlx-serve's older runs
   record no engine settings at all.

Caveats on all of the above: seven runs is a small sample for a spread; the Swift runs mix two sets (`v2-fresh-*` and
`v2-r*`) that may not be exchangeable and need checking; characters are a proxy for tokens; the profile's thinking
count includes thinking the agent never acted on.

## 3. Why this is partly an NLP problem, and what to do about it

Counts say how much; they cannot say what the thinking was. The literature gives the vocabulary and the methods:

- **Overthinking** is the reported pattern of models continuing to explore, or re-checking, after a correct answer is in
  reach; a survey of efficient reasoning models covers it, and names self-reflection markers ("Wait", "Hmm") as the
  signal that a chunk of reasoning has changed direction.
  [Don't Overthink It (survey)](https://arxiv.org/pdf/2508.02120)
- **Loops**: "Wait, Wait, Wait… Why Do Reasoning Models Loop?" reports that open reasoning models loop at low
  temperature, with looping falling as temperature rises, and ties it to small temporally correlated errors being
  amplified. Our Swift runs use temperature 1.0, which makes this a hypothesis to test, not an explanation.
  [Wait, Wait, Wait](https://arxiv.org/abs/2512.12895)
- **Which sentences matter**: "Thought Anchors" measures each sentence's effect by resampling the continuation from that
  point many times and comparing the distribution of final answers; it finds the sentences that matter are mostly
  planning and uncertainty management, and the many "active computation" sentences matter less. "Thought Branches"
  argues that interpreting a trace needs resampling and not a single trace.
  [Thought Anchors](https://arxiv.org/abs/2506.19143), [Thought Branches](https://arxiv.org/pdf/2510.27484)

These were read as search results and abstracts, not as full papers; none of their numbers is relied on here. What they
give us is a method set, and a warning: one trace per condition is anecdote.

Our setting differs from theirs in a way that matters: thinking here comes in many short bursts, one per tool call, in a
session that is compacted, resumed and nudged. The unit of analysis is the **call**, nested in the story run, nested in
the run.

### Proposed layers, cheapest and most defensible first

Each layer answers a question the next one would otherwise be trusted on faith for.

**Layer 0: structure (no NLP).** One row per call: story run, call index, thinking characters, tokens, whether a
compaction preceded it, context size, the tool result that came before it (test pass, test fail, error, build), time
since the last commit, and whether the story's gate was green. This alone answers much of (a): where in a story run the
heavy thinking sits (after failing tests? right after a compaction? late, past the last commit?). The conversation
profile already holds the per-run versions of several of these (median thinking before and after a compaction,
largest block, context at start and end).

**Layer 1: transparent text features (cheap NLP, reproducible).** Per thinking block: compression ratio (gzip), repeated
n-gram share, similarity to the previous blocks in the same story run (embedding cosine, with a lexical
cross-check), count of reflection markers, share that is code or quoted tool output, share that restates the task or
earlier context. These need no judge model; anyone can recompute them. They separate "long because it is working
through something new" from "long because it repeats itself".

**Layer 2: a labelled taxonomy (an LLM judge, validated).** Segment thinking into steps and label each, for example:
planning, recalling the spec, reading a result, forming a debugging hypothesis, drafting code, re-verifying something
already verified, expressing doubt, repeating an earlier step. Validate before trusting: hand-label a stratified sample
(about 100 blocks, across low, middle and high runs of each combination), measure the judge's agreement with it and a
second judge's agreement with the first, and publish the confusion table. A judge that is not validated on our traces
is an opinion.

**Layer 3: counterfactual replay (the causal layer).** The question under (b) is whether the spread is sampling noise or
different trajectories (different code, different test output, different state). The harness can re-run a story from
the same prefix (`--from-run --stories`, a partial rerun). Re-running one story N times from an identical starting
state removes the state differences: if the spread survives, it is the model and the sampler; if it collapses, it is the
path. This is the Thought Anchors idea at the grain we can afford (whole stories, not sentences). It needs bench time.

DuckDB (the aside): good for layers 0 and 1. It can query the compact JSONL logs and Parquet files directly and join the
per-call rows with the records, with no server; the embeddings and labels from layers 1 and 2 would be Parquet files
beside them. It is not needed for scale (a few hundred story runs, tens of thousands of calls); its value is that one
SQL statement answers each "when does it happen" question over every run. dbench already keeps a SQLite conversation
database; DuckDB would be a scratch analysis layer over the same logs, not a second system of record. Not tested here.

## 4. The four questions, and what would count as evidence

**a) When does it happen?** Layer 0 and 1 over every call: thinking per call against its position (early, late, after a
compaction), the preceding result (failure, success), context size, the time since the last commit. A claim worth
making would be shaped like "the high runs are the ones where X happened early", each with the table behind it. Also
the run-level view: are the high runs the same runs across stories (a run-level state, such as a session that started
verbose), or different ones? Item 1 above says the variation is run-to-run, so the first thing to look at is whether a
run's verbosity is persistent across its own stories.

**b) Why?** Layer 2 gives what the extra thinking consists of (for example repeated verification vs more planning).
Layer 3 separates noise from path. Settings recorded for Swift are candidates (see d).

**c) Does it affect quality?** The honest form is a paired analysis: within one story, runs with more thinking against
runs with less, on the story's own held-out result and on the story's final gate, with a mixed model (story as a random
effect, run as another) and its interval, not a correlation alone. Two further measurements make it concrete: the share
of thinking that came after the story's last commit (which changed nothing), and matched pairs of runs with the same
outcome and three times the thinking. Item 4 is a start; it would be a mistake to publish it as the answer. Quality is
also measured coarsely (held-out tests per story, a few to ten), and that limits what any such analysis can show.

**d) What reduces the chance of the high end?** These are experiments, each run as a series against the baseline, in
order of how directly the data points at them:
1. The serving stack: Flash-Next on mlx-serve (20%) against gufo (61%), with the engine settings recorded for both.
2. Swift's recorded settings: K and V cache quantisation (`q4_0`), no thinking budget, temperature, and the chat
   template's thinking default. Change one at a time.
3. A thinking budget or a reasoning-effort setting where an engine honours one, checked against what it really does.
4. Compaction threshold and context length, if layer 0 shows heavy thinking clustering after compactions.
5. Harness and prompt levers (the nudge, the task wording) last: they change what is being measured.

## 5. Risks to the argument

- Seven runs per combination: a spread from seven runs has a wide interval of its own; it should be shown with one.
- Two kinds of Swift run (`v2-fresh-*`, `v2-r*`) are pooled; check they are comparable before pooling.
- A judge model's labels can be wrong in a systematic way. Validate (layer 2) and report the agreement.
- "Does not affect quality" is a negative claim; the evidence is an interval around zero, and its width is the claim.
- Reading the thinking text means reading what the model wrote: it must stay marked as data in anything shown, and out of
  the app's own words.
- The reference models (Claude Opus and Sonnet) are the quality yardstick and are excluded from this analysis, as from
  every conversation analysis (owner's rule, 3 October 2026): including them muddies the optimisation paths.

## 6. Proposed order

1. Layer 0 and the first half of layer 1 over the data we have: no bench time. Answers most of (a), part of (c).
2. Hand-label about 100 blocks and validate a judge (layer 2): the owner's reading of a sample is what makes it
   credible.
3. Decide with the owner which experiments from (d) get bench time; layer 3's replay of one high-spread story is the
   cheapest causal test.
