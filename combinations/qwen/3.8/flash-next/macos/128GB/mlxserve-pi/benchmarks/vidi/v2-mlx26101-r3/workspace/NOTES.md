# vidi6 — working notes

Kept current by whoever works on the repo. Records verified commands, deviations from the
story design, and gotchas for the next story.

## Commands (all verified in this environment)

| Command | What it does |
| --- | --- |
| `npm install` | Install deps (Node 24, npm 11). |
| `npm run dev` | Vite dev server on `http://127.0.0.1:23600`. Story 1 has no server code, so no Worker is needed in dev. |
| `npm run build` | Production client build → `dist/client` with **stable** asset names (`assets/app.js`, `assets/index.css`). |
| `npm run build:test` | Same build with `MODE=test`, which compiles in the `window.__vidi6` e2e hook. Playwright's `globalSetup` runs it before any test, so a server that is already listening (and reads its assets off disk per request) serves fresh code too. |
| `npm run preview` | `wrangler dev` serving `dist/client` at `http://127.0.0.1:23612` (inspector port 23613) — the same serving path later stories use. |
| `npm run typecheck` | `tsc --noEmit` over `tsconfig.json` (client + shared), `tsconfig.worker.json` (Worker + shared, `@cloudflare/workers-types`), `tsconfig.test.json` (unit/component tests + Playwright) and `tsconfig.integration.json` (workerd tests). |
| `npm run test:unit` | 158 tests, 13 files, node environment (camera 23, board model 25, sticky text 19 + 15 concurrent, board id 6, link-code generation 5, protocol 10, room state machine 12, board store framing/queue 12+, test-hook routing 6, board API answers 9, page state machines 10, router 6, …). |
| `npm run test:component` | 128 jsdom tests (viewport input, zoom controls, hint, sticky note, sticky text editor, toolbars, connection status badge, close codes, the edit lock when a board cannot be read, the three pages and the Share panel 16). |
| `npm run test:integration` | 68 tests, 6 files, in **workerd** via `@cloudflare/vitest-pool-workers` (`SELF.fetch`, real `BoardRoom` Durable Object, real WebSockets, real Yjs, real DO SQLite). Needs `npm run build` first, because TC-06 asks the assets binding for `index.html` (and story 5's TC-32 reads the built file for the `no-referrer` meta). |
| `npm test` | All three vitest projects (unit, component, integration) in one run. |
| `npm run test:e2e` | Playwright. Builds in `globalSetup`, then starts `npx wrangler dev --ip 127.0.0.1 --port 23614 --inspector-port 23615 --var TEST_HOOKS:1` (or reuses one already listening), viewport 1280×800, **Chromium only by default** (see deviation 1). 63 tests (story 1 23, story 2 20, story 3 8, story 4 broken board 2, story 4 persistence 3, story 5 sharing 7). The two `@nightly` tests are excluded here. |
| `BROWSERS=all npm run test:e2e` (or `npm run test:e2e:all-browsers`) | Chromium + Firefox + WebKit. |
| `npm run test:e2e:nightly` | Only the `@nightly` tests (TC-29 idle connection, TC-30 capacity soak). About 2 minutes; `NIGHTLY=1` is the switch, so `NIGHTLY=1 npx playwright test -g "TC-30"` runs one of them. |
| `npm run check:no-test-hook` | Fails if a built asset contains `__vidi6` (run after `npm run build`). |
| `npm run verify` | typecheck → build → no-test-hook → unit → component → e2e(Chromium). One command for the whole gate. |

Ports in use: dev `23600`, preview `23612/23613`, e2e `23614/23615` (override with
`DEV_PORT`, `E2E_PORT`, `E2E_INSPECTOR_PORT`). The persistence tests own their server and start
looking for a free port at `49701` (`PERSIST_E2E_PORT`) — see deviation 26 for why not in the band
above.

## Deviations from `spec/stories/.../design.md`

1. **Non-Chromium Playwright projects are opt-in.** The design wants Chromium, Firefox and
   WebKit projects. All three are configured, but in this sandbox the bundled Firefox and
   WebKit binaries abort on launch (`SIGABRT` / `Abort trap: 6`; `BROWSERS=all` reproduces
   it) — an environment limit, not a product problem, so the default project list is
   Chromium only and the full matrix is one env var away. Everything the Safari/WebKit
   pinch path does is covered in jsdom with synthetic `gesturestart/gesturechange` events
   (`tests/component/BoardViewport.test.tsx`, TC-17/TC-17b).
2. **e2e runs on port 23614 (+ inspector 23615)** instead of a 3000-class port, because this
   agent may only bind 23600–23615. Story 4 found the other half of that rule: binding is allowed
   anywhere, but a *connection* to a localhost port outside 23600–23615 (and the operating system's
   ephemeral range from 49152) is refused by the sandbox itself, with `EPERM` before anything is
   answered. See deviation 26.
3. **`wrangler.jsonc` has no Worker `main` and no `ASSETS` binding.** wrangler 4 rejects
   `Cannot use assets with a binding in an assets-only Worker`. Story 3 adds `main`; that is
   when `"binding": "ASSETS"` goes back in. `dev.port` / `dev.inspector_port` are set so
   `npm run preview` also stays inside the allowed port range.
4. **Stable built asset names** (`build.rollupOptions.output.*FileNames`). With content
   hashes, a `wrangler dev` that is already running 404s on the new hashed file (it builds
   its asset list at startup). Wrangler hashes assets itself on deploy.
5. **Extra e2e files** next to the designed `tests/e2e/navigation.spec.ts`:
   `layout.spec.ts` (board fills the window, `touch-action`/`overscroll-behavior`, `grab` and
   `grabbing` cursors, wheel over the controls does nothing, drags starting on the overlay do
   nothing, controls do not scale with zoom, dot-grid alignment to world grid lines, resize
   leaves content where it is, zoom keeps the viewport centre) and `touch.spec.ts` (touch drag pans via CDP
   `Input.dispatchTouchEvent`; skipped for non-Chromium projects).
6. **Interaction tests use `fireEvent` + real DOM events; only the zoom-control clicks use
   `user-event`.** Pointer/wheel/gesture sequences need exact event objects and
   `defaultPrevented` assertions. Fake timers are limited to
   `{ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] }`: faking every timer makes
   React's scheduler spin inside `advanceTimersByTimeAsync` and the test hangs.
7. **The world layer carries a `data-camera="x,y,zoom"` attribute.** It is the readout that
   pixel-free assertions (far-travel exactness) and debugging use.
8. **The e2e test hook is `window.__vidi6.setCamera({ x?, y?, zoom? })`**, applied without
   clamping x/y (jumping 1,000,000 units away is the whole point of the fixture).
9. **`src/server/` was not created** — nothing in story 1 needs server logic.
10. **One extra named setting:** `STICKY_PADDING_WORLD` (12) sits with the other sticky
    settings in `src/shared/config.ts`. The design lists note size, colours, text limit and
    font range as product settings; the text inset is the same kind of number and the auto-fit
    needs it, so it lives in the same place instead of being hardcoded twice.
11. **`StickyNoteProps` takes `zoom`, not the whole `camera`,** and its callbacks are
    `onStartEdit(id)` / `onEndEdit(next)` (`EditEnd = 'selected' | 'unselected'`) rather
    than the design's no-arg `onStartEdit()` / `onEndEdit()`: `BoardViewport` renders the notes,
    so it needs the id back, and `App` has to know *why* editing ended to keep the selection
    rule (Escape keeps it, a click outside drops it). `zoom` is all the drag maths needs — the
    translation cancels out of a delta.
12. **The note element is not the clipping box.** `.sticky-note` has no `overflow: hidden`,
    because the colour/delete toolbar hangs above the note's top edge and would be cut away;
    the inner `.sticky-note__clip` is the box that clips text (176×176 world units, i.e.
    `STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD`). e2e assertions about clipping therefore
    look at `.sticky-note__clip`, and `noteFontSize`/`textOverflow` read the textarea while
    editing and the clip after it (a `overflow: hidden` textarea is its own scroll container,
    so the overflow never reaches the clip while typing).
13. **The note toolbar counter-scales.** It is rendered in world coordinates inside the note
    (so it moves with the note for free) from a zero-size anchor at `left: 50%; bottom: 100%`
    with `transform: translateX(-50%) scale(var(--inv-zoom))`, `--inv-zoom` being `1 / zoom`
    from React. That is what "drawn in screen space, a usable size at any zoom" means here
    (e2e TC-34c asserts the toolbar is between 10 and 60 px tall at 50%).
14. **Escape is the editor's key, Enter/Delete/Backspace are the board's.** The textarea owns
    Escape in its own `onKeyDown`; `App` listens on `window` for Enter/F2 (edit the selected
    note) and Delete/Backspace (delete it), skipping anything whose target is an editable
    element. Component tests therefore press Escape with `pressKeyIn(editor, 'Escape')` and the
    rest with `pressKey(key)` (which fires on `window`).
15. **`bringToFront` happens on `pointerdown`, not when the drag threshold is crossed**, as the
    design's Step 4.2 says. A press that only selects still raises the note; the position is
    untouched until the threshold is crossed, which is what TC-19 ("2 px is a click") is about.
16. **Extra test files** beside the designed ones: `tests/unit/board-model.test.ts`,
    `tests/unit/sticky-text.test.ts`, `tests/fixtures/texts.ts`,
    `tests/component/StickyNote.test.tsx`, `tests/component/StickyTextEditor.test.tsx`,
    `tests/component/Toolbars.test.tsx`, `tests/component/helpers/sticky.tsx`,
    `tests/e2e/sticky-notes.spec.ts`, `tests/e2e/helpers/sticky.ts`.

17. **`test:integration` names the vitest pool by file, and turns `isolatedStorage` off.**
    Two environment problems, both in `vitest.config.ts`: vitest resolves a custom pool id
    with `require`-style export conditions and `@cloudflare/vitest-pool-workers` only
    publishes `import`, so the project points at `dist/pool/index.mjs`; and the pool's
    isolated storage cannot be unrolled around a Durable Object that is still holding open
    WebSockets (it aborts the run with "Isolated storage failed … Expected .sqlite, got
    …sqlite-shm"), which is unavoidable when the subject under test *is* a board with six
    live sockets. With `isolatedStorage: false` the whole file shares one runtime, which is
    also what makes the board-isolation tests honest.
18. **No extra setting for keeping a connection alive.** The design's setting list has the
    latency budget, the capacity and the backoff ceiling, and that is what `config.ts` has.
    A `WebsocketProvider` drops a connection it has heard nothing on for 30 s
    (`messageReconnectTimeout`), which an idle board would otherwise hit; it turns out nothing
    has to be added, because y-protocols' `Awareness` renews its own local state every
    `outdatedTimeout / 2` (15 s) and the room relays awareness to *every* socket including the
    sender. Every connection therefore hears something every ~15 s, which TC-29 measures: 45 s
    of an idle board, no badge, no new socket dialled, and a change still crossing in 236 ms.
    (An earlier revision of this story added `AWARENESS_HEARTBEAT_MS` and a `setInterval` in the
    client; it was redundant with the library's own renewal and is gone.)
19. **The room speaks the sync protocol in both directions.** On every accepted connection it
    sends its own SyncStep1, so a client's SyncStep2 fills the room in. That is what makes
    TC-18 ("the room restarts") work: the first client to reconnect hands the whole document
    back to the fresh object, so nobody loses notes while one person still has the board open.
    The design puts reconnection in story 4; the room's half of it costs four lines and is the
    only way a restart can be tested without mocking.
    **Story 4 has landed, so this is no longer the only way a restarted board comes back** - the
    room reads it out of its own SQLite now (deviation 27). What the room's SyncStep1 still does
    is put into storage an update the room has never seen, which is what a room re-created under
    clients that still hold the document needs, and it is still how TC-18 is set up.
20. **`BoardRoom` hibernates its sockets** (`ctx.acceptWebSocket` + the `webSocketMessage` /
    `webSocketClose` / `webSocketError` handlers + `ctx.getWebSockets()` as the only socket list),
    as story 4's design asks. This replaces the story-3 note that said the room must *not*
    hibernate: that was true while the document lived only in memory, and story 4 is the story
    that gives it somewhere to come back from. There is no `setWebSocketAutoResponse`, because
    there is no message the runtime can answer without Yjs; what keeps an idle-but-attached
    connection alive is the awareness traffic of deviation 18. The room's own `hibernated`
    lifecycle state means "nobody is connected and nothing is in memory that is not in storage",
    and the room refuses to go to sleep while a read or a compaction is in flight.
22. **Two e2e tests are tagged `@nightly` and excluded from `npm run test:e2e`.** TC-29 waits
    45 s to outlast the provider's 30 s silence timeout, and TC-30 soaks five browsers on one
    board for a minute (about 150 rounds of editing, 200-odd notes made and deleted). Together
    they take as long again as the other 51 tests, so they are a separate command
    (`npm run test:e2e:nightly`, `NIGHTLY=1` in `playwright.config.ts` selecting on the tag)
    rather than a thing every commit waits for. Their subject — a connection that has to stay
    up while nothing happens — cannot be tested any other way.

23. **The e2e test hook grew a second method: `window.__vidi6.dropConnection()`.** It calls
    `provider.disconnect(); provider.connect()` and exists because Chromium's
    `context.setOffline(true)` does not disturb a WebSocket that is already open (see the
    gotcha below), so a test cannot make an outage with offline alone. It is compiled in only
    under `MODE=test`, behind the same `IS_TEST_MODE` guard as `setCamera`, and
    `npm run check:no-test-hook` still has to pass. Both methods register through one
    `addHook(name, hook)` in `src/client/testHooks.ts`, so adding the third one is one line and
    each one's cleanup removes only its own key.

24. **`src/worker/` instead of `src/server/`.** The story-2 notes left the door open to
    `src/server/`; the design says "Worker entry `src/worker/index.ts`" and "BoardRoom
    Durable Object `src/worker/board-room.ts`", so those two paths are used, with their own
    `tsconfig.worker.json` (`@cloudflare/workers-types`, no DOM lib) and `tsconfig.json`
    excluding `src/worker`.

25. **The damage switches are gated at run time, not at build time.** The design's
    `env.TEST_HOOKS === '1'` is kept exactly as written: `src/worker/test-hooks.ts` is compiled
    into the Worker always, and the switch is the variable, which only Playwright's
    `wrangler dev` command passes (`--var TEST_HOOKS:1` in `playwright.config.ts`).
    `wrangler.jsonc` does not define it, so `npm run dev` and a deployment have a route that
    answers "test hooks are not on" and then falls through to the assets router. Two things follow
    that are worth knowing before trusting the claim:
    - `run_worker_first` in `wrangler.jsonc` had to gain `/__test/*`, or the assets router answers
      those paths first in dev and the Worker never sees them.
    - `npm run check:no-test-hook` is *not* the check that the switches are off. It looks for
      `__vidi6` in the built **client** assets and says nothing about Worker code. What says the
      deployed configuration has no hook is the last two tests of
      `tests/integration/test-hooks.test.ts`: with the shipped `wrangler.jsonc`, a `POST`
      `/__test/boards/<id>/corrupt-snapshot` gets the assets binding's 405 and a `GET` gets the
      SPA's HTML, and the room's own door answers 404 to `/internal/test/read-again`.

26. **The persistence tests serve from the ephemeral port range** (`PERSIST_E2E_PORT`, starting
    at 49701) rather than from the 23600-band every other server here lives in. Binding is allowed
    anywhere in this sandbox, but a *connection* to a localhost port outside 23600-23615 and
    49152-65535 is refused by the sandbox itself (`EPERM`, before anything answers) - so a server
    on 23616 can be up, listening and correct while every question the test asks of it is
    unanswered. Three things in `tests/e2e/helpers/wrangler-process.ts` keep that from being a
    mystery: the free-port look-up asks `netstat -anv -p tcp`, which names the process holding a
    port (a connect says nothing when the sandbox is the one refusing), a process that dies saying
    "Address already in use" is started again on the next port, and a readiness check that is
    refused by the machine fails immediately and names the port instead of waiting three minutes.

27. **A board is stored as its own updates, and the room writes before it relays.**
    `src/worker/board-store.ts` keeps `updates(seq, data)` plus a chunked `snapshot_chunks` table,
    compacts the log into a snapshot every `COMPACTION_UPDATE_COUNT` (500) updates, and quarantines
    a damaged update row rather than failing the whole read. The room writes an update *before*
    broadcasting it (that ordering is the whole of `persist.seen_is_saved`), and reports a board it
    could not read with close code 4500 rather than serving an empty or stale document. The design's
    "damaged rows are quarantined" covers update rows only: a damaged *snapshot* cannot be skipped
    (see the gotcha below), so a snapshot that will not decode is a load failure and the person is
    told, in as many words, that the board could not be loaded.

28. **`src/client/Root.tsx` is the router shell; `App.tsx` is still the board.** The design's file
    table has `App.tsx` "renders router; story 3 redirect removed". The redirect did come out of
    `main.tsx` (which now renders `<Root/>`), but `App.tsx` was left alone on purpose: it is the
    component that owns the `Y.Doc` and the WebSocket, and `BoardPage` has to be able to show it for
    a board the address named, hold a `SharePanel` beside it, and *not* mount either of them while
    it is still asking whether the board exists. Making the board also be the router would tie the
    address to the component holding the connection, and would mean mounting a board to find out it
    is not there. `App` takes `boardId` and is told when to exist.
29. **A legacy board is made by the room, not by the test.** The design's fixtures section asks for a
    legacy board as "real Yjs updates from `tests/fixtures/boards.ts` written as `updates` rows".
    A test process cannot write into a Durable Object's SQLite from outside, and writing the rows
    with anything other than the room's own store would produce a board that looks like story 4's
    without being it. So `src/worker/test-hooks.ts` grew a fifth switch, `seed-legacy`, which takes a
    list of notes and appends them through the same `store.append` a real edit uses - and
    deliberately does not write `created_at`, which is the whole of what makes the board a legacy
    one. It is the second half of the existence rule (`created_at`, or any content at all) being
    tested rather than asserted. Like the other switches it is only a route when `TEST_HOOKS=1`,
    which only the e2e server sets.
30. **The board page gives up, and says so.** The design's board-page states are checking, ready,
    not-found and unreachable; the implementation adds a fifth, `error` ("Something went wrong" and
    a `Try again` button), reached two ways: an answer that is not an answer - a 200 whose body names
    a different board, or a status that is neither yes nor no - or six unreachable checks, which with
    the 1 s doubling schedule is about half a minute of "Retrying…". An infinite retry with no way
    out is a page that can never be right, and the PRD's "without the person reloading" is about not
    losing the thread rather than about never stopping. Every state the design names is implemented
    and tested; `error` is tested too (unit, component and e2e).
31. **`tests/e2e/share.spec.ts` has two cases beside the five the coverage table names.** One does
    the home page and the browser's Back and Forward in a real browser (the design puts TC-16 and
    TC-21 at ui-component only; history is the one thing a jsdom history object cannot vouch for).
    The other draws the line between a service that is unwell and a service that talks nonsense: a
    500 is waited out and the board arrives by itself, a 200 naming some other board is reported and
    only `Try again` moves it. Both are e2e because both are about the real request cycle.
32. **"TC-27 and TC-29 also in firefox and webkit" is blocked by deviation 1, not by these tests.**
    Story 5's `Done when` asks for those two in all three engines. They are written for any engine -
    neither uses CDP, neither needs a clipboard that works (TC-29 is the test where the clipboard
    *refuses*), neither grants a permission - and both pass in Chromium. With
    `BROWSERS=all npx playwright test tests/e2e/share.spec.ts -g "TC-27|TC-29"` the Chromium run is
    green and the other two die in `browserType.launch` (`Abort trap: 6`) before a page opens, which
    is the same sandbox limit story 1 met. Nothing in the two tests is Chromium-specific, so the full
    matrix is one env var away on a machine where those binaries start.

## Gotchas / findings for the next story

- **Coordinate contract** (everywhere): `screen = (world - camera.xy) * zoom`,
  `world = screen / zoom + camera.xy`. The world layer renders it as
  `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`. Swapping
  `scale`/`translate` shifts the world by a factor of zoom — three e2e tests fail if you do.
- **Never round `camera.x` / `camera.y`.** All pan/zoom maths stays in double precision so
  sub-pixel precision survives at 1,000,000 units out (PRD "No edges"). Only the *label*
  rounds (`zoomPercent`).
- **React attaches `wheel` as a passive listener at the root**, so `onWheel` +
  `preventDefault()` throws "Unable to preventDefault inside passive event listener". The
  board's wheel handling is a native `addEventListener('wheel', fn, { passive: false })` in
  `BoardViewport`. Keep it that way.
- **Drag vs. objects:** only elements carrying `data-board-surface` start a pan; anything
  inside `[data-board-ui]` (the overlay) is ignored by both the pan and wheel handlers.
  Story 2's sticky notes should call `stopPropagation()` on `pointerdown` to own their drag.
  `touch-action: none` (in CSS, not inline) is what stops the browser panning/zooming.
- **Pointer capture:** `setPointerCapture` on the viewport retargets later pointer events, so
  dragging continues even when the pointer is over the overlay. `onLostPointerCapture` ends
  the pan; `panningRef` (a ref, not state) is the synchronous source of truth.
- **`deltaMode` matters:** Firefox reports `DOM_LINE_NUMBER` (1) and some setups report pages
  (2). `wheelPixelScale` converts lines → `WHEEL_LINE_HEIGHT_PX` and pages → viewport height,
  otherwise panning feels 3× slower in Firefox.
- **Safari `gesture*` events** carry `scale` measured *since the gesture started*, so zoom is
  applied incrementally (`scale / lastScale`). A test that uses scales 1 → 2 → 4 cannot catch
  the difference because the clamp at 4 hides it — the component test uses 1.2 → 1.5 for that
  reason.
- **Camera updates are coalesced with rAF** (at most one render per frame), so any assertion
  on the DOM must wait a frame: `settle()` (e2e, two `requestAnimationFrame`s) or
  `flushFrames()` (component). `useCamera` also keeps `cameraRef` synchronously up to date,
  which is what makes rapid-fire events exact.
- **A window resize never moves the camera.** `useCamera` seeds the standard view from
  `resetCamera({ width: window.innerWidth, height: window.innerHeight })` at first render and
  the `ResizeObserver` size is only used for page-mode wheel deltas and the zoom-step centre.
  (PRD "Resizing the browser window does not move content relative to the top-left corner" +
  design "camera x, y is unchanged by design"; asserted by TC-07 component and the e2e resize
  test.) Because of that, jsdom component tests must emulate the window size —
  `tests/component/setup.ts` redefines `window.innerWidth/innerHeight` to 1280×800 to match the
  e2e viewport; jsdom's own 1024×768 would give a different standard view.
- **jsdom gaps:** no `ResizeObserver` (stub in `tests/component/resizeObserver.ts`, drive it
  with `setObservedSize()`), and essentially no CSS cascade/layout — element rects are 0×0,
  so pixel assertions there are impossible (the origin marker still gives a usable centre
  because it has a fixed CSS size and is centred by a counter-scale). CSS-level regressions
  belong in e2e: the e2e run caught a real one (`overscroll-behavior` was only on
  `html, body`, not `.board-viewport`) that jsdom happily reported as correct.
- **The dot grid** is a CSS `radial-gradient` background on a full-viewport layer:
  `background-size = GRID_SPACING_WORLD * zoom`, `background-position =
  mod(-camera.xy * zoom, spacing) - spacing/2` (the half-tile correction is what puts a dot
  exactly on a world grid line — `layout.spec.ts` asserts that).
- **Zoom step snapping:** `zoomStep` snaps a target zoom to the nearest `ZOOM_STEP_FACTOR^n`
  within `ZOOM_STEP_SNAP_EPSILON * max(1, snapped)` so step-in → step-out returns to the exact
  zoom it started from; labels then read 100 → 125 → 156 → 195 → 244 → 305 → 381 → 400 (the
  last one is a clamp, not a power of 1.25). The e2e test derives that sequence from the pure
  maths instead of hardcoding it.
- **Sandbox limits worth remembering:** `/tmp` is not writable (scratch files go in `.logs/`,
  which is gitignored), `ps` / `pkill` / `lsof` return nothing, so a manually started
  `wrangler dev` cannot be killed — let Playwright own the e2e port. A stale `wrangler dev`
  on the e2e port is served by `reuseExistingServer: !CI`, so if you ever change asset names,
  change the port too.
- **Story 2 addition, same subject:** `npm run verify`'s last step can therefore be served by a
  `wrangler dev` that is still holding the *production* build `npm run build` just wrote. Run
  `npm run build:test` before `npx playwright test` when a wrangler is already listening on
  23614, or point `E2E_PORT` / `E2E_INSPECTOR_PORT` at free ports inside 23600–23615 and let
  Playwright start its own server.
- **Production must stay hook-free:** `npm run check:no-test-hook` greps the built assets for
  `__vidi6`. It is part of `npm run verify`.
- **Bringing an object to the front takes your pointer capture away.** Notes (and, later,
  every object) are painted in DOM order, so `bringToFront` changes a `z` and React *moves the
  element* — and Chromium answers that with `lostpointercapture` on the first `pointermove`.
  A drag that listens only on its own element therefore ends before it starts, which is
  exactly the bug story 2 had: pressing a note that was not already on top raised its `z` and
  then never moved. jsdom cannot show this (it never fires `lostpointercapture`), so only the
  e2e run caught it. `StickyNote` now tracks `pointermove` / `pointerup` / `pointercancel` on
  `window` for the length of the press, and `lostpointercapture` is ignored while
  `event.buttons !== 0` (the pointer is still down, this is only the reorder); with the button
  released it still ends the drag, as the design's state machine asks. **Story 7 (multi-select
  drag) and story 11 (pen strokes) must do the same** if their gesture changes stacking.
- **`preventDefault` on a keydown that bubbled through a note kills the keystroke.** The note
  cancels Space so the page behind the board does not scroll; doing that unconditionally meant
  a space typed into the note's own textarea never reached the text (`First` + ` idea` came
  out as `Firstidea`). The note's `onKeyDown` returns early when `editing`, and whenever
  `event.target !== event.currentTarget`. `fireEvent.keyDown` gives back `false` when a handler
  cancelled the event, which is how the component test (TC-26b) pins both directions.
