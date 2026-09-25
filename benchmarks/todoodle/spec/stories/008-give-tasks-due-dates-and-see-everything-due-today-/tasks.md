# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Shared local-date logic: validation, arithmetic, classification, chip labels, midnight | proposed | implementation | dates.local_date_logic |
| 2 | Store due dates on tasks: migration 0004, create/update accept dueDate, broadcast | proposed | implementation | dates.due_date_field |
| 3 | Today query endpoint and Today count on the shared counts endpoint | proposed | implementation | today.query |
| 4 | Reschedule overdue (id-scoped) and version-guarded undo endpoints | proposed | implementation | today.reschedule |
| 5 | Local-date clock store and useLocalDate with midnight rollover | proposed | implementation | ui.midnight_rollover |
| 6 | Date picker and relative date chip in quick add, task detail and task rows | proposed | implementation | ui.date_picker |
| 7 | Today view with Overdue group, Reschedule + Undo, project tags, sidebar badge and live refresh | proposed | implementation | ui.today_view |
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
- `SHORTCUT_KEYS`: frozen `{t, m, w, n, '0'}`.
- `dayOffset`.
- `classify`.
- `chipLabel`, returning `{text, tone, srLabel, showWarningIcon}`: 'Yesterday' / 'N days overdue' with the icon; srLabel 'Overdue: due <full date>'.
- `formatShortcutDate` ('Sat 26 Sep'), using cached Intl formatters.
- `msUntilNextLocalMidnight`.

Add constants to `limits.ts` (no magic numbers): DUE_DATE_MIN_YEAR, DUE_DATE_MAX_YEAR, CHIP_WEEKDAY_MAX_OFFSET, RESCHEDULE_MAX_IDS, TODAY_INVALIDATE_DEBOUNCE_MS, MIDNIGHT_SLACK_MS, RESCHEDULE_CONFIRM_MIN, WEEKDAY_SATURDAY, WEEKDAY_SUNDAY, WEEKDAY_MONDAY, DAYS_PER_WEEK, D1_MAX_BOUND_PARAMS.

Export `localDateSchema` from `schemas.ts`.

No date library in this package; `date-fns` is allowed only in the lazy picker chunk (architecture section 12).

Depends on the story 1 layout and on story 6's `dates.ts`. If story 6 hasn't landed yet, create the file with the same cached-formatter structure.

### 2. Store due dates on tasks: migration 0004, create/update accept dueDate, broadcast

Write migrations/0004_task_due_date.sql: ALTER TABLE tasks ADD COLUMN due_date TEXT; CREATE INDEX idx_tasks_ws_due ON tasks(workspace_id, deleted, completed_at, due_date). No CHECK. Must pass story-1 migration safety scan. Extend story-5 createTaskSchema (client-generated id already required) and story-6 updateTaskSchema with dueDate: localDateSchema.nullable().optional(); taskSchema gains dueDate. Update apps/api/src/db/tasks.ts column list, mapper, insert, update (version+1, updated_at) and include due_date in story-5's idempotent-create comparison so a retry with the same id+body returns the existing task (409 id_conflict rule unchanged). Existing POST/PATCH handlers pass dueDate through; 410 gone for soft-deleted, 404 for other workspace, broadcast task.upserted via ctx.waitUntil. /test/seed accepts dueDate. Depends on stories 1, 2, 4, 5, 6.

### 3. Today query endpoint and Today count on the shared counts endpoint

**Server**
- Add `GET /api/w/:workspaceId/today?date=&includeCompleted=` under workspace-auth.
  - `date` is required: 400 if missing or invalid. Never default to the server clock.
  - `db.listDueOnOrBefore`: a single SELECT with LEFT JOIN projects (`p.deleted = 0`). It excludes tasks in deleted projects and uses `idx_tasks_ws_due`.
  - Pure `splitToday(rows, date)` in `apps/api/src/today/split.ts`, one pass, into overdue (`due_date ASC, sort_order ASC`), today and completed.
  - Zod `todayQuerySchema` and `todayResponseSchema`.
