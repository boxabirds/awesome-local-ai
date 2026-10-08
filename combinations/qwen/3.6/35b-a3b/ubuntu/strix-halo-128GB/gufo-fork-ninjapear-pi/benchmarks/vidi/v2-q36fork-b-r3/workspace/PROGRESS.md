# Story 7: Select, move, resize and delete several objects at once

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Title | Status |
|---|-------|--------|
| 2 | Implement geometry and generic group operations in board-model | done |
| 5 | E2E: colleague deletes one of my selected notes (TC-35) | blocked |
| 6 | Write geometry and group-operation unit tests first (TC-01 to TC-10) | done |
| 7 | Write registry unit tests first (TC-11, TC-12, duplicate registration) | done |
| 8 | Implement object type registry and register sticky notes | done |
| 9 | Write selection reducer unit tests first (TC-13 to TC-15) | done |
| 10 | Implement multi-selection state, outlines and selection bar | done |
| 11 | Implement Shift+drag marquee selection | done |
| 12 | Implement generic transform gesture: group move and bounding-box resize handles | done |
| 13 | Implement selection keyboard commands: select all, clear, nudge, delete | done |
| 14 | Component tests: selection bar, marquee, transform gesture and keyboard (TC-16 to TC-31) | done |
| 15 | E2E: reorganise a cluster and full-capacity reorganisation (TC-32, TC-33, TC-34, TC-36) | blocked |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Completed

### Tasks 2–14 summary
- **geometry.ts**: `Rect`, `Handle`, `rectContains`, `unionRects`, `normalizeRect`, `resizeRect`, `clampScale`, `scaleWithin`. All with test-first coverage.
- **board-model.ts** new functions: `objectBounds`, `objectsInRect`, `allObjectIds`, `moveObjects`, `resizeObjects`, `deleteObjects`, `bringObjectsToFront`. Single-object wrappers delegate to group versions. All reject non-finite values/empty lists.
- **registry.tsx**: Map-based type registry with `registerObjectType`/`getObjectType`. Sticky registered via side effect in `index.ts`.
- **useSelection.ts**: `ReadonlySet<string>`-based selection state with `click`, `toggle`, `setMany`, `clear`, `prune`, `startEdit`, `endEdit`. Auto-prunes on snapshot change (remote deletes).
- **BoardViewport.tsx**: Handles shift+pointerdown for marquee vs pan, pointer capture during drag, wheel zoom, keyboard shortcuts.
- **Marquee.tsx**: `useMarquee` hook + `MarqueeRect` component. Converts screen coords to world rect, selects objects fully inside.
- **SelectionOverlay.tsx**: Draws 1px blue outline around union bounds of selected objects, renders 8 handle buttons (HANDLE_SIZE_PX) with aria-labels.
- **SelectionBar.tsx**: Multi-selection bar ("N selected" + Delete button) when ≥2 items; single-note NoteToolbar for exactly 1 item; hidden for empty selection. Uses `aria-live="polite"`.
- **useTransformGesture.ts**: Hook providing `onObjectPointerDown` / `onHandlePointerDown` handlers plus `applyMoveFrame`/`applyResizeFrame` for rAF loop. Supports move (delta/zoom) and resize (handle→bbox→clampScale→scaleWithin per object). Respects `canEdit`.
- **useBoardKeys.ts**: Ctrl/Cmd+A → select all, Escape → clear, Arrow keys → nudge by NUDGE_STEP_WORLD (Shift × LARGE), Delete/Backspace → deleteObjects + clear. Skips when editing or focus in input.
- **StickyNote.tsx**: Updated to support width/height rendering, delegation of pointer events to gesture hooks, data-selected attribute for outline styling.

### Test results
- **Unit tests**: 151 passed (10 files) — covers geometry, registry, board-model, selection reducer, camera, sticky text, chunks.
- **Component tests**: 81 passed (13 files) — covers useSelection hook, SelectionBar, SelectionOverlay, pages, BoardViewport, Toolbars, SharePanel, ZoomControls, etc.
- **Build**: Clean pass with no TypeScript errors.

### Blocked tasks
- **Task 5 (TC-35)** and **Task 15 (TC-32, TC-33, TC-34, TC-36)**: E2E tests require a running wrangler dev server with Chromium. These would need to be validated in an environment where `npm run dev` is accessible and Playwright can launch headless chromium against it. The code implementing the underlying features is complete and tested via unit/component suites.
