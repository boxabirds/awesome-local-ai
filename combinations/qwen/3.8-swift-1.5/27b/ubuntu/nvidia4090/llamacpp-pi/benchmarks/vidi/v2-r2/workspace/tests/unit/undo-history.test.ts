import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  createUndo,
} from '../../src/client/board/undo';
import {
  createSticky as createStickyRaw,
  moveObject,
  deleteObject,
  deleteObjects,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';

function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: Parameters<typeof createStickyRaw>[2]): string {
  const id = createStickyRaw(doc, at, color);
  if (!id) throw new Error('createSticky failed');
  return id;
}

/**
 * Simulates a remote peer's change by applying a function to the local doc
 * with a non-LOCAL_ORIGIN origin. The UndoController only tracks LOCAL_ORIGIN,
 * so these changes are invisible to undo/redo.
 */
function applyRemote(doc: Y.Doc, fn: () => void) {
  doc.transact(fn, 'remote-peer');
}

/** Apply updates with a LOAD origin (story 4 load). */
function applyWithLoadOrigin(doc: Y.Doc, fn: () => void) {
  doc.transact(fn, 'load-origin');
}

/** Creates a sticky with a non-tracked origin (simulating loaded state). */
function createStickyRemote(doc: Y.Doc, x: number, y: number, color = 'yellow'): string {
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', x - 100);
    obj.set('y', y - 100);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', 1);
    obj.set('createdAt', Date.now());
    doc.getMap('objects').set(id, obj);
  }, 'remote-peer');
  return id;
}

