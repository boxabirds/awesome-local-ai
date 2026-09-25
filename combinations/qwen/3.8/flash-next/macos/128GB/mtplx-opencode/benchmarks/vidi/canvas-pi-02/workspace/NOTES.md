# Story 2 — sticky notes: implementation notes

Decisions, deviations from `spec/stories/002-.../design.md`, and what is deliberately
left for later stories. Nothing here changes a spec requirement; where the design
specified a shape and I used another one, the reason is below.

## What is in place

Model (framework-free, `src/shared/`):
- `board-model.ts` — `initDoc`, `createSticky`, `moveObject`, `bringToFront`,
  `setStickyColor`, `deleteObject`, `getStickyText`, `snapshot`, `LOCAL_ORIGIN`,
  `StickySnapshot`. Every accepted mutation is exactly one
  `doc.transact(fn, LOCAL_ORIGIN)`; every rejection (stale id, unknown colour,
  non-finite coordinates, already-topmost `bringToFront`) returns `false` before a
  transaction is opened, so it produces no update and no remote traffic.
- `config.ts` — `STICKY_SIZE_WORLD`, `STICKY_TEXT_MAX_CHARS`,
  `STICKY_COUNTER_THRESHOLD_CHARS`, `STICKY_FONT_*`, `DRAG_THRESHOLD_PX`,
  `STICKY_COLORS`, `DEFAULT_STICKY_COLOR`.

Client:
- `board/useBoardDoc.ts` — one `Y.Doc` per board, `objects.observeDeep` →
  memoised `snapshot` → `useSyncExternalStore`; a revision counter makes the
  snapshot identity change only when the doc changes.
- `objects/StickyText.ts` — `clampToLimit`, `counterVisible`, `applyTextDiff`
  (common prefix + common suffix, one delete and/or one insert, surrogate-pair
  safe), `fitFontSize` (integer binary search, `[MIN, MAX]`).
- `objects/StickyTextEditor.tsx` — textarea overlay, caret at end on mount,
  IME-safe (input skipped while composing, handled on `compositionend`), Escape →
  `onEnd('selected')`, outside pointerdown → `onEnd('unselected')`, no extra write
  when editing ends, counter when `counterVisible`.
- `objects/StickyNote.tsx` — the press / drag / edit state machine, rAF-throttled
  `moveObject`, one `bringToFront` per drag start.
- `objects/NoteToolbar.tsx`, `board/Toolbar.tsx` — six swatches + bin; the Sticky
  note button creates a note at the world centre of the view.
- `board/useSelection.ts` — `selectedId` / `editingId` live in React only, never in
  the Y.Doc.
- `App.tsx` — window keydown (Enter to edit, Delete/Backspace to delete, ignored
  while editing or when the focus is in a text field).

Story 6 / 13–17 hooks were skipped as instructed.

## Deviations and the reasons

1. **`StickyNote` is exported as `memo(StickyNoteView)`.** The design says
   `export function StickyNote`. With 500 notes, an un-memoised note means every
   selection change re-renders (and re-lays out) 500 text blocks. `propsAreEqual`
   compares the note snapshot by identity — `snapshot()` builds fresh objects only
   when the doc changes, and `zoom`/`selected`/`editing` change together with it —
   so a click on note 500 re-renders two notes, not 501. The props interface is
   unchanged.
2. **Drag moves are tracked on `window` for the length of the gesture.** The design
   says "pointer capture". Capture is still requested, but it is not trusted, and
   that is not theoretical: with capture on the note, Chromium released it as soon
   as another note ended up under the cursor, and the drag died halfway (found by
   the TC-32 e2e case). A note is 200 world units; one flick at 200% zoom leaves it
   within a single frame. A drag that stops tracking is a note left where nobody
   pointed, so the gesture is owned by the window from pointerdown to
   pointerup/pointercancel and the listeners are removed again when it ends (no
   per-move work while idle).
3. **`pointercancel` / lost capture freezes the note at the last position *shown***
   (TC-21): the pending frame position is dropped, not applied. `pointerup` applies
   the pending position first, so a normal drag ends exactly where the pointer was,
   not where the last frame happened to land. A `pointermove` that reports the button
   as released (the pointer left the window, so no `pointerup` was ever delivered)
   also drops the drag: the note never follows an unheld pointer.
4. **`tests/component/harness.tsx` `pointerEvent` gained a `buttons` option.** A
   synthetic event carries `buttons: 0`, which after the change above would read as
   "not held"; the sticky drag tests now say `buttons: 1` for a held drag, which is
   what a browser does. The default is unchanged, so the story-1 tests are untouched.
4. **`StickyTextEditorProps` has a `box` prop** (the contract lists
   `ytext / fontPx / onEnd`). The editor needs the text box height to decide
   whether to shrink the font; passing it in keeps the component free of layout
   constants and testable without a page.
