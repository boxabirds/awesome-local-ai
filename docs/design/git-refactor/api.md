# The data API: one set of calls for every place that touches git today

Status: draft for the owner's review, 16 Oct 2026. Nothing here is built or approved. It is the answer to: "design an API
abstraction that satisfies the needs of every single call site, and show how things work now and how the new API addresses
the same thing."

Sources: the touched set of the story 19 audit (`ops/refactor/touched_set.toml`, 112 sites in 46 files; the rule for a member
is in `ops/refactor/README.md`), four read-only surveys that opened the code at every site (kept in the session scratchpad,
not committed), `docs/designs/operational-data-separation.md` (the approved design, cited as "design D1 to D14" where it
numbers its decisions), and `tools/bench-lake/CANONICAL.md` (the contract of the read command that already exists).

## 1. In plain words

Every one of the 112 places does one of a few jobs. Today each does it by looking at a git checkout: a folder tree where the
folder path *is* the run's name, plus git commands that read it, commit to it or push it. After the migration there is no
checkout on a node and nothing pushed. The same jobs still have to be done, so they need a stable set of calls to do them
with.

The surveys sorted the 112 sites by the job each one performs. The jobs come to **twelve operations**, in five families, and
**a thirteenth heading for what disappears** (the commit-and-push chain) and **a fourteenth for what correctly stays on git**
(source code, the agent's own workspace, the pack repository). Counts per operation are in section 6.5, taken from the table in
section 6.

| Family | Operation | Job |
|---|---|---|
| Identity and place | 1 `Id` | the one grammar of a run's name, and every name derived from it |
| | 2 `Root` | where this node's runs live, and finding them there |
| Reading the lake (host side) | 3 `List` | which runs exist, with the facts a listing needs |
| | 4 `Read` | one file, or many, of runs, with the fallbacks callers use |
| | 5 `Log` | a story's event log as bytes, and which stories have one |
| | 6 `Changes` | what changed since last time, and a cheap identity per file |
| | 7 `Archive` | which runs are archived, and archiving one |
| | 8 `Workspace` | a working copy of a run's code at a story |
| Handing things to a job | 9 `Inputs` | another run's code and records, baselines, the fleet's run list, put in the job's own folder |
| Moving things between parties | 10 `Gradings` | judge packages out, judge results back |
| | 11 `Export` | the rules about what may leave the owner's machine, applied to a copy |
| Configuration | 12 `Paths` | where packs, the private pack repository, the release and the policy live |

Eight of the twelve are reads or naming. Three (`Inputs`, `Gradings`, `Export`) are not reads at all: they were hidden inside
git because git was the only thing that moved files between parties. One (`Paths`) is configuration, not data.

How the owner's guess of "six to twelve things" came out: twelve, if the configuration heading and the three non-read ones
are counted. If only the operations that read run data are counted, eight.

## 2. Language and shape

The policy of 16 Oct 2026 applies: new code is Rust, Python callers run the Rust command and read its JSON, and there is never
a second implementation. So:

- One Rust crate holds all twelve as a library. dbench (Rust) and the gallery (Rust) call the library. The existing crate
  `tools/bench-lake` is the natural home: it already has the lake reader and its contract (`CANONICAL.md`), 159 tests and a
  fixture. The name `bench-lake` is then a little narrow (`Id`, `Root` and `Inputs` also run on nodes). Whether to rename it is
  left open (section 9, item 14); nothing here depends on it.
- One command `bench-lake` exposes each operation as a subcommand with canonical JSON on standard output, in the form
  `CANONICAL.md` already fixes: `status` is `found`, `absent` or `refused`, absences carry a code, exit 0 for a value or an
  absence and 2 for a refusal or a malformed question. The existing seven questions keep their form and their tests.
- Existing Python (the harness, the monitor) calls the command. The benchmarker (TypeScript) calls the command as a child
  process, with a batch mode (operation 4) so it is one process for thousands of files, as `git cat-file --batch` is today.
- Shell scripts call the command.

## 3. Rules that cut across the operations

These came out of the surveys as requirements that several sites share. Each is stated once here and referred to below.

**R1. A run's id is its name and does not change.** The id strings of today (`combinations/<...>/benchmarks/<pack>/<run>`
and `benchmarks/reference/<pack>/<stack>/<run>`) are the warehouse keys. The API reproduces them byte for byte.