- Today count: extend story 5's `GET /api/w/:id/counts` (`routes/counts.ts`, db `countOpenTasks`) with an optional `?date`.
  - When present, add `today` (open, not deleted, `due_date <= date`, not in a deleted project), computed in the SAME single statement via `SUM(CASE ...)`.
  - When absent, omit the field.
  - Invalid date: 400.
  - Extend `CountsSchema` and add `countsQuerySchema`.

**Web (architecture section 12, binding)**
- Add `today(wsId, {date, includeCompleted})` to `apps/web/src/lib/queryKeys.ts`, giving `['ws', wsId, 'today', {...}]`.
- `useTodayQuery` uses `keepPreviousData`.
- The counts key stays `['ws', wsId, 'counts']` with NO date. Change only story 5's counts `queryFn`, so it appends `?date=${getLocalDateSnapshot()}`. Callers and `setQueryData` writes in stories 5 and 7 are unchanged. This reverts the earlier `{date}` key variant.
- The Today route prefetches today and counts with `Promise.all`.

**Verification:** check that `EXPLAIN QUERY PLAN` uses the index.

**Depends on:** task 2, task 5 (for `getLocalDateSnapshot`), and stories 2 (queryKeys), 5 (counts) and 7 (projects).

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
- Broadcast one `tasks.bulk`, only when rows changed.
- On batch failure, return 500 with zero partial writes.

**Web: `useReschedule.ts`**
- Mutations whose `onMutate` snapshots the today and counts caches, with rollback.
- Wrap the optimistic cache write in `startTransition` (architecture section 12).
- Pure helper `rescheduleResultToUndoItems`.
- Undo goes through story 6's `features/undo/showUndoToast.ts`: `UNDO_WINDOW_MS = 10_000`, pauses on hover and focus, ⌘/Ctrl+Z.
- The confirmation gate is in task 7, not here.

**Before relying on `json_each`:** verify it works in D1 in the integration tests (TC-58). If it doesn't, fall back to chunked `IN (...)` statements of `D1_MAX_BOUND_PARAMS` within the same `db.batch`, and record the finding.

**Depends on:** stories 4 and 6.

### 5. Local-date clock store and useLocalDate with midnight rollover

Build a module-level store for `useSyncExternalStore`.

**Store behaviour**
- The snapshot is a primitive `LocalDate`.
- While at least one subscriber exists, keep exactly one timeout at `msUntilNextLocalMidnight(now) + MIDNIGHT_SLACK_MS`, and one deduplicated `visibilitychange` + `focus` listener pair.
- On each trigger, recompute `localDateOf(new Date())`, notify subscribers only if it changed, then reschedule.
- Tear everything down when the last subscriber leaves.

**Exports**
- `useLocalDate` = `useSyncExternalStore(subscribe, getSnapshot)`.
- `getLocalDateSnapshot()`, for `queryFn`s outside React.

**New hook `useClockInvalidation(workspaceId)`**
- Mounted once in the workspace shell.
- An effect used only to subscribe and unsubscribe, keyed on the primitive `workspaceId`.
- When the date changes, it calls `invalidateQueries({queryKey: queryKeys.counts(workspaceId)})`. The counts key carries no date (architecture section 12), so this is what refreshes the badge and title at midnight.

**Consumers:** DateChip, useTodayQuery, the counts `queryFn`, the QuickAdd default date, RescheduleButton and the picker's shortcut labels.

**Depends on:** task 1, and story 2 (queryKeys).

### 6. Date picker and relative date chip in quick add, task detail and task rows

Run `bunx shadcn@latest add calendar popover`, and import the components directly (no barrels).

**`DueDatePicker`**
- The trigger loads eagerly.
- `DueDatePickerPanel` loads via `lazyWithRetry` in `apps/web/src/lib/lazyWithRetry.ts`, which clears a rejected import so the next open retries. The panel uses react-day-picker and `date-fns` subpath imports, and nothing else uses `date-fns`.
- Preload the panel on the trigger's pointerenter and focus.
- If the chunk fails to load, show the toast "Couldn't open the date picker — try again".

