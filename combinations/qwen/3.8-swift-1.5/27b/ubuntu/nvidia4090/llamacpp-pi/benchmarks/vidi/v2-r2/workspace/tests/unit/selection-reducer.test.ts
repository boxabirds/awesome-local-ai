import { describe, it, expect } from 'vitest';
import { selectionReducer, EMPTY_SELECTION, type SelectionState } from '../../src/client/board/useSelection';

function S(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('sel.state: selection reducer (unit)', () => {
  it('TC-13: click selects only the target; toggle adds; click collapses to a single selection', () => {
    let s = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b']));

    // A plain click always collapses to a single-selection.
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('TC-14: toggle removes an already-selected id', () => {
    const s = selectionReducer(S(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: pruning drops ids no longer present and clears an editing id that vanished', () => {
    const s = selectionReducer(S(['a', 'b', 'c'], 'b'), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull();
  });

  it('setMany is additive (marquee) or replacing (select-all) by flag', () => {
    let s = selectionReducer(S(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b', 'c']));

    s = selectionReducer(s, { type: 'setMany', ids: ['d'], additive: false });
    expect([...s.ids]).toEqual(['d']);
  });

  it('setMany with an empty result leaves the selection unchanged', () => {
    const s = selectionReducer(S(['a']), { type: 'setMany', ids: [], additive: true });
    expect(new Set(s.ids)).toEqual(new Set(['a']));
  });

  it('clear empties the selection and ends editing', () => {
    const s = selectionReducer(S(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('prune with nothing missing returns the same state (no re-render churn)', () => {
    const before = S(['a', 'b'], 'b');
    const after = selectionReducer(before, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) });
    expect(after).toBe(before);
  });

  it('click/toggle/edit do not resurrect ids that are no longer present (hook guards, asserted at hook level)', () => {
    // Reducer-level sanity: actions always record what they were told; the
    // hook filters against the snapshot before dispatching.
    const s = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'ghost' });
    expect(new Set(s.ids)).toEqual(new Set(['ghost']));
  });
});
