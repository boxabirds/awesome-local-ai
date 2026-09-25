import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

/**
 * Story 7 selection-reducer unit tests (task 9, TC-13 to TC-15) plus the
 * setMany / clear / edit semantics. The snapshot-validation error path
 * (actions referencing ids not in the snapshot are ignored) is exercised in
 * the component project, where `useSelection` runs with a real snapshot.
 */

describe('selectionReducer', () => {
  it('TC-13 {} → click a {a} → toggle b {a,b} → click b {b}', () => {
    let state: SelectionState = { ids: new Set<string>(), editingId: null };
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect([...state.ids]).toEqual(['a']);
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(new Set(state.ids)).toEqual(new Set(['a', 'b']));
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect([...state.ids]).toEqual(['b']);
  });

  it('click on the only selected object is a no-op (stable state)', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: null };
    expect(selectionReducer(state, { type: 'click', id: 'a' })).toBe(state);
  });

  it('TC-14 {a} → toggle a → {} (removes it)', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids.size).toBe(0);
  });

  it('TC-15 {a,b,c} → prune presentIds {a,c,d} → {a,c}; editingId b → null', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(new Set(state.ids)).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBeNull();
    // The editing id survives the prune when it is still present.
    state = { ids: new Set(['a', 'c']), editingId: 'a' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.editingId).toBe('a');
  });

  it('prune with nothing missing keeps the same state object', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: null };
    expect(selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(state);
  });

  it('setMany additive adds; non-additive replaces; empty non-additive clears', () => {
    const base: SelectionState = { ids: new Set(['a']), editingId: null };
    const additive = selectionReducer(base, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(new Set(additive.ids)).toEqual(new Set(['a', 'b', 'c']));
    const replace = selectionReducer(base, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(new Set(replace.ids)).toEqual(new Set(['b', 'c']));
    const cleared = selectionReducer(base, { type: 'setMany', ids: [], additive: false });
    expect(cleared.ids.size).toBe(0);
    // Re-applying the same list is idempotent (stable state object).
    expect(selectionReducer(replace, { type: 'setMany', ids: ['b', 'c'], additive: false })).toBe(replace);
  });

  it('clear drops the selection and any in-progress edit', () => {
    const state = selectionReducer({ ids: new Set(['a']), editingId: 'a' }, { type: 'clear' });
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
    expect(selectionReducer(state, { type: 'clear' })).toBe(state); // already empty
  });

  it('edit: at most one editing id; editing selects exactly that object', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    state = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
    expect([...state.ids]).toEqual(['a']);
    state = selectionReducer(state, { type: 'edit', id: 'b' });
    expect(state.editingId).toBe('b'); // replaces, never two editors
    expect([...state.ids]).toEqual(['b']);
    state = selectionReducer(state, { type: 'edit', id: null });
    expect(state.editingId).toBeNull();
    // The selection is kept when the edit ends (the object stays selected).
    expect([...state.ids]).toEqual(['b']);
  });
});
