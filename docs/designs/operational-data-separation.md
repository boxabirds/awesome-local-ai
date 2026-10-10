# Operational data separation

Design for a clean separation between the **systems** (the harness, dbench, the benchmarker, the gallery, the specs,
the combination definitions, the held-out suite) and the **operational data** those systems produce (every run's
record, logs, scores, conversations, workspaces, audits, judge results, recordings, the lake, the warehouse). Written
10 October 2026 from the code as it is; every claim names the file it was read from. Not yet approved.

## Context

Today one git repository is both. Of the roughly 800 MB git tracks in the public repository, 785 MB is run data
(`combinations/qwen` 701 MB, `benchmarks/reference` 85 MB): 62 run records, 563 compact conversation logs, 10,356
files under agents' `workspace/` trees, committed after every story since 24 September 2026. The tools are 4 MB.
Anyone who clones the repository gets every benchmark the owner has run, which the owner has not chosen to publish.

The fusion is not only in the tree. On each bench machine one checkout of `main` plays three roles at once
(`benchmarks/spec-bench/harness/roots.py`, "the results root"):

1. **System input.** Combination definitions (`combinations/*/config.sh`, `profiles.tsv`, `help.txt`), the public
   parts of packs (`benchmarks/<pack>/bench.json`, scope), the reference stacks' `stack.env`. dbench runs
   `git pull --ff-only` in it before a job (`tools/dbench/src/runner.rs:238`).
2. **The data directory.** The harness creates each run *inside* this tree
   (`combinations/.../benchmarks/<pack>/<run>/`), and keeps the raw logs out of git only by writing a `.gitignore`
   into every run (`drive.py:459`, `RUN_GITIGNORE`).
3. **The publisher.** After every story the harness commits and pushes from it: about 300 lines of git plumbing in
   `drive.py` (`record_story`, `push_with_rebase`, `replay_onto_remote`, `_merged_tree`, `untrack_private`,
   `record_private`, `_private_commit`), and `record_refusal` refuses to record unless the root is the top of a git
   checkout.

The private repository is the same mixture: tracked `runs/` (held-out detail, 394 MB) and `gradings/` (27 MB) beside
git-ignored `state/` holding the lake (17 GB), the warehouse and analytics (2 GB), recordings, judging and keys.

Everything downstream reads the data from git rather than from where it was produced: the warehouse ingest
(`ingest/inputs.rs` `GitSource`: `git fetch`, `ls-tree`, `cat-file` on `origin/main`), the benchmarker
(`server/sources.ts`), the monitor (`ops/monitor/monitor.py` `git show origin/main:`), and the gallery (a working
copy, pulled every minute since commit `c7dd88f3f`, which this design makes redundant). The collector already pulls
the record files into the lake "so the lake is a complete second copy" (`collect.rs:115`), yet the ingest still takes
them from git.

Costs already paid, from `CLAUDE.md`: fourteen story records unpushed for twenty hours (A-044); a `git reset --hard`
on a live bench checkout; a history rewrite; the standing rule "never reset a bench checkout". Each exists only
because data lives in a working tree.

## Decisions

1. **Three things, kept apart by location.** Systems live in repositories and arrive on a machine pinned and
   read-only. Operational data lives under a **data root** that is never inside any repository. Publication is a
   separate, explicit, gated step that reads the data root and writes an export; by default nothing is published.
2. **The run id keeps its string, loses its meaning as a location.** A run is identified by the same string as today
   (`combinations/<family>/<version>/<variant>/<os>/<machine>/<engine>-<client>/benchmarks/<pack>/<run>` or
   `benchmarks/reference/<pack>/<stack>/<run>`), because that string is already the identity in the warehouse
   (`runs.id`, `stories.rel`), the benchmarker (`Row.dir`), the lake layout (`<store>/<node>/<run id>/`) and the
   gallery's slugs. Its grammar is already written (`ingest/mod.rs` `run_parts`, `ids.rs` `valid_run_dir`). A
   location is always `<data root>/<run id>`; nothing derives the id from where a directory sits.
