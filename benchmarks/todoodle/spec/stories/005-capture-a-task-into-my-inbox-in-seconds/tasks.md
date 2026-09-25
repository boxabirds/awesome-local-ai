# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add tasks table (migration 0002) and tasks query module | proposed | implementation | tasks.store |
| 2 | Add idempotent create-task endpoint with validation and live broadcast | proposed | implementation | tasks.create_api |
| 3 | Add Inbox task list and counts endpoints | proposed | implementation | tasks.list_api |
| 4 | Build workspace app shell with sidebar Inbox entry and open-task count | proposed | implementation | shell.sidebar |
| 5 | Build Inbox view, memoised task list with roving keyboard navigation, loading skeletons, load-failure retry and empty state | proposed | implementation | tasks.list_view |
| 6 | Build inline and docked quick add with Q shortcut, non-truncating length counters, keyboard rules and destination chip | proposed | implementation | tasks.quick_add |
| 7 | Implement optimistic task creation with failed/rejected states, retry, discard and live upsert | proposed | implementation | tasks.client_cache |
| 8 | Unit tests: task schemas, list query schema and row mapping | proposed | test:unit | tasks.store, tasks.create_api, tasks.list_api |
| 9 | Integration tests: tasks migration, idempotent create, auth/CSRF and broadcast counts | proposed | test:integration | tasks.store, tasks.create_api |
| 10 | Integration tests: Inbox list and counts endpoints | proposed | test:integration | tasks.list_api |
| 11 | Unit tests: task cache helpers and batched live-event application | proposed | test:unit | tasks.client_cache |
| 12 | UI component tests: sidebar, task list, empty state and memoised rows | proposed | test:ui-component | shell.sidebar, tasks.list_view |
| 13 | UI component tests: quick add (non-truncating limits, keys, destination), optimistic create, retry, discard and a11y status | proposed | test:ui-component | tasks.quick_add, tasks.client_cache |
| 14 | E2E tests: Inbox capture, lost-response retry, limits, keyboard-only use, phone layout, touch targets, dark mode and shortcuts panel | proposed | test:e2e | tasks.create_api, tasks.list_api, shell.sidebar, shell.mobile, shell.shortcuts, tasks.list_view, tasks.quick_add, tasks.client_cache |
| 15 | Build the app-wide keyboard shortcut registry and the ? shortcuts panel | proposed | implementation | shell.shortcuts |
| 16 | Build the phone layout: navigation drawer, floating add button, 44px touch targets and light/dark tokens | proposed | implementation | shell.mobile |
| 17 | Unit tests: shortcut registry, keyboard inset, roving list maths and quick-add validation | proposed | test:unit | shell.shortcuts, shell.mobile, tasks.list_view, tasks.quick_add |
| 18 | UI component tests: phone shell, shortcuts panel, loader parallelism and list keyboard navigation | proposed | test:ui-component | shell.mobile, shell.shortcuts, shell.sidebar, tasks.list_view |

## Details

### 1. Add tasks table (migration 0002) and tasks query module

Depends on: story 1 (harness, migrations dir, safety scan) and story 2 (0001_workspaces).

Plan:
1. migrations/0002_tasks.sql: tasks table exactly as in design tasks.store (id TEXT PK with no default because ids are client-generated; FK to workspaces; description NOT NULL DEFAULT ''; sort_order REAL NOT NULL; completed_at; version; timestamps; deleted/deleted_at). Index idx_tasks_ws_open(workspace_id, deleted, completed_at, sort_order). NO CHECK constraints. Run the story 1 migration safety scan locally.
2. packages/shared/src/limits.ts: TASK_SORT_STEP=1, TASK_ID_BYTES=16 (TASK_NAME_MAX/TASK_DESCRIPTION_MAX already exist per architecture §9).
3. packages/shared/src/schemas.ts: TaskSchema.
4. apps/api/src/db/tasks.ts:
   - insertTaskIdempotent: single INSERT ... SELECT COALESCE(MAX(sort_order),0)+TASK_SORT_STEP FROM tasks WHERE workspace_id=?2 ON CONFLICT(id) DO NOTHING RETURNING * (WHERE is required before ON CONFLICT in INSERT..SELECT). On no row: SELECT by id and map to replayed / gone / conflict.
   - listOpenTasks(db, wsId, {list:'inbox'}) ordered sort_order, created_at, id.
   - countOpenTasks(db, wsId) -> {inbox}.
   - rowToTask mapping.
