# Story 12: Drop images onto the board

## Decisions

1. **Pluggable asset store (`src/worker/asset-store.ts`)** — the worker resolves its storage via `getAssetStore(env)`: the real R2 bucket when `env.ASSETS_BUCKET` is bound (production, `wrangler.jsonc`), otherwise a process-wide in-memory store (tests). The miniflare R2 bucket in this environment is sqlite-backed and its persistent `-shm`/`-wal` sidecar files are incompatible with the pinned test pool (`@cloudflare/vitest-pool-workers` 0.7.0, miniflare 3.20250214.0): with `isolatedStorage: true` the pool's `popStackedStorage` asserts every persist file ends in `.sqlite` and fails on the sidecars; with `isolatedStorage: false` the per-file DO storage directory name (which embeds the absolute test file path) exceeds the 255-char filename limit in this workspace. No pool version is both R2-clean and compatible with the project's vitest 2.x (0.13.0+ requires vitest 4.x). The in-memory fallback keeps the full handler logic — board existence, size/sniff checks, unguessable keys, immutable serving headers — under test via real `SELF.fetch` round-trips.

2. **`sniffImageType` uses magic bytes only** (PNG, JPEG, GIF, WebP) and never the file name or client `Content-Type`, so a renamed PDF or an SVG is refused at the API boundary.

3. **Asset keys are unguessable** — `<boardId>/<assetId>` where `assetId` is a fresh 128-bit board id (`assetKeyFor`), matching story 5's id scheme. The serve route validates the key against `ASSET_KEY_PATTERN` before any storage access.

4. **Serving is locked down** — `Content-Type` from stored metadata, `Cache-Control: public, max-age=…, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` so a stored asset can never be interpreted as script.

5. **R2 failure simulation** — the upload handler throws (→ `500 storage_failure`) when `env.TEST_HOOKS === '1'` and the request carries `x-test-fail-r2: 1`.

6. **`UPLOAD_ORIGIN` is a distinct `unique symbol`** in `src/shared/objects/image.ts`, separate from `LOCAL_ORIGIN`; the `Y.UndoManager` only tracks `LOCAL_ORIGIN`, so upload-status transitions (uploading → ready/failed) never create undo steps.

## Test coverage

- **Unit tests**: `tests/unit/image-format.test.ts` (TC-01, TC-02, TC-08, TC-09), `tests/unit/image-model.test.ts` (TC-03–TC-07), `tests/unit/validate-files.test.ts`
- **Integration tests**: `tests/integration/assets.test.ts` (TC-10–TC-13, TC-15, TC-16)
- **Component + e2e tests**: (see tasks.md)

## Files changed

### New files
- `src/shared/image-format.ts` — `sniffImageType`, `assetKeyFor`, `ASSET_KEY_PATTERN`
- `src/shared/objects/image.ts` — image object model + status lifecycle
- `src/client/images/validateFiles.ts` — client-side file validation
- `src/worker/asset-store.ts` — `AssetStore` interface + in-memory fallback + `getAssetStore`
- `tests/integration/assets.test.ts`

### Modified files
- `src/shared/config.ts` — image constants (max bytes, sniff bytes, cache max-age)
- `src/worker/assets.ts` — `handleUpload` / `handleServe`
- `src/worker/index.ts` — asset routes + `ASSETS_BUCKET` in `Env`
- `src/worker/types.d.ts` — `R2Bucket` / `R2Object` / `R2HTTPMetadata` / `R2PutOptions`
- `wrangler.jsonc` — `r2_buckets` binding
- `vitest.workspace.ts` — test bindings (no `r2Buckets`; in-memory store used)

---

# Story 10: Draw shapes and connect them with arrows that follow when moved

## Decisions

1. **Extended existing `useTool` hook** rather than creating a new `src/client/tools/useActiveTool.ts`. The design doc said "added if absent, else extended" — the hook already existed at `src/client/board/useTool.ts` and was extended with `shape` and `connector` tool types, their keyboard shortcuts (S, L), and a `toolCreated` callback.

