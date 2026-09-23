# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write image format sniffing and file validation unit tests first (TC-01, TC-02, TC-08, TC-09) | proposed | test:unit | assets.api, image.insert |
| 2 | Write image object model unit tests first (TC-03 to TC-07) | proposed | test:unit | image.model |
| 3 | Implement asset API: R2 binding, upload with sniffing/limits/rate limit, immutable serving | proposed | implementation | assets.api |
| 4 | Integration tests for asset API with real R2 and BoardRoom (TC-10 to TC-16) | proposed | test:integration | assets.api |
| 5 | Implement image object model: placement, row layout, placeholders, status updates with untracked origin | proposed | implementation | image.model |
| 6 | Implement adding images: drop highlight, paste, Image tool picker, validation toasts, XHR upload with progress, retry | proposed | implementation | image.insert |
| 7 | Implement ImageObject render states and aspect-locked registry entry | proposed | implementation | image.object |
| 8 | Component tests for image insert flows and ImageObject states (TC-17 to TC-24, TC-29) | proposed | test:ui-component | image.insert, image.object |
| 9 | E2E image workflows: moodboard with colleague, mixed picker batch, resize and revisit, flaky upload (TC-25 to TC-28) | proposed | test:e2e | assets.api, image.insert, image.object |

## Details

### 1. Write image format sniffing and file validation unit tests first (TC-01, TC-02, TC-08, TC-09)

## Goal
Test-first coverage of the pure parts of assets.api (`sniffImageType`, `ASSET_KEY_PATTERN`, `assetKeyFor`) and image.insert (`validateFiles`, `REJECTION_MESSAGES`); add story 12 named settings (IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MIN_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS, IMAGE_UPLOAD_LIMIT, IMAGE_UPLOAD_PERIOD_SECONDS, ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES) and stubs.

## Fixtures (`tests/fixtures/images/`)
Real PNG screenshot 1440x900, JPEG photo 4032x3024, animated GIF, WebP, SVG containing a script tag, PDF renamed .png, truncated PNG; generators for exactly IMAGE_MAX_BYTES and +1 byte.

## Cases
- TC-01 sniffImageType: PNG, JPEG, GIF87a, GIF89a, WebP → accepted types; SVG text, renamed PDF, 3 random bytes → null (negative).
- TC-02 ASSET_KEY_PATTERN: valid `<22>/<22>` → true; missing part, `../`, 23-char id → false.
- TC-08 validateFiles size IMAGE_MAX_BYTES → accepted; +1 → rejected with 'size' (boundary).
- TC-09 21 valid files → first IMAGE_MAX_FILES_PER_ADD accepted + 'count'; PDF + PNG mix → PNG accepted + 'type'. REJECTION_MESSAGES match PRD wording exactly.

## Done when
Suites compile and fail only with "not implemented".

### 2. Write image object model unit tests first (TC-03 to TC-07)

## Goal
Test-first suite for image.model (`placementSize`, `layoutRow`, `createImagePlaceholders`, `markImageReady`, `markImageFailed`, `markImageRetrying`, `displayStatus`, `UPLOAD_ORIGIN`) on a real Y.Doc with a real `Y.UndoManager` tracking LOCAL_ORIGIN only.

## Cases
- TC-03 placementSize 400x300 → 400x300 (no upscale); 1600x1200 → 800x600; 300x3200 → 75x800; 800x800 → 800x800 (IMAGE_MAX_PLACE_SIZE_WORLD boundary).
- TC-04 layoutRow of 3 sizes with `top-left` at a point → tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD; `centre` anchor → row centred on the point.
- TC-05 createImagePlaceholders for 3 items → 3 objects `status: 'uploading'` with uploaderId and uploadStartedAt in one update event; markImageReady on one (UPLOAD_ORIGIN) → assetKey set; UndoManager undo stack length is 1; undo removes all 3 placeholders (negative: completion is not its own undo step).
- TC-06 displayStatus: uploading at IMAGE_UPLOAD_STALE_MS − 1 → uploading; + 1 → unfinished; failed → failed; ready → ready (boundary).
- TC-07 markImageReady / markImageFailed on a deleted id → false, no update (error path).

## Done when
Suite compiles and fails only with "not implemented".

### 3. Implement asset API: R2 binding, upload with sniffing/limits/rate limit, immutable serving

## Goal
Implement assets.api per contract and HTTP table.

