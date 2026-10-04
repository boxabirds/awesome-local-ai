import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer', () => {
  // TC-13
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = state([]);

    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    expect(s.editingId).toBeNull();

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    // click replaces the set
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  // TC-14
  it('TC-14: {a} → toggle a → {} (removing last member)', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  // TC-15
  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editingId b → null', () => {
    let s = state(['a', 'b', 'c'], 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('prune keeps editingId if still present', () => {
    let s = state(['a', 'b', 'c'], 'a');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBe('a');
  });

  it('setMany additive adds to existing selection', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('setMany non-additive replaces selection', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'setMany', ids: ['c', 'd'], additive: false });
    expect([...s.ids].sort()).toEqual(['c', 'd']);
    expect(s.editingId).toBeNull();
  });

  it('clear empties selection and editing', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit sets editingId and selects only that id', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'edit', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    expect(s.editingId).toBe('a');
  });

  it('edit null clears editingId but keeps selection', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(s.ids.size).toBe(2);
  });

  it('toggle removes editingId if toggled off', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(1);
    expect(s.editingId).toBeNull();
  });
});
