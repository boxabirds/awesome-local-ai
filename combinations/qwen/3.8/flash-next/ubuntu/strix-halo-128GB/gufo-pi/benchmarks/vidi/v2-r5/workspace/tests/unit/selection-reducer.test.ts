import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

describe('selectionReducer: TC-13 click / toggle sequence', () => {
  const empty: SelectionState = { ids: new Set(), editingId: null };

  it('click replaces the selection', () => {
    const s1 = selectionReducer(empty, { type: 'click', id: 'a' });
    expect(s1.ids).toEqual(new Set(['a']));
    expect(s1.editingId).toBeNull();
  });

  it('toggle adds to selection', () => {
    const s1 = selectionReducer(empty, { type: 'click', id: 'a' });
    const s2 = selectionReducer(s1, { type: 'toggle', id: 'b' });
    expect(s2.ids).toEqual(new Set(['a', 'b']));
  });

  it('click after toggle replaces entire selection', () => {
    let state = selectionReducer(empty, { type: 'click', id: 'a' });
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });
});

describe('selectionReducer: TC-14 toggle removes last member', () => {
  it('toggle on only member → empty', () => {
    const s1: SelectionState = { ids: new Set(['a']), editingId: null };
    const s2 = selectionReducer(s1, { type: 'toggle', id: 'a' });
    expect(s2.ids.size).toBe(0);
  });
});

describe('selectionReducer: TC-15 prune', () => {
  it('removes deleted ids, keeps others', () => {
    const state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    const present = new Set(['a', 'c', 'd']);
    const result = selectionReducer(state, { type: 'prune', presentIds: present });
    expect(result.ids).toEqual(new Set(['a', 'c']));
  });

  it('if editingId is pruned, editingId becomes null', () => {
    const state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    const present = new Set(['a', 'c', 'd']);
    const result = selectionReducer(state, { type: 'prune', presentIds: present });
    expect(result.ids).toEqual(new Set(['a', 'c']));
    expect(result.editingId).toBeNull();
  });
});

describe('selectionReducer: setMany', () => {
  it('non-additive replaces selection', () => {
    const state: SelectionState = { ids: new Set(['x']), editingId: null };
    const result = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(result.ids).toEqual(new Set(['a', 'b']));
  });

  it('additive merges with existing', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: null };
    const result = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(result.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('setMany with empty ids, non-additive clears selection', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: null };
    const result = selectionReducer(state, { type: 'setMany', ids: [], additive: false });
    expect(result.ids.size).toBe(0);
  });
});

describe('selectionReducer: clear', () => {
  it('clear empties the selection', () => {
    const state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    const result = selectionReducer(state, { type: 'clear' });
    expect(result.ids.size).toBe(0);
    expect(result.editingId).toBeNull();
  });
});

describe('selectionReducer: edit', () => {
  it('edit sets editingId', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: null };
    const result = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(result.editingId).toBe('a');
  });

  it('edit null ends editing', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const result = selectionReducer(state, { type: 'edit', id: null });
    expect(result.editingId).toBeNull();
  });
});
