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

## Details

### 1. Add projects migration 0003 and shared project limits/schemas

Depends on: stories 1, 2, 5 merged (migrations 0001, 0002 exist).

Plan:
1. migrations/0003_projects.sql: CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, color TEXT NOT NULL, sort_order REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, delete_batch_id TEXT). No DEFAULT on id (client-generated). No CHECK constraints. `color` stores the palette KEY (e.g. 'berry'), never a hex value, so the palette's light/dark values can be retuned without a migration.
2. ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id); ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT.
3. Indexes: idx_projects_ws(workspace_id, deleted, sort_order); idx_tasks_project(workspace_id, project_id, deleted, completed_at, sort_order); idx_tasks_batch(delete_batch_id).
4. limits.ts: confirm PROJECT_NAME_MAX=120, MAX_PROJECTS_PER_WORKSPACE=300; add PROJECT_ID_BYTES = TASK_ID_BYTES. PROJECT_COLORS shape is {key, label, light, dark} (values chosen and contrast-checked in task 7.18; this task only needs the keys for validation).
5. schemas.ts: ProjectSchema, CreateProjectInputSchema {id, name trimmed 1..MAX, color enum of PROJECT_COLORS keys}, UpdateProjectInputSchema (at least one field), RestoreProjectInputSchema {batchId hex}.
6. errors.ts: add limit_reached, batch_mismatch, not_deleted, project_not_found (architecture §6 already lists them).
7. Run `bunx wrangler d1 migrations apply DB --local` and the deploy safety scan locally.

Done when TC-01, TC-02 pass (tracked by test tasks).

### 2. Build project list/create/update API and extend counts with per-project open/total

Depends on: task 1; story 5 counts route + insertTaskIdempotent pattern; story 4 broadcastEvent.

Plan:
1. db/projects.ts: listProjects(db, wid) ordered sort_order, created_at, id; insertProjectIdempotent(db, {id, wid, name, color}) -> created|replayed|gone|conflict|limit using one INSERT ... SELECT ... WHERE (active count) < MAX_PROJECTS_PER_WORKSPACE ON CONFLICT(id) DO NOTHING RETURNING *, then classify via SELECT by id (limit only when id unused); getProject; updateProject (version+1, updated_at).
2. db/tasks.ts: countOpenTasks -> single GROUP BY project_id returning {inbox (project_id NULL, open), projects: {id: {open, total}}} joined to active projects so empty projects appear with zeros and deleted ones are absent.
3. routes/projects.ts: GET /, POST / (201/200/410/409 id_conflict/409 limit_reached), PATCH /:pid (404/410/400). Broadcast project.upserted on 201 and PATCH 200 via ctx.waitUntil with originClientId from X-Todoodle-Client-Id.
4. routes/counts.ts: return widened CountsSchema.
5. app.ts: mount router under workspace-auth.

Covers PRD: create_project, rename_project, project_counts, project_limit. Tests: TC-03..TC-23, TC-48, TC-76..TC-79.

### 3. Build atomic project delete and batch-scoped restore API

Depends on: task 2.

Plan:
1. db/projects.ts deleteProjectBatch(db, wid, pid, batchId): db.batch([UPDATE tasks SET deleted=1, deleted_at=now, delete_batch_id=?B, version=version+1 WHERE workspace_id=? AND project_id=? AND deleted=0 RETURNING id, UPDATE projects SET deleted=1, deleted_at=now, delete_batch_id=?B, version=version+1 WHERE id=? AND workspace_id=? AND deleted=0 RETURNING *]). One transaction; D1 rolls back on any failure.
2. restoreProjectBatch(db, wid, pid, batchId): db.batch([UPDATE tasks SET deleted=0, deleted_at=NULL, delete_batch_id=NULL, version=version+1 WHERE delete_batch_id=?B AND project_id=? AND workspace_id=? RETURNING id, UPDATE projects ... WHERE id=? AND delete_batch_id=?B RETURNING *]). Never touches tasks with delete_batch_id NULL (deleted alone).
3. lib/restoreRules.ts: pure decideRestore(project, batchId) -> ok | not_deleted | batch_mismatch (TC-73).
4. routes/projects.ts: DELETE /:pid -> 404/410/200 {batchId, deletedTaskCount}; POST /:pid/restore -> 404/409/200 {project, restoredTaskCount}. batchId = randomHexId().
5. Broadcast project.deleted {id, batchId, version} + tasks.bulk {ids, deleted:true}; project.restored + tasks.bulk {deleted:false}; add types to events.ts if missing.
6. routes/test.ts (non-production only): POST /test/sql to install/drop an abort trigger for TC-29.
7. No server-side undo window (operator recovery per story 6 retain_deleted).

