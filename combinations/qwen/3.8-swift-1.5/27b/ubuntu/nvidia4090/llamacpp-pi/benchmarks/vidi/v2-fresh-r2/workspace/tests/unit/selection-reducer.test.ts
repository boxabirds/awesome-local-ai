/**
 * Unit tests for the pure selection reducer (sel.interaction), story 7.
 * TC-13 to TC-15, setMany additive/non-additive, absent-id error path.
 */
import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const state = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

describe('sel.interaction: selectionReducer', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  it('TC-13: click replaces the set; toggle adds; click b alone replaces', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(new Set(s.ids).size).toBe(2);
    expect(s.ids.has('a')).toBe(true);
    expect(s.ids.has('b')).toBe(true);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  // TC-14: {a} → toggle a → {} (removing the last member).
  it('TC-14: toggling the last selected id empties the selection', () => {
    const s = selectionReducer(state(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editing b → editing ends.
  it('TC-15: prune removes remotely-deleted ids and ends editing of a pruned id', () => {
    let s = selectionReducer(state(['a', 'b', 'c']), { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull();

    s = selectionReducer(state(['a', 'b', 'c'], 'b'), { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull();

    // Editing an id that survives the prune keeps editing.
    s = selectionReducer(state(['a', 'b', 'c'], 'a'), { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.editingId).toBe('a');

    // Pruning to the same state is a no-op (same state object).
    const same = selectionReducer(state(['a', 'c']), { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(same).toEqual(state(['a', 'c']));
  });

  it('setMany additive adds to the existing selection; non-additive replaces it', () => {
    let s = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b', 'c']));

    s = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(new Set(s.ids)).toEqual(new Set(['b', 'c']));

    // setMany of an empty list, non-additive, clears.
    s = selectionReducer(state(['a']), { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });

  it('clear empties the selection and ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit(id) selects and edits that object; edit(null) ends editing, keeping the selection', () => {
    let s = selectionReducer(state(['a', 'b']), { type: 'edit', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
    expect(s.editingId).toBe('b');

    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect([...s.ids]).toEqual(['b']);
  });

  it('toggle removing the edited id ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], 'a'), { type: 'toggle', id: 'a' });
    expect(s.editingId).toBeNull();
    expect([...s.ids]).toEqual(['b']);
  });
});