5. **`StickyNoteProps` has `onDelete(id)`.** The contract only had
   `onSelect / onStartEdit / onEndEdit`. Deleting a note is not "editing ended";
   overloading `onEndEdit('unselected')` would make the bin button and the Delete
   key share a channel with a plain deselect.
6. **`NoteToolbar` lives inside the note element, drawn in screen space.** It is
   positioned above the note and scaled by `1/zoom`, so its on-screen size is the
   same at 35% and at 400% (TC-28 needs a clickable swatch at zoom 0.35). Keeping
   it inside the memoised note means a colour change re-renders one note, not the
   board; it is marked `data-note-ui`, and both `pointerdown` and `dblclick` on the
   note body ignore anything inside that subtree and stop propagation, so a click on
   a swatch can never start a drag, start an edit, or clear the selection.
7. **`useSelection` returns one stable object whose members are getters** (as the
   design asks). `getSelectedId()` is read at call time; `select / startEdit /
   endEdit / clear` keep their identity for the life of the board, which is why the
   viewport's listeners are bound once.
8. **`BoardViewport` gained `onSurfaceClick` / `onSurfaceDoubleClick`.** The
   viewport reports *that* a click or a double-click happened on the board surface;
   `App` decides whether it was empty space (via `isInsideNoteUi`), so the viewport
   still knows nothing about notes.
9. **Test hooks.** `window.__vidi6` keeps `setCamera` and gains `getDoc`,
   `getNotes`, `seedNote`, `removeNote`. `seedNote` goes through the model
   functions, so a test cannot seed an invalid note. Still gated on
   `import.meta.env.MODE === 'test'`; the production bundle contains no hook (the
   guard collapses at build time and only the `delete window.__vidi6` cleanup
   survives).
10. **z-order is asserted in the browser, not in jsdom.** `elementFromPoint` in
    jsdom answers with the container whatever is on top, so the stacking assertions
    (TC-32, golden path) live in e2e. The component tests assert the two things
    jsdom can see: DOM order by `z` and the raised `zIndex`.
11. **`typeText` in the component harness** writes through the native
    `HTMLTextAreaElement.prototype` value setter. React 19 keeps the current value
    on the instance, so assigning `el.value` first and dispatching `input` afterwards
    is swallowed; the native setter is what a real typing session does.
12. **Transaction counting listens to `update`, not `transact`.** Verified against
    Yjs 13.6.33: `doc.on('transact')` does not fire for
    `doc.transact(fn, origin)`, while `update` fires exactly once per transaction
    that changes state — which is the quantity the tests are about.
13. **`tests/fixtures/texts.ts`** is shared by the unit, component and e2e suites
    (one word, a three-line retro item, 1,000 characters of English prose, with a
    `prose(n)` builder for the 500-note fixture). The e2e `seedNotes` helper takes
    note *centres*, because that is how the camera helpers think; the component
    harness takes top-left corners, like the model.

## Test inventory

- Unit (node): 54 — camera 19, board-model 22 (TC-01…TC-12 + non-finite and
  schemaVersion extras), sticky-text 13 (TC-13…TC-17 + boundaries).
- Component (jsdom): 77 — StickyNote 22 (TC-18…22, 25, 35…37, drag at 200%,
  tracking once the pointer leaves the note, z-order, Tab focus),
  StickyTextEditor 8 (TC-23, 24, 26, 38, diff shape, paste clamp, counter),
  Toolbars 9 (TC-27, 28, 29 + every swatch, pan-away creation), render-cost 4,
  plus the 34 story-1 component tests.
- E2E: 20 per browser × chromium, firefox, webkit — the 12 story-1 cases still
  green, plus 8 new (TC-30 create + edit, TC-31, TC-32, TC-33, TC-34, golden path,
  500 notes).
- 500 notes measure in at 2–6 ms for a click in all three browsers (the app budget
  is one frame, 16 ms; the ceiling in the test is 25 ms because the number also
  carries the driver round trip). Seeding 500 notes takes 0.3–0.5 s.

## Left for later stories

- **`origin === 'remote'`** is supported by `applyTextDiff` and unit-tested
  directly, but nothing produces a remote transaction yet — the Yjs provider in
  story 3 will. The per-note-key rule is enforced by `deleteObject` +
  `getStickyText` rather than by the Y.Text observer, so the editor does not have
  to care which key changed.
- Nothing is persisted or replicated (stories 3/4); the board doc is a local
  `Y.Doc` created by `createBoardDoc`, which is where the provider will hang.
- No undo/redo, no sticky-note resize, no per-note rotation or shadow physics.
- Font fitting runs on mount and on text change only, as specified: the note is a
  fixed size in world units, so a window resize cannot make text overflow.
