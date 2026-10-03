// undo.history — per-user undo/redo controller (unit).
//
// Everything here is origin + step semantics over real `Y.Doc`s. A simulated peer
// (a second real doc whose updates are applied locally with a non-local origin)
// proves undo reverses only *this* tab's changes and never a colleague's, and
// that load / remote updates never enter the stacks. UndoManager's own behaviour
// (no throw / no effect on a remotely-deleted target; restoring my own delete with
// its content) is exercised directly.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import {
  createPeer,
  peerCreateSticky,
  type Peer,
} from './helpers/peer';

/** A board doc seeded with `n` notes at spread-out positions. */
function setup(n = 3): { doc: Y.Doc; ids: string[]; peer: Peer } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(createSticky(doc, { x: i * 400, y: 0 }));
  const peer = createPeer(doc);
  return { doc, ids, peer };
}

function bounds(doc: Y.Doc, id: string) {
  const o = snapshot(doc).find((s) => s.id === id)!;
  return { x: o.x, y: o.y };
}

describe('undo.history (unit)', () => {
  // TC-01: undo reverses only MY change; the peer's create + recolour survive.
  it('TC-01 undoes my move and leaves the peer\'s create and recolour intact', () => {
    const { doc, ids, peer } = setup(2);
    const [X, Z] = ids as [string, string];
    const um = createUndo(doc);

    const start = bounds(doc, X);
    moveObject(doc, X, start.x + 500, start.y); // my change (LOCAL_ORIGIN)

    // Peer creates note Y and recolours Z, applied with a non-local origin.
    peer.syncLocalToPeer();
    peer.edit((p) => {
      peerCreateSticky(p, 'Y', 10, 10, { color: 'green' });
      const z = p.getMap<Y.Map<unknown>>('objects').get(Z)!;
      z.set('color', 'blue');
    });

    expect(um.canUndo()).toBe(true);
    expect(um.undo()).toBe(true);

    // My move reversed.
    expect(bounds(doc, X)).toEqual(start);
    // The peer's note Y still exists ...
    expect(snapshot(doc).some((s) => s.id === 'Y')).toBe(true);
    // ... and Z keeps the peer's colour (undo did NOT revert it).
    const z = snapshot(doc).find((s) => s.id === Z)!;
    expect(z.color).toBe('blue');
    expect(z.color).not.toBe('yellow');
    um.destroy();
  });

  // TC-02: only peer changes happen → nothing to undo.
  it('TC-02 does not capture a remote-only change (canUndo false)', () => {
    const { doc, peer } = setup(1);
    const um = createUndo(doc);

    peer.edit((p) => {
      peerCreateSticky(p, 'R', 999, 999);
    });

    expect(um.canUndo()).toBe(false);
    expect(um.undo()).toBe(false);
    expect(snapshot(doc).some((s) => s.id === 'R')).toBe(true); // change still applied
    um.destroy();
  });

  // TC-03: LOAD-origin updates (board loaded under me) are not undoable.
  it('TC-03 does not capture load-origin updates (canUndo false)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const um = createUndo(doc);
    const peer = createPeer(doc);

    // Simulate the story-4 load: content arrives with the load origin.
    peer.applyAsLoad((p) => {
      peerCreateSticky(p, 'L1', 0, 0);
      peerCreateSticky(p, 'L2', 500, 0);
    });

    expect(um.canUndo()).toBe(false);
    expect(um.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2); // the board is loaded, just not undoable
    um.destroy();
  });

  // TC-04: delete 8 notes, undo restores them with text, colour, size, position.
  it('TC-04 restores all eight deleted notes with text, colour, size and position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const um = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 300, y: 40 }, 'pink');
      getStickyText(doc, id)?.insert(0, `note-${i}`);
      ids.push(id);
    }
    const before = new Map(
      snapshot(doc).map((s) => [s.id, { x: s.x, y: s.y, color: s.color, text: s.text }]),
    );

    um.boundary(); // the eight creations are their own step; the delete below is another
    deleteObjects(doc, ids); // one delete action of 8 notes
    expect(snapshot(doc)).toHaveLength(0);
    expect(um.canUndo()).toBe(true);
    expect(um.undo()).toBe(true);

    expect(snapshot(doc)).toHaveLength(8);
    for (const s of snapshot(doc)) {
      const b = before.get(s.id)!;
      expect(s.x).toBe(b.x);
      expect(s.y).toBe(b.y);
      expect(s.color).toBe(b.color);
      expect(s.text).toBe(b.text);
    }
    um.destroy();
  });

  // TC-05: undo then redo re-applies the move.
  it('TC-05 redoes a move that was undone', () => {
    const { doc, ids } = setup(1);
    const [A] = ids as [string];
    const um = createUndo(doc);
    const start = bounds(doc, A);

    moveObject(doc, A, start.x + 250, start.y);
    um.undo();
    expect(bounds(doc, A)).toEqual(start);
    expect(um.canRedo()).toBe(true);

    um.redo();
    expect(bounds(doc, A)).toEqual({ x: start.x + 250, y: start.y });
    um.destroy();
  });

  // TC-06: a new change after an undo clears redo.
  it('TC-06 clears the redo stack when a new change is made', () => {
    const { doc, ids } = setup(1);
    const [A] = ids as [string];
    const um = createUndo(doc);
    const start = bounds(doc, A);

    moveObject(doc, A, start.x + 100, start.y);
    um.boundary();
    um.undo();
    expect(um.canRedo()).toBe(true);

    // A new, unrelated change (recolour) discards the redo stack.
    setStickyColor(doc, A, 'blue');
    expect(um.canRedo()).toBe(false);
    expect(um.redo()).toBe(false);
    um.destroy();
  });

  // TC-07: my move, then a peer deletes the object, then I undo → no throw, object
  // stays deleted, and the next undo still works.
  it('TC-07 tolerates undoing a move of an object a peer deleted', () => {
    const { doc, ids, peer } = setup(2);
    const [X, Z] = ids as [string, string];
    const um = createUndo(doc);

    // My own change to Z, then my own move of X — two separate steps.
    setStickyColor(doc, Z, 'green');
    um.boundary();
    moveObject(doc, X, 1234, 1234);
    um.boundary();
    // Peer deletes X, so my move now targets a deleted object.
    peer.syncLocalToPeer();
    peer.edit((p) => {
      p.getMap<Y.Map<unknown>>('objects').delete(X);
    });
    expect(snapshot(doc).some((s) => s.id === X)).toBe(false);
    expect(um.canUndo()).toBe(true);

    // Undoing my move of the now-deleted object must not throw and must not
    // resurrect X with content I never deleted.
    let threw = false;
    try {
      um.undo();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(snapshot(doc).some((s) => s.id === X)).toBe(false); // stays deleted

    // Undo.safe error path: continuing to undo never throws and never invents X.
    for (let i = 0; i < 3; i++) {
      expect(() => um.undo()).not.toThrow();
      expect(snapshot(doc).some((s) => s.id === X)).toBe(false);
    }
    um.destroy();
  });

  // TC-08: peer edits a note's text, I delete it, undo restores content at delete.
  it('TC-08 restores my deleted note with the peer\'s latest text', () => {
    const { doc, ids, peer } = setup(1);
    const [C] = ids as [string];
    const um = createUndo(doc);

    // Peer types into the note first.
    peer.syncLocalToPeer();
    peer.edit((p) => {
      const note = p.getMap<Y.Map<unknown>>('objects').get(C)!;
      (note.get('text') as Y.Text).insert(0, 'from-peer');
    });
    expect(getStickyText(doc, C)?.toString()).toBe('from-peer');

    // I delete it.
    deleteObjects(doc, [C]);
    expect(snapshot(doc).some((s) => s.id === C)).toBe(false);

    um.undo();
    const restored = snapshot(doc).find((s) => s.id === C);
    expect(restored).toBeDefined();
    // Restored with the content that existed at the moment I deleted it.
    expect(restored!.text).toBe('from-peer');
    um.destroy();
  });

  // TC-09: adding a step beyond UNDO_MAX_STEPS keeps exactly that many and drops the
  // oldest.
  it('TC-09 trims the oldest step at the UNDO_MAX_STEPS boundary', () => {
    const { doc } = setup(0);
    const um = createUndo(doc);

    const ids: string[] = [];
    for (let i = 0; i <= UNDO_MAX_STEPS; i++) {
      const id = createSticky(doc, { x: i, y: 0 });
      ids.push(id);
      um.boundary(); // each creation its own step
    }

    // One step too many was added; the stack holds exactly UNDO_MAX_STEPS.
    // Undo UNDO_MAX_STEPS times: everything but the first (dropped) note reverses.
    let undone = 0;
    for (let i = 0; i < UNDO_MAX_STEPS + 5 && um.canUndo(); i++) {
      if (um.undo()) undone += 1;
      else break;
    }
    expect(undone).toBe(UNDO_MAX_STEPS);
    // The oldest creation could not be undone (it was dropped): the first note remains.
    expect(snapshot(doc).some((s) => s.id === ids[0])).toBe(true);
    // The most recent one was undone.
    expect(snapshot(doc).some((s) => s.id === ids[ids.length - 1])).toBe(false);
    um.destroy();
  });

  // TC-10: at UNDO_MAX_STEPS − 1, adding one fills to exactly the limit, nothing dropped.
  it('TC-10 fills to the limit without dropping at UNDO_MAX_STEPS − 1', () => {
    const { doc } = setup(0);
    const um = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      ids.push(createSticky(doc, { x: i, y: 0 }));
      um.boundary();
    }
    // One more lands exactly at the limit.
    ids.push(createSticky(doc, { x: 999999, y: 0 }));
    um.boundary();

    let undone = 0;
    for (let i = 0; um.canUndo(); i++) if (um.undo()) undone += 1; else break;
    expect(undone).toBe(UNDO_MAX_STEPS); // nothing dropped: the first is still there
    // Undoing all of them empties the board.
    expect(snapshot(doc)).toHaveLength(0);
    um.destroy();
  });

  // TC-11: destroy then a fresh controller (a page reload) starts with nothing to undo.
  it('TC-11 starts empty after the controller is destroyed (session only)', () => {
    const { doc, ids } = setup(1);
    const [A] = ids as [string];
    const first = createUndo(doc);
    moveObject(doc, A, 777, 777);
    expect(first.canUndo()).toBe(true);

    first.destroy();
    const reloaded = createUndo(doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    reloaded.destroy();
  });

  // onChange fires when the stacks change and unsubscribe stops it.
  it('onChange notifies on capture and can be unsubscribed', () => {
    const { doc, ids } = setup(1);
    const [A] = ids as [string];
    const um = createUndo(doc);
    const cb = vi.fn();
    const off = um.onChange(cb);

    moveObject(doc, A, 10, 10);
    expect(cb).toHaveBeenCalled();

    cb.mockClear();
    off();
    moveObject(doc, A, 20, 20);
    expect(cb).not.toHaveBeenCalled();
    um.destroy();
  });
});
