# Story 8 Notes

## Decisions made

1. **`_um` property on UndoController**: Exposed the internal `Y.UndoManager` as `_um` for testing purposes. This allows boundary tests to manipulate `lastChange` directly since `lib0/time.getUnixTime` captures `Date.now` at module load time and cannot be faked by vitest fake timers (the yjs package is pre-bundled and bypasses vitest's module mocking).

2. **`applyTextDiff` origin**: Changed from `null` to `LOCAL_ORIGIN` in `StickyTextEditor.handleInput()`. Text edits must use LOCAL_ORIGIN so the UndoManager tracks them; previously text edits used `null` which is not in `trackedOrigins`.

3. **Boundary before undo/redo in useBoardKeys**: The `useBoardKeys` handler calls `boundary()` before `undo()`/`redo()` to ensure the current capture window is closed before stepping the stack. This prevents edge cases where a keystroke immediately before the shortcut would be merged with an unrelated future action.

4. **TC-23 e2e adaptation**: After Yjs deletes an object (remotely), the UndoManager removes all stack items referencing that object. So undoing a move of a deleted object has no effect AND the next undo targets the next unrelated step. The test verifies no errors and that the deleted object stays deleted, rather than asserting a specific remaining count.

5. **Pre-existing flaky test**: `collaboration.spec.ts` TC-23 (concurrent typing merges) was already failing before this story's changes. It is a CRDT text interleaving assertion that fails intermittently due to timing.