3. **The harness only writes files.** No `.gitignore`, no commit, no push, no git identity on a node, no
   `record_refusal` test for a git toplevel. `publicise.is_private` keeps its classification of files, but it drives
   the export step, not git.
4. **The lake is the complete record.** The collector's allow-list grows to every file the harness writes except the
   `workspace/` tree (rebuildable from `workspace.bundle`) and the live control files. Held-out detail is included:
   the lake is private by location. Every reader reads the lake: ingest, benchmarker, gallery, monitor.
5. **Anything a job needs from another run is delivered to it as an input**, not found by the node in a shared tree.
   A `known_good`/`from_run` reference, and the baselines the live progress estimate reads, are copied into the job's
   input directory by dbench from the lake. A node knows only its own runs.
6. **The refactor follows delete-first**, with MECE test coverage proved before any code is removed (the method is
   in "Refactoring method" below). It is the owner's method and the repository's standing rule.
7. **The public repository's history is a separate decision** (open point 2). Removing the data from the tree does
   not remove it from the clone.

## Architecture

```
SYSTEMS (repositories; pinned, read-only on a machine)
  public repo        harness, dbench, benchmarker, gallery, specs, combination definitions,
                     pack public parts (bench.json, scope), docs, tests          -> release dir (no .git) on nodes
  private repo       packs/<name>/acceptance, GRADING.md, scope, JUDGING.md     -> checkout at the pack tag on nodes

OPERATIONAL DATA (one data root per machine; never a repository)
  node   $BENCH_DATA/runs/<run id>/                 the run directory the harness writes
         $BENCH_DATA/jobs/<job>/inputs/            what dbench delivers for this job (reference run, baselines)
  host   $BENCH_DATA/lake/<node>/<run id>/         byte-exact copies + collection.json
         $BENCH_DATA/warehouse/conversations.db
         $BENCH_DATA/analytics/analytics.db
         $BENCH_DATA/recordings/ judging/ annotate/ keys/ recording-secret/   (today: private state/)
         $BENCH_DATA/gradings/<package>/{package, results/<judge>/}           (today: private gradings/)
         $BENCH_DATA/exports/<date>/               publication staging, written only by the export step

FLOW
  harness ──writes──> $BENCH_DATA/runs/<id>  ──dbench node API──> collector ──> lake ──> ingest ──> warehouse ──> analytics
                                                                                   │
                                                              benchmarker, gallery, monitor read the lake (and dbench status)
                                                                                   │
                                                              export (gated: leak check, redaction, summaries) ──> exports/
```

What stays in git: code, definitions, specs, the suite. What leaves git: every file under a run directory, the private
`runs/` and `gradings/`, and the git-ignored `state/`.

## A. Identity: one grammar, four languages

A `RunId` module in each language, with the same grammar and the same golden tests (as the ingest's parser goldens are
shared with the harness today):

- parse: `combinations/<family>/<version>/<variant>/<os>/<machine>/<engine>-<client>/benchmarks/<pack>/<run>` and
  `benchmarks/reference/<pack>/<stack>/<run>`; anything else is not a run id;
- parts: family, version, variant, os, machine, engine, client, pack, stack, run; `kind` is combination or reference;
- derived names: the long name (`work_dir_name`: parts joined by `__`), the work id (`work_id`: sha256 prefix), the
  gallery slug, the story run id `<id>/stories/<NN>`;
- the existing rename rule (`-opencode/` to `-pi/`, `ingest/inputs.rs:26`) lives here and nowhere else.

Homes: `tools/bench-ids` (a small crate in the tools workspace, used by dbench and the gallery; `ids.rs` moves into
it), `benchmarks/spec-bench/harness/run_id.py` (replacing the copies in `drive.py:268-302`, `logscan.py:614-623`,
`judge.py:67-70`, `annotate.py:74-78`, `finalize_pending.py:125-131`, `progress.py:243-247`),
`tools/benchmarker/shared/runId.ts` (replacing `domain.ts:219-256` `RUN_RE`/`findRuns` path logic and
`conversation.ts:40`), and `ops/monitor/monitor.py:493-495`.

Location is always `data_root / id`. The only functions that join the two are `run_dir(data_root, id)` and
`id_of(data_root, path)`; `relative_to(REPO_ROOT)` disappears from the harness.

