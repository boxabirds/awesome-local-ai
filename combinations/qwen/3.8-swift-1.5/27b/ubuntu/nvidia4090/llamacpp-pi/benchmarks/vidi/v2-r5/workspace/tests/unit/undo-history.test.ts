// tests/unit/undo-history.test.ts
// TC-01 to TC-11: per-user undo history controller over real Y.Docs.
//
// Each logical action is wrapped in boundary() calls, mirroring how the app
// wraps gestures/actions (create, nudge, delete, colour) so that each is a
// distinct undo step.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  deleteObjects,
  getStickyText,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { createPeer } from './peer';

describe('undo.history (unit)', () => {
  let doc: Y.Doc;
  let undo: ReturnType<typeof createUndo>;
  let peer: ReturnType<typeof createPeer>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    undo = createUndo(doc);
    peer = createPeer(doc);
  });

  afterEach(() => {
    peer.destroy();
    undo.destroy();
    doc.destroy();
  });

  // Create a note as one boundary-wrapped step (like the app does)
  function myNote(x: number, y: number): string {
    undo.boundary();
    const id = createSticky(doc, { x, y });
    undo.boundary();
    return id;
  }

  // TC-01: local move X; peer creates Y, recolours Z; undo → X restored,
  // Y exists, Z keeps peer colour (remote changes are never reversed)
  it('TC-01: undo reverses only my change; peer create + recolour stay intact', () => {
    const a = myNote(0, 0);
    const z = myNote(100, 0);
    const start = snapshot(doc).find(s => s.id === a)!;

    // Local: move A (one step)
    undo.boundary();
    moveObject(doc, a, start.x + 50, start.y + 60);
    undo.boundary();
    // Peer: create Y and recolour Z (remote, never captured)
    const y = createSticky(peer.doc, { x: 200, y: 0 });
    setStickyColor(peer.doc, z, 'pink');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    const snap = snapshot(doc);
    const aAfter = snap.find(s => s.id === a)!;
    expect(aAfter.x).toBe(start.x);
    expect(aAfter.y).toBe(start.y);
    // Y still exists
    expect(snap.find(s => s.id === y)).toBeDefined();
    // Z keeps the peer's colour
    expect(snap.find(s => s.id === z)!.color).toBe('pink');
  });

  // TC-02: only peer changes → canUndo false (remote updates not captured)
  it('TC-02: peer-only changes do not enter my history', () => {
    const a = createSticky(peer.doc, { x: 0, y: 0 });
    setStickyColor(peer.doc, a, 'blue');
    moveObject(peer.doc, a, 10, 10);

    expect(undo.canUndo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  // TC-03: LOAD-origin updates → canUndo false (load is not undoable)
  it('TC-03: story 4 load updates do not enter my history', () => {
    const a = createSticky(peer.doc, { x: 0, y: 0 });
    setStickyColor(peer.doc, a, 'orange');
    // Simulate a board load applying further state with the LOAD origin
    peer.load(() => {
      const obj = doc.getMap('objects').get(a) as Y.Map<unknown> | undefined;
      if (obj) obj.set('color', 'violet');
    });

    expect(undo.canUndo()).toBe(false);
    expect(undo.redo()).toBe(false);
    // The loaded objects are present with the loaded colour
    expect(snapshot(doc).find(s => s.id === a)!.color).toBe('violet');
  });

  // TC-04: delete 8 notes, undo → all 8 restored with text, colour, size, position
  it('TC-04: one delete of 8 notes is one undo step; full content restored', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(myNote(i * 10, i * 10));
    }
    // Vary text, colours, sizes (each its own step)
    undo.boundary();
    getStickyText(doc, ids[0])!.insert(0, 'hello world');
    undo.boundary();
    setStickyColor(doc, ids[1], 'pink');
    undo.boundary();
    resizeObjects(doc, new Map([[ids[2], { x: 20, y: 20, width: 300, height: 150 }]]));
    undo.boundary();
    const before = snapshot(doc);

    // One delete of all 8 (one step)
    undo.boundary();
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);

    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      const a = after.find(s => s.id === b.id)!;
      expect(a).toBeDefined();
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.color).toBe(b.color);
      expect(a.text).toBe(b.text);
      expect(a.width).toBe(b.width);
      expect(a.height).toBe(b.height);
    }
    expect(getStickyText(doc, ids[0])!.toString()).toBe('hello world');
  });

  // TC-05: undo then redo → position re-applied
  it('TC-05: redo re-applies the undone move', () => {
    const a = myNote(0, 0);
    const start = snapshot(doc).find(s => s.id === a)!;
    undo.boundary();
    moveObject(doc, a, start.x + 70, start.y + 20);
    undo.boundary();

    undo.undo();
    expect(snapshot(doc).find(s => s.id === a)!.x).toBe(start.x);

    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    const after = snapshot(doc).find(s => s.id === a)!;
    expect(after.x).toBe(start.x + 70);
    expect(after.y).toBe(start.y + 20);
    expect(undo.canRedo()).toBe(false);
  });

  // TC-06: undo, then a new change → canRedo false (redo cleared)
  it('TC-06: a new change after undo clears the redo history', () => {
    const a = myNote(0, 0);
    const start = snapshot(doc).find(s => s.id === a)!;
    undo.boundary();
    moveObject(doc, a, start.x + 50, start.y);
    undo.boundary();
    setStickyColor(doc, a, 'green');
    undo.boundary();

    undo.undo(); // undo the colour change
    expect(undo.canRedo()).toBe(true);

    // New local change
    undo.boundary();
    setStickyColor(doc, a, 'blue');
    undo.boundary();
    expect(undo.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted,
  // next undo works (error path: inverse targets a deleted item).
  // The move's inverse is a no-op on the now-deleted note, so yjs's
  // popStackItem consumes it (and the create step) without throwing.
  it('TC-07: undo of a move whose target was deleted remotely has no effect', () => {
    const a = myNote(0, 0);
    const start = snapshot(doc).find(s => s.id === a)!;
    undo.boundary();
    moveObject(doc, a, start.x + 10, start.y + 10); // my step: move A
    undo.boundary();
    deleteObject(peer.doc, a);                       // peer deletes A

    // Undo the move: no throw, A remains deleted (remote deletion stands)
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc).find(s => s.id === a)).toBeUndefined();
    // The ineffective move undo also consumed the create step; stack exhausted
    expect(undo.canUndo()).toBe(false);
  });

  // TC-08: peer edits note text, then I delete; undo → restored with content
  // at the time of my delete
  it('TC-08: undoing my delete restores content as of the delete', () => {
    const a = createSticky(peer.doc, { x: 0, y: 0 });
    // Peer edits the text (remote, not in my history)
    getStickyText(peer.doc, a)!.insert(0, 'peer thoughts');
    // I delete the note (one step)
    undo.boundary();
    deleteObject(doc, a);
    undo.boundary();
    expect(snapshot(doc).find(s => s.id === a)).toBeUndefined();

    expect(undo.undo()).toBe(true);
    const restored = snapshot(doc).find(s => s.id === a);
    expect(restored).toBeDefined();
    expect(restored!.text).toBe('peer thoughts');
    expect(getStickyText(doc, a)!.toString()).toBe('peer thoughts');
  });

  // TC-09: at UNDO_MAX_STEPS, add 1 → length stays UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history trims the oldest step beyond UNDO_MAX_STEPS', () => {
    const undoLimited = createUndo(doc, { maxSteps: 5 });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      undoLimited.boundary();
      ids.push(createSticky(doc, { x: i, y: 0 }));
    }
    // 6 steps captured, oldest trimmed → 5 steps
    let undone = 0;
    while (undoLimited.undo()) undone++;
    expect(undone).toBe(5);
    // The oldest note (ids[0]) survived; the other 5 were undone
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(ids[0]);
    undoLimited.destroy();
  });

  it('TC-09 (default max): UNDO_MAX_STEPS + 1 steps → oldest dropped', () => {
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      undo.boundary();
      ids.push(createSticky(doc, { x: i, y: 0 }));
    }
    // Undo UNDO_MAX_STEPS times: the most recent 200 creations are undone,
    // the oldest one survives (it was trimmed from the history)
    let undone = 0;
    while (undo.undo()) undone++;
    expect(undone).toBe(UNDO_MAX_STEPS);
    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(ids[0]);
  });

  // TC-10: at UNDO_MAX_STEPS − 1, add 1 → length UNDO_MAX_STEPS, nothing dropped
  it('TC-10: at UNDO_MAX_STEPS − 1, one more step keeps everything', () => {
    const undoLimited = createUndo(doc, { maxSteps: 5 });
    for (let i = 0; i < 5; i++) {
      undoLimited.boundary();
      createSticky(doc, { x: i, y: 0 });
    }
    // Exactly 5 steps: all of them undoable
    let undone = 0;
    while (undoLimited.undo()) undone++;
    expect(undone).toBe(5);
    expect(snapshot(doc)).toHaveLength(0);
    undoLimited.destroy();
  });

  it('TC-10 (default max): UNDO_MAX_STEPS steps → nothing dropped', () => {
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      undo.boundary();
      createSticky(doc, { x: i, y: 0 });
    }
    let undone = 0;
    while (undo.undo()) undone++;
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-11: destroy controller and create a new one (reload) → canUndo false
  it('TC-11: history does not survive a fresh controller (session only)', () => {
    myNote(0, 0);
    myNote(100, 0);
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    fresh.destroy();
  });
});
