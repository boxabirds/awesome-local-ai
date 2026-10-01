import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectionReducer, type SelectionAction, type SelectionState } from '../../src/client/board/useSelection';

const run = (actions: SelectionAction[], from: SelectionState = EMPTY_SELECTION) => actions.reduce(selectionReducer, from);
const ids = (s: SelectionState) => [...s.ids].sort();

describe('selectionReducer', () => {
  it('TC-13 click replaces the set; toggle adds', () => {
    let s = run([{ type: 'click', id: 'a' }]);
    expect(ids(s)).toEqual(['a']);
    s = run([{ type: 'toggle', id: 'b' }], s);
    expect(ids(s)).toEqual(['a', 'b']);
    s = run([{ type: 'click', id: 'b' }], s);
    expect(ids(s)).toEqual(['b']);
  });

  it('TC-14 toggling off the last member empties the selection', () => {
    expect(ids(run([{ type: 'click', id: 'a' }, { type: 'toggle', id: 'a' }]))).toEqual([]);
  });

  it('TC-15 prune drops ids that no longer exist and ends editing of a pruned id', () => {
    let s = run([{ type: 'setMany', ids: ['a', 'b', 'c'], additive: false }, { type: 'edit', id: 'b' }]);
    expect(s.editingId).toBe('b');
    s = run([{ type: 'setMany', ids: ['a', 'b', 'c'], additive: false }], { ...s, editingId: 'b' });
    s = run([{ type: 'prune', presentIds: new Set(['a', 'c', 'd']) }], { ...s, editingId: 'b' });
    expect(ids(s)).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('setMany is additive or replacing', () => {
    const s = run([{ type: 'click', id: 'a' }, { type: 'setMany', ids: ['b', 'c'], additive: true }]);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(ids(run([{ type: 'setMany', ids: ['z'], additive: false }], s))).toEqual(['z']);
  });

  it('actions for ids absent from the document are ignored', () => {
    const s = run([{ type: 'prune', presentIds: new Set(['a']) }, { type: 'click', id: 'ghost' },
      { type: 'toggle', id: 'ghost' }, { type: 'setMany', ids: ['ghost', 'a'], additive: false }]);
    expect(ids(s)).toEqual(['a']);
  });

  it('clear empties; edit selects the note and endEdit can keep or drop it', () => {
    const s = run([{ type: 'edit', id: 'a' }]);
    expect(ids(s)).toEqual(['a']);
    expect(s.editingId).toBe('a');
    expect(ids(run([{ type: 'endEdit', keepSelection: true }], s))).toEqual(['a']);
    expect(ids(run([{ type: 'endEdit', keepSelection: false }], s))).toEqual([]);
    expect(ids(run([{ type: 'clear' }], s))).toEqual([]);
  });

  it('no-op actions return the same state object', () => {
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });
});
