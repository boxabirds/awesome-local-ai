import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import { LOCAL_ORIGIN, initDoc, createSticky, moveObject, deleteObjects, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';

const LOAD_ORIGIN = Symbol('load');
const REMOTE_ORIGIN = Symbol('remote');

/**
 * Simulated remote peer: a second real Y.Doc. Local LOCAL_ORIGIN updates flow
 * to the peer; peer mutations flow back to the local doc with REMOTE_ORIGIN.
 * An echo guard prevents re-propagation.
 */
function createPeer(localDoc: Y.Doc) {
  const peerDoc = new Y.Doc();

  // Pre-sync: transfer full current state (mimics SyncStep1/2 handshake)
  const fullState = Y.encodeStateAsUpdate(localDoc);
  Y.applyUpdate(peerDoc, fullState, REMOTE_ORIGIN);

  let applyingRemote = false;

  localDoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN && !applyingRemote) {
      Y.applyUpdate(peerDoc, update, REMOTE_ORIGIN);
    }
  });

  peerDoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN && !applyingRemote) {
      applyingRemote = true;
      Y.applyUpdate(localDoc, update, REMOTE_ORIGIN);
      applyingRemote = false;
    }
  });

  return {
    peerDoc,
    /** Apply a mutation on the peer doc (arrives at local with REMOTE_ORIGIN). */
    mutate(fn: () => void) {
      peerDoc.transact(fn, REMOTE_ORIGIN);
    },
    destroy() {
      peerDoc.destroy();
    },
  };
}