- **Notes are drawn in stacking order, so the DOM order is not stable.** Anything that happens
  around a drag looks notes up by id (`noteById`, `stateById`, `centreByIdOnScreen`,
  `toolbarById` in `tests/e2e/helpers/sticky.ts`) instead of by index; `noteIds()` and
  `waitForNote(page, n)` are for the cases where the order *is* the subject. `unchanged(state)`
  compares the fields a drag must not touch — selection is deliberately not one of them,
  because grabbing one note lets go of another.
- **Playwright 1.63 renamed the focus matcher:** it is `await expect(locator).toBeFocused()`;
  `toHaveFocus` no longer exists in the type definitions.
- **jsdom reorders DOM nodes too,** so a component test *can* lock in the stacking part of the
  fix (`TC-20c`: drag the note underneath another one), and `loseCapture(el, at, { buttons })`
  lets a test say which kind of capture loss happened.

- **lib0's `Decoder` holds `arr`, not `source`** (lib0 0.2.119). Reading the rest of a frame
  with `decoder.source.length` throws "Cannot read properties of undefined (reading
  'length')" - and because `decodeMessage` catches, every valid frame came back as
  `{ kind: 'invalid' }`, so the room closed every client with 1003 and the integration tests
  looked like a WebSocket problem. Use `decoding.readUint8Array(decoder, left)`; `arr` may be
  a view on a bigger buffer, which is why the payload has to be copied.