describe('undo.history (TC-01 to TC-11)', () => {
  let doc: Y.Doc;
  let controller: ReturnType<typeof createUndo>;

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
  it('TC-01: undo only reverses local changes, not remote', () => {
    const idX = createSticky(doc, { x: 100, y: 100 }, 'yellow');
    controller.boundary();
    const idY = createSticky(doc, { x: 300, y: 100 }, 'blue');
    controller.boundary();
    const idZ = createSticky(doc, { x: 500, y: 100 }, 'green');
    controller.boundary();

    const origX = snapshot(doc).find((n) => n.id === idX)!;

    // Local: move X
    moveObject(doc, idX, 200, 200);
    controller.boundary();

    // Peer: recolour Z (remote change, not tracked)
    applyRemote(doc, () => {
      const objs = doc.getMap('objects');
      const zObj = objs.get(idZ) as Y.Map<unknown> | undefined;
      if (zObj) zObj.set('color', 'pink');
    });

    // Peer creates a new note (remote change, not tracked)
    createStickyRemote(doc, 700, 100, 'orange');

    expect(controller.canUndo()).toBe(true);

    // Undo should reverse the local move only
    controller.undo();

    const snap = snapshot(doc);
    const x = snap.find((n) => n.id === idX)!;
    const y = snap.find((n) => n.id === idY)!;
    const z = snap.find((n) => n.id === idZ)!;

    // X is back to original position
    expect(x.x).toBe(origX.x);
    expect(x.y).toBe(origX.y);
    // Y still exists
    expect(y).toBeDefined();
    // Z keeps peer's colour (pink)
    expect(z.color).toBe('pink');
    // Peer's new note still exists
    expect(snap.length).toBe(4);
  });

  // TC-02: only peer changes → canUndo false
  it('TC-02: remote-only changes do not create undo steps', () => {
    const idA = createStickyRemote(doc, 100, 100);

    applyRemote(doc, () => {
      const objs = doc.getMap('objects');
      const aObj = objs.get(idA) as Y.Map<unknown> | undefined;
      if (aObj) aObj.set('x', 999);
    });

    expect(controller.canUndo()).toBe(false);
  });

  // TC-03: LOAD-origin updates → canUndo false
  it('TC-03: load-origin updates are not tracked', () => {
    const idA = createStickyRemote(doc, 100, 100);

    applyWithLoadOrigin(doc, () => {
      const objs = doc.getMap('objects');
      const aObj = objs.get(idA) as Y.Map<unknown> | undefined;
      if (aObj) aObj.set('x', 555);
    });

    expect(controller.canUndo()).toBe(false);
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: undo restores deleted notes with full content', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 250, y: 100 }, 'yellow');
      ids.push(id);
      const text = (doc.getMap('objects').get(id) as Y.Map<unknown>)!.get('text') as Y.Text;
      text.insert(0, `note ${i}`);
    }
    controller.boundary();

    const beforeSnap = snapshot(doc);
    expect(beforeSnap.length).toBe(8);

    deleteObjects(doc, ids);
    controller.boundary();

    expect(snapshot(doc).length).toBe(0);
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const snap = snapshot(doc);
    expect(snap.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      const note = snap.find((n) => n.id === ids[i])!;
      expect(note).toBeDefined();
      expect(note.text).toBe(`note ${i}`);
      expect(note.color).toBe('yellow');
      const before = beforeSnap.find((n) => n.id === ids[i])!;
      expect(note.x).toBe(before.x);
      expect(note.y).toBe(before.y);
    }
  });

  // TC-05: undo then redo → re-applied
  it('TC-05: undo then redo re-applies the change', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const origPos = snapshot(doc).find((n) => n.id === idA)!;

    moveObject(doc, idA, 300, 300);
    controller.boundary();

    controller.undo();
    let snap = snapshot(doc);
    let note = snap.find((n) => n.id === idA)!;
    expect(note.x).toBe(origPos.x);
    expect(note.y).toBe(origPos.y);

    controller.redo();
    snap = snapshot(doc);
    note = snap.find((n) => n.id === idA)!;
    expect(note.x).toBe(300);
    expect(note.y).toBe(300);
  });

  // TC-06: undo then new change → canRedo false
  it('TC-06: new change after undo clears redo', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    moveObject(doc, idA, 200, 200);
    controller.boundary();

    controller.undo();
    expect(controller.canRedo()).toBe(true);

    moveObject(doc, idA, 400, 400);
    controller.boundary();

    expect(controller.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, next undo works
  it('TC-07: undo of move on remotely-deleted object does not throw', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    createSticky(doc, { x: 400, y: 100 });
    controller.boundary();

    moveObject(doc, idA, 200, 200);
    controller.boundary();

    // Peer deletes A (remote origin)
    applyRemote(doc, () => {
      doc.getMap('objects').delete(idA);
    });

    expect(snapshot(doc).find((n) => n.id === idA)).toBeUndefined();

    // Undo should not throw
    expect(() => controller.undo()).not.toThrow();

    // Next undo should still work
    expect(controller.canUndo()).toBe(true);
    expect(() => controller.undo()).not.toThrow();
  });

  // TC-08: peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo of delete restores content at time of delete', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    // Peer edits the text (remote origin)
    applyRemote(doc, () => {
      const objs = doc.getMap('objects');
      const aObj = objs.get(idA) as Y.Map<unknown> | undefined;
      if (aObj) {
        const text = aObj.get('text') as Y.Text;
        text.insert(0, 'peer edited');
      }
    });

    const textBeforeDelete = (doc.getMap('objects').get(idA) as Y.Map<unknown>)!.get('text') as Y.Text;
    expect(textBeforeDelete.toString()).toBe('peer edited');

    deleteObject(doc, idA);
    controller.boundary();

    controller.undo();

    const snap = snapshot(doc);
    const note = snap.find((n) => n.id === idA)!;
    expect(note).toBeDefined();
    expect(note.text).toBe('peer edited');
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history trimmed to maxSteps', () => {
    const smallDoc = new Y.Doc();
    initDoc(smallDoc);
    const smallController = createUndo(smallDoc, { maxSteps: 5, captureTimeoutMs: 10 });

    for (let i = 0; i < 7; i++) {
      createSticky(smallDoc, { x: i * 300, y: 100 });
      smallController.boundary();
    }

    let undoCount = 0;
    while (smallController.undo()) {
      undoCount++;
    }
    expect(undoCount).toBe(5);

    smallController.destroy();
    smallDoc.destroy();
  });

  // TC-10: at maxSteps, adding one more keeps exactly maxSteps
  it('TC-10: at maxSteps, all steps are kept', () => {
    const smallDoc = new Y.Doc();
    initDoc(smallDoc);
    const smallController = createUndo(smallDoc, { maxSteps: 5, captureTimeoutMs: 10 });

    for (let i = 0; i < 5; i++) {
      createSticky(smallDoc, { x: i * 300, y: 100 });
      smallController.boundary();
    }

    let undoCount = 0;
    while (smallController.undo()) {
      undoCount++;
    }
    expect(undoCount).toBe(5);

    smallController.destroy();
    smallDoc.destroy();
  });

  // TC-11: destroy then new controller → canUndo false (session only)
  it('TC-11: new controller after destroy starts empty', () => {
    createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    controller.destroy();

    const newController = createUndo(doc);
    expect(newController.canUndo()).toBe(false);

    newController.destroy();
  });
});
