/**
 * Story 7 unit tests: the selection reducer (`sel.interaction`).
 *
 * Which objects are selected is a small ruleset and everything else in the story — the
 * bounding box, the bar, what a gesture moves — is downstream of it, so the rules are
 * tested as pure functions: click replaces, Shift-click toggles, a marquee adds, Select
 * all replaces, Escape clears, and a delete that came from somebody else *prunes*.
 *
 * The reducer never sees the document: `prune` is handed the ids that still exist, which
 * is the one way the board speaks back to a per-client selection.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState
} from '../../src/client/board/useSelection';

/** Run a list of actions from the empty selection and hand back what is selected. */
function run(...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, EMPTY_SELECTION);
}

/** The same, starting somewhere other than empty. */
function apply(from: SelectionState, ...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, from);
}

const idsOf = (state: SelectionState): string[] => [...state.ids];

describe('selectionReducer (sel.interaction)', () => {
  it('TC-13: click then Shift-click then click builds and narrows the selection', () => {
    expect(idsOf(run({ type: 'click', id: 'a' }))).toEqual(['a']);
    expect(idsOf(run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }))).toEqual(['a', 'b']);
    // A plain click on anything replaces everything: it selects only what was clicked.
    expect(idsOf(run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'click', id: 'b' }))).toEqual([
      'b'
    ]);
  });

  it('Shift-click removes one object and leaves the others alone', () => {
    const state = run(
      { type: 'click', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'toggle', id: 'c' },
      { type: 'toggle', id: 'b' }
    );
    expect(idsOf(state)).toEqual(['a', 'c']);
  });

  it('TC-14: removing the last object leaves an empty selection', () => {
    const state = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
    // And the empty selection is the same shape as the one the board starts in.
    expect(state.ids.size).toBe(EMPTY_SELECTION.ids.size);
  });

  it('setMany adds a marquee to what is already selected and replaces it without', () => {
    expect(idsOf(run({ type: 'click', id: 'a' }, { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual([
      'a',
      'b',
      'c'
    ]);
    expect(idsOf(run({ type: 'click', id: 'a' }, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual([
      'b',
      'c'
    ]);
  });

  it('an empty board Select all selects nothing and is not an error', () => {
    const state = run({ type: 'setMany', ids: [], additive: false });
    expect(state.ids.size).toBe(0);
  });

  it('a change that changes nothing is the same state object', () => {
    // React re-renders on a new object; a marquee over nothing, and a click on the object
    // already alone in the selection, must not be one.
    const one = run({ type: 'click', id: 'a' });
    expect(apply(one, { type: 'click', id: 'a' })).toBe(one);
    expect(apply(one, { type: 'setMany', ids: [], additive: true })).toBe(one);
    expect(apply(one, { type: 'clear' })).not.toBe(one);
    expect(apply(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });

  it('TC-15: an object deleted by somebody else leaves the selection', () => {
    const state = run(
      { type: 'click', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'toggle', id: 'c' },
      { type: 'prune', presentIds: new Set(['a', 'c']) }
    );
    expect(idsOf(state)).toEqual(['a', 'c']);
  });

  it('every object deleted by somebody else leaves it empty', () => {
    const state = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'prune', presentIds: new Set() });
    expect(state.ids.size).toBe(0);
  });

  it('a prune that removes nothing is the same state object', () => {
    const state = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' });
    expect(apply(state, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) })).toBe(state);
  });

  it('editing an object selects it alone, and ending the edit keeps it selected', () => {
    const editing = run({ type: 'click', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'edit', id: 'b' });
    expect(idsOf(editing)).toEqual(['b']);
    expect(editing.editingId).toBe('b');
    const closed = apply(editing, { type: 'edit', id: null });
    expect(closed.editingId).toBeNull();
    expect(idsOf(closed)).toEqual(['b']);
  });

  it('an editor whose object is deleted closes on its own', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'prune', presentIds: new Set(['b']) });
    expect(state.editingId).toBeNull();
    expect(state.ids.size).toBe(0);
  });

  it('Shift-clicking the object being typed into closes the editor with it', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(state.editingId).toBeNull();
    expect(state.ids.size).toBe(0);
  });

  it('clearing the selection closes the editor too', () => {
    const state = run({ type: 'edit', id: 'a' }, { type: 'clear' });
    expect(state.editingId).toBeNull();
    expect(state.ids.size).toBe(0);
  });
});
