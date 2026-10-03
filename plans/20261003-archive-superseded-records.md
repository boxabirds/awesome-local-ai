# Archiving superseded benchmark records

Plan, 3 October 2026, at the owner's instruction: "archiving means ensuring they're not in our data lake or dbs, and we can
keep the raw files but in an archive file, compressed, stored using gitlfs. Not ready to throw them away just yet."
Then, on LFS costing bandwidth on a public repository: "don't store it. gitignore it. It'll sit around locally for a few
months and if it goes it goes." And, on the v1 runs: "then yes we axe all the v1 stuff".

**Done on 4 October 2026** (owner: "go"). 26 runs archived: the 24 `vidi-v1` runs (the two marked invalid included) and the
2 unversioned MTPLX runs. Each archive (`archive/<run path with / as __>.tar.zst`, 298 MB in all, 18,919 files) holds the
run directory as it was on disk (`record/`, untracked re-scores included) and every node's lake copy (`lake/<node>/`),
and each was restored into scratch and compared entry by entry (path, type, size, sha256) before anything was removed.
`archive/MANIFEST.json` lists them. The `todoodle` runs and every `vidi-v2` run are untouched.

## What is actually there

Measured from the app's own state and the files on disk, 3 October 2026:

| Pack | Family | Runs | Size | What it is |
|---|---|---|---|---|
| vidi | vidi-v2 | 29 | 384 MB | **current.** Not touched. |
| vidi | vidi-v1 | 22 | 447 MB | built against spec v1, scored by the v1 held-out suite (v1.2 to v1.3.2) |
| vidi | unversioned | 2 | 52 MB | MTPLX `canvas-pi-01` and `pi-smoke`, both status `unknown`, no pack version recorded |
| todoodle | unversioned | 2 | 19 MB | **a different pack, not superseded.** Opus reference runs, one failed and one stopped |

So "the old stuff" is not one bucket, and two of the four groups must be treated differently from the rest.

## What is archived, and what is not

**Archived (26 runs: the 22 shown in the app, the 2 hidden as invalid, and 2 unversioned):**

- **The 22 `vidi-v1` runs.** Built against spec v1 and scored by the v1 held-out suite. Every analysis has to remember to
  exclude them, which is the risk the owner named. What they can still say is kept below, in "What v1 says against v2".
- **The 2 unversioned MTPLX runs** (`canvas-pi-01`, `pi-smoke`). Status `unknown`, no pack version, so nothing can place
  them against any suite. One is a smoke run.

**Not archived:**

- **Every `vidi-v2` run**, including the 19 story runs whose thinking text is incomplete. Those are current results; what is
  missing is only the text an analysis would read, and the analytics layer already excludes them by `think_complete`. They
  are not obsolete, and marking them so would be false.
- **The 2 `todoodle` runs.** A different pack, and the pack the owner intends to run next. Two runs of it already exist, one
  failed and one stopped. Archiving them would delete the only evidence of how that pack behaved. They stay.

## What archiving does, in three parts

**1. Out of the databases.** The warehouse (`conversations.db`) and the analytics file are derived and rebuildable, so this
needs no deletion logic of its own: the ingest learns to skip an archived run, and a rebuild then leaves it out. The same
mechanism the reference models already use (`purge_reference`) is extended, or generalised to "archived", so a run that is
archived after it was ingested is removed on the next pass.

**2. Out of the lake.** `<private>/state/collected/<node>/<run path>/` holds the raw pulls for runs the collector reached.
The collector stops pulling an archived run, and its collected directory is deleted after the archive file is made and
verified. The lake is a copy of what the nodes had, and the archive file is the keeping copy.

**3. The archive file.** One compressed file per run, under `archive/`, holding the run's whole directory as it stands
(`tar` plus `zstd`), named after the run's path so it can be found without an index, with a plain-text manifest beside it
listing each archive's size, sha256 and date. **Not stored anywhere: `archive/` is in `.gitignore`**, and the files sit on
this laptop until they are lost. That is acceptable because the records are in git history: removing them in a commit
takes them out of the working tree, not out of history, and `git show <commit>:<path>` brings any file back.

**Restoring** is `zstd -d` and `tar -x` back to the original path, then a re-ingest. Nothing in the archive depends on code
that could rot.

## What v1 says against v2, kept here before the runs go

Checked from the suite files themselves (private repo, `packs/vidi/acceptance`), 3 October 2026:

- **The same 75 held-out tests, with the same titles**, in v1.3.2 and v2.0-pre2. The v2.0-pre2 change only made the suite
  ask for what spec v2 asks for: the buttons spec v2 calls "New board" (the v1 suite clicked "Create a board"), and
  locators that failed correct apps (rendered text, how a resize handle's position is spelled, text size XL, visible
  elements only). The behaviours tested did not change.
- So a v1 score and a v2 score count the same behaviours. What differs is everything else: the spec the agent was given
  (the change the owner wants measured), the sandbox (v1 ran in the allow-everything one, and the containment scan found
  two v1 runs that read other runs' work), and the harness and engine versions.

Finished 75-test runs of the combinations that ran both, scores of record or, where none, the run's own whole-suite
figure:

| Combination | v1 | v2 (vidi-v2.0-pre2) |
|---|---|---|
| reference/opus-5.5 | 71 (status unknown), 74 | 74, 75, 75 |
| qwen 3.8 Flash-Next, gufo | 60, 65, 68 | 58, 64, 66, 66, 68, 68 |

The spec change moved neither measurably: Opus by one to three tests at the ceiling, gufo not at all (median 65 against
66). Other combinations changed engine, model or quantisation between v1 and v2, so their v1 figures say nothing about
the spec.

## How a run is known to be archived

A marker beside the record, not a path move: `archived.json` in the run's directory, holding `{archived_at, reason,
archive_file, sha256}`. Reasons for this shape rather than moving the directory:

- The directory can then be emptied of everything but the marker, so the record's place in the tree still shows what ran,
  while its bulk is gone.
- Git history is untouched; nothing is rewritten.
- The benchmarker, the ingest and the collector each read one file to decide, and an archived run disappears from the app
  the way an invalid one does (`The app shows results, never its own faults`).
- It is reversible by deleting one file and restoring the tarball.

## Sequence

1. **This plan approved** (done: "then yes we axe all the v1 stuff").
2. **The marker and the readers**: `archived.json`, the benchmarker leaving archived runs out, the ingest skipping and
   purging them, the collector not pulling them. Tests first, as for the reference exclusion.
3. **The archive files** for the 26 runs, with the manifest and the checksums, verified by restoring every one into a
   scratch directory and comparing it entry by entry (the comparison was first seen to catch a one-bit change).
4. **Then, and only then**, the records' bulk is removed and the lake's copies deleted.
5. A note in the guide, since what the app shows changes.

## Settled

- The v1 reference runs (Opus `run-2`, `run-3`) are archived with the rest: the reference has three v2 runs.
- No git-lfs and no private copy: `archive/` is gitignored and local.
- The app's Version selector shows v1 today; after this it has only v2. The table above is what remains of v1.
- Nothing about the 19 v2 story runs with incomplete thinking text; they stay, and the `think_complete` filter stays the
  way analysis avoids them.
