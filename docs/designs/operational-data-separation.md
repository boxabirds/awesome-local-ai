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
7. **The public repository's history is rewritten** (owner, 10 Oct 2026) to remove the run data, since removing it
   from the tree alone leaves it in every clone. One force-push, by the owner, after no machine depends on the old
   checkout; every clone is re-cloned.
8. **Everything a machine runs or produces lives in the XDG user locations** (owner, 10 Oct 2026): binaries in
   `~/.local/bin/awesome-local-ai/`, the data root at `~/.local/share/awesome-local-ai/data/`, logs in
   `~/.local/share/awesome-local-ai/logs/`, configuration in `~/.config/awesome-local-ai/` (section H). No machine
   has a checkout of the public repository for operations; the harness and dbench refuse a data root inside a git
   checkout, so the two can never fuse again by accident.
9. **The benchmarker splits into `benchmarker-engine` and `benchmarker-web`** (owner, 10 Oct 2026). The engine is
   the backend that does the data processing and owns every API; the web service is presentation only. Judges talk
   to the engine. Section G.
10. **Judge packages go out and results come back through the engine's API** (owner, 10 Oct 2026), not through a
    repository and not through a node.
11. **Reference-model runs (Opus, Sonnet) live in the data root under `reference/`** (owner, 10 Oct 2026). Their
    records are collected there; the standing exclusion of their conversations from the warehouse and analytics is
    kept (it was a decision about analysis, 3 Oct 2026, not about storage).
12. **Nothing is published by default.** An export is a gated artifact in `exports/`; putting one somewhere public is
    a separate act each time, by the owner.
13. **Roadmap: the system locations.** `/usr/local/bin`, `/var/lib/awesome-local-ai/`, `/var/log/awesome-local-ai/`
    and `/etc/awesome-local-ai/`, under a dedicated service user, come later (owner, 10 Oct 2026). To keep that move
    a configuration change and not a code change, every path in this design is read from one `paths` table in the
    configuration and nothing is hard-coded to the home directory.

## Architecture

```
SYSTEMS (repositories; pinned, read-only on a machine)
  public repo        harness, dbench, benchmarker, gallery, specs, combination definitions,
                     pack public parts (bench.json, scope), docs, tests          -> release dir (no .git) on nodes
  private repo       packs/<name>/acceptance, GRADING.md, scope, JUDGING.md     -> checkout at the pack tag on nodes

OPERATIONAL DATA (the data root: ~/.local/share/awesome-local-ai/data on every machine; never inside a repository)
  node   runs/<run id>/                     the run directory the harness writes
         jobs/<job>/inputs/                 what dbench delivers for this job (reference run, baselines)
  host   lake/<node>/<run id>/              byte-exact copies + collection.json
         reference/<pack>/<stack>/<run>/    reference-model runs (Opus, Sonnet): records, compact logs, bundles
         warehouse/conversations.db
         analytics/analytics.db
         recordings/ judging/ annotate/ keys/ recording-secret/     (today: the private repo's state/)
         gradings/<package>/{package/, results/<judge>/}           (today: the private repo's gradings/)
         exports/<date>/                    publication staging, written only by the export step

FLOW
  harness ──writes──> runs/<id> ──dbench node API──> benchmarker-engine: collect ──> lake ──> ingest ──> warehouse ──> analytics
                                                            │ owns every API: state, conversations, files, gradings, export
                                                            ├──> benchmarker-web (presentation only)
                                                            ├──> gallery (reads the data root on the same host)
                                                            ├──> monitor
                                                            ├──> judges (package download, result upload; per-judge token)
                                                            └──> export (gated: leak check, redaction, summaries) ──> exports/
```

What stays in git: code, definitions, specs, the suite. What leaves git: every file under a run directory, the private
`runs/` and `gradings/`, and the git-ignored `state/`. Below, `$BENCH_DATA` stands for the data root,
`~/.local/share/awesome-local-ai/data` (decision 8; section H has the whole machine layout).

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

