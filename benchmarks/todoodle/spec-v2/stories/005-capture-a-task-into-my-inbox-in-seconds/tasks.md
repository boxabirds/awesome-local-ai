# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add tasks table (migration 0002) and tasks query module | proposed | implementation | tasks.store |
| 2 | Add idempotent create-task endpoint with validation and live broadcast | proposed | implementation | tasks.create_api |
| 3 | Add Inbox task list and counts endpoints | proposed | implementation | tasks.list_api |
| 4 | Compose story 2's AppShell with the sidebar Inbox entry, open-task count, quick-add slot and prefetchWorkspaceData | proposed | implementation | shell.sidebar |
| 5 | Build the Inbox view and the task grid (APG layout grid, TaskRow cells, TaskSummary, useTaskGrid focus API), loading skeletons, load-failure retry and empty state | proposed | implementation | tasks.list_view |
| 6 | Build inline and docked quick add (in AppShell quickAddSlot) with Q shortcut, non-truncating length counters, keyboard rules, offline submit gating and destination chip | proposed | implementation | tasks.quick_add |
| 7 | Implement optimistic task creation with failed/rejected states, retry, discard and live upsert | proposed | implementation | tasks.client_cache |
| 8 | Unit tests: task schemas, list query schema and row mapping | proposed | test:unit | tasks.store, tasks.create_api, tasks.list_api |
| 9 | Integration tests: tasks migration, idempotent create, auth/CSRF and broadcast counts | proposed | test:integration | tasks.store, tasks.create_api |
| 10 | Integration tests: Inbox list and counts endpoints | proposed | test:integration | tasks.list_api |
| 11 | Unit tests: task cache helpers and batched live-event application | proposed | test:unit | tasks.client_cache |
| 12 | UI component tests: sidebar, task grid rendering, empty state, memoised rows and extension slots | proposed | test:ui-component | shell.sidebar, tasks.list_view |
| 13 | UI component tests: quick add (limits, keys, destination, offline self-gated submit), optimistic create, retry, discard, counts invalidation and a11y status | proposed | test:ui-component | tasks.quick_add, tasks.client_cache |
| 14 | E2E tests: Inbox capture, lost-response retry, limits, keyboard-only grid use, axe, offline typing, phone layout, touch targets, dark mode and shortcuts panel | proposed | test:e2e | tasks.create_api, tasks.list_api, shell.sidebar, shell.mobile, shell.shortcuts, tasks.list_view, tasks.quick_add, tasks.client_cache |
| 15 | Build the app-wide keyboard shortcut registry (scopes, overlay scope stack, canEdit gate) and the ? shortcuts panel | proposed | implementation | shell.shortcuts |
| 16 | Build the phone layout: navigation drawer, floating add button, 44px touch targets and light/dark tokens | proposed | implementation | shell.mobile |
| 17 | Unit tests: shortcut registry (scopes, overlay stack, canEdit gate), keyboard inset, grid navigation maths and quick-add validation | proposed | test:unit | shell.shortcuts, shell.mobile, tasks.list_view, tasks.quick_add |
| 18 | UI component tests: phone shell, shortcuts panel, loader and prefetchWorkspaceData, grid roles and grid keyboard contract | proposed | test:ui-component | shell.mobile, shell.shortcuts, shell.sidebar, tasks.list_view |
| 19 | Add the /test/seed route: bulk task fixtures (5,000 rows) with extension points for stories 6, 7 and 8 | proposed | implementation | tasks.test_seed |
| 20 | Integration tests: /test/seed bulk insert, schema limits and production gate | proposed | test:integration | tasks.test_seed |

## Details

### 1. Add tasks table (migration 0002) and tasks query module

Depends on: story 1 (harness, migrations dir, safety scan) and story 2 (0001_workspaces). Revised 2026-09-27 for the cross-story resolutions (D-31, D-35, D-44).

Plan:
1. migrations/0002_tasks.sql: tasks table exactly as in design tasks.store (id TEXT PK with no default because ids are client-generated; FK to workspaces; description NOT NULL DEFAULT ''; sort_order REAL NOT NULL; completed_at; version; timestamps; deleted/deleted_at). Index idx_tasks_ws_open(workspace_id, deleted, completed_at, sort_order). NO CHECK constraints. Run the story 1 migration safety scan locally.
2. packages/shared/src/limits.ts: `TASK_SORT_STEP=1` and **`CLIENT_ID_BYTES=16`** (D-44: the one constant for client-generated task and project ids). Do NOT add `TASK_ID_BYTES` or `PROJECT_ID_BYTES`. TASK_NAME_MAX/TASK_DESCRIPTION_MAX already exist per architecture §9.
3. packages/shared/src/schemas.ts: TaskSchema; `TaskIdSchema` with its hex length derived from `CLIENT_ID_BYTES`.
4. apps/api/src/db/tasks.ts:
   - insertTaskIdempotent: single INSERT ... SELECT COALESCE(MAX(sort_order),0)+TASK_SORT_STEP FROM tasks WHERE workspace_id=?2 ON CONFLICT(id) DO NOTHING RETURNING * (WHERE is required before ON CONFLICT in INSERT..SELECT). On no row: SELECT by id and map to replayed / gone / conflict.
   - listOpenTasks(db, wsId, {list:'inbox'}) ordered sort_order, created_at, id. The options object is the extension point for story 7 (`{list:'project', projectId}`) and story 6 (`includeCompleted`).
   - countOpenTasks(db, wsId) -> `{inbox, projects: {}}` (final D-31 counts shape; story 7 fills `projects`).
   - seedTasks(db, wsId, rows): bulk insert via `db.batch` in chunks of `TEST_SEED_BATCH_SIZE`, used only by `/test/seed` (task 19).
   - rowToTask mapping.
5. Apply locally: bunx wrangler d1 migrations apply DB --local.

Done when: TC-01, TC-11..TC-14, TC-20, TC-21, TC-25, TC-27, TC-28, TC-32 (task 9/10) pass.

### 2. Add idempotent create-task endpoint with validation and live broadcast

Depends on: task 1 (tasks.store); story 1 validate pipeline (405 → 403 → 413 → 415: 415 for a non-JSON body, 403 for a missing client header); story 2 workspace-auth; story 4 `broadcast(c, wid, event)`. Revised 2026-09-27 for D-26 and D-44.

