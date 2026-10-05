import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionState,
} from '../../src/client/board/useSelection';

describe('useSelection reducer (TC-13, TC-14)', () => {
  it('TC-13 click selects one, shift-click adds another, click alone narrows', () => {
    const afterClick = selectionReducer(EMPTY_SELECTION, { type: 'click', id: 'a' });
    expect([...afterClick.ids]).toEqual(['a']);

    const afterToggle = selectionReducer(afterClick, { type: 'toggle', id: 'b' });
    expect([...afterToggle.ids]).toEqual(['a', 'b']);

    // A plain click on `b` replaces the whole selection.
    const clickedB = selectionReducer(afterToggle, { type: 'click', id: 'b' });
    expect([...clickedB.ids]).toEqual(['b']);

    // Shift-click on `b` again takes it out, leaving the rest untouched.
    expect([...selectionReducer(afterToggle, { type: 'toggle', id: 'c' }).ids]).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect([...selectionReducer(afterToggle, { type: 'toggle', id: 'a' }).ids]).toEqual(['b']);
  });

  it('TC-14 toggling the last member leaves an empty selection', () => {
    const one: SelectionState = { ids: new Set(['a']), editingId: null };
    const empty = selectionReducer(one, { type: 'toggle', id: 'a' });
    expect(empty.ids.size).toBe(0);
    expect(empty.editingId).toBeNull();
    // Clearing an empty selection is a no-op, not a new state object.
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });

  it('setMany replaces for select-all and extends for the marquee', () => {
    const all = selectionReducer(EMPTY_SELECTION, { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect([...all.ids]).toEqual(['a', 'b']);

    const more = selectionReducer(all, { type: 'setMany', ids: ['b', 'c'], additive: true });
    expect([...more.ids]).toEqual(['a', 'b', 'c']);

    // An empty marquee leaves the selection exactly as it was.
    expect(selectionReducer(all, { type: 'setMany', ids: [], additive: true })).toBe(all);

    // Select-all over the same ids changes nothing either.
    expect(selectionReducer(all, { type: 'setMany', ids: ['a', 'b'], additive: false })).toBe(all);
  });

  it('TC-15 prune drops the ids that vanished and keeps the rest', () => {
    const many: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    const pruned = selectionReducer(many, {
      type: 'prune',
      presentIds: new Set(['a', 'c']),
    });
    expect([...pruned.ids]).toEqual(['a', 'c']);

    // Everything gone -> empty.
    expect(selectionReducer(many, { type: 'prune', presentIds: new Set() }).ids.size).toBe(0);

    // Nothing to drop -> the same state object, so no repaint.
    expect(
      selectionReducer(many, { type: 'prune', presentIds: new Set(['a', 'b', 'c', 'd']) }),
    ).toBe(many);
  });

  it('pruning the object being edited ends editing; pruning another does not', () => {
    const editing: SelectionState = { ids: new Set(['a', 'b']), editingId: 'a' };
    expect(
      selectionReducer(editing, { type: 'prune', presentIds: new Set(['b']) }).editingId,
    ).toBeNull();
    expect(
      selectionReducer(editing, { type: 'prune', presentIds: new Set(['a', 'b', 'c']) }).editingId,
    ).toBe('a');
  });

  it('edit keeps a group the edited object belongs to, and narrows one it does not', () => {
    const group: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    expect(selectionReducer(group, { type: 'edit', id: 'b' })).toEqual({
      ids: new Set(['a', 'b']),
      editingId: 'b',
    });
    expect(selectionReducer(group, { type: 'edit', id: 'c' }).ids).toEqual(new Set(['c']));
    expect(selectionReducer(group, { type: 'edit', id: null })).toBe(group);
  });

  it('clicking the only selected object again is a no-op (no repaint per press)', () => {
    const one: SelectionState = { ids: new Set(['a']), editingId: null };
    expect(selectionReducer(one, { type: 'click', id: 'a' })).toBe(one);
  });
});

