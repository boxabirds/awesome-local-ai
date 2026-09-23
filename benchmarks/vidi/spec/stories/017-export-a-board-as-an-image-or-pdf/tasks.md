# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write export planning unit tests first (TC-01 to TC-09) | proposed | test:unit | export.plan |
| 2 | Implement export planning: area bounds, raster clamping, filename, PDF page size | proposed | implementation | export.plan |
| 3 | Write export asset and font loading unit tests first (TC-10 to TC-13) | proposed | test:unit | export.assets |
| 4 | Implement export asset loading with concurrency, timeout, abort and font readiness | proposed | implementation | export.assets |
| 5 | Write export drawing unit tests first with a recording 2D context (TC-14 to TC-18) | proposed | test:unit | export.draw |
| 6 | Implement export drawing: registry exportDraw for all six item types, z-order loop, text wrapping | proposed | implementation | export.draw |
| 7 | Write export pipeline unit tests first: success, PDF, failures, cancel, notices (TC-19 to TC-23) | proposed | test:unit | export.pipeline |
| 8 | Implement export pipeline: snapshot, stages, PNG and PDF encoding, download, cancellation | proposed | implementation | export.pipeline |
| 9 | Implement Export dialog and top-bar Export button | proposed | implementation | export.dialog |
| 10 | Component tests for Export dialog states (TC-24 to TC-30) | proposed | test:ui-component | export.dialog |
| 11 | E2E export workflows: faithful PNG, view/selection, PDF, missing images, offline, huge board, no side effects (TC-31 to TC-37) | proposed | test:e2e | export.plan, export.assets, export.draw, export.pipeline, export.dialog |
| 12 | Nightly e2e: export performance at tested board size (TC-38) | proposed | test:e2e | export.pipeline |

## Details

### 1. Write export planning unit tests first (TC-01 to TC-09)

## Goal
Test-first coverage of export.plan (`computeBounds`, `planRaster`, `exportFilename`, `pdfPageSize`). Add all EXPORT_* named settings to `config.ts`; stub `plan.ts` exports throwing "not implemented"; add `tests/fixtures/export-boards.ts` (retro board, far-apart board, extreme board).

## Cases
- TC-01 whole: 3 items at mixed positions → union + EXPORT_MARGIN_WORLD on each side.
- TC-02 view: camera zoom 0.5, viewport 1280x800, item crossing the edge → exact viewport world rect, crossing item included.
- TC-03 selection: 2 of 4 selected → union of selected + margin; itemIds only selected.
- TC-04 empty board, view with no intersecting items, empty selection → `empty` (negative).
- TC-05 planRaster scale 1 vs 2 → 2x dims exactly double (ceil).
- TC-06 width EXPORT_MAX_SIDE_PX + 1 and area EXPORT_MAX_AREA_PX + 1 → fit < 1, limits respected, reducedPercent = floor(fit*100) (boundary).
- TC-07 effective scale exactly EXPORT_MIN_SCALE → ok; just below → `too_large` (boundary).
- TC-08 exportFilename 'Q3/planning: v2', '' and undefined with fake local date 2026-09-17 → sanitised name, EXPORT_FILENAME_FALLBACK, correct .png/.pdf.
- TC-09 pdfPageSize 1000x500 px → 750x375 pt; 40000x100 px → longest side EXPORT_PDF_MAX_PAGE_PT, ratio preserved.

## Done when
Suite compiles and fails with "not implemented"; committed.

### 2. Implement export planning: area bounds, raster clamping, filename, PDF page size

## Goal
Implement export.plan per contract so TC-01..TC-09 pass.

## Approach
- `computeBounds(items, area)`: whole → all items (connector bbox derived); selection → only `area.ids`; both add EXPORT_MARGIN_WORLD. View → `screenToWorld` of viewport corners (story 1 camera) exactly, including intersecting items, no margin. No items or non-finite rect → `{kind:'empty'}`.
- `planRaster(rect, scale)`: `w=ceil(width*scale)`, `h=ceil(height*scale)`; `fit=min(1, MAX_SIDE/w, MAX_SIDE/h, sqrt(MAX_AREA/(w*h)))`; `effective=scale*fit`; below EXPORT_MIN_SCALE → `too_large`; else dims from effective scale and `reducedPercent = fit<1 ? floor(fit*100) : null`.
- `exportFilename`: replace `/\:*?"<>|` with '-', trim, fallback EXPORT_FILENAME_FALLBACK, append local `YYYY-MM-DD` and extension.
- `pdfPageSize`: px × EXPORT_PDF_POINTS_PER_PX; if longest side > EXPORT_PDF_MAX_PAGE_PT scale both down proportionally.
- Pure, no DOM; the dialog uses `planRaster` for its size hint.

