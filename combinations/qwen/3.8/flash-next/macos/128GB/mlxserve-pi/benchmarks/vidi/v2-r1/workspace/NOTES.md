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

---

# Story 7 — Select, move, resize and delete several objects at once

Deviations from `spec/stories/007-select-move-resize-and-delete-several-objects-at-o/`
and the open decisions the design left to the implementer. Nothing here drops a test or
weakens a requirement: 307 unit/component tests and 7 new e2e tests are additions.

## Model and geometry (`src/shared`)

1. **`readObject` returns the whole object, `snapshot()` is a filter over it.** The design
   lists `snapshotObjects(doc)` next to the story 2 `snapshot(doc)`; keeping two readers
   would mean two places to get a field wrong. `readObject` now returns
   `BoardObject = StickySnapshot | ObjectSnapshot` (sticky text/colour included),
   `readableObjects` returns them in draw order, and
   `snapshot(doc) = readableObjects(doc).filter(isStickySnapshot)`. The story 2
   `ReadableObject` interface is gone; `data-*` attributes on a note are read from the
   sticky half of the union. `toEqual` in the story 2 tests still passes because the extra
   fields are `undefined` for non-stickies and `toEqual` ignores those.
2. **Story 2's single-object functions are wrappers**: `moveObject(doc, id, x, y)` is
   `moveObjects(doc, [id], …) > 0`, `bringToFront(doc, id)` is
   `bringObjectsToFront(doc, [id]) > 0`. One implementation of "move" and "raise".
3. **`bringObjectsToFront` raises in one transaction, keeping relative order**: it takes the
   top unselected object's `z + 1, +2, …`, and returns 0 (no transaction, so no remote echo)
   when the selection is already on top.
4. **`resizeObjects` clamps per object**, to `[objectMinSize(type), MAX_OBJECT_SIZE_WORLD]`,
   so one object reaching its floor cannot stop the rest of the group.
   `resizeSelection` composes the box-level scale (`askedResizeScale` → `clampScale` →
   `scaleRectByFactor` → `scaleWithin`) and hands the resulting map to `resizeObjects`.
5. **`askedResizeScale` is exported separately** from `resizeRect`, because the gesture has
   to know the scale it is *being asked* for before `clampScale` can judge it (a handle
   dragged 3× past the maximum should land at the maximum, not overshoot and come back).
   `resizeRect(start, handle, delta, aspectLocked)` stays the one-call version.
