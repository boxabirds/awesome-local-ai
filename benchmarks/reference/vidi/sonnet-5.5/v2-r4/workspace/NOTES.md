# Notes

- Firefox/WebKit browsers are not installed here; `npm run test:e2e` runs Chromium only, `npm run test:e2e:all` runs all three projects.
- Playwright runs `wrangler dev` on port 8791 against a `--mode test` build (`npm run build:test`) so the `window.__vidi6` hook exists; production builds exclude it.
- BoardViewport renders ZoomControls and NavigationHint itself (App only mounts it) because the specified `BoardViewport({children})` contract leaves no other place to share the useCamera state. Controls are siblings of the board surface so Ctrl-wheel over them never reaches the board listener.
- `useCamera` additionally exposes `zoomBy` and `setCamera` (gesture zoom, test hook).
- Ctrl/Cmd +/-/0 are handled on window regardless of focus.
- Reset view always counts as navigation (it yields a new camera object even when values are equal).
- Task 1 red phase was not committed separately; camera tests and implementation landed together.
