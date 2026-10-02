import { describe, it, expect } from 'vitest';
import { selectionReducer, type MultiSelectionState } from '../../src/client/board/useSelection';

const empty: MultiSelectionState = { ids: new Set<string>(), editingId: null };

const withIds = (ids: string[], editingId: string | null = null): MultiSelectionState => ({
  ids: new Set(ids),
  editingId,
});

describe('sel.interaction (selectionReducer)', () => {
  // TC-13
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b} (click replaces the set)', () => {
    let s = selectionReducer(empty, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    expect(s.editingId).toBeNull();

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  // TC-14
  it('TC-14: {a} → toggle a → {} (removing the last member, boundary)', () => {
    const s = selectionReducer(withIds(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('toggle on a non-selected id adds it, leaving the others unchanged', () => {
    const s = selectionReducer(withIds(['a', 'c']), { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  // TC-15
  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}', () => {
    const s = selectionReducer(withIds(['a', 'b', 'c']), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  it('TC-15: pruning the edited id ends editing', () => {
    const s = selectionReducer(withIds(['a', 'b', 'c'], 'b'), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect(s.editingId).toBeNull();
    expect([...s.ids].sort()).toEqual(['a', 'c']);
  });

  it('prune keeps the edited id when it still exists', () => {
    const s = selectionReducer(withIds(['a', 'b'], 'a'), {
      type: 'prune',
      presentIds: new Set(['a', 'x']),
    });
    expect(s.editingId).toBe('a');
    expect([...s.ids]).toEqual(['a']);
  });

  it('setMany additive keeps the previous ids; non-additive replaces', () => {
    const additive = selectionReducer(withIds(['x']), {
      type: 'setMany',
      ids: ['a', 'b'],
      additive: true,
    });
    expect([...additive.ids].sort()).toEqual(['a', 'b', 'x']);

    const replace = selectionReducer(withIds(['x']), {
      type: 'setMany',
      ids: ['a', 'b'],
      additive: false,
    });
    expect([...replace.ids].sort()).toEqual(['a', 'b']);
  });

  it('setMany with an empty list leaves an additive selection unchanged and empties a non-additive one', () => {
    const additive = selectionReducer(withIds(['x']), { type: 'setMany', ids: [], additive: true });
    expect([...additive.ids]).toEqual(['x']);
    const replace = selectionReducer(withIds(['x']), { type: 'setMany', ids: [], additive: false });
    expect(replace.ids.size).toBe(0);
  });

  it('clear empties the selection and ends editing', () => {
    const s = selectionReducer(withIds(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit sets the editing id; editing an unselected id selects it', () => {
    const s = selectionReducer(withIds(['a']), { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
    expect([...s.ids]).toEqual(['a']);
    const added = selectionReducer(withIds(['a']), { type: 'edit', id: 'b' });
    expect(added.editingId).toBe('b');
    expect([...added.ids].sort()).toEqual(['a', 'b']);
    const ended = selectionReducer(s, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect([...ended.ids]).toEqual(['a']);
  });

  it('click ends editing of a different object', () => {
    const s = selectionReducer(withIds(['a'], 'a'), { type: 'click', id: 'b' });
    expect(s.editingId).toBeNull();
    expect([...s.ids]).toEqual(['b']);
  });
});
