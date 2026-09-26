# Story 1 notes — pan and zoom around an infinite board

Implementation of `spec/stories/001-pan-and-zoom-around-an-infinite-board`.

## How to run

```bash
npm run dev                      # Vite dev server
npm run build                    # production client bundle -> dist/client
npm run build:test               # test-mode bundle (adds window.__vidi6)
npm run typecheck
npm run test:unit                # camera maths + camera store (vitest, node)
npm run test:component           # React components (vitest, jsdom + user-event)
npm run test:e2e                 # Playwright; Playwright starts wrangler itself
npm run preview                  # wrangler dev on the current dist/client
```

`npm run test:e2e` builds the client in test mode, serves `dist/client` with
`wrangler dev` on `127.0.0.1:8787`, and runs the Chromium project. Playwright
stops the server when the run finishes.

## Camera model (read this before story 2)

`src/client/canvas/camera.ts` is the whole camera: `{ x, y, zoom }`.

* `x`, `y` are **the world coordinates that sit at the viewport's top-left
  corner**. The board start (world origin) is `(0, 0)`.
* Conversions, exact inverses:
  * `screen = (world - camera.xy) * zoom`
  * `world = camera.xy + screen / zoom`
* Example, viewport 1280x800, camera `{ x: 100, y: -50, zoom: 2 }`:
  world `(140, 30)` appears at screen `(80, 160)`; screen `(640, 400)`
  (viewport centre) is world `(420, 150)`.
* On load the camera is `{ x: 0, y: 0, zoom: 1 }`, i.e. the world origin sits at
  the top-left of the viewport. `Reset view` centres the origin instead:
  `{ x: -width/2, y: -height/2, zoom: 1 }`.
* Every camera-returning function is pure and returns the *same object* when it
  would not change anything. The store uses that identity to skip notifies, and
  it keeps the exact camera object so repeated zoom steps never drift.

The world layer is `<div data-testid="world-layer" style="transform:
scale(zoom) translate(-x, -y)">` with `transform-origin: 0 0`. It has **zero
size at the world origin** (`.board-world` is `width: 0; height: 0`), so it can
never cover the viewport and steal a pan. Story 2 appends content positioned by
world coordinates into it (`style.left/top = world`, `width/height` in world
units, overflowing the zero-size layer) and it appears at the right screen
position with no extra transform work. The viewport ignores a pointerdown whose
target is such a child, which is how board objects keep their own dragging.

## Input decisions

* **Pan**: pointerdown on the viewport (left button only) captures the pointer,
  each pointermove applies `-delta / zoom`, pointerup/pointercancel/
  lostpointercapture release. A pointerdown whose target is neither the viewport
  nor the world layer is ignored — that is the "empty space" rule that lets
  story 2/10 elements receive their own events.
* **Zoom**: wheel with Ctrl/Meta, Safari `gesturestart/change/end` (preventDefault
  so Safari does not page-zoom), the zoom buttons, and Ctrl/Cmd `+`/`-`/`0`
  (handled with `e.code`, `Digit`/`Numpad`, plus `shiftKey` for `=`).
* **Trackpad vs mouse wheel**: Chromium reports a two-finger scroll as
  `wheel` with `ctrlKey === false`; a pinch arrives as `wheel` with `ctrlKey ===
  true` (Safari: `gesture*` events). Anything without the modifier pans, so a
  mouse wheel scrolls the board.
* **Wheel distance**: `deltaMode === 1` (lines) -> 16px per line,
  `deltaMode === 2` (pages) -> one viewport, using the measured element size.
  `panBy(cam, dx, dy)` moves the camera by `-d/zoom`, i.e. it takes a **pointer
  movement** and the content follows it. So the drag path calls
  `panBy(dx, dy)` with the pointer delta, and the wheel path calls
  `panBy(-deltaX, -deltaY)` because a wheel delta is a scroll of the content, in
  the opposite direction (native scrolling behaviour).
