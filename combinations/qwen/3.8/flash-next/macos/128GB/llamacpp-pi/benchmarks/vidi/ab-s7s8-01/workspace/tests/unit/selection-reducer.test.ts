// Story 7 — the pure selection state machine (sel.interaction).
// TC-13 to TC-15 plus the boundaries: removing the last member, select-all on an
// empty board, prune that empties the selection, and "no change → same object".

import { describe, it, expect } from 'vitest';
import { selectionReducer, EMPTY_SELECTION, type SelectionState } from '../../src/client/board/useSelection';

const sel = (...ids: string[]): SelectionState => ({ ids: new Set(ids), editingId: null });

function ids(state: SelectionState): string[] {
  return [...state.ids].sort();
}

describe('click / toggle (TC-13)', () => {
  it('click selects exactly one object, replacing whatever was selected', () => {
    const a = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(a.ids).toEqual(new Set(['a']));
    const ab = selectionReducer(a, { type: 'toggle', id: 'b' });
    expect(ids(ab)).toEqual(['a', 'b']);
    const onlyB = selectionReducer(ab, { type: 'click', id: 'b' });
    expect(onlyB.ids).toEqual(new Set(['b']));
  });

  it('Shift-click adds a new object and removes it again, leaving the others alone', () => {
    const two = selectionReducer(sel('a'), { type: 'toggle', id: 'b' });
    expect(ids(two)).toEqual(['a', 'b']);
    const three = selectionReducer(two, { type: 'toggle', id: 'c' });
    expect(ids(three)).toEqual(['a', 'b', 'c']);
    const dropped = selectionReducer(three, { type: 'toggle', id: 'b' });
    expect(ids(dropped)).toEqual(['a', 'c']);
  });

  it('TC-14 toggling the LAST member off gives Empty', () => {
    const out = selectionReducer(sel('a'), { type: 'toggle', id: 'a' });
    expect(out.ids.size).toBe(0);
    expect(out.editingId).toBeNull();
  });

  it('clicking the only selected object again keeps it selected (a click never toggles off)', () => {
    const out = selectionReducer(sel('a'), { type: 'click', id: 'a' });
    expect(out.ids).toEqual(new Set(['a']));
  });

  it('a no-op click returns the SAME state object (no re-render, no re-announce)', () => {
    const before = sel('a');
    expect(selectionReducer(before, { type: 'click', id: 'a' })).toBe(before);
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION);
  });

  it('a click ends text editing', () => {
    const editing: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const out = selectionReducer(editing, { type: 'click', id: 'b' });
    expect(out.editingId).toBeNull();
    expect(out.ids).toEqual(new Set(['b']));
  });
});

describe('setMany (marquee + select all)', () => {
  it('additive unions the ids into the existing selection', () => {
    const out = selectionReducer(sel('x'), { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(ids(out)).toEqual(['a', 'b', 'x']);
  });

  it('non-additive replaces the selection', () => {
    const out = selectionReducer(sel('x', 'y'), { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(ids(out)).toEqual(['a', 'b']);
  });

  it('TC-28 boundary: select-all on an empty board gives an empty selection, no error', () => {
    const out = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: [], additive: false });
    expect(out.ids.size).toBe(0);
    expect(out.editingId).toBeNull();
  });

  it('an empty additive marquee leaves the selection unchanged (same object)', () => {
    const before = sel('x');
    const out = selectionReducer(before, { type: 'setMany', ids: [], additive: true });
    expect(out).toBe(before);
  });

  it('replacing the selection with the same set is a no-op', () => {
    const before = sel('a', 'b');
    expect(selectionReducer(before, { type: 'setMany', ids: ['b', 'a'], additive: false })).toBe(before);
  });

  it('leaving the edited object behind ends its editing', () => {
    const editing: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const out = selectionReducer(editing, { type: 'setMany', ids: ['b'], additive: false });
    expect(out.editingId).toBeNull();
  });
});

describe('prune (remote deletes)', () => {
  it('TC-15 {a,b,c} with b deleted remotely → {a,c}', () => {
    const out = selectionReducer(sel('a', 'b', 'c'), { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(ids(out)).toEqual(['a', 'c']);
  });

  it('editing a pruned object ends editing (TC-15 error path)', () => {
    const editing: SelectionState = { ids: new Set(['a', 'b']), editingId: 'b' };
    const out = selectionReducer(editing, { type: 'prune', presentIds: new Set(['a']) });
    expect(out.ids).toEqual(new Set(['a']));
    expect(out.editingId).toBeNull();
  });

  it('when every selected object is deleted the selection is Empty and the bar hides', () => {
    const out = selectionReducer(sel('a', 'b'), { type: 'prune', presentIds: new Set(['z']) });
    expect(out.ids.size).toBe(0);
    expect(out.editingId).toBeNull();
  });

  it('an unrelated document change leaves the selection identical (same object)', () => {
    const before = sel('a');
    expect(selectionReducer(before, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) })).toBe(before);
  });
});

describe('edit', () => {
  it('edit(id) selects only that object and marks it editing', () => {
    const out = selectionReducer(sel('a', 'b'), { type: 'edit', id: 'c' });
    expect(out.ids).toEqual(new Set(['c']));
    expect(out.editingId).toBe('c');
  });

  it('edit(null) stops editing but keeps the selection (Escape while typing)', () => {
    const editing: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const out = selectionReducer(editing, { type: 'edit', id: null });
    expect(out.editingId).toBeNull();
    expect(out.ids).toEqual(new Set(['a']));
  });
});
