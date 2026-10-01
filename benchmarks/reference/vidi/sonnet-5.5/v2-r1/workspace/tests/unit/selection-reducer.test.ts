import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectionReducer } from '../../src/client/board/useSelection';
import type { SelectionAction, SelectionState } from '../../src/client/board/useSelection';

const run = (state: SelectionState, ...actions: SelectionAction[]) => actions.reduce(selectionReducer, state);
const ids = (s: SelectionState) => [...s.ids].sort();

describe('selectionReducer', () => {
  it('TC-13 click replaces the set; toggle adds and removes', () => {
    let s = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    s = run(s, { type: 'toggle', id: 'b' });
    expect(ids(s)).toEqual(['a', 'b']);
    s = run(s, { type: 'click', id: 'b' });
    expect(ids(s)).toEqual(['b']);
  });

  it('TC-14 toggling off the last member empties the selection', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 prune drops absent ids and ends editing of a pruned id', () => {
    let s = run(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    s = run(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(s)).toEqual(['a', 'c']);
    s = run(EMPTY_SELECTION, { type: 'edit', id: 'b' }, { type: 'prune', presentIds: new Set(['a']) });
    expect(s.editingId).toBeNull();
    expect(s.ids.size).toBe(0);
  });

  it('prune keeps state identity when nothing changes', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'z']) })).toBe(s);
  });

  it('setMany is additive or replacing', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(ids(run(s, { type: 'setMany', ids: ['b', 'c'], additive: true }))).toEqual(['a', 'b', 'c']);
    expect(ids(run(s, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual(['b', 'c']);
    expect(run(s, { type: 'setMany', ids: [], additive: true })).toBe(s);
  });

  it('clear empties; edit selects only the edited object', () => {
    const s = run(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b'], additive: false }, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    const e = run(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b'], additive: false }, { type: 'edit', id: 'a' });
    expect(ids(e)).toEqual(['a']);
    expect(e.editingId).toBe('a');
    expect(run(e, { type: 'edit', id: null }).editingId).toBeNull();
  });
});
