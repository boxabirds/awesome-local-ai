# The benchmark guide

An interactive guide to how the benchmark works: the problems it solves, the entities and how they relate, the
components, nine key flows as step-through illustrations, and the operational insights from
[benchmarks/docs/insights/](../insights/README.md) attached to the things they illustrate.

**Open [index.html](index.html) from disk.** It needs no server and no network: no CDN, no web font, no remote
image. It works at phone and desktop width, in light and dark colour schemes, from the keyboard, with JavaScript off
(the content is in the HTML; the script only adds interaction) and when printed.

## What is in this folder

| Path | What |
|---|---|
| `index.html` | The page. **Generated**: do not edit it by hand. |
| `assets/guide-data.js` | The content, in one place: entities, problems, insights, components, flows (diagrams and steps), findings, glossary, status ledger. |
| `src/page.tpl` | The page's own prose and structure, with placeholders where the data goes. |
| `build.mjs` | Builds `index.html` from the two files above (Node, no dependencies). |
| `assets/guide.css`, `assets/guide.js` | Look and interaction. No dependencies. |
| `test/guide.test.mjs` | The test (below). |

Why a build step: the content has to be in the HTML for the page to read without JavaScript, and in one data file
for it to be maintainable. The build does both. It also draws the entity map and every flow diagram as inline SVG from
the data (positions and links), so a diagram can never disagree with the entity or step it shows.

```sh
node benchmarks/docs/guide/build.mjs            # write index.html
node benchmarks/docs/guide/build.mjs --check    # fail if index.html is out of date
node benchmarks/docs/guide/test/guide.test.mjs --static   # checks that need no browser
node benchmarks/docs/guide/test/guide.test.mjs            # everything (needs Playwright)
```

The full test uses the Playwright that the benchmarker installs: run `bun install` in
[tools/benchmarker](../../../tools/benchmarker/README.md) first, or set `PLAYWRIGHT_DIR` to a folder that has
`node_modules/playwright`. It fails when the page has console errors or loads anything over the network, when a
link is broken or a glossary term is unresolved, when a number or a quotation in an insight is not in the file it
cites, when the page is not what the build produces, when headings or landmarks are wrong, when text contrast falls
below 4.5:1, or when any entity, stepper, filter or search stops working. It is not part of the harness release
checks in [tools/dbench/checks.toml](../../../tools/dbench/checks.toml): run it yourself after a change.

Also run `bash tests/privacy-test.sh` and `bash tests/links-test.sh` (this README is checked by the second).

## The data file

Every string can use inline markup: `` `code` ``, `**bold**`, `{g:term|text}` (a glossary link), `{e:entity|text}`,
`{f:flow|text}`, `{i:insight|text}`, `{p:problem|text}`, `{c:component|text}`, and a markdown link: its path is written from the repo
root and the build makes it relative (or give a full `https://` address). An unknown id fails the build.

| Section | Holds | Shown as |
|---|---|---|
| `groups`, `entities` | The seven groups and the entities. Each has `what`, `contains`, `rel` (its outgoing relationships, `[label, entity]`), `repo` links, a real `example`, an optional `status` and `insights`. `group` and `row` place it on the map. | The entity map, the detail panel, and the entity list. Incoming relationships are worked out. |
| `problems` | The eleven problems, each with a concrete `example`, a `control`, and the insight panels and entities it names. | Section "The question, and why it is hard". |
| `insights` | One "in practice" panel each: `body`, `numbers`, an optional `chart` and `quotes`, a `use`, and `sources`. | An expandable panel everywhere it is named. |
| `components` | Each tool: what, why, inputs, outputs, how it fails, language, repo links, status. | Section "Components". |
| `flows` | Nine flows: `diagram` (nodes at x,y, edges, optional via points) and `steps` that name the nodes and edges they light up, with commands and repo links. | The steppers. |
| `findings` | The findings of the insights README by theme and combination. | The explorer table. |
| `glossary` | Every term. `auto` lists phrases linked automatically (first use in each paragraph). | The glossary, the hover text and the dotted links. |
| `ledger` | What is in progress, planned, an idea, or built, and where a document disagrees with the code. | Section "What is built, and what is not". |

## Rules

