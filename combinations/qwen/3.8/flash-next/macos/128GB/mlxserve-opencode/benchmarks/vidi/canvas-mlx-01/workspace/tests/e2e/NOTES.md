# End-to-end notes — story 1

What was run, what could not be automated, and what is asserted instead.

## Environment

| | |
|---|---|
| Machine | macOS 26.4, Apple Silicon (`arm64`) |
| Node / npm | v24.19.0 / 11.17.0 |
| Vite / Vitest / TypeScript | 7.3.6 / 3.2.7 / 5.9.3 |
| Playwright | 1.63.0 |
| Browser builds | Chromium 153.0.8010.12 (`chromium-1243`), Firefox 155.0 (`firefox-1543`), WebKit 26.6 (`webkit-2359`) |

All three browser projects are installed and all three run: **none of them is
skipped**. `npx playwright install chromium firefox webkit` was needed before the
first run; the browsers live in `$PLAYWRIGHT_BROWSERS_PATH`
(`~/.cache/vidi-agent-ms-playwright` here). `playwright.config.ts` runs
the suite against `wrangler dev`, which serves `dist/client` built with
`npm run build:test`.

## Exact commands

```bash
npm ci
npx playwright install chromium firefox webkit

npm run build          # production client build (must not contain window.__vidi6)
npm run build:test     # test build (contains the camera test hook)
npm run typecheck
npm run test:unit      # TC-01..TC-12 + property check
npm run test:component # TC-13..TC-22, TC-29..TC-32
npm run test:e2e       # chromium + firefox + webkit: TC-23..TC-28, TC-31, TC-17

# one project / one case at a time, while debugging
npx playwright test --project=webkit
npx playwright test --project=chromium -g "TC-26"

# the server the suite talks to, on its own
npm run build:test && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port 8790
```

Last full run of every required script, in this order, on the machine above:

