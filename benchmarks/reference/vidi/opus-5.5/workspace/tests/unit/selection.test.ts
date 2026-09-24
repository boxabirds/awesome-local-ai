import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

function run(actions: SelectionAction[], start: SelectionState = EMPTY_SELECTION): SelectionState {
  return actions.reduce(selectionReducer, start);
}

function ids(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('sel.interaction: selectionReducer', () => {
  it('TC-13 {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    const s1 = run([{ type: 'click', id: 'a' }]);
    expect(ids(s1)).toEqual(['a']);
    const s2 = selectionReducer(s1, { type: 'toggle', id: 'b' });
    expect(ids(s2)).toEqual(['a', 'b']);
    const s3 = selectionReducer(s2, { type: 'click', id: 'b' });
    expect(ids(s3)).toEqual(['b']);
  });

  it('TC-14 toggling the last selected id empties the selection (boundary)', () => {
    const state = run([{ type: 'click', id: 'a' }, { type: 'toggle', id: 'a' }]);
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
  });

  it('TC-15 prune keeps only ids still present: {a,b,c} → {a,c}; editing a pruned id ends', () => {
    const selected = run([{ type: 'setMany', ids: ['a', 'b', 'c'], additive: false }]);
    const pruned = selectionReducer(selected, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(pruned)).toEqual(['a', 'c']);

    const editingB = run([{ type: 'edit', id: 'b' }]);
    expect(editingB.editingId).toBe('b');
    const afterDelete = selectionReducer(editingB, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(afterDelete.editingId).toBeNull();
    expect(afterDelete.ids.size).toBe(0);
  });

  it('prune with nothing removed returns the same state object (no re-render)', () => {
    const state = run([{ type: 'click', id: 'a' }]);
    expect(selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(state);
  });

  it('setMany additive adds to the selection; non-additive replaces it', () => {
    const start = run([{ type: 'click', id: 'x' }]);
    expect(ids(selectionReducer(start, { type: 'setMany', ids: ['a', 'b'], additive: true }))).toEqual(['a', 'b', 'x']);
    expect(ids(selectionReducer(start, { type: 'setMany', ids: ['a', 'b'], additive: false }))).toEqual(['a', 'b']);
    expect(selectionReducer(start, { type: 'setMany', ids: [], additive: false }).ids.size).toBe(0);
  });

  it('clear empties; edit selects only the edited object; edit null keeps it selected', () => {
    const many = run([{ type: 'setMany', ids: ['a', 'b'], additive: false }]);
    expect(selectionReducer(many, { type: 'clear' }).ids.size).toBe(0);
    const editing = selectionReducer(many, { type: 'edit', id: 'b' });
    expect(ids(editing)).toEqual(['b']);
    expect(editing.editingId).toBe('b');
    const done = selectionReducer(editing, { type: 'edit', id: null });
    expect(ids(done)).toEqual(['b']);
    expect(done.editingId).toBeNull();
  });

  it('clicking another object ends editing; clicking the edited one keeps it', () => {
    const editing = run([{ type: 'edit', id: 'a' }]);
    expect(selectionReducer(editing, { type: 'click', id: 'a' })).toBe(editing);
    expect(selectionReducer(editing, { type: 'click', id: 'b' }).editingId).toBeNull();
  });
});
