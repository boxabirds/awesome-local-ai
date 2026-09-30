import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '@client/board/undo';
import {
  LOCAL_ORIGIN, createSticky, moveObjects, deleteObjects,
  getStickyText, snapshot, initDoc,
} from '@shared/board-model';
import { UNDO_MAX_STEPS } from '@shared/config';

/**
 * Simulate a remote (non-local-origin) create of a sticky.
 */
function remoteCreateSticky(localDoc: Y.Doc, at: { x: number; y: number }, color = 'blue' as const): string {
  const id = crypto.randomUUID();
  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', at.x);
  obj.set('y', at.y);
  obj.set('color', color);
  obj.set('text', text);
  obj.set('z', 100);
  obj.set('createdAt', Date.now());

  const peerOrigin = Symbol('PEER');
  localDoc.transact(() => {
    localDoc.getMap('objects').set(id, obj);
  }, peerOrigin);
  return id;
}

/**
 * Simulate a remote colour change.
 */
function remoteSetColor(localDoc: Y.Doc, id: string, color: string) {
  const peerOrigin = Symbol('PEER');
  localDoc.transact(() => {
    const obj = localDoc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
    if (obj) obj.set('color', color);
  }, peerOrigin);
}

/**
 * Simulate a remote delete.
 */
function remoteDelete(localDoc: Y.Doc, id: string) {
  const peerOrigin = Symbol('PEER');
  localDoc.transact(() => {
    localDoc.getMap('objects').delete(id);
  }, peerOrigin);
}

/**
 * Simulate a remote text edit.
 */
function remoteEditText(localDoc: Y.Doc, id: string, newText: string) {
  const peerOrigin = Symbol('PEER');
  const obj = localDoc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!obj) return;
  const text = obj.get('text');
  if (text instanceof Y.Text) {
    localDoc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, newText);
    }, peerOrigin);
  }
}

/**
 * Apply updates with a LOAD origin (story 4).
 */
function loadOrigin(localDoc: Y.Doc, fn: () => void) {
  const LOAD = Symbol('LOAD');
  localDoc.transact(fn, LOAD);
}

function createTestDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('undo.history (TC-01 to TC-11)', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = createTestDoc();
    // Use captureTimeout 0 so each transaction is its own step in tests.
    // The real app uses boundary() to separate steps; here we do the same.
    controller = createUndo(doc, { captureTimeoutMs: 0 });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  // TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour
  it('TC-01: undo only reverses local changes, not remote', () => {
    // Create 2 stickies locally (separate steps)
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    const idZ = createSticky(doc, { x: 300, y: 100 });
    controller.boundary();

    // Record A's position
    const origA = snapshot(doc).find(s => s.id === idA)!;

    // Move A locally
    moveObjects(doc, new Map([[idA, { x: 200, y: 200 }]]));
    controller.boundary();

    // Peer creates Y and recolours Z (remote, not tracked)
    const idY = remoteCreateSticky(doc, { x: 400, y: 400 }, 'blue' as any);
    remoteSetColor(doc, idZ, 'orange');

    // Undo should only reverse the local move of A
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const snaps = snapshot(doc);
    const a = snaps.find(s => s.id === idA)!;
    const y = snaps.find(s => s.id === idY)!;
    const z = snaps.find(s => s.id === idZ)!;

    // A is back at original position
    expect(a.x).toBe(origA.x);
    expect(a.y).toBe(origA.y);
    // Y still exists (remote change not undone)
    expect(y).toBeDefined();
    // Z keeps peer's colour (remote change not undone)
    expect((z as any).color).toBe('orange');
  });

  // TC-02: only peer changes → canUndo false
  it('TC-02: remote-only changes do not create undo steps', () => {
    remoteCreateSticky(doc, { x: 100, y: 100 });
    expect(controller.canUndo()).toBe(false);
  });

  // TC-03: LOAD-origin updates → canUndo false
  it('TC-03: load-origin updates do not create undo steps', () => {
    loadOrigin(doc, () => {
      const id = crypto.randomUUID();
      const obj = new Y.Map();
      obj.set('type', 'sticky');
      obj.set('x', 50);
      obj.set('y', 50);
      obj.set('color', 'yellow');
      obj.set('text', new Y.Text());
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      doc.getMap('objects').set(id, obj);
    });
    expect(controller.canUndo()).toBe(false);
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: undo restores deleted notes with full content', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: 100 + i * 50, y: 100 + i * 50 }, 'green');
      ids.push(id);
      controller.boundary();
      // Set some text (separate step)
      const text = getStickyText(doc, id)!;
      doc.transact(() => {
        text.insert(0, `Note ${i}`);
      }, LOCAL_ORIGIN);
      controller.boundary();
    }

    // Record positions before delete
    const beforeSnaps = snapshot(doc);
    const beforeById = new Map(beforeSnaps.map(s => [s.id, s]));

    // Delete all 8 (one step)
    deleteObjects(doc, ids);
    controller.boundary();

    expect(snapshot(doc).length).toBe(0);

    // Undo the delete
    controller.undo();

    const afterSnaps = snapshot(doc);
    expect(afterSnaps.length).toBe(8);
    for (const id of ids) {
      const after = afterSnaps.find(s => s.id === id)!;
      const before = beforeById.get(id)!;
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect((after as any).color).toBe((before as any).color);
      expect((after as any).text).toBe((before as any).text);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
    }
  });

  // TC-05: undo then redo → re-applied
  it('TC-05: undo then redo re-applies the change', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    const origX = snapshot(doc).find(s => s.id === id)!.x;

    moveObjects(doc, new Map([[id, { x: 300, y: 200 }]]));
    controller.boundary();

    controller.undo();
    let snap = snapshot(doc).find(s => s.id === id)!;
    expect(snap.x).toBe(origX);

    controller.redo();
    snap = snapshot(doc).find(s => s.id === id)!;
    expect(snap.x).toBe(300);
  });

  // TC-06: undo then new change → canRedo false
  it('TC-06: new change after undo clears redo', () => {
    const id1 = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    const id2 = createSticky(doc, { x: 200, y: 200 });
    controller.boundary();

    // Move id1
    moveObjects(doc, new Map([[id1, { x: 150, y: 150 }]]));
    controller.boundary();

    controller.undo();
    expect(controller.canRedo()).toBe(true);

    // New change: move id2 (clears redo)
    moveObjects(doc, new Map([[id2, { x: 250, y: 250 }]]));
    expect(controller.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works
  it('TC-07: undo of move on remotely-deleted object is safe', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    createSticky(doc, { x: 300, y: 300 });
    controller.boundary();

    // Move id locally
    moveObjects(doc, new Map([[id, { x: 200, y: 200 }]]));
    controller.boundary();

    // Peer deletes id
    remoteDelete(doc, id);

    // Undo should not throw
    expect(() => controller.undo()).not.toThrow();

    // Object stays deleted
    const snaps = snapshot(doc);
    expect(snaps.find(s => s.id === id)).toBeUndefined();

    // Next undo works (undoes creation of the second sticky)
    expect(controller.canUndo()).toBe(true);
  });

  // TC-08: peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo of delete restores content at time of delete', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    // Local: set initial text
    const text = getStickyText(doc, id)!;
    doc.transact(() => {
      text.insert(0, 'hello');
    }, LOCAL_ORIGIN);
    controller.boundary();

    // Peer edits the text
    remoteEditText(doc, id, 'hello world');

    // Local: delete
    deleteObjects(doc, [id]);
    controller.boundary();

    // Undo the delete
    controller.undo();

    const snaps = snapshot(doc);
    const restored = snaps.find(s => s.id === id)!;
    // Should have the text as it was at the time of delete (after peer edit)
    expect((restored as any).text).toBe('hello world');
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history trims to UNDO_MAX_STEPS', () => {
    // Create UNDO_MAX_STEPS stickies (each is one undo step due to boundary)
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i * 10, y: 0 });
      controller.boundary();
    }

    // Add one more (should cause trimming)
    createSticky(doc, { x: 99999, y: 0 });
    controller.boundary();

    // The undo stack should be at most UNDO_MAX_STEPS
    let undoCount = 0;
    while (controller.canUndo()) {
      controller.undo();
      undoCount++;
    }
    expect(undoCount).toBe(UNDO_MAX_STEPS);
  });

  // TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped
  it('TC-10: at UNDO_MAX_STEPS - 1, adding one more keeps all', () => {
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      createSticky(doc, { x: i * 10, y: 0 });
      controller.boundary();
    }

    // Add one more (now at exactly UNDO_MAX_STEPS)
    createSticky(doc, { x: 99999, y: 0 });
    controller.boundary();

    // All UNDO_MAX_STEPS should be undoable
    let undoCount = 0;
    while (controller.canUndo()) {
      controller.undo();
      undoCount++;
    }
    expect(undoCount).toBe(UNDO_MAX_STEPS);
  });

  // TC-11: destroy then new controller → canUndo false (session only)
  it('TC-11: new controller after destroy starts empty', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    moveObjects(doc, new Map([[id, { x: 200, y: 200 }]]));
    controller.boundary();
    expect(controller.canUndo()).toBe(true);

    controller.destroy();

    const newController = createUndo(doc, { captureTimeoutMs: 0 });
    expect(newController.canUndo()).toBe(false);
    newController.destroy();
  });
});
