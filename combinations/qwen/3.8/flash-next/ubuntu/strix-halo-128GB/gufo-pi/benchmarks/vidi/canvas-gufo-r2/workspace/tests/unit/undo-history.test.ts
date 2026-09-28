/**
 * Unit tests for undo.history (TC-01 to TC-11).
 * Uses real Y.Docs; simulated remote peer via peer.ts helper.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  moveObject,
  deleteObjects,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { applyRemote, applyWithLoadOrigin } from './peer';

describe('undo.history', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    ctrl = createUndo(doc);
  });

  afterEach(() => {
    ctrl.destroy();
    doc.destroy();
  });

  it('TC-01: undo own move; peer create+recolour unchanged', () => {
    // Local: create X, then move it
    const idX = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, idX, 300, 300);
    ctrl.boundary();

    // Peer creates Y and recolours Z
    const idY = 'peer-note-Y';
    const idZ = 'peer-note-Z';
    applyRemote(doc, (peer) => {
      const objs = peer.getMap('objects');
      const mY = new Y.Map();
      mY.set('type', 'sticky');
      mY.set('x', 500);
      mY.set('y', 500);
      mY.set('color', 'blue');
      mY.set('z', 1);
      mY.set('createdAt', 1);
      mY.set('text', new Y.Text('peer Y'));
      objs.set(idY, mY);
      const mZ = new Y.Map();
      mZ.set('type', 'sticky');
      mZ.set('x', 700);
      mZ.set('y', 700);
      mZ.set('color', 'green');
      mZ.set('z', 2);
      mZ.set('createdAt', 1);
      mZ.set('text', new Y.Text('peer Z'));
      objs.set(idZ, mZ);
    });
    // Peer recolours Z to violet
    applyRemote(doc, (peer) => {
      const objs = peer.getMap('objects');
      const z = objs.get(idZ) as Y.Map<unknown>;
      if (z) z.set('color', 'violet');
    });

    // Undo the move
    expect(ctrl.undo()).toBe(true);

    // X is back at original position (100 - STICKY_SIZE_WORLD/2, 100 - STICKY_SIZE_WORLD/2)
    const notes = snapshot(doc);
    const x = notes.find((n) => n.id === idX);
    expect(x).toBeDefined();
    // createSticky centers: x = at.x - STICKY_SIZE_WORLD/2
    expect(x!.x).toBe(100 - STICKY_SIZE_WORLD / 2);

    // Y still exists (peer's create not undone)
    const y = notes.find((n) => n.id === idY);
    expect(y).toBeDefined();

    // Z keeps peer's colour (violet)
    const z = notes.find((n) => n.id === idZ);
    expect(z).toBeDefined();
    expect(z!.color).toBe('violet');
  });

  it('TC-02: only peer changes → canUndo false', () => {
    applyRemote(doc, (peer) => {
      const objs = peer.getMap('objects');
      const m = new Y.Map();
      m.set('type', 'sticky');
      m.set('x', 100);
      m.set('y', 100);
      m.set('color', 'blue');
      m.set('z', 1);
      m.set('createdAt', 1);
      m.set('text', new Y.Text('remote'));
      objs.set('remote-1', m);
    });
    expect(ctrl.canUndo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates → canUndo false', () => {
    applyWithLoadOrigin(doc, (peer) => {
      const objs = peer.getMap('objects');
      const m = new Y.Map();
      m.set('type', 'sticky');
      m.set('x', 100);
      m.set('y', 100);
      m.set('color', 'blue');
      m.set('z', 1);
      m.set('createdAt', 1);
      m.set('text', new Y.Text('loaded'));
      objs.set('loaded-1', m);
    });
    expect(ctrl.canUndo()).toBe(false);
  });

  it('TC-04: delete 8 notes, undo → all restored with text, colour, size, position', () => {
    // Create 8 notes
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: 100 + i * 50, y: 200 + i * 30 }, 'orange');
      const ytext = (doc.getMap<Y.Map<unknown>>('objects').get(id))!.get('text') as Y.Text;
      doc.transact(() => {
        ytext.insert(0, `note ${i}`);
      }, LOCAL_ORIGIN);
      ids.push(id);
      ctrl.boundary();
    }
    ctrl.boundary();

    // Record positions/colors before delete
    const before = snapshot(doc).filter((n) => ids.includes(n.id));
    expect(before).toHaveLength(8);

    // Delete all 8 in one operation
    ctrl.boundary();
    deleteObjects(doc, ids);
    ctrl.boundary();

    expect(snapshot(doc).filter((n) => ids.includes(n.id))).toHaveLength(0);

    // Undo the delete
    expect(ctrl.undo()).toBe(true);

    const after = snapshot(doc).filter((n) => ids.includes(n.id));
    expect(after).toHaveLength(8);

    // Verify properties restored
    for (const orig of before) {
      const restored = after.find((n) => n.id === orig.id)!;
      expect(restored.x).toBe(orig.x);
      expect(restored.y).toBe(orig.y);
      expect(restored.color).toBe('orange');
      expect(restored.text).toBe(orig.text);
    }
  });

  it('TC-05: undo then redo re-applies position', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, id, 500, 500);
    ctrl.boundary();

    ctrl.undo();
    let notes = snapshot(doc);
    // createSticky stores x = at.x - STICKY_SIZE_WORLD/2
    expect(notes[0].x).toBe(100 - STICKY_SIZE_WORLD / 2);

    expect(ctrl.redo()).toBe(true);
    notes = snapshot(doc);
    // moveObject stores the absolute value passed
    expect(notes[0].x).toBe(500);
  });

  it('TC-06: undo then new change clears redo', () => {
    const id1 = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, id1, 300, 300);
    ctrl.boundary();

    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // New change
    createSticky(doc, { x: 400, y: 400 });
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);
  });

  it('TC-07: undo move of object deleted by peer → no throw, stays deleted, next undo works', () => {
    // Create note, move it
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, id, 300, 300);
    ctrl.boundary();

    // Create another note (this will be our "next undo" target)
    createSticky(doc, { x: 800, y: 800 });
    ctrl.boundary();

    // Peer deletes the first note
    applyRemote(doc, (peer) => {
      peer.getMap('objects').delete(id);
    });

    // Undo most recent local step (create id2) - still works
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    // Now undo the move of id (which is deleted) - should not throw
    expect(() => ctrl.undo()).not.toThrow();

    // The note is still absent
    expect(doc.getMap('objects').has(id)).toBe(false);
  });

  it('TC-08: peer edits text, then local delete, undo restores content at time of delete', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Peer edits the text to "edited by peer"
    applyRemote(doc, (peer) => {
      const t = (peer.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      t.delete(0, t.length);
      t.insert(0, 'edited by peer');
    });

    // Local delete
    ctrl.boundary();
    deleteObjects(doc, [id]);
    ctrl.boundary();

    // Undo my delete
    ctrl.undo();

    // Note restored with content at time of delete
    const notes = snapshot(doc);
    const restored = notes.find((n) => n.id === id);
    expect(restored).toBeDefined();
    expect(restored!.text).toBe('edited by peer');
  });

  it('TC-09: at UNDO_MAX_STEPS, adding one more drops oldest', () => {
    // Build up UNDO_MAX_STEPS steps
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      doc.transact(() => {
        doc.getMap('objects').set(`item-${i}`, i);
      }, LOCAL_ORIGIN);
      ctrl.boundary();
    }

    // The undo stack should be at max
    // Add one more
    doc.transact(() => {
      doc.getMap('objects').set('overflow', 999);
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Verify the first step was dropped (undo everything and check item-0 is gone)
    // Actually just verify we can't undo more than UNDO_MAX_STEPS times
    let count = 0;
    while (ctrl.undo()) count++;
    expect(count).toBe(UNDO_MAX_STEPS);
    // item-0 should still exist in the doc (undo just can't reach it)
    // Actually undoing ALL should remove everything... but item-0's creation was dropped.
    // Let's verify item-0 still exists (its creation undo was lost):
    expect(doc.getMap('objects').has('item-0')).toBe(true);
  });

  it('TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped', () => {
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      doc.transact(() => {
        doc.getMap('objects').set(`item-${i}`, i);
      }, LOCAL_ORIGIN);
      ctrl.boundary();
    }
    // Add one more to reach exactly UNDO_MAX_STEPS
    doc.transact(() => {
      doc.getMap('objects').set('final', 42);
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // All steps should be undoable
    let count = 0;
    while (ctrl.undo()) count++;
    expect(count).toBe(UNDO_MAX_STEPS);
  });

  it('TC-11: destroy controller then create new → canUndo false', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, id, 500, 500);
    ctrl.boundary();
    expect(ctrl.canUndo()).toBe(true);

    ctrl.destroy();
    // Create a fresh controller (simulates page reload)
    const ctrl2 = createUndo(doc);
    expect(ctrl2.canUndo()).toBe(false);
    expect(ctrl2.canRedo()).toBe(false);
    ctrl2.destroy();
  });
});
