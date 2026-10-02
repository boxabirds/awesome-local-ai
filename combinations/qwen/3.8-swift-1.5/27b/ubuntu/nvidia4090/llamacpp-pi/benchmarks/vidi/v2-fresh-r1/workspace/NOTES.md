# Story 1 — Notes

Decisions and environment facts worth remembering for later stories.

## Environment

- **Ports**: 24368–24383 are allocated to vidi6. `24368` = wrangler dev (E2E
  webServer), `24370` = `vite dev` (manual dev).
- **E2E browsers**: Chromium and Firefox are installed and pass. **WebKit is
  not available** in this environment (missing system library `libavif13`, no
  sudo to install it), so the E2E matrix is `chromium` + `firefox`. The
  Playwright config intentionally defines only those two projects.
- **E2E build**: E2E runs against a **test-mode build** (`npm run build:test`,
  i.e. `vite build --mode test`) so the `window.__vidi6` test hook
  (`src/client/canvas/testHooks.ts`) is present. The production build
  (`npm run build`) strips it. The Playwright webServer command builds in test
  mode and serves `dist/client` via `wrangler dev`.

## Design decisions

- **Safari pinch point**: `gesturestart`/`gesturechange` events carry no
  pointer location, so the Safari pinch handler zooms around the **viewport
  centre** (documented in `BoardViewport.tsx`). Primary path (Ctrl+wheel)
  zooms around the pointer.
- **Wheel delta normalisation**: `deltaMode` 1 (lines) and 2 (pages) are
  normalised to pixels via `WHEEL_LINE_DELTA_PX` / `WHEEL_PAGE_DELTA_PX` in
  `src/shared/config.ts` before reaching the camera.
- **`zoomByFactor`** was added to `CameraApi` (`useCamera.ts`) as the entry
  point for explicit scale-ratio zoom (Safari gesture); it wraps `zoomAt`.
- **Camera commits are rAF-coalesced**: input handlers update refs
  synchronously and commit at most one render per animation frame.
  Consequence for tests: the DOM (label text, `disabled` attribute) lags input
  by one frame. The TC-25 E2E test waits ~2 frames (32 ms) after each click
  before re-reading state; component tests flush the fake rAF explicitly.
- **Initial centring is synchronous**: viewport size is measured in a
  `useLayoutEffect` (before paint) and the camera is centred **during render**
  when the size is first known (`useCamera.ts`). A `ResizeObserver`-only
  approach (centring in a post-paint effect) caused two bugs: a flash of the
  top-left origin on load, and a late reset that clobbered the first user
  input (first click/drag). The design says resize does *not* move the camera
  (only the first size centres), which this implements.
- **Grid rendering**: the dot grid is a CSS `radial-gradient` on the viewport
  with `background-size = 24*zoom px` and `background-position` derived from
  the camera, so it stays even and cheap at any zoom (no per-dot DOM nodes).
- **World layer**: a single `div` transformed with
  `scale(zoom) translate(-x, -y)` (origin `0 0`), `pointer-events: none`.
  Object stories add children here with `pointer-events: auto`.

## Test infrastructure notes

- **jsdom `PointerEvent` polyfill** (`tests/component/setup.ts`): jsdom has no
  `PointerEvent`, and testing-library's `createEvent` falls back to
  `new Event(...)` which *drops* `clientX`/`button`/`pointerId` from the init
  dictionary. The setup file installs a minimal `PointerEvent` (subclass of
  `MouseEvent` plus the pointer fields) so `fireEvent.pointer*` works.
- **RTL cleanup**: the Vitest component project does not enable `globals`, so
  `@testing-library/react` auto-cleanup does not run; each component test file
  calls `cleanup()` in `afterEach`.
- **jest-dom matchers**: registered via `@testing-library/jest-dom/vitest` in
  `tests/component/setup.ts`.
- **Fake timers**: component tests fake `requestAnimationFrame` (and friends)
  and flush with `vi.advanceTimersByTime(16)` inside `act`.

## Coverage vs. spec

- All 32 spec test cases are covered: TC-01…TC-12 (unit, `camera.test.ts`),
  TC-13…TC-18 + TC-29…TC-32 (component), TC-23…TC-28 + TC-31 (E2E).
  TC-31 (no page zoom) appears in both component and E2E tiers per the spec
  matrix.

---

# Story 2 — Notes

## Design decisions

- **Y.Doc ownership**: `useBoardDoc()` creates one `Y.Doc` in a `useRef` and
  exposes an immutable snapshot via `useSyncExternalStore`. The snapshot is
  cached in a ref and only recomputed when the `objects.observeDeep` handler
  fires (dirty flag pattern), preventing infinite re-render loops that would
  occur if `getSnapshot` returned a new array reference on every call.

- **Interaction state machine uses a ref**: The `StickyNote` component uses
  `stateRef` (a `useRef<InteractionState>`) for the synchronous state machine
  (unselected → pressed → dragging → unselected). React `useState` updates are
  async, so using state for the pointer event handlers would cause the
  `handlePointerUp` closure to see the stale `state` value when it fires
  immediately after `handlePointerDown` in the same event loop tick.

- **Font fitting**: `fitFontSize` binary-searches integer px sizes on an inner
  text element (not the flex container). The outer wrapper handles centering
  and overflow clipping; the inner element's `scrollHeight` reflects the actual
  text content height. This is critical because a flex container with
  `height: 100%` always has `scrollHeight === clientHeight` regardless of
  content.

- **Surrogate-pair safety in `applyTextDiff`**: The common-prefix/common-suffix
  algorithm backs off by 1 code unit if the prefix boundary lands on a high
  surrogate (0xD800–0xDBFF) or the suffix boundary lands on a low surrogate
  (0xDC00–0xDFFF). This prevents splitting emoji or other supplementary plane
  characters, which would corrupt the Y.Text.

- **`pointer-events: auto` on StickyNote**: The world layer has
  `pointer-events: none` (from story 1) so the viewport receives drags on empty
  space. Sticky notes explicitly opt back in with `pointer-events: auto`.

- **Y.Text `transact` is on the doc**: `ytext.transact(...)` does not exist;
  transactions must be opened on `ytext.doc.transact(...)`. This is a common
  Yjs API gotcha.

- **Y.Text `observe` callback**: The callback receives a `YTextEvent` object;
  the delta array is at `event.delta` (a getter), not as the first argument.
  Each delta op is `{insert?: string, delete?: number, retain?: number}`.
  Pure `retain` ops are filtered out in tests.

## Environment

- Same as story 1 (ports, browsers, build mode).