## Approach
- `wrangler.jsonc`: `r2_buckets` binding ASSETS_BUCKET (bucket `vidi6-assets`); `ratelimits` binding ASSET_UPLOAD_LIMITER with limit/period mirroring IMAGE_UPLOAD_LIMIT / IMAGE_UPLOAD_PERIOD_SECONDS.
- `image-format.ts`: `sniffImageType` from the first IMAGE_SNIFF_BYTES (PNG `89 50 4E 47`, JPEG `FF D8 FF`, `GIF87a`/`GIF89a`, WebP `RIFF....WEBP`); `ASSET_KEY_PATTERN`; `assetKeyFor(boardId, assetId)`.
- `handleUpload`: board id pattern → 404; limiter by `CF-Connecting-IP` → 429; story 5 `exists()` RPC → 404; `Content-Length` > IMAGE_MAX_BYTES → 413; `arrayBuffer()` then byte length check → 413; sniff (ignore client Content-Type) → 415 for anything else incl. SVG; `ASSETS_BUCKET.put(assetKeyFor(boardId, newBoardId()), bytes, { httpMetadata: { contentType } })`; throw → 500; else 201 `{ assetKey, contentType }`. Nothing is written on any error path.
- `handleServe`: key pattern → 404; `get` missing → 404; else 200 with stored Content-Type, `Cache-Control: public, max-age=ASSET_CACHE_MAX_AGE_SECONDS, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`.
- `index.ts` routes `POST /api/boards/:id/assets`, `GET /api/assets/:boardId/:assetId`.

## Done when
TC-01, TC-02 and integration TC-10..TC-16 pass.

### 4. Integration tests for asset API with real R2 and BoardRoom (TC-10 to TC-16)

## Goal
Verify the assets.api HTTP contract (`handleUpload`, `handleServe`) through `SELF.fetch` with real Miniflare R2 and the real story 5 `exists()` RPC.

## Cases
- TC-10 POST real PNG fixture to a created board → 201; R2 object exists with contentType image/png; key matches ASSET_KEY_PATTERN.
- TC-11 POST to a never-created board id and to a malformed id → 404; R2 list empty (negative).
- TC-12 POST IMAGE_MAX_BYTES + 1 bytes → 413 nothing stored; POST a valid JPEG of exactly IMAGE_MAX_BYTES → 201 (boundary).
- TC-13 POST renamed PDF with `Content-Type: image/png` and POST SVG with script → 415 both, nothing stored (negative, security).
- TC-14 IMAGE_UPLOAD_LIMIT + 1 uploads from one `CF-Connecting-IP` → last 429; a different IP → 201. Use the real ratelimit binding if the local runtime supports it, else a fake implementing `limit({key})`; document which in the file.
- TC-15 wrap ASSETS_BUCKET.put to throw → 500 (error path).
- TC-16 GET stored key → 200 with Content-Type, immutable Cache-Control, `nosniff`, CSP `default-src 'none'`; GET missing key → 404; GET `../x` → 404.

## Done when
All pass in `npm run test:integration`.

### 5. Implement image object model: placement, row layout, placeholders, status updates with untracked origin

## Goal
Implement image.model per contract so TC-03..TC-07 pass.

## Approach
- Schema: common fields + assetKey (null while uploading), contentType, naturalWidth, naturalHeight, status, uploadStartedAt, uploaderId; `snapshot()` emits ImageSnap.
- `placementSize`: scale factor min(1, IMAGE_MAX_PLACE_SIZE_WORLD / longest side) — never upscales.
- `layoutRow`: left to right with IMAGE_LAYOUT_GAP_WORLD; `top-left` anchors the first image's top-left at the drop point; `centre` centres the whole row on the given point (picker, paste).
- `createImagePlaceholders`: one LOCAL_ORIGIN transaction for all items (single undo step), skips items with non-finite sizes, z increasing.
- `markImageReady` / `markImageFailed` / `markImageRetrying`: stale id → false; otherwise one transaction with `UPLOAD_ORIGIN` (not in UndoManager trackedOrigins).
- `displayStatus`: `uploading` older than IMAGE_UPLOAD_STALE_MS → `unfinished`.

## Done when
Image model unit tests pass, including the undo-stack assertion.

### 6. Implement adding images: drop highlight, paste, Image tool picker, validation toasts, XHR upload with progress, retry

## Goal
Implement image.insert per contract.

## Approach
- `validateFiles`: keep first IMAGE_MAX_FILES_PER_ADD ('count'), reject non-accepted `File.type` ('type') and size > IMAGE_MAX_BYTES ('size'); `REJECTION_MESSAGES` hold the exact PRD strings plus 'offline' and 'rate'.
- `uploadImage`: XMLHttpRequest POST `/api/boards/:id/assets` with `upload.onprogress` → fraction; 201 → ok(assetKey); 429 → rate_limited; any other status or network error → failed; `abort()`.
- `useImageInsert`:
  - Offline gate: ConnectionState not `connected`/`confirmed` → offline toast, nothing created, no upload.
  - Entry points: `onDragOver`/`onDrop` on BoardViewport (DropHighlight only for file drags; drop point → world, `top-left` layout); `onPaste` on window ignored when focus is in a textarea/input/contenteditable or clipboard has no image files (`centre` layout at view centre); `openPicker` via hidden `<input type=file multiple accept=...>` from the Image button / I shortcut, then tool returns to Select.
  - `createImageBitmap` per accepted file for natural size (reject → type toast, file skipped); `placementSize` + `layoutRow`; one `createImagePlaceholders` call.
  - Parallel uploads updating a `progress` map; ok → `markImageReady`; rate_limited → `markImageFailed` + rate toast; failed → `markImageFailed`.
  - In-memory `Map<id, File>` for `retry(id)` (`markImageRetrying` then re-upload) and `canRetry(id)`; lost on reload by design.
