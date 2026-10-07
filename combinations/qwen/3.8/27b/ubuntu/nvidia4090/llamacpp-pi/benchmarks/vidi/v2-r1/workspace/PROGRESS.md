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

## Verification (final)

- `npm run build` ✓, `npm run typecheck` ✓
- `npm run test:unit` ✓ (160 tests), `npm run test:component` ✓ (54),
  `npm run test:integration` ✓ (53)
- `npm run test:e2e` ✓ (17, incl. story 7 TC-32/33/34 + all pre-existing suites),
  run twice in a row after fixing the TC-32 focus race
- `npm run test:e2e:persist` ✓ (4), `npm run test:e2e:share` ✓ (5),
  `npm run test:e2e:selection` ✓ (2, wrangler TC-35/TC-36)

## Notes

- Fixed a regression in story 2 TC-32 (dragging at 200% zoom): the deferred
  start-edit (needed while the `edit` reducer action validated ids against
  the snapshot) let `keyboard.type` race the textarea focus. `edit` now
  accepts not-yet-present ids (prune reconciles) and `createStickyAt`
  calls `startEdit` synchronously again. TC-32 passed 5/5 solo and in two
  consecutive full-suite runs.
- TC-32 firefox/webkit skipped: only Chromium is installed here (see NOTES.md).