- **`crypto` is a global, not a `globalThis` property, in the Worker type set.**
  `@cloudflare/workers-types` declares `declare const crypto: Crypto`, so
  `globalThis.crypto` does not typecheck under `tsconfig.worker.json` even though it does
  under the DOM lib. `src/shared/board-model.ts` now reads the bare identifier behind a
  `typeof crypto === 'undefined'` guard, which both type sets accept.
- **WebSockets over `SELF.fetch` work** in `@cloudflare/vitest-pool-workers`: send
  `headers: { Upgrade: 'websocket' }`, read `response.webSocket`, `accept()` it - that is the
  whole fixture (`tests/integration/helpers/ws-client.ts`), and it speaks the same bytes as
  the browser provider. A Durable Object stub answers an upgrade the same way
  (`stub.fetch(new Request(..., { headers: { Upgrade: 'websocket' } }))`), which is how a
  fresh object instance - a restart - is reached without any mock.
- **A room that only answers is a room nobody hears.** `WebsocketProvider` closes a
  connection after `messageReconnectTimeout` (30 s) of silence; the room stays quiet on an
  idle board, so the client has to keep talking. Awareness is the cheapest thing to send:
  `awarenessProtocol.updateAwarenessState(awareness, {})`... in practice the provider's own
  `setAwarenessField`/`awareness.setLocalStateField` renewal every `AWARENESS_HEARTBEAT_MS`
  does it, and the room relays awareness to the sender too, so both ends see traffic.
