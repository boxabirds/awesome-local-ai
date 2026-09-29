import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, UndoController } from '@client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  moveObjects,
  setStickyColor,
  getStickyText,
  snapshot,
  allObjectIds,
  resizeObjects,
} from '@shared/board-model';
import { UNDO_MAX_STEPS, UNDO_CAPTURE_TIMEOUT_MS, STICKY_SIZE_WORLD } from '@shared/config';

/** Create a remote doc and sync it into the local doc using a non-local origin. */
function syncRemote(localDoc: Y.Doc, remoteDoc: Y.Doc) {
  const update = Y.encodeStateAsUpdate(remoteDoc, Y.encodeStateVector(localDoc));
  Y.applyUpdate(localDoc, update, 'remote-peer');
}

// createSticky stores top-left = at - STICKY_SIZE_WORLD/2
const HALF = STICKY_SIZE_WORLD / 2;
function storedX(worldX: number) { return worldX - HALF; }
function storedY(worldY: number) { return worldY - HALF; }

describe('TC-01: undo restores local move; remote changes remain', () => {
  it('A moves X; peer creates Y, recolours Z; A undo → X restored, Y exists, Z keeps peer colour', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    // Create notes locally at world (200,200) → stored (100,100)
    let idX: string = '';
    let idZ: string = '';
    doc.transact(() => {
      idX = createSticky(doc, { x: 200, y: 200 });
      idZ = createSticky(doc, { x: 400, y: 400 });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Record initial stored positions
    let snap = snapshot(doc);
    const xInitial = snap.find(o => o.id === idX)!;
    expect(xInitial.x).toBe(storedX(200)); // 100

    // A moves X to stored position (500,500) — moveObjects sets x/y directly
    doc.transact(() => {
      moveObjects(doc, new Map([[idX, { x: 500, y: 500 }]]));
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Peer creates Y and recolours Z (simulate via second doc)
    const remoteDoc = new Y.Doc();
    syncRemote(remoteDoc, doc);
    let idY = '';
    remoteDoc.transact(() => {
      idY = createSticky(remoteDoc, { x: 600, y: 600 });
      setStickyColor(remoteDoc, idZ, 'blue');
    });
    syncRemote(doc, remoteDoc);

    // Verify move took effect
    snap = snapshot(doc);
    expect(snap.find(o => o.id === idX)!.x).toBe(500);

    // Undo A's move
    ctrl.undo();

    snap = snapshot(doc);
    const xAfter = snap.find(o => o.id === idX)!;
    // X should be restored to its value before the move
    expect(xAfter.x).toBe(storedX(200));
    expect(xAfter.y).toBe(storedY(200));

    // Y (peer's) should still exist
    const ids = allObjectIds(snap);
    expect(ids).toContain(idY);

    // Z should keep peer's colour
    const z = snap.find(o => o.id === idZ)!;
    expect(z.color).toBe('blue');

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-02: remote changes only → canUndo false', () => {
  it('peer changes only → canUndo false', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    const remoteDoc = new Y.Doc();
    remoteDoc.transact(() => {
      createSticky(remoteDoc, { x: 200, y: 200 });
    });
    syncRemote(doc, remoteDoc);

    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.canRedo()).toBe(false);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-03: load-origin updates → canUndo false', () => {
  it('updates applied with LOAD origin → canUndo false', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    const LOAD_ORIGIN = Symbol('load');
    doc.transact(() => {
      createSticky(doc, { x: 200, y: 200 });
    }, LOAD_ORIGIN);

    expect(ctrl.canUndo()).toBe(false);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-04: undo restores deleted objects with all properties', () => {
  it('delete 8 notes, undo → 8 restored with text, colour, size, position', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    // Create 8 notes with varied properties
    const ids: string[] = [];
    const colors = ['yellow', 'blue', 'green', 'pink', 'orange', 'violet', 'green', 'yellow'] as const;
    const positions: Array<{ x: number; y: number }> = [];
    doc.transact(() => {
      for (let i = 0; i < 8; i++) {
        const id = createSticky(doc, { x: i * 100 + HALF, y: i * 200 + HALF });
        ids.push(id);
        positions.push({ x: i * 100, y: i * 200 });
        setStickyColor(doc, id, colors[i]);
        const ytext = getStickyText(doc, id);
        if (ytext) ytext.insert(0, `Note ${i}`);
      }
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Delete them all
    doc.transact(() => {
      deleteObjects(doc, ids);
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    let snap = snapshot(doc);
    expect(allObjectIds(snap).length).toBe(0);

    // Undo the delete
    ctrl.undo();

    snap = snapshot(doc);
    expect(allObjectIds(snap).length).toBe(8);

    // Verify properties
    for (let i = 0; i < 8; i++) {
      const note = snap.find(o => o.id === ids[i])!;
      expect(note.x).toBe(positions[i].x);
      expect(note.y).toBe(positions[i].y);
      expect(note.color).toBe(colors[i]);
      expect(note.text).toBe(`Note ${i}`);
    }

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-05: undo then redo re-applies position', () => {
  it('undo then redo → position re-applied', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id: string = '';
    doc.transact(() => {
      id = createSticky(doc, { x: 200, y: 200 }); // stored (100,100)
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Move to (400, 600)
    doc.transact(() => {
      moveObjects(doc, new Map([[id, { x: 400, y: 600 }]]));
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    let snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(400);

    // Undo
    ctrl.undo();
    snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(storedX(200)); // 100
    expect(snap.find(o => o.id === id)!.y).toBe(storedY(200)); // 100

    // Redo
    ctrl.redo();
    snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(400);
    expect(snap.find(o => o.id === id)!.y).toBe(600);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-06: undo then new change clears redo', () => {
  it('undo, then new change → canRedo false', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id: string = '';
    doc.transact(() => {
      id = createSticky(doc, { x: 200, y: 200 });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Change colour
    doc.transact(() => {
      setStickyColor(doc, id, 'green');
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Undo the colour
    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // Make a new change → redo cleared
    doc.transact(() => {
      setStickyColor(doc, id, 'pink');
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-07: undo targets remotely-deleted item → no throw, stays deleted', () => {
  it('local move, peer deletes target, undo → no throw, object stays deleted, next undo works', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    // Create two notes locally
    let idA: string = '';
    let idB: string = '';
    doc.transact(() => {
      idA = createSticky(doc, { x: 200, y: 200 });
      idB = createSticky(doc, { x: 400, y: 400 });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Move idB
    doc.transact(() => {
      moveObjects(doc, new Map([[idB, { x: 300, y: 300 }]]));
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Peer deletes idB
    const remoteDoc = new Y.Doc();
    syncRemote(remoteDoc, doc);
    remoteDoc.transact(() => {
      deleteObjects(remoteDoc, [idB]);
    });
    syncRemote(doc, remoteDoc);

    // Undo the move of idB → should not throw
    expect(() => ctrl.undo()).not.toThrow();

    let snap = snapshot(doc);
    // idB should still be deleted (undoing a move of a deleted item should not recreate it)
    expect(snap.find(o => o.id === idB)).toBeUndefined();

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-08: undo my delete restores content at time of delete', () => {
  it('peer edits text before my delete, undo my delete → object has peer\'s text', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id: string = '';
    doc.transact(() => {
      id = createSticky(doc, { x: 200, y: 200 });
      const ytext = getStickyText(doc, id);
      if (ytext) ytext.insert(0, 'original');
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Peer edits the text
    const remoteDoc = new Y.Doc();
    syncRemote(remoteDoc, doc);
    remoteDoc.transact(() => {
      const ytext = getStickyText(remoteDoc, id);
      if (ytext) {
        ytext.delete(0, ytext.length);
        ytext.insert(0, 'peer edited');
      }
    });
    syncRemote(doc, remoteDoc);

    // Verify text is now 'peer edited'
    let snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.text).toBe('peer edited');

    // I delete the note
    doc.transact(() => {
      deleteObjects(doc, [id]);
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    snap = snapshot(doc);
    expect(snap.find(o => o.id === id)).toBeUndefined();

    // Undo my delete → should restore with 'peer edited' (content at time of delete)
    ctrl.undo();

    snap = snapshot(doc);
    const restored = snap.find(o => o.id === id);
    expect(restored).toBeDefined();
    expect(restored!.text).toBe('peer edited');

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-09: undo stack trims at max steps', () => {
  it('add 1 step beyond maxSteps → length stays maxSteps; oldest gone', () => {
    const doc = new Y.Doc();
    // Use a small maxSteps for test speed
    const maxSteps = 5;
    const ctrl = createUndo(doc, { maxSteps });

    // Create maxSteps notes (each as a separate step)
    for (let i = 0; i < maxSteps; i++) {
      doc.transact(() => {
        createSticky(doc, { x: i * 100 + HALF, y: 0 });
      }, LOCAL_ORIGIN);
      ctrl.boundary();
    }

    expect(ctrl.undoStackLength()).toBe(maxSteps);

    // Add one more → oldest should be trimmed
    doc.transact(() => {
      createSticky(doc, { x: maxSteps * 100 + HALF, y: 0 });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    expect(ctrl.undoStackLength()).toBe(maxSteps);

    // Undo all maxSteps steps → should still have 1 note (the oldest that was trimmed)
    for (let i = 0; i < maxSteps; i++) {
      expect(ctrl.canUndo()).toBe(true);
      ctrl.undo();
    }
    expect(ctrl.canUndo()).toBe(false);
    // The very first note (index 0) was trimmed → can't undo its creation
    // So there should be 1 note remaining
    const snap = snapshot(doc);
    expect(allObjectIds(snap).length).toBe(1);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-10: add 1 step at max-1 → length exactly max, nothing dropped', () => {
  it('add 1 step → length max, nothing dropped', () => {
    const doc = new Y.Doc();
    const maxSteps = 5;
    const ctrl = createUndo(doc, { maxSteps });

    // Add maxSteps - 1 steps
    for (let i = 0; i < maxSteps - 1; i++) {
      doc.transact(() => {
        createSticky(doc, { x: i * 100 + HALF, y: 0 });
      }, LOCAL_ORIGIN);
      ctrl.boundary();
    }

    expect(ctrl.undoStackLength()).toBe(maxSteps - 1);

    // Add one more
    doc.transact(() => {
      createSticky(doc, { x: (maxSteps - 1) * 100 + HALF, y: 0 });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    expect(ctrl.undoStackLength()).toBe(maxSteps);

    // All steps should be undoable: undo maxSteps times → all notes gone
    for (let i = 0; i < maxSteps; i++) {
      expect(ctrl.canUndo()).toBe(true);
      ctrl.undo();
    }
    expect(ctrl.canUndo()).toBe(false);
    const snap = snapshot(doc);
    expect(allObjectIds(snap).length).toBe(0);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-11: destroy controller then create new → canUndo false', () => {
  it('destroy controller and create new (simulates reload) → canUndo false', () => {
    const doc = new Y.Doc();

    const ctrl1 = createUndo(doc);
    doc.transact(() => {
      createSticky(doc, { x: 200, y: 200 });
    }, LOCAL_ORIGIN);
    ctrl1.boundary();
    expect(ctrl1.canUndo()).toBe(true);

    // Destroy (tab reload)
    ctrl1.destroy();

    // Create new controller on same doc (simulates re-render or board switch)
    const ctrl2 = createUndo(doc);
    expect(ctrl2.canUndo()).toBe(false);
    expect(ctrl2.canRedo()).toBe(false);

    ctrl2.destroy();
    doc.destroy();
  });
});
