import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  moveObject,
  deleteObjects,
  setStickyColor,
  LOCAL_ORIGIN,
} from '@shared/board-model';
import { UNDO_MAX_STEPS } from '@shared/config';
import { createUndo, type UndoController } from '@client/board/undo';
import { createPeer, applyWithLoadOrigin, type Peer } from './peer';

describe('undo.history', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;
  let peer: Peer;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    peer = createPeer(doc);
    ctrl = createUndo(doc);
  });

  afterEach(() => {
    ctrl.destroy();
    peer.destroy();
    doc.destroy();
  });

  // TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour
  it('TC-01: undo reverses own move, not peer changes', () => {
    // Local: create two notes (each as its own step)
    const idX = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    const idZ = createSticky(doc, { x: 500, y: 500 });
    ctrl.boundary();

    // Peer: create a note Y and recolour Z
    peer.peerApply((peerDoc) => {
      const objects = peerDoc.getMap<Y.Map<unknown>>('objects');
      const idY = crypto.randomUUID();
      const noteY = new Y.Map<unknown>();
      noteY.set('type', 'sticky');
      noteY.set('x', 300);
      noteY.set('y', 300);
      noteY.set('color', 'green');
      noteY.set('text', new Y.Text());
      noteY.set('z', 10);
      noteY.set('createdAt', Date.now());
      objects.set(idY, noteY);

      const noteZ = objects.get(idZ);
      if (noteZ) noteZ.set('color', 'blue');
    });

    // Local: move X
    moveObject(doc, idX, 200, 200);
    ctrl.boundary();

    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    const snap = snapshot(doc);
    const noteX = snap.find((n) => n.id === idX)!;
    const noteZ = snap.find((n) => n.id === idZ)!;

    // X restored to original position (0,0 because STICKY_SIZE_WORLD/2 = 100)
    expect(noteX.x).toBe(0);
    expect(noteX.y).toBe(0);

    // Peer's note Y still exists (3 notes: X, Z, and Y)
    expect(snap.length).toBe(3);

    // Peer's colour change kept
    expect(noteZ.color).toBe('blue');
  });

  // TC-02: only peer changes → canUndo false
  it('TC-02: remote changes are not captured', () => {
    // Create note before controller so it's not in the undo stack
    ctrl.destroy();
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl = createUndo(doc);

    peer.peerApply((peerDoc) => {
      const objects = peerDoc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(idA);
      if (obj) obj.set('x', 999);
    });

    expect(ctrl.canUndo()).toBe(false);
  });

  // TC-03: LOAD-origin updates → canUndo false
  it('TC-03: load-origin updates are not captured', () => {
    applyWithLoadOrigin(doc, (tempDoc) => {
      const objects = tempDoc.getMap<Y.Map<unknown>>('objects');
      const note = new Y.Map<unknown>();
      note.set('type', 'sticky');
      note.set('x', 50);
      note.set('y', 50);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set('load-id', note);
    });

    expect(ctrl.canUndo()).toBe(false);
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: undo restores deleted notes with all properties', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 100, y: i * 100 }, 'orange');
      const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
      doc.transact(() => {
        ytext.insert(0, `text-${i}`);
      }, LOCAL_ORIGIN);
      ids.push(id);
    }
    ctrl.boundary();

    // Capture positions before delete
    const before = snapshot(doc);
    const expected = ids.map((id) => before.find((n) => n.id === id)!);

    // Delete all 8
    deleteObjects(doc, ids);
    ctrl.boundary();

    expect(snapshot(doc).length).toBe(0);
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    const after = snapshot(doc);
    expect(after.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      const note = after.find((n) => n.id === ids[i])!;
      expect(note.x).toBe(expected[i].x);
      expect(note.y).toBe(expected[i].y);
      expect(note.color).toBe('orange');
      expect(note.text).toBe(`text-${i}`);
    }
  });

  // TC-05: undo then redo → position re-applied
  it('TC-05: redo re-applies the undone change', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    moveObject(doc, idA, 300, 400);
    ctrl.boundary();

    ctrl.undo();
    expect(ctrl.canUndo()).toBe(true); // creation is still there
    expect(ctrl.canRedo()).toBe(true);

    ctrl.redo();
    const note = snapshot(doc).find((n) => n.id === idA)!;
    expect(note.x).toBe(300);
    expect(note.y).toBe(400);
  });

  // TC-06: undo then new change → canRedo false
  it('TC-06: new change clears redo stack', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, idA, 200, 200);
    ctrl.boundary();

    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // Make a new change
    setStickyColor(doc, idA, 'green');
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works
  it('TC-07: undo targets deleted item without error', () => {
    // Create A and B as SEPARATE steps so deletion of A doesn't remove B's step
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    const idB = createSticky(doc, { x: 400, y: 400 });
    ctrl.boundary();

    // Move A
    moveObject(doc, idA, 200, 200);
    ctrl.boundary();

    // Peer deletes A
    peer.peerApply((peerDoc) => {
      const objects = peerDoc.getMap<Y.Map<unknown>>('objects');
      objects.delete(idA);
    });

    // Undo should not throw
    expect(ctrl.canUndo()).toBe(true);
    expect(() => ctrl.undo()).not.toThrow();

    // A stays deleted
    expect(snapshot(doc).find((n) => n.id === idA)).toBeUndefined();

    // Next undo still works (the creation of B, since it's a separate step)
    expect(ctrl.canUndo()).toBe(true);
    expect(() => ctrl.undo()).not.toThrow();
    // After undoing creation of B, B should be gone
    expect(snapshot(doc).find((n) => n.id === idB)).toBeUndefined();
  });

  // TC-08: peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo my delete restores content as of delete time', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Peer edits text of A
    peer.peerApply((peerDoc) => {
      const objects = peerDoc.getMap<Y.Map<unknown>>('objects');
      const note = objects.get(idA);
      if (note) {
        const ytext = note.get('text') as Y.Text;
        ytext.insert(0, 'peer added text');
      }
    });

    // Verify text synced
    const textAtDelete = (doc.getMap<Y.Map<unknown>>('objects').get(idA)!.get('text') as Y.Text).toString();
    expect(textAtDelete).toBe('peer added text');

    // Local: delete A
    deleteObjects(doc, [idA]);
    ctrl.boundary();

    expect(snapshot(doc).length).toBe(0);
    ctrl.undo();

    const note = snapshot(doc).find((n) => n.id === idA)!;
    expect(note).toBeDefined();
    expect(note.text).toBe('peer added text');
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length stays UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history trims beyond max steps', () => {
    // Create UNDO_MAX_STEPS notes each as a separate step
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i * 10, y: i * 10 });
      ctrl.boundary();
    }

    // Add one more step
    createSticky(doc, { x: 9999, y: 9999 });
    ctrl.boundary();

    // Undo all steps should only undo UNDO_MAX_STEPS times
    let undoCount = 0;
    while (ctrl.canUndo()) {
      ctrl.undo();
      undoCount++;
      if (undoCount > UNDO_MAX_STEPS + 1) break; // safety
    }
    expect(undoCount).toBe(UNDO_MAX_STEPS);

    // After undoing UNDO_MAX_STEPS times, 1 note remains (the very first, which was trimmed)
    const snap = snapshot(doc);
    expect(snap.length).toBe(1);
  });

  // TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped
  it('TC-10: history at max minus 1, add 1, nothing dropped', () => {
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      createSticky(doc, { x: i * 10, y: i * 10 });
      ctrl.boundary();
    }

    createSticky(doc, { x: 9999, y: 9999 });
    ctrl.boundary();

    // Should be able to undo exactly UNDO_MAX_STEPS times
    let undoCount = 0;
    while (ctrl.canUndo()) {
      ctrl.undo();
      undoCount++;
      if (undoCount > UNDO_MAX_STEPS + 1) break;
    }
    expect(undoCount).toBe(UNDO_MAX_STEPS);
    // All notes should be gone
    expect(snapshot(doc).length).toBe(0);
  });

  // TC-11: destroy then new controller → canUndo false (session only)
  it('TC-11: fresh controller after destroy starts empty', () => {
    const idA = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, idA, 200, 200);
    ctrl.boundary();

    expect(ctrl.canUndo()).toBe(true);
    ctrl.destroy();

    // Create a new controller (simulates reload)
    const ctrl2 = createUndo(doc);
    expect(ctrl2.canUndo()).toBe(false);
    ctrl2.destroy();
  });
});
