import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

/**
 * Story 7, sel.multi: the multi-selection reducer (unit level).
 * TC-13 to TC-15.
 *
 * The reducer is pure: it does not validate ids against a snapshot (the
 * `useSelection` hook guards those). It only computes the next state.
 */

const initial: SelectionState = { ids: new Set(), editingId: null };
const state = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

describe('selectionReducer', () => {
  it('click selects exactly one object and drops editing of others', () => {
    expect(selectionReducer(state(['a', 'b']), { type: 'click', id: 'c' })).toEqual(
      state(['c']),
    );
    // Clicking the object that is being edited keeps editing it.
    expect(selectionReducer(state(['a'], 'a'), { type: 'click', id: 'a' })).toEqual(
      state(['a'], 'a'),
    );
    // Clicking another object ends editing.
    expect(selectionReducer(state(['a'], 'a'), { type: 'click', id: 'b' })).toEqual(
      state(['b']),
    );
  });

  // TC-13
  it('TC-13: toggle adds or removes a single id; state unchanged for the same set', () => {
    expect(selectionReducer(initial, { type: 'toggle', id: 'a' })).toEqual(state(['a']));
    expect(selectionReducer(state(['a']), { type: 'toggle', id: 'b' })).toEqual(state(['a', 'b']));
    expect(selectionReducer(state(['a', 'b']), { type: 'toggle', id: 'a' })).toEqual(state(['b']));
    // Toggling the editing object ends editing.
    expect(selectionReducer(state(['a'], 'a'), { type: 'toggle', id: 'a' })).toEqual(state([]));
  });

  // TC-14
  it('TC-14: setMany is additive (marquee) or replacing (select-all)', () => {
    expect(selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true })).toEqual(
      state(['a', 'b', 'c']),
    );
    expect(selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false })).toEqual(
      state(['b', 'c']),
    );
    // Duplicates in the input are collapsed.
    expect(selectionReducer(initial, { type: 'setMany', ids: ['a', 'a', 'b'], additive: true })).toEqual(
      state(['a', 'b']),
    );
    // An object dropped from the set stops being edited.
    expect(
      selectionReducer(state(['a', 'b'], 'b'), { type: 'setMany', ids: ['a'], additive: false }),
    ).toEqual(state(['a']));
  });

  it('clear empties the selection and ends editing', () => {
    expect(selectionReducer(state(['a', 'b'], 'a'), { type: 'clear' })).toEqual(initial);
  });

  // TC-15
  it('TC-15: prune removes deleted ids (remote delete) and clears editing when its object vanished', () => {
    const present = new Set(['a', 'b']);
    expect(selectionReducer(state(['a', 'b', 'c']), { type: 'prune', presentIds: present })).toEqual(
      state(['a', 'b']),
    );
    // The edited object survives the prune → editing continues.
    expect(
      selectionReducer(state(['a', 'b'], 'b'), { type: 'prune', presentIds: present }),
    ).toEqual(state(['a', 'b'], 'b'));
    // The editing object was deleted remotely → editingId null.
    expect(
      selectionReducer(state(['a', 'b'], 'c'), { type: 'prune', presentIds: present }),
    ).toEqual(state(['a', 'b']));
    // Nothing to prune → same state reference (no re-render).
    const s = state(['a', 'b']);
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(s);
    // Pruning everything → empty selection.
    expect(selectionReducer(state(['a', 'b']), { type: 'prune', presentIds: new Set() })).toEqual(
      initial,
    );
  });

  it('edit sets the editing id (startEdit) and clears it (endEdit)', () => {
    expect(selectionReducer(state(['a']), { type: 'edit', id: 'a' })).toEqual(state(['a'], 'a'));
    expect(selectionReducer(state(['a'], 'a'), { type: 'edit', id: null })).toEqual(state(['a']));
  });
});
