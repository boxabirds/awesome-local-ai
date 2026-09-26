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