## Done when
All planning unit tests pass.

### 3. Write export asset and font loading unit tests first (TC-10 to TC-13)

## Goal
Deterministic tests of export.assets (`loadAssets`, `ensureFonts`) with injected `AssetDeps` (deferred fake fetch, fake decode, fake FontFaceSet, fake timers).

## Cases
- TC-10 10 image keys with deferred responses → never more than EXPORT_IMAGE_CONCURRENCY fetches in flight; 10 bitmaps returned (boundary).
- TC-11 one 404, one network error, one never-responding: at EXPORT_IMAGE_TIMEOUT_MS − 1 still pending; at EXPORT_IMAGE_TIMEOUT_MS aborted → `missing` has 3 keys, no throw (error paths).
- TC-12 abort job signal while 4 requests pending → every per-request signal aborted; `loadAssets` rejects with AbortError.
- TC-13 `ensureFonts` for 2 families × 3 sizes → `fonts.load` called for each spec; one rejection → still resolves (fallback logged).

## Done when
Suite compiles against stubs and fails with "not implemented"; committed.

### 4. Implement export asset loading with concurrency, timeout, abort and font readiness

## Goal
Implement export.assets per contract.

## Approach
- `loadAssets(keys, signal, deps)`: de-duplicate keys; promise pool of EXPORT_IMAGE_CONCURRENCY; each request gets its own AbortController linked to the job signal and a EXPORT_IMAGE_TIMEOUT_MS timer; GET same-origin `/api/assets/:key` (story 12); non-2xx, network/offline error, decode failure or timeout → add to `missing`; job abort → abort all and throw AbortError.
- Default `decode` = `createImageBitmap(blob)`, falling back to `HTMLImageElement.decode()` when unavailable. Same-origin blobs keep the canvas untainted.
- `ensureFonts(specs, deps)`: `Promise.allSettled(specs.map(fonts.load))`, log rejections, never reject.
- Exposes `defaultAssetDeps()` for the pipeline.

## Done when
TC-10..TC-13 pass.

### 5. Write export drawing unit tests first with a recording 2D context (TC-14 to TC-18)

## Goal
Test-first coverage of export.draw (`drawExport`, per-type registry `exportDraw`, `wrapText`) using `tests/helpers/recording-context.ts`, a fake CanvasRenderingContext2D that records calls (fillRect, fillText, beginPath/ellipse/lineTo/stroke, drawImage, setTransform, measureText with a fixed-width font model).

## Cases
- TC-14 3 overlapping items z 1,3,2 plus an equal-z pair → first call fills EXPORT_BACKGROUND_COLOR over the full canvas; subsequent draws ordered by (z, id).
- TC-15 one item of each type (sticky, text, shape ellipse with label, connector between two shapes, stroke, image) → expected primitive sequence per type (sticky fill = STICKY_COLORS value and fitted text; text lines; ellipse path + stroke; connector path + arrowhead; polyline with round joins; drawImage into item rect).
- TC-16 `wrapText`: empty string → []; explicit newlines split; word longer than width hard-broken; text exactly fitting width → one line (boundary).
- TC-17 unknown type 'widget' skipped without throwing (negative); image whose key is in `missing` → placeholder rect EXPORT_PLACEHOLDER_FILL plus "Image unavailable" label.
- TC-18 doc containing comments and awareness data → only `objects` items drawn; no primitives for comments, grid, cursors or selection (negative).
Also: abort signal set before a yield after EXPORT_YIELD_EVERY_ITEMS items → throws AbortError.

## Done when
Suite compiles against stubs and fails with "not implemented"; committed.

### 6. Implement export drawing: registry exportDraw for all six item types, z-order loop, text wrapping

## Goal
Implement export.draw per contract, including the story 7 registry modification.

