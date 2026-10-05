/**
 * Unit tests for the selection reducer (`sel.interaction`, TC-13 to TC-15).
 *
 * The selection is the one piece of state this story invents, and almost every bug a
 * story like this can have — a selection that will not empty, an outline left on an
 * object that is no longer on the board, a text box open on an object a colleague
 * deleted — is a wrong answer by this reducer. It is pure and synchronous, so all of
 * them are answered here rather than in a browser.
 *
 * The selection is local: nothing in this file touches a document, and nothing in the
 * product writes any of it to one.
 */
import { describe, expect, it } from 'vitest';

import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

/** An object id in a snapshot, by whichever name reads well in the test. */
const A = 'object-a';
const B = 'object-b';
const C = 'object-c';

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

function sorted(selection: SelectionState): string[] {
  return [...selection.ids].sort();
}

const present = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('selection.click', () => {
  it('TC-13: replaces the whole selection with the one object clicked', () => {
    const from = state([A, B, C]);

    expect(sorted(selectionReducer(from, { type: 'click', id: B }))).toEqual([B]);
    // A click on a member of the selection narrows it to that object: this is the
    // action for "the person meant this one". The transform gesture never dispatches a
    // click for an object that is already selected, which is how dragging one object of
    // a cluster moves the whole cluster.
    expect(sorted(selectionReducer(from, { type: 'click', id: A }))).toEqual([A]);
    // Nothing was being edited, and nothing is now.
    expect(selectionReducer(from, { type: 'click', id: B }).editingId).toBeNull();
  });

  it('lets go of an object that was being edited when another one is clicked', () => {
    const editing = state([A, B], A);

    const next = selectionReducer(editing, { type: 'click', id: B });
    expect(sorted(next)).toEqual([B]);
    expect(next.editingId).toBeNull();

    // Clicking the object that is being edited again keeps it open for typing.
    expect(selectionReducer(editing, { type: 'click', id: A }).editingId).toBe(A);
  });
});

describe('selection.toggle', () => {
  it('TC-13: adds an object to the selection without disturbing the rest', () => {
    const from = state([A]);

    const next = selectionReducer(from, { type: 'toggle', id: B });
    expect(sorted(next)).toEqual([A, B]);
    // And again, which is how it comes off.
    expect(sorted(selectionReducer(next, { type: 'toggle', id: A }))).toEqual([B]);
  });

  it('TC-14: takes the last object off, leaving the selection empty', () => {
    const only = state([A]);

    const next = selectionReducer(only, { type: 'toggle', id: A });
    expect(next.ids.size).toBe(0);
    expect(next.editingId).toBeNull();
  });

  it('takes an object out from under the keyboard and closes the typing with it', () => {
    const editing = state([A, B], B);

    const next = selectionReducer(editing, { type: 'toggle', id: B });
    expect(sorted(next)).toEqual([A]);
    expect(next.editingId).toBeNull();
    // Toggling a different object leaves the one being typed in alone.
    expect(selectionReducer(editing, { type: 'toggle', id: A }).editingId).toBe(B);
  });
});

describe('selection.setMany', () => {
  it('TC-13: replaces the selection when not additive, and adds to it when additive', () => {
    const from = state([A]);

    expect(sorted(selectionReducer(from, { type: 'setMany', ids: [B, C], additive: false }))).toEqual([B, C]);
    expect(sorted(selectionReducer(from, { type: 'setMany', ids: [B, C], additive: true }))).toEqual([A, B, C]);
    // An additive marquee over objects already selected selects them once.
    expect(sorted(selectionReducer(state([A, B]), { type: 'setMany', ids: [B, C], additive: true }))).toEqual([
      A,
      B,
      C,
    ]);
  });

  it('keeps the object being typed in only while it is still in the selection', () => {
    const editing = state([A, B], B);

    expect(selectionReducer(editing, { type: 'setMany', ids: [B, C], additive: true }).editingId).toBe(B);
    expect(selectionReducer(editing, { type: 'setMany', ids: [C], additive: false }).editingId).toBeNull();
    // Selecting nothing is not a way to select everything.
    expect(selectionReducer(state([A, B, C]), { type: 'setMany', ids: [], additive: false }).ids.size).toBe(0);
    // An additive nothing keeps whatever was selected.
    expect(sorted(selectionReducer(state([A, B, C]), { type: 'setMany', ids: [], additive: true }))).toEqual([
      A,
      B,
      C,
    ]);
  });
});