Covers PRD: delete_project, delete_project_warning (total predicate matches counts), undo_project_delete, undo_restores_exact_set. Tests: TC-24..TC-35, TC-73.

### 4. Scope task create/list to projects and add task move endpoint

Depends on: task 1; story 5 create/list routes; story 6 PATCH route.

Plan:
1. schemas.ts: TaskListQuerySchema widened to discriminated union {list:'inbox'} | {list:'project', projectId}; CreateTaskInputSchema + optional projectId; story 6 UpdateTaskInputSchema + projectId: string|null.
2. db/projects.ts getActiveProjectForWorkspace(db, wid, pid) -> active | deleted | missing (missing includes other workspace).
3. db/tasks.ts: listOpenTasks honours list/projectId (inbox = project_id IS NULL); insertTaskIdempotent writes project_id (unchanged ordering rule); moveTask(db, wid, tid, projectId) sets project_id, sort_order = workspace MAX + TASK_SORT_STEP, version+1.
4. lib/moveRules.ts pure classifyMove(currentProjectId, destProjectId, destState) -> same_list | move | project_not_found (TC-74).
5. routes/tasks.ts: validate project before inserting a NEW task (replays skip validation); list=project for deleted -> 410, for other workspace -> 404 project_not_found; PATCH projectId -> 404 not_found / 410 gone / 404 project_not_found / 200 no-op without broadcast / 200 moved + task.upserted.

Covers PRD: move_task, view_project, quick_add_in_project. Tests: TC-36..TC-47, TC-74.

### 5. Apply project live events in clients and redirect viewers of deleted projects

Depends on: tasks 2-4 (server broadcasts); story 4 `registerLiveHandler` in `apps/web/src/features/live/registry.ts` (Map<type, Set<fn>>), clientId context and rAF-batched notifyManager; story 2 `apps/web/src/lib/queryKeys.ts`.

Plan (architecture section 12 binding):
1. projectCache.ts: pure applyProjectEvent(projects, event) (ignore version <= cached; upsert; remove on deleted; insert in sort order on restored) keeping a Map by id alongside the array (js-index-maps); adjustCounts(counts, delta) clamped at 0 (TC-49, TC-50).
2. registerProjectLiveHandlers.ts: for each of project.upserted/deleted/restored, tasks.bulk, task.upserted call registerLiveHandler(type, fn) and return the unregister functions. Do NOT edit story 4's dispatcher and do NOT replace story 5/6/8 handlers for task.upserted/tasks.bulk — this handler only touches project list caches and counts (TC-88).
3. Handlers skip originClientId === own; setQueryData(queryKeys.projects(wid)); invalidateQueries(queryKeys.counts(wid)) (counts key has no date) on project.deleted/restored, tasks.bulk, task.upserted; on tasks.bulk deleted remove ids from loaded project list caches via setQueriesData({queryKey: ['ws', wid, 'tasks']}).
4. If project.deleted id === routed projectId: useWorkspaceNavigate to Inbox (hash carried if present), toast 'This project was deleted'.
5. Register once per workspace from Workspace.tsx (not per row — client-event-listeners). No startTransition around cache writes (no effect on query updates; story 4 batches per frame).

Covers PRD: viewed_project_deleted, project_counts. Tests: TC-49, TC-50, TC-88 (unit), TC-62, TC-63, TC-85 (ui-component), TC-75 (integration), TC-69 (e2e).

### 6. Build sidebar Projects section with create dialog, colour palette, counts and inline rename

