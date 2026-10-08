# Story 7: Select, move, resize and delete several objects at once

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 2 | Implement geometry and generic group operations in board-model | done |
| 5 | E2E: colleague deletes one of my selected notes (TC-35) | done |
| 6 | Write geometry and group-operation unit tests first (TC-01 to TC-10) | done |
| 7 | Write registry unit tests first (TC-11, TC-12, duplicate registration) | done |
| 8 | Implement object type registry and register sticky notes | done |
| 9 | Write selection reducer unit tests first (TC-13 to TC-15) | done |
| 10 | Implement multi-selection state, outlines and selection bar | done |
| 11 | Implement Shift+drag marquee selection | done |
| 12 | Implement generic transform gesture: group move and bounding-box resize handles | done |
| 13 | Implement selection keyboard commands: select all, clear, nudge, delete | done |
| 14 | Component tests: selection bar, marquee, transform gesture and keyboard (TC-16 to TC-31) | done |
| 15 | E2E: reorganise a cluster and full-capacity reorganisation (TC-32, TC-33, TC-34, TC-36) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean.
- `npx vitest run` (unit + component + integration) — 27 test files, all pass
  (geometry TC-01..08, board-model group TC-09..10, registry TC-11..12, selection
  TC-13..15, component TC-16..31, plus all pre-existing suites).
- `npx playwright test --project=chromium` — 33 tests pass:
  - sticky-notes.spec.ts (TC-01..TC-10, TC-28, TC-33*, TC-34*) — unchanged, still pass;
  - live-collaboration.spec.ts (TC-11..TC-14) — unchanged, still pass;
  - multi-select.spec.ts (TC-32..TC-36) — new.

  (* The story-2 sticky-notes file contains its own TC-33/TC-34 numbers for
  auto-fit/centre-creation; the story-7 TC-32..TC-36 live in multi-select.spec.ts.)

## Test file map

| Suite | File | Covers |
|---|---|---|
| unit | `tests/unit/geometry.test.ts` | TC-01..TC-08 |
| unit | `tests/unit/board-model-group.test.ts` | TC-09, TC-10 |
| unit | `tests/unit/registry.test.ts` | TC-11, TC-12 |
| unit | `tests/unit/selection.test.ts` | TC-13..TC-15 |
| component | `tests/component/selection.test.tsx` | TC-16..TC-31 |
| e2e | `tests/e2e/multi-select.spec.ts` | TC-32..TC-36 |
