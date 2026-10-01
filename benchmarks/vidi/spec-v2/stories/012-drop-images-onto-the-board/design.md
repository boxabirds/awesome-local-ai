# Technical Design

Images are stored in R2 via Worker routes POST /api/boards/:id/assets (board must exist, magic-byte type sniffing, 10 MB limit, unguessable keys) and GET /api/assets/:boardId/:assetId (immutable caching, nosniff). The client validates files, measures dimensions, creates an image placeholder object in the Y.Doc (one undo step), uploads with XHR progress, then sets ready/failed status with an untracked origin. ImageObject renders uploading, ready, failed, unfinished and unavailable states and registers an aspect-locked resize.

## Overview

## Context
Builds on story 3 (`src/worker/index.ts`, `connectBoard` ConnectionState), story 4 (Durable Object storage), story 5 (`BoardRoom.exists()` RPC, `newBoardId()`, `api.ts`), story 10 (`useActiveTool`), and conventions for story 7 (registry, generic move/resize/delete, aspect-locked resize) and story 8 (LOCAL_ORIGIN tracked by `Y.UndoManager`). Story 17 will read images from the same GET route to embed them.

## Files
| Path | Change | Purpose |
|---|---|---|
| `wrangler.jsonc` | modified | `r2_buckets: [{ binding: ASSETS_BUCKET, bucket_name: vidi6-assets }]` |
| `src/worker/assets.ts` | added | upload and serve handlers |
| `src/worker/index.ts` | modified | route `POST /api/boards/:id/assets`, `GET /api/assets/:boardId/:assetId` |
| `src/shared/image-format.ts` | added | `sniffImageType` magic bytes, `ASSET_KEY_PATTERN`, `assetKeyFor` |
| `src/shared/objects/image.ts` | added | image schema, `createImagePlaceholders`, `markImageReady`, `markImageFailed`, `placementSize`, `layoutRow`, `displayStatus` |
| `src/shared/config.ts` | modified | settings below |
| `src/client/images/validateFiles.ts` | added | client-side type/size/count validation and messages |
| `src/client/images/uploadImage.ts` | added | XHR upload with progress, response mapping |
| `src/client/images/useImageInsert.ts` | added | drop, paste and picker flows, in-memory retry map |
| `src/client/images/DropHighlight.tsx` | added | drag-over outline |
| `src/client/objects/ImageObject.tsx` | added | render states, Retry/Remove |
| `src/client/objects/registry.tsx` | modified | register `image` |
| `src/client/tools/useActiveTool.ts`, `src/client/board/Toolbar.tsx` | modified | Image button and I shortcut open picker then return to Select |
| `src/client/ui/Toast.tsx` | added | bottom toast with `role=status` |

## Named settings added
```ts
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_FILES_PER_ADD = 20;
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
export const IMAGE_MIN_SIZE_WORLD = 16;
export const IMAGE_LAYOUT_GAP_WORLD = 24;
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
export const IMAGE_SNIFF_BYTES = 12;
```

## HTTP contract
| Method + path | Success | Errors |
|---|---|---|
| `POST /api/boards/:boardId/assets` (raw body, `Content-Type` ignored for decisions) | `201 {"assetKey": "<boardId>/<assetId>", "contentType": "image/png"}` | `404` board unknown/malformed; `413` body > IMAGE_MAX_BYTES; `415` sniffed type not accepted; `500` storage failure |
| `GET /api/assets/:boardId/:assetId` | `200` bytes, `Content-Type` from stored metadata, `Cache-Control: public, max-age=ASSET_CACHE_MAX_AGE_SECONDS, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` | `404` malformed key or missing object |

Asset ids use story 5's `newBoardId()` (128 bits), so keys are unguessable. Decision: bodies are read fully into memory (≤ 10 MB) so type sniffing happens before anything is written; the size check uses `Content-Length` first and the actual byte length second.