Depends on: task 2 (API), story 5 Sidebar projectsSlot + mobile drawer + countsQuery, story 2 useWorkspaceNavigate/route and `apps/web/src/lib/queryKeys.ts`. Name-field and touch/colour rules come from task 7.18 (projects.ui_accessible_controls) — build this task's inputs on its NameField.

Plan (vercel-react-best-practices + architecture section 12):
1. queries.ts projectsQuery(wid) with key queryKeys.projects(wid); Workspace.tsx adds it to the existing Promise.all prefetch with counts and list (async-parallel). Counts writes only via setQueryData(queryKeys.counts(wid)) — no dated key exists.
2. useProjects: module-level select building {list, byId: Map, searchKey per project} (js-index-maps; searchKey used by the Move to picker).
3. useProjectMutations: create (client id via story 5 id helper), update; onMutate cancel+snapshot+setQueryData projects & counts; onError rollback + toast (role=alert); id_conflict -> regenerate once; onSettled invalidate counts.
4. ProjectsSidebarSection: heading + '+' (preloads lazy CreateProjectDialog chunk on hover/focus: bundle-conditional/bundle-preload); empty hint hoisted JSX; ternary rendering; plain container (NO content-visibility on the container).
5. ProjectRow: module-level memo; props {wid, id, name, colorKey, isActive} only — the parent passes NO count; count read inside the row via useQuery({...countsQuery(wid), select}) with a module-level selectOpenCount bound per id via useCallback (single count source, TC-64); row element style content-visibility:auto + contain-intrinsic-size:auto 44px (TC-89); onPointerEnter/onFocus -> preloadProjectView() + prefetchQuery(tasksQuery(wid,{list:'project',projectId})) (TC-84); per-icon lucide imports; hidden count when 0; '...' menu Rename/Delete; on narrow screens selecting a row closes story 5's drawer.
6. CreateProjectDialog + ColorPalette: Radix Dialog + RadioGroup, 12 swatches labelled from PROJECT_COLORS[].label, first preselected; Add disabled when NameField state is empty/over or at limit (derived in render); limit message; navigate to new project on success.
7. RenameProjectInline: Enter saves, Escape cancels; blank handled by NameField rules (no request, previous name restored, hint).

Covers PRD: create_project, rename_project, project_counts, project_limit. Tests: TC-51..TC-55, TC-64, TC-84, TC-89 (ui-component), TC-68, TC-71, TC-86 (e2e).

### 7. Add project view route with empty state and project-targeted quick add

Depends on: tasks 4 and 6; story 5 list view (roving tabindex, per-row content-visibility, skeleton rows) + QuickAdd with target chip; story 2 queryKeys.ts.

Plan:
1. useWorkspaceNavigate.ts: wrapper over navigate() that carries location.hash when present (create if story 2 has not).
2. App.tsx: lazy child route /w/:workspaceId/project/:projectId (architecture section 12 route names); export preloadProjectView() thunk from the same module for sidebar rows.
3. tasks/queries.ts: tasksQuery(wid, {list, projectId}) keyed via queryKeys.tasks(wid, {list, projectId}).
4. ProjectView.tsx: route entry prefetches projects, counts and project tasks in one Promise.all (no waterfall); header with colour dot + name from projects byId; React 19 <title> '<project> · <workspace>'; reuse story 5 list view; empty state 'No tasks yet. Press Q to add one.' (ternary); on 404/410 or unknown id -> Inbox + toast 'Project not found'.
5. QuickAdd.tsx: accept projectId prop; include in POST; target chip '→ <project name>'; optimistic insert into project list cache and counts.projects[id].open +1 on queryKeys.counts(wid).

Covers PRD: view_project, quick_add_in_project. Tests: TC-61 (ui-component), TC-65, TC-70, TC-72 (e2e).

### 8. Add project delete confirmation with task count and Undo toast

Depends on: tasks 3 and 6; story 6 `apps/web/src/features/undo/showUndoToast.ts` (UNDO_WINDOW_MS = 10_000, pauses on hover/focus, role=status, ⌘/Ctrl+Z bound by story 6).

