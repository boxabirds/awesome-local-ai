# Notes

- Firefox/WebKit browsers are not installed here; `npm run test:e2e` runs Chromium only, `npm run test:e2e:all` runs all three projects.
- Playwright runs `wrangler dev` on port 8791 against a `--mode test` build (`npm run build:test`) so the `window.__vidi6` hook exists; production builds exclude it.
- BoardViewport renders ZoomControls and NavigationHint itself (App only mounts it) because the specified `BoardViewport({children})` contract leaves no other place to share the useCamera state. Controls are siblings of the board surface so Ctrl-wheel over them never reaches the board listener.
- `useCamera` additionally exposes `zoomBy` and `setCamera` (gesture zoom, test hook).
- Ctrl/Cmd +/-/0 are handled on window regardless of focus.
- Reset view always counts as navigation (it yields a new camera object even when values are equal).
- Task 1 red phase was not committed separately; camera tests and implementation landed together.

## Story 2
- BoardViewport accepts `children` as a render function (camera context), an `overlay` render prop (screen-space Toolbar), `onDoubleClickEmpty` and `onClickEmpty`; App passes these.
- `App` takes an optional `doc` prop so component tests can drive the real Y.Doc.
- `createSticky` returns an empty string (writes nothing) for non-finite coordinates. `setStickyColor` with the current colour returns false (no-op).
- NoteToolbar is rendered inside the note, counter-scaled by 1/zoom, so it stays screen-sized above the note. `onSelect` accepts `null` to clear selection.
- Notes are rendered in stable id order and stacked with `z-index` (not DOM order) so a drag never re-parents the captured element.
- While editing, the textarea is vertically centred by auto-sizing its height; text is hidden-measured in the display div for font fit.
- Red-phase test commits were not made separately.

## Story 3
- vitest was downgraded to ^4.1 because `@cloudflare/vitest-pool-workers` (integration project) peers on vitest 4.
- Worker code is typechecked by `tsconfig.worker.json` (workers-types, no DOM lib); `typecheck`/`build` run both configs.
- `BoardRoom` applies sync step2/update bytes with `Y.applyUpdate` directly: `y-protocols` swallows decode errors, and the design requires a close with 1003 for invalid updates.
- Awareness frames are relayed byte-for-byte (the original frame), not re-encoded.
- `App` takes an optional `boardId`; without it (component tests) nothing connects and no badge renders. `main.tsx` resolves it via `boardIdFromLocation()` (`/b/:id`; `/` replaces the URL with a fresh id). An invalid id in the URL just keeps retrying (400) while the board works locally.
- `connectBoard` accepts an optional provider factory so the component tests drive it with a fake. The default factory also reacts to the browser `offline`/`online` events: a dead socket otherwise stays "open" for ~30 s, so the badge would lag far behind the outage.
- `StickyTextEditor` now mirrors remote Y.Text changes into the textarea (caret shifted through the delta). Without it, the next local keystroke diffed against stale text and deleted what others had typed (found by TC-23).
- Playwright: `chromium-nightly` project runs `tests/e2e/nightly.spec.ts` (TC-29/30, `npm run test:e2e:nightly`); the other projects ignore it. Latency is logged, never asserted. `window.__vidi6.connectionState` exists in test builds only.
- Pre-existing, unrelated: story 1 e2e `far travel › TC-27 pan exactly…` fails in Chromium here (grid offset 8 vs tolerance 1), also on the story-2 commit.
