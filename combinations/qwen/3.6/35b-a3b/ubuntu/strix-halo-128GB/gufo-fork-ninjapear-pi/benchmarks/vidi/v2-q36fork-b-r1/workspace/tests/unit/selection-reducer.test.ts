/**
 * Task 9: Write selection reducer unit tests first (TC-13 to TC-15).
 */
import { describe, it, expect } from 'vitest';
import { selectionReducer } from '@/client/board/useSelection';

describe('selection reducer (sel.interaction)', () => {
  const initial = { ids: new Set() as ReadonlySet<string>, editingId: null };

  // ---- TC-13: click replaces set, toggle adds/removes ----
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let state: any = initial;
    state = selectionReducer(state, { type: 'click', id: 'a' });
    expect([...state.ids]).toEqual(['a']);

    state = selectionReducer(state, { type: 'toggle', id: 'b' });
    expect([...state.ids].sort()).toEqual(['a', 'b']);

    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect([...state.ids]).toEqual(['b']);
  });

  // ---- TC-14: removing last member → empty set ----
  it('TC-14: {a} → toggle a → {}', () => {
    let state: any = { ...initial, ids: new Set(['a']) as ReadonlySet<string> };
    state = selectionReducer(state, { type: 'toggle', id: 'a' });
    expect([...state.ids]).toEqual([]);
  });

  // ---- TC-15: prune removes absent ids and ends editing on pruned id ----
  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; editingId on b becomes null', () => {
    let state: any = {
      ids: new Set(['a', 'b', 'c']) as ReadonlySet<string>,
      editingId: 'b',
    };
    const presentIds = new Set(['a', 'c', 'd']);
    state = selectionReducer(state, { type: 'prune', presentIds });
    expect([...state.ids].sort()).toEqual(['a', 'c']);
    expect(state.editingId).toBeNull();
  });

  // ---- setMany additive vs non-additive ----
  it('setMany additive true keeps existing ids', () => {
    let state: any = selectionReducer(initial, { type: 'click', id: 'x' });
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect([...state.ids].sort()).toEqual(['a', 'b', 'x']);
  });

  it('setMany additive false replaces entirely', () => {
    let state: any = selectionReducer(initial, { type: 'click', id: 'x' });
    state = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect([...state.ids].sort()).toEqual(['a', 'b']);
  });

  // ---- actions for ids not in snapshot are ignored (no error) ----
  it('Actions referencing absent ids do not throw', () => {
    let state: any = initial;
    expect(() => selectionReducer(state, { type: 'click', id: 'ghost' })).not.toThrow();
    state = { ...state, ids: new Set(['ghost']) as ReadonlySet<string> };
    expect(() => selectionReducer(state, { type: 'toggle', id: 'also_ghost' })).not.toThrow();
  });

  // ---- clear ----
  it('clear empties selection and editing', () => {
    let state: any = { ids: new Set(['a', 'b']) as ReadonlySet<string>, editingId: 'a' };
    state = selectionReducer(state, { type: 'clear' });
    expect([...state.ids]).toEqual([]);
    expect(state.editingId).toBeNull();
  });
});
