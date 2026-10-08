# Story 1: decisions and environment notes

_(Story 2 decisions are at the bottom of this file.)_

# Story 2: Capture ideas on sticky notes — decisions

## Environment

- **E2E runs on Chromium only.** The sandbox pre-installs only the
  Chromium Playwright browser (`chromium-1243` + headless shell) under
  `~/.cache/vidi-agent-ms-playwright`; Firefox and WebKit binaries are not
  present and cannot be downloaded (no network to the Playwright CDN, no
  root). `playwright.config.ts` therefore keeps all three projects per the
  design, and `npm run test:e2e` selects the `chromium` project
  (`playwright test --project chromium`). On a machine with all three
  browsers, `npx playwright test` would run everything.
- **`scripts/ensure-browsers.mjs`** runs before the e2e suite and makes
  `PLAYWRIGHT_BROWSERS_PATH` work no matter how the environment sets it: it
  keeps the current value when it contains a Chromium binary, otherwise
  falls back to the sandbox cache locations.
- **Ports.** All servers stay inside `$AGENT_PORT_FIRST..$AGENT_PORT_LAST`
  (defaults 29104-29119): `vite dev` on 29104, the e2e `wrangler dev`
  webServer on 29105 (config asserts the port is in range).

## Implementation decisions

- **CameraContext.** `useCamera` lives in `App` (which also owns the
  viewport size) and is provided via `CameraContext`; `BoardViewport`
  consumes it. This keeps the viewport's public API as `{children}` while
  the board input, zoom controls and hint all drive the same camera.
- **rAF coalescing.** Every camera mutation is enqueued and applied once
  per animation frame (`useCamera`), so fast wheel/drag bursts cause at
  most one render per frame. `endPan` flushes synchronously so a drag ends
  on the exact pointer position.
- **ZoomControls enabled-guards.** Buttons carry the native `disabled`
  attribute and additionally check `canZoomIn/Out` before calling their
  callbacks, keeping the design contract ("call callbacks only when
  enabled") true even for synthetic events (jsdom fires `click` on
  disabled elements — TC-32).
- **`setPointerCapture` guard.** Called only when available (jsdom lacks
  it; every supported browser has it).
- **Test hook.** `window.__vidi6.setCamera` is installed only when
  `import.meta.env.MODE === 'test'`; verified absent from the production
  bundle (`grep __vidi6 dist/client/assets/*.js` → 0 matches).
- **E2E pixel target.** The origin marker is a 12px world-space crosshair
  centred on (0,0); its centre is exactly `worldToScreen(0,0)`, so
  movement assertions are ±1px camera assertions. TC-27/TC-26 travel to
  `UNBOUNDED_PAN_TESTED_EXTENT` via the test hook; the marker's layout box
  is readable even far off-screen.
- **TC-18 (keys)** is tested in `BoardViewport.test.tsx`: the Ctrl/Cmd
  keydown listener lives on `window` inside BoardViewport. (The design
  lists TC-18 under both the BoardViewport and ZoomControls test files.)

## Component-test environment quirks (handled in `tests/component/setup.ts`)

- **No `PointerEvent` in jsdom** — a minimal `PointerEvent` (over
  `MouseEvent`, adding `pointerId`/`pointerType`) is installed so
  Testing Library's pointer events carry `clientX/Y`/`button`.
- **No `requestAnimationFrame` without `pretendToBeVisual`** — a
  timer-based fallback is installed; under `vi.useFakeTimers()` the
  underlying `setTimeout` is faked, so tests advance 16ms in `act` to
  flush the coalesced camera update.
- **RTL `fireEvent` returns `dispatchEvent`'s boolean**, not the event;
  tests that assert `defaultPrevented` build the event with
  `createEvent` and dispatch it with `fireEvent`.
- **RTL auto-cleanup needs vitest globals** (off here), so `cleanup` runs
  in an explicit `afterEach`.

## Story 2 implementation decisions

- **Stable DOM render order — the drag-capture bug.** Rendering notes in
  snapshot (z, id) order means `bringToFront` mid-drag re-sorts the list
  and React reorders the DOM (remove + reinsert). In Chromium, moving a
  node that holds `setPointerCapture` releases the capture and fires
  `lostpointercapture`, killing the drag after its first move. Fix: the
  board renders notes in a **stable `(createdAt, id)` order**
  (`renderOrder` in `board-model.ts`); stacking is expressed purely by
  CSS `z-index: note.z`, which can change without touching DOM order.
  `snapshot()` still returns (z, id) order for the model and tests.
- **Unit-test Y.Text must be doc-bound.** `applyTextDiff` operates through
  `ytext.doc.transact`; a standalone `new Y.Text()` has no doc. The unit
  tests use a `makeYText(initial)` helper (`new Y.Doc()` +
  `doc.getText('text')`) so every level tests the real Y.Doc, and
  `applyTextDiff` keeps a null-doc guard (applies directly without a
  transact) as a defensive fallback.
- **Yjs delta shape.** The observed delta uses separate `{ delete: n }`
  chunks (not `{ retain: n, delete: true }`) and omits the unchanged
  trailing suffix; the test summarizer handles both forms.
- **Editor "outside" detection.** The textarea finds its own note root
  via `ta.closest('[data-sticky-note]')`; a pointerdown whose target is
  inside the own note (padding, swatches) stays in editing, while a click
  on any other note or the board ends editing as *unselected* (design
  sticky.edit_outside).
- **`finishDrag(flush)` semantics.** A clean `pointerup` cancels the
  pending rAF and flushes it, so the grabbed point ends exactly under the
  pointer (TC-31/TC-32). `pointercancel`/`lostpointercapture` do **not**
  flush — the note stays where it was last displayed (TC-37). The rAF is
  also cancelled in the unmount cleanup so a deleted note never leaves a
  stale drag id or a pending frame.
- **Drag math is origin-based.** The pending world position is
  `pointerdown origin + (pointer - origin) / zoom`, recomputed every move
  and applied at most once per rAF; it stays exact even if the camera
  zooms mid-drag because both terms use the live zoom.
- **E2E model hook.** `window.__vidi6.getObject(id)` returns
  `{x, y, z, color, text}` in test builds (absent from production), so
  e2e tests assert on the model (exact world deltas, z-order, colour,
  length-clamped text) rather than pixel-guessing.
- **TC-32 overlap geometry.** At 200% zoom the two notes' creation points
  are chosen so the second dblclick lands *outside* the first note's box
  (otherwise it edits instead of creating) while the boxes still overlap;
  the drag grabs the bottom note at a point not covered by the top one.
- **`longParagraph()`** produces exactly 1,000 characters of English prose
  (repeated sentence pool, sliced to length) so the auto-fit test crosses
  the 1,000-char limit and exercises the clamp + counter + fade.

## Story 2 test counts

- Unit: 40 (16 board-model + 11 sticky-text + 13 camera)
- Component: 32 (9 StickyNote + 4 StickyTextEditor + 3 Toolbars + 9
  BoardViewport + 5 ZoomControls + 2 NavigationHint + ...)
- E2E (Chromium): 11 (7 story-1 navigation + 4 story-2 sticky notes)
