import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

function ids(s: SelectionState): string[] {
  return [...s.ids].sort();
}

describe('selectionReducer', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  it('TC-13: click replaces, toggle adds, click replaces again', () => {
    let s: SelectionState = { ids: new Set(), editingId: null };
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']); // click replaces the whole selection
  });

  // TC-14: {a} → toggle a → {} (removing last member)
  it('TC-14: toggle removes last member, selection becomes empty', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(ids(s)).toEqual([]);
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editingId=b → editingId null
  it('TC-15: prune removes missing ids, ends editing of pruned id', () => {
    let s = state(['a', 'b', 'c'], 'b');
    const presentIds = new Set(['a', 'c', 'd']);
    s = selectionReducer(s, { type: 'prune', presentIds });
    expect(ids(s)).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('prune keeps editingId if present', () => {
    let s = state(['a', 'b', 'c'], 'a');
    const presentIds = new Set(['a', 'c', 'd']);
    s = selectionReducer(s, { type: 'prune', presentIds });
    expect(ids(s)).toEqual(['a', 'c']);
    expect(s.editingId).toBe('a');
  });

  // setMany additive
  it('setMany additive=true adds to existing', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
  });

  // setMany non-additive replaces
  it('setMany additive=false replaces selection', () => {
    let s = state(['a', 'x']);
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(ids(s)).toEqual(['b', 'c']);
    expect(s.editingId).toBeNull();
  });

  // clear
  it('clear resets to empty', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'clear' });
    expect(ids(s)).toEqual([]);
    expect(s.editingId).toBeNull();
  });

  // edit action starts editing
  it('edit sets editingId and ensures selected', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'edit', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.editingId).toBe('b');
  });

  // edit null ends editing
  it('edit null ends editing without changing selection', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.editingId).toBeNull();
  });
});
