// Story 8, undo.history unit tests (TC-01 to TC-11).
//
// Every test runs against a real Y.Doc and a simulated remote peer
// (tests/unit/peer.ts) — no mocks of yjs. The controller under test is the
// real `createUndo`, which tracks only LOCAL_ORIGIN, so the peer's changes
// (applied with PEER_ORIGIN) and story-4 LOAD updates never enter the
// personal history (undo.own).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  getStickyText,
  deleteObjects,
  resizeObjects,
  snapshot,
  objectsSnapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import {
  createPeer,
  applyLoadUpdate,
  fullStateUpdate,
  type Peer,
} from './peer';

function byId(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

/** Undo until the stack is empty; returns how many steps were consumed. */
function drainUndo(undo: UndoController): number {
  let n = 0;
  while (undo.undo()) n += 1;
  return n;
}

describe('undo.history (story 8)', () => {
  let doc: Y.Doc;
  let undo: UndoController;
  let peer: Peer;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    undo = createUndo(doc);
    peer = createPeer();
  });
  afterEach(() => {
    peer.destroy();
    undo.destroy();
    doc.destroy();
  });

  // TC-01: local move X; peer creates Y and recolours Z; undo → X restored,
  // Y present, Z keeps the peer colour (remote changes are never undone).
  it('TC-01: undo reverts only my change; peer changes survive', () => {
    const x = createSticky(doc, { x: 0, y: 0 });
    const z = createSticky(doc, { x: 300, y: 0 });
    expect(x).not.toBeNull();
    expect(z).not.toBeNull();
    const x0 = byId(doc, x!)!;
    const z0 = byId(doc, z!)!;
    undo.boundary();

    // My move.
    moveObject(doc, x!, x0.x + 120, x0.y + 40);

    // Peer learns the board, then creates Y and recolours Z.
    peer.sync(doc);
    const y = createSticky(peer.doc, { x: -500, y: 0 });
    setStickyColor(peer.doc, z!, 'blue');
    peer.pushToLocal(doc);

    expect(undo.canUndo()).toBe(true);

    undo.undo();

    // X is back exactly where it was.
    const xAfter = byId(doc, x!)!;
    expect(xAfter.x).toBe(x0.x);
    expect(xAfter.y).toBe(x0.y);
    // Y (peer-created) is present and untouched.
    expect(byId(doc, y!)).toBeDefined();
    // Z keeps the peer's colour (not reverted to my original).
    const zAfter = byId(doc, z!)!;
    expect(zAfter.color).toBe('blue');
    expect(z0.color).not.toBe('blue');
  });

  // TC-02: only peer changes → canUndo false (nothing of mine to undo).
  it('TC-02: peer-only changes leave canUndo false', () => {
    peer.sync(doc);
    createSticky(peer.doc, { x: 10, y: 10 });
    peer.pushToLocal(doc);
    expect(snapshot(doc).length).toBeGreaterThan(0);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-03: story-4 LOAD-origin updates are never undoable.
  it('TC-03: LOAD-origin updates are not captured', () => {
    const server = new Y.Doc();
    initDoc(server);
    createSticky(server, { x: 5, y: 5 });
    applyLoadUpdate(doc, fullStateUpdate(server));
    server.destroy();
    expect(snapshot(doc).length).toBe(1);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size,
  // position (the delete's inverse is a full restore).
  it('TC-04: undoing a delete restores text, colour, size and position', () => {
    const ids: string[] = [];
    const before: ObjectSnapshot[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = createSticky(doc, { x: i * 300, y: (i % 3) * 250 }, (
        ['yellow', 'blue', 'green', 'pink'] as const
      )[i % 4]);
      expect(id).not.toBeNull();
      getStickyText(doc, id!)?.insert(0, `note ${i} text`);
      if (i % 2 === 0) {
        // Give some notes an explicit (non-default) size.
        const b = objectsSnapshot(doc).find((o) => o.id === id)!;
        resizeObjects(doc, new Map([[id!, { x: b.x, y: b.y, width: 260, height: 260 }]]));
      }
      undo.boundary();
      ids.push(id!);
      before.push(objectsSnapshot(doc).find((o) => o.id === id)!);
    }
    undo.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc).length).toBe(0);

    expect(undo.undo()).toBe(true);

    const after = objectsSnapshot(doc);
    expect(after.length).toBe(8);
    for (let i = 0; i < 8; i += 1) {
      const restored = after.find((o) => o.id === ids[i])!;
      expect(restored).toBeDefined();
      expect(restored.text).toBe(before[i].text);
      expect(restored.color).toBe(before[i].color);
      expect(restored.x).toBe(before[i].x);
      expect(restored.y).toBe(before[i].y);
      expect(restored.z).toBe(before[i].z);
      expect(restored.width).toBe(before[i].width);
      expect(restored.height).toBe(before[i].height);
    }
  });

  // TC-05: undo then redo → the change is re-applied.
  it('TC-05: redo re-applies an undone change', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const start = byId(doc, id!)!;
    moveObject(doc, id!, 70, 90);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(byId(doc, id!)!.x).toBe(start.x);
    expect(byId(doc, id!)!.y).toBe(start.y);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(byId(doc, id!)!.x).toBe(70);
    expect(byId(doc, id!)!.y).toBe(90);
    expect(undo.canRedo()).toBe(false);
  });

  // TC-06: undo then a new local change → canRedo false (redo is cleared).
  it('TC-06: a new change after undo clears the redo stack', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    undo.boundary();
    moveObject(doc, a!, 10, 10);
    undo.boundary();

    undo.undo(); // undo the move
    expect(undo.canRedo()).toBe(true);

    moveObject(doc, b!, 5, 5); // a new local step
    undo.boundary();
    expect(undo.canRedo()).toBe(false);
  });

  // TC-07 (error path): local move, peer deletes the target, undo → no
  // throw, the note stays deleted, and the next undo still works.
  it('TC-07: undoing a move whose target the peer deleted is a no-op and the history continues', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const b = createSticky(doc, { x: 300, y: 0 });
    undo.boundary();
    moveObject(doc, a!, 50, 50); // my step on A
    undo.boundary();

    peer.sync(doc);
    deleteObjects(peer.doc, [a!]); // peer deletes A
    peer.pushToLocal(doc);
    expect(byId(doc, a!)).toBeUndefined();

    // The top step (move A) now targets a deleted object: the press must not
    // throw and must not resurrect A. Dead steps are skipped silently, so
    // the press instead undoes the next meaningful step (B's creation).
    expect(() => undo.undo()).not.toThrow();
    expect(byId(doc, a!)).toBeUndefined(); // still deleted
    expect(byId(doc, b!)).toBeUndefined(); // B's creation was undone

    // The history keeps working: the next press consumes A's (dead) creation
    // step without resurrecting A, then the stack is empty.
    expect(undo.undo()).toBe(true);
    expect(byId(doc, a!)).toBeUndefined();
    expect(undo.undo()).toBe(false);
  });

  // TC-08: peer edits note text, then I delete, undo → restored with the
  // content as it was at the time of the delete.
  it('TC-08: undoing my delete restores the peer-edited text', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, a!)?.insert(0, 'hello');
    undo.boundary();

    peer.sync(doc);
    // Peer appends " world" → "hello world".
    const peerText = getStickyText(peer.doc, a!);
    peerText?.insert(peerText.length, ' world');
    peer.pushToLocal(doc);
    expect(getStickyText(doc, a!)?.toString()).toBe('hello world');

    deleteObjects(doc, [a!]);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(byId(doc, a!)).toBeDefined();
    expect(getStickyText(doc, a!)?.toString()).toBe('hello world');
  });

  // TC-09: UNDO_MAX_STEPS + 1 steps → the stack holds UNDO_MAX_STEPS and the
  // oldest step is dropped.
  it('TC-09: the undo history is capped at UNDO_MAX_STEPS (oldest dropped)', () => {
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i += 1) {
      undo.boundary();
      const id = createSticky(doc, { x: i * 10, y: 0 });
      expect(id).not.toBeNull();
    }
    // Draining consumes exactly UNDO_MAX_STEPS steps: the oldest creation
    // was trimmed away and can no longer be undone.
    expect(drainUndo(undo)).toBe(UNDO_MAX_STEPS);
  });

  // TC-10 (boundary): UNDO_MAX_STEPS − 1 steps + 1 → nothing is dropped.
  it('TC-10: at exactly UNDO_MAX_STEPS steps nothing is dropped', () => {
    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) {
      undo.boundary();
      const id = createSticky(doc, { x: i * 10, y: 0 });
      expect(id).not.toBeNull();
    }
    expect(drainUndo(undo)).toBe(UNDO_MAX_STEPS);
  });

  // TC-11: destroy then a fresh controller on the same doc → canUndo false
  // (history is per session, not persisted).
  it('TC-11: a fresh controller after destroy starts empty (session only)', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const fresh = createUndo(doc);
    try {
      expect(fresh.canUndo()).toBe(false);
      expect(fresh.canRedo()).toBe(false);
    } finally {
      fresh.destroy();
    }
    void a;
  });
});
