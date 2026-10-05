import { describe, expect, it, vi } from 'vitest';
import type { Doc } from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot, stickies,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOAD_ORIGIN,
  withLoadOrigin,
  withPeer,
  type Peer,
} from '../peerDoc';

/**
 * Story 8, `undo.history`: a per-person history over a real `Y.Doc`, with a
 * second real document standing in for a colleague (see `./peer.ts`).
 *
 * Every case names the board before, the one action under test, and the board
 * after — including what must *not* change: another person's work (`undo.own`),
 * and anything this tab never did (remote and load updates, TC-02 / TC-03).
 *
 * The controller is created the first time a test asks for it, which is after
 * the fixture has been seeded: like a page that was opened when the board
 * already looked like this. Actions that must be separate steps go through
 * `step`, which closes the capture window on both sides — the same boundary the
 * gestures, toolbars and editor close in the running app.
 */
interface Rig {
  peer: Peer;
  doc: Doc;
  /** The history, created on first use. */
  readonly undo: UndoController;
  notes: () => readonly StickySnapshot[];
  note: (id: string) => StickySnapshot;
  /** Ids on the board, sorted, so sets can be compared. */
  ids: () => string[];
  /** One meaningful action: its own undo step. */
  step<T>(action: () => T): T;
}

function rig(): Rig {
  const peer = withPeer();
  // Created on first use, so seeding a fixture is not part of the history:
  // the page was opened when the board already looked like this.
  let controller: UndoController | null = null;
  const history = (): UndoController => {
    if (controller === null) controller = createUndo(peer.doc);
    return controller;
  };
  const step = <T>(action: () => T): T => {
    history().boundary();
    const result = action();
    history().boundary();
    return result;
  };
  return {
    peer,
    doc: peer.doc,
    get undo() {
      return history();
    },
    notes: () => stickies(peer.doc),
    note: (id) => {
      const found = stickies(peer.doc).find((candidate) => candidate.id === id);
      if (!found) throw new Error(`note ${id} is not on the board`);
      return found;
    },
    ids: () => snapshot(peer.doc).map((note) => note.id).sort(),
    step,
  };
}

/** Add a note (and optionally its text) before the history starts. */
function seed(r: Rig, at: { x: number; y: number }, text = ''): string {
  const id = createSticky(r.doc, at);
  if (text) getStickyText(r.doc, id)?.insert(0, text);
  return id;
}

/** How many separate undo steps the history holds, then put them all back. */
function undosAvailable(controller: UndoController): number {
  let steps = 0;
  while (controller.undo()) {
    steps++;
    if (steps > UNDO_MAX_STEPS + 5) throw new Error('the undo stack never emptied');
  }
  for (let i = 0; i < steps; i++) {
    if (!controller.redo()) throw new Error('redo did not follow the undo count');
  }
  return steps;
}

