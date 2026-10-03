import { describe, expect, it } from 'vitest';
import {
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

function set(...ids: string[]): Set<string> {
  return new Set(ids);
}

const empty: SelectionState = { ids: new Set<string>(), editingId: null };

function apply(state: SelectionState, ...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, state);
}

describe('sel.interaction reducer', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}.
  it('TC-13 click replaces, toggle adds, click replaces again', () => {
    const afterClick = apply(empty, { type: 'click', id: 'a' });
    expect([...afterClick.ids]).toEqual(['a']);
    const afterToggle = apply(afterClick, { type: 'toggle', id: 'b' });
    expect([...afterToggle.ids].sort()).toEqual(['a', 'b']);
    const afterClickB = apply(afterToggle, { type: 'click', id: 'b' });
    expect([...afterClickB.ids]).toEqual(['b']);
  });

  // TC-14: removing the last member empties the selection.
  it('TC-14 toggling the last selected object clears the selection', () => {
    const one = apply(empty, { type: 'click', id: 'a' });
    const emptied = apply(one, { type: 'toggle', id: 'a' });
    expect(emptied.ids.size).toBe(0);
    expect(emptied.editingId).toBeNull();
  });

  // TC-15: prune keeps what is present and drops a vanished editing id.
  it('TC-15 prune keeps present ids and ends editing of a pruned object', () => {
    const many = apply(empty, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    const pruned = apply(many, { type: 'prune', presentIds: set('a', 'c', 'd') });
    expect([...pruned.ids].sort()).toEqual(['a', 'c']);

    // Editing a pruned object ends. Build a state that is editing `b` while a
    // three-object selection is live, then prune `b` out from under it.
    const editing: SelectionState = { ids: set('a', 'b', 'c'), editingId: 'b' };
    const prunedEditing = apply(editing, { type: 'prune', presentIds: set('a', 'c', 'd') });
    expect(prunedEditing.editingId).toBeNull();
    expect([...prunedEditing.ids].sort()).toEqual(['a', 'c']);
  });

  it('setMany is additive for a marquee and exclusive for select-all', () => {
    const start = apply(empty, { type: 'click', id: 'x' });
    const additive = apply(start, { type: 'setMany', ids: ['y', 'z'], additive: true });
    expect([...additive.ids].sort()).toEqual(['x', 'y', 'z']);
    const exclusive = apply(start, { type: 'setMany', ids: ['y', 'z'], additive: false });
    expect([...exclusive.ids].sort()).toEqual(['y', 'z']);
  });

  it('prune with nothing dropped returns the identical state (no needless render)', () => {
    const one = apply(empty, { type: 'click', id: 'a' });
    expect(apply(one, { type: 'prune', presentIds: set('a', 'b') })).toBe(one);
  });

  it('clear empties the selection and editing', () => {
    const editing = apply(empty, { type: 'edit', id: 'a' });
    const cleared = apply(editing, { type: 'clear' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.editingId).toBeNull();
  });

  it('startEdit selects the edited object alone and endEdit keeps it selected', () => {
    const edited = apply(empty, { type: 'edit', id: 'a' });
    expect([...edited.ids]).toEqual(['a']);
    expect(edited.editingId).toBe('a');
    const ended = apply(edited, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect([...ended.ids]).toEqual(['a']);
  });
});
