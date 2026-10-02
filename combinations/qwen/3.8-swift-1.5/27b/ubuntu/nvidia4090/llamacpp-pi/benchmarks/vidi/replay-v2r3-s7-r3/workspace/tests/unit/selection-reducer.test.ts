import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const s = (ids: string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

/**
 * Story 7 (sel.state): the pure selection reducer. TC-13 to TC-15.
 */
describe('selection reducer (sel.state)', () => {
  // TC-13
  it('TC-13: click a → {a}; click b → {b}; shift+click a → {a, b}; click c → {c}', () => {
    let st = s([]);
    st = selectionReducer(st, { type: 'click', id: 'a' });
    expect([...st.ids]).toEqual(['a']);
    st = selectionReducer(st, { type: 'click', id: 'b' });
    expect([...st.ids].sort()).toEqual(['b']);
    expect(st.ids.has('b')).toBe(true);
    st = selectionReducer(st, { type: 'toggle', id: 'a' }); // shift+click a
    expect([...st.ids].sort()).toEqual(['a', 'b']);
    st = selectionReducer(st, { type: 'click', id: 'c' });
    expect([...st.ids]).toEqual(['c']);
  });

  // TC-14
  it('TC-14: shift+click the only selected object → selection becomes empty', () => {
    let st = s(['a']);
    st = selectionReducer(st, { type: 'toggle', id: 'a' });
    expect(st.ids.size).toBe(0);
  });

  // TC-15
  it('TC-15: prune with present {a, c, d} → {a, c}; editingId b → null', () => {
    let st = s(['a', 'b', 'c'], 'b');
    st = selectionReducer(st, {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect([...st.ids].sort()).toEqual(['a', 'c']);
    expect(st.editingId).toBeNull();
  });

  it('prune is a no-op (same state reference) when nothing is missing', () => {
    const st = s(['a', 'b'], 'a');
    const next = selectionReducer(st, { type: 'prune', presentIds: new Set(['a', 'b', 'z']) });
    expect(next).toBe(st);
  });

  it('prune keeps editingId when the edited object is still present', () => {
    const st = s(['a', 'b'], 'a');
    const next = selectionReducer(st, { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(next).toBe(st);
  });

  it('setMany replaces the selection (additive=false) or unions it (additive=true)', () => {
    let st = s(['a']);
    st = selectionReducer(st, { type: 'setMany', ids: ['x', 'y'], additive: false });
    expect([...st.ids].sort()).toEqual(['x', 'y']);
    st = selectionReducer(st, { type: 'setMany', ids: ['y', 'z'], additive: true });
    expect([...st.ids].sort()).toEqual(['x', 'y', 'z']);
    // Duplicate ids are not counted twice.
    st = selectionReducer(st, { type: 'setMany', ids: ['x'], additive: true });
    expect(st.ids.size).toBe(3);
  });

  it('clear empties the selection and ends editing', () => {
    const st = s(['a', 'b'], 'a');
    const next = selectionReducer(st, { type: 'clear' });
    expect(next.ids.size).toBe(0);
    expect(next.editingId).toBeNull();
  });

  it('clicking an already-selected object keeps the selection (no-op reference)', () => {
    const st = s(['a']);
    expect(selectionReducer(st, { type: 'click', id: 'a' })).toBe(st);
  });

  it('startEdit sets editingId only when the object is selected', () => {
    let st = s(['a', 'b']);
    st = selectionReducer(st, { type: 'edit', id: 'b' });
    expect(st.editingId).toBe('b');
    // Starting to edit an unselected object is ignored.
    expect(selectionReducer(st, { type: 'edit', id: 'zzz' })).toBe(st);
  });

  it('endEdit clears editingId only', () => {
    const st = s(['a', 'b'], 'a');
    const next = selectionReducer(st, { type: 'endEdit' });
    expect(next.ids.size).toBe(2);
    expect(next.editingId).toBeNull();
  });

  it('toggling an already-selected object removes it; toggling an unselected adds it', () => {
    let st = s(['a', 'b']);
    st = selectionReducer(st, { type: 'toggle', id: 'b' });
    expect([...st.ids]).toEqual(['a']);
    st = selectionReducer(st, { type: 'toggle', id: 'c' });
    expect([...st.ids].sort()).toEqual(['a', 'c']);
  });
});
