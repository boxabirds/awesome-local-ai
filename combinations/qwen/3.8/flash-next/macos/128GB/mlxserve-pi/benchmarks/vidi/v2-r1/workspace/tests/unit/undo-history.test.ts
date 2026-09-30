// Per-person undo history over real `Y.Doc`s (`undo.history`, TC-01 to TC-11).
//
// The whole contract is here: only this tab's own transactions are captured, a
// remote or load change is never undone, undo/redo re-apply and clear as the PRD
// says, an inverse aimed at something a colleague deleted does nothing and throws
// nothing, the stack is capped at `UNDO_MAX_STEPS`, and a fresh controller after a
// reload starts empty. A second real document is the remote peer (helpers/peer).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObjects,
  objectBounds,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import {
  UNDO_MAX_STEPS,
} from '../../src/shared/config';
import { createPeer, type Peer } from './peer';

/** A board of notes created before any controller exists, so none is undoable. */
function boardWith(ids: string[]): { doc: Y.Doc; peer: Peer } {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = createPeer(doc);
  // Baseline notes: the peer mirrors them, and no controller is watching yet.
  ids.forEach((_, index) => {
    createSticky(doc, { x: index * 400, y: 0 });
  });
  return { doc, peer };
}

const noteIds = (doc: Y.Doc): string[] => snapshot(doc).map((note) => note.id);
const boxOf = (doc: Y.Doc, id: string) =>
  objectBounds(snapshot(doc).find((note) => note.id === id)!);
const colorOf = (doc: Y.Doc, id: string): string =>
  snapshot(doc).find((note) => note.id === id)!.color;