1. **Every fact comes from the repository, never from memory.** Where a document and the code disagree, say what the
   code does (and put the disagreement in the ledger). If you are not sure how something works, read the code; if you
   still are not, leave it out or write "not documented".
2. **Numbers in insights are copied from the file the panel cites, and quotations are verbatim.** The test checks both.
   Where the findings withhold something (the stories behind leaked credentials), the guide withholds it too.
3. **Mark the state honestly.** Anything that is on main but not in a harness release, built but not wired in, or only
   proposed is `in-progress`, `planned` or `idea`, never `built`. Check `git log` and the release tag
   (`git tag -l 'harness-v*'`, `git log <tag>..HEAD -- benchmarks/spec-bench`) before claiming that something runs.
4. **Public repo.** No secrets, no machine hostnames (write "the RTX 4090 machine", "the M5 Max", "the Strix Halo box",
   "this Mac"), no home paths, and nothing about what the held-out tests check. The private repo is out of bounds.
5. **No external resources**, ever: the page must stay readable from a clone with no network.

## The guide must change when the benchmark system changes in a major way

A change is major if it adds, removes or renames an entity, a component or a stage of a flow; changes what is
published or what the benchmarker shows; changes the evaluation policy; ships a release that moves something from
"in progress" to "built"; or adds an analysis. Update the guide in the same change, or in the next one, and say so in
the commit.

Checklist:

- [ ] **A new or changed entity** (a pack, a record field, a kind of run, a score): `entities` (and its `rel` links so
      the map stays connected), `glossary`, and any `problems`, `flows` or `components` that name it.
- [ ] **A changed step of the harness** ([run.sh](../../spec-bench/harness/run.sh),
      [drive.py](../../spec-bench/harness/drive.py), the scoring and publishing modules): the matching `steps` in the
      flows (B, C, D), including the numbers in them (4 hours, 8 identical calls, 4 GB of swap, 5 attempts…). Search the
      data for the constant's old value.
- [ ] **A changed dbench behaviour** ([tools/dbench](../../../tools/dbench/README.md)): flow A, flow F, the dbench
      component, the `job`, `node-server`, `hold` and `harness-release` entities.
- [ ] **A harness release, or something landing on main**: the `ledger`, the `status` of the entities and flows, and
      every "on main, not in release 1" note. Release 2 turns most of them into "built".
- [ ] **A change to the benchmarker's pages or rules** ([tools/benchmarker](../../../tools/benchmarker/README.md)):
      flow E, "How to read a result" in `src/page.tpl`, the benchmarker component and entity.
- [ ] **A new tool under `tools/`, `ops/` or `benchmarks/`**: `components`, and an entity if it is a thing people will
      name.
- [ ] **A new analysis or a new findings file**: `insights` and `findings`, with the source file cited so the test can
      check the numbers.
- [ ] **A new combination, engine, machine or client**: the entity examples, the `combos` list, the glossary.
- [ ] **Anything that changes where the evidence is kept** (what is public, what is private): problems 5 and 9, the
      `record`, `private-repo` and `credential-scan` entities, flow D.
- [ ] Run `node benchmarks/docs/guide/build.mjs`, then the test, then `bash tests/privacy-test.sh` and
      `bash tests/links-test.sh`, and look at the page at phone and desktop width, light and dark.

## Where each entity and insight lives

All of it is in [assets/guide-data.js](assets/guide-data.js), found by id. These two lists are kept by hand: update them when you add or rename an id.

**Entities** (`GUIDE_DATA.entities`), by group:

- **Define**: `pack`, `spec`, `scope`, `story`, `task`, `prompt`, `heldout`
- **Stack under test**: `combination`, `model`, `engine`, `machine`, `client`, `settings`, `install`, `reference`
- **A run**: `run`, `workspace`, `story-run`, `attempt`, `session`, `conversation`, `compaction`, `stop-message`, `intervention`, `progress-file`, `time-split`
- **Scoring**: `gate`, `accept`, `rescore`, `finalize`, `score-record`, `invalid-run`, `not-comparable`
- **Operate**: `job`, `dbench`, `node-server`, `hold`, `harness`, `harness-release`, `provenance`, `partial-rerun`
- **Safeguards**: `sandbox`, `containment`, `machine-guard`, `credential-scan`, `private-repo`
- **Show and watch**: `record`, `benchmarker`, `gallery`, `monitor`, `anomaly-log`, `insights`, `horizon`

