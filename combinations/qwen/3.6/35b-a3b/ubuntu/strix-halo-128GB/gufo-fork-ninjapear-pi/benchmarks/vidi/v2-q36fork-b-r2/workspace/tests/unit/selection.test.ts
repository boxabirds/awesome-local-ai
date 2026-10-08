import { describe, it, expect } from 'vitest';
import type { SelectionAction } from '../../src/client/board/useSelection';
import { selectionReducer } from '../../src/client/board/useSelection';

// We need to import or define the internal types for testing
describe('sel.interaction — TC-13 to TC-15', () => {
  describe('TC-13: click / shift-click state transitions', () => {
    it('{} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
      let state = selectionReducer({ ids: new Set(), editingId: null }, { type: 'click' as const, id: 'a' });
      expect(state.ids.size).toBe(1);
      expect(state.ids.has('a')).toBe(true);

      state = selectionReducer(state, { type: 'toggle' as const, id: 'b' });
      expect(state.ids.size).toBe(2);
      expect(state.ids.has('a')).toBe(true);
      expect(state.ids.has('b')).toBe(true);

      state = selectionReducer(state, { type: 'click' as const, id: 'b' });
      expect(state.ids.size).toBe(1);
      expect(state.ids.has('a')).toBe(false);
      expect(state.ids.has('b')).toBe(true);
    });

    it('setMany additive adds to existing', () => {
      let state = selectionReducer({ ids: new Set(['a']), editingId: null }, { type: 'click' as const, id: 'a' });
      state = selectionReducer(state, { type: 'setMany' as const, ids: ['b', 'c'], additive: true });
      expect(state.ids.size).toBe(3);
      expect([...state.ids].sort()).toEqual(['a', 'b', 'c']);
    });

    it('setMany non-additive replaces', () => {
      let state = selectionReducer({ ids: new Set(['a', 'b']), editingId: null }, { type: 'click' as const, id: 'a' });
      state = selectionReducer(state, { type: 'setMany' as const, ids: ['x', 'y'], additive: false });
      expect(state.ids.size).toBe(2);
      expect([...state.ids].sort()).toEqual(['x', 'y']);
    });
  });

  describe('TC-14: removing last member → empty', () => {
    it('{a} → toggle a → {}', () => {
      let state = selectionReducer({ ids: new Set(['a']), editingId: null }, { type: 'click' as const, id: 'a' });
      state = selectionReducer(state, { type: 'toggle' as const, id: 'a' });
      expect(state.ids.size).toBe(0);
    });
  });

  describe('TC-15: prune with remote delete', () => {
    it('{a,b,c} → prune present {a,c,d} → {a,c}', () => {
      let state = selectionReducer(
        { ids: new Set(['a', 'b', 'c']), editingId: null },
        { type: 'setMany' as const, ids: ['a', 'b', 'c'], additive: false }
      );
      state = selectionReducer(state, { type: 'prune' as const, presentIds: new Set(['a', 'c', 'd']) });
      expect(state.ids.size).toBe(2);
      expect(state.ids.has('a')).toBe(true);
      expect(state.ids.has('b')).toBe(false);
      expect(state.ids.has('c')).toBe(true);
    });

    it('editingId becomes null when pruned', () => {
      let state = selectionReducer(
        { ids: new Set(['a', 'b', 'c']), editingId: 'b' },
        { type: 'clear' as const }
      );
      // Test prune with editingId
      state = selectionReducer(
        { ids: new Set(['a', 'b', 'c']), editingId: 'b' },
        { type: 'prune' as const, presentIds: new Set(['a', 'c', 'd']) }
      );
      expect(state.editingId).toBeNull();
    });
  });
});
