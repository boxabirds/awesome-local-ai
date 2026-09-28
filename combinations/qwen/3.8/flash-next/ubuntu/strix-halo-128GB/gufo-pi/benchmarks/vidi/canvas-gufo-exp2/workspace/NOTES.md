# Notes

Decisions and deviations for the stories built in this repository. `spec/` is
read-only, so anything that looked like a spec or story-1 problem is recorded
here instead of being "fixed" by weakening a test.

## Story 2 — sticky notes

### Board model (`src/shared/board-model.ts`)

- Schema exactly as designed: `meta: Y.Map { schemaVersion: 1 }` and
  `objects: Y.Map<id, Y.Map>` with `type, x, y, color, text: Y.Text, z, createdAt`.
  `initDoc` sets `meta.schemaVersion` only when absent, so it is idempotent.
- Rejections (`moveObject`/`deleteObject`/`setStickyColor` on a stale id, an
  unknown colour, a non-finite coordinate, `bringToFront` on the topmost note)
  return `false` **before** opening a transaction, so they emit zero `update`
  events. The unit tests assert the update count, not just the return value.
- A mutation whose value is already correct (moving a note to the position it
  already has, setting the colour it already has) is also a no-op returning
  `false`: it keeps sync traffic at zero, which story 3 relies on.
- Non-finite coordinates on `createSticky` are replaced by `0` rather than
  throwing: creation must always produce a note (the caller is a pointer
  handler), while `moveObject` rejects them outright.
- `snapshot` sorts by `(z, id)` and skips objects whose `type` it does not
  know, so a note type from a later story cannot crash the board.
- The module imports nothing from React or the DOM, so the story-4 Durable
  Object can reuse it.

### `useBoardDoc`

- One `Y.Doc` per hook instance, `initDoc` on creation, `objects.observeDeep`
  as the store subscription, `snapshot` recomputed only when the document
  changes, exposed through `useSyncExternalStore`.
- Takes an optional existing doc (`useBoardDoc(existing?: Y.Doc)`) so a story-3
  provider can hand the hook a doc it already owns; with no argument the hook
  owns a local doc. Story 6 (presence) and story 3 (provider) are not built.

### Text logic (`src/client/objects/StickyText.ts`)

- `applyTextDiff` keeps the common prefix **and** the common suffix and issues
  at most one delete plus one insert inside a single transaction. A full
  replace would clobber concurrent typing once story 3 lands.
- After the prefix/suffix scan, if the split point falls inside a surrogate
  pair the index is stepped back, so an emoji is never cut in half (covered by
  a unit test).
- `counterVisible(length)` is `length >= STICKY_TEXT_MAX_CHARS -
  STICKY_COUNTER_THRESHOLD_CHARS`, i.e. "50 characters or fewer remain"
  (TC-17: 949/950/951 → false/true/true). The counter is rendered **only while
  editing**, per the PRD ("While editing: … a small character counter appears
  only when the note is within 50 characters of the limit"). A 760-character
  note therefore overflows without showing a counter.
- `fitFontSize` binary-searches integer sizes in `[10, 24]` against
  `scrollHeight <= box`, using a hidden mirror element (`.sticky-note-measure`)
  that carries the text but no padding and the content width of the note. It
  runs on mount and on text change only — never on zoom, because the font is in
  world units and the world layer scales it uniformly.

### Editing

- The textarea is written to `Y.Text` on every `input` event, so ending an edit
  performs no write at all and cannot lose characters (TC "edit_end"). Escape →
  `onEnd('selected')`; a `pointerdown` outside the note, captured at the
  document level (it runs before the viewport clears the selection) →
  `onEnd('unselected')`; `blur` flushes defensively.
- IME: `compositionstart` suppresses the diff, `compositionend` commits it, so
  CJK input cannot double characters.
- Caret starts at the end (`setSelectionRange(len, len)` after `focus()`);
  characters beyond the limit are dropped and the caret is put back at the end
  of the kept text; Enter is never intercepted and inserts a newline.

### Note interaction (`src/client/objects/StickyNote.tsx`)

- Press/drag state is local (`idle | pressed | dragging`), selection and
  editing live in `useSelection` and are never written to the document.
- Drag delta is divided by the camera zoom and written through
  `requestAnimationFrame` (latest value wins), `bringToFront` fires once when
  the drag crosses `DRAG_THRESHOLD_PX` (3 px; 2 px stays a click).
- **Stacking uses `zIndex` (from the note's `z`), not DOM order, and `App`
  renders the notes in a z-independent order.** This matters: `bringToFront`
  happens in the middle of a drag, and if React reorders the children the note
  element is moved, which a browser treats as removing it, which releases
  pointer capture and silently ends the drag (this is exactly what happened
  before: the note moved by one pointer step). `data-z`/`zIndex` carry the
  stacking order and the fixed chrome still paints above the notes because the
  world layer is its own stacking context. A component test guards the
  z-independent element order.
- The note's toolbar is rendered inside the note in screen space:
  `translate(...) scale(1/zoom)` with `transform-origin: 0 0`, so it stays
  208×32 px at any zoom, and is hidden while dragging or editing.
- Note text is wrapped in a `.sticky-note-text-run` span with `min-width: 0`.
  Inside a centred flex box a text item cannot shrink below the width of its
  longest unbreakable run, so a 300-character word spilled out sideways; the
  span plus `overflow-wrap: break-word` fixes it (verified in e2e with
  `scrollWidth <= clientWidth`).

### Fixtures

- `tests/fixtures/texts.ts`: a short phrase, a 3-line retro item (~120 chars)
  and `proseOfLength(n)` — real English sentences laid end to end and cut at
  exactly `n` characters, which is what a note clamped at the limit actually
  looks like (the last word may be truncated). Repeated single characters lay
  out unrealistically and would hide the font-fit behaviour the tests check.

### Test hook

- `window.__vidi6` (test build only, `import.meta.env.MODE === 'test'`) is
  extended with `getNotes()` and `deleteNote(id)` next to story 1's
  `getCamera`/`setCamera`. Both hooks merge into the same object and their
  cleanup removes only their own keys. `deleteNote` exists because TC-37 (note
  deleted mid-drag / mid-edit) has no user gesture that could cause it. The
  production bundle contains no reference to `__vidi6`.

### Fixes to story 1's e2e test (`tests/e2e/navigation.spec.ts`, TC-24)

The test failed before any story-2 change; two assertions in it were wrong, and
both were corrected rather than relaxed:

1. The second wheel event was sent **without** holding Control, so it panned
   the board instead of zooming out; the camera could never return to its
   starting position. The design (TC-24) specifies a Ctrl-held wheel, so the
   wheel is now wrapped in `keyboard.down('Control')` / `up('Control')`.
2. `expect(before.zoom).toBe(PERCENT_PER_UNIT)` compared a zoom *factor* (1)
   with a percentage (100). It now compares like with like
   (`before.zoom * PERCENT_PER_UNIT`).
3. An unused `settledCamera` import was removed so `npm run typecheck` passes.

### Environment

- Playwright runs Chromium only (`VIDI_E2E_ALL_BROWSERS=1` enables the Firefox
  and WebKit projects, which are defined in `playwright.config.ts`); this
  machine has no Firefox/WebKit launch dependencies, as noted for story 1.
- `spec/` was not modified. Stories 6 and 13–17 are out of scope, so no
  placeholder hooks for them were added.
