# vidi6 — Notes

## Story 1: Pan and zoom around an infinite board

### How it works

The board is a DOM element ("the world") inside a full-window viewport. The
camera is the world's CSS transform:

```
transform: scale(zoom) translate(-camera.x px, -camera.y px)
```

Screen ↔ world conversion (all in `src/client/canvas/camera.ts`, pure and
unit-tested):

```
screen = world * zoom + (viewport/2) - camera * zoom
world  = (screen - viewport/2) / zoom + camera
```

- **Pan** — pointer drag anywhere on the board (pointer capture, works for
  touch/pen/mouse alike).
- **Zoom** — Ctrl/Cmd+wheel zooms around the pointer (anchor-preserving);
  `+`/`-`/`0` zoom around the viewport centre; buttons in the bottom-right
  control cluster. Zoom is clamped to 25%–400% (`MIN_ZOOM`/`MAX_ZOOM`);
  buttons disable at the limits.
- **Reset** — back to 100% with the origin centred.
- **Grid** — an SVG `<pattern>` dot grid whose spacing is
  `GRID_SPACING_WORLD` (24) world units, so it scales and travels with the
  board; at 1,000,000 units the spacing is still exactly `24 * zoom` px.
- **First-use hint** — visible until the first pan or zoom (this visit only).
- **No page zoom** — board wheel handlers are non-passive and call
  `preventDefault`; keyboard zoom uses `event.defaultPrevented` guards.

### Camera updates are batched to one render per frame

`useCamera` accumulates navigation into a `pendingRef` and commits to React
state from a `requestAnimationFrame` callback (plus a 32 ms
`CAMERA_FLUSH_FALLBACK_MS` timer). The timer is a safety net: headless WebKit
(WPE) only produces paint frames when content is dirty, so an rAF scheduled
during a drag can starve — the timer guarantees the flush happens.

### Test-mode hook

In `--mode test` builds, `window.__vidi6.setCamera(x, y, zoom)` jumps the
camera exactly (used by e2e for far-travel and reset tests). The `import.meta.env.MODE`
branch is dead-code-eliminated in production builds (verified: the string
`__vidi6` is absent from the prod bundle).

### Test matrix

| Suite            | Command            | Count |
| ---------------- | ------------------ | ----- |
| Unit (camera)    | `npm run test:unit`     | 13 (TC-01–12 + property) |
| Component (RTL)  | `npm run test:component`| 16 (TC-13–16, 19, 20)    |
| E2E (Playwright) | `npm run test:e2e`      | 4 tests × chromium/firefox/webkit (TC-23–28, 31) |

E2E runs against `wrangler dev` (Cloudflare Workers runtime, port 8787) which
serves the Vite build from `dist/client`.

### Gotchas learned

- **Headless WebKit rAF starvation** — see above; the flush-fallback timer is
  why e2e drags pass on webkit.
- **Initial centering race** — the one-shot centre-on-first-measure happens in
  a ResizeObserver callback; e2e must settle on the centred view
  (`expectMarkerNear(640, 400)`) before calling the test hook, otherwise the
  centering overwrites the jump.
- **Button disable race** — the "Zoom in" button disables via an rAF commit;
  an e2e click loop between `isDisabled()` and `click()` can race it, so the
  loop uses `force: true` (a force-click on a disabled button is a no-op).

## Runbook

```bash
npm install
npm run dev          # local Vite dev server
npm run dev:cf       # wrangler dev (Cloudflare runtime) on :8787
npm run typecheck
npm run test:unit
npm run test:component
npm run test:e2e     # builds a test-mode bundle, starts wrangler dev
npm run build        # production build (hooks excluded)
```

## Next story

Story 2 (sticky notes) slots in via `BoardViewport`'s `children` — world-space
content renders inside the transformed world layer and inherits the camera
automatically.
