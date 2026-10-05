# Story 7 — implementation notes

Working notes while implementing
[story 7](spec/stories/007-select-move-resize-and-delete-several-objects-at-o/prd.md).
Everything here is a candidate for a spec amendment; none of it contradicts a
test.

## Order of work

`tasks.md` lists task 2 (implement `geometry.ts` and the group operations)
before the test-writing tasks 6 and 9, so the pure layer was built and tested in
that order. The test cases themselves come from the design and the PRD, not from
the implementation.

## Decisions taken inside the design's freedom

- **`Point` lives in `src/shared/geometry.ts`** and `client/canvas/camera.ts`
  re-exports it. `geometry.ts` needs `Point` for `resizeRect`, `board-model.ts`
  needs it for `moveObjects`, and neither should import the other's layer.
- **`clampScale` returns a `Point`, not a number.** Edge handles need a
  per-axis scale, and design key decision 2 fixes the uniform case in the
  direction it was written: when the requested scale is uniform
  (`scale.x === scale.y`) the result stays uniform and is clamped to the
  *intersection* of the per-axis bounds, so the first object to reach a limit
  stops the whole selection on both axes.
- **Clamping never grows a scale.** `clampScale(0.9, …)` with an object already
  smaller than its minimum returns `1`, and `clampScale(2, …)` with an object
  already at the maximum returns `2`. A clamp pulls an illegal value back to the
  nearest legal one; it is not a target size. This is what makes a resize stop at
  the limit and *stay* there while the pointer keeps moving.
- **`resizeRect` without the aspect lock uses edge arithmetic**, not a scale
  round-trip: a drag of exactly 100 units produces exactly `x + 100` in the
  document instead of `x + 100.00000000000003`. The scale path (`resizeScale` +
  `applyResizeScale`) is used for the aspect-locked case, which has to be a scale
  anyway because it moves the anchor.
- **A plain resize cannot flip a box.** Dragging the left edge past the right
  edge stops at width 0 rather than producing a negative width.
- **`KNOWN_OBJECT_TYPES` in `board-model.ts`** is the filter behind
  `allObjectIds` / `objectsInRect` (TC-08). `registerKnownObjectType(type)` lets
  the client registry declare a type selectable when it registers its component.
  The model stays framework-free; the registry is the single place a type becomes
  both drawable and selectable, so the two cannot drift apart.
  `snapshot()` still filters on `'sticky'` exactly as story 2 left it —
  TC-12 of that story is about *rendering* unknown types.
- **`ObjectSnapshot` is the structural superset**; `StickySnapshot extends
  ObjectSnapshot`. `snapshot()` keeps returning sticky-only (see above), so every
  existing call site and test keeps its shape, and `readonly StickySnapshot[]` is
  assignable to `readonly ObjectSnapshot[]`.
- **`moveObjects` rejects the whole call** if *any* position is non-finite —
  including for an id that is not in the document. A half-applied group move
  would tear a cluster apart; refusing is cheaper than explaining.
- **`bringObjectsToFront` re-`z`-values the selection only when something
  changes**, so the gesture's raise-at-drag-start is silent for an object that is
  already on top (no sync traffic per drag).
- **`resizeObjects` writes all four fields** (`x`, `y`, `width`, `height`) of the
  target rectangle, because a group resize moves an object as well as resizing
  it. A caller that only wants a size passes the object's current `x`/`y`.

## Deviations from `design.md`

- **`useTransformGesture` attaches its `pointermove`/`pointerup` listeners to
  `window`, not to the handle element.** Design lists it under "Files to
  change"; the listener target is an implementation detail. Window listeners keep
  working when the pointer leaves the object (and jsdom can drive them with
  `fireEvent.pointerMove(document.body)`).
- **The hook returns `draggingIds` in addition to the two handlers**, so
  `StickyNote` can set `data-dragging` and hide its toolbar from the App instead
  of every object listening to the store.
- **`BoardViewport` gained `onCameraChange` and `overlay`.** `App` owns the
  gesture hook, which needs the live camera; `onViewportChange` is throttled to
  animation frames, so it is not a source App can read synchronously. The overlay
  slot keeps the selection overlay and the marquee in *screen* space (a
  `ResizeObserver` on the canvas element would be the alternative).