## Schema addition (additive)
```
image: common fields + assetKey: string | null, contentType: string,
       naturalWidth: number, naturalHeight: number,
       status: 'uploading' | 'ready' | 'failed', uploadStartedAt: number, uploaderId: string
```
Decision on undo: placeholder creation is a LOCAL_ORIGIN transaction (the undo step). `markImageReady`/`markImageFailed` use `UPLOAD_ORIGIN`, which is not in the UndoManager's tracked origins, so upload completion never becomes its own undo step.

## Structure diagram
```mermaid
flowchart TD
    subgraph Browser
        Insert[useImageInsert drop paste picker] --> Validate[validateFiles]
        Insert --> Model[objects image.ts]
        Insert --> Upload[uploadImage XHR]
        Insert --> Toast[Toast]
        Model --> Doc[Y.Doc objects]
        Doc --> Registry[objects registry]
        Registry --> ImgC[ImageObject]
        Conn[connectBoard state] --> Insert
    end
    subgraph Worker
        Routes[index.ts] --> Assets[assets.ts]
        Assets --> Sniff[image-format sniff]
        Assets --> Room[BoardRoom exists RPC]
        Assets --> R2[ASSETS_BUCKET R2]
    end
    Upload -->|POST assets| Routes
    ImgC -->|GET assets| Routes
```

## State diagram
Image object status (persisted in the doc; `unfinished` is derived at render time):
```mermaid
stateDiagram-v2
    [*] --> Uploading : placeholder created
    Uploading --> Ready : upload 201 markImageReady
    Uploading --> Failed : upload error markImageFailed
    Uploading --> Unfinished : now minus uploadStartedAt exceeds IMAGE_UPLOAD_STALE_MS
    Failed --> Uploading : uploader Retry
    Ready --> Unavailable : image load error render only
    Unavailable --> Ready : later load succeeds
    Uploading --> [*] : deleted or undone
    Failed --> [*] : Remove
    Unfinished --> [*] : Remove
    Ready --> [*] : deleted
```

## Sequence: add images by drop
```mermaid
sequenceDiagram
    participant U as User
    participant I as useImageInsert
    participant V as validateFiles
    participant M as image.ts
    participant X as uploadImage
    participant W as Worker assets
    U->>I: drop files at point
    alt connection not connected
        I-->>U: offline toast nothing added
    else connected
        I->>V: validate type size count
        V-->>I: accepted files and messages
        alt no accepted files
            I-->>U: toast messages
        else some accepted
            I->>I: createImageBitmap for natural size
            alt decode fails
                I-->>U: types toast for that file
            end
            I->>M: createImagePlaceholders layoutRow at drop point
            M-->>I: ids one LOCAL_ORIGIN transaction
            loop each accepted file
                I->>X: upload with progress
                X->>W: POST api boards id assets
                alt 201
                    W-->>X: assetKey
                    I->>M: markImageReady UPLOAD_ORIGIN
                else 413 415 404 500 or network error
                    I->>M: markImageFailed UPLOAD_ORIGIN
                end
            end
        end
    end
```

## Sequence: add images with the Image tool picker
```mermaid
sequenceDiagram
    participant U as User
    participant T as Toolbar or I key
    participant I as useImageInsert
    participant V as validateFiles
    participant M as image.ts
    participant X as uploadImage
    participant W as Worker assets
    U->>T: click Image or press I
    alt connection not connected
        T->>I: openPicker
        I-->>U: offline toast picker not opened
    else connected
        T->>I: openPicker
        I->>U: system file picker filtered to IMAGE_ACCEPTED_TYPES
        alt picker cancelled
            U-->>I: no files
            I->>T: tool returns to Select nothing added
        else files chosen
            I->>V: validate type size count
            alt no accepted files
                I-->>U: toast messages nothing added
            else some accepted
                I->>I: createImageBitmap for natural size
                alt decode fails
                    I-->>U: types toast for that file
                end
                I->>M: createImagePlaceholders layoutRow centred in view
                loop each accepted file
                    I->>X: upload with progress
                    X->>W: POST api boards id assets
                    alt 201
                        I->>M: markImageReady
                    else 413 415 404 500 or network error
                        I->>M: markImageFailed
                    end
                end
            end
            I->>T: tool returns to Select
        end
    end
```