6. **Type registration is split in two**, because `src/shared` is compiled for the Worker
   with no DOM lib: `registerObjectTypeModel(type, minSize?)` (data only, used by
   `board-model` to decide what is readable and how small it may go) and
   `registerObjectType(type, spec)` (React component + per-type resize rules, client only).
   `MAX_OBJECT_SIZE_WORLD` is one global ceiling, as the design wrote it; the floor is
   per type (`STICKY_MIN_SIZE_WORLD = 50`, the test box's is 10).
7. **Nudge steps are world units**, not screen pixels: `NUDGE_STEP_WORLD = 1`,
   `NUDGE_LARGE_STEP_WORLD = 10` (Shift). At 400% a nudge is 40 screen pixels; at 25% it is
   a quarter of one. That is what "the object moves" means on a zoomed board — a fixed pixel
   step would move objects at different speeds depending on how far you are zoomed out.

## Client wiring

8. **`useSelection` does not drop actions for absent ids; it prunes instead.** The design says
   "actions referring to absent ids are ignored". A guard that checks ids against the
   *snapshot captured at render time* is wrong in one case that matters: double-click
   creates a note and selects it in the same event handler, and the snapshot has not been
   recomputed yet — the note would be created and never selected. Instead every action is
   applied, and an effect dispatches `{type: 'prune', presentIds}` whenever the set of
   present ids changes, which is what actually implements the two requirements the guard
   was for: a deleted object leaves the selection (TC-15, e2e TC-35) and no ghost id is
   ever in `selection.ids` by the time anything reads it. `selection.ids` is only ever read
   after a render, and the prune runs before that.
9. **Raise-on-press only for a lone selection.** Story 2 raised a note on every press that
   selected it. With groups, raising a note that is one of six selected would drag it out
   from under the group's own box. So `onObjectPointerDown` raises when the press leaves
   exactly one object selected and Shift was not held. Double-click-to-front (story 2
   TC-21) still holds: that press selects one note.
10. **Shift-click toggles** (`selection.toggle`) rather than "click with add", which is the
    only way a second Shift-press can *remove* (TC-13/TC-14). A Shift-press never raises.
11. **The marquee is additive** (design: "objects already selected stay selected"). The e2e
    tests that count what a box takes press Escape first, because a note left over from
    creating it is already in the selection and the box keeps it.
12. **`canEdit` is checked once, at the top of the key handler**, and a read-only board gets
    no marquee at all (`Board` passes `undefined` for the viewport's `marquee` handlers). The
    design gated each branch separately; a board nobody may edit has no selection to
    select, move or delete, so gating the whole handler is the same rule stated once. The
    `Toolbar`'s `disabled` prop is unchanged.
13. **`SelectionBar` shows a count only when a count is the useful thing**: with exactly one
    sticky note selected it holds that note's own tools (`NoteToolbar`, unchanged markup and
    test id), with anything else it holds `N selected` (`aria-live="polite"`) and `Delete`
    (`aria-label="Delete selection"`). So there is no `"1 selected"` text for a note — the
    note's toolbar is a better description of one note than the number 1 is, and story 2's
    toolbar tests keep passing untouched. `selection-count` is absent, not empty, in that
    case; the e2e tests assert that.
14. **Local constants in `SelectionBar`, not new config**: `TOOLBAR_WIDTH_PX`, `BAR_WIDTH_PX`,
    `BAR_HEIGHT_PX`, `EDGE_INSET_PX`. The design's config list did not include them, and
    they are the bar's own layout, not board behaviour. `MIN_SELECTION_BOUNDARY_PX` was
    deliberately *not* added for the same reason.
15. **The bar is clamped into the window** (max/min against the viewport size), so that a
    selection near an edge still has a Delete button a real pointer can reach — Playwright
    refuses to click anything drawn outside the viewport, which is the same physical fact a
    person has.
16. **`screenOf(rect, camera)` lives in `Marquee.tsx`** and is reused by `SelectionOverlay`:
    both draw a world rectangle in screen space, and a projection duplicated across two
    files is how the two eventually disagree.
17. **`StickyTextEditor` gained an optional `height`** (a resized note clips its text at its
    new height). It is held in a ref rather than added to the `measure` dependency list, so
    the measuring function stays the same function across a resize and the auto-fit does not
    restart on every animation frame.
18. **The gesture listens on `window`, not via pointer capture.** The design says "pointer
    capture during marquee/drag"; capture cannot be asserted in jsdom (it does not exist
    there — see story 2 note 8) and window listeners are what actually survives a pointer
    that leaves the object mid-drag. `setPointerCapture?.()` is still called where available.

## Testing

19. **A test object type, to prove the machinery is generic.** `tests/fixtures/testbox.tsx`
    registers `testbox`: resizable, *not* aspect-locked, minimum 10 units. Without it, every
    "the handles resize the selection" test would only ever prove that stickies stay square.
    `registerTestboxType()` is idempotent because the registry throws on a duplicate name.
20. **`tests/component/helpers/events.ts`** grew `shiftKey` on `PointerOptions`, accepts an
    `Element | Window` target (a drag is owned by the window, a pan and a marquee by the
    viewport element), and exports `PointerType`.
21. **e2e helpers, additive**: `NoteInfo` gained `id` (the id one screen shows is the id
    every screen shows — the only way to compare two people's boards), `createNote` returns
    the id it created, and there are `selectedCount`, `selectedIds`, `selectionText`,
    `selectAllOnBoard`, `clearSelection`, `marquee`, `marqueeCancelled`, `dragHandle`,
    `gapBetween`. `selectionBar`/`deleteSelectionButton` address the bar by test id.
22. **`tests/e2e/helpers/participants.ts`**: `recolour` and `deleteNote` now read the toolbar
    from the page (`who.page.getByTestId('note-toolbar')`) instead of from inside the note,
    because story 7 moved a note's tools into the selection bar — one bar per screen, not one
    per note. No assertions in any existing test changed.
23. **Pre-existing e2e failures, not story 7's.** `share-board.spec.ts` TC-27 and TC-28 fail
    on all three browsers and TC-26 on Chromium at the commit this story started from:
    verified with `git stash push -u` and re-running those specs on the stashed tree. The
    types' `Property 'includes' does not exist on type 'never'` error at
    `share-board.spec.ts:172` is the pre-existing `npm run typecheck` failure and is
    untouched. Everything else (136 tests) passes.

## Commits

Three: `geometry.ts` + group operations and their unit tests (TC-01…TC-10, red first);
the selection/gesture/marquee/overlay/bar/keyboard layer wired into `Board` with its unit
and component tests; this e2e layer plus the helper updates.

## Not done (out of scope, per the brief)

Stories 6 and 13–17 are not implemented, so no hooks are taken for them: the selection is
not broadcast to other people (story 6's presence would carry it), and there is no undo
(story 13) — every group edit is one Y.Doc transaction, which is the granularity undo wants.
