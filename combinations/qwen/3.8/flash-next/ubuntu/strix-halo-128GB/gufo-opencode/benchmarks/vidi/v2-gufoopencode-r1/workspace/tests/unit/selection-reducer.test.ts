import { describe, expect, it } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };
const stateWith = (...ids: string[]): SelectionState => ({ ids: new Set(ids), editingId: null });

describe('selectionReducer (sel.interaction)', () => {
  it('TC-13: click replaces, toggle adds, click replaces again', () => {
    let s = selectionReducer(EMPTY, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('TC-14: toggling the only member removes it', () => {
    const s = selectionReducer(stateWith('a'), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: prune keeps present ids and ends editing of a vanished object', () => {
    const start: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    const s = selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('prune returns the same state object when nothing changed', () => {
    const start: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const s = selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'z']) });
    expect(s).toBe(start);
  });

  it('setMany additive vs replacing', () => {
    const start = stateWith('a');
    const added = selectionReducer(start, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...added.ids].sort()).toEqual(['a', 'b', 'c']);
    const replaced = selectionReducer(start, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect([...replaced.ids].sort()).toEqual(['b', 'c']);
  });

  it('clear empties the set and editing; editing ids are ignored by other actions only when absent', () => {
    const start: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    expect(selectionReducer(start, { type: 'clear' })).toEqual({ ids: new Set(), editingId: null });
    const removed = selectionReducer(start, { type: 'toggle', id: 'a' });
    expect(removed.ids.size).toBe(1);
    expect(removed.editingId).toBeNull();
    const untouched = selectionReducer(start, { type: 'toggle', id: 'ghost' });
    expect([...untouched.ids].sort()).toEqual(['a', 'b', 'ghost']);
  });

  it('edit adds a single selected object; editing null only clears editing', () => {
    const s = selectionReducer(EMPTY, { type: 'edit', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    expect(s.editingId).toBe('a');
    const kept = selectionReducer(stateWith('a', 'b'), { type: 'edit', id: null });
    expect(kept).toEqual({ ids: new Set(['a', 'b']), editingId: null });
  });
});