## Sequence: upload handler
```mermaid
sequenceDiagram
    participant C as Client
    participant W as assets.ts
    participant R as BoardRoom
    participant B as R2
    C->>W: POST api boards boardId assets
    alt boardId malformed
        W-->>C: 404
    else
        W->>R: exists RPC
        alt board unknown
            W-->>C: 404
        else Content-Length or body over IMAGE_MAX_BYTES
            W-->>C: 413
        else
            W->>W: sniffImageType first IMAGE_SNIFF_BYTES
            alt not accepted type
                W-->>C: 415
            else accepted
                W->>B: put boardId slash newBoardId with contentType
                alt put throws
                    W-->>C: 500
                else stored
                    W-->>C: 201 assetKey
                end
            end
        end
    end
```

## Sequence: serve image
```mermaid
sequenceDiagram
    participant C as ImageObject img
    participant W as assets.ts
    participant B as R2
    C->>W: GET api assets boardId assetId
    alt key fails ASSET_KEY_PATTERN
        W-->>C: 404
        C->>C: Image unavailable
    else
        W->>B: get key
        alt missing
            W-->>C: 404
            C->>C: Image unavailable
        else found
            W-->>C: 200 immutable nosniff
        end
    end
```

## Sequence: retry and remove
```mermaid
sequenceDiagram
    participant U as Uploader
    participant O as ImageObject
    participant I as useImageInsert
    participant M as image.ts
    alt Retry
        U->>O: click Retry
        O->>I: retry id
        alt file still in memory
            I->>M: status uploading new uploadStartedAt
            I->>I: upload again
        else page was reloaded
            O-->>U: only Remove offered
        end
    else Remove
        U->>O: click Remove
        O->>M: deleteObjects id story 7
    end
```

## Sequence: paste
```mermaid
sequenceDiagram
    participant U as User
    participant I as useImageInsert
    U->>I: paste event
    alt focus in text editor or input
        I-->>U: default paste text unchanged
    else clipboard has no image files
        I-->>U: ignored
    else connection not connected
        I-->>U: offline toast nothing added
    else image files
        I->>I: same validation and upload as drop centred in view
    end
```

## Test Strategy

## Test scopes and boundaries
| Capability | Levels | Boundary exercised | Why sufficient |
|---|---|---|---|
| assets.api | unit, integration, e2e | pure sniff/key logic; real Worker request handling with real R2 (Miniflare) and real BoardRoom RPC; real browser upload | status codes, headers and stored objects are request-handling and storage facts |
| image.model | unit | pure placement/layout/status on a real Y.Doc | sizing, layout and status transitions are deterministic |
| image.insert | unit, ui-component, e2e | pure validation; hook with mocked upload in jsdom; real drop/paste/picker in browser | validation rules are pure; flows need DOM events; real file transfer needs a browser |
| image.object | ui-component, e2e | render states in jsdom; real image loading | states are DOM; load errors and aspect resize need real layout |

Timing policy: e2e tests wait up to E2E_EVENTUAL_TIMEOUT_MS (story 3) for images to appear for others and log the measured delivery time against LIVE_UPDATE_LATENCY_BUDGET_MS; the budget is reported, not asserted, because the model, browsers and server share one machine. IMAGE_UPLOAD_STALE_MS is exercised with fake clocks only (TC-06, TC-22).

## Dimensions crossed
- **D1 Entry**: drop, paste, picker.
- **D2 File class**: valid small, valid at limit, over limit, wrong type by content (renamed), SVG, corrupt image.
- **D3 Service outcome**: 201, 404, 413, 415, 500, network error, offline before start.
- **D4 Viewer**: uploader, other participant, later visitor.
- **D5 Time**: before and after IMAGE_UPLOAD_STALE_MS.