Plan:
1. DeleteProjectDialog (lazy, preloaded when the row menu opens): Radix AlertDialog — confirmation KEPT for projects (product-owner decision 2026-09-25); copy from counts.projects[id].total with a module-level cached Intl.PluralRules: 0 -> 'Delete "X"?', 1 -> 'and its 1 task?', N -> 'and its N tasks?'; initial focus on Cancel; on close focus returns to the '...' trigger, or the Projects heading if the row is gone.
2. useProjectMutations.deleteProject: optimistic removal from projects, counts and project list cache; navigate to Inbox if routed to it; returns batchId; rollback + role=alert toast on failure.
3. showUndoToast({message: 'Project deleted', onUndo}) — no project-specific timer or duration; onUndo awaits the pending delete promise then POST restore {batchId}; invalidate projects/counts/lists; failure toast "Couldn't undo".

Covers PRD: delete_project, delete_project_warning, undo_project_delete (10 s), undo_restores_exact_set (UI side). Tests: TC-57..TC-59 (ui-component, fake timers incl. hover pause), TC-66, TC-67 (e2e).

### 9. Add 'Move to…' menu entry and optimistic moveTask mutation

Depends on: tasks 4 and 5; story 6 TaskActionsMenu, useTaskMutations and focus-after-action helper; story 4 useEditGuard for 410. The picker UI itself is task 7.19 (tasks.ui_move_picker) — the old flat Radix submenu is dropped (does not scale to 300 projects).

Plan:
1. TaskActionsMenu.tsx: add item 'Move to…' with shortcut hint 'M'; selecting it calls openMovePicker(taskId); opening the menu calls preloadMoveToPicker().
2. useTaskMutations.moveTask(taskId, projectId|null): optimistic removal from source list cache (setQueriesData on ['ws', wid, 'tasks']), append to destination cache if loaded, adjustCounts on queryKeys.counts(wid); move focus to next row (else previous) via story 6 helper; PATCH {projectId}; on 404 project_not_found / 5xx rollback + role=alert toast; on 410 route to useEditGuard 'This task was deleted'.

Covers PRD: move_task. Tests: TC-60 (ui-component), TC-65, TC-87 (e2e); server contract TC-36..TC-43.

### 10. Unit tests: project schemas, restore/move decisions, cache reducer, migration scan

Cases from design test strategy:
- TC-02 migration safety scan on migrations/0003_projects.sql (no CHECK/DROP TABLE/MODIFY/ADD CONSTRAINT).
- TC-48 zod: names length 0/1/120/121, whitespace-only, padded trimmed; colour key in/out of PROJECT_COLORS; id pattern valid/malformed; update requires at least one field.
- TC-73 decideRestore: {active, any} -> not_deleted; {deleted, matching} -> ok; {deleted, other} -> batch_mismatch; {deleted, ''} -> batch_mismatch.
- TC-74 classifyMove: null->null and P->P same_list; null->P active and P->null move; deleted/other-workspace/missing -> project_not_found.
- TC-49 applyProjectEvent: version <= cached ignored; newer replaces; deleted removes; restored inserts in sort order.
- TC-50 adjustCounts: move/delete/restore deltas; never negative.
- TC-88 live registry coexistence: a story-5-style task.upserted handler and the project handler both run once per event; unregistering the project handler leaves the other intact.
- TC-80 filterDestinations: '', 'WORK', 'cafe' vs 'Café', 'inb', 'zzz', '  wo  '.
- TC-81 filterDestinations boundaries: 0 projects -> [Inbox]; 300 projects -> 301 options in sort order; current list disabled.
- TC-83 PROJECT_COLORS: every light value >= 3:1 vs light sidebar and dialog backgrounds, every dark value >= 3:1 vs dark backgrounds (contrastRatio); 12 unique keys and labels.
- TC-90 nameFieldState: 0, spaces, 1, 107, 108, 120, 121 -> empty, empty, ok, ok, near(12), near(0), over(1).
- TC-93 normaliseForSearch (packages/shared/src/search.ts): 'Café' -> 'cafe'; 'ÅNGSTRÖM' -> 'angstrom'; 'a   b' -> 'a b'; '' -> ''.
No I/O; realistic fixtures (hex ids, unicode and accented names).

