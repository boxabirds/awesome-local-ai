# Notes for story 1

## Deviations from design / spec

- ZoomControls and NavigationHint are rendered inside BoardViewport (in a
  pointer-events:none overlay) rather than wired up in App.tsx. BoardViewport's
  component contract accepts only `children` and owns the camera state, so
  keeping the controls inside it is the only way to pass live camera props.
  App.tsx simply renders <BoardViewport />.
- CameraApi was extended with `zoomBy(factor, point)` (beyond the design's
  contract) to serve the Safari gesturechange pinch handler.
- wrangler was raised to v4 (assets-only Workers config, `send_metrics: false`)
  and vitest to v3 (projects support) - the versions initially pinned failed
  config validation / feature checks.
- @playwright/test is pinned to 1.63.0: it is the newest release whose browser
  revisions match the pre-cached build set of this machine.
- TC-25 e2e: Playwright's isDisabled()/click() loop raced the rAF-batched
  disable update (a click on the freshly disabled button hangs on actionability
  until timeout). Replaced with exactly seven deterministic + clicks
  (1.25^6 < 4 <= 1.25^7), which reaches the clamp with the last click still
  enabled, then asserts 400% and disabled.
- Component tests use vi.useFakeTimers faking only requestAnimationFrame /
  cancelAnimationFrame and flush inside act(), because camera commits are
  coalesced to one render per animation frame. A ResizeObserver mock delivers
  a fixed 1280x800 viewport synchronously (jsdom has none).

## Blocked (not runnable on this machine)

- Task 7, Firefox and WebKit e2e: the browser builds themselves are installed,
  but the host is missing system libraries they link against - Firefox needs
  libgtk-3.so.0; WebKit (WPE) needs libWPEWebKit-2.0, GTK4, libGLESv2 and
  libgstallocators/gstapp/gstpbutils/gstaudio/gsttag/gstvideo/gstgl/
  libbacktrace. They cannot be installed: sudo is blocked ("no new privileges")
  and every Ubuntu mirror (archive.ubuntu.com and alternates) is network-blocked.
  The Firefox/WebKit test cases therefore could not be executed here.
- Task 7, Chromium e2e: the navigation suite (TC-23..TC-28, TC-31) passed 7/7
  in Chromium during development (Playwright 1.64 + cached chromium-1248).
  Afterward `npx playwright install` deleted the pre-cached browser set from
  /w/browsers. The chromium-for-testing downloads are unavailable from this
  sandbox: cdn.playwright.dev returns 403 and its 307 redirect target is
  network-blocked, the prss.microsoft.com mirror returns 400 for cft/legacy
  builds, storage.googleapis.com and npmmirror are blocked, and the binaries
  are not on npm. The intact original builds (chromium-1243/1248 plus headless
  shells) still exist at ~/.cache/vidi-agent-ms-playwright, but that
  path is denied to this tool environment. The e2e code itself is complete and
  committed under tests/e2e/.

## Verified on this machine

- npm run typecheck: clean.
- npm run build: clean; window.__vidi6 test hook confirmed absent from the
  production bundle (dead-code eliminated).
- npm run test:unit: 13/13. npm run test:component: 15/15.
- npx playwright test --project=chromium: 7/7 (see Chromium note above for the
  build-loss afterward).

# Notes for story 2

## Resolved since story 1

- Chromium e2e IS runnable here: the intact cached builds under
  ~/.cache/vidi-agent-ms-playwright turned out to be readable from
  this session. Running e2e with
  `PLAYWRIGHT_BROWSERS_PATH=~/.cache/vidi-agent-ms-playwright
  npx playwright test --project=chromium` works (12/12). The Firefox/WebKit
  system-library blockage above still stands.

## Deviations from design / spec

- createSticky returns `string | false` (the design contract said `string`) so
  TC-39 can reject non-finite coordinates with zero Y.Doc updates instead of
  throwing.
- BoardViewport gained three optional props (onCreateStickyAtWorld,
  onClearSelection, onViewportHandle with a ViewportHandle camera accessor) so
  App can resolve screen-space interactions (double-click point, Sticky note
  button centre, constant-size note toolbar) that the component contract did
  not anticipate; without them the world->screen math would have to leak.
- Notes are rendered in stable createdAt order with CSS `zIndex: note.z`
  instead of re-sorted children. React moves keyed children via remove +
  insertBefore, which detaches the dragged node, silently kills pointer
  capture, and froze drags the moment bringToFront fired mid-drag (found by
  TC-31/32). z-order semantics (snapshot still sorted by z; bringToFront
  unchanged) are untouched.
- The note toolbar is counter-scaled in CSS
  (translateX(-50%) scale(1/var(--note-zoom))) instead of being rendered in a
  separate screen-space layer, keeping it a child of the note it belongs to.
- e2e helpers: setCamera now polls data-camera until the rAF-coalesced camera
  commit has rendered before returning, otherwise the next mouse action (e.g.
  double-click create) would run in handlers closed over the previous camera
  (caused flaky TC-31/32 placement).

## Verified on this machine

- npm run typecheck: clean.
- npm run build: clean; window.__vidi6 absent from the production bundle
  (grep count 0); present in build:test.
- npm run test:unit: 41/41. npm run test:component: 33/33.
- npx playwright test --project=chromium: 12/12 (7 story 1 + 5 story 2).
