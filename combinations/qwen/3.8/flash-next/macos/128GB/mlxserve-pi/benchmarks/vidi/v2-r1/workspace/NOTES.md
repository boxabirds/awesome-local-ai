# Notes

Deviations from `spec/stories/001-pan-and-zoom-around-an-infinite-board/` and things worth
knowing before reviewing. Nothing here changes what the story requires; each item is either
an addition, an environment workaround, or a decision the spec left open.

## Additions beyond the written contracts

1. **`BoardViewport` takes a `chrome` prop** in addition to `children`
   (`src/client/canvas/BoardViewport.tsx`). The design says `App.tsx` wires `ZoomControls`
   and `NavigationHint` to `useCamera`, but the camera is owned by the viewport that measures
   itself, so `App.tsx` cannot hold it too. Chrome is passed in and reads the camera through
   the `BoardCameraContext` / `useBoardCamera()` the viewport provides. `children` keeps its
   documented meaning (board content, rendered in world coordinates); `chrome` renders as a
   sibling of the viewport, in screen coordinates. `App.tsx` still does the wiring — it just
   does it in a small `BoardChrome` component rendered inside the provider.
2. **Two extra members on `useCamera`'s result**: `mode` (`'idle' | 'panning'`) drives
   `data-state` on the viewport and the `grab`/`grabbing` cursor, which is what the component
   and e2e tests assert for the Idle → Panning → Idle requirement; and `zoomAtPointer(point,
   factor)`, needed because Safari's `GestureEvent.scale` is an arbitrary factor rather than
   a wheel exponent. `wheel`, `beginPan`, `panMove`, `endPan`, `zoomStep`, `reset`, `camera`
   and `hasNavigated` are exactly as specified.
3. **Extra tests beyond the listed TC ids** (additions, nothing was dropped):
   `lostpointercapture` ends a drag; `deltaMode` line/page conversion; horizontal two-finger
   scroll; `metaKey` zoom; pinch clamped at `ZOOM_MAX`; keyboard shortcuts ignored without
   Ctrl/Cmd; e2e plain-wheel panning and page-not-scrolling; e2e native click on a disabled
   button; e2e zoom-at-the-far-end pointer invariance; the 1,000-case seeded property check.
4. **`wheelPixels` is exported** from `BoardViewport.tsx` so the deltaMode constants stay
   named and testable.

## Environment workarounds

5. **`wrangler.jsonc` has no Worker `main`/binding.** The design's config snippet includes a
   Worker binding, but `wrangler dev` fails when a binding names a `main` file that does not
   exist yet (the Worker arrives in story 3). It is assets-only with
   `not_found_handling = "single-page-application"`, which is the serving path the design
   asks for: `wrangler dev` serving `dist/client`.
6. **Firefox needs its own macOS sandbox switched off** in this environment
   (`playwright.config.ts`, `launchOptions.env` with `MOZ_DISABLE_*_SANDBOX=1`). Without it
   Firefox cannot launch at all here (`sandbox_init() failed with error "Operation not
   permitted"`), and every Firefox test times out after 30 s. It does not affect anything the
   tests measure.
7. **Test-mode build.** `npm run build:test` (`vite build --mode test`) is what the e2e
   webServer builds, because `window.__vidi6` is compiled out unless
   `import.meta.env.MODE === 'test'` (`src/client/canvas/testHooks.ts`). Verified: a
   production build contains no `__vidi6` string; the test build does.
8. **jsdom gaps** (component tests). jsdom has no `PointerEvent`, no
   `setPointerCapture`/`releasePointerCapture`, no `ResizeObserver` and no layout. Therefore:
   - `tests/component/helpers/events.ts` dispatches plain `Event`s with the pointer
     properties assigned (`PointerEvent` is undefined there), uses jsdom's real `WheelEvent`,
     and a plain `Event` with a `scale` property for Safari gestures.
   - `tests/component/setup.ts` installs a `ResizeObserver` stub that reports a fixed
     1280×800 viewport (matching `playwright.config.ts`) and exposes `ResizeObserverStub.resize`
     for the resize test.
   - Production code calls `setPointerCapture?.()` / `releasePointerCapture?.()`. Optional
     chaining is a no-op in real browsers and keeps jsdom from throwing.
   - No jest-dom matchers are used (not a dependency of this project); assertions are on
     `.disabled`, `textContent`, `dataset` and `style` directly.
   - **TC-13's "a grid dot moves exactly 200×100 px" cannot be measured in jsdom** (no layout
     engine). The component test asserts the equivalent through the camera projection
     (`worldToScreen` deltas) plus the world layer's `transform` string; the pixel claim is
     asserted for real in e2e TC-23 via the origin marker's bounding box.
9. **Camera updates are coalesced with `requestAnimationFrame`**, so tests must wait for the
   frame. Component tests use `vi.useFakeTimers()` and
   `act(() => vi.advanceTimersByTime(64))` (`flush()` in `BoardViewport.test.tsx`). E2E tests
   use a `settle()` helper (three nested `requestAnimationFrame`s) plus Playwright's
   auto-retrying assertions, because in headless Chromium a background rAF can lag ~60 ms;
   reading the DOM once right after an action is flaky.
