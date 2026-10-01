# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Shared task schemas, Intl date helpers and undo/animation constants | proposed | implementation | tasks.edit, tasks.list_completed, tasks.complete, tasks.reopen |
| 2 | API: complete, reopen, soft delete and restore endpoints with idempotent no-ops and broadcasts | proposed | implementation | tasks.complete, tasks.reopen, tasks.delete, tasks.restore |
| 3 | API: PATCH task name/description with blank-name rule, and list with include_completed | proposed | implementation | tasks.edit, tasks.list_completed |
| 4 | Web: optimistic task mutations (mutations.ts), cache ops, count deltas, busy state and live restored handler | proposed | implementation | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore, tasks.list_completed |
| 5 | Web: pausable 10 s undo toast, undo stack and Cmd/Ctrl+Z | proposed | implementation | ui.undo |
| 6 | Web: grid cells (native checkbox, TaskActionsMenu), completed rowgroup, show-completed toggle in view header, row keys per cell, offline gating, touch | proposed | implementation | ui.task_actions |
| 7 | Web: lazy task detail sheet with openTaskDetail(id,{returnFocusTo}), inline edit, blank-name hint, useEditGuard, read-only offline and focus return | proposed | implementation | ui.task_detail |
| 8 | Unit tests: schemas, ordering, cache ops, count deltas, restored handler, pausable undo, undo stack, focus timing, row-key table, preference codec, Intl dates, shortcut table | proposed | test:unit | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore, tasks.list_completed, ui.undo, ui.task_actions, ui.focus_management |
| 9 | Integration tests: complete/reopen/delete/restore state matrix, access, broadcasts, retention | proposed | test:integration | tasks.complete, tasks.reopen, tasks.delete, tasks.restore |
| 10 | Integration tests: PATCH edit validation and blank-name rule, list include_completed, last-write-wins | proposed | test:integration | tasks.edit, tasks.list_completed |
| 11 | UI component tests: grid cells, native checkbox, no-confirm delete, pausable undo, Cmd/Ctrl+Z scopes, focus, detail sheet and openTaskDetail, offline gating, counts, show completed, responsive and a11y | proposed | test:ui-component | ui.undo, ui.task_actions, ui.task_detail, ui.focus_management |
| 12 | E2E tests: complete/undo, reopen, edit, no-confirm delete/undo/retention, two-browser live, keyboard-only grid with focus, mobile touch, undo pause, offline read-only, axe | proposed | test:e2e | tasks.complete, tasks.reopen, tasks.edit, tasks.delete, tasks.restore, tasks.list_completed, ui.undo, ui.task_actions, ui.task_detail, ui.focus_management |
| 13 | Web: focus timing after complete/delete via story 5's useTaskGrid; delete focusAfterAction.ts and setActiveRow | proposed | implementation | ui.focus_management |

## Details

### 1. Shared task schemas, Intl date helpers and undo/animation constants

Depends on: story 5 shared Task type and schemas; story 2 `limits.ts` (`NAME_HINT_MS` already defined there, D-44).