* All listeners are registered in a `useEffect` on the viewport node: React
  attaches `wheel` passively, and zooming needs `preventDefault()`.
* CSS: `touch-action: none` on the viewport, `overscroll-behavior: none` and
  `overflow: hidden` on `html, body`, `user-select: none` on the viewport, so no
  gesture reaches page scroll or browser zoom (TC-31, PRD nav.nopagezoom).

## Grid

The dot grid is one CSS `background-image: radial-gradient(...)` on the viewport
element: `background-size: GRID_SPACING_WORLD * zoom`, and
`background-position: mod(-camera.x * zoom, spacing) mod(-camera.y * zoom, spacing)`.
`mod` keeps the offset in one tile (the background repeats), which avoids
multi-million pixel `background-position` values while panning far away and keeps
the dots perfectly regular at 1,000,000 units (TC-27). Because the offset comes
from the same camera the content uses, the grid can never desynchronise.

## State and rendering

The camera lives in `CameraStore` (`src/client/canvas/useCamera.ts`): a plain
external store (useSyncExternalStore) with React context, batching every update
into one `requestAnimationFrame` flush — the store notifies at most once per
frame (PRD perf.framerate, asserted in `tests/unit/cameraStore.test.ts`).
`hasNavigated` latches on the first snapshot whose camera object actually
changed, so a click without movement, or a zoom at a clamp limit, does not
dismiss the hint (TC-22, TC-29). `panning` is published so the cursor can show
`grab`/`grabbing` without local component state.

## Test-mode camera hook

`src/client/canvas/testHooks.ts` installs `window.__vidi6.setCamera(camera)` and
`getCamera()` **only when `import.meta.env.MODE === 'test'`**. Verified:
`npm run build` -> 0 occurrences of `__vidi6` in `dist/client`, `npm run build:test` ->
1 occurrence. e2e tests use `setCamera` for far-away start states (TC-26, TC-27);
production builds do not contain the hook (TC-02, design testing.md).

## Test coverage

| Tests | Where |
| --- | --- |
| TC-01..TC-12, TC-04b, TC-08b..d, TC-10b, TC-12b | `tests/unit/camera.test.ts` |
| TC-29 (no-op gestures do not latch), frame coalescing, dispose | `tests/unit/cameraStore.test.ts` |
| TC-13..TC-18, TC-29, TC-30, TC-19..TC-22, TC-32 | `tests/component/*.test.tsx` |
| TC-23..TC-28, TC-31 | `tests/e2e/navigation.spec.ts` |

`tests/e2e/helpers/board.ts` is the shared harness (`openBoard`, `dragBoard`,
`ctrlWheel`, `setCamera`, `markerCentre`, `expectMarkerAt`, `expectGrid`,
`metrics`). `tests/component/helpers.tsx` is its jsdom equivalent, including a
`ResizeObserver` stub (`tests/component/setup.ts`) that reports 1200x800 and can
be resized to exercise TC-07 in jsdom.

## Deviations from the spec files

