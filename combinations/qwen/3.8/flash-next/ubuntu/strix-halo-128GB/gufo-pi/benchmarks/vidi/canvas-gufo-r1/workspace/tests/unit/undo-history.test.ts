/**
 * Unit tests for undo.history contract (TC-01 to TC-11).
 * Uses real Y.Docs with simulated remote peers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  moveObjects,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import { createPeer, applyWithLoadOrigin, REMOTE_ORIGIN } from './undo-peer';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

describe('undo.history', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc);
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  // TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour
  it('TC-01: undo only own move; peer changes remain', () => {
    // Create notes A, B, C locally
    const idA = createSticky(doc, { x: 100, y: 100 });
    createSticky(doc, { x: 200, y: 200 });
    const idC = createSticky(doc, { x: 300, y: 300 });
    controller.boundary();

    // Record A's original position
    const origA = objectsMap(doc).get(idA)!;
    const origAx = origA.get('x') as number;
    const origAy = origA.get('y') as number;

    // Local move A
    moveObjects(doc, new Map([[idA, { x: 500, y: 500 }]]));
    controller.boundary();

    // Peer creates Y (a new note D) and recolours Z (note C)
    const peer = createPeer(doc);
    // Peer adds a new note
    peer.doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', 400);
      obj.set('y', 400);
      obj.set('color', 'green');
      obj.set('text', new Y.Text(''));
      obj.set('z', 10);
      obj.set('createdAt', Date.now());
      objectsMap(peer.doc).set('noteD', obj);
    }, REMOTE_ORIGIN);
    // Peer recolours C
    const objC = objectsMap(peer.doc).get(idC);
    if (objC) {
      peer.doc.transact(() => {
        objC.set('color', 'blue');
      }, REMOTE_ORIGIN);
    }
    peer.syncTo();

    // Undo: A should return to original, D should exist, C keeps 'blue'
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const snap = snapshot(doc);
    const noteA = snap.find((n) => n.id === idA);
    const noteD = snap.find((n) => n.id === 'noteD');
    const noteC = snap.find((n) => n.id === idC);

    expect(noteA!.x).toBe(origAx);
    expect(noteA!.y).toBe(origAy);
    expect(noteD).toBeDefined();
    expect(noteC!.color).toBe('blue');

    peer.destroy();
  });

  // TC-02: only peer changes → canUndo false
  it('TC-02: remote-only changes are not tracked; canUndo is false', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    // Peer makes changes
    const peer = createPeer(doc);
    peer.doc.transact(() => {
      const obj = objectsMap(peer.doc).get(idA);
      if (obj) obj.set('x', 999);
    }, REMOTE_ORIGIN);
    peer.syncTo();

    // canUndo should be false because the undo stack only has the initial creation step
    // Wait, actually createSticky was done locally, so it IS in the stack.
    // Let me reconsider: we need a case where ONLY remote changes happen.
    // Let's create the initial notes with a different origin to avoid that.
    controller.destroy();
    doc.destroy();

    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc);

    // Peer creates a note
    const peer2 = createPeer(doc);
    peer2.doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', 100);
      obj.set('y', 100);
      obj.set('color', 'yellow');
      obj.set('text', new Y.Text(''));
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      objectsMap(peer2.doc).set('remoteNote', obj);
    }, REMOTE_ORIGIN);
    peer2.syncTo();

    expect(controller.canUndo()).toBe(false);
    peer2.destroy();
  });

  // TC-03: LOAD-origin updates → canUndo false
  it('TC-03: load-origin updates are not tracked; canUndo is false', () => {
    // Create an update externally
    const sourceDoc = new Y.Doc();
    initDoc(sourceDoc);
    sourceDoc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', 100);
      obj.set('y', 100);
      obj.set('color', 'yellow');
      obj.set('text', new Y.Text(''));
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      objectsMap(sourceDoc).set('loadNote', obj);
    });
    const update = Y.encodeStateAsUpdate(sourceDoc);
    applyWithLoadOrigin(doc, update);

    expect(controller.canUndo()).toBe(false);
    sourceDoc.destroy();
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: undo restores deleted notes with all properties', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 50, y: i * 50 }, 'pink');
      ids.push(id);
      // Set some text
      const obj = objectsMap(doc).get(id)!;
      const ytext = obj.get('text') as Y.Text;
      doc.transact(() => { ytext.insert(0, `text${i}`); }, LOCAL_ORIGIN);
    }
    controller.boundary();

    // Delete all 8
    deleteObjects(doc, ids);
    controller.boundary();

    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const snap = snapshot(doc);
    for (let i = 0; i < 8; i++) {
      const note = snap.find((n) => n.id === ids[i]);
      expect(note).toBeDefined();
      expect(note!.x).toBe(i * 50 - 100); // createSticky centers: at.x - STICKY_SIZE_WORLD/2
      expect(note!.y).toBe(i * 50 - 100);
      expect(note!.color).toBe('pink');
      expect(note!.text).toBe(`text${i}`);
    }
  });

  // TC-05: undo then redo → re-applied
  it('TC-05: redo re-applies the undone change', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const origX = objectsMap(doc).get(idA)!.get('x') as number;

    // Move A
    moveObjects(doc, new Map([[idA, { x: 500, y: 500 }]]));
    controller.boundary();

    // Undo
    controller.undo();
    expect(objectsMap(doc).get(idA)!.get('x')).toBe(origX);
    expect(controller.canRedo()).toBe(true);

    // Redo
    controller.redo();
    expect(objectsMap(doc).get(idA)!.get('x')).toBe(500);
  });

  // TC-06: undo then new change → canRedo false
  it('TC-06: new change after undo clears redo', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    moveObjects(doc, new Map([[idA, { x: 500, y: 500 }]]));
    controller.boundary();

    controller.undo();
    expect(controller.canRedo()).toBe(true);

    // New change
    createSticky(doc, { x: 200, y: 200 });
    controller.boundary();

    expect(controller.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted, history continues
  it('TC-07: undo move of remotely deleted object does not throw', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    createSticky(doc, { x: 200, y: 200 });
    controller.boundary();

    // Move A
    moveObjects(doc, new Map([[idA, { x: 500, y: 500 }]]));
    controller.boundary();

    // Peer deletes A
    const peer = createPeer(doc);
    peer.doc.transact(() => {
      objectsMap(peer.doc).delete(idA);
    }, REMOTE_ORIGIN);
    peer.syncTo();

    // Undo move → should not throw, A stays deleted.
    // Yjs transparently skips the no-op and applies the next effective step.
    expect(() => controller.undo()).not.toThrow();
    const snap = snapshot(doc);
    expect(snap.find((n) => n.id === idA)).toBeUndefined();

    // History remains usable: can undo/redo without errors
    expect(() => controller.redo()).not.toThrow();

    peer.destroy();
  });

  // TC-08: peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo delete restores content as of time of delete', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    // Peer edits text
    const peer = createPeer(doc);
    const objA = objectsMap(peer.doc).get(idA)!;
    const ytext = objA.get('text') as Y.Text;
    peer.doc.transact(() => {
      ytext.insert(0, 'peer text');
    }, REMOTE_ORIGIN);
    peer.syncTo();

    // Verify local text shows peer edit
    expect((objectsMap(doc).get(idA)!.get('text') as Y.Text).toString()).toBe('peer text');
    controller.boundary();

    // Local delete
    deleteObjects(doc, [idA]);
    controller.boundary();

    // Undo → restored with 'peer text'
    controller.undo();
    const restored = objectsMap(doc).get(idA);
    expect(restored).toBeDefined();
    expect((restored!.get('text') as Y.Text).toString()).toBe('peer text');

    peer.destroy();
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped
  it('TC-09: stack trimmed to UNDO_MAX_STEPS', () => {
    // Use a smaller maxSteps for faster test
    controller.destroy();
    doc.destroy();

    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { maxSteps: 5 });

    // Create 5 notes (each is one undo step)
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = createSticky(doc, { x: i * 50, y: i * 50 });
      ids.push(id);
      controller.boundary();
    }

    expect(controller.canUndo()).toBe(true);

    // Add 1 more
    createSticky(doc, { x: 999, y: 999 });
    controller.boundary();

    // Can undo 5 times total (the first creation was dropped)
    let undoCount = 0;
    while (controller.undo()) undoCount++;
    expect(undoCount).toBe(5);

    // The first id (ids[0]) should have been dropped from history
    // so it should still exist after all undos
    const snap = snapshot(doc);
    expect(snap.find((n) => n.id === ids[0])).toBeDefined();
  });

  // TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped
  it('TC-10: at maxSteps-1 adding one more does not drop', () => {
    controller.destroy();
    doc.destroy();

    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { maxSteps: 5 });

    // Create 4 notes
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = createSticky(doc, { x: i * 50, y: i * 50 });
      ids.push(id);
      controller.boundary();
    }

    // Add 1 more to reach exactly 5
    createSticky(doc, { x: 4 * 50, y: 4 * 50 });
    controller.boundary();

    // Can undo 5 times
    let undoCount = 0;
    while (controller.undo()) undoCount++;
    expect(undoCount).toBe(5);

    // All notes should be gone after undoing all
    const snap = snapshot(doc);
    for (const id of ids) {
      expect(snap.find((n) => n.id === id)).toBeUndefined();
    }
  });

  // TC-11: destroy then new controller → canUndo false (session only)
  it('TC-11: new controller after destroy starts empty', () => {
    createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    expect(controller.canUndo()).toBe(true);

    controller.destroy();

    // Create a fresh controller (simulates page reload)
    controller = createUndo(doc);
    expect(controller.canUndo()).toBe(false);
  });
});
