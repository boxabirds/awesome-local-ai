import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  type SelectionState,
  type SelectionAction,
} from '../../src/client/board/useSelection';

function empty(): SelectionState {
  return { ids: new Set(), editingId: null };
}

describe('selectionReducer — TC-13', () => {
  it('{} → click a → {a}', () => {
    const s = selectionReducer(empty(), { type: 'click', id: 'a' });
    expect(s.ids).toEqual(new Set(['a']));
  });

  it('{a} → toggle b → {a,b}', () => {
    const s0 = { ids: new Set(['a']), editingId: null };
    const s = selectionReducer(s0, { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(new Set(['a', 'b']));
  });

  it('{a,b} → click b → {b} (click replaces set)', () => {
    const s0 = { ids: new Set(['a', 'b']), editingId: null };
    const s = selectionReducer(s0, { type: 'click', id: 'b' });
    expect(s.ids).toEqual(new Set(['b']));
  });
});

describe('selectionReducer — TC-14', () => {
  it('{a} → toggle a → {} (removing last member)', () => {
    const s0 = { ids: new Set(['a']), editingId: null };
    const s = selectionReducer(s0, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });
});

describe('selectionReducer — TC-15', () => {
  it('{a,b,c} → prune present {a,c,d} → {a,c}', () => {
    const s0 = { ids: new Set(['a', 'b', 'c']), editingId: null };
    const s = selectionReducer(s0, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
  });

  it('prune removes editingId when it is pruned', () => {
    const s0 = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    const s = selectionReducer(s0, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull();
  });

  it('prune keeps editingId when it remains present', () => {
    const s0 = { ids: new Set(['a', 'b', 'c']), editingId: 'a' };
    const s = selectionReducer(s0, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBe('a');
  });
});

describe('selectionReducer — setMany', () => {
  it('setMany non-additive replaces the selection', () => {
    const s0 = { ids: new Set(['x']), editingId: null };
    const s = selectionReducer(s0, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(s.ids).toEqual(new Set(['a', 'b']));
  });

  it('setMany additive merges with existing selection', () => {
    const s0 = { ids: new Set(['a']), editingId: null };
    const s = selectionReducer(s0, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(s.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('setMany with empty ids non-additive clears the selection', () => {
    const s0 = { ids: new Set(['a', 'b']), editingId: null };
    const s = selectionReducer(s0, { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });

  it('setMany with empty ids additive is a no-op', () => {
    const s0 = { ids: new Set(['a']), editingId: null };
    const s = selectionReducer(s0, { type: 'setMany', ids: [], additive: true });
    expect(s.ids).toEqual(new Set(['a']));
  });
});

describe('selectionReducer — clear', () => {
  it('clear empties the selection and ends editing', () => {
    const s0 = { ids: new Set(['a', 'b']), editingId: 'a' };
    const s = selectionReducer(s0, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });
});

describe('selectionReducer — edit', () => {
  it('edit sets editingId and ensures the id is selected', () => {
    const s0 = { ids: new Set(['a']), editingId: null };
    const s = selectionReducer(s0, { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    expect(s.ids.has('a')).toBe(true);
  });

  it('edit with null ends editing', () => {
    const s0 = { ids: new Set(['a']), editingId: 'a' };
    const s = selectionReducer(s0, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(s.ids.has('a')).toBe(true);
  });
});

describe('selectionReducer — toggle removes selected', () => {
  it('toggle removes an already-selected item from a multi-selection', () => {
    const s0 = { ids: new Set(['a', 'b', 'c']), editingId: null };
    const s = selectionReducer(s0, { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(new Set(['a', 'c']));
  });
});
