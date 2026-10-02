# Benchmarker: one "Complete runs / All runs" switch for the whole app

Status: **built and live** (2 October 2026). The per-page view tests of section 8 are end-to-end tests in
`e2e/run-filter.spec.ts`: the switch is applied in one place (`App`), through `visibleRuns` in `shared/stats.ts`, which
has its own unit tests.
Scope: `tools/benchmarker`. Decided by the owner on 2 October 2026: the definition of *complete* (section 2), the
default (All runs, remembered), and that this replaces the status filters the app has today.

## 1. Why

The app shows complete runs next to cancelled, failed, stopped and half-recorded ones. The only way to narrow that
today is a row of status chips that exists on one tab and filters one table, plus a second, separate copy on the
machine page. Everywhere else every run is listed. The owner wants to look at the runs that count, on every page,
with one control.

## 2. What "complete" means

A run is **complete** when all three hold:

1. it finished (`status === "finished"`);
2. every story in its scope has a record (`stories` covers `storiesWorking.scope`);
3. it has its final score: the finished build re-scored under its pack's current suite (`scoreOfRecord(row)` in
   `shared/stats.ts`, which already exists and is what the ranking uses).

A complete run with a terrible score is still complete and stays visible: a model that broke its own build is a
result. Runs spoiled by an internal fault are marked invalid and are already absent from the app in both settings;
that does not change.

Not complete, so hidden under "Complete runs": running, queued, failed, stopped, cancelled and unknown runs; finished
runs still waiting for their final score; finished runs missing a story's record; partial reruns of single
stories (they never cover the scope).

One function, `isComplete(row)`, in `shared/stats.ts`, with a unit test per clause. Nothing else decides it.

## 3. The control

- A two-way switch in the header, on every page and every tab: **All runs** | **Complete runs**. No counts on it
  (removed 2 Oct 2026 by the owner: a pack-wide total has no bearing on the page it sits on).
- Default: **All runs**. The choice is remembered in the browser for next time (the app's existing mechanism,
  `localStorage`, next to the remembered tab and pack; no cookie is needed because nothing is sent to the server).
- It is not in the address. A link opens with whatever the reader last chose.
- Keyboard and screen reader: a labelled group of two buttons with `aria-pressed`, as the chips are today.

## 4. What is removed

- The status chips in the header (`StatusFilter`, "only running", "all") and their remembered set
  (`benchmarker:hidden-statuses:v1`).
- The machine page's own status chips (`HistoryFilter` in `MachineHistory`) and its `hide` address parameter. An old
  link that carries it still opens; the parameter is ignored.
- `OverviewPage`'s `hidden` prop.

Each run still shows its own status word wherever it is listed. Only the filtering by status goes.

## 5. Where it applies

Applied once, in `App`, where each page's runs are already narrowed to the pack and version family
(`comparable(...)`): under "Complete runs" that narrowing also drops runs that are not complete. Pages keep
computing from the runs they are given.

| Page | Under "Complete runs" |
|---|---|
| Overview, Runs tab: Combinations table | Only complete runs are ranked and counted; a combination with none is not listed. |
| Overview, Runs tab: the "not counted" notes (running, pending, failed…) | Gone: nothing but complete runs is on the page. |
| Combination page: run list, run matrix, spread, related combinations | Complete runs only. |
| Story page: per-run bars and rows, statistics | Complete runs only (the statistics already count finished runs only). |
| Run page and story-run page: "other runs", "against this combination", "across combinations" | Compared with complete runs only. |
| Machine page: history | Complete runs only. |
| Machines tab and machine page: what is running now, the queue, recently ended | **Not filtered** (section 7). |
| Setup tab | No runs; unaffected. |

## 6. One rule for every page

A page shows what belongs to complete runs and nothing else. There are no special cases per page: a run page, a
story-run page, a combination, a story, a machine's history all follow it.

When everything a page would show is hidden (a link to a cancelled run, a combination with only a running run, a
partial rerun of one story), the page says so in one italic line with the way out:

> *This content is not visible under current filter settings. [Show all](#)*

"Show all" flips the switch to "All runs", for this page and from then on.

## 7. What the switch never hides

- **What machines are doing now.** The running job, the queue and the recently ended list on the Machines tab and
  the machine page are about operations, not results. Hiding running runs there would empty them.
- **The pack and version-family pickers**, which keep listing every pack and family that has runs.

## 8. Tests

Written first, per the repository's rule, and seen to fail before the change:

- `shared/stats.test.ts`: `isComplete` for each clause, including a finished run with a low score (complete), a
  finished run without its final score (not), a finished run missing a story (not), a partial rerun of one story (not).
- A view test per page in section 5: the same fixture under both settings.
- End to end (`e2e/`): the switch is on every page; choosing "Complete runs" on one page holds on the next and after
  a reload; a direct link to a cancelled run shows the italic line, and "Show all" brings the run back; the Machines tab still shows the running job; the
  old status chips are gone.
- The existing tests of the status chips are deleted with the chips.

## 9. Documents

- `tools/benchmarker/README.md`: the switch, the definition, what it never hides.
- The benchmark guide (`benchmarks/docs/guide`): the Benchmarker entity and the "how a number reaches the
  benchmarker" flow say what "complete" means; glossary term "Complete run".

## 10. Order of work

1. `isComplete` and its tests.
2. The switch in the header, remembered, with counts; the single filtering point in `App`.
3. Remove the two status filters and their tests.
4. The italic "not visible under current filter settings" line, wherever a page's content is entirely hidden.
5. View tests and the end-to-end test.
6. README and guide.
7. Tried on a private port and checked in the browser before the live server is swapped.

## 11. Settled

- **Partial reruns of single stories** are not complete runs, so they are hidden under "Complete runs" like anything else
  that is not part of one.
- **Reference runs (Claude).** They follow the same rule: shown when complete.