describe('undo.history (per-person stacks over a real document)', () => {
  // TC-01: undoing my move must not reverse what a colleague did meanwhile.
  it('TC-01 undoes my move and leaves the peer create and recolour intact', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = createPeer(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const c = createSticky(doc, { x: 1000, y: 0 });
    const undo = createUndo(doc);

    // My move of A, closed as its own step.
    undo.boundary();
    const before = boxOf(doc, a);
    moveObjects(doc, new Map([[a, { x: before.x + 300, y: before.y + 200 }]]));
    undo.boundary();

    // A colleague creates a note and recolours C after me.
    let created = '';
    peer.remote((p) => {
      created = createSticky(p, { x: 0, y: 900 });
      setStickyColor(p, c, 'blue');
    });

    expect(undo.undo()).toBe(true);

    expect(boxOf(doc, a).x).toBe(before.x);
    expect(boxOf(doc, a).y).toBe(before.y);
    // Their new note is still there and their colour on C is untouched.
    expect(noteIds(doc)).toContain(created);
    expect(colorOf(doc, c)).toBe('blue');
    // And undoing did not undo their work: C stayed where it was created.
    expect(boxOf(doc, c).x).toBe(900);
    peer.destroy();
  });

  // TC-02: changes that are not mine are never offered for undo.
  it('TC-02 reports nothing to undo when only the peer changed the board', () => {
    const { doc, peer } = boardWith(['x', 'y']);
    const undo = createUndo(doc);
    const existing = noteIds(doc)[0]!;
    peer.remote((p) => {
      setStickyColor(p, existing, 'green');
      createSticky(p, { x: 0, y: 500 });
    });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    peer.destroy();
  });

  // TC-03: story 4 load-origin updates are never offered for undo either.
  it('TC-03 does not track updates applied under the load origin', () => {
    const { doc, peer } = boardWith(['x']);
    const undo = createUndo(doc);
    // A note arriving as though read out of storage: LOAD_ORIGIN, untracked.
    peer.load((p) => {
      createSticky(p, { x: 0, y: 600 });
    });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    peer.destroy();
  });

  // TC-04: an accidental delete of a cluster comes back whole.
  it('TC-04 restores eight deleted notes with text, colour, size and position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) ids.push(createSticky(doc, { x: index * 260, y: 0 }, 'orange'));
    // Give them text and a resize, before the controller exists.
    getStickyText(doc, ids[0]!)?.insert(0, 'hello');
    const undo = createUndo(doc);

    const before = ids.map((id) => boxOf(doc, id));
    const colorBefore = ids.map((id) => colorOf(doc, id));
    const textBefore = getStickyText(doc, ids[0]!)!.toString();

    undo.boundary();
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    ids.forEach((id, index) => {
      const box = boxOf(doc, id);
      expect(box.x).toBe(before[index]!.x);
      expect(box.y).toBe(before[index]!.y);
      expect(colorOf(doc, id)).toBe(colorBefore[index]);
    });
    expect(getStickyText(doc, ids[0]!)!.toString()).toBe(textBefore);
  });

  // TC-05: undo then redo re-applies the move.
  it('TC-05 redoes the move that was just undone', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const undo = createUndo(doc);

    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 123, y: 456 }]]));
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(boxOf(doc, a).x).toBe(-100);
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(boxOf(doc, a).x).toBe(123);
    expect(boxOf(doc, a).y).toBe(456);
  });

  // TC-06: a new change after undoing discards redo.
  it('TC-06 clears redo when a new change follows an undo', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1000, y: 0 });
    const undo = createUndo(doc);

    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 50, y: 50 }]]));
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    // A fresh change wipes redo.
    undo.boundary();
    setStickyColor(doc, b, 'pink');
    undo.boundary();
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  // TC-07: undoing a move of something a colleague deleted is safe and harmless.
  it('TC-07 undoes a move whose target a peer deleted without error, history usable', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = createPeer(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 1000, y: 0 });
    const undo = createUndo(doc);

    // A step that will still work later: move B.
    undo.boundary();
    const bBefore = boxOf(doc, b);
    moveObjects(doc, new Map([[b, { x: bBefore.x + 77, y: bBefore.y + 11 }]]));
    undo.boundary();

    // Then move A, and a colleague deletes A.
    undo.boundary();
    const aBefore = boxOf(doc, a);
    moveObjects(doc, new Map([[a, { x: aBefore.x + 210, y: aBefore.y }]]));
    undo.boundary();
    peer.remote((p) => deleteObjects(p, [a]));

    // Undoing the move of the now-deleted A: nothing visible, no throw.
    expect(() => undo.undo()).not.toThrow();
    const aAfterFirstUndo = noteIds(doc).includes(a);
    expect(aAfterFirstUndo).toBe(false);

    // The rest of the history still works: keep undoing until it does something.
    let sawEffect = false;
    for (let i = 0; i < 4 && !sawEffect; i += 1) sawEffect = undo.undo();
    // B eventually returns to where it started.
    expect(boxOf(doc, b).x).toBe(bBefore.x);
    peer.destroy();
  });

  // TC-08: undoing my delete restores the content a colleague typed by the time I deleted.
  it('TC-08 restores my deleted note with the peer edits that were present when I deleted', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = createPeer(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const undo = createUndo(doc);

    // A colleague types into the note while I watch.
    peer.remote((p) => getStickyText(p, a)?.insert(0, 'peer said'));
    // Then I delete it.
    undo.boundary();
    deleteObjects(doc, [a]);
    undo.boundary();
    expect(noteIds(doc)).not.toContain(a);

    expect(undo.undo()).toBe(true);
    expect(noteIds(doc)).toContain(a);
    expect(getStickyText(doc, a)?.toString()).toBe('peer said');
    peer.destroy();
  });

  // TC-09: adding past the limit drops the oldest and holds the length.
  it('TC-09 holds UNDO_MAX_STEPS and drops the oldest when a new step is added at the limit', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    const made: string[] = [];
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      undo.boundary();
      made.push(createSticky(doc, { x: index * 30, y: 0 }));
      undo.boundary();
    }
    expect(undo.canUndo()).toBe(true);

    // One more step at the limit pushes the very first one out.
    undo.boundary();
    createSticky(doc, { x: 999_999, y: 0 });
    undo.boundary();

    // Undo everything still held: exactly UNDO_MAX_STEPS steps, and the first
    // note survives because the step that created it was the oldest and dropped.
    let count = 0;
    while (undo.undo()) count += 1;
    expect(count).toBe(UNDO_MAX_STEPS);
    expect(noteIds(doc)).toContain(made[0]!);
    expect(noteIds(doc)).not.toContain(made[1]!);
  });

  // TC-10: adding the step that first reaches the limit drops nothing.
  it('TC-10 reaches UNDO_MAX_STEPS from below without dropping anything', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    for (let index = 0; index < UNDO_MAX_STEPS - 1; index += 1) {
      undo.boundary();
      createSticky(doc, { x: index * 30, y: 0 });
      undo.boundary();
    }
    undo.boundary();
    createSticky(doc, { x: 999_999, y: 0 });
    undo.boundary();

    // All UNDO_MAX_STEPS steps are held: undoing empties the whole board.
    let count = 0;
    while (undo.undo()) count += 1;
    expect(count).toBe(UNDO_MAX_STEPS);
    expect(noteIds(doc)).toHaveLength(0);
  });

  // TC-11: a fresh controller over the same document (a reload) starts empty.
  it('TC-11 starts empty after the controller is destroyed and a new one made', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const first = createUndo(doc);
    first.boundary();
    moveObjects(doc, new Map([[a, { x: 30, y: 30 }]]));
    first.boundary();
    expect(first.canUndo()).toBe(true);

    first.destroy();
    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
  });

  // onChange fires on stack changes and unsubscribes cleanly.
  it('notifies subscribers when the stacks change and stops after unsubscribe', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const undo: UndoController = createUndo(doc);
    let calls = 0;
    const off = undo.onChange(() => {
      calls += 1;
    });
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 10, y: 10 }]]));
    undo.boundary();
    const afterChange = calls;
    expect(afterChange).toBeGreaterThan(0);
    off();
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 20, y: 20 }]]));
    undo.boundary();
    expect(calls).toBe(afterChange);
  });
});
