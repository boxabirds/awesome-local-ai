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

## What was built

- `src/shared/geometry.ts` — `Rect`, `Point`, `Handle`, `rectContains`, `unionRects`,
  `normalizeRect`, `resizeRect`, `resizeScale`, `anchorScaleRect`, `clampScale`, `scaleWithin`.
- `src/shared/board-model.ts` — `ObjectSnapshot`, `declareObjectType`, `isDeclaredObjectType`,
  `objectBounds`, `objectsInRect`, `allObjectIds`, `moveObjects`, `resizeObjects`,
  `bringObjectsToFront`, `deleteObjects`, `boardObjects`.
- `src/client/objects/registry.tsx` + `src/client/objects/index.ts` — the object type registry,
  with sticky notes registered by importing the module.
- `src/client/board/useSelection.ts` — the selection reducer and hook: click, Shift-click, marquee,
  select all, clear, edit, and pruning what somebody else deleted.
- `src/client/board/useTransformGesture.ts` — one gesture for move and resize, absolute writes,
  window-level listeners, start/end announcements for story 8.
- `src/client/board/SelectionOverlay.tsx`, `SelectionBar.tsx`, `Marquee.tsx`, `useBoardKeys.ts` —
  the box and its eight handles, the count and bin, the box you draw, and the keyboard.
- `src/client/board/BoardScreen.tsx`, `canvas/BoardViewport.tsx`, `objects/StickyNote.tsx`,
  `board/useBoardDoc.ts`, `styles.css` — wired together, with the store exposing every object.
- Tests: `tests/unit/{geometry,board-model-group,registry,use-selection}.test.ts`,
  `tests/component/{selection,transform}.test.tsx`, `tests/e2e/object-selection.spec.ts`, plus
  `tests/fixtures/testbox.tsx` and `tests/helpers/rect.ts`.

## Result

`npm run build`, `npm run typecheck`, `npm run test:unit` (182), `npm run test:component` (152),
`npm run test:integration` (61) and `npm run test:e2e` (55) all pass. Decisions and deviations are
in `NOTES.md`, under "Story 7 notes".
