import { describe, it, expect } from 'vitest';
import { selectionReducer, SelectionState, SelectionAction } from '@client/board/useSelection';

function makeState(ids: string[], editingId: string | null = null): SelectionState {
  return { ids: new Set(ids), editingId };
}

describe('selectionReducer', () => {
  describe('TC-13: click/toggle sequence', () => {
    it('{} → click a → {a} → toggle b → {a,b} → click b → {b}', () => {
      let state = makeState([]);
      state = selectionReducer(state, { type: 'click', id: 'a' });
      expect(state.ids).toEqual(new Set(['a']));

      state = selectionReducer(state, { type: 'toggle', id: 'b' });
      expect(state.ids).toEqual(new Set(['a', 'b']));

      state = selectionReducer(state, { type: 'click', id: 'b' });
      expect(state.ids).toEqual(new Set(['b']));
    });
  });

  describe('TC-14: toggle removes last member', () => {
    it('{a} → toggle a → {}', () => {
      let state = makeState(['a']);
      state = selectionReducer(state, { type: 'toggle', id: 'a' });
      expect(state.ids).toEqual(new Set());
    });
  });

  describe('TC-15: prune', () => {
    it('{a,b,c} → prune present {a,c,d} → {a,c}', () => {
      let state = makeState(['a', 'b', 'c']);
      state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c', 'd']) });
      expect(state.ids).toEqual(new Set(['a', 'c']));
    });

    it('editingId b pruned → editingId null', () => {
      let state = makeState(['a', 'b'], 'b');
      state = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'c']) });
      expect(state.ids).toEqual(new Set(['a']));
      expect(state.editingId).toBeNull();
    });

    it('all pruned → empty', () => {
      let state = makeState(['a', 'b']);
      state = selectionReducer(state, { type: 'prune', presentIds: new Set(['x', 'y']) });
      expect(state.ids).toEqual(new Set());
    });

    it('no changes → same state reference', () => {
      let state = makeState(['a', 'b']);
      const result = selectionReducer(state, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) });
      expect(result).toBe(state);
    });
  });

  describe('setMany', () => {
    it('non-additive replaces', () => {
      let state = makeState(['a']);
      state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: false });
      expect(state.ids).toEqual(new Set(['b', 'c']));
    });

    it('additive merges', () => {
      let state = makeState(['a']);
      state = selectionReducer(state, { type: 'setMany', ids: ['b', 'c'], additive: true });
      expect(state.ids).toEqual(new Set(['a', 'b', 'c']));
    });
  });

  describe('clear', () => {
    it('clears all ids and editingId', () => {
      let state = makeState(['a', 'b'], 'a');
      state = selectionReducer(state, { type: 'clear' });
      expect(state.ids).toEqual(new Set());
      expect(state.editingId).toBeNull();
    });
  });

  describe('edit', () => {
    it('edit with id sets editing and selects that id', () => {
      let state = makeState(['a', 'b']);
      state = selectionReducer(state, { type: 'edit', id: 'b' });
      expect(state.ids).toEqual(new Set(['b']));
      expect(state.editingId).toBe('b');
    });

    it('edit null ends editing, keeps selection', () => {
      let state = makeState(['a'], 'a');
      state = selectionReducer(state, { type: 'edit', id: null });
      expect(state.ids).toEqual(new Set(['a']));
      expect(state.editingId).toBeNull();
    });
  });
});
