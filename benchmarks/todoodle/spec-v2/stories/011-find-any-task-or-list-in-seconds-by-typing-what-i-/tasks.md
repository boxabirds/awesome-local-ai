# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add search_text column (migration 0007), backfill script and deploy hook | proposed | implementation | search.migration |
| 2 | Maintain search_text on every task write path (create and text edits) | proposed | implementation | search.normalise |
| 3 | Build the search endpoint with literal multi-word matching, exclusions, limit and ranking | proposed | implementation | search.api, search.ranking |
| 4 | Redact search text from all request and error logging | proposed | implementation | search.privacy |
| 5 | Add Finder entry points: / and Cmd/Ctrl+K, sidebar search field, phone header button, preloading | proposed | implementation | finder.entry_points |
| 6 | Build the Finder overlay: instant list matches, debounced task search, states and add-from-search | proposed | implementation | finder.overlay |
| 7 | Render grouped results with highlighted matches and TaskSummary, no controls inside options, and truncation notice | proposed | implementation | finder.component |
| 8 | Open results in context and act from the Finder action bar (Complete, Set date, Move) with inline Undo | proposed | implementation | finder.results_actions |
| 9 | Keep results live while the Finder is open, with stable selection | proposed | implementation | search.live_refresh |
| 10 | Keep recent searches in this browser only, with Clear recent | proposed | implementation | finder.recent |
| 11 | Phone Finder: full-screen sheet, large rows, press-and-hold action bar (no swipe, no in-row buttons) | proposed | implementation | finder.mobile |
| 12 | Make the Finder fully accessible: labels, throttled result announcements, focus handling and contrast | proposed | implementation | finder.a11y |
| 13 | Unit tests: normalisation, LIKE escaping, params, ranking, redaction, list matching, live patching, selection, recents | proposed | test:unit | search.normalise, search.migration, search.api, search.ranking, search.privacy, search.live_refresh, finder.overlay, finder.recent |
| 14 | Integration tests: search endpoint against real D1, write-path maintenance, backfill, log redaction, performance | proposed | test:integration | search.normalise, search.migration, search.api, search.ranking, search.privacy |
| 15 | UI component tests: entry points, Finder states, typed text, action bar, status line, live updates, recents, phone sheet, accessibility | proposed | test:ui-component | search.live_refresh, finder.component, finder.overlay, finder.results_actions, finder.recent, finder.entry_points, finder.mobile, finder.a11y |
| 16 | E2E: find and open, typed text, action bar with inline Undo, live results across two browsers, add from search, phone long-press, accessibility, privacy | proposed | test:e2e | search.api, search.privacy, search.live_refresh, finder.component, finder.overlay, finder.results_actions, finder.entry_points, finder.mobile, finder.a11y |

## Details

### 1. Add search_text column (migration 0007), backfill script and deploy hook

Depends on: story 5 migration 0002 (tasks), story 7 0003, story 8 0004, story 9 0005, story 10 0006 applied (D-32: numbered by build order); story 1 deploy script (post-migration hook list — Delta to story 1) and migration safety scan; story 7 `packages/shared/src/search.ts` (`normaliseForSearch`, owned by story 7, D-43) + this story's task 2 (`buildSearchText`).

Steps:
1. `migrations/0007_task_search_text.sql`: `ALTER TABLE tasks ADD COLUMN search_text TEXT;` only. Must pass the safety scan (TC-14). No file named 0005 for search exists anywhere.
2. `limits.ts`: `SEARCH_BACKFILL_BATCH = 500`.
3. `scripts/backfill-search-text.ts` (bun): `--env local|staging|production`; loop: select up to `SEARCH_BACKFILL_BATCH` rows `WHERE search_text IS NULL`, compute `buildSearchText(name, description)`, write `UPDATE tasks SET search_text=? WHERE id=? AND search_text IS NULL` in one `wrangler d1 execute --json` batch; stop at 0 rows; print totals; non-zero exit on wrangler error. Expose a D1-adapter seam so the integration test can drive it against Miniflare D1.
4. `scripts/deploy.ts`: register in story 1's post-migration hook: if 0007 was among the applied migrations (or NULL rows exist), run the backfill for that env after all migrations; record outcome in the deploy CSV.
5. Backfill note: 0007 is the first and only migration adding the column (the draft 0005 number never shipped), so no renumbering migration is written.
6. `apps/api/src/db/search.ts`: text expression `COALESCE(t.search_text, lower(t.name) || char(10) || lower(coalesce(t.description,'')))` used by the search SQL (fallback for un-backfilled rows).