- **`assets.run_worker_first` is required once the Worker exists.** With
  `not_found_handling: "single-page-application"` the assets layer would answer
  `/api/rooms/<id>` with `index.html` (200, no upgrade) and the Worker would never see the
  route. `run_worker_first: ["/api/*"]` keeps the SPA fallback for `/b/<id>` (which is what
  TC-06 needs) and gives the Worker its endpoint.
- **The installed workerd rejects the repo's `compatibility_date`** ("latest compatibility
  date supported … is 2026-03-10, but you've requested 2026-09-01") and falls back with a
  `miniflare:warn` line on every integration/e2e run. It is a warning only; DO SQLite,
  WebSockets and `nodejs_compat` all work. Do not "fix" it by lowering the date - deploy
  targets are newer than this local runtime.

- **`y-protocols/sync` swallows an undecodable Yjs update.** `readSyncMessage(decoder, encoder,
  doc, origin)` catches whatever `Y.applyUpdate` throws, `console.error`s it and returns as if
  the message had been read - so wrapping that call in try/catch never sees the failure and the
  room keeps the socket that sent garbage (TC-15 hangs on "waiting for the socket to close").
  The 5th parameter is an `errorHandler`; `src/worker/board-room.ts` passes one that records the
  error and then closes that socket with 1003. The library's own
  "Caught error while handling a Yjs update" line still appears once in the TC-15 output - that
  is y-protocols logging, not a failing test.

