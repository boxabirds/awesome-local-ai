import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

function run(state: SelectionState, ...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, state);
}

const ids = (s: SelectionState) => [...s.ids].sort();
const present = (...list: string[]): SelectionAction => ({ type: 'prune', presentIds: new Set(list) });

describe('sel.interaction: selectionReducer', () => {
  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = run(EMPTY_SELECTION, present('a', 'b', 'c'));
    expect(ids(s)).toEqual([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);
  });

  it('TC-14 toggling the last selected object leaves the selection empty', () => {
    const s = run(EMPTY_SELECTION, present('a'), { type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 prune {a,b,c} with present {a,c,d} → {a,c}; editing of b ends', () => {
    let s = run(EMPTY_SELECTION, present('a', 'b', 'c', 'd'), { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    s = run(s, present('a', 'c', 'd'));
    expect(ids(s)).toEqual(['a', 'c']);

    let editing = run(EMPTY_SELECTION, present('a', 'b'), { type: 'edit', id: 'b' });
    expect(editing.editingId).toBe('b');
    editing = run(editing, present('a'));
    expect(editing.editingId).toBeNull();
    expect(editing.ids.size).toBe(0);
  });

  it('setMany replaces or adds; clear empties', () => {
    const base = run(EMPTY_SELECTION, present('a', 'b', 'c'), { type: 'click', id: 'a' });
    expect(ids(run(base, { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual(['a', 'b', 'c']);
    expect(ids(run(base, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual(['b', 'c']);
    expect(ids(run(base, { type: 'setMany', ids: [], additive: false }))).toEqual([]);
    expect(run(base, { type: 'clear' }).ids.size).toBe(0);
  });

  it('actions naming ids absent from the snapshot are ignored', () => {
    const base = run(EMPTY_SELECTION, present('a', 'b'), { type: 'click', id: 'a' });
    expect(run(base, { type: 'click', id: 'ghost' })).toBe(base);
    expect(run(base, { type: 'toggle', id: 'ghost' })).toBe(base);
    expect(ids(run(base, { type: 'setMany', ids: ['ghost', 'b'], additive: true }))).toEqual(['a', 'b']);
  });

  it('clicking the object being edited keeps editing; clicking another ends it', () => {
    const editing = run(EMPTY_SELECTION, present('a', 'b'), { type: 'edit', id: 'a' });
    expect(run(editing, { type: 'click', id: 'a' }).editingId).toBe('a');
    expect(run(editing, { type: 'click', id: 'b' }).editingId).toBeNull();
    const ended = run(editing, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect(ids(ended)).toEqual(['a']);
  });

  it('unchanged selections keep their identity (no re-render)', () => {
    const s = run(EMPTY_SELECTION, present('a'), { type: 'click', id: 'a' });
    expect(selectionReducer(s, { type: 'click', id: 'a' })).toBe(s);
    expect(selectionReducer(s, present('a')).ids).toBe(s.ids);
  });
});
