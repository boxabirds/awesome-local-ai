import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  type SelectionState,
  type SelectionAction,
} from '@/client/board/useSelection';

/**
 * Unit tests for the pure selection reducer (story 7, sel.interaction).
 * The hook-level presence guard (ignoring actions for ids absent from the
 * snapshot) is covered by component tests; here the reducer itself is
 * exercised, including the error path "actions for ids absent from the
 * snapshot are ignored" via prune (the only way a stale id can remain).
 */

const state = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

const apply = (s: SelectionState, ...actions: SelectionAction[]): SelectionState =>
  actions.reduce(selectionReducer, s);

const idsOf = (s: SelectionState): string[] => [...s.ids].sort();

describe('selectionReducer (story 7)', () => {
  it('TC-13: click replaces the set; toggle adds (shift-click)', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(idsOf(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']); // click replaces the set
    expect(s.editingId).toBeNull();
  });

  it('TC-14: toggling the last member empties the set (boundary)', () => {
    const s = selectionReducer(state(['a']), { type: 'toggle', id: 'a' });
    expect(idsOf(s)).toEqual([]);
    expect(s.editingId).toBeNull();
  });

  it('TC-15: prune removes ids deleted remotely and ends editing of a pruned id', () => {
    let s = state(['a', 'b', 'c'], 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(idsOf(s)).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull(); // editing the pruned id ends

    // Pruning to the same set is a no-op (same state object).
    const again = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(again).toBe(s);
  });

  it('setMany: additive adds to the current set, non-additive replaces it', () => {
    const s1 = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(idsOf(s1)).toEqual(['a', 'b', 'c']);

    const s2 = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(idsOf(s2)).toEqual(['b', 'c']);

    // An empty additive batch leaves the selection unchanged (stable state).
    const before = state(['a']);
    const s3 = selectionReducer(before, { type: 'setMany', ids: [], additive: true });
    expect(s3).toBe(before);

    // Non-additive on an empty board: empty set, no error (TC-28 reducer half).
    const s4 = selectionReducer(state([]), { type: 'setMany', ids: [], additive: false });
    expect(idsOf(s4)).toEqual([]);
  });

  it('clear empties the set and ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], 'a'), { type: 'clear' });
    expect(idsOf(s)).toEqual([]);
    expect(s.editingId).toBeNull();
    // Clearing an already-empty state is a no-op.
    const empty = state([]);
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });

  it('edit: entering edit selects the object; ending edit keeps the selection', () => {
    let s = selectionReducer(state(['a']), { type: 'edit', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);
    expect(s.editingId).toBe('b');

    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(idsOf(s)).toEqual(['a', 'b']); // selection survives endEdit
  });

  it('toggling off an edited object ends the edit (error path)', () => {
    const s = selectionReducer(state(['a', 'b'], 'b'), { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a']);
    expect(s.editingId).toBeNull();
  });

  it('re-clicking the only selected, unedited note is a no-op', () => {
    const s = state(['a']);
    expect(selectionReducer(s, { type: 'click', id: 'a' })).toBe(s);
  });

  it('apply sequence: TC-13 full trace', () => {
    const s = apply(state([]), { type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
  });
});