## B. Node side

**roots.py.** The results root becomes the data root: `SPEC_BENCH_RESULTS_ROOT` keeps its name (dbench already sets
it, `harness.rs:36`), but it must not be a git checkout and must not be inside one; the harness exits if it is. The
code root is the release directory as today. `off_limits` and `NO_RECORD_ENV` go: there is nothing to record into.

**drive.py.** Deleted outright: `RUN_GITIGNORE`, `_rebase_in_progress`, `record_refusal`, `record_story`,
`push_with_rebase`, `replay_onto_remote`, `_merged_tree`, `untrack_private`, `refuse`, `record_private`,
`_private_commit`, `EMPTY_TREE`, `COMMIT_TRAILER`, the `--record` flag and its callers (`drive.py:2437-2458`,
`record_event.py`, `finalize.py:545-563`, `finalize_pending.py`, `run.sh`, `run-series.sh`, dbench `job.rs:269`).
Kept, because they produce data, not commits: `make_publishable` (home-path redaction and raw-log compaction become
part of the export step, see F), `heldout.make_public` (the counts-only summaries are still written beside the private
results, since the benchmarker reads them), `credentials` redaction (applied at export, where it is a publication
concern, and at write time for anything the agent could have printed into a record; decide in the plan which files).
The `summary.md` link to `EVALUATION-POLICY.md` (`history.py:369`) becomes an absolute URL into the public repo.

**Workspace git (W in the inventory)** is untouched: `setup_workspace`, `restore_spec`, `begin_progress_file`,
`story_finished`, `bundle()` operate on the agent's own repository, which is the artifact under review. Git is
intrinsic there and stays.

**Cross-run inputs (decision 5).** `known_good_base` (`drive.py:855`), `progress.baselines` (`progress.py:218`),
`logscan.known_runs`, and dbench's `reference_run_problem`/`harness_args` (`job.rs:211-261`) read other runs from the
results root. After: dbench copies the referenced run's `workspace.bundle`, `metrics.json` and `run.json`, and a
`baselines.json` it computes from the lake, into `$BENCH_DATA/jobs/<job>/inputs/`, and passes that directory to the
harness. The harness reads baselines from the file and never scans for other runs.

**dbench node (`server.rs`, `progress.rs`, `collect.rs`, `runner.rs`).** `cfg.repo` splits into `cfg.release` (the
code root, as today) and `cfg.data_root`. `list_runs`, `is_run_dir`, `rel_of`, `resolve_run_dir`, `run_dir`,
`job_run_rel` resolve against the data root. `git_pull` is deleted; system inputs arrive with the release
(`harness.rs` `materialise` already archives paths from a commit; the archived set grows to include
`combinations/**/{config.sh,profiles.tsv,help.txt}`, `benchmarks/<pack>/bench.json`, scope, and
`benchmarks/reference/*/stack.env`, so a node needs no checkout of the public repository at all). `setup-node.sh`
drops its "records are pushed here" and "git identity" checks and keeps the private pack clone at its tag.

**The collector allow-list (decision 4).** `COLLECTABLE` grows from 13 entries to the full record: add
`finalize.json`, `summary.md`, `server-health.json`, `workspace.bundle`, `workspace-git-log.txt`, `run-history.jsonl`,
`rescore/<version>/**`, `stories/<n>/{prompt.md, accept.json, accept-summary.json, accept-report.json,
accept-final.json, heldout-detail.json, summary-detail.md, agent-events.compact.jsonl.gz}`, `stories/<n>/artifacts/**`,
`stories/<n>/screenshots/**`, `audit.jsonl`, `AUDIT.md`, `publish-refused.json` (if still written), `superseded/**`,
`base/**`. Explicitly not collected: `workspace/` (from the bundle), `control/`, `current_story`, `work_dir.txt`. A test
holds the two lists MECE against every file name the harness can write (every `Path(...)` the harness writes under a
run dir appears in exactly one list; new names fail the build until classified). The `wanted()` rule that skips
reference-model runs stays as the owner's standing decision; it is a filter on the lake, not a reason to keep git.

