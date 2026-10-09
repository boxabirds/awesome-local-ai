# Story 1 — Notes

Decisions and deviations made while implementing this story.

## E2E browsers: Chromium and Firefox (WebKit not runnable here)

The design asks for the e2e suite to run on Chromium, Firefox and WebKit, and
`playwright.config.ts` defines all three projects. In this environment only
Chromium and Firefox can actually launch:

- Playwright's WebKit (minibrowser) bundles almost all of its libraries, but it
  still needs the system `libavif.so.13`.
- This machine has no root access (`sudo` is disabled by no-new-privileges),
  and the egress proxy blocks the package mirrors (`archive.ubuntu.com`,
  `deb.debian.org`, `launchpad.net` all return 403), so the `.deb` cannot be
  fetched or installed.

Therefore:

- `npm run test:e2e` runs the two launchable browsers:
  `playwright test --project=chromium --project=firefox`.
- `npm run test:e2e:all` (`playwright test`) runs all three projects for
  fully provisioned environments (e.g. after `npx playwright install-deps`).

All e2e assertions are browser-agnostic (no Chromium-specific APIs), so the
WebKit project is expected to pass once its system dependency is available.

## Manual browser checks (task 3 "Done when")

The environment is headless, so the manual Chrome/Safari check was covered by
automation instead:

- Chrome-class behaviour: real-Chromium e2e (pointer drag, wheel pan,
  Ctrl-wheel zoom, keyboard shortcuts, page-zoom invariance, exact pixel
  movement).
- Safari pinch: Playwright cannot synthesise Safari gesture events; the
  `gesturestart`/`gesturechange` handler is covered by the TC-17 component
  test (jsdom) — also noted as "Not covered" for e2e in the design strategy.

## Test-build camera hook

- `window.__vidi6` is installed only when `import.meta.env.MODE === "test"`
  (`src/client/canvas/testHooks.ts`).
- `npm run build:e2e` builds with `--mode test` so the e2e web server
  (`wrangler dev` on port 29540) serves a build that includes the hook;
  `npm run build` (production mode) excludes it — verified by the build size
  diff and by `vite build` dead-code-eliminating the guarded branch.

## Ports (constraint: 29536–29551)

- `npm run dev` (Vite dev server): 29536.
- e2e web server (`wrangler dev --local`): 29540.
- No other long-running servers are started.

## Implementation notes

- **Camera state** lives in `useCamera` (React state + refs) and is coalesced
  through `requestAnimationFrame` (at most one render per frame). The
  `hasNavigated` latch flips only when a camera maths call returns a *new*
  object, so clicks without movement and no-op zooms at a limit do not
  dismiss the first-use hint (TC-29).
- **Initial view** centres the world origin on first non-zero viewport size;
  this does not count as navigation.
- **Zoom stepping** snaps to the nearest `ZOOM_STEP_FACTOR^n` within a named
  relative epsilon, which keeps label values on the 100→125→156→…→400
  sequence and lets the clamping step land exactly on `ZOOM_MAX`.
- **Wheel deltas**: `deltaMode` LINE/PAGE values are converted to pixels with
  named constants (16 px/line, 100 px/page). Ctrl/Meta wheel zooms by
  `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)` around the pointer; plain wheel pans.
  Every wheel event over the board is `preventDefault`-ed, so page zoom never
  changes (TC-15/16, TC-24, TC-31).
- **E2E determinism**: because camera updates land on the next animation
  frame, DOM pixel assertions first wait for the rendered state to settle
  (zoom label text, world-layer `transform`, or the camera hook) before
  measuring — this avoids rAF races without using sleeps.
- **TC-32 (disabled button)** uses `user-event` with real timers:
  `user-event` correctly ignores clicks on `disabled` buttons (unlike
  `fireEvent`), and fake timers would hang `user-event`.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (client bundle in `dist/client`).