**Insights** (`GUIDE_DATA.insights`), with the file each is copied from. A panel appears wherever an entity, problem, component or flow step lists its id.

| Id | Theme | Cites |
|---|---|---|
| `variance-spread` | method | the gufo analysis |
| `nudge-continue` | behaviour | insights/README.md, insights/findings-behaviour.md, the gufo analysis |
| `thinking-spread` | performance | insights/README.md, insights/findings-performance.md, the gufo analysis |
| `spec-writes` | security | insights/README.md, insights/findings-security.md |
| `inherited-failures` | behaviour | insights/README.md, insights/findings-behaviour.md |
| `code-before-tests` | behaviour | insights/README.md |
| `invented-constraints` | behaviour | insights/README.md, insights/findings-behaviour.md |
| `grader-awareness` | behaviour | insights/README.md, insights/findings-behaviour.md |
| `own-green-vs-heldout` | behaviour | insights/README.md |
| `engine-endings` | behaviour | insights/README.md, insights/findings-behaviour.md |
| `mlx-cache` | performance | insights/README.md, insights/findings-performance.md |
| `rewrites-rereads` | performance | insights/README.md, insights/findings-performance.md |
| `cd-prefix` | performance | insights/README.md, insights/findings-performance.md |
| `mistyped-path` | behaviour | insights/README.md, insights/findings-security.md |
| `story-shape` | performance | insights/README.md, insights/core-tables.md |
| `compaction` | performance | insights/README.md, insights/findings-performance.md |
| `exit-status` | behaviour | insights/README.md, insights/findings-performance.md |
| `done-after-failing` | behaviour | insights/README.md, insights/findings-behaviour.md |
| `weakened-tests` | security | insights/README.md, insights/findings-behaviour.md |
| `scoring-guard` | method | EVALUATION-POLICY.md |
| `reference-build` | security | insights/README.md, insights/findings-security.md |
| `shared-tmp` | security | insights/README.md |
| `sudo-libs` | security | insights/README.md |
| `heredocs` | security | insights/README.md |
| `kill-by-name` | security | insights/README.md, insights/findings-performance.md, insights/findings-security.md |
| `credentials` | security | insights/README.md, insights/findings-security.md |

## Where each flow's facts live

| Flow | Verify against |
|---|---|
| A. Submitting a job | [tools/dbench/README.md](../../../tools/dbench/README.md), `tools/dbench/src/` (`server.rs`, `runner.rs`, `harness.rs`, `failure.rs`, `recovery.rs`) |
| B. A run, end to end | [run.sh](../../spec-bench/harness/run.sh), [preflight.py](../../spec-bench/harness/preflight.py), [machine_fit.py](../../spec-bench/harness/machine_fit.py) |
| C. One story's loop | [drive.py](../../spec-bench/harness/drive.py) (`main`, `run_story_agent`, `story_finished`, the constants near the top), [CONTROL.md](../../spec-bench/harness/CONTROL.md) |
| D. After the run | [finalize.py](../../spec-bench/harness/finalize.py), [rescore.py](../../spec-bench/harness/rescore.py), [EVALUATION-POLICY.md](../../spec-bench/EVALUATION-POLICY.md), [publicise.py](../../spec-bench/harness/publicise.py), [credentials.py](../../spec-bench/harness/credentials.py) |
| E. A number reaches the benchmarker | [tools/benchmarker/README.md](../../../tools/benchmarker/README.md), `server/domain.ts`, `server/faults.ts` |
| F. A harness release | [tools/dbench/README.md](../../../tools/dbench/README.md) (releasing), [checks.toml](../../../tools/dbench/checks.toml) |
| G. A partial rerun | [spec-bench README](../../spec-bench/README.md), the gufo analysis, `drive.py` (`known_good_base`) |
| H. The monitor | [ops/monitor/README.md](../../../ops/monitor/README.md), [triage-prompt.md](../../../ops/monitor/triage-prompt.md) |
