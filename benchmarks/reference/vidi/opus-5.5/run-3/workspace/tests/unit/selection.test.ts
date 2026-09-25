import { describe, expect, it } from 'vitest';
import { initialSelection, selectionReducer, type SelectionAction, type SelectionState } from '../../src/client/board/useSelection';

const present = (...ids: string[]) => new Set(ids);

function run(state: SelectionState, ...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, state);
}

const ids = (s: SelectionState) => [...s.ids].sort();

describe('selection reducer (sel.interaction)', () => {
  const start = initialSelection(present('a', 'b', 'c', 'd'));

  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    expect(ids(start)).toEqual([]);
    const s1 = run(start, { type: 'click', id: 'a' });
    expect(ids(s1)).toEqual(['a']);
    const s2 = run(s1, { type: 'toggle', id: 'b' });
    expect(ids(s2)).toEqual(['a', 'b']);
    const s3 = run(s2, { type: 'click', id: 'b' });
    expect(ids(s3)).toEqual(['b']);
  });

  it('TC-14 toggling the last selected object off empties the selection', () => {
    const s = run(start, { type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 prune drops ids deleted by someone else and ends editing of a deleted note', () => {
    const s = run(start, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    const pruned = run(s, { type: 'prune', presentIds: present('a', 'c', 'd') });
    expect(ids(pruned)).toEqual(['a', 'c']);

    const editingB = run(start, { type: 'edit', id: 'b' });
    expect(editingB.editingId).toBe('b');
    const after = run(editingB, { type: 'prune', presentIds: present('a', 'c', 'd') });
    expect(after.editingId).toBeNull();
    expect(after.ids.size).toBe(0);
  });

  it('prune with nothing removed keeps the same state object', () => {
    const s = run(start, { type: 'click', id: 'a' });
    const p = present('a', 'b');
    const once = run(s, { type: 'prune', presentIds: p });
    expect(run(once, { type: 'prune', presentIds: p })).toBe(once);
  });

  it('setMany replaces the selection, or adds to it when additive', () => {
    const s = run(start, { type: 'click', id: 'a' });
    expect(ids(run(s, { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual(['a', 'b', 'c']);
    expect(ids(run(s, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual(['b', 'c']);
    expect(ids(run(s, { type: 'setMany', ids: [], additive: true }))).toEqual(['a']);
    expect(ids(run(s, { type: 'setMany', ids: [], additive: false }))).toEqual([]);
  });

  it('actions naming ids that are not on the board are ignored', () => {
    const s = run(start, { type: 'click', id: 'a' });
    expect(run(s, { type: 'click', id: 'ghost' })).toBe(s);
    expect(run(s, { type: 'toggle', id: 'ghost' })).toBe(s);
    expect(ids(run(s, { type: 'setMany', ids: ['ghost', 'b'], additive: true }))).toEqual(['a', 'b']);
  });

  it('clear empties the selection and ends editing; edit selects just the edited note', () => {
    const editing = run(start, { type: 'setMany', ids: ['a', 'b'], additive: false }, { type: 'edit', id: 'c' });
    expect(ids(editing)).toEqual(['c']);
    expect(editing.editingId).toBe('c');
    const cleared = run(editing, { type: 'clear' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.editingId).toBeNull();
    // Clicking the edited note keeps editing; toggling another one in ends it.
    expect(run(editing, { type: 'click', id: 'c' }).editingId).toBe('c');
    expect(run(editing, { type: 'toggle', id: 'a' }).editingId).toBeNull();
    // Ending editing keeps the note selected.
    const ended = run(editing, { type: 'edit', id: null });
    expect(ids(ended)).toEqual(['c']);
    expect(ended.editingId).toBeNull();
  });
});