## C. Host side

**Ingest.** `Published` gains a `LakeSource` that reads the record files from `<lake>/<node>/<run id>/`; `GitSource`
is deleted; `TreeSource` stays for tests only if `LakeSource` cannot serve them (it reads a plain tree, so it should).
`cmd_ingest --repo` and `--rev` go; `[collect] repo` in `nodes.toml` goes. `archived_runs` reads an `archived.json`
marker in the lake (the benchmarker already recognises one, `domain.ts:230`), written by an explicit
`dbench archive <run id>`. The digest keyed by git blob ids (`inputs.rs:358-406`) is keyed by the lake file's length
and mtime, which `collection.json` already records.

**Benchmarker.** `sources.ts` loses every `git` call: `loadRuns` lists the lake (`<lake>/*/<run id>/run.json`) and
reads the same files from it; `bench.json` `pack_ref` comes from the release's copy on the host (the benchmarker runs
beside the collector, which has the release); `loadFlowCounts` reads test counts from the private pack checkout at
the tag, or from a `flow-counts.json` the harness writes into each run (preferred: then the private repo is not
needed by the host at all). `src.web` and the GitHub links (`LinksCell.tsx:10`) go: the data is not on GitHub.
`main.ts --repo` becomes `--data-root`.

**Gallery.** `runs::discover`, `load`, `run_or_private`, `scope_size`, `judges`, `private_repo`, `private_version` read
the lake and `$BENCH_DATA/gradings`; `sync.rs` (added 10 Oct 2026) is deleted with its tests. Recordings, judging,
keys and the recording secret move from the private `state/` to the data root; the gallery's `--repo` becomes
`--data-root` plus `--pack-dir` for the scope files.

**Monitor.** `collect_repo` (`monitor.py:498-522`) reads the lake, not `origin/main`. `triage.py`'s commit of
`ops/anomaly-tracking.md` is a document in the systems repository and keeps using git; it stops importing
`drive.push_with_rebase` and uses plain `git push`.

**Backup.** `ops/backup` already backs up a `state` path; it points at `$BENCH_DATA` instead. `RESTORE.md` loses "and
the public repository": a rebuild of the warehouse needs only the lake.

## D. Held-out detail, audits and judges

