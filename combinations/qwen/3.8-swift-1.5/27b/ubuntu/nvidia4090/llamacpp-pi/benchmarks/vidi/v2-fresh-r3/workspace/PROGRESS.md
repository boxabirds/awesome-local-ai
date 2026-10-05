# Progress — Story 8: Undo and redo my own changes

## Status: COMPLETE

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Read spec (prd.md, design.md, tasks.md) | ✅ Done |
| 2 | Add `UNDO_CAPTURE_TIMEOUT_MS` and `UNDO_MAX_STEPS` to config; implement `createUndo` controller | ✅ Done |
| 3 | Implement `useUndo` hook | ✅ Done |
| 4 | Implement `UndoButtons` component | ✅ Done |
| 5 | Write e2e tests TC-22 to TC-24 | ✅ Done |
| 6 | Write unit tests TC-01 to TC-11 (`undo-history.test.ts`) | ✅ Done |
| 7 | Write unit tests TC-12, TC-13 (`undo-boundaries.test.ts`) | ✅ Done |
| 8 | Wire `boundary()` into StickyTextEditor (edit start/end) | ✅ Done |
| 9 | Write component tests TC-14 to TC-17 (`UndoBoundaries.test.tsx`) | ✅ Done |
| 10 | Implement undo/redo keyboard shortcuts in `useBoardKeys` | ✅ Done |
| 11 | Write component tests TC-18 to TC-21 (`UndoControls.test.tsx`) | ✅ Done |
| 12 | Wire undo controller into BoardPage, Toolbar, SelectionBar | ✅ Done |
| 13 | Run build, typecheck, all tests; fix failures | ✅ Done |

## Test Results

- **Build**: ✅ Pass
- **Typecheck**: ✅ Pass
- **Unit tests**: 134 passed (14 files)
- **Component tests**: 71 passed (13 files)
- **E2e tests**: 3 passed (TC-22, TC-23, TC-24)

## Files Created

- `src/client/board/undo.ts` — UndoController wrapping Y.UndoManager
- `src/client/board/useUndo.ts` — React hook binding controller to UI state
- `src/client/board/UndoButtons.tsx` — Toolbar undo/redo buttons
- `tests/unit/undo-history.test.ts` — TC-01 to TC-11
- `tests/unit/undo-boundaries.test.ts` — TC-12, TC-13
- `tests/component/UndoBoundaries.test.tsx` — TC-14 to TC-17
- `tests/component/UndoControls.test.tsx` — TC-18 to TC-21
- `tests/e2e/undo.spec.ts` — TC-22 to TC-24

## Files Modified

- `src/shared/config.ts` — Added `UNDO_CAPTURE_TIMEOUT_MS`, `UNDO_MAX_STEPS`
- `src/client/board/Toolbar.tsx` — Accepts and renders `undoButtons` prop
- `src/client/board/useBoardKeys.ts` — Handles Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y
- `src/client/board/SelectionBar.tsx` — Accepts `onBoundary` prop
- `src/client/objects/StickyNote.tsx` — Passes `undo` controller to editor
- `src/client/objects/StickyTextEditor.tsx` — Calls `boundary()` on edit start/end
- `src/client/objects/registry.tsx` — Added `undo` to `ObjectProps`
- `src/client/pages/BoardPage.tsx` — Creates UndoController, wires everything together
