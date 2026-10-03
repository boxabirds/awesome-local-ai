# NOTES

Decisions made while implementing story 1 (pan and zoom around an infinite board) and story 2 (sticky notes).

## Story 2 decisions

### useBoardDoc subscription pattern
- Yjs `observeDeep` doesn't support removing individual callbacks. The `useBoardDoc` hook uses a `Set` of listeners pattern with `useSyncExternalStore`. Since there's only one doc per app lifecycle, the minor leak on unmount is acceptable.

### Font fitting timing
- The `fitFontSize` measurement runs in a `useEffect` that depends on `[note.text, note.id, editing]`. The `editing` dependency is critical: when editing ends, the display element mounts fresh and needs font measurement even though `note.text` didn't change during the render cycle.

### Pointer events on notes
- The world layer has `pointer-events: none` (so the viewport can receive pan events). Sticky notes explicitly set `pointer-events: auto` to receive their own interactions.

### E2E test: page.goto required
- Unlike the story 1 navigation tests (which call `page.goto('/')` per test), the sticky notes tests use a `beforeEach` that calls `page.goto('/')` then `setCamera`. The `setCamera` helper now includes a `waitForFunction` for the test hook to be registered.

### tc-39: createSticky with NaN/Infinity throws
- The design says "returns false; 0 updates" for non-finite coordinates, but `createSticky` returns a `string` (the new id), not a boolean. Non-finite coordinates throw a `RangeError` instead, which is caught by the test. This is a reasonable interpretation since the function signature can't return `false`.

---

Decisions made while implementing story 1 (pan and zoom around an infinite board).

## E2E browsers
- The design asks for Chromium, Firefox and WebKit. This machine has working
  Playwright Chromium (v1243, preinstalled) and Firefox (downloaded), but WebKit
  cannot launch: it needs GTK/WebKit system libraries (libwebkitgtk-6.0 etc.)
  that are not installed and cannot be installed without root.
- `playwright.config.ts` declares all three projects (per the design) and
  supports an `E2E_BROWSERS` env var to select a subset. `npm run test:e2e`
  pins `E2E_BROWSERS=chromium,firefox` for this machine.
- Task 7 is therefore done for 2 of 3 browsers; WebKit is blocked on the
  environment, not the code.

## BoardViewport props
- The design contract shows `BoardViewport({ children })`, but the viewport,
  the zoom controls and the hint must share one camera instance. `App` owns
  the shared `useCamera(size)` and passes the controls to `BoardViewport` as a
  `controls` prop (children unchanged). This keeps a single source of truth.

## Initial view
- The PRD does not require the load view to be centred on the origin; it only
  defines the "standard view" via Reset view (100%, origin centred). The
  initial camera is therefore `{x: 0, y: 0, zoom: 1}` (origin at the
  top-left corner), and Reset view centres it. This also matches the
  coordinate model: camera x,y is the world point at the viewport top-left.

## Test hook in e2e
- `window.__vidi6.setCamera()` is enabled only when `import.meta.env.MODE ===
  'test'` (per design). The e2e web server serves `dist/client`, so
  `npm run test:e2e` builds with `vite build --mode test`; production builds
  (`npm run build`) exclude the hook via Vite's static env replacement.

## E2E timing: rAF-coalesced renders
- Camera updates render on the next animation frame (rAF coalescing). E2E
  assertions that read positions/labels right after a camera change must
  therefore use Playwright's auto-retrying matchers (`expect.poll`,
  `toHaveText`, `toBeDisabled`) — one-shot reads race the render. The "Zoom in
  button disabled at 400%" limit is the sharpest case: the click that reaches
  the limit can lose the race with the re-render that disables the button.

## Ports
- All servers stay inside $AGENT_PORT_FIRST..$AGENT_PORT_LAST:
  - wrangler dev: 25504 (inspector 25505) — set in playwright.config.ts
  - vite dev: 25506 — set in vite.config.ts
