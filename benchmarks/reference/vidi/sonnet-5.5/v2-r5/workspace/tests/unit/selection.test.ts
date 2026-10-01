import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const set = (...ids: string[]) => new Set(ids);
const run = (s: SelectionState, ...actions: Parameters<typeof selectionReducer>[1][]) =>
  actions.reduce(selectionReducer, s);

describe('selectionReducer (sel.interaction)', () => {
  it('TC-13 click replaces, toggle adds', () => {
    let s = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(s.ids).toEqual(set('a'));
    s = run(s, { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(set('a', 'b'));
    s = run(s, { type: 'click', id: 'b' });
    expect(s.ids).toEqual(set('b'));
  });

  it('TC-14 removing the last member empties the selection', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' }, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15 prune drops absent ids and ends editing of a pruned id', () => {
    let s = run(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    s = run(s, { type: 'prune', presentIds: set('a', 'c', 'd') });
    expect(s.ids).toEqual(set('a', 'c'));
    const editing = run(EMPTY_SELECTION, { type: 'edit', id: 'b' });
    expect(editing.editingId).toBe('b');
    const pruned = run(editing, { type: 'prune', presentIds: set('a') });
    expect(pruned.editingId).toBeNull();
    expect(pruned.ids.size).toBe(0);
  });

  it('prune with everything present returns the same state', () => {
    const s = run(EMPTY_SELECTION, { type: 'setMany', ids: ['a'], additive: false });
    expect(selectionReducer(s, { type: 'prune', presentIds: set('a', 'b') })).toBe(s);
  });

  it('setMany additive keeps the old members, non-additive replaces them', () => {
    const s = run(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(run(s, { type: 'setMany', ids: ['b', 'c'], additive: true }).ids).toEqual(set('a', 'b', 'c'));
    expect(run(s, { type: 'setMany', ids: ['b', 'c'], additive: false }).ids).toEqual(set('b', 'c'));
    expect(run(s, { type: 'setMany', ids: [], additive: false }).ids.size).toBe(0);
  });

  it('clear empties; toggling a second object ends editing; edit null keeps the selection', () => {
    const editing = run(EMPTY_SELECTION, { type: 'edit', id: 'a' });
    expect(run(editing, { type: 'toggle', id: 'b' }).editingId).toBeNull();
    const done = run(editing, { type: 'edit', id: null });
    expect(done.ids).toEqual(set('a'));
    expect(done.editingId).toBeNull();
    expect(run(done, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });
});
