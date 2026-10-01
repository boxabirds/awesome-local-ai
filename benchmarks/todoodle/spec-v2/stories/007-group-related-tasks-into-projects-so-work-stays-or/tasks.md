# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Add projects migration 0003 and shared project limits/schemas | proposed | implementation | projects.schema |
| 2 | Build project list/create/update API and extend counts with per-project open/total | proposed | implementation | projects.api_crud |
| 3 | Build atomic project delete and batch-scoped restore API | proposed | implementation | projects.api_delete_restore |
| 4 | Scope task create/list to projects and add task move endpoint | proposed | implementation | tasks.project_scope_api |
| 5 | Apply project live events in clients and redirect viewers of deleted projects | proposed | implementation | projects.live_events |
| 6 | Build sidebar Projects section with create dialog, colour palette, counts and inline rename | proposed | implementation | projects.ui_sidebar |
| 7 | Add project view route with empty state and project-targeted quick add | proposed | implementation | projects.ui_project_view |
| 8 | Add project delete confirmation with task count and Undo toast | proposed | implementation | projects.ui_delete_undo |
| 9 | Add 'Move to…' menu entry and optimistic moveTask mutation | proposed | implementation | tasks.ui_move_menu |
| 10 | Unit tests: project schemas, restore/move decisions, cache reducer, migration scan | proposed | test:unit | projects.schema, projects.api_crud, projects.api_delete_restore, tasks.project_scope_api, projects.live_events, tasks.ui_move_picker, projects.ui_accessible_controls |
| 11 | Integration tests: projects migration, list/counts, create (idempotent, limit), update | proposed | test:integration | projects.schema, projects.api_crud |
| 12 | Integration tests: project delete atomicity and exact-set batch restore | proposed | test:integration | projects.api_delete_restore |
| 13 | Integration tests: project-scoped task create/list and task move | proposed | test:integration | tasks.project_scope_api |
| 14 | Integration test: project events fan out through WorkspaceRoom to other clients only | proposed | test:integration | projects.live_events |
| 15 | UI component tests: sidebar projects, create dialog, rename, touch visibility, render isolation | proposed | test:ui-component | projects.ui_sidebar, projects.ui_accessible_controls |
| 16 | UI component tests: project view, delete/undo dialog, Move to picker and M shortcut, live handlers | proposed | test:ui-component | projects.ui_project_view, projects.ui_delete_undo, tasks.ui_move_menu, tasks.ui_move_picker, projects.live_events |
| 17 | E2E: project create/move, delete+undo exact set, rename, collaboration, reload, cookie-less access, keyboard, phone | proposed | test:e2e | projects.api_crud, projects.api_delete_restore, tasks.project_scope_api, projects.live_events, projects.ui_sidebar, projects.ui_project_view, projects.ui_delete_undo, tasks.ui_move_menu, tasks.ui_move_picker, projects.ui_accessible_controls |
| 18 | Make project controls touch-friendly, colour-legible, and give clear blank/over-limit name feedback | proposed | implementation | projects.ui_accessible_controls |
| 19 | Build the searchable Move to picker and the M shortcut | proposed | implementation | tasks.ui_move_picker |
| 20 | Extend /test/seed with project fields and add local-only /test/fault named fault injection | proposed | implementation | projects.schema, projects.api_delete_restore |

## Details

### 1. Add projects migration 0003 and shared project limits/schemas

Depends on: stories 1, 2, 5 merged (migrations 0001, 0002 exist; story 2's `tokens.ts`; story 5's `CLIENT_ID_BYTES`).

Plan:
1. migrations/0003_projects.sql: CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, color TEXT NOT NULL, sort_order REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, delete_batch_id TEXT). No DEFAULT on id (client-generated). No CHECK constraints. `color` stores the palette KEY (e.g. 'berry'), never a hex value, so the palette's light/dark values can be retuned without a migration.
2. ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id); ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT.
3. Indexes: idx_projects_ws(workspace_id, deleted, sort_order); idx_tasks_project(workspace_id, project_id, deleted, completed_at, sort_order); idx_tasks_batch(delete_batch_id).
4. limits.ts: confirm PROJECT_NAME_MAX=120, MAX_PROJECTS_PER_WORKSPACE=300. Project ids and batch ids use story 5's `CLIENT_ID_BYTES` (D-44) — do NOT add `PROJECT_ID_BYTES`.
5. tokens.ts (story 2 owns; add entries only, D-42): the 12 `PROJECT_COLORS` entries `{key, label, light, dark}` (values chosen and checked in task 7.18) and the exported key list used by zod. No contrast code in this story.
6. schemas.ts: ProjectSchema, CreateProjectInputSchema {id (CLIENT_ID_BYTES hex), name trimmed 1..MAX, color enum of PROJECT_COLORS keys}, UpdateProjectInputSchema (at least one field), RestoreProjectInputSchema {batchId hex}.
7. errors.ts: add limit_reached, batch_mismatch, project_not_found; `gone` responses carry `{entity}`. `not_deleted` is retired (D-29) — do not add it.
8. Run `bunx wrangler d1 migrations apply DB --local` and the deploy safety scan locally.

Done when TC-01, TC-02 pass (tracked by test tasks).

### 2. Build project list/create/update API and extend counts with per-project open/total

Depends on: task 1; story 5 counts route + insertTaskIdempotent pattern; story 4 `broadcast(c, wid, event)`.

