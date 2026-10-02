import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

const empty: SelectionState = { ids: new Set(), editingId: null };

function state(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer (TC-13 to TC-15)', () => {
  it('TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
    let s = empty;

    s = selectionReducer(s, { type: 'click', id: 'a' });
    expect(s.ids).toEqual(new Set(['a']));
    expect(s.editingId).toBeNull();

    s = selectionReducer(s, { type: 'toggle', id: 'b' });
    expect(s.ids).toEqual(new Set(['a', 'b']));

    s = selectionReducer(s, { type: 'click', id: 'b' });
    expect(s.ids).toEqual(new Set(['b']));
  });

  it('TC-14: {a} → toggle a → {} (removing last member)', () => {
    let s = state(['a']);
    s = selectionReducer(s, { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('TC-15: {a,b,c} → prune present {a,c,d} → {a,c}', () => {
    let s = state(['a', 'b', 'c']);
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
  });

  it('TC-15: prune removes editingId if not present', () => {
    let s = state(['a', 'b', 'c'], 'b');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBeNull();
  });

  it('TC-15: prune keeps editingId if still present', () => {
    let s = state(['a', 'b', 'c'], 'a');
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
    expect(s.ids).toEqual(new Set(['a', 'c']));
    expect(s.editingId).toBe('a');
  });

  it('setMany non-additive replaces selection', () => {
    let s = state(['x']);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(s.ids).toEqual(new Set(['a', 'b']));
  });

  it('setMany additive adds to selection', () => {
    let s = state(['x']);
    s = selectionReducer(s, { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(s.ids).toEqual(new Set(['x', 'a', 'b']));
  });

  it('setMany additive with empty ids leaves selection unchanged', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'setMany', ids: [], additive: true });
    expect(s.ids).toEqual(new Set(['a', 'b']));
  });

  it('setMany non-additive with empty ids clears selection', () => {
    let s = state(['a', 'b']);
    s = selectionReducer(s, { type: 'setMany', ids: [], additive: false });
    expect(s.ids.size).toBe(0);
  });

  it('clear resets to empty', () => {
    let s = state(['a', 'b'], 'a');
    s = selectionReducer(s, { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it('edit sets editingId and selection to that id', () => {
    let s = state(['x']);
    s = selectionReducer(s, { type: 'edit', id: 'b' });
    expect(s.ids).toEqual(new Set(['b']));
    expect(s.editingId).toBe('b');
  });

  it('edit null ends editing', () => {
    let s = state(['a'], 'a');
    s = selectionReducer(s, { type: 'edit', id: null });
    expect(s.editingId).toBeNull();
    expect(s.ids).toEqual(new Set(['a']));
  });
});
