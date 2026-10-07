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