## Approach
- Registry entry contract gains `exportDraw(ctx, item, env)`; register the six per-type functions.
- `drawExport(ctx, items, rect, scale, env, signal, onProgress)`: fill EXPORT_BACKGROUND_COLOR; `setTransform(scale,0,0,scale,-rect.x*scale,-rect.y*scale)`; sort items by (z, id); for each call registry `exportDraw` (unknown type → skip + debug log); every EXPORT_YIELD_EVERY_ITEMS items await a macrotask, check `signal.aborted`, report progress.
- Per type: sticky (STICKY_COLORS fill, text fitted between STICKY_FONT_MIN_PX..STICKY_FONT_MAX_PX via `measureText` binary search, wrapText); text (Y.Text string, fontSize, wrap to width); shape (rect/ellipse/diamond path, fill, stroke, centred label); connector (endpoints from `src/shared/objects/connector.ts` resolving connected objects' side anchors via `env.resolveObject`, path + arrowhead); stroke (flattened points polyline, round lineJoin/lineCap, colour, thickness); image (`drawImage(bitmap, x, y, w, h)` or placeholder rect EXPORT_PLACEHOLDER_FILL + icon + "Image unavailable").
- `wrapText(measure, text, maxWidth)`: honour newlines, greedy word wrap, hard-break over-long words.
- Only `objects` items are inputs, so grid, cursors, selection outlines and comment markers cannot be drawn.

## Done when
TC-14..TC-18 pass.

### 7. Write export pipeline unit tests first: success, PDF, failures, cancel, notices (TC-19 to TC-23)

## Goal
Test-first coverage of export.pipeline `runExport(doc, job, deps, signal, onProgress)` with injected `PipelineDeps` (fake canvas factory, fake download spy, real `pdf-lib` loader, fake assets, fake clock) and a real Y.Doc. Add `pdf-lib` dependency.

## Cases
- TC-19 PNG whole, fake canvas blob → `{kind:'downloaded', filename}` from exportFilename; download called once; Y.Doc update events 0 (read-only).
- TC-20 PDF selection with real pdf-lib → downloaded bytes re-load with `PDFDocument.load` as 1 page whose size equals `pdfPageSize`.
- TC-21 failure branches: getContext null → `no-context`; toBlob yields null → `encode-failed`; pdf-lib `embedPng` throws → `pdf-failed`; `loadPdfLib` rejects → `pdf-failed`; download never called (negative).
- TC-22 abort during asset loading, after EXPORT_YIELD_EVERY_ITEMS items drawn, and after encoding before download → `cancelled`; download never called.
- TC-23 reduced plan plus one missing image → downloaded with `reducedPercent` and `missingImages: 1`.
Also: plan `empty` / `too_large` return before `createCanvas` is called.

## Done when
Suite compiles against stubs and fails with "not implemented"; committed.

### 8. Implement export pipeline: snapshot, stages, PNG and PDF encoding, download, cancellation

## Goal
Implement export.pipeline per contract and the job stage state diagram.

## Approach
- Snapshot `objects` from the doc at start (immutable; no transactions, no camera/selection changes; concurrent remote edits ignored).
- Planning: `computeBounds` → `empty`; `planRaster` → `too_large`; return before creating a canvas.
- LoadingAssets (20% progress): image keys in area → `loadAssets`; text font specs → `ensureFonts`.
- Drawing (70%): `createCanvas(widthPx, heightPx)`; `getContext('2d')` null → `failed no-context`; `drawExport` with effective scale.
- Encoding (10%): `toBlob('image/png')` null/throw → `encode-failed`. PDF: `loadPdfLib()` (dynamic import), `PDFDocument.create`, `embedPng`, `addPage([widthPt,heightPt])` from `pdfPageSize`, `drawImage` full page, `save()`; any throw → `pdf-failed`.
- Check `signal.aborted` between stages and before download → `cancelled`.
- Download: object URL + temporary anchor with `download = exportFilename(...)`, revoke after click. Return `reducedPercent` and `missingImages`.
- Offline-safe: only asset fetches use the network.

## Done when
TC-19..TC-23 pass.

### 9. Implement Export dialog and top-bar Export button

## Goal
Implement export.dialog per contract and the dialog state diagram (Closed, Options, Exporting).

## Approach
- BoardPage top bar: Export button next to Share opens `ExportDialog`.
- Options: `role=dialog aria-label="Export board"`; Format radios (PNG default, PDF); Area radios (Whole default, Current view, Selection disabled with hint "Select items first" when selection is empty); Resolution radios (EXPORT_DEFAULT_SCALE preselected, hidden for PDF); size hint "About W × H pixels" from `planRaster`; empty/too-large plan → exact PRD messages and Export disabled.
- Exporting: capture selection, camera and viewport at click; dynamic import `pipeline.ts`; `AbortController`; `progressbar` fed by onProgress; Cancel aborts; Escape ignored while exporting.
- Results: clean download → close; reducedPercent → "Reduced to N% to fit the maximum image size."; missingImages → "N images couldn't be included."; failed → "Export failed: your browser couldn't create a file this large. Try Current view or 1×." (stay open); cancelled → back to Options. Messages in `role=status`.
- Escape/Close in Options closes; focus trapped and returned to Export button.

## Done when
TC-24..TC-30 and TC-36 pass.

### 10. Component tests for Export dialog states (TC-24 to TC-30)

## Goal
jsdom tests of the export.dialog contract with an injected `run` (fake runExport) and real `plan.ts`.

## Cases
- TC-24 open with empty selection: PNG, Whole and 2× preselected; size hint text; Selection disabled with "Select items first"; switching to PDF hides Resolution.
- TC-25 plan empty → "Nothing to export — this area is empty."; Export disabled (negative).
- TC-26 plan too_large → too-large message; `run` never called (negative).
- TC-27 Exporting shows progressbar and Cancel; Cancel calls abort; result cancelled → Options.
- TC-28 results: downloaded clean → dialog closes; reducedPercent 63 → "Reduced to 63% to fit the maximum image size."; missingImages 2 → "2 images couldn't be included."; failed → failure text and dialog stays open.
- TC-29 selection changes after opening → job receives the selection at the moment Export is clicked.
- TC-30 Escape in Options closes; Escape while Exporting ignored.

## Done when
All pass in `npm run test:component`.

### 11. E2E export workflows: faithful PNG, view/selection, PDF, missing images, offline, huge board, no side effects (TC-31 to TC-37)

## Goal
Real-browser proof of the export pipeline end to end: planning (export.plan), asset loading (export.assets), canvas drawing (export.draw), encoding/download (export.pipeline) and the dialog (export.dialog), against `wrangler dev` with the retro, far-apart and extreme fixture boards. Helper `png.ts` decodes downloaded PNGs to read dimensions and sample pixels.

## Workflows
- TC-31 "Slide-ready PNG": Export → PNG, Whole, 2× → download event; PNG signature; dimensions equal `planRaster` output; centre pixel of a yellow sticky equals STICKY_COLORS.yellow ±2 per channel; a grid-dot location and a comment-marker location are white (excludes).
- TC-32 "Focused exports": Current view and Selection PNGs → dimensions match plan; region of an unselected item is white.
- TC-33 "PDF": Export PDF → file starts with `%PDF-`; pdf-lib parse shows 1 page; page aspect ratio equals PNG aspect ratio ±0.5%.
- TC-34 "Unreliable images": `page.route('**/api/assets/*', abort)` for one image → placeholder grey pixel at its centre; notice "1 images couldn't be included." wording per implementation pluralisation.
- TC-35 "Offline": `context.setOffline(true)` → export still downloads; uncached images drawn as placeholders.
- TC-36 "Huge board": far-apart board → download plus "Reduced to N%…" notice; extreme board → too-large message and no download event within 5 s.
- TC-37 "Nobody notices": second context connected to the same board records zero doc updates during export; exporter's camera zoom label and selection identical before and after.

## Done when
All pass in chromium; TC-31 and TC-33 also in firefox and webkit.

### 12. Nightly e2e: export performance at tested board size (TC-38)

## Goal
Nightly check of export.pipeline performance: `runExport` through the real dialog on a board of EXPORT_TESTED_ITEMS mixed items (stickies, text, shapes, connectors, strokes, images) exported as 2× PNG.

## Case
- TC-38: measure from Export click to download event; assert ≤ EXPORT_BUDGET_MS; log stage timings from onProgress (assets, drawing, encoding) and the effective scale/reducedPercent reported by the pipeline result; assert the downloaded PNG dimensions equal the plan.

## Done when
Runs in the nightly Playwright project (excluded from default e2e) and passes locally in chromium.