D2 and D3 classes are exhaustive and non-overlapping. TC numbers are stable; removed cases leave gaps.

## Coverage table
| TC | Capability | D1 | D2 | D3 | D4 | Action | Expected before → after | Level |
|---|---|---|---|---|---|---|---|---|
| TC-01 | assets.api | not applicable: pure function | valid small, SVG, corrupt, renamed PDF | not applicable: no request | not applicable | sniffImageType on PNG, JPEG, GIF87a, GIF89a, WebP, SVG text, PDF renamed .png, 3 random bytes | png, jpeg, gif, gif, webp, null, null, null | unit |
| TC-02 | assets.api | not applicable: pure function | not applicable | not applicable | not applicable | ASSET_KEY_PATTERN on valid, missing part, '../', 23-char id | true, false, false, false | unit |
| TC-03 | image.model | not applicable: pure function | valid small | not applicable | uploader | placementSize 400x300, 1600x1200, 300x3200, 800x800 | 400x300, 800x600, 75x800, 800x800 | unit |
| TC-04 | image.model | drop | valid small | not applicable | uploader | layoutRow 3 sizes at point | x positions separated by IMAGE_LAYOUT_GAP_WORLD, tops aligned at point | unit |
| TC-05 | image.model | drop | valid small | 201 | uploader | createImagePlaceholders 3 then markImageReady one | 3 objects status uploading in one update; one becomes ready with assetKey; UndoManager stack length 1 | unit |
| TC-06 | image.model | drop | valid small | 500 | other participant | displayStatus uploading at IMAGE_UPLOAD_STALE_MS - 1 and + 1; failed; ready | uploading, unfinished, failed, ready | unit |
| TC-07 | image.model | drop | valid small | not applicable | uploader | markImageReady on deleted id | false, no update | unit |
| TC-08 | image.insert | drop | valid at limit, over limit | not applicable: pre-upload | uploader | validateFiles sizes IMAGE_MAX_BYTES and IMAGE_MAX_BYTES + 1 | accepted; rejected with size message | unit |
| TC-09 | image.insert | picker | valid small | not applicable: pre-upload | uploader | validateFiles 21 valid files; mix of PDF and PNG | first 20 accepted + count message; PNG accepted + type message | unit |
| TC-10 | assets.api | not applicable: direct request | valid small | 201 | uploader | POST real PNG to existing board | 201; R2 object exists with contentType image/png; key matches pattern | integration |
| TC-11 | assets.api | not applicable: direct request | valid small | 404 | uploader | POST to never-created board id; malformed id | 404; nothing in R2 | integration |
| TC-12 | assets.api | not applicable: direct request | over limit | 413 | uploader | POST IMAGE_MAX_BYTES + 1 bytes; exactly IMAGE_MAX_BYTES valid JPEG | 413 nothing stored; 201 | integration |
| TC-13 | assets.api | not applicable: direct request | wrong type by content and SVG | 415 | uploader | POST PDF with Content-Type image/png; POST SVG | 415 both; nothing stored | integration |
| TC-15 | assets.api | not applicable: direct request | valid small | 500 | uploader | R2 put wrapped to throw | 500 | integration |
| TC-16 | assets.api | not applicable: direct request | valid small | 201 | later visitor | GET stored key; GET missing key; GET '../x' | 200 with Content-Type, immutable Cache-Control, nosniff, CSP; 404; 404 | integration |
| TC-17 | image.insert | drop | valid small | 201 | uploader | drop 3 files with mocked uploadImage emitting progress | 3 placeholders in a row; progress text updates; ready after resolve | ui-component |
| TC-18 | image.insert | paste | valid small | not applicable | uploader | paste image while editing sticky text; paste while board focused | no image created; image created centred in view | ui-component |
| TC-19 | image.insert | drop | valid small | offline before start | uploader | ConnectionState reconnecting then drop | offline toast; no objects; upload not called | ui-component |
| TC-21 | image.object | not applicable: render | valid small | 500 | uploader and other participant | render failed object as uploader and as other identity | Retry and Remove vs Image unavailable | ui-component |
| TC-22 | image.object | not applicable: render | valid small | not applicable | other participant | uploading with uploadStartedAt older than IMAGE_UPLOAD_STALE_MS | Image upload didn't finish + Remove; Remove deletes | ui-component |
| TC-23 | image.object | not applicable: render | corrupt | not applicable | later visitor | img error event | Image unavailable box same size | ui-component |
| TC-24 | image.object | not applicable: render | valid small | 500 | uploader | Retry after failure with file in memory; Retry after simulated reload | status uploading and upload called again; Retry hidden only Remove | ui-component |
| TC-25 | image.insert | drop | valid small x3 | 201 | uploader and other participant | real drag-and-drop via DataTransfer of fixture images; Sam's context | Sam sees Uploading placeholders then all three images (drop-to-visible time logged against LIVE_UPDATE_LATENCY_BUDGET_MS, not asserted) | e2e |
| TC-26 | image.insert | picker | valid small + renamed PDF + 11 MB | mixed | uploader | press I, setInputFiles | one image added; type and size toasts | e2e |
| TC-27 | image.object | picker | valid small | 201 | later visitor | resize corner; reload in new context | aspect ratio preserved ±1%, min IMAGE_MIN_SIZE_WORLD enforced; image present after reload | e2e |
| TC-28 | image.object | drop | valid small | network error | uploader | route abort POST assets, then Retry with route restored | Upload failed then image ready | e2e |

