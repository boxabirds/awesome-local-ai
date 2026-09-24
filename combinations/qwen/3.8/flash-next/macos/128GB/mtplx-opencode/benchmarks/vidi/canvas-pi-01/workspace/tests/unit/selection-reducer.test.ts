/**
 * Story 7 · task 9 — selection reducer unit tests (TC-13 … TC-15 + the
 * setMany / edit / prune rules). Pure, no DOM: the reducer is the single place
 * every selection change funnels through.
 */
import { describe, expect, it } from 'vitest';
import {
  emptySelection,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/selectionReducer';

function sel(ids: Iterable<string>, editingId: string | null = null): SelectionState {
  return { selectedIds: new Set(ids), editingId };
}

describe('click / toggle (TC-13, TC-14)', () => {
  it('TC-13: {} -> click a -> {a}; toggle b -> {a,b}; click b -> {b}', () => {
    let s = emptySelection();
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect([...s.selectedIds]).toEqual(['a']);

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect([...s.selectedIds].sort()).toEqual(['a', 'b']);

    // A plain click always replaces the whole set with just the clicked id.
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect([...s.selectedIds]).toEqual(['b']);
  });

  it('TC-14: removing the last member lands back on the Empty state', () => {
    let s = sel(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.selectedIds.size).toBe(0);
    expect(s.editingId).toBeNull();
  });
});

describe('prune (TC-15)', () => {
  it('TC-15: {a,b,c} with present {a,c,d} -> {a,c}', () => {
    const s = sel(['a', 'b', 'c']);
    const next = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect([...next.selectedIds].sort()).toEqual(['a', 'c']);
  });

  it('pruning the edited id ends editing', () => {
    const s = sel(['a', 'b'], 'b');
    const next = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c']) });
    expect([...next.selectedIds]).toEqual(['a']);
    expect(next.editingId).toBeNull();
  });

  it('TC-33 boundary: pruning every member gives an empty selection', () => {
    const s = sel(['a', 'b']);
    const next = selectionReducer(s, { type: 'prune', presentIds: new Set(['z']) });
    expect(next.selectedIds.size).toBe(0);
  });

  it('an unchanged prune is identity (same object, so React can skip)', () => {
    const s = sel(['a', 'b']);
    expect(selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'b']) })).toBe(s);
  });
});

describe('setMany (additive vs replace)', () => {
  it('additive marquee adds to the existing selection', () => {
    const s = sel(['x']);
    const next = selectionReducer(s, { type: 'setMany', ids: ['y', 'z'], additive: true });
    expect([...next.selectedIds].sort()).toEqual(['x', 'y', 'z']);
  });

  it('an empty additive marquee leaves the selection untouched (TC-20 error path)', () => {
    const s = sel(['x']);
    expect(selectionReducer(s, { type: 'setMany', ids: [], additive: true })).toBe(s);
  });

  it('a non-additive setMany replaces (Ctrl+A); empty clears', () => {
    const s = sel(['x']);
    expect([...selectionReducer(s, { type: 'setMany', ids: ['y'], additive: false }).selectedIds]).toEqual([
      'y',
    ]);
    expect(selectionReducer(s, { type: 'setMany', ids: [], additive: false }).selectedIds.size).toBe(0);
  });
});

describe('clear / edit', () => {
  it('clear empties both the set and the editor', () => {
    const s = sel(['a', 'b'], 'a');
    const next = selectionReducer(s, { type: 'clear' });
    expect(next.selectedIds.size).toBe(0);
    expect(next.editingId).toBeNull();
  });

  it('edit selects the edited object and opens its editor', () => {
    const next = selectionReducer(emptySelection(), { type: 'edit', id: 'a' });
    expect([...next.selectedIds]).toEqual(['a']);
    expect(next.editingId).toBe('a');
  });

  it('edit(null) just closes the editor', () => {
    const s = sel(['a'], 'a');
    const next = selectionReducer(s, { type: 'edit', id: null });
    expect([...next.selectedIds]).toEqual(['a']);
    expect(next.editingId).toBeNull();
  });
});
