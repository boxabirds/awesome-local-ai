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

## Notes on the finished row

- All TCs in the design's matrix have a test: TC-01/02 (`tests/unit/image-format.test.ts`),
  TC-03 to TC-07 (`tests/unit/image-model.test.ts`), TC-08/09
  (`tests/unit/validate-files.test.ts`), TC-10 to TC-13, TC-15, TC-16
  (`tests/integration/assets.test.ts`, real R2 under workerd), TC-17 to TC-19, TC-21 to TC-24,
  TC-29 (`tests/component/ImageInsert.test.tsx`, `tests/component/ImageObject.test.tsx`),
  TC-25 to TC-28 plus TC-25b / TC-28b (`tests/e2e/images.spec.ts`). TC-14 is not in the design's
  table: a truncated PNG is stored (sniffing is not decoding), which
  `tests/integration/assets.test.ts` asserts as its own case, and the client-side decode refusal is
  TC-29.
- Gates at commit time: typecheck clean, `npm run build` clean with zero `__vidi6` in the bundle,
  unit 302 passed (23 files), component 197 passed (26 files), integration 73 passed (6 files),
  e2e 59 passed — the image spec also run with `--repeat-each=3 --workers=2` to prove TC-25 is not
  a flake.
- One behaviour outside story 12's own files changed, deliberately and with a test of its own: an
  aspect-locked resize now clamps to a single scale (`src/client/board/useTransformGesture.ts`),
  because per-axis clamping left a wide picture at 16x16 — the minimum honoured, the ratio gone.
  Story 9's `TextObject.test.tsx` TC-23 was updated for it and gained the assertion the old
  behaviour failed. See NOTES.md.
- Firefox and WebKit still cannot launch on this machine, as recorded for stories 1 to 11; the image
  specs use no engine-only API and the picker's `accept` carries suffixes as well as MIME types for
  the browser that cannot run here.

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).