Plan:
1. schemas.ts: TaskPatchSchema (.strict(), refine at least one key, TASK_NAME_MAX / TASK_DESCRIPTION_MAX), resolvePatchedName, ListTasksQuerySchema with `include_completed: z.enum(['true','false']).optional()` + parseIncludeCompleted (story 6 owns this param name, D-31), optional EmptyBodySchema, GoneBodySchema `{error:'gone', entity}`; confirm TaskSchema.completedAt nullable.
2. types.ts: MutationResult<T> union shared by API db modules: changed | noop | gone{entity:'task'|'project'} | missing (entity lets story 7's restore guard return project, D-30).
3. orderTasks(tasks): open by sortOrder asc then completed by completedAt desc, ties by id.
4. dates.ts (NEW; story 6 is the owner, story 8 extends, D-43): formatCompletedDate(iso, locale) with Intl.DateTimeFormat instances cached in a module-level Map keyed by locale+options; invalid ISO -> ''. No date-fns.
5. limits.ts: UNDO_WINDOW_MS = 10_000 (owner decision 2026-09-25), COMPLETE_ANIMATION_MS = 250. Do NOT define NAME_HINT_MS — import story 2's (D-44). MOBILE_BREAKPOINT_PX, MIN_TOUCH_TARGET_PX already from architecture 12.

Done when TC-U01..TC-U07 and TC-U15 pass.

### 2. API: complete, reopen, soft delete and restore endpoints with idempotent no-ops and broadcasts

Depends on: stories 1 (request validation: bodyless mutations allowed, X-Todoodle-Client required, 415 on non-JSON body; `/test/*` registry in routes/test.ts, D-35), 2 (workspace-auth), 4 (`broadcast(c, wid, event)` which calls waitUntil itself, D-26; event types incl. task.restored), 5 (tasks table/routes). No migration: columns exist in 0002_tasks.sql.

Plan:
1. apps/api/src/db/tasks.ts:
   - completeTask: UPDATE tasks SET completed_at=?, version=version+1, updated_at=? WHERE id=? AND workspace_id=? AND deleted=0 AND completed_at IS NULL RETURNING *. On 0 rows, classify via SELECT (missing / gone{entity:'task'} if deleted=1 / noop).
   - reopenTask: same shape guarded by completed_at IS NOT NULL, sets NULL.
   - softDeleteTask: guarded deleted=0; sets deleted=1, deleted_at, version+1. Already-deleted -> noop (204).
   - restoreTask: SELECT row; missing -> 404; not deleted -> 200 no-op (no `not_deleted` error, D-29); deleted -> run `restoreGuards` (exported, empty in story 6; story 7 registers the deleted-project guard returning gone{entity:'project'}, D-30); then guarded UPDATE deleted=1 -> deleted=0, deleted_at=NULL, version+1; preserves completed_at, sort_order. Guard makes concurrent restores a single change.
   - Never touch sort_order. Audit every other query includes deleted=0.
2. apps/api/src/routes/tasks.ts: lifecycleRoute(fn, eventType) mapping MutationResult -> 200 {task} | 204 (delete) | 404 not_found | 410 {error:'gone', entity}; on 'changed' call `broadcast(c, workspaceId, {type, entity, version, originClientId from X-Todoodle-Client-Id})` exactly once — no extra waitUntil wrapper, no broadcastEvent(env, ctx, …), no direct room.broadcast (D-26). Routes: POST /complete, /reopen, /restore (body optional, JSON {} if present); DELETE /:taskId. No client surface ever confirms delete (owner decision 2026-09-25).
3. apps/api/src/routes/test.ts (story 1's registry): register GET /test/tasks/:id/raw (route owner 6; 404 in production like every /test route) for TC-E04 and TC-I48.
4. docs/ops/recover-deleted-task.md: operator runbook.

Confirm the D-29 table rows in the design's cap-delete section hold (story 6 is the pattern story 7 adopts).

Done when TC-I01..TC-I10, TC-I16..TC-I25, TC-I41..TC-I46, TC-I48..TC-I51, TC-I53 pass.

### 3. API: PATCH task name/description with blank-name rule, and list with include_completed

Depends on: task 6.1 (TaskPatchSchema, resolvePatchedName, ListTasksQuerySchema, orderTasks), story 5 list route, story 1 validation middleware (415 for non-JSON body), story 4 `broadcast(c, wid, event)`.

Plan:
1. apps/api/src/db/tasks.ts updateTask(db, ws, id, patch, now): SELECT current (classify missing/gone{entity:'task'}); compute effective values (name via resolvePatchedName, description as-is); nothing differs -> noop; else UPDATE SET name, description, version=version+1, updated_at WHERE id AND workspace_id AND deleted=0 RETURNING *. 0 rows (deleted concurrently) -> gone. Keep the patch handling field-driven so story 8 can add dueDate.
2. listTasks(db, ws, {includeCompleted}): WHERE workspace_id=? AND deleted=0 [AND completed_at IS NULL unless includeCompleted] ORDER BY (completed_at IS NOT NULL), sort_order, completed_at DESC, id; filter object param so story 7's list=project + projectId composes (no project:<id> form, D-31).
3. apps/api/src/routes/tasks.ts: PATCH /:taskId with zod validation (400 validation with issues); 200 {task}; 410 {error:'gone', entity:'task'}; broadcast task.upserted only on changed via broadcast(c, wid, event) (D-26). GET list parses include_completed=true|false (story 6 owns the name, D-31) -> 400 on any other value.
4. Last-write-wins: no version precondition (architecture 7).

Done when TC-I11..TC-I15, TC-I26..TC-I40, TC-I44, TC-I47, TC-I52 pass.

### 4. Web: optimistic task mutations (mutations.ts), cache ops, count deltas, busy state and live restored handler

Depends on: tasks 6.2/6.3 (API), 6.1 (shared), story 2 `lib/queryKeys.ts` (`tasks(wid, {list, projectId?, includeCompleted})`, `counts(wid)` — use only, D-37) and `lib/errors.ts` (`GoneError{entity}`), story 4 live registry (registerLiveHandler), `useEditGuard`, `useCanEdit`, story 5 `useTaskGrid` and counts invalidation on task.* events (D-38).

Plan:
1. apps/web/src/lib/api.ts: completeTask, reopenTask, updateTask(patch), deleteTask, restoreTask, listTasks({list, projectId?, includeCompleted}); all send X-Todoodle-Client and X-Todoodle-Client-Id; lifecycle POSTs sent bodyless; `include_completed=true|false` query param.
2. cacheOps.ts (pure): completeInCache, reopenInCache (insert by sortOrder), updateInCache, removeFromCache, insertBySortOrder; Map index by id (js-index-maps); immutable toSorted. applyCountDelta(counts, task, op) for complete/reopen/delete/restore on `{inbox, projects:{[id]:{open,total}}, today?}`, never below 0.
3. mutations.ts (D-43 name; replaces useTaskMutations.ts): `runTaskMutation(spec)` core + useCompleteTask/useReopenTask/useUpdateTask/useDeleteTask/useRestoreTask:
   - every mutate first checks canEdit (store snapshot) and returns without a request when false (D-10);
   - onMutate cancelQueries(['ws', wid, 'tasks']) + snapshot tasks and counts + optimistic op via setQueriesData on the tasks prefix and applyCountDelta on queryKeys.counts(wid) (D-38);
   - onError rollback tasks and counts + role=alert toast "Couldn't save — try again"; GoneError -> removeFromCache + deleted notice;
   - onSuccess write server entity (no refetch);
   - per-task pending set (useIsMutating with mutationKey ['ws', wid, 'task', id]) -> story 5's row aria-busy;
   - complete removes from the open rowgroup after removalFocusTiming (COMPLETE_ANIMATION_MS, 0 under reduced motion);
   - focus via story 5's useTaskGrid: focusAfterRemoval(id) at removalFocusTiming, focusTaskRow(id) on rollback (D-04; wiring detailed in 6.13);
   - showUndoToast({message, onUndo}) (6.5).
   - Extension point for story 10 (D-24/D-33): `spec.retryPolicy?` (default none: story 6 never retries) and `spec.onWaiting?`; rollback only after retries run out. Document in code comments; no retry logic here.
4. liveHandlers.ts: registerLiveHandler('task.restored', ...) insert by sortOrder with version guard (ignore <= cached). Do not edit story 4's dispatcher.

Done when TC-U08, TC-U09, TC-U17 pass and TC-C02, TC-C14, TC-C21, TC-C31, TC-C36 pass.

### 5. Web: pausable 10 s undo toast, undo stack and Cmd/Ctrl+Z

Depends on: task 6.4 (mutations.ts), story 5 lib/shortcuts.ts (`useGlobalShortcut({key, modifiers?, scope?, allowInOverlay?, description})`, overlay scope stack, isTypingTarget — D-14), story 4 `useCanEdit()` (D-10). Owner decision 2026-09-25: UNDO_WINDOW_MS = 10_000, pause while hovered/focused, Cmd/Ctrl+Z undoes the latest.

Plan:
1. createUndo.ts (pure, Clock injected): states Counting/Paused/Undoing/Undone/UndoFailed/Expired; tracks remaining unpaused time; pause()/resume(); undo() calls onUndo once.
2. undoStack.ts: module-level array of active handles; latestActiveUndo().
3. showUndoToast.ts: `showUndoToast({message, onUndo}): UndoHandle` (D-41; renamed from `inverse`; returns the handle so story 11's Finder inline status line can reuse it, D-15). sonner toast with duration Infinity and our scheduler controlling dismissal; custom action element with onPointerEnter/Leave and onFocus/Blur -> pause/resume; Undo button disabled while pending AND while `useCanEdit()` is false (portalled, gates itself; window keeps counting); role=status container; failure -> role=alert "Couldn't undo — try again" or the GoneError entity message an extender supplies; success -> status "Task restored".
4. useUndoShortcut.ts: `useGlobalShortcut({key:'z', modifiers:['mod'], scope:'global', description:'Undo'})` (handler per story 5's signature), registered once at shell level, no allowInOverlay (suppressed while any overlay is open); if canEdit false or no active undo -> return without preventDefault; isTypingTarget handled by the registry; else latestActiveUndo().undo().
5. Wire in mutations.ts: complete -> showUndoToast({message:'Task completed', onUndo: reopen}), delete -> showUndoToast({message:'Task deleted', onUndo: restore}); onUndo via stable refs (advanced-event-handler-refs).
6. No features/tasks/undoToast.ts (lives in features/undo per architecture 12).

Done when TC-U10..TC-U12, TC-C03, TC-C04, TC-C13, TC-C22, TC-C24..TC-C26, TC-C34 (undo parts) pass.

### 6. Web: grid cells (native checkbox, TaskActionsMenu), completed rowgroup, show-completed toggle in view header, row keys per cell, offline gating, touch

Depends on: 6.4 (mutations, busy state), 6.5 (undo), 6.13 (focus), 6.7 (openTaskDetail), 6.1 (formatCompletedDate); story 5 TaskGrid/TaskRow cell slots (with its cell-level offline gating via `canEdit` in `TaskRowSlotsContext`), completed-rowgroup slot, `useTaskGrid`, `lib/shortcuts.ts` (scopes, overlay stack); story 2 AppShell view header (no fieldset anywhere in the app; every control that sends a change self-gates); story 4 `useCanEdit()`; shadcn dropdown-menu. No alert-dialog: single-task delete has no confirmation (owner decision 2026-09-25).

Plan (D-01, D-02, D-03, D-06, D-10, D-43):
1. Do NOT add primitive props to TaskRow; keep story 5's `<TaskRow task localStatus?>` and render into its cell slots.
2. TaskCheckbox.tsx (cell 1): native `<input type=checkbox>`; accessible name = task name (aria-labelledby the name button); aria-describedby -> hidden "Complete"/"Reopen"; checked flips immediately; hit area >= MIN_TOUCH_TARGET_PX via label box. No role=button, no aria-checked. `disabled` while `canEdit` (from story 5's `TaskRowSlotsContext`) is false. Leaving state for COMPLETE_ANIMATION_MS via motion-safe transition (0 under reduced motion).
3. Cell 2 (story 5's name button + TaskSummary): wire activation to openTaskDetail(task.id, {returnFocusTo}); the name button is never disabled (opens read-only offline); completed style line-through, muted, date via formatCompletedDate (no date-fns). Row onPointerEnter/onFocus -> preloadTaskDetail().
4. TaskActionsMenu.tsx (cell 3): Radix DropdownMenu with `menuItems` registry ({id, label, shortcutHint, onSelect, requiresCanEdit}) — extension point for stories 7 (Move) and 8 (Set date); register Edit (E) and Delete (Del, immediate). Trigger always visible under @media (hover: none), else on hover/focus-within; the trigger stays enabled offline. Portalled content reads useCanEdit(): Delete disabled offline, Edit stays (opens read-only). Sits beside story 5's Retry/Discard.
5. CompletedRowGroup.tsx: Completed role=rowgroup with header row inside story 5's TaskGrid; counted in aria-rowcount; empty text 'No completed tasks'.
6. showCompletedPref.ts: read/write codec, key tdl:showCompleted:<wid>:<listKey>, try/catch, failures -> false / dropped.
7. ShowCompletedToggle.tsx: rendered in the view header; not gated by useCanEdit (works offline, D-10); lazy useState init from pref; write in click handler; grid query uses placeholderData keepPreviousData. Does not read canEdit.
8. rowKeys.ts: pure rowKeyAction(key, cell, canEdit): Space/Delete/Backspace only in cells 1-2; E any cell; Enter only on the name (cell 2); canEdit false -> only open actions.
9. rowShortcuts.ts: static table {key, modifiers?, scope, description}: e/Delete/Backspace/Space scope 'grid'; mod+z scope 'global' (registered by 6.5).
10. useTaskShortcuts.ts: registers row keys via useGlobalShortcut({key, scope:'grid', description}) once per grid; handler reads getFocusedTaskId() from useTaskGrid, focused cell from activeElement.closest('[role=gridcell]'), canEdit via getCanEdit() snapshot, then rowKeyAction. No own listener, no own isTypingTarget.

Done when TC-U16, TC-U18, TC-C01, TC-C12, TC-C15..TC-C18, TC-C20, TC-C23, TC-C29..TC-C31, TC-C33 (toggle), TC-C34 (row parts), TC-C37 pass.

### 7. Web: lazy task detail sheet with openTaskDetail(id,{returnFocusTo}), inline edit, blank-name hint, useEditGuard, read-only offline and focus return

Depends on: 6.4 (mutations.ts), 6.6 (row openers + preload), 6.13 (focus timing), story 4 `useEditGuard({key, fields, entityLabel, save})` (D-18) and `useCanEdit()` (D-10), story 5 `useTaskGrid` and overlay scope stack (D-14), story 2 `lazyWithRetry` and `NAME_HINT_MS` (D-44).

Plan:
1. openTaskDetail.ts (D-05): `openTaskDetail(id, {returnFocusTo})` writes {taskId, returnFocusTo} into a module store (useSyncExternalStore); callable with no anchored row (story 11's Finder); closeTaskDetail().
2. TaskDetailHost.tsx: single mount in the workspace route; renders the lazy sheet when a task id is set.
3. TaskDetailSheet.lazy.ts: const load = () => import('./TaskDetailSheet'); LazyTaskDetailSheet via lazyWithRetry(load); export preloadTaskDetail = load.
4. TaskDetailSheet.tsx (D-43 path): shadcn Sheet (right); full-screen below MOBILE_BREAKPOINT_PX via CSS classes. Pushes onto the overlay scope stack; Escape stopPropagation. Keyed by taskId; draft lazily initialised. Name: over TASK_NAME_MAX keeps text, over-limit count in red, no save. Enter/blur save name; blur saves description; blank trimmed name -> revert, no request, hint "Name can't be empty" for story 2's NAME_HINT_MS (import, do not define). Escape: first press reverts active field, second closes. Delete button deletes immediately (no dialog), closes sheet, focus via focusAfterRemoval. `fieldsSlot` region for story 8.
5. Edit guard: `useEditGuard({key, fields:['name','description'], entityLabel:'task', save})` — replaces the old useConflictNotice / (taskId, draft) shape.
6. Offline: `useCanEdit()` false -> sheet opens read-only: name, description, slot fields and Delete disabled; drafts kept; re-enable on reconnect.
7. Focus: name on open (close button when read-only); on close -> returnFocusTo if connected, else focusTaskRow(id) if the row exists, else the view heading (D-19).
8. Task read via useQuery with select from module-level selectTaskById(id) factory memoised per id (stable reference); fallback entity passed via the store when opened from the Finder for a task not in a cached list.

Done when TC-C05..TC-C11, TC-C19, TC-C28, TC-C30, TC-C32, TC-C33 (sheet), TC-C35 pass.

### 8. Unit tests: schemas, ordering, cache ops, count deltas, restored handler, pausable undo, undo stack, focus timing, row-key table, preference codec, Intl dates, shortcut table

Implements design Matrix D, TC-U01..TC-U18 (vitest, no I/O; fake timers for undo).
- TC-U01..TC-U04 TaskPatchSchema variants, empty object, unknown key, TASK_NAME_MAX and +1.
- TC-U05 resolvePatchedName; TC-U06 parseIncludeCompleted (include_completed=true|false only); TC-U07 orderTasks.
- TC-U08 cache ops + rollback deep-equal; insertBySortOrder index.
- TC-U09 task.restored handler registered via registerLiveHandler: version lower/equal ignored, higher inserts at sortOrder.
- TC-U10 createUndo at 0, UNDO_WINDOW_MS-1 (onUndo called), UNDO_WINDOW_MS (not called).
- TC-U11 pause at 9000 ms, advance 60000, resume, undo at +500 -> called; fresh handle paused/resumed expires at exactly 10000 ms unpaused.
- TC-U12 undoStack latest: A then B -> B; B expires -> A; A expires -> none.
- TC-U13 (re-scoped by D-04) removalFocusTiming: delete 0; complete COMPLETE_ANIMATION_MS; complete reduced motion 0. The next/previous/add-task selection is NOT tested here (story 5's useTaskGrid unit test owns it — no duplicate).
- TC-U14 showCompletedPref: absent/1/0, getItem throws -> false, setItem throws -> no throw, keys isolated per workspace+list (Storage stub).
- TC-U15 formatCompletedDate same year / other year / invalid ISO; Intl.DateTimeFormat constructed once per locale (spy).
- TC-U16 rowShortcuts table: e/Delete/Backspace/Space scope grid; {key:'z', modifiers:['mod'], scope:'global'}; none allowInOverlay; non-empty descriptions.
- TC-U17 applyCountDelta for complete/reopen/delete open/delete completed/restore open/restore completed + rollback; never below 0.
- TC-U18 rowKeyAction(key, cell, canEdit) full table: Space/Delete/Backspace x cells 1,2,3; E any cell; Enter cell 2 only; canEdit false -> only open actions.
Fixtures typed with shared Task type; realistic names (emoji, RTL, max length).

### 9. Integration tests: complete/reopen/delete/restore state matrix, access, broadcasts, retention

vitest-pool-workers, SELF.fetch through the real Hono app, real Miniflare D1 and real WorkspaceRoom DO (test opens a WebSocket to /api/w/:id/live to capture broadcasts). Nothing mocked.
Cases (design Matrices A and C): TC-I01..TC-I10 (complete/reopen x Open, Completed, DeletedOpen, DeletedCompleted, Missing; every 410 asserts body {error:'gone', entity:'task'}), TC-I16..TC-I25 (delete/restore x all prior states; delete-deleted 204 no-op, restore-active 200 no-op with no broadcast and no not_deleted error — D-29), TC-I41 (cross-workspace 404 for all ops, B row unchanged), TC-I42 (no cookie 404), TC-I43 (missing X-Todoodle-Client 403 forbidden_client), TC-I45 (event carries originClientId + new version; exactly one event per change — broadcast(c, wid, event) called once, D-26), TC-I46 (reopen returns to original order A,B,C), TC-I48 (raw row retained after delete, read via /test/tasks/:id/raw and D1), TC-I49 (concurrent restores: one change, one event), TC-I50 (bodyless POST complete/reopen/restore and bodyless DELETE accepted), TC-I51 (test RestoreGuard returning gone project -> 410 {error:'gone', entity:'project'}, row unchanged, no broadcast — story 7's extension point), TC-I53 (/test/tasks/:id/raw returns 404 with a production ENVIRONMENT binding).
Every case asserts response + D1 row BEFORE and AFTER (completed_at, deleted, deleted_at, version, sort_order) + broadcast presence/absence (absence waited for with a bounded timeout constant).
Fixture: seeded via story 5's /test/seed schema (12 tasks, fractional sort_order, 3 completed, 2 deleted, plus workspace B).

### 10. Integration tests: PATCH edit validation and blank-name rule, list include_completed, last-write-wins

vitest-pool-workers against real Miniflare D1 + DO, via SELF.fetch.
Cases (design Matrices A, B, C): TC-I11..TC-I15 (edit x Open, Completed, DeletedOpen, DeletedCompleted, Missing; 410 body {error:'gone', entity:'task'}), TC-I26 (list default only open by sort_order), TC-I27 (include_completed=true ordering, no deleted), TC-I28..TC-I40 (name length 1 / max / max+1; blank and whitespace name no-op with no version bump and no broadcast; blank name + description; empty description clears; description max / max+1; empty body 400; unknown field completedAt 400; include_completed=yes 400; emoji+RTL byte-exact), TC-I44 (PATCH with text/plain body -> 415 unsupported_media_type, nothing changed), TC-I47 (two clients sequential PATCH: last wins, version +2, two ordered events), TC-I52 (include_completed=false identical to default).
Assert D1 row before/after for every mutating case; assert no change on every 4xx.

### 11. UI component tests: grid cells, native checkbox, no-confirm delete, pausable undo, Cmd/Ctrl+Z scopes, focus, detail sheet and openTaskDetail, offline gating, counts, show completed, responsive and a11y

vitest + happy-dom + Testing Library + user-event; MSW mocks the network with bodies parsed through shared zod schemas; real TanStack Query; real story 5 TaskGrid/useTaskGrid/shortcuts.ts and story 4 canEdit store (driven true/false); fake timers; matchMedia stub for reduced motion, narrow viewport (< MOBILE_BREAKPOINT_PX) and hover:none; real happy-dom localStorage plus a throwing Storage stub. Copy owned by other stories asserted via shared constants.
Cases (design Matrix E): TC-C01 native checkbox checked at once, removal after COMPLETE_ANIMATION_MS, status toast; TC-C02 rollback; TC-C03 Undo -> reopen; TC-C04 expiry at UNDO_WINDOW_MS; TC-C05 open by click and by Enter on name; TC-C06..TC-C09 save/Escape (not reaching quick add)/blank-name hint for NAME_HINT_MS; TC-C10 over-limit kept, no PATCH; TC-C11 410 gone task -> deleted notice; TC-C12 menu Delete: no dialog, immediate removal, toast; TC-C13 delete Undo; TC-C14 delete rollback; TC-C15 Completed rowgroup with Intl date; TC-C16 Space/Delete in cells 1-2, E from cell 3; TC-C17 shortcuts ignored while typing; TC-C18 input[type=checkbox] named by task, Complete/Reopen via aria-describedby, no role=button/aria-checked, menu hints, hit area; TC-C19 useEditGuard({key, fields, entityLabel:'task', save}) conflict notice; TC-C20 empty completed; TC-C21 reopen rollback; TC-C22 undo failure alert; TC-C23 reduced motion immediate removal; TC-C24 hover/focus pause; TC-C25 mod+z on row vs in input vs overlay open; TC-C26 mod+z only latest; TC-C27 focus after removal at only/first/middle/last via story 5's focusAfterRemoval; TC-C28 focus return on close and next row after sheet delete; TC-C29 remembered toggle, keepPreviousData no flash, throwing storage; TC-C30 full-screen sheet + visible menu under hover:none; TC-C31 aria-busy and role alert/status; TC-C32 sheet chunk loaded only on preload; TC-C33 offline: sheet read-only with drafts kept, the Show completed toggle is not gated and still works; TC-C34 offline: no requests from Space/Delete/checkbox/menu Delete/Undo/mod+z, checkbox disabled by story 5's self-gated cell (`useCanEdit()`), `…` trigger enabled with Delete disabled, toast keeps counting; TC-C35 openTaskDetail from a non-row opener and D-19 fallback; TC-C36 optimistic counts deltas + rollback; TC-C37 Space on cell-3 menu button opens menu, no complete; Delete there does nothing.

### 12. E2E tests: complete/undo, reopen, edit, no-confirm delete/undo/retention, two-browser live, keyboard-only grid with focus, mobile touch, undo pause, offline read-only, axe

Playwright per story 1's matrix (D-36): chromium + webkit desktop for all specs; mobile-webkit (iPhone 13) + mobile-chromium (Pixel 7) for specs tagged @mobile. Against local wrangler dev with fresh local D1/DO; seeded via story 5's /test/seed; retention via /test/tasks/:id/raw (registered in story 1's registry, D-35). playwright.config.ts is story 1's — do not add projects here.
Workflows (design E2E table):
- TC-E01 complete -> Undo -> reload: original index, open.
- TC-E02 complete, wait > UNDO_WINDOW_MS, reload, show completed (Completed group, struck through, date), reopen -> original index; reload -> show completed still on.
- TC-E03 edit name + description in sheet, reload -> persisted.
- TC-E04 delete (assert no dialog appears) + Undo -> restored; delete, let expire, reload -> gone in UI, raw row deleted=1 with data intact.
- TC-E05 two contexts: A completes -> B sees removal within LIVE_UPDATE_TARGET_MS; A deletes task B is editing -> B sees deleted notice.
- TC-E06 keyboard only: Tab into grid (name cell), Down, Enter opens sheet, edit, Enter, Escape twice (focus back on row), ← to checkbox, Delete (focus on next row), mod+z restores.
- TC-E07 @mobile: row menu visible without hover, tap Delete, tap Undo; tap name -> sheet fills viewport.
- TC-E08 hover the undo toast 15 s, move away -> disappears about UNDO_WINDOW_MS later.
- TC-E09 context.setOffline(true): toggle show completed still usable, open task -> read-only sheet, Space/Delete do nothing; setOffline(false) -> actions work.
- TC-E10 axe scan of grid with open + completed rows and an open actions menu: no violations (nested-interactive incl.), checkbox exposed as checkbox named by the task.

### 13. Web: focus timing after complete/delete via story 5's useTaskGrid; delete focusAfterAction.ts and setActiveRow

Depends on: story 5 `features/tasks/useTaskGrid.ts` (focusTaskRow, getFocusedTaskId, focusAfterRemoval — D-04), task 6.4 (mutations.ts), 6.7 (sheet close).

D-04: story 6 does NOT create `focusAfterAction.ts` and does NOT use `setActiveRow`; both are deleted from the plan. There is no list-ref accessor. The next/previous/add-task selection is story 5's and is unit-tested there only.

Plan:
1. removalFocusTiming.ts (pure): delete -> delayMs 0 (call before removal); complete -> COMPLETE_ANIMATION_MS; reduced motion -> 0.
2. mutations.ts: delete -> useTaskGrid().focusAfterRemoval(id) in onMutate before removal; complete -> after removalFocusTiming delay; on rollback focusTaskRow(restoredId) only if focus is still on the target focusAfterRemoval chose.
3. Detail sheet close (no removal) -> focus returnFocusTo if connected, else focusTaskRow(id) if the row exists, else the view heading (D-19); wired in 6.7.
4. Remote/invalidation removals are story 5's grid behaviour; add nothing.

Done when TC-U13 (re-scoped to removalFocusTiming), TC-C27, TC-C28, TC-C35 pass and TC-E06 focus assertions pass.