## Boundary values
- Size: IMAGE_MAX_BYTES and + 1 (TC-08, TC-12).
- Count: IMAGE_MAX_FILES_PER_ADD and + 1 (TC-09).
- Placement: longest side below, at and above IMAGE_MAX_PLACE_SIZE_WORLD, portrait and landscape (TC-03).
- Stale timeout: IMAGE_UPLOAD_STALE_MS ± 1 ms (TC-06).
- Minimum size on resize (TC-27).

## Negative scenarios
| TC | Must not happen | Level |
|---|---|---|
| TC-11 | uploads to non-existent boards must not be stored | integration |
| TC-13 | disguised or SVG files must not be stored or served | integration |
| TC-16 | served assets must not be sniffed or executed as documents | integration |
| TC-18 | pasting while editing text must not add an image | ui-component |
| TC-19 | offline adds must not create placeholders | ui-component |
| TC-05 | upload completion must not create a separate undo step | unit |

## Error paths
| Contract error | TC |
|---|---|
| 404 board unknown / malformed | TC-11 |
| 413 too large | TC-12, TC-08 |
| 415 wrong type | TC-13, TC-01, TC-26 |
| 500 storage failure | TC-15 |
| network error | TC-28 |
| image decode failure on client | TC-29: createImageBitmap rejects for corrupt file → type toast, no placeholder (ui-component) |
| GET missing / malformed | TC-16, TC-23 |
| stale id on status update | TC-07 |

## Mock vs real boundaries
| Dependency | Mocked? | Reason |
|---|---|---|
| R2 bucket | real Miniflare R2 in integration; local R2 in e2e | storage is part of the contract |
| BoardRoom exists RPC | real | existence rule from story 5 |
| R2 put failure | wrapped bucket throwing (TC-15) | cannot force real failure |
| uploadImage in ui-component tests | mocked with controllable progress | flows under test, not network |
| createImageBitmap in jsdom | stubbed returning fixture dimensions | jsdom lacks image decoding |
| Y.Doc and UndoManager | real | undo step behaviour is asserted |

## E2E workflows
1. **Moodboard with a colleague** (TC-25): drop three screenshots, colleague sees placeholders then images.
2. **Mixed picker batch** (TC-26): refused files explained, valid file added.
3. **Resize and revisit** (TC-27): proportional resize persists after reload.
4. **Flaky upload** (TC-28): failure then retry succeeds.

