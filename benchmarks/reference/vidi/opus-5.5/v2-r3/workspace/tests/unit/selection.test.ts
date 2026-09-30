import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectionReducer, type SelectionAction, type SelectionState } from '../../src/client/board/useSelection';

function run(state: SelectionState, ...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, state);
}

const ids = (s: SelectionState) => [...s.ids].sort();

describe('selectionReducer (sel.interaction)', () => {
  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    const s1 = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(ids(s1)).toEqual(['a']);
    const s2 = run(s1, { type: 'toggle', id: 'b' });
    expect(ids(s2)).toEqual(['a', 'b']);
    const s3 = run(s2, { type: 'click', id: 'b' });
    expect(ids(s3)).toEqual(['b']);
  });

  it('TC-14 {a} → toggle a → empty (removing the last member)', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 {a,b,c} pruned to present {a,c,d} → {a,c}; editing of a pruned id ends', () => {
    const s = run(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    const pruned = run(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(pruned)).toEqual(['a', 'c']);

    const editing = run(EMPTY_SELECTION, { type: 'edit', id: 'b' });
    expect(editing.editingId).toBe('b');
    const after = run(editing, { type: 'prune', presentIds: new Set(['a']) });
    expect(after.editingId).toBeNull();
    expect(after.ids.size).toBe(0);
    // Editing of a present id survives a prune.
    expect(run(editing, { type: 'prune', presentIds: new Set(['b']) }).editingId).toBe('b');
  });

  it('setMany is additive or replacing', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'x' });
    expect(ids(run(s, { type: 'setMany', ids: ['a', 'b'], additive: true }))).toEqual(['a', 'b', 'x']);
    expect(ids(run(s, { type: 'setMany', ids: ['a', 'b'], additive: false }))).toEqual(['a', 'b']);
    expect(ids(run(s, { type: 'setMany', ids: [], additive: false }))).toEqual([]);
  });

  it('clear empties the selection and ends editing; edit null keeps the selection', () => {
    const editing = run(EMPTY_SELECTION, { type: 'edit', id: 'a' });
    expect(ids(editing)).toEqual(['a']);
    const ended = run(editing, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect(ids(ended)).toEqual(['a']);
    const cleared = run(editing, { type: 'clear' });
    expect(cleared).toEqual({ ids: new Set(), editingId: null });
  });

  it('no-op actions return the same state object (no re-render)', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(selectionReducer(s, { type: 'click', id: 'a' })).toBe(s);
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['a']) })).toBe(s);
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });

  it('ids absent from the board are dropped by prune (actions on absent ids have no lasting effect)', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' }, { type: 'toggle', id: 'ghost' });
    expect(ids(run(s, { type: 'prune', presentIds: new Set(['a']) }))).toEqual(['a']);
  });
});