1. **`wrangler.jsonc` has no `"binding": "ASSETS"`.** Wrangler 4.141 refuses to
   serve an assets-only Worker that declares an asset binding ("Cannot use assets
   with a binding in an assets-only Worker"). The binding comes back with
   story 3, together with `main`.
2. **Device projects are filtered to installed browsers.** The design's matrix is
   chromium/firefox/webkit at 1280x800; `playwright.config.ts` declares exactly
   those three, but skips a project whose browser is not installed. This
   environment has Chromium only (the brief also limits e2e to Chromium), so
   `npm run test:e2e` runs 10 Chromium tests and logs
   `skipping firefox, webkit (browser not installed)`. Install the rest with
   `npx playwright install --with-deps firefox webkit`; no config change needed.
3. **`src/worker/` is not created** — story 3 adds the collaborative Worker
   (`package.json` `deploy` still runs `wrangler deploy`).
4. **The percentage label is an `<output aria-live="polite">`** so screen readers
   announce zoom changes; its accessible text is the percentage, e.g. `125%`
   (`data-testid="zoom-percent"` for tests).
5. **Wheel panning is deliberately not clamped to whole tiles**, and `panBy` only
   clamps to `CAMERA_COORD_LIMIT` (PRD zoom.limits edge case: clamping is
   allowed).

## Not covered (as specified)

* TC-33: focus in the browser address bar — the page cannot receive those
  events, so there is no in-page test (design test table).
* Frame-rate smoothness: manual check only.
* Trackpad hardware differences (inertia, per-OS delta scaling): only synthetic
  wheel events are tested.
* Safari pinch in e2e: Playwright WebKit cannot synthesise `GestureEvent`;
  TC-17 covers the handler logic and real pinch is a manual check. I could not
  run Safari here (only Chromium is installed), so the pinch path is covered by
  TC-17 plus the reading of `event.scale` in `BoardViewport`.
* Touch input: out of scope for this story.

Manual check list for a machine with all browsers (run `npm run preview`):
Chrome and Safari — drag to pan, two-finger scroll, pinch, Ctrl/Cmd `+`/`-`/`0`;
confirm the page zoom indicator never changes and nothing scrolls the window.

## Notes for later stories

* Story 2 renders into `[data-testid="world-layer"]` (world coordinates, no extra
  transform needed) and must keep pointer events off the layer itself so the
  board keeps panning; content elements receive their own events because the
  viewport ignores pointerdowns that target children.
* Story 3 can read `useCamera()` for viewport-aware placement and reuse
  `screenToWorld`/`worldToScreen` for cursor broadcast and snapping.
* `UNBOUNDED_PAN_TESTED_EXTENT` (1,000,000) is the tested distance for
  "infinite"-enough; `CAMERA_COORD_LIMIT` is 1e9.
* e2e runs `wrangler dev`; if a run is interrupted, an orphan `workerd` may keep
  port 8787 — kill it by pattern (`pkill -f 'wrangler de[v]'`).

---

# Story 2 notes — capture ideas on sticky notes and rearrange them

Implementation of `spec/stories/002-capture-ideas-on-sticky-notes-and-rearrange-them`.

## Architecture

```
src/shared/board-model.ts     — pure Y.Doc mutations, snapshot helpers
src/client/objects/StickyNote.tsx   — interaction component (select, drag, edit)
src/client/objects/StickyText.ts    — clampToLimit, applyTextDiff, counterVisible, fitFontSize
src/client/objects/StickyTextEditor.tsx — IME-aware textarea
src/client/objects/NoteToolbar.tsx  — swatches and delete button
src/client/board/useBoardDoc.tsx    — Y.Doc provider and React hooks
src/client/board/useSelection.ts    — local selection/editing state
src/client/App.tsx                  — BoardApp, BoardContent, NoteToolbarOverlay
```

## Key implementation decisions

### Drag state machine
The note uses a ref-based state machine (`Unselected | Pressed | Selected | Dragging | Editing`)
to manage interaction without spurious re-renders. Critical fix: the external `useEffect`
that syncs `selected`/`editing` props must NOT override `Dragging` or `Pressed` states —
this was a bug where `bringToFront` triggered a Y.Doc update → snapshot change → re-render
→ effect set state back to `Selected`, breaking all subsequent pointer moves.

### Synchronous drag (no rAF)
`moveObject` is called synchronously on each pointermove. The design mentions "rAF-batched"
but tests fire pointer events faster than rAF can flush; synchronous application is
correct and the Y.Doc's transaction batching already coalesces updates within a microtask.

### Absolute position drag with zoomRef
Drag uses `startWorld + (pointer - pressOrigin) / zoom` (absolute delta from origin)
rather than incremental position updates. This avoids floating-point accumulation errors.
The `zoomRef` pattern avoids stale `zoom` values inside `useCallback` closures.

### Empty-click detection (BoardViewport)
Replaced `panning` state check with `didPanRef` (a ref tracking whether any `pointermove`
event fired during a viewport pan attempt). This correctly distinguishes "click on empty
space" from "pan gesture that started at the same position" since the `panning` state was
always true by the time `pointerup` fired (set synchronously by `beginPan`).

### Note toolbar in screen space
The toolbar is rendered OUTSIDE the world layer as a `position: fixed` overlay, positioned
by converting the note's world coordinates to screen via `worldToScreen(camera, ...)`.
This prevents the toolbar from being clipped by the note's `overflow: hidden` and keeps
it at constant screen size regardless of zoom level (matching the design spec:
"rendered in screen space above the selected note, not scaled by zoom").

### Font fitting
`fitFontSize(el, box)` in `StickyText.ts` performs binary search over font sizes
(`STICKY_FONT_MIN_PX..STICKY_FONT_MAX_PX`) checking `el.scrollHeight <= box`.
The `StickyNote` component calls this via `useLayoutEffect` whenever text changes.
In jsdom, `scrollHeight` is always 0, so the function always returns max font size
(harmless for component tests). In the real browser (e2e), it correctly shrinks font.

### Text overflow fade
When `fitFontSize` returns `overflow: true` (text still doesn't fit at min font),
the text element gets class `overflow-fade` which applies a CSS mask-image gradient.

## Test coverage

| Tests | Where |
| --- | --- |
| TC-01..TC-12 (board model) | `tests/unit/board-model.test.ts` |
| TC-13..TC-17 (sticky text) | `tests/unit/sticky-text.test.ts` |
| TC-18..TC-29 (components) | `tests/component/StickyNote.test.tsx`, `StickyTextEditor.test.tsx`, `Toolbars.test.tsx` |
| TC-30..TC-34 + workflow (e2e) | `tests/e2e/sticky-notes.spec.ts` |

## Deviations from the spec

1. **Camera store: rAF-coalesced but synchronous object mutations.** Story 1 uses
   rAF for camera updates; Story 2's note moves apply synchronously. This is fine because
   the design's rAF mention for drags was an optimization suggestion, not a requirement.

2. **`isDragging` is a React state** (not purely a ref) to trigger re-render for
   the `data-dragging` attribute, allowing the App to hide the toolbar during drag.

3. **`estimateFontSize` fallback removed** — font fitting uses only real DOM measurement.
   The initial render uses CSS `font-size: 24px` (max), then `useLayoutEffect` corrects it
   synchronously before the browser paints.

4. **`NoteToolbar` is rendered by `BoardContent`** (not inside the note component) to avoid
   `overflow: hidden` clipping and to render in screen space per the design spec.

## Not covered

* Presence cursors (Story 6): selection/editing state is local only, per design.
* Undo/redo (Story 9): no undo manager attached.
* Shape/connection components: hooks exist in board-model for Stories 4/5.
* Frame-rate profiling under 100 notes: manual perf check only.

# Story 3 notes — see other people's edits appear live on the same board

Implementation of `spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b`.
Two browsers on one URL now show each other's notes, text, colours and deletions
while both are editing.

## How to run (additions)

```bash
npm run test:integration      # Worker + BoardRoom in workerd (vitest-pool-workers)
npm run test:e2e              # Playwright, includes the 30 s outage case (TC-27)
npm run test:e2e:nightly      # TC-29 idle stability + TC-30 capacity soak (skipped by default)
NIGHTLY=1 NIGHTLY_IDLE_MINUTES=0.1 npx playwright test live-stability   # quick local check
```

`npm install` needs `--legacy-peer-deps` here: `y-websocket`'s peer range against
`yjs` trips npm 9's resolver (arborist bug), nothing is actually incompatible.
`vitest` is held at 4.1.x because `@cloudflare/vitest-pool-workers` needs the
`pool: 'workers'` implementation of that line, and `compatibility_date` stays at
`2026-08-15`, which the vendored workerd accepts.

## Architecture

```
src/shared/board-id.ts     newBoardId/isValidBoardId (16 random bytes, base64url, no padding)
src/shared/protocol.ts     decodeMessage: y-websocket frame -> sync | awareness | query | invalid
src/worker/index.ts        fetch router: /api/rooms/:boardId -> BoardRoom, everything else -> ASSETS
src/worker/board-room.ts   Durable Object: one Y.Doc per board, relay for sync + awareness
src/client/routing.ts      boardId from /b/:boardId, / -> /b/<new id>
src/client/sync/connectBoard.ts    WebsocketProvider + the ConnectionState machine
src/client/sync/ConnectionStatus.tsx  the badge (role=status)
```

## Wire format (checked against y-websocket's own source)

* sync: `varuint(0)` followed by the y-protocols message **inline** — no length prefix;
* awareness: `varuint(1)` followed by `varuint8array(payload)` — one prefix, because
  awareness carries its own encoder;
* query-awareness: `varuint(3)` alone; the room ignores it (no presence yet, story 6).

`protocol.ts` mirrors this byte for byte, which is what makes the integration tests
real: they speak the same framing the browser does.

## Durable Object decisions

* **Non-hibernating WebSockets** (`ws.accept()` + `addEventListener('message')`).
  Hibernation pays off when the server holds no per-connection state; here the room
  is a live `Y.Doc` in memory until story 4 persists it, and the doc has to be read
  per message anyway.
* `ws.binaryType = 'arraybuffer'` **before** `accept()`. workerd hands `event.data`
  to a message handler as a `Blob` otherwise, and unwrapping a Blob is async, which
  the handler cannot await in order to reply in order.
* Bad input closes **that socket** with `CLOSE_UNSUPPORTED_DATA` (1003): a text
  frame, an unknown message type, truncated bytes or a corrupt Yjs update. The room
  and every other socket keep going (TC-15).
* No participant counting. `MAX_CONCURRENT_EDITORS` is a *soft* capacity: the 6th
  joiner is served like anyone else (TC-13).
* On accept the room sends SyncStep1, so a client that reconnects to a restarted
  (empty) room repopulates it from the peers that are already there (TC-18).

## Client connection state machine

`connecting` → first sync → `connected`. A disconnect after the first sync is
`reconnecting`; re-syncing goes to `confirmed` — the green "Connected" badge — for
`CONNECTED_CONFIRMATION_MS` and only then hides the badge. Without the
confirmation hold a single blip would flash "Connected" and disappear, which reads
as a bug. `disableBc: true` matters: with y-websocket's BroadcastChannel on, two
tabs of one browser would sync around the server and both the capacity limit and
the e2e tests would be theatre.

For tests, `connectBoard` can be handed a `WebSocketPolyfill`: in `test` builds
`window.__vidi6.dropSockets()` closes the live sockets so an outage is observed
immediately instead of after a handshake timeout, and
`context.setOffline(true)` keeps it down in both directions (TC-27).

## Two bugs the collaboration tests found in the sticky-note layer

1. **Dragging a note froze after the first pointermove** — but only when the note
   was not on top. `bringToFront` bumps `z`, `snapshot()` sorts by `z`, React then
   *moved the DOM node*, and moving a node out of the document drops pointer
   capture, whose `lostpointercapture` ended the drag. Fixed by rendering notes in
   a stable id order in `App.tsx`: stacking already comes from the inline
   `zIndex`, so DOM order carried no meaning and cost a lot.
2. **Two people typing into one note lost one side.** The editor was a textarea
   that diffed its own value against the live `Y.Text` on every input, so the next
   local keystroke deleted whatever the peer had just inserted. The editor now
   observes the `Y.Text` and folds the remote change into the textarea
   (`mergeRemoteText`: one splice plus a caret shift), and marks its own
   transactions with an origin symbol so they are never echoed back into the box.

## Test coverage

| Tests | Where |
| --- | --- |
| TC-01..TC-03 (board id, frame decode) | `tests/unit/board-id.test.ts`, `tests/unit/protocol.test.ts` |
| TC-04..TC-06, TC-13, TC-17 (routing) | `tests/integration/worker.test.ts` |
| TC-07..TC-12, TC-14..TC-18, TC-31 (room) | `tests/integration/board-room.test.ts` |
| TC-19..TC-21 (badge) | `tests/component/ConnectionStatus.test.tsx` |
| TC-22..TC-28 (live, multi-context) | `tests/e2e/live-collaboration.spec.ts` |
| TC-29, TC-30 (idle + capacity) | `tests/e2e/live-stability.spec.ts` (nightly) |
| `mergeRemoteText` (typing merge) | `tests/unit/sticky-text.test.ts` |

Shared fixtures: `tests/integration/helpers/ws-client.ts` (a `RoomClient` speaking
the real protocol over a `SELF.fetch` upgrade) and
`tests/integration/helpers/random-ops.ts` (seeded create/move/colour/type/delete
generator through the real board-model functions).

## Deviations from the spec

1. The board id is written into the URL with `history.replaceState`; there is no
   router (story 5 owns routes). `/` opens a fresh board, and a `/b/<invalid>` URL
   falls back to a new board instead of an error page.
2. `decodeMessage` lives in `src/shared/protocol.ts` and is used by the room. The
   client keeps using y-websocket's own encoder — reimplementing it would only
   prove the test client and the app agree with each other.
3. TC-27 pays the full `CATCH_UP_TEST_OUTAGE_MS` (30 s), so the daily e2e run is
   dominated by that one test.
4. TC-26 asserts convergence per *round* of concurrent changes: a round that
   converges inside the budget bounds every change it contained, and it keeps the
   run proportional. TC-30 measures each individual change.
5. TC-30's soak drives one change at a time and measures convergence after
   each, so a latency number belongs to a single change; concurrency itself is
   covered by TC-23, TC-24 (e2e) and TC-09/TC-10 (integration). The seed prints
   with the percentiles (`NIGHTLY_SEED` overrides it).
6. Only Chromium is installed in this environment. `playwright.config.ts` declares
   the firefox and webkit projects whenever their browsers are present, so TC-22
   and TC-23 run there automatically.

## Not covered

* Presence rendering (story 6). Awareness bytes are relayed — that keeps idle
  connections alive — but nothing draws them.
* Persistence (story 4): evicting a room loses the board; TC-18 covers the
  converge-after-restart path only.
* A real Cloudflare deployment: everything server-side runs in workerd through
  `@cloudflare/vitest-pool-workers`, and `wrangler dev` for the e2e run.

# Story 7 notes — select, move, resize and delete several objects at once

## How to run (additions)

Everything is the same as story 3. `npm run test:unit`, `test:component` and
`test:integration` are unchanged; story 7's specs live in the existing projects:

* unit: `tests/unit/geometry.test.ts`, `board-model-group.test.ts`,
  `registry.test.ts`, `selection.test.ts` (TC-01 … TC-15).
* component: `tests/component/MultiSelect.test.tsx`,
  `tests/component/Transform.test.tsx` (TC-16 … TC-31).
* e2e: `tests/e2e/multi-select.spec.ts` (TC-32 … TC-36).

## Architecture

Story 7 turns the single-sticky drag code from story 2 into a **generic object
transform pipeline**. Four new layers sit between the board app and the model:

1. **`src/shared/geometry.ts`** — pure `Rect`/`Point` math with no imports:
   `rectContains`, `unionRects`, `normalizeRect`, `resizeRect`, `clampScale`,
   `scaleWithin`. This is the only place resize/clamp arithmetic lives, and it is
   the reason selection behaviour is testable without React or Yjs.
2. **`src/shared/board-model.ts`** — group operations (`moveObjects`,
   `resizeObjects`, `bringObjectsToFront`, `deleteObjects`, `objectsInRect`,
   `allObjectIds`, `objectBounds`) added beside the existing per-note helpers,
   plus a framework-free type registry (`registerBoardObjectType`) so the model
   stays importable by the Durable Object worker (it must never import React or a
   client module).
3. **`src/client/objects/registry.tsx`** — the client-side object-type registry.
   A sticky registers its React `Component`, `resizable`, `aspectLocked`,
   `minSize`, `editableText` and `hitTest`. StickyNote was refactored to a generic
   `ObjectProps` component so a future shape needs no change to the gesture code.
4. **Board hooks** — `useSelection` (pure reducer + snapshot pruning),
   `useTransformGesture` (move/resize), `Marquee` (rubber-band select),
   `useBoardKeys` (select-all / nudge / delete), rendered together by
   `SelectionOverlay`, `SelectionBar` and `MarqueeRect`.

## Key implementation decisions

### `ObjectSnapshot` generalisation
`ObjectSnapshot { id, type, x, y, z, width?, height? }` and
`StickySnapshot extends ObjectSnapshot`. `snapshot()` still returns
`readonly StickySnapshot[]` so every story 1-5 test is untouched. `width`/`height`
are **optional**: a note created before story 7 has no stored size and falls back
to `STICKY_SIZE_WORLD` through `objectBounds`. Only the first resize writes both
fields explicitly — so we never rewrite the whole board on load.

### `createSticky` centres, tests seed literally
`createSticky(doc, p)` stores `x = p.x - STICKY_SIZE_WORLD/2` (it centres on the
click). Tests that want exact bounds seed the Y.Map directly with literal `x`/`y`
instead of going through `createSticky`.

### Nudge is in world units
`NUDGE_STEP_WORLD = 1`, `NUDGE_LARGE_STEP_WORLD = 10`. Arrow keys move the
selection by a whole world unit (not a screen pixel), so the result is identical
at every zoom level. `useBoardKeys` calls `preventDefault` on the arrows it
handles so the window never scrolls, and is a no-op while editing text or when a
contenteditable target has focus.

### Aspect lock uses the max scale factor
`resizeRect(..., aspectLocked)` computes `scaleW` and `scaleH` from the raw
handle delta and applies `Math.max(scaleW, scaleH)` to both axes. This preserves
the *existing* ratio (a group of rectangles keeps looking like a group) rather
than forcing squares. Corner handles (`handle.length === 2`) respect the type's
`aspectLocked`; edge handles move one axis only. Holding **Shift forces the ratio
lock** on any handle (TC-24).

### `bringObjectsToFront` is stable and writes minimally
Selected ids are sorted by `(z, id)`, assigned `maxUnselectedZ + 1 + rank`, and a
`z` write happens only when the value actually changes.

### Selection is a pure reducer that prunes stale ids
`selectionReducer` handles click / toggle / setMany / clear / prune / edit.
`useSelection(snapshot)` runs a `prune` effect whenever the snapshot changes and
returns the **same state object** when nothing is stale, so a remote edit never
re-renders the selection for no reason. The `'edit'` action with a non-null id
replaces the selection with that one id and sets `editingId`, which is how
Enter-to-edit naturally selects the note.

### Pressing an already-selected member keeps the group
`onObjectPointerDown` calls `click(id)` only when the object is **not** already
selected, so pressing any member of a multi-selection drags the whole group
instead of collapsing to one.

### Transform gesture: window listeners, synchronous writes
`useTransformGesture` attaches native `pointermove`/`up`/`cancel` listeners to
`window` (not React handlers) and writes to the doc **synchronously** on each
move — no rAF batching — which is what makes the component tests deterministic.
`move` captures the selected positions at the moment `DRAG_THRESHOLD_PX` is
crossed; `resize` captures the starting rects at pointerdown. The resize pipeline
is `resizeRect → derive scale → clampScale → scaleWithin → resizeObjects`, so a
group grows proportionally and the whole selection stops when the *first* object
hits its min or the global `MAX_OBJECT_SIZE_WORLD`.

### `onClickObject` / `onToggleObject` replace the old setter hack
Story 2's `setSelectionApi` mutation is gone; the gesture takes optional
callbacks so selection side-effects flow through the normal hook API.

### Marquee is additive
A marquee always begins from Shift+drag, so `onSelect` calls
`setMany(ids, additive = true)` (TC-20). The marquee only selects objects
**fully enclosed** by the band (`rectContains`). A plain (non-Shift) drag on empty
space still pans, and `Escape` / `pointercancel` cancels an in-flight marquee.

### Overlay, bar and note toolbar coexist without fighting
`SelectionOverlay` renders for any non-empty selection (bounding box + 8 handles,
handles only if some selected type is `resizable`); `SelectionBar` renders for
two or more (with an `aria-live="polite"` count); the single-sticky `NoteToolbar`
renders for exactly one editable sticky. All are hidden while `isDragging` so the
chrome never lags behind a drag.

## Test coverage

* **Unit (TC-01 … TC-15)**: geometry primitives (containment, union, normalise,
  resize with/without ratio, per-axis `clampScale`, `scaleWithin`), the group
  model operations (move/resize/front/delete, `objectsInRect` fully-enclosed,
  `allObjectIds` filters unknown types), the registry (throw-on-duplicate,
  sticky wiring) and the selection reducer (toggle/setMany/prune/edit).
* **Component (TC-16 … TC-31)**: remote-delete pruning, `aria-live` count, single
  sticky → NoteToolbar, empty click clears, additive marquee, non-shift drag pans
  (no marquee), `pointercancel` leaves selection alone, Ctrl+A `preventDefault`,
  arrow nudge `preventDefault`, Backspace while editing is safe, Delete removes
  the whole selection, threshold boundary (2px = click, 3px = drag), one-axis
  edge resize and Shift ratio, 8 labelled handles, read-only (`canEdit false`)
  writes nothing, gesture start/end fire once, `pointercancel` keeps last applied.
* **E2E (TC-32 … TC-36)**: marquee fully-inside selection; group move of six
  notes by +300; corner resize proportional + minimum clamp; arrow/Shift nudge
  with camera and `window.scrollY` unchanged, then Delete; a colleague deleting a
  selected note prunes the local selection; and `MAX_CONCURRENT_EDITORS` contexts
  each moving a different note converging to identical positions. All six run
  green in Chromium (they use the `startBoard`/`joinBoard` pattern, not
  `openBoard`).

## Deviations from the spec

1. **Two `registerObjectType` entry points.** `board-model.ts` exports
   `registerBoardObjectType(type)` (framework-free, used to extend
   `KNOWN_OBJECT_TYPES`); the client `registry.tsx` exports
   `registerObjectType(type, spec)` (full spec incl. the React component) and
   calls the model one internally. This keeps the worker import-safe.
2. **Registry is module-level, not a context.** `getObjectType` is a plain lookup;
   registration happens once at import of `registry.tsx`. There is no DI seam —
   there is exactly one registry per bundle.

## Not covered

* Story 6 (presence) and stories 13-17 — no hooks left for them.
* **Pre-existing e2e breakage (not introduced here).** `tests/e2e/helpers/board.ts`'s
  `openBoard()` does `goto('/')` and expects a board viewport, but story 5 made `/`
  the home page, so `navigation.spec.ts`, `sticky-notes.spec.ts` and part of
  `share-board.spec.ts` fail on `toBeVisible()` **on the base commit too** (verified
  by stashing story 7 and re-running). Rewiring `openBoard` to click "Create a
  board" is not viable under Playwright's parallel run — creating a board per test
  trips the create-board rate limiter (the very 429 the share-board suite tests).
  Story 7's own e2e spec sidesteps this by using `startBoard`.
* **Pre-existing component failure (not introduced here).** BoardLoadFailure
  "TC-22 … is red" reads `styles.css` via
  `fileURLToPath(new URL('.../styles.css', import.meta.url))`, which throws
  `TypeError: The URL must be of scheme file` under the jsdom component project.
  It fails on the base commit as well.
