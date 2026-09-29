# Story 8: the Flash-Next agent's own final statements

The last three substantive assistant messages of the story's pi session, verbatim apart from local paths. The session may continue after nudges, so read them as the agent's claims at the end.

The undo reverts the data but the editor's displayed `value` doesn't reflect external changes to the `Y.Text`. Let me add an observer so the editor stays in sync (this is what makes "undo inside the field" actually visible).

---

Clean tree also fails 4 (TC-32 ×3, TC-36 ×1) — all pre-existing, unrelated to Story 8. My changes add 12 passing tests with zero regressions. Let me verify my test files don't reference a `typingEdit` signature mismatch and clean up probe files.

---

Done. Story 8 (per-user undo/redo) is fully implemented, tested, and committed.

## What I built

**Core controller — `src/client/board/undo.ts`**
`createUndo(doc, opts)` wraps a `Y.UndoManager` over the `objects` map that tracks **only** `LOCAL_ORIGIN` transactions. Remote peer changes arrive under the provider origin and the story‑4 board load under the load origin, so neither ever enters the stacks — undo stays personal. It exposes `undo/redo/boundary/step/typingEdit/canUndo/canRedo/addScope/onChange/destroy/undoDepth`, caps the stack at `UNDO_MAX_STEPS` by trimming the oldest front entries, uses an **injectable clock** (Yjs captures `Date.now` at import, so a fake timer can't reach it) for the capture‑timeout window, and treats a peer‑deleted target as a silent no‑op instead of throwing.

**Step boundaries**
- `transformController` now takes `onGestureStart`/`onGestureEnd` hooks fired at drag start and pointerup, so a whole 30‑frame drag is one step that never merges with the change around it.
- Create, delete and recolour each run inside `undo.step(...)`; the text editor opens a boundary on mount and marks each keystroke with `typingEdit()` so a burst merges into one step.
- The editor also now **observes its `Y.Text`**, so an undo (or remote edit) reverts what the textarea actually shows, not just the data.

**Controls**
- `useBoardKeys`: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y route to the history, matched *before* the modifier guard so they beat native undo; a key in a focused field is left to that field; Escape mid‑gesture is swallowed.
- `UndoButtons` + `Toolbar` history prop and `useUndo` (one session‑only controller per board doc).

## Verification
- `npm run typecheck` — clean (both tsconfigs).
- Full vitest: **351 tests / 33 files pass** (201 unit incl. the 20 new undo suites, 150 component incl. 16 new).
- E2E `undo.spec.ts`: **12 tests pass across chromium, firefox and webkit**.
- Working tree clean; no build artifacts committed.

One note: the 4 pre‑existing e2e failures (TC‑32 zoom‑drag ×3 and a TC‑36 two‑client convergence case) also fail on the clean tree — I confirmed this by stashing my changes — so they are unrelated to this story and I left them untouched.