## Fixtures
- `tests/fixtures/images/`: real PNG screenshot (1440x900), JPEG photo (4032x3024, ~3 MB), animated GIF, WebP, SVG with script tag, PDF renamed to .png, corrupt PNG (truncated), generated 10 MB JPEG and 10 MB + 1 byte file.

## Not covered
- Real R2 production latency and CDN caching behaviour.
- Clipboard image paste in Firefox/WebKit e2e (Chromium only).
- Redo restoring the final `ready` state after undoing an insertion is asserted in TC-05's unit test only; UndoManager behaviour with untracked-origin updates must be confirmed during implementation.
- Wall-clock delivery time as a pass/fail criterion: on a shared machine it is logged (TC-25), not asserted.

## Asset upload and serving API

> Anchor: `assets.api`

## Contract
```ts
// src/shared/image-format.ts
export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];
export function sniffImageType(head: Uint8Array): AcceptedImageType | null;   // PNG 89504E47, JPEG FFD8FF, GIF87a/GIF89a, WebP RIFF....WEBP
export const ASSET_KEY_PATTERN: RegExp;                                       // ^[A-Za-z0-9_-]{22}/[A-Za-z0-9_-]{22}$
export function assetKeyFor(boardId: string, assetId: string): string;
// src/worker/assets.ts
export function handleUpload(req: Request, env: Env, boardId: string): Promise<Response>;
export function handleServe(env: Env, key: string): Promise<Response>;
```
- **Inputs**: raw request body; board id; asset key.
- **Outputs**: per the HTTP contract table in the Overview; R2 object with `httpMetadata.contentType` = sniffed type.
- **Errors**: 404 unknown/malformed board or key; 413 over IMAGE_MAX_BYTES; 415 unsupported sniffed type (including SVG and disguised files); 500 R2 failure.
- **Side effects**: one R2 put per accepted upload; nothing written on any error.

## Implementation
- **Only supported image types (image.types):** a file is added only if it is a PNG, JPEG, GIF or WebP image judged by its content. The browser rejects other files before uploading (`validateFiles`, image.insert) and shows "Only PNG, JPEG, GIF and WebP images can be added."; supported files from the same drop, paste or pick are still added. The server then decides the type from the first IMAGE_SNIFF_BYTES of the body only (magic bytes), never from the file name or `Content-Type`, so a renamed PDF or an SVG is refused with 415 and nothing is stored or added; the client shows the same message.
- **Size limit (image.size_limit):** files larger than 10 MB (IMAGE_MAX_BYTES) are rejected in the browser before uploading with "Images must be 10 MB or smaller." and nothing is added for that file. The server re-checks `Content-Length` and then the actual byte length and answers 413 without storing anything, so an oversized file can never be uploaded or added.
- Order of checks: id pattern → `exists()` RPC → `Content-Length` > limit → read body → byte length > limit → sniff → put.
- Serving adds `nosniff` and `Content-Security-Policy: default-src 'none'` so a stored file can never execute; immutable caching because keys never change. A 201 returns the permanent `assetKey` used by image.model and image.object to show the image to everyone.

## Tests
unit: TC-01, TC-02 in `tests/unit/image-format.test.ts`; TC-08, TC-09 (client validation). integration: TC-10 to TC-13, TC-15, TC-16 in `tests/integration/assets.test.ts`. e2e: TC-25, TC-26, TC-28.

## Image object model

> Anchor: `image.model`

## Contract
```ts
// src/shared/objects/image.ts
export const UPLOAD_ORIGIN: unique symbol;   // not tracked by the UndoManager
export type ImageStatus = 'uploading' | 'ready' | 'failed';
export type DisplayStatus = ImageStatus | 'unfinished';
export function placementSize(naturalWidth: number, naturalHeight: number): { width: number; height: number };
export function layoutRow(sizes: readonly Size[], start: Point, anchor: 'top-left' | 'centre'): Rect[];
export function createImagePlaceholders(doc: Y.Doc, items: readonly { rect: Rect; naturalWidth: number; naturalHeight: number; contentType: string }[], uploaderId: string, now: number): string[];
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean;
export function markImageFailed(doc: Y.Doc, id: string): boolean;
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean;
export function displayStatus(img: ImageSnap, now: number): DisplayStatus;
```
- **Errors**: stale id → false; non-finite sizes → placeholder skipped.
- **Side effects**: `createImagePlaceholders` = one LOCAL_ORIGIN transaction for the whole add action (one undo step); status updates use UPLOAD_ORIGIN (no extra undo step).

