# Technical Design

Sticky notes stored in a local Yjs document (the same document stories 3-4 will sync and persist). A pure board-model module owns all mutations; React renders a snapshot via useSyncExternalStore. DOM sticky components handle select, drag, text editing (textarea diffed into Y.Text), colour and delete; text auto-fit by measurement.

## Overview

## Context
Builds on story 1 (`src/client/canvas/*`, `src/shared/config.ts`). Notes are stored in a **Yjs `Y.Doc` from day one** so that story 3 only attaches a network provider and story 4 only persists the same document. No network or storage in this story.

## Files
| Path | Change | Purpose |
|---|---|---|
| `package.json` | modified | add `yjs` dependency |
| `src/shared/config.ts` | modified | sticky settings below |
| `src/shared/board-model.ts` | added | Yjs schema + all mutations (shared by client now, by the Durable Object from story 4) |
| `src/client/board/useBoardDoc.ts` | added | owns the `Y.Doc`, exposes immutable snapshot via `useSyncExternalStore` |
| `src/client/board/useSelection.ts` | added | local selection + editing state (never stored in the doc) |
| `src/client/board/Toolbar.tsx` | added | left toolbar with Sticky note button |
| `src/client/objects/StickyNote.tsx` | added | render, select, drag, edit |
| `src/client/objects/StickyText.ts` | added | textarea→Y.Text diff, length clamp, font fit |
| `src/client/objects/NoteToolbar.tsx` | added | colour swatches + delete |
| `src/client/canvas/BoardViewport.tsx` | modified | double-click on empty space → create; empty click → clear selection; renders objects as children |
| `src/client/App.tsx` | modified | wire doc, selection, toolbars, Delete/Enter keys |

## Named settings added to `src/shared/config.ts`
```ts
export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
```

## Document schema (the future persisted and wire contract)
```
Y.Doc
  meta: Y.Map { schemaVersion: 1 }
  objects: Y.Map<string /* id */, Y.Map>
    <id>: Y.Map {
      type: 'sticky'
      x: number, y: number        // top-left, world units
      color: StickyColor
      text: Y.Text
      z: number                   // stacking; higher is on top
      createdAt: number           // epoch ms
    }
```
- Ids: `crypto.randomUUID()`.
- Stacking: `z = maxZ + 1`; render order sorts by `(z, id)` so concurrent equal `z` values (possible once story 3 syncs) still give every client the same order.
- Unknown `type` values are skipped by the renderer (forward compatibility for stories 9–12).

## Structure diagram
```mermaid
flowchart TD
    App[App.tsx] --> DocHook[useBoardDoc]
    App --> Sel[useSelection]
    App --> Tool[Toolbar]
    App --> VP[BoardViewport from story 1]
    VP --> Note[StickyNote]
    Note --> NT[NoteToolbar]
    Note --> ST[StickyText]
    DocHook --> YDoc[Y.Doc in memory]
    Tool --> Model[board-model.ts]
    VP --> Model
    Note --> Model
    NT --> Model
    ST --> Model
    Model --> YDoc
    Model --> Config[shared config.ts]
```

## State diagrams
Note lifecycle in the document (in memory only in this story; persisted from story 4):
```mermaid
stateDiagram-v2
    [*] --> Present : createSticky
    Present --> Present : moveObject or setColor or text edit or bringToFront
    Present --> [*] : deleteObject
```
Per-client interaction state for one note (never stored in the document):
```mermaid
stateDiagram-v2
    [*] --> Unselected
    Unselected --> Editing : created by dblclick or button
    Unselected --> Pressed : pointerdown on note
    Pressed --> Selected : pointerup within threshold
    Pressed --> Dragging : move beyond DRAG_THRESHOLD_PX
    Dragging --> Selected : pointerup
    Dragging --> Selected : pointercancel
    Selected --> Editing : dblclick or Enter
    Editing --> Selected : Escape
    Editing --> Unselected : click outside
    Selected --> Unselected : click empty board
    Selected --> [*] : Delete key or bin button
```

