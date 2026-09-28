import { describe, expect, it } from 'vitest';
import {
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

const EMPTY: SelectionState = { ids: new Set(), editingId: null };

describe('selectionReducer', () => {
  // TC-13: click / toggle / click replaces set
  describe('TC-13 click replaces, toggle adds', () => {
    it('{} → click a → {a}', () => {
      const state = selectionReducer(EMPTY, { type: 'click', id: 'a' });
      expect(state.ids).toEqual(new Set(['a']));
    });

    it('{a} → toggle b → {a,b}', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'toggle', id: 'b' });
      expect(result.ids).toEqual(new Set(['a', 'b']));
    });

    it('{a,b} → click b → {b} (click replaces)', () => {
      const state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
      const result = selectionReducer(state, { type: 'click', id: 'b' });
      expect(result.ids).toEqual(new Set(['b']));
    });
  });

  // TC-14: toggle removing last member → Empty
  describe('TC-14 toggle removes last member', () => {
    it('{a} → toggle a → {} (empty selection)', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'toggle', id: 'a' });
      expect(result.ids).toEqual(new Set());
    });
  });

  // TC-15: prune removes deleted ids, ends editing if pruned
  describe('TC-15 prune', () => {
    it('{a,b,c} → prune present {a,c,d} → {a,c}', () => {
      const state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
      const present = new Set(['a', 'c', 'd']);
      const result = selectionReducer(state, { type: 'prune', presentIds: present });
      expect(result.ids).toEqual(new Set(['a', 'c']));
    });

    it('pruning editingId ends editing', () => {
      const state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: 'b' };
      const present = new Set(['a', 'c', 'd']);
      const result = selectionReducer(state, { type: 'prune', presentIds: present });
      expect(result.ids).toEqual(new Set(['a', 'c']));
      expect(result.editingId).toBeNull();
    });

    it('pruning all → empty, editing null', () => {
      const state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
      const present = new Set(['x', 'y']);
      const result = selectionReducer(state, { type: 'prune', presentIds: present });
      expect(result.ids).toEqual(new Set());
      expect(result.editingId).toBeNull();
    });
  });

  describe('setMany', () => {
    it('non-additive replaces selection', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: false });
      expect(result.ids).toEqual(new Set(['b', 'c']));
    });

    it('additive adds to existing selection', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
      expect(result.ids).toEqual(new Set(['a', 'b', 'c']));
    });

    it('additive with empty list leaves selection unchanged', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'setMany', ids: [], additive: true });
      expect(result.ids).toEqual(new Set(['a']));
    });

    it('non-additive with empty list clears selection', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'setMany', ids: [], additive: false });
      expect(result.ids).toEqual(new Set());
    });
  });

  describe('clear', () => {
    it('clears selection and editing', () => {
      const state: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
      const result = selectionReducer(state, { type: 'clear' });
      expect(result.ids).toEqual(new Set());
      expect(result.editingId).toBeNull();
    });
  });

  describe('edit', () => {
    it('sets editingId', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: null };
      const result = selectionReducer(state, { type: 'edit', id: 'a' });
      expect(result.editingId).toBe('a');
    });

    it('null ends editing', () => {
      const state: SelectionState = { ids: new Set(['a']), editingId: 'a' };
      const result = selectionReducer(state, { type: 'edit', id: null });
      expect(result.editingId).toBeNull();
    });
  });
});