## Implementation
- **Sensible placement size (image.placement_size):** an added image is sized to its natural pixel dimensions in board units (one pixel = one board unit). If its longest side is more than 800 board units (IMAGE_MAX_PLACE_SIZE_WORLD), `placementSize` scales both sides down by the same factor so the longest side is exactly 800 and the proportions are kept; smaller images keep their natural size and are never enlarged. Examples: 400×300 → 400×300; 1600×1200 → 800×600; 300×3200 → 75×800.
- `layoutRow` places images left to right separated by IMAGE_LAYOUT_GAP_WORLD, from a `top-left` start (drop) or centred on the view (picker, paste).
- Placeholder objects carry `status: 'uploading'`, `uploadStartedAt`, `uploaderId`; `markImageReady` sets `assetKey`; `displayStatus` derives `unfinished` after IMAGE_UPLOAD_STALE_MS; `markImageFailed`/`markImageRetrying` support failure handling (rendering in image.object).

## Tests
unit: TC-03 (placement sizes) to TC-07 in `tests/unit/image-model.test.ts`.

## Adding images: drop, paste, picker, validation, upload

> Anchor: `image.insert`

## Contract
```ts
// src/client/images/validateFiles.ts
export type FileRejection = 'type' | 'size' | 'count';
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> };
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string>;
// src/client/images/uploadImage.ts
export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };
export function uploadImage(boardId: string, file: File, onProgress: (fraction: number) => void): { promise: Promise<UploadResult>; abort(): void };
// src/client/images/useImageInsert.ts
export function useImageInsert(a: { doc: Y.Doc; boardId: string; camera: Camera; connection: ConnectionState; identityId: string }): {
  onDragOver(e: DragEvent): void; onDrop(e: DragEvent): void; onPaste(e: ClipboardEvent): void; openPicker(): void;
  progress: ReadonlyMap<string, number>; retry(id: string): boolean; canRetry(id: string): boolean;
};
```
- **Inputs**: DataTransfer files on drop, clipboard files on paste, `<input type=file accept=IMAGE_ACCEPTED_TYPES multiple>` for the picker, connection state from story 3.
- **Outputs**: toasts with exact PRD messages; placeholders via image.model; progress map (uploader only); ready/failed status updates.
- **Errors**: invalid type, size, count, decode failure, offline, upload failures — all surfaced as messages or failed state; never thrown.
- **Side effects**: XHR uploads (fetch lacks upload progress); in-memory map id → File for Retry (lost on reload).

## Implementation
- **Drop (image.drop):** while files are dragged over the board a dashed drop highlight is shown (between `dragenter` and `dragleave`/`drop`, file drags only). On drop the drop point is converted to world coordinates and `layoutRow(sizes, dropPoint, 'top-left')` places the first image's top-left corner at that point and the rest left to right in a row, each separated by 24 board units (IMAGE_LAYOUT_GAP_WORLD).
- **Paste (image.paste):** a paste with image files while the board has focus and no text is being edited adds the images centred in the visible board area (`layoutRow(..., viewCentre, 'centre')`). If a note, text object, label or any input is being edited, the paste is left to the editor and no image is added.
- **Pick (image.pick):** the Image button or the I key opens the system file picker filtered to IMAGE_ACCEPTED_TYPES (PNG, JPEG, GIF, WebP) with multiple selection; chosen files are added centred in the visible board area in a row; the tool then returns to Select.
- **Count limit (image.count_limit):** if more than 20 supported files (IMAGE_MAX_FILES_PER_ADD) arrive in one drop, paste or pick, only the first 20 are added and the toast "Only 20 images can be added at once." is shown.
- **Uploading (image.uploading):** all placeholders are created in one transaction, each already the image's final size and position. The uploader's placeholder shows upload progress as a percentage from XHR `upload.onprogress`. Because the placeholder is a normal document object with `status: 'uploading'`, story 3 delivers it to every other connected person within 1 second of the upload starting, where it renders as an "Uploading…" placeholder of the same size and position (image.object).
- **Offline (image.offline):** if the connection is not `connected`/`confirmed`, no upload starts and nothing is added; the toast "You're offline — images can be added when you reconnect." is shown for drop, paste and picker alike.
- `validateFiles` also applies the type and size checks (image.types, image.size_limit) before any upload; dimensions come from `createImageBitmap` (decode failure → type message). Upload results: ok → `markImageReady`; failed → `markImageFailed`; Retry uses `markImageRetrying` and re-uploads the kept File.

