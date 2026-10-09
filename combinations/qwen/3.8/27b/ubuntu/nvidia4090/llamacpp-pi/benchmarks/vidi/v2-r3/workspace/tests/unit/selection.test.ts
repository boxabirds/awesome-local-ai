/**
 * TC-13 to TC-15: the pure selection reducer (sel.interaction).
 */
import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const state = (ids: string[], present: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
  presentIds: new Set(present),
});
const idsOf = (s: SelectionState): string[] => [...s.ids].sort();

describe('selectionReducer (TC-13: click and shift-click)', () => {
  it('click selects exactly one object', () => {
    let s = state([], ['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(idsOf(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
  });

  it('click on an unknown id is a no-op', () => {
    const s = selectionReducer(state(['a'], ['a', 'b']), { type: 'click', id: 'ghost' });
    expect(idsOf(s)).toEqual(['a']);
  });

  it('shift-click toggles: adds then removes', () => {
    let s = state(['a'], ['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'ghost' });
    expect(idsOf(s)).toEqual(['a']);
  });
});

describe('selectionReducer (TC-14: marquee setMany and select-all)', () => {
  it('setMany replaces the selection', () => {
    const s = selectionReducer(state(['x'], ['a', 'b', 'c']), { type: 'setMany', ids: ['a', 'c'], additive: false });
    expect(idsOf(s)).toEqual(['a', 'c']);
  });

  it('setMany additive unions with the current selection', () => {
    const s = selectionReducer(state(['a'], ['a', 'b', 'c']), { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(idsOf(s)).toEqual(['a', 'b', 'c']);
  });

  it('unknown ids in setMany are skipped', () => {
    const s = selectionReducer(state(['x'], ['a', 'b']), { type: 'setMany', ids: ['a', 'ghost'], additive: false });
    expect(idsOf(s)).toEqual(['a']);
  });

  it('an empty replacement clears the selection and ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], ['a', 'b'], 'a'), { type: 'setMany', ids: [], additive: false });
    expect(idsOf(s)).toEqual([]);
    expect(s.editingId).toBeNull();
  });

  it('an empty additive setMany changes nothing', () => {
    const s = selectionReducer(state(['a'], ['a']), { type: 'setMany', ids: [], additive: true });
    expect(idsOf(s)).toEqual(['a']);
  });
});

describe('selectionReducer (TC-15: prune on remote deletion)', () => {
  it('removes deleted ids from the selection', () => {
    const s = selectionReducer(state(['a', 'b', 'c'], ['a', 'b', 'c']), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect(idsOf(s)).toEqual(['a', 'c']);
  });

  it('drops editingId when the edited object is gone', () => {
    const s = selectionReducer(state(['a', 'b'], ['a', 'b'], 'b'), {
      type: 'prune',
      presentIds: new Set(['a', 'c']),
    });
    expect(s.editingId).toBeNull();
  });

  it('keeps editingId when the edited object survives', () => {
    const s = selectionReducer(state(['a', 'b'], ['a', 'b'], 'a'), {
      type: 'prune',
      presentIds: new Set(['a', 'b']),
    });
    expect(s.editingId).toBe('a');
  });
});

describe('selectionReducer (editing transitions)', () => {
  it('click while editing ends editing and re-selects', () => {
    const s = selectionReducer(state(['a'], ['a', 'b'], 'a'), { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
    expect(s.editingId).toBeNull();
  });

  it('edit implies the selection of the edited object', () => {
    const s = selectionReducer(state(['a'], ['a', 'b']), { type: 'edit', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
    expect(s.editingId).toBe('b');
  });

  it('edit on an unknown id is a no-op; endEdit keeps the selection', () => {
    let s = selectionReducer(state(['a', 'b'], ['a']), { type: 'edit', id: 'ghost' });
    expect(idsOf(s)).toEqual(['a', 'b']);
    expect(s.editingId).toBeNull();
    s = selectionReducer(state(['a', 'b'], ['a', 'b'], 'a'), { type: 'edit', id: null });
    expect(idsOf(s)).toEqual(['a', 'b']);
    expect(s.editingId).toBeNull();
  });

  it('clear empties the selection and ends editing', () => {
    const s = selectionReducer(state(['a', 'b'], ['a', 'b'], 'b'), { type: 'clear' });
    expect(idsOf(s)).toEqual([]);
    expect(s.editingId).toBeNull();
  });
});
