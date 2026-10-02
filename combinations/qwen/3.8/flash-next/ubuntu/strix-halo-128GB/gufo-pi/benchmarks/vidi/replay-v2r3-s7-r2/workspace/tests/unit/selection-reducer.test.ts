import { describe, it, expect } from 'vitest';
import { selectionReducer, initialSelectionState, NO_IDS } from '../../src/client/board/useSelection';
import type { SelectionState } from '../../src/client/board/useSelection';

const ids = (...list: string[]): ReadonlySet<string> => new Set(list);
const state = (list: string[], editingId: string | null = null): SelectionState => ({
  ids: list.length === 0 ? NO_IDS : ids(...list),
  editingId,
});

describe('selection reducer — TC-13', () => {
  it('a plain click replaces the selection', () => {
    let s = selectionReducer(initialSelectionState, { type: 'click', id: 'A' });
    expect([...s.ids]).toEqual(['A']);
    s = selectionReducer(s, { type: 'click', id: 'B' });
    expect([...s.ids]).toEqual(['B']);
    expect(s.editingId).toBeNull();
  });

  it('shift+click adds an object and shift+click again removes it', () => {
    let s = selectionReducer(initialSelectionState, { type: 'click', id: 'A' });
    s = selectionReducer(s, { type: 'toggle', id: 'B' });
    expect([...s.ids].sort()).toEqual(['A', 'B']);
    s = selectionReducer(s, { type: 'toggle', id: 'B' });
    expect([...s.ids]).toEqual(['A']);
  });

  it('shift+click on the only selected object empties the selection', () => {
    const s = selectionReducer(state(['A']), { type: 'toggle', id: 'A' });
    expect(s.ids.size).toBe(0);
  });

  it('shift+click on an already selected member of a group removes just it', () => {
    const s = selectionReducer(state(['A', 'B', 'C']), { type: 'toggle', id: 'B' });
    expect([...s.ids].sort()).toEqual(['A', 'C']);
  });
});

describe('selection reducer — TC-14', () => {
  it('a marquee that hits nothing leaves the selection untouched', () => {
    const before = state(['A']);
    const after = selectionReducer(before, { type: 'setMany', ids: [], additive: true });
    expect(after).toBe(before);
    expect([...after.ids]).toEqual(['A']);
  });

  it('a marquee adds to what was already selected', () => {
    const s = selectionReducer(state(['A']), { type: 'setMany', ids: ['B', 'C'], additive: true });
    expect([...s.ids].sort()).toEqual(['A', 'B', 'C']);
  });

  it('a marquee does not duplicate an object it covers twice', () => {
    const s = selectionReducer(state(['A']), { type: 'setMany', ids: ['A', 'B'], additive: true });
    expect([...s.ids].sort()).toEqual(['A', 'B']);
  });

  it('select all on an empty board selects nothing', () => {
    const before = state(['A', 'B']);
    const after = selectionReducer(before, { type: 'setMany', ids: [], additive: false });
    expect(after.ids.size).toBe(0);
    expect(after.editingId).toBeNull();
  });

  it('select all replaces the selection', () => {
    const s = selectionReducer(state(['A']), { type: 'setMany', ids: ['A', 'B', 'C'], additive: false });
    expect([...s.ids].sort()).toEqual(['A', 'B', 'C']);
  });

  it('escape clears', () => {
    const s = selectionReducer(state(['A', 'B'], 'A'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });
});

describe('selection reducer — TC-15', () => {
  it('an object deleted by a colleague leaves the selection', () => {
    const before = state(['A', 'B', 'C']);
    const after = selectionReducer(before, { type: 'prune', presentIds: ids('A', 'C') });
    expect([...after.ids].sort()).toEqual(['A', 'C']);
  });

  it('pruning keeps a selection that is fully present', () => {
    const before = state(['A', 'C']);
    const after = selectionReducer(before, { type: 'prune', presentIds: ids('A', 'C', 'D') });
    expect(after).toBe(before);
  });

  it('pruning the last object leaves nothing selected', () => {
    const after = selectionReducer(state(['B']), { type: 'prune', presentIds: ids('A') });
    expect(after.ids.size).toBe(0);
  });

  it('pruning the edited object ends editing', () => {
    const after = selectionReducer(state(['A', 'B'], 'B'), { type: 'prune', presentIds: ids('A') });
    expect([...after.ids]).toEqual(['A']);
    expect(after.editingId).toBeNull();
  });

  it('pruning keeps editing alive when the edited object stays', () => {
    const after = selectionReducer(state(['A', 'B'], 'B'), { type: 'prune', presentIds: ids('A', 'B') });
    expect(after.editingId).toBe('B');
  });
});

describe('selection reducer — text editing', () => {
  it('opening the editor selects just that object', () => {
    const s = selectionReducer(state(['A', 'B']), { type: 'edit', id: 'B' });
    expect([...s.ids]).toEqual(['B']);
    expect(s.editingId).toBe('B');
  });

  it('opening the same editor again changes nothing', () => {
    const before = state(['B'], 'B');
    expect(selectionReducer(before, { type: 'edit', id: 'B' })).toBe(before);
  });

  it('finishing editing keeps the selection, unless it should clear too', () => {
    const editing = state(['A', 'B'], 'B');
    const kept = selectionReducer(editing, { type: 'endEdit', next: 'selected' });
    expect([...kept.ids].sort()).toEqual(['A', 'B']);
    expect(kept.editingId).toBeNull();

    const cleared = selectionReducer(editing, { type: 'endEdit', next: 'unselected' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.editingId).toBeNull();
  });

  it('shift-clicking the edited object ends editing', () => {
    const s = selectionReducer(state(['A', 'B'], 'B'), { type: 'toggle', id: 'B' });
    expect([...s.ids]).toEqual(['A']);
    expect(s.editingId).toBeNull();
  });

  it('a plain click closes the editor', () => {
    const s = selectionReducer(state(['B'], 'B'), { type: 'click', id: 'A' });
    expect(s.editingId).toBeNull();
  });
});

describe('selection reducer — no-op stability', () => {
  it('returns the same state object when nothing changes', () => {
    const idle = initialSelectionState;
    expect(selectionReducer(idle, { type: 'clear' })).toBe(idle);
    expect(selectionReducer(idle, { type: 'endEdit' })).toBe(idle);
    expect(selectionReducer(idle, { type: 'prune', presentIds: ids('A') })).toBe(idle);
    expect(selectionReducer(idle, { type: 'setMany', ids: [], additive: true })).toBe(idle);

    const one = state(['A']);
    expect(selectionReducer(one, { type: 'click', id: 'A' })).toBe(one);
    expect(selectionReducer(one, { type: 'setMany', ids: ['A'], additive: false })).toBe(one);
  });
});
