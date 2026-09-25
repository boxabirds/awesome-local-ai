# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Shared task schemas, Intl date helpers and undo/animation constants | proposed | implementation | tasks.edit, tasks.list_completed, tasks.complete, tasks.reopen |
| 2 | API: complete, reopen, soft delete and restore endpoints with idempotent no-ops and broadcasts | proposed | implementation | tasks.complete, tasks.reopen, tasks.delete, tasks.restore |
| 3 | API: PATCH task name/description with blank-name rule, and list with include_completed | proposed | implementation | tasks.edit, tasks.list_completed |
| 4 | Web: optimistic task mutation hooks, cache ops, busy state and live restored handler | proposed | implementation | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore, tasks.list_completed |
| 5 | Web: pausable 10 s undo toast, undo stack and Cmd/Ctrl+Z | proposed | implementation | ui.undo |
| 6 | Web: task row checkbox with completion feedback, actions menu without delete confirm, show-completed toggle, touch and keyboard | proposed | implementation | ui.task_actions |
| 7 | Web: lazy task detail sheet (full-screen on mobile) with inline edit, blank-name hint, edit guard and focus return | proposed | implementation | ui.task_detail |
| 8 | Unit tests: schemas, ordering, cache ops, restored handler, pausable undo, undo stack, focus target, preference codec, Intl dates, shortcut table | proposed | test:unit | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore, tasks.list_completed, ui.undo, ui.task_actions, ui.focus_management |
| 9 | Integration tests: complete/reopen/delete/restore state matrix, access, broadcasts, retention | proposed | test:integration | tasks.complete, tasks.reopen, tasks.delete, tasks.restore |
| 10 | Integration tests: PATCH edit validation and blank-name rule, list include_completed, last-write-wins | proposed | test:integration | tasks.edit, tasks.list_completed |
| 11 | UI component tests: row actions, completion feedback, no-confirm delete, pausable undo, Cmd/Ctrl+Z, focus, detail sheet, show completed, responsive and a11y | proposed | test:ui-component | ui.undo, ui.task_actions, ui.task_detail, ui.focus_management |
| 12 | E2E tests: complete/undo, reopen, edit, no-confirm delete/undo/retention, two-browser live, keyboard-only with focus, mobile touch, undo pause | proposed | test:e2e | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore, tasks.list_completed, ui.undo, ui.task_actions, ui.task_detail, ui.focus_management |
| 13 | Web: focus management after complete/delete and on detail close | proposed | implementation | ui.focus_management |

## Details

### 1. Shared task schemas, Intl date helpers and undo/animation constants

Depends on: story 5 shared Task type and schemas.

Plan:
1. schemas.ts: TaskPatchSchema (.strict(), refine at least one key, TASK_NAME_MAX / TASK_DESCRIPTION_MAX), resolvePatchedName, ListTasksQuerySchema + parseIncludeCompleted, optional EmptyBodySchema; confirm TaskSchema.completedAt nullable.
2. types.ts: MutationResult<T> union shared by API db modules.
3. orderTasks(tasks): open by sortOrder asc then completed by completedAt desc, ties by id.
4. dates.ts (NEW, extended later by story 8): formatCompletedDate(iso, locale) with Intl.DateTimeFormat instances cached in a module-level Map keyed by locale+options; invalid ISO -> ''. No date-fns.
5. limits.ts: UNDO_WINDOW_MS = 10_000 (owner decision 2026-09-25), COMPLETE_ANIMATION_MS = 250, NAME_HINT_MS = 3_000 (MOBILE_BREAKPOINT_PX, MIN_TOUCH_TARGET_PX already from architecture 12).

Done when TC-U01..TC-U07 and TC-U15 pass.

### 2. API: complete, reopen, soft delete and restore endpoints with idempotent no-ops and broadcasts

Depends on: stories 1 (request validation: bodyless mutations allowed, X-Todoodle-Client required, 415 on non-JSON body), 2 (workspace-auth), 4 (broadcast helper, event types incl. task.restored), 5 (tasks table/routes). No migration: columns exist in 0002_tasks.sql.

