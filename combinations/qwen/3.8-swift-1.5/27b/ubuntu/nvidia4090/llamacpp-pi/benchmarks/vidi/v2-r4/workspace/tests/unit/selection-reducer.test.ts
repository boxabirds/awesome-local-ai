import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer unit tests', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  it('TC-13: click replaces set, toggle adds/removes', () => {
    let s = state([]);

    // Click a
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    expect(s.editingId).toBeNull();

    // Toggle b (add)
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    // Click b (replaces set with just b)
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  // TC-14: {a} → toggle a → {} (removing last member)
  it('TC-14: toggle removes last member, resulting in empty set', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}
  it('TC-15: prune removes ids not in present set', () => {
    let s = state(['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  it('TC-15: prune ends editing if editingId is pruned', () => {
    let s = state(['a', 'b', 'c'], 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(s.editingId).toBeNull();
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  it('TC-15: prune keeps editingId if still present', () => {
    let s = state(['a', 'b', 'c'], 'a');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(s.editingId).toBe('a');
  });

  // setMany additive vs non-additive
  it('setMany additive adds to existing selection', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('setMany non-additive replaces selection', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect([...s.ids].sort()).toEqual(['b', 'c']);
  });

  // clear
  it('clear empties the selection', () => {
    let s = state(['a', 'b', 'c'], 'a');
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  // edit
  it('edit sets editingId', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    expect(s.ids.size).toBe(2);
  });

  it('edit with null clears editingId', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
  });

  // toggle adds new id
  it('toggle adds an id not in the selection', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'c' });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });
});
