// Story 7 unit tests, task 9 (TC-13 to TC-15): the pure selectionReducer
// from useSelection (sel.interaction).

import { describe, it, expect } from 'vitest';
import {
  createSelectionState,
  selectionReducer,
} from '../../src/client/board/useSelection';

describe('selection reducer (story 7)', () => {
  it('TC-13: click replaces the set; toggle adds ({} → {a} → {a,b} → {b})', () => {
    let s = createSelectionState(['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b']));
    // click replaces the set: {a,b} → {b}
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('TC-14: toggle removes the last member ({a} → {} boundary)', () => {
    let s = createSelectionState(['a']);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: prune drops absent ids; editing a pruned id ends editing (remote delete)', () => {
    let s = createSelectionState(['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    s = selectionReducer(s, { type: 'edit', id: 'b' });
    expect(s.editingId).toBe('b');
    // a and c survive, b is deleted remotely (absent from the new present set):
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull(); // remote delete ends editing
    // Pruning again with the same present set is a no-op (stable state).
    const again = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(again).toBe(s);
  });

  it('setMany: non-additive replaces, additive adds; absent ids are ignored (error path)', () => {
    let s = createSelectionState(['a', 'b']);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'ghost'], additive: false });
    expect([...s.ids]).toEqual(['a']); // ghost (not present) ignored
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'ghost'], additive: true });
    expect(new Set(s.ids)).toEqual(new Set(['a', 'b']));
    // Additive with only absent ids: state unchanged (no spurious re-render).
    expect(selectionReducer(s, { type: 'setMany', ids: ['ghost'], additive: true })).toBe(s);
  });

  it('click/toggle for ids absent from the snapshot are ignored (error path)', () => {
    let s = createSelectionState(['a']);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(selectionReducer(s, { type: 'click', id: 'ghost' })).toBe(s);
    expect(selectionReducer(s, { type: 'toggle', id: 'ghost' })).toBe(s);
    // clear empties the selection and ends editing
    s = selectionReducer(s, { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit accepts an id not in the snapshot yet (same-tick create); prune reconciles', () => {
    // A note is created and edited in the same tick, before any snapshot
    // render includes it: the edit must NOT be dropped (the editor mounts
    // focused on the note's first render).
    let s = createSelectionState([]);
    s = selectionReducer(s, { type: 'edit', id: 'fresh' });
    expect(s.editingId).toBe('fresh');
    expect([...s.ids]).toEqual(['fresh']); // the edited object is selected
    // The snapshot catches up with the new note: prune keeps everything.
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['fresh']) });
    expect(s.editingId).toBe('fresh');
    expect([...s.ids]).toEqual(['fresh']);
    // …and if the id never materialised (or is deleted), prune drops it.
    let s2 = createSelectionState(['a']);
    s2 = selectionReducer(s2, { type: 'edit', id: 'ghost' });
    s2 = selectionReducer(s2, { type: 'prune', presentIds: new Set(['a']) });
    expect(s2.editingId).toBeNull();
    expect([...s2.ids]).toEqual([]);
  });
});
