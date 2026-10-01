import { describe, expect, it } from 'vitest';
import {
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

const empty: SelectionState = { ids: new Set(), editingId: null };

function state(...ids: string[]): SelectionState {
  return { ids: new Set(ids), editingId: null };
}

describe('selectionReducer', () => {
  it('TC-13 click replaces set; toggle adds; click again replaces', () => {
    // {} → click a → {a}
    let s = selectionReducer(empty, { type: 'click', id: 'a' });
    expect([...s.ids].sort()).toEqual(['a']);

    // {a} → toggle b → {a,b}
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    // {a,b} → click b → {b} (click replaces)
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('TC-14 toggle removes last member → empty', () => {
    let s = state('a');
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 prune removes ids not in presentIds; editingId cleared if pruned', () => {
    let s: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    const present = new Set(['a', 'c', 'd']);
    s = selectionReducer(s, { type: 'prune', presentIds: present });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('prune does not change state when nothing is pruned', () => {
    const s = state('a', 'b');
    const present = new Set(['a', 'b', 'c']);
    const result = selectionReducer(s, { type: 'prune', presentIds: present });
    expect(result).toBe(s); // same reference, no change
  });

  it('setMany additive merges ids', () => {
    let s = state('a');
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('setMany non-additive replaces', () => {
    let s = state('a', 'b');
    s = selectionReducer(s, { type: 'setMany', ids: ['c'], additive: false });
    expect([...s.ids]).toEqual(['c']);
  });

  it('clear empties selection and editing', () => {
    let s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit action sets editingId and selects the id', () => {
    let s = empty;
    s = selectionReducer(s, { type: 'edit', id: 'x' });
    expect(s.ids.has('x')).toBe(true);
    expect(s.editingId).toBe('x');
  });

  it('edit null clears editingId', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(s.ids.has('a')).toBe(true);
  });

  it('toggle removes editing id clears editingId', () => {
    let s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.has('a')).toBe(false);
    expect(s.editingId).toBeNull();
    expect(s.ids.has('b')).toBe(true);
  });
});