### 11. Integration tests: projects migration, list/counts, create (idempotent, limit), update

vitest-pool-workers, SELF.fetch through real Hono + workspace-auth + Miniflare D1 + WorkspaceRoom (test WebSocket counts broadcasts). Assert DB state before/after via direct SQL.
Cases: TC-01 (migration on 0001-0002 DB, tasks stay Inbox); TC-03..TC-05 (projects + counts, empty, grouped open/total incl. deleted-alone task and deleted project, other-workspace 404 identical body); TC-06..TC-17 (create: valid with colour = PROJECT_COLORS[0].key and stored as that key, 120/121, '', spaces, padded, colour not a palette key (e.g. '#ff0000') / bad id, 299/300/300-with-deleted, missing CSRF header, duplicate names); TC-18..TC-23 (update: rename version bump + broadcast, blank, colour only, deleted 410, missing 404, other workspace 404); TC-76..TC-79 (idempotent replay single row + single broadcast, deleted id 410, foreign id 409 id_conflict, replay at limit 200).
Counts are requested without any date parameter (architecture section 12: counts key carries no date); assert the response shape is unchanged when story 8's optional date is absent.
Fixtures: two workspaces, 16-byte hex ids, unicode/emoji and accented names, 300 projects via one batch insert.

### 12. Integration tests: project delete atomicity and exact-set batch restore

Real Miniflare D1 + DO via SELF.fetch; state asserted before/after with SQL.
Cases: TC-24 (0 tasks); TC-25 (3 open + 2 completed: same batchId, version+1, Inbox untouched, broadcasts, counts entry removed); TC-26 (deleted-alone task untouched by delete); TC-27 (delete deleted -> 410); TC-28 (missing/other workspace -> 404, no change); TC-29 (abort trigger installed via /test/sql on projects UPDATE -> 500 and tasks unchanged: batch atomic); TC-30 (restore matching batch: rows restored, completed_at preserved, broadcasts); TC-31 (deleted-alone task stays deleted after restore - negative); TC-32 (wrong batch 409 batch_mismatch no change); TC-33 (active 409 not_deleted); TC-34 (404); TC-35 (B1/B2 cycle).

### 13. Integration tests: project-scoped task create/list and task move

Real D1 + DO via SELF.fetch.
Cases: TC-36 (Inbox -> P: sort_order = workspace MAX + TASK_SORT_STEP, version+1, broadcast, counts); TC-37 (P -> Inbox); TC-38 (same list: no version bump, no broadcast - negative); TC-39..TC-41 (deleted/other-workspace/missing destination -> 404 project_not_found, task unchanged); TC-42 (deleted task -> 410); TC-43 (completed task keeps completed_at); TC-44 (create with active projectId, client id); TC-45 (create with deleted projectId -> 404, no row); TC-46 (list=project vs list=inbox partition); TC-47 (list=project deleted 410, other workspace 404, missing projectId 400).

### 14. Integration test: project events fan out through WorkspaceRoom to other clients only

TC-75: open WebSockets for clients a and b on workspace W and one socket on workspace V via /api/w/:id/live (real Miniflare DO). Client b deletes a project with 2 tasks then restores it via SELF.fetch with X-Todoodle-Client-Id b. Assert a receives project.deleted {id, batchId, version} and tasks.bulk {2 ids, deleted:true}, then project.restored and tasks.bulk {deleted:false}; all carry originClientId b; V's socket receives nothing (negative: no cross-workspace delivery).

### 15. UI component tests: sidebar projects, create dialog, rename, touch visibility, render isolation