2. **Connector hit-testing uses `distanceToPolyline`** from a new shared geometry module (`src/shared/geometry/polyline.ts`). The connector's stored endpoints (resolved via `resolveEndpoints`) are used as the polyline points. The hit tolerance is `CONNECTOR_HIT_TOLERANCE_PX / zoom` in world units, making the 6px screen-space tolerance zoom-independent.

3. **Shape and connector tools use native DOM event listeners** (via `useEffect` + `addEventListener`) rather than React synthetic events. This is necessary for `setPointerCapture` to work correctly during drag operations, ensuring the tool receives all pointer events even when the pointer leaves the overlay element.

4. **Connector endpoints store a `fallback` position** (the anchor point at creation time). When the attached object is deleted, the connector's endpoint is converted to a `free` endpoint at the fallback position. This prevents connectors from breaking when their target is removed.

5. **Shape labels use the same `TextEditor` pattern** as sticky notes — a contenteditable div overlaid on the shape when in edit mode. The label is stored as a single string (max 500 chars) and rendered as centered text within the shape bounds.

6. **The `useBoardDoc` snapshot cache key** was extended to include shape-specific fields (kind, fill, stroke, label) and connector endpoint kinds, ensuring the cached snapshot is invalidated when these fields change.

7. **Shape toolbar appears when a shape is selected** — it shows fill and stroke color swatches. The selected shape's current colors are highlighted. Clicking a swatch calls `setShapeStyle` which writes to the Yjs doc in a single transaction.

8. **Connector re-attach handles** appear only when the connector is selected. Dragging a handle onto a shape re-attaches that endpoint; dragging onto empty space detaches it to a free endpoint. The `setConnectorEndpoint` model function validates that the new target isn't the opposite endpoint's object.

## Test coverage

- **Unit tests** (15 new): `tests/unit/shape-model.test.ts` (TC-01–TC-06), `tests/unit/connector-model.test.ts` (TC-07–TC-14, TC-29)
- **Component tests** (11 new): `tests/component/ShapeTool.test.tsx` (TC-15–TC-22, TC-28)
- **E2E tests** (5 new): `tests/e2e/shapes.spec.ts` (TC-23–TC-27)

## Files changed

### New files
- `src/shared/objects/shape.ts` — Shape model (create, style, label)
- `src/shared/objects/connector.ts` — Connector model (create, re-attach, detach)
- `src/shared/geometry/connector-geometry.ts` — Anchor/side/endpoint resolution
- `src/shared/geometry/polyline.ts` — Point-to-polyline distance
- `src/client/objects/ShapeObject.tsx` — Shape SVG rendering + label editing
- `src/client/objects/ShapeToolbar.tsx` — Fill/stroke color picker
- `src/client/objects/ConnectorObject.tsx` — Connector line + arrowhead + handles
- `src/client/tools/ShapeTool.tsx` — Drag-to-create shape overlay
- `src/client/tools/ConnectorTool.tsx` — Hover dots + drag-to-connect overlay
- `tests/unit/shape-model.test.ts`
- `tests/unit/connector-model.test.ts`
- `tests/component/ShapeTool.test.tsx`
- `tests/e2e/shapes.spec.ts`

### Modified files
- `src/shared/config.ts` — Shape/connector constants
- `src/shared/board-model.ts` — ShapeSnap/ConnectorSnap in AnySnapshot, deleteObjects detaches connectors
- `src/client/board/useTool.ts` — Added shape/connector tools
- `src/client/board/Toolbar.tsx` — Shape button + kind menu, Connector button
- `src/client/board/useBoardDoc.ts` — Extended snapshot cache key
- `src/client/objects/registry.tsx` — Registered shape and connector types
- `src/client/pages/BoardUI.tsx` — Integrated ShapeTool, ConnectorTool, ShapeToolbar
- `tests/unit/board-model.test.ts` — Updated TC-12 to use truly unknown type
- `tests/unit/registry.test.ts` — Updated TC-12 (shape is now registered)