## Sequence: create note
```mermaid
sequenceDiagram
    participant U as User
    participant VP as BoardViewport or Toolbar
    participant M as board-model
    participant D as Y.Doc
    participant R as React snapshot
    alt double-click
        U->>VP: dblclick at screen point
        alt target is a note
            VP-->>U: handled by note as edit start
        else empty space
            VP->>VP: screenToWorld minus half size
        end
    else toolbar button
        U->>VP: click Sticky note
        VP->>VP: viewport centre to world
    end
    VP->>M: createSticky x y
    M->>D: transact add Y.Map with z maxZ plus 1
    D-->>R: observeDeep new snapshot
    M-->>VP: new id
    VP->>VP: select id and set editing
```

## Sequence: select and drag
```mermaid
sequenceDiagram
    participant U as User
    participant N as StickyNote
    participant M as board-model
    participant D as Y.Doc
    U->>N: pointerdown
    N->>N: stopPropagation so board does not pan
    N->>N: setPointerCapture state Pressed
    U->>N: pointermove
    alt distance under threshold
        N->>N: stay Pressed
    else beyond threshold
        N->>M: bringToFront id
        loop each animation frame while moving
            N->>M: moveObject id x y using camera zoom
            M->>D: transact set x y
        end
    end
    alt pointerup
        N->>N: Selected
    else pointercancel or lostpointercapture
        N->>N: Selected keep last position
    else note deleted meanwhile
        N->>N: moveObject returns false and drag ends
    end
```

## Sequence: edit text
```mermaid
sequenceDiagram
    participant U as User
    participant N as StickyNote
    participant T as StickyText
    participant D as Y.Doc
    U->>N: dblclick or Enter
    N->>T: mount textarea with current text caret at end
    U->>T: input event
    T->>T: clampToLimit value
    alt value longer than limit
        T->>T: truncate to STICKY_TEXT_MAX_CHARS and restore caret
    end
    T->>D: applyTextDiff common prefix and suffix
    T->>T: fitFont binary search
    alt Escape
        U->>T: keydown Escape
        T->>N: end editing Selected
    else click outside
        U->>N: pointerdown elsewhere
        N->>N: end editing Unselected
    else note deleted while editing
        T->>N: end editing no write
    end
```

## Sequence: colour and delete
```mermaid
sequenceDiagram
    participant U as User
    participant NT as NoteToolbar or keyboard
    participant M as board-model
    participant D as Y.Doc
    alt swatch click
        U->>NT: click colour
        NT->>M: setStickyColor id color
        alt unknown colour or missing id
            M-->>NT: false no change
        else valid
            M->>D: transact set color
        end
    else Delete or Backspace
        U->>NT: keydown
        alt editing text
            NT-->>U: key goes to textarea
        else selected not editing
            NT->>M: deleteObject id
            M->>D: transact delete key
        end
    else bin button
        U->>NT: click delete
        NT->>M: deleteObject id
    end
```

## Test Strategy

## Test scopes and boundaries
| Capability | Levels | Boundary | Why sufficient |
|---|---|---|---|
| board.model | unit | Inner logic against a **real** `Y.Doc` | All mutation rules live here; Yjs is deterministic in-process |
| sticky.interaction | ui-component, e2e | Components in jsdom; real browser | jsdom proves state machine and keyboard rules; layout, pointer capture and zoom-accurate drag need a real browser |
| sticky.text | unit, ui-component, e2e | Pure diff/clamp logic; textarea behaviour; real font measurement | Font fit depends on real text layout, which jsdom lacks, so fit is e2e |
| sticky.toolbar | ui-component, e2e | Toolbar + creation wiring | Simple UI, plus e2e golden path |

No request-handling boundary exists in this story (no server code), so there are no integration tests; stated deliberately.

## Dimensions crossed
- **D1 Operation**: create (dblclick / button), select, move, edit text, colour, delete.
- **D2 Prior state of target**: no notes; note Unselected; note Selected; note Editing; note already deleted (stale id).
- **D3 Zoom**: 100%, 50%, 200% (for geometry-dependent operations only).

Classes are exhaustive and non-overlapping within each dimension. The coverage table below crosses these dimensions: every row states its D1, D2 and D3 class in its own column.

