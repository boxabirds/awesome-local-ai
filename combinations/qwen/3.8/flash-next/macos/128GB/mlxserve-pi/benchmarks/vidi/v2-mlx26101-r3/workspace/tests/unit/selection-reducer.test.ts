import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

/**
 * Selection reducer unit tests (TC-13 to TC-15).
 *
 * The selection is the one piece of state story 7 adds, and it is the one that never goes into
 * the document - so the only way to be sure it is right is to test it as the pure thing it is.
 * What is worth pinning down is where a set of ids and a piece of editing state can disagree: a
 * click that replaces a whole selection, a toggle that empties it, and the moment somebody else
 * deletes an object that this person has either just selected or is in the middle of typing into.
 */

const a = 'note-a';
const b = 'note-b';
const c = 'note-c';
const d = 'note-d';

/** Build a state from ids and an editing id, so the tests read as the sets they are about. */
function selected(ids: readonly string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

function idsOf(state: SelectionState): string[] {
  return [...state.ids].sort();
}

/** Run a list of actions through the reducer and hand back the state that comes out. */
function run(
  actions: readonly SelectionAction[],
  present?: readonly string[],
  from: SelectionState = EMPTY_SELECTION,
): SelectionState {
  return actions.reduce(
    (state, action) => selectionReducer(state, action, present ?? null),
    from,
  );
}

describe('selection.click and toggle (sel.interaction)', () => {
  it('TC-13 replaces, adds, and replaces again: {} to {a} to {a,b} to {b}', () => {
    const afterClick = run([{ type: 'click', id: a }]);
    expect(idsOf(afterClick)).toEqual([a]);
    const afterToggle = run([{ type: 'click', id: a }, { type: 'toggle', id: b }]);
    expect(idsOf(afterToggle)).toEqual([a, b]);
    // A plain click on one of them is not an addition: it is a new selection that happens to
    // contain one of the old ones.
    const afterClickB = run([
      { type: 'click', id: a },
      { type: 'toggle', id: b },
      { type: 'click', id: b },
    ]);
    expect(idsOf(afterClickB)).toEqual([b]);
    expect(afterClickB.ids.has(a)).toBe(false);
  });

  it('TC-13b starts from nothing rather than trusting what it is handed', () => {
    expect(EMPTY_SELECTION.ids.size).toBe(0);
    expect(EMPTY_SELECTION.editingId).toBeNull();
    expect(idsOf(selectionReducer(selected([c, d]), { type: 'click', id: a }))).toEqual([a]);
  });

  it('TC-14 takes the last object out and is left with nothing (boundary)', () => {
    const empty = run([{ type: 'toggle', id: a }], undefined, selected([a]));
    expect(empty.ids.size).toBe(0);
    expect(empty.editingId).toBeNull();
    // Shift + clicking each of three in turn gets back to nothing the same way.
    const unwound = run([
      { type: 'toggle', id: a },
      { type: 'toggle', id: b },
      { type: 'toggle', id: c },
      { type: 'toggle', id: a },
      { type: 'toggle', id: b },
      { type: 'toggle', id: c },
    ]);
    expect(unwound.ids.size).toBe(0);
  });

  it('TC-14b stops typing in an object that has just been unselected', () => {
    // Shift + click on the note being typed into is how you stop typing without losing the
    // board; what it cannot leave behind is a selection that does not contain the note.
    const state = run([{ type: 'toggle', id: a }], undefined, selected([a, b], a));
    expect(idsOf(state)).toEqual([b]);
    expect(state.editingId).toBeNull();
  });

  it('leaves the state alone when the click changes nothing', () => {
    const before = selected([a, b]);
    expect(selectionReducer(before, { type: 'click', id: a })).not.toBe(before);
    // A click on the only object already selected is the same selection; the state is not
    // rebuilt, so nothing below it re-renders.
    expect(selectionReducer(selected([a]), { type: 'click', id: a }).ids).toEqual(new Set([a]));
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });
});

describe('selection.setMany (sel.interaction)', () => {
  it('TC-15a adds the objects a marquee caught to what was already selected', () => {
    const state = run(
      [{ type: 'setMany', ids: [b, c], additive: true }],
      undefined,
      selected([a]),
    );
    expect(idsOf(state)).toEqual([a, b, c]);
  });

  it('TC-15b replaces the selection for select-all, and does not repeat an object', () => {
    const state = run(
      [{ type: 'setMany', ids: [a, b, b, c], additive: false }],
      undefined,
      selected([d]),
    );
    expect(idsOf(state)).toEqual([a, b, c]);
    expect(state.ids.size).toBe(3);
  });

  it('handles an empty list in both directions', () => {
    // A marquee that caught nothing, added to a selection: the selection stays. Shift + A on an
    // empty board: the selection goes.
    expect(idsOf(run([{ type: 'setMany', ids: [], additive: true }], undefined, selected([a])))).toEqual(
      [a],
    );
    expect(run([{ type: 'setMany', ids: [], additive: false }], undefined, selected([a])).ids.size).toBe(
      0,
    );
  });
});

describe('selection.prune (sel.interaction)', () => {
  it('TC-15 drops the objects that are not on the board any more', () => {
    const state = run([{ type: 'prune', present: [a, c, d] }], undefined, selected([a, b, c]));
    expect(idsOf(state)).toEqual([a, c]);
  });

  it('TC-15b ends typing in an object that another person deleted', () => {
    const state = run(
      [{ type: 'prune', present: [a, c] }],
      undefined,
      selected([a, b, c], b),
    );
    expect(idsOf(state)).toEqual([a, c]);
    expect(state.editingId).toBeNull();
    // The object still there is still being typed into: a prune is not an interruption.
    const kept = run([{ type: 'prune', present: [a, b, c] }], undefined, selected([a, b, c], b));
    expect(kept).toEqual(selected([a, b, c], b));
  });

  it('TC-16 goes to nothing when every selected object is deleted remotely', () => {
    const state = run([{ type: 'prune', present: [d] }], undefined, selected([a, b, c], c));
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
    // Nothing selected and nothing edited: the same object the board started with, so a
    // component that compares states can see that nothing is left to draw.
    expect(state.ids.size).toBe(EMPTY_SELECTION.ids.size);
  });

  it('says nothing when the board still holds everything that was picked', () => {
    const before = selected([a, b], a);
    expect(selectionReducer(before, { type: 'prune', present: [a, b, c] })).toBe(before);
    expect(selectionReducer(EMPTY_SELECTION, { type: 'prune', present: [] })).toBe(EMPTY_SELECTION);
  });
});

describe('selection and actions about objects that are not there (error path)', () => {
  it('TC-15c ignores an action naming an object the board does not hold', () => {
    const present = [a, b];
    // A click racing a remote delete: the object is gone, so the selection does not grow an id
    // that nothing could draw an outline around.
    expect(run([{ type: 'click', id: c }], present)).toBe(EMPTY_SELECTION);
    expect(run([{ type: 'toggle', id: c }], present)).toBe(EMPTY_SELECTION);
    expect(run([{ type: 'startEdit', id: c }], present)).toBe(EMPTY_SELECTION);
    // A marquee that overlaps an object deleted between the drag and the release keeps the ones
    // that are still there and drops the one that is not.
    const state = run([{ type: 'setMany', ids: [a, c], additive: true }], present, selected([b]));
    expect(idsOf(state)).toEqual([a, b]);
  });

  it('does not lose the selection when one of its objects is the one that vanished', () => {
    const state = run([{ type: 'click', id: a }], [a, b], selected([b], b));
    expect(idsOf(state)).toEqual([a]);
    expect(state.editingId).toBeNull();
  });
});

describe('selection.startEdit and endEdit (sel.interaction)', () => {
  it('selects the object being typed into, and can hold it alongside the rest', () => {
    const state = run(
      [{ type: 'click', id: a }, { type: 'toggle', id: b }, { type: 'startEdit', id: b }],
      undefined,
      EMPTY_SELECTION,
    );
    expect(idsOf(state)).toEqual([a, b]);
    expect(state.editingId).toBe(b);
  });

  it('keeps the selection when typing ends with Escape, and loses it when a click ends it', () => {
    const editing = selected([a, b], b);
    expect(selectionReducer(editing, { type: 'endEdit', next: 'selected' })).toEqual(
      selected([a, b], null),
    );
    expect(selectionReducer(editing, { type: 'endEdit', next: 'unselected' })).toEqual(
      EMPTY_SELECTION,
    );
    // Stopping when nothing was being typed in is not an action.
    expect(selectionReducer(selected([a]), { type: 'endEdit', next: 'selected' })).toEqual(
      selected([a]),
    );
  });

  it('clears everything it was holding, including what was being typed into', () => {
    expect(selectionReducer(selected([a, b, c], c), { type: 'clear' })).toEqual(EMPTY_SELECTION);
  });
});