Plan:
1. db/projects.ts: listProjects(db, wid) ordered sort_order, created_at, id; insertProjectIdempotent(db, {id, wid, name, color}) -> created|replayed|gone|conflict|limit using one INSERT ... SELECT ... WHERE (active count) < MAX_PROJECTS_PER_WORKSPACE ON CONFLICT(id) DO NOTHING RETURNING *, then classify via SELECT by id (limit only when id unused); getProject; updateProject (version+1, updated_at; unchanged values → no write).
2. db/tasks.ts: countOpenTasks -> single GROUP BY project_id returning {inbox (project_id NULL, open), projects: {id: {open, total}}} joined to active projects so empty projects appear with zeros and deleted ones are absent. `total` is the source of the delete-dialog count (D-31); no `taskCount` field on the list.
3. routes/projects.ts: GET /, POST / (201/200/410 gone {entity:'project'}/409 id_conflict/409 limit_reached), PATCH /:pid (404/410 gone {entity:'project'}/400; 200 no-op without broadcast when unchanged). Broadcast project.upserted on 201 and on a changing PATCH via `broadcast(c, wid, event)` (D-26; it calls waitUntil itself — no extra wrapper, no broadcastEvent, no direct room.broadcast); originClientId from X-Todoodle-Client-Id.
4. routes/counts.ts: return widened CountsSchema (story 8 later adds today?/date).
5. app.ts: mount router under workspace-auth.

Covers PRD: create_project, rename_project, project_counts, project_limit. Tests: TC-03..TC-23, TC-48, TC-76..TC-79.

### 3. Build atomic project delete and batch-scoped restore API

Depends on: task 2; task 7.20 (`applyTestFault` hook used by TC-29).

Plan:
1. db/projects.ts deleteProjectBatch(db, wid, pid, batchId): db.batch([UPDATE tasks SET deleted=1, deleted_at=now, delete_batch_id=?B, version=version+1 WHERE workspace_id=? AND project_id=? AND deleted=0 RETURNING id, UPDATE projects SET deleted=1, deleted_at=now, delete_batch_id=?B, version=version+1 WHERE id=? AND workspace_id=? AND deleted=0 RETURNING *]), passed through task 7.20's `applyTestFault(env, batch)` (no-op outside local). One transaction; D1 rolls back on any failure.
2. restoreProjectBatch(db, wid, pid, batchId): db.batch([UPDATE tasks SET deleted=0, deleted_at=NULL, delete_batch_id=NULL, version=version+1 WHERE delete_batch_id=?B AND project_id=? AND workspace_id=? RETURNING id, UPDATE projects ... WHERE id=? AND delete_batch_id=?B RETURNING *]). Never touches tasks with delete_batch_id NULL (deleted alone).
3. lib/restoreRules.ts: pure decideRestore(project, batchId) -> ok | noop | batch_mismatch; decideDelete(project) -> delete | noop (TC-73). No `not_deleted` (retired, D-29).
4. routes/projects.ts: DELETE /:pid -> 404 / **204 no body, no broadcast (already deleted)** / 200 {batchId, deletedTaskCount}; POST /:pid/restore -> 404 / 409 batch_mismatch / **200 {project, restoredTaskCount:0} no-op, no broadcast (active)** / 200 {project, restoredTaskCount}. batchId = randomHexId() of CLIENT_ID_BYTES.
5. Broadcast via `broadcast(c, wid, event)` (D-26): project.deleted {id, batchId, version} + tasks.bulk {ids, deleted:true}; project.restored + tasks.bulk {ids, deleted:false} (D-25); add the project.* members to story 4's events union if missing.
6. No server-side undo window (operator recovery per story 6 retain_deleted); UNDO_WINDOW_MS is a UI affordance.

Covers PRD: delete_project, delete_project_warning (total predicate matches counts), undo_project_delete, undo_restores_exact_set. Tests: TC-24..TC-35, TC-73.

### 4. Scope task create/list to projects and add task move endpoint

Depends on: task 1; story 5 create/list routes; story 6 PATCH and single-task restore routes.

Plan:
1. schemas.ts: TaskListQuerySchema widened to discriminated union {list:'inbox'} | {list:'project', projectId}, both with story 6's `include_completed=true|false` (D-31; no `project:<id>` form, no `list=today`); CreateTaskInputSchema + optional projectId; story 6 UpdateTaskInputSchema + projectId: string|null.
2. db/projects.ts getActiveProjectForWorkspace(db, wid, pid) -> active | deleted | missing (missing includes other workspace).
3. db/tasks.ts: listTasks honours list/projectId/includeCompleted (inbox = project_id IS NULL); insertTaskIdempotent writes project_id (unchanged ordering rule); moveTask(db, wid, tid, projectId) sets project_id, sort_order = workspace MAX + TASK_SORT_STEP, version+1.
4. lib/moveRules.ts pure classifyMove(currentProjectId, destProjectId, destState) -> same_list | move | project_not_found; pure restoreBlockedByProject(state) -> allowed | blocked (TC-74).
5. routes/tasks.ts: validate project before inserting a NEW task (replays skip validation) -> 404 project_not_found; list=project for deleted -> 410 `gone {entity:'project'}`, for missing/other workspace -> 404 project_not_found; PATCH projectId -> 404 not_found / 410 `gone {entity:'task'}` / 404 project_not_found / 200 no-op without broadcast / 200 moved + task.upserted via `broadcast(c, wid, event)` (D-26).
6. **Delta to story 6 restore (D-30):** in `POST /tasks/:tid/restore`, before story 6's logic, if the task's project is deleted → 410 `gone {entity:'project'}`, no write, no broadcast. Inbox/active-project tasks keep story 6's behaviour.

