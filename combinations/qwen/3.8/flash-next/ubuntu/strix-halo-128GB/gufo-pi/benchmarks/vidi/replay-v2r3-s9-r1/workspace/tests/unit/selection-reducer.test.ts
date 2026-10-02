import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState, type SelectionAction } from '../../src/client/board/useSelection';

const empty: SelectionState = { ids: new Set(), editingId: null };

function ids(...items: string[]): Set<string> {
  return new Set(items);
}

describe('selectionReducer', () => {
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let state = empty;

    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(state.ids).toEqual(ids('a'));
    expect(state.editingId).toBeNull();

    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(ids('a', 'b'));

    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(ids('b'));
  });

  it('TC-14: {a} → toggle a → {} (removing last member)', () => {
    const state: SelectionState = { ids: ids('a'), editingId: null };
    const result = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(result.ids).toEqual(new Set());
  });

  it('TC-15: {a,b,c} → prune {a,c,d} → {a,c}', () => {
    const state: SelectionState = { ids: ids('a', 'b', 'c'), editingId: null };
    const result = selectionReducer(state, { type: 'prune', presentIds: ids('a', 'c', 'd') });
    expect(result.ids).toEqual(ids('a', 'c'));
  });

  it('TC-15: pruning editingId stops editing', () => {
    const state: SelectionState = { ids: ids('a', 'b'), editingId: 'b' };
    const result = selectionReducer(state, { type: 'prune', presentIds: ids('a') });
    expect(result.ids).toEqual(ids('a'));
    expect(result.editingId).toBeNull();
  });

  it('setMany additive=true adds to existing selection', () => {
    const state: SelectionState = { ids: ids('a'), editingId: null };
    const result = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(result.ids).toEqual(ids('a', 'b', 'c'));
  });

  it('setMany additive=false replaces selection', () => {
    const state: SelectionState = { ids: ids('a', 'b'), editingId: null };
    const result = selectionReducer(state, { type: 'setMany', ids: ['c', 'd'], additive: false });
    expect(result.ids).toEqual(ids('c', 'd'));
    expect(result.editingId).toBeNull();
  });

  it('clear empties the selection and stops editing', () => {
    const state: SelectionState = { ids: ids('a', 'b'), editingId: 'a' };
    const result = selectionReducer(state, { type: 'clear' });
    expect(result.ids).toEqual(new Set());
    expect(result.editingId).toBeNull();
  });

  it('edit action adds id to selection and sets editingId', () => {
    const state: SelectionState = { ids: ids('a'), editingId: null };
    const result = selectionReducer(state, { type: 'edit', id: 'b' });
    expect(result.ids).toEqual(ids('a', 'b'));
    expect(result.editingId).toBe('b');
  });

  it('edit null stops editing but keeps selection', () => {
    const state: SelectionState = { ids: ids('a', 'b'), editingId: 'a' };
    const result = selectionReducer(state, { type: 'edit', id: null });
    expect(result.ids).toEqual(ids('a', 'b'));
    expect(result.editingId).toBeNull();
  });

  it('toggle a new item adds it; toggle existing removes it', () => {
    const state: SelectionState = { ids: ids('a', 'b'), editingId: null };
    let result = selectionReducer(state, { type: 'toggle', id: 'c' });
    expect(result.ids).toEqual(ids('a', 'b', 'c'));
    result = selectionReducer(result, { type: 'toggle', id: 'a' });
    expect(result.ids).toEqual(ids('b', 'c'));
  });
});