**R2. Id and place are two different things.** For a combination run the place on a node is `<data root>/<id>`. For a
reference run the id begins `benchmarks/reference/` but the place in the lake is `reference/<pack>/<stack>/<run>`, as
`CANONICAL.md` already shows. So the API never says "place = root + id" as a rule; it has `place(root, id)` and `id_of(root,
path)` as a pair of functions that are each other's inverse and are tested as such. The design's decision D2 ("a location is
always `<data root>/<run id>`") is wrong for reference runs as written and needs that one-line amendment.

**R3. Absent is a normal answer.** A missing file, a missing run and an unreadable file are different answers (`CANONICAL.md`
codes), none of them an exception. Callers that today fold them together (`git_json` returns null for both) may fold them;
the API does not.

**R4. No revision, so say how to read safely.** Git gave every reader one consistent snapshot. A lake read gives "latest of
each file", and the collector copies files one at a time. The API therefore (a) never returns a file that is mid-transfer
(dot-files are already hidden), (b) lets a caller ask for a set of files of one run in one call, and the call re-checks
length and modification time after reading and marks the set `unstable` if anything moved (the caller reads again), and (c)
exposes `complete` and `settled_at` (already built) for callers that need a finished run. This costs one extra stat per file.

**R5. One rule for which copy of a run.** A run id can exist under several node folders. The API has exactly one ranking,
`preferred` (already built, `CANONICAL.md` section 4). Every operation that takes a run takes an id (meaning preferred) or
`<node>@<id>`. No caller invents its own rule.

**R6. Nothing returns an absolute path unless asked.** Answers carry labels (`collected/<node>/<id>`). Callers that must open
a file themselves (gzip logs in Python, `node` reading a log) use `path` mode (operation 4), which returns the absolute path
of one file and is documented as read-only, valid only for the moment of the call.

## 4. The twelve operations

Each is given as: what it does, its calls, what it replaces, and the requirements it must meet. "Now" describes the git-era
behaviour it replaces; the sites are in section 6.

### 1. `Id`: the one grammar

**Now.** Five separate copies of the grammar of a run's name exist and they disagree:
`collector::is_run_path` (needs 5 or more segments, `benchmarks` third from the end), `ingest::run_parts` (needs `benchmarks`
at index 4 or later and exactly three segments after it), `collect::walk_combinations` (searches 8 levels for a `config.sh`),
the lake reader (exactly nine levels), and in other languages `domain.ts RUN_RE`, `monitor.run_dir_of`, the gallery's folder
walk and `annotate.stack_of`. Names derived from the id are also copied: `drive.work_dir_name`, `judge.work_dir_name`,
`logscan._run_name`, `finalize_pending.pack_of`, the `-opencode/` to `-pi/` rename rule, and `rel.parts[1:-3]` for labels.
Reference runs are recognised in four places by the text `benchmarks/reference/`.

**New.** One pure module, no I/O:

| Call | Returns |
|---|---|
| `parse(id)` | kind (`combination` or `reference`) and parts: family, version, variant, os, machine, engine, client, pack, stack, run; or a refusal naming the rule broken |
| `format(parts)` | the id |
| `stack(id)` | the combination part (`qwen/3.8/.../mtplx-pi`) or `reference/<stack>`; what `annotate.stack_of` and the baselines label need |
| `pack(id)` | the pack |
| `long_name(id)` | the work-directory name; reproduces `drive.work_dir_name` exactly (combination: path below `combinations/` joined with `__`; reference: the whole id joined with `__`; see below) |
| `work_id(long_name)` | the hashed work-directory id |
| `renamed(id)` | the `-opencode/` to `-pi/` rule, in one place |
| `story_ref(id, n)` | the attempt id used by the annotator (`<id>#<nn>`) |

`long_name` has a surprising asymmetry that must be kept: combination names drop the leading `combinations/` and reference
names keep `benchmarks/reference/`. Changing it would orphan every existing `~/.w/<id>` work directory and break
`fetch-work.sh`. It is pinned by a golden test over every id in the lake.

The grammar is the one the lake reader already enforces (nine levels for combinations; the part rule of 1 to 64 characters of
`[A-Za-z0-9._-]`). The looser collector rule is retired; ids it accepts and the lake reader refuses are listed by a one-time
check before the switch (section 9, item 8).

**Command.** `bench-lake id parse <id>`, `id long-name <id>`, `id work-id <id>`, `id stack <id>`. Shell and Python call these.

### 2. `Root`: where this node's runs live

**Now.** A node's runs are folders inside the git checkout (`REPO_ROOT`/`RESULTS_ROOT`). The location is found by joining
the checkout to a path built from the job (`progress::run_dir`, `resolve_run_dir`, `run.sh RUN_DIR`). The listing finds runs
by looking for the git-tracked definition file `config.sh` next to them (`walk_combinations`, `finalize_pending.run_dirs`,
`logscan.known_runs`, `annotate.run_dirs`). The id of a run is "its path minus the checkout" (`rel_of`, `job_run_rel`). The
harness refuses to run unless the root is a checkout (`roots.results_root` falls back to the code root).

**New.**

| Call | Does |
|---|---|
| `resolve()` | the data root from the configuration (the `data_root` key of `Paths`); an existing directory, never guessed, never a git checkout or inside one (exit with the reason); a release with no setting stops, and the error names the setting; the failure is reported at call time, not at import |
| `place(root, id)` | the run's folder (R2). Refuses `..`, a leading `/` and symbolic links that leave the root |
| `id_of(root, path)` | the inverse; refuses a path outside the root or with an invalid part (the two behaviours callers have today are an error in one place and "use the folder name" in another; the API refuses and the caller decides) |
| `exists(root, id)` | present when `run.json` is a file; the two error classes the node server needs stay distinct: `bad id` and `no such run here` |
| `list_local(root, include_reference, require_marker)` | this node's own runs: ids and folders, in id order. Walks by the id grammar to a fixed depth and never enters a run folder. `require_marker` is true for dbench (needs `run.json`) and false for the finalize sweep (any folder at run depth) |
| `for_job(root, job_spec, install_env)` | the id and folder of a job's own run from the job and its install settings (the combination), as `resolve_run_dir` does; an error if the install is gone, which the server answers as 409 |

A node reads its own running folder directly (live files such as `progress.json`, `current_story`, `control/`, and the
files nothing collects: `work_dir.txt`, raw event logs). `Root` gives the folder; the caller opens the file. These are not
lake reads and never go through `Read`.

**Command.** `bench-lake root resolve`, `root place <id>`, `root id-of <path>`, `root list [--reference]`.

### 3. `List`: which runs exist (host side)

**Now.** The benchmarker lists every file under the run roots with `git ls-tree -r origin/main` and works out the runs from
the paths (`findRuns`). The gallery walks the checkout and treats a folder as a run if it holds `metrics.json` and a
`workspace/` folder (`discover`), repeating the whole walk on every request. The ingest lists the published tree twice and
the lake once (`candidates`). The annotator globs for `metrics.json`. Each applies its own filters.

**New.** The existing `runs` question, extended, not replaced:

`bench-lake <lake> runs [--pack P] [--kind combination|reference] [--facts]`

With `--facts` each run also carries, read from names only (no file content): `has_run_json`, `archived`, `has_bundle`,
`rescore_versions` and for each version the highest re-scored story, and `complete` (`CANONICAL.md` `complete`). The listing
is by the nine-level walk, never into a run folder, so it costs a directory read per level and not a file per file. The
existing `rejected` list stays (it is what tells the owner a folder is wrong).

Fields that need file content (`known_good` in `metrics.json`) are not facts; they come from `Read` (operation 4). The
annotator and the baselines builder read them in one batch. This keeps `List` cheap.

Selecting the copy: a listing returns one row per copy (as today). `--preferred` returns one row per id, the preferred copy
(R5). The benchmarker and gallery use `--preferred`.

### 4. `Read`: files of runs

**Now.** `git show origin/main:<path>` (monitor), `git cat-file --batch` with a path list (benchmarker, thousands per minute),
`git cat-file blob` per file (ingest), plain `open()` in the checkout (everything else). Callers use fallbacks the library
has to know: held-out detail from the run folder else the private repository (`heldout.find`), `accept-summary.json` else
`accept.json`, `accept-final` else the run's `accept.json` else the last story's, and the public summary where the full
result is absent (`accept_or_summary`).

**New.**

| Call | Does |
|---|---|
| `read(run, name, args)` | one record: today's `record` question. Extended record names below |
| `read_best(run, kind, args)` | the fallback chains by name, so no caller reimplements them: `accept` (full, else summary), `final-accept` (`accept-final`, else run-level `accept`, else the last story's), `rescore-accept` (summary, else full) |
| `read_many([(run, name, args)...])` | batch: partial results (missing omitted, each with its own absence code), one process, R4 check on the set. The benchmarker's whole refresh is one call |
| `path(run, name, args)` | R6: the absolute path of one file, for callers that must open it themselves |
| `read_set(run, [names])` | the files of one run read together, with the R4 stability mark |

Record names to add to the existing twelve, from the sites (each is a file some caller already reads):
`interventions` (`interventions.md`), `audit` (`audit.jsonl`), `summary` (`summary.md`), `per-story` (`rescore/V/per-story.md`),
`heldout-detail` (`heldout-detail.json`), `accept-full` (the private `accept.json` of a story), `accept-final`,
`workspace-git-log` (`workspace-git-log.txt`), and the existence flags `bundle` and `archived`. `agent-reports/` is not
settled (section 9, item 9).

Held-out files and public summaries live in the same run folder in the lake (the lake is private by location, D4), so the
"run folder else private repository" fallback of `heldout.find` disappears. Readers that must stay public-only (the
benchmarker shows counts, not detail) name the summary record explicitly; nothing is hidden by a fallback.

`pack` and `scope` files (`bench.json`, `scope/<name>.json`) are not run records; they come through `Paths` (operation 12).

### 5. `Log`: a story's event log

**Now.** The ingest and the token counter need the decoded bytes of `agent-events.compact.jsonl.gz` (or the raw log),
from git or the checkout. The existing `bench-lake log` returns only length, line count and SHA-256, never the bytes, so it
cannot serve them. The ingest also needs to know *which* stories have a log and in which form. A log still being appended to
ends mid-line.

**New.**

| Call | Does |
|---|---|
| `log_info(run, story)` | what exists today |
| `log_bytes(run, story, to=stdout\|file, complete_lines=true)` | the decoded stream, raw preferred, compact otherwise, with `form` reported; `complete_lines` drops a trailing partial line for a run that is not complete |
| `stories(run)` | the story numbers present with the form of log each has |

`log_bytes --to FILE` is also what `tools/tensorfold-check` needs to hand a path to `node` (R6 for logs).

### 6. `Changes`: what is new, and a cheap identity per file

**Now.** The ingest decides whether a story's inputs changed with a digest built from git blob ids (`GitSource::ids`: lists
every file of every run in the tree, hundreds of thousands of entries). The monitor asks "which runs changed between the
last head and this one" with `git diff --name-only`. The annotator's cache key is `path:mtime_ns` of every held-out file.

**New.**

| Call | Does |
|---|---|
| `manifest(run)` | every file of the run with length and modification time (the data `collection.json` already records), plus SHA-256 on request |
| `digest(run, parts)` | one stable identity over named parts (records, the story's log), for "did the inputs change" |
| `changed(since)` | the runs whose files changed since an opaque cursor the caller keeps, and the new cursor. With no cursor it returns only the cursor and reports nothing as news. The same cursor gives nothing. A failed read of the source is a refusal, distinct from "nothing changed" |

The digest changes when a file is rewritten even with identical bytes (a re-pull): the ingest then repeats work and writes the
same data. That is the one cost of dropping the content hash (design section C). Whether modification time survives the collector's
copy is not verified (section 9, item 10); if it does not, `digest` uses length and SHA-256 and costs a read.

### 7. `Archive`: archived runs

**Now.** `git ls-tree -r` over two roots to find files called `archived.json` (the collector at the start of every pass, the
ingest again). The collector must know the answer before it pulls so an archived run is never pulled again.

**New.** `archived()` returns every archived id (reference runs included) in one call that reads names only, from a marker
in the lake; `archive(id)` and `unarchive(id)` write or remove the marker as an explicit act (design section C). The marker
lives in the lake only; it must be read before a pull, so it is read from the host's lake, not from the node.

### 8. `Workspace`: a working copy of a run's code

**Now.** The gallery clones the run's `workspace.bundle` from the checkout (`story_checkout`) and also opens the run's
`workspace/` folder in place (`api_open`); the judge copies `record/workspace`; the grading package archives a workspace
folder the operator names. The lake does not hold `workspace/` (it is rebuildable from the bundle).

**New.** The existing `workspace <run> <story> <dest>` question, plus `workspace <run> final <dest>`, which uses the commit the
final score was taken on (`metrics.json` `scored_commit`, with the "refuse if the snapshot is not the scored commit" check the
judge has today). Error codes map to the callers' own messages (no recorded commit, no bundle, commit not in bundle,
destination not empty). The git operations on the working copy are the agent's own repository and stay git (section 8).

### 9. `Inputs`: things handed to a job

**Now.** Three different mechanisms, all reading other runs' files from the shared checkout:

- A partial rerun starts from another run's code: `--from-run` is a path `results_root/<id>` (`job::harness_args`), checked
  by `reference_run_problem`, read by `known_good_base`, recorded in `metrics.json` as a path relative to the root.
- The live estimate scans every other run's `metrics.json` and `accept.json` at every story end (`progress.baselines`).
- The containment scan lists every run in the fleet (`logscan.known_runs`).

**New.** Before the job starts, dbench (on the host, from the lake) builds a folder
`<data root>/jobs/<job>/inputs/` and hands the harness that folder (design D5; dbench tasks 4.39 and 4.40):

| File | Holds |
|---|---|
| `known-good/workspace.bundle`, `known-good/metrics.json`, `known-good/run.json` | the referenced run, only when the job is a partial rerun |
| `baselines.json` | per story, for every other run: status, gate green, agent minutes, calls, output tokens, held-out counts with the "void if scored without a working browser" rule already applied |
| `known-runs.json` | every run id in the fleet, for the containment scan (section 9, item 5) |

The harness is told `--inputs DIR` and reads files; it never scans a tree and never looks for another run. `metrics.json`
records `known_good.from_run` as a run **id**, not a path. The completeness check `reference_run_problem` becomes the
`inputs prepare` command's check: the run is complete and holds the bundle and the metrics, or the job is not started and the
reason says what is missing. The path-escape check is no longer needed because a node no longer turns an id into a path in a
shared tree.

Cost and a changed behaviour, both to be accepted knowingly: the bundle is copied to the node (size not measured here), and
`baselines.json` is frozen at job start, so a run that finishes on another node mid-job does not enter this job's estimate.

### 10. `Gradings`: judge packages and results

**Now.** The private repository carries the packages: `judge-setup.sh` runs `git archive` of `gradings/<name>` from
`origin/main`; `judge-submit.sh` copies results into a temporary git worktree, commits and pushes; `judge_collect.py` reads
results with `git ls-tree` and `git show`. A repeated judge label is refused. Release-pinning (`--ref`) exists.

**New.** Three calls over the dbench HTTP API on the host, with the lake as the store (design: `GET /v1/gradings/<package>/package`):

| Call | Does |
|---|---|
| `gradings_get(package, dest)` | the package folder, whole or nothing (checks `GRADING.md` after), "no such package" a distinct answer |
| `gradings_put(package, judge, files)` | the four result files and an optional transcript as one unit; only the known names; all or nothing |
| `gradings_results(package, judge)` | the file list and contents of one result set; "no such result set" distinct |

The design says a repeated judge label is *versioned* beside the first; the code today *refuses* it. This is a behaviour
difference the owner must settle (section 9, item 4). `--ref` has no equivalent and goes.

### 11. `Export`: what may leave

**Now.** `record_story` is one function doing five jobs after every story: it rewrites the node's own files in place
(redacts home paths and credentials, compacts and deletes raw event logs, splits `metrics.json` into a public part and
`heldout-detail.json`), checks the staged bytes for private paths, held-out test titles and local machine names, refuses
(writing `publish-refused.json`) on a problem, commits, and pushes. It also writes `credentials_redacted` and `pushed` into
`metrics.json`, which the benchmarker and the monitor read.

**New, split in two on purpose.**

1. **Story-end file preparation stays in the harness as plain steps, without git**: `make_public` (the public summaries and
   the held-out split), `make_publishable` (home-path redaction, log compaction, size cuts) and credential redaction run on the
   node's own files at the end of a story, exactly as now, and `credentials_redacted` is still written to `metrics.json`. This
   keeps the lake and its backups free of credentials and keeps the benchmarker's field. It is a recommendation, not a
   given: the alternative (redact only at export) leaves unredacted credentials in the lake (section 9, item 2).
2. **`export(id, to)` is the gate, on a copy.** It reads the run from the lake, copies the files that may leave into `to`, and
   checks the bytes it wrote: private classification of each path by (id, relative path), the held-out title scan, local
   machine names (the node list is host data), size limits, and the rule that a run whose agent had no sandbox is never
   exported. A problem refuses and writes `publish-refused.json`. It fails closed on an unreadable file. It never writes to
   the lake.

`private_files`, `redact_staged`, `staged_problems` and `record_refusal` map here; their git index and staged-blob reads become
reads of the copy being written.

### 12. `Paths`: where things are

**Now.** Locations are derived from where the checkout is: the private pack repository is "beside the results root"
(`packdir.private_checkout`, `heldout.private_repo`, `vidi-gallery main::private_repo` and `runs::private_of`, the
benchmarker's `--private` default); a pack's public part is `<results root>/benchmarks/<pack>`; `bench.json`, `stack.env`,
`config.sh` and `install-stack.sh` are read from the checkout (`setup-node.sh`, `run.sh`, tensorfold); the policy link is a
relative path computed from folder depth (`history.policy_link`); the GitHub base and branch are read from git
(`main.ts`).

**New.** One table, resolved once (design decision D13), each key with one owner:

| Key | Meaning | Replaces |
|---|---|---|
| `data_root` | a node's runs | the results-root checkout |
| `lake`, `reference` | the host's two roots | `--repo`, `--store` |
| `release_dir` | the harness release, which also carries the system files | the checkout |
| `pack_public(name)` | a pack's public parts (`bench.json`, scope, stories), from the release | `<results root>/benchmarks/<pack>` |
| `pack_private(name)` | the private pack at its tag | "beside the results root" |
| `private_repo` | the private pack repository | `private_checkout()` |
| `policy_url` | an absolute link to the evaluation policy | the relative `policy_link` |
| `state_dir(app)` | an app's own writable state (`annotate/`, `gallery/`, keys) | folders inside the private repository |

The design says there is one `paths` table (D13, `~/.config/awesome-local-ai/paths.toml`) but does not list its keys, so these
nine are a proposal for them, not a correction of an existing list. `state_dir` is the one the design does not obviously
cover: the annotator and gallery need it for the labels, reviews and recordings that live in the private repository today
(section 9, item 12).

## 5. What is not in the twelve

**Deleted: no replacement call.** The commit-and-push chain. When nodes stop writing git the following have nothing to do:
`push_with_rebase`, `replay_onto_remote`, `_merged_tree`, `_rebase_in_progress`, `_private_commit`, `record_private`,
`untrack_private`, the closure `run` inside `replay_onto_remote`, `finalize.rec`, `heldout.copy_private`, `heldout.repo_of`,
`publicise.lake_only_lines`, `record_event.record` and its shell wrapper, `GitSource::fetch` and `git`, `runner::git_pull`,
`sync_repo`, `sources.ts::git`, the GitHub links in `LinksCell` and `LeadScore`, `combination_label` (only commit messages
used it), and `judge.work_dir_name` (no caller). The count is in section 6.

Two of these leave gaps that must be filled before they are deleted, because something reads what they wrote:

- `run-status.json` (started, finished, failed, stopped) is written *only* by `record_event.py`, *only* with `--record`.
  Deleting that script leaves nothing writing it. The status file must be written by a plain function in the harness,
  always, with no commit.
- The monitor's `record-not-pushed` flag reads `pushed` from `metrics.json`; the benchmarker reads
  `record.credentials_redacted`. The first loses its meaning (nothing pushes) and becomes "a run's last collection is old",
  which `complete` and `collected_at` can answer; the second stays, written by the story-end preparation (operation 11, part 1).

**Stays on git, correctly.** These ask a git question about source code, the pack repository or the agent's own work:
the source half of `corpus::build` and `corpus::tracked` (the token counter's source files), `machine_names.tracked` and
`publicise.over_limit` (checks on the systems repository), `roots.harness_commit` and the release-tag selection inside
`run_one` (the harness's own code), the monitor's commit and harness-import watch (`collect_repo` parts a and b) and the
triage agent's `git log` and `git diff`, `setup_workspace_from` and `ensure_bundle` (the agent's workspace, class W), the
`setup-node.sh` clone of the private pack at its tag, and `publicise.fingerprints` (held-out titles from the pack's tags).
The monitor's `triage.commit_and_push` pushes a *document* and needs a plain `git push`, not `push_with_rebase`.

## 6. Every site: how it works now, and what it becomes

Op column: `ID` `ROOT` `LIST` `READ` `LOG` `CHG` `ARCH` `WS` `INP` `GRD` `EXP` `PATH` are the twelve; `DEL` is deleted;
`GIT` stays on git. The first code is the primary one; a second is shown when a site needs both. Site numbers are for
reference in this document only. `<m>` means the module-level constants and head of the file.

### 6.1 dbench and the token counter (35 sites)

| # | Site | How it works now | Becomes | Op |
|---|---|---|---|---|
| 1 | token-counter `corpus.rs::build` | `git ls-files` of the whole repo, then picks source files and the committed compact logs | log half: `List` runs + `Log.log_bytes`; source half unchanged | LOG, GIT |
| 2 | `corpus.rs::tracked` | `git ls-files -z` | source half only | GIT |
| 3 | token-counter `main.rs` `<m>` | held-out story named as a path prefix; `--repo` | story named as (id, number); `--lake` beside `--repo` | ID |
| 4 | dbench `analytics::purge_references` | deletes rows whose `rel` contains the text `benchmarks/reference/` | deleted if reference runs load as designed (D11), else `Id.kind` | DEL |
| 5 | `collect.rs::is_run_dir` | stat `run.json` under the checkout | `Root.exists` | ROOT |
| 6 | `collect::list_runs` | walks `combinations/` for `config.sh`, plus `install.env` `RUN_BASE` | `Root.list_local` | ROOT |
| 7 | `collect::rel_of` | path minus checkout = id | `Root.id_of` | ROOT |
| 8 | `collect::runs_under` | lists pack and run folders under a `benchmarks/` | folded into `Root.list_local` | ROOT |
| 9 | `collect::walk_combinations` | recursive search for `config.sh`, depth 8 | folded into `Root.list_local` (grammar, not `config.sh`) | ROOT |
| 10 | `collector.rs` `<m>` | local constants that define what a run path is | `Id` | ID |
| 11 | `collector::archived_runs` | `git ls-tree` of origin/main for `archived.json` | `Archive.archived` read before the pull | ARCH |
| 12 | `collector::classes_for` | reference run decided by the id's text prefix | `Id.kind` | ID |
| 13 | `collector::is_run_path` | validates a reported path | `Id.parse` | ID |
| 14 | `collector::pass` | pulls from nodes, then reads origin/main (after a fetch) for ingest | pull unchanged; ingest reads the lake; `repo`, `worktree`, fetch cadence go; ingest no longer gated on `--repo` | LIST, DEL |
| 15 | `ingest/db.rs` `<m>` | reference prefixes pasted into SQL | `Id.kind`; `purge_reference` deleted with item 4 | ID, DEL |
| 16 | `ingest/inputs.rs` `<m>` | published roots, archive roots, the rename rule, the `Published` trait over git or a tree | roots from `List`; rename from `Id.renamed`; the trait is replaced by the lake reader | LIST |
| 17 | `inputs::archived` (trait + git + tree) | `git ls-tree -r` over two roots | `Archive.archived` | ARCH |
| 18 | `inputs::candidates` | every story with a compact log in the published tree plus every raw log in the lake | `Log.stories` over `List`; `Id.renamed` | LOG |
| 19 | `inputs::fetch` | `git fetch` so the ingest reads current records | deleted: the lake is current by construction | DEL |
| 20 | `inputs::git` | runs `git -C repo ...` | deleted with its callers | DEL |
| 21 | `inputs::ids` | `git ls-tree` of every file, blob id as the content identity | `Changes.manifest` / `digest` | CHG |
| 22 | `inputs::read` | `git cat-file blob` per file | `Read.read` / `read_many` | READ |
| 23 | `inputs::under_published_root` | filters the lake by text prefix to leave reference runs out | `Id.kind`; whether to include reference is a flag of the reader (D11) | ID |
| 24 | `ingest/mod.rs::cmd_ingest` | `--repo`, `--rev`, `--worktree`, `--no-fetch` choose a git source | `--lake` only; `--rev` is lost (no caller found that passes it) | LIST |
| 25 | `ingest::run_parts` | parses an id into its parts | `Id.parse` | ID |
| 26 | `job.rs::harness_args` | `--from-run <checkout>/<id>`; `--record` | `--inputs <dir>`; `--record` deleted | INP, DEL |
| 27 | `job::reference_run_problem` | stats the referenced run's bundle and metrics on this node | `Inputs` prepare check on the lake | INP |
| 28 | `progress.rs` `<m>` | `combinations`, `config.sh`, `benchmarks` as layout of a checkout | placement uses go to `Root`; the definition lookup stays | ROOT |
| 29 | `progress::resolve_run_dir` | `<repo>/<RUN_BASE or combinations/...>/<run id>` from `install.env` | `Root.for_job` | ROOT |
| 30 | `progress::run_dir` | `<repo>/combinations/<c>/benchmarks/<pack>/<run id>` | `Root.place` | ROOT |
| 31 | `runner::git_pull` | `git pull --ff-only` before each job | deleted: system inputs arrive with the release | DEL |
| 32 | `runner::run_one` | five git points: pull, reference check, release-tag choice, argv, and the checkout as cwd and results root | results root = data root; inputs from `Inputs`; pull deleted; release-tag choice stays | ROOT, INP, DEL, GIT |
| 33 | `server.rs::job_run_rel` | id = job's run folder minus checkout | `Root.for_job` | ROOT |
| 34 | `server::manifest_of` | `checkout.join(run)` to list files | `Root.place` | ROOT |
| 35 | `server::named_run` | validates an id and stats `run.json` | `Root.exists` with its two error classes | ROOT |

### 6.2 The harness record path (33 sites)

| # | Site | How it works now | Becomes | Op |
|---|---|---|---|---|
| 36 | `drive::_merged_tree` | three-way merge so concurrent pushes can land | deleted | DEL |
| 37 | `drive::_private_commit` | builds a commit in the private repo with the held-out files | deleted: the lake holds them | DEL |
| 38 | `drive::_rebase_in_progress` | detects a half-finished rebase in the checkout | deleted | DEL |
| 39 | `drive::combination_label` | path minus the checkout, for commit messages only | deleted (any other use takes `Id.stack`) | DEL |
| 40 | `drive::main` | run dir given as a checkout path; `work_dir_for(run)`; `from_run` and baselines by scanning; per-story record | run dir from `Root`; inputs from `Inputs`; `known_good.from_run` stored as an id; record block deleted; workspace git stays | ROOT, INP, DEL |
| 41 | `drive::push_with_rebase` | push, and replay on top if the remote moved | deleted; its one document caller (triage) uses plain `git push` | DEL |
| 42 | `drive::record_private` | copies and pushes held-out files to the private repo after every story | deleted: collector copies them | DEL |
| 43 | `drive::record_refusal` | whether the run may be recorded: root rules, no sandbox, git top-level | git parts deleted; the no-sandbox rule moves to `Export` | EXP, DEL |
| 44 | `drive::record_story` | rewrites files, checks, commits, pushes, writes metrics fields | split: file preparation stays without git (section 4, op 11 part 1); the gate is `Export`; commit and push deleted | EXP, DEL |
| 45 | `drive::replay_onto_remote` | re-creates commits on top of a moved remote | deleted | DEL |
| 46 | `drive::run` (closure in 45) | runs `git <args>` in the checkout | deleted with 45 | DEL |
| 47 | `drive::setup_workspace_from` | clones the reference run's bundle into the agent's workspace | unchanged; the bundle path now points into the job's inputs folder | GIT |
| 48 | `drive::untrack_private` | removes private files from the index | deleted | DEL |
| 49 | `drive::work_dir_name` | long name of a run from its checkout path | `Id.long_name`, byte-exact | ID |
| 50 | `finalize::ensure_bundle` | `git bundle create` from the agent's workspace | unchanged (agent's own repository) | GIT |
| 51 | `finalize::rec` | calls `record_story` after a finalize | deleted; `finalize`'s `record` parameter goes | DEL |
| 52 | `finalize_pending::default_root` | the results root, failing at import | `Root.resolve`, failing at call time | ROOT |
| 53 | `finalize_pending::pack_of` | pack from `run.json`, else from folder depth | `Id.pack` (`run.json` read locally) | ID |
| 54 | `finalize_pending::run_dirs` | walks the checkout for run folders | `Root.list_local` (no marker); the sweep still reads node-local files directly | ROOT |
| 55 | `grading_package::main` | output under the private repo; refuses a key not git-ignored; inputs named as paths | output and key under `state_dir`/`Paths`; the ignore test goes; run inputs via `Workspace` and `Read`; `git archive` of the working copy stays | PATH, WS |
| 56 | `heldout::copy_private` | copies held-out files into the private repo's tree | deleted | DEL |
| 57 | `heldout::private_copy` | the path where the private repo keeps a run's held-out files | deleted as a fallback; held-out reads are `Read` / `path` | READ |
| 58 | `heldout::private_files` | which of a run's files are private | the classifier of `Export` | EXP |
| 59 | `heldout::private_repo` | `$ENV` or "beside the results root" | `Paths.private_repo` | PATH |
| 60 | `heldout::redact_staged` | credential redaction of staged files | the redaction of op 11 (both parts) | EXP |
| 61 | `heldout::repo_of` | walks parents for `.git` to make the repo-relative path | deleted: identity is the id | DEL |
| 62 | `heldout::staged_problems` | checks staged bytes for private paths, held-out titles, machine names | `Export` check on the copy | EXP |
| 63 | `import_run::main` | `drive.REPO_ROOT / run_dir`, `work_dir_for` | `Root.place`, `Id.long_name` (where a reference run is created, node or host, is open) | ROOT |
| 64 | `packdir::part` | pack part from the pack, else the private checkout beside the root | `Paths.pack_public` / `pack_private` | PATH |
| 65 | `packdir::private_checkout` | `REPO_ROOT.parent / <private repo>` | `Paths.private_repo` | PATH |
| 66 | `packdir::resolve` | env var, else private pack, else `<results root>/benchmarks/<pack>` | `Paths` (public part from the release) | PATH |
| 67 | `publicise::lake_only_lines` | `.gitignore` lines for lake-only files | deleted: no git, no ignore file | DEL |
| 68 | `publicise::over_limit` | `git ls-files` of benchmark files over a size limit | unchanged, as a guard that none return; `size_limit` is shared with `Export` | GIT |

### 6.3 Harness tools and shell scripts (24 sites)

| # | Site | How it works now | Becomes | Op |
|---|---|---|---|---|
| 69 | `annotate::run_dirs` | globs the checkout for `metrics.json`, drops `known_good` | `List` (pack = vidi, preferred) + `read_many` of `metrics` | LIST |
| 70 | `annotate::stack_of` | stack label from path minus the checkout | `Id.stack` | ID |
| 71 | `annotate::build_attempt` | held-out `accept.json` with the private fallback; id from path | `Read.read_best accept`, `Log.log_bytes`, `Id.story_ref` | READ |
| 72 | `annotate::load_attempts` | lists runs; cache keyed on mtimes of local files | `List`; cache key from `Changes.digest` | LIST, CHG |
| 73 | `annotate::main` | finds the private checkout; runs under the checkout | `Paths.state_dir`, `Paths.lake`; labels' commit stays the owner's act | ROOT |
| 74 | `fetch-work.sh` | `drive.REPO_ROOT / path` to get names; rsync of the work folder | names from `Id.long_name` / `work_id`; the rsync and workspace `git log` stay | ID |
| 75 | `history::policy_link` | relative link to the checkout's copy of the policy | `Paths.policy_url` | PATH |
| 76 | `judge-setup.sh` | `git archive` of `gradings/<name>` from the private repo | `Gradings.get` | GRD |
| 77 | `judge-submit.sh` | worktree, commit, push to the private repo; refuses a repeated label | `Gradings.put` (refuse or version: open, item 4) | GRD |
| 78 | `judge::main` | run records from the checkout path; final result; the workspace folder; `git check-ignore` guard | `Read.read_best final-accept`, `Workspace final`; the guard goes with the checkout | WS, READ |
| 79 | `judge::work_dir_name` | second copy of the long-name rule; no caller outside its test | deleted with its test | DEL |
| 80 | `judge_collect::load_results` | `fetch`, `ls-tree`, `show` on the private repo | `Gradings.results` | GRD |
| 81 | `logscan::known_runs` | walks the checkout for every run in the fleet, plus this machine's work folders | `Inputs` `known-runs.json`; the work-folder part stays local | INP |
| 82 | `logscan::own_workspace_for` | `work_dir.txt` or a name from the checkout path | local read of `work_dir.txt`; fallback `Id.long_name` | ID |
| 83 | `machine_names::tracked` | `git ls-files` of the systems repo | unchanged | GIT |
| 84 | `progress::baselines` | globs and reads every other run's records at every story end | the harness reads `baselines.json` from the inputs folder | INP |
| 85 | `record_event::record` | writes `run-status.json`, then commits and pushes | the write stays as a plain function (section 5, the status gap); commit and push deleted | DEL |
| 86 | `report::summary` | combination name from folder depth; relative policy link | combination from `run.json` or `Id.stack`; `Paths.policy_url` | PATH |
| 87 | `roots.py` `<m>` | results root, `NO_RECORD_ENV`, `harness_commit` | results root from `Root.resolve`; `off_limits` deleted; `harness_commit` stays | ROOT, GIT |
| 88 | `roots::results_root` | env var or the code root | `Root.resolve`, no fallback | ROOT |
| 89 | `run.sh` (script) | `RESULTS_ROOT` from `roots.py`; `COMBO_DIR`, `config.sh`, `RUN_DIR` under it; `--from-run`; `--record` | `Root.place`; system files from the release (`Paths`); `--inputs`; `--record` deleted | ROOT, INP, PATH, DEL |
| 90 | `run.sh::record_event` | calls `record_event.py` when `--record` | deleted (the status write is not conditional on it) | DEL |
| 91 | `setup-node.sh` | reads `bench.json`, `stack.env` from the checkout; checks push access and a git identity; clones the private pack at a tag | system files from the release; the push and identity checks deleted; the pack clone stays | PATH, DEL, GIT |
| 92 | `tensorfold-check/run-checks.sh` | default log is a path inside the checkout | `Log.log_bytes --to FILE` (or `--log` as today) | LOG |

### 6.4 The readers: benchmarker, gallery, monitor (20 sites)

| # | Site | How it works now | Becomes | Op |
|---|---|---|---|---|
| 93 | `monitor::collect_repo` | fetch, `git diff` between heads, reads three records per changed run | run part: `Changes.changed` then `read_many`; commit watch and harness-import check stay on git | CHG, GIT |
| 94 | `monitor::git_json` | `git show origin/main:<path>` | `Read.read` | READ |
| 95 | `monitor::run_dir_of` | regex from a changed file path to its run | absorbed: `changed` returns ids (else `Id.parse`) | ID |
| 96 | `triage.py` `<m>` | the agent may `git fetch` and `git show origin/main:<path>` to read run records | the allow-list names one command, `bench-lake read ...`; `git log` and `git diff` stay | READ, GIT |
| 97 | `domain.ts::findRuns` | works out runs from a flat list of every path in the tree | `List --facts` | LIST |
| 98 | `main.ts` `<m>` | `--repo`, `--private`, origin URL, 60 s fetch-and-load | `--lake`, `Paths`; refresh reports success and time; `web` and `branch` deleted | PATH, DEL |
| 99 | `sources.ts` `<m>` | `REF`, `BRANCH`, run roots, record names and fallbacks | the record table and `read_best`; revision constants deleted | READ, DEL |
| 100 | `sources::git` | wrapper for every git call of the server | deleted (private-repo flow counts: section 9, item 6) | DEL |
| 101 | `sources::loadRuns` | fetch, `ls-tree`, then one `cat-file --batch` per run for about eight files each | `List --facts --preferred`, then `read_many` (one process) | LIST, READ |
| 102 | `sources::readBlobs` | `git cat-file --batch` over a path list | `Read.read_many` | READ |
| 103 | `LinksCell.tsx` | links to the run's folder on the git host | link removed | DEL |
| 104 | `RunHeader.tsx::LeadScore` | links the score to `per-story.md` on the git host | link removed; the number stays | DEL |
| 105 | gallery `main.rs::main` | `--repo` derives the private repo, the pack version family (git tag), reviews and recordings | `--lake`, `Paths`; the version family from a file, not a tag (item 11) | PATH |
| 106 | gallery `private_repo` | `repo.parent()/<private repo>` | `Paths.private_repo` | PATH |
| 107 | gallery `rescan` | `git pull`, then re-walks the checkout for new reviewable runs | `List --facts` and `complete`; pull deleted | LIST, DEL |
| 108 | gallery `story_checkout` | clones the run's bundle from the checkout | `Workspace` | WS |
| 109 | gallery `runs.rs::discover` | walks the checkout; a run needs `metrics.json` and `workspace/` | `List --facts` (`has_bundle`); `workspace/` is not needed | LIST |
| 110 | gallery `runs::private_of` | second copy of the private repo rule | `Paths.private_repo` | PATH |
| 111 | gallery `run_or_private` | reads a run file, else the private repo's copy | `Read.read` (one folder in the lake) | READ |
| 112 | gallery `sync.rs::sync_repo` | `git pull --ff-only` | deleted with its tests | DEL |

### 6.5 Counts

Counted from the Op column of section 6 (first code of each row = the primary one):

| Operation | Sites whose main job it is | Further sites that also need it |
|---|---|---|
| 1 `Id` | 13 | 0 |
| 2 `Root` | 20 | 0 |
| 3 `List` | 9 | 0 |
| 4 `Read` | 8 | 2 |
| 5 `Log` | 3 | 0 |
| 6 `Changes` | 2 | 1 |
| 7 `Archive` | 2 | 0 |
| 8 `Workspace` | 2 | 1 |
| 9 `Inputs` | 4 | 3 |
| 10 `Gradings` | 3 | 0 |
| 11 `Export` | 5 | 0 |
| 12 `Paths` | 12 | 1 |
| Deleted (no replacement call) | 24 | 12 |
| Stays on git | 5 | 6 |
| **Total** | **112** | |

So 83 of the 112 sites have one of the twelve operations as their main job; 24 are mainly deleted; 5 mainly stay on git.
Counting every code in the Op column, 36 sites delete something and 11 keep some git (a site such as `run_one` or
`setup-node.sh` does both). `Id` and `Root` together are 33 sites: the largest single finding is that a third of the work is
naming and finding runs, not reading them.

## 7. Traceability: the cross-cutting requirements the surveys found

Every requirement a survey listed that is more than a per-site detail, and where this design meets it.

| Requirement | Met by |
|---|---|
| A run's id is unchanged and is the warehouse key | R1; `Id` golden test over every id in the lake |
| Reference runs: id is not place | R2; `place` / `id_of` |
| Several copies of one run; one rule | R5; only `preferred` |
| Bounded, cheap listing of thousands of runs; never walk into a run | `List` (nine-level walk); `Root.list_local` |
| A change identity per file | `Changes.manifest` / `digest` |
| Absent is not an error; unreadable is not absent | R3; existing codes |
| No snapshot: partial copy, mixed moments | R4; `read_set`; `complete` |
| Fallback chains (summary else full; final else last) | `read_best` |
| Decoded log bytes, form reported, complete lines | `Log.log_bytes` |
| "Which stories have a log, which form" | `Log.stories` |
| Archived marker read before a pull; explicit set | `Archive` |
| A working copy at a story and at the final score | `Workspace` |
| Another run's inputs without a shared tree; a clear failure if absent | `Inputs` |
| Baselines at job start, held-out rule applied on the host | `Inputs.baselines.json` |
| Fleet run list for the containment scan | `Inputs.known-runs.json` |
| Reads work offline; the lake is local to the host | all reads are local file reads |
| Allow-listable single command for an agent | `bench-lake read` (least privilege) |
| Multi-file batch with no process per file | `read_many` |
| Node-local files are read directly, not through the lake | `Root` gives the folder only |
| Data root is never a checkout and is never guessed | `Root.resolve` |
| Gate rules apply to the bytes written, fail closed | `Export` checks its own copy |
| No-sandbox runs are never exported | `Export` |
| Gradings in and out as units | `Gradings` |
| Locations come from configuration, not from the checkout's neighbours | `Paths` |
| Pack independence (no pack named in code) | `List --pack`; `Paths.pack_*` |
| Held-out detail and public summaries in one run folder | `Read` record table; no fallback to a second place |
| The status file survives the loss of `record_event` | section 5, first gap |

## 8. How this lines up with what is already built and approved

- The existing `bench-lake` crate gives, unchanged, seven questions (`runs`, `copies`, `preferred`, `record`, `log` as
  information only, `workspace`, `complete`) and `compare-git`. The rest is new: `Id`, `Root`, `read_many`, `read_best`, `path`,
  `log_bytes`, `stories`, `Changes`, `Archive`, `Inputs`, `Gradings`, `Export`, `Paths`, the extended record table, and
  `List --facts/--pack/--kind/--preferred`.
- Approved design pieces this relies on: D2 (the id keeps its string; location from id, amended here for reference runs), D3
  (the harness only writes files; `is_private` drives the export), D4 (the lake is the complete record, private by
  location), D5 (dbench delivers inputs; dbench tasks 4.39 and 4.40), D8 (the harness and dbench refuse a data root inside a
  checkout), D10 (gradings through an API), D11 (reference runs load into the warehouse), D12 (nothing published by default),
  D13 (one `paths` table), D14 (nothing named for one pack), and section C of the design (length and modification time as the
  change identity).
- Where this *differs* from the approved design and so needs the owner's decision: R2 (one line in D2); the proposed `Paths` keys
  (the design lists none); gradings versioning (item 4 below); redaction timing (item 2).

## 9. Open decisions and things not verified

Open, for the owner, each with a recommendation:

1. **Reference runs: where is one created?** `import_run.py` writes into a node's run folder; the design puts reference runs
   on the host. Recommendation: created on the host, in the lake's `reference/`; `import_run` runs there.
2. **Redaction timing.** Recommendation: keep redacting the node's own files at story end (op 11, part 1) and also check at
   export. The alternative leaves credentials in the lake and its backups.
3. **`pushed` and `record-not-pushed`.** Recommendation: replace with "last collection older than N minutes" from `complete`
   and `collected_at`; N chosen from the collector's cadence, not guessed.
4. **Repeated judge label: refuse (today) or version (design)?** Recommendation: version, as designed; refusal was a
   side-effect of git (a second push would collide).
5. **Containment scan on a node.** A node knows only its own runs, but the scan wants the fleet's. Recommendation:
   `known-runs.json` in the inputs folder (small list of ids). The alternative, `known_runs=None` (any run-shaped name
   counts), changes what the scan flags.
6. **Flow counts.** `loadFlowCounts` reads the private repo at a version tag; the design says the harness writes
   `flow-counts.json` into each run. Not verified that the file exists yet. If it does not, `sources::git` cannot be deleted
   for that one caller.
7. **`Harness::Unreleased`** (a node running the checkout's own harness) has no stated future once a node has no checkout.
   Recommendation: remove it; development runs need an explicit data root.
8. **Ids the looser collector rule accepts and the lake rule refuses.** A one-time check over the real lake before the
   switch; not yet run.
9. **`agent-reports/`**, read by the judge for runs built outside the harness: not in the collector's list; not settled.
10. **Does modification time survive the collector's copy?** Not verified; if not, `digest` uses SHA-256.
11. **The gallery's pack version family** comes from a git tag of the private repo today. Recommendation: from a version file
    in the pack.
12. **`state_dir`.** The annotator's labels, the gallery's reviews and recordings and the grading keys live in the private
    repository today; the design puts annotator state in the data root. Recommendation: one `state_dir(app)` key.
13. **The URL revision of the policy link** (`main` or a harness tag): a link to `main` can drift from the policy a run was
    scored under. Recommendation: the harness tag recorded in `run.json`.
14. **Name of the crate** (`bench-lake` is narrow once `Id`, `Root` and `Inputs` live in it). Not urgent.

Not verified by the surveys (they said so, and I carry it forward): the harness side of `--from-run` and `--record` beyond
the lines read; the persisted `PullRecord` readers; `provenance.at_start`; whether `bench-lake workspace` yields exactly the
commit the final score was taken on; the transfer size of a bundle; `lib/runtime/server-*.sh` as a source for the drift
check once there is no checkout (the design's release file set does not list it).

## 10. What this design does not do

It does not say how long any of this takes, and it does not fix the order of work; that is the route decision (A or B) the
owner has not yet made. It does not change any code, test or running node. Nothing in it has been built, so every "becomes"
column is a design, not a result.
