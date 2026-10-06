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

## Where things went

- Sniffing, key format, accepted types: `src/shared/image-format.ts` (rewritten to the design's API).
- Settings that the design names: `src/shared/config.ts`. `IMAGE_MAX_FILES_PER_ADD` was sitting there at 5
  with nothing reading it; the design and TC-09 say 20, so it is 20 now.
- Asset API: `src/worker/assets.ts` (`handleUpload` / `handleServe`), routed from `src/worker/index.ts`,
  R2 bucket bound in `wrangler.jsonc`, `ASSETS_BUCKET` typed in `src/worker/env.d.ts` (without it
  `npm run typecheck` fails on the new binding, and the two `.dev.vars.example`-style type globals cannot be
  merged into the client program — `tsconfig.worker.json` covers it instead).
- Object model: `src/shared/objects/image.ts`, with a snapshot branch in `src/shared/board-model.ts`.
- Adding: `src/client/images/{validateFiles,uploadImage,useImageInsert,DropHighlight}.tsx?` and
  `src/client/ui/Toast.tsx`.
- Rendering: `src/client/objects/ImageObject.tsx`, registered in `src/client/objects/registry.tsx` with
  `aspectLocked: true` and `minSize: IMAGE_MIN_SIZE_WORLD`; styles in `src/client/styles.css`.
- Wiring: the Image button in `src/client/board/Toolbar.tsx`, the `i` shortcut through `opensFilePicker` in
  `src/client/board/useBoardKeys.ts`, and `Board.tsx` (drop handlers, runtime context, highlight, toast).
  `openImage` is an action on `useActiveTool`, the way `openSticky` is; 'image' is deliberately not in
  `BUILT_TOOLS`, which the sticky and toolbar tests assert verbatim.
- Tests: `tests/unit/{image-format,image-model,validate-files}.test.ts`,
  `tests/integration/assets.test.ts`, `tests/component/{useImageInsert,ImageObject}.test.tsx`,
  `tests/component/helpers/fake-uploads.ts`, `tests/e2e/{helpers/drop-files,helpers/images,images.spec.ts}`,
  fixtures in `tests/fixtures/images/` with a README.

## Two things worth knowing before you read the tests

- **Story 3 needed nothing filling.** Tasks 4, 7, 8 and 9 read as if they would have to backfill the toolbar
  tool, undo/delete/resize/selection behaviour, shape rendering or styles; `src/shared/objects/shape.ts` and
  `stroke.ts` already exist, the toolbar already carries five tools, and undo, selection, resize,
  `SelectionOverlay` and the stylesheet are all in place from stories 6–11. Story 12 adds to them rather than
  repairing them.
- **The e2e side needed two new helper files, and they are the story's real test dependency.** Nothing in
  `tests/e2e/helpers/` could put a *file* into a drag, answer a file chooser, or make an upload take measurable
  time; those are browser facilities rather than board facilities, so they got their own file
  (`tests/e2e/helpers/drop-files.ts`) and a reader for the picture side of things
  (`tests/e2e/helpers/images.ts`). The board's own helpers — `readCamera`, `screenOfWorld`, `handleScreen`,
  `dragFromPoint`, `waitForObjectAtRest`, `expectEventually`, the latency report — are used unchanged.
  A file chooser has to be caught at the moment it opens (`openPickerWithKey`, `openPickerWithButton`):
  Playwright holds a page while a native dialog is up, so a test that pressed the Image button and then asked
  the page for anything would be a test that timed out on the wrong line.
- **One pre-existing failure, verified as pre-existing.** The nightly `capacity-soak` test times out at its own
  300-second budget on this machine with or without this story's code — checked against a clean worktree at
  `HEAD`. Everything else runs green: 573 unit, 414 component, 167 integration, 83 chromium e2e, 4 persistence.
  `NOTES.md` has the story's deviations, findings and counts.