Covers PRD: move_task, view_project, quick_add_in_project, restore_task_in_deleted_project. Tests: TC-36..TC-47, TC-74, TC-94.

### 5. Apply project live events in clients and redirect viewers of deleted projects

Depends on: tasks 2-4 (server broadcasts); story 4 `registerLiveHandler` in `apps/web/src/features/live/registry.ts` (Map<type, Set<fn>>), clientId context and rAF-batched notifyManager; story 2 `apps/web/src/lib/queryKeys.ts`; story 5 `focusAfterRemoval` and its `task.*` counts invalidation (D-38).

Plan (architecture §7/§12, D-25):
1. projectCache.ts: pure applyProjectEvent(projects, event) (ignore version <= cached; upsert; remove on deleted; insert in sort order on restored) keeping a Map by id alongside the array; adjustCounts(counts, delta) clamped at 0 (TC-49, TC-50).
2. registerProjectLiveHandlers.ts: for each of project.upserted/deleted/restored, tasks.bulk, task.upserted call registerLiveHandler(type, fn) and return the unregister functions. Do NOT edit story 4's dispatcher and do NOT replace other stories' handlers (TC-88).
3. Handlers skip originClientId === own. project.upserted/restored → setQueryData(queryKeys.projects(wid)) via applyProjectEvent; project.* → invalidate queryKeys.counts(wid).
4. **tasks.bulk {ids, deleted?} has refetch semantics (D-25):** invalidateQueries({queryKey: ['ws', wid, 'tasks']}) and invalidate queryKeys.counts(wid). Never patch task lists with setQueriesData from this event.
5. task.upserted: only when the task's projectId differs from the cached list it sits in (moved by another client), invalidate source and destination list queries. Do not register a second counts invalidation for task.* (story 5 owns it, D-38).
6. If project.deleted id === routed projectId: useWorkspaceNavigate to Inbox (fragment only when the session began from one, D-13), toast 'This project was deleted'. Grid focus for removed rows is handled by story 5's focusAfterRemoval (D-04).
7. Register once per workspace from the workspace route (not per row). No startTransition around cache writes.

Covers PRD: viewed_project_deleted, project_counts. Tests: TC-49, TC-50, TC-88 (unit), TC-62, TC-63, TC-85 (ui-component), TC-75 (integration), TC-69 (e2e).

### 6. Build sidebar Projects section with create dialog, colour palette, counts and inline rename

Depends on: task 2 (API); story 5 AppShell `sidebar` slot + mobile drawer + countsQuery + `prefetchWorkspaceData` in `routes/workspaceLoader.ts` + `CLIENT_ID_BYTES` id helper; story 2 `workspacePath`, `lib/queryKeys.ts`, `lib/lazyWithRetry.ts`; story 4 `useCanEdit()`; task 7.7's `useWorkspaceNavigate`. Name-field and touch/colour rules come from task 7.18 — build this task's inputs on its NameField.

