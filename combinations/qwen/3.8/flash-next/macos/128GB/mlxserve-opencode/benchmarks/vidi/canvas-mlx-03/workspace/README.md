# vidi6

A shared board for thinking together.

## Story 2 — sticky notes (implementation notes)

Adds sticky notes backed by a **Yjs** document (`yjs`, installed as a dependency).
Board state lives in `src/shared/board-model.ts`: a `Y.Map` named `objects` keyed
by object id, each entry a `Y.Map` of `{ id, type, x, y, z, color, text: Y.Text,
updatedAt }`. `zIndex` and `opacity` are not stored — zIndex is the field and
opacity is fixed.

Files added: `src/shared/board-model.ts`, `src/client/board/{useBoardDoc,
useSelection,Toolbar}.ts(x)`, `src/client/objects/{StickyText,StickyNote,
StickyTextEditor,NoteToolbar}.tsx`, and tests under `tests/`.

Two decisions worth calling out:

- **Drag uses window-level pointer listeners, not pointer capture.** Raising a
  note to the front (the drag-start rule) changes its `z`, which re-sorts the
  notes and moves the note's DOM node; moving a captured element drops pointer
  capture and would abort the drag mid-gesture (only observable with two or more
  notes). `StickyNote` therefore adds `pointermove` / `pointerup` /
  `pointercancel` listeners on `window` for the duration of the drag. It still
  `stopPropagation()`s on the note so the board never pans. Everything else
  follows design.md.
- **Text edits use a minimal diff.** `StickyText.applyTextDiff` computes the
  common prefix/suffix (surrogate-pair safe) and issues the smallest
  delete/insert pair on the `Y.Text`, so a single keystroke becomes a minimal
  CRDT delta rather than a rewrite.

## Running the tests

- `npm run test:unit` and `npm run test:component` — Node/jsdom (vitest).
- `npx playwright test --project=chromium` — the browser e2e suite (and
  `--project=webkit`).

> Note: Firefox's nested OS sandbox cannot start inside some sandboxed macOS CI
> hosts (`sandbox_init() … Operation not permitted`). The Firefox Playwright
> project sets `MOZ_DISABLE_CONTENT_SANDBOX` / `MOZ_DISABLE_GPU_SANDBOX` in its
> `launchOptions.env` so the suite runs there too; these are behaviour-neutral
> for these tests and ignored on hosts that permit the sandbox. All three
> projects (chromium, webkit, firefox) then pass.

