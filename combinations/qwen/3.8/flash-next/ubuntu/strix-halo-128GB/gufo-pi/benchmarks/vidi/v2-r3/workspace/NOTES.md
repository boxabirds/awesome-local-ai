# Story 12 Implementation Notes — Drop images onto the board

## Architecture decisions

### Asset storage
- R2 bucket binding `ASSETS_BUCKET` added to `wrangler.jsonc`.
- Asset keys are `boardId/assetId` (both 22-char base64url). The GET route validates the board actually exists (returns 404 for orphaned assets) by calling `env.BOARD_ROOM.get(...)!.exists()` via DO stub with a 3s timeout.
- Upload size limit enforced **before** reading the full body (`content-length` check) and again after reading the actual body.
- Magic bytes sniffed on the raw bytes (first 4100 bytes) using `sniffImageFormat()` from `src/shared/image-format.ts`.

### Image model in CRDT
- The `image` object type stores: `assetKey`, `contentType`, `naturalWidth`, `naturalHeight`, `status`, `uploadStartedAt`, `uploaderId`.
- `assetKey`, `naturalWidth`, `naturalHeight` are **write-once** (guarded by `has()` check).
- `status` uses a version counter (`uploadVersion`) so a late callback from a superseded attempt can never clobber a newer status.
- Upload writes use `UPLOAD_ORIGIN` (not tracked by UndoManager); delete and resize use `LOCAL_ORIGIN` (undoable).
- On reload, `status: 'uploading'` with stale `uploadStartedAt` (> 2 min) renders as "didn't finish" placeholder.

### Client-side upload flow
- Files validated client-side (extension, MIME, size).
- In-browser decode via `createImageBitmap()` for intrinsic dimensions before upload.
- Placement: capped at `IMAGE_MAX_PLACE_SIZE_WORLD` (640 world units max side).
- Multiple files laid out in a row (tops aligned, gap = `IMAGE_LAYOUT_GAP_WORLD`).
- Uploads proceed sequentially (first file appears first).
- XHR-based upload with `upload.onprogress` for progress bar.
- Retry: re-reads `File` from `Map<imageId, File>` (in-memory, lost on reload → Retry hidden, Remove shown).
- Failed images are never auto-retried.

### Drop and paste handling
- Drag: document-level `dragover`/`dragleave`/`drop` handlers. Drop highlight shown via overlay.
- Paste: document-level `paste` handler. Skipped if target is a text entry field.
- Image button in Toolbar opens a hidden file input.
- `I` keyboard shortcut opens the file picker.

### Resize
- Aspect ratio locked at 1:1 with `naturalWidth/naturalHeight`.
- Corner handles resize proportionally.
- The existing transform gesture infrastructure handles move + resize; a constraint is applied in `layoutRow` / `applyTransform`.

### Caching and headers
- Served assets use `Cache-Control: public, max-age=31536000, immutable`.
- `X-Content-Type-Options: nosniff` to prevent MIME confusion.
- `Content-Security-Policy: default-src 'none'; img-src 'self'; sandbox` to contain SVG/marker content.

### Offline behaviour
- Board connection state checked before initiating any upload.
- If not `connected`, toast "You're offline — images need a connection" is shown and no objects are created.

## File map (new/changed for this story)
- `src/shared/image-format.ts` — magic-byte format detection
- `src/shared/objects/image.ts` — image object model, CRDT reads/writes, layout
- `src/shared/board-model.ts` — `ImageSnap` added to `ObjectSnapshot` union
- `src/shared/config.ts` — image constants
- `src/worker/assets.ts` — upload + serve handlers
- `src/worker/index.ts` — routes for `/api/boards/:id/assets` and `/api/assets/:boardId/:assetId`
- `wrangler.jsonc` — `ASSETS_BUCKET` binding
- `src/client/images/validateFiles.ts` — client-side validation
- `src/client/images/uploadImage.ts` — XHR upload with progress
- `src/client/images/useImageInsert.ts` — React hook for drop/paste/picker/retry
- `src/client/images/DropHighlight.tsx` — blue overlay during drag
- `src/client/ui/Toast.tsx` — toast notification component
- `src/client/objects/ImageObject.tsx` — renders image in all states
- `src/client/objects/registry.tsx` — `image` type registered
- `src/client/App.tsx` — integration (drag/paste handlers, toolbar button, toast container)
- `src/client/board/Toolbar.tsx` — image button added
- `tests/unit/image-format.test.ts` — TC-32
- `tests/unit/validate-files.test.ts` — TC-14, TC-15, TC-20, TC-30
- `tests/unit/image-model.test.ts` — TC-08, TC-09, TC-11, TC-31, TC-33
- `tests/integration/assets.test.ts` — TC-10, TC-11, TC-12, TC-13, TC-16
- `tests/component/useImageInsert.test.tsx` — TC-17, TC-18, TC-19, TC-29
- `tests/component/ImageObject.test.tsx` — TC-21, TC-22, TC-23, TC-24
- `tests/e2e/images.spec.ts` — TC-25, TC-26, TC-27, TC-28
- `tests/fixtures/images/` — test fixtures