Plan:
1. apps/api/src/db/tasks.ts:
   - completeTask: UPDATE tasks SET completed_at=?, version=version+1, updated_at=? WHERE id=? AND workspace_id=? AND deleted=0 AND completed_at IS NULL RETURNING *. On 0 rows, classify via SELECT (missing / gone if deleted=1 / noop).
   - reopenTask: same shape guarded by completed_at IS NOT NULL, sets NULL.
   - softDeleteTask: guarded deleted=0; sets deleted=1, deleted_at, version+1. Already-deleted -> noop.
   - restoreTask: guarded deleted=1; sets deleted=0, deleted_at=NULL, version+1; preserves completed_at, sort_order. Not deleted -> noop. Guard makes concurrent restores a single change.
   - Never touch sort_order. Audit every other query includes deleted=0.
2. apps/api/src/routes/tasks.ts: lifecycleRoute(fn, eventType) mapping MutationResult -> 200 {task} | 204 (delete) | 404 not_found | 410 gone; on 'changed' ctx.executionCtx.waitUntil(broadcast(env, workspaceId, {type, entity, version, originClientId from X-Todoodle-Client-Id})). Routes: POST /complete, /reopen, /restore (body optional, JSON {} if present); DELETE /:taskId. No client surface ever confirms delete (owner decision 2026-09-25); the API is unaffected.
3. apps/api/src/routes/test.ts: GET /test/tasks/:id/raw (non-production) for e2e TC-E04.
4. docs/ops/recover-deleted-task.md: operator runbook.

Done when TC-I01..TC-I10, TC-I16..TC-I25, TC-I41..TC-I46, TC-I48..TC-I50 pass.

### 3. API: PATCH task name/description with blank-name rule, and list with include_completed

Depends on: task 6.1 (TaskPatchSchema, resolvePatchedName, ListTasksQuerySchema, orderTasks), story 5 list route, story 1 validation middleware (415 for non-JSON body).

Plan:
1. apps/api/src/db/tasks.ts updateTask(db, ws, id, patch, now): SELECT current (classify missing/gone); compute effective values (name via resolvePatchedName, description as-is); nothing differs -> noop; else UPDATE SET name, description, version=version+1, updated_at WHERE id AND workspace_id AND deleted=0 RETURNING *. 0 rows (deleted concurrently) -> gone.
2. listTasks(db, ws, {includeCompleted}): WHERE workspace_id=? AND deleted=0 [AND completed_at IS NULL unless includeCompleted] ORDER BY (completed_at IS NOT NULL), sort_order, completed_at DESC, id; filter object param so story 7's project scope composes.
3. apps/api/src/routes/tasks.ts: PATCH /:taskId with zod validation (400 validation with issues); 200 {task}; broadcast task.upserted only on changed. GET list parses include_completed -> 400 on bad value.
4. Last-write-wins: no version precondition (architecture 7).

Done when TC-I11..TC-I15, TC-I26..TC-I40, TC-I44, TC-I47 pass.

### 4. Web: optimistic task mutation hooks, cache ops, busy state and live restored handler

Depends on: tasks 6.2/6.3 (API), 6.1 (shared), story 2 queryKeys.ts factory, story 4 live registry (registerLiveHandler) and ApiError 'gone' mapping + useEditGuard, story 5 TaskList.

Plan:
1. apps/web/src/lib/api.ts: completeTask, reopenTask, updateTask(patch), deleteTask, restoreTask, listTasks({list, includeCompleted}); all send X-Todoodle-Client and X-Todoodle-Client-Id; lifecycle POSTs sent bodyless.
2. apps/web/src/lib/queryKeys.ts: add tasks(wid, {list, includeCompleted}) -> ['ws', wid, 'tasks', {list, includeCompleted}] (architecture 12).
3. cacheOps.ts (pure): completeInCache, reopenInCache (insert by sortOrder), updateInCache, removeFromCache, insertBySortOrder; Map index by id (js-index-maps); immutable toSorted.
4. useTaskMutations.ts: useCompleteTask/useReopenTask/useUpdateTask/useDeleteTask/useRestoreTask: onMutate cancelQueries(['ws', wid, 'tasks']) + snapshot + optimistic op via setQueriesData on both includeCompleted variants; onError rollback + role=alert toast "Couldn't save — try again"; ApiError gone -> removeFromCache + useEditGuard deleted notice; onSuccess write server entity (no refetch). Expose per-task pending set (useIsMutating with mutationKey ['ws', wid, 'task', id]) so TaskRow can set aria-busy. Complete: remove from open list after COMPLETE_ANIMATION_MS (0 under reduced motion, read from matchMedia at call time). Delete/complete call focusAfterRemoval (task 6.13) and showUndoToast (task 6.5).
5. liveHandlers.ts: registerLiveHandler('task.restored', ...) insert by sortOrder with version guard (ignore <= cached). Do not edit story 4's dispatcher.