Done when TC-14 (unit), TC-36, TC-37 (integration, migrations 0001–0007) pass.

### 2. Maintain search_text on every task write path (create and text edits)

Depends on: task 1 (column exists); story 7 `normaliseForSearch` in `packages/shared/src/search.ts` (owner: story 7, D-43 — story 11 adds `buildSearchText` only, recorded as Delta to story 7); story 5 `insertTask`, story 6 PATCH name/description, story 7 projectId create, story 8 dueDate create all routed through `apps/api/src/db/tasks.ts`; story 4 `broadcast(c, wid, event)` (D-26) unchanged.

Steps:
1. `packages/shared/src/search.ts`: add `buildSearchText(name, description) = normaliseForSearch(name) + '\n' + normaliseForSearch(description ?? '')`. Do not redefine or copy `normaliseForSearch`.
2. `apps/api/src/db/tasks.ts`: `insertTask` binds `search_text`; the text-update function used by story 6's PATCH (name and/or description) recomputes it from the post-update name+description in the same UPDATE (read current values in the same statement via `COALESCE(?, name)` pattern, or compute from the merged row already loaded by the route). Writes that do not touch name/description (complete, reopen, move, due date, delete, restore, reschedule) must not touch the column.
3. Audit: grep every `INSERT INTO tasks` / `UPDATE tasks SET name|description` in apps/api; there must be exactly the paths above (add a unit-level lint test that fails if another raw write appears outside db/tasks.ts).
4. No new live event; broadcasts unchanged.

Done when TC-01..TC-04 (unit) and TC-33, TC-34, TC-35, TC-85 (integration) pass.

### 3. Build the search endpoint with literal multi-word matching, exclusions, limit and ranking

