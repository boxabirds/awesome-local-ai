// tests/unit/selection.test.ts
// TC-13 to TC-15: selection reducer

import { describe, it, expect } from 'vitest';
import { selectionReducer, type SelectionState } from '../../src/client/board/useSelection';

describe('sel.interaction - selectionReducer (unit)', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  describe('TC-13: click and toggle', () => {
    it('click replaces set, toggle adds/removes', () => {
      let state: SelectionState = { ids: new Set(), editingId: null };

      // Click a
      state = selectionReducer(state, { type: 'click', id: 'a' });
      expect(state.ids).toEqual(new Set(['a']));

      // Toggle b (add)
      state = selectionReducer(state, { type: 'toggle', id: 'b' });
      expect(state.ids).toEqual(new Set(['a', 'b']));

      // Click b (replaces set with just b)
      state = selectionReducer(state, { type: 'click', id: 'b' });
      expect(state.ids).toEqual(new Set(['b']));
    });
  });

  // TC-14: {a} → toggle a → {} (removing last member)
  describe('TC-14: toggle removes last member', () => {
    it('toggling the only selected item empties the set', () => {
      let state: SelectionState = { ids: new Set(['a']), editingId: null };
      state = selectionReducer(state, { type: 'toggle', id: 'a' });
      expect(state.ids.size).toBe(0);
    });
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; if editingId was b, editingId becomes null
  describe('TC-15: prune', () => {
    it('removes ids not in present set', () => {
      let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
      state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
      expect(state.ids).toEqual(new Set(['a', 'c']));
    });

    it('ends editing if editingId is pruned', () => {
      let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
      state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
      expect(state.ids).toEqual(new Set(['a', 'c']));
      expect(state.editingId).toBeNull();
    });

    it('keeps editingId if still present', () => {
      let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'a' };
      state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
      expect(state.editingId).toBe('a');
    });
  });

  // setMany additive vs non-additive
  describe('setMany', () => {
    it('additive: adds to existing selection', () => {
      let state: SelectionState = { ids: new Set(['a']), editingId: null };
      state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
      expect(state.ids).toEqual(new Set(['a', 'b', 'c']));
    });

    it('non-additive: replaces selection', () => {
      let state: SelectionState = { ids: new Set(['a']), editingId: null };
      state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: false });
      expect(state.ids).toEqual(new Set(['b', 'c']));
    });
  });

  // clear
  describe('clear', () => {
    it('empties the selection and editing', () => {
      let state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
      state = selectionReducer(state, { type: 'clear' });
      expect(state.ids.size).toBe(0);
      expect(state.editingId).toBeNull();
    });
  });

  // edit
  describe('edit', () => {
    it('sets editingId', () => {
      let state: SelectionState = { ids: new Set(['a']), editingId: null };
      state = selectionReducer(state, { type: 'edit', id: 'a' });
      expect(state.editingId).toBe('a');
    });

    it('clears editingId', () => {
      let state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
      state = selectionReducer(state, { type: 'edit', id: null });
      expect(state.editingId).toBeNull();
    });
  });
});
