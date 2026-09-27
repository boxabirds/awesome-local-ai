// Story 8, Task 6 — undo-history unit tests (TC-01..TC-11).
//
// Real Y.Docs, the real board model, and the real controller. Remote peers are
// second Y.Docs exchanging updates with a non-local origin (see helpers/peer),
// so the tests exercise exactly the wire situation from PRD undo.safe: only
// transactions carrying LOCAL_ORIGIN may ever be undone.

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  deleteObjects,
  getStickyText,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { createPeer, applyWithLoadOrigin, makeUpdateWithStickies, type Peer } from './helpers/peer';

let doc: Y.Doc;
let ctl: UndoController;
let peer: Peer;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  ctl = createUndo(doc);
  peer = createPeer(doc);
});

function byId(id: string): ObjectSnapshot | undefined {
  return snapshot(doc).find((o) => o.id === id);
}

/** A local discrete action: its own capture window on both sides. */
function step(fn: () => void): void {
  ctl.boundary();
  fn();
  ctl.boundary();
}

describe('TC-01 undo reverses my last step and nothing else', () => {
  it('undoing my move leaves peer-created and peer-edited content untouched', () => {
    const xId = createSticky(doc, { x: 0, y: 0 });
    const zId = createSticky(doc, { x: 400, y: 0 });
    ctl.boundary();
    expect(moveObject(doc, xId, 120, 60)).toBe(true);
    ctl.boundary();
    expect(ctl.canUndo()).toBe(true);

    // Peer changes AFTER my move: creates a note and recolours Z.
    createSticky(peer.doc, { x: 900, y: 900 });
    setStickyColor(peer.doc, zId, 'pink');
    peer.sync();

    const beforeUndo = snapshot(doc);
    expect(ctl.undo()).toBe(true);

    // My move is reversed...
    const x = byId(xId);
    expect(x).toBeDefined();
    // ...Z keeps the peer colour, the peer note is still there, and nothing
    // else in the snapshot moved (field-by-field comparison below).
    expect(byId(zId)!.color).toBe('pink');
    const others = snapshot(doc).filter((o) => o.id !== xId);
    const othersBefore = beforeUndo.filter((o) => o.id !== xId);
    expect(others.length).toBe(othersBefore.length);
    for (const o of others) {
      const b = othersBefore.find((p) => p.id === o.id)!;
      expect([o.x, o.y, o.z, o.color, o.text]).toEqual([b.x, b.y, b.z, b.color, b.text]);
    }
  });
});

describe('TC-02 peer-only changes leave the undo stack empty', () => {
  it('a sync-only tab cannot undo', () => {
    createSticky(peer.doc, { x: 10, y: 10 });
    peer.sync();
    expect(snapshot(doc).some((o) => o.type === 'sticky')).toBe(true);
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });
});

describe('TC-03 LOAD-origin updates never enter the stack (story 4 integration)', () => {
  it('applying the board load with the load origin creates no steps', () => {
    applyWithLoadOrigin(doc, makeUpdateWithStickies(3));
    expect(snapshot(doc).length).toBe(3);
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });
});

describe('TC-04 undoing my delete restores every object with its fields', () => {
  it('eight notes come back with position, colour and text', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(createSticky(doc, { x: i * 100, y: i * 50 }, 'blue'));
    getStickyText(doc, ids[3])!.insert(0, 'keep me');
    ctl.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    ctl.boundary();
    expect(snapshot(doc).length).toBe(0);

    expect(ctl.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after.length).toBe(8);
    for (const o of after) {
      const i = ids.indexOf(o.id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect([o.x, o.y, o.color]).toEqual([
        i * 100 - 100, // createSticky centres: x = at.x - size/2 (size 200)
        i * 50 - 100,
        'blue',
      ]);
    }
    expect(getStickyText(doc, ids[3])!.toString()).toBe('keep me');
  });
});

describe('TC-05 redo re-applies my move', () => {
  it('undo then redo lands the note at the moved-to position', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    ctl.boundary();
    moveObject(doc, id, 77, 88);
    ctl.boundary();
    expect(ctl.undo()).toBe(true);
    expect(ctl.canRedo()).toBe(true);
    expect(ctl.redo()).toBe(true);
    const o = byId(id)!;
    expect([o.x, o.y]).toEqual([77, 88]);
    expect(ctl.canRedo()).toBe(false);
  });
});

