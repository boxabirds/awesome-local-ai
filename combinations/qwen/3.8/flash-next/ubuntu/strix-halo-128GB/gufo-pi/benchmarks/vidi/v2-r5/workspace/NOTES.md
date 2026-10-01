# Story 8 — Undo and redo my own changes without undoing anyone else's

## Decisions

### Undo controller (`src/client/board/undo.ts`)
- Wraps `Y.UndoManager` scoped to the `objects` map with `trackedOrigins: new Set([LOCAL_ORIGIN])`.
- Only this tab's transactions are captured; remote updates (provider origin) and story 4 load updates are never in the undo stack.
- `boundary()` calls `stopCapturing()` — closes the current capture window so the next transaction starts a new undo step.
- `undo()`/`redo()` return `false` when the stack is empty. Inverses targeting remotely deleted items have no effect (Yjs handles this internally).
- Trims the undo stack to `maxSteps` on `stack-item-added` by shifting from the front.
- `destroy()` disposes the manager; a fresh controller starts with empty stacks (session-only).
- `addScope()` wraps `addToScope` for story 16 (comments).

### Capture timeout and boundaries (`undo.boundaries`)
- `UNDO_CAPTURE_TIMEOUT_MS = 500`: the Yjs `captureTimeout` merges transactions within this window into one undo step. Typing bursts merge; gestures do not because `boundary()` is called at gesture start and end.
- `useTransformGesture`: `onGestureStart` and `onGestureEnd` (including pointercancel) call `boundary()`. All rAF-frame `moveObjects` transactions within one drag merge into one step.
- `StickyTextEditor`: calls `boundary()` on mount (edit start) and unmount (edit end). Ctrl/Cmd+Z inside the textarea is intercepted with `preventDefault()` and routed to the controller, preventing native textarea undo from diverging from Y.Text.
- `useBoardKeys`: Delete and nudge are wrapped with `boundary()` before and after, so each action is one step.
- Toolbar create sticky: `boundary()` before and after `createSticky`.

### React binding (`useUndo`, `UndoButtons`)
- `useUndo(controller, canEdit)`: subscribes to `controller.onChange`, exposes reactive `canUndo`/`canRedo`/`undo`/`redo`. Returns `false` for both when `!canEdit`.
- `UndoButtons`: `button[aria-label="Undo"]` and `button[aria-label="Redo"]` with tooltips "Undo (Ctrl/Cmd+Z)" / "Redo (Ctrl/Cmd+Shift+Z)". Disabled attribute + `aria-disabled` when the matching history is empty.

### Keyboard shortcuts (`useBoardKeys`)
- Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z and Ctrl+Y → redo. `preventDefault()` prevents browser undo.
- Shortcuts are handled BEFORE the `sel.ids.size === 0` guard (undo works without a selection).
- Ignored when `sel.editingId !== null` (editor handles it), focus is in `isTypingTarget` (non-board input), or `!canEdit`.
- Key comparison uses `event.key.toLowerCase()` for cross-platform case handling.

### Personal scope (undo.own)
- Each tab has its own `UndoController` instance created in `App.tsx`. The `Y.UndoManager` tracks only `LOCAL_ORIGIN`, so stacks contain exclusively that person's transactions.
- Other people's changes arrive with the provider origin and never enter these stacks.
- `App.tsx` creates one controller per board doc; destroys on unmount.

### Unit test: peer simulation (`tests/unit/peer.ts`)
- `createPeer(local)` creates a second `Y.Doc` that syncs bidirectionally. Local→Peer uses a guard to avoid re-applying peer-originated updates back to the peer. Remote changes applied to the local doc use `PEER_ORIGIN` (not tracked by undo).
- `loadTransact(doc, fn)` wraps mutations with `LOAD_ORIGIN` to simulate story 4 loads.

### Capture timeout tests
- Yjs uses `lib0/time.getUnixTime = Date.now` which captures the function reference at module load time. Vitest's `vi.useFakeTimers()` replaces `Date.now` but cannot retroactively change the captured reference. Tests use real delays with small `captureTimeoutMs` values (80–200ms) instead.

## Known limitations
- 6 pre-existing e2e failures (TC-33/34/35 multi-select, TC-19/20 persistence, TC-35 sticky colour cycling) exist in the baseline before this story's changes and are not caused by story 8.

---

# Story 11 — Sketch freehand with a pen

## Decisions

### PenTool overlay placement
- PenTool renders inside `BoardViewport`'s `overlay` prop (not as a sibling). This ensures wheel events bubble to the viewport's native wheel handler, allowing pan/zoom while pen is active.
- PenTool uses `zIndex: 10001` to be above the `SelectionOverlay` (zIndex: 10000) which renders resize handles that would otherwise intercept pointer events.

### StrokeObject hit-testing
- The SVG container accepts pointer events (no `pointer-events: none`). The `onPointerDown` handler converts the click to world coordinates and checks distance to the polyline. Clicks further than `max(thickness/2, 6)` from the line are ignored.
- Path coordinates are computed in SVG-relative space (world coordinate minus SVG offset). The SVG is expanded by `hitWidth/2` on each side to ensure the hit area is within the SVG viewport.

### RDP simplification (`src/shared/geometry/simplify.ts`)
- `simplify()` implements iterative Rabinovich–Peucker (RDP) using an explicit stack (avoids recursion depth issues with large point sets like 5000+ points).
- Tolerance is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` so simplification is zoom-independent.
- `smoothPath()` generates a quadratic Bézier path through midpoints: `M p0 Q p1 m01 Q p2 m12 ... L pn`.

### Stroke data model (`src/shared/objects/stroke.ts`)
- Points stored as a flat `number[]` array (`[x0, y0, x1, y1, ...]`) relative to the bounding box origin.
- BBox includes stroke-width padding: `x = minX - thickness/2`, `width = (maxX - minX) + thickness`.
- `baseWidth`/`baseHeight` track the original bbox dimensions for proportional resize.
- `scaledPoints(s)` returns world-space points scaled by `width/baseWidth` and `height/baseHeight`.

### Registry hit test (`src/client/objects/registerStroke.ts`)
- Uses fixed tolerance `max(thickness/2, STROKE_HIT_TOLERANCE_PX)` (zoom-independent at registry level). The interface does not pass `zoom`; zoom-aware behavior is handled at the application layer.
- Resize uses aspect-locking (scale both dimensions by the same factor).

### Pen stays active
- Unlike Shape/Connector tools which call `toolCreated()` (switching back to select), PenTool calls only `onCommit` (the undo boundary function). The pen tool remains active after drawing until the user presses Escape/V or another tool shortcut.

### Configuration (`src/shared/config.ts`)
- `PEN_COLORS`: 6 named colors (black, red, blue, green, orange, purple) with hex values.
- `PEN_THICKNESS_WORLD`: thin=2, medium=4, thick=8 (world units).
- `STROKE_SIMPLIFY_TOLERANCE_PX`: 2px.
- `STROKE_MAX_POINTS`: 5000 (hard cap to prevent memory issues).
- `STROKE_HIT_TOLERANCE_PX`: 6px (minimum hit area width for the line).
- `STROKE_MIN_SIZE_WORLD`: 1px (minimum bbox dimension after resize).