vitest + happy-dom + Testing Library; network via MSW with realistic fixtures; matchMedia stubbed per test; fake timers for HINT_VISIBLE_MS.
Cases:
- TC-51 empty hint.
- TC-52 dot + name for each project, count hidden at 0, 12 shown, Inbox count.
- TC-53 create dialog: '' and spaces -> Add disabled + 'Name can't be empty' after touch; 1 char enabled, no counter; 108 chars '12 characters left'; 120 '0 characters left'; paste 130 -> all 130 kept, '10 characters over' with icon, Add disabled; 12 labelled swatches, first selected, arrow keys move selection.
- TC-54 optimistic row then rollback + role=alert toast on 500.
- TC-55 limit message and disabled Add at 300 cached / on 409.
- TC-56 rename: Enter saves; Escape cancels; Enter with '' and blur with spaces -> no request, old name back, hint announced (role=status) and hidden after HINT_VISIBLE_MS; 500 rollback + toast.
- TC-64 React Profiler: count change on P1 does not re-render P2; ProjectRow receives no count prop.
- TC-82 '...' visible under hover:none; hidden under hover:hover until focus-within; hit areas of row, '+', '...' >= 44x44.
- TC-84 pointerenter/focus on a row -> preloadProjectView called once and prefetchQuery with queryKeys.tasks(wid,{list:'project',projectId}).
- TC-89 each ProjectRow has content-visibility:auto + contain-intrinsic-size; container has neither.

### 16. UI component tests: project view, delete/undo dialog, Move to picker and M shortcut, live handlers

vitest + happy-dom + Testing Library + MSW; fake timers for UNDO_WINDOW_MS (10 s); fake emitter dispatching through the REAL live registry; matchMedia stubbed for narrow cases.
Cases:
- TC-57 dialog copy for total 0/1/12; initial focus on Cancel.
- TC-58 confirm -> row removed -> Undo sends restore with batchId -> row back; toast gone at 10 s; hovering at 9 s keeps it past 10 s, then it expires after the remaining time on leave.
- TC-59 deleting viewed project navigates to Inbox, hash carried only when present.
- TC-60 Move to via task menu: Inbox first + disabled with check (current list), type 'wo' -> Work/Woodwork only, Enter -> PATCH {projectId}, task leaves view, focus on next row; 500 -> rollback + toast; Escape -> focus back on the task row.
- TC-61 project empty state text; quick add POST includes projectId; target chip '→ Work'.
- TC-62 live project.deleted for viewed project -> Inbox + 'This project was deleted'.
- TC-63 live project.upserted updates sidebar and header.
- TC-85 counts written only under ['ws',wid,'counts']; no dated counts key in the cache; live tasks.bulk triggers exactly one counts refetch (MSW call count).
- TC-91 M: task focused -> picker for that task; focus in quick-add input -> no picker, 'm' typed; no focused task -> nothing.
- TC-92 narrow viewport -> picker inside bottom Drawer; options >= 44 px tall.

### 17. E2E: project create/move, delete+undo exact set, rename, collaboration, reload, cookie-less access, keyboard, phone

Playwright (Chromium) against local wrangler dev with fresh D1; seed via /test/seed.
Workflows:
- W1/TC-65 create 'Work', add 2 tasks with Q, move one to Inbox through the task menu picker (counts 2 -> 1, Inbox +1).
- W2/TC-66 delete project with 2 open + 1 completed, dialog says 3 tasks, Undo (within 10 s) restores all with completion preserved.
- W3/TC-67 task deleted alone stays gone after project undo.
- W4/TC-68 rename persists across reload.
- W5/TC-69 two contexts: B deletes P viewed by A -> A on Inbox with notice within LIVE_UPDATE_TARGET_MS; B creates Q -> appears in A sidebar.
- W6/TC-70 reload /w/:id/project/:pid in remembering context shows project.
- W7/TC-71 keyboard-only create/rename/delete with focus return.
- W8/TC-72 fresh context without cookie on project path shows not-found and no project/task text in DOM.
- W9/TC-86 phone context (390x844, hasTouch): open ☰ drawer; '...' visible without hover; bounding boxes of rows, '+', '...', swatches >= 44x44; rename by tap; tap project closes drawer; task menu > Move to… opens bottom sheet; tap Inbox moves the task.
- W10/TC-87 keyboard only: ↓ to second task, M, type 'jo', Enter -> moved to 'Job' and focus on next row; M then Escape -> picker closes, focus stays on the row.