## Equivalence classes and boundary values per capability
Within each capability the classes below are exhaustive and non-overlapping: every input falls into exactly one class.

| Capability | Input | Equivalence classes | Boundary values | TCs |
|---|---|---|---|---|
| board.model | target id | existing note; stale / unknown id | — | TC-03, TC-05, TC-07 / TC-04, TC-08 |
| board.model | colour | one of the six STICKY_COLORS; any other string | — | TC-05, TC-27 / TC-06 |
| board.model | coordinates | finite numbers; NaN or ±Infinity | — | TC-01, TC-03 / TC-39 |
| board.model | stacking before bringToFront | not topmost; already topmost; equal z tie | z of 1 of 3; max z | TC-09 / TC-10 / TC-11 |
| sticky.text | text length after edit | 0..949; 950..1,000; over 1,000 | 949, 950, 951, 999, 1,000, 1,001, 1,200 | TC-14 to TC-17 |
| sticky.text | edit shape | insert; delete; replace; no change | single char at index 2 | TC-13 |
| sticky.interaction | pointer movement after press | below DRAG_THRESHOLD_PX; at or above | 2 px; exactly 3 px | TC-19 / TC-20 |
| sticky.interaction | zoom during drag | 50%; 100%; 200% | 50%, 200% | TC-31, TC-32 |
| sticky.interaction | note existence during interaction | present; deleted mid-drag or mid-edit | — | TC-18 to TC-22 / TC-37 |
| sticky.toolbar | view position when creating | near origin; panned far away | — | TC-28 / TC-34 |

## Coverage table (crosses D1 × D2 × D3)
| TC | Capability | D1 | D2 before | D3 | Action | Expected before → after | Level |
|---|---|---|---|---|---|---|---|
| TC-01 | board.model | create | no notes | not applicable: model is zoom-independent | createSticky(0,0) | objects.size 0 → 1; type sticky, color yellow, text '', z 1 | unit |
| TC-02 | board.model | create | 2 notes z 1,2 | not applicable: zoom-independent | createSticky | new z = 3 | unit |
| TC-03 | board.model | move | Unselected | not applicable: model takes world coords | moveObject(id, 10, -20) | x,y (0,0) → (10,-20); other fields unchanged | unit |
| TC-05 | board.model | colour | Selected | not applicable: zoom-independent | setStickyColor(id,'green') | yellow → green; text, x, y, z unchanged | unit |
| TC-07 | board.model | delete | Selected | not applicable: zoom-independent | deleteObject(id) | size 1 → 0 | unit |
| TC-09 | board.model | move | Selected z 1 of 3 | not applicable: zoom-independent | bringToFront(id) | z 1 → 4 | unit |
| TC-11 | board.model | render order | two notes equal z | not applicable: zoom-independent | sortedObjects() | ordered by id as tie-break, stable across calls | unit |
| TC-12 | board.model | read | doc with unknown type 'shape' | not applicable: zoom-independent | snapshot() | unknown object skipped, no throw | unit |
| TC-13 | sticky.text | edit | Editing text 'abc' | not applicable: pure text logic | applyTextDiff('abc'→'abXc') | Y.Text ops: single insert 'X' at 2 (not delete+insert all) | unit |
| TC-14 | sticky.text | edit | Editing empty | not applicable: pure text logic | clamp 1,200 chars | 1,000 chars kept | unit |
| TC-15 | sticky.text | edit | Editing 999 chars | not applicable: pure text logic | insert 1 char | 1,000 accepted | unit |
| TC-17 | sticky.text | edit | Editing 949 / 950 / 951 chars | not applicable: pure text logic | counterVisible() | false / true / true (remaining 51 / 50 / 49) | unit |
| TC-18 | sticky.interaction | select | Unselected | 100% | pointerdown+up no move | Selected; outline and NoteToolbar rendered | ui-component |
| TC-19 | sticky.interaction | move | Unselected | 100% | pointerdown, move 2px, up | Selected; moveObject not called (below DRAG_THRESHOLD_PX) | ui-component |
| TC-21 | sticky.interaction | move | Dragging | 100% | pointercancel | Selected; position = last applied | ui-component |
| TC-22 | sticky.interaction | select | Selected | 100% | click empty board | Unselected; toolbar gone | ui-component |
| TC-23 | sticky.text | edit | Selected | 100% | press Enter | Editing; textarea focused caret at end | ui-component |
| TC-24 | sticky.text | edit | Editing | 100% | press Escape | Selected; text preserved | ui-component |
| TC-25 | sticky.interaction | delete | Selected | 100% | press Delete; press Backspace (separate runs) | note removed | ui-component |
| TC-27 | sticky.toolbar | colour | Selected | 100% | click Pink swatch | model color pink; selection kept | ui-component |
| TC-28 | sticky.toolbar | create | no notes | 100% | click Sticky note button | 1 note centred on viewport centre; Editing | ui-component |
| TC-29 | sticky.toolbar | delete | Selected | 100% | click bin button | note removed; selection cleared | ui-component |
| TC-38 | sticky.text | edit | Editing | 100% | type 'abc' then click outside | editor unmounted; Y.Text 'abc'; Unselected | ui-component |
| TC-30 | sticky.interaction | create | no notes | 100% | real dblclick at (400,300) then type 'Hello' | note centre at (400,300) ±1px; text Hello | e2e |
| TC-31 | sticky.interaction | move | Selected | 50% | real drag by (100,50) screen px | grabbed point stays under pointer ±1px; world x,y +200,+100 | e2e |
| TC-32 | sticky.interaction | move | Selected | 200% | real drag by (100,50) | world x,y +50,+25; note drawn above overlapped note | e2e |
| TC-33 | sticky.text | edit | Editing | 100% | type one word; then paste 1,000 chars | computed font-size 24px; then ≥ 10px and scrollHeight clipped with fade class present | e2e |
| TC-34 | sticky.toolbar | create | panned far away | 100% | click Sticky note | note visible at centre of screen | e2e |

