// TC-13 to TC-15: the pure selection reducer.

import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const S = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

describe('TC-13 selectionReducer: click / toggle / setMany', () => {
  it('click selects a single object, replacing the selection', () => {
    expect(selectionReducer(S([]), { type: 'click', id: 'a' }).ids).toEqual(new Set(['a']));
    expect(selectionReducer(S(['x', 'y']), { type: 'click', id: 'a' }).ids).toEqual(new Set(['a']));
  });

  it('click on the only selected object is a no-op (stable state)', () => {
    const state = S(['a']);
    expect(selectionReducer(state, { type: 'click', id: 'a' })).toBe(state);
  });

  it('click replaces editing on a different object', () => {
    const next = selectionReducer(S(['a'], 'a'), { type: 'click', id: 'b' });
    expect(next.ids).toEqual(new Set(['b']));
    expect(next.editingId).toBeNull();
    // clicking the object being edited keeps editing
    const same = selectionReducer(S(['a'], 'a'), { type: 'click', id: 'a' });
    expect(same.editingId).toBe('a');
  });

  it('toggle adds and removes from the selection', () => {
    expect(selectionReducer(S([]), { type: 'toggle', id: 'a' }).ids).toEqual(new Set(['a']));
    expect(selectionReducer(S(['a']), { type: 'toggle', id: 'b' }).ids).toEqual(new Set(['a', 'b']));
    expect(selectionReducer(S(['a', 'b']), { type: 'toggle', id: 'a' }).ids).toEqual(new Set(['b']));
  });

  it('setMany replaces (non-additive) or unions (additive)', () => {
    expect(selectionReducer(S(['x']), { type: 'setMany', ids: ['a', 'b'], additive: false }).ids)
      .toEqual(new Set(['a', 'b']));
    expect(selectionReducer(S(['x']), { type: 'setMany', ids: ['a', 'b'], additive: true }).ids)
      .toEqual(new Set(['x', 'a', 'b']));
    // additive with an empty list keeps the selection
    expect(selectionReducer(S(['x', 'y']), { type: 'setMany', ids: [], additive: true }).ids)
      .toEqual(new Set(['x', 'y']));
  });

  it('setMany ends editing when the edited object leaves the selection', () => {
    const next = selectionReducer(S(['a', 'b'], 'a'), { type: 'setMany', ids: ['b'], additive: false });
    expect(next.editingId).toBeNull();
    const kept = selectionReducer(S(['a', 'b'], 'a'), { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(kept.editingId).toBe('a');
  });
});

describe('TC-14 selectionReducer: clear', () => {
  it('clear empties the selection and ends editing', () => {
    const next = selectionReducer(S(['a', 'b'], 'a'), { type: 'clear' });
    expect(next.ids.size).toBe(0);
    expect(next.editingId).toBeNull();
  });

  it('clear on an empty state returns the same state', () => {
    const state = S([]);
    expect(selectionReducer(state, { type: 'clear' })).toBe(state);
  });
});

describe('TC-15 selectionReducer: prune (objects deleted remotely)', () => {
  it('removes ids that no longer exist', () => {
    const next = selectionReducer(S(['a', 'b', 'c']), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect(next.ids).toEqual(new Set(['a', 'c']));
  });

  it('ends editing when the edited object disappears', () => {
    const next = selectionReducer(S(['a', 'b'], 'b'), {
      type: 'prune',
      presentIds: new Set(['a', 'c']),
    });
    expect(next.ids).toEqual(new Set(['a']));
    expect(next.editingId).toBeNull();
  });

  it('returns the same state when nothing is pruned', () => {
    const state = S(['a', 'b'], 'a');
    expect(selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(state);
  });
});