- **y-websocket hands you a `Blob`, not an `ArrayBuffer`, when the bytes come through a
  Durable Object.** `decodeMessage` in `src/shared/protocol.ts` reads the rest of a frame with
  `readUint8Array(decoder, left)`, which wants `arr.buffer`; a frame that arrived over a plain
  server-side WebSocket is an `ArrayBuffer` and works, and a frame that arrived through
  `connectBoardSocket` (the browser provider talking to the room) arrives as a `Blob` in workerd
  and decodes to garbage. `frameData()` in that file converts `Blob → ArrayBuffer` with
  `await blob.arrayBuffer()` first; `handleMessage` is `async` because of it. Anything else that
  reads a y-websocket frame out of a DO has the same problem.
- **`context.setOffline(true)` in Chromium does not kill a WebSocket that is already open.** It
  blocks new dials and new `fetch`es; existing sockets keep working, which makes an "offline"
  test pass without ever having been offline. A real outage in a test is two moves: drop the
  socket (`window.__vidi6.dropConnection()`) and *then* set the context offline so nothing
  reconnects. TC-27's whole sequence depends on that: `(hidden) -> Reconnecting… -> Connected ->
  (hidden)`, in 38 s with a 30 s outage (`CATCH_UP_TEST_OUTAGE_MS`) instead of the 65+ s a
  timeout-driven version took.
- **A text editor on a shared `Y.Text` must write the *diff from what it last saw*, never the
  whole value.** `applyTextDiff(ytext, next)` computes the smallest diff between the current
  document text and `next`, which is right for a single writer and destroys the other person's
  keystroke the moment two people are in the same note (their whole string wins, mine vanishes).
  `StickyTextEditor` therefore keeps a `baseline` — the text it last saw the document hold — and
  writes `textEdit(baseline, value)` through `applyLocalEdit`, so each keystroke is its own
  operation and Yjs merges both. The remote half is the other direction: on a remote
  `ytext.observe` the textarea adopts `ytext.toString()` and the caret is put back with
  `mapCaret(event.delta, selectionStart)`; changes that arrive *during* an IME composition are
  held in `pendingRef` until `compositionend` and then applied as an insertion, because replacing
  the value mid-composition throws the composition away.
- **An editor left open on a page makes the next `createStickyButton.click()` return a stale id.**
  The click goes nowhere (the open textarea has the keyboard), so `editingNoteId(page)` answers
  with the *old* note's id and a soak that counts notes made is suddenly five notes short of the
  board it is looking at — which is exactly how TC-30 reported itself broken. Any test branch
  that opens an editor and decides to do nothing has to press Escape on the way out.
- **A note that is lying under another note has a toolbar that exists and cannot be clicked.**
  Playwright waits for the element, then waits for the hit target at its centre to be itself,
  and after 10 s gives up — in a soak where people are dragging notes into each other's slots
  that is a certainty, not a flake. `isClickable(locator)` in `tests/e2e/helpers/sticky.ts`
  asks the question directly (`document.elementFromPoint` at the element's own centre) and the
  round does nothing instead of timing out. Related: reach a note's Delete / colour swatch
  through the note (`deleteNoteButtonIn`, `colourSwatchIn`), because by the time five browsers
  are running, a page-wide `getByRole('button', { name: 'Delete note' })` is not one button.
- **`reuseExistingServer` plus a build in `globalSetup` is what keeps a reused `wrangler dev`
  honest.** wrangler reads its assets off disk per request, so the server does not need
    restarting to serve new code — it needs the *build* to have happened, which is why
    `npm run build:test` moved out of `webServer.command` into `tests/e2e/global-setup.ts` (a
    reused server never runs `webServer.command`). `npm run verify` ends with `npm run build`,
    which leaves `dist/client` holding the production bundle; the next e2e run's `globalSetup`
    puts the test build back before Playwright starts clicking.
- **A room that relays awareness to the sender is what an idle connection hears.** See
  deviation 18; the measurement is in TC-29's console line, and the reason TC-29 asserts "no
    new WebSocket was dialled" rather than merely "the badge never appeared".
- **A damaged snapshot chunk cannot be read around.** Yjs cannot skip a gap in one client's clock
  chain: an update that refers to a struct the client has never seen is refused, and truncated
  bytes, random bytes and garbage bytes all fail the same way ("Unexpected end of array"). So a
  corrupt chunk 0 is a *load* failure, not a partial read, and `BoardStore.load()` fails as a whole
  rather than returning a board that looks fine and is missing something. `isHoldingContentBack(doc`
  ) is how the room tells "there is content here and I cannot read it" from "this board is empty",
  and the answer to the first is close code 4500 and one honest sentence, not an empty canvas.
  Damaged *update rows* are the case the design's quarantining applies to.
- **`<output>` has an implicit `role="status"`.** On the board page that makes three matches for
  `page.getByRole('status')` - the connection badge, the zoom readout and the navigation hint - and
  Playwright's strict mode refuses the assertion. Assert the text on
  `getByTestId('connection-status')`; where the claim is "a screen reader is told", add
  `toHaveAttribute('role', 'status')` to the same locator, which is the part worth asserting.
- **`workerd` ignores SIGTERM on macOS** and can orphan out of the process group it was started
  in, so `BoardServer.stop()` escalates to SIGKILL on the group and then on the pids `netstat`
  names for its ports. Interrupting a persistence run leaves `wrangler` parents that respawn their
  `workerd`, which is why the ports of an interrupted run look unkillable from the outside: stop
  the parent, or let `findAPort` move on (deviation 26).
- **y-websocket 3.1.0 retries every close code outside 4400-4499.** 4500 is "try again later" and
  is retried, which is what lets a board that could not be read come back by itself - TC-24
  measures that at ~6.5 s, of which 5 s is the room's own `LOAD_RETRY_MIN_INTERVAL_MS` throttle and
  the rest is the client's backoff. `connectBoard`'s `connection-close` handler returns early while
  the state is `load_failed`, so "Reconnecting…" never contradicts the red message while a retry is
  in flight.
- **`Uncaught Error: Network connection lost.` in the dev server's log is the runtime, not the
  app.** workerd raises it itself when the other end of a WebSocket goes away, so it appears whenever a
  browser hangs up - story 3's `dropConnection()` and story 4's refusal of a connection to a board it
  cannot read (close code 4500) both leave it in the log several times in a run, once per retry. The
  room's `webSocketError` handler is a deliberate no-op: the socket is already out of
  `ctx.getWebSockets()`, and there is nothing the room can do about a connection that has ended. Do
  not write a test that fails on it.
- **A board of 2000 notes is drawn in 6-8 s on this machine.** TC-21 reports the number instead of
  asserting `BOARD_LOAD_BUDGET_MS` (3000), because the model, the browser and the server are all
  one machine here: the board *is* complete and byte-for-byte what was written, and it is the
  drawing that is slow. Nothing in storage is at fault - the read is measured in the store's own
  tests - and a story that wants the budget enforced should measure a served board on hardware that
  is not also running the writer.
- **`vi.useFakeTimers()` does not take over `setTimeout` when the jsdom setup has already faked a
  clock** (found the hard way in story 5). `tests/component/setup.ts` calls
  `vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })` at file scope; a
  test that then calls `vi.useFakeTimers()` on top of it gets a *second* clock, and the module under
  test keeps arming timers on the first one. The symptom is bizarre: `vi.getTimerCount()` says 0, and
  `vi.advanceTimersByTimeAsync(1000)` returns instantly having done nothing, so a retry test passes
  without ever having retried. The fix is to put the real clock back first - see `takeTheClock()` in
  `tests/component/pages.test.tsx`, which is `vi.useRealTimers(); vi.useFakeTimers();`. Any component
  test that waits on a timer needs it.
- **Every e2e board has to be asked for now.** A room that somebody connects to is not a board:
  `/api/rooms/:id` answers 404 unless the board was created, so a test that writes an id down and
  opens it gets the "Board not found" page. Use `openBoard(page)` (home page, one click, returns the
  id out of the address bar) or `createBoard(request)` for a board nobody is looking at yet;
  `Cast.open` / `Cast.openAt` do the latter themselves, which is why every story 3 and 4 test went on
  passing unchanged. The one legitimate way to have a board that was *not* created is the
  `seed-legacy` test switch, whose notes are written by the room's own store.
- **The colours on the wire are the model's names, not hex.** `isStickyColor` asks whether the value
  is a key of `STICKY_COLORS`, so a note's `color` is `'yellow'`, `'blue'`, and the hex
  (`#FFF59D`) is what the renderer turns it into. `legacyNotesIn` refuses anything else, and it
  refuses with the reason in the body - so print the body of a refused test switch before guessing
  (`expect(response.status(), JSON.stringify(await response.json())).toBe(200)` is worth copying into
  any switch-calling test).
