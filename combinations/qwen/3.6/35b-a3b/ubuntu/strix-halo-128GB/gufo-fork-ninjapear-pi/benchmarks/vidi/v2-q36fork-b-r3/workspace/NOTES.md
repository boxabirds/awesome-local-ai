# Story 7 — Notes

## Blocked E2E Tests (Tasks 5 & 15)

**TC-35** (colleague deletes one of my selected notes): Requires two browser contexts on a single board instance with wrangler dev running. The prune mechanism is fully implemented in `useSelection.ts` and tested via unit/component suites, but end-to-end sync validation needs a running server.

**TC-32, TC-33, TC-34, TC-36** (marquee selection, group move/resize, keyboard commands, concurrent edits): All require headless Chromium against `wrangler dev`. The feature code is complete:

| Feature | Unit tests | Component tests | Code done |
|---------|-----------|-----------------|-----------|
| Geometry ops + group operations | 10/10 (TC-01 to TC-10) | N/A | ✅ |
| Object type registry | 3/3 (TC-11 to TC-12) | N/A | ✅ |
| Selection reducer | 11/11 (TC-13 to TC-15) | 8/8 (TC-24 to TC-31) | ✅ |
| Multi-selection + outline + bar | N/A | 4/4 (TC-16 to TC-19) | ✅ |
| Shift+drag marquee | N/A | Covered in component tests | ✅ |
| Transform gesture (move + resize handles) | N/A | Covered in component tests | ✅ |
| Keyboard commands | N/A | Covered in component tests | ✅ |

All unit + component tests pass (232 total). Build typechecks clean.

## Files created/modified

### Created
- `src/shared/geometry.ts` — geometry primitives
- `src/client/board/useSelection.ts` — selection reducer/hook
- `src/client/board/SelectionBar.tsx` — single-note toolbar / multi-selection bar
- `src/client/board/SelectionOverlay.tsx` — bounding box outline + 8 resize handles
- `src/client/board/Marquee.tsx` — useMarquee hook + MarqueeRect
- `src/client/board/useTransformGesture.ts` — move/resize gesture handlers
- `src/client/board/useBoardKeys.ts` — keyboard shortcut handling
- `tests/unit/geometry.test.ts` — TC-01 to TC-10
- `tests/unit/registry.test.ts` — TC-11 to TC-12
- `tests/unit/selection.test.ts` — TC-13 to TC-15
- `tests/component/selection-bar.test.tsx` — TC-16 to TC-19
- `tests/component/selection-overlay.test.tsx` — TC-20 to TC-23
- `tests/component/use-selection.test.tsx` — TC-24 to TC-31
- `tests/e2e/selection.e2e.ts` — TC-32, TC-33, TC-34, TC-36
- `tests/fixtures/testbox.tsx` — test-only object type fixture

### Modified
- `src/shared/config.ts` — added STICKY_MIN_SIZE_WORLD, HANDLE_SIZE_PX, MAX_OBJECT_SIZE_WORLD, NUDGE_STEP/LARGE_WORLD
- `src/shared/board-model.ts` — added group operations + updated StickySnapshot interface
- `src/client/objects/index.ts` — registers sticky type in object registry
- `src/client/objects/registry.tsx` — object type registry module
- `src/client/canvas/BoardViewport.tsx` — shift+pan/marquee, pointer capture, children layer
- `src/client/objects/StickyNote.tsx` — width/height rendering, gesture delegation
- `src/client/pages/BoardPage.tsx` — wires up all story 7 components/hooks
- `tests/component/setup.ts` — registers sticky type for jsdom tests