Plan:
1. **`packages/shared/src/schemas.ts`:**
   - `TaskIdSchema`: `/^[0-9a-f]{32}$/` (2 × `CLIENT_ID_BYTES` hex chars).
   - `CreateTaskInputSchema`: `{id, name trimmed 1..TASK_NAME_MAX, description? trimmed 0..TASK_DESCRIPTION_MAX default ''}`, with zod's default stripping of unknown keys (story 7 adds `projectId`, story 8 `dueDate`).
   - The server is the final length guard. The client never truncates; it blocks submission while over the limit.
2. **`apps/api/src/lib/errors.ts`:** add `'id_conflict'` to the error-code union (architecture §6 already lists it).
3. **`apps/api/src/routes/tasks.ts`:** `POST /` under `/api/w/:workspaceId/tasks`, behind workspace-auth.
   - Parse the body; failure → 400 `validation`.
   - `insertTaskIdempotent` → created 201 / replayed 200 / gone 410 / conflict 409.
   - On created only: `broadcast(c, wid, {type:'task.upserted', entity, version, originClientId})`, with `originClientId` from `X-Todoodle-Client-Id`. `broadcast` calls `waitUntil` itself (D-26): **no** extra `ctx.waitUntil` wrapper, **no** `broadcastEvent(env, ctx, …)`, **no** direct `room.broadcast`.
   - A replay (no change) never broadcasts. Broadcast errors are logged without the request body.
4. **Register the router** in `apps/api/src/app.ts`.

Done when: TC-01..TC-19 (TC-19 expects 415), TC-22..TC-24 (task 9) and TC-30 (task 8) pass, and e2e TC-80/82/86/89 (task 14) pass once the UI exists.

### 3. Add Inbox task list and counts endpoints

Depends on: task 1. Revised 2026-09-27 for D-31 (parameter names, counts shape).

