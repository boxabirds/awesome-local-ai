// Unit tests for the selection reducer (story 7, sel.interaction):
// TC-13 to TC-15 — click, toggle, setMany, clear, prune, edit.

import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const state = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

const idsOf = (s: SelectionState): string[] => [...s.ids].sort();

describe('sel.interaction: selectionReducer (unit)', () => {
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b} (click replaces the set)', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(idsOf(s)).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);

    // Clicking an already-selected object replaces the whole selection.
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
  });

  it('TC-14: {a} → toggle a → {} (removing the last member)', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; pruned editing id ends editing', () => {
    let s = state(['a', 'b', 'c'], 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(idsOf(s)).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();

    // Editing an id that survives the prune is kept.
    s = state(['a', 'b', 'c'], 'a');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.editingId).toBe('a');
  });

  it('setMany: additive adds to the selection, non-additive replaces it', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(idsOf(s)).toEqual(['a', 'b', 'c']);

    s = selectionReducer(s, { type: 'setMany', ids: ['d'], additive: false });
    expect(idsOf(s)).toEqual(['d']);
  });

  it('clear: empties the selection and ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit: starts and ends editing without touching the selection', () => {
    let s = selectionReducer(state(['a']), { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    expect(idsOf(s)).toEqual(['a']);

    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(idsOf(s)).toEqual(['a']);
  });

  it('reducer never throws for repeated or duplicate ids', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'a', 'b'], additive: true });
    expect(idsOf(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(idsOf(s)).toEqual(['a', 'b']);
  });
});
