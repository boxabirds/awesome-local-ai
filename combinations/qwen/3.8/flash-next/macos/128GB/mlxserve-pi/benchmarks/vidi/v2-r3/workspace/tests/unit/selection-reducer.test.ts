import { describe, expect, it } from 'vitest';
import {
  selectionReducer,
  type SelectionState,
  type SelectionAction,
} from '../../src/client/board/useSelection';

function makeState(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer', () => {
  // TC-13: {} → click a → {a} → toggle b → {a,b} → click b → {b}
  describe('TC-13 click/toggle interaction', () => {
    it('click on empty selection selects only that id', () => {
      const state = makeState([]);
      const next = selectionReducer(state, { type: 'click', id: 'a' });
      expect(next.ids).toEqual(new Set(['a']));
    });

    it('toggle adds to existing selection', () => {
      const state = makeState(['a']);
      const next = selectionReducer(state, { type: 'toggle', id: 'b' });
      expect(next.ids).toEqual(new Set(['a', 'b']));
    });

    it('click replaces the entire set', () => {
      const state = makeState(['a', 'b']);
      const next = selectionReducer(state, { type: 'click', id: 'b' });
      expect(next.ids).toEqual(new Set(['b']));
    });
  });

  // TC-14: {a} → toggle a → {} (removing last member)
  describe('TC-14 toggle removes last member', () => {
    it('toggle the only selected id → empty selection', () => {
      const state = makeState(['a']);
      const next = selectionReducer(state, { type: 'toggle', id: 'a' });
      expect(next.ids).toEqual(new Set());
    });
  });

  // TC-15: {a,b,c} → prune present {a,c,d} → {a,c}; if editingId was b, editingId becomes null
  describe('TC-15 prune', () => {
    it('removes ids not present and keeps those present', () => {
      const state = makeState(['a', 'b', 'c']);
      const present = new Set(['a', 'c', 'd']);
      const next = selectionReducer(state, { type: 'prune', presentIds: present });
      expect(next.ids).toEqual(new Set(['a', 'c']));
    });

    it('pruned editingId becomes null', () => {
      const state = makeState(['a', 'b', 'c'], 'b');
      const present = new Set(['a', 'c', 'd']);
      const next = selectionReducer(state, { type: 'prune', presentIds: present });
      expect(next.editingId).toBeNull();
    });

    it('editingId kept when still present', () => {
      const state = makeState(['a', 'b', 'c'], 'b');
      const present = new Set(['a', 'b', 'c']);
      const next = selectionReducer(state, { type: 'prune', presentIds: present });
      expect(next.editingId).toBe('b');
    });
  });

  // setMany additive vs non-additive
  describe('setMany', () => {
    it('non-additive replaces selection', () => {
      const state = makeState(['x']);
      const next = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: false });
      expect(next.ids).toEqual(new Set(['a', 'b']));
    });

    it('additive merges with existing selection', () => {
      const state = makeState(['x']);
      const next = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: true });
      expect(next.ids).toEqual(new Set(['x', 'a', 'b']));
    });

    it('additive with existing overlapping ids', () => {
      const state = makeState(['a', 'x']);
      const next = selectionReducer(state, { type: 'setMany', ids: ['a', 'b'], additive: true });
      expect(next.ids).toEqual(new Set(['a', 'x', 'b']));
    });
  });

  // clear
  describe('clear', () => {
    it('empties the selection and editing', () => {
      const state = makeState(['a', 'b'], 'a');
      const next = selectionReducer(state, { type: 'clear' });
      expect(next.ids).toEqual(new Set());
      expect(next.editingId).toBeNull();
    });
  });

  // edit action
  describe('edit', () => {
    it('sets editingId', () => {
      const state = makeState(['a']);
      const next = selectionReducer(state, { type: 'edit', id: 'a' });
      expect(next.editingId).toBe('a');
    });

    it('null ends editing', () => {
      const state = makeState(['a'], 'a');
      const next = selectionReducer(state, { type: 'edit', id: null });
      expect(next.editingId).toBeNull();
    });
  });
});