describe('per-user undo history (undo.history)', () => {
  it('TC-01 undoing my move leaves my colleague alone (undo.own)', () => {
    const r = rig();
    const moved = seed(r, { x: 0, y: 0 });
    seed(r, { x: 600, y: 0 });
    const recoloured = seed(r, { x: 0, y: 600 });
    const before = r.note(moved);
    expect(r.undo.canUndo()).toBe(false);

    // My change: move one note.
    expect(r.step(() => moveObject(r.doc, moved, before.x + 250, before.y + 120))).toBe(true);

    // My colleague's changes, arriving from their document.
    const created = createSticky(r.peer.peer, { x: -400, y: 400 });
    expect(setStickyColor(r.peer.peer, recoloured, 'blue')).toBe(true);
    expect(r.ids()).toContain(created);

    expect(r.undo.canUndo()).toBe(true);
    expect(r.undo.undo()).toBe(true);

    // Mine is back where it was.
    const after = r.note(moved);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    // Theirs is untouched: the note they added is there, and their colour stands.
    expect(r.ids()).toContain(created);
    expect(r.note(recoloured).color).toBe('blue');
  });

  it('TC-02 a board I never touched has nothing to undo (undo.own)', () => {
    const r = rig();
    const theirs = seed(r, { x: 0, y: 0 });
    expect(r.undo.canUndo()).toBe(false);

    // Everything that happens now happens on the other person's document.
    const created = createSticky(r.peer.peer, { x: 300, y: 0 });
    moveObject(r.peer.peer, theirs, 90, 90);

    expect(r.undo.canUndo()).toBe(false);
    expect(r.undo.canRedo()).toBe(false);
    expect(r.undo.undo()).toBe(false);
    expect(r.undo.redo()).toBe(false);
    expect(r.ids()).toContain(created);
  });

  it('TC-03 a board loaded from storage has nothing to undo (undo.own)', () => {
    const r = rig();
    expect(r.undo.canUndo()).toBe(false);

    withLoadOrigin(r.doc, () => {
      createSticky(r.doc, { x: 0, y: 0 });
      createSticky(r.doc, { x: 400, y: 0 });
    });

    expect(r.ids()).toHaveLength(2);
    expect(r.undo.canUndo()).toBe(false);
    expect(r.undo.undo()).toBe(false);
  });

  it('TC-04 undoing one delete brings eight notes back whole (undo.own, undo.steps)', () => {
    const r = rig();
    const cluster: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = seed(r, { x: i * 40, y: 0 }, `note ${i}`);
      setStickyColor(r.doc, id, 'pink');
      cluster.push(id);
    }
    const bystander = seed(r, { x: 0, y: 900 }, 'keep me');
    const before = new Map(r.notes().map((note) => [note.id, note]));
    expect(r.undo.canUndo()).toBe(false);

    // One accidental Delete, eight notes gone at once.
    expect(r.step(() => deleteObjects(r.doc, cluster))).toBe(8);
    expect(r.ids()).toEqual([bystander]);

    expect(r.undo.undo()).toBe(true);

    expect(r.ids()).toEqual([...cluster, bystander].sort());
    for (const id of cluster) {
      const was = before.get(id)!;
      const now = r.note(id);
      expect(now.text).toBe(was.text);
      expect(now.color).toBe(was.color);
      expect([now.x, now.y, now.width, now.height]).toEqual([
        was.x,
        was.y,
        was.width,
        was.height,
      ]);
    }
    // The note I did not delete was never touched.
    expect(r.note(bystander).text).toBe('keep me');
  });

  it('TC-05 redo re-applies the step I just undid (undo.redo)', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    const before = r.note(id);

    r.step(() => moveObject(r.doc, id, before.x + 300, before.y + 40));
    expect(r.undo.undo()).toBe(true);
    expect(r.note(id).x).toBeCloseTo(before.x, 6);
    expect(r.undo.canRedo()).toBe(true);

    expect(r.undo.redo()).toBe(true);
    expect(r.note(id).x).toBeCloseTo(before.x + 300, 6);
    expect(r.note(id).y).toBeCloseTo(before.y + 40, 6);
    expect(r.undo.canRedo()).toBe(false);
    expect(r.undo.canUndo()).toBe(true);
  });

  it('TC-06 a new change after an undo throws away the redo history (undo.redo_cleared)', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    r.step(() => moveObject(r.doc, id, 200, 200));
    expect(r.undo.undo()).toBe(true);
    expect(r.undo.canRedo()).toBe(true);

    r.step(() => setStickyColor(r.doc, id, 'green'));

    expect(r.undo.canRedo()).toBe(false);
    expect(r.undo.redo()).toBe(false);
  });

  it('TC-07 undoing a move of a note a colleague deleted is silent (undo.safe)', () => {
    const r = rig();
    const mine = seed(r, { x: 0, y: 0 });
    const other = seed(r, { x: 500, y: 0 });
    const wasOther = r.note(other);

    // My two steps: move one note, then move another.
    r.step(() => moveObject(r.doc, mine, 200, 200));
    r.step(() => moveObject(r.doc, other, 700, 100));
    // They delete the first one.
    deleteObjects(r.peer.peer, [mine]);
    expect(r.ids()).toEqual([other]);

    // The step on top is mine and its object is present: `other` goes back.
    expect(r.undo.undo()).toBe(true);
    expect(r.note(other).x).toBeCloseTo(wasOther.x, 6);

    // The step underneath targets a note that is no longer here: nothing is
    // recreated, nothing is thrown, the step is spent.
    expect(() => expect(r.undo.undo()).toBe(true)).not.toThrow();
    expect(r.ids()).toEqual([other]);
    expect(r.note(other).x).toBeCloseTo(wasOther.x, 6);
    expect(r.undo.canUndo()).toBe(false);
  });

  it('a step that changed nothing still tells the listeners (undo.safe)', () => {
    const r = rig();
    const mine = seed(r, { x: 0, y: 0 });
    r.step(() => moveObject(r.doc, mine, 300, 300));

    const reported: boolean[] = [];
    r.undo.onChange(() => reported.push(r.undo.canUndo()));

    deleteObjects(r.peer.peer, [mine]);
    expect(r.undo.canUndo()).toBe(true);

    // yjs drops a step whose object is gone, and when nothing at all is left to
    // change it fires no stack event. Without a report of her own the toolbar
    // would go on offering a step that no longer exists.
    r.undo.undo();
    expect(r.undo.canUndo()).toBe(false);
    expect(reported.at(-1)).toBe(false);
  });

  it('TC-08 undoing my delete restores the text as it was when I deleted (undo.safe)', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 }, 'draft');
    // A colleague types into it before I delete it.
    getStickyText(r.peer.peer, id)?.insert(5, ' — reviewed');
    const atDelete = r.note(id).text;
    expect(atDelete).toBe('draft — reviewed');
    expect(r.undo.canUndo()).toBe(false);

    expect(r.step(() => deleteObjects(r.doc, [id]))).toBe(1);
    expect(r.ids()).toEqual([]);

    expect(r.undo.undo()).toBe(true);
    expect(r.note(id).text).toBe(atDelete);
  });

  it('TC-09 the two-hundred-and-first step drops the oldest (undo.limit)', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    expect(r.undo.canUndo()).toBe(false);

    for (let i = 1; i <= UNDO_MAX_STEPS; i++) {
      r.step(() => moveObject(r.doc, id, i, 0));
    }
    expect(r.note(id).x).toBeCloseTo(UNDO_MAX_STEPS, 6);
    expect(undosAvailable(r.undo)).toBe(UNDO_MAX_STEPS);

    // One step more than the history holds.
    r.step(() => moveObject(r.doc, id, 9999, 0));
    expect(undosAvailable(r.undo)).toBe(UNDO_MAX_STEPS);
    expect(r.note(id).x).toBeCloseTo(9999, 6);

    // Emptying it walks back to the position the oldest *surviving* step
    // remembers: the move to x = 1 has fallen out of the history.
    let steps = 0;
    while (r.undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(r.note(id).x).toBeCloseTo(1, 6);
  });

  it('TC-10 the two-hundredth step fits without dropping anything (undo.limit)', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    const start = r.note(id);

    for (let i = 1; i < UNDO_MAX_STEPS; i++) {
      r.step(() => moveObject(r.doc, id, i, 0));
    }
    expect(undosAvailable(r.undo)).toBe(UNDO_MAX_STEPS - 1);

    r.step(() => moveObject(r.doc, id, UNDO_MAX_STEPS, 0));
    expect(undosAvailable(r.undo)).toBe(UNDO_MAX_STEPS);

    // Nothing was dropped: undoing every step walks all the way back to where
    // the note started.
    let steps = 0;
    while (r.undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(r.note(id).x).toBeCloseTo(start.x, 6);
    expect(r.note(id).y).toBeCloseTo(start.y, 6);
  });

  it('TC-11 a reloaded page starts with an empty history (undo.session_only)', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    r.step(() => moveObject(r.doc, id, 123, 45));
    expect(r.undo.canUndo()).toBe(true);

    r.undo.destroy();
    const reloaded = createUndo(r.doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    // The board itself still holds the change.
    expect(r.note(id).x).toBeCloseTo(123, 6);
  });

  it('a boundary on an empty history does nothing', () => {
    const r = rig();
    expect(() => {
      for (let i = 0; i < 3; i++) r.undo.boundary();
    }).not.toThrow();
    expect(r.undo.canUndo()).toBe(false);

    seed(r, { x: 0, y: 0 });
    expect(r.undo.canUndo()).toBe(true);
    expect(r.undo.undo()).toBe(true);
    expect(r.ids()).toEqual([]);
  });

  it('onChange fires when the stacks change and stops when unsubscribed', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    const changes = vi.fn();
    const off = r.undo.onChange(changes);

    r.step(() => moveObject(r.doc, id, 10, 10));
    expect(changes).toHaveBeenCalledTimes(1);

    r.undo.undo();
    expect(changes.mock.calls.length).toBeGreaterThan(1);

    r.undo.redo();
    const settled = changes.mock.calls.length;
    expect(settled).toBeGreaterThan(1);

    off();
    r.step(() => moveObject(r.doc, id, 20, 20));
    expect(changes).toHaveBeenCalledTimes(settled);
  });

  it('addScope brings another shared type into the same history', () => {
    const r = rig();
    const comments = r.doc.getMap<unknown>('comments');
    // Outside the scope: a local change here is not a step yet.
    r.doc.transact(() => comments.set('c1', 'first'), LOCAL_ORIGIN);
    expect(r.undo.canUndo()).toBe(false);

    r.undo.addScope(comments);
    r.doc.transact(() => comments.set('c2', 'later'), LOCAL_ORIGIN);
    expect(r.undo.canUndo()).toBe(true);
    expect(r.undo.undo()).toBe(true);
    expect(comments.get('c2')).toBeUndefined();
    expect(comments.get('c1')).toBe('first');
  });

  it('an undo is written as an ordinary change, not as a local one', () => {
    const r = rig();
    const id = seed(r, { x: 0, y: 0 });
    r.step(() => moveObject(r.doc, id, 5, 5));

    const origins: unknown[] = [];
    r.doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    expect(r.undo.undo()).toBe(true);

    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((origin) => origin !== LOCAL_ORIGIN)).toBe(true);
    // The colleague sees both the move and its reversal.
    expect(snapshot(r.peer.peer)[0].x).toBeCloseTo(-100, 6);
  });

  it('LOAD_ORIGIN and LOCAL_ORIGIN are different things to the model', () => {
    expect(LOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});
