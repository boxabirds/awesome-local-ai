# Archiving superseded benchmark records

Plan, 3 October 2026, at the owner's instruction: "archiving means ensuring they're not in our data lake or dbs, and we can
keep the raw files but in an archive file, compressed, stored using gitlfs. Not ready to throw them away just yet."

Nothing here has been done. The repository is public and these are published records, so every step below waits for the
owner's approval.

## What is actually there

Measured from the app's own state and the files on disk, 3 October 2026:

| Pack | Family | Runs | Size | What it is |
|---|---|---|---|---|
| vidi | vidi-v2 | 29 | 384 MB | **current.** Not touched. |
| vidi | vidi-v1 | 22 | 447 MB | the superseded suite: different stories, not comparable with v2 |
| vidi | unversioned | 2 | 52 MB | MTPLX `canvas-pi-01` and `pi-smoke`, both status `unknown`, no pack version recorded |
| todoodle | unversioned | 2 | 19 MB | **a different pack, not superseded.** Opus reference runs, one failed and one stopped |

So "the old stuff" is not one bucket, and two of the four groups must be treated differently from the rest.

## What is archived, and what is not

**Archived (24 runs, about 499 MB):**

- **The 22 `vidi-v1` runs.** The v1 suite built other stories and scored them with another held-out suite. Their results are
  valid results *of that suite* and are kept, but they cannot be set against anything current, and every analysis has to
  remember to exclude them. That is the risk the owner named.
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
(`tar` plus `zstd`, since the repository already uses `.zst` elsewhere), named after the run's path so it can be found
without an index, with a small plain-text manifest beside it listing what each archive holds, its size, its sha256 and the
date. Tracked by git-lfs: `.gitattributes` gains `archive/** filter=lfs diff=lfs merge=lfs -text`. The repository has
git-lfs 3.5.1 available but no `.gitattributes` today, so this is the first use of it here and needs the owner's say: LFS
objects on a public GitHub repository count against a quota the owner owns.

**Restoring** is `zstd -d` and `tar -x` back to the original path, then a re-ingest. Nothing in the archive depends on code
that could rot.

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

1. **This plan approved**, and the git-lfs question answered.
2. **The marker and the readers**: `archived.json`, the benchmarker leaving archived runs out, the ingest skipping and
   purging them, the collector not pulling them. Tests first, as for the reference exclusion.
3. **The archive files** for the 24 runs, with the manifest and the checksums, verified by restoring one at random into a
   scratch directory and comparing it byte for byte.
4. **Then, and only then**, the records' bulk is removed and the lake's copies deleted.
5. A note in the guide, since what the app shows changes.

## What this does not settle

- Whether the owner wants the v1 **reference** runs archived too (Opus `run-2`, `run-3` on vidi-v1): they are part of the 22.
- Whether `archive/` belongs in this public repository at all, or in the private one beside the lake. The owner said
  git-lfs, which implies here, but 499 MB of LFS objects on a public repository is a cost worth naming before it is paid.
- Nothing about the 19 v2 story runs with incomplete thinking text; they stay, and the `think_complete` filter stays the
  way analysis avoids them.