5. Apply locally: bunx wrangler d1 migrations apply DB --local.

Done when: tests in the matching test tasks (TC-01, 11-14, 20, 21, 25, 27, 28, 32) pass.

### 2. Add idempotent create-task endpoint with validation and live broadcast

Depends on: task 1 (tasks.store); story 1 validate middleware (415 for a non-JSON body, 403 for a missing client header); story 2 workspace-auth; story 4 broadcastEvent.

Plan:
1. **`packages/shared/src/schemas.ts`:**
   - `TaskIdSchema`: `/^[0-9a-f]{32}$/`.
   - `CreateTaskInputSchema`: `{id, name trimmed 1..TASK_NAME_MAX, description? trimmed 0..TASK_DESCRIPTION_MAX default ''}`, with zod's default stripping of unknown keys (story 7 adds `projectId`).
   - The server is the final length guard. The client never truncates; it blocks submission while over the limit.
2. **`apps/api/src/lib/errors.ts`:** add `'id_conflict'` to the error-code union (architecture §6 already lists it).
3. **`apps/api/src/routes/tasks.ts`:** `POST /` under `/api/w/:workspaceId/tasks`, behind workspace-auth.
   - Parse the body; failure → 400 `validation`.
   - `insertTaskIdempotent` → created 201 / replayed 200 / gone 410 / conflict 409.
   - On created only: `ctx.waitUntil(broadcastEvent(env, ctx, wsId, {type:'task.upserted', entity, version, originClientId}))`, with `originClientId` from `X-Todoodle-Client-Id`.
   - A replay (no change) never broadcasts. Broadcast errors are logged without the request body.
4. **Register the router** in `apps/api/src/app.ts`.

Done when: TC-01..TC-19 (TC-19 now expects 415), TC-22..TC-24 and TC-30 pass, and e2e TC-80/82/86/89 pass once the UI exists.

### 3. Add Inbox task list and counts endpoints

Depends on: task 1.

Plan:
1. packages/shared/src/schemas.ts: TaskListQuerySchema {list: enum(['inbox']).default('inbox')} (stories 7/8 widen), CountsSchema {inbox: int >= 0}.
2. apps/api/src/routes/tasks.ts: GET / -> parse query (400 on bogus list) -> listOpenTasks -> {tasks}.
3. apps/api/src/routes/counts.ts: GET /api/w/:workspaceId/counts -> countOpenTasks -> {inbox}. Mount in app.ts behind workspace-auth.
4. Confirm Cache-Control: no-store is applied by finalizeResponse (story 1).

Done when: TC-25..TC-29 and TC-31 pass.

### 4. Build workspace app shell with sidebar Inbox entry and open-task count

Depends on: story 2 Workspace route (`/w/:workspaceId`), `api.ts` and `queryKeys.ts`; story 4 shell-level `<fieldset disabled>` (`canEdit`); task 3 (list/counts endpoints). Revised 2026-09-25 per architecture §12 and the React audit.