describe('undo.history', () => {
  let doc: Y.Doc;
  let controller: UndoController;
  let peer: ReturnType<typeof createPeer>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: 0, maxSteps: 200 });
    peer = createPeer(doc);
  });

  afterEach(() => {
    controller.destroy();
    peer.destroy();
    doc.destroy();
  });

  // TC-01: Local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour
  it('TC-01: undo own move does not reverse peer changes', () => {
    const idX = createSticky(doc, { x: 100, y: 100 });
    const idZ = createSticky(doc, { x: 400, y: 400 });

    // Move X locally
    moveObject(doc, idX, 200, 200);

    // Peer creates Y and recolours Z (with non-local origin)
    peer.mutate(() => {
      const objects = peer.peerDoc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', 300);
      map.set('y', 300);
      map.set('color', 'green');
      map.set('text', new Y.Text('Y'));
      map.set('z', 100);
      map.set('createdAt', Date.now());
      objects.set('peer-note-Y', map);
    });
    peer.mutate(() => {
      const objects = peer.peerDoc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
      const zObj = objects.get(idZ);
      if (zObj) zObj.set('color', 'pink');
    });

    // Undo local move
    expect(controller.canUndo()).toBe(true);
    const result = controller.undo();
    expect(result).toBe(true);

    // X restored to original position
    const snap = snapshot(doc);
    const x = snap.find((n) => n.id === idX);
    expect(x).toBeDefined();
    expect(x!.x).toBe(0); // original: 100 - STICKY_SIZE/2 = 100 - 100 = 0
    expect(x!.y).toBe(0);

    // Y still present
    const y = snap.find((n) => n.id === 'peer-note-Y');
    expect(y).toBeDefined();

    // Z keeps peer colour
    const z = snap.find((n) => n.id === idZ);
    expect(z).toBeDefined();
    expect(z!.color).toBe('pink');
  });

  // TC-02: Only peer changes → canUndo false
  it('TC-02: remote-only changes are not captured', () => {
    peer.mutate(() => {
      const objects = peer.peerDoc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', 300);
      map.set('y', 300);
      map.set('color', 'blue');
      map.set('text', new Y.Text('remote'));
      map.set('z', 1);
      map.set('createdAt', Date.now());
      objects.set('remote-only', map);
    });

    expect(controller.canUndo()).toBe(false);
  });

  // TC-03: LOAD-origin updates → canUndo false
  it('TC-03: load-origin updates are not captured', () => {
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', 100);
      map.set('y', 100);
      map.set('color', 'yellow');
      map.set('text', new Y.Text('loaded'));
      map.set('z', 1);
      map.set('createdAt', Date.now());
      objects.set('loaded-note', map);
    }, LOAD_ORIGIN);

    expect(controller.canUndo()).toBe(false);
  });

  // TC-04: Delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: undo restores deleted notes with all properties', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: (i + 1) * 100, y: (i + 1) * 100 }, 'orange');
      const ytext = getStickyText(doc, id);
      if (ytext) {
        doc.transact(() => ytext.insert(0, `note ${i}`), LOCAL_ORIGIN);
      }
      ids.push(id);
    }

    const beforeSnap = snapshot(doc);
    const deletedSnaps = ids.map((id) => beforeSnap.find((n) => n.id === id)!);

    // Delete all 8 in one transaction
    deleteObjects(doc, ids);

    // Verify they are gone
    let snap = snapshot(doc);
    for (const id of ids) {
      expect(snap.find((n) => n.id === id)).toBeUndefined();
    }

    // Undo
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // Verify they are restored
    snap = snapshot(doc);
    for (let i = 0; i < 8; i++) {
      const note = snap.find((n) => n.id === ids[i]);
      expect(note).toBeDefined();
      expect(note!.color).toBe('orange');
      expect(note!.text).toBe(`note ${i}`);
      expect(note!.x).toBe(deletedSnaps[i]!.x);
      expect(note!.y).toBe(deletedSnaps[i]!.y);
    }
  });

  // TC-05: Undo then redo → position re-applied
  it('TC-05: redo re-applies the undone move', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    moveObject(doc, id, 500, 500);

    controller.undo();
    let snap = snapshot(doc);
    expect(snap.find((n) => n.id === id)!.x).toBe(0); // original: 100 - 100 = 0

    expect(controller.canRedo()).toBe(true);
    controller.redo();

    snap = snapshot(doc);
    expect(snap.find((n) => n.id === id)!.x).toBe(500);
    expect(snap.find((n) => n.id === id)!.y).toBe(500);
  });

  // TC-06: Undo then new change → canRedo false
  it('TC-06: new change after undo clears redo', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    moveObject(doc, id, 200, 200);

    controller.undo();
    expect(controller.canRedo()).toBe(true);

    // Make a new change
    moveObject(doc, id, 300, 300);
    expect(controller.canRedo()).toBe(false);
  });

  // TC-07: Local move, peer deletes target, undo → no throw, still deleted, next undo works
  it('TC-07: undo of a move on a remotely-deleted object does not throw', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    const idB = createSticky(doc, { x: 400, y: 400 });

    // Move A locally
    moveObject(doc, idA, 200, 200);

    // Move B locally
    moveObject(doc, idB, 500, 500);

    // Peer deletes A
    peer.mutate(() => {
      const objects = peer.peerDoc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
      objects.delete(idA);
    });

    // Verify A is gone
    expect(snapshot(doc).find((n) => n.id === idA)).toBeUndefined();

    // Undo B's move (most recent local step)
    expect(controller.canUndo()).toBe(true);
    expect(() => controller.undo()).not.toThrow();
    const snap1 = snapshot(doc);
    const b1 = snap1.find((n) => n.id === idB);
    expect(b1!.x).toBe(300); // original: 400 - 100 = 300

    // Undo A's move (target deleted) — should not throw, A stays gone
    expect(controller.canUndo()).toBe(true);
    expect(() => controller.undo()).not.toThrow();

    // A should still be absent
    const snap2 = snapshot(doc);
    expect(snap2.find((n) => n.id === idA)).toBeUndefined();

    // Next undo still works (there may be items left from creates)
    if (controller.canUndo()) {
      expect(() => controller.undo()).not.toThrow();
    }
  });

  // TC-08: Peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo my delete restores content at time of delete', () => {
    const id = createSticky(doc, { x: 100, y: 100 });

    // Peer edits text
    peer.mutate(() => {
      const objects = peer.peerDoc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id);
      if (obj) {
        const ytext = obj.get('text') as Y.Text;
        ytext.insert(0, 'remote edit');
      }
    });

    // Verify text arrived
    const beforeDelete = snapshot(doc);
    expect(beforeDelete.find((n) => n.id === id)!.text).toBe('remote edit');

    // Local delete
    deleteObject(doc, id);

    // Undo
    controller.undo();
    const snap = snapshot(doc);
    const note = snap.find((n) => n.id === id);
    expect(note).toBeDefined();
    expect(note!.text).toBe('remote edit');
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length stays maxSteps, oldest dropped
  it('TC-09: stack trims beyond UNDO_MAX_STEPS', () => {
    controller.destroy();
    controller = createUndo(doc, { captureTimeoutMs: 0, maxSteps: 5 });

    // Create 6 objects and move each (each move = 1 step)
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = createSticky(doc, { x: (i + 1) * 100, y: 100 });
      ids.push(id);
    }

    // Move each one (6 steps)
    for (let i = 0; i < 6; i++) {
      moveObject(doc, ids[i]!, (i + 1) * 100 + 50, 100);
    }

    // Stack should be trimmed to 5. Undo all 5 available.
    for (let i = 0; i < 5; i++) {
      expect(controller.canUndo()).toBe(true);
      controller.undo();
    }
    // The 6th (oldest = move of ids[0]) should have been dropped.
    // Note: Yjs may consume extra items when undo touches deleted creates, but
    // here we're just undoing moves, so 5 undos should exhaust the stack.
    expect(controller.canUndo()).toBe(false);

    // ids[0] should still be at its moved position (never undone)
    const snap = snapshot(doc);
    const first = snap.find((n) => n.id === ids[0]);
    expect(first!.x).toBe(150); // was moved to 100+50=150 and never undone
  });

  // TC-10: UNDO_MAX_STEPS - 1 + 1 → length UNDO_MAX_STEPS, nothing dropped
  it('TC-10: stack at maxSteps minus 1 + 1 does not drop anything', () => {
    controller.destroy();
    controller = createUndo(doc, { captureTimeoutMs: 0, maxSteps: 5 });

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = createSticky(doc, { x: (i + 1) * 100, y: 100 });
      ids.push(id);
    }

    // Move each one (5 steps, exactly maxSteps)
    for (let i = 0; i < 5; i++) {
      moveObject(doc, ids[i]!, (i + 1) * 100 + 50, 100);
    }

    // All 5 should be undoable
    for (let i = 0; i < 5; i++) {
      expect(controller.canUndo()).toBe(true);
      controller.undo();
    }
    expect(controller.canUndo()).toBe(false);

    // All back to original positions
    const snap = snapshot(doc);
    for (let i = 0; i < 5; i++) {
      // original: (i+1)*100 - STICKY_SIZE/2 = (i+1)*100 - 100 = i*100
      expect(snap.find((n) => n.id === ids[i])!.x).toBe(i * 100);
    }
  });

  // TC-11: Destroy controller then new controller → canUndo false (session only)
  it('TC-11: new controller after destroy starts empty', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    moveObject(doc, id, 200, 200);
    expect(controller.canUndo()).toBe(true);

    controller.destroy();

    // Create a fresh controller (simulates page reload)
    const controller2 = createUndo(doc, { captureTimeoutMs: 0, maxSteps: 200 });
    expect(controller2.canUndo()).toBe(false);
    controller2.destroy();
  });
});
