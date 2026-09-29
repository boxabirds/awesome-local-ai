// Story 7, contract `sel.interaction` — unit tests TC-13 to TC-15 of the pure
// selection reducer (the hook that feeds it is covered by component tests).

import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  EMPTY_SELECTION,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection.ts';

/** A state with the given selection, editing id and known-present ids. */
function state(
  ids: readonly string[],
  editingId: string | null = null,
  presentIds: readonly string[] | null = ['a', 'b', 'c', 'd'],
): SelectionState {
  return {
    ids: new Set(ids),
    editingId,
    presentIds: presentIds === null ? null : new Set(presentIds),
  };
}

function idsOf(s: SelectionState): string[] {
  return [...s.ids];
}

function run(initial: SelectionState, actions: readonly SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, initial);
}

describe('sel.interaction reducer', () => {
  it('TC-13 click replaces, toggle adds, click again isolates', () => {
    const start = state([]);
    const afterClickA = selectionReducer(start, { type: 'click', id: 'a' });
    expect(idsOf(afterClickA)).toEqual(['a']);
    const afterToggleB = selectionReducer(afterClickA, { type: 'toggle', id: 'b' });
    expect(idsOf(afterToggleB)).toEqual(['a', 'b']);
    const afterClickB = selectionReducer(afterToggleB, { type: 'click', id: 'b' });
    expect(idsOf(afterClickB)).toEqual(['b']);
    // the whole chain, in one go
    expect(
      run(state([]), [
        { type: 'click', id: 'a' },
        { type: 'toggle', id: 'b' },
        { type: 'click', id: 'b' },
      ]),
    ).toMatchObject({ ids: new Set(['b']), editingId: null });
  });

  it('TC-13b a click leaves editing, and select-all is not additive', () => {
    const editing = state(['a'], 'a');
    expect(selectionReducer(editing, { type: 'click', id: 'b' })).toMatchObject({
      ids: new Set(['b']),
      editingId: null,
    });
    const many = state(['a'], 'a');
    expect(
      selectionReducer(many, { type: 'setMany', ids: ['c', 'd'], additive: false }),
    ).toMatchObject({ ids: new Set(['c', 'd']), editingId: null });
    // additive (the marquee) keeps what was already selected
    expect(
      selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true }),
    ).toMatchObject({ ids: new Set(['a', 'b', 'c']) });
    // an additive marquee that finds nothing leaves the selection alone
    const before = state(['a']);
    expect(selectionReducer(before, { type: 'setMany', ids: [], additive: true })).toBe(before);
  });

  it('TC-14 toggling the last member empties the selection', () => {
    const only = selectionReducer(state(['a']), { type: 'toggle', id: 'a' });
    expect(idsOf(only)).toEqual([]);
    expect(only.ids.size).toBe(0);
    // and toggling it back in works
    expect(idsOf(selectionReducer(only, { type: 'toggle', id: 'a' }))).toEqual(['a']);
    // an empty selection toggled off stays empty
    expect(idsOf(selectionReducer(state([]), { type: 'toggle', id: 'ghost' }))).toEqual([]);
  });

  it('TC-15 pruning keeps the survivors, ends the edit of a pruned object', () => {
    const three = state(['a', 'b', 'c'], 'b');
    const pruned = selectionReducer(three, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(idsOf(pruned)).toEqual(['a', 'c']);
    expect(pruned.editingId).toBeNull();
    expect(pruned.presentIds).toEqual(new Set(['a', 'c', 'd']));
  });

  it('TC-15b pruning everything selected empties the selection; a survivor keeps editing', () => {
    const all = state(['a', 'b', 'c'], 'a');
    const gone = selectionReducer(all, { type: 'prune', presentIds: new Set(['d']) });
    expect(idsOf(gone)).toEqual([]);
    expect(gone.editingId).toBeNull();
    // still here: still being edited
    const kept = selectionReducer(all, { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(idsOf(kept)).toEqual(['a', 'b']);
    expect(kept.editingId).toBe('a');
    // an already matching prune returns the very same state (no re-render churn)
    expect(selectionReducer(kept, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(kept);
    // pruning an already-empty, never-pruned selection is a no-op too
    expect(selectionReducer(EMPTY_SELECTION, { type: 'prune', presentIds: new Set() })).toBe(
      EMPTY_SELECTION,
    );
  });

  it('actions naming an id that does not exist are ignored (error path)', () => {
    const s = state(['a']); // presentIds = a,b,c,d
    expect(selectionReducer(s, { type: 'click', id: 'nope' })).toBe(s);
    expect(selectionReducer(s, { type: 'toggle', id: 'nope' })).toBe(s);
    expect(selectionReducer(s, { type: 'setMany', ids: ['nope'], additive: true })).toBe(s);
    // a non-additive set of nothing clears the selection, as select-all on an empty board does
    expect(idsOf(selectionReducer(s, { type: 'setMany', ids: ['nope'], additive: false }))).toEqual(
      [],
    );
    // a partial match keeps only the ids that exist
    expect(
      idsOf(selectionReducer(state([]), { type: 'setMany', ids: ['b', 'nope'], additive: false })),
    ).toEqual(['b']);
  });

  it('edit selects the object and ends on null; clearing empties everything', () => {
    const edited = selectionReducer(state([]), { type: 'edit', id: 'a' });
    expect(idsOf(edited)).toEqual(['a']);
    expect(edited.editingId).toBe('a');
    // editing is idempotent (double-click may fire twice)
    expect(selectionReducer(edited, { type: 'edit', id: 'a' })).toBe(edited);
    expect(selectionReducer(edited, { type: 'edit', id: null })).toMatchObject({
      editingId: null,
      ids: new Set(['a']),
    });
    // Typing into one object of a group narrows the selection to it: the keys that
    // follow a click into the text act on the object being typed into.
    expect(idsOf(selectionReducer(state(['a', 'b', 'c']), { type: 'edit', id: 'b' }))).toEqual([
      'b',
    ]);
    // an id nobody has heard of can still be edited (it was just created)
    expect(idsOf(selectionReducer(state([]), { type: 'edit', id: 'fresh' }))).toEqual(['fresh']);
    expect(selectionReducer(state(['a', 'b'], 'a'), { type: 'clear' })).toMatchObject({
      ids: new Set(),
      editingId: null,
    });
    // an empty selection that is cleared again returns the same state
    const empty = selectionReducer(state([]), { type: 'clear' });
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });

  it('an unknown action changes nothing', () => {
    const s = state(['a']);
    expect(selectionReducer(s, { type: 'what' } as unknown as SelectionAction)).toBe(s);
    expect(EMPTY_SELECTION.ids.size).toBe(0);
    expect(EMPTY_SELECTION.editingId).toBeNull();
  });
});