**Shortcuts** (from `shortcutDates` and `formatShortcutDate`, derived during render):
- In order: 'Today · Fri 25 Sep', 'Tomorrow · …', 'This weekend · …', 'Next week · …', 'No date', then the month grid.
- Keys handled in the panel's `onKeyDown`: T, M, W, N and 0 via `SHORTCUT_KEYS`; arrow keys, PageUp/PageDown and Home/End in the grid; Enter picks; Escape closes.
- Picking anything calls `onChange` once and closes.
- Focus returns to the trigger, or to the row when the picker was opened with D.
- Accessible names include the full resolved date.

**D key: `useDateShortcut`**
- Mount it once in the workspace shell.
- Register via story 5's `useGlobalShortcut('d', …, {description: 'Set due date'})`.
- It is ignored while typing.
- It opens the picker for the task selected by story 5's roving-focus ref, anchored to the row's chip slot.
- With nothing selected, it does nothing.

**`DateChip`**
- `memo` with primitive props.
- Uses `chipLabel` + `useLocalDate`.
- `srLabel` is the accessible name.
- Overdue chips add a warning icon (per-icon `lucide-react` import, `aria-hidden`, hoisted as static JSX).
- Tone classes come from the CSS tokens in `apps/web/src/styles/tokens.css` (`--chip-overdue`, `--chip-today`, `--chip-tomorrow`, `--chip-neutral`), for light and dark, with at least 4.5:1 contrast.

**Wiring into story 5 and 6 components**
- **QuickAdd**, including the mobile "+" button: on the `/today` route, default to today with the Inbox as target. When the chosen date isn't today, show the toast 'Added to Inbox'.
- **TaskDetail**: PATCH via the existing mutation. A 410 closes the detail with a toast.
- **TaskRow**: show the chip plus a chip slot for the D-opened picker.

**Depends on:** tasks 1, 2 and 5, and stories 5 (`useGlobalShortcut`, roving focus, FAB) and 6.

### 7. Today view with Overdue group, Reschedule + Undo, project tags, sidebar badge and live refresh

**Route**
- Add `/w/:workspaceId/today` to the React Router config (stories 5 and 7), with TodayView loaded by `lazy` at route level.
- `TodayNavItem` is a `<Link>` to that route, so reload and back/forward work.

**TodayView**
- Render from `useDeferredValue(useTodayQuery(localDate).data)`.
- Derive the sections during render; no effect-synced state.
- Rows use the memoised story 5 `TaskRow`, with the `row-cv` class from `apps/web/src/styles/rows.css`: `content-visibility: auto; contain-intrinsic-size: auto 44px`. Put it ON EACH ROW, never on a section container.
- Use ternary conditionals.
- Empty state: 'All clear for today'. Loading: skeleton rows. Errors: inline retry.
- `TodayTitle` renders the React 19 `<title>`: '(N) Today · <workspace name>', or 'Today · <name>' when N is 0. N comes from the counts select and the name from `queryKeys.workspace`. Never read the secret here.

**OverdueSection**
- Heading 'Overdue' with the warning icon, the count, and the Reschedule button.

**RescheduleButton**
- ids = the overdue ids currently rendered; `to` = `useLocalDate()`.
- If there are `RESCHEDULE_CONFIRM_MIN` (2) or more ids, open the lazy `RescheduleConfirm` (shadcn AlertDialog, preloaded when the button is hovered or focused): 'Move N overdue tasks to today?' with Move / Cancel. Cancel or Escape sends nothing.
- With exactly 1 id, move immediately.
- The optimistic move runs inside `startTransition`, with rollback and an error toast on failure.
- On success, call `showUndoToast` (10 s, pausable, ⌘Z).
- If the undo response has skipped items, show that toast and refetch.

