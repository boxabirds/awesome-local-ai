# PROGRESS — story 12 (images)

Workflow log for story 12 (`spec/stories/012-drop-images-onto-the-board/`). The
task list with its checkboxes lives in `tasks.md`; this file is the running log.

## Machine notes

- `nvm` is not loaded in a fresh shell: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` first.
- Allowed ports 25232–25247. `npm run dev` → 25232/25233. Vitest/vite default to
  25234/25235 and are unused by the test suites (they are free, so no override needed).
- Playwright is effectively **chromium-only** on this box (`NOTES.md`); the image suite
  uses the `chromium` project. No R2 bucket has been created for `e2e:headed`.
- `sips` is available (macOS) if an image ever needs converting; fixtures are generated
  by a script instead (see below).

## Reading done before coding

Story 12 (`prd.md`, `design.md`, `tasks.md`) in full, plus `spec/README.md` (the story
index). This checkout has no `spec/WORKFLOW.md`, no `spec/architecture.md`, no
`spec/a11y.md` and no `docs/` briefs — the paths the agent brief names do not exist
here — so the standing conventions came from the code and from `NOTES.md`, which every
previous story wrote an entry in.

Stories already built: 1, 2, 3, 4, 5, 7, 8, 9, 10, 11 (each with a NOTES.md learning
entry). Not built: 6, 13–17.

## Plan (tasks.md order; every task starts by writing the failing test)

1. **Shared model + unit tests** — `src/shared/config.ts` named settings,
   `src/shared/image-format.ts` (`sniffImageType`, `ASSET_KEY_PATTERN`, `assetKeyFor`),
   `src/shared/objects/image.ts` (schema, placement maths, statuses, `UPLOAD_ORIGIN`).
   Tests: `tests/unit/image-format.test.ts`, `tests/unit/image-model.test.ts` (TC-01…TC-07),
   plus `tests/unit/config.test.ts` assertions for the new settings. Fixtures under
   `tests/fixtures/images/` built by `tests/fixtures/images/make-fixtures.mjs`
   (hand-written PNG/GIF/PDF writers + headless Chromium for JPEG/WebP; the
   exactly-`IMAGE_MAX_BYTES` JPEGs are padded from the base JPEG at read time so the
   repo does not carry 20 MB of binaries).
2. **Worker asset endpoints** — `wrangler.jsonc` `r2_buckets` binding, `Env.ASSETS_BUCKET`,
   `src/worker/assets.ts`, routes in `src/worker/index.ts`. Integration tests
   `tests/integration/assets.test.ts` (TC-10…TC-13, TC-15, TC-16) against real local R2.
3. **Client** — `src/client/images/{validateFiles,uploadImage,useImageInsert,DropHighlight}.ts(x)`,
   `src/client/objects/ImageObject.tsx`, registry entry, `useBoardDoc.images`, Board wiring
   (render branch, drop/paste, Image toolbar button + `I`), `src/client/ui/Toast.tsx`,
   test hooks (`getImages`). Component tests (TC-08/09 via unit, TC-17…TC-19, TC-21…TC-24, TC-29).
4. **E2E** — `tests/e2e/helpers/drop-files.ts`, `tests/fixtures/images/*` consumed,
   `tests/e2e/images.spec.ts` (TC-25…TC-28) on chromium; run the whole suite (all suites + e2e) after implementation.
5. **Review** — `docs/code-review.md` rubric → `code-review.md`; self-learning →
   `docs/lessons/2026-07-30-story12-images.md` + index + `NOTES.md`; commit only if green.

## Log

- (start) No code written yet.
- Fixtures: `tests/fixtures/images/make-fixtures.mjs` generates 9 real files (PNG 120×90
  and 1440×900, GIF, truncated PNG, PDF, PDF-named-.png, SVG, and JPEG/WebP rendered by
  headless Chromium), prints what Chromium decoded for each, and also emits
  `embedded.ts` — the same bytes base64'd, because the integration pool runs inside
  workerd, where this directory does not exist (`readFileSync` is denied). Unit test
  `tests/unit/fixtures.test.ts` compares the two copies and re-sniffs every header.
- Tasks 1, 2, 4, 5 done: shared settings, `image-format.ts`, `objects/image.ts`,
  `validateFiles.ts` and their unit tests (TC-01…TC-09), plus the worker asset API
  (`src/worker/assets.ts`, routes + `ASSETS_BUCKET` binding) and its integration tests
  (TC-10…TC-13, TC-15, TC-16). 262 unit + 70 integration tests green; `tsc --noEmit` clean.
- Two findings worth keeping: `Y.UndoManager.undo()` returns the stack item (or
  `null`), not a boolean — asserted as truthy/falsy; and redo restores an undone image
  *with* its untracked `ready` update, because Yjs undoes items, not field values.
- Tasks 3 and 4 done in the same pass: the client (`validateFiles`, `uploadImage` as an XHR
  so progress exists at all, `useImageInsert` behind all three doors, `DropHighlight`,
  `ImageObject`, `Toast`, registry entry, Board wiring, `I` shortcut, `getImages` test hook),
  the component tests in the design's own file names (`useImageInsert.test.tsx` for the doors
  and refusals, `ImageObject.test.tsx` for the five states of one image), and the e2e
  (`tests/e2e/helpers/images.ts`, `tests/e2e/images.spec.ts`: TC-25 drop onto another screen,
  TC-26 mixed picker, TC-27 aspect-locked resize and its minimum, TC-28 refused upload,
  Retry, picture). Commits: `296c02c` (model + worker + integration), `fb5eeea` (component),
  `8ed97b0` (e2e).
- Two things the e2e found in *product* code, both fixed rather than worked around:
  `useTransformGesture` clamped an aspect-locked resize by `Math.min`, which let a 120×90
  image end up at 16×12 under a minimum of 16 (now `Math.max`; TC-27 measures it); and the
  Image button made the tool rail tall enough to hide a shape that story 10's TC-26 parks at
  world x −600, so that test now clicks a part of the shape the screen can actually see
  (`clickShapeVisible`) — the rail is an overlay and the board pans, so the layout is not the
  bug (see the story 10 note "the top-left corner of the board belongs to the toolbar").
- Review pass (task 5), all of it caught before committing and each with a test beside it:
  `readBody` in `src/worker/assets.ts` now counts an arriving body in chunks and gives up
  past `IMAGE_MAX_BYTES` instead of buffering an unlimited chunked POST (integration test
  streams the same 1 MiB chunk eleven times); `ImageObject` builds an `<img>` URL only out of
  a key `isAssetKey` accepts, because the document is writable by anyone with the link and
  `encodeURIComponent` does not escape dots (component test: a `ready` object with a
  `../../etc/passwd` key says "Image unavailable" and asks for nothing); the progress bar
  gained `aria-valuemin/max` and a name; a press on Retry/Remove no longer starts a move
  gesture, since the buttons live inside the box that answers `pointerdown`.
- `NOTES.md` carries the story's learning entry (two origins and one undo step; fixtures
  generated twice because workerd has no filesystem; `writeHttpMetadataHeaders` missing in
  workerd; the `Math.max` clamp; the rail; Playwright's drop/paste/picker and its two route
  patterns; the jsdom gaps; `corrupt.png` decoding differently as `<img>` and as a bitmap;
  Firefox/WebKit still unavailable).
- Suite, in full, on the final tree: `tsc --noEmit` clean; unit 265; component 159;
  integration 71 (against real local R2, incl. the streamed-oversize case); e2e 59/59;
  `test:e2e:persist` 4/4 (a restarted `wrangler dev` serves the new routes and the R2
  binding). TC-25's logged drop-to-placeholder latency on the second screen: ~125 ms against
  a 1000 ms budget (logged, not asserted, per the design).
- Not covered, deliberately: the nightly soak (nothing about sync/rooms changed), Firefox and
  WebKit (binaries abort on launch, as recorded for stories 1–11 — only the *test* fakes are
  Chromium-specific, not the product paths), and an actual R2 bucket in a real account: local
  `wrangler dev` gives the Worker its own.
