import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer', () => {
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = state([]);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(s.ids).toEqual(new Set(['a']));

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(new Set(['a', 'b']));

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(s.ids).toEqual(new Set(['b']));
  });

  it('TC-14: {a} → toggle a → {} (removing last member)', () => {
    const s = selectionReducer(state(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}', () => {
    const s = selectionReducer(
      state(['a', 'b', 'c']),
      { type: 'prune', presentIds: new Set(['a', 'c', 'd']) },
    );
    expect(s.ids).toEqual(new Set(['a', 'c']));
  });

  it('prune ends editing of a pruned id', () => {
    const s = selectionReducer(
      state(['a', 'b', 'c'], 'b'),
      { type: 'prune', presentIds: new Set(['a', 'c', 'd']) },
    );
    expect(s.editingId).toBeNull();
  });

  it('prune keeps editing of a still-present id', () => {
    const s = selectionReducer(
      state(['a', 'b', 'c'], 'a'),
      { type: 'prune', presentIds: new Set(['a', 'c', 'd']) },
    );
    expect(s.editingId).toBe('a');
  });

  it('setMany additive adds ids to existing selection', () => {
    const s = selectionReducer(
      state(['x']),
      { type: 'setMany', ids: ['a', 'b'], additive: true },
    );
    expect(s.ids).toEqual(new Set(['x', 'a', 'b']));
  });

  it('setMany non-additive replaces the selection', () => {
    const s = selectionReducer(
      state(['x']),
      { type: 'setMany', ids: ['a', 'b'], additive: false },
    );
    expect(s.ids).toEqual(new Set(['a', 'b']));
  });

  it('setMany additive with empty ids leaves selection unchanged', () => {
    const s = selectionReducer(
      state(['x']),
      { type: 'setMany', ids: [], additive: true },
    );
    expect(s.ids).toEqual(new Set(['x']));
  });

  it('setMany non-additive with empty ids clears selection', () => {
    const s = selectionReducer(
      state(['x']),
      { type: 'setMany', ids: [], additive: false },
    );
    expect(s.ids.size).toBe(0);
  });

  it('clear removes all selected', () => {
    const s = selectionReducer(state(['a', 'b']), { type: 'clear' });
    expect(s.ids.size).toBe(0);
  });

  it('edit sets editingId', () => {
    const s = selectionReducer(state(['a']), { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
  });

  it('edit null ends editing', () => {
    const s = selectionReducer(state(['a'], 'a'), { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
  });

  it('click on an id not in the current set replaces the whole selection', () => {
    const s = selectionReducer(state(['a', 'b']), { type: 'click', id: 'c' });
    expect(s.ids).toEqual(new Set(['c']));
  });

  it('toggle adds an id not already selected', () => {
    const s = selectionReducer(state(['a']), { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(new Set(['a', 'b']));
  });

  it('toggle removes an id already selected', () => {
    const s = selectionReducer(state(['a', 'b']), { type: 'toggle', id: 'a' });
    expect(s.ids).toEqual(new Set(['b']));
  });
});
