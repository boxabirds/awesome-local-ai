# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec left room:

- **Where `useCamera` lives.** The design gives `BoardViewport` only a `children` prop but also wants the
  viewport to measure its own size (ResizeObserver) and the zoom controls to stop wheel propagation into the
  board (TC-30). So `BoardViewport` calls `useCamera` itself and renders `ZoomControls` and `NavigationHint`
  as fixed overlays inside it. `App.tsx` just mounts `<BoardViewport />`. The controls and hint still take
  exactly the props in the design.
- **Stopping wheel propagation over the controls.** React's synthetic `onWheel` runs after the board's native
  listener, so `ZoomControls` adds its own native `wheel` listener that calls `stopPropagation` (and does not
  call `preventDefault`, so the browser default is kept there, per TC-30).
- **Initial view.** The board opens in the same view as Reset view: 100% with the origin centred.
- **Batching.** Continuous input (drag, wheel, Safari gesture) is rendered at most once per animation frame.
  Discrete actions (buttons, shortcuts, reset) render right away so the label updates as soon as the click
  happens.
- **Extra `useCamera` members.** Besides the contract, `useCamera` returns `zoomBy(point, factor)` (Safari
  gestures) and `setCamera(cam)` (only used by the test hook; it does not dismiss the hint).
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` exists only when `import.meta.env.MODE === 'test'`
  (Vitest, and `vite build --mode test`, which `npm run test:e2e` runs before Playwright). `npm run build`
  (production) does not include it — checked by grepping the bundle.
- **Grid dots** sit on world multiples of `GRID_SPACING_WORLD`, so the origin marker is on a dot. Dots fade
  once their on-screen spacing drops below `GRID_FADE_BELOW_SPACING_PX`, so a zoomed-out grid does not turn
  into a grey wash. Wheel line-mode deltas use `WHEEL_LINE_HEIGHT_PX`. Both are new settings in
  `src/shared/config.ts`.
- **Shortcuts.** Ctrl/Cmd with `=`/`+`/NumpadAdd zooms in, `-`/`_`/NumpadSubtract zooms out, `0`/Numpad0
  resets. They are handled on `window` (as the design says), but ignored when focus is in a text field, so
  later stories that add text inputs aren't affected.
- **Pan buttons.** Primary- and middle-button drags on empty board space pan.
- **Firefox in Playwright.** Firefox's own macOS sandbox can't start when the test runner is itself sandboxed,
  so the Playwright Firefox project turns it off with the `MOZ_DISABLE_*_SANDBOX` env vars and
  `security.sandbox.content.level = 0`. This only affects the test browser.
- **Red phase.** Task 1 asks for a separate commit of the failing unit tests. The instructions for this build
  ask for one commit per story, so the red phase (every test failing with "not implemented") was run but not
  committed on its own.
- **Manual checks not done here.** Real trackpad pinch in Safari, and smoothness / frame rate, are manual
  checks (design "Not covered"). The Safari gesture handler is covered by component test TC-17.

## Story 2 — Capture ideas on sticky notes and rearrange them

Decisions made where the spec left room:

- **How the board and the notes connect.** `BoardViewport` still owns the camera. It now takes `children` as a
  render function `({ camera, size }) => …` (the notes need the zoom), an `overlay` render function for fixed
  screen-space UI (the left `Toolbar`, which needs the viewport centre), and two callbacks:
  `onDoubleClickEmpty(worldPoint)` and `onEmptyClick()`. `App` calls the board model from those callbacks, so
  `BoardViewport` stays independent of the document.
- **Stacking without moving DOM nodes.** Notes are rendered in a fixed DOM order (by id) and stacked with
  `z-index` = their rank in the `(z, id)` order from `snapshot()`. The first version re-ordered DOM nodes. That
  broke dragging: when `bringToFront` moved the dragged note's node, the browser dropped pointer capture and the
  drag ended. One side effect is that Tab visits notes in id order, not stacking order.
- **Note toolbar placement.** `StickyNote` renders `NoteToolbar` (as in the structure diagram) through a portal
  into an overlay layer at the end of the world layer (`WorldOverlayContext`). That way it is drawn above every
  note. It is positioned at the note's top-centre in world units and scaled by `1 / zoom`, so it keeps its screen
  size. With no overlay (a note rendered on its own), it renders inline.
- **Ending editing.** While editing, `StickyTextEditor` listens for `pointerdown` on the document in the
  capture phase. A press outside the note calls `onEnd('unselected')` before the board, another note or a button
  handles it. Pressing another note therefore ends editing and selects that note. Blur only flushes pending
  text; it does not end editing, so switching windows doesn't close the editor.
- **Enter to edit** calls `preventDefault`, so that same Enter isn't typed as a newline into the editor it opens.
  It is ignored when focus is on a button or link, where Enter already means "activate".
- **Keyboard focus.** Notes have `tabIndex=0`. When a note gets keyboard focus (Tab), it is selected, so Enter
  and Delete work on it. A pointer press still selects on release, as the state diagram says. After Escape, focus
  goes back to the note.
- **Text limit when typing in the middle.** `clampToLimit` is the plain cut from the contract. The editor uses
  `limitEdit(prev, next)`, which cuts only the newly inserted characters. So typing into a full note drops the
  typed character and does not remove the end of the note. The caret goes to the end of the kept insertion.
  Neither function splits an emoji's surrogate pair.
- **Invalid input to the model.** `createSticky` with non-finite coordinates returns `''` and writes nothing
  (the contract returns `string` and says never throw). `moveObject` to the note's current position and
  `setStickyColor` to its current colour are no-ops: they return `false` and emit no update. `bringToFront`
  also lifts a note that only ties the highest z.
- **Snapshot identity.** `useBoardDoc` keeps unchanged notes, and the whole list when nothing changed,
  reference-equal between snapshots. `StickyNote` is memoised, so a drag re-renders only the dragged note
  (relevant to the 500-note constraint). The `objects` observer is attached only while React is subscribed.
- **Vertical centring.** Display text is centred vertically with auto margins, so overflow goes only downward
  and `scrollHeight` measures it. The textarea gets a matching `paddingTop` (from the measured text height), so
  the text doesn't jump when editing starts.
- **New named settings** in `config.ts`, besides the ones in the design: `STICKY_PADDING_WORLD` (16) and
  `STICKY_LINE_HEIGHT` (1.25).
- **Test hooks.** `installTestHooks` now merges parts into `window.__vidi6`. `App` adds `notes()` (the current
  snapshot), which the e2e tests use to read world positions. As before, test builds only.
- **Component tests** render the whole `App` on a real `Y.Doc` passed in with `<App doc={doc} />`. They fake
  only animation frames, because Testing Library's async helpers (user-event) need a real `setTimeout`.
- **Red phase.** Tasks 1 and 3 ask for separate commits of the failing tests. As in story 1, the red phase
  was run (every test failed with "not implemented") but not committed separately, because this build uses one
  commit per story.
- **Manual checks not done here.** IME input on a real keyboard (the composition guard is covered by a
  component test) and the 500-note performance run are manual, as the design's "Not covered" section says.
