# Story 2: Capture ideas on sticky notes and rearrange them

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write board model unit tests first against a real Y.Doc (TC-01 to TC-12, TC-39) | done |
| 2 | Implement Yjs board model and useBoardDoc snapshot hook | done |
| 3 | Write sticky text logic unit tests first (TC-13 to TC-17) | done |
| 4 | Implement sticky text editing: start/end editing, minimal Y.Text diff, length limit, auto-fit font | done |
| 5 | Implement sticky note interaction: select, drag to move, double-click create, keyboard delete | done |
| 6 | Implement toolbars: Sticky note button, colour swatches and delete button | done |
| 7 | Component tests for sticky interaction, text editor and toolbars | done |
| 8 | E2E sticky note workflows (create, move at zoom, recolour, delete, long text) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Notes

- Tasks 1-8 cover the whole story; integration (App wiring the model, toolbars, notes and keyboard
  shortcuts into the viewport) landed with tasks 5-8 and is verified by the e2e golden path.
- Final verification (2026-07-29): `npm run typecheck` clean, `npm run build` succeeds,
  `npm run test:unit` 63 passed, `npm run test:component` 47 passed, `npm run test:e2e` 11 passed
  (7 story 1 + 4 story 2, chromium).
- e2e found a real-browser bug that jsdom could not: raising a note mid-drag re-inserted its DOM
  node, which fires `lostpointercapture` and killed the drag. Notes now stack with CSS `z-index`
  and keep a stable id order in the DOM (paint order is unchanged).
- Firefox and WebKit cannot launch on this machine (missing system libraries, not root);
  `playwright.config.ts` documents how to enable them. Reason recorded in NOTES.md.
- Scope guard: no server/Worker code, no network or storage, nothing from story 6 or 13-17.