## Tests
unit: TC-08, TC-09 in `tests/unit/validate-files.test.ts`. ui-component: TC-17 to TC-19, TC-29 in `tests/component/useImageInsert.test.tsx`. e2e: TC-25, TC-26, TC-28 in `tests/e2e/images.spec.ts`.

## Image object rendering and states

> Anchor: `image.object`

## Contract
```tsx
// src/client/objects/ImageObject.tsx
export function ImageObject(props: { image: ImageSnap; isUploader: boolean; progress?: number; canRetry: boolean; now: number; onRetry(): void; onRemove(): void }): JSX.Element;
// registry entry
image: { Component: ImageObject, resizable: true, aspectLocked: true, minSize: IMAGE_MIN_SIZE_WORLD, editableText: false, hitTest: bbox }
```
- **Inputs**: ImageSnap, identity (uploader or not), progress, clock tick (re-render every 30 s while any image is uploading so `unfinished` appears).
- **Outputs**: one rendering per `displayStatus` (below).
- **Errors**: image load error handled locally, never propagates.
- **Side effects**: Remove calls story 7 `deleteObjects`; Retry calls `useImageInsert.retry`.

## Implementation
- **Uploaded images appear for everyone (image.shared):** when the upload completes the uploader's client calls `markImageReady(id, assetKey)`; story 3 delivers that update to every connected person within 1 second, and each ImageObject replaces its placeholder with `<img src="/api/assets/<assetKey>" draggable=false decoding=async loading=lazy alt="Image">` sized to the object, so the image shows after 1 second plus its download time. The update is stored with the board (story 4), so anyone who opens the board later sees the image.
- **Failed uploads (image.upload_failure):** status `failed` renders, for the uploader, a red-bordered box "Upload failed" with Retry (while the file is still in memory) and Remove; everyone else sees "Image unavailable". Retry sets the placeholder back to uploading and uploads the same file again; Remove (available wherever the controls are shown) deletes the placeholder object.
- **Abandoned uploads (image.unfinished):** when an image has been `uploading` for more than 5 minutes (IMAGE_UPLOAD_STALE_MS, e.g. the uploader reloaded or closed the page) `displayStatus` returns `unfinished` and everyone sees "Image upload didn't finish" with a Remove button, instead of a permanent "Uploading…".
- **Proportional resizing (image.aspect_resize):** the registry entry declares `aspectLocked: true` and `minSize: IMAGE_MIN_SIZE_WORLD` (16), so story 7's resize always keeps the image's width-to-height ratio and stops before either side becomes smaller than 16 board units.
- **Unloadable images (image.unavailable):** if the image request fails (404, network error, corrupt data) the `img` error event swaps in a grey "Image unavailable" box with a broken-image icon at the image's size and position; the error is handled inside the component, so the rest of the board is unaffected.
- Uploading renders a grey box with progress % for the uploader and "Uploading…" for others.

## Tests
ui-component: TC-21 to TC-24 in `tests/component/ImageObject.test.tsx`. e2e: TC-25, TC-27, TC-28.

