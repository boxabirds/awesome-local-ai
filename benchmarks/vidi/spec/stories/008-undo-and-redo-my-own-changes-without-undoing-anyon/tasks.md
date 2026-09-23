# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 2 | Implement per-user undo history controller | proposed | implementation | undo.history |
| 5 | E2E: recover my mistakes while colleagues work (TC-22 to TC-24) | proposed | test:e2e | undo.controls |
| 6 | Write undo history unit tests first with a simulated remote peer (TC-01 to TC-11) | proposed | test:unit | undo.history |
| 7 | Write capture-timeout unit tests first (TC-12, TC-13) | proposed | test:unit | undo.boundaries |
| 8 | Wire undo step boundaries into transform gestures, toolbars and the text editor | proposed | implementation | undo.boundaries |
| 9 | Component tests: gesture and typing boundaries (TC-14 to TC-17) | proposed | test:ui-component | undo.boundaries |
| 10 | Implement undo/redo shortcuts and toolbar buttons | proposed | implementation | undo.controls |
| 11 | Component tests: undo shortcuts, buttons and edit lock (TC-18 to TC-21) | proposed | test:ui-component | undo.controls |

## Details

### 2. Implement per-user undo history controller

## Goal
Implement undo.history per contract so the history unit tests pass.

## Approach
- `createUndo(doc, {captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS, maxSteps = UNDO_MAX_STEPS})` builds `Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout })` — only this tab's own transactions are captured, so remote (provider origin) and story 4 load updates are never undone (undo.own).
- `undo()`/`redo()` return false on empty stacks; inverses targeting remotely deleted items have no effect and never throw (undo.safe).
- New local steps clear redo (UndoManager default, undo.redo_cleared).
- On `stack-item-added`, trim `undoStack` from the front while longer than `maxSteps` (undo.limit).
- `boundary()` = `stopCapturing()`; `addScope` for story 16; `onChange` from stack-item-added/popped; `destroy()` disposes (fresh controller after reload is empty, undo.session_only).
- `App.tsx` creates one controller per board doc and destroys it on board change/unmount.
- Config: UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS.

## Done when
TC-01 to TC-11 pass.

### 5. E2E: recover my mistakes while colleagues work (TC-22 to TC-24)

## Goal
Prove undo.controls (shortcuts, buttons, personal scope) through real browsers and the real sync provider.

## Workflows
- TC-22 "Recover an accidental delete": Mia box-selects 8 notes and presses Delete; Raj adds a note; Mia presses Ctrl/Cmd+Z → the 8 notes return on both screens with text, colours, sizes and positions, Raj's note remains; Mia clicks the Redo button → the 8 disappear again on both; Undo button becomes disabled once Mia's history is exhausted.
- TC-23 "Colleague deleted my object": Mia moves a note, Raj deletes it, Mia presses Ctrl/Cmd+Z → no error or console error, note absent on both screens, Mia's next undo still works.
- TC-24 "Everyone undoing at once": MAX_CONCURRENT_EDITORS contexts each move a different note and type in a different note, then all press Ctrl/Cmd+Z twice → each context's own changes reverted, others' changes intact, all boards identical.

## Done when
All pass in chromium against wrangler dev.

### 6. Write undo history unit tests first with a simulated remote peer (TC-01 to TC-11)

## Goal
Test-first suite for the undo.history contract (`createUndo` → undo, redo, boundary, canUndo, canRedo, addScope, onChange, destroy). Stub throws until implemented.

## Helper
`peer.ts`: a second real Y.Doc exchanging updates with the local doc using a non-local origin, plus a helper applying updates with the story 4 LOAD origin.

## Cases
- TC-01 local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour (negative: remote not undone).
- TC-02 only peer changes → canUndo false. TC-03 LOAD-origin updates → canUndo false.
- TC-04 delete 8 notes, undo → all restored with text, colour, size, position.
- TC-05 undo then redo → re-applied. TC-06 undo then new change → canRedo false.
- TC-07 local move, peer deletes target, undo → no throw, still deleted, next undo works (error path).
- TC-08 peer edits note text, then local delete, undo → restored with content at time of delete.
- TC-09 UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped; TC-10 UNDO_MAX_STEPS − 1 + 1 → nothing dropped (boundaries).
- TC-11 destroy then new controller → canUndo false (session only).

