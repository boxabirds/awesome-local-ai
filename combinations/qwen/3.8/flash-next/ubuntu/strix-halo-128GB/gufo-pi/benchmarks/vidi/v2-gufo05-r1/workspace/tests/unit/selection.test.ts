/**
 * The selection state machine on its own (`sel.interaction`, design.md's
 * `useSelection.selectionReducer`).
 *
 * TC-13 click and shift-click      {} → {a} → {a,b} → {b}
 * TC-14 shift-click off the last   → Empty
 * TC-15 somebody else deletes one  {a,b,c} → {a,c}, and editing that id stops
 *
 * Why a reducer and not just a set: the selection is written by six different things —
 * a click, a shift-click, a marquee, Ctrl+A, Escape, and the document changing
 * underneath — and read by the outlines, the bar, the drag, the keys and story 6's
 * presence. Every one of those has to agree, and the only way to keep them agreeing is
 * one function that says what happens next. Testing it without a DOM is what makes the
 * rules legible: there is no pointer, no render, no document, just the transition.
 *
 * The id `ghost` in these tests is an object that is not on the board: deleted by
 * somebody else, or never there. Actions about it are ignored, which is the error path
 * the design asks for, and the reason the state carries the ids that exist at all.
 */
import { describe, expect, it } from 'vitest';