**ProjectTag**
- Colour dot and name, or 'Inbox'. Primitive props.

**Quick add in Today**
- Uses story 5's client-generated-id create, with `dueDate` = the local date.

**Sidebar badge**
- Render `TodayNavItem` into story 5's Sidebar `todaySlot` and into the mobile drawer.
- Badge = `countsQuery(wsId)` with `select(c => c.today)`, hidden when 0, absent or errored. NO separate request.
- Hover or focus preloads the chunk and prefetches today and counts in parallel.

**Live updates**
- `registerTodayHandlers.ts` uses story 4's `registerLiveHandler` for task.upserted, task.deleted, task.restored, tasks.bulk, project.deleted and project.restored. Do NOT edit `applyEvent.ts`.
- Handlers skip their own echoes and debounce-invalidate `['ws', wsId, 'today']` (`TODAY_INVALIDATE_DEBOUNCE_MS`).
- Counts invalidation comes from the story 5 and 7 handlers.

**Optimistic cache patches**
- Completing, deleting or rescheduling from Today patches the today and counts caches optimistically, using `setQueriesData`.

**Virtualization contingency**
- Only if TC-94 or TC-118 fails, switch the rows to `@tanstack/react-virtual`, keeping roving focus via `scrollToIndex`.

**Depends on:** tasks 3, 4, 5 and 6, and stories 4, 5, 6 and 7.

### 8. Unit tests: date logic, schemas, today split, undo mapping, clock store

Implement these unit cases. None of them do I/O.

**Date logic** (`packages/shared/test/`)
- TC-01..TC-11: classification and chip text/tone/icon across UTC, Pacific/Kiritimati and Etc/GMT+12. Use one file per timezone, with `process.env.TZ` set before import.
- TC-21..TC-35: validation bounds, leap day, year boundary, nextWeek, and the DST 23h/25h days.
- TC-101..TC-107: thisWeekend, nextWeek and tomorrow for every weekday of 2026-09-21..27, including Saturday and Sunday resolving to today.
- TC-108: `formatShortcutDate` labels, and the year boundary.
- TC-109: overdue labels 'Yesterday' / 'N days overdue', `showWarningIcon`, and `srLabel`.

**Server and schemas**
- `splitToday`: equivalence classes and ordering.
- TC-62: `rescheduleResultToUndoItems`.
- Schema rejects for reschedule and restore: empty, oversize, duplicate ids, bad date.

**Web**
- TC-110 (`apps/web/test/dates/tokens.test.ts`): parse `tokens.css` and compute the WCAG contrast ratio of every chip token against the light and dark row backgrounds; each must be at least 4.5.
- TC-81..TC-84: clock store with `vi.useFakeTimers` / `setSystemTime` covering rollover, the hidden-tab `visibilitychange` path, listener dedupe and teardown.

### 9. Integration tests: due date API, Today query, reschedule/undo, migration, performance

**Harness:** vitest-pool-workers with `SELF.fetch`, real Miniflare D1 (migrations 0001–0004), and the real WorkspaceRoom DO with a test WebSocket client to assert broadcasts.

**Cases**
- TC-12..TC-20: membership; exclusion of completed, deleted and deleted-project tasks; project context; workspace isolation.
- TC-36..TC-46 and TC-100: PATCH/POST `dueDate` with client-generated ids; idempotent retry; null clear; invalid date; 410; 404 across workspaces and with no cookie; the migration preserves story 5's rows.
- TC-97..TC-99: counts `?date` adds the today field; the field is omitted without a date; an invalid date returns 400. The server contract is unchanged by the dateless client key.
- TC-47..TC-61 and TC-63: reschedule scope; skipped classes; bounds; atomicity; undo outcomes restored / changed / gone. **Run TC-58 first**: it proves `json_each` works in D1. If it doesn't, switch task 4 to its chunked fallback.
- TC-93: 5,000 open tasks seeded realistically; today and counts p95 < 300 ms; `EXPLAIN QUERY PLAN` uses `idx_tasks_ws_due`.
- TC-95: server-clock independence, with the Worker clock faked to 2030 and a missing date returning 400.

