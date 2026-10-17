# dbench scope API: events, stories and runs, readable at any stage

Status: contract agreed with the owner on 17 Oct 2026. It replaces the older plan in `docs/design/git-refactor/`, which is
dropped. Nothing here touches a live node until the migration step at the end.

## Purpose

A node's `dbench` serves what a run has produced so far, in three scopes, each with an explicit statement of whether it
is final. A caller can read at any stage, so a failed or stopped run loses nothing.

| Scope | What | Final when |
|---|---|---|
| **stream** | Events as they happen: `agent` and `conditions` (one per story), `egress` (one per run) | its story (run, for `egress`) is final |
| **story** | The files a story produces: `gate.json`, `accept*.json`, `prompt.md`, `base-commit`, `artifacts/`, `screenshots/`, `pre-suite-fix/`, `scoring-N/` | the story has ended |
| **run** | The files of the whole run: `metrics.json`, `run.json`, `run-status.json`, `summary*.md`, `finalize.json`, `heldout-detail.json`, `workspace.bundle`, `rescore/`, and the others on the existing allow-list (`collect.rs`) | the run has ended |

The existing allow-list in `collect.rs` is the list of names that may be served. The scope API groups them; it adds no name.

## Routes (new, beside the old ones; the old routes are unchanged)

All are `GET`, under the existing bearer-token auth, and take `run=<run dir relative to the repo>` as `/v1/runs/files` does.

1. `GET /v1/runs/scopes?run=R` returns the listing (below).
2. `GET /v1/runs/events?run=R&stream=S[&story=NN][&after=C][&limit=N]` returns events.
3. `GET /v1/runs/scope-file?run=R&name=F[&from=O]...` returns the bytes of one listed file, with the same rules as the
   existing `/v1/runs/file` (it calls the same code: no second implementation), plus the header `x-dbench-final`.

### Listing

```
{ "run": R, "job": J|null, "run_state": "started|finished|failed|stopped|unknown", "job_state": "...",
  "final": bool,                       // the run scope
  "files": [ {"name","size","mtime","final"} ],           // run scope files that exist now
  "streams": [ {"stream":"egress","final":bool,"first_ts":x|null,"last_ts":x|null} ],   // run-level streams
  "stories": [ { "n": 1, "state": "not_started|running|done|partial|failed|skipped", "final": bool,
                 "files": [ {"name","size","mtime","final"} ],
                 "streams": [ {"stream":"agent|conditions","final":bool,"first_ts","last_ts"} ] } ] }
```

Only files and streams that exist are listed. Absent is not an error.

### Events

```
{ "events": [ <the line as written, parsed JSON> ... ], "next": "TS:N", "final": bool }
```

* `stream` is `agent` (`stories/NN/agent-events.jsonl`, time key `_rx`), `conditions` (`stories/NN/conditions.jsonl`, key `t`),
  or `egress` (`egress.jsonl`, key `t`, run level, no `story`). `server.log` and `proxy.log` have no time on a line and are
  not streams in this version. `requests.jsonl` exists in no real run and is not a stream until one does.
* Events are returned in file order. Real logs never go backwards in `_rx` (80 logs, 18.3 million lines, 17 Oct 2026), so
  file order is time order; a line whose time is lower than the one before it is still returned, in file order, and
  counted: never dropped.
* **Cursor** `TS:N` = the time text of the last event delivered, exactly as written in the file (no float rewrite), and N =
  how many events carrying exactly that time text have been delivered. `after` absent means from the start. A caller never
  sees a duplicate or a gap, including when many events share one time and a page ends among them.
* A last line without its newline, or not valid JSON, is **never returned**; `next` points at the last complete event.
  Once the line is completed it is returned by the next call.
* `limit` defaults to 1000, at most 10000 (named constants). `events` may be empty with the same `next`.
* `final` is the stream's final flag at the time of the call. The caller keeps its cursor until it has read to the end
  with `final: true`.

## Final, and resumption

* A **story** is final when it has ended: `stories[N].status` in `metrics.json` is a closing status (`DONE`, `PARTIAL`, ...;
  read how `progress.rs` decides it) or the run is final.
* A **run** is final when `run-status.json` says `finished`, `failed` or `stopped`, **or when the job for the run is in a
  terminal state** (`done`, `failed`, `cancelled`), whichever is first. The job state is what closes a run whose harness
  crashed before it wrote anything. A run still `started` with no live job is not final until the job is terminal.
* When a run is final, every story and stream of it is final, including a story that never started or never ended.
  What is missing then is simply absent.
