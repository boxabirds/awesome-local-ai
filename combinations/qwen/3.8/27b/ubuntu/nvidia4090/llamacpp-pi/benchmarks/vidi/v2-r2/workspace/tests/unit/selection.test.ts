/**
 * Story 7: selection reducer unit tests (TC-13 to TC-15) plus setMany
 * additive/non-additive and absent-id error paths.
 */

import { describe, expect, it } from 'vitest';
import {
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer (sel.interaction)', () => {
  it('TC-13: click replaces the set; toggle adds', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);
    // Click replaces the whole set.
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('TC-14: toggle removes the last member (boundary)', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: prune drops absent ids; editing a pruned id ends', () => {
    let s = state(['a', 'b', 'c'], 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('setMany additive unions with the current set', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('setMany non-additive replaces the set (empty board → empty set)', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'setMany', ids: ['c'], additive: false });
    expect([...s.ids]).toEqual(['c']);
    s = selectionReducer(s, { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });

  it('click ends editing; clear ends editing (error paths)', () => {
    let s = state(['a'], 'a');
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(s.editingId).toBeNull();
    s = state(['a'], 'a');
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('idempotent: repeating a no-op action returns the same state object', () => {
    const s = state(['a']);
    expect(selectionReducer(s, { type: 'click', id: 'a' })).toBe(s);
    const empty = state([]);
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });
});