import {
  initialSelection,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

/** A board holding a, b and c, with nothing selected. */
function board(...ids: string[]): SelectionState {
  return initialSelection(ids);
}

const a = 'a';
const b = 'b';
const c = 'c';
/** A note that appears later — the prune must not disturb a selection over it. */
const d = 'd';
/** A note that appears later — the prune must not disturb a selection over it. */
describe('sel.interaction: clicking and shift-clicking', () => {
  it('TC-13 selects on a click, adds on a shift-click, and narrows back to one', () => {
    const empty = board(a, b, c);
    expect(empty.ids.size).toBe(0);

    const one = selectionReducer(empty, { type: 'click', id: a });
    expect([...one.ids]).toEqual([a]);

    const two = selectionReducer(one, { type: 'toggle', id: b });
    expect([...two.ids].sort()).toEqual([a, b]);

    // A plain click on the other object is not "add": it is the whole selection now.
    const backToOne = selectionReducer(two, { type: 'click', id: b });
    expect([...backToOne.ids]).toEqual([b]);
  });

  it('TC-14 shift-clicking the last member leaves an empty selection', () => {
    const one = selectionReducer(board(a, b), { type: 'click', id: a });
    const none = selectionReducer(one, { type: 'toggle', id: a });
    expect(none.ids.size).toBe(0);
    // Escape on an empty selection changes nothing, and does not pretend to.
    expect(selectionReducer(none, { type: 'clear' })).toBe(none);
  });

  it('shift-clicking adds and removes without disturbing the rest', () => {
    const state = selectionReducer(board(a, b, c), { type: 'setMany', ids: [a, b, c], additive: false });
    const removed = selectionReducer(state, { type: 'toggle', id: b });
    expect([...removed.ids].sort()).toEqual([a, c]);
    const addedBack = selectionReducer(removed, { type: 'toggle', id: b });
    expect([...addedBack.ids].sort()).toEqual([a, b, c]);
  });

  it('ignores an object that is not on the board', () => {
    const state = board(a, b);
    // Deleted by somebody else between the render and the click, say.
    expect(selectionReducer(state, { type: 'click', id: 'ghost' })).toBe(state);
    expect(selectionReducer(state, { type: 'toggle', id: 'ghost' })).toBe(state);
    expect(selectionReducer(state, { type: 'edit', id: 'ghost' })).toBe(state);
  });

  it('clears the selection on Escape', () => {
    const state = selectionReducer(board(a, b), { type: 'setMany', ids: [a, b], additive: false });
    const cleared = selectionReducer(state, { type: 'clear' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.editingId).toBeNull();
  });
});

describe('sel.interaction: the document changing underneath the selection', () => {
  it('TC-15 drops what was deleted and keeps the rest', () => {
    const state = selectionReducer(board(a, b, c), {
      type: 'setMany',
      ids: [a, b, c],
      additive: false,
    });

    // Somebody else deletes b. `d` is a note this board has just learned about, and the
    // selection never held it, so it changes nothing here.
    const pruned = selectionReducer(state, { type: 'prune', presentIds: [a, c, d] });
    expect([...pruned.ids].sort()).toEqual([a, c]);
  });

  it('TC-15 stops editing an object that was deleted while it was selected', () => {
    // Typing into a note takes it out of a multi-selection on its own, so this is the
    // state a board is really in when the deletion arrives.
    const state = selectionReducer(board(a, b, c), { type: 'edit', id: b });
    expect(state.editingId).toBe(b);

    const pruned = selectionReducer(state, { type: 'prune', presentIds: [a, c] });
    // The object being typed into is gone, so the editor closes rather than writing to
    // a document entry that is not there.
    expect(pruned.editingId).toBeNull();
    expect(pruned.ids.size).toBe(0);
  });

  it('changes nothing when nothing was deleted, so the board does not re-render', () => {
    const state = selectionReducer(board(a, b), { type: 'click', id: a });
    expect(selectionReducer(state, { type: 'prune', presentIds: [a, b] })).toBe(state);
  });

  it('leaves editing when the object being edited survives', () => {
    let state = selectionReducer(board(a, b), { type: 'edit', id: a });
    state = selectionReducer(state, { type: 'prune', presentIds: [a, b] });
    expect(state.editingId).toBe(a);
    expect([...state.ids]).toEqual([a]);
  });

  it('takes an object this board just created into the selection', () => {
    const before = board(a);
    // A note made a moment ago is in the document but not yet in this state: creating
    // it is what tells the selection it exists (story 2's create-and-type).
    const added = selectionReducer(before, { type: 'add', id: 'fresh' });
    expect([...added.ids]).toEqual(['fresh']);
    expect(added.editingId).toBeNull();
    // And from now on it is a real object: editing it is allowed, and a prune that
    // still holds it changes nothing.
    expect(selectionReducer(added, { type: 'edit', id: 'fresh' }).editingId).toBe('fresh');
    expect(selectionReducer(added, { type: 'prune', presentIds: [a, 'fresh'] })).toEqual(added);
    // A prune that does not: it was never really there.
    const dropped = selectionReducer(added, { type: 'prune', presentIds: [a] });
    expect([...dropped.ids]).toEqual([]);
  });
});

describe('sel.interaction: editing', () => {
  it('editing an object selects it on its own', () => {
    let state = selectionReducer(board(a, b), { type: 'setMany', ids: [a, b], additive: false });
    state = selectionReducer(state, { type: 'edit', id: b });
    expect([...state.ids]).toEqual([b]);
    expect(state.editingId).toBe(b);
  });

  it('leaving the editor keeps the selection (Escape leaves a note selected)', () => {
    const state = selectionReducer(board(a), { type: 'edit', id: a });
    const left = selectionReducer(state, { type: 'edit', id: null });
    expect(left.editingId).toBeNull();
    expect([...left.ids]).toEqual([a]);
    // Already not editing: the same state, so nothing re-renders.
    expect(selectionReducer(left, { type: 'edit', id: null })).toBe(left);
  });

  it('a click on another object ends editing, and on this one does not', () => {
    const editing = selectionReducer(board(a, b), { type: 'edit', id: a });
    expect(selectionReducer(editing, { type: 'click', id: b }).editingId).toBeNull();
    expect(selectionReducer(editing, { type: 'click', id: a }).editingId).toBe(a);
  });

  it('an action that takes the edited object out of the selection ends editing', () => {
    const editing = selectionReducer(board(a, b), { type: 'edit', id: a });
    expect(selectionReducer(editing, { type: 'toggle', id: a }).editingId).toBeNull();
    expect(
      selectionReducer(editing, { type: 'setMany', ids: [b], additive: false }).editingId,
    ).toBeNull();
    // Adding to the selection keeps it: the edited object is still selected.
    expect(selectionReducer(editing, { type: 'setMany', ids: [b], additive: true }).editingId).toBe(
      a,
    );
  });
});