* **A final run can be resumed** (`-againN`, or the memory guard's "the run resumes once the machine has recovered").
  `final` therefore holds for the job named in the listing: a different `job` in a later call means the run was reopened and
  `final` is false again. Callers keep reading.
* A file is final when its scope is. A file can change while its scope is open (`metrics.json` is checkpointed each story).

## Errors

Use the existing codes where they fit (`E-BAD-RUN-ID`, `E-RUN-NOT-FOUND`, `E-NAME-NOT-ALLOWED`, `E-OUTSIDE-RUN`) and add
`E-BAD-CURSOR` (400), `E-BAD-STREAM` (400), `E-STORY-NOT-FOUND` (404).

## Scope reduction (what this change stops, with negative tests)

The harness no longer makes these copies or puts them in git. Each line is a test that fails if the old behaviour returns.

1. No `<run>/workspace/` mirror is written (`drive.mirror`), and `workspace-git-log.txt` is still written.
2. No `agent-events.compact.jsonl.gz` is written (`drive.compact_events` is gone).
3. Nothing under a run's `stories/*/agent-events*`, `workspace/`, or any `*.compact.jsonl.gz` is ever staged or committed
   (`.gitignore` rules, `publicise` rules, `record_story`).
4. `metrics.json` and the other records are still committed and pushed at each story's end, as today. `workspace.bundle` is
   made when the run is finalised (`finalize.py`, or the pending sweep for a stopped or failed run), not at each story's end:
   until then the code exists only in the node's work folder. The mirror used to be the in-between copy (found 17 Oct 2026,
   when nine stopped or failed runs turned out to have no bundle).
5. The judge, its preparation and the gallery read the bundle, not the `workspace/` folder.
6. The readers of the compact log read the raw log; a reference run that has only a compact log is still read (99 exist).

## Backtest

A replay node (test support) builds a node directory from a real lake run, cut at a time T (event logs cut at `_rx` <= T,
including a cut inside a line; story and run state as they stood), and starts the real router on it. The lake
(`~/expts/awesome-local-ai-bench-private/state/collected`) has 584 raw logs; run states: 118 finished, 8 stopped, 4 failed,
3 never settled. Properties checked for every run and many T and page sizes: pages rebuild the original lines exactly;
ties survive page boundaries; `final` flips at the right moment; the failed, stopped and never-settled runs close from the
job state alone. `metrics.json` mid-run versions do not exist in the lake, so those come from fixtures.

## Out of scope for this stage

The collector loop that writes into the lake, the lake file layout, the migration of live nodes, and the removal of the
files from git history. They follow when the API is done and backtested.

## Decisions made while building (17 Oct 2026)

* **A live job reopens a run.** A queued or running job makes the run not final whatever `run-status.json` still says, because a
  resumed run keeps its old closing state until its harness writes `started`. Reading stops only when `final` is true.
* **Events:** with no `after` and nothing delivered, `next` is `null`. A complete line that is not a JSON object is skipped
  everywhere and never counted. `limit=0` returns an empty page with the same `next`; over-maximum limits are clamped to 10000.
  A malformed or unknown `story`, a `story` given for `egress`, and an unknown stream give 400 `E-BAD-STREAM`; a well-formed
  story that has no file gives an empty page (absent is not an error), so `E-STORY-NOT-FOUND` is not used on this route.
  A line with no numeric time key is returned, with an empty time text (cursor `:N`).
* **Listing:** the streams are listed under `streams`, not `files`; file names are the full relative names (`stories/01/gate.json`).
  Unknown story status values read `running` while the run is open and `failed` once it is final. No `FAILED` or `SKIPPED` story
  status exists in the lake: an operator skip ends as `PARTIAL` with `ended_by: operator`.
* **`final` is worked out before the page is read (17 Oct, found by reading the route).** It was the other way round, and a
  line written, and the run closed, between the two would be missing from an answer that said `final`: a collector that
  stops at the first `final` would lose it for ever. Now a writer that has finished writes no more, so everything written
  before the flag turned true is in the page. Test: `final_is_never_true_while_a_line_is_unread` (it runs code in the gap
  through `stream::answer`).
* **scope-file:** names outside the allow-list give `E-NAME-NOT-ALLOWED`; an allow-listed name the run lacks gives the existing 404.

## The collector that uses it (`dbench collect --scopes`, 17 Oct 2026)

`tools/dbench/src/scope_collect.rs`. The same lake, the same layout and the same `collection.json` as the old pass; the node is
asked through the scope routes only (`/v1/runs` for the run list, `/v1/runs/scopes`, `/v1/runs/events`, `/v1/runs/scope-file`;
never `/v1/runs/files` or `/v1/runs/file`). It runs beside the old pass and is off unless `--scopes` is given.

* A stream is read by cursor into `<run>/stories/NN/agent-events.jsonl`, `conditions.jsonl` and `<run>/egress.jsonl`, each
  event written as the node sent it. The cursor is a function of the lake's own file (`stream::scan_file`); the note keeps a
  copy (`cursors`) that is trusted only while the file's length is the one recorded. A torn tail in the lake (a crash between
  the write and the note) is cut off.
* The files of the story and run scopes are pulled with the old pull code (`collector::pull_planned`): range, prefix check, blob.
* **Complete** = the listing says the run is final, every stream's last (empty) page said `final`, every file is held to its end,
  and a look after the grace found nothing new. A stream that is not final when the run is, holds it back.
* **Declared differences from a copy of the node's file** (each pinned by a test): a last line without its newline, a complete
  line that is not a JSON object, and blanks or a CR around a line never reach the lake. Real data has none of the three
  (the real-data comparison counts them).
* A lake copy that cannot be the start of the node's file (its first event differs, or it has gone further than the node's last
  event) is replaced by a fresh read, as the old pass refetches: the node is the authority.
