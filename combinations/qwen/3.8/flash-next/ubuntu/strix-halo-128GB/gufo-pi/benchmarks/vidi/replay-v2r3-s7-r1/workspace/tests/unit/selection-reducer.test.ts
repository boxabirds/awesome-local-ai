import { describe, it, expect } from 'vitest';
import { selectionReducer } from '../../src/client/board/useSelection';
import type { SelectionState, SelectionAction } from '../../src/client/board/useSelection';

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };

function makeState(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer — click/toggle (TC-13)', () => {
  it('empty → click a → {a}', () => {
    const result = selectionReducer(EMPTY, { type: 'click', id: 'a' });
    expect(result.ids).toEqual(new Set(['a']));
  });

  it('{a} → toggle b → {a,b}', () => {
    const state = makeState(['a']);
    const result = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(result.ids).toEqual(new Set(['a', 'b']));
  });

  it('{a,b} → click b → {b} (click replaces set)', () => {
    const state = makeState(['a', 'b']);
    const result = selectionReducer(state, { type: 'click', id: 'b' });
    expect(result.ids).toEqual(new Set(['b']));
  });

  it('{a,b} → toggle a → {b} (toggle removes)', () => {
    const state = makeState(['a', 'b']);
    const result = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(result.ids).toEqual(new Set(['b']));
  });
});

describe('selectionReducer — toggle last member (TC-14)', () => {
  it('{a} → toggle a → {} (empty)', () => {
    const state = makeState(['a']);
    const result = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(result.ids).toEqual(new Set());
  });
});

describe('selectionReducer — prune (TC-15)', () => {
  it('{a,b,c} → prune present {a,c,d} → {a,c}', () => {
    const state = makeState(['a', 'b', 'c']);
    const result = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(result.ids).toEqual(new Set(['a', 'c']));
  });

  it('editingId b → prune removes b → editingId becomes null', () => {
    const state = makeState(['a', 'b', 'c'], 'b');
    const result = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(result.ids).toEqual(new Set(['a', 'c']));
    expect(result.editingId).toBeNull();
  });

  it('editingId a → prune keeps a → editingId unchanged', () => {
    const state = makeState(['a', 'b'], 'a');
    const result = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(result.ids).toEqual(new Set(['a']));
    expect(result.editingId).toBe('a');
  });

  it('all pruned → empty set', () => {
    const state = makeState(['a', 'b'], 'a');
    const result = selectionReducer(state, { type: 'prune', presentIds: new Set(['x', 'y']) });
    expect(result.ids).toEqual(new Set());
    expect(result.editingId).toBeNull();
  });
});

describe('selectionReducer — setMany', () => {
  it('setMany non-additive replaces the selection', () => {
    const state = makeState(['a']);
    const result = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(result.ids).toEqual(new Set(['b', 'c']));
  });

  it('setMany additive merges with existing', () => {
    const state = makeState(['a']);
    const result = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(result.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('setMany non-additive with empty array → empty', () => {
    const state = makeState(['a', 'b']);
    const result = selectionReducer(state, { type: 'setMany', ids: [], additive: false });
    expect(result.ids).toEqual(new Set());
  });
});

describe('selectionReducer — clear', () => {
  it('clears selection and editingId', () => {
    const state = makeState(['a', 'b'], 'a');
    const result = selectionReducer(state, { type: 'clear' });
    expect(result.ids).toEqual(new Set());
    expect(result.editingId).toBeNull();
  });
});

describe('selectionReducer — edit', () => {
  it('edit sets editingId and ensures the id is in selection', () => {
    const state = makeState(['a']);
    const result = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(result.editingId).toBe('a');
    expect(result.ids.has('a')).toBe(true);
  });

  it('edit null clears editingId', () => {
    const state = makeState(['a'], 'a');
    const result = selectionReducer(state, { type: 'edit', id: null });
    expect(result.editingId).toBeNull();
  });
});
