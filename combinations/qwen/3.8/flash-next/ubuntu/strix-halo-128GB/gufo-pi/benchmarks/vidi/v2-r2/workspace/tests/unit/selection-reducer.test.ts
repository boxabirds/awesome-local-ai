import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '@client/board/useSelection';

describe('selectionReducer', () => {
  const empty: SelectionState = { ids: new Set<string>(), editingId: null };

  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  it('TC-13: click replaces set, toggle adds, click b alone gives {b}', () => {
    let state = empty;
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(state.ids).toEqual(new Set(['a']));

    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(new Set(['a', 'b']));

    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });

  // TC-14: {a} → toggle a → {} (removing last member)
  it('TC-14: toggle removes last member → empty selection', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids).toEqual(new Set());
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editingId b → null
  it('TC-15: prune removes ids not in present set', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
  });

  it('TC-15: prune clears editingId if pruned', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBeNull();
  });

  it('TC-15: prune keeps editingId if still present', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'a' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBe('a');
  });

  // setMany non-additive (select all)
  it('setMany non-additive replaces the set', () => {
    let state: SelectionState = { ids: new Set(['x']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    expect(state.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  // setMany additive (marquee)
  it('setMany additive adds to existing selection', () => {
    let state: SelectionState = { ids: new Set(['x']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(state.ids).toEqual(new Set(['x', 'a', 'b']));
  });

  // clear
  it('clear empties the set', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    state = selectionReducer(state, { type: 'clear' });
    expect(state.ids).toEqual(new Set());
  });

  // edit action
  it('edit sets editingId', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
  });

  it('edit with null clears editingId', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    state = selectionReducer(state, { type: 'edit', id: null });
    expect(state.editingId).toBeNull();
  });
});
