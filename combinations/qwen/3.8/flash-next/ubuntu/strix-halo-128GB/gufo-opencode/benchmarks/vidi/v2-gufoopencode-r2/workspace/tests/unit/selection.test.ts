// TC-13 to TC-15: the selection reducer's state machine.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

describe('selection reducer', () => {
  it('TC-13: {} -> click a -> {a} -> toggle b -> {a,b} -> click b -> {b}', () => {
    let state: SelectionState = EMPTY_SELECTION;
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect([...state.ids]).toEqual(['a']);
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect([...state.ids].sort()).toEqual(['a', 'b']);
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect([...state.ids]).toEqual(['b']);
  });

  it('TC-14: toggle removes ids down to empty', () => {
    const two: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    const one = selectionReducer(two, { type: 'toggle', id: 'a' });
    expect([...one.ids]).toEqual(['b']);
    const none = selectionReducer(one, { type: 'toggle', id: 'b' });
    expect(none).toBe(EMPTY_SELECTION);
  });

  it('TC-14b: a second toggle of an unselected id adds it back', () => {
    const one: SelectionState = { ids: new Set(['a']), editingId: null };
    const two = selectionReducer(one, { type: 'toggle', id: 'b' });
    expect([...two.ids].sort()).toEqual(['a', 'b']);
  });

  it('TC-15: prune drops remotely deleted ids', () => {
    const state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    const pruned = selectionReducer(state, {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect([...pruned.ids].sort()).toEqual(['a', 'c']);
  });

  it('prune of every id returns Empty; a pruned editingId ends editing', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const none = selectionReducer(state, { type: 'prune', presentIds: new Set(['b']) });
    expect(none).toBe(EMPTY_SELECTION);
  });

  it('setMany replaces or adds; keeps editing only if the edited id survives', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const replaced = selectionReducer(state, { type: 'setMany', ids: ['b'], additive: false });
    expect([...replaced.ids]).toEqual(['b']);
    expect(replaced.editingId).toBeNull();
    const added = selectionReducer(state, { type: 'setMany', ids: ['b'], additive: true });
    expect([...added.ids].sort()).toEqual(['a', 'b']);
    expect(added.editingId).toBe('a');
    const kept = selectionReducer(state, { type: 'setMany', ids: ['a', 'c'], additive: false });
    expect(kept.editingId).toBe('a');
  });

  it('clear empties; click replaces with a single id; edit only moves editingId', () => {
    const state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    expect(selectionReducer(state, { type: 'clear' })).toBe(EMPTY_SELECTION);
    const clicked = selectionReducer(state, { type: 'click', id: 'c' });
    expect([...clicked.ids]).toEqual(['c']);
    const edited = selectionReducer(clicked, { type: 'edit', id: 'c' });
    expect(edited.editingId).toBe('c');
    expect([...edited.ids]).toEqual(['c']);
    expect(selectionReducer(edited, { type: 'edit', id: null }).editingId).toBeNull();
  });

  it('unchanged actions are referentially stable (no render churn)', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: null };
    expect(selectionReducer(state, { type: 'click', id: 'a' })).toBe(state);
    expect(selectionReducer(state, { type: 'setMany', ids: ['a'], additive: false })).toBe(state);
    expect(selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(state);
    expect(selectionReducer(state, { type: 'edit', id: null })).toBe(state);
  });
});