- `Toast`: bottom-centre, `role=status`, auto-dismiss.

## Done when
TC-17..TC-20, TC-29 and e2e TC-25, TC-26, TC-28 pass.

### 7. Implement ImageObject render states and aspect-locked registry entry

## Goal
Implement image.object per contract.

## Approach
- `ImageObject` switches on `displayStatus(image, now)`:
  - uploading: grey box of object size; uploader sees image icon + progress bar with percentage; others see "Uploading…".
  - ready: `<img src="/api/assets/<assetKey>" alt="Image" draggable=false decoding=async loading=lazy>` filling the object; `onError` → local "Image unavailable" state (retries when the snapshot's assetKey changes).
  - failed: uploader → red border, "Upload failed", Retry (only when `canRetry`) and Remove; others → broken-image icon, "Image unavailable".
  - unfinished: "Image upload didn't finish" + Remove for anyone.
- Clock: a shared 30-second interval re-renders while any image is uploading so `unfinished` appears without interaction.
- Remove → story 7 `deleteObjects([id])`; Retry → `useImageInsert.retry(id)`.
- Registry `image`: `{ Component: ImageObject, resizable: true, aspectLocked: true, minSize: IMAGE_MIN_SIZE_WORLD, editableText: false, hitTest: bbox }` so resizing keeps proportions with a floor.

## Done when
TC-21..TC-24 and e2e TC-27, TC-28 pass.

### 8. Component tests for image insert flows and ImageObject states (TC-17 to TC-24, TC-29)

## Goal
jsdom tests with a real Y.Doc for image.insert (useImageInsert with mocked `uploadImage` and stubbed `createImageBitmap`) and image.object (render states per displayStatus and identity).

## image.insert
- TC-17 drop 3 valid files → 3 placeholders in a row from the drop point; progress text updates as the mock emits progress; ready after resolve.
- TC-18 paste an image while editing sticky text → no image created (negative); paste while the board is focused → image centred in view.
- TC-19 ConnectionState `reconnecting` then drop → offline toast; no objects; upload not called (negative).
- TC-20 picker with mocked upload returning rate_limited → object failed; rate toast.
- TC-29 createImageBitmap rejects for corrupt file → type toast, no placeholder (error path).

## image.object
- TC-21 failed object rendered for uploader → "Upload failed" with Retry and Remove; for another identity → "Image unavailable".
- TC-22 uploading object older than IMAGE_UPLOAD_STALE_MS → "Image upload didn't finish" + Remove; Remove deletes the object.
- TC-23 ready image fires `error` → "Image unavailable" box with same size.
- TC-24 Retry with file in memory → status uploading and upload called again; after simulated reload (`canRetry` false) → Retry hidden, only Remove.

## Done when
All pass in `npm run test:component`.

### 9. E2E image workflows: moodboard with colleague, mixed picker batch, resize and revisit, flaky upload (TC-25 to TC-28)

## Goal
Real-browser proof across assets.api (real upload to local R2 and immutable serving), image.insert (drop via DataTransfer, picker via setInputFiles, validation toasts, failure and retry) and image.object (placeholders for others, aspect-locked resize, persistence after reload) against `wrangler dev`.

## Helper
`drop-files.ts`: builds a DataTransfer from fixture files inside the page and dispatches dragenter/dragover/drop at a board point.

## Workflows
- "Moodboard with a colleague" TC-25: Leo drops 3 screenshots; Sam's context sees "Uploading…" placeholders, then all three images within LIVE_UPDATE_LATENCY_BUDGET_MS plus image load; GET responses carry immutable Cache-Control.
- "Mixed picker batch" TC-26: press I, `setInputFiles` with valid PNG + renamed PDF + 11 MB JPEG → one image added; type and size toasts with exact wording.
- "Resize and revisit" TC-27: resize an image by a corner → aspect ratio within 1%; drag smaller than IMAGE_MIN_SIZE_WORLD stops at the floor; reload in a new context → image present.
- "Flaky upload" TC-28: `page.route` aborts POST assets → "Upload failed" with Retry; restore route, click Retry → image ready on both screens.

## Done when
All pass in chromium; TC-26 also in firefox and webkit.

