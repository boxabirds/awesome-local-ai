# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope ``, effort `client default`, client claude 2.1.283 (Claude Code), host Apple M2 16GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | See which version of Todoodle is live in each environment | DONE | 18.7 | None | None | None | — | — | green | 11/11 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Start a private workspace instantly, with no sign-up, and get a secret link to return to it | DONE | 31.9 | None | None | None | — | — | green | 33/33 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | Get back to my workspaces from this browser without hunting for the link | DONE | 21.5 | None | None | None | — | — | green | 47/48 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 4 | Bring others into a workspace by sharing its link | DONE | 30.8 | None | None | None | — | — | green | 49/51 |  | 0 / 0 | 0 | — | throttled 0% |
| 5 | Capture a task into my Inbox in seconds | DONE | 31.9 | None | None | None | — | — | red | 76/81 |  | 0 / 0 | 0 | — | throttled 0% |
| 6 | Tick off, edit, and remove tasks — with undo when I slip | DONE | 39.2 | None | None | None | — | — | green | 91/104 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Group related tasks into projects so work stays organised | DONE | 62.4 | None | None | None | — | — | green | 94/120 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 7 stories, 236 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/7, final acceptance 94/120, stalled 0, partial 0, 0 lines in src+tests.

> Stories 3 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 13 by the agent | 3916 / 24 | `pipeline.ts` (195), `README.md` (105), `deps.ts` (100), `vitest.config.ts` (84), `wrangler.toml` (72), `validate.ts` (71), +46 more |
| 2 | 19 by the agent | 5014 / 134 | `cookie.ts` (138), `SharePanel.tsx` (136), `Workspace.tsx` (125), `tokens.ts` (121), `workspaces.ts` (114), `WorkspaceNameEditor.tsx` (103), +55 more |
| 3 | 14 by the agent | 2865 / 70 | `WorkspaceSwitcher.tsx` (107), `UnsavedLinkWarning.tsx` (87), `RememberedRow.tsx` (78), `cookie.ts` (75), `WorkspaceSkeleton.tsx` (71), `remembered.ts` (70), +38 more |
| 4 | 13 by the agent | 4390 / 99 | `LiveConnection.ts` (355), `editGuard.ts` (205), `network.ts` (129), `useEditGuard.ts` (104), `WorkspaceNameEditor.tsx` (98), `errors.ts` (80), +39 more |
| 5 | 19 by the agent | 4989 / 114 | `shortcuts.ts` (174), `InboxView.tsx` (168), `useCreateTask.ts` (140), `QuickAdd.tsx` (138), `taskCache.ts` (116), `useRovingList.ts` (113), +50 more |
| 6 | 14 by the agent | 4954 / 162 | `useTaskMutations.ts` (278), `TaskDetailSheet.tsx` (271), `TaskRow.tsx` (196), `cacheOps.ts` (155), `tasks.ts` (142), `createUndo.ts` (115), +42 more |
| 7 | 20 by the agent | 6299 / 445 | `projects.ts` (200), `useProjectMutations.ts` (193), `ProjectRow.tsx` (183), `MoveToPicker.tsx` (183), `TaskListView.tsx` (168), `ProjectsSidebarSection.tsx` (154), +71 more |

### Earlier stories broken or fixed

- **Story 7 broke 0, fixed 1** earlier held-out tests (story 7: Group related tasks into projects so work stays organised; story 7 task 17: E2E: project create/move, delete+undo exact set, rename, collaboration, reload, cookie-less access, keyboard, phone; story 7 task 16: UI component tests: project view, delete/undo dialog, Move to picker and M shortcut, live handlers; story 7 task 15: UI component tests: sidebar projects, create dialog, rename, touch visibility, render isolation; story 7 task 10: Unit tests: project schemas, restore/move decisions, cache reducer, migration scan; story 7 task 19: Build the searchable Move to picker and the M shortcut; story 7 task 9: Add 'Move to…' menu entry and optimistic moveTask mutation; story 7 task 8: Add project delete confirmation with task count and Undo toast; story 7 task 7: Add project view route with empty state and project-targeted quick add; story 7 task 6: Build sidebar Projects section with create dialog, colour palette, counts and inline rename; story 7 task 18: Make project controls touch-friendly, colour-legible, and give clear blank/over-limit name feedback; story 7 task 5: Apply project live events in clients and redirect viewers of deleted projects; story 7 task 14: Integration test: project events fan out through WorkspaceRoom to other clients only; story 7 task 13: Integration tests: project-scoped task create/list and task move; story 7 task 12: Integration tests: project delete atomicity and exact-set batch restore; story 7 task 11: Integration tests: projects migration, list/counts, create (idempotent, limit), update; story 7 task 4: Scope task create/list to projects and add task move endpoint; story 7 task 3: Build atomic project delete and batch-scoped restore API; story 7 task 2: Build project list/create/update API and extend counts with per-project open/total; story 7 task 1: Add projects migration 0003 and shared project limits/schemas). Source files it changed most: `projects.ts` (200), `useProjectMutations.ts` (193), `ProjectRow.tsx` (183), `MoveToPicker.tsx` (183), `TaskListView.tsx` (168), `ProjectsSidebarSection.tsx` (154), +71 more.
  - story 6: 14/20 → 15/20; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
