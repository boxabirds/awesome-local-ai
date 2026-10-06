import { describe, expect, it } from 'vitest';

import { selectionReducer, type SelectionAction, type SelectionState } from '../../src/client/board/useSelection.js';

/**
 * The selection state machine (unit, `sel.click` / `sel.shift_toggle` /
 * `sel.remote_delete`). The reducer is pure, so these cases - which are rules
 * about a set, not about rendering - are checked without a DOM.
 */

const state = (ids: readonly string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

const idsOf = (s: SelectionState): string[] => [...s.ids].sort();

function run(initial: SelectionState, ...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, initial);
}

describe('selection reducer (TC-13, TC-14, TC-15)', () => {
  it('TC-13 click replaces a three-object selection with one', () => {
    const result = run(state(['a', 'b', 'c']), { type: 'click', id: 'b' });
    expect(idsOf(result)).toEqual(['b']);
  });

  it('TC-13 click on an already-selected object keeps it selected (a lone selection)', () => {
    const result = run(state(['b']), { type: 'click', id: 'b' });
    expect(idsOf(result)).toEqual(['b']);
  });

  it('TC-13 toggle adds an object to the selection', () => {
    const result = run(state(['a']), { type: 'toggle', id: 'b' });
    expect(idsOf(result)).toEqual(['a', 'b']);
  });

  it('TC-13 toggle removes an object that is already selected', () => {
    const result = run(state(['a', 'b', 'c']), { type: 'toggle', id: 'b' });
    expect(idsOf(result)).toEqual(['a', 'c']);
  });

  it('TC-14 toggling the last object off leaves an empty selection', () => {
    const result = run(state(['a']), { type: 'toggle', id: 'a' });
    expect(idsOf(result)).toEqual([]);
    expect(result.ids.size).toBe(0);
  });

  it('TC-14 toggling the last of three off leaves two', () => {
    const result = run(state(['a', 'b', 'c']), { type: 'toggle', id: 'c' });
    expect(idsOf(result)).toEqual(['a', 'b']);
  });

  it('TC-15 prune drops ids that are no longer present and keeps the rest', () => {
    // 'b' was deleted by someone else; 'a' and 'c' survive.
    const result = run(state(['a', 'b', 'c']), { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(idsOf(result)).toEqual(['a', 'c']);
  });

  it('TC-15 prune closes the editor when the edited object is gone', () => {
    const result = run(state(['a', 'b'], 'b'), { type: 'prune', presentIds: new Set(['a']) });
    expect(idsOf(result)).toEqual(['a']);
    expect(result.editingId).toBeNull();
  });

  it('TC-15 prune keeps the editor when the edited object survives', () => {
    const result = run(state(['a', 'b'], 'b'), { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(result.editingId).toBe('b');
  });

  it('a prune that changes nothing returns the same state object (no needless re-render)', () => {
    const start = state(['a', 'b']);
    const result = selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) });
    expect(result).toBe(start);
  });

  it('setMany replaces for select-all and adds for the marquee', () => {
    // Non-additive (select-all) replaces.
    expect(idsOf(run(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual(['b', 'c']);
    // Additive (marquee) joins what was already selected.
    expect(idsOf(run(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('opening an editor collapses the selection to the edited object', () => {
    const result = run(state(['a', 'b', 'c']), { type: 'edit', id: 'b' });
    expect(idsOf(result)).toEqual(['b']);
    expect(result.editingId).toBe('b');
  });

  it('ending an editor keeps the selection', () => {
    const result = run(state(['a', 'b'], 'b'), { type: 'edit', id: null });
    expect(idsOf(result)).toEqual(['a', 'b']);
    expect(result.editingId).toBeNull();
  });

  it('clear empties the selection and closes the editor', () => {
    const result = run(state(['a', 'b'], 'a'), { type: 'clear' });
    expect(result.ids.size).toBe(0);
    expect(result.editingId).toBeNull();
  });
});
