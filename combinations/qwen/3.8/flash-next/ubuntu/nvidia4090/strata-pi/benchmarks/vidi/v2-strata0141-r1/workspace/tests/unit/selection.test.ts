import { describe, expect, it } from 'vitest';
import {
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

/**
 * Unit tests for the pure selection reducer (anchor `sel.interaction`).
 *
 * Selection is per-client and never written to the Y.Doc, so the whole story 7
 * selection rule set is this one function: click replaces, Shift-click toggles,
 * marquee and select-all set many, and a snapshot change prunes what other
 * people deleted.
 */

const state = (ids: readonly string[], editingId: string | null = null): SelectionState => ({
  ids: new Set(ids),
  editingId,
});

const idList = (next: SelectionState): string[] => [...next.ids].sort();

const EMPTY: SelectionState = state([]);

const run = (
  start: SelectionState,
  ...actions: SelectionAction[]
): SelectionState => actions.reduce((current, action) => selectionReducer(current, action), start);

describe('sel.interaction - click and shift-click (TC-13, TC-14)', () => {
  // TC-13
  it('TC-13 click selects one, Shift-click adds, a plain click replaces the whole set', () => {
    const afterClickA = run(EMPTY, { type: 'click', id: 'a' });
    expect(idList(afterClickA)).toEqual(['a']);

    const afterToggleB = run(afterClickA, { type: 'toggle', id: 'b' });
    expect(idList(afterToggleB)).toEqual(['a', 'b']);

    const afterClickB = run(afterToggleB, { type: 'click', id: 'b' });
    expect(idList(afterClickB)).toEqual(['b']);
  });

  it('Shift-click on a member removes that member and keeps the rest', () => {
    const next = run(state(['a', 'b', 'c']), { type: 'toggle', id: 'b' });
    expect(idList(next)).toEqual(['a', 'c']);
  });

  // TC-14 (boundary: the last member leaves the set empty)
  it('TC-14 Shift-clicking the only selected object empties the selection', () => {
    const next = run(state(['a']), { type: 'toggle', id: 'a' });
    expect(idList(next)).toEqual([]);
    expect(next.ids.size).toBe(0);
    // An empty selection has nothing to edit and nothing to show a bar for.
    expect(next.editingId).toBeNull();
  });

  it('clicking an already selected object keeps it selected', () => {
    const next = run(state(['a', 'b']), { type: 'click', id: 'a' });
    expect(idList(next)).toEqual(['a']);
  });

  it('clear empties the selection and ends editing', () => {
    const next = run(state(['a', 'b'], 'a'), { type: 'clear' });
    expect(idList(next)).toEqual([]);
    expect(next.editingId).toBeNull();
  });
});

describe('sel.interaction - marquee and select all (setMany)', () => {
  it('setMany without additive replaces the selection', () => {
    const next = run(state(['x']), { type: 'setMany', ids: ['a', 'b'], additive: false });
    expect(idList(next)).toEqual(['a', 'b']);
  });

  it('setMany additive keeps what was already selected (marquee)', () => {
    const next = run(state(['x']), { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(idList(next)).toEqual(['a', 'b', 'x']);
  });

  it('setMany does not repeat an id that is already selected', () => {
    const next = run(state(['a']), { type: 'setMany', ids: ['a', 'b'], additive: true });
    expect(idList(next)).toEqual(['a', 'b']);
    expect(next.ids.size).toBe(2);
  });

  // TC-28 boundary: select all on an empty board.
  it('setMany of nothing on an empty selection is an empty selection, not an error', () => {
    const next = run(EMPTY, { type: 'setMany', ids: [], additive: false });
    expect(idList(next)).toEqual([]);
    expect(next.editingId).toBeNull();
  });

  it('setMany additive of nothing leaves the selection untouched', () => {
    const next = run(state(['a'], 'a'), { type: 'setMany', ids: [], additive: true });
    expect(idList(next)).toEqual(['a']);
    expect(next.editingId).toBe('a');
  });
});

describe('sel.interaction - remote deletes prune the selection (TC-15)', () => {
  // TC-15
  it('TC-15 ids that are no longer on the board leave the selection', () => {
    const next = run(state(['a', 'b', 'c']), {
      type: 'prune',
      presentIds: new Set(['a', 'c', 'd']),
    });
    expect(idList(next)).toEqual(['a', 'c']);
  });

  it('TC-15 editing an object that was deleted remotely ends editing', () => {
    const next = run(state(['a', 'b', 'c'], 'b'), {
      type: 'prune',
      presentIds: new Set(['a', 'c']),
    });
    expect(idList(next)).toEqual(['a', 'c']);
    expect(next.editingId).toBeNull();
  });

  it('editing an object that is still there keeps editing it', () => {
    const next = run(state(['a', 'b'], 'a'), {
      type: 'prune',
      presentIds: new Set(['a', 'c']),
    });
    expect(next.editingId).toBe('a');
  });

  it('prune of everything leaves an empty selection (TC-16 setup)', () => {
    const next = run(state(['a', 'b'], 'a'), { type: 'prune', presentIds: new Set() });
    expect(idList(next)).toEqual([]);
    expect(next.editingId).toBeNull();
  });

  it('prune that has nothing to remove changes nothing', () => {
    const next = run(state(['a', 'b'], 'a'), {
      type: 'prune',
      presentIds: new Set(['a', 'b', 'c']),
    });
    expect(idList(next)).toEqual(['a', 'b']);
    expect(next.editingId).toBe('a');
  });
});

describe('sel.interaction - editing (Some <-> Editing)', () => {
  it('starting to edit selects the object being edited', () => {
    const next = run(EMPTY, { type: 'edit', id: 'a' });
    expect(idList(next)).toEqual(['a']);
    expect(next.editingId).toBe('a');
  });

  it('ending editing keeps the selection (Escape)', () => {
    const next = run(state(['a', 'b'], 'a'), { type: 'edit', id: null });
    expect(idList(next)).toEqual(['a', 'b']);
    expect(next.editingId).toBeNull();
  });

  it('editing another object replaces the selection and ends the previous edit', () => {
    const next = run(state(['a'], 'a'), { type: 'edit', id: 'b' });
    expect(idList(next)).toEqual(['b']);
    expect(next.editingId).toBe('b');
  });

  it('clicking the object that is being edited does not end the edit', () => {
    const next = run(state(['a'], 'a'), { type: 'click', id: 'a' });
    expect(next.editingId).toBe('a');
  });

  it('clicking any other object ends editing', () => {
    const next = run(state(['a', 'b'], 'a'), { type: 'click', id: 'b' });
    expect(idList(next)).toEqual(['b']);
    expect(next.editingId).toBeNull();
  });

  it('Shift-clicking the object being edited ends the edit (it left the set)', () => {
    const next = run(state(['a'], 'a'), { type: 'toggle', id: 'a' });
    expect(idList(next)).toEqual([]);
    expect(next.editingId).toBeNull();
  });
});

describe('sel.interaction - the reducer never mutates its input (error paths)', () => {
  it('the previous state is left untouched', () => {
    const before = state(['a', 'b'], 'a');
    const beforeIds = [...before.ids];
    run(before, { type: 'click', id: 'c' });
    run(before, { type: 'toggle', id: 'a' });
    run(before, { type: 'clear' });
    expect(beforeIds).toEqual(['a', 'b']);
    expect([...before.ids]).toEqual(['a', 'b']);
    expect(before.editingId).toBe('a');
  });

  it('an empty id is ignored: nothing on a board has no id', () => {
    const next = run(state(['a']), { type: 'click', id: '' });
    expect(idList(next)).toEqual(['a']);
    const toggled = run(state(['a']), { type: 'toggle', id: '' });
    expect(idList(toggled)).toEqual(['a']);
  });
});