## Done when
Compiles and fails with "not implemented"; committed.

### 7. Write capture-timeout unit tests first (TC-12, TC-13)

## Goal
Test-first unit coverage of undo.boundaries' typing-burst grouping using fake system time.

## Cases
- TC-12 LOCAL_ORIGIN Y.Text inserts 100 ms apart between two `boundary()` calls → exactly one undo step; undo removes the whole burst.
- TC-13 two inserts separated by exactly UNDO_CAPTURE_TIMEOUT_MS → two steps; separated by UNDO_CAPTURE_TIMEOUT_MS − 1 ms → one step (boundary values).
- `boundary()` on an empty stack is a no-op (error path).

## Done when
Fails until the controller exists; passes after undo.history implementation; committed.

### 8. Wire undo step boundaries into transform gestures, toolbars and the text editor

## Goal
Implement undo.boundaries per contract so each user action is one undo step.

## Approach
- Pass the controller's `boundary` as story 7 `useTransformGesture` `onGestureStart` and `onGestureEnd` (including pointercancel), so all rAF-frame `moveObjects`/`resizeObjects` transactions of one drag merge into one step.
- `StickyTextEditor`: `boundary()` on mount and on end; intercept Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z inside the textarea with `preventDefault` and call the controller so native textarea undo never diverges from Y.Text; typing within UNDO_CAPTURE_TIMEOUT_MS merges.
- `useBoardKeys` (Delete, nudge), `Toolbar` (create sticky) and `NoteToolbar` (colour, delete): call `boundary()` before and after the single model call.

## Done when
TC-12 to TC-17 pass.

### 9. Component tests: gesture and typing boundaries (TC-14 to TC-17)

## Goal
Prove undo.boundaries wiring in jsdom with a real Y.Doc, real controller and story 7 gesture hook.

## Cases
- TC-14 30-frame drag of a selection via useTransformGesture → one undo restores every object's start position.
- TC-15 drag ends, colour changed 200 ms later → two separate steps (boundary at gesture end).
- TC-16 edit a note, type "hello", Ctrl+Z inside the editor → typing undone; an earlier move is not undone (negative).
- TC-17 pointercancel mid-drag → one step restoring the start position (error path).

## Done when
All pass in `npm run test:component`.

### 10. Implement undo/redo shortcuts and toolbar buttons

## Goal
Implement undo.controls per contract.

## Approach
- `useUndo(controller, canEdit)`: subscribe to `onChange`; expose canUndo/canRedo (false when `!canEdit`), undo, redo. Buttons only call this tab's controller, whose stacks hold only this person's LOCAL_ORIGIN steps (personal scope).
- `UndoButtons` in the left toolbar: `button[aria-label="Undo"]` / `button[aria-label="Redo"]`, tooltips "Undo (Ctrl/Cmd+Z)" / "Redo (Ctrl/Cmd+Shift+Z)", disabled attribute per state.
- `useBoardKeys`: Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z and Ctrl+Y → redo; `preventDefault`; ignored when focus is in a non-board input, when a sticky is being edited (editor handles it), or when `canEdit` is false.

## Done when
TC-18 to TC-21 and e2e TC-22 to TC-24 pass.

### 11. Component tests: undo shortcuts, buttons and edit lock (TC-18 to TC-21)

## Goal
jsdom tests for undo.controls with a fake UndoController.

## Cases
- TC-18 empty stacks → Undo and Redo buttons disabled (boundary).
- TC-19 Ctrl+Z and Cmd+Z → undo; Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y → redo; each preventDefault.
- TC-20 canEdit false (load failed) → shortcuts ignored, buttons disabled (negative).
- TC-21 Ctrl+Z with focus in the share-link input → controller not called (negative).

## Done when
All pass in `npm run test:component`.