- **`openBoardAt(page, boardId)` takes an id, not a path.** Handing it a `/b/<id>` string navigates to
  `/b/%2Fb%2F<id>` - the server 307s the doubled path, the app loads, and the page says "Board not
  found" for a board that exists, which reads like a bug in the existence rule and is a bug in the
  test. When what you have is a link someone copied, `page.goto(link)` it and assert the id afterwards
  with `boardIdOf(page)`; that also asserts the thing you actually care about, which is that the
  copied text is a working address.
- **A real clipboard in Playwright needs two permissions and a focused document.**
  `context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })` (the `origin` is
  required by Chromium, and `browser.newContext({ permissions })` alone is not enough here); writing
  then works, and `navigator.clipboard.readText()` is how a test reads back what a copy actually put
  there - which is a stronger assertion than reading the field the panel displayed. To *refuse* the
  clipboard, replace the one method in an `addInitScript`:
  `Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText:
  () => Promise.reject(...) } })`; `navigator.clipboard` lives on `Navigator.prototype`, so it has to
  be defined on the instance, and `value: undefined` is how you test "this browser has no clipboard".
- **A board page's own check is a `fetch` to `/api/boards/<id>`, so `page.route('**/api/boards/*')`
  is the way to make a service that cannot be reached** - and `context.request` goes *past* that
  interception, which is what lets a test create the board it is about to lose contact with. Note the
  distinction the routes have to keep: `route.abort()` is a request that never arrives (the page says
  "Couldn't reach vidi6. Retrying…" and asks again), `route.fulfill({ status: 500 })` is the same
  news, and a 200 that names a different board is a different thing entirely.

## Where the next stories plug in

- `src/client/board/useBoardDoc.ts` owns the `Y.Doc` (one per mounted board, `initDoc` makes
  sure the `objects` map exists) and `useBoardDoc().notes` gives the render list, sorted by
  `(z, id)`, through `useSyncExternalStore` with a `observeDeep` store. A network provider only
  has to attach to that document — nothing in the rendering path changes, and story 3 proved it:
  `connectBoard` attaches and no component below `App` knows the difference.
- Every mutation in `src/shared/board-model.ts` is exactly one `doc.transact(fn,
  LOCAL_ORIGIN)` (a `unique symbol`), so an update can be told apart from an echo: story 8's undo
  groups by it. Rejected operations leave no transaction at all.
- Text lives in a `Y.Text` per note (`getStickyText`). `applyTextDiff` writes the smallest diff
  (still the right tool for a whole-value replace from a test or a model operation); a *typing*
  person goes through `applyLocalEdit` with a baseline instead — see the gotcha above.
- `src/worker/` is now five files, and they divide the work in a way later stories should keep:
  `board-store.ts` owns the rows (`updates`, `snapshot_chunks`, chunking, compaction, the
  quarantine) and knows nothing about sockets; `board-room.ts` decides when they are written and
  what a failure means; `room-state.ts` is the state machine of the *serving* states (`ready`,
  `load-failed`, `storage-failed`) plus the transient ones the room keeps for itself (`loading`,
  `compacting`, `hibernated`) - every edge is enumerated in `tests/unit/worker/room-state.test.ts`,
  so adding one is a deliberate act; `store-faults.ts` is how a test makes storage fail on one
  named board; `test-hooks.ts` is how a test damages a board that is really stored. A story that
  needs "the service lost its memory" should reuse `BoardServer`
  (`tests/e2e/helpers/wrangler-process.ts`) rather than starting a dev server of its own.
- `MAX_CONCURRENT_EDITORS` is still *reported*, not enforced: nothing in the room turns a sixth
  socket away, and TC-30's soak is what says five browsers on one board is fine. Story 12's
  capacity work is where enforcement belongs, if it comes to that.
- The client's `ConnectionState` has a `load_failed` member, and `canEdit(state)` in `App.tsx` is
  the one place that decides whether an edit is allowed. The edit lock in `Toolbar` and `StickyNote`
  is a prop that defaults to `true`, so anything new that can edit a board takes the same prop
  rather than reading the connection state for itself.
- `useSelection` stays local UI state. The provider's awareness carries who is on the board and
  is relayed verbatim by the room; story 6's presence/cursors should read it from
  `provider.awareness` rather than invent a second channel, and must not put selection in it.
- `tests/e2e/helpers/participants.ts` is the multi-client fixture now: `Cast.open(browser,
  ...names)` for one page per person with console watching (`person.problems`),
  `waitForSameBoard` / `boardJson` / `faces` for "the whole room agrees", `loseConnection` /
  `restoreConnection` for an outage, `stayShowing(page, text, ms)` for "the badge never
  flickered", and `logScenario` / `logLatency` for the numbers the nightly tests print. Adding a
  sixth person is `Cast.open(browser, ...NAMES)` — `NAMES` has six. Story 4 added two things beside
  it: `Cast.openAt(at, browser, ...names)`, which opens pages against a server whose port was only
  known at run time (every context is given its `baseURL`), and `RoomClient` / `seedBoard` in
  `tests/e2e/helpers/room-client.ts`, which put notes on a board from Node over the room's own sync
  path - what TC-21's 2000 notes are written with, because doing it through 2000 `page.evaluate`
  calls would measure the test runner. Story 5 changed one thing about it and added one: a `Cast`
  asks the service for its board (`createBoard` on a throwaway context's request) instead of writing
  an id down, because a Cast that invented its board would now be a Cast of people standing outside
  a 404; and `tests/e2e/helpers/board.ts` is where a board is *born* in a test - `openBoard(page)`
  returns the id the address bar ended up with, `createBoard(request)` makes one nobody is looking at,
  `boardIdOf(page)` reads one back, and `linkFor(origin, id)` is the link a person would be sent.
- **The client has a router, and it is the smallest thing that could work.**
  `src/client/router.ts` knows `/` and `/b/:id` and nothing else; `useRoute()` is a
  `useSyncExternalStore` over `popstate`, and `navigateTo(path)` is the only way anything in the client
  changes the address. A story that wants a new page - story 15's dashboard is the obvious one - adds
  a member to `Route`, a case to `routeOf` and a component in `Root.tsx`; it does not add a second
  router, a history library or a query string. `boardPath(id)` is what an address is built from - in
  the client (`BoardPage`'s share link) and in the tests (`linkFor`) - so a link is never assembled by
  hand.
- **`src/client/api.ts` is the only place that asks the service about a board.** It answers two
  questions and returns one of four named answers (`found`, `not-found`, `unreachable`, `failed`) for
  the second one; the pages are built out of those names and never look at a `Response`. A story that
  needs a third question - renaming a board, listing mine - adds a method to `BoardApi` and an outcome
  type here, plus `apiWith` / `apiAnswering` cases in the component tests, which is where every page
  state gets exercised without a server. `apiAnswering([...])` hands out answers in order and ignores
  the URL, which is deliberate: a page that asked twice when the test said once fails loudly.
- **A board's page is `BoardPage`, and it owns the question "is this here?".** It asks, shows one of
  five states, retries on the schedule in `src/client/pages/state.ts`, and only then mounts `App` (the
  board, and its WebSocket) with `key={boardId}` plus the `SharePanel` beside it. Anything new that
  has to know whether a board exists - story 14's sign-in, story 15's dashboard - goes through that
  state machine rather than fetching alongside it, because the dangerous answer in this product is
  "not found" said too early. The two state machines (`pageAfter`, `homeAfter`) and the retry schedule
  (`retryDelayFor`) are pure and unit-tested in `tests/unit/pages-state.test.ts`, so a change to them
  is a change to a test table first.
