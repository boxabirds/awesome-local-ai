# Notes

## Story 8: Undo and redo my own changes without undoing anyone else's

### Decisions made

1. **`_manager` exposed on UndoController for test timing.** The `lib0/time` module
   captures `Date.now` at import time (`export const getUnixTime = Date.now`), so
   `vi.mock` and `vi.useFakeTimers()` cannot intercept it from within yjs. The
   capture-timeout unit tests (TC-12, TC-13) manipulate `manager.lastChange`
   directly to simulate elapsed time between transactions. This is a test-only
   property on the controller interface.

2. **Boundary calls surround every discrete model operation.** `useBoardKeys`
   (Delete, nudge), `App.tsx`/`BoardHarness` (createSticky, deleteObjects),
   `StickyNote` (setStickyColor, deleteObject), `useTransformGesture` (gesture
   start/end), and `StickyTextEditor` (edit start/end) all call
   `undoController.boundary()` to prevent unrelated changes from merging into
   a single undo step via the capture timeout.

3. **Test hook `addSticky` wraps in LOCAL_ORIGIN and boundary.** The text
   insertion inside `addSticky` now uses `doc.transact(..., LOCAL_ORIGIN)` so
   the text is part of the captured undo step.

4. **Keyboard undo handler placed before the editing/text-entry guard** in
   `useBoardKeys` so that undo/redo works when focus is on the board (note
   selected) but still skips when focus is in a text input/textarea.

5. **Ctrl/Cmd+Z in StickyTextEditor** intercepts the keydown, calls
   `undoController.undo()`/`redo()`, then syncs the textarea value from
   `ytext.toString()` so the native textarea undo history never diverges.

6. **No presence, offline, sign-in, dashboard, comments, export features.**
   Stories 6 and 13-17 are out of scope per the session instructions.