Depends on: tasks 1-2; story 2 workspace-auth middleware (incl. story 9's 410 `link_changed` branch); story 1 pipeline (validation, headers, 405); story 7 projects table (deleted flag); story 6's `include_completed=true|false` convention (D-31).

Steps:
1. `limits.ts`: `SEARCH_QUERY_MAX=200`, `SEARCH_MIN_CHARS=2`, `SEARCH_RESULT_LIMIT=50`.
2. `schemas.ts`: `searchParamsSchema` (q 1..200 raw; `include_completed` 'true'|'false', default 'false', transformed to boolean `includeCompleted`; '1', '0', 'x' rejected — no `completed=0|1` form), `searchResponseSchema` ({tasks: SearchHit[], truncated}); SearchHit = {id, name, projectId|null, dueDate|null, completedAt|null, matchedIn, version}.
3. `db/search.ts`: `escapeLike` (escape \\, %, _), `buildSearchSql(terms, includeCompleted)` -> {sql, binds}: workspace filter, `t.deleted=0`, LEFT JOIN projects with `(t.project_id IS NULL OR p.deleted=0)`, `t.completed_at IS NULL` unless includeCompleted, one `LIKE ? ESCAPE '\\'` per term on the COALESCE text expression, `matchedIn` via instr on the part before char(10), ORDER BY per design (completed, matchedIn, due nulls last, due asc, updated_at desc, id), LIMIT `SEARCH_RESULT_LIMIT + 1`. Parameters only.
4. `packages/shared/src/search.ts`: `rankKey(hit)` mirroring the ORDER BY for client re-sorts (Delta to story 7: this file hosts it).
5. `routes/search.ts`: GET, validate, normalise terms (dedupe, drop empties), short-circuit under 2 chars, run, slice 50 + truncated, `Cache-Control: no-store`. Errors as `{error, message}` so story 2's client maps them by `body.error` (D-20). Register under the workspace router in `app.ts`.
6. Never log params (task 4 wires redaction).

Done when TC-05..TC-12 (unit), TC-15..TC-31, TC-38, TC-81 (integration) and TC-75 (e2e, together with the Finder tasks) pass.

### 4. Redact search text from all request and error logging

Depends on: story 1 request pipeline (request-id logging, error handler) and its URL-redaction hook (Delta to story 1, recorded in this story's 'Deltas / extension points used'); task 3 route path.

Steps:
1. `lib/redact.ts`: `redactQuery(url)` replaces the `q` value with `[redacted]` for paths matching `/api/w/*/search`; leaves other params (e.g. `include_completed`, D-31) and other paths untouched.
2. Wire it through story 1's hook into every place story 1 logs a URL (access line in request-id middleware, error handler). Error reports never include raw URL, body or cookies.
3. `docs/ops/runbook.md`: add a check to the post-staging-deploy log inspection (story 2 task 2.7) that no search text appears in Workers Logs.

Done when TC-13 (unit, URL with `include_completed=false` preserved), TC-32 (integration), TC-80 (e2e) pass.

### 5. Add Finder entry points: / and Cmd/Ctrl+K, sidebar search field, phone header button, preloading

Depends on: story 5 `lib/shortcuts.ts` — `useGlobalShortcut({key, modifiers?, scope?, allowInOverlay?, description})` and the overlay scope stack (D-14); AppShell `searchSlot` / `headerActionsSlot` named props (story 2 shell extended by story 5, D-11); story 5 `lib/useIsNarrow.ts`; story 2 `lib/lazyWithRetry.ts` (D-42) and the per-icon import lint (D-43); task 6 (`preloadFinder`, Finder component).

Steps:
1. `useFinderStore.ts`: tiny external store (`useSyncExternalStore`), boolean `isOpen` snapshot, `open(trigger?: HTMLElement)`, `close()`; remembers trigger for focus return.
2. `useFinderShortcuts.ts`: `useGlobalShortcut({key:'/', scope:'global', description:'Search'})` and `useGlobalShortcut({key:'k', modifiers:['mod'], scope:'global', description:'Search'})`, bound to a handler that calls `preloadFinder()` then `open(document.activeElement)`. Do not set `allowInOverlay` (both are suppressed while any overlay, including the Finder, is open).
3. `SidebarSearchField.tsx`: button styled as a field, text 'Search…', platform hint (⌘K on mac UA, Ctrl K otherwise), label 'Search {workspace}'; `onPointerEnter`/`onFocus` -> `preloadFinder()`; click -> open(self).
4. `HeaderSearchButton.tsx`: 🔍 icon via a per-icon deep lucide import (no `components/icons.ts` barrel), `aria-label='Search'`, 44 px target, rendered only when `useIsNarrow()`.
5. Mount in `routes/Workspace.tsx`: pass SidebarSearchField as `searchSlot`, HeaderSearchButton as `headerActionsSlot`, call `useFinderShortcuts()` once; schedule idle preload after first paint (`requestIdleCallback`, fallback setTimeout).
6. Chunk failure: story 2's `lazyWithRetry` retries, then toast "Couldn't open search — try again".

Done when TC-50..TC-54, TC-83 (ui-component, incl. 'another overlay open' case) and TC-75, TC-78 (e2e) pass.

### 6. Build the Finder overlay: instant list matches, debounced task search, states and add-from-search

Depends on: task 3 (endpoint + schemas); task 5 (store/entry); story 7 `ResponsiveCommand`, `useProjects`, `normaliseForSearch`; story 5 `useCreateTask` with the QuickAdd target `{kind:'inbox'} | {kind:'project', projectId}` (D-40), `focusTaskRow` (D-04), overlay scope stack in `lib/shortcuts.ts` (D-14); story 4 offline store + `useCanEdit()` (D-10); story 2 `queryKeys.search` (D-37 — use only; `queryKeys.ts` is story 2's file and is forbidden here), `lib/errors.ts` typed errors + `ApiErrorBoundary` (D-20), `lazyWithRetry` (D-42).

Steps:
1. `limits.ts`: `SEARCH_DEBOUNCE_MS=150`, `SEARCH_SKELETON_DELAY_MS=300`, `FINDER_RECENT_PROJECTS=3`.
2. `api.ts`: `search(wid, q, includeCompleted, {signal})` sends `include_completed=true|false` (D-31), parsed with `searchResponseSchema`; errors thrown as story 2's typed errors (by `body.error`).
3. `matchLists.ts` (pure): Today + Inbox + projects (from cached useProjects data with precomputed searchKey) filtered by normalised substring; synchronous (<50 ms, TC-40); works offline.
4. `searchQuery.ts`: query options with key `queryKeys.search(wid, {q, includeCompleted})`, `signal` passthrough, `enabled` only when normalised q >= SEARCH_MIN_CHARS and not offline, `placeholderData: keepPreviousData`, `staleTime: 0`, `throwOnError: e => e instanceof NotFoundError || e instanceof LinkChangedError`.
5. `Finder.tsx` (lazy via `lazyWithRetry` + `preloadFinder`): ResponsiveCommand without anchor; on open push an overlay scope on story 5's stack, pop on close; own key handling with `stopPropagation` on Escape; the input intercepts only ↑/↓/Home/End/Enter (cmdk), Tab (task 8) and Escape — **every other key, including Space, 'd' and 'm', is text** (D-15); input placeholder 'Search {workspace}…', maxLength SEARCH_QUERY_MAX; debounced q; results from `useDeferredValue`; state machine per design (EmptyQuery, ListsOnly, Loading, Results, NoResults, Error, Offline); skeleton only after 300 ms with no data; NoResults first option 'Add task "{q}" → {current list}' via useCreateTask then close and `focusTaskRow(newId)` (failure handled by story 5's failed row); 'Include completed' checkbox persisted at `tdl:v1:search:completed` (try/catch); NotFound/LinkChanged -> close Finder, error reaches `ApiErrorBoundary`; other ApiError (incl. RateLimitedError, 500, network) -> Error state with Try again; Escape closes and focus returns to stored trigger.
6. Direct imports only; no barrels; no locally built query-key arrays.

Done when TC-40, TC-41 (unit), TC-55..TC-64, TC-72, TC-82, TC-87, TC-89, TC-90, TC-94, TC-98 (ui-component), TC-75, TC-77, TC-99 (e2e) pass.

### 7. Render grouped results with highlighted matches and TaskSummary, no controls inside options, and truncation notice

Depends on: task 6 (Finder); story 7 `OptionRow`, `HighlightedText`; story 5 `TaskSummary` (D-01/D-43 — reused as non-interactive option content; it renders the list chip and story 8's `features/dates/DateChip.tsx` through its slots); story 5 `lib/useIsNarrow.ts`; story 7 project colour tokens.

Steps:
1. `highlightRanges.ts` (pure): locate each normalised term in the normalised name and map back to original string indices (build an index map during normalisation so accented/decomposed characters map correctly); merge overlapping ranges.
2. `finderCopy.ts`: all Finder strings as constants — key-hint footer '↑↓ move · Enter open · Tab actions · Esc close', truncation 'Showing the first 50 — add another word to narrow it down.', status 'Completed "{name}"', 'Offline — actions unavailable', bar label 'Actions for "{name}"'. Tests assert these constants.
3. `FinderResults.tsx`: groups 'Lists' then 'Tasks · N results' (role=group + aria-label); task option = memoised `OptionRow` with an inert, `aria-hidden` checkbox glyph, `HighlightedText` name, then story 5's `TaskSummary` fed from `SearchHit` (no Finder-local chip/summary component; no direct DateChip rendering outside TaskSummary); completed rows struck through with 'Completed' text; `truncated` footer; key-hint footer on hover-capable devices only.
4. **Options contain no interactive children at any width** (no button, link, input, or tabindex inside `[role=option]`) — TC-95.
5. Memoised selector keyed by (id, name, q) for ranges; rows receive primitive props.

Done when TC-58, TC-62, TC-95 (ui-component) and TC-75, TC-79 (e2e) pass. Unit coverage of highlightRanges is in the unit test task ('Café' + 'cafe' -> [0,4]; decomposed input; overlapping terms merged).

### 8. Open results in context and act from the Finder action bar (Complete, Set date, Move) with inline Undo

Implements D-15 (action bar replaces Space/D/M keys), D-05 (owner open helpers), D-12 (workspacePath), D-41, D-10, D-20.

Depends on: task 6, task 7; story 2 `workspacePath(wid, view)` (no `listRoute()`); story 7 `useWorkspaceNavigate` (fragment carry-over, D-13), `openMovePicker(taskId, {returnFocusTo})`; story 5 `features/tasks/useTaskGrid.ts` `focusTaskRow(id)`; story 6 `features/tasks/mutations.ts` complete/reopen, `showUndoToast({message, onUndo})`, `openTaskDetail(id, {returnFocusTo})`, show-completed per list; story 8 `openDatePicker(taskId, {returnFocusTo, anchor?})` in unanchored mode; story 4 `useCanEdit()`; story 2 typed errors (`GoneError`).

Steps:
1. `useFinderActions.ts`: `openTask(hit)` -> `useWorkspaceNavigate` to `workspacePath(wid, view)` (Inbox if projectId null, else the project); after route commit, `focusTaskRow(hit.id)` then `openTaskDetail(hit.id, {returnFocusTo: focused row})`; if completed, enable show-completed for that list first; close Finder; `recentStore.add(q)`. `openList(list)` -> navigate via `workspacePath`, close, `recentStore.add(q)`.
2. `FinderActionBar.tsx`: rendered after the listbox (never inside an option) when a task option is highlighted; `role=toolbar`, `aria-label` 'Actions for "{name}"', roving tabindex; buttons Complete (Reopen when completed), Set date, Move. Keys: ←/→ (no wrap), Home/End, Enter/Space activate, Shift+Tab -> input, Escape closes Finder. Bound to the task id it was focused for; if that id leaves results -> focus input, no action.
3. Finder input: Tab with a task highlighted -> `preventDefault`, focus bar's first enabled button; otherwise default Tab order. No other key in the input triggers actions.
4. Complete/Reopen -> story 6 mutation, then `showUndoToast({message: 'Completed "{name}"', onUndo})`, and render `FinderStatusLine` (`role=status`, outside the listbox) 'Completed "{name}" · Undo' whose Undo calls the same `onUndo`; clears after `UNDO_WINDOW_MS`, on Undo, or on query change; focus returns to the input.
5. Set date -> `openDatePicker(id, {returnFocusTo: SetDate button})` with no anchor; Move -> `openMovePicker(id, {returnFocusTo: Move button})`; Finder stays open; focus returns to the button (or input if the bar's task is gone).
6. Gating: bar buttons and status-line Undo `aria-disabled` + 'Offline — actions unavailable' while `!useCanEdit()`.
7. Errors: `GoneError{entity:'task'}` -> row removed + 'This task was deleted' toast; other failures use story 6's rollback + toast.
8. Remove any Space/'d'/'m' handling from the Finder `onKeyDown`.

Done when TC-65..TC-68, TC-89..TC-94, TC-96 (ui-component) and TC-75, TC-78, TC-99, TC-100 (e2e) pass.

### 9. Keep results live while the Finder is open, with stable selection

Depends on: story 4 `registerLiveHandler` (Map<type, Set<fn>>), notifyManager rAF batching, reconnect invalidation of ['ws', id], `tasks.bulk` = `{ids, deleted?}` with refetch semantics (D-25); story 2 `queryKeys.search` (D-37); task 3 `rankKey`; task 6 Finder.

Steps:
1. `limits.ts`: `SEARCH_LIVE_REFRESH_MS=500`.
2. `applySearchEvent.ts` (pure): per design contract — for task.upserted / task.deleted / task.restored / project.deleted / project.restored: replace+resort / remove / needsRefetch / ignore stale; match test uses normaliseForSearch on the event's name (+ description if present) against cached terms and `includeCompleted`. **`tasks.bulk` always returns needsRefetch and the cache unchanged** — never patch or re-sort from bulk event data (TC-97, TC-88).
3. `nextSelection.ts` (pure): keep id; else following item; else last; else none.
4. `useSearchLiveSync.ts`: registers handlers only while the Finder is open; patches all entries under the `queryKeys.search(wid)` prefix via `setQueriesData`; coalesces needsRefetch into one `invalidateQueries({queryKey: queryKeys.search(wid)})` after 500 ms; unregisters on close.
5. Finder uses nextSelection when results change (the action bar target is handled by task 8, not moved by nextSelection).

Done when TC-42..TC-48, TC-97 (unit), TC-69..TC-71, TC-86, TC-88 (ui-component), TC-76 (e2e) pass.

### 10. Keep recent searches in this browser only, with Clear recent

Depends on: task 6 (EmptyQuery view).

Steps:
1. `limits.ts`: `SEARCH_RECENT_MAX=5`.
2. `recentStore.ts`: key `tdl:v1:recent:{workspaceId}`; `list()`, `add(q)` (trim, case-insensitive dedupe to front, cap 5), `clear()`; module-level read cache per workspace; every storage access in try/catch; corrupt JSON treated as empty and overwritten on next add. No network use.
3. EmptyQuery view: recents list (Enter re-runs the query) + 'Clear recent' button.

Done when TC-49 (unit), TC-55, TC-84 (ui-component) pass.

### 11. Phone Finder: full-screen sheet, large rows, press-and-hold action bar (no swipe, no in-row buttons)

Implements D-09 (swipe removed; no in-option Complete button) and the touch half of D-15.

Depends on: story 7 ResponsiveCommand Drawer mode; story 5 `lib/useIsNarrow.ts`, touch tokens (`MIN_TOUCH_TARGET_PX`); tasks 5, 7, 8 (`FinderActionBar`, completion + status-line path).

Steps:
1. `limits.ts`: `FINDER_MOBILE_ROW_PX=56`, `FINDER_LONG_PRESS_MS=500`, `FINDER_LONG_PRESS_SLOP_PX=10`. No `SWIPE_COMPLETE_PX`.
2. `FinderMobileHeader.tsx`: back arrow (close), input with `enterKeyHint='search'`, clear ×; sheet top-aligned so the keyboard never covers the input.
3. Narrow options >= 56 px, containing **no buttons or other controls** (TC-95). No `useSwipeToComplete` hook or swipe handlers exist.
4. `useLongPress.ts`: pointer events, passive listeners, one timer of `FINDER_LONG_PRESS_MS`; cancel on movement beyond `FINDER_LONG_PRESS_SLOP_PX`, scroll or pointercancel; a release before the timer is a tap (opens the task); a completed hold highlights the task and shows `FinderActionBar` docked at the bottom of the sheet above the keyboard (buttons >= 44 px). Prevent `contextmenu` and set `-webkit-touch-callout: none` on options.
5. Bar actions use exactly task 8's path (story 6 complete + `showUndoToast` + status line, unanchored bottom-sheet pickers, `useCanEdit()` gating).
6. Hide key-hint footer under `@media (hover: none)`.

Done when TC-74, TC-95 (ui-component) and TC-78 (e2e, `@mobile` on mobile-webkit and mobile-chromium) pass.

### 12. Make the Finder fully accessible: labels, throttled result announcements, focus handling and contrast

Depends on: task 6, task 7, task 8; story 2 `packages/shared/src/tokens.ts` + generator + contrast checker (D-42); cmdk ARIA from story 7's ResponsiveCommand.

Steps:
1. `limits.ts`: `SEARCH_ANNOUNCE_THROTTLE_MS=500`.
2. Visually hidden `<label>` 'Search {workspace}' bound to the input; groups labelled.
3. `ResultAnnouncer.tsx`: single `role=status` region; updates at most every 500 ms (ref timestamp + trailing timer) with 'N results' / 'No tasks match'; live row changes not announced individually.
4. Action bar semantics: `role=toolbar` sibling after the listbox (never inside it), `aria-label='Actions for "{name}"'`, `aria-orientation=horizontal`, `aria-controls` listbox; disabled state via `aria-disabled` + visible text. Status line is its own polite `role=status` region outside the listbox.
5. Verify focus trap (Radix), dialog Tab order (input → bar when a task is highlighted → status-line Undo → Include completed → close), focus return from every entry point and from sub-pickers to their bar button.
6. `tokens.ts` entries (generated into `tokens.css` by story 2's generator): `--mark-bg`/`--mark-fg` for light and dark meeting 3:1 (UI) / 4.5:1 (text), checked by story 2's contrast checker; `<mark>` also bold.

Done when TC-72, TC-73, TC-91, TC-95 (ui-component) and TC-79 (e2e: axe passes with the action bar and status line visible, light and dark) pass.

### 13. Unit tests: normalisation, LIKE escaping, params, ranking, redaction, list matching, live patching, selection, recents

Implement from the design test strategy: TC-01..TC-14 and TC-40..TC-49, TC-97:
- TC-01..TC-04: `buildSearchText` and story 7's `normaliseForSearch` as used by search (accents, case/whitespace, non-Latin, empty).
- TC-05: escapeLike. TC-06..TC-10: params schema incl. 1/2/200/201 chars and whitespace-only. TC-11: `include_completed` absent/'true'/'false'/'1'/'x' -> false/true/false/400/400 (D-31).
- TC-12: rankKey every tie-breaker. TC-13: redactQuery with `include_completed=false` preserved. TC-14: safety scan of `0007_task_search_text.sql` (D-32).
- TC-40, TC-41: matchLists incl. accents and <50 ms.
- TC-42..TC-46: applySearchEvent branches incl. stale version and unknown task; TC-97: `tasks.bulk` returns needsRefetch with the cache returned unchanged (same reference, no re-sort) (D-25).
- TC-47, TC-48: nextSelection kept/removed/empty. TC-49: recentStore cap/dedupe/clear/throwing storage.
Also highlightRanges: 'Café' + 'cafe' -> [0,4]; decomposed input; overlapping terms merged. Plus the write-path lint from task 11.2 (no raw tasks INSERT/UPDATE of name/description outside apps/api/src/db/tasks.ts). Fixtures use realistic task names from the seed (boiler, Café receipts, 50% deposit, file_v2, dentist). No I/O. Run with bun run test:unit.

### 14. Integration tests: search endpoint against real D1, write-path maintenance, backfill, log redaction, performance

vitest-pool-workers, `SELF.fetch`, real Miniflare D1 with migrations 0001-0007 (D-32) and real WorkspaceRoom DO; nothing mocked. Seed via `/test/seed` (D-35 schema) with the realistic fixture from the design (40 tasks, completed/deleted variants, deleted project, second workspace).
Implement TC-15..TC-38 plus negatives TC-81 and TC-85:
- matching: single, multi-word AND any order, accents, case, literal % and _, description-only ranking, completed excluded with `include_completed` absent/false and included with `include_completed=true` (TC-22/23, D-31), deleted, deleted project, other workspace, zero, exactly 50, 51 (truncated);
- access 404 `{error:'not_found'}` identical body; headers (no-store, request id, security);
- log redaction with console spy on success and forced 500 (TC-32);
- write paths: create, PATCH description, and non-text writes leaving search_text byte-identical, no extra broadcast (count WorkspaceRoom sends) (TC-33..TC-35, TC-85);
- NULL fallback and idempotent backfill through the script's D1 adapter, incl. a pre-existing 'Café old' row found by q='cafe' after backfill (TC-36, TC-37);
- perf: 5,000 tasks, 50 queries of 2-12 chars, assert p95 <= 300 ms local (TC-38; mark as perf project so CI can run it separately).
Assert DB state before and after for every stateful case.

### 15. UI component tests: entry points, Finder states, typed text, action bar, status line, live updates, recents, phone sheet, accessibility

vitest + happy-dom + Testing Library; MSW handlers returning fixtures parsed by `searchResponseSchema` and real `{error, message}` error bodies (not_found, link_changed, rate_limited, internal); fake live registry that dispatches story-4-shaped events (`tasks.bulk` = `{ids, deleted?}`); story 5's real `lib/shortcuts.ts` overlay scope stack; story 4 `useCanEdit` store driven directly; spies on `openTaskDetail`, `openMovePicker`, `openDatePicker`, `focusTaskRow`, `showUndoToast`; fake timers only for debounce/skeleton/announcer/long-press/undo-window/refetch timing. Copy asserted via `finderCopy.ts` constants.
Implement TC-50..TC-74, TC-82..TC-84, TC-86..TC-96, TC-98:
- entry: '/', mod+K per UA, ignored in fields, during IME composition and while another overlay is open, sidebar field and narrow header icon, preload via lazyWithRetry called once (TC-50..TC-54, TC-83);
- states: empty query with recents + lists, debounce + abort, under 2 chars, grouping/options/<mark>/TaskSummary, no flicker with 300 ms skeleton, no results -> add task (QuickAdd target, focusTaskRow), include completed persisted with `include_completed=true`, truncated notice, error + retry keeping text, offline (no request), live paused still searching, typed errors 404/410 to ApiErrorBoundary and 429 to Error state (TC-55..TC-64, TC-82, TC-87, TC-98);
- typed text: 'boiler service' (TC-89) and 'dentist' / 'move mum' (TC-90) insert text and trigger no action;
- actions: open task in context via workspacePath (TC-65), open list (TC-66), Complete from the action bar with showUndoToast + inline status line (TC-67), Set date / Move unanchored with returnFocusTo (TC-68), bar keyboard contract (TC-91), bar target leaving results (TC-92), offline gating of bar and Undo (TC-93), overlay scope suppression + picker Escape (TC-94), no interactive children in options at 1280 and 375 px (TC-95), status-line Undo (TC-96);
- live: patch keeps selection, removed selected moves to next, unknown task coalesced refetch after 500 ms, tasks.bulk -> one invalidation, no patch/re-sort from event data (TC-69..TC-71, TC-86, TC-88);
- a11y: Escape and focus return incl. from the bar, throttled announcements (TC-72, TC-73); phone sheet layout, long-press shows the bar, tap opens, no swipe, no buttons in options (TC-74); recents local only (TC-84).

### 16. E2E: find and open, typed text, action bar with inline Undo, live results across two browsers, add from search, phone long-press, accessibility, privacy

Playwright (chromium + webkit desktop; `@mobile` specs also on mobile-webkit and mobile-chromium, D-36) against wrangler dev with a fresh local D1 (migrations 0001–0007) seeded through `/test/seed` with the design's realistic fixture; DB state checked through `/test/tasks/:id/raw` (D-35).
Workflows:
- TC-75: press '/', type 'manual', Enter -> Home list, row focused, detail open.
- TC-76: two contexts on the same workspace; A searches 'boiler' and selects row 2; B adds 'Boiler flue check' then deletes 'Boiler manual PDF'; within 5 s A shows the new row, loses the deleted row, selection preserved, no typing.
- TC-77: search 'descale kettle' -> Enter on Add task -> task visible in current list.
- TC-78 (`@mobile`): tap header 🔍, search 'boiler', long-press 'Book boiler service' -> action bar docked at bottom; tap Complete -> status line 'Completed … · Undo'; tap Undo -> reopened; no buttons inside options; DB before -> after -> after Undo.
- TC-79: axe on the open Finder with results and the action bar visible (Tab pressed), then with the status line shown, in light and dark (colorScheme); combobox/listbox/toolbar/status roles; toolbar not inside listbox; `nested-interactive` passes.
- TC-80: capture all requests during TC-75; q appears only in same-origin GET /api/w/:id/search; scan wrangler dev stdout for the query text -> absent.
- TC-99: real keyboard: '/', type 'boiler service' with a result highlighted, clear, type 'dentist' -> input shows exactly the text; results filter; no task changed; no date picker or Move dialog present.
- TC-100: '/', 'boiler', Tab, Enter (Complete) -> status line visible inside the open Finder; Tab to Undo, Enter -> task reopened in D1; Finder never closed.

