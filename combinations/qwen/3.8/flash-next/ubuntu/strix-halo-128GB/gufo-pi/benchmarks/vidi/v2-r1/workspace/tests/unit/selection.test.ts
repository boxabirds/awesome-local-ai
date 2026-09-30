import { describe, expect, it } from 'vitest';

import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const empty: SelectionState = { ids: new Set<string>(), editingId: null };

describe('selectionReducer', () => {
  it('TC-13 click replaces selection', () => {
    let state = empty;
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(state.ids).toEqual(new Set(['a']));
  });

  it('TC-13 toggle adds', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(new Set(['a', 'b']));
  });

  it('TC-13 click replaces after toggle', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });

  it('TC-14 toggle removes last member → empty', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids).toEqual(new Set());
    expect(state.editingId).toBeNull();
  });

  it('TC-15 prune removes deleted ids, keeps remaining', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
  });

  it('TC-15 prune ends editing if edited id is removed', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBeNull();
  });

  it('prune all → empty', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set() });
    expect(state.ids).toEqual(new Set());
  });

  it('setMany non-additive replaces', () => {
    let state: SelectionState = { ids: new Set(['x']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(state.ids).toEqual(new Set(['a', 'b']));
  });

  it('setMany additive adds to existing', () => {
    let state: SelectionState = { ids: new Set(['x']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(state.ids).toEqual(new Set(['x', 'a', 'b']));
  });

  it('clear empties selection and editing', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    state = selectionReducer(state, { type: 'clear' });
    expect(state.ids).toEqual(new Set());
    expect(state.editingId).toBeNull();
  });

  it('edit sets editingId', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
    expect(state.ids).toEqual(new Set(['a']));
  });
});
