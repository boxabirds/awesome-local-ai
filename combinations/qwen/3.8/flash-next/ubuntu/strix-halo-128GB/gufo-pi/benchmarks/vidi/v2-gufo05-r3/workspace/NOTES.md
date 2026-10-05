# Story 8 — implementation notes

Working notes while implementing
[story 8](spec/stories/008-undo-and-redo-my-own-changes-without-undoing-anyon/prd.md).
Everything here is a candidate for a spec amendment; none of it contradicts a
test.

## Order of work

`tasks.md` lists the controller (task 2) before the tests that describe it
(tasks 6 and 7), so the model layer was built and then tested straight away,
before any interface existed to interfere with it. Boundaries (8, 9) came next,
then the controls (10, 11), then the two-person e2e pass (5).

## Decisions taken inside the design's freedom

- **The history tracks an origin, not a person.** `Y.UndoManager` is built with
  `trackedOrigins = new Set([LOCAL_ORIGIN])`, the symbol story 1 already stamps
  on every write in `board-model.ts`. Two tabs of the same person are two
  histories; two people are two sets of transactions. That is also why the
  promise survives object types that do not exist yet (stories 9–12): a new type
  writes through the same model, so it is captured by origin and needs no
  registration anywhere.
- **`src/client/board/undo.ts` does not know React exists.** `createUndo(doc)`
  returns the controller the design asks for; the lifecycle lives in
  `useUndo.ts`. The unit tests can therefore drive a real `Y.Doc` and a real peer
  without a DOM.
- **The controller React hands out is a shell.** React (in development) mounts,
  cleans up and mounts again; a controller created at mount and destroyed at
  cleanup would be a dead object by the time the board rendered. `createUndoShell`
  is the stable façade that the toolbar, the shortcuts, the selection bar and the
  text editor all hold; the real `UndoManager` behind it lives only while the
  board is attached (`attach()` on mount, `detach()` on cleanup). Detaching is
  also what makes the history session-only (`undo.session_only`): the steps are
  simply gone, and a re-mount starts from nothing — which is the correct answer
  both for StrictMode's second mount and for switching boards.
- **The buttons read the stacks with `useSyncExternalStore`**, subscribed to the
  controller's own `stack-item-added` / `-popped` / `-cleared` events. Nothing
  polls, and a button that has just become unusable stops looking usable on the
  same tick the stack changes. `canUndo()` / `canRedo()` are the whole truth by
  then, because yjs finishes moving the item before it fires.
- **Both buttons carry `aria-disabled` as well as `disabled`** (design TC-18 names
  it). The native attribute is what keeps a click out; the ARIA one is a stable
  announcement for a screen reader that reads the button before it is pressed.
- **`Ctrl+Y` is redo; `Cmd+Y` is not.** The design says "`Ctrl+Y` (or the platform
  equivalent)". `Cmd+Y` is a system shortcut on the platform that would use it,
  and `Ctrl/Cmd+Shift+Z` already covers that keyboard, so redo answers to
  `Ctrl+Shift+Z`, `Cmd+Shift+Z` and `Ctrl+Y`.
- **Both toolbar buttons carry an icon and a name.** The design's
  `public/icons/undo.svg` + `<img>` became a glyph (↺ / ↻) in the toolbar's own
  button style: the create button beside them is a glyph too, two files would be
  two more requests for 200 bytes, and the accessible name and tooltip — which is
  what the tests and the person read — are exactly as specified.

## Behaviour worth knowing when reading the tests

- **A text-editing session is one step**, however long it lasts: `StickyTextEditor`
  closes the capture window when it mounts and again when it unmounts. Within the
  session, transactions merge while the gap between them is under
  `UNDO_CAPTURE_TIMEOUT_MS` (500 ms) and split into further steps once it is not.
  A pause of exactly 500 ms splits; 499 ms does not (unit TC-13).
- **A boundary is `stopCapturing()`, which also zeroes the manager's
  `lastChange`.** So a boundary splits a burst even with no pause at all, and two
  actions a millisecond apart are still two steps if something closed the window
  between them.