```
npm run build           exit 0   and `grep -c __vidi6 dist/client/assets/*.js` -> 0
npm run typecheck       exit 0
npm run test:unit       exit 0   65 passed
npm run test:component  exit 0   62 passed
npm run test:e2e        exit 0   41 passed  (chromium 13, firefox 13, webkit 15)
```

## Two configuration decisions that were forced by the environment

1. **Firefox needs its own process sandbox switched off.** Inside this sandboxed
   test environment Firefox aborts with
   `Sandbox error: sandbox_init() failed with error "Operation not permitted"` and
   every case in the project fails before the page loads. `playwright.config.ts`
   therefore defaults `MOZ_DISABLE_CONTENT_SANDBOX`, `MOZ_DISABLE_GPU_SANDBOX` and
   `MOZ_DISABLE_SOCKET_PROCESS_SANDBOX` to `1` (an explicit value in the
   environment wins). This relaxes the *browser process* sandbox only: the page,
   the origin and every assertion are unaffected.
2. **The viewport is set per project.** The `devices[...]` presets are spread into
   `use`, and each of them carries `viewport: 1280x720`, which would silently
   override the 1280x800 laptop viewport the story is written against — and the
   camera position is viewport-relative, so every "known view" assertion would be
   off by 80 CSS pixels. The viewport is restated after each spread.

## What cannot be automated, and what is asserted instead

| Real interaction | Problem | What the suite asserts instead |
|---|---|---|
| Two-finger trackpad pinch (Safari) | Playwright has no pinch input primitive, and `gesturestart/change/end` are WebKit-only. | `pinch.webkit.spec.ts` dispatches that exact event family (cumulative `scale`, one animation frame between steps) in the WebKit project and asserts the board zoomed by the cumulative scale, the world point under the fingers is unmoved, and the painted marker is still under it within 1 px. Chromium and Firefox `testIgnore` this file. A physical trackpad check on a Mac remains the manual confirmation. |
| macOS `Cmd` + wheel | On macOS the pinch gesture is delivered as `gesture*` events, not `Ctrl`+wheel; a Linux CI never receives `Meta`+wheel either. | The wheel path is covered with `ctrlKey` in Chromium/Firefox/WebKit, and `metaKey` is treated identically (component test TC-16 "treats Cmd (macOS pinch) like Ctrl"). |
| "The browser page zoom must not change" | Browser page zoom is a *browser UI* action. A synthetic `ctrl+wheel` dispatched through CDP does not zoom Chromium headless, so a green `visualViewport.scale === 1` proves the default was prevented, not that a real pinch was intercepted. | Every zoom case additionally asserts `defaultPrevented` at the DOM level (component tests TC-15/TC-16/TC-17, e2e `startPrevented/changePrevented/endPrevented` for the gesture family), plus `window.visualViewport.scale` **and** `window.devicePixelRatio` unchanged before/after (TC-31). |
| `window.visualViewport.scale` as a page-zoom proxy | It reports the *visual viewport* pinch scale. On desktop Chrome/Firefox page zoom scales the layout instead, leaving `scale` at 1 and changing `devicePixelRatio`; in WebKit headless neither moves because no real user zoom happens. So `scale` alone is not a usable signal. | Both signals are asserted unchanged, and the measured value is recorded in the failure output rather than assumed. `devicePixelRatio` is 2 on this machine (Retina) and the assertion is a comparison against the same browser's value at load, never against a literal. |
| "A dot grid dot moved by exactly (200, 100)" | CSS `background-image` dots are not DOM nodes, so an individual dot has no box to measure. | TC-23/TC-27 measure the painted origin marker (a DOM node welded to world 0,0, which is exactly a lattice point) for the 1 px movement, and assert the lattice itself: computed `background-size` equals `GRID_SPACING_WORLD * zoom` px, and computed `background-position` advanced by the drag delta modulo the tile period in both axes. That is the dot grid moving rigidly with the camera, measured rather than inferred. |
| "The camera jumped a million pixels away" | Dragging a million pixels is not practical. | `window.__vidi6.setCamera()` (compiled into the test build only; `npm run build` output does not contain it) places the camera at ±1,000,000 world units, and `setCamera()` in the helper waits until the DOM transform *and* the camera attributes agree before the case measures anything (TC-26, TC-27). |
| Retina / headless sub-pixel painting | `boundingBox()` is accurate to ~0.1 CSS px but the compositor's rounding is not observable. | Movement assertions use exact values with an explicit ±1 CSS px tolerance constant (`PX`), and camera maths assertions use exact numbers from the test hook, never screenshots. |

## Findings worth keeping

* **WebKit bug found and fixed by this suite.** WebKit can deliver `pointerup` in
  the same animation frame as the final `pointermove`. The board coalesced pointer
  moves per frame and dropped the pending frame on release, so a drag in WebKit
  landed one step short of the pointer and the hint was never dismissed
  (`TC-23`, `TC-27`, `TC-28` failed only in the WebKit project). `stopPan` now
  applies the last seen pointer position before giving up the frame. Component test
  "lands the last pointer position when the pointer is released within the same
  frame" pins that behaviour, so the fix is covered even where the timing is not
  reproducible.
* **`wrangler dev` refuses an `assets.binding` in an assets-only Worker**
  ("Cannot use assets with a binding in an assets-only Worker"). The design requires
  both the `ASSETS` binding and `env.BACKEND`, so `src/worker/index.ts` exists as the
  entry point; it only hands out the built client (and 404s a missing `/assets/*`
  instead of hiding it behind the SPA fallback).
* **Wrangler 4.141 warns** `Unexpected fields found in kv_namespaces[0]:
  "bucket_name","preview_bucket_name"`. They are kept because the design names the
  bucket `vidi6-backend` explicitly, and `env.BACKEND` is bound and reported by
  `wrangler dev` (`env.BACKEND ... KV Namespace ... local`). Rename to the current
  schema field if a later story wants a warning-free dev log.
* **jsdom drops coordinates from synthetic pointer events** (it has no
  `PointerEvent`), which silently turned the camera into `NaN` in the component
  tests. `tests/component/harness.tsx` dispatches a `MouseEvent` typed as
  `pointer*` with `pointerId`/`pointerType` defined on it, so the handlers see real
  client coordinates.
* **React flushes updates from native listeners outside `act`.** The component
  helpers await one macrotask (`flush()`) or an animation frame plus a flush
  (`flushFrames()`) after each interaction, and use `waitFor`-style polling
  (`expectSettled`) where an update must have settled.
* **A Playwright `click()` on a disabled button waits for it to become enabled
  again**, i.e. forever at a zoom limit. Negative cases use `forceClick()`, which
  dispatches the click directly, and then assert the camera did not move.

---

# End-to-end notes — story 2 (sticky notes)

Story 2 adds `tests/e2e/sticky-notes.spec.ts` (TC-30 double-click-create, TC-31 move
at 50%, TC-32 move-at-200%-and-raise, TC-33 long-text fit and clip, TC-34 create while
panned far away, plus a create→type→move→recolour→delete golden path). Per-browser
counts in the block above fold these six into each project. Model state is read live
out of the running client's `Y.Doc` through a new `window.__vidi6.getDoc()` test hook
(`getSelection()` is exposed too), so TC-31/TC-32 assert exact world `x,y` and `z`
numbers rather than inferring them from pixels.

## What cannot be automated, and what is asserted instead

| Real interaction | Problem | What the suite asserts instead |
|---|---|---|
| Font auto-fit across a real typeface | jsdom lays text out at a nominal single line, so `fitFontSize` cannot be trusted there. | The pure text helpers are unit-tested (`TC-13` diff, `TC-14`..`TC-16` clamp, `TC-17` counter in `sticky-text.test.ts`); the *real* font-fit result is asserted once in the browser (TC-33: computed `font-size` is `STICKY_FONT_MAX_PX` for one word, `STICKY_FONT_MIN_PX` for 1,000 chars, and the overflow fade class is present). |
| "The grabbed point stays under the pointer" through a drag | Sub-pixel compositor rounding is not observable in headless. | TC-31 asserts the exact world delta (`screen delta / zoom`) from the model **and** that the painted note box translated by exactly the screen delta within 1 CSS px, which is the grab-under-pointer property measured on the node. |
| Raising a note above an overlapped one | Stacking order is a paint property. | TC-32 reads `z` from the model after the drag and asserts the dragged note's `z` now exceeds the note it overlapped; the CSS `z-index` that paints it is set straight from `z`. |
| A physical two-finger drag of a note | Same pinch/trackpad limitation as story 1. | Notes are moved with a synthetic `mouse.down`/`move`/`up` drag; the drag state machine itself is covered in the component project (TC-18..TC-22) where `pointercancel` is dispatched directly. |

## Findings worth keeping

* **Re-ordering the DOM under a captured pointer cancels the drag (found and fixed by
  this suite).** Notes were painted sorted by `z`; `bringToFront` (fired on the first
  move past `DRAG_THRESHOLD_PX`) re-sorted the list, React re-inserted the note's
  element to reorder it, and Chromium fired `lostpointercapture` on the just-moved
  node — which the note read as a real cancellation, so grabbing a note that sat
  *under* another and dragging it up moved it a single step and stopped (`TC-32` failed
  at `dx 5` instead of `50`, only when a second overlapping note existed). The fix keeps
  the render order stable (creation order, `createdAt` then `id`) and paints stacking
  with CSS `z-index` set from `z`, so raising a note only restyles the same node and
  never re-inserts it. The drag now lands the full delta in all three browsers.
* **`insertText` is the cross-browser way to drive a big paste.** TC-33 pastes
  `PARAGRAPH_1000` with `keyboard.insertText`, which fires the same `input` event a real
  paste does; the editor clamps it to `STICKY_TEXT_MAX_CHARS` through `clampToLimit`.

