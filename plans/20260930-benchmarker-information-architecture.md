# Benchmarker: information architecture reboot

Status: **proposal for review**. Nothing here is built yet.
Scope: the Runs and Machines screens of `tools/benchmarker`. Setup stays as it is. The judging gallery stays a separate tool, linked from here.

## 1. Why

The page has grown one request at a time, and every addition went wherever there was room. Each fact exists somewhere, but a question about one thing needs three or four places that don't link to each other.

Take one run, Swift 1.5 v2-r2. What we know about it is spread over seven places:

| Where | What it shows about v2-r2 | Links onward? |
|---|---|---|
| Runs → Combinations table (top) | nothing of its own: folded into "3.8-swift-1.5/27b llamacpp", 70% | no |
| Runs → By machine → node-a → its row | status, stories built, agent time, squares, tokens, tok/s, score, judge, record | GitHub only |
| the same row, expanded ▸ | per-story tokens and speeds | no |
| Runs → By story → pick a story → its bar and its row | where that story's time went; that story's numbers | no, and one story at a time |
| Machines → node-a → job `vidi-v2b-swift15-r2` | job state, Stop, Log | no, and under another name |
| GitHub | record, summary | out of the app |
| Gallery | the judging view | out of the app |

Three problems follow, and they matter more than any single layout fault:

1. **There is no page for any thing.** Runs, stories, combinations and machines are only rows inside views built for something else, so there is nothing to link to. "Jump to the rest of this run" has no destination.
2. **Names don't match between places.** The same run is `v2-r2` in Runs, `vidi-v2b-swift15-r2` in Machines, and `3.8-swift-1.5/27b llamacpp` in the Combinations table, which also drops the client and the hardware. The only way to match them is by recognising them.
3. **Similar numbers mean different things in different places.**
   - "Held-out quality" (a pooled pass rate over all runs shown, live scores included);
   - "Score / 75" (the final re-score of record);
   - "stories passing held-out tests" (live, latest build);
   - "held-out passing (latest build)" in the story table.

   These are four measures of the same question, each on a different screen, with different rules. The methods review (30 Sep) found the headline one mixes finished and running runs and several suite versions.

## 2. The core entities

The data has six things. Four are the ones you named; the other two are there because the page can't be honest without them.

| Entity | What it is | Identity (stable id) | Example |
|---|---|---|---|
| **Combination** | a stack: model + quant + engine + client, on one hardware class | its folder path | `qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi` |
| **Machine** | a dbench node: hardware, installs, queue | node name | `node-a` |
| **Run** | one attempt by one combination on one machine at one pack version to build the whole spec | combination + run id | `…/llamacpp-pi` · `v2-r2` |
| **Story** | one unit of the spec | pack + story number | vidi 2: "Capture ideas on sticky notes…" |
| **Story run** *(new)* | one run's work on one story: the atom everything else is built from | run + story | Swift 1.5 v2-r2 · story 2 |
| **Job** | one dbench execution of a run. A run restarted twice has three jobs; a job is not a run | job id | `vidi-v2b-swift15-r2` |

Also in the context (a filter, not a page): **pack** and **suite version**.

**Hardware class (decided 30 Sep).** A combination includes its hardware class, and a hardware class is one exact machine spec: CPU, memory size and type, GPU, and so on. In practice each machine is its own class. A second box identical to an existing machine in every respect would share its class, and its runs would pool with that machine's. Near-identical machines (the same except DDR4 against DDR5) are separate classes. They can be *rolled up* along a hardware tree when you choose to, as a thick branch with small variations, but that is an explicit grouping on the page, never the default.

How they relate:

```
Combination 1───* Run *───1 Machine
                    │
                    1
                    │
                    * Story run *───1 Story
Run 1───* Job   (restarts)
```

**The key decision:** every number on the page is a story-run fact, or an aggregate of story-run facts. That covers time split, tokens, calls, held-out result, conversation features and mechanism label.

