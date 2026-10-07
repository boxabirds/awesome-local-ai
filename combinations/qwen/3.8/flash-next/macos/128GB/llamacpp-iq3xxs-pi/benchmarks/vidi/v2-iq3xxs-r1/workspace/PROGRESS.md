# Story 8: Undo and redo my own changes without undoing anyone else's

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 2 | Implement per-user undo history controller | done (`src/client/board/undo.ts` + config settings; TC-01..TC-13 green) |
| 5 | E2E: recover my mistakes while colleagues work (TC-22 to TC-24) | done (`tests/e2e/undo.spec.ts`, 3 passed in chromium) |
| 6 | Write undo history unit tests first with a simulated remote peer (TC-01 to TC-11) | done (tests/unit/undo-history.test.ts + peer.ts: compiles, 11 cases fail with "createUndo is not implemented") |
| 7 | Write capture-timeout unit tests first (TC-12, TC-13) | done (tests/unit/undo-boundaries.test.ts: 3 cases fail until the controller exists) |
| 8 | Wire undo step boundaries into transform gestures, toolbars and the text editor | done (gestures, create/delete/raise/colour/text, editor mount/unmount; TC-12..TC-17 green) |
| 9 | Component tests: gesture and typing boundaries (TC-14 to TC-17) | done (`tests/component/UndoBoundaries.test.tsx`, 4 passed) |
| 10 | Implement undo/redo shortcuts and toolbar buttons | done (`useUndo.ts`, `UndoButtons.tsx`, `useBoardKeys`, Toolbar; dark when disabled) |
| 11 | Component tests: undo shortcuts, buttons and edit lock (TC-18 to TC-21) | done (`tests/component/UndoControls.test.tsx`, 5 passed; real controller instead of a fake — see NOTES.md) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Tasks 8, 9 — the controller in the app + component boundary tests (TC-14..TC-17)
* Wiring (task 8) and its component tests (task 9) were written together: the wiring is
  where a step *begins*, and the only way to see that it begins in the right place is to
  drag something and count undos afterwards.
  - `useUndoController(doc)` / `useUndo(undo, canEdit)`; the controller lives with the
    board (design says `App.tsx`; here `App.tsx` is routing, so it is `Board`).
  - `useTransformGesture`'s existing `onGestureStart/onGestureEnd` (move + resize) →
    `boundary()`; create, delete, raise, colour, text commit → `boundary()` before and
    after; `StickyTextEditor` opens/closes a capture window on mount/unmount (edit
    start/end) and answers Ctrl/Cmd+Z/Y inside the note itself; a gesture and an
    in-editor press also break the window (the editor's own value survives).
  - The toolbar's Undo/Redo buttons (`UndoButtons.tsx`, rendered by `Toolbar`) and the
    keyboard shortcuts (task 10, same pass: both are thin calls to the one controller,
    and both read the same `canUndo/canRedo`) are wired too, so TC-18..TC-21 could be
    written against the app rather than against a stub.
  - `window.__vidi6` gained `seedNotes`, `undo`, `redo`, `canUndo`, `canRedo`.
  - Dark buttons: `.board-toolbar .tool-button:disabled`.
* `tests/component/UndoBoundaries.test.tsx` — TC-14 (30-frame drag of a three-note
  selection: one undo, all three back, nothing left in the history), TC-15 (drag then
  recolour immediately = two steps, undone/redone in order), TC-16 (Ctrl+Z *inside* a
  note takes back the typing, not the earlier move), TC-17 (cancelled drag = one step).
* `npm run typecheck`, `test:unit` (175), `test:component` (85), `test:integration` (60) green.

## Tasks 10, 11 — shortcuts, buttons and their component tests (TC-18..TC-21)
* Task 10 was implemented in the same pass as task 8 (see above): both are thin calls
  into the one controller, and TC-15/TC-16 already exercise the shortcuts.
* `tests/component/UndoControls.test.tsx` — TC-18 (empty stacks: both buttons disabled,
  `aria-disabled`, tooltips are the documented text), an enabling/disabling check that
  the Redo *button* steps forward, TC-19 (Ctrl+Z, Cmd+Z, then Ctrl+Shift+Z,
  Cmd+Shift+Z, Ctrl+Y — each one steps, each one takes the browser's own action away),
  TC-20 (board failed to load: buttons dark and the shortcuts unanswered even though a
  step of mine is sitting in the history), TC-21 (Ctrl+Z/Cmd+Z in the share panel's
  link field is left for the browser, and my note stays where I put it).
* **Deviation:** task 11 says "with a fake UndoController". The real controller over a
  real `Y.Doc` is used instead: the interesting failures here (origin filtering, capture
  merging, a shortcut that undoes the wrong thing) are invisible through a fake, and a
  fake would only prove that `useBoardKeys` calls a method.

## Task 5 — E2E: recover my mistakes while colleagues work (TC-22..TC-24)
* `tests/e2e/undo.spec.ts`, chromium against `wrangler dev`, two screens per test (each
  its own browser context, so only the room can carry an edit) and five screens for
  TC-24 (`MAX_CONCURRENT_EDITORS`).
  - TC-22: Mia creates 8 notes (two recoloured), box-selects all 8, deletes; Raj adds a
    note of his own; Mia's Ctrl+Z brings the 8 back **identically** (whole snapshots
    compared: text, colour, size, position) on both screens; the Redo button deletes
    them again on both; Ctrl+Z pressed until the Undo button goes dark (18 of her own
    steps) and Raj's note never moves.
  - TC-23: Mia moves a note twice, Raj deletes it, Mia presses Ctrl+Z — no console/page
    error, no resurrection on either screen, and her next Ctrl+Z still reverses her own
    later work (a fresh note's text goes back on both screens).
  - TC-24: five screens, five notes; each person moves their own note and types into
    the next person's. After one Ctrl+Z each, every text is back and every *move* — all
    of them somebody else's — is still there; after a second Ctrl+Z each, every board is
    byte-identical to the starting board again, and the joined screens have run out of
    their own history while the screen that seeded the board still has its own to go
    through.

## Verification (final state, story 8)
* `npm run build` ✓ `npm run build:test` ✓ `npm run typecheck` ✓.
* `npm run test:unit` → 175 passed (story 8 adds 13: TC-01..TC-13).
* `npm run test:component` → 85 passed (adds `UndoBoundaries` 4 and `UndoControls` 5).
* `npm run test:integration` → 60 passed. `npm run test:e2e` → 38 passed (adds TC-22..TC-24).
* `npm run test:e2e:persist` → 4 passed. `test:e2e:nightly` unchanged by this story.
* Firefox/WebKit still cannot launch on this host (recorded for stories 1-5).
