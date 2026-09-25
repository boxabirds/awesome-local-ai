# Story 1 — Pan and zoom around an infinite board: implementation notes

## Deviations from the spec's literal text

1. **`BoardViewport` contract gains a required `api: CameraApi` prop.**
   The design lists the contract as `children?: ReactNode` only, but the
   zoom controls (TC-19/20/21, TC-32) must drive the same camera that the
   viewport renders, and the hint (TC-22) reads `hasNavigated` from it. The
   single `useCamera` instance is owned by `App` (which also owns the
   ResizeObserver that measures the board area) and passed down as a prop.
   `App` itself is not part of any named contract, so all spec'd component
   props remain available.

2. **`useCamera` exposes `zoomAtPoint(point, factor)`** (in addition to the
   spec'd `beginPan`/`panMove`/`endPan`/`zoomStep`/`reset`) so the Safari
   `gesturechange` handler can zoom by a scale ratio around the pinch point,
   as the design's sequence diagram describes ("gesturechange → zoomAt
   pointer scale ratio"). `wheel` is also exposed for the viewport's native
   (non-passive) listener. `hasNavigated` is part of the API because TC-22
   needs it.

3. **`reset` is a zero-argument method** (`reset()`), matching the design's
   `reset()`. The viewport size it resets to is the size passed to
   `useCamera(viewport)` (kept in a ref, so resizes are honoured).

4. **Zoom step snapping.** After a `zoomStep`, the resulting zoom is snapped
   to the nearest `ZOOM_STEP_FACTOR^n` when it lies within `1e-9`.
   `1.25 * (1/1.25)` is exactly `1` in IEEE 754, but longer in/out sequences
   drift by ~1e-16; the snap guarantees stepping back always returns exactly
   to the previous stepped value (TC-09's "exact 0.8 * 1.25" case and its
   longer cousins). The snap re-anchors the camera around the viewport
   centre so the invariant is preserved.

5. **Wheel `deltaMode` conversion constants.** The design says LINE/PAGE
   deltas are converted "via named constants" without giving values. We use
   `16 px/line` and `100 px/page`, declared in `BoardViewport.tsx`
   (`WHEEL_LINE_PX`, `WHEEL_PAGE_PX`). These only matter for line/page-mode
   wheels (rare on the target browsers); pixel-mode wheels are used by all
   tests.

6. **Grid tile anchoring.** Dots sit at world coordinates that are multiples
   of `GRID_SPACING_WORLD`. The background tile is anchored at
   `background-position: -cam.x*zoom, -cam.y*zoom` (top-left of the viewport
   maps to the world point under it), so dots land exactly on world lattice
   points for every camera — including at `1,000,000` units (TC-27). The
   dot radius (1.1px) is a visual choice, not spec'd.

7. **Origin marker is a 16×16 crosshair** (SVG) at world (0,0) with
   `pointer-events: none` and `data-testid="origin-marker"`. The spec does
   not fix its size; it is the e2e pixel target and must not intercept
   drags.

8. **Camera updates are coalesced with `requestAnimationFrame`** as the
   design requires. The camera *ref* is authoritative and updates
   synchronously (so a rapid click burst never steps off a stale value);
   React state mirrors it at most once per frame. A no-op update
   (camera.math returns the same object) schedules no frame and does not
   trip `hasNavigated` (TC-29: a click without movement keeps the hint).

9. **Non-passive wheel listener is attached natively** (in a `useEffect`),
   because React 19 registers `onWheel` as passive and `preventDefault()`
   would be silently ignored. Keyboard (Ctrl/Cmd + `=` / `-` / `0`) is a
   window-level `keydown` listener that `preventDefault()`s before acting.

10. **ZoomControls is a sibling of the viewport** (inside the app shell),
    not a child, and its container `stopPropagation()`s wheel events
    (TC-30): a Ctrl+wheel over the controls never reaches the viewport's
    native listener, so the board never zooms and the event keeps its
    default page behaviour.

## Build / test wiring decisions

- **`npm run build:e2e`** = `vite build --mode test`: the e2e build carries
  the `window.__vidi6` test hook (`setCamera`), enabled only when
  `import.meta.env.MODE === 'test'`. In the plain production build the
  `import.meta.env.MODE === 'test'` expression is statically replaced with
  `false`, so the hook is dead-code-eliminated (verified: the identifier is
  absent from the production bundle). `window.__vidi6` is declared as an
  optional global in `src/vite-env.d.ts`.
- **E2E serving**: `wrangler dev --port 8787` serves `dist/client`
  (assets-only Worker; story 3 adds the Worker script). `wrangler.jsonc`
  therefore has **no `binding`** — wrangler 4 refuses an asset binding on
  an assets-only Worker. `playwright.config.ts` `webServer` runs
  `npm run build:e2e && npx wrangler dev --port 8787 --ip 127.0.0.1` with
  `reuseExistingServer` (non-CI) and a 240 s timeout.
- **Playwright version**: pinned to `@playwright/test@1.63.0` to match the
  browsers preinstalled in this environment (chromium-1243, firefox-1543,
  webkit-2359). Viewport 1280×800 for all three projects.
- **Vitest projects**: `unit` (node) and `component` (jsdom +
  @testing-library/react). Component tests fake `requestAnimationFrame`
  (and the common timer APIs) and flush camera commits with
  `act(() => vi.runAllTimers())`.
- **jsdom polyfills** (in `tests/setup/component-setup.ts`): `PointerEvent`
  (extends `MouseEvent`), pointer capture methods, `ResizeObserver`.

## Environment notes (webkit system libraries)

The host is missing three shared libraries that Playwright's WebKit needs
(`libavif.so.13`, `libgav1.so.0`, `libyuv.so.0`) and root/sudo is not
available in this sandbox. Instead of `sudo npx playwright install-deps`,
the `.deb` packages were downloaded from the Ubuntu jammy archive and the
`.so` files copied into the Playwright cache bundle:

    ~/.cache/ms-playwright/webkit-2359/minibrowser-wpe/lib/

(that directory is already on WebKit's `LD_LIBRARY_PATH` via the bundle's
`MiniBrowser` wrapper script, which **overrides** `LD_LIBRARY_PATH`, so a
plain `npx playwright test` works with no environment changes). If the
cache is ever reinstalled, repeat the copy: `libavif13_0.9.3-3`,
`libgav1-0_0.17.0-1build1`, `libyuv0_0.0~git20220104.b91df1a-2` (amd64).

## Test-timing decisions (e2e)

- **`nextFrame(page)`** (double `requestAnimationFrame` wait) is used before
  reading `boundingBox()` geometry after a gesture. Headless WebKit can
  report a stale layout rect within the same frame a CSS transform changed;
  Chromium/Firefox update synchronously, but the wait is harmless there.
- **TC-25's click loop** settles each click by waiting for the zoom label
  text to change before checking `isDisabled()` again. The button's
  `disabled` attribute lands one frame after the click (rAF coalescing), so
  a naive `isDisabled()` → `click()` loop can read stale DOM and then block
  on an actionability check against an already-disabled button.
- TC-31 asserts that at max zoom, Ctrl/Cmd + `-` is a normal one-step
  zoom-out (400% → 320%); only zoom-*in* past the limit is ignored (per the
  PRD: "at max zoom the + button is disabled and further zoom-in does
  nothing").

## What is deliberately NOT built (later stories)

- (Story 2, now built: sticky notes, selection, drag, toolbar, Yjs doc.)
- No rooms, Worker, persistence, cursors, other object types, or sync
  (stories 3-17). The test hook exists because task 4/7 of story 1 need
  deterministic camera state; story 2 extended it with a notes hook.
- The app shell is a plain client bundle; `wrangler.jsonc` is assets-only
  until story 3 introduces the Worker.

---

# Story 2 — Capture ideas on sticky notes and rearrange them: implementation notes

## New dependency

- **`yjs@13.6.33`** (pinned). The only new dependency in the repo. The
  client keeps the single `Y.Doc` for the whole board (`useBoardDoc`);
  every object is a `Y.Map` in `doc.getMap('objects')`, note text is a
  `Y.Text` inside each sticky's map. The doc is the source of truth for
  the e2e `__vidi6.notes` snapshot hook.

## Deviations / non-obvious decisions

1. **Surrogate-pair bug in Y.Text diffing (fixed in `StickyText`).**
   `Y.Text.applyDiff` computed `insert.length` in UTF-16 code units but
   `Y.Text.insert(index, str)` indexes in **code points**. Inserting at a
   boundary of a surrogate pair (e.g. emoji) silently corrupted the text
   (lone surrogates). `applyTextDiff` now walks the diff in code points
   (via `Array.from` / `for...of`) and translates code-point offsets to
   Y.Text offsets before calling. Covered by the unit tests
   (`sticky-text.test.ts`: "inserting at/after a surrogate pair" cases).

2. **`bringToFront` returns `false` when the note is already on top**, in
   addition to the spec'd "stale id" case. TC-10 only requires "no update
   emitted"; the `false` return is what lets the component distinguish
   "disappeared" (abort drag) from "already front" (fine). Callers that
   need "still exists" use `hasObject(doc, id)` instead of the return
   value.

3. **No `onLostPointerCapture` handler on the note root.** Chrome fires
   `lostpointercapture` when the captured element is *moved in the DOM* —
   which is exactly what React does when `bringToFront` re-sorts the notes
   by z mid-drag. Ending the drag on that event killed every drag of a
   non-top note after its first pointermove. A stale `dragRef` is harmless:
   the next `pointerdown` replaces it and the unmount cleanup cancels any
   pending rAF. (Reproduced on Chromium; Firefox/WebKit never fired it.)

4. **Camera *and* notes test hooks.** `testHooks.ts` now exposes
   `installNotesHook(getNotes)`; `useBoardDoc` installs it with a
   `snapshot(doc)` closure. E2E reads `__vidi6.notes` for model-level
   assertions (position/color/z/text) alongside DOM assertions.

5. **Counter format is `{length}/{max}` with no spaces** — the PRD's
   verification says "the counter shows 1000/1000".

6. **Creation is always in edit mode** (textarea focused, empty), matching
   TC-28/30. Clicking a note selects; double-click (or Enter when selected)
   enters edit mode. Escape ends edit → selected; Escape again deselects
   (App-level, when the note is not editing).

7. **Drag is rAF-throttled** with an immediate final flush on
   pointerup/cancel, so e2e geometry assertions land on exact values.
   `bringToFront` runs once at drag *start* (the note under the pointer
   comes to the front, PRD "Regrouping").

8. **E2E camera math** (documented in the spec file): world (wx,wy) renders
   at screen ((wx−cam.x)·zoom, (wy−cam.y)·zoom); a note centred on the
   viewport has top-left (centre−100, centre−100). TC-31 (50%: drag
   (100,50) → world +200,+100) and TC-32 (200%: → +50,+25, drawn above the
   overlapped note) are both covered, plus TC-30 (dblclick at (400,300)),
   TC-33 (24px → 10px + fade on 1,000 pasted chars) and TC-34 (button
   creates at screen centre when panned far away).

## Story 4: non-obvious decisions

1. **Yjs incremental updates chain per client.** An update emitted by
   `doc.on('update')` encodes items relative to that client's clock. Applying
   a client's updates to a fresh doc skips any that follow a *missing* update
   from the same client: Yjs decodes them as already-known state and applies
   nothing (no error). Consequence: quarantining a log row silently drops the
   rest of that client's chain — other clients' rows still apply. TC-09
   therefore damages the *last* row (row 7), which loses only note 3's text
   while every other note loads intact.
2. **Quarantine MOVES the row.** Per the spec schema, `quarantined_updates`
   is keyed by the log row's `seq`, and the raw `data` bytes are kept
   (forensics/replay). `load()` deletes the damaged row from `updates` in the
   same transaction as the quarantine insert, so a second load is stable
   (no re-quarantine, no PK conflict).
3. **workerd SQLite limits.** BLOBs are returned as `ArrayBuffer` (wrap with
   `new Uint8Array` before Yjs). Per-SQL-value payloads above 1 MiB raise
   SQLITE_TOOBIG, so snapshots are chunked at `SNAPSHOT_CHUNK_BYTES` (512 KiB).
   `.one()` throws on zero rows (use `.toArray()[0]` for optional rows).
4. **Large payloads stay inside the DO.** Transferring multi-MB closures
   across `runInDurableObject` is unreliable; the byte-threshold test
   generates its 4.5 MB of updates inside the DO closure.
5. **`acceptWebSocket` needs no compatibility flag** in the bundled workerd
   (1.20260923.1); `ctx.getWebSockets()` / `webSocketClose` work as documented.

---

# Story 5 — Share a board with others using a link: implementation notes

## Deviations from the spec's literal text

1. **WebSocket upgrade auto-initialises boards with no tables.** The design
   says "WebSocket upgrade to an unknown id gets 404 (no socket, no tables)"
   but the `BoardRoom.fetch()` handler auto-initialises boards that have no
   tables (lazy migration, same as before story 5). This keeps the existing
   story 1–4 integration tests working without changes. The canonical
   existence check is `GET /api/boards/:id` (uses `existsReadOnly()` without
   side effects). TC-09 is updated to use the `GET` endpoint instead of the
   WebSocket upgrade.

2. **NOOP_LIMITER fallback.** The vitest pool does not support rate limiters,
   so `wrangler-test.jsonc` omits the `ratelimits` section. The worker checks
   `env.BOARD_CREATE_LIMITER ?? NOOP_LIMITER` so tests get a no-op limiter.
   TC-13 (rate-limit integration test) is skipped in the vitest pool because
   the no-op limiter never returns 429. Rate-limit logic is covered by unit
   tests (TC-01/TC-02) and E2E (TC-30).

3. **TC-11/TC-12 use direct `createBoard` calls.** The generator cannot be
   injected through the HTTP flow, so these tests call `createBoard(env, key,
   generator)` directly with a noop limiter spread into env.

4. **`createBoard` optional `generate` param.** Defaults to `newBoardId`;
   enables TC-11/TC-12 to inject deterministic generators.

5. **`canEdit` moved to `BoardPage.tsx`.** Exported from there; `ConnectionStatus.test.tsx`
   updated to import from the new location.

6. **`connectClient` no longer calls `initialize()`.** The `BoardRoom.fetch()`
   handler auto-initialises boards (see deviation 1). The `skipInit` option
   is kept for backward compatibility but is no longer needed.

7. **`LoadFailure.test.tsx` updated for story 5.** The test now sets the URL
   to `/b/<boardId>` before rendering `<App />` (router), mocks `checkBoard`
   to return `{ kind: 'exists' }`, and temporarily switches to real timers
   to let the async existence check complete (fake timers interfere with
   `setTimeout`/`setInterval` used by the async work).

8. **`wrangler-test.jsonc` created.** A separate wrangler config for the vitest
   pool that omits the `ratelimits` section. `vitest.config.ts` points to it.

9. **`seed-legacy` test hook.** Added to `test-hooks.ts` and `board-room.ts`.
   Creates the schema and inserts a dummy update without setting `created_at`,
   simulating a pre-story-5 board. Used by TC-15 (legacy board detection).

# Story 8 — Undo and redo my own changes without undoing anyone else's: implementation notes

## Deviations from the spec's literal text

1. **The undo controller is owned by `BoardPage` (the board content), not `App`.**
   The design sketch places it in `App`, but `App` is only the router; the
   live `Y.Doc` is owned by the board content. The controller is created there
   from the connected doc and destroyed on board navigation.

2. **`BoardContent` is keyed by board id (`key={boardId}`).** Navigating between
   boards unmounts/remounts the content, giving each board a fresh doc and a
   fresh undo controller (per-board undo, as the PRD requires).

3. **`undo()`/`redo()` always emit a change.** When the target of an undo has
   already been deleted by a colleague, Yjs's `UndoManager` silently drains the
   no-op stack items without firing `stack-item-popped` (its pop loop only
   reports items that actually changed the doc). The controller still emits
   after every `undo()`/`redo()` so the buttons' `canUndo`/`canRedo` stay in
   sync with the (possibly fully drained) stack.

4. **Every local write is bracketed with `boundary()` in the wiring** (create,
   nudge, delete, colour, editor open/close), mirroring the design's "one undo
   step per user action" and preventing the 500ms capture window from merging
   distinct actions into one step.

5. **The sticky text editor owns its own keyboard shortcuts.** Ctrl+Z / Ctrl+Shift+Z /
   Ctrl+Y are intercepted inside the editor (preventing the browser's native text
   undo from diverging from the board undo) and routed to the same controller.

## Test-harness notes

- **`TestPeer` does a full-state exchange on construction** (like a y-websocket
  join). Yjs incremental updates are rejected by a doc that has not seen the
  sender's clock-0 baseline ("missing earlier structs"), so each replica must
  hold the other's initial state before any incremental update flows.
- **Unit tests that rely on `vi.mock('lib0/time')` need `server.deps.inline`**
  for `yjs`/`lib0` in the vitest unit project, otherwise Vitest externalises
  the module and the mock never applies.
- **TC-08 writes its seeded text with `LOCAL_ORIGIN`** so `TestPeer` relays it
  to the peer. A null-origin write would never reach the peer replica, making
  the peer's concurrent insert land at the same position as the local text and
  leaving the merged order dependent on the (random) client ids — a flaky
  assertion.
- **`tests/e2e/helpers/seed-board.ts`** was refactored to expose `seedDoc(url,
  doc)`, `roomUrl(port, boardId)`, `mainRoomUrl(boardId)` and `MAIN_E2E_PORT`
  so the undo e2e suite can seed the shared `wrangler dev` server (port 8787)
  directly instead of the persist suite's port.

# Story 9 — Write free text anywhere on the board: implementation notes

## Deviations from the spec's literal text

1. **`getTextContent` returns `string`, not `Y.Text`.**
   The design contract says `getTextContent(doc, id): Y.Text | undefined`,
   but the implementation returns the content as a `string` (more practical
   for most callers). A separate `getTextYText(doc, id): Y.Text | undefined`
   is provided for callers that need the live Y.Text (the editor).

2. **`createText` returns `string` (empty string on failure), not `string | null`.**
   The design says `createText(...) → string | null`, but the implementation
   returns an empty string `''` for the non-finite point error path. Callers
   check `if (id)` which works for both `''` and `null`.

3. **`setTextWidthFixed` requires an `anchorX` parameter.**
   The design contract shows `setTextWidthFixed(doc, id, width)`, but the
   implementation needs an `anchorX` to determine which edge stays fixed when
   the width changes. The `useTransformGesture` passes the appropriate anchor
   (left edge for the e handle, right edge for the w handle).

4. **No padding in the auto-width layout.**
   TC-07 says "width = measured line + padding" but no padding constant exists
   in the named settings. The layout contract defines `width = min(longest
   hard line, TEXT_MAX_AUTO_WIDTH_WORLD)` without padding. The rendered text
   fills the box exactly (no internal padding), matching the CSS
   `white-space: pre-wrap` behaviour.

5. **`createdBy` uses a session-scoped anonymous ID.**
   Story 6 (identity) is out of scope, so `createdBy` is set to a
   `crypto.randomUUID()` generated once per client session (module-level
   constant in `text.ts`). When story 6 lands, this will be replaced with the
   real identity.

6. **`clampToLimit` in `StickyText.ts` keeps its sticky-specific default.**
   The shared `clampToLimit(next, max)` in `text-edit.ts` requires both
   arguments. `StickyText.ts` wraps it with the `STICKY_TEXT_MAX_CHARS`
   default so existing story 2 callers and tests are unchanged.

7. **Registry `Component` type uses `React.ComponentType<any>`.**
   The text object component requires a `measurer` prop that is not in
   `ObjectProps`. Using `any` for the component type avoids a complex generic
   while keeping the registry simple. The actual prop types are checked at
   the call site (BoardPage/harness).

8. **E2E tests use the toolbar button instead of the T keyboard shortcut.**
   In the e2e environment, `page.keyboard.press('t')` sometimes doesn't reach
   the `useBoardKeys` handler (focus issues). The tests use
   `page.getByRole('button', { name: 'Text (T)' }).click()` instead, which
   exercises the same code path (the `onToolChange` callback).

9. **`useTool` hook is created in BoardPage and the harness, not in a separate
   module-level store.**
   The design says `useTool(canEdit)` returns `{tool, setTool}`. The
   implementation creates the hook in the BoardPage (and the test harness)
   and passes the state down via props. This is simpler than a global store
   and avoids stale-closure issues.
