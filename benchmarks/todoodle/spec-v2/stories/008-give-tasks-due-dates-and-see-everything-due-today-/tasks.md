# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Shared local-date logic: validation, arithmetic, classification, chip labels, midnight | proposed | implementation | dates.local_date_logic |
| 2 | Store due dates on tasks: migration 0004, create/update accept dueDate, broadcast | proposed | implementation | dates.due_date_field |
| 3 | Today query endpoint and Today count on the shared counts endpoint | proposed | implementation | today.query |
| 4 | Reschedule overdue (id-scoped) and version-guarded undo endpoints | proposed | implementation | today.reschedule |
| 5 | Local-date clock store and useLocalDate with midnight rollover | proposed | implementation | ui.midnight_rollover |
| 6 | Date picker (openDatePicker, overlay-scoped keys) and relative date chip in task rows, quick add and the detail sheet | proposed | implementation | ui.date_picker |
| 7 | Today view as one TaskGrid (Overdue/Today rowgroups), Reschedule + Undo, project tags, sidebar badge and live refresh | proposed | implementation | ui.today_view |
| 8 | Unit tests: date logic, schemas, today split, undo mapping, clock store | proposed | test:unit | dates.local_date_logic, dates.due_date_field, today.query, today.reschedule, ui.midnight_rollover |
| 9 | Integration tests: due date API, Today query, reschedule/undo, migration, performance | proposed | test:integration | dates.due_date_field, today.query, today.reschedule |
| 10 | UI-component tests: date picker, chip, Today view, reschedule/undo, sidebar badge, rollover | proposed | test:ui-component | ui.date_picker, ui.today_view, ui.midnight_rollover |
| 11 | E2E tests: set date, Today, reschedule+undo, cross-timezone viewers, midnight, live, performance | proposed | test:e2e | dates.due_date_field, today.query, today.reschedule, ui.date_picker, ui.today_view, ui.midnight_rollover |

## Details

### 1. Shared local-date logic: validation, arithmetic, classification, chip labels, midnight

Extend `packages/shared/src/dates.ts` (created by story 6 with cached Intl helpers) per the design section dates.local_date_logic.

Functions:
- `isCalendarDate`: hoisted regex, Date.UTC round trip, DUE_DATE_MIN_YEAR/MAX_YEAR bounds.
- `localDateOf`.
- `addDays`: UTC calendar arithmetic, never local instants.
- `weekdayOf`.
- `nextWeek`: the next Monday; on a Monday, +7.
- `thisWeekend`: Mon-Fri gives the coming Saturday; Sat and Sun give today.
- `shortcutDates`.
- `SHORTCUT_KEYS`: frozen `{t, m, w, n, '0'}`. Consumed only by the picker panel's own `onKeyDown` (overlay-scoped, D-14); never registered in the global shortcut registry.
- `dayOffset`.
- `classify`.
- `chipLabel`, returning `{text, tone, srLabel, showWarningIcon}`: 'Yesterday' / 'N days overdue' with the icon; srLabel 'Overdue: due <full date>'.
- `formatShortcutDate` ('Sat 26 Sep'), using cached Intl formatters.
- `msUntilNextLocalMidnight`.

Add constants to `limits.ts` (no magic numbers): DUE_DATE_MIN_YEAR, DUE_DATE_MAX_YEAR, CHIP_WEEKDAY_MAX_OFFSET, RESCHEDULE_MAX_IDS, TODAY_INVALIDATE_DEBOUNCE_MS, MIDNIGHT_SLACK_MS, RESCHEDULE_CONFIRM_MIN, WEEKDAY_SATURDAY, WEEKDAY_SUNDAY, WEEKDAY_MONDAY, DAYS_PER_WEEK, D1_MAX_BOUND_PARAMS.

Export `localDateSchema` from `schemas.ts`.