## Negative scenarios
| TC | Capability | Case | Must not happen | Level |
|---|---|---|---|---|
| TC-04 | board.model | moveObject on a stale id | a change or update event (returns false; 0 updates) | unit |
| TC-06 | board.model | setStickyColor(id,'teal') (unknown colour) | colour changes or an update is emitted (returns false; still yellow) | unit |
| TC-08 | board.model | deleteObject on a stale id | an update event (returns false) | unit |
| TC-10 | board.model | bringToFront on the topmost note | an update event (pointless sync traffic in story 3) | unit |
| TC-39 | board.model | moveObject / createSticky with NaN or Infinity coordinates | a non-finite position is written (returns false; 0 updates) | unit |
| TC-16 | sticky.text | insert 1 char at 1,000 chars | text grows beyond 1,000 characters | unit |
| TC-26 | sticky.text | Backspace while editing 'ab' | the note is deleted (note present; text 'a') | ui-component |
| TC-20 | sticky.interaction | drag starting on a note | the board camera moves (stopPropagation) | ui-component |
| TC-35 | sticky.interaction | dblclick on an existing note | a new note is created (existing note edited instead) | ui-component |
| TC-36 | sticky.interaction | Enter while nothing is selected | a note is created or edited | ui-component |
| TC-37 | sticky.interaction | note deleted (via model call in test) while Dragging or Editing | an exception, or the note being re-created | ui-component |

## Boundary values
- Text length: 0, 1, 949/950/951 (counter threshold), 999, 1,000, 1,001, 1,200 pasted (TC-14 to TC-17, TC-33).
- Drag distance: 2px (below threshold) and exactly 3px (at threshold) (TC-19, TC-20).
- Zoom for drag geometry: 50%, 100%, 200% (TC-31, TC-32).
- Number of notes: 0, 1, 3, equal z (TC-01, TC-02, TC-09, TC-11).
- Font fit: shortest (one word → max 24px) and longest (1,000 chars → min 10px with overflow) (TC-33).

