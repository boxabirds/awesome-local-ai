/**
 * Story 7, sel.interaction — the pure selection reducer (TC-13 to TC-15).
 */
import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  EMPTY_SELECTION,
  type SelectionState,
} from 'src/client/board/useSelection';

function withIds(...ids: string[]): SelectionState {
  return { ids: new Set(ids), editingId: null };
}

describe('selectionReducer', () => {
  it('TC-13: click replaces the set: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = EMPTY_SELECTION;
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(new Set(s.ids).size).toBe(2);
    expect(s.ids.has('a')).toBe(true);
    expect(s.ids.has('b')).toBe(true);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('TC-14: shift-click (toggle) removing the last member → empty (boundary)', () => {
    let s = withIds('a');
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: prune keeps present ids, drops deleted ones; pruned editingId ends editing', () => {
    let s = withIds('a', 'b', 'c');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(new Set(s.ids).size).toBe(2);
    expect(s.ids.has('a')).toBe(true);
    expect(s.ids.has('c')).toBe(true);
    expect(s.ids.has('b')).toBe(false);

    // Editing a note that is deleted remotely ends editing.
    const editing: SelectionState = { ids: new Set(['a', 'b']), editingId: 'b' };
    const after = selectionReducer(editing, { type: 'prune', presentIds: new Set(['a']) });
    expect([...after.ids]).toEqual(['a']);
    expect(after.editingId).toBeNull();

    // Editing a note that is still present keeps editing.
    const kept = selectionReducer(editing, { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(kept.editingId).toBe('b');
  });

  it('setMany: additive unions with the current selection, non-additive replaces it', () => {
    const s = withIds('a');
    const added = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(new Set(added.ids).size).toBe(3);
    expect(added.ids.has('a')).toBe(true);

    const replaced = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect([...replaced.ids].sort()).toEqual(['b', 'c']);

    // Additive with an empty result leaves the selection unchanged.
    const none = selectionReducer(s, { type: 'setMany', ids: [], additive: true });
    expect([...none.ids]).toEqual(['a']);
  });

  it('clear empties the selection and ends editing', () => {
    const s = { ids: new Set(['a', 'b']), editingId: 'a' };
    const cleared = selectionReducer(s, { type: 'clear' });
    expect(cleared.ids.size).toBe(0);
    expect(cleared.editingId).toBeNull();
  });

  it('edit: starts editing exactly one object; null ends editing without touching ids', () => {
    const started = selectionReducer(EMPTY_SELECTION, { type: 'edit', id: 'a' });
    expect([...started.ids]).toEqual(['a']);
    expect(started.editingId).toBe('a');

    const ended = selectionReducer(started, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect([...ended.ids]).toEqual(['a']);
  });

  it('click ends editing of a previous note', () => {
    const s = { ids: new Set(['b']), editingId: 'b' };
    const after = selectionReducer(s, { type: 'click', id: 'a' });
    expect(after.editingId).toBeNull();
    expect([...after.ids]).toEqual(['a']);
  });
});