**Benchmarker.** Replaced by the engine and web split in section G. What `sources.ts` does with git goes entirely;
the engine lists the lake (`lake/*/<run id>/run.json` and `reference/**/run.json`) and reads the same files from it.
`bench.json` `pack_ref` comes from the release's copy on the host; the per-story test counts (`loadFlowCounts`) come
from a `flow-counts.json` the harness writes into each run, so the host needs no private checkout. The GitHub links
(`LinksCell.tsx:10`) go: the data is not on GitHub.

**Gallery.** `runs::discover`, `load`, `run_or_private`, `scope_size`, `judges`, `private_repo`, `private_version` read
the lake and `$BENCH_DATA/gradings`; `sync.rs` (added 10 Oct 2026) is deleted with its tests. Recordings, judging,
keys and the recording secret move from the private `state/` to the data root; the gallery's `--repo` becomes
`--data-root` plus `--pack-dir` for the scope files.

**Monitor.** `collect_repo` (`monitor.py:498-522`) reads the lake, not `origin/main`. `triage.py`'s commit of
`ops/anomaly-tracking.md` is a document in the systems repository and keeps using git; it stops importing
`drive.push_with_rebase` and uses plain `git push`.

**Backup.** Section I: the backup job follows the data root and takes on two kinds of data that git used to hold.

## D. Held-out detail, audits and judges

