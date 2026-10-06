/**
 * Selection reducer unit tests (TC-13 to TC-15).
 */
import { describe, expect, test } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const EMPTY: SelectionState = { ids: new Set(), editingId: null };

describe('selectionReducer', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  test('TC-13: click replaces, toggle adds, click on already-selected replaces', () => {
    let state = EMPTY;
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(state.ids).toEqual(new Set(['a']));

    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(new Set(['a', 'b']));

    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });

  // TC-14: removing last member → empty
  test('TC-14: toggle removes last member → empty selection', () => {
    let state = selectionReducer(EMPTY, { type: 'click', id: 'a' });
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids).toEqual(new Set());
  });

  // TC-15: prune removes ids not in presentIds
  test('TC-15: prune removes deleted ids, keeps present ones', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
  });

  test('TC-15: prune ends editing of a pruned id', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBeNull();
  });

  test('TC-15: prune keeps editingId if still present', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'a' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBe('a');
  });

  test('setMany non-additive replaces selection', () => {
    let state: SelectionState = { ids: new Set(['x', 'y']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(state.ids).toEqual(new Set(['a', 'b']));
  });

  test('setMany additive adds to existing', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(state.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  test('clear empties selection and editing', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    state = selectionReducer(state, { type: 'clear' });
    expect(state.ids).toEqual(new Set());
    expect(state.editingId).toBeNull();
  });

  test('edit action sets editingId', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
    state = selectionReducer(state, { type: 'edit', id: null });
    expect(state.editingId).toBeNull();
  });

  test('click clears editingId of another note', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
    expect(state.editingId).toBeNull();
  });
});
