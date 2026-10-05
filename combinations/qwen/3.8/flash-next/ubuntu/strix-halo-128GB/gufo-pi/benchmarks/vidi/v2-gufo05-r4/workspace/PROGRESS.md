# Implementation progress

Story 8 — Undo and redo my own changes without undoing anyone else's.

## Current task

Complete. Controller, React binding, toolbar/keyboard UI, gesture and text boundaries, and
the full test set (unit TC-01..13, component TC-14..21, e2e TC-22..24) are written and
green. `npm run build`, `npm run typecheck`, `npm run test:unit`, `npm run test:component`,
`npm run test:e2e` (58) and `npm run test:e2e:nightly` (2) all pass.

## Done

- [x] Story 7 left the working tree clean (HEAD `a845927`).
- [x] Read story 8 spec (prd, design, tasks), AGENTS.md, CONTEXT.md.
- [x] Studied `Y.UndoManager` internals (capture window, popStackItem safety, events).
- [x] `src/shared/config.ts`: `UNDO_CAPTURE_TIMEOUT_MS` (500), `UNDO_MAX_STEPS` (200).
- [x] `src/client/board/undo.ts`: `createUndo`/`UndoController` over `Y.UndoManager`,
      origin-filtered to `LOCAL_ORIGIN`, max-steps trim, `boundary`, `onChange`,
      `addScope`.
- [x] Task 6/7 unit tests green: `tests/unit/undo-history.test.ts` (TC-01..TC-11),
      `tests/unit/undo-boundaries.test.ts` (TC-12..TC-13), `tests/unit/helpers/peer.ts`.
      Inlined `yjs`/`lib0` in the unit project so a `vi.mock('lib0/time')` drives the
      capture window against an injected clock.
- [x] Task 8 React binding: `src/client/board/useUndo.ts` — `useUndo(controller, canEdit)`
      (re-renders on `onChange`, gates enabled on `canEdit`), an `UndoProvider`, and
      `useUndoController()` for deep components (the editor) without widening
      `ObjectComponentProps`.
- [x] Client wiring: `BoardScreen` builds one controller per doc (`useMemo`), destroys it on
      doc change/unmount, wraps the board in `UndoProvider`, and closes `boundary()` around
      create, delete, the gesture (`onGestureStart`/`onGestureEnd`) and the toolbar/keys.
- [x] Gesture boundary: `useTransformGesture.begin()` calls `onGestureStart` before the
      bring-to-front write, so a closed step never absorbs the gesture's own re-stack.
- [x] Text boundaries: `StickyTextEditor` brackets the editing session with `boundary()` and
      routes its own Ctrl/Cmd+Z and Ctrl/Cmd+Y through the controller (the browser textarea
      undo would desync the document). `StickyNote` brackets colour and delete.
- [x] `useBoardKeys`: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y drive undo/redo (only when the
      board owns the key); nudge and delete close a step each.
- [x] `Toolbar`/`UndoButtons`: Undo and Redo buttons with tooltips, `data-vidi6` attributes and
      enabled/disabled state; edit-lock (`canEdit`) disables them and ignores the shortcuts.
- [x] Tasks 9-11 component tests: `tests/component/undo-boundaries.test.tsx` (TC-14..17, real
      screen + real controller) and `undo-controls.test.tsx` (TC-18..21, fake controller).
- [x] Task 5 e2e: `tests/e2e/undo.spec.ts` (TC-22..24) across isolated browser profiles.
- [x] `npm run build`, `npm run typecheck`, all `npm run test:*` (incl. nightly + persistence).

## Blockers / notes

- Controller is created where the `Y.Doc` is (the `Board` component in `BoardScreen`),
  not in `App.tsx`: since story 5 `App.tsx` is only a router and the document lives in
  `BoardScreen`'s `useBoardDoc`. One controller per doc, destroyed on doc change and
  unmount, is still satisfied because `App` keys `BoardPage` by board id. Noted in
  NOTES.md.