Held-out results stay in the run directory and are collected into the lake (decision 4). `heldout.find` reads the
run dir, else the lake; `copy_private`, `private_copy`, `repo_of`, `record_private` go. The leak fingerprints
(`publicise.fingerprints`, which reads held-out titles from the private pack's git tags) remain, used by the export
gate.

Judges: `grading_package.py` writes the package into `$BENCH_DATA/gradings/<package>/`; `judge-setup.sh` fetches it
from the host over the dbench API (a new read-only endpoint under `/v1/gradings`, allow-listed by package name) or
from a path the owner gives; `judge-submit.sh` writes results to `$BENCH_DATA/gradings/<package>/results/<judge>/`
on the host (locally, or over ssh with `rsync`; open point 4). `judge_collect.py` reads that directory. No git worktree,
no push.

## E. The two repositories after the change

**Public.** Contains only systems: `benchmarks/spec-bench`, `benchmarks/<pack>/{bench.json, scope, spec, docs}`,
`combinations/**/{config.sh, profiles.tsv, help.txt, README}`, `benchmarks/reference/<stack>/{stack.env, README.md}`,
`tools/`, `lib/`, `docs/`, `tests/`, `ops/` (scripts and the anomaly log). Every `combinations/**/benchmarks/<pack>/<run>/`
and `benchmarks/reference/<pack>/<stack>/<run>/` directory leaves the tree. `tests/privacy-test.sh` and
`publicise.over_limit`, which scan tracked files for leaked records, stay as a guard that none come back; the
real-log replay check (`checks.toml:60-72`, `test_replay_real_logs.py`) runs against a fixture set kept in the lake
or a small committed fixture corpus, not against the records in the code root.

**Private.** Contains only private systems: `packs/<name>/{acceptance, GRADING.md, scope}`, `JUDGING.md`, and the
owner's written analysis if they want it there. `runs/`, `gradings/`, `archive/` and `state/` move to the data root.

## F. Publication (new, gated, off by default)

`dbench export <run id>...` (or a harness script; name in the plan) reads the lake and the warehouse, applies the rules
that `record_story` applies today in the same order (held-out detail removed and summarised, credentials redacted,
held-out titles refused, home paths rewritten, size limits), and writes `$BENCH_DATA/exports/<date>/<run id>/`.
Where an export goes afterwards (a separate public dataset repository, a static site, nothing) is the owner's choice
each time; the design gives it no default target. `benchmarks/docs/insights` and the guide, which cite figures, are
documents and stay in the public repository; they quote numbers, not records.

## Refactoring method

The owner's method, applied to this change. The "touched set" is every function the inventory names in classes A, B,
C and E (`docs/dataflow.md` and the sweep behind this design list them by file and line); W is excluded on purpose.

1. **Enumerate the use cases, MECE.** Fourteen, by actor:
   U1 the harness records a story; U2 the node serves run files; U3 the collector fills the lake; U4 the ingest fills
   the warehouse and analytics; U5 the benchmarker shows state; U6 the gallery reviews builds; U7 the monitor reads
   records; U8 a judge package goes out and results come back; U9 a job references another run (known-good,
   baselines); U10 finalize and rescore write the score of record; U11 export; U12 backup and restore; U13 node setup;
   U14 the release gate. Each existing test in the touched set is assigned to exactly one use case; a test that fits
   none is listed and either assigned or retired with a reason.
2. **Prove 100% line and branch coverage of the touched set, per language, on the code as it is.** Python:
   `--cov` widened from `drive` alone (`checks.toml:48-58`) to `drive roots heldout publicise packdir progress
   finalize finalize_pending logscan record_event judge judge_collect grading_package annotate history import_run`.
   Rust: `cargo llvm-cov` over `tools/dbench` (`collect`, `collector`, `ingest/inputs`, `ingest/mod`, `progress`,
   `server`, `job`, `runner`, `harness`, `release`, `node`) and `tools/vidi-gallery` (`runs`, `sync`, `main`'s
   rescan). TypeScript: vitest coverage over `server/sources.ts`, `server/domain.ts`, `server/main.ts`,
   `shared/conversation.ts`. Shell: `bats` or the repository's own `tests/*.sh` style for `setup-node.sh`,
   `judge-setup.sh`, `judge-submit.sh`, which have no tests today. For each use case, a test matrix whose dimensions
   are written down first (U1's: run kind {combination, reference}; story outcome {done, partial, stopped, failed};
   private files {present, absent}; credential {present, absent}; held-out title {present, absent}; size {under,
   over}; results root {set and valid, unset, a git checkout, inside one}; run position {inside root, outside}) and
   whose cells each have one test. Missing cells are written against the current code until the matrix is full and
   coverage is 100%. The suite is green at the end of this step.
3. **Delete first.** Every function in the touched set is replaced by a stub that raises (`NotImplementedError`,
   `todo!()`, `throw`). The whole suite runs. **Every test assigned to a use case must fail.** A test that passes
   proved nothing about the code it claims to cover: the deletion is reverted, that test is rewritten (it must assert
   what the function produces, not that it exists or was called), step 2 is repeated, and the deletion is tried again.
   Tests outside the touched set are expected to pass and are the complement that makes the partition MECE.
4. **Write the new contracts as tests, red.** The data-root resolution, `RunId` goldens in four languages, the
   extended allow-list and its MECE file-name test, `LakeSource`, the lake-reading benchmarker, gallery and monitor,
   the job inputs directory, the export step. Each old test ends in exactly one state: kept unchanged, rewritten to the
   new contract, or retired together with a deleted function; the mapping is a table in the plan.
5. **Reimplement until green**, in the order of the cutover below, each component running beside its old version
   until the comparison in "Verification" holds.

## Ordered sequence

0. Nothing moves while a story is running on the machine concerned; each node is switched between runs.
1. **Host data root.** Stop the collector; move the private `state/` to `$BENCH_DATA` (lake, warehouse, analytics,
   recordings, judging, keys, backups); update `nodes.toml`, the backup config and the service files; restart; confirm
   the next nightly backup reports both repositories ok.
2. **Identity module** in four languages with shared goldens; every consumer switched to it (no behaviour change
   yet).
3. **Collector allow-list extended** (B) and the MECE file-name test; let it run until every run in the lake is
   complete under the new list. From here the lake holds everything git holds.
4. **Readers on the lake**, each on a private port beside the git-based one: `LakeSource` ingest into a copy of the
   warehouse; benchmarker; gallery; monitor. Compare (Verification). Swap each over once equal; delete its git path.
5. **Nodes**, one at a time between runs: release with the record path deleted and `data_root` config; move the
   node's run directories from the checkout to `$BENCH_DATA/runs/` (a move, not a copy; the lake already has them);
   watch the first story of the next run to its record in the lake.
6. **Repositories.** Remove the run directories from the public tree in one commit; move `runs/`, `gradings/`,
   `archive/` out of the private repository; then the history decision (open point 2).
7. **Export step** (F), last, since nothing depends on it.
8. **Guide and docs.** `benchmarks/docs/guide` (entities: data root, lake as record; flows 1 and 2 change; the
   publication flow is new), `docs/dataflow.md`, `ops/RUNBOOK-lake-warehouse.md`, `ops/backup/RESTORE.md`,
   `tools/*/README.md`, `CLAUDE.md` ("Never reset a bench checkout" and "Harness auto-pushes main" become history).

## Verification

- **Lake completeness:** for every run in the public repository at step 3, every tracked file under the run directory
  has a byte-identical copy in the lake (`git ls-files` against the store, hash by hash). Zero differences before any
  reader switches.
- **Readers:** old and new benchmarker `/api/state` equal for every run (ignoring `web` links); old and new warehouse
  equal in row counts per table per story and in `stories.rel`; old and new gallery build lists equal; the monitor's
  faults feed equal.
- **Identity:** the four `RunId` implementations agree on the golden set, which includes every run id present today
  and the OpenCode rename cases.
- **Node:** after step 5 a run's directory sits under `$BENCH_DATA/runs/`, `run.json` records the same id string as
  before, the collector marks it complete, and `git -C <old checkout> status` shows nothing new for the rest of the
  series.
- **Repository:** `tests/privacy-test.sh` passes with zero run directories tracked; a fresh clone of the public
  repository is under 50 MB.

## Open points for the owner

1. **The data root path.** Proposed `~/bench-data` on every machine (node and host), configured once in dbench's
   `nodes.toml` and the backup config. Needs a decision.
2. **Public history.** The records are in every clone's history back to 24 September. Options: (a) rewrite history
   with `git filter-repo` to drop the run directories and force-push, after step 5 when no node depends on the
   checkout (this is the one force-push the design asks for, and every clone re-clones); (b) start a fresh public
   repository holding only systems and make the current one private; (c) leave history as it is, in which case the
   data remains published. The design assumes (a) or (b); (c) does not meet the goal. Needs a decision.
3. **The private repository's contents.** Proposed: suite, grading and scope only. The owner's written analyses
   (`analysis/`, `audits/`, `forensics/`) are documents and could stay; `runs/`, `gradings/`, `archive/`, `state/`
   move. Needs a decision.
4. **How judge results come back.** Proposed `rsync` over ssh into `$BENCH_DATA/gradings/` on the host, by a
   script that replaces `judge-submit.sh`. The alternative is a write endpoint on the host's dbench, which the
   least-privilege rule argues against. Needs a decision.
5. **Reference-model runs in the lake.** Today the collector refuses to pull them (owner, 3 Oct 2026). Under this
   design the lake is the only copy once the public tree is cleaned, so either the rule is lifted for the record files
   (keeping the exclusion of raw transcripts) or the Opus and Sonnet records are archived elsewhere before step 6.
   Needs a decision.
6. **Export target.** None proposed; each export is a separate opt-in. Confirm that is the intent.

## What this design does not change

The harness's story loop, the agent sandbox, the held-out scoring, the evaluation policy, the warehouse schema and
conversation API, the harness release mechanism (code still ships as a tagged, materialised release), and git inside
the agent's workspace.