## Error paths (every contract error has a case)
| Capability | Contract error | TC |
|---|---|---|
| board.model | stale id → false, no transaction | TC-04, TC-08 |
| board.model | unknown colour → false | TC-06 |
| board.model | non-finite coordinates → false | TC-39 |
| board.model | bringToFront on topmost → false, no update | TC-10 |
| sticky.text | text over limit → clamped | TC-14, TC-16 |
| sticky.interaction | note disappears mid-interaction (stale id) → interaction ends silently | TC-37 |
| sticky.toolbar | model rejection (stale id or unknown colour) → no change, ignored | TC-06, TC-37 |

## Mock vs real boundaries
| Dependency | Mocked? | Reason |
|---|---|---|
| Yjs `Y.Doc` | Real in all levels | It is the store under test; in-process and deterministic, so mocking would hide real merge/observe behaviour |
| DOM layout / fonts | jsdom (no layout) in component tests; real in e2e | Font fit and pixel-accurate drag verified only in e2e |
| Network / storage | None exist in this story | Added in stories 3 and 4 |

## E2E workflows
1. **Brainstorm golden path** (TC-30 → TC-31 → colour → delete): create by double-click, type, move at 50% zoom, recolour, delete. Asserts the board ends with the expected notes, colours and positions.
2. **Create while far away** (TC-34): toolbar creation is always visible.
3. **Long text** (TC-33): text fits then clips at minimum size.

## Fixtures
- Realistic note texts: short ("Faster onboarding"), multi-line retro item (3 lines, ~120 chars), and a 1,000 character paragraph of English prose (not repeated single characters, which lay out unrealistically).

## Not covered
Deliberately not covered by automated tests:
- IME/composition input (e.g. Japanese): textarea diff runs on `input` after composition end; not automated.
- Concurrent edits by multiple users: story 3.
- Persistence: story 4.
- Keyboard Tab order between notes: accessible names are asserted through role/label queries in TC-18, TC-27 and TC-28, but Tab reachability is not automated.

## Board document model

> Anchor: `board.model`

## Contract
```ts
// src/shared/board-model.ts
export const LOCAL_ORIGIN: unique symbol;
export interface StickySnapshot { id: string; type: 'sticky'; x: number; y: number; color: StickyColor; text: string; z: number; createdAt: number }
export function initDoc(doc: Y.Doc): void;                       // sets meta.schemaVersion if absent
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string;
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean;
export function bringToFront(doc: Y.Doc, id: string): boolean;
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean;
export function deleteObject(doc: Y.Doc, id: string): boolean;
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined;
export function snapshot(doc: Y.Doc): readonly StickySnapshot[]; // sorted by (z, id), unknown types skipped
```
- **Inputs**: doc, ids, world coordinates (finite numbers), colour names.
- **Outputs**: new id, or `true` when a change was applied / `false` when rejected or a no-op.
- **Errors**: stale id, unknown colour, non-finite coordinates → `false`, no transaction. Never throws for user-driven input.
- **Side effects**: one `doc.transact(fn, LOCAL_ORIGIN)` per successful call (origin used by story 8 undo and story 3 to avoid echo).

## Implementation
- **Change colour (sticky.color):** clicking one of the six swatches (yellow, orange, green, blue, pink, violet) on a selected note's toolbar calls `setStickyColor(id, name)`, which sets only the `color` field in one transaction. Text, position (`x`, `y`), stacking (`z`) and the local selection are not touched, so the note stays selected with its text and position unchanged. Unknown colour names or stale ids return `false` and write nothing.
- **Delete a note (sticky.delete):** pressing Delete or Backspace while a note is selected and **not** being edited, or clicking the toolbar's delete (bin) button, calls `deleteObject(id)`, which removes the note from `objects` in one transaction and the selection is cleared. While the note is being edited, the keyboard handler does not call `deleteObject` at all: Delete and Backspace go to the textarea and edit characters, so the note is never removed from the keyboard during editing.
- The module is framework-free so the Durable Object (story 4) can import it for validation/migration.
- `snapshot` is memoised by `useBoardDoc` and recomputed on `objects.observeDeep`.
- Coordinates are the note's top-left; creation subtracts `STICKY_SIZE_WORLD / 2` so the note is centred on the click.
- Low reversibility: this schema becomes the persisted format in story 4 and the wire format in story 3, hence `meta.schemaVersion`.