Plan:
1. **`lib/queryKeys.ts`** (story 2's factory): add `qk.tasks(wid, {list})` = `['ws', wid, 'tasks', {list}]` and `qk.counts(wid)` = `['ws', wid, 'counts']`. The counts key has **no date**.
2. **`features/tasks/queries.ts`:** `tasksQuery` and `countsQuery` option factories built from `qk`. `tasksQuery` sets `placeholderData: keepPreviousData`.
3. **`routes/workspaceLoader.ts`:** a React Router `loader` on `/w/:workspaceId` and on the fragment route. It fires `prefetchQuery` for tasks(inbox) and counts **without awaiting**, then returns `null`, so there is no waterfall and render isn't blocked. Remove any on-entry `Promise.all` from `Workspace.tsx`.
4. **`AppShell.tsx`:**
   - Uses a module-level `SidebarContent` component shared with task 16's drawer.
   - `<main aria-labelledby="view-title">`, with the view wrapped in story 4's `<fieldset disabled={!canEdit}>`.
5. **`Sidebar.tsx` + `SidebarNavItem.tsx`:**
   - `SidebarNavItem` is `React.memo` with primitive props.
   - The Inbox count comes from `useQuery({...countsQuery(wid), select: selectInboxCount})`, with `selectInboxCount` hoisted to module level.
   - Accessible name "Inbox, N open tasks"; `aria-current` on the active view.
   - The badge width is reserved, so no layout shift. `todaySlot`/`projectsSlot` render props. No rename or delete on Inbox.
6. **Direct imports:**
   - shadcn components by file.
   - lucide per-icon, via `components/icons.ts`, which re-exports only the used icons from their per-icon paths.
   - No feature barrels.

Done when: TC-40..TC-42 (task 12), TC-91 and TC-92 (task 18), and e2e TC-80 and TC-88 pass.

### 5. Build Inbox view, memoised task list with roving keyboard navigation, loading skeletons, load-failure retry and empty state

Depends on: task 4 (shell and queries). Revised 2026-09-25 per architecture §12, the React audit and the UX review.

Plan:
1. **`InboxView.tsx`:**
   - `h1` "Inbox" with `id=view-title`, then `TaskList`, then the "+ Add task" button that toggles QuickAdd. The button is hidden under `(hover: none)` and narrow layouts, where task 16's FAB takes over.
   - InboxView owns the open state and the return-focus ref, shared with the Q shortcut and the FAB.
2. **`TaskList.tsx`**, with a `status` of loading / error / ready:
   - **loading:** `SKELETON_ROW_COUNT` (5) `SkeletonRow`s in an `aria-busy` region labelled "Loading tasks".
   - **error:** "Couldn't load your tasks." with `role=alert` and a Try again button that calls `refetch()`.
   - **ready + empty:** EmptyInbox, chosen with a ternary.
   - **ready:** `<ul role=listbox aria-label=Tasks>` of TaskRows keyed by id. Renders from `useDeferredValue(tasks)`.
3. **`useRovingList.ts`:**
   - The active id lives in a ref, and exactly one row has `tabIndex=0`.
   - ↑/k, ↓/j, Home and End move focus by rewriting `tabIndex` on only the old and new DOM nodes and calling `.focus()`. **No re-render, and no `isFocused` prop.** Focus clamps at both ends.
   - `onFocus` records the active id.
   - Exposes `focusAfterRemoval(id)` (next, else previous, else the "+ Add task" button) for story 6.
   - Ignores keys coming from interactive children.
4. **`TaskRow.tsx`:**
   - `React.memo`, `role=option`, `data-task-id`, a visible 3:1 focus ring.
   - A decorative `aria-hidden` checkbox; story 6 activates it.
   - Name, plus a muted description preview only when present.
   - Per-row `content-visibility: auto` and `contain-intrinsic-size: auto TASK_ROW_INTRINSIC_HEIGHT_PX`, on the `<li>` and never on the `<ul>`.
   - A slot for the `localStatus` UI (task 7).
5. **`EmptyInbox.tsx`:** a hoisted module-level SVG, with the text "Your Inbox is clear. Press Q to add a task." or, under `(hover: none)`, "Tap + to add a task." (CSS switch).
6. **`limits.ts`:** `SKELETON_ROW_COUNT=5`, `TASK_ROW_INTRINSIC_HEIGHT_PX=44`.

Done when:
- ui-component: TC-43..TC-45 (task 12) and TC-107..TC-113 (task 18);
- unit: TC-106 (task 17);
- e2e: TC-80, TC-81, TC-85 and TC-114 (task 14).

### 6. Build inline and docked quick add with Q shortcut, non-truncating length counters, keyboard rules and destination chip

Depends on: task 5 (InboxView owns open state), task 15 (shortcut registry). Revised 2026-09-25: the old maxLength truncation is REPLACED by non-truncating counters (UX review), and the shortcut registry moved to task 15.

Plan:
1. **`lib/ids.ts`:** `newTaskId()` returns 16 random bytes (TASK_ID_BYTES) as lowercase hex.
2. **`limits.ts`:**
   - Add `LENGTH_WARNING_RATIO=0.9`, `COUNTER_ANNOUNCE_THROTTLE_MS=1_000`, `QUICK_ADD_MAX_DESCRIPTION_ROWS=6`.
   - Remove `TASK_NAME_COUNTER_THRESHOLD` and `TASK_DESCRIPTION_COUNTER_THRESHOLD`.
3. **`canSubmit.ts`** (pure):
   - `lengthStatus(len, limit)` returns normal / near / over, with the threshold `ceil(limit*LENGTH_WARNING_RATIO)`.
   - `canSubmit(name, description)` requires a non-blank trimmed name and neither field over its limit.
   - Both are derived during render, not through effects.
4. **`QuickAdd.tsx`** (`target`, `mode`: inline | docked):
   - **Fields:** name input and an auto-growing description textarea, **with no `maxLength`**.
   - **Keys:**
     - Enter in name submits if `canSubmit`.
     - Enter in description inserts a newline.
     - ⌘/Ctrl+Enter submits from either field.
     - Any Enter while `isComposing` is ignored.
     - Tab and Shift+Tab move between the fields.
     - Escape closes, discards the text, and returns focus to the opener (button, FAB or row).
   - **On submit:** `createTask({id:newTaskId(), name:name.trim(), description, target})`, then clear and refocus name, all in the handler. The box stays open.
   - **Docked mode** positions itself with `bottom: var(--kb-inset)` (task 16).
5. **`LengthCounter.tsx`:**
   - Hidden below the threshold.
   - Near the limit: "N characters left", `aria-live=polite`, announcements throttled.
   - Over the limit: "N characters over", in the destructive colour with a warning icon. The field gets `aria-invalid` and `aria-describedby`.
6. **`DestinationChip.tsx`:** a non-focusable "→ Inbox" / "→ {project}" with colour dot / "→ Today", referenced by the form's `aria-describedby`.
7. **Opening:** InboxView registers Q through task 15's `useGlobalShortcut(QUICK_ADD_KEY, open, {description:'Add task', group:'Tasks'})`.

Done when:
- ui-component: TC-51..TC-54, TC-56..TC-59 (revised) and TC-116..TC-120 (task 13);
- unit: TC-115 (task 17);
- e2e: TC-84, TC-86 (revised) and TC-87 (task 14).

### 7. Implement optimistic task creation with failed/rejected states, retry, discard and live upsert

Depends on: tasks 2, 5 and 6; story 4 live registry (`registerLiveHandler`, a `Map<type, Set<fn>>` with per-animation-frame batching) and the `clientId` context. Revised 2026-09-25 per the React audit (id index, registry) and the UX review (a11y).

Plan:
1. **`taskCache.ts`**, pure immutable helpers:
   - `appendOptimistic`, `markStatus`, `replaceWithServer`, `removeLocal`, `adjustCount`.
   - `applyTaskEvents(list, events[])`:
     - builds ONE `Map<id, index>` per batch;
     - replaces an entry when the event's version is higher, and ignores lower or equal versions;
     - inserts new ids at their sortOrder position;
     - returns the same array reference when nothing changed.
   - Every helper preserves the references of untouched items (required for the TaskRow memo).
2. **`useCreateTask.ts`:**
   - `useMutation` keyed per task id.
   - **onMutate:** append the pending row via `setQueryData(qk.tasks(...))`, and increment the count via `setQueriesData({queryKey: qk.counts(wid)})`.
   - POST with `AbortSignal.timeout(CREATE_TASK_TIMEOUT_MS)` (add `=10_000` to `limits.ts`) and the `X-Todoodle-Client` / `X-Todoodle-Client-Id` headers.
   - **Outcomes:**
     - 201/200: `replaceWithServer`.
     - network, timeout, 5xx, 403, 404: failed, count −1.
     - 400, 409, 410: rejected, count −1.
   - `retry(id)` re-POSTs the SAME id and body (failed rows only). `discard(id)` is local only. No automatic retry.
   - No cache writes in render or effects.
3. **`TaskRow.tsx`:**
   - pending: `aria-busy=true`;
   - failed: "Couldn't save this task." inside `role=alert`, plus Retry and Discard;
   - rejected: "This task can't be saved." inside `role=alert`, plus Discard only.
   - The text stays selectable.
4. **`liveHandlers.ts`:** at workspace mount, `registerLiveHandler('task.upserted', batch => setQueryData(qk.tasks(...), l => applyTaskEvents(l, batch)))`. It is added to the Set and never replaces other handlers.
5. **`test/msw/tasks.ts`:** handlers producing TaskSchema-parsed fixtures.

Done when:
- unit: TC-60..TC-64, TC-121 and TC-122 (task 11);
- ui-component: TC-65..TC-71, TC-123 and TC-124 (task 13);
- e2e: TC-82, TC-83 and TC-90.

### 8. Unit tests: task schemas, list query schema and row mapping

Cases from design test strategy:
- TC-30 CreateTaskInputSchema: each D1 class (empty, whitespace, 1, 500, 501 name; description absent/''/5000/5001; emoji; bad id 'ABC'); trimming; unknown key stripped.
- TC-31 TaskListQuerySchema: inbox ok, missing -> inbox default, bogus rejected.
- rowToTask: snake_case -> Task incl. null completed_at, numeric sort_order.
Fixtures in apps/api/test/fixtures/tasks.ts built from limits.ts constants ('a'.repeat(TASK_NAME_MAX) etc.) and realistic names ('Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞').
Run: bun run test:unit.

### 9. Integration tests: tasks migration, idempotent create, auth/CSRF and broadcast counts

vitest-pool-workers via `SELF.fetch`, against a REAL Miniflare D1 (migrations 0001+0002 applied) and the REAL WorkspaceRoom DO. D1 is never mocked (architecture §10).

**Fixtures:** workspaces are created through the real POST /api/workspaces (story 2) to get a valid `tdl_ws` cookie. A second workspace is used for the cross-workspace cases.

**Cases:**
- **TC-01..TC-18:** inputs, replay, gone, `id_conflict`, malformed id, no cookie, foreign cookie, missing CSRF header.
- **TC-19:** body sent as `text/plain` with the CSRF header present → **415 `unsupported_media_type`** (story 1's rule, architecture §6; revised 2026-09-25 from the earlier 403).
- **TC-20:** sequential creates keep order.
- **TC-21:** 10 concurrent creates get distinct sortOrder values.
- **TC-22:** one broadcast on create. A helper opens a WebSocket to `/api/w/:id/live`, sending the exact `Origin` required by story 4, and counts messages.
- **TC-23:** no broadcast on replay.
- **TC-24:** no broadcast on validation failure.
- **TC-32:** migration check — table and index exist, FK to workspaces, no CHECK in the SQL text.

Every stateful case asserts the DB row count and values BEFORE and AFTER, with a direct SELECT.

Run: bun run test:integration.

### 10. Integration tests: Inbox list and counts endpoints

Real Miniflare D1. Seed via POST create + /test/* helpers for completed/soft-deleted rows (story 6 states set directly with UPDATE since those endpoints don't exist yet).
Cases: TC-25 list returns only this workspace's open non-deleted tasks in sortOrder order (fixture includes completed, deleted and other-workspace tasks); TC-26 bogus list -> 400; TC-27 empty -> []; TC-28 counts {inbox:3} with 3 open/1 completed/1 deleted; TC-29 no cookie -> 404 for both. Assert no DB change on reads and Cache-Control: no-store.

### 11. Unit tests: task cache helpers and batched live-event application

vitest, no I/O. The isTypingTarget case TC-46 moved to task 17 together with the shortcut registry.

Cases:
- TC-60: `appendOptimistic` does not mutate its input.
- TC-61: `markStatus` failed preserves the text.
- TC-62: `replaceWithServer` replaces in place.
- TC-63: `removeLocal` preserves other references (`toBe` identity).
- TC-64: `applyTaskEvents` — a higher version replaces, an equal or lower version is ignored, a new id is inserted at its sortOrder position.
- TC-121: `applyTaskEvents` over 1,000 cached tasks with a batch of [update, stale, new] applies 2 and ignores 1; untouched items keep their references.
- TC-122: a batch of only stale events returns the identical array reference.

Run: bun run test:unit.

### 12. UI component tests: sidebar, task list, empty state and memoised rows

vitest + happy-dom + Testing Library. The network is mocked by MSW handlers from `apps/web/test/msw/tasks.ts` (schema-parsed fixtures). Loader, keyboard and list-state cases are in task 18.

Cases:
- **TC-40:** Inbox accessible name is "Inbox, 3 open tasks", with no rename/delete.
- **TC-41:** a zero count is hidden.
- **TC-42:** loading skeleton badge causes no layout shift (badge width reserved).
- **TC-43:** rows in order, with a description preview only when present.
- **TC-44:** EmptyInbox copy.
- **TC-45:** appending a task does not re-render existing memoised rows (render-count spy). It relies on taskCache preserving references and the stable row-callback context.

### 13. UI component tests: quick add (non-truncating limits, keys, destination), optimistic create, retry, discard and a11y status

vitest + happy-dom + Testing Library + MSW; fake timers for the timeout and the counter-announce throttle. The Q-guard cases TC-47..TC-50 moved to task 18 with the shortcut registry.

**QuickAdd** (revised 2026-09-25):
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

**useCreateTask:**
- TC-65: network error → failed row inside `role=alert`, with Retry and Discard.
- TC-66: 500 then 201 → retry sends the SAME id; one row.
- TC-67: discard removes the row with no request; count restored.
- TC-68: 400 → rejected; no Retry.
- TC-69: delayed response → row and count visible before it resolves.
- TC-70: timeout past `CREATE_TASK_TIMEOUT_MS` → failed.
- TC-71: count 3 → failure 3 → retry success 4.
- TC-123: pending row has `aria-busy`; the failure message is inside `role=alert`.
- TC-124: tasks live handlers coexist with another `task.upserted` handler; both are called.

### 14. E2E tests: Inbox capture, lost-response retry, limits, keyboard-only use, phone layout, touch targets, dark mode and shortcuts panel

Playwright against local wrangler dev (:8787) with a fresh local D1, on Chromium and WebKit. The workspace is created through the real home page (story 2). `page.route` is used ONLY for fault injection.

**Workflows:**

| TC | Workflow | Asserts |
|---|---|---|
| TC-80 | W1 golden path | persists after reload; sidebar count 1 |
| TC-81 | W2 three rapid adds | order kept after reload |
| TC-82 | W3 lost response (`route.fetch()` then `route.abort()`), then Retry | exactly one task after reload |
| TC-83 | W4 aborted before reaching the server, then Discard | none after reload |
| TC-84 | W5 type 'quiet' in the workspace rename field | quick add does not open |
| TC-85 | W6 empty state | appears, then disappears |
| TC-86 | W7 (revised) paste 600 chars | all 600 kept; "100 characters over"; Add disabled; after deleting 100 chars Add is enabled and the saved task has 500 chars |
| TC-87 | W8 Escape | creates nothing |
| TC-88 | W9 keyboard-only golden path | axe: no serious/critical |
| TC-89 | W10 direct API POST with a 501-char name | 400 |
| TC-90 | W11 delayed POST | row visible while it is pending |
| TC-97 | W12 iPhone 13 and iPad profiles with `hasTouch` | every button, link and checkbox in shell, list and quick add has a bounding box of at least 44×44 |
| TC-98 | W13 `colorScheme` light and dark | background token differs between the two; axe colour-contrast has zero violations in both |
| TC-105 | W14 press `?` | panel lists shortcuts; axe clean |
| TC-114 | W15 20 seeded tasks | Tab into the list, End, then Home: `activeElement` is row 20, then row 1 |
| TC-125 | W16 iPhone profile | tap the FAB, type "Milk", Enter → task added; QuickAdd docked at the bottom of the viewport; open the drawer, tap Inbox → drawer closes |

Run: bun run test:e2e.

### 15. Build the app-wide keyboard shortcut registry and the ? shortcuts panel

Depends on: task 4 (AppShell mounts the panel hook). Architecture §12 makes this the ONLY global keydown listener in the app; stories 6, 7 and 8 register through it.

Plan:
1. `lib/shortcuts.ts`:
   - A module-level `Map<normalisedKey, Set<Entry>>`, with the document keydown listener attached once, lazily, on the first registration.
   - `useGlobalShortcut(key, handler, {description, group, enabled?, allowInFields?, modifiers?: 'none'|'mod'})`. Keep the handler in a ref updated every render so registration never churns; unregister on unmount.
   - Dispatcher rules:
     - ignore when `isComposing`;
     - skip typing targets unless `allowInFields`;
     - modifier matching as per the design: Shift is allowed only for shifted characters like `?`, and `mod` means Meta on macOS and Ctrl elsewhere;
     - most recent enabled entry wins;
     - `preventDefault` only when a handler runs.
   - The single `isTypingTarget` lives here: text-like inputs, textarea, select, contentEditable.
   - `listShortcuts()` returns a snapshot for the panel. `describeShortcut()` holds static entries for list-local keys (↑/↓, j/k, Home/End).
2. `features/shortcuts/ShortcutsPanel.tsx`:
   - A shadcn Dialog, `React.lazy`-loaded, listing shortcuts grouped (General / Navigation / Tasks) with `<kbd>`.
   - Escape closes it and returns focus to the element that previously had it.
3. `features/shortcuts/useShortcutsPanel.ts`: registers `?` (SHORTCUT_HELP_KEY) and schedules the lazy chunk preload with `requestIdleCallback`, falling back to `setTimeout`.
4. `limits.ts`: `QUICK_ADD_KEY='q'`, `SHORTCUT_HELP_KEY='?'`.
5. Delete any `useGlobalShortcut.ts` / `isTypingTarget.ts` single-purpose files from the earlier plan; there is one module.
6. Direct imports only (no barrels).

Done when: unit TC-46, TC-99..TC-102; ui-component TC-47..TC-50, TC-103, TC-104; e2e TC-105 pass.

### 16. Build the phone layout: navigation drawer, floating add button, 44px touch targets and light/dark tokens

Depends on: task 4 (AppShell and SidebarContent); task 6 (QuickAdd docked mode consumes `--kb-inset`).

Plan:
1. **Constants.** In `limits.ts`: `MOBILE_BREAKPOINT_PX=768`, `MIN_TOUCH_TARGET_PX=44`. Emit them into `styles/constants.css` as CSS custom properties with a small build step (a Vite plugin or prebuild script), so CSS never hard-codes 768 or 44.
2. **`useIsNarrow()`.** A `useSyncExternalStore` over `matchMedia('(max-width: calc(var) - 0.02px))')`, computed from the constant. Returns a boolean.
3. **`NavDrawer.tsx`.**
   - A shadcn Sheet (side=left, `id=nav-drawer`), rendering the same `SidebarContent` component as the inline sidebar. It must be a module-level component, not inline.
   - A ☰ trigger in the header with `aria-label="Open navigation"`, `aria-expanded` and `aria-controls`.
   - Nav selection closes it; focus returns to ☰.
   - On a resize across the breakpoint while open: unmount, and move focus to `#view-title`.
4. **`FloatingAddButton.tsx`.**
   - Rendered when narrow or under `@media (hover: none)`: CSS handles the hover case, JS handles narrow.
   - Fixed bottom-right with `env(safe-area-inset-*)`, `aria-label="Add task"`. Hidden while QuickAdd is docked open.
5. **`lib/useKeyboardInset.ts`.**
   - While docked QuickAdd is open, subscribe to `visualViewport` `resize` and `scroll` with passive listeners.
   - Write `--kb-inset` = `max(0, innerHeight - vv.height - vv.offsetTop)` once per frame, via rAF.
   - Clean up on close. With no `visualViewport`, the value is 0.
6. **`styles/touch.css`.** Under `@media (hover: none)`, every button, link, checkbox and nav item gets a minimum 44×44 hit area. Use a transparent `::before` expansion where the visual is smaller.
7. **`styles/tokens.css`.**
   - shadcn light/dark variables via `prefers-color-scheme`, plus `color-scheme: light dark`.
   - Verify contrast of every text/background pair: 4.5:1 for text, 3:1 for UI boundaries.
   - Reduced motion disables the drawer animation.

Done when: unit TC-93; ui-component TC-94..TC-96; e2e TC-97, TC-98, TC-125 pass.

### 17. Unit tests: shortcut registry, keyboard inset, roving list maths and quick-add validation

vitest, no I/O.

Cases:
- **TC-46:** isTypingTarget classes.
- **TC-99:** registering 5 shortcuts adds exactly one document keydown listener (spy on `addEventListener`).
- **TC-100:** the most recently registered entry wins; unregistering restores the previous one.
- **TC-101:** Shift+`?` fires the `?` entry; Ctrl/Meta/Alt+q never fires q.
- **TC-102:** a handler replaced on re-render is called without re-registering (registration count unchanged).
- **TC-93:** the inset is 300 for vv.height 500, innerHeight 800, offsetTop 0; it is 0 when `visualViewport` is undefined.
- **TC-106:** roving maths clamps at both ends; `focusAfterRemoval` picks next, else previous, else the add button.
- **TC-115:** `lengthStatus` and `canSubmit` boundaries, with values built from `TASK_NAME_MAX`, `TASK_DESCRIPTION_MAX` and `LENGTH_WARNING_RATIO`:
  - name 449, 450, 500 and 501;
  - description 4499, 4500, 5000 and 5001;
  - a blank name, a 501-char name, and a 5001-char description.

Run: bun run test:unit.

### 18. UI component tests: phone shell, shortcuts panel, loader parallelism and list keyboard navigation

vitest + happy-dom + Testing Library + MSW. Use a `matchMedia` stub to set D6 viewport/pointer classes.

Cases:
- **Phone shell:**
  - TC-94: width 767 renders ☰ and no inline sidebar; width 768 renders the inline sidebar and no ☰.
  - TC-95: the drawer closes on nav selection and focus returns to ☰.
  - TC-96: the FAB opens QuickAdd docked with the name field focused; the FAB is hidden while it is open and shows again after Escape.
- **Shortcuts panel:**
  - TC-103: `?` opens a panel listing "Add task (Q)" and "Show keyboard shortcuts (?)"; Escape closes it and restores focus.
  - TC-104: typing `?` in the quick-add name field inserts the character and does not open the panel.
- **Loader:**
  - TC-91: MSW holds both responses; after `workspaceLoader` runs, both GET tasks and GET counts are recorded before either resolves, and the loader returns without awaiting.
  - TC-92: the counts key equals `['ws', wid, 'counts']`, and invalidating `['ws', wid]` refetches counts exactly once.
- **List states and keyboard:**
  - TC-107: loading renders 5 skeleton rows in an `aria-busy` region.
  - TC-108: error shows `role=alert` with Try again; clicking it refetches once and rows render.
  - TC-109: Tab, Down, Down, Tab focus sequence.
  - TC-110: memo render counters unchanged across arrow navigation.
  - TC-111: focus is remembered after Tab away and back.
  - TC-112: j/k/Home/End mirror the arrow keys.
  - TC-113: listbox/option roles, with exactly one row at `tabIndex` 0.

