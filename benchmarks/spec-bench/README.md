# spec-bench

The harness that runs a coding agent through a **spec pack**, one story at a time, on any installed
combination, and records every story. [Vidi](../vidi/) is the first pack; any other spec in the same
shape runs the same way.

```sh
benchmarks/spec-bench/harness/setup-node.sh [--pack benchmarks/<name>]      # tools, pack, sandbox preflight
benchmarks/spec-bench/harness/run.sh <install-id> [--pack benchmarks/<name>] [--scope NAME | --epic NAME] \
    [--run-id ID] [--only 1,2] [--record]
benchmarks/spec-bench/harness/drive.py --pack benchmarks/<name> [--epic NAME] --dry-run   # check a pack, no model
```

`--pack` defaults to `benchmarks/vidi`. Results land in
`combinations/<COMBINATION>/benchmarks/<pack-name>/<run-id>/`. dbench runs this harness when a job
names a pack (`dbench submit … --pack benchmarks/<name>`).

## How runs are judged

[EVALUATION-POLICY.md](EVALUATION-POLICY.md): what held-out tests may check, when a failure counts against the agent, and what every run reports. A pack meets it before it's used.

## Known-good mode: one story on its own

```sh
benchmarks/spec-bench/harness/run.sh <install-id> --only 7 --from-run benchmarks/reference/vidi/opus-5.5/run-3 --run-id kg-07-01
```

Runs one story on another finished run's code as it was when the story before ended, so a stack's
work on that story is measured without earlier mistakes carried in, in the time of one story instead of
a whole run. The workspace keeps the reference run's history up to that point and nothing after, the
held-out suite is run on the base first so regressions still count, and the summary is labelled
diagnostic. It isn't mixed with full runs (EVALUATION-POLICY rule 7). The reference run must have been
built from the same spec.

To carry on from there to the end of the scope, give `--from-story N` in place of `--only N`:

```sh
benchmarks/spec-bench/harness/run.sh <install-id> --from-story 10 --from-run combinations/<combination>/benchmarks/vidi/<run-id> --run-id kg-from-10-01
```

Story N is built on the reference run's code as before, and every later story of the scope on the one before it
in this new run, as a full run does from story 1. The reference run supplies only the base, so it need not have
run the later stories. A restart resumes at the first unfinished story, like any run. Its record says which it
was (`known_good.continues` in `metrics.json`), and it is as diagnostic as the one-story form.

## Protecting the machine

While the agent works, the harness stops it if swap grows by more than 4 GB or free memory falls below 8%, and records which processes held the memory at the story's lowest point. On Linux the agent is also started with the highest OOM score (`oom_score_adj` 1000), which everything it runs inherits: its tests, dev servers and browsers. If memory runs out before the guard acts, the kernel kills one of those instead of the model server, which would otherwise be its first choice as the biggest process. Raising a score needs no root and lasts only as long as those processes; nothing on the machine changes.

On Linux with a systemd user manager the agent also runs in its own scope (a cgroup) with a memory limit, so every process it starts stays visible to the harness even after its parent dies: what a tool call started is killed when the hang guard cuts the call off, old orphans go first when memory runs short, and the whole scope is emptied at the end of each story. Details and tests: [tools/agent-containment/PROPOSAL.md](../../tools/agent-containment/PROPOSAL.md).

## What gets recorded

Every run and story records its configuration, what the agent did, where the time went (model
prefill and decode, tools, compaction), the machine's conditions (GPU clock, power, temperature,
memory) and the scores: [TELEMETRY.md](TELEMETRY.md) lists every field, where it lands and which
machines produce it. When you change what the harness records, update it;
[`harness/test_telemetry_doc.py`](harness/test_telemetry_doc.py) fails until you do.

## What a pack is

A pack is named by its directory here, `benchmarks/<name>/`. Its contents are found by
[`packdir.py`](harness/packdir.py): `$SPEC_BENCH_PACK_DIR`, then `packs/<name>` in the private repo
(`awesome-local-ai-bench-private`, checked out next to this one, so held-out tests stay out of public
training data), then `benchmarks/<name>/` itself. A pack can also be split: a public spec here and
only its held-out parts (`acceptance/`, `GRADING.md`) in the private repo's `packs/<name>/`, which
is how [todoodle](../todoodle/) is laid out.

| Path | Needed | What |
|---|---|---|
| `spec/stories/NNN-slug/{story,prd,design,tasks}.md` | yes | the stories; the number in the folder name is the story id, the first line of `story.md` its title |
| `spec/epics/<name>.md` | for `--epic` | a table whose rows start `\| <id> \|` |
| `scope/<name>.json` | for `--scope` | `{"stories": [{"id": 1}, …], "out_of_scope_note": "…"}` |
| `prompts/story.md.tmpl` | no | the pack's own story prompt; otherwise [`prompts/story.md.tmpl`](prompts/story.md.tmpl) |
| `acceptance/tests/story-NN.spec.ts` | no | the held-out Playwright suite; without it acceptance is reported **n/a**, not 0/0 |
| `GRADING.md` | no | the brief an independent grader follows |
| `bench.json` (in `benchmarks/<name>/`) | no | `name`, `default_scope`, `pack_ref` (the private repo tag to pin), `gate` (npm scripts every story must pass), `app_line` and `rules` (for the generic prompt) |

With none of the optional parts, a pack runs every story, gates each on the default npm scripts
(`build`, `typecheck`, `test:unit`, `test:component`, `test:integration`, `test:e2e`) and reports
acceptance as n/a. [`harness/test_pack.py`](harness/test_pack.py) checks a pack in that shape, and
that vidi still renders exactly the prompts its runs recorded.

The harness used to live at `benchmarks/vidi/harness/`; the scripts there now only forward here.
