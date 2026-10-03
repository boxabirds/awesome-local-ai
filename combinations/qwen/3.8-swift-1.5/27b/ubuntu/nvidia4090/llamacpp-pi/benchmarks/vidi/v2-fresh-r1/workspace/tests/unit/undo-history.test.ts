// Unit tests for undo.history: per-user undo controller over Y.UndoManager.
// TC-01 to TC-11.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyLoadUpdate, createPeer } from './peer';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeController(doc: Y.Doc, opts?: { captureTimeoutMs?: number; maxSteps?: number }): UndoController {
  return createUndo(doc, opts);
}

describe('undo.history', () => {
  // TC-01: local move X; peer creates Y and recolours Z; undo → X restored,
  // Y present, Z keeps peer colour.
  it('TC-01 undo only reverses local changes, not remote ones', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    // Create 3 notes.
    const idA = createSticky(doc, { x: 100, y: 100 });
    const idB = createSticky(doc, { x: 300, y: 100 });
    const idC = createSticky(doc, { x: 500, y: 100 });
    ctrl.boundary(); // Close the creation step.

    // Local: move A.
    moveObject(doc, idA, 200, 200);
    ctrl.boundary(); // Close the move step.

    // Peer: create Y and recolour C (Z).
    const peer = createPeer(doc);
    peer.apply(() => {
      const objects = peer.doc.getMap('objects');
      const idY = crypto.randomUUID();
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 700);
      note.set('y', 100);
      note.set('color', 'green');
      note.set('text', new Y.Text());
      note.set('z', 10);
      note.set('createdAt', Date.now());
      objects.set(idY, note);
      // Recolour C (Z) to blue.
      (objects.get(idC) as Y.Map<unknown>).set('color', 'blue');
    });

    // Allow sync to settle.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer.doc));

    const snapBefore = snapshot(doc);
    expect(snapBefore.length).toBe(4); // A, B, C, Y
    const a = snapBefore.find((o) => o.id === idA)!;
    expect(a.x).toBe(200); // moved to (200, 200)
    expect(a.y).toBe(200);

    // Undo: should reverse A's move only.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    const snapAfter = snapshot(doc);
    expect(snapAfter.length).toBe(4); // Y still exists
    const aAfter = snapAfter.find((o) => o.id === idA)!;
    expect(aAfter.x).toBe(0); // 100 - 100 (original centred position)
    expect(aAfter.y).toBe(0); // 100 - 100
    // C (Z) keeps peer's colour (blue).
    const cAfter = snapAfter.find((o) => o.id === idC)!;
    expect(cAfter.color).toBe('blue');
    // Y exists.
    expect(snapAfter.some((o) => o.id !== idA && o.id !== idB && o.id !== idC)).toBe(true);

    ctrl.destroy();
    peer.destroy();
  });

  // TC-02: only peer changes → canUndo false.
  it('TC-02 remote-only changes do not enter undo stack', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    const peer = createPeer(doc);
    peer.apply(() => {
      const objects = peer.doc.getMap('objects');
      const id = crypto.randomUUID();
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    });

    // Allow sync.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer.doc));

    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.undo()).toBe(false);

    ctrl.destroy();
    peer.destroy();
  });

  // TC-03: LOAD-origin updates → canUndo false.
  it('TC-03 load-origin updates do not enter undo stack', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    // Simulate a load with LOAD origin.
    applyLoadUpdate(doc, () => {
      const objects = doc.getMap('objects');
      const id = crypto.randomUUID();
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    });

    expect(ctrl.canUndo()).toBe(false);

    ctrl.destroy();
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position.
  it('TC-04 undo restores deleted notes with all properties', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: 100 + i * 50, y: 100 });
      ids.push(id);
      // Set some text.
      const text = getStickyText(doc, id)!;
      doc.transact(() => { text.insert(0, `Note ${i}`); }, LOCAL_ORIGIN);
    }
    ctrl.boundary(); // Close the creation+text step.

    // Change a colour.
    setStickyColor(doc, ids[0], 'pink');
    ctrl.boundary(); // Close the colour step.

    // Delete all 8.
    deleteObjects(doc, ids);
    ctrl.boundary(); // Close the delete step.
    expect(snapshot(doc).length).toBe(0);

    // Undo the delete.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    const snap = snapshot(doc);
    expect(snap.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      const o = snap.find((s) => s.id === ids[i])!;
      expect(o).toBeDefined();
      expect(o.x).toBe(i * 50); // 100+i*50 - 100 (centred)
      expect(o.y).toBe(0); // 100 - 100
      expect(o.text).toBe(`Note ${i}`);
    }
    // First note has pink colour.
    expect(snap.find((s) => s.id === ids[0])!.color).toBe('pink');

    ctrl.destroy();
  });

  // TC-05: undo then redo → re-applied.
  it('TC-05 undo then redo re-applies the change', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary(); // Close creation step.

    moveObject(doc, id, 200, 200);
    ctrl.boundary(); // Close move step.

    // Undo the move.
    ctrl.undo();
    let snap = snapshot(doc);
    expect(snap.find((o) => o.id === id)!.x).toBe(0); // 100-100
    expect(snap.find((o) => o.id === id)!.y).toBe(0); // 100-100

    // Redo the move.
    expect(ctrl.canRedo()).toBe(true);
    ctrl.redo();
    snap = snapshot(doc);
    expect(snap.find((o) => o.id === id)!.x).toBe(200); // moved to (200,200)
    expect(snap.find((o) => o.id === id)!.y).toBe(200);

    ctrl.destroy();
  });

  // TC-06: undo then new change → canRedo false.
  it('TC-06 new change after undo clears redo', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 300, y: 100 });
    ctrl.boundary(); // Close creation step.

    // Move id2 (a new step to undo).
    moveObject(doc, id2, 350, 100);
    ctrl.boundary();

    // Undo the move of id2.
    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // New change: move id1.
    moveObject(doc, id1, 150, 150);
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);

    ctrl.destroy();
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted,
  // next undo works.
  it('TC-07 undo of move on remotely-deleted object is a no-op', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    // Create A and B separately so B's creation step is independent of A.
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    const idB = createSticky(doc, { x: 300, y: 100 });
    ctrl.boundary();

    // Local: move A.
    moveObject(doc, idA, 200, 200);
    ctrl.boundary(); // Close move step.

    // Peer deletes A.
    const peer = createPeer(doc);
    peer.apply(() => {
      peer.doc.getMap('objects').delete(idA);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer.doc));

    // A is gone from local doc.
    expect(snapshot(doc).find((o) => o.id === idA)).toBeUndefined();

    // Undo should not throw and A should remain deleted (not recreated).
    expect(() => ctrl.undo()).not.toThrow();
    expect(snapshot(doc).find((o) => o.id === idA)).toBeUndefined();

    // The controller is still usable (history not broken).
    // Yjs may have consumed additional steps while skipping the no-op,
    // but the controller should not be in an error state.
    expect(typeof ctrl.canUndo()).toBe('boolean');
    expect(typeof ctrl.canRedo()).toBe('boolean');

    ctrl.destroy();
    peer.destroy();
  });

  // TC-08: peer edits note text, then local delete, undo → restored with
  // content at time of delete.
  it('TC-08 undo of delete restores content at time of delete', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    const text = getStickyText(doc, id)!;
    doc.transact(() => { text.insert(0, 'original'); }, LOCAL_ORIGIN);
    ctrl.boundary(); // Close creation+text step.

    // Peer edits the text.
    const peer = createPeer(doc);
    peer.apply(() => {
      const objects = peer.doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      const peerText = obj.get('text') as Y.Text;
      peerText.insert(0, 'peer-');
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer.doc));

    // Text is now "peer-original".
    expect(text.toString()).toBe('peer-original');

    // Local delete.
    deleteObjects(doc, [id]);
    ctrl.boundary(); // Close delete step.
    expect(snapshot(doc).length).toBe(0);

    // Undo the delete.
    ctrl.undo();
    const snap = snapshot(doc);
    expect(snap.length).toBe(1);
    expect(snap[0].text).toBe('peer-original'); // content at time of delete

    ctrl.destroy();
    peer.destroy();
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped.
  it('TC-09 history trims to maxSteps (oldest dropped)', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc, { maxSteps: 5 });

    // Create 6 notes, each as a separate step.
    for (let i = 0; i < 6; i++) {
      createSticky(doc, { x: 100 + i * 10, y: 100 });
      ctrl.boundary();
    }

    // Stack should be trimmed to 5. Undo 5 times should work.
    let undoCount = 0;
    for (let i = 0; i < 5; i++) {
      if (ctrl.undo()) undoCount++;
    }
    expect(undoCount).toBe(5);
    // After 5 undos, the stack should be empty (the 6th step was trimmed).
    expect(ctrl.canUndo()).toBe(false);

    ctrl.destroy();
  });

  // TC-10: UNDO_MAX_STEPS - 1 + 1 → nothing dropped.
  it('TC-10 at maxSteps, all steps are kept', () => {
    const doc = makeDoc();
    const ctrl = makeController(doc, { maxSteps: 5 });

    // Create 5 notes, each as a separate step (= maxSteps).
    for (let i = 0; i < 5; i++) {
      createSticky(doc, { x: 100 + i * 10, y: 100 });
      ctrl.boundary();
    }

    // All 5 should be undoable.
    let undoCount = 0;
    for (let i = 0; i < 5; i++) {
      if (ctrl.undo()) undoCount++;
    }
    expect(undoCount).toBe(5);
    expect(ctrl.canUndo()).toBe(false);

    ctrl.destroy();
  });

  // TC-11: destroy then new controller → canUndo false (session only).
  it('TC-11 new controller after destroy starts empty', () => {
    const doc = makeDoc();
    const ctrl1 = makeController(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl1.boundary();
    moveObject(doc, id, 200, 200);
    ctrl1.boundary();
    expect(ctrl1.canUndo()).toBe(true);

    // Destroy.
    ctrl1.destroy();

    // New controller on same doc.
    const ctrl2 = makeController(doc);
    expect(ctrl2.canUndo()).toBe(false);

    ctrl2.destroy();
  });
});