- `npm run test:unit` — 14 passed (TC-01…TC-12 + property check).
- `npm run test:component` — 13 passed (TC-13…TC-22, TC-29, TC-30, TC-32).
- `npm run test:e2e` — 8 passed (4 cases × Chromium + Firefox).

---

# Story 2 — Notes

Decisions and deviations made while implementing this story.

## Stacking is painted (CSS z-index), not DOM order

The board model's `snapshot()` is sorted by `(z, id)`. If the client rendered
that order directly, `bringToFront` (called once at drag start) would re-sort
the array and React would *move the dragged note's DOM node* mid-drag. Moving
a node releases the active implicit pointer capture, the browser fires
`lostpointercapture`, and the drag dies after the first frame (reproduced
with document-level event logging: capture lost exactly when the node was
re-ordered).

So the client renders notes in a **stable** order (createdAt, then id) and
expresses stacking with CSS `z-index: note.z` on each note. `bringToFront`
then only updates a style value — no DOM movement, capture survives. The
model contract (z-sorted snapshot) is unchanged; unit tests still assert it.
The e2e TC-32 stacking assertion compares computed `z-index` (plus the model
`z` values) instead of DOM order.

Note: all notes share the transformed world layer, which is its own stacking
context, so per-note z-indexes never fight the fixed toolbars/zoom controls.

## Test hooks gained board access

`window.__vidi6` (test builds only) now also exposes:

- `getBoardDoc()` — the live `Y.Doc` (for simulating remote writes).
- `getBoardSnapshot()` — `snapshot(doc)` world positions for assertions.

## Drag mechanics (component-level decisions)

- Screen-space movement threshold `DRAG_THRESHOLD_PX` (3 px) before a drag
  starts; a press under the threshold is a plain select.
- Position writes are coalesced with `requestAnimationFrame` (one
  `moveObject` per frame, last position wins); `pointerup` flushes the
  pending write so the note lands exactly under the pointer.
- `pointercancel`/`lostpointercapture` keep the last *applied* position (the
  queued frame is discarded, not applied) — TC-21.
- `bringToFront` fires exactly once, when the drag starts (not per move).

## Text editing

- The editor is an uncontrolled `<textarea>`; on every `input` the delta
  between the previous and new value is applied to the note's `Y.Text` as one
  transact (common prefix/suffix scan → single delete+insert pair), keeping
  the diff minimal (TC-24).
- Length limit: value is clamped to `STICKY_TEXT_MAX_CHARS` on the client;
  the counter shows `n/1000` only in the last 50 characters (TC-38).
- Font auto-fit: binary search on the measured `scrollHeight` between
  `STICKY_FONT_MIN_PX` and `STICKY_FONT_MAX_PX`; overflow sets a bottom fade.
  IME: composition events do not commit (the diff only runs on `input` outside
  composition).

## jsdom quirks in component tests

- jsdom has zero-sized layout: the harness sets an explicit 1280×800 viewport
  and notes are positioned with world→screen math, exactly as in the app.
- `fireEvent` pointer sequences need explicit `clientX/clientY` on *every*
  event (missing coords default to 0,0 and read as a huge move, e.g. an
  "empty click" that is actually a 100 px pan).
- Drag tests use fake timers (rAF coalescing); editor tests use real timers
  with `user-event` (fake timers would hang it, as in story 1 TC-32).

## E2E geometry notes

- At 200% zoom the overlap of two adjacent notes puts the lower note's edge
  exactly on the higher note's centre; the TC-32 grab point is deliberately
  100 px left of the note centre, outside the overlap, so the mousedown lands
  on the intended note.
- Drag assertions poll the bounding box (≤1 px) because position writes land
  on the next animation frame; world assertions read `getBoardSnapshot()`.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (client bundle in `dist/client`).
- `npm run test:unit` — 29 passed (story 1: 14; story 2 board model: 15).
- `npm run test:component` — 31 passed (story 1: 13; story 2: 18).
- `npm run test:e2e` — 16 passed (8 cases × Chromium + Firefox; WebKit
  excluded as in story 1).