No date library in this package; `date-fns` is allowed only in `apps/web/src/features/dates/picker/*` (story 2's lint allowance, D-43; architecture §12).

**Tests to satisfy:** unit TC-01..TC-11, TC-21..TC-35, TC-101..TC-109 (task 8).

Depends on the story 1 layout and on story 6's `dates.ts` (story 6 precedes story 8 in build order, so the file exists).

### 2. Store due dates on tasks: migration 0004, create/update accept dueDate, broadcast

**Migration** `migrations/0004_task_due_date.sql`: `ALTER TABLE tasks ADD COLUMN due_date TEXT;` + `CREATE INDEX idx_tasks_ws_due ON tasks(workspace_id, deleted, completed_at, due_date)`. No CHECK. Must pass story 1's migration safety scan.

**Schemas** (`packages/shared/src/schemas.ts`): extend story 5's `createTaskSchema` (client id already required) and story 6's `updateTaskSchema` with `dueDate: localDateSchema.nullable().optional()`; `taskSchema` gains `dueDate`.

**DB** (`apps/api/src/db/tasks.ts`): column list, mapper, insert, update (version+1, updated_at); include `due_date` in story 5's idempotent-create comparison so a same-id+same-body retry returns the existing task (409 `id_conflict` rule unchanged). Same-value PATCH is a no-op: no version bump, no broadcast.

**Routes** (`apps/api/src/routes/tasks.ts`): existing POST/PATCH pass `dueDate` through.
- Story 1's validate pipeline applies unchanged: missing `X-Todoodle-Client` → 403 `forbidden_client`; **non-JSON body → 415 `unsupported_media_type`** (D-21 — not 403).
- 410 `gone {entity:'task'}` for soft-deleted; 404 for other workspace or no cookie.
- Broadcast with story 4's `broadcast(c, wid, {type:'task.upserted', entity, version, originClientId})` exactly (D-26): no `room.broadcast`, no extra `ctx.waitUntil`.

**Test seed:** story 5's `/test/seed` schema already declares `tasks[].dueDate` as story 8's extension (D-35); make the seed insert honour it. Do not add a new seed route and do not use `/test/sql` (removed).

**Tests to satisfy:** TC-21..TC-29 (schemas), TC-36..TC-44, TC-46, TC-100, TC-130; e2e TC-86, TC-92.

Depends on stories 1, 2, 4, 5, 6.

### 3. Today query endpoint and Today count on the shared counts endpoint

**Server**
- Add `GET /api/w/:workspaceId/today?date=&include_completed=true|false` under workspace-auth (D-31: story 6's param name and values; `include_completed=1` or any other value → 400).
  - `date` is required: 400 if missing or invalid. Never default to the server clock.
  - `db.listDueOnOrBefore`: a single SELECT with LEFT JOIN projects (`p.deleted = 0`). It excludes tasks in deleted projects and uses `idx_tasks_ws_due`.
  - Pure `splitToday(rows, date)` in `apps/api/src/today/split.ts`, one pass, into overdue (`due_date ASC, sort_order ASC`), today and completed.
  - Zod `todayQuerySchema` and `todayResponseSchema`.
  - No `list=today` on `GET /tasks`.
- Today count: extend story 5's `GET /api/w/:id/counts` (`routes/counts.ts`, db `countOpenTasks`). Response `{inbox, projects:{[id]:{open,total}}, today?}`; request `date` is **optional** (D-31).
  - When present, add `today` (open, not deleted, `due_date <= date`, not in a deleted project), computed in the SAME single statement via `SUM(CASE ...)`.
  - When absent, omit the field. Invalid date: 400.
  - Extend `CountsSchema` and add `countsQuerySchema`.

**Web (architecture §12, binding)**
- Add `today(wsId, {date, includeCompleted})` to story 2's `apps/web/src/lib/queryKeys.ts` → `['ws', wsId, 'today', {...}]`; serialise to `include_completed=true|false`.
- `useTodayQuery` + exported `todayQueryOptions` with `keepPreviousData`.
- The counts key stays `['ws', wsId, 'counts']` with NO date. Change only story 5's counts `queryFn` to append `?date=${getLocalDateSnapshot()}`.
- **Prefetch (D-39):** add the today query (for the Today child route) and the dated counts inside story 5's `prefetchWorkspaceData(wid)` in `apps/web/src/routes/workspaceLoader.ts`. Do NOT add a separate `Promise.all` in the Today route or `Workspace.tsx`.

**Verification:** `EXPLAIN QUERY PLAN` uses the index.

**Tests to satisfy:** unit splitToday; integration TC-12..TC-20, TC-45, TC-93, TC-95, TC-97..TC-99; ui-component TC-120, TC-136; e2e TC-86, TC-89, TC-94.

**Depends on:** task 2, task 5 (`getLocalDateSnapshot`), stories 2 (queryKeys), 5 (counts, `prefetchWorkspaceData`), 6 (`include_completed`) and 7 (projects).

### 4. Reschedule overdue (id-scoped) and version-guarded undo endpoints

**Reschedule endpoint**
`POST /api/w/:ws/tasks/reschedule` with `{ids (1..RESCHEDULE_MAX_IDS, unique), to}`.
- One `db.batch`: SELECT the eligible rows, then UPDATE them with RETURNING.
- Eligible means: id in `json_each(ids)`, same workspace, not deleted, open, and `due_date < to`.
- Response `{changed: [{id, previousDueDate, dueDate, version}], skipped: [ids]}`. Skipped ids are not distinguished, so existence isn't leaked.

**Restore endpoint**
`POST /api/w/:ws/tasks/due-dates/restore` with `{items: [{id, dueDate, expectedVersion}]}`.
- `UPDATE ... FROM json_each`, joined on id and version, with RETURNING.
- Then classify the skipped rows as `changed` or `gone`.

**Both endpoints**
- Register the literal paths before `/:taskId`.
- Story 1's pipeline: missing client header → 403; **non-JSON body → 415** (D-21).
- When rows changed, call story 4's `broadcast(c, wid, {type:'tasks.bulk', ids, originClientId})` exactly once — **ids only, no entities, no `deleted`** (D-25), no direct `room.broadcast`, no extra `waitUntil` (D-26).
- On batch failure, return 500 with zero partial writes.
- Never auto-retried by story 10's retry predicate (D-24); a 429 surfaces as an error toast.

**Web: `useReschedule.ts`**
- Mutations whose `onMutate` snapshots the today and counts caches, with rollback.
- Wrap the optimistic cache write in `startTransition` (architecture §12).
- Pure helper `rescheduleResultToUndoItems`.
- Undo via story 6's `showUndoToast({message, onUndo})` (D-41): `UNDO_WINDOW_MS = 10_000`, pauses on hover and focus, ⌘/Ctrl+Z.
- `onUndo` checks `useCanEdit()`'s snapshot (D-10) and sends nothing while offline.
- The confirmation gate and focus fallback are in task 7, not here.

**Before relying on `json_each`:** verify it in TC-58. If unsupported, fall back to chunked `IN (...)` statements of `D1_MAX_BOUND_PARAMS` in the same `db.batch`, and record the finding.

**Tests to satisfy:** unit TC-62 + schema rejects; integration TC-47..TC-61, TC-63, TC-130, TC-131; ui-component TC-73..TC-76, TC-119, TC-134; e2e TC-88.

**Depends on:** stories 1, 4 (`broadcast`, `useCanEdit`) and 6 (`showUndoToast`).

### 5. Local-date clock store and useLocalDate with midnight rollover

Build a module-level store for `useSyncExternalStore`.

**Store behaviour**
- The snapshot is a primitive `LocalDate`.
- While at least one subscriber exists, keep exactly one timeout at `msUntilNextLocalMidnight(now) + MIDNIGHT_SLACK_MS`, and one deduplicated `visibilitychange` + `focus` listener pair.
- On each trigger, recompute `localDateOf(new Date())`, notify subscribers only if it changed, then reschedule.
- Tear everything down when the last subscriber leaves.

**Exports**
- `useLocalDate` = `useSyncExternalStore(subscribe, getSnapshot)`.
- `getLocalDateSnapshot()`, for `queryFn`s and story 5's `prefetchWorkspaceData` outside React.

**New hook `useClockInvalidation(workspaceId)`**
- Mounted once in the workspace route.
- An effect used only to subscribe and unsubscribe, keyed on the primitive `workspaceId`.
- When the date changes, it calls `invalidateQueries({queryKey: queryKeys.counts(workspaceId)})`. The counts key carries no date (architecture §12, D-31).

**Server test clock (D-35)**
- `apps/api/src/lib/testClock.ts` `serverNow(env)`: returns `new Date(env.TEST_NOW)` only when `env.ENVIRONMENT === 'local'` and `TEST_NOW` is set; otherwise real time. It is the only reader of `TEST_NOW`.
- Declare `TEST_NOW?` in `env.ts`; set it only in local wrangler/vitest config. Record it in story 1's `/test/*` registry as **local only**.

**Consumers:** DateChip, useTodayQuery, the counts `queryFn`, `prefetchWorkspaceData`, the QuickAdd `defaultDueDate`, RescheduleButton and the picker's shortcut labels.

**Tests to satisfy:** unit TC-81..TC-84, TC-133; ui-component TC-85, TC-120; e2e TC-90.

**Depends on:** task 1, stories 1 (test registry) and 2 (queryKeys).

### 6. Date picker (openDatePicker, overlay-scoped keys) and relative date chip in task rows, quick add and the detail sheet

Run `bunx shadcn@latest add calendar popover` (and dialog/sheet only if story 2 has not), and import the components directly (no barrels).

**`openDatePicker(taskId, {returnFocusTo, anchor?})`** (D-05) in `features/dates/openDatePicker.ts`, rendered by `DatePickerHost.tsx` (mounted once in the workspace route):
- With `anchor`: shadcn Popover beside it.
- Without `anchor` (story 11's Finder): centred Dialog on desktop; bottom sheet when story 5's `useIsNarrow()` is true. Title 'Set due date'.
- On close focus goes to `returnFocusTo`; if it is gone, to the nearest surviving container heading (§12, D-19).
- Gated by `useCanEdit()` (D-10): no-op offline; an open panel disables its options.

**`picker/DueDatePickerPanel.tsx`** (D-43 path; the only place `date-fns` may be imported, per story 2's lint rule)
- Loaded via story 2's `lib/lazyWithRetry.ts` — **do not create it** (D-42). Preload on trigger pointerenter/focus.
- If the chunk fails: toast "Couldn't open the date picker — try again"; next open retries.
- Shortcuts in order: 'Today · Fri 25 Sep', 'Tomorrow · …', 'This weekend · …', 'Next week · …', 'No date', then the month grid; accessible names include the full date.
- **Overlay-scoped keys (D-14):** push a scope onto story 5's overlay scope stack on open, pop on close. T/M/W/N/0 (`SHORTCUT_KEYS`), arrows, PageUp/PageDown, Home/End and Enter are handled in the panel's `onKeyDown` only — never registered globally. While open, M must NOT reach story 7's Move to…, nor any other global/grid shortcut. Escape closes and calls `stopPropagation()` so the surface underneath (quick add, detail sheet, Finder) stays open. List the picker keys in the `?` panel via static `describeShortcut()` entries.

**`DueDateField.tsx`**: form trigger + panel for quick add and the detail sheet.

**D key: `useDateShortcut`**
- Register `useGlobalShortcut({key:'d', scope:'grid', description:'Set due date'})` (story 5's D-14 API).
- Handler: `getFocusedTaskId()` from story 5's `useTaskGrid` (D-04); with an id and `canEdit`, `openDatePicker(id, {returnFocusTo: focused cell, anchor: that row's date-chip slot})`; otherwise nothing.

**`DateChip.tsx`** (D-43)
- Props `{due, taskId?}`, `memo`, `chipLabel` + `useLocalDate`; `srLabel` is the accessible name; overdue warning icon (per-icon deep import, `aria-hidden`, hoisted).
- Rendered into the **date-chip slot of story 5's `TaskSummary` in cell 2** (D-01). With `taskId` it is a `<button>` sibling of the name button that opens the picker anchored to itself — **never nested in another control**. Without `taskId` it is a plain span (story 11 result rows).
- Tones: add `chipOverdue`, `chipToday`, `chipTomorrow`, `chipNeutral` (light + dark) to story 2's `packages/shared/src/tokens.ts`; `styles/tokens.css` is generated by story 2's generator — do not hand-edit (D-42).

**Wiring into story 5 and 6 extension points (no new `TaskRow` props, D-06)**
- `TaskSummary` date-chip slot: `<DateChip due taskId>` when `task.dueDate` is set.
- **QuickAdd**: story 5's target `{kind:'inbox'} | {kind:'project', projectId}` plus `defaultDueDate?` (D-40). Embed `DueDateField`. When the chosen date isn't today on the Today route, toast 'Added to Inbox'. (Today view passes the props — task 7.)
- **`features/tasks/TaskDetailSheet.tsx`** (story 6, D-43): add `DueDateField`; PATCH via story 6's mutation; 410 closes the sheet with a toast.

**Tests to satisfy:** ui-component TC-64..TC-69, TC-77, TC-78, TC-96, TC-111..TC-115, TC-127, TC-128, TC-134, TC-137; unit TC-110; e2e TC-86, TC-87, TC-92, TC-125, TC-126.

**Depends on:** tasks 1, 2 and 5; stories 2 (`lazyWithRetry`, tokens, lint), 4 (`useCanEdit`), 5 (`TaskGrid`/`TaskSummary` slots, `useTaskGrid`, `shortcuts.ts` scopes, `useIsNarrow`, QuickAdd) and 6 (`TaskDetailSheet`).

### 7. Today view as one TaskGrid (Overdue/Today rowgroups), Reschedule + Undo, project tags, sidebar badge and live refresh

**Route (D-12)**
- Register child route `/w/:workspaceId/today` in story 2's `apps/web/src/App.tsx`, TodayView loaded with story 2's `lazyWithRetry` (D-42). Links use `workspacePath(wid, 'today')`. Not-found renders via story 2's `ApiErrorBoundary`.
- `TodayNavItem` is a `<Link>`, so reload and back/forward work.

**TodayView (D-01)**
- `<h1 id="today-title" tabIndex=-1>Today</h1>`, then **one story-5 `TaskGrid`** with `aria-labelledby="today-title"`, rendering `useDeferredValue(useTodayQuery(localDate).data)`. No listbox/option roles.
- Two rowgroups via `TaskGrid`'s rowgroup extension point, each with a header row:
  - **Overdue** (only when non-empty): 'Overdue' + warning icon, count, Reschedule button.
  - **Today**: 'Today · <weekday d month>'.
- Rows: story 5's memoised `TaskRow` (`task`, `localStatus?` only, D-06). Fill `TaskSummary`'s cell-2 slots with `DateChip` (task 6) and `ProjectTag` (colour dot + name, or 'Inbox'; display-only). Chip trigger is a sibling of the name button, never nested. Offline gating of the row cells is story 5's (checkbox, `…` mutating items, Retry and mutating keys off; name button and Discard on).
- Per-row `content-visibility` comes from story 5's `styles/rows.css` (D-07) — use it, do not create or modify it.
- Keyboard/focus from story 5's `useTaskGrid` (D-02, D-04), incl. `focusAfterRemoval` for own and remote removals.
- Quick add after the grid, in AppShell's `quickAddSlot` (via story 5's `WorkspaceLayout` and `QuickAddContext`): story 5's QuickAdd with `target={kind:'inbox'}` + `defaultDueDate=useLocalDate()` (D-40); chip reads '→ Inbox · Today'. Its input stays typeable offline; only its submit is self-gated via `useCanEdit()`.
- Empty state 'All clear for today'; loading skeletons; inline retry on error. Derive rowgroups in render; ternaries.
- `TodayTitle`: React 19 `<title>` '(N) Today · <name>' / 'Today · <name>'; never read the secret.

**Reschedule**
- ids = rendered Overdue ids; `to` = `useLocalDate()`.
- ≥ `RESCHEDULE_CONFIRM_MIN` → lazy `RescheduleConfirm` (AlertDialog via `lazyWithRetry`, preloaded on hover/focus): 'Move N overdue tasks to today?'. Cancel/Escape send nothing and return focus to the button; Escape `stopPropagation` and overlay scope push/pop (D-14). The Reschedule button and Move are self-gated via `useCanEdit()` (D-10).
- 1 id → move immediately.
- Optimistic move in `startTransition`, rollback + toast on failure.
- **Focus fallback (D-19):** when the Overdue rowgroup unmounts, focus the Today heading.
- On success `showUndoToast({message, onUndo})` (D-41); skipped-undo toast + refetch.

**Sidebar badge:** `TodayNavItem` in story 5's Sidebar `todaySlot` and the mobile drawer; `countsQuery(wsId)` `select(c => c.today)`, hidden when 0/absent/errored; NO separate request. Hover/focus preloads the chunk.

**Live updates:** `registerTodayHandlers.ts` via story 4's `registerLiveHandler` for task.upserted, task.deleted, task.restored, tasks.bulk, project.deleted, project.restored. Skip own echoes; debounce-invalidate `['ws', wsId, 'today']` (`TODAY_INVALIDATE_DEBOUNCE_MS`). `tasks.bulk {ids}` → **refetch, never patch** (D-25). Do NOT edit `applyEvent.ts`.

**Optimistic cache patches:** complete/delete/reschedule patch today + counts via `setQueriesData`.

**Virtualization contingency:** only if TC-94 or TC-118 fails, `@tanstack/react-virtual` inside the rowgroups with story 5's `aria-rowcount`, focus via `useTaskGrid` + `scrollToIndex`.

**Tests to satisfy:** ui-component TC-70..TC-80, TC-85, TC-116, TC-117, TC-119, TC-121, TC-122, TC-124, TC-129, TC-132, TC-134, TC-135; e2e TC-86..TC-91, TC-94, TC-118, TC-123, TC-125 (axe now expected to pass without exclusions).

**Depends on:** tasks 3, 4, 5, 6; stories 2 (`App.tsx`, `lazyWithRetry`, `ApiErrorBoundary`), 4, 5 (`TaskGrid`, `useTaskGrid`, `rows.css`, QuickAdd, Sidebar), 6 (`showUndoToast`), 7.

### 8. Unit tests: date logic, schemas, today split, undo mapping, clock store

Implement these unit cases. None of them do I/O.

**TC ids covered:** TC-01..TC-11, TC-21..TC-35, TC-62, TC-81..TC-84, TC-101..TC-110, TC-133, plus splitToday and schema-reject cases.

**Date logic** (`packages/shared/test/`)
- TC-01..TC-11: classification and chip text/tone/icon across UTC, Pacific/Kiritimati and Etc/GMT+12. One file per timezone, `process.env.TZ` set before import (story 1's forks pool, D-36).
- TC-21..TC-35: validation bounds, leap day, year boundary, nextWeek, DST 23h/25h days.
- TC-101..TC-107: thisWeekend, nextWeek and tomorrow for every weekday of 2026-09-21..27.
- TC-108: `formatShortcutDate` labels and the year boundary.
- TC-109: 'Yesterday' / 'N days overdue', `showWarningIcon`, `srLabel`.

**Server and schemas**
- `splitToday`: equivalence classes and ordering.
- TC-62: `rescheduleResultToUndoItems`.
- Schema rejects for reschedule and restore (empty, oversize, duplicate ids, bad date) and for `todayQuerySchema` (`include_completed` other than `true|false`).
- TC-133 (`apps/api/test/unit/testClock.test.ts`): `serverNow(env)` honours `TEST_NOW` only when `ENVIRONMENT='local'`; staging/production return real time.

**Web**
- TC-110 (`apps/web/test/dates/tokens.test.ts`): run story 2's contrast checker over the chip entries this story adds to `packages/shared/src/tokens.ts`, light and dark, each ≥ 4.5; assert the generated `tokens.css` contains the four `--chip-*` variables.
- TC-81..TC-84: clock store with fake timers: rollover, hidden-tab `visibilitychange`, listener dedupe, teardown.

### 9. Integration tests: due date API, Today query, reschedule/undo, migration, performance

**Harness:** vitest-pool-workers with `SELF.fetch`, real Miniflare D1 (migrations 0001–0004), and the real WorkspaceRoom DO with a test WebSocket client to assert broadcasts; spy on story 4's `broadcast` helper. Local only (`TEST_NOW` available here, D-35).

**TC ids covered:** TC-12..TC-20, TC-36..TC-61, TC-63, TC-93, TC-95, TC-97..TC-100, TC-130, TC-131.

**Cases**
- TC-12..TC-20: membership; exclusion of completed, deleted and deleted-project tasks; project context; isolation. TC-14/TC-15 use `include_completed` omitted / `=true` (D-31).
- TC-36..TC-46 and TC-100: PATCH/POST `dueDate` with client ids; idempotent retry; null clear; invalid date; 410; 404 across workspaces and with no cookie; migration preserves story 5's rows. TC-45 includes `include_completed=1` → 400.
- TC-130: PATCH/create/reschedule/restore with a non-JSON body → **415 `unsupported_media_type`** (not 403, D-21); without `X-Todoodle-Client` → 403; rows and broadcasts unchanged.
- TC-97..TC-99: counts `?date` adds `today`; omitted without a date; invalid date 400.
- TC-47..TC-61 and TC-63: reschedule scope; skipped classes; bounds; atomicity; undo restored / changed / gone. **Run TC-58 first** (proves `json_each` in D1; else switch task 4 to its fallback).
- TC-131: reschedule and restore each emit exactly one `{type:'tasks.bulk', ids, originClientId}` with no entity fields and no `deleted` (D-25), via `broadcast(c, wid, event)` only (D-26).
- TC-93: 5,000 open tasks via story 5's bulk `/test/seed` with `dueDate`; p95 < 300 ms; `EXPLAIN QUERY PLAN` uses `idx_tasks_ws_due`.
- TC-95: server clock faked to 2030 via local-only `TEST_NOW`; missing date → 400.

**Assertions:** every mutating case checks row state before and after, and broadcast presence and payload.

**Fixtures:** as described in the design's "Fixture realism" section; no `/test/sql`.

### 10. UI-component tests: date picker, chip, Today view, reschedule/undo, sidebar badge, rollover

Environment: vitest + happy-dom + Testing Library + MSW, fake timers at Fri 2026-09-25. Live events via the real story 4 registry; `useCanEdit` via the real story 4 store; shortcuts via the real story 5 registry and overlay scope stack.

**TC ids covered:** TC-64..TC-80, TC-85, TC-96, TC-111..TC-117, TC-119..TC-122, TC-124, TC-127..TC-129, TC-132, TC-134..TC-137.

**Picker and chip**
- TC-64..TC-69: shortcut click, No date, grid keyboard, chip labels/tones/icons, PATCH 500 rollback, 410 toast (TaskDetailSheet).
- TC-111, TC-112: shortcut labels; T/M/W/N/0.
- TC-113: D with a focused grid row (`useTaskGrid`), inside an input, and with focus outside any grid; `?` panel entry.
- TC-114: story 2's `lazyWithRetry` failure then success.
- TC-115: overdue not colour alone. TC-96: shortcut letters typed in inputs.
- **TC-127 (D-14): picker open → press M selects tomorrow and does NOT open Move to… (`openMovePicker` spy not called); no global/grid handler fires while open; Escape `stopPropagation` keeps quick add underneath open.**
- TC-128 (D-05): unanchored `openDatePicker` → centred dialog (desktop) / bottom sheet (`useIsNarrow`); focus to `returnFocusTo`, heading fallback if gone.
- TC-134 (D-10): `canEdit` false — D, chip, open panel, Reschedule, confirm Move and ⌘Z undo send nothing; read-only rendering remains.
- TC-137 (D-40): QuickAdd on Today shows '→ Inbox · Today'.

**Today view**
- TC-70..TC-80: rowgroups with the Overdue header icon, empty states, project tags; reschedule confirm + optimistic move + exact body + `showUndoToast({message,onUndo})`; 500 rollback; skipped-undo toast; 10,000 ms expiry; quick add `target={kind:'inbox'}` + `defaultDueDate`; badge single counts request; live invalidation.
- TC-116, TC-117: 1 overdue no confirm; 7 overdue Cancel/Escape send nothing, focus returns to the button.
- TC-119: undo pause, ⌘Z, `role=status`.
- TC-121: story 5's per-row content-visibility class on each row, not rowgroups; no story-8 `rows.css`.
- TC-122: tab title; no secret.
- TC-124: registry keeps other handlers; own echo ignored.
- TC-129 (D-19): after reschedule the Today heading has focus.
- TC-132 (D-25): `tasks.bulk {ids}` invalidates today, never patches.
- TC-135 (D-01): one `role=grid` labelled by the Today heading; Overdue/Today rowgroups with header rows; chip and project tag in cell 2; chip trigger has no interactive ancestor; no listbox/option.

**Clock, counts and prefetch**
- TC-85: midnight rollover. TC-120: counts key dateless; snapshot date sent; one refetch at rollover.
- TC-136 (D-39): `prefetchWorkspaceData` issues today + counts in parallel; TodayView mount adds no duplicate requests.

### 11. E2E tests: set date, Today, reschedule+undo, cross-timezone viewers, midnight, live, performance

Playwright against local wrangler dev, seeded via story 5's `/test/seed` (with `tasks[].dueDate`, D-35). Projects per story 1's matrix (D-36): `chromium` and `webkit` desktop for every spec; specs tagged `@mobile` also run on `mobile-webkit` and `mobile-chromium`. Use `timezoneId` and `page.clock` per context.

**TC ids covered:** TC-86..TC-92, TC-94, TC-118, TC-123, TC-125, TC-126.

**Workflows**
- TC-86: set a date in the task detail sheet, then check Today and the badge (Europe/London, 2026-09-25T09:00).
- TC-87 `@mobile`: quick add from Today (FAB on phones); chip reads '→ Inbox · Today'.
- TC-88: reschedule 3 overdue — confirm shows 3; Move; focus lands on the Today heading; Undo restores dates (verified in the project view).
- TC-89: London vs Pacific/Kiritimati at 2026-09-25T11:00Z.
- TC-90: `page.clock` at 23:59:30, `runFor` 60 s; rollover without reload; badge and title update.
- TC-91: collaborator clears a date; gone within `LIVE_UPDATE_TARGET_MS`.
- TC-92: No date clears the chip.
- TC-123: `/w/<id>/today` survives reload and back/forward.
- TC-125: axe-core on Today with overdue rows and with the picker open — **no serious or critical violations and no rule exclusions** (incl. `nested-interactive`, `aria-required-children`, `aria-required-parent`); now expected to pass because Today is a grid (D-01).
- TC-126: keyboard only — Tab into the Today grid, arrow to a task, D, N; chip reads 'Monday'; focus back on the row's cell.

**Performance**
- TC-94: 5,000-task seed; Today interactive < 500 ms.
- TC-118: 2,000 Today rows; 30 keystrokes in quick add during a 500-task reschedule and a live `tasks.bulk`; each event duration < 100 ms. Failure triggers task 7's virtualization contingency.

Firefox is declared not covered.