Done when TC-U08, TC-U09 pass and TC-C02, TC-C14, TC-C21, TC-C31 pass.

### 5. Web: pausable 10 s undo toast, undo stack and Cmd/Ctrl+Z

Depends on: task 6.4 (mutation hooks), story 5 lib/shortcuts.ts (useGlobalShortcut, isTypingTarget). Owner decision 2026-09-25: UNDO_WINDOW_MS = 10_000, pause while hovered/focused, Cmd/Ctrl+Z undoes the latest.

Plan:
1. createUndo.ts (pure, Clock injected): states Counting/Paused/Undoing/Undone/UndoFailed/Expired; tracks remaining unpaused time; pause()/resume(); undo() calls inverse once.
2. undoStack.ts: module-level array of active handles; latestActiveUndo().
3. showUndoToast.ts: sonner toast with duration Infinity and our scheduler controlling dismissal; custom action element with onPointerEnter/Leave and onFocus/Blur -> pause/resume; button disabled while pending; role=status container; failure -> role=alert "Couldn't undo — try again"; success -> status "Task restored".
4. useUndoShortcut.ts: useGlobalShortcut('mod+z', handler, {description: 'Undo'}) registered once at shell level; if isTypingTarget or no active undo -> return without preventDefault; else latestActiveUndo().undo().
5. Wire in useTaskMutations: complete -> showUndoToast('Task completed', reopen), delete -> showUndoToast('Task deleted', restore); inverses via stable refs (advanced-event-handler-refs).
6. Delete features/tasks/undoToast.ts from the plan (moved to features/undo per architecture 12).

Done when TC-U10..TC-U12, TC-C03, TC-C04, TC-C13, TC-C22, TC-C24..TC-C26 pass.

### 6. Web: task row checkbox with completion feedback, actions menu without delete confirm, show-completed toggle, touch and keyboard

Depends on: 6.4 (mutations, busy state), 6.5 (undo), 6.13 (focus), 6.1 (formatCompletedDate); story 5 TaskList roving tabindex + lib/shortcuts.ts; shadcn dropdown-menu (bunx shadcn add dropdown-menu). No alert-dialog: single-task delete has no confirmation (owner decision 2026-09-25).

Plan:
1. TaskRow.tsx: React.memo, primitive props (taskId, name, description, completedAt) — no isFocused prop. Round checkbox button with >= MIN_TOUCH_TARGET_PX hit area, aria-label 'Complete NAME' / 'Reopen NAME', aria-checked flips immediately; Leaving state for COMPLETE_ANIMATION_MS via motion-safe transition (0 under reduced motion). Completed style: line-through, muted, date via formatCompletedDate (no date-fns). DropdownMenu: Edit (hint E), Delete (hint Del) acting immediately. Menu trigger always visible under @media (hover: none), else on hover/focus-within. aria-busy from pending set. onPointerEnter/onFocus -> preloadTaskDetail(). Per-row content-visibility:auto + contain-intrinsic-size. Per-icon lucide imports.
2. showCompletedPref.ts: read/write codec, key tdl:showCompleted:<wid>:<listKey>, try/catch, failures -> false / dropped.
3. ShowCompletedToggle.tsx: lazy useState init from pref; write in click handler; TaskList query uses placeholderData keepPreviousData (remove startTransition). Empty completed group 'No completed tasks'.
4. rowShortcuts.ts: static table {e: Edit, Delete/Backspace: Delete task, Space: Complete}.
5. useTaskShortcuts.ts: registers table via story 5's useGlobalShortcut once per list; handler resolves focused row via document.activeElement.closest('[data-task-id]'); no own listener, no own isTypingTarget (keyboard.ts is NOT created).

Done when TC-U16, TC-C01, TC-C12, TC-C15..TC-C18, TC-C20, TC-C23, TC-C29..TC-C31 pass.

### 7. Web: lazy task detail sheet (full-screen on mobile) with inline edit, blank-name hint, edit guard and focus return

Depends on: 6.4 (mutations), 6.6 (TaskRow opener + preload), 6.13 (focusAfterRemoval), story 4 useEditGuard.

