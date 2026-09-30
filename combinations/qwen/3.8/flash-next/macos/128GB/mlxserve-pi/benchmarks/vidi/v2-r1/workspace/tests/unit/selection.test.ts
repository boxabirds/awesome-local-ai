/**
 * Selection state as a pure reducer (`sel.interaction`, TC-13 to TC-15).
 *
 * The state is a set of ids, so a click, a shift-click and a marquee are three
 * ways of writing the same state; the reducer is where their rules live. Keeping
 * it pure is what lets the remote-delete case (TC-15) be tested without a screen.
 */
import { describe, expect, it } from 'vitest';
import {
  emptySelection,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

const selected = (...ids: string[]): SelectionState => ({
  ids: new Set(ids),
  editingId: null,
});
const editing = (ids: string[], editingId: string): SelectionState => ({
  ids: new Set(ids),
  editingId,
});
const idsOf = (state: SelectionState): string[] => [...state.ids].sort();

describe('selection reducer (sel.interaction)', () => {
  // TC-13: {} -> {a} -> {a,b} -> {b}.
  it('TC-13 goes from nothing to one, to two, to one alone', () => {
    const a = selectionReducer(emptySelection, { type: 'click', id: 'a' });
    expect(idsOf(a)).toEqual(['a']);
    const ab = selectionReducer(a, { type: 'toggle', id: 'b' });
    expect(idsOf(ab)).toEqual(['a', 'b']);
    const b = selectionReducer(ab, { type: 'click', id: 'b' });
    expect(idsOf(b)).toEqual(['b']);
  });

  it('a click replaces the whole selection and ends editing', () => {
    const start = editing(['a', 'b'], 'a');
    const next = selectionReducer(start, { type: 'click', id: 'c' });
    expect(idsOf(next)).toEqual(['c']);
    expect(next.editingId).toBeNull();
  });

  it('clicking the only selected object again leaves it selected', () => {
    const start = selected('a');
    const next = selectionReducer(start, { type: 'click', id: 'a' });
    expect(idsOf(next)).toEqual(['a']);
  });

  // TC-14: removing the last member of the selection lands back on Empty.
  it('TC-14 shift-clicking the only member empties the selection', () => {
    const next = selectionReducer(selected('a'), { type: 'toggle', id: 'a' });
    expect(next.ids.size).toBe(0);
    expect(next).toBe(emptySelection);
  });

  it('toggle adds a member and removes it again', () => {
    const withB = selectionReducer(selected('a'), { type: 'toggle', id: 'b' });
    expect(idsOf(withB)).toEqual(['a', 'b']);
    expect(idsOf(selectionReducer(withB, { type: 'toggle', id: 'b' }))).toEqual(['a']);
  });

  it('setMany replaces the selection unless it is additive (a marquee)', () => {
    const start = selected('a');
    expect(idsOf(selectionReducer(start, { type: 'setMany', ids: ['b', 'c'], additive: false }))).toEqual([
      'b', 'c',
    ]);
    expect(
      idsOf(selectionReducer(start, { type: 'setMany', ids: ['b', 'c'], additive: true })),
    ).toEqual(['a', 'b', 'c']);
  });

  it('an additive marquee that caught nothing leaves the selection alone', () => {
    const start = selected('a');
    const next = selectionReducer(start, { type: 'setMany', ids: [], additive: true });
    expect(next).toBe(start);
  });

  it('setMany of nothing with no additive clears, and clear empties', () => {
    expect(selectionReducer(selected('a', 'b'), { type: 'setMany', ids: [], additive: false }).ids.size).toBe(0);
    expect(selectionReducer(selected('a'), { type: 'clear' })).toBe(emptySelection);
  });

  // TC-15: a remote delete takes its id out of the selection.
  it('TC-15 prune drops the ids that are no longer there and keeps the rest', () => {
    const start = selected('a', 'b', 'c');
    const next = selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(idsOf(next)).toEqual(['a', 'c']);
  });

  it('prune ends editing when the note being edited is gone', () => {
    const start = editing(['a', 'b'], 'b');
    const next = selectionReducer(start, { type: 'prune', presentIds: new Set(['a']) });
    expect(idsOf(next)).toEqual(['a']);
    expect(next.editingId).toBeNull();
  });

  it('prune keeps editing when the note being edited is still there', () => {
    const start = editing(['a', 'b'], 'b');
    const next = selectionReducer(start, { type: 'prune', presentIds: new Set(['a', 'b']) });
    expect(next.editingId).toBe('b');
    expect(next).toBe(start); // nothing changed: same state, no re-render
  });

  // TC-16 boundary: everything selected is deleted remotely.
  it('prune of everything is Empty, which is what hides the bar', () => {
    const next = selectionReducer(selected('a', 'b'), { type: 'prune', presentIds: new Set() });
    expect(next).toBe(emptySelection);
  });

  it('edit opens a text editor and closes it without touching the selection', () => {
    const start = selected('a', 'b');
    const open = selectionReducer(start, { type: 'edit', id: 'b' });
    expect(open.editingId).toBe('b');
    expect(idsOf(open)).toEqual(['a', 'b']);
    expect(selectionReducer(open, { type: 'edit', id: null })).toEqual(start);
  });

  it('an action that changes nothing returns the same state object', () => {
    const start = selected('a');
    expect(selectionReducer(start, { type: 'click', id: 'a' })).toBe(start);
    expect(selectionReducer(emptySelection, { type: 'clear' })).toBe(emptySelection);
    expect(selectionReducer(emptySelection, { type: 'prune', presentIds: new Set(['a']) })).toBe(
      emptySelection,
    );
  });
});
