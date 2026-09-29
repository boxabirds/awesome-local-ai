# Story 8 Implementation Notes

## Decisions

### 1. `captureTimeout` boundary condition
Y.UndoManager uses `<` (strictly less than) for the merge window:
`now - lastChange < captureTimeout`. With `captureTimeout = 500`:
- Gap of 499ms → merges (499 < 500 → true)
- Gap of 500ms → new step (500 < 500 → false)

This matches the PRD requirement: "without a pause of 500ms or more" continues the burst; a pause of exactly 500ms ends it.

### 2. `undoStackLength()` exposed on UndoController interface
Not in the original design contract. Added for TC-09/TC-10 trimming tests which assert stack length.

### 3. `lib0/time.getUnixTime` is NOT mockable with vitest fake timers
`lib0/time` exports `getUnixTime = Date.now` (function reference captured at import time). vitest's `vi.useFakeTimers()` replaces `Date.now` but cannot reach the captured reference. The TC-13 timing test uses real `setTimeout` delays (500ms range) instead of fake timers.

### 4. Controller lives in Board.tsx (not App.tsx)
The design says "created in App.tsx". In this codebase, `Board.tsx` is the board component that owns the Y.Doc lifecycle (via `useBoardDoc(boardId)`). `App.tsx` is a router. The controller is created in `Board.tsx` with `useMemo(() => createUndo(doc), [doc])` and destroyed on doc change — semantically equivalent to the design's intent.

### 5. UndoButtons rendered inside Toolbar
The design mentions undo buttons on the toolbar. They are rendered as children of `<Toolbar>` via the `undoState` prop. The `undoState` prop is optional for backward compatibility with existing component tests that render `<Toolbar>` without undo.

### 6. Ctrl+Shift+Z case handling
When Shift is held, `KeyboardEvent.key` is 'Z' (uppercase) in real browsers. The handler uses `e.key.toLowerCase() === 'z' && e.shiftKey` for the redo shortcut.

### 7. TC-26 (live-collaboration) is pre-existing flakiness
The `MAX_CONCURRENT_EDITORS` convergence test fails intermittently under full-suite load. Verified identical behavior with and without story-8 changes (same test fails in the base commit when all tests run together). Passes reliably when run in isolation.

## Files created
| Path | Purpose |
|---|---|
| `src/client/board/undo.ts` | `createUndo(doc, opts)` → `UndoController` |
| `src/client/board/useUndo.ts` | React hook: canUndo, canRedo, undo, redo |
| `src/client/board/UndoButtons.tsx` | Undo/Redo toolbar buttons |
| `tests/unit/undo-history.test.ts` | TC-01 to TC-11 |
| `tests/unit/undo-boundaries.test.ts` | TC-12, TC-13 |
| `tests/component/UndoBoundaries.test.tsx` | TC-14 to TC-17 |
| `tests/component/UndoControls.test.tsx` | TC-18 to TC-21 |
| `tests/e2e/undo-redo.spec.ts` | TC-22, TC-23, TC-24 |

## Files modified
| Path | Change |
|---|---|
| `src/shared/config.ts` | `UNDO_CAPTURE_TIMEOUT_MS = 500`, `UNDO_MAX_STEPS = 200` |
| `src/client/Board.tsx` | Creates `UndoController`, passes to keys/editor/toolbar |
| `src/client/board/useBoardKeys.ts` | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y shortcuts |
| `src/client/board/Toolbar.tsx` | Renders `UndoButtons` via optional `undoState` prop |
| `src/client/objects/StickyNote.tsx` | Passes `undoController` to editor; boundary around color/delete |
| `src/client/objects/StickyTextEditor.tsx` | boundary() on start/end; Ctrl+Z intercepted for Y.Text undo |
