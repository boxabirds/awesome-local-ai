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
| 9 | E2E image workflows: moodboard with colleague, mixed picker batch, resize and revisit, flaky upload (TC-25 to TC-28) | done (Chromium only) |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).
## Story 12 - Drop images onto the board (done)

- **Tasks 1-2 done (settings, fixtures, unit tests).** `IMAGE_ACCEPTED_TYPES`,
  `IMAGE_MAX_BYTES`, `IMAGE_MAX_FILES_PER_ADD`, `IMAGE_MAX_PLACE_SIZE_WORLD`,
  `IMAGE_MIN_SIZE_WORLD`, `IMAGE_LAYOUT_GAP_WORLD`, `IMAGE_UPLOAD_STALE_MS`,
  `ASSET_CACHE_MAX_AGE_SECONDS`, `IMAGE_SNIFF_BYTES`, `ASSET_SNIFF_HEAD_BYTES`,
  `ASSET_API_PREFIX` and `ASSET_UPLOAD_SUFFIX` are named settings.
  `scripts/make-image-fixtures.mjs` writes the real fixtures in
  `tests/fixtures/images/` (Chromium's own PNG/JPEG/WebP encoders, a hand-written
  GIF encoder, an SVG with a `<script>`, a PDF renamed `.png`, half a PNG);
  `scripts/embed-image-fixtures.mjs` mirrors them into
  `tests/fixtures/embeddedImages.ts` because the integration runtime has no
  filesystem. `tests/fixtures/oversizeImage.ts` pads a real JPEG with JPEG
  comment segments to exactly 10,485,760 bytes and 10,485,761.
- **Task 3 done.** `src/shared/image-format.ts` sniffs PNG/JPEG/GIF/WebP/SVG from
  magic bytes (`sniffImageType`, SVG only with its namespace), maps the sniff to
  a content type, and owns the asset key shape (`assetKeyFor`, `isAssetKey`,
  `assetKeyOfPath`, `cacheControlForAsset`). `src/client/images/validateFiles.ts`
  is the shared size/count/type rule with per-file reasons.
- **Model half done.** `src/shared/objects/image.ts`: `ImageSnap` (16 stored
  fields, no URL), `createImagePlaceholders` (one `LOCAL_ORIGIN` transaction, so
  a 3-file drop is 3 objects and 1 undo step), the four status writers (all
  `UPLOAD_ORIGIN`, so they never enter anyone's undo history), `displayStatus`
  (`uploading` older than `IMAGE_UPLOAD_STALE_MS` renders `unfinished`),
  `layoutRow` (`centre`/`first`), and self-registration so `objectSnapshots`,
  `removeObjects` and delete-by-id know `image`.
- **Task 4-5 done.** `src/worker/assets.ts` + routes in `src/worker/index.ts`
  (`POST /api/boards/:id/assets`, `GET /api/assets/:boardId/:assetId`), the R2
  binding in `wrangler.jsonc` (`ASSETS_BUCKET` / `vidi6-assets`) and `Env`. Board
  id decides everything: a bad or unknown board id is a 404 that stores nothing,
  10 MB is measured on the server, the sniff names the stored content type, keys
  are random per upload and never overwritten, and a served asset is
  `public, max-age=31536000, immutable` with `nosniff` and no
  `Content-Disposition`. `tests/integration/assets.test.ts` (19 tests) covers
  TC-10..TC-13, TC-15 (a bucket wrapper that refuses one board's writes) and
  TC-16's board prefix isolation.
- **Unit tests**: 48 new tests in `tests/unit/image-format.test.ts`,
  `tests/unit/validate-files.test.ts`, `tests/unit/object-image.test.ts` pass;
  the three new `tests/unit/registry.test.ts` TC-14 assertions are red until the
  registry entry lands.
- **Next**: task 6 (upload transport, `useImageInsert`, drop highlight, toast),
  task 7 (`ImageObject` + registry entry), task 8 component tests, task 9 e2e.

- **Task 6 done.** `src/client/images/uploadImage.ts` uploads with `fetch` and a
  `ReadableStream` request body, counting the bytes it writes, so progress is the
  board's own (`upload-progress.json`); `AbortController` gives it a stop.
  `src/client/images/useImageInsert.tsx` owns the three entry points (drop, paste,
  picker), the row layout at the drop point, one undo step around the whole add, the
  per-reason toasts, the upload handles, `retry`, `abandon` and the `ImageAdditions`
  context an image object reads its progress and buttons from. `DropHighlight.tsx`
  and `ImageToasts.tsx` are the visible halves.
- **Task 7 done.** `src/client/objects/ImageObject.tsx` renders the six states
  (picture, `uploading` with a percentage for the uploader, `unfinished` for
  everyone, `Upload failed` + Retry/Remove for the uploader, `Image unavailable` for
  anybody else, and an unreachable-but-ready image), on one shared 30-second clock,
  and the registry entry is `resizable`, `aspectLocked`, `minSize:
  IMAGE_MIN_SIZE_WORLD`, `editableText: false`.
- **Task 8 done.** `tests/component/useImageInsert.test.tsx` (20 tests) and
  `tests/component/ImageObject.test.tsx` (20 tests) cover TC-17..TC-19, TC-21..TC-24
  and TC-29 against a real Y.Doc with a fake provider and a fake upload transport
  (`tests/fixtures/fakeUpload.ts`) that can be planned, aborted and awaited.
- **Task 9 done (Chromium only).** `tests/e2e/images.spec.ts` - TC-25 (three real
  drops, two live boards, placeholder-to-picture on both, row layout, keys identical
  on both, drop-to-placeholder 121 ms against the 1 000 ms budget, logged not
  asserted), TC-26 (picker takes the PNG, refuses a renamed PDF and an 11 MB JPEG by
  name), TC-27 (corner drag keeps the ratio within 1%, the floor is
  `IMAGE_MIN_SIZE_WORLD`, a browser that never saw the upload gets the same picture),
  TC-28 (upload cannot go out, "Upload failed" with Retry, Retry fills in the same
  object and the served bytes are the PNG). `tests/e2e/helpers/images.ts` builds real
  `File`s in real `DataTransfer`s, answers the file chooser, watches every status the
  page renders, and reads both the model and the painted box. `window.__vidi6.images()
  ` was added for it.
- **Whole suite here**: unit 407/407, component 280/280, integration 81/81, e2e 64/64
  (Chromium; Firefox and WebKit binaries are unavailable on this machine, as recorded
  at the top of NOTES.md), `npm run typecheck` and `npm run build` clean.