Plan:
1. TaskDetailSheet.lazy.ts: const load = () => import('./TaskDetailSheet'); export LazyTaskDetailSheet = React.lazy(load); export preloadTaskDetail = load.
2. TaskDetailSheet.tsx: shadcn Sheet (right); CSS media-query classes make it full-screen below MOBILE_BREAKPOINT_PX (no JS width state). Keyed by taskId; draft lazily initialised. Name: over TASK_NAME_MAX keeps text, shows over-limit count in red, Enter/blur sends nothing (architecture 12, no truncation). Enter/blur save name; blur saves description; blank trimmed name -> revert, no request, hint "Name can't be empty" for NAME_HINT_MS. Escape: first press reverts active field, second closes. Delete button deletes immediately (no dialog), closes sheet, focus via focusAfterRemoval. useEditGuard(taskId, draft) for conflict (Use my version / Keep theirs) and deleted notices. Focus name on open; on close return focus to returnFocusTo row if it still exists.
3. Task read via useQuery with select from module-level selectTaskById(id) factory memoised per id (stable reference).

Done when TC-C05..TC-C11, TC-C19, TC-C28, TC-C30, TC-C32 pass.

### 8. Unit tests: schemas, ordering, cache ops, restored handler, pausable undo, undo stack, focus target, preference codec, Intl dates, shortcut table

Implements design Matrix D, TC-U01..TC-U16 (vitest, no I/O; fake timers for undo).
- TC-U01..TC-U04 TaskPatchSchema variants, empty object, unknown key, TASK_NAME_MAX and +1.
- TC-U05 resolvePatchedName; TC-U06 parseIncludeCompleted; TC-U07 orderTasks.
- TC-U08 cache ops + rollback deep-equal; insertBySortOrder index.
- TC-U09 task.restored handler registered via registerLiveHandler: version lower/equal ignored, higher inserts at sortOrder.
- TC-U10 createUndo at 0, UNDO_WINDOW_MS-1 (called), UNDO_WINDOW_MS (not called).
- TC-U11 pause at 9000 ms, advance 60000, resume, undo at +500 -> called; fresh handle paused/resumed expires at exactly 10000 ms unpaused.
- TC-U12 undoStack latest: A then B -> B; B expires -> A; A expires -> none.
- TC-U13 nextFocusTarget only/first/middle/last -> addTask/next/next/previous.
- TC-U14 showCompletedPref: absent/1/0, getItem throws -> false, setItem throws -> no throw, keys isolated per workspace+list (Storage stub).
- TC-U15 formatCompletedDate same year / other year / invalid ISO; Intl.DateTimeFormat constructed once per locale (spy).
- TC-U16 rowShortcuts table: e, Delete, Backspace, Space, mod+z with non-empty descriptions.
Fixtures typed with shared Task type; realistic names (emoji, RTL, max length).

### 9. Integration tests: complete/reopen/delete/restore state matrix, access, broadcasts, retention

vitest-pool-workers, SELF.fetch through the real Hono app, real Miniflare D1 and real WorkspaceRoom DO (test opens a WebSocket to /api/w/:id/live to capture broadcasts). Nothing mocked.
Cases (design Matrices A and C): TC-I01..TC-I10 (complete/reopen x Open, Completed, DeletedOpen, DeletedCompleted, Missing), TC-I16..TC-I25 (delete/restore x all prior states), TC-I41 (cross-workspace 404 for all ops, B row unchanged), TC-I42 (no cookie 404), TC-I43 (missing X-Todoodle-Client 403 forbidden_client), TC-I45 (event carries originClientId + new version), TC-I46 (reopen returns to original order A,B,C), TC-I48 (raw row retained after delete), TC-I49 (concurrent restores: one change, one event), TC-I50 (bodyless POST complete/reopen/restore and bodyless DELETE with only the client header are accepted).
Every case asserts response + D1 row BEFORE and AFTER (completed_at, deleted, deleted_at, version, sort_order) + broadcast presence/absence (absence waited for with a bounded timeout constant).
Fixture: seedTasks creates a realistic workspace via the quick-add insert path (12 tasks, fractional sort_order, 3 completed, 2 deleted, plus workspace B).

### 10. Integration tests: PATCH edit validation and blank-name rule, list include_completed, last-write-wins