- **`BoardViewport` takes `onClearSelection()` and a `marquee` handle** rather than
  an `onSelect` callback: selecting an object is the object component's business
  (routed through the gesture hook), and the viewport only has to notice the two
  gestures that happen on empty space — a click that clears, and a Shift+drag that
  marquee-selects. Objects never `stopPropagation`; the viewport ignores a press
  that is not on board space (`isBoardSpace`), which lets the same event bubble to
  the window where the gesture is listening.
- **`endEdit(next?: EndEditTarget)`** keeps its optional parameter (design drops
  the parameter). Story 3's `StickyTextEditor` tests call `endEdit()` with no
  argument to mean "commit and select nothing"; making the argument required
  would only change those tests to pass `null`, which the signature still accepts.

## What the browser taught me

Three things that every component test got right and that only broke in a real
browser:

- **A click is decided by the press, not by the release.** `BoardViewport`
  cleared the selection on `pointerup` when the release target looked like board
  space. A resize handle is inside the selection overlay, so its press is *not*
  board space — but the release lands on whatever is under the pointer once the
  pointer has travelled, and a browser reports the nearest common ancestor of the
  press target and the release target, which is the viewport itself. Result: TC-33
  resized two notes and then watched its own selection vanish. The viewport now
  remembers where the press began and asks that question instead — which also says
  the right thing about a pan, a marquee and a drag that starts on a note
  (`BoardViewport.tsx`, `pressRef`; pinned by the component test "a resize that
  lets go over the board keeps the selection it is resizing", which fires the
  release on the board surface the way a browser would).
- **An 8-pixel handle needs pointer capture.** The gesture listens on `window`, so
  it survives the pointer wandering off the handle, but the *release* goes to
  whatever element is underneath at that moment. `setPointerCapture` on the handle
  keeps the whole gesture addressed to it (events still bubble to the window).
- **The bar's gap to the selection is measured in board units**, so it scales with
  the zoom while the bar itself keeps a constant screen size. That is story 2's
  rule for the note toolbar, and its e2e test
  (`the note toolbar keeps its screen size at 100% and 50%, centred above the
  note`) noticed immediately when story 7 moved the toolbar into the selection bar
  with a gap in screen pixels: the gap stopped shrinking as the board zoomed out.

## Behaviour worth knowing when reading the tests

- **`createSticky` centres the note on the point it is given**, so a note "seeded
  at (0, 0)" is stored at (-100, -100). Group-operation tests therefore assert on
  deltas (`after.x - before.x === 40`) rather than on absolute coordinates; that
  is also the more honest assertion for a move.
- **An edge handle with the aspect locked grows about the middle of the axis it
  cannot move.** Pulling the right edge of a 200 × 200 box by +40 with Shift
  produces `y: -20, height: 240`, not `y: 0, height: 240`: the box gets taller, and
  it gets taller symmetrically about its own centre. Unit test: "an edge handle
  changes one axis, or both about the middle when locked".
- **A drag of 3 px or more is a drag.** Below `DRAG_THRESHOLD_PX` a press-release
  on an object is a click: it selects, it does not move, and it does not raise.
- **A Shift+press on an object toggles it at release and never moves it**, so
  Shift+click still works on a note you cannot hit precisely.

## Not verifiable on this machine

- **Firefox and WebKit.** `playwright.config.ts` adds those two projects only when
  `E2E_ALL_BROWSERS=1`, and the story's acceptance criteria ask for TC-32 in them
  too. Running `E2E_ALL_BROWSERS=1 npx playwright test --grep TC-32
  --project=firefox --project=webkit` fails before the test starts: the host is
  missing the libraries both builds link against (`libwebp.so.7`, `libenchant-2.so.2`,
  `libGLESv2.so.2`, …). The suite was therefore run with chromium throughout, as in
  the previous stories. The selection tests use no engine-specific API: pointer
  events, `getBoundingClientRect`, `Y.Doc`.
- **The `nightly` project** (the 2000-note and long-session runs) is excluded from
  `npm run test:e2e` and was not run.
