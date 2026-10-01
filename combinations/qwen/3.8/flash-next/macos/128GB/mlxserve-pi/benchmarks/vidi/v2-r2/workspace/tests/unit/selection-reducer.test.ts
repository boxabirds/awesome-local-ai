// The selection reducer: one selection, one editing id, sets not singles
// (TC-13 through TC-15). Reducer semantics are framework-free, so they run in
// the node project against the real reducer the hook wires up.

import { describe, expect, it } from 'vitest';
import {
  emptySelection,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

function ids(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('selection reducer', () => {
  // TC-13
  it('walks the golden path: click, shift-toggle twice, and a replacing click', () => {
    let state = emptySelection();

    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(ids(state)).toEqual(['a']);

    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(ids(state)).toEqual(['a', 'b']);

    state = selectionReducer(state, { type: 'toggle', id: 'c' });
    state = selectionReducer(state, { type: 'toggle', id: 'd' });
    state = selectionReducer(state, { type: 'toggle', id: 'e' });
    state = selectionReducer(state, { type: 'toggle', id: 'f' });
    expect(ids(state)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);

    // Shift-clicking a selected note takes it out of the selection.
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(ids(state)).toEqual(['a', 'c', 'd', 'e', 'f']);

    // A plain click on one object selects only it, dropping the other five.
    state = selectionReducer(state, { type: 'click', id: 'e' });
    expect(ids(state)).toEqual(['e']);
    expect(state.editingId).toBeNull();
  });

  it('toggle adds what is absent and removes what is present', () => {
    let state = selectionReducer(emptySelection(), { type: 'toggle', id: 'a' });
    expect(ids(state)).toEqual(['a']);
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(ids(state)).toEqual([]);
  });

  it('setMany replaces or adds as a whole marquee', () => {
    let state = selectionReducer(emptySelection(), { type: 'click', id: 'a' });

    state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c', 'd'], additive: true });
    expect(ids(state)).toEqual(['a', 'b', 'c', 'd']);

    // An empty marquee changes nothing at all.
    const same = selectionReducer(state, { type: 'setMany', ids: [], additive: true });
    expect(same).toBe(state);

    state = selectionReducer(state, { type: 'setMany', ids: ['x'], additive: false });
    expect(ids(state)).toEqual(['x']);
    expect(state.editingId).toBeNull();
  });

  it('clicking an already-solo-selected object is not a change', () => {
    const state = selectionReducer(emptySelection(), { type: 'click', id: 'a' });

    expect(selectionReducer(state, { type: 'click', id: 'a' })).toBe(state);
  });

  it('clear empties the selection and ends editing', () => {
    let state = selectionReducer(emptySelection(), { type: 'edit', id: 'a' });
    state = selectionReducer(state, { type: 'clear' });

    expect(ids(state)).toEqual([]);
    expect(state.editingId).toBeNull();
  });

  // TC-14
  it('prune drops only the gone ids, keeping the order of the rest', () => {
    let state = selectionReducer(emptySelection(), { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });

    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });

    expect(ids(state)).toEqual(['a', 'c']);
  });

  it('prune ends editing when the edited object is the one gone', () => {
    let state = selectionReducer(emptySelection(), { type: 'edit', id: 'b' });
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b', 'c'], additive: true });
    // startEdit soloed the selection onto b and opened it
    expect(state.editingId).toBe('b');

    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });

    expect(ids(state)).toEqual([]);
    expect(state.editingId).toBeNull();
  });

  it('an empty selection is Empty again when the last id is toggled or pruned away', () => {
    let state = selectionReducer(emptySelection(), { type: 'click', id: 'a' });
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();

    state = selectionReducer(state, { type: 'click', id: 'z' });
    state = selectionReducer(state, { type: 'prune', presentIds: new Set() });
    expect(state.ids.size).toBe(0);
  });

  it('prune leaves an untouched selection as the very same state', () => {
    const state = selectionReducer(emptySelection(), { type: 'setMany', ids: ['a', 'b'], additive: false });

    expect(selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(state);
  });

  // TC-15
  it('startEdit solos the object into the selection and carries the editing id', () => {
    let state = selectionReducer(emptySelection(), { type: 'setMany', ids: ['a', 'b'], additive: false });

    state = selectionReducer(state, { type: 'edit', id: 'b' });

    expect(ids(state)).toEqual(['b']);
    expect(state.editingId).toBe('b');
  });

  it('endEdit closes the editor without touching the selection', () => {
    let state = selectionReducer(emptySelection(), { type: 'edit', id: 'a' });
    state = selectionReducer(state, { type: 'setMany', ids: ['b'], additive: true });

    state = selectionReducer(state, { type: 'edit', id: null });

    expect(ids(state)).toEqual(['a', 'b']);
    expect(state.editingId).toBeNull();
  });
});
