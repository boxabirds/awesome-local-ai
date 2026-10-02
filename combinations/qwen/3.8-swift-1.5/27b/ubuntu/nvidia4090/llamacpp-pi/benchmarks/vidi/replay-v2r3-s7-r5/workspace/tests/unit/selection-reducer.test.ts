import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

/**
 * Story 7 unit tests for the selection reducer (sel.interaction),
 * TC-13, TC-14, TC-15.
 */

const empty: SelectionState = { ids: new Set(), editingId: null };
const one = (id: string): SelectionState => ({ ids: new Set([id]), editingId: null });
const two = (a: string, b: string): SelectionState => ({ ids: new Set([a, b]), editingId: null });

describe('selection reducer (sel.interaction)', () => {
  it('click replaces the selection with the single id; click on an already-selected single keeps state', () => {
    expect(selectionReducer(empty, { type: 'click', id: 'a' })).toEqual(one('a'));
    const s = one('a');
    // Clicking the same single selection is a no-op (same reference).
    expect(selectionReducer(s, { type: 'click', id: 'a' })).toBe(s);
    // Clicking a second note replaces the selection.
    expect(selectionReducer(one('a'), { type: 'click', id: 'b' })).toEqual(one('b'));
    // Clicking a member of a multi-selection narrows to it.
    expect(selectionReducer(two('a', 'b'), { type: 'click', id: 'b' })).toEqual(one('b'));
  });

  it('toggle adds to the selection and removes on the second toggle', () => {
    expect(selectionReducer(empty, { type: 'toggle', id: 'a' })).toEqual(one('a'));
    expect(selectionReducer(one('a'), { type: 'toggle', id: 'b' })).toEqual(two('a', 'b'));
    expect(selectionReducer(two('a', 'b'), { type: 'toggle', id: 'a' })).toEqual(one('b'));
    expect(selectionReducer(one('b'), { type: 'toggle', id: 'b' })).toEqual(empty);
  });

  it('clear empties the selection and ends editing', () => {
    const s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    expect(selectionReducer(s, { type: 'clear' })).toEqual(empty);
    // Clearing an already-empty state returns the same reference.
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });

  // TC-13
  it('TC-13: setMany non-additive replaces; additive unions', () => {
    // Non-additive replaces even with an empty marquee over other objects.
    expect(selectionReducer(one('a'), { type: 'setMany', ids: [], additive: false })).toEqual(empty);
    expect(selectionReducer(one('a'), { type: 'setMany', ids: ['b', 'c'], additive: false })).toEqual(
      { ids: new Set(['b', 'c']), editingId: null },
    );
    // Additive unions with the current selection.
    expect(selectionReducer(one('a'), { type: 'setMany', ids: ['b'], additive: true })).toEqual(
      two('a', 'b'),
    );
    // Additive with no new ids is a no-op (same reference).
    const s = two('a', 'b');
    expect(selectionReducer(s, { type: 'setMany', ids: ['a', 'b'], additive: true })).toBe(s);
  });

  // TC-14
  it('TC-14: prune removes ids absent from the board and keeps the rest', () => {
    const s = { ids: new Set(['a', 'b', 'c']), editingId: null } as SelectionState;
    const pruned = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(pruned.ids).toEqual(new Set(['a', 'c']));
    // Pruning with all ids present returns the same state reference.
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) })).toBe(s);
    // Pruning the editing id ends editing.
    const editing: SelectionState = { ids: new Set(['a', 'b']), editingId: 'b' };
    const afterPrune = selectionReducer(editing, { type: 'prune', presentIds: new Set(['a']) });
    expect(afterPrune.ids).toEqual(new Set(['a']));
    expect(afterPrune.editingId).toBeNull();
  });

  // TC-15
  it('TC-15: edit requires the id to be selected; edit null ends editing', () => {
    expect(selectionReducer(one('a'), { type: 'edit', id: 'a' })).toEqual(
      { ids: new Set(['a']), editingId: 'a' },
    );
    // Editing an id outside the selection selects it first (double-click path).
    expect(selectionReducer(one('a'), { type: 'edit', id: 'b' })).toEqual(
      { ids: new Set(['a', 'b']), editingId: 'b' },
    );
    // Ending editing keeps the selection.
    const s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'b' };
    expect(selectionReducer(s, { type: 'edit', id: null })).toEqual(two('a', 'b'));
    // Idempotent edit actions return the same reference.
    expect(selectionReducer(s, { type: 'edit', id: 'b' })).toBe(s);
    const s2 = two('a', 'b');
    expect(selectionReducer(s2, { type: 'edit', id: null })).toBe(s2);
  });
});
