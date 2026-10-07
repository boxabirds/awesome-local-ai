# Story 2 — Notes

## Story 1 gaps filled to support Story 2

Story 1 (pan/zoom) was scaffolded but had no committed, runnable app. The
following were added so Story 2 has a working surface to build on:

- **Vite + TypeScript + Vitest + Playwright toolchain** (`package.json`,
  `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
  `playwright.config.ts`, `index.html`). The e2e dev server runs with
  `--mode test` so `window.__vidi6` test hooks are installed.
- **App shell** (`src/client/main.tsx`, `src/client/App.tsx`) mounting the
  board under React 19 StrictMode, plus base layout styles
  (`src/client/styles.css`).
- **Camera model and hook** (`src/client/canvas/camera.ts`,
  `useCamera.ts`) with `screenToWorld` / `worldToScreen` and the
  `--mode test` test hooks (`src/client/testHooks.ts`) that expose the
  in-memory `Y.Doc`, camera get/set, and `getNotes()` for e2e assertions.
- **BoardViewport** pan/zoom input (drag-pan, non-passive wheel, Ctrl/Cmd
  keyboard shortcuts, Safari gesture) and the world layer that hosts board
  objects; **ZoomControls**, **NavigationHint**, and the **Toolbar** (the
  Sticky note button lives here).

## Key design decisions

- **All board content lives in a `Y.Doc` from day one.** `useBoardDoc`
  owns one in-memory `Y.Doc`; story 3 will attach a network provider and
  story 4 persistence to the same document. No note data is kept in React
  state.
- **`useBoardDoc` exposes an immutable snapshot via `useSyncExternalStore`.**
  A `dirty` flag is set by `objects`-map `observeDeep`; `getSnapshot`
  recomputes the frozen array only when dirty and returns the cached array
  otherwise (satisfies the "stable reference until change" contract). On
  (re)subscribe the store is marked dirty once so a mutation that landed
  before the observer attached is still picked up.
- **DOM order is independent of stacking z.** `snapshot()` returns notes
  sorted by z (asserted by unit tests), but `App` renders them in a stable
  id order and each note uses CSS `z-index`. Coupling DOM order to z would
  make React *move* the dragged note's element when `bringToFront` raises
  its z, which drops the active pointer capture and aborts the drag
  (this was a real e2e failure at 200% zoom).
- **`createSticky` centres the note on the world point** (top-left =
  point − `STICKY_SIZE_WORLD`/2), so a double-click creates the note
  centred exactly under the cursor at any zoom.
- **Text editing uses a minimal Y.Text diff** (common prefix/suffix,
  code-point safe) and clamps to the length limit; font auto-fits to the
  largest size that fits, clamped to a minimum, with a bottom fade when
  overflowing.
- **Pointer interactions are idempotent and unmount-safe**: drags
  no-op if the note is removed mid-gesture, and scheduled rAF moves are
  cancelled on unmount.

## Environment notes (test reliability)

- **jsdom (Vitest) has no `PointerEvent` or `ResizeObserver`.** The
  component test setup polyfills both (`tests/setup/component.ts`).
- **Yjs `Y.Text` must be doc-backed in unit tests**; a standalone
  `new Y.Text()` does not behave like a type attached to a document.
  Helpers build text through a real `Y.Doc`.
- **E2E module-transform pre-warm.** The first page load of a Playwright
  run triggers on-demand Vite transforms for the whole module graph, which
  on a loaded machine can push the first render past the test timeout and
  flake the suite. `tests/e2e/global-setup.ts` fetches every source module
  through the dev server before tests run; `beforeEach` also waits for
  `#board-root` to be visible before any interaction.
- **Ports 28432–28447** are reserved for this task; the e2e web server uses
  28432.

# Story 5 — Notes

Story 1 gaps filled: none were needed for this story (the only pre-existing
gaps were already closed in stories 2–4).

## Key design decisions

- **Boards must exist before a link opens them.** `POST /api/boards` mints a
  22-char id (`src/shared/board-id.ts`: URL-safe alphabet, 128 bits of
  randomness, collision check) and calls the room's `initialize()` RPC,
  which stamps `storage_meta.created_at` in DO SQLite. `GET /api/boards/:id`
  and the WS upgrade gate both use `BoardStore.existsReadOnly()` — a pure
  read of `sqlite_master` + row counts that never creates tables, so
  probing a mistyped link leaves no storage behind.
- **Lazy, idempotent migration.** `BoardStore.migrate()` no longer runs at
  construction; it runs from `initialize()` and lazily before the first
  `append()`. `load()` treats missing tables as an empty board (reads only).
  This is what lets unknown-board probes stay side-effect free while
  existing boards (including legacy ones) keep working.
- **Legacy boards (pre-story 5).** A board with data rows but no
  `created_at` is still "existing": `existsReadOnly()` checks table names
  and row counts, not just the meta stamp. The `seed-legacy` test hook
  writes an `updates` row without the stamp to prove this path (TC-31 e2e,
  integration). The hook is special-cased in `BoardRoom.fetch` (it must
  reload the room after the write) rather than routed through
  `handleTestHook`.
- **Client routing without a router library.** `src/client/router.ts` is a
  tiny `useSyncExternalStore` over `history.pushState` + a
  `vidi6:routechange` event (cached snapshot, re-parses only when the
  pathname changes). `App` is the router shell; `HomePage` (`/`),
  `BoardPage` (`/b/:id`) and `NotFoundPage` (`/b/<malformed>` and any
  unrecognised path) are the pages.
- **Existence check with retry/backoff.** `BoardPage` runs
  `checkBoard()`; `unreachable` (network failure, not HTTP 404) retries
  with doubling backoff from `BOARD_CHECK_RETRY_BASE_MS` (1 s, capped),
  showing “Couldn't reach vidi6. Retrying…”. `not_found` goes straight to
  the not-found page. `nextBoardPageState()` is a pure, tested state
  machine; the `ready` state carries an empty `boardId` and `BoardPage`
  overwrites it with its own id (documented in `state.ts`).
- **Share link is `${origin}/b/<id>`**, built in the browser
  (`boardLink()`, `src/client/share/SharePanel.tsx`). Copy uses
  `navigator.clipboard.writeText`; on rejection or a missing clipboard API
  the panel selects the full link in a read-only input and shows
  “Press Ctrl+C (Cmd+C on Mac) to copy”. “Link copied” shows for
  `LINK_COPIED_MS` (2 s) then reverts; the timer is cleared on close so a
  reopened panel never shows a stale confirmation.
- **`<meta name="referrer" content="no-referrer">`** in `index.html`: a
  shared link must not leak the sharer's URL to the recipient's network
  requests (the board id is the only shared secret).
- **Compatibility date** bumped to `2025-06-01` in both wrangler configs
  (needed for the SQLite `sqlite_master` query used by `existsReadOnly()`
  semantics we rely on).

## Test notes

- **Component tests mock the api boundary once, in the setup file**
  (`tests/setup/component.ts` `vi.mock`s `src/client/api` with defaults);
  pages tests then `mockReset()` + re-stub per test. `renderApp()` is async
  because a board mounts after the existence-check microtask, and the
  y-websocket provider is stubbed so boards mount offline in jsdom.
- **`scripts/ensure-dist.mjs`** is the integration project's globalSetup:
  builds `dist/client` (production mode) when missing, since integration
  tests serve the Worker's static assets from `dist/`. Kept dependency-free
  and annotation-free (Vitest's .mjs parser rejects TS annotations).
- **The Vite dev plugin keeps an in-memory board map** for `/api/boards`
  (any valid id → exists) — pre-story-5 semantics are enough for the
  sticky-notes/collaboration suites; real 404s and the legacy path are
  proven against wrangler in `tests/e2e/share.spec.ts`.
- **Share e2e runs its own wrangler per test** (new config
  `playwright.share.config.ts`, script `test:e2e:share`); the main
  Playwright config ignores `share.spec.ts`. Clipboard is exercised for
  real in TC-26 (context `permissions: ['clipboard-read', 'clipboard-write']`
  + `navigator.clipboard.readText()`), blocked via `addInitScript` in TC-29.
- **Existing wrangler specs now create their boards through the API**
  (`persistence.spec.ts` TC-19/TC-20), since unknown ids no longer open.
  `sticky-notes.spec.ts` navigates to `/b/<fresh id>` instead of `/`.
- **Fake-timer component tests** (`TC-21`, `TC-22`) wrap
  `vi.advanceTimersByTimeAsync` in `act(async () => …)`; RTL's `findBy*`
  must not be used while timers are faked.