- **A drag that lifts a note to the front is one step including the lift.**
  Undoing it takes the note back to its old place *and* its old place in the pile
  (component TC-14, "undoing a drag also puts the note back in the pile it was
  in").
- **An undone delete returns the object with the `z` it had**, which can be
  underneath notes made since, and it does not come back selected: undo never
  moves the selection (a story 8 non-goal), so the selection bar just stays away.
- **Undo never recreates what a colleague deleted.** yjs only reverses the
  operations in the step that are still present; a step whose note has gone is
  consumed quietly and the rest of the history works (unit TC-07). The
  controller's `step()` also wraps the call in a `try`, because "undo must not
  break on changed objects" (`undo.safe`) is worth more than a stack-trace.
- **…and yjs does not always say that it consumed one.** `popStackItem` keeps
  pulling steps until one actually changes something; when it runs out with
  nothing performed — my move of a note that is thoroughly gone — it fires no
  `stack-item-popped` at all, even though the stack emptied. The buttons were
  left offering a step that no longer existed until `step()` grew a `notify()` in
  a `finally`. e2e TC-23 is what caught it: the unit rig reproduces the silence
  only some of the time, because whether a leftover field inside an unreachable
  note still counts as "something to change" depends on how the note was deleted.
- **An undo is an ordinary document change.** Its transaction origin is the
  `UndoManager` (yjs adds it to the tracked origins so the step lands on the redo
  stack), which is not `LOCAL_ORIGIN`, so my undo is never captured as a new
  change of mine — and it goes out over the socket like any other update, which
  is how Sam's screen shows Alex's correction (e2e, "a mistake goes back on my
  screen, and my colleague sees it go").
- **The history is capped at 200 steps and the oldest goes first**, so the oldest
  change becomes permanent (unit TC-09, e2e "the history is a setting" — where 201 colour changes
  leave the note blue instead of yellow, and the button runs out after 200).
- **The fake clock has to be running before yjs is imported.** `lib0/time` binds
  `getUnixTime` to `Date.now` at module load, so `undo-boundaries.test.ts`
  switches the clock on in `beforeAll` and only then imports `yjs`, the model and
  the controller (dynamic imports). Import order is load-bearing in that one
  file.

## Deviations from `design.md`

- **`undoBoundary` takes the controller, not the `Y.Doc`.** The design's
  `undoBoundary(doc, fn?)` would open and close a capture window with an empty
  transaction. That cannot work: yjs's `afterTransactionHandler` returns before
  looking at a transaction whose origin is not in `trackedOrigins`, so an empty
  transaction — and any transaction from a doc that does not carry this tab's
  origin — closes nothing. Only `UndoManager.stopCapturing()` ends a window,
  which is exactly what the design asks the helper to guarantee ("no other change
  can join the window"). The helper therefore takes an `UndoController` and calls
  `boundary()` on it.
- **`StickyTextEditor` reads the controller from `UndoContext`** instead of a
  prop. Object components are rendered from the registry with one fixed prop
  shape (stories 9–12 build on it), and the text editor is the only thing inside
  them that needs undo — boundaries at the start and end of editing, and the
  `Ctrl+Z` keystroke. A prop would have meant changing the contract for every
  type; a context keeps it intact and gives a sensible `null` when a component is
  rendered outside a board.
- **`onGestureStart()` runs before `bringObjectsToFront()`** in
  `useTransformGesture`. It was the other way round, which put the lift in a
  transaction of its own *before* the capture window opened, so one drag was two
  undo steps. The design asks for one drag, one step.
- **`addScope` accepts `Y.AbstractType<any>`**, the type yjs's own `addToScope`
  takes. `Y.Map<unknown>` is not assignable to `Y.AbstractType<unknown>`: yjs
  declares its observer callbacks invariantly, and story 16 needs to hand in a
  `Y.Map` of comments.

## Two tests that were failing before this story

Neither is a story 8 test, and neither is caused by story 8, but both make a run
of the full suite noisy, so they are recorded here with the evidence.

### A coin flip in a story 7 assertion

`tests/component/SelectionGroup.test.tsx > TC-19 a click on empty board space
clears the selection` failed on most runs before story 8 existed. `selectedIds()`
sorts the ids it reads out of the DOM, and that one assertion compared them in
creation order — with ids from `crypto.randomUUID()` that is a coin flip, and
every other multi-id comparison in the suite (`BoardKeys`, `MarqueeSelect`,
`TransformGesture`, and line 177 of the very same file) already calls `.sort()`.
Evidence, on commit `37f0b10` (story 7 tip, two commits before story 8's first):

```
git worktree add /tmp/base7 37f0b10
cd /tmp/base7 && for i in 1 2 3 4 5 6 7 8; do \
  npx vitest run --project component tests/component/SelectionGroup.test.tsx; done
# 3 passed, 5 failed — always the same assertion, always only the id order
```

Fixed here by adding the `.sort()` the other call sites have, because a suite that
fails on a coin flip hides everything else. Nothing in story 8 touches the
selection.

### An intermittent render loop in the persistence suite

`tests/e2e/persistence/board-survival.spec.ts > TC-19 a board comes back exactly
as it was left, after the server forgets it` fails about one run in three when
the persistence project runs as a whole, and passes on its own. The assertion
that catches it is the "nothing broke in the console" one, after the board has
already been built and checked:

```
- Array []
+ Array [
+   "Error: Minified React error #185; …",
+ ]
      133 |     expect(alex.consoleErrors).toEqual([]);
```

React error #185 is "maximum update depth exceeded" — something in the app re
-renders itself into the ground once in a while, on a board being edited, and
this is the only test in the suite that watches `consoleErrors` across a long
burst of hand-driven edits (25 notes: toolbar button, typing, Escape, colour).
It is not this story's loop: on the story 7 tip (`37f0b10`, no undo code at all)
it reproduces at the same rate or worse.

```
git worktree add /tmp/base7 37f0b10 && ln -s $PWD/node_modules /tmp/base7/node_modules
cd /tmp/base7 && npx vite build --mode test \
  && npx playwright test --project=persistence --repeat-each=8 \
       -g "a board comes back exactly as it was left"
# story 7 tip: 3 of 8 runs failed with #185
# this story:  2 of 8 runs failed with #185
```

The real message and the component stack are not available in the test build, and
reading that loop out of the camera/editor/toolbar wiring is a separate piece of
work from undo; it is left as it was found, and named here so it is not mistaken
for a story 8 regression.

## Not verifiable on this machine

- **Firefox and WebKit.** Same as story 7: `playwright.config.ts` adds those
  projects only under `E2E_ALL_BROWSERS=1`, and this host is missing the
  libraries both builds link against. Story 8's e2e uses no engine-specific API
  (pointer events, keyboard events, `Y.Doc`, two browser contexts).
- **The `nightly` project** (2000-note and long-session runs) is excluded from
  `npm run test:e2e` and was not run. A 2000-note board with a 200-step history
  is worth watching there: each step holds a yjs `StackItem`, and the cap is what
  keeps that bounded.

---

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
