import { describe, expect, test } from 'vitest';
import {
  initialSelectionState,
  selectionReducer,
  type SelectionReducerState
} from '../../src/client/board/useSelection';

function stateWith(ids: string[], editingId: string | null = null): SelectionReducerState {
  return {
    ids: new Set(ids),
    editingId,
    presentIds: new Set([...ids, 'a', 'b', 'c', 'd'])
  };
}

describe('selectionReducer', () => {
  // TC-13
  test('TC-13 click replaces, toggle adds, click replaces again', () => {
    let s = selectionReducer(stateWith([]), { type: 'click', id: 'a' });
    expect([...s.ids].sort()).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  // TC-14 (boundary: removing the last member)
  test('TC-14 toggling the only member empties the selection', () => {
    const s = selectionReducer(stateWith(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  // TC-15
  test('TC-15 prune drops ids absent from the snapshot and ends editing of one', () => {
    const start = stateWith(['a', 'b', 'c'], 'b');
    const s = selectionReducer(start, { type: 'prune', present: ['a', 'c', 'd'] });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  test('prune keeps editing when the edited id survives and is a no-op otherwise', () => {
    const start = stateWith(['a', 'b'], 'b');
    const s = selectionReducer(start, { type: 'prune', present: ['a', 'b', 'c', 'd'] });
    expect(s.editingId).toBe('b');
    expect(s).toBe(start); // nothing changed at all → same state object
  });

  test('setMany additive unions, non-additive replaces', () => {
    const start = stateWith(['a']);
    const added = selectionReducer(start, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...added.ids].sort()).toEqual(['a', 'b', 'c']);
    const replaced = selectionReducer(start, { type: 'setMany', ids: ['c', 'd'], additive: false });
    expect([...replaced.ids].sort()).toEqual(['c', 'd']);
  });

  test('actions for ids absent from the snapshot are ignored (error path)', () => {
    const start = stateWith(['a']);
    expect(selectionReducer(start, { type: 'click', id: 'ghost' })).toBe(start);
    expect(selectionReducer(start, { type: 'toggle', id: 'ghost' })).toBe(start);
    const filtered = selectionReducer(start, { type: 'setMany', ids: ['a', 'ghost'], additive: false });
    expect([...filtered.ids]).toEqual(['a']);
    expect(selectionReducer(start, { type: 'setMany', ids: ['ghost'], additive: false })).toBe(start);
  });

  test('edit selects the id and sets editingId even before a snapshot prune', () => {
    // createSticky + startEdit dispatch in the same tick: the new id is not
    // in presentIds yet, so edit is exempt from the presence check.
    const start = stateWith([]);
    const s = selectionReducer(start, { type: 'edit', id: 'fresh' });
    expect([...s.ids]).toEqual(['fresh']);
    expect(s.editingId).toBe('fresh');
  });

  test('endEdit keeps or drops the selection per next', () => {
    const editing = stateWith(['a', 'b'], 'a');
    const kept = selectionReducer(editing, { type: 'endEdit', next: 'selected' });
    expect(kept.editingId).toBeNull();
    expect(kept.ids).toBe(editing.ids);
    const dropped = selectionReducer(editing, { type: 'endEdit', next: 'unselected' });
    expect(dropped.ids.size).toBe(0);
    expect(dropped.editingId).toBeNull();
    // Stray endEdit without editing: unchanged.
    expect(selectionReducer(stateWith(['a']), { type: 'endEdit', next: 'selected' })).toEqual(
      expect.objectContaining({ editingId: null })
    );
  });

  test('clear empties ids and editingId', () => {
    const s = selectionReducer(stateWith(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  test('initial state is empty', () => {
    const s = initialSelectionState();
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
    expect(s.presentIds.size).toBe(0);
  });
});