describe('TC-06 a new change clears the redo stack', () => {
  it('canRedo is false after the next local mutation', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    ctl.boundary();
    moveObject(doc, id, 77, 88);
    ctl.boundary();
    ctl.undo();
    expect(ctl.canRedo()).toBe(true);
    step(() => setStickyColor(doc, id, 'green'));
    expect(ctl.canRedo()).toBe(false);
    expect(ctl.redo()).toBe(false);
  });
});

describe('TC-07 undo of a move for an object deleted remotely does nothing', () => {
  it('no throw, the object stays gone, the controller still works', () => {
    const aId = createSticky(doc, { x: 0, y: 0 });
    const bId = createSticky(doc, { x: 300, y: 0 });
    ctl.boundary();
    step(() => moveObject(doc, bId, 340, 10));
    ctl.boundary();
    moveObject(doc, aId, 50, 50); // newest step: A moved by ME
    ctl.boundary();

    // A peer deletes A.
    deleteObjects(peer.doc, [aId]);
    peer.sync();
    expect(byId(aId)).toBeUndefined();

    // Undo must not throw. The dead inverse (A is gone) has no effect — Yjs
    // skips it and continues — and the remote delete is never overwritten.
    expect(() => ctl.undo()).not.toThrow();
    expect(byId(aId)).toBeUndefined();

    // The controller still works: the skip continued to my previous own step,
    // so B's move was undone instead.
    const b = byId(bId)!;
    expect([b.x, b.y]).not.toEqual([340, 10]);
    expect(ctl.canUndo()).toBe(true); // the create steps are still in the stack
  });
});

describe('TC-08 undo of my delete restores content a peer edited', () => {
  it('the note returns with the text it had at delete time', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, 'base');
    ctl.boundary();

    // Peer appends to the note; the edit converges before my delete.
    const peerText = getStickyText(peer.doc, id)!;
    peerText.insert(peerText.length, ' + peer');
    peer.sync();
    expect(byId(id)!.text).toBe('base + peer');

    ctl.boundary();
    deleteObjects(doc, [id]);
    ctl.boundary();
    expect(byId(id)).toBeUndefined();

    expect(ctl.undo()).toBe(true);
    expect(getStickyText(doc, id)!.toString()).toBe('base + peer');
  });
});

describe('TC-09 the 201st step drops the oldest', () => {
  it('exactly UNDO_MAX_STEPS steps are kept; the first action survives', () => {
    const ids: string[] = [];
    for (let i = 0; i <= UNDO_MAX_STEPS; i++) step(() => ids.push(createSticky(doc, { x: i * 10, y: 0 })));
    expect(snapshot(doc).length).toBe(UNDO_MAX_STEPS + 1);

    // Undo everything the stack can still reverse: exactly maxSteps steps.
    for (let i = 0; i < UNDO_MAX_STEPS; i++) expect(ctl.undo()).toBe(true);
    expect(ctl.undo()).toBe(false);
    expect(ctl.canUndo()).toBe(false);

    // Only the FIRST note is left — its step was the dropped one.
    const left = snapshot(doc);
    expect(left.length).toBe(1);
    expect(left[0].id).toBe(ids[0]);
  });
});

describe('TC-10 exactly 200 steps drops nothing', () => {
  it('a 200th step keeps all 200 steps undoable', () => {
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) step(() => ids.push(createSticky(doc, { x: i * 10, y: 0 })));
    for (let i = 0; i < UNDO_MAX_STEPS; i++) expect(ctl.undo()).toBe(true);
    expect(ctl.undo()).toBe(false);
    expect(snapshot(doc).length).toBe(0);
  });
});

describe('TC-11 controller destroy discards the history', () => {
  it('a fresh controller starts with an empty stack', () => {
    step(() => createSticky(doc, { x: 0, y: 0 }));
    expect(ctl.canUndo()).toBe(true);
    ctl.destroy();

    const ctl2 = createUndo(doc);
    expect(ctl2.canUndo()).toBe(false);
    expect(ctl2.undo()).toBe(false);
    // and the new controller tracks the new session normally
    ctl2.boundary();
    moveObject(doc, snapshot(doc)[0].id, 42, 42);
    ctl2.boundary();
    expect(ctl2.canUndo()).toBe(true);
    expect(ctl2.undo()).toBe(true);
    ctl2.destroy();
  });
});

describe('boundary + error paths', () => {
  it('boundary() with an empty stack is a no-op; undo/redo on empty return false', () => {
    expect(() => ctl.boundary()).not.toThrow();
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.canRedo()).toBe(false);
    expect(ctl.undo()).toBe(false);
    expect(ctl.redo()).toBe(false);
  });
});