vitest-pool-workers against real Miniflare D1 + DO, via SELF.fetch.
Cases (design Matrices A, B, C): TC-I11..TC-I15 (edit x Open, Completed, DeletedOpen, DeletedCompleted, Missing), TC-I26 (list default only open by sort_order), TC-I27 (include_completed=true ordering, no deleted), TC-I28..TC-I40 (name length 1 / max / max+1; blank and whitespace name no-op with no version bump and no broadcast; blank name + description; empty description clears; description max / max+1; empty body 400; unknown field completedAt 400; include_completed=yes 400; emoji+RTL byte-exact), TC-I44 (PATCH with text/plain body -> 415 unsupported_media_type, nothing changed), TC-I47 (two clients sequential PATCH: last wins, version +2, two ordered events).
Assert D1 row before/after for every mutating case; assert no change on every 4xx.

### 11. UI component tests: row actions, completion feedback, no-confirm delete, pausable undo, Cmd/Ctrl+Z, focus, detail sheet, show completed, responsive and a11y

vitest + happy-dom + Testing Library + user-event; MSW mocks the network with bodies parsed through shared zod schemas; real TanStack Query; fake timers; matchMedia stub for reduced motion, narrow viewport (< MOBILE_BREAKPOINT_PX) and hover:none; real happy-dom localStorage plus a throwing Storage stub.
Cases (design Matrix E): TC-C01 instant tick, removal after COMPLETE_ANIMATION_MS, status toast; TC-C02 rollback; TC-C03 Undo -> reopen; TC-C04 expiry at UNDO_WINDOW_MS; TC-C05..TC-C09 sheet open/save/Escape/blank-name hint; TC-C10 over-limit kept, no PATCH; TC-C11 410 deleted notice; TC-C12 menu Delete: no dialog, immediate removal, toast; TC-C13 delete Undo; TC-C14 delete rollback; TC-C15 show completed with Intl date; TC-C16 E/Delete/Space; TC-C17 shortcuts ignored while typing; TC-C18 names, menu hints, hit area; TC-C19 useEditGuard conflict notice; TC-C20 empty completed; TC-C21 reopen rollback; TC-C22 undo failure alert; TC-C23 reduced motion immediate removal; TC-C24 hover/focus pause; TC-C25 mod+z on row vs in input; TC-C26 mod+z only latest; TC-C27 focus after removal at only/first/middle/last; TC-C28 focus return on close and next row after sheet delete; TC-C29 remembered toggle, keepPreviousData no flash, throwing storage; TC-C30 full-screen sheet + visible menu under hover:none; TC-C31 aria-busy and role alert/status; TC-C32 sheet chunk loaded only on preload.

### 12. E2E tests: complete/undo, reopen, edit, no-confirm delete/undo/retention, two-browser live, keyboard-only with focus, mobile touch, undo pause

Playwright against local wrangler dev with fresh local D1/DO; Chromium desktop project plus a mobile project (390x844, hasTouch, isMobile); seeded via /test/seed; retention via /test/tasks/:id/raw.
Workflows (design E2E table):
- TC-E01 complete -> Undo -> reload: original index, open.
- TC-E02 complete, wait > UNDO_WINDOW_MS, reload, show completed (struck through, date), reopen -> original index; reload -> show completed still on.
- TC-E03 edit name + description in sheet, reload -> persisted.
- TC-E04 delete (assert no dialog appears) + Undo -> restored; delete, let expire, reload -> gone in UI, raw row deleted=1 with data intact.
- TC-E05 two contexts: A completes -> B sees removal within LIVE_UPDATE_TARGET_MS; A deletes task B is editing -> B sees deleted notice.
- TC-E06 keyboard only: Tab to list, Down, E, edit, Enter, Escape twice (focus back on row), Delete (focus on next row), mod+z restores.
- TC-E07 mobile: row menu visible without hover, tap Delete, tap Undo; tap name -> sheet fills viewport.
- TC-E08 hover the undo toast 15 s, move away -> disappears about UNDO_WINDOW_MS later.

### 13. Web: focus management after complete/delete and on detail close

Depends on: story 5 TaskList roving tabindex (setActiveRow(id), add-task control ref), task 6.4 mutation hooks.

Plan:
1. focusAfterAction.ts: pure nextFocusTarget(orderedIds, removedIndex) -> only row: addTask; last: previous id; otherwise next id. DOM helper focusAfterRemoval(listEl, removedId) reads [data-task-id] order in one pass, calls setActiveRow + focus().
2. useTaskMutations: delete -> call in onMutate before removal; complete -> after COMPLETE_ANIMATION_MS (0 under reduced motion); on rollback refocus the reinserted row.
3. Detail sheet close (no removal) -> focus returnFocusTo row (wired in 6.7).

Done when TC-U13, TC-C27, TC-C28 pass and TC-E06 focus assertions pass.

