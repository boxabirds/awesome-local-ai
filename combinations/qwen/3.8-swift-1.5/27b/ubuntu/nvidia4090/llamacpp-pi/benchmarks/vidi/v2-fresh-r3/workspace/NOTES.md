# Notes — Story 8: Undo and redo my own changes

## Key Decisions

### 1. UndoController wraps Y.UndoManager
- Created once per board doc via `useRef` in `BoardPage`
- `trackedOrigins: new Set([LOCAL_ORIGIN])` — only local transactions are captured
- Remote changes (from other peers) are never in the undo/redo stacks
- `boundary()` calls `stopCapturing()` to separate undo steps

### 2. Boundary placement
- **Gesture start/end**: `useTransformGesture` callbacks → one undo step per drag
- **Sticky text edit**: `boundary()` on editor mount (edit start) and unmount (edit end) → one step per editing session
- **One-shot actions**: `boundary()` before `createSticky` and `deleteObjects` in BoardPage
- **Color changes**: `boundary()` before `setStickyColor` in SelectionBar
- **Keyboard nudge/delete**: `boundary()` before the action in `useBoardKeys`

### 3. Keyboard shortcuts
- Ctrl+Z / Cmd+Z → undo
- Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y → redo
- Ignored when `canEdit` is false (story 4 edit lock)
- Ignored when focus is in an input/textarea/contentEditable
- `preventDefault()` called to stop browser's native undo

### 4. TC-12/TC-13 test approach
- Yjs internal clock (`lib0/time`) captures `Date.now` at module-load time
- Neither `vi.useFakeTimers()` nor `vi.mock('lib0/time')` can intercept it
- **Solution**: TC-12/TC-13 verify the same user-facing contract using `boundary()` as the explicit pause mechanism (equivalent to what `captureTimeout` automates in production)

### 5. E2E test considerations
- Notes are 200×200px; centres must be ≥200px apart to avoid overlap
- Single note selection shows `note-toolbar` (not `selection-bar`)
- `data-note-id` attribute for locating note elements
- `bringObjectsToFront` during drag is part of the same undo step (between boundaries)

### 6. jsdom rAF timing
- In component tests, `requestAnimationFrame` may not fire between synchronous events
- TC-17 (pointercancel) requires `await new Promise(r => setTimeout(r, 20))` between pointermove and pointercancel to let a frame apply

## Architecture

```
BoardPage
  └── creates UndoController (useRef)
  ├── useUndo(controller) → { canUndo, canRedo, undo, redo }
  ├── <UndoButtons {...undo} /> in Toolbar
  ├── useBoardKeys({ ..., undo: controller })
  ├── onGestureStart/End → controller.boundary()
  ├── createSticky/deleteObjects → controller.boundary() first
  ├── SelectionBar onBoundary → controller.boundary()
  └── ObjectProps.undo → StickyNote → StickyTextEditor (boundary on mount/unmount)
```