10. **`@types/node`** was added (not in the design's dependency list) because
    `playwright.config.ts`/`vite.config.ts` read `process.env`, and `tsconfig.json` lists
    `"types": ["vite/client", "node"]` so `import.meta.env.MODE` typechecks.

## Commits

Tasks 3, 4 and 5 are in one commit (`tasks 3-5: ...`): `BoardViewport`, `ZoomControls` and
`NavigationHint` mount together and cannot be checked separately against the story's
"Done when". Tasks 1, 2, 6 and 7 are each their own commit, and task 1's commit is the red
phase (24 unit tests failing with `not implemented`) that task 2 turns green.

## Not done (out of scope for story 1, per the brief)

Stories 6 and 13–17 were skipped as instructed. The repo contains only story 1's surface: no
board objects (story 2), no `src/server/` (the Worker arrives in story 3), no collaboration or
presence.

---

# Story 2 — Capture ideas on sticky notes and rearrange them

Deviations from `spec/stories/002-capture-ideas-on-sticky-notes-and-rearrange-them/` and the
open decisions the design left to the implementer.

## Additions / decisions beyond the written contracts

1. **`BoardViewport` gains two optional props**: `onEmptyClick?(point)` and
   `onEmptyDoubleClick?(point)`. The design describes "click empty board clears selection" and
   "double-click empty board creates a note at that world point" but the viewport owns the
   pointer sequence (a press on empty space may become a pan), so it detects an empty press +
   release that never panned (movement `< DRAG_THRESHOLD_PX`) and reports it as a click, and
   forwards a double-click whose `event.target` is the viewport itself (not a note). A double
   click that lands on a note never reaches this (the note stops propagation and edits itself,
   TC-35).
2. **Bring-to-front happens on *select*, not only on drag start.** The design's state diagram
   puts `bringToFront` at "Drag start", but the component/PRD requirement TC-21 is *double-click
   raises its z above the other*. A double-click selects before it edits, so raising the note on
   the pointerdown that selects it satisfies both the drag-to-front and double-click-to-front
   cases with one call. A plain click therefore also raises — a superset of the required
   behaviour, not a contradiction of any test.
3. **`NoteToolbar` swatch accessible names** are `"<Colour> colour"` with the colour
   capitalised (`"Yellow colour"` … `"Violet colour"`, `aria-pressed` on the current one) and
   the bin is `"Delete note"`. The design wrote the placeholder `<Colour> colour`; the exact
   capitalisation and the `swatch-<name>` / `delete-note` test ids are the implementation's
   choice, used consistently by the tests.
4. **Toolbar / note-toolbar counter-scale.** The design asks that floating UI "does not scale
   with zoom". Notes live in the zoomed world layer; the note-toolbar wrapper applies
   `transform: scale(1/zoom)` so the toolbar renders at a constant screen size. The left
   `Toolbar` and zoom controls are screen-fixed chrome and never scale.
5. **Text vertical alignment.** PRD says "text centred". The note centres text *horizontally*
   (`text-align: center`) and top-aligns vertically, and the editor matches, so that
   `scrollHeight`/`clientHeight` remain a valid overflow test for the auto-fit and the fade
   (flex-centring would make `scrollHeight` unreliable for the clip assertion in e2e).
6. **Selection is local, not in the Y.Doc** (`useSelection`): which note *I* have selected or
   am typing into is my own view. Only note content (position, colour, text, z) is shared.

## Environment / testing notes

7. **No `test:integration` script exists in this scaffold.** The tasks file names
   `npm run test:integration`, but the project defines only `test:unit`, `test:component` and
   `test:e2e`. The full-`App` component tests (`StickyNote.test.tsx`,
   `StickyTextEditor.test.tsx`) are the integration layer (they mount the real `App` + Y.Doc +
   selection) and are run with `npm run test:component`. Nothing was dropped; the label differs.
8. **Typing in component tests uses `fireEvent.input`, not `fireEvent.change`.** The editor
   writes on React `onInput`; `change` does not fire it. Empty-result queries use
   `queryAllByTestId` (`getAllByTestId` throws on zero matches).
9. **Auto-fit shrink and the overflow fade cannot be measured in jsdom** (no layout engine), so
   the component test only asserts that a short label sits at `STICKY_FONT_MAX_PX` (it fits);
   the shrink-to-minimum + `scrollHeight > clientHeight` clip is asserted for real in the
   Chromium/WebKit e2e tests via `getComputedStyle` and `scrollHeight`.
10. **E2E text input uses `page.keyboard.insertText` for bulk/IME text** — it dispatches one
    `input` event (an IME commit equivalent) that the editor clamps to the limit; per-character
    `page.keyboard.type` is used for short phrases. Note geometry is read through
    `getBoundingClientRect` / `style.left/top` and `data-z`/`data-color`/`data-selected`.
11. **`StickyTextEditor` owns a `length` state** purely so the `n/1000` counter re-renders on
    every keystroke (the textarea is uncontrolled); it never re-reads the Y.Doc to render.

## Commits

Task 1 (config + `board-model` unit tests, red), task 2 (`board-model` + `useBoardDoc`, green),
task 3 (sticky-text unit tests, red), task 4 (`StickyText` + `StickyTextEditor`), tasks 5+6
(`StickyNote`, `NoteToolbar`, `Toolbar`, `useSelection`, `App` + `BoardViewport` wiring — these
mount together and cannot be checked against the story's "Done when" apart), task 7 (component
tests), task 8 (e2e).
