// sel.interaction: the pure selection reducer (TC-13 to TC-15).
import { describe, expect, it } from 'vitest';
import {
  INITIAL_SELECTION,
  type SelectionAction,
  type SelectionState,
  selectionReducer,
} from '../../src/client/board/useSelection';

function run(state: SelectionState, ...actions: SelectionAction[]) {
  return actions.reduce(selectionReducer, state);
}
const ids = (s: SelectionState) => [...s.ids].sort();
const present = (...list: string[]) =>
  run(INITIAL_SELECTION, { type: 'prune', presentIds: new Set(list) });

describe('selectionReducer', () => {
  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = present('a', 'b', 'c');
    expect(ids(s)).toEqual([]);
    s = run(s, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    s = run(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);
    s = run(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);
  });

  it('TC-14 toggling the last selected object empties the selection', () => {
    const s = run(present('a'), { type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('TC-15 prune drops ids deleted remotely and ends editing of a pruned id', () => {
    let s = run(present('a', 'b', 'c'), {
      type: 'setMany',
      ids: ['a', 'b', 'c'],
      additive: false,
    });
    s = run(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(s)).toEqual(['a', 'c']);

    let editing = run(present('a', 'b'), { type: 'edit', id: 'b' });
    expect(editing.editingId).toBe('b');
    editing = run(editing, { type: 'prune', presentIds: new Set(['a']) });
    expect(editing.editingId).toBeNull();
    expect(editing.ids.size).toBe(0);
  });

  it('setMany is additive or replacing; clear empties', () => {
    let s = run(present('a', 'b', 'c', 'd'), { type: 'click', id: 'a' });
    s = run(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    s = run(s, { type: 'setMany', ids: ['d'], additive: false });
    expect(ids(s)).toEqual(['d']);
    s = run(s, { type: 'setMany', ids: [], additive: true });
    expect(ids(s)).toEqual(['d']);
    s = run(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
  });

  it('actions for ids absent from the board are ignored', () => {
    const s = run(present('a'), { type: 'click', id: 'a' });
    expect(run(s, { type: 'click', id: 'ghost' })).toBe(s);
    expect(run(s, { type: 'toggle', id: 'ghost' })).toBe(s);
    expect(ids(run(s, { type: 'setMany', ids: ['ghost'], additive: false }))).toEqual([]);
  });

  it('editing: edit selects just that object; edit null keeps it selected; clicking it keeps editing', () => {
    let s = run(present('a', 'b'), { type: 'setMany', ids: ['a', 'b'], additive: false });
    s = run(s, { type: 'edit', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBe('a');
    expect(run(s, { type: 'click', id: 'a' }).editingId).toBe('a');
    expect(run(s, { type: 'click', id: 'b' }).editingId).toBeNull();
    s = run(s, { type: 'edit', id: null });
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBeNull();
  });

  it('unchanged results return the same state object (no re-render)', () => {
    const s = run(present('a'), { type: 'click', id: 'a' });
    expect(run(s, { type: 'click', id: 'a' })).toBe(s);
    const empty = present('a');
    expect(run(empty, { type: 'clear' })).toBe(empty);
  });
});
