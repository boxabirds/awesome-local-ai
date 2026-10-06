/**
 * Unit tests for the selection reducer (design capability `sel.selection`, TC-13 to TC-15).
 *
 * The selection is local state and the PRD states its rules as a list, so the list is tested as
 * it is written in the PRD: one action in, one selection out. `src/client/board/useSelection.ts`
 * is a thin wrapper over this reducer — what the hook adds is only React state and the pruning
 * that notices an object has gone away.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

/** Runs the actions in order and returns the selection they leave behind. */
function run(...actions: SelectionAction[]): SelectionState {
  return actions.reduce((state, action) => selectionReducer(state, action), EMPTY_SELECTION);
}

/** The selected ids, in selection order. */
const idsOf = (state: SelectionState): string[] => [...state.ids];

describe('TC-13 the rules of the PRD, in order', () => {
  it('starts with nothing selected and nothing being edited', () => {
    expect(idsOf(EMPTY_SELECTION)).toEqual([]);
    expect(EMPTY_SELECTION.editingId).toBeNull();
  });

  it('a click selects one object and nothing else', () => {
    expect(idsOf(run({ type: 'click', id: 'a' }))).toEqual(['a']);
    expect(idsOf(run({ type: 'click', id: 'a' }, { type: 'click', id: 'b' }))).toEqual(['b']);
  });

  it('a click on an object that is already selected keeps the whole selection', () => {
    // Otherwise pressing one note of a group to drag it would drop the other nineteen.
    const state = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'toggle', id: 'c' });
    expect(idsOf(state)).toEqual(['a', 'b', 'c']);
    expect(idsOf(runFrom(state, { type: 'click', id: 'c' }))).toEqual(['a', 'b', 'c']);
  });

  it('shift-click adds an object, and shift-clicking it again takes it out', () => {
    expect(idsOf(run({ type: 'toggle', id: 'a' }))).toEqual(['a']);
    expect(idsOf(run({ type: 'toggle', id: 'a' }, { type: 'toggle', id: 'b' }))).toEqual(['a', 'b']);
    expect(
      idsOf(
        run(
          { type: 'toggle', id: 'a' },
          { type: 'toggle', id: 'b' },
          { type: 'toggle', id: 'c' },
        ),
      ),
    ).toEqual(['a', 'b', 'c']);
    expect(
      idsOf(
        run(
          { type: 'toggle', id: 'a' },
          { type: 'toggle', id: 'b' },
          { type: 'toggle', id: 'c' },
          { type: 'toggle', id: 'b' },
        ),
      ),
    ).toEqual(['a', 'c']);
  });

  it('the whole sequence of TC-13 ends where the PRD says it does', () => {
    let state = EMPTY_SELECTION;
    const steps: [string, string[]][] = [];
    for (const action of [
      { type: 'click', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'toggle', id: 'c' },
      { type: 'toggle', id: 'b' },
      { type: 'click', id: 'b' },
      { type: 'clear' },
    ] as SelectionAction[]) {
      state = selectionReducer(state, action);
      steps.push([action.type, idsOf(state)]);
    }
    expect(steps).toEqual([
      ['click', ['a']],
      ['toggle', ['a', 'b']],
      ['toggle', ['a', 'b', 'c']],
      ['toggle', ['a', 'c']],
      ['click', ['b']],
      ['clear', []],
    ]);
  });

  it('emptying the selection is allowed and is what the board calls "Empty"', () => {
    const state = run({ type: 'click', id: 'a' }, { type: 'clear' });
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
  });

  it('takes the ids it is handed on trust, which is why the board reads them from the document', () => {
    // The reducer has no idea what an object is; the board only ever offers it ids it has just
    // read from the document, so a marquee that has gone stale cannot select a ghost.
    expect(idsOf(run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'ghost' }))).toEqual([
      'a',
      'ghost',
    ]);
  });
});

/** Applies one action to a state the test already built. */
function runFrom(state: SelectionState, action: SelectionAction): SelectionState {
  return selectionReducer(state, action);
}

