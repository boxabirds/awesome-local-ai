import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const S = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

describe('selection reducer (story 7)', () => {
  it('TC-13: click replaces the set', () => {
    const next = selectionReducer(S(['a', 'b']), { type: 'click', id: 'c' });
    expect([...next.ids]).toEqual(['c']);
    // clicking the sole selected object is a no-op
    const same = selectionReducer(S(['a']), { type: 'click', id: 'a' });
    expect(same).toEqual(S(['a']));
  });

  it('TC-13: toggle adds and removes', () => {
    expect([...selectionReducer(S(['a']), { type: 'toggle', id: 'b' }).ids]).toEqual(['a', 'b']);
    expect([...selectionReducer(S(['a', 'b']), { type: 'toggle', id: 'a' }).ids]).toEqual(['b']);
  });

  it('TC-13: setMany replaces, or adds when additive', () => {
    expect([...selectionReducer(S(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false }).ids]).toEqual([
      'b',
      'c',
    ]);
    expect([...selectionReducer(S(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true }).ids]).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('TC-14: prune drops ids no longer in the snapshot, including the edited id', () => {
    const next = selectionReducer(S(['a', 'b'], 'b'), { type: 'prune', presentIds: new Set(['a']) });
    expect([...next.ids]).toEqual(['a']);
    expect(next.editingId).toBeNull();
    // pruning with everything present is a no-op
    expect(selectionReducer(S(['a']), { type: 'prune', presentIds: new Set(['a']) })).toEqual(S(['a']));
  });

  it('TC-14: a pruned selection is not resurrected by later actions on the same snapshot', () => {
    // simulates: remote delete → prune → stale gesture click on the dead id
    const pruned = selectionReducer(S(['a', 'b']), { type: 'prune', presentIds: new Set(['a']) });
    expect([...pruned.ids]).toEqual(['a']);
  });

  it('TC-15: actions that change nothing return the same state reference (bail-out)', () => {
    const state = S(['a', 'b']);
    // setMany with identical contents → same reference
    expect(selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: false })).toBe(state);
    // click on the sole selected object → same reference
    const single = S(['a']);
    expect(selectionReducer(single, { type: 'click', id: 'a' })).toBe(single);
    // clear on an already-empty state → same reference
    const empty = S([]);
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
    // prune with everything present → same reference
    expect(selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(state);
  });

  it('edit: starts and ends editing without touching the id set', () => {
    const editing = selectionReducer(S(['a']), { type: 'edit', id: 'a' });
    expect(editing.editingId).toBe('a');
    expect([...editing.ids]).toEqual(['a']);
    const done = selectionReducer(editing, { type: 'edit', id: null });
    expect(done.editingId).toBeNull();
  });
});
