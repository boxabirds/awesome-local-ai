import { describe, it, expect } from 'vitest';
import {
  initialSelectionState,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

/**
 * Story 7 (sel.multi, sel.edit_enter): pure selection reducer.
 * TC-13, TC-14, TC-15 plus the setMany / editing transitions.
 */
describe('selection reducer (pure)', () => {
  const st = (ids: string[] = [], editingId: string | null = null): SelectionState => ({
    ids: new Set(ids),
    editingId,
  });

  const act = (state: SelectionState, action: SelectionAction): SelectionState =>
    selectionReducer(state, action);

  // TC-13
  it('TC-13: click → single; shift+click adds; normal click on a member → single', () => {
    let s = initialSelectionState();
    s = act(s, { type: 'click', id: 'a' });
    expect([...s.ids]).toEqual(['a']);
    expect(s.editingId).toBeNull();

    s = act(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);

    s = act(s, { type: 'click', id: 'b' });
    expect([...s.ids]).toEqual(['b']);
  });

  it('click replaces a multi-selection with the single clicked object', () => {
    let s = st(['a', 'b', 'c']);
    s = act(s, { type: 'click', id: 'd' });
    expect([...s.ids]).toEqual(['d']);
  });

  // TC-14
  it('TC-14: shift+click on the only selected object → empty', () => {
    const s = act(st(['a']), { type: 'toggle', id: 'a' });
    expect(s.ids.size).toBe(0);
  });

  it('toggle on an unselected object adds it (ghost-id validation is the hook’s job)', () => {
    let s = st(['a']);
    s = act(s, { type: 'toggle', id: 'b' });
    expect([...s.ids].sort()).toEqual(['a', 'b']);
  });

  it('click on an already-single-selected object is a no-op (stays selected)', () => {
    const s = st(['a']);
    const out = act(s, { type: 'click', id: 'a' });
    expect(out).toBe(s);
  });

  // TC-15
  it('TC-15: prune drops deleted ids and clears editingId when the edited object is gone', () => {
    const s = act(st(['a', 'b', 'c'], 'b'), {
      type: 'prune',
      present: new Set(['a', 'c', 'd']),
    });
    expect([...s.ids].sort()).toEqual(['a', 'c']);
    expect(s.editingId).toBeNull();
  });

  it('prune keeps editingId when the edited object still exists', () => {
    const s = act(st(['a', 'b'], 'b'), { type: 'prune', present: new Set(['a', 'b']) });
    expect(s.editingId).toBe('b');
  });

  it('prune with no changes returns the same state object', () => {
    const s = st(['a', 'b'], 'a');
    expect(act(s, { type: 'prune', present: new Set(['a', 'b', 'x']) })).toBe(s);
  });

  describe('setMany (marquee / select-all)', () => {
    it('replaces the selection when not additive', () => {
      const s = act(st(['a']), { type: 'setMany', ids: ['b', 'c'], additive: false });
      expect([...s.ids].sort()).toEqual(['b', 'c']);
    });

    it('merges when additive', () => {
      const s = act(st(['a']), { type: 'setMany', ids: ['b', 'c'], additive: true });
      expect([...s.ids].sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('editing (TC-15 / sel.edit_enter)', () => {
    it('startEdit selects the object and enters edit mode', () => {
      let s = st(['a']);
      s = act(s, { type: 'edit', id: 'b' });
      expect([...s.ids].sort()).toEqual(['a', 'b']);
      expect(s.editingId).toBe('b');

      // Editing an already-selected object keeps the whole selection.
      s = act(s, { type: 'edit', id: 'a' });
      expect([...s.ids].sort()).toEqual(['a', 'b']);
      expect(s.editingId).toBe('a');
    });

    it('endEdit (null) exits edit mode and keeps the selection', () => {
      const s = act(st(['a', 'b'], 'a'), { type: 'edit', id: null });
      expect(s.editingId).toBeNull();
      expect([...s.ids].sort()).toEqual(['a', 'b']);
    });
  });

  it('clear empties selection and editing', () => {
    const s = act(st(['a', 'b'], 'a'), { type: 'clear' });
    expect(s.ids.size).toBe(0);
    expect(s.editingId).toBeNull();
  });
});