describe('TC-14 an object deleted remotely leaves the selection on its own', () => {
  const three = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'toggle', id: 'c' });

  it('drops the object that is gone and keeps the rest', () => {
    const state = runFrom(three, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(idsOf(state)).toEqual(['a', 'c']);
  });

  it('closes the editing surface of the object that went away', () => {
    const editing = runFrom(three, { type: 'edit', id: 'b' });
    expect(editing.editingId).toBe('b');
    const state = runFrom(editing, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(state.editingId).toBeNull();
    expect(idsOf(state)).toEqual(['a', 'c']);
  });

  it('leaves another object editing alone', () => {
    // The deleted object was the one being edited for nobody else: the editing surface of the
    // object that survives stays open, and the selection loses only what the document lost.
    const editing = runFrom(three, { type: 'edit', id: 'b' });
    const state = runFrom(editing, { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(state.editingId).toBe('b');
    expect(idsOf(state)).toEqual(['a', 'b']);
  });

  it('is nothing at all when every selected object is still there', () => {
    const state = runFrom(three, { type: 'prune', presentIds: new Set(['a', 'b', 'c', 'd']) });
    // The same state object: a document update that changes nothing must not repaint the board.
    expect(state).toBe(three);
  });

  it('can empty the selection when the last object on the board is deleted', () => {
    const one = run({ type: 'click', id: 'a' });
    const state = runFrom(one, { type: 'prune', presentIds: new Set() });
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
  });
});

describe('TC-15 select all and the marquee', () => {
  it('an exclusive list replaces the selection', () => {
    const state = run(
      { type: 'click', id: 'a' },
      { type: 'setMany', ids: ['a', 'b', 'c'], additive: false },
    );
    expect(idsOf(state)).toEqual(['a', 'b', 'c']);
  });

  it('an additive list adds what was not already selected, in order', () => {
    const state = run(
      { type: 'click', id: 'a' },
      { type: 'setMany', ids: ['b', 'a', 'c'], additive: true },
    );
    expect(idsOf(state)).toEqual(['a', 'b', 'c']);
  });

  it('an additive list that selects nothing leaves the selection alone', () => {
    // The marquee's rule: dragging over thin air does not deselect what you had.
    const state = run({ type: 'click', id: 'a' }, { type: 'setMany', ids: [], additive: true });
    expect(idsOf(state)).toEqual(['a']);
  });

  it('an exclusive empty list is select none', () => {
    // Select all on a board that holds nothing is the same as *select none*: Empty.
    const state = run({ type: 'click', id: 'a' }, { type: 'setMany', ids: [], additive: false });
    expect(idsOf(state)).toEqual([]);
  });

  it('select all on a board of unknown objects selects everything the build knows about', () => {
    // The board hands over the ids it read; the reducer does not know what an object is.
    const state = run({ type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(idsOf(state)).toEqual(['a', 'b']);
  });

  it('selecting an object again does not move it to the end of the order', () => {
    const state = run(
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'a' },
    );
    expect(idsOf(state)).toEqual(['b', 'a']);
  });
});

describe('the editing surface', () => {
  it('is opened by edit, which also selects the object', () => {
    const state = run({ type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
    expect(idsOf(state)).toEqual(['a']);
  });

  it('joins an object that is already in a group to the editing surface without breaking the group', () => {
    // The PRD asks that the object be selected and be the only one open, not that the group be
    // thrown away. The exclusive selection a double-click leaves behind is the press's doing: a
    // press on one note of a group either keeps the group (it was in it) or replaces it (it was not).
    const group = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' });
    const state = runFrom(group, { type: 'edit', id: 'b' });
    expect(state.editingId).toBe('b');
    expect(idsOf(state)).toEqual(['a', 'b']);
  });

  it('adds an object to the selection when it opens an editor on something outside it', () => {
    const state = run({ type: 'toggle', id: 'a' }, { type: 'edit', id: 'b' });
    expect(state.editingId).toBe('b');
    expect(idsOf(state)).toEqual(['a', 'b']);
  });

  it('keeps one editing surface when another object opens one', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'edit', id: 'b' });
    expect(state.editingId).toBe('b');
  });

  it('closes without dropping the selection, which is what Escape does', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'edit', id: null });
    expect(state.editingId).toBeNull();
    // The object stays where it was selected: closing a text body is not a way of deselecting.
    expect(idsOf(state)).toEqual(['a']);
  });

  it('closes when Shift-click takes the edited object out of the selection', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(state.editingId).toBeNull();
    expect(idsOf(state)).toEqual([]);
  });

  it('stays open while the selection grows around it, because nothing dropped it', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'toggle', id: 'b' });
    expect(state.editingId).toBe('a');
    expect(idsOf(state)).toEqual(['a', 'b']);
  });

  it('closes when a marquee or a select-all replaces the selection with one that does not hold it', () => {
    const replaced = run({ type: 'edit', id: 'a' }, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(replaced.editingId).toBeNull();
    // …and stays open when the new selection does hold it.
    const held = run({ type: 'edit', id: 'a' }, { type: 'setMany', ids: ['a', 'c'], additive: false });
    expect(held.editingId).toBe('a');
  });

  it('is only ever open on one object, which is in the selection', () => {
    const state = run(
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'edit', id: 'b' },
    );
    // What is open is in the selection: the reducer will not open a text body on air.
    expect(state.editingId).toBe('b');
    expect(idsOf(state)).toEqual(['a', 'b']);
  });

  it('clear closes it too, because there is nothing left to edit', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'clear' });
    expect(state.editingId).toBeNull();
  });

  it('a second edit of the same object changes nothing', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
  });
});