## Tests
Unit (Vitest, real Y.Doc): TC-01 to TC-12 and TC-39 in `tests/unit/board-model.test.ts`; each mutation test also asserts the number of `update` events emitted (1 for success, 0 for rejection). Colour: TC-05, TC-06. Delete: TC-07, TC-08. The keyboard and toolbar paths that call these functions are tested under sticky.interaction and sticky.toolbar.

## Sticky note interaction

> Anchor: `sticky.interaction`

## Contract
```tsx
// src/client/objects/StickyNote.tsx
export function StickyNote(props: {
  note: StickySnapshot; doc: Y.Doc; zoom: number;
  selected: boolean; editing: boolean;
  onSelect(id: string): void; onStartEdit(id: string): void; onEndEdit(next: 'selected' | 'unselected'): void;
}): JSX.Element;
// src/client/board/useSelection.ts
export function useSelection(): { selectedId: string | null; editingId: string | null; select(id: string | null): void; startEdit(id: string): void; endEdit(next: 'selected' | 'unselected'): void };
```
- **Inputs**: pointer, dblclick and keyboard events on a note; window keydown for Enter/Delete/Backspace in `App.tsx`.
- **Outputs**: absolutely positioned `div[role="group"][aria-label="Sticky note"]` at world `(x,y)` inside the world layer, width/height `STICKY_SIZE_WORLD`, background from `STICKY_COLORS`, `data-selected` attribute, blue outline when selected.
- **Errors**: target note disappears mid-interaction (stale id) → interaction ends silently (TC-37).
- **Side effects**: calls board-model mutations; `stopPropagation` on pointerdown/dblclick so the viewport neither pans nor creates a note.

## Implementation
- **Create by double-click (sticky.create_dblclick):** `BoardViewport` handles `dblclick` only when `event.target` is the viewport/grid (empty board space). It converts the point with `screenToWorld`, calls `createSticky` with the top-left at point − STICKY_SIZE_WORLD/2 so a yellow note is centred on that point with `z = maxZ + 1` (on top of all other notes), then selects it and starts editing immediately, so typed characters go straight into the note. A double-click on an existing note edits that note instead (TC-35).
- **Select and deselect (sticky.select):** a pointerdown/up on a note that moves less than DRAG_THRESHOLD_PX (3 px) selects it: blue outline plus the note toolbar. A pointerup on empty board space without dragging clears the selection (toolbar hidden).
- **Move by dragging (sticky.move):** once movement exceeds DRAG_THRESHOLD_PX the note enters Dragging; `bringToFront` runs once so it is drawn above every note it overlaps, and each animation frame writes `moveObject(id, start + screenDelta / zoom)`. Dividing by the camera zoom keeps the grabbed point under the pointer (within 1 px) at any zoom (50%, 100%, 200% tested). A cancelled drag keeps the last applied position.
- **Dragging a note does not pan (sticky.no_pan):** the note's pointerdown calls `stopPropagation`, so the viewport never starts a pan; other notes and the grid keep their screen positions during a note drag.
- Selection and editing are **local component state**, never written to the Y.Doc.
- The keyboard handler ignores Delete/Backspace when `editingId !== null` or when focus is in any input (sticky.delete in board.model).

## Tests
ui-component: TC-18 to TC-22, TC-25, TC-35 to TC-37 in `tests/component/StickyNote.test.tsx`.
e2e: TC-30 to TC-32 in `tests/e2e/sticky-notes.spec.ts`.

## Sticky note text editing and fit

> Anchor: `sticky.text`

