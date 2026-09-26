import { describe, it, expect } from 'vitest';
import { selectionReducer, EMPTY_SELECTION, type SelectionState } from '../../src/client/board/useSelection';

const state = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});
const idsOf = (s: SelectionState) => Array.from(s.ids).sort();

describe('selectionReducer', () => {
  it('TC-13: click replaces the selection', () => {
    let s = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect(idsOf(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
  });

  it('TC-13: click clears editing unless it targets the editing id', () => {
    const s = selectionReducer(state(['a', 'b'], 'b'), { type: 'click', id: 'b' });
    expect(s.editingId).toBe('b');
    const s2 = selectionReducer(state(['a', 'b'], 'b'), { type: 'click', id: 'a' });
    expect(s2.editingId).toBeNull();
  });

  it('TC-14: toggle adds and removes; removing the last id empties', () => {
    let s = selectionReducer(state(['a']), { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(idsOf(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('toggle drops editing when the editing id leaves', () => {
    const s = selectionReducer(state(['a', 'b'], 'b'), { type: 'toggle', id: 'b' });
    expect(s.editingId).toBeNull();
  });

  it('TC-14: setMany non-additive replaces; additive unions', () => {
    let s = selectionReducer(state(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(idsOf(s)).toEqual(['b', 'c']);
    s = selectionReducer(s, { type: 'setMany', ids: ['d'], additive: true });
    expect(idsOf(s)).toEqual(['b', 'c', 'd']);
  });

  it('TC-15: prune removes absent ids and clears stale editing', () => {
    const present = new Set(['a', 'c', 'd']);
    const s = selectionReducer(state(['a', 'b'], 'b'), { type: 'prune', presentIds: present });
    expect(idsOf(s)).toEqual(['a']);
    expect(s.editingId).toBeNull();
  });

  it('prune returns the identical state when nothing is stale', () => {
    const input = state(['a', 'b'], 'a');
    const out = selectionReducer(input, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) });
    expect(out).toBe(input);
  });

  it('clear empties and is idempotent', () => {
    const s = selectionReducer(state(['a'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
    expect(selectionReducer(s, { type: 'clear' })).toBe(s);
  });

  it('edit selects + edits one id; edit null ends editing, keeps selection', () => {
    const s = selectionReducer(state(['a', 'b'], null), { type: 'edit', id: 'b' });
    expect(idsOf(s)).toEqual(['b']);
    expect(s.editingId).toBe('b');
    const e = selectionReducer(s, { type: 'edit', id: null });
    expect(e.editingId).toBeNull();
    expect(idsOf(e)).toEqual(['b']);
  });
});
