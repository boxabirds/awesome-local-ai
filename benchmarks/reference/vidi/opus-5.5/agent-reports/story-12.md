# Story 12: final report from the Opus 5.5 subagent

Verbatim, apart from local paths replaced.

Story 12 (drop images onto the board) is built and committed as `story 12: Drop images onto the board`. Build, typecheck, unit, component and integration all pass. The last full e2e run had one failure, in a story 9 text test that passed when re-run on its own.

## What I built
- **Server:** an R2 bucket for images and a per-visitor upload limiter (60 per minute), added in `wrangler.jsonc`. `src/worker/assets.ts` handles `POST /api/boards/:id/assets`. It checks in the design's order: board id format, rate limit, board exists, size by `Content-Length` and by actual length, then file type from the first bytes (the client's header is ignored). It answers 404, 413, 415, 429 or 500 and stores nothing on any error. `GET /api/assets/:boardId/:assetId` serves images with immutable caching, `nosniff` and `Content-Security-Policy: default-src 'none'`. `src/shared/image-format.ts` holds the type sniffing and the asset key format.
- **Image model:** `src/shared/objects/image.ts` covers placement size, row layout and placeholder creation. Adding images is one undo step. Finishing an upload is written with a separate origin that undo ignores, so it never becomes its own undo step. "Unfinished" is worked out at display time from when the upload started.
- **Adding images:** drop (with a dashed highlight), paste (ignored while text is being edited), and a file picker from the "Image (I)" button or the I key. Files are checked for type, size and count first, uploads show progress, and failed uploads can be retried. The refusal messages use the exact PRD wording in a bottom toast that screen readers announce politely. Adding is refused while the board isn't connected.
- **ImageObject:** covers every state: uploading (the uploader sees a percentage, others see "Uploading…"), ready, "Upload failed" with Retry/Remove, "Image unavailable", and "Image upload didn't finish" with Remove. It is registered with proportional resizing and a 16-unit minimum.
- **Tests:** everything the design lists. Unit TC-01–09, integration TC-10–16, component TC-17–24 and TC-29, and e2e TC-25–28 in `tests/e2e/images.spec.ts`. The fixtures are generated images plus 10 MB boundary files created in the tests.

## Final results
| Script | Result |
|---|---|
| `npm run build` | pass |
| `npm run typecheck` | pass |
| `npm run test:unit` | 22 files, 243 passed |
| `npm run test:component` | 23 files, 242 passed |
| `npm run test:integration` | 6 files, 70 passed |
| `npm run test:e2e` (Chromium + Firefox, `E2E_PORT=8877`) | 111 passed, 1 failed, 3 skipped |

- **The e2e failure** was story 9's text TC-26 timing out waiting for an element to appear on the shared server; `text.spec.ts` alone passed 14/14. The 3 skips are Chromium-only skips from earlier stories. All 8 image e2e tests pass in both browsers.
- **Earlier e2e runs had problems caused by other projects on the build machine:**
  - Another project's server held port 8791, which persistence TC-19 always uses, so that test failed. It passed on a spare port (a local edit I reverted) and in the final run.
  - In one run the shared test server was stopped from outside mid-run, failing 33 tests with `fetch failed`.
  - One run had pen TC-20 fail; it passed 8/8 on its own.

## Left undone
- WebKit e2e: WebKit can't launch on the build machine, so TC-26 ran only in Chromium and Firefox.
- The design lists as not covered: performance with 100 images, production R2/CDN caching, and pasting images in e2e (paste is tested at component level only).

## Decisions noted in `NOTES.md`
- **Undo and redo:** the design left open whether redo restores an uploaded image, and it does (tested). If an upload finishes while its placeholder is undone, the result is applied when redo brings it back.
- **Status updates** apply only to the right state (ready/failed only while uploading, retry only from failed), and malformed asset keys are refused.
- **Serving:** anything stored with a type other than an accepted image type returns 404.
- **Routing:** the new asset routes are matched before story 5's board check; other HTTP methods get 405.
- **Blocked path test:** `/api/assets/../x` is collapsed to `/api/x` before the Worker sees it, so TC-16 checks that key directly against the handler and the encoded form over HTTP.
- **Rate limiting:** the integration tests use the real local rate limiter. A unit test checks `wrangler.jsonc` matches the settings; the helper it uses moved to `tests/unit/helpers/jsonc.ts`.
- **Hook interface:** `useImageInsert` takes and returns a few more fields than the contract (for example viewport, the picker input and the toast).
- **"Offline"** means the board isn't synced yet, which includes "Connecting…" at startup.
- **Toast:** several refusals from one action appear together in one toast, one line each, for 5 seconds.
- **Component split:** `ImageObject` matches the contract; the registry uses a thin wrapper that gets identity, progress and the clock from context. The clock ticks every 30 s only while an image is uploading. Large clock differences between machines shift when "unfinished" appears.
- **Names:** "Image (I)" sits after "Sticky note"; pressing I also switches the tool to Select.
- **Earlier tests changed by this story:** story 8's TC-18 toolbar list now includes "Image (I)", and story 10's `useActiveTool` test now also checks `comment`.
- **Fixtures** were generated with Pillow; the 4032×3024 JPEG is synthetic, not a real photo. Integration tests use embedded copies because they run without a file system.
- **E2E:** TC-25 holds uploads so the colleague's placeholders can be seen. TC-27 shrinks with the top-left handle because the bottom-right one ends up under the zoom controls.
- **Test-first order was only partly followed.** I checked with mutations instead: marking uploads complete as a normal undoable change, and removing the paste guard, both made tests fail; both were reverted.
