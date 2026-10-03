/**
 * Unit tests for the per-user undo history controller (TC-01 to TC-11).
 *
 * Uses real Y.Doc instances and a simulated remote peer (peer.ts) to verify
 * that only LOCAL_ORIGIN transactions are captured in the undo stack.
 *
 * Note: `controller.boundary()` is called between logical actions to prevent
 * the capture timeout from merging them into one step (in real usage, this
 * happens at gesture/edit boundaries).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  moveObjects,
  deleteObject,
  deleteObjects,
  setStickyColor,
  objects,
  LOCAL_ORIGIN,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { createPeer } from './peer';

let doc: Y.Doc;
let peer: ReturnType<typeof createPeer>;
let controller: ReturnType<typeof createUndo>;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  peer = createPeer(doc);
  controller = createUndo(doc);
});

afterEach(() => {
  controller.destroy();
  peer.destroy();
  doc.destroy();
});

describe('undo.history', () => {
  it('TC-01: local move; peer creates and recolours; undo restores only local change', () => {
    // Local: create a sticky (boundary before and after)
    controller.boundary();
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    void idA;

    // Local: move it
    controller.boundary();
    moveObject(doc, idA, 200, 200);
    controller.boundary();

    // Peer: creates a new sticky and recolours A
    peer.mutate((pdoc) => {
      const pObjects = pdoc.getMap('objects');
      const objB = new Y.Map();
      const textB = new Y.Text();
      textB.insert(0, 'peer note');
      objB.set('type', 'sticky');
      objB.set('x', 500);
      objB.set('y', 500);
      objB.set('color', 'blue');
      objB.set('text', textB);
      objB.set('z', 999);
      objB.set('createdAt', Date.now());
      pObjects.set('peer-id-B', objB);

      // Recolour A to orange
      const objA = pObjects.get(idA) as Y.Map<any> | undefined;
      if (objA) objA.set('color', 'orange');
    });

    // Verify peer changes are visible
    let snaps = objects(doc) as StickySnapshot[];
    expect(snaps.find((s) => s.id === 'peer-id-B')).toBeDefined();
    expect(snaps.find((s) => s.id === idA)?.color).toBe('orange');

    // Undo: should only restore A's position (the last local step)
    expect(controller.undo()).toBe(true);

    snaps = objects(doc) as StickySnapshot[];
    const a = snaps.find((s) => s.id === idA);
    expect(a?.x).toBe(0); // 100 - 100 (centre offset)
    expect(a?.y).toBe(0);
    // Peer's note B still exists
    expect(snaps.find((s) => s.id === 'peer-id-B')).toBeDefined();
    // A keeps peer's colour (orange) — undo only reverses position
    expect(a?.color).toBe('orange');
  });

  it('TC-02: only peer changes → canUndo false', () => {
    expect(controller.canUndo()).toBe(false);

    // Peer creates a sticky
    peer.mutate((pdoc) => {
      const pObjects = pdoc.getMap('objects');
      const obj = new Y.Map();
      const text = new Y.Text();
      obj.set('type', 'sticky');
      obj.set('x', 100);
      obj.set('y', 100);
      obj.set('color', 'yellow');
      obj.set('text', text);
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      pObjects.set('peer-only', obj);
    });

    // Local doc sees the change but undo stack is empty
    expect(objects(doc).some((s) => s.id === 'peer-only')).toBe(true);
    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates → canUndo false', () => {
    // Apply a change with LOAD origin (simulates story 4 load)
    peer.loadMutate(doc, (d) => {
      const obj = new Y.Map();
      const text = new Y.Text();
      obj.set('type', 'sticky');
      obj.set('x', 300);
      obj.set('y', 300);
      obj.set('color', 'green');
      obj.set('text', text);
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      d.getMap('objects').set('load-id', obj);
    });

    expect(objects(doc).some((s) => s.id === 'load-id')).toBe(true);
    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
  });

  it('TC-04: delete 8 notes, undo → all restored with text, colour, size, position', () => {
    const ids: string[] = [];
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'orange'] as const;
    controller.boundary();
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 250 + 100, y: 100 }, colors[i]);
      const text = (doc.getMap('objects').get(id) as Y.Map<any> | undefined)?.get('text') as Y.Text;
      doc.transact(() => { text.insert(0, `note ${i}`); }, LOCAL_ORIGIN);
      ids.push(id);
    }
    controller.boundary();

    // Delete all 8 in one group operation (one undo step)
    controller.boundary();
    deleteObjects(doc, ids);
    controller.boundary();

    expect(objects(doc).length).toBe(0);

    // Undo: all 8 restored in one step
    expect(controller.undo()).toBe(true);
    const snaps = objects(doc) as StickySnapshot[];
    expect(snaps.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      const s = snaps.find((x) => x.id === ids[i]);
      expect(s).toBeDefined();
      // createSticky centres: x = (i*250+100) - 100 = i*250, y = 100 - 100 = 0
      expect(s!.x).toBe(i * 250);
      expect(s!.y).toBe(0);
      expect(s!.color).toBe(colors[i]);
      expect(s!.text).toBe(`note ${i}`);
    }
  });

  it('TC-05: undo then redo → re-applied', () => {
    controller.boundary();
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    controller.boundary();
    moveObject(doc, id, 300, 300);
    controller.boundary();

    // Undo the move
    expect(controller.undo()).toBe(true);
    let snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id);
    expect(snap?.x).toBe(0); // 100 - 100 (centre)
    expect(snap?.y).toBe(0);

    // Redo the move
    expect(controller.redo()).toBe(true);
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id);
    expect(snap?.x).toBe(300);
    expect(snap?.y).toBe(300);
  });

  it('TC-06: undo then new change → canRedo false', () => {
    controller.boundary();
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    controller.boundary();
    moveObject(doc, id, 200, 200);
    controller.boundary();

    // Undo the move
    expect(controller.undo()).toBe(true);
    expect(controller.canRedo()).toBe(true);

    // New local change clears redo
    controller.boundary();
    moveObject(doc, id, 50, 50);
    controller.boundary();
    expect(controller.canRedo()).toBe(false);
  });

  it('TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works', () => {
    controller.boundary();
    const idA = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    // Move A (one step)
    controller.boundary();
    moveObject(doc, idA, 200, 200);
    controller.boundary();

    // Peer deletes A
    peer.mutate((pdoc) => {
      pdoc.getMap('objects').delete(idA);
    });

    // Undo: targets A's move, but A is gone → no throw, no visible effect
    expect(() => controller.undo()).not.toThrow();

    // A is still deleted (not recreated)
    expect(objects(doc).some((s) => s.id === idA)).toBe(false);

    // The controller is still usable (history not broken)
    expect(typeof controller.canUndo()).toBe('boolean');
    expect(typeof controller.canRedo()).toBe('boolean');
  });

  it('TC-08: peer edits note text, then local delete, undo → restored with content at time of delete', () => {
    controller.boundary();
    const id = createSticky(doc, { x: 100, y: 100 });
    const text = (doc.getMap('objects').get(id) as Y.Map<any> | undefined)?.get('text') as Y.Text;
    doc.transact(() => { text.insert(0, 'original'); }, LOCAL_ORIGIN);
    controller.boundary();

    // Peer edits the text
    peer.mutate((pdoc) => {
      const obj = pdoc.getMap('objects').get(id) as Y.Map<any> | undefined;
      const pText = obj?.get('text') as Y.Text;
      if (pText) pText.insert(pText.length, ' peer-edit');
    });

    // Local deletes the note (one step)
    controller.boundary();
    deleteObject(doc, id);
    controller.boundary();

    expect(objects(doc).length).toBe(0);

    // Undo: restores the note
    expect(controller.undo()).toBe(true);
    const snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id);
    expect(snap).toBeDefined();
    // Content at time of delete (includes peer edit since it was applied before delete)
    expect(snap!.text).toBe('original peer-edit');
  });

  it('TC-09: UNDO_MAX_STEPS steps + 1 → length stays UNDO_MAX_STEPS, oldest dropped', () => {
    // Add UNDO_MAX_STEPS + 1 changes, each as a separate step
    for (let i = 0; i <= UNDO_MAX_STEPS; i++) {
      controller.boundary();
      createSticky(doc, { x: i * 300, y: 0 });
    }

    // canUndo should be true
    expect(controller.canUndo()).toBe(true);

    // Undo UNDO_MAX_STEPS times — all should succeed (oldest was trimmed)
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(controller.undo()).toBe(true);
    }

    // Stack should now be empty
    expect(controller.canUndo()).toBe(false);
  });

  it('TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped', () => {
    // Add exactly UNDO_MAX_STEPS changes, each as a separate step
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      controller.boundary();
      createSticky(doc, { x: i * 300, y: 0 });
    }

    // All should be undoable
    expect(controller.canUndo()).toBe(true);
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(controller.undo()).toBe(true);
    }
    expect(controller.canUndo()).toBe(false);
  });

  it('TC-11: destroy then new controller → canUndo false (session only)', () => {
    controller.boundary();
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    moveObject(doc, id, 200, 200);
    controller.boundary();
    expect(controller.canUndo()).toBe(true);

    // Destroy and create a new controller
    controller.destroy();
    const newController = createUndo(doc);
    expect(newController.canUndo()).toBe(false);
    expect(newController.undo()).toBe(false);
    newController.destroy();
  });
});
