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


---

# Story 9 — Write free text anywhere on the board

Adds a **Text tool** (`T`) that places plain-text objects anywhere on the board, with
four sizes (S/M/L/XL), auto-width that grows to a max then wraps, a fixed-width mode
driven by horizontal (E/W) resize handles, and standard object behaviours (select,
move, delete, undo, live sharing).

## Decisions & notable changes

### 1. Shared text-edit helpers
`clampToLimit` and `applyTextDiff` were extracted into `src/shared/text-edit.ts`.
Sticky notes (`StickyText`) now thin-wrap these with `STICKY_TEXT_MAX_CHARS`; free
text reuses them with `TEXT_MAX_CHARS`. One diff/clamp implementation for both.

### 2. `snapshot()` unchanged; added `snapshotAll()`
`snapshot()` still returns `StickySnapshot[]` for backward compatibility with existing
tests. `snapshotAll()` returns `ObjectSnapshot[]` (stickies + text, sorted by z/id) and
is what `useBoardDoc`/`Board` render from. `ObjectSnapshot = StickySnapshot | TextSnapshot`.

### 3. Box sync is local-only
`useTextBoxSync` writes the measured width/height back to the doc only after a **local**
edit (never on remote updates), so the author owns the layout and remote viewers do not
fight over the box. `layoutText` auto-mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD),
greedy word-wrap at that target, height = lines * fontPx * TEXT_LINE_HEIGHT (ceil).

### 4. Canvas measurer fallback
`createCanvasMeasurer` falls back to an estimate (`length * fontPx * 0.6`) when
`getContext('2d')` is unavailable (jsdom), so unit/component tests run without the
`canvas` package.

### 5. Horizontal-only handles
`ObjectTypeSpec` gained `handles?: 'all' | 'horizontal'`. `SelectionOverlay` renders
only E/W handles when every selected object's spec is horizontal. Dragging a text E/W
handle (`useTransformGesture`) sets a **fixed** width and re-wraps (recomputes height);
font size is never changed by a handle.

### 6. useBoardDoc bug fix (important)
`useBoardDoc` previously used `useSyncExternalStore` with a hand-rolled snapshot cache.
The combined `allObjects` snapshot **failed to commit** when a text object was added
(the change did not also alter the sticky `notes` snapshot, so the combined snapshot's
update was dropped). Rewritten to derive `notes` and `allObjects` with `useMemo` keyed
on an `objects.observeDeep` version counter — reliably re-renders for local + remote
edits. Sticky behaviour is unchanged.

### 7. BoardViewport click even when panning is disabled
When the Text tool is active, `beginPan` is undefined. The press-and-release click is
now tracked regardless, so clicking empty space creates a text object (previously the
pointerId guard short-circuited the click handler).

### 8. Pre-existing TC-26 (live-collaboration full-capacity) failure
`live-collaboration.spec.ts` › "Full-capacity session" still fails; verified it fails
identically on the base `story 8` commit (with story 9 `src` stashed) — unrelated to
this story. All other chromium e2e specs pass, including the new `free-text.spec.ts`.

## Out of scope
Stories 6 and 13–17 were not implemented. "Text tool click on top of an existing
object creates text over it" is not wired; only clicking empty space creates text.

## Files (key)
| File | Role |
|------|------|
| `src/shared/objects/text.ts` | text object model + snapshotText |
| `src/shared/text-edit.ts` | clampToLimit / applyTextDiff |
| `src/client/objects/textLayout.ts` | layoutText + canvas measurer |
| `src/client/objects/useTextBoxSync.ts` | local-only box writeback |
| `src/client/objects/TextObject.tsx` / `TextToolbar.tsx` / `TextEditor.tsx` | rendering, S/M/L/XL toolbar, editor |
| `src/client/board/useTool.ts` | Select/Text tool state |
| `src/client/board/useBoardKeys.ts` | V/T/Escape/Enter |
| `src/client/board/useTransformGesture.ts` | horizontal text resize → fixed width + rewrap |
| `src/client/board/useBoardDoc.ts` | snapshot pipeline (bug fix) + allObjects |
| `tests/e2e/free-text.spec.ts` (+ `helpers/text.ts`) | TC-26..TC-30 |