Held-out results stay in the run directory and are collected into the lake (decision 4). `heldout.find` reads the
run dir, else the lake; `copy_private`, `private_copy`, `repo_of`, `record_private` go. The leak fingerprints
(`publicise.fingerprints`, which reads held-out titles from the private pack's git tags) remain, used by the export
gate.

Judges go through the engine (decision 10, section G): `grading_package.py` writes the package into
`gradings/<package>/package/` in the data root; a judge downloads it from `GET /v1/gradings/<package>/package` and
uploads results to `PUT /v1/gradings/<package>/results/<judge>/<file>`, each with a per-judge bearer token that is
valid for named packages only. The engine writes uploads under `gradings/<package>/results/<judge>/`, never
overwrites (a second upload of the same name is versioned beside the first), and accepts only the file names a
result consists of (`build-A.jsonl`, `build-B.jsonl`, the transcript). `judge-setup.sh` and `judge-submit.sh`
become thin clients of those two calls; `judge_collect.py` reads the directory. No git worktree, no push, no write
access to any node.

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

## G. benchmarker-engine and benchmarker-web

Today one Node process (`tools/benchmarker/server`, 3,490 lines of TypeScript) reads git, polls dbench, computes the
rows and faults (`domain.ts` 937 lines, `faults.ts` 203), proxies the conversation API, controls nodes
(`ops.ts`: add and remove machines over ssh, submit, cancel and restart jobs through the dbench CLI) and serves the
page. The collector (`dbench collect --api`) is a second backend beside it. The split (decision 9):

**`benchmarker-engine`** (Rust, `tools/benchmarker-engine`, using dbench's library). One process on the host that
owns the data root and every API:

- **collect, ingest, analyse:** what `dbench collect` does today, moved in whole;
- **state:** the rows, machines and faults that `domain.ts` and `faults.ts` compute, ported to Rust with the
  existing vitest suites (`domain.test.ts`, `faults.test.ts`, `sources.test.ts`) as goldens, as the ingest's parsers
  were ported from Python; served as `GET /v1/state` and `GET /v1/faults`;
- **conversations:** the existing `/v1/conversations/...` API, unchanged;
- **files:** `GET /v1/runs`, `GET /v1/runs/<id>/files`, `GET /v1/runs/<id>/file?path=` over the lake and
  `reference/`, allow-listed as the node API is, so the gallery and the monitor can run on another machine if ever
  needed (on the same host they may read the data root directly);
- **control:** the node actions `ops.ts` performs, as `POST /v1/machines`, `POST /v1/jobs`, `POST /v1/jobs/<id>/cancel`,
  `POST /v1/jobs/<id>/restart`;
- **gradings:** section D;
- **export:** `POST /v1/exports` runs the gated export (F) and `GET /v1/exports` lists them.

Authentication: the engine binds to the tailnet address; every call carries a bearer token; the owner's token has every
right, a judge's token has `gradings` on named packages only, and the web service has read rights only. Deny by
default; nothing is served that is not allow-listed.

**`benchmarker-web`** (`tools/benchmarker-web`, the present React page): a static bundle and a thin server that
holds the engine's address and token and forwards `/api/*` to it. No git, no dbench, no ssh, no data processing.
`shared/` (views, glossary, stats, 11,871 lines) stays with the web: it shapes the presentation of state the engine
sends. The engine's `GET /v1/state` has the exact shape of today's `/api/state`, so the page changes only its
address.

The gallery stays a separate service that reads the data root directly on the host; it is not merged into the engine.

## H. Where things live on a machine

Today a node keeps what it runs and what it produces in scattered places under the home directory, and the host's
services log into the checkout (`ops/services/install.sh`: `ops/service-state/<label>.{out,err}.log`, git-ignored).
The owner's decision (8 and 13): the XDG user locations now, the system locations on the roadmap. Every row below is
one entry in the `paths` table of the configuration, so the roadmap column is a change of that table and a move.

| What | Today | This design | Roadmap |
|---|---|---|---|
| binaries: `dbench`, `benchmarker-engine`, `benchmarker-web`, `vidi-gallery`, `anthropic-token-counter` | `~/.local/bin/dbench`; the rest run from `tools/target/release/` in the checkout | `~/.local/bin/awesome-local-ai/` | `/usr/local/bin/` |
| the data root | the checkout | `~/.local/share/awesome-local-ai/data/` | `/var/lib/awesome-local-ai/data/` |
| harness releases | `~/.dbench/releases/<tag>/` | `~/.local/share/awesome-local-ai/releases/<tag>/` | `/var/lib/awesome-local-ai/releases/` |
| installed engines and models | `~/.local/share/<install-id>/` | `~/.local/share/awesome-local-ai/installs/<install-id>/` | `/var/lib/awesome-local-ai/installs/` |
| agent work roots | `~/.w/<id>/`, linked from `~/.vidi-bench/work/<long name>` | `~/.local/share/awesome-local-ai/work/<id>/` | `/var/lib/awesome-local-ai/work/` |
| logs | `~/.dbench/dbench.log` on a node; `ops/service-state/*.log` in the host's checkout | `~/.local/share/awesome-local-ai/logs/<service>.log` | `/var/log/awesome-local-ai/` |
| configuration: nodes, backup, engine, paths | `~/.config/dbench/nodes.toml`, `~/.config/bench-backup/config.toml`, flags in the service units | `~/.config/awesome-local-ai/{nodes,backup,engine,paths}.toml` | `/etc/awesome-local-ai/` |
| secrets: node token, Claude token, restic password, recording secret, judge tokens | `~/.dbench/token`, `~/.dbench/claude-oauth-token`, `~/.config/bench-backup/password`, `state/recording-secret` | `~/.config/awesome-local-ai/secrets/` (directory 0700, files 0600) | `/etc/awesome-local-ai/secrets/`, owned by the service user |
| the public repository | `~/awesome-local-ai` on a node, `~/expts/awesome-local-ai` on the host | wherever the owner develops; no service reads it | the same |

Notes:

- `~/.local/bin/awesome-local-ai/` is a directory, so it is not on `PATH` by itself. Service units name binaries by
  full path; for a shell, one `PATH` line in the profile, which `setup-node.sh` writes.
- Logs: each service writes to standard output and error, and its unit redirects them to
  `logs/<service>.out.log` and `logs/<service>.err.log`; the harness's own per-run logs (`server.log`, `proxy.log`,
  the agent stream) are data and stay in the run directory. Rotation is the installer's job (`newsyslog` on macOS,
  `logrotate` on Linux), configured by `dbench service-unit`. For the record, the XDG specification's own place for
  logs is `~/.local/state/<app>/`; the owner chose `share/logs/` so that data and logs sit together, and the roadmap
  moves them to `/var/log` in any case.
- The agent work root today is deliberately short (`~/.w/<10 characters>`); Unix socket paths are limited to about
  104 bytes and Playwright and wrangler create sockets under it. `~/.local/share/awesome-local-ai/work/<id>/` is
  longer by 30 bytes. Whether that was the reason, and whether the longer path still fits, is checked by a test
  before the work root moves; if it does not fit, the work root alone keeps a short path and the table says so.
