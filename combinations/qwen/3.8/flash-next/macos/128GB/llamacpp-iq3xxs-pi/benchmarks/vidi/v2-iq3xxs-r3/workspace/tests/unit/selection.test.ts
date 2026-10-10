/**
 * The selection reducer (story 7, TC-13 to TC-15).
 *
 * `sel.interaction` says selection is one set of ids plus one editing id, and
 * that it survives what the document does to it. All of that is decided in one
 * pure function, so all of it is testable without a board: TC-13 and TC-14 are
 * the design's own state walks, TC-15 is the one that matters when a second
 * person is deleting things while you select them.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../../src/client/board/useSelection';

const idsOf = (state: SelectionState): string[] => [...state.ids].sort();

const run = (state: SelectionState, ...actions: SelectionAction[]): SelectionState =>
  actions.reduce((current, action) => selectionReducer(current, action), state);

const click = (id: string): SelectionAction => ({ type: 'click', id });
const toggle = (id: string): SelectionAction => ({ type: 'toggle', id });
const setMany = (ids: readonly string[], additive: boolean): SelectionAction => ({
  type: 'setMany',
  ids,
  additive,
});
const clear: SelectionAction = { type: 'clear' };
const prune = (presentIds: readonly string[]): SelectionAction => ({
  type: 'prune',
  presentIds: new Set(presentIds),
});
const edit = (id: string | null): SelectionAction => ({ type: 'edit', id });

describe('clicking and Shift-clicking (TC-13, TC-14)', () => {
  it('TC-13: {} → {a} → {a,b} → {c} → {}', () => {
    const afterA = run(EMPTY_SELECTION, click('a'));
    expect(idsOf(afterA)).toEqual(['a']);
    const afterB = run(afterA, toggle('b'));
    expect(idsOf(afterB)).toEqual(['a', 'b']);
    const afterC = run(afterB, click('c'));
    expect(idsOf(afterC)).toEqual(['c']);
    expect(idsOf(run(afterC, clear))).toEqual([]);
  });

  it('TC-14: {a} → {a,b} → {b}', () => {
    const started = run(EMPTY_SELECTION, click('a'));
    const both = run(started, toggle('b'));
    expect(idsOf(both)).toEqual(['a', 'b']);
    expect(idsOf(run(both, toggle('a')))).toEqual(['b']);
  });

  it('Shift-clicking the only object selected empties the selection', () => {
    expect(idsOf(run(EMPTY_SELECTION, click('a'), toggle('a')))).toEqual([]);
  });

  it('clicking one object of a group replaces the selection; Shift-clicking adds to it', () => {
    const group = run(EMPTY_SELECTION, setMany(['a', 'b', 'c'], false));
    expect(idsOf(run(group, click('d')))).toEqual(['d']);
    expect(idsOf(run(group, toggle('d')))).toEqual(['a', 'b', 'c', 'd']);
    // Shift-clicking something already in the group takes it out.
    expect(idsOf(run(group, toggle('b')))).toEqual(['a', 'c']);
    // Shift-clicking a single selected object starts from that object, not from nothing.
    expect(idsOf(run(EMPTY_SELECTION, click('a'), toggle('b')))).toEqual(['a', 'b']);
  });

  it('an empty selection stays empty however often it is cleared', () => {
    const cleared = run(EMPTY_SELECTION, clear);
    expect(cleared).toBe(EMPTY_SELECTION);
    expect(run(cleared, clear)).toBe(EMPTY_SELECTION);
  });
});

describe('marquee and select all (setMany)', () => {
  it('a marquee replaces the selection, and Shift-dragging adds to it', () => {
    const first = run(EMPTY_SELECTION, setMany(['a', 'b'], false));
    expect(idsOf(first)).toEqual(['a', 'b']);
    expect(idsOf(run(first, setMany(['c'], false)))).toEqual(['c']);
    expect(idsOf(run(first, setMany(['c', 'd'], true)))).toEqual(['a', 'b', 'c', 'd']);
    // A marquee that caught nothing leaves the selection as it was.
    expect(idsOf(run(first, setMany([], true)))).toEqual(['a', 'b']);
  });

  it('select-all sets the ids the build can draw, in any order', () => {
    const many = run(EMPTY_SELECTION, setMany(['c', 'a', 'b'], false));
    expect(idsOf(many)).toEqual(['a', 'b', 'c']);
  });

  it('setting nothing and clearing agree', () => {
    expect(idsOf(run(EMPTY_SELECTION, setMany(['a'], false), setMany([], false)))).toEqual([]);
  });
});

describe('editing one object of the selection', () => {
  it('double-clicking selects the object and marks it as being typed into', () => {
    const editing = run(run(EMPTY_SELECTION, click('a')), edit('a'));
    expect(editing.editingId).toBe('a');
    expect(idsOf(editing)).toEqual(['a']);
    // Typing into an object that was not selected selects it alone.
    const fromGroup = run(EMPTY_SELECTION, setMany(['a', 'b'], false), edit('b'));
    expect(idsOf(fromGroup)).toEqual(['b']);
    expect(fromGroup.editingId).toBe('b');
  });

  it('ending the edit keeps the selection; clearing it ends the edit too', () => {
    const editing = run(EMPTY_SELECTION, edit('a'));
    expect(idsOf(run(editing, edit(null)))).toEqual(['a']);
    expect(run(editing, edit(null)).editingId).toBeNull();
    expect(run(editing, clear).editingId).toBeNull();
    expect(run(editing, click('b')).editingId).toBeNull();
    // Shift-clicking something else out does not lose the editing object.
    expect(run(editing, toggle('b')).editingId).toBe('a');
    // Shift-clicking the object being typed into ends the edit: it is gone.
    const out = run(editing, toggle('a'));
    expect(out.editingId).toBeNull();
    expect(idsOf(out)).toEqual([]);
  });
});

describe('another person deletes what is selected (TC-15)', () => {
  const TWENTY = Array.from({ length: 20 }, (_, index) => `id-${index}`);

  it('TC-15: the selection survives twenty rapid updates to the document', () => {
    let state = run(EMPTY_SELECTION, setMany(TWENTY, false));
    expect(state.ids.size).toBe(20);
    for (let update = 0; update < 20; update += 1) {
      // The document changed; the same objects are still in it.
      state = selectionReducer(state, prune(TWENTY));
      // Someone clicks and Shift-clicks while it happens.
      state = selectionReducer(state, click(TWENTY[update]));
      state = selectionReducer(state, toggle(TWENTY[(update + 7) % TWENTY.length]));
      expect(state.ids.size).toBeGreaterThan(0);
      for (const id of state.ids) expect(TWENTY).toContain(id);
    }
    // Objects that vanished are dropped from the selection, and only they are.
    const remaining = TWENTY.slice(5);
    const pruned = selectionReducer(run(EMPTY_SELECTION, setMany(TWENTY, false)), prune(remaining));
    expect(idsOf(pruned)).toEqual(remaining.sort());
    // And an update that changes nothing gives the same state back, so React
    // does not re-render the board 20 times for nothing.
    const stable = run(EMPTY_SELECTION, setMany(TWENTY, false));
    expect(selectionReducer(stable, prune(TWENTY))).toBe(stable);
    // A select-all that changes nothing is still an answer about content, and
    // the content is what the board renders.
    expect(idsOf(selectionReducer(stable, setMany(TWENTY, false)))).toEqual(idsOf(stable));
  });

  it('a pruned object that was being typed into stops being typed into', () => {
    const editing = run(EMPTY_SELECTION, edit('a'));
    const pruned = selectionReducer(editing, prune(['b']));
    expect(pruned.editingId).toBeNull();
    expect(idsOf(pruned)).toEqual([]);
  });

  it('pruning what is not selected changes nothing', () => {
    const state = run(EMPTY_SELECTION, click('a'));
    expect(selectionReducer(state, prune(['a', 'b']))).toBe(state);
  });
});
