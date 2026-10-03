# Story 12: Drop images onto the board

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write image format sniffing and file validation unit tests first (TC-01, TC-02, TC-08, TC-09) | done |
| 2 | Write image object model unit tests first (TC-03 to TC-07) | done |
| 3 | Implement asset API: R2 binding, upload with sniffing and size limit, immutable serving | done |
| 4 | Integration tests for asset API with real R2 and BoardRoom (TC-10 to TC-13, TC-15, TC-16) | done |
| 5 | Implement image object model: placement, row layout, placeholders, status updates with untracked origin | done |
| 6 | Implement adding images: drop highlight, paste, Image tool picker, validation toasts, XHR upload with progress, retry | done |
| 7 | Implement ImageObject render states and aspect-locked registry entry | done |
| 8 | Component tests for image insert flows and ImageObject states (TC-17 to TC-19, TC-21 to TC-24, TC-29) | done |
| 9 | E2E image workflows: moodboard with colleague, mixed picker batch, resize and revisit, flaky upload (TC-25 to TC-28) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Result

All 9 tasks done. Test totals: 194 unit, 123 component, 50 integration, and 4 e2e image
workflows (TC-25 to TC-28) passing in chromium. `vite build` (production) and the test-mode
build both succeed; worker and client typechecks are clean.

Note: the e2e suite requires `vite build --mode test` (the `__vidi6` test hooks are only
registered in test-mode builds) — the `test:e2e` script does this automatically. One pre-existing
e2e failure is unrelated to this story: `undo.spec.ts TC-22` (per-user history isolation) fails
with or without these changes (verified by stashing and re-running).
