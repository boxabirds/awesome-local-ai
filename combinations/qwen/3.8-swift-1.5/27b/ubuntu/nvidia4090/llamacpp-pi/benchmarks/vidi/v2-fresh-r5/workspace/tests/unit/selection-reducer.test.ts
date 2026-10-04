import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

// ─── TC-13: click / toggle sequence ─────────────────────────────────────────
describe('TC-13: click and toggle', () => {
  it('{} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let state: SelectionState = { ids: new Set(), editingId: null };

    // Click a
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect(state.ids).toEqual(new Set(['a']));

    // Toggle b (add)
    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect(state.ids).toEqual(new Set(['a', 'b']));

    // Click b (replaces set)
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });
});

// ─── TC-14: removing last member ───────────────────────────────────────────
describe('TC-14: toggle removes last member', () => {
  it('{a} → toggle a → {}', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect(state.ids).toEqual(new Set());
  });
});

// ─── TC-15: prune ──────────────────────────────────────────────────────────
describe('TC-15: prune', () => {
  it('{a,b,c} → prune present {a,c,d} → {a,c}', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
  });

  it('if editingId was pruned, editingId becomes null', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(state.ids).toEqual(new Set(['a', 'c']));
    expect(state.editingId).toBeNull();
  });
});

// ─── setMany additive vs non-additive ──────────────────────────────────────
describe('setMany', () => {
  it('non-additive replaces the set', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: false });
    expect(state.ids).toEqual(new Set(['b', 'c']));
  });

  it('additive adds to the set', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect(state.ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('empty ids with additive=true leaves selection unchanged', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'setMany', ids: [], additive: true });
    expect(state.ids).toEqual(new Set(['a']));
  });
});

// ─── clear ─────────────────────────────────────────────────────────────────
describe('clear', () => {
  it('clears selection and editing', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    state = selectionReducer(state, { type: 'clear' });
    expect(state.ids).toEqual(new Set());
    expect(state.editingId).toBeNull();
  });
});

// ─── edit ──────────────────────────────────────────────────────────────────
describe('edit', () => {
  it('startEdit sets editingId', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'edit', id: 'a' });
    expect(state.editingId).toBe('a');
  });

  it('endEdit (id: null) clears editingId', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    state = selectionReducer(state, { type: 'edit', id: null });
    expect(state.editingId).toBeNull();
    // Selection is preserved
    expect(state.ids).toEqual(new Set(['a']));
  });
});
