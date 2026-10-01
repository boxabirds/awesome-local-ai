import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const ids = (s: SelectionState) => [...s.ids].sort();

describe('selectionReducer', () => {
  it('TC-13 click replaces the set; toggle adds', () => {
    let s = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);
  });

  it('TC-14 toggling the last member off empties the selection', () => {
    let s = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(ids(s)).toEqual([]);
  });

  it('TC-15 prune drops ids missing from the board; editing of a pruned id ends', () => {
    let s = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(s)).toEqual(['a', 'c']);
    s = selectionReducer(EMPTY_SELECTION, { type: 'edit', id: 'b' });
    expect(s.editingId).toBe('b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a']) });
    expect(s).toEqual({ ids: new Set(), editingId: null });
  });

  it('prune returns the same state when nothing changed', () => {
    const s = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: ['a'], additive: false });
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(s);
  });

  it('setMany is additive or replacing; an empty additive set changes nothing', () => {
    const s = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(ids(selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual(['a', 'b', 'c']);
    expect(ids(selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual(['b', 'c']);
    expect(selectionReducer(s, { type: 'setMany', ids: [], additive: true })).toBe(s);
    expect(ids(selectionReducer(s, { type: 'setMany', ids: [], additive: false }))).toEqual([]);
  });

  it('clear empties the selection and editing; edit null keeps the selection', () => {
    const e = selectionReducer(EMPTY_SELECTION, { type: 'edit', id: 'a' });
    expect(selectionReducer(e, { type: 'edit', id: null })).toEqual({ ids: new Set(['a']), editingId: null });
    expect(selectionReducer(e, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });
});
