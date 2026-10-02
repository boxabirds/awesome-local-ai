import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };
const set = (...ids: string[]) => new Set(ids);
const idsOf = (s: SelectionState) => [...s.ids].sort();

describe('selectionReducer', () => {
  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b} (click replaces)', () => {
    let s = selectionReducer(EMPTY, { type: 'click', id: 'a' });
    expect(idsOf(s)).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
  });

  it('TC-14 removing the last member via toggle → empty', () => {
    const one: SelectionState = { ids: set('a'), editingId: null };
    const s = selectionReducer(one, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 prune keeps present ids and ends editing when the edited id is gone', () => {
    const many: SelectionState = { ids: set('a', 'b', 'c'), editingId: 'b' };
    const s = selectionReducer(many, { type: 'prune', presentIds: set('a', 'c', 'd') });
    expect(idsOf(s)).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('prune that removes nothing returns the same object (no re-render)', () => {
    const many: SelectionState = { ids: set('a', 'c'), editingId: null };
    const s = selectionReducer(many, { type: 'prune', presentIds: set('a', 'c', 'd') });
    expect(s).toBe(many);
  });

  it('setMany additive unions with the current selection; non-additive replaces', () => {
    const one: SelectionState = { ids: set('a'), editingId: null };
    const additive = selectionReducer(one, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(idsOf(additive)).toEqual(['a', 'b', 'c']);
    const replace = selectionReducer(one, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(idsOf(replace)).toEqual(['b', 'c']);
  });

  it('setMany on an empty board leaves the selection empty (boundary, no error)', () => {
    const s = selectionReducer(EMPTY, { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });

  it('clear empties the selection and ends editing', () => {
    const editing: SelectionState = { ids: set('a'), editingId: 'a' };
    const s = selectionReducer(editing, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit(id) selects only that id and marks it editing; edit(null) keeps ids', () => {
    const some: SelectionState = { ids: set('a', 'b'), editingId: null };
    const editing = selectionReducer(some, { type: 'edit', id: 'b' });
    expect(idsOf(editing)).toEqual(['b']);
    expect(editing.editingId).toBe('b');

    const ended = selectionReducer(editing, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect(idsOf(ended)).toEqual(['b']);
  });
});
