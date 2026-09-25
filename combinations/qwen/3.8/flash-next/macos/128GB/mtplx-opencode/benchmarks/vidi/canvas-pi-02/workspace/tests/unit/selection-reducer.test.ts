import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState, type SelectionAction } from '../../src/client/board/useSelection';

/**
 * Unit tests for the selection reducer (TC-13 to TC-15).
 */

function makeState(
  ids: Iterable<string> = [],
  editingId: string | null = null,
): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  it('TC-13 click replaces the set; toggle adds; click replaces', () => {
    let state = makeState();
    // Click a
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(state.ids).toEqual(new Set(['a']));

    // Toggle b
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(new Set(['a', 'b']));

    // Click b (replaces set)
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });

  // TC-14: {a} → toggle a → {} (removing last member)
  it('TC-14 toggle removing last member → empty set', () => {
    let state = makeState(['a']);
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids).toEqual(new Set());
  });

  // TC-15: {a,b,c} → prune {a,c,d} → {a,c}; editingId b → null
  it('TC-15 prune removes ids not in presentIds and clears editing if pruned', () => {
    let state = makeState(['a', 'b', 'c'], 'b');
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBeNull(); // 'b' was pruned, editing ends

    // Prune keeping editing id
    let state2 = makeState(['a', 'b'], 'a');
    state2 = selectionReducer(state2, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect(state2.ids).toEqual(new Set(['a']));
    expect(state2.editingId).toBe('a'); // editing id kept
  });

  it('setMany non-additive replaces selection', () => {
    let state = makeState(['a', 'b']);
    state = selectionReducer(state, { type: 'setMany', ids: ['c', 'd'], additive: false });
    expect(state.ids).toEqual(new Set(['c', 'd']));
  });

  it('setMany additive unions with existing', () => {
    let state = makeState(['a']);
    state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(state.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('clear removes all selections', () => {
    let state = makeState(['a', 'b'], 'a');
    state = selectionReducer(state, { type: 'clear' });
    expect(state.ids).toEqual(new Set());
    expect(state.editingId).toBeNull();
  });

  it('toggle on already-selected id removes it (other members kept)', () => {
    let state = makeState(['a', 'b', 'c']);
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(new Set(['a', 'c']));
  });

  it('click on already-selected id selects only it', () => {
    let state = makeState(['a', 'b']);
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });

  it('startEdit selects the object as well as opening it', () => {
    let state = makeState([]);
    state = selectionReducer(state, { type: 'startEdit', id: 'a' });
    expect(state.editingId).toBe('a');
    expect(state.ids).toEqual(new Set(['a']));
  });

  it('endEdit keeps the object selected when the edit ended on Escape', () => {
    // The story-5 rule: Escape leaves the note selected so its toolbar can
    // appear, so `ids` must still hold it once `editingId` is gone.
    let state = makeState(['a'], 'a');
    state = selectionReducer(state, { type: 'endEdit', keep: 'a' });
    expect(state.editingId).toBeNull();
    expect(state.ids).toEqual(new Set(['a']));
  });

  it('endEdit drops the selection when the click landed on the board', () => {
    let state = makeState(['a'], 'a');
    state = selectionReducer(state, { type: 'endEdit', keep: null });
    expect(state.editingId).toBeNull();
    expect(state.ids).toEqual(new Set());
  });
});