import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, type SelectionAction, type SelectionState, selectionReducer } from '../../src/client/board/useSelection';

function run(actions: SelectionAction[], start: SelectionState = EMPTY_SELECTION): SelectionState[] {
  const states: SelectionState[] = [];
  let s = start;
  for (const a of actions) {
    s = selectionReducer(s, a);
    states.push(s);
  }
  return states;
}

const ids = (s: SelectionState) => [...s.ids].sort();

describe('sel.interaction selectionReducer', () => {
  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    const states = run([
      { type: 'click', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'click', id: 'b' },
    ]);
    expect(states.map(ids)).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('TC-14 toggling the last member leaves the selection empty', () => {
    const [one, empty] = run([
      { type: 'click', id: 'a' },
      { type: 'toggle', id: 'a' },
    ]);
    expect(ids(one!)).toEqual(['a']);
    expect(empty!.ids.size).toBe(0);
  });

  it('TC-15 prune drops ids deleted by others and ends editing of a pruned id', () => {
    const start = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    const pruned = selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(pruned)).toEqual(['a', 'c']);

    const editing = selectionReducer(EMPTY_SELECTION, { type: 'edit', id: 'b' });
    expect(editing).toMatchObject({ editingId: 'b' });
    const after = selectionReducer(editing, { type: 'prune', presentIds: new Set(['a']) });
    expect(after.editingId).toBeNull();
    expect(after.ids.size).toBe(0);
  });

  it('prune with nothing missing returns the same state (no re-render)', () => {
    const start = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(start);
  });

  it('setMany replaces or adds', () => {
    const start = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'x' });
    expect(ids(selectionReducer(start, { type: 'setMany', ids: ['a', 'b'], additive: true }))).toEqual(['a', 'b', 'x']);
    expect(ids(selectionReducer(start, { type: 'setMany', ids: ['a', 'b'], additive: false }))).toEqual(['a', 'b']);
    expect(selectionReducer(start, { type: 'setMany', ids: [], additive: true })).toBe(start);
  });

  it('clear empties; ending an edit keeps or drops the edited object', () => {
    const editing = selectionReducer(EMPTY_SELECTION, { type: 'edit', id: 'a' });
    expect(selectionReducer(editing, { type: 'edit', id: null })).toEqual({ ids: new Set(['a']), editingId: null });
    expect(selectionReducer(editing, { type: 'edit', id: null, keepSelected: false })).toEqual({ ids: new Set(), editingId: null });
    expect(selectionReducer(editing, { type: 'clear' })).toEqual({ ids: new Set(), editingId: null });
  });
});
