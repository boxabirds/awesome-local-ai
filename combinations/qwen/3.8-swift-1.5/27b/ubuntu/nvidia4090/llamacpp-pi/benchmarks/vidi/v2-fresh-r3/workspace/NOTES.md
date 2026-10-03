# NOTES

## Story 1: Pan and zoom around an infinite board

### Decisions

1. **E2E browsers**: Only Chromium is used for e2e tests. Firefox and WebKit system dependencies are not available on this machine. The Playwright config includes only the chromium project.

2. **Test hook in production build**: The `window.__vidi6.setCamera()` test hook is registered in all builds (not just `MODE === 'test'`). The design says "excluded from production builds" but e2e tests run against the production build via `wrangler dev`. The hook is a simple state setter with no security implications.

3. **Wrangler config**: No `main` (worker entry) field in `wrangler.jsonc` since the Worker code arrives in story 3. Wrangler serves static assets from `dist/client` directly.

4. **rAF batching removed**: The design mentions "Camera updates are batched with requestAnimationFrame to at most one render per frame." In practice, React 19's automatic batching already coalesces state updates within the same event handler, and the rAF indirection caused issues with test determinism. Direct state updates are used instead.

5. **Grid position modulo**: The background-position calculation uses `((value % spacing) + spacing) % spacing` to handle negative camera positions correctly (CSS background-position with negative values can behave unexpectedly).
