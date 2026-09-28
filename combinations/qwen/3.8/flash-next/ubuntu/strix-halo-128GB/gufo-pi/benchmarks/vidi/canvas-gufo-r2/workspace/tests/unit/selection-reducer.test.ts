/**
 * Pure selection reducer unit tests (TC-13 to TC-15).
 */
import { describe, it, expect } from 'vitest';
import { selectionReducer, EMPTY_SELECTION, type SelectionState } from '../../src/client/board/useSelection';

function ids(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('selectionReducer', () => {
  it('TC-13: click a -> {a}; toggle b -> {a,b}; click b -> {b} (click replaces)', () => {
    let s = EMPTY_SELECTION;
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);
  });

  it('TC-14: {a} toggle a -> {} (removing the last member)', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: null };
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: {a,b,c} prune present {a,c,d} -> {a,c}', () => {
    let s: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(s)).toEqual(['a', 'c']);
  });

  it('TC-15: pruning the editing id ends editing', () => {
    let s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'b' };
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a']) });
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBeNull();
  });

  it('setMany additive merges, non-additive replaces', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: null };
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'setMany', ids: ['d'], additive: false });
    expect(ids(s)).toEqual(['d']);
  });

  it('edit selects and sets editingId; edit null clears editing but keeps selection', () => {
    let s = EMPTY_SELECTION;
    s = selectionReducer(s, { type: 'edit', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBe('a');
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBeNull();
  });

  it('clear empties selection and ends editing', () => {
    let s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('click while editing a different object ends editing', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);
    expect(s.editingId).toBeNull();
  });

  it('prune keeps editing when the edited id survives', () => {
    let s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBe('a');
  });
});