Plan:
1. packages/shared/src/schemas.ts:
   - `TaskListQuerySchema = {list: enum(['inbox']).default('inbox')}`. Final shape (other stories widen it): `list=inbox|project` + `projectId` (story 7), `include_completed=true|false` (story 6). There is NO `project:<id>` form and NO `list=today` (Today is story 8's `GET /today?date=`).
   - `CountsQuerySchema = {date?: YYYY-MM-DD}` (validated; ignored until story 8).
   - `CountsSchema = {inbox: int>=0, projects: record(id, {open, total}), today?: int>=0}` (D-31 final shape).
2. apps/api/src/routes/tasks.ts: GET / -> parse query (400 on bogus list) -> listOpenTasks -> {tasks}.
3. apps/api/src/routes/counts.ts: GET /api/w/:workspaceId/counts -> parse `date` (400 when malformed) -> countOpenTasks -> `{inbox, projects: {}}`. Mount in app.ts behind workspace-auth.
4. Confirm Cache-Control: no-store is applied by finalizeResponse (story 1).

Done when: TC-25..TC-29 (task 10) and TC-31 (task 8) pass. Counts assertions parse with `CountsSchema` rather than comparing literal objects (§13 rule 3).

### 4. Compose story 2's AppShell with the sidebar Inbox entry, open-task count, quick-add slot and prefetchWorkspaceData

Depends on: story 2 `AppShell` (`features/shell/AppShell.tsx`, header + main slot + named slots, no fieldset, D-11), `App.tsx` route table and `workspacePath` (D-12), boot open, `lib/queryKeys.ts` (D-37), import lint rule (D-43); story 4 real `useCanEdit`; task 3 (list/counts endpoints). Revised 2026-09-27 for D-11, D-37, D-39, D-43 and the decision that **there is no `<fieldset disabled>` anywhere in the app** (every control that sends a change self-gates with `useCanEdit()`).

Plan:
1. **No shell file of our own.** Delete any `features/workspace/AppShell.tsx` from the earlier plan. `features/workspace/WorkspaceLayout.tsx` renders story 2's `AppShell` and fills only its named props:
   - `sidebar` → `<ResponsiveNav>` (inline Sidebar ≥ breakpoint, NavDrawer below; task 16);
   - `searchSlot` → forwarded into `SidebarContent` (story 11 fills it);
   - `headerActionsSlot` → ☰ trigger (narrow only, task 16) followed by story 11's node;
   - `quickAddSlot` → inline QuickAdd + "+ Add task" button + FloatingAddButton (QuickAdd's input typeable offline, submit self-gated; task 6);
   - children → the active view (its TaskRow cells self-gate; task 5).
   - Provides `QuickAddContext` (open state, return-focus ref).
2. **Query keys:** use story 2's `queryKeys.tasks(wid, {list:'inbox', includeCompleted:false})` and `queryKeys.counts(wid)`; define no keys of our own.
3. **`features/tasks/queries.ts`:** `tasksQuery(wid, {list, projectId?})` and `countsQuery(wid)` option factories built from `queryKeys`. `tasksQuery` sets `placeholderData: keepPreviousData`.
4. **`routes/workspaceLoader.ts`:**
   - `prefetchWorkspaceData(wid)`: fires `prefetchQuery` for tasks(inbox) and counts **without awaiting**; returns void. It is the one place stories 7 and 8 add their prefetches.
   - `workspaceLoader({params})` on `/w/:id` calls it and returns `null`.
   - Story 2's boot-open continuation calls `prefetchWorkspaceData(ws.id)` after open resolves (wire the import; the boot module stays story 2's).
   - No `Promise.all` in `Workspace.tsx`.
5. **`Sidebar.tsx` + `SidebarContent.tsx` + `SidebarNavItem.tsx`:**
   - `SidebarNavItem` is `React.memo` with primitive props; links via `workspacePath(wid, 'inbox')`.
   - The Inbox count comes from `useQuery({...countsQuery(wid), select: selectInboxCount})`, with `selectInboxCount` hoisted to module level.
   - Accessible name "Inbox, N open tasks"; `aria-current` on the active view.
   - The badge width is reserved, so no layout shift. `todaySlot`/`projectsSlot` render props, plus `searchSlot` rendered first in `SidebarContent`. No rename or delete on Inbox. Navigation is never gated (works offline).
6. **Direct imports:** shadcn components by file; lucide icons by per-icon deep import (story 2's lint rule). **No `components/icons.ts` barrel** (D-43). No feature barrels.

Done when: TC-40..TC-42 and TC-126 (task 12), TC-91, TC-92 and TC-140 (task 18), TC-134's `quickAddSlot` placement and self-gated submit (task 13), and e2e TC-80 and TC-88 (task 14) pass.

### 5. Build the Inbox view and the task grid (APG layout grid, TaskRow cells, TaskSummary, useTaskGrid focus API), loading skeletons, load-failure retry and empty state

Depends on: task 4 (layout and queries), task 15 (shortcut registry for grid-scoped dispatch). Revised 2026-09-27: the listbox/option list is WITHDRAWN (it contained buttons, TC-113 bug) and replaced by an APG layout grid (D-01, D-02, D-04, D-06, D-07, D-10). Also revised 2026-09-27: **there is no `<fieldset disabled>` anywhere in the app**; the TaskRow cells do the offline gating once for every grid.

Plan:
1. **`InboxView.tsx`:** `h1` "Inbox" (`id=view-title`), then `TaskGrid`. Registers Q through `QuickAddContext` (QuickAdd itself renders in AppShell's `quickAddSlot`; task 6).
2. **`TaskGrid.tsx`** with `status` loading / error / ready and `groups` (story 5: one unlabelled group):
   - **loading:** `SKELETON_ROW_COUNT` `SkeletonRow`s in an `aria-busy` region labelled "Loading tasks".
   - **error:** "Couldn't load your tasks." in `role=alert` with Try again → `refetch()`.
   - **ready + empty:** EmptyInbox.
   - **ready:** `role=grid aria-labelledby=view-title`; per group a `role=rowgroup` with a (visually hidden) header row; rows keyed by id; renders from `useDeferredValue`. **No `listbox`/`option` roles anywhere.**
   - A single `onKeyDown` implementing D-02: ↑/↓, j/k, Home/End move rows keeping the column; ←/→ move cells without wrap; Enter on the name calls `rowActions.open(taskId)` (no-op until story 6); Space and Delete/Backspace from cells 1–2 are dispatched to `grid`-scoped shortcuts with `{taskId, cell}`; on a cell-3 button Space is the native press.
   - Remote-removal rule: when the active row id disappears from the data (own action, live event or refetch) and focus was inside the grid, call `focusAfterRemoval`; if focus was elsewhere, only re-target `tabIndex=0`.
   - Reads `useCanEdit()` once and puts the boolean `canEdit` into the stable `TaskRowSlotsContext` value.
3. **`useTaskGrid.ts`** (D-04, exported for stories 6, 7, 8, 11): `focusTaskRow(id, cell=2)`, `getFocusedTaskId()`, `focusAfterRemoval(id)` (same column in next row, else previous, else the add-task control or FAB). Active `{taskId, cell}` in a ref; roving tabindex over the whole grid (exactly one `tabIndex=0`); moving focus touches only two DOM nodes; **no row re-render, no `isFocused` prop**. Pure maths in `gridNav.ts`.
4. **`TaskRow.tsx`** (`<TaskRow task localStatus?>`, `React.memo`): `role=row`, `data-task-id`, `aria-busy` when pending; cells `role=gridcell` + `data-cell`:
   1. checkbox slot (inert `aria-hidden` glyph in a focusable cell until story 6);
   2. name `<button>` + `TaskSummary`;
   3. actions: Retry (failed) and Discard (failed/rejected) from task 7, then `actionsSlot`; the cell is present even when empty.
   Slots come from `TaskRowSlotsContext`; callbacks from a stable memoised context. 3:1 focus ring.
5. **Cell-level offline gating (D-10), done once here for every grid:** checkbox cell (story 6's slot) disabled while `!canEdit`; the name button **always enabled** (opens the detail sheet, read-only offline); the cell-3 `…` trigger (story 6's slot) enabled, with its mutating items disabled offline (stories 6/7/8); Retry disabled offline with the reason in `aria-describedby`; **Discard enabled offline** (local only). Mutating grid keys (Space, Delete, E-commit, M, D) are registered with `requiresEdit` and no-op offline via `getCanEdit()`; navigation keys always work.
6. **`TaskSummary.tsx`:** description preview, `chipSlot`, `projectSlot`, status text for `pending | failed | rejected | waiting` (failed/rejected inside `role=alert`). Reused by story 11.
7. **`styles/rows.css`** (owner, D-07): per-row `content-visibility: auto; contain-intrinsic-size: auto var(--task-row-intrinsic-height)` on each `role=row`, never on the grid.
8. **`EmptyInbox.tsx`:** hoisted SVG; "Your Inbox is clear. Press Q to add a task." / "Tap + to add a task." under `(hover: none)`.
9. **`limits.ts`:** `SKELETON_ROW_COUNT=5`, `TASK_ROW_INTRINSIC_HEIGHT_PX=44`, `GRID_PRIMARY_CELL=2`.
10. Delete `TaskList.tsx` and `useRovingList.ts` from the earlier plan.

Done when:
- unit: TC-106 (task 17);
- ui-component: TC-43..TC-45 (task 12); TC-107..TC-113, TC-127..TC-132 (task 18); TC-135 (cell gating: Discard works offline, Retry disabled, name button enabled; task 13);
- e2e: TC-80, TC-81, TC-85, TC-88 (axe expected to pass on the grid) and TC-114 (task 14).

### 6. Build inline and docked quick add (in AppShell quickAddSlot) with Q shortcut, non-truncating length counters, keyboard rules, offline submit gating and destination chip

Depends on: task 4 (`WorkspaceLayout` fills AppShell's `quickAddSlot`), task 5 (InboxView), task 15 (shortcut registry). Revised 2026-09-27 for D-40 (target), D-44 (`CLIENT_ID_BYTES`) and D-10: **there is no `<fieldset disabled>` anywhere in the app**; QuickAdd's input stays typeable offline and it gates only its submit with `useCanEdit()`.

Plan:
1. **`lib/ids.ts`:** `newClientId()` returns `CLIENT_ID_BYTES` (16) random bytes as lowercase hex. Used for task ids here and project ids in story 7.
2. **`limits.ts`:** `LENGTH_WARNING_RATIO=0.9`, `COUNTER_ANNOUNCE_THROTTLE_MS=1_000`, `QUICK_ADD_MAX_DESCRIPTION_ROWS=6`.
3. **`canSubmit.ts`** (pure): `lengthStatus(len, limit)` → normal / near / over (threshold `ceil(limit*LENGTH_WARNING_RATIO)`); `canSubmit(name, description, canEdit)` requires a non-blank trimmed name, neither field over its limit, and `canEdit`. Derived during render.
4. **`destinationLabel.ts`** (pure): inbox → "→ Inbox"; inbox + `defaultDueDate` → "→ Inbox · Today"; project → "→ {name}".
5. **`QuickAdd.tsx`** (`target: {kind:'inbox'} | {kind:'project', projectId}` + `defaultDueDate?`; `mode`: inline | docked). **No `today` kind.**
   - **Placement:** inline mode renders in AppShell's `quickAddSlot`; docked mode (FAB sheet) portals to `document.body`.
   - **Fields:** name input and auto-growing description textarea, **no `maxLength`**, always enabled (online or offline).
   - **Offline:** `useCanEdit()` false → Add disabled with `aria-describedby` "You're offline. Your text is kept."; Enter and ⌘/Ctrl+Enter do nothing; text kept; component never unmounts on a `canEdit` change, so reconnect keeps the text.
   - **Keys:** Enter in name submits if `canSubmit`; Enter in description inserts a newline; ⌘/Ctrl+Enter submits from either; Enter while `isComposing` ignored; Tab/Shift+Tab between fields; Escape closes, discards, returns focus to the opener (button, FAB, or row via `useTaskGrid.focusTaskRow`). Overlays above stop Escape propagation (D-14).
   - **On submit:** `createTask({id:newClientId(), name:name.trim(), description, target})` (sends `projectId`/`dueDate` only when present), then clear and refocus name in the handler. The box stays open.
   - **Docked mode** positions itself with `bottom: var(--kb-inset)` (task 16).
6. **`LengthCounter.tsx`:** hidden below threshold; "N characters left" (`aria-live=polite`, throttled); "N characters over" in destructive colour + warning icon, field `aria-invalid` + `aria-describedby`.
7. **`DestinationChip.tsx`:** non-focusable, label from `destinationLabel`, referenced by the form's `aria-describedby`.
8. **`QuickAddContext.tsx`:** open state + return-focus ref, provided by `WorkspaceLayout`; InboxView registers `useGlobalShortcut({key: QUICK_ADD_KEY, description:'Add task', group:'Tasks'}, open)` (global, not `requiresEdit`).

Done when:
- unit: TC-115, TC-141 (task 17);
- ui-component: TC-51..TC-59, TC-116..TC-120, TC-134 (offline: input accepts typing, submit disabled, text preserved after reconnect; no fieldset in the document), TC-142 (task 13);
- e2e: TC-84, TC-86, TC-87, TC-147 (offline typing in a real browser) (task 14).

### 7. Implement optimistic task creation with failed/rejected states, retry, discard and live upsert

Depends on: tasks 2, 5 and 6; story 4 live registry (`registerLiveHandler`, a `Map<type, Set<fn>>` with per-animation-frame batching), `clientId` context and `useCanEdit`. Revised 2026-09-27 for D-06, D-10, D-24, D-37 and D-38.

Plan:
1. **`taskCache.ts`**, pure immutable helpers (owned extension point for stories 6, 7, 8, 10):
   - `appendOptimistic`, `markStatus`, `replaceWithServer`, `removeLocal`, `adjustCount`.
   - `applyTaskEvents(list, events[])`: ONE `Map<id, index>` per batch; replace on higher version, ignore lower/equal, insert new ids at sortOrder; same array reference when nothing changed.
   - `writeTaskLists(qc, wid, updater, match?)`: the single entry point, `setQueriesData({queryKey: ['ws', wid, 'tasks']})`, applying the updater to every cached list whose `list`/`projectId` matches (any `includeCompleted`) (D-37).
   - Every helper preserves references of untouched items (TaskRow memo).
2. **`LocalStatus` type** = `'pending' | 'failed' | 'rejected' | 'waiting'` (D-06; story 10 produces `waiting`).
3. **`useCreateTask.ts`:**
   - `useMutation` keyed per task id.
   - **onMutate:** `writeTaskLists(... appendOptimistic ..., matchesTarget(target))`; increment counts via `setQueriesData({queryKey: queryKeys.counts(wid)})`.
   - POST with `AbortSignal.timeout(CREATE_TASK_TIMEOUT_MS)` (add `=10_000` to `limits.ts`) and the `X-Todoodle-Client` / `X-Todoodle-Client-Id` headers; body includes `projectId`/`dueDate` only when the target has them.
   - **Outcomes:** 201/200 → `replaceWithServer`; network, timeout, 5xx, 403, 404 → failed, count −1; 400, 409, 410 → rejected, count −1; 429 → left to story 10 (waiting + scheduled retry).
   - `retry(id)`: failed rows only, only while `canEdit`; re-POSTs the SAME id and body. `discard(id)`: local only, works offline.
   - **Retry rule (amended, D-24):** "No automatic retry after failures; scheduled retry after a rate-limit wait is the only exception" (owned by story 10). Expose the per-id request body so story 10 can re-send it unchanged.
   - No cache writes in render or effects.
4. **`TaskRow.tsx` / `TaskSummary.tsx`:** pending `aria-busy=true`; failed "Couldn't save this task." in `role=alert` + Retry and Discard in cell 3; rejected "This task can't be saved." in `role=alert` + Discard only. Offline (cell-level gating from task 5; there is no fieldset anywhere in the app): Retry disabled with the reason; **Discard enabled and works offline** (local removal, no request). TC-135 is expected to pass (resolved 2026-09-27).
5. **`liveHandlers.ts`** (registered once at workspace mount, added to the Set, never replacing others):
   - `task.upserted` → `writeTaskLists(qc, wid, l => applyTaskEvents(l, batch))`.
   - Counts freshness (D-38): `invalidateQueries({queryKey: queryKeys.counts(wid)})` for every `task.*` event (`task.upserted`, `task.deleted`, `task.restored`) and `tasks.bulk`, once per animation-frame batch.
6. **`test/msw/tasks.ts`:** handlers producing `TaskSchema`/`CountsSchema`-parsed fixtures.

Done when:
- unit: TC-60..TC-64, TC-121, TC-122, TC-143 (task 11);
- ui-component: TC-65..TC-71, TC-123, TC-124, TC-135, TC-139 (task 13);
- e2e: TC-82, TC-83, TC-90 (task 14).

### 8. Unit tests: task schemas, list query schema and row mapping

Cases from design test strategy (revised 2026-09-27 for D-31 and D-44):
- TC-30 CreateTaskInputSchema: each D1 class (empty, whitespace, 1, 500, 501 name; description absent/''/5000/5001; emoji; bad id 'ABC' — id length derived from `CLIENT_ID_BYTES`); trimming; unknown key stripped.
- TC-31 TaskListQuerySchema: inbox ok, missing -> inbox default, bogus, `project:abc` and `today` rejected (D-31); CountsQuerySchema: no date ok, `2026-09-27` ok, malformed date rejected.
- rowToTask: snake_case -> Task incl. null completed_at, numeric sort_order.
Fixtures in apps/api/test/fixtures/tasks.ts built from limits.ts constants ('a'.repeat(TASK_NAME_MAX) etc.) and realistic names ('Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞').
Run: bun run test:unit.

### 9. Integration tests: tasks migration, idempotent create, auth/CSRF and broadcast counts

vitest-pool-workers via `SELF.fetch`, against a REAL Miniflare D1 (migrations 0001+0002 applied) and the REAL WorkspaceRoom DO. D1 is never mocked (architecture §10). Revised 2026-09-27 for D-21, D-26 and D-44.

**Fixtures:** workspaces are created through the real POST /api/workspaces (story 2) or `/test/seed-workspace` to get a valid `tdl_ws` cookie. A second workspace is used for the cross-workspace cases.

**Cases:**
- **TC-01..TC-18:** inputs, replay, gone, `id_conflict`, malformed id (length from `CLIENT_ID_BYTES`), no cookie, foreign cookie, missing CSRF header.
- **TC-19:** body sent as `text/plain` with the CSRF header present → **415 `unsupported_media_type`** (D-21).
- **TC-20:** sequential creates keep order.
- **TC-21:** 10 concurrent creates get distinct sortOrder values.
- **TC-22:** exactly one broadcast on create, sent through story 4's `broadcast(c, wid, event)` (D-26). A helper opens a WebSocket to `/api/w/:id/live`, sending the exact `Origin` required by story 4, and counts messages.
- **TC-23:** no broadcast on replay.
- **TC-24:** no broadcast on validation failure.
- **TC-32:** migration check — table and index exist, FK to workspaces, no CHECK in the SQL text.

Every stateful case asserts the DB row count and values BEFORE and AFTER, with a direct SELECT.

Run: bun run test:integration.

### 10. Integration tests: Inbox list and counts endpoints

Real Miniflare D1. Revised 2026-09-27 for D-31 and D-35.

**Fixtures:** seed via the real POST create and via `/test/seed` (task 19) for completed and soft-deleted rows (`completedAt`, `deleted`); no raw UPDATE/SQL fixtures and no `/test/sql`.

**Cases:**
- TC-25: list returns only this workspace's open non-deleted tasks in sortOrder order (fixture includes completed, deleted and other-workspace tasks).
- TC-26: bogus list → 400.
- TC-27: empty → `[]`.
- TC-28: counts with 3 open / 1 completed / 1 deleted parse with `CountsSchema` and give `inbox` 3 and `projects` `{}`; `?date=2026-09-27` gives the same; malformed `date` → 400 `validation`. Assert via the schema, not a literal object (§13 rule 3).
- TC-29: no cookie → 404 for both.

Assert no DB change on reads and `Cache-Control: no-store`.

Run: bun run test:integration.

### 11. Unit tests: task cache helpers and batched live-event application

vitest, no I/O (a real in-memory `QueryClient` for TC-143). Revised 2026-09-27 for D-37.

Cases:
- TC-60: `appendOptimistic` does not mutate its input.
- TC-61: `markStatus` failed preserves the text.
- TC-62: `replaceWithServer` replaces in place.
- TC-63: `removeLocal` preserves other references (`toBe` identity).
- TC-64: `applyTaskEvents` — a higher version replaces, an equal or lower version is ignored, a new id is inserted at its sortOrder position.
- TC-121: `applyTaskEvents` over 1,000 cached tasks with a batch of [update, stale, new] applies 2 and ignores 1; untouched items keep their references.
- TC-122: a batch of only stale events returns the identical array reference.
- TC-143: `writeTaskLists` with an Inbox target updates both `queryKeys.tasks(wid,{list:'inbox',includeCompleted:false})` and the `includeCompleted:true` variant via `setQueriesData` on `['ws', wid, 'tasks']`, and leaves another workspace's list untouched (same reference).

Run: bun run test:unit.

### 12. UI component tests: sidebar, task grid rendering, empty state, memoised rows and extension slots

vitest + happy-dom + Testing Library. The network is mocked by MSW handlers from `apps/web/test/msw/tasks.ts` (schema-parsed fixtures). Loader, keyboard and grid-state cases are in task 18. Revised 2026-09-27 for D-01, D-11 and D-31.

Cases:
- **TC-40:** with counts `{inbox: 3, projects: {}}`, Inbox accessible name is "Inbox, 3 open tasks", with no rename/delete.
- **TC-41:** a zero count is hidden.
- **TC-42:** loading skeleton badge causes no layout shift (badge width reserved).
- **TC-43:** grid rows in order, with a description preview in `TaskSummary` only when present.
- **TC-44:** EmptyInbox copy.
- **TC-45:** appending a task does not re-render existing memoised rows (render-count spy). It relies on taskCache preserving references and the stable row-callback/slot contexts.
- **TC-126:** extension slots, rendered through story 2's real `AppShell`: a node passed as `searchSlot` renders as the first child of SidebarContent both inline (width 1024) and inside the NavDrawer (width 375); a node passed as `headerActionsSlot` renders in the header action area at both widths; with no slots passed, nothing extra renders.

Run: bun run test:ui.

### 13. UI component tests: quick add (limits, keys, destination, offline self-gated submit), optimistic create, retry, discard, counts invalidation and a11y status

vitest + happy-dom + Testing Library + MSW; fake timers for the timeout and the counter-announce throttle. `useCanEdit` is stubbed, but QuickAdd and failed rows are rendered inside story 2's REAL `AppShell` (via `WorkspaceLayout`) so the self-gating is proven in the real shell. Revised 2026-09-27 for D-10 (there is no `<fieldset disabled>` anywhere in the app; every control that sends a change self-gates with `useCanEdit()`), D-24, D-38 and D-40.

**QuickAdd:**
- TC-51/52: blank or whitespace name → Add disabled, and no request recorded.
- TC-53: Enter submits once, clears the fields, refocuses name, and the box stays open.
- TC-54: Escape closes without a request; focus returns to "+ Add task".
- TC-55: 449 chars shows no counter.
- TC-56: 450 chars shows "50 characters left" with `aria-live`.
- TC-57: typing past 500 keeps all 501 chars; "1 character over"; Add disabled; Enter does nothing.
- TC-58: pasting 600 chars keeps all 600; "100 characters over".
- TC-59: ⌘/Ctrl+Enter submits from the description; plain Enter inserts a newline.
- TC-116: Enter while composing (IME) sends no POST.
- TC-117: Tab and Shift+Tab move between the fields.
- TC-118: the chip reads "→ Inbox" and the form's description contains "Inbox".
- TC-119: over-limit description has `aria-invalid` and a counter with a warning icon.
- TC-120: Escape from docked mode returns focus to the FAB.
- **TC-134 (offline → reconnect):** inline and docked. Assert the document contains no `fieldset`; typing 'Buy milk' works and the input holds it; Add disabled with the offline reason; Enter and ⌘/Ctrl+Enter send no POST; switch `useCanEdit` to true → text still 'Buy milk', Add enabled, one Enter sends exactly one POST.
- TC-142: project target and `defaultDueDate` are sent as `projectId` / `dueDate`; no `today` kind exists.

**useCreateTask / live handlers:**
- TC-65: network error → failed row inside `role=alert`, with Retry and Discard in cell 3.
- TC-66: 500 then 201 → retry sends the SAME id; one row.
- TC-67: discard removes the row with no request; count restored.
- TC-68: 400 → rejected; no Retry.
- TC-69: delayed response → row and count visible before it resolves.
- TC-70: timeout past `CREATE_TASK_TIMEOUT_MS` → failed, and no automatic re-request afterwards (D-24).
- TC-71: count 3 → failure 3 → retry success 4.
- TC-123: pending row has `aria-busy`; the failure message is inside `role=alert`.
- TC-124: tasks live handlers coexist with another `task.upserted` handler; both are called.
- TC-135: offline, Discard removes a failed row with no request; Retry disabled with the reason; the name button stays enabled. **Expected to pass** (resolved 2026-09-27: cells self-gate; nothing disables Discard).
- TC-139: `task.upserted`, `task.deleted`, `task.restored` and `tasks.bulk` each invalidate `queryKeys.counts(wid)`; three events in one frame invalidate once.

Run: bun run test:ui.

### 14. E2E tests: Inbox capture, lost-response retry, limits, keyboard-only grid use, axe, offline typing, phone layout, touch targets, dark mode and shortcuts panel

Playwright against local wrangler dev (:8787) with a fresh local D1, using story 1's matrix (D-36): `chromium` and `webkit` desktop for all specs; specs tagged `@mobile` also run on `mobile-webkit` (iPhone 13) and `mobile-chromium` (Pixel 7). The workspace is created through the real home page (story 2); bulk tasks via `/test/seed` (task 19). `page.route` is used ONLY for fault injection; `context.setOffline` only for TC-147. Revised 2026-09-27 for D-01, D-10 (+ story 4 correction), D-35 and D-36.

**Workflows:**

| TC | Workflow | Asserts |
|---|---|---|
| TC-80 | W1 golden path | persists after reload; sidebar count 1 |
| TC-81 | W2 three rapid adds | order kept after reload |
| TC-82 | W3 lost response (`route.fetch()` then `route.abort()`), then Retry | exactly one task after reload |
| TC-83 | W4 aborted before reaching the server, then Discard | none after reload |
| TC-84 | W5 type 'quiet' in the workspace rename field | quick add does not open |
| TC-85 | W6 empty state | appears, then disappears |
| TC-86 | W7 paste 600 chars | all 600 kept; "100 characters over"; Add disabled; after deleting 100 chars Add is enabled and the saved task has 500 chars |
| TC-87 | W8 Escape | creates nothing |
| TC-88 | W9 keyboard-only golden path; force one failed row so Retry/Discard sit inside a grid row; axe on the Inbox with quick add open | zero serious/critical violations incl. `nested-interactive` and `aria-required-children` — **expected to pass** with the grid |
| TC-89 | W10 direct API POST with a 501-char name | 400 |
| TC-90 | W11 delayed POST | row visible while it is pending |
| TC-97 | W12 `@mobile` iPhone 13 / Pixel 7 plus iPad with `hasTouch` | every button, link and checkbox in shell, grid and quick add has a bounding box of at least 44×44 |
| TC-98 | W13 `colorScheme` light and dark | background token differs; axe colour-contrast zero violations in both |
| TC-105 | W14 press `?` | panel lists shortcuts incl. the Home/End note; axe clean |
| TC-114 | W15 20 tasks seeded via `/test/seed` | Tab into the grid, End, Home, ArrowRight: `activeElement` is row 20's name, row 1's name, then row 1's cell 3 |
| TC-125 | W16 `@mobile` | tap the FAB, type "Milk", Enter → task added; QuickAdd docked at the bottom of the viewport; open the drawer, tap Inbox → drawer closes |
| TC-147 | W17 offline typing | open quick add; `context.setOffline(true)`, wait for story 4's offline state; type 'Buy milk' → input holds it, Add disabled, Enter sends no POST; `setOffline(false)`, wait for editing → text unchanged; Enter saves exactly one 'Buy milk' (present after reload) |

Run: bun run test:e2e.

### 15. Build the app-wide keyboard shortcut registry (scopes, overlay scope stack, canEdit gate) and the ? shortcuts panel

Depends on: task 4 (layout mounts the panel hook); story 2 `lazyWithRetry`; story 2/4 `features/live/canEdit.ts`. Architecture §12 makes this the ONLY global keydown listener; stories 6, 7, 8 and 11 register through it. Revised 2026-09-27 for D-02, D-10 and D-14.

Plan:
1. `lib/shortcuts.ts`:
   - A module-level `Map<normalisedKey, Set<Entry>>`; the document keydown listener attached once, lazily, on the first registration.
   - `useGlobalShortcut(spec, handler)` with `spec = {key, modifiers?: ('mod'|'shift'|'alt')[], scope?: 'global'|'grid', allowInOverlay?, requiresEdit?, description, group?, enabled?}` and `handler(e, {taskId?, cell?})`. Handler kept in a ref (no registration churn); unregister on unmount.
   - **Overlay scope stack:** `pushOverlayScope()` (returns pop) and `useOverlayScope(open)`. While non-empty, `global` and `grid` shortcuts are suppressed unless `allowInOverlay`.
   - **Dispatcher rules, in order:** ignore when `isComposing`; exact modifier match (Shift implicitly allowed only for shifted characters like `?`; `mod` = Meta on macOS, Ctrl elsewhere); in a typing target, never fire single-key shortcuts and never fire `{key:'z', modifiers:['mod']}` (browser text undo), but do fire other `mod` shortcuts such as ⌘K; overlay stack check; `grid` scope requires focus inside a `role=grid` and passes `{taskId, cell}` from `data-task-id`/`data-cell`; `requiresEdit` entries skip when `getCanEditSnapshot()` is false (D-10). Most recent enabled entry wins; `preventDefault` only when a handler runs.
   - The single `isTypingTarget` lives here.
   - `listShortcuts()` snapshot for the panel; `describeShortcut()` static grid entries: ↑/↓ and j/k, Home/End with the note "Differs from Ctrl+Home/End used in most grids" (D-02), ←/→.
2. `features/shortcuts/ShortcutsPanel.tsx`: shadcn Dialog loaded with story 2's `lazyWithRetry`, grouped (General / Navigation / Tasks) with `<kbd>`; calls `useOverlayScope(true)`; Escape closes with propagation stopped and returns focus to the previous element.
3. `features/shortcuts/useShortcutsPanel.ts`: registers `{key:'?'}`; idle preload via `requestIdleCallback`, falling back to `setTimeout`.
4. `limits.ts`: `QUICK_ADD_KEY='q'`, `SHORTCUT_HELP_KEY='?'`.
5. One module; no `useGlobalShortcut.ts` / `isTypingTarget.ts` files. Direct imports only.

Done when: unit TC-46, TC-99..TC-102, TC-133, TC-136, TC-138 (task 17); ui-component TC-47..TC-50, TC-103, TC-104, TC-137 (task 18); e2e TC-105 (task 14) pass.

### 16. Build the phone layout: navigation drawer, floating add button, 44px touch targets and light/dark tokens

Depends on: task 4 (WorkspaceLayout and SidebarContent); task 6 (QuickAdd docked mode consumes `--kb-inset`); story 2 tokens generator and contrast checker. Revised 2026-09-27 for D-11 (no own shell), D-42 (token entries only), D-43 (`lib/useIsNarrow.ts`) and D-10 (there is no fieldset anywhere in the app; the FAB is not gated and docked QuickAdd self-gates only its submit).

Plan:
1. **Constants.** In `limits.ts`: `MOBILE_BREAKPOINT_PX=768`, `MIN_TOUCH_TARGET_PX=44`. Emit them into `styles/constants.css` as CSS custom properties with a small build step, so CSS never hard-codes 768 or 44.
2. **`lib/useIsNarrow.ts`** (owned path; later stories import it): `useSyncExternalStore` over `matchMedia` for `MOBILE_BREAKPOINT_PX - 0.02px`; returns a boolean.
3. **`NavDrawer.tsx`** (passed through AppShell's `sidebar` prop by `ResponsiveNav`):
   - shadcn Sheet (side=left, `id=nav-drawer`) rendering the same module-level `SidebarContent` as the inline sidebar; calls `useOverlayScope(open)`.
   - ☰ trigger in AppShell's `headerActionsSlot` with `aria-label="Open navigation"`, `aria-expanded`, `aria-controls`.
   - Nav selection closes it; focus returns to ☰. Resize across the breakpoint while open: unmount and focus `#view-title`.
4. **`FloatingAddButton.tsx`.** Rendered in AppShell's `quickAddSlot` when narrow or under `@media (hover: none)`; fixed bottom-right with `env(safe-area-inset-*)`, `aria-label="Add task"`; hidden while QuickAdd is docked open; not gated, so enabled offline. The docked sheet portals to `document.body`.
5. **`lib/useKeyboardInset.ts`.** While docked QuickAdd is open, passive `visualViewport` `resize`/`scroll` listeners; write `--kb-inset` = `max(0, innerHeight - vv.height - vv.offsetTop)` once per frame; clean up on close; 0 without `visualViewport`.
6. **`styles/touch.css`.** Under `@media (hover: none)`, every button, link, grid cell control and nav item gets a minimum 44×44 hit area (transparent `::before` expansion where needed).
7. **Tokens.** Add story 5's entries (sidebar, active item, row focus ring, row hover, FAB, skeleton, counter warning, failed-row message) to story 2's `packages/shared/src/tokens.ts` only; regenerate `tokens.css` with story 2's generator; story 2's contrast checker must pass for every added pair. Do not create or hand-edit a colour file. Reduced motion disables the drawer animation.

Done when: unit TC-93 (task 17); ui-component TC-94..TC-96 (task 18) and the docked variant of TC-134 (task 13); e2e TC-97, TC-98, TC-125 (task 14) pass.

### 17. Unit tests: shortcut registry (scopes, overlay stack, canEdit gate), keyboard inset, grid navigation maths and quick-add validation

vitest, no I/O. Revised 2026-09-27 for D-01/D-02 (grid maths), D-10, D-14 and D-40.

Cases:
- **TC-46:** isTypingTarget classes.
- **TC-99:** registering 5 shortcuts adds exactly one document keydown listener (spy on `addEventListener`).
- **TC-100:** the most recently registered entry wins; unregistering restores the previous one.
- **TC-101:** modifiers array: Shift+`?` fires `{key:'?'}`; Ctrl/Meta/Alt+q never fires `{key:'q'}`; `{key:'k', modifiers:['mod']}` fires only with the platform mod.
- **TC-102:** a handler replaced on re-render is called without re-registering (registration count unchanged).
- **TC-136:** overlay scope stack suppresses global and grid shortcuts; an `allowInOverlay` entry fires; after pop, global fires again.
- **TC-138:** ⌘/Ctrl+Z not dispatched in a text input (no preventDefault), dispatched from a grid cell; ⌘/Ctrl+K dispatched in a text input.
- **TC-133:** a `requiresEdit` grid entry does not run while the canEdit snapshot is false; a non-edit entry runs; both run when true.
- **TC-93:** the inset is 300 for vv.height 500, innerHeight 800, offsetTop 0; it is 0 when `visualViewport` is undefined.
- **TC-106:** `gridNav` on 3 rows × 3 cells: rows clamp at both ends keeping the column; cells clamp at both ends; `focusAfterRemoval` picks next, else previous, else the add control.
- **TC-115:** `lengthStatus` and `canSubmit` boundaries, built from `TASK_NAME_MAX`, `TASK_DESCRIPTION_MAX` and `LENGTH_WARNING_RATIO`: name 449/450/500/501; description 4499/4500/5000/5001; `canSubmit` false for a blank name, a 501-char name, a 5001-char description, and `canEdit=false`.
- **TC-141:** `destinationLabel`: inbox → "→ Inbox"; inbox + `defaultDueDate` → "→ Inbox · Today"; project 'Work' → "→ Work".

Run: bun run test:unit.

### 18. UI component tests: phone shell, shortcuts panel, loader and prefetchWorkspaceData, grid roles and grid keyboard contract

vitest + happy-dom + Testing Library + MSW. Use a `matchMedia` stub to set D6 viewport/pointer classes. Revised 2026-09-27: the listbox/option assertions are WITHDRAWN (they pinned the bug); the grid contract of D-01/D-02/D-04 replaces them, plus D-14 and D-39 cases.

Cases:
- **Phone shell:**
  - TC-94: width 767 renders ☰ and no inline sidebar; width 768 renders the inline sidebar and no ☰ (through story 2's AppShell).
  - TC-95: the drawer closes on nav selection and focus returns to ☰.
  - TC-96: the FAB opens QuickAdd docked with the name field focused; the FAB is hidden while it is open and shows again after Escape.
- **Shortcuts panel:**
  - TC-103: `?` opens a panel listing "Add task (Q)", "Show keyboard shortcuts (?)", the grid keys and the Home/End deviation note; Escape closes it and restores focus.
  - TC-104: typing `?` in the quick-add name field inserts the character and does not open the panel.
  - TC-137: with quick add open and focus on a grid row, `?` then one Escape closes only the panel; quick add stays open with its text.
- **Loader:**
  - TC-91: MSW holds both responses; after `workspaceLoader` runs, both GET tasks and GET counts are recorded before either resolves, and the loader returns without awaiting.
  - TC-92: the counts key equals `queryKeys.counts(wid)` (no date), and invalidating `['ws', wid]` refetches counts exactly once.
  - TC-140: `prefetchWorkspaceData` is called once from the `/w/:id` loader and once from the boot-open continuation, with the workspace id.
- **Grid states, roles and keyboard:**
  - TC-107: loading renders 5 skeleton rows in an `aria-busy` region.
  - TC-108: error shows `role=alert` with Try again; clicking it refetches once and rows render.
  - TC-109: Tab lands on row 1's name; Down, Down → row 3's name; Tab leaves the grid.
  - TC-110: memo render counters unchanged across ↓ and → navigation.
  - TC-111: focus returns to row 2's name after Tab away and back.
  - TC-112: j/k/Home/End mirror the arrow keys.
  - **TC-113 (rewritten):** `role=grid` labelled by the view title; `role=rowgroup`; each `role=row` has `data-task-id` and exactly 3 `role=gridcell`; name is a button in cell 2; Retry/Discard are buttons in cell 3 of the failed row; NO `role=listbox` or `role=option` anywhere; exactly one `tabIndex=0` in the grid.
  - TC-127: Tab through the page visits exactly one element inside the grid.
  - TC-128: ←/→ move between cells and cell-3 buttons without wrapping.
  - TC-129: ↑/↓/Home/End keep the column.
  - TC-130: Space/Delete reach grid-scoped shortcuts only from cells 1–2; Space on Retry presses Retry.
  - TC-131: Enter on the name calls `rowActions.open` with the row id.
  - TC-132: focused row removed by a live event or a refetch → focus to next row (else previous, else add control); a remote removal while focus is in the quick-add input leaves focus there.

Run: bun run test:ui.

### 19. Add the /test/seed route: bulk task fixtures (5,000 rows) with extension points for stories 6, 7 and 8

Depends on: task 1 (`seedTasks` in db/tasks.ts); story 1's `/test/*` registry in `apps/api/src/routes/test.ts` and its production gate (D-35). Owner: story 5; extended by stories 6, 7 and 8 (design capability tasks.test_seed).

Plan:
1. `packages/shared/src/testSeed.ts`: `TestSeedSchema` with the final D-35 shape `{workspaceId, projects?:[{ref,name,color,deleted?}], tasks?:[{name,description?,projectRef?,dueDate?,completedAt?,deleted?,sortOrder?}]}`. In story 5, `projects`, `projectRef` and `dueDate` are refined to fail with a validation issue naming the field ("not supported until story 7/8").
2. `limits.ts`: `TEST_SEED_MAX_TASKS = 5_000`, `TEST_SEED_BATCH_SIZE = 100`.
3. `apps/api/src/routes/testSeed.ts`: `POST /test/seed` → parse (400 `validation`) → workspace exists? (404) → `seedTasks` via `db.batch` in chunks → 201 `{taskIds, projectIds: {}}` in input order. Ids from `CLIENT_ID_BYTES`. Default `sortOrder` appends with `TASK_SORT_STEP` after the current max. No broadcast.
4. Register the entry in story 1's `routes/test.ts` registry so it returns 404 in production. No `/test/sql` and no arbitrary SQL.
5. `e2e/fixtures/seed.ts`: `seedTasks(request, workspaceId, tasks)` helper for TC-114 and later stories.

Done when: TC-144, TC-145, TC-146 (task 20) pass and TC-114 (task 14) uses this route.

### 20. Integration tests: /test/seed bulk insert, schema limits and production gate

vitest-pool-workers via `SELF.fetch` against REAL Miniflare D1 (migrations 0001+0002). Workspaces created through `/test/seed-workspace` or the real create endpoint. Every case asserts row counts before and after with a direct SELECT.

Cases:
- **TC-144:** seed 3–4 tasks: one default order, one `sortOrder: 0.5`, one `completedAt`, one `deleted` → 201 with ids in input order; rows hold exactly those values; GET list=inbox returns only open rows in sortOrder order.
- **TC-145:** 5,000 tasks (`TEST_SEED_MAX_TASKS`) in one call → 201 and `COUNT(*)` = 5,000; 5,001 → 400 `validation` and no additional rows.
- **TC-146:** body with `dueDate` → 400 naming the field; with `projects` → 400 naming the field; unknown `workspaceId` → 404; with `ENVIRONMENT=production` → 404 and zero rows.

Run: bun run test:integration.

