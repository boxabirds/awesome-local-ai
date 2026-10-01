/**
 * Unit tests for undo.history (TC-01 to TC-11).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  deleteObjects,
  setStickyColor,
  getStickyText,
  snapshot,
  getObjectsMap,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { createPeer, applyWithLoadOrigin } from './peer';

/** Directly set x/y on a note map (bypassing the centring in createSticky). */
function place(doc: Y.Doc, id: string, x: number, y: number): void {
  doc.transact(() => {
    const m = getObjectsMap(doc).get(id);
    if (m) { m.set('x', x); m.set('y', y); }
  }, LOCAL_ORIGIN);
}

describe('undo.history', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  afterEach(() => {
    doc.destroy();
  });

  function makeNote(x: number, y: number, color = 'yellow'): string {
    const id = createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const m = getObjectsMap(doc).get(id)!;
      m.set('x', x);
      m.set('y', y);
      m.set('color', color);
    }, LOCAL_ORIGIN);
    return id;
  }

  it('TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    const idX = makeNote(100, 100);
    ctrl.boundary();
    const idZ = makeNote(300, 100);
    ctrl.boundary();

    // Local moves idX
    moveObject(doc, idX, 200, 200);
    ctrl.boundary();

    // Remote peer creates a note and recolours Z
    const peer = createPeer(doc);
    peer.applyOnPeer((pdoc) => {
      const objs = getObjectsMap(pdoc);
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', 500);
      m.set('y', 500);
      m.set('color', 'yellow');
      m.set('text', new Y.Text());
      m.set('z', 10);
      m.set('createdAt', Date.now());
      objs.set('remote-y', m);
    });
    peer.applyOnPeer((pdoc) => {
      const mz = getObjectsMap(pdoc).get(idZ);
      if (mz) mz.set('color', 'blue');
    });

    // Undo the local move
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    const snap = snapshot(doc);
    expect(snap.find((n) => n.id === idX)?.x).toBe(100);
    expect(snap.find((n) => n.id === idX)?.y).toBe(100);
    expect((snap.find((n) => n.id === idZ) as any)?.color).toBe('blue');
    expect(snap.find((n) => n.id === 'remote-y')).toBeDefined();

    ctrl.destroy();
    peer.destroy();
  });

  it('TC-02: only peer changes → canUndo false', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    const peer = createPeer(doc);

    peer.applyOnPeer((pdoc) => {
      const objs = getObjectsMap(pdoc);
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', 'yellow');
      m.set('text', new Y.Text());
      m.set('z', 1);
      m.set('createdAt', Date.now());
      objs.set('remote-1', m);
    });

    expect(ctrl.canUndo()).toBe(false);
    ctrl.destroy();
    peer.destroy();
  });

  it('TC-03: LOAD-origin updates → canUndo false', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    applyWithLoadOrigin(doc, (d) => {
      const objs = getObjectsMap(d);
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('color', 'yellow');
      m.set('text', new Y.Text());
      m.set('z', 1);
      m.set('createdAt', Date.now());
      objs.set('loaded-1', m);
    });

    expect(ctrl.canUndo()).toBe(false);
    ctrl.destroy();
  });

  it('TC-04: delete 8 notes, undo → all restored with text, colour, size, position', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(makeNote(i * 100, i * 50));
      ctrl.boundary();
    }

    setStickyColor(doc, ids[0], 'pink');
    ctrl.boundary();
    const ytext = getStickyText(doc, ids[1])!;
    doc.transact(() => ytext.insert(0, 'hello'), LOCAL_ORIGIN);
    ctrl.boundary();

    deleteObjects(doc, ids);
    ctrl.boundary();

    expect(snapshot(doc).length).toBe(0);

    ctrl.undo();
    const snap = snapshot(doc);
    expect(snap.length).toBe(8);
    const r0 = snap.find((n) => n.id === ids[0]);
    expect((r0 as import('../../src/shared/board-model').StickySnapshot | undefined)?.color).toBe('pink');
    expect(r0?.x).toBe(0);
    expect(r0?.y).toBe(0);
    const r1 = snap.find((n) => n.id === ids[1]);
    expect((r1 as any)?.text).toBe('hello');
    expect(r1?.x).toBe(100);
    expect(r1?.y).toBe(50);

    ctrl.destroy();
  });

  it('TC-05: undo then redo → position re-applied', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    const id = makeNote(100, 100);
    ctrl.boundary();

    moveObject(doc, id, 300, 300);
    ctrl.boundary();

    ctrl.undo();
    expect(snapshot(doc).find((n) => n.id === id)?.x).toBe(100);

    expect(ctrl.canRedo()).toBe(true);
    ctrl.redo();
    expect(snapshot(doc).find((n) => n.id === id)?.x).toBe(300);

    ctrl.destroy();
  });

  it('TC-06: undo then new change → canRedo false', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    const id = makeNote(100, 100);
    ctrl.boundary();
    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    setStickyColor(doc, id, 'green');
    ctrl.boundary();
    expect(ctrl.canRedo()).toBe(false);

    ctrl.destroy();
  });

  it('TC-07: local move, peer deletes target, undo → no throw, still deleted', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    const idA = makeNote(100, 100);
    ctrl.boundary();
    const idB = makeNote(200, 200);
    ctrl.boundary();

    // Local moves idB
    moveObject(doc, idB, 400, 400);
    ctrl.boundary();

    // Peer deletes idB
    const peer = createPeer(doc);
    peer.applyOnPeer((pdoc) => {
      getObjectsMap(pdoc).delete(idB);
    });

    // Undo the move → targets deleted item, no throw
    expect(() => ctrl.undo()).not.toThrow();
    expect(snapshot(doc).find((n) => n.id === idB)).toBeUndefined();

    // Undo history stays usable: next undo still works without error
    expect(() => {
      while (ctrl.canUndo()) ctrl.undo();
    }).not.toThrow();
    // idA may or may not be restored, but no error was thrown

    ctrl.destroy();
    peer.destroy();
  });

  it('TC-08: peer edits note text, then local delete, undo → restored with content at time of delete', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    const id = makeNote(0, 0);
    ctrl.boundary();

    const peer = createPeer(doc);
    peer.applyOnPeer((pdoc) => {
      const m = getObjectsMap(pdoc).get(id);
      if (m) {
        const t = m.get('text');
        if (t instanceof Y.Text) t.insert(0, 'remote edit');
      }
    });

    deleteObjects(doc, [id]);
    ctrl.boundary();

    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();

    ctrl.undo();
    const restored = snapshot(doc).find((n) => n.id === id);
    expect(restored).toBeDefined();
    expect((restored as any)?.text).toBe('remote edit');

    ctrl.destroy();
    peer.destroy();
  });

  it('TC-09: maxSteps + 1 → length stays maxSteps, oldest dropped', () => {
    const maxSteps = 5;
    const ctrl = createUndo(doc, { captureTimeoutMs: 0, maxSteps });

    for (let i = 0; i < maxSteps; i++) {
      makeNote(i * 10, 0);
      ctrl.boundary();
    }
    makeNote(9999, 0);
    ctrl.boundary();

    let count = 0;
    while (ctrl.canUndo()) { ctrl.undo(); count++; }
    expect(count).toBe(maxSteps);

    ctrl.destroy();
  });

  it('TC-10: maxSteps − 1 + 1 → length is maxSteps, nothing dropped', () => {
    const maxSteps = 5;
    const ctrl = createUndo(doc, { captureTimeoutMs: 0, maxSteps });

    for (let i = 0; i < maxSteps - 1; i++) {
      makeNote(i * 10, 0);
      ctrl.boundary();
    }
    makeNote(9999, 0);
    ctrl.boundary();

    let count = 0;
    while (ctrl.canUndo()) { ctrl.undo(); count++; }
    expect(count).toBe(maxSteps);

    ctrl.destroy();
  });

  it('TC-11: destroy then new controller → canUndo false (session only)', () => {
    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    makeNote(0, 0);
    ctrl.boundary();

    expect(ctrl.canUndo()).toBe(true);
    ctrl.destroy();

    const ctrl2 = createUndo(doc, { captureTimeoutMs: 0 });
    expect(ctrl2.canUndo()).toBe(false);
    ctrl2.destroy();
  });
});
