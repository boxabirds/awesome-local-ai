# Story 7 · test-case catalogue

Status legend — **done**: a test asserts the behaviour and passes at hand-off;
**partial**: the underlying logic is tested at a lower layer (usually unit) but
the interaction/UI case from the task is not; **not-covered**: no test drives it.
Where a case was verified only in chromium that is called out.

## Unit — `sel.geometry_ops`, `sel.registry`, `sel.interaction` (pure)

| TC | Case (from tasks.md) | Layer / file | Status | Notes |
|----|----------------------|--------------|--------|-------|
| TC-01 | `resizeRect` locked `se` 200×200 + (100,40) → 300×300 | unit / `geometry.test.ts` | done | |
| TC-02 | shrink below `STICKY_MIN_SIZE_WORLD` (−1 and exact) → clamped 50×50 | unit / `geometry.test.ts` | done | both boundary halves |
| TC-03 | `clampScale` stops uniformly at first `MAX_OBJECT_SIZE_WORLD` breach, layout preserved | unit / `geometry.test.ts` | done | **deviation:** clamp is per-axis, not "one uniform scale" |
| TC-04 | two 200-unit notes 100 apart, `scaleWithin` box ×2 width → 400 wide, gap 200 | unit / `geometry.test.ts` | done | |
| TC-05 | `moveObjects` 3 ids / 1 deleted → 2, exactly one update event | unit / `board-model-group.test.ts` | done | |
| TC-06 | `bringObjectsToFront` selected-over-unselected, relative z kept | unit / `board-model-group.test.ts` | done | |
| TC-07 | `objectsInRect` fully-inside-only (A in, B part, C out) | unit / `geometry.test.ts` + `board-model-group.test.ts` | done | |
| TC-08 | `allObjectIds` skips an unknown type | unit / `board-model-group.test.ts` | done | |
| TC-09 | NaN/Infinity + empty id list → 0, no transaction | unit / `board-model-group.test.ts` | done | |
| TC-10 | sticky without size → default box; first resize writes both fields | unit / `geometry.test.ts` + `board-model-group.test.ts` | done | `resizeObjects` tested at model level only (see TC-24) |
| TC-11 | `getObjectType('sticky')` spec + hitTest inside/outside | unit / `registry.test.ts` | done | |
| TC-12 | `getObjectType('unknown')` → undefined | unit / `registry.test.ts` | done | |
| dup | duplicate `registerObjectType` throws | unit / `registry.test.ts` | done | |
| tb | `testbox` (resizable, unlocked, minSize 10) retrievable | unit / `registry.test.ts` | done | |
| TC-13 | reducer `{}`→click a→`{a}`→toggle b→`{a,b}`→click b→`{b}` | unit / `selection-reducer.test.ts` | done | |
| TC-14 | `{a}`→toggle a→`{}` (last member) | unit / `selection-reducer.test.ts` | done | |
| TC-15 | `{a,b,c}` ∩ present `{a,c,d}` → `{a,c}`; editing b ends | unit / `selection-reducer.test.ts` | done | |

## Component — `tests/component/multiselect.test.tsx` (jsdom)

| TC | Case (from tasks.md) | Status | Notes |
|----|----------------------|--------|-------|
| TC-16 | all selected ids deleted remotely → selection empty, bar hidden | partial | covered at unit (`prune`) and e2e (TC-35); no jsdom case |
| TC-17 | two selected → "2 selected" + Delete button, `aria-live` count | done | "selection bar appears at two" |
| TC-18 | one sticky selected → `NoteToolbar`, not the bar | not-covered | the single-note toolbar-in-a-selection path is untested |
| TC-19 | empty-space click without drag → selection cleared | partial | Escape-clears is covered; the empty *pointerup* clear is not asserted |
| TC-20 | marquee fully-inside rule (additive) | done | + reducer error path "empty marquee leaves selection unchanged" |
| TC-21 | plain drag on empty space pans; no marquee | done | negative case present |
| TC-22 | `pointercancel` mid-marquee → selection unchanged | not-covered | |
| TC-23 | drag unselected b while `{a}` → `{b}`; `DRAG_THRESHOLD_PX−1` is a click | partial | the select-only-b half is covered; the threshold boundary is not |
| TC-24 | testbox `e` handle changes width only; Shift keeps ratio; "Resize …" labels | partial | **resize not wired to UI** — `resizeRect` is unit-tested (`TC-24 basis`) but there is no handle to drag |
| TC-25 | `canEdit === false` → no writes | not-covered | |
| TC-26 | `onGestureStart`/`onGestureEnd` once per drag; cancel keeps last | not-covered | needs the transform-gesture wiring |
| TC-27 | `Ctrl/Cmd+A` selects all with `preventDefault` | done | `preventDefault` itself is not asserted, only the resulting set |
| TC-28 | `Ctrl/Cmd+A` on an empty board → empty, no error | partial | covered at reducer level; no component case |
| TC-29 | ArrowRight / Shift+ArrowUp nudge, both steps, no pan | done | component + e2e |
| TC-30 | Backspace while editing → text edited, objects kept | not-covered | |
| TC-31 | Delete with selection → all removed, selection empty | done | single-transaction delete (component, e2e, full-capacity) |

## E2E — `tests/e2e/**` (built app + real DO; **chromium** at hand-off)

| TC | Case (from tasks.md) | File | Status | Notes |
|----|----------------------|------|--------|-------|
| TC-32 | Shift+drag box-selects fully-inside notes, no pan | `multiselect.spec.ts` | done | design also wants firefox + webkit — **not run** |
| TC-33 | select 6, drag one 300 → all move 300 above a 4th; `se` resize proportional + stops at min | `multiselect.spec.ts` (move) / `multiselect-full-capacity.spec.ts` (concurrent) | partial | group **move** + z-order and concurrent convergence covered; the **`se`-handle resize-to-min** is not (no handle) |
| TC-34 | ArrowRight ×3 + Shift+ArrowRight nudge, no camera pan / scroll; Delete removes all | `multiselect.spec.ts` | done | chromium only |
| TC-35 | colleague deletes one of my selected notes → bar prunes within budget, remainder still selected, then Delete clears | `multiselect-full-capacity.spec.ts` | done | two contexts, real DO sync |
| TC-36 | MAX_CONCURRENT_EDITORS each transform a different selection → identical final positions | `multiselect-full-capacity.spec.ts` | done | two concurrent group selections (not all five editors); demonstrates absolute-write convergence |

## Group move / full-capacity truths that are NOT a numbered TC

- Group move "one shared selection translates together" — component + e2e.
- Z-order: dragged group renders above a note it used to sit under — e2e move case.
- Single-click selects rather than edits — covered indirectly (move + delete keys
  require a non-editing selected note; the full-capacity TC-35 deletes via
  select-all + `Delete` with no editor open).