- A run is a row of the story-run matrix (runs × stories).
- A story is a column.
- A combination is a block of rows.
- A machine is the rows that ran on it.

If the page is built on that one matrix, every view is a slice of it. Cross-referencing then comes for free: every cell knows its run and its story.

## 3. The site map: one page per entity, every mention a link

```
Overview                          /
├── Combination                   /c/<combination>          (runs × stories, aggregate, variance)
│   └── Run                       /r/<combination>/<run>     (its stories, cost, score, jobs, links)
│       └── Story run             /r/<combination>/<run>/s/<n>  (the atom: time, tokens, tests, conversation)
├── Story                         /s/<n>                    (every run's attempt at it, by combination)
├── Machine                       /m/<machine>              (hardware, now, queue, operations, history)
└── Setup                         /setup                    (unchanged)
```

Rules that apply everywhere:

- **Every mention of an entity is a link** to its page: a combination name, a run id, a story number, a machine name, a job id. Each is rendered as one consistent "entity chip" component. A cell in a matrix links to its story run.
- **Every page has a stable URL**, including its context (pack, suite version) and state (compare-to run, selected story). You can bookmark it, share it, and use the back button.
  - A hash router (`#/r/…`) keeps the single-file server as it is.
- **A breadcrumb on every page:** `Overview › 3.8-swift-1.5 27b llamacpp · node-a › v2-r2 › story 2`.
- **"Related" is structural, not ad hoc.** Every page shows its parents and siblings:
  - a story run links to the same story in the combination's other runs, and to the next and previous story in this run;
  - a run links to the combination's other runs.
- **One name per thing, everywhere.**
  - Combination: a short label built from all four parts (model, quant, engine, client), with the full path on hover. Today's labels drop the client.
  - Run: `v2-r2`, always shown with its combination chip.
  - A job is always shown as "job 2 of 3 for v2-r2", never as a bare dbench id.

