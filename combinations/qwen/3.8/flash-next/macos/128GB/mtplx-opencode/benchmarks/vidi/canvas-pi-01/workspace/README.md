# vidi6

A shared board for thinking together.

## Story 1 — pan and zoom around an infinite board

Client-only navigation: a pure camera module (`src/client/canvas/camera.ts`)
drives a DOM viewport (`BoardViewport.tsx`) whose world layer and dot grid are
positioned with CSS transforms. Drag, wheel, Safari trackpad gesture and
Ctrl/Cmd keyboard shortcuts navigate the board; a bottom-right zoom control and
a first-use hint complete the story. Settings (zoom limits, step factor, grid
spacing) live in `src/shared/config.ts`.

### Running it

```
npm run dev            # Vite dev server
npm run preview        # the built client served by wrangler dev
npm run typecheck
npm test               # vitest: unit (node) + component (jsdom)
npm run test:e2e       # builds the test bundle, then Playwright on Chromium,
                       # Firefox and WebKit against `wrangler dev`
```

`npm run test:e2e` needs Playwright browsers (`npx playwright install chromium
firefox webkit`) and runs against a test build (`vite build --mode test`), so
`window.__vidi6.setCamera/getCamera` — used to jump to the far end of the
board — exists there and nowhere else: the mode check is constant-folded out of
the production bundle.

### Test layers

| Layer | Where | What it pins down |
| --- | --- | --- |
| Unit | `tests/unit` | camera maths, pointer-invariance to 1e-6, clamping, exact step ladder |
| Component | `tests/component` | input state machine, `preventDefault`, disabled states, hint latch |
| E2E | `tests/e2e` | real pointer/wheel/keyboard input and painted pixels in three browsers |