**Assertions:** every mutating case checks row state before and after, and whether a broadcast was sent.

**Fixtures:** as described in the design's "Fixture realism" section.

### 10. UI-component tests: date picker, chip, Today view, reschedule/undo, sidebar badge, rollover

Environment: vitest + happy-dom + Testing Library + MSW, fake timers set to Fri 2026-09-25. Live events go through the real story 4 registry.

**Picker and chip**
- TC-64..TC-69: shortcut click, No date, grid keyboard, chip labels/tones/icons, PATCH 500 rollback, 410 toast.
- TC-111: shortcut labels show the resolved date and accessible names.
- TC-112: T/M/W/N/0 keys.
- TC-113: D key with a selected row, inside an input, and with nothing selected; also the `?` panel entry.
- TC-114: `lazyWithRetry` failure then success.
- TC-115: overdue shown as text + icon + screen-reader label, not colour alone.
- TC-96: shortcut letters typed inside inputs.

**Today view**
- TC-70..TC-80:
  - groups with the overdue heading icon, empty states, project tags;
  - reschedule with 2 overdue tasks, including the confirm step, the optimistic move and the exact request body;
  - 500 rollback and the skipped-undo toast;
  - the undo window expires at 10,000 ms;
  - quick add with the client id, default date and the 'Added to Inbox' toast;
  - TodayNavItem badge makes exactly one counts request and hides on 0 or failure;
  - live invalidation.
- TC-116: a single overdue task moves with no confirm.
- TC-117: 7 overdue tasks — Cancel and Escape send nothing and change nothing; Move sends one request.
- TC-119: undo pauses on hover/focus, ⌘Z works, `role=status`.
- TC-121: `row-cv` on each row, not on sections.
- TC-122: tab title with N and 0; the secret never appears.
- TC-124: registry keeps other stories' handlers; own-echo is ignored.

**Clock and counts**
- TC-85: midnight rollover — the today key changes; counts are invalidated once with the same key.
- TC-120: the counts key has no date; the `queryFn` sends the snapshot date; rollover makes exactly one new request; story 5's `setQueryData` hits the same entry.

### 11. E2E tests: set date, Today, reschedule+undo, cross-timezone viewers, midnight, live, performance

Playwright against local wrangler dev, seeded via `/test/seed`.

**Workflows**
- TC-86: set a date in the detail panel, then check Today and the badge (`timezoneId` Europe/London, `page.clock` at 2026-09-25T09:00).
- TC-87: quick add from Today.
- TC-88: reschedule 3 overdue tasks. The confirm dialog must show 3; press Move, then Undo, and verify the original dates in the project view.
- TC-89: two contexts, London and Pacific/Kiritimati, at 2026-09-25T11:00Z. London shows the task in Today; Kiritimati shows it in Overdue as 'Yesterday' with the icon.
- TC-90: `page.clock` at 23:59:30 local, then `runFor` 60 s. Rollover must happen without a reload, and the badge and tab title must update.
- TC-91: a collaborator clears a date; it disappears within `LIVE_UPDATE_TARGET_MS`.
- TC-92: No date clears the chip.
- TC-123: the Today route survives reload and works with back/forward (`/w/<id>/today`).
- TC-125: axe-core finds no serious or critical violations on Today, both with overdue rows and with the picker open.
- TC-126: keyboard only — arrow to a task, press D, press N. The chip reads 'Monday' and focus returns to the row.

**Performance**
- TC-94: with the 5,000-task seed, Today is interactive in under 500 ms (measured with performance marks).
- TC-118: with 2,000 Today rows, type 30 characters in quick add during a 500-task reschedule and a live `tasks.bulk`. The `PerformanceObserver('event')` duration must stay under 100 ms per keystroke. If this fails, trigger the virtualization contingency in task 7.

Chromium only; other browsers are declared not covered.

