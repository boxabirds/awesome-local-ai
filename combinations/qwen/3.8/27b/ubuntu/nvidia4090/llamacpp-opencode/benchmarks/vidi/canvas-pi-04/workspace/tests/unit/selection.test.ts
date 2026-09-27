// Story 7, task 7: selection state unit tests (TC-13..TC-15).
//
// These drive the pure `selectionReducer` directly: click / shift-click build
// and shrink the selection, and `prune` removes ids that left the snapshot.

import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const state = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

describe('TC-13 click / shift-click builds and resets the selection', () => {
  it('{} -> click a -> {a} -> toggle b -> {a,b} -> click b -> {b}', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b']));
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });
});

describe('TC-14 shift-click removing the last selection empties it', () => {
  it('{a} -> toggle a -> {}', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });
});

describe('TC-15 prune removes ids that left the snapshot', () => {
  it('{a,b,c} -> prune live {a,c} -> {a,c}', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    expect(s.ids.size).toBe(3);
    s = selectionReducer(s, { type: 'prune', liveIds: new Set(['a', 'c']) });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'c']));
  });

  it('prune that changes nothing returns the same state (no re-render)', () => {
    const s = state(['a', 'c']);
    const result = selectionReducer(s, { type: 'prune', liveIds: new Set(['a', 'c', 'z']) });
    expect(result).toBe(s);
  });
});

describe('editing is tracked independently of the selection', () => {
  it('startEdit sets editingId, endEdit clears it without touching the selection', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b']));
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b']));
  });

  it('prune clears editingId when the edited object was deleted', () => {
    const s = state(['a'], 'a');
    const result = selectionReducer(s, { type: 'prune', liveIds: new Set() });
    expect(result.editingId).toBeNull();
    expect(result.ids.size).toBe(0);
  });
});

describe('setMany', () => {
  it('replace (additive=false) overwrites; additive=true unions', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(new Set(s.ids)).toEqual(new Set(['b', 'c']));
    s = selectionReducer(s, { type: 'setMany', ids: ['d'], additive: true });
    expect(new Set(s.ids)).toEqual(new Set(['b', 'c', 'd']));
  });
});
