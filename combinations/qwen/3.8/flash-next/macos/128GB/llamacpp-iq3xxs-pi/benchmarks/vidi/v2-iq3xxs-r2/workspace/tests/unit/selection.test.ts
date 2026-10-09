import { describe, expect, it } from 'vitest';
import {
  emptySelection,
  selectionInit,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

/**
 * Story 7, `sel.interaction`: the selection as a pure reducer. Selection is per client
 * and never written to the document, so the state machine is testable without a document
 * at all — the one thing it does need to know about the document is which ids are still
 * in it, which arrives as the `prune` action.
 */

const PRESENT = ['a', 'b', 'c', 'd'];

function selected(...ids: string[]): SelectionState {
  return selectionInit(PRESENT, new Set(ids));
}

function idsOf(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('click and toggle (TC-13, TC-14)', () => {
  it('TC-13: click selects one, Shift+click adds, a plain click replaces the whole set', () => {
    // Starting from an empty selection on a board that holds a, b, c and d.
    let state = selectionReducer(selectionInit(PRESENT), { type: 'click', id: 'a' });
    expect(idsOf(state)).toEqual(['a']);
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(idsOf(state)).toEqual(['a', 'b']);
    // sel.drag_unselected leans on this: clicking one object drops the rest.
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(idsOf(state)).toEqual(['b']);
  });

  it('clicking the object that is already the whole selection is not a no-op trap', () => {
    const state = selected('a');
    expect(idsOf(selectionReducer(state, { type: 'click', id: 'a' }))).toEqual(['a']);
  });

  it('TC-14: Shift+clicking the only member empties the selection (boundary)', () => {
    const state = selectionReducer(selected('a'), { type: 'toggle', id: 'a' });
    expect(idsOf(state)).toEqual([]);
    expect(state.ids.size).toBe(0);
  });

  it('Shift+click adds what is missing and removes what is there', () => {
    const added = selectionReducer(selected('a'), { type: 'toggle', id: 'b' });
    expect(idsOf(added)).toEqual(['a', 'b']);
    const removed = selectionReducer(selected('a', 'b'), { type: 'toggle', id: 'b' });
    expect(idsOf(removed)).toEqual(['a']);
  });

  it('leaves editing alone: a click is not an edit of anybody', () => {
    const editing = { ...selected('a', 'b'), editingId: 'a' };
    expect(selectionReducer(editing, { type: 'click', id: 'b' }).editingId).toBe('a');
    expect(selectionReducer(editing, { type: 'toggle', id: 'c' }).editingId).toBe('a');
  });
});

describe('setMany: marquee and select all (TC-13 to TC-15 shape)', () => {
  it('replaces the selection when not additive', () => {
    const state = selectionReducer(selected('a'), {
      type: 'setMany',
      ids: ['b', 'c'],
      additive: false,
    });
    expect(idsOf(state)).toEqual(['b', 'c']);
  });

  it('adds to the selection when additive, and never removes from it', () => {
    const state = selectionReducer(selected('a'), {
      type: 'setMany',
      ids: ['b', 'c'],
      additive: true,
    });
    expect(idsOf(state)).toEqual(['a', 'b', 'c']);
    // An empty marquee leaves what was selected before it (TC-20, TC-22).
    const kept = selectionReducer(selected('a', 'b'), {
      type: 'setMany',
      ids: [],
      additive: true,
    });
    expect(idsOf(kept)).toEqual(['a', 'b']);
  });

  it('select-all on an empty board is an empty selection, not an error (TC-28)', () => {
    const state = selectionReducer(selectionInit([], new Set(['a'])), {
      type: 'setMany',
      ids: [],
      additive: false,
    });
    expect(idsOf(state)).toEqual([]);
  });
});

describe('clear', () => {
  it('empties the selection (Escape, empty-space click, Delete)', () => {
    const state = selectionReducer(selected('a', 'b'), { type: 'clear' });
    expect(idsOf(state)).toEqual([]);
  });

  it('does not quietly end editing, which is a separate action', () => {
    const editing = { ...selected('a'), editingId: 'a' };
    expect(selectionReducer(editing, { type: 'clear' }).editingId).toBe('a');
  });

  it('an already empty selection is returned unchanged', () => {
    const empty = selectionInit(PRESENT);
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });
});

describe('prune (TC-15, TC-16)', () => {
  it('TC-15: ids somebody else deleted leave the selection, and editing one of them ends', () => {
    const before: SelectionState = { ...selected('a', 'b', 'c'), editingId: 'b' };
    const after = selectionReducer(before, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(idsOf(after)).toEqual(['a', 'c']);
    // Editing an object that is gone cannot continue (the editor is gone with it).
    expect(after.editingId).toBeNull();
  });

  it('TC-16: pruning every member leaves an empty selection, which hides the bar', () => {
    const before = selected('a', 'b');
    const after = selectionReducer(before, { type: 'prune', presentIds: new Set(['x']) });
    expect(idsOf(after)).toEqual([]);
  });

  it('keeps editing an object that is still there', () => {
    const before: SelectionState = { ...selected('a', 'b'), editingId: 'b' };
    const after = selectionReducer(before, { type: 'prune', presentIds: new Set(PRESENT) });
    expect(after.editingId).toBe('b');
    expect(idsOf(after)).toEqual(['a', 'b']);
  });

  it('a document that lost nothing returns the same state, so nothing re-renders', () => {
    const before = selected('a');
    expect(selectionReducer(before, { type: 'prune', presentIds: new Set(PRESENT) })).toBe(before);
  });

  it('an object that came back is known to be present again', () => {
    const halfGone = selectionReducer(selected('a'), { type: 'prune', presentIds: new Set(['c']) });
    expect(halfGone.present.has('a')).toBe(false);
    const back = selectionReducer(halfGone, { type: 'prune', presentIds: new Set(PRESENT) });
    expect(back.present.has('a')).toBe(true);
  });
});

describe('edit', () => {
  it('names the object whose text is being edited, and null ends it', () => {
    let state = selectionReducer(selected('a'), { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
    state = selectionReducer(state, { type: 'edit', id: null });
    expect(state.editingId).toBeNull();
    // Ending editing keeps the selection (Escape leaves the note selected, story 2).
    expect(idsOf(state)).toEqual(['a']);
  });
});

/*
 * An object this client has just written into the document exists, even though the snapshot
 * this render was built from has not caught up with the write. Without this the editor a
 * double-click on empty board space asks for is refused for one render, and lands only when
 * something else happens to re-render the board.
 */
describe('know: an object this client has just created', () => {
  it('lets an edit of the new object through, where a bare edit of an unknown id is dropped', () => {
    const before = selectionInit(PRESENT);
    expect(selectionReducer(before, { type: 'edit', id: 'new' })).toBe(before);

    const known = selectionReducer(before, { type: 'know', id: 'new' });
    expect(known.present.has('new')).toBe(true);
    // Merely knowing an object is not selecting it.
    expect(idsOf(known)).toEqual([]);
    expect(selectionReducer(known, { type: 'edit', id: 'new' }).editingId).toBe('new');
  });

  it('is undone by the next prune that still does not report the object', () => {
    let state = selectionReducer(selected('a'), { type: 'know', id: 'new' });
    state = selectionReducer(state, { type: 'setMany', ids: ['new'], additive: false });
    state = selectionReducer(state, { type: 'edit', id: 'new' });
    expect(state.editingId).toBe('new');
    expect(idsOf(state)).toEqual(['new']);

    // The write never made it after all: the snapshot has never heard of it.
    const after = selectionReducer(state, { type: 'prune', presentIds: new Set(PRESENT) });
    expect(after.editingId).toBeNull();
    expect(idsOf(after)).toEqual([]);
  });

  it('knowing an object the snapshot already reports changes nothing', () => {
    const before = selectionInit(PRESENT);
    expect(selectionReducer(before, { type: 'know', id: 'a' })).toBe(before);
  });
});

describe('actions for ids that are not in the document are ignored (contract error path)', () => {
  const state = selected('a');

  it('nothing is present on a board of its own, so nothing can be selected on it', () => {
    expect(idsOf(emptySelection)).toEqual([]);
    expect(emptySelection.editingId).toBeNull();
    // `emptySelection` knows of no object, so a click names one that is not there.
    expect(selectionReducer(emptySelection, { type: 'click', id: 'a' })).toBe(emptySelection);
  });

  it.each([
    ['click', { type: 'click', id: 'zzz' } as const],
    ['toggle', { type: 'toggle', id: 'zzz' } as const],
    ['edit', { type: 'edit', id: 'zzz' } as const],
  ])('%s on an absent id changes nothing', (_label, action) => {
    expect(selectionReducer(state, action)).toBe(state);
  });

  it('setMany keeps only the ids that are there', () => {
    const next = selectionReducer(state, { type: 'setMany', ids: ['b', 'zzz'], additive: false });
    expect(idsOf(next)).toEqual(['b']);
  });

  it('a selection of nothing that is absent cannot be built at all', () => {
    const next = selectionReducer(selected('a'), {
      type: 'setMany',
      ids: ['zzz'],
      additive: true,
    });
    expect(idsOf(next)).toEqual(['a']);
  });
});
