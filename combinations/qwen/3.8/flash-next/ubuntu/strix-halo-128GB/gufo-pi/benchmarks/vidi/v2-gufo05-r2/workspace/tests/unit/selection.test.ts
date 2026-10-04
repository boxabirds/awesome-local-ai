import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

function state(ids: string[], over: Partial<SelectionState> = {}): SelectionState {
  return { ids: new Set(ids), editingId: null, ...over };
}

function selectedIds(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('selection reducer — click and shift-click', () => {
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = EMPTY_SELECTION;
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(selectedIds(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(selectedIds(s)).toEqual(['a', 'b']);
    // A plain click replaces the selection; the shift-click added to it.
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(selectedIds(s)).toEqual(['b']);
  });

  it('TC-14: shift-clicking the last member leaves the selection empty', () => {
    const s = selectionReducer(state(['a']), { type: 'toggle', id: 'a' });
    expect(selectedIds(s)).toEqual([]);
    expect(s.ids.size).toBe(0);
  });

  it('shift-click adds without disturbing the others, and removes only what it toggles', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'toggle', id: 'c' });
    expect(selectedIds(s)).toEqual(['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(selectedIds(s)).toEqual(['b', 'c']);
  });

  it('an unchanged selection is the same object, so React skips the re-render', () => {
    const s = state(['a']);
    // Clicking the object that is already the whole selection changes nothing.
    expect(selectionReducer(s, { type: 'click', id: 'a' })).toBe(s);
    // Clearing it does.
    expect(selectionReducer(s, { type: 'clear' })).not.toBe(s);
    // Clicking it again while typing in it ends the edit, which is a change.
    const editing = state(['a'], { editingId: 'a' });
    expect(selectionReducer(editing, { type: 'click', id: 'a' })).not.toBe(editing);
    const empty = EMPTY_SELECTION;
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });
});

describe('selection reducer — marquee and select all', () => {
  it('setMany replaces by default and unions when additive', () => {
    const s = state(['a']);
    expect(selectedIds(selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual(
      ['b', 'c'],
    );
    expect(selectedIds(selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual(
      ['a', 'b', 'c'],
    );
  });

  it('an additive marquee over an existing selection keeps the existing ids (TC-20)', () => {
    let s = state(['x']);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(selectedIds(s)).toEqual(['a', 'b', 'x']);
    // Nothing inside the rectangle: the selection stays exactly as it was.
    const unchanged = selectionReducer(s, { type: 'setMany', ids: [], additive: true });
    expect(unchanged).toBe(s);
  });

  it('selecting nothing selects nothing on an empty board (boundary)', () => {
    const s = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });
});

describe('selection reducer — ids that are not on the board', () => {
  it('actions naming an absent id are ignored (error path)', () => {
    const s = state(['a'], { present: new Set(['a', 'b']) });
    expect(selectionReducer(s, { type: 'click', id: 'gone' })).toBe(s);
    expect(selectionReducer(s, { type: 'toggle', id: 'gone' })).toBe(s);
    expect(
      selectedIds(selectionReducer(s, { type: 'setMany', ids: ['b', 'gone'], additive: false })),
    ).toEqual(['b']);
  });

  it('TC-15: a delete by somebody else leaves the selection, and its editing state', () => {
    const s = state(['a', 'b', 'c'], {
      editingId: 'b',
      present: new Set(['a', 'b', 'c']),
    });
    const pruned = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(selectedIds(pruned)).toEqual(['a', 'c']);
    expect(pruned.editingId).toBeNull();
    expect([...(pruned.present ?? [])].sort()).toEqual(['a', 'c', 'd']);
  });

  it('pruning everything empties the selection; pruning nothing changes nothing', () => {
    const s = state(['a', 'b'], { present: new Set(['a', 'b']) });
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['x']) }).ids.size).toBe(0);
    const untouched = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(untouched).toBe(s);
    // A first prune also records what the board holds, so later actions can be
    // checked against it.
    const fresh = selectionReducer(state(['a']), { type: 'prune', presentIds: new Set(['a']) });
    expect([...(fresh.present ?? [])]).toEqual(['a']);
    // An editor on an id that is still there keeps editing.
    const editing = state(['a'], { editingId: 'a' });
    expect(
      selectionReducer(editing, { type: 'prune', presentIds: new Set(['a', 'b']) }).editingId,
    ).toBe('a');
  });
});

describe('selection reducer — editing and clearing', () => {
  it('startEdit selects exactly the note being edited; endEdit keeps the selection', () => {
    const s = state(['a', 'b']);
    const editing = selectionReducer(s, { type: 'edit', id: 'b' });
    expect(selectedIds(editing)).toEqual(['b']);
    expect(editing.editingId).toBe('b');
    const stopped = selectionReducer(editing, { type: 'edit', id: null });
    expect(stopped.editingId).toBeNull();
    expect(selectedIds(stopped)).toEqual(['b']);
    // Ending an edit that was not happening is not a change.
    expect(selectionReducer(stopped, { type: 'edit', id: null })).toBe(stopped);
  });

  it('clear drops both the selection and the editor', () => {
    const s = state(['a', 'b'], { editingId: 'a', present: new Set(['a', 'b']) });
    const cleared = selectionReducer(s, { type: 'clear' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.editingId).toBeNull();
    expect(cleared.present).toEqual(s.present);
  });
});