### 18. Make project controls touch-friendly, colour-legible, and give clear blank/over-limit name feedback

Depends on: task 7.1 (shared limits), story 5 (MIN_TOUCH_TARGET_PX, LENGTH_WARNING_RATIO, MOBILE_BREAKPOINT_PX constants, dark-mode theme tokens). Do before task 7.6, which consumes NameField and the palette.

Plan:
1. limits.ts: PROJECT_COLORS -> 12 entries {key, label, light, dark}; pick hex values with >= 3:1 contrast against the light and dark sidebar and dialog backgrounds (compute with contrast.ts, record ratios in a comment); HINT_VISIBLE_MS = 3_000. Server zod schema validates `key`.
2. contrast.ts: pure contrastRatio(hexA, hexB) per WCAG relative luminance (test-only consumer).
3. nameFieldState(value, max) -> {status: 'empty'|'ok'|'near'|'over', remaining}; near threshold = ceil(LENGTH_WARNING_RATIO * max).
4. NameField.tsx: no maxLength (never truncates pasted text); counter shown when near/over ('N characters left' / 'N characters over' in red with an icon); 'Name can't be empty' helper via aria-describedby + role=status, auto-hidden after HINT_VISIBLE_MS; exposes `canSubmit`. Reuse story 5/6's NameField if it already exists; otherwise create it here and note it for them.
5. ProjectRow/ProjectsSidebarSection: '...' button `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`; 44x44 hit areas (min-h-11 min-w-11 or ::before hit area) for rows, '+', '...', swatches; dots aria-hidden, name always rendered.
6. ColorPalette: swatches aria-label from label; dot colour from theme (light/dark).

Covers PRD: touch_controls, colour_legible, blank_name_hint, name_over_limit. Tests: TC-83, TC-90 (unit), TC-53, TC-56, TC-82 (ui-component), TC-86 (e2e).

### 19. Build the searchable Move to picker and the M shortcut

Depends on: task 7.9 (moveTask + menu entry), task 7.6 (useProjects with searchKey), story 5 `useGlobalShortcut`/`isTypingTarget` in apps/web/src/lib/shortcuts.ts, roving-tabindex list ref accessor, `useIsNarrow`; story 4 shell-level fieldset (offline disables).

Plan:
0. Shared pieces (design section 'shared-combobox'; reused by story 11 Finder and its switcher migration): `components/combobox/ResponsiveCommand.tsx` (Popover/Dialog >= MOBILE_BREAKPOINT_PX, Drawer below, Command shouldFilter={false}, focus return), `OptionRow.tsx` (memo, >= MIN_TOUCH_TARGET_PX, adornment, aria-disabled), `HighlightedText.tsx` (<mark> ranges), and `packages/shared/src/search.ts` `normaliseForSearch()` (NFKD, strip combining marks, toLocaleLowerCase('und'), collapse whitespace).
1. filterDestinations(options, query, currentListId): trim query; normaliseForSearch(query); substring match against precomputed searchKey (= normaliseForSearch(name) in the useProjects select); Inbox always first when it matches; current list returned with disabled:true. Pure, unit-tested (TC-80, TC-81).
2. MoveToPicker.tsx (React.lazy + exported preloadMoveToPicker): built on ResponsiveCommand + OptionRow; input autofocus, placeholder 'Type a project name'; options render from useDeferredValue(query); 'No matching projects' empty state; ↑/↓ skip disabled; Enter selects -> moveTask then close; Escape clears query first, then closes and returns focus to the task row. Anchored to the row on wide screens, bottom sheet below MOBILE_BREAKPOINT_PX. Direct imports only.
3. useMoveShortcut.ts: useGlobalShortcut('m', handler, {description: 'Move task to…'}) — handler exits when isTypingTarget or no focused task id; calls preloadMoveToPicker() then opens. Mounted once in Workspace.tsx.
4. Picker registered in story 5's '?' shortcuts panel via the description above.

Covers PRD: move_search, move_shortcut, move_task. Tests: TC-80, TC-81, TC-93 (unit), TC-60, TC-91, TC-92 (ui-component), TC-86, TC-87 (e2e).