This answers your example. From the cost breakdown for a run (a story run's time bar), the run's name is a link to the run page, which carries everything else about it. The story number links to the story page. The time bar of each story on the run page links back to that story run.

## 4. The pages

### 4.1 Overview (replaces the Runs tab's top half)

What it answers: *how do the stacks compare, and does anything need me?*

```
┌ vidi · vidi-v2.0-pre2 ▾ ────────────────────────────────────────────── repo 3s · dbench 2s ┐
│ NEEDS YOU (3)                                                                                  │
│  ⚠ Swift 1.5 v2-r2 finished, not scored  → run        ⚑ gufo story 2 varies 4.4× → combination │
│  ● node-b idle, nothing queued → machine                                                   │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NOW   node-a  Swift 1.5 v2-r3 · story 4 · 21 min      node-c  mlx v2-r2 · story 3 · 48 min    │
│       node-d   gufo v2-r3 · story 3 · 9 min            node-b  idle                        │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ COMBINATIONS (finished runs of record only)                                                     │
│ Combination                    Machine   Score /75          Hours/story       Runs            │
│ Opus 5.5 · Claude Code         mba       75  (74–75, n=3)   0.3 (0.2–0.3)     3 ✓             │
│ Flash-Next · mlx-serve · pi    node-c   66  (n=1)          1.5               1 ✓ 1 ▶ 1 ⏸     │
│ Flash-Next · gufo · pi         node-d    63  (58–68, n=2)   0.9 (0.7–1.0)     2 ✓ 1 ▶         │
│ Swift 1.5 27B · llama.cpp · pi node-a   61  (n=1)          0.8               2 ✓ 1 ▶ (1 unscored)│
│   n is too small to rank stacks closer than ~12 tests; see Method                               │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Rank on the score of record:** median, range and n, from finished runs re-scored under the current suite. A pooled version of it (tests passing over all tests, across those same runs) is fine alongside, because it pools like with like.
- **The current pooled "held-out quality" leaves the ranking but not the page.**
  - What it mixes is the problem, more than the variance: running runs (whose early stories are easier), live per-story scores from other suite versions (pre1, a dirty pre1), and weighting by tests per story. On 30 Sep Swift and gufo were 84.7% vs 84.6% pooled but 81.3% vs 84.0% finished-only, so the order flips on what's included.
  - It stays as progress for running work, labelled "live".
- **"Needs you"** is a list of exceptions, each a link:
  - finished but unscored;
  - scoring faults;
  - accounting problems;
  - variance flags (the 10% rule);
  - idle machines;
  - stuck stories.

  Today these are scattered: "waiting for scoring" in a table cell, a ⚠ in a time bar, "idle" in a machine heading.
- **"Now"** gives one line per machine for what is running. The per-machine tables below it go away; they move to the machine pages.
- **Combinations can be sorted.** Each row links to its combination page, and each machine name to its machine page.

### 4.2 Combination page (new; this is your "runs in aggregate" request)

What it answers: *how good and how costly is this stack, how consistent is it, and why do its runs differ?*

```
Flash-Next · gufo · pi  on node-d (Strix Halo 128 GB)      [config ▾: quant UD-Q4_K_XL, MTP 7, effort low (not applied)…]
Score 63 (58–68, n=2)   Hours/story 0.9 (0.7–1.0)   Output tokens/story 94k (51k–291k)
────────────────────────────────────────────────────────────────────────────────────────────
            story →   1     2     3     4     5     7     8     9    10    11    12   │ score  hours
 v2-r1  ✓ 68        ■12m  ■80m⚑ ■29m  ■30m  ■21m  ■22m  ■27m  ■31m  ■204m⚑ ■33m  ■31m │  68   11.1
 v2-r2  ✓ 58        ■10m  ■18m  ■41m  ■70m⚑ ■35m⚑ ■45m  ■24m  ■38m  ■27m  ■30m  ■25m │  58    7.5
 v2-r3  ▶ story 3   ■ 9m  ■14m  ▶                                                    │   —     —
 median             10m   18m   35m   50m   28m   34m   26m   35m   27m   32m   28m
────────────────────────────────────────────────────────────────────────────────────────────
 Cell = one story run: colour = held-out result for that story, text = agent minutes; ⚑ = over 10% from the median,
 with its mechanism on hover ("verbose thinking: one 64k-char block, then 5× the thinking per call").
 Metric switch: [minutes] [output tokens] [calls] [held-out] [tok/s]
```

- **The runs × stories matrix is the page.** Each cell is a story run (a link). A metric switch changes what the cells show, over the same layout.
- **Per story:** the median, and a variance flag on each cell more than 10% from it, labelled with its mechanism. Classification is mechanical, from the conversation logs; no LLM.
- **Below the matrix:**
  - the time bars per run, all runs on one scale ("where the time went", summed over the run);
  - a mechanism tally ("verbose thinking 4 of 33 story runs · many small steps 1 · hung command 1");
  - the combination's config, and its diff against any combination you compare it with. The methods review asks for that diff next to every comparison.
- **Compare with another combination:** a second matrix under the first, with the same stories aligned.

### 4.3 Run page (new; the destination your example needs)

What it answers: *everything about this run, in one place.*

```
Swift 1.5 27B · llama.cpp · pi  ›  v2-r2        on node-a · vidi-v2.0-pre2 · harness 0b1e75d3
Finished 30 Sep 15:28 · 9h55m agent time        Score of record: 63/75 (re-scored 30 Sep, install needed --legacy-peer-deps)
[Judge →] [Record on GitHub] [Summary] [Workspace history]
──────────────────────────────────────────────────────────────────────────────────────────────
STORIES     1   2   3   4   5   7   8   9  10  11  12        ← each a story run; held-out colour
            ■   ■   ■   ■   ■   ■   ■   ■   ■   ■   ■
WHERE THE TIME WENT   (one bar per story, one scale; click a bar → that story run)
  1 ▇▇▇▇▇▇▇▇▇▇ 11m
  2 ▇▇▇▇▇▇▇▇▇▇▇▇ 13m
  …
COST          out 1.6M · input 163M · 3k calls · 46 tok/s · compactions 9 · nudges 0
HELD-OUT      live after each story: 6/6 → 20/20 → 21/27 → … → 63/75 ; re-score 63/75 (matches)
JOBS          job 1 of 1 vidi-v2b-swift15-r2 · done · 05:46–15:28 · [Log]
              (a restarted run lists each job, and the restart reason)
PROVENANCE    suite version per story · harness commit per story · interventions · accounting checks
COMPARE WITH  [v2-r1 ▾]  → the two runs as matrix rows, differences flagged
```

Everything that's now in the row, the expanded row, the by-story view, the Machines job line and the external links is on this page, in one reading order: identity → outcome → where the time went → cost → evidence → provenance.

### 4.4 Story run page (new; the atom)

What it answers: *what happened in this run on this story?*

- **Header:** run chip › story chip; held-out result for this story (which tests failed, with the test title, not the Playwright dump); agent time; status (DONE or PARTIAL, and why).
- **Where the time went:** the bar, with the accounting check.
- **Cost:** tokens, calls, tok/s, decode tok/s, compactions, nudges, restarts.
- **Conversation profile** (mechanical: counted from the agent's event logs by a script, no LLM and no chat, as in the story 2 forensics of 30 Sep):
  - thinking per call over time;
  - the largest thinking block;
  - context growth;
  - tools by kind;
  - failed commands;
  - the mechanism label.
- **Against the combination:** this story in each of the combination's other runs (as a small multiple of time bars), and the medoid run's profile beside this one. This is the built-in deep-dive.
- **Links:** Judge at this story, the story's commit, the agent-events log.
- **Next and previous story** in this run. **The same story** in the combination's other runs.

### 4.5 Story page (replaces "By story")

What it answers: *how does every stack do on this story?*

- It keeps what works today (time bars on one scale, the table, "set as comparison"), grouped by combination and not as a flat list.
- Each combination shows its median and range, then its runs.
- The story's spec (the PRD title and a link), its held-out test count, and its tests' titles.
- The left-hand story list stays, as navigation between story pages.

### 4.6 Machine page (merges the machine's section of Runs with its card on Machines)

What it answers: *what is this machine, what is it doing, and what has it run?*

- Hardware, installs (each a combination link), dbench version, reachability.
- Now: the running job (a run link plus story), then the queue in order, with the operations (Stop, Remove, Log, Queue a run) right there.
- History: every run on this machine, grouped by combination, each a run link.
- The Machines tab becomes the list of machine pages plus "Add a machine".

## 5. Information design rules

1. **One number, one definition, one name, everywhere.**
   - A single glossary (in code, one module) defines each measure: name, definition, unit, what's included, and its hover text. Every page reads from it.
   - The glossary is also a page (`/method`) that each hover links to ("more…").
2. **Keep "of record" and "live" visibly apart.**
   - The score of record is shown one way: bold, with n and range.
   - A live or provisional number is always labelled "live", in a lighter style, and never enters a ranking.
3. **Show uncertainty wherever there is more than one run:** median, range, n. No bare means. A warning when n is too small for the difference shown.
4. **Show exceptions, don't hide them.** Unscored, faulted, unchecked, partial and restarted things are visible, labelled, and linked to why. The methods review found survivorship bias in dropping them.
5. **Fixed visual vocabulary.**
   - One colour scale for held-out results (all pass, some, none, not built, building).
   - One set of colours for time-bar parts.
   - One set of icons for status (✓ finished, ▶ running, ⏸ queued, ✕ failed, ⊘ cancelled).
   - Nothing else uses those colours.
6. **The same component for the same thing.** The time bar, the story strip (squares), the entity chip and the metric cell are each one component, used on every page at every level. What you learn once reads the same everywhere.
7. **Density follows the level.** The overview is sparse, combination and story pages are matrices, and run and story-run pages are detailed. No page tries to be all three, which is what the current By-machine table does.
8. **Keyboard and links first.** Every chip and cell is a real link (middle-click opens a tab). Arrow keys move between cells in a matrix; Enter opens one. There's a visible focus ring.

## 6. What goes, and where things move

| Today | Becomes |
|---|---|
| Runs tab: Combinations table | Overview → Combinations (score of record, median, range, n) |
| Runs tab: By machine | Overview "Now" + Machine pages + Run pages |
| RunRow's expanded per-story table | Run page → Stories and Cost |
| By story | Story pages |
| "Where the time went" (story view only) | a component on story run, run, combination and story pages |
| Machines tab cards | Machine pages; jobs listed on their run's page too |
| "Held-out quality" (pooled) | removed from rankings; "live" progress on the run page |
| "Stories passing held-out tests" squares | the story strip component, on every run mention |
| Status filter chips | kept on lists (overview and machine history); not global |
| Pack and Version selects | kept, global, in the URL |

## 7. Data the pages need that the server doesn't provide yet

- **Story run as a first-class record in `/api/state`**, with its own id. Today it's `Story` inside `Row` with part of the data; the held-out squares are in a separate array.
- **Conversation features per story run** (thinking per call, the largest block, context jumps, failed commands, mechanism label). Computed by the harness at the end of each story and by a backfill script over the full logs; no LLM.
- **Jobs attached to their run** (dbench job ids, start and end, restart reasons); today they're only in the Machines API.
- **Provenance per story** (suite version, harness commit); the methods review found `run.json` overwritten on restart.
- **Combination config** in comparable form (quant, KV-cache precision, draft tokens, effort requested vs applied, context, compaction).
- **Aggregates computed server-side from one definition module:** median, range, n, flags.

## 8. How it gets built (after you approve)

Each phase ships working, is tested (unit + e2e), and is checked in the browser on a private port before the live page switches over.

1. **Model and routing.**
   - Story run and job records in the API;
   - the glossary module;
   - a hash router;
   - the entity chip and breadcrumb.

   The existing views link their names to the new routes (which show the old view until the page exists).
2. **Run page.** This fixes your example first: every run mention everywhere becomes a link to it.
3. **Story run page**, including the conversation features (harness side and backfill) and the deep-dive against the medoid.
4. **Combination page**, with the matrix, the variance flags and the mechanism tally. This delivers "runs in aggregate".
5. **Overview and Machine pages**, which retire the By-machine view and the Machines tab cards.
6. **Story page**, which retires By story. Old URLs and saved selections redirect.

Tests: each page gets an e2e test from the fixture, and there's a **cross-link test**: from any entity mention, following its link reaches that entity's page, and from every page, its parent and siblings are one click away. That test is what keeps the thing cross-referenced as it grows.

## 9. Decisions I need from you

1. ~~Combination identity~~ **Decided:** a combination includes its hardware class, and each exact machine spec is its own class; roll-ups along a hardware tree are optional (see section 2).
2. ~~Drop the pooled "held-out quality"~~ **Proposed instead:** rank on the score of record (pooled only over finished, current-suite re-scores), and keep the live pooled figure as labelled progress for running work. *Waiting for your answer.*
3. **The conversation profile** is mechanical extraction from the event logs: a script at the end of each story, plus a backfill over the logs kept on each machine. No LLM. Is that in the first cut, or later?
4. **Order.** Run page first (your example), then combination (your aggregate request)? Or combination first?
5. **Publication.** The run and story-run pages will show failing held-out test titles. That's fine for a local tool, but it depends on your decision about publishing test reports (methods review C1). This page must never be what leaks them if it's ever hosted.