Plan (architecture §12 + cross-story resolutions):
1. queries.ts projectsQuery(wid) with key queryKeys.projects(wid). Add it **inside story 5's `prefetchWorkspaceData(wid)`** (D-39); do not edit a Promise.all in Workspace.tsx. Counts writes only via `setQueriesData({queryKey: queryKeys.counts(wid)}, …)` (D-37/D-38) — no dated key exists.
2. useProjects: module-level select building {list, byId: Map, searchKey = normaliseForSearch(name)}.
3. useProjectMutations: create (client id via story 5's CLIENT_ID_BYTES helper), update; onMutate cancel+snapshot+setQueryData projects & setQueriesData counts; onError rollback + toast (role=alert); errors mapped by body.error (D-20); id_conflict -> regenerate once; onSettled invalidate counts.
4. ProjectsSidebarSection: 'Projects' heading with tabIndex=-1 (D-19 fallback target) + '+' (preloads the CreateProjectDialog chunk loaded via `lazyWithRetry` on hover/focus); empty hint hoisted JSX; plain container (NO content-visibility on the container).
5. ProjectRow: module-level memo; props {wid, id, name, colorKey, isActive} only — count read inside via useQuery select (TC-64); per-row content-visibility:auto + contain-intrinsic-size:auto 44px (TC-89); onPointerEnter/onFocus -> preloadProjectView() + prefetchQuery(tasksQuery(wid,{list:'project',projectId,includeCompleted:false})) (TC-84); per-icon lucide deep imports (D-43); count hidden when 0; '...' menu Rename/Delete; on narrow screens selecting a row closes story 5's drawer; navigation via useWorkspaceNavigate + workspacePath.
6. **Edit gating (D-10):** there is no fieldset anywhere in the app; every control that sends a change is self-gated via `useCanEdit()` — gate '+', Rename, Delete, Add, Save and inline rename with `useCanEdit()` (sidebar controls and portalled dialogs alike); row navigation is not gated (works offline); typed text kept (TC-97).
7. CreateProjectDialog + ColorPalette: Radix Dialog + RadioGroup, 12 swatches labelled from PROJECT_COLORS[].label, first preselected; Add disabled when NameField state is empty/over, at limit, or !canEdit; limit message; navigate to new project on success.
8. RenameProjectInline: Enter saves, Escape cancels; blank handled by NameField rules.

Covers PRD: create_project, rename_project, project_counts, project_limit, offline_project_controls. Tests: TC-51..TC-55, TC-64, TC-84, TC-89, TC-97 (ui-component), TC-68, TC-71, TC-86 (e2e).

### 7. Add project view route with empty state and project-targeted quick add

Depends on: tasks 4 and 6; story 5 `TaskGrid` (APG grid, per-row content-visibility, skeleton rows), QuickAdd target union, `prefetchWorkspaceData`; story 2 `App.tsx` route table, `workspacePath`, fragment carry-over rule and session-origin state, `lazyWithRetry`, queryKeys.ts; story 6 'Show completed' / `include_completed`.

Plan:
1. useWorkspaceNavigate.ts (created here, earliest user): wrapper over navigate() that keeps the fragment on /w/:id/* paths **only when the session began from a fragment link** (D-13, story 2's session-origin state); sessions opened by id navigate path-only.
2. App.tsx (story 2 owns the table, D-12): register the child route `project/:projectId` under `/w/:workspaceId`, loaded via `lazyWithRetry`; export preloadProjectView() for sidebar rows. Build links with story 2's `workspacePath(wid, view)`.
3. tasks/queries.ts: tasksQuery(wid, {list, projectId?, includeCompleted}) keyed via queryKeys.tasks (D-37); request sends `list=project&projectId=…&include_completed=…` (D-31).
4. ProjectView.tsx: route loader calls story 5's prefetchWorkspaceData(wid) and prefetchQuery(project tasks) in one Promise.all (no waterfall); header with colour dot + name from projects byId; React 19 <title> '<project> · <workspace>'; render story 5's TaskGrid; empty state 'No tasks yet. Press Q to add one.'; on project_not_found / gone {entity:'project'} (by body.error, D-20) or unknown id -> Inbox + toast 'Project not found'.
5. QuickAdd.tsx (story 5): pass target `{kind:'project', projectId}` (D-40); POST includes projectId; chip '→ <project name>'; optimistic insert via setQueriesData on ['ws', wid, 'tasks'] and counts.projects[id].open +1 via setQueriesData on queryKeys.counts(wid).

Covers PRD: view_project, quick_add_in_project. Tests: TC-61 (ui-component), TC-59 (fragment rule, via task 7.8's flow), TC-65, TC-70, TC-72 (e2e).

### 8. Add project delete confirmation with task count and Undo toast

Depends on: tasks 3, 4 and 6; story 6 `features/undo/showUndoToast.ts` (`showUndoToast({message, onUndo})`, UNDO_WINDOW_MS, pause on hover/focus, role=status, ⌘/Ctrl+Z bound by story 6) and `features/tasks/mutations.ts`; story 4 `useCanEdit()` and `GoneError{entity}`.

Plan:
1. DeleteProjectDialog (loaded with `lazyWithRetry`, preloaded when the row menu opens): Radix AlertDialog — confirmation KEPT for projects; copy from **`counts.projects[id].total`** (D-31, not a taskCount field) with a module-level cached Intl.PluralRules: 0 -> 'Delete "X"?', 1 -> 'and its 1 task?', N -> 'and its N tasks?'; initial focus on Cancel; Confirm disabled while `!canEdit` (portalled, D-10).
2. Focus on close (D-19): Cancel/Escape → the row's '...' trigger; if that trigger is no longer connected (row removed by this confirm or by a collaborator), focus the 'Projects' heading (tabIndex=-1).
3. useProjectMutations.deleteProject: optimistic removal from projects, counts (setQueriesData) and project list caches; navigate to Inbox if routed to it; returns batchId, or null on **204** (already deleted elsewhere, D-29) — then no Undo toast and no error (TC-102); rollback + role=alert toast on failure.
4. showUndoToast({message: 'Project deleted', onUndo}) (D-41) — no project-specific timer; onUndo awaits the pending delete promise then POST restore {batchId}; a 200 no-op restore counts as success; invalidate projects/counts/lists; failure toast "Couldn't undo".
5. **Delta to story 6 (D-30):** in `features/tasks/mutations.ts` `restoreTask`, handle `GoneError{entity:'project'}` → toast 'Its project was deleted' (role=alert), keep the task out of every cache, invalidate counts; other errors unchanged.

Covers PRD: delete_project, delete_project_warning, undo_project_delete, undo_restores_exact_set (UI side), restore_task_in_deleted_project (UI side), offline_project_controls. Tests: TC-57, TC-58, TC-59, TC-95, TC-97, TC-102 (ui-component), TC-66, TC-67, TC-100 (e2e).

### 9. Add 'Move to…' menu entry and optimistic moveTask mutation

Depends on: tasks 4 and 5; story 6 `TaskActionsMenu` and `features/tasks/mutations.ts` (D-43 names); story 5 `useTaskGrid` (`focusAfterRemoval`, D-04); story 4 `useEditGuard` for 410 and `useCanEdit()`. The picker UI and `openMovePicker` are task 7.19 — the old flat Radix submenu is dropped.

Plan:
1. TaskActionsMenu.tsx: add item 'Move to…' with shortcut hint 'M'; selecting it calls `openMovePicker(taskId, {returnFocusTo: <row name cell>})` (D-05); opening the menu calls preloadMoveToPicker(). The item is disabled while `!canEdit` (menu is portalled, D-10).
2. mutations.ts moveTask(taskId, projectId|null): optimistic removal from source list caches (setQueriesData on ['ws', wid, 'tasks'], D-37), append to destination cache if loaded, adjustCounts via setQueriesData on queryKeys.counts(wid); **in the same tick, call focusAfterRemoval(taskId)** so focus moves when the task leaves the list, not on server success (D-08); then PATCH {projectId}.
3. Errors by body.error: project_not_found / 5xx → rollback (row reappears) + role=alert toast, focus not moved again; gone {entity:'task'} → useEditGuard 'This task was deleted'.
4. No `focusAfterAction.ts`, no `setActiveRow`, no list ref accessor.

Covers PRD: move_task, offline_project_controls. Tests: TC-60, TC-98 (ui-component), TC-65, TC-87 (e2e).

### 10. Unit tests: project schemas, restore/move decisions, cache reducer, migration scan

Cases from design test strategy (TC ids: TC-02, TC-48, TC-49, TC-50, TC-73, TC-74, TC-80, TC-81, TC-83, TC-88, TC-90, TC-93):
- TC-02 migration safety scan on migrations/0003_projects.sql (no CHECK/DROP TABLE/MODIFY/ADD CONSTRAINT).
- TC-48 zod: names length 0/1/120/121, whitespace-only, padded trimmed; colour key in/out of PROJECT_COLORS keys; id pattern (CLIENT_ID_BYTES hex) valid/malformed; update requires at least one field.
- TC-73 decideRestore: {active, any} -> noop; {deleted, matching} -> ok; {deleted, other} -> batch_mismatch; {deleted, ''} -> batch_mismatch. decideDelete: {active} -> delete; {deleted} -> noop. No not_deleted outcome (D-29).
- TC-74 classifyMove: null->null and P->P same_list; null->P active and P->null move; deleted/other-workspace/missing -> project_not_found. restoreBlockedByProject: no project / active -> allowed; deleted -> blocked (D-30).
- TC-49 applyProjectEvent: version <= cached ignored; newer replaces; deleted removes; restored inserts in sort order.
- TC-50 adjustCounts: move/delete/restore deltas; never negative.
- TC-88 live registry coexistence: a story-5-style task.upserted handler and the project handler both run once per event; unregistering the project handler leaves the other intact.
- TC-80 filterDestinations: '', 'WORK', 'cafe' vs 'Café', 'inb', 'zzz', '  wo  '.
- TC-81 filterDestinations boundaries: 0 projects -> [Inbox]; 300 projects -> 301 options in sort order; current list disabled; current list undefined -> none disabled.
- TC-83 PROJECT_COLORS entries in story 2's tokens.ts, checked with story 2's contrast checker: every light value >= 3:1 vs light sidebar and dialog backgrounds, every dark value >= 3:1 vs dark backgrounds; 12 unique keys and labels.
- TC-90 nameFieldState: 0, spaces, 1, 107, 108, 120, 121 -> empty, empty, ok, ok, near(12), near(0), over(1).
- TC-93 normaliseForSearch (packages/shared/src/search.ts): 'Café' -> 'cafe'; 'ÅNGSTRÖM' -> 'angstrom'; 'a   b' -> 'a b'; '' -> ''.
No I/O; realistic fixtures (hex ids, unicode and accented names).

### 11. Integration tests: projects migration, list/counts, create (idempotent, limit), update

vitest-pool-workers, SELF.fetch through real Hono + workspace-auth + Miniflare D1 + WorkspaceRoom (test WebSocket counts broadcasts). Assert DB state before/after via direct SQL.
TC ids: TC-01, TC-03..TC-23, TC-76..TC-79.
Cases: TC-01 (migration on 0001-0002 DB, tasks stay Inbox); TC-03..TC-05 (projects + counts, empty, grouped open/total incl. deleted-alone task and deleted project, other-workspace 404 identical body); TC-06..TC-17 (create: valid with colour = PROJECT_COLORS[0].key and stored as that key, 120/121, '', spaces, padded, colour not a palette key (e.g. '#ff0000') / bad id, 299/300/300-with-deleted, missing CSRF header, duplicate names); TC-18..TC-23 (update: rename version bump + one broadcast, repeat with the same name is a 200 no-op with no version bump and no broadcast; blank; colour only; deleted → 410 `{error:'gone', entity:'project'}`; missing 404; other workspace 404); TC-76..TC-79 (idempotent replay single row + single broadcast, deleted id → 410 gone {entity:'project'}, foreign id 409 id_conflict, replay at limit 200).
Counts are requested without any date parameter (counts key carries no date); assert the response shape `{inbox, projects}` when story 8's optional date is absent.
Fixtures via /test/seed with project fields (task 7.20): two workspaces, CLIENT_ID_BYTES hex ids, unicode/emoji and accented names, 300 projects via one batch insert.

### 12. Integration tests: project delete atomicity and exact-set batch restore

Real Miniflare D1 + DO via SELF.fetch; state asserted before/after with SQL.
TC ids: TC-24..TC-35, TC-96.
Cases: TC-24 (0 tasks); TC-25 (3 open + 2 completed: same batchId, version+1, Inbox untouched, project.deleted {id, batchId, version} + tasks.bulk {ids, deleted:true} broadcast, counts entry removed); TC-26 (deleted-alone task untouched by delete); TC-27 (delete already-deleted → **204 no body**, row and version unchanged, no broadcast); TC-28 (missing/other workspace → 404, no change); TC-29 (`POST /test/fault {abortNextUpdate:'projects'}` armed → DELETE 500 and tasks + project unchanged: batch atomic; next DELETE succeeds because the fault is one-shot); TC-30 (restore matching batch: rows restored, completed_at preserved, broadcasts); TC-31 (deleted-alone task stays deleted after restore - negative); TC-32 (wrong batch 409 batch_mismatch no change); TC-33 (restore active → **200 {project, restoredTaskCount:0} no-op**, version unchanged, no broadcast); TC-34 (404); TC-35 (B1/B2 cycle).
TC-96: `/test/fault` returns 200 and fires once with ENVIRONMENT=local; 404 with ENVIRONMENT=staging and production; `/test/seed` 404 in production; body with a table outside the enum, or SQL text, → 400 validation.

### 13. Integration tests: project-scoped task create/list and task move

Real D1 + DO via SELF.fetch.
TC ids: TC-36..TC-47, TC-94.
Cases: TC-36 (Inbox -> P: sort_order = workspace MAX + TASK_SORT_STEP, version+1, broadcast, counts); TC-37 (P -> Inbox); TC-38 (same list: no version bump, no broadcast - negative); TC-39..TC-41 (deleted/other-workspace/missing destination -> 404 project_not_found, task unchanged); TC-42 (deleted task -> 410 `gone {entity:'task'}`); TC-43 (completed task keeps completed_at); TC-44 (create with active projectId, client id); TC-45 (create with deleted projectId -> 404 project_not_found, no row); TC-46 (list=project&projectId vs list=inbox partition with include_completed=false; include_completed=true adds P's completed tasks); TC-47 (list=project deleted -> 410 `{error:'gone', entity:'project'}`, other workspace -> 404 project_not_found, missing projectId -> 400).
TC-94 (D-30, story 6's restore route): task deleted alone in P then P deleted -> 410 gone {entity:'project'}, task unchanged, no broadcast; task deleted in P's batch -> same; task deleted alone in active P -> 200 restored + task.restored; task deleted alone in Inbox -> 200 (story 6 behaviour unchanged).

### 14. Integration test: project events fan out through WorkspaceRoom to other clients only

TC ids: TC-75.
TC-75: open WebSockets for clients a and b on workspace W and one socket on workspace V via /api/w/:id/live (real Miniflare DO). Client b deletes a project with 2 tasks, restores it, then deletes it and deletes it again via SELF.fetch with X-Todoodle-Client-Id b. Assert a receives project.deleted {id, batchId, version} and tasks.bulk {ids: 2 ids, deleted:true}, then project.restored and tasks.bulk {ids, deleted:false}; all carry originClientId b; the second (204 no-op) delete produces no event; V's socket receives nothing (negative: no cross-workspace delivery). Broadcasts go through story 4's `broadcast(c, wid, event)`.

### 15. UI component tests: sidebar projects, create dialog, rename, touch visibility, render isolation

vitest + happy-dom + Testing Library; network via MSW with realistic fixtures; matchMedia stubbed per test; fake timers for NAME_HINT_MS; `useCanEdit()` driven through story 4's store.
TC ids: TC-51, TC-52, TC-53, TC-54, TC-55, TC-56, TC-64, TC-82, TC-84, TC-89, TC-97.
Cases:
- TC-51 empty hint.
- TC-52 dot + name for each project, count hidden at 0, 12 shown, Inbox count.
- TC-53 create dialog: '' and spaces -> Add disabled + 'Name can't be empty' after touch; 1 char enabled, no counter; 108 chars '12 characters left'; 120 '0 characters left'; paste 130 -> all 130 kept, '10 characters over' with icon, Add disabled; 12 labelled swatches, first selected, arrow keys move selection.
- TC-54 optimistic row then rollback + role=alert toast on 500.
- TC-55 limit message and disabled Add at 300 cached / on 409 limit_reached.
- TC-56 rename: Enter saves; Escape cancels; Enter with '' and blur with spaces -> no request, old name back, hint announced (role=status) and hidden after NAME_HINT_MS; 500 rollback + toast.
- TC-64 React Profiler: count change on P1 does not re-render P2; ProjectRow receives no count prop.
- TC-82 '...' visible under hover:none; hidden under hover:hover until focus-within; hit areas of row, '+', '...' >= 44x44.
- TC-84 pointerenter/focus on a row -> preloadProjectView called once and prefetchQuery with queryKeys.tasks(wid,{list:'project',projectId,includeCompleted:false}).
- TC-89 each ProjectRow has content-visibility:auto + contain-intrinsic-size; container has neither.
- TC-97 canEdit false: '+' disabled; Rename/Delete items disabled; Add, Save and delete Confirm disabled; typed text in an open create dialog kept; clicking a project row still navigates; canEdit true re-enables all.

### 16. UI component tests: project view, delete/undo dialog, Move to picker and M shortcut, live handlers

vitest + happy-dom + Testing Library + MSW (incl. held-pending responses to observe optimistic focus); fake timers for UNDO_WINDOW_MS; fake emitter dispatching through the REAL live registry; matchMedia stubbed for narrow cases; `useCanEdit()` via story 4's store.
TC ids: TC-57, TC-58, TC-59, TC-60, TC-61, TC-62, TC-63, TC-85, TC-91, TC-92, TC-95, TC-98, TC-99, TC-101, TC-102.
Cases:
- TC-57 dialog copy for counts.projects[id].total 0/1/12; initial focus on Cancel; Cancel -> '...' trigger; Confirm -> 'Projects' heading; collaborator removes the row while open then Cancel -> 'Projects' heading (D-19).
- TC-58 confirm -> row removed -> showUndoToast({message, onUndo}) -> Undo sends restore with batchId -> row back; toast gone at UNDO_WINDOW_MS; hovering at 9 s keeps it past the window, then it expires after the remaining time on leave.
- TC-59 deleting viewed project navigates to Inbox: fragment kept when the session began from a fragment link; path-only when opened by id (D-13).
- TC-60 Move to via task menu from a grid: Inbox first + disabled with check; type 'wo' -> Work/Woodwork; Enter with PATCH held pending -> task leaves grid and focus on next row BEFORE the PATCH resolves (D-08); PATCH {projectId}; then 500 -> row reappears + role=alert toast, focus not moved again; Escape -> focus back on the task row.
- TC-61 project empty state text; QuickAdd target {kind:'project', projectId}; POST includes projectId; chip '→ Work'.
- TC-62 live project.deleted for viewed project -> Inbox + 'This project was deleted'.
- TC-63 live project.upserted updates sidebar and header.
- TC-85 counts written only via setQueriesData under queryKeys.counts(wid); no dated counts key; live tasks.bulk invalidates (no setQueriesData on task lists) -> exactly one counts refetch and one refetch per active list query (MSW call count).
- TC-91 M registered {key:'m', scope:'grid'}: task focused (any cell) -> picker for that task; focus in quick-add input -> no picker, 'm' typed; no focused task -> nothing; detail sheet open -> nothing.
- TC-92 narrow viewport -> picker inside bottom Drawer; options >= 44 px tall.
- TC-95 story 6 single-task Undo gets 410 gone {entity:'project'} -> toast 'Its project was deleted' (role=alert); task in no list cache; counts invalidated; no "Couldn't undo".
- TC-98 canEdit false: 'Move to…' item disabled; M does nothing; open picker shows 'Moving is paused while offline', options aria-disabled, Enter sends no PATCH.
- TC-99 openMovePicker(taskId, {returnFocusTo: finderInput}) without anchor: centred Dialog (wide), Drawer (narrow); Escape -> focus finderInput; after a move -> focus finderInput and PATCH sent.
- TC-101 type 'wo' + Escape -> closes in one press, Escape not delivered to quick add underneath; reopen, 'wo', ✕ -> query '' and picker stays open with focus in input; ✕ absent when empty; no focusable descendant inside any role=option.
- TC-102 DELETE 204 -> project stays removed, showUndoToast not called, no error toast.

### 17. E2E: project create/move, delete+undo exact set, rename, collaboration, reload, cookie-less access, keyboard, phone

Playwright against local wrangler dev with fresh D1; seed via /test/seed with project fields (task 7.20). Matrix per story 1 (D-36): desktop chromium + webkit for all specs; W9 tagged @mobile also runs on mobile-webkit (iPhone 13) and mobile-chromium (Pixel 7).
TC ids: TC-65, TC-66, TC-67, TC-68, TC-69, TC-70, TC-71, TC-72, TC-86, TC-87, TC-100.
Workflows:
- W1/TC-65 create 'Work', add 2 tasks with Q, move one to Inbox through the task menu picker (counts 2 -> 1, Inbox +1).
- W2/TC-66 delete project with 2 open + 1 completed, dialog says 3 tasks, focus lands on 'Projects' heading, Undo (within UNDO_WINDOW_MS) restores all with completion preserved.
- W3/TC-67 task deleted alone stays gone after project undo.
- W4/TC-68 rename persists across reload.
- W5/TC-69 two contexts: B deletes P viewed by A -> A on Inbox with notice within LIVE_UPDATE_TARGET_MS; B creates Q -> appears in A sidebar.
- W6/TC-70 reload /w/:id/project/:pid in remembering context shows project.
- W7/TC-71 keyboard-only create/rename/delete with focus return (trigger, or 'Projects' heading after delete).
- W8/TC-72 fresh context without cookie on project path shows story 2's NotFound state and no project/task text in DOM.
- W9/TC-86 @mobile phone context: open ☰ drawer; '...' visible without hover; bounding boxes of rows, '+', '...', swatches >= 44x44; rename by tap; tap project closes drawer; task menu > Move to… opens bottom sheet; tap Inbox moves the task.
- W10/TC-87 keyboard only: ↓ to second task, M, type 'jo', Enter -> moved to 'Job' and focus on next row; M, type 'x', one Escape -> picker closes, focus stays on the row.
- W11/TC-100 two contexts: A deletes task T in P (Undo toast visible); B deletes P; A presses Undo within UNDO_WINDOW_MS -> 'Its project was deleted'; T in no list in A or B; after B undoes P's deletion T is still deleted.

### 18. Make project controls touch-friendly, colour-legible, and give clear blank/over-limit name feedback

Depends on: task 7.1 (shared schemas); story 2 (`packages/shared/src/tokens.ts`, its `styles/tokens.css` generator and contrast checker, `NAME_HINT_MS`); story 5 (MIN_TOUCH_TARGET_PX, LENGTH_WARNING_RATIO, MOBILE_BREAKPOINT_PX, dark-mode theme tokens). Do before task 7.6, which consumes NameField and the palette.

Plan:
1. tokens.ts (story 2 owns; add entries only, D-42): the 12 PROJECT_COLORS entries {key, label, light, dark}; pick hex values with ≥ 3:1 contrast against the light and dark sidebar and dialog backgrounds, verified with **story 2's contrast checker** (record ratios in a comment). No `packages/shared/src/contrast.ts` in this story (deleted). Server zod validates `key`.
2. nameFieldState(value, max) -> {status: 'empty'|'ok'|'near'|'over', remaining}; near threshold = ceil(LENGTH_WARNING_RATIO * max).
3. NameField.tsx: no maxLength; counter when near/over ('N characters left' / 'N characters over' in red with an icon); 'Name can't be empty' helper via aria-describedby + role=status, auto-hidden after **`NAME_HINT_MS`** (story 2's constant; `HINT_VISIBLE_MS` is not created, D-44); exposes `canSubmit`. Reuse story 5/6's NameField if it already exists; otherwise create it here and note it for them.
4. ProjectRow/ProjectsSidebarSection: '...' button `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`; 44x44 hit areas for rows, '+', '...', swatches; dots aria-hidden, name always rendered.
5. ColorPalette: swatches aria-label from label; dot colour from the theme token (`--project-<key>`).

Covers PRD: touch_controls, colour_legible, blank_name_hint, name_over_limit. Tests: TC-83, TC-90 (unit), TC-53, TC-56, TC-82 (ui-component), TC-86 (e2e).

### 19. Build the searchable Move to picker and the M shortcut

Depends on: task 7.9 (moveTask + menu entry), task 7.6 (useProjects with searchKey); story 5 `lib/shortcuts.ts` (`useGlobalShortcut({key, scope, description})`, overlay scope stack, `isTypingTarget`), `useTaskGrid` (`getFocusedTaskId`), `lib/useIsNarrow.ts`, AppShell; story 2 `lazyWithRetry`; story 4 `useCanEdit()`.

Plan:
0. Shared pieces owned here (design 'Shared combobox'; story 11 extends): `components/combobox/ResponsiveCommand.tsx` (Popover with anchor, centred Dialog without, Drawer below MOBILE_BREAKPOINT_PX via lib/useIsNarrow; Command shouldFilter={false}; search input with visible ✕ clear button; Escape closes in one press without clearing and stopPropagation; pushes an overlay scope; focus return with D-19 fallback; `footer?` slot outside the listbox for story 11's action bar), `OptionRow.tsx` (memo, ≥ MIN_TOUCH_TARGET_PX, non-focusable adornment, aria-disabled), `HighlightedText.tsx` (<mark> ranges), `packages/shared/src/search.ts` `normaliseForSearch()`. **Binding rule: options contain no interactive children** (D-15/D-43).
1. openMovePicker.ts (D-05): `openMovePicker(taskId, {returnFocusTo, anchor?})` backed by a module-level store; `MoveToPickerHost` mounted once in AppShell. Works from the Finder without an anchored row; reads name/current list from any cached copy of the task, else marks nothing current.
2. filterDestinations(options, query, currentListId?): trim + normaliseForSearch; substring match against searchKey; Inbox first; current list disabled; unknown current list → none disabled (TC-80, TC-81).
3. MoveToPicker.tsx (lazyWithRetry + preloadMoveToPicker): placeholder 'Type a project name'; useDeferredValue(query); 'No matching projects'; ↑/↓ skip disabled; Enter selects → moveTask then close; **Escape closes without clearing (D-16)**; ✕ clears and keeps it open; each open starts with an empty query. Focus: after a grid move focus already moved (D-08); otherwise returnFocusTo, falling back to the view heading.
4. **Gating (D-10):** portalled → `useCanEdit()`; offline: options aria-disabled, Enter/click inert, note 'Moving is paused while offline'.
5. useMoveShortcut.ts (D-14): `useGlobalShortcut({key:'m', scope:'grid', description:'Move task to…'})`; handler exits when isTypingTarget, no getFocusedTaskId(), overlay open, or !canEdit; calls preloadMoveToPicker() then openMovePicker(id, {returnFocusTo, anchor: row}). Listed in story 5's '?' panel via the description.

Covers PRD: move_search, move_shortcut, move_task, move_escape_clear, offline_project_controls. Tests: TC-80, TC-81, TC-93 (unit), TC-60, TC-91, TC-92, TC-98, TC-99, TC-101 (ui-component), TC-86, TC-87 (e2e).

### 20. Extend /test/seed with project fields and add local-only /test/fault named fault injection

Depends on: task 7.1 (projects table); story 1's `/test/*` registry in `apps/api/src/routes/test.ts` (every route 404 in production); story 5's `/test/seed`.

Replaces the old `/test/sql` plan (removed by D-35 because it ran arbitrary SQL on staging).

Plan:
1. `/test/seed` extension (delta to story 5, D-35): widen the one seed zod schema to `{workspaceId, projects?: [{ref, name, color, deleted?}], tasks?: [{…story 5 fields, projectRef?, deleted?}]}`. Insert projects first in one batch with generated `CLIENT_ID_BYTES` ids (300 rows = one insert), resolve `projectRef` for tasks, give a deleted project and its `deleted` seeded tasks one shared `delete_batch_id`, and return `{projects: {[ref]: id}, tasks: [ids]}`. No second seed route.
2. `POST /test/fault` (owned here): **local only** — 404 unless `ENVIRONMENT === 'local'` (so 404 on staging and production). Body zod: `{abortNextUpdate: z.enum(['projects','tasks'])}`; anything else (incl. SQL text) → 400 validation. Arms a one-shot fault in `lib/testFaults.ts`.
3. `lib/testFaults.ts`: `applyTestFault(env, statements)` — only when local and armed, replaces the named table's UPDATE in the batch with a statement that raises, then disarms. Outside local it returns the statements untouched (no branch reachable in production).
4. Document the route in story 1's registry comment block.

Tests: TC-29 (uses the fault inside the real D1 batch), TC-96 (environment gating, one-shot, enum-only body). Seed shape exercised by TC-04, TC-13..TC-15, TC-25, TC-26 and e2e W2, W3.

