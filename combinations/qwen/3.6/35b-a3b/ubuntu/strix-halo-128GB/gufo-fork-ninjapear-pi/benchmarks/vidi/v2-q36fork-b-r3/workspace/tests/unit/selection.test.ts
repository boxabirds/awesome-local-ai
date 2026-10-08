import { describe, it, expect } from 'vitest';
import { selectionReducer, SelectionAction, SelectionState } from '@client/board/useSelection';

// ─── Helpers ──────────────────────────────────────────────────────

const emptyState: SelectionState = { ids: new Set(), editingId: null };

// TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
describe('TC-13: click / shift-click / setMany sequence', () => {
  it('click replaces the set', () => {
    let s = emptyState;
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });
});

// TC-14: {a} → toggle a → {} (removing last member)
describe('TC-14: toggle removes last member → Empty', () => {
  it('single-element set cleared on toggle', () => {
    let s: SelectionState = { ...emptyState };
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect([...s.ids]).toEqual([]);
  });
});

// TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editingId pruned → null
describe('TC-15: prune removes absent ids, ends editing if pruned', () => {
  it('prunes missing ids while keeping present ones', () => {
    let s: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    const present = new Set(['a', 'c', 'd']); // b was deleted remotely

    s = selectionReducer(s, { type: 'prune', presentIds: present });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull(); // editingId 'b' was pruned
  });

  it('prune keeps editingId when it survives', () => {
    let s: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'a' };
    const present = new Set(['a', 'c', 'd']);

    s = selectionReducer(s, { type: 'prune', presentIds: present });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBe('a');
  });

  it('setMany additive vs non-additive', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: null };

    // additive: adds b, c
    s = selectionReducer(s, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);

    // non-additive: replaces entirely
    s = selectionReducer(s, { type: 'setMany', ids: ['x', 'y'], additive: false });
    expect([...s.ids].sort()).toEqual(['x', 'y']);
  });
});

// ─── Additional edge cases ──────────────────────────────────────────

describe('clear action', () => {
  it('clears all ids and editingId', () => {
    let s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    s = selectionReducer(s, { type: 'clear' });
    expect([...s.ids]).toEqual([]);
    expect(s.editingId).toBeNull();
  });
});

describe('select (legacy alias for clear+click)', () => {
  it('select null clears selection', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    s = selectionReducer(s, { type: 'clear' });
    expect([...s.ids]).toEqual([]);
    expect(s.editingId).toBeNull();
  });
});

describe('edit action', () => {
  it('sets editingId', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: null };
    s = selectionReducer(s, { type: 'edit', id: 'a' });
    expect(s.editingId).toBe('a');
  });

  it('resets editingId to null', () => {
    let s: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
  });
});

describe('absent ids ignored', () => {
  it('click on non-existent id still selects it (idempotent local state)', () => {
    let s: SelectionState = emptyState;
    s = selectionReducer(s, { type: 'click', id: 'ghost-id' });
    expect([...s.ids]).toEqual(['ghost-id']);
    // pruning will remove it later
    s = selectionReducer(s, { type: 'prune', presentIds: new Set() });
    expect([...s.ids]).toEqual([]);
  });

  it('toggle on non-existent adds it then prune removes it', () => {
    let s: SelectionState = emptyState;
    s = selectionReducer(s, { type: 'toggle', id: 'phantom' });
    expect([...s.ids]).toEqual(['phantom']);
    s = selectionReducer(s, { type: 'prune', presentIds: new Set() });
    expect([...s.ids]).toEqual([]);
  });
});