- On macOS the user agents (launchd) and these same paths apply; `/var/lib` on the roadmap is for the Linux nodes,
  with the macOS equivalents decided when that work is planned.

## I. Backup

`ops/backup/backup.py` today: a nightly launchd job (`com.awesome-local-ai.bench-backup`, 03:30) that stages the two
databases from `state/insights/` with SQLite's online backup, backs up `STATE_PATHS = (collected, recordings,
judging, annotate, keys, recording-secret, insights)` of the private repository's `state/` to two restic repositories,
excludes the live database files and `backups`, keeps 14 daily and 8 weekly snapshots, and writes `history.jsonl` and
`status.json` to `state/backups/`; `forecast.py` adds a capacity forecast and a staleness check that the monitor reads.
Its configuration is `~/.config/bench-backup/config.toml` with the password beside it.

What changes:

1. **`Config.state` becomes the data root** (`$BENCH_DATA`, from the `paths` table), configuration moves to
   `~/.config/awesome-local-ai/backup.toml` and the password to `~/.config/awesome-local-ai/secrets/restic-password`.
   The two restic repositories stay where they are. A test asserts that no repository path is under the data root.
2. **`STATE_PATHS` becomes the data root's directories:** `lake`, `reference`, `warehouse`, `analytics`,
   `recordings`, `judging`, `annotate`, `keys`, `gradings`, `exports`, plus `~/.config/awesome-local-ai/secrets/`
   (restic encrypts; the keys and the recording secret are in the set today). **Two of these are newly unprotected
   by the move:** the held-out detail (today the private repository's `runs/`, whose remote was its backup) and
   `gradings/`. After step 6 the restic snapshots and the node are their only copies, so both must be in the set and
   seen in a snapshot before step 6 runs (ordered sequence).
3. **`DATABASES`** are staged from `warehouse/conversations.db` and `analytics/analytics.db`; `EXCLUDES` follows
   (`warehouse/*.db*`, `analytics/*.db*`, `backups`, `backup-staging`).
4. **A MECE test over the data root:** every top-level directory present is named in exactly one of `BACKED_UP` and
   `NOT_BACKED_UP` (`backups`, `backup-staging`, and on a node `runs/` and `jobs/`, whose copy is the lake). A new
   directory fails the test until it is classified. Logs (`share/logs/`) are outside the data root and not backed up.
5. **Node data roots are not backed up**, as today: the lake is their copy. Stated in `README.md` rather than assumed.
6. **`RESTORE.md`**: the new paths; the warehouse is rebuilt from the lake alone (no public repository); how to put
   back `gradings/` and `reference/`; a restore drill (one run from the latest snapshot into a scratch directory,
   byte-compared with the lake) as a documented, repeatable step.
7. **`ops/monitor/monitor.py`** reads `status.json` from `<data root>/backups/`; `forecast.py` is unchanged but for
   the paths.

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
1. **Host layout.** Stop the collector and the services; create `~/.local/share/awesome-local-ai/{data,logs}` and
   `~/.config/awesome-local-ai/`; move the private `state/` into the data root (lake, warehouse, analytics,
   recordings, judging, annotate, keys, backups) and the secrets into `config/secrets/`; write the `paths` table;
   point `nodes.toml`, the backup configuration and the service units at it, with logs under `share/logs/`; restart;
   confirm the next nightly backup reports both repositories ok and that its snapshot lists `lake`.
2. **Identity module** in four languages with shared goldens; every consumer switched to it (no behaviour change
   yet).
3. **Collector allow-list extended** (B) and the MECE file-name test; let it run until every run in the lake is
   complete under the new list. From here the lake holds everything git holds.
4. **The engine**, on a private port beside the present benchmarker and collector: `LakeSource` ingest into a copy
   of the warehouse; state and faults ported; files, control and conversations served. Compare (Verification). Then
   `benchmarker-web` pointed at it, the old server and `dbench collect` retired. The gallery and the monitor move to
   the data root the same way, each compared before its git path is deleted.
5. **Nodes**, one at a time between runs: the binaries installed under `~/.local/bin/awesome-local-ai/`; the
   release that carries the definitions and has the record path deleted, materialised under `share/releases/`; the
   `paths` table written; the node's run directories moved from the old checkout into `share/data/runs/` (a move,
   not a copy; the lake already has them); `~/.dbench/releases`, `~/.w` and `~/.vidi-bench` migrated or retired per
   section H; the checkout removed (installs that need one use a checkout at a development path); dbench restarted as
   a unit that logs to `share/logs/`; the first story of the next run watched to its record in the lake.
6. **Repositories.** Move the reference-model records to `reference/` in the data root and `runs/` and `gradings/`
   out of the private repository into the lake and `gradings/`; **wait for one nightly backup whose snapshot lists
   `reference`, `gradings` and the held-out files** (section I, point 2); then remove every run directory from the
   public tree in one commit, remove `archive/` and `state/` from the private repository, rewrite the public history
   (decision 7) and re-clone everywhere.
7. **Gradings API and the judge clients** (D), then the **export step** (F), since nothing else depends on them.
8. **Guide and docs.** `benchmarks/docs/guide` (entities: data root, lake as record; flows 1 and 2 change; the
   publication flow is new), `docs/dataflow.md`, `ops/RUNBOOK-lake-warehouse.md`, `ops/backup/RESTORE.md`,
   `tools/*/README.md`, `CLAUDE.md` ("Never reset a bench checkout" and "Harness auto-pushes main" become history).

## Verification

- **Lake completeness:** for every run in the public repository at step 3, every tracked file under the run directory
  has a byte-identical copy in the lake (`git ls-files` against the store, hash by hash). Zero differences before any
  reader switches.
- **Readers:** the engine's `GET /v1/state` equal to the old `/api/state` for every run (ignoring `web` links) and
  its `/v1/faults` equal to the old feed; old and new warehouse equal in row counts per table per story and in
  `stories.rel`; old and new gallery build lists equal; the web page rendered from the engine equal to the page
  rendered from the old server (the existing Playwright suite, run against both).
- **Identity:** the four `RunId` implementations agree on the golden set, which includes every run id present today
  and the OpenCode rename cases.
- **Node:** after step 5 a run's directory sits under `$BENCH_DATA/runs/`, `run.json` records the same id string as
  before, the collector marks it complete, and `git -C <old checkout> status` shows nothing new for the rest of the
  series.
- **Repository:** `tests/privacy-test.sh` passes with zero run directories tracked; a fresh clone of the public
  repository is under 50 MB.
- **Backup:** after step 1 the nightly snapshot lists `lake`, `warehouse`, `analytics` and the staged databases pass
  `pragma integrity_check`; after step 6 it lists `reference` and `gradings`; the restore drill in `RESTORE.md`
  brings one run back byte-identical to the lake. The MECE test over the data root's directories passes.
- **Layout:** no service unit on any machine names a path inside a git checkout (a test over the generated units);
  the host's `ops/service-state/` is gone; every binary a unit starts is under `~/.local/bin/awesome-local-ai/`.

## Open points for the owner

Decided on 10 Oct 2026: the machine layout (XDG now, system locations on the roadmap), the history rewrite, the
engine and web split, judges through the engine's API, reference-model runs under `reference/`, and nothing
published by default (decisions 7 to 13). Two points remain.

1. **Configuration and secrets directory.** `~/.config/awesome-local-ai/` with a `secrets/` subdirectory is my
   proposal to go with the owner's binaries, data and logs locations; the owner named those three and not this one.
   Confirm, or name another.
2. **The private repository's contents.** "Scope" means `packs/vidi/scope/<name>.json`: the file that names a scope
   (for example `canvas`) and lists the stories it covers, which decides what a run must finish and what the gallery
   reviews. Proposed: the private repository keeps only the private system inputs, `packs/<name>/{acceptance,
   GRADING.md, prompts, scope, spec}` and `JUDGING.md`, plus the owner's written analyses (`analysis/`, `audits/`,
   `forensics/`, `issues/`, `plans/`) if the owner wants documents there; `runs/`, `gradings/`, `archive/` and
   `state/` move to the data root. Confirm, or say which documents move too.

## What this design does not change

The harness's story loop, the agent sandbox, the held-out scoring, the evaluation policy, the warehouse schema and
conversation API, the harness release mechanism (code still ships as a tagged, materialised release), and git inside
the agent's workspace.
