// sel.model (story 7, TC-13 to TC-15): the pure selection reducer.

import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

function ids(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('sel.model — selectionReducer', () => {
  it('TC-13 click/toggle/clear transitions', () => {
    let s = EMPTY_SELECTION;
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);

    // Clicking another object replaces the selection.
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);

    // Toggling adds...
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(ids(s)).toEqual(['a', 'b']);

    // ...and removes.
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(ids(s)).toEqual([]);

    // Clear empties (and leaves edit mode).
    s = selectionReducer({ ids: new Set(['x']), editingId: 'x' }, { type: 'clear' });
    expect(ids(s)).toEqual([]);
    expect(s.editingId).toBeNull();
  });

  it('TC-14 setMany: additive union vs replacement', () => {
    const base: SelectionState = { ids: new Set(['a']), editingId: null };

    const additive = selectionReducer(base, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(ids(additive)).toEqual(['a', 'b', 'c']);

    const replace = selectionReducer(base, { type: 'setMany', ids: ['b'], additive: false });
    expect(ids(replace)).toEqual(['b']);

    // Additive with an empty list keeps the selection (marquee found nothing).
    const nochange = selectionReducer(base, { type: 'setMany', ids: [], additive: true });
    expect(ids(nochange)).toEqual(['a']);
  });

  it('TC-15 prune drops removed ids (remote deletion) and a stale editingId', () => {
    const state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };

    // b was deleted remotely: selection and edit mode lose it.
    const pruned = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(ids(pruned)).toEqual(['a', 'c']);
    expect(pruned.editingId).toBeNull();

    // Nothing removed: the same state object comes back (render bail-out).
    const same = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) });
    expect(same).toBe(state);

    // Editing an object that got deleted: edit mode ends, selection kept.
    const editingGone = selectionReducer(
      { ids: new Set(['a', 'b']), editingId: 'b' },
      { type: 'prune', presentIds: new Set(['a']) },
    );
    expect(ids(editingGone)).toEqual(['a']);
    expect(editingGone.editingId).toBeNull();
  });

  it('end-edit with next=selected makes the object the whole selection', () => {
    const state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    const editing = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(editing.editingId).toBe('a');
    expect(ids(editing)).toEqual(['a', 'b']);
    const done = selectionReducer(editing, { type: 'end-edit', next: 'selected' });
    expect(done.editingId).toBeNull();
    expect(ids(done)).toEqual(['a']);
  });

  it('end-edit with next=unselected clears the selection', () => {
    const state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const done = selectionReducer(state, { type: 'end-edit', next: 'unselected' });
    expect(done.editingId).toBeNull();
    expect(ids(done)).toEqual([]);
  });

  it('clear on an already-empty state returns the same object', () => {
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });
});
