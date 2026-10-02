import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  initialSelectionState,
  type SelectionState,
} from '../../src/client/board/useSelection';

describe('sel.interaction (selectionReducer)', () => {
  const empty: SelectionState = { ids: new Set(), editingId: null };
  const one = (id: string): SelectionState => ({ ids: new Set([id]), editingId: null });

  // TC-13
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b} (click replaces the set)', () => {
    let s = selectionReducer(empty, { type: 'click', id: 'a' });
    expect(s.ids).toEqual(new Set(['a']));
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(new Set(['a', 'b']));
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(s.ids).toEqual(new Set(['b']));
  });

  // TC-14
  it('TC-14: {a} → toggle a → {} (removing the last member)', () => {
    const s = selectionReducer(one('a'), { type: 'toggle', id: 'a' });
    expect(s.ids).toEqual(new Set());
  });

  it('toggle on an unselected id adds it, leaving the rest unchanged', () => {
    let s = selectionReducer(one('a'), { type: 'toggle', id: 'c' });
    expect(s.ids).toEqual(new Set(['a', 'c']));
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids).toEqual(new Set(['c']));
  });

  // TC-15
  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; pruned editing id ends editing', () => {
    let s: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull();

    // Pruning keeps a surviving editing id.
    s = { ids: new Set(['a', 'b', 'c']), editingId: 'c' };
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.editingId).toBe('c');
  });

  it('setMany additive keeps the existing selection; non-additive replaces it', () => {
    const base = one('x');
    const additive = selectionReducer(base, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(additive.ids).toEqual(new Set(['x', 'a', 'b']));
    const replace = selectionReducer(base, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(replace.ids).toEqual(new Set(['a', 'b']));
  });

  it('setMany of an empty list leaves the additive selection unchanged', () => {
    const s = selectionReducer(one('x'), { type: 'setMany', ids: [], additive: true });
    expect(s.ids).toEqual(new Set(['x']));
  });

  it('clear empties the selection and ends editing', () => {
    const s = selectionReducer({ ids: new Set(['a', 'b']), editingId: 'a' }, { type: 'clear' });
    expect(s.ids).toEqual(new Set());
    expect(s.editingId).toBeNull();
  });

  it('edit sets the editing id; selecting a different object ends editing', () => {
    let s = selectionReducer(one('a'), { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(s.editingId).toBeNull();
    expect(s.ids).toEqual(new Set(['b']));
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
  });

  it('initial state is empty', () => {
    expect(initialSelectionState.ids).toEqual(new Set());
    expect(initialSelectionState.editingId).toBeNull();
  });
});