describe('selection.clear', () => {
  it('empties the selection and stops editing in one action', () => {
    const editing = state([A, B], A);

    const next = selectionReducer(editing, { type: 'clear' });
    expect(next.ids.size).toBe(0);
    expect(next.editingId).toBeNull();
    // An empty selection cleared again is the same state, not a new render.
    expect(selectionReducer(next, { type: 'clear' })).toBe(next);
  });
});

describe('selection.prune', () => {
  it('TC-15: drops the ids that are gone and keeps the ones that are not', () => {
    const selected = state([A, B, C]);

    const next = selectionReducer(selected, { type: 'prune', presentIds: present(A, C) });
    expect(sorted(next)).toEqual([A, C]);
    // Nothing else about the selection changed.
    expect(next.editingId).toBeNull();
  });

  it('TC-15a: ends editing when the object being typed in is the one that went away', () => {
    const editing = state([A, B], B);

    const next = selectionReducer(editing, { type: 'prune', presentIds: present(A) });
    expect(sorted(next)).toEqual([A]);
    expect(next.editingId).toBeNull();

    // A selection emptied by a colleague's delete is empty, not stale.
    const emptied = selectionReducer(editing, { type: 'prune', presentIds: present() });
    expect(emptied.ids.size).toBe(0);
    expect(emptied.editingId).toBeNull();
  });

  it('says nothing when nothing went away, so a document update does not re-render the board', () => {
    const selected = state([A, B], null);

    expect(selectionReducer(selected, { type: 'prune', presentIds: present(A, B, C) })).toBe(selected);
  });
});

describe('selection.edit', () => {
  it('opens an object for typing without dropping the objects it is with', () => {
    const selected = state([A, B, C]);

    const next = selectionReducer(selected, { type: 'edit', id: C });
    // The three are still the three: with a group chosen, pressing Enter to type in one of them is not a
    // way to lose the other two, and a Delete pressed while the typing is open is still about all three.
    expect(sorted(next)).toEqual([A, B, C]);
    expect(next.editingId).toBe(C);

    // A note created a moment ago is not in the selection yet, and gets into it by being opened: the
    // object a person has just made is the object they are working on.
    const fresh = selectionReducer(state([A, B]), { type: 'edit', id: 'object-new' });
    expect(sorted(fresh)).toEqual([A, B, 'object-new']);
    expect(fresh.editingId).toBe('object-new');
  });

  it('closes typing without letting go of the selection, which is what Escape means', () => {
    const editing = state([A, B], A);

    const next = selectionReducer(editing, { type: 'edit', id: null });
    expect(sorted(next)).toEqual([A, B]);
    expect(next.editingId).toBeNull();
    // Closing typing that is not open is the same state, not a new one.
    const notEditing = state([A]);
    expect(selectionReducer(notEditing, { type: 'edit', id: null })).toBe(notEditing);
  });
});

describe('selection as a whole', () => {
  it('starts empty, and every action that names nothing in it leaves it empty', () => {
    expect(EMPTY.ids.size).toBe(0);
    expect(EMPTY.editingId).toBeNull();
    expect(selectionReducer(EMPTY, { type: 'prune', presentIds: present(A) })).toBe(EMPTY);
    expect(selectionReducer(EMPTY, { type: 'clear' })).toBe(EMPTY);
    expect(selectionReducer(EMPTY, { type: 'toggle', id: A }).ids.size).toBe(1);
  });
});
