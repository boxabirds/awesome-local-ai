# Local System One models (typed-decision models, and JevBench)

**Status:** on the horizon (3 Oct 2026), at the owner's request. Not run. Assessed from search results and one page of the
benchmark's own site; I read no repository and none of the numbers below is ours or checked. The sources disagree with each
other on benchmark versions and sizes (below), so quote none of them.
**Kind:** a different kind of benchmark, not another stack for the coding-agent benchmark. The unit is a short typed decision,
not a story; the measures are accuracy, calibration, latency and cost, not held-out tests and thinking. It would need its own
combination hierarchy (below).
**Sources:** the Benchmark Heaven page for the benchmark (`benchmarkheaven.com/jev-models`); a DataCamp explainer on Jev; the
repositories `amithgc/local-jev`, `OmniJev/awesome-jev-gallery`, `tak-bro/local-jev-bench`, `CYMCharming/system1bench`,
`dfranco-projects/jev-guardbench` and `DakotaTexas/jev-compatible-local-decider`, all found by search 3 Oct 2026.

## What a System One model is

TypeSafe's **Jev** popularised the idea: a model that answers a bounded question with a **typed decision** (yes or no, a
category, a score) and not with text, much faster and cheaper than a frontier LLM. The reported shape is a state and a bounded
rubric in, a typed answer out, behind a wire API (`/v1/systemone`). The name is the "System 1" of fast, intuitive judgement,
as against slow reasoning. A decision is typically a guardrail check, a routing choice or a label, the kind of call an
agent makes many times.

## The landscape, as the search shows it

Dozens of local competitors, most of them open-weight rebuilds on Gemma or Qwen foundations, by the sources' account:
`local-jev` (offline, wire-compatible with Jev's API), `decider` (fine-tunes of Qwen3.5, 2B to 35B-A3B, Apache 2.0),
`lichen` (a drop-in local server on open weights), Kev, Laya (Ollaya), AnyJev, CLM, Winnow and Cygnet, plus a "your local LLM
is already a Jev" server that turns any model with logprobs into one. One source reports Qwen3.8 Flash-Next, a model already in
our estate, answering faster than the hosted Jev on the benchmark's public items with higher accuracy on the harder ones;
treat that as a lead to check, not a result.

## JevBench

- **Run by** Benchmark Heaven, which says it is not affiliated with TypeSafe. It publishes system-level sealed aggregates; part
  of the item set is open and part sealed.
- **Measures:** a Capability Score that averages Intelligence (decision accuracy) and Calibration (how reliable the stated
  confidence is), with cost and latency reported apart. A system is "Jev-class" if it stays within twice the cost and median
  latency of the reference model, Jev 1.13.0.
- **Size and versions disagree:** one source gives 231 public items, the page I read gives 1,624 decisions per system in v1.5.6
  (904 open, 720 sealed) with 110 ranked systems. Earlier versions had fewer. Pin the version in any run.
- **Submission:** by API, by harness or by direct evaluation, so most of the work of a benchmark exists; what a local run needs
  is the thing to be evaluated served on the wire API.

## What it would take: the installer combinations

The hard part is not the benchmark but making each competitor installable and runnable here, as the repository does for the
coding stacks: weights, a server that speaks the benchmark's wire API, a pinned version, and the harness adapter. That is one
installer per server and model, many of them small (2B to 35B active parameters), which fit every machine we have, so the
machine becomes a dimension (latency is in milliseconds and depends on the machine) where for the coding benchmark it is a
fixed place.

**Why a different hierarchy.** The coding benchmark's path is `combinations/<family>/<version>/<variant>/<os>/<machine>/
<engine>-<client>/benchmarks/<pack>/<run>`, where the client is a coding agent and a run is a sequence of stories. Here there
is no agent client, a run is a batch of decisions, the result is a score and a latency distribution, and the thing that varies
is the server and its model (a system, as the benchmark calls it). Two ways to fit it:

1. **Inside the existing tree**, with the harness as the client (`<server>-jevbench`) and the benchmark as the pack. Keeps the
   installers, dbench and the benchmarker working unchanged; strains the meaning of a run, a story and the app's pages.
2. **Its own top-level kind**, such as `systems/<server>/<model>/<quantisation>/<os>/<machine>/`, with its own results
   layout and its own benchmarker pages. Cleaner, and more to build.

I'd decide after reading the benchmark's harness: if a run is one command that prints a score file, the second is cheap.

## What would bring it up the list

The owner's call on the hierarchy; then one installer for the reference local server (`local-jev`, the most direct), a run of
the benchmark's public items on one machine to see the shape of the results, and only then the others. No bench time is needed
for the first two steps beyond a smoke-length check.
