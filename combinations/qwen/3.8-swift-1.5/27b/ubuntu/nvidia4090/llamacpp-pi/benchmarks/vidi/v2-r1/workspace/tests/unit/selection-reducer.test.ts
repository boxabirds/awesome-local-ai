import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '@client/board/useSelection';

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('sel.interaction (selectionReducer)', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  it('TC-13: click replaces the set; toggle adds; click replaces again', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  // TC-14: {a} → toggle a → {} (removing the last member, boundary)
  it('TC-14: toggling the only selected id empties the selection', () => {
    const s = selectionReducer(state(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('toggle removes a selected id, keeping the others', () => {
    const s = selectionReducer(state(['a', 'b', 'c']), { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editing a pruned id ends editing
  it('TC-15: prune removes ids no longer present; keeps the rest', () => {
    const s = selectionReducer(state(['a', 'b', 'c']), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  it('TC-15b: prune ends editing when the edited id is removed', () => {
    const s = selectionReducer(state(['a', 'b', 'c'], 'b'), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect(s.editingId).toBeNull();
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  it('prune keeps editing when the edited id is still present', () => {
    const s = selectionReducer(state(['a', 'b'], 'a'), {
      type: 'prune',
      presentIds: new Set(['a', 'b']),
    });
    expect(s.editingId).toBe('a');
    // No change → same state object (referential stability)
    const before: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    expect(selectionReducer(before, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(before);
  });

  it('setMany additive adds to the existing selection', () => {
    const s = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('setMany non-additive replaces the selection', () => {
    const s = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect([...s.ids].sort()).toEqual(['b', 'c']);
  });

  it('setMany additive with no ids leaves the selection unchanged', () => {
    const s = selectionReducer(state(['a']), { type: 'setMany', ids: [], additive: true });
    expect([...s.ids]).toEqual(['a']);
  });

  it('setMany non-additive with no ids empties the selection (empty board select-all)', () => {
    const s = selectionReducer(state(['a']), { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });

  it('clear empties ids and ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit action sets/clears editingId without touching ids', () => {
    let s = selectionReducer(state(['a']), { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    expect([...s.ids]).toEqual(['a']);
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect([...s.ids]).toEqual(['a']);
  });

  it('click ends editing of another object', () => {
    const s = selectionReducer(state(['a'], 'a'), { type: 'click', id: 'b' });
    expect(s.editingId).toBeNull();
    expect([...s.ids]).toEqual(['b']);
  });
});
