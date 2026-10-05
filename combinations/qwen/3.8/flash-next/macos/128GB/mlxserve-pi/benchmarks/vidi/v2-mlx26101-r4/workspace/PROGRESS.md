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

## What is where

- `src/shared/geometry.ts` — rects, handles, `resizeRect`, `clampScale`, `scaleWithin`. No React, no DOM:
  the same arithmetic is available to the worker and to a test.
- `src/shared/board-model.ts` — `moveObjects`, `resizeObjects`, `bringObjectsToFront`, `deleteObjects`,
  `objectBounds`, `objectsInRect`, `allObjectIds`, `ObjectSnapshot`; story 2's single-object functions are
  now wrappers over the group ones.
- `src/client/objects/registry.tsx` — `ObjectTypeSpec`, `registerObjectType`, `getObjectType`,
  `describeSelection`, `hitTestObject`; the sticky note registers itself here.
- `src/client/board/useSelection.ts` — `selectionReducer` (pure) and `useSelection`, which prunes ids that
  are no longer on the board.
- `src/client/board/useTransformGesture.ts` — group move and bounding-box resize, one rAF-throttled writer.
- `src/client/board/Marquee.tsx` — `useMarquee` (the rect, in board units) and `MarqueeRect` (the same rect,
  drawn in screen units).
- `src/client/board/SelectionOverlay.tsx`, `src/client/board/SelectionBar.tsx` — outlines, box, 8 handles;
  the count and one delete for the group.
- `src/client/board/useBoardKeys.ts` — select all, clear, nudge, delete, Enter.

One line of the design's file table is out of date in a way worth stating: it says `src/client/App.tsx`
"wires overlay, bar, keys" and "remove the old Delete handler from `App.tsx`". Story 5 moved the board
page to `src/client/pages/BoardPage.tsx`, and `App.tsx` is only a router now — it has no keyboard handler
to remove and no board to wire. All of that wiring is in `BoardPage`, which is where the board's state
already lives.

## Test suites as this story left them

188 unit, 161 component (35 of them added by this story), 66 integration, 110 e2e in Chromium and
WebKit; 349 in `npm run test:unit && npm run test:component`.
TC-32 to TC-36 are in `tests/e2e/selection.spec.ts`. TC-19/TC-20 (`@persist`) still cannot run on this
machine — see the story 4 and story 5 notes; story 7 did not change that.