## Contract
```ts
// src/client/objects/StickyText.ts
export function clampToLimit(next: string, max?: number): string;           // default STICKY_TEXT_MAX_CHARS
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void; // minimal insert/delete
export function counterVisible(length: number): boolean;                      // remaining <= STICKY_COUNTER_THRESHOLD_CHARS
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean };
// src/client/objects/StickyTextEditor.tsx
export function StickyTextEditor(props: { ytext: Y.Text; fontPx: number; onEnd(next: 'selected' | 'unselected'): void }): JSX.Element;
```
- **Inputs**: textarea value after each `input` event (not during IME composition); `keydown` Escape; the editor's blur caused by a pointerdown outside the note; note element for measurement.
- **Outputs**: Y.Text updated with the minimal change; font size in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]`; `overflow` flag toggles a bottom fade class.
- **Errors**: over-limit input → clamped (characters beyond the limit dropped, caret restored to end of kept text).
- **Side effects**: one Yjs transaction per input event; `onEnd` callback on Escape or outside click.

## Implementation
- **Start editing (sticky.edit_start):** `StickyNote` enters Editing on `dblclick`, and `App.tsx` enters Editing for the selected note on `Enter` (only when that note is not already being edited and focus is not in an input). On mount, `StickyTextEditor` sets the textarea value from `ytext.toString()`, calls `focus()`, then `setSelectionRange(len, len)` so the cursor is at the end of the text.
- **Finish editing (sticky.edit_end):** `keydown` Escape → `preventDefault`, `onEnd('selected')`. A pointerdown anywhere outside the note → `onEnd('unselected')`. Every `input` event has already been written to Y.Text via `applyTextDiff`, so ending editing performs **no additional write** and all text typed so far is kept; `onBlur` flushes any pending value defensively (guarded by `compositionend` for IME). Enter inside the textarea inserts a new line.
- **Text length limit (sticky.text_limit):** `clampToLimit` keeps at most STICKY_TEXT_MAX_CHARS (1,000) characters; typing or pasting that would exceed 1,000 adds nothing beyond the 1,000th character (a 1,200-character paste into an empty note keeps exactly the first 1,000). The counter appears when 50 or fewer characters remain and shows "1000/1000" at the limit.
- **Text fits the note (sticky.text_fit):** `fitFontSize` binary-searches integer sizes from 24 px down to 10 px (at 100% zoom; the font is in board units so it scales with zoom) for the largest size at which `scrollHeight <= box`. If the text does not fit even at 10 px, `overflow` is true: the overflowing part is clipped inside the note (`overflow: hidden`) and a fade is shown at the bottom edge, so nothing is drawn outside the note.
- Minimal diff (common prefix + common suffix) is required, not a full replace, so concurrent typing by others (story 3) is never destroyed.

## Tests
unit: TC-13 to TC-17 in `tests/unit/sticky-text.test.ts`.
ui-component: TC-23, TC-24, TC-26, TC-38 in `tests/component/StickyTextEditor.test.tsx`.
e2e: TC-30 (dblclick then type), TC-33 (real font layout).

## Toolbars: create, colour, delete

> Anchor: `sticky.toolbar`

## Contract
```tsx
// src/client/board/Toolbar.tsx
export function Toolbar(props: { onCreateSticky(): void }): JSX.Element;
// src/client/objects/NoteToolbar.tsx
export function NoteToolbar(props: { color: StickyColor; onColor(c: StickyColor): void; onDelete(): void }): JSX.Element;
```
- **Inputs**: clicks.
- **Outputs**: `button[aria-label="Sticky note"]` in a fixed left toolbar; for the selected note (hidden while Dragging or Editing), six `button[aria-label="<Colour> colour"][aria-pressed]` swatches and `button[aria-label="Delete note"]`, positioned above the note in screen space so it does not scale with zoom.
- **Errors**: none beyond model rejections (ignored).
- **Side effects**: see below.

## Implementation
- **Create from toolbar (sticky.create_button):** clicking the Sticky note button computes the world point at the centre of the visible board area with `screenToWorld(viewport centre)` and calls `createSticky`, which creates a yellow note centred there with `z = maxZ + 1` (on top of all other notes). The new note is then selected and text editing starts immediately, so it accepts typing without another click, wherever the board has been panned.
- Swatch clicks call `setStickyColor` and the bin button calls `deleteObject` (behaviour in board.model).
- Toolbars stop pointer propagation so clicks never reach the viewport (which would clear selection).

## Tests
ui-component: TC-27 to TC-29. e2e: TC-34 and the golden-path workflow.

