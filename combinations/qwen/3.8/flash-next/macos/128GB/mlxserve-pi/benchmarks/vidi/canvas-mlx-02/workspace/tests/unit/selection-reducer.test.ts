// Story 7, sel.interaction — the pure selection reducer (TC-13 to TC-15).
// Selection is a per-client, transient Set: never written to the document.
import { describe, it, expect } from 'vitest';
import {
  selectionReducer,
  emptySelection,
  type SelectionState,
} from '../../src/client/board/useSelection.ts';

function state(...ids: string[]): SelectionState {
  return { ids: new Set(ids), editingId: null };
}

function sorted(s: SelectionState): string[] {
  return [...s.ids].sort();
}

describe('selectionReducer click / toggle (TC-13)', () => {
  // TC-13: {} -> click a -> {a} -> toggle b -> {a,b} -> click b -> {b}
  it('TC-13 click replaces, toggle adds, click replaces again', () => {
    let s = emptySelection;
    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(sorted(s)).toEqual(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(sorted(s)).toEqual(['a', 'b']);
    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(sorted(s)).toEqual(['b']);
  });

  it('shift-click of an unselected object adds it, leaving the rest selected', () => {
    let s = state('a', 'b');
    s = selectionReducer(s, { type: 'toggle', id: 'c' });
    expect(sorted(s)).toEqual(['a', 'b', 'c']);
  });

  // TC-14 (boundary): toggling the last member clears the selection.
  it('TC-14 toggling the only member empties the selection', () => {
    let s = state('a');
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(sorted(s)).toEqual([]);
    expect(s.ids.size).toBe(0);
  });

  it('editing follows the click: clicking another object ends the edit', () => {
    const editing: SelectionState = { ids: new Set(['a']), editingId: 'a' };
    const s = selectionReducer(editing, { type: 'click', id: 'b' });
    expect(s.editingId).toBeNull();
    expect(sorted(s)).toEqual(['b']);
    // clicking the edited object itself keeps editing it
    const same = selectionReducer(editing, { type: 'click', id: 'a' });
    expect(same.editingId).toBe('a');
  });

  it('toggling the edited object out of the selection ends editing it', () => {
    const editing: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    const s = selectionReducer(editing, { type: 'toggle', id: 'a' });
    expect(sorted(s)).toEqual(['b']);
    expect(s.editingId).toBeNull();
  });
});

describe('selectionReducer setMany / clear / edit', () => {
  it('setMany non-additive replaces the selection (select all)', () => {
    let s = state('x');
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b', 'c'], additive: false });
    expect(sorted(s)).toEqual(['a', 'b', 'c']);
    // an empty non-additive batch selects nothing and changes nothing (empty board)
    const after = selectionReducer(s, { type: 'setMany', ids: [], additive: false });
    expect(sorted(after)).toEqual(['a', 'b', 'c']);
  });

  it('setMany additive adds fully-inside ids, leaving the rest selected (marquee)', () => {
    let s = state('x');
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(sorted(s)).toEqual(['a', 'b', 'x']);
    // re-adding existing ids changes nothing (idempotent marquee)
    const again = selectionReducer(s, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(sorted(again)).toEqual(['a', 'b', 'x']);
  });

  it('clear empties the selection and ends editing', () => {
    const s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    const out = selectionReducer(s, { type: 'clear' });
    expect(out.ids.size).toBe(0);
    expect(out.editingId).toBeNull();
  });

  it('edit starts editing an object and makes it part of the selection', () => {
    let s = state('a');
    s = selectionReducer(s, { type: 'edit', id: 'b' });
    expect(s.editingId).toBe('b');
    expect(sorted(s)).toEqual(['b']);
    // ending the edit keeps the remaining selection
    const ended = selectionReducer(s, { type: 'edit', id: null });
    expect(ended.editingId).toBeNull();
    expect(sorted(ended)).toEqual(['b']);
  });
});

describe('selectionReducer prune (TC-15)', () => {
  // TC-15: {a,b,c} where b was deleted by someone else (present {a,c,d}).
  it('TC-15 prunes the remotely deleted id and keeps the rest selected', () => {
    let s = state('a', 'b', 'c');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(sorted(s)).toEqual(['a', 'c']);
  });

  it('pruning the edited id ends editing (the editor is gone)', () => {
    const s: SelectionState = { ids: new Set(['a', 'b']), editingId: 'b' };
    const out = selectionReducer(s, { type: 'prune', presentIds: new Set(['a']) });
    expect(sorted(out)).toEqual(['a']);
    expect(out.editingId).toBeNull();
  });

  it('pruning everything leaves the empty selection', () => {
    let s = state('a', 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set<string>() });
    expect(s.ids.size).toBe(0);
  });

  it('prune leaves an already-pruned selection unchanged (same identity)', () => {
    const s = state('a', 'b');
    const out = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) });
    expect(out).toBe(s);
  });
});
